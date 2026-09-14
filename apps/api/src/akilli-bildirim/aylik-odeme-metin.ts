/**
 * AYLIK ÖDEME CETVELİ — MESAJ METİNLERİ (saf; veritabanı/servis yok).
 *
 * Vergi ve SGK AYRI mesaj olarak gider (Hattat alışkanlığı korunur). WhatsApp metni ve e-posta
 * (konu + düz metin + HTML tablo) aynı satırlardan üretilir. Eski "Gönderen / Merhaba / Bilginize
 * Sunulmuştur" kalıbı KALDIRILDI (Muzaffer Bey onayı, 2026-09-14).
 *
 *   🧾 *Ağustos 2026 Ödeme Cetveli — Vergi*
 *   ━━━━━━━━━━━━━━━━━━━━
 *   Sayın ADEM CAN,
 *   bu ay ödenecek vergi tahakkuklarınız:
 *
 *   ▸ KDV Beyannamesi · Temmuz 2026
 *       Son ödeme 28.08.2026 · 7.046,77 ₺
 *
 *   *Toplam: 7.046,77 ₺*
 *   📎 Tahakkuk fişleri: <kısa link>
 *   ━━━━━━━━━━━━━━━━━━━━
 *   _Moren Mali Müşavirlik_
 */
import { ayAdi, donemEtiketi, OdemeSatiri } from './aylik-odeme-donem';

export const CIZGI = '━━━━━━━━━━━━━━━━━━━━';

/** "7.046,77 ₺" — tr-TR kuruş biçimi. */
export function paraTR(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + ' ₺';
}

/** "2026-08-28" → "28.08.2026"; "28.8.2026" → "28.08.2026"; boş → "—". */
export function tarihTR(t: string | null | undefined): string {
  const s = String(t || '').trim();
  if (!s) return '—';
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
  return s;
}

export type CetvelGrup = 'VERGI' | 'SGK';

export interface CetvelMesajGirdisi {
  month: string; // ödeme ayı "YYYY-MM"
  unvan: string;
  grup: CetvelGrup;
  satirlar: OdemeSatiri[];
  /** Kısa belge linkleri (birleşik PDF ise tek link). */
  linkler?: string[];
  senderName: string;
  /** Örnek gönderimde mesajın başına konan satır: "(ÖRNEK · ADEM CAN)". */
  onEk?: string | null;
}

export function grupBasligi(grup: CetvelGrup): string {
  return grup === 'SGK' ? 'SGK' : 'Vergi';
}

export function cetvelBaslik(month: string, grup: CetvelGrup): string {
  return `${ayAdi(month)} Ödeme Cetveli — ${grupBasligi(grup)}`;
}

export function grupToplam(satirlar: OdemeSatiri[]): number {
  return Math.round(satirlar.reduce((a, s) => a + (Number(s.tutar) || 0), 0) * 100) / 100;
}

/** Satırın okunur adı — SGK'da sunucu "Tahakkuk Fişi" bırakır; cetvelde "SGK Prim Tahakkuku". */
export function satirAdi(s: OdemeSatiri): string {
  if (s.kaynak === 'SGK') return 'SGK Prim Tahakkuku';
  return s.turAd || s.tur;
}

/** Son ödeme günü (kaydırılmış) — "28.08.2026". */
export function satirSonGun(s: OdemeSatiri): string {
  return tarihTR(s.sonGunIso || s.sonGun);
}

/** Hattat ile birebir: "4.182,86  TL" (çift boşluk). */
export function trMoney(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + '  TL';
}

/**
 * WhatsApp cetvel mesajı — Muzaffer Bey'in ORİJİNAL kalıbı (Hattat ile birebir). 2026-09-14'te yeni bir şablon denenmişti;
 * Muzaffer Bey "benim önceden oluşturduğum şablona vakıf kal" dedi → kalıp AYNEN korunur. Yalnız satır çeşitleri arttı
 * (geçici/yıllık tahakkuklar da aynı "KOD - Tahakkuk - Son Ödeme: g.a.yyyy - 1.234,56  TL" biçiminde yazılır).
 *
 *   *Gönderen*
 *   MOREN MALİ MÜŞAVİRLİK
 *
 *   *Merhaba*
 *    ADEM CAN,
 *
 *   Aşağıdaki Beyanname Dökümanları Bilginize Sunulmuştur,
 *
 *   KDV1 - Tahakkuk - Son Ödeme: 28.8.2026 - 7.046,77  TL
 *   Tahakkuk Fişi - 2026/07 - Son Ödeme: 31.8.2026 - 24.277,05  TL   (SGK)
 *
 *   Toplam: 31.323,82  TL
 *
 *   <kısa link>
 */
export function odemeCetveliMesaji(g: CetvelMesajGirdisi): string {
  const lines: string[] = [];
  if (g.onEk) lines.push(g.onEk);
  lines.push('*Gönderen* ');
  lines.push(g.senderName);
  lines.push('');
  lines.push('*Merhaba* ');
  lines.push(` ${g.unvan},`);
  lines.push('');
  lines.push(`Aşağıdaki ${g.grup === 'SGK' ? 'SGK' : 'Beyanname'} Dökümanları Bilginize Sunulmuştur,`);
  lines.push('');
  for (const s of g.satirlar) {
    // Vergi: "KDV1 - Tahakkuk - Son Ödeme: 28.7.2026 - 9.018,30  TL"
    // SGK  : "Tahakkuk Fişi - 2026/06 - Son Ödeme: 31.7.2026 - 24.277,05  TL"
    const parts = s.kaynak === 'VERGI' ? [s.tur, 'Tahakkuk'] : [s.tur, s.donem];
    if (s.sonGun) parts.push(`Son Ödeme: ${s.sonGun}`);
    parts.push(trMoney(s.tutar));
    lines.push(parts.join(' - '));
  }
  lines.push('');
  lines.push(`Toplam: ${trMoney(grupToplam(g.satirlar))}`);
  const linkler = (g.linkler || []).filter(Boolean);
  if (linkler.length > 0) {
    lines.push('');
    for (const l of linkler) lines.push(l);
  }
  return lines.join('\n');
}

/** WhatsApp metninden yıldız/alt çizgi işaretleri temizlenmiş düz metin (e-posta text alanı). */
export function duzMetin(whatsappMetni: string): string {
  return whatsappMetni.replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1');
}

const htmlKacis = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** E-posta — orijinal kalıp: konu "Beyanname Dökümanları — ADEM CAN", metin WhatsApp metninin yıldızsız hâli; ekler (PDF) çağıran ekler. */
export function odemeCetveliEposta(g: CetvelMesajGirdisi): { subject: string; text: string; html: string } {
  const subject = `${g.grup === 'SGK' ? 'SGK' : 'Beyanname'} Dökümanları — ${g.unvan}`;
  const text = odemeCetveliMesaji(g).replace(/\*/g, '');
  const html = `<pre style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;white-space:pre-wrap">${htmlKacis(text)}</pre>`;
  return { subject, text, html };
}
