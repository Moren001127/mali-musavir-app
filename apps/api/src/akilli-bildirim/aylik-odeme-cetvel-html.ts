/**
 * AYLIK ÖDEME CETVELİ — A4 PDF ŞABLONU (saf HTML üretimi; Chromium'a servis verir).
 *
 * Her mükellef ayrı sayfa (`page-break-after`). Ofis adı (senderName) + logo (base64), "Ağustos 2026 Ödeme
 * Cetveli", mükellef adı, VERGİ ve SGK grup başlıkları + ara toplam, genel toplam, altta kaydırma notu.
 */
import { ayAdi, donemEtiketi, OdemeListesi, OdemeSatiri } from './aylik-odeme-donem';
import { paraTR, satirAdi, satirSonGun } from './aylik-odeme-metin';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const CETVEL_NOTU = 'Son ödeme günü hafta sonuna/tatile denk gelen kalemler ilk iş gününe kaydırılmıştır.';

export interface CetvelHtmlGirdisi {
  month: string;
  senderName: string;
  logoDataUri?: string | null;
  mukellefler: OdemeListesi[];
  uretimTarihi?: Date;
}

function grupTablosu(baslik: string, satirlar: OdemeSatiri[]): string {
  if (!satirlar.length) return '';
  const toplam = satirlar.reduce((a, s) => a + (Number(s.tutar) || 0), 0);
  const rows = satirlar
    .map(
      (s) => `<tr>
  <td>${esc(satirAdi(s))}${s.taksit ? ` <span class="rozet">${esc(s.taksit)}</span>` : ''}</td>
  <td>${esc(donemEtiketi(s.donem))}</td>
  <td class="orta">${esc(satirSonGun(s))}${s.sonGunHam && s.sonGun && s.sonGunHam !== s.sonGun ? ' <span class="kaydi">*</span>' : ''}</td>
  <td class="num">${esc(paraTR(s.tutar))}</td>
</tr>`,
    )
    .join('\n');
  return `<h3 class="grup">${esc(baslik)}</h3>
<table>
<colgroup><col style="width:44%"><col style="width:22%"><col style="width:16%"><col style="width:18%"></colgroup>
<thead><tr><th>Ödeme</th><th>Dönem</th><th class="orta">Son ödeme</th><th class="num">Tutar</th></tr></thead>
<tbody>
${rows}
<tr class="ara"><td colspan="3">${esc(baslik)} ara toplam</td><td class="num">${esc(paraTR(toplam))}</td></tr>
</tbody></table>`;
}

function sayfa(g: CetvelHtmlGirdisi, m: OdemeListesi, sonSayfa: boolean): string {
  const vergi = m.satirlar.filter((s) => s.kaynak === 'VERGI');
  const sgk = m.satirlar.filter((s) => s.kaynak === 'SGK');
  const genel = m.satirlar.reduce((a, s) => a + (Number(s.tutar) || 0), 0);
  const kaydirilanVar = m.satirlar.some((s) => s.sonGunHam && s.sonGun && s.sonGunHam !== s.sonGun);
  return `<section class="sayfa${sonSayfa ? ' son' : ''}">
  <header class="ust">
    <div class="ofis">
      ${g.logoDataUri ? `<img class="logo" src="${g.logoDataUri}" alt="">` : ''}
      <div class="ofis-ad">${esc(g.senderName)}</div>
    </div>
    <div class="baslik">
      <div class="cetvel">${esc(ayAdi(g.month))} Ödeme Cetveli</div>
      <div class="tarih">Düzenleme: ${esc((g.uretimTarihi || new Date()).toLocaleDateString('tr-TR'))}</div>
    </div>
  </header>
  <div class="mukellef">${esc(m.unvan)}</div>
  ${grupTablosu('VERGİ', vergi)}
  ${grupTablosu('SGK', sgk)}
  <table class="genel"><tr><td>GENEL TOPLAM</td><td class="num">${esc(paraTR(genel))}</td></tr></table>
  <footer class="alt">${kaydirilanVar ? '* ' : ''}${esc(CETVEL_NOTU)}</footer>
</section>`;
}

export function cetvelHtml(g: CetvelHtmlGirdisi): string {
  const sayfalar = g.mukellefler.map((m, i) => sayfa(g, m, i === g.mukellefler.length - 1)).join('\n');
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>${esc(ayAdi(g.month))} Ödeme Cetveli</title>
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "DejaVu Sans", Arial, sans-serif; font-size: 11.5px; color: #1e1e1e; margin: 0; }
  .sayfa { page-break-after: always; }
  .sayfa.son { page-break-after: auto; }
  .ust { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #b9974a; padding-bottom: 8px; margin-bottom: 14px; }
  .ofis { display: flex; align-items: center; gap: 10px; }
  .logo { height: 44px; width: auto; }
  .ofis-ad { font-weight: 700; font-size: 14px; letter-spacing: .3px; }
  .baslik { text-align: right; }
  .cetvel { font-size: 16px; font-weight: 700; color: #6e5620; }
  .tarih { color: #777; font-size: 10.5px; margin-top: 2px; }
  .mukellef { font-size: 15px; font-weight: 700; margin: 4px 0 12px; }
  h3.grup { font-size: 12px; margin: 14px 0 6px; color: #6e5620; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { background: #f4efe3; text-align: left; padding: 6px 8px; font-size: 10.5px; border-bottom: 1px solid #d9cfb5; }
  td { padding: 6px 8px; border-bottom: 1px solid #ececec; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .orta { text-align: center; white-space: nowrap; }
  tr.ara td { font-weight: 600; background: #faf7f0; }
  .genel { margin-top: 14px; }
  .genel td { font-weight: 800; font-size: 13px; border-top: 2px solid #b9974a; border-bottom: none; padding-top: 8px; }
  .rozet { display: inline-block; font-size: 9.5px; padding: 0 5px; border: 1px solid #c9b47c; border-radius: 8px; color: #6e5620; margin-left: 4px; }
  .kaydi { color: #a06a00; font-weight: 700; }
  .alt { margin-top: 18px; color: #666; font-size: 10px; border-top: 1px dashed #ddd; padding-top: 6px; }
</style></head>
<body>
${sayfalar || '<p>Bu ay için ödeme kalemi bulunmuyor.</p>'}
</body></html>`;
}
