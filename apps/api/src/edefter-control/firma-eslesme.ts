// Luca raporunun basligindaki firma adi ile secilen mukellef ayni firma mi?
//   Vaka (2026-09-14, SILBER INSAAT): mukellef Luca'da acik degildi; ajan acik firmayi (GITO) cekti,
//   portal GITO verisini SILBER altinda gosterdi. Bu kontrol yanlis firmanin raporunu REDDEDER.
//   Kural: iki adin da "ayirt edici" kelimeleri (sirket turu / sektor sozcukleri haric) arasinda
//   HIC ortak kelime yoksa → uyumsuz. Rapor adi kesik gelebilir (Luca 40 karakterde kesiyor);
//   VKN rapor basliginda geciyorsa dogrudan kabul. Ayirt edici kelime yoksa (yalniz genel sozcukler)
//   karar verilemez → kabul (yanlis engelleme olmasin).
const GENEL_KELIMELER = new Set([
  'ltd', 'sti', 'as', 'a', 's', 'limited', 'sirketi', 'sirket', 'anonim', 'ticaret', 'tic', 'sanayi', 'san', 've',
  'insaat', 'ins', 'gida', 'hizmetleri', 'hizmet', 'hiz', 'turizm', 'tekstil', 'lojistik', 'nakliyat', 'nak',
  'otomotiv', 'medikal', 'pazarlama', 'paz', 'ithalat', 'ihracat', 'ith', 'ihr', 'dis', 'ic', 'uretim', 'imalat',
  'muhendislik', 'danismanlik', 'bilisim', 'yazilim', 'teknoloji', 'enerji', 'mobilya', 'ambalaj', 'petrol',
  'akaryakit', 'oto', 'yedek', 'parca', 'depolama', 'tasimacilik', 'kollektif', 'komandit', 'kooperatifi',
  'sinirli', 'sorumlu', 'mimarlik', 'yapi', 'emlak', 'gayrimenkul', 'saglik', 'egitim', 'reklam', 'matbaa',
]);

export function firmaAnahtarKelimeleri(ad?: string | null): string[] {
  const t = String(ad ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[ç]/g, 'c').replace(/[ğ]/g, 'g').replace(/[ı]/g, 'i').replace(/[ö]/g, 'o').replace(/[ş]/g, 's').replace(/[ü]/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return t.split(' ').filter((w) => w.length >= 2 && !GENEL_KELIMELER.has(w));
}

export type FirmaEslesme = { uyumlu: boolean; neden: string };

export function firmaEslesiyorMu(
  raporFirmaAdi: string | null | undefined,
  mukellef: { companyName?: string | null; firstName?: string | null; lastName?: string | null; taxNumber?: string | null },
): FirmaEslesme {
  const rapor = String(raporFirmaAdi || '').trim();
  if (!rapor) return { uyumlu: true, neden: 'Raporda firma adı okunamadı; kontrol atlandı' };
  const vkn = String(mukellef.taxNumber || '').replace(/\D/g, '');
  if (vkn.length >= 10 && rapor.replace(/\D/g, '').includes(vkn)) return { uyumlu: true, neden: 'VKN rapor başlığında geçiyor' };
  const mukellefAdi = String(mukellef.companyName || `${mukellef.firstName || ''} ${mukellef.lastName || ''}`).trim();
  const raporKelimeler = firmaAnahtarKelimeleri(rapor);
  const mukellefKelimeler = firmaAnahtarKelimeleri(mukellefAdi);
  if (!raporKelimeler.length || !mukellefKelimeler.length) return { uyumlu: true, neden: 'Ayırt edici kelime yok; kontrol atlandı' };
  // Kesik ad: raporun kelimesi mukellef kelimesinin basi olabilir ("TIC" → "TICARET" genel zaten atildi; "YORGU" gibi)
  const ortak = raporKelimeler.some((r) => mukellefKelimeler.some((m) => m === r || (r.length >= 4 && m.startsWith(r)) || (m.length >= 4 && r.startsWith(m))));
  if (ortak) return { uyumlu: true, neden: 'Ortak ayırt edici kelime var' };
  return { uyumlu: false, neden: `Rapor "${rapor}" firmasına ait, seçilen mükellef "${mukellefAdi}"` };
}
