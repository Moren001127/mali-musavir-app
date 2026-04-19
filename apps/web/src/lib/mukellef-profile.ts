/**
 * Mükellef Profili — yapılandırılmış AI talimat şeması.
 * Her mükellef için form ile doldurulur, AI prompt'una inject edilir.
 */

export type DefterTuru = 'bilanco' | 'isletme' | '';
export type HesapTuru = 'kasa' | 'banka' | 'pos' | 'cek' | 'diger' | '';

export interface KdvOranBazli {
  yuzde1?: string;   // 600.01.001 / 391.01.001 / 191.01.001 vb.
  yuzde10?: string;
  yuzde20?: string;
}

export interface MukellefProfile {
  sektor?: string;                  // "Toptan gıda ticareti"
  defterTuru?: DefterTuru;

  // Satış matrahları (oran bazlı)
  malSatisMatrah?: KdvOranBazli;    // 600.x
  hizmetSatisMatrah?: KdvOranBazli; // 600.x

  // KDV hesapları (oran bazlı)
  hesaplananKdv?: KdvOranBazli;     // 391.x
  indirilecekKdv?: KdvOranBazli;    // 191.x

  // Cari & ödeme
  cariFormat?: string;              // "120.01.{kod}"
  tahsilatHesabi?: string;          // "100.01.001"
  tahsilatHesapTuru?: HesapTuru;
  odemeHesabi?: string;
  odemeHesapTuru?: HesapTuru;

  // Tevkifat
  tevkifataTabi?: boolean;

  // Serbest notlar (mevcut "talimat" field'ı korunur)
  talimat?: string;
}

/**
 * Profili Claude prompt'una insan-okunur formatta çevirir.
 */
export function profileToPromptText(p: MukellefProfile | null | undefined): string {
  if (!p || Object.keys(p).length === 0) return '';
  const lines: string[] = [];
  lines.push('=== MÜKELLEF PROFİLİ ===');
  if (p.sektor) lines.push(`Sektör: ${p.sektor}`);
  if (p.defterTuru) lines.push(`Defter: ${p.defterTuru === 'bilanco' ? 'Bilanço' : 'İşletme'}`);

  const oranSatir = (label: string, k?: KdvOranBazli) => {
    if (!k) return;
    const parts: string[] = [];
    if (k.yuzde1)  parts.push(`%1: ${k.yuzde1}`);
    if (k.yuzde10) parts.push(`%10: ${k.yuzde10}`);
    if (k.yuzde20) parts.push(`%20: ${k.yuzde20}`);
    if (parts.length) lines.push(`${label}: ${parts.join(' · ')}`);
  };

  oranSatir('Mal Satışı Matrahı', p.malSatisMatrah);
  oranSatir('Hizmet Satışı Matrahı', p.hizmetSatisMatrah);
  oranSatir('Hesaplanan KDV', p.hesaplananKdv);
  oranSatir('İndirilecek KDV', p.indirilecekKdv);

  if (p.cariFormat) lines.push(`Cari format: ${p.cariFormat}`);
  if (p.tahsilatHesabi) {
    lines.push(`Tahsilat: ${p.tahsilatHesabi}${p.tahsilatHesapTuru ? ` (${p.tahsilatHesapTuru})` : ''}`);
  }
  if (p.odemeHesabi) {
    lines.push(`Ödeme: ${p.odemeHesabi}${p.odemeHesapTuru ? ` (${p.odemeHesapTuru})` : ''}`);
  }
  if (typeof p.tevkifataTabi === 'boolean') {
    lines.push(`Tevkifata tabi: ${p.tevkifataTabi ? 'Evet' : 'Hayır'}`);
  }

  // Sistem kuralları
  lines.push('');
  lines.push('=== SİSTEM KURALLARI (her mükellefe geçerli) ===');
  lines.push('• Tevkifat: Nakliye, Servis Taşımacılığı, Demir içerikli faturalar KDV dahil 12.000 TL ve üzeri ise tevkifatlı olmak zorunda. Aksi takdirde HATA.');
  lines.push('• Kasa Limiti: Tahsilat/Ödeme hesabı 100.x (kasa) ise tutar 30.000 TL üstü olamaz. Aşıyorsa banka/POS gerekir.');

  if (p.talimat && p.talimat.trim()) {
    lines.push('');
    lines.push('=== ÖZEL TALİMATLAR ===');
    lines.push(p.talimat.trim());
  }
  return lines.join('\n');
}
