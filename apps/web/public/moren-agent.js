/* Moren Agent Runner — tarayıcıda Mihsap sekmesi açıkken çalışır.
   Bookmarklet:
     javascript:(function(){if(window.__morenAgent)return alert('Moren Agent zaten açık');var s=document.createElement('script');s.src='https://portal.morenmusavirlik.com/moren-agent.js?v='+Date.now();document.head.appendChild(s);})();
*/
(function () {
  if (window.__morenAgent) {
    console.log('[Moren] zaten çalışıyor');
    return;
  }
  window.__morenAgent = { running: true, stopRequested: false };

  const API = 'https://mali-musavir-app-production.up.railway.app/api/v1';
  let TOKEN = localStorage.getItem('moren_agent_token') || '';
  if (!TOKEN) {
    TOKEN = prompt('Moren Agent Token:') || '';
    if (!TOKEN) {
      alert('Token girilmedi. Kapatılıyor.');
      delete window.__morenAgent;
      return;
    }
    localStorage.setItem('moren_agent_token', TOKEN);
  }

  // === UI ===
  const panel = document.createElement('div');
  panel.id = 'moren-agent-panel';
  panel.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0f0d0b;color:#fafaf9;font:13px/1.4 -apple-system,sans-serif;border-radius:10px;padding:12px 14px;box-shadow:0 8px 32px rgba(0,0,0,.4);min-width:240px;border:1px solid #b8a06f';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="width:8px;height:8px;border-radius:50%;background:#10b981;animation:pulse 1.5s infinite"></div>
      <b style="color:#b8a06f;letter-spacing:.08em;font-size:11px;text-transform:uppercase">MOREN AGENT</b>
      <button id="ma-stop" style="margin-left:auto;background:rgba(239,68,68,.2);color:#ef4444;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer">DUR</button>
    </div>
    <div id="ma-status" style="color:rgba(250,250,249,.7);font-size:12px">Bekleniyor…</div>
    <div id="ma-count" style="margin-top:6px;font-size:11px;color:rgba(250,250,249,.5)"></div>`;
  document.body.appendChild(panel);
  const style = document.createElement('style');
  style.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}';
  document.head.appendChild(style);
  const $status = panel.querySelector('#ma-status');
  const $count = panel.querySelector('#ma-count');
  const counters = { onay: 0, atla: 0, demirbas: 0, hata: 0, toplam: 0 };
  const setStatus = (s) => ($status.textContent = s);
  const setCount = () => ($count.textContent = `✓${counters.onay} ⏭${counters.atla} ⏩${counters.demirbas} ⚠${counters.hata}`);
  document.getElementById('ma-stop').onclick = () => {
    window.__morenAgent.stopRequested = true;
    setStatus('Durduruluyor…');
  };

  // === HELPERS ===
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN, ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }
  function findBtnExact(label) {
    return [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label && b.offsetParent !== null,
    );
  }
  async function click(el) { el?.click(); await sleep(400); }
  async function waitFor(sel, t = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < t) {
      const el = document.querySelector(sel);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }
  async function logEvent(mukellefId, mukellefAd, status, detail) {
    try {
      await api('/agent/events/ingest', {
        method: 'POST',
        body: JSON.stringify({ agent: 'mihsap', mukellef: mukellefAd, mukellefId, status, detail, meta: {} }),
      });
    } catch (e) { console.warn('[Moren] log fail', e); }
  }

  // === MIHSAP FATURA İŞLEME ===
  async function handleDialogs() {
    await sleep(200);
    const iptal = findBtnExact('İptal');
    if (iptal && document.body.textContent.includes('Mükerrer')) { await click(iptal); return 'mukerrer'; }
    const tamam = findBtnExact('Tamam');
    if (tamam) { await click(tamam); }
    const vazgec = findBtnExact('Vazgeç');
    if (vazgec) { await click(vazgec); return 'vazgec'; }
    return 'ok';
  }

  async function clickIleri() {
    const btns = [...document.querySelectorAll('button')];
    const ileri = btns.find((b) => b.textContent.trim().startsWith('İleri') && b.offsetParent !== null);
    await click(ileri);
  }

  async function clickKaydetOnayla() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true }));
    await sleep(600);
    await handleDialogs();
  }

  async function getFaturaTarihi(fid) {
    try {
      const jwt = localStorage.getItem('token');
      const r = await fetch(`/api/mali-musavir/all-faturas/getFaturaBeforeUpdate/${fid}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.faturaTarihi || null;
    } catch { return null; }
  }

  async function readHesapKodlari() {
    // Bekle: 2+ kod gelene kadar, max 15sn
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const els = [...document.querySelectorAll('.ant-select-selection-item')];
      const codes = els.map((e) => (e.textContent || '').trim()).filter(Boolean);
      if (codes.length >= 2) return codes;
      await sleep(500);
    }
    return [];
  }

  function tumKodlarDolu(codes) {
    return codes.length > 0 && codes.every((c) => c && /^\d/.test(c));
  }
  function demirbasVarMi(codes) {
    return codes.some((c) => /^255/.test(c) || /demirbaş/i.test(c));
  }

  async function processBatch({ ay, mukellefler, action }) {
    setStatus(`${mukellefler.length} mükellef / ${ay} · ${action}`);
    for (const m of mukellefler) {
      if (window.__morenAgent.stopRequested) { setStatus('Durduruldu'); return; }
      setStatus(`→ ${m.ad}`);
      await processMukellef({ ay, mukellef: m, action });
    }
    setStatus(`Tamamlandı · ${counters.toplam} fatura`);
  }

  async function processMukellef({ ay, mukellef, action }) {
    const tipSegment = action === 'isle_alis' ? 'BILANCO/1' : action === 'isle_satis' ? 'BILANCO/2' : null;
    if (!tipSegment || !mukellef.mihsapId) return;
    const startUrl = `https://ofis.mihsap.com.tr/dashboard/documents/${tipSegment}/${mukellef.mihsapId}`;
    if (!location.href.startsWith(startUrl)) {
      setStatus(`${mukellef.ad} → Mihsap'ta açın: ${startUrl}`);
      return; // Kullanıcı manuel yönlendirecek
    }
    const firstPen = await waitFor('tbody tr button .anticon-edit', 5000);
    if (!firstPen) { setStatus('Fatura yok'); return; }
    await click(firstPen.closest('button'));

    let lastFid = null;
    let sameFidCount = 0;
    for (let i = 0; i < 500; i++) {
      if (window.__morenAgent.stopRequested) return;
      const fidMatch = location.href.match(/\/(\d+)\?count=/);
      const count = parseInt(location.href.match(/count=(-?\d+)/)?.[1] || '1', 10);
      const fid = fidMatch?.[1];
      if (count === 0) { setStatus('count=0 bitti'); return; }
      if (fid === lastFid) { sameFidCount++; if (sameFidCount > 2) { setStatus('Aynı fatura tekrarı'); return; } }
      else { sameFidCount = 0; lastFid = fid; }

      const tarih = await getFaturaTarihi(fid);
      const hedefAy = ay; // "2026-03"
      const ayUygun = tarih && tarih.startsWith(hedefAy);
      if (!ayUygun) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `tarih ${tarih} ≠ ${hedefAy}`);
        await clickIleri(); continue;
      }
      const codes = await readHesapKodlari();
      if (!tumKodlarDolu(codes)) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'kod boş');
        await clickIleri(); continue;
      }
      if (demirbasVarMi(codes)) {
        counters.demirbas++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'demirbaş');
        await clickIleri(); continue;
      }
      try {
        await clickKaydetOnayla();
        counters.onay++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'ok', `F2 · ${codes.join(',')}`);
      } catch (e) {
        counters.hata++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'error', String(e));
        await clickIleri();
      }
    }
  }

  // === KOMUT KUYRUĞU POLLING ===
  async function pollLoop() {
    await api('/agent/status/ping', {
      method: 'POST',
      body: JSON.stringify({ agent: 'mihsap', running: true, meta: { url: location.href } }),
    }).catch(() => {});
    while (window.__morenAgent.running && !window.__morenAgent.stopRequested) {
      try {
        const cmds = await api('/agent/commands/claim', { method: 'POST', body: JSON.stringify({ agent: 'mihsap' }) });
        if (Array.isArray(cmds) && cmds.length > 0) {
          for (const cmd of cmds) {
            try {
              setStatus(`CMD: ${cmd.action}`);
              await processBatch({
                ay: cmd.payload?.ay,
                mukellefler: cmd.payload?.mukellefler || [],
                action: cmd.action,
              });
              await api(`/agent/commands/${cmd.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'done', result: { ...counters, message: `${counters.toplam} fatura işlendi` } }),
              });
            } catch (e) {
              await api(`/agent/commands/${cmd.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'failed', result: { message: String(e) } }),
              }).catch(() => {});
            }
          }
        } else {
          setStatus('Komut bekleniyor…');
        }
      } catch (e) {
        setStatus('API hatası, yeniden deneniyor');
        console.error('[Moren]', e);
      }
      await sleep(5000);
    }
    await api('/agent/status/ping', {
      method: 'POST',
      body: JSON.stringify({ agent: 'mihsap', running: false }),
    }).catch(() => {});
    panel.remove();
    delete window.__morenAgent;
  }
  pollLoop();
  console.log('[Moren Agent] yüklendi');
})();
