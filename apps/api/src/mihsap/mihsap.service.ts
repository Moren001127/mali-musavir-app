import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const MIHSAP_BASE = 'https://app.mihsap.com';
// MIHSAP all-faturas body'sinde kullanılan alan id'leri (keşif yoluyla bulundu)
const FIELD = {
  FATURA_TURU: 8,    // "ALIS" | "SATIS"
  MUKELLEF_ID: 9,    // userFirmaBilgisiId
  FATURA_TARIHI: 37, // Between [YYYY-MM-DD, YYYY-MM-DD]
  ONAY_DURUMU: 44,   // 1 = ONAYLANMIS (sanırız)
};

export interface MihsapInvoiceSummary {
  id: number;
  fileId?: number;
  faturaId?: number;
  userFirmaBilgisiId: number;
  belgeTuru: string;
  faturaNo: string;
  firmaKimlikNo?: string;
  firmaUnvan?: string;
  faturaTuru: string;
  onayDurumu?: string;
  faturaTarihi?: string;
  faturaTarihiStr?: string;
  faturaFirmaAdi?: string;
  faturaFirmaKimlikNo?: string;
  toplamTutar?: number;
  fileLink?: string;
  fileDownloadLink?: string;
  orjDosyaTuru?: string;
}

@Injectable()
export class MihsapService {
  private readonly logger = new Logger(MihsapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ==================== TOKEN YÖNETİMİ ====================

  /** Eklenti veya kullanıcı MIHSAP JWT'sini gönderir. Şifresiz saklar (MVP). */
  async saveToken(tenantId: string, token: string, email?: string, updatedBy?: string) {
    if (!token || token.length < 20) {
      throw new BadRequestException('Geçersiz token');
    }
    return (this.prisma as any).mihsapSession.upsert({
      where: { tenantId },
      update: { token, email: email || null, updatedBy: updatedBy || null },
      create: { tenantId, token, email: email || null, updatedBy: updatedBy || null },
    });
  }

  async getSession(tenantId: string) {
    const s = await (this.prisma as any).mihsapSession.findUnique({ where: { tenantId } });
    if (!s) return null;
    return {
      connected: true,
      email: s.email,
      updatedAt: s.updatedAt,
      tokenLength: s.token?.length || 0,
    };
  }

  private async getToken(tenantId: string): Promise<string> {
    const s = await (this.prisma as any).mihsapSession.findUnique({ where: { tenantId } });
    if (!s?.token) {
      throw new UnauthorizedException(
        'MIHSAP token yok. Lütfen MIHSAP sayfasını açın; eklenti tokenı otomatik senkronize edecek.',
      );
    }
    return s.token;
  }

  // ==================== MIHSAP API PROXY ====================

  /** Belirli mükellef + ay için fatura listesini MIHSAP'tan çeker */
  async listInvoices(params: {
    tenantId: string;
    mukellefMihsapId: string | number;
    donem: string; // "2026-03"
    faturaTuru: 'ALIS' | 'SATIS';
    pageSize?: number;
    pageIndex?: number;
  }): Promise<{ total: number; items: MihsapInvoiceSummary[] }> {
    const token = await this.getToken(params.tenantId);
    const [year, month] = params.donem.split('-');
    const startDate = `${year}-${month}-01`;
    // Ayın son günü
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    const body = {
      sortAlanlari: [
        { siralamaYonu: 'ASCENDING', sortAlanId: 2 },
        { siralamaYonu: 'DESCENDING', sortAlanId: FIELD.FATURA_TARIHI },
      ],
      valueList: [
        { alanId: FIELD.FATURA_TURU, operator: 'Equals', values: [params.faturaTuru] },
        { alanId: FIELD.MUKELLEF_ID, operator: 'Equals', values: [String(params.mukellefMihsapId)] },
        { alanId: FIELD.FATURA_TARIHI, operator: 'Between', values: [startDate, endDate] },
        { alanId: FIELD.ONAY_DURUMU, operator: 'Equals', values: [1] },
      ],
      // MIHSAP pagination query string ile yapılıyor — ileride gerekirse eklenir
    };

    const qs = new URLSearchParams();
    if (params.pageSize) qs.set('size', String(params.pageSize));
    if (params.pageIndex !== undefined) qs.set('page', String(params.pageIndex));

    const url = `${MIHSAP_BASE}/api/mali-musavir/all-faturas${qs.toString() ? '?' + qs.toString() : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(
        'MIHSAP token süresi dolmuş. MIHSAP sayfasını yenileyin; eklenti yeni token gönderecek.',
      );
    }
    if (!res.ok) {
      const t = await res.text();
      this.logger.error(`MIHSAP all-faturas error ${res.status}: ${t.slice(0, 300)}`);
      throw new BadRequestException(`MIHSAP hata ${res.status}`);
    }
    const json: any = await res.json();
    const content = json?.sonucValue?.content || [];
    const total = json?.sonucValue?.totalElements ?? content.length;
    return { total, items: content };
  }

  /** Tüm sayfaları çek (pagination loop). Büyük mükellef dosyaları (1500+) için güvenli:
   *  100'lük sayfalarla ilerler, Mihsap'ın döndürdüğü 'total' değerine ulaşınca durur.
   *  Safety cap: 100 sayfa × 100 = 10,000 fatura üst sınırı. */
  async listAllInvoices(params: {
    tenantId: string;
    mukellefMihsapId: string | number;
    donem: string;
    faturaTuru: 'ALIS' | 'SATIS';
  }): Promise<MihsapInvoiceSummary[]> {
    const PAGE_SIZE = 100;
    let pageIndex = 0;
    const all: MihsapInvoiceSummary[] = [];
    while (true) {
      const { items, total } = await this.listInvoices({
        ...params,
        pageSize: PAGE_SIZE,
        pageIndex,
      });
      all.push(...items);
      if (all.length >= total || items.length < PAGE_SIZE) break;
      pageIndex++;
      if (pageIndex > 100) break; // safety: en fazla 10,000 fatura
    }
    return all;
  }

  // ==================== STORAGE + DB ====================

  private buildStorageKey(
    tenantId: string,
    mukellefId: string,
    donem: string,
    belgeNo: string,
    ext: string,
    faturaTuru: string,
    mihsapId: string | number,
  ): string {
    // belgeNo boş/hatalı olabilir — MIHSAP internal id ile birleştirip unique garantile
    const safeBelgeNo = (belgeNo || 'fatura').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const side = /ALIS|ALIŞ/i.test(faturaTuru) ? 'ALIS' : 'SATIS';
    return `${tenantId}/mihsap-invoices/${mukellefId}/${donem}/${side}/${safeBelgeNo}_${mihsapId}.${ext}`;
  }

  /** Fatura metadata'sını DB'ye yaz. Görüntü MIHSAP CDN'inden (mihsapFileLink)
   *  direkt sunulur — S3'e kopyalamaya gerek yok. S3 yapılandırılırsa
   *  ileride burada arşiv kopyası eklenebilir. */
  private async downloadAndStore(
    tenantId: string,
    mukellefId: string,
    item: MihsapInvoiceSummary,
    donem: string,
  ): Promise<{ stored: boolean; skipped?: boolean; reason?: string }> {
    // Daha önce kaydedilmiş mi? mihsapId unique
    const existing = await (this.prisma as any).mihsapInvoice.findUnique({
      where: { mihsapId: String(item.id) },
    });
    if (existing?.mihsapFileLink) {
      return { stored: false, skipped: true, reason: 'already-stored' };
    }

    // S3 upload atlanıyor — MIHSAP CDN (invoice.mihsap.com) auth gerektirmez,
    // frontend mihsapFileLink'i doğrudan <img> src olarak kullanır.
    const storageKey: string | undefined = undefined;
    const storageUrl: string | undefined = undefined;

    const faturaTarihi = item.faturaTarihi
      ? new Date(item.faturaTarihi)
      : item.faturaTarihiStr
        ? this.parseTrDate(item.faturaTarihiStr)
        : new Date();

    await (this.prisma as any).mihsapInvoice.upsert({
      where: { mihsapId: String(item.id) },
      update: {
        tenantId,
        mukellefId,
        mukellefMihsapId: String(item.userFirmaBilgisiId),
        donem,
        faturaTuru: item.faturaTuru,
        belgeTuru: item.belgeTuru,
        faturaNo: item.faturaNo,
        firmaKimlikNo: item.firmaKimlikNo || item.faturaFirmaKimlikNo || null,
        firmaUnvan: item.firmaUnvan || item.faturaFirmaAdi || null,
        faturaTarihi,
        toplamTutar: item.toplamTutar ?? 0,
        onayDurumu: item.onayDurumu || null,
        mihsapFileId: item.fileId ? String(item.fileId) : null,
        mihsapFaturaId: item.faturaId ? String(item.faturaId) : null,
        orjDosyaTuru: item.orjDosyaTuru || null,
        mihsapFileLink: item.fileLink || null,
        ...(storageKey ? { storageKey, storageUrl, downloadedAt: new Date() } : {}),
      },
      create: {
        tenantId,
        mukellefId,
        mukellefMihsapId: String(item.userFirmaBilgisiId),
        donem,
        faturaTuru: item.faturaTuru,
        belgeTuru: item.belgeTuru,
        faturaNo: item.faturaNo,
        firmaKimlikNo: item.firmaKimlikNo || item.faturaFirmaKimlikNo || null,
        firmaUnvan: item.firmaUnvan || item.faturaFirmaAdi || null,
        faturaTarihi,
        toplamTutar: item.toplamTutar ?? 0,
        onayDurumu: item.onayDurumu || null,
        mihsapId: String(item.id),
        mihsapFileId: item.fileId ? String(item.fileId) : null,
        mihsapFaturaId: item.faturaId ? String(item.faturaId) : null,
        orjDosyaTuru: item.orjDosyaTuru || null,
        storageKey: storageKey || null,
        storageUrl: storageUrl || null,
        mihsapFileLink: item.fileLink || null,
        downloadedAt: storageKey ? new Date() : null,
        raw: item as any,
      },
    });

    // mihsapFileLink varsa fatura görüntülenebilir — "stored" olarak say
    return { stored: !!(storageKey || item.fileLink || item.fileDownloadLink) };
  }

  private parseTrDate(s: string): Date {
    const m = s.match(/^(\d{2})[-.\/](\d{2})[-.\/](\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return new Date();
  }

  /** Belirli bir dönemin tüm MIHSAP fatura kayıtlarını siler (yeniden çekme öncesi) */
  async clearPeriod(tenantId: string, mukellefId: string, donem: string) {
    // DB'den sil (S3 kullanılmıyor — dosyalar MIHSAP CDN'inde)
    const { count } = await (this.prisma as any).mihsapInvoice.deleteMany({
      where: { tenantId, mukellefId, donem },
    });
    return { deleted: count };
  }

  /** Kullanıcı "MIHSAP'tan Çek" dediğinde çalışır */
  async fetchAndStoreInvoices(params: {
    tenantId: string;
    mukellefId: string;
    mukellefMihsapId: string;
    donem: string;
    faturaTuru?: 'ALIS' | 'SATIS';
    createdBy?: string;
    forceRefresh?: boolean; // true: önce mevcut kayıtları sil, sonra çek
  }) {
    if (params.forceRefresh) {
      await this.clearPeriod(params.tenantId, params.mukellefId, params.donem);
    }
    const job = await (this.prisma as any).mihsapFetchJob.create({
      data: {
        tenantId: params.tenantId,
        mukellefId: params.mukellefId,
        donem: params.donem,
        faturaTuru: params.faturaTuru || null,
        status: 'running',
        startedAt: new Date(),
        createdBy: params.createdBy || null,
      },
    });

    const sides: Array<'ALIS' | 'SATIS'> = params.faturaTuru
      ? [params.faturaTuru]
      : ['ALIS', 'SATIS'];
    let total = 0;
    let fetched = 0;
    let errorMsg: string | null = null;

    try {
      for (const side of sides) {
        const items = await this.listAllInvoices({
          tenantId: params.tenantId,
          mukellefMihsapId: params.mukellefMihsapId,
          donem: params.donem,
          faturaTuru: side,
        });
        total += items.length;
        // Paralel 3'erli indirme (rate limit dostu)
        const CONCURRENCY = 3;
        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const batch = items.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map((it) =>
              this.downloadAndStore(params.tenantId, params.mukellefId, it, params.donem),
            ),
          );
          fetched += results.filter((r) => r.stored || r.skipped).length;
          await (this.prisma as any).mihsapFetchJob.update({
            where: { id: job.id },
            data: { totalCount: total, fetchedCount: fetched },
          });
        }
      }
    } catch (e: any) {
      errorMsg = e?.message || 'bilinmeyen hata';
      this.logger.error('fetchAndStoreInvoices failed', e);
    }

    await (this.prisma as any).mihsapFetchJob.update({
      where: { id: job.id },
      data: {
        status: errorMsg ? 'failed' : 'done',
        totalCount: total,
        fetchedCount: fetched,
        errorMsg,
        finishedAt: new Date(),
      },
    });

    return { jobId: job.id, total, fetched, errorMsg };
  }

  // ==================== LİSTELEME ====================

  /** Panel için DB'deki indirilmiş faturaları listele */
  async listStoredInvoices(params: {
    tenantId: string;
    mukellefId?: string;
    donem?: string;
    faturaTuru?: string;
    belgeTuru?: string;
    limit?: number;
  }) {
    const where: any = { tenantId: params.tenantId };
    if (params.mukellefId) where.mukellefId = params.mukellefId;
    if (params.donem) where.donem = params.donem;
    if (params.faturaTuru) where.faturaTuru = params.faturaTuru;
    if (params.belgeTuru) where.belgeTuru = params.belgeTuru;

    // Limit: kullanıcı belirtmişse en fazla 10000, hiç belirtmemişse 5000.
    // Büyük mükellef dosyalarında (1500+ fatura/ay) 500 limiti yetersizdi.
    const safeLimit = Math.min(params.limit || 5000, 10000);

    return (this.prisma as any).mihsapInvoice.findMany({
      where,
      orderBy: [{ donem: 'desc' }, { faturaTarihi: 'desc' }],
      take: safeLimit,
    });
  }

  /** Canlı akış log butonundan — belgeNo ile invoice bul */
  async findInvoiceByBelgeNo(
    tenantId: string,
    belgeNo: string,
    mukellefId?: string,
  ): Promise<{ id: string; storageUrl: string | null } | null> {
    const where: any = {
      tenantId,
      OR: [
        { faturaNo: belgeNo },
        { faturaNo: { contains: belgeNo } },
      ],
    };
    if (mukellefId) where.mukellefId = mukellefId;

    const inv = await (this.prisma as any).mihsapInvoice.findFirst({
      where,
      select: { id: true, storageUrl: true, mihsapFileLink: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!inv) return null;
    return { id: inv.id, storageUrl: inv.storageUrl || inv.mihsapFileLink || null };
  }

  /** Bir faturanın binary içeriğini getir (proxy — CORS bypass).
   *  Frontend `fetch()` MIHSAP CDN'e direkt gidemez; backend aracı olur.
   *  Başarısızsa reason ile birlikte exception atar — 404 yerine 502 dönülür.
   */
  async getInvoiceFile(
    tenantId: string,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) {
      throw new BadRequestException(`Fatura kaydı bulunamadı (${invoiceId})`);
    }

    // URL'yi hazırla — S3 artık kullanılmıyor, doğrudan MIHSAP CDN link'ini kullan.
    // (Eski kayıtlarda `storageKey` dolu olabilir ama S3 bucket erişilemez; o yüzden atla.)
    let url: string | null = null;
    if (inv.mihsapFileLink) {
      url = inv.mihsapFileLink.startsWith('http')
        ? inv.mihsapFileLink
        : `${MIHSAP_BASE}${inv.mihsapFileLink.startsWith('/') ? '' : '/'}${inv.mihsapFileLink}`;
    }
    if (!url) {
      throw new BadRequestException(
        `Fatura ${invoiceId} için MIHSAP indirme bağlantısı yok (mihsapFileLink boş). Faturaları yeniden çekmeniz gerekebilir.`,
      );
    }

    this.logger.log(`Fatura ${invoiceId} indiriliyor: ${url.slice(0, 150)}`);

    // MIHSAP token'ı varsa auth header olarak dene
    let mihsapToken: string | null = null;
    try {
      mihsapToken = await this.getToken(tenantId);
    } catch {
      /* token yoksa auth'suz dene */
    }

    const tryFetch = async (headers: Record<string, string>): Promise<Response> => {
      return fetch(url!, { headers });
    };

    const baseHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: `${MIHSAP_BASE}/`,
      Origin: MIHSAP_BASE,
    };

    let res: Response;
    try {
      // 1. Deneme: auth'suz
      res = await tryFetch(baseHeaders);
      if (!res.ok && mihsapToken) {
        // 2. Deneme: Bearer token ile
        this.logger.log(`Fatura ${invoiceId}: auth'suz ${res.status}, Bearer token ile deneniyor`);
        res = await tryFetch({
          ...baseHeaders,
          Authorization: `Bearer ${mihsapToken}`,
          Cookie: `jwt=${mihsapToken}; Auth=${mihsapToken}`,
        });
      }
    } catch (e: any) {
      throw new BadRequestException(
        `MIHSAP'a bağlanılamadı: ${e?.message || 'network hatası'}`,
      );
    }

