import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res,
  UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CariKasaService } from './cari-kasa.service';
import * as ExcelJS from 'exceljs';

@Controller('cari-kasa')
@UseGuards(AuthGuard('jwt'))
export class CariKasaController {
  constructor(private readonly service: CariKasaService) {}

  // ==================== HİZMET ====================
  @Get('hizmet')
  listHizmetler(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.service.listHizmetler(req.user.tenantId, taxpayerId);
  }

  @Post('hizmet')
  createHizmet(@Req() req: any, @Body() body: any) {
    return this.service.createHizmet(req.user.tenantId, body);
  }

  @Put('hizmet/:id')
  updateHizmet(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateHizmet(req.user.tenantId, id, body);
  }

  @Delete('hizmet/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHizmet(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteHizmet(req.user.tenantId, id);
  }

  // ==================== HAREKET ====================
  @Get('hareket')
  listHareketler(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('baslangic') baslangic?: string,
    @Query('bitis') bitis?: string,
    @Query('tip') tip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listHareketler(req.user.tenantId, {
      taxpayerId, baslangic, bitis, tip,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('tahsilat')
  createTahsilat(@Req() req: any, @Body() body: any) {
    return this.service.createTahsilat(req.user.tenantId, body, req.user.sub);
  }

  @Post('tahakkuk')
  createManuelTahakkuk(@Req() req: any, @Body() body: any) {
    return this.service.createManuelTahakkuk(req.user.tenantId, body, req.user.sub);
  }

  @Delete('hareket/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHareket(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteHareket(req.user.tenantId, id);
  }

  // ==================== BAKİYE & ÖZET ====================
  @Get('bakiye/:taxpayerId')
  bakiye(@Req() req: any, @Param('taxpayerId') taxpayerId: string) {
    return this.service.hesaplaBakiye(req.user.tenantId, taxpayerId);
  }

  @Get('ozet')
  genelOzet(
    @Req() req: any,
    @Query('baslangic') baslangic?: string,
    @Query('bitis') bitis?: string,
  ) {
    return this.service.genelOzet(req.user.tenantId, baslangic, bitis);
  }

  @Get('istatistikler')
  istatistikler(@Req() req: any) {
    return this.service.istatistikler(req.user.tenantId);
  }

  // ==================== EKSTRE ====================
  @Get('ekstre/:taxpayerId')
  ekstre(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Query('baslangic') baslangic: string,
    @Query('bitis') bitis: string,
  ) {
    if (!baslangic || !bitis) throw new BadRequestException('baslangic ve bitis gerekli');
    return this.service.getEkstre(req.user.tenantId, taxpayerId, baslangic, bitis);
  }

  @Get('ekstre/:taxpayerId/xlsx')
  async ekstreXlsx(
    @Req() req: any,
    @Res() res: any,
    @Param('taxpayerId') taxpayerId: string,
    @Query('baslangic') baslangic: string,
    @Query('bitis') bitis: string,
  ) {
    if (!baslangic || !bitis) throw new BadRequestException('baslangic ve bitis gerekli');
    const e = await this.service.getEkstre(req.user.tenantId, taxpayerId, baslangic, bitis);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = new Date();
    const sh = wb.addWorksheet('Cari Ekstre', { properties: { tabColor: { argb: 'FF9C4656' } } });

    // Başlık
    sh.addRow(['CARİ HESAP EKSTRESİ']).font = { bold: true, size: 14, color: { argb: 'FF9C4656' } };
    sh.addRow(['Mükellef:', e.taxpayer.ad]);
    sh.addRow(['VKN/TCKN:', e.taxpayer.taxNumber]);
    sh.addRow(['Vergi Dairesi:', e.taxpayer.taxOffice]);
    sh.addRow(['Dönem:', `${e.donem.baslangic} — ${e.donem.bitis}`]);
    sh.addRow([]);
    sh.addRow(['Açılış Bakiyesi', e.acilisBakiye]);
    sh.addRow(['Toplam Tahakkuk', e.toplamTahakkuk]);
    sh.addRow(['Toplam Tahsilat', e.toplamTahsilat]);
    const kapanis = sh.addRow(['Kapanış Bakiyesi', e.kapanisBakiye]);
    kapanis.font = { bold: true, color: { argb: 'FF9C4656' } };
    sh.addRow([]);
    // Hareket tablosu
    const header = sh.addRow(['Tarih', 'Tip', 'Hizmet', 'Açıklama', 'Borç', 'Alacak', 'Bakiye', 'Belge No', 'Ödeme']);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E4D4' } };
    for (const s of e.satirlar) {
      const borc = s.tip === 'TAHAKKUK' ? s.tutar : s.tip === 'IADE' ? -s.tutar : 0;
      const alacak = s.tip === 'TAHSILAT' ? s.tutar : s.tip === 'DUZELTME' ? -s.tutar : 0;
      sh.addRow([
        new Date(s.tarih).toLocaleDateString('tr-TR'),
        s.tip,
        s.hizmet?.hizmetAdi || '',
        s.aciklama || '',
        borc || '',
        alacak || '',
        s.runningBakiye,
        s.belgeNo || '',
        s.odemeYontemi || '',
      ]);
    }
    sh.getColumn(1).width = 12;
    sh.getColumn(2).width = 12;
    sh.getColumn(3).width = 20;
    sh.getColumn(4).width = 35;
    sh.getColumn(5).width = 14;
    sh.getColumn(6).width = 14;
    sh.getColumn(7).width = 14;
    sh.getColumn(8).width = 14;
    sh.getColumn(9).width = 12;
    [5, 6, 7].forEach((c: number) => (sh.getColumn(c).numFmt = '#,##0.00'));

    const buf = await wb.xlsx.writeBuffer();
    const filename = `Ekstre_${e.taxpayer.ad.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}_${baslangic}_${bitis}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  }

  // ==================== PDF EKSTRE (print-ready HTML) ====================
  @Get('ekstre/:taxpayerId/pdf')
  async ekstrePdf(
    @Req() req: any,
    @Res() res: any,
    @Param('taxpayerId') taxpayerId: string,
    @Query('baslangic') baslangic: string,
    @Query('bitis') bitis: string,
  ) {
    if (!baslangic || !bitis) throw new BadRequestException('baslangic ve bitis gerekli');
    const e = await this.service.getEkstre(req.user.tenantId, taxpayerId, baslangic, bitis);

    const fmt = (n: number) =>
      n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const trDate = (d: any) => new Date(d).toLocaleDateString('tr-TR');

    const satirlarHtml = e.satirlar.map((s: any) => {
      const borc = s.tip === 'TAHAKKUK' ? s.tutar : s.tip === 'IADE' ? -s.tutar : 0;
      const alacak = s.tip === 'TAHSILAT' ? s.tutar : s.tip === 'DUZELTME' ? -s.tutar : 0;
      return `<tr>
        <td>${trDate(s.tarih)}</td>
        <td>${s.hizmet?.hizmetAdi || ''}</td>
        <td>${s.tip}</td>
        <td>${(s.aciklama || '').replace(/[<>&]/g, '')}</td>
        <td class="num">${borc ? fmt(borc) : '—'}</td>
        <td class="num">${alacak ? fmt(alacak) : '—'}</td>
        <td class="num bold">${fmt(s.runningBakiye || 0)}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html><html lang="tr"><head>
<meta charset="utf-8">
<title>Ekstre · ${e.taxpayer.ad} · ${baslangic} - ${bitis}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:20mm;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #9c4656;padding-bottom:10mm;margin-bottom:8mm}
  .brand h1{margin:0;color:#9c4656;font-size:22pt;font-family:Fraunces,serif;letter-spacing:-.02em}
  .brand p{margin:2mm 0 0;color:#888;font-size:9.5pt}
  .info{text-align:right;font-size:9.5pt}
  .info .label{color:#888}
  .info b{color:#111}
  h2{font-size:14pt;color:#111;margin:5mm 0 3mm}
  .muk{background:#fbf7f2;border-left:4px solid #c9a77c;padding:4mm 5mm;margin-bottom:5mm;border-radius:3px}
  .muk .ad{font-size:14pt;font-weight:700;color:#111}
  .muk .sub{font-size:9.5pt;color:#666;margin-top:1mm}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:6mm}
  .summary .card{background:#fff;border:1px solid #ddd;padding:3mm 4mm;border-radius:3px}
  .summary .card .k{font-size:8pt;color:#888;text-transform:uppercase;letter-spacing:.08em}
  .summary .card .v{font-size:13pt;font-weight:700;margin-top:1mm;font-variant-numeric:tabular-nums}
  .summary .card.hi{background:#fbf7f2;border-color:#9c4656}
  .summary .card.hi .v{color:#9c4656}
  table{width:100%;border-collapse:collapse;font-size:10pt}
  th,td{padding:3mm 4mm;text-align:left;border-bottom:1px solid #e8e8e8}
  th{background:#9c4656;color:#fff;font-weight:600;font-size:9pt;letter-spacing:.04em}
  .num{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
  .bold{font-weight:700}
  tr.acilis{background:#eef5ff;font-weight:600}
  tr.kapanis{background:#fbe8ec;font-weight:700;border-top:2px solid #9c4656}
  tr.kapanis td{color:#9c4656;padding:4mm 4mm}
  .footer{margin-top:8mm;padding-top:4mm;border-top:1px solid #eee;font-size:8.5pt;color:#888;text-align:center}
  @page{size:A4;margin:0}
  @media print{body{padding:10mm}.no-print{display:none}}
</style></head>
<body>
  <div class="hdr">
    <div class="brand">
      <h1>MOREN Mali Müşavirlik</h1>
      <p>Serbest Muhasebeci Mali Müşavir</p>
    </div>
    <div class="info">
      <div><span class="label">Ekstre Tarihi:</span> <b>${trDate(new Date())}</b></div>
      <div><span class="label">Dönem:</span> <b>${trDate(e.donem.baslangic)} – ${trDate(e.donem.bitis)}</b></div>
    </div>
  </div>
  <div class="muk">
    <div class="ad">${(e.taxpayer.ad || '').replace(/[<>&]/g, '')}</div>
    <div class="sub">VKN/TCKN: <b>${e.taxpayer.taxNumber || ''}</b> · ${(e.taxpayer.taxOffice || '').replace(/[<>&]/g, '')}</div>
  </div>
  <div class="summary">
    <div class="card"><div class="k">Açılış Bakiye</div><div class="v">${fmt(e.acilisBakiye)} ₺</div></div>
    <div class="card"><div class="k">Dönem Borç</div><div class="v">${fmt(e.toplamTahakkuk)} ₺</div></div>
    <div class="card"><div class="k">Dönem Alacak</div><div class="v">${fmt(e.toplamTahsilat)} ₺</div></div>
    <div class="card hi"><div class="k">Kapanış Bakiye</div><div class="v">${fmt(e.kapanisBakiye)} ₺</div></div>
  </div>
  <h2>Hareket Detayı</h2>
  <table>
    <thead>
      <tr><th>Tarih</th><th>Hizmet</th><th>Tip</th><th>Açıklama</th><th class="num">Borç</th><th class="num">Alacak</th><th class="num">Bakiye</th></tr>
    </thead>
    <tbody>
      <tr class="acilis"><td colspan="6">Açılış Bakiyesi</td><td class="num">${fmt(e.acilisBakiye)} ₺</td></tr>
      ${satirlarHtml || `<tr><td colspan="7" style="text-align:center;padding:8mm;color:#888">Bu dönemde hareket yok</td></tr>`}
      <tr class="kapanis"><td colspan="6">Kapanış Bakiyesi</td><td class="num">${fmt(e.kapanisBakiye)} ₺</td></tr>
    </tbody>
  </table>
  <div class="footer">Moren Mali Müşavirlik · ${new Date().toLocaleString('tr-TR')}</div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }

  // ==================== MANUEL CRON TETİKLEME (debug) ====================
  @Post('cron/otomatik-tahakkuk')
  @HttpCode(HttpStatus.OK)
  async manuelCronTetikle(@Body() body: { donem?: string }) {
    const donem = body?.donem ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    return this.service.otoTahakkukUret(donem);
  }
}
