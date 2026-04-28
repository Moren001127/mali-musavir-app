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

  // === MIHSAP TOKEN SENKRONİZASYONU ===
  // MIHSAP JWT'sini backend'e gönder (fatura çekme için gerekli)
  let lastSyncedMihsapToken = '';
  async function syncMihsapToken() {
    try {
      const mihsapToken = localStorage.getItem('token');
      if (!mihsapToken || mihsapToken.length < 20) return;
      if (mihsapToken === lastSyncedMihsapToken) return; // değişmemiş
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

  // === LUCA MUAVİN İŞ İŞLEYİCİSİ ===
  // Backend'den bekleyen job'ları çeker ve Luca sayfasında Excel
  // indirme butonuna tıklayarak muavin dosyasını yakalar, backend'e
  // geri yükler.
  async function processLucaJobs() {
    try {
      if (!isLucaOrigin()) return;
      // SADECE klasik Luca tab'ında job CLAIM ET. Diğer Luca sayfalarında
      // (www.luca.com.tr landing, agiris.luca LUCASSO v2.1) job alma →
      // klasik Luca sekmesine bırak.
      const isClassicLuca = location.hostname === 'auygs.luca.com.tr'
        && location.pathname.startsWith('/Luca/');
      if (!isClassicLuca) {
        return;
      }
      // Sadece TOP frame'de poll yap — Luca FRAMESET olduğu için her frame'de
      // agent çalışıyor (manifest all_frames:true). Job poll/işleme tek elden,
      // yani üst pencerede yürür. İçerik frame'lerinde agent sadece DOM yardımcı
      // (frame-aware Excel button arama vs.).
      if (window !== window.top) return;
      if (window.__morenAgent.stopRequested) return;
      if (window.__lucaJobRunning) return;

      const r = await fetch(API + '/agent/luca/jobs/pending', {
        headers: { 'X-Agent-Token': TOKEN },
      });
      if (!r.ok) return;
      const jobs = await r.json();
      if (!Array.isArray(jobs) || jobs.length === 0) return;

      window.__lucaJobRunning = true;
      for (const job of jobs) {
        try {
          setStatus(`Luca: ${job.tip} çekiliyor (${job.donem})…`);
          await fetch(API + `/agent/luca/jobs/${job.id}/start`, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN },
          });

          // İlk log: agent versiyonunu portal'a bildir (cache problemini debug için)
          const AGENT_VER = '1.25.0';
          // Job log helper — kullanıcıya canlı progress göster
          // Backend `body.msg` bekliyor (luca.controller.ts logJob endpoint).
          const log = async (line) => {
            try {
              await fetch(API + `/agent/luca/jobs/${job.id}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
                body: JSON.stringify({ msg: line, line }),
              });
            } catch {}
          };

          // İlk satır: agent versiyonu — cache debug için kritik
          await log(`🤖 Moren Agent v${AGENT_VER} | URL=${location.href.slice(0, 80)}`);

          // ─── Job tipine göre rapor sayfası kontrolü ───
          // MIZAN          → Luca'da Mizan ekranı açık olmalı
          // KDV_191/KDV_391 → Defteri Kebir (Tüm Yazıcılar) ekranı + hesap kodu girilmiş
          // ISLETME_GELIR/GIDER → İşletme defteri ekranı
          const tipLabel = {
            MIZAN: 'Mizan ekranı (Genel Raporlar > Mizan)',
            KDV_191: 'Defteri Kebir (Tüm Yazıcılar) — 191 hesap kodu',
            KDV_391: 'Defteri Kebir (Tüm Yazıcılar) — 391 hesap kodu',
            ISLETME_GELIR: 'İşletme defteri (gelir kayıtları)',
            ISLETME_GIDER: 'İşletme defteri (gider kayıtları)',
          }[job.tip] || job.tip;
          await log(`📋 ${tipLabel} açık olmalı`);

          const blob = await fetchLucaMuavinExcel(job, log);
          if (!blob) throw new Error('Excel yakalanamadı');
          await log(`📥 Excel indirildi (${Math.round(blob.size / 1024)} KB)`);

          // ─── Tipine göre upload endpoint ───
          const fd = new FormData();
          fd.append('file', blob, `luca-${job.tip}-${job.donem}.xlsx`);

          let uploadUrl;
          if (job.tip === 'MIZAN') {
            // Mizan'ın kendi upload endpoint'i — query string ile mukellef + dönem
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              donemTipi: String(job.donemTipi || 'AY'),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-mizan?${params.toString()}`;
          } else {
            // KDV muavin / işletme defteri — KDV control session'a yükle
            uploadUrl = `${API}/kdv-control/sessions/${job.sessionId}/excel-from-runner/${job.id}`;
          }

          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN },
            body: fd,
          });
          if (!uploadRes.ok) {
            const errText = await uploadRes.text().catch(() => '');
            throw new Error(`Upload HTTP ${uploadRes.status}: ${errText.slice(0, 120)}`);
          }
          await log(`✅ ${job.tip} backend'e yüklendi`);

          // Done sinyali — backend job'u kapatsın (upload endpoint'i kendi içinde
          // yapmıyorsa explicit done çağrısı gerekir)
          await fetch(API + `/agent/luca/jobs/${job.id}/done`, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN },
          }).catch(() => {});

          setStatus(`Luca: ${job.tip} başarıyla yüklendi`);
        } catch (e) {
          console.error('[Moren] Luca job hata:', e);
          await fetch(API + `/agent/luca/jobs/${job.id}/fail`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Agent-Token': TOKEN,
            },
            body: JSON.stringify({ error: e?.message || 'bilinmeyen hata' }),
          });
        }
      }
      window.__lucaJobRunning = false;
    } catch (e) {
      window.__lucaJobRunning = false;
      console.warn('[Moren] processLucaJobs:', e?.message);
    }
  }
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
   *   KDV_191/391    → Defteri Kebir formu (sonradan eklenecek — frame keşif lazım)
   *   ISLETME_*      → İşletme defteri formu (sonradan)
   */
  async function fetchLucaMuavinExcel(job, log = (() => {})) {
    if (job.tip === 'MIZAN') {
      return await fetchLucaMizanExcel(job, log);
    }
    // Diğer tipler için fallback: eski "Excel butonu ara + tıkla" mantığı
    return await fetchLucaGenericExcel(job, log);
  }

  // ─── LUCA TAM OTOMATİK YARDIMCILARI ───

  /** Bir frame referansını adıyla al */
  function getLucaFrame(name) {
    return [...document.querySelectorAll('frame, iframe')].find((f) => f.name === name);
  }

  /** Bir koşul sağlanana kadar bekle (max ms) */
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
   * yenilenmesini bekler. job.lucaSlug Taxpayer.lucaSlug — Luca'daki firma
   * adının normalize hali (örn. "OZ ELA TUR").
   */
  async function ensureLucaFirma(job, log) {
    if (!job.lucaSlug) {
      await log('ℹ️ Mükellefin lucaSlug alanı boş — firma kontrolü atlanıyor');
      return;
    }
    const frm4 = getLucaFrame('frm4');
    if (!frm4 || !frm4.contentDocument) {
      throw new Error('frm4 (firma seçici) bulunamadı');
    }
    const combo = frm4.contentDocument.getElementById('SirketCombo');
    if (!combo) {
      await log('⚠ SirketCombo bulunamadı, firma kontrolü atlanıyor');
      return;
    }
    const currentText = combo.selectedOptions[0]?.text?.trim() || '';
    const wantedNorm = String(job.lucaSlug).trim().toLocaleUpperCase('tr-TR');
    const currentNorm = currentText.toLocaleUpperCase('tr-TR');

    if (currentNorm.includes(wantedNorm) || wantedNorm.includes(currentNorm)) {
      await log(`✓ Firma zaten doğru: ${currentText}`);
      return;
    }

    // Hedef firma option'unu bul (text similarity)
    let targetOpt = null;
    for (const opt of combo.options) {
      const t = (opt.text || '').toLocaleUpperCase('tr-TR');
      if (t.includes(wantedNorm) || wantedNorm.includes(t.replace(/\s+/g, ' ').trim())) {
        targetOpt = opt;
        break;
      }
    }
    if (!targetOpt) {
      throw new Error(`Firma bulunamadı: "${job.lucaSlug}" — Luca'da bu firma yok veya lucaSlug yanlış`);
    }

    await log(`🔄 Firma değiştiriliyor: ${currentText} → ${targetOpt.text.trim()}`);
    combo.value = targetOpt.value;
    combo.dispatchEvent(new Event('change', { bubbles: true }));

    // Sayfa yenilenmesini bekle — frm4 reload edecek, sonra frm5 menü hazır olacak
    await sleep(2000);
    // frm5 (sağ menü) tekrar yüklensin diye bekle — Mizan text'i orada görünene kadar
    await waitUntil(() => {
      const frm5 = getLucaFrame('frm5');
      if (!frm5 || !frm5.contentDocument) return false;
      const all = frm5.contentDocument.querySelectorAll('*');
      for (const el of all) {
        if ((el.textContent || '').trim() === 'Mizan' && el.children.length === 0) return true;
      }
      return false;
    }, 15000);
    await log(`✓ Firma değişti, menü hazır`);
  }

  /**
   * Sağ menüde "Mizan" element'ini bul — frm5 öncelikli, yoksa tüm frame'leri tara.
   * Sayfa yenilenmesinden sonra menü 1-2 saniye sürebilir; bu yüzden waitUntil ile
   * X saniye boyunca yeniden dene.
   */
  async function findLucaMenuItem(text, _log, maxMs = 8000) {
    const result = await waitUntil(() => {
      // Önce frm5 (sağ menü)
      const candidates = ['frm5', 'frm2', 'frm3', 'frm6', 'frm7', 'frm1', 'frm4'];
      for (const fname of candidates) {
        const f = getLucaFrame(fname);
        if (!f || !f.contentDocument) continue;
        const doc = f.contentDocument;
        for (const el of doc.querySelectorAll('*')) {
          if ((el.textContent || '').trim() === text && el.children.length === 0) {
            return { el, frame: f, frameName: fname };
          }
        }
      }
      // Top document'ta da bak (her ihtimale karşı)
      for (const el of document.querySelectorAll('*')) {
        if ((el.textContent || '').trim() === text && el.children.length === 0) {
          return { el, frame: window, frameName: 'top' };
        }
      }
      return null;
    }, maxMs, 250);
    return result;
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

  /**
   * Sayfa Fiş Listesi sayfasında değilse (Mizan menüsü yoksa), Muhasebe →
   * Fiş İşlemleri → Fiş Listesi sırasıyla menü tıklayarak gider.
   */
  async function navigateToFisListesi(log) {
    // Önce Mizan menüsü görünür mü? (Fiş Listesi'ndeyse var demektir)
    const quick = await findLucaMenuItem('Mizan', null, 1500);
    if (quick) {
      await log('✓ Fiş Listesi sayfasında (Mizan menüsü hazır)');
      return;
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
    fullActivate(muhasebeEl, menuFrame.contentWindow);
    await sleep(800);

    // 2. "Fiş İşlemleri" submenüsü açıldı mı?
    await log('🔍 Fiş İşlemleri aranıyor');
    const fisIslemleri = await findLucaMenuItem('Fiş İşlemleri', null, 4000);
    if (!fisIslemleri) {
      throw new Error('Muhasebe menüsü açıldı ama "Fiş İşlemleri" görünmedi (menü hover-only olabilir)');
    }
    await log('🖱 Fiş İşlemleri açılıyor (hover+click+onclick)');
    fullActivate(fisIslemleri.el, fisIslemleri.frame.contentWindow || fisIslemleri.frame);
    await sleep(800);

    // 3. "Fiş Listesi" tıkla
    await log('🔍 Fiş Listesi linki aranıyor');
    const fisListesi = await findLucaMenuItem('Fiş Listesi', null, 4000);
    if (!fisListesi) throw new Error('"Fiş Listesi" linki açılmadı');
    await log('🖱 Fiş Listesi tıklanıyor');
    fullActivate(fisListesi.el, fisListesi.frame.contentWindow || fisListesi.frame);

    // 4. Sayfa yüklensin diye Mizan menüsü çıkana kadar bekle
    await log('⏳ Fiş Listesi sayfası yüklensini bekliyor');
    const mizanReady = await findLucaMenuItem('Mizan', null, 15000);
    if (!mizanReady) throw new Error('Fiş Listesi açıldı ama Mizan menüsü hazır olmadı (timeout 15sn)');
    await log('✓ Fiş Listesi hazır, Mizan menüsü görünür');
  }

  /**
   * Sağ menüde "Mizan" linkine tıkla — frm5 öncelikli. Element FONT içinde olabilir,
   * click bubbling ile parent jQuery handler tetiklenir.
   */
  async function openLucaMizan(log) {
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

    // Tıklama: element + parent zinciri (5 seviye, click event bubbling)
    let cur = found.el;
    const view = found.frame.contentWindow || found.frame;
    for (let i = 0; i < 5 && cur; i++) {
      try {
        cur.click();
        cur.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view }));
      } catch {}
      cur = cur.parentElement;
    }
    await sleep(500);
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
        bit: `${bitGun}.${bitMM}.${yil}`,
      };
    }

    // Format 2: "2026-03", "2026/3", "2026_03" — aylık
    const mMatch = s.match(/(\d{4})[-_/](\d{1,2})$/);
    if (mMatch) {
      const yil = +mMatch[1];
      const ayMo = +mMatch[2];

      if (donemTipi === 'AY' || donemTipi === 'MONTH') {
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
        bit: `${bitGun}.${bitMM}.${yil}`,
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
    await ensureLucaFirma(job, log);

    // 2) Fiş Listesi sayfasına geç
    await navigateToFisListesi(log);

    // 3) Mizan formu yüklü mü?
    let frm3 = getLucaFrame('frm3');
    let formAlreadyLoaded =
      frm3?.contentDocument?.querySelector('form[name="raporMizanForm"]');
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

  /**
   * Luca'nın "Excel'e Aktar" butonuna programmatik tıkla, fetch'i monkey-patch
   * ederek rapor_indir.jq response'unu (Excel blob) yakala.
   */
  async function fetchMizanByClickIntercept(form, job, log) {
    // Önce tarihleri formda elle doldur (button click bunları kullanacak)
    const tarih = donemToTarihAraligi(job.donem, job.donemTipi);
    if (!tarih) throw new Error(`Tarih hesaplanamadı: ${job.donem}`);

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

    const tarihIlk = form.querySelector('input[name="TARIH_ILK"], input[id="TARIH_ILK"], input[name="tarih_ilk"]');
    const tarihSon = form.querySelector('input[name="TARIH_SON"], input[id="TARIH_SON"], input[name="tarih_son"]');
    if (tarihIlk && tarihSon) {
      // Luca slash formatı kullanıyor (network'ten görüldü: "01/03/2026")
      const slashBas = tarih.bas.replace(/\./g, '/');
      const slashBit = tarih.bit.replace(/\./g, '/');

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
    const seenUrls = [];

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
        if (blob.size > 5000 && (isExcelResponse(ct, blob) || isExcelUrl(url))) {
          if (!capturedBlob) {
            capturedBlob = blob;
            await log(`✅ Blob yakalandı: ${url.split('/').pop().slice(0, 60)} (${Math.round(blob.size / 1024)} KB, ct=${ct.slice(0, 30)})`);
          }
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
    const installFetchOverride = (win, label) => {
      if (!win.fetch) return;
      const orig = win.fetch;
      restoreFns.push(() => { try { win.fetch = orig; } catch (e) {} });
      win.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input?.url || '');
        seenUrls.push(`${label}fetch:${url.split('?')[0].split('/').pop()}`);
        // PASIF: Luca akışını engelleme, sadece izle. Background script
        // disk'ten dosyayı okuyup bize iletecek.
        const promise = orig.apply(this, arguments);
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
        this._capturedBody = body;
        seenUrls.push(`${label}xhr:${url.split('?')[0].split('/').pop()}`);
        // PASIF: Luca akışını engelleme, native download'a izin ver.
        this.addEventListener('load', async () => {
          try {
            const ct = this.getResponseHeader('content-type') || '';

            // 1) XHR response Blob ise (Excel)
            if (this.response && this.response instanceof Blob) {
              if (this.response.size > 5000 && (isExcelResponse(ct) || isExcelUrl(url))) {
                if (!capturedBlob) {
                  capturedBlob = this.response;
                  await log(`✅ XHR blob yakalandı (${Math.round(capturedBlob.size / 1024)} KB)`);
                  return;
                }
              }
            }

            // 2) rapor_takip.jq görüldü — durum:150 (tamamlandı) olunca aynı body ile
            //    genel/rapor_indir.jq'a POST atalım. Luca yapısı:
            //      URL: genel/rapor_takip.jq POST {"donem_id":"X","params":{"raporTur":"mizan"}}
            //      Resp: {"durum":150,"durumAciklama":"Rapor başarılı..."}
            //      İndirme: genel/rapor_indir.jq POST aynı body
            if (/rapor_takip/i.test(url) && !capturedBlob) {
              const bodyStr = typeof this._capturedBody === 'string' ? this._capturedBody : (this._capturedBody ? String(this._capturedBody) : '');
              const respStr = (this.responseText || '');
              // İlk diagnostic
              if (!this._loggedDiag) {
                this._loggedDiag = true;
                log(`🔍 rapor_takip URL: ${url.slice(0, 100)}`).catch(() => {});
                log(`🔍 rapor_takip body: ${bodyStr.slice(0, 200)}`).catch(() => {});
                log(`🔍 rapor_takip response: ${respStr.slice(0, 400)}`).catch(() => {});
              }
              // Durum 150 = "Rapor başarılı bir şekilde oluşturuldu"
              const durum = (respStr.match(/"durum"\s*:\s*(\d+)/) || [])[1];
              const tamamlandi = durum === '150' || /başarılı bir şekilde oluştur/i.test(respStr);
              if (tamamlandi && !this._indirmeBaslandi) {
                this._indirmeBaslandi = true;
                (async () => {
                  await log(`🎯 Rapor hazır (durum=${durum}), indirme başlatılıyor`);
                  // Aynı body ile genel/rapor_indir.jq'a POST
                  const baseUrl = url.replace(/rapor_takip\.jq.*/, '');
                  const indirUrl = `${baseUrl}rapor_indir.jq`;
                  const fullUrl = indirUrl.startsWith('http') ? indirUrl : `${win.location.origin}/Luca/${indirUrl.replace(/^\//, '')}`;
                  try {
                    const r = await win.fetch(fullUrl, {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: bodyStr || JSON.stringify({ donem_id: '', params: { raporTur: 'mizan' } }),
                    });
                    if (r.ok) {
                      const ct = r.headers.get('content-type') || '';
                      const blob = await r.blob();
                      if (blob.size > 5000) {
                        capturedBlob = blob;
                        await log(`✅ rapor_indir.jq blob (POST) yakalandı (${Math.round(blob.size / 1024)} KB, ct=${ct.slice(0, 30)})`);
                      } else {
                        await log(`⚠ POST küçük (${blob.size}B), GET deneniyor`);
                        // GET fallback
                        const r2 = await win.fetch(fullUrl, { credentials: 'include' });
                        if (r2.ok) {
                          const blob2 = await r2.blob();
                          if (blob2.size > 5000) {
                            capturedBlob = blob2;
                            await log(`✅ rapor_indir.jq GET blob yakalandı (${Math.round(blob2.size / 1024)} KB)`);
                          } else {
                            await log(`⚠ GET de küçük (${blob2.size}B): ${(await blob2.text()).slice(0, 100)}`);
                          }
                        }
                      }
                    } else {
                      await log(`⚠ rapor_indir HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`);
                    }
                  } catch (e) {
                    await log(`⚠ rapor_indir fetch hata: ${e.message}`);
                  }
                })().catch(() => {});
              }
            }
          } catch (e) {}
        });
        return origSend.apply(this, arguments);
      };
    };

    // ─── ANCHOR <a download> click override (native download intercept) ───
    const installAnchorOverride = (win, label) => {
      if (!win.HTMLAnchorElement) return;
      const proto = win.HTMLAnchorElement.prototype;
      const origClick = proto.click;
      restoreFns.push(() => { try { proto.click = origClick; } catch (e) {} });
      proto.click = function () {
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

    // Top + tüm frame'lere yükle
    installFetchOverride(window, '');
    installXhrOverride(window, '');
    installAnchorOverride(window, '');
    for (const f of collectFrames(document)) {
      try {
        const fwin = f.contentWindow;
        if (!fwin || fwin === window) continue;
        const lbl = `[${f.name || '?'}]`;
        installFetchOverride(fwin, lbl);
        installXhrOverride(fwin, lbl);
        installAnchorOverride(fwin, lbl);
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
          const blob = await r.blob();
          if (blob.size > 5000) {
            capturedBlob = blob;
            await log(`✅ Bridge URL fetch ile blob yakalandı (${Math.round(blob.size / 1024)} KB)`);
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

    await log(`🖱 "Rapor" butonu tıklanıyor (Luca'nın kendi flow'u)`);
    const btnWin = form.ownerDocument.defaultView;

    // 1) Native click — HTMLElement.prototype.click (en güvenilir, onclick attribute tetikler)
    try { excelBtn.click(); } catch (e) { await log(`⚠ click() hata: ${e.message}`); }
    // 2) jQuery click — Luca jQuery handler kullanıyor olabilir, native click tetiklemez
    try {
      const $ = btnWin.$ || btnWin.jQuery;
      if ($ && typeof $ === 'function') {
        $(excelBtn).trigger('click');
        await log(`🔧 jQuery $(btn).trigger('click') çağrıldı`);
      }
    } catch (e) { await log(`⚠ jQuery click hata: ${e.message}`); }
    // 3) Doğrudan gonder() / global submit fonksiyonunu çağır
    try {
      const oc = excelBtn.getAttribute && excelBtn.getAttribute('onclick');
      if (oc) {
        await log(`🔧 onclick: ${oc.slice(0, 60)}`);
        // onclick'ten fonksiyon adını çıkar (örn "gonder()" → "gonder")
        const funcName = (oc.match(/(\w+)\s*\(/) || [])[1];
        if (funcName && typeof btnWin[funcName] === 'function') {
          btnWin[funcName]();
          await log(`🚀 ${funcName}() çağrıldı (window scope)`);
        } else if (funcName && typeof btnWin.top?.[funcName] === 'function') {
          btnWin.top[funcName]();
          await log(`🚀 ${funcName}() çağrıldı (top scope)`);
        } else {
          // Eval fallback
          btnWin.eval(oc);
          await log(`🔧 eval fallback`);
        }
      }
    } catch (e) { await log(`⚠ gonder hata: ${e.message}`); }
    // 4) Yedek: fullActivate (mouseover+down+up+click)
    try { fullActivate(excelBtn, btnWin); } catch (e) {}

    // YENİ STRATEJİ: Background script disk'ten Excel'i okuyup bize iletecek.
    // moren-luca-file event'ini dinle.
    const onLucaFile = async (e) => {
      const detail = e.detail || {};
      const blob = detail.blob;
      if (capturedBlob) return;
      if (blob && blob.size > 5000) {
        capturedBlob = blob;
        await log(`✅ Background'tan Excel disk'ten alındı (${Math.round(blob.size / 1024)} KB, dosya: ${(detail.filename || '').split(/[\\/]/).pop()})`);
      } else if (detail.filename) {
        await log(`⚠ Background dosyayı diskten okuyamadı: ${detail.filename}. file:// permission yok olabilir.`);
      }
    };
    window.addEventListener('moren-luca-file', onLucaFile);
    restoreFns.push(() => window.removeEventListener('moren-luca-file', onLucaFile));

    // Eski paralel flow KAPATILDI — Luca native download'a izin veriyoruz, biz disk'ten alıyoruz
    if (false && jasperBody) (async () => {
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
        const fullJasperUrl = jasperUrl.startsWith('http') ? jasperUrl : `${form.ownerDocument.defaultView.location.origin}/Luca/${jasperUrl.replace(/^\//, '')}`;
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
        try { donemId = JSON.parse(jasperBody).donem_id || JSON.parse(jasperBody)?.donem_id || ''; } catch (e) {}
        if (!donemId) {
          // jasperBody'den manual olarak çıkar
          const dm = jasperBody.match(/"donem_id"\s*:\s*"?(\d+)"?/);
          donemId = dm ? dm[1] : '';
        }
        const takipBody = JSON.stringify({ donem_id: donemId, params: { raporTur: 'mizan' } });
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
            const durum = (r2text.match(/"durum"\s*:\s*(\d+)/) || [])[1];
            if (i === 0 || i % 5 === 0) {
              await log(`⏳ Polling ${i + 1}/30: durum=${durum || '?'}`);
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
          if (blob.size > 5000) {
            capturedBlob = blob;
            await log(`✅ Paralel flow ile blob yakalandı (${Math.round(blob.size / 1024)} KB, ct=${ct.slice(0, 30)})`);
          } else {
            const t = await blob.text();
            await log(`⚠ rapor_indir POST küçük (${blob.size}B): ${t.slice(0, 150)}`);
            // GET fallback
            const r4 = await directFetch(`${baseGenelUrl}/rapor_indir.jq`, {});
            if (r4.ok) {
              const blob4 = await r4.blob();
              if (blob4.size > 5000) {
                capturedBlob = blob4;
                await log(`✅ rapor_indir GET ile blob (${Math.round(blob4.size / 1024)} KB)`);
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
            const blob = await r.blob();
            if (blob.size > 5000) {
              capturedBlob = blob;
              break;
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
      throw new Error(`Excel yakalanamadı (90sn). İstekler: ${seenUrls.slice(-20).join(' | ')}`);
    }

    return capturedBlob;
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
  const panel = document.createElement('div');
  panel.id = 'moren-agent-panel';
  panel.style.cssText =
    'position:fixed;top:70px;right:8px;z-index:2147483647;background:rgba(15,13,11,.92);color:#fafaf9;font:12px/1.3 -apple-system,sans-serif;border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:200px;border:1px solid #b8a06f;cursor:move;user-select:none';
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
  // Sürükle-bırak
  (function(){
    let dx=0,dy=0,dragging=false;
    panel.addEventListener('mousedown',(e)=>{if(e.target.tagName==='BUTTON')return;dragging=true;const r=panel.getBoundingClientRect();dx=e.clientX-r.left;dy=e.clientY-r.top;e.preventDefault();});
    document.addEventListener('mousemove',(e)=>{if(!dragging)return;panel.style.left=(e.clientX-dx)+'px';panel.style.top=(e.clientY-dy)+'px';panel.style.right='auto';panel.style.bottom='auto';});
    document.addEventListener('mouseup',()=>{dragging=false;});
  })();

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
  async function logEvent(mukellefId, mukellefAd, status, detail, extra = {}) {
    try {
      // v1.14.1 — action ve tarih de gönderilsin: mükellef özeti backend'i
      // bunlara göre groupby yapıyor (önce yoktu, hep NULL gidiyordu).
      const currentAction = window.__morenAgent?.currentAction || extra.action || null;
      await api('/agent/events/ingest', {
        method: 'POST',
        body: JSON.stringify({
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
          meta: { mukellefId, tarih: extra.tarih || null, ...extra },
        }),
      });
    } catch (e) { console.warn('[Moren] log fail', e); }
  }

  // === MIHSAP FATURA İŞLEME ===
  function getVisibleModals() {
    return [...document.querySelectorAll('.ant-modal')].filter(
      (m) => m.offsetParent !== null && !m.classList.contains('ant-modal-hidden'),
    );
  }

  async function handleDialogs() {
    await sleep(400);
    const modals = getVisibleModals();
    for (const modal of modals) {
      const text = modal.textContent || '';
      const btns = [...modal.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const findIn = (needle) => btns.find((b) => b.textContent.trim() === needle);
      const findInStarts = (needle) =>
        btns.find((b) => b.textContent.trim().toLowerCase().startsWith(needle.toLowerCase()));

      // Mükerrer fatura uyarısı → İptal
      if (/Mükerrer/i.test(text)) {
        const iptal = findIn('İptal') || findIn('Vazgeç');
        if (iptal) { await click(iptal); await sleep(300); return 'mukerrer'; }
      }
      // "Tutar/toplam farklıdır, onaylıyor musunuz?" uyarısı (özellikle Z Raporu'nda
      // kredi toplam tutarı ile onaylanan tutar farklı olduğunda çıkar) →
      // Onayla ama sonra TEKRAR F2 gerekli. MIHSAP bu onaydan sonra otomatik
      // kaydetmez, seni editöre geri döndürür. Kullanıcı talimatı: "Onayla dedikten
      // sonra hiç beklemeden tekrar F2 Kaydet diyorsun."
      if (/toplam.*farklı/i.test(text) ||
          /tutar.*farklı/i.test(text) ||
          /farklı.*onayl/i.test(text) ||
          /kredi.*farklı/i.test(text)) {
        const onayla =
          findIn('Onayla') || findIn('Evet') || findIn('Tamam') ||
          findInStarts('Onayla') || findInStarts('Evet') || findInStarts('Tamam');
        if (onayla) { await click(onayla); await sleep(300); return 'resubmit'; }
      }
      // Hesap kodu boş uyarısı → Evet/Tamam ile devam et (atlamak için)
      if (/Hesap kodu girilmemiş/i.test(text) ||
          /hesap kodu.*boş/i.test(text) ||
          /kod.*eksik/i.test(text) ||
          /satır mevcut/i.test(text) ||
          /kaydetme.*devam/i.test(text) ||
          /onaylamadan/i.test(text)) {
        const ok =
          findIn('Evet') || findIn('Tamam') || findIn('Devam') || findIn('Devam et') ||
          findInStarts('Evet') || findInStarts('Tamam') || findInStarts('Devam');
        if (ok) { await click(ok); await sleep(300); return 'tamam'; }
      }
      // Onay dialog'u (genel) — "emin misiniz?" gibi. Atlama işlemi yapıyoruz, Evet/Tamam.
      if (/emin misiniz/i.test(text) || /onaylıyor musunuz/i.test(text)) {
        const ok = findIn('Evet') || findIn('Tamam') || findInStarts('Evet');
        if (ok) { await click(ok); await sleep(300); return 'evet'; }
      }
      // Genel fallback — Tamam/Evet/Devam önceliği, sonra Vazgeç
      const ok2 = findIn('Evet') || findIn('Tamam') || findIn('Devam') || findInStarts('Evet') || findInStarts('Tamam');
      if (ok2) { await click(ok2); await sleep(300); return 'tamam'; }
      const vazgec = findIn('Vazgeç') || findIn('İptal');
      if (vazgec) { await click(vazgec); await sleep(300); return 'vazgec'; }
    }
    return 'ok';
  }

  async function clickIleri(currentFid) {
    // Dialog varsa önce kapat
    if (getVisibleModals().length > 0) await handleDialogs();
    const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    const ileri = btns.find((b) => {
      const t = b.textContent.trim();
      return t === 'İleri' || t === 'İleri (F9)' || t.startsWith('İleri ');
    });
    if (!ileri) return;
    await click(ileri);

    // 1) URL değişimini bekle (yeni faturaya geçildi mi?)
    const t0 = Date.now();
    let urlChanged = false;
    while (Date.now() - t0 < 6000) {
      const m = location.href.match(/\/(\d+)\?count=/);
      if (m && m[1] !== currentFid) { urlChanged = true; break; }
      if (/count=0/.test(location.href)) { urlChanged = true; break; }
      // Yeni dialog geldiyse yine kapat
      if (getVisibleModals().length > 0) { await handleDialogs(); }
      await sleep(200);
    }
    if (!urlChanged) return;

    // 2) URL değişti — ama MIHSAP editör DOM'u (hesap kodu select'leri, matrah alanları)
    //    henüz render olmamış olabilir. Ekran tamamen güncellenmeden bir sonraki
    //    iterasyonda "kod boş" görülüp hızlıca F9'a basılıyor ve boş faturalar atlanıyordu.
    //    Bu yüzden editör DOM'unun hazır olmasını bekliyoruz: asgari 5 sn, max 8 sn.
    //    count=0 durumunda editör yok, direk return.
    if (/count=0/.test(location.href)) { await sleep(500); return; }

    const minWaitMs = 5000; // kullanıcı talebi: ekran güncellensin diye asgari 5 sn
    const maxWaitMs = 8000;
    const tStart = Date.now();
    // Asgari bekleme süresince DOM stabilize olmasını bekle
    while (Date.now() - tStart < minWaitMs) {
      if (getVisibleModals().length > 0) { await handleDialogs(); }
      await sleep(200);
    }
    // Asgari süre doldu — şimdi editör DOM'u gerçekten hazır mı diye bak; değilse max'e kadar bekle
    while (Date.now() - tStart < maxWaitMs) {
      if (getVisibleModals().length > 0) { await handleDialogs(); }
      // Hesap kodu / matrah select'leri sayfaya yüklendiyse hazırız
      const hasEditor = document.querySelector('.ant-select-selector, input[placeholder*="Hesap"], input[placeholder*="Matrah"]');
      if (hasEditor) break;
      await sleep(200);
    }
  }

  async function pressF2Once() {
    // Direkt butona tıkla (F2 key dispatch ant-design bazen yakalamıyor)
    const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    const f2btn = btns.find((b) => b.textContent.trim().startsWith('Kaydet ve Onayla'));
    if (f2btn) {
      await click(f2btn);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true }));
    }
  }

  // URL'den mevcut fatura ID'sini oku (örn. "/documents/BILANCO/1/123/456789?count=12" → "456789")
  function getCurrentFid() {
    const m = location.href.match(/\/(\d+)\?count=/);
    return m ? m[1] : null;
  }
  function isZeroCount() {
    return /count=0/.test(location.href);
  }

  // Onayla sonrası 5 sn bekle; fid değişmediyse F2 bas. Değiştiyse MIHSAP zaten
  // kaydedip sonraki faturaya geçmiş — F2 basma (sonraki faturayı istenmeden tetikler,
  // işlem log'suz atlanmış gibi görünür).
  // Dönüş: 'f2' (F2 basıldı) | 'already-advanced' (URL değişti, F2 gereksiz)
  async function onaylaSonrasiF2(fidBefore) {
    await sleep(5000);
    const fidNow = getCurrentFid();
    if (isZeroCount() || (fidBefore && fidNow && fidNow !== fidBefore)) {
      // MIHSAP 5 sn içinde kendisi kaydedip ilerledi — F2 basma
      return 'already-advanced';
    }
    await pressF2Once();
    await sleep(1500);
    return 'f2';
  }

  async function clickKaydetOnayla() {
    const fidAtStart = getCurrentFid();
    await pressF2Once();
    // F2 sonrası MIHSAP'ın modal/onay üretmesi için ilk kısa bekleme
    await sleep(1200);
    // Her türlü dialog'u kapat (mükerrer, hesap kodu uyarı, tutar farkı vs)
    // "resubmit" dönerse (tutar farkı onayı) — onayladıktan sonra F2'yi tekrar basıp
    // sonra yeniden dialog kontrolü yap. Aksi halde kaydetme tamamlanmaz.
    let tries = 0;
    while (tries < 4 && getVisibleModals().length > 0) {
      const result = await handleDialogs();
      if (result === 'resubmit') {
        // Onayla'dan önceki fid'i referans al (fidAtStart — bu fonksiyonun girişindeki fid).
        // 5 sn bekle + URL kontrolü; hâlâ aynı faturadaysak F2 bas, değilse bırak.
        const r = await onaylaSonrasiF2(fidAtStart);
        if (r === 'already-advanced') break; // sonraki faturaya geçtik, döngüden çık
      } else {
        await sleep(300);
      }
      tries++;
    }
  }

  async function getFaturaMeta(fid) {
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
      return {
        tarih,
        belgeNo: v.faturaNo || v.belgeNo || null,
        belgeTuru: v.belgeTuru || null,
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

  async function getFaturaImageBase64() {
    // Mihsap fatura editöründe görsel CANVAS elementlerinde render ediliyor.
    // Birden fazla sayfa varsa hepsini dikey birleştir.
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const canvases = [...document.querySelectorAll('canvas')].filter(
        (c) => c.width > 200 && c.height > 200,
      );
      if (canvases.length > 0) {
        try {
          // İlk sayfa yeterli (detaylar görünsün diye çözünürlük artır)
          const pages = canvases.slice(0, 1);
          const targetW = Math.min(pages[0].width, 1100);
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
          return out.toDataURL('image/jpeg', 0.7).split(',')[1];
        } catch (e) {
          console.warn('[Moren] canvas merge fail', e);
        }
      }
      await sleep(500);
    }
    return null;
  }

  async function aiDecide({ codes, tarih, hedefAy, belgeNo, belgeTuru, faturaTuru, mukellef, firma, firmaKimlikNo, tutar, action, bosAlanSecenekleri }) {
    const img = await getFaturaImageBase64();
    if (!img) return { karar: 'emin_degil', sebep: 'fatura görüntüsü alınamadı' };
    return await api('/agent/ai/decide-fatura', {
      method: 'POST',
      body: JSON.stringify({
        faturaImageBase64: img,
        hesapKodlari: codes,
        faturaTarihi: tarih,
        hedefAy,
        belgeNo,
        belgeTuru,
        faturaTuru,
        mukellef,
        firma,
        firmaKimlikNo, // Firma Hafizasi icin VKN/TCKN
        tutar,
        action,
        // Aşama 2a: boş alan seçenekleri gönderilirse AI öneri verir
        ...(bosAlanSecenekleri ? { bosAlanSecenekleri } : {}),
      }),
    });
  }

  async function readHesapKodlari() {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const els = [...document.querySelectorAll('.ant-select-selection-item')];
      const all = els.map((e) => (e.textContent || '').trim()).filter(Boolean);
      const codes = all.filter((t) => /^\d{3}\.\d/.test(t));
      if (codes.length >= 1) return codes;
      await sleep(500);
    }
    return [];
  }

  function readKdvOrani() {
    const els = [...document.querySelectorAll('.ant-select-selection-item')];
    const kdv = els.map((e) => (e.textContent || '').trim()).find((t) => /^%\d/.test(t));
    return kdv || null;
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
  function bosSelectVarMi() {
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
    return bosBolumler.length > 0;
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
        const isSatis = action === 'isle_satis';
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
        const isSatis = action === 'isle_satis';
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
          const isSatis = action === 'isle_satis';
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

  // v1.12.8 — Cari için TEK SEFER dropdown sondajı (firma adı prefix ile).
  // Mihsap state'i bozulmaz (manuel testteki gibi 1 dropdown açma+kapama).
  async function cariSecenekleriBul(firmaAdi) {
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
      // Kod kısmını çıkar (ör "120.01.N002-NECAT GÖKTAŞ" → "120.01.N002")
      const kodlar = opts.map((t) => {
        const m = t.match(/^(\d{3}\.[A-Z0-9Öİ]+(?:\.[A-Z0-9Öİ]+)*)/i);
        return m ? m[1].trim() : t.split(/[\s\-]/)[0].trim();
      }).filter((c) => /^12[01]\./.test(c));
      return kodlar;
    } catch (e) {
      console.warn('[Moren.fill] cariSecenekleriBul hata:', e?.message);
      return [];
    }
  }

  async function readBosAlanSecenekleriHizli({ action, codes, firmaAdi } = {}) {
    const sonuc = {};
    const matrahDolu = bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i);
    const vergiDolu  = bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i);
    const cariDolu   = bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i);
    const isSatis = action === 'isle_satis';
    const arr = Array.isArray(codes) ? codes : [];

    if (matrahDolu === false) {
      const re = isSatis ? /^60[012]\./ : /^(153|740|770|760)\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0 && isSatis) list = [...STANDART_MATRAH_SATIS];
      if (list.length > 0) sonuc.matrahKodlari = list;
    }
    if (vergiDolu === false) {
      const re = isSatis ? /^391\./ : /^191\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0 && isSatis) list = [...STANDART_KDV_SATIS];
      if (list.length > 0) sonuc.kdvKodlari = list;
    }
    if (cariDolu === false) {
      // Önce codes'tan dene, yoksa firma adıyla TEK SEFER sondaj yap
      const re = /^12[01]\./;
      let list = arr.filter((c) => re.test(c));
      if (list.length === 0 && firmaAdi) {
        list = await cariSecenekleriBul(firmaAdi);
      }
      if (list.length > 0) sonuc.cariKodlari = list;
    }
    console.log('[Moren.fill] readBosAlanSecenekleriHizli:', { matrahDolu, vergiDolu, cariDolu, codesAdet: arr.length, sonuc });
    return sonuc;
  }

  async function tryFillBosAlanlar({ secenekler, oneri, durumlar }) {
    if (!ASAMA_1_AKTIF) {
      return { dolduruldu: false, sebep: 'Aşama 1 devre dışı (Mihsap UX araştırılıyor)' };
    }
    const o = oneri || {};
    const cf = o.confidence || {};
    const ihtiyac = {
      matrah: durumlar.matrahDolu === false && (secenekler.matrahKodlari || []).length > 0,
      kdv:    durumlar.vergiDolu  === false && (secenekler.kdvKodlari    || []).length > 0,
      cari:   durumlar.cariDolu   === false && (secenekler.cariKodlari   || []).length > 0,
    };
    const eslestir = {
      matrah: { kod: o.matrahHesapKodu, conf: cf.matrah || 0, esik: BOS_ALAN_ESIKLERI.matrah },
      kdv:    { kod: o.kdvHesapKodu,    conf: cf.kdv    || 0, esik: BOS_ALAN_ESIKLERI.kdv },
      cari:   { kod: o.cariHesapKodu,   conf: cf.cari   || 0, esik: BOS_ALAN_ESIKLERI.cari },
    };
    // Eşik kontrolü — ihtiyacı olan TÜM alanlar eşik üstünde olmalı, biri eksikse hiçbiri doldurulmaz
    const eksikler = [];
    for (const [k, v] of Object.entries(ihtiyac)) {
      if (!v) continue;
      const e = eslestir[k];
      if (!e.kod || e.conf < e.esik) {
        eksikler.push(`${k}=%${Math.round(e.conf * 100)}<%${Math.round(e.esik * 100)}`);
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

  async function aiDecideIsletme({ kayitOptions, altOptions, tarih, belgeNo, belgeTuru, faturaTuru, mukellef, firma, firmaKimlikNo, tutar, matrah, kdv, action, blokIndex, blokToplam }) {
    const img = await getFaturaImageBase64();
    if (!img) return { emin: false, sebep: 'fatura görüntüsü alınamadı' };
    return await api('/agent/ai/decide-isletme', {
      method: 'POST',
      body: JSON.stringify({
        faturaImageBase64: img,
        kayitTuruOptions: kayitOptions,
        altTuruOptions: altOptions,
        faturaTarihi: tarih,
        belgeNo, belgeTuru, faturaTuru,
        mukellef, firma,
        firmaKimlikNo, // Firma Hafizasi icin VKN/TCKN
        tutar, matrah, kdv,
        action, blokIndex, blokToplam,
      }),
    });
  }

  async function processBatch({ ay, mukellefler, action }) {
    setStatus(`${mukellefler.length} mükellef / ${ay} · ${action}`);
    // v1.14.1 — logEvent içinde global olarak okunsun (her event'e action eklensin)
    if (window.__morenAgent) window.__morenAgent.currentAction = action;
    for (const m of mukellefler) {
      if (window.__morenAgent.stopRequested) { setStatus('Durduruldu'); return; }
      setStatus(`→ ${m.ad}`);
      await processMukellef({ ay, mukellef: m, action });
    }
    setStatus(`Tamamlandı · ${counters.toplam} fatura`);
    if (window.__morenAgent) window.__morenAgent.currentAction = null;
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
          await sleep(1800); // React Router'ın render etmesini bekle
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
      await sleep(1200);
    }

    const seenFids = new Set();
    let initialCount = null;
    for (let i = 0; i < 600; i++) {
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
          await sleep(1500);
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
      if (initialCount && seenFids.size > initialCount + 5) {
        setStatus(`Başlangıç (${initialCount}) aşıldı, durduruldu`);
        return;
      }

      const meta = await getFaturaMeta(fid);
      const tarih = meta.tarih;
      const hedefAy = ay; // "2026-03"
      const ayUygun = tarih && String(tarih).startsWith(hedefAy);
      if (!ayUygun) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `tarih ${tarih} ≠ ${hedefAy}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
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
      if (isIsletme) {
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
          ustAiKullanildi = true;
          setStatus(`${mukellef.ad} · #${fid} Belge Türü AI…`);
          const kararBelge = await aiDecideIsletme({
            kayitOptions: ISLETME_BELGE_TURU_LIST,
            altOptions: [],
            tarih: meta.tarih, belgeNo: meta.belgeNo, belgeTuru: '', faturaTuru: ust.faturaTuru,
            mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma,
            firmaKimlikNo: meta.firmaKimlikNo, // Firma Hafizasi icin — mukellef-bazli ogrenme
            tutar: meta.tutar,
            action, blokIndex: 0, blokToplam: 0,
          });
          if (kararBelge?.emin && kararBelge.kayitTuru) {
            const ok = await pickAntSelectById('defterData_belgeTuru', kararBelge.kayitTuru);
            if (ok) {
              ust.belgeTuru = kararBelge.kayitTuru;
              ustOzet.push(`BT:${kararBelge.kayitTuru}`);
            }
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
        const blokLog = blok.detay.map((d, i) => `B${i + 1}:${(d.kayitDeger || '?').slice(0, 20)}/${(d.altDeger || '?').slice(0, 20)}`).join(' ');

        // --- 5) F2 ile kaydet ---
        try {
          let validationFailed = null;
          const waitSavedIsletme = async (timeoutMs) => {
            const t0 = Date.now();
            const minWaitMs = 5000;
            while (Date.now() - t0 < minWaitMs) {
              const validationMsg = validationDialogVarMi();
              if (validationMsg) {
                validationFailed = validationMsg;
                await handleDialogs();
                return false;
              }
              if (getVisibleModals().length > 0) {
                const r = await handleDialogs();
                if (r === 'resubmit') {
                  const res = await onaylaSonrasiF2(fid);
                  if (res === 'already-advanced') break;
                }
              }
              await sleep(250);
            }
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
                if (r === 'resubmit') {
                  const res = await onaylaSonrasiF2(fid);
                  if (res === 'already-advanced') continue;
                  continue;
                }
                await sleep(400);
                const m3 = location.href.match(/\/(\d+)\?count=/);
                if (m3 && m3[1] !== fid) return true;
              }
              await sleep(250);
            }
            return false;
          };

          await clickKaydetOnayla();
          let saved = await waitSavedIsletme(12000);
          if (!saved && !validationFailed) {
            await sleep(800);
            await clickKaydetOnayla();
            saved = await waitSavedIsletme(12000);
          }
          if (saved) {
            counters.onay++; counters.toplam++; setCount();
            const aiNot = aiKullanildi ? ` · AI` : '';
            const logMsg = `${mTag} · F2 · FatT:${ust.faturaTuru} BT:${ust.belgeTuru} AST:${ust.alisSatisTuru} · ${blokLog}${aiNot}`;
            await logEvent(mukellef.id, mukellef.ad, 'ok', logMsg, {
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar,
              aiOzet: aiOzet.length ? aiOzet.join(' · ') : undefined,
            });
          } else {
            counters.atla++; counters.toplam++; setCount();
            const atlamaSebebi = validationFailed
              ? `${mTag} · eksik alan (MIHSAP): ${validationFailed.slice(0, 60)}`
              : `${mTag} · İşletme F2 sonuçlanmadı`;
            await logEvent(mukellef.id, mukellef.ad, 'skip', atlamaSebebi, {
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar,
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
      const codes = await readHesapKodlari();
      if (!tumKodlarDolu(codes)) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'kod boş (hiç kod yok)', { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
        await clickIleri(fid); continue;
      }
      // Ekrandaki select'lerden herhangi biri boşsa (matrah/KDV/cari)
      if (bosSelectVarMi()) {
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
        if (action === 'isle_satis') {
          try {
            setStatus(`${mukellef.ad} · #${fid} AI öneri istiyor…`);
            const secenekler = await readBosAlanSecenekleri({ action, firmaAdi: meta.firma });
            const adetM = (secenekler.matrahKodlari || []).length;
            const adetK = (secenekler.kdvKodlari || []).length;
            const adetC = (secenekler.cariKodlari || []).length;

            // Hangi alanlar boş?
            const matrahBos = bolumHesapKoduDolu(/^Matrah\s*\(/i) === false || bolumHesapKoduDolu(/^Matrah$/i) === false;
            const vergiBos  = bolumHesapKoduDolu(/^Vergi\s*\(/i) === false || bolumHesapKoduDolu(/^KDV/i) === false || bolumHesapKoduDolu(/^Vergi$/i) === false;
            const cariBos   = bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) === false || bolumHesapKoduDolu(/^Cari Hesap$/i) === false || bolumHesapKoduDolu(/^Cari$/i) === false;
            const bosAlanlar = [matrahBos && 'Matrah', vergiBos && 'KDV', cariBos && 'Cari'].filter(Boolean);

            if (adetM + adetK + adetC > 0) {
              const oneriKarari = await aiDecide({
                codes: codes, tarih, hedefAy,
                belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
                mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tutar: meta.tutar,
                action, bosAlanSecenekleri: secenekler,
              });
              const o = oneriKarari?.onerilenler || {};
              const cf = o.confidence || {};
              const fmtC = (v) => typeof v === 'number' ? `%${Math.round(v * 100)}` : '?';
              console.log('[Moren] AI önerisi:', { secenekler, oneri: o });

              // Eşik kontrolü + doldurma
              const matrahDolu2 = bolumHesapKoduDolu(/^Matrah\s*\(/i) ?? bolumHesapKoduDolu(/^Matrah$/i);
              const vergiDolu2  = bolumHesapKoduDolu(/^Vergi\s*\(/i) ?? bolumHesapKoduDolu(/^KDV/i) ?? bolumHesapKoduDolu(/^Vergi$/i);
              const cariDolu2   = bolumHesapKoduDolu(/^Cari Hesap\s*\(/i) ?? bolumHesapKoduDolu(/^Cari Hesap$/i) ?? bolumHesapKoduDolu(/^Cari$/i);
              setStatus(`${mukellef.ad} · #${fid} alanlar dolduruluyor…`);
              const fillResult = await tryFillBosAlanlar({
                secenekler,
                oneri: o,
                durumlar: { matrahDolu: matrahDolu2, vergiDolu: vergiDolu2, cariDolu: cariDolu2 },
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
              satirlar.push('');

              if (fillResult.dolduruldu) {
                setStatus(`${mukellef.ad} · #${fid} F2 ile kaydediyor…`);
                await sleep(800);
                await pressF2Once();
                const t0 = Date.now();
                let kaydedildi = false;
                let validasyonHatasi = null;
                while (Date.now() - t0 < 12000) {
                  if (window.__morenAgent.stopRequested) return;
                  const m = location.href.match(/\/(\d+)\?count=/);
                  if (m && m[1] !== fid) { kaydedildi = true; break; }
                  if (/count=0/.test(location.href)) { kaydedildi = true; break; }
                  const vMsg = validationDialogVarMi();
                  if (vMsg) { validasyonHatasi = vMsg; await handleDialogs(); break; }
                  if (getVisibleModals().length > 0) await handleDialogs();
                  await sleep(300);
                }
                if (kaydedildi) {
                  satirlar.push('Sonuç: ✓ Doldurma başarılı, F2 ile otomatik kaydedildi');
                  counters.onay++; counters.toplam++; setCount();
                  await logEvent(mukellef.id, mukellef.ad, 'ok', satirlar.join('\n'),
                    { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
                  continue;
                }
                // F2 başarısız
                if (validasyonHatasi) {
                  satirlar.push(`Sonuç: ✗ Dolduruldu ama Mihsap kayıt etmedi`);
                  satirlar.push(`Mihsap uyarısı: "${validasyonHatasi.slice(0, 80)}"`);
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
      // LLM karar
      setStatus(`${mukellef.ad} · #${fid} Claude inceliyor…`);
      const decision = await aiDecide({
        codes, tarih, hedefAy,
        belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
        mukellef: mukellef.ad,
        mukellefId: mukellef.id, // Firma Hafizasi — mukellef-bazli ogrenme
        firma: meta.firma,
        firmaKimlikNo: meta.firmaKimlikNo,
        tutar: meta.tutar,
        action,
      });
      const karar = decision?.karar || 'emin_degil';
      const sebep = (decision?.sebep || '').slice(0, 120);
      // onay_bekliyor: AI karari gecmisle celisiyor, insan onayi bekler.
      // AUTO ONAY YAPMA, sadece ileri gec ve log'a dus.
      if (karar === 'onay_bekliyor') {
        counters.atla++; counters.toplam++; setCount();
        const sapma = (decision?.sapmaSebep || sebep || '').slice(0, 150);
        await logEvent(mukellef.id, mukellef.ad, 'skip',
          `⏸ Onay kuyruguna dustu: ${sapma}`,
          { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], kdv: readKdvOrani() });
        await clickIleri(fid); continue;
      }
      if (karar === 'atla' || karar === 'emin_degil') {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `${karar}: ${sebep}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], kdv: readKdvOrani() });
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
          const minWaitMs = 5000;
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
            await sleep(250);
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
              await sleep(400);
              const m3 = location.href.match(/\/(\d+)\?count=/);
              if (m3 && m3[1] !== fid) return true;
            }
            await sleep(250);
          }
          return false;
        };

        await clickKaydetOnayla();
        let saved = await waitSaved(12000);

        // Validation hatası varsa retry YAPMA (zaten alan eksik)
        if (!saved && !validationFailed) {
          await sleep(800);
          await clickKaydetOnayla();
          saved = await waitSaved(12000);
        }

        if (saved) {
          counters.onay++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'ok', `F2 · ${sebep}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], kdv: readKdvOrani() });
        } else {
          counters.atla++; counters.toplam++; setCount();
          const atlamaSebebi = validationFailed
            ? `eksik alan (MIHSAP): ${validationFailed.slice(0, 60)}`
            : `F2 sonuçlanmadı · ${sebep}`;
          await logEvent(mukellef.id, mukellef.ad, 'skip', atlamaSebebi, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], kdv: readKdvOrani() });
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
