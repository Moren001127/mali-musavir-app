import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res,
  UseGuards, HttpCode, HttpStatus, BadRequestException, Headers, UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CariKasaService } from './cari-kasa.service';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, timingSafeEqual } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let _logoDataUriCache: string | null | undefined;
function getMorenLogoDataUri(): string | null {
  if (_logoDataUriCache !== undefined) return _logoDataUriCache;
  const candidates = [
    join(process.cwd(), 'apps/web/public/brand/moren-logo-gold.png'),
    join(process.cwd(), '../web/public/brand/moren-logo-gold.png'),
    join(__dirname, '../../../../web/public/brand/moren-logo-gold.png'),
    join(process.cwd(), 'public/brand/moren-logo-gold.png'),
    process.env.MOREN_LOGO_PATH || '',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const data = readFileSync(p).toString('base64');
        _logoDataUriCache = `data:image/png;base64,${data}`;
        return _logoDataUriCache;
      }
    } catch {
      /* siradaki adaya gec */
    }
  }
  _logoDataUriCache = null;
  return null;
}

function safeEqual(a: string, b: string) {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

function parseAgentTokenMap(raw: string) {
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx <= 0) return null;
      return { tenantId: pair.slice(0, idx).trim(), token: pair.slice(idx + 1).trim() };
    })
    .filter((pair): pair is { tenantId: string; token: string } => Boolean(pair?.tenantId && pair?.token));
}

