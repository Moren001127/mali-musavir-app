/**
 * Mükellef profili - yapılandırılmış agent talimat şeması.
 * Her mükellef için form ile doldurulur, fatura karar prompt'una eklenir.
 */

export type DefterTuru = 'bilanco' | 'isletme' | '';
export type HesapTuru = 'kasa' | 'banka' | 'pos' | 'cek' | 'diger' | '';
export type CariTakipPolitikasi =
  | 'hepsi_cari'
  | 'sadece_tanimli'
  | 'cari_yoksa_odeme'
  | 'cari_yoksa_onay'
  | '';

export interface KdvOranBazli {
  yuzde1?: string;
  yuzde8?: string;
  yuzde10?: string;
  yuzde18?: string;
  yuzde20?: string;
}

export interface MukellefProfile {
  sektor?: string;
  defterTuru?: DefterTuru;

  // Eski alanlar geriye uyumluluk için korunur.
  malSatisMatrah?: KdvOranBazli;
  hizmetSatisMatrah?: KdvOranBazli;

  // Yeni satış ayrımı: belge tipine göre.
  faturaSatisMatrah?: KdvOranBazli;
  perakendeSatisMatrah?: KdvOranBazli;

  malAlisMatrah?: KdvOranBazli;
  hesaplananKdv?: KdvOranBazli;
  indirilecekKdv?: KdvOranBazli;

  cariFormat?: string;
  cariTakipPolitikasi?: CariTakipPolitikasi;
  cariYoksaHesap?: string;
  surekliTedarikciler?: string;
  tahsilatHesabi?: string;
  tahsilatHesapTuru?: HesapTuru;
  odemeHesabi?: string;
  odemeHesapTuru?: HesapTuru;

  tevkifataTabi?: boolean;
  demirbasKontrolAktif?: boolean;
  demirbasAnahtarKelimeler?: string;
  demirbasTalimat?: string;

  ozelKararKurallari?: string;
  firmaOzelTalimatlar?: string;
  otomatikOnayNotlari?: string;

  talimat?: string;
}

