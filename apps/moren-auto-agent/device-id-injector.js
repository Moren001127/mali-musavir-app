// v1.36.62: Device ID Injector — ISOLATED world content script.
//
// Sorun: localStorage per-origin'dir. Luca, Mihsap, Portal her biri farklı
// deviceId üretirdi → portal komut gönderiyor ama agent farklı deviceId ile
// claim yapıyor → eşleşme olmuyor.
//
// Çözüm: chrome.storage.local extension geneli paylaşılır. Bu script tüm
// origin'lerde çalışıp aynı deviceId'yi DOM'a (document.documentElement.dataset)
// yazar. MAIN world script'leri (portal-bridge.js, agent-runtime.js) bu
// dataset'ten okur — böylece TÜM origin'lerde aynı PC için aynı deviceId.

(async function deviceIdInjector() {
  try {
    let deviceId = '';
    if (chrome?.storage?.local) {
      const stored = await chrome.storage.local.get('moren_device_id');
      deviceId = stored?.moren_device_id || '';
      if (!deviceId) {
        deviceId = 'DEV-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        await chrome.storage.local.set({ moren_device_id: deviceId });
      }
    }
    if (!deviceId) {
      // Fallback: localStorage (single-origin, less ideal ama hiç yoksa)
      deviceId = localStorage.getItem('moren_device_id') || ('DEV-FB-' + Date.now().toString(36));
      try { localStorage.setItem('moren_device_id', deviceId); } catch (_) {}
    }
    document.documentElement.dataset.morenDeviceId = deviceId;
    // Olur da MAIN world bu zaten yüklendiyse, custom event ile haber ver
    try {
      window.dispatchEvent(new CustomEvent('moren-device-id-ready', { detail: { deviceId } }));
    } catch (_) {}
  } catch (e) {
    console.warn('[Moren Device-ID] Injector hata:', e?.message);
  }
})();
