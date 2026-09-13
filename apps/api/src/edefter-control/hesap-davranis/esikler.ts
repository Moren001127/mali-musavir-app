// HESAP DAVRANIS DENETIMI — esikler (tek yerde; TL cinsinden). Ilk surum degerleri 2026-09-13.
export const ESIK = {
  // Cari (120/320) tek yonlu calisma: en az bu kadar fatura VEYA bu kadar tutar
  CARI_TEK_YONLU_MIN_FATURA: 2,
  CARI_TEK_YONLU_MIN_TUTAR: 20_000,
  // Cari tahsilat/odeme orani dusuk
  CARI_ORAN_DUSUK: 0.25,
  CARI_ORAN_MIN_FATURA: 3,
  CARI_ORAN_MIN_TUTAR: 50_000,
  // Hareketsiz bakiye (Mizan'da var, donemde hareket yok)
  HAREKETSIZ_MIN_BAKIYE: 10_000,
  // Defter geneli "tahsilat/odeme islenmemis" ozeti icin tek yonlu cari orani
  DEFTER_TEK_YONLU_ORAN: 0.8,
  DEFTER_TEK_YONLU_MIN_HESAP: 5,
  // Alacak / satis orani (Mizan): 120 kapanisi donem satisinin bu kati ise bilgi ver
  ALACAK_CIRO_KATI: 2,
  ALACAK_CIRO_MIN_BAKIYE: 100_000,
  // Vergi/SGK/personel odeme dongusu
  VERGI_TAHAKKUK_MIN: 50, // bu tutarin altindaki tahakkuk izlenmez
  VERGI_ESLESME_TOLERANS_ORAN: 0.01,
  VERGI_ESLESME_TOLERANS_TL: 1,
  VERGI_KISMI_TOLERANS_ORAN: 0.02,
  VERGI_KISMI_TOLERANS_TL: 50,
  // Kasa
  KASA_YUKSEK_BAKIYE: 250_000,
  // Banka: aktif hesapta masraf/komisyon bekleriz (en az bu kadar hareket varsa)
  BANKA_AKTIF_MIN_HAREKET: 10,
  // Satis fisinde KDV yok
  SATIS_KDV_YOK_MIN_TUTAR: 1_000,
  // Stok: kapanis bakiyesi donem satisinin bu kati ise bilgi ver
  STOK_CIRO_KATI: 1,
  STOK_CIRO_MIN_BAKIYE: 100_000,
  // Sabit kiymet
  SABIT_KIYMET_SATIS_MIN: 1_000,
  // Ay atlama: diger aylarda en az bu kadar hareket varken bir ayda sifir
  AY_KESINTI_MIN_HAREKET: 5,
  // Bulgu ust siniri (kural basina bireysel bulgu; kalani ozet)
  UST_SINIR_STANDART: 15,
  UST_SINIR_DUSUK: 10,
  // Bordro makullugu
  BORDRO_NET_BRUT_MIN: 0.5,
  BORDRO_NET_BRUT_MAX: 0.92,
  BORDRO_SGK_BRUT_MIN: 0.1,
  BORDRO_SGK_BRUT_MAX: 0.5,
} as const;

// VUK 313 dogrudan gider yazilabilecek demirbas siniri (KDV haric). Kaynak: VUK Genel Tebligleri
//   (2026: 588 sira no.lu teblig, RG 31.12.2025). Yeni yil geldiginde buraya satir eklenir.
export const DEMIRBAS_SINIRI_YILA_GORE: Record<number, number> = {
  2024: 6_900,
  2025: 9_900,
  2026: 12_000,
};

export function demirbasSiniri(yil: number): number {
  const yillar = Object.keys(DEMIRBAS_SINIRI_YILA_GORE).map(Number).sort((a, b) => a - b);
  if (DEMIRBAS_SINIRI_YILA_GORE[yil] != null) return DEMIRBAS_SINIRI_YILA_GORE[yil];
  // Bilinmeyen yil: en yakin onceki yil (tebligi henuz islenmemis olabilir)
  const onceki = yillar.filter((y) => y < yil).pop();
  return onceki != null ? DEMIRBAS_SINIRI_YILA_GORE[onceki] : DEMIRBAS_SINIRI_YILA_GORE[yillar[yillar.length - 1]];
}