    if (!res.ok) {
      // Yanıt gövdesinden ipucu al
      let body = '';
      try {
        body = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      this.logger.warn(
        `Fatura ${invoiceId} HTTP ${res.status}: ${body.slice(0, 100)}`,
      );
      throw new BadRequestException(
        `MIHSAP CDN ${res.status} döndü (${res.statusText}). URL: ${url.slice(0, 80)}. Body: ${body.slice(0, 80)}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType =
      res.headers.get('content-type') ||
      this.guessContentType(inv.orjDosyaTuru || url) ||
      'application/octet-stream';

    const ext = this.extFromUrlOrType(url, inv.orjDosyaTuru);
    const filename = `${inv.faturaNo || invoiceId}.${ext}`;
    return { buffer, contentType, filename };
  }

  private extFromUrlOrType(url: string, orjType?: string | null): string {
    const fromType = (orjType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['jpg', 'jpeg', 'png', 'pdf', 'xml'].includes(fromType)) return fromType;
    const linkExt = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'pdf', 'xml'].includes(linkExt)) return linkExt;
    return 'bin';
  }

  private guessContentType(hint: string): string | null {
    const s = hint.toLowerCase();
    if (s.endsWith('.jpg') || s.endsWith('.jpeg') || s === 'jpeg' || s === 'jpg') return 'image/jpeg';
    if (s.endsWith('.png') || s === 'png') return 'image/png';
    if (s.endsWith('.pdf') || s === 'pdf') return 'application/pdf';
    if (s.endsWith('.xml') || s === 'xml') return 'application/xml';
    return null;
  }

  /** Bir faturanın görüntüleme URL'ini döndür.
   *  S3 artık kullanılmıyor; doğrudan MIHSAP CDN link'i döndürülür.
   */
  async getInvoiceDownloadUrl(tenantId: string, invoiceId: string): Promise<string | null> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) return null;

    // MIHSAP CDN URL'i (auth gerektirmez, path hash ile korumalı)
    if (inv.mihsapFileLink) {
      return inv.mihsapFileLink;
    }

    return null;
  }

  /** DEBUG — DB kayıt + ham MIHSAP payload'u. Hangi tarih alanı kabul tarihi
   *  onu anlamak için. */
  async getInvoiceRaw(tenantId: string, invoiceId: string) {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) return { error: 'bulunamadı' };
    // Ham payload içindeki tüm tarih benzeri alanları öne çıkar
    const raw = inv.raw || {};
    const dateFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw as Record<string, any>)) {
      if (/tarih|date|time/i.test(k)) dateFields[k] = v;
    }
    return {
      db: {
        id: inv.id,
        faturaNo: inv.faturaNo,
        faturaTarihi: inv.faturaTarihi,
        donem: inv.donem,
        createdAt: inv.createdAt,
        downloadedAt: inv.downloadedAt,
      },
      rawDateFields: dateFields,
      rawFull: raw,
    };
  }

  /** Son çekme işlerini listele (progress gösterimi için) */
  async listFetchJobs(tenantId: string, limit = 20) {
    // Stale job'ları temizle: 5 dk'dan uzun süredir "running" olan job'ları fail yap
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    await (this.prisma as any).mihsapFetchJob.updateMany({
      where: {
        tenantId,
        status: 'running',
        startedAt: { lt: fiveMinAgo },
      },
      data: {
        status: 'failed',
        errorMsg: 'Zaman aşımı – sunucu yeniden başlatıldı',
        finishedAt: new Date(),
      },
    });

    return (this.prisma as any).mihsapFetchJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
