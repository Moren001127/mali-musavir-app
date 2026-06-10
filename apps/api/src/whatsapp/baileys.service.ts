import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { useDBAuthState, BAILEYS_PROVIDER, DBAuthState } from './baileys-auth-store';
import * as QRCode from 'qrcode';

/**
 * Baileys (QR tabanlı, resmi olmayan) WhatsApp bağlantısı.
 *
 * Meta Cloud API yerine, telefondaki WhatsApp'a "bağlı cihaz" olarak QR ile
 * bağlanır ve mevcut numara üzerinden mesaj alıp gönderir. Bot mantığı (intent,
 * kalite, hafıza) DEĞİŞMEZ — burası yalnızca taşıma katmanıdır:
 *   - GELEN mesaj  → IncomingWhatsAppMessage'e çevrilip inboundHandler'a verilir
 *                    (handleMessage hattı, webhook ile birebir aynı).
 *   - GİDEN mesaj  → WhatsAppService bu servise yönlendirir.
 *
 * Oturum Postgres'te saklanır (baileys-auth-store) → deploy sonrası QR gerekmez.
 * WhatsApp tek bağlı cihaz oturumuna izin verdiği için servis TEK instance
 * çalışmalıdır (Railway'de yatay ölçekleme yok).
 */

export type BaileysInbound = {
  from: string;
  text: string;
  id?: string;
  replyTo?: string;
  media?: { kind: string; id?: string; mimeType?: string; filename?: string; caption?: string };
};

export type BaileysSendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export type BaileysPresenceSnapshot = {
  status: 'online' | 'typing' | 'recording' | 'paused' | 'offline' | 'unknown';
  label: string;
  at: string | null;
  lastSeenAt?: string | null;
};

export type BaileysDeliverySnapshot = {
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';
  at: string | null;
};

type Session = {
  tenantId: string;
  sock: any;
  auth: DBAuthState;
  qr: string | null;
  connected: boolean;
  connecting: boolean;
  lastError?: string;
  startedAt: number;
  lidToPhone: Map<string, string>;
};

// ESM-only Baileys'i CommonJS/webpack build'inde import etmek için: TS ve
// webpack'in import()'u require()'a çevirmesini engelleyen native import.
const nativeImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;

