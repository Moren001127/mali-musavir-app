#!/usr/bin/env node
/**
 * eLOGO PORTAL API sozlesme regresyonu.
 *
 * KAYNAK: 2026-08-20 tarihinde GITO hesabiyla CANLI yakalanan istekler
 * (efatura-apigateway-g.elogo.com.tr). Alan adlari oradan alindi, uydurulmadi.
 *
 * NEDEN GEREKLI:
 *  1) Gövdede FATURA NUMARASI alani BULUNMAMALI. Kullanici kurali: eLogo'da numara
 *     verilmis fatura iptal/silme kabul etmiyor; numara yalniz onay aninda verilir.
 *  2) Numara veren / gonderen uclar bu servise ASLA eklenmemeli. Yanlislikla eklenirse
 *     gercek fatura firmaya gider ve geri alinamaz.
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

const DOSYA = path.join(ROOT, 'apps/api/src/fatura-kes/elogo-portal.service.ts');
const { ElogoPortalService } = require(DOSYA);

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

// ---------- 1) GOVDE: canli istekten alinan alanlar ----------
const govde = ElogoPortalService.payloadOlustur({
  uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
  faturaTarihi: '2026-08-20 19:30:00',
  onEk: 'AAA',
  tasarimId: 452794,
  aliciId: 12019325,
  aliciVkn: '7601043666',
  aliciUnvan: 'SELIM INSAAT GIDA SANAYI VE TICARET ANONIM SIRKETI',
  aliciEtiket: 'urn:mail:defaultpk@seliminsaat.com.tr',
  aciklama: 'YEMEK BEDELI',
  miktar: 1,
  birimKodu: 'NIU',
  birimFiyat: 68000,
  matrah: 68000,
  kdvOrani: 10,
  kdvTutari: 6800,
  toplam: 74800,
  yaziyla: 'YetmisDortBinSekizYuz TL',
  ticariMi: true,
});

const sabitler = [
  ['yeni taslak id=0', govde.id === 0],
  ['ETTN gonderiliyor', govde.Uuid === 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'],
  ['tarih "YYYY-MM-DD HH:mm:ss"', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(govde.IssueDate)],
  ['on ek AAA', govde.InvoicePrefix === 'AAA'],
  ['para birimi TRY', govde.CurrencyUnit === 'TRY'],
  ['belge tipi SATIS', govde.DocumentTypeCode === 'SATIS'],
  ['ticari faturada profil TICARIFATURA', govde.ProfileId === 'TICARIFATURA'],
  ['odenecek tutar', govde.RequiredPayment === 74800],
  ['alici VKN', govde.Customer.VknTckn === '7601043666'],
  ['alici etiketi PK', govde.Customer.Alias.indexOf('defaultpk') > 0],
  ['tek kalem', govde.UserInvoiceProductsAndServicesList.length === 1],
  ['kalem birim kodu NIU', govde.UserInvoiceProductsAndServicesList[0].UnitCode === 'NIU'],
  ['kalem KDV orani', govde.UserInvoiceProductsAndServicesList[0].KDV_GERCEK_Orani === 10],
  ['kalem KDV tutari', govde.UserInvoiceProductsAndServicesList[0].KDV_GERCEK_Tutari === 6800],
  ['SendType 0 (gonderim YOK)', govde.SendType === 0],
];
for (const [ad, sart] of sabitler) ok(ad, sart);

const temel = ElogoPortalService.payloadOlustur({
  uuid: 'X', faturaTarihi: '2026-08-20 10:00:00', onEk: 'AAA', tasarimId: 1, aliciId: 1,
  aliciVkn: '1', aliciUnvan: 'A', aliciEtiket: 'urn:mail:x', aciklama: 'T', miktar: 1,
  birimKodu: 'NIU', birimFiyat: 1, matrah: 1, kdvOrani: 20, kdvTutari: 0.2, toplam: 1.2,
  yaziyla: 'Bir TL Yirmi kurus', ticariMi: false,
});
ok('temel faturada profil TEMELFATURA', temel.ProfileId === 'TEMELFATURA', 'olan: ' + temel.ProfileId);

// ---------- 2) NUMARA ALANI OLMAMALI ----------
const duz = JSON.stringify(govde);
const numaraAlanlari = ['ElementId', 'InvoiceNumber', 'FaturaNo', 'DocumentNumber', 'ElementID'];
for (const alan of numaraAlanlari) {
  ok(`govdede "${alan}" YOK`, duz.indexOf('"' + alan + '"') < 0,
    'numara verilmis fatura eLogo da iptal edilemez');
}
ok('govdede gercek seri numarasi yok', !/[A-Z]{3}\d{13}/.test(duz));

// ---------- 3) TEHLIKELI UCLAR SERVISTE OLMAMALI ----------
const kaynak = fs.readFileSync(DOSYA, 'utf8');
// Yorum satirlari haric gercek kod aranir (uclarin adlari basligta ACIKLAMA olarak geciyor).
const kodSatirlari = kaynak.split(/\r?\n/).filter((s) => {
  const t = s.trim();
  return t && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
}).join('\n');
const yasakli = ['CreateElementId', 'SendUserInvoice', 'CreateAndSendInvoice', 'ConfirmSmsUserInvoice', 'SendSmsIVD', 'ControlAndGenerateElementId'];
for (const uc of yasakli) {
  ok(`KODDA "${uc}" cagrisi YOK`, kodSatirlari.indexOf(uc) < 0,
    'bu uc gercek fatura gonderir/numara verir — kullanici onayi olmadan eklenemez');
}

// ---------- 4) UCLAR DOGRU YOLLARDA ----------
for (const [ad, yol] of [
  ['kaydet', '/InvoiceCreation/SaveUserInvoice'],
  ['liste', '/InvoiceCreation/ListInvoiceCreation'],
  ['oku', '/InvoiceCreation/GetInvoiceCreation'],
  ['sil', '/InvoiceCreation/DeleteInvoiceCreation'],
  ['goruntu', '/DocumentView/GetDocument'],
  ['alici sorgu', '/Tools/GetGIBUserList'],
]) ok(`${ad} ucu: ${yol}`, kaynak.indexOf(yol) > 0);
ok('ag gecidi adresi', ElogoPortalService.GATEWAY === 'https://efatura-apigateway-g.elogo.com.tr');

// ---------- 5) JETON YOKSA ACIK HATA ----------
const svc = new ElogoPortalService({
  integrationConnection: { findFirst: async () => ({ config: { taxpayers: {} } }) },
});
svc.taslakKaydet('t', 'm', govde).then(
  () => { console.error('  ✗ jeton yokken hata firlatmadi'); hata++; bitir(); },
  (e) => {
    ok('jeton yoksa acik hata', String(e.message).indexOf('portal jetonu') >= 0, 'olan: ' + e.message);
    bitir();
  },
);

function bitir() {
  if (hata) process.exit(1);
  console.log('[elogo-portal-regression] OK: govde sozlesmesi kilitli, numara/gonderim uclari yok');
}
