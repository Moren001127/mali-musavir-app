/**
 * AgentRule.profile JSON'unu fatura karar prompt'una insan-okunur formatta çevirir.
 * Frontend'deki profil şemasıyla geriye uyumlu çalışır.
 */

import { SISTEM_KURALLARI } from './sistem-kurallari';

interface KdvOranBazli {
  yuzde1?: string;
  yuzde8?: string;
  yuzde10?: string;
  yuzde18?: string;
  yuzde20?: string;
}

export function profileToPromptText(p: any): string {
  if (!p || typeof p !== 'object') return '';

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

  const faturaSatis = p.faturaSatisMatrah || p.malSatisMatrah;
  const perakendeSatis = p.perakendeSatisMatrah || p.hizmetSatisMatrah;
  oranSatir('Fatura/e-Belge Satis Matrahi', faturaSatis);
  oranSatir('Perakende/Z Raporu Satis Matrahi', perakendeSatis);
  oranSatir('Ticari Mal Alis Matrahi (ZORUNLU ONCELIK)', p.malAlisMatrah);
  oranSatir('Hesaplanan KDV', p.hesaplananKdv);
  oranSatir('Indirilecek KDV', p.indirilecekKdv);

  lines.push('');
  lines.push('=== SATIS KODU KARAR KURALI ===');
  lines.push('Profildeki 600 kodlari otomatik dogru karar degildir; belge tipi ve fatura icerigiyle uyumluysa kullanilir.');
  lines.push('e-Fatura/e-Arsiv/Fatura belge turleri normal mal/hizmet satisi ise fatura/e-belge satis matrahina gider.');
  lines.push('Z Raporu/OKC/Perakende belgeler normal perakende satis ise perakende/Z raporu satis matrahina gider.');
  lines.push('Arac, demirbas, sabit kiymet, istisnai varlik satisi veya faaliyet disi satis gorursen 600 koduna otomatik F2 yapma; onay_bekliyor karari ver.');

  if (p.malAlisMatrah && (p.malAlisMatrah.yuzde1 || p.malAlisMatrah.yuzde8 || p.malAlisMatrah.yuzde10 || p.malAlisMatrah.yuzde18 || p.malAlisMatrah.yuzde20)) {
    lines.push('');
    lines.push('ZORUNLU KURAL - TICARI MAL ALISI:');
    lines.push('Normal ticari mal alis faturasi ise fatura KDV oranina karsilik gelen profil Mal Alis kodunu VendorMemoryden once kullan.');
    lines.push('Ancak fatura icerigi demirbas/sabit kiymet/hizmet/gider gibi gorunuyorsa profil 153 koduna kor sekilde onay verme; onay_bekliyor karari ver.');
    lines.push('Profilde ilgili KDV orani tanimli degilse otomatik F2 yapma; onay_bekliyor karari ver.');
  }

  if (p.cariFormat) lines.push(`Cari format: ${p.cariFormat}`);
  if (p.cariTakipPolitikasi) lines.push(`Cari takip politikasi: ${p.cariTakipPolitikasi}`);
  if (p.cariYoksaHesap) lines.push(`Cari yoksa kullanilacak hesap: ${p.cariYoksaHesap}`);
  if (p.surekliTedarikciler) lines.push(`Cari takip edilecek surekli tedarikciler: ${p.surekliTedarikciler}`);
  if (p.cariTakipPolitikasi) {
    lines.push('Cari karar kurali: cari sadece profil politikasina ve surekli tedarikci listesine uygunsa kullanilir. Tek seferlik/emin olunmayan firmalarda cari acmayi varsayma.');
  }
  if (p.tahsilatHesabi) lines.push(`Tahsilat: ${p.tahsilatHesabi}${p.tahsilatHesapTuru ? ` (${p.tahsilatHesapTuru})` : ''}`);
  if (p.odemeHesabi) lines.push(`Odeme: ${p.odemeHesabi}${p.odemeHesapTuru ? ` (${p.odemeHesapTuru})` : ''}`);
  if (typeof p.tevkifataTabi === 'boolean') lines.push(`Tevkifata tabi: ${p.tevkifataTabi ? 'Evet' : 'Hayir'}`);

  if (p.demirbasKontrolAktif !== false) {
    lines.push('');
    lines.push('=== DEMIRBAS / OLAĞAN DISI FATURA KONTROLU ===');
    lines.push('Gercek mali musavir gibi bak: belge uzerindeki mal/hizmet aciklamasi, tutar, satici/alici, sektor, belge turu ve gecmis hafizayi birlikte degerlendir.');
    lines.push('Arac, bilgisayar, telefon, klima, TV, mobilya, makine, ekipman, cihaz veya uzun omurlu varlik satis/alisinda otomatik F2 yapma; karar onay_bekliyor olsun.');
    lines.push('Profilde satis/alıs kodu tanimli olmasi demirbas veya faaliyet disi islem riskini ortadan kaldirmaz.');
    if (p.demirbasAnahtarKelimeler) lines.push(`Demirbas anahtar kelimeleri: ${p.demirbasAnahtarKelimeler}`);
    if (p.demirbasTalimat) lines.push(`Demirbas talimati: ${p.demirbasTalimat}`);
  }

  lines.push('');
  lines.push('=== SISTEM KURALLARI ===');
  if (SISTEM_KURALLARI.tevkifat.aktif) {
    lines.push(`Tevkifat: ${SISTEM_KURALLARI.tevkifat.tetikleyiciIcerikler.join(', ')} icerikli faturalar KDV dahil ${SISTEM_KURALLARI.tevkifat.kdvDahilEsik.toLocaleString('tr-TR')} TL ve uzeri ise tevkifat acisindan kontrol edilir.`);
  }
  if (SISTEM_KURALLARI.kasaLimit.aktif) {
    lines.push(`Kasa limiti: Tahsilat/odeme hesabi ${SISTEM_KURALLARI.kasaLimit.hesapPrefix}.x ise tutar ${SISTEM_KURALLARI.kasaLimit.maxTutar.toLocaleString('tr-TR')} TL ustu olamaz.`);
  }

  if (p.talimat && String(p.talimat).trim()) {
    lines.push('');
    lines.push('=== OZEL TALIMATLAR ===');
    lines.push(String(p.talimat).trim());
  }

  return lines.join('\n');
}
