#!/usr/bin/env node
/**
 * MÜKELLEF FAALİYET TANIMI regresyonu — PLAN/16 §F (Fatura Merkezi > Mükellefler listesi).
 *   apps/api/src/taxpayers/mukellef-faaliyet.ts (saf: PATCH doğrulama, AI istem/cevap çözme, belge özeti)
 *   apps/api/src/fatura-muhasebelestirme/mukellef-bilgi.ts (saf: motor beslemesi metni + select)
 *   packages/shared (KURUM_TURU_ETIKETLERI, TaxpayerFaaliyetSchema, Create/Update şemalarında kurumTuru + sektorEtiketi)
 *
 * Kilitler:
 *   1) mukellefFaaliyetMetni: tüm alanlar dolu → "ÜNVAN — NACE … · faaliyet: … · sektör: … · kurum: … · defter: …";
 *      boş alanlar atlanır; hiç bilgi yoksa yalnız ünvan; gerçek kişi ad-soyad; defter Mihsap'tan türetilir; select nesnesi tam.
 *   2) faaliyetPatchDogrula: '' → null; kurumTuru geçersiz → hata; defterTuru küçük harf → BILANCO; NACE biçimi;
 *      bilinmeyen alan (.strict) → hata; boş gövde → hata; yalnız gönderilen alanlar döner.
 *   3) Zod Create/Update: kurumTuru enum kabul/ret; sektorEtiketi 60 sınırı; Update .strict() alanı tanır (form kaydedilebilir).
 *   4) AI cevabı çözme: JSON kod bloğu, 'diger' yerine null, geçersiz kurum → null, guven normalize, NACE temizleme.
 *   5) Belge özeti ≤ 2000 karakter; S/A yönü; boş belgeler atlanır. İstem 'diger' YAZMA kuralını taşır.
 *   6) Kaynak kilitleri: controller PATCH :id/faaliyet + POST :id/faaliyet-oner + GET faaliyet-secenekler (':id'den ÖNCE);
 *      findAll select sektorEtiketi/kurumTuru; schema.prisma sektorEtiketi; migration dosyası.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const mb = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/mukellef-bilgi.ts'));
const mf = require(path.join(ROOT, 'apps/api/src/taxpayers/mukellef-faaliyet.ts'));
const shared = require(path.join(ROOT, 'packages/shared/src/index.ts'));

let failed = 0;
function assert(ok, msg) { if (!ok) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

console.log('1) mukellefFaaliyetMetni');
{
  const tam = mb.mukellefFaaliyetMetni({
    companyName: 'ÖRNEK GIDA LTD', naceKodu: '56.10.06', faaliyetAciklama: 'yemek üretimi',
    sektorEtiketi: 'gıda', kurumTuru: 'kamu', defterTuru: 'BILANCO',
  });
  assert(tam === 'ÖRNEK GIDA LTD — NACE 56.10.06 · faaliyet: yemek üretimi · sektör: gıda · kurum: Kamu kurumu · defter: bilanço', `tam metin: ${tam}`);
  const kismi = mb.mukellefFaaliyetMetni({ companyName: 'A A.Ş.', faaliyetAciklama: 'nakliye', defterTuru: 'ISLETME' });
  assert(kismi === 'A A.Ş. — faaliyet: nakliye · defter: işletme', `boş alanlar atlanır: ${kismi}`);
  assert(mb.mukellefFaaliyetMetni({ companyName: 'Boş Ltd' }) === 'Boş Ltd', 'hiç bilgi yoksa yalnız ünvan');
  assert(mb.mukellefFaaliyetMetni(null) === '', 'null → boş');
  const gercek = mb.mukellefFaaliyetMetni({ firstName: 'Ayşe', lastName: 'Yılmaz', mihsapDefterTuru: 'DEFTER_BEYAN' });
  assert(gercek === 'Ayşe Yılmaz — defter: işletme', `gerçek kişi + Mihsap defter türetme: ${gercek}`);
  assert(mb.mukellefFaaliyetMetni({ companyName: 'X', kurumTuru: 'uydurma' }) === 'X', 'geçersiz kurum türü yazılmaz');
  assert(mb.mukellefFaaliyetMetni({ companyName: 'Y', defterTuru: 'ISLETME', mihsapDefterTuru: 'BASIT' }).endsWith('defter: basit usul'), 'basit usul');
  for (const k of ['companyName', 'firstName', 'lastName', 'naceKodu', 'faaliyetAciklama', 'sektorEtiketi', 'kurumTuru', 'defterTuru', 'mihsapDefterTuru']) {
    assert(mb.mukellefBilgiSelect[k] === true, `mukellefBilgiSelect.${k}`);
  }
}

console.log('2) faaliyetPatchDogrula (PATCH taxpayers/:id/faaliyet)');
{
  const r1 = mf.faaliyetPatchDogrula({ naceKodu: ' 56.10.06 ', faaliyetAciklama: '', sektorEtiketi: 'Gıda', kurumTuru: 'KAMU', defterTuru: 'bilanco' });
  assert(r1.ok === true, 'geçerli gövde kabul');
  assert(r1.ok && r1.data.naceKodu === '56.10.06', 'NACE trim');
  assert(r1.ok && r1.data.faaliyetAciklama === null, "'' → null (temizle)");
  assert(r1.ok && r1.data.kurumTuru === 'kamu', 'kurumTuru küçük harfe çevrilir');
  assert(r1.ok && r1.data.defterTuru === 'BILANCO', 'defterTuru büyük harfe çevrilir');
  assert(r1.ok && r1.degisenAlanlar.join(',') === 'naceKodu,faaliyetAciklama,sektorEtiketi,kurumTuru,defterTuru', 'değişen alanlar sırayla');
  const r2 = mf.faaliyetPatchDogrula({ sektorEtiketi: 'inşaat' });
  assert(r2.ok && Object.keys(r2.data).join(',') === 'sektorEtiketi', 'yalnız gönderilen alan döner (diğerleri undefined = dokunma)');
  const r3 = mf.faaliyetPatchDogrula({ kurumTuru: 'holding' });
  assert(r3.ok === false && /kurumTuru/.test(r3.hatalar.join(' ')), 'geçersiz kurumTuru reddedilir');
  const r4 = mf.faaliyetPatchDogrula({ defterTuru: 'BASIT' });
  assert(r4.ok === false, 'defterTuru yalnız BILANCO|ISLETME');
  const r5 = mf.faaliyetPatchDogrula({ naceKodu: '56-10' });
  assert(r5.ok === false && /NACE/.test(r5.hatalar.join(' ')), 'NACE biçimi 56.10.06');
  assert(mf.faaliyetPatchDogrula({ naceKodu: '56' }).ok === true, 'NACE 2 hane kabul');
  assert(mf.faaliyetPatchDogrula({ naceKodu: '56.10' }).ok === true, 'NACE 4 hane kabul');
  const r6 = mf.faaliyetPatchDogrula({ companyName: 'X' });
  assert(r6.ok === false, 'bilinmeyen alan (.strict) reddedilir');
  assert(mf.faaliyetPatchDogrula({}).ok === false, 'boş gövde reddedilir');
  assert(mf.faaliyetPatchDogrula({ sektorEtiketi: 'x'.repeat(61) }).ok === false, 'sektorEtiketi > 60 reddedilir');
  assert(mf.faaliyetPatchDogrula({ kurumTuru: null }).ok === true && mf.faaliyetPatchDogrula({ kurumTuru: null }).data.kurumTuru === null, 'kurumTuru null = bilinmiyor');
  assert(mf.faaliyetPatchDogrula({ kurumTuru: 'kdv_mukellefi_degil' }).ok === true, 'kdv_mukellefi_degil kabul');
}

console.log('3) Zod Create/Update şemaları + etiketler');
{
  const { CreateTaxpayerSchema, UpdateTaxpayerSchema, KURUM_TURU_ETIKETLERI, KURUM_TURU_KODLARI, kurumTuruEtiketi } = shared;
  const taban = { type: 'TUZEL_KISI', companyName: 'Örnek Ltd', taxNumber: '1234567890', taxOffice: 'Kadıköy' };
  assert(CreateTaxpayerSchema.safeParse({ ...taban, kurumTuru: 'belediye', sektorEtiketi: 'gıda' }).success, 'Create: kurumTuru+sektorEtiketi kabul');
  assert(CreateTaxpayerSchema.safeParse({ ...taban, kurumTuru: 'x' }).success === false, 'Create: geçersiz kurumTuru ret');
  assert(UpdateTaxpayerSchema.safeParse({ kurumTuru: 'kit', sektorEtiketi: '' }).success, "Update (.strict): kurumTuru + '' sektorEtiketi kabul → form kaydedilebilir");
  assert(UpdateTaxpayerSchema.safeParse({ kurumTuru: null }).success, 'Update: kurumTuru null kabul');
  assert(UpdateTaxpayerSchema.safeParse({ kurumTuru: 'diger2' }).success === false, 'Update: geçersiz kurumTuru ret');
  assert(UpdateTaxpayerSchema.safeParse({ sektorEtiketi: 'a'.repeat(61) }).success === false, 'Update: sektorEtiketi 61 ret');
  assert(KURUM_TURU_KODLARI.length === 8 && KURUM_TURU_KODLARI.includes('belirlenmis_diger'), '8 kurum türü kodu');
  assert(KURUM_TURU_ETIKETLERI.kamu === 'Kamu kurumu' && KURUM_TURU_ETIKETLERI.kdv_mukellefi_degil === 'KDV mükellefi değil', 'etiketler Türkçe');
  assert(kurumTuruEtiketi('BELEDIYE') === 'Belediye' && kurumTuruEtiketi('yok') === null, 'kurumTuruEtiketi büyük/küçük harf + bilinmeyen null');
  // API tarafındaki liste ile birebir aynı mı (tevkifat-kurallari.KURUM_TURLERI)?
  const tk = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/tevkifat-kurallari.ts'));
  assert(JSON.stringify([...tk.KURUM_TURLERI].sort()) === JSON.stringify([...KURUM_TURU_KODLARI].sort()), 'shared KURUM_TURU_KODLARI == api KURUM_TURLERI');
}

console.log('4) AI cevabı çözme');
{
  const c1 = mf.faaliyetOnerCevabiCoz('```json\n{"naceKodu":"56.10.06","naceAdi":"Lokantalar","faaliyetAciklama":"yemek üretimi","sektorEtiketi":"GIDA","kurumTuru":"diger","guven":"yuksek","gerekce":"satış faturaları yemek"}\n```');
  assert(c1 && c1.naceKodu === '56.10.06' && c1.kurumTuru === 'diger' && c1.guven === 'yuksek', 'kod bloklu JSON çözülür');
  assert(c1 && c1.sektorEtiketi === 'gıda', 'sektör etiketi Türkçe küçük harf (GIDA → gıda)');
  const c2 = mf.faaliyetOnerCevabiCoz('Öneri: {"naceKodu":"NACE 41.20.01","kurumTuru":"holding","guven":"emin","gerekce":""}');
  assert(c2 && c2.naceKodu === '41.20.01', 'NACE içindeki harfler temizlenir');
  assert(c2 && c2.kurumTuru === null, 'geçersiz kurum türü → null (diger DEĞİL)');
  assert(c2 && c2.guven === 'dusuk', 'bilinmeyen güven → dusuk');
  const c3 = mf.faaliyetOnerCevabiCoz('{"naceKodu":"abc","kurumTuru":null,"guven":"orta"}');
  assert(c3 && c3.naceKodu === null && c3.kurumTuru === null && c3.guven === 'orta', 'bozuk NACE → null; kurum null korunur');
  assert(mf.faaliyetOnerCevabiCoz('cevap yok') === null, 'JSON yoksa null');
  assert(mf.faaliyetOnerCevabiCoz('{bozuk json') === null, 'bozuk JSON → null');
}

console.log('5) Belge özeti + istem');
{
  const belgeler = [];
  for (let i = 0; i < 40; i++) {
    belgeler.push({ invoiceKind: i % 2 ? 'SATIS' : 'ALIS', vendorName: `Satıcı ${i} Uzun Ünvan Anonim Şirketi`, customerName: `Müşteri ${i}`, faturaTarihi: new Date('2026-08-05T00:00:00Z'), ocrData: { kalemler: [{ ad: 'Un 50 kg' }, { ad: 'Şeker' }, { ad: 'Yağ' }, { ad: 'Tuz' }] } });
  }
  const ozet = mf.faaliyetBelgeOzeti(belgeler, 2000);
  assert(ozet.length <= 2000, `özet ≤ 2000 karakter (${ozet.length})`);
  assert(/^A · 2026-08-05 · Satıcı 0 Uzun Ünvan Anonim Şirketi — Un 50 kg; Şeker; Yağ$/m.test(ozet), 'alış satırı: A · tarih · satıcı — 3 kalem');
  assert(/^S · 2026-08-05 · Müşteri 1 — /m.test(ozet), 'satış satırı müşteri ünvanı');
  assert(mf.faaliyetBelgeOzeti([{ invoiceKind: 'ALIS', vendorName: '', ocrData: {} }]) === '', 'boş belge atlanır');
  const istem = mf.faaliyetOnerIstemi({ unvan: 'ANKARA BÜYÜKŞEHİR BELEDİYESİ', belgeOzeti: ozet, unvanKurumIpucu: 'belediye', naceKodu: '84.11.01' });
  assert(/BELİRSİZSE null yaz \("diger" YAZMA\)/.test(istem), "istem: belirsizse null ('diger' yazma)");
  assert(/ÜNVAN İPUCU .*belediye/.test(istem) && /NACE: 84\.11\.01/.test(istem), 'istem ünvan ipucu + mevcut tanımı taşır');
  assert(/Sadece JSON döndür/.test(istem), 'istem yalnız JSON ister');
}

console.log('6) Kaynak kilitleri');
{
  const ctrl = fs.readFileSync(path.join(ROOT, 'apps/api/src/taxpayers/taxpayers.controller.ts'), 'utf8');
  assert(/@Patch\(':id\/faaliyet'\)/.test(ctrl), "controller: @Patch(':id/faaliyet')");
  assert(/@Post\(':id\/faaliyet-oner'\)/.test(ctrl), "controller: @Post(':id/faaliyet-oner')");
  const secenekIdx = ctrl.indexOf("@Get('faaliyet-secenekler')");
  const idIdx = ctrl.indexOf("@Get(':id')");
  assert(secenekIdx > 0 && idIdx > 0 && secenekIdx < idIdx, "controller: @Get('faaliyet-secenekler') @Get(':id')'den ÖNCE");
  assert(/@Patch\(':id\/faaliyet'\)\s*\n\s*@Roles\('ADMIN', 'STAFF'\)/.test(ctrl), 'PATCH faaliyet rol koruması ADMIN|STAFF');
  const svc = fs.readFileSync(path.join(ROOT, 'apps/api/src/taxpayers/taxpayers.service.ts'), 'utf8');
  assert(/sektorEtiketi: true,\s*\n\s*kurumTuru: true,/.test(svc), 'findAll select: sektorEtiketi + kurumTuru');
  assert(/action: 'FAALIYET_GUNCELLE'/.test(svc), 'updateFaaliyet AuditLog yazar');
  assert(/claudeTextViaMax\(\{ prompt, model: MAX_MODEL_CHEAP/.test(svc), 'faaliyetOner yalnız Max yolunu kullanır (ücretli API yok)');
  assert(!/ANTHROPIC_API_KEY/.test(svc), 'taxpayers.service ANTHROPIC_API_KEY kullanmaz');
  const prisma = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert(/sektorEtiketi\s+String\?/.test(prisma), 'schema.prisma: Taxpayer.sektorEtiketi String?');
  assert(fs.existsSync(path.join(ROOT, 'apps/api/prisma/migrations/20260912_sektor_etiketi/migration.sql')), 'migration 20260912_sektor_etiketi var');
}

if (failed) { console.error(`\n${failed} kilit BAŞARISIZ`); process.exit(1); }
console.log('\nmukellef-faaliyet-regression: tüm kilitler geçti');
