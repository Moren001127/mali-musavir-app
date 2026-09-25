/**
 * LUCA HIZ — akilli bekleme davranis sinamasi (2026-09-25).
 *
 * Neyi korur: kor sabit uykular "hazir olunca devam et"e cevrildi. Sozlesme SU:
 *   (a) TAVAN ASILMAZ — hicbir bekleme eskisinden UZUN surmez,
 *   (b) sayfa kararli hale gelince ERKEN cikar,
 *   (c) olcum yapilamiyorsa (frame erisimi kapali) eski davranisa doner: tavana kadar bekler,
 *   (d) sayfa hala yukleniyorsa erken CIKMAZ.
 *
 * Bu dosyalar KILITLI modul; burada yalniz iki yardimcinin mantigi sinanir (kopya degil,
 * dosyadan cikarilip calistirilir).
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

let gecen = 0;
const ok = (kosul, ad) => { assert.ok(kosul, ad); gecen++; };

/** Kilitli dosyadan bir fonksiyonu KAYNAK OLARAK cikarip calistirilabilir hale getirir. */
function fonksiyonuCikar(dosya, ad) {
  const src = fs.readFileSync(path.join(ROOT, dosya), 'utf8');
  const bas = src.indexOf(`async function ${ad}(`);
  assert.ok(bas >= 0, `${ad} bulunamadi (${dosya}) — fonksiyon adi degismis olabilir`);
  // Fonksiyon govdesini parantez sayarak cikar.
  let i = src.indexOf('{', bas), derinlik = 0, son = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') derinlik++;
    else if (src[i] === '}') { derinlik--; if (derinlik === 0) { son = i + 1; break; } }
  }
  assert.ok(son > bas, `${ad} govdesi ayristirilamadi`);
  return src.slice(bas, son);
}

(async () => {
  // ── 1) agent-runtime.js: lucaSettle ──────────────────────────────
  {
    const kaynak = fonksiyonuCikar('apps/api/public/agent-runtime.js', 'lucaSettle');
    let belgeler = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const lucaDocuments = () => belgeler;
    const lucaSettle = new Function('sleep', 'lucaDocuments', `${kaynak}; return lucaSettle;`)(sleep, lucaDocuments);

    // (b) KARARLI sayfa → erken cikar (tavanin cok altinda)
    belgeler = [{ readyState: 'complete', body: { childElementCount: 5 } }];
    let t0 = Date.now();
    await lucaSettle(3000);
    let sure = Date.now() - t0;
    ok(sure < 1200, `kararli sayfada ERKEN cikar (${sure}ms < 1200ms)`);
    ok(sure >= 150, `en az iki olcum yapar (${sure}ms >= 150ms)`);

    // (d) YUKLENIYOR durumunda erken cikmaz → tavana kadar bekler
    belgeler = [{ readyState: 'loading', body: { childElementCount: 5 } }];
    t0 = Date.now();
    await lucaSettle(600);
    sure = Date.now() - t0;
    ok(sure >= 550, `yuklenen sayfada erken CIKMAZ (${sure}ms >= 550ms)`);

    // (a) TAVAN ASILMAZ — surekli degisen sayfada bile
    let sayac = 0;
    Object.defineProperty(globalThis, '__degisken', { value: true, configurable: true });
    belgeler = [{ readyState: 'complete', get body() { return { childElementCount: sayac++ }; } }];
    t0 = Date.now();
    await lucaSettle(700);
    sure = Date.now() - t0;
    ok(sure >= 650 && sure < 1400, `surekli degisen sayfada TAVANA kadar bekler, asmaz (${sure}ms)`);

    // (c) OLCULEMEZSE eski davranis: tavana kadar bekle
    const lucaSettleHatali = new Function('sleep', 'lucaDocuments', `${kaynak}; return lucaSettle;`)(
      sleep, () => { throw new Error('frame erisimi kapali'); },
    );
    t0 = Date.now();
    await lucaSettleHatali(600);
    sure = Date.now() - t0;
    ok(sure >= 550, `olculemezse tavana kadar bekler (${sure}ms >= 550ms)`);

    // Tavan 0/gecersizse hic beklemez
    t0 = Date.now();
    await lucaSettle(0);
    ok(Date.now() - t0 < 60, 'tavan 0 ise hic beklemez');
  }

  // ── 2) agent.js: beklePageOturma ─────────────────────────────────
  {
    const kaynak = fonksiyonuCikar('apps/luca-local-agent/src/agent.js', 'beklePageOturma');
    const beklePageOturma = new Function(`${kaynak}; return beklePageOturma;`)();
    const sahtePage = (urlFn, frameFn) => ({
      url: urlFn,
      frames: frameFn,
      waitForTimeout: (ms) => ({ catch: () => new Promise((r) => setTimeout(r, ms)) }),
    });

    // (b) Frame'ler yerlesmis → erken cikar
    let p = sahtePage(() => 'https://luca/main', () => [{ url: () => 'https://luca/f1' }, { url: () => 'https://luca/f2' }]);
    let t0 = Date.now();
    await beklePageOturma(p, 4500);
    let sure = Date.now() - t0;
    ok(sure < 1500, `frame'ler yerlesince ERKEN cikar (${sure}ms < 1500ms)`);

    // (d) about:blank frame varsa erken cikmaz (frameset daha yuklenmemis)
    p = sahtePage(() => 'https://luca/main', () => [{ url: () => 'about:blank' }]);
    t0 = Date.now();
    await beklePageOturma(p, 700);
    sure = Date.now() - t0;
    ok(sure >= 650, `about:blank frame varken erken CIKMAZ (${sure}ms >= 650ms)`);

    // (a) TAVAN ASILMAZ — surekli degisen frame listesi
    let n = 0;
    p = sahtePage(() => 'https://luca/main', () => [{ url: () => `https://luca/f${n++}` }]);
    t0 = Date.now();
    await beklePageOturma(p, 700);
    sure = Date.now() - t0;
    ok(sure >= 650 && sure < 1500, `degisen sayfada TAVANA kadar bekler, asmaz (${sure}ms)`);

    // (c) Olculemezse tavana kadar bekler
    p = sahtePage(() => { throw new Error('kapali'); }, () => { throw new Error('kapali'); });
    t0 = Date.now();
    await beklePageOturma(p, 600);
    sure = Date.now() - t0;
    ok(sure >= 550, `olculemezse tavana kadar bekler (${sure}ms >= 550ms)`);
  }

  // ── 3) Kor uyku geri gelmesin (nobet) ────────────────────────────
  {
    const rt = fs.readFileSync(path.join(ROOT, 'apps/api/public/agent-runtime.js'), 'utf8');
    ok(!/await sleep\(opts\.settleMs/.test(rt), 'tik sonrasi KOR uyku geri gelmemis (settleMs)');
    ok((rt.match(/await lucaSettle\(/g) || []).length >= 6, 'tik noktalari akilli beklemeye bagli (>=6)');
    const ag = fs.readFileSync(path.join(ROOT, 'apps/luca-local-agent/src/agent.js'), 'utf8');
    ok(!/await page\.waitForTimeout\((?:4500|3500|3000)\)/.test(ag), 'navigasyon KOR tamponlari geri gelmemis');
    ok((ag.match(/await beklePageOturma\(/g) || []).length >= 4, 'navigasyon noktalari akilli beklemeye bagli (>=4)');
  }

  console.log(`[luca-hiz-bekleme-regression] ${gecen} assertion — HEPSI GECTI`);
})().catch((e) => { console.error('[luca-hiz-bekleme-regression] KIRILDI:', e.message); process.exit(1); });
