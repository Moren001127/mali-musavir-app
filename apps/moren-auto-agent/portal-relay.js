// Portal sayfasında ISOLATED world'de çalışır.
// chrome.runtime.* API'sine erişimi var. Main world'deki portal-bridge.js'in
// postMessage'larını yakalar, background.js'e relay eder, cevabı geri gönderir.

window.addEventListener('message', async (ev) => {
  if (!ev.data || !ev.data.__morenAutoAgentRequest) return;
  const { id, action, target } = ev.data;
  try {
    const response = await chrome.runtime.sendMessage({ __internal: true, action, target });
    window.postMessage(
      { __morenAutoAgentResponse: true, id, payload: response },
      '*',
    );
  } catch (e) {
    window.postMessage(
      { __morenAutoAgentResponse: true, id, error: String(e) },
      '*',
    );
  }
});

console.log('[Moren Auto-Agent] Portal relay aktif (isolated world)');
