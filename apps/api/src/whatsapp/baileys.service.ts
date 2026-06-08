import { Injectable, Logger } from '@nestjs/common';
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
export class BaileysService {
  private readonly logger = new Logger(BaileysService.name);
  private mod: any = null;
  private readonly sessions = new Map<string, Session>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly intentionalLogoutTenants = new Set<string>();
  private readonly lastErrors = new Map<string, string>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private inboundHandler: ((msg: BaileysInbound) => Promise<void>) | null = null;
  private lidMappingHandler: ((tenantId: string, lid: string, phone: string) => Promise<void>) | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
    const l: any = {
      level: 'silent',
      trace: noop, debug: noop, info: noop,
      warn: (...a: any[]) => self.logger.debug(`[baileys] ${a.map(String).join(' ')}`),
      error: (...a: any[]) => self.logger.debug(`[baileys-err] ${a.map(String).join(' ')}`),
      fatal: (...a: any[]) => self.logger.warn(`[baileys-fatal] ${a.map(String).join(' ')}`),
      child: () => l,
    };
    return l;
  }

  /** Bağlantıyı başlat (kayıtlı oturum varsa QR'sız bağlanır, yoksa QR üretir). */
  async connect(tenantId: string): Promise<{ started: boolean; alreadyConnected?: boolean }> {
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
      tenantId, sock, auth, qr: null, connected: false, connecting: true, startedAt: Date.now(), lidToPhone: new Map(),
    };
    this.sessions.set(tenantId, session);

    sock.ev.on('creds.update', () => { auth.saveCreds().catch(() => {}); });

    const rememberLidMapping = async (lidJid?: string | null, phoneJid?: string | null) => {
      const lid = this.jidDigits(lidJid || '');
      const phone = this.jidDigits(phoneJid || '');
      if (!lid || !phone || lid === phone) return;
      session.lidToPhone.set(lid, phone);
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
        this.logger.warn(`[Baileys] tenant=${tenantId} bağlantı kapandı: ${session.lastError} loggedOut=${loggedOut}`);
        this.sessions.delete(tenantId);
        if (loggedOut || this.intentionalLogoutTenants.has(tenantId)) {
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

  private scheduleReconnect(tenantId: string, reason?: string) {
    if (this.intentionalLogoutTenants.has(tenantId)) return;
    if (this.reconnectTimers.has(tenantId)) return;
    const attempt = (this.reconnectAttempts.get(tenantId) || 0) + 1;
    this.reconnectAttempts.set(tenantId, attempt);
    const delay = Math.min(300_000, 3_000 * Math.pow(2, Math.min(attempt - 1, 6)));
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
    if (digits.startsWith('111') && digits.length >= 14) return `${digits}@lid`;
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
      const len = (text || '').length;
      const ms = Math.min(
        Number(process.env.MOREN_BOT_TYPING_MAX_MS || 4500),
        800 + len * 35,
      );
      await new Promise((r) => setTimeout(r, ms));
      await sock.sendPresenceUpdate('paused', jid);
    } catch { /* presence başarısızsa sorun değil */ }
  }

  /** Düz metin gönder. */
  async sendText(tenantId: string, phone: string, text: string): Promise<boolean> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) {
      this.logger.warn(`[Baileys] tenant=${tenantId} bağlı değil, mesaj gönderilemedi`);
      return false;
    }
    try {
      const jid = this.toJid(phone);
      await this.humanPace(s.sock, jid, text);
      await s.sock.sendMessage(jid, { text });
      return true;
    } catch (e: any) {
      this.logger.error(`[Baileys] gönderim hatası ${phone}: ${e?.message || e}`);
      return false;
    }
  }

  /** Medya gönder (URL'den indirip buffer olarak). */
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
      const jid = this.toJid(phone);
      let payload: any;
      if (mime.startsWith('image/')) payload = { image: buffer, caption };
      else if (mime.startsWith('video/')) payload = { video: buffer, caption };
      else if (mime.startsWith('audio/')) payload = { audio: buffer, mimetype: mime || 'audio/ogg' };
      else payload = { document: buffer, mimetype: mime || 'application/octet-stream', fileName: media.filename || 'belge', caption };
      await s.sock.sendMessage(jid, payload);
      return true;
    } catch (e: any) {
      this.logger.error(`[Baileys] medya gönderim hatası ${phone}: ${e?.message || e}`);
      return false;
    }
  }
}
