/**
 * Paket: sayfalar (2026-09-13) — portala sonradan eklenen, mobilde olmayan sayfaların RN tarafı.
 * HTML: design/ek/30-sayfalar.html (İletim Raporu · Aylık Ödeme Listesi · Denetim Günlüğü · Kişisel Bütçe).
 *
 * Her yükleyici hatayı YUTMAZ: {hata:'…'} olarak HTML'e verir ki ekran "Yükleniyor…"da asılı kalmasın.
 * Uçlar apps/api controller'larındaki gerçek uçlardır; alan uydurulmaz.
 */
import type { EkBaglam, EkPaket } from './tur';

/** Sunucu/ağ hatasını kısa, okunur metne çevirir */
function hataMetni(e: any): string {
  const st = e?.response?.status;
  const msg = e?.response?.data?.message;
  if (st) return typeof msg === 'string' && msg && msg.length < 80 ? msg : 'Sunucu ' + st;
  return 'Bağlantı hatası';
}

/* ======================================================================
   a) İLETİM RAPORU — GET /akilli-bildirim/report?month=YYYY-MM (akilli-bildirim.controller.ts)
   ====================================================================== */
async function iletimRaporu(ctx: EkBaglam) {
  const month = ctx.donem;
  try {
    const { data } = await ctx.api.get('/akilli-bildirim/report', { params: { month } });
    ctx.pushModule('iletim-raporu', ctx.client, {
      month: data?.month || month,
      totals: data?.totals || {},
      taxpayers: Array.isArray(data?.taxpayers) ? data.taxpayers : [],
    });
  } catch (e: any) {
    ctx.pushModule('iletim-raporu', ctx.client, { month, hata: hataMetni(e) });
  }
}

/* ======================================================================
   b) AYLIK ÖDEME LİSTESİ — GET /aylik-odeme?month · GET /aylik-odeme/eksikler?month (aylik-odeme.controller.ts)
      Gönderim ucu (POST /aylik-odeme/send) mobilden ÇAĞRILMAZ.
   ====================================================================== */
async function aylikOdeme(ctx: EkBaglam) {
  const month = ctx.donem;
  try {
    const [liste, eksik] = await Promise.all([
      ctx.api.get('/aylik-odeme', { params: { month } }),
      // Eksikler yalnız bilgi amaçlı; bu uç düşerse liste yine gösterilir
      ctx.api.get('/aylik-odeme/eksikler', { params: { month } }).catch(() => ({ data: null as any })),
    ]);
    const ek = eksik?.data || {};
    ctx.pushModule('aylik-odeme', ctx.client, {
      month,
      list: Array.isArray(liste.data) ? liste.data : [],
      eksik: Array.isArray(ek.eksik) ? ek.eksik : [],
      bilgi: { donem: ek.donem || null, sgkDonemi: ek.sgkDonemi || null, takipUyeSayisi: ek.takipUyeSayisi ?? null },
    });
  } catch (e: any) {
    ctx.pushModule('aylik-odeme', ctx.client, { month, hata: hataMetni(e) });
  }
}

/* ======================================================================
   d) DENETİM GÜNLÜĞÜ — GET /audit-logs?limit&offset&action · GET /audit-logs/daily-stats?days (audit.controller.ts, yalnız ADMIN)
      Tür süzgeci HTML'den 'denetim-yukle' aksiyonuyla gelir (sunucu tarafı süzme).
   ====================================================================== */
const DENETIM_LIMIT = 60;
/** Son seçilen tür süzgeci — modül kapatılıp açılınca HTML'deki seçimle aynı kalsın (ikisi de oturum belleğinde) */
let denetimFiltre = '';
async function denetimYukle(ctx: EkBaglam, action?: string) {
  const act = action && /^[A-Z_]+$/.test(action) ? action : '';
  try {
    const [logs, stats] = await Promise.all([
      ctx.api.get('/audit-logs', { params: { limit: DENETIM_LIMIT, offset: 0, action: act || undefined } }),
      ctx.api.get('/audit-logs/daily-stats', { params: { days: 14 } }).catch(() => ({ data: [] as any[] })),
    ]);
    ctx.pushModule('denetim-gunlugu', ctx.client, {
      action: act,
      items: Array.isArray(logs.data?.items) ? logs.data.items : [],
      total: Number(logs.data?.total) || 0,
      stats: Array.isArray(stats.data) ? stats.data : [],
    });
  } catch (e: any) {
    const st = e?.response?.status;
    ctx.pushModule('denetim-gunlugu', ctx.client, {
      action: act,
      hata: st === 403 ? 'Denetim günlüğünü yalnız yönetici (ADMIN) hesabı görebilir' : hataMetni(e),
    });
  }
}

