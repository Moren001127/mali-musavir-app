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
  media?: { kind: string; id?: string; mimeType?: string; filename?: string; caption?: string };
};

type Session = {
  sock: any;
  auth: DBAuthState;
  qr: string | null;
  connected: boolean;
  connecting: boolean;
  lastError?: string;
  startedAt: number;
};

// ESM-only Baileys'i CommonJS/webpack build'inde import etmek için: TS ve
// webpack'in import()'u require()'a çevirmesini engelleyen native import.
const nativeImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;

@Injectable()
export class BaileysService {
  private readonly logger = new Logger(BaileysService.name);
  private mod: any = null;
  private readonly sessions = new Map<string, Session>();
  private inboundHandler: ((msg: BaileysInbound) => Promise<void>) | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Bot controller, gelen mesajı handleMessage hattına vermek için bunu kaydeder. */
  setInboundHandler(fn: (msg: BaileysInbound) => Promise<void>) {
    this.inboundHandler = fn;
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
      sock, auth, qr: null, connected: false, connecting: true, startedAt: Date.now(),
    };
    this.sessions.set(tenantId, session);

    sock.ev.on('creds.update', () => { auth.saveCreds().catch(() => {}); });

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
        this.logger.log(`[Baileys] tenant=${tenantId} BAĞLANDI`);
      }
      if (connection === 'close') {
        session.connected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason?.loggedOut;
        session.lastError = lastDisconnect?.error?.message || `kapandı (${statusCode})`;
        this.logger.warn(`[Baileys] tenant=${tenantId} bağlantı kapandı: ${session.lastError} loggedOut=${loggedOut}`);
        this.sessions.delete(tenantId);
        if (loggedOut) {
          // Telefondan çıkış yapılmış → oturumu temizle, yeniden QR gerekir.
          auth.clear().catch(() => {});
        } else {
          // Geçici kopma → kayıtlı oturumla otomatik yeniden bağlan (QR gerekmez).
          setTimeout(() => this.connect(tenantId).catch(() => {}), 3000);
        }
      }
    });

    sock.ev.on('messages.upsert', async (evt: any) => {
      if (evt?.type !== 'notify') return;
      for (const m of evt.messages || []) {
        try { await this.handleIncoming(m); } catch (e: any) {
          this.logger.warn(`[Baileys] gelen mesaj işlenemedi: ${e?.message || e}`);
        }
      }
    });

    return { started: true };
  }

  private async handleIncoming(m: any): Promise<void> {
    if (!m?.message || m.key?.fromMe) return;
    const jid: string = m.key?.remoteJid || '';
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return; // grup/durum atla
    const from = jid.split('@')[0];
    if (!from) return;

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
    await this.inboundHandler({ from, text: finalText, id: m.key?.id, media });
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
      error: s?.lastError,
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

  private toJid(phone: string): string {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  /** Düz metin gönder. */
  async sendText(tenantId: string, phone: string, text: string): Promise<boolean> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) {
      this.logger.warn(`[Baileys] tenant=${tenantId} bağlı değil, mesaj gönderilemedi`);
      return false;
    }
    try {
      await s.sock.sendMessage(this.toJid(phone), { text });
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
