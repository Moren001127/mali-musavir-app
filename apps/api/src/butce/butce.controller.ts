import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { OwnerOnlyGuard } from '../auth/guards/owner-only.guard';
import { ButcePinGuard, PinSerbest } from './butce-pin.guard';
import { ButcePinService } from './butce-pin.service';
import { ButceService, Kimlik, DefterSecim } from './butce.service';
import { ButceAiService } from './butce-ai.service';
import { ButceEkstreImportService } from './butce-ekstre-import.service';
import { Strateji } from './butce-hesap';

/**
 * Kişisel Bütçe & Borç Yönetimi — YALNIZ ofis sahibi.
 * OwnerOnlyGuard yetkisiz istekte 404 döner; modülün varlığı sızmaz.
 */
@Controller('butce')
@UseGuards(AuthGuard('jwt'), OwnerOnlyGuard, ButcePinGuard)
export class ButceController {
  constructor(
    private readonly butce: ButceService,
    private readonly ai: ButceAiService,
    private readonly ekstreImport: ButceEkstreImportService,
    private readonly pin: ButcePinService,
  ) {}

  private kimlik(req: any): Kimlik {
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  /** Frontend menüde link gösterip göstermeyeceğini buradan anlar (yetkisizde 404) */
  @Get('erisim')
  @PinSerbest()
  erisim() {
    return { yetkili: true };
  }

  /* ===== PIN ===== */

  /** PIN kurulu mu / kilitli mi */
  @Get('pin/durum')
  @PinSerbest()
  pinDurum(@Req() req: any) {
    return this.pin.durum(this.kimlik(req));
  }

  /** İlk kurulum veya değiştirme */
  @Post('pin/kur')
  @PinSerbest()
  pinKur(@Req() req: any, @Body() body: any) {
    return this.pin.kur(this.kimlik(req), String(body?.pin || ''), body?.eskiPin);
  }

  /** PIN doğrula → bilet */
  @Post('pin/ac')
  @PinSerbest()
  pinAc(@Req() req: any, @Body() body: any) {
    return this.pin.ac(this.kimlik(req), String(body?.pin || ''));
  }

  /** Sunucu tarafında kilitle (deneme sayacını sıfırlar, istemci bileti siler) */
  @Post('pin/kilitle')
  @PinSerbest()
  pinKilitle(@Req() req: any) {
    return this.pin.kilitle(this.kimlik(req));
  }

  /* ===== ÖZET ===== */
  @Get('ozet')
  ozet(@Req() req: any, @Query('donem') donem?: string, @Query('defter') defter?: string) {
    return this.butce.ozet(this.kimlik(req), donem, (defter as DefterSecim) || 'TUMU');
  }

  /** Ofis kâr/zarar özeti (yalnız OFIS defteri) */
  @Get('ofis-ozet')
  ofisOzet(@Req() req: any, @Query('donem') donem?: string) {
    return this.butce.ofisOzet(this.kimlik(req), donem);
  }

  /** Gün gün nakit akışı projeksiyonu + açık günler için öneriler */
  @Get('nakit-akis')
  nakitAkis(@Req() req: any, @Query('gunSayisi') gunSayisi?: string) {
    return this.butce.nakitAkisi(this.kimlik(req), {
      gunSayisi: gunSayisi ? Number(gunSayisi) : undefined,
    });
  }

  /* ===== BANKA HESAPLARI ===== */
  @Get('hesaplar')
  hesaplar(@Req() req: any) {
    return this.butce.bankaHesaplar(this.kimlik(req));
  }

  /** Nakit kasa: banka hesabı seçilmeden girilmiş hareketlerin toplamı */
  @Get('kasa')
  kasa(@Req() req: any) {
    return this.butce.kasaOzet(this.kimlik(req));
  }

  @Post('hesaplar')
  hesapEkle(@Req() req: any, @Body() body: any) {
    return this.butce.bankaHesapKaydet(this.kimlik(req), body);
  }

  @Put('hesaplar/:id')
  hesapGuncelle(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.bankaHesapKaydet(this.kimlik(req), body, id);
  }

  @Delete('hesaplar/:id')
  hesapSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.bankaHesapSil(this.kimlik(req), id);
  }

  @Get('hesaplar/:id/hareketler')
  hesapHareketleri(@Req() req: any, @Param('id') id: string, @Query('donem') donem?: string) {
    return this.butce.bankaHareketleri(this.kimlik(req), id, donem);
  }

  /** Hesaplar / defterler arası aktarım (ofisten kendine çekmek dâhil) */
  @Post('transfer')
  transfer(@Req() req: any, @Body() body: any) {
    return this.butce.transferYap(this.kimlik(req), body);
  }

  /* ===== AYARLAR ===== */
  @Get('ayar')
  ayar(@Req() req: any) {
    return this.butce.ayarGetir(this.kimlik(req));
  }

  @Put('ayar')
  ayarKaydet(@Req() req: any, @Body() body: any) {
    return this.butce.ayarKaydet(this.kimlik(req), body);
  }