@Injectable()
export class BaileysService implements OnModuleDestroy {
  private readonly logger = new Logger(BaileysService.name);
  private mod: any = null;
  /** Süreç kapanıyor (dağıtımda SIGTERM) — soketler sessizce bırakılır,
   *  oturum SİLİNMEZ ve yeniden bağlanma kurulmaz. */
  private shuttingDown = false;
  private readonly sessions = new Map<string, Session>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly intentionalLogoutTenants = new Set<string>();
  private readonly lastErrors = new Map<string, string>();
  private readonly presences = new Map<string, BaileysPresenceSnapshot & { expiresAt: number }>();
  private readonly deliveries = new Map<string, BaileysDeliverySnapshot & { expiresAt: number }>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private inboundHandler: ((msg: BaileysInbound) => Promise<void>) | null = null;
  private lidMappingHandler: ((tenantId: string, lid: string, phone: string) => Promise<void>) | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dağıtımda eski kopya kapanırken (SIGTERM) soketleri DÜZGÜN bırak.
   * logout DEĞİL — oturum geçerli kalır; yeni kopya kayıtlı oturumla bağlanır.
   * Bu olmadan eski+yeni kopya aynı oturuma bağlanıyor, WhatsApp "conflict"
   * verip oturumu düşürüyordu (2026-06-10: QR'a düştü, mesajlar ulaşmadı).
   */
  onModuleDestroy() {
    this.shuttingDown = true;
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    for (const [tenantId, timer] of this.reconnectTimers) { clearTimeout(timer); this.reconnectTimers.delete(tenantId); }
    for (const [tenantId, s] of this.sessions) {
      try { s.sock?.end?.(undefined); } catch { /* ignore */ }
      this.logger.log(`[Baileys] tenant=${tenantId} kapanışta soket bırakıldı (oturum korunuyor)`);
    }
    this.sessions.clear();
  }

  /** Bot controller, gelen mesajı handleMessage hattına vermek için bunu kaydeder. */
  setInboundHandler(fn: (msg: BaileysInbound) => Promise<void>) {
    this.inboundHandler = fn;
  }

  setLidMappingHandler(fn: (tenantId: string, lid: string, phone: string) => Promise<void>) {
    this.lidMappingHandler = fn;
  }

  private async baileys(): Promise<any> {
    if (this.mod) return this.mod;
    this.mod = await nativeImport('@whiskeysockets/baileys');
    return this.mod;
  }

  // Baileys silent logger (pino bağımlılığı eklemeden)
  private makeLogger(): any {
    const self = this;
    const noop = () => {};
    // Objeleri JSON yaz — "[object Object]" hata kodunu gizliyordu (2026-06-10
    // "received error in ack" teşhisinde detay kayboldu).
    const fmt = (a: any[]) => a.map((x) => {
      if (x && typeof x === 'object') { try { return JSON.stringify(x).slice(0, 600); } catch { return String(x); } }
      return String(x);
    }).join(' ');
    const l: any = {
      level: 'silent',
      trace: noop, debug: noop, info: noop,
      warn: (...a: any[]) => { const t = fmt(a); self.logger.debug(`[baileys] ${t}`); self.noteInternalError(t); },
      error: (...a: any[]) => { const t = fmt(a); self.logger.debug(`[baileys-err] ${t}`); self.noteInternalError(t); },
      fatal: (...a: any[]) => self.logger.warn(`[baileys-fatal] ${fmt(a)}`),
      child: () => l,
    };
    return l;
  }

  /** Üst üste gönderim-onay/init hatası = soket bozuk ama "bağlı" görünüyor
   *  (2026-06-10: QR sonrası init queries düştü, mesajlar "gönderildi" ama
   *  ulaşmadı). Kendi kendine iyileşme: soketi TAZELE (oturum korunur, QR yok). */
  private ackErrorCount = 0;
  private lastSelfHealAt = 0;
  private noteInternalError(text: string) {
    if (!/received error in ack|unexpected error in 'init queries'/i.test(text)) return;
    this.ackErrorCount++;
    if (this.ackErrorCount < 2) return;
    const now = Date.now();
    if (now - this.lastSelfHealAt < 10 * 60_000) return; // en çok 10 dk'da bir
    this.lastSelfHealAt = now;
    this.ackErrorCount = 0;
    for (const [tenantId, s] of this.sessions) {
      this.logger.warn(`[Baileys] tenant=${tenantId} gönderim onay hataları birikti — soket tazeleniyor (oturum korunur, QR gerekmez)`);
      try { s.sock?.end?.(undefined); } catch { /* close handler yeniden bağlar */ }
    }
  }

  /** Bağlantıyı başlat (kayıtlı oturum varsa QR'sız bağlanır, yoksa QR üretir). */
  async connect(tenantId: string): Promise<{ started: boolean; alreadyConnected?: boolean }> {
    if (this.shuttingDown) return { started: false };
    this.startWatchdog();
    this.intentionalLogoutTenants.delete(tenantId);
    this.clearReconnectTimer(tenantId);
    const existing = this.sessions.get(tenantId);
    if (existing?.connected) return { started: false, alreadyConnected: true };
    if (existing?.connecting) return { started: true };

    const b = await this.baileys();
    const makeWASocket = b.makeWASocket || b.default?.default || b.default;
    if (typeof makeWASocket !== 'function') {
      this.logger.error('[Baileys] makeWASocket bulunamadı (modül export şekli beklenmedik)');
      return { started: false };
    }
    const fetchLatestBaileysVersion = b.fetchLatestBaileysVersion || b.default?.fetchLatestBaileysVersion;
    const makeCacheableSignalKeyStore = b.makeCacheableSignalKeyStore || b.default?.makeCacheableSignalKeyStore;
    const DisconnectReason = b.DisconnectReason || b.default?.DisconnectReason;

    const auth = await useDBAuthState(this.prisma, tenantId, b);
    const logger = this.makeLogger();
    let version: any = undefined;
    try { version = (await fetchLatestBaileysVersion())?.version; } catch { /* default sürüm */ }

    const sock = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['Moren Portal', 'Chrome', '1.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    const session: Session = {
      tenantId, sock, auth, qr: null, connected: false, connecting: true, startedAt: Date.now(),
      // Restart sonrası gönderim bloklanmasın diye kalıcı LID→telefon eşlemesini geri yükle.
      lidToPhone: new Map(Object.entries(auth.getLidMap() || {})),
    };
    this.sessions.set(tenantId, session);

    sock.ev.on('creds.update', () => { auth.saveCreds().catch(() => {}); });

    const rememberLidMapping = async (lidJid?: string | null, phoneJid?: string | null) => {
      const lid = this.jidDigits(lidJid || '');
      const phone = this.jidDigits(phoneJid || '');
      if (!lid || !phone || lid === phone) return;
      session.lidToPhone.set(lid, phone);
      auth.saveLidMapping(lid, phone).catch(() => {}); // kalıcı yaz (restart sonrası korunur)
      this.logger.log(`[Baileys] LID telefon eslesmesi alindi: tenant=${tenantId} lid=${lid} phone=${phone}`);
      await this.lidMappingHandler?.(tenantId, lid, phone).catch((e: any) =>
        this.logger.warn(`[Baileys] LID eslesmesi islenemedi tenant=${tenantId}: ${e?.message || e}`));
    };

    sock.ev.on('chats.phoneNumberShare', (evt: any) => {
      rememberLidMapping(evt?.lid, evt?.jid).catch(() => {});
    });

    sock.ev.on('contacts.upsert', (items: any[]) => {
      for (const item of items || []) {
        rememberLidMapping(item?.lid, item?.jid || item?.id).catch(() => {});
      }
    });

    sock.ev.on('contacts.update', (items: any[]) => {
      for (const item of items || []) {
        rememberLidMapping(item?.lid, item?.jid || item?.id).catch(() => {});
      }
    });

    sock.ev.on('presence.update', (evt: any) => {
      try { this.handlePresenceUpdate(evt, session); } catch { /* ignore transient presence payloads */ }
    });

    sock.ev.on('messages.update', (items: any[]) => {
      try { this.handleMessageUpdates(items, session); } catch { /* ignore transient receipt payloads */ }
    });

    sock.ev.on('message-receipt.update', (items: any[]) => {
      try { this.handleMessageReceipts(items, session); } catch { /* ignore transient receipt payloads */ }
    });

    sock.ev.on('connection.update', (u: any) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        session.qr = qr;
        this.logger.log(`[Baileys] tenant=${tenantId} QR üretildi (okutulmayı bekliyor)`);
      }
      if (connection === 'open') {
        session.connected = true;
        session.connecting = false;
        session.qr = null;
        session.lastError = undefined;
        this.lastErrors.delete(tenantId);
        this.reconnectAttempts.delete(tenantId);
        this.clearReconnectTimer(tenantId);
        this.ackErrorCount = 0; // taze soket — gönderim hata sayacı sıfır
        this.logger.log(`[Baileys] tenant=${tenantId} BAĞLANDI`);
      }
      if (connection === 'close') {
        session.connected = false;
        session.connecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason?.loggedOut;
        const closeError = lastDisconnect?.error?.message || `kapandı (${statusCode})`;
        session.lastError = closeError;
        this.lastErrors.set(tenantId, closeError);
        this.sessions.delete(tenantId);
        // Süreç kapanıyor (dağıtım/SIGTERM) → ne sil ne yeniden bağlan.
        if (this.shuttingDown) return;
        // ÇAKIŞMA (conflict/replaced): dağıtımda eski+yeni kopya aynı oturuma
        // bağlandı, WhatsApp birini düşürdü. Bu KALICI ÇIKIŞ DEĞİLDİR — oturum
        // SİLİNMEZ; diğer kopya ölünce kayıtlı oturumla geri bağlanılır.
        // (2026-06-10 vakası: "Stream Errored (conflict)" loggedOut sayılıp
        // creds silindi → QR'a düştü, mesajlar ulaşmadı.)
        const conflict = /conflict|replaced/i.test(String(closeError))
          || statusCode === DisconnectReason?.connectionReplaced;
        this.logger.warn(`[Baileys] tenant=${tenantId} bağlantı kapandı: ${session.lastError} loggedOut=${loggedOut} conflict=${conflict}`);
        if (conflict && !this.intentionalLogoutTenants.has(tenantId)) {
          this.scheduleReconnect(tenantId, closeError, 20_000); // eski kopyanın ölmesini bekle
        } else if (loggedOut || this.intentionalLogoutTenants.has(tenantId)) {
          // Telefondan çıkış yapılmış → oturumu temizle, yeniden QR gerekir.
          auth.clear().catch(() => {});
        } else {
          // Geçici kopma → kayıtlı oturumla otomatik yeniden bağlan (QR gerekmez).
          this.scheduleReconnect(tenantId, closeError);
        }
      }
    });

