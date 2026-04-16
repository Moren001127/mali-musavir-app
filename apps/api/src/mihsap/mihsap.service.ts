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

  /** Bir faturanın görüntüleme URL'ini döndür.
   *  Öncelik: 1) S3 presigned URL (eğer arşivlenmişse)
   *           2) MIHSAP CDN direkt URL'i (fallback — auth gerektirmez)
   */
  async getInvoiceDownloadUrl(tenantId: string, invoiceId: string): Promise<string | null> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) return null;

    if (inv.storageKey) {
      // storageKey sonunda gerçek dosya uzantısı (jpg/pdf/xml) mevcut — onu kullan
      const keyExt = (inv.storageKey.split('.').pop() || 'jpg').toLowerCase();
      const safeExt = ['jpg', 'jpeg', 'png', 'pdf', 'xml'].includes(keyExt) ? keyExt : 'jpg';
      try {
        return await this.storage.getPresignedDownloadUrl(
          inv.storageKey,
          `${inv.faturaNo}.${safeExt}`,
        );
      } catch (e: any) {
        // S3 erişilemez durumdaysa fallback'e düş
        this.logger.warn(`Presigned URL üretilemedi, MIHSAP fallback: ${e?.message}`);
      }
    }

    // Fallback: MIHSAP CDN URL'i (auth gerektirmez, path hash ile korumalı)
    if (inv.mihsapFileLink) {
      return inv.mihsapFileLink;
    }

    return null;
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
