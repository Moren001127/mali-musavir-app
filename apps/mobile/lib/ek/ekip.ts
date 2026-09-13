/**
 * Paket: ekip — Moren Ekip Konsolu (2026-09-13). HTML tarafı: design/ek/20-ekip.html (modül id 'ekip').
 *
 * Portal uçları (apps/api/src/ekip/ekip.controller.ts, JWT):
 *   GET  /ekip/akis?gun=7&filtre=tumu&limit=200[&taxpayerId]  → {vakalar[], sayaclar{suruyor,onay,istek,bitti,gecikti}, pencere}
 *   GET  /ekip/durum                                            → {operator, bekleyenOnay, bugunkuKosu, sabahOzeti, maxBagli, calisan, bugunHata, sonSabahOzeti, akis}
 *   GET  /ekip/kadro                                            → {ajanlar[12]} (suAn / sonKosu / bekleyenOnay / bugunKosu / calisiyor)
 *   POST /ekip/koordinator/calistir {gorev, taxpayerId?, dryRun, vakaId?} → SSE (text/event-stream); koşu ARKA PLANDA sürer.
 *        Telefonda akış beklenmez: ilk 'baslangic' olayı (isId) yakalanınca bağlantı bırakılır, akış 5 sn'de bir tazelenir (en çok 3 dk).
 *   POST /ekip/onaylar/:previewId/onayla {onayMetni} · POST /ekip/onaylar/:previewId/reddet {not}
 *   POST /ekip/istek/:bildirimId/kapat · GET /ekip/isler/:id (rapor) · POST /ekip/isler/:id/iptal (durdur)
 *
 * Süzgeç (Sürüyor / Onayınızı bekleyen / Sizden istenen / Bitti) HTML tarafında; yükleyici 7 günün tüm vakalarını çeker.
 * Seçili mükellef varsa akış ona süzülür ve komut ona bağlanır (üstteki mükellef çubuğu). Kuru/Canlı anahtarı HTML'de; varsayılan KURU.
 */
import axios, { type AxiosInstance } from 'axios';
import type { EkBaglam, EkPaket } from './tur';

const MODUL = 'ekip';
const AKIS_LIMIT = 200;
const TAZELEME_MS = 5_000;
const TAZELEME_TAVAN_MS = 180_000;
const BASLANGIC_BEKLEME_MS = 30_000;

type IsDurumu = 'pending' | 'running' | 'done' | 'failed';

interface VakaAdim {
  tip: 'is' | 'onay' | 'bildirim';
  isId?: string;
  id?: string;
  ajanId?: string;
  baslik: string;
  durum: string;
  baslangic: string;
  bitis?: string | null;
  raporOzet?: string | null;
  hata?: string | null;
  devir?: number | null;
  kuru?: boolean;
  hedef?: string | null;
  confirmationText?: string | null;
  tur?: 'onay' | 'istek' | 'bilgi';
  govde?: string | null;
}

interface Vaka {
  vakaId: string;
  mukellef: { id: string; ad: string } | null;
  konu: string;
  kuru: boolean;
  kimde: { ajanId: string; ad: string };
  durum: 'suruyor' | 'bitti' | 'hata';
  kutu: 'suruyor' | 'onay' | 'istek' | 'bitti';
  guncellendi: string;
  gecikti: boolean;
  olusturuldu: string;
  adimlar: VakaAdim[];
  acikKalemler: Array<{ tip: 'onay' | 'istek'; id: string; baslik: string; kaynak: 'PRV' | 'bildirim'; confirmationText?: string | null }>;
}

interface Sayaclar {
  suruyor: number;
  onay: number;
  istek: number;
  bitti: number;
  gecikti: number;
}

interface EkipVeri {
  akis: { vakalar: Vaka[]; sayaclar: Sayaclar; pencere: { gun: number; baslangic: string } } | null;
  durum: any | null;
  kadro: any[] | null;
  hata?: string;
  yuklendi: string;
}

