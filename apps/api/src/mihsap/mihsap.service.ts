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

  /** Tüm sayfaları çek (pagination loop) — toplam < 2000 kayıt için safe */
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
      if (pageIndex > 50) break; // safety
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

  /** Tek bir faturanın JPEG'ini MIHSAP'tan indir + S3'e koy + DB'ye yaz */
  private async downloadAndStore(
    tenantId: string,
    mukellefId: string,
    item: MihsapInvoiceSummary,
    donem: string,
  ): Promise<{ stored: boolean; skipped?: boolean; reason?: string }> {
    // Daha önce yüklenmiş mi? mihsapId unique
    const existing = await (this.prisma as any).mihsapInvoice.findUnique({
      where: { mihsapId: String(item.id) },
    });
    if (existing?.storageKey) {
      return { stored: false, skipped: true, reason: 'already-stored' };
    }

    const fileUrl = item.fileDownloadLink || item.fileLink;
    let storageKey: string | undefined;
    let storageUrl: string | undefined;
    if (fileUrl) {
      try {
        // MIHSAP fatura CDN'i (invoice.mihsap.com) Bearer auth BEKLEMEZ.
        // Path'teki tenant hash'i güvenlik olarak yeterli. Header gönderirsek
        // bazı proxy'ler HTML redirect/error döndürebiliyor — o yüzden auth'suz
        // fetch atıyoruz.
        const r = await fetch(fileUrl, { redirect: 'follow' });

        // Content-type kontrolü: gelen dosya gerçekten bir görsel/PDF/XML mi?
        const ctype = (r.headers.get('content-type') || '').toLowerCase();
        const isValidContent =
          ctype.startsWith('image/') ||
          ctype.includes('pdf') ||
          ctype.includes('xml') ||
          ctype.includes('octet-stream');

        if (!r.ok) {
          this.logger.warn(
            `MIHSAP file download failed ${r.status} for ${item.faturaNo} (${fileUrl})`,
          );
        } else if (!isValidContent) {
          // HTML login sayfası veya redirect body — kaydetme
          this.logger.warn(
            `MIHSAP file returned non-file content-type "${ctype}" for ${item.faturaNo}; skipping storage`,
          );
        } else {
          const buf = Buffer.from(await r.arrayBuffer());
          // Ek sanity check: dosya çok küçükse (<512B) muhtemelen hata sayfasıdır
          if (buf.length < 512) {
            this.logger.warn(
              `MIHSAP file too small (${buf.length}B) for ${item.faturaNo}; skipping storage`,
            );
          } else {
            // URL her zaman .jpg uzantılı geliyor (MIHSAP e-fatura XML'i bile
            // JPEG render eder). Ama orjDosyaTuru farklıysa onu da saklayalım.
            const urlExt = (fileUrl.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
            const orjType = (item.orjDosyaTuru || '').toUpperCase();
            // Gerçek dosya tipi: önce content-type, sonra URL uzantısı
            let ext: string;
            let mime: string;
            if (ctype.startsWith('image/')) {
              ext = ctype.includes('png') ? 'png' : 'jpg';
              mime = ctype;
            } else if (ctype.includes('pdf')) {
              ext = 'pdf';
              mime = 'application/pdf';
            } else if (ctype.includes('xml')) {
              ext = 'xml';
              mime = 'application/xml';
            } else {
              // octet-stream fallback → URL uzantısına bak
              ext = urlExt;
              mime =
                urlExt === 'xml'
                  ? 'application/xml'
                  : urlExt === 'pdf'
                    ? 'application/pdf'
                    : 'image/jpeg';
            }

            storageKey = this.buildStorageKey(
              tenantId,
              mukellefId,
              donem,
              item.faturaNo,
              ext,
              item.faturaTuru,
              item.id,
            );
            await this.storage.putBuffer(storageKey, buf, mime, {
              'mihsap-id': String(item.id),
              'belge-no': item.faturaNo,
              'orj-dosya-turu': orjType || 'UNKNOWN',
            });
            storageUrl = storageKey; // Presigned URL istendiğinde üretilir
          }
        }
      } catch (e: any) {
        this.logger.warn(`MIHSAP file download exception: ${e?.message}`);
      }
    }

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

    return { stored: !!storageKey };
  }

  private parseTrDate(s: string): Date {
    const m = s.match(/^(\d{2})[-.\/](\d{2})[-.\/](\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return new Date();
  }

  /** Belirli bir dönemin tüm MIHSAP fatura kayıtlarını + S3 dosyalarını siler (yeniden indirme öncesi) */
  async clearPeriod(tenantId: string, mukellefId: string, donem: string) {
    const existing = await (this.prisma as any).mihsapInvoice.findMany({
      where: { tenantId, mukellefId, donem },
      select: { id: true, storageKey: true },
    });
    // S3/MinIO'dan sil
    for (const inv of existing) {
      if (inv.storageKey) {
        try {
          await this.storage.deleteObject(inv.storageKey);
        } catch (e) {
          this.logger.warn(`S3 delete failed: ${inv.storageKey}`);
        }
      }
    }
    // DB'den sil
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
    limit?: number;
  }) {
    const where: any = { tenantId: params.tenantId };
    if (params.mukellefId) where.mukellefId = params.mukellefId;
    if (params.donem) where.donem = params.donem;
    if (params.faturaTuru) where.faturaTuru = params.faturaTuru;

    return (this.prisma as any).mihsapInvoice.findMany({
      where,
      orderBy: [{ donem: 'desc' }, { faturaTarihi: 'desc' }],
      take: params.limit || 200,
    });
  }

  /** Bir faturanın presigned download URL'ini döndür */
  async getInvoiceDownloadUrl(tenantId: string, invoiceId: string): Promise<string | null> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) return null;
    if (!inv.storageKey) return null;
    // storageKey sonunda gerçek dosya uzantısı (jpg/pdf/xml) mevcut — onu kullan
    const keyExt = (inv.storageKey.split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'pdf', 'xml'].includes(keyExt) ? keyExt : 'jpg';
    return this.storage.getPresignedDownloadUrl(
      inv.storageKey,
      `${inv.faturaNo}.${safeExt}`,
    );
  }

  /** Son çekme işlerini listele (progress gösterimi için) */
  async listFetchJobs(tenantId: string, limit = 20) {
    return (this.prisma as any).mihsapFetchJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
