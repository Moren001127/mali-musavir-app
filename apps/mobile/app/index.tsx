import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { colors } from '../lib/theme';
import { getStoredItem, setStoredItem, deleteStoredItem } from '../lib/secure-storage';

// "Beni Hatırla" — e-posta+şifre telefonun güvenli kasasında (SecureStore) şifreli saklanır.
const CREDS_KEY = 'moren.mobile.creds';

// Uygulama = onaylanan HTML tasarımının BİREBİR kendisi (tam ekran WebView).
// Native köprü: gerçek giriş (API), kamera/OCR, biyometrik + canlı veri enjeksiyonu.
const APP_HTML = Asset.fromModule(require('../assets/app.html'));

const BRIDGE = `
(function(){
  if (window.__morenBridge) return; window.__morenBridge = true;
  function post(t,p){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:t,payload:(p===undefined?null:p)})); }catch(e){} }
  window.MorenNative = { post: post, scan: function(){ post('scan'); }, gallery: function(){ post('gallery'); }, biometric: function(){ post('biometric'); } };
  // Dokunma: kamera + her anlamlı dokunuşta hafif haptik
  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.shutter') || t.closest('.camera')) { post('scan'); }
    if (t.closest('.tab,.tile,.row,.drow,.qa,.statcard,.icoBtn,.cb-sw,.secdiv .chip,.kpill,.back,.seg span,.aiask,button,[onclick]')) { post('haptic','light'); }
  }, true);
  // Aşağı-çek-yenile
  (function(){
    var startY=0, pulling=false, sc=null, ind=null, TH=64, dist=0;
    var st=document.createElement('style'); st.textContent='@keyframes ptrspin{to{transform:rotate(360deg)}}'; document.head.appendChild(st);
    function indicator(){ if(ind) return ind; ind=document.createElement('div'); ind.id='ptr';
      ind.style.cssText='position:fixed;left:0;right:0;top:calc(max(env(safe-area-inset-top,0px),44px) + 44px);display:flex;justify-content:center;z-index:55;pointer-events:none;opacity:0;transform:translateY(-12px);transition:opacity .18s,transform .18s';
      ind.innerHTML='<div class="ptrsp" style="width:30px;height:30px;border-radius:50%;border:2.5px solid rgba(212,184,118,.22);border-top-color:#d4b876;background:rgba(11,9,6,.92);box-shadow:0 6px 16px rgba(0,0,0,.4)"></div>';
      document.body.appendChild(ind); return ind; }
    function scroller(){ var vs=document.querySelectorAll('.view.on'); for(var i=0;i<vs.length;i++){ if(vs[i].offsetParent!==null) return vs[i]; } return document.querySelector('.view.on'); }
    document.addEventListener('touchstart', function(e){ sc=scroller(); pulling=!!(sc && sc.scrollTop<=0); if(pulling) startY=e.touches[0].clientY; }, {passive:true});
    document.addEventListener('touchmove', function(e){ if(!pulling||!sc) return; if(sc.scrollTop>0){ pulling=false; return; } dist=e.touches[0].clientY-startY; if(dist>0){ var el=indicator(); var pr=Math.min(dist/90,1); el.style.opacity=pr; el.style.transform='translateY('+((pr*12)-12)+'px)'; var sp=el.firstChild; if(sp) sp.style.transform='rotate('+(dist*2.2)+'deg)'; } }, {passive:true});
    document.addEventListener('touchend', function(){ if(!pulling){ return; } pulling=false; if(dist>=TH && ind){ ind.style.opacity='1'; ind.style.transform='translateY(0)'; var sp=ind.firstChild; if(sp){ sp.style.transition='none'; sp.style.animation='ptrspin .7s linear infinite'; }
        var ctx={}; try{ ctx.persona=(typeof persona!=='undefined')?persona:'adv'; ctx.current=(typeof current!=='undefined')?current:''; ctx.client=(typeof activeClient!=='undefined')?activeClient:''; }catch(_){ }
        post('haptic','medium'); post('refresh', ctx); setTimeout(function(){ window.morenRefreshDone && window.morenRefreshDone(); }, 2600);
      } else hide(); dist=0; }, {passive:true});
    function hide(){ if(!ind) return; ind.style.opacity='0'; ind.style.transform='translateY(-12px)'; var sp=ind.firstChild; if(sp) sp.style.animation='none'; }
    window.morenRefreshDone = function(){ hide(); };
  })();
  true;
})();
true;
`;

const PALETTE = ['#8cbde8', '#d4b876', '#e2b877', '#f0a0a8', '#8fd7bd', '#d9a06c', '#c3a6e6', '#9da8b7'];

// Beyanname türü → ekran etiketi / rota (Özet "Beyanname Durumu" tablosu için)
// Portaldaki ETİKETLERLE birebir (KDV1/KDV2/MUHSGK/Damga/Poşet...)
const TIP_LABEL: Record<string, string> = {
  KDV1: 'KDV1', KDV2: 'KDV2', KDV4: 'KDV4', MUHSGK: 'MUHSGK', MUHSGK2: 'MUHSGK2',
  DAMGA: 'Damga', BILDIRGE: 'Bildirge (SGK)', EDEFTER: 'E-Defter', KURUMLAR: 'Kurumlar', GELIR: 'Gelir',
  GGECICI: 'G.Geçici Vergi', KGECICI: 'K.Geçici Vergi', POSET: 'Poşet', KONAKLAMA: 'Konaklama', GMSI: 'GMSİ',
};
// Beyanname listesinden AYRI gösterilecekler (portaldaki "Bildirge ve E-Defter" bölümü)
const AYRI_TIP = ['BILDIRGE', 'EDEFTER'];
const TIP_ROUTE: Record<string, string> = {
  KDV1: 'm:kdv-panosu', KDV2: 'm:kdv-panosu', BILDIRGE: 'm:sgk', MUHSGK: 'm:beyanname',
  MUHSGK2: 'm:beyanname', EDEFTER: 'm:edefter', DAMGA: 'm:beyanname',
};
const BEYAN_ORDER = ['KDV1', 'MUHSGK', 'BILDIRGE', 'DAMGA', 'EDEFTER', 'KURUMLAR', 'GELIR', 'GGECICI', 'KGECICI'];

// ArrayBuffer → base64 (RN'de btoa yok; bağımsız kodlayıcı)
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return result;
}

// Bugünün dönemi (YYYY-MM) + yıl/ay
function ym() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { year: y, month: m, donem: `${y}-${String(m).padStart(2, '0')}` };
}

