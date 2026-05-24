import { Injectable, Logger, OnModuleInit, BadRequestException, Optional } from '@nestjs/common';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';

interface TenantStatus {
  connected: boolean;
  phone?: string;
  lastUpdate: Date;
  reconnectAttempts: number;
  lastError?: string;
  initStartedAt?: Date;
}

/**
 * WhatsApp QR (Baileys) servisi — mevcut Meta Cloud API'sinin YANINDA çalışır.
 *
 * Her tenant için ayrı socket + ayrı auth dizini. Multi-device protokolü WebSocket
 * üzerinden, browser gerekmez.
 *
 * KISITLAR (kullanıcıya açıkça söylenmeli):
 *  - WhatsApp Hizmet Şartları'na uymayan resmi olmayan yöntem. Toplu mesajda ban riski.
 *  - Auth state filesystem'de (./.wa-auth/<tenantId>/) — Railway ephemeral, her deploy
 *    sonrası yeniden QR okutmak gerekebilir. Production için kalıcı volume mount edilmeli
 *    (WHATSAPP_QR_AUTH_PATH env değişkeniyle yol verilebilir).
 *  - Telefonun zaman zaman online olması iyi (multi-device protokol uzun süreli offline'da
 *    cihazı silebilir).
 */
@Injectable()
export class WhatsAppQrService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppQrService.name);
  private sockets = new Map<string, WASocket>();
  private latestQr = new Map<string, string>();
  private statuses = new Map<string, TenantStatus>();
  private connectPromises = new Map<string, Promise<void>>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly eventBus?: AutomationEventBus,
  ) {}

  private getAuthPath(tenantId: string): string {
    const base = process.env.WHATSAPP_QR_AUTH_PATH || './.wa-auth';
    return path.join(base, tenantId);
  }

  async onModuleInit() {
    // Boot'ta mevcut auth dizinleri için yeniden bağlanmaya çalış
    const base = process.env.WHATSAPP_QR_AUTH_PATH || './.wa-auth';
    if (!fssync.existsSync(base)) return;
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const tenantId = entry.name;
        this.logger.log(`Boot: WhatsApp QR oturumu var, yeniden bağlanılıyor tenant=${tenantId}`);
        this.startConnection(tenantId).catch((err) =>
          this.logger.error(`Boot reconnect hata tenant=${tenantId}: ${err.message}`),
        );
      }
    } catch (err: any) {
      this.logger.warn(`WhatsApp QR boot taraması: ${err.message}`);
    }
  }

  /**
   * Yeni bir QR oturumu başlat veya mevcut oturuma yeniden bağlan.
   * Idempotent — aynı tenant için arka arkaya çağrılırsa tek socket olur.
   */
  async startConnection(tenantId: string): Promise<void> {
    if (this.sockets.has(tenantId)) {
      // Zaten var, hiçbir şey yapma
      return;
    }
    // Eş zamanlı çağrıları tek promise'e bağla
    const existing = this.connectPromises.get(tenantId);
    if (existing) return existing;

    const p = this.doConnect(tenantId).finally(() => {
      this.connectPromises.delete(tenantId);
    });
    this.connectPromises.set(tenantId, p);
    return p;
  }

  private async doConnect(tenantId: string): Promise<void> {
    // Başlangıç durumunu kaydet — UI hata olursa görebilsin
    this.statuses.set(tenantId, {
      connected: false,
      lastUpdate: new Date(),
      reconnectAttempts: this.statuses.get(tenantId)?.reconnectAttempts ?? 0,
      initStartedAt: new Date(),
    });

    let sock: WASocket;
    const authPath = this.getAuthPath(tenantId);
    try {
      await fs.mkdir(authPath, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const { version } = await fetchLatestBaileysVersion().catch((err) => {
        this.logger.warn(`fetchLatestBaileysVersion hata: ${err.message}, fallback kullanılıyor`);
        return { version: [2, 3000, 0] as any };
      });

      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Moren AI Otomasyon', 'Chrome', '120.0.0'],
        syncFullHistory: false,
      });

      // saveCreds'i sonra ekle (önce sock declared olmalı)
      sock.ev.on('creds.update', saveCreds);
    } catch (err: any) {
      this.logger.error(`baileys init hata tenant=${tenantId}: ${err.message}`, err.stack);
      const cur = this.statuses.get(tenantId);
      this.statuses.set(tenantId, {
        connected: false,
        lastUpdate: new Date(),
        reconnectAttempts: cur?.reconnectAttempts ?? 0,
        lastError: `Baileys başlatılamadı: ${err.message}`,
      });
      throw err;
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.latestQr.set(tenantId, qr);
        const cur = this.statuses.get(tenantId);
        this.statuses.set(tenantId, {
          connected: false,
          lastUpdate: new Date(),
          reconnectAttempts: cur?.reconnectAttempts ?? 0,
        });
        this.logger.log(`QR yenilendi tenant=${tenantId}`);
      }

      if (connection === 'open') {
        const phone = sock.user?.id?.split(':')[0] || sock.user?.id || '';
        this.statuses.set(tenantId, {
          connected: true,
          phone,
          lastUpdate: new Date(),
          reconnectAttempts: 0,
        });
        this.latestQr.delete(tenantId);
        this.logger.log(`Bağlandı tenant=${tenantId} phone=${phone}`);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        const cur = this.statuses.get(tenantId);
        const attempts = (cur?.reconnectAttempts ?? 0) + 1;
        this.statuses.set(tenantId, {
          connected: false,
          phone: cur?.phone,
          lastUpdate: new Date(),
          reconnectAttempts: attempts,
        });
        this.sockets.delete(tenantId);

        this.logger.warn(
          `Bağlantı koptu tenant=${tenantId} reason=${reason} attempts=${attempts} reconnect=${shouldReconnect}`,
        );

        // Otomasyon tetiği — "WhatsApp QR bağlantısı kopunca" event'ini dinleyenler tetiklenir
        if (this.eventBus) {
          try {
            this.eventBus.emit('WhatsApp.QrDisconnected', {
              tenantId,
              reason: String(reason || 'unknown'),
              attempts,
              loggedOut: reason === DisconnectReason.loggedOut,
              willReconnect: shouldReconnect && attempts < 10,
              previousPhone: cur?.phone || null,
            });
          } catch (err: any) {
            this.logger.warn(`Disconnect event emit hatası: ${err?.message || err}`);
          }
        }

        if (reason === DisconnectReason.loggedOut) {
          // Telefondan log out edildi — auth'u sil
          fs.rm(authPath, { recursive: true, force: true }).catch(() => {});
          this.statuses.delete(tenantId);
          this.latestQr.delete(tenantId);
        } else if (shouldReconnect && attempts < 10) {
          // Üstel backoff: 5s, 10s, 20s, 40s, 60s, ...
          const delay = Math.min(5000 * Math.pow(2, attempts - 1), 60000);
          setTimeout(() => {
            this.startConnection(tenantId).catch((e) =>
              this.logger.error(`Reconnect hata tenant=${tenantId}: ${e.message}`),
            );
          }, delay);
        } else if (attempts >= 10) {
          this.logger.error(
            `Yeniden bağlanma limitine ulaşıldı tenant=${tenantId}. Manuel müdahale gerek.`,
          );
        }
      }
    });

    // Gelen mesaj event'i — Otomasyon event bus'a yayınla
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const remoteJid = msg.key.remoteJid || '';
        // Sadece bireysel mesajlar (grup değil)
        if (!remoteJid.endsWith('@s.whatsapp.net')) continue;
        const from = remoteJid.replace('@s.whatsapp.net', '');
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';
        if (!text) continue;

        this.logger.debug(
          `Gelen WA QR mesajı tenant=${tenantId} from=${from} text=${text.slice(0, 80)}`,
        );

        // Mükellef arama + AutomationEventBus'a forward
        if (this.eventBus) {
          let taxpayerUnvan = '';
          let taxpayerId: string | undefined;
          let taxpayerVkn = '';
          if (this.prisma) {
            try {
              // Mevcut Meta bot ile aynı mantık — telefon numarasını normalize edip eşleştir
              const normalized = this.normalizePhoneSearch(from);
              const taxpayer = await this.prisma.taxpayer.findFirst({
                where: {
                  tenantId,
                  OR: [
                    { phone: { contains: normalized } },
                    { phones: { hasSome: [normalized] } },
                  ],
                },
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  companyName: true,
                  type: true,
                  taxNumber: true,
                },
              });
              if (taxpayer) {
                taxpayerId = taxpayer.id;
                taxpayerVkn = taxpayer.taxNumber ?? '';
                taxpayerUnvan =
                  taxpayer.type === 'TUZEL_KISI'
                    ? taxpayer.companyName || ''
                    : `${taxpayer.firstName ?? ''} ${taxpayer.lastName ?? ''}`.trim();
              }
            } catch (err: any) {
              this.logger.warn(`Mükellef arama hatası: ${err.message}`);
            }
          }

          this.eventBus.emit('WhatsApp.MessageReceived', {
            tenantId,
            taxpayerId,
            taxpayerUnvan: taxpayerUnvan || '(bilinmeyen numara)',
            taxpayerVkn,
            from,
            text,
            messageId: msg.key.id || undefined,
            source: 'qr', // Meta vs QR ayrımı
          });

          // Mükellef bulunduysa CommunicationLog'a da yaz ki "Gelen Mesajlar"
          // widget'ında görünsün (Meta webhook ile aynı tablo).
          if (this.prisma && taxpayerId) {
            try {
              await this.prisma.communicationLog.create({
                data: {
                  taxpayerId,
                  channel: 'WHATSAPP',
                  subject: 'WhatsApp QR gelen mesaj',
                  content: text.slice(0, 4000),
                  occurredAt: new Date(),
                },
              });
            } catch (err: any) {
              this.logger.warn(`CommunicationLog yazma hatası: ${err.message}`);
            }
          }
        }
      }
    });

    this.sockets.set(tenantId, sock);
  }

  /**
   * Oturumu kapat ve auth dosyalarını sil.
   */
  async disconnect(tenantId: string): Promise<void> {
    const sock = this.sockets.get(tenantId);
    if (sock) {
      try {
        await sock.logout();
      } catch (err: any) {
        this.logger.warn(`logout hata tenant=${tenantId}: ${err.message}`);
      }
      this.sockets.delete(tenantId);
    }
    this.statuses.delete(tenantId);
    this.latestQr.delete(tenantId);
    const authPath = this.getAuthPath(tenantId);
    await fs.rm(authPath, { recursive: true, force: true }).catch(() => {});
    this.logger.log(`Disconnected tenant=${tenantId}`);
  }

  /**
   * Mevcut bağlantı durumu — UI bunu polling ile çeker.
   */
  async getStatus(tenantId: string): Promise<{
    connected: boolean;
    phone?: string;
    qrDataUrl?: string;
    lastUpdate?: Date;
    reconnectAttempts?: number;
    lastError?: string;
    initSecondsAgo?: number;
  }> {
    const status = this.statuses.get(tenantId);
    const qr = this.latestQr.get(tenantId);

    if (status?.connected) {
      return {
        connected: true,
        phone: status.phone,
        lastUpdate: status.lastUpdate,
      };
    }

    const initSecondsAgo = status?.initStartedAt
      ? Math.floor((Date.now() - status.initStartedAt.getTime()) / 1000)
      : undefined;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      return {
        connected: false,
        qrDataUrl,
        lastUpdate: status?.lastUpdate,
        reconnectAttempts: status?.reconnectAttempts,
        initSecondsAgo,
      };
    }

    return {
      connected: false,
      lastUpdate: status?.lastUpdate,
      reconnectAttempts: status?.reconnectAttempts,
      lastError: status?.lastError,
      initSecondsAgo,
    };
  }

  /**
   * QR oturumu üzerinden mesaj gönder. Otomasyon dispatcher'ı çağırır.
   */
  async sendMessage(tenantId: string, phone: string, text: string): Promise<{ messageId?: string }> {
    const sock = this.sockets.get(tenantId);
    if (!sock || !this.statuses.get(tenantId)?.connected) {
      throw new BadRequestException(
        'WhatsApp QR oturumu aktif değil. Önce /panel/whatsapp-qr sayfasından QR kodu okutun.',
      );
    }

    const digits = phone.replace(/\D/g, '');
    if (!digits || digits.length < 8) {
      throw new BadRequestException(`Geçersiz telefon numarası: ${phone}`);
    }
    // 0 ile başlıyorsa Türkiye varsay
    let normalized = digits;
    if (normalized.startsWith('0')) normalized = '90' + normalized.slice(1);
    if (normalized.length === 10 && normalized.startsWith('5')) normalized = '90' + normalized;

    const jid = `${normalized}@s.whatsapp.net`;
    const result = await sock.sendMessage(jid, { text });
    return { messageId: result?.key?.id ?? undefined };
  }

  /**
   * Telefon numarasını arama formatına çevir (5XX9999999 gibi 10 haneli son ek).
   */
  private normalizePhoneSearch(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    // Türkiye numarası ise son 10 haneyi al (90 prefiks olmadan)
    if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  /**
   * Bir telefon numarasının WhatsApp'ta kayıtlı olup olmadığını doğrula.
   */
  async isOnWhatsApp(tenantId: string, phone: string): Promise<boolean> {
    const sock = this.sockets.get(tenantId);
    if (!sock || !this.statuses.get(tenantId)?.connected) return false;
    const digits = phone.replace(/\D/g, '');
    let normalized = digits;
    if (normalized.startsWith('0')) normalized = '90' + normalized.slice(1);
    try {
      const result = await sock.onWhatsApp(`${normalized}@s.whatsapp.net`);
      return Boolean(result?.[0]?.exists);
    } catch {
      return false;
    }
  }
}
