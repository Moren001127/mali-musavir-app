import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VendorMemoryService } from '../vendor-memory/vendor-memory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

/**
 * Onay Kuyrugu — AI sapma tespit ettiginde PendingDecision olusturur,
 * insan onayi beklenir. Onay veya Red, VendorMemory'ye de yansir.
 */
@Injectable()
export class PendingDecisionsService {
  private readonly logger = new Logger(PendingDecisionsService.name);

  constructor(
    private prisma: PrismaService,
    private vendorMemory: VendorMemoryService,
    private notifications: NotificationsService,
  ) {}

  /** Yeni bekleyen karar olustur (decideFatura / decideIsletme icinden cagrilir) */
  async create(params: {
    tenantId: string;
    taxpayerId?: string | null;
    mukellef?: string | null;
    firmaKimlikNo?: string | null;
    firmaUnvan?: string | null;
    belgeNo?: string | null;
    belgeTuru?: string | null;
    faturaTarihi?: Date | string | null;
    tutar?: number | null;
    kararTipi: 'fatura' | 'isletme';
    aiKarari: any; // AI'nin tam cevabi (karar+sebep+kategori+...)
    gecmisBeklenen?: any;
    sapmaSebep: string;
    imageBase64?: string | null;
  }) {
    const {
      tenantId,
      taxpayerId,
      mukellef,
      firmaKimlikNo,
      firmaUnvan,
      belgeNo,
      belgeTuru,
      faturaTarihi,
      tutar,
      kararTipi,
      aiKarari,
      gecmisBeklenen,
      sapmaSebep,
      imageBase64,
    } = params;

    if (!tenantId) throw new BadRequestException('tenantId yok');
    if (!kararTipi) throw new BadRequestException('kararTipi yok');
    if (!aiKarari) throw new BadRequestException('aiKarari yok');

    const tarih = faturaTarihi ? new Date(faturaTarihi) : null;

    const existing = await (this.prisma as any).pendingDecision.findFirst({
      where: {
        tenantId,
        taxpayerId: taxpayerId || null,
        firmaKimlikNo: firmaKimlikNo || null,
        belgeNo: belgeNo || null,
        kararTipi,
        durum: 'bekliyor',
      },
      select: {
        id: true,
        durum: true,
        sapmaSebep: true,
      },
    });
    if (existing) return existing;

    const created = await (this.prisma as any).pendingDecision.create({
      data: {
        tenantId,
        taxpayerId: taxpayerId || null,
        mukellef: mukellef || null,
        firmaKimlikNo: firmaKimlikNo || null,
        firmaUnvan: firmaUnvan || null,
        belgeNo: belgeNo || null,
        belgeTuru: belgeTuru || null,
        faturaTarihi: tarih && !isNaN(tarih.getTime()) ? tarih : null,
        tutar: tutar != null ? tutar : null,
        kararTipi,
        aiKarari,
        gecmisBeklenen: gecmisBeklenen || null,
        sapmaSebep: (sapmaSebep || '').slice(0, 500),
        imageBase64: imageBase64 || null,
        durum: 'bekliyor',
      },
      select: {
        id: true,
        durum: true,
        sapmaSebep: true,
      },
    });

    // === IN-APP BILDIRIM: Yeni onay bekleyen karar ===
    try {
      const firmaLabel = firmaUnvan || firmaKimlikNo || 'firma';
      const mukellefLabel = mukellef || 'mükellef';
      const tutarLabel = tutar != null ? ` (${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL)` : '';
      await this.notifications.createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.PENDING_DECISION,
        title: `⏳ Onay bekliyor: ${mukellefLabel} - ${firmaLabel}${tutarLabel}`,
        body: `${kararTipi === 'fatura' ? 'Fatura' : 'İşletme'} kararı — ${(sapmaSebep || '').slice(0, 200)}`,
        metadata: {
          pendingDecisionId: created.id,
          taxpayerId: taxpayerId || null,
          firmaKimlikNo: firmaKimlikNo || null,
          firmaUnvan: firmaUnvan || null,
          belgeNo: belgeNo || null,
          kararTipi,
          link: `/panel/onay-bekleyen?id=${created.id}`,
        },
        dedupeKey: `pending-decision:${created.id}`,
        dedupeWindowMin: 60 * 24,
      });
    } catch (e) {
      this.logger.warn(`PENDING_DECISION notif failed: ${(e as Error).message}`);
    }

    return created;
  }

  /** Bekleyenler listesi (ve onaylanmislar/reddedilenler dahil — durum filter) */
  async list(tenantId: string, opts: { durum?: string; limit?: number } = {}) {
    const { durum, limit = 100 } = opts;
    const where: any = { tenantId };
    if (durum) where.durum = durum;
    // imageBase64 listeden cikariliyor (payload buyuk) — detay endpoint'te getirilir
    return (this.prisma as any).pendingDecision.findMany({
      where,
      orderBy: [{ durum: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(500, Math.max(1, limit)),
      select: {
        id: true,
        mukellef: true,
        firmaKimlikNo: true,
        firmaUnvan: true,
        belgeNo: true,
        belgeTuru: true,
        faturaTarihi: true,
        tutar: true,
        kararTipi: true,
        aiKarari: true,
        gecmisBeklenen: true,
        sapmaSebep: true,
        durum: true,
        sonucKarari: true,
        onayAlan: true,
        onayTarihi: true,
        notlar: true,
        createdAt: true,
      },
    });
  }

  /** Tek bekleyen karar detayi (gorsel dahil) */
  async detail(tenantId: string, id: string) {
    const row = await (this.prisma as any).pendingDecision.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Bekleyen karar bulunamadi');
    return row;
  }

  /** Bekleyen onaylari say (badge icin) */
  async countBekleyen(tenantId: string): Promise<number> {
    return (this.prisma as any).pendingDecision.count({
      where: { tenantId, durum: 'bekliyor' },
    });
  }

  /**
   * AI kararini onayla (optionally override ile).
   * override verilmezse aiKarari final karar olur.
   * override verilirse kullanicinin verdigi kategori final karar olur.
   */
  async onayla(params: {
    tenantId: string;
    id: string;
    userId?: string;
    override?: {
      kategori: string;
      altKategori?: string | null;
    };
    notlar?: string;
  }) {
    const { tenantId, id, userId, override, notlar } = params;
    const row = await (this.prisma as any).pendingDecision.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Bekleyen karar bulunamadi');
    if (row.durum !== 'bekliyor') {
      throw new BadRequestException(`Karar zaten "${row.durum}" durumunda, tekrar onaylanamaz`);
    }

    // Final kategori: override varsa onu kullan, yoksa AI karari
    const aiKarari = row.aiKarari || {};
    let finalKategori: string;
    let finalAltKategori: string | null;
    if (override && override.kategori) {
      finalKategori = override.kategori.trim();
      finalAltKategori = override.altKategori ? override.altKategori.trim() : null;
    } else {
      // decideFatura: aiKarari.hesapKodu varsa kullan, yoksa aiKarari.kategori
      // decideIsletme: aiKarari.kayitTuru + altTuru
      if (row.kararTipi === 'fatura') {
        finalKategori = (aiKarari.hesapKodu || aiKarari.kategori || '').trim();
        finalAltKategori = null;
      } else {
        finalKategori = (aiKarari.kayitTuru || '').trim();
        finalAltKategori = (aiKarari.altTuru || '').trim() || null;
      }
    }

    if (!finalKategori) {
      throw new BadRequestException('Final kategori bos, override ile ver veya AI kararindan al');
    }

    const sonuc = {
      kategori: finalKategori,
      altKategori: finalAltKategori,
      override: !!override,
    };

    // Transaction: pending durumunu onayla + VendorMemory'ye kaydet
    const updated = await (this.prisma as any).pendingDecision.update({
      where: { id },
      data: {
        durum: 'onaylandi',
        sonucKarari: sonuc,
        onayAlan: userId || null,
        onayTarihi: new Date(),
        notlar: notlar || null,
      },
    });

    // VendorMemory'ye yansit — insan onaylayinca bu karar firma+mükellef için öğrenilir
    if (row.firmaKimlikNo) {
      await this.vendorMemory.recordDecision({
        tenantId,
        firmaKimlikNo: row.firmaKimlikNo,
        firmaUnvan: row.firmaUnvan,
        kararTipi: row.kararTipi as 'fatura' | 'isletme',
        kategori: finalKategori,
        altKategori: finalAltKategori,
        taxpayerId: (row as any).taxpayerId || null, // Mükellef-bazlı kayıt
      });
    }

    return updated;
  }

  /** Bekleyen karari reddet — VendorMemory'ye yansitma */
  async reddet(params: { tenantId: string; id: string; userId?: string; notlar?: string }) {
    const { tenantId, id, userId, notlar } = params;
    const row = await (this.prisma as any).pendingDecision.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Bekleyen karar bulunamadi');
    if (row.durum !== 'bekliyor') {
      throw new BadRequestException(`Karar zaten "${row.durum}" durumunda, tekrar reddedilemez`);
    }
    return (this.prisma as any).pendingDecision.update({
      where: { id },
      data: {
        durum: 'reddedildi',
        onayAlan: userId || null,
        onayTarihi: new Date(),
        notlar: notlar || null,
      },
    });
  }
}
