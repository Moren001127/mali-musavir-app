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

          // ─── ERKEN FİRMA KONTROLÜ (Luca'dan veri çeken tüm job'lar için) ───
          // /start çağrılmadan ÖNCE Luca'da doğru firma seçili mi kontrol et.
          // Yanlışsa firma değiştir → sayfa yenilenir → bu agent ölür →
          // job pending'de kaldığı için yeni agent aynı job'u tekrar yakalar.
          // Kapsam: e-arşiv + e-fatura + mizan + kdv kontrol + tüm Luca veri çekmeleri
          const isLucaDataJob = [
            'EARSIV_SATIS','EARSIV_ALIS','EFATURA_SATIS','EFATURA_ALIS',
            'MIZAN','KDV_KONTROL','KDV1','KDV2','MUAVIN','ISLETME','GELIR_TABLOSU','BILANCO'
          ].includes(job.tip);
          if (isLucaDataJob) {
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
                    await sleep(15000);
                    window.__lucaJobRunning = false;
                    return;
                  }
                }
              }
            }
          }

          await fetch(API + `/agent/luca/jobs/${job.id}/start`, {
            method: 'POST',
            headers: { 'X-Agent-Token': TOKEN },
          });

          // İlk log: agent versiyonunu portal'a bildir (cache problemini debug için)
          const AGENT_VER = '1.35.3';
          // Job log helper — kullanıcıya canlı progress göster
          // Backend `body.msg` bekliyor (luca.controller.ts logJob endpoint).
          // Global log buffer — kullanıcı DevTools Console'da
          //    copy(window.__morenLogs.join('\n'))
          // ile bütün log'u bir seferde clipboard'a alabilir.
          window.__morenLogs = window.__morenLogs || [];
          const log = async (line) => {
            try {
              const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
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
          await log(`🤖 Moren Agent v${AGENT_VER} | URL=${location.href.slice(0, 80)}`);

          // ─── Job tipine göre rapor sayfası kontrolü ───
          // MIZAN          → Luca'da Mizan ekranı açık olmalı
          // KDV_191/KDV_391 → Defteri Kebir (Tüm Yazıcılar) ekranı + hesap kodu girilmiş
          // ISLETME_GELIR/GIDER → İşletme defteri ekranı
          const tipLabel = {
            MIZAN: 'Mizan ekranı (Genel Raporlar > Mizan)',
            KDV_MIZAN: 'KDV Beyanname için Mizan ekranı',
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

          const blob = await fetchLucaMuavinExcel(job, log);
          if (!blob) throw new Error('Excel yakalanamadı');
          await log(`📥 Excel indirildi (${Math.round(blob.size / 1024)} KB)`);

          // ─── Tipine göre upload endpoint ───
          const fd = new FormData();
          const isZipJob = ['EARSIV_SATIS','EARSIV_ALIS','EFATURA_SATIS','EFATURA_ALIS'].includes(job.tip);
          fd.append('file', blob, `luca-${job.tip}-${job.donem}.${isZipJob ? 'zip' : 'xlsx'}`);

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
          } else if (job.tip === 'KDV_MIZAN') {
            // KDV beyanname için bağımsız mizan snapshot — mizan flow'u aynı, upload yolu farklı
            const params = new URLSearchParams({
              mukellefId: String(job.mukellefId || ''),
              donem: String(job.donem || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-kdv-mizan?${params.toString()}`;
          } else if (job.tip === 'IHO_FETCH') {
            // İşletme Hesap Özeti — sessionId = İHÖ kayıt id'si
            const params = new URLSearchParams({
              ihoId: String(job.sessionId || ''),
              jobId: job.id,
            });
            uploadUrl = `${API}/agent/luca/runner/upload-iho?${params.toString()}`;
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
    // MIZAN ve KDV_MIZAN aynı Luca ekranını kullanır (Mizan ekranı, tüm hesaplar)
    // Sadece backend'de farklı tabloya yazılır (Mizan vs KdvLucaSnapshot)
    if (job.tip === 'MIZAN' || job.tip === 'KDV_MIZAN') {
      return await fetchLucaMizanExcel(job, log);
    }
    if (job.tip === 'KDV_191' || job.tip === 'KDV_391') {
      const hesap = job.tip === 'KDV_191' ? '191' : '391';
      return await fetchLucaDefteriKebirExcel(job, log, hesap);
    }
    if (job.tip === 'ISLETME_GELIR' || job.tip === 'ISLETME_GIDER') {
      const mode = job.tip === 'ISLETME_GELIR' ? 'gelir' : 'gider';
      return await fetchLucaIsletmeGelirGiderExcel(job, log, mode);
    }
    if (job.tip === 'EARSIV_SATIS' || job.tip === 'EARSIV_ALIS' ||
        job.tip === 'EFATURA_SATIS' || job.tip === 'EFATURA_ALIS') {
      return await fetchLucaEarsivZip(job, log);
    }
    // Bilinmeyen tip için fallback
    return await fetchLucaGenericExcel(job, log);
  }

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

    const start = Date.now();
    while (Date.now() - start < maxMs) {
      for (const doc of collectAllDocs()) {
        try {
          // Sadece text içeren küçük element'leri (< 4 child) tara
          for (const el of doc.querySelectorAll('a, span, div, td, li, p, button, label')) {
            // Görünür mü? (offsetParent null = display:none / hidden)
            if (el.offsetParent === null && el.tagName !== 'A') continue;
            const t = norm(el.textContent || '');
            if (!t) continue;
            const match = exact ? (t === target) : (t === target || t.includes(target));
            if (match) {
              await log(`🖱 "${text}" tıklanıyor (${el.tagName})`);
              const view = doc.defaultView || window;
              const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
              const x = rect ? (rect.left + rect.width / 2) : 0;
              const y = rect ? (rect.top + rect.height / 2) : 0;
              const fire = (type) => {
                try {
                  el.dispatchEvent(new MouseEvent(type, {
                    bubbles: true, cancelable: true, view,
                    clientX: x, clientY: y, button: 0,
                  }));
                } catch {}
              };
              // Hover + click kombini (Luca menüleri bazen mouseover bekler)
              fire('mouseover');
              fire('mouseenter');
              fire('mousemove');
              await sleep(150);
              try { el.click(); } catch {}
              fire('mousedown');
              fire('mouseup');
              fire('click');
              await sleep(1000);
              return true;
            }
          }
        } catch {}
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
        await sleep(15000);
        throw new Error(`Firma değiştirildi ama sayfa yenilenmedi`);
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

  async function fetchLucaEarsivZip(job, log) {
    const donemStr = String(job.donem || ''); // "YYYY-MM"
    const [yilS, ayS] = donemStr.split('-');
    const yil = Number(yilS);
    const ay = Number(ayS);
    if (!yil || !ay || ay < 1 || ay > 12) {
      throw new Error(`Geçersiz dönem formatı: ${donemStr}, beklenen: YYYY-MM`);
    }

    // mukellefAdi backend tarafından job.errorMsg'e [META] formatında eklendi
    let mukellefAdi = '';
    try {
      const m = String(job.errorMsg || '').match(/\[META\] mukellefAdi=(.+?)(\n|$)/);
      if (m) mukellefAdi = m[1].trim();
    } catch {}

    // Firma + yıl seçimini yap (kullanıcı yanlış firmadaysa düzelt)
    await selectLucaSirketDonem(mukellefAdi, yil, log);

    // job.tip → açılacak menü item'ı
    const menuLabel = {
      EARSIV_SATIS: 'e-Arşiv Satış Faturaları',
      EARSIV_ALIS: 'e-Arşiv Alış Faturaları',
      EFATURA_SATIS: 'e-Fatura Satış Faturaları',
      EFATURA_ALIS: 'e-Fatura Alış Faturaları',
    }[job.tip];
    if (!menuLabel) throw new Error(`Bilinmeyen e-arşiv tipi: ${job.tip}`);

    // Her zaman doğru sayfayı II1a ile aç — "faturalari-getir-btn" hem alış hem satışta
    // var olduğu için sayfa kontrolü güvenilir değil. Yanlış sayfada olabiliriz.
    let frm3 = getLucaFrame('frm3');
    {
      // Kullanıcı keşfinde bulunan direct II1a ID'leri (menü tıklama gerek yok!):
      //   e-Arşiv Satış Faturaları   → apy1000m24i10I
      //   e-Arşiv Alış Faturaları    → apy1000m24i11I
      //   e-Fatura Alış Faturaları   → apy1000m24i17I
      //   e-Fatura Satış Faturaları  → apy1000m24i18I
      const ii1aId = {
        EARSIV_SATIS: 'apy1000m24i10I',
        EARSIV_ALIS: 'apy1000m24i11I',
        EFATURA_ALIS: 'apy1000m24i17I',
        EFATURA_SATIS: 'apy1000m24i18I',
      }[job.tip];
      if (!ii1aId) throw new Error(`Bilinmeyen tip için II1a id yok: ${job.tip}`);

      await log(`🧭 II1a('${ii1aId}') aranıyor → ${menuLabel}`);
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
      let basariliAcildi = false;
      if (II1aFn) {
        await log(`🧭 II1a bulundu (${II1aSrc}) — ${ii1aId} çağrılıyor`);
        try {
          // Sahte event obj — bazı Luca buildlerinde gerek
          const fakeEvent = {
            type: 'click', target: null, currentTarget: null, srcElement: null,
            preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => {},
            returnValue: true, cancelBubble: false,
          };
          II1aFn(fakeEvent, ii1aId, '');
          basariliAcildi = true;
        } catch (e) {
          await log(`⚠ II1a('${ii1aId}') başarısız: ${e?.message || e} — fallback: text-based menü click`);
          basariliAcildi = false;
        }
      }
      if (!basariliAcildi) {
        // Fallback: menüleri sırayla açıp elementi click et
        await log('🔄 Text-based menü navigasyonu (yedek plan)');
        await clickByTextEverywhere('Muhasebe', log, { maxMs: 5000 });
        await sleep(1200);
        await clickByTextEverywhere('Akıllı Entegrasyon Noktası', log, { maxMs: 5000 });
        await sleep(2000);
        await clickByTextEverywhere(menuLabel, log, { maxMs: 8000 });
      }
      await log('⏳ Sayfa yüklenmesi bekleniyor (6sn)…');
      await sleep(6000);
      // frm3'ü tekrar al (yeniden yüklenmiş olabilir)
      frm3 = getLucaFrame('frm3');
      // Sayfa açıldığını doğrula
      if (!frm3 || !frm3.contentDocument || !frm3.contentDocument.getElementById('faturalari-getir-btn')) {
        await log('⚠ Sayfa hala açılmadı — 4sn ek bekleme');
        await sleep(4000);
        frm3 = getLucaFrame('frm3');
      }
    }

    // Tarih hesaplayıcı: ayın son günü, sonraki ay başı, bugün
    const ayinSonGunu = (y, m) => new Date(y, m, 0).getDate(); // m=1-12, son gün
    const fmt = (d, m, y) => `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;

    const sorgu1Bas = fmt(1, ay, yil);
    const sorgu1Bit = fmt(ayinSonGunu(yil, ay), ay, yil);

    // Sonraki ay (yıl sonu kuralı)
    const sonAy = ay === 12 ? 1 : ay + 1;
    const sonYil = ay === 12 ? yil + 1 : yil;
    const bugun = new Date();
    const sorgu2Gerekli =
      bugun >= new Date(sonYil, sonAy - 1, 1) &&
      bugun <= new Date(sonYil, sonAy - 1, ayinSonGunu(sonYil, sonAy));
    const sorgu2Bas = fmt(1, sonAy, sonYil);
    const sorgu2Bit = fmt(bugun.getDate(), bugun.getMonth() + 1, bugun.getFullYear());

    await log(`📅 Sorgu 1: ${sorgu1Bas} → ${sorgu1Bit}`);
    if (sorgu2Gerekli) await log(`📅 Sorgu 2: ${sorgu2Bas} → ${sorgu2Bit}`);

    // frm3 frame'ini doğrula (yukarıdaki menü navigasyonu ile yüklendi)
    if (!frm3 || !frm3.contentDocument) {
      throw new Error('frm3 (e-Arşiv ekranı) yüklenemedi — menü açılmamış olabilir');
    }
    const fdoc = frm3.contentDocument;
    const fwin = frm3.contentWindow;

    // ZIP intercept: fetch + XHR + window.open + anchor download'ı monkey-patch et
    // (Luca native browser download tetikleyebiliyor — onu da yakalamamız lazım)
    let yakalanmisZip = null;
    let zipNetworkInFlight = false; // Bir istek başladı mı? (re-click'i durdurmak için)
    const origFetch = fwin.fetch;
    const origXHROpen = fwin.XMLHttpRequest.prototype.open;
    const origXHRSend = fwin.XMLHttpRequest.prototype.send;
    const origWindowOpen = fwin.open ? fwin.open.bind(fwin) : null;
    const origCreateElement = fwin.document.createElement.bind(fwin.document);

    // window.open hijack: ZIP/INDIR URL'lerinde popup açmak yerine biz fetch edip blob'u alıyoruz
    fwin.open = function(url, ...rest) {
      try {
        const u = String(url || '').toLowerCase();
        if (u && (u.includes('zip') || u.includes('indir') || u.includes('download'))) {
          zipNetworkInFlight = true;
          // Ayrı bir fetch ile ZIP'i biz alalım — popup açma
          (async () => {
            try {
              const absUrl = new URL(url, fwin.location.href).toString();
              const res = await origFetch.call(fwin, absUrl, { credentials: 'include' });
              const blob = await res.blob();
              if (blob && blob.size > 100) {
                yakalanmisZip = blob;
                log(`📥 ZIP yakalandı (window.open hijack ${absUrl.slice(0,60)}, ${Math.round(blob.size/1024)} KB)`).catch(() => {});
              }
            } catch (e) {
              log(`⚠ window.open hijack fetch hatası: ${e?.message || e}`).catch(() => {});
            }
          })();
          // Popup açma — null dön (Luca'nın akışı bozulabilir, ama indirme zaten bizim elimizde)
          return null;
        }
      } catch {}
      return origWindowOpen ? origWindowOpen(url, ...rest) : null;
    };

    // <a> oluşturma hijack: download attribute'lu anchor click'ini yakala
    fwin.document.createElement = function(tagName) {
      const el = origCreateElement(tagName);
      if (String(tagName).toLowerCase() === 'a') {
        // click() metodunu wrap et
        const origClick = el.click.bind(el);
        el.click = function() {
          try {
            const href = String(this.href || '').toLowerCase();
            const dl = this.getAttribute('download');
            if ((dl !== null) || href.includes('zip') || href.includes('indir') || href.includes('download')) {
              zipNetworkInFlight = true;
              (async () => {
                try {
                  const res = await origFetch.call(fwin, this.href, { credentials: 'include' });
                  const blob = await res.blob();
                  if (blob && blob.size > 100) {
                    yakalanmisZip = blob;
                    log(`📥 ZIP yakalandı (anchor click hijack ${String(this.href).slice(0,60)}, ${Math.round(blob.size/1024)} KB)`).catch(() => {});
                  }
                } catch (e) {
                  log(`⚠ anchor hijack fetch hatası: ${e?.message || e}`).catch(() => {});
                }
              })();
              return; // Native click'i tetikleme — browser download başlatmasın
            }
          } catch {}
          return origClick();
        };
      }
      return el;
    };

    fwin.fetch = async function(...args) {
      try {
        const url = String(args[0] && args[0].url || args[0] || '').toLowerCase();
        if (url.includes('zip') || url.includes('indir')) zipNetworkInFlight = true;
      } catch {}
      const res = await origFetch.apply(this, args);
      try {
        const ct = res.headers.get('content-type') || '';
        const cd = res.headers.get('content-disposition') || '';
        if (ct.includes('zip') || cd.includes('.zip') || ct.includes('octet-stream')) {
          const cloned = res.clone();
          const blob = await cloned.blob();
          if (blob && blob.size > 100) {
            yakalanmisZip = blob;
            await log(`📥 ZIP yakalandı (fetch, ${Math.round(blob.size/1024)} KB)`);
          }
        }
      } catch {}
      return res;
    };

    // XHR intercept (Luca jQuery $.ajax kullanıyor olabilir)
    fwin.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__url = url;
      this.__method = method;
      return origXHROpen.call(this, method, url, ...rest);
    };
    fwin.XMLHttpRequest.prototype.send = function(...args) {
      try {
        const url = String(this.__url || '').toLowerCase();
        if (url.includes('zip') || url.includes('indir')) {
          zipNetworkInFlight = true;
          try { this.responseType = 'blob'; } catch {}
          this.addEventListener('load', () => {
            try {
              const blob = this.response;
              if (blob && blob.size > 100) {
                const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
                const cd = (this.getResponseHeader('content-disposition') || '').toLowerCase();
                if (ct.includes('zip') || ct.includes('octet-stream') || cd.includes('.zip') || (blob.type && blob.type.includes('zip'))) {
                  yakalanmisZip = blob;
                  log(`📥 ZIP yakalandı (XHR ${this.__method} ${url.slice(0,60)}, ${Math.round(blob.size/1024)} KB)`).catch(() => {});
                }
              }
            } catch {}
          }, { once: true });
        }
      } catch {}
      return origXHRSend.apply(this, args);
    };

    // İki sorgu yap — her birinde modal aç → tarih yaz → Belgeleri Getir → bekle
    async function birSorgu(bas, bit, etiket) {
      await log(`🔍 ${etiket}: ${bas} → ${bit}`);
      // Modal aç
      if (typeof fwin.gonder === 'function') {
        fwin.gonder('indir-window');
      } else {
        throw new Error('window.gonder fonksiyonu yok — Luca sayfası beklenen yapıda değil');
      }
      await sleep(800); // modal animasyonu

      // Tarih input'larını doldur (tarih1, tarih2)
      const t1 = fdoc.getElementById('tarih1');
      const t2 = fdoc.getElementById('tarih2');
      if (!t1 || !t2) throw new Error('tarih1/tarih2 input bulunamadı');
      t1.value = bas;
      t1.dispatchEvent(new Event('change', { bubbles: true }));
      t2.value = bit;
      t2.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);

      // Belgeleri Getir butonu
      const getirBtn = fdoc.getElementById('faturalari-getir-btn');
      if (!getirBtn) throw new Error('faturalari-getir-btn bulunamadı');
      getirBtn.click();
      await log(`⏳ Belgeleri Getir tıklandı, sonuçlar bekleniyor (${etiket})…`);

      // İşlem Takip popup'ı açılır, GİB sorgu yapar (~8sn). Sonra Kapat butonu ile kapat.
      await sleep(8000);

      // Tüm frame'lerde "Kapat" butonunu bul ve tıkla (İşlem Takip popup)
      const findAndClick = (label) => {
        const allDocs = [document];
        try {
          for (const fr of document.querySelectorAll('frame, iframe')) {
            if (fr.contentDocument) allDocs.push(fr.contentDocument);
          }
        } catch {}
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
      await sleep(1500);
    }

    await birSorgu(sorgu1Bas, sorgu1Bit, 'Sorgu 1 (ay)');
    if (sorgu2Gerekli) {
      await birSorgu(sorgu2Bas, sorgu2Bit, 'Sorgu 2 (sonraki ay başı→bugün)');
    }

    // Tümünü Seç
    const tumBtn = fdoc.getElementById('tum_belgeyi_sec_btn');
    if (tumBtn) {
      tumBtn.click();
      await log('✓ Tümünü Seç tıklandı');
      await sleep(500);
    } else {
      await log('⚠ tum_belgeyi_sec_btn bulunamadı (belki sayfada başka isimle)');
    }

    // Seçilenleri İndir (ALT TOOLBAR) → ZIP popup açılır
    if (typeof fwin.gonder === 'function') {
      fwin.gonder('zip-window');
      await log('📦 Alt toolbar "Seçilenleri İndir" tetiklendi → popup açılıyor');
    } else {
      throw new Error('zip-window gonder yok');
    }

    // Popup açılma animasyonunu bekle
    await sleep(1500);

    // POPUP içindeki elementleri bul (buraya linki + Seçilenleri İndir butonu)
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

    // Popup container'ını bul: GİB E-BELGE + İNDİR + BURAYA içeren EN İÇTEKİ container
    // (toolbar'dan başlayıp aramayalım — popup'ın kendisini bulalım)
    const findPopupContainer = () => {
      for (const d of collectAllDocsForPopup()) {
        try {
          // Önce bilinen ID/class'ları dene
          for (const sel of ['#zip-window', '.zip-window', '#popup-zip',
                             'div[id*="zip"]', 'div[id*="indir"]', 'div[id*="zipWin"]']) {
            const c = d.querySelector(sel);
            if (c && c.offsetParent !== null) {
              const ct = (c.textContent || '').toLocaleUpperCase('tr-TR');
              if (ct.includes('BURAYA') && (ct.includes('İNDİR') || ct.includes('INDIR'))) {
                return { container: c, doc: d, hint: `id-selector:${sel}` };
              }
            }
          }
          // Fallback: text içeriğine göre bul (popup'a özgü kelimeler)
          for (const c of d.querySelectorAll('div, section, article, form')) {
            if (c.offsetParent === null) continue;
            const ct = (c.textContent || '').toLocaleUpperCase('tr-TR');
            // Tam popup metnini içermeli ama ÇOK BÜYÜK olmamalı (body değil)
            if (ct.includes('BURAYA') &&
                (ct.includes('TÜM FATURALARI') || ct.includes('TUM FATURALARI')) &&
                (ct.includes('ONAYLANMIŞ') || ct.includes('ONAYLANMIS')) &&
                (ct.length < 4000)) {
              return { container: c, doc: d, hint: 'text-content-match' };
            }
          }
        } catch {}
      }
      return null;
    };

    // 1) "buraya tıklayınız" linkini click et (Tüm faturaları seçmek için BURAYA)
    let popupInfo = null;
    const popupSearchStart = Date.now();
    while (Date.now() - popupSearchStart < 5000 && !popupInfo) {
      popupInfo = findPopupContainer();
      if (!popupInfo) await sleep(300);
    }

    if (popupInfo) {
      await log(`📍 Popup container bulundu (${popupInfo.hint})`);
      // İlk "buraya" linkini (Tüm faturaları seçmek için) click et
      try {
        const burayaLinks = [];
        for (const a of popupInfo.container.querySelectorAll('a, span[onclick], div[onclick], button')) {
          const t = ((a.textContent || a.value || '').trim()).toLocaleLowerCase('tr-TR');
          if (t === 'buraya' || t.startsWith('buraya')) {
            if (a.offsetParent !== null || a.tagName === 'A') {
              burayaLinks.push(a);
            }
          }
        }
        if (burayaLinks.length > 0) {
          const ilkBuraya = burayaLinks[0];
          try { ilkBuraya.click(); } catch {}
          try {
            ilkBuraya.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: popupInfo.doc.defaultView }));
          } catch {}
          const oc = ilkBuraya.getAttribute('onclick');
          if (oc) {
            try { new popupInfo.doc.defaultView.Function('event', oc).call(ilkBuraya, new popupInfo.doc.defaultView.Event('click')); } catch {}
          }
          await log(`✓ Popup "buraya" link tıklandı (Tüm faturaları seç)`);
          await sleep(800); // Selection state'in propagate olması için
        } else {
          await log('ℹ Popup "buraya" linki bulunamadı (gerekli olmayabilir)');
        }
      } catch (e) {
        await log(`⚠ "buraya" link click hatası: ${e?.message || e}`);
      }
    } else {
      await log('⚠ Popup container bulunamadı — fallback ile butonu arayacağız');
    }

    // 2) Popup içindeki "Seçilenleri İndir" butonunu bul + tekrar tekrar tıkla (poll)
    const findPopupDownloadButton = () => {
      // Önce popup container'ı varsa ORADA ara (kesin)
      if (popupInfo) {
        for (const b of popupInfo.container.querySelectorAll('button, input[type=button], input[type=submit], a, span[onclick], div[onclick]')) {
          const t = ((b.textContent || b.value || '').trim()).toLocaleLowerCase('tr-TR');
          if ((t === 'seçilenleri indir' || t === 'secilenleri indir' || t.includes('seçilenleri indir') || t.includes('secilenleri indir'))
              && (b.offsetParent !== null || b.tagName === 'A')) {
            return { btn: b, strategy: 'inside-popup-container' };
          }
        }
      }
      // Fallback: tüm dokümanlarda ara, koordinat ile en üsttekini al (popup ortadaysa)
      for (const d of collectAllDocsForPopup()) {
        const matches = [];
        for (const b of d.querySelectorAll('button, input[type=button], input[type=submit], a, span[onclick], div[onclick]')) {
          const t = ((b.textContent || b.value || '').trim()).toLocaleLowerCase('tr-TR');
          if (t !== 'seçilenleri indir' && t !== 'secilenleri indir') continue;
          if (b.offsetParent === null && b.tagName !== 'A') continue;
          const r = b.getBoundingClientRect ? b.getBoundingClientRect() : { top: 0 };
          matches.push({ b, top: r.top });
        }
        if (matches.length >= 2) {
          // Birden fazla varsa popup üstte (top değeri küçük), toolbar altta
          matches.sort((a, b) => a.top - b.top);
          return { btn: matches[0].b, strategy: 'topmost-of-multiple' };
        } else if (matches.length === 1) {
          return { btn: matches[0].b, strategy: 'single-match' };
        }
      }
      return null;
    };

    const clickPopupBtnAggressively = (btn) => {
      try {
        const view = btn.ownerDocument.defaultView || fwin || window;
        const r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
        const x = r ? r.left + r.width / 2 : 0;
        const y = r ? r.top + r.height / 2 : 0;
        const fire = (type) => {
          try {
            btn.dispatchEvent(new MouseEvent(type, {
              bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: 0,
            }));
          } catch {}
        };
        fire('mouseover');
        fire('mouseenter');
        fire('mousedown');
        fire('mouseup');
        try { btn.click(); } catch {}
        fire('click');
        // jQuery handler trigger (Luca jQuery kullanıyor)
        try {
          const $ = view.jQuery || view.$;
          if ($) {
            $(btn).trigger('click');
            $(btn).click();
          }
        } catch {}
        // onclick attribute'unu da elle çağır
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr) {
          try { new view.Function('event', onclickAttr).call(btn, new view.Event('click')); } catch {}
        }
        // Form içindeyse submit dene
        try {
          const form = btn.closest('form');
          if (form && typeof form.submit === 'function') {
            // submit etmeyelim, sadece dispatch edelim — Luca handler handle eder
            form.dispatchEvent(new view.Event('submit', { bubbles: true, cancelable: true }));
          }
        } catch {}
      } catch {}
    };

    // TEK TIK STRATEJİSİ: bir kez tıkla, sonra sadece bekle (zipNetworkInFlight ya da
    // yakalanmisZip izlenir). Sadece 8sn boyunca hiçbir network isteği başlamazsa
    // "click iletmedi" sayıp bir kez daha denenir (max 2 click toplam).
    let popupClicked = 0;
    let popupClickStrategy = '';
    const zipWaitStart = Date.now();
    const ZIP_TIMEOUT_MS = 60000;

    // İlk tıklama: butonu bul ve hemen click et
    {
      const firstStart = Date.now();
      while (Date.now() - firstStart < 4000 && popupClicked === 0) {
        const found = findPopupDownloadButton();
        if (found) {
          clickPopupBtnAggressively(found.btn);
          popupClicked = 1;
          popupClickStrategy = found.strategy;
          await log(`✓ Popup "Seçilenleri İndir" tıklandı (strategy: ${found.strategy})`);
          break;
        }
        await sleep(300);
      }
      if (popupClicked === 0) {
        await log('⚠ Popup butonu bulunamadı (4sn poll), ZIP yine de geliyorsa yakalanır');
      }
    }

    // Bekleme: ZIP gelene kadar (max 60sn). Eğer 8sn boyunca hiçbir network isteği
    // başlamazsa (zipNetworkInFlight=false) ve hala click yetersizse 1 kez daha tıkla.
    let extraClickDone = false;
    while (Date.now() - zipWaitStart < ZIP_TIMEOUT_MS) {
      if (yakalanmisZip) break;
      if (!extraClickDone && !zipNetworkInFlight && Date.now() - zipWaitStart > 8000 && popupClicked > 0) {
        const found = findPopupDownloadButton();
        if (found) {
          clickPopupBtnAggressively(found.btn);
          popupClicked++;
          await log(`🔁 8sn'de network başlamadı, "Seçilenleri İndir" 1 kez daha tıklandı`);
          extraClickDone = true;
        }
      }
      await sleep(500);
    }

    // Patch'leri geri al
    fwin.fetch = origFetch;
    fwin.XMLHttpRequest.prototype.open = origXHROpen;
    fwin.XMLHttpRequest.prototype.send = origXHRSend;
    if (origWindowOpen) fwin.open = origWindowOpen;
    fwin.document.createElement = origCreateElement;

    if (!yakalanmisZip) {
      throw new Error(`ZIP 45sn içinde yakalanamadı (popup butonuna ${popupClicked} kez tıklandı, strategy: ${popupClickStrategy || 'bulunamadı'})`);
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
    const { nth = 1, maxMs = 8000 } = opts;
    await log(`🔍 Sağ menüde "${text}" aranıyor (${nth}. occurrence)...`);
    const found = await waitUntil(() => {
      const candidates = ['frm5', 'frm2', 'frm3', 'frm6', 'frm7', 'frm1', 'frm4'];
      const matches = [];
      for (const fname of candidates) {
        const f = getLucaFrame(fname);
        if (!f || !f.contentDocument) continue;
        for (const el of f.contentDocument.querySelectorAll('*')) {
          if ((el.textContent || '').trim() === text && el.children.length === 0) {
            matches.push({ el, frame: f, frameName: fname });
          }
        }
      }
      return matches.length >= nth ? matches[nth - 1] : null;
    }, maxMs);

    if (!found) {
      throw new Error(`Sağ menüde "${text}" (${nth}. occurrence) bulunamadı — Fiş Listesi sayfası açık mı?`);
    }
    await log(`🖱 "${text}" tıklanıyor (${found.frameName} → ${found.el.tagName})`);
    let cur = found.el;
    const view = found.frame.contentWindow || found.frame;
    for (let i = 0; i < 5 && cur; i++) {
      try {
        cur.click();
        cur.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view }));
      } catch {}
      cur = cur.parentElement;
    }
    await sleep(1500);
  }

  /**
   * frm3'te (veya herhangi bir frame'de) form aranır — formNamePattern regex ile
   * eşleşen ilk form'u döndürür. İlk koşumda form bulunamazsa tüm form/input
   * listesini log'a düşürür → user görsün, biz fix edelim.
   */
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
      if (a.optCount >= 4 && a.optCount <= 12) {
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
    const single = form.querySelector('input[name="HESAP_KODU"], input[id="HESAP_KODU"], input[name="hesapKodu"]');
    if (single) {
      setNative(single, hesapKodu);
      await log(`💼 Hesap kodu set: ${hesapKodu} (input#${single.name || single.id})`);
      return true;
    }

    // BAS + BIT (alt çizgili: BAS_HESAP_KODU)
    const bas = form.querySelector('input[name="BAS_HESAP_KODU"], input[id="BAS_HESAP_KODU"], input[name="basHesapKodu"], input[name*="BAS" i][name*="HESAP" i]');
    const bit = form.querySelector('input[name="BIT_HESAP_KODU"], input[id="BIT_HESAP_KODU"], input[name="bitHesapKodu"], input[name*="BIT" i][name*="HESAP" i]');
    if (bas && bit) {
      setNative(bas, hesapKodu);
      setNative(bit, hesapKodu);
      await log(`💼 Hesap kodu (BAS+BIT) set: ${hesapKodu}`);
      return true;
    }

    // ILK + SON (Luca'nın gerçek isimleri: HESAPKODU_ILK + HESAPKODU_SON, alt çizgisiz)
    const ilk = form.querySelector('input[name="HESAPKODU_ILK"], input[id="HESAPKODU_ILK"], input[name="hesapkoduIlk"]');
    const son = form.querySelector('input[name="HESAPKODU_SON"], input[id="HESAPKODU_SON"], input[name="hesapkoduSon"]');
    if (ilk && son) {
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
    const anyHesap = form.querySelector('input[name*="hesap" i], input[id*="hesap" i]');
    if (anyHesap) {
      setNative(anyHesap, hesapKodu);
      await log(`💼 Hesap kodu (fallback) set: ${hesapKodu} → ${anyHesap.name || anyHesap.id}`);
      return true;
    }

    await log(`⚠ Hesap kodu input'u bulunamadı (form yapısını yukarıdaki dump'tan kontrol et)`);
    return false;
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
    const tarihIlk = form.querySelector('input[name="TARIH_ILK"], input[id="TARIH_ILK"], input[name="tarih_ilk"]');
    const tarihSon = form.querySelector('input[name="TARIH_SON"], input[id="TARIH_SON"], input[name="tarih_son"]');
    if (!tarihIlk || !tarihSon) throw new Error('TARIH_ILK / TARIH_SON bulunamadı');
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
    await log(`🎯 Buton bulundu: "${label}" [${btn.tagName}]`);
    await log(`🖱 "${label}" butonu tıklanıyor (gerçek user click sim)`);
    // Gerçek user click — focus + mousedown + mouseup + click sırası
    const win = doc.defaultView || window;
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

  /**
   * Defteri Kebir flow (KDV 191 / 391) — Mizan'dan BAĞIMSIZ, sıfırdan yazıldı.
   *
   * Yaklaşım: Luca'nın UI butonlarına tıklamak yerine doğrudan form parametrelerini
   * topla, kendi fetch POST'umuzu at. Server'dan dönen JSON'daki rapor_id ile
   * rapor_takip + rapor_indir zincirini bizim parametrelerimizle yürüt.
   * Bu sayede Luca'nın frontend "input.value submit'e geçmiyor" sorunu bypass.
   */
  async function fetchLucaDefteriKebirExcel(job, log, hesapKodu) {
    if (location.hostname.includes('agiris.luca') || location.pathname.includes('LUCASSO')) {
      throw new Error('Bu Luca v2.1 sürümü; klasik Luca kullanın.');
    }
    job = { ...job, donemTipi: 'AYLIK' };

    // 1-2. Firma + Fiş Listesi
    await ensureLucaFirma(job, log);
    await navigateToFisListesi(log);

    // 3. Defteri Kebir (Tüm Yazıcılar) — 2. occurrence
    await clickLucaRightMenu('Defteri Kebir', log, { nth: 2 });

    // 4. Form yüklensin
    const form = await waitForLucaAnyForm(log, /raporKebir|kebir/i, 15000, 'Defteri Kebir formu');
    const frm3doc = form.ownerDocument;
    const frm3win = frm3doc.defaultView;

    // 5. Form'un tam yüklenmesi için ekstra bekleme — UI elements lazy load
    await sleep(800);

    // 6. Tarih hesabı (AYLIK)
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
    setInput('input[name="HESAPKODU_ILK"]', hesapKodu);
    setInput('input[name="HESAPKODU_SON"]', hesapKodu);
    await sleep(400); // Luca onblur AJAX'i için
    // VERIFICATION — input gerçekten dolu mu, UI'da görünür mü?
    const hkIlkActual = form.querySelector('input[name="HESAPKODU_ILK"]')?.value;
    const hkSonActual = form.querySelector('input[name="HESAPKODU_SON"]')?.value;
    await log(`💼 Hesap kodu set sonrası: ILK="${hkIlkActual}" SON="${hkSonActual}"`);

    // 8. SONRA Tarih
    setInput('input[name="TARIH_ILK"]', TARIH_ILK);
    setInput('input[name="TARIH_SON"]', TARIH_SON);
    await sleep(400);
    const tIlkActual = form.querySelector('input[name="TARIH_ILK"]')?.value;
    const tSonActual = form.querySelector('input[name="TARIH_SON"]')?.value;
    await log(`📅 Tarih set sonrası: ILK="${tIlkActual}" SON="${tSonActual}"`);

    // 9. EN SON Rapor Türü = Excel (xlsx)
    await setRaporTuruExcel(form, log);

    // 10. XHR + fetch hook frm3'e (Luca jasper.jq POST'unu yakalamak için)
    installXhrHook(frm3win);
    installFetchHook(frm3win);
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
    installNativeDownloadHook(frm3win);
    await log(`🔗 Rapor öncesi hook'lar yeniden kuruldu`);

    // 13. Rapor butonu — GERÇEK USER CLICK simülasyonu (gonder() DEĞİL)
    // gonder() Luca'nın iç state'inden okuyor; gerçek click form input.value'ları
    // submit body'sine alıyor. Manuel kullanıcı davranışıyla aynı.
    await clickLucaRaporButton(form, log);

    // 14. Blob yakala — iki yol: form intercept VEYA rapor_takip durum=150 → kendi rapor_indir fetch
    try {
      const blob = await waitForKdvBlob(log, frm3win, 60000);
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
  async function waitForKdvBlob(log, frm3win, maxMs) {
    const t0 = Date.now();
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
        });
        if (blob3) return blob3;

        await log(`⚠ 3 varyant da blob dönmedi — form intercept beklemeye devam`);
      }
      await sleep(300);
    }
    throw new Error('KDV blob 60sn içinde yakalanamadı (ne form intercept ne rapor_takip)');
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
    await clickLucaRightMenu('Gelir/Gider Listesi', log, { nth: 1 });

    // 4) Form yüklensin
    const form = await waitForLucaAnyForm(log, /gelir|gider|isletme|işletme|raporGelirGider/i, 15000, 'İşletme Gelir/Gider formu');
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
      const gelirCb = form.querySelector('#gelir, input[name="gelir"][type="checkbox"]');
      const giderCb = form.querySelector('#gider, input[name="gider"][type="checkbox"]');
      const gelir1 = form.querySelector('#GELIR1, input[name="GELIR1"]');
      const gider1 = form.querySelector('#GIDER1, input[name="GIDER1"]');

      // Visible checkbox'lara dokunmayalım — Luca'nın onclick handler'ı GELIR1/GIDER1'i resetleyebilir.
      // Sadece HIDDEN flag'leri override et.
      if (gelir1) gelir1.value = isGelir ? '0' : '1';   // GELIR mode → GELIR1='0' (only GELIR)
      if (gider1) gider1.value = !isGelir ? '0' : '1';  // GIDER mode → GIDER1='0' (only GIDER)

      await log(`🚩 Hidden flag set: GELIR1=${gelir1?.value} | GIDER1=${gider1?.value} — hedef: ${isGelir ? 'GELİRLER' : 'GİDERLER'}`);
    }
    await sleep(200);

    // 8) Rapor Türü Excel
    await setRaporTuruExcel(form, log);
    await sleep(500);

    // 9) Hook'lar + override
    installXhrHook(frm3win);
    installFetchHook(frm3win);
    installNativeDownloadHook(frm3win);
    await log(`🔗 frm3 hook'lar kuruldu`);

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
      const g1 = form.querySelector('#GELIR1, input[name="GELIR1"]');
      const g2 = form.querySelector('#GIDER1, input[name="GIDER1"]');
      if (g1) g1.value = isGelirMode ? '0' : '1';
      if (g2) g2.value = !isGelirMode ? '0' : '1';
      await log(`🚩 Rapor öncesi son set: GELIR1=${g1?.value} | GIDER1=${g2?.value}`);
    }

    await clickLucaRaporButton(form, log);

    // 11) Blob yakala
    try {
      return await waitForKdvBlob(log, frm3win, 60000);
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
    let yil, ay;
    let m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) { yil = m[1]; ay = m[2].padStart(2, '0'); }
    if (!yil) { m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) { ay = m[1].padStart(2, '0'); yil = m[2]; } }
    if (!yil) { m = s.match(/^(\d{2})(\d{4})$/); if (m) { ay = m[1]; yil = m[2]; } }
    if (!yil || !ay) return null;
    // Ayın son günü
    const lastDay = new Date(parseInt(yil), parseInt(ay), 0).getDate();
    return `${String(lastDay).padStart(2, '0')}/${ay}/${yil}`;
  }

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
    const frm4 = getLucaFrame('frm4');
    if (!frm4 || !frm4.contentDocument) {
      throw new Error('frm4 (firma seçici) bulunamadı');
    }
    const combo = frm4.contentDocument.getElementById('SirketCombo');
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

    if (!targetOpt) {
      const realOpts = [...combo.options].filter(isRealOption);
      const sample = realOpts.slice(0, 8).map((o) => o.text.trim().slice(0, 50)).join(' | ');
      throw new Error(
        `Firma bulunamadı: VKN=${job.taxNumber || '?'} slug="${job.lucaSlug || '?'}" ad="${job.mukellefAdi || '?'}". ` +
        `Luca firma listesinde yok ya da yetkiniz yok. ` +
        `Toplam ${combo.options.length} option (${realOpts.length} geçerli). İlk geçerli 8: ${sample}`,
      );
    }

    const targetText = targetOpt.text.trim();
    const targetValue = String(targetOpt.value || '').trim();
    if (!targetValue) {
      throw new Error(`Eşleşen option boş value taşıyor: "${targetText}". Luca DOM yapısı değişmiş olabilir.`);
    }

    await log(`🔄 Firma değiştiriliyor (${matchedBy}): ${currentText || '∅'} → ${targetText}`);
    combo.value = targetValue;

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
    // tıklanması gerek. 800ms bekle (showButton DOM'a buton koymak için zaman),
    // sonra frm4'te VISIBLE bir button/input[type=submit]/input[type=button] ara ve tıkla.
    await sleep(800);

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

    // Sayfa yenilenmesini bekle — frm4 reload edecek
    await sleep(2500);

    // DOĞRULAMA: SirketCombo'da seçili option gerçekten hedef mi?
    // (frm4 reload sonrası DOM yeniden oluştuğu için tekrar fetch ediyoruz)
    let verified = false;
    let lastSelectedText = currentText;
    const verifyDeadline = Date.now() + 18000;
    while (Date.now() < verifyDeadline) {
      const frm4Now = getLucaFrame('frm4');
      const comboNow = frm4Now?.contentDocument?.getElementById('SirketCombo');
      if (comboNow) {
        const selText = (comboNow.selectedOptions[0]?.text || '').trim();
        const selSlug = slugify(selText);
        const tgtSlug = slugify(targetText);
        lastSelectedText = selText;
        if (selSlug && tgtSlug && (selSlug === tgtSlug || selSlug.includes(tgtSlug) || tgtSlug.includes(selSlug))) {
          verified = true;
          break;
        }
      }
      await sleep(500);
    }
    if (!verified) {
      throw new Error(
        `Firma DEĞİŞMEDİ: hedef "${targetText}", hâlâ seçili olan "${lastSelectedText}". ` +
        `Luca change event'i kabul etmedi olabilir — manuel olarak Luca'da firma seçip tekrar dene.`,
      );
    }

    // Menünün yeni firma için hazır olmasını bekle
    await waitUntil(() => {
      const frm5 = getLucaFrame('frm5');
      if (!frm5 || !frm5.contentDocument) return false;
      const all = frm5.contentDocument.querySelectorAll('*');
      for (const el of all) {
        if ((el.textContent || '').trim() === 'Mizan' && el.children.length === 0) return true;
      }
      return false;
    }, 15000);
    await log(`✓ Firma değişti → ${targetText}, menü hazır`);
    return { changed: true, alreadyCorrect: false, skipped: false };
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
   * İŞLETME DEFTERİ akışı — KDV Kontrol İşletme Alış/Satış için.
   * Akış: Üst menü "İşletme Defteri" → "Gider İşlemleri" hover → "Gider Listesi" tıkla.
   * Sayfa yenilenir ve sağ menüde "Gelir/Gider Listesi" gözükür.
   */
  async function navigateToIsletmeGiderListesi(log) {
    // Quick check — sağ menüde Gelir/Gider Listesi varsa zaten orada
    const quick = await findLucaMenuItem('Gelir/Gider Listesi', null, 1500);
    if (quick) {
      await log('✓ İşletme Gider Listesi sayfasında (Gelir/Gider Listesi menüsü hazır)');
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
    await log('🖱 İşletme Defteri açılıyor (hover+click+onclick)');
    fullActivate(isletmeEl, menuFrame.contentWindow);
    await sleep(800);

    // 2. "Gider İşlemleri" submenü
    await log('🔍 Gider İşlemleri aranıyor');
    const giderIslemleri = await findLucaMenuItem('Gider İşlemleri', null, 4000);
    if (!giderIslemleri) {
      throw new Error('İşletme Defteri menüsü açıldı ama "Gider İşlemleri" görünmedi');
    }
    await log('🖱 Gider İşlemleri açılıyor (hover+click+onclick)');
    fullActivate(giderIslemleri.el, giderIslemleri.frame.contentWindow || giderIslemleri.frame);
    await sleep(800);

    // 3. "Gider Listesi" tıkla
    await log('🔍 Gider Listesi linki aranıyor');
    const giderListesi = await findLucaMenuItem('Gider Listesi', null, 4000);
    if (!giderListesi) throw new Error('"Gider Listesi" linki açılmadı');
    await log('🖱 Gider Listesi tıklanıyor');
    fullActivate(giderListesi.el, giderListesi.frame.contentWindow || giderListesi.frame);

    // 4. Sayfa yüklensin — sağ menüde "Gelir/Gider Listesi" çıksın
    await log('⏳ Gider Listesi sayfası yüklensini bekliyor');
    const ggReady = await findLucaMenuItem('Gelir/Gider Listesi', null, 15000);
    if (!ggReady) throw new Error('Gider Listesi açıldı ama "Gelir/Gider Listesi" sağ menüsü hazır olmadı (timeout 15sn)');
    await log('✓ İşletme Gider Listesi hazır, Gelir/Gider Listesi sağ menüsü görünür');
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
    // about:blank reset sonrası taze form yüklenmesi 1-2sn sürebilir
    await sleep(1500);
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
            capturedBlob = blob; window.__morenCapturedBlob = blob;
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

    // Background script'e "şu andan itibaren Luca download'ı bekliyorum"
    // sinyali gönder. Bridge.js (sadece top frame'de yüklü) bunu
    // chrome.runtime.sendMessage ile background.js'e iletir. Flag yoksa
    // background download'a hiç dokunmuyor → moren-luca-file event'i hiç
    // ateşlemiyor → 90sn timeout. window.top kullan ki child frame'den
    // çağrılırsa bile bridge yakalasın.
    const postExpecting = (val) => {
      const payload = { source: 'moren-agent', type: 'set-expecting', expecting: val };
      try { window.postMessage(payload, '*'); } catch (e) {}
      try { if (window.top && window.top !== window) window.top.postMessage(payload, '*'); } catch (e) {}
    };
    postExpecting(true);
    await log('🔔 Background\'a "download bekliyorum" sinyali gönderildi');
    restoreFns.push(() => postExpecting(false));

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

            // 1) XHR response Blob ise (Excel) — Luca'nın rapor_indir.jq response'unu yakalama şansı
            if (this.response && this.response instanceof Blob) {
              if (this.response.size > 5000 && (isExcelResponse(ct) || isExcelUrl(url))) {
                if (!capturedBlob) {
                  capturedBlob = this.response;
                  await log(`✅ XHR blob yakalandı (${Math.round(capturedBlob.size / 1024)} KB) url=${url.split('/').pop().slice(0, 40)}`);
                  return;
                }
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
                  if (data && data.size > 5000) {
                    capturedBlob = data;
                    await log(`✅ ${url.split('/').pop().slice(0, 30)} → Blob yakalandı (${Math.round(data.size / 1024)} KB)`);
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

    // ─── window.open override — Luca gonder() yeni tab açıyorsa URL'i yakala ───
    const installWindowOpenOverride = (win, label) => {
      const origOpen = win.open;
      if (typeof origOpen !== 'function') return;
      restoreFns.push(() => { try { win.open = origOpen; } catch (e) {} });
      win.open = function (url, name, features) {
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

                const fullUrl = action.startsWith('http')
                  ? action
                  : new URL(action, win.location.href).toString();
                const bodyPreview = params.toString().slice(0, 200);
                await log(`🎯 form intercept: ${method} ${fullUrl.split('/').pop().slice(0, 50)} (${params.toString().length} byte) body: ${bodyPreview}`);

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
                if (blob.size > 5000) {
                  if (!capturedBlob) {
                    capturedBlob = blob; window.__morenCapturedBlob = blob; window.__morenCapturedBlob = blob;
                    await log(`✅ form intercept Blob yakalandı (${Math.round(blob.size / 1024)} KB, ct=${ct.slice(0, 30)})`);
                  }
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
          const blob = await r.blob();
          if (blob.size > 5000) {
            capturedBlob = blob; window.__morenCapturedBlob = blob;
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
    // 2) jQuery click — Luca jQuery handler kullanıyor olabilir, native click tetiklemez.
    //    Luca gerçek jQuery kullanmıyor (.trigger yok); o yüzden gürültü yapmadan dene.
    try {
      const $ = btnWin.$ || btnWin.jQuery;
      if ($ && typeof $ === 'function' && typeof $.fn?.trigger === 'function') {
        $(excelBtn).trigger('click');
        await log(`🔧 jQuery trigger('click') çağrıldı`);
      }
    } catch (e) { /* jQuery yok — sessiz geç */ }
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
        capturedBlob = blob; window.__morenCapturedBlob = blob;
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
            capturedBlob = blob; window.__morenCapturedBlob = blob;
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
              capturedBlob = blob; window.__morenCapturedBlob = blob;
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

  // ─────────────────────────────────────────────────────────────────────
  // XHR HOOK — jasper.jq POST'larına window.__lucaJobOverrides body inject
  // ÖNEMLI: Luca jasper.jq'yu frm3.contentWindow'dan atıyor; her frame'in
  // KENDI XMLHttpRequest objesi var. Top window'a hook kurmak yetmiyor —
  // her frame'e ayrı ayrı kurmamız lazım. installXhrHook(targetWindow)
  // helper'ı bunu idempotent şekilde yapar (zaten kurulmuşsa atla).
  function installXhrHook(targetWin) {
    try {
      const w = targetWin || window;
      if (!w || !w.XMLHttpRequest || w.__morenXhrHookInstalled) return false;
      w.__morenXhrHookInstalled = true;
      const proto = w.XMLHttpRequest.prototype;
      const origOpen = proto.open;
      const origSend = proto.send;
      proto.open = function (method, url) {
        this.__morenUrl = url;
        this.__morenMethod = method;
        return origOpen.apply(this, arguments);
      };
      proto.send = function (body) {
        // DEBUG: __lucaJobOverrides aktifken TÜM XHR URL'lerini log'la
        try {
          if (window.__lucaJobOverrides && Array.isArray(window.__morenLogs)) {
            const url = this.__morenUrl || '';
            if (!/rapor_takip|jasper/i.test(url)) {
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
                if (parsed && typeof parsed.form === 'string') {
                  let formObj;
                  try { formObj = JSON.parse(parsed.form); } catch { formObj = null; }
                  if (formObj && typeof formObj === 'object') {
                    if (ov.HESAPKODU_ILK) {
                      formObj.hesap_bas = String(ov.HESAPKODU_ILK);
                      formObj.hesap_bit = String(ov.HESAPKODU_SON || ov.HESAPKODU_ILK);
                    }
                    if (ov.TARIH_ILK) formObj.tarih_bas = String(ov.TARIH_ILK);
                    if (ov.TARIH_SON) formObj.tarih_bit = String(ov.TARIH_SON);
                    // İŞLETME: GELIR1/GIDER1 hidden flag override
                    if (ov.GELIR1 !== undefined) formObj.GELIR1 = String(ov.GELIR1);
                    if (ov.GIDER1 !== undefined) formObj.GIDER1 = String(ov.GIDER1);
                    parsed.form = JSON.stringify(formObj);
                    body = JSON.stringify(parsed);
                    if (Array.isArray(window.__morenLogs)) {
                      window.__morenLogs.push(`[XHR-INJECT-OK] hesap=${formObj.hesap_bas}-${formObj.hesap_bit} tarih=${formObj.tarih_bas}/${formObj.tarih_bit} GELIR1=${formObj.GELIR1} GIDER1=${formObj.GIDER1}`);
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
      if (!w || !w.fetch || w.__morenFetchHookInstalled) return false;
      w.__morenFetchHookInstalled = true;
      const origFetch = w.fetch;
      w.fetch = async function (input, init) {
        // DEBUG: __lucaJobOverrides aktifken TÜM fetch URL'lerini log'la
        try {
          const dbgUrl = typeof input === 'string' ? input : (input && input.url) || '';
          if (window.__lucaJobOverrides && Array.isArray(window.__morenLogs)) {
            if (!/rapor_takip|jasper/i.test(dbgUrl)) {
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
              if (parsed && typeof parsed.form === 'string') {
                let formObj;
                try { formObj = JSON.parse(parsed.form); } catch { formObj = null; }
                if (formObj && typeof formObj === 'object') {
                  if (ov.HESAPKODU_ILK) {
                    formObj.hesap_bas = String(ov.HESAPKODU_ILK);
                    formObj.hesap_bit = String(ov.HESAPKODU_SON || ov.HESAPKODU_ILK);
                  }
                  if (ov.TARIH_ILK) formObj.tarih_bas = String(ov.TARIH_ILK);
                  if (ov.TARIH_SON) formObj.tarih_bit = String(ov.TARIH_SON);
                  // İŞLETME: GELIR1/GIDER1 hidden flag override
                  if (ov.GELIR1 !== undefined) {
                    formObj.GELIR1 = String(ov.GELIR1);
                    formObj.gelir = String(ov.GELIR1) === '0' ? '1' : '0';
                  }
                  if (ov.GIDER1 !== undefined) {
                    formObj.GIDER1 = String(ov.GIDER1);
                    formObj.gider = String(ov.GIDER1) === '0' ? '1' : '0';
                  }
                  parsed.form = JSON.stringify(formObj);
                  init = { ...init, body: JSON.stringify(parsed) };
                  if (Array.isArray(window.__morenLogs)) {
                    window.__morenLogs.push(`[FETCH-INJECT-OK] hesap=${formObj.hesap_bas}-${formObj.hesap_bit} tarih=${formObj.tarih_bas}/${formObj.tarih_bit} GELIR1=${formObj.GELIR1} GIDER1=${formObj.GIDER1}`);
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
        return origFetch.apply(this, arguments.length > 1 ? [input, init] : [input]);
      };
      return true;
    } catch (e) { return false; }
  }

    // ─────────────────────────────────────────────────────────────────────
  // NATIVE DOWNLOAD HOOK — Luca rapor_indir sonrası dosyayı window.open()
  // veya <a download href=URL> ile veriyor olabilir. Bu URL'yi yakalayıp
  // bizim fetch'imizle blob alıp __morenCapturedBlob'a yazıyoruz.
  function installNativeDownloadHook(targetWin) {
    try {
      const w = targetWin || window;
      if (!w || w.__morenNativeDlInstalled) return false;
      w.__morenNativeDlInstalled = true;

      // 1) window.open intercept — Luca yeni tab/window ile dosya açabilir
      const origOpen = w.open;
      w.open = function (url, ...rest) {
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
    if (installNativeDownloadHook(window)) count++;
    const collect = (root, depth = 0) => {
      if (depth > 5) return;
      try {
        for (const f of root.querySelectorAll('frame, iframe')) {
          try {
            if (f.contentWindow) {
              if (installXhrHook(f.contentWindow)) count++;
              if (installFetchHook(f.contentWindow)) count++;
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
