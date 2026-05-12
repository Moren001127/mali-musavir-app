// Luca sayfalarına Moren Agent runtime'ını otomatik enjekte eder.
// MV3 content script + world: MAIN → main page context'inde çalışır,
// window.__morenAgent'a doğrudan erişebilir.

(function lucaAutoInject() {
  if (window.__morenAutoAgentInjected) return;
  window.__morenAutoAgentInjected = true;

  const RUNTIME_URL = 'https://portal.morenmusavirlik.com/moren-agent.js';

  function injectAndRun() {
    if (window.__morenAgent && window.__morenAgent.running) {
      console.log('[Moren Auto-Agent] Luca: agent calisiyor v' + window.__morenAgent.version + ' - runtime guncelligi kontrol ediliyor');
    }
    console.log('[Moren Auto-Agent] Luca: runtime fetch ediliyor → ' + RUNTIME_URL);
    fetch(RUNTIME_URL + '?_t=' + Date.now(), { credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (code) {
        // Runtime IIFE — main world'de execute
        try {
          // eslint-disable-next-line no-new-func
          (new Function(code))();
          console.log('[Moren Auto-Agent] Luca: agent başlatıldı v' + (window.__morenAgent && window.__morenAgent.version));
          window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'luca', status: 'started', version: window.__morenAgent && window.__morenAgent.version } }));
        } catch (e) {
          console.error('[Moren Auto-Agent] Luca: runtime execute hatası', e);
          window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'luca', status: 'error', error: String(e) } }));
        }
      })
      .catch(function (e) {
        console.error('[Moren Auto-Agent] Luca: runtime fetch hatası', e);
        window.dispatchEvent(new CustomEvent('moren-auto-agent-status', { detail: { tab: 'luca', status: 'error', error: String(e) } }));
      });
  }

  // İlk yükleme
  setTimeout(injectAndRun, 1500); // frameset hazırlansın

  // Self-healing: her 2 dk'da bir runtime'i tekrar yukle. Runtime ayni surumse
  // kendi icinde no-op yapar; eski surumse eski instance'i durdurup yenisini acar.
  setInterval(function () {
    if (!window.__morenAgent || !window.__morenAgent.running) console.log('[Moren Auto-Agent] Luca: agent dead, re-injecting');
    injectAndRun();
  }, 120000);

  // Manuel restart event listener
  window.addEventListener('moren-auto-agent-restart', function () {
    console.log('[Moren Auto-Agent] Luca: manual restart triggered');
    window.__morenAgent = null;
    injectAndRun();
  });
})();
