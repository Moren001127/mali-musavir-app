/**
 * LUCA İŞ YÖNLENDİRME — davranis sinamasi (2026-09-25).
 *
 * Neyi korur: sahip karari "bilgisayarda hicbir sey olmayacak; hangi bilgisayardan girersem
 * gireyim Luca'dan cekebileyim / Luca'ya gonderebileyim". Bunun onundeki iki kok sorun:
 *
 *  1) IS "KIMSENIN ALAMAYACAGI" HALDE DOGUYORDU — targetDeviceId (hangi cihaz) ile
 *     preferredAgent (hangi ajan turu) birbirini dogrulamiyordu. Ekran operator cihazini
 *     secip is local-node isterse affinity suzgeci isi operatore gostermez, baska cihaz da
 *     civili isi alamaz. CANLI OLCUM (2026-09-25): boyle kurulan 207 isin TAMAMI hic
 *     baslamadan olmus; sunucu veri ajanina gidenler %79-96 basarili.
 *
 *  2) SONSUZ TEKRAR-SIRAYA-ALMA — requeue, gerekce teknik kalibina uymazsa retryCount'u
 *     SIFIRLIYORDU. Ajanin takilma bekcileri tam da uymayan gerekceler gonderiyor
 *     (AGENT_STALL_WATCHDOG_4MIN, AGENT_FREEZE_WATCHDOG, AGENT_SELF_HEAL_TIMEOUT_10MIN)
 *     → "3 denemede dur" emniyetlerinin UCU DE devre disi kaliyordu.
 *
 * Gercek sinif metodlarini cagirir (kopya mantik yok), sahte prisma ile.
 */
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
function ilkBulunan(adaylar, ad) {
  for (const c of adaylar) { try { return require(c); } catch {} }
  throw new Error(`${ad} bulunamadi`);
}
ilkBulunan([
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
], 'ts-node');

const { LucaService } = require(path.join(ROOT, 'apps/api/src/luca/luca.service.ts'));

let gecen = 0;
const eq = (a, b, ad) => { assert.strictEqual(a, b, `${ad}\n  beklenen: ${JSON.stringify(b)}\n  gelen   : ${JSON.stringify(a)}`); gecen++; };

/** createFetchJob'u sahte prisma ile cagirip DB'ye yazilan veriyi doner. */
async function isYarat({ tip, targetDeviceId, preferredAgent }) {
  let yazilan = null;
  const vekil = {
    logger: { warn() {}, log() {} },
    lastCleanupAtByTenant: new Map([['T1', Date.now()]]),  // temizligi atla
    cleanupStuckRunning: async () => {},
    prisma: {
      lucaFetchJob: {
        findFirst: async () => null,          // mukerrer yok
        create: async ({ data }) => { yazilan = data; return { id: 'J1', ...data }; },
      },
    },
    appendJobLog: async () => {},
    withDerivedDonemTipi: (j) => j,
    agentKindForDeviceId: LucaService.prototype.agentKindForDeviceId,
  };
  await LucaService.prototype.createFetchJob.call(vekil, {
    tenantId: 'T1', mukellefId: 'M1', donem: '2026-09', tip, targetDeviceId, preferredAgent,
  });
  return yazilan;
}

/** requeueJobForAgent'i sahte prisma ile cagirip guncellenen veriyi doner. */
async function tekrarSiraya({ reason, retryCount = 0, status = 'running' }) {
  let guncel = null;
  const job = { id: 'J1', tenantId: 'T1', status, retryCount, errorMsg: 'onceki gunluk' };
  const vekil = {
    logger: { warn() {}, log() {} },
    prisma: {
      lucaFetchJob: {
        findUnique: async () => job,
        update: async ({ data }) => { guncel = data; return { id: 'J1', ...data }; },
      },
    },
    appendJobLog: async () => {},
    withDerivedDonemTipi: (j) => j,
  };
  await LucaService.prototype.requeueJobForAgent.call(vekil, 'J1', 'T1', reason);  // (jobId, tenantId, reason)
  return guncel;
}

