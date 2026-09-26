/**
 * SGK WS_Vizite çözümleyici sınamaları. Örnek cevaplar 2026-09-26 canlı cevapların YAPISINDAN
 * alındı; kişi/TC/rapor numaraları SAHTE.
 */
import { cevapCoz, sgkTarih, soapZarfi, varlikCoz } from './sgk-vizite-istemci';
import {
  bekleyenRaporCoz, gunSayisi, isKazasiCoz, kalanAralik, onayBaslangici, onayEnGecBitisi, onayParcasiCoz, onayliRaporCoz,
} from './sgk-vizite-cozumleyici';
import { isKazasiBildirimSonGunu, resmiTatilMi } from '@mali-musavir/shared';

const ZARF = (ic: string) =>
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  `<soapenv:Header/><soapenv:Body>${ic}</soapenv:Body></soapenv:Envelope>`;

const BEKLEYEN_CEVAP = ZARF(
  '<p666:raporAramaTarihileResponse xmlns:p666="http://service.com"><raporAramaTarihileReturn>' +
    '<sonucKod>0</sonucKod><sonucAciklama>Ba&#351;ar&#305;l&#305;</sonucAciklama>' +
    '<isKazasiHastaneBilgiBeanArray xsi:nil="true"/><onayliRaporlarTarihleBeanArray xsi:nil="true"/>' +
    '<raporAramaTarihleBeanArray>' +
    '<RaporAramaTarihleBean><TCKIMLIKNO>11111111110</TCKIMLIKNO><AD>AY&#350;E &#304;PEK</AD><SOYAD>DEN&#304;Z</SOYAD>' +
    '<MEDULARAPORID>900000001</MEDULARAPORID><RAPORTAKIPNO>100000000000000001</RAPORTAKIPNO><RAPORSIRANO>1</RAPORSIRANO>' +
    '<POLIKLINIKTAR>2026-04-09</POLIKLINIKTAR><YATRAPBASTAR>0001-01-01</YATRAPBASTAR><YATRAPBITTAR>0001-01-01</YATRAPBITTAR>' +
    '<ABASTAR>2026-04-09</ABASTAR><ABITTAR>2026-04-26</ABITTAR><ISBASKONTTAR>2026-04-27</ISBASKONTTAR>' +
    '<DOGUMONCBASTAR>2026-04-09</DOGUMONCBASTAR><ISKAZASITARIHI>-</ISKAZASITARIHI><RAPORDURUMU>11</RAPORDURUMU>' +
    '<VAKA>4</VAKA><VAKAADI>ANALIK</VAKAADI><TESISKODU>2</TESISKODU><TESISADI>0</TESISADI><ARSIV>0</ARSIV></RaporAramaTarihleBean>' +
    '<RaporAramaTarihleBean><TCKIMLIKNO>11111111110</TCKIMLIKNO><AD>AY&#350;E &#304;PEK</AD><SOYAD>DEN&#304;Z</SOYAD>' +
    '<MEDULARAPORID>900000002</MEDULARAPORID><POLIKLINIKTAR>2026-04-27</POLIKLINIKTAR><YATRAPBASTAR>2026-04-27</YATRAPBASTAR>' +
    '<YATRAPBITTAR>2026-04-27</YATRAPBITTAR><ABASTAR>2026-04-28</ABASTAR><ABITTAR>2026-09-02</ABITTAR>' +
    '<ISBASKONTTAR>2026-09-03</ISBASKONTTAR><ISKAZASITARIHI>-</ISKAZASITARIHI><RAPORDURUMU>12</RAPORDURUMU>' +
    '<VAKA>4</VAKA><VAKAADI>ANALIK</VAKAADI></RaporAramaTarihleBean>' +
    '</raporAramaTarihleBeanArray><tarihSorguBean xsi:nil="true"/></raporAramaTarihileReturn></p666:raporAramaTarihileResponse>',
);

