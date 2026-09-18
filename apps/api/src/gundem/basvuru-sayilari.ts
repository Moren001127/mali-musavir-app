/**
 * BAŞVURU SAYILARI — mali müşavirin gün içinde defalarca baktığı, nadir değişen
 * resmî parametreler. Kaynak + geçerlilik tarihi her satırda durur; kartta
 * kaynağa tıklanır. Değer değişince BURASI güncellenir (tek yer).
 *
 * Son doğrulama: 2026-09-18 (web: verginet, csgb, muhasebetr, müşavirler kulübü).
 */

export type BasvuruSayisi = {
  kod: string;
  etiket: string;        // kartta görünen kısa ad
  deger: string;         // biçimlenmiş metin ("%3,70", "33.030 TL")
  alt?: string;          // "aylık" / "yıllık" / "brüt" gibi kısa not
  gecerlilik: string;    // "13.11.2025'ten itibaren" / "2026"
  kaynakUrl: string;
};

export const BASVURU_SAYILARI: BasvuruSayisi[] = [
  {
    kod: 'GECIKME_ZAMMI', etiket: 'Gecikme zammı', deger: '%3,70', alt: 'aylık',
    gecerlilik: "13.11.2025'ten itibaren (önceki %4,50)",
    kaynakUrl: 'https://www.gib.gov.tr/yardim-ve-kaynaklar/yararli-bilgiler/gecikme-zammi-oranlari',
  },
  {
    kod: 'TECIL_FAIZI', etiket: 'Tecil faizi', deger: '%39', alt: 'yıllık',
    gecerlilik: "13.11.2025'ten itibaren",
    kaynakUrl: 'https://www.gib.gov.tr/yardim-ve-kaynaklar/yararli-bilgiler/tecil-faizi-oranlari',
  },
  {
    kod: 'YENIDEN_DEGERLEME', etiket: 'Yeniden değerleme', deger: '%25,49', alt: '2025 yılı oranı · 2026 had/tutarlarında uygulanır',
    gecerlilik: '2026',
    kaynakUrl: 'https://www.gib.gov.tr/yardim-ve-kaynaklar/yararli-bilgiler/yeniden-degerleme-oranlari',
  },
  {
    kod: 'ASGARI_UCRET_BRUT', etiket: 'Asgari ücret', deger: '33.030,00 TL', alt: 'brüt · net 28.075,50 TL',
    gecerlilik: '01.01.2026 – 31.12.2026',
    kaynakUrl: 'https://www.csgb.gov.tr/poco-pages/asgari-ucret/',
  },
  {
    kod: 'SGK_TAVAN', etiket: 'SGK prim tavanı', deger: '297.270,00 TL', alt: 'aylık · brütün 9 katı',
    gecerlilik: '2026',
    kaynakUrl: 'https://www.sgk.gov.tr/',
  },
  {
    kod: 'KIDEM_TAVANI', etiket: 'Kıdem tazminatı tavanı', deger: '73.729,87 TL', alt: 'yıllık',
    gecerlilik: '01.07.2026 – 31.12.2026',
    kaynakUrl: 'https://www.csgb.gov.tr/%C4%B1statistikler/calisma-hayati-%C4%B1statistikleri/kidem-tazminati-tavan-miktari/',
  },
  {
    kod: 'YEMEK_ISTISNASI', etiket: 'Yemek istisnası', deger: '300,00 TL', alt: 'günlük · kart/kupon KDV dâhil 330 TL',
    gecerlilik: '2026',
    kaynakUrl: 'https://www.gib.gov.tr/',
  },
];
