/**
 * AYLIK ÖDEME CETVELİ — A4 PDF ŞABLONU (saf HTML üretimi; Chromium'a servis verir).
 *
 * Her mükellef ayrı sayfa (`page-break-after`). Muzaffer Bey (2026-09-14): "Sayın <mükellef> ile başlasın, altında
 * '… dönemi Vergi ve SGK ödeme bilgileriniz detaylı olarak aşağıda sunulmuştur' yazsın; çok basit olmuş, güzelleştir."
 * Düzen: üst şerit (logo + ofis adı + iletişim | cetvel adı + düzenleme tarihi) → hitap + giriş cümlesi → gruplu tablolar
 * (Vergi / SGK; şerit başlık, zebra satır, ara toplam) → genel toplam kutusu → notlar → alt bilgi. Para "1.234,56 TL"
 * (₺ işareti Chromium'un fontunda yok, kutu çıkıyordu).
 */
import { ayAdi, donemEtiketi, OdemeListesi, OdemeSatiri } from './aylik-odeme-donem';
import { satirAdi, satirSonGun } from './aylik-odeme-metin';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const CETVEL_NOTU = 'Son ödeme günü hafta sonuna veya resmî tatile denk gelen kalemler ilk iş gününe kaydırılmıştır.';

/** PDF'te para: "1.234,56 TL" */
export function paraPdf(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + ' TL';
}

export interface CetvelHtmlGirdisi {
  month: string;
  senderName: string;
  logoDataUri?: string | null;
  /** Ofis iletişim satırı (telefon · e-posta · adres) — varsa üst şeritte */
  ofisIletisim?: string | null;
  mukellefler: OdemeListesi[];
  uretimTarihi?: Date;
}

function grupTablosu(baslik: string, aciklama: string, satirlar: OdemeSatiri[]): string {
  if (!satirlar.length) return '';
  const toplam = satirlar.reduce((a, s) => a + (Number(s.tutar) || 0), 0);
  const rows = satirlar
    .map(
      (s, i) => `<tr class="${i % 2 ? 'cift' : 'tek'}">
  <td class="ad">${esc(satirAdi(s))}${s.taksit ? ` <span class="rozet">${esc(s.taksit)} taksit</span>` : ''}</td>
  <td>${esc(donemEtiketi(s.donem))}</td>
  <td class="orta">${esc(satirSonGun(s))}${s.sonGunHam && s.sonGun && s.sonGunHam !== s.sonGun ? ' <span class="kaydi">*</span>' : ''}</td>
  <td class="num">${esc(paraPdf(s.tutar))}</td>
</tr>`,
    )
    .join('\n');
  return `<div class="grup">
  <div class="grup-bas"><span class="grup-ad">${esc(baslik)}</span><span class="grup-acik">${esc(aciklama)}</span><span class="grup-adet">${satirlar.length} kalem</span></div>
  <table>
    <colgroup><col style="width:44%"><col style="width:22%"><col style="width:16%"><col style="width:18%"></colgroup>
    <thead><tr><th>Ödeme</th><th>Dönem</th><th class="orta">Son ödeme</th><th class="num">Tutar</th></tr></thead>
    <tbody>
${rows}
      <tr class="ara"><td colspan="3">${esc(baslik)} toplamı</td><td class="num">${esc(paraPdf(toplam))}</td></tr>
    </tbody>
  </table>
</div>`;
}