function inits(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export default function IndexScreen() {
  const auth = useAuth();
  const [uri, setUri] = useState<string | null>(APP_HTML.uri ?? null);
  const webRef = useRef<WebView>(null);
  const autoTried = useRef(false);
  const lastDoc = useRef<string[]>([]);

  useEffect(() => {
    let m = true;
    if (!uri) {
      APP_HTML.downloadAsync().then(() => {
        if (m) setUri(APP_HTML.localUri || APP_HTML.uri);
      });
    }
    return () => {
      m = false;
    };
  }, [uri]);

  function inject(js: string) {
    webRef.current?.injectJavaScript(js + ';true;');
  }

  // Aşağı-çek-yenile: HTML üstten çekince veriyi tazeler, bitince spinner'ı kapatır
  async function doRefresh(payload: any) {
    const p = payload || {};
    try {
      if (p.persona === 'tax') {
        await loadTaxpayer();
      } else {
        await loadOverview();
        if (p.module) await loadModule(String(p.module), String(p.client ?? ''), p.donem || null);
      }
      loadNotifications();
    } catch {
      /* yenileme başarısızsa mevcut veri kalır */
    } finally {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      inject('window.morenRefreshDone && window.morenRefreshDone()');
    }
  }

  // Çıkış: token + kayıtlı bilgileri temizle, otomatik girişi durdur, HTML'i giriş ekranına al
  async function doLogout() {
    try { await auth.logout(); } catch { /* yine de temizle */ }
    try { await deleteStoredItem(CREDS_KEY); } catch { /* yoksa geç */ }
    autoTried.current = true;
    inject('window.__morenLogout && window.__morenLogout()');
  }

  // Bildirimler: liste + okunmamış sayısı → HTML'e enjekte
  async function loadNotifications() {
    try {
      const [nR, cR] = await Promise.all([
        api.get('/notifications').catch(() => null),
        api.get('/notifications/unread-count').catch(() => null),
      ]);
      const items: any[] = Array.isArray(nR?.data) ? nR.data : nR?.data?.items || [];
      const list = items.slice(0, 40).map((n: any) => ({
        id: n.id, title: n.title || '', body: n.body || '', type: n.type || '', read: !!n.isRead, ts: n.createdAt || '',
      }));
      const unread = typeof cR?.data === 'number' ? cR.data : (cR?.data?.count ?? list.filter((x) => !x.read).length);
      inject('window.MOREN && window.MOREN.applyNotifications(' + JSON.stringify({ list, unread }) + ')');
    } catch {
      /* bildirim çekilemezse örnek görünüm kalır */
    }
  }

  // Belge görüntüle (e-Tebligat / e-Arşiv): göze dokununca gerçek belgeyi çek → modal'a bas
  async function doDocView(kind: string, id: string) {
    try {
      if (!id) { inject('window.MOREN && window.MOREN.applyDocView(null)'); return; }
      if (kind === 'tebligat') {
        const { data } = await api.get('/portal-automation/documents/' + encodeURIComponent(id) + '/view', { timeout: 20000 });
        const url = typeof data === 'string' ? data : (data?.url || '');
        inject('window.MOREN && window.MOREN.applyDocView(' + JSON.stringify(url ? { url } : null) + ')');
      } else if (kind === 'earsiv') {
        const resp = await api.get('/earsiv/' + encodeURIComponent(id) + '/original-pdf', { responseType: 'arraybuffer', timeout: 20000 });
        const ct = String(resp.headers?.['content-type'] || 'application/pdf').split(';')[0].trim();
        const b64 = arrayBufferToBase64(resp.data as ArrayBuffer);
        inject('window.MOREN && window.MOREN.applyDocView(' + JSON.stringify({ url: `data:${ct};base64,${b64}`, ct }) + ')');
      } else {
        inject('window.MOREN && window.MOREN.applyDocView(null)');
      }
    } catch {
      inject('window.MOREN && window.MOREN.applyDocView(null)');
    }
  }

  // WhatsApp mesaj gönder: reply ucu → başarıda thread'i tazele
  async function doWaSend(p: any) {
    try {
      const ref = String(p?.ref || '');
      const message = String(p?.text || '').trim();
      if (!ref || !message) { inject('window.MOREN && window.MOREN.waSendDone(false)'); return; }
      await api.post('/whatsapp/conversations/' + encodeURIComponent(ref) + '/reply', { message }, { timeout: 25000 });
      inject('window.MOREN && window.MOREN.waSendDone(true)');
      doWaThread({ ref, name: p?.name });
    } catch (e: any) {
      inject('window.MOREN && window.MOREN.waSendDone(false,' + JSON.stringify(e?.response?.data?.message || 'gönderilemedi') + ')');
    }
  }

  // WhatsApp konuşma thread'i: bir sohbete dokununca mesajları çek → modal'a bas
  async function doWaThread(p: any) {
    try {
      const ref = String(p?.ref || '');
      if (!ref) { inject('window.MOREN && window.MOREN.waThread(' + JSON.stringify(p?.name || '') + ',[])'); return; }
      const { data } = await api.get('/whatsapp/conversations/' + encodeURIComponent(ref), { timeout: 20000 });
      const msgs: any[] = Array.isArray(data?.messages) ? data.messages : [];
      const mapped = msgs.map((m: any) => ({ d: m.direction === 'incoming' ? 'in' : 'out', t: m.content || '', at: m.occurredAt || '' }));
      inject('window.MOREN && window.MOREN.waThread(' + JSON.stringify(p?.name || '') + ',' + JSON.stringify(mapped) + ')');
    } catch {
      inject('window.MOREN && window.MOREN.waThread(' + JSON.stringify(p?.name || '') + ',[])');
    }
  }

  // MOREN AI sohbeti: mesaj → backend (Max) → cevabı HTML'e enjekte et
  async function doAiChat(p: any) {
    try {
      const body: any = { message: String(p?.text || ''), source: 'mobil-app', toolMode: p?.persona === 'tax' ? 'taxpayer-readonly' : 'owner' };
      if (p?.conversationId) body.conversationId = p.conversationId;
      const { data } = await api.post('/moren-ai/chat', body);
      inject('window.MOREN && window.MOREN.aiReply(' + JSON.stringify(data?.conversationId || null) + ',' + JSON.stringify(data?.assistantMessage || '—') + ')');
    } catch (e: any) {
      const em = e?.response?.data?.message || 'cevap alınamadı';
      inject('window.MOREN && window.MOREN.aiReply(null,' + JSON.stringify('Bağlantı sorunu: ' + em) + ')');
    }
  }

  async function handleLogin(
    email: string,
    password: string,
    audience: 'advisor' | 'taxpayer',
    remember: boolean,
  ) {
    try {
      await auth.login({ email, password, audience });
      // Beni Hatırla: başarılı girişte bilgileri güvenli kasaya yaz, aksi halde temizle
      try {
        if (remember) await setStoredItem(CREDS_KEY, JSON.stringify({ email, password, audience }));
        else await deleteStoredItem(CREDS_KEY);
      } catch {
        /* kasa yazılamazsa giriş yine de devam eder */
      }
      const persona = audience === 'taxpayer' ? 'tax' : 'adv';
      inject('window.__morenEnter && window.__morenEnter(' + JSON.stringify(persona) + ')');
      // Müşavir: gerçek mükellef listesini çek ve HTML'e enjekte et
      if (audience === 'advisor') {
        try {
          const { data } = await api.get('/taxpayers');
          const arr: any[] = Array.isArray(data) ? data : data?.items || data?.data || data?.taxpayers || [];
          // Etiket: "Şahıs · Bilanço" / "Kurumlar · İşletme" — gerçek enum'lardan (type + defterTuru)
          const turLabel = (t: any) => {
            const kisi = t.type === 'TUZEL_KISI' ? 'Kurumlar' : 'Şahıs';
            const dt = t.defterTuru || (t.mihsapDefterTuru === 'DEFTER_BEYAN' ? 'ISLETME' : t.mihsapDefterTuru);
            const defter = dt === 'BILANCO' ? 'Bilanço' : dt === 'ISLETME' ? 'İşletme' : '';
            return defter ? kisi + ' · ' + defter : kisi;
          };
          // HTML tarafındaki CLIENTS şekli: { id, n, tur, vkn, ini, c }
          const clients = arr.map((t: any, i: number) => {
            const name = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '—').trim();
            return {
              id: String(t.id ?? i),
              n: name,
              tur: turLabel(t),
              vkn: String(t.taxNumber || ''),
              ini: inits(name),
              c: PALETTE[i % PALETTE.length],
            };
          });
          if (clients.length) inject('window.MOREN && window.MOREN.applyClients(' + JSON.stringify(clients) + ')');
        } catch {
          /* liste çekilemezse örnek veriyle devam eder */
        }
        loadOverview();
      } else if (audience === 'taxpayer') {
        loadTaxpayer();
      }
      loadNotifications();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Giriş bilgileri hatalı';
      inject('window.__morenLoginErr && window.__morenLoginErr(' + JSON.stringify(msg) + ')');
    }
  }

  // Ana ekran (Özet) canlı veri: ofis geneli beyanname durumu + iş akışı sayaçları
  async function loadOverview() {
    try {
      const { donem, year, month } = ym();
      const [ozetR, wfR, onayR, detR, tasksR] = await Promise.all([
        api.get('/beyanname-takip/ozet', { params: { donem, donemTuru: 'VERILME' } }).catch(() => null),
        api.get('/taxpayers/workflow/queue', { params: { year, month } }).catch(() => null),
        api.get('/onay-kuyrugu', { params: { durum: 'bekliyor', limit: 20 } }).catch(() => null),
        api.get('/beyanname-takip/detay', { params: { donem, donemTuru: 'VERILME' } }).catch(() => null),
        api.get('/tasks', { params: { isTemplate: 'false', limit: 200 } }).catch(() => null),
      ]);
      const ov: any = {};
      // Beyanname durumu tıkla→liste: mükellef bazında beyan durumları
      const det: any[] = Array.isArray(detR?.data) ? detR.data : detR?.data?.items || detR?.data?.rows || [];
      ov.detay = det.map((t: any) => ({
        ad: t.ad || t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—',
        beyanlar: (t.beyanlar || []).map((b: any) => ({ tip: b.beyanTipi, durum: b.durum, tutar: b.tahakkukTutari })),
      }));
      const oq: any[] = Array.isArray(onayR?.data) ? onayR.data : onayR?.data?.items || [];
      ov.onay = oq.slice(0, 20).map((p: any) => {
        const ai = p.aiKarari || {};
        const aiKod = ai.kategori || ai.hesapKodu || (Array.isArray(ai.onerilenler) && ai.onerilenler[0] && (ai.onerilenler[0].kategori || ai.onerilenler[0].hesapKodu)) || '';
        const gec = p.gecmisBeklenen || {};
        return {
          id: p.id, firma: p.firmaUnvan || p.mukellef || '—', belge: p.belgeNo || '',
          tutar: p.tutar != null ? `₺${Math.round(Number(p.tutar)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '',
          ai: aiKod, gecmis: gec.kategori || gec.top || '',
        };
      });
      const rows: any[] = ozetR?.data?.rows || [];
      if (rows.length) {
        const sorted = [...rows].sort((a, b) => {
          const ia = BEYAN_ORDER.indexOf(a.beyanTipi);
          const ib = BEYAN_ORDER.indexOf(b.beyanTipi);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        ov.beyanname = sorted
          .filter((r) => (r.toplam || 0) > 0 && AYRI_TIP.indexOf(r.beyanTipi) < 0)
          .slice(0, 8)
          .map((r) => ({
            ad: TIP_LABEL[r.beyanTipi] || r.beyanTipi,
            rawTip: r.beyanTipi,
            toplam: r.toplam || 0,
            onayli: r.onaylanan || 0,
            bekleyen: r.bekleyen || 0,
            hatali: r.hatali || 0,
            kalan: r.kalan || 0,
            vd: r.vergiDonem || '',
            route: TIP_ROUTE[r.beyanTipi] || 'm:beyanname',
            sub: r.kalan <= 0 && (r.hatali || 0) <= 0 ? 'Tamamlandı' : `${r.vergiDonem || donem} dönemi`,
          }));
        const kdv = rows.find((r) => r.beyanTipi === 'KDV1');
        if (kdv) ov.kdvMutabik = `${kdv.onaylanan || 0}/${kdv.toplam || 0}`;
        // Portaldaki gibi ayrı bölüm: Bildirge (SGK) + E-Defter
        const bild = rows.find((r) => r.beyanTipi === 'BILDIRGE');
        const edef = rows.find((r) => r.beyanTipi === 'EDEFTER');
        ov.ekstra = {
          bildirge: bild ? { toplam: bild.toplam || 0, onaylanan: bild.onaylanan || 0, kalan: bild.kalan || 0, vd: bild.vergiDonem || '' } : null,
          edefter: edef ? { toplam: edef.toplam || 0, onaylanan: edef.onaylanan || 0, kalan: edef.kalan || 0, vd: edef.vergiDonem || '' } : null,
        };
      }
      const c = wfR?.data?.counts;
      if (c) ov.workflow = { evrak: c.evrak || 0, islenme: c.islenme || 0, kontrol: c.kontrol || 0, beyanname: c.beyanname || 0, tamam: c.tamam || 0 };
      // Sayaç kartları (portaldaki Aktif Mükellef / Bekleyen Görev / Aktif İş Yükü)
      const wfTotal = wfR?.data?.total ?? (c ? (c.evrak || 0) + (c.islenme || 0) + (c.kontrol || 0) + (c.beyanname || 0) + (c.tamam || 0) : 0);
      const isYuku = c ? (c.islenme || 0) + (c.kontrol || 0) + (c.beyanname || 0) : 0;
      const tItems: any[] = Array.isArray(tasksR?.data) ? tasksR.data : tasksR?.data?.items || [];
      const notDone = tItems.filter((t: any) => !(t.done || t.completed || t.tamamlandi || t.status === 'DONE'));
      const bugunStr = new Date().toDateString();
      const gorevBugun = notDone.filter((t: any) => {
        const dv = t.dueDate || t.dueAt || t.sonTarih || t.tarih;
        return dv && new Date(dv).toDateString() === bugunStr;
      }).length;
      ov.stat = { wfTotal, isYuku, kontrol: c?.kontrol || 0, beyan: c?.beyanname || 0, gorev: notDone.length, gorevBugun };
      if (Object.keys(ov).length) inject('window.MOREN && window.MOREN.applyOverview(' + JSON.stringify(ov) + ')');
    } catch {
      /* özet çekilemezse örnek görünüm kalır */
    }
  }

  // Mükellef tarafı canlı veri: taxpayer girişinde /portal/* uçlarını çek
  async function loadTaxpayer() {
    try {
      const { year } = ym();
      const [dash, beyan, fat, cari, teb, sgk, evrak] = await Promise.all([
        api.get('/portal/dashboard').catch(() => null),
        api.get('/portal/beyannameler').catch(() => null),
        api.get('/portal/faturalar', { params: { yil: year } }).catch(() => null),
        api.get('/portal/cari').catch(() => null),
        api.get('/portal/tebligatlar').catch(() => null),
        api.get('/portal/sgk').catch(() => null),
        api.get('/portal/evraklar').catch(() => null),
      ]);
      const td = {
        dashboard: dash?.data || null,
        beyannameler: Array.isArray(beyan?.data) ? beyan.data : [],
        faturalar: fat?.data || null,
        cari: cari?.data || null,
        tebligatlar: Array.isArray(teb?.data) ? teb.data : [],
        sgk: Array.isArray(sgk?.data) ? sgk.data : [],
        evraklar: Array.isArray(evrak?.data) ? evrak.data : [],
      };
      inject('window.MOREN && window.MOREN.applyTaxpayer(' + JSON.stringify(td) + ')');
    } catch {
      /* mükellef verisi çekilemezse örnek görünüm kalır */
    }
  }

  // Modül canlı veri: modül açılınca ilgili portal ucundan çekip HTML'e enjekte et
  function pushModule(module: string, client: string, data: any) {
    inject('window.MOREN && window.MOREN.applyModule(' + JSON.stringify(module) + ',' + JSON.stringify(client) + ',' + JSON.stringify(data) + ')');
  }

  async function loadModule(module: string, client: string, donemArg?: string | null) {
    try {
      const donem = donemArg || ym().donem;
      const hasClient = !!client && client !== 'all';
      if (module === 'kdv-panosu') {
        // Ofis geneli KDV durum panosu
        const { data } = await api.get('/kdv-beyanname/genel-bakis', { params: { donem } });
        pushModule('kdv-panosu', client, data);
      } else if (module === 'cari' && hasClient) {
        // Seçili mükellefin cari kasası: bakiye + hareket + hizmet
        const [bakiyeR, hareketR, hizmetR] = await Promise.all([
          api.get(`/cari-kasa/bakiye/${client}`).catch(() => null),
          api.get('/cari-kasa/hareket', { params: { taxpayerId: client, limit: 100 } }).catch(() => null),
          api.get('/cari-kasa/hizmet', { params: { taxpayerId: client } }).catch(() => null),
        ]);
        const hareketler = Array.isArray(hareketR?.data)
          ? [...hareketR.data].sort((a: any, b: any) => new Date(b.tarih).getTime() - new Date(a.tarih).getTime())
          : [];
        pushModule('cari', client, {
          bakiye: bakiyeR?.data || null,
          hareketler,
          hizmetler: Array.isArray(hizmetR?.data) ? hizmetR.data : [],
        });
      } else if (module === 'beyanname') {
        // İndirilmiş beyanname/tahakkuk kayıtları (ofis geneli, son kayıtlar)
        const { data } = await api.get('/beyan-kayitlari', { params: { limit: 1500 } });
        const list: any[] = Array.isArray(data) ? data : data?.items || data?.data || [];
        const mapped = list.map((r: any) => {
          const t = r.taxpayer || {};
          const ad = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || r.taxpayerId || '—';
          return {
            ad,
            ini: inits(ad),
            beyanTipi: r.beyanTipi,
            donem: r.donem,
            tahakkukTutari: r.tahakkukTutari ?? r.odemeTutari,
            hasBeyanname: !!(r.beyannameUrl || r.pdfUrl),
          };
        });
        pushModule('beyanname', client, mapped);
      } else if (module === 'faturalar') {
        // MIHSAP faturaları (seçili mükellef varsa ona göre)
        const params: any = { donem, limit: 5000 };
        if (hasClient) params.mukellefId = client;
        const { data } = await api.get('/agent/mihsap/invoices', { params });
        const inv: any[] = Array.isArray(data) ? data : data?.items || [];
        const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
        const list = inv.slice(0, 300).map((r: any) => {
          const yon = String(r.faturaTuru || '');
          const tur = yon.includes('SATIS') ? 'Satış' : 'Alış';
          const d = r.faturaTarihi ? new Date(r.faturaTarihi) : null;
          return {
            id: r.id,
            firma: r.firmaUnvan || '—',
            kimlik: r.firmaKimlikNo || '—',
            tur,
            belge: r.faturaNo || '—',
            tarih: d ? `${d.getDate()} ${AY[d.getMonth()]}` : '',
            tutar: (Number(r.toplamTutar) || 0) === 0 ? '—' : `₺${Math.round(Number(r.toplamTutar)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`,
            durum: String(r.belgeTuru || '').replace('_', ' '),
          };
        });
        let alis = 0, satis = 0, alisT = 0, satisT = 0;
        inv.forEach((r: any) => {
          const yon = String(r.faturaTuru || '');
          const tut = Number(r.toplamTutar) || 0;
          if (yon.includes('SATIS')) { satis++; satisT += tut; } else { alis++; alisT += tut; }
        });
        pushModule('faturalar', client, { list, counts: { toplam: inv.length, alis, alisTutar: alisT, satis, satisTutar: satisT } });
      } else if (module === 'mizan' && hasClient) {
        // Seçili mükellefin en güncel mizanı + denetim bulguları
        const listR = await api.get('/mizan', { params: { taxpayerId: client } });
        const list: any[] = Array.isArray(listR.data) ? listR.data : [];
        const pick = [...list].sort(
          (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime(),
        )[0];
        if (pick?.id) {
          const { data } = await api.get(`/mizan/${pick.id}`);
          pushModule('mizan', client, data);
        }
      } else if (module === 'kdv-kontrol' && hasClient) {
        // Seçili mükellefin KDV Kontrol seansları (Luca↔fatura mutabakat)
        const sesR = await api.get('/kdv-control/sessions').catch(() => null);
        const all: any[] = Array.isArray(sesR?.data) ? sesR.data : [];
        const mine = all
          .filter((s) => String(s.taxpayerId) === String(client))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const TYPE: any = { KDV_191: 'Bilanço·Alış', KDV_391: 'Bilanço·Satış', ISLETME_GELIR: 'İşletme·Satış', ISLETME_GIDER: 'İşletme·Gider' };
        const latest = mine[0];
        let aktif: any = null;
        if (latest) {
          let stats: any = null;
          try { stats = (await api.get(`/kdv-control/sessions/${latest.id}/stats`)).data; } catch {}
          const ms = stats || latest.matchSummary || {};
          aktif = {
            tur: TYPE[latest.type] || latest.type || '—', donem: latest.periodLabel || '',
            durum: latest.status === 'COMPLETED' ? 'Kilitli' : 'Hazır', kilitli: latest.status === 'COMPLETED',
            lucaSatir: stats?.totalRecords ?? latest._count?.kdvRecords ?? 0, fatura: stats?.totalImages ?? latest._count?.images ?? 0,
            ocr: stats?.totalImages ?? 0, ocrTeyit: stats?.needsOcrConfirm ?? 0, matched: ms.matched ?? 0,
            incele: ms.reviewTotal ?? stats?.reviewTotal ?? 0, hatali: ms.amountMismatch ?? stats?.amountMismatch ?? 0,
          };
        }
        const gecmis = mine.slice(0, 20).map((s) => {
          const ms = s.matchSummary || {};
          return { ini: 'K', c: '#8cbde8', t: (s.periodLabel || '') + ' · ' + (TYPE[s.type] || s.type || ''), s: 'Luca ' + (s._count?.kdvRecords ?? 0) + ' / Fatura ' + (s._count?.images ?? 0), right: 'Eşleşen ' + (ms.matched ?? 0), badge: s.status === 'COMPLETED' ? 'Kilitli' : 'İncele', bc: s.status === 'COMPLETED' ? 'b-green' : 'b-amber' };
        });
        let incele: any[] = [];
        if (latest?.id) {
          try {
            const resR = await api.get(`/kdv-control/sessions/${latest.id}/results`);
            const res: any[] = Array.isArray(resR.data) ? resR.data : [];
            const SLB: any = { NEEDS_REVIEW: ['İncele', 'b-amber'], PARTIAL_MATCH: ['Kısmi', 'b-amber'], MISMATCH: ['Uyuşmaz', 'b-rose'], UNMATCHED: ['Eşleşmedi', 'b-rose'] };
            incele = res.filter((r) => SLB[r.status]).slice(0, 30).map((r) => {
              const kr = r.kdvRecord || {}; const im = r.image || {};
              const belge = kr.belgeNo || im.confirmedBelgeNo || im.ocrBelgeNo || '—';
              const sb = SLB[r.status];
              return { ic: 'search', c: '#e2b877', t: 'Belge ' + belge, s: (r.mismatchReasons && r.mismatchReasons.length ? r.mismatchReasons.join(', ') : ('Skor %' + Math.round((r.matchScore || 0) * 100))), badge: sb[0], bc: sb[1] };
            });
          } catch {}
        }
        pushModule('kdv-kontrol', client, { aktif, gecmis, incele });
      } else if (module === 'edefter' && hasClient) {
        // Seçili mükellefin e-Defter kontrol seansı (bulgular + fiş + mizan denetimi)
        const listR = await api.get('/edefter-control', { params: { taxpayerId: client } }).catch(() => null);
        const list: any[] = Array.isArray(listR?.data) ? listR.data : [];
        const pick = [...list].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0];
        let out: any = { yok: true };
        if (pick?.id) {
          const { data } = await api.get(`/edefter-control/${pick.id}`);
          const LV: any = { ERROR: 'e', WARN: 'w', INFO: 'i' };
          const bulgular = (data?.findings || []).slice(0, 60).map((fd: any) => ({ lvl: LV[fd.severity] || 'i', t: fd.category || 'Bulgu', s: (fd.message || '') + (fd.status ? ' · ' + (fd.status === 'RESOLVED' ? 'Çözüldü' : fd.status === 'IGNORED' ? 'Görmezden' : 'Açık') : '') }));
          const anom = (data?.companionMizan?.anomaliler || []).map((a: any) => ({ lvl: LV[a.seviye] || 'i', t: a.tip || 'Anomali', s: a.mesaj || '' }));
          const fisSatir = (data?.lines || []).slice(0, 60).map((l: any) => {
            const b = Number(l.borc) || 0, al = Number(l.alacak) || 0;
            const tut = b >= al ? b : al;
            return { ic: 'doc', c: '#8cbde8', t: (l.fisNo ? 'Fiş ' + l.fisNo : 'Satır ' + (l.rowIndex ?? '')) + ' · ' + (l.hesapKodu || ''), s: (l.hesapAdi || l.aciklama || '').slice(0, 40), right: tut ? `₺${Math.round(tut).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '' };
          });
          out = { yok: false, donem: data?.donem || pick.donem || '', bulgular, anom, fisSatir, lines: data?.totalLines ?? pick.totalLines ?? 0, vouchers: data?.totalVouchers ?? pick.totalVouchers ?? 0 };
        }
        pushModule('edefter', client, out);
      } else if (module === 'banka') {
        // Ofis geneli banka ekstre takibi (dönem bazlı)
        const { data } = await api.get('/banka-takip/list', { params: { donem } });
        const items: any[] = data?.items || [];
        const grup = (durum: string) => items.filter((it: any) => {
          const oz = it.ozet || {};
          if (durum === 'hesapsiz') return (oz.hesapSayisi || 0) === 0;
          if (durum === 'eksik') return (oz.eksikGeldi || 0) > 0;
          if (durum === 'islenecek') return oz.tumGeldi && !oz.tumIslendi;
          return oz.tumIslendi;
        }).map((it: any) => {
          const t = it.taxpayer || {};
          const ad = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '—';
          const oz = it.ozet || {};
          return { ini: inits(ad), c: '#8cbde8', t: ad, s: (oz.hesapSayisi || 0) + ' hesap' + (oz.eksikGeldi ? ' · ' + oz.eksikGeldi + ' eksik' : '') };
        });
        const total = items.length;
        const tamam = items.filter((it: any) => it.ozet?.tumIslendi).length;
        pushModule('banka', client, {
          eksik: grup('eksik'), islenecek: grup('islenecek'), tamam: grup('tamam'), hesapsiz: grup('hesapsiz'),
          tamamlanma: total ? Math.round((tamam / total) * 100) : 0,
        });
      } else if (module === 'sgk') {
        // Ofis geneli SGK belgeleri
        const { data } = await api.get('/portal-automation/documents', { params: { belgeTuru: 'SGK_TAHAKKUK,SGK_HIZMET_LISTESI', limit: 0 } });
        const docs: any[] = Array.isArray(data) ? data : data?.items || [];
        const list = docs.slice(0, 200).map((d: any) => {
          const t = d.taxpayer || {};
          const ad = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
          const raw = d.raw || {};
          const tur = d.belgeTuru === 'SGK_TAHAKKUK' ? 'Tahakkuk Fişi' : 'Hizmet Listesi';
          return { ini: inits(ad), muk: ad, tur, tip: d.belgeTuru === 'SGK_TAHAKKUK' ? 't' : 'h', donem: d.period || raw.donem || '', mah: raw.belgeMahiyeti || 'Asıl', kanun: raw.kanunNo || '—', cal: raw.calisan || '—', tutar: d.belgeTuru === 'SGK_TAHAKKUK' && raw.tutar ? `₺${Math.round(Number(raw.tutar)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '—', seen: !!d.viewedAt };
        });
        pushModule('sgk', client, { list });
      } else if (module === 'tebligat') {
        // Ofis geneli e-Tebligat + sayaçlar
        const [docsR, sumR] = await Promise.all([
          api.get('/portal-automation/documents', { params: { belgeTuru: 'E_TEBLIGAT', limit: 0 } }).catch(() => null),
          api.get('/portal-automation/summary').catch(() => null),
        ]);
        const docs: any[] = Array.isArray(docsR?.data) ? docsR.data : docsR?.data?.items || [];
        const list = docs.slice(0, 200).map((d: any) => {
          const t = d.taxpayer || {};
          const ad = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
          const raw = d.raw || {};
          return { id: d.id, ini: inits(ad), muk: ad, kurum: raw.kurumAciklama || 'GİB', tur: d.title || 'Tebligat', no: d.referenceNo || '—', tarih: d.issuedAt ? new Date(d.issuedAt).toLocaleDateString('tr-TR') : '', seen: !!d.viewedAt };
        });
        const st = sumR?.data?.stats || {};
        const cr = sumR?.data?.credentials || {};
        pushModule('tebligat', client, { list, sayac: { toplam: st.tebligatTotal ?? docs.length, yeni: st.tebligat7d ?? 0, sifreli: cr.eTebligatTaxpayerCount ?? 0, hata: st.tebligatErrorCount ?? 0 } });
      } else if (module === 'evrak') {
        // Ofis geneli evrak arşivi
        const { data } = await api.get('/documents');
        const docs: any[] = Array.isArray(data) ? data : data?.items || [];
        const typeTag = (d: any) => {
          const s = `${d.documentType || d.category || d.title || d.name || ''}`.toLowerCase();
          if (s.indexOf('fatur') >= 0) return 'Fatura';
          if (s.indexOf('sözles') >= 0 || s.indexOf('sozles') >= 0) return 'Sözleşme';
          if (s.indexOf('tebligat') >= 0) return 'Tebligat';
          if (s.indexOf('banka') >= 0) return 'Banka';
          return 'Diğer';
        };
        const list = docs.slice(0, 300).map((d: any) => {
          const t = d.taxpayer || {};
          const ad = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
          const sz = Number(d.size || d.sizeBytes || 0);
          const szf = sz > 1048576 ? (sz / 1048576).toFixed(1) + ' MB' : Math.round(sz / 1024) + ' KB';
          return { ad: d.name || d.fileName || d.title || 'Belge', muk: ad, tur: typeTag(d), boyut: szf, ocr: d.ocrCompleted === true };
        });
        const now = new Date();
        const buAy = docs.filter((d: any) => { const c = d.createdAt ? new Date(d.createdAt) : null; return c && c.getMonth() === now.getMonth() && c.getFullYear() === now.getFullYear(); }).length;
        const ocrN = docs.filter((d: any) => d.ocrCompleted === true).length;
        const totalSize = docs.reduce((a: number, d: any) => a + Number(d.size || d.sizeBytes || 0), 0);
        pushModule('evrak', client, { list, sayac: { toplam: docs.length, buAy, ocrYuzde: docs.length ? Math.round((ocrN / docs.length) * 100) : 0, depolama: totalSize > 1073741824 ? (totalSize / 1073741824).toFixed(1) + ' GB' : Math.round(totalSize / 1048576) + ' MB' } });
      } else if (module === 'gelir' && hasClient) {
        // Gelir Tablosu — mükellefin en güncel tablosu (ham detay, biçimleme HTML'de)
        const listR = await api.get('/gelir-tablosu', { params: { taxpayerId: client } }).catch(() => null);
        const list: any[] = Array.isArray(listR?.data) ? listR.data : [];
        const pick = [...list].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0];
        if (pick?.id) { const { data } = await api.get(`/gelir-tablosu/${pick.id}`); pushModule('gelir', client, data); }
        else pushModule('gelir', client, { yok: true });
      } else if (module === 'bilanco' && hasClient) {
        // Bilanço — mükellefin en güncel bilançosu
        const listR = await api.get('/bilanco', { params: { taxpayerId: client } }).catch(() => null);
        const list: any[] = Array.isArray(listR?.data) ? listR.data : [];
        const pick = [...list].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0];
        if (pick?.id) { const { data } = await api.get(`/bilanco/${pick.id}`); pushModule('bilanco', client, data); }
        else pushModule('bilanco', client, { yok: true });
      } else if (module === 'hesap-ozeti' && hasClient) {
        // İşletme Hesap Özeti — yıl bazında 4 çeyrek
        const y = ym().year;
        const r = await api.get(`/isletme-hesap-ozeti/yil/${client}/${y}`).catch(() => null);
        pushModule('hesap-ozeti', client, r?.data || { yok: true });
      } else if (module === 'mihsap') {
        // MIHSAP ajan paneli: bağlantı + onay kuyruğu (bekleyen belgeler + AI önerisi)
        const [sesR, cntR, qR, statsR] = await Promise.all([
          api.get('/agent/mihsap/session').catch(() => null),
          api.get('/onay-kuyrugu/count').catch(() => null),
          api.get('/onay-kuyrugu', { params: { durum: 'bekliyor', limit: 20 } }).catch(() => null),
          api.get('/agent/stats').catch(() => null),
        ]);
        const ses = sesR?.data || {};
        const st = statsR?.data || {};
        const bekleyenSayi = cntR?.data?.bekleyen ?? 0;
        const qlist: any[] = Array.isArray(qR?.data) ? qR.data : qR?.data?.items || [];
        const bekleyen = qlist.slice(0, 10).map((p: any) => {
          const ai = p.aiKarari || {};
          const aiKod = ai.kategori || ai.hesapKodu || (Array.isArray(ai.onerilenler) && ai.onerilenler[0] && (ai.onerilenler[0].kategori || ai.onerilenler[0].hesapKodu)) || '';
          const gec = p.gecmisBeklenen || {};
          return {
            firma: p.firmaUnvan || p.mukellef || '—',
            tutar: p.tutar != null ? `₺${Math.round(Number(p.tutar)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '—',
            belge: p.belgeNo || '', ai: aiKod, gecmis: gec.kategori || gec.top || '',
          };
        });
        pushModule('mihsap', client, { bagli: ses.connected === true, email: ses.email || '', bekleyenSayi, bekleyen, onayAy: st.buAy ?? 0, islemGun: st.buGun ?? 0, hataGun: st.hataBugun ?? 0 });
      } else if (module === 'is-akisi' || module === 'aylik-takip') {
        // İş akışı kuyruğu (ortak uç): aşama sayaçları + gruplu mükellef listeleri
        const { year, month } = ym();
        const { data } = await api.get('/taxpayers/workflow/queue', { params: { year, month } });
        const counts = data?.counts || {};
        const grouped = data?.grouped || {};
        const nm = (x: any) => x.taxpayerName || x.companyName || '—';
        const STG = [
          { key: 'EVRAK_BEKLIYOR', t: 'Evrak', stage: 'evrak', cnt: counts.evrak || 0, bc: 'b-rose', st: 'Evrak' },
          { key: 'ISLENMEYI_BEKLIYOR', t: 'İşleme', stage: 'islem', cnt: counts.islenme || 0, bc: 'b-amber', st: 'İşlem' },
          { key: 'KONTROL_BEKLIYOR', t: 'Kontrol', stage: 'kontrol', cnt: counts.kontrol || 0, bc: 'b-sky', st: 'Kontrol' },
          { key: 'BEYANNAME_BEKLIYOR', t: 'Beyanname', stage: 'beyan', cnt: counts.beyanname || 0, bc: 'b-green', st: 'Beyanname' },
          { key: 'TAMAM', t: 'Tamam', stage: 'verildi', cnt: counts.tamam || 0, bc: 'b-green', st: 'Verildi' },
        ];
        if (module === 'is-akisi') {
          const stages = STG.map((s) => {
            const arr: any[] = Array.isArray(grouped[s.key]) ? grouped[s.key] : [];
            const clients = arr.slice(0, 6).map((x: any) => ({ ini: inits(nm(x)), t: nm(x), s: x.bekleyenGun != null ? x.bekleyenGun + ' gündür bekliyor' : (x.actionLabel || s.t), right: x.actionLabel || '', badge: s.st, bc: s.bc }));
            if (arr.length > 6) clients.push({ ic: 'users', t: '+ ' + (arr.length - 6) + ' mükellef daha', s: s.t.toLowerCase() + ' aşamasında' } as any);
            return { t: s.t, c: s.cnt, clients };
          });
          pushModule('is-akisi', client, { stages });
        } else {
          const list: any[] = [];
          STG.forEach((s) => (Array.isArray(grouped[s.key]) ? grouped[s.key] : []).forEach((x: any) => {
            const ck = [x.evraklarGeldi ? 1 : 0, x.evraklarIslendi ? 1 : 0, x.kontrolEdildi ? 1 : 0, x.kontrolEdildi ? 1 : 0, x.kontrolEdildi ? 1 : 0, x.beyannameVerildi ? 1 : 0];
            list.push({ id: String(x.taxpayerId || ''), ini: inits(nm(x)), n: nm(x), dur: x.actionLabel || s.st, ck, st: s.st, bc: s.bc, stage: s.stage });
          }));
          pushModule('aylik-takip', client, { counts: { takip: data?.total || list.length, evrak: counts.evrak || 0, islenme: counts.islenme || 0, kontrol: counts.kontrol || 0, beyanname: counts.beyanname || 0, tamam: counts.tamam || 0 }, list });
        }
      } else if (module === 'gorevler') {
        // Görevler & Notlar
        const { data } = await api.get('/tasks', { params: { isTemplate: 'false', limit: 100 } });
        const items: any[] = Array.isArray(data) ? data : data?.items || [];
        const bugun = new Date().toDateString();
        const list = items.map((t: any) => {
          const done = t.status === 'DONE' || t.done || t.completed;
          const due = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = !!(due && !done && due < new Date(bugun));
          const isToday = !!(due && due.toDateString() === bugun);
          const badge = done ? 'Tamam' : overdue ? 'Gecikmiş' : isToday ? 'Bugün' : 'Açık';
          const bc = done ? 'b-green' : overdue ? 'b-rose' : isToday ? 'b-amber' : 'b-sky';
          const col = overdue ? '#f0909f' : isToday ? '#e8b667' : done ? '#8fd7bd' : '#8cbde8';
          const pr = t.priority === 'URGENT' || t.priority === 'HIGH' ? 'yüksek öncelik' : t.priority === 'LOW' ? 'düşük öncelik' : 'orta öncelik';
          const sub = t.description ? String(t.description).slice(0, 60) : ((due ? due.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : (t.category || 'genel')) + ' · ' + pr);
          return { ic: 'task', c: col, t: t.title || 'Görev', s: sub, badge, bc };
        });
        pushModule('gorevler', client, { list, acik: list.filter((x) => x.badge !== 'Tamam').length, gecikmis: list.filter((x) => x.badge === 'Gecikmiş').length });
      } else if (module === 'ajanlar') {
        // Tüm ajanlar durumu
        const [statR, statsR, healthR] = await Promise.all([
          api.get('/agent/status').catch(() => null),
          api.get('/agent/stats').catch(() => null),
          api.get('/agent/health-summary').catch(() => null),
        ]);
        const stat: any[] = Array.isArray(statR?.data) ? statR.data : [];
        const st = statsR?.data || {};
        const nameMap: any = { mihsap: 'Mihsap', luca: 'Luca Operatör', beyanname: 'Beyanname toplayıcı', tebligat: 'e-Tebligat', sgk: 'SGK', galeri: 'HGS / Galeri', earsiv: 'e-Arşiv' };
        const now = Date.now();
        const list = stat.map((a: any) => {
          const ping = a.lastPing ? new Date(a.lastPing).getTime() : 0;
          const fresh = !!(ping && (now - ping) < 5 * 60 * 1000);
          const running = a.running === true;
          return { dot: running && fresh ? 'g' : running ? 'a' : 'r', t: nameMap[a.agent] || a.agent || 'Ajan', s: a.controlState || (running ? 'çalışıyor' : 'durdu'), badge: running ? (fresh ? 'Aktif' : 'Geçişte') : 'Planlı', bc: running && fresh ? 'b-green' : running ? 'b-amber' : 'b-sky' };
        });
        pushModule('ajanlar', client, { list, sayac: { onay: st.buAy ?? 0, islem: st.buGun ?? 0, hata: st.hata ?? st.hataBugun ?? 0, bekleyen: healthR?.data?.totals?.pendingLucaJobs ?? 0 } });
      } else if (module === 'saglik') {
        // Sağlık: cihazlar + iş sayaçları
        const { data } = await api.get('/agent/health-summary');
        const agents: any[] = Array.isArray(data?.agents) ? data.agents : [];
        const totals = data?.totals || {};
        const now = Date.now();
        const devices: any[] = [];
        agents.forEach((a: any) => (Array.isArray(a.devices) ? a.devices : []).forEach((d: any) => {
          const ping = d.lastPing ? new Date(d.lastPing).getTime() : 0;
          const secs = ping ? Math.round((now - ping) / 1000) : null;
          const online = d.running && !d.stale;
          devices.push({ dot: online ? 'g' : 'r', t: d.workerName || d.deviceId || 'Cihaz', s: (a.displayName || a.agent || '') + (secs != null ? ' · son ping ' + (secs < 60 ? secs + ' sn' : Math.round(secs / 60) + ' dk') : ''), badge: online ? 'Online' : 'Offline', bc: online ? 'b-green' : 'b-rose' });
        }));
        pushModule('saglik', client, { devices, sayac: { aktif: totals.activeJobs || 0, bekleyen: totals.pendingLucaJobs || 0, tamam: totals.doneToday || 0, hata: totals.failedToday || 0 } });
      } else if (module === 'otomasyon') {
        const [sumR, listR] = await Promise.all([
          api.get('/automations/summary').catch(() => null),
          api.get('/automations', { params: { pageSize: 50 } }).catch(() => null),
        ]);
        const s = sumR?.data || {};
        const items: any[] = listR?.data?.items || (Array.isArray(listR?.data) ? listR.data : []);
        const list = items.map((a: any) => ({ t: a.title || 'Otomasyon', s: (a.triggerType === 'SCHEDULE' ? 'Zamanlı' : (a.triggerType || 'Tetikleyici')) + (a._count?.runs != null ? ' · ' + a._count.runs + ' çalışma' : ''), on: a.status === 'ACTIVE' }));
        pushModule('otomasyon', client, { list, sayac: { aktif: s.active ?? 0, basarili: s.weeklySuccess ?? 0, hata: s.weeklyFailure ?? 0, maliyet: s.monthlyCostUsd != null ? '$' + Number(s.monthlyCostUsd).toFixed(1) : '—' } });
      } else if (module === 'sablonlar') {
        const { data } = await api.get('/message-templates');
        const items: any[] = Array.isArray(data) ? data : data?.items || [];
        const list = items.map((t: any) => ({ ad: t.ad || 'Şablon', kategori: t.kategori || 'genel', kanal: t.kanal || 'WHATSAPP', kullanim: t.kullanimSayisi || 0, favori: !!t.favori, body: String(t.body || '').slice(0, 90) }));
        pushModule('sablonlar', client, { list });
      } else if (module === 'hgs') {
        const [ozR, arR] = await Promise.all([
          api.get('/galeri/ozet').catch(() => null),
          api.get('/galeri/araclar').catch(() => null),
        ]);
        const oz = ozR?.data || {};
        const arac: any[] = Array.isArray(arR?.data) ? arR.data : arR?.data?.items || [];
        const list = arac.slice(0, 60).map((v: any) => {
          const son = v.sonSorgu || {};
          const tut = son.toplamTutar || 0;
          return { plaka: v.plakaGorunum || v.plaka || '—', muk: [v.marka, v.model].filter(Boolean).join(' ') || v.sahipAd || '', tutar: tut ? '₺' + Math.round(tut).toLocaleString('tr-TR') : '₺0', ihlal: son.ihlalSayisi || 0 };
        });
        pushModule('hgs', client, { list, sayac: { arac: oz.toplamArac || arac.length, ihlalli: oz.ihlalliArac || 0, ihlal: oz.toplamIhlal || 0, tutar: oz.toplamTutar ? '₺' + Math.round(oz.toplamTutar).toLocaleString('tr-TR') : '₺0' } });
      } else if (module === 'bot-kalite') {
        const [sumR, logR] = await Promise.all([
          api.get('/whatsapp/quality/summary').catch(() => null),
          api.get('/whatsapp/quality/logs', { params: { limit: 20 } }).catch(() => null),
        ]);
        const s = sumR?.data || {};
        const logs: any[] = Array.isArray(logR?.data) ? logR.data : logR?.data?.items || [];
        const list = logs.slice(0, 20).map((l: any) => ({ t: l.source || l.status || 'Cevap', s: l.createdAt ? new Date(l.createdAt).toLocaleString('tr-TR') : '', puan: l.score != null ? l.score : '—', dusuk: l.status === 'low' || (l.score != null && l.score < 6) }));
        pushModule('bot-kalite', client, { list, sayac: { cevap: s.count ?? 0, puan: s.averageScore != null ? Number(s.averageScore).toFixed(1) : '—', dusuk: s.lowQualityCount ?? 0, maliyet: s.estimatedTry != null ? '₺' + Math.round(s.estimatedTry) : (s.costUsd != null ? '$' + Number(s.costUsd).toFixed(2) : '—') } });
      } else if (module === 'profiller') {
        const { data } = await api.get('/agent/rules');
        const items: any[] = Array.isArray(data) ? data : data?.items || [];
        const list = items.slice(0, 100).map((r: any) => {
          const p = r.profile || {};
          return { muk: r.mukellef || '—', sektor: p.sektor || r.faaliyet || '—', defter: p.defterTuru || r.defterTuru || '—', cari: p.cariFormat || p.cariTakipPolitikasi || '—' };
        });
        pushModule('profiller', client, { list });
      } else if (module === 'fis-yazdirma') {
        const { data } = await api.get('/fis-yazdirma/outputs', { params: { limit: 50 } }).catch(() => ({ data: [] }));
        const items: any[] = Array.isArray(data) ? data : (data as any)?.items || [];
        const list = items.map((o: any) => ({ muk: o.mukellefName || '—', donem: o.donem || '', fis: o.fileCount || 0, yazildi: o.printStatus === 'DONE' || !!o.printedAt }));
        pushModule('fis-yazdirma', client, { list });
      } else if (module === 'hatirlatmalar') {
        const [waR, tahR] = await Promise.all([
          api.get('/whatsapp/status').catch(() => null),
          api.get('/cari-kasa/tahsilat-ajandasi').catch(() => null),
        ]);
        const wa = waR?.data || {};
        const tah: any[] = Array.isArray(tahR?.data) ? tahR.data : tahR?.data?.rows || tahR?.data?.items || [];
        const list = tah.slice(0, 60).map((c: any) => {
          const bak = Number(c.bakiye ?? c.acikBakiye ?? 0);
          const ad = c.taxpayerName || c.unvan || c.ad || '—';
          return { ini: inits(ad), muk: ad, tel: c.telefon || c.phone || '', bakiye: bak ? '₺' + Math.round(bak).toLocaleString('tr-TR') : '', gonder: bak > 0 };
        });
        pushModule('hatirlatmalar', client, { list, waHazir: wa.ready === true });
      } else if (module === 'masaustu') {
        const r = await api.get('/desktop/installer/version').catch(() => null);
        const d = r?.data || {};
        pushModule('masaustu', client, { surum: d.version || '', boyut: d.sizeBytes ? Math.round(d.sizeBytes / 1048576) + ' MB' : '', mevcut: d.available !== false, dosya: d.filename || '' });
      } else if (module === 'luca') {
        const [sesR, skR] = await Promise.all([
          api.get('/luca/session').catch(() => null),
          api.get('/luca-operator/skills').catch(() => null),
        ]);
        const ses = sesR?.data || {};
        const skills: any[] = Array.isArray(skR?.data) ? skR.data : skR?.data?.items || [];
        pushModule('luca', client, { bagli: ses.connected === true || ses.ready === true, beceriSayisi: skills.length, beceriler: skills.slice(0, 8).map((s: any) => s.ad || s.label || s.name || s.title || 'Beceri') });
      } else if (module === 'e-arsiv') {
        // GİB e-Arşiv/e-Fatura sorgu sonuçları — 4 gruba ayır (Gelen/Giden × E-Arşiv/E-Fatura)
        const params: any = { pageSize: 500 };
        if (hasClient) params.taxpayerId = client;
        if (donem) params.donem = donem;
        const { data } = await api.get('/earsiv/list', { params });
        const items: any[] = Array.isArray(data) ? data : data?.items || data?.rows || [];
        const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
        const PAL = ['#8fd7bd', '#8cbde8', '#e2b877', '#f0a0a8', '#c3a6e6', '#d9a06c'];
        const grp: any = { ga: [], gia: [], gf: [], gif: [] };
        items.slice(0, 400).forEach((r: any, i: number) => {
          const isEf = String(r.belgeKaynak) === 'EFATURA';
          const isSatis = String(r.tip) === 'SATIS';
          const key = isEf ? (isSatis ? 'gif' : 'gf') : (isSatis ? 'gia' : 'ga');
          const t = r.taxpayer || {};
          const name = (isSatis ? r.alici : r.satici) || r.satici || r.alici || r.karsiUnvan || r.karsiTaraf || r.unvan || t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
          const dd = r.faturaTarihi ? new Date(r.faturaTarihi) : null;
          const tut = Number(r.toplamTutar || r.tutar || 0);
          const kim = r.ettn ? ('ETTN ' + String(r.ettn).slice(0, 6) + '…') : (r.faturaNo || '');
          grp[key].push({ ini: inits(name), c: PAL[i % PAL.length], name, sub: kim + (dd ? ' · ' + dd.getDate() + ' ' + AY[dd.getMonth()] : ''), tutar: tut ? '₺' + Math.round(tut).toLocaleString('tr-TR') : '—', id: r.id });
        });
        pushModule('e-arsiv', client, grp);
      } else if (module === 'whatsapp') {
        // WhatsApp mükellef sohbetleri (okuma) — kendi try/catch'i: hata/boş durumu göster, örneğe düşme
        try {
          const { data } = await api.get('/whatsapp/conversations', { timeout: 20000 });
          const arr: any[] = Array.isArray(data) ? data : data?.items || data?.conversations || data?.data || [];
          const PAL = ['#8cbde8', '#8fd7bd', '#e2b877', '#f0a0a8', '#c3a6e6', '#d9a06c'];
          const convos = arr.slice(0, 60).map((c: any, i: number) => {
            const nm = c.taxpayerName || c.name || c.unvan || 'Mükellef';
            const at = c.lastMessageAt || c.lastAt || c.occurredAt;
            let time = '';
            if (at) { const s = Math.round((Date.now() - new Date(at).getTime()) / 1000); time = s < 60 ? s + ' sn' : s < 3600 ? Math.round(s / 60) + ' dk' : s < 86400 ? Math.round(s / 3600) + ' sa' : Math.round(s / 86400) + ' gün'; }
            return { i: inits(nm), t: nm, s: c.lastMessage || c.sonMesaj || '', time, u: (c.unreadCount || c.unread || 0) > 0 ? String(c.unreadCount || c.unread) : '', bg: `linear-gradient(160deg,${PAL[i % PAL.length]},#0000)`, cid: c.taxpayerId || c.conversationId || '' };
          });
          pushModule('whatsapp', client, { convos });
        } catch (e: any) {
          pushModule('whatsapp', client, { convos: [], err: e?.response?.status ? ('Sunucu ' + e.response.status) : 'Bağlantı hatası' });
        }
      }
    } catch {
      /* modül verisi çekilemezse örnek görünüm kalır */
    }
  }

  // Gerçek işlem butonları: OCR belge yükleme + fetch/sorgu tetikleme
  async function handleAction(reqId: number, action: string, client: string, donem: string | null, params: any) {
    const done = (ok: boolean, msg?: string) =>
      inject('window.MOREN && window.MOREN.actionDone(' + reqId + ',' + (ok ? 'true' : 'false') + ',' + JSON.stringify(msg || '') + ')');
    try {
      if (action === 'upload') {
        // OCR belge(ler)ini Fatura İşleme Merkezi'ne yükle (dönem OCR tarihinden okunur → period gönderilmez)
        if (!lastDoc.current.length) { done(false, 'Önce belge tara'); return; }
        const tid = params?.taxpayerId || client;
        const fd = new FormData();
        lastDoc.current.forEach((uri, i) => fd.append('files', { uri, name: `belge-${i + 1}.jpg`, type: 'image/jpeg' } as any));
        if (tid && tid !== 'all') fd.append('taxpayerId', String(tid));
        fd.append('invoiceKind', params?.invoiceKind || 'ALIS');
        fd.append('source', 'mobil-app');
        await api.post('/fatura-muhasebelestirme/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const n = lastDoc.current.length;
        lastDoc.current = [];
        done(true, n + ' belge gönderildi');
      } else if (action === 'fatura-cek') {
        const body: any = { donem: donem || ym().donem, kaynak: 'arsiv' };
        if (client && client !== 'all') body.mukellefId = client;
        if (params?.faturaTuru) body.faturaTuru = params.faturaTuru;
        await api.post('/agent/mihsap/fetch', body);
        done(true, 'Çekme başladı');
      } else if (action === 'tebligat-sorgula') {
        await api.post('/portal-automation/manual-run', { scope: 'tebligat', force: true });
        done(true, 'Sorgu başladı');
      } else if (action === 'sgk-sorgula') {
        await api.post('/portal-automation/manual-run', { scope: 'sgk', jobTypes: ['SGK_HIZMET_LISTESI', 'SGK_TAHAKKUK'], force: true });
        done(true, 'Sorgu başladı');
      } else if (action === 'onay-onayla') {
        const oid = params?.id;
        if (!oid) { done(false, 'Kayıt bulunamadı'); return; }
        await api.post(`/onay-kuyrugu/${encodeURIComponent(String(oid))}/onayla`, {});
        done(true, 'Onaylandı');
        loadOverview();
      } else if (action === 'onay-reddet') {
        const oid = params?.id;
        if (!oid) { done(false, 'Kayıt bulunamadı'); return; }
        await api.post(`/onay-kuyrugu/${encodeURIComponent(String(oid))}/reddet`, {});
        done(true, 'Reddedildi');
        loadOverview();
      } else if (action === 'gorev-ekle') {
        const title = String(params?.title || '').trim();
        if (!title) { done(false, 'Başlık gerekli'); return; }
        const body: any = { title };
        if (params?.dueDate) body.dueDate = params.dueDate;
        if (params?.priority) body.priority = params.priority;
        if (params?.category) body.category = params.category;
        if (params?.description) body.description = params.description;
        await api.post('/tasks', body);
        done(true, 'Görev eklendi');
        loadOverview();
      } else {
        done(false, 'Tanımsız işlem');
      }
    } catch (e: any) {
      done(false, e?.response?.data?.message || 'Bağlantı hatası');
    }
  }

  // Fatura belgesinin gerçek görüntüsü: /mihsap/invoices/:id/file (kimlikli) → base64 → HTML'e enjekte
  async function loadInvoiceDoc(id: string) {
    if (!id) {
      inject('window.MOREN && window.MOREN.applyInvoiceDoc(null,null)');
      return;
    }
    try {
      const resp = await api.get(`/agent/mihsap/invoices/${id}/file`, { responseType: 'arraybuffer' });
      const buf = resp.data as ArrayBuffer;
      const head = new Uint8Array(buf);
      // Sunucu content-type'ı güvenilmez (octet-stream/boş gelebiliyor) → gerçek türü BAYTLARDAN tanı
      let ct: string;
      if (head[0] === 0xff && head[1] === 0xd8) ct = 'image/jpeg';
      else if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) ct = 'image/png';
      else if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) ct = 'application/pdf';
      else if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) ct = 'image/gif';
      else ct = 'application/xml'; // e-Fatura/e-Arşiv XML (ya da bilinmeyen metin)
      const b64 = arrayBufferToBase64(buf);
      if (ct === 'application/xml') {
        // ham kod gösterme → HTML'de gömülü XSLT ile render et (olmazsa özet)
        inject('window.MOREN && window.MOREN.applyInvoiceXml(' + JSON.stringify(b64) + ')');
      } else {
        const dataUri = `data:${ct};base64,${b64}`;
        inject('window.MOREN && window.MOREN.applyInvoiceDoc(' + JSON.stringify(dataUri) + ',' + JSON.stringify(ct) + ')');
      }
    } catch {
      inject('window.MOREN && window.MOREN.applyInvoiceDoc(null,null)');
    }
  }

  function gotDocs(uris: string[]) {
    if (!uris.length) return;
    lastDoc.current = uris;
    inject('window.MOREN && window.MOREN.docCaptured && window.MOREN.docCaptured(true,' + uris.length + ')');
  }

  async function openCamera() {
    // 1) Gerçek belge tarayıcı (native VisionKit / ML Kit) — kenar algılar, otomatik çeker, çok sayfa.
    //    Expo Go'da native modül bağlı olmadığından hata verir → düz kameraya düşer.
    try {
      const DocumentScanner = require('react-native-document-scanner-plugin').default;
      const { scannedImages, status } = await DocumentScanner.scanDocument({ maxNumDocuments: 10, croppedImageQuality: 80 });
      if (status === 'cancel') return;
      if (Array.isArray(scannedImages) && scannedImages.length) { gotDocs(scannedImages); return; }
    } catch {
      /* Expo Go: native tarayıcı yok → düz kamera */
    }
    // 2) Fallback: düz kamera (Expo Go)
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Kamera izni', 'Belge taramak için kamera izni gerekli.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) gotDocs([res.assets[0].uri]);
  }

  async function openGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsMultipleSelection: true });
    if (!res.canceled && res.assets?.length) gotDocs(res.assets.map((a) => a.uri));
  }

  async function biometric() {
    const has = await LocalAuthentication.hasHardwareAsync();
    if (!has) return;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return;
    await LocalAuthentication.authenticateAsync({ promptMessage: 'MOREN MÜŞAVİR — biyometrik giriş' });
  }

  // Açılışta: kayıtlı bilgi varsa Face ID / parmak izi iste, geçilince otomatik giriş yap.
  async function tryAutoLogin() {
    if (autoTried.current) return;
    autoTried.current = true;
    try {
      const raw = await getStoredItem(CREDS_KEY);
      if (!raw) return;
      const creds = JSON.parse(raw);
      if (!creds?.email || !creds?.password) return;
      const audience: 'advisor' | 'taxpayer' = creds.audience === 'taxpayer' ? 'taxpayer' : 'advisor';
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hasHw && (await LocalAuthentication.isEnrolledAsync());
      if (hasHw && enrolled) {
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: 'MOREN MÜŞAVİR — giriş',
          cancelLabel: 'Vazgeç',
        });
        if (!res.success) {
          // Face ID reddedilir/iptal edilirse: e-postayı doldur, şifreyi kullanıcı girsin
          inject('window.__morenPrefill && window.__morenPrefill(' + JSON.stringify({ email: creds.email, audience }) + ')');
          return;
        }
      }
      await handleLogin(creds.email, creds.password, audience, true);
    } catch {
      /* otomatik giriş başarısızsa normal giriş ekranı gösterilir */
    }
  }

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'login') handleLogin((msg.email || '').trim(), msg.password || '', msg.audience === 'taxpayer' ? 'taxpayer' : 'advisor', msg.remember !== false);
      else if (msg.type === 'module') loadModule(msg.module, String(msg.client ?? ''), msg.donem || null);
      else if (msg.type === 'invoice') loadInvoiceDoc(String(msg.id ?? ''));
      else if (msg.type === 'action') handleAction(Number(msg.reqId) || 0, String(msg.action || ''), String(msg.client ?? ''), msg.donem || null, msg.params || {});
      else if (msg.type === 'scan') openCamera();
      else if (msg.type === 'gallery') openGallery();
      else if (msg.type === 'biometric') biometric();
      else if (msg.type === 'haptic') {
        const st = msg.payload;
        if (st === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        else if (st === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        else if (st === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      else if (msg.type === 'refresh') doRefresh(msg.payload || {});
      else if (msg.type === 'logout') doLogout();
      else if (msg.type === 'notif-read') {
        const nid = msg.payload;
        if (nid === 'all') api.patch('/notifications/read-all').then(loadNotifications).catch(() => {});
        else if (nid) api.patch('/notifications/' + encodeURIComponent(String(nid)) + '/read').then(loadNotifications).catch(() => {});
      }
      else if (msg.type === 'ai-chat') doAiChat(msg.payload || {});
      else if (msg.type === 'wa-thread') doWaThread(msg.payload || {});
      else if (msg.type === 'doc-view') doDocView(String(msg.kind || ''), String(msg.id || ''));
      else if (msg.type === 'wa-send') doWaSend(msg.payload || {});
    } catch {}
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrap}>
        {uri ? (
          // @ts-ignore web iframe — önizleme (native köprü yok, demo giriş)
          <iframe src={uri} style={{ border: 'none', width: '100%', height: '100%', background: '#080706' }} title="MOREN MÜŞAVİR" />
        ) : null}
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={[styles.wrap, styles.center]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        source={{ uri }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        setSupportMultipleWindows={false}
        overScrollMode="never"
        injectedJavaScript={BRIDGE}
        onMessage={onMessage}
        onLoadEnd={tryAutoLogin}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#080706' },
  center: { alignItems: 'center', justifyContent: 'center' },
  web: { flex: 1, backgroundColor: '#080706' },
});
