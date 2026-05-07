// Moren Auto Agent — popup UI

async function refreshStatus() {
  const rows = document.getElementById('rows');
  rows.innerHTML = '<div class="empty">Yükleniyor...</div>';
  try {
    const tabs = await chrome.tabs.query({});
    const luca = tabs.filter((t) => /luca\.com\.tr/.test(t.url || ''));
    const mihsap = tabs.filter((t) => /app\.mihsap\.com/.test(t.url || ''));

    const fetchStatus = async (tab) => {
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => ({
            running: !!(window.__morenAgent && window.__morenAgent.running),
            version: window.__morenAgent ? window.__morenAgent.version : null,
          }),
        });
        return result;
      } catch (e) {
        return { running: false, error: String(e) };
      }
    };

    const lucaStatus = luca.length ? await fetchStatus(luca[0]) : null;
    const mihsapStatus = mihsap.length ? await fetchStatus(mihsap[0]) : null;

    const renderRow = (label, count, status) => {
      const div = document.createElement('div');
      div.className = 'row';
      let badge = '<span class="badge idle">Sekme yok</span>';
      if (count > 0) {
        if (status && status.running) {
          badge = '<span class="badge ok">Çalışıyor v' + (status.version || '?') + '</span>';
        } else {
          badge = '<span class="badge dead">Ölü</span>';
        }
      }
      div.innerHTML = '<span class="label">' + label + (count > 1 ? ' (' + count + ' sekme)' : '') + '</span>' + badge;
      return div;
    };

    rows.innerHTML = '';
    rows.appendChild(renderRow('Luca', luca.length, lucaStatus));
    rows.appendChild(renderRow('Mihsap', mihsap.length, mihsapStatus));
  } catch (e) {
    rows.innerHTML = '<div class="empty">Hata: ' + String(e) + '</div>';
  }
}

document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

document.getElementById('restart').addEventListener('click', async () => {
  const btn = document.getElementById('restart');
  btn.disabled = true;
  btn.textContent = 'Yeniden başlatılıyor...';
  try {
    const tabs = await chrome.tabs.query({});
    const targets = tabs.filter((t) => /luca\.com\.tr|app\.mihsap\.com/.test(t.url || ''));
    for (const t of targets) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t.id },
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
      } catch (e) {}
    }
    setTimeout(() => {
      btn.textContent = 'Hepsini Yeniden Başlat';
      btn.disabled = false;
      refreshStatus();
    }, 1500);
  } catch (e) {
    btn.textContent = 'Hata: ' + String(e);
    setTimeout(() => {
      btn.textContent = 'Hepsini Yeniden Başlat';
      btn.disabled = false;
    }, 2000);
  }
});

refreshStatus();
setInterval(refreshStatus, 3000);