describe('WS_Vizite cevap çözümü', () => {
  it('başarılı listeyi, Türkçe varlıkları ve kayıtları çözer', () => {
    const c = cevapCoz(BEKLEYEN_CEVAP);
    expect(c.sonucKod).toBe(0);
    expect(c.sonucAciklama).toBe('Başarılı');
    expect(c.kayitlar).toHaveLength(2);
    expect(c.kayitlar[0].tip).toBe('RaporAramaTarihleBean');
    expect(c.kayitlar[0].alanlar.AD).toBe('AYŞE İPEK');
    expect(c.kayitlar[0].alanlar.SOYAD).toBe('DENİZ');
  });

  it('"kayıt bulunamadı" ve dakika sınırı kodlarını okur', () => {
    const bos = cevapCoz(ZARF('<r><sonucKod>503</sonucKod><sonucAciklama>Sorgulad&#305;&#287;&#305;n&#305;z Tarih Aral&#305;&#287;&#305;nda Kay&#305;t Bulunamad&#305;.</sonucAciklama><raporAramaTarihleBeanArray xsi:nil="true"/></r>'));
    expect(bos.sonucKod).toBe(503);
    expect(bos.kayitlar).toHaveLength(0);
    const sinir = cevapCoz(ZARF('<r><sonucKod>1012</sonucKod><sonucAciklama>1 dakika aral&#305;klar ile sorgulama yapabilirsiniz. !!!!</sonucAciklama></r>'));
    expect(sinir.sonucKod).toBe(1012);
    expect(sinir.sonucAciklama).toContain('1 dakika aralıklar');
    const kapali = cevapCoz(ZARF('<r><sonucKod>-1</sonucKod><sonucAciklama>Bu metod kapat&#305;lm&#305;&#351;t&#305;r!!!!!</sonucAciklama></r>'));
    expect(kapali.sonucKod).toBe(-1);
  });

  it('iç içe detay kaydını (küçük harfli sarmalayıcı + büyük harfli kayıt) çözer', () => {
    const c = cevapCoz(ZARF(
      '<r><sonucKod>0</sonucKod><sonucAciklama>ok</sonucAciklama><onayliRaporDetayBean><OnayliRaporDetayBean>' +
        '<MEDULARAPOR_ID>900000003</MEDULARAPOR_ID><BILDIRIM_ID>700000001</BILDIRIM_ID><BASTAR>2026-08-05</BASTAR>' +
        '<BITTAR>2026-08-31</BITTAR><CALISTI_CALISMADI>0</CALISTI_CALISMADI><ISLEM_TARIHI>2026-09-18</ISLEM_TARIHI>' +
        '<ODEMECIKTIMI>0</ODEMECIKTIMI></OnayliRaporDetayBean></onayliRaporDetayBean></r>',
    ));
    expect(c.kayitlar).toHaveLength(1);
    expect(c.kayitlar[0].tip).toBe('OnayliRaporDetayBean');
    const p = onayParcasiCoz(c.kayitlar[0].alanlar)!;
    expect(p).toEqual({ baslangic: '2026-08-05', bitis: '2026-08-31', calisti: false, islemTarihi: '2026-09-18', odemeCikti: false, bildirimId: '700000001' });
  });

  it('giriş cevabındaki token kayıt olarak dönmez (loglara karışmasın)', () => {
    const c = cevapCoz(ZARF('<p:wsLoginResponse xmlns:p="http://service.com"><wsLoginReturn><sonucKod>0</sonucKod><sonucAciklama>Login ba&#351;ar&#305;l&#305;!</sonucAciklama><wsToken>00000000-aaaa-bbbb-cccc-000000000000</wsToken></wsLoginReturn></p:wsLoginResponse>'));
    expect(c.sonucKod).toBe(0);
    expect(c.kayitlar).toHaveLength(0);
  });

  it('SOAP hata cevabını açıklamaya çevirir', () => {
    const c = cevapCoz(ZARF('<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Beklenmeyen hata</faultstring></soapenv:Fault>'));
    expect(c.sonucKod).toBeNull();
    expect(c.sonucAciklama).toContain('Beklenmeyen hata');
  });

  it('istek zarfı alanları kaçışlar, gövde öğesi service.com ad alanında', () => {
    const z = soapZarfi('wsLogin', { kullaniciAdi: '12345678901', isyeriKodu: '2', isyeriSifresi: 'a<b&c' });
    expect(z).toContain('xmlns:ser="http://service.com"');
    expect(z).toContain('<ser:wsLogin><kullaniciAdi>12345678901</kullaniciAdi><isyeriKodu>2</isyeriKodu><isyeriSifresi>a&lt;b&amp;c</isyeriSifresi></ser:wsLogin>');
  });

  it('SGK tarihlerini ve boş değerleri çevirir', () => {
    expect(sgkTarih('0001-01-01')).toBeNull();
    expect(sgkTarih('-')).toBeNull();
    expect(sgkTarih('')).toBeNull();
    expect(sgkTarih('2026-04-09')).toBe('2026-04-09');
    expect(sgkTarih('9.4.2026')).toBe('2026-04-09');
    expect(varlikCoz('G&#214;KHAN &amp; K')).toBe('GÖKHAN & K');
  });
});

