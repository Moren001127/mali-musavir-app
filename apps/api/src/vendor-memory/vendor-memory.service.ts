import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vendor Memory — her firma (VKN/TCKN) için AI kararları hafızada tutulur.
 *
 * HİBRİT YAPI (2026-04-20 migration):
 *  - VendorMemory: tenant geneli — firma kimliği, unvan ortak
 *  - VendorMemoryDecision: MÜKELLEF-BAZLI — her mükellef kendi hesap kodunu öğrenir
 *    (örn. CK BOĞAZİÇİ ELEKTRİK → TAHİR SUCU: 740, MUHARREM DEMİR: 770)
 *
 * Akış:
 *  1. getHintForVendor(tenantId, firma, kararTipi, taxpayerId) — mükellef-bazlı öneriler
 *  2. AI karar verir
 *  3. detectDeviation — mükellef için geçmişte onaylanan kategoriyle eşleşme kontrolü
 *  4. recordDecision(taxpayerId dâhil) — sapma yoksa sayaç artar
 */
@Injectable()
export class VendorMemoryService {
  private readonly MIN_ONAY_FOR_HINT = 3;
  private readonly TOP_N_KATEGORI = 3;

  constructor(private prisma: PrismaService) {}

  /**
   * Firma+Mükellef için hint metni oluştur. 3+ onay yoksa null döner.
   * taxpayerId verilirse mükellef-bazlı kararlar öncelikli; yoksa tüm ortak kararlar.
   */
  async getHintForVendor(
    tenantId: string,
    firmaKimlikNo: string | null | undefined,
    kararTipi: 'fatura' | 'isletme',
    taxpayerId?: string | null,
  ): Promise<{ hintText: string; memoryId: string; topKategoriler: Array<{ kategori: string; altKategori: string | null; onayAdedi: number }> } | null> {
    if (!firmaKimlikNo) return null;
    const normalized = firmaKimlikNo.trim();
    if (!normalized) return null;

    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: normalized } },
      include: {
        decisions: {
          where: {
            kararTipi,
            // Mükellef-bazlı: önce bu mükellefin kararlarına bak. Yoksa NULL (ortak) kararlara fallback.
            ...(taxpayerId
              ? { OR: [{ taxpayerId }, { taxpayerId: null }] }
              : {}),
          },
          orderBy: { onayAdedi: 'desc' },
          take: this.TOP_N_KATEGORI * 2, // taxpayer + null karışık olabilir, fazla al
        },
      },
    });

    if (!memory || !memory.decisions || memory.decisions.length === 0) return null;

    // Eğer mükellef-bazlı kararlar varsa ÖNCELİK onlarda; yoksa ortak (NULL) fallback
    let decisions = memory.decisions;
    if (taxpayerId) {
      const mukellefKararlar = decisions.filter((d: any) => d.taxpayerId === taxpayerId);
      if (mukellefKararlar.length > 0) {
        decisions = mukellefKararlar;
      } else {
        // Mükellef için veri yok; ortak NULL kararları fallback kullan (daha zayıf sinyal)
        decisions = decisions.filter((d: any) => d.taxpayerId === null);
      }
    }
    decisions = decisions.slice(0, this.TOP_N_KATEGORI);

    const toplam = decisions.reduce((s: number, d: any) => s + (d.onayAdedi || 0), 0);
    if (toplam < this.MIN_ONAY_FOR_HINT) return null;

    const firmaAdi = memory.firmaUnvan || normalized;
    const mukellefInfo = taxpayerId && decisions.some((d: any) => d.taxpayerId === taxpayerId)
      ? ' (bu mükellef için)'
      : ' (bu ofisin geçmişinden)';

    const kategoriSatirlari = decisions
      .map((d: any) => {
        const label = d.altKategori ? `${d.kategori} → ${d.altKategori}` : d.kategori;
        return `  - "${label}" : ${d.onayAdedi} kez onaylandı`;
      })
      .join('\n');

    const hintText = `### FIRMA HAFIZASI (${firmaAdi} - VKN/TCKN: ${normalized})${mukellefInfo} ###
Bu firma için geçmişte ${toplam} karar kaydedildi. En çok onaylanan kategoriler:
${kategoriSatirlari}

**KURAL - OVERRIDE:**
Bu bilgi sadece İPUCUDUR, zorunluluk değildir. ÖNCE faturanın içeriğini oku.
Eğer içerik geçmişte onaylanan kategoriyle aynıysa → kararında bu hint'i pekiştirici kullan.
Eğer içerik farklıysa (örnek: her zaman akaryakıt faturası gelen firmadan bu sefer makine satış faturası) → hint'i GÖRMEZDEN GEL, gerçek içeriğe göre karar ver.
Yanlış ipucuna uyup yanlış karar vermek, ipucu olmamasından DAHA KÖTÜDÜR.
### /FIRMA HAFIZASI ###
`;

    return {
      hintText,
      memoryId: memory.id,
      topKategoriler: decisions.map((d: any) => ({
        kategori: d.kategori,
        altKategori: d.altKategori,
        onayAdedi: d.onayAdedi,
      })),
    };
  }

  /**
   * Karar tamamlanınca hafızayı güncelle. Firma tenant geneli, karar mükellef-bazlı.
   */
  async recordDecision(params: {
    tenantId: string;
    firmaKimlikNo: string | null | undefined;
    firmaUnvan?: string | null;
    kararTipi: 'fatura' | 'isletme';
    kategori: string;
    altKategori?: string | null;
    taxpayerId?: string | null;   // YENİ: hangi mükellef bu kararı verdi
  }): Promise<void> {
    const { tenantId, firmaKimlikNo, firmaUnvan, kararTipi, kategori, altKategori, taxpayerId } = params;
    if (!firmaKimlikNo) return;
    const vkn = firmaKimlikNo.trim();
    if (!vkn || !kategori) return;

    // Upsert VendorMemory (tenant geneli — mükellef bağımsız)
    const memory = await (this.prisma as any).vendorMemory.upsert({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vkn } },
      create: {
        tenantId,
        firmaKimlikNo: vkn,
        firmaUnvan: firmaUnvan || null,
        toplamOnay: 1,
        sonKullanim: new Date(),
      },
      update: {
        toplamOnay: { increment: 1 },
        sonKullanim: new Date(),
        firmaUnvan: firmaUnvan || undefined,
      },
    });

    // VendorMemoryDecision — (vendorMemoryId + taxpayerId + kategori + altKategori) anahtar
    const existing = await (this.prisma as any).vendorMemoryDecision.findFirst({
      where: {
        vendorMemoryId: memory.id,
        taxpayerId: taxpayerId || null,
        kararTipi,
        kategori,
        altKategori: altKategori || null,
      },
    });

    if (existing) {
      await (this.prisma as any).vendorMemoryDecision.update({
        where: { id: existing.id },
        data: {
          onayAdedi: { increment: 1 },
          sonKullanim: new Date(),
        },
      });
    } else {
      await (this.prisma as any).vendorMemoryDecision.create({
        data: {
          vendorMemoryId: memory.id,
          taxpayerId: taxpayerId || null,
          kararTipi,
          kategori,
          altKategori: altKategori || null,
          onayAdedi: 1,
          sonKullanim: new Date(),
        },
      });
    }
  }

  /** AI kararı geçmişle eşleşiyor mu? Sapma tespit. */
  detectDeviation(params: {
    topKategoriler: Array<{ kategori: string; altKategori: string | null; onayAdedi: number }>;
    aiKategori: string;
    aiAltKategori?: string | null;
  }): { isSapma: boolean; sebep: string; enCokGecmisKategori?: string; enCokGecmisOnaySayisi?: number } {
    const { topKategoriler, aiKategori, aiAltKategori } = params;
    if (!topKategoriler || topKategoriler.length === 0) {
      return { isSapma: false, sebep: '' };
    }

    const aiKategoriNorm = (aiKategori || '').trim();
    const aiAltNorm = (aiAltKategori || '').trim() || null;

    const match = topKategoriler.find(
      (t) =>
        t.kategori.trim() === aiKategoriNorm &&
        (t.altKategori || null) === aiAltNorm,
    );
    if (match) {
      return { isSapma: false, sebep: '' };
    }

    const enCok = topKategoriler[0];
    const enCokLabel = enCok.altKategori ? `${enCok.kategori} → ${enCok.altKategori}` : enCok.kategori;
    const aiLabel = aiAltNorm ? `${aiKategoriNorm} → ${aiAltNorm}` : aiKategoriNorm;
    return {
      isSapma: true,
      sebep: `Bu firma için geçmişte en çok "${enCokLabel}" (${enCok.onayAdedi} kez) onaylandı, AI bu sefer "${aiLabel}" önerdi.`,
      enCokGecmisKategori: enCokLabel,
      enCokGecmisOnaySayisi: enCok.onayAdedi,
    };
  }

  /**
   * Panel listesi — her firma için mükellef-bazlı dağılım bilgisi de döner.
   */
  async listVendorMemory(tenantId: string, opts: { search?: string; limit?: number } = {}) {
    const { search, limit = 200 } = opts;
    const where: any = { tenantId };
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { firmaKimlikNo: { contains: q, mode: 'insensitive' } },
        { firmaUnvan: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await (this.prisma as any).vendorMemory.findMany({
      where,
      orderBy: [{ toplamOnay: 'desc' }, { sonKullanim: 'desc' }],
      take: limit,
      include: {
        decisions: {
          orderBy: { onayAdedi: 'desc' },
          take: 50,
          include: {
            taxpayer: {
              select: { id: true, firstName: true, lastName: true, companyName: true, type: true },
            },
          },
        },
      },
    });

    // Her firma için mükellef özeti üret: "TAHİR SUCU: 7, MUHARREM DEMİR: 2, ortak: 1"
    return rows.map((row: any) => {
      const mukellefGrup: Record<string, { taxpayerId: string | null; ad: string; onayAdedi: number }> = {};
      for (const d of row.decisions || []) {
        const key = d.taxpayerId || '__ortak__';
        const ad = d.taxpayer
          ? taxpayerAd(d.taxpayer)
          : '(ortak — mükellef atanmamış eski karar)';
        if (!mukellefGrup[key]) {
          mukellefGrup[key] = { taxpayerId: d.taxpayerId, ad, onayAdedi: 0 };
        }
        mukellefGrup[key].onayAdedi += d.onayAdedi || 0;
      }
      const mukellefler = Object.values(mukellefGrup).sort((a, b) => b.onayAdedi - a.onayAdedi);
      return { ...row, mukellefler };
    });
  }

  /** Tek firma detayı — mükellef bazlı kategori dağılımı ile. */
  async getVendorDetail(tenantId: string, firmaKimlikNo: string) {
    const row = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo } },
      include: {
        decisions: {
          orderBy: [{ onayAdedi: 'desc' }],
          include: {
            taxpayer: {
              select: { id: true, firstName: true, lastName: true, companyName: true, type: true },
            },
          },
        },
      },
    });
    if (!row) return null;

    // Mükellef bazlı grupla
    const mukellefMap: Record<string, {
      taxpayerId: string | null;
      ad: string;
      toplamOnay: number;
      kategoriler: Array<{ kategori: string; altKategori: string | null; kararTipi: string; onayAdedi: number; sonKullanim: Date }>;
    }> = {};

    for (const d of row.decisions || []) {
      const key = d.taxpayerId || '__ortak__';
      const ad = d.taxpayer
        ? taxpayerAd(d.taxpayer)
        : '(ortak — mükellef atanmamış eski karar)';
      if (!mukellefMap[key]) {
        mukellefMap[key] = { taxpayerId: d.taxpayerId, ad, toplamOnay: 0, kategoriler: [] };
      }
      mukellefMap[key].toplamOnay += d.onayAdedi || 0;
      mukellefMap[key].kategoriler.push({
        kategori: d.kategori,
        altKategori: d.altKategori,
        kararTipi: d.kararTipi,
        onayAdedi: d.onayAdedi,
        sonKullanim: d.sonKullanim,
      });
    }

    const mukellefler = Object.values(mukellefMap).sort((a, b) => b.toplamOnay - a.toplamOnay);
    return { ...row, mukellefler };
  }

  /**
   * Backfill: taxpayerId=null olan tüm VendorMemoryDecision kayıtlarını
   * AgentEvent tablosundan çapraz bakarak mükelleflere bağlar.
   *
   * Mantık:
   *  1. Her "ortak" decision için VendorMemory.firmaUnvan al
   *  2. AgentEvent'ta `firma` alanı eşleşen kayıtları bul, `mukellef` adlarını topla
   *  3. En çok geçen mukellef'i tespit et
   *  4. Taxpayer tablosunda o ad ile mükellef ara, bulursan decision.taxpayerId'yi set et
   *  5. Bulunamayan decisions olduğu gibi kalır (silinmez)
   */
  async backfillMukellefIds(tenantId: string): Promise<{
    taranan: number;
    eslesti: number;
    eslesmeyenFirmalar: number;
    mukellefBulunamayan: number;
  }> {
    const ortakDecisions = await (this.prisma as any).vendorMemoryDecision.findMany({
      where: {
        taxpayerId: null,
        vendorMemory: { tenantId },
      },
      include: { vendorMemory: true },
    });

    let eslesti = 0;
    let eslesmeyenFirmalar = 0;
    let mukellefBulunamayan = 0;

    // Firma başına grupla (aynı firma için birden fazla decision olabilir)
    const firmaGrup: Record<string, { decisions: any[]; firmaUnvan: string }> = {};
    for (const d of ortakDecisions) {
      const unvan = d.vendorMemory?.firmaUnvan || '';
      if (!unvan) continue;
      if (!firmaGrup[unvan]) firmaGrup[unvan] = { decisions: [], firmaUnvan: unvan };
      firmaGrup[unvan].decisions.push(d);
    }

    for (const [unvan, grup] of Object.entries(firmaGrup)) {
      // AgentEvent'ta bu firma için hangi mükellef en sık işlemiş?
      const eventler = await this.prisma.agentEvent.findMany({
        where: {
          tenantId,
          firma: { equals: unvan, mode: 'insensitive' },
          mukellef: { not: null },
        },
        select: { mukellef: true },
        take: 500,
      });

      if (eventler.length === 0) {
        eslesmeyenFirmalar++;
        continue;
      }

      // En çok geçen mukellef adı
      const sayac: Record<string, number> = {};
      for (const e of eventler) {
        const m = (e.mukellef || '').trim();
        if (!m) continue;
        sayac[m] = (sayac[m] || 0) + 1;
      }
      const enCokMukellef = Object.entries(sayac).sort(([, a], [, b]) => b - a)[0]?.[0];
      if (!enCokMukellef) {
        eslesmeyenFirmalar++;
        continue;
      }

      // Taxpayer bul (companyName ile)
      const taxpayer = await this.prisma.taxpayer.findFirst({
        where: {
          tenantId,
          OR: [
            { companyName: { equals: enCokMukellef, mode: 'insensitive' } },
            { companyName: { contains: enCokMukellef, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });

      if (!taxpayer) {
        mukellefBulunamayan++;
        continue;
      }

      // Bu firmanın tüm ortak decisions'larını mukellef'e bağla
      for (const d of grup.decisions) {
        try {
          await (this.prisma as any).vendorMemoryDecision.update({
            where: { id: d.id },
            data: { taxpayerId: taxpayer.id },
          });
          eslesti++;
        } catch {
          // unique constraint hatası — aynı mukellef+firma+kategori için zaten kayıt varsa
          // eski ortak kaydı sil (verileri yeni kayda taşımak yerine basit: sil)
          try {
            await (this.prisma as any).vendorMemoryDecision.delete({ where: { id: d.id } });
          } catch {}
        }
      }
    }

    return {
      taranan: ortakDecisions.length,
      eslesti,
      eslesmeyenFirmalar,
      mukellefBulunamayan,
    };
  }

  /** Yanlış öğrenme durumunu temizleme — tek firmanın tüm hafızasını sil */
  async deleteVendorMemory(tenantId: string, firmaKimlikNo: string): Promise<void> {
    const m = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo } },
      select: { id: true },
    });
    if (!m) return;
    await (this.prisma as any).vendorMemory.delete({ where: { id: m.id } });
  }
}

/** Taxpayer için kısa isim üret. */
function taxpayerAd(tp: { firstName?: string | null; lastName?: string | null; companyName?: string | null; type?: string }): string {
  if (tp.companyName && tp.companyName.trim()) return tp.companyName.trim();
  const full = [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim();
  return full || '(isimsiz mükellef)';
}