function sayfa(g: CetvelHtmlGirdisi, m: OdemeListesi, sonSayfa: boolean): string {
  const vergi = m.satirlar.filter((s) => s.kaynak === 'VERGI');
  const sgk = m.satirlar.filter((s) => s.kaynak === 'SGK');
  const genel = m.satirlar.reduce((a, s) => a + (Number(s.tutar) || 0), 0);
  const kaydirilanVar = m.satirlar.some((s) => s.sonGunHam && s.sonGun && s.sonGunHam !== s.sonGun);
  const ay = ayAdi(g.month);
  const kapsam = vergi.length && sgk.length ? 'Vergi ve SGK' : sgk.length ? 'SGK' : 'Vergi';
  const tarih = (g.uretimTarihi || new Date()).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<section class="sayfa${sonSayfa ? ' son' : ''}">
  <header class="ust">
    <div class="ofis">
      ${g.logoDataUri ? `<img class="logo" src="${g.logoDataUri}" alt="">` : ''}
      <div>
        <div class="ofis-ad">${esc(g.senderName)}</div>
        ${g.ofisIletisim ? `<div class="ofis-iletisim">${esc(g.ofisIletisim)}</div>` : ''}
      </div>
    </div>
    <div class="baslik">
      <div class="cetvel">Ödeme Cetveli</div>
      <div class="donem">${esc(ay)}</div>
      <div class="tarih">Düzenleme tarihi: ${esc(tarih)}</div>
    </div>
  </header>

  <div class="hitap">
    <div class="sayin">Sayın ${esc(m.unvan)},</div>
    <p class="giris">${esc(ay)} dönemi ${kapsam} ödeme bilgileriniz detaylı olarak aşağıda sunulmuştur. Ödemelerinizi son ödeme günlerini dikkate alarak yapmanızı rica ederiz.</p>
  </div>

  ${grupTablosu('Vergi', 'Beyanname tahakkukları', vergi)}
  ${grupTablosu('SGK', 'Sigorta prim tahakkukları', sgk)}

  <div class="genel">
    <div class="genel-etiket">Bu ay ödenecek toplam</div>
    <div class="genel-tutar">${esc(paraPdf(genel))}</div>
  </div>

  <div class="notlar">
    ${kaydirilanVar ? `<div>* ${esc(CETVEL_NOTU)}</div>` : ''}
    <div>Tahakkuk fişleri ve beyanname örnekleri size ayrıca iletilmiştir; ödeme sırasında ilgili tahakkuk fişini kullanınız.</div>
    <div>Bu cetvel bilgilendirme amaçlıdır; tutarlar ilgili kurum tahakkuklarına dayanır.</div>
  </div>

  <footer class="alt">
    <span>${esc(g.senderName)}</span>
    <span>${esc(ay)} Ödeme Cetveli · ${esc(m.unvan)}</span>
  </footer>
</section>`;
}

export function cetvelHtml(g: CetvelHtmlGirdisi): string {
  const sayfalar = g.mukellefler.map((m, i) => sayfa(g, m, i === g.mukellefler.length - 1)).join('\n');
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>${esc(ayAdi(g.month))} Ödeme Cetveli</title>
<style>
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif; font-size: 11.5px; color: #222; margin: 0; }
  .sayfa { page-break-after: always; position: relative; min-height: 250mm; padding-bottom: 14mm; }
  .sayfa.son { page-break-after: auto; }

  .ust { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; margin-bottom: 18px;
         border-bottom: 3px solid #b9974a; }
  .ofis { display: flex; align-items: center; gap: 12px; }
  .logo { height: 46px; width: auto; }
  .ofis-ad { font-weight: 700; font-size: 15px; letter-spacing: .3px; color: #1c1a16; }
  .ofis-iletisim { color: #777; font-size: 10px; margin-top: 3px; }
  .baslik { text-align: right; }
  .cetvel { font-size: 11px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #8a6d2b; }
  .donem { font-size: 20px; font-weight: 800; color: #1c1a16; margin-top: 2px; }
  .tarih { color: #777; font-size: 10px; margin-top: 4px; }

  .hitap { margin: 0 0 16px; }
  .sayin { font-size: 15px; font-weight: 700; color: #1c1a16; margin-bottom: 6px; }
  .giris { margin: 0; color: #444; line-height: 1.55; font-size: 11.5px; max-width: 150mm; }

  .grup { margin-top: 14px; border: 1px solid #e3ddcf; border-radius: 6px; overflow: hidden; page-break-inside: avoid; }
  .grup-bas { display: flex; align-items: baseline; gap: 10px; background: #f4efe3; padding: 7px 10px; border-bottom: 1px solid #d9cfb5; }
  .grup-ad { font-weight: 800; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #6e5620; }
  .grup-acik { color: #7a7267; font-size: 10.5px; }
  .grup-adet { margin-left: auto; color: #7a7267; font-size: 10.5px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { background: #fbf9f4; text-align: left; padding: 6px 10px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #6b6255; border-bottom: 1px solid #e3ddcf; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee9de; vertical-align: top; }
  tr.cift td { background: #fcfbf8; }
  td.ad { font-weight: 600; color: #1c1a16; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .orta { text-align: center; white-space: nowrap; }
  tr.ara td { font-weight: 700; background: #f4efe3; border-bottom: none; }
  .rozet { display: inline-block; font-size: 9px; padding: 0 5px; border: 1px solid #c9b47c; border-radius: 8px; color: #6e5620; margin-left: 5px; font-weight: 600; }
  .kaydi { color: #a06a00; font-weight: 700; }

  .genel { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; padding: 12px 14px;
           background: #1c1a16; color: #f6efdf; border-radius: 6px; }
  .genel-etiket { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #d9c79a; font-weight: 700; }
  .genel-tutar { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }

  .notlar { margin-top: 16px; color: #6b6255; font-size: 10px; line-height: 1.6; }
  .alt { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; color: #999; font-size: 9.5px;
         border-top: 1px solid #e3ddcf; padding-top: 6px; }
</style></head>
<body>
${sayfalar || '<p>Bu ay için ödeme kalemi bulunmuyor.</p>'}
</body></html>`;
}
