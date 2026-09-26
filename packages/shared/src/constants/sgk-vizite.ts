/**
 * SGK e-RAPOR (VİZİTE) + HASTANE İŞ KAZASI — ORTAK SÖZLEŞME (2026-09-26).
 *
 * Kaynak: SGK "WS_Vizite" web servisi (https://uyg.sgk.gov.tr/Ws_Vizite/services/ViziteGonder).
 * Giriş = e-Bildirge kullanıcı adı + işyeri kodu + İŞYERİ şifresi; SMS / güvenlik kodu YOK
 * (SGK: SMS doğrulaması yalnız internet ekranı için). Sunucu (apps/api/src/sgk-vizite) bu tipleri
 * üretir, SGK Otomasyonu ekranı (apps/web) okur.
 *
 * CANLI GÖZLEMLER (2026-09-26, üç mükellefte salt-okuma deneme):
 *  - raporAramaTarihile: onay bekleyen raporlar (poliklinik < tarih, en çok 100).
 *    Süren ve bir kısmı onaylanmış rapor BU LİSTEDE YOK; onaylı listede çıkar → "PARCALI".
 *  - onayliRaporlarTarihile + onayliRaporlarDetay: SGK TÜM istemciye DAKİKADA BİR izin veriyor
 *    (sonucKod 1012 "1 dakika aralıklar ile sorgulama yapabilirsiniz") — mükellef başına değil.
 *  - raporAramaKimlikNo: SGK tarafından KAPATILMIŞ (sonucKod -1).
 *  - Tarihler "YYYY-AA-GG"; boş tarih "0001-01-01", boş iş kazası tarihi "-".
 *
 * UÇLAR (hepsi JWT + tenant):
 *  GET  /sgk-vizite/ozet?taxpayerId=                 → SgkViziteOzet
 *  GET  /sgk-vizite/raporlar?durum=bekleyen|onaylanan&taxpayerId=  → { satirlar: SgkRaporSatiri[] }
 *  GET  /sgk-vizite/is-kazalari?taxpayerId=          → { satirlar: SgkIsKazasiSatiri[] }
 *  GET  /sgk-vizite/durumlar                         → { satirlar: SgkViziteMukellefDurumu[] }
 *  POST /sgk-vizite/sorgula { taxpayerIds?: string[] } → SgkViziteSorguBaslat
 *  POST /sgk-vizite/raporlar/:id/onay { bitisTarihi: 'YYYY-AA-GG', calisti: boolean } → SgkViziteIslemSonucu
 *  POST /sgk-vizite/raporlar/:id/personelim-degil     → SgkViziteIslemSonucu
 */

/** SGK vaka kodları. */
export const SGK_VAKA_ADLARI: Readonly<Record<string, string>> = {
  '1': 'İş Kazası',
  '2': 'Meslek Hastalığı',
  '3': 'Hastalık',
  '4': 'Analık',
};

/** SGK rapor durumu (RAPORDURUMU) kodları — WS_Vizite kılavuzu "Parametrik Alan Açıklamaları". */
export const SGK_RAPOR_DURUMLARI: Readonly<Record<string, string>> = {
  '1': 'Çalışır',
  '2': 'Kontrol',
  '3': 'Devamı Verildi',
  '4': 'Sevkli',
  '5': 'Hastane Kapattı',
  '6': 'Çalışır Olup Çakışma Var',
  '7': 'Kontrol Olup Çakışma Var',
  '8': 'Maluliyet Azaltılabilir Çalışır',
  '9': 'Maluliyet Sevk Çalışır',
  '10': 'Analık Doğum Öncesi Çalışır',
  '11': 'Analık Doğum Öncesi Çalışamaz',
  '12': 'Analık Doğum Sonrası',
  '13': 'Maluliyet Azaltılır Kontrol',
  '14': 'Maluliyet Sevk Kontrol',
  '15': 'Maluliyet Azaltılır Kontrol Devam Verildi',
  '16': 'Maluliyet Sevk Kontrol Devam Verildi',
};

/**
 * BEKLIYOR  = SGK onay bekleyen listesinde (raporAramaTarihile).
 * PARCALI   = onaylı listede ama onaylanan günler raporun sonuna ulaşmamış (kalan kısım onay bekliyor).
 * ONAYLANDI = onaylı listede, raporun tamamı onaylanmış (ya da ayrıntısı henüz okunmadı).
 */
export type SgkRaporDurum = 'BEKLIYOR' | 'PARCALI' | 'ONAYLANDI';

/** onayliRaporlarDetay'dan: işverenin SGK'ya bildirdiği bir onay aralığı. */
export interface SgkOnayParcasi {
  baslangic: string; // YYYY-AA-GG
  bitis: string; // YYYY-AA-GG
  calisti: boolean; // false = çalışmamıştır
  islemTarihi: string | null;
  odemeCikti: boolean | null;
}

