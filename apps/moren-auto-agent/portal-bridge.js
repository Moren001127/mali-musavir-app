// Portal sayfasında MAIN world'e enjekte edilir.
// Portal koduna `window.__morenAutoAgent` bridge'ini sağlar.
//
// v1.36.62: Stabil deviceId DOM dataset'ten okunur (extension geneli, tüm origin'lerde aynı).
// device-id-injector.js (ISOLATED world) chrome.storage.local'dan okuyup dataset'e yazar.

(function portalBridge() {
  if (window.__morenAutoAgent) return;

  const pendingResponses = new Map();

  let deviceId = (document.documentElement?.dataset?.morenDeviceId || '').trim();
  if (!deviceId) {
    try { deviceId = localStorage.getItem('moren_device_id') || ''; } catch (_) {}
  }
  if (!deviceId) {
    deviceId = 'DEV-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    try { localStorage.setItem('moren_device_id', deviceId); } catch (_) {}
  }

  window.__morenAutoAgent = {
    installed: true,
    version: '1.0.1',
    deviceId,
    restartAll: () => sendCommand('restart_all'),
    openAgent: (target, options) => sendCommand('open_agent', { target, ...(options || {}) }),
    status: () => sendCommand('status'),
    ping: () => sendCommand('ping'),
  };

  // Injector geç gelirse deviceId güncelle
  window.addEventListener('moren-device-id-ready', (ev) => {
    try {
      const newId = ev?.detail?.deviceId;
      if (newId && window.__morenAutoAgent) window.__morenAutoAgent.deviceId = newId;
    } catch (_) {}
  });

  function sendCommand(action, target) {
    return new Promise((resolve, reject) => {
      const id = 'mab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      pendingResponses.set(id, { resolve, reject });
      window.postMessage({ __morenAutoAgentRequest: true, id, action, target }, '*');
      setTimeout(() => {
        if (pendingResponses.has(id)) {
          pendingResponses.delete(id);
          reject(new Error('moren-auto-agent: timeout'));
        }
      }, 8000);
    });
  }

  window.addEventListener('message', (ev) => {
    if (!ev.data || !ev.data.__morenAutoAgentResponse) return;
    const { id, payload, error } = ev.data;
    const pending = pendingResponses.get(id);
    if (!pending) return;
    pendingResponses.delete(id);
    if (error) pending.reject(new Error(error));
    else pending.resolve(payload);
  });

  console.log('[Moren Auto-Agent] Portal bridge hazır → window.__morenAutoAgent (deviceId: ' + deviceId + ')');
})();