describe('rapor satırları', () => {
  const kayitlar = cevapCoz(BEKLEYEN_CEVAP).kayitlar.map((k) => bekleyenRaporCoz(k.alanlar)!);

  it('onay bekleyen raporda başlangıç/bitiş/gün Hattat ile aynı hesaplanır', () => {
    // Doğum sonrası: yatarak 27.04 + ayakta 28.04–02.09 → 27.04–02.09 = 129 gün
    expect(kayitlar[1].raporBaslangic).toBe('2026-04-27');
    expect(kayitlar[1].raporBitis).toBe('2026-09-02');
    expect(gunSayisi(kayitlar[1].raporBaslangic, kayitlar[1].raporBitis)).toBe(129);
    expect(kayitlar[1].vakaAdi).toBe('Analık');
    expect(kayitlar[0].raporDurumuKodu).toBe('11');
    expect(kayitlar[0].isKazasiTarihi).toBeNull();
    expect(kayitlar[0].adSoyad).toBe('AYŞE İPEK DENİZ');
  });

  it('onaylı raporda bitiş = işbaşı/kontrol − 1 gün', () => {
    const r = onayliRaporCoz({ TCKIMLIKNO: '22222222220', AD: 'ALİ', SOYAD: 'VELİ', MEDULARAPORID: '900000003', POLIKLINIKTAR: '2026-08-05', ISBASKONTTAR: '2026-10-04', ISKAZASITARIHI: '-', VAKA: '3', VAKAADI: 'HASTALIK' })!;
    expect(r.raporBaslangic).toBe('2026-08-05');
    expect(r.raporBitis).toBe('2026-10-03');
    expect(r.vakaAdi).toBe('Hastalık');
  });

  it('parçalı rapor: onaylanan son gün rapor bitişinden önceyse kalan aralık döner', () => {
    const parca = [{ baslangic: '2026-08-05', bitis: '2026-08-31', calisti: false, islemTarihi: '2026-09-18', odemeCikti: false, bildirimId: '1' }];
    expect(kalanAralik({ raporBitis: '2026-10-03', isbasiKontrolTarihi: '2026-10-04' }, parca)).toEqual({ kalanBaslangic: '2026-09-01', kalanBitis: '2026-10-03' });
    // tamamı onaylı
    expect(kalanAralik({ raporBitis: '2026-01-13', isbasiKontrolTarihi: '2026-01-14' }, [{ ...parca[0], baslangic: '2026-01-09', bitis: '2026-01-13' }])).toBeNull();
    // parça yok → karar yok
    expect(kalanAralik({ raporBitis: '2026-10-03', isbasiKontrolTarihi: null }, [])).toBeNull();
  });

  it('onay penceresi sınırları', () => {
    const parca = [{ baslangic: '2026-08-05', bitis: '2026-08-31', calisti: false, islemTarihi: null, odemeCikti: null, bildirimId: null }];
    expect(onayBaslangici({ raporBaslangic: '2026-08-05', poliklinikTarihi: '2026-08-05' }, parca)).toBe('2026-09-01');
    expect(onayBaslangici({ raporBaslangic: '2026-08-05', poliklinikTarihi: '2026-08-05' }, [])).toBe('2026-08-05');
    // bitiş bugünü geçemez
    expect(onayEnGecBitisi({ raporBitis: '2026-10-03', isbasiKontrolTarihi: '2026-10-04' }, '2026-09-26')).toBe('2026-09-26');
    expect(onayEnGecBitisi({ raporBitis: '2026-09-02', isbasiKontrolTarihi: '2026-09-03' }, '2026-09-26')).toBe('2026-09-02');
  });
});

describe('iş kazası', () => {
  it('SGK bildirim son günü: kaza günü sayılmaz, 3 iş günü (cumartesi/pazar/resmî tatil hariç)', () => {
    // Cuma kaza → Pzt, Sal, Çar
    expect(isKazasiBildirimSonGunu('2026-09-25', resmiTatilMi)).toBe('2026-09-30');
    // Perşembe kaza → Cuma, Pzt, Sal
    expect(isKazasiBildirimSonGunu('2026-10-22', resmiTatilMi)).toBe('2026-10-27');
    // Çarşamba 28 Ekim → 29 Ekim Cumhuriyet Bayramı sayılmaz → Cuma 30, Pzt 2, Sal 3 Kasım
    expect(isKazasiBildirimSonGunu('2026-10-28', resmiTatilMi)).toBe('2026-11-03');
    expect(isKazasiBildirimSonGunu(null, resmiTatilMi)).toBeNull();
  });

  it('hastane bildirimi satırı', () => {
    const k = isKazasiCoz({ BILDIRIMID: '800000001', TCKIMLIKNO: '33333333330', CINSIYET: 'E', PROVIZYONTARIHI: '2026-09-25', TESISADI: 'ÖRNEK DEVLET HASTANESİ', UNVANI: '', ISLEMTUR: 'İŞ KAZASI', ISKAZASITARIHI: '2026-09-25' })!;
    expect(k.sgkBildirimSonGun).toBe('2026-09-30');
    expect(k.unvani).toBeNull();
    expect(k.isKazasiTarihi).toBe('2026-09-25');
  });
});

describe('dakika sınırı sırası', () => {
  it('sınırlı çağrılar arasında en az ayar kadar bekler', async () => {
    const eski = process.env.SGK_VIZITE_SINIR_MS;
    process.env.SGK_VIZITE_SINIR_MS = '60';
    await jest.isolateModulesAsync(async () => {
      const { sinirliSira } = await import('./sgk-vizite-istemci');
      const zamanlar: number[] = [];
      await Promise.all([1, 2, 3].map(() => sinirliSira(async () => { zamanlar.push(Date.now()); })));
      expect(zamanlar).toHaveLength(3);
      expect(zamanlar[1] - zamanlar[0]).toBeGreaterThanOrEqual(55);
      expect(zamanlar[2] - zamanlar[1]).toBeGreaterThanOrEqual(55);
    });
    process.env.SGK_VIZITE_SINIR_MS = eski;
  });
});