    sock.ev.on('messages.upsert', async (evt: any) => {
      if (evt?.type !== 'notify') return;
      for (const m of evt.messages || []) {
        try { await this.handleIncoming(m, session); } catch (e: any) {
          this.logger.warn(`[Baileys] gelen mesaj işlenemedi: ${e?.message || e}`);
        }
      }
    });

    return { started: true };
  }

  private async handleIncoming(m: any, session: Session): Promise<void> {
    if (!m?.message || m.key?.fromMe) return;
    const jid: string = m.key?.remoteJid || '';
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return; // grup/durum atla
    const from = this.senderPhoneForMessage(m, jid, session);
    if (!from) return;
    const remoteLid = String(jid || '').includes('@lid') ? this.jidDigits(jid) : '';
    if (remoteLid && remoteLid !== from) {
      session.lidToPhone.set(remoteLid, from);
      session.auth.saveLidMapping(remoteLid, from).catch(() => {}); // kalıcı yaz
      this.lidMappingHandler?.(session.tenantId, remoteLid, from).catch((e: any) =>
        this.logger.warn(`[Baileys] LID eslesmesi mesajdan islenemedi tenant=${session.tenantId}: ${e?.message || e}`));
    }

    const msg = m.message;
    const text =
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      msg.documentMessage?.caption ||
      '';

    let media: BaileysInbound['media'];
    if (msg.imageMessage) media = { kind: 'image', mimeType: msg.imageMessage.mimetype, caption: msg.imageMessage.caption };
    else if (msg.documentMessage) media = { kind: 'document', mimeType: msg.documentMessage.mimetype, filename: msg.documentMessage.fileName, caption: msg.documentMessage.caption };
    else if (msg.audioMessage) media = { kind: 'audio', mimeType: msg.audioMessage.mimetype };
    else if (msg.videoMessage) media = { kind: 'video', mimeType: msg.videoMessage.mimetype, caption: msg.videoMessage.caption };

    let finalText = text;
    if (!finalText && media) {
      const label = media.kind === 'image' ? 'Görsel' : media.kind === 'document' ? 'Belge/PDF'
        : media.kind === 'audio' ? 'Ses kaydı' : media.kind === 'video' ? 'Video' : 'Medya';
      const detail = [media.filename, media.caption].filter(Boolean).join(' - ');
      finalText = detail ? `[${label}] ${detail}` : `[${label} mesajı]`;
    }
    if (!finalText) return;
    if (!this.inboundHandler) {
      this.logger.warn('[Baileys] inboundHandler kayıtlı değil, mesaj düştü');
      return;
    }
    await this.inboundHandler({ from, text: finalText, id: m.key?.id, replyTo: jid, media });
  }

  private jidDigits(jid: string): string {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  }

  private senderPhoneForMessage(m: any, remoteJid: string, session: Session): string {
    const key = m?.key || {};
    const candidates = [
      key.senderPn,
      key.participantPn,
      remoteJid,
      key.senderLid,
      key.participantLid,
    ];
    for (const candidate of candidates) {
      const digits = this.jidDigits(candidate || '');
      if (!digits) continue;
      if (String(candidate || '').includes('@lid')) {
        const mapped = session.lidToPhone.get(digits);
        if (mapped) return mapped;
        continue;
      }
      return digits;
    }
    return this.jidDigits(remoteJid);
  }

  /** Portal için durum + QR (data URL). */
  private presenceKey(tenantId: string, value?: string | null): string {
    return `${tenantId}:${String(value || '').trim()}`;
  }

  private deliveryKey(tenantId: string, messageId?: string | null): string {
    return `${tenantId}:${String(messageId || '').trim()}`;
  }

  private storePresence(session: Session, rawTarget: string, snapshot: BaileysPresenceSnapshot) {
    const raw = String(rawTarget || '').trim();
    const digits = this.jidDigits(raw);
    const targets = new Set<string>();
    if (raw) targets.add(raw);
    if (digits) {
      targets.add(digits);
      targets.add(`${digits}@s.whatsapp.net`);
    }
    if (raw.includes('@lid') && digits) {
      const mapped = session.lidToPhone.get(digits);
      if (mapped) {
        targets.add(mapped);
        targets.add(`${mapped}@s.whatsapp.net`);
      }
    }
    const live = snapshot.status === 'online' || snapshot.status === 'typing' || snapshot.status === 'recording';
    const expiresAt = Date.now() + (live ? 75_000 : 5 * 60_000);
    for (const target of targets) {
      this.presences.set(this.presenceKey(session.tenantId, target), { ...snapshot, expiresAt });
    }
  }

  private handlePresenceUpdate(evt: any, session: Session) {
    const id = String(evt?.id || evt?.from || evt?.jid || '').trim();
    if (!id || id.endsWith('@g.us') || id === 'status@broadcast') return;
    const presences = evt?.presences && typeof evt.presences === 'object' ? Object.values(evt.presences) : [];
    const first: any = presences[0] || evt;
    const rawState = String(first?.lastKnownPresence || first?.presence || evt?.lastKnownPresence || '').trim();
    const status = this.normalizePresenceStatus(rawState);
    const lastSeen = Number(first?.lastSeen || evt?.lastSeen || 0);
    const snapshot: BaileysPresenceSnapshot = {
      status,
      label: this.presenceLabel(status, lastSeen || null),
      at: new Date().toISOString(),
      lastSeenAt: lastSeen ? new Date(lastSeen * 1000).toISOString() : null,
    };
    this.storePresence(session, id, snapshot);
  }

  private normalizePresenceStatus(raw: string): BaileysPresenceSnapshot['status'] {
    const value = raw.toLowerCase();
    if (value === 'composing') return 'typing';
    if (value === 'recording') return 'recording';
    if (value === 'available') return 'online';
    if (value === 'paused') return 'paused';
    if (value === 'unavailable') return 'offline';
    return 'unknown';
  }

  private presenceLabel(status: BaileysPresenceSnapshot['status'], lastSeen: number | null): string {
    if (status === 'typing') return 'yaziyor...';
    if (status === 'recording') return 'ses kaydediyor...';
    if (status === 'online') return 'cevrimici';
    if (status === 'paused') return 'az once aktifti';
    if (status === 'offline' && lastSeen) return 'son gorulme alindi';
    return 'durum bilinmiyor';
  }

  async presenceFor(tenantId: string, phoneOrJid?: string | null): Promise<BaileysPresenceSnapshot | null> {
    const raw = String(phoneOrJid || '').trim();
    if (!raw) return null;
    const digits = this.jidDigits(raw);
    const candidates = [raw, digits, digits ? `${digits}@s.whatsapp.net` : ''].filter(Boolean);
    for (const candidate of candidates) {
      const key = this.presenceKey(tenantId, candidate);
      const value = this.presences.get(key);
      if (!value) continue;
      if (value.expiresAt < Date.now()) {
        this.presences.delete(key);
        continue;
      }
      const { expiresAt: _expiresAt, ...snapshot } = value;
      return snapshot;
    }
    return null;
  }

  private storeDelivery(tenantId: string, messageId: string | null | undefined, status: BaileysDeliverySnapshot['status']) {
    const id = String(messageId || '').trim();
    if (!id) return;
    const current = this.deliveries.get(this.deliveryKey(tenantId, id));
    const rank: Record<BaileysDeliverySnapshot['status'], number> = {
      pending: 0,
      sent: 1,
      delivered: 2,
      read: 3,
      played: 4,
      failed: 5,
    };
    if (current && rank[current.status] > rank[status] && current.status !== 'failed') return;
    this.deliveries.set(this.deliveryKey(tenantId, id), {
      status,
      at: new Date().toISOString(),
      expiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
    });
  }

  private handleMessageUpdates(items: any[], session: Session) {
    for (const item of items || []) {
      const id = item?.key?.id || item?.id;
      if (!id) continue;
      const status = this.normalizeDeliveryStatus(item?.update?.status ?? item?.status);
      if (status) this.storeDelivery(session.tenantId, id, status);
    }
  }

  private handleMessageReceipts(items: any[], session: Session) {
    for (const item of items || []) {
      const id = item?.key?.id || item?.messageId || item?.id;
      const receipt = item?.receipt || item;
      let status: BaileysDeliverySnapshot['status'] | null = null;
      if (receipt?.readTimestamp || receipt?.read) status = 'read';
      else if (receipt?.deliveryTimestamp || receipt?.delivered || receipt?.receiptTimestamp) status = 'delivered';
      if (status) this.storeDelivery(session.tenantId, id, status);
    }
  }

  private normalizeDeliveryStatus(raw: any): BaileysDeliverySnapshot['status'] | null {
    if (raw === undefined || raw === null) return null;
    const value = String(raw).toLowerCase();
    if (value === '4' || value.includes('read')) return 'read';
    if (value === '3' || value.includes('delivery')) return 'delivered';
    if (value === '2' || value.includes('server')) return 'sent';
    if (value === '1' || value.includes('pending')) return 'pending';
    if (value === '0' || value.includes('error')) return 'failed';
    if (value === '5' || value.includes('played')) return 'played';
    return null;
  }

  messageDelivery(tenantId: string, messageId?: string | null): BaileysDeliverySnapshot | null {
    const id = String(messageId || '').trim();
    if (!id) return null;
    const key = this.deliveryKey(tenantId, id);
    const value = this.deliveries.get(key);
    if (!value) return null;
    if (value.expiresAt < Date.now()) {
      this.deliveries.delete(key);
      return null;
    }
    const { expiresAt: _expiresAt, ...snapshot } = value;
    return snapshot;
  }

  async getStatus(tenantId: string): Promise<{
    provider: 'baileys'; connected: boolean; connecting: boolean; hasQr: boolean; qrDataUrl: string | null; error?: string;
  }> {
    const s = this.sessions.get(tenantId);
    let qrDataUrl: string | null = null;
    if (s?.qr) {
      try { qrDataUrl = await QRCode.toDataURL(s.qr, { margin: 1, width: 280 }); } catch { qrDataUrl = null; }
    }
    return {
      provider: 'baileys',
      connected: Boolean(s?.connected),
      connecting: Boolean(s?.connecting),
      hasQr: Boolean(s?.qr),
      qrDataUrl,
      error: s?.lastError || this.lastErrors.get(tenantId),
    };
  }

  /** Kayıtlı oturum DB'de var mı? (deploy sonrası otomatik bağlanmak için) */
  async hasStoredSession(tenantId: string): Promise<boolean> {
    const row = await (this.prisma as any).integrationConnection
      .findUnique({ where: { tenantId_provider: { tenantId, provider: BAILEYS_PROVIDER } } })
      .catch(() => null);
    return Boolean((row?.config as any)?.credsJson);
  }

  isConnected(tenantId: string): boolean {
    return Boolean(this.sessions.get(tenantId)?.connected);
  }

  async ensureConnected(tenantId: string, timeoutMs = 15_000): Promise<boolean> {
    if (this.isConnected(tenantId)) return true;
    const hasStored = await this.hasStoredSession(tenantId).catch(() => false);
    if (!hasStored) return false;

    await this.connect(tenantId).catch((e: any) => {
      const message = e?.message || String(e);
      this.lastErrors.set(tenantId, message);
      this.logger.warn(`[Baileys] tenant=${tenantId} reconnect on send failed: ${message}`);
    });

    const started = Date.now();
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    while (Date.now() - started < timeoutMs) {
      const session = this.sessions.get(tenantId);
      if (session?.connected) return true;
      if (session?.qr) return false;
      await wait(500);
    }
    return this.isConnected(tenantId);
  }

  async logout(tenantId: string): Promise<void> {
    this.intentionalLogoutTenants.add(tenantId);
    this.clearReconnectTimer(tenantId);
    const s = this.sessions.get(tenantId);
    try { await s?.sock?.logout?.(); } catch { /* ignore */ }
    try { s?.sock?.end?.(undefined); } catch { /* ignore */ }
    this.sessions.delete(tenantId);
    const b = await this.baileys().catch(() => null);
    if (b) {
      const auth = await useDBAuthState(this.prisma, tenantId, b).catch(() => null);
      await auth?.clear().catch(() => {});
    }
    this.logger.log(`[Baileys] tenant=${tenantId} çıkış yapıldı, oturum temizlendi`);
  }

  private clearReconnectTimer(tenantId: string) {
    const timer = this.reconnectTimers.get(tenantId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(tenantId);
  }

  private scheduleReconnect(tenantId: string, reason?: string, minDelayMs = 0) {
    if (this.shuttingDown) return;
    if (this.intentionalLogoutTenants.has(tenantId)) return;
    if (this.reconnectTimers.has(tenantId)) return;
    const attempt = (this.reconnectAttempts.get(tenantId) || 0) + 1;
    this.reconnectAttempts.set(tenantId, attempt);
    const delay = Math.max(minDelayMs, Math.min(300_000, 3_000 * Math.pow(2, Math.min(attempt - 1, 6))));
    this.logger.warn(`[Baileys] tenant=${tenantId} ${Math.round(delay / 1000)} sn sonra yeniden baglanacak (deneme ${attempt})${reason ? `: ${reason}` : ''}`);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(tenantId);
      this.connect(tenantId).catch((e: any) => {
        const message = e?.message || String(e);
        this.lastErrors.set(tenantId, message);
        this.logger.warn(`[Baileys] tenant=${tenantId} otomatik yeniden baglanma basarisiz: ${message}`);
        this.scheduleReconnect(tenantId, message);
      });
    }, delay);
    (timer as any).unref?.();
    this.reconnectTimers.set(tenantId, timer);
  }

  private startWatchdog() {
    if (this.watchdogTimer) return;
    const timer = setInterval(() => {
      this.ensureStoredSessionsConnected().catch((e: any) =>
        this.logger.warn(`[Baileys] watchdog hata: ${e?.message || e}`));
    }, 60_000);
    (timer as any).unref?.();
    this.watchdogTimer = timer;
  }

  private async ensureStoredSessionsConnected() {
    const rows = await (this.prisma as any).integrationConnection.findMany({
      where: { provider: BAILEYS_PROVIDER },
      select: { tenantId: true, config: true },
    }).catch(() => []);
    for (const row of rows || []) {
      if (this.intentionalLogoutTenants.has(row.tenantId)) continue;
      if (!(row?.config as any)?.credsJson) continue;
      const session = this.sessions.get(row.tenantId);
      if (session?.connected) continue;
      if (session?.connecting && Date.now() - session.startedAt < 90_000) continue;
      if (session?.connecting) {
        this.logger.warn(`[Baileys] tenant=${row.tenantId} baglanti 90 sn icinde acilmadi, oturum yeniden kuruluyor`);
        try { session.sock?.end?.(undefined); } catch { /* ignore */ }
        this.sessions.delete(row.tenantId);
      }
      if (!this.reconnectTimers.has(row.tenantId)) this.scheduleReconnect(row.tenantId, 'watchdog');
    }
  }

  async profilePictureUrl(tenantId: string, phoneOrJid?: string | null): Promise<string | null> {
    const session = this.sessions.get(tenantId);
    if (!session?.connected || !session.sock || !phoneOrJid) return null;
    try {
      return await session.sock.profilePictureUrl(this.toJid(phoneOrJid), 'image');
    } catch {
      return null;
    }
  }

  private toJid(phone: string): string {
    const raw = String(phone || '').trim();
    if (raw.includes('@')) return raw;
    const digits = raw.replace(/[^\d]/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  private isLidTarget(value?: string | null): boolean {
    const raw = String(value || '');
    const digits = this.jidDigits(raw);
    return raw.includes('@lid') || (digits.startsWith('111') && digits.length >= 14);
  }

  private toSendJid(session: Session, target: string): string | null {
    const raw = String(target || '').trim();
    const digits = this.jidDigits(raw);
    if (!digits) return null;
    if (this.isLidTarget(raw)) {
      const mapped = session.lidToPhone.get(digits);
      return mapped ? `${mapped}@s.whatsapp.net` : null;
    }
    if (raw.includes('@')) return raw;
    return `${digits}@s.whatsapp.net`;
  }

  /**
   * İnsan gibi tempo: "yazıyor…" göstergesi + mesaj uzunluğuyla orantılı kısa
   * gecikme. Cevabın anında/robotik düşmesini önler. MOREN_BOT_TYPING=0 ile kapatılır.
   */
  private async humanPace(sock: any, jid: string, text: string) {
    if (process.env.MOREN_BOT_TYPING === '0') return;
    try {
      await sock.sendPresenceUpdate('composing', jid);
      // Cevap zaten AI gecikmesiyle üretiliyor; gönderimden önce EK yapay bekleme
      // artık varsayılan KAPALI (base=0, perChar=0) — boşuna gecikme yapmasın.
      // Eski "insan temposu" davranışı env ile geri açılır:
      // MOREN_BOT_TYPING_BASE_MS=800 MOREN_BOT_TYPING_PER_CHAR_MS=35 MOREN_BOT_TYPING_MAX_MS=4500
      const len = (text || '').length;
      const baseMs = Number(process.env.MOREN_BOT_TYPING_BASE_MS ?? 0) || 0;
      const perCharMs = Number(process.env.MOREN_BOT_TYPING_PER_CHAR_MS ?? 0) || 0;
      const ms = Math.min(
        Number(process.env.MOREN_BOT_TYPING_MAX_MS || 1200),
        baseMs + len * perCharMs,
      );
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      await sock.sendPresenceUpdate('paused', jid);
    } catch { /* presence başarısızsa sorun değil */ }
  }

  /**
   * İşlem sürerken (AI cevabı üretilirken) telefonda "yazıyor…" göstergesini aç/kapat.
   * Gelen mesajdan HEMEN sonra on=true ile çağrılır, cevap hazır olunca on=false.
   * Amaç: kullanıcı 10-20 sn boş ekrana bakıp "cevap gelmiyor" sanmasın.
   * MOREN_BOT_TYPING=0 ile tümüyle kapatılır.
   */
  async setTyping(tenantId: string, phone: string, on: boolean): Promise<void> {
    if (process.env.MOREN_BOT_TYPING === '0') return;
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) return;
    try {
      const jid = this.toSendJid(s, phone);
      if (!jid) return;
      await s.sock.sendPresenceUpdate(on ? 'composing' : 'paused', jid);
    } catch { /* presence başarısızsa sorun değil */ }
  }

  /** Düz metin gönder. */
  private async refreshSignalSession(sock: any, jid: string) {
    try {
      await sock.assertSessions?.([jid], true);
    } catch (e: any) {
      this.logger.warn(`[Baileys] signal oturumu tazelenemedi jid=${this.maskTarget(jid)}: ${e?.message || e}`);
    }
  }

  async sendTextDetailed(tenantId: string, phone: string, text: string): Promise<BaileysSendResult> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) {
      this.logger.warn(`[Baileys] tenant=${tenantId} bagli degil, mesaj gonderilemedi`);
      return { ok: false, error: 'QR WhatsApp oturumu bagli degil.' };
    }
    try {
      const jid = this.toSendJid(s, phone);
      if (!jid) {
        const error = 'WhatsApp LID adresi gercek telefon numarasina cozumlenemedi; bekleyen mesaj olusmamasi icin gonderim durduruldu.';
        this.logger.warn(`[Baileys] tenant=${tenantId} LID hedef cozumlenemedi target=${this.maskTarget(phone)}`);
        return { ok: false, error };
      }
      await this.humanPace(s.sock, jid, text);
      await this.refreshSignalSession(s.sock, jid);
      const sent = await s.sock.sendMessage(jid, { text });
      this.storeDelivery(tenantId, sent?.key?.id, 'sent');
      this.logger.log(`[Baileys] tenant=${tenantId} mesaj gonderildi target=${this.maskTarget(phone)} jid=${this.maskTarget(jid)} id=${sent?.key?.id || 'unknown'}`);
      return { ok: true, providerMessageId: sent?.key?.id };
    } catch (e: any) {
      this.logger.error(`[Baileys] gonderim hatasi ${phone}: ${e?.message || e}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async sendText(tenantId: string, phone: string, text: string): Promise<boolean> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) {
      this.logger.warn(`[Baileys] tenant=${tenantId} bağlı değil, mesaj gönderilemedi`);
      return false;
    }
    try {
      const jid = this.toSendJid(s, phone);
      if (!jid) {
        this.logger.warn(`[Baileys] tenant=${tenantId} LID hedef cozumlenemedi target=${this.maskTarget(phone)}`);
        return false;
      }
      await this.humanPace(s.sock, jid, text);
      await this.refreshSignalSession(s.sock, jid);
      const sent = await s.sock.sendMessage(jid, { text });
      this.storeDelivery(tenantId, sent?.key?.id, 'sent');
      this.logger.log(`[Baileys] tenant=${tenantId} mesaj gonderildi target=${this.maskTarget(phone)} jid=${this.maskTarget(jid)} id=${sent?.key?.id || 'unknown'}`);
      return true;
    } catch (e: any) {
      this.logger.error(`[Baileys] gönderim hatası ${phone}: ${e?.message || e}`);
      return false;
    }
  }

  /** Medya gönder (URL'den indirip buffer olarak). */
  async sendMediaDetailed(
    tenantId: string,
    phone: string,
    media: { url: string; mimeType?: string | null; filename?: string | null; caption?: string | null },
  ): Promise<BaileysSendResult> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) return { ok: false, error: 'QR WhatsApp oturumu bagli degil.' };
    try {
      const res = await fetch(media.url);
      if (!res.ok) return { ok: false, error: `Medya indirilemedi (${res.status}).` };
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = String(media.mimeType || '').toLowerCase();
      const caption = media.caption ? String(media.caption).slice(0, 1024) : undefined;
      const jid = this.toSendJid(s, phone);
      if (!jid) {
        const error = 'WhatsApp LID adresi gercek telefon numarasina cozumlenemedi; bekleyen medya mesaji olusmamasi icin gonderim durduruldu.';
        this.logger.warn(`[Baileys] tenant=${tenantId} medya LID hedef cozumlenemedi target=${this.maskTarget(phone)}`);
        return { ok: false, error };
      }
      let payload: any;
      if (mime.startsWith('image/')) payload = { image: buffer, caption };
      else if (mime.startsWith('video/')) payload = { video: buffer, caption };
      else if (mime.startsWith('audio/')) payload = { audio: buffer, mimetype: mime || 'audio/ogg' };
      else payload = { document: buffer, mimetype: mime || 'application/octet-stream', fileName: media.filename || 'belge', caption };
      await this.refreshSignalSession(s.sock, jid);
      const sent = await s.sock.sendMessage(jid, payload);
      this.storeDelivery(tenantId, sent?.key?.id, 'sent');
      this.logger.log(`[Baileys] tenant=${tenantId} medya gonderildi target=${this.maskTarget(phone)} jid=${this.maskTarget(jid)} id=${sent?.key?.id || 'unknown'}`);
      return { ok: true, providerMessageId: sent?.key?.id };
    } catch (e: any) {
      this.logger.error(`[Baileys] medya gonderim hatasi ${phone}: ${e?.message || e}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async sendMedia(
    tenantId: string,
    phone: string,
    media: { url: string; mimeType?: string | null; filename?: string | null; caption?: string | null },
  ): Promise<boolean> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) return false;
    try {
      const res = await fetch(media.url);
      if (!res.ok) return false;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = String(media.mimeType || '').toLowerCase();
      const caption = media.caption ? String(media.caption).slice(0, 1024) : undefined;
      const jid = this.toSendJid(s, phone);
      if (!jid) {
        this.logger.warn(`[Baileys] tenant=${tenantId} medya LID hedef cozumlenemedi target=${this.maskTarget(phone)}`);
        return false;
      }
      let payload: any;
      if (mime.startsWith('image/')) payload = { image: buffer, caption };
      else if (mime.startsWith('video/')) payload = { video: buffer, caption };
      else if (mime.startsWith('audio/')) payload = { audio: buffer, mimetype: mime || 'audio/ogg' };
      else payload = { document: buffer, mimetype: mime || 'application/octet-stream', fileName: media.filename || 'belge', caption };
      await this.refreshSignalSession(s.sock, jid);
      const sent = await s.sock.sendMessage(jid, payload);
      this.storeDelivery(tenantId, sent?.key?.id, 'sent');
      this.logger.log(`[Baileys] tenant=${tenantId} medya gonderildi target=${this.maskTarget(phone)} jid=${this.maskTarget(jid)} id=${sent?.key?.id || 'unknown'}`);
      return true;
    } catch (e: any) {
      this.logger.error(`[Baileys] medya gönderim hatası ${phone}: ${e?.message || e}`);
      return false;
    }
  }

  private maskTarget(value: string): string {
    const raw = String(value || '');
    const [left, suffix] = raw.split('@');
    const digits = left.replace(/[^\d]/g, '');
    if (!digits) return raw ? '[jid]' : '';
    const masked = digits.length > 6
      ? `${digits.slice(0, 4)}...${digits.slice(-3)}`
      : `${digits.slice(0, 2)}...`;
    return suffix ? `${masked}@${suffix}` : masked;
  }
}
