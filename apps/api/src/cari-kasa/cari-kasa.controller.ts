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
  genelOzet(@Req() req: any) {
    return this.service.genelOzet(req.user.tenantId);
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

  // ==================== MANUEL CRON TETİKLEME (debug) ====================
  @Post('cron/otomatik-tahakkuk')
  @HttpCode(HttpStatus.OK)
  async manuelCronTetikle(@Body() body: { donem?: string }) {
    const donem = body?.donem ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    return this.service.otoTahakkukUret(donem);
  }
}
