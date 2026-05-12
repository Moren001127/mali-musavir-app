// Moren Auto Agent — Service Worker (MV3)
//
// Görevleri:
// 1) Portal'daki content script'ten gelen komutları dinle (chrome.runtime.onMessage)
// 2) Açık olan tüm Luca + Mihsap sekmelerinde agent'ı yeniden başlat
// 3) Her 5 dk'da bir watchdog: ölü agent varsa yeniden inject

const LUCA_PATTERNS = [
  /^https?:\/\/(?:www\.)?luca\.com\.tr\//,
  /^https?:\/\/auygs\.luca\.com\.tr\//,
  /^https?:\/\/[^/]*\.luca\.com\.tr\//,
];
const MIHSAP_PATTERNS = [
  /^https?:\/\/app\.mihsap\.com\//,
];
const AGENT_HOME_URL = {
  // Luca klasik ekranı (auygs.../Luca/luca.do) doğrudan açılırsa "LUCA HATA"
  // veriyor; o URL'yi Luca kendi login akışından ikinci sekme olarak açmalı.
  luca: 'https://www.luca.com.tr/',
  mihsap: 'https://app.mihsap.com/',
};

function classifyTab(url) {
  if (!url) return null;
  if (LUCA_PATTERNS.some((p) => p.test(url))) return 'luca';
  if (MIHSAP_PATTERNS.some((p) => p.test(url))) return 'mihsap';
  return null;
}

function isClassicLucaTab(url) {
  return /^https?:\/\/auygs\.luca\.com\.tr\/Luca\//i.test(url || '');
}

async function findAgentTabs() {
  const all = await chrome.tabs.query({});
  return all
    .map((t) => ({ tab: t, kind: classifyTab(t.url) }))
    .filter((x) => x.kind);
}

async function restartAgentIn(tabId, kind) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          if (window.__morenAgent) {
            window.__morenAgent.stopRequested = true;
            window.__morenAgent = null;
          }
          window.dispatchEvent(new CustomEvent('moren-auto-agent-restart'));
        } catch (e) {}
      },
    });
    return { ok: true, tabId, kind };
  } catch (e) {
    return { ok: false, tabId, kind, error: String(e) };
  }
}

async function restartAll() {
  await ensureAgentTab('luca');
  await ensureAgentTab('mihsap');
  const tabs = await findAgentTabs();
  const results = await Promise.all(
    tabs.map((x) => restartAgentIn(x.tab.id, x.kind)),
  );
  return { tabs: tabs.length, results };
}

async function ensureAgentTab(kind, opts = {}) {
  const wanted = String(kind || '').toLowerCase();
  const focus = opts.focus !== false;
  if (!AGENT_HOME_URL[wanted]) return { ok: false, error: 'unknown agent' };
  const tabs = await findAgentTabs();
  const existing = wanted === 'luca'
    ? (tabs.find((x) => x.kind === wanted && isClassicLucaTab(x.tab.url)) || tabs.find((x) => x.kind === wanted))
    : tabs.find((x) => x.kind === wanted);
  if (existing?.tab?.id) {
    if (wanted === 'luca' && !isClassicLucaTab(existing.tab.url)) {
      await chrome.tabs.update(existing.tab.id, { url: AGENT_HOME_URL[wanted], active: focus }).catch(() => {});
      if (focus && existing.tab.windowId) {
        await chrome.windows.update(existing.tab.windowId, { focused: true }).catch(() => {});
      }
      return { ok: true, opened: false, navigated: true, tabId: existing.tab.id, kind: wanted };
    }
    if (focus) await chrome.tabs.update(existing.tab.id, { active: true }).catch(() => {});
    if (focus && existing.tab.windowId) {
      await chrome.windows.update(existing.tab.windowId, { focused: true }).catch(() => {});
    }
    await restartAgentIn(existing.tab.id, wanted);
    return { ok: true, opened: false, tabId: existing.tab.id, kind: wanted };
  }
  const tab = await chrome.tabs.create({ url: AGENT_HOME_URL[wanted], active: focus });
  return { ok: true, opened: true, tabId: tab.id, kind: wanted };
}

async function getStatus() {
  const tabs = await findAgentTabs();
  const statuses = await Promise.all(
    tabs.map(async (x) => {
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: x.tab.id },
          world: 'MAIN',
          func: () => ({
            running: !!(window.__morenAgent && window.__morenAgent.running),
            version: window.__morenAgent ? window.__morenAgent.version : null,
            url: location.href.slice(0, 80),
          }),
        });
        return { kind: x.kind, tabId: x.tab.id, ...result };
      } catch (e) {
        return { kind: x.kind, tabId: x.tab.id, running: false, error: String(e) };
      }
    }),
  );

  // Aggregate by kind
  const luca = statuses.filter((s) => s.kind === 'luca');
  const mihsap = statuses.filter((s) => s.kind === 'mihsap');
  return {
    count: tabs.length,
    luca: {
      tabs: luca.length,
      running: luca.some((s) => s.running),
      version: luca.find((s) => s.version)?.version || null,
    },
    mihsap: {
      tabs: mihsap.length,
      running: mihsap.some((s) => s.running),
      version: mihsap.find((s) => s.version)?.version || null,
    },
    raw: statuses,
  };
}

// ─── Portal'ın content script'inden gelen komutları dinle ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.__internal) return false;
  (async () => {
    try {
      if (msg.action === 'restart_all') {
        sendResponse(await restartAll());
      } else if (msg.action === 'open_agent') {
        const target = typeof msg.target === 'object' && msg.target ? msg.target.target : msg.target;
        const focus = !(typeof msg.target === 'object' && msg.target && msg.target.focus === false);
        sendResponse(await ensureAgentTab(target, { focus }));
      } else if (msg.action === 'status') {
        sendResponse(await getStatus());
      } else if (msg.action === 'ping') {
        sendResponse({ ok: true, ext: 'moren-auto-agent', version: chrome.runtime.getManifest().version });
      } else {
        sendResponse({ ok: false, error: 'unknown action' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async response
});

// ─── Watchdog: 5 dk'da bir tüm agent sekmelerini kontrol et ───
chrome.alarms.create('moren_watchdog', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'moren_watchdog') return;
  const status = await getStatus();
  for (const t of status.raw || []) {
    if (!t.running) {
      console.log('[Moren Auto-Agent BG] dead agent in', t.kind, 'tab', t.tabId, '→ restart');
      await restartAgentIn(t.tabId, t.kind);
    }
  }
});

// ─── İlk yükleme: extension kurulduğunda mevcut sekmeleri tara ve reload et ───
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Moren Auto-Agent] kuruldu');
  const tabs = await findAgentTabs();
  for (const x of tabs) {
    chrome.tabs.reload(x.tab.id).catch(() => {});
  }
});
