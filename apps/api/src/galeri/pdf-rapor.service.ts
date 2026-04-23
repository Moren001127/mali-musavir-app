import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HGS İhlal Sorgu Raporu — print-optimize HTML üretir.
 * Tarayıcıda açılır, Ctrl+P → PDF kaydet ile arşivlenir.
 *
 * Format: Selim Motors logo + ünvan üstte, plakalara göre gruplu
 * ihlal tablosu, her plaka için alt toplam, en altta GENEL TOPLAM.
 */
@Injectable()
export class PdfRaporService {
  constructor(private prisma: PrismaService) {}

  private fmtTarih(iso: Date | string | null): string {
    if (!iso) return '—';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private fmtTL(n: number | null | undefined): string {
    if (n == null) return '—';
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₺';
  }

  private fmtPlaka(p: string): string {
    const s = (p || '').replace(/\s/g, '').toUpperCase();
    const m = s.match(/^(\d{1,3})([A-Z]{1,3})(\d{1,4})$/);
    return m ? `${m[1]} ${m[2]} ${m[3]}` : s;
  }

  /**
   * Tüm araçlar için genel rapor HTML'i üret.
   * @param tenantId
   * @param opts { sadeceIhlalli: sadece ihlal bulunan plakaları göster }
   */
  async topluRaporHtml(
    tenantId: string,
    opts: { sadeceIhlalli?: boolean } = {},
  ): Promise<string> {
    const araclar = await (this.prisma as any).arac.findMany({
      where: { tenantId, aktif: true },
      include: {
        hgsSonuclari: {
          orderBy: { sorguTarihi: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ plaka: 'asc' }],
    });

    // Genel toplamlar
    let genelIhlal = 0;
    let genelTutar = 0;
    let ihlalliPlaka = 0;

    // Her plakanın kendi satırları + alt toplamı
    const plakaBloklari: string[] = [];

    for (const a of araclar) {
      const sonuc = a.hgsSonuclari?.[0];
      if (!sonuc) {
        // Sorgulanmamış
        if (opts.sadeceIhlalli) continue;
        plakaBloklari.push(`
          <tbody class="plaka-blok">
            <tr class="plaka-baslik">
              <td colspan="6">
                <span class="plaka-kutu">${this.fmtPlaka(a.plaka)}</span>
                <span class="arac-aciklama">${this.esc(a.marka || '')} ${this.esc(a.model || '')} ${a.sahipAd ? '· ' + this.esc(a.sahipAd) : ''}</span>
                <span class="plaka-etiket bekleniyor">Sorgulanmamış</span>
              </td>
            </tr>
          </tbody>
        `);
        continue;
      }

      const ihlalSayisi = sonuc.ihlalSayisi || 0;
      const tutar = Number(sonuc.toplamTutar || 0);
      const detaylar: any[] = Array.isArray(sonuc.detaylar) ? sonuc.detaylar : [];

      if (opts.sadeceIhlalli && ihlalSayisi === 0) continue;

      if (ihlalSayisi > 0) ihlalliPlaka++;
      genelIhlal += ihlalSayisi;
      genelTutar += tutar;

      const ihlalSatirlari = detaylar.length > 0
        ? detaylar.map((d: any, i: number) => `
            <tr class="ihlal-satiri">
              <td class="s-no">${i + 1}</td>
              <td>${this.esc(d.tarih || d.ihlalTarihi || '—')}</td>
              <td>${this.esc(d.saat || '—')}</td>
              <td>${this.esc(d.ucretNoktasi || d.gecisNoktasi || '—')}</td>
              <td>${this.esc(d.aciklama || d.ihlalTuru || 'İhlalli geçiş')}</td>
              <td class="s-tutar">${this.fmtTL(Number(d.tutar || 0))}</td>
            </tr>
          `).join('')
        : (ihlalSayisi > 0
            ? `<tr class="ihlal-satiri ozet">
                 <td class="s-no">—</td>
                 <td colspan="4">${ihlalSayisi} ihlalli geçiş (detay kaydedilmemiş)</td>
                 <td class="s-tutar">${this.fmtTL(tutar)}</td>
               </tr>`
            : `<tr class="ihlal-satiri bos">
                 <td colspan="6">İhlal kaydı yok — <span class="ok">✓ Temiz</span></td>
               </tr>`);

      const durumEtiket = ihlalSayisi > 0
        ? `<span class="plaka-etiket ihlalli">${ihlalSayisi} İhlal</span>`
        : `<span class="plaka-etiket temiz">Temiz</span>`;

      plakaBloklari.push(`
        <tbody class="plaka-blok">
          <tr class="plaka-baslik">
            <td colspan="6">
              <span class="plaka-kutu">${this.fmtPlaka(a.plaka)}</span>
              <span class="arac-aciklama">${this.esc(a.marka || '')} ${this.esc(a.model || '')} ${a.sahipAd ? '· ' + this.esc(a.sahipAd) : ''}</span>
              ${durumEtiket}
              <span class="sorgu-tarihi">Sorgu: ${this.fmtTarih(sonuc.sorguTarihi)}</span>
            </td>
          </tr>
          ${ihlalSatirlari}
          ${ihlalSayisi > 0 ? `
            <tr class="alt-toplam">
              <td colspan="5">${this.fmtPlaka(a.plaka)} — Alt Toplam</td>
              <td class="s-tutar"><b>${this.fmtTL(tutar)}</b></td>
            </tr>
          ` : ''}
        </tbody>
      `);
    }

    const bugun = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });

    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>HGS İhlal Raporu — Selim Motors</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm 12mm; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    font-size: 11pt;
    line-height: 1.5;
    background: #fff;
    margin: 0;
    padding: 16px;
  }
  @media screen {
    body { max-width: 210mm; margin: 20px auto; padding: 24px 28px; box-shadow: 0 2px 20px rgba(0,0,0,0.08); background: #fff; }
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #b8956a;
    padding-bottom: 14px;
    margin-bottom: 20px;
  }
  .logo-wrap { display: flex; align-items: center; gap: 14px; }
  .logo-svg { width: 72px; height: 40px; }
  .unvan-wrap { line-height: 1.25; }
  .unvan { font-family: Georgia, serif; font-size: 18pt; font-weight: 500; letter-spacing: 2.5px; color: #0f0d0b; }
  .alt-unvan { font-size: 8pt; color: #8a7240; letter-spacing: 3.5px; margin-top: 2px; }
  .rapor-bilgi { text-align: right; font-size: 9pt; color: #555; }
  .rapor-bilgi .baslik { font-weight: 500; font-size: 10.5pt; color: #0f0d0b; letter-spacing: 1.5px; }
  .rapor-bilgi .tarih { color: #8a7240; margin-top: 2px; }

  .ozet {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 18px;
  }
  .ozet-k {
    background: #faf7f1;
    border: 1px solid #e8dcc4;
    border-radius: 4px;
    padding: 9px 12px;
  }
  .ozet-k .etiket { font-size: 8pt; color: #8a7240; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 500; }
  .ozet-k .deger { font-size: 14pt; font-weight: 500; color: #0f0d0b; margin-top: 4px; }
  .ozet-k.kirmizi .deger { color: #b83939; }
  .ozet-k.yesil .deger { color: #2d7a3d; }

  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .plaka-blok { break-inside: avoid; }
  .plaka-baslik td {
    background: #0f0d0b;
    color: #fff;
    padding: 8px 12px;
    font-weight: 500;
    letter-spacing: 0.3px;
    border-top: 6px solid #b8956a;
  }
  .plaka-kutu {
    display: inline-block;
    background: #fff;
    color: #0f0d0b;
    font-family: 'Courier New', monospace;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 3px;
    letter-spacing: 1px;
    font-size: 11pt;
    margin-right: 10px;
  }
  .arac-aciklama { color: rgba(255,255,255,0.7); font-weight: 400; font-size: 9pt; }
  .plaka-etiket {
    float: right;
    background: rgba(255,255,255,0.1);
    padding: 3px 10px;
    border-radius: 10px;
    font-size: 8.5pt;
    font-weight: 500;
    letter-spacing: 0.5px;
  }
  .plaka-etiket.ihlalli { background: #b83939; color: #fff; }
  .plaka-etiket.temiz { background: #2d7a3d; color: #fff; }
  .plaka-etiket.bekleniyor { background: #6b6b6b; color: #fff; }
  .sorgu-tarihi { float: right; font-size: 8.5pt; color: rgba(255,255,255,0.55); margin-right: 10px; padding-top: 2px; }

  .ihlal-satiri td {
    padding: 7px 12px;
    border-bottom: 1px solid #e8e8e8;
    background: #fff;
  }
  .ihlal-satiri.bos td { text-align: center; color: #888; font-style: italic; padding: 12px; }
  .ihlal-satiri .ok { color: #2d7a3d; font-weight: 500; }
  .s-no { width: 32px; text-align: center; color: #888; }
  .s-tutar { text-align: right; font-family: 'Courier New', monospace; white-space: nowrap; }

  .alt-toplam td {
    background: #faf7f1;
    padding: 7px 12px;
    border-top: 1px solid #b8956a;
    border-bottom: 2px solid #b8956a;
    font-size: 9.5pt;
    letter-spacing: 0.3px;
  }
  .alt-toplam td:first-child { text-align: right; color: #8a7240; font-weight: 500; }

  .genel-toplam {
    margin-top: 28px;
    border-top: 3px double #0f0d0b;
    padding-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .genel-toplam .etiket { font-size: 12pt; letter-spacing: 2.5px; font-weight: 500; color: #0f0d0b; }
  .genel-toplam .rakam { font-size: 18pt; font-weight: 500; color: #b83939; font-family: 'Courier New', monospace; }

  .imza {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 80px;
    margin-top: 56px;
    font-size: 9pt;
    color: #555;
  }
  .imza-kutu { border-top: 1px solid #bbb; padding-top: 8px; text-align: center; }

  .footer {
    margin-top: 32px;
    font-size: 8pt;
    color: #999;
    text-align: center;
    border-top: 1px solid #eee;
    padding-top: 10px;
  }
  @media print { .no-print { display: none !important; } }
  .no-print {
    position: sticky;
    top: 12px;
    background: #b8956a;
    color: #fff;
    padding: 10px 16px;
    border-radius: 6px;
    margin-bottom: 14px;
    text-align: center;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>
  <div class="no-print" onclick="window.print()">🖨️  PDF olarak kaydet (Ctrl+P veya tıklayın)</div>

  <div class="header">
    <div class="logo-wrap">
      <svg class="logo-svg" viewBox="0 0 108 52" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(0, 6)">
          <path d="M8,34 L16,22 Q20,16 28,14 L60,14 Q68,15 74,20 L86,24 Q96,26 99,34 Z" fill="none" stroke="#b8956a" stroke-width="1.8" stroke-linejoin="round"/>
          <line x1="34" y1="17" x2="62" y2="17" stroke="#b8956a" stroke-width="0.6"/>
          <path d="M36,14.5 L40,10 L56,10 L60,14.5 Z" fill="none" stroke="#b8956a" stroke-width="0.8"/>
          <circle cx="26" cy="34" r="5" fill="#fff" stroke="#0f0d0b" stroke-width="1.3"/>
          <circle cx="26" cy="34" r="1.8" fill="#b8956a"/>
          <circle cx="82" cy="34" r="5" fill="#fff" stroke="#0f0d0b" stroke-width="1.3"/>
          <circle cx="82" cy="34" r="1.8" fill="#b8956a"/>
        </g>
      </svg>
      <div class="unvan-wrap">
        <div class="unvan">SELİM MOTORS</div>
        <div class="alt-unvan">OTO GALERİ · İSTANBUL</div>
      </div>
    </div>
    <div class="rapor-bilgi">
      <div class="baslik">HGS İHLAL SORGU RAPORU</div>
      <div class="tarih">${bugun}</div>
    </div>
  </div>

  <div class="ozet">
    <div class="ozet-k"><div class="etiket">Toplam Araç</div><div class="deger">${araclar.length}</div></div>
    <div class="ozet-k ${ihlalliPlaka > 0 ? 'kirmizi' : 'yesil'}"><div class="etiket">İhlalli Araç</div><div class="deger">${ihlalliPlaka}</div></div>
    <div class="ozet-k"><div class="etiket">Toplam İhlal</div><div class="deger">${genelIhlal}</div></div>
    <div class="ozet-k kirmizi"><div class="etiket">Toplam Tutar</div><div class="deger">${this.fmtTL(genelTutar)}</div></div>
  </div>

  <table>
    <thead>
      <tr style="font-size: 8pt; text-transform: uppercase; letter-spacing: 1.2px; color: #888;">
        <th style="width:32px; padding:6px 8px; text-align:center;">#</th>
        <th style="padding:6px 12px; text-align:left;">Tarih</th>
        <th style="padding:6px 12px; text-align:left;">Saat</th>
        <th style="padding:6px 12px; text-align:left;">Ücret Noktası</th>
        <th style="padding:6px 12px; text-align:left;">Açıklama</th>
        <th style="padding:6px 12px; text-align:right;">Tutar</th>
      </tr>
    </thead>
    ${plakaBloklari.join('\n')}
  </table>

  <div class="genel-toplam">
    <span class="etiket">GENEL TOPLAM</span>
    <span class="rakam">${this.fmtTL(genelTutar)}</span>
  </div>

  <div class="imza">
    <div class="imza-kutu">Düzenleyen<br><br></div>
    <div class="imza-kutu">Onaylayan<br><br></div>
  </div>

  <div class="footer">
    Bu rapor Moren Portal Galeri modülü ile otomatik olarak üretilmiştir. · ${new Date().toLocaleString('tr-TR')}
  </div>
</body>
</html>`;
  }

  private esc(s: string | null | undefined): string {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
