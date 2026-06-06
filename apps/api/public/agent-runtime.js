/* Moren Agent Runner — tarayıcıda Mihsap sekmesi açıkken çalışır.
   Bookmarklet:
     javascript:(function(){var s=document.createElement('script');s.src='https://portal.morenmusavirlik.com/moren-agent.js?v='+Date.now();document.head.appendChild(s);})();
*/
(function () {
  // Agent versiyon — UI'da gösterilir, debug için kritik
  const AGENT_VERSION = '1.40.2';
  const AGENT_INSTANCE_ID = 'mai_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  // === VERSION-AWARE RELOAD ===
  // Eski sürüm zaten çalışıyorsa: yeni bookmarklet tıklamasında sessizce öldür ve
  // yeniden başlat. Eski script'in setInterval'ları cleanup edilemez (ID yok),
  // ama yeni script aynı window'da paralel çalışır — bu kabul edilebilir çünkü
  // tüm flag'ler (lastSynced*, seenFids) yeni instance'a ait olur.
  if (window.__morenAgent) {
    const oldVersion = window.__morenAgent.version || '?';
    if (oldVersion === AGENT_VERSION) {
      console.log(`[Moren] v${AGENT_VERSION} zaten çalışıyor`);
      return;
    }
    console.warn(`[Moren] Eski sürüm (v${oldVersion}) tespit edildi, v${AGENT_VERSION}'e yükseltiliyor...`);
    try { window.__morenAgent.stopRequested = true; } catch {}
    try { document.getElementById('moren-agent-panel')?.remove(); } catch {}
    delete window.__morenAgent;
  }
  window.__morenAgent = { running: true, stopRequested: false, version: AGENT_VERSION, instanceId: AGENT_INSTANCE_ID };
  window.__morenAutoAgent = window.__morenAgent;

  function isCurrentAgentInstance() {
    return window.__morenAgent?.instanceId === AGENT_INSTANCE_ID
      && window.__morenAgent?.running === true
      && window.__morenAgent?.stopRequested !== true;
  }

  // Loud console banner — F12 açtığında hangi sürümün yüklü olduğunu net görsün
  console.log(
    `%c🟢 Moren Agent yüklendi · v${AGENT_VERSION}`,
    'background:#22c55e;color:#0f0d0b;padding:4px 10px;border-radius:4px;font-weight:bold;font-size:13px',
  );

  const API = 'https://mali-musavir-app-production.up.railway.app/api/v1';
  const LUCA_LOGIN_ENTRY_URL = 'https://agiris.luca.com.tr/LUCASSO/giris.erp';
  const LUCA_SSO_MAIN_URL = 'https://agiris.luca.com.tr/LUCASSO/main.erp';
  const LUCA_CLASSIC_URL = 'https://auygs.luca.com.tr/Luca/luca.do';
  let TOKEN = (document.documentElement?.dataset?.morenAgentToken || '').trim()
    || localStorage.getItem('moren_agent_token')
    || '';

  function restartAgentRuntime(reason = '', version = AGENT_VERSION) {
    try { console.warn('[Moren] Agent runtime yeniden baslatiliyor' + (reason ? ': ' + reason : '')); } catch {}
    try { window.__lucaJobRunning = false; } catch {}
    try { window.__morenAgent.stopRequested = true; } catch {}
    try { document.getElementById('moren-agent-panel')?.remove(); } catch {}
    try { delete window.__morenAgent; delete window.__morenAutoAgent; } catch {}
    try {
      const script = document.createElement('script');
      script.src = API + '/agent/runtime.js?v=' + encodeURIComponent(version) + '&ts=' + Date.now();
      script.async = true;
      (document.head || document.documentElement || document.body).appendChild(script);
      return true;
    } catch {
      return false;
    }
  }

  function recoverTransientLucaLock(reason = '') {
    try { window.__lucaJobRunning = false; } catch {}
    try { resetClassicLucaGirisBlankState(); } catch {}
    try { resetClassicLucaRepairState(); } catch {}
    try {
      delete window.__morenLucaEntryRedirectAt;
      delete window.__morenSsoGirisStartedAt;
      delete window.__morenSsoGirisDirectClassicAt;
      delete window.__morenSsoGirisWaitLogAt;
    } catch {}
    const hardReset = /FRAME_STUCK|GIRIS_DO_BLANK|FIRMA_OR_FRAME|SirketCombo|firma frame|classic frame/i.test(String(reason || ''));
    try {
      setStatus(hardReset
        ? 'Luca klasik ekran kilidi temizleniyor; giristen yeniden deneniyor'
        : 'Luca teknik kilit temizleniyor; oturum yeniden deneniyor');
    } catch {}
    try { location.href = hardReset ? LUCA_LOGIN_ENTRY_URL : LUCA_SSO_MAIN_URL; } catch {}
    setTimeout(() => {
      if (window.__morenAgent?.instanceId === AGENT_INSTANCE_ID) {
        restartAgentRuntime(reason || 'transient luca lock');
      }
    }, 1500);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function createPerfTracker() {
    const start = Date.now();
    let last = start;
    const steps = {};
    return {
      mark(name) {
        const now = Date.now();
        steps[name] = { totalMs: now - start, stepMs: now - last };
        last = now;
      },
      snapshot() {
        return { totalMs: Date.now() - start, steps };
      },
    };
  }

  async function withTimeoutValue(factory, timeoutMs, fallback) {
    let timedOut = false;
    let timer = null;
    const work = Promise.resolve()
      .then(factory)
      .catch((e) => {
        if (timedOut) return typeof fallback === 'function' ? fallback() : fallback;
        throw e;
      });
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(typeof fallback === 'function' ? fallback() : fallback);
      }, timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function compareAgentVersions(a, b) {
    const pa = String(a || '').split('.').map((n) => Number(n) || 0);
    const pb = String(b || '').split('.').map((n) => Number(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  let lastRuntimeVersionCheckAt = 0;
  async function ensureLatestAgentRuntime() {
    if (!isCurrentAgentInstance()) return false;
    const now = Date.now();
    if (now - lastRuntimeVersionCheckAt < 60000) return true;
    lastRuntimeVersionCheckAt = now;
    try {
      const r = await fetch(API + '/agent/version/latest?ts=' + now, {
        cache: 'no-store',
        headers: { 'X-Agent-Token': TOKEN },
      });
      if (!r.ok) return true;
      const data = await r.json().catch(() => null);
      const latest = data?.runtime || data?.version || '';
      if (!latest || compareAgentVersions(AGENT_VERSION, latest) >= 0) return true;
      console.warn(`[Moren] Yeni ajan runtime var: v${latest}. v${AGENT_VERSION} durdurulup yeniden yukleniyor.`);
      try { setStatus(`Ajan guncelleniyor: v${latest}`); } catch {}
      restartAgentRuntime(`v${latest} guncellemesi`, latest);
      return false;
    } catch {
      return true;
    }
  }

  function lucaManualDownloadMode() {
    try {
      return !!window.__morenManualDownloadMode || !!window.top?.__morenManualDownloadMode;
    } catch {
      return !!window.__morenManualDownloadMode;
    }
  }

  function allowLucaManualDownloads() {
    try { window.__morenManualDownloadMode = true; } catch {}
    try { if (window.top) window.top.__morenManualDownloadMode = true; } catch {}
    const payload = { source: 'moren-agent', type: 'set-expecting', expecting: false };
    try { window.postMessage(payload, '*'); } catch {}
    try { if (window.top && window.top !== window) window.top.postMessage(payload, '*'); } catch {}
    return true;
  }

  window.__morenAllowLucaDownloads = allowLucaManualDownloads;

  // v1.36.62: Device-aware komutlar — extension geneli (chrome.storage) deviceId.
  // device-id-injector.js (ISOLATED world) chrome.storage'dan okuyup DOM dataset'e yazıyor.
  // Tüm origin'ler (Luca, Mihsap, Portal) AYNI deviceId'yi paylaşır.
  // Eğer dataset henüz hazır değilse fallback olarak localStorage kullanılır.
  let DEVICE_ID = (document.documentElement?.dataset?.morenDeviceId || '').trim();
  if (!DEVICE_ID) {
    DEVICE_ID = localStorage.getItem('moren_device_id') || '';
  }
  if (!DEVICE_ID) {
    DEVICE_ID = 'DEV-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    try { localStorage.setItem('moren_device_id', DEVICE_ID); } catch (_) {}
  }
  // injector geç hazır olursa update et
  window.addEventListener('moren-device-id-ready', (ev) => {
    try {
      const newId = ev?.detail?.deviceId;
      if (newId && newId !== DEVICE_ID) {
        DEVICE_ID = newId;
      }
      const newToken = ev?.detail?.agentToken;
      if (newToken && newToken !== TOKEN) {
        TOKEN = newToken;
        try { localStorage.setItem('moren_agent_token', TOKEN); } catch (_) {}
      }
    } catch (_) {}
  });
  window.addEventListener('moren-agent-token-ready', (ev) => {
    try {
      const newToken = ev?.detail?.agentToken;
      if (newToken && newToken !== TOKEN) {
        TOKEN = newToken;
        try { localStorage.setItem('moren_agent_token', TOKEN); } catch (_) {}
      }
    } catch (_) {}
  });
  if (window.__morenAgent) window.__morenAgent.deviceId = DEVICE_ID;
  async function pingAgentStatus(running = true) {
    try {
      const agent = isLucaOrigin() ? 'luca' : 'mihsap';
      await fetch(API + '/agent/status/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
        body: JSON.stringify({
          agent,
          running,
          meta: {
            url: location.href,
            deviceId: DEVICE_ID,
            version: AGENT_VERSION,
            instanceId: AGENT_INSTANCE_ID,
          },
        }),
      });
    } catch {}
  }
  if (!TOKEN) {
    TOKEN = prompt('Moren Agent Token:') || '';
    if (!TOKEN) {
      alert('Token girilmedi. Kapatılıyor.');
      delete window.__morenAgent;
      return;
    }
    localStorage.setItem('moren_agent_token', TOKEN);
  }

  let lucaCredentialCache = null;
  let lucaCredentialCacheAt = 0;
  let activeCaptchaChallengeId = '';
  let activeCaptchaSignature = '';
  let activeCaptchaRequestSignature = '';
  let activeCaptchaRequestPromise = null;
  const captchaChallengeCounts = new Map();
  const MAX_CAPTCHA_CHALLENGES_PER_JOB = 5;
  let lucaLoginBusy = false;

  async function getLucaCredentialForAgent() {
    if (lucaCredentialCache && Date.now() - lucaCredentialCacheAt < 5 * 60 * 1000) {
      return lucaCredentialCache;
    }
    const r = await fetch(API + '/agent/luca/credential', {
      headers: { 'X-Agent-Token': TOKEN },
    });
    if (!r.ok) return null;
    const data = await r.json();
    lucaCredentialCache = data?.saved ? data : null;
    lucaCredentialCacheAt = Date.now();
    return lucaCredentialCache;
  }

  function visible(el) {
    try {
      const r = el.getBoundingClientRect();
      const s = el.ownerDocument.defaultView.getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch {
      return true;
    }
  }

  function setNativeValue(el, value) {
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch {
      try { el.value = value; } catch {}
    }
  }

  function normalizeLucaText(value) {
    return String(value || '')
      .replace(/[\u0130I\u0131]/g, 'i')
      .replace(/[\u011e\u011f]/g, 'g')
      .replace(/[\u015e\u015f]/g, 's')
      .replace(/[\u00c7\u00e7]/g, 'c')
      .replace(/[\u00d6\u00f6]/g, 'o')
      .replace(/[\u00dc\u00fc]/g, 'u')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function submitLoginByEnter(el) {
    try {
      el.focus?.({ preventScroll: true });
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }));
      }
    } catch {}
  }

  function lucaDocuments() {
    const docs = [];
    const add = (w) => {
      try {
        if (w?.document && !docs.includes(w.document)) docs.push(w.document);
        for (const fr of Array.from(w?.frames || [])) add(fr);
      } catch {}
    };
    add(window.top || window);
    add(window);
    return docs;
  }

  // ─── LUCA OPERATÖRÜ: ekranı anlamlı oku (SADECE OKUMA; yazma yok) ───
  function guessLabel(el) {
    try {
      if (el.id) {
        const lbl = el.ownerDocument.querySelector('label[for="' + el.id + '"]');
        if (lbl) return (lbl.innerText || lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }
      const a = el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder;
      if (a) return String(a).slice(0, 60);
      const cell = el.closest && el.closest('td');
      const prev = cell && cell.previousElementSibling;
      if (prev) return (prev.innerText || prev.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    } catch {}
    return '';
  }
  function readLucaScreenSnapshot() {
    const snap = { url: location.href, frames: [], text: '', fields: [], buttons: [], links: [] };
    const texts = [];
    for (const doc of lucaDocuments()) {
      try {
        const fname = (doc.defaultView && doc.defaultView.name) || '';
        snap.frames.push(fname || '(ana)');
        const bt = (doc.body && (doc.body.innerText || doc.body.textContent) || '').replace(/\s+/g, ' ').trim();
        if (bt) texts.push(bt.slice(0, 4000));
        for (const el of Array.from(doc.querySelectorAll('input, textarea, select'))) {
          if (!visible(el)) continue;
          const type = String(el.getAttribute('type') || el.tagName).toLowerCase();
          if (['hidden', 'submit', 'button'].includes(type)) continue;
          const f = {
            frame: fname, tip: type, etiket: guessLabel(el),
            name: el.name || null, id: el.id || null,
            deger: el.value != null ? String(el.value).slice(0, 200) : '',
          };
          if (el.tagName.toLowerCase() === 'select') {
            f.secenekler = Array.from(el.options || []).slice(0, 40).map((o) => o.text).filter(Boolean);
          }
          if (snap.fields.length < 200) snap.fields.push(f);
        }
        for (const el of Array.from(doc.querySelectorAll('button, input[type=button], input[type=submit], a'))) {
          if (!visible(el)) continue;
          const t = (el.value || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          const arr = el.tagName.toLowerCase() === 'a' ? snap.links : snap.buttons;
          if (arr.length < 100) arr.push(t.slice(0, 80));
        }
      } catch {}
    }
    snap.text = texts.join('\n---\n').slice(0, 12000);
    snap.buttons = Array.from(new Set(snap.buttons));
    snap.links = Array.from(new Set(snap.links)).slice(0, 120);
    return snap;
  }

  // LUCA OPERATÖRÜ — metne göre tıkla (self-contained; tüm frame'lerde arar)
  function lucaClickByText(text) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const t = norm(text);
    if (!t) return false;
    for (const doc of lucaDocuments()) {
      try {
        const nodes = Array.from(doc.querySelectorAll('a, button, input[type=button], input[type=submit], [onclick], [role="button"], td, span, div, li'));
        let target = nodes.find((el) => visible(el) && norm(el.value || el.innerText || el.textContent) === t);
        if (!target) target = nodes.find((el) => visible(el) && norm(el.value || el.innerText || el.textContent).includes(t));
        if (target) {
          try { target.scrollIntoView({ block: 'center' }); } catch {}
          try { target.click(); } catch {}
          try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView })); } catch {}
          return true;
        }
      } catch {}
    }
    return false;
  }

  // LUCA OPERATÖRÜ — etikete göre açılır liste (select) seç
  function lucaSelectByHint(hint, optionText) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const h = norm(hint);
    const o = norm(optionText);
    if (!o) return false;
    for (const doc of lucaDocuments()) {
      try {
        const selects = Array.from(doc.querySelectorAll('select')).filter(visible);
        for (const sel of selects) {
          const hay = norm(`${sel.name || ''} ${sel.id || ''} ${sel.getAttribute('aria-label') || ''}`);
          if (h && !hay.includes(h)) continue;
          const opt = Array.from(sel.options).find((op) => norm(op.text) === o)
            || Array.from(sel.options).find((op) => norm(op.text).includes(o));
          if (opt) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      } catch {}
    }
    return false;
  }

  function findInputByHints(doc, hints, opts = {}) {
    const inputs = Array.from(doc.querySelectorAll('input, textarea')).filter((el) => {
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (opts.password && type !== 'password') return false;
      if (!opts.password && type === 'password') return false;
      if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) return false;
      if (!visible(el)) return false;
      const hay = [
        el.name,
        el.id,
        el.placeholder,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('autocomplete'),
      ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return hints.some((h) => hay.includes(h));
    });
    return inputs[0] || null;
  }

  function findLoginFormParts() {
    for (const doc of lucaDocuments()) {
      const password = findInputByHints(doc, ['sifre', 'şifre', 'password', 'parola'], { password: true })
        || Array.from(doc.querySelectorAll('input[type=password]')).find(visible);
      if (!password) continue;
      const uyeNo = findInputByHints(doc, ['uye', 'üye', 'musteri', 'müşteri', 'firma no', 'abone']);
      const username = findInputByHints(doc, ['kullanici', 'kullanıcı', 'username', 'user', 'mail', 'email', 'kod']);
      const buttons = Array.from(doc.querySelectorAll('button, input[type=submit], input[type=button], a')).filter(visible);
      const submit = buttons.find((b) => {
        const hay = normalizeLucaText([
          b.textContent,
          b.value,
          b.title,
          b.id,
          b.className,
          b.getAttribute?.('aria-label'),
          b.getAttribute?.('onclick'),
        ].filter(Boolean).join(' '));
        return /\b(giris|login|tamam|devam|oturum)\b/.test(hay);
      })
        || buttons.find((b) => String(b.type || '').toLowerCase() === 'submit')
        || null;
      return { doc, uyeNo, username, password, submit };
    }
    return null;
  }

  async function fillLucaLoginFromPortal() {
    if (!isLucaOrigin() || window !== window.top) return { ok: false, reason: 'Luca top frame degil' };
    if (lucaLoginBusy) return { ok: true, pending: true };
    const parts = findLoginFormParts();
    if (!parts?.password) return { ok: false, reason: 'Luca sifre alani bulunamadi' };
    lucaLoginBusy = true;
    try {
      const cred = await getLucaCredentialForAgent();
      if (!cred?.saved) {
        setStatus('Luca sifresi portalda kayitli degil');
        return { ok: false, reason: 'Luca sifresi portalda kayitli degil' };
      }
      if (parts.uyeNo && cred.uyeNo) setNativeValue(parts.uyeNo, cred.uyeNo);
      if (parts.username && cred.username) setNativeValue(parts.username, cred.username);
      setNativeValue(parts.password, cred.password || '');
      await sleep(250);
      if (parts.submit) {
        await click(parts.submit);
      } else if (parts.password.form?.requestSubmit) {
        parts.password.form.requestSubmit();
      } else if (parts.password.form?.submit) {
        parts.password.form.submit();
      } else {
        submitLoginByEnter(parts.password);
      }
      setStatus('Luca girisi yapiliyor; guvenlik kodu gerekirse portalda acilacak');
      return { ok: true };
    } catch (e) {
      console.warn('[Moren] Luca credential autofill hata:', e?.message);
      return { ok: false, reason: e?.message || 'Luca otomatik giris hatasi' };
    } finally {
      setTimeout(() => { lucaLoginBusy = false; }, 4000);
    }
  }

  async function imageElementToDataUrl(img) {
    const src = img?.currentSrc || img?.src || '';
    if (!src) return null;
    if (src.startsWith('data:image/')) return src;
    const url = new URL(src, img.ownerDocument.location.href).toString();
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function findLucaCaptchaParts() {
    for (const doc of lucaDocuments()) {
      const imgs = Array.from(doc.querySelectorAll('img')).filter(visible);
      const image = imgs.find((img) => {
        const hay = [img.src, img.alt, img.title, img.id, img.className].join(' ').toLocaleLowerCase('tr-TR');
        return /captcha|guvenlik|güvenlik|dogrulama|doğrulama|kod/.test(hay);
      }) || imgs.find((img) => {
        const r = img.getBoundingClientRect();
        return r.width >= 45 && r.width <= 260 && r.height >= 18 && r.height <= 120;
      });
      if (!image) continue;
      const input = findInputByHints(doc, ['captcha', 'guvenlik', 'güvenlik', 'dogrulama', 'doğrulama', 'kod'])
        || Array.from(doc.querySelectorAll('input[type=text], input:not([type])')).filter(visible).slice(-1)[0];
      if (!input) continue;
      const buttons = Array.from(doc.querySelectorAll('button, input[type=submit], input[type=button], a')).filter(visible);
      const submit = buttons.find((b) => /tamam|devam|giris|giriş|onay|ok|login/i.test(String(b.textContent || b.value || b.title || '')))
        || buttons.find((b) => String(b.type || '').toLowerCase() === 'submit')
        || null;
      return { doc, image, input, submit };
    }
    return null;
  }

  async function bridgeLucaCaptchaToPortal(job, log = null) {
    if (!isLucaOrigin() || window !== window.top) return false;
    if (!job?.id) return false;
    const parts = findLucaCaptchaParts();
    if (!parts?.image || !parts?.input) return false;
    const signature = `${parts.image.src || ''}|${parts.input.name || parts.input.id || ''}|${location.href}`;
    try {
      if (!activeCaptchaChallengeId || activeCaptchaSignature !== signature) {
        let data = null;
        if (activeCaptchaRequestPromise && activeCaptchaRequestSignature === signature) {
          setStatus('Luca guvenlik kodu otomatik cozum bekliyor');
          if (log) await log('Luca guvenlik kodu otomatik cozum bekliyor');
          data = await activeCaptchaRequestPromise.catch(() => null);
        }
        if (!data) {
          const captchaKey = job.id || 'global';
          const storageKey = `moren_luca_captcha_count_${captchaKey}`;
          let previousCount = captchaChallengeCounts.get(captchaKey) || 0;
          try {
            previousCount = Math.max(previousCount, Number(localStorage.getItem(storageKey) || 0));
          } catch {}
          const nextCount = previousCount + 1;
          captchaChallengeCounts.set(captchaKey, nextCount);
          try { localStorage.setItem(storageKey, String(nextCount)); } catch {}
          if (nextCount > MAX_CAPTCHA_CHALLENGES_PER_JOB) {
            const msg = `Luca guvenlik kodu ${MAX_CAPTCHA_CHALLENGES_PER_JOB} kez tekrarlandi; ajan durduruldu. Kullanici/sifre veya CAPTCHA cevabi kontrol edilmeli.`;
            setStatus(msg);
            if (log) await log(msg);
            window.__morenAgent.stopRequested = true;
            await fetch(API + `/agent/luca/jobs/${job.id}/fail`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
              body: JSON.stringify({ error: msg }),
            }).catch(() => {});
            return true;
          }
          const captchaImage = await imageElementToDataUrl(parts.image);
          if (!captchaImage || !captchaImage.startsWith('data:image/')) return false;
          activeCaptchaRequestSignature = signature;
          activeCaptchaRequestPromise = (async () => {
            const r = await fetch(API + '/agent/luca/captcha', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
              body: JSON.stringify({
                jobId: job?.id || null,
                deviceId: DEVICE_ID,
                captchaImage,
                expiresInSec: 180,
                context: {
                  url: location.href,
                  title: document.title,
                  jobTip: job?.tip || null,
                  donem: job?.donem || null,
                },
              }),
            });
            if (!r.ok) return null;
            return r.json();
          })();
          try {
            data = await activeCaptchaRequestPromise;
          } finally {
            activeCaptchaRequestPromise = null;
            activeCaptchaRequestSignature = '';
          }
        }
        if (!data) return false;
        activeCaptchaChallengeId = data?.challenge?.id || '';
        activeCaptchaSignature = signature;
        if (data?.challenge?.status === 'answered') {
          setStatus('Luca guvenlik kodu otomatik cozuldu; uygulanıyor');
          if (log) await log('Luca guvenlik kodu otomatik cozuldu; uygulanıyor');
        } else {
          setStatus('Luca guvenlik kodu portalda bekleniyor');
          if (log) await log('Luca guvenlik kodu portalda bekleniyor');
        }
      }
      const started = Date.now();
      while (Date.now() - started < 180000 && activeCaptchaChallengeId) {
        await sleep(1500);
        const ansRes = await fetch(API + `/agent/luca/captcha/${activeCaptchaChallengeId}/answer`, {
          headers: { 'X-Agent-Token': TOKEN },
        });
        if (!ansRes.ok) continue;
        const ans = await ansRes.json();
        if (ans.status === 'cancelled' || ans.status === 'expired') {
          activeCaptchaChallengeId = '';
          activeCaptchaSignature = '';
          return true;
        }
        if (ans.status === 'answered' && ans.answer) {
          setNativeValue(parts.input, ans.answer);
          await sleep(200);
          const submitStartedAt = Date.now();
          if (parts.submit) parts.submit.click();
          await sleep(700);
          if (Date.now() - submitStartedAt < 2500 && parts.input?.isConnected && /captchaKontrol|giris\.erp/i.test(location.href)) {
            submitLoginByEnter(parts.input);
            await sleep(500);
          }
          if (parts.input?.isConnected && /captchaKontrol|giris\.erp/i.test(location.href)) {
            try { parts.input.form?.requestSubmit?.(); } catch {}
            try { parts.input.form?.submit?.(); } catch {}
          }
          await fetch(API + `/agent/luca/captcha/${activeCaptchaChallengeId}/consume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
            body: JSON.stringify({ ok: true }),
          }).catch(() => {});
          activeCaptchaChallengeId = '';
          activeCaptchaSignature = '';
          setStatus('Luca guvenlik kodu uygulandi');
          if (log) await log('Luca guvenlik kodu uygulandi');
          return true;
        }
      }
    } catch (e) {
      console.warn('[Moren] captcha bridge hata:', e?.message);
    }
    return true;
  }

  async function keepLucaLoginAndCaptchaReady() {
    if (!isLucaOrigin() || window !== window.top) return;
    // Normal Luca kullanimi kullanicinin kendi ekraninda kalmali.
    // CAPTCHA/otomatik giris sadece processLucaJobs icinde aktif portal job'u
    // varken calisir; aksi halde manuel Luca girisindeki kodu sahiplenmeyiz.
  }
  setInterval(keepLucaLoginAndCaptchaReady, 3000);
  setTimeout(keepLucaLoginAndCaptchaReady, 1200);

  // === MIHSAP TOKEN SENKRONİZASYONU ===
  // MIHSAP JWT'sini backend'e gönder (fatura çekme için gerekli)
  let lastSyncedMihsapToken = '';
  let lastSyncedMihsapTokenAt = 0;
  function mihsapJwtExpMs(token) {
    try {
      const payload = JSON.parse(atob(String(token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return Number(payload?.exp || 0) * 1000;
    } catch {
      return 0;
    }
  }
  function getBestMihsapToken() {
    const candidates = [];
    const readStore = (store) => {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i) || '';
          const val = String(store.getItem(key) || '').trim().replace(/^Bearer\s+/i, '');
          if (val.length < 20) continue;
          if (!/token|jwt|auth|access/i.test(key) && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(val)) continue;
          candidates.push({ key, val, exp: mihsapJwtExpMs(val) });
        }
      } catch {}
    };
    readStore(localStorage);
    readStore(sessionStorage);
    try {
      for (const part of String(document.cookie || '').split(';')) {
        const [rawKey, ...rest] = part.split('=');
        const key = (rawKey || '').trim();
        const val = decodeURIComponent(rest.join('=') || '').trim().replace(/^Bearer\s+/i, '');
        if (val.length >= 20 && (/token|jwt|auth|access/i.test(key) || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(val))) {
          candidates.push({ key, val, exp: mihsapJwtExpMs(val) });
        }
      }
    } catch {}
    const now = Date.now();
    const live = candidates.filter((c) => !c.exp || c.exp > now + 30_000);
    const pool = live.length ? live : candidates;
    pool.sort((a, b) => (b.exp || 0) - (a.exp || 0) || b.val.length - a.val.length);
    return pool[0]?.val || '';
  }
  async function syncMihsapToken() {
    try {
      const mihsapToken = getBestMihsapToken();
      if (!mihsapToken || mihsapToken.length < 20) return;
      if (mihsapToken === lastSyncedMihsapToken && Date.now() - lastSyncedMihsapTokenAt < 5 * 60 * 1000) return; // değişmemiş
      const email = localStorage.getItem('rememberedEmail') || '';
      const r = await fetch(API + '/agent/mihsap/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': TOKEN,
        },
        body: JSON.stringify({ token: mihsapToken, email }),
      });
      if (r.ok) {
        lastSyncedMihsapToken = mihsapToken;
        lastSyncedMihsapTokenAt = Date.now();
        console.log('[Moren] MIHSAP token backend ile senkronize edildi');
      }
    } catch (e) {
      console.warn('[Moren] MIHSAP token sync hata:', e?.message);
    }
  }
  // İlk açılışta ve 60 saniyede bir kontrol et
  syncMihsapToken();
  setInterval(syncMihsapToken, 60000);

  // === LUCA TOKEN SENKRONİZASYONU ===
  // Sayfa Luca (web.luca.com.tr / muhasebe.luca.com.tr / vb.) üzerindeyse,
  // document.cookie + localStorage içinden session anahtarı yakalanır ve
  // backend'e gönderilir. Luca'nın authorization deseni klasik .NET
  // cookie tabanlı; bütün cookie header'ı + localStorage["auth"] gibi
  // anahtarlarını toplu aktarıp backend filtreler.
  let lastSyncedLucaKey = '';
  function isLucaOrigin() {
    return /luca\.com\.tr|luca\.net\.tr/i.test(location.hostname);
  }
  function isLucaLandingPage() {
    const host = String(location.hostname || '').toLowerCase();
    return host === 'www.luca.com.tr' || host === 'luca.com.tr';
  }
  function isLucaSsoMainPage() {
    const host = String(location.hostname || '').toLowerCase();
    const path = String(location.pathname || '').toLowerCase();
    return host === 'agiris.luca.com.tr' && path.includes('/lucasso/main.erp');
  }
  function findClassicLucaEntryElement() {
    const norm = (value) => normalizeLucaText(value).replace(/\s+/g, ' ').trim();
    // Tile'lar genelde <div onclick> veya <a><img/> şeklinde, basit selector yetersiz.
    // Top-level clickable container'ları da topla (div/li/figure + onclick yada child img).
    const candidates = Array.from(document.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [onclick], [role="button"], div, li, figure'
    ));
    const scored = [];
    for (const el of candidates) {
      try {
        if (!visible(el)) continue;
        // Tıklanabilir mi? onclick attribute, role=button, ya da <a> olmalı.
        // Aksi halde sıradan <div>'leri dışla (sayfa konteyneri vb).
        const tag = String(el.tagName || '').toLowerCase();
        const hasClickHandler = el.getAttribute('onclick')
          || el.getAttribute('role') === 'button'
          || tag === 'a' || tag === 'button' || tag === 'input';
        const hasImgInside = el.querySelector && el.querySelector('img');
        if (!hasClickHandler && !hasImgInside) continue;
        // Çok geniş container'ları ele (body içeren tüm sayfa vb).
        try { if (el.offsetWidth > 1200 || el.offsetHeight > 600) continue; } catch {}
        // textContent + image alt'larını topla
        const imgs = Array.from(el.querySelectorAll('img'))
          .map((img) => `${img.alt || ''} ${img.title || ''} ${img.src || ''}`)
          .join(' ');
        const text = norm([
          el.textContent,
          el.value,
          el.title,
          el.getAttribute('aria-label'),
          imgs,
        ].filter(Boolean).join(' '));
        const href = String(el.href || el.getAttribute('href') || '');
        const onclick = String(el.getAttribute('onclick') || '');
        const hay = norm(`${text} ${href} ${onclick}`);
        let score = 0;
        // ✓ POZİTİF: klasik Luca URL ya da paket text
        if (/auygs|luca\.do/.test(hay)) score += 10;
        if (/mali musavir paketi|mali musavir girisi/.test(hay)) score += 5;
        if (/mali musavir|muhasebe/.test(hay)) score += 2;
        // ✗ NEGATİF: yanlış tile'lar (2.0, mobil, arşiv, ofis, beta)
        // "2.0" / "v2.0" / "20" badge'lerini yakala
        if (/\b2[\.\s]?0\b|v2[\.\s]?0|surum 2|version 2/.test(hay)) score -= 50;
        // Mobil / arşiv / ofis tile'ları
        if (/\bmobil\b|\bmobile\b/.test(hay)) score -= 50;
        if (/\barsiv\b|\bar[şs]iv\b/.test(hay)) score -= 50;
        if (/\bofis\b|\boffice\b/.test(hay)) score -= 50;
        if (/\bbeta\b|\byeni surum\b/.test(hay)) score -= 10;
        if (score > 0) scored.push({ el, score, text: text.slice(0, 80), href: href.slice(0, 120), onclick: onclick.slice(0, 120) });
      } catch {}
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }
  function classicEntryCandidateHint(limit = 6) {
    const norm = (value) => normalizeLucaText(value).replace(/\s+/g, ' ').trim();
    try {
      return Array.from(document.querySelectorAll('a, button, input, [onclick], [role="button"], img, area, div, li, figure'))
        .map((el) => {
          const imgs = Array.from(el.querySelectorAll?.('img') || [])
            .map((img) => `${img.alt || ''} ${img.title || ''} ${img.src || ''}`)
            .join(' ');
          const text = norm([
            el.textContent,
            el.value,
            el.title,
            el.alt,
            el.getAttribute?.('aria-label'),
            imgs,
          ].filter(Boolean).join(' '));
          const href = String(el.href || el.getAttribute?.('href') || '');
          const onclick = String(el.getAttribute?.('onclick') || '');
          const hay = norm(`${text} ${href} ${onclick}`);
          let score = 0;
          if (/formtarget|lucammp|mmp20|auygs|luca\.do/.test(hay)) score += 20;
          if (/mali musavir|mali musavir paketi|muhasebe/.test(hay)) score += 10;
          if (/\b2[\.\s]?0\b|v2[\.\s]?0|mobil|mobile|arsiv|arsiv|ofis|office|beta|yeni surum/.test(hay)) score -= 20;
          return { score, text: text.slice(0, 70), href: href.slice(0, 80), onclick: onclick.slice(0, 90) };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => `${x.text || x.href || x.onclick || '?'}${x.onclick ? ` | ${x.onclick}` : ''}`)
        .join(' || ');
    } catch {
      return '';
    }
  }
  async function runClassicSsoOpenAttempt(label, actionFn) {
    let openedUrl = '';
    const originalOpen = window.open;
    const originalSubmit = window.HTMLFormElement?.prototype?.submit;
    const formTargets = [];
    const absUrl = (url) => {
      try { return new URL(String(url || ''), location.href).toString(); }
      catch { return String(url || ''); }
    };
    try {
      window.open = function(url, target, features) {
        const href = absUrl(url);
        if (href) {
          openedUrl = href;
          try { location.href = href; } catch {}
          return window;
        }
        return originalOpen ? originalOpen.call(this, url, target, features) : null;
      };
      if (originalSubmit) {
        window.HTMLFormElement.prototype.submit = function() {
          try { if (this.target && this.target !== '_self') this.target = '_self'; } catch {}
          return originalSubmit.call(this);
        };
      }
      try {
        for (const form of Array.from(document.forms || [])) {
          formTargets.push([form, form.target]);
          if (form.target && form.target !== '_self') form.target = '_self';
        }
      } catch {}
      await actionFn();
      await sleep(1800);
      if (openedUrl && isLucaSsoMainPage()) {
        try { location.href = openedUrl; } catch {}
        return `${label} -> ${openedUrl.slice(0, 100)}`;
      }
      if (!isLucaSsoMainPage()) return label;
      return '';
    } catch {
      return '';
    } finally {
      try { window.open = originalOpen; } catch {}
      try { if (originalSubmit) window.HTMLFormElement.prototype.submit = originalSubmit; } catch {}
      try {
        for (const [form, target] of formTargets) {
          if (form && form.isConnected) form.target = target || '';
        }
      } catch {}
    }
  }

  async function tryOpenClassicLucaKnownAction() {
    const norm = (value) => normalizeLucaText(value).replace(/\s+/g, ' ').trim();
    const preferredActions = ['formTarget', 'lucaMmp20'];
    const candidates = Array.from(document.querySelectorAll(
      '[onclick], a, button, input[type="button"], input[type="submit"], [role="button"], img, area'
    ));
    for (const el of candidates) {
      if (!visible(el)) continue;
      const imgs = Array.from(el.querySelectorAll?.('img') || [])
        .map((img) => `${img.alt || ''} ${img.title || ''} ${img.src || ''}`)
        .join(' ');
      const text = norm([
        el.textContent,
        el.value,
        el.title,
        el.alt,
        el.getAttribute?.('aria-label'),
        imgs,
      ].filter(Boolean).join(' '));
      const href = String(el.href || el.getAttribute?.('href') || '');
      const onclick = String(el.getAttribute?.('onclick') || '');
      const hay = norm(`${text} ${href} ${onclick}`);
      if (/\b2[\.\s]?0\b|v2[\.\s]?0|mobil|mobile|arsiv|arsiv|ofis|office|beta|yeni surum/.test(hay)) continue;
      const explicitAction = preferredActions.find((action) => new RegExp(action, 'i').test(`${onclick} ${href} ${text}`));
      const classicText = (/mali musavir|mali musavir paketi|muhasebe/.test(hay) && /luca|paket|giris|auygs|mmp/.test(hay));
      const classicUrl = /auygs|luca\.do/.test(hay);
      if (!classicText && !classicUrl && !(explicitAction && text)) continue;
      const opened = await runClassicSsoOpenAttempt(
        explicitAction ? `element:${explicitAction}` : `element:${(text || href || onclick).slice(0, 80)}`,
        () => el.click(),
      );
      if (opened) return opened;
    }
    for (const action of preferredActions) {
      const rx = new RegExp(`gonder\\s*\\(\\s*['"]${action}['"]`, 'i');
      const el = candidates.find((node) => rx.test(String(node.getAttribute?.('onclick') || '')));
      if (el) {
        const opened = await runClassicSsoOpenAttempt(`onclick:${action}`, () => el.click());
        if (opened) return opened;
      }
    }
    for (const action of preferredActions) {
      try {
        if (typeof window.gonder === 'function' && classicEntryCandidateHint(3)) {
          const opened = await runClassicSsoOpenAttempt(`gonder:${action}`, () => window.gonder(action));
          if (opened) return opened;
        }
      } catch {}
    }
    return '';
  }
  async function openClassicLucaFromSsoMainForJobs(jobs, logPendingJob) {
    if (!isLucaSsoMainPage()) return false;
    const url = location.href.slice(0, 120);
    setStatus('Luca girisi tamam; klasik Luca ekranina geciliyor');
    for (const job of jobs) {
      await logPendingJob(job, `Luca girisi tamam; klasik Luca ekranina geciliyor. URL=${url}`);
    }
    if (!window.__morenLucaClassicRedirectAt || Date.now() - window.__morenLucaClassicRedirectAt > 15000) {
      window.__morenLucaClassicRedirectAt = Date.now();
      const started = Date.now();
      while (Date.now() - started < 12000) {
        const entry = findClassicLucaEntryElement();
        if (entry?.el) {
          for (const job of jobs) {
            await logPendingJob(job, `Klasik Luca giris aksiyonu tiklaniyor: ${entry.text || entry.href || entry.onclick || 'entry'}`);
          }
          const opened = await runClassicSsoOpenAttempt(
            `element:${entry.text || entry.href || entry.onclick || 'entry'}`,
            () => entry.el.click(),
          );
          if (opened) {
            for (const job of jobs) {
              await logPendingJob(job, `Klasik Luca ayni sekmede aciliyor: ${opened}`);
            }
            return true;
          }
        }
        const knownAction = await tryOpenClassicLucaKnownAction();
        if (knownAction) {
          for (const job of jobs) {
            await logPendingJob(job, `Klasik Luca bilinen ID/action ile aciliyor: ${knownAction}`);
          }
          return true;
        }
        await sleep(500);
      }
      const hint = classicEntryCandidateHint(5);
      for (const job of jobs) {
        await logPendingJob(job, `Klasik Luca SSO ana ekranda paket aksiyonu bulunamadi; bos luca.do URL'sine gidilmeyecek${hint ? `; adaylar: ${hint}` : ''}`);
      }
    }
    return true;
  }
  async function openLucaLoginEntryForJobs(jobs, logPendingJob) {
    if (!isLucaLandingPage()) return false;
    const url = location.href.slice(0, 120);
    setStatus('Luca ana sayfasi acik; sistem girisine geciliyor');
    for (const job of jobs) {
      await logPendingJob(job, `Luca ana sayfasi acik; LUCASSO giris ekranina geciliyor. URL=${url}`);
    }
    if (!window.__morenLucaEntryRedirectAt || Date.now() - window.__morenLucaEntryRedirectAt > 15000) {
      window.__morenLucaEntryRedirectAt = Date.now();
      try { location.href = LUCA_LOGIN_ENTRY_URL; } catch {}
    }
    return true;
  }
  function isDirectClassicLucaError() {
    try {
      const text = `${document.title || ''}\n${document.body?.textContent || ''}`;
      return location.hostname === 'auygs.luca.com.tr'
        && location.pathname.startsWith('/Luca/')
        && /LUCA\s+HATA|Lütfen sayfayı yenilemeyin|Lutfen sayfayi yenilemeyin/i.test(text);
    } catch {
      return false;
    }
  }
  async function syncLucaSession() {
    try {
      if (!isLucaOrigin()) return; // sadece Luca sayfasındaysa çalış
      // Tüm cookie + Luca'nın muhtemel JWT anahtarlarını topla
      const cookies = document.cookie || '';
      const lucaAuth =
        localStorage.getItem('token') ||
        localStorage.getItem('accessToken') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('luca_token') ||
        '';
      const signature = cookies + '|' + lucaAuth;
      if (!signature || signature.length < 10) return;
      if (signature === lastSyncedLucaKey) return;

      const email =
        localStorage.getItem('userEmail') ||
        localStorage.getItem('email') ||
        '';
      const r = await fetch(API + '/agent/luca/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': TOKEN,
        },
        body: JSON.stringify({
          token: lucaAuth || cookies.slice(0, 400), // en az cookie header
          cookies,
          origin: location.hostname,
          email,
        }),
      });
      if (r.ok) {
        lastSyncedLucaKey = signature;
        console.log('[Moren] Luca oturumu backend ile senkronize edildi');
      }
    } catch (e) {
      console.warn('[Moren] Luca sync hata:', e?.message);
    }
  }
  syncLucaSession();
  setInterval(syncLucaSession, 60000);

  // === İHÖ (İşletme Hesap Özeti) RESUME KEY ===
  // Reload sonrası devam: Luca firma değişikliği sayfayı yeniliyor → bu agent ölüyor
  // → yeni agent yüklendiğinde localStorage'da bekleyen IHO job varsa menü
  // navigasyonundan başlasın (firma seçim atla)
  const IHO_RESUME_KEY = '__morenIhoJobResume';

  async function checkIhoResume() {
    try {
      if (!isLucaOrigin()) return;
      const raw = localStorage.getItem(IHO_RESUME_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      // 5 dakikadan eski state'leri yoksay (kullanıcı manuel temizlememişse)
      if (!saved.__savedAt || Date.now() - saved.__savedAt > 5 * 60 * 1000) {
        localStorage.removeItem(IHO_RESUME_KEY);
        return;
      }
      console.log('[Moren İHÖ] Resume tespit edildi — menüden devam ediliyor:', saved.id?.slice(-6));
      window.__currentLucaJobId = saved.id;
      window.__lucaJobRunning = true;
      try {
        const blob = await fetchLucaGelirGiderListesi(saved);
        if (blob) {
          // Excel'i upload et — IHO için upload-iho?ihoId=...
          const fd = new FormData();
          fd.append('file', blob, `luca-IHO_FETCH-resume-${saved.donem}.xlsx`);
          const params = new URLSearchParams({ ihoId: saved.sessionId, jobId: saved.id });
          await fetch(`${API}/agent/luca/runner/upload-iho?${params}`, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN },
            body: fd,
          });
          await fetch(`${API}/agent/luca/jobs/${saved.id}/done`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
            body: JSON.stringify({ recordCount: 0 }),
          }).catch(() => {});
          console.log('[Moren İHÖ] ✓ Resume tamamlandı');
        }
      } catch (e) {
        console.warn('[Moren İHÖ] Resume hata:', e?.message);
        await fetch(`${API}/agent/luca/jobs/${saved.id}/fail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
          body: JSON.stringify({ error: 'Resume: ' + (e?.message || 'bilinmeyen') }),
        }).catch(() => {});
        try { localStorage.removeItem(IHO_RESUME_KEY); } catch {}
      } finally {
        window.__lucaJobRunning = false;
        window.__currentLucaJobId = null;
      }
    } catch (e) { console.warn('[Moren] checkIhoResume hata:', e?.message); }
  }
  // İlk yüklemede 5sn sonra resume kontrolü çalıştır (sayfa stabilize olsun)
  setTimeout(() => { checkIhoResume(); }, 5000);

  // === LUCA MUAVİN İŞ İŞLEYİCİSİ ===
  // Backend'den bekleyen job'ları çeker ve Luca sayfasında Excel
  // indirme butonuna tıklayarak muavin dosyasını yakalar, backend'e
  // geri yükler.
  async function processLucaJobs() {
    try {
      if (!isCurrentAgentInstance()) return;
      if (!isLucaOrigin()) return;
      // Luca'nin herhangi bir top frame'inde pending job'u gor ve agentin
      // hangi ekranda bekledigini portala yaz. Klasik Luca disinda islem
      // yapmadan once giris/yonlendirme adimini dener.
      // Sadece TOP frame'de poll yap — Luca FRAMESET olduğu için her frame'de
      // agent çalışıyor (manifest all_frames:true). Job poll/işleme tek elden,
      // yani üst pencerede yürür. İçerik frame'lerinde agent sadece DOM yardımcı
      // (frame-aware Excel button arama vs.).
      if (window !== window.top) return;
      if (!isCurrentAgentInstance()) return;
      if (window.__morenAgent.stopRequested) return;
      if (window.__lucaJobRunning) return;
      if (!(await ensureLatestAgentRuntime())) return;
      await pingAgentStatus(true);

      const pendingParams = new URLSearchParams({
        version: AGENT_VERSION,
        agentVersion: AGENT_VERSION,
        ts: String(Date.now()),
      });
      if (DEVICE_ID) pendingParams.set('deviceId', DEVICE_ID);
      const pendingUrl = API + '/agent/luca/jobs/pending?' + pendingParams.toString();
      const r = await fetch(pendingUrl, {
        cache: 'no-store',
        headers: { 'X-Agent-Token': TOKEN },
      });
      if (!r.ok) return;
      const jobs = await r.json();
      if (!Array.isArray(jobs) || jobs.length === 0) return;

      const logPendingJob = async (job, line) => {
        try {
          await fetch(API + `/agent/luca/jobs/${job.id}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
            body: JSON.stringify({ msg: line, line }),
          });
        } catch {}
      };

      const isClassicLuca = location.hostname === 'auygs.luca.com.tr'
        && location.pathname.startsWith('/Luca/');
      if (!isClassicLuca) {
        const firstJob = jobs[0];
        const url = location.href.slice(0, 120);
        if (await openLucaLoginEntryForJobs(jobs, logPendingJob)) return;
        const captchaHandled = await bridgeLucaCaptchaToPortal(firstJob, (line) => logPendingJob(firstJob, line)).catch(() => false);
        if (captchaHandled) return;
        if (await openClassicLucaFromSsoMainForJobs(jobs, logPendingJob)) return;

        const loginParts = findLoginFormParts();
        if (loginParts?.password) {
          setStatus('Luca giris ekraninda; otomatik giris deneniyor');
          for (const job of jobs) {
            await logPendingJob(job, `Luca agent giris ekraninda; otomatik giris deneniyor. URL=${url}`);
          }
          const loginResult = await fillLucaLoginFromPortal().catch((e) => ({ ok: false, reason: e?.message || String(e) }));
          if (!loginResult?.ok) {
            const reason = loginResult?.reason || 'bilinmeyen hata';
            setStatus(`Luca otomatik giris tamamlanamadi: ${reason}`);
            for (const job of jobs) {
              await logPendingJob(job, `Luca otomatik giris tamamlanamadi: ${reason}`);
            }
          }
          return;
        }

        if (isLucaOrigin()) {
          setStatus('Luca giris/ana sekmesi acik; klasik Luca sekmesini Luca acinca devam edilecek');
          for (const job of jobs) {
            await logPendingJob(job, `Luca agent klasik ekranda degil; normal Luca giris akisi bekleniyor. URL=${url}`);
          }
          return;
        }

        setStatus('Luca acik ama klasik Luca ekrani bekleniyor');
        for (const job of jobs) {
          await logPendingJob(job, `Luca agent klasik ekranda degil; job bekliyor. URL=${url}`);
        }
        return;
      }

      if (isDirectClassicLucaError()) {
        const url = location.href.slice(0, 120);
        setStatus('Luca ikinci sekmesi dogrudan acilmis; normal Luca girisine donuluyor');
        for (const job of jobs) {
          await logPendingJob(job, `Luca klasik ikinci sekme dogrudan acildigi icin hata verdi; normal Luca girisinden acilmali. URL=${url}`);
        }
        if (!window.__morenLucaEntryRedirectAt || Date.now() - window.__morenLucaEntryRedirectAt > 30000) {
          window.__morenLucaEntryRedirectAt = Date.now();
          try { location.href = LUCA_LOGIN_ENTRY_URL; } catch {}
        }
        return;
      }

      const allowClassicShellReady = jobs.length > 0 && jobs.every((job) => job?.tip === 'ACCOUNT_PLAN');
      const classicReady = await waitForClassicLucaReady(25000, { allowShellReady: allowClassicShellReady });
      if (!classicReady) {
        const repairState = noteClassicLucaNotReady();
        const url = location.href.slice(0, 120);
        setStatus('Klasik Luca açıldı; firma ekranı yükleniyor');
        const frameDiag = describeClassicLucaDomBrief();
        for (const job of jobs) {
          await logPendingJob(job, `Klasik Luca URL acik ama frm4/SirketCombo henuz yuklenmedi; sayfa hazirlaniyor. v${AGENT_VERSION}; ${frameDiag}. URL=${url}`);
        }
        const path = String(location.pathname || '');
        const bodyText = String(document.body?.textContent || '').replace(/\s+/g, ' ').trim();
        const isBlankClassicEntry =
          /\/Luca\/giris\.do/i.test(path) ||
          (/\/Luca\/(?:luca|giris)\.do/i.test(path) && bodyText.length < 30);
        if (isBlankClassicEntry) {
          // BUG FIX (E-Arsiv multi-mukellef takilma): Eski kodda sadece 15sn throttle
          // vardi, sayaç yoktu - sonsuz recovery loop'u olusabiliyordu (5 mukellef
          // hep ayni 'giris.do bos kaldi' log'unda kaliyordu). Yeni: max 5 deneme
          // sonrasi job'lari requeue edip oturumu sifirla.
          const blankState = readClassicLucaGirisBlankState();
          if (!blankState.lastActionAt || Date.now() - blankState.lastActionAt > 15000) {
            const nextBlankState = noteClassicLucaGirisBlank();
            if (nextBlankState.count >= 5) {
              const reason = `TRANSIENT_LUCA_CLASSIC_GIRIS_DO_BLANK: giris.do ${nextBlankState.count} kez bos kaldi; browser oturumu sifirlanacak`;
              for (const job of jobs) {
                await logPendingJob(job, reason);
                await fetch(API + `/agent/luca/jobs/${job.id}/requeue`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                  body: JSON.stringify({ reason }),
                }).catch(() => {});
              }
              resetClassicLucaGirisBlankState();
              recoverTransientLucaLock(reason);
              return;
            }
            for (const job of jobs) {
              await logPendingJob(job, `Klasik Luca giris.do bos kaldi (${nextBlankState.count}/5); SSO main.erp ekranina donulup bilinen ID/action ile yeniden acilacak`);
            }
            try { location.href = LUCA_SSO_MAIN_URL; } catch {}
          }
          return;
        }
        if (shouldReturnClassicLucaToSso(repairState)) {
          if (Number(repairState.count || 0) >= 5) {
            const reason = `TRANSIENT_LUCA_CLASSIC_FRAME_STUCK_RESET: Klasik Luca firma frame'i ${repairState.count} kontroldur acilmadi; browser oturumu sifirlanacak`;
            for (const job of jobs) {
              await logPendingJob(job, reason);
              await fetch(API + `/agent/luca/jobs/${job.id}/requeue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ reason }),
              }).catch(() => {});
            }
            resetClassicLucaRepairState();
            recoverTransientLucaLock(reason);
            return;
          }
          if (!classicLucaRepairRecentlyActed(repairState, 12000)) {
            markClassicLucaRepairAction('sso-main');
            for (const job of jobs) {
              await logPendingJob(job, `Klasik Luca firma frame'i acilmadi (${repairState.count}. kontrol); SSO ana ekrandan klasik paket yeniden acilacak`);
            }
            try { location.href = LUCA_SSO_MAIN_URL; } catch {}
          }
          return;
        }
        if (/\/Luca\/ssoGiris\.do/i.test(location.pathname)) {
          const now = Date.now();
          if (!window.__morenSsoGirisStartedAt) window.__morenSsoGirisStartedAt = now;
          if (now - window.__morenSsoGirisStartedAt > 15000 && (!window.__morenSsoGirisDirectClassicAt || now - window.__morenSsoGirisDirectClassicAt > 30000)) {
            window.__morenSsoGirisDirectClassicAt = now;
            for (const job of jobs) {
              await logPendingJob(job, 'Luca SSO ara sayfasi uzadi; klasik luca.do tamamlayici yonlendirme deneniyor');
            }
            try { location.href = LUCA_CLASSIC_URL; } catch {}
            return;
          }
          if (now - window.__morenSsoGirisStartedAt < 30000) {
            if (!window.__morenSsoGirisWaitLogAt || now - window.__morenSsoGirisWaitLogAt > 10000) {
              window.__morenSsoGirisWaitLogAt = now;
              for (const job of jobs) {
                await logPendingJob(job, 'Luca SSO ara sayfasi bekleniyor; bos luca.do denenmeyecek');
              }
            }
            return;
          }
          window.__morenSsoGirisStartedAt = 0;
          for (const job of jobs) {
            await logPendingJob(job, 'Luca SSO ara sayfasi klasik ekrana donusmedi; SSO main.erp ekranina donuluyor');
          }
          try { location.href = LUCA_SSO_MAIN_URL; } catch {}
          return;
        }
        window.__morenSsoGirisStartedAt = 0;
        if (!classicLucaRepairRecentlyActed(repairState, 20000)) {
          markClassicLucaRepairAction('reload');
          for (const job of jobs) {
            await logPendingJob(job, 'Klasik Luca firma frame\'i beklenenden gec geldi; sekme bir kez yenileniyor');
          }
          try { location.reload(); } catch {}
        }
        return;
      }

      resetClassicLucaRepairState();
      resetClassicLucaGirisBlankState();

      window.__lucaJobRunning = true;
      for (const job of jobs) {
        try {
          const isJobCancelled = async () => {
            if (window.__morenAgent.stopRequested) return true;
            try {
              const r = await fetch(API + `/agent/luca/jobs/${job.id}/status`, {
                headers: { 'X-Agent-Token': TOKEN },
              });
              if (!r.ok) return false;
              const j = await r.json();
              if (j && j.status === 'cancelled') {
                window.__morenAgent.stopRequested = true;
                return true;
              }
            } catch {}
            return false;
          };
          const throwIfCancelled = async () => {
            if (await isJobCancelled()) {
              throw new Error('CANCELLED_BY_USER');
            }
          };
          await throwIfCancelled();
          setStatus(`Luca: ${job.tip} çekiliyor (${job.donem})…`);

          // ─── EARLY-LOG HELPER ─── /start öncesinde de portal'a log gönder.
          // Job pending durumdayken errorMsg field'ına yazılır → portal canlı görür.
          // Bu sayede firma değişimi gibi /start öncesi aşamalar da kullanıcıya görünür.
          const earlyLog = async (line) => {
            try {
              if (await isJobCancelled()) return;
              await fetch(API + `/agent/luca/jobs/${job.id}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ msg: line, line }),
              });
            } catch {}
          };

          // ─── ERKEN FİRMA KONTROLÜ (Luca'dan veri çeken tüm job'lar için) ───
          // /start çağrılmadan ÖNCE Luca'da doğru firma seçili mi kontrol et.
          // Yanlışsa firma değiştir → sayfa yenilenir → bu agent ölür →
          // job pending'de kaldığı için yeni agent aynı job'u tekrar yakalar.
          // Kapsam: e-arşiv + e-fatura + mizan + kdv kontrol + tüm Luca veri çekmeleri
          const isLucaDataJob = [
            'EARSIV_SATIS','EARSIV_ALIS','EFATURA_SATIS','EFATURA_ALIS',
            'MIZAN','ACCOUNT_PLAN','KDV_MIZAN','IHO_FETCH','EDEFTER_FIS_LISTESI',
            'KDV_191','KDV_391','ISLETME_GELIR','ISLETME_GIDER',
            'MUAVIN','ISLETME',
            'GELIR_TABLOSU','BILANCO'
          ].includes(job.tip);
          if (isLucaDataJob) {
            await throwIfCancelled();
            await earlyLog(`🔍 Sıra geldi — Luca firma kontrolü yapılıyor`);
            let mukellefAdiEarly = '';
            try {
              const m = String(job.errorMsg || '').match(/\[META\] mukellefAdi=(.+?)(\n|$)/);
              if (m) mukellefAdiEarly = m[1].trim();
            } catch {}
            if (mukellefAdiEarly) {
              const frm4Early = getLucaFrame('frm4');
              if (frm4Early && frm4Early.contentDocument) {
                const scEarly = frm4Early.contentDocument.getElementById('SirketCombo');
                if (scEarly) {
                  const targetEarly = mukellefAdiEarly.toLocaleUpperCase('tr-TR').slice(0, 10).trim();
                  let bulunduEarly = null;
                  for (const opt of scEarly.options) {
                    const t = (opt.text || '').toLocaleUpperCase('tr-TR').trim();
                    if (t === targetEarly || t.startsWith(targetEarly.slice(0, Math.min(targetEarly.length, 8)))) {
                      bulunduEarly = opt;
                      break;
                    }
                  }
                  if (bulunduEarly && scEarly.value !== bulunduEarly.value) {
                    const mevcutEarly = scEarly.options[scEarly.selectedIndex]?.text?.trim() || '(yok)';
                    console.log(`[Moren] 🔄 Firma değiştiriliyor: "${mevcutEarly}" → "${bulunduEarly.text}" (job pending kalacak, reload sonrası devam)`);
                    setStatus(`Firma değiştiriliyor: ${bulunduEarly.text}`);
                    await earlyLog(`🔄 Firma değiştiriliyor: "${mevcutEarly}" → "${bulunduEarly.text}" — sayfa yenilenecek`);
                    const overrideOnWin = (w) => {
                      try { w.confirm = () => true; } catch {}
                      try { w.alert = () => undefined; } catch {}
                      try { w.prompt = () => ''; } catch {}
                    };
                    try { overrideOnWin(window); } catch {}
                    try { overrideOnWin(window.top); } catch {}
                    try { overrideOnWin(frm4Early.contentWindow); } catch {}
                    ['frm1','frm2','frm3','frm4','frm5','frm6','frm7'].forEach(name => {
                      try {
                        const fr = getLucaFrame(name);
                        if (fr && fr.contentWindow) overrideOnWin(fr.contentWindow);
                      } catch {}
                    });
                    scEarly.value = bulunduEarly.value;
                    scEarly.dispatchEvent(new Event('input', { bubbles: true }));
                    scEarly.dispatchEvent(new Event('change', { bubbles: true }));
                    const onChangeAttrEarly = scEarly.getAttribute('onchange');
                    if (onChangeAttrEarly) {
                      try {
                        new frm4Early.contentWindow.Function('event', onChangeAttrEarly).call(scEarly, new frm4Early.contentWindow.Event('change'));
                      } catch {}
                    }
                    const startEarly = Date.now();
                    while (Date.now() - startEarly < 5000) {
                      let clickedE = false;
                      ['frm1','frm2','frm3','frm4','frm5','frm6','frm7'].forEach(name => {
                        try {
                          const fr = getLucaFrame(name);
                          if (!fr || !fr.contentDocument) return;
                          for (const btn of fr.contentDocument.querySelectorAll('button, input[type=button], input[type=submit]')) {
                            const t = ((btn.textContent || btn.value || '').trim()).toLocaleLowerCase('tr-TR');
                            if ((t === 'tamam' || t === 'evet' || t === 'ok') && btn.offsetParent !== null) {
                              try { btn.click(); clickedE = true; } catch {}
                            }
                          }
                        } catch {}
                      });
                      if (clickedE) break;
                      await sleep(200);
                    }
                    // v1.36.59: Sabit 15sn bekleme yerine akıllı polling — frame yüklenince devam.
                    await earlyLog(`⏳ Sayfa yenileniyor, hazır olunca devam edilecek…`);
                    const earlyWaitStart = Date.now();
                    while (Date.now() - earlyWaitStart < 15000) {
                      await sleep(300);
                      try {
                        const fdocE = getLucaFrame('frm4')?.contentDocument;
                        if (fdocE && fdocE.getElementById('DonemCombo') && fdocE.body && fdocE.body.children.length > 0) {
                          await earlyLog(`✓ Sayfa hazır (${((Date.now() - earlyWaitStart) / 1000).toFixed(1)}sn)`);
                          break;
                        }
                      } catch {}
                    }
                    await sleep(800); // tampon
                    window.__lucaJobRunning = false;
                    return;
                  }
                }
              }
            }
          }

          const claimRes = await fetch(API + `/agent/luca/jobs/${job.id}/start`, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: DEVICE_ID, version: AGENT_VERSION, agentVersion: AGENT_VERSION }),
          });
          let claim = null;
          try { claim = await claimRes.clone().json(); } catch {}
          if (!claimRes.ok || claim?.claimed === false || claim?.ok === false) {
            console.log('[Moren] Luca job baska ajan tarafindan alindi, atlandi:', job.id);
            window.__lucaJobRunning = false;
            continue;
          }

          // İlk log: agent versiyonunu portal'a bildir (cache problemini debug için)
          const AGENT_VER = AGENT_VERSION;
          // Job log helper — kullanıcıya canlı progress göster
          // Backend `body.msg` bekliyor (luca.controller.ts logJob endpoint).
          // Global log buffer — kullanıcı DevTools Console'da
          //    copy(window.__morenLogs.join('\n'))
          // ile bütün log'u bir seferde clipboard'a alabilir.
          window.__morenLogs = window.__morenLogs || [];
          const log = async (line) => {
            try {
              if (await isJobCancelled()) return;
              const ts = new Date().toLocaleTimeString('tr-TR', {
                hour12: false,
                timeZone: 'Europe/Istanbul',
              });
              const formatted = `[${ts}] ${line}`;
              // 1) DevTools Console (kalıcı, kopyalanabilir, F12 → Console → sağ-tık → Save as)
              try { console.log('[Moren]', formatted); } catch {}
              // 2) window dizisi — istediği zaman copy(window.__morenLogs.join('\n')) ile alır
              window.__morenLogs.push(formatted);
              if (window.__morenLogs.length > 5000) window.__morenLogs.splice(0, 1000);
              // 3) Backend POST (mevcut akış — portal job ekranında gösteriliyor)
              await fetch(API + `/agent/luca/jobs/${job.id}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ msg: line, line }),
              });
            } catch {}
          };

          // İlk satır: agent versiyonu — cache debug için kritik
          await throwIfCancelled();
          await log(`🤖 Moren Agent v${AGENT_VER} | URL=${location.href.slice(0, 80)}`);

          // ─── EKRAN_OKU: Luca operatörü için o an açık ekranı oku (SADECE OKUMA) ───
          if (job.tip === 'EKRAN_OKU') {
            try {
              const snapshot = readLucaScreenSnapshot();
              await log(`👁 Ekran okundu: ${snapshot.frames.length} frame, ${snapshot.fields.length} alan, ${snapshot.buttons.length} buton`);
              await fetch(API + `/agent/luca/jobs/${job.id}/screen`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ snapshot }),
              }).catch(() => {});
              await fetch(API + `/agent/luca/jobs/${job.id}/done`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ recordCount: snapshot.fields.length }),
              }).catch(() => {});
              setStatus('Luca: ekran okundu');
            } catch (e) {
              await fetch(API + `/agent/luca/jobs/${job.id}/fail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ error: (e && e.message) || 'ekran okunamadı' }),
              }).catch(() => {});
            }
            continue; // diğer job tiplerinin Excel akışına girme
          }

          // ─── LUCA_ACTION: Luca'da yaz / seç / tıkla (geri dönülmez tıklama onaysız ÇALIŞMAZ) ───
          if (job.tip === 'LUCA_ACTION') {
            try {
              const p = job.payload || {};
              const action = String(p.action || '').toLowerCase();
              const hedef = String(p.hedef || p.etiket || p.metin || '');
              const deger = p.deger != null ? String(p.deger) : '';
              // Geri dönülmez butonlar — onaysız tıklanmaz
              const SUBMIT_RE = /kaydet|g[oö]nder|onayla|imzala|sil|aktar|tahakkuk|kesinle|tamamla|g[oö]nderim/i;
              let res;
              if (action === 'click' && SUBMIT_RE.test(hedef) && p.confirmed !== true) {
                res = { ok: false, blocked: true, message: `Geri dönülmez buton "${hedef}" — onay olmadan tıklanmadı.` };
              } else if (action === 'fill' || action === 'yaz') {
                let done = false;
                const hint = String(p.etiket || hedef).toLocaleLowerCase('tr-TR');
                for (const doc of lucaDocuments()) {
                  const el = findInputByHints(doc, [hint], {});
                  if (el) { setNativeValue(el, deger); done = true; break; }
                }
                res = done ? { ok: true, message: `'${p.etiket || hedef}' alanı dolduruldu` } : { ok: false, message: `Alan bulunamadı: ${p.etiket || hedef}` };
              } else if (action === 'select' || action === 'sec') {
                const ok = lucaSelectByHint(String(p.etiket || hedef), deger);
                res = ok ? { ok: true, message: `'${p.etiket || hedef}' = '${deger}' seçildi` } : { ok: false, message: `Seçim yapılamadı: ${p.etiket || hedef}` };
              } else if (action === 'click' || action === 'tikla') {
                const ok = lucaClickByText(hedef);
                res = ok ? { ok: true, message: `Tıklandı: ${hedef}` } : { ok: false, message: `Bulunamadı: ${hedef}` };
              } else {
                res = { ok: false, message: `Bilinmeyen işlem: ${action}` };
              }
              await log(`🛠 LUCA_ACTION ${action} → ${res.ok ? 'OK' : 'BAŞARISIZ'}: ${res.message}`);
              await sleep(800);
              try { res.screen = readLucaScreenSnapshot(); } catch {}
              await fetch(API + `/agent/luca/jobs/${job.id}/screen`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ snapshot: res }),
              }).catch(() => {});
              await fetch(API + `/agent/luca/jobs/${job.id}/done`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ recordCount: res.ok ? 1 : 0 }),
              }).catch(() => {});
              setStatus(`Luca: işlem ${res.ok ? 'tamam' : 'başarısız'}`);
            } catch (e) {
              await fetch(API + `/agent/luca/jobs/${job.id}/fail`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ error: (e && e.message) || 'işlem hatası' }),
              }).catch(() => {});
            }
            continue;
          }

          // ─── Job tipine göre rapor sayfası kontrolü ───
          // MIZAN          → Luca'da Mizan ekranı açık olmalı
          // KDV_191/KDV_391 → Defteri Kebir (Tüm Yazıcılar) ekranı + hesap kodu girilmiş
          // ISLETME_GELIR/GIDER → İşletme defteri ekranı
          const tipLabel = {
            MIZAN: 'Mizan ekranı (Genel Raporlar > Mizan)',
            ACCOUNT_PLAN: 'Genel Raporlar > Hesap Plani Listesi',
            KDV_MIZAN: 'KDV Beyanname için Mizan ekranı',
            EDEFTER_FIS_LISTESI: 'e-Defter On Kontrol icin Detay Fis Listesi ekrani',
            KDV_191: 'Defteri Kebir (Tüm Yazıcılar) — 191 hesap kodu',
            KDV_391: 'Defteri Kebir (Tüm Yazıcılar) — 391 hesap kodu',
            ISLETME_GELIR: 'İşletme defteri (gelir kayıtları)',
            ISLETME_GIDER: 'İşletme defteri (gider kayıtları)',
            IHO_FETCH: 'İşletme defteri ekranı (gelir + gider tek dosya)',
            EARSIV_SATIS: 'e-Arşiv Satış Faturaları',
            EARSIV_ALIS: 'e-Arşiv Alış Faturaları',
            EFATURA_SATIS: 'e-Fatura Satış Faturaları',
            EFATURA_ALIS: 'e-Fatura Alış Faturaları',
          }[job.tip] || job.tip;
          // E-arşiv tipleri için agent kendisi sayfayı açar — "açık olmalı" yerine "açılacak"
          const isEarsivJob = ['EARSIV_SATIS','EARSIV_ALIS','EFATURA_SATIS','EFATURA_ALIS'].includes(job.tip);
          if (isEarsivJob) {
            await log(`📋 ${tipLabel} sayfasını agent kendisi açacak…`);
          } else {
            await log(`📋 ${tipLabel} açık olmalı`);
          }

          const isZipJob = ['EARSIV_SATIS','EARSIV_ALIS','EFATURA_SATIS','EFATURA_ALIS'].includes(job.tip);
          await throwIfCancelled();
          const blob = await fetchLucaJobExcel(job, log, throwIfCancelled);
          await throwIfCancelled();
          if (!blob) throw new Error(isZipJob ? 'ZIP yakalanamadı' : 'Excel yakalanamadı');
          await log(`📥 ${isZipJob ? 'ZIP' : 'Excel'} indirildi (${Math.round(blob.size / 1024)} KB)`);
          if (!isZipJob) {
            try {
              const withTimeout = (promise, ms) => Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
              ]);
              const readBlobPart = (part, mode) => new Promise((resolve, reject) => {
                try {
                  const reader = new FileReader();
                  const timer = setTimeout(() => {
                    try { reader.abort(); } catch {}
                    reject(new Error('timeout'));
                  }, 2000);
                  reader.onload = () => { clearTimeout(timer); resolve(reader.result); };
                  reader.onerror = () => { clearTimeout(timer); reject(reader.error || new Error('read error')); };
                  if (mode === 'text') reader.readAsText(part);
                  else reader.readAsArrayBuffer(part);
                } catch (e) {
                  reject(e);
                }
              });
              const bytes = Array.from(new Uint8Array(await withTimeout(readBlobPart(blob.slice(0, 16), 'buffer'), 2500)))
                .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
                .join(' ');
              const head = String(await withTimeout(readBlobPart(blob.slice(0, 160), 'text'), 2500))
                .replace(/\s+/g, ' ')
                .replace(/[^\x20-\x7E\u00C0-\u017F]/g, '?')
                .slice(0, 140);
              await log(`🧾 Dosya imzasi: type=${blob.type || '-'} magic=${bytes} head="${head}"`);
              if (/^25 50 44 46/i.test(bytes) || /^%PDF/i.test(head) || /application\/pdf/i.test(blob.type || '')) {
                throw new Error('Luca raporu PDF olarak verdi. Rapor Turu Excel (xlsx) secilmeden bu dosya yuklenemez; tekrar Excel olarak denenecek.');
              }
            } catch (e) {
              const msg = String(e?.message || e);
              if (/Luca raporu PDF/i.test(msg)) throw e;
              await log(`⚠ Dosya imzasi okunamadi: ${msg.slice(0, 120)}`);
            }
          }

          // ─── Tipine göre upload endpoint ───
          const fd = new FormData();
          fd.append('file', blob, `luca-${job.tip}-${job.donem}.${isZipJob ? 'zip' : 'xlsx'}`);

          let uploadUrl;
          if (job.tip === 'MIZAN') {
            // Mizan'ın kendi upload endpoint'i — query string ile mukellef + dönem
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              donemTipi: String(inferDonemTipi(job.donem, job.donemTipi)),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-mizan?${params.toString()}`;
          } else if (job.tip === 'ACCOUNT_PLAN') {
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-account-plan?${params.toString()}`;
          } else if (job.tip === 'KDV_MIZAN') {
            // KDV beyanname için bağımsız mizan snapshot — mizan flow'u aynı, upload yolu farklı
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-kdv-mizan?${params.toString()}`;
          } else if (job.tip === 'KDV_ISLETME_GG') {
            // KDV beyanname işletme gelir-gider — bağımsız snapshot endpoint'i
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-kdv-isletme-gg?${params.toString()}`;
          } else if (job.tip === 'IHO_FETCH') {
            // İşletme Hesap Özeti — sessionId = İHÖ kayıt id'si
            const params = new URLSearchParams({
              ihoId: String(job.sessionId || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-iho?${params.toString()}`;
          } else if (job.tip === 'EDEFTER_FIS_LISTESI') {
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              donemTipi: String(inferDonemTipi(job.donem, job.donemTipi)),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-edefter-fis-listesi?${params.toString()}`;
          } else if (
            job.tip === 'EARSIV_SATIS' || job.tip === 'EARSIV_ALIS' ||
            job.tip === 'EFATURA_SATIS' || job.tip === 'EFATURA_ALIS'
          ) {
            // E-Arşiv / E-Fatura — Luca'dan ZIP indirme. tip = "<EARSIV|EFATURA>_<SATIS|ALIS>"
            const [belgeKaynak, satTip] = job.tip.split('_');
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              tip: satTip,
              belgeKaynak,
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-earsiv?${params.toString()}`;
          } else {
            // KDV / İşletme defteri — agent-token kabul eden yan endpoint
            // (eski /kdv-control/.../excel-from-runner endpoint'i JWT bekliyordu)
            const params = new URLSearchParams({
              sessionId: String(job.sessionId || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-kdv?${params.toString()}`;
          }

          await log(`⬆️ Upload basliyor: ${uploadUrl.split('?')[0].replace(API, '')}`);
          const uploadController = new AbortController();
          const uploadTimeout = setTimeout(() => uploadController.abort(), 120000);
          let uploadRes;
          try {
            uploadRes = await fetch(uploadUrl, {
              method: 'POST',
              headers: { 'X-Agent-Token': TOKEN },
              body: fd,
              signal: uploadController.signal,
            });
          } finally {
            clearTimeout(uploadTimeout);
          }
          if (!uploadRes.ok) {
            const errText = await uploadRes.text().catch(() => '');
            throw new Error(`Upload HTTP ${uploadRes.status}: ${errText.slice(0, 700)}`);
          }
          // Backend cevabını log'la — kaç fatura parse edildi göreceğiz
          let respDetail = '';
          let metaDetail = '';
          let uploadRecordCount = 0;
          try {
            const r = await uploadRes.clone().json();
            if (typeof r.inserted === 'number' || typeof r.total === 'number') {
              uploadRecordCount = Number(r.inserted || 0) + Number(r.duplicate || 0);
              respDetail = ` (parse: total=${r.total != null ? r.total : '?'}, inserted=${r.inserted != null ? r.inserted : '?'}, mükerrer=${r.duplicate != null ? r.duplicate : '?'}, hata=${r.skipped != null ? r.skipped : '?'})`;
            } else {
              uploadRecordCount = Number(r.parsed || r.imported || r.rows || r.hesapCount || r.toplamHesapAdet || 0);
              respDetail = ` (resp=${JSON.stringify(r).slice(0, 200)})`;
            }
            if (r.meta) {
              const e = (r.meta.entries || []).slice(0, 10).join(' | ');
              const diag = (r.meta.diagnostics || []).slice(0, 6).join(' || ');
              const errs = (r.meta.errors || []).slice(0, 5).join(' || ');
              metaDetail = ` | bufferSize=${r.meta.bufferSize}B, totalEntries=${r.meta.totalEntries}, xmlCount=${r.meta.xmlCount}, pdf=${r.meta.pdfMatched || 0}/${r.meta.pdfCount || 0}, html=${r.meta.htmlMatched || 0}/${r.meta.htmlCount || 0}, entries=[${e}]`;
              if (diag) metaDetail += ` || diag=[${diag}]`;
              if (errs) metaDetail += ` || ❌ insert hatalari=[${errs}]`;
            }
          } catch (e) {}
          await log(`✅ ${job.tip} backend'e yüklendi${respDetail}${metaDetail}`);

          // Done sinyali — backend job'u kapatsın (upload endpoint'i kendi içinde
          // yapmıyorsa explicit done çağrısı gerekir)
          await fetch(API + `/agent/luca/jobs/${job.id}/done`, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recordCount: uploadRecordCount }),
          }).catch(() => {});

          setStatus(`Luca: ${job.tip} başarıyla yüklendi`);
        } catch (e) {
          // "Fatura yok" durumu hata değil — temiz mesajla bitir
          const msg = (e)?.message || 'bilinmeyen hata';
          if (msg === 'CANCELLED_BY_USER') {
            setStatus(`Luca: ${job.tip} iptal edildi`);
            window.__morenAgent.stopRequested = false;
            continue;
          }
          const isNoFatura = (e)?.isNoFatura === true || /^NO_FATURA:/i.test(msg);
          // SAFE LOG: 'log' const try-block scope'da tanımlı, catch'ten erişilemez (v1.36.17 fix).
          // Doğrudan backend POST + console.warn yap, log() çağırma.
          const safeLog = async (line) => {
            try { console.log('[Moren-safe]', line); } catch {}
            try {
              await fetch(API + `/agent/luca/jobs/${job.id}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ msg: line, line }),
              });
            } catch {}
          };
          if (isNoFatura) {
            await safeLog(`ℹ ${job.tip}: Bu dönem için fatura bulunamadı, atlandı`);
            // Backend'e done olarak işaretle (fail değil) — 0 inserted
            await fetch(API + `/agent/luca/jobs/${job.id}/done`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
              body: JSON.stringify({ inserted: 0, noFatura: true }),
            }).catch(() => {});
            setStatus(`Luca: ${job.tip} — fatura yok`);
          } else {
            const isRetryableLucaRuntimeError =
              /Firma\s+DE[ĞG][Iİ]S[ŞS]MED[Iİ]|firma degisimi|frm4\/SirketCombo|firma frame|classic frame|giris\.do bos|giris\.do bo[sş]|TRANSIENT_LUCA/i.test(msg);
            if (isRetryableLucaRuntimeError) {
              const reason = `TRANSIENT_LUCA_FIRMA_OR_FRAME_STUCK_RESET: ${msg.slice(0, 500)}`;
              await safeLog(`Teknik Luca kilidi algilandi; browser oturumu sifirlanip is otomatik tekrar denenecek: ${reason}`);
              await fetch(API + `/agent/luca/jobs/${job.id}/requeue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ reason }),
              }).catch(() => {});
              setStatus(`Luca: ${job.tip} teknik kilit temizleniyor`);
              recoverTransientLucaLock(reason);
              return;
            }
            console.error('[Moren] Luca job hata:', e);
            await safeLog(`✗ ${job.tip} hata: ${msg.slice(0, 200)}`);
            // KRİTİK: /fail çağrısı SADECE try-catch içinde, log undefined olsa bile çalışır.
            // Bu yapılmazsa job pending'de kalır, sonsuz döngü olur!
            await fetch(API + `/agent/luca/jobs/${job.id}/fail`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
              body: JSON.stringify({ error: msg }),
            }).catch((fe) => console.error('[Moren] /fail çağrısı bile başarısız:', fe?.message));
          }
        }
      }
      window.__lucaJobRunning = false;
      // v1.38: Bu turda iş işlediysek kalan kuyruğu 15sn beklemeden boşalt —
      // arka arkaya gelen işler (toplu/zamanlı çekim) hemen sıradan devam etsin.
      // Kuyruk boşalınca bir sonraki yoklama [] döner ve döngü kendiliğinden durur.
      if (Array.isArray(jobs) && jobs.length > 0) {
        setTimeout(() => { try { processLucaJobs(); } catch {} }, 600);
      }
    } catch (e) {
      window.__lucaJobRunning = false;
      console.warn('[Moren] processLucaJobs:', e?.message);
    }
  }
  setTimeout(processLucaJobs, 1200);
  setInterval(processLucaJobs, 15000);

  /**
   * Luca sayfasında job tipine göre rapor formunu submit eder ve
   * dönen Excel blob'unu yakalar.
   *
   * STRATEJİ: "Rapor" butonunu tıklamak yerine form'u doğrudan fetch ile
   * POST ediyoruz. Bu sayede:
   *   - Yeni tab açılmıyor (Luca normalde target="_blank" ile açıyor)
   *   - Blob direkt elimizde — tarayıcı download dialog'u açmıyor
   *   - Cookie/session credentials: include ile korunuyor
   *
   * Desteklenen tipler:
   *   MIZAN          → frm3 / raporMizanForm / raporMizanAction.do
   *   KDV_191/391    → Defteri Kebir formu
   *   ISLETME_*      → İşletme defteri Gelir/Gider Listesi
   */
  async function fetchLucaJobExcel(job, log = (() => {}), throwIfCancelled = async () => {}) {
    // MIZAN ve KDV_MIZAN aynı Luca ekranını kullanır (Mizan ekranı, tüm hesaplar)
    // Sadece backend'de farklı tabloya yazılır (Mizan vs KdvLucaSnapshot)
    if (job.tip === 'MIZAN' || job.tip === 'KDV_MIZAN') {
      return await fetchLucaMizanExcel(job, log);
    }
    if (job.tip === 'ACCOUNT_PLAN') {
      return await fetchLucaAccountPlanExcel(job, log);
    }
    if (job.tip === 'EDEFTER_FIS_LISTESI') {
      return await fetchLucaDetayFisListesiExcel(job, log);
    }
    if (job.tip === 'KDV_191' || job.tip === 'KDV_391') {
      const hesap = job.tip === 'KDV_191' ? '191' : '391';
      return await fetchLucaDefteriKebirExcel(job, log, hesap);
    }
    if (job.tip === 'ISLETME_GELIR' || job.tip === 'ISLETME_GIDER') {
      const mode = job.tip === 'ISLETME_GELIR' ? 'gelir' : 'gider';
      return await fetchLucaIsletmeGelirGiderExcel(job, log, mode);
    }
    if (job.tip === 'KDV_ISLETME_GG') {
      // KDV beyanname işletme gelir-gider snapshot — tek Excel'de GELİR+GİDER (both).
      // KDV Kontrol'den bağımsız; upload yolu farklı (upload-kdv-isletme-gg).
      return await fetchLucaIsletmeGelirGiderExcel(job, log, 'both');
    }
    if (job.tip === 'IHO_FETCH') {
      // İşletme Hesap Özeti — yeni menü-bazlı tam otomasyon (v1.36.7+)
      // İşletme Defteri → Gider İşlemleri → Gelir/Gider Listesi yolu izlenir
      return await fetchLucaGelirGiderListesi(job, log);
    }
    if (job.tip === 'EARSIV_SATIS' || job.tip === 'EARSIV_ALIS' ||
        job.tip === 'EFATURA_SATIS' || job.tip === 'EFATURA_ALIS') {
      return await fetchLucaEarsivZip(job, log, throwIfCancelled);
    }
    throw new Error(`Desteklenmeyen Luca job tipi: ${job.tip}. Guvenlik geregi baska ekran ya da generic Excel fallback denenmedi.`);
  }

  function collectLucaClickMap(filterText = '') {
    const rows = [];
    const seenDocs = new Set();
    const seenEls = new Set();
    const fold = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0131/g, 'i')
      .replace(/\u0130/g, 'i')
      .toLowerCase();
    const extractII1a = (value) => {
      const m = String(value || '').match(/II1a\s*\(\s*(?:event\s*,\s*)?['"]([^'"]+)['"]/i);
      return m ? m[1] : '';
    };
    const visit = (win, label) => {
      try {
        if (!win?.document || seenDocs.has(win.document)) return;
        seenDocs.add(win.document);
        const doc = win.document;
        const nodes = Array.from(doc.querySelectorAll([
          'a[href]',
          'area[href]',
          'button',
          'input',
          'select',
          'textarea',
          '[onclick]',
          '[role="button"]',
          '[id]',
          '[name]',
        ].join(',')));
        for (const el of nodes) {
          if (!el || seenEls.has(el)) continue;
          seenEls.add(el);
          const tag = String(el.tagName || '').toLowerCase();
          const onclick = String(el.getAttribute?.('onclick') || '');
          const href = String(el.getAttribute?.('href') || '');
          const id = String(el.id || '');
          const name = String(el.getAttribute?.('name') || '');
          const role = String(el.getAttribute?.('role') || '');
          const type = String(el.getAttribute?.('type') || '');
          const value = String(el.value || '');
          const title = String(el.getAttribute?.('title') || '');
          const aria = String(el.getAttribute?.('aria-label') || '');
          const formAction = String(el.form?.getAttribute?.('action') || el.closest?.('form')?.getAttribute?.('action') || '');
          const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          const hay = `${tag} ${id} ${name} ${role} ${type} ${value} ${title} ${aria} ${text} ${onclick} ${href} ${formAction}`;
          if (filterText && !fold(hay).includes(fold(filterText))) continue;
          const isClickable =
            onclick || href || role === 'button' ||
            ['a', 'area', 'button', 'select', 'textarea'].includes(tag) ||
            (tag === 'input' && type !== 'hidden');
          if (!isClickable && !filterText) continue;
          rows.push({
            frame: label,
            tag,
            id,
            name,
            type,
            text,
            value: value.slice(0, 80),
            ii1a: extractII1a(`${onclick} ${href}`),
            onclick: onclick.slice(0, 180),
            href: href.slice(0, 180),
            formAction: formAction.slice(0, 180),
          });
        }
        for (let i = 0; i < (win.frames?.length || 0); i++) {
          try { visit(win.frames[i], `${label}/${win.frames[i]?.name || i}`); } catch {}
        }
      } catch {}
    };
    try { visit(window.top || window, 'top'); } catch {}
    try { visit(window, 'current'); } catch {}
    return rows;
  }

  try {
    window.__morenLucaClickMap = collectLucaClickMap;
    window.__morenDumpLucaClickMap = (filterText = '') => {
      const rows = collectLucaClickMap(filterText);
      try { console.table(rows); } catch { console.log(rows); }
      return rows;
    };
  } catch {}

  // ─────────────────────────────────────────────────────────────
  // E-ARŞİV / E-FATURA — Luca'dan ZIP çekim
  // ─────────────────────────────────────────────────────────────
  // Akış:
  //   1. SirketCombo → mukellefId/VKN ile firma seç (sayfa otomatik yenilenir)
  //   2. (Kullanıcı zaten Akıllı Entegrasyon → e-Arşiv/E-Fatura sayfasında)
  //   3. SORGU 1: Tarih modal aç → ay başı/sonu → Belgeleri Getir → tablo dolar
  //   4. SORGU 2 (gerekirse): bir sonraki ay başı → bugün → Belgeleri Getir → satırlar EKLENİR
  //   5. Tümünü Seç → Seçilenleri İndir → ZIP intercept
  // Tüm document/frame'lerde text'i arayıp HOVER + TIKLAR
  // Luca'nın menü dropdown'ları bazen sadece hover ile açılıyor.
  async function clickByTextEverywhere(text, log, opts = {}) {
    const { maxMs = 12000, exact = false } = opts;
    // Normalize: whitespace fazlalığı, case-insensitive, Türkçe karakterler korunur
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const target = norm(text);

    const collectAllDocs = () => {
      const docs = [document];
      const dive = (root) => {
        try {
          for (const fr of root.querySelectorAll('frame, iframe')) {
            if (fr.contentDocument) {
              docs.push(fr.contentDocument);
              dive(fr.contentDocument);
            }
          }
        } catch {}
      };
      dive(document);
      return docs;
    };

    // onclick attribute (veya parent zincirinde) içinde II1a('CODE',...) çağrısı varsa
    // direkt çıkar — synthetic click yerine fonksiyonu kendimiz tetikleyebiliriz.
    const extractOnclickInfo = (el) => {
      let cur = el;
      let depth = 0;
      while (cur && depth < 6) {
        try {
          const oc = cur.getAttribute && cur.getAttribute('onclick');
          if (oc) {
            // II1a(event, 'CODE', ...) veya II1a('CODE', ...) yakala
            const m = oc.match(/II1a\s*\(\s*(?:event\s*,\s*)?['"]([^'"]+)['"]/i);
            if (m) return { onclick: oc, II1aCode: m[1], handlerEl: cur };
            return { onclick: oc, II1aCode: null, handlerEl: cur };
          }
          // onclick property (attribute olmayabilir)
          if (typeof cur.onclick === 'function') {
            return { onclick: '[fn]', II1aCode: null, handlerEl: cur };
          }
        } catch {}
        cur = cur.parentElement;
        depth++;
      }
      return null;
    };

    // Eğer çağrılması gereken II1a kodu bulunduysa direkt fonksiyonu tetikle
    const callII1aDirect = async (doc, code) => {
      const fwin = doc.defaultView || window;
      const candidates = [fwin, fwin.parent, fwin.top, window];
      for (const w of candidates) {
        try {
          if (w && typeof w.II1a === 'function') {
            const fakeEvent = {
              type: 'click', target: null, currentTarget: null, srcElement: null,
              preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => {},
              returnValue: true, cancelBubble: false,
            };
            await log(`🚀 II1a('${code}') doğrudan çağrılıyor (DOM'dan çıkarıldı)`);
            try { w.II1a(fakeEvent, code, ''); return true; } catch (e) {
              try { w.II1a(code); return true; } catch {}
            }
          }
        } catch {}
      }
      return false;
    };

    const tryOnce = async (allowHidden) => {
      for (const doc of collectAllDocs()) {
        try {
          // TÜM elementleri tara (sadece belirli tag'ler değil) — Luca menü item'ları
          // <td>, <a>, <div> her şey olabilir.
          // KRİTİK: Sadece TRUE LEAF (children.length === 0) — yoksa <html>, <body> gibi
          // büyük container'lar textContent'inde target metni geçiyor diye match alır.
          for (const el of doc.querySelectorAll('*')) {
            if (el.children && el.children.length > 0) continue;
            // HTML/HEAD/BODY/SCRIPT/STYLE asla menu item değildir
            const tag = el.tagName;
            if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK' || tag === 'TITLE') continue;
            if (!allowHidden && el.offsetParent === null && tag !== 'A') continue;
            const t = norm(el.textContent || '');
            if (!t) continue;
            // Text uzunluğu sanity check: target 25 char ise text 200 char'tan uzun olmasın
            if (!exact && t.length > target.length * 4 + 10) continue;
            const match = exact ? (t === target) : (t === target || t.includes(target));
            if (!match) continue;

            // Element bulundu — önce onclick'ten II1a kodunu çıkarıp doğrudan çağırmayı dene
            const ocInfo = extractOnclickInfo(el);
            if (ocInfo && ocInfo.II1aCode) {
              await log(`🔑 "${text}" → II1a kodu: '${ocInfo.II1aCode}' (onclick'ten)`);
              if (await callII1aDirect(doc, ocInfo.II1aCode)) {
                await sleep(800);
                return true;
              }
              await log(`⚠ II1a doğrudan başarısız, DOM click'e geçiliyor`);
            } else if (ocInfo) {
              await log(`ℹ "${text}" onclick var ama II1a kodu çıkmadı: ${String(ocInfo.onclick).slice(0, 80)}`);
            }

            // Fallback: synthetic click
            await log(`🖱 "${text}" tıklanıyor (${el.tagName}${allowHidden && el.offsetParent === null ? ', hidden' : ''})`);
            const view = doc.defaultView || window;
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
            const x = rect ? (rect.left + rect.width / 2) : 0;
            const y = rect ? (rect.top + rect.height / 2) : 0;
            const fire = (type, on = el) => {
              try {
                on.dispatchEvent(new MouseEvent(type, {
                  bubbles: true, cancelable: true, view,
                  clientX: x, clientY: y, button: 0,
                }));
              } catch {}
            };
            // Parent zincirinde de mouseover (cascading menü açık kalsın)
            let p = el.parentElement;
            let depth = 0;
            while (p && depth < 4) {
              try {
                p.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view }));
                p.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view }));
              } catch {}
              p = p.parentElement;
              depth++;
            }
            fire('mouseover');
            fire('mouseenter');
            fire('mousemove');
            await sleep(150);
            // Hem element hem onclick handler'ı olan ata click et
            try { el.click(); } catch {}
            if (ocInfo && ocInfo.handlerEl && ocInfo.handlerEl !== el) {
              try { ocInfo.handlerEl.click(); } catch {}
            }
            fire('mousedown');
            fire('mouseup');
            fire('click');
            await sleep(1000);
            return true;
          }
        } catch {}
      }
      return false;
    };

    const start = Date.now();
    let triedHidden = false;
    while (Date.now() - start < maxMs) {
      // İlk %60 zaman: sadece görünür elementler — yanlış match riski azalır
      if (await tryOnce(false)) return true;
      // Son %40: hidden elementlere de izin (cascading menüler için)
      if (Date.now() - start > maxMs * 0.6) {
        if (!triedHidden) await log(`ℹ "${text}" görünür bulunamadı, hidden elementler de aranıyor…`);
        triedHidden = true;
        if (await tryOnce(true)) return true;
      }
      await sleep(400);
    }
    throw new Error(`"${text}" element'i ${maxMs/1000}sn içinde bulunamadı`);
  }

  // Luca firma/dönem seçici — frm4'teki SirketCombo + DonemCombo
  async function selectLucaSirketDonem(mukellefAdi, yil, log) {
    const frm4 = getLucaFrame('frm4');
    if (!frm4 || !frm4.contentDocument) {
      throw new Error('frm4 (firma seçici) bulunamadı');
    }
    const fdoc = frm4.contentDocument;
    const fwin = frm4.contentWindow;

    // 1) Firma seç (SirketCombo)
    if (mukellefAdi) {
      const sc = fdoc.getElementById('SirketCombo');
      if (!sc) throw new Error('SirketCombo select bulunamadı');
      // Luca text'i 10 karaktere truncate ediyor — ilk 10 karaktere göre eşleştir
      const target = mukellefAdi.toLocaleUpperCase('tr-TR').slice(0, 10).trim();
      let bulundu = null;
      for (const opt of sc.options) {
        const t = (opt.text || '').toLocaleUpperCase('tr-TR').trim();
        if (t === target || t.startsWith(target.slice(0, Math.min(target.length, 8)))) {
          bulundu = opt;
          break;
        }
      }
      if (!bulundu) {
        await log(`⚠ Firma "${mukellefAdi}" SirketCombo'da bulunamadı, kullanıcının seçili firmasıyla devam`);
      } else if (sc.value !== bulundu.value) {
        // Firma değiştir — sayfa yenilenecek, fakat /start henüz çağrılmadığı için
        // job 'pending' kalır. Sayfa yenilendikten sonra agent yine aynı pending
        // job'u yakalar ve bu sefer firma zaten doğru olduğu için devam eder.
        const mevcut = sc.options[sc.selectedIndex]?.text?.trim() || '(yok)';
        await log(`🔄 Firma değiştiriliyor: "${mevcut}" → "${bulundu.text}" (sayfa yenilenecek, agent otomatik devam edecek)`);
        const overrideOnWin = (w) => {
          try { w.confirm = () => true; } catch {}
          try { w.alert = () => undefined; } catch {}
          try { w.prompt = () => ''; } catch {}
        };
        try { overrideOnWin(window); } catch {}
        try { overrideOnWin(window.top); } catch {}
        try { overrideOnWin(fwin); } catch {}
        ['frm1','frm2','frm3','frm4','frm5','frm6','frm7'].forEach(name => {
          try {
            const fr = getLucaFrame(name);
            if (fr && fr.contentWindow) overrideOnWin(fr.contentWindow);
          } catch {}
        });
        sc.value = bulundu.value;
        sc.dispatchEvent(new Event('input', { bubbles: true }));
        sc.dispatchEvent(new Event('change', { bubbles: true }));
        const onChangeAttr = sc.getAttribute('onchange');
        if (onChangeAttr) {
          try {
            new fwin.Function('event', onChangeAttr).call(sc, new fwin.Event('change'));
          } catch {}
        }
        const start = Date.now();
        while (Date.now() - start < 5000) {
          let clicked = false;
          ['frm1','frm2','frm3','frm4','frm5','frm6','frm7'].forEach(name => {
            try {
              const fr = getLucaFrame(name);
              if (!fr || !fr.contentDocument) return;
              for (const btn of fr.contentDocument.querySelectorAll('button, input[type=button], input[type=submit]')) {
                const t = ((btn.textContent || btn.value || '').trim()).toLocaleLowerCase('tr-TR');
                if ((t === 'tamam' || t === 'evet' || t === 'ok') && btn.offsetParent !== null) {
                  try { btn.click(); clicked = true; } catch {}
                }
              }
            } catch {}
          });
          if (clicked) break;
          await sleep(200);
        }
        // v1.36.59: Sabit 15sn bekleme yerine akıllı polling — frame yüklenir yüklenmez devam et.
        // Üst başlık alanında "AYHAN BOZO 2026" gibi yeni firma adı belirir → o zaman hazır demektir.
        // Genelde 2-4sn sürer; max 15sn bekleriz, sonrasında error fırlar.
        const waitStart = Date.now();
        let firmaReady = false;
        while (Date.now() - waitStart < 15000) {
          await sleep(300);
          try {
            // frm4 (üst başlık frame) yenilenmiş mi — DonemCombo hazırsa hazırdır
            const fdoc = getLucaFrame('frm4')?.contentDocument;
            if (fdoc && fdoc.getElementById('DonemCombo') && fdoc.body && fdoc.body.children.length > 0) {
              firmaReady = true;
              break;
            }
            // alternatif: ana frame'de yeni mukellef adı görünür hale geldi mi
            const topTitle = (document.title || '').includes(bulundu.text) || (document.body?.textContent || '').includes(bulundu.text);
            if (topTitle) { firmaReady = true; break; }
          } catch {}
        }
        if (firmaReady) {
          await log(`✓ Firma değişti ve sayfa hazır (${((Date.now() - waitStart) / 1000).toFixed(1)}sn)`);
          // Tamponun oturmasi icin minimum 800ms ek bekleme
          await sleep(800);
        } else {
          throw new Error(`Firma değiştirildi ama sayfa 15sn'de yenilenmedi`);
        }
      } else {
        await log(`✓ Firma zaten doğru: "${bulundu.text}"`);
      }
    }

    // 2) Yıl seç (DonemCombo: "01/01/2026 - 31" gibi)
    if (yil) {
      const fdoc2 = getLucaFrame('frm4').contentDocument;
      const dc = fdoc2 && fdoc2.getElementById('DonemCombo');
      if (dc) {
        const yilStr = String(yil);
        let bulundu = null;
        for (const opt of dc.options) {
          if ((opt.text || '').includes(yilStr)) {
            bulundu = opt;
            break;
          }
        }
        if (bulundu && dc.value !== bulundu.value) {
          dc.value = bulundu.value;
          dc.dispatchEvent(new Event('change', { bubbles: true }));
          await log(`✓ Dönem (yıl) seçildi: "${bulundu.text}"`);
          await sleep(2000);
        }
      }
    }
  }

  async function fetchLucaEarsivZip(job, log, throwIfCancelled = async () => {}) {
    const donemStr = String(job.donem || ''); // "YYYY-MM"
    const [yilS, ayS] = donemStr.split('-');
    const yil = Number(yilS);
    const ay = Number(ayS);
    if (!yil || !ay || ay < 1 || ay > 12) {
      throw new Error(`Geçersiz dönem formatı: ${donemStr}, beklenen: YYYY-MM`);
    }

    // Mükellef adı artık pending job payload'ında flat geliyor. Eski [META]
    // log formatı yalnızca geriye dönük yedek olmalı; yoksa Luca'da açık kalan
    // önceki firma üzerinden e-belge çekilip evraklar yanlış mükellefe yazılabilir.
    let mukellefAdi = String(
      job.mukellefAdi ||
      job.taxpayer?.companyName ||
      [job.taxpayer?.firstName, job.taxpayer?.lastName].filter(Boolean).join(' ') ||
      job.taxpayer?.name ||
      ''
    ).trim();
    if (!mukellefAdi) {
      try {
        const m = String(job.errorMsg || '').match(/\[META\] mukellefAdi=(.+?)(\n|$)/);
        if (m) mukellefAdi = m[1].trim();
      } catch {}
    }
    if (mukellefAdi && !job.mukellefAdi) job.mukellefAdi = mukellefAdi;
    if (!mukellefAdi && !job.taxNumber && !job.lucaSlug) {
      throw new Error('E-belge sorgusu için mükellef bilgisi eksik; yanlış firmadan veri çekmemek için işlem durduruldu');
    }

    // Firma + yıl seçimini yap. Firma doğrulaması başarısızsa devam etmek tehlikeli:
    // fatura sorgusunda "aktif Luca firması" neyse onun evrakları gelir.
    const firmaResult = await ensureLucaFirma(job, log);
    if (firmaResult?.changed) {
      try { window.__morenLastEbelgeKey = ''; } catch {}
      await log('Firma değişti — e-belge ekranı eski firma bağlamı kabul edilmeyecek');
    }
    await selectLucaSirketDonem('', yil, log);

    // job.tip → açılacak menü item'ı
    const menuLabel = {
      EARSIV_SATIS: 'e-Arşiv Satış Faturaları',
      EARSIV_ALIS: 'e-Arşiv Alış Faturaları',
      EFATURA_SATIS: 'e-Fatura Satış Faturaları',
      EFATURA_ALIS: 'e-Fatura Alış Faturaları',
    }[job.tip];
    if (!menuLabel) throw new Error(`Bilinmeyen e-arşiv tipi: ${job.tip}`);

    const collectEbelgeWindows = () => {
      const out = [];
      const seen = new Set();
      const visit = (w, label) => {
        try {
          if (!w || seen.has(w)) return;
          void w.document;
          seen.add(w);
          out.push({ win: w, label });
          for (let i = 0; i < (w.frames?.length || 0); i++) {
            try { visit(w.frames[i], `${label}/${w.frames[i]?.name || i}`); } catch {}
          }
        } catch {}
      };
      try { visit(window.top || window, 'top'); } catch {}
      try { visit(window, 'current'); } catch {}
      return out;
    };

    const describeEbelgeWindow = (w, fallback) => {
      try {
        const fe = w.frameElement;
        if (fe) return fe.name || fe.id || fallback;
      } catch {}
      return fallback;
    };

    const foldEbelgeText = (s) => String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0131/g, 'i')
      .replace(/\u0130/g, 'i')
      .toLowerCase();

    const getElementText = (el) => {
      try {
        return foldEbelgeText([
          el?.textContent,
          el?.value,
          el?.title,
          el?.id,
          el?.name,
          el?.getAttribute?.('aria-label'),
          el?.getAttribute?.('onclick'),
        ].filter(Boolean).join(' '));
      } catch {
        return '';
      }
    };

    const includesAnyEbelge = (txt, terms) => terms.some((term) => txt.includes(term));

    const ebelgeTypeMatchesJobText = (txt) => {
      const wantsEarsiv = String(job.tip || '').includes('EARSIV');
      const wantsEfatura = String(job.tip || '').includes('EFATURA');
      const hasEarsiv = includesAnyEbelge(txt, ['e-arsiv', 'e arsiv', 'earsiv', 'gib_earsiv', 'gibearsiv']);
      const hasEfatura = includesAnyEbelge(txt, ['e-fatura', 'e fatura', 'efatura', 'gib_efatura', 'gibefatura']);
      if (wantsEarsiv) return hasEarsiv;
      if (wantsEfatura) return hasEfatura && !hasEarsiv;
      return true;
    };

    const ebelgeSideMatchesJobText = (txt) => {
      const wantsAlis = String(job.tip || '').includes('ALIS');
      const wantsSatis = String(job.tip || '').includes('SATIS');
      const alisTerms = ['alis', 'gelen', 'alinan', 'aliciya gelen', 'girdi'];
      const satisTerms = ['satis', 'giden', 'gonderilen', 'duzenlenen', 'kesilen', 'cikis'];
      if (wantsAlis) return includesAnyEbelge(txt, alisTerms);
      if (wantsSatis) return includesAnyEbelge(txt, satisTerms);
      return true;
    };

    const ebelgeTextMatchesJob = (doc) => {
      const bodyTxt = foldEbelgeText(doc?.body?.textContent || '');
      const htmlTxt = foldEbelgeText(doc?.documentElement?.innerHTML || '');
      const txt = `${bodyTxt} ${htmlTxt}`;
      return ebelgeTypeMatchesJobText(txt) && ebelgeSideMatchesJobText(txt);
    };

    const hasEbelgeStructure = (doc, win) => {
      try {
        const html = foldEbelgeText(doc?.documentElement?.innerHTML || '');
        const hasExactButton = !!doc?.getElementById('faturalari-getir-btn');
        const hasDateInputs = !!(doc?.getElementById('tarih1') || doc?.getElementById('tarih2'));
        const hasListControls = !!(
          doc?.getElementById('tum_belgeyi_sec_btn') ||
          doc?.querySelector?.('.sec') ||
          doc?.querySelector?.('input[type="checkbox"][class*="sec" i]')
        );
        const hasScreenMarkers = html.includes('faturalari-getir') ||
          html.includes('indir-window') ||
          html.includes('fatura_kaydet') ||
          html.includes('gib530');
        const looksLikeMenuShell = html.includes('loadmenu') &&
          !hasExactButton &&
          !hasDateInputs &&
          !hasListControls &&
          !html.includes('indir-window');
        if (looksLikeMenuShell) return false;
        const looksLikeCustomerShell = (
          html.includes('selectsirketaction') ||
          html.includes('musteriform') ||
          html.includes('vergi_no') ||
          html.includes('tc_kimlik_no')
        ) && !hasExactButton && !hasDateInputs && !hasListControls;
        if (looksLikeCustomerShell) return false;
        return Boolean(
          hasExactButton ||
          hasDateInputs ||
          hasListControls ||
          hasScreenMarkers
        );
      } catch {
        return false;
      }
    };

    const findLikelyEbelgeGetirButton = (doc) => {
      try {
        const exact = doc?.getElementById('faturalari-getir-btn');
        if (exact) return exact;
        const describeActionElement = (el) => {
          try {
            return foldEbelgeText([
              getElementText(el),
              el?.id,
              el?.name,
              el?.title,
              el?.className,
              el?.value,
              el?.alt,
              el?.src,
              el?.getAttribute?.('aria-label'),
              el?.getAttribute?.('onclick'),
              el?.getAttribute?.('href'),
              Array.from(el?.querySelectorAll?.('img') || [])
                .map((img) => [img.alt, img.title, img.src].filter(Boolean).join(' '))
                .join(' '),
            ].filter(Boolean).join(' '));
          } catch {
            return '';
          }
        };
        const isRejectedAction = (el) => {
          const hay = describeActionElement(el);
          return /(?:^|\s)(?:iptal|vazgec|kapat|temizle|dur|durdur|stop|ma-stop|pause|bekle|loading)(?:\s|$)/i.test(hay) ||
            hay.includes('zip-window') ||
            hay.includes('secilenleri indir') ||
            hay.includes('tumunu sec') ||
            hay.includes('tümünü seç') ||
            hay.includes('selectsirketaction') ||
            hay.includes('basvurulogo') ||
            hay.includes('basvuru logo') ||
            hay.includes('logo.png');
        };
        const isActionish = (el) => {
          try {
            const tag = String(el.tagName || '').toLowerCase();
            const type = String(el.type || '').toLowerCase();
            return tag === 'button' ||
              tag === 'a' ||
              type === 'button' ||
              type === 'submit' ||
              type === 'image' ||
              el.getAttribute('role') === 'button' ||
              typeof el.onclick === 'function' ||
              !!el.getAttribute('onclick') ||
              !!el.getAttribute('href');
          } catch {
            return false;
          }
        };
        const looksVisible = (el) => {
          try {
            const win = el.ownerDocument?.defaultView || window;
            const style = win.getComputedStyle?.(el);
            if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
            const rect = el.getBoundingClientRect?.();
            if (rect && rect.width === 0 && rect.height === 0) return false;
            return true;
          } catch {
            return true;
          }
        };
        const candidates = Array.from(doc?.querySelectorAll([
          'button',
          'input[type=button]',
          'input[type=submit]',
          'input[type=image]',
          'a',
          '[role=button]',
          '[onclick]',
          '[id*="getir" i]',
          '[name*="getir" i]',
          '[class*="getir" i]',
          '[id*="sorgu" i]',
          '[name*="sorgu" i]',
          '[class*="sorgu" i]',
          '[id*="liste" i]',
          '[name*="liste" i]',
          '[class*="liste" i]',
        ].join(',')) || []);
        const scored = candidates.map((el) => {
          const txt = getElementText(el);
          const hay = describeActionElement(el);
          let score = 0;
          if (isRejectedAction(el)) score -= 100;
          if (!isActionish(el)) score -= 25;
          if (!looksVisible(el)) score -= 10;
          if (hay.includes('faturalari-getir-btn') || hay.includes('faturalari_getir')) score += 30;
          if (hay.includes('faturalari getir') || hay.includes('faturalar getir')) score += 20;
          if (hay.includes('belgeleri getir') || hay.includes('belge getir') || hay.includes('fatura getir')) score += 18;
          if (/\bgetir\b/i.test(hay)) score += 10;
          if (/\bsorgula\b|\bsorgu\b/i.test(hay)) score += 7;
          if (/\blistele\b|\bliste\b/i.test(hay)) score += 5;
          if (/^(?:ara|arama)$/i.test(txt.trim())) score += 3;
          return { el, score, txt, hay };
        }).filter((x) => x.score > 0);
        scored.sort((a, b) => b.score - a.score);
        if (scored[0]) return scored[0].el;

        // Luca bazen modalda butonu metinsiz input/image olarak veriyor. Tarih
        // alanları olan dokümanda tek makul aksiyon varsa onu kullan.
        // Tek aksiyon fallback'i riskli: Luca bazen "Dur/stop" elemanini
        // tek makul aksiyon gibi gosteriyor. Explicit getir/sorgu izi yoksa
        // temiz hata verip yanlis elemana tiklamiyoruz.
        return null;
      } catch {
        return null;
      }
    };

    const describeEbelgeFrames = () => {
      const hints = [];
      for (const item of collectEbelgeWindows()) {
        try {
          const doc = item.win.document;
          const title = foldEbelgeText(doc?.title || '');
          const text = foldEbelgeText(doc?.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
          if (title || text) hints.push(`${describeEbelgeWindow(item.win, item.label)}:${title || text}`);
        } catch {}
      }
      return hints.slice(0, 5).join(' | ');
    };

    const findEbelgePageContext = () => {
      let fallback = null;
      for (const item of collectEbelgeWindows()) {
        try {
          const doc = item.win.document;
          if (!doc?.body) continue;
          const exactBtn = doc.getElementById('faturalari-getir-btn');
          const btn = exactBtn || findLikelyEbelgeGetirButton(doc);
          const btnText = getElementText(btn);
          const strongBtn = exactBtn || btnText.includes('faturalari getir') ||
            btnText.includes('belgeleri getir') ||
            btnText.includes('belge getir') ||
            btnText.includes('fatura getir');
          const textOk = ebelgeTextMatchesJob(doc);
          const structureOk = hasEbelgeStructure(doc, item.win);
          if (textOk && (structureOk || btn || exactBtn)) {
            return {
              doc,
              win: item.win,
              btn,
              label: describeEbelgeWindow(item.win, item.label),
            };
          }
          if (!fallback && (exactBtn || (structureOk && strongBtn) || (textOk && structureOk))) {
            fallback = {
              doc,
              win: item.win,
              btn,
              label: describeEbelgeWindow(item.win, item.label),
            };
          }
        } catch {}
      }
      return fallback;
    };

    // Her zaman doğru sayfayı II1a ile aç — "faturalari-getir-btn" hem alış hem satışta
    // var olduğu için sayfa kontrolü güvenilir değil. Yanlış sayfada olabiliriz.
    let frm3 = getLucaFrame('frm3');
    {
      // Kullanıcı keşfinde bulunan direct II1a ID'leri (menü tıklama gerek yok!):
      //   e-Arşiv Satış Faturaları   → apy1000m24i10I
      //   e-Arşiv Alış Faturaları    → apy1000m24i11I
      //   e-Fatura Alış Faturaları   → apy1000m24i17I
      //   e-Fatura Satış Faturaları  → apy1000m24i18I
      // Mükellef tipini tespit et: top-level menüde "İşletme Defteri" varsa işletme,
      // "Muhasebe" varsa bilanço esası.
      const detectMukellefTipi = () => {
        const fromJob = String([
          job.defterTuru,
          job.mihsapDefterTuru,
          job.ledgerType,
          job.mukellefDefterTuru,
        ].filter(Boolean).join(' ')).toLocaleUpperCase('tr-TR');
        if (/DEFTER[_\s-]*BEYAN/.test(fromJob)) return 'isletme';
        if (/ISLETME|İSLETME|İŞLETME/.test(fromJob)) return 'isletme';
        if (/BILANCO|BİLANCO|BİLANÇO|BILANÇO/.test(fromJob)) return 'bilanco';
        try {
          const texts = [];
          for (const fname of ['frm2', 'frm3', 'frm4', 'frm5']) {
            const fr = getLucaFrame(fname);
            if (fr?.contentDocument?.body) texts.push(fr.contentDocument.body.textContent || '');
          }
          texts.push(document.body?.textContent || '');
          const joined = texts.join('\n');
          if (/defter[_\s-]*beyan|tur=defter_beyan/i.test(joined)) return 'isletme';
          if (/Muhasebe/i.test(joined) && /Mizan|Hesap\s+Plan|Fi[şs]\s+İşlemleri|Fis\s+Islemleri/i.test(joined)) return 'bilanco';
          if (/İşletme\s+Defteri|Isletme\s+Defteri/i.test(joined) && !/Muhasebe/i.test(joined)) return 'isletme';
        } catch {}
        for (const fname of ['frm2', 'frm3', 'frm4', 'frm5']) {
          try {
            const fr = getLucaFrame(fname);
            if (!fr || !fr.contentDocument) continue;
            const txt = (fr.contentDocument.body && fr.contentDocument.body.textContent) || '';
            if (/defter[_\s-]*beyan|tur=defter_beyan/i.test(txt)) return 'isletme';
            if (/İşletme\s+Defteri/i.test(txt) && !/Muhasebe\b/i.test(txt.slice(0, 500))) return 'isletme';
            if (/Muhasebe/i.test(txt)) return 'bilanco';
          } catch {}
        }
        // Tüm document'tan da tara
        try {
          const txt = document.body.textContent || '';
          if (/defter[_\s-]*beyan|tur=defter_beyan/i.test(txt)) return 'isletme';
          if (/İşletme\s+Defteri/i.test(txt)) return 'isletme';
          if (/Muhasebe/i.test(txt)) return 'bilanco';
        } catch {}
        return null;
      };

      const II1A_CODES = {
        bilanco: {
          EARSIV_SATIS: 'apy1000m24i10I',
          EARSIV_ALIS:  'apy1000m24i11I',
          EFATURA_ALIS: 'apy1000m24i17I',
          EFATURA_SATIS:'apy1000m24i18I',
        },
        // İşletme defteri için kullanıcının console'dan yakaladığı gerçek kodlar.
        // e-Arşiv Alış doğrulandı (apy1000m15i9I), diğerleri menü sırasına göre tahmin.
        isletme: {
          EARSIV_SATIS: 'apy1000m15i8I',
          EARSIV_ALIS:  'apy1000m15i9I',
          EFATURA_ALIS: 'apy1000m15i14I',
          EFATURA_SATIS:'apy1000m15i15I',
        },
      };

      const mukellefTipi = detectMukellefTipi();
      if (!mukellefTipi) {
        throw new Error(`E-belge icin defter turu tespit edilemedi; guvenlik geregi Bilanço/İşletme varsayimi yapilmadi. Mukellef kartinda defter turunu kontrol edin. Job=${job.tip}`);
      }
      const ii1aId = II1A_CODES[mukellefTipi]?.[job.tip];
      // Defter türü biliniyorsa karşı defter ailesinin kodlarını deneme.
      // Bilanço mükellefinde işletme kodu/menüsü denemek hem bekletiyor hem yanlış
      // e-belge ekranını açabiliyor.
      const ii1aIds = [ii1aId].filter(Boolean);
      await log(`📊 Mükellef tipi: ${mukellefTipi.toUpperCase()} → II1a kodu: ${ii1aId}`);
      if (!ii1aId) throw new Error(`Bilinmeyen tip için II1a id yok: ${job.tip} (${mukellefTipi})`);

      // ÖNCELİK 0: Eğer frm3'te zaten e-arşiv sayfası açıksa menü navigasyonunu ATLA.
      // Kullanıcı Luca'yı bir kez manuel olarak e-Arşiv Alış sayfasında bıraksın yeter.
      const ebelgeContextAtStart = findEbelgePageContext();
      const expectedEbelgeKey = `${mukellefTipi}:${job.tip}:${job.mukellefId || ''}:${job.donem || ''}`;
      const previousEbelgeKey = String(window.__morenLastEbelgeKey || '');
      const sayfaAcikMi = () => !!findEbelgePageContext();
      if (ebelgeContextAtStart) {
        await log(`ℹ E-belge ekranı zaten açık (${ebelgeContextAtStart?.label || 'frame'}); doğru defter/tip/firma için yeniden açma denenecek`);
      }
      // Eski açık e-belge sayfasını yeni job için otomatik doğru kabul etme.
      // İşletme ekranı açık kalıp sonraki bilanço job'ını yanıltabiliyordu.
      var __navSkip = false;

      const normalizeEbelgeText = foldEbelgeText;

      const contextMatchesExpected = (ctx) => {
        try {
          if (!ctx?.doc?.body) return false;
          const txt = `${normalizeEbelgeText(ctx.doc.body.textContent || '')} ${normalizeEbelgeText(ctx.doc.documentElement?.innerHTML || '')}`;
          return ebelgeTypeMatchesJobText(txt) && ebelgeSideMatchesJobText(txt);
        } catch {
          return false;
        }
      };

      const isFreshEbelgeContext = (ctx, previousCtx) => {
        if (!ctx) return false;
        if (!previousCtx) return true;
        if (previousEbelgeKey === expectedEbelgeKey) return true;
        if (contextMatchesExpected(ctx)) return true;
        return ctx.doc !== previousCtx.doc || ctx.win !== previousCtx.win || ctx.btn !== previousCtx.btn;
      };

      const waitForEbelgePage = async (maxMs = 12000, previousCtx = ebelgeContextAtStart) => {
        const started = Date.now();
        while (Date.now() - started < maxMs) {
          await throwIfCancelled();
          const ctx = findEbelgePageContext();
          if (isFreshEbelgeContext(ctx, previousCtx)) return true;
          await sleep(400);
        }
        return false;
      };

      const findII1aCandidates = () => {
        const found = [];
        const seen = new Set();
        const push = (win, src) => {
          try {
            if (!win || seen.has(win)) return;
            seen.add(win);
            if (typeof win.II1a === 'function') found.push({ fn: win.II1a.bind(win), src });
          } catch {}
        };
        try { push(window, 'top'); } catch {}
        try { push(parent, 'parent'); } catch {}
        try { push(top, 'window.top'); } catch {}
        const visit = (win, path) => {
          try {
            push(win, path);
            const doc = win?.document;
            if (!doc) return;
            const frames = doc.querySelectorAll('frame, iframe');
            frames.forEach((fr, idx) => {
              try {
                visit(fr.contentWindow, `${path}/${fr.name || fr.id || idx}`);
              } catch {}
            });
          } catch {}
        };
        try { visit(window, 'tree'); } catch {}
        return found;
      };

      const collectFrameDocs = () => {
        return collectFrameDocItems().map((item) => item.doc);
      };

      const collectFrameDocItems = () => {
        const items = [];
        const seenWins = new Set();
        const visit = (win, label = 'window') => {
          try {
            if (!win || seenWins.has(win)) return;
            seenWins.add(win);
            const doc = win.document;
            if (doc) items.push({ doc, win, label });
            Array.from(doc?.querySelectorAll('frame, iframe') || []).forEach((fr, idx) => {
              try { visit(fr.contentWindow, `${label}/${fr.name || fr.id || idx}`); } catch {}
            });
          } catch {}
        };
        try { visit(window, 'current'); } catch {}
        try { if (parent && parent !== window) visit(parent, 'parent'); } catch {}
        try { if (top && top !== window) visit(top, 'top'); } catch {}
        return items;
      };

      const extractII1aCodeFromText = (value) => {
        const text = String(value || '');
        const m = text.match(/II1a\s*\(\s*(?:event\s*,\s*)?['"]([^'"]+)['"]/i);
        if (m) return m[1];
        const direct = text.match(/apy1000m\d+i\d+I/i);
        return direct ? direct[0] : '';
      };

      const getEbelgeCandidateText = (el) => {
        const parts = [];
        let cur = el;
        for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
          try {
            const ownText = String(cur.textContent || '').replace(/\s+/g, ' ').trim();
            if (ownText && (cur.children?.length === 0 || ownText.length <= (cur === el ? 180 : 80))) {
              parts.push(ownText);
            }
            parts.push(
              cur.value,
              cur.title,
              cur.id,
              cur.name,
              cur.getAttribute?.('aria-label'),
              cur.getAttribute?.('onclick'),
              cur.getAttribute?.('href'),
            );
          } catch {}
        }
        return foldEbelgeText(parts.filter(Boolean).join(' '));
      };

      const findEbelgeMenuTargetCandidates = () => {
        const out = [];
        const seen = new Set();
        const wantedLabel = foldEbelgeText(menuLabel);
        for (const item of collectFrameDocItems()) {
          let elements = [];
          try { elements = Array.from(item.doc.querySelectorAll('a[href], area[href], [onclick], [role="button"], td, span, div, li')); } catch {}
          for (const el of elements) {
            const hay = getEbelgeCandidateText(el);
            if (!hay) continue;
            const labelOk = hay.includes(wantedLabel);
            const code = extractII1aCodeFromText(hay);
            if (!labelOk && !(code && ebelgeTypeMatchesJobText(hay) && ebelgeSideMatchesJobText(hay))) continue;
            if (!code && hay.length > 260) continue;
            const key = `${item.label}|${code}|${hay.slice(0, 120)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              doc: item.doc,
              win: item.win || item.doc.defaultView || window,
              el,
              frame: item.label,
              code,
              text: hay.replace(/\s+/g, ' ').trim().slice(0, 120),
            });
          }
        }
        return out.slice(0, 12);
      };

      const describeAnyEbelgeMenuHints = (limit = 35) => {
        const out = [];
        const seen = new Set();
        for (const item of collectFrameDocItems()) {
          let elements = [];
          try { elements = Array.from(item.doc.querySelectorAll('a[href], area[href], [onclick], [role="button"], td, span, div, li')); } catch {}
          for (const el of elements) {
            const hay = getEbelgeCandidateText(el);
            if (!hay) continue;
            const code = extractII1aCodeFromText(hay);
            const looksRelevant =
              hay.includes('e-arsiv') ||
              hay.includes('earsiv') ||
              hay.includes('e-fatura') ||
              hay.includes('efatura') ||
              hay.includes('akilli entegrasyon') ||
              hay.includes('akilli') ||
              hay.includes('entegrasyon');
            if (!looksRelevant) continue;
            const key = `${item.label}|${code}|${hay.slice(0, 100)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(`${item.label}:${code || 'no-code'}:${hay.replace(/\s+/g, ' ').slice(0, 110)}`);
            if (out.length >= limit) return out.join(' || ');
          }
        }
        return out.join(' || ');
      };

      const tryOpenByMenuCode = async (code, reason) => {
        const fakeEvent = {
          type: 'click', target: null, currentTarget: null, srcElement: null,
          preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => {},
          returnValue: true, cancelBubble: false,
        };
        for (const doc of collectFrameDocs()) {
          let elements = [];
          try { elements = Array.from(doc.querySelectorAll('[onclick], a[href], area[href]')); } catch {}
          for (const el of elements) {
            let handler = '';
            try {
              handler = `${el.getAttribute('onclick') || ''} ${el.getAttribute('href') || ''}`;
            } catch {}
            if (!handler || !handler.includes(code)) continue;
            const win = doc.defaultView || window;
            await log(`🧭 Menü kodu bulundu → ${code} (${reason})`);
            try {
              const onclick = el.getAttribute('onclick');
              if (onclick) {
                new win.Function('event', onclick).call(el, fakeEvent);
                if (await waitForEbelgePage(8000)) return true;
              }
            } catch (e) {
              await log(`⚠ Menü onclick hata: ${String(e?.message || e).slice(0, 90)}`);
            }
            try {
              el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
              el.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
              el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
              if (typeof el.click === 'function') el.click();
              if (await waitForEbelgePage(8000)) return true;
            } catch (e) {
              await log(`⚠ Menü click hata: ${String(e?.message || e).slice(0, 90)}`);
            }
          }
        }
        return false;
      };

      const tryOpenByII1a = async (code, reason) => {
        const candidates = findII1aCandidates();
        if (!candidates.length) {
          await log(`⚠ II1a fonksiyonu bulunamadı (${reason})`);
          return false;
        }
        const fakeEvent = {
          type: 'click', target: null, currentTarget: null, srcElement: null,
          preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => {},
          returnValue: true, cancelBubble: false,
        };
        // Luca II1a fonksiyonu içinde "tree.indexOf(code)" çağrısı var; tree
        // henüz frm2 init olmadıysa undefined olup patlıyor. Bu hata pattern'ine
        // uyan exception olursa kısa bekle + tekrar dene (max 3 kez per attempt).
        const isTreeNotReadyError = (e) => {
          const msg = String(e?.message || e);
          return /indexOf.*undefined|undefined.*\.indexOf|reading\s+['"]?(?:indexOf|II11|1)['"]?|Cannot read properties of (?:undefined|null)/i.test(msg);
        };
        const MAX_RETRY = 2;
        for (const candidate of candidates) {
          const attempts = [
            [fakeEvent, code, ''],
            [fakeEvent, code],
            [code, ''],
            [code],
          ];
          for (const args of attempts) {
            let retry = 0;
            let argSetFailed = false;
            while (retry < MAX_RETRY && !argSetFailed) {
              try {
                await log(`🧭 II1a ${candidate.src} → ${code} (${reason}${retry > 0 ? `, retry ${retry}/${MAX_RETRY - 1}` : ''})`);
                candidate.fn(...args);
                if (await waitForEbelgePage(8000)) return true;
                // II1a çağrısı throw etmedi ama sayfa açılmadı → bu arg setiyle olmuyor, diğerine geç
                argSetFailed = true;
              } catch (e) {
                const msg = String(e?.message || e).slice(0, 90);
                await log(`⚠ II1a ${candidate.src} hata: ${msg}`);
                if (isTreeNotReadyError(e)) {
                  if (retry < MAX_RETRY - 1) {
                    retry++;
                    await log(`⏳ Luca menu tree hazır değil — 0.8sn bekle, retry ${retry}/${MAX_RETRY - 1}`);
                    await sleep(800);
                    continue;
                  }
                  await log(`ℹ II1a ${candidate.src} menu tree hazır değil; metin menüsüne geçiliyor`);
                  return false;
                }
                // Farklı hata ya da retry tükendi → bu arg setini bırak
                argSetFailed = true;
              }
            }
          }
        }
        return tryOpenByMenuCode(code, reason);
      };

      const tryOpenByDiscoveredMenuTargets = async (reason) => {
        const targets = findEbelgeMenuTargetCandidates();
        if (!targets.length) {
          await log(`ℹ ${menuLabel} için DOM menü hedefi henüz hazır değil (${reason}); metin menüsüne geçilecek`);
          const menuHints = describeAnyEbelgeMenuHints(35);
          if (menuHints) await log(`🔎 Luca e-belge menu ipuclari: ${menuHints}`);
          return false;
        }
        await log(`🧩 ${menuLabel} icin Luca hedef kesfi: ${targets.map((t) => `${t.code || 'no-code'}@${t.frame}:${t.text.slice(0, 42)}`).join(' | ')}`);
        for (const target of targets) {
          if (target.code && await tryOpenByII1a(target.code, `DOM kesfi/${reason}`)) return true;
          const win = target.win || target.doc?.defaultView || window;
          try {
            await log(`🖱 Kesfedilen Luca hedefi tiklaniyor (${target.frame}: ${target.text.slice(0, 80)})`);
            target.el.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true, cancelable: true, view: win }));
            target.el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
            target.el.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
            target.el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
            if (typeof target.el.click === 'function') target.el.click();
            if (await waitForEbelgePage(8000)) return true;
          } catch (e) {
            await log(`⚠ Kesfedilen hedef click hata: ${String(e?.message || e).slice(0, 90)}`);
          }
        }
        return false;
      };

      const tryOpenByQuickAccess = async (reason) => {
        const looksRelevantLabel = (value) => {
          const hay = foldEbelgeText(value);
          return ebelgeTypeMatchesJobText(hay) && ebelgeSideMatchesJobText(hay);
        };
        const quickHints = [];
        for (const item of collectFrameDocItems()) {
          let selects = [];
          try { selects = Array.from(item.doc.querySelectorAll('select')); } catch {}
          for (const sel of selects) {
            try {
              const desc = foldEbelgeText([
                sel.id,
                sel.name,
                sel.className,
                sel.title,
                sel.getAttribute?.('onchange'),
                sel.closest?.('td,div,form')?.textContent,
              ].filter(Boolean).join(' '));
              const options = Array.from(sel.options || []);
              const related = options
                .filter((opt) => /e[-\s]?arsiv|earsiv|e[-\s]?fatura|efatura|fatura/i.test(`${opt.text} ${opt.value}`))
                .slice(0, 10)
                .map((opt) => `${String(opt.text || '').trim().slice(0, 45)}=>${String(opt.value || '').slice(0, 25)}`);
              if (related.length) quickHints.push(`${item.label}:${sel.id || sel.name || 'select'}:[${related.join(' | ')}]`);
              const isQuickAccess = /hizli|hızlı|kisayol|kısayol|shortcut|aktar/.test(desc);
              const match = options.find((opt) => looksRelevantLabel(`${opt.text} ${opt.value}`));
              if (!match || !isQuickAccess) continue;
              await log(`⚡ Hızlı erişim ile ${menuLabel} açılıyor (${item.label} select#${sel.id || sel.name || '?'}, value=${String(match.value).slice(0, 40)})`);
              sel.value = match.value;
              const win = item.win || item.doc.defaultView || window;
              sel.dispatchEvent(new win.Event('input', { bubbles: true }));
              sel.dispatchEvent(new win.Event('change', { bubbles: true }));
              try { if (typeof sel.onchange === 'function') sel.onchange.call(sel, new win.Event('change')); } catch {}
              try { if (typeof win.aktar === 'function') win.aktar(sel.value); } catch {}
              if (await waitForEbelgePage(10000)) return true;
            } catch (e) {
              await log(`⚠ Hızlı erişim denemesi hata: ${String(e?.message || e).slice(0, 90)}`);
            }
          }
        }
        if (quickHints.length) {
          await log(`🔎 Hızlı erişim e-belge seçenekleri (${reason}): ${quickHints.slice(0, 4).join(' || ')}`);
        }
        return false;
      };

      const nativeClickLucaText = async (text, opts = {}) => {
        try {
          let bridge = null;
          try { bridge = window.__morenNativeClickText; } catch {}
          if (!bridge) {
            try { bridge = window.top?.__morenNativeClickText; } catch {}
          }
          if (typeof bridge !== 'function') return false;
          const res = await bridge({
            text,
            exact: !!opts.exact,
            hoverOnly: !!opts.hoverOnly,
            timeoutMs: opts.timeoutMs || opts.maxMs || 6000,
          });
          if (res?.ok) {
            await log(`Native ${opts.hoverOnly ? 'hover' : 'click'}: "${text}" (${res.frame || '?'})`);
            await sleep(opts.settleMs || 800);
            return true;
          }
          await log(`Native click "${text}" bulunamadi: ${res?.reason || 'yok'}`);
        } catch (e) {
          await log(`Native click "${text}" hata: ${String(e?.message || e).slice(0, 100)}`);
        }
        return false;
      };

      let basariliAcildi = false;
      await log(`🧭 II1a('${ii1aId}') aranıyor → ${menuLabel}`);
      try {
        const cachedRows = cacheVisibleLucaMenuIds();
        if (cachedRows > 0) await log(`🧠 Luca menü ID cache güncellendi (${cachedRows} satır)`);
      } catch {}
      if (!__navSkip && await openCachedLucaMenu(menuLabel, log, 3000, { expectedCode: ii1aId })) {
        basariliAcildi = await waitForEbelgePage(10000);
      }
      if (!__navSkip && !basariliAcildi && await tryOpenByQuickAccess('ilk deneme')) {
        basariliAcildi = true;
      }
      if (!__navSkip && !basariliAcildi) {
        await nativeClickLucaText(mukellefTipi === 'isletme' ? '\u0130\u015fletme Defteri' : 'Muhasebe', {
          timeoutMs: 3500,
          settleMs: 1000,
        });
      }
      // II1a fonksiyonu hangi frame'de tanımlı bilmiyoruz — hepsini tara
      let II1aFn = null, II1aSrc = '';
      const candidateFrames = ['frm2','frm5','frm3','frm4','frm1','frm6','frm7'];
      for (const name of candidateFrames) {
        const fr = getLucaFrame(name);
        try {
          if (fr && fr.contentWindow && typeof fr.contentWindow.II1a === 'function') {
            II1aFn = fr.contentWindow.II1a.bind(fr.contentWindow);
            II1aSrc = name;
            break;
          }
        } catch {}
      }
      // top window'da da deneyelim
      if (!II1aFn) {
        try {
          if (typeof window.II1a === 'function') {
            II1aFn = window.II1a;
            II1aSrc = 'top';
          }
        } catch {}
        try {
          if (!II1aFn && typeof parent.II1a === 'function') {
            II1aFn = parent.II1a;
            II1aSrc = 'parent';
          }
        } catch {}
      }
      // Önce II1a dene; başarısız olursa text-based menü click fallback
      let ii1aTreeNotReady = false;
      if (!__navSkip && II1aFn) {
        await log(`🧭 II1a bulundu (${II1aSrc}) — ${ii1aId} çağrılıyor`);
        // Luca II1a'nın iç implementasyonu tree.indexOf(code) çağırıyor; tree
        // henüz init olmadıysa "Cannot read properties of undefined (reading 'indexOf')"
        // patlar. Bu pattern'e uyan exception'da 1.5sn bekle + tekrar dene.
        const isTreeNotReadyError = (e) => {
          const msg = String(e?.message || e);
          return /indexOf.*undefined|undefined.*\.indexOf|reading\s+['"]?(?:indexOf|II11|1)['"]?|Cannot read properties of (?:undefined|null)/i.test(msg);
        };
        const fakeEvent = {
          type: 'click', target: null, currentTarget: null, srcElement: null,
          preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => {},
          returnValue: true, cancelBubble: false,
        };
        const MAX_RETRY = 2;
        let retry = 0;
        while (retry < MAX_RETRY) {
          try {
            II1aFn(fakeEvent, ii1aId, '');
            basariliAcildi = await waitForEbelgePage(8000);
            if (!basariliAcildi) {
              await log(`⚠ II1a('${ii1aId}') çağrıldı ama ${menuLabel} ekranı açılmadı`);
            }
            break;
          } catch (e) {
            if (isTreeNotReadyError(e)) {
              if (retry < MAX_RETRY - 1) {
                retry++;
                await log(`⏳ II1a('${ii1aId}') menu tree hazır değil — 0.8sn bekle, retry ${retry}/${MAX_RETRY - 1}`);
                await sleep(800);
                continue;
              }
              ii1aTreeNotReady = true;
              await log(`ℹ II1a('${ii1aId}') menu tree hazır değil; direkt metin menüsüne geçiliyor`);
              basariliAcildi = false;
              break;
            }
            await log(`⚠ II1a('${ii1aId}') başarısız: ${String(e?.message || e).slice(0, 120)} — fallback: alternatif kodlar / metin menüsü`);
            basariliAcildi = false;
            break;
          }
        }
      }
      if (__navSkip) {
        basariliAcildi = true;
      } else if (!basariliAcildi && ii1aTreeNotReady) {
        await log('ℹ II1a menü ağacı bu oturumda geç hazırlandı; alternatif ID tekrarları atlanıp metin menüsü kullanılacak');
      } else if (!basariliAcildi) {
        await log(`🔁 Alternatif II1a denemeleri: ${ii1aIds.join(', ')}`);
        for (const altId of ii1aIds) {
          basariliAcildi = await tryOpenByII1a(altId, altId === ii1aId ? 'birincil tekrar' : 'alternatif kod');
          if (basariliAcildi) break;
        }
      }
      if (!__navSkip && !basariliAcildi) {
        basariliAcildi = await tryOpenByDiscoveredMenuTargets('alternatif kodlar sonrasi');
      }
      if (!basariliAcildi) {
        // Fallback: menüleri sırayla açıp elementi click et.
        // Bilanço esası → "Muhasebe", İşletme Defteri → "İşletme Defteri"
        // "Muhasebe" yazısı sayfada başka yerlerde de var olabileceğinden tıklandı doğrulaması için
        // tıklamadan sonra "Akıllı Entegrasyon Noktası"nın görünür olmasını ARIYORUZ; yoksa diğer kök menüyü dene.
        await log('🔄 Text-based menü navigasyonu (yedek plan)');

        // Tüm frame ağacında (recursive) leaf element'lerde "Akıllı Entegrasyon"
        // metnini ara — whitespace/ok karakteri farklılıklarına toleranslı.
        const akilliVisible = () => {
          const visit = (fw) => {
            try {
              const doc = fw.document;
              if (!doc) return false;
              const all = doc.querySelectorAll('*');
              for (const el of all) {
                if (el.children && el.children.length > 0) continue; // sadece leaf
                const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!t) continue;
                if (t.includes('Akıllı Entegrasyon') || t.includes('Akilli Entegrasyon')) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) return true;
                }
              }
              // Alt frame'leri recursive tara
              const subs = doc.querySelectorAll('iframe,frame');
              for (const f of subs) {
                try { if (f.contentWindow && visit(f.contentWindow)) return true; } catch {}
              }
            } catch {}
            return false;
          };
          return visit(window);
        };

        // Defter türüne göre tek doğru kök menüyü dene.
        // Bilanço: Muhasebe, İşletme: İşletme Defteri.
        const denemeler = mukellefTipi === 'isletme' ? ['İşletme Defteri'] : ['Muhasebe'];
        let basariliMenu = null;

        for (const menuAdi of denemeler) {
          try {
            if (!await nativeClickLucaText(menuAdi, { timeoutMs: 3500, settleMs: 1000 })) {
              await clickByTextEverywhere(menuAdi, log, { maxMs: 3000 });
            }
            await log(`🖱 "${menuAdi}" denendi, submenu kontrol ediliyor…`);
            // Submenu açılma süresi verilir
            await sleep(1500);
            if (await akilliVisible()) {
              basariliMenu = menuAdi;
              await log(`✓ "${menuAdi}" doğru menü (Akıllı Entegrasyon submenusu açıldı)`);
              break;
            } else {
              await log(`✗ "${menuAdi}" yanlış (Akıllı Entegrasyon görünmedi) → diğeri denenecek`);
            }
          } catch (e) {
            await log(`ℹ "${menuAdi}" bulunamadı: ${e?.message || e}`);
          }
        }

        if (!basariliMenu) {
          throw new Error('Ne "Muhasebe" ne de "İşletme Defteri" menüsü Akıllı Entegrasyon submenu\'su açmadı');
        }

        // Akıllı Entegrasyon Noktası: hover-ONLY (click yapma — submenu kapanır).
        // Element bul, üzerinde sürekli MouseEvent + PointerEvent fire et,
        // bu sırada e-Arşiv Alış'ı ara.
        const findElByText = (text) => {
          const norm2 = (s) => (s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
          const target = norm2(text);
          const visit = (fw) => {
            try {
              const doc = fw.document;
              if (!doc) return null;
              for (const el of doc.querySelectorAll('*')) {
                if (el.children && el.children.length > 0) continue;
                const tag = el.tagName;
                if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY' || tag === 'SCRIPT' || tag === 'STYLE') continue;
                const t = norm2(el.textContent || '');
                if (!t) continue;
                if (t === target || t.includes(target)) return el;
              }
              for (const f of doc.querySelectorAll('iframe,frame')) {
                try { const r = visit(f.contentWindow); if (r) return r; } catch {}
              }
            } catch {}
            return null;
          };
          return visit(window);
        };

        await nativeClickLucaText('Ak\u0131ll\u0131 Entegrasyon', {
          hoverOnly: true,
          timeoutMs: 4000,
          settleMs: 800,
        });

        const akilliEl = findElByText('Akıllı Entegrasyon');
        let hoverTimer = null;
        if (akilliEl) {
          await log('🎯 Akıllı Entegrasyon elementi bulundu — sürekli hover (click YAPILMAYACAK)');
          const fireHoverDeep = () => {
            try {
              const doc = akilliEl.ownerDocument;
              const view = doc.defaultView || window;
              const rect = akilliEl.getBoundingClientRect();
              const opts = {
                bubbles: true, cancelable: true, view,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
                button: 0, buttons: 0, pointerType: 'mouse',
              };
              const optsNoBubble = { ...opts, bubbles: false };
              // Önce parent zincirine fire et (delegasyon için), sonra hedefe
              const fireOn = (el) => {
                try { el.dispatchEvent(new MouseEvent('mouseover', opts)); } catch {}
                try { el.dispatchEvent(new MouseEvent('mouseenter', optsNoBubble)); } catch {}
                try { el.dispatchEvent(new MouseEvent('mousemove', opts)); } catch {}
                try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch {}
                try { el.dispatchEvent(new PointerEvent('pointerenter', optsNoBubble)); } catch {}
                try { el.dispatchEvent(new PointerEvent('pointermove', opts)); } catch {}
              };
              fireOn(akilliEl);
              let p = akilliEl.parentElement;
              for (let i = 0; i < 5 && p; i++) {
                fireOn(p);
                p = p.parentElement;
              }
            } catch {}
          };
          fireHoverDeep();
          await sleep(300);
          fireHoverDeep();
          hoverTimer = setInterval(fireHoverDeep, 50);
          await log('🔄 Hover loop aktif (50ms aralıklarla, MouseEvent + PointerEvent)');
        } else {
          await log('⚠ Akıllı Entegrasyon elementi bulunamadı, hover atlanıyor');
        }

        try {
          // Hover loop devam ederken e-Arşiv Alış'ı ara (cascade flyout populate eder)
          if (!await nativeClickLucaText(menuLabel, { timeoutMs: 7000, settleMs: 2200 })) {
            await clickByTextEverywhere(menuLabel, log, { maxMs: 10000 });
          }
          basariliAcildi = await waitForEbelgePage(8000);
        } catch (e) {
          await log(`⚠ "${menuLabel}" metin menüsünden bulunamadı; Akıllı Entegrasyon click fallback deneniyor`);
          try {
            if (!await nativeClickLucaText('Ak\u0131ll\u0131 Entegrasyon', { timeoutMs: 4000, settleMs: 1200 })) {
              await clickByTextEverywhere('Akıllı Entegrasyon', log, { maxMs: 4000 });
              await sleep(1200);
            }
            if (!await nativeClickLucaText(menuLabel, { timeoutMs: 7000, settleMs: 2200 })) {
              await clickByTextEverywhere(menuLabel, log, { maxMs: 7000 });
            }
            basariliAcildi = await waitForEbelgePage(8000);
          } catch (e2) {
            await log(`⚠ Akıllı Entegrasyon click fallback sonuç vermedi: ${String(e2?.message || e2).slice(0, 120)}`);
          }
          if (!basariliAcildi) {
            await log(`⚠ "${menuLabel}" metin menüsünden bulunamadı; direkt II1a kodları tekrar deneniyor`);
            for (const altId of ii1aIds) {
              basariliAcildi = await tryOpenByII1a(altId, 'metin menü sonrası');
              if (basariliAcildi) break;
            }
          }
          if (!basariliAcildi) {
            basariliAcildi = await tryOpenByDiscoveredMenuTargets('metin menu sonrasi');
          }
          if (!basariliAcildi) {
            await log(`⚠ ${menuLabel} ekranı metin/II1a/menü kodu ile açılamadı; son doğrulama yapılacak`);
          }
        } finally {
          if (hoverTimer) clearInterval(hoverTimer);
        }
      }
      await log('⏳ E-belge ekranı bekleniyor…');
      // v1.38: Kör 6sn+4sn bekleme yerine akıllı polling — ekran hazır olur
      // olmaz devam et, en geç 10sn'de pes et (eski toplam tavanla aynı).
      // E-belge ekranı Luca sürümüne/firmaya göre farklı frame'de açılabiliyor;
      // findEbelgePageContext tüm uygun frame'leri tarar.
      let ebelgeContext = await waitUntil(() => findEbelgePageContext(), 10000, 200);
      if (!ebelgeContext) {
        const frameHint = describeEbelgeFrames();
        throw new Error(`${menuLabel} ekranı açılamadı; Luca oturumu, firma yetkisi veya menü yapısı kontrol edilmeli${frameHint ? `; frame ipucu: ${frameHint}` : ''}`);
      }
      if (!basariliAcildi && ebelgeContextAtStart && !isFreshEbelgeContext(ebelgeContext, ebelgeContextAtStart)) {
        await log(`⚠ ${menuLabel} ekranı yeni frame olarak doğrulanamadı; mevcut e-belge ekranıyla devam ediliyor`);
      }
      try { window.__morenLastEbelgeKey = expectedEbelgeKey; } catch {}
      await log(`✅ ${menuLabel} ekranı hazır (${ebelgeContext.label || 'frame'})`);
      frm3 = { contentDocument: ebelgeContext.doc, contentWindow: ebelgeContext.win };
    }

    // Tarih hesaplayıcı: ayın son günü, sonraki ay başı, bugün
    const ayinSonGunu = (y, m) => new Date(y, m, 0).getDate(); // m=1-12, son gün
    const fmt = (d, m, y) => `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;

    const sorgu1Bas = fmt(1, ay, yil);
    const sorgu1Bit = fmt(ayinSonGunu(yil, ay), ay, yil);

    // Sorgu 2 (sonraki ay başı → bugün) — Luca'nın tarih kesimi her zaman seçili dönem sonunda
    // bittiği için, bir sonraki ay başından bugüne kadar olan faturaları da yakalamak için 2. sorgu.
    // Sadece seçili ay GEÇMİŞ ise tetiklenir (örn. Nisan sorgusunda Mayıs 1→bugün de çekilir).
    // Seçili ay zaten ŞU ANKI ay ise gereksiz (zaten Sorgu1 bugünü kapsıyor).
    const sonAy = ay === 12 ? 1 : ay + 1;
    const sonYil = ay === 12 ? yil + 1 : yil;
    const bugun = new Date();
    const buAy = bugun.getMonth() + 1;
    const buYil = bugun.getFullYear();
    // Seçili ay bu aydan ÖNCE ise Sorgu2 gerekli
    const sorgu2Gerekli = (yil < buYil) || (yil === buYil && ay < buAy);
    const sorgu2Bas = fmt(1, sonAy, sonYil);
    const sorgu2Bit = fmt(bugun.getDate(), buAy, buYil);

    if (sorgu2Gerekli) {
      await log(`📅 Sorgu 1: ${sorgu1Bas} → ${sorgu1Bit}`);
      await log(`📅 Sorgu 2: ${sorgu2Bas} → ${sorgu2Bit} (sonraki ay → bugün)`);
    } else {
      await log(`📅 Sorgu: ${sorgu1Bas} → ${sorgu1Bit} (Sorgu 2 atlandı — seçili ay = bu ay)`);
    }

    const ebelgeContext = findEbelgePageContext();
    if (!ebelgeContext?.doc || !ebelgeContext?.win) {
      throw new Error('e-Belge ekranı bulunamadı — menü açılmış görünmüyor');
    }
    const fdoc = ebelgeContext.doc;
    const fwin = ebelgeContext.win;

    // ZIP intercept: TÜM accessible frame'lerde fetch + XHR + window.open + anchor download
    // hook'la — Luca download'u herhangi bir frame'den fire edebilir.
    // AYRICA: Mizan/Excel akışında çalışan moren-bridge Chrome extension'ı da
    // dinle — Luca native browser download yapıyorsa bridge URL/blob iletir.
    let yakalanmisZip = null;
    let zipNetworkInFlight = false;

    const acceptZipBlob = async (blob, label, ct = '', cd = '') => {
      try {
        if (!blob || blob.size <= 100 || yakalanmisZip) return false;
        const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        const isZipMagic = head[0] === 0x50 && head[1] === 0x4b; // "PK"
        const headers = `${ct || ''} ${cd || ''}`.toLowerCase();
        if (!isZipMagic) {
          if (blob.size > 1000 || headers.includes('zip') || headers.includes('attachment') || headers.includes('filename')) {
            await log(`⚠ ZIP olmayan cevap atlandı (${label}, ct=${String(ct || '').slice(0, 40)}, size=${Math.round(blob.size / 1024)} KB)`);
          }
          return false;
        }
        yakalanmisZip = blob;
        await log(`📥 ZIP yakalandı (${label}, ${Math.round(blob.size / 1024)} KB)`);
        return true;
      } catch (e) {
        await log(`⚠ ZIP doğrulama hatası (${label}): ${e?.message || e}`);
        return false;
      }
    };

    // ─── MOREN BRIDGE (Chrome extension) ───
    // Background script'e "download bekliyorum" sinyali (Excel akışıyla aynı)
    const postExpectingZip = (val) => {
      if (val && lucaManualDownloadMode()) return;
      const payload = { source: 'moren-agent', type: 'set-expecting', expecting: val };
      try { window.postMessage(payload, '*'); } catch (e) {}
      try { if (window.top && window.top !== window) window.top.postMessage(payload, '*'); } catch (e) {}
    };
    postExpectingZip(true);
    await log('🔔 moren-bridge: download bekleniyor sinyali gönderildi');

    // Bridge'den gelen download URL'ini dinle (background chrome.downloads intercepted)
    const onBridgeMessage = async (event) => {
      try {
        const data = event.data;
        if (!data || data.source !== 'moren-bridge' || data.type !== 'lucaDownload') return;
        const dlUrl = data.url;
        if (!dlUrl || yakalanmisZip) return;
        await log(`🌉 Bridge: download URL geldi: ${String(dlUrl).split('/').pop().slice(0, 60)}`);
        try {
          const r = await fetch(dlUrl, { credentials: 'include' });
          if (r.ok) {
            const blob = await r.blob();
            await acceptZipBlob(blob, 'bridge URL fetch', r.headers.get('content-type') || '', r.headers.get('content-disposition') || '');
          }
        } catch (e) {
          await log(`⚠ Bridge URL fetch hatası: ${e?.message || e}`);
        }
      } catch (e) {}
    };
    window.addEventListener('message', onBridgeMessage);

    // Bridge dosyayı disk'ten okuyup direkt blob olarak gönderebilir
    const onLucaFile = async (e) => {
      try {
        const detail = e.detail || {};
        const blob = detail.blob;
        await acceptZipBlob(blob, `bridge disk → blob, dosya: ${String(detail.filename || '').split(/[\\\/]/).pop()}`);
      } catch (e) {}
    };
    window.addEventListener('moren-luca-file', onLucaFile);

    // Hook'lanan tüm frame'lerin orijinal fonksiyonlarını sakla (cleanup için)
    const hookedFrames = []; // [{ win, origFetch, origXHROpen, origXHRSend, origWindowOpen, origCreateElement }]

    const collectAllWindows = () => {
      const wins = new Set();
      const dive = (w) => {
        try {
          if (!w || wins.has(w)) return;
          // Test access (cross-origin'de patlar)
          void w.location.href;
          wins.add(w);
          for (let i = 0; i < (w.frames?.length || 0); i++) {
            try { dive(w.frames[i]); } catch {}
          }
        } catch {}
      };
      dive(window.top || window);
      dive(window);
      dive(fwin);
      return [...wins];
    };

    const hookOneFrame = (w) => {
      try {
        const orig = {
          win: w,
          origFetch: w.fetch,
          origXHROpen: w.XMLHttpRequest && w.XMLHttpRequest.prototype.open,
          origXHRSend: w.XMLHttpRequest && w.XMLHttpRequest.prototype.send,
          origWindowOpen: w.open,
          origCreateElement: w.document && w.document.createElement,
          origFormSubmit: w.HTMLFormElement && w.HTMLFormElement.prototype.submit,
        };
        hookedFrames.push(orig);

        // Form submit hijack
        if (orig.origFormSubmit && orig.origFetch) {
          w.HTMLFormElement.prototype.submit = function() {
            if (lucaManualDownloadMode()) return orig.origFormSubmit.call(this);
            try {
              var action = String(this.action || '').toLowerCase();
              if (action && (action.indexOf('zip') >= 0 || action.indexOf('indir') >= 0 || action.indexOf('download') >= 0)) {
                zipNetworkInFlight = true;
                var fd = new FormData(this);
                var method = (this.method || 'POST').toUpperCase();
                var actionUrl = this.action;
                (async function() {
                  try {
                    var res;
                    if (method === 'GET') {
                      var params = new URLSearchParams();
                      for (var entry of fd.entries()) params.append(entry[0], entry[1].toString());
                      res = await orig.origFetch.call(w, actionUrl + (actionUrl.indexOf('?') >= 0 ? '&' : '?') + params.toString(), { credentials: 'include' });
                    } else {
                      res = await orig.origFetch.call(w, actionUrl, { method: method, body: fd, credentials: 'include' });
                    }
                    var blob = await res.blob();
                    await acceptZipBlob(blob, 'form.submit hijack', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                  } catch (e) {}
                })();
                return;
              }
            } catch (e) {}
            return orig.origFormSubmit.call(this);
          };
        }

        // submit event capture
        try {
          w.document.addEventListener('submit', function(ev) {
            try {
              if (lucaManualDownloadMode()) return;
              var f = ev.target;
              if (!f || !f.action) return;
              var action = String(f.action || '').toLowerCase();
              if (action.indexOf('zip') < 0 && action.indexOf('indir') < 0 && action.indexOf('download') < 0) return;
              zipNetworkInFlight = true;
              ev.preventDefault();
              ev.stopPropagation();
              var fd = new FormData(f);
              var method = (f.method || 'POST').toUpperCase();
              var actionUrl = f.action;
              (async function() {
                try {
                  var res;
                  if (method === 'GET') {
                    var params = new URLSearchParams();
                    for (var entry of fd.entries()) params.append(entry[0], entry[1].toString());
                    res = await orig.origFetch.call(w, actionUrl + (actionUrl.indexOf('?') >= 0 ? '&' : '?') + params.toString(), { credentials: 'include' });
                  } else {
                    res = await orig.origFetch.call(w, actionUrl, { method: method, body: fd, credentials: 'include' });
                  }
                  var blob = await res.blob();
                  await acceptZipBlob(blob, 'submit event', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                } catch (e) {}
              })();
            } catch (e) {}
          }, true);
        } catch (e) {}

        // iframe src setter hijack
        try {
          var iframeProto = w.HTMLIFrameElement && w.HTMLIFrameElement.prototype;
          if (iframeProto && !iframeProto.__morenSrcHooked) {
            var desc = Object.getOwnPropertyDescriptor(iframeProto, 'src');
            if (desc && desc.set) {
              iframeProto.__morenSrcHooked = true;
              var origSet = desc.set;
              Object.defineProperty(iframeProto, 'src', {
                configurable: desc.configurable,
                enumerable: desc.enumerable,
                get: desc.get,
                set: function(value) {
                  if (lucaManualDownloadMode()) return origSet.call(this, value);
                  try {
                    var u = String(value || '').toLowerCase();
                    if (u && (u.indexOf('zip') >= 0 || u.indexOf('indir') >= 0 || u.indexOf('download') >= 0)) {
                      zipNetworkInFlight = true;
                      (async function() {
                        try {
                          var absUrl = new URL(value, w.location.href).toString();
                          var res = await orig.origFetch.call(w, absUrl, { credentials: 'include' });
                          var blob = await res.blob();
                          await acceptZipBlob(blob, 'iframe src hijack', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                        } catch (e) {}
                      })();
                    }
                  } catch (e) {}
                  return origSet.call(this, value);
                },
              });
            }
          }
        } catch (e) {}

        // fetch
        if (orig.origFetch) {
          w.fetch = async function(...args) {
            if (lucaManualDownloadMode()) return orig.origFetch.apply(this, args);
            const url = String(args[0] && args[0].url || args[0] || '');
            try {
              const lurl = url.toLowerCase();
              if (lurl.includes('zip') || lurl.includes('indir') || lurl.includes('download') || lurl.includes('gib_ebelge') || lurl.includes('gib530') || lurl.includes('.jq')) zipNetworkInFlight = true;
            } catch {}
            const res = await orig.origFetch.apply(this, args);
            try {
              const ct = res.headers.get('content-type') || '';
              const cd = res.headers.get('content-disposition') || '';
              const cloned = res.clone();
              const blob = await cloned.blob();
              const isBin = ct.includes('zip') || cd.includes('.zip') || ct.includes('octet-stream') ||
                            ct.includes('application/x-zip') || cd.includes('attachment') || cd.includes('filename') ||
                            (blob && blob.size > 1000 && !ct.startsWith('text/') && !ct.startsWith('application/json') && !ct.startsWith('application/javascript'));
              // DEBUG: Tüm büyük (>1KB) response'ları logla
              if (blob && blob.size > 1000) {
                log(`🔍 FETCH ${url.slice(-80)} → ct=${ct.slice(0,30)}, size=${Math.round(blob.size/1024)}KB, isBin=${isBin}`).catch(() => {});
              }
              if (isBin) await acceptZipBlob(blob, 'fetch', ct, cd);
            } catch {}
            return res;
          };
        }

        // XHR
        if (orig.origXHROpen) {
          w.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__url = url;
            this.__method = method;
            return orig.origXHROpen.call(this, method, url, ...rest);
          };
          w.XMLHttpRequest.prototype.send = function(...args) {
            if (lucaManualDownloadMode()) return orig.origXHRSend.apply(this, args);
            const sendBody = args[0];
            const sendMethod = this.__method || 'POST';
            const fullUrl = this.__url;
            try {
              const url = String(this.__url || '').toLowerCase();
              const isCandidate = url.includes('zip') || url.includes('indir') || url.includes('download') ||
                  url.includes('gib_ebelge') || url.includes('gib530') || url.includes('.jq');
              if (isCandidate) zipNetworkInFlight = true;
              // DEBUG: TÜM XHR'leri load event'inde log'la
              this.addEventListener('load', () => {
                try {
                  const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
                  const cd = (this.getResponseHeader('content-disposition') || '').toLowerCase();
                  const cl = (this.getResponseHeader('content-length') || '').toLowerCase();
                  const sz = parseInt(cl, 10) || 0;
                  if (sz > 1000 || isCandidate) {
                    log(`🔍 XHR ${sendMethod} ${String(fullUrl).slice(-80)} → ct=${ct.slice(0,40)}, cd=${cd.slice(0,40)}, size=${sz ? Math.round(sz/1024)+'KB' : '?'}`).catch(() => {});
                  }
                  const looksLikeBinary = ct.includes('zip') || ct.includes('octet-stream') ||
                                          ct.includes('application/x-zip') ||
                                          cd.includes('attachment') || cd.includes('filename');
                  if (looksLikeBinary && !yakalanmisZip) {
                    log(`🔄 XHR binary tespit edildi (${String(fullUrl).slice(0,60)}), re-fetch ile blob alınıyor`).catch(() => {});
                    (async () => {
                      try {
                        const init = { method: sendMethod, credentials: 'include' };
                        if (sendMethod !== 'GET' && sendBody !== undefined && sendBody !== null) {
                          init.body = sendBody;
                        }
                        const res = await orig.origFetch.call(w, fullUrl, init);
                        const blob = await res.blob();
                        await acceptZipBlob(blob, 'XHR re-fetch', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                      } catch (e) {
                        log(`⚠ XHR re-fetch hatası: ${e?.message || e}`).catch(() => {});
                      }
                    })();
                  }
                } catch {}
              }, { once: true });
            } catch {}
            return orig.origXHRSend.apply(this, args);
          };
        }

        // window.open
        if (orig.origWindowOpen) {
          w.open = function(url, ...rest) {
            if (lucaManualDownloadMode()) return orig.origWindowOpen.call(this, url, ...rest);
            try {
              const u = String(url || '').toLowerCase();
              if (u && (u.includes('zip') || u.includes('indir') || u.includes('download'))) {
                zipNetworkInFlight = true;
                (async () => {
                  try {
                    const absUrl = new URL(url, w.location.href).toString();
                    const res = await orig.origFetch.call(w, absUrl, { credentials: 'include' });
                    const blob = await res.blob();
                    await acceptZipBlob(blob, 'window.open hijack', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                  } catch (e) {
                    log(`⚠ window.open hijack fetch hatası: ${e?.message || e}`).catch(() => {});
                  }
                })();
                return null;
              }
            } catch {}
            return orig.origWindowOpen.call(this, url, ...rest);
          };
        }

        // <a> createElement hijack
        if (orig.origCreateElement) {
          w.document.createElement = function(tagName) {
            const el = orig.origCreateElement.call(w.document, tagName);
            if (String(tagName).toLowerCase() === 'a') {
              const origClick = el.click.bind(el);
              el.click = function() {
                if (lucaManualDownloadMode()) return origClick();
                try {
                  const href = String(this.href || '').toLowerCase();
                  const dl = this.getAttribute('download');
                  if ((dl !== null) || href.includes('zip') || href.includes('indir') || href.includes('download')) {
                    zipNetworkInFlight = true;
                    (async () => {
                      try {
                        const res = await orig.origFetch.call(w, this.href, { credentials: 'include' });
                        const blob = await res.blob();
                        await acceptZipBlob(blob, 'anchor hijack', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                      } catch (e) {
                        log(`⚠ anchor hijack fetch hatası: ${e?.message || e}`).catch(() => {});
                      }
                    })();
                    return;
                  }
                } catch {}
                return origClick();
              };
            }
            return el;
          };
        }
      } catch (e) {
        // Frame'i hook'layamadık, geç
      }
    };

    // İlk başta tüm bilinen frame'leri hook'la
    for (const w of collectAllWindows()) {
      hookOneFrame(w);
    }
    await log(`🔌 ZIP yakalama: ${hookedFrames.length} frame'e hook kuruldu`);

    // Backward compat — alt kodda fwin.fetch, vs. değişti mi diye geri yüklemek için
    const origFetch = hookedFrames.find(h => h.win === fwin)?.origFetch || fwin.fetch;
    const origXHROpen = hookedFrames.find(h => h.win === fwin)?.origXHROpen;
    const origXHRSend = hookedFrames.find(h => h.win === fwin)?.origXHRSend;

    // ─── Aktivite sayacı (birSorgu silence-wait + ZIP wait için) ───
    // fatura_kaydet/gib530 XHR'larını sayar; lastTs'i bump eder.
    // birSorgu done sinyali görüldükten sonra "X sn aktivite yok" garantisini bu sağlar.
    if (!window.__morenLucaActivity) window.__morenLucaActivity = { count: 0, lastTs: Date.now() };
    const installAgentActivityHooks = (w, depth = 0) => {
      if (depth > 6 || !w) return;
      try {
        if (w.__morenAgentActHooked) return;
        w.__morenAgentActHooked = true;
        const oOpen = w.XMLHttpRequest && w.XMLHttpRequest.prototype.open;
        if (oOpen) {
          w.XMLHttpRequest.prototype.open = function(m, u) {
            if (u && /gib530|fatura_kaydet|gib_efatura|gib_ebelge|topluFatura/i.test(String(u))) {
              window.__morenLucaActivity.count++;
              window.__morenLucaActivity.lastTs = Date.now();
            }
            return oOpen.apply(this, arguments);
          };
        }
        const oFetch = w.fetch;
        if (oFetch) {
          w.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url && /gib530|fatura_kaydet|gib_efatura|gib_ebelge|topluFatura/i.test(url)) {
              window.__morenLucaActivity.count++;
              window.__morenLucaActivity.lastTs = Date.now();
            }
            return oFetch.apply(this, arguments);
          };
        }
        const frames = w.document && w.document.querySelectorAll('frame, iframe');
        if (frames) for (const f of frames) {
          try { if (f.contentWindow) installAgentActivityHooks(f.contentWindow, depth + 1); } catch {}
        }
      } catch {}
    };
    installAgentActivityHooks(window);
    const agentActHookInterval = setInterval(() => installAgentActivityHooks(window), 2000);
    const getAgentActivityCount = () => window.__morenLucaActivity.count;
    const getAgentLastActivityTs = () => window.__morenLucaActivity.lastTs;

    // birSorgu done sinyali sonrası: XHR aktivitesi N saniye boyunca durana kadar bekle.
    // Bu sayede "fatura kaydetme işlemi sona erdi" mesajı çıktı ama hâlâ son fatura_kaydet'ler
    // yoldaysa onları da bekleriz; sonra Sorgu 2'ye veya download'a geçeriz.
    async function waitForActivitySilence(label, silenceMs = 5000, maxWaitMs = 60000) {
      await throwIfCancelled();
      const startTs = Date.now();
      const startCount = getAgentActivityCount();
      // İlk başta lastTs'i şimdiye çek (eski işlemden kalan değer beklemeyi yanlış kısaltmasın)
      let lastSeenCount = startCount;
      let lastChangeTs = Date.now();
      while (Date.now() - startTs < maxWaitMs) {
        await throwIfCancelled();
        const c = getAgentActivityCount();
        if (c !== lastSeenCount) {
          lastSeenCount = c;
          lastChangeTs = Date.now();
        }
        const silentFor = Date.now() - lastChangeTs;
        if (silentFor >= silenceMs) {
          const delta = c - startCount;
          await log(`✓ ${label}: ${silenceMs/1000}sn XHR sessizliği (toplam ${delta} ek XHR), devam ediliyor`);
          return delta;
        }
        await sleep(500);
      }
      const delta = getAgentActivityCount() - startCount;
      await log(`⚠ ${label}: ${maxWaitMs/1000}sn boyunca aktivite kesilmedi (toplam ${delta} ek XHR), yine de devam ediliyor`);
      return delta;
    }

    const collectEbelgeDocsDeep = () => {
      const docs = [];
      const seenWins = new Set();
      const seenDocs = new Set();
      const addDoc = (doc) => {
        try {
          if (!doc || seenDocs.has(doc)) return;
          seenDocs.add(doc);
          docs.push(doc);
        } catch {}
      };
      const visit = (w) => {
        try {
          if (!w || seenWins.has(w)) return;
          void w.location.href;
          seenWins.add(w);
          addDoc(w.document);
          for (let i = 0; i < (w.frames?.length || 0); i++) {
            try { visit(w.frames[i]); } catch {}
          }
        } catch {}
      };
      try { visit(fwin); } catch {}
      try { visit(window); } catch {}
      try { visit(window.top || window); } catch {}
      try { if (parent && parent !== window) visit(parent); } catch {}
      return docs;
    };

    const inputDescriptor = (el) => {
      try {
        return foldEbelgeText([
          el?.id,
          el?.name,
          el?.placeholder,
          el?.title,
          el?.getAttribute?.('aria-label'),
          el?.getAttribute?.('data-field'),
          el?.getAttribute?.('data-name'),
          el?.className,
        ].filter(Boolean).join(' '));
      } catch {
        return '';
      }
    };

    const isUsableInput = (el) => {
      try {
        if (!el || String(el.tagName || '').toLowerCase() !== 'input') return false;
        const type = String(el.type || '').toLowerCase();
        if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio') return false;
        if (el.disabled || el.readOnly) return false;
        return true;
      } catch {
        return false;
      }
    };

    const isRejectedDateInput = (el) => {
      const desc = inputDescriptor(el);
      return /vergi|tc|kimlik|mukellef|musteri|sirket|firma|unvan|adres|telefon|mail|eposta|vkn|tckn|hesap|dairesi/i.test(desc);
    };

    const findDatePairInDoc = (doc) => {
      try {
        if (!doc) return null;
        const exactStart = doc.getElementById('tarih1') ||
          doc.querySelector('input[name="tarih1"], input[name="TARIH1"], input[id="TARIH1"]');
        const exactEnd = doc.getElementById('tarih2') ||
          doc.querySelector('input[name="tarih2"], input[name="TARIH2"], input[id="TARIH2"]');
        if (isUsableInput(exactStart) && isUsableInput(exactEnd)) {
          return { doc, t1: exactStart, t2: exactEnd, source: 'tarih1/tarih2' };
        }

        const inputs = Array.from(doc.querySelectorAll('input')).filter(isUsableInput);
        const startRx = /(tarih\s*1|date\s*1|tar\s*1|baslangic|baslama|ilk\s*tarih|bas\s*tarih|start|from)/i;
        const endRx = /(tarih\s*2|date\s*2|tar\s*2|bitis|bitirme|son\s*tarih|bit\s*tarih|end|to)/i;
        const dateRx = /(tarih|date|baslangic|bitis|bas\s*tarih|bit\s*tarih|ilk|son)/i;

        const start = inputs.find((el) => startRx.test(inputDescriptor(el)));
        const end = inputs.find((el) => endRx.test(inputDescriptor(el)));
        if (start && end && start !== end) {
          return { doc, t1: start, t2: end, source: 'named-date-inputs' };
        }

        const dateLikes = inputs.filter((el) => {
          if (isRejectedDateInput(el)) return false;
          const desc = inputDescriptor(el);
          const type = String(el.type || '').toLowerCase();
          const val = String(el.value || el.placeholder || '');
          return type === 'date' ||
            dateRx.test(desc) ||
            /\d{2}[./-]\d{2}[./-]\d{4}/.test(val);
        });
        if (dateLikes.length >= 2) {
          return { doc, t1: dateLikes[0], t2: dateLikes[1], source: 'date-like-inputs' };
        }
      } catch {}
      return null;
    };

    const findDatePairEverywhere = () => {
      for (const doc of collectEbelgeDocsDeep()) {
        const pair = findDatePairInDoc(doc);
        if (pair) return pair;
      }
      return null;
    };

    const waitForDatePair = async (maxMs = 12000) => {
      const started = Date.now();
      while (Date.now() - started < maxMs) {
        await throwIfCancelled();
        const pair = findDatePairEverywhere();
        if (pair) return pair;
        await sleep(300);
      }
      return null;
    };

    const describeDateInputs = () => {
      const hints = [];
      for (const doc of collectEbelgeDocsDeep()) {
        try {
          const title = doc.title || '';
          const inputs = Array.from(doc.querySelectorAll('input')).slice(0, 20).map((el) => {
            const d = inputDescriptor(el);
            const type = String(el.type || '');
            return `${el.id || el.name || '?'}:${type}:${d.slice(0, 35)}`;
          }).filter(Boolean);
          if (inputs.length) hints.push(`${title || 'doc'}=[${inputs.join(', ')}]`);
        } catch {}
      }
      return hints.slice(0, 3).join(' | ');
    };

    const setDateInputValue = (el, value) => {
      const win = el?.ownerDocument?.defaultView || window;
      el.focus?.();
      el.value = value;
      try {
        const proto = win.HTMLInputElement && win.HTMLInputElement.prototype;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value);
      } catch {}
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      el.blur?.();
    };

    const findGetirButtonEverywhere = (preferredDoc) => {
      const docs = [];
      if (preferredDoc) docs.push(preferredDoc);
      if (fdoc && fdoc !== preferredDoc) docs.push(fdoc);
      for (const doc of collectEbelgeDocsDeep()) {
        if (!docs.includes(doc)) docs.push(doc);
      }
      for (const doc of docs) {
        const btn = findLikelyEbelgeGetirButton(doc);
        if (btn) return btn;
      }
      return null;
    };

    const describeEbelgeElementForLog = (el) => {
      try {
        const text = getElementText(el).replace(/\s+/g, ' ').trim();
        const tag = String(el?.tagName || '').toLowerCase();
        const attrs = [
          tag ? `tag=${tag}` : '',
          el?.type ? `type=${el.type}` : '',
          el?.id ? `id=${el.id}` : '',
          el?.name ? `name=${el.name}` : '',
          el?.className ? `class=${String(el.className).replace(/\s+/g, '.')}` : '',
          el?.value ? `value=${el.value}` : '',
          el?.title ? `title=${el.title}` : '',
          el?.alt ? `alt=${el.alt}` : '',
          el?.action ? `action=${String(el.action).slice(0, 80)}` : '',
          el?.href ? `href=${String(el.href).slice(0, 80)}` : '',
          el?.getAttribute?.('onclick') ? `onclick=${String(el.getAttribute('onclick')).slice(0, 80)}` : '',
          Array.from(el?.querySelectorAll?.('img') || [])
            .map((img) => img.alt ? `imgAlt=${img.alt}` : '')
            .filter(Boolean)
            .join(' '),
        ].filter(Boolean).join(' ');
        return (text || attrs || String(el?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 120) || 'button').slice(0, 180);
      } catch {
        return 'button';
      }
    };

    const describeEbelgeActionCandidates = (preferredDoc = null, limit = 35) => {
      const docs = [];
      const addDoc = (doc) => {
        if (doc && !docs.includes(doc)) docs.push(doc);
      };
      addDoc(preferredDoc);
      addDoc(fdoc);
      for (const doc of collectEbelgeDocsDeep()) addDoc(doc);

      const rows = [];
      for (const doc of docs) {
        try {
          const docLabel = (doc.title || doc.defaultView?.name || doc.defaultView?.frameElement?.id || 'doc')
            .replace(/\s+/g, ' ')
            .slice(0, 40);
          const els = Array.from(doc.querySelectorAll([
            'form',
            'button',
            'input',
            'a',
            '[role=button]',
            '[onclick]',
            '[href]',
          ].join(',')));
          for (const el of els) {
            const desc = describeEbelgeElementForLog(el).replace(/\s+/g, ' ').trim();
            if (!desc) continue;
            rows.push(`${docLabel}: ${desc}`);
            if (rows.length >= limit) return rows.join(' || ');
          }
        } catch {}
      }
      return rows.join(' || ');
    };

    const elementLooksLikeEbelgeAction = (el, arg) => {
      const txt = getElementText(el);
      const attrs = foldEbelgeText([
        el?.id,
        el?.name,
        el?.title,
        el?.className,
        el?.value,
        el?.getAttribute?.('aria-label'),
        el?.getAttribute?.('onclick'),
        el?.getAttribute?.('href'),
      ].filter(Boolean).join(' '));
      const hay = `${txt} ${attrs}`;
      if (arg === 'indir-window') {
        return hay.includes('indir-window') ||
          hay.includes('fatura indir') ||
          hay.includes('belge indir') ||
          (hay.includes('indir') && !hay.includes('secilenleri') && !hay.includes('zip-window'));
      }
      if (arg === 'zip-window') {
        return hay.includes('zip-window') ||
          hay.includes('secilenleri indir') ||
          hay.includes('secilen belge') ||
          hay.includes('toplu indir');
      }
      return hay.includes(arg);
    };

    const clickEbelgeActionElement = (el) => {
      const win = el?.ownerDocument?.defaultView || window;
      try { el.focus?.(); } catch {}
      try { el.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true, cancelable: true, view: win })); } catch {}
      try { el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win })); } catch {}
      try { el.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win })); } catch {}
      try { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win })); } catch {}
      try { if (typeof el.click === 'function') el.click(); } catch {}
    };

    const callEbelgeGonderEverywhere = async (arg, label) => {
      const wins = [];
      for (const w of [fwin, window, window.top, parent]) {
        try { if (w && !wins.includes(w)) wins.push(w); } catch {}
      }
      for (const w of collectAllWindows()) {
        if (w && !wins.includes(w)) wins.push(w);
      }

      for (const w of wins) {
        try {
          if (typeof w.gonder === 'function') {
            w.gonder(arg);
            await log(`✓ ${label}: gonder("${arg}") çağrıldı (${w === fwin ? 'ebelge frame' : w === window ? 'window' : w === window.top ? 'top' : 'frame'})`);
            return true;
          }
        } catch (e) {
          await log(`⚠ ${label}: gonder("${arg}") hata: ${String(e?.message || e).slice(0, 90)}`);
        }
      }

      const directCandidates = [];
      for (const doc of collectEbelgeDocsDeep()) {
        try {
          for (const el of doc.querySelectorAll('[onclick], a[href], button, input[type=button], input[type=submit], input[type=image], [role=button]')) {
            if (elementLooksLikeEbelgeAction(el, arg)) directCandidates.push(el);
          }
        } catch {}
      }
      for (const el of directCandidates) {
        try {
          const desc = getElementText(el) || String(el.getAttribute?.('onclick') || el.getAttribute?.('href') || '').slice(0, 80);
          await log(`🖱 ${label}: gonder yok, DOM aksiyonu tıklanıyor: ${desc.slice(0, 80) || arg}`);
          clickEbelgeActionElement(el);
          return true;
        } catch (e) {
          await log(`⚠ ${label}: DOM aksiyonu hata: ${String(e?.message || e).slice(0, 90)}`);
        }
      }

      await log(`⚠ ${label}: gonder("${arg}") veya uygun DOM aksiyonu bulunamadı`);
      return false;
    };

    const callEbelgeNamedFunctionEverywhere = async (names, label, preferredWin = null) => {
      const wins = [];
      for (const w of [preferredWin, fwin, window, window.top, parent]) {
        try { if (w && !wins.includes(w)) wins.push(w); } catch {}
      }
      for (const w of collectAllWindows()) {
        if (w && !wins.includes(w)) wins.push(w);
      }
      for (const w of wins) {
        for (const name of names) {
          try {
            if (typeof w?.[name] === 'function') {
              w[name]();
              await log(`✓ ${label}: ${name}() çağrıldı (${w === preferredWin ? 'date frame' : w === fwin ? 'ebelge frame' : w === window ? 'window' : w === window.top ? 'top' : 'frame'})`);
              return true;
            }
          } catch (e) {
            await log(`⚠ ${label}: ${name}() hata: ${String(e?.message || e).slice(0, 90)}`);
          }
        }
      }
      return false;
    };

    const submitEbelgeDateFormFallback = async (datePair, label) => {
      try {
        const doc = datePair?.doc;
        const win = doc?.defaultView || window;
        const form = datePair?.t2?.closest?.('form') || datePair?.t1?.closest?.('form') || null;
        if (form) {
          const action = String(form.action || form.getAttribute?.('action') || '');
          if (!/selectSirketAction/i.test(action)) {
            await log(`🖱 ${label}: tarih formu submit deneniyor (${action.slice(0, 80) || 'aynı sayfa'})`);
            try {
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
              } else {
                form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
                if (typeof form.submit === 'function') form.submit();
              }
              return true;
            } catch (e) {
              await log(`⚠ ${label}: form submit hata: ${String(e?.message || e).slice(0, 90)}`);
            }
          }
        }
        const target = datePair?.t2 || datePair?.t1;
        if (target) {
          await log(`⌨ ${label}: tarih alaninda Enter deneniyor`);
          target.focus?.();
          for (const type of ['keydown', 'keypress', 'keyup']) {
            target.dispatchEvent(new win.KeyboardEvent(type, {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            }));
          }
          return true;
        }
      } catch (e) {
        await log(`⚠ ${label}: submit/Enter fallback hata: ${String(e?.message || e).slice(0, 90)}`);
      }
      return false;
    };

    // İki sorgu yap — her birinde modal aç → tarih yaz → Belgeleri Getir → bekle
    async function birSorgu(bas, bit, etiket) {
      await throwIfCancelled();
      await log(`🔍 ${etiket}: ${bas} → ${bit}`);
      // Modal aç
      if (!await callEbelgeGonderEverywhere('indir-window', `${etiket} tarih modalı`)) {
        throw new Error('indir-window aksiyonu bulunamadı — Luca sayfası beklenen yapıda değil');
      }
      await sleep(800); // modal animasyonu

      // Tarih input'ları Luca sürümüne göre farklı frame/modal içinde açılabiliyor.
      const datePair = await waitForDatePair(12000);
      if (!datePair) {
        const inputHints = describeDateInputs();
        throw new Error(`tarih inputlari bulunamadi; modal acilmadi veya selector degisti${inputHints ? `; input ipucu: ${inputHints}` : ''}`);
      }
      await log(`✓ Tarih alanları bulundu (${datePair.source})`);
      setDateInputValue(datePair.t1, bas);
      setDateInputValue(datePair.t2, bit);
      await sleep(200);

      // Belgeleri Getir butonu
      const activityBeforeClick = getAgentActivityCount();
      let triggerMethod = '';
      const getirBtn = findGetirButtonEverywhere(datePair.doc);
      if (getirBtn) {
        await log(`🖱 Belgeleri Getir tetikleniyor (${describeEbelgeElementForLog(getirBtn)})`);
        clickEbelgeActionElement(getirBtn);
        triggerMethod = 'button';
      } else if (await callEbelgeNamedFunctionEverywhere(['sorgula', 'faturalariGetir', 'belgeleriGetir', 'getir'], 'Belgeleri Getir fonksiyon fallback', datePair.doc?.defaultView)) {
        await log(`🖱 Belgeleri Getir fonksiyon ile tetiklendi`);
        triggerMethod = 'function';
      } else if (await submitEbelgeDateFormFallback(datePair, 'Belgeleri Getir submit fallback')) {
        await log(`🖱 Belgeleri Getir form/Enter fallback ile tetiklendi`);
        triggerMethod = 'form-enter';
      } else {
        const actionHints = describeEbelgeActionCandidates(datePair.doc, 35);
        if (actionHints) await log(`🔎 E-belge aksiyon adaylari: ${actionHints}`);
        throw new Error('faturalari-getir-btn bulunamadı');
      }
      await log(`⏳ Belgeleri Getir tıklandı, sonuçlar bekleniyor (${etiket})…`);

      // İşlem Takip popup'ı açılır, GİB sorgu yapar.
      // Çok fatura varsa bu 60-90sn sürebilir (örn 333 belge → her biri ayrı GİB sorgusu).
      // Sabit 8sn yetersiz — POLLING ile bekle: max 5 dk, "N adet fatura bulundu" ya da
      // "İşlem tamamlandı" gibi tamamlanma sinyalini bekle.
      const POLL_INTERVAL = 1000;
      const POLL_MAX_MS = 5 * 60 * 1000; // 5 dakika
      const pollStart = Date.now();
      let queryDone = false;
      let lastProgress = '';
      let lastProgressLogTs = 0;
      let sawQueryActivity = false;
      while (Date.now() - pollStart < POLL_MAX_MS) {
        await throwIfCancelled();
        if (getAgentActivityCount() > activityBeforeClick) sawQueryActivity = true;
        const allDocs = collectEbelgeDocsDeep();
        if (!allDocs.includes(document)) allDocs.unshift(document);
        let foundDoneSignal = false;
        let progressLine = '';
        for (const d of allDocs) {
          try {
            const txt = d.body ? d.body.textContent : '';
            // KESİN COMPLETION SİNYALİ — Luca'nın gerçek bitiş mesajları:
            //  1. "Fatura kaydetme işlemi sona erdi" — tüm 333 belge kaydedildi (asıl completion)
            //  2. "Belirtilen tarih aralığında fatura bulunamadı" — GİB'den boş sonuç
            //  3. "fatura bulunamadı" / "belge bulunamadı" — generic boş sonuç
            // BUNLAR DIŞINDA HİÇBİR ŞEY DONE OLARAK SAYILMASIN (yanlış erken trigger önle)
            // SADECE BU İKİ MESAJI DONE OLARAK KABUL ET — saves bittiğinin garantisi:
            //  1. "Fatura kaydetme işlemi sona erdi" — tüm fatura_kaydet stream bitti
            //  2. "Belirtilen tarih aralığında fatura bulunamadı" — boş sonuç
            // ⚠ "fatura indirme işlemi tamamlandı" / "işlem tamamlandı" bunlar GİB query
            // bitince fire ediyor ama save'ler hala devam ediyor — KULLANMA.
            if (/fatura\s+kaydetme\s+i[şs]lemi\s+sona\s+erdi/i.test(txt)) {
              foundDoneSignal = true;
              break;
            }
            if (/belirtilen\s+tarih\s+aral[ıi][gğ][ıi]nda\s+fatura\s+bulunamad[ıi]/i.test(txt)) {
              foundDoneSignal = true;
              break;
            }
            // Hem "X adet belge kaydı bulundu" hem "X adet fatura bulundu" — saves'ten ÖNCE,
            // ama tek başına done olarak kabul ETMİYORUZ (saves devam edebilir).
            // Sadece progress için yakala:
            const sayim = txt && txt.match(/(\d+)\s+adet\s+(?:belge\s+kaydı|fatura)\s+bulundu/i);
            if (sayim) progressLine = `${sayim[1]} adet bulundu`;
            // Save progress: [N/M] formatı — sadece ilerleme log'u için
            const m = txt && txt.match(/\[(\d+)\/(\d+)\][^\[]{0,80}/);
            if (m) {
              progressLine = `kayıt ${m[1]}/${m[2]}`;
            }
          } catch {}
        }
        if (foundDoneSignal) { queryDone = true; break; }
        // Her 5sn'de bir progress log'la (kullanıcı boş ekran görmesin)
        const now = Date.now();
        if (progressLine && progressLine !== lastProgress && now - lastProgressLogTs > 5000) {
          await log(`📊 GİB sorgu ilerleme: ${progressLine}`);
          lastProgress = progressLine;
          lastProgressLogTs = now;
        }
        await sleep(POLL_INTERVAL);
      }
      if (!queryDone) {
        const activityDelta = getAgentActivityCount() - activityBeforeClick;
        if (!sawQueryActivity && activityDelta <= 0) {
          const actionHints = describeEbelgeActionCandidates(datePair.doc, 35);
          await log(`✗ E-belge sorgusu baslamadi: "${triggerMethod || 'unknown'}" tetiklendi ama hic GIB/e-belge XHR olusmadi.`);
          if (actionHints) await log(`🔎 E-belge aksiyon adaylari: ${actionHints}`);
          throw new Error(`${etiket} sorgusu baslatilamadi; Belgeleri Getir icin dogru Luca ID/fonksiyon bulunmali`);
        }
        await log(`⚠ GİB sorgu 5 dk içinde tamamlanmadı (son ilerleme: ${lastProgress || '?'}, ${activityDelta} XHR). Mevcut sonuçlarla devam ediliyor…`);
      } else {
        const elapsed = Math.round((Date.now() - pollStart) / 1000);
        await log(`✓ GİB sorgu tamamlandı (${elapsed}sn)${lastProgress ? ` · son: ${lastProgress}` : ''}`);
      }
      // KRİTİK: done mesajı gelse bile son fatura_kaydet'ler arka planda devam edebilir.
      // Sonraki sorguya/indirmeye geçmeden ÖNCE 5sn XHR sessizliği bekle.
      await waitForActivitySilence(`${etiket} fatura_kaydet sessizlik`, 5000, 90000);
      // Sonuç tablosuna geçilmesi için kısa bir sleep
      await sleep(500);

      // Tüm frame'lerde "Kapat" butonunu bul ve tıkla (İşlem Takip popup)
      const findAndClick = (label) => {
        const allDocs = collectEbelgeDocsDeep();
        if (!allDocs.includes(document)) allDocs.unshift(document);
        for (const d of allDocs) {
          try {
            for (const btn of d.querySelectorAll('button, input[type=button], input[type=submit]')) {
              const t = ((btn.value || btn.innerText) || '').trim().toLocaleLowerCase('tr-TR');
              if (t === label.toLocaleLowerCase('tr-TR') && (btn.offsetParent !== null || btn.tagName === 'INPUT')) {
                btn.click();
                return btn;
              }
            }
          } catch {}
        }
        return null;
      };
      const kapatBtn = findAndClick('Kapat');
      if (kapatBtn) {
        await log(`✓ İşlem Takip popup'ı "Kapat" ile kapatıldı`);
      } else {
        await log(`⚠ Kapat butonu bulunamadı, popup açık kalmış olabilir`);
      }
      // Popup'ın gerçekten kapanmasını bekle (max 5sn) — sorgu2 üst üste binmesin
      const popupCloseStart = Date.now();
      while (Date.now() - popupCloseStart < 5000) {
        let popupAcik = false;
        const allDocsCheck = collectEbelgeDocsDeep();
        if (!allDocsCheck.includes(document)) allDocsCheck.unshift(document);
        for (const d of allDocsCheck) {
          try {
            const txt = d.body ? d.body.textContent : '';
            if (/i[şs]lem\s+takip/i.test(txt) && !/i[şs]lem\s+tamamland[ıi]/i.test(txt.slice(-500))) {
              // İşlem Takip popup hala açık görünüyor
              popupAcik = true;
              break;
            }
          } catch {}
        }
        if (!popupAcik) break;
        await sleep(300);
      }
      await sleep(1500);
      await log(`📋 ${etiket} tamamlandı`);

      // Toplam fatura sayısını tespit et — "352 adet fatura bulundu. (Sayfa No: 1)"
      try {
        let bulunanText = '';
        const allDocs = collectEbelgeDocsDeep();
        if (!allDocs.includes(document)) allDocs.unshift(document);
        for (const d of allDocs) {
          try {
            const txt = d.body ? d.body.textContent : '';
            const m = txt && txt.match(/(\d+)\s+adet\s+fatura\s+bulundu[^.]*Sayfa\s+No:\s*(\d+)/i);
            if (m) { bulunanText = `${m[1]} fatura, sayfa ${m[2]}`; break; }
          } catch {}
        }
        const tabloDakiFatura = fdoc.querySelectorAll('.sec').length;
        if (bulunanText) {
          const toplamMatch = bulunanText.match(/^(\d+)/);
          const toplam = toplamMatch ? parseInt(toplamMatch[1], 10) : 0;
          if (toplam > tabloDakiFatura) {
            await log(`⚠ DİKKAT: Luca'da TOPLAM ${toplam} fatura var ama tabloda sadece ${tabloDakiFatura} görünüyor (pagination). Bu sürümde sadece 1. sayfa indiriliyor — kalan ${toplam - tabloDakiFatura} fatura için pagination iteration desteği gelecek.`);
          } else {
            await log(`✓ ${bulunanText} (tümü tabloda)`);
          }
        }
      } catch (e) {
        // Detection hatası — sessiz geç
      }
    }

    await throwIfCancelled();
    await birSorgu(sorgu1Bas, sorgu1Bit, 'Sorgu 1 (ay)');
    if (sorgu2Gerekli) {
      await throwIfCancelled();
      await birSorgu(sorgu2Bas, sorgu2Bit, 'Sorgu 2 (sonraki ay başı→bugün)');
    }
    await throwIfCancelled();

    // Tümünü Seç
    const tumBtn = fdoc.getElementById('tum_belgeyi_sec_btn');
    if (tumBtn) {
      tumBtn.click();
      await log('✓ Tümünü Seç tıklandı');
      await sleep(500);
    } else {
      await log('⚠ tum_belgeyi_sec_btn bulunamadı (belki sayfada başka isimle)');
    }

    // ─── NO-FATURA TESPİTİ ───
    // Hiç fatura yoksa "Tümünü Seç" 0 checkbox işaretler, indirme akışı 60sn boşa bekler.
    // Önceden tespit edip temiz mesajla çık.
    try {
      const secimSayisi = fdoc.querySelectorAll('.sec:checked').length;
      const tablodaToplam = fdoc.querySelectorAll('.sec').length;
      if (secimSayisi === 0 && tablodaToplam === 0) {
        await log(`ℹ Bu dönem için fatura bulunamadı. İndirme akışı atlandı.`);
        // Special signal — caller bunu yakalayıp temiz "fatura yok" mesajı göstersin
        const noFaturaErr = new Error('NO_FATURA: Bu dönem için kayıtlı fatura yok');
        (noFaturaErr).isNoFatura = true;
        throw noFaturaErr;
      } else if (secimSayisi === 0 && tablodaToplam > 0) {
        await log(`⚠ Tablodan ${tablodaToplam} fatura tespit edildi ama Tümünü Seç çalışmadı (0 checkbox checked). Manuel seçim deneniyor…`);
        // Bütün .sec'leri elle işaretle
        for (const cb of fdoc.querySelectorAll('.sec')) { try { (cb).click(); } catch {} }
        await sleep(400);
        const yeni = fdoc.querySelectorAll('.sec:checked').length;
        if (yeni === 0) {
          throw new Error('NO_FATURA: Faturalar listede ama seçim yapılamadı');
        }
        await log(`✓ Manuel seçim sonucu: ${yeni} fatura işaretli`);
      } else {
        await log(`✓ ${secimSayisi} fatura işaretli (toplam ${tablodaToplam})`);
      }
    } catch (e) {
      if ((e).isNoFatura) throw e; // re-throw — caller temiz mesaj gösterecek
      await log(`⚠ No-fatura kontrolü hatası (devam): ${(e)?.message || e}`);
    }

    // ─── gonder() WRAPPER ───
    // Luca popup butonu tıklanınca fwin.gonder('zip') çağırıyor. Wrap ederek
    // hem source code'unu görelim hem de URL'i kendimiz fetch'leyelim.
    // ─── goster() WRAPPER ─── (gonder'dan SONRA çağrılıyor, asıl download burada olabilir)
    if (typeof fwin.goster === 'function' && !fwin.__morenGosterHooked) {
      fwin.__morenGosterHooked = true;
      const origGoster = fwin.goster;
      try {
        const src = origGoster.toString();
        try { console.log('[Moren] FULL goster() source:', src); } catch (e) {}
        await log(`🔍 goster() source (uzunluk=${src.length}, FULL Console'da): ${src.slice(0, 200).replace(/\s+/g, ' ')}...`);
      } catch (e) {}
      fwin.goster = function(...args) {
        try { log(`🪝 goster(${args.map(a => JSON.stringify(a)).join(',').slice(0, 100)}) çağrıldı`).catch(() => {}); } catch (e) {}
        return origGoster.apply(this, args);
      };
    }

    // ─── Luca.downloadPost HOOK ───
    // goster() x="save" durumunda Luca.downloadPost(url, data, "_blank") çağırıyor
    // Bu form submit ile yeni tab açıp native browser download tetikliyor
    try {
      const winsToHook = [fwin, window, window.top].filter(Boolean);
      let hookedAt = [];
      for (const w of winsToHook) {
        if (w.Luca && typeof w.Luca.downloadPost === 'function' && !w.Luca.__morenDownloadPostHooked) {
          w.Luca.__morenDownloadPostHooked = true;
          const origDownloadPost = w.Luca.downloadPost;
          hookedAt.push(w === fwin ? 'fwin' : (w === window ? 'window' : 'top'));
          w.Luca.downloadPost = function(url, data, target) {
            try {
              const dataKeys = data && typeof data === 'object' ? Object.keys(data).join(',') : typeof data;
              log(`🎯 Luca.downloadPost yakalandı: url=${String(url).slice(0,100)}, dataKeys=[${dataKeys}], target=${target}`).catch(() => {});
              zipNetworkInFlight = true;
              (async () => {
                try {
                  // FORM submit gibi davran — multipart/form-data ya da URL-encoded
                  // Önce URL-encoded dene
                  let body;
                  if (typeof data === 'string') {
                    body = data;
                  } else if (data instanceof FormData) {
                    body = data;
                  } else if (data && typeof data === 'object') {
                    const params = new URLSearchParams();
                    for (const k of Object.keys(data)) {
                      const v = data[k];
                      params.append(k, v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
                    }
                    body = params.toString();
                  } else {
                    body = String(data || '');
                  }
                  const init = {
                    method: 'POST',
                    credentials: 'include',
                    body: body,
                    headers: typeof body === 'string' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
                  };
                  const res = await fetch(url, init);
                  const ct = (res.headers.get('content-type') || '').toLowerCase();
                  const cd = (res.headers.get('content-disposition') || '').toLowerCase();
                  const cl = res.headers.get('content-length') || '';
                  const blob = await res.blob();
                  log(`📦 downloadPost response: status=${res.status}, ct=${ct.slice(0,40)}, cd=${cd.slice(0,80)}, size=${blob ? Math.round(blob.size/1024)+'KB' : '?'}, content-length=${cl}`).catch(() => {});

                  // ZIP/binary olduğunu doğrula
                  const isZip = ct.includes('zip') || ct.includes('octet-stream') || ct.includes('application/x-zip') ||
                                cd.includes('.zip') || cd.includes('attachment') || cd.includes('filename') ||
                                (blob && blob.size > 1000 && !ct.startsWith('text/') && !ct.startsWith('application/json') && !ct.startsWith('application/javascript'));

                  if (isZip && await acceptZipBlob(blob, 'Luca.downloadPost hijack', ct, cd)) {
                  } else if (!isZip) {
                    // Beklenmeyen response — Luca'nın orijinal flow'unu da dene (native download)
                    log(`⚠ downloadPost response binary değil (ct=${ct.slice(0,30)}), orijinal Luca.downloadPost da çağrılacak`).catch(() => {});
                    // İlk 500 char text önizleme (debug için)
                    try {
                      const text = await blob.text();
                      log(`🔍 response text önizleme: ${text.slice(0, 500)}`).catch(() => {});
                    } catch (e) {}
                    // Native flow'u da tetikle ki dosya gelsin (zorunlu fallback)
                    try { origDownloadPost.call(w.Luca, url, data, target); } catch (e) {}
                  }
                } catch (e) {
                  log(`⚠ Luca.downloadPost hijack fetch hatası: ${e?.message || e}`).catch(() => {});
                  // Hata durumunda native flow'u tetikle (kullanıcı tamamen kayıp olmasın)
                  try { origDownloadPost.call(w.Luca, url, data, target); } catch (e) {}
                }
              })();
              return;
            } catch (e) {
              return origDownloadPost.call(this, url, data, target);
            }
          };
        }
      }
      if (hookedAt.length > 0) {
        await log(`🪝 Luca.downloadPost wrap edildi (${hookedAt.join(', ')})`);
      } else {
        await log(`⚠ Luca.downloadPost hiçbir frame'de bulunamadı, hook kurulamadı`);
      }
    } catch (e) {}

    if (typeof fwin.gonder === 'function' && !fwin.__morenGonderHooked) {
      fwin.__morenGonderHooked = true;
      const origGonder = fwin.gonder;
      try {
        const src = origGonder.toString();
        try { console.log('[Moren] FULL gonder() source:', src); } catch (e) {}
        await log(`🔍 gonder() source (uzunluk=${src.length}, FULL Console'da): ${src.slice(0, 200).replace(/\s+/g, ' ')}...`);
      } catch (e) {}
      fwin.gonder = function(...args) {
        try {
          const arg0 = String(args[0] || '');
          log(`🪝 gonder('${arg0}') çağrıldı`).catch(() => {});
          // 'zip' veya 'indir' içeriyorsa: çağırmadan ÖNCE document'i ve formları snapshot al
          if (arg0 === 'zip' || arg0.includes('indir') || arg0.includes('download')) {
            // Form'u bul ve URL'i çıkar
            try {
              const allDocs = [];
              const dive = (root) => {
                try {
                  allDocs.push(root);
                  for (const fr of root.querySelectorAll('frame, iframe')) {
                    if (fr.contentDocument) dive(fr.contentDocument);
                  }
                } catch {}
              };
              dive(document);
              for (const d of allDocs) {
                for (const f of d.querySelectorAll('form')) {
                  const action = String(f.action || '').toLowerCase();
                  if (action.includes('zip') || action.includes('indir') || action.includes('download')) {
                    log(`📋 Form bulundu: action=${f.action}, method=${f.method}, fields=${f.elements.length}`).catch(() => {});
                    // Bu form'u kendimiz POST edelim
                    const fd = new FormData(f);
                    const method = (f.method || 'POST').toUpperCase();
                    (async () => {
                      try {
                        let res;
                        if (method === 'GET') {
                          const params = new URLSearchParams();
                          for (const entry of fd.entries()) params.append(entry[0], entry[1].toString());
                          res = await fetch(f.action + (f.action.includes('?') ? '&' : '?') + params.toString(), { credentials: 'include' });
                        } else {
                          res = await fetch(f.action, { method: method, body: fd, credentials: 'include' });
                        }
                        const blob = await res.blob();
                        await acceptZipBlob(blob, 'gonder form fetch', res.headers.get('content-type') || '', res.headers.get('content-disposition') || '');
                      } catch (e) {
                        log(`⚠ gonder form fetch hatası: ${e?.message || e}`).catch(() => {});
                      }
                    })();
                    break;
                  }
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
        return origGonder.apply(this, args);
      };
    }

    // Seçilenleri İndir (ALT TOOLBAR) → ZIP popup açılır
    if (await callEbelgeGonderEverywhere('zip-window', 'Alt toolbar Seçilenleri İndir')) {
      await log('📦 Alt toolbar "Seçilenleri İndir" tetiklendi → popup açılıyor');
    } else {
      throw new Error('zip-window aksiyonu bulunamadı');
    }

    // Popup açılma animasyonunu bekle
    await sleep(1500);

    // location.href / location.assign / location.replace hook (Luca direct nav ile download yapıyorsa)
    try {
      for (const w of [window, fwin, window.top]) {
        if (!w || w.__morenLocHooked) continue;
        try {
          w.__morenLocHooked = true;
          const origAssign = w.location.assign && w.location.assign.bind(w.location);
          const origReplace = w.location.replace && w.location.replace.bind(w.location);
          if (origAssign) {
            w.location.assign = function(url) {
              try {
                const u = String(url || '').toLowerCase();
                if (u.includes('zip') || u.includes('indir') || u.includes('download')) {
                  zipNetworkInFlight = true;
                  log(`🪝 location.assign(${String(url).slice(0,80)})`).catch(() => {});
                  (async () => {
                    try {
                      const r = await fetch(url, { credentials: 'include' });
                      const blob = await r.blob();
                      await acceptZipBlob(blob, 'location.assign hijack', r.headers.get('content-type') || '', r.headers.get('content-disposition') || '');
                    } catch (e) {}
                  })();
                  return; // navigate etmeyelim
                }
              } catch (e) {}
              return origAssign(url);
            };
          }
          if (origReplace) {
            w.location.replace = function(url) {
              try {
                const u = String(url || '').toLowerCase();
                if (u.includes('zip') || u.includes('indir') || u.includes('download')) {
                  zipNetworkInFlight = true;
                  log(`🪝 location.replace(${String(url).slice(0,80)})`).catch(() => {});
                  (async () => {
                    try {
                      const r = await fetch(url, { credentials: 'include' });
                      const blob = await r.blob();
                      await acceptZipBlob(blob, 'location.replace hijack', r.headers.get('content-type') || '', r.headers.get('content-disposition') || '');
                    } catch (e) {}
                  })();
                  return;
                }
              } catch (e) {}
              return origReplace(url);
            };
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Tüm doc'ları topla (frame'ler dahil)
    const collectAllDocsForPopup = () => {
      const docs = [document];
      const dive = (root) => {
        try {
          for (const fr of root.querySelectorAll('frame, iframe')) {
            if (fr.contentDocument) {
              docs.push(fr.contentDocument);
              dive(fr.contentDocument);
            }
          }
        } catch {}
      };
      dive(document);
      return docs;
    };

    // Popup container'ı bul (zip-window ya da BURAYA + İNDİR içeren container)
    const findPopupContainer = () => {
      for (const d of collectAllDocsForPopup()) {
        try {
          for (const sel of ['#zip-window', '.zip-window', '#popup-zip',
                             'div[id*="zip"]', 'div[id*="indir"]', 'div[id*="zipWin"]']) {
            const c = d.querySelector(sel);
            if (c && c.offsetParent !== null) {
              const ct = (c.textContent || '').toLocaleUpperCase('tr-TR');
              if (ct.includes('BURAYA') && (ct.includes('İNDİR') || ct.includes('INDIR'))) {
                return { container: c, doc: d };
              }
            }
          }
          for (const c of d.querySelectorAll('div, section, article, form')) {
            if (c.offsetParent === null) continue;
            const ct = (c.textContent || '').toLocaleUpperCase('tr-TR');
            if (ct.includes('BURAYA') &&
                (ct.includes('TÜM FATURALARI') || ct.includes('TUM FATURALARI')) &&
                (ct.length < 4000)) {
              return { container: c, doc: d };
            }
          }
        } catch {}
      }
      return null;
    };

    // Popup'ı bekle
    let popupInfo = null;
    const popupSearchStart = Date.now();
    while (Date.now() - popupSearchStart < 5000 && !popupInfo) {
      popupInfo = findPopupContainer();
      if (!popupInfo) await sleep(300);
    }

    if (!popupInfo) {
      await log('⚠ Popup container bulunamadı (5sn) — buton aranacak ama emin değil');
    }

    // Popup içindeki "Seçilenleri İndir" butonunu bul (popup container içinde, kesin)
    const findPopupDownloadButton = () => {
      if (popupInfo) {
        for (const b of popupInfo.container.querySelectorAll('button, input[type=button], input[type=submit]')) {
          const t = ((b.textContent || b.value || '').trim()).toLocaleLowerCase('tr-TR');
          if ((t === 'seçilenleri indir' || t === 'secilenleri indir')
              && b.offsetParent !== null) {
            return b;
          }
        }
      }
      // Fallback: birden fazla "Seçilenleri İndir" varsa toolbar'a göre üstte olanı (popup) seç
      for (const d of collectAllDocsForPopup()) {
        const matches = [];
        for (const b of d.querySelectorAll('button, input[type=button], input[type=submit]')) {
          const t = ((b.textContent || b.value || '').trim()).toLocaleLowerCase('tr-TR');
          if (t !== 'seçilenleri indir' && t !== 'secilenleri indir') continue;
          if (b.offsetParent === null) continue;
          const r = b.getBoundingClientRect();
          matches.push({ b, top: r.top });
        }
        if (matches.length >= 2) {
          matches.sort((a, b) => a.top - b.top);
          return matches[0].b;
        } else if (matches.length === 1) {
          return matches[0].b;
        }
      }
      return null;
    };

    // POPUP'I X İLE KAPAT
    const closePopupWithX = () => {
      if (!popupInfo) return false;
      // Popup'ın kendi container'ında ve onun yakınında "X" / "Kapat" / kapat ikonu ara
      const candidates = [];
      // 1) span/button/a content === "x" ya da "×" ya da "✕" ya da içinde close class
      for (const el of popupInfo.container.querySelectorAll('button, a, span, div, input[type=button]')) {
        if (el.offsetParent === null && el.tagName !== 'A') continue;
        const t = ((el.textContent || el.value || '').trim());
        const cls = String(el.className || '').toLowerCase();
        const id = String(el.id || '').toLowerCase();
        const title = String(el.title || el.getAttribute('aria-label') || '').toLowerCase();
        const isCloseText = t === 'X' || t === 'x' || t === '×' || t === '✕' || t === '✖';
        const isCloseAttr = cls.includes('close') || cls.includes('kapat') ||
                            id.includes('close') || id.includes('kapat') ||
                            title.includes('close') || title.includes('kapat');
        const isCloseLabel = ((el.value || '').trim().toLocaleLowerCase('tr-TR') === 'kapat') ||
                             (t.toLocaleLowerCase('tr-TR') === 'kapat');
        if (isCloseText || isCloseAttr || isCloseLabel) {
          candidates.push(el);
        }
      }
      // En sağ üstte olanı seç (popup'ın X'i genelde sağ-üstte)
      if (candidates.length === 0) return false;
      let best = candidates[0];
      let bestScore = -Infinity;
      for (const c of candidates) {
        try {
          const r = c.getBoundingClientRect();
          // Sağ-üst köşe = max(left) + min(top), score = r.left - r.top * 2
          const score = r.left - r.top * 2;
          if (score > bestScore) { bestScore = score; best = c; }
        } catch {}
      }
      try { best.click(); return true; } catch {}
      return false;
    };

    // ─── TEK TIK ───
    let popupBtn = null;
    const findStart = Date.now();
    while (Date.now() - findStart < 4000 && !popupBtn) {
      popupBtn = findPopupDownloadButton();
      if (!popupBtn) await sleep(300);
    }

    if (popupBtn) {
      // SADE: tek .click() çağrısı — Luca'nın kendi handler'ları aşırı tetiklenmesin
      try { popupBtn.click(); } catch (e) {
        await log(`⚠ btn.click() hatası, native event dispatch ile dene: ${e?.message || e}`);
        try {
          popupBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: popupBtn.ownerDocument.defaultView }));
        } catch {}
      }
      await log('✓ Popup "Seçilenleri İndir" 1 kez tıklandı');
    } else {
      await log('⚠ Popup içindeki "Seçilenleri İndir" bulunamadı');
    }

    // ADAPTIVE TIMEOUT:
    // - max 5 dk (büyük datasetlerde GİB sorgu uzar)
    // - ama 30sn boyunca AKTIVITE OLMAZSA çık (gereksiz beklemenin önüne geç)
    // Aktivite tespiti: gib530/fatura_kaydet/gib_efatura URL'lerinde Performance API resource sayısı artıyor mu?
    const zipWaitStart = Date.now();
    const ZIP_TIMEOUT_MS = 10 * 60 * 1000;  // 10dk absolute (büyük dosyalar için)
    const IDLE_BASE_MS = 90 * 1000;         // 90sn baseline (server ZIP paketleme süresi)
    // Adaptif idle: yapılan iş arttıkça beklemek mantıklı (büyük ZIP daha uzun paketlenir).
    // 100 XHR'a kadar 90sn, sonrası lineer artar, max 240sn (4dk).
    const computeIdleTimeout = (xhrCount) => Math.min(
      240 * 1000,
      IDLE_BASE_MS + Math.max(0, xhrCount - 100) * 800
    );
    // ZIP wait için activity tracker — XHR/fetch hook'ları ile gerçek zamanlı sayım.
    // Tüm frame'lere recursive hook kur, her gib530/fatura_kaydet çağrısında counter++.
    if (!window.__morenLucaActivity) window.__morenLucaActivity = { count: 0, lastTs: 0 };
    const installActivityHooks = (w, depth = 0) => {
      if (depth > 6 || !w) return;
      try {
        if (w.__morenActHooked) return;
        w.__morenActHooked = true;
        const origOpen = w.XMLHttpRequest && w.XMLHttpRequest.prototype.open;
        if (origOpen) {
          w.XMLHttpRequest.prototype.open = function(m, u) {
            if (u && /gib530|fatura_kaydet|gib_efatura|gib_ebelge|topluFatura/i.test(String(u))) {
              window.__morenLucaActivity.count++;
              window.__morenLucaActivity.lastTs = Date.now();
            }
            return origOpen.apply(this, arguments);
          };
        }
        const origFetch = w.fetch;
        if (origFetch) {
          w.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url && /gib530|fatura_kaydet|gib_efatura|gib_ebelge|topluFatura/i.test(url)) {
              window.__morenLucaActivity.count++;
              window.__morenLucaActivity.lastTs = Date.now();
            }
            return origFetch.apply(this, arguments);
          };
        }
        // Recursive: alt frame'ler
        const frames = w.document && w.document.querySelectorAll('frame, iframe');
        if (frames) {
          for (const f of frames) {
            try { if (f.contentWindow) installActivityHooks(f.contentWindow, depth + 1); } catch {}
          }
        }
      } catch {}
    };
    installActivityHooks(window);
    // Yeni eklenmiş frame'ler için periyodik olarak da kur
    const activityHookInterval = setInterval(() => installActivityHooks(window), 2000);
    const getActivityCount = () => window.__morenLucaActivity.count;
    const getLastActivityTs = () => window.__morenLucaActivity.lastTs;
    // Başlangıçta lastTs'i şimdi yap ki ilk anda 30sn idle gibi görünmesin
    // ⚠ ÖNEMLİ: ZIP wait loop başlamadan ÖNCE lastTs'i ŞİMDİ olarak resetle.
    // Aksi takdirde önceki Sorgu/birSorgu sırasındaki XHR'lerin lastTs'i kalıyor,
    // tıklama anında "90sn idle" yanlışlıkla fire edip ZIP gelmeden vazgeçiyordu.
    window.__morenLucaActivity.lastTs = Date.now();
    let popupClosed = false;
    while (Date.now() - zipWaitStart < ZIP_TIMEOUT_MS) {
      if (yakalanmisZip) break;
      // Aktivite kontrolü — XHR hook'ları lastTs'i bump ediyor
      const lastTs = getLastActivityTs() || zipWaitStart;
      const idle = Date.now() - lastTs;
      const xhrCount = getActivityCount();
      const idleLimit = computeIdleTimeout(xhrCount);
      if (idle > idleLimit) {
        await log(`⚠ ${Math.round(idleLimit/1000)}sn aktivite yok (toplam ${xhrCount} XHR, ZIP paketleme bitmemiş olabilir), bekleme sonlandırılıyor`);
        break;
      }
      // ZIP geldikten sonra (ya da 8sn sonra) popup'ı X ile kapat
      if (!popupClosed && (yakalanmisZip || Date.now() - zipWaitStart > 8000)) {
        if (closePopupWithX()) {
          await log('✓ Popup X ile kapatıldı');
          popupClosed = true;
        }
      }
      await sleep(400);
    }
    try { clearInterval(activityHookInterval); } catch {}
    try { clearInterval(agentActHookInterval); } catch {}

    // ZIP geldiyse ama popup hala açıksa kapat
    if (yakalanmisZip && !popupClosed) {
      if (closePopupWithX()) {
        await log('✓ Popup X ile kapatıldı (ZIP yakalandıktan sonra)');
      }
    }

    // Hook'ları geri al (tüm frame'lerde)
    for (const h of hookedFrames) {
      try {
        if (h.origFetch) h.win.fetch = h.origFetch;
        if (h.origXHROpen) h.win.XMLHttpRequest.prototype.open = h.origXHROpen;
        if (h.origXHRSend) h.win.XMLHttpRequest.prototype.send = h.origXHRSend;
        if (h.origWindowOpen) h.win.open = h.origWindowOpen;
        if (h.origCreateElement) h.win.document.createElement = h.origCreateElement;
        if (h.origFormSubmit) h.win.HTMLFormElement.prototype.submit = h.origFormSubmit;
      } catch {}
    }

    // Bridge listener'larını çıkar + expecting=false sinyali
    try { window.removeEventListener('message', onBridgeMessage); } catch (e) {}
    try { window.removeEventListener('moren-luca-file', onLucaFile); } catch (e) {}
    postExpectingZip(false);

    if (!yakalanmisZip) {
      throw new Error(`ZIP ${Math.round(ZIP_TIMEOUT_MS/1000)}sn içinde yakalanamadı — Luca download mekanizması interceptor'ları bypass ediyor olabilir`);
    }
    return yakalanmisZip;
  }


  // ─────────────────────────────────────────────────────────────
  // ORTAK YARDIMCILAR — KDV / İşletme akışları için
  // ─────────────────────────────────────────────────────────────

  /**
   * Sağ menüde verilen text'i içeren öğelere tıkla. nthOccurrence: 1 = ilk match, 2 = ikinci.
   * "Defteri Kebir" iki kez var (Nokta Vuruşlu + Tüm Yazıcılar) — Tüm Yazıcılar = 2. occurrence.
   */
  async function clickLucaRightMenu(text, log, opts = {}) {
    const { nth = 1, maxMs = 8000, afterClickReady = null, settleMs = 700, allowCache = true, expectedCode = '' } = opts;
    const cacheLabel = nth > 1 ? `${text}#${nth}` : text;
    const cachedRows = cacheVisibleLucaMenuIds();
    if (cachedRows > 0) await log(`🧠 Luca menü ID cache güncellendi (${cachedRows} satır)`);
    if (allowCache && await openCachedLucaMenu(cacheLabel, log, settleMs, { expectedCode })) {
      if (typeof afterClickReady !== 'function') return;
      const ready = await waitUntil(() => {
        try { return !!afterClickReady(); } catch { return false; }
      }, Math.max(3000, settleMs * 6), 250);
      if (ready) {
        await log(`✓ "${text}" ID ile açıldı`);
        return;
      }
      await log(`ℹ "${text}" ID ile denendi ama hedef ekran doğrulanmadı; metin keşfine düşülecek`);
    }
    await log(`🔍 Sağ menüde "${text}" aranıyor (${nth}. occurrence)...`);
    const found = await waitUntil(() => {
      const candidates = ['frm5', 'frm2', 'frm3', 'frm6', 'frm7', 'frm1', 'frm4'];
      const matches = [];
      const target = normalizeLucaMenuText(text);
      for (const fname of candidates) {
        const f = getLucaFrame(fname);
        if (!f || !f.contentDocument) continue;
        for (const el of f.contentDocument.querySelectorAll('*')) {
          const normalized = normalizeLucaMenuText(el.textContent || '');
          if (normalized === target && isLikelyLucaMenuElement(el, target)) {
            matches.push({ el: getClickableLucaMenuElement(el), frame: f, frameName: fname });
          }
        }
      }
      return matches.length >= nth ? matches[nth - 1] : null;
    }, maxMs, 250);

    if (!found) {
      throw new Error(`Sağ menüde "${text}" (${nth}. occurrence) bulunamadı — Fiş Listesi sayfası açık mı?`);
    }
    await log(`🖱 "${text}" tıklanıyor (${found.frameName} → ${describeLucaMenuElement(found.el)})`);
    const cached = cacheLucaMenuHit(cacheLabel, found);
    if (
      cached?.code &&
      (!expectedCode || String(cached.code) === String(expectedCode)) &&
      await callLucaMenuCode(cacheLabel, cached.code, log, settleMs)
    ) {
      if (typeof afterClickReady !== 'function') return;
      try {
        if (afterClickReady()) {
          await log(`✓ "${text}" sonrası hedef ekran açıldı (ID cache)`);
          return;
        }
      } catch {}
    }
    const view = found.frame.contentWindow || found.frame;

    const activationTargets = [];
    const pushTarget = (el) => {
      if (el && !activationTargets.includes(el)) activationTargets.push(el);
    };
    pushTarget(found.el);
    try {
      for (const child of found.el.querySelectorAll?.('a[href],a[onclick],[onclick],[href],[role="button"],button,input[type="button"],input[type="submit"]') || []) {
        pushTarget(child);
      }
    } catch {}
    let cur = found.el.parentElement;
    for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
      pushTarget(cur);
    }

    for (const targetEl of activationTargets) {
      try {
        fullActivate(targetEl, view);
      } catch {}
      await sleep(settleMs);
      if (typeof afterClickReady === 'function') {
        try {
          if (afterClickReady()) {
            await log(`✓ "${text}" sonrası hedef ekran açıldı (${describeLucaMenuElement(targetEl)})`);
            return;
          }
        } catch {}
      }
    }
    await sleep(1500);
  }

  /**
   * frm3'te (veya herhangi bir frame'de) form aranır — formNamePattern regex ile
   * eşleşen ilk form'u döndürür. İlk koşumda form bulunamazsa tüm form/input
   * listesini log'a düşürür → user görsün, biz fix edelim.
   */
  function findLucaAnyFormNow(formNamePattern) {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        for (const fm of f.contentDocument.querySelectorAll('form')) {
          if (formNamePattern.test(fm.name || '') ||
              formNamePattern.test(fm.id || '') ||
              formNamePattern.test(fm.action || '')) {
            return fm;
          }
        }
      } catch {}
    }
    return null;
  }

  function isLucaGelirGiderRaporForm(form) {
    if (!form) return false;
    const identity = `${form.name || ''} ${form.id || ''} ${form.action || ''}`;
    if (/raporGelirGider|gelir[_-]?gider[_-]?listesi|gelirGider/i.test(identity)) return true;
    const hasDateRange =
      !!form.querySelector('#TARIH_ILK, input[name="TARIH_ILK"], input[name="tarih_bas"], input[name="tarih_ilk"]') &&
      !!form.querySelector('#TARIH_SON, input[name="TARIH_SON"], input[name="tarih_bit"], input[name="tarih_son"]');
    const hasReportFormat =
      !!form.querySelector('#RAPOR_DEGISTIR, #REPORT_TYPE, #report_type, select[name="RAPOR_DEGISTIR"], select[name="REPORT_TYPE"], select[name="report_type"]');
    const hasIhoFlags =
      !!form.querySelector('#GELIR1, input[name="GELIR1"]') ||
      !!form.querySelector('#GIDER1, input[name="GIDER1"]');
    return hasDateRange && (hasReportFormat || hasIhoFlags);
  }

  function collectLucaFormsBrief() {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };
    const all = [];
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        for (const fm of f.contentDocument.querySelectorAll('form')) {
          const inputs = [...fm.querySelectorAll('input')].slice(0, 8).map((i) => i.name || i.id || i.type || '?').join(',');
          const selects = [...fm.querySelectorAll('select')].slice(0, 6).map((s) => s.name || s.id || '?').join(',');
          const buttons = [...fm.querySelectorAll('button, input[type=button], input[type=submit]')].slice(0, 4).map((b) => (b.textContent || b.value || b.name || b.id || '?').trim()).join(',');
          all.push(`name="${fm.name || '?'}" action="${(fm.action || '?').split('/').pop().slice(0, 45)}" inputs=[${inputs}] selects=[${selects}] buttons=[${buttons}]`);
        }
      } catch {}
    }
    return all;
  }

  function findLucaGelirGiderRaporFormNow() {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        for (const fm of f.contentDocument.querySelectorAll('form')) {
          if (isLucaGelirGiderRaporForm(fm)) return fm;
        }
      } catch {}
    }
    return null;
  }

  async function waitForLucaGelirGiderRaporForm(log, maxMs = 60000) {
    await log('⏳ İşletme Gelir/Gider rapor formu yüklenmesi bekleniyor…');
    const form = await waitUntil(() => findLucaGelirGiderRaporFormNow(), maxMs, 250);
    if (!form) {
      throw new Error(`İşletme Gelir/Gider rapor formu bulunamadı. Mevcut form'lar: ${collectLucaFormsBrief().join(' | ') || '(yok)'}`);
    }
    await log(`✓ İşletme Gelir/Gider rapor formu yüklendi: name="${form.name || '?'}" action="${(form.action || '?').split('/').pop().slice(0, 50)}"`);
    return form;
  }

  async function waitForLucaAnyForm(log, formNamePattern, maxMs = 15000, label = 'form') {
    await log(`⏳ ${label} (pattern: ${formNamePattern}) yüklenmesi bekleniyor…`);
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };
    const form = await waitUntil(() => {
      for (const f of collectFrames(document)) {
        if (!f.contentDocument) continue;
        try {
          for (const fm of f.contentDocument.querySelectorAll('form')) {
            if (formNamePattern.test(fm.name || '') ||
                formNamePattern.test(fm.id || '') ||
                formNamePattern.test(fm.action || '')) {
              return fm;
            }
          }
        } catch {}
      }
      return null;
    }, maxMs);

    if (!form) {
      // Diagnostic: tüm form'ları listele
      const all = [];
      for (const f of collectFrames(document)) {
        if (!f.contentDocument) continue;
        try {
          for (const fm of f.contentDocument.querySelectorAll('form')) {
            all.push(`name="${fm.name || '?'}" action="${(fm.action || '?').split('/').pop().slice(0, 40)}"`);
          }
        } catch {}
      }
      throw new Error(`${label} bulunamadı (pattern: ${formNamePattern}). Mevcut form'lar: ${all.join(' | ') || '(yok)'}`);
    }
    await log(`✓ ${label} yüklendi: name="${form.name || '?'}" action="${(form.action || '?').split('/').pop().slice(0, 50)}"`);
    return form;
  }

  /**
   * Form içindeki bütün input/select/button'ları log'a düşür — keşif amaçlı.
   * v1.36.0 için: ilk koşum kullanıcıya neye tıklayacağımı gösterir.
   */
  async function dumpLucaFormStructure(form, log) {
    const inputs = [...form.querySelectorAll('input')].map(i => `${i.type || '?'}#${i.name || i.id || '?'}=${(i.value || '').slice(0, 20)}`).slice(0, 30);
    const selects = [...form.querySelectorAll('select')].map(s => `select#${s.name || s.id || '?'}(${s.options.length}opt)`).slice(0, 10);
    const buttons = [...form.querySelectorAll('button, input[type=submit], input[type=button]')].map(b => `${b.tagName}#${b.name || b.id || '?'}="${(b.textContent || b.value || '').trim().slice(0, 20)}"`).slice(0, 10);
    await log(`🔬 Form yapısı: inputs[${inputs.join(' | ')}]`);
    if (selects.length) await log(`🔬 selects[${selects.join(' | ')}]`);
    if (buttons.length) await log(`🔬 buttons[${buttons.join(' | ')}]`);
  }

  /**
   * Form'da "Rapor Türü" select'ini bul ve "Excel" seçeneğini seç.
   * Olası name/id'ler: RAPOR_TURU, raporTuru, format, TIP, dosyaTuru
   */
  async function setRaporTuruExcel(form, log) {
    // Rapor Türü select'ini İÇERİĞE göre bul. Üç katman:
    //   1) PDF + Word + Excel(xlsx) üçü birden — gerçek "Rapor Türü" (PDF/Word/Excel/ODT/Liste/RTF)
    //   2) Opt sayısı >= 5 + Excel(xlsx) — yine Rapor Türü kesinlikle (REPORT_TYPE 3 opt'lu skip olur)
    //   3) PDF + Excel — son çare (eski mantık)
    // ÖNEMLİ: Form dışındaki select'ler için form.ownerDocument'i tara (frm3 tümü).
    const doc = form.ownerDocument;
    const selects = [
      ...form.querySelectorAll('select'),
      ...doc.querySelectorAll('select'),
    ].filter((sel, i, arr) => arr.indexOf(sel) === i); // dedupe
    const analyzeSelect = (sel) => {
      let hasPdf = false, hasWord = false, hasOdt = false, hasRtf = false;
      let excelXlsxOpt = null, excelOpt = null;
      for (const opt of sel.options) {
        const t = (opt.text || '').toLocaleLowerCase('tr-TR').trim();
        const v = (opt.value || '').toLocaleLowerCase().trim();
        if (/\bpdf\b/.test(t) || /\bpdf\b/.test(v)) hasPdf = true;
        if (/\bword\b/.test(t) || /docx/.test(t) || /docx/.test(v)) hasWord = true;
        if (/\bodt\b/.test(t) || /\bodt\b/.test(v) || /open\s*document/.test(t)) hasOdt = true;
        if (/\brtf\b/.test(t) || /\brtf\b/.test(v)) hasRtf = true;
        // "Excel (xlsx)" tam tercih (Excel Liste hariç)
        if (!excelXlsxOpt && /excel\s*\(xlsx\)/.test(t) && !/liste/.test(t)) excelXlsxOpt = opt;
        // Genel Excel opt
        if (!excelOpt && /^excel\b/.test(t) && !/liste/.test(t)) excelOpt = opt;
        if (!excelOpt && (/xlsx/.test(v) || v === 'xlsx') && !/liste/.test(t) && !/liste/.test(v)) excelOpt = opt;
      }
      const formatCount = (hasPdf?1:0) + (hasWord?1:0) + (hasOdt?1:0) + (hasRtf?1:0);
      return { sel, hasPdf, hasWord, hasOdt, hasRtf, formatCount, optCount: sel.options.length, excelXlsxOpt, excelOpt };
    };

    const analyses = selects.map(analyzeSelect);

    // Katman 1: PDF + Word + Excel — bu kesinlikle "Rapor Türü"
    for (const a of analyses) {
      if (a.hasPdf && a.hasWord && (a.excelXlsxOpt || a.excelOpt)) {
        const target = a.excelXlsxOpt || a.excelOpt;
        const oldText = a.sel.selectedOptions[0]?.text || '?';
        // Çoklu strategy — Luca farklı dispatch yöntemleri kullanabilir
        const targetIdx = [...a.sel.options].indexOf(target);
        a.sel.selectedIndex = targetIdx;
        a.sel.value = target.value;
        a.sel.dispatchEvent(new Event('input', { bubbles: true }));
        a.sel.dispatchEvent(new Event('change', { bubbles: true }));
        // Inline onchange attribute'unu da çağır (Luca'nın gerçek handler'ı)
        const onChangeAttr = a.sel.getAttribute('onchange');
        if (onChangeAttr) {
          try {
            const win = a.sel.ownerDocument.defaultView;
            new win.Function('event', onChangeAttr).call(a.sel, new win.Event('change'));
          } catch (e) {}
        }
        await log(`📑 Rapor Türü [PDF+Word+Excel]: ${oldText} → ${target.text} (select#${a.sel.name || a.sel.id}, ${a.optCount} opt, idx=${targetIdx})`);
        return true;
      }
    }
    // Katman 2: Opt sayısı >= 5 + Excel(xlsx) — "Rapor Türü" minimum 5+ format
    for (const a of analyses) {
      if (a.optCount >= 5 && (a.excelXlsxOpt || a.excelOpt)) {
        const target = a.excelXlsxOpt || a.excelOpt;
        const oldText = a.sel.selectedOptions[0]?.text || '?';
        a.sel.value = target.value;
        a.sel.dispatchEvent(new Event('change', { bubbles: true }));
        await log(`📑 Rapor Türü [opt>=5]: ${oldText} → ${target.text} (select#${a.sel.name || a.sel.id}, ${a.optCount} opt)`);
        return true;
      }
    }
    // Katman 3: PDF + Excel (son çare) — REPORT_TYPE'i de kabul eder
    for (const a of analyses) {
      if (a.hasPdf && (a.excelXlsxOpt || a.excelOpt)) {
        const target = a.excelXlsxOpt || a.excelOpt;
        const oldText = a.sel.selectedOptions[0]?.text || '?';
        a.sel.value = target.value;
        a.sel.dispatchEvent(new Event('change', { bubbles: true }));
        await log(`📑 Rapor Türü [PDF+Excel fallback]: ${oldText} → ${target.text} (select#${a.sel.name || a.sel.id}, ${a.optCount} opt) — ⚠ uyarı: opt<5 olduğu için yanlış select olabilir`);
        return true;
      }
    }

    // Diagnostic — hiçbir select Excel içermiyor.
    // Her select'in opsiyonlarını da log'a düşür (en fazla 6 opt'lu olanları)
    const summary = analyses.map((a) =>
      `${a.sel.name || a.sel.id || '?'}(opt=${a.optCount},pdf=${a.hasPdf},word=${a.hasWord},xlsx=${!!a.excelXlsxOpt},excel=${!!a.excelOpt})`,
    ).join(' | ');
    await log(`⚠ Rapor Türü select'i bulunamadı. Selects: ${summary}`);
    // 4+ opt'lu select'lerin opsiyonlarını ayrıntılı log
    for (const a of analyses) {
      if (a.optCount >= 2 && a.optCount <= 12) {
        const opts = [...a.sel.options].slice(0, 8).map((o) => `"${(o.text || '').trim().slice(0, 25)}"=${o.value}`).join(' | ');
        await log(`🔬 ${a.sel.name || a.sel.id || '?'} opts: ${opts}`);
      }
    }
    return false;
  }

  /**
   * Form'da hesap kodu input'unu bul ve doldur. KDV 191/391 için.
   * Olası name'ler: HESAP_KODU, hesapKodu, BAS_HESAP_KODU, BIT_HESAP_KODU
   * "Tek hesap kodu" alanı varsa onu, yoksa BAS+BIT'i aynı değerle doldurur.
   */
  const LUCA_FORM_FIELD_CACHE_KEY = 'moren_luca_form_field_cache_v1';

  function readLucaFormFieldCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LUCA_FORM_FIELD_CACHE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeLucaFormFieldCache(cache) {
    try { localStorage.setItem(LUCA_FORM_FIELD_CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function cssAttrValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getLucaFormFieldCacheKey(form) {
    const action = String(form?.getAttribute?.('action') || form?.action || '')
      .split('?')[0]
      .split('/')
      .pop();
    return normalizeLucaMenuText(`${form?.name || form?.id || 'form'}|${action || ''}`) || 'default';
  }

  function selectorForLucaField(input) {
    if (!input) return '';
    const name = input.getAttribute?.('name') || '';
    const id = input.getAttribute?.('id') || '';
    if (name) return `input[name="${cssAttrValue(name)}"]`;
    if (id) return `input[id="${cssAttrValue(id)}"]`;
    return '';
  }

  function describeLucaField(input) {
    if (!input) return '?';
    return input.getAttribute?.('name') || input.getAttribute?.('id') || input.tagName || '?';
  }

  function cacheLucaFormField(form, role, input) {
    try {
      const selector = selectorForLucaField(input);
      if (!selector) return null;
      const formKey = getLucaFormFieldCacheKey(form);
      const cache = readLucaFormFieldCache();
      const formEntry = cache[formKey] || { form: formKey, fields: {} };
      formEntry.fields = formEntry.fields || {};
      formEntry.fields[role] = {
        selector,
        name: input.getAttribute?.('name') || '',
        id: input.getAttribute?.('id') || '',
        type: input.getAttribute?.('type') || '',
        updatedAt: Date.now(),
      };
      cache[formKey] = formEntry;
      writeLucaFormFieldCache(cache);
      return formEntry.fields[role];
    } catch {
      return null;
    }
  }

  function getCachedLucaFormField(form, role) {
    try {
      const entry = readLucaFormFieldCache()[getLucaFormFieldCacheKey(form)]?.fields?.[role];
      if (!entry?.selector) return null;
      if (entry.updatedAt && Date.now() - entry.updatedAt > 30 * 24 * 60 * 60 * 1000) return null;
      return form.querySelector(entry.selector);
    } catch {
      return null;
    }
  }

  try {
    window.__morenLucaFormFieldCache = () => readLucaFormFieldCache();
  } catch {}

  async function fillLucaHesapKodu(form, hesapKodu, log) {
    // GERÇEK TYPING SİMÜLASYONU — Luca synthetic value set'ini kabul etmiyor;
    // klavyede gerçekten yazılmış gibi karakter-karakter event chain göndermek lazım.
    // Strateji: focus + boşalt + her karakter için keydown/keypress/input/keyup
    // + tüm karakterler bittikten sonra blur (server'a session'a yaz).
    const typeChar = (inp, ch) => {
      const win = inp.ownerDocument.defaultView;
      const code = ch.charCodeAt(0);
      try {
        // beforeinput
        inp.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
        // keydown
        inp.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: code, which: code }));
        // keypress
        inp.dispatchEvent(new win.KeyboardEvent('keypress', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: code, which: code }));
        // value'yu uzat (native setter ile)
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, (inp.value || '') + ch);
        // input event (typing'i bildirir)
        inp.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        // keyup
        inp.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: code, which: code }));
      } catch (e) { /* fallback: native value set */ }
    };

    const typeText = async (inp, text) => {
      if (!inp) return false;
      const win = inp.ownerDocument.defaultView;
      try {
        // 1. Focus
        inp.focus();
        inp.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }));
        inp.dispatchEvent(new win.FocusEvent('focus', { bubbles: true }));
        // 2. Önceki değeri seç + sil (Luca yazılı değer üstüne yazmayı kabul etmeyebilir)
        try {
          const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, '');
          inp.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        } catch {}
        // 3. Karakter karakter yaz
        for (const ch of text) {
          typeChar(inp, ch);
          await sleep(50); // gerçek typing speed
        }
        // 4. Final change + blur
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        // 5. Inline onblur/onchange execute (Luca lookup)
        const onBlurAttr = inp.getAttribute('onblur');
        if (onBlurAttr) {
          try { new win.Function('event', onBlurAttr).call(inp, new win.Event('blur')); } catch (e) {}
        }
        const onChangeAttr = inp.getAttribute('onchange');
        if (onChangeAttr) {
          try { new win.Function('event', onChangeAttr).call(inp, new win.Event('change')); } catch (e) {}
        }
        return true;
      } catch (e) { return false; }
    };

    // Eski sync setNative'u typing fonksiyonuyla değiştir (geri uyumlu wrap)
    const setNative = (inp, value) => {
      // Sync bağlamda kullanılan fonksiyon — sadece native setter (fallback için)
      if (!inp) return false;
      const win = inp.ownerDocument.defaultView;
      try {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, value);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      } catch (e) { return false; }
    };

    // Önce tek hesap kodu input'u dene
    const cachedIlk = getCachedLucaFormField(form, 'hesapIlk');
    const cachedSon = getCachedLucaFormField(form, 'hesapSon');
    if (cachedIlk && cachedSon) {
      setNative(cachedIlk, hesapKodu);
      setNative(cachedSon, hesapKodu);
      await sleep(300);
      await log(`💼 Hesap kodu cache ID ile set: ${hesapKodu} → ${describeLucaField(cachedIlk)}/${describeLucaField(cachedSon)}`);
      return true;
    }

    const single = form.querySelector('input[name="HESAP_KODU"], input[id="HESAP_KODU"], input[name="hesapKodu"]');
    if (single) {
      cacheLucaFormField(form, 'hesapIlk', single);
      setNative(single, hesapKodu);
      await log(`💼 Hesap kodu set: ${hesapKodu} (input#${single.name || single.id})`);
      return true;
    }

    // BAS + BIT (alt çizgili: BAS_HESAP_KODU)
    const bas = form.querySelector('input[name="BAS_HESAP_KODU"], input[id="BAS_HESAP_KODU"], input[name="basHesapKodu"], input[name*="BAS" i][name*="HESAP" i]');
    const bit = form.querySelector('input[name="BIT_HESAP_KODU"], input[id="BIT_HESAP_KODU"], input[name="bitHesapKodu"], input[name*="BIT" i][name*="HESAP" i]');
    if (bas && bit) {
      cacheLucaFormField(form, 'hesapIlk', bas);
      cacheLucaFormField(form, 'hesapSon', bit);
      setNative(bas, hesapKodu);
      setNative(bit, hesapKodu);
      await log(`💼 Hesap kodu (BAS+BIT) set: ${hesapKodu}`);
      return true;
    }

    // ILK + SON (Luca'nın gerçek isimleri: HESAPKODU_ILK + HESAPKODU_SON, alt çizgisiz)
    const ilk = form.querySelector('input[name="HESAPKODU_ILK"], input[id="HESAPKODU_ILK"], input[name="hesapkoduIlk"]');
    const son = form.querySelector('input[name="HESAPKODU_SON"], input[id="HESAPKODU_SON"], input[name="hesapkoduSon"]');
    if (ilk && son) {
      cacheLucaFormField(form, 'hesapIlk', ilk);
      cacheLucaFormField(form, 'hesapSon', son);
      // Karakter karakter typing simulate — Luca synthetic value set'ini kabul etmiyor
      await typeText(ilk, hesapKodu);
      await sleep(400); // ILK onblur'un Luca AJAX'i tamamlansın
      await typeText(son, hesapKodu);
      await sleep(800); // SON onblur'un AJAX'i de tamamlansın
      const v1 = ilk.value, v2 = son.value;
      await log(`💼 Hesap kodu (typed) set: ${hesapKodu} (input.value: ILK="${v1}" SON="${v2}")`);
      // Doğrulama — boşaldıysa setNative ile tekrar yaz (son çare)
      if (v1 !== hesapKodu || v2 !== hesapKodu) {
        setNative(ilk, hesapKodu);
        setNative(son, hesapKodu);
        await sleep(400);
        await log(`💼 Hesap kodu re-set (native): ILK="${ilk.value}" SON="${son.value}"`);
      }
      return true;
    }

    // Fallback: name'inde "hesap" geçen ilk text input
    const ilkGeneric = form.querySelector('input[name*="hesap" i][name*="ilk" i], input[id*="hesap" i][id*="ilk" i]');
    const sonGeneric = form.querySelector('input[name*="hesap" i][name*="son" i], input[id*="hesap" i][id*="son" i]');
    if (ilkGeneric && sonGeneric) {
      cacheLucaFormField(form, 'hesapIlk', ilkGeneric);
      cacheLucaFormField(form, 'hesapSon', sonGeneric);
      setNative(ilkGeneric, hesapKodu);
      setNative(sonGeneric, hesapKodu);
      await sleep(400);
      await log(`💼 Hesap kodu (ILK+SON generic) set: ${hesapKodu} → ${ilkGeneric.name || ilkGeneric.id}/${sonGeneric.name || sonGeneric.id}`);
      return true;
    }

    const anyHesap = form.querySelector('input[name*="hesap" i], input[id*="hesap" i]');
    if (anyHesap) {
      cacheLucaFormField(form, 'hesapIlk', anyHesap);
      setNative(anyHesap, hesapKodu);
      await log(`💼 Hesap kodu (fallback) set: ${hesapKodu} → ${anyHesap.name || anyHesap.id}`);
      return true;
    }

    await log(`⚠ Hesap kodu input'u bulunamadı (form yapısını yukarıdaki dump'tan kontrol et)`);
    return false;
  }

  async function ensureDefteriKebirHesapSelection(form, hesapKodu, log) {
    const win = form.ownerDocument?.defaultView || window;
    const setInputValue = (inp, value) => {
      if (!inp) return false;
      try {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, value);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      } catch {
        try { inp.value = value; return true; } catch { return false; }
      }
    };
    const searchInput = form.querySelector('input[name="hes_kodu"], input#hes_kodu, input[name*="hes_kodu" i]');
    if (searchInput) {
      setInputValue(searchInput, hesapKodu);
      await log(`💼 Hesap arama alanı set: ${searchInput.name || searchInput.id}="${hesapKodu}"`);
    }
    const hbox = form.querySelector('select[name="hbox"], select#hbox');
    let selected = false;
    if (hbox) {
      const norm = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0131/g, 'i')
        .replace(/\u0130/g, 'i')
        .toLowerCase();
      const opt = Array.from(hbox.options || []).find((o) => {
        const hay = norm(`${o.value || ''} ${o.text || ''}`);
        return hay.startsWith(hesapKodu) ||
          hay.includes(`${hesapKodu} `) ||
          hay.includes(`${hesapKodu}.`) ||
          hay.includes(`${hesapKodu}-`);
      });
      if (opt) {
        hbox.value = opt.value;
        hbox.selectedIndex = Array.from(hbox.options).indexOf(opt);
        hbox.dispatchEvent(new Event('input', { bubbles: true }));
        hbox.dispatchEvent(new Event('change', { bubbles: true }));
        selected = true;
        await log(`💼 hbox hesap seçimi: "${String(opt.text || opt.value).trim().slice(0, 80)}"`);
      } else {
        const sample = Array.from(hbox.options || []).slice(0, 5).map((o) => String(o.text || o.value).trim().slice(0, 40)).join(' | ');
        await log(`⚠ hbox içinde ${hesapKodu} seçeneği bulunamadı. İlk seçenekler: ${sample}`);
      }
    }
    const addBtn = form.querySelector('input[name="eklemeButton"], input#eklemeButton, button[name="eklemeButton"]');
    if (selected && addBtn) {
      try {
        if (typeof addBtn.focus === 'function') addBtn.focus();
        addBtn.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
        addBtn.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
        addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
        if (typeof addBtn.click === 'function') addBtn.click();
        const oc = addBtn.getAttribute?.('onclick');
        if (oc) {
          try { new win.Function(oc).call(addBtn); } catch {}
        }
        await log(`💼 Ekle butonu tetiklendi: ${addBtn.name || addBtn.id || addBtn.tagName}`);
        await sleep(600);
      } catch (e) {
        await log(`⚠ Ekle butonu tetiklenemedi: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    const ilk = getCachedLucaFormField(form, 'hesapIlk') ||
      form.querySelector('input[name="p_hesap_no_ilk_1"], input[name*="hesap" i][name*="ilk" i]');
    const son = getCachedLucaFormField(form, 'hesapSon') ||
      form.querySelector('input[name="p_hesap_no_son_1"], input[name*="hesap" i][name*="son" i]');
    setInputValue(ilk, hesapKodu);
    setInputValue(son, hesapKodu);
    await log(`💼 Defteri Kebir hesap state doğrulandı: ${describeLucaField(ilk)}="${ilk?.value || ''}" / ${describeLucaField(son)}="${son?.value || ''}"`);
    return true;
  }

  /**
   * İşletme defteri formunda Gelir/Gider checkbox'larını ayarla.
   * Mode: 'gelir' → sadece Gelir işaretli; 'gider' → sadece Gider işaretli.
   */
  async function fillLucaGelirGider(form, mode, log) {
    const allCheckboxes = [...form.querySelectorAll('input[type=checkbox]')];
    let gelirCb = null, giderCb = null;
    for (const cb of allCheckboxes) {
      const key = ((cb.name || '') + ' ' + (cb.id || '') + ' ' + (cb.value || '')).toLocaleLowerCase('tr-TR');
      // Yakındaki label/text'e de bak
      const label = (cb.closest('tr')?.textContent || cb.parentElement?.textContent || '').toLocaleLowerCase('tr-TR');
      const combined = key + ' ' + label;
      if (/gelir/.test(combined) && !gelirCb) gelirCb = cb;
      if (/gider/.test(combined) && !giderCb) giderCb = cb;
    }

    const setCb = (cb, want) => {
      if (!cb) return;
      if (cb.checked !== want) {
        cb.checked = want;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('click', { bubbles: true }));
      }
    };

    if (mode === 'gelir') {
      setCb(gelirCb, true);
      setCb(giderCb, false);
      await log(`🟢 Gelir=ON, Gider=OFF (gelir#${gelirCb?.name || '?'} gider#${giderCb?.name || '?'})`);
    } else {
      setCb(gelirCb, false);
      setCb(giderCb, true);
      await log(`🔴 Gelir=OFF, Gider=ON`);
    }
  }

  /**
   * Form'daki TARIH_ILK / TARIH_SON'u job.donem'a göre doldur (Mizan'la aynı format).
   */
  async function fillLucaTarih(form, job, log) {
    const tarih = donemToTarihAraligi(job.donem, job.donemTipi);
    if (!tarih) throw new Error(`Tarih hesaplanamadı: ${job.donem}`);
    let tarihIlk = getCachedLucaFormField(form, 'tarihIlk') ||
      form.querySelector('input[name="TARIH_ILK"], input[id="TARIH_ILK"], input[name="tarih_ilk"], input[name="tarih_bas"], input[id="tarih_bas"], input[name*="tarih" i][name*="bas" i], input[name*="tarih" i][name*="ilk" i], input[id*="tarih" i][id*="ilk" i], input[name*="tar" i][name*="ilk" i], input[id*="tar" i][id*="ilk" i]');
    let tarihSon = getCachedLucaFormField(form, 'tarihSon') ||
      form.querySelector('input[name="TARIH_SON"], input[id="TARIH_SON"], input[name="tarih_son"], input[name="tarih_bit"], input[id="tarih_bit"], input[name*="tarih" i][name*="bit" i], input[name*="tarih" i][name*="son" i], input[id*="tarih" i][id*="son" i], input[name*="tar" i][name*="son" i], input[id*="tar" i][id*="son" i]');
    if (!tarihIlk || !tarihSon) {
      const allInputs = [...form.querySelectorAll('input')]
        .map((inp) => `${inp.name || inp.id || '?'}:${inp.type || ''}`)
        .slice(0, 80)
        .join(' | ');
      throw new Error(`TARIH_ILK / TARIH_SON bulunamadı. Inputlar: ${allInputs}`);
    }
    cacheLucaFormField(form, 'tarihIlk', tarihIlk);
    cacheLucaFormField(form, 'tarihSon', tarihSon);
    const slashBas = tarih.bas.replace(/\./g, '/');
    const slashBit = tarih.bit.replace(/\./g, '/');

    // Tarih için setNative — Luca tarih input'larında datepicker mask var,
    // synthetic keypress'i mask plugin'i reddediyor. Mizan'da setNative çalışıyor;
    // KDV'de de setNative kullanmak doğru.
    const setNative = (inp, value) => {
      const win = inp.ownerDocument.defaultView;
      try {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, value);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch {}
    };
    setNative(tarihIlk, slashBas);
    setNative(tarihSon, slashBit);
    await sleep(300);
    // Doğrula — boşsa tekrar yaz
    if (!tarihIlk.value || !tarihSon.value) {
      setNative(tarihIlk, slashBas);
      setNative(tarihSon, slashBit);
      await sleep(200);
    }
    await log(`📅 Tarih: ${tarihIlk.value} → ${tarihSon.value}`);
  }

  /**
   * Generic typing simulator — fillLucaHesapKodu içinde tanımlı typeText ile aynı.
   * Modüler kullanım için dışarı çıkarıldı: tarih + hesap kodu + diğer text input'lar.
   */
  async function typeLucaInput(inp, text) {
    if (!inp) return false;
    const win = inp.ownerDocument.defaultView;
    try {
      inp.focus();
      inp.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }));
      inp.dispatchEvent(new win.FocusEvent('focus', { bubbles: true }));
      // Önceki değeri temizle
      try {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '');
        inp.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      } catch {}
      // Karakter karakter yaz
      for (const ch of text) {
        const code = ch.charCodeAt(0);
        try {
          inp.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
          inp.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: ch, keyCode: code, which: code }));
          inp.dispatchEvent(new win.KeyboardEvent('keypress', { bubbles: true, key: ch, keyCode: code, which: code }));
          const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, (inp.value || '') + ch);
          inp.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
          inp.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, key: ch, keyCode: code, which: code }));
        } catch (e) {}
        await sleep(40);
      }
      // Final
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));
      inp.dispatchEvent(new Event('blur', { bubbles: true }));
      // Inline onblur/onchange execute
      const onBlurAttr = inp.getAttribute('onblur');
      if (onBlurAttr) { try { new win.Function('event', onBlurAttr).call(inp, new win.Event('blur')); } catch {} }
      const onChangeAttr = inp.getAttribute('onchange');
      if (onChangeAttr) { try { new win.Function('event', onChangeAttr).call(inp, new win.Event('change')); } catch {} }
      return true;
    } catch (e) { return false; }
  }

  /**
   * Form'da "Rapor" butonunu bul ve tıkla — Mizan'da yaptığımız form intercept blob'u
   * yakalayacak (fetchMizanByClickIntercept'in son kısmıyla aynı mantık).
   */
  async function clickLucaRaporButton(form, log) {
    // Luca'da "Rapor" butonu form'un DIŞINDA ayrı div'de — mizan akışındaki
    // findExcelButton ile aynı strateji: form.ownerDocument tüm DOM'u tara.
    const doc = form.ownerDocument;
    const win = doc.defaultView || window;
    const all = [
      ...form.querySelectorAll('input[type="button"], input[type="submit"], button, a'),
      ...doc.querySelectorAll('input[type="button"], input[type="submit"], button, a'),
    ];

    // 1) Tam eşleşme: "Rapor" / "RAPOR"
    let btn = all.find((el) => {
      const txt = (el.value || el.textContent || '').trim();
      return txt === 'Rapor' || txt === 'RAPOR';
    });

    // 2) "Rapor Al" / "Raporu Hazırla" / "Excel'e Aktar"
    if (!btn) {
      btn = all.find((el) => {
        const txt = (el.value || el.textContent || '').trim();
        return /^rapor( al|u? hazırla|u? olustur)?$/i.test(txt) ||
               /excel.*aktar|aktar.*excel/i.test(txt);
      });
    }

    // 3) onclick içinde raporIndir/jasper/submitForm/gonder
    if (!btn) {
      btn = all.find((el) => {
        const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
        return /raporIndir|jasper|rapor_tur|raporGetir|submitForm|raporAl|gonder/i.test(oc);
      });
    }

    if (!btn) {
      const sample = all
        .filter((el) => el.offsetParent !== null) // visible
        .slice(0, 15)
        .map((el) => {
          const t = (el.value || el.textContent || '').trim().slice(0, 20);
          const oc = ((el.getAttribute && el.getAttribute('onclick')) || '').slice(0, 30);
          return `[${el.tagName}]"${t || '∅'}"${oc ? `|oc=${oc}` : ''}`;
        })
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .join(' || ');
      throw new Error(`"Rapor" butonu bulunamadı (form+frame DOM tarandı). Visible elements: ${sample || '(yok)'}`);
    }

    const label = (btn.value || btn.textContent || '').trim().slice(0, 30);
    const onclickAttr = (btn.getAttribute && btn.getAttribute('onclick')) || '';
    const hrefAttr = (btn.getAttribute && btn.getAttribute('href')) || '';
    try {
      if (typeof win.gonder === 'function') {
        await log(`gonder() source preview: ${String(win.gonder).replace(/\s+/g, ' ').slice(0, 500)}`);
      } else {
        await log('frm3 gonder() not found');
      }
    } catch {}
    await log(`🎯 Buton bulundu: "${label}" [${btn.tagName}]`);
    await log(`🖱 "${label}" butonu tıklanıyor (gerçek user click sim)`);
    // Gerçek user click — focus + mousedown + mouseup + click sırası
    try {
      if (typeof btn.focus === 'function') btn.focus();
      btn.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      btn.click();
    } catch (e) {
      try { btn.click(); } catch {}
    }
    // NOT: onclick attribute eval'i KALDIRILDI — Mizan'da gerekiyordu
    // (gonder() fonksiyonu) ama KDV Defteri Kebir akışında Luca'nın kendi click
    // handler'ı zaten dispatch edilen MouseEvent ile tetikleniyor. Ekstra eval
    // bazen flow'u 2 kez tetikleyip yanlış sonuçlara sebep oluyor.
  }

  /**
   * Form üzerindeki "Yenile" butonunu bul ve tıkla — Defteri Kebir akışında
   * hesap kodu set sonrası Luca session'ını güncellemek için ŞART.
   * frm3 doc'unda "Yenile" text'li link/button arar (form'un dışında olabilir).
   */
  async function clickLucaRaporButtonStrict(form, log) {
    const doc = form.ownerDocument;
    const win = doc.defaultView || window;
    const all = [
      ...form.querySelectorAll('input[type="button"], input[type="submit"], button, a, [onclick]'),
      ...doc.querySelectorAll('input[type="button"], input[type="submit"], button, a, [onclick]'),
    ];
    let btn = all.find((el) => {
      const txt = (el.value || el.textContent || '').trim();
      return txt === 'Rapor' || txt === 'RAPOR';
    }) || all.find((el) => {
      const txt = (el.value || el.textContent || '').trim();
      const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
      return /^rapor( al|u? haz[ıi]rla|u? olustur)?$/i.test(txt) ||
        /excel.*aktar|aktar.*excel|raporIndir|jasper|rapor_tur|raporGetir|submitForm|raporAl|gonder/i.test(oc);
    });
    if (!btn) throw new Error('"Rapor" butonu bulunamadı');
    const label = (btn.value || btn.textContent || '').trim().slice(0, 30);
    const onclickAttr = (btn.getAttribute && btn.getAttribute('onclick')) || '';
    const hrefAttr = (btn.getAttribute && btn.getAttribute('href')) || '';
    try {
      if (typeof win.gonder === 'function') {
        const src = String(win.gonder).replace(/\s+/g, ' ');
        await log(`🔍 frm3 gonder() source: ${src.slice(0, 900)}`);
      } else {
        await log('ℹ frm3 gonder() bulunamadı');
      }
    } catch {}
    await log(`🎯 Rapor butonu: "${label}" [${btn.tagName}] onclick="${onclickAttr.slice(0, 120)}" href="${hrefAttr.slice(0, 120)}"`);
    try {
      if (typeof btn.focus === 'function') btn.focus();
      btn.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
      btn.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
      if (typeof btn.click === 'function') btn.click();
    } catch {
      try { if (typeof btn.click === 'function') btn.click(); } catch {}
    }
    await log('ℹ Rapor native click ile tetiklendi; gerekirse onclick fallback bekleme icinde tek kez calisacak');
    const triggerDirectOnce = async () => {
      let ran = false;
      if (onclickAttr) {
        try {
          new win.Function(onclickAttr).call(btn);
          ran = true;
          await log('🔁 Rapor onclick attribute tek kez doğrudan çağrıldı');
        } catch (e) {
          await log(`⚠ Rapor onclick doğrudan çağrılamadı: ${String(e?.message || e).slice(0, 120)}`);
        }
      }
      if (typeof win.gonder === 'function') {
        try {
          const ret = win.gonder();
          await log(`Rapor gonder() return=${String(ret).slice(0, 60)}`);
          ran = true;
          await log('🔁 Rapor gonder() kontrollu fallback olarak çağrıldı');
        } catch (e) {
          await log(`⚠ Rapor gonder() fallback çağrılamadı: ${String(e?.message || e).slice(0, 120)}`);
        }
      }
      return ran;
    };
    if (/^javascript:/i.test(hrefAttr)) {
      try {
        new win.Function(hrefAttr.replace(/^javascript:/i, '')).call(btn);
        await log('🔁 Rapor javascript:href doğrudan çağrıldı');
      } catch (e) {
        await log(`⚠ Rapor href doğrudan çağrılamadı: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    return triggerDirectOnce;
  }

  async function clickLucaYenileButton(form, log) {
    const doc = form.ownerDocument;
    const all = [
      ...form.querySelectorAll('input[type="button"], input[type="submit"], button, a'),
      ...doc.querySelectorAll('input[type="button"], input[type="submit"], button, a, td, font, span, div'),
    ];

    // 1) Tam eşleşme: "Yenile" / "YENİLE"
    let btn = all.find((el) => {
      const txt = (el.value || el.textContent || '').trim();
      // Sadece kendi içeriği "Yenile" olan (parent/wrapper değil)
      if (el.children && el.children.length > 0) return false;
      return txt === 'Yenile' || txt === 'YENİLE' || txt === 'YENILE';
    });

    // 2) onclick içinde "yenile|refresh|reload|loadhesap"
    if (!btn) {
      btn = all.find((el) => {
        const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
        return /yenile|refresh|reload|loadHesap|loadhesap|hesapAra|hesapPlani/i.test(oc);
      });
    }

    if (!btn) {
      await log('ℹ️ Yenile butonu bulunamadı — devam ediliyor (Luca session zaten güncel olabilir)');
      return false;
    }

    const label = (btn.value || btn.textContent || '').trim().slice(0, 30);
    await log(`🔄 Yenile butonu tıklanıyor: "${label}" [${btn.tagName}]`);
    try {
      btn.click();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {}
    // onclick attribute'unu da execute et
    try {
      const oc = btn.getAttribute && btn.getAttribute('onclick');
      if (oc) {
        const win = doc.defaultView || window;
        new win.Function(oc).call(btn);
      }
    } catch {}
    return true;
  }

  function collectLucaFormsNow(formNamePattern) {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch {}
      return acc;
    };
    const forms = [];
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        for (const fm of f.contentDocument.querySelectorAll('form')) {
          if (formNamePattern.test(fm.name || '') ||
              formNamePattern.test(fm.id || '') ||
              formNamePattern.test(fm.action || '')) {
            forms.push(fm);
          }
        }
      } catch {}
    }
    return forms;
  }

  function getKdvLedgerReportName(form) {
    try {
      return String(form?.querySelector?.('input[name="ReportName"], input#ReportName')?.value || '');
    } catch {
      return '';
    }
  }

  function isPreferredKdvLedgerForm(form) {
    if (!form) return false;
    const reportName = getKdvLedgerReportName(form);
    const identity = `${form.name || ''} ${form.id || ''} ${form.action || ''} ${reportName}`;
    if (/MUAVIN_DEFTER/i.test(reportName)) return false;
    if (/KEBIR|raporKebir|kebir/i.test(identity)) return true;
    if (form.querySelector('select[name="p_fis_birlestir_0"], select[name="p_siralama_1"]')) return true;
    return false;
  }

  function findPreferredKdvLedgerFormNow() {
    const forms = collectLucaFormsNow(/raporKebir|kebir|REPFORM|DefterServlet/i);
    return forms.find((form) => isPreferredKdvLedgerForm(form)) || null;
  }

  function findLucaKdvLedgerFormNow() {
    return findPreferredKdvLedgerFormNow() ||
      collectLucaFormsNow(/raporKebir|kebir|REPFORM|DefterServlet/i)[0] ||
      null;
  }

  function describeKdvLedgerForm(form) {
    if (!form) return '(form yok)';
    const inputs = [...form.querySelectorAll('input')]
      .slice(0, 16)
      .map((i) => `${i.type || '?'}#${i.name || i.id || '?'}=${String(i.value || '').slice(0, 20)}`);
    const selects = [...form.ownerDocument.querySelectorAll('select')]
      .slice(0, 10)
      .map((s) => `select#${s.name || s.id || '?'}(${s.options?.length || 0})`);
    const reportName = getKdvLedgerReportName(form);
    return `name="${form.name || '?'}" action="${(form.action || '?').split('/').pop().slice(0, 70)}" report="${reportName || '-'}" preferred=${isPreferredKdvLedgerForm(form)} inputs=[${inputs.join(' | ')}] selects=[${selects.join(' | ')}]`;
  }

  async function resetLucaFrm3ForKdv(log, reason) {
    try {
      const f3 = getLucaFrame('frm3');
      if (f3) {
        f3.src = 'about:blank';
        await sleep(650);
        await log(`KDV form frame sifirlandi: ${reason}`);
      }
    } catch (e) {
      await log(`KDV frame sifirlama hatasi: ${String(e?.message || e).slice(0, 120)}`);
    }
  }

  async function logKdvMenuHints(log) {
    try {
      const rows = [
        ...collectLucaClickMap('Defteri Kebir'),
      ];
      const seen = new Set();
      const hints = [];
      for (const r of rows) {
        const key = `${r.frame}|${r.text}|${r.ii1a}|${r.onclick}|${r.href}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push(`${r.frame}:${r.tag} "${String(r.text || r.value || r.id || '').slice(0, 55)}" code=${r.ii1a || '-'} oc=${String(r.onclick || r.href || '').slice(0, 70)}`);
        if (hints.length >= 10) break;
      }
      if (hints.length) await log(`KDV menu ipuclari: ${hints.join(' || ')}`);
    } catch {}
  }

  function buildKdvLedgerMenuAttempts() {
    const attempts = [];
    const dynamic = [];
    const seen = new Set();
    const fold = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0131/g, 'i')
      .replace(/\u0130/g, 'i')
      .toLowerCase();
    const push = (attempt) => {
      const key = attempt.code ? `code:${attempt.code}` : `text:${attempt.text}#${attempt.nth || 1}`;
      if (seen.has(key)) return;
      seen.add(key);
      attempts.push(attempt);
    };

    try {
      const rows = collectLucaClickMap('Defteri Kebir');
      for (const row of rows) {
        const text = String(row.text || row.value || row.id || '').replace(/\s+/g, ' ').trim();
        const hay = `${row.onclick || ''} ${row.href || ''} ${row.ii1a || ''} ${row.formAction || ''}`;
        const code = extractLucaMenuCode(hay) || String(row.ii1a || '').trim();
        const folded = fold(`${text} ${hay}`);
        if (!code || !folded.includes('defteri kebir')) continue;

        let score = 0;
        if (/tum.*yazicilar|yazicilar.*tum/.test(folded)) score += 120;
        if (/["']79["']/.test(code)) score += 80;
        if (/frm5|menu|right/i.test(String(row.frame || ''))) score += 15;
        if (/nokta|vurus|matrix|dot/.test(folded)) score -= 80;
        if (/["']75["']/.test(code)) score -= 35;
        dynamic.push({
          text: text || 'Defteri Kebir',
          code,
          maxMs: 14000,
          score,
        });
      }
    } catch {}

    dynamic
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .forEach(push);
    push({ text: 'Defteri Kebir (Tum Yazicilar)', code: 'lI1lI(0,17,"79")', maxMs: 14000, score: -5 });
    push({ text: 'Defteri Kebir', nth: 2, maxMs: 14000, allowCache: false, score: -10 });
    push({ text: 'Defteri Kebir', nth: 1, maxMs: 12000, allowCache: false, score: -20 });
    return attempts;
  }

  async function openLucaKdvLedgerReportForm(log) {
    await logKdvMenuHints(log);
    const attempts = buildKdvLedgerMenuAttempts();
    if (attempts.length) {
      await log(`KDV Defteri Kebir deneme sirasi: ${attempts.slice(0, 8).map((a) => a.code ? `${a.text}(${a.code})` : `${a.text}#${a.nth}`).join(' | ')}`);
    }

    for (const attempt of attempts) {
      await resetLucaFrm3ForKdv(log, `${attempt.text}${attempt.code ? ` ${attempt.code}` : `#${attempt.nth}`}`);
      try {
        await log(`KDV rapor ekrani deneniyor: ${attempt.text}${attempt.code ? ` (${attempt.code})` : ` (${attempt.nth}. occurrence)`}`);
        if (attempt.code) {
          const opened = await callLucaMenuCode(attempt.text, attempt.code, log, 1200);
          if (!opened) {
            await log(`KDV ${attempt.text} ID cagrilamadi; siradaki deneniyor`);
            continue;
          }
        } else {
          await clickLucaRightMenu(attempt.text, log, {
            nth: attempt.nth,
            maxMs: attempt.maxMs,
            allowCache: attempt.allowCache !== false,
            settleMs: 900,
            afterClickReady: () => !!findPreferredKdvLedgerFormNow(),
          });
        }
        const form = await waitUntil(() => findPreferredKdvLedgerFormNow(), attempt.maxMs || 10000, 250);
        if (form && isPreferredKdvLedgerForm(form)) {
          await log(`KDV rapor formu secildi: ${attempt.text}${attempt.code ? '' : `#${attempt.nth}`} -> ${describeKdvLedgerForm(form)}`);
          return form;
        }
        const anyForm = findLucaKdvLedgerFormNow();
        if (anyForm) {
          await log(`KDV ${attempt.text} uygun form acmadi; gorulen form reddedildi -> ${describeKdvLedgerForm(anyForm)}`);
        } else {
          await log(`KDV ${attempt.text} form acmadi; siradaki deneniyor`);
        }
      } catch (e) {
        await log(`KDV ${attempt.text}${attempt.code ? '' : `#${attempt.nth}`} denenemedi: ${String(e?.message || e).slice(0, 180)}`);
      }
    }

    // BUG FIX (Luca KDV_391 BILANCO SATIS - WASH faturasi): Luca menusu guncellenmis
    // veya form name'leri degisinmis olabilir. Iki strict attempt basarisiz olduysa,
    // SON CARE: kebir/REPFORM/DefterServlet pattern'i ile eslesen ANY formu (Muavin
    // hari) kabul et. Bu sayede form name varyasyonu kabul ediliyor, Muavin Defter
    // hala reddediliyor (yanlis veri cikarmasin diye).
    try {
      const fallback = collectLucaFormsNow(/raporKebir|kebir|REPFORM|DefterServlet/i)
        .find((f) => !/MUAVIN_DEFTER/i.test(getKdvLedgerReportName(f)));
      if (fallback) {
        await log(`KDV fallback: strict match basarisiz - kebir-benzeri form kabul edildi -> ${describeKdvLedgerForm(fallback)}`);
        return fallback;
      }
    } catch (e) {
      await log(`KDV fallback exception: ${String(e?.message || e).slice(0, 180)}`);
    }

    for (const label of ['Defteri Kebir', 'Defteri Kebir#2', 'Defteri Kebir (Tum Yazicilar)']) {
      try { deleteCachedLucaMenuHit(label); } catch {}
    }
    throw new Error(`KDV Defteri Kebir rapor formu acilamadi (${attempts.length} deneme + 1 fallback denendi). Muavin Defter formu yanlis veri verebilir, kabul edilmedi. Mevcut form'lar: ${collectLucaFormsBrief().join(' | ') || '(yok)'}`);
  }

  /**
   * KDV 191 / 391 flow — Tüm Yazıcılar > Defteri Kebir ekranı.
   *
   * Yaklaşım: Alanları Luca'nın gerçek ID/name'leriyle doldur, Luca'nın kendi
   * rapor indirme akışını tetikle ve inen Excel blob'unu yakala.
   */
  async function fetchLucaDefteriKebirExcel(job, log, hesapKodu) {
    if (location.hostname.includes('agiris.luca') || location.pathname.includes('LUCASSO')) {
      throw new Error('Bu Luca v2.1 sürümü; klasik Luca kullanın.');
    }
    job = { ...job, donemTipi: 'AYLIK' };

    // 1-2. Firma + Fiş Listesi
    await ensureLucaFirma(job, log);
    await navigateToFisListesi(log);

    // 3-4. KDV için doğru rapor formunu aç: Tüm Yazıcılar > Defteri Kebir.
    const form = await openLucaKdvLedgerReportForm(log);
    const frm3doc = form.ownerDocument;
    const frm3win = frm3doc.defaultView;

    // 5. Form'un tam yüklenmesi için ekstra bekleme — UI elements lazy load
    await sleep(800);

    // 6. Tarih hesabı (AYLIK)
    await dumpLucaFormStructure(form, log);
    const TARIH_ILK = parseAylikDonemBaslangic(job.donem);
    const TARIH_SON = parseAylikDonemBitis(job.donem);
    if (!TARIH_ILK || !TARIH_SON) throw new Error(`AYLIK tarih parse edilemedi: ${job.donem}`);

    // Helper — input'a native setter ile değer yaz + event'leri dispatch
    const setInput = (sel, value) => {
      const inp = form.querySelector(sel);
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(frm3win.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    };

    // ── DOĞRU SIRA (manuel kullanıcı gibi) ──
    // 7. ÖNCE Hesap Kodu (hesap planı state'i en kritik)
    await fillLucaHesapKodu(form, hesapKodu, log);
    await ensureDefteriKebirHesapSelection(form, hesapKodu, log);
    const cachedHesapIlk = getCachedLucaFormField(form, 'hesapIlk');
    const cachedHesapSon = getCachedLucaFormField(form, 'hesapSon');
    await log(`💼 Hesap alanları: ${describeLucaField(cachedHesapIlk)}/${describeLucaField(cachedHesapSon)}`);
    await sleep(400); // Luca onblur AJAX'i için
    // VERIFICATION — input gerçekten dolu mu, UI'da görünür mü?
    const hkIlkActual = form.querySelector('input[name="HESAPKODU_ILK"], input[name="hesap_bas"], input[name*="hesap" i][name*="bas" i], input[name*="hesap" i][name*="ilk" i]')?.value;
    const hkSonActual = form.querySelector('input[name="HESAPKODU_SON"], input[name="hesap_bit"], input[name*="hesap" i][name*="bit" i], input[name*="hesap" i][name*="son" i]')?.value;
    await log(`💼 Hesap kodu set sonrası: ILK="${hkIlkActual}" SON="${hkSonActual}"`);

    // 8. SONRA Tarih
    await clickLucaYenileButton(form, log);
    await sleep(1000);
    await fillLucaTarih(form, job, log);
    const cachedTarihIlk = getCachedLucaFormField(form, 'tarihIlk');
    const cachedTarihSon = getCachedLucaFormField(form, 'tarihSon');
    await log(`📅 Tarih alanları: ${describeLucaField(cachedTarihIlk)}/${describeLucaField(cachedTarihSon)}`);
    await sleep(400);
    const tIlkActual = form.querySelector('input[name="TARIH_ILK"], input[name="tarih_bas"], input[name*="tarih" i][name*="bas" i], input[name*="tarih" i][name*="ilk" i], input[name*="tar" i][name*="ilk" i]')?.value;
    const tSonActual = form.querySelector('input[name="TARIH_SON"], input[name="tarih_bit"], input[name*="tarih" i][name*="bit" i], input[name*="tarih" i][name*="son" i], input[name*="tar" i][name*="son" i]')?.value;
    await log(`📅 Tarih set sonrası: ILK="${tIlkActual}" SON="${tSonActual}"`);

    // 9. EN SON Rapor Türü = Excel (xlsx)
    await setRaporTuruExcel(form, log);

    // 10. XHR + fetch hook frm3'e (Luca jasper.jq POST'unu yakalamak için)
    installXhrHook(frm3win);
    installFetchHook(frm3win);
    installReportFormSubmitHook(frm3win);
    installNativeDownloadHook(frm3win);
    await log(`🔗 frm3 XHR+fetch+native-download hook kuruldu`);

    // 11. __lucaJobOverrides — XHR hook body inject etsin
    window.__lucaJobOverrides = {
      TARIH_ILK,
      TARIH_SON,
      HESAPKODU_ILK: hesapKodu,
      HESAPKODU_SON: hesapKodu,
      REPORT_TYPE: 'xlsx',
    };

    // 12. UZUN BEKLEME — Luca state'i sindirsin
    await sleep(2000);

    // 12.5. Hook'ları yeniden kur (form yüklenirken yeni frame oluşmuş olabilir)
    installXhrHookOnAllFrames();
    installXhrHook(frm3win);
    installFetchHook(frm3win);
    installReportFormSubmitHook(frm3win);
    installNativeDownloadHook(frm3win);
    await log(`🔗 Rapor öncesi hook'lar yeniden kuruldu`);

    // 13. Rapor butonu — GERÇEK USER CLICK simülasyonu (gonder() DEĞİL)
    // gonder() Luca'nın iç state'inden okuyor; gerçek click form input.value'ları
    // submit body'sine alıyor. Manuel kullanıcı davranışıyla aynı.
    const triggerRaporDirectFallback = await clickLucaRaporButtonStrict(form, log);
    await log('⏳ KDV Excel blob bekleniyor (max 60sn)');

    // 14. Blob yakala — iki yol: form intercept VEYA rapor_takip durum=150 → kendi rapor_indir fetch
    try {
      const blob = await waitForKdvBlob(log, frm3win, 60000, triggerRaporDirectFallback, () => fetchKdvFormDirect(form, log));
      return blob;
    } finally {
      delete window.__lucaJobOverrides;
      delete window.__morenRaporHazir;
    }
  }

  /**
   * KDV blob yakalama — form intercept VEYA rapor_takip durum=150 yakalandığında
   * agent kendi rapor_indir fetch'ini atar. Çünkü Luca rapor_indir'i bazen
   * <a download> veya window.open ile yapıyor → form intercept tutmuyor.
   */
  async function fetchKdvFormDirect(form, log) {
    try {
      const win = form.ownerDocument?.defaultView || window;
      const action = form.action || form.getAttribute?.('action') || '';
      if (!action) {
        await log('⚠ KDV direct form POST atlandı: form action yok');
        return null;
      }
      const params = new URLSearchParams();
      const fd = new FormData(form);
      for (const [k, v] of fd.entries()) params.append(k, String(v));
      const ov = window.__lucaJobOverrides || {};
      const setIfAny = (keys, value) => {
        if (value == null || value === '') return;
        let matched = false;
        const existingKeys = [...params.keys()];
        for (const key of keys) {
          for (const actualKey of existingKeys) {
            if (actualKey.toLowerCase() === key.toLowerCase()) {
              params.set(actualKey, String(value));
              matched = true;
            }
          }
        }
        if (!matched) params.set(keys[0], String(value));
      };
      setIfAny(['p_fis_tarihi_ilk_1', 'TARIH_ILK', 'tarih_ilk', 'tarih_bas'], ov.TARIH_ILK);
      setIfAny(['p_fis_tarihi_son_1', 'TARIH_SON', 'tarih_son', 'tarih_bit'], ov.TARIH_SON);
      setIfAny(['p_hesap_no_ilk_1', 'HESAPKODU_ILK', 'HESAP_ILK', 'hesap_bas'], ov.HESAPKODU_ILK);
      setIfAny(['p_hesap_no_son_1', 'HESAPKODU_SON', 'HESAP_SON', 'hesap_bit'], ov.HESAPKODU_SON);
      if (!params.has('ReportName')) params.set('ReportName', 'DEFTERI_KEBIR');
      for (const key of ['REPORT_TYPE', 'report_type', 'dosya_tipi', 'format']) {
        params.set(key, 'xlsx');
      }
      const method = String(form.method || 'POST').toUpperCase();
      const targetUrl = action.startsWith('http') ? action : new URL(action, win.location.href).href;
      await log(`🧪 KDV direct form POST deneniyor: ${targetUrl.split('/').pop().slice(0, 80)} (${params.toString().length} byte)`);
      const aborter = win.AbortController ? new win.AbortController() : null;
      const timeoutId = aborter ? win.setTimeout(() => aborter.abort(), 12000) : null;
      const res = await win.fetch(targetUrl, {
        method: method === 'GET' ? 'POST' : method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        ...(aborter ? { signal: aborter.signal } : {}),
      });
      if (timeoutId) win.clearTimeout(timeoutId);
      const ct = res.headers.get('content-type') || '';
      const arr = await res.arrayBuffer();
      const bytes = new Uint8Array(arr.slice(0, 8));
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const blob = new Blob([arr], { type: ct || 'application/octet-stream' });
      await log(`🧪 KDV direct form response: HTTP ${res.status}, ${Math.round(blob.size / 1024)} KB, ct=${ct.slice(0, 60)}, zip=${isZip}`);
      if (res.ok && blob.size > 1000 && (isZip || /xlsx|spreadsheet|excel|octet-stream|binary/i.test(ct))) return blob;
      try {
        const txt = new TextDecoder().decode(arr.slice(0, 600));
        await log(`⚠ KDV direct form küçük/boş yanıt: ${txt.slice(0, 180).replace(/\s+/g, ' ')}`);
      } catch {}
    } catch (e) {
      await log(`⚠ KDV direct form POST hata: ${String(e?.message || e).slice(0, 180)}`);
    }
    return null;
  }

  async function waitForKdvBlob(log, frm3win, maxMs, triggerRaporDirectFallback, directFormFallback) {
    const t0 = Date.now();
    let directFallbackTriggered = false;
    let directFormFallbackTriggered = false;
    window.__morenCapturedBlob = null;
    try { if (frm3win) frm3win.__morenCapturedBlob = null; } catch {}
    const postExpecting = (val) => {
      if (val && lucaManualDownloadMode()) return;
      const payload = { source: 'moren-agent', type: 'set-expecting', expecting: val };
      try { window.postMessage(payload, '*'); } catch {}
      try { if (window.top && window.top !== window) window.top.postMessage(payload, '*'); } catch {}
    };
    const acceptBridgeBlob = async (blob, label, ct = '', filename = '') => {
      try {
        if (!blob || blob.size <= 1000 || window.__morenCapturedBlob) return false;
        let isZip = false;
        try {
          const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
          isZip = head[0] === 0x50 && head[1] === 0x4b;
        } catch {}
        const meta = `${ct || blob.type || ''} ${filename || ''}`;
        if (!isZip && !/xlsx|xls|spreadsheet|excel|officedocument|octet-stream|binary/i.test(meta)) return false;
        window.__morenCapturedBlob = blob;
        try { if (frm3win) frm3win.__morenCapturedBlob = blob; } catch {}
        await log(`✅ KDV bridge blob alındı (${label}, ${Math.round(blob.size / 1024)} KB)`);
        return true;
      } catch {
        return false;
      }
    };
    const onBridgeMessage = async (event) => {
      try {
        const data = event.data;
        if (!data || data.source !== 'moren-bridge' || data.type !== 'lucaDownload') return;
        const dlUrl = data.url;
        if (!dlUrl || window.__morenCapturedBlob) return;
        await log(`🌉 KDV bridge download URL geldi: ${String(dlUrl).split('/').pop().slice(0, 80)}`);
        const r = await (frm3win?.fetch || fetch)(dlUrl, { credentials: 'include' });
        if (!r.ok) {
          await log(`⚠ KDV bridge URL HTTP ${r.status}`);
          return;
        }
        const blob = await r.blob();
        await acceptBridgeBlob(blob, 'bridge URL', r.headers.get('content-type') || '', dlUrl);
      } catch (e) {
        await log(`⚠ KDV bridge URL hata: ${String(e?.message || e).slice(0, 120)}`);
      }
    };
    const onLucaFile = async (e) => {
      try {
        const detail = e.detail || {};
        await acceptBridgeBlob(detail.blob, `disk ${String(detail.filename || '').split(/[\\\/]/).pop()}`, detail.blob?.type || '', detail.filename || '');
      } catch {}
    };
    postExpecting(true);
    window.addEventListener('message', onBridgeMessage);
    window.addEventListener('moren-luca-file', onLucaFile);
    try { if (frm3win && frm3win !== window) frm3win.addEventListener('moren-luca-file', onLucaFile); } catch {}
    await log('🔔 KDV bridge: native download bekleniyor');
    try {
    while (Date.now() - t0 < maxMs) {
      // Yol 1: form intercept blob yakaladı (Mizan tarzı)
      if (window.__morenCapturedBlob) {
        const b = window.__morenCapturedBlob;
        window.__morenCapturedBlob = null;
        await log(`✅ Blob (form intercept) alındı (${Math.round(b.size / 1024)} KB)`);
        return b;
      }
      // Yol 2: rapor_takip durum=150 → kendi rapor_indir fetch
      // ÜÇ varyant deniyoruz: JSON, form-encoded, GET — hangisi blob dönerse onu al
      if (window.__morenRaporHazir && window.__morenRaporHazir.durum === 150) {
        const rh = window.__morenRaporHazir;
        window.__morenRaporHazir = null;
        await log(`📥 rapor hazır — agent 3 varyant deniyor (JSON/form-encoded/GET)`);
        const indirUrl = rh.takipUrl.replace(/rapor_takip\.jq/i, 'rapor_indir.jq');

        // takipBody'yi parse et (params değerlerini extract için)
        let donemId = '', raporTur = '';
        try {
          const parsed = JSON.parse(rh.takipBody || '{}');
          donemId = parsed.donem_id || '';
          raporTur = parsed.params?.raporTur || '';
        } catch {}

        const tryFetch = async (label, opts, urlOverride) => {
          try {
            const targetUrl = urlOverride || indirUrl;
            const res = await frm3win.fetch(targetUrl, opts);
            const ct = res.headers.get('content-type') || '';
            if (res.ok) {
              // Önce text olarak oku (JSON ise içeriği görmek için)
              const text = await res.clone().text();
              const sz = text.length;
              if (/xlsx|spreadsheet|excel|octet-stream/i.test(ct) || (sz > 5000 && !/json|html/i.test(ct))) {
                const blob = await res.blob();
                await log(`📦 ${label}: ${Math.round(blob.size / 1024)} KB ct=${ct.slice(0, 40)} → BLOB`);
                return blob;
              }
              // JSON ise içeriği log'la (debug için kritik)
              await log(`📦 ${label}: ${Math.round(sz / 1024)} KB ct=${ct.slice(0, 40)} body=${text.slice(0, 250)}`);
              // JSON içinde URL/path var mı? Otomatik takip
              try {
                const json = JSON.parse(text);
                const possibleUrlFields = [
                  json.dosya_url, json.dosyaUrl, json.url, json.fileUrl, json.file_url,
                  json.download_url, json.downloadUrl, json.path, json.filePath, json.file_path,
                  json.indirme_url, json.indirmeUrl,
                  json.data?.dosya_url, json.data?.url, json.data?.path,
                  json.dosyaAdi, json.dosya_adi, json.fileName, json.file_name,
                ];
                const downloadUrl = possibleUrlFields.find(u => u && typeof u === 'string');
                const fileId = json.dosya_id || json.dosyaId || json.file_id || json.fileId || json.id;
                if (downloadUrl) {
                  const fullUrl = downloadUrl.startsWith('http') ? downloadUrl :
                    new URL(downloadUrl, indirUrl).href;
                  await log(`🔗 ${label} JSON içinde URL bulundu: ${downloadUrl.slice(0, 80)} → fetch...`);
                  const followRes = await frm3win.fetch(fullUrl, { method: 'GET', credentials: 'include' });
                  if (followRes.ok) {
                    const fct = followRes.headers.get('content-type') || '';
                    const followBlob = await followRes.blob();
                    await log(`📦 follow: ${Math.round(followBlob.size / 1024)} KB ct=${fct.slice(0, 40)}`);
                    if (followBlob.size > 1000) return followBlob;
                  }
                }
                if (fileId) {
                  await log(`🔗 ${label} JSON içinde fileId=${fileId} — alternatif endpoint deneniyor`);
                }
              } catch (e) {}
            } else {
              await log(`⚠ ${label}: HTTP ${res.status}`);
            }
          } catch (e) {
            await log(`⚠ ${label} hata: ${e?.message || e}`);
          }
          return null;
        };

        // Varyant 1: form-encoded (Mizan tarzı)
        const formParams = new URLSearchParams();
        if (donemId) formParams.set('donem_id', donemId);
        if (raporTur) formParams.set('raporTur', raporTur);
        formParams.set('dosya_tipi', 'xlsx');
        const blob1 = await tryFetch('form-encoded', {
          method: 'POST',
          credentials: 'include',
          body: formParams.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (blob1) return blob1;

        // Varyant 2: JSON (orijinal takipBody)
        const blob2 = await tryFetch('JSON', {
          method: 'POST',
          credentials: 'include',
          body: rh.takipBody || '{}',
          headers: { 'Content-Type': 'application/json' },
        });
        if (blob2) return blob2;

        // Varyant 3: GET
        const getUrl = indirUrl + (indirUrl.includes('?') ? '&' : '?') +
          `donem_id=${donemId}&raporTur=${raporTur}&dosya_tipi=xlsx`;
        const blob3 = await tryFetch('GET', {
          method: 'GET',
          credentials: 'include',
        }, getUrl);
        if (blob3) return blob3;

        await log(`⚠ 3 varyant da blob dönmedi — form intercept beklemeye devam`);
      }
      if (!directFallbackTriggered && typeof triggerRaporDirectFallback === 'function' && Date.now() - t0 > 7000) {
        directFallbackTriggered = true;
        await log('⏱ Native click sonrası blob gelmedi; tek seferlik Rapor onclick fallback deneniyor');
        await triggerRaporDirectFallback();
      }
      if (!directFormFallbackTriggered && typeof directFormFallback === 'function' && Date.now() - t0 > 15000) {
        directFormFallbackTriggered = true;
        await log('⏱ Rapor trafiği hâlâ yok; ID ile doldurulmuş form doğrudan POST ediliyor');
        directFormFallback()
          .then((directBlob) => {
            if (directBlob && !window.__morenCapturedBlob) window.__morenCapturedBlob = directBlob;
          })
          .catch((e) => log(`âš  KDV direct form async hata: ${e?.message || e}`).catch(() => {}));
      }
      await sleep(300);
    }
    } finally {
      try { window.removeEventListener('message', onBridgeMessage); } catch {}
      try { window.removeEventListener('moren-luca-file', onLucaFile); } catch {}
      try { if (frm3win && frm3win !== window) frm3win.removeEventListener('moren-luca-file', onLucaFile); } catch {}
      postExpecting(false);
    }
    try {
      const recent = (window.__morenLogs || [])
        .filter((line) => /XHR|FETCH|RAPOR|NATIVE|CREATE-OBJ|FORM-SUBMIT|jasper|rapor|Defter/i.test(String(line || '')))
        .filter((line) => !/mali-musavir-app.*\/api\/v1\/agent\//i.test(String(line || '')))
        .slice(-30);
      for (const line of recent) await log(`🔬 KDV debug: ${String(line).slice(0, 500)}`);
    } catch {}
    throw new Error('Excel blob 60sn içinde yakalanamadı (ne form intercept ne rapor_takip)');
  }

  async function fetchLucaIsletmeGelirGiderExcel(job, log, mode) {
    if (location.hostname.includes('agiris.luca') || location.pathname.includes('LUCASSO')) {
      throw new Error('Bu Luca v2.1 sürümü; klasik Luca kullanın.');
    }

    job = { ...job, donemTipi: 'AYLIK' };
    await log(`📊 İşletme akışı başlıyor — mode=${mode} (${mode === 'gelir' ? 'Satış' : 'Alış'})`);

    // 1) Firma değiştir
    await ensureLucaFirma(job, log);

    // 2) İşletme Defteri → Gider İşlemleri → Gider Listesi (yeni helper)
    await navigateToIsletmeGiderListesi(log);

    // 3) Sağ menüde "Gelir/Gider Listesi" tıkla → form yüklenir
    let form = findLucaGelirGiderRaporFormNow();
    if (form) {
      await log('Isletme Gelir/Gider formu zaten yuklu; sag menu tiklamasi atlandi');
    } else {
      await clickLucaRightMenu('Gelir/Gider Listesi', log, {
        nth: 1,
        maxMs: 60000,
        afterClickReady: () => !!findLucaGelirGiderRaporFormNow(),
      });
    }

    // 4) Form yüklensin
    form = form || await waitForLucaGelirGiderRaporForm(log, 60000);
    const frm3doc = form.ownerDocument;
    const frm3win = frm3doc.defaultView;

    // 5) Form yapısını dump et (debug — gerçek alan isimleri için)
    await dumpLucaFormStructure(form, log);
    await sleep(800);

    // 6) Tarih (AYLIK) — birden fazla muhtemel selector dene
    const TARIH_ILK = parseAylikDonemBaslangic(job.donem);
    const TARIH_SON = parseAylikDonemBitis(job.donem);
    if (!TARIH_ILK || !TARIH_SON) throw new Error(`AYLIK tarih parse edilemedi: ${job.donem}`);
    await log(`📅 Tarih: ${TARIH_ILK} → ${TARIH_SON}`);

    // Tarih input — KESIN id (FORM_DUMP'tan): #TARIH_ILK, #TARIH_SON
    const setDateInput = (sel, value) => {
      const inp = form.querySelector(sel);
      if (!inp) return false;
      // Focus → değer set → input/change/blur (Luca calendar widget'i için)
      try { inp.focus(); } catch(e){}
      const setter = Object.getOwnPropertyDescriptor(frm3win.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new Event('keyup', { bubbles: true }));
      inp.dispatchEvent(new Event('blur', { bubbles: true }));
      try { inp.blur(); } catch(e){}
      return inp.value === value;
    };
    const ilkOk = setDateInput('#TARIH_ILK', TARIH_ILK);
    const sonOk = setDateInput('#TARIH_SON', TARIH_SON);
    await log(`📅 Tarih set: TARIH_ILK=${TARIH_ILK} (ok=${ilkOk}) | TARIH_SON=${TARIH_SON} (ok=${sonOk})`);
    await sleep(300);

    // 7) ⚠ KRİTİK: Bölüm seçimi VISIBLE checkbox değil HIDDEN GELIR1/GIDER1 ile kontrol ediliyor!
    //    EMPIRICAL (v1.75 testi):
    //      agent set GELIR1=0, GIDER1=1 → Excel: SADECE GELİR
    //    Sonuç: GELIR1=0 ya da GIDER1=0 = "sadece o bölümü göster"
    //           (1,1) default = her iki bölümü göster
    //
    //    Doğru mantık:
    //      ISLETME_GELIR → GELIR1='0', GIDER1='1' → Excel: SADECE GELİRLER
    //      ISLETME_GIDER → GIDER1='0', GELIR1='1' → Excel: SADECE GİDERLER
    {
      const isGelir = mode === 'gelir';
      const isBoth = mode === 'both';  // IHO_FETCH için: gelir+gider birlikte
      const gelirCb = form.querySelector('#gelir, input[name="gelir"][type="checkbox"]');
      const giderCb = form.querySelector('#gider, input[name="gider"][type="checkbox"]');
      const gelir1 = form.querySelector('#GELIR1, input[name="GELIR1"]');
      const gider1 = form.querySelector('#GIDER1, input[name="GIDER1"]');

      if (isBoth) {
        // BOTH: GELIR1=1, GIDER1=1 (default — her iki bölümü göster) — IHO için
        if (gelir1) gelir1.value = '1';
        if (gider1) gider1.value = '1';
        await log(`🚩 Hidden flag set: GELIR1=1 | GIDER1=1 — hedef: GELİR+GİDER (IHO)`);
      } else {
        // Visible checkbox'lara dokunmayalım — Luca'nın onclick handler'ı GELIR1/GIDER1'i resetleyebilir.
        // Sadece HIDDEN flag'leri override et.
        if (gelir1) gelir1.value = isGelir ? '0' : '1';   // GELIR mode → GELIR1='0' (only GELIR)
        if (gider1) gider1.value = !isGelir ? '0' : '1';  // GIDER mode → GIDER1='0' (only GIDER)
        await log(`🚩 Hidden flag set: GELIR1=${gelir1?.value} | GIDER1=${gider1?.value} — hedef: ${isGelir ? 'GELİRLER' : 'GİDERLER'}`);
      }
    }
    await sleep(200);

    // 8) Rapor Türü Excel
    await setRaporTuruExcel(form, log);
    await sleep(500);

    // 9) Hook'lar + override
    // v1.36.22: Top window'a + tüm frame'lere hook kur (URL.createObjectURL özellikle)
    installXhrHook(frm3win);
    installFetchHook(frm3win);
    installReportFormSubmitHook(frm3win);
    installNativeDownloadHook(frm3win);
    // YENİ: top window ve tüm visible frame'lere de URL.createObjectURL hook
    try {
      installNativeDownloadHook(window);
      installNativeDownloadHook(window.top);
      installReportFormSubmitHook(window);
      installReportFormSubmitHook(window.top);
      const allFrames = [...document.querySelectorAll('frame, iframe')];
      for (const f of allFrames) {
        try {
          if (f.contentWindow) {
            installReportFormSubmitHook(f.contentWindow);
            installNativeDownloadHook(f.contentWindow);
          }
        } catch {}
      }
    } catch {}
    await log(`🔗 Hook'lar kuruldu (frm3 + top + ${document.querySelectorAll('frame,iframe').length} frame)`);

    window.__lucaJobOverrides = {
      TARIH_ILK,
      TARIH_SON,
      REPORT_TYPE: 'xlsx',
      // İşletme için ek parametre — backend hangi mode kullanılacak
      isletme_mode: mode,
      // Hidden flag override (Luca submit'inde kullanır)
      GELIR1: mode === 'gelir' ? '0' : '1',
      GIDER1: mode === 'gider' ? '0' : '1',
    };

    // 10) Rapor butonu — gerçek user click
    await sleep(500);

    // ⚠ Hidden GELIR1/GIDER1 flag'lerini Rapor click'inden HEMEN ÖNCE bir kez daha override et
    //   (Luca araya girip default'a resetlemiş olabilir)
    {
      const isGelirMode = mode === 'gelir';
      const isBothMode = mode === 'both';
      const g1 = form.querySelector('#GELIR1, input[name="GELIR1"]');
      const g2 = form.querySelector('#GIDER1, input[name="GIDER1"]');
      if (isBothMode) {
        if (g1) g1.value = '1';
        if (g2) g2.value = '1';
      } else {
        if (g1) g1.value = isGelirMode ? '0' : '1';
        if (g2) g2.value = !isGelirMode ? '0' : '1';
      }
      await log(`🚩 Rapor öncesi son set: GELIR1=${g1?.value} | GIDER1=${g2?.value}`);
    }

    // 11) Rapor butonu + blob yakala.
    // Mizan click-intercept ismine rağmen genel form.submit/window.open/download
    // yakalayıcısıdır. İHÖ'de Luca bazen rapor_takip XHR göstermeden rapor_indir
    // form submit'e düştüğü için zayıf KDV bekleyicisi timeout veriyordu.
    try {
      return await fetchMizanByClickIntercept(form, job, log);
    } finally {
      delete window.__lucaJobOverrides;
      delete window.__morenRaporHazir;
    }
  }

  /**
   * İşletme Gelir/Gider formunda "Sadece Gelir" / "Sadece Gider" seçimi.
   * Form yapısı bilinmediği için MULTI-STRATEJİ:
   *   1) radio[name=...][value=GELIR/GIDER]
   *   2) checkbox[name*=gelir/gider] (sadece istediği işaretli kalır)
   *   3) select[name*=tip] → option text "Sadece Gelir"/"Sadece Gider"
   * Hangisi tutarsa onunla devam eder, log'a yazar.
   */
  async function fillLucaIsletmeGelirGiderSecim(form, mode, log) {
    const win = form.ownerDocument.defaultView;
    const isGelir = mode === 'gelir';
    const targetText = isGelir ? 'sadece gelir' : 'sadece gider';
    const targetUpper = isGelir ? 'GELIR' : 'GIDER';

    // Strateji 1: radio button — value veya yakındaki label "Sadece Gelir/Gider"
    const radios = [...form.querySelectorAll('input[type=radio]')];
    for (const r of radios) {
      const v = (r.value || '').toLowerCase();
      const labelText = (r.closest('tr')?.textContent || r.parentElement?.textContent || '').toLowerCase();
      const combined = v + ' ' + labelText;
      if (isGelir && /sadece\s*gelir|^gelir$|gelir_only/.test(combined) && !/gider/.test(v)) {
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        r.dispatchEvent(new Event('click', { bubbles: true }));
        await log(`🟢 Radio: "Sadece Gelir" seçildi (name=${r.name}, value=${r.value})`);
        return true;
      }
      if (!isGelir && /sadece\s*gider|^gider$|gider_only/.test(combined) && !/gelir/.test(v)) {
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        r.dispatchEvent(new Event('click', { bubbles: true }));
        await log(`🔴 Radio: "Sadece Gider" seçildi (name=${r.name}, value=${r.value})`);
        return true;
      }
    }

    // Strateji 2: select dropdown — option text "Sadece Gelir"/"Sadece Gider"
    const selects = [...form.querySelectorAll('select')];
    for (const sel of selects) {
      for (const opt of sel.options) {
        const t = (opt.text || '').toLowerCase().trim();
        if (t.includes(targetText)) {
          const setter = Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, opt.value);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await log(`📋 Select: "${opt.text}" seçildi (select#${sel.name || sel.id})`);
          return true;
        }
      }
    }

    // Strateji 3: checkbox — sadece istediği işaretli kalır
    const checkboxes = [...form.querySelectorAll('input[type=checkbox]')];
    let gelirCb = null, giderCb = null;
    for (const cb of checkboxes) {
      const key = ((cb.name || '') + ' ' + (cb.id || '') + ' ' + (cb.value || '')).toLowerCase();
      const label = (cb.closest('tr')?.textContent || cb.parentElement?.textContent || '').toLowerCase();
      const combined = key + ' ' + label;
      if (/gelir/.test(combined) && !gelirCb) gelirCb = cb;
      if (/gider/.test(combined) && !giderCb) giderCb = cb;
    }
    const setCb = (cb, want) => {
      if (!cb) return;
      if (cb.checked !== want) {
        cb.checked = want;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('click', { bubbles: true }));
      }
    };
    if (isGelir) {
      setCb(gelirCb, true);
      setCb(giderCb, false);
      await log(`🟢 Checkbox: Gelir=ON, Gider=OFF (gelir#${gelirCb?.name || '?'} gider#${giderCb?.name || '?'})`);
    } else {
      setCb(gelirCb, false);
      setCb(giderCb, true);
      await log(`🔴 Checkbox: Gelir=OFF, Gider=ON (gelir#${gelirCb?.name || '?'} gider#${giderCb?.name || '?'})`);
    }
    if (gelirCb || giderCb) return true;

    // Hiçbir strateji tutmadıysa diagnostic
    const diag = {
      radios: radios.length,
      selects: selects.length,
      checkboxes: checkboxes.length,
      radioValues: radios.map(r => `${r.name}=${r.value}`).slice(0, 10).join(' | '),
      selectNames: selects.map(s => s.name || s.id).slice(0, 10).join(' | '),
      checkboxNames: checkboxes.map(c => c.name || c.id).slice(0, 10).join(' | '),
    };
    await log(`⚠ Sadece Gelir/Gider seçimi yapılamadı. Form: ${JSON.stringify(diag)}`);
    return false;
  }

  /**
   * Form intercept tarafından set edilen window.__capturedBlob'u bekle.
   * Mizan'daki form.submit intercept zaten bunu populate ediyor.
   */
  async function waitForCapturedBlob(log, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (window.__morenCapturedBlob) {
        const b = window.__morenCapturedBlob;
        window.__morenCapturedBlob = null;
        await log(`✅ Blob alındı (${Math.round(b.size / 1024)} KB)`);
        return b;
      }
      await sleep(250);
    }
    throw new Error('Blob 30sn içinde yakalanamadı — Rapor butonu cevap vermedi olabilir');
  }

  // ─── LUCA TAM OTOMATİK YARDIMCILARI ───

  /**
   * "2026-03" → "01/03/2026" (AYLIK ay başlangıcı)
   * "2026-3"  → "01/03/2026"
   * "032026"  → "01/03/2026"
   */
  function parseAylikDonemBaslangic(donem) {
    if (!donem) return null;
    const s = String(donem).trim();
    // YENİ: IHO range format "YYYY-MM-DD_YYYY-MM-DD" → ilk tarihi DD/MM/YYYY ile döndür
    let r = s.match(/^(\d{4})-(\d{2})-(\d{2})_\d{4}-\d{2}-\d{2}$/);
    if (r) return `${r[3]}/${r[2]}/${r[1]}`;
    let yil, ay;
    let m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) { yil = m[1]; ay = m[2].padStart(2, '0'); }
    if (!yil) { m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) { ay = m[1].padStart(2, '0'); yil = m[2]; } }
    if (!yil) { m = s.match(/^(\d{2})(\d{4})$/); if (m) { ay = m[1]; yil = m[2]; } }
    if (!yil || !ay) return null;
    return `01/${ay}/${yil}`;
  }
  function parseAylikDonemBitis(donem) {
    if (!donem) return null;
    const s = String(donem).trim();
    // YENİ: IHO range format "YYYY-MM-DD_YYYY-MM-DD" → son tarihi DD/MM/YYYY ile döndür
    let r = s.match(/^\d{4}-\d{2}-\d{2}_(\d{4})-(\d{2})-(\d{2})$/);
    if (r) return `${r[3]}/${r[2]}/${r[1]}`;
    let yil, ay;
    let m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) { yil = m[1]; ay = m[2].padStart(2, '0'); }
    if (!yil) { m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) { ay = m[1].padStart(2, '0'); yil = m[2]; } }
    if (!yil) { m = s.match(/^(\d{2})(\d{4})$/); if (m) { ay = m[1]; yil = m[2]; } }
    if (!yil || !ay) return null;
    // Ayın son günü
    const lastDay = new Date(parseInt(yil), parseInt(ay), 0).getDate();
    return `${String(lastDay).padStart(2, '0')}/${ay}/${yil}`;
  }

  /** Bir frame referansını adıyla al. Luca bazı oturumlarda klasik ekranı iç içe frame açıyor. */
  function getLucaFrame(name) {
    const wanted = String(name || '');
    const seenDocs = new Set();
    const scan = (doc, depth = 0) => {
      if (!doc || depth > 7 || seenDocs.has(doc)) return null;
      seenDocs.add(doc);
      let frames = [];
      try { frames = [...doc.querySelectorAll('frame, iframe')]; } catch { return null; }
      for (const f of frames) {
        const fname = String(f.name || f.id || f.getAttribute?.('name') || f.getAttribute?.('id') || '');
        if (fname === wanted) return f;
      }
      for (const f of frames) {
        try {
          const found = scan(f.contentDocument, depth + 1);
          if (found) return found;
        } catch {}
      }
      return null;
    };
    return scan(document);
  }

  function getLucaFirmaCombo() {
    try {
      const direct = getLucaFrame('frm4')?.contentDocument?.getElementById('SirketCombo');
      if (direct) return direct;
    } catch {}
    const seenDocs = new Set();
    const scan = (doc, depth = 0) => {
      if (!doc || depth > 7 || seenDocs.has(doc)) return null;
      seenDocs.add(doc);
      try {
        const combo = doc.getElementById('SirketCombo') || doc.querySelector('select[name="SirketCombo"]');
        if (combo) return combo;
        for (const f of doc.querySelectorAll('frame, iframe')) {
          const found = scan(f.contentDocument, depth + 1);
          if (found) return found;
        }
      } catch {}
      return null;
    };
    return scan(document);
  }

  function describeClassicLucaDomBrief() {
    const seenDocs = new Set();
    const frames = [];
    let comboFound = false;
    const scan = (doc, depth = 0) => {
      if (!doc || depth > 5 || seenDocs.has(doc)) return;
      seenDocs.add(doc);
      try {
        if (doc.getElementById('SirketCombo') || doc.querySelector('select[name="SirketCombo"]')) comboFound = true;
        for (const f of doc.querySelectorAll('frame, iframe')) {
          const name = String(f.name || f.id || f.getAttribute?.('name') || f.getAttribute?.('id') || '(isimsiz)');
          const src = String(f.src || '').split('/').pop().slice(0, 35);
          frames.push(`${'>'.repeat(depth)}${name}${src ? `@${src}` : ''}`);
          try { scan(f.contentDocument, depth + 1); } catch {}
        }
      } catch {}
    };
    try { scan(document); } catch {}
    const bodyLen = (() => {
      try { return String(document.body?.textContent || '').replace(/\s+/g, ' ').trim().length; } catch { return 0; }
    })();
    return `combo=${comboFound ? 'var' : 'yok'}; frames=${frames.slice(0, 12).join('|') || 'yok'}; body=${bodyLen}`;
  }

  function isClassicLucaFrameShellReady() {
    const required = ['frm1', 'frm2', 'frm3', 'frm4'];
    return required.every((name) => !!getLucaFrame(name));
  }

  async function waitForClassicLucaReady(maxMs = 25000, opts = {}) {
    const started = Date.now();
    // Daha sık polling (150ms) — frame yüklenmesini erken yakala.
    // Eski 300ms ile Luca'nın seçenekler async yüklemesi ile race condition
    // oluyor ve frame ready olduğu halde "yok" diye dönüyordu.
    while (Date.now() - started < maxMs) {
      const combo = getLucaFirmaCombo();
      if (combo && combo.options && combo.options.length > 0) return combo;
      if (opts?.allowShellReady && isClassicLucaFrameShellReady()) {
        await sleep(500);
        if (isClassicLucaFrameShellReady()) return { shellReady: true };
      }
      await sleep(150);
    }
    // Timeout sonrası son bir kontrol — race condition fix.
    // Frame son anda yüklenmiş olabilir, ama polling kaçırmıştır.
    const finalCheck = getLucaFirmaCombo();
    if (finalCheck && finalCheck.options && finalCheck.options.length > 0) {
      return finalCheck;
    }
    if (opts?.allowShellReady && isClassicLucaFrameShellReady()) {
      return { shellReady: true };
    }
    return null;
  }

  /** Bir koşul sağlanana kadar bekle (max ms) */
  const CLASSIC_LUCA_REPAIR_KEY = '__morenClassicLucaRepairState';
  const CLASSIC_LUCA_GIRIS_BLANK_KEY = '__morenClassicLucaGirisBlankState';

  function readClassicLucaRepairState() {
    try {
      const raw = sessionStorage.getItem(CLASSIC_LUCA_REPAIR_KEY);
      const state = raw ? JSON.parse(raw) : {};
      if (!state.lastSeenAt || Date.now() - Number(state.lastSeenAt) > 2 * 60 * 1000) {
        return { count: 0, lastSeenAt: 0, lastActionAt: 0, lastAction: '' };
      }
      return {
        count: Number(state.count || 0),
        lastSeenAt: Number(state.lastSeenAt || 0),
        lastActionAt: Number(state.lastActionAt || 0),
        lastAction: String(state.lastAction || ''),
      };
    } catch {
      return { count: 0, lastSeenAt: 0, lastActionAt: 0, lastAction: '' };
    }
  }

  function writeClassicLucaRepairState(state) {
    try { sessionStorage.setItem(CLASSIC_LUCA_REPAIR_KEY, JSON.stringify(state)); } catch {}
  }

  function readClassicLucaGirisBlankState() {
    try {
      const raw = sessionStorage.getItem(CLASSIC_LUCA_GIRIS_BLANK_KEY)
        || localStorage.getItem(CLASSIC_LUCA_GIRIS_BLANK_KEY);
      const state = raw ? JSON.parse(raw) : {};
      if (!state.lastSeenAt || Date.now() - Number(state.lastSeenAt) > 2 * 60 * 1000) {
        return { count: 0, lastSeenAt: 0, lastActionAt: 0 };
      }
      return {
        count: Number(state.count || 0),
        lastSeenAt: Number(state.lastSeenAt || 0),
        lastActionAt: Number(state.lastActionAt || 0),
      };
    } catch {
      return { count: 0, lastSeenAt: 0, lastActionAt: 0 };
    }
  }

  function writeClassicLucaGirisBlankState(state) {
    const serialized = JSON.stringify(state);
    try { sessionStorage.setItem(CLASSIC_LUCA_GIRIS_BLANK_KEY, serialized); } catch {}
    try { localStorage.setItem(CLASSIC_LUCA_GIRIS_BLANK_KEY, serialized); } catch {}
  }

  function noteClassicLucaGirisBlank() {
    const prev = readClassicLucaGirisBlankState();
    const state = {
      count: Number(prev.count || 0) + 1,
      lastSeenAt: Date.now(),
      lastActionAt: Date.now(),
    };
    writeClassicLucaGirisBlankState(state);
    return state;
  }

  function resetClassicLucaGirisBlankState() {
    try { sessionStorage.removeItem(CLASSIC_LUCA_GIRIS_BLANK_KEY); } catch {}
    try { localStorage.removeItem(CLASSIC_LUCA_GIRIS_BLANK_KEY); } catch {}
  }

  function noteClassicLucaNotReady() {
    const prev = readClassicLucaRepairState();
    const state = {
      ...prev,
      count: Number(prev.count || 0) + 1,
      lastSeenAt: Date.now(),
    };
    writeClassicLucaRepairState(state);
    return state;
  }

  function markClassicLucaRepairAction(action) {
    const state = {
      ...readClassicLucaRepairState(),
      lastActionAt: Date.now(),
      lastAction: action,
    };
    writeClassicLucaRepairState(state);
    return state;
  }

  function resetClassicLucaRepairState() {
    try { sessionStorage.removeItem(CLASSIC_LUCA_REPAIR_KEY); } catch {}
  }

  function classicLucaRepairRecentlyActed(state, minMs) {
    return !!state?.lastActionAt && Date.now() - Number(state.lastActionAt) < minMs;
  }

  function shouldReturnClassicLucaToSso(state) {
    const path = String(location.pathname || '');
    if (!/\/Luca\/(?:luca|giris)\.do/i.test(path)) return false;
    const frameCount = document.querySelectorAll('frame, iframe').length;
    const hasFrm4 = !!getLucaFrame('frm4');
    const bodyLen = String(document.body?.textContent || '').replace(/\s+/g, ' ').trim().length;
    return Number(state?.count || 0) >= 2 || (!hasFrm4 && frameCount === 0) || (!hasFrm4 && bodyLen < 250);
  }

  async function waitUntil(predicate, maxMs = 10000, intervalMs = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const r = await predicate();
        if (r) return r;
      } catch {}
      await sleep(intervalMs);
    }
    return null;
  }

  /**
   * Luca'da hedef firma açık değilse SirketCombo'yu değiştirip sayfa
   * yenilenmesini bekler. Eşleştirme önceliği:
   *   1) job.taxNumber (VKN/TCKN) — option text içinde geçiyorsa kesin eşleşme
   *   2) job.lucaSlug — Luca'daki firma adının normalize hali (örn. "OZ ELA TUR")
   *   3) job.mukellefAdi — son çare: tam mükellef adı substring eşleşme
   */
  /**
   * Returns: { changed: boolean, alreadyCorrect: boolean, skipped: boolean }
   *   - changed = true        → firma gerçekten YGS→ÖZ ELA gibi değişti, formlar STALE
   *   - alreadyCorrect = true → firma zaten doğru, hiçbir şey yapılmadı
   *   - skipped = true        → kontrol edilemedi (slug/tax/ad yok ya da DOM eksik)
   */
  async function ensureLucaFirma(job, log) {
    const candidates = [job.taxNumber, job.lucaSlug, job.mukellefAdi].filter(Boolean);
    if (candidates.length === 0) {
      await log('ℹ️ Mükellef için lucaSlug/taxNumber/ad yok — firma kontrolü atlanıyor');
      return { changed: false, alreadyCorrect: false, skipped: true };
    }
    let frm4 = getLucaFrame('frm4');
    if (!frm4 || !frm4.contentDocument) {
      await log('Klasik Luca firma ekranı henüz hazır değil; frm4 bekleniyor');
      const combo = await waitForClassicLucaReady(15000);
      if (!combo) throw new Error('frm4 (firma seçici) bulunamadı');
      frm4 = getLucaFrame('frm4');
    }
    const combo = getLucaFirmaCombo();
    if (!combo) {
      await log('⚠ SirketCombo bulunamadı, firma kontrolü atlanıyor');
      return { changed: false, alreadyCorrect: false, skipped: true };
    }
    const currentText = (combo.selectedOptions[0]?.text || '').trim();

    // ASCII-fold + slug — TR karakter ve boşluk/alt çizgi farklarını sıfırlar.
    // "OZ ELA TURİZM TAŞIMACILIK İNŞAAT TİCARET" → "oz_ela_turizm_tasimacilik_insaat_ticaret"
    // "oz_ela_turizm_tasimacilik_insaat_ticaret"  → "oz_ela_turizm_tasimacilik_insaat_ticaret"
    const slugify = (s) => String(s || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/[ıİ]/g, 'i')
      .replace(/[şŞ]/g, 's')
      .replace(/[çÇ]/g, 'c')
      .replace(/[ğĞ]/g, 'g')
      .replace(/[üÜ]/g, 'u')
      .replace(/[öÖ]/g, 'o')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    // Geçerli option mu? — boş, separator (--, ===), <option value=""> hariç
    const isRealOption = (opt) => {
      const v = String(opt.value || '').trim();
      const t = String(opt.text || '').trim();
      if (!v || !t) return false;
      if (t.length < 3) return false;
      if (/^[-=_•·\s]+$/.test(t)) return false; // separator
      return true;
    };

    // Mevcut açık firma istenen mükellef mi?
    const currentSlug = slugify(currentText);
    for (const c of candidates) {
      const cSlug = slugify(c);
      if (!cSlug) continue;
      // VKN ise tam string match (option text'inde geçiyor mu)
      if (/^\d{10,11}$/.test(String(c)) && currentText.includes(String(c))) {
        await log(`✓ Firma zaten doğru: ${currentText}`);
        return;
      }
      // İsim/slug ise: slug eşitliği ya da currentSlug, target slug'ı kapsıyor mu
      if (cSlug.length >= 6 && (currentSlug === cSlug || currentSlug.includes(cSlug) || cSlug.includes(currentSlug))) {
        await log(`✓ Firma zaten doğru: ${currentText}`);
        return { changed: false, alreadyCorrect: true, skipped: false };
      }
    }

    // Hedef firma option'unu bul — taxNumber > lucaSlug > ad sırası
    let targetOpt = null;
    let matchedBy = '';

    // 1) VKN/TCKN tam match
    if (job.taxNumber) {
      const tn = String(job.taxNumber).replace(/\D/g, '');
      if (tn) {
        for (const opt of combo.options) {
          if (!isRealOption(opt)) continue;
          if (opt.text.includes(tn)) {
            targetOpt = opt; matchedBy = `VKN/TCKN ${tn}`; break;
          }
        }
      }
    }

    // 2) lucaSlug — ASCII-fold + slugify her iki tarafa
    if (!targetOpt && job.lucaSlug) {
      const wanted = slugify(job.lucaSlug);
      if (wanted.length >= 4) {
        // Önce tam eşitlik
        for (const opt of combo.options) {
          if (!isRealOption(opt)) continue;
          if (slugify(opt.text) === wanted) {
            targetOpt = opt; matchedBy = `lucaSlug eşitlik "${job.lucaSlug}"`; break;
          }
        }
        // Tam eşitlik yoksa "wanted, optSlug'ı kapsıyor" (ör. slug uzun versiyon, option kısaltılmış)
        if (!targetOpt) {
          for (const opt of combo.options) {
            if (!isRealOption(opt)) continue;
            const optSlug = slugify(opt.text);
            if (optSlug.length < 4) continue;
            if (wanted.includes(optSlug) || optSlug.includes(wanted)) {
              targetOpt = opt; matchedBy = `lucaSlug substring "${job.lucaSlug}"`; break;
            }
          }
        }
      }
    }

    // 3) Mükellef adı — token bazlı (en az 2 anlamlı token slugify edilmiş halde option slug'ında geçmeli)
    if (!targetOpt && job.mukellefAdi) {
      const wantedSlug = slugify(job.mukellefAdi);
      const tokens = wantedSlug.split('_').filter((w) => w.length >= 3).slice(0, 4);
      if (tokens.length >= 2) {
        for (const opt of combo.options) {
          if (!isRealOption(opt)) continue;
          const optSlug = slugify(opt.text);
          if (optSlug.length < 4) continue;
          const matches = tokens.filter((tok) => optSlug.includes(tok)).length;
          if (matches >= Math.min(tokens.length, 2)) {
            targetOpt = opt; matchedBy = `ad tokens "${tokens.join('+')}"`; break;
          }
        }
      }
    }

    // 4) v1.36.74: PREFIX BENZERLİĞİ — Luca kısa ad kullandığında uzun ad slug'ı ile
    //    substring uyumu kurulamıyor. Örn. portal "TALHA BOZOĞLU" → slug "talha_bozoglu",
    //    Luca dropdown'da "TALHA BOZG" → slug "talha_bozg". Ne tam eşit ne substring.
    //    Bu adım: ilk 6+ karakter aynıysa "kısaltılmış uzun ad" kabul et.
    if (!targetOpt) {
      const wanted = job.lucaSlug ? slugify(job.lucaSlug) : (job.mukellefAdi ? slugify(job.mukellefAdi) : '');
      if (wanted.length >= 6) {
        for (const opt of combo.options) {
          if (!isRealOption(opt)) continue;
          const optSlug = slugify(opt.text);
          if (optSlug.length < 6) continue;
          const minLen = Math.min(wanted.length, optSlug.length);
          const prefixLen = Math.min(8, Math.max(6, minLen - 2));
          if (wanted.slice(0, prefixLen) === optSlug.slice(0, prefixLen)) {
            targetOpt = opt; matchedBy = `prefix benzerliği "${wanted.slice(0, prefixLen)}…"`; break;
          }
        }
      }
    }

    // 5) v1.36.74: Tek token tam eşleşmesi — kısa ad sadece 1 anlamlı token taşıyabilir.
    //    Token uzunluğu ≥4 ve EŞSİZ ise (başka mükellef adında geçmiyorsa) eşleştir.
    if (!targetOpt && job.mukellefAdi) {
      const wantedSlug = slugify(job.mukellefAdi);
      const tokens = wantedSlug.split('_').filter((w) => w.length >= 4);
      if (tokens.length >= 1) {
        for (const tok of tokens) {
          const matchingOpts = [...combo.options].filter((opt) => isRealOption(opt) && slugify(opt.text).includes(tok));
          if (matchingOpts.length === 1) {
            targetOpt = matchingOpts[0]; matchedBy = `eşsiz token "${tok}"`; break;
          }
        }
      }
    }

    if (!targetOpt) {
      const realOpts = [...combo.options].filter(isRealOption);
      const sample = realOpts.slice(0, 8).map((o) => o.text.trim().slice(0, 50)).join(' | ');
      throw new Error(
        `Firma bulunamadı: VKN=${job.taxNumber || '?'} slug="${job.lucaSlug || '?'}" ad="${job.mukellefAdi || '?'}". ` +
        `Luca firma listesinde yok ya da yetkiniz yok. ` +
        `Toplam ${combo.options.length} option (${realOpts.length} geçerli). İlk geçerli 8: ${sample}. ` +
        `İPUCU: Mükellef profilinden Luca Slug alanına Luca'da gözüken kısa adı (örn. "talha_bozg") yazabilirsin.`,
      );
    }

    const targetText = targetOpt.text.trim();
    const targetValue = String(targetOpt.value || '').trim();
    if (!targetValue) {
      throw new Error(`Eşleşen option boş value taşıyor: "${targetText}". Luca DOM yapısı değişmiş olabilir.`);
    }

    const setComboToTarget = (selectEl, optionEl) => {
      try {
        const idx = [...selectEl.options].findIndex((opt) => String(opt.value || '').trim() === targetValue);
        if (idx >= 0) selectEl.selectedIndex = idx;
      } catch {}
      try { optionEl.selected = true; } catch {}
      try { selectEl.value = targetValue; } catch {}
      try { selectEl.setAttribute('value', targetValue); } catch {}
    };

    await log(`🔄 Firma değiştiriliyor (${matchedBy}): ${currentText || '∅'} → ${targetText}`);
    setComboToTarget(combo, targetOpt);

    // Luca'nın KENDI onchange handler'ını tetikle — synthetic event yetmiyor çünkü
    // Luca server-side session cookie'yi onchange'in yaptığı POST/redirect ile günceller.
    // 3 katmanlı tetikleme:
    //   a) Inline onchange="..." attribute'unu frm4 window context'inde çalıştır
    //   b) HTMLSelectElement.prototype.onchange property'si (jQuery bindings için)
    //   c) Synthetic change event (bubble) — kalan listener'lar için
    //   d) Eğer hiçbiri sirket değişikliğini server'a iletmezse: form submit fallback
    const frm4Win = frm4.contentWindow;
    let dispatchedNative = false;
    try {
      const onChangeAttr = combo.getAttribute('onchange');
      if (onChangeAttr && onChangeAttr.trim().length > 0) {
        await log(`🔧 Luca onchange="${onChangeAttr.slice(0, 80)}" çağrılıyor`);
        // frm4 window context'inde execute (frm4'teki global JS fonksiyonlara erişebilsin)
        try {
          // eslint-disable-next-line no-new-func
          const fn = new frm4Win.Function('event', onChangeAttr);
          fn.call(combo, new frm4Win.Event('change'));
          dispatchedNative = true;
        } catch (e) {
          await log(`⚠ onchange attr execute hatası: ${e?.message || e}`);
        }
      }
    } catch (e) { /* cross-origin? */ }

    // Property handler (jQuery .change(fn) bind'leri buraya gelir)
    try {
      if (typeof combo.onchange === 'function') {
        combo.onchange();
        dispatchedNative = true;
      }
    } catch (e) {}

    // Synthetic change event — yine de dispatch et (delegated listener'lar için)
    try {
      combo.dispatchEvent(new frm4Win.Event('change', { bubbles: true }));
    } catch (e) {
      combo.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Luca'nın onchange'i sadece UI hazırlığı yapıyor (loadDonem, showButton).
    // Asıl firma değişimi için showButton()'ın gösterdiği "Tamam/Seç/Onayla" butonuna
    // tıklanması gerek. v1.36.25: 800ms→300ms bekle (showButton DOM'a buton koymak için
    // genellikle 100-200ms yeterli, fazla bekleme = boş zaman).
    await sleep(300);

    let onayClicked = false;
    try {
      const frm4Doc = frm4.contentDocument;
      // Olası onay buton selector'ları:
      //   1. input[type=submit] / input[type=button] / button
      //   2. Text/value: Tamam, Seç, Onayla, Aç, Değiştir, Giriş
      //   3. ID/name: btnTamam, btnSec, btnOnay, sirketSec
      const candidates = [];
      const allButtons = frm4Doc.querySelectorAll('input[type=submit], input[type=button], button, a[onclick]');
      for (const b of allButtons) {
        // Görünür mü? (offsetParent !== null = visible)
        if (!b.offsetParent && b.tagName !== 'A') continue; // a tag offsetParent unstable
        const txt = ((b.value || '') + ' ' + (b.textContent || '') + ' ' + (b.id || '') + ' ' + (b.name || '') + ' ' + (b.getAttribute('onclick') || '')).toLocaleLowerCase('tr-TR');
        // Negatif eleme: kapat/iptal/çık olanları reddet
        if (/iptal|kapat|cancel|close|geri|exit|cikis/.test(txt)) continue;
        // Pozitif: tamam/seç/onay/değiştir/aç/giriş/sec/sirket
        if (/tamam|onay|sec|seç|değiştir|degistir|aç|ac|giriş|giris|sirket\s*sec|sirketsec|btnsec|btnonay|btntamam/.test(txt)) {
          candidates.push({ btn: b, score: 2, txt: txt.slice(0, 40) });
          continue;
        }
        // Fallback: SirketCombo'ya yakın (parent zinciri 5 seviye) bir buton
        let cur = b;
        for (let i = 0; i < 5 && cur; i++) {
          if (cur.contains(combo)) { candidates.push({ btn: b, score: 1, txt: txt.slice(0, 40) }); break; }
          cur = cur.parentElement;
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        const chosen = candidates[0];
        await log(`🔘 Onay butonu tıklanıyor (score=${chosen.score}): "${chosen.txt}"`);
        try {
          chosen.btn.click();
          chosen.btn.dispatchEvent(new frm4Win.MouseEvent('click', { bubbles: true, cancelable: true }));
          onayClicked = true;
        } catch (e) {
          await log(`⚠ Onay butonu tıklama hatası: ${e?.message || e}`);
        }
      } else {
        await log('ℹ️ Onay butonu bulunamadı — form submit fallback denenecek');
      }
    } catch (e) {
      await log(`⚠ Onay butonu arama hatası: ${e?.message || e}`);
    }

    // Hâlâ aktivasyon yapılmadıysa parent form submit fallback
    if (!onayClicked && !dispatchedNative) {
      const parentForm = combo.closest('form');
      if (parentForm) {
        await log(`🔧 Parent form submit ediliyor (${(parentForm.action || 'no-action').slice(-40)})`);
        try { parentForm.submit(); } catch (e) {}
      }
    }

    // Sayfa yenilenmesini bekle — frm4 reload edecek. Luca bazen firma değişimini
    // 10+ saniyede oturtuyor; erken fail etmek WASH CLEAN gibi işleri boşa düşürüyordu.
    await sleep(3500);

    // DOĞRULAMA: SirketCombo'da seçili option gerçekten hedef mi?
    // (frm4 reload sonrası DOM yeniden oluştuğu için tekrar fetch ediyoruz)
    let verified = false;
    let lastSelectedText = currentText;
    const verifySelection = async (maxMs) => {
      const verifyDeadline = Date.now() + maxMs;
      while (Date.now() < verifyDeadline) {
        const frm4Now = getLucaFrame('frm4');
        const comboNow = frm4Now?.contentDocument?.getElementById('SirketCombo');
        if (comboNow) {
          const selText = (comboNow.selectedOptions[0]?.text || '').trim();
          const selValue = String(comboNow.value || '').trim();
          const selSlug = slugify(selText);
          const tgtSlug = slugify(targetText);
          lastSelectedText = selText;
          if (
            (targetValue && selValue === targetValue) ||
            (selSlug && tgtSlug && (selSlug === tgtSlug || selSlug.includes(tgtSlug) || tgtSlug.includes(selSlug)))
          ) {
            return true;
          }
        }
        await sleep(300);
      }
      return false;
    };

    verified = await verifySelection(22000);
    if (!verified) {
      await log(`⚠ Firma değişimi ilk kontrolde doğrulanmadı (${lastSelectedText || 'boş'}); ikinci onay/fallback deneniyor`);
      try {
        const frm4Retry = getLucaFrame('frm4');
        const comboRetry = frm4Retry?.contentDocument?.getElementById('SirketCombo');
        const retryOpt = comboRetry
          ? [...comboRetry.options].find((opt) => String(opt.value || '').trim() === targetValue)
          : null;
        if (frm4Retry?.contentWindow && comboRetry && retryOpt) {
          const retryWin = frm4Retry.contentWindow;
          setComboToTarget(comboRetry, retryOpt);
          try {
            comboRetry.dispatchEvent(new retryWin.Event('input', { bubbles: true }));
            comboRetry.dispatchEvent(new retryWin.Event('change', { bubbles: true }));
          } catch {
            comboRetry.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const onChangeRetry = comboRetry.getAttribute('onchange');
          if (onChangeRetry && onChangeRetry.trim()) {
            try {
              const fn = new retryWin.Function('event', onChangeRetry);
              fn.call(comboRetry, new retryWin.Event('change'));
            } catch (e) {
              await log(`⚠ ikinci onchange hatası: ${e?.message || e}`);
            }
          }
          if (typeof retryWin.formsubmit === 'function') {
            await log('🔧 Luca formsubmit(event, 0) fallback çağrılıyor');
            try { retryWin.formsubmit(new retryWin.Event('click'), 0); } catch (e) {
              await log(`⚠ formsubmit fallback hatası: ${e?.message || e}`);
            }
          } else {
            const form = comboRetry.closest('form');
            if (form) {
              await log('🔧 Luca firma formu submit fallback ile gönderiliyor');
              try { form.submit(); } catch {}
            }
          }
        }
      } catch (e) {
        await log(`⚠ Firma fallback genel hata: ${e?.message || e}`);
      }
      await sleep(3500);
      verified = await verifySelection(22000);
    }
    if (!verified) {
      throw new Error(
        `Firma DEĞİŞMEDİ: hedef "${targetText}", hâlâ seçili olan "${lastSelectedText}". ` +
        `Luca change event'i kabul etmedi olabilir — manuel olarak Luca'da firma seçip tekrar dene.`,
      );
    }

    // v1.36.25: Menü wait 15s→5s. Ayrıca "Mizan" yerine herhangi bir menü item'i yeterli
    // (bazı firmalarda Mizan yok ama menü zaten hazır).
    await waitUntil(() => {
      const frm5 = getLucaFrame('frm5');
      if (!frm5 || !frm5.contentDocument) return false;
      const all = frm5.contentDocument.querySelectorAll('a, span, td, div');
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (el.children.length === 0 && t.length >= 4 && t.length <= 40 &&
            /^[A-Za-zÇĞİÖŞÜçğıöşü\s\/\-]+$/.test(t)) {
          return true; // herhangi bir menü-tipi text yeterli
        }
      }
      return false;
    }, 5000, 150);
    await log(`✓ Firma değişti → ${targetText}, menü hazır`);
    return { changed: true, alreadyCorrect: false, skipped: false };
  }

  /**
   * Sağ menüde "Mizan" element'ini bul — frm5 öncelikli, yoksa tüm frame'leri tara.
   * Sayfa yenilenmesinden sonra menü 1-2 saniye sürebilir; bu yüzden waitUntil ile
   * X saniye boyunca yeniden dene.
   */
  function normalizeLucaMenuText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0131/g, 'i')
      .replace(/\u0130/g, 'i')
      .replace(/\u00a0/g, ' ')
      .replace(/\s*\/\s*/g, '/')
      .replace(/[‐‑–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('tr-TR')
      .replace(/\u0131/g, 'i');
  }

  const LUCA_MENU_ID_CACHE_KEY = 'moren_luca_menu_id_cache_v1';

  function readLucaMenuIdCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LUCA_MENU_ID_CACHE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeLucaMenuIdCache(cache) {
    try { localStorage.setItem(LUCA_MENU_ID_CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function extractLucaMenuCode(value) {
    const text = String(value || '');
    const ii1a = text.match(/II1a\s*\(\s*(?:event\s*,\s*)?['"]([^'"]+)['"]/i);
    if (ii1a) return ii1a[1];
    const rightMenu = text.match(/lI1lI\s*\(\s*([^)]+)\)/);
    if (rightMenu) return `lI1lI(${rightMenu[1]})`;
    const direct = text.match(/apy1000m\d+i\d+I/i);
    return direct ? direct[0] : '';
  }

  function collectLucaWindows(rootWindow = window, depth = 0, acc = [], seen = new Set()) {
    if (depth > 6 || !rootWindow || seen.has(rootWindow)) return acc;
    seen.add(rootWindow);
    acc.push(rootWindow);
    try {
      for (let i = 0; i < (rootWindow.frames?.length || 0); i++) {
        try { collectLucaWindows(rootWindow.frames[i], depth + 1, acc, seen); } catch {}
      }
    } catch {}
    return acc;
  }

  function getLucaMenuTextForCache(el) {
    const text = String(el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return '';
    const tag = String(el?.tagName || '').toUpperCase();
    if (/^(HTML|HEAD|BODY|SCRIPT|STYLE|META|LINK|TITLE|OPTION|SELECT)$/.test(tag)) return '';
    return text;
  }

  function getLucaMenuCodeFromElement(el) {
    let cur = el;
    for (let i = 0; i < 7 && cur; i++, cur = cur.parentElement) {
      try {
        const code = extractLucaMenuCode([
          cur.getAttribute?.('onclick') || '',
          cur.getAttribute?.('href') || '',
          cur.getAttribute?.('id') || '',
          cur.getAttribute?.('name') || '',
        ].join(' '));
        if (code) {
          return {
            code,
            handlerEl: cur,
            source: cur.getAttribute?.('onclick') ? 'onclick' : cur.getAttribute?.('href') ? 'href' : 'id',
          };
        }
      } catch {}
    }
    return null;
  }

  function cacheLucaMenuHit(label, found) {
    try {
      const el = found?.el || found;
      const codeInfo = getLucaMenuCodeFromElement(el);
      if (!codeInfo?.code) return null;
      const key = normalizeLucaMenuText(label || getLucaMenuTextForCache(el));
      if (!key) return null;
      const cache = readLucaMenuIdCache();
      const prev = cache[key] || {};
      const entry = {
        label: String(label || getLucaMenuTextForCache(el)),
        code: codeInfo.code,
        frameName: found?.frameName || found?.frame?.name || '',
        source: codeInfo.source,
        hits: Number(prev.hits || 0) + 1,
        updatedAt: Date.now(),
      };
      cache[key] = entry;
      writeLucaMenuIdCache(cache);
      return entry;
    } catch {
      return null;
    }
  }

  function getCachedLucaMenuHit(label) {
    try {
      const key = normalizeLucaMenuText(label);
      const hit = readLucaMenuIdCache()[key];
      if (!hit?.code) return null;
      // Luca menu ID'leri stabil — bir kez keşfedildiyse kalıcı tutulur.
      // Eski sürüm 30 günde dropluyordu, ama bu "her ay otomatik bozulma"
      // davranışına yol açıyordu. Stale code afterClickReady doğrulamasında
      // yakalanıp deleteCachedLucaMenuHit ile düzeltiliyor.
      return hit;
    } catch {
      return null;
    }
  }

  function deleteCachedLucaMenuHit(label) {
    try {
      const key = normalizeLucaMenuText(label);
      if (!key) return;
      const cache = readLucaMenuIdCache();
      if (cache[key]) {
        delete cache[key];
        writeLucaMenuIdCache(cache);
      }
    } catch {}
  }

  function isDirectLucaMenuCodeUnsafe(label) {
    const key = normalizeLucaMenuText(label);
    return [
      'muhasebe',
      'isletme defteri',
      'fis islemleri',
      'gider islemleri',
      'gelir islemleri',
      'raporlar',
      'mizan',
      'rapor islemleri',
      'raporlar ve listeler',
      'listeler',
      'dokumler',
      'dokum islemleri',
    ].includes(key);
  }

  async function nativeLucaMenuHover(label, log, opts = {}) {
    try {
      let bridge = null;
      try { bridge = window.__morenNativeClickText; } catch {}
      if (!bridge) {
        try { bridge = window.top?.__morenNativeClickText; } catch {}
      }
      if (typeof bridge !== 'function') return false;
      const res = await bridge({
        text: label,
        exact: !!opts.exact,
        hoverOnly: opts.hoverOnly !== false,
        timeoutMs: opts.timeoutMs || 4500,
      });
      if (res?.ok) {
        if (log) await log(`Native hover menü: "${label}" (${res.frame || '?'})`);
        await sleep(opts.settleMs || 900);
        return true;
      }
      if (log) await log(`Native hover "${label}" bulunamadi: ${res?.reason || 'yok'}`);
    } catch (e) {
      if (log) await log(`Native hover "${label}" hata: ${String(e?.message || e).slice(0, 100)}`);
    }
    return false;
  }

  function cacheVisibleLucaMenuIds() {
    const cache = readLucaMenuIdCache();
    let count = 0;
    for (const win of collectLucaWindows()) {
      let frameName = '';
      try { frameName = win.frameElement?.name || win.name || ''; } catch {}
      let nodes = [];
      try { nodes = Array.from(win.document.querySelectorAll('[onclick],[href],[id]')); } catch { continue; }
      for (const el of nodes) {
        const codeInfo = getLucaMenuCodeFromElement(el);
        if (!codeInfo?.code) continue;
        const label = getLucaMenuTextForCache(el);
        if (!label) continue;
        const key = normalizeLucaMenuText(label);
        if (!key) continue;
        cache[key] = {
          label,
          code: codeInfo.code,
          frameName,
          source: codeInfo.source,
          hits: Number(cache[key]?.hits || 0),
          updatedAt: Date.now(),
        };
        count++;
      }
    }
    if (count > 0) writeLucaMenuIdCache(cache);
    return count;
  }

  async function callLucaMenuCode(label, code, log, settleMs = 800) {
    if (!code) return false;
    const fakeEvent = {
      type: 'click',
      target: null,
      currentTarget: null,
      srcElement: null,
      preventDefault: () => {},
      stopPropagation: () => {},
      stopImmediatePropagation: () => {},
      returnValue: true,
      cancelBubble: false,
    };
    const windows = collectLucaWindows();
    const preferred = [];
    for (const win of windows) {
      try {
        const nodes = Array.from(win.document.querySelectorAll('[onclick],[href],[id],[name]'));
        if (nodes.some((el) => getLucaMenuCodeFromElement(el)?.code === code)) preferred.push(win);
      } catch {}
    }
    const orderedWindows = [...preferred, ...windows.filter((win) => !preferred.includes(win))];
    for (const win of orderedWindows) {
      try {
        if (String(code).startsWith('lI1lI(')) {
          if (typeof win.lI1lI !== 'function') continue;
          if (log) await log(`⚡ "${label}" sağ menüsü ID ile açılıyor: ${code}`);
          const argsText = String(code).replace(/^lI1lI\(/, '').replace(/\)$/, '');
          const args = new win.Function(`return [${argsText}];`)();
          win.lI1lI(...args);
          await sleep(settleMs);
          return true;
        }
        if (typeof win.II1a !== 'function') continue;
        if (log) await log(`⚡ "${label}" menüsü ID ile açılıyor: ${code}`);
        try {
          win.II1a(fakeEvent, code, '');
        } catch {
          win.II1a(code);
        }
        await sleep(settleMs);
        return true;
      } catch {}
    }
    return false;
  }

  async function openCachedLucaMenu(label, log, settleMs = 800, opts = {}) {
    // Eskiden isDirectLucaMenuCodeUnsafe ile Mizan/Fiş İşlemleri gibi etiketler
    // tamamen blokeli idi. Bu, cache'lenmiş kod olsa bile DOM tıklamaya zorluyordu.
    // afterClickReady ile stale kod yakalanıp deleteCachedLucaMenuHit ile
    // temizlendiği için bloke etmek yerine deneyip doğrulamak daha güvenli.
    const cached = getCachedLucaMenuHit(label);
    if (!cached?.code) return false;
    const expectedCode = opts?.expectedCode ? String(opts.expectedCode) : '';
    if (expectedCode && String(cached.code) !== expectedCode) {
      if (log) await log(`ℹ "${label}" cache ID uyumsuz (${cached.code} != ${expectedCode}); metin kesfine dusulecek`);
      return false;
    }
    const opened = await callLucaMenuCode(cached.label || label, cached.code, log, settleMs);
    if (!opened && log) await log(`ℹ "${label}" için cache ID bulundu ama II1a hazır değil; metin keşfine düşülecek`);
    return opened;
  }

  try {
    window.__morenLucaMenuIdCache = () => readLucaMenuIdCache();
    window.__morenRefreshLucaMenuIdCache = () => cacheVisibleLucaMenuIds();
  } catch {}

  async function activateLucaMenuItem(label, found, log, settleMs = 800) {
    // === KURAL ===
    // Tıklama hedefleri öncelik sırasıyla denenir:
    //   A) Element'in onclick'inden çıkarılan veya kalıcı cache'teki Luca JS
    //      fonksiyonunu DOĞRUDAN çağır (lI1lI / II1a). DOM event zincirine,
    //      mouse pozisyonuna, hover zamanlamasına bağımlı değil — Luca'nın
    //      kendi fonksiyonunu çağırıyoruz.
    //   B) Element popup arkasında gizliyse (Mizan, Fiş İşlemleri, vd. —
    //      isDirectLucaMenuCodeUnsafe listesi): Playwright native hover ile
    //      popup'ı aç, sonra leaf'i YENİDEN BUL (hover sonrası gerçek DOM
    //      elemanı farklı olabilir), yeni element'ten kod çıkar, tekrar dene.
    //   C) Son çare: synthetic mouse sequence + onclick eval (DOM tıklama).
    let cached = cacheLucaMenuHit(label, found) || getCachedLucaMenuHit(label);
    if (cached?.code && await callLucaMenuCode(label, cached.code, log, settleMs)) {
      return true;
    }

    if (isDirectLucaMenuCodeUnsafe(label)) {
      try { await nativeLucaMenuHover(label, log, { settleMs: 300 }); } catch {}
      try {
        const fresh = await findLucaMenuItem(label, null, 1500);
        if (fresh && fresh.el !== found.el) {
          found = fresh;
          cached = cacheLucaMenuHit(label, fresh) || cached;
          if (cached?.code && await callLucaMenuCode(label, cached.code, log, settleMs)) {
            return true;
          }
        }
      } catch {}
    }

    await fullActivateWithParents(found.el, found.frame.contentWindow || found.frame, 5, 120);
    await sleep(settleMs);
    return true;
  }

  function isLikelyLucaMenuElement(el, targetText) {
    const text = normalizeLucaMenuText(el.textContent || '');
    if (text !== targetText) return false;
    if (el.children.length === 0) return true;
    if (text.length > targetText.length + 20) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (/^(A|SPAN|FONT|TD|DIV|LI|B)$/.test(tag)) return true;
    return !!(el.getAttribute?.('onclick') || el.closest?.('a,[onclick],[role="button"]'));
  }

  function describeLucaMenuElement(el) {
    try {
      const tag = String(el?.tagName || '?').toUpperCase();
      const bits = [tag];
      const onclick = String(el.getAttribute?.('onclick') || '').trim();
      const href = String(el.getAttribute?.('href') || '').trim();
      const role = String(el.getAttribute?.('role') || '').trim();
      if (href) bits.push('href');
      if (onclick) bits.push(`onclick=${onclick.slice(0, 45)}`);
      if (role) bits.push(`role=${role}`);
      return bits.join(' ');
    } catch {
      return String(el?.tagName || '?');
    }
  }

  function getClickableLucaMenuElement(el) {
    const isActionable = (node, includeCursor = false) => {
      if (!node) return false;
      const tag = String(node.tagName || '').toUpperCase();
      const style = String(node.getAttribute?.('style') || '').toLowerCase();
      return tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' ||
        !!node.getAttribute?.('onclick') || !!node.getAttribute?.('href') ||
        node.getAttribute?.('role') === 'button' || (includeCursor && style.includes('cursor'));
    };
    if (isActionable(el, false)) return el;
    try {
      const childAction = el.querySelector?.('a[href],a[onclick],[onclick],[href],[role="button"],button,input[type="button"],input[type="submit"]');
      if (childAction) return childAction;
    } catch {}
    let cur = el;
    for (let i = 0; i < 5 && cur; i++) {
      if (isActionable(cur, false)) return cur;
      cur = cur.parentElement;
    }
    cur = el;
    for (let i = 0; i < 5 && cur; i++) {
      if (isActionable(cur, true)) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  async function findLucaMenuItem(text, _log, maxMs = 8000) {
    const result = await waitUntil(() => {
      // Önce frm5 (sağ menü)
      const candidates = ['frm5', 'frm2', 'frm3', 'frm6', 'frm7', 'frm1', 'frm4'];
      const target = normalizeLucaMenuText(text);
      for (const fname of candidates) {
        const f = getLucaFrame(fname);
        if (!f || !f.contentDocument) continue;
        const doc = f.contentDocument;
        for (const el of doc.querySelectorAll('*')) {
          const normalized = normalizeLucaMenuText(el.textContent || '');
          if (normalized === target && isLikelyLucaMenuElement(el, target)) {
            return { el: getClickableLucaMenuElement(el), frame: f, frameName: fname };
          }
        }
      }
      // Top document'ta da bak (her ihtimale karşı)
      for (const el of document.querySelectorAll('*')) {
        const normalized = normalizeLucaMenuText(el.textContent || '');
        if (normalized === target && isLikelyLucaMenuElement(el, target)) {
          return { el: getClickableLucaMenuElement(el), frame: window, frameName: 'top' };
        }
      }
      return null;
    }, maxMs, 250);
    if (result) cacheLucaMenuHit(text, result);
    return result;
  }

  async function findLucaMenuItemAny(labels, _log, maxMs = 8000) {
    const normalizedLabels = labels
      .map((label) => ({ label, key: normalizeLucaMenuText(label) }))
      .filter((item) => item.key);
    if (normalizedLabels.length === 0) return null;

    const result = await waitUntil(() => {
      const candidates = ['frm5', 'frm2', 'frm3', 'frm6', 'frm7', 'frm1', 'frm4'];
      for (const fname of candidates) {
        const f = getLucaFrame(fname);
        if (!f || !f.contentDocument) continue;
        const doc = f.contentDocument;
        for (const el of doc.querySelectorAll('*')) {
          const normalized = normalizeLucaMenuText(el.textContent || '');
          const hit = normalizedLabels.find((item) => normalized === item.key);
          if (hit && isLikelyLucaMenuElement(el, hit.key)) {
            return { el: getClickableLucaMenuElement(el), frame: f, frameName: fname, foundLabel: hit.label };
          }
        }
      }
      for (const el of document.querySelectorAll('*')) {
        const normalized = normalizeLucaMenuText(el.textContent || '');
        const hit = normalizedLabels.find((item) => normalized === item.key);
        if (hit && isLikelyLucaMenuElement(el, hit.key)) {
          return { el: getClickableLucaMenuElement(el), frame: window, frameName: 'top', foundLabel: hit.label };
        }
      }
      return null;
    }, maxMs, 250);
    if (result) cacheLucaMenuHit(result.foundLabel || labels[0], result);
    return result;
  }

  function collectLucaMenuTextBrief(filterLabels = [], limit = 28) {
    const filters = filterLabels
      .map((label) => normalizeLucaMenuText(label))
      .filter(Boolean);
    const out = [];
    const seen = new Set();
    const shouldKeep = (text) => {
      const key = normalizeLucaMenuText(text);
      if (!key || key.length > 80 || seen.has(key)) return false;
      if (filters.length === 0) return true;
      return filters.some((filter) => key.includes(filter) || filter.includes(key)) ||
        /gider|gelir|rapor|liste|isletme|dokum/.test(key);
    };
    const pushText = (text, frameName) => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (!shouldKeep(clean)) return;
      const key = normalizeLucaMenuText(clean);
      seen.add(key);
      out.push(`${frameName || '?'}:${clean}`);
    };
    for (const win of collectLucaWindows()) {
      let frameName = '';
      try { frameName = win.frameElement?.name || win.name || 'top'; } catch { frameName = '?'; }
      let nodes = [];
      try { nodes = Array.from(win.document.querySelectorAll('[onclick],[href],[role="button"],a,span,font,td,div,li')); } catch { continue; }
      for (const el of nodes) {
        pushText(getLucaMenuTextForCache(el), frameName);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  async function openLucaMenuBranch(label, found, childLabels, log, settleMs = 900) {
    const childReady = async (maxMs = 2500) => {
      if (findLucaGelirGiderRaporFormNow()) return true;
      return !!(await findLucaMenuItemAny(childLabels, null, maxMs));
    };

    if (await childReady(600)) return true;

    await nativeLucaMenuHover(label, log, { exact: true, hoverOnly: true, timeoutMs: 5000, settleMs });
    if (await childReady(2500)) return true;

    try {
      const view = found?.frame?.contentWindow || found?.frame || window;
      await fullActivateWithParents(found.el, view, 4, 160);
    } catch {}
    await sleep(settleMs);
    cacheVisibleLucaMenuIds();
    if (await childReady(3000)) return true;

    const cached = cacheLucaMenuHit(label, found) || getCachedLucaMenuHit(label);
    if (cached?.code && await callLucaMenuCode(label, cached.code, log, settleMs)) {
      if (await childReady(2500)) return true;
    }

    const visible = collectLucaMenuTextBrief([label, ...childLabels]).slice(0, 12).join(' | ');
    if (visible && log) await log(`ℹ ${label} sonrasi gorunen isletme menuleri: ${visible}`);
    return false;
  }

  /**
   * Bir element'e click event dispatch et — hem element.click() hem de
   * MouseEvent dispatch (jQuery handler bubbling için).
   */
  function clickElement(el, viewWindow) {
    try { el.click(); } catch {}
    try {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: viewWindow || window,
      }));
    } catch {}
  }

  /**
   * Luca menü elementi için "tam paket" tetikleme — hover + click + onclick eval.
   * Luca menüleri jQuery hover ile açılıyor olabilir; bu yüzden mouse event
   * sırasını gerçekçi tetikleriz: mouseover → mouseenter → mousedown → mouseup
   * → click. Ek olarak onclick attribute varsa o fonksiyonu eval ile direkt
   * çağırırız (II1a gibi Luca menü açma fonksiyonları event parametresi
   * gerektirebilir).
   */
  function fullActivate(el, viewWindow) {
    const view = viewWindow || window;
    const rect = el.getBoundingClientRect?.() || { left: 0, top: 0, width: 10, height: 10 };
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const sequence = ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click'];
    for (const type of sequence) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view,
          clientX: x,
          clientY: y,
          button: 0,
        }));
      } catch {}
    }

    // Ek olarak element.click() — bazı durumlarda dispatchEvent yetmiyor
    try { el.click(); } catch {}

    // onclick attribute'u doğrudan değerlendir (II1a fonksiyonu gibi inline JS)
    const onclickAttr = el.getAttribute('onclick');
    if (onclickAttr) {
      try {
        // Sahte event objesi ile çalıştır
        const fakeEvent = { type: 'click', clientX: x, clientY: y, target: el, currentTarget: el, preventDefault: () => {}, stopPropagation: () => {} };
        const fn = new view.Function('event', onclickAttr);
        fn.call(el, fakeEvent);
      } catch (e) {
        // Sessiz: onclick eval başarısız olabilir, mouseevent zaten tetiklendi
      }
    }
  }

  async function fullActivateWithParents(el, viewWindow, depth = 5, settleMs = 120) {
    const view = viewWindow || window;
    let cur = el;
    for (let i = 0; i < depth && cur; i++, cur = cur.parentElement) {
      try {
        fullActivate(cur, view);
      } catch {}
      await sleep(settleMs);
    }
  }

  async function tryOpenIsletmeGelirGiderReportFromVisibleMenu(log, contextLabel = 'menü') {
    cacheVisibleLucaMenuIds();
    if (await openCachedLucaMenu('Gelir/Gider Listesi', log, 800)) {
      const form = await waitUntil(() => findLucaGelirGiderRaporFormNow(), 12000, 250);
      if (form) {
        await log('✓ Gelir/Gider Listesi rapor formu ID cache ile açıldı');
        return true;
      }
    }
    const target = await findLucaMenuItem('Gelir/Gider Listesi', null, 1800);
    if (!target) return false;
    await log(`🖱 Gelir/Gider Listesi raporu açılıyor (${contextLabel}: ${target.frameName} → ${describeLucaMenuElement(target.el)})`);
    await activateLucaMenuItem('Gelir/Gider Listesi', target, log, 800);
    const form = await waitUntil(() => findLucaGelirGiderRaporFormNow(), 12000, 250);
    if (form) {
      await log('✓ Gelir/Gider Listesi rapor formu menüden açıldı');
      return true;
    }
    await log('ℹ️ Gelir/Gider Listesi menüsü tıklandı ama rapor formu henüz gelmedi; alternatif rota denenecek');
    return false;
  }

  async function tryOpenIsletmeReportSubmenus(log) {
    const submenuNames = [
      'Raporlar',
      'Rapor İşlemleri',
      'Raporlar ve Listeler',
      'Listeler',
      'Dökümler',
      'Döküm İşlemleri',
    ];
    for (const submenuName of submenuNames) {
      const submenu = await findLucaMenuItem(submenuName, null, 1200);
      if (!submenu) continue;
      await log(`🖱 İşletme alt menüsü açılıyor: ${submenuName} (${submenu.frameName} → ${describeLucaMenuElement(submenu.el)})`);
      await activateLucaMenuItem(submenuName, submenu, log, 700);
      await sleep(700);
      if (await tryOpenIsletmeGelirGiderReportFromVisibleMenu(log, submenuName)) return true;
    }
    return false;
  }

  /**
   * Sayfa Fiş Listesi sayfasında değilse (Mizan menüsü yoksa), Muhasebe →
   * Fiş İşlemleri → Fiş Listesi sırasıyla menü tıklayarak gider.
   */
  async function navigateToFisListesi(log) {
    // Önce Mizan menüsü görünür mü? Yetmez — Hesap Planı / Stok Tanım gibi
    // sayfalarda da sağ menü Mizan'ı gösterir ama Mizan tıklayınca form
    // gelmez (varış frame'i frm3 yok ya da yanlış-modül frame'leri açık).
    // Gerçek Fiş Listesi check'i: Mizan görünür + frm3 var + yanlış-modül
    // frame'leri (hplan, stoktanim, mukellef, sirketTanim, …) yok.
    const quick = await findLucaMenuItem('Mizan', null, 1500);
    if (quick) {
      const f3 = getLucaFrame('frm3');
      const wrongFrameNames = ['hplan', 'stoktanim', 'mukellef', 'sirketTanim', 'tanim'];
      const wrongFrame = wrongFrameNames.find((n) => !!getLucaFrame(n));
      if (f3 && !wrongFrame) {
        await log('✓ Fiş Listesi sayfasında (Mizan menüsü hazır, frm3 var)');
        return;
      }
      await log(`ℹ Mizan görünüyor ama Fiş Listesi'nde değiliz (frm3=${!!f3}, yanlış-frame=${wrongFrame || 'yok'}); navigasyon zorunlu`);
    }
    await log('🧭 Ana sayfada — Fiş Listesi sayfasına geçiliyor');

    // Tüm frame'leri RECURSIVE olarak topla (nested iframe yapısı için).
    const collectAllFrames = (rootDoc, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of rootDoc.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) {
            collectAllFrames(f.contentDocument, depth + 1, acc);
          }
        }
      } catch (e) { /* cross-origin */ }
      return acc;
    };

    const allFrameElements = collectAllFrames(document);
    const allFrames = allFrameElements
      .map((f) => `${f.name || '(isimsiz)'}@${f.src ? f.src.split('/').pop().slice(0, 30) : '?'}`)
      .join(' | ');
    await log(`🧩 Mevcut frame'ler (${allFrameElements.length}): ${allFrames || '(hiç yok)'}`);

    const initialCacheRows = cacheVisibleLucaMenuIds();
    if (initialCacheRows > 0) await log(`🧠 Luca menü ID cache güncellendi (${initialCacheRows} satır)`);
    let muhasebeOpenedFromCache = await openCachedLucaMenu('Muhasebe', log, 800);
    if (muhasebeOpenedFromCache) {
      cacheVisibleLucaMenuIds();
      const subMenuReady = await findLucaMenuItem('Fiş İşlemleri', null, 1200);
      if (subMenuReady) {
        await log('✓ Muhasebe menüsü ID cache ile açıldı');
      } else {
        await log('ℹ Muhasebe ID çağrıldı ama alt menü görünmedi; hover fallback denenecek');
        muhasebeOpenedFromCache = false;
      }
    }

    if (!muhasebeOpenedFromCache) {
    // 1. "Muhasebe" text'i olan ilk frame'i bul (recursive arama).
    let menuFrame = null;
    let muhasebeEl = null;
    for (const f of allFrameElements) {
      if (!f.contentDocument) continue;
      try {
        for (const el of f.contentDocument.querySelectorAll('*')) {
          const txt = (el.textContent || '').trim();
          if (txt === 'Muhasebe' && el.children.length === 0) {
            menuFrame = f;
            muhasebeEl = el;
            break;
          }
        }
        if (menuFrame) break;
        // Fallback: onclick içinde apy1000 var mı?
        for (const el of f.contentDocument.querySelectorAll('[onclick]')) {
          if ((el.getAttribute('onclick') || '').includes('apy1000')) {
            menuFrame = f;
            muhasebeEl = el;
            break;
          }
        }
        if (menuFrame) break;
      } catch (e) { /* cross-origin frame, atla */ }
    }

    // Top document'ta da bak (frameset olmayan tek-sayfa Luca için)
    if (!muhasebeEl) {
      try {
        for (const el of document.querySelectorAll('*')) {
          const txt = (el.textContent || '').trim();
          if (txt === 'Muhasebe' && el.children.length === 0) {
            menuFrame = { contentDocument: document, contentWindow: window, name: 'TOP' };
            muhasebeEl = el;
            break;
          }
        }
      } catch (e) {}
    }

    if (!muhasebeEl) {
      throw new Error(`"Muhasebe" menü öğesi hiçbir frame'de bulunamadı. URL=${location.href}, Frame'ler: ${allFrames}`);
    }
    await log(`✓ Muhasebe menüsü "${menuFrame.name || '?'}" frame'inde bulundu`);

    await log('🖱 Muhasebe menüsü açılıyor (hover+click+onclick)');
    cacheLucaMenuHit('Muhasebe', { el: muhasebeEl, frame: menuFrame, frameName: menuFrame.name || '?' });
    await fullActivateWithParents(muhasebeEl, menuFrame.contentWindow);
    await sleep(800);
    }

    // 2. "Fiş İşlemleri" submenüsü açıldı mı?
    let fisIslemleriOpenedFromCache = await openCachedLucaMenu('Fiş İşlemleri', log, 800);
    if (fisIslemleriOpenedFromCache) {
      cacheVisibleLucaMenuIds();
      const childReady = await findLucaMenuItem('Fiş Listesi', null, 1200);
      if (childReady) {
        await log('✓ Fiş İşlemleri ID cache ile açıldı');
      } else {
        await log('ℹ Fiş İşlemleri ID çağrıldı ama Fiş Listesi görünmedi; hover fallback denenecek');
        fisIslemleriOpenedFromCache = false;
      }
    }
    if (!fisIslemleriOpenedFromCache) {
      await log('🔍 Fiş İşlemleri aranıyor');
      const fisIslemleri = await findLucaMenuItem('Fiş İşlemleri', null, 4000);
      if (!fisIslemleri) {
        throw new Error('Muhasebe menüsü açıldı ama "Fiş İşlemleri" görünmedi (menü hover-only olabilir)');
      }
      await log('🖱 Fiş İşlemleri açılıyor (hover+click+onclick)');
      await activateLucaMenuItem('Fiş İşlemleri', fisIslemleri, log, 800);
    }
    cacheVisibleLucaMenuIds();

    // 3. "Fiş Listesi" tıkla
    const fisListesiOpenedFromCache = await openCachedLucaMenu('Fiş Listesi', log, 1000);
    if (fisListesiOpenedFromCache) {
      await log('✓ Fiş Listesi ID cache ile açıldı');
    } else {
      await log('🔍 Fiş Listesi linki aranıyor');
      const fisListesi = await findLucaMenuItem('Fiş Listesi', null, 4000);
      if (!fisListesi) throw new Error('"Fiş Listesi" linki açılmadı');
      await log('🖱 Fiş Listesi tıklanıyor');
      await activateLucaMenuItem('Fiş Listesi', fisListesi, log, 1000);
    }

    // 4. Sayfa yüklensin diye Mizan menüsü çıkana kadar bekle
    // Luca'nın Fiş Listesi sayfası yüklenmesi yavaş olabiliyor (özellikle
    // büyük firma verisi olan mükelleflerde). 15sn yetmiyordu — 60sn'ye çıkardık.
    await log('⏳ Fiş Listesi sayfası yüklensini bekliyor (max 60sn)');
    const mizanReady = await findLucaMenuItem('Mizan', null, 60000);
    if (!mizanReady) throw new Error('Fiş Listesi açıldı ama Mizan menüsü hazır olmadı (timeout 60sn) — Luca cevap vermiyor');
    await log('✓ Fiş Listesi hazır, Mizan menüsü görünür');
  }

  /**
   * İŞLETME DEFTERİ akışı — KDV Kontrol İşletme Alış/Satış için.
   * Akış: Üst menü "İşletme Defteri" → "Gider İşlemleri" hover → "Gider Listesi" tıkla.
   * Sayfa yenilenir ve sağ menüde "Gelir/Gider Listesi" gözükür.
   */
  async function navigateToIsletmeGiderListesi(log) {
    // Rapor formu zaten yüklüyse tekrar menü gezmeye gerek yok. Sadece sağ menü
    // görünür diye çıkmıyoruz; Luca bazen müşteri bilgi ekranında aynı sağ menüyü
    // açık bırakıyor ve rapor formu hiç açılmıyor.
    const readyForm = findLucaGelirGiderRaporFormNow();
    if (readyForm) {
      await log('✓ İşletme Gelir/Gider formu zaten açık');
      return;
    }
    await log('🧭 İşletme Defteri → Gider İşlemleri → Gider Listesi navigasyonu');

    const collectAllFrames = (rootDoc, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of rootDoc.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectAllFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };

    // 1. "İşletme Defteri" üst menü
    const allFrameElements = collectAllFrames(document);
    let menuFrame = null;
    let isletmeEl = null;
    for (const f of allFrameElements) {
      if (!f.contentDocument) continue;
      try {
        for (const el of f.contentDocument.querySelectorAll('*')) {
          const txt = (el.textContent || '').trim();
          if (txt === 'İşletme Defteri' && el.children.length === 0) {
            menuFrame = f;
            isletmeEl = el;
            break;
          }
        }
        if (menuFrame) break;
      } catch (e) {}
    }
    if (!isletmeEl) {
      // Top document'ta dene
      try {
        for (const el of document.querySelectorAll('*')) {
          const txt = (el.textContent || '').trim();
          if (txt === 'İşletme Defteri' && el.children.length === 0) {
            menuFrame = { contentDocument: document, contentWindow: window, name: 'TOP' };
            isletmeEl = el;
            break;
          }
        }
      } catch (e) {}
    }
    if (!isletmeEl) {
      throw new Error('"İşletme Defteri" üst menüsü bulunamadı. Bu mükellef bilanço firması olabilir — Defteri Kebir akışı kullanın.');
    }
    await log(`✓ İşletme Defteri menüsü "${menuFrame.name || '?'}" frame'inde bulundu`);
    await log('🖱 İşletme Defteri açılıyor ve alt menü doğrulanıyor');
    const isletmeFound = { el: isletmeEl, frame: menuFrame, frameName: menuFrame.name || 'TOP' };
    await openLucaMenuBranch('İşletme Defteri', isletmeFound, [
      'Gider İşlemleri',
      'Gider Listesi',
      'Gelir/Gider Listesi',
      'Raporlar',
      'Rapor İşlemleri',
      'Raporlar ve Listeler',
      'Listeler',
      'Dökümler',
      'Döküm İşlemleri',
    ], log, 900);
    await sleep(500);
    if (await tryOpenIsletmeGelirGiderReportFromVisibleMenu(log, 'İşletme Defteri')) return;
    if (await tryOpenIsletmeReportSubmenus(log)) return;

    // 2. "Gider İşlemleri" submenü
    await log('🔍 Gider İşlemleri aranıyor');
    const giderIslemleri = await findLucaMenuItemAny(['Gider İşlemleri', 'Gider Islemleri'], null, 10000);
    if (!giderIslemleri) {
      await log('ℹ Gider İşlemleri görünmedi; Gider Listesi/Gelir-Gider Listesi doğrudan deneniyor');
      if (await tryOpenIsletmeGelirGiderReportFromVisibleMenu(log, 'Gider İşlemleri görünmedi')) return;
      const directList = await findLucaMenuItemAny(['Gider Listesi', 'Gelir/Gider Listesi'], null, 4000);
      if (directList) {
        await log(`🖱 Doğrudan ${directList.foundLabel || 'liste'} açılıyor (${directList.frameName} → ${describeLucaMenuElement(directList.el)})`);
        await activateLucaMenuItem(directList.foundLabel || 'Gider Listesi', directList, log, 1000);
        const directReady = await waitUntil(() => findLucaGelirGiderRaporFormNow() || findLucaMenuItem('Gelir/Gider Listesi', null, 100), 15000, 250);
        if (directReady) {
          if (findLucaGelirGiderRaporFormNow()) {
            await log('✓ İşletme Gelir/Gider formu doğrudan liste yoluyla açıldı');
            return;
          }
          if (await tryOpenIsletmeGelirGiderReportFromVisibleMenu(log, 'doğrudan liste')) return;
        }
      }
      const visible = collectLucaMenuTextBrief([
        'İşletme Defteri',
        'Gider İşlemleri',
        'Gider Listesi',
        'Gelir/Gider Listesi',
        'Raporlar',
      ]).join(' | ');
      throw new Error(`İşletme Defteri menüsü açıldı ama "Gider İşlemleri" görünmedi. Görünen menüler: ${visible || '(yok)'}`);
    }
    await log('🖱 Gider İşlemleri açılıyor ve alt liste doğrulanıyor');
    await openLucaMenuBranch('Gider İşlemleri', giderIslemleri, [
      'Gider Listesi',
      'Gelir/Gider Listesi',
      'Raporlar',
      'Rapor İşlemleri',
      'Listeler',
    ], log, 900);
    await sleep(500);
    if (await tryOpenIsletmeGelirGiderReportFromVisibleMenu(log, 'Gider İşlemleri')) return;

    // 3. "Gider Listesi" tıkla
    await log('🔍 Gider Listesi linki aranıyor');
    const giderListesi = await findLucaMenuItemAny(['Gider Listesi', 'Gelir/Gider Listesi'], null, 10000);
    if (!giderListesi) {
      if (await tryOpenIsletmeReportSubmenus(log)) return;
      const visible = collectLucaMenuTextBrief(['Gider Listesi', 'Gelir/Gider Listesi', 'Raporlar']).join(' | ');
      throw new Error(`"Gider Listesi" linki açılmadı. Görünen menüler: ${visible || '(yok)'}`);
    }
    await log(`🖱 ${giderListesi.foundLabel || 'Gider Listesi'} tıklanıyor`);
    await activateLucaMenuItem(giderListesi.foundLabel || 'Gider Listesi', giderListesi, log, 1000);
    const formAfterListClick = await waitUntil(() => findLucaGelirGiderRaporFormNow(), 6000, 250);
    if (formAfterListClick) {
      await log('✓ İşletme Gelir/Gider formu liste tıklamasıyla açıldı');
      return;
    }

    // 4. Sayfa yüklensin — sağ menüde "Gelir/Gider Listesi" çıksın
    await log('⏳ Gider Listesi sayfası yüklensini bekliyor');
    const ggReady = await findLucaMenuItem('Gelir/Gider Listesi', null, 60000);
    if (!ggReady) {
      const directForm = findLucaGelirGiderRaporFormNow();
      if (directForm) {
        await log('✓ Gider Listesi formu dogrudan acildi; sag menu beklenmeden devam');
        return;
      }
      throw new Error(`Gider Listesi açıldı ama "Gelir/Gider Listesi" sağ menüsü hazır olmadı (timeout 60sn). Mevcut form'lar: ${collectLucaFormsBrief().join(' | ') || '(yok)'}`);
    }
    await log('✓ İşletme Gider Listesi hazır, Gelir/Gider Listesi sağ menüsü görünür');
  }

  async function openLucaAccountPlanListesi(log) {
    try {
      const f3 = getLucaFrame('frm3');
      if (f3) {
        f3.src = 'about:blank';
        await sleep(650);
        await log('Hesap Plani Listesi icin frm3 temizlendi; eski rapor formu kabul edilmeyecek');
      }
    } catch {}

    const labels = ['Hesap Plani Listesi'];
    cacheVisibleLucaMenuIds();
    for (const label of labels) {
      if (await openCachedLucaMenu(label, log, 1000)) {
        const ready = await waitUntil(() => findLucaAccountPlanListesiFormNow(), 7000, 250);
        if (ready) {
          await log('Hesap Plani Listesi ID cache ile acildi ve form dogrulandi');
          return;
        }
        deleteCachedLucaMenuHit(label);
        await log(`${label} cache ID hedef formu acmadi; metinle yeniden denenecek`);
      }
    }

    await log('Sag menude Hesap Plani Listesi linki araniyor...');
    const found = await findLucaMenuItemAny(labels, log, 7000);
    if (!found) {
      throw new Error(
        'Luca Hesap Plani Listesi linki bulunamadi. Muhasebe > Fis Islemleri > Fis Listesi sayfasinda, Genel Raporlar bolumunde olmaliyiz.',
      );
    }
    await log(`Hesap Plani Listesi tiklaniyor (${found.frameName} -> ${found.el.tagName})`);
    await activateLucaMenuItem(found.foundLabel || 'Hesap Plani Listesi', found, log, 1000);
    const ready = await waitUntil(() => findLucaAccountPlanListesiFormNow(), 12000, 250);
    if (ready) return;
    throw new Error(`Hesap Plani Listesi tiklandi ama form yuklenmedi. Mevcut form'lar: ${collectLucaFormsBrief().join(' | ') || '(yok)'}`);
  }

  function findLucaAccountPlanListesiFormNow() {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch {}
      return acc;
    };
    const looksLikeAccountPlan = (form) => {
      const docText = normalizeLucaMenuText(form.ownerDocument?.body?.textContent || '');
      const formText = normalizeLucaMenuText(`${form.name || ''} ${form.id || ''} ${form.action || ''}`);
      const text = `${docText} ${formText}`;
      const hasTitle = /hesap plani listesi|hesap plani/.test(text);
      const isWrongReport = /mizan|detay fis listesi|ozet fis listesi|isletme/.test(formText);
      const selectText = [...form.querySelectorAll('select')]
        .flatMap((sel) => [...sel.options].map((opt) => `${opt.text || ''} ${opt.value || ''}`))
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      const hasExcelChoice = /excel|xlsx|xls/.test(selectText);
      const hasControls = form.querySelectorAll('input, select, button').length > 0;
      return hasTitle && hasControls && hasExcelChoice && !isWrongReport;
    };
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        for (const form of f.contentDocument.querySelectorAll('form')) {
          if (looksLikeAccountPlan(form)) return form;
        }
      } catch {}
    }
    return null;
  }

  async function waitForLucaAccountPlanListesiForm(log, maxMs = 15000) {
    await log('Hesap Plani Listesi formu bekleniyor...');
    const form = await waitUntil(() => findLucaAccountPlanListesiFormNow(), maxMs, 250);
    if (!form) {
      await log(`Bulunan form'lar: ${collectLucaFormsBrief().join(' | ') || '(hic yok)'}`);
      throw new Error('Hesap Plani Listesi formu yuklenmedi (timeout)');
    }
    await log(`Hesap Plani Listesi formu yuklendi: name="${form.name || '?'}" action="${(form.action || '').split('/').pop()}"`);
    return form;
  }

  async function fetchLucaAccountPlanExcel(job, log) {
    if (location.hostname.includes('agiris.luca') || location.pathname.includes('LUCASSO')) {
      throw new Error(
        'Bu Luca v2.1 (LUCASSO) surumu. Lutfen klasik Luca icinde calisin: auygs.luca.com.tr/Luca/luca.do',
      );
    }

    const firmaResult = await ensureLucaFirma(job, log);
    await navigateToFisListesi(log);
    if (firmaResult?.changed) {
      await log('Firma degisti - Hesap Plani Listesi formu taze acilacak');
    }
    await openLucaAccountPlanListesi(log);
    const form = await waitForLucaAccountPlanListesiForm(log);
    await preferExcelReportType(form, log, 'Hesap Plani Listesi');
    return await fetchMizanByClickIntercept(form, job, log, {
      label: 'Hesap Plani Listesi',
      skipDates: true,
    });
  }

  async function openLucaDetayFisListesi(log) {
    try {
      const f3 = getLucaFrame('frm3');
      if (f3) {
        f3.src = 'about:blank';
        await sleep(650);
        await log('Detay Fis Listesi icin frm3 temizlendi; eski/yanlis rapor formu kabul edilmeyecek');
      }
    } catch {}
    cacheVisibleLucaMenuIds();
    if (await openCachedLucaMenu('Detay Fiş Listesi', log, 1000) || await openCachedLucaMenu('Detay Fis Listesi', log, 1000)) {
      const ready = await waitUntil(() => findLucaDetayFisListesiFormNow(), 7000, 250);
      if (ready) {
        await log('✓ Detay Fis Listesi ID cache ile acildi ve form dogrulandi');
        return;
      }
      deleteCachedLucaMenuHit('Detay Fiş Listesi');
      deleteCachedLucaMenuHit('Detay Fis Listesi');
      await log('Detay Fis Listesi cache ID hedef formu acmadi; metinle yeniden denenecek');
    }

    await log('🔍 Sağ menüde Detay Fiş Listesi linki aranıyor...');
    const found = await findLucaMenuItemAny(['Detay Fiş Listesi', 'Detay Fis Listesi'], log, 7000);
    if (!found) {
      throw new Error(
        'Luca Detay Fis Listesi linki bulunamadi. Muhasebe > Fis Islemleri > Fis Listesi sayfasinda, Genel Raporlar bolumunde olmaliyiz.',
      );
    }
    await log(`🖱 Detay Fis Listesi tiklaniyor (${found.frameName} -> ${found.el.tagName})`);
    await activateLucaMenuItem(found.foundLabel || 'Detay Fiş Listesi', found, log, 1000);
    const ready = await waitUntil(() => findLucaDetayFisListesiFormNow(), 12000, 250);
    if (ready) return;
    throw new Error(`Detay Fis Listesi tiklandi ama form yuklenmedi. Mevcut form'lar: ${collectLucaFormsBrief().join(' | ') || '(yok)'}`);
  }

  function findLucaDetayFisListesiFormNow() {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch {}
      return acc;
    };
    const looksLikeDetailFis = (form) => {
      const docText = (form.ownerDocument?.body?.textContent || '').toLocaleLowerCase('tr-TR');
      const formText = `${form.name || ''} ${form.id || ''} ${form.action || ''} ${docText}`.toLocaleLowerCase('tr-TR');
      const hasTitle = /detay\s+fi[şs]\s+listesi/.test(formText);
      const hasControls = form.querySelectorAll('input, select, button').length > 0;
      const isMizan = /mizan/.test(`${form.name || ''} ${form.action || ''}`.toLocaleLowerCase('tr-TR'));
      return hasTitle && hasControls && !isMizan;
    };
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        for (const form of f.contentDocument.querySelectorAll('form')) {
          if (looksLikeDetailFis(form)) return form;
        }
      } catch {}
    }
    return null;
  }

  async function waitForLucaDetayFisListesiForm(log, maxMs = 15000) {
    await log('⏳ Detay Fis Listesi formu bekleniyor...');
    const form = await waitUntil(() => findLucaDetayFisListesiFormNow(), maxMs, 250);
    if (!form) {
      await log(`🔍 Bulunan form'lar: ${collectLucaFormsBrief().join(' | ') || '(hic yok)'}`);
      throw new Error('Detay Fis Listesi formu yuklenmedi (timeout)');
    }
    await log(`✓ Detay Fis Listesi formu yuklendi: name="${form.name || '?'}" action="${(form.action || '').split('/').pop()}"`);
    return form;
  }

  async function fetchLucaDetayFisListesiExcel(job, log) {
    if (location.hostname.includes('agiris.luca') || location.pathname.includes('LUCASSO')) {
      throw new Error(
        'Bu Luca v2.1 (LUCASSO) surumu. Lutfen klasik Luca icinde calisin: auygs.luca.com.tr/Luca/luca.do',
      );
    }

    const firmaResult = await ensureLucaFirma(job, log);
    await navigateToFisListesi(log);
    if (firmaResult?.changed) {
      await log('🔁 Firma degisti - Detay Fis Listesi formu taze acilacak');
    }
    await openLucaDetayFisListesi(log);
    const form = await waitForLucaDetayFisListesiForm(log);
    return await fetchMizanByClickIntercept(form, job, log, {
      label: 'Detay Fis Listesi',
      raporTur: 'detayFisListesi',
    });
  }

  /**
   * Sağ menüde "Mizan" linkine tıkla — frm5 öncelikli. Element FONT içinde olabilir,
   * click bubbling ile parent jQuery handler tetiklenir.
   */
  async function openLucaMizan(log) {
    try {
      const f3 = getLucaFrame('frm3');
      if (f3) {
        f3.src = 'about:blank';
        await sleep(650);
        await log('Mizan icin frm3 temizlendi; eski/yanlis rapor formu kabul edilmeyecek');
      }
    } catch {}
    cacheVisibleLucaMenuIds();
    if (await openCachedLucaMenu('Mizan', log, 1000)) {
      const ready = await waitUntil(() => findLucaMizanFormNow(), 5000, 250);
      if (ready) {
        await log('✓ Mizan ID cache ile açıldı ve raporMizanForm doğrulandı');
        return;
      }
      deleteCachedLucaMenuHit('Mizan');
      await log('Mizan cache ID hedef formu açmadı; cache silindi ve metinle yeniden denenecek');
    }
    await log('🔍 Sağ menüde Mizan linki aranıyor...');
    const found = await findLucaMenuItem('Mizan', log);
    if (!found) {
      // Mizan ana sayfada yoktur — Fiş Listesi sayfasına geçilmesi gerekir
      throw new Error(
        'Luca\'da Fiş Listesi sayfasını açın: Muhasebe → Fiş İşlemleri → Fiş Listesi. ' +
        'Mizan linki bu sayfanın sağ menüsünde görünür.',
      );
    }
    await log(`🖱 Mizan tıklanıyor (${found.frameName} → ${found.el.tagName})`);
    if (await activateLucaMenuItem('Mizan', found, log, 1000)) {
      const ready = await waitUntil(() => findLucaMizanFormNow(), 8000, 250);
      if (ready) return;
      await log('Mizan tıklamasından sonra form yüklenmedi; element yeniden bulunup güçlü tıklama denenecek');
    }

    // Re-find + güçlü tıklama: popup hover sonrası gerçek leaf değişmiş olabilir;
    // child clickables + parent zincirini fullActivate ile (mouse sequence +
    // onclick eval) tetikle.
    const refresh = await findLucaMenuItem('Mizan', null, 2000);
    const retry = refresh || found;
    const view = retry.frame.contentWindow || retry.frame;
    const candidates = [retry.el];
    try {
      for (const child of retry.el.querySelectorAll?.('a[href],a[onclick],[onclick],[href],[role="button"]') || []) {
        if (!candidates.includes(child)) candidates.push(child);
      }
    } catch {}
    let cur = retry.el.parentElement;
    for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
      if (!candidates.includes(cur)) candidates.push(cur);
    }
    for (const c of candidates) {
      try { fullActivate(c, view); } catch {}
      await sleep(150);
      if (findLucaMizanFormNow()) {
        await sleep(800);
        return;
      }
    }
    // about:blank reset sonrası taze form yüklenmesi 1-2sn sürebilir
    await sleep(1500);
  }

  function findLucaMizanFormNow() {
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch {}
      return acc;
    };
    for (const f of collectFrames(document)) {
      if (!f.contentDocument) continue;
      try {
        const found =
          f.contentDocument.querySelector('form[name="raporMizanForm"]') ||
          f.contentDocument.querySelector('form[action*="raporMizan"]') ||
          f.contentDocument.querySelector('form[action*="Mizan"]');
        if (found) return found;
      } catch {}
    }
    return null;
  }

  /**
   * frm3'te raporMizanForm yüklenmesini bekle (Mizan tıklamasından sonra
   * form yüklenir — bazen 1-3 saniye sürer).
   */
  async function waitForLucaMizanForm(log, maxMs = 15000) {
    await log(`⏳ raporMizanForm yüklenmesi bekleniyor…`);
    const form = await waitUntil(() => {
      // Tüm frame'leri RECURSIVE tara (frm3 hardcoded değil)
      const collectFrames = (root, depth = 0, acc = []) => {
        if (depth > 5) return acc;
        try {
          for (const f of root.querySelectorAll('frame, iframe')) {
            acc.push(f);
            if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
          }
        } catch (e) {}
        return acc;
      };

      for (const f of collectFrames(document)) {
        if (!f.contentDocument) continue;
        try {
          const found =
            f.contentDocument.querySelector('form[name="raporMizanForm"]') ||
            f.contentDocument.querySelector('form[action*="raporMizan"]') ||
            f.contentDocument.querySelector('form[action*="Mizan"]') ||
            f.contentDocument.querySelector('form input[name="TARIH_ILK"]')?.form;
          if (found) return found;
        } catch (e) {}
      }
      return null;
    }, maxMs);

    if (!form) {
      // Diagnostic: tüm frame'lerdeki form'ları listele
      const allForms = [];
      const collectFrames = (root, depth = 0, acc = []) => {
        if (depth > 5) return acc;
        try {
          for (const f of root.querySelectorAll('frame, iframe')) {
            acc.push(f);
            if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
          }
        } catch (e) {}
        return acc;
      };
      for (const f of collectFrames(document)) {
        if (!f.contentDocument) continue;
        try {
          for (const fr of f.contentDocument.querySelectorAll('form')) {
            allForms.push(`${f.name || '?'}:form[name="${fr.name || ''}",action="${(fr.action || '').split('/').pop().slice(0, 40)}"]`);
          }
        } catch (e) {}
      }
      await log(`🔍 Bulunan form'lar: ${allForms.length > 0 ? allForms.join(' | ') : '(hiç yok)'}`);
      throw new Error('raporMizanForm yüklenmedi (timeout) — yukarıdaki form listesinde gerçek isim göründü mü?');
    }
    await log(`✓ Form yüklendi: name="${form.name || '?'}" action="${(form.action || '').split('/').pop()}"`);
    return form;
  }

  /**
   * Luca tarih formatına çevir — donem string'inden başlangıç + bitiş tarihleri
   * Örnek: "2026-Q1" → {bas:"01.01.2026", bit:"31.03.2026"}
   *        "2026-03" → {bas:"01.03.2026", bit:"31.03.2026"}  (aylık)
   */
  function donemToTarihAraligi(donem, donemTipi) {
    const s = String(donem || '').trim();

    // Format 0: "2026-01-01_2026-03-31" - IHO_FETCH gibi aralik bazli job'lar
    const rangeMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})$/);
    if (rangeMatch) {
      return {
        bas: `${rangeMatch[3]}.${rangeMatch[2]}.${rangeMatch[1]}`,
        bit: `${rangeMatch[6]}.${rangeMatch[5]}.${rangeMatch[4]}`,
      };
    }

    // Format 1: "2026-Q1", "2026Q1", "2026_Q1" — çeyrek
    const qMatch = s.match(/(\d{4})[-_/]?Q(\d)/i);
    if (qMatch) {
      const yil = +qMatch[1];
      const ceyrek = +qMatch[2];
      const basAy = (ceyrek - 1) * 3 + 1;
      const bitAy = ceyrek * 3;
      const basMM = String(basAy).padStart(2, '0');
      const bitMM = String(bitAy).padStart(2, '0');
      const bitGun = new Date(yil, bitAy, 0).getDate();
      return {
        bas: `01.${basMM}.${yil}`,
        bit: `${String(bitGun).padStart(2, '0')}.${bitMM}.${yil}`,
      };
    }

    // Format 2: "2026-03", "2026/3", "2026_03" — aylık
    const mMatch = s.match(/(\d{4})[-_/](\d{1,2})$/);
    if (mMatch) {
      const yil = +mMatch[1];
      const ayMo = +mMatch[2];

      const tip = String(donemTipi || '').toUpperCase();
      const isQuarterTip = /^GECICI_Q[1-4]$/.test(tip) || /^Q[1-4]$/.test(tip) || /CEYREK|QUARTER/.test(tip);
      if (!isQuarterTip || tip === 'AY' || tip === 'AYLIK' || tip === 'MONTH' || tip === 'MONTHLY') {
        const lastDay = new Date(yil, ayMo, 0).getDate();
        const mm = String(ayMo).padStart(2, '0');
        return {
          bas: `01.${mm}.${yil}`,
          bit: `${lastDay}.${mm}.${yil}`,
        };
      }
      // donemTipi quarter ama format aylık verilmiş → ayın bulunduğu çeyreği al
      const ceyrek = Math.ceil(ayMo / 3);
      const basAy = (ceyrek - 1) * 3 + 1;
      const bitAy = ceyrek * 3;
      const basMM = String(basAy).padStart(2, '0');
      const bitMM = String(bitAy).padStart(2, '0');
      const bitGun = new Date(yil, bitAy, 0).getDate();
      return {
        bas: `01.${basMM}.${yil}`,
        bit: `${String(bitGun).padStart(2, '0')}.${bitMM}.${yil}`,
      };
    }

    // Format 3: sadece yıl "2026" → tüm yıl
    const yMatch = s.match(/^(\d{4})$/);
    if (yMatch) {
      const yil = +yMatch[1];
      return { bas: `01.01.${yil}`, bit: `31.12.${yil}` };
    }

    return null;
  }

  function inferDonemTipi(donem, donemTipi) {
    const explicit = String(donemTipi || '').trim().toUpperCase();
    if (/^GECICI_Q[1-4]$/.test(explicit)) return explicit;
    if (explicit === 'AY' || explicit === 'AYLIK' || explicit === 'MONTH') return 'AYLIK';
    if (explicit === 'YILLIK' || explicit === 'YEAR' || explicit === 'ANNUAL') return 'YILLIK';

    const s = String(donem || '').trim().toUpperCase();
    const q = s.match(/(?:^|[-_/])Q([1-4])$/);
    if (q) return `GECICI_Q${q[1]}`;
    if (/-YILLIK$/.test(s) || /^\d{4}$/.test(s)) return 'YILLIK';
    if (/^\d{4}[-_/]\d{1,2}$/.test(s)) return 'AYLIK';
    return 'AYLIK';
  }

  /**
   * Mizan formunda tarih input'larını ve "Rapor Türü"nü ayarla.
   */
  async function fillMizanForm(form, job, log) {
    // 1) Rapor türü Excel
    let raporTuruSet = false;
    for (const sel of form.querySelectorAll('select')) {
      for (const opt of sel.options) {
        const txt = (opt.text || '').toLowerCase();
        const val = (opt.value || '').toLowerCase();
        if ((txt.includes('excel') && txt.includes('xlsx')) || val === 'xlsx' || val === 'excel_liste') {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          raporTuruSet = true;
          await log(`📊 Rapor türü: ${opt.text.trim()}`);
          break;
        }
      }
      if (raporTuruSet) break;
    }

    // 2) Tarih input'ları
    const tarih = donemToTarihAraligi(job.donem, job.donemTipi);
    if (!tarih) {
      throw new Error(
        `Tarih hesaplanamadı (donem="${job.donem}", tipi="${job.donemTipi}"). ` +
        `Beklenen format: "2026-Q1", "2026-03" veya "2026".`,
      );
    }
    // Tarih input'larını bul — Luca convention: TARIH_ILK + TARIH_SON
    // ÖNEMLI: kurTarih (para birimi tarihi) farklı bir alan, ona dokunma!
    const setInputValue = (inp, value) => {
      if (!inp) return false;
      inp.value = value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    };

    // Önce spesifik isimle ara: TARIH_ILK / TARIH_SON
    let tarihIlk = form.querySelector('input[name="TARIH_ILK"], input[id="TARIH_ILK"]');
    let tarihSon = form.querySelector('input[name="TARIH_SON"], input[id="TARIH_SON"]');

    // Bulunamazsa generic filter (kurTarih hariç tut)
    if (!tarihIlk || !tarihSon) {
      const fallback = [...form.querySelectorAll('input[type="text"], input:not([type])')]
        .filter((inp) => {
          const n = (inp.name || '') + ' ' + (inp.id || '');
          return /tarih|date/i.test(n) && !/kur/i.test(n);
        });
      if (!tarihIlk) tarihIlk = fallback[0];
      if (!tarihSon) tarihSon = fallback[1];
    }

    if (!tarihIlk || !tarihSon) {
      const allInputs = [...form.querySelectorAll('input')]
        .map((i) => `${i.type || 'text'}#${i.name || i.id || '?'}`)
        .slice(0, 30)
        .join(', ');
      throw new Error(
        `TARIH_ILK/TARIH_SON input'ları bulunamadı. Form input'ları: ${allInputs}`,
      );
    }

    // Tarih input'larının attribute'larını incele — readonly/disabled mı?
    const inputAttrs = (i) => `readonly=${i.readOnly}, disabled=${i.disabled}, type=${i.type}, value="${i.value}"`;
    await log(`🔎 TARIH_ILK öncesi: ${inputAttrs(tarihIlk)}`);
    await log(`🔎 TARIH_SON öncesi: ${inputAttrs(tarihSon)}`);

    setInputValue(tarihIlk, tarih.bas);
    setInputValue(tarihSon, tarih.bit);

    // Set'ten HEMEN sonra value'yu tekrar oku — sıfırlanıyor mu?
    await log(`📅 Set sonrası: TARIH_ILK="${tarihIlk.value}" | TARIH_SON="${tarihSon.value}"`);

    // 200ms bekleyip tekrar oku — Luca async handler sıfırlıyor mu?
    await sleep(300);
    await log(`📅 300ms sonra: TARIH_ILK="${tarihIlk.value}" | TARIH_SON="${tarihSon.value}"`);

    // Eğer hâlâ boşsa, native setter ile zorla yaz (Luca custom getter override etmiş olabilir)
    if (!tarihIlk.value || !tarihSon.value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (tarihIlk.ownerDocument && tarihIlk.ownerDocument.defaultView) {
        const win = tarihIlk.ownerDocument.defaultView;
        const winNativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        winNativeSetter.call(tarihIlk, tarih.bas);
        winNativeSetter.call(tarihSon, tarih.bit);
      } else {
        nativeSetter.call(tarihIlk, tarih.bas);
        nativeSetter.call(tarihSon, tarih.bit);
      }
      tarihIlk.dispatchEvent(new Event('input', { bubbles: true }));
      tarihSon.dispatchEvent(new Event('input', { bubbles: true }));
      await log(`🔧 Native setter ile zorla: TARIH_ILK="${tarihIlk.value}" | TARIH_SON="${tarihSon.value}"`);
    }

    // 3) Hesap kodu aralığı — Luca mizan formu genelde "kodBas/kodBit" veya
    //    "hesapKoduBaslangic/hesapKoduBitis" inputları içerir. Boşsa default
    //    1 → 999.99.999.999 ata (Türkiye Tek Düzen Hesap Planı maksimum derinliği).
    const kodInputs = [...form.querySelectorAll('input[type="text"], input:not([type])')]
      .filter((inp) => /kod/i.test((inp.name || '') + ' ' + (inp.id || '')));
    if (kodInputs.length >= 2) {
      if (!kodInputs[0].value) kodInputs[0].value = '1';
      if (!kodInputs[1].value) kodInputs[1].value = '999.99.999.999';
      kodInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      kodInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      await log(`🔢 Hesap kodu: ${kodInputs[0].value} → ${kodInputs[1].value}`);
    }

    // 4) Seviye (kademe) input'u — varsayılan en derin (9) bırak ki tüm hesaplar gelsin.
    const seviyeInputs = [...form.querySelectorAll('input, select')]
      .filter((inp) => /seviye|kademe|derinlik/i.test((inp.name || '') + ' ' + (inp.id || '')));
    for (const sv of seviyeInputs) {
      if (!sv.value || sv.value === '0') {
        sv.value = sv.tagName === 'SELECT' && sv.options.length > 0
          ? sv.options[sv.options.length - 1].value
          : '9';
        sv.dispatchEvent(new Event('change', { bubbles: true }));
        await log(`📊 Seviye: ${sv.value}`);
      }
    }

    // 5) Diagnostic — submit öncesi tüm form state'ini log'a düş
    const allFields = [...form.querySelectorAll('input, select, textarea')]
      .map((el) => `${el.name || el.id || '?'}=${(el.value || '').slice(0, 30) || '∅'}`)
      .filter((s) => !s.startsWith('?='))
      .slice(0, 30)
      .join(' | ');
    await log(`🧾 Form alanları: ${allFields}`);
  }

  /**
   * Mizan akışı — tam otomatik (firma değiştir + menü tıkla + form + submit):
   *   1) frm4 SirketCombo: hedef firma değilse değiştir, sayfa bekle
   *   2) frm5 Mizan menüsüne click() simulate
   *   3) frm3 raporMizanForm yüklensini bekle
   *   4) Tarih + Rapor türü doldur
   *   5) FormData → fetch POST → blob yakala
   */
  async function fetchLucaMizanExcel(job, log) {
    // 0) Luca sürüm kontrolü
    if (location.hostname.includes('agiris.luca') || location.pathname.includes('LUCASSO')) {
      throw new Error(
        'Bu Luca v2.1 (LUCASSO) sürümü. Lütfen klasik Luca\'ya geçin: ' +
        'auygs.luca.com.tr/Luca/luca.do — giriş ekranında "Mali Müşavir Girişi" ile (v2.1 BETAYA basmadan).',
      );
    }

    // 1) Hedef firma açık mı?
    const firmaResult = await ensureLucaFirma(job, log);

    // 2) Fiş Listesi sayfasına geç
    await navigateToFisListesi(log);

    // 3) Mizan formu yüklü mü?
    // ÖNEMLİ: Firma DEĞİŞTİYSE eski form STALE (eski sirketId/donemId hidden input'ları
    // taşıyor) → submit eski firmanın mizanını çekiyor. Bu durumda formAlreadyLoaded'u
    // yok say, openLucaMizan'ı çağırarak frm3'ü yeni firma context'inde yenile.
    let frm3 = getLucaFrame('frm3');
    let formAlreadyLoaded =
      frm3?.contentDocument?.querySelector('form[name="raporMizanForm"]');
    if (firmaResult?.changed) {
      await log('🔁 Firma değişti — frm3 sıfırlanıyor (stale form önleme)');
      // Kritik: Luca, Mizan link'ine 2. tıklamada eski form'u sadece öne getiriyor,
      // yeni form fetch'lemiyor. frm3.src'yi about:blank'e çekip ZORLA bir Mizan
      // tıklamasıyla server'dan taze form alıyoruz.
      try {
        const f3 = getLucaFrame('frm3');
        if (f3) {
          f3.src = 'about:blank';
          await sleep(700);
        }
      } catch (e) {
        await log(`⚠ frm3 sıfırlama hatası: ${e?.message || e}`);
      }
      formAlreadyLoaded = null;
    }
    if (!formAlreadyLoaded) {
      await openLucaMizan(log);
    } else {
      await log('✓ Mizan formu zaten açık');
    }

    // 4) Form yüklensin
    const form = await waitForLucaMizanForm(log);
    frm3 = getLucaFrame('frm3');

    // 5) YENİ AKIŞ: Luca'nın kendi "Excel'e Aktar" butonuna tıkla, fetch'i
    //    intercept ederek inen Excel'i yakala. Bu jasper.jq+rapor_takip+rapor_indir
    //    zincirini reverse engineer etmekten çok daha güvenilir — Luca kendi
    //    JS'iyle doğru body'yi hazırlıyor, biz sonucu yakalıyoruz.
    return await fetchMizanByClickIntercept(form, job, log);
  }

  async function preferExcelReportType(form, log, label = 'Rapor') {
    let seenReportSelect = false;
    let changed = false;
    const doc = form.ownerDocument || document;
    const selects = [
      ...form.querySelectorAll('select'),
      ...doc.querySelectorAll('select'),
    ].filter((sel, i, arr) => arr.indexOf(sel) === i);
    for (const sel of selects) {
      const nameText = `${sel.name || ''} ${sel.id || ''}`.toLocaleLowerCase('tr-TR');
      const optionText = [...sel.options].map((opt) => `${opt.text || ''} ${opt.value || ''}`).join(' ').toLocaleLowerCase('tr-TR');
      const isReportSelect =
        /rapor|report|tur|degistir|dosya|format/.test(nameText) ||
        /excel|xlsx|xls|pdf|word|rtf|odt/.test(optionText);
      if (!isReportSelect) continue;
      seenReportSelect = true;
      const options = [...sel.options];
      const option = options.find((opt) => {
        const text = `${opt.text || ''} ${opt.value || ''}`.toLocaleLowerCase('tr-TR');
        return /excel\s*\(xlsx\)|xlsx/.test(text) && !/pdf|word|rtf|odt|liste/.test(text);
      }) || options.find((opt) => {
        const text = `${opt.text || ''} ${opt.value || ''}`.toLocaleLowerCase('tr-TR');
        return /excel|xlsx|xls/.test(text) && !/pdf|word|rtf|odt/.test(text);
      });
      if (!option) continue;
      if (sel.value !== option.value) {
        const idx = options.indexOf(option);
        if (idx >= 0) sel.selectedIndex = idx;
        sel.value = option.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const onChangeAttr = sel.getAttribute('onchange');
        if (onChangeAttr) {
          try {
            const win = sel.ownerDocument.defaultView || window;
            new win.Function('event', onChangeAttr).call(sel, new win.Event('change'));
          } catch {}
        }
        changed = true;
      }
      await log(`📊 ${label} rapor turu Excel yapildi: ${String(option.text || option.value).trim()} (select#${sel.name || sel.id || '?'})`);
      break;
    }
    if (seenReportSelect && !changed) {
      await log(`ℹ ${label} rapor turu zaten uygun ya da Excel secenegi yok; mevcut secim korunuyor`);
    }
  }

  /**
   * Luca'nın "Excel'e Aktar" butonuna programmatik tıkla, fetch'i monkey-patch
   * ederek rapor_indir.jq response'unu (Excel blob) yakala.
   */
  async function fetchMizanByClickIntercept(form, job, log, options = {}) {
    // Mizan raporlarinda tarih doldurulur; Hesap Plani Listesi skipDates ile
    // sadece rapor turunu Excel'e alir.
    const skipDates = options.skipDates === true;
    const forceReportFormat = Boolean(options.raporTur || options.forceReportFormat || skipDates);
    const tarih = skipDates ? null : donemToTarihAraligi(job.donem, job.donemTipi);
    if (!skipDates && !tarih) throw new Error(`Tarih hesaplanamadı: ${job.donem}`);

    const setNative = (inp, value) => {
      if (!inp) return;
      const win = inp.ownerDocument.defaultView;
      try {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, value);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch (e) {}
    };

    const tarihIlk = skipDates ? null : form.querySelector('input[name="TARIH_ILK"], input[id="TARIH_ILK"], input[name="tarih_ilk"]');
    const tarihSon = skipDates ? null : form.querySelector('input[name="TARIH_SON"], input[id="TARIH_SON"], input[name="tarih_son"]');
    const slashBas = tarih ? tarih.bas.replace(/\./g, '/') : '';
    const slashBit = tarih ? tarih.bit.replace(/\./g, '/') : '';
    const mizanStartKeys = [
      'tarih_ilk', 'tarihIlk', 'TARIH_ILK', 'tarih_bas', 'tarihBas',
      'baslangic', 'basTarih', 'ilkTarih', 'donem_bas', 'cari_donem_bas',
      'fis_tarihi_ilk', 'p_fis_tarihi_ilk_1', 'baslangicFisTarihi', 'BASLANGIC_FIS_TARIHI',
    ];
    const mizanEndKeys = [
      'tarih_son', 'tarihSon', 'TARIH_SON', 'tarih_bit', 'tarihBit',
      'bitis', 'bitTarih', 'sonTarih', 'donem_bit', 'cari_donem_bit',
      'fis_tarihi_son', 'p_fis_tarihi_son_1', 'bitisFisTarihi', 'BITIS_FIS_TARIHI',
    ];
    const setAllMizanDateKeys = (target) => {
      if (skipDates) return false;
      if (!target || typeof target !== 'object') return false;
      let changed = false;
      for (const k of mizanStartKeys) {
        if (target[k] !== slashBas) {
          target[k] = slashBas;
          changed = true;
        }
      }
      for (const k of mizanEndKeys) {
        if (target[k] !== slashBit) {
          target[k] = slashBit;
          changed = true;
        }
      }
      return changed;
    };
    const reportFormatKeys = [
      'dosya_tipi', 'dosyaTipi', 'DOSYA_TIPI',
      'format', 'FORMAT',
      'REPORT_TYPE', 'reportType', 'report_type',
      'raporTuru', 'RAPOR_TURU', 'rapor_turu',
      'raporTipi', 'RAPOR_TIPI', 'rapor_tipi',
      'ciktiTuru', 'CIKTI_TURU', 'cikti_turu',
      'fileType', 'FILE_TYPE', 'file_type',
      'outputType', 'OUTPUT_TYPE', 'output_type',
      'exportType', 'EXPORT_TYPE', 'export_type',
      'uzanti', 'UZANTI',
    ];
    const getExcelReportOption = () => {
      try {
        const doc = form.ownerDocument || document;
        const selects = [
          ...form.querySelectorAll('select'),
          ...doc.querySelectorAll('select'),
        ].filter((sel, i, arr) => arr.indexOf(sel) === i);
        for (const sel of selects) {
          const options = [...sel.options];
          const optionText = options.map((opt) => `${opt.text || ''} ${opt.value || ''}`).join(' ').toLocaleLowerCase('tr-TR');
          if (!/excel|xlsx|xls/.test(optionText) || !/pdf|word|rtf|odt/.test(optionText)) continue;
          const excel = options.find((opt) => {
            const t = `${opt.text || ''} ${opt.value || ''}`.toLocaleLowerCase('tr-TR');
            return /excel\s*\(xlsx\)|xlsx/.test(t) && !/pdf|word|rtf|odt|liste/.test(t);
          }) || options.find((opt) => {
            const t = `${opt.text || ''} ${opt.value || ''}`.toLocaleLowerCase('tr-TR');
            return /excel|xlsx|xls/.test(t) && !/pdf|word|rtf|odt|liste/.test(t);
          });
          if (excel) {
            return {
              name: sel.name || '',
              id: sel.id || '',
              value: String(excel.value || 'xlsx'),
              text: String(excel.text || excel.value || 'Excel'),
            };
          }
        }
      } catch {}
      return { name: '', id: '', value: 'xlsx', text: 'Excel (xlsx)' };
    };
    const excelValueForReportKey = (key, reportOption) => {
      const k = String(key || '');
      if (reportOption && (k === reportOption.name || k === reportOption.id)) return reportOption.value;
      if (/rapor.*tur|rapor.*tip|cikti|çıktı/i.test(k)) return reportOption?.value || 'xlsx';
      return 'xlsx';
    };
    const applyExcelReportParams = (params) => {
      if (!params || typeof params.set !== 'function' || !forceReportFormat) return false;
      const reportOption = getExcelReportOption();
      let changed = false;
      const setParam = (key, value) => {
        if (!key || key === 'raporTur') return;
        const next = String(value || 'xlsx');
        if (params.get(key) !== next) {
          params.set(key, next);
          changed = true;
        }
      };
      if (options.raporTur && !params.has('raporTur')) {
        params.set('raporTur', options.raporTur);
        changed = true;
      }
      if (reportOption.name) setParam(reportOption.name, reportOption.value);
      if (reportOption.id) setParam(reportOption.id, reportOption.value);
      for (const key of reportFormatKeys) setParam(key, excelValueForReportKey(key, reportOption));
      return changed;
    };
    const forceNestedExcelReportFields = (target, depth = 0) => {
      if (!forceReportFormat || !target || typeof target !== 'object' || depth > 5) return false;
      let changed = false;
      const reportOption = getExcelReportOption();
      const isRoot = depth === 0;
      if (isRoot && options.raporTur && (!target.params || typeof target.params !== 'object')) {
        target.params = {};
        changed = true;
      }
      if (isRoot && options.raporTur && target.params.raporTur !== options.raporTur) {
        target.params.raporTur = options.raporTur;
        changed = true;
      }
      for (const key of reportFormatKeys) {
        const value = excelValueForReportKey(key, reportOption);
        if (target[key] !== value) {
          target[key] = value;
          changed = true;
        }
        if (isRoot && target.params && target.params[key] !== value) {
          target.params[key] = value;
          changed = true;
        }
      }
      if (reportOption.name && target[reportOption.name] !== reportOption.value) {
        target[reportOption.name] = reportOption.value;
        changed = true;
      }
      if (reportOption.id && target[reportOption.id] !== reportOption.value) {
        target[reportOption.id] = reportOption.value;
        changed = true;
      }
      for (const key of Object.keys(target)) {
        const val = target[key];
        if (val && typeof val === 'object') {
          if (forceNestedExcelReportFields(val, depth + 1)) changed = true;
          continue;
        }
        if (typeof val !== 'string') continue;
        const trimmed = val.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const nestedChanged = forceNestedExcelReportFields(parsed, depth + 1);
          const next = JSON.stringify(parsed);
          if (nestedChanged || next !== val) {
            target[key] = next;
            changed = true;
          }
        } catch {}
      }
      return changed;
    };
    const forceNestedMizanDates = (target, depth = 0) => {
      if (!target || typeof target !== 'object' || depth > 5) return false;
      let changed = setAllMizanDateKeys(target);
      for (const key of Object.keys(target)) {
        const val = target[key];
        if (val && typeof val === 'object') {
          if (forceNestedMizanDates(val, depth + 1)) changed = true;
          continue;
        }
        if (typeof val !== 'string') continue;
        const trimmed = val.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const nestedChanged = forceNestedMizanDates(parsed, depth + 1);
          const next = JSON.stringify(parsed);
          if (nestedChanged || next !== val) {
            target[key] = next;
            changed = true;
          }
        } catch {}
      }
      return changed;
    };
    const forceMizanDatesBody = (body) => {
      try {
        if (body == null) return { body, changed: false, preview: '' };
        if (typeof body === 'string') {
          const trimmed = body.trim();
          if (trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed);
            const changedNested = forceNestedMizanDates(parsed);
            const changedReport = forceNestedExcelReportFields(parsed);
            const next = JSON.stringify(parsed);
            return {
              body: next,
              changed: changedNested || changedReport || next !== body,
              preview: next.slice(0, 420),
            };
          }
          if (trimmed.includes('=')) {
            const params = new URLSearchParams(trimmed);
            if (!skipDates) {
              for (const k of mizanStartKeys) params.set(k, slashBas);
              for (const k of mizanEndKeys) params.set(k, slashBit);
            }
            const changedReportParams = applyExcelReportParams(params);
            for (const [key, val] of Array.from(params.entries())) {
              const s = String(val || '').trim();
              if (!s.startsWith('{') && !s.startsWith('[')) continue;
              try {
                const parsed = JSON.parse(s);
                const changedDates = forceNestedMizanDates(parsed);
                const changedReport = forceNestedExcelReportFields(parsed);
                if (changedDates || changedReport) params.set(key, JSON.stringify(parsed));
              } catch {}
            }
            const next = params.toString();
            return { body: next, changed: changedReportParams || next !== body, preview: next.slice(0, 420) };
          }
        }
        if (body && typeof body.set === 'function' && typeof body.entries === 'function') {
          if (!skipDates) {
            for (const k of mizanStartKeys) body.set(k, slashBas);
            for (const k of mizanEndKeys) body.set(k, slashBit);
          }
          applyExcelReportParams(body);
          for (const [key, val] of Array.from(body.entries())) {
            if (typeof val !== 'string') continue;
            const s = val.trim();
            if (!s.startsWith('{') && !s.startsWith('[')) continue;
            try {
              const parsed = JSON.parse(s);
              const changedDates = forceNestedMizanDates(parsed);
              const changedReport = forceNestedExcelReportFields(parsed);
              if (changedDates || changedReport) body.set(key, JSON.stringify(parsed));
            } catch {}
          }
          return { body, changed: true, preview: skipDates ? '[FormData/URLSearchParams Excel zorlandi]' : '[FormData/URLSearchParams tarih zorlandi]' };
        }
      } catch (e) {
        return { body, changed: false, preview: `tarih body parse hata: ${e?.message || e}` };
      }
      return {
        body,
        changed: false,
        preview: String(body || '').slice(0, 240),
      };
    };

    if (!skipDates && tarihIlk && tarihSon) {
      // Luca slash formatı kullanıyor (network'ten görüldü: "01/03/2026")

      // Set + 5 kez deneme — Luca async olarak silebilir
      let setOk = false;
      for (let i = 0; i < 5; i++) {
        setNative(tarihIlk, slashBas);
        setNative(tarihSon, slashBit);
        await sleep(200);
        if (tarihIlk.value && tarihSon.value) {
          setOk = true;
          break;
        }
      }

      // Slash başarısızsa nokta dene
      if (!setOk) {
        for (let i = 0; i < 3; i++) {
          setNative(tarihIlk, tarih.bas);
          setNative(tarihSon, tarih.bit);
          await sleep(200);
          if (tarihIlk.value && tarihSon.value) {
            setOk = true;
            break;
          }
        }
      }

      await log(`📅 Tarih: ${tarihIlk.value || '∅'} → ${tarihSon.value || '∅'} (set ${setOk ? 'OK' : 'FAIL'})`);
    }

    const dateLikeInputs = skipDates ? [] : [...form.querySelectorAll('input')]
      .filter((inp) => /tarih|date|tar/i.test(`${inp.name || ''} ${inp.id || ''}`));
    let dateLikeChanged = 0;
    for (const inp of dateLikeInputs) {
      const key = `${inp.name || ''} ${inp.id || ''}`;
      const isStart = /ilk|bas|baş|start|from|_1\b|1$/i.test(key);
      const isEnd = /son|bit|end|to|_2\b|2$/i.test(key);
      if (isStart && !isEnd) {
        setNative(inp, slashBas);
        dateLikeChanged++;
      } else if (isEnd) {
        setNative(inp, slashBit);
        dateLikeChanged++;
      }
    }
    if (dateLikeInputs.length) {
      const state = dateLikeInputs
        .map((inp) => `${inp.name || inp.id || '?'}="${String(inp.value || '').slice(0, 20)}"`)
        .slice(0, 12)
        .join(' | ');
      await log(`🧷 Mizan tarih ID kontrolü (${dateLikeChanged}/${dateLikeInputs.length} set): ${state}`);
    }
    await preferExcelReportType(form, log, options.label || 'Mizan');
    if (options.raporTur) {
      await setRaporTuruExcel(form, log);
    }

    // Mizan formunun "Rapor" butonunu bul (sağ altta — exact text "Rapor")
    // DİKKAT: "Kümülatif Rapor" butonunu seçme — sadece "Rapor".
    const findExcelButton = () => {
      const doc = form.ownerDocument;
      const all = [
        ...form.querySelectorAll('input[type="button"], input[type="submit"], button, a'),
        ...doc.querySelectorAll('input[type="button"], input[type="submit"], button, a'),
      ];
      // 1. Tam eşleşme: text/value === "Rapor"
      for (const el of all) {
        const txt = (el.value || el.textContent || '').trim();
        if (txt === 'Rapor' || txt === 'RAPOR') return el;
      }
      // 2. Tam eşleşme: "Rapor Al" / "Excel'e Aktar" gibi
      for (const el of all) {
        const txt = (el.value || el.textContent || '').trim();
        if (/^rapor( al|u? hazırla|u? olustur)?$/i.test(txt)) return el;
        if (/excel.*aktar|aktar.*excel/i.test(txt)) return el;
      }
      // 3. onclick'inde "rapor", "jasper", "submitForm" var
      for (const el of all) {
        const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
        if (/raporIndir|jasper|rapor_tur|raporGetir|submitForm|raporAl/i.test(oc)) return el;
      }
      return null;
    };

    const excelBtn = findExcelButton();
    if (!excelBtn) {
      // Diagnostic: tüm tıklanabilir elementleri logla
      const doc = form.ownerDocument;
      const all = [...doc.querySelectorAll('input[type="button"], input[type="submit"], button, a, img[onclick]')];
      const list = all
        .map((el) => {
          const t = (el.value || el.textContent || el.title || el.alt || '').trim().slice(0, 25);
          const oc = (el.getAttribute && el.getAttribute('onclick') || '').slice(0, 40);
          return `[${el.tagName}]${t || '∅'}${oc ? `|onclick=${oc}` : ''}`;
        })
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 20)
        .join(' || ');
      throw new Error(`Excel butonu bulunamadı. Form'daki tıklanabilir elementler: ${list}`);
    }
    await log(`🎯 Buton bulundu: "${(excelBtn.value || excelBtn.textContent || excelBtn.title || excelBtn.alt || '').trim().slice(0, 30)}" [${excelBtn.tagName}]`);

    // PARALEL FLOW STRATEJİSİ — Luca button click → jasper.jq POST body yakala
    // → biz aynı body ile YENİ jasper.jq POST atalım → kendi rapor_id'mizle
    // rapor_takip + rapor_indir yapıp blob alalım. Luca'nın orijinal rapor_id'si
    // native download'da consume olur, bizimki bağımsız.
    let capturedBlob = null;
    let capturedUrl = null;
    let jasperBody = null;
    let jasperUrl = null;
    let rejectedBlobReason = '';
    const seenUrls = [];

    const forceExcelParams = (params) => {
      if (!params || typeof params.set !== 'function') return params;
      // Luca rapor_indir.jq bazen sadece donem_id + raporTur ile POST ediliyor.
      // Bu durumda formdaki Rapor Turu PDF kalsa PDF donuyor. Dosya tipini
      // indirme body seviyesinde de Excel'e zorla.
      applyExcelReportParams(params);
      return params;
    };

    const forceExcelJsonPayload = (value) => {
      if (!forceReportFormat || typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed.startsWith('{')) return value;
      try {
        const parsed = JSON.parse(value);
        forceNestedExcelReportFields(parsed);
        return JSON.stringify(parsed);
      } catch {
        return value;
      }
    };

    const blobSignature = async (blob) => {
      try {
        const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        const ascii = String.fromCharCode(...head).replace(/[^\x20-\x7E]/g, '?');
        const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join(' ');
        return { head, ascii, hex };
      } catch {
        return { head: new Uint8Array(), ascii: '', hex: '' };
      }
    };

    const acceptSpreadsheetBlob = async (blob, source, ct = '', filename = '') => {
      if (!blob || blob.size <= 1500 || capturedBlob) return false;
      const sig = await blobSignature(blob);
      const meta = `${ct || blob.type || ''} ${filename || ''}`;
      const isPdf = sig.ascii.startsWith('%PDF') || /application\/pdf|\.pdf\b/i.test(meta);
      if (isPdf) {
        rejectedBlobReason = `${source}: Luca PDF verdi. Rapor Turu Excel secilmeden import yapilamaz.`;
        await log(`❌ ${rejectedBlobReason} magic=${sig.hex}`);
        return false;
      }
      const isZip = sig.head[0] === 0x50 && sig.head[1] === 0x4b;
      const isOleXls = sig.head[0] === 0xd0 && sig.head[1] === 0xcf && sig.head[2] === 0x11 && sig.head[3] === 0xe0;
      const looksExcel = isZip || isOleXls || /xlsx|xls|spreadsheet|excel|officedocument|octet-stream|binary/i.test(meta);
      if (!looksExcel) {
        await log(`⚠ ${source}: Excel disi blob reddedildi (${Math.round(blob.size / 1024)} KB, ct=${String(ct).slice(0, 40)}, magic=${sig.hex})`);
        return false;
      }
      capturedBlob = blob;
      window.__morenCapturedBlob = blob;
      await log(`✅ Excel blob alindi: ${source} (${Math.round(blob.size / 1024)} KB, ct=${String(ct || blob.type || '').slice(0, 40)}, magic=${sig.hex})`);
      return true;
    };

    const isExcelResponse = (ct, blob) => {
      if (!ct) return false;
      return /excel|xlsx|spreadsheet|officedocument|octet-stream/i.test(ct);
    };
    const isExcelUrl = (url) => /\.xlsx|rapor_indir|raporIndir|jasper|download/i.test(url);

    const tryCapture = async (res, url) => {
      try {
        if (!res.ok) return;
        const ct = res.headers.get('content-type') || '';
        const cloned = res.clone();
        const blob = await cloned.blob();
        if (blob.size > 1500 && (isExcelResponse(ct, blob) || isExcelUrl(url))) {
          await acceptSpreadsheetBlob(blob, url.split('/').pop().slice(0, 60) || 'fetch', ct, url);
        }
      } catch (e) {}
    };

    // ─── FETCH override (top + tüm frameler) ───
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };

    const restoreFns = [];

    // Background script'e "şu andan itibaren Luca download'ı bekliyorum"
    // sinyali gönder. Bridge.js (sadece top frame'de yüklü) bunu
    // chrome.runtime.sendMessage ile background.js'e iletir. Flag yoksa
    // background download'a hiç dokunmuyor → moren-luca-file event'i hiç
    // ateşlemiyor → 90sn timeout. window.top kullan ki child frame'den
    // çağrılırsa bile bridge yakalasın.
    const postExpecting = (val) => {
      if (val && lucaManualDownloadMode()) return;
      const payload = { source: 'moren-agent', type: 'set-expecting', expecting: val };
      try { window.postMessage(payload, '*'); } catch (e) {}
      try { if (window.top && window.top !== window) window.top.postMessage(payload, '*'); } catch (e) {}
    };
    postExpecting(true);
    await log('🔔 Background\'a "download bekliyorum" sinyali gönderildi');
    restoreFns.push(() => postExpecting(false));

    const forcedBodyLabel = skipDates
      ? `${options.label || 'Rapor'} Excel zorlandi`
      : `Excel/tarih zorlandi: ${slashBas}->${slashBit}`;

    const installFetchOverride = (win, label) => {
      if (!win.fetch) return;
      const orig = win.fetch;
      restoreFns.push(() => { try { win.fetch = orig; } catch (e) {} });
      win.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input?.url || '');
        seenUrls.push(`${label}fetch:${url.split('?')[0].split('/').pop()}`);
        let args = arguments;
        if (/jasper\.jq/i.test(url || '') && init && init.body != null) {
          const fixed = forceMizanDatesBody(init.body);
          const nextBody = forceExcelJsonPayload(String(fixed.body || init.body || ''));
          jasperBody = String(nextBody || '');
          jasperUrl = url;
          if (fixed.changed || nextBody !== init.body) {
            args = [input, { ...init, body: nextBody }];
            log(`🧷 jasper.jq fetch ${forcedBodyLabel}; body=${String(nextBody).slice(0, 420)}`).catch(() => {});
          }
        }
        // PASIF: Luca akışını engelleme, sadece izle. Background script
        // disk'ten dosyayı okuyup bize iletecek.
        const promise = orig.apply(this, args);
        promise.then((res) => tryCapture(res, url)).catch(() => {});
        return promise;
      };
    };

    // ─── XHR override (rapor_takip polling izle, hazır olunca rapor_indir fetch et) ───
    const installXhrOverride = (win, label) => {
      if (!win.XMLHttpRequest) return;
      const proto = win.XMLHttpRequest.prototype;
      const origOpen = proto.open;
      const origSend = proto.send;
      restoreFns.push(() => { try { proto.open = origOpen; proto.send = origSend; } catch (e) {} });
      proto.open = function (method, url) {
        this._capturedUrl = url;
        this._capturedMethod = method;
        return origOpen.apply(this, arguments);
      };
      proto.send = function (body) {
        const url = this._capturedUrl || '';
        let sendBody = body;
        if (/jasper\.jq/i.test(url || '')) {
          const fixed = forceMizanDatesBody(body);
          sendBody = forceExcelJsonPayload(String(fixed.body || body || ''));
          jasperBody = String(sendBody || '');
          jasperUrl = url;
          if (fixed.changed || sendBody !== body) {
            log(`🧷 jasper.jq XHR ${forcedBodyLabel}; body=${String(sendBody).slice(0, 420)}`).catch(() => {});
          } else {
            log(skipDates
              ? `🧷 jasper.jq XHR Excel kontrolu: body=${fixed.preview}`
              : `🧷 jasper.jq XHR tarih kontrolü: beklenen ${slashBas}→${slashBit}; body=${fixed.preview}`).catch(() => {});
          }
        }
        this._capturedBody = sendBody;
        seenUrls.push(`${label}xhr:${url.split('?')[0].split('/').pop()}`);
        // PASIF: Luca akışını engelleme, native download'a izin ver.
        this.addEventListener('load', async () => {
          try {
            const ct = this.getResponseHeader('content-type') || '';

            // 1) XHR response Blob ise (Excel) — Luca'nın rapor_indir.jq response'unu yakalama şansı
            if (this.response && this.response instanceof Blob) {
              if (this.response.size > 1500 && (isExcelResponse(ct) || isExcelUrl(url))) {
                if (await acceptSpreadsheetBlob(this.response, `XHR ${url.split('/').pop().slice(0, 40)}`, ct, url)) return;
              }
            }
            // Tanı için: rapor_indir veya jasper.jq XHR'ı görüldüyse logla
            if (/rapor_indir|jasper\.jq|raporIndir/i.test(url)) {
              const sz = (this.response && this.response.size) || (this.responseText || '').length;
              await log(`📡 ${url.split('?')[0].split('/').pop()} XHR: ${this.status} · ct=${(ct || '').slice(0, 40)} · size≈${sz}`);

              // Luca yeni akışta jasper.jq direkt Excel binary dönüyor olabilir.
              // Response Blob değilse de arrayBuffer yorumlamayı deneyelim — content-type
              // excel/spreadsheet/octet-stream içeriyorsa.
              if (!capturedBlob && this.status === 200 && sz > 5000 &&
                  /excel|xlsx|spreadsheet|officedocument|octet-stream/i.test(ct || '')) {
                try {
                  // responseType blob değilse, responseText'ten Blob yarat
                  const data = this.response instanceof Blob
                    ? this.response
                    : (this.responseText
                        ? new Blob([this.responseText], { type: ct || 'application/vnd.ms-excel' })
                        : null);
                  if (data && data.size > 1500) {
                    await acceptSpreadsheetBlob(data, url.split('/').pop().slice(0, 30), ct, url);
                  }
                } catch (e) {
                  await log(`⚠ ${url.split('/').pop()} blob convert hata: ${e.message}`);
                }
              }
            }

            // KAPATILDI — Önceden agent burada rapor_takip durum=150 görür görmez
            // kendi rapor_indir.jq POST'unu atıyordu, ama Luca o body'yi
            // (rapor_takip body'si) reddediyor: "Parameter okhttp3.FormBody.add null".
            // Native flow zaten gonder() ile doğru istekleri yapıyor; biz sadece
            // chrome.downloads ile inen dosyayı bridge üzerinden yakalıyoruz.
            // Diagnostic log bırakıldı — durum görünür kalsın:
            if (/rapor_takip/i.test(url) && !this._loggedDiag) {
              this._loggedDiag = true;
              const respStr = (this.responseText || '').slice(0, 200);
              const durum = (respStr.match(/"durum"\s*:\s*(\d+)/) || [])[1];
              log(`🔍 rapor_takip durum=${durum || '?'} (Luca'nın native flow'u sürdürülüyor)`).catch(() => {});
            }
          } catch (e) {}
        });
        return origSend.call(this, sendBody);
      };
    };

    // ─── ANCHOR <a download> click override (native download intercept) ───
    const installAnchorOverride = (win, label) => {
      if (!win.HTMLAnchorElement) return;
      const proto = win.HTMLAnchorElement.prototype;
      const origClick = proto.click;
      restoreFns.push(() => { try { proto.click = origClick; } catch (e) {} });
      proto.click = function () {
        if (lucaManualDownloadMode()) return origClick.apply(this, arguments);
        const href = this.href || '';
        seenUrls.push(`${label}aclick:${href.split('?')[0].split('/').pop()}`);
        if (isExcelUrl(href)) {
          // URL'i yakala, biz fetch ederiz (native download tetikletme)
          capturedUrl = href;
          log(`🔗 Anchor download URL yakalandı: ${href.split('/').pop().slice(0, 80)}`).catch(() => {});
          return; // native click'i atla
        }
        return origClick.apply(this, arguments);
      };
    };

    // ─── window.open override — Luca gonder() yeni tab açıyorsa URL'i yakala ───
    const installWindowOpenOverride = (win, label) => {
      const origOpen = win.open;
      if (typeof origOpen !== 'function') return;
      restoreFns.push(() => { try { win.open = origOpen; } catch (e) {} });
      win.open = function (url, name, features) {
        if (lucaManualDownloadMode()) return origOpen.apply(this, arguments);
        try {
          const urlStr = url ? String(url) : '';
          seenUrls.push(`${label}open:${urlStr.split('?')[0].split('/').pop()}`);
          log(`🪟 window.open: ${urlStr.slice(0, 100)}`).catch(() => {});
          if (urlStr && (isExcelUrl(urlStr) || /rapor|jasper|indir|download|export/i.test(urlStr))) {
            capturedUrl = urlStr.startsWith('http') ? urlStr : `${win.location.origin}${urlStr.startsWith('/') ? '' : '/'}${urlStr}`;
            log(`🎯 window.open yakalandı, fetch'leyeceğiz: ${capturedUrl.split('/').pop().slice(0, 80)}`).catch(() => {});
            // Yeni tab açtırmıyoruz — biz fetch edeceğiz
            return null;
          }
        } catch (e) {}
        return origOpen.apply(this, arguments);
      };
    };

    // ─── form submit override — gonder() form.submit() yapıyorsa intercept et ───
    // Luca'nın akışı: rapor_takip durum=150 → <form action="rapor_indir.jq" method="POST">.submit()
    // → frame yenileniyor, Excel response geliyor ama interceptor'lar kayboluyor.
    // Çözüm: submit'i engelle, biz fetch ile POST'layıp Blob'u yakala.
    const installFormSubmitOverride = (win, label) => {
      if (!win.HTMLFormElement) return;
      const proto = win.HTMLFormElement.prototype;
      const origSubmit = proto.submit;
      restoreFns.push(() => { try { proto.submit = origSubmit; } catch (e) {} });
      proto.submit = function () {
        if (lucaManualDownloadMode()) return origSubmit.apply(this, arguments);
        try {
          const action = this.action || '';
          const method = (this.method || 'GET').toUpperCase();
          const target = this.target || '';
          seenUrls.push(`${label}submit:${action.split('?')[0].split('/').pop()}@${target}`);
          log(`📝 form.submit() action=${action.split('/').pop().slice(0, 50)} method=${method} target=${target}`).catch(() => {});

          const isExcelForm =
            isExcelUrl(action) || /rapor_indir|raporIndir|jasper|export|download/i.test(action);

          if (isExcelForm && !this._morenSubmitting) {
            this._morenSubmitting = true; // aynı form için 4 submit'i tek POST'a indir
            (async () => {
              try {
                // FormData ile tüm input değerlerini topla — Luca POST body'sini hazırlamış olur
                const fd = new FormData(this);
                // Multipart yerine application/x-www-form-urlencoded'a çevir — Luca genelde bunu bekler
                const params = new URLSearchParams();
                fd.forEach((v, k) => params.append(k, String(v)));
                forceExcelParams(params);

                const fullUrl = action.startsWith('http')
                  ? action
                  : new URL(action, win.location.href).toString();
                const bodyPreview = params.toString().slice(0, 200);
                await log(`🎯 form intercept: ${method} ${fullUrl.split('/').pop().slice(0, 50)} (${params.toString().length} byte) Excel body: ${bodyPreview}`);

                const fetchOpts = {
                  method,
                  credentials: 'include',
                  headers: {},
                };
                if (method === 'POST') {
                  fetchOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                  fetchOpts.body = params.toString();
                }

                const r = await win.fetch(method === 'GET' ? `${fullUrl}?${params.toString()}` : fullUrl, fetchOpts);
                if (!r.ok) {
                  await log(`⚠ form fetch HTTP ${r.status}`);
                  return;
                }
                const ct = r.headers.get('content-type') || '';
                const blob = await r.blob();
                if (blob.size > 1500) {
                  await acceptSpreadsheetBlob(blob, 'form intercept', ct, fullUrl);
                } else {
                  const txt = await blob.text();
                  await log(`⚠ form fetch küçük (${blob.size}B): ${txt.slice(0, 120)}`);
                }
              } catch (e) {
                await log(`⚠ form intercept hata: ${e.message}`);
              } finally {
                this._morenSubmitting = false;
              }
            })().catch(() => {});

            return; // native submit'i atla — frame yenilenmesin
          }

          // target="_blank" ise eski hale çek (Excel olmayan formlar için)
          if (target === '_blank' || target === 'new' || /win\d+/.test(target)) {
            try {
              this.removeAttribute('target');
              log(`🔧 form target="_blank" kaldırıldı`).catch(() => {});
            } catch (e) {}
          }
        } catch (e) {}
        return origSubmit.apply(this, arguments);
      };
    };

    // Top + tüm frame'lere yükle
    installFetchOverride(window, '');
    installXhrOverride(window, '');
    installAnchorOverride(window, '');
    installWindowOpenOverride(window, '');
    installFormSubmitOverride(window, '');
    for (const f of collectFrames(document)) {
      try {
        const fwin = f.contentWindow;
        if (!fwin || fwin === window) continue;
        const lbl = `[${f.name || '?'}]`;
        installFetchOverride(fwin, lbl);
        installXhrOverride(fwin, lbl);
        installAnchorOverride(fwin, lbl);
        installWindowOpenOverride(fwin, lbl);
        installFormSubmitOverride(fwin, lbl);
      } catch (e) {}
    }

    // Tıklama öncesi tarih input value'sunu kontrol et
    if (tarihIlk && tarihSon) {
      await log(`🔎 Click öncesi: TARIH_ILK="${tarihIlk.value}" | TARIH_SON="${tarihSon.value}"`);
    }

    // Bridge'den gelen Luca download URL'ini dinle (background script chrome.downloads
    // intercepted etti + iptal etti, URL'i bize gönderiyor)
    const onBridgeMessage = async (event) => {
      const data = event.data;
      if (data?.source !== 'moren-bridge' || data?.type !== 'lucaDownload') return;
      const dlUrl = data.url;
      if (!dlUrl || capturedBlob) return;
      await log(`🌉 Background'tan download URL geldi: ${dlUrl.split('/').pop().slice(0, 60)}`);
      try {
        const r = await fetch(dlUrl, { credentials: 'include' });
        if (r.ok) {
          const ct = r.headers.get('content-type') || '';
          const blob = await r.blob();
          if (blob.size > 1500) {
            await acceptSpreadsheetBlob(blob, 'Bridge URL fetch', ct, dlUrl);
          } else {
            await log(`⚠ Bridge URL fetch küçük dosya (${blob.size}B)`);
          }
        } else {
          await log(`⚠ Bridge URL fetch HTTP ${r.status}`);
        }
      } catch (e) {
        await log(`⚠ Bridge URL fetch hata: ${e.message}`);
      }
    };
    window.addEventListener('message', onBridgeMessage);
    restoreFns.push(() => { window.removeEventListener('message', onBridgeMessage); });

    await log(`🖱 "Rapor" butonu 1 kez tıklanıyor`);

    // SADE: tek native click — onclick attribute'unu zaten tetikler.
    // Önceden 4 farklı yöntemle tıklatıyorduk (native + jQuery + onclick eval +
    // fullActivate), her biri aynı handler'ı tetikleyip 2 mizan indiriyordu.
    try { excelBtn.click(); } catch (e) { await log(`⚠ click() hata: ${e.message}`); }

    // YENİ STRATEJİ: Background script disk'ten Excel'i okuyup bize iletecek.
    // moren-luca-file event'ini dinle.
    const onLucaFile = async (e) => {
      const detail = e.detail || {};
      const blob = detail.blob;
      if (capturedBlob) return;
      if (blob && blob.size > 1500) {
        await acceptSpreadsheetBlob(blob, 'Background disk', blob.type || '', detail.filename || '');
      } else if (detail.filename) {
        await log(`⚠ Background dosyayı diskten okuyamadı: ${detail.filename}. file:// permission yok olabilir.`);
      }
    };
    window.addEventListener('moren-luca-file', onLucaFile);
    restoreFns.push(() => window.removeEventListener('moren-luca-file', onLucaFile));

    // Native download gelmezse aynı jasper body ile paralel rapor indirme fallback'i.
    // Bazı Luca oturumlarında rapor_takip çalışıyor ama disk download event'i düşmüyor.
    (async () => {
      // Body yakalanmasını bekle (max 15 sn)
      for (let i = 0; i < 75; i++) {
        if (jasperBody) break;
        await sleep(200);
      }
      if (!jasperBody) {
        await log(`⚠ jasper.jq body 15sn içinde yakalanamadı`);
        return;
      }

      try {
        await log(`🔄 Agent flow başlıyor (Luca abort edildi, tek session)`);
        // Bizim isteklerimizi interceptor'dan koruma flag'i
        const agentInit = (extra = {}) => ({
          ...extra,
          credentials: 'include',
          // Init objesinin değişmesi için fetch interceptor da bunu görsün
          _morenAgentRequest: true,
        });
        // Native fetch'i interceptor'dan kaçırmak için — direct origFetch kullan
        const directFetch = (url, init) => {
          const realInit = { ...init, credentials: 'include' };
          // Custom flag interceptor için
          realInit._morenAgentRequest = true;
          return form.ownerDocument.defaultView.fetch(url, realInit);
        };

        // 1) Yeni jasper.jq POST → bizim rapor_id
        const fullJasperUrl = jasperUrl.startsWith('http')
          ? jasperUrl
          : new URL(jasperUrl, form.ownerDocument.defaultView.location.href).toString();
        const r1 = await directFetch(fullJasperUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jasperBody,
        });
        if (!r1.ok) {
          await log(`⚠ Yeni jasper.jq HTTP ${r1.status}`);
          return;
        }
        const r1text = await r1.text();
        await log(`📥 Yeni jasper.jq response (${r1text.length}B): ${r1text.slice(0, 150)}`);

        // 2) rapor_takip polling (genel/rapor_takip.jq POST)
        // Body: {"donem_id":"X","params":{"raporTur":"mizan"}}
        let donemId = '';
        let raporTur = options.raporTur || '';
        try {
          const parsed = JSON.parse(jasperBody);
          donemId = parsed.donem_id || '';
          raporTur = raporTur || parsed.params?.raporTur || parsed.raporTur || '';
        } catch (e) {}
        if (!donemId) {
          // jasperBody'den manual olarak çıkar
          const dm = jasperBody.match(/"donem_id"\s*:\s*"?(\d+)"?/);
          donemId = dm ? dm[1] : '';
        }
        if (!raporTur && String(jasperBody || '').includes('=')) {
          try {
            const params = new URLSearchParams(jasperBody);
            raporTur = params.get('raporTur') || params.get('rapor_turu') || params.get('RAPOR_TURU') || '';
          } catch {}
        }
        if (!donemId) {
          donemId = form.querySelector('input[name="DONEM_ID"], input[name="donem_id"]')?.value || '';
        }
        if (!raporTur && !skipDates) raporTur = 'mizan';
        const takipParams = {
          dosya_tipi: 'xlsx',
          format: 'xlsx',
          REPORT_TYPE: 'xlsx',
        };
        if (raporTur) takipParams.raporTur = raporTur;
        const takipBody = JSON.stringify({
          donem_id: donemId,
          params: takipParams,
        });
        const baseGenelUrl = `${form.ownerDocument.defaultView.location.origin}/Luca/genel`;

        for (let i = 0; i < 30; i++) {
          if (capturedBlob) return;
          await sleep(2000);
          try {
            const r2 = await directFetch(`${baseGenelUrl}/rapor_takip.jq`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: takipBody,
            });
            const r2text = await r2.text();
            const dm = r2text.match(/"durum"\s*:\s*(\d+)|\bdurum\s*[:=]\s*(\d+)|^\s*(\d{1,3})\s*$/i);
            const durum = dm ? (dm[1] || dm[2] || dm[3] || '') : '';
            if (i === 0 || i % 5 === 0) {
              await log(`⏳ Polling ${i + 1}/30: durum=${durum || '?'} resp=${r2text.slice(0, 80)}`);
            }
            // Durum 150 = tamamlandı
            if (durum === '150' || /başarılı bir şekilde oluştur/i.test(r2text)) {
              await log(`✓ Bizim rapor hazır (durum=${durum})`);
              break;
            }
          } catch (e) {
            await log(`⚠ Polling hata: ${e.message}`);
          }
        }

        if (capturedBlob) return;

        // 3) rapor_indir POST → Excel binary
        await log(`📥 rapor_indir.jq POST atılıyor`);
        const r3 = await directFetch(`${baseGenelUrl}/rapor_indir.jq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jasperBody,
        });
        if (r3.ok) {
          const ct = r3.headers.get('content-type') || '';
          const blob = await r3.blob();
          if (blob.size > 1500) {
            await acceptSpreadsheetBlob(blob, 'Paralel flow', ct, `${baseGenelUrl}/rapor_indir.jq`);
          } else {
            const t = await blob.text();
            await log(`⚠ rapor_indir POST küçük (${blob.size}B): ${t.slice(0, 150)}`);
            const rTakipBody = await directFetch(`${baseGenelUrl}/rapor_indir.jq`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: takipBody,
            }).catch(() => null);
            if (rTakipBody?.ok) {
              const takipCt = rTakipBody.headers.get('content-type') || '';
              const blobTakip = await rTakipBody.blob();
              if (blobTakip.size > 1500) {
                if (await acceptSpreadsheetBlob(blobTakip, 'rapor_indir takip body', takipCt, `${baseGenelUrl}/rapor_indir.jq`)) return;
              }
            }
            // GET fallback
            const r4 = await directFetch(`${baseGenelUrl}/rapor_indir.jq`, {});
            if (r4.ok) {
              const ct4 = r4.headers.get('content-type') || '';
              const blob4 = await r4.blob();
              if (blob4.size > 1500) {
                await acceptSpreadsheetBlob(blob4, 'rapor_indir GET', ct4, `${baseGenelUrl}/rapor_indir.jq`);
              }
            }
          }
        } else {
          await log(`⚠ rapor_indir HTTP ${r3.status}: ${(await r3.text()).slice(0, 100)}`);
        }
      } catch (e) {
        await log(`⚠ Paralel flow hata: ${e.message}`);
      }
    })().catch(() => {});

    // 90 saniye bekle: blob yakalanana veya download URL yakalanana kadar
    let waited = 0;
    while (waited < 90000) {
      if (capturedBlob) break;
      // Anchor click intercept ettiysek, URL'i biz fetch edelim
      if (capturedUrl) {
        try {
          await log(`🌐 Yakalanan URL fetch ediliyor: ${capturedUrl.split('/').pop().slice(0, 60)}`);
          const r = await fetch(capturedUrl, { credentials: 'include' });
          if (r.ok) {
            const ct = r.headers.get('content-type') || '';
            const blob = await r.blob();
            if (blob.size > 1500) {
              await acceptSpreadsheetBlob(blob, 'Yakalanan URL', ct, capturedUrl);
              if (capturedBlob) break;
            }
          }
        } catch (e) {
          await log(`⚠ URL fetch hata: ${e.message}`);
        }
        capturedUrl = null; // tekrar tekrar denememe
      }
      await sleep(500);
      waited += 500;
      if (waited === 5000 || waited === 15000 || waited === 30000 || waited === 60000) {
        await log(`⏳ ${waited / 1000}sn bekledi — istekler: ${seenUrls.slice(-12).join(' | ')}`);
      }
    }

    // Tüm interceptor'ları restore et
    for (const restore of restoreFns) {
      try { restore(); } catch (e) {}
    }

    if (!capturedBlob) {
      throw new Error(`${rejectedBlobReason || 'Excel yakalanamadı (90sn).' } İstekler: ${seenUrls.slice(-20).join(' | ')}`);
    }

    return capturedBlob;
  }

  /**
   * İHÖ (İşletme Hesap Özeti) — Luca'da menü yolu izleyerek Excel indirir.
   * v1.36.17: artık fetchLucaIsletmeGelirGiderExcel'e mode='both' ile delegate eder.
   * Bu sayede proper XHR/Fetch/Download hook'ları kullanılır (PDF değil Excel iner).
   */
  async function fetchLucaGelirGiderListesi(job, upstreamLog = null) {
    const log = async (msg) => {
      if (typeof upstreamLog === 'function') {
        await upstreamLog(msg);
        return;
      }
      if (window.__currentLucaJobId && window.__lucaJobLog) {
        await window.__lucaJobLog(window.__currentLucaJobId, msg);
      } else { console.log('[Moren İHÖ]', msg); }
    };
    await log('İHÖ → fetchLucaIsletmeGelirGiderExcel(mode=both) ile delegate ediliyor');
    return await fetchLucaIsletmeGelirGiderExcel(job, log, 'both');
  }

  /**
   * Luca yeni API (jasper.jq) ile Mizan Excel'i indir.
   * Eski raporMizanAction.do form-urlencoded → boş Excel dönüyordu.
   */
  async function fetchMizanViaJasperJq(form, job, log) {
    // donem_id formdan oku
    const donemId = form.querySelector('input[name="DONEM_ID"]')?.value
      || form.querySelector('input[name="donem_id"]')?.value
      || '';

    // sirket_id form'da yok — frm4'teki SirketCombo veya başka bir yerden bulmalı.
    // Tüm frame'leri RECURSIVE tara, "irket" içeren select bul.
    const collectFrames = (root, depth = 0, acc = []) => {
      if (depth > 5) return acc;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          acc.push(f);
          if (f.contentDocument) collectFrames(f.contentDocument, depth + 1, acc);
        }
      } catch (e) {}
      return acc;
    };

    let sirketId = '';
    const frames = collectFrames(document);
    for (const f of frames) {
      if (!f.contentDocument) continue;
      try {
        const combo = f.contentDocument.querySelector('select[name="SirketCombo"]')
          || f.contentDocument.querySelector('select[name*="irket"]')
          || f.contentDocument.querySelector('select[name*="Sirket"]')
          || f.contentDocument.querySelector('select[name*="firma"]')
          || f.contentDocument.querySelector('select[name*="Firma"]');
        if (combo && combo.value) {
          sirketId = combo.value;
          await log(`✓ sirket_id frame "${f.name || '?'}" / select "${combo.name}"den okundu: ${sirketId}`);
          break;
        }
      } catch (e) {}
    }

    // Hâlâ bulunamadıysa, top window'da global JS variable arayalım
    if (!sirketId) {
      try {
        sirketId = String(window.SIRKET_ID || window.sirketId || window.SirketId
          || window.top?.SIRKET_ID || window.top?.sirketId || '');
      } catch (e) {}
    }

    if (!donemId) {
      throw new Error('DONEM_ID form\'da bulunamadı');
    }
    if (!sirketId) {
      // Diagnostic: tüm frame'lerdeki tüm select'leri logla
      const allSelects = [];
      for (const f of frames) {
        if (!f.contentDocument) continue;
        try {
          for (const s of f.contentDocument.querySelectorAll('select')) {
            allSelects.push(`${f.name || '?'}:${s.name || s.id || '?'}=${(s.value || '').slice(0, 20)}`);
          }
        } catch (e) {}
      }
      throw new Error(`sirket_id bulunamadı. Mevcut select'ler: ${allSelects.slice(0, 10).join(' | ')}`);
    }

    // Tarihleri slash formatına çevir
    const tarih = donemToTarihAraligi(job.donem, job.donemTipi);
    if (!tarih) throw new Error(`Tarih hesaplanamadı: ${job.donem}`);
    const slash = (s) => String(s).replace(/\./g, '/');

    const payload = {
      kurTarihYeni: '',
      tarih_ilk: slash(tarih.bas),
      tarih_son: slash(tarih.bit),
      hesap_bas: '',
      hesap_bit: '',
      hesap_boyu_bas: '',
      hesap_boyu_bit: '',
      hesap_tipi: null,
      hesap_plani_dovizi_goster: '1',
      fis_tipi: null,
      fis_kodu: null,
      bakiye_goster: '1',
      bakiye_tipi: '1',
      dil: 'tr',
      alanlar: '2',
      genel_toplam_goster: '2',
      kurKodYeni: '0',
      kurTypeYeni: '1',
      tutarYeni: '',
      doviz_multiple: 'tl',
      sistem_doviz_sembol: 'TL',
      tarih_yazdir: 'H',
      sayfa_numarasi_yazdir: 'H',
      report_type: 'LIST',
      font: 'Calibri',
      alt_bilgi_yazdir: 'H',
      donem_id: donemId,
      sirket_id: sirketId,
      tur: 'mizan',
      doviz: ['tl'],
      email_hesap: null,
    };

    await log(`🆕 jasper.jq akışı: tarih=${payload.tarih_ilk}→${payload.tarih_son}, donem_id=${donemId}, sirket_id=${sirketId}`);

    // 1) jasper.jq → rapor_id al
    const jasperUrl = `${location.origin}/Luca/jasper.jq?rapor_tur=mizan`;
    await log(`🚀 POST ${jasperUrl.split('/').pop()}`);
    const jasperRes = await fetch(jasperUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!jasperRes.ok) {
      throw new Error(`jasper.jq HTTP ${jasperRes.status}`);
    }
    const jasperText = await jasperRes.text();
    await log(`📥 jasper.jq response (${jasperText.length}B): ${jasperText.slice(0, 200)}`);

    // Response'u parse et — rapor_id veya benzeri ID dönmesi bekleniyor
    let raporId = null;
    try {
      const parsed = JSON.parse(jasperText);
      raporId = parsed.rapor_id || parsed.raporId || parsed.id || parsed.reportId;
      if (!raporId && parsed.data) {
        raporId = parsed.data.rapor_id || parsed.data.raporId || parsed.data.id;
      }
    } catch (e) {
      // JSON değilse, direkt string'i ID kabul et (bazı eski API'ler öyle)
      if (/^\d+$/.test(jasperText.trim())) raporId = jasperText.trim();
    }

    if (!raporId) {
      throw new Error(`jasper.jq response'dan rapor_id alınamadı: ${jasperText.slice(0, 300)}`);
    }
    await log(`✓ rapor_id alındı: ${raporId}`);

    // 2) rapor_takip.jq — rapor hazırlanıyor, polling
    const takipUrl = `${location.origin}/Luca/rapor_takip.jq?rapor_id=${raporId}`;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60s timeout
    let raporHazir = false;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const takipRes = await fetch(takipUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rapor_id: raporId }),
        });
        const takipText = await takipRes.text();
        // "ready" / "tamam" / "1" gibi durum bekleniyor
        if (/ready|tamam|finish|done|hazir|complete|"1"|^1$/i.test(takipText.trim())) {
          raporHazir = true;
          await log(`✓ Rapor hazır (deneme ${attempts}/${maxAttempts})`);
          break;
        }
        if (attempts === 1 || attempts % 5 === 0) {
          await log(`⏳ Polling ${attempts}/${maxAttempts}: ${takipText.slice(0, 80)}`);
        }
      } catch (e) {
        await log(`⚠ Polling hata: ${e.message}`);
      }
      await sleep(2000);
    }

    if (!raporHazir) {
      await log(`⚠ Polling timeout — yine de indirme deneniyor`);
    }

    // 3) rapor_indir.jq → Excel binary
    const indirUrl = `${location.origin}/Luca/rapor_indir.jq?rapor_id=${raporId}`;
    await log(`📥 GET ${indirUrl.split('/').pop()}`);
    const indirRes = await fetch(indirUrl, {
      method: 'GET',
      credentials: 'include',
    });
    if (!indirRes.ok) {
      throw new Error(`rapor_indir.jq HTTP ${indirRes.status}`);
    }
    const blob = await indirRes.blob();
    if (blob.size < 1000) {
      const text = await blob.text().catch(() => '');
      throw new Error(`Dönen dosya çok küçük (${blob.size}B): ${text.slice(0, 120)}`);
    }
    await log(`✅ Excel yakalandı (${Math.round(blob.size / 1024)} KB)`);
    return blob;
  }

  /**
   * Generic fallback — eski mantık. Job tipi henüz Mizan dışındaysa
   * sayfada "Excel" yazan butonu arar + tıklar, fetch interceptor ile blob yakalar.
   */
  async function fetchLucaGenericExcel(job, log) {
    await log('⚠ Generic Excel button arama (job tipi henüz tam otomatik değil)');
    const excelBtn =
      [...document.querySelectorAll('button,a')].find((el) =>
        /excel|xlsx/i.test(el.textContent || ''),
      ) || document.querySelector('a[href*=".xlsx"]');
    if (!excelBtn) {
      throw new Error(
        'Luca ekranında Excel indirme butonu bulunamadı — ekranı manuel açıp tekrar deneyin',
      );
    }

    const originalFetch = window.fetch;
    let captured = null;
    window.fetch = async function (...args) {
      const res = await originalFetch.apply(this, args);
      try {
        const ct = res.headers.get('content-type') || '';
        if (
          ct.includes('spreadsheet') ||
          ct.includes('excel') ||
          (typeof args[0] === 'string' && args[0].includes('.xlsx'))
        ) {
          const clone = res.clone();
          captured = await clone.blob();
        }
      } catch {}
      return res;
    };

    try {
      excelBtn.click();
      const t0 = Date.now();
      while (!captured && Date.now() - t0 < 20000) {
        await sleep(250);
      }
    } finally {
      window.fetch = originalFetch;
    }
    return captured;
  }

  // === UI ===
  // v1.36.21: SADECE TOP frame'de panel olustur (Luca FRAMESET'inde 11 frame'de
  // ayrı ayrı panel yaratiyordu — kullanici 2+ panel goruyordu).
  // Counter'lar her zaman hazir (frame'lerden cagrilir), panel sadece top'ta.
  const counters = { onay: 0, atla: 0, demirbas: 0, hata: 0, toplam: 0 };
  let panel = null;
  let $status = null;
  let $count = null;
  let setStatus = (_s) => {};
  let setCount = () => {};
  function resetCounters() {
    counters.onay = 0;
    counters.atla = 0;
    counters.demirbas = 0;
    counters.hata = 0;
    counters.toplam = 0;
    setCount();
  }

  if (window === window.top) {
    // Pozisyon kalici: localStorage'da sakla, default sag alt kose
    const POS_KEY = 'moren_agent_panel_pos';
    let savedPos = null;
    try { savedPos = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch {}

    panel = document.createElement('div');
    panel.id = 'moren-agent-panel';
    // Default pozisyon: sag alt kose (right:8px;bottom:8px)
    // Kayitli pozisyon varsa onu kullan
    const posStyle = savedPos && typeof savedPos.left === 'number'
      ? `left:${savedPos.left}px;top:${savedPos.top}px;`
      : 'right:8px;bottom:8px;';
    panel.style.cssText =
      `position:fixed;${posStyle}z-index:2147483647;background:rgba(15,13,11,.92);color:#fafaf9;font:12px/1.3 -apple-system,sans-serif;border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:220px;border:1px solid #b8a06f;cursor:move;user-select:none`;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:8px;height:8px;border-radius:50%;background:#10b981;animation:pulse 1.5s infinite"></div>
        <b style="color:#b8a06f;letter-spacing:.08em;font-size:11px;text-transform:uppercase">MOREN AGENT</b>
        <button id="ma-stop" style="margin-left:auto;background:rgba(239,68,68,.2);color:#ef4444;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer">DUR</button>
      </div>
      <div id="ma-status" style="color:rgba(250,250,249,.7);font-size:12px">Bekleniyor…</div>
      <div id="ma-count" style="margin-top:6px;font-size:11px;color:rgba(250,250,249,.5)"></div>`;
    // DOM hazır mı bekle — Luca framesetinde body geç yükleniyor, body null
    // iken appendChild crash atıyor ve TÜM runtime ölüyor, job pending'de
    // takılı kalıyordu. body/head hazır olunca enjekte et.
    const style = document.createElement('style');
    style.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}';
    const injectWhenReady = () => {
      if (!document.body || !document.head) {
        return setTimeout(injectWhenReady, 100);
      }
      try { document.body.appendChild(panel); } catch (e) { console.warn('[Moren] panel inject', e?.message); }
      try { document.head.appendChild(style); } catch (e) {}
    };
    injectWhenReady();
    // panel detached node iken querySelector çalışır — panel henüz DOM'a
    // eklenmemiş olsa bile $status/$count tutucularını ayarlayabiliriz.
    $status = panel.querySelector('#ma-status');
    $count = panel.querySelector('#ma-count');
    setStatus = (s) => { if ($status) $status.textContent = s; };
    setCount = () => { if ($count) $count.textContent = `✓${counters.onay} ⏭${counters.atla} ⏩${counters.demirbas} ⚠${counters.hata}`; };
    // Dur butonu — panel.querySelector kullan (document.getElementById panel
    // henüz inject edilmemişse null döner).
    const stopBtn = panel.querySelector('#ma-stop');
    if (stopBtn) {
      stopBtn.onclick = () => {
        window.__morenAgent.stopRequested = true;
        setStatus('Durduruluyor…');
      };
    }
    // Sürükle-bırak + pozisyonu localStorage'a yaz
    (function(){
      let dx=0,dy=0,dragging=false;
      panel.addEventListener('mousedown',(e)=>{if(e.target.tagName==='BUTTON')return;dragging=true;const r=panel.getBoundingClientRect();dx=e.clientX-r.left;dy=e.clientY-r.top;e.preventDefault();});
      document.addEventListener('mousemove',(e)=>{
        if(!dragging)return;
        const left = e.clientX-dx;
        const top = e.clientY-dy;
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      });
      document.addEventListener('mouseup',()=>{
        if (dragging) {
          dragging = false;
          // Pozisyonu kaydet
          try {
            const r = panel.getBoundingClientRect();
            localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
          } catch {}
        }
      });
    })();
  }
  // Frame'lerden cagrilirsa setStatus/setCount sessizce calistir (no-op)

  // === HELPERS ===
  // sleep helper is defined near the top because login polling can run before
  // this lower utility section is reached in injected/headless contexts.

  function getRequestUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input.url === 'string') return input.url;
    } catch {}
    return '';
  }

  function isMihsapSaveRequest(method, url, body) {
    const m = String(method || 'GET').toUpperCase();
    if (!/^(POST|PUT|PATCH|DELETE)$/.test(m)) return false;
    const u = String(url || '');
    const bodyText = typeof body === 'string' ? body : '';
    const hay = `${u} ${bodyText}`.toLowerCase();
    if (/morenmusavirlik|mali-musavir-app-production|agent\/events|agent\/control|agent\/ai|luca|jasper|rapor_|rapor-|vercel/i.test(hay)) return false;
    if (/\/all-faturas(?:\?|$)/i.test(u) && /sortalanlari|valuelist/i.test(bodyText)) return false;
    if (!/\/api\/|mihsap|mali-musavir|fatura|invoice|document|defter|fis|belge|kaydet|onay|save|update/i.test(hay)) return false;
    return /fatura|invoice|document|defter|fis|belge|kaydet|onay|save|update/i.test(hay);
  }

  function shortNetUrl(url) {
    return String(url || '').replace(/^https?:\/\/[^/]+/i, '').slice(0, 110) || '-';
  }

  function noteMihsapSaveNetworkStart(method, url) {
    try {
      const item = { ts: Date.now(), method: String(method || 'GET').toUpperCase(), url: shortNetUrl(url) };
      window.__morenMihsapSaveNetPending = item;
      window.__morenLastSaveNetDebug = `net:pending:${item.method}:${item.url}`;
    } catch {}
  }

  function noteMihsapSaveNetworkDone(method, url, status) {
    try {
      const st = Number(status) || 0;
      const item = {
        ts: Date.now(),
        method: String(method || 'GET').toUpperCase(),
        url: shortNetUrl(url),
        status: st,
        ok: st >= 200 && st < 400,
      };
      window.__morenLastSaveNetDebug = `net:${item.status}:${item.method}:${item.url}`;
      if (item.ok) window.__morenMihsapSaveNet = item;
      if (window.__morenMihsapSaveNetPending) window.__morenMihsapSaveNetPending = null;
    } catch {}
  }

  function getRecentMihsapSaveNetwork(sinceTs = 0, maxAgeMs = 15000) {
    try {
      const n = window.__morenMihsapSaveNet;
      if (n && n.ok && n.ts >= sinceTs && Date.now() - n.ts <= maxAgeMs) return n;
    } catch {}
    return null;
  }

  function hasRecentMihsapSaveNetworkActivity(sinceTs = 0, maxAgeMs = 15000) {
    try {
      if (getRecentMihsapSaveNetwork(sinceTs, maxAgeMs)) return true;
      const p = window.__morenMihsapSaveNetPending;
      return !!(p && p.ts >= sinceTs && Date.now() - p.ts <= maxAgeMs);
    } catch {}
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────
  // XHR HOOK — jasper.jq POST'larına window.__lucaJobOverrides body inject
  // ÖNEMLI: Luca jasper.jq'yu frm3.contentWindow'dan atıyor; her frame'in
  // KENDI XMLHttpRequest objesi var. Top window'a hook kurmak yetmiyor —
  // her frame'e ayrı ayrı kurmamız lazım. installXhrHook(targetWindow)
  // helper'ı bunu idempotent şekilde yapar (zaten kurulmuşsa atla).
  function applyLucaReportOverrides(formObj, ov) {
    if (!formObj || typeof formObj !== 'object' || !ov) return formObj;
    const setMany = (keys, value) => {
      if (value === undefined || value === null || value === '') return;
      for (const key of keys) formObj[key] = String(value);
    };
    setMany([
      'hesap_bas', 'hesapBas', 'HESAPKODU_ILK', 'HESAP_ILK',
      'p_hesap_no_ilk_1', 'p_hesap_kodu_ilk_1', 'p_hesap_ilk_1',
    ], ov.HESAPKODU_ILK);
    setMany([
      'hesap_bit', 'hesapBit', 'HESAPKODU_SON', 'HESAP_SON',
      'p_hesap_no_son_1', 'p_hesap_kodu_son_1', 'p_hesap_son_1',
    ], ov.HESAPKODU_SON || ov.HESAPKODU_ILK);
    setMany([
      'tarih_bas', 'tarihBas', 'TARIH_ILK', 'tarih_ilk', 'tarih_baslangic',
      'p_fis_tarihi_ilk_1', 'p_tarih_ilk_1', 'p_tarih_bas_1',
    ], ov.TARIH_ILK);
    setMany([
      'tarih_bit', 'tarihBit', 'TARIH_SON', 'tarih_son', 'tarih_bitis',
      'p_fis_tarihi_son_1', 'p_tarih_son_1', 'p_tarih_bit_1',
    ], ov.TARIH_SON);
    if (ov.GELIR1 !== undefined) {
      formObj.GELIR1 = String(ov.GELIR1);
      formObj.gelir = String(ov.GELIR1) === '0' ? '1' : '0';
    }
    if (ov.GIDER1 !== undefined) {
      formObj.GIDER1 = String(ov.GIDER1);
      formObj.gider = String(ov.GIDER1) === '0' ? '1' : '0';
    }
    if (ov.REPORT_TYPE) {
      formObj.report_type = String(ov.REPORT_TYPE);
      formObj.dosya_tipi = String(ov.REPORT_TYPE);
      formObj.format = String(ov.REPORT_TYPE);
    }
    return formObj;
  }

  function installXhrHook(targetWin) {
    try {
      const w = targetWin || window;
      if (!w || !w.XMLHttpRequest) return false;
      const proto = w.XMLHttpRequest.prototype;
      if (proto.__morenXhrHookInstalled) return false;
      proto.__morenXhrHookInstalled = true;
      const origOpen = proto.open;
      const origSend = proto.send;
      proto.open = function (method, url) {
        this.__morenUrl = url;
        this.__morenMethod = method;
        return origOpen.apply(this, arguments);
      };
      proto.send = function (body) {
        try {
          const url = this.__morenUrl || '';
          const method = this.__morenMethod || '';
          if (isMihsapSaveRequest(method, url, body)) {
            noteMihsapSaveNetworkStart(method, url);
            this.addEventListener('loadend', function () {
              try { noteMihsapSaveNetworkDone(method, url, this.status); } catch {}
            });
          }
        } catch {}
        // DEBUG: __lucaJobOverrides aktifken TÜM XHR URL'lerini log'la
        try {
          if (window.__lucaJobOverrides && Array.isArray(window.__morenLogs)) {
            const url = this.__morenUrl || '';
            if (!/rapor_takip|jasper/i.test(url) && !/mali-musavir-app.*\/api\/v1\/agent\//i.test(url)) {
              window.__morenLogs.push(`[XHR-OTHER] ${this.__morenMethod || '?'} ${url.slice(0, 120)}`);
            }
          }
        } catch {}
        // rapor_takip.jq response listener — durum=150 + rapor_id → global'e yaz
        try {
          const url = this.__morenUrl || '';
          if (/rapor_takip\.jq/i.test(url)) {
            // Rapor_takip request body'sini sakla (rapor_indir aynı body ile çağrılacak)
            const takipBody = body;
            this.addEventListener('load', function () {
              try {
                const respText = this.responseText || '{}';
                const resp = JSON.parse(respText);
                if (Array.isArray(window.__morenLogs)) {
                  const preview = respText.length > 300 ? respText.slice(0, 300) + '...' : respText;
                  window.__morenLogs.push(`[RAPOR-TAKIP-RESP] durum=${resp.durum} body=${preview}`);
                }
                if (resp.durum === 150 || resp.durum === '150') {
                  window.__morenRaporHazir = {
                    durum: 150,
                    takipUrl: url,
                    takipBody: takipBody,  // KRİTİK: rapor_indir aynı body ile çağrılacak
                    response: resp,
                    timestamp: Date.now(),
                  };
                  if (Array.isArray(window.__morenLogs)) {
                    window.__morenLogs.push(`[RAPOR-HAZIR] durum=150 (session-based, rapor_indir aynı body ile)`);
                  }
                }
              } catch (e) {}
            });
          }
        } catch (e) {}
        try {
          const url = this.__morenUrl || '';
          const ov = window.__lucaJobOverrides;
          if (ov && typeof body === 'string' && /jasper\.jq|raporKebir|raporIslem|raporMuavin|raporIndir|rapor_takip|rapor_indir/i.test(url)) {
            // Body orijinalini log'a düşür (debug — modification yapmıyoruz)
            if (Array.isArray(window.__morenLogs)) {
              const origPreview = body.length > 800 ? body.slice(0, 800) + '...' : body;
              window.__morenLogs.push(`[XHR-ORIG] ${url.split('/').pop().slice(0, 40)} body=${origPreview}`);
            }
            // BODY MODIFICATION DISABLED — Luca'nın doğal davranışına bırak.
            // Önceki regex inject body'yi bozup 500 Internal Server Error döndürüyordu.
            // Önce input.value'lardan gerçekten 191/tarih okunduğunu kanıtlayalım.
            // Yine de hesap kodu uygulanmazsa, body inject'ini doğru regex ile aktive ederiz.
            // ── JSON-AWARE BODY INJECT ──
            // Luca jasper.jq body formatı:
            //   {"donem":"<JSON1>","form":"<JSON2>"}
            //   form içinde: {"hesap_bas":"","hesap_bit":"","tarih_bas":"","tarih_bit":"",...}
            // form'u parse → hesap_bas/bit + tarih_bas/bit override → re-stringify
            const isJasper = /jasper\.jq/i.test(url);
            if (isJasper) {
              try {
                let parsed;
                try { parsed = JSON.parse(body); } catch { parsed = null; }
                if (parsed && (typeof parsed.form === 'string' || (parsed.form && typeof parsed.form === 'object'))) {
                  let formObj;
                  try { formObj = typeof parsed.form === 'string' ? JSON.parse(parsed.form) : parsed.form; } catch { formObj = null; }
                  if (formObj && typeof formObj === 'object') {
                    applyLucaReportOverrides(formObj, ov);
                    parsed.form = typeof parsed.form === 'string' ? JSON.stringify(formObj) : formObj;
                    body = JSON.stringify(parsed);
                    if (Array.isArray(window.__morenLogs)) {
                      window.__morenLogs.push(`[XHR-INJECT-OK] hesap=${formObj.hesap_bas || formObj.p_hesap_no_ilk_1 || ''}-${formObj.hesap_bit || formObj.p_hesap_no_son_1 || ''} tarih=${formObj.tarih_bas || formObj.p_fis_tarihi_ilk_1 || ''}/${formObj.tarih_bit || formObj.p_fis_tarihi_son_1 || ''} GELIR1=${formObj.GELIR1} GIDER1=${formObj.GIDER1}`);
                    }
                  } else if (Array.isArray(window.__morenLogs)) {
                    window.__morenLogs.push(`[XHR-FORM-PARSE-FAIL]`);
                  }
                } else if (Array.isArray(window.__morenLogs)) {
                  window.__morenLogs.push(`[XHR-OUTER-PARSE-FAIL]`);
                }
              } catch (e) {
                if (Array.isArray(window.__morenLogs)) {
                  window.__morenLogs.push(`[XHR-INJECT-ERR] ${e?.message || e}`);
                }
              }
            }
          }
        } catch (e) {}
        return origSend.call(this, body);
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // FETCH HOOK — Luca XHR yerine fetch kullanıyorsa onu da yakalar
  // Aynı body inject mantığı (JSON-aware) — window.__lucaJobOverrides aktifse
  // form.hesap_bas/bit + tarih_bas/bit override eder.
  function installFetchHook(targetWin) {
    try {
      const w = targetWin || window;
      if (!w || !w.fetch || w.fetch.__morenFetchHookInstalled) return false;
      const origFetch = w.fetch;
      const morenFetchWrapper = async function (input, init) {
        const __morenFetchUrl = getRequestUrl(input);
        const __morenFetchMethod = (init && init.method) || (input && input.method) || 'GET';
        const __morenFetchBody = init && init.body;
        const __morenTrackSave = isMihsapSaveRequest(__morenFetchMethod, __morenFetchUrl, __morenFetchBody);
        if (__morenTrackSave) noteMihsapSaveNetworkStart(__morenFetchMethod, __morenFetchUrl);
        // DEBUG: __lucaJobOverrides aktifken TÜM fetch URL'lerini log'la
        try {
          const dbgUrl = typeof input === 'string' ? input : (input && input.url) || '';
          if (window.__lucaJobOverrides && Array.isArray(window.__morenLogs)) {
            if (!/rapor_takip|jasper/i.test(dbgUrl) && !/mali-musavir-app.*\/api\/v1\/agent\//i.test(dbgUrl)) {
              window.__morenLogs.push(`[FETCH-OTHER] ${dbgUrl.slice(0, 120)}`);
            }
          }
        } catch {}
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          // rapor_takip.jq response listener
          if (/rapor_takip\.jq/i.test(url)) {
            const takipBody = init && typeof init.body === 'string' ? init.body : null;
            const res = await origFetch.apply(this, arguments.length > 1 ? [input, init] : [input]);
            try {
              const cloned = res.clone();
              const text = await cloned.text();
              const resp = JSON.parse(text || '{}');
              if (Array.isArray(window.__morenLogs)) {
                const preview = text.length > 300 ? text.slice(0, 300) + '...' : text;
                window.__morenLogs.push(`[FETCH-RAPOR-TAKIP-RESP] durum=${resp.durum} body=${preview}`);
              }
              if (resp.durum === 150 || resp.durum === '150') {
                window.__morenRaporHazir = {
                  durum: 150,
                  takipUrl: url,
                  takipBody: takipBody,
                  response: resp,
                  timestamp: Date.now(),
                };
                if (Array.isArray(window.__morenLogs)) {
                  window.__morenLogs.push(`[FETCH-RAPOR-HAZIR] durum=150 session-based`);
                }
              }
            } catch (e) {}
            return res;
          }
          const ov = window.__lucaJobOverrides;
          const isJasper = /jasper\.jq/i.test(url);
          if (ov && isJasper && init && typeof init.body === 'string') {
            // Body orijinalini log'a düşür
            if (Array.isArray(window.__morenLogs)) {
              const orig = init.body.length > 800 ? init.body.slice(0, 800) + '...' : init.body;
              window.__morenLogs.push(`[FETCH-ORIG] ${url.split('/').pop().slice(0, 40)} body=${orig}`);
            }
            try {
              let parsed;
              try { parsed = JSON.parse(init.body); } catch { parsed = null; }
              if (parsed && (typeof parsed.form === 'string' || (parsed.form && typeof parsed.form === 'object'))) {
                let formObj;
                try { formObj = typeof parsed.form === 'string' ? JSON.parse(parsed.form) : parsed.form; } catch { formObj = null; }
                if (formObj && typeof formObj === 'object') {
                  applyLucaReportOverrides(formObj, ov);
                  parsed.form = typeof parsed.form === 'string' ? JSON.stringify(formObj) : formObj;
                  init = { ...init, body: JSON.stringify(parsed) };
                  if (Array.isArray(window.__morenLogs)) {
                    window.__morenLogs.push(`[FETCH-INJECT-OK] hesap=${formObj.hesap_bas || formObj.p_hesap_no_ilk_1 || ''}-${formObj.hesap_bit || formObj.p_hesap_no_son_1 || ''} tarih=${formObj.tarih_bas || formObj.p_fis_tarihi_ilk_1 || ''}/${formObj.tarih_bit || formObj.p_fis_tarihi_son_1 || ''} GELIR1=${formObj.GELIR1} GIDER1=${formObj.GIDER1}`);
                  }
                }
              }
            } catch (e) {
              if (Array.isArray(window.__morenLogs)) {
                window.__morenLogs.push(`[FETCH-INJECT-ERR] ${e?.message || e}`);
              }
            }
          }
        } catch (e) {}
        try {
          const __morenRes = await origFetch.apply(this, arguments.length > 1 ? [input, init] : [input]);
          if (__morenTrackSave) noteMihsapSaveNetworkDone(__morenFetchMethod, __morenFetchUrl, __morenRes.status);
          return __morenRes;
        } catch (e) {
          if (__morenTrackSave) noteMihsapSaveNetworkDone(__morenFetchMethod, __morenFetchUrl, 0);
          throw e;
        }
      };
      morenFetchWrapper.__morenFetchHookInstalled = true;
      w.fetch = morenFetchWrapper;
      return true;
    } catch (e) { return false; }
  }

    // ─────────────────────────────────────────────────────────────────────
  // NATIVE DOWNLOAD HOOK — Luca rapor_indir sonrası dosyayı window.open()
  // veya <a download href=URL> ile veriyor olabilir. Bu URL'yi yakalayıp
  // bizim fetch'imizle blob alıp __morenCapturedBlob'a yazıyoruz.
  function installReportFormSubmitHook(targetWin) {
    try {
      const w = targetWin || window;
      if (!w || !w.HTMLFormElement || !w.document) return false;
      const proto = w.HTMLFormElement.prototype;
      if (proto.__morenReportFormHookInstalled) return false;
      proto.__morenReportFormHookInstalled = true;
      const logLine = (line) => {
        try {
          if (Array.isArray(window.__morenLogs)) window.__morenLogs.push(line);
        } catch {}
      };
      const getAction = (form) => String(form?.action || form?.getAttribute?.('action') || '');
      const logFormSubmit = (form, reason) => {
        try {
          if (!window.__lucaJobOverrides || !form) return;
          const action = getAction(form);
          const method = String(form.method || 'POST').toUpperCase();
          const params = new URLSearchParams();
          const fd = new w.FormData(form);
          for (const [k, v] of fd.entries()) params.append(k, String(v));
          logLine(`[FORM-SUBMIT-${reason}] action=${action.split('/').pop().slice(0, 90)} method=${method} target=${String(form.target || '').slice(0, 40)} body=${params.toString().slice(0, 260)}`);
        } catch {}
      };
      const shouldCapture = (form) => {
        try {
          if (!window.__lucaJobOverrides || !form) return false;
          const action = getAction(form);
          return /rapor_indir|raporIndir|rapor_dosya|download|indir|excel|xlsx/i.test(action);
        } catch {
          return false;
        }
      };
      const captureForm = (form, reason) => {
        try {
          if (!shouldCapture(form)) return false;
          const now = Date.now();
          if (form.__morenLastReportFetchTs && now - form.__morenLastReportFetchTs < 1500) return true;
          form.__morenLastReportFetchTs = now;
          const action = getAction(form);
          const method = String(form.method || 'POST').toUpperCase();
          const params = new URLSearchParams();
          const fd = new w.FormData(form);
          for (const [k, v] of fd.entries()) params.append(k, String(v));
          const bodyStr = params.toString();
          const targetUrl = /^https?:/i.test(action) ? action : new w.URL(action, w.location.href).href;
          const isGet = method === 'GET';
          const fetchUrl = isGet
            ? targetUrl + (targetUrl.includes('?') ? '&' : '?') + bodyStr
            : targetUrl;
          logLine(`[REPORT-FORM-${reason}] action=${targetUrl.split('/').pop().slice(0, 80)} body=${bodyStr.slice(0, 220)}`);
          const init = {
            method: isGet ? 'GET' : 'POST',
            credentials: 'include',
          };
          if (!isGet) {
            init.body = bodyStr;
            init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          }
          w.fetch(fetchUrl, init)
            .then(async (r) => {
              const ct = r.headers.get('content-type') || '';
              const arr = await r.arrayBuffer();
              const bytes = new Uint8Array(arr.slice(0, 8));
              const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
              const blob = new w.Blob([arr], { type: ct || 'application/octet-stream' });
              const isExcel = isZip || /xlsx|spreadsheet|excel|octet-stream|binary/i.test(ct);
              logLine(`[REPORT-FORM-${reason}-RESP] HTTP ${r.status} ${Math.round(blob.size / 1024)} KB ct=${ct.slice(0, 45)} zip=${isZip}`);
              if (r.ok && blob.size > 1000 && isExcel) {
                window.__morenCapturedBlob = blob;
                try { w.__morenCapturedBlob = blob; } catch {}
                logLine(`[REPORT-FORM-${reason}-BLOB] captured ${Math.round(blob.size / 1024)} KB`);
              } else if (arr.byteLength) {
                try {
                  const preview = new TextDecoder().decode(arr.slice(0, 260)).replace(/\s+/g, ' ');
                  logLine(`[REPORT-FORM-${reason}-NO-BLOB] ${preview.slice(0, 220)}`);
                } catch {}
              }
            })
            .catch((e) => logLine(`[REPORT-FORM-${reason}-ERR] ${e?.message || e}`));
          return true;
        } catch (e) {
          logLine(`[REPORT-FORM-${reason}-CATCH] ${e?.message || e}`);
          return false;
        }
      };
      const origSubmit = proto.submit;
      const origRequestSubmit = proto.requestSubmit;
      proto.submit = function () {
        logFormSubmit(this, 'SUBMIT');
        if (captureForm(this, 'SUBMIT')) return;
        return origSubmit.apply(this, arguments);
      };
      if (origRequestSubmit) {
        proto.requestSubmit = function () {
          logFormSubmit(this, 'REQUESTSUBMIT');
          if (captureForm(this, 'REQUESTSUBMIT')) return;
          return origRequestSubmit.apply(this, arguments);
        };
      }
      w.document.addEventListener('submit', (ev) => {
        try {
          const form = ev.target;
          logFormSubmit(form, 'EVENT');
          if (shouldCapture(form)) {
            ev.preventDefault();
            ev.stopPropagation();
            captureForm(form, 'EVENT');
          }
        } catch {}
      }, true);
      return true;
    } catch {
      return false;
    }
  }

  function installNativeDownloadHook(targetWin) {
    try {
      const w = targetWin || window;
      if (!w) return false;
      if (w.open && w.open.__morenNativeDlInstalled) return false;

      // 0) URL.createObjectURL hook — KRİTİK: Luca sıkça blob → ObjectURL → anchor.click() ile indiriyor.
      //    Blob URL.createObjectURL'ye geçtiği an yakala, bu en güvenilir yol.
      try {
        const URLClass = w.URL || URL;
        const origCreateObjectURL = URLClass.createObjectURL;
        if (origCreateObjectURL && !URLClass.__morenCreateUrlHooked) {
          URLClass.__morenCreateUrlHooked = true;
          URLClass.createObjectURL = function (obj) {
            try {
              if (obj instanceof Blob && obj.size > 1000 && window.__lucaJobOverrides) {
                const ct = obj.type || '';
                // Excel/xlsx/binary — büyük olasılıkla rapor dosyası
                const isLikelyReport = obj.size > 1500 || /xlsx|spreadsheet|excel|octet-stream|binary/i.test(ct);
                if (isLikelyReport) {
                  window.__morenCapturedBlob = obj;
                  if (Array.isArray(window.__morenLogs)) {
                    window.__morenLogs.push(`[CREATE-OBJ-URL] ${Math.round(obj.size / 1024)} KB ct=${ct.slice(0, 40)} → BLOB yakalandı`);
                  }
                }
              }
            } catch (e) {}
            return origCreateObjectURL.apply(this, arguments);
          };
        }
      } catch (e) {}

      // 1) window.open intercept — Luca yeni tab/window ile dosya açabilir
      const origOpen = w.open;
      const morenOpenWrapper = function (url, ...rest) {
        try {
          if (url && typeof url === 'string' && window.__lucaJobOverrides) {
            if (Array.isArray(window.__morenLogs)) {
              window.__morenLogs.push(`[NATIVE-OPEN] ${url.slice(0, 120)}`);
            }
            // URL Luca dosya indirme'ye benziyorsa fetch et
            if (/rapor_indir|rapor_dosya|excel|xlsx|indir|download/i.test(url)) {
              w.fetch(url, { credentials: 'include' })
                .then(r => r.blob())
                .then(blob => {
                  if (blob.size > 1000) {
                    window.__morenCapturedBlob = blob;
                    if (Array.isArray(window.__morenLogs)) {
                      window.__morenLogs.push(`[NATIVE-OPEN-BLOB] ${Math.round(blob.size / 1024)} KB yakalandı`);
                    }
                  }
                })
                .catch(() => {});
              // Luca'nın native window.open'ını engelleme — bizim fetch paralel
            }
          }
        } catch (e) {}
        return origOpen.apply(this, [url, ...rest]);
      };
      morenOpenWrapper.__morenNativeDlInstalled = true;
      w.open = morenOpenWrapper;

      // 2) <a download> click intercept — addEventListener capture
      try {
        const doc = w.document;
        if (doc) {
          doc.addEventListener('click', function (ev) {
            try {
              const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
              if (a && window.__lucaJobOverrides) {
                const href = a.href;
                const hasDownload = a.hasAttribute('download');
                if (hasDownload || /rapor_indir|excel|xlsx|indir/i.test(href)) {
                  if (Array.isArray(window.__morenLogs)) {
                    window.__morenLogs.push(`[NATIVE-A-CLICK] href=${href.slice(0, 120)} download=${hasDownload}`);
                  }
                  // Paralel fetch
                  w.fetch(href, { credentials: 'include' })
                    .then(r => r.blob())
                    .then(blob => {
                      if (blob.size > 1000) {
                        window.__morenCapturedBlob = blob;
                        if (Array.isArray(window.__morenLogs)) {
                          window.__morenLogs.push(`[NATIVE-A-BLOB] ${Math.round(blob.size / 1024)} KB yakalandı`);
                        }
                      }
                    })
                    .catch(() => {});
                }
              }
            } catch (e) {}
          }, true);
        }
      } catch (e) {}

      // 3.5) window.location.href / document.location.href setter intercept
      try {
        const captureLocationDownload = (url) => {
          try {
            if (url && window.__lucaJobOverrides && /rapor_indir|excel|xlsx|indir|download|jasper|raporKebir/i.test(url)) {
              if (Array.isArray(window.__morenLogs)) {
                window.__morenLogs.push(`[NATIVE-LOC-SET] ${String(url).slice(0, 120)}`);
              }
              w.fetch(url, { credentials: 'include' })
                .then(r => r.blob())
                .then(blob => {
                  if (blob.size > 1000) {
                    window.__morenCapturedBlob = blob;
                    if (Array.isArray(window.__morenLogs)) {
                      window.__morenLogs.push(`[NATIVE-LOC-BLOB] ${Math.round(blob.size / 1024)} KB yakalandı`);
                    }
                  }
                })
                .catch(() => {});
            }
          } catch {}
        };
        // window.location.assign + window.location.replace intercept
        const origAssign = w.location.assign;
        const origReplace = w.location.replace;
        w.location.assign = function (url) {
          captureLocationDownload(url);
          return origAssign.apply(this, arguments);
        };
        w.location.replace = function (url) {
          captureLocationDownload(url);
          return origReplace.apply(this, arguments);
        };
      } catch (e) {}

      // 3.6) MutationObserver — DOM'a yeni eklenen <a href> elementlerini izle
      try {
        if (w.MutationObserver && w.document) {
          const observer = new w.MutationObserver((mutations) => {
            try {
              if (!window.__lucaJobOverrides) return;
              for (const m of mutations) {
                for (const n of (m.addedNodes || [])) {
                  if (!n.tagName) continue;
                  // Yeni eklenen <a> veya çocuğunda <a> var mı
                  const anchors = n.tagName === 'A' ? [n] :
                    (n.querySelectorAll ? [...n.querySelectorAll('a[href]')] : []);
                  for (const a of anchors) {
                    const href = a.href || '';
                    if (/rapor_indir|excel|xlsx|indir|download|jasper|raporKebir/i.test(href)) {
                      if (Array.isArray(window.__morenLogs)) {
                        window.__morenLogs.push(`[NATIVE-DOM-A] href=${href.slice(0, 120)}`);
                      }
                      w.fetch(href, { credentials: 'include' })
                        .then(r => r.blob())
                        .then(blob => {
                          if (blob.size > 1000) {
                            window.__morenCapturedBlob = blob;
                            if (Array.isArray(window.__morenLogs)) {
                              window.__morenLogs.push(`[NATIVE-DOM-A-BLOB] ${Math.round(blob.size / 1024)} KB yakalandı`);
                            }
                          }
                        })
                        .catch(() => {});
                    }
                  }
                  // Yeni form'lar — Luca rapor_indir formu inject edildiyse:
                  // 1. Luca submit'ini PREVENT et (yoksa server bize boş döndürür - session race)
                  // 2. Agent kendi fetch'i ile blob'u al
                  const forms = n.tagName === 'FORM' ? [n] :
                    (n.querySelectorAll ? [...n.querySelectorAll('form')] : []);
                  for (const f of forms) {
                    if (f.action && /rapor_indir/i.test(f.action)) {
                      if (Array.isArray(window.__morenLogs)) {
                        window.__morenLogs.push(`[NATIVE-DOM-FORM] action=${f.action.slice(0, 100)}`);
                      }
                      // KRİTİK: form.submit'i monkey-patch — Luca submit edemesin
                      const origSubmit = f.submit.bind(f);
                      f.submit = function () {
                        if (Array.isArray(window.__morenLogs)) {
                          window.__morenLogs.push(`[NATIVE-DOM-FORM-SUBMIT-PREVENTED] Luca submit'i bloklandı (session race önlendi)`);
                        }
                        // Luca submit ETME — bizim fetch'imiz çalışsın
                      };
                      // Click listener da ekle (form içindeki submit button'ını engelle)
                      f.addEventListener('submit', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (Array.isArray(window.__morenLogs)) {
                          window.__morenLogs.push(`[NATIVE-DOM-FORM-SUBMIT-EVT-PREVENTED]`);
                        }
                      }, true);

                      // Agent'ın kendi fetch'i — Luca submit'inden ÖNCE
                      try {
                        const fd = new FormData(f);
                        const params = new URLSearchParams();
                        for (const [k, v] of fd) params.append(k, String(v));
                        const bodyStr = params.toString();
                        if (Array.isArray(window.__morenLogs)) {
                          window.__morenLogs.push(`[NATIVE-DOM-FORM-POST] action=${f.action.slice(0, 60)} body=${bodyStr.slice(0, 200)}`);
                        }
                        w.fetch(f.action, {
                          method: 'POST',
                          body: bodyStr,
                          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                          credentials: 'include',
                        })
                          .then(r => r.blob().then(blob => ({ blob, ct: r.headers.get('content-type') || '' })))
                          .then(({ blob, ct }) => {
                            if (Array.isArray(window.__morenLogs)) {
                              window.__morenLogs.push(`[NATIVE-DOM-FORM-RESP] ${Math.round(blob.size / 1024)} KB ct=${ct.slice(0, 40)}`);
                            }
                            if (blob.size > 1000) {
                              window.__morenCapturedBlob = blob;
                              if (Array.isArray(window.__morenLogs)) {
                                window.__morenLogs.push(`[NATIVE-DOM-FORM-BLOB] ✓ yakalandı: ${Math.round(blob.size / 1024)} KB`);
                              }
                            }
                          })
                          .catch(e => {
                            if (Array.isArray(window.__morenLogs)) {
                              window.__morenLogs.push(`[NATIVE-DOM-FORM-ERR] ${e?.message || e}`);
                            }
                          });
                      } catch (e) {
                        if (Array.isArray(window.__morenLogs)) {
                          window.__morenLogs.push(`[NATIVE-DOM-FORM-CATCH] ${e?.message || e}`);
                        }
                      }
                    }
                  }
                }
              }
            } catch {}
          });
          observer.observe(w.document.documentElement || w.document.body, {
            childList: true,
            subtree: true,
          });
        }
      } catch (e) {}

      // 4) iframe.src setter intercept — yeni iframe URL'si dosya olabilir
      try {
        const HTMLIFrameElementProto = w.HTMLIFrameElement && w.HTMLIFrameElement.prototype;
        if (HTMLIFrameElementProto) {
          const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElementProto, 'src');
          if (origSrcDesc && origSrcDesc.set) {
            Object.defineProperty(HTMLIFrameElementProto, 'src', {
              get: origSrcDesc.get,
              set: function (url) {
                try {
                  if (url && window.__lucaJobOverrides && /rapor_indir|excel|xlsx|indir/i.test(url)) {
                    if (Array.isArray(window.__morenLogs)) {
                      window.__morenLogs.push(`[NATIVE-IFRAME-SRC] ${url.slice(0, 120)}`);
                    }
                    w.fetch(url, { credentials: 'include' })
                      .then(r => r.blob())
                      .then(blob => {
                        if (blob.size > 1000) {
                          window.__morenCapturedBlob = blob;
                          if (Array.isArray(window.__morenLogs)) {
                            window.__morenLogs.push(`[NATIVE-IFRAME-BLOB] ${Math.round(blob.size / 1024)} KB yakalandı`);
                          }
                        }
                      })
                      .catch(() => {});
                  }
                } catch (e) {}
                return origSrcDesc.set.call(this, url);
              },
              configurable: true,
            });
          }
        }
      } catch (e) {}

      return true;
    } catch (e) { return false; }
  }

    // Tüm frame'lere XHR hook kur (recursive). Yeni yüklenen frame'ler için
  // periyodik tarama da yapıyoruz (Luca frm3'ü dinamik yüklüyor).
  function installXhrHookOnAllFrames() {
    let count = 0;
    if (installXhrHook(window)) count++;
    if (installFetchHook(window)) count++;
    if (installReportFormSubmitHook(window)) count++;
    if (installNativeDownloadHook(window)) count++;
    const collect = (root, depth = 0) => {
      if (depth > 5) return;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          try {
            if (f.contentWindow) {
              if (installXhrHook(f.contentWindow)) count++;
              if (installFetchHook(f.contentWindow)) count++;
              if (installReportFormSubmitHook(f.contentWindow)) count++;
              if (installNativeDownloadHook(f.contentWindow)) count++;
            }
            if (f.contentDocument) collect(f.contentDocument, depth + 1);
          } catch {}
        }
      } catch {}
    };
    collect(document);
    return count;
  }

  // Top + ilk taramayı hemen yap
  installXhrHookOnAllFrames();
  // Periyodik — yeni frame'ler yüklendikçe (her 2sn'de yeniden tara)
  setInterval(() => {
    try { installXhrHookOnAllFrames(); } catch {}
  }, 500);
  try { console.log('[Moren] XHR hook kuruldu (multi-frame)'); } catch {}


  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN, ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  const agentEventQueue = [];
  let agentEventFlushRunning = false;
  let agentEventFlushTimer = null;

  function scheduleAgentEventFlush(delayMs = 0) {
    if (agentEventFlushTimer) return;
    agentEventFlushTimer = setTimeout(() => {
      agentEventFlushTimer = null;
      flushAgentEventQueue().catch((e) => console.warn('[Moren] log queue fail', e));
    }, delayMs);
  }

  async function flushAgentEventQueue() {
    if (agentEventFlushRunning) return;
    agentEventFlushRunning = true;
    try {
      while (agentEventQueue.length > 0) {
        const item = agentEventQueue.shift();
        try {
          await api('/agent/events/ingest', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        } catch (e) {
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts <= 3) {
            agentEventQueue.unshift(item);
            scheduleAgentEventFlush(1500 * item.attempts);
          } else {
            console.warn('[Moren] log dropped', e);
          }
          break;
        }
      }
    } finally {
      agentEventFlushRunning = false;
      if (agentEventQueue.length > 0 && !agentEventFlushTimer) scheduleAgentEventFlush(500);
    }
  }

  function enqueueAgentEvent(payload) {
    agentEventQueue.push({ payload, attempts: 0 });
    scheduleAgentEventFlush(0);
  }

  function findBtnExact(label) {
    return [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label && b.offsetParent !== null,
    );
  }
  async function click(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
    try { el.focus?.({ preventScroll: true }); } catch {}
    try {
      const r = el.getBoundingClientRect?.();
      const clientX = r ? Math.round(r.left + r.width / 2) : 0;
      const clientY = r ? Math.round(r.top + r.height / 2) : 0;
      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', clientX, clientY }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', clientX, clientY }));
      }
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX, clientY }));
    } catch {}
    el.click();
    await sleep(250);
  }
  async function waitFor(sel, t = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < t) {
      const el = document.querySelector(sel);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }
  async function logEvent(mukellefId, mukellefAd, status, detail, extra = {}) {
    try {
      // v1.14.1 — action ve tarih de gönderilsin: mükellef özeti backend'i
      // bunlara göre groupby yapıyor (önce yoktu, hep NULL gidiyordu).
      const currentAction = window.__morenAgent?.currentAction || extra.action || null;
      // v1.36.4 fix: meta'ya OTOMATIK donem (komutun ay'i) + agentVersion ekle.
      // Bu sayede tarih hicbir yerden okunamasa bile log-format.ts meta.donem'den
      // ayin 15'ini turetebilir (yaniltici "kayit ani" yerine gercek donem).
      const currentDonem = window.__morenAgent?.currentDonem || extra.donem || null;
      enqueueAgentEvent({
        agent: 'mihsap',
        action: currentAction,
        mukellef: mukellefAd,
        status,
        message: detail,
        firma: extra.firma || null,
        fisNo: extra.belgeNo || null,
        tutar: extra.tutar ? Number(extra.tutar) : null,
        hesapKodu: extra.hesapKodu || null,
        kdv: extra.kdv || null,
        meta: {
          mukellefId,
          tarih: extra.tarih || null,
          donem: currentDonem,
          agentVersion: AGENT_VERSION,
          queuedLog: true,
          ...extra,
        },
      });
    } catch (e) { console.warn('[Moren] log fail', e); }
  }

  // === MIHSAP FATURA İŞLEME ===
  function getVisibleModals() {
    return [...document.querySelectorAll('.ant-modal, .ant-popover')].filter((m) => {
      if (m.offsetParent === null) return false;
      if (m.classList.contains('ant-modal-hidden') || m.classList.contains('ant-popover-hidden')) return false;
      const st = getComputedStyle(m);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      return true;
    });
  }

  function markValidationFailure(text) {
    window.__morenLastValidationDialog = {
      ts: Date.now(),
      text: String(text || 'MIHSAP validation').replace(/\s+/g, ' ').slice(0, 220),
    };
  }

  function recentValidationFailure(maxAgeMs = 8000) {
    const last = window.__morenLastValidationDialog;
    if (!last || Date.now() - last.ts > maxAgeMs) return null;
    return last.text || 'MIHSAP validation';
  }

  async function handleDialogs() {
    await sleep(150);
    const modals = getVisibleModals();
    for (const modal of modals) {
      const text = modal.textContent || '';
      const btns = [...modal.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const findIn = (needle) => btns.find((b) => b.textContent.trim() === needle);
      const findInStarts = (needle) =>
        btns.find((b) => b.textContent.trim().toLowerCase().startsWith(needle.toLowerCase()));
      const findByRegex = (re) => btns.find((b) => re.test((b.textContent || '').trim()));

      // Mükerrer fatura uyarısı → İptal
      if (/Mükerrer/i.test(text)) {
        const iptal = findIn('İptal') || findIn('Vazgeç');
        if (iptal) { await click(iptal); await sleep(300); return 'mukerrer'; }
      }
      // Onayla sonrası tekrar F2 erken/yersiz gelirse Mihsap bu hatayı verir.
      // Bu durumda aynı faturayı tekrar zorlamayı bırak; Tamam deyip üst akışa
      // "bu fatura artık onay bekleyen değil" sinyali ver.
      if (/sadece\s+onay\s+bekleyen/i.test(text)) {
        const ok = findIn('Tamam') || findIn('Evet') || findInStarts('Tamam') || findInStarts('Evet');
        if (ok) { await click(ok); await sleep(800); return 'not-pending'; }
      }
      // Bu uyarıda kullanıcı talimatı: Onayla, ardından aynı faturada tekrar F2 dene.
      // Vazgeç/Hayır dersen uyarı kapanıyor ama fatura onay beklemeye devam ediyor;
      // F2 sonrası aynı uyarı tekrar çıkıp döngüye giriyor.
      if (/toplam.*farklı/i.test(text) ||
          /tutar.*farklı/i.test(text) ||
          /farklı.*onayl/i.test(text) ||
          /kredi.*farklı/i.test(text)) {
        markValidationFailure(`MIHSAP tutar farki: ${text}`);
        const cancel = findByRegex(/Vazge|Iptal|\u0130ptal|Hayir|Hay\u0131r/i);
        const ok = findIn('Tamam') || findInStarts('Tamam');
        if (cancel || ok) { await click(cancel || ok); await sleep(500); return 'validation'; }
        return 'validation';
      }
      // Hesap kodu boş uyarısı → Evet/Tamam ile devam et (atlamak için)
      if (/Hesap kodu girilmemiş/i.test(text) ||
          /hesap kodu.*boş/i.test(text) ||
          /kod.*eksik/i.test(text) ||
          /satır mevcut/i.test(text) ||
          /kaydetme.*devam/i.test(text) ||
          /onaylamadan/i.test(text) ||
          /zorunlu/i.test(text) ||
          /girilmem/i.test(text) ||
          /se.?ilmem/i.test(text)) {
        markValidationFailure(`MIHSAP eksik alan: ${text}`);
        const cancel = findByRegex(/Vazge|Iptal|\u0130ptal|Hayir|Hay\u0131r/i);
        const ok = findIn('Tamam') || findInStarts('Tamam');
        if (cancel || ok) { await click(cancel || ok); await sleep(500); return 'validation'; }
        return 'validation';
      }
      // Onay dialog'u (genel) — "emin misiniz?" gibi. Atlama işlemi yapıyoruz, Evet/Tamam.
      if (/emin misiniz/i.test(text) || /onaylıyor musunuz/i.test(text)) {
        const ok =
          findIn('Onayla') || findIn('Evet') || findIn('Tamam') ||
          findInStarts('Onayla') || findInStarts('Evet') || findInStarts('Tamam');
        if (ok) { await click(ok); await sleep(300); return 'evet'; }
      }
      // Genel fallback: bilinmeyen MIHSAP uyarilarinda otomatik onay verme.
      const ok2 =
        findIn('Tamam') || findInStarts('Tamam');
      const vazgec = findByRegex(/Vazge|Iptal|\u0130ptal|Hayir|Hay\u0131r/i);
      if (vazgec) { await click(vazgec); await sleep(300); return 'vazgec'; }
      if (ok2) { await click(ok2); await sleep(300); return 'tamam'; }
    }
    return 'ok';
  }

  async function waitForFaturaEditorReady(expectedFid, maxWaitMs = 15000) {
    const tStart = Date.now();
    let stableSince = 0;
    let lastSignature = '';
    while (Date.now() - tStart < maxWaitMs) {
      if (window.__morenAgent?.stopRequested) return false;
      if (/count=0/.test(location.href)) return true;
      const fidNow = getCurrentFid();
      if (expectedFid && fidNow && fidNow !== expectedFid) {
        await sleep(150);
        continue;
      }
      if (getVisibleModals().length > 0) {
        await handleDialogs();
        stableSince = 0;
        await sleep(150);
        continue;
      }
      const spinning = document.querySelector('.ant-spin-spinning, .ant-skeleton, .ant-select-loading');
      const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const hasSave = buttons.some((b) => /Kaydet|Onayla|İleri|Ileri/i.test((b.textContent || '').trim()));
      const hasEditorInput = document.querySelector('.ant-select-selector, input, textarea');
      const bodyText = (document.body?.innerText || '').slice(0, 3000);
      const signature = `${location.href}|${bodyText.length}|${buttons.length}`;
      const ready = !spinning && hasSave && hasEditorInput;
      if (ready && signature === lastSignature) {
        stableSince += 120;
        if (stableSince >= 240) return true;
      } else {
        stableSince = 0;
        lastSignature = signature;
      }
      await sleep(120);
    }
    return false;
  }

  function dispatchShortcutKey(key, code, keyCode) {
    const targets = [
      document.activeElement && document.activeElement !== document.body ? document.activeElement : null,
      document,
      window,
    ].filter(Boolean);
    const events = ['keydown', 'keypress', 'keyup'];
    for (const target of targets) {
      for (const type of events) {
        try {
          target.dispatchEvent(new KeyboardEvent(type, {
            key,
            code,
            keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
          }));
        } catch {}
      }
    }
  }

  function faturaAdvancedFrom(fidBefore) {
    const fidNow = getCurrentFid();
    return isZeroCount() || !!(fidBefore && fidNow && fidNow !== fidBefore);
  }

  async function waitShortcutEffect(fidBefore, timeoutMs = 500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (faturaAdvancedFrom(fidBefore)) return true;
      if (getVisibleModals().length > 0) return true;
      if (typeof validationDialogVarMi === 'function' && validationDialogVarMi()) return true;
      await sleep(75);
    }
    return false;
  }

  function findIleriButton() {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    return btns.find((b) => {
      const t = b.textContent.trim();
      return t === 'İleri' || t === 'İleri (F9)' || t.startsWith('İleri ');
    });
  }

  function findKaydetOnaylaButton() {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    const candidates = btns.filter((b) => {
      const t = (b.textContent || '').trim();
      return /^Kaydet\s+ve\s+Onayla/i.test(t) || /\(F2\)/i.test(t);
    });
    const fallbackCandidates = btns.filter((b) => {
      const t = (b.textContent || '').trim();
      return /^Kaydet$/i.test(t)
        || /^Kaydet\b/i.test(t);
    });
    return [...candidates, ...fallbackCandidates].find((b) => !isButtonDisabled(b)) || candidates[0] || fallbackCandidates[0] || null;
  }

  function isButtonDisabled(btn) {
    if (!btn) return true;
    const text = `${btn.className || ''} ${btn.getAttribute('aria-disabled') || ''}`.toLowerCase();
    return !!btn.disabled || btn.getAttribute('disabled') != null || text.includes('disabled') || text.includes('loading');
  }

  function describeButton(btn) {
    if (!btn) return 'btn:yok';
    const r = btn.getBoundingClientRect?.();
    const text = (btn.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const rect = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}` : '?';
    return `btn:${text || '-'} disabled:${isButtonDisabled(btn) ? 'evet' : 'hayir'} rect:${rect}`;
  }

  async function pressF9Once(currentFid) {
    dispatchShortcutKey('F9', 'F9', 120);
    if (await waitShortcutEffect(currentFid, 650)) return;
    const ileri = findIleriButton();
    if (!ileri) return;
    await click(ileri);
  }

  async function clickIleri(currentFid) {
    window.__morenLastValidationDialog = null;
    // Dialog varsa önce kapat
    if (getVisibleModals().length > 0) await handleDialogs();
    await pressF9Once(currentFid);

    // 1) URL değişimini bekle (yeni faturaya geçildi mi?)
    const t0 = Date.now();
    let urlChanged = false;
    while (Date.now() - t0 < 2500) {
      const m = location.href.match(/\/(\d+)\?count=/);
      if (m && m[1] !== currentFid) { urlChanged = true; break; }
      if (/count=0/.test(location.href)) { urlChanged = true; break; }
      // Yeni dialog geldiyse yine kapat
      if (getVisibleModals().length > 0) { await handleDialogs(); }
      await sleep(100);
    }
    if (!urlChanged) return;

    // 2) URL değişti — ama MIHSAP editör DOM'u (hesap kodu select'leri, matrah alanları)
    //    henüz render olmamış olabilir. Ekran tamamen güncellenmeden bir sonraki
    //    iterasyonda "kod boş" görülüp hızlıca F9'a basılıyor ve boş faturalar atlanıyordu.
    //    Bu yüzden editör DOM'unun hazır olmasını bekliyoruz: asgari 5 sn, max 8 sn.
    //    count=0 durumunda editör yok, direk return.
    if (/count=0/.test(location.href)) { await sleep(200); return; }

    const nextFid = getCurrentFid();
    await waitForFaturaEditorReady(nextFid, 1200);
  }

  async function pressF2Once() {
    let f2btn = findKaydetOnaylaButton();
    if (f2btn) {
      if (isButtonDisabled(f2btn)) {
        const t0 = Date.now();
        while (Date.now() - t0 < 1800 && isButtonDisabled(f2btn)) {
          await sleep(150);
          f2btn = findKaydetOnaylaButton();
          if (!f2btn) break;
        }
      }
      window.__morenLastF2Debug = describeButton(f2btn);
      if (f2btn && !isButtonDisabled(f2btn)) {
        await click(f2btn);
        return;
      }
    }

    window.__morenLastF2Debug = describeButton(f2btn);
    dispatchShortcutKey('F2', 'F2', 113);
  }

  // URL'den mevcut fatura ID'sini oku (örn. "/documents/BILANCO/1/123/456789?count=12" → "456789")
  function getCurrentFid() {
    const m = location.href.match(/\/(\d+)\?count=/);
    return m ? m[1] : null;
  }
  function isZeroCount() {
    return /count=0/.test(location.href);
  }

  // Onayla sonrası kısa bekle; fid değişmediyse F2 bas. Değiştiyse MIHSAP zaten
  // kaydedip sonraki faturaya geçmiş — F2 basma (sonraki faturayı istenmeden tetikler,
  // işlem log'suz atlanmış gibi görünür).
  // Dönüş: 'f2' (F2 basıldı) | 'already-advanced' (URL değişti, F2 gereksiz)
  async function onaylaSonrasiF2(fidBefore) {
    // Onayla sonrası Mihsap bazen state'i birkaç saniye sonra güncelliyor.
    // Erken F2 "Sadece onay bekleyen..." hatasına düşürdüğü için kısa akıllı bekle.
    const __t0 = Date.now();
    while (Date.now() - __t0 < 1800) {
      const fidNow = getCurrentFid();
      if (isZeroCount() || (fidBefore && fidNow && fidNow !== fidBefore)) {
        return 'already-advanced';
      }
      await sleep(150);
    }
    await pressF2Once();
    await sleep(500);
    return 'f2';
  }

  async function clickKaydetOnayla(actionSince = Date.now()) {
    const fidAtStart = getCurrentFid();
    await pressF2Once();
    await sleep(550);
    if (!faturaAdvancedFrom(fidAtStart) && getVisibleModals().length === 0 && !hasRecentMihsapSaveNetworkActivity(actionSince, 1800)) {
      dispatchShortcutKey('F2', 'F2', 113);
      window.__morenLastF2Debug = `${window.__morenLastF2Debug || 'btn:bilinmiyor'} + key:F2`;
      await sleep(250);
    }
    // Her türlü dialog'u kapat (mükerrer, hesap kodu uyarı, tutar farkı vs)
    // Tutar farkı onayında Onayla sonrası aynı faturada bir kez daha F2 dene.
    let tries = 0;
    while (tries < 4 && getVisibleModals().length > 0) {
      const result = await handleDialogs();
      if (result === 'validation') break;
      if (result === 'resubmit' || result === 'retry-f2') {
        // Onayla'dan önceki fid'i referans al (fidAtStart — bu fonksiyonun girişindeki fid).
        // 5 sn bekle + URL kontrolü; hâlâ aynı faturadaysak F2 bas, değilse bırak.
        const r = await onaylaSonrasiF2(fidAtStart);
        if (r === 'already-advanced') break; // sonraki faturaya geçtik, döngüden çık
      } else {
        await sleep(180);
      }
      tries++;
    }
  }

  async function waitFaturaKayitSonucu(fid, timeoutMs = 12000, netSince = 0) {
    const t0 = Date.now();
    const minWaitMs = 450;
    let validationFailed = null;

    while (Date.now() - t0 < minWaitMs) {
      const validationMsg = validationDialogVarMi();
      if (validationMsg) {
        validationFailed = validationMsg;
        await handleDialogs();
        return { saved: false, validationFailed };
      }
      if (getVisibleModals().length > 0) {
        const r = await handleDialogs();
        if (r === 'validation') return { saved: false, validationFailed: recentValidationFailure() };
        if (r === 'not-pending') return { saved: true, validationFailed: null };
        if (r === 'resubmit' || r === 'retry-f2') {
          const res = await onaylaSonrasiF2(fid);
          if (res === 'already-advanced') break;
        }
      }
      const netOk = getRecentMihsapSaveNetwork(netSince, 15000);
      if (netOk) return { saved: true, validationFailed: null, via: `network:${netOk.status}` };
      await sleep(100);
    }

    while (Date.now() - t0 < timeoutMs) {
      const fidNow = getCurrentFid();
      if (fidNow && fid && fidNow !== fid) return { saved: true, validationFailed: null };
      if (isZeroCount()) return { saved: true, validationFailed: null };
      const okToast = document.querySelector('.ant-message-success, .ant-notification-notice-success, .ant-message-info');
      if (okToast) return { saved: true, validationFailed: null };
      const netOk = getRecentMihsapSaveNetwork(netSince, 15000);
      if (netOk) return { saved: true, validationFailed: null, via: `network:${netOk.status}` };

      const validationMsg = validationDialogVarMi();
      if (validationMsg) {
        validationFailed = validationMsg;
        await handleDialogs();
        return { saved: false, validationFailed };
      }

      if (getVisibleModals().length > 0) {
        const r = await handleDialogs();
        if (r === 'validation') return { saved: false, validationFailed: recentValidationFailure() };
        if (r === 'not-pending') return { saved: true, validationFailed: null };
        if (r === 'resubmit' || r === 'retry-f2') {
          const res = await onaylaSonrasiF2(fid);
          if (res === 'already-advanced') continue;
          continue;
        }
        await sleep(200);
        const fidAfterDialog = getCurrentFid();
        if (fidAfterDialog && fid && fidAfterDialog !== fid) return { saved: true, validationFailed: null };
      }
      await sleep(250);
    }

    return { saved: false, validationFailed };
  }

  async function kaydetOnaylaVeBekle(fid, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 4500;
    const retryTimeoutMs = opts.retryTimeoutMs ?? 1800;
    const retryDelayMs = opts.retryDelayMs ?? 150;
    const retry = opts.retry !== false;

    const firstSince = Date.now();
    await clickKaydetOnayla(firstSince);
    let sonuc = await waitFaturaKayitSonucu(fid, timeoutMs, firstSince);
    if (!sonuc.saved && !sonuc.validationFailed && retry) {
      await sleep(retryDelayMs);
      const retrySince = Date.now();
      await clickKaydetOnayla(retrySince);
      sonuc = await waitFaturaKayitSonucu(fid, retryTimeoutMs, retrySince);
    }
    return sonuc;
  }

  async function getFaturaMeta(fid, opts = {}) {
    try {
      const jwt = localStorage.getItem('token');
      const r = await fetch(`/api/mali-musavir/all-faturas/getFaturaBeforeUpdate/${fid}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) return {};
      const j = await r.json();
      const v = j?.sonucValue || j || {};
      // Tarih okuma önceliği (MIHSAP API cevabına göre):
      //  1) v.tarih            → "DD-MM-YYYY" TR formatı (en güvenilir, MIHSAP ekranıyla aynı)
      //  2) v.tarihler[]       → FATURA_TARIHI türünde olan ilk kayıt
      //  3) v.faturaTarihi     → ISO/UTC timestamp (UTC+3 dönüşümü)
      //  4) v.faturaTarihiStr  → TR format fallback
      //  5) v.donemYil+donemAy → mantıksal dönem (ayın 1'i)
      // NOT: v.insertDttm KULLANILMAZ — bu "MIHSAP'a ekleme tarihi"dir, fatura tarihi DEĞİLDİR.
      let tarih = null;

      // TR formatını "YYYY-MM-DD"ye çeviren yardımcı
      const parseTr = (s) => {
        const m = String(s || '').trim().match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        const iso = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        return null;
      };

      if (!tarih && v.tarih) tarih = parseTr(v.tarih);
      if (!tarih && Array.isArray(v.tarihler)) {
        const ft = v.tarihler.find(t => t?.tarihTuru === 'FATURA_TARIHI') || v.tarihler[0];
        if (ft?.tarih) tarih = parseTr(ft.tarih);
      }
      if (!tarih && v.faturaTarihi) {
        const s = String(v.faturaTarihi);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          if (s.includes('T') || s.includes('Z')) {
            // UTC timestamp — Türkiye saatine çevir (UTC+3)
            const utcDate = new Date(s);
            const trDate = new Date(utcDate.getTime() + 3 * 60 * 60 * 1000);
            tarih = trDate.toISOString().slice(0, 10);
          } else {
            tarih = s.slice(0, 10);
          }
        }
      }
      if (!tarih && v.faturaTarihiStr) tarih = parseTr(v.faturaTarihiStr);
      if (!tarih && v.donemYil && v.donemAy) {
        tarih = `${v.donemYil}-${String(v.donemAy).padStart(2, '0')}-01`;
      }
      // v1.36.4 fix — TARIH KOKTEN COZUM: API yaniti bos donerse DOM polling
      // 250ms araliklarla 12 deneme (3sn toplam) — Mihsap form yuklenirken yakala
      if (!tarih) {
        const domDateFallbackMs = Math.max(250, Number(opts.domDateFallbackMs || 1000));
        const sleepMs = 125;
        const attempts = Math.max(1, Math.ceil(domDateFallbackMs / sleepMs));
        for (let attempt = 0; attempt < attempts; attempt++) {
          // Form input'larindan tarih alanini ara
          const tarihInputs = [...document.querySelectorAll('input')].filter(inp => {
            const id = (inp.id || '').toLowerCase();
            const name = (inp.name || '').toLowerCase();
            const placeholder = (inp.placeholder || '').toLowerCase();
            return /tarih|date/.test(id + ' ' + name + ' ' + placeholder);
          });
          for (const inp of tarihInputs) {
            const val = (inp.value || '').trim();
            if (val) {
              const parsed = parseTr(val);
              if (parsed) { tarih = parsed; break; }
            }
          }
          if (tarih) break;
          // DOM text icinde "DD.MM.YYYY" pattern ara
          const allText = document.body?.innerText || '';
          const m = allText.match(/(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})/);
          if (m) {
            const yil = parseInt(m[3], 10);
            const ay = parseInt(m[2], 10);
            const gun = parseInt(m[1], 10);
            // Mantikli tarih kontrolu (2020-2030, ay 1-12, gun 1-31)
            if (yil >= 2020 && yil <= 2030 && ay >= 1 && ay <= 12 && gun >= 1 && gun <= 31) {
              tarih = `${m[3]}-${String(ay).padStart(2,'0')}-${String(gun).padStart(2,'0')}`;
              break;
            }
          }
          await sleep(sleepMs);
        }
      }
      const belgeNo = v.faturaNo || v.belgeNo || null;
      const inferredBelgeTuru = inferBelgeTuruFromBelgeNo(belgeNo) || v.belgeTuru || (
        inferIsOkcFis({
          belgeTuru: v.belgeTuru,
          faturaTuru: v.faturaTuru,
          belgeNo,
          firma: v.faturaFirmaAdi || v.firmaUnvan,
        })
          ? 'FIS'
          : null
      );
      return {
        tarih,
        belgeNo,
        belgeTuru: inferredBelgeTuru,
        faturaTuru: v.faturaTuru || null,
        tutar: v.toplamTutar || v.genelToplam || null,
        firma: v.faturaFirmaAdi || v.firmaUnvan || null,
        // Firma Hafizasi icin VKN/TCKN — Mihsap payload'inda birkac farkli alan olabilir
        firmaKimlikNo:
          v.faturaFirmaKimlikNo ||
          v.firmaKimlikNo ||
          v.karsiFirmaKimlikNo ||
          v.vergiKimlikNo ||
          v.vknTckn ||
          null,
      };
    } catch { return {}; }
  }

  function canvasHasReadableInk(canvas) {
    try {
      const w = Math.min(80, canvas.width || 0);
      const h = Math.min(80, canvas.height || 0);
      if (w < 10 || h < 10) return false;
      const probe = document.createElement('canvas');
      probe.width = w;
      probe.height = h;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let ink = 0;
      let seen = 0;
      for (let i = 0; i < data.length; i += 16) {
        const a = data[i + 3];
        if (a < 16) continue;
        seen++;
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (avg < 245) ink++;
      }
      if (seen < 20) return false;
      return ink / seen > 0.015;
    } catch {
      return true;
    }
  }

  async function getFaturaImageBase64(maxWaitMs = 7000) {
    // Mihsap fatura editöründe görsel CANVAS elementlerinde render ediliyor.
    // Birden fazla sayfa varsa hepsini dikey birleştir.
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs) {
      const canvases = [...document.querySelectorAll('canvas')].filter(
        (c) => c.width > 200 && c.height > 200 && canvasHasReadableInk(c),
      );
      if (canvases.length > 0) {
        try {
          // Multi-page invoices can carry totals or notes after page 1.
          const maxPages = Math.max(1, Math.min(Number(window.__morenAgent?.maxOcrPages || 3), 3));
          const pages = canvases.slice(0, maxPages);
          // Max akisi gorseli dogrudan gormez; backend OCR yapar. OCR icin 900px fazla kucuk
          // kalabiliyor, bu yuzden fatura metnini koruyacak daha yuksek genislik kullan.
          const targetW = Math.min(Math.max(pages[0].width, 1200), 1800);
          const totalH = pages.reduce(
            (s, c) => s + Math.round(targetW * (c.height / c.width)),
            0,
          );
          const out = document.createElement('canvas');
          out.width = targetW;
          out.height = totalH;
          const ctx = out.getContext('2d');
          let y = 0;
          for (const p of pages) {
            const h = Math.round(targetW * (p.height / p.width));
            ctx.drawImage(p, 0, y, targetW, h);
            y += h;
          }
          return out.toDataURL('image/jpeg', 0.9).split(',')[1];
        } catch (e) {
          console.warn('[Moren] canvas merge fail', e);
        }
      }
      const imgs = [...document.querySelectorAll('img')].filter((img) => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const src = String(img.currentSrc || img.src || '');
        return w > 300 && h > 300 && !/logo|avatar|icon|spinner/i.test(src);
      });
      if (imgs.length > 0) {
        try {
          const maxPages = Math.max(1, Math.min(Number(window.__morenAgent?.maxOcrPages || 3), 3));
          const pages = imgs.slice(0, maxPages);
          const targetW = Math.min(Math.max(pages[0].naturalWidth || pages[0].width, 1200), 1800);
          const totalH = pages.reduce((s, img) => {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            return s + Math.round(targetW * (h / w));
          }, 0);
          const out = document.createElement('canvas');
          out.width = targetW;
          out.height = totalH;
          const ctx = out.getContext('2d');
          let y = 0;
          for (const img of pages) {
            const w = img.naturalWidth || img.width;
            const h0 = img.naturalHeight || img.height;
            const h = Math.round(targetW * (h0 / w));
            ctx.drawImage(img, 0, y, targetW, h);
            y += h;
          }
          return out.toDataURL('image/jpeg', 0.9).split(',')[1];
        } catch (e) {
          console.warn('[Moren] image merge fail', e);
        }
      }
      await sleep(200); // v1.36.20 hızlandırma: 500 → 200
    }
    return null;
  }

  function readFreeFaturaTextSnapshot(maxChars = 14000) {
    const docs = [];
    const seen = new Set();
    const visit = (win) => {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        Array.from(win.document?.querySelectorAll('iframe,frame') || []).forEach((fr) => {
          try { visit(fr.contentWindow); } catch {}
        });
      } catch {}
    };
    visit(window);
    const chunks = [];
    const added = new Set();
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const visible = (node) => {
      try {
        if (!node || node.nodeType !== 1) return true;
        const st = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
        if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false;
        const r = node.getBoundingClientRect?.();
        return !r || (r.width > 20 && r.height > 20);
      } catch {
        return true;
      }
    };
    const sourceScore = (doc, node) => {
      try {
        const hay = norm(`${node.id || ''} ${node.className || ''} ${node.getAttribute?.('role') || ''} ${node.getAttribute?.('aria-label') || ''}`);
        const hasDocLayer = /textlayer|react-pdf|pdf|viewer|preview|document|invoice/.test(hay) ||
          !!node.querySelector?.('.textLayer, [class*="textLayer"], [data-page-number], embed, object');
        if (doc === document && /fatura/.test(hay) && !hasDocLayer) return 0;
        let score = 0;
        if (doc !== document && node === doc.body) score += 4;
        if (/textlayer|react-pdf|pdf|viewer|preview|document|invoice|fatura|goruntu|belge/.test(hay)) score += 2;
        if (/dialog|ant-modal|ant-drawer/.test(hay)) score += 1;
        if (node.querySelector?.('canvas, img, svg, text, .textLayer, [class*="textLayer"], [data-page-number], embed, object')) score += 2;
        return score;
      } catch {
        return 0;
      }
    };
    const invoiceTextScore = (text) => {
      const t = norm(text);
      if (/canli islem akisi|son komut|runner calisiyor|otomatik onay durduruldu|yapay zeka onay vermedi/.test(t)) return 0;
      const patterns = [
        /\bkdv\b/,
        /genel\s+toplam|odenecek|toplam\s+tutar|ara\s+toplam/,
        /mal\s*hizmet|hizmet\s+toplam|urun|stok|miktar|birim/,
        /vergi\s+kimlik|vkn|tckn|ettn|mersis/,
        /fatura\s+(no|numara|tarihi|tipi)|invoice\s+(no|date)/,
        /\b[A-Z]{2,4}\d{8,}\b/i,
        /\d{1,3}(?:\.\d{3})*,\d{2}\s*(?:tl|try)?/i,
      ];
      return patterns.reduce((n, re) => n + (re.test(text) || re.test(t) ? 1 : 0), 0);
    };
    for (const doc of docs) {
      const nodes = Array.from(doc.querySelectorAll([
        '[class*="textLayer"]',
        '.react-pdf__Page',
        '[data-page-number]',
        '[class*="pdf"]',
        '[class*="viewer"]',
        '[class*="preview"]',
        '[class*="document"]',
        '[class*="invoice"]',
        '[class*="fatura"]',
        '[role="dialog"]',
        '.ant-modal',
        '.ant-drawer',
      ].join(', '))).filter(Boolean);
      if (doc !== document && doc.body) nodes.push(doc.body);
      for (const node of nodes) {
        if (!visible(node) || sourceScore(doc, node) < 2) continue;
        const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 40 || invoiceTextScore(text) < 2) continue;
        const key = text.slice(0, 500);
        if (added.has(key)) continue;
        added.add(key);
        chunks.push(text.slice(0, 5000));
        if (chunks.join(' ').length >= maxChars) break;
      }
      if (chunks.join(' ').length >= maxChars) break;
    }
    return chunks.join('\n').slice(0, maxChars);
  }

  async function aiDecide({ codes, tarih, hedefAy, belgeNo, belgeTuru, faturaTuru, mukellef, mukellefId, firma, firmaKimlikNo, tutar, action, bosAlanSecenekleri, forceFresh, ruleOnly }) {
    const img = ruleOnly ? '' : await getFaturaImageBase64(4500);
    if (!ruleOnly && !img) return { karar: 'emin_degil', sebep: 'fatura görüntüsü alınamadı' };
    const faturaText = getFaturaTextSnapshotCached(ruleOnly ? 9000 : 14000);
    return await api('/agent/ai/decide-fatura', {
      method: 'POST',
      body: JSON.stringify({
        faturaImageBase64: img,
        ...(faturaText ? { faturaText } : {}),
        hesapKodlari: codes,
        faturaTarihi: tarih,
        hedefAy,
        belgeNo,
        belgeTuru: belgeTuru || (bosAlanSecenekleri ? 'BILINMIYOR' : belgeTuru),
        faturaTuru,
        mukellef,
        mukellefId,
        firma,
        firmaKimlikNo, // Firma Hafizasi icin VKN/TCKN
        tutar,
        action,
        forceFresh: !!forceFresh,
        ruleOnly: !!ruleOnly,
        // Aşama 2a: boş alan seçenekleri gönderilirse AI öneri verir
        ...(bosAlanSecenekleri ? { bosAlanSecenekleri } : {}),
      }),
    });
  }

  function getFaturaTextSnapshotCached(maxChars = 9000) {
    const fid = getCurrentFid() || location.href;
    const cache = window.__morenFaturaTextCache || null;
    if (cache && cache.fid === fid && cache.maxChars >= maxChars && Date.now() - cache.ts < 15000) {
      return cache.text.slice(0, maxChars);
    }
    const text = readFreeFaturaTextSnapshot(maxChars);
    window.__morenFaturaTextCache = { fid, maxChars, text, ts: Date.now() };
    return text;
  }

  async function aiDecideTimed(args, timeoutMs, fallbackReason) {
    return await withTimeoutValue(
      () => aiDecide(args),
      timeoutMs,
      () => ({
        karar: 'emin_degil',
        sebep: fallbackReason || 'karar zaman asimi',
        aiCallReason: args?.ruleOnly ? 'rule_decision_timeout' : 'ai_decision_timeout',
        decisionProvider: 'timeout',
      }),
    );
  }

  function readHesapKodlariFromDom() {
    const codeRe = /\b\d{3}\.\d{1,3}(?:\.\d{1,3}){0,4}\b/g;
    const els = [...document.querySelectorAll('.ant-select-selection-item, .ant-select-selector, .ant-select-selector [title]')]
      .filter((e) => e && (e.offsetParent !== null || e.getClientRects().length > 0));
    const codes = [];
    for (const e of els) {
      const candidates = [
        (e.textContent || '').trim(),
        (e.getAttribute('title') || '').trim(),
      ];
      for (const raw of candidates) {
        const text = raw.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const matches = text.match(codeRe) || [];
        if (/^\d{3}\.\d/.test(text) && matches.length <= 1) {
          codes.push(text);
        } else {
          codes.push(...matches);
        }
      }
    }
    return [...new Set(codes.filter((t) => /^\d{3}\.\d/.test(t)))];
  }

  async function readHesapKodlari(timeoutMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const codes = readHesapKodlariFromDom();
      if (codes.length >= 1) return codes;
      await sleep(500);
    }
    return [];
  }

  async function readCodesOrBlankState(timeoutMs = 3500) {
    const t0 = Date.now();
    let lastCodes = [];
    let lastBlank = false;
    let lastBlankSections = [];
    while (Date.now() - t0 < timeoutMs) {
      const codes = readHesapKodlariFromDom();
      const blankState = faturaBlankSelectState();
      const blank = blankState.bosBolumler.length > 0;
      if (codes.length > 0 || blank) {
        return { codes, hasBosSelect: blank, blankSections: blankState.bosBolumler, blankState };
      }
      lastCodes = codes;
      lastBlank = blank;
      lastBlankSections = blankState.bosBolumler;
      await sleep(150);
    }
    const finalBlankState = faturaBlankSelectState();
    return {
      codes: lastCodes.length ? lastCodes : readHesapKodlariFromDom(),
      hasBosSelect: lastBlank || finalBlankState.bosBolumler.length > 0,
      blankSections: lastBlankSections.length ? lastBlankSections : finalBlankState.bosBolumler,
      blankState: finalBlankState,
    };
  }

  function readKdvOrani() {
    const els = [...document.querySelectorAll('.ant-select-selection-item')];
    const kdv = els.map((e) => (e.textContent || '').trim()).find((t) => /^%\d/.test(t));
    return kdv || null;
  }

  // v1.36.54: Çok satırlı fatura için TÜM KDV oranlarını array olarak döner.
  // DOM'da matrah ve kdv select'leri aynı satır sırasıyla geldiği için index eşleşir:
  // codes[0] ↔ kdvOranlari[0], codes[1] ↔ kdvOranlari[1] ...
  function readAllKdvOranlari() {
    const els = [...document.querySelectorAll('.ant-select-selection-item')];
    return els.map((e) => (e.textContent || '').trim()).filter((t) => /^%\d/.test(t));
  }

  function tumKodlarDolu(codes) {
    return codes.length > 0 && codes.every((c) => c && /^\d/.test(c));
  }

  // Select doldurulmuş mu?
  function selectDolu(sel) {
    if (!sel || sel.offsetParent === null) return false;
    const item = sel.querySelector('.ant-select-selection-item');
    const itemText = (item?.textContent || '').trim();
    // Seçim yapıldıysa .ant-select-selection-item içinde değer olur
    // "Hesap Kodu" placeholder text'i değilse dolu kabul et
    return itemText.length > 0 && !/hesap kodu/i.test(itemText) && !/seçiniz/i.test(itemText);
  }

  // Bir etiketten (örn. "Matrah", "Vergi", "Cari Hesap") sonraki
  // ilk "Hesap Kodu" select'ini bul ve dolu olup olmadığını kontrol et.
  // İlgili bölüm DOM'da bulunmazsa (yoksa) — "yok say" → dolu kabul (NaN).
  function bolumHesapKoduDolu(etiketRegex) {
    // Etiket elementini bul
    const all = [...document.querySelectorAll('div, span, td, label, th, h3, h4')];
    const header = all.find((el) => {
      if (el.offsetParent === null) return false;
      const txt = (el.textContent || '').trim();
      // Etiket sadece kısa olmalı, çok uzun container'ları atla
      if (txt.length > 50) return false;
      return etiketRegex.test(txt);
    });
    if (!header) return null; // bölüm yok

    // Bu header'dan sonraki en yakın "Hesap Kodu" placeholder'lı select
    // DOM walking: aynı parent veya kardeş container
    let container = header.parentElement;
    // Üst container'da birkaç seviye yukarı bakabiliriz
    for (let i = 0; i < 5 && container; i++) {
      const selects = [...container.querySelectorAll('.ant-select')].filter(
        (s) => s.offsetParent !== null,
      );
      // İlk "Hesap Kodu" placeholder'lı select
      const hk = selects.find((s) => {
        const ph = s.querySelector('.ant-select-selection-placeholder');
        const phTxt = (ph?.textContent || '').trim();
        const it = s.querySelector('.ant-select-selection-item');
        const itTxt = (it?.textContent || '').trim();
        return /hesap kodu/i.test(phTxt) || /hesap kodu/i.test(itTxt) || /^\d{3}\.\d/.test(itTxt);
      });
      if (hk) return selectDolu(hk);
      container = container.parentElement;
    }
    return null; // bulunamadı
  }

  // Matrah / Vergi(KDV) / Cari Hesap hesap kodlarından herhangi biri BOŞ mu?
  function faturaBlankSelectState() {
    const sonuc = {
      matrah: bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i),
      vergi: bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i),
      cari: bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i),
    };
    const bosBolumler = [];
    if (sonuc.matrah === false) bosBolumler.push('Matrah');
    if (sonuc.vergi === false) bosBolumler.push('Vergi/KDV');
    if (sonuc.cari === false) bosBolumler.push('Cari Hesap');

    if (bosBolumler.length > 0) {
      console.log('[Moren] BOS BOLUMLER:', bosBolumler, sonuc);
    }
    return { sonuc, bosBolumler };
  }

  function bosSelectVarMi() {
    const state = faturaBlankSelectState();
    return state.bosBolumler.length > 0;
  }

  // ==========================================================
  // v1.12.3 — Bir Hesap Kodu select'inin "satırındaki tutar"ı oku.
  // Y-koordinat tabanlı eşleme: select'in dikey hizasına EN YAKIN tutar input'u
  // bulunur. searchAndReadOptions sırasında DOM değişse (Mihsap "+ekle" satırı
  // ekler) bile doğru satırı bulur.
  // ==========================================================
  function getRowTutarValue(selectEl) {
    if (!selectEl) return 0;
    const sRect = selectEl.getBoundingClientRect();
    if (sRect.height === 0) return 0;
    const sCenterY = sRect.top + sRect.height / 2;
    // Yukarı 6 seviye container ara, her birinde dikey olarak en yakın input
    let p = selectEl;
    for (let i = 0; i < 6 && p; i++) {
      p = p.parentElement;
      if (!p) break;
      const inputs = [...p.querySelectorAll('input')].filter((inp) => inp.offsetParent !== null);
      let bestVal = null;
      let bestDy = Infinity;
      for (const inp of inputs) {
        const v = (inp.value || '').trim();
        // TR formatı: "21.782,18", "0,00", "1.234.567,89", "300.000"
        if (!/^-?[\d.]+,\d{2}$/.test(v) && !/^-?\d{1,3}(\.\d{3})*$/.test(v) && !/^-?\d+$/.test(v)) continue;
        const r = inp.getBoundingClientRect();
        if (r.height === 0) continue;
        const dy = Math.abs((r.top + r.height / 2) - sCenterY);
        // 30px dikey tolerans (aynı satırın yüksekliği genelde ~32px)
        if (dy < 30 && dy < bestDy) {
          bestDy = dy;
          bestVal = v;
        }
      }
      if (bestVal !== null) {
        const numStr = bestVal.replace(/\./g, '').replace(',', '.');
        const n = parseFloat(numStr);
        if (!isNaN(n)) return n;
      }
    }
    return 0;
  }

  // ==========================================================
  // v1.12.1 — Bir bölümün BOŞ "Hesap Kodu" select'ini bulur.
  // Birden çok boş varsa (ana satır + "+yeni" satırı), tutar > 0 olanı tercih eder.
  // Tüm select'ler doluysa ilk Hesap Kodu select'ini döndürür (geri uyumluluk).
  // ==========================================================
  function findHesapKoduSelect(etiketRegex) {
    const all = [...document.querySelectorAll('div, span, td, label, th, h3, h4')];
    const header = all.find((el) => {
      if (el.offsetParent === null) return false;
      const txt = (el.textContent || '').trim();
      if (txt.length > 50) return false;
      return etiketRegex.test(txt);
    });
    if (!header) return null;
    let container = header.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      const selects = [...container.querySelectorAll('.ant-select')].filter((s) => s.offsetParent !== null);
      const hkAll = selects.filter((s) => {
        const ph = s.querySelector('.ant-select-selection-placeholder');
        const phTxt = (ph?.textContent || '').trim();
        const it = s.querySelector('.ant-select-selection-item');
        const itTxt = (it?.textContent || '').trim();
        return /hesap kodu/i.test(phTxt) || /hesap kodu/i.test(itTxt) || /^\d{3}\.\d/.test(itTxt);
      });
      if (hkAll.length === 0) {
        container = container.parentElement;
        continue;
      }
      // SADECE BOŞ olanlar
      const bosOlanlar = hkAll.filter((s) => !selectDolu(s));
      if (bosOlanlar.length === 0) {
        // Hepsi dolu → eski davranış, ilki
        return hkAll[0];
      }
      if (bosOlanlar.length === 1) return bosOlanlar[0];
      // Birden fazla boş select → satırında tutar > 0 olanı seç (asıl satır)
      let best = null;
      let bestTutar = -1;
      const debug = [];
      for (const s of bosOlanlar) {
        const t = getRowTutarValue(s);
        debug.push(t);
        if (t > bestTutar) {
          bestTutar = t;
          best = s;
        }
      }
      console.log(`[Moren.fill] findHesapKoduSelect ${etiketRegex} — ${bosOlanlar.length} boş select, tutarlar:`, debug, `→ seçilen tutar: ${bestTutar}`);
      // Tutarı > 0 olan varsa onu, yoksa ilk boşu döndür
      return bestTutar > 0 ? best : bosOlanlar[0];
    }
    return null;
  }

  // Mihsap dropdown'u "remote search" modunda — tıklayınca boş, yazınca sonuç döner.
  // Her search term için: dropdown'u aç, yaz, bekle, seçenekleri oku, kapat.
  async function searchAndReadOptions(selectEl, searchTerm, waitMs = 1500) {
    if (!selectEl) return [];
    try {
      await closeAllAntDropdowns();
      await sleep(150);
      // Aç (tıkla)
      selectEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(80);
      const selector = selectEl.querySelector('.ant-select-selector') || selectEl;
      selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      selector.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      selector.click();
      const input = selectEl.querySelector('input.ant-select-selection-search-input') || selectEl.querySelector('input');
      if (!input) return [];
      try { input.focus(); } catch {}
      await sleep(100);
      // Yaz (React state'e ulaşmak için native setter)
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(80);
      nativeSetter.call(input, searchTerm);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Debounce + backend API cevabını bekle
      await sleep(waitMs);
      // Seçenekleri topla
      const dd = findDropdownForSelect(selectEl);
      const options = [];
      if (dd) {
        dd.querySelectorAll('.ant-select-item-option-content').forEach((el) => {
          const t = (el.textContent || '').trim();
          if (t) options.push(t);
        });
      }
      return options;
    } catch (e) {
      console.warn('[Moren] searchAndReadOptions hata:', e?.message);
      return [];
    } finally {
      await closeAllAntDropdowns();
    }
  }

  // ===========================================================
  // v1.12.0 — AŞAMA 1: Boş alan otomatik doldurma (kayıt YOK)
  // Tüm gerekli alanlar eşik ÜSTÜNDEYSE doldur, F2'ye BASMA.
  // Kullanıcı manuel kaydetsin (60s bekle). Eşik altıysa atla.
  // ===========================================================
  // v1.13.3 — Eşikler düşürüldü (kullanıcı isteği üzerine).
  // Tek sondaj sonucu varsa zaten o; AI null dönmediyse genellikle güvenilir.
  const BOS_ALAN_ESIKLERI = {
    cari:   0.70,
    matrah: 0.70,
    kdv:    0.70,
    odeme:  0.70,
  };
  const BOS_ALAN_BEKLEME_MS = 60000; // Manuel F2 için bekleme

  // Boş alanlar için arama-bazlı seçenek okuma.
  // Matrah: 600/601/602 yazıp tüm yurtiçi satış kodlarını topla (SATIŞ modu için).
  // KDV: 391 yazıp hesaplanan KDV kodlarını topla.
  // Cari: firmaAdi'nin ilk kısmıyla ara.
  async function readBosAlanSecenekleri({ action, firmaAdi } = {}) {
    const sonuc = {};
    const matrahDolu = bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i);
    const vergiDolu  = bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i);
    const cariDolu   = bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i);

    console.log('[Moren.debug] readBosAlanSecenekleri — başlıyor', { matrahDolu, vergiDolu, cariDolu, action, firmaAdi });

    // "600.01.005-YURTİÇİ SATIŞLAR %1" veya "600.01.005 - ..." şeklindeki option'dan kod kısmı
    const extractKod = (optText) => {
      const m = optText.match(/^(\d{3}\.[A-Z0-9Öİ]+(?:\.[A-Z0-9Öİ]+)*)/i);
      if (m) return m[1].trim();
      return optText.split(/[\s\-]/)[0].trim();
    };

    // Matrah: SATIŞ modunda 600/601/602 prefix sondajı (yurtiçi/yurtdışı/diğer).
    // AI tümünü görür, fatura içeriğine göre doğru kategoriyi seçer.
    if (matrahDolu === false) {
      const sel = findHesapKoduSelect(/^Matrah\s*\(/i) || findHesapKoduSelect(/^Matrah$/i);
      if (sel) {
        const isSatis = (action === 'isle_satis' || action === 'isle_satis_isletme');
        const prefixler = isSatis ? ['600', '601', '602'] : ['153', '740', '770', '760'];
        const all = new Set();
        for (const pre of prefixler) {
          const opts = await searchAndReadOptions(sel, pre);
          console.log(`[Moren.debug] matrah "${pre}" → ${opts.length} sonuç`, opts.slice(0, 3));
          opts.forEach((o) => all.add(o));
        }
        const kodlar = [...all].map(extractKod).filter((c) => /^\d{3}\.\w/.test(c));
        if (kodlar.length > 0) sonuc.matrahKodlari = kodlar;
      }
    }

    // KDV: 391 (SATIŞ hesaplanan) / 191 (ALIŞ indirilecek)
    if (vergiDolu === false) {
      const sel = findHesapKoduSelect(/^Vergi\s*\(/i) || findHesapKoduSelect(/^KDV/i) || findHesapKoduSelect(/^Vergi$/i);
      if (sel) {
        const isSatis = (action === 'isle_satis' || action === 'isle_satis_isletme');
        const prefixler = isSatis ? ['391'] : ['191'];
        const all = new Set();
        for (const pre of prefixler) {
          const opts = await searchAndReadOptions(sel, pre);
          console.log(`[Moren.debug] kdv "${pre}" → ${opts.length} sonuç`, opts.slice(0, 3));
          opts.forEach((o) => all.add(o));
        }
        const kodlar = [...all].map(extractKod).filter((c) => /^\d{3}\.\w/.test(c));
        if (kodlar.length > 0) sonuc.kdvKodlari = kodlar;
      }
    }

    // Cari: firma adının ilk kısmıyla ara (minimum 3, maks 10 karakter)
    // v1.13.1: SADECE 120.x kodları (alıcılar). 320 (satıcılar) SATIŞ faturasında yanlış kategori.
    if (cariDolu === false) {
      const sel = findHesapKoduSelect(/^Cari Hesap\s*\(/i) || findHesapKoduSelect(/^Cari Hesap$/i) || findHesapKoduSelect(/^Cari$/i);
      if (sel && firmaAdi && firmaAdi.length >= 3) {
        const temiz = firmaAdi.replace(/[^\wÇĞİÖŞÜçğıöşü\s]/g, '').trim();
        const ilkKelime = temiz.split(/\s+/)[0] || '';
        const anahtar = ilkKelime.slice(0, Math.min(8, ilkKelime.length));
        if (anahtar.length >= 3) {
          const opts = await searchAndReadOptions(sel, anahtar, 1800);
          console.log(`[Moren.debug] cari "${anahtar}" → ${opts.length} sonuç`, opts.slice(0, 3));
          const isSatis = (action === 'isle_satis' || action === 'isle_satis_isletme');
          // SATIŞ → sadece 120.x (alıcılar). ALIŞ → sadece 320.x (satıcılar).
          const cariRegex = isSatis ? /^120\./ : /^320\./;
          const kodlar = opts.map(extractKod).filter((c) => cariRegex.test(c));
          if (kodlar.length > 0) sonuc.cariKodlari = kodlar;
          else console.log(`[Moren.debug] cari — ${isSatis ? '120.x' : '320.x'} kodu bulunamadı`);
        }
      } else if (sel) {
        console.log('[Moren.debug] cari — firma adı yok veya çok kısa, atlandı');
      }
    }

    console.log('[Moren.debug] readBosAlanSecenekleri — SONUÇ:', sonuc);
    return sonuc;
  }

  // v1.12.6 — AŞAMA 1 yeniden aktif. searchAndReadOptions × 5 kaldırıldı (Mihsap state
  // bozuyordu). Artık hesap planından (codes) filtreleyerek AI'a öneri istiyoruz, sonra
  // pickAntSelectByKodPrefix ile TEK SEFERDE yaz+Enter — manuel test mantığıyla aynı.
  const ASAMA_1_AKTIF = true;

  // v1.12.6 — Boş alan seçeneklerini dropdown sondajıyla DEĞİL, hesap planından
  // (codes) filtreleyerek üretir. Codes faturada görünen kodlar — yetersizse standart
  // Türk hesap kodları ile fallback. Mihsap DOM'una hiç dokunmaz, state bozulmaz.
  // Standart Türk Tek Düzen Hesap Planı (en yaygın yurtiçi satış / KDV kodları)
  const STANDART_MATRAH_SATIS = [
    '600.01.001', '600.01.002', '600.01.005', '600.01.006', '600.01.018', '600.01.020',
    '601.01.001',
    '602.01.001',
  ];
  const STANDART_KDV_SATIS = [
    '391.01.001', '391.01.002', '391.01.006', '391.01.018', '391.01.020',
  ];
  const STANDART_MATRAH_ALIS = [
    '153.01.001', '153.01.008', '153.01.010', '153.01.018', '153.01.020',
    '740.01.001', '770.01.001', '760.01.001',
  ];
  const STANDART_KDV_ALIS = [
    '191.108.01', '191.108.08', '191.108.10', '191.108.18', '191.108.20',
    '191.01.001', '191.01.008', '191.01.010', '191.01.018', '191.01.020',
  ];
  const STANDART_CARI_ALIS = ['100.01.001', '102.01.001', '320.01.001'];
  const STANDART_CARI_SATIS = ['100.01.001', '102.01.001', '120.01.001'];
  const STANDART_ODEME_ALIS = ['100.01.001', '102.01.001', '320.01.001'];
  const STANDART_ODEME_SATIS = ['100.01.001', '102.01.001', '120.01.001'];
  const ODEME_HESABI_RE = /^(Tahsilat\s*\/\s*.*deme|.*deme|Tahsilat).*Hesab/i;

  // v1.12.8 — Cari için TEK SEFER dropdown sondajı (firma adı prefix ile).
  // Mihsap state'i bozulmaz (manuel testteki gibi 1 dropdown açma+kapama).
  async function cariSecenekleriBul(firmaAdi, action) {
    if (!firmaAdi || firmaAdi.length < 3) return [];
    const sel = findHesapKoduSelect(/^Cari Hesap\s*\(/i) || findHesapKoduSelect(/^Cari Hesap$/i) || findHesapKoduSelect(/^Cari$/i);
    if (!sel) return [];
    // Firma adının ilk anlamlı 3-8 harfini al (ör "ÖZENİR TURİZM" → "ÖZENİR")
    const temiz = firmaAdi.replace(/[^\wÇĞİÖŞÜçğıöşü\s]/g, '').trim();
    const ilkKelime = temiz.split(/\s+/)[0] || '';
    const anahtar = ilkKelime.slice(0, Math.min(8, ilkKelime.length));
    if (anahtar.length < 3) return [];
    try {
      const opts = await searchAndReadOptions(sel, anahtar, 1800);
      console.log(`[Moren.fill] cari "${anahtar}" → ${opts.length} sonuç`, opts.slice(0, 3));
      // Kod kismini cikar; alista 320/100/102, satista 120/100/102 kabul edilir.
      const isSatis = action === 'isle_satis' || action === 'isle_satis_isletme';
      const cariRegex = isSatis ? /^(120|100|102)\./ : /^(320|100|102)\./;
      const kodlar = opts.map((t) => {
        const m = t.match(/^(\d{3}\.[A-Z0-9Öİ]+(?:\.[A-Z0-9Öİ]+)*)/i);
        return m ? m[1].trim() : t.split(/[\s\-]/)[0].trim();
      }).filter((c) => cariRegex.test(c));
      return kodlar;
    } catch (e) {
      console.warn('[Moren.fill] cariSecenekleriBul hata:', e?.message);
      return [];
    }
  }

  async function readBosAlanSecenekleriHizli({ action, codes, firmaAdi, forceBosAlanlar = false } = {}) {
    const sonuc = {};
    const isSatis = action === 'isle_satis' || action === 'isle_satis_isletme';
    const isIsletme = action === 'isle_alis_isletme' || action === 'isle_satis_isletme';
    const forceIsletmeBos = forceBosAlanlar || isIsletme;
    let matrahDolu = bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i);
    let vergiDolu  = bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i);
    let cariDolu   = bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i);
    let odemeDolu  = bolumHesapKoduDolu(ODEME_HESABI_RE);
    if (forceIsletmeBos) {
      if (matrahDolu === null) matrahDolu = false;
      if (vergiDolu === null) vergiDolu = false;
      if (cariDolu === null) cariDolu = false;
      if (odemeDolu === null) odemeDolu = false;
    }
    const arr = Array.isArray(codes) ? codes : [];

    if (matrahDolu === false) {
      const re = isSatis ? /^60[012]\./ : /^(153|740|770|760)\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0) list = isSatis ? [...STANDART_MATRAH_SATIS] : [...STANDART_MATRAH_ALIS];
      if (list.length > 0) sonuc.matrahKodlari = list;
    }
    if (vergiDolu === false) {
      const re = isSatis ? /^391\./ : /^191\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0) list = isSatis ? [...STANDART_KDV_SATIS] : [...STANDART_KDV_ALIS];
      if (list.length > 0) sonuc.kdvKodlari = list;
    }
    if (cariDolu === false) {
      // Önce codes'tan dene, yoksa firma adıyla TEK SEFER sondaj yap
      const re = isSatis ? /^(120|100|102)\./ : /^(320|100|102)\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0 && firmaAdi) {
        list = await cariSecenekleriBul(firmaAdi, action);
      }
      // Cari alaninda tek seferlik alislar icin odeme/kasa secenegi daima listede kalsin.
      // Backend profil politikasi surekli tedarikci degilse 320/120 yerine bunu secer.
      const odemeAdaylari = (isSatis ? STANDART_CARI_SATIS : STANDART_CARI_ALIS)
        .filter((c) => /^(100|102)\./.test(c));
      list = Array.from(new Set([...odemeAdaylari, ...list]));
      if (list.length === 0) list = isSatis ? [...STANDART_CARI_SATIS] : [...STANDART_CARI_ALIS];
      if (list.length > 0) sonuc.cariKodlari = list;
    }
    if (odemeDolu === false) {
      const re = isSatis ? /^(100|102|120)\./ : /^(100|102|320)\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0) list = isSatis ? [...STANDART_ODEME_SATIS] : [...STANDART_ODEME_ALIS];
      if (list.length > 0) sonuc.odemeKodlari = list;
    }
    console.log('[Moren.fill] readBosAlanSecenekleriHizli:', { matrahDolu, vergiDolu, cariDolu, odemeDolu, codesAdet: arr.length, sonuc });
    return sonuc;
  }

  function normalizeBosAlanDurumlari(durumlar, forceBosAlanlar = false) {
    if (!forceBosAlanlar) return durumlar;
    return {
      matrahDolu: durumlar.matrahDolu === null ? false : durumlar.matrahDolu,
      vergiDolu: durumlar.vergiDolu === null ? false : durumlar.vergiDolu,
      cariDolu: durumlar.cariDolu === null ? false : durumlar.cariDolu,
      odemeDolu: durumlar.odemeDolu === null ? false : durumlar.odemeDolu,
    };
  }

  function parseKdvOraniDegeri(text) {
    const m = String(text || '').match(/%?\s*(\d{1,2})/);
    return m ? Number(m[1]) : null;
  }

  function kodSonParcaDegeri(kod) {
    const last = String(kod || '').split('.').pop() || '';
    const n = Number(last.replace(/^0+/, '') || '0');
    return Number.isFinite(n) ? n : null;
  }

  function pickKodByPrefixAndRate(list, prefixes, rate) {
    const arr = Array.isArray(list) ? list.filter(Boolean) : [];
    for (const prefix of prefixes) {
      const prefixed = arr.filter((kod) => String(kod).startsWith(`${prefix}.`));
      if (rate != null) {
        const byRate = prefixed.find((kod) => kodSonParcaDegeri(kod) === rate);
        if (byRate) return byRate;
      }
      if (prefixed.length > 0) return prefixed[0];
    }
    return arr[0] || null;
  }

  function applyIsletmeAccountCodeFallback({ action, secenekler, oneri }) {
    const next = { ...(oneri || {}), confidence: { ...((oneri && oneri.confidence) || {}) } };
    const isSatis = action === 'isle_satis' || action === 'isle_satis_isletme';
    const kdvOrani = parseKdvOraniDegeri(readKdvOrani());
    const fallbackNotlari = [];

    if (!next.matrahHesapKodu) {
      const kod = pickKodByPrefixAndRate(
        secenekler.matrahKodlari,
        isSatis ? ['600', '601', '602'] : ['153', '740', '770', '760'],
        kdvOrani,
      );
      if (kod) {
        next.matrahHesapKodu = kod;
        next.confidence.matrah = Math.max(Number(next.confidence.matrah) || 0, 0.95);
        fallbackNotlari.push(`matrah:${kod}`);
      }
    }

    if (!next.kdvHesapKodu) {
      const kod = pickKodByPrefixAndRate(
        secenekler.kdvKodlari,
        isSatis ? ['391'] : ['191'],
        kdvOrani,
      );
      if (kod) {
        next.kdvHesapKodu = kod;
        next.confidence.kdv = Math.max(Number(next.confidence.kdv) || 0, 0.95);
        fallbackNotlari.push(`kdv:${kod}`);
      }
    }

    if (!next.cariHesapKodu) {
      const cariList = Array.isArray(secenekler.cariKodlari) ? secenekler.cariKodlari : [];
      const kod = cariList.find((c) => /^100\./.test(c))
        || cariList.find((c) => /^102\./.test(c))
        || cariList[0]
        || null;
      if (kod) {
        next.cariHesapKodu = kod;
        next.confidence.cari = Math.max(Number(next.confidence.cari) || 0, 0.95);
        fallbackNotlari.push(`cari:${kod}`);
      }
    }

    if (fallbackNotlari.length > 0) {
      next._deterministicFallback = fallbackNotlari.join(', ');
      console.log('[Moren.fill] account-code deterministic fallback:', {
        kdvOrani,
        fallback: next._deterministicFallback,
      });
    }
    return next;
  }

  async function tryFillBosAlanlar({ secenekler, oneri, durumlar }) {
    if (!ASAMA_1_AKTIF) {
      return { dolduruldu: false, sebep: 'Aşama 1 devre dışı (Mihsap UX araştırılıyor)' };
    }
    const o = oneri || {};
    const cf = o.confidence || {};
    const ihtiyac = {
      matrah: durumlar.matrahDolu === false,
      kdv:    durumlar.vergiDolu  === false,
      cari:   durumlar.cariDolu   === false,
      odeme:  durumlar.odemeDolu  === false,
    };
    const ilkOdemeKodu = (secenekler.odemeKodlari || []).includes('100.01.001')
      ? '100.01.001'
      : (secenekler.odemeKodlari || [])[0];
    const eslestir = {
      matrah: { kod: o.matrahHesapKodu, conf: cf.matrah || 0, esik: BOS_ALAN_ESIKLERI.matrah },
      kdv:    { kod: o.kdvHesapKodu,    conf: cf.kdv    || 0, esik: BOS_ALAN_ESIKLERI.kdv },
      cari:   { kod: o.cariHesapKodu,   conf: cf.cari   || 0, esik: BOS_ALAN_ESIKLERI.cari },
      odeme:  { kod: o.odemeHesapKodu || o.tahsilatOdemeHesapKodu || ilkOdemeKodu, conf: cf.odeme || cf.cari || 0.95, esik: BOS_ALAN_ESIKLERI.odeme },
    };
    // Eşik kontrolü — ihtiyacı olan TÜM alanlar eşik üstünde olmalı, biri eksikse hiçbiri doldurulmaz
    const eksikler = [];
    for (const [k, v] of Object.entries(ihtiyac)) {
      if (!v) continue;
      const e = eslestir[k];
      if (!e.kod || e.conf < e.esik) {
        eksikler.push(!e.kod
          ? `${k}=kod yok`
          : `${k}=%${Math.round(e.conf * 100)}<%${Math.round(e.esik * 100)}`);
      }
    }
    if (eksikler.length > 0) {
      return { dolduruldu: false, sebep: `eşik altı: ${eksikler.join(', ')}` };
    }
    // Tüm gerekli alanlar eşik üstünde → sırayla doldur
    const sonuclar = [];
    // v1.13.2 — alanlar arasında 1.5s bekleme (Mihsap rahat olsun)
    if (ihtiyac.matrah) {
      const sel = findHesapKoduSelect(/^Matrah\s*\(/i) || findHesapKoduSelect(/^Matrah$/i);
      const ok = sel ? await pickAntSelectByKodPrefix(sel, eslestir.matrah.kod, '[MATRAH]') : false;
      sonuclar.push(`M:${ok ? 'OK' : 'X'}`);
      if (!ok) {
        await closeAllAntDropdowns();
        return { dolduruldu: false, sebep: `matrah seçilemedi (${eslestir.matrah.kod})` };
      }
      await sleep(1500);
    }
    if (ihtiyac.kdv) {
      const sel = findHesapKoduSelect(/^Vergi\s*\(/i) || findHesapKoduSelect(/^KDV/i) || findHesapKoduSelect(/^Vergi$/i);
      const ok = sel ? await pickAntSelectByKodPrefix(sel, eslestir.kdv.kod, '[KDV]') : false;
      sonuclar.push(`K:${ok ? 'OK' : 'X'}`);
      if (!ok) {
        await closeAllAntDropdowns();
        return { dolduruldu: false, sebep: `kdv seçilemedi (${eslestir.kdv.kod})` };
      }
      await sleep(1500);
    }
    if (ihtiyac.cari) {
      const sel = findHesapKoduSelect(/^Cari Hesap\s*\(/i) || findHesapKoduSelect(/^Cari Hesap$/i) || findHesapKoduSelect(/^Cari$/i);
      const ok = sel ? await pickAntSelectByKodPrefix(sel, eslestir.cari.kod, '[CARI]') : false;
      sonuclar.push(`C:${ok ? 'OK' : 'X'}`);
      if (!ok) {
        await closeAllAntDropdowns();
        return { dolduruldu: false, sebep: `cari seçilemedi (${eslestir.cari.kod})` };
      }
      await sleep(1500);
    }
    if (ihtiyac.odeme) {
      const sel = findHesapKoduSelect(ODEME_HESABI_RE);
      const ok = sel ? await pickAntSelectByKodPrefix(sel, eslestir.odeme.kod, '[ODEME]') : false;
      sonuclar.push(`O:${ok ? 'OK' : 'X'}`);
      if (!ok) {
        await closeAllAntDropdowns();
        return { dolduruldu: false, sebep: `odeme hesabi secilemedi (${eslestir.odeme.kod})` };
      }
      await sleep(900);
    }
    return { dolduruldu: true, sebep: `dolduruldu ${sonuclar.join(' ')}` };
  }

  // v1.12.0 — Doldurma sonrası kullanıcının manuel F2'sini bekle.
  // fid değişirse 'saved', DUR'a basılırsa 'stopped', süre dolarsa 'timeout'.
  async function manuelKayitBekle(fid, mukellefAd) {
    const t0 = Date.now();
    let lastLog = 0;
    while (Date.now() - t0 < BOS_ALAN_BEKLEME_MS) {
      if (window.__morenAgent.stopRequested) return 'stopped';
      const m = location.href.match(/\/(\d+)\?count=/);
      if (m && m[1] !== fid) return 'saved';
      if (/count=0/.test(location.href)) return 'saved';
      if (Date.now() - lastLog > 10000) {
        const kalan = Math.round((BOS_ALAN_BEKLEME_MS - (Date.now() - t0)) / 1000);
        setStatus(`${mukellefAd} · #${fid} ✏️ Dolduruldu — F2 bekliyor (${kalan}s)`);
        console.log(`[Moren.fill] Dolduruldu, manuel F2 bekleniyor — kalan ${kalan}s`);
        lastLog = Date.now();
      }
      await sleep(500);
    }
    return 'timeout';
  }

  // F2 sonrası validation uyarısı kontrolü
  // "Tahsilat/Ödeme hesabı seçilmemiş", "Hesap kodu girilmemiş" gibi
  function validationDialogVarMi() {
    const remembered = recentValidationFailure();
    if (remembered) return remembered;
    const pageErrors = [...document.querySelectorAll('.ant-message-error, .ant-notification-notice-error')]
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    if (pageErrors.length > 0) return pageErrors.join(' | ').slice(0, 100);

    const modals = getVisibleModals();
    for (const m of modals) {
      const text = (m.textContent || '').trim();
      if (/seçilmemiş/i.test(text) ||
          /girilmemiş/i.test(text) ||
          /eksik/i.test(text) ||
          /zorunlu/i.test(text) ||
          /boş bırakılamaz/i.test(text) ||
          /tahsilat.*ödeme/i.test(text)) {
        return text.slice(0, 100);
      }
    }
    return null;
  }

  function demirbasVarMi(codes) {
    return codes.some((c) => /^255/.test(c) || /demirbaş/i.test(c));
  }

  // === İŞLETME DEFTERİ: Kayıt Türü + K. Alt Türü blok kontrolü ===
  // Her blok için 2 Ant Design Select var: "Kayıt Türü" ve "K. Alt Türü".
  // Bir blokta herhangi biri boşsa (placeholder / "Seçiniz") → bu fatura atla.

  // Hardcoded: Kayıt Türü → K. Alt Türü listesi (MIHSAP canlıdan toplandı, 2026-04)
  // Alt Türü AI kararını bu listeye göre sınırlandırıyoruz, dropdown okumaya gerek kalmıyor.
  const ISLETME_KAYIT_ALT_MAP = {
    'Mal Alışı': ['Dönem Başı Emtia', 'Mal Alışı'],
    'Sabit Kıymet Alışı': [
      'Amortisman Giderleri (40/7)- Binek İkinci El Araç',
      'Amortisman Giderleri (40/7)- Binek Sıfır Araç (KDV-ÖTV Dâhil)',
      'Amortisman Giderleri (40/7)- Binek Sıfır Araç (KDV-ÖTV Hariç)',
      'Amortisman Giderleri (GVK 40/7)',
      'Amortisman Giderleri (GVK 57/6)',
      'İşletmenin Esas Faaliyet Konusu İle İlgili Olmayan Vasıtalara Ait Amortismanlar (4008 Md.25)',
      'Kiralama Yoluyla Edinilen veya İşletmede Kayıtlı Olan Yat, Kotra, Tekne, Sürat Teknesi Gibi Motorlu Deniz, Uçak ve Helikopter Gibi Hava Taşıtlarından İşletmenin Esas Faaliyet Konusu İle İlgili Olmayanların Amortismanları',
      'VUK Hükümlerine Aykırı Olarak Ayrılan Amortismanlar',
      'Zirai Faaliyet Yanında İşletme Sahiplerinin Şahsi veya Ailevi İhtiyaçları İçinde Kullanılan Taşıtların Amortismanlarının Tamamı (GVK 57/11)',
    ],
    'Sabit Kıymet Ek Maliyet': [
      'Diğer',
      'Faiz Giderleri',
      'Gümrükleme ve Antrepo Giderleri',
      'Kur Farkı Giderleri',
      'Nakliye Giderleri',
      'Navlun ve Sigorta Giderleri',
      'Sabit Kıymetin Ekonomik Faydasını Artıran Bakım Onarım ve Ek Harcamalar',
      'Sabit Kıymetin Ekonomik Ömrünü Uzatan Bakım Onarım ve Ek Harcamalar',
      'Tapu Harcı',
      'Vade Farkı Giderleri',
    ],
    'Gider Kabul Edilmeyen Ödemeler (GVK Md. 41)': [
      'Basın yoluyla işlenen fiillerden veya radyo ve televizyon yayınlarından doğacak maddî ve manevî zararlardan dolayı ödenen tazminat giderleri.(4756 Md.28)',
      'Bağış ve Yardımlar',
      'Binek otomobillerin MTV\'si',
      'Brüt Ücret',
      'Diğer K.K.E.G.',
      'Faiz, komisyon, vade farkı, kâr payı, kur farkı ve benzeri adlar altında yapılan gider ve maliyetler (Öz sermayeyi aşan yabancı kaynaklar için)',
      'Hazine Tarafından Karşılanan Özürlü Personelin Sigorta Primi',
      'Her türlü alkol ve alkollü içkiler ile tütün ve tütün mamullerine ait ilan ve reklâm giderlerinin % 50\'si(3571 Md.8)',
      'Her türlü para cezaları ve vergi cezaları ile teşebbüs sahibinin suçlarından doğan tazminatlar .',
      'İkramiye Ödemeleri',
      'İlişkili kişilerle emsallere uygunluk ilkesine aykırı olarak oluşan giderler(5615 Sy. Md. 3).',
      'İşletmenin esas faaliyet konusu ile ilgili olmayan vasıta giderleri (4008 Md.25)',
      'İşletmenin Esas Faaliyet Konusu İle İlgili Olmayan Vasıtalara Ait Amortismanlar (4008 Md.25)',
      'İşsizlik İşveren Payı',
      'İşsizlik Sigortası Fonu’ndan Karşılanan Sigorta Primleri',
      'Kayıp ve Zayi Olan Mallara Ait Giderler',
      'KDV Kanunu Md. 30/d Uyarınca İndirilemeyen KDV Tutarı',
      'Kiralama Yoluyla Edinilen veya İşletmede Kayıtlı Olan Yat, Kotra, Tekne, Sürat Teknesi Gibi Motorlu Deniz, Uçak ve Helikopter Gibi Hava Taşıtlarından İşletmenin Esas Faaliyet Konusu İle İlgili Olmayanların  Amortismanları',
      'Kiralama Yoluyla Edinilen veya İşletmede Kayıtlı Olan Yat, Kotra, Tekne, Sürat Teknesi Gibi Motorlu Deniz, Uçak ve Helikopter Gibi Hava Taşıtlarından İşletmenin Esas Faaliyet Konusu İle İlgili Olmayanların Giderleri',
      'Prim Ödemeleri',
      'Sgk İşveren Payı',
      'Teşebbüs sahibi ile eşinin ve çocuklarının işletmeden çektikleri paralar veya aynen aldıkları sair değerler.',
      'Teşebbüs sahibinin işletmeye koyduğu sermaye için yürütülecek faizler.',
      'Teşebbüs sahibinin kendisine, eşine, küçük çocuklarına işletmeden ödenen aylıklar, ücretler, ikramiyeler, komisyonlar ve tazminatlar.',
      'Teşebbüs sahibinin, eşinin ve küçük çocuklarının işletmede cari hesap veya diğer şekillerdeki alacakları üzerinden yürütülecek faizler.',
      'VUK hükümlerine aykırı olarak ayrılan amortismanlar',
      'Özel iletişim vergisi',
    ],
    'İndirilecek Giderler (GVK Md. 40)': [
      'Temsil ve Ağırlama Gideri (İş yemeği vb.) (GVK 40/1)',
      'Taşıt Akaryakıt Giderleri (GVK 40/1-40/5)',
      'Taşıt Bakım Onarım Giderleri ( GVK 40/5)',
      'Diğer (GVK 40/1)',
      'Otopark Gideri (GVK Md. 40/5)',
      'Kırtasiye Harcamaları (GVK 40/1)',
      'Amortisman Giderleri (GVK 40/7)',
      'Araç Kiralama Giderleri ( GVK 40/1)',
      'Araç Sigorta Giderleri (Zorunlu Trafik, Kasko vb) (GVK 40/5)',
      'Avukatlık, Hukuk ve Müşavirlik Giderleri (  GVK 40/1)',
      'Bankacılık İşlem Giderleri  (  GVK 40/1)',
      'Beyanname/Bildirge Damga Vergisi Giderleri(GVK 40/6)',
      'Beyannameye Konu Olan Damga Vergisi Giderleri ( GVK 40/1 ) (Vergi Kodu 0040)',
      'Dernek ve Vakıflara Yapılan Gıda, Temizlik, Giyecek ve Yakacak Bağışları ( GVK 40/10 )',
      'Değersiz Hale Gelen Alacağa İlişkin Giderler',
      'Diğer Haberleşme Giderleri (Faks,internet vb) (GVK 40/1)',
      'Diğer Hizmet Giderleri ( GVK 40/1 )',
      'Diğer Sarf Malzeme Giderleri ( GVK 40/1)',
      'Diğer Vergi Resim ve Harçlar ( GVK 40/6 )',
      'Dışarıdan Sağlanan Fayda ve Hizmetler ( GVK 40/1)',
      'Doğalgaz Giderleri (GVK 40/1)',
      'Doğrudan Gider Yazılan Demirbaş ( GVK 40/1)',
      'Elektrik Giderleri (GVK 40/1)',
      'Faiz ve Finansman Giderleri ( GVK 40/1 - 40/3- 40/9)',
      'Gıda Harcamaları (GVK 40/1-40/2)',
      'Giyim Giderleri (GVK 40/2)',
      'Götürü Gider ( GVK 40/1)',
      'Güvenlik Harcamaları (GVK 40/1)',
      'Hal Komisyoncusu Alımı',
      'Hasılat Esaslı Ödenen KDV',
      'Hizmetli ve İşçilerin GVK 27 nci Maddede Yazılı Giyim Giderleri ( GVK 40/2)',
      'İkinci El Motorlu Kara Taşıtlarının Ticareti ( KDV Düzeltmesi )',
      'İnternet Reklam Hizmet Alım Giderleri (GVK 40/1)',
      'İnternet Reklam Hizmetlerine Aracilik Giderleri (GVK 40/1)',
      'Isı yalıtımı ve Enerji Tassarufu Giderleri (GVK 40/7)',
      'İş Güvenliği ve İş Sağlığı Hizmet Alımları (GVK 40/1)',
      'İşle İlgili Olmak Şartıyla Mukavelenameye Bağlı veya İlama veya Kanun Emrine İstinaden Ödenen Zarar, Ziyan ve Tazminat (GVK 40/3)',
      'İşverenlerce Sendikalara Ödenen Aidatlar (GVK 40/8)',
      'İşyeri Aidat Gideri (GVK 40/1)',
      'İşyeri Sigorta Giderleri (GVK 40/1)',
      'Kargo ve Posta Giderleri ( GVK 40/1)',
      'Kira Gideri (GVK 40/1)',
      'Komisyon Giderleri ( GVK 40/1)',
      'Konaklama Giderleri (GVK 40/4)',
      'Motorlu Taşıtlar Vergisi (GVK/40/5)',
      'Muhasebe/Mali Müşavirlik Giderleri (GVK 40/1)',
      'Nakliye Giderleri ( GVK 40/1 )',
      'Normal Bakım Onarım Giderleri ( GVK 40/1 - 40/7 )',
      'Noter Makbuzları ( GVK 40/1 )',
      'Ofis Giderleri(Çay, Kahve, Şeker, Temizlik vb.) (GVK 40/1)',
      'Otoyol ve Gişe (OGS, HGS vb.) (GVK 40/4-5)',
      'Pazarlama Satış Dağıtım Giderleri (GVK 40/1)',
      'Seyahat ve Ulaşım Giderleri (Oto Kiralama, Otobüs, Taksi, Uçak vb) (GVK 40/4-5)',
      'Sıfır Araçlara Ait KDV Gideri (GVK 40/1)',
      'Sıfır Araçlara Ait ÖTV (GVK 40/1)',
      'Su Giderleri (GVK 40/1)',
      'Sözleşme/yargı/kanun emri gereği doğan zarar/ziyan/tazminatlar (GVK 40/3)',
      'Tek Başına Alınabilen Damga Vergisi (GVK 40/1) (Vergi Kodu 9047)',
      'Telefon Giderleri (GVK 40/1)',
      'Ulaşım Giderleri (Oto Kiralama, Taksi, Uçak vb) (GVK 40/4-5)',
      'Yıllara Yaygın İnşaat Maliyetleri',
      'Çalışan Tedavi ve İlaç Gideri (GVK 40/2)',
    ],
    // === SATIŞ tarafı kayıt türleri (ISLETME/2 için) ===
    // Mihsap'ta dropdown şu 4 seçeneği veriyor: Diğer Gelir, Diğer Hasılat,
    // Hizmet Satışı, Mal Satışı. K. Alt Türü her birinde aynı adda tek seçenek.
    'Mal Satışı': ['Mal Satışı'],
    'Hizmet Satışı': ['Hizmet Satışı'],
    'Diğer Gelir': ['Diğer Gelir'],
    'Diğer Hasılat': ['Diğer Hasılat'],
  };
  const ISLETME_KAYIT_TURU_LIST_ALIS = Object.keys(ISLETME_KAYIT_ALT_MAP);
  // ALIŞ (ISLETME/1) için sabit üst liste — Fatura Türü hep "Gider"
  const ISLETME_ALIS_SATIS_TURU_ALIS = ['Normal Alım', 'Satıştan İade'];
  // SATIŞ (ISLETME/2) için tahmini — runtime'da dropdown'dan doğrulanır
  const ISLETME_ALIS_SATIS_TURU_SATIS = ['Normal Satış', 'Alıştan İade'];
  const ISLETME_BELGE_TURU_LIST = [
    'Diğer',
    'e-Arşiv Fatura',
    'e-Bilet',
    'e-Fatura',
    'e-Serbest Meslek Makbuzu',
    'Fatura',
    'Gider Pusulası',
    'Perakende Satış Fişi',
    'Serbest Meslek Makbuzu',
    'Yolcu Taşıma Bileti',
    'ÖKC Fişi',
  ];

  function normalizeTrAscii(value) {
    return String(value || '')
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/İ/g, 'I')
      .replace(/İ/g, 'I')
      .replace(/Ş/g, 'S')
      .replace(/Ğ/g, 'G')
      .replace(/Ü/g, 'U')
      .replace(/Ö/g, 'O')
      .replace(/Ç/g, 'C');
  }

  function inferIsOkcFis(meta = {}) {
    const text = normalizeTrAscii([
      meta.belgeTuru,
      meta.faturaTuru,
      meta.belgeNo,
      meta.firma,
    ].filter(Boolean).join(' '));
    if (/(^|\s)(OKC|O KC|FIS|FISI|PERAKENDE)(\s|$)/.test(text)) return true;
    const no = String(meta.belgeNo || '').trim();
    return /^\d{1,6}$/.test(no);
  }

  function inferBelgeTuruFromBelgeNo(belgeNo) {
    const no = String(belgeNo || '').toUpperCase().trim();
    if (!no) return null;
    // EYK serisi Mihsap/Luca akışında e-Arşiv olarak geliyor; generic e-Fatura kuralından önce yakala.
    if (/^(BEA|EAR|EYK|GIB|EARSIV)/.test(no)) return 'e-Arşiv Fatura';
    if (/(FIS|OKC|ZRP)/.test(no)) return 'ÖKC Fişi';
    return null;
  }

  async function pickBelgeTuruIsletme(meta, fallbackTarget) {
    const candidates = [];
    if (inferIsOkcFis(meta)) {
      candidates.push('ÖKC Fişi', 'OKC Fişi', 'Perakende Satış Fişi', 'Fatura');
    }
    const belgeNoTarget = inferBelgeTuruFromBelgeNo(meta?.belgeNo);
    if (belgeNoTarget) candidates.push(belgeNoTarget);
    if (fallbackTarget) candidates.push(fallbackTarget);
    candidates.push('e-Fatura', 'e-Arşiv Fatura', 'Fatura');

    for (const target of [...new Set(candidates.filter(Boolean))]) {
      const ok = await pickAntSelectById('defterData_belgeTuru', target);
      await sleep(250);
      const current = getAntSelectValueById('defterData_belgeTuru');
      if (ok && current) return current;
    }
    return '';
  }

  function isAntSelectFilled(antSelectEl) {
    if (!antSelectEl) return false;
    const item = antSelectEl.querySelector('.ant-select-selection-item');
    if (!item) return false;
    const text = (item.textContent || '').trim();
    if (!text) return false;
    if (/seçiniz|lütfen|select/i.test(text)) return false;
    return true;
  }

  function isletmeBlokDurumu() {
    // Ekrandaki tüm "Kayıt Türü" label'lerini bul; her biri için komşu "K. Alt Türü" selectini tespit et.
    // Returns detay[i] = { kayitDolu, altDolu, kayitSelect, altSelect, kayitDeger, altDeger, matrah, kdv }
    const result = { varMi: false, toplam: 0, bosBlokVar: false, detay: [] };
    const labels = Array.from(document.querySelectorAll('label, span, div'))
      .filter((el) => {
        const t = (el.textContent || '').trim();
        if (!t) return false;
        if (t.length > 24) return false;
        return /^kay[ıi]t t[üu]r[üu]/i.test(t);
      });

    const seenContainers = new Set();
    for (const lbl of labels) {
      let node = lbl;
      let container = null;
      for (let i = 0; i < 8 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const selects = node.querySelectorAll('.ant-select');
        if (selects.length >= 2) {
          const txt = (node.textContent || '').toLowerCase();
          if (txt.includes('kayıt türü') && txt.includes('alt türü')) {
            container = node;
            break;
          }
        }
      }
      if (!container) continue;
      if (seenContainers.has(container)) continue;
      seenContainers.add(container);

      const selects = Array.from(container.querySelectorAll('.ant-select'));
      if (selects.length < 2) continue;
      const kayitSelect = selects[0];
      const altSelect = selects[1];
      const kayitDolu = isAntSelectFilled(kayitSelect);
      const altDolu = isAntSelectFilled(altSelect);
      const readVal = (s) => (s?.querySelector('.ant-select-selection-item')?.textContent || '').trim();

      // Matrah & KDV oku (container içindeki input/number alanları)
      let matrah = null;
      let kdv = null;
      try {
        const inputs = Array.from(container.querySelectorAll('input'));
        for (const inp of inputs) {
          const v = (inp.value || '').trim();
          if (!v) continue;
          if (/^\d+[.,]?\d*$/.test(v) && matrah === null) matrah = v;
        }
        const spans = Array.from(container.querySelectorAll('.ant-select-selection-item'));
        for (const sp of spans) {
          const t = (sp.textContent || '').trim();
          if (/^%\d/.test(t)) { kdv = t; break; }
        }
      } catch {}

      result.toplam++;
      result.detay.push({
        kayitDolu, altDolu,
        kayitSelect, altSelect,
        kayitDeger: kayitDolu ? readVal(kayitSelect) : null,
        altDeger: altDolu ? readVal(altSelect) : null,
        matrah, kdv,
      });
      if (!kayitDolu || !altDolu) result.bosBlokVar = true;
    }
    result.varMi = result.toplam > 0;
    return result;
  }

  // === Ant Select açma / seçenek listesi / seçim ===
  // Dropdown body'e portal olarak eklenir.
  // aria-controls üzerinden dropdown<->input eşleşmesi yapıyoruz, "yanlış dropdown" hatası olmaz.

  async function closeAllAntDropdowns() {
    document.body.click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    document.body.click();
    await sleep(200);
  }

  async function openAntSelect(antSelectEl) {
    if (!antSelectEl) return null;
    await closeAllAntDropdowns();
    antSelectEl.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(100);
    const input = antSelectEl.querySelector('input');
    const selector = antSelectEl.querySelector('.ant-select-selector') || antSelectEl;
    selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    selector.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    selector.click();
    if (input) try { input.focus(); } catch {}
    // aria-controls ile ilişkili dropdown'u bekle
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      const dd = findDropdownForSelect(antSelectEl);
      if (dd) return dd;
      await sleep(80);
    }
    return null;
  }

  function findDropdownForSelect(antSelectEl) {
    if (!antSelectEl) return null;
    // 1) aria-controls üzerinden kesin eşleşme
    const input = antSelectEl.querySelector('input');
    const ctrl = input?.getAttribute('aria-controls');
    if (ctrl) {
      const dd = document.getElementById(ctrl);
      if (dd && !dd.classList.contains('ant-select-dropdown-hidden')) {
        const st = getComputedStyle(dd);
        if (st.display !== 'none' && st.visibility !== 'hidden') return dd;
      }
    }
    // 2) Fallback: son görünür dropdown
    const all = Array.from(document.querySelectorAll('.ant-select-dropdown'));
    return all.reverse().find((d) => {
      if (d.classList.contains('ant-select-dropdown-hidden')) return false;
      const st = getComputedStyle(d);
      return st.display !== 'none' && st.visibility !== 'hidden';
    }) || null;
  }

  // findOpenDropdown eski uyumluluk: fallback olarak kalıyor
  function findOpenDropdown() {
    return findDropdownForSelect(null);
  }

  async function readAntSelectOptions(antSelectEl) {
    const dd = await openAntSelect(antSelectEl);
    if (!dd) return { opened: false, options: [] };
    const opts = new Set();
    const collect = () => {
      dd.querySelectorAll('.ant-select-item-option-content').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t) opts.add(t);
      });
    };
    collect();
    const scroller = dd.querySelector('.rc-virtual-list-holder') || dd;
    if (scroller && scroller !== dd) {
      let last = -1;
      for (let i = 0; i < 80; i++) {
        scroller.scrollTop += 160;
        await sleep(60);
        collect();
        if (scroller.scrollTop === last) break;
        last = scroller.scrollTop;
      }
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(80);
      collect();
      scroller.scrollTop = 0;
      await sleep(60);
      collect();
    }
    await closeAllAntDropdowns();
    return { opened: true, options: Array.from(opts) };
  }

  // Ant Select'ten bir değer ID'ye göre seç (faturaTuru, defterData_belgeTuru vb.)
  async function openAntSelectById(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return null;
    const sel = input.closest('.ant-select');
    return await openAntSelect(sel);
  }

  function getAntSelectValueById(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return '';
    const sel = input.closest('.ant-select');
    if (!sel) return '';
    const item = sel.querySelector('.ant-select-selection-item');
    return item ? (item.textContent || '').trim() : '';
  }

  async function pickAntSelectOption(antSelectEl, target) {
    const dd = await openAntSelect(antSelectEl);
    if (!dd) return false;
    const clean = (s) => (s || '').trim();
    const targetNorm = clean(target);
    const tryFind = () => {
      const items = Array.from(dd.querySelectorAll('.ant-select-item-option'));
      let hit = items.find((el) => clean(el.textContent) === targetNorm);
      if (!hit) hit = items.find((el) => clean(el.textContent).toLowerCase() === targetNorm.toLowerCase());
      return hit || null;
    };
    let hit = tryFind();
    if (!hit) {
      // Arama filtresi ile dene
      const searchInput = antSelectEl.querySelector('input.ant-select-selection-search-input');
      if (searchInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(searchInput, targetNorm.slice(0, 18));
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
          await sleep(80);
          hit = tryFind();
          if (hit) break;
        }
      }
    }
    if (!hit) {
      // Virtualized scroll ile ara
      const scroller = dd.querySelector('.rc-virtual-list-holder') || dd;
      if (scroller) {
        scroller.scrollTop = 0;
        await sleep(60);
        for (let i = 0; i < 80; i++) {
          scroller.scrollTop += 160;
          await sleep(60);
          hit = tryFind();
          if (hit) break;
        }
      }
    }
    if (!hit) {
      await closeAllAntDropdowns();
      return false;
    }
    hit.scrollIntoView({ block: 'center' });
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    hit.click();
    await sleep(200);
    return isAntSelectFilled(antSelectEl);
  }

  async function pickAntSelectById(inputId, target) {
    const input = document.getElementById(inputId);
    if (!input) return false;
    const sel = input.closest('.ant-select');
    return await pickAntSelectOption(sel, target);
  }

  // v1.14.2 — Dropdown aç + opsiyonel olarak prefix ile arama yap +
  // belirli bir prefix ile başlayan İLK option'ı (yoksa kayıtsız ilk option'ı) tıkla.
  // Mihsap "İşlem Türü" gibi remote-search olmayan select'lerde de çalışır:
  //  - Dropdown açılır → option'lar zaten var → prefix match ile ilk uygun seçilir.
  // Search input ile remote-search'lü select'lerde:
  //  - Dropdown açılır → input.value=prefix + 'input' event → 1.5s bekler → ilk seçer.
  async function pickFirstOptionByPrefix(antSelectEl, prefix) {
    if (!antSelectEl || !prefix) return null;
    const dd = await openAntSelect(antSelectEl);
    if (!dd) {
      console.warn('[Moren.pickFirst] dropdown açılamadı', { prefix });
      return null;
    }

    // İlk olarak — dropdown'a dropdown render zamanı için kısa bekleme
    await sleep(250);

    const collect = () => {
      // hem .ant-select-item-option hem ...item kombinasyonu — Mihsap her ikisini de kullanabilir
      const items = Array.from(
        dd.querySelectorAll('.ant-select-item-option, .ant-select-item-option-content'),
      );
      // option-content de yakalanırsa parent'a normalize et
      return items
        .map((el) => {
          if (el.classList.contains('ant-select-item-option-content')) {
            return el.closest('.ant-select-item-option') || el;
          }
          return el;
        })
        // unique + visible
        .filter((el, i, arr) => arr.indexOf(el) === i && el.offsetParent !== null);
    };

    const findByPrefix = (items) => {
      const prefLower = prefix.toLowerCase().trim();
      return items.find((el) => (el.textContent || '').trim().toLowerCase().startsWith(prefLower)) || null;
    };

    let items = collect();
    let hit = findByPrefix(items);
    console.log('[Moren.pickFirst] dropdown açık, ilk taram:', { itemCount: items.length, prefix, found: !!hit });

    // Yoksa — search input'a prefix yaz (remote search varsa backend cevap vermeli)
    if (!hit) {
      const searchInput =
        antSelectEl.querySelector('input.ant-select-selection-search-input') ||
        antSelectEl.querySelector('input');
      if (searchInput) {
        try {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, prefix);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[Moren.pickFirst] search yazıldı:', prefix);
        } catch (e) {
          console.warn('[Moren.pickFirst] search yazma hatası', e);
        }
        const t0 = Date.now();
        while (Date.now() - t0 < 2000) {
          await sleep(100);
          items = collect();
          hit = findByPrefix(items);
          if (hit) break;
        }
      }
    }

    // Hala yoksa — virtualized scroll ile kaydırarak ara
    if (!hit) {
      const scroller = dd.querySelector('.rc-virtual-list-holder') || dd;
      for (let i = 0; i < 30; i++) {
        scroller.scrollTop += 200;
        await sleep(60);
        items = collect();
        hit = findByPrefix(items);
        if (hit) break;
      }
      // Hâlâ bulamadıysa scroll'u başa al ve İLK option'u seç (kullanıcı "en üstteki" demişti)
      if (!hit && items.length > 0) {
        scroller.scrollTop = 0;
        await sleep(80);
        items = collect();
        hit = items[0];
        console.log('[Moren.pickFirst] prefix bulunamadı, en üstteki seçildi:', (hit?.textContent || '').trim());
      }
    }

    if (!hit) {
      console.warn('[Moren.pickFirst] hiçbir option bulunamadı', { prefix, totalItems: items.length });
      await closeAllAntDropdowns();
      return null;
    }

    const text = (hit.textContent || '').trim();
    hit.scrollIntoView({ block: 'center' });
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    hit.click();
    await sleep(300);
    const ok = isAntSelectFilled(antSelectEl);
    console.log('[Moren.pickFirst] tıklandı, dolu mu:', { text, ok });
    return ok ? text : null;
  }

  async function pickFirstOptionByPrefixById(inputId, prefix) {
    const input = document.getElementById(inputId);
    if (!input) return null;
    const sel = input.closest('.ant-select');
    return await pickFirstOptionByPrefix(sel, prefix);
  }

  // v1.14.3 — Manuel kullanıcı davranışını taklit et:
  //  1. Dropdown aç (focus + click)
  //  2. Search input'a TAM metni yaz
  //  3. Mihsap remote-search backend cevap verene kadar bekle (1.5s)
  //  4. Enter tuşuna bas → açık dropdown'da match olan ilk option seçilir
  //  5. Seçim doğrulandıktan sonra select'in dolu metnini geri döner.
  async function typeAndEnter(antSelectEl, fullText) {
    if (!antSelectEl || !fullText) return null;
    try {
      await closeAllAntDropdowns();
      await sleep(150);
      antSelectEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(100);

      const selector = antSelectEl.querySelector('.ant-select-selector') || antSelectEl;
      const input =
        antSelectEl.querySelector('input.ant-select-selection-search-input') ||
        antSelectEl.querySelector('input');

      // Aç
      selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      selector.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      selector.click();
      if (input) try { input.focus(); } catch {}
      await sleep(250);

      // Yaz (native setter — React state ile uyumlu)
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, fullText);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[Moren.typeAndEnter] yazıldı:', fullText);
      } else {
        console.warn('[Moren.typeAndEnter] input bulunamadı');
        return null;
      }

      // Backend cevabını bekle
      await sleep(1500);

      // Enter tuşu — Ant Select açık dropdown'da ilk vurgu olan option'ı seçer
      const fireKey = (type, key, code, keyCode) => {
        const ev = new KeyboardEvent(type, {
          key, code, keyCode, which: keyCode, bubbles: true, cancelable: true,
        });
        input.dispatchEvent(ev);
      };
      fireKey('keydown', 'Enter', 'Enter', 13);
      fireKey('keypress', 'Enter', 'Enter', 13);
      fireKey('keyup', 'Enter', 'Enter', 13);
      console.log('[Moren.typeAndEnter] Enter gönderildi');
      await sleep(400);

      // Doğrulama: select dolu mu, içeriği fullText (veya benzeri) mi
      if (isAntSelectFilled(antSelectEl)) {
        const itemText =
          (antSelectEl.querySelector('.ant-select-selection-item')?.textContent || '').trim();
        console.log('[Moren.typeAndEnter] başarılı:', itemText);
        return itemText || fullText;
      }

      // Enter çalışmadıysa: dropdown'dan ilk option'ı manuel tıkla
      const dd = findDropdownForSelect(antSelectEl);
      if (dd) {
        const firstOpt = dd.querySelector('.ant-select-item-option');
        if (firstOpt) {
          firstOpt.scrollIntoView({ block: 'center' });
          firstOpt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          firstOpt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          firstOpt.click();
          await sleep(300);
          if (isAntSelectFilled(antSelectEl)) {
            const itemText =
              (antSelectEl.querySelector('.ant-select-selection-item')?.textContent || '').trim();
            console.log('[Moren.typeAndEnter] manuel tıklama başarılı:', itemText);
            return itemText || fullText;
          }
        }
      }

      console.warn('[Moren.typeAndEnter] başarısız — Enter ve manuel tıklama ikisi de boş');
      await closeAllAntDropdowns();
      return null;
    } catch (e) {
      console.warn('[Moren.typeAndEnter] hata:', e?.message);
      return null;
    }
  }

  // v1.12.2 — Mihsap remote-search select için: tam hesap kodu ("600.01.005") yaz,
  // backend cevabını bekle, kod ile başlayan ilk option'ı seç.
  // YENİ: detaylı log + tıklama öncesi tutar doğrulama + seçim sonrası
  // gerçekten DOĞRU satırın dolduğunu kontrol et (Mihsap ekstra satır eklerse fark eder).
  async function pickAntSelectByKodPrefix(antSelectEl, kod, debugTag = '') {
    if (!antSelectEl || !kod) return false;
    const tutarOnce = getRowTutarValue(antSelectEl);
    const inputId = antSelectEl.querySelector('input')?.id || '?';
    console.log(`[Moren.fill] ${debugTag} pick BAŞLA — kod=${kod} | hedef tutar=${tutarOnce} | inputId=${inputId}`);
    if (tutarOnce <= 0) {
      console.warn(`[Moren.fill] ${debugTag} hedef satırın tutarı tespit edilemedi (0) — yine de denenecek`);
    }
    try {
      await closeAllAntDropdowns();
      await sleep(300);

      // v1.13.5 — ÖNCE asıl satırın TUTAR input'una focus ver (Mihsap "buradayım" anlasın,
      // başka satıra "+ekle" satırı eklemesin). Manuel kullanıcı davranışına yakın.
      const sRect0 = antSelectEl.getBoundingClientRect();
      const sCenterY0 = sRect0.top + sRect0.height / 2;
      let p0 = antSelectEl;
      let tutarInp = null;
      for (let i = 0; i < 5 && p0; i++) {
        p0 = p0.parentElement;
        if (!p0) break;
        const inputs = [...p0.querySelectorAll('input')].filter((inp) => inp.offsetParent !== null);
        for (const inp of inputs) {
          if (antSelectEl.contains(inp)) continue; // hesap kodu input'u atla
          const r = inp.getBoundingClientRect();
          if (r.height === 0) continue;
          const dy = Math.abs((r.top + r.height / 2) - sCenterY0);
          if (dy < 30) { tutarInp = inp; break; }
        }
        if (tutarInp) break;
      }
      if (tutarInp) {
        try {
          tutarInp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          tutarInp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          tutarInp.click();
          tutarInp.focus();
          console.log(`[Moren.fill] ${debugTag} satır tutar input'una önce focus verildi (asıl satır işareti)`);
          await sleep(300);
          tutarInp.blur();
          await sleep(200);
        } catch {}
      }

      antSelectEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(200);
      const selector = antSelectEl.querySelector('.ant-select-selector') || antSelectEl;
      selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      selector.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      selector.click();
      const input = antSelectEl.querySelector('input.ant-select-selection-search-input') || antSelectEl.querySelector('input');
      if (!input) {
        console.warn(`[Moren.fill] ${debugTag} input bulunamadı`);
        await closeAllAntDropdowns();
        return false;
      }
      try { input.focus(); } catch {}
      await sleep(250);  // Mihsap için biraz daha uzun bekleme
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(120);

      // v1.13.5 — TAM KODU TEK SEFERDE YAZ (kademeli yazma değil — Mihsap "600" yazınca
      // tek sonuç varsa hemen seçim deniyordu). Doğrudan tam kodu yaz, 3sn bekle.
      nativeSetter.call(input, kod);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[Moren.fill] ${debugTag} tam kod "${kod}" yazıldı, dropdown bekleniyor (3s)...`);
      await sleep(3000);
      const dd = findDropdownForSelect(antSelectEl);
      if (!dd) {
        console.warn(`[Moren.fill] ${debugTag} dropdown render edilmedi, kod:`, kod);
        await closeAllAntDropdowns();
        return false;
      }
      const items = Array.from(dd.querySelectorAll('.ant-select-item-option'));
      console.log(`[Moren.fill] ${debugTag} dropdown'da ${items.length} option:`, items.map(i => (i.textContent || '').trim()).slice(0, 5));
      // Hangi option'ın seçileceğini bul (sıra: tam eşleşme → kod ile başlayan → tek option)
      let hitIdx = items.findIndex((el) => {
        const txt = (el.textContent || '').trim();
        return txt === kod
          || txt.startsWith(kod + '-')
          || txt.startsWith(kod + ' ')
          || txt.startsWith(kod + '\t');
      });
      if (hitIdx < 0) hitIdx = items.findIndex((el) => (el.textContent || '').trim().startsWith(kod));
      if (hitIdx < 0 && items.length === 1) hitIdx = 0;
      if (hitIdx < 0) {
        console.warn(`[Moren.fill] ${debugTag} kod eşleşmedi`);
        await closeAllAntDropdowns();
        return false;
      }
      const hit = items[hitIdx];
      console.log(`[Moren.fill] ${debugTag} seçilecek (idx=${hitIdx}): "${hit.textContent.trim()}"`);

      // v1.12.4 — Mihsap, fare click ile seçimi yanlış satıra atıyor.
      // KLAVYE ile seç: ArrowDown ile highlight, Enter ile seç. Focus orijinal input'ta kalır,
      // dolayısıyla seçim DOĞRU satıra gider (Mihsap "+ekle" satırına atayamaz).
      const fireKey = (key, code, keyCode) => {
        const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
        input.dispatchEvent(new KeyboardEvent('keydown', init));
        input.dispatchEvent(new KeyboardEvent('keypress', init));
        input.dispatchEvent(new KeyboardEvent('keyup', init));
      };
      // İstenen option'a kadar ArrowDown bas (hitIdx kadar)
      // İlk ArrowDown highlight'ı 1. option'a koyar, sonraki her biri bir aşağı.
      for (let i = 0; i <= hitIdx; i++) {
        fireKey('ArrowDown', 'ArrowDown', 40);
        await sleep(60);
      }
      // Enter ile seç
      fireKey('Enter', 'Enter', 13);
      await sleep(500);

      // Doğrulama: hedef select gerçekten doldu mu? (Mihsap başka satıra atamadı mı?)
      const targetFilled = isAntSelectFilled(antSelectEl);
      const targetItem = antSelectEl.querySelector('.ant-select-selection-item')?.textContent?.trim() || '';
      const tutarSonra = getRowTutarValue(antSelectEl);
      console.log(`[Moren.fill] ${debugTag} ENTER SONRASI — hedef dolu?=${targetFilled} item="${targetItem}" tutar=${tutarSonra}`);
      if (!targetFilled || !targetItem.startsWith(kod)) {
        console.warn(`[Moren.fill] ${debugTag} HEDEF DOLMADI — Mihsap başka satıra atamış olabilir`);
        // Fallback: belki Mihsap başka satıra atadı, dropdown'ı kapat ve abort
        await closeAllAntDropdowns();
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`[Moren.fill] ${debugTag} pickAntSelectByKodPrefix hata:`, e?.message);
      await closeAllAntDropdowns();
      return false;
    }
  }

  // === İşletme Defteri: Üst alan durumu oku (Fatura Türü / Belge Türü / Alış-Satış Türü / İşlem Türü) ===
  function isletmeUstAlanDurumu() {
    const read = (id) => getAntSelectValueById(id);
    // İşlem Türü ID'si: defterData_islemTuru tahmin (yoksa label ile bul)
    let islemTuru = read('defterData_islemTuru');
    if (!islemTuru) {
      // Label'dan bul
      const sel = findSelectByLabel('İşlem Türü');
      if (sel) islemTuru = (sel.querySelector('.ant-select-selection-item')?.textContent || '').trim();
    }
    if (islemTuru && /seçiniz/i.test(islemTuru)) islemTuru = '';
    return {
      faturaTuru: read('faturaTuru'),
      belgeTuru: read('defterData_belgeTuru'),
      alisSatisTuru: read('defterData_alisSatisTuru'),
      islemTuru,
    };
  }

  // v1.13.8 — Label metnine göre Ant Select bul (ör "İşlem Türü")
  function findSelectByLabel(labelText) {
    const re = new RegExp(`^\\s*${labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const labels = [...document.querySelectorAll('label, div, span, td, th')].filter((el) => {
      if (el.offsetParent === null) return false;
      const t = (el.textContent || '').trim();
      return t.length < 30 && re.test(t);
    });
    for (const lbl of labels) {
      let c = lbl.parentElement;
      for (let i = 0; i < 4 && c; i++) {
        const sel = c.querySelector('.ant-select');
        if (sel && sel.offsetParent !== null) return sel;
        c = c.parentElement;
      }
    }
    return null;
  }

  function shouldUseAccountCodeFlowForIsletme() {
    // İşletme defteri fatura akışı Kayıt Türü / K. Alt Türü mantığıyla çalışır.
    // 153/191 gibi hesap kodu doldurma bilanço defteri içindir; işletmede yanlış dala düşürür.
    return false;
  }

  async function aiDecideIsletme({ kayitOptions, altOptions, tarih, belgeNo, belgeTuru, faturaTuru, mukellef, mukellefId, firma, firmaKimlikNo, tutar, matrah, kdv, action, blokIndex, blokToplam }) {
    const fid = getCurrentFid();
    let img = null;
    if (window.__morenFaturaImageCache?.fid === fid && window.__morenFaturaImageCache?.img) {
      img = window.__morenFaturaImageCache.img;
    } else {
      img = await getFaturaImageBase64();
      if (img) window.__morenFaturaImageCache = { fid, img, ts: Date.now() };
    }
    if (!img) return { emin: false, sebep: 'fatura görüntüsü alınamadı' };
    const faturaText = getFaturaTextSnapshotCached(12000);
    return await api('/agent/ai/decide-isletme', {
      method: 'POST',
      body: JSON.stringify({
        faturaImageBase64: img,
        ...(faturaText ? { faturaText } : {}),
        kayitTuruOptions: kayitOptions,
        altTuruOptions: altOptions,
        faturaTarihi: tarih,
        belgeNo, belgeTuru, faturaTuru,
        mukellef, mukellefId, firma,
        firmaKimlikNo, // Firma Hafizasi icin VKN/TCKN
        tutar, matrah, kdv,
        action, blokIndex, blokToplam,
      }),
    });
  }

  // v1.36.21: Pause/Resume kontrolü — portaldan set edilen state'i her mükellef
  // arasında kontrol et. PAUSED ise resume olana kadar bekle (5sn polling).
  function parseAmountLoose(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[^\d,.-]/g, '');
    if (!s) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseDateToIso(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return null;
  }

  function normDocNo(v) {
    return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function docNoMatches(aiNo, mihsapNo) {
    const a = normDocNo(aiNo);
    const b = normDocNo(mihsapNo);
    if (!a || !b) return true;
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 8) return false;
    return a.endsWith(b) || b.endsWith(a);
  }

  function belgeTuruMatches(aiBelgeTuru, mihsapBelgeTuru) {
    const ai = String(aiBelgeTuru || '').toUpperCase();
    const m = String(mihsapBelgeTuru || '').toLowerCase();
    if (!ai || !m) return true;
    if (ai.includes('E_FATURA')) return /e[_\s-]?fatura/.test(m);
    if (ai.includes('E_ARSIV') || ai.includes('E_ARŞIV')) return /e[_\s-]?ar[sş]iv/.test(m);
    if (ai.includes('FIS') || ai.includes('FIŞ')) return /fi[sş]|fis/.test(m);
    return true;
  }

  function compareIsletmeOcrFields(karar, meta, ust) {
    const sorunlar = [];
    const aiTarih = parseDateToIso(karar?.tarih);
    const mihsapTarih = parseDateToIso(meta?.tarih);
    if (aiTarih && mihsapTarih && aiTarih !== mihsapTarih) {
      sorunlar.push(`tarih belge:${aiTarih} mihsap:${mihsapTarih}`);
    }
    if (karar?.belgeNo && meta?.belgeNo && !docNoMatches(karar.belgeNo, meta.belgeNo)) {
      sorunlar.push(`belgeNo belge:${karar.belgeNo} mihsap:${meta.belgeNo}`);
    }
    if (karar?.belgeTuru && ust?.belgeTuru && !belgeTuruMatches(karar.belgeTuru, ust.belgeTuru)) {
      sorunlar.push(`belgeTuru belge:${karar.belgeTuru} mihsap:${ust.belgeTuru}`);
    }
    const belgeToplam = parseAmountLoose(karar?.ocrToplam);
    const mihsapToplam = parseAmountLoose(meta?.tutar);
    if (belgeToplam != null && mihsapToplam != null && Math.abs(belgeToplam - mihsapToplam) > 1) {
      sorunlar.push(`toplam belge:${belgeToplam.toFixed(2)} mihsap:${mihsapToplam.toFixed(2)}`);
    }
    return {
      ok: sorunlar.length === 0,
      sorunlar,
      belgeToplam,
      belgeMatrah: parseAmountLoose(karar?.ocrMatrah),
      belgeKdvTutari: parseAmountLoose(karar?.ocrKdvTutari),
    };
  }

  function getDecisionBelgeValue(decision, key) {
    if (!decision) return null;
    const traceBelge = decision.decisionTrace?.belge || {};
    return decision[key] ?? traceBelge[key] ?? null;
  }

  function compareFaturaDecisionFields(decision, meta) {
    const sorunlar = [];
    const aiTarihRaw = getDecisionBelgeValue(decision, 'tarih');
    const aiBelgeNo = getDecisionBelgeValue(decision, 'belgeNo');
    const aiBelgeTuru = getDecisionBelgeValue(decision, 'belgeTuru');
    const aiTarih = parseDateToIso(aiTarihRaw);
    const mihsapTarih = parseDateToIso(meta?.tarih);
    if (meta?.tarih && !aiTarih) sorunlar.push('tarih okunamadı');
    if (aiTarih && mihsapTarih && aiTarih !== mihsapTarih) {
      sorunlar.push(`tarih belge:${aiTarih} mihsap:${mihsapTarih}`);
    }
    if (meta?.belgeNo && !normDocNo(aiBelgeNo)) sorunlar.push('belge no okunamadı');
    if (aiBelgeNo && meta?.belgeNo && !docNoMatches(aiBelgeNo, meta.belgeNo)) {
      sorunlar.push(`belgeNo belge:${aiBelgeNo} mihsap:${meta.belgeNo}`);
    }
    if (meta?.belgeTuru && !aiBelgeTuru) sorunlar.push('belge türü okunamadı');
    if (aiBelgeTuru && meta?.belgeTuru && !belgeTuruMatches(aiBelgeTuru, meta.belgeTuru)) {
      sorunlar.push(`belgeTuru belge:${aiBelgeTuru} mihsap:${meta.belgeTuru}`);
    }
    const belgeToplam = parseAmountLoose(getDecisionBelgeValue(decision, 'ocrToplam'));
    const belgeMatrah = parseAmountLoose(getDecisionBelgeValue(decision, 'ocrMatrah'));
    const belgeKdvTutari = parseAmountLoose(getDecisionBelgeValue(decision, 'ocrKdvTutari'));
    const mihsapToplam = parseAmountLoose(meta?.tutar);
    if (mihsapToplam != null && belgeToplam == null) sorunlar.push('tutar okunamadı');
    if (belgeToplam != null && mihsapToplam != null && Math.abs(belgeToplam - mihsapToplam) > 1) {
      sorunlar.push(`toplam belge:${belgeToplam.toFixed(2)} mihsap:${mihsapToplam.toFixed(2)}`);
    }
    return {
      ok: sorunlar.length === 0,
      sorunlar,
      belgeToplam,
      belgeMatrah,
      belgeKdvTutari,
      mihsapToplam,
      belgeTarih: aiTarih || null,
      mihsapTarih: mihsapTarih || null,
      belgeNo: aiBelgeNo || null,
      belgeTuru: aiBelgeTuru || null,
    };
  }

  function checkFaturaKdvCodeMatch(codes, kdvOranlari) {
    const tutarsizSatirlar = [];
    const minLen = Math.min((codes || []).length, (kdvOranlari || []).length);
    for (let i = 0; i < minLen; i++) {
      const koduFull = codes[i] || '';
      const pctMatch = koduFull.match(/-?%(\d{1,2})\b/);
      if (!pctMatch) continue;
      const fatKdvStr = (kdvOranlari[i] || '').replace(/^%/, '').trim();
      if (!fatKdvStr) continue;
      const koduPct = String(parseInt(pctMatch[1], 10));
      const fatPct = String(parseInt(fatKdvStr, 10));
      if (koduPct !== fatPct) {
        tutarsizSatirlar.push(`${i + 1}. satır: hesap %${koduPct} ama fatura %${fatPct}`);
      }
    }
    return {
      ok: tutarsizSatirlar.length === 0,
      sebep: tutarsizSatirlar.join(' | '),
      tutarsizSatirlar,
    };
  }

  function faturaProviderErrorMessage(decision) {
    const sebep = String(decision?.sebep || '');
    const fallback = String(decision?.fallbackReason || decision?.providerErrorCode || '');
    if (
      decision?.providerError ||
      /^Claude API/i.test(sebep) ||
      /^Network:/i.test(sebep) ||
      /^claude_/i.test(fallback)
    ) {
      if (/billing|quota|credit|kredi|kota/i.test(`${sebep} ${fallback}`)) {
        return 'AI servis kredi/kota hatasi: Claude bakiyesi veya limiti yetersiz';
      }
      if (/rate/i.test(`${sebep} ${fallback}`)) {
        return 'AI servis yogunluk/rate limit hatasi: biraz sonra tekrar deneyin';
      }
      return `AI servis hatasi: ${sebep || fallback || 'karar alinamadi'}`;
    }
    return null;
  }

  function normalizeRuleText(value) {
    return String(value || '')
      .slice(0, 24000)
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/[^a-z0-9%.,\s/-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseRuleMoney(value) {
    if (typeof value === 'number') return value;
    const raw = String(value || '').replace(/[^\d,.-]/g, '').trim();
    if (!raw) return NaN;
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma > dot) return Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number(raw.replace(/,/g, ''));
  }

  function extractAccountCode(value) {
    return String(value || '').match(/\b\d{3}(?:\.\d{1,3}){1,4}\b/)?.[0] || '';
  }

  function detectVehiclePurchaseRisk({ firma, tutar, codes, text, decision }) {
    const invoiceText = normalizeRuleText([
      text,
      decision?.ocrOzet,
      decision?.sebep,
      decision?.icerikSinifi,
    ].filter(Boolean).join('\n'));
    const sellerText = normalizeRuleText(firma);
    const sellerOrText = `${sellerText} ${invoiceText}`;
    const amount = parseRuleMoney(tutar);
    const primaryAccount = (codes || []).find((c) => {
      const code = extractAccountCode(c);
      return code && !/^(191|391|120|320|100|101|102|103|108|121|321|309|329|331|335|336)\./.test(code);
    }) || (codes || [])[0] || '';
    const account = extractAccountCode(primaryAccount);
    const strongVehicle = [
      /sasi\s*(no|numara|numarasi)?/,
      /sase\s*(no|numara|numarasi)?/,
      /motor\s*(no|numara|numarasi)/,
      /model\s*yili/,
      /otv\s+matrah/,
      /hesaplanan\s+otv/,
      /gumruk\s+(beyanname|makbuz|idare)/,
      /sap\s+fatura/,
      /tescil|ruhsat/,
      /arac\s+(satis|alim|teslim|bedel)/,
      /tasit\s+(satis|alim|teslim|bedel)/,
      /binek\s+oto|otomobil|kamyonet|minibus|motosiklet|traktor/,
      /\b(peugeot|rifter|bluehdi|hdi|renault|toyota|hyundai|volkswagen|mercedes|bmw|audi|fiat|citroen|opel|nissan)\b/,
    ].some((re) => re.test(invoiceText));
    const automotiveSeller = /otomotiv|motorlu|oto\s|cetas|peugeot|renault|toyota|hyundai|volkswagen|honda|mercedes|bmw|audi|fiat|citroen|opel|nissan|ford/.test(sellerOrText);
    const suspiciousExpenseAccount = !account || /^(740|760|770|150|153|157)\./.test(account);
    if (strongVehicle) {
      return 'Tasit/otomobil alimi sinyali var; amortisman kontrolu olmadan otomatik F2 iptal';
    }
    if (automotiveSeller && Number.isFinite(amount) && amount >= 200000 && suspiciousExpenseAccount) {
      return `Otomotiv tedarikcisi + yuksek tutar; ${account || 'hesap kodu yok'} ile otomatik gider yazilamaz`;
    }
    return null;
  }

  function needsFreshFaturaRetry(safety, decision) {
    if (!safety || safety.ok) return false;
    if (faturaProviderErrorMessage(decision)) return false;
    const reason = String(safety.sebep || '');
    return !!decision?.cacheHit || decision?.aiCallReason === 'cache_hit' || /okunamad[ıi]/i.test(reason);
  }

  async function freshFaturaDecisionRetry({ safety, decision, decideArgs, meta, codes, kdvOranlari }) {
    if (!needsFreshFaturaRetry(safety, decision)) return null;
    const retryDecision = await aiDecideTimed(
      { ...decideArgs, forceFresh: true },
      6500,
      'taze karar zaman asimi - manuel kontrol',
    );
    const retrySafety = finalSafetyCheckFatura({
      decision: retryDecision,
      meta,
      codes,
      kdvOranlari,
    });
    return { decision: retryDecision, safety: retrySafety };
  }

  function finalSafetyCheckFatura({ decision, meta, codes, kdvOranlari }) {
    const karar = decision?.karar || decision?.decisionTrace?.karar?.sonuc || 'emin_degil';
    const cmp = compareFaturaDecisionFields(decision, meta);
    const providerError = faturaProviderErrorMessage(decision);
    const sorunlar = providerError ? [providerError] : [...cmp.sorunlar];
    if (karar !== 'onay' && !providerError) {
      const kararTr = karar === 'emin_degil' ? 'emin değil'
        : karar === 'atla' ? 'atlanması önerildi'
        : karar === 'onay_bekliyor' ? 'onay bekliyor'
        : karar;
      sorunlar.unshift(`yapay zeka onay vermedi (${kararTr})`);
    }
    const vehicleRisk = detectVehiclePurchaseRisk({
      firma: meta?.firma,
      tutar: meta?.tutar,
      codes: codes || [],
      text: readFreeFaturaTextSnapshot(),
      decision,
    });
    if (vehicleRisk) sorunlar.push(vehicleRisk);
    const kdvCheck = checkFaturaKdvCodeMatch(codes || [], kdvOranlari || []);
    if (!kdvCheck.ok) sorunlar.push(`KDV oranı uyuşmuyor: ${kdvCheck.sebep}`);
    return {
      ok: sorunlar.length === 0,
      sebep: sorunlar.join(' | '),
      karar,
      compareMeta: {
        belgeToplam: cmp.belgeToplam,
        belgeMatrah: cmp.belgeMatrah,
        belgeKdvTutari: cmp.belgeKdvTutari,
        mihsapToplam: cmp.mihsapToplam,
        belgeTarih: cmp.belgeTarih,
        mihsapTarih: cmp.mihsapTarih,
        belgeNo: cmp.belgeNo,
        belgeTuru: cmp.belgeTuru,
        providerErrorCode: decision?.providerErrorCode || null,
        fallbackReason: decision?.fallbackReason || null,
        kdvOranlari,
        kdvTutarsizSatirlar: kdvCheck.tutarsizSatirlar,
      },
    };
  }

  async function validateIsletmeBeforeF2({ blok, meta, ust, mukellef, action }) {
    const tumAltOptions = [];
    for (const vals of Object.values(ISLETME_KAYIT_ALT_MAP)) {
      for (const v of vals) if (!tumAltOptions.includes(v)) tumAltOptions.push(v);
    }
    if (!blok.detay?.length) return { ok: false, sebep: 'blok yok' };
    const ozet = [];
    for (let bi = 0; bi < blok.detay.length; bi++) {
      const d = blok.detay[bi];
      const karar = await aiDecideIsletme({
        kayitOptions: ISLETME_KAYIT_TURU_LIST_ALIS,
        altOptions: tumAltOptions,
        tarih: meta.tarih,
        belgeNo: meta.belgeNo,
        belgeTuru: ust.belgeTuru,
        faturaTuru: ust.faturaTuru,
        mukellef: mukellef.ad,
        mukellefId: mukellef.id,
        firma: meta.firma,
        firmaKimlikNo: meta.firmaKimlikNo,
        tutar: meta.tutar,
        matrah: d.matrah,
        kdv: d.kdv,
        action,
        blokIndex: bi + 1,
        blokToplam: blok.detay.length,
      });
      const tag = `B${bi + 1}`;
      if (karar?.karar === 'onay_bekliyor') {
        return { ok: false, sebep: `${tag} onay kuyrugu: ${(karar.sapmaSebep || karar.sebep || '').slice(0, 120)}` };
      }
      if (!karar?.emin || !karar.kayitTuru || !karar.altTuru) {
        return { ok: false, sebep: `${tag} OCR/AI emin degil: ${(karar?.sebep || '').slice(0, 120)}` };
      }
      if (d.kayitDeger && karar.kayitTuru && d.kayitDeger !== karar.kayitTuru) {
        return { ok: false, sebep: `${tag} kayit turu uyusmaz: belge:${karar.kayitTuru} mihsap:${d.kayitDeger}` };
      }
      if (d.altDeger && karar.altTuru && d.altDeger !== karar.altTuru) {
        return { ok: false, sebep: `${tag} k.alt turu uyusmaz: belge:${karar.altTuru} mihsap:${d.altDeger}` };
      }
      const cmp = compareIsletmeOcrFields(karar, meta, ust);
      if (!cmp.ok) return { ok: false, sebep: `${tag} belge-Mihsap uyusmaz: ${cmp.sorunlar.join(' | ')}`, cmp };
      ozet.push(`${tag}:${karar.kayitTuru}/${karar.altTuru} OCR toplam:${cmp.belgeToplam ?? '-'} matrah:${cmp.belgeMatrah ?? '-'} kdv:${cmp.belgeKdvTutari ?? '-'}`);
    }
    return { ok: true, sebep: ozet.join(' · ') };
  }

  async function checkPauseAndWait() {
    while (true) {
      try {
        const r = await fetch(API + '/agent/control/state/agent-read?agent=mihsap', {
          headers: { 'X-Agent-Token': TOKEN },
        });
        if (r.ok) {
          const j = await r.json();
          const state = j?.controlState || 'RUNNING';
          if (state === 'STOP') {
            window.__morenAgent.stopRequested = true;
            return;
          }
          if (state === 'PAUSED') {
            setStatus('⏸ Duraklatıldı (portaldan)');
            await sleep(5000);
            continue; // tekrar kontrol et
          }
        }
      } catch {}
      return; // RUNNING — devam et
    }
  }

  async function processBatch({ ay, mukellefler, action }) {
    setStatus(`${mukellefler.length} mükellef / ${ay} · ${action}`);
    // v1.14.1 — logEvent içinde global olarak okunsun (her event'e action eklensin)
    if (window.__morenAgent) window.__morenAgent.currentAction = action;
    // v1.36.4 — donem bilgisini de logEvent'e otomatik ek (tarih fallback için)
    if (window.__morenAgent) window.__morenAgent.currentDonem = ay || null;
    for (const m of mukellefler) {
      if (window.__morenAgent.stopRequested) { setStatus('Durduruldu'); return; }
      // v1.36.21: Pause kontrolü
      await checkPauseAndWait();
      if (window.__morenAgent.stopRequested) { setStatus('Durduruldu'); return; }
      setStatus(`→ ${m.ad}`);
      await processMukellef({ ay, mukellef: m, action });
    }
    await flushAgentEventQueue();
    setStatus(`Tamamlandı · ${counters.toplam} fatura`);
    if (window.__morenAgent) window.__morenAgent.currentAction = null;
    if (window.__morenAgent) window.__morenAgent.currentDonem = null;
  }

  async function processMukellef({ ay, mukellef, action }) {
    // Bilanço: BILANCO/1 alış, BILANCO/2 satış
    // İşletme Defteri: ISLETME/1 alış, ISLETME/2 satış
    const tipSegment =
      action === 'isle_alis' ? 'BILANCO/1' :
      action === 'isle_satis' ? 'BILANCO/2' :
      action === 'isle_alis_isletme' ? 'ISLETME/1' :
      action === 'isle_satis_isletme' ? 'ISLETME/2' :
      null;
    if (!tipSegment || !mukellef.mihsapId) return;
    const targetPath = `/documents/${tipSegment}/${mukellef.mihsapId}`;
    const baseList = `https://app.mihsap.com${targetPath}`;
    // URL uygun değilse otomatik navigasyonu dene, başarısızsa kullanıcıdan bekle.
    // SPA-uyumlu: history.pushState + popstate → Mihsap React Router tepki verir, script ölmez.
    // Kullanıcı eski davranışı tercih ederse: console'dan __morenAgent.autoNavigate = false
    const waitT0 = Date.now();
    let autoNavDenemesi = 0;
    while (!location.pathname.startsWith(targetPath)) {
      if (window.__morenAgent.stopRequested) return;
      if (Date.now() - waitT0 > 180000) { setStatus('URL beklendi, zaman aşımı'); return; }

      // Otomatik navigasyon — varsayılan açık, __morenAgent.autoNavigate=false ile kapatılır.
      // Maksimum 3 deneme — SPA yanıt vermiyorsa manuel beklemeye düş.
      const autoNavAcik = window.__morenAgent?.autoNavigate !== false;
      if (autoNavAcik && autoNavDenemesi < 3) {
        autoNavDenemesi++;
        try {
          setStatus(`→ ${mukellef.ad} sayfasına geçiliyor (otomatik ${autoNavDenemesi}/3)…`);
          history.pushState({}, '', targetPath);
          window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          // Akıllı bekleme: liste tablosu render olunca hemen devam (tavan 1800ms, eskisiyle aynı).
          await waitUntil(() => !!document.querySelector('tbody tr button .anticon-edit'), 1800, 150);
          if (location.pathname.startsWith(targetPath)) {
            console.log(`[Moren] auto-nav başarılı: ${targetPath}`);
            break;
          }
        } catch (e) {
          console.warn('[Moren] auto-nav hata:', e?.message);
        }
      }

      setStatus(`→ ${mukellef.ad} için bu sayfayı açın`);
      await sleep(2000);
    }
    // Liste sayfasında ise ilk faturayı aç
    if (location.pathname === targetPath) {
      const firstPen = await waitFor('tbody tr button .anticon-edit', 8000);
      if (!firstPen) { setStatus('Fatura yok'); return; }
      await click(firstPen.closest('button'));
      // Akıllı bekleme: fatura URL'i (fid) oluşunca hemen devam (tavan 1200ms).
      await waitUntil(() => /\/\d+\?count=/.test(location.href), 1200, 120);
    }

    const seenFids = new Set();
    let initialCount = null;
    for (let i = 0; i < 600; i++) {
      if (window.__morenAgent.stopRequested) return;
      // v1.36.21: Her fatura öncesi pause kontrolü
      if (typeof checkPauseAndWait === 'function') await checkPauseAndWait();
      if (window.__morenAgent.stopRequested) return;
      const fidMatch = location.href.match(/\/(\d+)\?count=/);
      const count = parseInt(location.href.match(/count=(-?\d+)/)?.[1] || '1', 10);
      const fid = fidMatch?.[1];
      if (initialCount === null && count > 0) initialCount = count;
      if (count === 0 || count === -1) { setStatus('count=0 bitti'); return; }
      if (!fid) {
        // Liste sayfasına dönülmüş olabilir — tekrar ilk pen'e tıkla
        if (location.pathname === targetPath) {
          setStatus('Liste sayfası, sonraki faturaya geçiliyor');
          const pen = await waitFor('tbody tr button .anticon-edit', 5000);
          if (!pen) { setStatus('Fatura kalmadı'); return; }
          await click(pen.closest('button'));
          // Akıllı bekleme: fatura URL'i (fid) oluşunca hemen devam (tavan 1500ms).
          await waitUntil(() => /\/\d+\?count=/.test(location.href), 1500, 120);
          continue;
        }
        setStatus('fid yok, beklenmedik sayfa');
        return;
      }
      if (seenFids.has(fid)) {
        setStatus(`Fatura #${fid} zaten görüldü — döngü koruması, durduruldu`);
        return;
      }
      seenFids.add(fid);
      const perf = createPerfTracker();
      await waitForFaturaEditorReady(fid, 3500);
      perf.mark('editorReady');
      if (initialCount && seenFids.size > initialCount + 5) {
        setStatus(`Başlangıç (${initialCount}) aşıldı, durduruldu`);
        return;
      }

      const meta = await getFaturaMeta(fid, { domDateFallbackMs: 1000 });
      perf.mark('meta');
      const logMeta = (extra = {}) => ({
        firma: meta.firma,
        firmaKimlikNo: meta.firmaKimlikNo,
        belgeNo: meta.belgeNo,
        belgeTuru: meta.belgeTuru,
        faturaTuru: meta.faturaTuru,
        tutar: meta.tutar,
        perf: perf.snapshot(),
        ...extra,
      });
      const tarih = meta.tarih;
      const hedefAy = ay; // "2026-03"
      const ayUygun = tarih && String(tarih).startsWith(hedefAy);
      if (!ayUygun) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `tarih ${tarih} ≠ ${hedefAy}`, logMeta());
        await clickIleri(fid); continue;
      }

      // ==========================================================
      // İŞLETME DEFTERİ DALI (ISLETME/1 · ISLETME/2)
      // 1) Üst 3 alan: Fatura Türü / Belge Türü / Alış-Satış Türü
      // 2) Blok kontrolü: Kayıt Türü + K. Alt Türü + Matrah + KDV
      // 3) Dolu blok doğrulama (bilanço gibi 6-kural)
      // 4) Boş bloklar AI ile doldurulur
      // ==========================================================
      const isIsletme = (action === 'isle_alis_isletme' || action === 'isle_satis_isletme');
      const isletmeAccountCodeFlow = isIsletme && shouldUseAccountCodeFlowForIsletme();
      if (isIsletme && !isletmeAccountCodeFlow) {
        // Tüm loglara tarih/firma/belge no ekleyen kısayol
        const mTag = `${meta.tarih || '?'} · ${(meta.firma || '?').slice(0, 30)} · #${meta.belgeNo || '?'} · ${meta.tutar || '?'}`;

        // --- 1) ÜST 3 ALAN: Fatura Türü / Belge Türü / Alış-Satış Türü ---
        const isAlis = action === 'isle_alis_isletme';
        const ust = isletmeUstAlanDurumu();
        let ustAiKullanildi = false;
        let ustOzet = [];

        // Fatura Türü: deterministik — Alış→Gider, Satış→Gelir
        const beklenenFaturaTuru = isAlis ? 'Gider' : 'Gelir';
        if (!ust.faturaTuru) {
          const ok = await pickAntSelectById('faturaTuru', beklenenFaturaTuru);
          if (!ok) {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Fatura Türü seçilemedi: ${beklenenFaturaTuru}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
            await clickIleri(fid); continue;
          }
          ustOzet.push(`FatT:${beklenenFaturaTuru}`);
          ust.faturaTuru = beklenenFaturaTuru;
        } else if (ust.faturaTuru !== beklenenFaturaTuru) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Fatura Türü hatalı: ${ust.faturaTuru} ≠ ${beklenenFaturaTuru}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
          await clickIleri(fid); continue;
        }

        // Belge Türü: boşsa AI ile karar ver
        if (!ust.belgeTuru) {
          let secilenBelge = await pickBelgeTuruIsletme(meta, null);
          if (!secilenBelge) {
            ustAiKullanildi = true;
            setStatus(`${mukellef.ad} · #${fid} Belge Türü AI…`);
            const kararBelge = await aiDecideIsletme({
              kayitOptions: ISLETME_BELGE_TURU_LIST,
              altOptions: [],
              tarih: meta.tarih, belgeNo: meta.belgeNo, belgeTuru: '', faturaTuru: ust.faturaTuru,
              mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma,
              firmaKimlikNo: meta.firmaKimlikNo,
              tutar: meta.tutar,
              action, blokIndex: 0, blokToplam: 0,
            });
            if (kararBelge?.emin && kararBelge.kayitTuru) {
              secilenBelge = await pickBelgeTuruIsletme(meta, kararBelge.kayitTuru);
            }
          }
          if (secilenBelge) {
            ust.belgeTuru = secilenBelge;
            ustOzet.push(`BT:${secilenBelge}`);
          }
          if (!ust.belgeTuru) {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Belge Türü AI karar veremedi`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
            await clickIleri(fid); continue;
          }
        }

        // Alış/Satış Türü: boşsa AI ile karar ver
        if (!ust.alisSatisTuru) {
          const astOpts = isAlis ? ISLETME_ALIS_SATIS_TURU_ALIS : ISLETME_ALIS_SATIS_TURU_SATIS;
          // Çoğu fatura "Normal Alım" / "Normal Satış" — kısa yol
          const varsayilan = isAlis ? 'Normal Alım' : 'Normal Satış';
          const ok = await pickAntSelectById('defterData_alisSatisTuru', varsayilan);
          if (ok) {
            ust.alisSatisTuru = varsayilan;
            ustOzet.push(`AST:${varsayilan}`);
          } else {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Alış/Satış Türü seçilemedi: ${varsayilan}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
            await clickIleri(fid); continue;
          }
        }

        // --- İŞLEM TÜRÜ (yalnızca SATIŞ + Normal Satış için) ---
        // v1.14.3: Tam metin yaz + Enter tuşu ile direkt seç.
        // Mihsap dropdown'da seçenek görünüyor ama tıklayamayan koddan dolayı
        // önceki sürümde takılıyordu. Bu yöntem manuel kullanım gibi davranır.
        if (!isAlis && /Normal Satış/i.test(ust.alisSatisTuru || '') && !ust.islemTuru) {
          const islemSel = document.getElementById('defterData_islemTuru')?.closest('.ant-select')
            || findSelectByLabel('İşlem Türü');
          let secilen = null;
          if (islemSel) {
            secilen = await typeAndEnter(islemSel, 'Yurtiçi Teslim ve Hizmetleri');
          }
          if (secilen) {
            ust.islemTuru = secilen;
            ustOzet.push(`İT:${secilen}`);
          } else {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip',
              `${mTag} · İşlem Türü seçilemedi (Yurtiçi Teslim ve Hizmetleri yazıldı, Enter tıklamadı)`,
              { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih });
            await clickIleri(fid); continue;
          }
        }

        // --- 2) BLOK KONTROLÜ ---
        let blok = isletmeBlokDurumu();
        if (!blok.varMi) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · İşletme: blok bulunamadı`, {
            firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar,
          });
          await clickIleri(fid); continue;
        }

        // --- 3) DOLU BLOK DOĞRULAMA (bilanço benzeri) ---
        // Doğrulama YAPILIR — Mihsap otomatik doldursa bile hatalı olabilir.
        // Bilinmeyen Kayıt Türü/Alt Türü gelirse atla, kullanıcı manuel kontrol etsin.
        let doluKontrolHata = null;
        for (let bi = 0; bi < blok.detay.length; bi++) {
          const d = blok.detay[bi];
          if (d.kayitDolu && d.altDolu) {
            if (!ISLETME_KAYIT_ALT_MAP[d.kayitDeger]) {
              doluKontrolHata = `B${bi + 1} bilinmeyen Kayıt Türü: ${d.kayitDeger}`;
              break;
            }
            const gecerliAltlar = ISLETME_KAYIT_ALT_MAP[d.kayitDeger] || [];
            if (gecerliAltlar.length > 0 && !gecerliAltlar.includes(d.altDeger)) {
              doluKontrolHata = `B${bi + 1} K.Alt Türü eşleşmez: ${d.altDeger} ∉ ${d.kayitDeger}`;
              break;
            }
          }
        }
        if (doluKontrolHata) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Doğrulama: ${doluKontrolHata}`, {
            firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih,
          });
          await clickIleri(fid); continue;
        }

        // --- 4) BOŞ BLOKLARI AI İLE DOLDUR ---
        let aiKullanildi = ustAiKullanildi;
        let aiOzet = [...ustOzet];
        if (blok.bosBlokVar) {
          aiKullanildi = true;
          let aiHata = null;
          setStatus(`${mukellef.ad} · #${fid} İşletme · AI dolduruyor…`);

          // Tüm alt türleri birleştir — tek seferde AI'ya gönder
          const tumAltOptions = [];
          for (const vals of Object.values(ISLETME_KAYIT_ALT_MAP)) {
            for (const v of vals) { if (!tumAltOptions.includes(v)) tumAltOptions.push(v); }
          }

          for (let bi = 0; bi < blok.detay.length; bi++) {
            const d = blok.detay[bi];
            if (d.kayitDolu && d.altDolu) continue;

            // TEK AŞAMALI AI: Kayıt Türü + K. Alt Türü birlikte sorulur
            const kayitOptions = ISLETME_KAYIT_TURU_LIST_ALIS;
            let karar;
            if (d.kayitDolu && !d.altDolu) {
              // Kayıt Türü zaten seçili, sadece alt türü sor
              const altOptions = ISLETME_KAYIT_ALT_MAP[d.kayitDeger] || tumAltOptions;
              karar = await aiDecideIsletme({
                kayitOptions: [d.kayitDeger],
                altOptions,
                tarih: meta.tarih, belgeNo: meta.belgeNo, belgeTuru: ust.belgeTuru, faturaTuru: ust.faturaTuru,
                mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma,
                firmaKimlikNo: meta.firmaKimlikNo, // Firma Hafizasi — mukellef-bazli
                tutar: meta.tutar,
                matrah: d.matrah, kdv: d.kdv,
                action, blokIndex: bi + 1, blokToplam: blok.detay.length,
              });
              if (karar?.emin) karar.kayitTuru = d.kayitDeger;
            } else {
              // Her ikisi de boş — tek çağrıda ikisini birden sor
              karar = await aiDecideIsletme({
                kayitOptions,
                altOptions: tumAltOptions,
                tarih: meta.tarih, belgeNo: meta.belgeNo, belgeTuru: ust.belgeTuru, faturaTuru: ust.faturaTuru,
                mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma,
                firmaKimlikNo: meta.firmaKimlikNo, // Firma Hafizasi — mukellef-bazli
                tutar: meta.tutar,
                matrah: d.matrah, kdv: d.kdv,
                action, blokIndex: bi + 1, blokToplam: blok.detay.length,
              });
            }

            // onay_bekliyor: AI karari gecmisle celisiyor, AUTO ONAY yok
            if (karar?.karar === 'onay_bekliyor') {
              aiHata = `⏸ Onay kuyruguna dustu: ${(karar?.sapmaSebep || karar?.sebep || '').slice(0, 120)}`;
              break;
            }

            if (!karar?.emin || !karar.kayitTuru) {
              aiHata = `Kayıt Türü emin_degil: ${(karar?.sebep || '').slice(0, 80)}`;
              break;
            }

            // Client-side doğrulama: altTuru, seçilen kayitTuru'nun listesinde mi?
            const gecerliAltlar = ISLETME_KAYIT_ALT_MAP[karar.kayitTuru] || [];
            if (karar.altTuru && gecerliAltlar.length > 0 && !gecerliAltlar.includes(karar.altTuru)) {
              // Eşleşme yok — en yakın eşleşmeyi dene (case-insensitive)
              const hit = gecerliAltlar.find(a => a.toLowerCase() === karar.altTuru.toLowerCase());
              if (hit) {
                karar.altTuru = hit;
              } else {
                aiHata = `K.Alt Türü eşleşmez: "${karar.altTuru}" ∉ ${karar.kayitTuru}`;
                break;
              }
            }

            // Kayıt Türü seç
            if (!d.kayitDolu) {
              const ok = await pickAntSelectOption(d.kayitSelect, karar.kayitTuru);
              if (!ok) {
                aiHata = `Kayıt Türü seçilemedi: ${karar.kayitTuru}`;
                break;
              }
              aiOzet.push(`B${bi + 1}K:${karar.kayitTuru}`);
              await sleep(400);
            }

            // K. Alt Türü seç
            if (!d.altDolu && karar.altTuru) {
              const ok2 = await pickAntSelectOption(d.altSelect, karar.altTuru);
              if (!ok2) {
                aiHata = `K. Alt Türü seçilemedi: ${karar.altTuru}`;
                break;
              }
              aiOzet.push(`B${bi + 1}A:${karar.altTuru}`);
              await sleep(200);
            } else if (!d.altDolu) {
              aiHata = `K. Alt Türü AI tarafından belirlenmedi (kayıt: ${karar.kayitTuru})`;
              break;
            }
          }

          if (aiHata) {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · AI: ${aiHata}`, {
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar,
            });
            await clickIleri(fid); continue;
          }
          // Doldurma bitti — güncel durumu oku
          blok = isletmeBlokDurumu();
          if (!blok.varMi || blok.bosBlokVar) {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · AI sonrası hâlâ boş blok var`, {
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar,
            });
            await clickIleri(fid); continue;
          }
        }

        // --- Detaylı log formatı ---
        const ustFinal = isletmeUstAlanDurumu();
        if (!ustFinal.faturaTuru || !ustFinal.belgeTuru || !ustFinal.alisSatisTuru) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip',
            `${mTag} · F2 iptal: üst alan eksik FatT:${ustFinal.faturaTuru || '-'} BT:${ustFinal.belgeTuru || '-'} AST:${ustFinal.alisSatisTuru || '-'}`,
            { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih });
          await clickIleri(fid); continue;
        }
        ust.faturaTuru = ustFinal.faturaTuru;
        ust.belgeTuru = ustFinal.belgeTuru;
        ust.alisSatisTuru = ustFinal.alisSatisTuru;
        const blokLog = blok.detay.map((d, i) => `B${i + 1}:${(d.kayitDeger || '?').slice(0, 20)}/${(d.altDeger || '?').slice(0, 20)}`).join(' ');

        setStatus(`${mukellef.ad} · #${fid} İşletme OCR kontrol...`);
        const ocrKontrol = await validateIsletmeBeforeF2({ blok, meta, ust, mukellef, action });
        if (!ocrKontrol.ok) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · OCR kontrol: ${ocrKontrol.sebep}`, {
            firma: meta.firma,
            belgeNo: meta.belgeNo,
            tutar: meta.tutar,
            tarih: meta.tarih,
            belgeTuru: ust.belgeTuru,
            faturaTuru: ust.faturaTuru,
            alisSatisTuru: ust.alisSatisTuru,
            isletmeBloklari: blok.detay.map((d, i) => ({
              blok: i + 1,
              kayitTuru: d.kayitDeger || null,
              altTuru: d.altDeger || null,
              matrah: d.matrah || null,
              kdv: d.kdv || null,
            })),
          });
          await clickIleri(fid); continue;
        }
        aiOzet.push(ocrKontrol.sebep);

        // --- 5) F2 ile kaydet ---
        try {
          const kayitSonucu = await kaydetOnaylaVeBekle(fid, {
            timeoutMs: 6500,
            retryTimeoutMs: 2500,
          });
          if (kayitSonucu.saved) {
            counters.onay++; counters.toplam++; setCount();
            const aiNot = aiKullanildi ? ` · AI` : '';
            const logMsg = `${mTag} · F2 · FatT:${ust.faturaTuru} BT:${ust.belgeTuru} AST:${ust.alisSatisTuru} · ${blokLog}${aiNot}`;
            await logEvent(mukellef.id, mukellef.ad, 'ok', logMsg, {
              firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, belgeNo: meta.belgeNo, tutar: meta.tutar,
              belgeTuru: ust.belgeTuru,
              faturaTuru: ust.faturaTuru,
              alisSatisTuru: ust.alisSatisTuru,
              hesapKodlari: blok.detay.map((d) => d.kayitDeger).filter(Boolean),
              kdvOranlari: blok.detay.map((d) => d.kdv).filter(Boolean),
              memoryCandidates: blok.detay
                .filter((d) => d.kayitDeger)
                .map((d) => ({
                  kararTipi: 'isletme',
                  kategori: d.kayitDeger,
                  altKategori: d.altDeger || null,
                  firmaKimlikNo: meta.firmaKimlikNo || null,
                  firmaUnvan: meta.firma || null,
                  taxpayerId: mukellef.id || null,
                })),
              aiOzet: aiOzet.length ? aiOzet.join(' · ') : undefined,
            });
            if (getCurrentFid() === fid && !/count=0/.test(location.href)) {
              await clickIleri(fid);
            }
          } else {
            counters.atla++; counters.toplam++; setCount();
            const f2Debug = `FatT:${ust.faturaTuru || '-'} BT:${ust.belgeTuru || '-'} AST:${ust.alisSatisTuru || '-'} · ${blokLog || 'blok yok'} · ${window.__morenLastF2Debug || 'btn:bilinmiyor'} · urlFid:${getCurrentFid() || '-'} count:${location.href.match(/count=(-?\d+)/)?.[1] || '-'}`;
            const atlamaSebebi = kayitSonucu.validationFailed
              ? `${mTag} - eksik alan (MIHSAP): ${kayitSonucu.validationFailed.slice(0, 80)} · ${f2Debug}`
              : `${mTag} - Isletme F2 sonuclanmadi · ${f2Debug}`;
            await logEvent(mukellef.id, mukellef.ad, 'skip', atlamaSebebi, {
              firma: meta.firma,
              belgeNo: meta.belgeNo,
              tutar: meta.tutar,
              tarih: meta.tarih,
              belgeTuru: ust.belgeTuru,
              faturaTuru: ust.faturaTuru,
              alisSatisTuru: ust.alisSatisTuru,
              isletmeBloklari: blok.detay.map((d, i) => ({
                blok: i + 1,
                kayitTuru: d.kayitDeger || null,
                altTuru: d.altDeger || null,
                matrah: d.matrah || null,
                kdv: d.kdv || null,
              })),
            });
            await clickIleri(fid);
          }
        } catch (e) {
          counters.hata++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'error', `${mTag} · ${String(e)}`, {
            firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar,
          });
          await clickIleri(fid);
        }
        continue;
      }
      // ==========================================================
      // BİLANÇO DALI (BILANCO/1 · BILANCO/2) — mevcut akış
      // ==========================================================
      const fastCodeState = await readCodesOrBlankState(isletmeAccountCodeFlow ? 800 : 1800);
      const codes = fastCodeState.codes;
      const hasBosSelect = fastCodeState.hasBosSelect || isletmeAccountCodeFlow;
      perf.mark('codes');
      if (!tumKodlarDolu(codes) && !hasBosSelect) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'kod boş (hiç kod yok)', logMeta());
        await clickIleri(fid); continue;
      }
      // Ekrandaki select'lerden herhangi biri bossa (matrah/KDV/cari) direkt gec.
      if (hasBosSelect) {
        const isBlankCodeDirectSkip = true;
        if (isBlankCodeDirectSkip) {
          const fastBlankSections = Array.isArray(fastCodeState.blankSections) ? fastCodeState.blankSections : [];
          const durumlar = normalizeBosAlanDurumlari({
            matrahDolu: bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i),
            vergiDolu: bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i),
            cariDolu: bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i),
            odemeDolu: bolumHesapKoduDolu(ODEME_HESABI_RE),
          }, isletmeAccountCodeFlow);
          const bosAlanlar = [
            durumlar.matrahDolu === false && 'Matrah',
            durumlar.vergiDolu === false && 'KDV',
            durumlar.cariDolu === false && 'Cari',
            durumlar.odemeDolu === false && 'Tahsilat/Odeme',
          ].filter(Boolean);
          if (!bosAlanlar.length && fastBlankSections.length) bosAlanlar.push(...fastBlankSections);
          counters.atla++; counters.toplam++; setCount();
          await logEvent(
            mukellef.id,
            mukellef.ad,
            'skip',
            `Boş muhasebe kodu var (${bosAlanlar.join(', ') || 'Hesap Kodu'}) — direkt geçildi`,
            logMeta({
              hesapKodlari: codes,
              kdv: readKdvOrani(),
              aiCallReason: 'local_blank_account_skip',
            }),
          );
          await clickIleri(fid);
          continue;
        }
        // ================================================================
        // v1.12.0 — AŞAMA 1 (Doldur, kaydetme) — SADECE Bilanço SATIŞ:
        // Eşikler: Cari %95, Matrah %90, KDV %90.
        // Tüm gerekli alanlar eşik ÜSTÜNDEYSE doldur, F2'ye BASMA.
        // Kullanıcı manuel kaydetsin (60s bekleme). Eşik altıysa veya
        // doldurma başarısızsa eski davranış: atla.
        // ================================================================
        // v1.13.6 — Okunabilir log formatı
        let logMesaji = '';
        let kaydedildiBaslangic = false;
        if (['isle_satis', 'isle_alis', 'isle_satis_isletme', 'isle_alis_isletme'].includes(action)) {
          try {
            setStatus(`${mukellef.ad} · #${fid} AI öneri istiyor…`);
            const secenekler = await readBosAlanSecenekleriHizli({ action, codes, firmaAdi: meta.firma, forceBosAlanlar: isletmeAccountCodeFlow });
            const adetM = (secenekler.matrahKodlari || []).length;
            const adetK = (secenekler.kdvKodlari || []).length;
            const adetC = (secenekler.cariKodlari || []).length;
            const adetO = (secenekler.odemeKodlari || []).length;

            // Hangi alanlar boş?
            const durumlar = normalizeBosAlanDurumlari({
              matrahDolu: bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i),
              vergiDolu: bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i),
              cariDolu: bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i),
              odemeDolu: bolumHesapKoduDolu(ODEME_HESABI_RE),
            }, isletmeAccountCodeFlow);
            const matrahBos = durumlar.matrahDolu === false;
            const vergiBos  = durumlar.vergiDolu === false;
            const cariBos   = durumlar.cariDolu === false;
            const odemeBos  = durumlar.odemeDolu === false;
            const bosAlanlar = [matrahBos && 'Matrah', vergiBos && 'KDV', cariBos && 'Cari', odemeBos && 'Tahsilat/Odeme'].filter(Boolean);

            if (adetM + adetK + adetC + adetO > 0) {
              const oneriKarari = (adetM + adetK + adetC > 0)
                ? await aiDecideTimed({
                    codes: codes, tarih, hedefAy,
                    belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
                    mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tutar: meta.tutar,
                    action, bosAlanSecenekleri: secenekler,
                  }, 6500, 'bos alan AI onerisi zaman asimi - manuel kontrol')
                : { onerilenler: { confidence: { odeme: 0.95 } } };
              let o = oneriKarari?.onerilenler || {};
              // AI bazen bos alanlar icin hic oneride bulunmuyor. Ekrandaki uygun hesap
              // adaylari varken matrah/KDV/cari alanlarini deterministik tamamlayip akisi surdur.
              o = applyIsletmeAccountCodeFallback({ action, secenekler, oneri: o });
              const cf = o.confidence || {};
              const fmtC = (v) => typeof v === 'number' ? `%${Math.round(v * 100)}` : '?';
              console.log('[Moren] AI önerisi:', { secenekler, oneri: o });

              // Eşik kontrolü + doldurma
              setStatus(`${mukellef.ad} · #${fid} alanlar dolduruluyor…`);
              const fillResult = await tryFillBosAlanlar({
                secenekler,
                oneri: o,
                durumlar,
              });
              console.log('[Moren.fill] Doldurma sonucu:', fillResult);

              // Çok satırlı, alt alta okunabilir özet
              const satirlar = [];
              satirlar.push(`Boş alanlar: ${bosAlanlar.join(', ') || '(yok)'}`);
              satirlar.push('');
              satirlar.push('AI önerisi:');
              if (matrahBos) satirlar.push(`  Matrah : ${o.matrahHesapKodu || '(öneri yok)'}  güven ${fmtC(cf.matrah)}  (sondaj: ${adetM} sonuç)`);
              if (vergiBos)  satirlar.push(`  KDV    : ${o.kdvHesapKodu    || '(öneri yok)'}  güven ${fmtC(cf.kdv)}  (sondaj: ${adetK} sonuç)`);
              if (cariBos)   satirlar.push(`  Cari   : ${o.cariHesapKodu   || '(öneri yok)'}  güven ${fmtC(cf.cari)}  (sondaj: ${adetC} sonuç)`);
              if (odemeBos)  satirlar.push(`  Odeme  : ${o.odemeHesapKodu || o.tahsilatOdemeHesapKodu || (secenekler.odemeKodlari || [])[0] || '(oneri yok)'}  guven ${fmtC(cf.odeme || cf.cari || 0.95)}  (liste: ${adetO} sonuc)`);
              satirlar.push('');
              if (o._deterministicFallback) {
                satirlar.push(`Deterministik tamamlandı: ${o._deterministicFallback}`);
                satirlar.push('');
              }

              if (fillResult.dolduruldu) {
                const finalCodes = await readHesapKodlari(4000);
                const finalHesapKodlari = finalCodes.length > 0
                  ? finalCodes
                  : [o.matrahHesapKodu, o.kdvHesapKodu, o.cariHesapKodu, o.odemeHesapKodu || o.tahsilatOdemeHesapKodu || (secenekler.odemeKodlari || [])[0]].filter(Boolean);
                const primaryHesapKodu = o.matrahHesapKodu
                  || finalHesapKodlari.find((c) => /^(600|601|602|150|153|157|740|760|770)\./.test(c))
                  || finalHesapKodlari[0]
                  || codes[0]
                  || null;
                setStatus(`${mukellef.ad} · #${fid} F2 güvenlik kontrol...`);
                const finalDecisionArgs = {
                  codes: finalHesapKodlari,
                  tarih,
                  hedefAy,
                  belgeNo: meta.belgeNo,
                  belgeTuru: meta.belgeTuru,
                  faturaTuru: meta.faturaTuru,
                  mukellef: mukellef.ad,
                  mukellefId: mukellef.id,
                  firma: meta.firma,
                  firmaKimlikNo: meta.firmaKimlikNo,
                  tutar: meta.tutar,
                  action,
                };
                let finalDecision = await aiDecideTimed(finalDecisionArgs, 6500, 'F2 guvenlik karari zaman asimi - manuel kontrol');
                const faturaKdvOranlari = readAllKdvOranlari();
                let finalSafety = finalSafetyCheckFatura({
                  decision: finalDecision,
                  meta,
                  codes: finalHesapKodlari,
                  kdvOranlari: faturaKdvOranlari,
                });
                const finalRetry = await freshFaturaDecisionRetry({
                  safety: finalSafety,
                  decision: finalDecision,
                  decideArgs: finalDecisionArgs,
                  meta,
                  codes: finalHesapKodlari,
                  kdvOranlari: faturaKdvOranlari,
                });
                if (finalRetry) {
                  finalDecision = finalRetry.decision;
                  finalSafety = finalRetry.safety;
                  satirlar.push('Not: OCR eksik/cache sonucu nedeniyle taze kontrol tekrarlandi.');
                }
                if (!finalSafety.ok) {
                  satirlar.push(`Sonuç: otomatik onay durduruldu — ${finalSafety.sebep}`);
                  logMesaji = satirlar.join('\n');
                  counters.atla++; counters.toplam++; setCount();
                  await logEvent(mukellef.id, mukellef.ad, 'skip', logMesaji,
                    logMeta({
                      hesapKodu: primaryHesapKodu,
                      hesapKodlari: finalHesapKodlari,
                      kdv: readKdvOrani(),
                      decisionTrace: finalDecision?.decisionTrace || null,
                      aiCallReason: finalDecision?.aiCallReason || null,
                      ...finalSafety.compareMeta,
                    }));
                  await clickIleri(fid);
                  continue;
                }
                setStatus(`${mukellef.ad} · #${fid} F2 ile kaydediyor…`);
                const kayitSonucu = await kaydetOnaylaVeBekle(fid, {
                  timeoutMs: 6500,
                  retryTimeoutMs: 2500,
                });
                if (kayitSonucu.saved) {
                  satirlar.push('Sonuç: ✓ Doldurma başarılı, F2 ile otomatik kaydedildi');
                  counters.onay++; counters.toplam++; setCount();
                  await logEvent(mukellef.id, mukellef.ad, 'ok', satirlar.join('\n'),
                    {
                      firma: meta.firma,
                      firmaKimlikNo: meta.firmaKimlikNo,
                      belgeNo: meta.belgeNo,
                      tutar: meta.tutar,
                      hesapKodu: primaryHesapKodu,
                      hesapKodlari: finalHesapKodlari,
                      decisionTrace: finalDecision?.decisionTrace || null,
                      faturaDecisionCandidate: finalDecision?.faturaDecisionCandidate || null,
                      aiCallReason: finalDecision?.aiCallReason || null,
                      ...finalSafety.compareMeta,
                    });
                  if (getCurrentFid() === fid && !isZeroCount()) {
                    await clickIleri(fid);
                  }
                  continue;
                }
                // F2 başarısız
                if (kayitSonucu.validationFailed) {
                  satirlar.push(`Sonuç: ✗ Dolduruldu ama Mihsap kayıt etmedi`);
                  satirlar.push(`Mihsap uyarısı: "${kayitSonucu.validationFailed.slice(0, 80)}"`);
                } else {
                  satirlar.push(`Sonuç: ✗ Dolduruldu ama F2 sonrası kayıt onaylanmadı`);
                  const eksikler = [];
                  if (cariBos && !o.cariHesapKodu) eksikler.push('Cari');
                  if (matrahBos && !o.matrahHesapKodu) eksikler.push('Matrah');
                  if (vergiBos && !o.kdvHesapKodu) eksikler.push('KDV');
                  if (eksikler.length > 0) satirlar.push(`Muhtemel sebep: ${eksikler.join('/')} alanı için öneri yoktu, boş kaldı`);
                }
              } else {
                if (fillResult.sebep && fillResult.sebep.startsWith('eşik altı')) {
                  satirlar.push('Sonuç: ↷ AI yeterince emin değil — atlandı');
                  const altlar = [];
                  if (matrahBos && (cf.matrah || 0) < BOS_ALAN_ESIKLERI.matrah) altlar.push(`Matrah ${fmtC(cf.matrah)} < %${Math.round(BOS_ALAN_ESIKLERI.matrah*100)}`);
                  if (vergiBos && (cf.kdv || 0) < BOS_ALAN_ESIKLERI.kdv)        altlar.push(`KDV ${fmtC(cf.kdv)} < %${Math.round(BOS_ALAN_ESIKLERI.kdv*100)}`);
                  if (cariBos && (cf.cari || 0) < BOS_ALAN_ESIKLERI.cari)       altlar.push(`Cari ${fmtC(cf.cari)} < %${Math.round(BOS_ALAN_ESIKLERI.cari*100)}`);
                  altlar.forEach((a) => satirlar.push(`  • ${a}`));
                } else if (fillResult.sebep && fillResult.sebep.includes('seçilemedi')) {
                  satirlar.push(`Sonuç: ✗ Mihsap'ta seçim başarısız`);
                  satirlar.push(`Detay: ${fillResult.sebep}`);
                } else {
                  satirlar.push(`Sonuç: ✗ ${fillResult.sebep}`);
                }
              }
              logMesaji = satirlar.join('\n');
            } else {
              logMesaji = `Boş alanlar: ${bosAlanlar.join(', ')}\nAI öneri için seçenek bulunamadı (sondaj boş döndü)`;
            }
          } catch (e) {
            console.warn('[Moren] AI öneri/doldurma hatası:', e?.message);
            logMesaji = `Hata: ${(e?.message || '').slice(0, 60)}`;
          }
        } else {
          logMesaji = 'Boş alan var (sadece SATIŞ için doldurma aktif)';
        }
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', logMesaji, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
        await clickIleri(fid); continue;
      }
      // Kural/firma hafızası hızlı karar; eşleşme yoksa görüntülü AI kararına düşer.
      setStatus(`${mukellef.ad} · #${fid} kural/hafıza kontrolü…`);
      const decisionArgs = {
        codes, tarih, hedefAy,
        belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
        mukellef: mukellef.ad,
        mukellefId: mukellef.id, // Firma Hafizasi — mukellef-bazli ogrenme
        firma: meta.firma,
        firmaKimlikNo: meta.firmaKimlikNo,
        tutar: meta.tutar,
        action,
      };
      const localKdvOranlari = readAllKdvOranlari();
      const localVehicleRisk = detectVehiclePurchaseRisk({
        firma: meta.firma,
        tutar: meta.tutar,
        codes,
        text: '',
        decision: null,
      });
      const localKdvCheck = checkFaturaKdvCodeMatch(codes, localKdvOranlari);
      if (localVehicleRisk || !localKdvCheck.ok) {
        counters.atla++; counters.toplam++; setCount();
        const localReason = localVehicleRisk || `KDV oranı uyuşmuyor: ${localKdvCheck.sebep}`;
        await logEvent(mukellef.id, mukellef.ad, 'skip',
          `Otomatik onay durduruldu — ${localReason}`,
          logMeta({
            hesapKodu: codes[0],
            hesapKodlari: codes,
            kdv: readKdvOrani(),
            kdvOranlari: localKdvOranlari,
            satirSayisi: codes.length,
            aiCallReason: localVehicleRisk ? 'local_vehicle_rule_skip' : 'local_kdv_code_rule_skip',
            kdvTutarsizSatirlar: localKdvCheck.tutarsizSatirlar,
          }));
        await clickIleri(fid); continue;
      }
      perf.mark('preDecision');
      let decision = await aiDecideTimed(
        { ...decisionArgs, ruleOnly: true },
        2500,
        'Firma geçmişi kontrolü zaman aşımına uğradı — elle kontrol',
      );
      perf.mark('ruleDecision');
      if (decision?.karar === 'needs_ai') {
        const isAlisFreeManual = false;
        if (isAlisFreeManual) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip',
            'Firma geçmişinde eşleşme yok — elle işlenecek (yapay zeka çağrılmadı)',
            logMeta({
              hesapKodu: codes[0],
              hesapKodlari: codes,
              kdv: readKdvOrani(),
              kdvOranlari: localKdvOranlari,
              satirSayisi: codes.length,
              aiCallReason: 'rule_only_no_match_free_manual',
            }));
          await clickIleri(fid); continue;
        }
        setStatus(`${mukellef.ad} · #${fid} AI inceliyor…`);
        decision = await aiDecideTimed(decisionArgs, 7500, 'AI karar zaman asimi - manuel kontrol');
        perf.mark('aiDecision');
      }
      let karar = decision?.karar || 'emin_degil';
      let sebep = (decision?.sebep || '').slice(0, 120);
      let decisionTrace = decision?.decisionTrace || null;
      let faturaDecisionCandidate = decision?.faturaDecisionCandidate || null;
      const currentKdvOranlari = localKdvOranlari;
      let safety = finalSafetyCheckFatura({
        decision,
        meta,
        codes,
        kdvOranlari: currentKdvOranlari,
      });
      const retryResult = await freshFaturaDecisionRetry({
        safety,
        decision,
        decideArgs: decisionArgs,
        meta,
        codes,
        kdvOranlari: currentKdvOranlari,
      });
      if (retryResult) {
        decision = retryResult.decision;
        safety = retryResult.safety;
        karar = decision?.karar || 'emin_degil';
        sebep = (decision?.sebep || '').slice(0, 120);
        decisionTrace = decision?.decisionTrace || null;
        faturaDecisionCandidate = decision?.faturaDecisionCandidate || null;
      }
      if (!safety.ok) {
        counters.atla++; counters.toplam++; setCount();
        const sapma = karar === 'onay_bekliyor'
          ? (decision?.sapmaSebep || sebep || safety.sebep).slice(0, 180)
          : safety.sebep;
        await logEvent(mukellef.id, mukellef.ad, 'skip',
          `Otomatik onay durduruldu — ${sapma}`,
          logMeta({
            hesapKodu: codes[0],
            hesapKodlari: codes,
            kdv: readKdvOrani(),
            satirSayisi: codes.length,
            decisionTrace,
            cacheHit: !!decision?.cacheHit,
            aiCallReason: decision?.aiCallReason || null,
            ...safety.compareMeta,
          }));
        await clickIleri(fid); continue;
      }
      try {
        let validationFailed = null;

        // F2 sonrası URL değişti mi + validation dialog geldi mi kontrolü
        // Kullanıcı talebi: MIHSAP ekranının kendine gelmesi için asgari 5 sn bekleyelim —
        // aksi halde hızlı ardışık F2 basımlarında DOM güncellenmeden "sonuçlanmadı" sanıyoruz
        // (özellikle Z Raporu / Petravet gibi yoğun satış akışında).
        // Ayrıca "tutar farkı onay" dialog'u (resubmit) gelirse Onayla + tekrar F2 yapıyoruz.
        const waitSaved = async (timeoutMs) => {
          const t0 = Date.now();
          const minWaitMs = 450;
          // 1) Asgari bekleme penceresi — bu sürede sadece validation / dialog işle,
          //    URL değişimine "saved" denip hemen dönme. Ekran gerçekten oturduktan sonra karar ver.
          while (Date.now() - t0 < minWaitMs) {
            const validationMsg = validationDialogVarMi();
            if (validationMsg) {
              validationFailed = validationMsg;
              await handleDialogs();
              return false;
            }
            if (getVisibleModals().length > 0) {
              const r = await handleDialogs();
              if (r === 'validation') {
                validationFailed = recentValidationFailure();
                return false;
              }
              if (r === 'resubmit') {
                // Onayla → 5 sn bekle → fid değişmediyse F2 (aksi halde F2
                // sonraki faturayı tetikler ve mevcut işlem log'suz kalır).
                const res = await onaylaSonrasiF2(fid);
                if (res === 'already-advanced') {
                  // Kaydedilip ilerlendi; phase 2 URL kontrolünde saved=true dönecek
                  break;
                }
              }
            }
            await sleep(100); // v1.36.20
          }
          // 2) Asgari süre sonrası saved kriterlerini kontrol et
          while (Date.now() - t0 < timeoutMs) {
            const m2 = location.href.match(/\/(\d+)\?count=/);
            if (m2 && m2[1] !== fid) return true;
            if (/count=0/.test(location.href)) return true;
            const okToast = document.querySelector('.ant-message-success, .ant-notification-notice-success, .ant-message-info');
            if (okToast) return true;

            const validationMsg = validationDialogVarMi();
            if (validationMsg) {
              validationFailed = validationMsg;
              await handleDialogs();
              return false;
            }

            if (getVisibleModals().length > 0) {
              const r = await handleDialogs();
              if (r === 'validation') {
                validationFailed = recentValidationFailure();
                return false;
              }
              if (r === 'resubmit') {
                // Onayla → 5 sn bekle → fid değişmediyse F2.
                // URL değiştiyse ana loop zaten sonraki turda saved=true görür.
                const res = await onaylaSonrasiF2(fid);
                if (res === 'already-advanced') {
                  // URL değişti sayılmalı — bir sonraki turda m2 kontrolü saved=true dönecek
                  continue;
                }
                continue;
              }
              await sleep(200);
              const m3 = location.href.match(/\/(\d+)\?count=/);
              if (m3 && m3[1] !== fid) return true;
            }
            await sleep(150);
          }
          return false;
        };

        await clickKaydetOnayla();
        let saved = await waitSaved(4500);

        // Validation hatası varsa retry YAPMA (zaten alan eksik)
        if (!saved && !validationFailed) {
          await sleep(150);
          await clickKaydetOnayla();
          saved = await waitSaved(1800);
        }

        if (saved) {
          counters.onay++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'ok', `${sebep}`, { firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tarih: meta.tarih, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], hesapKodlari: codes, kdv: readKdvOrani(), kdvOranlari: readAllKdvOranlari(), satirSayisi: codes.length, decisionTrace, faturaDecisionCandidate, aiCallReason: decision?.aiCallReason || null, ...safety.compareMeta });
        } else {
          counters.atla++; counters.toplam++; setCount();
          const atlamaSebebi = validationFailed
            ? `eksik alan (MIHSAP): ${validationFailed.slice(0, 60)}`
            : `F2 sonuçlanmadı · ${sebep}`;
          await logEvent(mukellef.id, mukellef.ad, 'skip', atlamaSebebi, { firma: meta.firma, tarih: meta.tarih, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], hesapKodlari: codes, kdv: readKdvOrani(), kdvOranlari: readAllKdvOranlari(), satirSayisi: codes.length });
          await clickIleri(fid);
        }
      } catch (e) {
        counters.hata++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'error', String(e), { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
        await clickIleri(fid);
      }
    }
  }

  // === KOMUT KUYRUĞU POLLING ===
  async function pollLoop() {
    // v1.36.42: Origin'e göre agent adı (luca vs mihsap) — backend her iki agent için ayrı status tutar.
    const AGENT_NAME = isLucaOrigin() ? 'luca' : 'mihsap';
    let lastPingAt = 0;
    const pingIntervalMs = AGENT_NAME === 'luca' ? 5000 : 30000;
    const sendPing = () => pingAgentStatus(true).then(() => { lastPingAt = Date.now(); }).catch(() => {});
    await sendPing();
    while (window.__morenAgent.running && !window.__morenAgent.stopRequested) {
      // Heartbeat: 30 sn'de bir ping at — backend "agent canlı" görsün
      if (Date.now() - lastPingAt > pingIntervalMs) await sendPing();
      try {
        const cmds = await api('/agent/commands/claim', { method: 'POST', body: JSON.stringify({ agent: AGENT_NAME, deviceId: DEVICE_ID }) });
        if (Array.isArray(cmds) && cmds.length > 0) {
          for (const cmd of cmds) {
            try {
              resetCounters();
              setStatus(`CMD: ${cmd.action}`);
              await processBatch({
                ay: cmd.payload?.ay,
                mukellefler: cmd.payload?.mukellefler || [],
                action: cmd.action,
              });
              await api(`/agent/commands/${cmd.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  status: 'done',
                  result: {
                    ...counters,
                    message: `✓ ${counters.onay} onaylandı · ⏭ ${counters.atla} atlandı · ⏩ ${counters.demirbas} demirbaş · ⚠ ${counters.hata} hata (toplam ${counters.toplam})`,
                   },
                }),
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
        // Network hataları sessizce geç (Railway deploy, geçici bağlantı kopması vb.)
        const msg = String(e?.message || e);
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          setStatus('Bağlantı bekleniyor…');
        } else {
          setStatus('API hatası, yeniden deneniyor');
          console.warn('[Moren]', msg);
        }
      }
      await sleep(5000);
    }
    await pingAgentStatus(false).catch(() => {});
    if (panel) panel.remove();
    delete window.__morenAgent;
  }
  // === GECICI TESHIS PROBU — Luca oturum canlilik zamanlamasi ===
  // SADECE LOG; hicbir Luca istegi/yonlendirmesi yapmaz, davranisi degistirmez.
  // Amac: oturum bosta kac dk'da dusuyor / toplam ne kadar yasiyor olcmek. Veri sonrasi kaldirilacak.
  (function lucaSessionProbe() {
    try {
      if (!isLucaOrigin() || window.top !== window) return;
      if (window.__morenLucaProbe) return;
      window.__morenLucaProbe = true;
      let aliveSinceAt = 0, lastJobAt = 0, wasAlive = null, lastHeartbeatAt = 0;
      const send = (status, message, extra) => {
        try {
          enqueueAgentEvent({ agent: 'luca', action: 'oturum-teshis', status, message,
            meta: { probe: true, deviceId: DEVICE_ID, agentVersion: AGENT_VERSION, ...(extra || {}) } });
        } catch (_) {}
      };
      setInterval(() => {
        try {
          const combo = getLucaFirmaCombo();
          const alive = !!(combo && combo.options && combo.options.length > 0);
          const now = Date.now();
          if (window.__lucaJobRunning) lastJobAt = now;
          if (alive && wasAlive !== true) aliveSinceAt = now;
          if (wasAlive === true && alive === false) {
            const lifeMin = aliveSinceAt ? Math.round((now - aliveSinceAt) / 60000) : -1;
            const idleMin = lastJobAt ? Math.round((now - lastJobAt) / 60000) : -1;
            send('warn', '[TESHIS] Luca oturumu dustu — canli ' + lifeMin + 'dk, son isten beri bos ' + idleMin + 'dk', { lifeMin, idleMin });
          }
          if (alive && !window.__lucaJobRunning && now - lastHeartbeatAt > 300000) {
            lastHeartbeatAt = now;
            const idleMin = lastJobAt ? Math.round((now - lastJobAt) / 60000) : -1;
            send('info', '[TESHIS] Luca oturumu canli, bosta ~' + idleMin + 'dk', { idleMin });
          }
          wasAlive = alive;
        } catch (_) {}
      }, 30000);
    } catch (_) {}
  })();
  pollLoop();
  console.log('[Moren Agent] yuklendi · v' + AGENT_VERSION + ' (' + (isLucaOrigin() ? 'luca' : 'mihsap') + ')');
})();
