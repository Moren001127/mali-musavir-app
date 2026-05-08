// Portal sayfasında MAIN world'e enjekte edilir.
// Portal koduna `window.__morenAutoAgent` bridge'ini sağlar.
//
// Mimari: main world chrome.* API'lerine erişemediği için
// postMessage ile ISOLATED world'deki portal-relay.js'e mesaj atar,
// o da chrome.runtime.sendMessage ile background'a yönlendirir.

(function portalBridge() {
  if (window.__morenAutoAgent) return;

  const pendingResponses = new Map();

  // v1.36.61: Stabil deviceId — portal sayfasından gönderilen komutlar bu PC'ye target'lanır.
  // Aynı kullanıcının her tarayıcı/profil için farklı deviceId olur ama aynı tarayıcıda
  // sabit kalır (localStorage). Aynı PC'de açılan agent runtime'ı da aynı deviceId'yi kullanır.
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('moren_device_id') || '';
    if (!deviceId) {
      deviceId = 'DEV-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      localStorage.setItem('moren_device_id', deviceId);
    }
  } catch (e) {
    deviceId = 'DEV-FALLBACK-' + Date.now().toString(36);
  }

  window.__morenAutoAgent = {
    installed: true,
    version: '1.0.0',
    deviceId,                              // ← Portal createCommand bunu okuyup targetDeviceId olarak gönderir
    restartAll: () => sendCommand('restart_all'),
    status: () => sendCommand('status'),
    ping: () => sendCommand('ping'),
  };

  function sendCommand(action) {
    return new Promise((resolve, reject) => {
      const id = 'mab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      pendingResponses.set(id, { resolve, reject });
      window.postMessage({ __morenAutoAgentRequest: true, id, action }, '*');
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

  console.log('[Moren Auto-Agent] Portal bridge hazır → window.__morenAutoAgent');
})();
