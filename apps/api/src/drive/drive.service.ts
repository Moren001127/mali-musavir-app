import {
  Injectable,
  Logger,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MihsapService } from '../mihsap/mihsap.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { encrypt, decrypt } from '../common/crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// drive (tam): mevcut "MUKELLEF LISTESI" klasorunun icine FATURALAR acabilmek icin tam
// erisim gerekir (drive.file mevcut bir klasorun icine yazamaz). Workspace "Internal"
// uygulamasi oldugu icin Google incelemesi gerekmez. userinfo.email: baglanan hesabin e-postasi.
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

@Injectable()
export class DriveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DriveService.name);
  private unsubscribe?: () => void;
  // Klasor id onbellegi (process ici) — path -> Promise<driveFolderId>
  private readonly folderMemo = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mihsap: MihsapService,
    @Optional() private readonly eventBus?: AutomationEventBus,
  ) {}

  onModuleInit() {
    if (!this.eventBus) {
      this.logger.warn('AutomationEventBus yok — fatura cekiminde otomatik Drive yedegi devre disi.');
      return;
    }
    // Fatura cekimi bitince otomatik yedek baslat (Drive bagliysa).
    this.unsubscribe = this.eventBus.on('Mihsap.InvoicesFetched', (payload) =>
      this.onMihsapFetched(payload as any),
    );
    this.logger.log('Mihsap.InvoicesFetched dinleniyor — otomatik Drive yedegi aktif.');
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  private async onMihsapFetched(payload: {
    tenantId: string;
    mukellefId?: string;
    donem?: string;
  }) {
    try {
      const acc = await this.getAccount(payload.tenantId);
      if (!acc?.isActive) return; // Drive bagli degil → sessizce gec
      await this.startBackup({
        tenantId: payload.tenantId,
        mukellefId: payload.mukellefId,
        donem: payload.donem,
        auto: true,
      });
    } catch (e: any) {
      this.logger.warn(`Otomatik Drive yedegi baslatilamadi: ${e?.message || e}`);
    }
  }

  // ==================== KONFIG ====================

  private clientId(): string {
    const v = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    if (!v) throw new BadRequestException('GOOGLE_OAUTH_CLIENT_ID tanimli degil (Railway env).');
    return v;
  }
  private clientSecret(): string {
    const v = this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!v) throw new BadRequestException('GOOGLE_OAUTH_CLIENT_SECRET tanimli degil (Railway env).');
    return v;
  }
  private redirectUri(): string {
    const v = this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URI');
    if (!v) throw new BadRequestException('GOOGLE_OAUTH_REDIRECT_URI tanimli degil (Railway env).');
    return v;
  }
  // FATURALAR kok klasorunun olusturulacagi ust klasor id'si (orn. "MUKELLEF LISTESI").
  // Bos ise Drive kokune ("root") acilir.
  private rootParentId(): string {
    return this.config.get<string>('GOOGLE_DRIVE_ROOT_PARENT_ID') || 'root';
  }
  // ==================== OAUTH ====================

  /** Panelden cagrilir (JWT korumali) — Google izin ekrani URL'ini uretir. */
  buildAuthUrl(tenantId: string, origin?: string): string {
    const state = this.signState(tenantId, origin);
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline', // refresh_token al
      prompt: 'consent', // her baglanista refresh_token garantile
      include_granted_scopes: 'true',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /** Google geri donusu (public). state dogrulanir, code token'a cevrilir, kaydedilir. */
  async handleCallback(code: string, state: string): Promise<{ tenantId: string; origin: string }> {
    const { tenantId, origin } = this.verifyState(state);
    const tokens = await this.exchangeCode(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google refresh_token dondurmedi. Google hesabi ayarlarindan uygulamanin erisimini kaldirip tekrar baglanin.',
      );
    }
    let email: string | null = null;
    try {
      email = await this.fetchEmail(tokens.access_token);
    } catch {
      /* email opsiyonel */
    }
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
    await (this.prisma as any).googleDriveAccount.upsert({
      where: { tenantId },
      update: {
        email,
        encryptedRefreshToken: encrypt(tokens.refresh_token),
        accessToken: tokens.access_token,
        accessTokenExpiresAt: expiresAt,
        scope: tokens.scope || SCOPES,
        connectedAt: new Date(),
        lastError: null,
        isActive: true,
        // Hesap degismis olabilir → kok klasor onbellegini temizle
        rootFolderId: null,
      },
      create: {
        tenantId,
        email,
        encryptedRefreshToken: encrypt(tokens.refresh_token),
        accessToken: tokens.access_token,
        accessTokenExpiresAt: expiresAt,
        scope: tokens.scope || SCOPES,
        connectedAt: new Date(),
        isActive: true,
      },
    });
    this.folderMemo.clear();
    return { tenantId, origin };
  }

  private async exchangeCode(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadRequestException(`Google token alisverisi basarisiz (${res.status}): ${t.slice(0, 200)}`);
    }
    return res.json() as any;
  }

  private async fetchEmail(accessToken: string): Promise<string | null> {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.email || null;
  }

  /** Gecerli access token dondurur; suresi dolmussa refresh token ile yeniler. */
  private async getValidAccessToken(tenantId: string): Promise<string> {
    const acc = await this.getAccount(tenantId);
    if (!acc) throw new BadRequestException('Drive bagli degil.');
    if (
      acc.accessToken &&
      acc.accessTokenExpiresAt &&
      new Date(acc.accessTokenExpiresAt).getTime() > Date.now() + 60_000
    ) {
      return acc.accessToken;
    }
    // Yenile
    let refreshToken: string;
    try {
      refreshToken = decrypt(acc.encryptedRefreshToken);
    } catch {
      await this.markError(tenantId, 'Sifreli token cozulemedi (ENCRYPTION_KEY degismis olabilir).');
      throw new BadRequestException('Drive baglantisi bozuk — yeniden baglanin.');
    }
    const body = new URLSearchParams({
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      await this.markError(tenantId, `Token yenileme basarisiz: ${t.slice(0, 150)}`);
      throw new BadRequestException('Drive yetkisi gecersiz — yeniden baglanin.');
    }
    const j: any = await res.json();
    const expiresAt = new Date(Date.now() + (j.expires_in || 3600) * 1000);
    await (this.prisma as any).googleDriveAccount.update({
      where: { tenantId },
      data: { accessToken: j.access_token, accessTokenExpiresAt: expiresAt, lastError: null },
    });
    return j.access_token;
  }

  // ==================== STATE IMZA (HMAC) ====================

  private hmacKey(): Buffer {
    const k = process.env.ENCRYPTION_KEY;
    if (!k) throw new BadRequestException('ENCRYPTION_KEY tanimli degil.');
    return Buffer.from(k, 'base64');
  }
  private signState(tenantId: string, origin?: string): string {
    const exp = Date.now() + 10 * 60_000; // 10 dk gecerli
    const payload = Buffer.from(`${tenantId}|${exp}|${origin || ''}`, 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.hmacKey()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): { tenantId: string; origin: string } {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) throw new BadRequestException('Gecersiz state.');
    const expected = createHmac('sha256', this.hmacKey()).update(payload).digest('base64url');
    if (sig !== expected) throw new BadRequestException('State imzasi gecersiz.');
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const [tenantId, expStr, origin] = decoded.split('|');
    if (!tenantId || !expStr || Number(expStr) < Date.now()) {
      throw new BadRequestException('State suresi doldu — tekrar deneyin.');
    }
    return { tenantId, origin: origin || '' };
  }

  /** Imzayi dogrulamadan state'ten origin cikar (hata yolundaki yonlendirme icin). */
  originFromState(state?: string): string {
    try {
      return this.verifyState(state || '').origin;
    } catch {
      return '';
    }
  }

  /** Guvenli panel donus URL'i — origin allowlist'ten gecmeli (acik yonlendirme onlenir). */
  safePanelUrl(origin: string | undefined, query: string): string {
    const fallback =
      this.config.get<string>('FRONTEND_URL') ||
      this.config.get<string>('NEXT_PUBLIC_APP_URL') ||
      'https://portal.morenmusavirlik.com';
    const base = this.isAllowedOrigin(origin) ? (origin as string) : fallback;
    return `${base.replace(/\/$/, '')}/panel/faturalar${query}`;
  }

  private isAllowedOrigin(origin?: string): boolean {
    if (!origin) return false;
    if (/^https:\/\/([a-z0-9-]+\.)?morenmusavirlik\.com$/i.test(origin)) return true;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
    const configured = [
      this.config.get<string>('FRONTEND_URL'),
      this.config.get<string>('NEXT_PUBLIC_APP_URL'),
    ].filter(Boolean) as string[];
    return configured.some((c) => c.replace(/\/$/, '') === origin.replace(/\/$/, ''));
  }

  // ==================== HESAP / DURUM ====================

  private async getAccount(tenantId: string): Promise<any | null> {
    return (this.prisma as any).googleDriveAccount.findUnique({ where: { tenantId } });
  }

  private async markError(tenantId: string, msg: string) {
    await (this.prisma as any).googleDriveAccount
      .update({ where: { tenantId }, data: { lastError: msg } })
      .catch(() => null);
  }

  async getStatus(tenantId: string) {
    const acc = await this.getAccount(tenantId);
    if (!acc || !acc.isActive) return { connected: false };
    const lastBackup = await (this.prisma as any).driveBackupJob.findFirst({
      where: { tenantId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, backedUpCount: true },
    });
    const totalBacked = await (this.prisma as any).driveBackup.count({ where: { tenantId } });
    return {
      connected: true,
      email: acc.email,
      rootFolderName: acc.rootFolderName,
      connectedAt: acc.connectedAt,
      lastError: acc.lastError || null,
      lastBackupAt: lastBackup?.finishedAt || null,
      totalBacked,
    };
  }

  async disconnect(tenantId: string) {
    // Yedek kutugu (DriveBackup) ve Drive'daki dosyalar KORUNUR — sadece baglanti kesilir.
    await (this.prisma as any).googleDriveAccount
      .delete({ where: { tenantId } })
      .catch(() => null);
    this.folderMemo.clear();
    return { ok: true };
  }

  /** Bir donem icin hangi faturalar yedeklenmis — frontend "yedeklendi" isareti icin. */
  async listBackedUpInvoiceIds(tenantId: string, mukellefId?: string, donem?: string) {
    const where: any = { tenantId };
    if (mukellefId) where.mukellefId = mukellefId;
    if (donem) where.donem = donem;
    const backups = await (this.prisma as any).driveBackup.findMany({
      where,
      select: { mihsapId: true },
    });
    const mihsapIds: string[] = backups.map((b: any) => b.mihsapId);
    if (!mihsapIds.length) return { ids: [] as string[] };
    const invs = await (this.prisma as any).mihsapInvoice.findMany({
      where: { tenantId, mihsapId: { in: mihsapIds } },
      select: { id: true },
    });
    return { ids: invs.map((i: any) => i.id) };
  }

  async listJobs(tenantId: string, limit = 5) {
    return (this.prisma as any).driveBackupJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });
  }

  // ==================== GORUNTULEME (Drive-oncelikli) ====================

  /**
   * Bir faturanin dosyasini getirir. Yedekliyse Drive'dan indirir
   * (MIHSAP'tan bagimsiz); degilse MIHSAP proxy'sine duser.
   */
  async serveInvoiceFile(
    tenantId: string,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv || inv.tenantId !== tenantId) {
      throw new BadRequestException(`Fatura kaydi bulunamadi (${invoiceId})`);
    }

    // Drive yedegi var mi?
    const backup = inv.mihsapId
      ? await (this.prisma as any).driveBackup.findUnique({
          where: { tenantId_mihsapId: { tenantId, mihsapId: inv.mihsapId } },
        })
      : null;
    const acc = backup?.driveFileId ? await this.getAccount(tenantId) : null;

    if (backup?.driveFileId && acc?.isActive) {
      try {
        const token = await this.getValidAccessToken(tenantId);
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${backup.driveFileId}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          const contentType =
            res.headers.get('content-type') || 'application/octet-stream';
          return {
            buffer,
            contentType,
            filename: backup.fileName || `${inv.faturaNo || invoiceId}`,
          };
        }
        this.logger.warn(
          `Drive'dan ${invoiceId} okunamadi (${res.status}) — MIHSAP'a dusuluyor`,
        );
      } catch (e: any) {
        this.logger.warn(
          `Drive serve hatasi ${invoiceId}: ${e?.message || e} — MIHSAP fallback`,
        );
      }
    }

    // Fallback: MIHSAP proxy (mevcut davranis)
    return this.mihsap.getInvoiceFile(tenantId, invoiceId);
  }

  // ==================== YEDEKLEME ====================

  async startBackup(params: {
    tenantId: string;
    mukellefId?: string;
    donem?: string;
    createdBy?: string;
    auto?: boolean;
  }): Promise<{ jobId: string; already?: boolean } | null> {
    const acc = await this.getAccount(params.tenantId);
    if (!acc?.isActive) {
      if (params.auto) return null;
      throw new BadRequestException('Once Google Drive baglantisi kurun.');
    }
    // Ayni (mukellef + donem) icin zaten calisan is varsa yenisini acma
    const running = await (this.prisma as any).driveBackupJob.findFirst({
      where: {
        tenantId: params.tenantId,
        status: 'running',
        mukellefId: params.mukellefId ?? null,
        donem: params.donem ?? null,
      },
    });
    if (running) return { jobId: running.id, already: true };

    const job = await (this.prisma as any).driveBackupJob.create({
      data: {
        tenantId: params.tenantId,
        mukellefId: params.mukellefId || null,
        donem: params.donem || null,
        status: 'running',
        startedAt: new Date(),
        createdBy: params.createdBy || null,
      },
    });
    // Arka planda calistir (HTTP yanitini bekletme)
    void this.runBackup(job.id, params.tenantId, params.mukellefId, params.donem).catch((e) =>
      this.logger.error(`runBackup ${job.id} hata: ${e?.message || e}`),
    );
    return { jobId: job.id };
  }

  private async runBackup(
    jobId: string,
    tenantId: string,
    mukellefId?: string,
    donem?: string,
  ) {
    let backedUp = 0;
    let skipped = 0;
    let failed = 0;
    let total = 0;
    let errorMsg: string | null = null;

    try {
      // Kapsam: dosyasi indirilebilen her kayit (mihsapFileLink dolu)
      const where: any = { tenantId, mihsapFileLink: { not: null } };
      if (mukellefId) where.mukellefId = mukellefId;
      if (donem) where.donem = donem;
      const invoices: any[] = await (this.prisma as any).mihsapInvoice.findMany({
        where,
        orderBy: [{ faturaTarihi: 'asc' }],
      });
      const candidates = invoices.filter((i) => i.mihsapFileLink && String(i.mihsapFileLink).trim());
      total = candidates.length;
      await this.updateJob(jobId, { totalCount: total });

      // Onceden yedeklenmisleri tek sorguda al (mukerrer engeli)
      const already = new Set<string>(
        (
          await (this.prisma as any).driveBackup.findMany({
            where: { tenantId },
            select: { mihsapId: true },
          })
        ).map((b: any) => b.mihsapId),
      );

      // İlk token denemesi — bağlantı/yetki bozuksa işi baştan düşür (hızlı hata)
      await this.getValidAccessToken(tenantId);
      const nameCache = new Map<string, string>();

      const CONCURRENCY = 4;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        // Token'ı her batch'te tazele — uzun süren yedeklerde (1500+ fatura) süresi dolmasın
        const token = await this.getValidAccessToken(tenantId);
        const batch = candidates.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((inv) =>
            this.backupOne(tenantId, inv, token, nameCache, already).catch((e) => {
              this.logger.warn(`Fatura ${inv.id} yedeklenemedi: ${e?.message || e}`);
              return 'failed' as const;
            }),
          ),
        );
        for (const r of results) {
          if (r === 'backed') backedUp++;
          else if (r === 'skipped') skipped++;
          else failed++;
        }
        await this.updateJob(jobId, {
          backedUpCount: backedUp,
          skippedCount: skipped,
          failedCount: failed,
        });
      }
    } catch (e: any) {
      errorMsg = e?.message || 'bilinmeyen hata';
      this.logger.error(`runBackup ${jobId}: ${errorMsg}`);
    }

    await this.updateJob(jobId, {
      status: errorMsg ? 'failed' : 'done',
      totalCount: total,
      backedUpCount: backedUp,
      skippedCount: skipped,
      failedCount: failed,
      errorMsg,
      finishedAt: new Date(),
    });
    this.logger.log(
      `Drive yedek ${jobId} bitti: ${backedUp} yeni, ${skipped} zaten var, ${failed} hata / ${total}`,
    );
  }

  private async backupOne(
    tenantId: string,
    inv: any,
    token: string,
    nameCache: Map<string, string>,
    already: Set<string>,
  ): Promise<'backed' | 'skipped' | 'failed'> {
    // 1) Kalici kutukte var mi? → atla (forceRefresh sonrasi bile tekrar yuklemez)
    if (already.has(inv.mihsapId)) return 'skipped';
    const existing = await (this.prisma as any).driveBackup.findUnique({
      where: { tenantId_mihsapId: { tenantId, mihsapId: inv.mihsapId } },
    });
    if (existing) {
      already.add(inv.mihsapId);
      return 'skipped';
    }

    // 2) Klasor yolu: FATURALAR / {mukellef} / {yil} / {ay} / {Alis|Satis}
    const mukellefAd = await this.resolveMukellefName(tenantId, inv, nameCache);
    const { year, monthLabel } = this.yearMonthFromDonem(inv.donem, inv.faturaTarihi);
    const sideLabel = this.sideLabel(inv.faturaTuru);
    const acc = await this.getAccount(tenantId);
    const rootName = acc?.rootFolderName || 'FATURALAR';
    const segments = [
      this.sanitizeFolder(mukellefAd),
      year,
      monthLabel,
      sideLabel,
    ];
    const leafFolderId = await this.ensurePath(tenantId, rootName, segments, token);

    // 3) Dosya adi: "30.04.2026 - EFA2026000000087 - TATSAN UNLU MAMULLERI.jpg"
    // 4) Icerigi MIHSAP'tan indir (mevcut proxy mantigini yeniden kullan)
    const file = await this.mihsap.getInvoiceFile(tenantId, inv.id);
    const ext = (file.filename.split('.').pop() || 'bin').toLowerCase();
    const fileName = this.buildFileName(inv, ext);

    // Guvenlik agi: ayni isimli dosya klasorde zaten varsa (kutuk kaybi vb.) tekrar yukleme
    const dup = await this.driveFindFile(token, fileName, leafFolderId);
    let driveFileId: string;
    if (dup) {
      driveFileId = dup;
    } else {
      driveFileId = await this.driveUpload(token, fileName, file.contentType, file.buffer, leafFolderId);
    }

    const filePath = `${rootName}/${segments.join('/')}/${fileName}`;
    await (this.prisma as any).driveBackup
      .create({
        data: {
          tenantId,
          mihsapId: inv.mihsapId,
          mukellefId: inv.mukellefId || null,
          donem: inv.donem || null,
          faturaTuru: inv.faturaTuru || null,
          driveFileId,
          driveFolderId: leafFolderId,
          filePath,
          fileName,
          sizeBytes: file.buffer.length,
        },
      })
      .catch(() => null); // unique cakismasi (eszamanli) → yok say
    already.add(inv.mihsapId);
    return 'backed';
  }

  // ==================== KLASOR YONETIMI ====================

  /** Kok klasorden yapraga kadar tum klasorleri saglar; yaprak klasor id'sini dondurur. */
  private async ensurePath(
    tenantId: string,
    rootName: string,
    segments: string[],
    token: string,
  ): Promise<string> {
    let parentId = await this.ensureRoot(tenantId, rootName, token);
    let pathAcc = rootName;
    for (const seg of segments) {
      pathAcc = `${pathAcc}/${seg}`;
      parentId = await this.ensureFolder(tenantId, pathAcc, seg, parentId, token);
    }
    return parentId;
  }

  private async ensureRoot(tenantId: string, rootName: string, token: string): Promise<string> {
    const acc = await this.getAccount(tenantId);
    if (acc?.rootFolderId) return acc.rootFolderId;
    const id = await this.ensureFolder(tenantId, rootName, rootName, this.rootParentId(), token);
    await (this.prisma as any).googleDriveAccount
      .update({ where: { tenantId }, data: { rootFolderId: id } })
      .catch(() => null);
    return id;
  }

  private ensureFolder(
    tenantId: string,
    path: string,
    name: string,
    parentId: string,
    token: string,
  ): Promise<string> {
    const key = `${tenantId}:${path}`;
    const memo = this.folderMemo.get(key);
    if (memo) return memo;
    const p = (async () => {
      // DB onbellegi
      const cached = await (this.prisma as any).driveFolder.findUnique({
        where: { tenantId_path: { tenantId, path } },
      });
      if (cached) return cached.driveFolderId as string;
      // Drive'da ara, yoksa olustur
      const found = await this.driveFindFolder(token, name, parentId);
      let id: string = found ?? (await this.driveCreateFolder(token, name, parentId));
      try {
        await (this.prisma as any).driveFolder.create({
          data: { tenantId, path, driveFolderId: id },
        });
      } catch {
        const again = await (this.prisma as any).driveFolder.findUnique({
          where: { tenantId_path: { tenantId, path } },
        });
        if (again) id = again.driveFolderId;
      }
      return id;
    })();
    this.folderMemo.set(key, p);
    // Hata olursa memo'yu temizle ki sonraki denemede tekrar calissin
    p.catch(() => this.folderMemo.delete(key));
    return p;
  }

  // ==================== DRIVE REST ====================

  private escapeQ(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private async driveFindFolder(
    token: string,
    name: string,
    parentId: string,
  ): Promise<string | null> {
    const q = `mimeType='${FOLDER_MIME}' and name='${this.escapeQ(name)}' and '${parentId}' in parents and trashed=false`;
    return this.driveFindFirst(token, q);
  }

  private async driveFindFile(
    token: string,
    name: string,
    parentId: string,
  ): Promise<string | null> {
    const q = `name='${this.escapeQ(name)}' and '${parentId}' in parents and trashed=false`;
    return this.driveFindFirst(token, q);
  }

  private async driveFindFirst(token: string, q: string): Promise<string | null> {
    const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Drive arama hatasi ${res.status}: ${t.slice(0, 120)}`);
    }
    const j: any = await res.json();
    return j?.files?.[0]?.id || null;
  }

  private async driveCreateFolder(
    token: string,
    name: string,
    parentId: string,
  ): Promise<string> {
    const res = await fetch(`${DRIVE_FILES_URL}?fields=id&supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Drive klasor olusturma hatasi ${res.status}: ${t.slice(0, 120)}`);
    }
    const j: any = await res.json();
    return j.id;
  }

  private async driveUpload(
    token: string,
    name: string,
    mimeType: string,
    buffer: Buffer,
    parentId: string,
  ): Promise<string> {
    const boundary = `moren${randomBytes(12).toString('hex')}`;
    const meta = JSON.stringify({ name, parents: [parentId] });
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
      'utf8',
    );
    const post = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const body = Buffer.concat([pre, buffer, post]);
    const res = await fetch(DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Drive yukleme hatasi ${res.status}: ${t.slice(0, 150)}`);
    }
    const j: any = await res.json();
    return j.id;
  }

  // ==================== ISIMLENDIRME / YARDIMCI ====================

  private async resolveMukellefName(
    tenantId: string,
    inv: any,
    cache: Map<string, string>,
  ): Promise<string> {
    const key = inv.mukellefId || inv.mukellefMihsapId || 'mukellef';
    const hit = cache.get(key);
    if (hit) return hit;
    let name = '';
    if (inv.mukellefId) {
      const tp = await (this.prisma as any).taxpayer
        .findFirst({
          where: { id: inv.mukellefId, tenantId },
          select: { companyName: true, firstName: true, lastName: true },
        })
        .catch(() => null);
      if (tp) {
        name =
          tp.companyName ||
          [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim();
      }
    }
    if (!name) name = `Mukellef ${inv.mukellefMihsapId || inv.mukellefId || ''}`.trim();
    cache.set(key, name);
    return name;
  }

  private yearMonthFromDonem(
    donem?: string,
    faturaTarihi?: Date | string,
  ): { year: string; monthLabel: string } {
    let y = '';
    let m = 0;
    const md = String(donem || '').match(/^(\d{4})-(\d{2})$/);
    if (md) {
      y = md[1];
      m = Number(md[2]);
    } else if (faturaTarihi) {
      const d = new Date(faturaTarihi);
      y = String(d.getFullYear());
      m = d.getMonth() + 1;
    }
    const mm = String(m).padStart(2, '0');
    const monthLabel = m >= 1 && m <= 12 ? `${mm} ${MONTH_NAMES[m - 1]}` : (mm || 'Ay');
    return { year: y || 'Yil', monthLabel };
  }

  private sideLabel(faturaTuru?: string): string {
    const t = String(faturaTuru || '').toUpperCase();
    if (t.includes('SATIS')) return 'Satış';
    if (t.includes('ALIS')) return 'Alış';
    return 'Diğer';
  }

  private buildFileName(inv: any, ext: string): string {
    const tarih = this.formatDate(inv.faturaTarihi);
    const belgeNo = this.sanitizeName(inv.faturaNo || '');
    const unvan = this.shortenUnvan(inv.firmaUnvan || '');
    const parts = [tarih, belgeNo, unvan].filter(Boolean);
    let base = parts.join(' - ');
    base = this.sanitizeName(base).slice(0, 150).trim();
    if (!base) base = inv.mihsapId;
    return `${base}.${ext}`;
  }

  private formatDate(d?: Date | string): string {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const gg = String(dt.getDate()).padStart(2, '0');
    const aa = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    return `${gg}.${aa}.${yyyy}`;
  }

  /** Unvani okunabilir kisalt: ilk ~45 karakter, kelime sinirinda kes. */
  private shortenUnvan(u: string): string {
    const clean = this.sanitizeName(u).replace(/\s+/g, ' ').trim();
    if (clean.length <= 45) return clean;
    const cut = clean.slice(0, 45);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }

  /** Dosya adi icin yasak karakterleri temizle (Turkce harfler ve tire korunur). */
  private sanitizeName(s: string): string {
    return String(s)
      .replace(/[/\\:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Klasor adi temizligi (ayni kurallar). */
  private sanitizeFolder(s: string): string {
    const out = this.sanitizeName(s).slice(0, 120).trim();
    return out || 'Mukellef';
  }

  private async updateJob(jobId: string, data: any) {
    await (this.prisma as any).driveBackupJob
      .update({ where: { id: jobId }, data })
      .catch(() => null);
  }
}
