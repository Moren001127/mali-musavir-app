import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { KdvBeyannameService } from './kdv-beyanname.service';
import { KdvTip } from './types';
import * as ExcelJS from 'exceljs';

@Controller('kdv-beyanname')
export class KdvBeyannameController {
  constructor(private readonly service: KdvBeyannameService) {}

  /** Belirli bir mükellef + dönem için KDV1 ön hazırlık raporu */
  @Get('on-hazirlik/kdv1')
  @UseGuards(AuthGuard('jwt'))
  async onHazirlikKdv1(
    @Req() req: any,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
  ) {
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem gerekli');
    }
    return this.service.kdv1OnHazirlik({
      tenantId: req.user.tenantId,
      mukellefId,
      donem,
    });
  }

  /** KDV2 (tevkifat sorumlusu) ön hazırlık */
  @Get('on-hazirlik/kdv2')
  @UseGuards(AuthGuard('jwt'))
  async onHazirlikKdv2(
    @Req() req: any,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
  ) {
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem gerekli');
    }
    return this.service.kdv2OnHazirlik({
      tenantId: req.user.tenantId,
      mukellefId,
      donem,
    });
  }

  /** Tüm mükellefler için dönem özeti (dashboard) */
  @Get('ozet')
  @UseGuards(AuthGuard('jwt'))
  async ozet(
    @Req() req: any,
    @Query('donem') donem: string,
    @Query('tip') tip: KdvTip = 'KDV1',
  ) {
    if (!donem) throw new BadRequestException('donem gerekli');
    if (tip !== 'KDV1' && tip !== 'KDV2') {
      throw new BadRequestException('tip KDV1 veya KDV2 olmalı');
    }
    return this.service.donemOzet(req.user.tenantId, donem, tip);
  }

  /** Excel export — KDV1 + KDV2 sheet'leri tek dosyada */
  @Get('xlsx')
  @UseGuards(AuthGuard('jwt'))
  async xlsx(
    @Req() req: any,
    @Res() res: any,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
  ) {
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem gerekli');
    }
    const tenantId = req.user.tenantId;
    const kdv1 = await this.service.kdv1OnHazirlik({ tenantId, mukellefId, donem });
    const kdv2 = await this.service.kdv2OnHazirlik({ tenantId, mukellefId, donem });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = new Date();

    // ===== ÖZET SHEET =====
    const ozet = wb.addWorksheet('Özet', { properties: { tabColor: { argb: 'FF9C4656' } } });
    this.addBaslikSatiri(ozet, `KDV BEYANNAME ÖN HAZIRLIK · ${kdv1.mukellefAd}`);
    ozet.addRow([]);
    ozet.addRow(['Mükellef:', kdv1.mukellefAd]);
    ozet.addRow(['Dönem:', kdv1.donem]);
    ozet.addRow(['Hazırlanma:', new Date().toLocaleString('tr-TR')]);
    ozet.addRow([]);
    ozet.addRow(['', 'TUTAR (₺)']).font = { bold: true };
    ozet.addRow(['Hesaplanan KDV (Satış)', kdv1.sonuc.hesaplananKdv]);
    ozet.addRow(['İndirilecek KDV (Alış)', kdv1.sonuc.indirilecekKdv]);
    ozet.addRow(['Geçen Dönemden Devreden', kdv1.sonuc.devredenKdv]);
    const sonucRow = ozet.addRow(
      kdv1.sonuc.odenecekKdv > 0
        ? ['ÖDENECEK KDV', kdv1.sonuc.odenecekKdv]
        : ['Sonraki Aya Devreden', kdv1.sonuc.sonrakiAyaDevreden],
    );
    sonucRow.font = { bold: true, color: { argb: 'FF9C4656' }, size: 14 };
    ozet.getColumn(1).width = 40;
    ozet.getColumn(2).width = 18;
    ozet.getColumn(2).numFmt = '#,##0.00 ₺';

    if (kdv1.lucaKontrol.uyarilar.length > 0 || kdv1.kaliteRapor.uyarilar.length > 0) {
      ozet.addRow([]);
      const u = ozet.addRow(['UYARILAR']);
      u.font = { bold: true, color: { argb: 'FFC43333' } };
      [...kdv1.lucaKontrol.uyarilar, ...kdv1.kaliteRapor.uyarilar].forEach((msg: string) => {
        ozet.addRow([msg]);
      });
    }

    // ===== KDV1 SHEET =====
    const k1 = wb.addWorksheet('KDV1 Detay', { properties: { tabColor: { argb: 'FF93C5FD' } } });
    this.addBaslikSatiri(k1, 'KDV1 — Genel Beyanname');

    k1.addRow([]);
    const sH = k1.addRow(['SATIŞ — Hesaplanan KDV (Oran Bazlı)']);
    sH.font = { bold: true, color: { argb: 'FF4ADE80' }, size: 12 };
    k1.addRow(['Oran (%)', 'Matrah', 'KDV', 'Fatura Adet']).font = { bold: true };
    for (const o of kdv1.satis.oranlar) {
      k1.addRow([o.oran, o.matrah, o.kdv, o.adet]);
    }
    k1.addRow([
      'TOPLAM',
      kdv1.satis.toplamMatrah,
      kdv1.satis.toplamHesaplananKdv,
      kdv1.satis.faturaAdet,
    ]).font = { bold: true };

    k1.addRow([]);
    const aH = k1.addRow(['ALIŞ — İndirilecek KDV (Oran Bazlı)']);
    aH.font = { bold: true, color: { argb: 'FF60A5FA' }, size: 12 };
    k1.addRow(['Oran (%)', 'Matrah', 'KDV', 'Fatura Adet']).font = { bold: true };
    for (const o of kdv1.alis.oranlar) {
      k1.addRow([o.oran, o.matrah, o.kdv, o.adet]);
    }
    k1.addRow([
      'TOPLAM',
      kdv1.alis.toplamMatrah,
      kdv1.alis.toplamIndirilecekKdv,
      kdv1.alis.faturaAdet,
    ]).font = { bold: true };

    k1.addRow([]);
    k1.addRow(['Tevkifatsız Alış', kdv1.alis.tevkifatsiz.matrah, kdv1.alis.tevkifatsiz.kdv, kdv1.alis.tevkifatsiz.adet]);
    k1.addRow(['Tevkifatlı Alış (KDV2\'ye)', kdv1.alis.tevkifatli.matrah, kdv1.alis.tevkifatli.kdv, kdv1.alis.tevkifatli.adet]);

    k1.addRow([]);
    if (kdv1.lucaKontrol.mizanVar) {
      const lh = k1.addRow(['LUCA ÇAPRAZ KONTROL']);
      lh.font = { bold: true, color: { argb: 'FFD4B876' } };
      k1.addRow(['Hesap', 'Mihsap', 'Luca', 'Fark']);
      k1.addRow([
        '391 (Hesaplanan)',
        kdv1.satis.toplamHesaplananKdv,
        kdv1.lucaKontrol.luca391Bakiye,
        kdv1.lucaKontrol.fark391,
      ]);
      k1.addRow([
        '191 (İndirilecek)',
        kdv1.alis.toplamIndirilecekKdv,
        kdv1.lucaKontrol.luca191Bakiye,
        kdv1.lucaKontrol.fark191,
      ]);
      k1.addRow(['190 (Devreden)', '—', kdv1.lucaKontrol.luca190Bakiye, '—']);
    }

    k1.getColumn(1).width = 30;
    k1.getColumn(2).width = 16;
    k1.getColumn(3).width = 16;
    k1.getColumn(4).width = 14;
    [2, 3].forEach((col: number) => (k1.getColumn(col).numFmt = '#,##0.00'));

    // ===== KDV2 SHEET =====
    const k2 = wb.addWorksheet('KDV2 Tevkifat', { properties: { tabColor: { argb: 'FFC9A77C' } } });
    this.addBaslikSatiri(k2, 'KDV2 — Tevkifat Sorumlusu');

    k2.addRow([]);
    k2.addRow(['Belge No', 'Satıcı', 'VKN', 'Tarih', 'Matrah', 'Hesaplanan KDV', 'Tevkifat Oranı', 'Tevkifat Tutarı']).font = { bold: true };
    for (const t of kdv2.tevkifatli) {
      k2.addRow([t.belgeNo, t.satici, t.saticiVkn, t.tarih, t.matrah, t.hesaplananKdv, t.tevkifatOrani, t.tevkifatTutari]);
    }
    k2.addRow([
      'TOPLAM',
      `${kdv2.toplamlar.faturaAdet} fatura`,
      '',
      '',
      kdv2.toplamlar.toplamMatrah,
      kdv2.toplamlar.toplamHesaplananKdv,
      '',
      kdv2.toplamlar.toplamTevkifat,
    ]).font = { bold: true };

    k2.addRow([]);
    if (kdv2.tevkifatKodlari.length > 0) {
      k2.addRow(['TEVKİFAT ORAN ÖZETİ']).font = { bold: true, color: { argb: 'FFD4B876' } };
      k2.addRow(['Oran', 'Matrah', 'Tevkifat', 'Adet']).font = { bold: true };
      for (const tk of kdv2.tevkifatKodlari) {
        k2.addRow([tk.kod, tk.matrah, tk.tevkifat, tk.adet]);
      }
    }

    k2.getColumn(1).width = 22;
    k2.getColumn(2).width = 30;
    k2.getColumn(3).width = 14;
    k2.getColumn(4).width = 12;
    [5, 6, 8].forEach((col: number) => (k2.getColumn(col).numFmt = '#,##0.00'));

    // ===== STREAM =====
    const buf = await wb.xlsx.writeBuffer();
    const filename = `KDV-OnHazirlik_${this.normalize(kdv1.mukellefAd)}_${donem}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.byteLength),
    });
    return res.send(Buffer.from(buf));
  }

  // ===== Yardımcılar =====

  private addBaslikSatiri(ws: ExcelJS.Worksheet, baslik: string) {
    const row = ws.addRow([baslik]);
    row.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    row.height = 26;
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF9C4656' },
    };
    ws.mergeCells(`A${row.number}:H${row.number}`);
    row.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }

  private normalize(s: string): string {
    return s
      .replace(/[İı]/g, 'i')
      .replace(/[ŞşÇçĞğÜüÖö]/g, (c) => 'sScCgGuUoO'['ŞşÇçĞğÜüÖö'.indexOf(c)] || c)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60);
  }
}