function envFlag(value?: string | null) {
  return ['1', 'true', 'yes', 'on', 'evet'].includes(String(value || '').trim().toLowerCase());
}

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

  @Post('import/hattat')
  @HttpCode(HttpStatus.OK)
  importHattatCariKasa(@Req() req: any, @Body() body: any) {
    return this.service.importHattatCariKasa(
      req.user.tenantId,
      body || {},
      req.user.userId || req.user.sub || 'portal-user',
    );
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

  @Get('cashflow-summary')
  cashflowSummary(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('period') period?: string,
  ) {
    return this.service.cashflowSummary(req.user.tenantId, { year, period });
  }

  @Get('accounts')
  accounts(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.service.listFinancialAccounts(req.user.tenantId, includeInactive === 'true');
  }

  @Post('accounts')
  createAccount(@Req() req: any, @Body() body: any) {
    return this.service.createFinancialAccount(req.user.tenantId, body || {});
  }

  @Put('accounts/:id')
  updateAccount(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateFinancialAccount(req.user.tenantId, id, body || {});
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteFinancialAccount(req.user.tenantId, id);
  }

  @Post('account-transfers')
  createAccountTransfer(@Req() req: any, @Body() body: any) {
    return this.service.createAccountTransfer(req.user.tenantId, body || {}, req.user.sub);
  }

  @Delete('account-transfers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccountTransfer(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteAccountTransfer(req.user.tenantId, id);
  }

  @Get('yaslandirma')
  yaslandirma(@Req() req: any) {
    return this.service.yaslandirma(req.user.tenantId);
  }

  @Get('tahsilat-ajandasi')
  tahsilatAjandasi(@Req() req: any) {
    return this.service.tahsilatAjandasi(req.user.tenantId);
  }

  /**
   * TAHSİLAT OTOMASYON PLANI — KURU TEST.
   * Bugün kime hangi mesajın gideceğini gösterir; HİÇBİR MESAJ GÖNDERMEZ.
   */
  @Get('tahsilat-otomasyon/plan')
  tahsilatOtomasyonPlani(@Req() req: any) {
    return this.service.tahsilatOtomasyonPlani(req.user.tenantId);
  }

  @Post('tahsilat-hatirlatma/preview')
  tahsilatHatirlatmaPreview(@Req() req: any, @Body() body: any) {
    return this.service.tahsilatHatirlatmaPreview(req.user.tenantId, body || {});
  }

  @Post('tahsilat-hatirlatma/send')
  tahsilatHatirlatmaSend(@Req() req: any, @Body() body: any) {
    return this.service.tahsilatHatirlatmaSend(req.user.tenantId, body || {});
  }

  /** Satır butonu: Hesap Dökümü PDF'li WhatsApp gönderimi (tıklamayla, otomatik yok). */
  @Post('ekstre-whatsapp/:taxpayerId')
  whatsappEkstre(@Req() req: any, @Param('taxpayerId') taxpayerId: string) {
    return this.service.whatsappEkstreSend(req.user.tenantId, taxpayerId);
  }

  // ==================== BÜTÇE TAKİP ====================
  @Get('budget/categories')
  budgetCategories(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.service.listBudgetCategories(req.user.tenantId, includeInactive === 'true');
  }

  @Post('budget/categories')
  createBudgetCategory(@Req() req: any, @Body() body: any) {
    return this.service.createBudgetCategory(req.user.tenantId, body || {});
  }

  @Put('budget/categories/:id')
  updateBudgetCategory(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateBudgetCategory(req.user.tenantId, id, body || {});
  }

  @Delete('budget/categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBudgetCategory(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteBudgetCategory(req.user.tenantId, id);
  }

  @Get('budget/entries')
  budgetEntries(
    @Req() req: any,
    @Query('period') period?: string,
    @Query('type') type?: string,
  ) {
    return this.service.listBudgetEntries(req.user.tenantId, { period, type });
  }

  @Post('budget/entries')
  createBudgetEntry(@Req() req: any, @Body() body: any) {
    return this.service.createBudgetEntry(req.user.tenantId, body || {}, req.user.sub);
  }

  @Put('budget/entries/:id')
  updateBudgetEntry(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateBudgetEntry(req.user.tenantId, id, body || {});
  }

  @Delete('budget/entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBudgetEntry(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteBudgetEntry(req.user.tenantId, id);
  }

  @Get('budget/plans')
  budgetPlans(@Req() req: any, @Query('period') period?: string) {
    return this.service.listBudgetPlans(req.user.tenantId, period);
  }

  @Put('budget/plans')
  upsertBudgetPlans(@Req() req: any, @Body() body: any) {
    return this.service.upsertBudgetPlans(req.user.tenantId, body || {});
  }

  @Get('budget/summary')
  budgetSummary(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('period') period?: string,
  ) {
    return this.service.budgetSummary(req.user.tenantId, { year, period });
  }

  @Get('ozet/xlsx')
  async ozetXlsx(
    @Req() req: any,
    @Res() res: any,
    @Query('baslangic') baslangic?: string,
    @Query('bitis') bitis?: string,
  ) {
    const rows = await this.service.genelOzet(req.user.tenantId, baslangic, bitis);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = new Date();
    const sh = wb.addWorksheet('Cari Kasa Özet', { properties: { tabColor: { argb: 'FF0A1628' } } });
    sh.addRow(['CARİ KASA ÖZET']).font = { bold: true, size: 14, color: { argb: 'FF0A1628' } };
    sh.addRow(['Dönem:', baslangic && bitis ? `${baslangic} - ${bitis}` : 'Tüm zamanlar']);
    sh.addRow(['Rapor Tarihi:', new Date().toLocaleString('tr-TR')]);
    sh.addRow([]);
    const header = sh.addRow(['Mükellef', 'VKN/TCKN', 'Telefon', 'E-posta', 'Aylık Ücret', 'Borç', 'Alacak', 'Bakiye']);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E4D4' } };
    for (const r of rows) {
      sh.addRow([r.ad, r.taxNumber || '', r.phone || '', r.email || '', r.aylikMuhasebeUcreti, r.tahakkuk, r.tahsilat, r.bakiye]);
    }
    sh.columns = [
      { width: 34 }, { width: 16 }, { width: 16 }, { width: 28 },
      { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    ];
    [5, 6, 7, 8].forEach((c: number) => (sh.getColumn(c).numFmt = '#,##0.00'));
    const total = rows.reduce((acc: any, r: any) => {
      acc.ucret += Number(r.aylikMuhasebeUcreti || 0);
      acc.tahakkuk += Number(r.tahakkuk || 0);
      acc.tahsilat += Number(r.tahsilat || 0);
      acc.bakiye += Number(r.bakiye || 0);
      return acc;
    }, { ucret: 0, tahakkuk: 0, tahsilat: 0, bakiye: 0 });
    const totalRow = sh.addRow(['TOPLAM', '', '', '', total.ucret, total.tahakkuk, total.tahsilat, total.bakiye]);
    totalRow.font = { bold: true, color: { argb: 'FF0A1628' } };
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Cari_Kasa_Ozet_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(Buffer.from(buf));
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
    const sh = wb.addWorksheet('Cari Ekstre', { properties: { tabColor: { argb: 'FF0A1628' } } });

    // Başlık
    sh.addRow(['CARİ HESAP EKSTRESİ']).font = { bold: true, size: 14, color: { argb: 'FF0A1628' } };
    sh.addRow(['Mükellef:', e.taxpayer.ad]);
    sh.addRow(['VKN/TCKN:', e.taxpayer.taxNumber]);
    sh.addRow(['Vergi Dairesi:', e.taxpayer.taxOffice]);
    sh.addRow(['Dönem:', `${e.donem.baslangic} — ${e.donem.bitis}`]);
    sh.addRow([]);
    sh.addRow(['Açılış Bakiyesi', e.acilisBakiye]);
    sh.addRow(['Toplam Tahakkuk', e.toplamTahakkuk]);
    sh.addRow(['Toplam Tahsilat', e.toplamTahsilat]);
    const kapanis = sh.addRow(['Kapanış Bakiyesi', e.kapanisBakiye]);
    kapanis.font = { bold: true, color: { argb: 'FF0A1628' } };
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
    const logoUrl =
      getMorenLogoDataUri() ||
      (process.env.PORTAL_PUBLIC_URL || 'https://portal.morenmusavirlik.com') + '/brand/moren-logo-gold.png';

    const tl = (n: number) => `${fmt(Math.abs(n))} TL`;
    const bakiyeEk = (n: number) => `${fmt(Math.abs(n))} TL${n > 0 ? ' (B)' : n < 0 ? ' (A)' : ''}`;
    const kategoriAdi = (s: any) =>
      (s.hizmet?.kategori || s.hizmet?.hizmetAdi || s.kategori || '').toString().replace(/[<>&]/g, '');

    const satirlarHtml = e.satirlar.map((s: any) => {
      const borc = s.tip === 'TAHAKKUK' ? s.tutar : s.tip === 'IADE' ? -s.tutar : 0;
      const alacak = s.tip === 'TAHSILAT' ? s.tutar : s.tip === 'DUZELTME' ? -s.tutar : 0;
      const tahsilatTuru = s.tip === 'TAHSILAT' ? 'Tahsilat' : '';
      return `<tr>
        <td>${trDate(s.tarih)}</td>
        <td>${kategoriAdi(s)}</td>
        <td>${tahsilatTuru}</td>
        <td>${(s.aciklama || '').replace(/[<>&]/g, '')}</td>
        <td class="num">${borc ? tl(borc) : '—'}</td>
        <td class="num">${alacak ? tl(alacak) : '—'}</td>
        <td class="num bold">${bakiyeEk(s.runningBakiye || 0)}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html><html lang="tr"><head>
<meta charset="utf-8">
<title>Ekstre · ${e.taxpayer.ad} · ${baslangic} - ${bitis}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:20mm;font-family:'DM Sans',system-ui,-apple-system,Segoe UI,sans-serif;color:#0A1628}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0A1628;padding-bottom:8mm;margin-bottom:2mm;position:relative}
  .hdr::after{content:'';position:absolute;left:0;bottom:-2px;width:42mm;height:2px;background:#C9982A}
  .brand p{margin:3mm 0 0;color:#5272A8;font-size:9.5pt;letter-spacing:.02em}
  .info{text-align:right;font-size:9.5pt}
  .info .label{color:#5272A8}
  .info b{color:#0A1628}
  h2{font-size:13pt;color:#0A1628;margin:6mm 0 3mm;padding-left:3mm;border-left:3px solid #C9982A}
  .muk{background:#FBF0D6;border-left:4px solid #C9982A;padding:4mm 5mm;margin:6mm 0 5mm;border-radius:4px}
  table{width:100%;border-collapse:collapse;font-size:9.5pt;table-layout:fixed}
  col.c-date{width:9%}col.c-kat{width:14%}col.c-tah{width:10%}col.c-acik{width:20%}col.c-borc{width:14%}col.c-alacak{width:15%}col.c-bak{width:18%}
  th,td{padding:2.6mm 3mm;border-bottom:1px solid #E8ECF2;vertical-align:middle;text-align:left;word-wrap:break-word}
  th{background:#0A1628;color:#fff;font-weight:600;font-size:8.5pt;letter-spacing:.02em}
  td:first-child{white-space:nowrap}
  th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .bold{font-weight:700}
  tbody tr:nth-child(even){background:#FAFBFC}
  tr.acilis{background:#EEF2F7;font-weight:600}
  tr.acilis td{color:#253660}
  tr.toplam{background:#0A1628;font-weight:700;border-top:2px solid #C9982A}
  tr.toplam td{color:#fff;padding:3.5mm 3mm}
  tr.toplam td .bb{color:#E8B84B;display:block;font-size:9.5pt;margin-top:1mm;font-variant-numeric:tabular-nums}
  .footer{margin-top:8mm;padding-top:4mm;border-top:1px solid #DDE3ED;font-size:8.5pt;color:#5272A8;text-align:center}
  .footer b{color:#0A1628}
  @page{size:A4;margin:0}
  @media print{body{padding:10mm}.no-print{display:none}}
</style></head>
<body>
  <div class="hdr">
    <div class="brand">
      <img src="${logoUrl}" alt="Moren Mali Musavirlik" style="height:22mm;width:auto;display:block" />
      <p style="margin-top:3mm">Serbest Muhasebeci Mali Müşavir</p>
    </div>
    <div class="info">
      <div><span class="label">Ekstre Tarihi:</span> <b>${trDate(new Date())}</b></div>
      <div><span class="label">Dönem:</span> <b>${trDate(e.donem.baslangic)} – ${trDate(e.donem.bitis)}</b></div>
    </div>
  </div>
  <div class="muk">
    <p style="margin:0;font-size:11pt;color:#253660;line-height:1.7">Sayın <b>${(e.taxpayer.ad || '').replace(/[<>&]/g, '')}</b>, aşağıda ${trDate(e.donem.baslangic)} – ${trDate(e.donem.bitis)} dönemine ait cari hesap ekstreniz yer almaktadır. İlgili dönem sonu itibarıyla ${e.kapanisBakiye >= 0 ? 'borç' : 'alacak'} bakiyeniz <b style="font-size:12.5pt;color:#0A1628">${bakiyeEk(e.kapanisBakiye)}</b> olarak görünmektedir.</p>
  </div>
  <h2>Hareket Detayı</h2>
  <table>
    <colgroup>
      <col class="c-date"><col class="c-kat"><col class="c-tah"><col class="c-acik"><col class="c-borc"><col class="c-alacak"><col class="c-bak">
    </colgroup>
    <thead>
      <tr><th>Tarih</th><th>Kategori</th><th>Tahsilat Türü</th><th>Açıklama</th><th class="num">Borç (Hizmet)</th><th class="num">Alacak (Tahsilat)</th><th class="num">Bakiye</th></tr>
    </thead>
    <tbody>
      <tr class="acilis"><td colspan="6">Açılış Bakiyesi</td><td class="num">${bakiyeEk(e.acilisBakiye)}</td></tr>
      ${satirlarHtml || `<tr><td colspan="7" style="text-align:center;padding:8mm;color:#888">Bu dönemde hareket yok</td></tr>`}
      <tr class="toplam">
        <td colspan="4">Toplam :</td>
        <td class="num">${tl(e.toplamTahakkuk)}</td>
        <td class="num">${tl(e.toplamTahsilat)}</td>
        <td class="num">${e.kapanisBakiye >= 0 ? 'Borç Bakiyesi:' : 'Alacak Bakiyesi:'}<span class="bb">${tl(e.kapanisBakiye)}</span></td>
      </tr>
    </tbody>
  </table>
  <div class="footer"><b>Moren Mali Müşavirlik</b> · Bu ekstre ${new Date().toLocaleString('tr-TR')} tarihinde oluşturulmuştur.</div>
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

@Controller('agent/cari-kasa')
export class CariKasaAgentController {
  constructor(
    private readonly service: CariKasaService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('hattat/import')
  @HttpCode(HttpStatus.OK)
  async importHattatCariKasa(
    @Headers('x-agent-token') agentToken: string,
    @Body() body: any,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.service.importHattatCariKasa(tenantId, body || {}, 'hattat-local-agent');
  }

  private async resolveTenantFromAgentToken(token?: string): Promise<string> {
    const presented = String(token || '').trim();
    if (!presented) throw new UnauthorizedException('Missing X-Agent-Token');

    const pairs = parseAgentTokenMap(process.env.AGENT_INGEST_TOKENS || '');
    for (const pair of pairs) {
      if (safeEqual(presented, pair.token)) return pair.tenantId;
    }
    const allowLegacyLookup =
      envFlag(process.env.AGENT_TOKEN_ALLOW_TENANT_ID) || process.env.NODE_ENV !== 'production';
    // Backward compatibility: existing desktop/local-agent installs use tenant slug as
    // the agent token. Keep accepting that while AGENT_INGEST_TOKENS is rolled out.
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: { OR: [{ slug: presented }, { id: presented }] },
      select: { id: true },
    });
    if (!tenant) {
      if (pairs.length > 0) throw new UnauthorizedException('Invalid agent token');
      if (!allowLegacyLookup) throw new UnauthorizedException('Agent token map is not configured');
      throw new UnauthorizedException('Invalid agent token');
    }
    return tenant.id;
  }
}