/** Portaldan yapılan son işlem (onay / personelim değil). */
export interface SgkRaporPortalIslemi {
  islem: 'ONAY' | 'PERSONELIM_DEGIL';
  tarih: string; // ISO zaman
  kullanici: string | null;
  basarili: boolean;
  sonucKod: number | null;
  sonucAciklama: string | null;
}

export interface SgkRaporSatiri {
  id: string;
  taxpayerId: string;
  mukellefAdi: string;
  medulaRaporId: string;
  tcKimlikNo: string;
  adSoyad: string;
  vaka: string | null;
  vakaAdi: string | null;
  poliklinikTarihi: string | null;
  raporBaslangic: string | null;
  raporBitis: string | null;
  isbasiKontrolTarihi: string | null;
  /** raporBaslangic..raporBitis dahil gün (Hattat "Gün" sütunu); bilinmiyorsa null. */
  gunSayisi: number | null;
  raporDurumuKodu: string | null;
  raporDurumuAdi: string | null;
  isKazasiTarihi: string | null;
  durum: SgkRaporDurum;
  onayParcalari: SgkOnayParcasi[];
  /** Onay penceresinde "… ile [bitiş] arasında" başlangıcı: son onaylı günün ertesi, yoksa rapor başlangıcı. */
  onayBaslangic: string | null;
  /** Onay bitişi en geç: min(rapor bitişi, bugün). SGK kuralı: bitiş bugünü ve rapor bitişini geçemez. */
  onayEnGecBitis: string | null;
  /** PARCALI ise onay bekleyen kalan aralık. */
  kalanBaslangic: string | null;
  kalanBitis: string | null;
  ilkGorulme: string; // ISO zaman
  sonGorulme: string; // ISO zaman
  sonPortalIslemi: SgkRaporPortalIslemi | null;
}

export interface SgkIsKazasiSatiri {
  id: string;
  taxpayerId: string;
  mukellefAdi: string;
  bildirimId: string;
  tcKimlikNo: string;
  /** Hastane bildiriminde ad yok; aynı TC'nin raporundan doldurulur, yoksa null. */
  adSoyad: string | null;
  cinsiyet: string | null;
  isKazasiTarihi: string | null;
  provizyonTarihi: string | null;
  tesisAdi: string | null;
  unvani: string | null;
  islemTuru: string | null;
  /** Kaza tarihinden sonraki 3. iş günü (cumartesi, pazar, resmî tatil sayılmaz). */
  sgkBildirimSonGun: string | null;
  ilkGorulme: string;
}

export interface SgkViziteMukellefDurumu {
  taxpayerId: string;
  mukellefAdi: string;
  sonSorgu: string | null;
  sonBasari: string | null;
  hata: string | null;
}

export interface SgkViziteOzet {
  /** BEKLIYOR + PARCALI (Hattat "Onaylanmamış") */
  onayBekleyen: number;
  parcali: number;
  /** ONAYLANDI, son 180 gün (gece sorgusu aralığı) */
  onaylanan: number;
  isKazasi: number;
  /** İkinci aşama (işe giriş/çıkış) henüz bağlı değil. */
  iseGirisCikisBagli: false;
  sonGeceSorgusu: { tarih: string | null; mukellefSayisi: number; hataSayisi: number } | null;
  /** Elle / gece toplu sorgu sürüyor mu (ilerleme ile). */
  sorgu: { suruyor: boolean; toplam: number; biten: number; baslangic: string | null };
  sgkSifreliMukellef: number;
}

export interface SgkViziteSorguBaslat {
  baslatildi: boolean;
  mukellefSayisi: number;
  mesaj: string;
}

export interface SgkViziteIslemSonucu {
  basarili: boolean;
  sonucKod: number | null;
  sonucAciklama: string;
  rapor: SgkRaporSatiri | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function isoGunEkle(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function isoHaftaSonuMu(iso: string): boolean {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const g = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return g === 0 || g === 6;
}

/**
 * İş kazası SGK bildirimi son günü: kaza günü sayılmaz; izleyen 3. İŞ GÜNÜ
 * (cumartesi, pazar ve resmî tatiller sayılmaz — 5510 md. 13, Sosyal Sigorta İşlemleri
 * Yönetmeliği md. 35, SGK 2016/21 Genelgesi). Örnek: cuma kaza → çarşamba.
 * `resmiTatilMi` dışarıdan verilir (tek kaynak: resmi-tatil.ts) ki bu dosya döngüsel içe aktarma yapmasın.
 */
export function isKazasiBildirimSonGunu(kazaIso: string | null | undefined, resmiTatilMi: (iso: string) => boolean): string | null {
  if (!kazaIso || !/^\d{4}-\d{2}-\d{2}$/.test(kazaIso)) return null;
  let t = kazaIso;
  let sayac = 0;
  for (let i = 0; i < 40 && sayac < 3; i++) {
    t = isoGunEkle(t, 1);
    if (!isoHaftaSonuMu(t) && !resmiTatilMi(t)) sayac++;
  }
  return t;
}
