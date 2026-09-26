#!/usr/bin/env node
/**
 * GECE ÇEKİM ANAHTARI regresyonu — PLAN/16 §H (HAZIR ama VARSAYILAN KAPALI).
 *   apps/api/src/fatura-muhasebelestirme/gece-cekim.ts (saf kurallar)
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.cron.ts (saatlik tik, env anahtarı, AuditLog GECE_CEKIM)
 *   fatura-muhasebelestirme.service.ts setIntegrationTalimat / listIntegrations (saat + 'global' reddi)
 *   efatura-sync.service.ts syncAll({ only }) (inbox senkronu yalnız talimatlılar için)
 *   ekip/koordinator.service.ts (sabah özeti "gece çekimi: N belge geldi (X mükellef, Y hata)")
 *
 * Kullanıcı kararları (bağlayıcı, 2026-09-12): gece çekimi VARSAYILAN KAPALI; "hepsini aç/kapat" YOK;
 * 'global' anahtarıyla açılamaz; saat 00:00–06:59, varsayılan 02:00; NIGHTLY_EFATURA=off her şeyi kapatır.
 *
 * Kilitler:
 *   1) geceSaatiNormalize/Gecerli: '02:00' ok, '2:5' → '02:05', '07:00' ret, '23:59' ret, 'abc' ret, '' → null.
 *   2) geceSaatiUyuyorMu(saat, now): now Date (Istanbul saatine çevrilir) ya da doğrudan saat; saat yoksa 02:00; dakika yok sayılır.
 *   3) geceCekimEnvKapaliMi: off|0|false|kapali|KAPALI → kapalı; tanımsız/on/1 → açık.
 *   4) geceTalimatGirdisiDogrula: global+aç → HATA; global+kapat ok; saat yoksa 02:00; geçersiz saat HATA; provider büyük harf.
 *   5) gecePlaniOlustur: talimat!==true elenir; 'global' elenir; isActive=false elenir; saat eşleşmeyen elenir; bozuk saat → 02:00 varsayılan.
 *   6) İptal/red beklemesi (2026-09-26): son 10 gün alınmaz — 26.09 → 01.09–16.09 (geceSonTarih); dönemler son tarihten:
 *      1 Ekim → ['2026-09']; 11 Ekim → ['2026-09','2026-10']; son tarih ayın ≤15'i ise önceki ay da.
 *   7) geceOzetSatiri: kayıt yok → "çalışmadı"; kayıtlar → "N belge geldi (X mükellef, Y hata)".
 *   8) Servis (mock prisma): setIntegrationTalimat global+aç → BadRequest; mükellef+aç+saat '03:00' config'e yazılır; kapatma saati korur;
 *      listIntegrations çıktısında talimat/saat (global anahtarında talimat hep false).
 *   9) Kaynak kilitleri: cron GECE_CRON_IFADESI ('0 5 0-6 * * *') + env kapısı + GECE_CEKIM AuditLog; eski '0 15 3' yok;
 *      controller'da "hepsini aç" ucu yok; syncAll 'only' süzgeci; koordinatör geceOzetSatiri kullanır; env kapalıyken gönderim kodu değişmedi.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const gc = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/gece-cekim.ts'));

let failed = 0;
function assert(ok, msg) { if (!ok) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }
function throwsWith(fn, re) { try { fn(); return false; } catch (e) { return re.test(String(e && e.message || e)); } }

console.log('1) saat normalize');
{
  assert(gc.GECE_VARSAYILAN_SAAT === '02:00', 'varsayılan 02:00');
  assert(gc.geceSaatiNormalize('02:00') === '02:00', "'02:00' ok");
  assert(gc.geceSaatiNormalize('2:5') === '02:05', "'2:5' → '02:05'");
  assert(gc.geceSaatiNormalize(' 06:59 ') === '06:59', "'06:59' ok (üst sınır)");
  assert(gc.geceSaatiNormalize('07:00') === null, "'07:00' ret (pencere 00–06)");
  assert(gc.geceSaatiNormalize('23:59') === null, "'23:59' ret");
  assert(gc.geceSaatiNormalize('abc') === null && gc.geceSaatiNormalize('') === null && gc.geceSaatiNormalize(null) === null, 'bozuk/boş → null');
  assert(gc.geceSaatiNormalize('02:60') === null, 'dakika 60 ret');
  assert(gc.geceSaatiGecerliMi('04:30') && !gc.geceSaatiGecerliMi('12:00'), 'geceSaatiGecerliMi');
}

console.log('2) saat eşleme (Istanbul = UTC+3, yaz/kış değişmez)');
{
  const iki05 = new Date('2026-09-12T23:05:00Z'); // 02:05 İstanbul
  const dort05 = new Date('2026-09-13T01:05:00Z'); // 04:05 İstanbul
  assert(gc.istanbulSaati(iki05) === 2 && gc.istanbulSaati(dort05) === 4, 'istanbulSaati');
  assert(gc.geceSaatiUyuyorMu('02:00', iki05) === true, "02:00 ↔ 02:05 tik uyar");
  assert(gc.geceSaatiUyuyorMu('02:45', iki05) === true, 'dakika yok sayılır (02:45 ↔ 02:05)');
  assert(gc.geceSaatiUyuyorMu(undefined, iki05) === true, 'saat yoksa varsayılan 02:00');
  assert(gc.geceSaatiUyuyorMu('02:00', dort05) === false, '02:00 ↔ 04:05 uymaz');
  assert(gc.geceSaatiUyuyorMu('04:30', dort05) === true, '04:30 ↔ 04:05 uyar');
  assert(gc.geceSaatiUyuyorMu('bozuk', iki05) === true && gc.geceSaatiUyuyorMu('bozuk', dort05) === false, 'bozuk kayıtlı saat → 02:00 gibi davranır');
  assert(gc.geceSaatiUyuyorMu('05:00', 5) === true && gc.geceSaatiUyuyorMu('05:00', 6) === false, 'doğrudan saat (0-23) verilebilir');
}

console.log('3) env kill-switch (NIGHTLY_EFATURA)');
{
  for (const v of ['off', '0', 'false', 'kapali', 'KAPALI ', 'Off']) assert(gc.geceCekimEnvKapaliMi(v) === true, `'${v}' → KAPALI`);
  for (const v of [undefined, '', 'on', '1', 'true', 'acik']) assert(gc.geceCekimEnvKapaliMi(v) === false, `'${v}' → açık (talimat kuralı yine geçerli)`);
  const eski = process.env.NIGHTLY_EFATURA;
  process.env.NIGHTLY_EFATURA = 'off';
  assert(gc.geceCekimEnvKapaliMi() === true, 'parametresiz çağrı process.env okur');
  if (eski === undefined) delete process.env.NIGHTLY_EFATURA; else process.env.NIGHTLY_EFATURA = eski;
}

console.log("4) talimat girdisi ('global' reddi, saat)");
{
  assert(throwsWith(() => gc.geceTalimatGirdisiDogrula({ provider: 'ELOGO', active: true }), /mükellef bazında/), "global + aç → HATA ('gece çekimi mükellef bazında açılır')");
  assert(throwsWith(() => gc.geceTalimatGirdisiDogrula({ provider: 'ELOGO' }), /mükellef bazında/), 'global + active belirsiz (=aç) → HATA');
  const kapat = gc.geceTalimatGirdisiDogrula({ provider: 'elogo', active: false });
  assert(kapat.taxpayerKey === 'global' && kapat.active === false && kapat.provider === 'ELOGO', 'global + kapat serbest (temizlik); provider büyük harf');
  const ac = gc.geceTalimatGirdisiDogrula({ provider: 'ELOGO', taxpayerId: 'tp1', active: true });
  assert(ac.saat === '02:00' && ac.taxpayerKey === 'tp1', 'saat verilmezse 02:00');
  assert(gc.geceTalimatGirdisiDogrula({ provider: 'ELOGO', taxpayerId: 'tp1', saat: '3:0' }).saat === '03:00', "saat '3:0' → '03:00'");
  assert(throwsWith(() => gc.geceTalimatGirdisiDogrula({ provider: 'ELOGO', taxpayerId: 'tp1', saat: '09:00' }), /00:00–06:59/), "saat '09:00' → HATA");
  assert(throwsWith(() => gc.geceTalimatGirdisiDogrula({ taxpayerId: 'tp1' }), /Sağlayıcı/), 'provider yoksa HATA');
}

console.log('5) plan oluşturma');
{
  const baglantilar = [
    { provider: 'ELOGO', isActive: true, config: { taxpayers: {
      global: { talimat: true, saat: '02:00' },            // global elenir
      tpA: { talimat: true },                               // saat yok → 02:00
      tpB: { talimat: true, saat: '04:00' },
      tpC: { talimat: false, saat: '02:00' },               // kapalı
      tpD: { talimat: 'true', saat: '02:00' },              // string true SAYILMAZ
      tpE: { talimat: true, saat: 'bozuk' },                // bozuk → 02:00
      tpF: null,
    } } },
    { provider: 'uyumsoft', isActive: false, config: { taxpayers: { tpG: { talimat: true, saat: '02:00' } } } }, // pasif bağlantı elenir
    { provider: 'PARASUT', isActive: true, config: {} },
  ];
  const p2 = gc.gecePlaniOlustur(baglantilar, 2);
  assert(p2.map((p) => p.taxpayerId).sort().join(',') === 'tpA,tpE', `saat 02 planı: tpA,tpE (varsayılan + bozuk saat) — ${p2.map((p) => p.taxpayerId).join(',')}`);
  const p4 = gc.gecePlaniOlustur(baglantilar, new Date('2026-09-13T01:05:00Z'));
  assert(p4.length === 1 && p4[0].taxpayerId === 'tpB' && p4[0].provider === 'ELOGO' && p4[0].saat === '04:00', 'saat 04 planı: yalnız tpB');
  assert(gc.gecePlaniOlustur(baglantilar, 5).length === 0, 'saat 05: kimse yok');
  assert(gc.gecePlaniOlustur([], 2).length === 0 && gc.gecePlaniOlustur(null, 2).length === 0, 'boş/null bağlantı listesi');
}

console.log('6) dönemler + iptal/red beklemesi (Istanbul takvimi; son 10 gün alınmaz — kullanıcı kararı 2026-09-26)');
{
  assert(gc.GECE_BEKLEME_GUN === 10, 'bekleme 10 gün');
  // Kullanıcı örneği: bugün 26.09.2026 → 01.09.2026 – 16.09.2026 arası çekilir.
  assert(gc.geceSonTarih(new Date('2026-09-25T23:05:00Z')) === '2026-09-16', '26 Eylül 02:05 İstanbul → son tarih 16.09');
  assert(gc.geceDonemleri(new Date('2026-09-25T23:05:00Z')).join(',') === '2026-09', '26 Eylül: yalnız Eylül (01.09–16.09)');
  assert(gc.geceSonTarih(new Date('2026-09-25T20:30:00Z')) === '2026-09-15', '25 Eylül 23:30 İstanbul (UTC 20:30) → 15.09 (İstanbul günü esas)');
  const d1 = gc.geceDonemleri(new Date('2026-09-30T21:30:00Z')); // 1 Ekim 00:30 İstanbul → son tarih 21.09
  assert(d1.join(',') === '2026-09', `1 Ekim: son tarih 21.09 → Ekim'den henüz bir şey alınmaz → ${d1.join(',')}`);
  const d6 = gc.geceDonemleri(new Date('2026-10-04T23:05:00Z')); // 5 Ekim → son tarih 25.09
  assert(d6.join(',') === '2026-09' && gc.geceSonTarih(new Date('2026-10-04T23:05:00Z')) === '2026-09-25', `5 Ekim: yalnız Eylül ≤ 25.09 → ${d6.join(',')}`);
  const d7 = gc.geceDonemleri(new Date('2026-10-10T23:05:00Z')); // 11 Ekim → son tarih 01.10
  assert(d7.join(',') === '2026-09,2026-10', `11 Ekim: Eylül tamam + Ekim 1'i → ${d7.join(',')}`);
  const d2 = gc.geceDonemleri(new Date('2026-09-20T00:05:00Z')); // 20 Eylül → son tarih 10.09
  assert(d2.join(',') === '2026-08,2026-09', `20 Eylül: son tarih 10.09 (≤15) → Ağustos da taranır → ${d2.join(',')}`);
  const d3 = gc.geceDonemleri(new Date('2027-01-10T23:05:00Z')); // 11 Ocak 2027 → son tarih 01.01.2027
  assert(d3.join(',') === '2026-12,2027-01', `yıl geçişi: Aralık + Ocak → ${d3.join(',')}`);
  const d8 = gc.geceDonemleri(new Date('2027-01-04T23:05:00Z')); // 5 Ocak 2027 → son tarih 26.12.2026
  assert(d8.join(',') === '2026-12', `5 Ocak: yalnız Aralık ≤ 26.12 → ${d8.join(',')}`);
  const d4 = gc.geceDonemleri(new Date('2026-09-25T00:05:00Z')); // 25 Eylül → son tarih 15.09
  assert(d4.join(',') === '2026-08,2026-09', `son tarih ayın 15'i: önceki ay da taranır → ${d4.join(',')}`);
  const d5 = gc.geceDonemleri(new Date('2026-09-26T00:05:00Z')); // 26 Eylül 03:05 → son tarih 16.09
  assert(d5.join(',') === '2026-09', `son tarih ayın 16'sı: yalnız Eylül → ${d5.join(',')}`);
  assert(gc.GECE_KANALLARI.map((k) => k.kanal).join(',') === 'IN_EFATURA,OUT_EFATURA,OUT_EARSIV', 'gece kanalları');
  assert(gc.earsivDesteksizMi({ status: 'SKIPPED', earsivDesteksiz: true }) && gc.earsivDesteksizMi({ reason: 'Uyumsoft: bu entegratörde satış e-Arşiv çekimi yok' }) && !gc.earsivDesteksizMi({ status: 'FAILED', reason: 'giriş hatası' }), 'earsivDesteksizMi');
  assert(gc.istanbulTarihi(new Date('2026-09-30T21:30:00Z')).ymd === '2026-10-01', 'istanbulTarihi ymd');
}

console.log('7) sabah özeti satırı');
{
  assert(/çalışmadı/.test(gc.geceOzetSatiri([])), 'kayıt yok → çalışmadı');
  const s = gc.geceOzetSatiri([
    { taxpayerId: 'a', provider: 'ELOGO', alis: 5, satis: 2, hata: 0 },
    { taxpayerId: 'a', provider: 'PARASUT', alis: 1, satis: 0, hata: 1 },
    { taxpayerId: 'b', provider: 'ELOGO', alis: 0, satis: 3, hata: 0 },
    null,
  ]);
  assert(s === 'gece çekimi: 11 belge geldi (2 mükellef, 1 hata)', `özet: ${s}`);
}

console.log('8) servis (mock prisma): setIntegrationTalimat + listIntegrations');
{
  const { FaturaMuhasebelestirmeService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'));
  const rows = [{ id: 'c1', provider: 'ELOGO', isActive: true, lastSyncAt: null, updatedAt: null, config: { taxpayers: { tp1: { username: 'u', hasPassword: true } } } }];
  const tx = {
    integrationConnection: {
      findUnique: async ({ where }) => rows.find((r) => r.provider === where.tenantId_provider.provider) || null,
      update: async ({ where, data }) => { const r = rows.find((x) => x.provider === where.tenantId_provider.provider); r.config = data.config; return r; },
      findMany: async () => rows,
    },
  };
  const prisma = { ...tx, $transaction: async (fn) => fn(tx) };
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { log() {}, warn() {}, error() {}, debug() {} };

  (async () => {
    let hata = null;
    try { await svc.setIntegrationTalimat('t', { provider: 'ELOGO', active: true }); } catch (e) { hata = e; }
    assert(hata && hata.constructor.name === 'BadRequestException' && /mükellef bazında/.test(hata.message), 'servis: global + aç → BadRequest');
    assert(rows[0].config.taxpayers.global === undefined, "servis: global anahtarı OLUŞTURULMADI");

    const r1 = await svc.setIntegrationTalimat('t', { provider: 'elogo', taxpayerId: 'tp1', active: true, saat: '03:00' });
    assert(r1.ok && r1.talimat === true && r1.saat === '03:00' && r1.taxpayerId === 'tp1' && r1.talimatUpdatedAt, `servis: aç + saat → ${JSON.stringify(r1)}`);
    assert(rows[0].config.taxpayers.tp1.talimat === true && rows[0].config.taxpayers.tp1.saat === '03:00' && rows[0].config.taxpayers.tp1.username === 'u', 'config.taxpayers.tp1: talimat+saat yazıldı, diğer alanlar korundu');

    const r2 = await svc.setIntegrationTalimat('t', { provider: 'ELOGO', taxpayerId: 'tp1', active: false });
    assert(r2.talimat === false && r2.saat === '03:00' && rows[0].config.taxpayers.tp1.saat === '03:00', 'servis: kapat → saat korunur');

    hata = null;
    try { await svc.setIntegrationTalimat('t', { provider: 'ELOGO', taxpayerId: 'tp1', active: true, saat: '08:00' }); } catch (e) { hata = e; }
    assert(hata && /00:00–06:59/.test(hata.message), 'servis: geçersiz saat → BadRequest');

    hata = null;
    try { await svc.setIntegrationTalimat('t', { provider: 'YOK', taxpayerId: 'tp1', active: true }); } catch (e) { hata = e; }
    assert(hata && /Entegratör tanımlı değil/.test(hata.message), 'servis: kayıtlı olmayan entegratör → BadRequest');

    await svc.setIntegrationTalimat('t', { provider: 'ELOGO', taxpayerId: 'tp1', active: true, saat: '05:00' });
    const liste = await svc.listIntegrations('t', { taxpayerId: 'tp1' });
    const elogo = liste.find((x) => x.provider === 'ELOGO');
    assert(elogo && elogo.talimat === true && elogo.saat === '05:00' && elogo.talimatUpdatedAt, `listIntegrations(tp1): talimat=true saat=05:00`);
    const listeGlobal = await svc.listIntegrations('t', { taxpayerId: null });
    const elogoG = listeGlobal.find((x) => x.provider === 'ELOGO');
    assert(elogoG && elogoG.talimat === false && elogoG.saat === '02:00', 'listIntegrations(global): talimat hep false, saat varsayılan');
    // Global anahtarında eski veriden talimat:true kalsa bile mükellef satırına MİRAS geçmez
    rows[0].config.taxpayers.global = { talimat: true, saat: '04:00' };
    rows[0].config.taxpayers.tp2 = { username: 'x' };
    const l2 = (await svc.listIntegrations('t', { taxpayerId: 'tp2' })).find((x) => x.provider === 'ELOGO');
    assert(l2.talimat === false && l2.saat === '02:00', 'global talimat=true mükellefe MİRAS geçmez');

    console.log('9) kaynak kilitleri');
    const cron = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.cron.ts'), 'utf8');
    assert(gc.GECE_CRON_IFADESI === '0 5 0-6 * * *', "GECE_CRON_IFADESI '0 5 0-6 * * *' (00:05…06:05)");
    assert(/@Cron\(GECE_CRON_IFADESI, \{ timeZone: 'Europe\/Istanbul' \}\)/.test(cron), 'cron sabiti + Europe/Istanbul');
    assert(!/0 15 3 \* \* \*/.test(cron), "eski '0 15 3 * * *' kalmadı");
    assert(/if \(geceCekimEnvKapaliMi\(\)\) \{[\s\S]*?env ile KAPALI[\s\S]*?return;/.test(cron), 'tik başında env kapısı (log + return)');
    assert(/gecePlaniOlustur\(connections, saat\)/.test(cron), 'plan gecePlaniOlustur ile (talimat===true + saat)');
    assert(!/syncAll\(/.test(cron) && !/EFaturaSyncService/.test(cron), 'eski adaptör senkronu (syncAll) gece akışından KALDIRILDI (2026-09-26)');
    assert(/GECE_KANALLARI/.test(cron) && /channel: kanal/.test(cron), 'gece akışı her entegratör için 3 kanalı ayrı çalıştırır');
    assert(/earsivDesteksizMi\(/.test(cron), 'e-Arşiv desteksiz mesajı hata sayılmaz');
    assert(/TAKILI_IS_MESAJI/.test(cron) && /status: 'RUNNING'/.test(cron), 'takılı iş temizliği (2 saat)');
    assert(/if \(plan\.length === 0\) \{[\s\S]*?continue;/.test(cron), 'plan boşsa tenant için HİÇBİR çağrı yok (senkron dahil)');
    assert(/action: 'GECE_CEKIM'/.test(cron) && /resource: 'gece-cekim'/.test(cron), 'AuditLog GECE_CEKIM kaydı');
    assert(/geceDonemleri\(now\)/.test(cron), 'dönemler Istanbul takvimine göre');
    assert(/const sonTarih = geceSonTarih\(now\)/.test(cron) && /donem,\s*sonTarih,/.test(cron), 'gece akışı son tarihi (bugün − 10 gün) her çekime geçirir');
    const svcKaynak = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'), 'utf8');
    assert(/if \(sonTarih && faturaGunu && faturaGunu > sonTarih\) \{\s*bekletilen\+\+;\s*continue;/.test(svcKaynak), 'servis: son tarihten sonraki fatura OLUŞTURULMAZ (bekletilir)');
    assert(/this\.belgeDurumuEngelli\(this\.inboxApprovalFields\(onOkuma, payload\.providerStatus\), onOkuma\.belgeDurumu\)\.engelli/.test(svcKaynak), 'servis: liste durumu iptal/red olan belge OLUŞTURULMAZ');
    assert(!/hepsini|talimat-hepsi|talimat\/all|setAllTalimat/i.test(fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts'), 'utf8')), "controller'da 'hepsini aç/kapat' ucu YOK");
    const sync = fs.readFileSync(path.join(ROOT, 'apps/api/src/efatura-adapters/efatura-sync.service.ts'), 'utf8');
    assert(/only\?: Array<\{ taxpayerId: string; provider: string \}>/.test(sync) && /if \(izinli && entries\.length === 0\) continue;/.test(sync), "syncAll 'only' süzgeci + global toplu senkron kapalı");
    const koord = fs.readFileSync(path.join(ROOT, 'apps/api/src/ekip/koordinator.service.ts'), 'utf8');
    assert(/geceOzetSatiri\(/.test(koord) && /action: 'GECE_CEKIM'/.test(koord), 'koordinatör sabah özeti GECE_CEKIM kayıtlarını okur');
    assert(/EKIP_SABAH_OZETI/.test(koord) && /this\.whatsapp\.sendMessage\(tel, metin, tenantId, \{ quote: false \}\)/.test(koord), 'sabah özeti gönderim kodu DEĞİŞMEDİ (env kapalıyken gitmez)');

    if (failed) { console.error(`\n${failed} kilit BAŞARISIZ`); process.exit(1); }
    console.log('\ngece-cekim-anahtari-regression: tüm kilitler geçti');
  })().catch((e) => { console.error('HATA:', e && e.stack || e); process.exit(1); });
}
