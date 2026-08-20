#!/usr/bin/env node
/**
 * eLOGO GONDERIM GUVENLIK regresyonu.
 *
 * KULLANICI KURALI (2026-08-20): "sakin fatura no verip gonder yapma, firmaya gider
 * fatura yoksa" + "eLogo'da fatura numarasi verildikten sonra fatura iptal edilemiyor".
 *
 * Bu test, gonderim yolunun KAZA ILE calismasini engelleyen korumalari kilitler:
 *  1) Acik onay olmadan gonderim YOK.
 *  2) Gonderimi kendiliginden tetikleyen bir cagri KODDA YOK (bot tek basina kesemez).
 *  3) Atomik durum kilidi var (ayni taslak iki kez gonderilemez).
 *  4) Belirsiz yanitta durum TASLAK'a DONDURULMEZ (mukerrer fatura riski).
 *  5) On ek (seri) UYDURULMAZ; eLogo'dan okunur.
 *  6) Alicinin birden fazla posta kutusu varsa SECILMEZ, sorulur.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

const SERVIS = path.join(ROOT, 'apps/api/src/fatura-kes/elogo-fatura.service.ts');
const { ElogoFaturaService } = require(SERVIS);
const kaynak = fs.readFileSync(SERVIS, 'utf8');

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

// ---------- 1) ACIK ONAY OLMADAN GONDERIM YOK ----------
(async () => {
  const svc = new ElogoFaturaService({
    salesInvoiceDraft: { findFirst: async () => ({ id: 'x', taxpayerId: 't', aliciVkn: '1', durum: 'TASLAK' }) },
  });
  for (const girdi of [undefined, {}, { onay: false }, { onay: 'true' }, { onay: 1 }]) {
    let firlattiMi = false;
    let mesaj = '';
    try {
      await svc.onaylaVeGonder('t', 'x', girdi);
    } catch (e) { firlattiMi = true; mesaj = String(e.message || ''); }
    ok(`onay=${JSON.stringify(girdi)} ile gonderim REDDEDILIR`, firlattiMi && mesaj.includes('onay'),
      firlattiMi ? 'mesaj: ' + mesaj.slice(0, 80) : 'HIC HATA FIRLATMADI — gonderim yolu acik!');
  }

  // ---------- 2) GONDERIMI SADECE ONAY DALI CAGIRABILIR ----------
  // Kullanici 2026-08-20 aksami "bagla, amac zaten kesmesi" dedi. Artik TEK bir cagri yeri
  // var: WhatsApp owner hattindaki IKINCI KADEME onay dali. Baska bir dosyadan cagrilirsa
  // (ornegin bir cron, bir toplu is) bu test cakar.
  const IZINLI = ['apps/api/src/whatsapp/whatsapp-bot.controller.ts'];
  const cagiranlar = [];
  const gez = (dizin) => {
    for (const ad of fs.readdirSync(dizin)) {
      const tam = path.join(dizin, ad);
      if (fs.statSync(tam).isDirectory()) { gez(tam); continue; }
      if (!ad.endsWith('.ts')) continue;
      if (tam.endsWith('elogo-fatura.service.ts')) continue;
      const s2 = fs.readFileSync(tam, 'utf8');
      if (s2.includes('onaylaVeGonder')) cagiranlar.push(path.relative(ROOT, tam));
    }
  };
  for (const d of ['apps/api/src/whatsapp', 'apps/api/src/fatura-kes']) gez(path.join(ROOT, d));
  const izinsiz = cagiranlar.filter((c) => !IZINLI.includes(c.split(path.sep).join('/')));
  ok('gonderimi yalniz onay dali cagiriyor', izinsiz.length === 0, 'izinsiz cagiran: ' + izinsiz.join(', '));

  // Cagri KESIN ONAY ve KURU TEST korumasinin ARDINDA olmali.
  const bot = fs.readFileSync(path.join(ROOT, 'apps/api/src/whatsapp/whatsapp-bot.controller.ts'), 'utf8');
  const i = bot.indexOf('onaylaVeGonder');
  const oncesi = bot.slice(Math.max(0, i - 1200), i);
  ok('cagri KESIN ONAY (EVET KES) kontrolunun ardinda', oncesi.includes('kesinOnayMi'));
  ok('cagri KURU TEST korumasinin ardinda', oncesi.includes('__dryRun'));

  // ---------- 2b) "EVET KES" KATI ESLESIR ----------
  const { FaturaKesKomutService } = require(path.join(ROOT, 'apps/api/src/fatura-kes/fatura-kes-komut.service.ts'));
  const kesenler = ['EVET KES', 'evet kes', '  Evet   Kes  ', 'EVET  KES'];
  const kesmeyenler = ['evet', 'tamam', 'olur', 'onayla', 'kes', 'evet kesme', 'evet kes lutfen', 'hayir kes'];
  for (const m of kesenler) ok(`"${m}" -> KESIN ONAY`, FaturaKesKomutService.kesinOnayMi(m) === true);
  for (const m of kesmeyenler) ok(`"${m}" -> kesin onay DEGIL`, FaturaKesKomutService.kesinOnayMi(m) === false);

  // ---------- 3) ATOMIK KILIT ----------
  ok('atomik durum kilidi var (TASLAK -> GONDERILIYOR)',
    /updateMany\([\s\S]{0,200}durum: 'TASLAK'[\s\S]{0,200}GONDERILIYOR/.test(kaynak));
  ok('kilit alinamazsa gonderim durur', kaynak.includes('kilit.count !== 1'));

  // ---------- 4) BELIRSIZ YANITTA TASLAK'A DONULMEZ ----------
  const basarisizBlok = kaynak.slice(kaynak.indexOf('if (sonuc.basarili)'));
  ok('basarisiz/belirsiz yanitta durum TASLAK yapilmaz',
    basarisizBlok.indexOf("durum: 'TASLAK'") < 0,
    'belirsizlik red degildir; TASLAK a donmek mukerrer faturaya yol acar');

  // ---------- 5) ON EK UYDURULMAZ ----------
  ok('on ek eLogo dan okunuyor (sonNumara)', kaynak.includes('const seri = await this.sonNumara('));
  ok('sabit on ek yedegi YOK', !/String\(d\.onEk \|\| 'AAA'\)/.test(kaynak));

  // ---------- 6) COKLU ETIKETTE SECIM YAPILMAZ ----------
  ok('coklu posta kutusunda secim yapilmaz, sorulur',
    kaynak.includes('postaKutulari.length > 1') && /postaKutulari\.length > 1[\s\S]{0,200}BadRequestException/.test(kaynak));

  // ---------- 7) PK/GB ETIKET AYRIMI ----------
  ok('InvoicePkList ile InvoiceGbList ayri okunuyor',
    kaynak.includes("listeEtiketleri(govde, 'InvoicePkList')") && kaynak.includes("listeEtiketleri(govde, 'InvoiceGbList')"));
  ok('eFaturaMi PK listesine bakar', kaynak.includes('eFaturaMi: postaKutulari.length > 0'));

  // ---------- 8) DENETIM BULGULARI (2026-08-20 karsi-gorus) ----------
  const bot2 = fs.readFileSync(path.join(ROOT, 'apps/api/src/whatsapp/whatsapp-bot.controller.ts'), 'utf8');
  const servis = fs.readFileSync(SERVIS, 'utf8');

  // R1: kimliksiz HTTP webhook'undan gelen mesajla GERCEK FATURA KESILEMEZ
  ok('HTTP webhook mesajlari isaretleniyor', bot2.includes("__kaynak = 'http'"));
  const kesimDali = bot2.slice(bot2.indexOf('kesinOnayMi(metin)'), bot2.indexOf('onaylaVeGonder'));
  ok('EVET KES, HTTP kaynakli mesajda REDDEDILIR', kesimDali.includes("__kaynak === 'http'"),
    'kimliksiz webhook ile disaridan fatura kesilebilir');

  // R2: eLogo reddederse "kesildi" DENMEZ
  const basarisiz = servis.slice(servis.indexOf('if (sonuc.basarili)'));
  ok('basarisiz/belirsiz yanitta HATA firlatilir', /else \{[\s\S]{0,900}throw new BadRequestException/.test(basarisiz),
    'sessizce donerse cagiran taraf FATURA KESILDI der');

  // R3: numara alindiktan SONRA ag cagrisi kalmasin
  const iUbl = servis.indexOf('const hamUbl');
  const iNumara = servis.indexOf('const numara = await this.numaraAl(');
  ok('UBL numaradan ONCE hazirlaniyor', iUbl > 0 && iNumara > 0 && iUbl < iNumara,
    'numara alinip sonra hata olursa numara yanar');

  // R6: kuru testte onay yuvasi kurulmaz
  const iDry = bot2.indexOf("owner:fatura-kes:kesin-onay-soru");
  const iArm = bot2.indexOf('kesimOnayinaAl(kimlik, bekleyenTaslak)');
  ok('kuru test kontrolu YUVA KURMADAN once', iDry > 0 && iArm > 0 && iDry < iArm,
    'deneme, gercek hatta EVET KES yuvasi kuruyor');

  // R5: mukerrer korumasi WhatsApp yolunda kullaniliyor
  const komut = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-kes/fatura-kes-komut.service.ts'), 'utf8');
  ok('WhatsApp taslaginda idempotencyKey var', komut.includes('idempotencyKey:'));

  // R7: kanal belirlenemezse fail-closed
  ok('kanal belirlenemezse hata firlatilir (fail-closed)',
    /Kanal belirlenemedi/.test(bot2) && !/kanalTespit\([^)]*\)\.catch\(\(\) => null\)[\s\S]{0,80}ENTEGRATOR/.test(bot2));

  // ---------- 9) TURKCE ONAY KELIMELERI (canli hata 2026-08-20 22:02) ----------
  // Kullanici "onayliyorum" yazdi, eski kalip ESLESMEDI; mesaj genel asistana dustu.
  const olumlu = ['onaylıyorum', 'ONAYLIYORUM', 'onayla', 'tamam', 'evet', 'gönder', 'kes', 'onay veriyorum'];
  const olumsuz = ['onaylamıyorum', 'onaylamam', 'vazgeç', 'hayır', 'kesme', 'gönderme', 'iptal'];
  for (const m of olumlu) ok(`onayMi("${m}") = true`, FaturaKesKomutService.onayMi(m) === true);
  for (const m of olumsuz) ok(`onayMi("${m}") = false`, FaturaKesKomutService.onayMi(m) === false);
  for (const m of ['vazgeçiyorum', 'iptal', 'hayır', 'kesme']) ok(`vazgecMi("${m}") = true`, FaturaKesKomutService.vazgecMi(m) === true);

  // ---------- 10) SERI SECIMI: PORTAL SERISI KULLANILMAZ (canli kanit 2026-08-20) ----------
  // eLogo'da her on ekin KULLANIM TURU var: Type=0 Portal, Type=2 Web Servis.
  // GITO: AAA(48,Portal) · BBB(0,Web Servis) · e-Arsiv GTO(0,Web Servis).
  // Eski kod "sayaci en buyuk" secip PORTAL serisini kullanacakti.
  ok('Type alani okunuyor', servis.includes('<a:Type>'));
  ok('Web Servis tipi (2) tercih ediliyor', servis.includes('const WEB_SERVIS = 2') && servis.includes('x.tip === WEB_SERVIS'));
  ok('Web Servis serisi yoksa kullanilan NULL', /kullanilan: webServis\[0\] \|\| null/.test(servis),
    'portal serisi kullanilirsa yanlis seriden fatura kesilir');
  ok('hata mesaji nereye bakilacagini soyluyor', servis.includes('Belge Numarasi On Ek Tanimlari'));

  // ---------- 11) KILIT, DOGRULAMALARDAN SONRA ALINIR (canli olay 2026-08-20 22:24) ----------
  // Once kilit alininca, seri bulunamayan taslak kalici olarak GONDERILIYOR'da kaliyordu.
  const iKilit = servis.indexOf("const kilit = await");
  const iSeri = servis.indexOf('const seri = await this.sonNumara(');
  const iUblHazir = servis.indexOf('const hamUbl');
  ok('kilit, seri kontrolunden SONRA', iKilit > iSeri && iSeri > 0);
  ok('kilit, UBL hazirligindan SONRA', iKilit > iUblHazir && iUblHazir > 0);

  // ---------- 12) GORSEL TASARIM + TEKRAR GONDERIM (canli olay 2026-08-20 22:56) ----------
  // eLogo numarayi verdi (GTO2026000000001) ama belgeyi REDDETTI:
  //   "[-1] e-Belge gorsel tasarim icermelidir"
  // Kok neden: UseDefaultXSLT=1 yalniz onizleme cagrisindaydi, GONDERIMDE yoktu.
  const iSend = servis.indexOf("'SendDocument'");
  const sendBlok = iSend > 0 ? servis.slice(iSend, iSend + 1200) : '';
  ok('SendDocument gorsel tasarim parametresini gonderiyor', sendBlok.includes('UseDefaultXSLT=1'),
    'eLogo tasarimsiz belgeyi reddeder; numara alinmis olur ama fatura kesilmez');
  ok('onizleme de gorsel tasarim gonderiyor', servis.split('UseDefaultXSLT=1').length - 1 >= 2);

  // Tekrar denendiginde YENI NUMARA ALINMAMALI — yoksa her denemede bir numara yanar.
  ok('mevcut numara tekrar kullaniliyor',
    /let numara = String\(d\.faturaNo/.test(servis) && /d\.durum === 'GONDERILIYOR'/.test(servis),
    'her denemede yeni numara alinirsa seri bosa harcanir');
  const iNumaraAl = servis.indexOf('numara = await this.numaraAl(');
  const iTekrar = servis.indexOf("tekrar gonderim");
  ok('numara alma, tekrar-gonderim kontrolunden SONRA', iTekrar > 0 && iNumaraAl > iTekrar);

  // Sikismis (numarali) taslak, saate karsi yarisilmadan onaya acilabilmeli.
  ok('sikismis taslak icin genis kurtarma penceresi',
    /durum: 'GONDERILIYOR'[\s\S]{0,120}faturaNo: \{ not: null \}/.test(bot2)
    && /24 \* 60 \* 60 \* 1000/.test(bot2),
    'numara zaten yandiysa kullanicinin 2 saat icinde yetismesi gerekmemeli');
  ok('normal taslak penceresi hala kisa (2 saat)',
    /durum: 'TASLAK', createdAt: \{ gte: new Date\(Date\.now\(\) - 2 \* 60 \* 60 \* 1000\)/.test(bot2));

  // ---------- 13) TEKRAR GONDERIM: NUMARALI TASLAK DA HAZIR SAYILIR ----------
  // CANLI OLAY 2026-08-20 23:14: taslakta numara vardi, taslaktanOnizleme UBL'i o
  // numarayla uretti (ONIZLEME yer tutucusu yoktu), eski kontrol bulamayip
  // "Fatura XML hazirlanamadi" dedi. Fatura kesilemedi.
  const NO = 'GTO2026000000001';
  const ublYerTutucu = '<x><cbc:UUID>AAA-BBB</cbc:UUID><cbc:ID>ONIZLEME</cbc:ID></x>';
  const ublNumarali = `<x><cbc:UUID>AAA-BBB</cbc:UUID><cbc:ID>${NO}</cbc:ID></x>`;
  const ublYabanci = '<x><cbc:UUID>AAA-BBB</cbc:UUID><cbc:ID>BASKA1</cbc:ID></x>';

  ok('ilk gonderim: yer tutuculu UBL hazir', ElogoFaturaService.ublHazirMi(ublYerTutucu, null) === true);
  ok('tekrar gonderim: numarali UBL hazir', ElogoFaturaService.ublHazirMi(ublNumarali, NO) === true,
    'numara alinmis taslak bir daha gonderilemez hale gelir');
  ok('numara uyusmuyorsa hazir DEGIL', ElogoFaturaService.ublHazirMi(ublYabanci, NO) === false,
    'yanlis numarali belge gonderilmemeli');
  ok('bos UBL hazir DEGIL', ElogoFaturaService.ublHazirMi('', NO) === false);
  ok('numarasiz taslakta rastgele UBL hazir DEGIL', ElogoFaturaService.ublHazirMi(ublYabanci, null) === false);

  const yazilan = ElogoFaturaService.ublNumaraYaz(ublYerTutucu, NO);
  ok('yer tutucu numarayla degistirilir',
    !!yazilan && yazilan.includes(`<cbc:ID>${NO}</cbc:ID>`) && !yazilan.includes('ONIZLEME'));
  ok('zaten numarali UBL bozulmaz',
    ElogoFaturaService.ublNumaraYaz(ublNumarali, NO) === ublNumarali);
  ok('numara yazilamiyorsa NULL (gonderim yapilmaz)',
    ElogoFaturaService.ublNumaraYaz(ublYabanci, NO) === null,
    'yanlis numarali belge gonderilmesindense hic gonderilmesin');

  // ETTN sabitleme: tekrar gonderimde ETTN degisirse ayni numaradan IKINCI belge olusabilir.
  const ettnli = ElogoFaturaService.ublEttnYaz(ublNumarali, 'SABIT-ETTN-1');
  ok('ETTN UBL icine yazilir', ElogoFaturaService.ublEttnOku(ettnli) === 'SABIT-ETTN-1');
  ok('ETTN bos gecilirse UBL degismez', ElogoFaturaService.ublEttnYaz(ublNumarali, '') === ublNumarali);
  ok('gonderimde ETTN taslaktan alinir', /const ettn = String\(d\.ettn/.test(kaynak),
    'her denemede yeni ETTN uretilirse mukerrer fatura riski dogar');
  ok('hazirlik hatasi kullaniciya soylenir', /hazirlikHatasi/.test(kaynak),
    'sebep yutulursa bir daha teshis edemeyiz');

  if (hata) process.exit(1);
  console.log('[elogo-gonderim-guvenlik] OK: acik onaysiz gonderim yok, kilit ve etiket kurallari saglam');
})();
