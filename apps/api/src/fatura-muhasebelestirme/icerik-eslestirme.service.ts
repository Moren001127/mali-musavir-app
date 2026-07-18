import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrKalem } from '../kdv-control/ocr';
import {
  icerikKategoridenGiderTuru,
  isAmortismanaTabiTur,
} from '../common/isletme-gider-turleri';

export interface IcerikEslestirmeSonucu {
  /** Bilanço esasında önerilen hesap kodu */
  hesapKodu: string | null;
  /** Hesap adı */
  hesapAdi: string | null;
  /** Güven skoru 0–100 */
  guven: number;
  /** Güven seviyesi */
  seviye: 'YUKSEK' | 'ORTA' | 'DUSUK';
  /** Çelişki var mı? (VKN geçmişiyle uyuşmuyor) */
  celisiki: boolean;
  /** Geçmişten türetildi mi? */
  gecmisDenGeldi: boolean;
  /** İşletme esası gider türü kodu (TDHP için null) */
  isletmeGiderTuru: string | null;
  /** Demirbaş/taşıt → amortisman, matrah deftere yazılmaz */
  amortismanaTabi: boolean;
  /** Eşleştirmeyi açıklayan neden */
  neden: string;
}

/**
 * Kalemler üzerinden içerik tabanlı hesap kodu önerir.
 * VKN bazlı kör eşleştirme YAPILMAZ — önce kalem içeriğine bakılır,
 * VKN geçmişi sadece "ipucu" olarak kullanılır.
 */
@Injectable()
export class IcerikEslestirmeService {
  constructor(private readonly prisma: PrismaService) {}

  async eslestir(params: {
    tenantId: string;
    taxpayerId: string;
    senderVkn: string | null;
    kalemler: OcrKalem[];
    /** 'BILANCO' | 'ISLETME' */
    defterTuru: string;
  }): Promise<IcerikEslestirmeSonucu> {
    const { tenantId, taxpayerId, senderVkn, kalemler, defterTuru } = params;

    // 1. Kalem bazlı kategori analizi
    const kategoriSayac = new Map<string, number>();
    for (const kalem of kalemler) {
      const kat = kalem.icerikKategori || 'diger';
      kategoriSayac.set(kat, (kategoriSayac.get(kat) || 0) + (kalem.tutar || 1));
    }

    // En ağır kategoriye göre ana kategori
    let anaKategori = 'diger';
    let enYuksekTutar = 0;
    for (const [kat, tutar] of kategoriSayac) {
      if (tutar > enYuksekTutar) {
        enYuksekTutar = tutar;
        anaKategori = kat;
      }
    }

    // 2. Kategori → TDHP kodu eşleme (bilanço esası)
    const KATEGORI_HESAP: Record<string, { kod: string; ad: string }> = {
      ticari_mal: { kod: '153', ad: 'Ticari Mallar' },
      hizmet: { kod: '770', ad: 'Genel Yönetim Giderleri' },
      akaryakit: { kod: '770', ad: 'Genel Yönetim Giderleri' },
      kira: { kod: '770', ad: 'Genel Yönetim Giderleri' },
      tasit: { kod: '254', ad: 'Taşıtlar' },
      demirbas: { kod: '255', ad: 'Demirbaşlar' },
      diger: { kod: '770', ad: 'Genel Yönetim Giderleri' },
    };

    const onerilen = KATEGORI_HESAP[anaKategori] || KATEGORI_HESAP['diger'];
    const isletmeGiderTuru = icerikKategoridenGiderTuru(anaKategori);
    const amortismanaTabi = isAmortismanaTabiTur(isletmeGiderTuru || '');

    // 3. VKN geçmiş kontrolü (sadece ipucu)
    // Firma hafızası: VendorMemory (tenant+VKN) altındaki VendorMemoryDecision
    // kayıtlarından bu mükellef için en çok onaylanan 'fatura' kararı alınır
    // (kararTipi='fatura' → kategori alanı = hesap kodu).
    let gecmisHesapKodu: string | null = null;
    let celisiki = false;

    if (senderVkn) {
      const gecmisMemory = await this.prisma.vendorMemory.findUnique({
        where: {
          tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: senderVkn.trim() },
        },
        include: {
          decisions: {
            where: { kararTipi: 'fatura', taxpayerId },
            orderBy: { onayAdedi: 'desc' },
            take: 1,
          },
        },
      });
      const enCokOnaylanan = gecmisMemory?.decisions?.[0];
      if (enCokOnaylanan) {
        gecmisHesapKodu = enCokOnaylanan.kategori || null;
        // Çelişki: geçmiş farklı bir TDHP grubu öneriyorsa uyar
        if (gecmisHesapKodu && !gecmisHesapKodu.startsWith(onerilen.kod.slice(0, 1))) {
          celisiki = true;
        }
      }
    }

    // 4. Güven skoru hesaplama
    let guven = 40; // varsayılan düşük

    if (anaKategori !== 'diger' && kalemler.length > 0) {
      guven += 30; // kalem içeriğinden türetildi
    }
    if (kategoriSayac.size === 1) {
      guven += 20; // tüm kalemler aynı kategoride
    }
    if (!celisiki && gecmisHesapKodu) {
      guven += 10; // geçmişle uyuşuyor
    }
    if (celisiki) {
      guven -= 20; // geçmişle çelişiyor — kasıtlı olarak düşür
    }
    guven = Math.max(0, Math.min(100, guven));

    const seviye: IcerikEslestirmeSonucu['seviye'] =
      guven >= 75 ? 'YUKSEK' : guven >= 50 ? 'ORTA' : 'DUSUK';

    // 5. Sonuç
    const nedenParcalar: string[] = [];
    if (kalemler.length > 0) {
      nedenParcalar.push(`${kalemler.length} kalem → ana kategori: ${anaKategori}`);
    } else {
      nedenParcalar.push('kalem bilgisi yok');
    }
    if (gecmisHesapKodu) {
      nedenParcalar.push(celisiki ? `geçmiş ${gecmisHesapKodu} ile ÇELİŞİYOR` : `geçmişle uyuşuyor (${gecmisHesapKodu})`);
    }

    return {
      hesapKodu: defterTuru === 'BILANCO' ? onerilen.kod : null,
      hesapAdi: defterTuru === 'BILANCO' ? onerilen.ad : null,
      guven,
      seviye,
      celisiki,
      gecmisDenGeldi: !!gecmisHesapKodu && !celisiki,
      isletmeGiderTuru: defterTuru !== 'BILANCO' ? isletmeGiderTuru : null,
      amortismanaTabi,
      neden: nedenParcalar.join(' | '),
    };
  }

  /**
   * Kalem listesi OCR'dan gelmiyorsa (sadece fatura başlığı var),
   * VKN geçmişine dayalı düşük güvenli tahmin yap.
   */
  async eslestirVknTabanli(params: {
    tenantId: string;
    taxpayerId: string;
    senderVkn: string | null;
    defterTuru: string;
  }): Promise<IcerikEslestirmeSonucu> {
    return this.eslestir({
      ...params,
      kalemler: [],
    });
  }
}