export function profileToPromptText(p: MukellefProfile | null | undefined): string {
  if (!p || Object.keys(p).length === 0) return '';

  const lines: string[] = [];
  lines.push('=== MUKELLEF PROFILI ===');
  if (p.sektor) lines.push(`Sektor/Faaliyet: ${p.sektor}`);
  if (p.defterTuru) lines.push(`Defter: ${p.defterTuru === 'bilanco' ? 'Bilanco' : 'Isletme'}`);

  const oranSatir = (label: string, k?: KdvOranBazli) => {
    if (!k) return;
    const parts: string[] = [];
    if (k.yuzde1) parts.push(`%1: ${k.yuzde1}`);
    if (k.yuzde8) parts.push(`%8: ${k.yuzde8}`);
    if (k.yuzde10) parts.push(`%10: ${k.yuzde10}`);
    if (k.yuzde18) parts.push(`%18: ${k.yuzde18}`);
    if (k.yuzde20) parts.push(`%20: ${k.yuzde20}`);
    if (parts.length) lines.push(`${label}: ${parts.join(' | ')}`);
  };

  oranSatir('Fatura/e-Belge Satis Matrahi', p.faturaSatisMatrah || p.malSatisMatrah);
  oranSatir('Perakende/Z Raporu Satis Matrahi', p.perakendeSatisMatrah || p.hizmetSatisMatrah);
  oranSatir('Ticari Mal Alis Matrahi (ZORUNLU ONCELIK)', p.malAlisMatrah);
  oranSatir('Hesaplanan KDV', p.hesaplananKdv);
  oranSatir('Indirilecek KDV', p.indirilecekKdv);

  lines.push('');
  lines.push('=== SATIS KODU KARAR KURALI ===');
  lines.push('Profildeki 600 kodlari otomatik dogru karar degildir; belge tipi ve fatura icerigiyle uyumluysa kullanilir.');
  lines.push('e-Fatura/e-Arsiv/Fatura belge turleri normal mal/hizmet satisi ise fatura/e-belge satis matrahina gider.');
  lines.push('Z Raporu/OKC/Perakende belgeler normal perakende satis ise perakende/Z raporu satis matrahina gider.');
  lines.push('Arac, demirbas, sabit kiymet, istisnai varlik satisi veya faaliyet disi satis gorursen 600 koduna otomatik F2 yapma; onay_bekliyor karari ver.');

  if (p.cariFormat) lines.push(`Cari format: ${p.cariFormat}`);
  if (p.cariTakipPolitikasi) lines.push(`Cari takip politikasi: ${p.cariTakipPolitikasi}`);
  if (p.cariYoksaHesap) lines.push(`Cari yoksa kullanilacak hesap: ${p.cariYoksaHesap}`);
  if (p.surekliTedarikciler) lines.push(`Cari takip edilecek surekli tedarikciler: ${p.surekliTedarikciler}`);
  if (p.tahsilatHesabi) lines.push(`Tahsilat: ${p.tahsilatHesabi}${p.tahsilatHesapTuru ? ` (${p.tahsilatHesapTuru})` : ''}`);
  if (p.odemeHesabi) lines.push(`Odeme: ${p.odemeHesabi}${p.odemeHesapTuru ? ` (${p.odemeHesapTuru})` : ''}`);
  if (typeof p.tevkifataTabi === 'boolean') lines.push(`Tevkifata tabi: ${p.tevkifataTabi ? 'Evet' : 'Hayir'}`);

  if (p.demirbasKontrolAktif !== false) {
    lines.push('');
    lines.push('=== DEMIRBAS / OLAĞAN DISI FATURA KONTROLU ===');
    lines.push('Profilde tanimli 600/153/191/391 kodlari varsayilan rotadir; fatura icerigiyle celisirse kor karar verme.');
    lines.push('Arac, bilgisayar, telefon, klima, TV, mobilya, makine, ekipman, cihaz veya uzun omurlu varlik satis/alisinda otomatik F2 yapma; karar onay_bekliyor olsun.');
    if (p.demirbasAnahtarKelimeler) lines.push(`Demirbas anahtar kelimeleri: ${p.demirbasAnahtarKelimeler}`);
    if (p.demirbasTalimat) lines.push(`Demirbas talimati: ${p.demirbasTalimat}`);
  }

  if (p.ozelKararKurallari && p.ozelKararKurallari.trim()) {
    lines.push('');
    lines.push('=== MUKELLEF OZEL KARAR KURALLARI ===');
    lines.push('Bu kurallar bu mukellefe ozeldir ve firma hafizasindan once dikkate alinir.');
    lines.push(p.ozelKararKurallari.trim());
  }

  if (p.firmaOzelTalimatlar && p.firmaOzelTalimatlar.trim()) {
    lines.push('');
    lines.push('=== FIRMA OZEL TALIMATLAR ===');
    lines.push('Her satir karsi firma bazli karar talimatidir. Eslesen firma satiri varsa genel firma hafizasindan once uygula.');
    lines.push(p.firmaOzelTalimatlar.trim());
  }

  if (p.otomatikOnayNotlari && p.otomatikOnayNotlari.trim()) {
    lines.push('');
    lines.push('=== OTOMATIK ONAY NOTLARI ===');
    lines.push(p.otomatikOnayNotlari.trim());
  }

  lines.push('');
  lines.push('=== SISTEM KURALLARI ===');
  lines.push('Tevkifat: Nakliye, servis tasimaciligi, demir icerikli faturalar KDV dahil 12.000 TL ve uzeri ise tevkifat acisindan kontrol edilir.');
  lines.push('Kasa limiti: Tahsilat/odeme hesabi 100.x ise tutar 30.000 TL ustu olamaz; banka/POS gerekebilir.');

  if (p.talimat && p.talimat.trim()) {
    lines.push('');
    lines.push('=== OZEL TALIMATLAR ===');
    lines.push(p.talimat.trim());
  }

  return lines.join('\n');
}
