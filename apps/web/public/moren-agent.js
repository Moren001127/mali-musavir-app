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
      if (window.__morenAgent.stopRequested) return;
      if (window.__lucaJobRunning) return;
      // 403 "cooldown" — token/deploy sorunu varsa polling'i yavaşlat
      if (window.__lucaAuthFailUntil && Date.now() < window.__lucaAuthFailUntil) return;

      const r = await fetch(API + '/agent/luca/jobs/pending', {
        headers: { 'X-Agent-Token': TOKEN },
      });
      if (r.status === 401 || r.status === 403) {
        // 2 dakika cooldown; kullanıcı token'ı düzelttiğinde manuel reload yapar
        window.__lucaAuthFailUntil = Date.now() + 2 * 60 * 1000;
        console.warn('[Moren] Luca agent ' + r.status + ' — token kabul edilmiyor, 2 dk beklenecek');
        return;
      }
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

          const blob = await fetchLucaMuavinExcel(job);
          if (!blob) throw new Error('Excel yakalanamadı');

          // Backend'e gönder — tip bazlı endpoint seçimi
          const fd = new FormData();
          fd.append('file', blob, `luca-${job.tip}-${job.donem}.xlsx`);
          let uploadUrl;
          if (job.tip === 'MIZAN') {
            // Mizan için özel endpoint — mizan tablosuna parse edilir
            const params = new URLSearchParams({
              mukellefId: job.mukellefId,
              donem: job.donem,
              donemTipi: 'AYLIK',
            });
            uploadUrl = `${API}/agent/luca/runner/upload-mizan?${params}`;
          } else {
            // KDV kontrol session için eski endpoint
            uploadUrl = `${API}/kdv-control/sessions/${job.sessionId}/excel-from-runner/${job.id}`;
          }
          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN },
            body: fd,
          });
          if (!uploadRes.ok) {
            const errBody = await uploadRes.text().catch(() => '');
            throw new Error(`Upload HTTP ${uploadRes.status}: ${errBody.slice(0, 120)}`);
          }
          // Mizan için job status done yapılmalı (KDV runner endpoint'i kendisi yapıyor)
          if (job.tip === 'MIZAN') {
            await fetch(API + `/agent/luca/jobs/${job.id}/done`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
              body: JSON.stringify({ recordCount: 0 }),
            }).catch(() => {});
          }
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
   * Luca'da mizan Excel'ini ÇEKER — TAM OTOMASYON (multi-frame + form POST).
   *
   * Luca v2.1 yapısı (DOM keşfiyle doğrulandı):
   *   - Multi-frame uygulama: top frame boş, asıl içerik iframe `frm3` içinde
   *   - Form: name="raporMizanForm" action="raporMizanAction.do" method=POST
   *   - Tarih input: name="tarih_ilk" / "tarih_son" (DD/MM/YYYY format)
   *   - Buton: <button class="green bold">Rapor</button>
   *   - Rapor Türü dropdown varsayılan "Excel Liste (xlsx)"
   *
   * Strateji: tüm iframe'leri tara → mizan formunu bul → tarihleri donem'e
   * göre ayarla → form action'a FormData ile POST → response.blob() = Excel.
   * Click YOK — yeni pencere açma riski yok.
   */
  async function fetchLucaMuavinExcel(job) {
    // 1) Multi-frame tarama
    const allDocs = [document];
    document.querySelectorAll('iframe, frame').forEach((iframe) => {
      try { if (iframe.contentDocument) allDocs.push(iframe.contentDocument); }
      catch (e) { /* cross-origin */ }
    });

    // 2) Mizan formunu bul (frm3'te olmalı)
    let mizanForm = null;
    let mizanDoc = null;
    for (const doc of allDocs) {
      const f = doc.querySelector(
        'form[name="raporMizanForm"], form[action*="raporMizan"], form[action*="mizan"]',
      );
      if (f) { mizanForm = f; mizanDoc = doc; break; }
    }
    if (!mizanForm) {
      throw new Error(
        'Luca\'da mizan formu (raporMizanForm) bulunamadı. ' +
          'Luca\'da Muhasebe → Mizan ekranını açıp tekrar deneyin.',
      );
    }
    console.log('[Moren] Luca mizan formu — action:', mizanForm.action);

    // 3) Tarihleri donem'e göre ayarla — "2026-03" → "01/03/2026" → "31/03/2026"
    const [year, month] = (job.donem || '').split('-');
    if (year && month) {
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const tarihIlk = `01/${month}/${year}`;
      const tarihSon = `${String(lastDay).padStart(2, '0')}/${month}/${year}`;
      const ilkInput = mizanDoc.querySelector('input[name="tarih_ilk"]');
      const sonInput = mizanDoc.querySelector('input[name="tarih_son"]');
      if (ilkInput) {
        ilkInput.value = tarihIlk;
        ilkInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (sonInput) {
        sonInput.value = tarihSon;
        sonInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      console.log('[Moren] Luca tarihleri:', tarihIlk, '→', tarihSon);
    }

    // 4) Rapor Türü dropdown — Excel olduğundan emin ol
    const raporTuruSelect = mizanDoc.querySelector(
      'select[name*="rapor"], select[name*="Rapor"], select[name*="tip"]',
    );
    if (raporTuruSelect) {
      const excelOpt = [...raporTuruSelect.options].find((o) =>
        /excel/i.test(o.text || o.value),
      );
      if (excelOpt && raporTuruSelect.value !== excelOpt.value) {
        raporTuruSelect.value = excelOpt.value;
        raporTuruSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 5) Form'u FormData ile direkt POST — click yok, yeni pencere yok
    const fd = new FormData(mizanForm);
    fd.delete('TARIH_ILK');  // eski uppercase boş alan override etmesin
    fd.delete('TARIH_SON');

    console.log('[Moren] Luca form POST →', mizanForm.action);
    const resp = await fetch(mizanForm.action, {
      method: (mizanForm.method || 'POST').toUpperCase(),
      body: fd,
      credentials: 'include',
    });

    if (!resp.ok) {
      throw new Error(`Luca rapor HTTP ${resp.status} ${resp.statusText}`);
    }

    const ct = resp.headers.get('content-type') || '';
    const blob = await resp.blob();
    console.log('[Moren] Luca Excel blob:', blob.size, 'bytes,', blob.type, 'ct:', ct);

    if (blob.size < 500) {
      throw new Error(
        'Luca boş yanıt (' + blob.size + ' byte) — Luca oturumu dolmuş olabilir, yeniden login olun',
      );
    }
    if (ct.includes('html') || ct.includes('text/plain')) {
      const txt = await blob.text();
      throw new Error('Luca HTML döndü (Excel değil): ' + txt.slice(0, 200));
    }
    return blob;
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
      await api('/agent/events/ingest', {
        method: 'POST',
        body: JSON.stringify({
          agent: 'mihsap',
          mukellef: mukellefAd,
          status,
          message: detail,
          firma: extra.firma || null,
          fisNo: extra.belgeNo || null,
          tutar: extra.tutar ? Number(extra.tutar) : null,
          hesapKodu: extra.hesapKodu || null,
          kdv: extra.kdv || null,
          meta: { mukellefId, ...extra },
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
      // Belge türü — 3 kanaldan ara: 1) API, 2) faturaTuru türetim, 3) DOM (işletme defteri için)
      let belgeTuru = v.belgeTuru || v.belgeTipi || v.belgeTipiKod || null;
      if (!belgeTuru) {
        const ft = String(v.faturaTuru || '').toUpperCase();
        if (ft.includes('EARSIV') || ft.includes('E_ARSIV') || ft.includes('ARSIV')) belgeTuru = 'E_ARSIV';
        else if (ft.includes('EFATURA') || ft.includes('E_FATURA') || ft.includes('E-FATURA') || ft === 'FATURA') belgeTuru = 'E_FATURA';
        else if (ft.includes('FIS') || ft.includes('ÖKC') || ft.includes('OKC')) belgeTuru = 'FIS';
        else if (ft.includes('IRSALIYE')) belgeTuru = 'IRSALIYE';
      }
      // Son çare — Mihsap ekranındaki defterData_belgeTuru select'inden oku
      if (!belgeTuru) {
        try {
          const sel = document.querySelector('#defterData_belgeTuru, [id*="belgeTuru"]');
          const span = sel?.querySelector('.ant-select-selection-item') ||
                       sel?.querySelector('.ant-select-selection-selected-value');
          const domVal = (span?.textContent || sel?.value || '').trim();
          if (domVal && domVal !== 'Seçiniz') belgeTuru = domVal;
        } catch {}
      }

      return {
        tarih,
        belgeNo: v.faturaNo || v.belgeNo || null,
        belgeTuru,
        faturaTuru: v.faturaTuru || null,
        tutar: v.toplamTutar || v.genelToplam || null,
        firma: v.faturaFirmaAdi || v.firmaUnvan || null,
        // Karşı firma VKN/TCKN — Firma Hafızası için. Mihsap API'de birkaç farklı isimde olabilir:
        firmaKimlikNo:
          v.faturaFirmaKimlikNo ||
          v.firmaKimlikNo ||
          v.karsiFirmaKimlikNo ||
          v.vergiKimlikNo ||
          v.vknTckn ||
          v.faturaFirmaVkn ||
          v.firmaVkn ||
          v.vkn ||
          v.tckn ||
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

  async function aiDecide({ codes, tarih, hedefAy, belgeNo, belgeTuru, faturaTuru, mukellef, firma, tutar, action, bosAlanSecenekleri }) {
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
  // AŞAMA 2a — AI Hesap Kodu Önerisi (Gölge Mod)
  // Bir bölümün (Matrah/Vergi/Cari) "Hesap Kodu" select'ini bulur.
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
      const hk = selects.find((s) => {
        const ph = s.querySelector('.ant-select-selection-placeholder');
        const phTxt = (ph?.textContent || '').trim();
        const it = s.querySelector('.ant-select-selection-item');
        const itTxt = (it?.textContent || '').trim();
        return /hesap kodu/i.test(phTxt) || /hesap kodu/i.test(itTxt) || /^\d{3}\.\d/.test(itTxt);
      });
      if (hk) return hk;
      container = container.parentElement;
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

    // Matrah: SATIŞ modunda 600/601/602 prefix'leriyle ara
    if (matrahDolu === false) {
      const sel = findHesapKoduSelect(/^Matrah\s*\(/i) || findHesapKoduSelect(/^Matrah$/i);
      if (sel) {
        const isSatis = action === 'isle_satis';
        // Sabit kıymet (253/254/255) KASTEN YOK — fatura içeriği demirbaş/araç/makine ise
        // AI bu koda yönlenmeyecek, zaten backend "Demirbaş → atla" diyecek.
        const prefixler = isSatis
          ? ['600', '601', '602']
          : ['153', '150', '152', '157', '740', '760', '770'];
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
    if (cariDolu === false) {
      const sel = findHesapKoduSelect(/^Cari Hesap\s*\(/i) || findHesapKoduSelect(/^Cari Hesap$/i) || findHesapKoduSelect(/^Cari$/i);
      if (sel && firmaAdi && firmaAdi.length >= 3) {
        // Firma adından ilk 3 anlamlı karakter (boşluk/noktalama olmayan)
        const temiz = firmaAdi.replace(/[^\wÇĞİÖŞÜçğıöşü\s]/g, '').trim();
        const ilkKelime = temiz.split(/\s+/)[0] || '';
        const anahtar = ilkKelime.slice(0, Math.min(8, ilkKelime.length));
        if (anahtar.length >= 3) {
          const opts = await searchAndReadOptions(sel, anahtar, 1800);
          console.log(`[Moren.debug] cari "${anahtar}" → ${opts.length} sonuç`, opts.slice(0, 3));
          const kodlar = opts.map(extractKod).filter((c) => /^\d{3}\.\w/.test(c));
          if (kodlar.length > 0) sonuc.cariKodlari = kodlar;
        }
      } else if (sel) {
        console.log('[Moren.debug] cari — firma adı yok veya çok kısa, atlandı');
      }
    }

    console.log('[Moren.debug] readBosAlanSecenekleri — SONUÇ:', sonuc);
    return sonuc;
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

  // === İşletme Defteri: Üst alan durumu oku (Fatura Türü / Belge Türü / Alış-Satış Türü) ===
  function isletmeUstAlanDurumu() {
    const read = (id) => getAntSelectValueById(id);
    return {
      faturaTuru: read('faturaTuru'),
      belgeTuru: read('defterData_belgeTuru'),
      alisSatisTuru: read('defterData_alisSatisTuru'),
    };
  }

  async function aiDecideIsletme({ kayitOptions, altOptions, tarih, belgeNo, belgeTuru, faturaTuru, mukellef, firma, tutar, matrah, kdv, action, blokIndex, blokToplam }) {
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
        mukellef, firma, tutar, matrah, kdv,
        action, blokIndex, blokToplam,
      }),
    });
  }

  async function processBatch({ ay, mukellefler, action }) {
    setStatus(`${mukellefler.length} mükellef / ${ay} · ${action}`);
    for (const m of mukellefler) {
      if (window.__morenAgent.stopRequested) { setStatus('Durduruldu'); return; }
      setStatus(`→ ${m.ad}`);
      await processMukellef({ ay, mukellef: m, action });
    }
    setStatus(`Tamamlandı · ${counters.toplam} fatura`);
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
        await logEvent(mukellef.id, mukellef.ad, 'skip', `tarih ${tarih} ≠ ${hedefAy}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
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
        // Boş → ata. Dolu ve farklı → ATLA (yanlış sınıflandırma yapma).
        const beklenenFaturaTuru = isAlis ? 'Gider' : 'Gelir';
        if (!ust.faturaTuru) {
          const ok = await pickAntSelectById('faturaTuru', beklenenFaturaTuru);
          if (!ok) {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Fatura Türü seçilemedi: ${beklenenFaturaTuru}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
            await clickIleri(fid); continue;
          }
          ustOzet.push(`FatT:${beklenenFaturaTuru}`);
          ust.faturaTuru = beklenenFaturaTuru;
        } else if (ust.faturaTuru !== beklenenFaturaTuru) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Fatura Türü hatalı: ${ust.faturaTuru} ≠ ${beklenenFaturaTuru}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
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
            mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tutar: meta.tutar,
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
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Belge Türü AI karar veremedi`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
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
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · Alış/Satış Türü seçilemedi: ${varsayilan}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
            await clickIleri(fid); continue;
          }
        }

        // --- 2) BLOK KONTROLÜ ---
        let blok = isletmeBlokDurumu();
        if (!blok.varMi) {
          counters.atla++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · İşletme: blok bulunamadı`, {
            firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
          });
          await clickIleri(fid); continue;
        }

        // --- 3) DOLU BLOK DOĞRULAMA (bilanço benzeri) ---
        // Dolu bloklar için logda detay göster: tarih/firma/belge no vb.
        // Matrah veya KDV 0 ise uyar ama atlamaz (geçerli olabilir)
        let doluKontrolHata = null;
        for (let bi = 0; bi < blok.detay.length; bi++) {
          const d = blok.detay[bi];
          if (d.kayitDolu && d.altDolu) {
            // Doğrulama: Kayıt Türü bilinen listede mi?
            if (!ISLETME_KAYIT_ALT_MAP[d.kayitDeger]) {
              doluKontrolHata = `B${bi + 1} bilinmeyen Kayıt Türü: ${d.kayitDeger}`;
              break;
            }
            // Doğrulama: K. Alt Türü, ilgili Kayıt Türü'nün listesinde mi?
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
            firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
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
                mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tutar: meta.tutar,
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
                mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tutar: meta.tutar,
                matrah: d.matrah, kdv: d.kdv,
                action, blokIndex: bi + 1, blokToplam: blok.detay.length,
              });
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
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
            });
            await clickIleri(fid); continue;
          }
          // Doldurma bitti — güncel durumu oku
          blok = isletmeBlokDurumu();
          if (!blok.varMi || blok.bosBlokVar) {
            counters.atla++; counters.toplam++; setCount();
            await logEvent(mukellef.id, mukellef.ad, 'skip', `${mTag} · AI sonrası hâlâ boş blok var`, {
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
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
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
              aiOzet: aiOzet.length ? aiOzet.join(' · ') : undefined,
            });
          } else {
            counters.atla++; counters.toplam++; setCount();
            // Daha açıklayıcı sebep üret — kullanıcı "neden atladı" anlasın
            let atlamaSebebi;
            if (validationFailed) {
              atlamaSebebi = `${mTag} · MIHSAP eksik alan: ${validationFailed.slice(0, 60)}`;
            } else if (aiHata) {
              atlamaSebebi = `${mTag} · AI karar veremedi: ${(aiHata || '').slice(0, 60)}`;
            } else if (sonBlokStat && sonBlokStat.includes('boş')) {
              atlamaSebebi = `${mTag} · Dolu alanlar eksik (Matrah/KDV/Cari kontrolü başarısız)`;
            } else {
              atlamaSebebi = `${mTag} · F2 sonrası Mihsap onay vermedi (uyarı modalı / duplicate / fatura bilgisi eksik)`;
            }
            await logEvent(mukellef.id, mukellef.ad, 'skip', atlamaSebebi, {
              firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
            });
            await clickIleri(fid);
          }
        } catch (e) {
          counters.hata++; counters.toplam++; setCount();
          await logEvent(mukellef.id, mukellef.ad, 'error', `${mTag} · ${String(e)}`, {
            firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma,
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
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'kod boş (hiç kod yok)', { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
        await clickIleri(fid); continue;
      }
      // Ekrandaki select'lerden herhangi biri boşsa (matrah/KDV/cari) → F2 denemeden atla
      if (bosSelectVarMi()) {
        // ================================================================
        // AŞAMA 2a (Gölge Mod) — SADECE Bilanço SATIŞ için:
        // Boş alanların dropdown seçeneklerini okuyup AI'a danış, öneriyi log'a yaz.
        // Gerçek uygulama yapmaz — yine atlar. Şu öneriler uygun mu değerlendiriyoruz.
        // ================================================================
        let aiOneriOzet = '';
        if (action === 'isle_satis') {
          try {
            setStatus(`${mukellef.ad} · #${fid} AI öneriyor (gölge)…`);
            const secenekler = await readBosAlanSecenekleri({ action, firmaAdi: meta.firma });
            const adetM = (secenekler.matrahKodlari || []).length;
            const adetK = (secenekler.kdvKodlari || []).length;
            const adetC = (secenekler.cariKodlari || []).length;
            if (adetM + adetK + adetC > 0) {
              const oneriKarari = await aiDecide({
                codes: codes, tarih, hedefAy,
                belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
                mukellef: mukellef.ad, mukellefId: mukellef.id, firma: meta.firma, firmaKimlikNo: meta.firmaKimlikNo, tutar: meta.tutar,
                action, bosAlanSecenekleri: secenekler,
              });
              const o = oneriKarari?.onerilenler || {};
              const cf = o.confidence || {};
              const fmtC = (v) => typeof v === 'number' ? `%${Math.round(v * 100)}` : '—';
              const parts = [];
              if (adetM > 0) parts.push(`M:${o.matrahHesapKodu || '—'}(${fmtC(cf.matrah)})`);
              if (adetK > 0) parts.push(`K:${o.kdvHesapKodu || '—'}(${fmtC(cf.kdv)})`);
              if (adetC > 0) parts.push(`C:${o.cariHesapKodu || '—'}(${fmtC(cf.cari)})`);
              aiOneriOzet = ` | AI öneri: ${parts.join(' ')} [seçenek sayısı: M=${adetM} K=${adetK} C=${adetC}]`;
              console.log('[Moren] AI hesap kodu önerisi (gölge mod):', { secenekler, oneri: o });
            } else {
              aiOneriOzet = ' | AI: dropdown seçeneği okunamadı';
            }
          } catch (e) {
            console.warn('[Moren] AI öneri hatası (gölge mod):', e?.message);
            aiOneriOzet = ` | AI hata: ${(e?.message || '').slice(0, 50)}`;
          }
        }
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `matrah/KDV/cari boş alan var${aiOneriOzet}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
        await clickIleri(fid); continue;
      }
      // LLM karar
      setStatus(`${mukellef.ad} · #${fid} Claude inceliyor…`);
      const decision = await aiDecide({
        codes, tarih, hedefAy,
        belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
        mukellef: mukellef.ad,
        mukellefId: mukellef.id,
        firma: meta.firma,
        firmaKimlikNo: meta.firmaKimlikNo,
        tutar: meta.tutar,
        action,
      });
      const karar = decision?.karar || 'emin_degil';
      const sebep = (decision?.sebep || '').slice(0, 120);
      if (karar === 'atla' || karar === 'emin_degil') {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `${karar}: ${sebep}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma, hesapKodu: codes[0], kdv: readKdvOrani() });
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
          await logEvent(mukellef.id, mukellef.ad, 'ok', `F2 · ${sebep}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma, hesapKodu: codes[0], kdv: readKdvOrani() });
        } else {
          counters.atla++; counters.toplam++; setCount();
          const atlamaSebebi = validationFailed
            ? `eksik alan (MIHSAP): ${validationFailed.slice(0, 60)}`
            : `F2 sonuçlanmadı · ${sebep}`;
          await logEvent(mukellef.id, mukellef.ad, 'skip', atlamaSebebi, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma, hesapKodu: codes[0], kdv: readKdvOrani() });
          await clickIleri(fid);
        }
      } catch (e) {
        counters.hata++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'error', String(e), { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, tarih: meta.tarih, belgeTuru: meta.belgeTuru, cari: meta.firma });
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