/* ======================================================================
   e) KİŞİSEL BÜTÇE — butce.controller.ts (OwnerOnlyGuard → yetkisizde 404; ButcePinGuard → biletsiz 403 BUTCE_PIN_GEREKLI)
      PIN bileti: POST /butce/pin/ac {pin} → {bilet,bitis}. Bilet YALNIZ bellekte tutulur (webdeki sessionStorage karşılığı);
      cihaza yazılmaz, uygulama kapanınca gider. PIN'in kendisi hiçbir yerde saklanmaz.
   ====================================================================== */
let butceBilet: { bilet: string; bitis: number } | null = null;

function biletGecerli(): boolean {
  if (!butceBilet) return false;
  // bitis: sunucunun verdiği son geçerlilik anı (ms). Süresi dolduysa hiç deneme, PIN ekranına dön.
  if (butceBilet.bitis && Date.now() >= Number(butceBilet.bitis)) { butceBilet = null; return false; }
  return true;
}

/** Yetki + PIN durumu → HTML'e {yetkisiz} ya da {acik:false, pin:{kurulu,kilitli,kilitBitis,kalanDeneme}} */
async function butceDurum(ctx: EkBaglam) {
  try {
    await ctx.api.get('/butce/erisim');
  } catch (e: any) {
    const st = e?.response?.status;
    ctx.pushModule('butce', ctx.client, st === 404 || st === 403 ? { yetkisiz: true } : { hata: hataMetni(e) });
    return;
  }
  try {
    const { data } = await ctx.api.get('/butce/pin/durum');
    ctx.pushModule('butce', ctx.client, {
      acik: false,
      pin: {
        kurulu: !!data?.kurulu,
        kilitli: !!data?.kilitli,
        kilitBitis: data?.kilitBitis || null,
        kalanDeneme: data?.kalanDeneme ?? null,
      },
    });
  } catch (e: any) {
    ctx.pushModule('butce', ctx.client, { hata: hataMetni(e) });
  }
}

/** Biletle özet: GET /butce/ozet?donem&defter=TUMU (X-Butce-Pin). Bilet düşmüşse (403) PIN ekranına döner. */
async function butceOzet(ctx: EkBaglam) {
  if (!biletGecerli()) { await butceDurum(ctx); return; }
  try {
    const { data } = await ctx.api.get('/butce/ozet', {
      params: { donem: ctx.donem, defter: 'TUMU' },
      headers: { 'X-Butce-Pin': butceBilet!.bilet },
    });
    ctx.pushModule('butce', ctx.client, { acik: true, donem: ctx.donem, ozet: data || {} });
  } catch (e: any) {
    const st = e?.response?.status;
    const msg = String(e?.response?.data?.message || '');
    if (st === 403 && msg.includes('BUTCE_PIN_GEREKLI')) { butceBilet = null; await butceDurum(ctx); return; }
    if (st === 404) { butceBilet = null; ctx.pushModule('butce', ctx.client, { yetkisiz: true }); return; }
    ctx.pushModule('butce', ctx.client, { hata: hataMetni(e) });
  }
}

export const paket: EkPaket = {
  yukleyiciler: {
    'iletim-raporu': iletimRaporu,
    'aylik-odeme': aylikOdeme,
    'denetim-gunlugu': (ctx) => denetimYukle(ctx, denetimFiltre),
    'butce': butceOzet,
  },
  aksiyonlar: {
    /** Denetim günlüğü tür süzgeci: {action:'CREATE'|'UPDATE'|'DELETE'|'LOGIN'|''} */
    'denetim-yukle': async (ctx, params) => {
      denetimFiltre = String(params?.action || '');
      await denetimYukle(ctx, denetimFiltre);
      return { ok: true };
    },
    /** PIN doğrula → bilet belleğe → özet. PIN cihazda saklanmaz. */
    'butce-pin': async (ctx, params) => {
      const pin = String(params?.pin || '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(pin)) return { ok: false, msg: 'PIN 6 haneli olmalı' };
      try {
        const { data } = await ctx.api.post('/butce/pin/ac', { pin });
        if (!data?.bilet) return { ok: false, msg: 'Bilet alınamadı' };
        butceBilet = { bilet: String(data.bilet), bitis: Number(data.bitis) || 0 };
        await butceOzet(ctx);
        return { ok: true, msg: 'Açıldı' };
      } catch (e: any) {
        // Yanlış PIN / kilit: sunucu mesajı (kalan deneme) ekrana yansısın, PIN durumu tazelensin
        const msg = e?.response?.data?.message;
        await butceDurum(ctx);
        return { ok: false, msg: typeof msg === 'string' && msg ? msg : 'PIN doğrulanamadı' };
      }
    },
    /** Modülü kilitle: bileti bellekten sil, PIN ekranına dön (sunucuya çağrı gerekmez) */
    'butce-kilitle': async (ctx) => {
      butceBilet = null;
      await butceDurum(ctx);
      return { ok: true, msg: 'Kilitlendi' };
    },
  },
};
