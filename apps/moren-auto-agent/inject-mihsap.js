// Mihsap sayfalarına Moren Agent runtime'ını otomatik enjekte eder.

(function mihsapAutoInject() {
  if (window.__morenAutoAgentInjected) return;
  window.__morenAutoAgentInjected = true;

  const RUNTIME_URL = 'https://mali-musavir-app-production.up.railway.app/agent-runtime.js';

  function injectAndRun() {
    if (window.__morenAgent && window.__morenAgent.running) {
      console.log('[Moren Auto-Agent] Mihsap: agent zaten çalışıyor v' + window.__morenAgent.version);
      window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'mihsap', status: 'already_running', version: window.__morenAgent.version } }));
      return;
    }
    console.log('[Moren Auto-Agent] Mihsap: runtime fetch ediliyor');
    fetch(RUNTIME_URL + '?_t=' + Date.now(), { credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (code) {
        try {
          // eslint-disable-next-line no-new-func
          (new Function(code))();
          console.log('[Moren Auto-Agent] Mihsap: agent başlatıldı v' + (window.__morenAgent && window.__morenAgent.version));
          window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'mihsap', status: 'started', version: window.__morenAgent && window.__morenAgent.version } }));
        } catch (e) {
          console.error('[Moren Auto-Agent] Mihsap: runtime execute hatası', e);
          window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'mihsap', status: 'error', error: String(e) } }));
        }
      })
      .catch(function (e) {
        console.error('[Moren Auto-Agent] Mihsap: runtime fetch hatası', e);
        window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'mihsap', status: 'error', error: String(e) } }));
      });
  }

  setTimeout(injectAndRun, 2000); // SPA boot beklesin

  // Self-healing
  setInterval(function () {
    if (!window.__morenAgent || !window.__morenAgent.running) {
      console.log('[Moren Auto-Agent] Mihsap: agent dead, re-injecting');
      window.__morenAutoAgentInjected = false;
      injectAndRun();
      window.__morenAutoAgentInjected = true;
    }
  }, 120000);

  // Manuel restart
  window.addEventListener('moren-auto-agent-restart', function () {
    console.log('[Moren Auto-Agent] Mihsap: manual restart triggered');
    window.__morenAgent = null;
    injectAndRun();
  });
})();
