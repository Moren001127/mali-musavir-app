#!/usr/bin/env node
/**
 * edefter-mizan-companion-regression.cjs
 *
 * 2026-09-10 — e-Defter "Luca'dan Çek" akışında MİZAN bağlantısının koruma testi.
 *
 * Kullanıcı şikâyeti: "lucadan çek yapınca fiş listesi ile birlikte mizanı da
 * otomatik çekmesi lazım ama sadece fiş listesi çekiyor mizanı çekmiyor".
 *
 * Teşhis (canlı veriyle kanıtlandı — ZEKİ ÖZKAYNAK 2026-Q2):
 *   Mizan aslında çekiliyordu. Kopan yer sıralamaydı:
 *     08:23:32 fiş listesi işi · 08:24:11 fiş bitti + oturum kuruldu + ANALİZ ÇALIŞTI
 *     08:24:11 mizan işi ANCAK ŞİMDİ sıraya girdi · 08:24:25 mizan hazır (READY)
 *   Analiz mizandan 14 sn önce bittiği için 15 bulgunun 12'si "açılış bakiyesi
 *   hariç hesaplandı; ilgili dönemin Mizanı çekilirse kesinleşir" diyordu.
 *   Mizan geldiğinde analizi tazeleyen hiçbir kod yoktu.
 *
 * KORUNAN DAVRANIŞ (üçü birden):
 *   1) Eşlik eden MİZAN işi, çekim BAŞLARKEN (createFetchJob) sıraya girer —
 *      fiş listesinin bitmesini BEKLEMEZ. Böylece fiş tarafı düşse bile mizan gelir.
 *   2) Mizan yüklenince eşlik ettiği e-Defter oturumu bir kez YENİDEN ANALİZ edilir.
 *      (Oturumdaki Excel'den çalışır; Luca'ya ikinci çekim yapmaz.)
 *   3) Uç nokta gerçek mizanJobId döner; mizan işi açılamazsa hata YUTULMAZ.
 *
 * Bu davranış kazara geri alınırsa commit'i keser.
 * Bypass: MOREN_UNLOCK=1 (geçici).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

const fails = [];
const need = (cond, msg) => { if (!cond) fails.push(msg); };

// ─── 1) Mizan işi çekim BAŞLARKEN oluşuyor mu? ───────────────────────────────
const SVC = 'apps/api/src/edefter-control/edefter-control.service.ts';
const svc = read(SVC);
if (!svc) {
  fails.push(`${SVC} bulunamadı`);
} else {
  const createFetch = svc.slice(
    svc.indexOf('async createFetchJob('),
    svc.indexOf('async createCompanionMizanJob('),
  );
  need(createFetch.length > 0, `${SVC}: createFetchJob bulunamadı.`);
  need(/createCompanionMizanJob\s*\(/.test(createFetch),
    `${SVC}: createFetchJob artık eşlik eden Mizan işini oluşturmuyor — mizan yine fiş listesinin bitmesini bekler ve ilk analiz mizansız kalır.`);
  need(/return\s*\{\s*detailJob,\s*mizanJob,\s*mizanHata\s*\}/.test(createFetch),
    `${SVC}: createFetchJob mizanJob/mizanHata döndürmüyor — ekran mizanın açılıp açılmadığını bilemez.`);
  need(!/return\s*\{\s*detailJob,\s*mizanJob:\s*null\s*\}/.test(createFetch),
    `${SVC}: createFetchJob tekrar 'mizanJob: null' dönüyor — mizan çekimle birlikte açılmıyor.`);

  // Aynı fiş işine ikinci mizan işi açılmamalı (upload ucu emniyet için tekrar çağırıyor).
  const companion = svc.slice(svc.indexOf('async createCompanionMizanJob('));
  need(/lucaFetchJob\.findFirst\([\s\S]{0,240}?tip:\s*'MIZAN'/.test(companion),
    `${SVC}: createCompanionMizanJob "zaten var mı" kontrolünü kaybetmiş — aynı çekim için iki mizan işi açılır.`);
}

// ─── 2) Uç nokta gerçek mizanJobId dönüyor mu? ───────────────────────────────
const CTRL = 'apps/api/src/edefter-control/edefter-control.controller.ts';
const ctrl = read(CTRL);
if (!ctrl) {
  fails.push(`${CTRL} bulunamadı`);
} else {
  need(/mizanJobId:\s*jobs\.mizanJob\?\.id\s*\|\|\s*null/.test(ctrl),
    `${CTRL}: fetch-from-luca yine sabit 'mizanJobId: null' dönüyor — ekran mizan işini takip edemez.`);
  need(/mizanHata:\s*jobs\.mizanHata/.test(ctrl),
    `${CTRL}: mizan işi açılamadığında sebep dönülmüyor — sessiz başarısızlık geri geldi.`);
}

// ─── 3) Mizan yüklenince denetim yeniden çalışıyor mu? ───────────────────────
const LUCA_CTRL = 'apps/api/src/luca/luca.controller.ts';
const lucaCtrl = read(LUCA_CTRL);
if (!lucaCtrl) {
  fails.push(`${LUCA_CTRL} bulunamadı`);
} else {
  const upload = lucaCtrl.slice(lucaCtrl.indexOf('async uploadMizanFromRunner('));
  const uploadBlock = upload.slice(0, 4000);
  need(/edefterControl\.reanalyzeSession\(/.test(uploadBlock),
    `${LUCA_CTRL}: mizan yüklenince e-Defter oturumu yeniden analiz edilmiyor — bulgular mizansız kalır ("açılış bakiyesi hariç").`);
  need(/createdBy:\s*`edefter-control:\$\{job\.sessionId\}`/.test(uploadBlock),
    `${LUCA_CTRL}: yeniden analiz edilecek oturum 'edefter-control:<fiş işi id>' işaretiyle aranmıyor — yanlış/başka oturum tazelenebilir.`);
  need(/private readonly edefterControl: EDefterControlService/.test(lucaCtrl),
    `${LUCA_CTRL}: EDefterControlService enjeksiyonu kaldırılmış.`);
}

const LUCA_MOD = 'apps/api/src/luca/luca.module.ts';
const lucaMod = read(LUCA_MOD);
if (!lucaMod) {
  fails.push(`${LUCA_MOD} bulunamadı`);
} else {
  need(/forwardRef\(\(\)\s*=>\s*EDefterControlModule\)/.test(lucaMod),
    `${LUCA_MOD}: EDefterControlModule bağlantısı kaldırılmış — yeniden analiz kancası çalışmaz.`);
}

// ─── 4) Ekran "mizan yok" ile "mizan bitti"yi ayırıyor mu? ───────────────────
const PAGE = 'apps/web/src/app/(panel)/panel/ajanlar/e-defter/page.tsx';
const page = read(PAGE);
if (!page) {
  fails.push(`${PAGE} bulunamadı`);
} else {
  need(/const mizanYok = !mizanJob;/.test(page),
    `${PAGE}: "mizan işi hiç yok" durumu tekrar "bitti" sayılıyor — ekran mizan gelmemişken "güncellendi" der.`);
  need(!/mizanDone \? 'Detay Fiş Listesi alındı, Mizan kontrolü de güncellendi'/.test(page),
    `${PAGE}: yanıltıcı "Mizan kontrolü de güncellendi" metni geri gelmiş.`);
  need(/Mizan \{mizan\.hesapCount\} hesap/.test(page),
    `${PAGE}: başlıktaki mizan göstergesi kaldırılmış — kullanıcı mizanın geldiğini göremez.`);
}

if (fails.length) {
  console.error('\n[edefter-mizan-companion] KORUMA TESTİ BAŞARISIZ:\n');
  for (const f of fails) console.error('  ✗ ' + f);
  console.error('\n  Bu koruma, e-Defter denetiminin mizansız çalışmasını önler.');
  console.error('  Kasıtlıysa bu dosyayı da güncelle. Geçici bypass: MOREN_UNLOCK=1\n');
  process.exit(1);
}
console.log('✓ e-Defter eşlik eden Mizan bağlantısı sağlam (birlikte çekim + otomatik yeniden analiz)');
