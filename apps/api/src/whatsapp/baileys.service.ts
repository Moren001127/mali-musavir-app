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
  /** Telefon(digits) → son gelen mesaj. 463 azaltma: cevabı buna ALINTILI gönder. */
  lastIncoming: Map<string, any>;
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
  /**
   * Gelen mesaj tekilleştirme (dedup). Baileys yeniden bağlanma / retry'de aynı
   * mesajı iki kez 'notify' verebiliyor → çift işleme + çift cevap olurdu.
   * key=`tenantId:messageId`, value=ilk görülme zamanı (ms). TTL aşınca temizlenir.
   */
  private readonly recentInboundIds = new Map<string, number>();
  private static readonly INBOUND_DEDUP_TTL_MS = 5 * 60 * 1000;

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

  /**
   * Gönderilen mesajların kısa süreli kaydı — 463 (reach-out timelock) ack
   * hatasında YENİDEN GÖNDERMEK için. id → { tenantId, jid, payload, tries }.
   */
  private readonly recentSends = new Map<string, { tenantId: string; jid: string; payload: any; tries: number; at: number }>();

  /**
   * Gönderilen mesajların PROTO içeriği — id → { message, at }. Baileys 7'nin
   * `getMessage` callback'i için ZORUNLU: alıcı bir mesajı çözemeyince WhatsApp
   * "tekrar gönder" (retry receipt) istiyor; Baileys o anda getMessage(id) ile
   * orijinal içeriği isteyip YENİDEN şifreleyip gönderiyor. Boş (undefined)
   * dönersek mesaj YENİDEN GÖNDERİLEMİYOR → alıcıya hiç ulaşmıyor (sessiz kayıp,
   * "timed out waiting for message"). Bu yüzden son gönderilenleri saklıyoruz.
   */
  private readonly sentMessageStore = new Map<string, { message: any; at: number }>();

  /**
   * Profil fotoğrafı cache'i — `tenant:digits` → { url, at }. Stale-while-revalidate:
   * kayıtlı URL anında döner (ekran boş/kilitli kalmaz), bayatsa arka planda
   * tazelenir (profil fotoğrafı DEĞİŞİMİ böyle yakalanır), tazeleme başarısızsa
   * eski korunur (kaybolmaz). 463/yorgun bağlantıda avatarların "kaybolması" bitti.
   */
  private readonly avatarCache = new Map<string, { url: string | null; at: number }>();
  // Durum (about/hakkında) metni cache'i — avatar ile aynı mantık: TTL + zaman sınırı + zarif düşüş.
  private readonly statusCache = new Map<string, { text: string | null; setAt: number | null; at: number }>();

  private rememberSend(tenantId: string, jid: string, payload: any, id?: string | null, message?: any) {
    if (!id) return;
    this.recentSends.set(id, { tenantId, jid, payload, tries: 0, at: Date.now() });
    if (this.recentSends.size > 300) {
      const cutoff = Date.now() - 5 * 60_000;
      for (const [k, v] of this.recentSends) if (v.at < cutoff) this.recentSends.delete(k);
    }
    if (message) {
      this.sentMessageStore.set(id, { message, at: Date.now() });
      if (this.sentMessageStore.size > 1000) {
        const cutoff = Date.now() - 60 * 60_000; // 1 saat: WhatsApp retry penceresi için yeterli
        for (const [k, v] of this.sentMessageStore) if (v.at < cutoff) this.sentMessageStore.delete(k);
        // Hâlâ büyükse en eskiyi at (FIFO güvencesi).
        while (this.sentMessageStore.size > 1000) {
          const oldest = this.sentMessageStore.keys().next().value;
          if (oldest === undefined) break;
          this.sentMessageStore.delete(oldest);
        }
      }
    }
  }

  /**
   * Baileys iç logger "received error in ack" yazınca tetiklenir. 463 =
   * NackCallerReachoutTimelocked (WhatsApp gönderim kilidi). KÖKTEN çözüm
   * Baileys'te yok (son kararlı 6.7.23 zaten kurulu; düzeltmeler kilidi
   * azaltıyor ama bitirmiyor). Pratik dengeleme:
   *  1) İlgili mesajı "teslim edilemedi" işaretle (portal yanlış "gönderildi"
   *     dememesi için — kullanıcı "portalda gönderildi ama bana ulaşmadı" dedi).
   *  2) Tek sefer GECİKMELİ yeniden gönder (kilit zaman-bazlı; ikinci deneme
   *     çoğu zaman geçer). ESKİ davranış (soketi kapat) YANLIŞTI: 463 soket
   *     bozukluğu değil, soketi kapatmak reconnect fırtınası yaratıp WhatsApp'ı
   *     daha çok kilitliyordu — kaldırıldı.
   */
  private noteInternalError(text: string) {
    if (!/received error in ack/i.test(text)) return;
    const id = text.match(/"id":"([^"]+)"/)?.[1];
    const code = text.match(/"error":"?(\d+)"?/)?.[1];
    if (!id) return;
    const rec = this.recentSends.get(id);
    if (rec) this.storeDelivery(rec.tenantId, id, 'failed');
    // 463 (reach-out timelock) = soğuk-temas kilidi. Kilit ZAMAN-BAZLI; her denemede
    // biraz daha geçer. Tek denemede vazgeçmek yerine KADEMELİ backoff ile birkaç kez
    // dene (varsayılan 3). İlk-mesaj (hiç yazmamış mükellef) gönderimi için kritik.
    const maxRetry = Math.max(1, Number(process.env.WHATSAPP_NACK_MAX_RETRY || 3));
    if (code !== '463' || !rec || rec.tries >= maxRetry) return;
    rec.tries++;
    const base = Number(process.env.WHATSAPP_NACK_RETRY_MS || 12000);
    const delay = base * rec.tries; // kademeli: 12s, 24s, 36s …
    const tries = rec.tries;
    const t = setTimeout(async () => {
      const s = this.sessions.get(rec.tenantId);
      if (!s?.connected || !s.sock) return;
      try {
        // Yeniden denemeden önce online görün + presence (soğuk-temas ısınması).
        try { await s.sock.sendPresenceUpdate('available'); await s.sock.presenceSubscribe(rec.jid); } catch { /* önemsiz */ }
        await this.refreshSignalSession(s.sock, rec.jid);
        const sent = await s.sock.sendMessage(rec.jid, rec.payload);
        this.rememberSend(rec.tenantId, rec.jid, rec.payload, sent?.key?.id, sent?.message);
        const nr = this.recentSends.get(String(sent?.key?.id || ''));
        if (nr) nr.tries = tries; // deneme sayacını taşı → backoff sürer, üst sınır korunur
        this.storeDelivery(rec.tenantId, sent?.key?.id, 'sent');
        this.logger.warn(`[Baileys] 463 sonrasi yeniden gonderildi (deneme ${tries}/${maxRetry}) id=${id} -> ${sent?.key?.id}`);
      } catch (e: any) {
        this.logger.warn(`[Baileys] 463 retry (deneme ${tries}) basarisiz id=${id}: ${e?.message || e}`);
      }
    }, delay);
    (t as any).unref?.();
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
      browser: ['Moren Portal', 'Chrome', '1.0'],
      syncFullHistory: false,
      // 463 (reach-out timelock) azaltma: hesabı "aktif/online" göster — pasif
      // companion cihazdan giden mesajlar daha çok kilitleniyordu.
      markOnlineOnConnect: true,
      // Baileys 7.x: alıcı mesajı çözemeyip "tekrar gönder" isteyince Baileys bu
      // callback'le orijinal içeriği isteyip YENİDEN gönderiyor. Boş dönersek mesaj
      // teslim EDİLEMİYOR (sessiz kayıp). Son gönderdiklerimizi saklayıp burada
      // veriyoruz → teslimat güvenilirliği artar.
      // (printQRInTerminal 7.x'te kaldırıldı; QR connection.update üzerinden alınıyor.)
      getMessage: async (key: any) => {
        const id = key?.id;
        return (id && this.sentMessageStore.get(id)?.message) || undefined;
      },
    });

    const session: Session = {
      tenantId, sock, auth, qr: null, connected: false, connecting: true, startedAt: Date.now(),
      // Restart sonrası gönderim bloklanmasın diye kalıcı LID→telefon eşlemesini geri yükle.
      lidToPhone: new Map(Object.entries(auth.getLidMap() || {})),
      lastIncoming: new Map(),
    };
    this.sessions.set(tenantId, session);

    // KESİN LID→telefon tohumu (env). Baileys bazı kişilerin gerçek numarasını
    // (senderPn) GÖNDERMİYOR → mesaj LID ile geliyor, owner tanınmıyor ve cevap
    // hedefi çözülemiyor (Baileys kendisi de o LID'in numarasını bilmiyor).
    // Bildiğimiz eşlemeleri env'den kesin olarak yükle:
    //   MOREN_WHATSAPP_LID_MAP="111171101278270:905350587475,LID2:TEL2"
    // Sonuç: gelen LID gerçek numaraya çözülür → owner normal yoldan tanınır +
    // cevap gerçek numaraya (sıcak kişi) gider.
    this.seedEnvLidMap(session);

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
        this.logger.log(`[Baileys] tenant=${tenantId} BAĞLANDI`);
        // Owner/personel numaralarının LID'ini Baileys'e sorup OTOMATİK eşle
        // (env ayarı gerekmez): Baileys gelen mesajda senderPn göndermeyince
        // mesaj LID ile düşüyor, owner tanınmıyordu. onWhatsApp numara→LID verir.
        this.resolveConfiguredLids(session).catch(() => {});
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

    // DEDUP: aynı mesaj iki kez gelirse (Baileys reconnect/retry) ikincisini at.
    const msgId: string = m.key?.id || '';
    if (msgId) {
      const dedupKey = `${session.tenantId}:${msgId}`;
      const now = Date.now();
      // Süresi dolmuş kayıtları ara sıra temizle (Map şişmesin).
      if (this.recentInboundIds.size > 1000) {
        for (const [k, ts] of this.recentInboundIds) {
          if (now - ts > BaileysService.INBOUND_DEDUP_TTL_MS) this.recentInboundIds.delete(k);
        }
      }
      const seenAt = this.recentInboundIds.get(dedupKey);
      if (seenAt !== undefined && now - seenAt < BaileysService.INBOUND_DEDUP_TTL_MS) {
        this.logger.debug?.(`[Baileys] yinelenen mesaj atlandı id=${msgId} tenant=${session.tenantId}`);
        return;
      }
      this.recentInboundIds.set(dedupKey, now);
    }
    let from = this.senderPhoneForMessage(m, jid, session);
    if (!from) return;

    // Baileys senderPn göndermeyip mesaj LID ile geldiyse (from = LID), Baileys'in
    // KENDİ LID↔telefon deposundan (signalRepository.lidMapping) gerçek numaraya çöz.
    // Bu owner için DE mükellefler için DE çalışır → herkes doğru tanınır.
    if (String(jid).includes('@lid') && this.jidDigits(jid) === from) {
      const resolved = await this.resolveIncomingLid(session, jid);
      if (resolved) from = resolved;
    }

    // 463 (reach-out timelock) AZALTMA: gelen mesajı OKUNDU işaretle + karşı
    // tarafın presence'ına abone ol. Bu, WhatsApp'a "aktif, karşılıklı sohbet"
    // sinyali verir; pasif/tek-yönlü bot algısını ve gönderim kilidini düşürür.
    if (process.env.MOREN_BOT_ACTIVE_SIGNALS !== '0') {
      try { if (m.key) await session.sock.readMessages([m.key]); } catch { /* önemsiz */ }
      try { await session.sock.presenceSubscribe(jid); } catch { /* önemsiz */ }
    }
    // Cevabı bu mesaja ALINTILI göndermek için sakla (463 reach-out azaltma).
    const fromDigits = String(from).replace(/[^\d]/g, '');
    if (fromDigits) {
      session.lastIncoming.set(fromDigits, m);
      if (session.lastIncoming.size > 200) {
        const oldest = session.lastIncoming.keys().next().value;
        if (oldest !== undefined) session.lastIncoming.delete(oldest);
      }
    }
    // LID↔telefon eşlemesini ÖĞREN: from gerçek telefona çözüldüyse, mesajdaki
    // TÜM LID kaynaklarını (remoteJid + key.senderLid + key.participantLid) o
    // telefona eşle → sonraki "yalnız LID" (senderPn'siz) mesajlar gerçek numaraya
    // çözülür (owner tanınır + cevap doğru hedefe gider). Baileys 7 LID-öncelikli
    // adresleme yaptığı için bu öğrenme kritik (eskiden yalnız remoteJid LID ise
    // öğreniliyordu; telefon-adresli ama LID taşıyan mesajlar kaçıyordu).
    const mkey: any = m.key || {};
    const lidSources = [
      String(jid || '').includes('@lid') ? this.jidDigits(jid) : '',
      this.jidDigits(mkey.senderLid || ''),
      this.jidDigits(mkey.participantLid || ''),
    ];
    for (const lid of lidSources) {
      if (!lid || lid === from || session.lidToPhone.get(lid) === from) continue;
      session.lidToPhone.set(lid, from);
      session.auth.saveLidMapping(lid, from).catch(() => {}); // kalıcı yaz
      this.lidMappingHandler?.(session.tenantId, lid, from).catch((e: any) =>
        this.logger.warn(`[Baileys] LID eslesmesi mesajdan islenemedi tenant=${session.tenantId}: ${e?.message || e}`));
    }

    // Sarmalanmış mesajları aç: kaybolan (ephemeral) ve tek-görüntüleme (viewOnce)
    // mesajlar gerçek içeriği iç katmanda taşır; açmazsak metin/medya boş görünüp
    // mesaj sessizce yutuluyordu.
    let msg = m.message;
    msg = msg.ephemeralMessage?.message
      || msg.viewOnceMessage?.message
      || msg.viewOnceMessageV2?.message
      || msg.viewOnceMessageV2Extension?.message
      || msg.documentWithCaptionMessage?.message
      || msg;

    const text =
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      msg.documentMessage?.caption ||
      // Buton/liste yanıtları: seçilen metin (eskiden okunmuyor, mesaj yutuluyordu).
      msg.buttonsResponseMessage?.selectedDisplayText ||
      msg.templateButtonReplyMessage?.selectedDisplayText ||
      msg.listResponseMessage?.title ||
      msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
      '';

    let media: BaileysInbound['media'];
    if (msg.imageMessage) media = { kind: 'image', mimeType: msg.imageMessage.mimetype, caption: msg.imageMessage.caption };
    else if (msg.documentMessage) media = { kind: 'document', mimeType: msg.documentMessage.mimetype, filename: msg.documentMessage.fileName, caption: msg.documentMessage.caption };
    else if (msg.audioMessage) media = { kind: 'audio', mimeType: msg.audioMessage.mimetype };
    else if (msg.videoMessage) media = { kind: 'video', mimeType: msg.videoMessage.mimetype, caption: msg.videoMessage.caption };
    else if (msg.stickerMessage) media = { kind: 'sticker', mimeType: msg.stickerMessage.mimetype };

    let finalText = text;
    if (!finalText && media) {
      const label = media.kind === 'image' ? 'Görsel' : media.kind === 'document' ? 'Belge/PDF'
        : media.kind === 'audio' ? 'Ses kaydı' : media.kind === 'video' ? 'Video'
        : media.kind === 'sticker' ? 'Çıkartma' : 'Medya';
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

  /**
   * Owner/personel numaralarının LID'ini Baileys'in KENDİ deposundan
   * (signalRepository.lidMapping.getLIDForPN) çözüp eşler — hiçbir env gerekmez.
   * Owner'a gönderim yaptığımız için Baileys PN→LID eşlemesini zaten biliyor.
   * Bağlantı açılınca bir kez çalışır. En iyi çaba: hata/zaman aşımı yutulur.
   */
  private async resolveConfiguredLids(session: Session) {
    const store: any = session.sock?.signalRepository?.lidMapping;
    if (!store?.getLIDForPN) {
      this.logger.log('[Baileys] signalRepository.lidMapping yok (surum farki), owner LID otomatik cozulemedi');
      return;
    }
    const phones = String(
      `${process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || ''},${process.env.MOREN_STAFF_WHATSAPP_PHONES || ''}`,
    )
      .split(',')
      .map((p) => this.jidDigits(p))
      .filter(Boolean);
    for (const phone of Array.from(new Set(phones))) {
      try {
        const lidJid = await Promise.race([
          store.getLIDForPN(`${phone}@s.whatsapp.net`),
          new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        const lid = this.jidDigits(lidJid || '');
        if (lid && lid !== phone) {
          if (session.lidToPhone.get(lid) !== phone) {
            session.lidToPhone.set(lid, phone);
            session.auth.saveLidMapping(lid, phone).catch(() => {});
            this.lidMappingHandler?.(session.tenantId, lid, phone).catch(() => {});
          }
          this.logger.log(`[Baileys] owner/personel PN->LID cozuldu: ${this.maskTarget(phone)} -> ${this.maskTarget(lid)}`);
        } else {
          this.logger.log(`[Baileys] getLIDForPN(${this.maskTarget(phone)}) bos dondu: ${JSON.stringify(lidJid)}`);
        }
      } catch (e: any) {
        this.logger.warn(`[Baileys] getLIDForPN(${this.maskTarget(phone)}) hata: ${e?.message || e}`);
      }
    }
  }

  /**
   * Gelen mesaj LID ile geldiyse (Baileys senderPn vermedi), Baileys'in KENDİ
   * deposundan (getPNForLID) gerçek numaraya çöz + eşlemeyi kalıcı kaydet.
   * Owner için de mükellefler için de çalışır.
   */
  private async resolveIncomingLid(session: Session, lidJid: string): Promise<string> {
    const lidDigits = this.jidDigits(lidJid);
    if (!lidDigits) return '';
    const cached = session.lidToPhone.get(lidDigits);
    if (cached) return cached;
    try {
      const store: any = session.sock?.signalRepository?.lidMapping;
      if (!store?.getPNForLID) return '';
      const pnJid = await Promise.race([
        store.getPNForLID(String(lidJid).includes('@') ? lidJid : `${lidDigits}@lid`),
        new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      const pn = this.jidDigits(pnJid || '');
      if (pn && pn !== lidDigits) {
        session.lidToPhone.set(lidDigits, pn);
        session.auth.saveLidMapping(lidDigits, pn).catch(() => {});
        this.lidMappingHandler?.(session.tenantId, lidDigits, pn).catch(() => {});
        this.logger.log(`[Baileys] gelen LID->telefon cozuldu: ${this.maskTarget(lidDigits)} -> ${this.maskTarget(pn)}`);
        return pn;
      }
      this.logger.log(`[Baileys] getPNForLID(${this.maskTarget(lidDigits)}) bos dondu`);
    } catch (e: any) {
      this.logger.warn(`[Baileys] getPNForLID hata: ${e?.message || e}`);
    }
    return '';
  }

  /**
   * env `MOREN_WHATSAPP_LID_MAP` ("lid:telefon,lid:telefon") → session.lidToPhone.
   * Baileys'in çözemediği LID'leri bizim bildiğimiz gerçek numaraya bağlar.
   */
  private seedEnvLidMap(session: Session) {
    const raw = String(process.env.MOREN_WHATSAPP_LID_MAP || '').trim();
    if (!raw) return;
    for (const pair of raw.split(',')) {
      const [lidRaw, phoneRaw] = String(pair || '').split(':');
      const lid = this.jidDigits(lidRaw || '');
      const phone = this.jidDigits(phoneRaw || '');
      if (!lid || !phone || lid === phone) continue;
      session.lidToPhone.set(lid, phone);
      session.auth.saveLidMapping(lid, phone).catch(() => {});
      this.logger.log(`[Baileys] env LID tohumu: ${this.maskTarget(lid)} -> ${this.maskTarget(phone)}`);
    }
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
    if (!phoneOrJid) return null;
    const key = `${tenantId}:${this.jidDigits(phoneOrJid) || String(phoneOrJid)}`;
    const cached = this.avatarCache.get(key);
    const ttlMs = Number(process.env.WHATSAPP_AVATAR_TTL_MS || 3 * 60 * 60_000) || 3 * 60 * 60_000;
    const isFresh = cached && (Date.now() - cached.at) < ttlMs;
    // Taze cache → anında dön, WhatsApp'a hiç sorma.
    if (cached && isFresh) return cached.url;
    const session = this.sessions.get(tenantId);
    // Bağlı değil → elde ne varsa onu ver (kaybolmasın).
    if (!session?.connected || !session.sock) return cached?.url ?? null;
    // Bayat ama elde değer var → ESKİYİ HEMEN dön + arka planda tazele (foto
    // değişimini yakalar, ama ekran beklemez/boşalmaz).
    if (cached) {
      void this.refreshAvatar(tenantId, key, phoneOrJid);
      return cached.url;
    }
    // Hiç yok (ilk yükleme) → zaman sınırlı çek + cache'le.
    return this.refreshAvatar(tenantId, key, phoneOrJid);
  }

  /** Profil fotoğrafını WhatsApp'tan zaman sınırlı çeker + cache'i günceller. */
  private async refreshAvatar(tenantId: string, key: string, phoneOrJid?: string | null): Promise<string | null> {
    const session = this.sessions.get(tenantId);
    if (!session?.connected || !session.sock || !phoneOrJid) return this.avatarCache.get(key)?.url ?? null;
    try {
      // WhatsApp ağ sorgusu; hesap throttle/kilitliyken yanıt vermeyip ASILI
      // kalabiliyor → kısa zaman sınırı, süre dolarsa null.
      const timeoutMs = Number(process.env.WHATSAPP_PROFILE_PIC_TIMEOUT_MS || 4000) || 4000;
      const url = await Promise.race<string | null>([
        session.sock.profilePictureUrl(this.toJid(phoneOrJid), 'image').catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      const prev = this.avatarCache.get(key);
      if (url) {
        // Yeni (veya aynı) foto geldi → güncelle (tam tazelik). Foto DEĞİŞİMİ böyle yakalanır.
        this.avatarCache.set(key, { url, at: Date.now() });
      } else {
        // Çekilemedi (timeout/throttle): eski URL'i KORU (kaybolmasın) ama 'at'i geriye
        // al ki ~5 dk sonra TEKRAR denensin — TTL (3 sa) boyunca null'da kilitlenmesin
        // (bağlantı toparlanınca foto gelsin).
        const ttlMs = Number(process.env.WHATSAPP_AVATAR_TTL_MS || 3 * 60 * 60_000) || 3 * 60 * 60_000;
        this.avatarCache.set(key, { url: prev?.url ?? null, at: Date.now() - ttlMs + 5 * 60_000 });
      }
      if (this.avatarCache.size > 3000) {
        const cutoff = Date.now() - 24 * 60 * 60_000;
        for (const [k, v] of this.avatarCache) if (v.at < cutoff) this.avatarCache.delete(k);
        while (this.avatarCache.size > 3000) {
          const oldest = this.avatarCache.keys().next().value;
          if (oldest === undefined) break;
          this.avatarCache.delete(oldest);
        }
      }
      return this.avatarCache.get(key)?.url ?? null;
    } catch {
      return this.avatarCache.get(key)?.url ?? null;
    }
  }

  /**
   * WhatsApp "Durum" (about/hakkında) metnini döndürür — profilePictureUrl ile birebir
   * aynı dayanıklılık: taze cache → anında; bayat → eskiyi ver + arka planda tazele;
   * bağlı değil → eldekini koru. Hiçbir koşulda ekran bekletmez/boşaltmaz.
   */
  async statusFor(
    tenantId: string,
    phoneOrJid?: string | null,
  ): Promise<{ text: string | null; setAt: string | null } | null> {
    if (!phoneOrJid) return null;
    const key = `${tenantId}:${this.jidDigits(phoneOrJid) || String(phoneOrJid)}`;
    const cached = this.statusCache.get(key);
    const ttlMs = Number(process.env.WHATSAPP_STATUS_TTL_MS || 6 * 60 * 60_000) || 6 * 60 * 60_000;
    const isFresh = cached && (Date.now() - cached.at) < ttlMs;
    const shape = (c?: { text: string | null; setAt: number | null }) =>
      c ? { text: c.text, setAt: c.setAt ? new Date(c.setAt).toISOString() : null } : null;
    if (cached && isFresh) return shape(cached);
    const session = this.sessions.get(tenantId);
    if (!session?.connected || !session.sock) return shape(cached ?? undefined);
    if (cached) {
      void this.refreshStatus(tenantId, key, phoneOrJid);
      return shape(cached);
    }
    await this.refreshStatus(tenantId, key, phoneOrJid);
    return shape(this.statusCache.get(key) ?? undefined);
  }

  /** Durum metnini WhatsApp'tan zaman sınırlı çeker + cache'i günceller. */
  private async refreshStatus(tenantId: string, key: string, phoneOrJid?: string | null): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session?.connected || !session.sock || !phoneOrJid) return;
    try {
      const timeoutMs = Number(process.env.WHATSAPP_STATUS_TIMEOUT_MS || 4000) || 4000;
      const res = await Promise.race<any>([
        session.sock.fetchStatus(this.toJid(phoneOrJid)).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      // Baileys sürümüne göre {status, setAt} ya da [{status,setAt}] dönebilir.
      const node = Array.isArray(res) ? res[0]?.status ?? res[0] : res?.status ?? res;
      const text: string | null = (typeof node?.status === 'string' ? node.status : typeof node === 'string' ? node : null) || null;
      const setAtRaw = node?.setAt ?? res?.setAt ?? null;
      const setAt = setAtRaw ? new Date(setAtRaw).getTime() : null;
      const prev = this.statusCache.get(key);
      if (text) {
        this.statusCache.set(key, { text, setAt: setAt || prev?.setAt || null, at: Date.now() });
      } else {
        // Çekilemedi → eskiyi koru ama ~5 dk sonra tekrar dene (TTL boyunca null'da kilitlenme).
        const ttlMs = Number(process.env.WHATSAPP_STATUS_TTL_MS || 6 * 60 * 60_000) || 6 * 60 * 60_000;
        this.statusCache.set(key, { text: prev?.text ?? null, setAt: prev?.setAt ?? null, at: Date.now() - ttlMs + 5 * 60_000 });
      }
      if (this.statusCache.size > 3000) {
        const cutoff = Date.now() - 24 * 60 * 60_000;
        for (const [k, v] of this.statusCache) if (v.at < cutoff) this.statusCache.delete(k);
        while (this.statusCache.size > 3000) {
          const oldest = this.statusCache.keys().next().value;
          if (oldest === undefined) break;
          this.statusCache.delete(oldest);
        }
      }
    } catch {
      /* eldeki cache korunur */
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
      if (mapped) return `${mapped}@s.whatsapp.net`;
      // Eşleme yoksa: Baileys 7 LID adreslemeyi NATIVE destekler → doğrudan
      // <lid>@lid'e gönder. (6.x'te bu "mesaj bekleniyor" üretiyordu, o yüzden
      // null dönüp gönderilmiyordu; 7.x'te <lid>@lid geçerli bir hedef.)
      // Kapatma: MOREN_BOT_LID_DIRECT_SEND=0 → eski güvenli davranış (gönderme).
      return process.env.MOREN_BOT_LID_DIRECT_SEND === '0' ? null : `${digits}@lid`;
    }
    if (raw.includes('@')) return raw;
    return `${digits}@s.whatsapp.net`;
  }

  /**
   * Gonderim hedefini KANONIK jid'e cozumle. Ham PN (@s.whatsapp.net) hedeflerde — yani botun
   * ILK KEZ yazdigi numaralarda (or. galeri musterisi) — yeni WhatsApp LID adreslemesinde mesaj
   * teslim OLMAYABILIR. onWhatsApp(number) sunucudan gercek/kanonik jid'i (LID olabilir) verir;
   * ona gonderince teslim olur. Cozulemezse eski davranisa (ham PN) duser — mevcut akislar bozulmaz.
   */
  private async ensureSendJid(s: Session, phone: string): Promise<string | null> {
    const base = this.toSendJid(s, phone);
    if (!base || !base.endsWith('@s.whatsapp.net')) return base;
    const digits = this.jidDigits(base);
    if (!digits || !s.sock?.onWhatsApp) return base;
    try {
      const res: any = await Promise.race([
        s.sock.onWhatsApp(digits),
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      const hit = Array.isArray(res) ? res[0] : null;
      if (hit?.jid) {
        if (this.jidDigits(hit.jid) !== digits || String(hit.jid).includes('@lid')) {
          this.logger.log(`[Baileys] gonderim hedefi onWhatsApp ile cozuldu: ${this.maskTarget(digits)} -> ${this.maskTarget(hit.jid)}`);
        }
        return hit.jid;
      }
      // İlk çözümleme boş: numara TR-yerel formatında (0xxx ya da 10 hane 5xx) girilmiş
      // olabilir (özellikle hiç yazışılmamış SOĞUK/ilk-mesaj numaraları). 90'lı uluslararası
      // forma çevirip TEK kez daha dene. EKLEMELİ: zaten çözülen numaralar yukarıda döndüğü
      // için mevcut akışlar etkilenmez; yalnız çözülemeyen yerel-format numaraya yardım eder.
      const intl = this.toTrMsisdn(digits);
      if (intl && intl !== digits && s.sock?.onWhatsApp) {
        const res2: any = await Promise.race([
          s.sock.onWhatsApp(intl),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        const hit2 = Array.isArray(res2) ? res2[0] : null;
        if (hit2?.jid) {
          this.logger.log(`[Baileys] gonderim hedefi TR-normalize ile cozuldu: ${this.maskTarget(digits)} -> ${this.maskTarget(hit2.jid)}`);
          return hit2.jid;
        }
        return `${intl}@s.whatsapp.net`; // çözülemese bile uluslararası form daha doğru
      }
    } catch (e: any) {
      this.logger.warn(`[Baileys] onWhatsApp cozumleme hata ${this.maskTarget(digits)}: ${e?.message || e}`);
    }
    return base;
  }

  /** TR cep numarasını uluslararası MSISDN'e çevir (90XXXXXXXXXX). Uygun değilse null. */
  private toTrMsisdn(digits: string): string | null {
    let d = String(digits || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);   // 0535... -> 535...
    if (d.length === 10 && d.startsWith('5')) d = '90' + d;     // 535... -> 90535...
    return /^90\d{10}$/.test(d) ? d : null;
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
   * SOĞUK-TEMAS ISINMASI (463 azaltma): hedef bize HİÇ yazmamışsa (lastIncoming yok),
   * göndermeden önce hesabı "online/available" göster + karşı tarafın presence'ına
   * abone ol + kısa bekle. WhatsApp'a "yeni birine spam atmıyorum, normal etkileşim"
   * sinyali verir; ilk-mesajın 463 ile kilitlenme olasılığını düşürür. Sıcak temasta
   * (daha önce yazışılmış) atlanır → normal hız korunur. Kapatma: WHATSAPP_COLD_WARMUP_MS=0.
   */
  private async warmUpIfCold(s: Session, jid: string, phone: string): Promise<void> {
    try {
      const digits = String(phone).replace(/[^\d]/g, '');
      if (s.lastIncoming?.get(digits)) return; // sıcak temas → ısınmaya gerek yok
      const ms = Number(process.env.WHATSAPP_COLD_WARMUP_MS ?? 2500);
      await s.sock.sendPresenceUpdate('available');
      try { await s.sock.presenceSubscribe(jid); } catch { /* önemsiz */ }
      await s.sock.sendPresenceUpdate('composing', jid);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    } catch { /* ısınma başarısızsa yine de göndermeyi dene */ }
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

  /**
   * Mesajı, karşı tarafın SON GELEN mesajına ALINTILI (quoted) gönderir — 463
   * (reach-out timelock) azaltma: WhatsApp'a "yeni birine ulaşmıyorum, mevcut
   * sohbete cevap veriyorum" sinyali. Alıntı geçersizse alıntısız tekrar dener.
   * Kapatma: MOREN_BOT_QUOTED=0.
   */
  private async sendQuoted(s: Session, jid: string, phone: string, payload: any, quote = true): Promise<any> {
    const quoted = (quote === false || process.env.MOREN_BOT_QUOTED === '0')
      ? undefined
      : s.lastIncoming?.get(String(phone).replace(/[^\d]/g, ''));
    if (!quoted) return s.sock.sendMessage(jid, payload);
    try {
      return await s.sock.sendMessage(jid, payload, { quoted });
    } catch (e: any) {
      this.logger.warn(`[Baileys] alıntılı gönderim başarısız, alıntısız deneniyor: ${e?.message || e}`);
      return s.sock.sendMessage(jid, payload);
    }
  }

  async sendTextDetailed(tenantId: string, phone: string, text: string, opts?: { quote?: boolean }): Promise<BaileysSendResult> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) {
      this.logger.warn(`[Baileys] tenant=${tenantId} bagli degil, mesaj gonderilemedi`);
      return { ok: false, error: 'QR WhatsApp oturumu bagli degil.' };
    }
    try {
      const jid = await this.ensureSendJid(s, phone);
      if (!jid) {
        const error = 'WhatsApp LID adresi gercek telefon numarasina cozumlenemedi; bekleyen mesaj olusmamasi icin gonderim durduruldu.';
        this.logger.warn(`[Baileys] tenant=${tenantId} LID hedef cozumlenemedi target=${this.maskTarget(phone)}`);
        return { ok: false, error };
      }
      await this.warmUpIfCold(s, jid, phone);
      await this.humanPace(s.sock, jid, text);
      await this.refreshSignalSession(s.sock, jid);
      const sent = await this.sendQuoted(s, jid, phone, { text }, opts?.quote);
      this.rememberSend(tenantId, jid, { text }, sent?.key?.id, sent?.message);
      this.storeDelivery(tenantId, sent?.key?.id, 'sent');
      this.logger.log(`[Baileys] tenant=${tenantId} mesaj gonderildi target=${this.maskTarget(phone)} jid=${this.maskTarget(jid)} id=${sent?.key?.id || 'unknown'}`);
      return { ok: true, providerMessageId: sent?.key?.id };
    } catch (e: any) {
      this.logger.error(`[Baileys] gonderim hatasi ${phone}: ${e?.message || e}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async sendText(tenantId: string, phone: string, text: string, opts?: { quote?: boolean }): Promise<boolean> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) {
      this.logger.warn(`[Baileys] tenant=${tenantId} bağlı değil, mesaj gönderilemedi`);
      return false;
    }
    try {
      const jid = await this.ensureSendJid(s, phone);
      if (!jid) {
        this.logger.warn(`[Baileys] tenant=${tenantId} LID hedef cozumlenemedi target=${this.maskTarget(phone)}`);
        return false;
      }
      await this.warmUpIfCold(s, jid, phone);
      await this.humanPace(s.sock, jid, text);
      await this.refreshSignalSession(s.sock, jid);
      const sent = await this.sendQuoted(s, jid, phone, { text }, opts?.quote);
      this.rememberSend(tenantId, jid, { text }, sent?.key?.id, sent?.message);
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
    opts?: { quote?: boolean },
  ): Promise<BaileysSendResult> {
    const s = this.sessions.get(tenantId);
    if (!s?.connected || !s.sock) return { ok: false, error: 'QR WhatsApp oturumu bagli degil.' };
    try {
      const res = await fetch(media.url, { signal: (AbortSignal as any).timeout(60_000) });
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
      await this.warmUpIfCold(s, jid, phone);
      await this.refreshSignalSession(s.sock, jid);
      const sent = await this.sendQuoted(s, jid, phone, payload, opts?.quote);
      this.rememberSend(tenantId, jid, payload, sent?.key?.id, sent?.message);
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
    opts?: { quote?: boolean },
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
      await this.warmUpIfCold(s, jid, phone);
      await this.refreshSignalSession(s.sock, jid);
      const sent = await this.sendQuoted(s, jid, phone, payload, opts?.quote);
      this.rememberSend(tenantId, jid, payload, sent?.key?.id, sent?.message);
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