  /* ===== KATEGORİ ===== */
  @Get('kategoriler')
  kategoriler(@Req() req: any, @Query('defter') defter?: string) {
    return this.butce.kategoriler(this.kimlik(req), (defter as DefterSecim) || undefined);
  }

  @Post('kategoriler')
  kategoriEkle(@Req() req: any, @Body() body: any) {
    return this.butce.kategoriKaydet(this.kimlik(req), body);
  }

  /** Hazır kategori setini ekler (var olanlar korunur) */
  @Post('kategoriler/hazir-set')
  hazirKategoriler(@Req() req: any) {
    return this.butce.hazirKategorileriEkle(this.kimlik(req));
  }

  @Put('kategoriler/:id')
  kategoriGuncelle(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.kategoriKaydet(this.kimlik(req), body, id);
  }

  @Delete('kategoriler/:id')
  kategoriSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.kategoriSil(this.kimlik(req), id);
  }

  /* ===== GELİR / GİDER ===== */
  @Get('islemler')
  islemler(
    @Req() req: any,
    @Query('donem') donem?: string,
    @Query('tur') tur?: string,
    @Query('kategoriId') kategoriId?: string,
    @Query('kartId') kartId?: string,
    @Query('bankaHesapId') bankaHesapId?: string,
    @Query('defter') defter?: string,
    @Query('planlanan') planlanan?: string,
  ) {
    return this.butce.islemler(this.kimlik(req), {
      donem,
      tur,
      kategoriId,
      kartId,
      bankaHesapId,
      defter: (defter as DefterSecim) || undefined,
      planlanan: planlanan === undefined ? undefined : planlanan === '1' || planlanan === 'true',
    });
  }

  /** Beklenen tahsilat/ödemeyi gerçekleşmiş yap */
  @Post('islemler/:id/gerceklesti')
  islemGerceklesti(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.islemGerceklesti(this.kimlik(req), id, body);
  }

  @Post('islemler')
  islemEkle(@Req() req: any, @Body() body: any) {
    return this.butce.islemKaydet(this.kimlik(req), body);
  }

  @Put('islemler/:id')
  islemGuncelle(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.islemKaydet(this.kimlik(req), body, id);
  }

  @Delete('islemler/:id')
  islemSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.islemSil(this.kimlik(req), id);
  }

  /* ===== DÜZENLİ ÖDEMELER ===== */
  @Get('duzenliler')
  duzenliler(@Req() req: any, @Query('defter') defter?: string) {
    return this.butce.duzenliler(this.kimlik(req), (defter as DefterSecim) || undefined);
  }

  @Post('duzenliler')
  duzenliEkle(@Req() req: any, @Body() body: any) {
    return this.butce.duzenliKaydet(this.kimlik(req), body);
  }

  @Put('duzenliler/:id')
  duzenliGuncelle(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.duzenliKaydet(this.kimlik(req), body, id);
  }

  @Delete('duzenliler/:id')
  duzenliSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.duzenliSil(this.kimlik(req), id);
  }

  @Post('duzenliler/uygula')
  duzenliUygula(@Req() req: any, @Body() body: any) {
    return this.butce.duzenlileriUygula(this.kimlik(req), body?.donem);
  }

  /* ===== KREDİ KARTLARI ===== */
  @Get('kartlar')
  kartlar(@Req() req: any) {
    return this.butce.kartlar(this.kimlik(req));
  }

  @Post('kartlar')
  kartEkle(@Req() req: any, @Body() body: any) {
    return this.butce.kartKaydet(this.kimlik(req), body);
  }

  @Put('kartlar/:id')
  kartGuncelle(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.kartKaydet(this.kimlik(req), body, id);
  }

  @Delete('kartlar/:id')
  kartSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.kartSil(this.kimlik(req), id);
  }

  /* ===== EKSTRELER ===== */
  @Get('ekstreler')
  ekstreler(@Req() req: any, @Query('kartId') kartId?: string) {
    return this.butce.ekstreler(this.kimlik(req), kartId);
  }

  @Post('ekstreler/uret')
  async ekstreUret(@Req() req: any, @Body() body: any) {
    const k = this.kimlik(req);
    const kartlar = await this.butce.kartlar(k);
    const kart = (kartlar as any[]).find((x) => x.id === body?.kartId);
    if (!kart) throw new BadRequestException('kartId geçersiz');
    return this.butce.ekstreDonemUret(k, kart, body?.donem || new Date().toISOString().slice(0, 7));
  }

  @Put('ekstreler/:id/tutar')
  ekstreTutar(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.ekstreTutarGir(this.kimlik(req), id, body);
  }

  @Post('ekstreler/:id/odeme')
  ekstreOdeme(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.ekstreOdemeYap(this.kimlik(req), id, body);
  }

  /* ===== EKSTRE PDF İÇE AKTARMA ===== */
  @Post('ekstreler/pdf')
  @UseInterceptors(FileInterceptor('dosya', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async ekstrePdf(@Req() req: any, @UploadedFile() dosya: any, @Body() body: any) {
    if (!dosya?.buffer) throw new BadRequestException('PDF dosyası gerekli (alan adı: dosya)');
    if (!body?.kartId) throw new BadRequestException('kartId gerekli');
    return this.ekstreImport.pdfIceAktar(this.kimlik(req), {
      kartId: body.kartId,
      donem: body.donem || undefined,
      buffer: dosya.buffer,
      dosyaAdi: dosya.originalname,
      sifre: body.sifre || undefined,
    });
  }

  @Get('ekstreler/:id/hareketler')
  hareketler(@Req() req: any, @Param('id') id: string) {
    return this.ekstreImport.hareketler(this.kimlik(req), id);
  }

  @Put('hareketler/:id/kategori')
  hareketKategori(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    if (!body?.kategoriId) throw new BadRequestException('kategoriId gerekli');
    return this.ekstreImport.hareketKategoriDegistir(
      this.kimlik(req),
      id,
      body.kategoriId,
      body.hepsineUygula !== false,
      body.defter,
    );
  }

  /** Ekstre satırını şahsi/ofis olarak işaretle */
  @Put('hareketler/:id/defter')
  hareketDefter(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    if (!body?.defter) throw new BadRequestException('defter gerekli');
    return this.ekstreImport.hareketDefterDegistir(
      this.kimlik(req),
      id,
      body.defter,
      body.hepsineUygula !== false,
    );
  }

  @Post('ekstreler/:id/hareketler/onayla')
  hareketOnayla(@Req() req: any, @Param('id') id: string) {
    return this.ekstreImport.hareketleriOnayla(this.kimlik(req), id);
  }

  @Post('ekstreler/:id/hareketler/geri-al')
  hareketGeriAl(@Req() req: any, @Param('id') id: string) {
    return this.ekstreImport.onayGeriAl(this.kimlik(req), id);
  }

  /* ===== BORÇLAR ===== */
  @Get('borclar')
  borclar(@Req() req: any, @Query('hepsi') hepsi?: string, @Query('defter') defter?: string) {
    return this.butce.borclar(
      this.kimlik(req),
      hepsi === '1' || hepsi === 'true',
      (defter as DefterSecim) || undefined,
    );
  }

  @Post('borclar')
  borcEkle(@Req() req: any, @Body() body: any) {
    return this.butce.borcKaydet(this.kimlik(req), body);
  }

  @Put('borclar/:id')
  borcGuncelle(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.borcKaydet(this.kimlik(req), body, id);
  }

  @Delete('borclar/:id')
  borcSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.borcSil(this.kimlik(req), id);
  }

  @Post('borclar/:id/odeme')
  borcOdeme(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.butce.borcOdemeYap(this.kimlik(req), id, body);
  }

  @Get('odemeler')
  odemeler(@Req() req: any, @Query('donem') donem?: string) {
    return this.butce.odemeler(this.kimlik(req), donem);
  }

  /** Yanlış girilen ödemeyi geri al */
  @Delete('odemeler/:id')
  odemeSil(@Req() req: any, @Param('id') id: string) {
    return this.butce.odemeSil(this.kimlik(req), id);
  }

  /* ===== ÖDEME PLANI ===== */
  @Get('plan')
  plan(
    @Req() req: any,
    @Query('donem') donem?: string,
    @Query('kapasite') kapasite?: string,
    @Query('strateji') strateji?: string,
    @Query('defter') defter?: string,
  ) {
    return this.butce.plan(this.kimlik(req), {
      donem,
      kapasite: kapasite === undefined || kapasite === '' ? undefined : Number(kapasite),
      strateji: (strateji as Strateji) || undefined,
      defter: (defter as DefterSecim) || undefined,
    });
  }

  @Get('fayda')
  fayda(@Req() req: any, @Query('tutar') tutar: string) {
    const t = Number(tutar);
    if (!Number.isFinite(t) || t <= 0) throw new BadRequestException('tutar geçersiz');
    return this.butce.faydaAnalizi(this.kimlik(req), t);
  }

  /* ===== YAPAY ZEKÂ ===== */
  @Post('ai/aylik-yorum')
  aiAylik(@Req() req: any, @Body() body: any) {
    return this.ai.aylikYorum(
      this.kimlik(req),
      body?.donem || new Date().toISOString().slice(0, 7),
      !!body?.yenile,
    );
  }

  @Post('ai/plan-yorum')
  aiPlan(@Req() req: any, @Body() body: any) {
    return this.ai.planYorum(this.kimlik(req), !!body?.yenile);
  }

  @Post('ai/soru')
  aiSoru(@Req() req: any, @Body() body: any) {
    const soru = String(body?.soru || '').trim();
    if (!soru) throw new BadRequestException('soru gerekli');
    return this.ai.soru(this.kimlik(req), soru);
  }

  @Get('ai/gecmis')
  aiGecmis(@Req() req: any, @Query('tur') tur?: string) {
    return this.ai.gecmis(this.kimlik(req), tur);
  }
}
