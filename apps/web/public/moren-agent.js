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
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const m = location.href.match(/\/(\d+)\?count=/);
      if (m && m[1] !== currentFid) return;
      if (/count=0/.test(location.href)) return;
      // Yeni dialog geldiyse yine kapat
      if (getVisibleModals().length > 0) { await handleDialogs(); }
      await sleep(200);
    }
  }

  async function clickKaydetOnayla() {
    // Direkt butona tıkla (F2 key dispatch ant-design bazen yakalamıyor)
    const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    const f2btn = btns.find((b) => b.textContent.trim().startsWith('Kaydet ve Onayla'));
    if (f2btn) {
      await click(f2btn);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true }));
    }
    await sleep(800);
    // Her türlü dialog'u kapat (mükerrer, hesap kodu uyarı, vs)
    let tries = 0;
    while (tries < 3 && getVisibleModals().length > 0) {
      await handleDialogs();
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

  async function aiDecide({ codes, tarih, hedefAy, belgeNo, belgeTuru, faturaTuru, mukellef, firma, tutar, action }) {
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
    const tipSegment = action === 'isle_alis' ? 'BILANCO/1' : action === 'isle_satis' ? 'BILANCO/2' : null;
    if (!tipSegment || !mukellef.mihsapId) return;
    const targetPath = `/documents/${tipSegment}/${mukellef.mihsapId}`;
    const baseList = `https://app.mihsap.com${targetPath}`;
    // URL uygun değilse user'ın gitmesini bekle (SPA nav, script ölmez)
    const waitT0 = Date.now();
    while (!location.pathname.startsWith(targetPath)) {
      if (window.__morenAgent.stopRequested) return;
      if (Date.now() - waitT0 > 180000) { setStatus('URL beklendi, zaman aşımı'); return; }
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
      const codes = await readHesapKodlari();
      if (!tumKodlarDolu(codes)) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'kod boş (hiç kod yok)', { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
        await clickIleri(fid); continue;
      }
      // Ekrandaki select'lerden herhangi biri boşsa (matrah/KDV/cari) → F2 denemeden atla
      if (bosSelectVarMi()) {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', 'matrah/KDV/cari boş alan var', { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar });
        await clickIleri(fid); continue;
      }
      // LLM karar
      setStatus(`${mukellef.ad} · #${fid} Claude inceliyor…`);
      const decision = await aiDecide({
        codes, tarih, hedefAy,
        belgeNo: meta.belgeNo, belgeTuru: meta.belgeTuru, faturaTuru: meta.faturaTuru,
        mukellef: mukellef.ad,
        firma: meta.firma,
        tutar: meta.tutar,
        action,
      });
      const karar = decision?.karar || 'emin_degil';
      const sebep = (decision?.sebep || '').slice(0, 120);
      if (karar === 'atla' || karar === 'emin_degil') {
        counters.atla++; counters.toplam++; setCount();
        await logEvent(mukellef.id, mukellef.ad, 'skip', `${karar}: ${sebep}`, { firma: meta.firma, belgeNo: meta.belgeNo, tutar: meta.tutar, hesapKodu: codes[0], kdv: readKdvOrani() });
        await clickIleri(fid); continue;
      }
      try {
        let validationFailed = null;

        // F2 sonrası URL değişti mi + validation dialog geldi mi kontrolü
        const waitSaved = async (timeoutMs) => {
          const t0 = Date.now();
          while (Date.now() - t0 < timeoutMs) {
            const m2 = location.href.match(/\/(\d+)\?count=/);
            if (m2 && m2[1] !== fid) return true;
            if (/count=0/.test(location.href)) return true;
            const okToast = document.querySelector('.ant-message-success, .ant-notification-notice-success');
            if (okToast) return true;

            // VALIDATION DIALOG kontrolü — "seçilmemiş", "girilmemiş" vb.
            const validationMsg = validationDialogVarMi();
            if (validationMsg) {
              validationFailed = validationMsg;
              // Dialog'u kapat ama başarısız dön
              await handleDialogs();
              return false;
            }

            // Diğer dialog varsa (mükerrer vb.) kapat
            if (getVisibleModals().length > 0) {
              await handleDialogs();
              await sleep(400);
              const m3 = location.href.match(/\/(\d+)\?count=/);
              if (m3 && m3[1] !== fid) return true;
              return false;
            }
            await sleep(200);
          }
          return false;
        };

        await clickKaydetOnayla();
        let saved = await waitSaved(10000);

        // Validation hatası varsa retry YAPMA (zaten alan eksik)
        if (!saved && !validationFailed) {
          await sleep(500);
          await clickKaydetOnayla();
          saved = await waitSaved(10000);
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