const kes = (v: any, n: number): string | null => {
  if (v == null) return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

function sayaclariNormalle(s: any): Sayaclar {
  return { suruyor: Number(s?.suruyor || 0), onay: Number(s?.onay || 0), istek: Number(s?.istek || 0), bitti: Number(s?.bitti || 0), gecikti: Number(s?.gecikti || 0) };
}

function adimNormalle(a: any): VakaAdim | null {
  if (!a || typeof a !== 'object') return null;
  if (a.tip === 'is') {
    return {
      tip: 'is',
      isId: String(a.isId || ''),
      ajanId: String(a.ajanId || 'koordinator'),
      baslik: String(a.baslik || ''),
      durum: (['pending', 'running', 'done', 'failed'] as IsDurumu[]).includes(a.durum) ? a.durum : 'pending',
      baslangic: String(a.baslangic || ''),
      bitis: a.bitis ?? null,
      raporOzet: kes(a.raporOzet, 300),
      hata: kes(a.hata, 300),
      devir: typeof a.devir === 'number' ? a.devir : null,
      kuru: a.kuru !== false,
    };
  }
  if (a.tip === 'onay') {
    return {
      tip: 'onay',
      id: String(a.id || a.previewId || ''),
      ajanId: String(a.ajanId || ''),
      baslik: String(a.baslik || ''),
      durum: ['PENDING', 'EXECUTED', 'REJECTED', 'EXPIRED'].includes(a.durum) ? a.durum : 'PENDING',
      baslangic: String(a.baslangic || ''),
      hedef: a.hedef ?? null,
      confirmationText: kes(a.confirmationText, 400),
    };
  }
  if (a.tip === 'bildirim') {
    return {
      tip: 'bildirim',
      id: String(a.id || ''),
      tur: a.tur === 'onay' || a.tur === 'istek' ? a.tur : 'bilgi',
      baslik: String(a.baslik || ''),
      govde: kes(a.govde, 600),
      durum: a.durum === 'kapandi' ? 'kapandi' : 'acik',
      baslangic: String(a.baslangic || ''),
    };
  }
  return null;
}

function vakaNormalle(v: any): Vaka | null {
  if (!v || !v.vakaId) return null;
  const adimlar = (Array.isArray(v.adimlar) ? v.adimlar : []).map(adimNormalle).filter(Boolean) as VakaAdim[];
  const kutu = (['suruyor', 'onay', 'istek', 'bitti'] as Vaka['kutu'][]).includes(v.kutu) ? v.kutu : v.durum === 'suruyor' ? 'suruyor' : 'bitti';
  const ilkIs = adimlar.find((a) => a.tip === 'is');
  return {
    vakaId: String(v.vakaId),
    mukellef: v.mukellef && v.mukellef.id ? { id: String(v.mukellef.id), ad: String(v.mukellef.ad || v.mukellef.id) } : null,
    konu: String(v.konu || ilkIs?.baslik || ''),
    kuru: v.kuru !== false,
    kimde: { ajanId: String(v.kimde?.ajanId || 'koordinator'), ad: String(v.kimde?.ad || (v.kimde?.ajanId === 'siz' ? 'Muzaffer Bey' : 'Koordinatör')) },
    durum: v.durum === 'bitti' || v.durum === 'hata' ? v.durum : 'suruyor',
    kutu,
    guncellendi: String(v.guncellendi || v.olusturuldu || ''),
    gecikti: v.gecikti === true,
    olusturuldu: String(v.olusturuldu || v.guncellendi || ''),
    adimlar,
    acikKalemler: (Array.isArray(v.acikKalemler) ? v.acikKalemler : [])
      .filter((k: any) => k && k.id && (k.tip === 'onay' || k.tip === 'istek'))
      .map((k: any) => ({ tip: k.tip, id: String(k.id), baslik: String(k.baslik || ''), kaynak: k.kaynak === 'bildirim' ? 'bildirim' : 'PRV', confirmationText: kes(k.confirmationText, 400) })),
  };
}

/** Kadro satırı — HTML'in kullandığı alanlar (araç listeleri/açıklamalar atılır; 12 ajan ≈ 22 KB → küçük). */
function kadroSatiriNormalle(a: any) {
  const suAn = a?.suAn && typeof a.suAn === 'object' && (a.suAn.vakaId || a.suAn.isId)
    ? {
        vakaId: String(a.suAn.vakaId || a.suAn.isId),
        isId: String(a.suAn.isId || a.suAn.vakaId),
        mukellefId: a.suAn.mukellefId ?? a.suAn.taxpayerId ?? null,
        mukellefAd: a.suAn.mukellefAd ?? null,
        konu: kes(a.suAn.konu || a.suAn.gorev, 120) || '',
        basladi: String(a.suAn.basladi || a.suAn.startedAt || a.suAn.createdAt || ''),
      }
    : null;
  return {
    id: String(a?.id || ''),
    ad: String(a?.ad || a?.id || ''),
    unvan: String(a?.unvan || ''),
    model: a?.model || null,
    sonKosu: a?.sonKosu ? { status: a.sonKosu.status || null, createdAt: a.sonKosu.createdAt || null, dryRun: a.sonKosu.dryRun !== false } : null,
    bekleyenOnay: Number(a?.bekleyenOnay || 0),
    bugunKosu: Number(a?.bugunKosu || 0),
    calisiyor: a?.calisiyor === true || !!suAn,
    suAn,
  };
}

function hataMetni(e: any, varsayilan: string): string {
  const m = e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message;
  return typeof m === 'string' && m ? m : varsayilan;
}

/** Akış + durum + kadro — paralel; biri düşerse diğerleri yine gelir (hata alanında yazar). Üçü de düşerse fırlatır. */
async function ekipYukle(api: AxiosInstance, client: string, hasClient: boolean): Promise<EkipVeri> {
  const hatalar: string[] = [];
  const [akisR, durumR, kadroR] = await Promise.all([
    api
      .get('/ekip/akis', { params: { gun: 7, filtre: 'tumu', limit: AKIS_LIMIT, taxpayerId: hasClient ? client : undefined } })
      .catch((e) => (hatalar.push('Akış: ' + hataMetni(e, 'alınamadı')), null)),
    api.get('/ekip/durum').catch((e) => (hatalar.push('Durum: ' + hataMetni(e, 'alınamadı')), null)),
    api.get('/ekip/kadro').catch((e) => (hatalar.push('Kadro: ' + hataMetni(e, 'alınamadı')), null)),
  ]);
  if (!akisR && !durumR && !kadroR) throw new Error(hatalar.join(' · ') || 'Ekip verisi alınamadı');
  const akisData: any = akisR?.data;
  const akis = akisData
    ? {
        vakalar: (Array.isArray(akisData.vakalar) ? akisData.vakalar : []).map(vakaNormalle).filter(Boolean) as Vaka[],
        sayaclar: sayaclariNormalle(akisData.sayaclar),
        pencere: { gun: Number(akisData.pencere?.gun) || 7, baslangic: String(akisData.pencere?.baslangic || '') },
      }
    : null;
  const d: any = durumR?.data;
  const durum = d
    ? {
        operator: { cevrimici: Boolean(d.operator?.cevrimici ?? d.operator?.acik), cihaz: d.operator?.cihaz ?? null },
        bekleyenOnay: Number(d.bekleyenOnay || 0),
        bugunkuKosu: Number(d.bugunkuKosu ?? d.bugunKosu ?? 0),
        sabahOzeti: d.sabahOzeti === true,
        maxBagli: d.maxBagli !== false,
        calisan: typeof d.calisan === 'number' ? d.calisan : null,
        bugunHata: typeof d.bugunHata === 'number' ? d.bugunHata : null,
        sonSabahOzeti: d.sonSabahOzeti && d.sonSabahOzeti.isId
          ? {
              isId: String(d.sonSabahOzeti.isId),
              createdAt: d.sonSabahOzeti.createdAt || null,
              finishedAt: d.sonSabahOzeti.finishedAt || null,
              status: d.sonSabahOzeti.status || null,
              raporIlkSatir: kes(d.sonSabahOzeti.raporIlkSatir, 200),
              hata: kes(d.sonSabahOzeti.hata, 200),
            }
          : null,
        akis: d.akis && typeof d.akis === 'object' ? sayaclariNormalle(d.akis) : null,
      }
    : null;
  const kadroList: any[] | null = kadroR?.data && Array.isArray(kadroR.data.ajanlar) ? kadroR.data.ajanlar.map(kadroSatiriNormalle) : null;
  return { akis, durum, kadro: kadroList, hata: hatalar.length ? hatalar.join(' · ') : undefined, yuklendi: new Date().toISOString() };
}

/** Yükle + HTML'e ver (applyModule → modül açıksa parçalı çizim). */
async function yukleVeIlet(ctx: EkBaglam): Promise<EkipVeri> {
  const veri = await ekipYukle(ctx.api, ctx.client, ctx.hasClient);
  ctx.pushModule(MODUL, ctx.client, veri);
  return veri;
}

const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function kosuIlet(ctx: EkBaglam, k: any) {
  ctx.inject('window.MOREN && window.MOREN.applyEkipKosu && window.MOREN.applyEkipKosu(' + JSON.stringify(k) + ')');
}

/** Akışta isId'li adımın durumu (yoksa null). */
function isDurumu(veri: EkipVeri, isId: string): IsDurumu | null {
  for (const v of veri.akis?.vakalar || []) {
    for (const a of v.adimlar) if (a.tip === 'is' && a.isId === isId) return a.durum as IsDurumu;
  }
  return null;
}

function birSeyKosuyor(veri: EkipVeri): boolean {
  if ((veri.durum?.calisan ?? 0) > 0) return true;
  if (veri.akis?.vakalar.some((v) => v.kutu === 'suruyor')) return true;
  return !!veri.kadro?.some((a) => a.suAn);
}

/** SSE metnindeki data: satırlarını ayrıştır (baslangic / done / error). */
function sseOlaylari(metin: string): Array<{ type: string; isId?: string; error?: string }> {
  const out: Array<{ type: string; isId?: string; error?: string }> = [];
  for (const parca of metin.split('\n\n')) {
    const satir = parca.trim();
    if (!satir.startsWith('data:')) continue;
    const yuk = satir.slice(5).trim();
    if (!yuk) continue;
    try {
      const o = JSON.parse(yuk);
      if (o && typeof o.type === 'string') out.push(o);
    } catch {
      /* yarım satır — bir sonraki ilerlemede tamamlanır */
    }
  }
  return out;
}

/**
 * Koordinatörü koştur. SSE'nin tamamı BEKLENMEZ: 'baslangic' (isId) gelince bağlantı kesilir (sunucu koşuyu sürdürür).
 * 30 sn içinde olay gelmezse de "başladı" sayılır (isId bilinmez; akış tazelemesi genel duruma bakar).
 */
async function komutBaslat(ctx: EkBaglam, body: { gorev: string; taxpayerId?: string; dryRun: boolean; vakaId?: string }) {
  const controller = new AbortController();
  let isId: string | null = null;
  let bitti = false;
  let hata: string | undefined;
  const isle = (metin: string) => {
    for (const o of sseOlaylari(metin)) {
      if (o.type === 'baslangic' && o.isId && !isId) isId = String(o.isId);
      if (o.type === 'done') { bitti = true; if (o.isId && !isId) isId = String(o.isId); }
      if (o.type === 'error') { bitti = true; hata = o.error || 'Koşu hatası'; if (o.isId && !isId) isId = String(o.isId); }
    }
  };
  try {
    const res = await ctx.api.post('/ekip/koordinator/calistir', { gorev: body.gorev, taxpayerId: body.taxpayerId || undefined, dryRun: body.dryRun, vakaId: body.vakaId || undefined }, {
      responseType: 'text',
      timeout: BASLANGIC_BEKLEME_MS,
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
      onDownloadProgress: (e: any) => {
        try {
          const xhr = e?.event?.target;
          const t = xhr && typeof xhr.responseText === 'string' ? xhr.responseText : '';
          if (t) isle(t);
          if (isId && !bitti) controller.abort(); // başlangıç yakalandı → bağlantıyı bırak; koşu sunucuda sürer
        } catch {
          /* ilerleme okunamadı — sonuç yine gelir */
        }
      },
    });
    if (typeof res.data === 'string') isle(res.data);
  } catch (e: any) {
    if (axios.isCancel(e) || e?.code === 'ERR_CANCELED') {
      /* biz kestik: başladı */
    } else if (e?.code === 'ECONNABORTED' || /timeout/i.test(String(e?.message || ''))) {
      /* 30 sn'de olay gelmedi — koşu sunucuda sürüyor olabilir; akış tazelemesi gösterir */
    } else if (e?.response?.status === 404) {
      hata = 'Ekip ucu bulunamadı (omurga yayında değil)';
    } else {
      hata = hataMetni(e, 'Koordinatör başlatılamadı');
    }
  }
  return { isId, bitti, hata };
}

/* Tek tazeleme döngüsü: yeni komut eskisini iptal eder. */
let dongu: { iptal: boolean } | null = null;

function donguBaslat(ctx: EkBaglam, isId: string | null) {
  if (dongu) dongu.iptal = true;
  const d = { iptal: false };
  dongu = d;
  void (async () => {
    const basla = Date.now();
    let gorduk = false;
    let ardArdaHata = 0;
    while (!d.iptal && Date.now() - basla < TAZELEME_TAVAN_MS) {
      await bekle(TAZELEME_MS);
      if (d.iptal) break;
      const veri = await yukleVeIlet(ctx).catch(() => null);
      if (!veri) {
        if (++ardArdaHata >= 3) break; // oturum düştü / ağ yok: döngüyü boşa döndürme
        continue;
      }
      ardArdaHata = 0;
      const kosuyor = birSeyKosuyor(veri);
      if (isId) {
        const du = isDurumu(veri, isId);
        if (du === 'done' || du === 'failed') break;
        if (du === null && !kosuyor && Date.now() - basla > 20_000) break; // akışta görünmedi, hiçbir şey koşmuyor
      } else if (kosuyor) gorduk = true;
      else if (gorduk) break;
    }
    if (!d.iptal) {
      await yukleVeIlet(ctx).catch(() => null); // koşan iş bitti: akışı son kez tazele
      kosuIlet(ctx, null);
    }
    if (dongu === d) dongu = null;
  })();
}

const sonucMesaji = (r: any, basarili: string, varsayilanHata: string) => (r && r.ok === true ? basarili : String((r && r.error) || varsayilanHata));

export const paket: EkPaket = {
  yukleyiciler: {
    [MODUL]: async (ctx) => {
      await yukleVeIlet(ctx);
    },
  },
  aksiyonlar: {
    /** Koordinatör'e görev: {gorev, taxpayerId?, dryRun, vakaId?} — SSE beklenmez; başlangıçtan sonra 5 sn'lik tazeleme (≤3 dk). */
    'ekip-komut': async (ctx, params) => {
      const gorev = String(params?.gorev || '').trim();
      if (!gorev) return { ok: false, msg: 'Görev metni boş' };
      const taxpayerId = String(params?.taxpayerId || (ctx.hasClient ? ctx.client : '') || '').trim() || undefined;
      const dryRun = params?.dryRun !== false; // varsayılan KURU
      const vakaId = params?.vakaId ? String(params.vakaId) : undefined;
      const basladi = Date.now();
      const r = await komutBaslat(ctx, { gorev, taxpayerId, dryRun, vakaId });
      if (r.hata && !r.isId) {
        kosuIlet(ctx, { gorev, basladi, bitti: true, hata: r.hata, dryRun });
        return { ok: false, msg: r.hata };
      }
      kosuIlet(ctx, { isId: r.isId, vakaId: vakaId || r.isId, gorev, basladi, bitti: r.bitti, hata: r.hata || null, dryRun });
      await yukleVeIlet(ctx).catch(() => null);
      if (r.bitti) {
        kosuIlet(ctx, null);
        return { ok: !r.hata, msg: r.hata || 'Koşu bitti' };
      }
      donguBaslat(ctx, r.isId);
      return { ok: true, msg: r.isId ? 'Koordinatör başladı' : 'Gönderildi — akışta görünecek' };
    },
    /** Onayla ve gönder: POST /ekip/onaylar/:previewId/onayla {onayMetni:'ONAYLIYORUM #PRV-…'} — dışarı gönderim GERÇEKTEN gider. */
    'ekip-onayla': async (ctx, params) => {
      const id = String(params?.id || '').trim();
      if (!id) return { ok: false, msg: 'Onay kaydı yok' };
      let r: any;
      try {
        r = (await ctx.api.post(`/ekip/onaylar/${encodeURIComponent(id)}/onayla`, { onayMetni: `ONAYLIYORUM #${id}` }, { timeout: 60_000 })).data;
      } catch (e: any) {
        r = { ok: false, error: hataMetni(e, 'Onaylanamadı') };
      }
      await yukleVeIlet(ctx).catch(() => null);
      return { ok: r?.ok === true, msg: sonucMesaji(r, 'Gönderildi ✓', 'Gönderilemedi') };
    },
    'ekip-reddet': async (ctx, params) => {
      const id = String(params?.id || '').trim();
      if (!id) return { ok: false, msg: 'Onay kaydı yok' };
      let r: any;
      try {
        r = (await ctx.api.post(`/ekip/onaylar/${encodeURIComponent(id)}/reddet`, { not: String(params?.not || 'Mobil uygulamadan reddedildi') })).data;
      } catch (e: any) {
        r = { ok: false, error: hataMetni(e, 'Reddedilemedi') };
      }
      await yukleVeIlet(ctx).catch(() => null);
      return { ok: r?.ok === true, msg: sonucMesaji(r, 'Reddedildi', 'Reddedilemedi') };
    },
    /** "Sizden istenen" kalemi yapıldı: POST /ekip/istek/:bildirimId/kapat */
    'ekip-istek-kapat': async (ctx, params) => {
      const id = String(params?.id || '').trim();
      if (!id) return { ok: false, msg: 'Kalem yok' };
      let r: any;
      try {
        r = (await ctx.api.post(`/ekip/istek/${encodeURIComponent(id)}/kapat`, {})).data;
      } catch (e: any) {
        r = { ok: false, error: hataMetni(e, 'Kapatılamadı') };
      }
      await yukleVeIlet(ctx).catch(() => null);
      return { ok: r?.ok === true, msg: r?.ok === true ? (r.zatenKapali ? 'Zaten kapalıydı' : 'Yapıldı ✓') : String(r?.error || 'Kapatılamadı') };
    },
    /** Rapor: GET /ekip/isler/:id → window.MOREN.applyEkipRapor(id, metin, meta) (HTML bloğu tanımlar). */
    'ekip-rapor': async (ctx, params) => {
      const id = String(params?.id || '').trim();
      if (!id) return { ok: false, msg: 'İş yok' };
      const argsKisa = (a: any) => {
        if (a == null) return null;
        try {
          const s = typeof a === 'string' ? a : JSON.stringify(a);
          return s.length > 160 ? s.slice(0, 160) + '…' : s;
        } catch {
          return null;
        }
      };
      const arac = (t: any) => ({ name: String(t?.name || ''), args: argsKisa(t?.args) });
      let metin = '';
      let meta: any = null;
      let hata: string | undefined;
      try {
        const { data } = await ctx.api.get(`/ekip/isler/${encodeURIComponent(id)}`);
        if (!data || data.error) hata = String(data?.error || 'İş dosyası bulunamadı');
        else {
          const res = data.result && typeof data.result === 'object' ? data.result : {};
          metin = typeof res.rapor === 'string' ? res.rapor : '';
          meta = {
            ajanId: data.ajanId || null,
            model: res.model || data.model || null,
            durationMs: res.durationMs ?? data.durationMs ?? null,
            status: data.status || null,
            dryRun: data.dryRun !== false,
            hata: res.hata || data.hata || null,
            vakaId: data.vakaId || id,
            gorev: kes(data.gorev, 300),
            toolUses: (Array.isArray(res.toolUses) ? res.toolUses : []).slice(0, 40).map(arac),
            kuruTestYapilacaktilar: (Array.isArray(res.kuruTestYapilacaktilar) ? res.kuruTestYapilacaktilar : []).slice(0, 40).map(arac),
            onayBekleyen: (Array.isArray(res.onayBekleyen) ? res.onayBekleyen : []).slice(0, 20).map((o: any) => (typeof o === 'string' ? o : { previewId: o?.previewId || null, name: o?.name || null, aciklama: o?.aciklama || null })),
            ogrenilen: (Array.isArray(res.ogrenilen) ? res.ogrenilen : []).slice(0, 20).map((x: any) => String(x)),
          };
        }
      } catch (e: any) {
        hata = e?.response?.status === 404 ? 'İş dosyası bulunamadı' : hataMetni(e, 'Rapor alınamadı');
      }
      if (hata && !meta) meta = { hata };
      ctx.inject('window.MOREN && window.MOREN.applyEkipRapor && window.MOREN.applyEkipRapor(' + JSON.stringify(id) + ',' + JSON.stringify(metin) + ',' + JSON.stringify(meta) + ')');
      return { ok: !hata, msg: hata || 'Rapor açıldı' };
    },
    /** Durdur: POST /ekip/isler/:id/iptal — iş dosyası failed + "iptal edildi (Muzaffer Bey)". */
    'ekip-durdur': async (ctx, params) => {
      const id = String(params?.id || '').trim();
      if (!id) return { ok: false, msg: 'İş yok' };
      let r: any;
      try {
        r = (await ctx.api.post(`/ekip/isler/${encodeURIComponent(id)}/iptal`, {}, { timeout: 15_000 })).data;
      } catch (e: any) {
        r = { ok: false, error: e?.response?.status === 404 ? 'İptal ucu bulunamadı' : hataMetni(e, 'Durdurma isteği gönderilemedi') };
      }
      if (dongu) dongu.iptal = true;
      kosuIlet(ctx, null);
      await yukleVeIlet(ctx).catch(() => null);
      return { ok: r?.ok === true, msg: sonucMesaji(r, 'Durduruldu', 'Durdurulamadı') };
    },
  },
};
