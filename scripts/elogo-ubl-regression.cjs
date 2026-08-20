#!/usr/bin/env node
/**
 * eLOGO UBL-TR fatura XML regresyonu.
 *
 * SOZLESME KAYNAGI: GITO GIDA'nin eLogo'dan KESTIGI gercek fatura
 * (AAA2026000000045 — ayni aliciya, ayni icerikle, %10 KDV). Sablon ORADAN cikarildi.
 *
 * NEDEN GEREKLI: UBL'de eleman SIRASI zorunludur; bir kapanis etiketi eksik ya da sira
 * bozuk olursa entegrator belgeyi reddeder ve sebebi cogu zaman anlasilmaz olur.
 * Bu test hem bicimi hem sozlesme sabitlerini kilitler.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

const mod = require(path.join(ROOT, 'apps/api/src/fatura-kes/elogo-fatura.service.ts'));
const { ElogoFaturaService, yaziyla, ublTutar } = mod;

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

const svc = new ElogoFaturaService({});
const xml = svc.ublOlustur({
  saticiVkn: '3961368714',
  saticiUnvan: 'GİTO GIDA İNŞAAT TİCARET LİMİTED ŞİRKETİ',
  saticiAdres: 'ÖMERLİ MAH. ADNAN KAHVECİ CAD. NO: 1 /1 ARNAVUTKÖY/ İSTANBUL',
  saticiIlce: 'ARNAVUTKÖY', saticiIl: 'İSTANBUL', saticiTel: '90 (534) 337-6764',
  aliciVkn: '7601043666',
  aliciUnvan: 'SELİM İNŞAAT GIDA SANAYİ VE TİCARET ANONİM ŞİRKETİ',
  aliciAdres: 'KARAAĞAÇ MAH. HADIMKÖY İSTANBUL CAD. NO 38/4 BÜYÜKÇEKMECE / İSTANBUL',
  aliciIlce: 'BÜYÜKÇEKMECE', aliciIl: 'İSTANBUL', aliciVergiDairesi: 'BÜYÜKÇEKMECE',
  faturaNo: 'ONIZLEME', faturaTarihi: new Date('2026-08-20T15:30:00'),
  aciklama: 'YEMEK BEDELİ',
  miktar: 1, matrah: 68000, kdvOrani: 10, kdvTutari: 6800, toplam: 74800,
}, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');

// ---------- 1) BICIM: etiketler duzgun kapaniyor mu ----------
function iyiBicimli(s) {
  const yigin = [];
  const re = /<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(s))) {
    const [, kapanis, ad, nitelik, kendiKapanan] = m;
    if (nitelik.startsWith('?') || ad.startsWith('?')) continue;
    if (kendiKapanan === '/') continue;
    if (kapanis === '/') {
      const bekle = yigin.pop();
      if (bekle !== ad) return `kapanis uyumsuz: </${ad}> gordu, </${bekle || 'yok'}> bekleniyordu`;
    } else yigin.push(ad);
  }
  return yigin.length ? `kapanmamis etiket: ${yigin.join(' > ')}` : null;
}
const bicimHata = iyiBicimli(xml.replace(/<\?xml[^>]*\?>/, ''));
ok('XML iyi bicimli (tum etiketler kapaniyor)', !bicimHata, bicimHata || '');

// ---------- 2) SOZLESME SABITLERI (gercek faturadan) ----------
const sabitler = [
  ['UBLVersionID 2.1', '<cbc:UBLVersionID>2.1</cbc:UBLVersionID>'],
  ['CustomizationID TR1.2', '<cbc:CustomizationID>TR1.2</cbc:CustomizationID>'],
  ['ProfileID TICARIFATURA', '<cbc:ProfileID>TICARIFATURA</cbc:ProfileID>'],
  ['InvoiceTypeCode SATIS', '<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>'],
  ['KDV vergi kodu 0015', '<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>'],
  ['KDV adi GERCEK', '<cbc:Name>KDV GERCEK</cbc:Name>'],
  ['para birimi TRY', '>TRY</cbc:DocumentCurrencyCode>'],
  ['miktar birim kodu NIU', 'unitCode="NIU"'],
  ['satici VKN', '<cbc:ID schemeID="VKN">3961368714</cbc:ID>'],
  ['alici VKN', '<cbc:ID schemeID="VKN">7601043666</cbc:ID>'],
];
for (const [ad, parca] of sabitler) ok(ad, xml.includes(parca), `bulunamadi: ${parca}`);

// ---------- 3) IMZA BLOGU OLMAMALI (entegrator ekler) ----------
ok('imza blogu (ext:UBLExtensions) YOK — muhur entegratorde', !xml.includes('<ext:UBLExtensions'));
ok('gomulu XSLT YOK', !xml.includes('EmbeddedDocumentBinaryObject'));

// ---------- 4) ARITMETIK ----------
const say = (etiket) => {
  const m = xml.match(new RegExp(`<cbc:${etiket}[^>]*>([\\d.]+)</cbc:${etiket}>`));
  return m ? Number(m[1]) : NaN;
};
ok('matrah 68000', say('TaxExclusiveAmount') === 68000);
ok('KDV 6800', say('TaxAmount') === 6800);
ok('toplam 74800', say('TaxInclusiveAmount') === 74800);
ok('odenecek = toplam', say('PayableAmount') === 74800);
ok('matrah + KDV = toplam', say('TaxExclusiveAmount') + say('TaxAmount') === say('TaxInclusiveAmount'));

// ---------- 5) ELEMAN SIRASI (UBL'de ZORUNLU) ----------
const sira = ['UBLVersionID', 'CustomizationID', 'ProfileID', 'cbc:ID', 'UUID', 'IssueDate', 'IssueTime',
  'InvoiceTypeCode', 'DocumentCurrencyCode', 'LineCountNumeric', 'cac:Signature',
  'AccountingSupplierParty', 'AccountingCustomerParty', 'cac:TaxTotal', 'LegalMonetaryTotal', 'InvoiceLine'];
let onceki = -1, siraOk = true, bozuk = '';
for (const ad of sira) {
  // Onek cbc: ya da cac: olabilir — ikisini de dene (testin kendi tuzagi: sabit cbc: yaziliydi).
  const i = ad.includes(':')
    ? xml.indexOf('<' + ad)
    : Math.max(xml.indexOf('<cbc:' + ad), xml.indexOf('<cac:' + ad));
  if (i < 0) { siraOk = false; bozuk = ad + ' yok'; break; }
  if (i < onceki) { siraOk = false; bozuk = ad + ' yanlis sirada'; break; }
  onceki = i;
}
ok('eleman sirasi UBL sozlesmesine uygun', siraOk, bozuk);

// ---------- 6) TUTAR BICIMI ve YAZIYLA ----------
ok('tutar noktali ondalik (virgul YOK)', !/[\d],[\d]/.test(xml));
const yaziTestleri = [[74800, 'YetmişDörtBinSekizYüz'], [1000, 'Bin'], [2000, 'İkiBin'],
  [11000, 'OnBirBin'], [105, 'YüzBeş'], [1, 'Bir'], [0, 'Sıfır'], [78892, 'YetmişSekizBinSekizYüzDoksanİki']];
for (const [n, b] of yaziTestleri) ok(`yaziyla(${n}) = ${b}`, yaziyla(n) === b, `olan: ${yaziyla(n)}`);
ok('ublTutar tam sayida ondalik eklemez', ublTutar(68000) === '68000');
ok('ublTutar kurusu korur', ublTutar(1234.56) === '1234.56');


// ---------- 7) ONIZLEMEDE FATURA NUMARASI OLMAMALI ----------
// KULLANICI KURALI (2026-08-20): "eLogo'da fatura numarasi verildikten sonra fatura iptal
//   edilemiyor, silinemiyor -> fatura numarasiz onizleme gondermeli."
//   Bu yuzden onizleme icin uretilen UBL'de GERCEK bir seri numarasi BULUNMAMALI.
const onizlemeXml = svc.ublOlustur({
  saticiVkn: '3961368714', saticiUnvan: 'GITO', saticiAdres: 'x', saticiIlce: 'y', saticiIl: 'z',
  aliciVkn: '7601043666', aliciUnvan: 'SELIM', aliciAdres: 'adres', aliciIlce: 'a', aliciIl: 'b',
  faturaNo: 'ONIZLEME', faturaTarihi: new Date('2026-08-20T10:00:00'), aciklama: 'TEST',
  miktar: 1, matrah: 100, kdvOrani: 10, kdvTutari: 10, toplam: 110,
}, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
const seriKalibi = /<cbc:ID>[A-Z]{3}\d{4}\d{9}<\/cbc:ID>/;
ok('onizleme UBL icinde GERCEK seri numarasi YOK', !seriKalibi.test(onizlemeXml),
  'numarali fatura eLogoda iptal edilemez');
ok('onizlemede fatura no yer tutucu', onizlemeXml.includes('<cbc:ID>ONIZLEME</cbc:ID>'));

// ---------- 8) TARIH/SAAT: ISTANBUL'A SABIT ----------
// KULLANICI BULGUSU 2026-08-20: onizlemede "20-08-2026 03:00:00" ciktiydi. Kok neden,
//   Prisma'nin UTC gece yarisi verdigi tarihi YEREL getHours() ile okumakti (+3 kayma).
//   Bicimlendirme artik acikca Europe/Istanbul; sunucu TZ'i degisse bile ayni cikmali.
const t1 = new Date('2026-08-20T12:50:27Z'); // Istanbul: 15:50:27
const bic = ElogoFaturaService.tarihSaatTR(t1);
ok('tarih Istanbul gununu verir', bic.tarih === '2026-08-20', `olan: ${bic.tarih}`);
ok('saat Istanbul saatini verir', bic.saat === '15:50:27', `olan: ${bic.saat}`);
const t2 = new Date('2026-08-19T21:30:00Z'); // Istanbul: ertesi gun 00:30
const bic2 = ElogoFaturaService.tarihSaatTR(t2);
ok('gece yarisi gecisi dogru', bic2.tarih === '2026-08-20' && bic2.saat === '00:30:00',
  `olan: ${bic2.tarih} ${bic2.saat}`);
const xmlSaat = svc.ublOlustur({
  saticiVkn: '1', saticiUnvan: 'A', saticiAdres: 'x', saticiIlce: '', saticiIl: '',
  aliciVkn: '2', aliciUnvan: 'B', aliciAdres: 'y', aliciIlce: '', aliciIl: '',
  faturaNo: 'ONIZLEME', faturaTarihi: t1, aciklama: 'T',
  miktar: 1, matrah: 100, kdvOrani: 10, kdvTutari: 10, toplam: 110,
}, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
ok('UBL IssueTime gercek saati tasir', xmlSaat.includes('<cbc:IssueTime>15:50:27</cbc:IssueTime>'));
ok('UBL saati 03:00 DEGIL (eski hata)', !xmlSaat.includes('<cbc:IssueTime>03:00:00</cbc:IssueTime>'));

// ---------- 9) ADRESTEN ILCE/IL ----------
const adresler = [
  ['KARAAGAC MAH. HADIMKOY ISTANBUL CAD. NO 38/4 BUYUKCEKMECE / ISTANBUL', 'BUYUKCEKMECE', 'ISTANBUL'],
  ['OMERLI MAH. ADNAN KAHVECI CAD. NO: 1 /1 ARNAVUTKOY/ ISTANBUL', 'ARNAVUTKOY', 'ISTANBUL'],
  ['OMERLI MAH. ADNAN KAHVECI CAD. 1 /1 1 ARNAVUTKOY 34', '', ''],  // cikarilamaz -> BOS, uydurulmaz
];
for (const [adres, ilce, il] of adresler) {
  const r = ElogoFaturaService.adresParcala(adres);
  ok(`adres ayristirma: "${adres.slice(-28)}"`, r.ilce === ilce && r.il === il,
    `olan: ilce=${r.ilce} il=${r.il}`);
}
// Cikarilamayan adres icin IL UYDURULMAMALI (eski kod alici icin 'ISTANBUL' varsayiyordu)
ok('bilinmeyen il varsayilan ISTANBUL DEGIL', ElogoFaturaService.adresParcala('BILINMEYEN ADRES').il === '');

// ---------- 11) TARAF BILGISI KENDI FATURASINDAN OKUNUR ----------
// KULLANICI SORUSU 2026-08-20: "eLogo kullanan her firma icin sana bilgi mi verecegim?"
//   HAYIR — mukellefin kendi giden faturasinin UBL'i veritabaninda duruyor, satici blogu
//   oradan AYNEN okunur. Bu test okuyucuyu kilitler.
// Sablon GITO'nun GERCEK faturasindaki alan sirasiyla ayni (AAA2026000000048).
const ORNEK_UBL = [
  '<Invoice>',
  '  <cac:AccountingSupplierParty>',
  '    <cac:Party>',
  '      <cbc:WebsiteURI />',
  '      <cac:PartyIdentification><cbc:ID schemeID="VKN">3961368714</cbc:ID></cac:PartyIdentification>',
  '      <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0396136871400001</cbc:ID></cac:PartyIdentification>',
  '      <cac:PartyName><cbc:Name>GİTO GIDA İNŞAAT TİCARET LİMİTED ŞİRKETİ</cbc:Name></cac:PartyName>',
  '      <cac:PostalAddress>',
  '        <cbc:Room />',
  '        <cbc:StreetName>ÖMERLİ MAH. ADNAN KAHVECİ CAD. NO: 1 /1 İÇ KAPI NO: 1 ARNAVUTKÖY/ İSTANBUL</cbc:StreetName>',
  '        <cbc:BuildingNumber />',
  '        <cbc:CitySubdivisionName>ARNAVUTKÖY</cbc:CitySubdivisionName>',
  '        <cbc:CityName>İSTANBUL</cbc:CityName>',
  '        <cbc:PostalZone>34000</cbc:PostalZone>',
  '        <cac:Country><cbc:IdentificationCode>TR</cbc:IdentificationCode><cbc:Name>Türkiye</cbc:Name></cac:Country>',
  '      </cac:PostalAddress>',
  '      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>BÜYÜKÇEKMECE VERGİ DAİRESİ</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>',
  '      <cac:Contact><cbc:Telephone>90 (534) 337-6764</cbc:Telephone><cbc:Telefax /></cac:Contact>',
  '    </cac:Party>',
  '  </cac:AccountingSupplierParty>',
  '  <cac:AccountingCustomerParty>',
  '    <cac:Party>',
  '      <cac:PartyIdentification><cbc:ID schemeID="VKN">7601043666</cbc:ID></cac:PartyIdentification>',
  '      <cac:PartyName><cbc:Name>SELİM İNŞAAT GIDA SANAYİ VE TİCARET ANONİM ŞİRKETİ</cbc:Name></cac:PartyName>',
  '      <cac:PostalAddress>',
  '        <cbc:StreetName>KARAAĞAÇ MAH. HADIMKÖY İSTANBUL CAD. NO 38/4 BÜYÜKÇEKMECE / İSTANBUL</cbc:StreetName>',
  '        <cbc:CitySubdivisionName>BÜYÜKÇEKMECE</cbc:CitySubdivisionName>',
  '        <cbc:CityName>İSTANBUL</cbc:CityName>',
  '        <cbc:PostalZone />',
  '      </cac:PostalAddress>',
  '      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>BÜYÜKÇEKMECE</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>',
  '    </cac:Party>',
  '  </cac:AccountingCustomerParty>',
  '</Invoice>',
].join(String.fromCharCode(10));

const sat = ElogoFaturaService.ublTarafOku(ORNEK_UBL, 'AccountingSupplierParty');
ok('satici blogu okundu', !!sat);
if (sat) {
  ok('satici VKN', sat.vkn === '3961368714', 'olan: ' + sat.vkn);
  ok('satici MERSIS', sat.mersis === '0396136871400001', 'olan: ' + sat.mersis);
  ok('satici adres tam', sat.adres.includes('İÇ KAPI NO: 1') && sat.adres.endsWith('İSTANBUL'), 'olan: ' + sat.adres);
  ok('satici ilce/il', sat.ilce === 'ARNAVUTKÖY' && sat.il === 'İSTANBUL', `olan: ${sat.ilce}/${sat.il}`);
  ok('satici posta kodu', sat.postaKodu === '34000', 'olan: ' + sat.postaKodu);
  ok('satici vergi dairesi', sat.vergiDairesi === 'BÜYÜKÇEKMECE VERGİ DAİRESİ', 'olan: ' + sat.vergiDairesi);
  ok('satici telefon', sat.telefon === '90 (534) 337-6764', 'olan: ' + sat.telefon);
  ok('unvan Country adiyla karismaz', sat.unvan.startsWith('GİTO'), 'olan: ' + sat.unvan);
  ok('kendi kendini kapatan etiket bos okunur', ElogoFaturaService.ublTarafOku(ORNEK_UBL, 'AccountingCustomerParty').postaKodu === '');
}
const alc = ElogoFaturaService.ublTarafOku(ORNEK_UBL, 'AccountingCustomerParty');
ok('alici blogu satici ile karismaz', !!alc && alc.vkn === '7601043666' && alc.ilce === 'BÜYÜKÇEKMECE',
  alc ? `olan: ${alc.vkn}/${alc.ilce}` : 'okunamadi');
ok('taraf yoksa null doner', ElogoFaturaService.ublTarafOku('<Invoice></Invoice>', 'AccountingSupplierParty') === null);

// ---------- 12) YENI ALANLAR UBL'E YAZILIYOR ----------
const xmlYeni = svc.ublOlustur({
  saticiVkn: '3961368714', saticiUnvan: 'GİTO', saticiAdres: 'adres', saticiIlce: 'ARNAVUTKÖY', saticiIl: 'İSTANBUL',
  saticiTel: '90 (534) 337-6764', saticiPostaKodu: '34000', saticiMersis: '0396136871400001',
  saticiVergiDairesi: 'BÜYÜKÇEKMECE VERGİ DAİRESİ',
  aliciVkn: '7601043666', aliciUnvan: 'SELİM', aliciAdres: 'x', aliciIlce: 'BÜYÜKÇEKMECE', aliciIl: 'İSTANBUL',
  faturaNo: 'ONIZLEME', faturaTarihi: new Date('2026-08-20T10:00:00'), aciklama: 'T',
  miktar: 1, matrah: 100, kdvOrani: 10, kdvTutari: 10, toplam: 110,
}, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
ok('MERSIS UBL e yazildi', xmlYeni.includes('<cbc:ID schemeID="MERSISNO">0396136871400001</cbc:ID>'));
ok('posta kodu UBL e yazildi', xmlYeni.includes('<cbc:PostalZone>34000</cbc:PostalZone>'));
ok('satici vergi dairesi UBL e yazildi', xmlYeni.includes('<cbc:Name>BÜYÜKÇEKMECE VERGİ DAİRESİ</cbc:Name>'));
const xmlEksik = svc.ublOlustur({
  saticiVkn: '1', saticiUnvan: 'A', saticiAdres: 'x', saticiIlce: '', saticiIl: '',
  aliciVkn: '2', aliciUnvan: 'B', aliciAdres: 'y',
  faturaNo: 'ONIZLEME', faturaTarihi: new Date('2026-08-20T10:00:00'), aciklama: 'T',
  miktar: 1, matrah: 100, kdvOrani: 10, kdvTutari: 10, toplam: 110,
}, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
ok('MERSIS yoksa etiket HIC yazilmaz', !xmlEksik.includes('MERSISNO'));
ok('posta kodu yoksa etiket HIC yazilmaz', !xmlEksik.includes('PostalZone'));
ok('eksik surumde de XML iyi bicimli', !iyiBicimli(xmlEksik));

// ---------- 10) SUNUCU SAAT DILIMINDEN BAGIMSIZLIK ----------
// TESTIN KENDI TUZAGI: bu makine zaten Europe/Istanbul oldugu icin ESKI (yerel getter'li)
//   kod da 15:50:27 uretirdi ve test bosuna gecerdi. Bu yuzden ayni dosya bir de TZ=UTC
//   ile calistirilir; bicimlendirme Istanbul'a sabit degilse orada CAKAR.
if (!process.env.ELOGO_TZ_TEST) {
  const { spawnSync } = require('child_process');
  const alt = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TZ: 'UTC', ELOGO_TZ_TEST: '1' }, stdio: 'pipe', encoding: 'utf8',
  });
  if (alt.status !== 0) {
    console.error('  ✗ TZ=UTC altinda CAKTI — tarih/saat sunucu saat dilimine bagli kalmis');
    for (const l of (alt.stdout || '').split(/\r?\n/)) if (l.includes('✗')) console.error(l);
    hata++;
  } else console.log('  ✓ TZ=UTC altinda da ayni sonuc (saat dilimi bagimsiz)');
}

if (hata) process.exit(1);
console.log('[elogo-ubl-regression] OK: UBL bicimi, sozlesme sabitleri ve aritmetik kilitli');
