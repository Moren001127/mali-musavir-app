import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vendor Memory — her firma (VKN/TCKN) icin AI kararlari hafizada tutulur.
 *
 * AI fatura kategorize ederken:
 *  1. getHintForVendor() ile gecmisteki en cok onaylanan kategori(ler) alinir
 *  2. Hint prompt'a OVERRIDE kuraliyla enjekte edilir (fatura icerigi cakisirsa gormezden gel)
 *  3. AI karari geldikten sonra detectDeviation() ile gecmisle eslesip eslesmedigi kontrol edilir
 *  4. Sapma yoksa recordDecision() ile sayac artar
 *  5. Sapma varsa PendingDecision'a dusup insan onayi bekler (pending-decisions module)
 *
 * kararTipi:
 *  - 'fatura': decideFatura icin, kategori=hesapKodu, altKategori=null
 *  - 'isletme': decideIsletme icin, kategori=kayitTuru, altKategori=altTuru
 */
@Injectable()
export class VendorMemoryService {
  // En az kac onaydan sonra hint olusturulsun (cok az veriyle overfitting olmasin)
  private readonly MIN_ONAY_FOR_HINT = 3;
  // Top kac kategori hint'e eklensin
  private readonly TOP_N_KATEGORI = 3;

  constructor(private prisma: PrismaService) {}

  /**
   * Firma icin hint metni olustur. 3+ onay yoksa null doner.
   *
   * Donen metin, decideFatura/decideIsletme prompt'una system message'a eklenecek.
   * OVERRIDE kurali bilerek sert: AI fatura icerigine ONCE bakmali, celiski varsa
   * hint'i gormezden gelmeli. Kullanicinin (senin) 4 katmanli koruma istegine uygun.
   */
  async getHintForVendor(
    tenantId: string,
    firmaKimlikNo: string | null | undefined,
    kararTipi: 'fatura' | 'isletme',
  ): Promise<{ hintText: string; memoryId: string; topKategoriler: Array<{ kategori: string; altKategori: string | null; onayAdedi: number }> } | null> {
    if (!firmaKimlikNo) return null;
    const normalized = firmaKimlikNo.trim();
    if (!normalized) return null;

    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: normalized } },
      include: {
        decisions: {
          where: { kararTipi },
          orderBy: { onayAdedi: 'desc' },
          take: this.TOP_N_KATEGORI,
        },
      },
    });

    if (!memory || !memory.decisions || memory.decisions.length === 0) return null;

    const toplam = memory.decisions.reduce((s: number, d: any) => s + (d.onayAdedi || 0), 0);
    if (toplam < this.MIN_ONAY_FOR_HINT) return null;

    const firmaAdi = memory.firmaUnvan || normalized;
    const kategoriSatirlari = memory.decisions
      .map((d: any) => {
        const label = d.altKategori ? `${d.kategori} → ${d.altKategori}` : d.kategori;
        return `  - "${label}" : ${d.onayAdedi} kez onaylandi`;
      })
      .join('\n');

    const hintText = `### FIRMA HAFIZASI (${firmaAdi} - VKN/TCKN: ${normalized}) ###
Bu firma icin gecmiste ${toplam} karar kaydedildi. En cok onaylanan kategoriler:
${kategoriSatirlari}

**KURAL - OVERRIDE:**
Bu bilgi sadece IPUCUDUR, zorunluluk degildir. ONCE faturanin icerigini oku.
Eger icerik gecmiste onaylanan kategoriyle ayniysa → kararinda bu hint'i pekistirici kullan.
Eger icerik farkliysa (ornek: her zaman akaryakit faturasi gelen firmadan bu sefer makine satis faturasi) → hint'i GORMEZDEN GEL, gercek icerige gore karar ver.
Yanlis ipucuna uyup yanlis karar vermek, ipucu olmamasindan DAHA KOTUDUR.
### /FIRMA HAFIZASI ###
`;

    return {
      hintText,
      memoryId: memory.id,
      topKategoriler: memory.decisions.map((d: any) => ({
        kategori: d.kategori,
        altKategori: d.altKategori,
        onayAdedi: d.onayAdedi,
      })),
    };
  }

  /**
   * Bir karar tamamlaninca hafizayi guncelle. Sapma yoksa (veya insan onayindan gecmisse)
   * cagrilir. Firma ilk defa gorunuyorsa VendorMemory olusturur.
   */
  async recordDecision(params: {
    tenantId: string;
    firmaKimlikNo: string | null | undefined;
    firmaUnvan?: string | null;
    kararTipi: 'fatura' | 'isletme';
    kategori: string;
    altKategori?: string | null;
  }): Promise<void> {
    const { tenantId, firmaKimlikNo, firmaUnvan, kararTipi, kategori, altKategori } = params;
    if (!firmaKimlikNo) return;
    const vkn = firmaKimlikNo.trim();
    if (!vkn || !kategori) return;

    // Upsert VendorMemory
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
        // Unvan degisebilir (firma isim degistirmis olabilir); en sonu gosteriyoruz.
        firmaUnvan: firmaUnvan || undefined,
      },
    });

    // Upsert VendorMemoryDecision — altKategori NULL'da COALESCE unique index
    // Prisma standart upsert NULL ile composite unique'i tam islemiyor.
    // Bu yuzden manual: find → create/update.
    const existing = await (this.prisma as any).vendorMemoryDecision.findFirst({
      where: {
        vendorMemoryId: memory.id,
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
          kararTipi,
          kategori,
          altKategori: altKategori || null,
          onayAdedi: 1,
          sonKullanim: new Date(),
        },
      });
    }
  }

  /**
   * AI karari gecmisle eslesiyor mu? Sapma tespit et.
   *
   * Dogal mantik:
   *  - Hic memory yok → false (sapma yok, yeni firma)
   *  - AI karari zaten top kategorilerden biri → false (gelenekle uyumlu)
   *  - AI karari top kategorilerden farkli → TRUE (sapma)
   *
   * Kullanici tercihi: kucuk fark bile onay kuyruguna dussun → her farkliligi sapma say.
   */
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

    // Top kategorilerden biriyle eslesiyorsa sapma yok
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
      sebep: `Bu firma icin gecmiste en cok "${enCokLabel}" (${enCok.onayAdedi} kez) onaylandi, AI bu sefer "${aiLabel}" onerdi.`,
      enCokGecmisKategori: enCokLabel,
      enCokGecmisOnaySayisi: enCok.onayAdedi,
    };
  }

  /** Panel listesi icin: tenant'in tum firma hafizasi, en cok kullanilana gore sirali. */
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
    return (this.prisma as any).vendorMemory.findMany({
      where,
      orderBy: [{ toplamOnay: 'desc' }, { sonKullanim: 'desc' }],
      take: limit,
      include: {
        decisions: {
          orderBy: { onayAdedi: 'desc' },
          take: 10,
        },
      },
    });
  }

  /** Tek firma detayi (VKN ile) */
  async getVendorDetail(tenantId: string, firmaKimlikNo: string) {
    return (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo } },
      include: {
        decisions: {
          orderBy: [{ kararTipi: 'asc' }, { onayAdedi: 'desc' }],
        },
      },
    });
  }

  /** Yanlis ogrenme durumunu temizleme — tek firmanin tum hafizasini sil */
  async deleteVendorMemory(tenantId: string, firmaKimlikNo: string): Promise<void> {
    const m = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo } },
      select: { id: true },
    });
    if (!m) return;
    // Decisions onDelete: Cascade ile otomatik silinir
    await (this.prisma as any).vendorMemory.delete({ where: { id: m.id } });
  }
}
