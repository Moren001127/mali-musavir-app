import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AylikOdemeService, GonderimKanali, GonderimModu } from './aylik-odeme.service';
import { ayAdi } from './aylik-odeme-donem';

function buAy(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** İndirme başlığı: ASCII ad + RFC 5987 Türkçe ad. */
function indirmeBasligi(res: Response, asciiAd: string, trAd: string, contentType: string) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiAd}"; filename*=UTF-8''${encodeURIComponent(trAd)}`);
  res.setHeader('Cache-Control', 'no-store');
}

@Controller('aylik-odeme')
@UseGuards(AuthGuard('jwt'))
export class AylikOdemeController {
  constructor(private readonly svc: AylikOdemeService) {}

  @Get()
  list(@Req() req: any, @Query('month') month?: string, @Query('taxpayerId') taxpayerId?: string) {
    return this.svc.list(req.user.tenantId, month || buAy(), taxpayerId || undefined);
  }

  /** Üst şerit: mükellef/kalem sayısı, grup toplamları, gönderim sayaçları, en yakın son gün, ayarlar. */
  @Get('ozet')
  ozet(@Req() req: any, @Query('month') month?: string) {
    return this.svc.ozet(req.user.tenantId, month || buAy());
  }

  /** Listeye girmeyen mükellefler ve sebepleri — yalnız okur, gönderim yok. */
  @Get('eksikler')
  eksikler(@Req() req: any, @Query('month') month?: string) {
    return this.svc.eksikler(req.user.tenantId, month || buAy());
  }

  /** Eksikler hızlı düzeltme: mükellefin SGK bildirgesi beklenmesin. */
  @Post('eksik/sgk-yok')
  @HttpCode(HttpStatus.OK)
  sgkYok(@Req() req: any, @Body() body: { taxpayerId?: string }) {
    return this.svc.sgkYok(req.user.tenantId, String(body?.taxpayerId || ''));
  }

  @Get('excel')
  async excel(@Req() req: any, @Res() res: Response, @Query('month') month?: string) {
    const ay = month || buAy();
    const buf = await this.svc.excel(req.user.tenantId, ay);
    indirmeBasligi(res, `Odeme-Listesi-${ay}.xlsx`, `Ödeme Listesi ${ayAdi(ay)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  }

  /** A4 cetvel — taxpayerId verilirse tek mükellef, yoksa tüm mükellefler (her biri ayrı sayfa). */
  @Get('pdf')
  async pdf(@Req() req: any, @Res() res: Response, @Query('month') month?: string, @Query('taxpayerId') taxpayerId?: string) {
    const ay = month || buAy();
    const buf = await this.svc.pdf(req.user.tenantId, ay, taxpayerId || undefined);
    indirmeBasligi(res, `Odeme-Cetveli-${ay}${taxpayerId ? '-mukellef' : ''}.pdf`, `Ödeme Cetveli ${ayAdi(ay)}.pdf`, 'application/pdf');
    res.send(buf);
  }

  /**
   * Kalem bazlı gönderim. mod: gonderilmemis (yalnız o kanaldan gerçek gitmemiş kalemler) | hepsi | yeniden (taxpayerId şart).
   * kanal: WHATSAPP | EMAIL — verilirse yalnız o kanal. Cevap: { ok, month, testMode, mod, kanal, count, atlanan,
   * results:[{ taxpayerId, unvan, grup, channel, status, error, kalem, yeni }] }.
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  send(@Req() req: any, @Body() body: { month?: string; taxpayerId?: string; mod?: GonderimModu; kanal?: GonderimKanali }) {
    return this.svc.send(req.user.tenantId, body?.month || buAy(), body?.taxpayerId || undefined, body?.mod || 'gonderilmemis', body?.kanal || undefined);
  }

  /** Gerçek cetvel mesajlarını YALNIZ sahibin numaralarına örnek olarak gönderir (kayıt yazmaz). */
  @Post('ornek-gonder')
  @HttpCode(HttpStatus.OK)
  ornekGonder(@Req() req: any, @Body() body: { month?: string; taxpayerId?: string }) {
    return this.svc.ornekGonder(req.user.tenantId, body?.month || buAy(), body?.taxpayerId || undefined);
  }

  @Get('otomatik')
  otomatik(@Req() req: any) {
    return this.svc.otomatikAyar(req.user.tenantId);
  }

  @Put('otomatik')
  otomatikKaydet(@Req() req: any, @Body() body: { aktif?: boolean; gun?: number; saat?: number; onayGerekli?: boolean }) {
    return this.svc.otomatikKaydet(req.user.tenantId, body || {});
  }
}
