/**
 * AgentRule.profile JSON'unu Claude prompt'una insan-okunur format çevirir.
 * Frontend'deki aynı dönüştürücüyle simetri.
 */

import { SISTEM_KURALLARI } from './sistem-kurallari';

interface KdvOranBazli {
  yuzde1?: string;
  yuzde10?: string;
  yuzde20?: string;
}

export function profileToPromptText(p: any): string {
  if (!p || typeof p !== 'object') return '';
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
  // v1.36.60: Mal Alışı Matrahı — ZORUNLU ÖNCELİK
  oranSatir('Mal Alışı Matrahı (ZORUNLU ÖNCELİK)', p.malAlisMatrah);
  oranSatir('Hesaplanan KDV', p.hesaplananKdv);
  oranSatir('İndirilecek KDV', p.indirilecekKdv);

  // v1.36.60: Mal alışı tanımlıysa AI'ya net direktif — VendorMemory'den önceliklidir
  if (p.malAlisMatrah && (p.malAlisMatrah.yuzde1 || p.malAlisMatrah.yuzde10 || p.malAlisMatrah.yuzde20)) {
    lines.push('');
    lines.push('🔴 ZORUNLU KURAL — TICARI MAL ALIŞI:');
    lines.push('Mükellef profili "Mal Alışı Matrahı" tanımlıdır. Alış faturası için:');
    lines.push('1. Faturanın KDV oranını belirle (%1, %10, %20)');
    lines.push('2. Profilde o orana karşılık gelen Mal Alışı kodunu KULLAN');
    lines.push('3. VendorMemory geçmişi farklı kod gösterse bile profil önceliklidir');
    lines.push('4. Hesap kodu profil ile uyumluysa "onay" karar ver, "onay_bekliyor" YOK');
    lines.push('5. Sadece profilde tanımlı OLMAYAN bir KDV oranı (%8 vs.) gelirse onay_bekliyor');
  }

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

  // Sistem kuralları (her mükellef için aynı)
  lines.push('');
  lines.push('=== SİSTEM KURALLARI ===');
  if (SISTEM_KURALLARI.tevkifat.aktif) {
    lines.push(`• Tevkifat: ${SISTEM_KURALLARI.tevkifat.tetikleyiciIcerikler.join(', ')} içerikli faturalar KDV dahil ${SISTEM_KURALLARI.tevkifat.kdvDahilEsik.toLocaleString('tr-TR')} TL ve üzeri ise tevkifatlı olmalı.`);
  }
  if (SISTEM_KURALLARI.kasaLimit.aktif) {
    lines.push(`• Kasa limiti: Tahsilat/Ödeme hesabı ${SISTEM_KURALLARI.kasaLimit.hesapPrefix}.x (kasa) ise tutar ${SISTEM_KURALLARI.kasaLimit.maxTutar.toLocaleString('tr-TR')} TL üstü olamaz.`);
  }

  // Özel talimat (serbest)
  if (p.talimat && String(p.talimat).trim()) {
    lines.push('');
    lines.push('=== ÖZEL TALİMATLAR ===');
    lines.push(String(p.talimat).trim());
  }
  return lines.join('\n');
}