(async () => {
  // ── 1) UYUM KAPISI ────────────────────────────────────────────────
  // Operator cihazi + veri isi (local-node) → civi DUSMELI, yoksa isi kimse alamaz.
  {
    const d = await isYarat({ tip: 'EARSIV_ALIS', targetDeviceId: 'vps-radore-luca-operator' });
    eq(d.targetDeviceId, null, 'operator cihazina civilenen veri isinin civisi dusurulur');
    eq(d.preferredAgent, 'local-node', 'istenen ajan turu korunur');
  }
  // Uyumlu sunucu cihazi → civi KALMALI (dogru yonlendirme bozulmasin).
  {
    const d = await isYarat({ tip: 'EARSIV_ALIS', targetDeviceId: 'vps-radore-luca' });
    eq(d.targetDeviceId, 'vps-radore-luca', 'uyumlu sunucu cihazinin civisi korunur');
  }
  // Bilgisayar ajani (DEV-*) + veri isi → uyumsuz, civi dusmeli.
  {
    const d = await isYarat({ tip: 'MIZAN', targetDeviceId: 'DEV-moxegoee-O514TN' });
    eq(d.targetDeviceId, null, 'bilgisayar ajanina civilenen veri isinin civisi dusurulur');
  }
  // Operator ISI + operator cihazi → uyumlu, civi kalmali.
  {
    const d = await isYarat({ tip: 'EKRAN_OKU', targetDeviceId: 'vps-radore-luca-operator', preferredAgent: 'operator' });
    eq(d.targetDeviceId, 'vps-radore-luca-operator', 'operator isi operator cihazinda kalir');
  }
  // Hic civi yoksa dokunulmaz (serbest is).
  {
    const d = await isYarat({ tip: 'EARSIV_ALIS' });
    eq(d.targetDeviceId, null, 'civisiz is serbest kalir');
  }

  // ── 2) SONSUZ DONGU KAPISI ────────────────────────────────────────
  // Bekcinin gonderdigi gerekce TEKNIK KALIBA UYMAZ; sayac yine de ARTMALI.
  {
    const g = await tekrarSiraya({ reason: 'AGENT_STALL_WATCHDOG_4MIN', retryCount: 1 });
    eq(g.retryCount, 2, 'teknik olmayan gerekcede de sayac ARTAR (sifirlanmaz)');
    eq(g.status, 'pending', 'is tekrar siraya alinir');
    assert.ok(g.nextRetryAt instanceof Date, 'teknik olmayan tekrarda da BEKLEME konur');
    gecen++;
  }
  // Ucuncu denemede is kapanmali — sonsuz donguye girmesin.
  {
    const g = await tekrarSiraya({ reason: 'AGENT_FREEZE_WATCHDOG', retryCount: 2 });
    eq(g.status, 'failed', '3. denemede is KAPANIR (sonsuz dongu yok)');
    assert.ok(/3 kez yeniden denendi/.test(String(g.errorMsg)), 'kapanma sebebi gunluge yazilir');
    assert.ok(/AGENT_FREEZE_WATCHDOG/.test(String(g.errorMsg)), 'son sebep gunlukte gorunur');
    gecen += 2;
  }
  // Teknik gerekce de ayni kurala tabi.
  {
    const g = await tekrarSiraya({ reason: 'TRANSIENT_LUCA: frame', retryCount: 1 });
    eq(g.retryCount, 2, 'teknik gerekcede sayac artmaya devam eder');
  }
  // Tamamlanmis is diriltilmez.
  {
    const g = await tekrarSiraya({ reason: 'AGENT_STALL_WATCHDOG_4MIN', status: 'done' });
    eq(g, null, 'tamamlanmis is tekrar siraya ALINMAZ');
  }

  console.log(`[luca-yonlendirme-regression] ${gecen} assertion — HEPSI GECTI`);
})().catch((e) => { console.error('[luca-yonlendirme-regression] KIRILDI:', e.message); process.exit(1); });
