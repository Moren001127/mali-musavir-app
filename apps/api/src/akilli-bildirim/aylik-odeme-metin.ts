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

/** WhatsApp cetvel mesajı. */
export function odemeCetveliMesaji(g: CetvelMesajGirdisi): string {
  const lines: string[] = [];
  if (g.onEk) lines.push(g.onEk);
  lines.push(`🧾 *${cetvelBaslik(g.month, g.grup)}*`);
  lines.push(CIZGI);
  lines.push(`Sayın ${g.unvan},`);
  lines.push(g.grup === 'SGK' ? 'bu ay ödenecek SGK primleriniz:' : 'bu ay ödenecek vergi tahakkuklarınız:');
  lines.push('');
  for (const s of g.satirlar) {
    lines.push(`▸ ${satirAdi(s)} · ${donemEtiketi(s.donem)}`);
    lines.push(`    Son ödeme ${satirSonGun(s)} · ${paraTR(s.tutar)}`);
  }
  lines.push('');
  lines.push(`*Toplam: ${paraTR(grupToplam(g.satirlar))}*`);
  const linkler = (g.linkler || []).filter(Boolean);
  if (linkler.length === 1) {
    lines.push(`📎 ${g.grup === 'SGK' ? 'Tahakkuk fişi' : 'Tahakkuk fişleri'}: ${linkler[0]}`);
  } else if (linkler.length > 1) {
    lines.push('📎 Tahakkuk fişleri:');
    for (const l of linkler) lines.push(l);
  }
  lines.push(CIZGI);
  lines.push(`_${g.senderName}_`);
  return lines.join('\n');
}

/** WhatsApp metninden yıldız/alt çizgi işaretleri temizlenmiş düz metin (e-posta text alanı). */
export function duzMetin(whatsappMetni: string): string {
  return whatsappMetni.replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1');
}

const html = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** E-posta: konu + düz metin + HTML tablo. Ekler (PDF) çağıran tarafından eklenir. */
export function odemeCetveliEposta(g: CetvelMesajGirdisi): { subject: string; text: string; html: string } {
  const baslik = cetvelBaslik(g.month, g.grup);
  const subject = `${baslik} · ${g.unvan}`;
  const text = duzMetin(odemeCetveliMesaji(g));
  const satirlar = g.satirlar
    .map(
      (s) => `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6">${html(satirAdi(s))}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6">${html(donemEtiketi(s.donem))}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6;white-space:nowrap">${html(satirSonGun(s))}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6;text-align:right;white-space:nowrap">${html(paraTR(s.tutar))}</td>
</tr>`,
    )
    .join('\n');
  const linkler = (g.linkler || []).filter(Boolean);
  const linkHtml = linkler.length
    ? `<p style="margin:14px 0 0">📎 ${g.grup === 'SGK' ? 'Tahakkuk fişi' : 'Tahakkuk fişleri'}: ${linkler
        .map((l) => `<a href="${html(l)}">${html(l)}</a>`)
        .join('<br>')}</p>`
    : '';
  const body = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:640px">
${g.onEk ? `<p style="color:#a66;margin:0 0 8px">${html(g.onEk)}</p>` : ''}
<h2 style="margin:0 0 12px;font-size:18px">🧾 ${html(baslik)}</h2>
<p style="margin:0 0 4px">Sayın ${html(g.unvan)},</p>
<p style="margin:0 0 12px">${g.grup === 'SGK' ? 'bu ay ödenecek SGK primleriniz:' : 'bu ay ödenecek vergi tahakkuklarınız:'}</p>
<table style="border-collapse:collapse;width:100%">
<thead><tr style="background:#f3f3f3">
  <th style="text-align:left;padding:8px 10px">Ödeme</th>
  <th style="text-align:left;padding:8px 10px">Dönem</th>
  <th style="text-align:left;padding:8px 10px">Son ödeme</th>
  <th style="text-align:right;padding:8px 10px">Tutar</th>
</tr></thead>
<tbody>
${satirlar}
<tr><td colspan="3" style="padding:10px;text-align:right"><b>Toplam</b></td><td style="padding:10px;text-align:right;white-space:nowrap"><b>${html(paraTR(grupToplam(g.satirlar)))}</b></td></tr>
</tbody></table>
${linkHtml}
<p style="margin:18px 0 0;color:#666">${html(g.senderName)}</p>
</div>`;
  return { subject, text, html: body };
}
