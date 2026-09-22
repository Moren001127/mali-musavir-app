import { api, authorizedFetch, API_BASE } from './api';

/**
 * Moren Ekip (11 kişilik dijital kadro) — API sözleşmesi.
 * Backend omurgası ayrı yazılıyor; uçlar 404 dönerse OmurgaYokError fırlatılır,
 * ekran "Omurga henüz yayında değil" gösterir (çökmez).
 * 2026-09-22 (PLAN/20 §D): iş düzeni (rutin) + kuyruk + kota bekçisi uçları eklendi; eski backend'de bu alanlar
 * gelmezse boş/varsayılan kullanılır, ekran çökmez.
 */

export type AjanId =
  | 'koordinator'
  | 'fatura'
  | 'beyanname'
  | 'bordro-sgk'
  | 'edefter'
  | 'luca-operator'
  | 'denetci'
  | 'analist'
  | 'mevzuat'
  | 'risk'
  | 'musteri';

export interface KademeOzeti {
  oku: number;
  portal_yaz: number;
  luca_yaz: number;
  disari_gonder: number;
}

/** İş kaynağı — 2026-09-22: `rutin` (iş düzeninden kendiliğinden) ve `toplu` (panodan seçilip personele verilen) eklendi. */
export type EkipKaynak = 'portal' | 'ses' | 'cron' | 'koordinator' | 'whatsapp' | 'rutin' | 'toplu';

/** Personelin yaptığı iş (reçete): kod + başlık — GET /ekip/kadro `receteler[]`. */
export interface AjanRecete {
  kod: string;
  baslik: string;
}

/** Backend #3 (isteğe bağlı) — kadro satırına son koşu/bekleyen onay eklerse doğrudan kullanılır; yoksa FE isler(200)'den hesaplar. */
export interface AjanSonKosu {
  id?: string;
  createdAt?: string;
  status?: IsDurumu;
  dryRun?: boolean;
  toolSayisi?: number;
  durationMs?: number | null;
  startedAt?: string | null;
}

export interface Ajan {
  id: AjanId | string;
  ad: string;
  unvan: string;
  aciklama: string;
  model: string;
  araclar: string[];
  onayNoktalari: string[];
  tetikler: string[];
  kademeOzeti: KademeOzeti;
  modelKimligi?: string | null;
  aracSayisi?: number;
  /** Backend #3 gelince (opsiyonel). */
  sonKosu?: AjanSonKosu | null;
  bekleyenOnay?: number;
  bugunKosu?: number;
  /** GET /ekip/kadro (2026-09-13): ajan şu an hangi vakada/mükellefte çalışıyor; boşta ise null. */
  suAn?: AjanSuAn | null;
  /** GET /ekip/kadro (2026-09-22): personelin yaptığı işler (reçete kodu + başlık); eski backend'de boş. */
  receteler: AjanRecete[];
  /** Modülü kapalı personel (ör. Bordro/SGK): neden metni; açıksa null. */
  kapali: { neden: string } | null;
}

/** Kadro satırı — koşan iş (status running, ajan başına en yeni). */
export interface AjanSuAn {
  vakaId: string;
  isId: string;
  mukellefId?: string | null;
  mukellefAd?: string | null;
  konu: string;
  basladi: string;
}

export type IsDurumu = 'pending' | 'running' | 'done' | 'failed';

export interface AracCagrisi {
  name: string;
  args?: any;
}

export interface IsSonucu {
  rapor: string;
  toolUses: AracCagrisi[];
  kuruTestYapilacaktilar: AracCagrisi[];
  onayBekleyen: any[];
  ogrenilen: string[];
  model?: string;
  durationMs?: number;
}

export interface IsDosyasi {
  id: string;
  ajanId: string;
  gorev: string;
  status: IsDurumu;
  dryRun: boolean;
  taxpayerId?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  result?: IsSonucu | null;
  // Liste özeti (backend isOzeti zaten döndürüyor)
  kaynak?: EkipKaynak | null;
  hata?: string | null;
  startedAt?: string | null;
  model?: string | null;
  durationMs?: number | null;
  toolSayisi?: number;
  kuruTestSayisi?: number;
  onayBekleyenSayisi?: number;
  ogrenilenSayisi?: number;
  raporOzet?: string | null;
  /** Koşu SÜRERKEN sunucunun yazdığı adımlar (payload.canli; yalnız status=running iken gelir, bitince result.toolUses tam liste). */
  canli?: { adimlar: CanliAdim[]; guncellendi: string } | null;
}

/** Canlı adım (ekip-runner CanliAdimYazici): araç adı + kısa argümanlar + başladı/bitti + durum. */
export interface CanliAdim {
  ad: string;
  args?: Record<string, unknown>;
  basladi: string;
  bitti?: string | null;
  durum: 'suruyor' | 'bitti' | 'hata' | 'kuru' | 'onay' | 'red';
}

export type AsamaDurumu = 'tamam' | 'eksik' | 'yok';
/** 5 aşama — tahakkukIletildi kalktı (MonthlyStatusRow'da gerçek alan yok). */
export type AsamaAdi = 'evrak' | 'isleme' | 'kontrol' | 'beyanname' | 'gonderim';

export interface PanoDonem {
  donem: string; // '2026-08'
  asamalar: Partial<Record<AsamaAdi, AsamaDurumu>>;
}

export interface PanoSatiri {
  taxpayerId: string;
  unvan: string;
  defterTuru?: string | null;
  /** Dönem bazında kayıt var mı (aylık takip satırı açık mı). */
  kayitVar?: Partial<Record<string, boolean>>;
  donemler: PanoDonem[];
}

/** Dönem özeti — backend pano() `donemler[].ozet/toplam/hata/bosDonemFallback`. */
export interface PanoDonemOzeti {
  donem: string;
  beyannameDonem?: string | null;
  toplam: number;
  hata?: string | null;
  bosDonemFallback: boolean;
  ozet: { kayitVar: number; evrak: number; isleme: number; kontrol: number; beyannameHazir: number; beyanname: number };
}

export interface Pano {
  satirlar: PanoSatiri[];
  donemOzetleri: PanoDonemOzeti[];
}

/** Max haftalık kota bekçisi (PLAN/20 §D): doluysa rutinler ve kuyruk duraklar, `sifirlanma` anında kendiliğinden sürer. */
export interface KotaDurumu {
  doldu: boolean;
  sifirlanma?: string | null;
  sonHata?: string | null;
}

/** GET /ekip/durum `kuyruk` özeti — süren kuyruk sayısı, süren kuyruğun kimliği, sıradaki mükellef. */
export interface KuyrukOzeti {
  aktif: number;
  suruyorId?: string | null;
  siradaki?: { taxpayerId: string; ad: string } | null;
}

/** GET /ekip/durum `bugunPlan` — bugün planlanan / süren / biten / yarım kalan iş sayıları. */
export interface BugunPlani {
  planlanan: number;
  suruyor: number;
  biten: number;
  yarim: number;
}

export interface EkipDurum {
  operator: { acik: boolean; cihaz: string | null };
  bekleyenOnay: number;
  bugunKosu: number;
  sabahOzeti?: boolean;
  maxBagli?: boolean;
  /** Backend #2 (opsiyonel) — yoksa FE isler(200)'den hesaplar. */
  calisan?: number;
  bugunHata?: number;
  sonSabahOzeti?: { isId: string; createdAt: string; raporIlkSatir?: string | null } | null;
  /** İsteğe bağlı (2026-09-13): akış sayaçları (gun=7) — yoksa FE getAkis().sayaclar kullanır. */
  akis?: AkisSayaclari;
  /** 2026-09-22 (PLAN/20): kota bekçisi — eski backend'de gelmez (undefined). */
  kota?: KotaDurumu;
  /** 2026-09-22: kuyruk özeti — eski backend'de gelmez. */
  kuyruk?: KuyrukOzeti;
  /** 2026-09-22: bugünün planı — eski backend'de gelmez; ekran akıştan türetir. */
  bugunPlan?: BugunPlani;
}

export type EkipStreamEvent =
  | { type: 'baslangic'; isId?: string; ajanId?: string; model?: string; dryRun?: boolean }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; args?: any }
  | { type: 'kuruTest'; name: string; args?: any; kademe?: string }
  | { type: 'onay'; name: string; previewId?: string; confirmationText?: string }
  | { type: 'red'; name: string; neden?: string; mesaj?: string }
  | {
      type: 'done';
      model?: string;
      toolUses?: AracCagrisi[];
      durationMs?: number;
      isId?: string;
      kuruTestYapilacaktilar?: AracCagrisi[];
      onayBekleyen?: any[];
      ogrenilen?: string[];
    }
  | { type: 'error'; error: string; isId?: string };

/** Omurga (backend) henüz yayında değil — uç 404 döndü. */
export class OmurgaYokError extends Error {
  constructor() {
    super('Omurga henüz yayında değil');
    this.name = 'OmurgaYokError';
  }
}

export function isOmurgaYok(err: unknown): boolean {
  return err instanceof OmurgaYokError || (err as any)?.name === 'OmurgaYokError';
}

function cevir404(err: any): never {
  if (err?.response?.status === 404) throw new OmurgaYokError();
  throw err;
}

export async function getKadro(): Promise<Ajan[]> {
  try {
    const { data } = await api.get('/ekip/kadro');
    const liste: any[] = Array.isArray(data?.ajanlar) ? data.ajanlar : [];
    // Backend kademe sayılarını `kademeler` (Record) olarak verir; ekran `kademeOzeti` bekler.
    return liste.map((a) => {
      const k = a.kademeOzeti || a.kademeler || {};
      return {
        ...a,
        araclar: Array.isArray(a.araclar) ? a.araclar : [],
        onayNoktalari: Array.isArray(a.onayNoktalari) ? a.onayNoktalari : [],
        tetikler: Array.isArray(a.tetikler) ? a.tetikler : [],
        aciklama: a.aciklama || '',
        suAn: suAnNormalle(a.suAn),
        receteler: (Array.isArray(a.receteler) ? a.receteler : [])
          .map((r: any) => (typeof r === 'string' ? { kod: r, baslik: r } : r && typeof r === 'object' ? { kod: String(r.kod || ''), baslik: String(r.baslik || r.kod || '') } : null))
          .filter((r: AjanRecete | null): r is AjanRecete => !!r && !!r.baslik),
        kapali: a.kapali && typeof a.kapali === 'object' && (a.kapali.neden || a.kapali === true) ? { neden: String(a.kapali.neden || 'Modül kapalı') } : a.kapali === true ? { neden: 'Modül kapalı' } : null,
        kademeOzeti: {
          oku: Number(k.oku || 0),
          portal_yaz: Number(k.portal_yaz || 0),
          luca_yaz: Number(k.luca_yaz || 0),
          disari_gonder: Number(k.disari_gonder || 0),
        },
      } as Ajan;
    });
  } catch (e) {
    return cevir404(e);
  }
}

export interface IslerParametreleri {
  ajanId?: string;
  limit?: number;
  /** Backend #4 gelene kadar sunucuya GÖNDERİLMEZ; istemci süzer. */
  gun?: 'bugun' | '7' | 'tumu';
  status?: IsDurumu;
  dryRun?: boolean;
  kaynak?: EkipKaynak;
}

export async function getIsler(params?: IslerParametreleri): Promise<IsDosyasi[]> {
  try {
    const { data } = await api.get('/ekip/isler', {
      // gun/status/dryRun/kaynak: backend süzgeçleri (#4) gelene kadar gönderilmez — istemci süzer.
      params: { ajanId: params?.ajanId || undefined, limit: Math.min(params?.limit ?? 50, 200) },
    });
    // Backend düz dizi döndürür; {isler:[]} de kabul edilir. Liste satırı özet alanlarla gelir
    // (toolSayisi, kuruTestSayisi, onayBekleyenSayisi, ogrenilenSayisi, raporOzet); tam `result` detayda.
    const liste: any[] = Array.isArray(data) ? data : Array.isArray(data?.isler) ? data.isler : [];
    return liste.map((r) => ({
      ...r,
      result:
        r.result ||
        (r.raporOzet || r.toolSayisi || r.kuruTestSayisi || r.onayBekleyenSayisi
          ? {
              rapor: r.raporOzet || '',
              toolUses: Array.from({ length: Number(r.toolSayisi || 0) }, () => ({ name: '…' })),
              kuruTestYapilacaktilar: Array.from({ length: Number(r.kuruTestSayisi || 0) }, () => ({ name: '…' })),
              onayBekleyen: Array.from({ length: Number(r.onayBekleyenSayisi || 0) }, () => ({})),
              ogrenilen: Array.from({ length: Number(r.ogrenilenSayisi || 0) }, () => '…'),
              model: r.model || undefined,
              durationMs: r.durationMs ?? undefined,
            }
          : null),
    }));
  } catch (e) {
    return cevir404(e);
  }
}

export async function getIs(id: string): Promise<IsDosyasi> {
  try {
    const { data } = await api.get(`/ekip/isler/${id}`);
    return data;
  } catch (e) {
    return cevir404(e);
  }
}

export async function getPano(): Promise<Pano> {
  try {
    const { data } = await api.get('/ekip/pano');
    if (Array.isArray(data?.satirlar)) {
      return { satirlar: data.satirlar, donemOzetleri: Array.isArray(data?.donemOzetleri) ? data.donemOzetleri : [] };
    }
    // Backend şekli: {donemler:[{istenenDonem, beyannameDonem, bosDonemFallback, hata, toplam, ozet:{…}, mukellefler:[{taxpayerId, ad, tip, kayitVar, asamalar:{evrak,isleme,kontrol,beyannameHazir,beyanname}}]}]}
    // Ekran şekli: mükellef satırı × dönem sütunu + dönem özetleri. Burada çevrilir.
    const donemler: any[] = Array.isArray(data?.donemler) ? data.donemler : [];
    const satirlar = new Map<string, PanoSatiri>();
    const donemOzetleri: PanoDonemOzeti[] = [];
    const durum = (v: unknown, kayitVar: boolean): AsamaDurumu => (v === true ? 'tamam' : kayitVar ? 'eksik' : 'yok');
    for (const d of donemler) {
      const donem = String(d?.istenenDonem || d?.beyannameDonem || '');
      const o = d?.ozet || {};
      donemOzetleri.push({
        donem,
        beyannameDonem: d?.beyannameDonem ?? null,
        toplam: Number(d?.toplam ?? (Array.isArray(d?.mukellefler) ? d.mukellefler.length : 0)),
        hata: d?.hata || null,
        bosDonemFallback: d?.bosDonemFallback === true,
        ozet: {
          kayitVar: Number(o.kayitVar || 0),
          evrak: Number(o.evrak || 0),
          isleme: Number(o.isleme || 0),
          kontrol: Number(o.kontrol || 0),
          beyannameHazir: Number(o.beyannameHazir || 0),
          beyanname: Number(o.beyanname || 0),
        },
      });
      for (const m of Array.isArray(d?.mukellefler) ? d.mukellefler : []) {
        const id = String(m?.taxpayerId || m?.ad || '');
        if (!id) continue;
        const kayitVar = m?.kayitVar === true;
        const a = m?.asamalar || {};
        const satir: PanoSatiri =
          satirlar.get(id) || { taxpayerId: id, unvan: m?.ad || id, defterTuru: m?.tip || null, kayitVar: {}, donemler: [] as PanoDonem[] };
        satir.kayitVar = { ...(satir.kayitVar || {}), [donem]: kayitVar };
        satir.donemler.push({
          donem,
          asamalar: {
            evrak: durum(a.evrak, kayitVar),
            isleme: durum(a.isleme, kayitVar),
            kontrol: durum(a.kontrol, kayitVar),
            beyanname: durum(a.beyannameHazir, kayitVar),
            gonderim: durum(a.beyanname, kayitVar),
          },
        });
        satirlar.set(id, satir);
      }
    }
    return {
      satirlar: Array.from(satirlar.values()).sort((x, y) => x.unvan.localeCompare(y.unvan, 'tr')),
      donemOzetleri,
    };
  } catch (e) {
    return cevir404(e);
  }
}

export async function getEkipDurum(): Promise<EkipDurum> {
  try {
    const { data } = await api.get('/ekip/durum');
    // Backend: {operator:{cevrimici,cihaz}, bekleyenOnay, bugunkuKosu, sabahOzeti, maxBagli}
    return {
      operator: {
        acik: Boolean(data?.operator?.acik ?? data?.operator?.cevrimici),
        cihaz: data?.operator?.cihaz ?? null,
      },
      bekleyenOnay: Number(data?.bekleyenOnay || 0),
      bugunKosu: Number(data?.bugunKosu ?? data?.bugunkuKosu ?? 0),
      kota: data?.kota && typeof data.kota === 'object' && 'doldu' in data.kota ? { doldu: data.kota.doldu === true, sifirlanma: data.kota.sifirlanma ?? null, sonHata: data.kota.sonHata ?? null } : undefined,
      kuyruk: data?.kuyruk && typeof data.kuyruk === 'object' ? { aktif: Number(data.kuyruk.aktif || 0), suruyorId: data.kuyruk.suruyorId ?? null, siradaki: data.kuyruk.siradaki?.taxpayerId ? { taxpayerId: String(data.kuyruk.siradaki.taxpayerId), ad: String(data.kuyruk.siradaki.ad || '') } : null } : undefined,
      bugunPlan: data?.bugunPlan && typeof data.bugunPlan === 'object' ? { planlanan: Number(data.bugunPlan.planlanan || 0), suruyor: Number(data.bugunPlan.suruyor || 0), biten: Number(data.bugunPlan.biten || 0), yarim: Number(data.bugunPlan.yarim || 0) } : undefined,
      sabahOzeti: data?.sabahOzeti,
      maxBagli: data?.maxBagli,
      calisan: typeof data?.calisan === 'number' ? data.calisan : undefined,
      bugunHata: typeof data?.bugunHata === 'number' ? data.bugunHata : undefined,
      sonSabahOzeti: data?.sonSabahOzeti ?? undefined,
      akis: data?.akis && typeof data.akis === 'object' ? sayaclariNormalle(data.akis) : undefined,
    };
  } catch (e) {
    return cevir404(e);
  }
}

/** Sabah özeti zaman aşımı (150 sn) — koşu sunucuda sürer, sonuç İş Dosyaları'nda görünür. */
export class SabahOzetiZamanAsimi extends Error {
  constructor() {
    super("Sürüyor — İş Dosyaları'nda görünecek");
    this.name = 'SabahOzetiZamanAsimi';
  }
}
export function isZamanAsimi(err: unknown): boolean {
  return err instanceof SabahOzetiZamanAsimi || (err as any)?.name === 'SabahOzetiZamanAsimi';
}

export interface SabahOzetiSonucu {
  isId?: string;
  rapor: string;
  hata?: string;
  gonderildi: number;
  model?: string;
  durationMs?: number;
  toolUses?: AracCagrisi[];
  kuruTestYapilacaktilar?: AracCagrisi[];
  onayBekleyen?: any[];
  ogrenilen?: string[];
}

/**
 * Koordinatörü hemen koştur: POST /ekip/koordinator/sabah-ozeti {gonder}.
 * gonder:false → yalnız üretir; gonder:true → SAHİBE GERÇEK WhatsApp gider (yalnız kart içi teyitten sonra çağrılır).
 * Uç eşzamanlı (backend #6 gelene kadar): 150 sn zaman aşımı.
 */
export async function sabahOzetiUret(opts: { gonder: boolean }): Promise<SabahOzetiSonucu> {
  try {
    const { data } = await api.post('/ekip/koordinator/sabah-ozeti', { gonder: opts.gonder === true }, { timeout: 150_000 });
    return {
      isId: data?.isId || undefined,
      rapor: typeof data?.rapor === 'string' ? data.rapor : '',
      hata: data?.hata || undefined,
      gonderildi: Number(data?.gonderildi || 0),
      model: data?.model || undefined,
      durationMs: data?.durationMs ?? undefined,
      toolUses: Array.isArray(data?.toolUses) ? data.toolUses : [],
      kuruTestYapilacaktilar: Array.isArray(data?.kuruTestYapilacaktilar) ? data.kuruTestYapilacaktilar : [],
      onayBekleyen: Array.isArray(data?.onayBekleyen) ? data.onayBekleyen : [],
      ogrenilen: Array.isArray(data?.ogrenilen) ? data.ogrenilen : [],
    };
  } catch (e: any) {
    if (e?.code === 'ECONNABORTED' || /timeout/i.test(String(e?.message || ''))) throw new SabahOzetiZamanAsimi();
    return cevir404(e);
  }
}

/** Mükellef seçici için sade liste (GET /taxpayers; yanıt {data:[]} ya da [] olabilir). */
export interface MukellefOzet {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  taxNumber?: string | null;
}

export async function getMukellefler(): Promise<MukellefOzet[]> {
  const { data } = await api.get('/taxpayers');
  const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return arr as MukellefOzet[];
}

export function mukellefAdi(t?: MukellefOzet | null): string {
  if (!t) return '-';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || t.id;
}

/**
 * Ajanı çalıştır — SSE akışı. Olaylar luca-operator/chat ile aynı biçim.
 * dryRun varsayılan TRUE (kuru test): mükellefe mesaj gitmez, Luca'ya yazılmaz.
 */
export async function ajanCalistirStream(
  ajanId: string,
  body: { gorev: string; taxpayerId?: string; dryRun?: boolean; vakaId?: string },
  onEvent: (e: EkipStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await authorizedFetch(`${API_BASE}/ekip/${encodeURIComponent(ajanId)}/calistir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, vakaId: body.vakaId || undefined, dryRun: body.dryRun ?? true }),
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    onEvent({ type: 'error', error: 'Sunucuya ulaşılamadı (ağ hatası)' });
    return;
  }
  if (res.status === 404) {
    onEvent({ type: 'error', error: 'Omurga henüz yayında değil (uç bulunamadı)' });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', error: `Sunucu hatası (${res.status})` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as EkipStreamEvent);
      } catch {
        /* yoksay */
      }
    }
  }
}

/**
 * Çalışan koşuyu sunucuda DURDUR: POST /ekip/isler/:isId/iptal.
 * Backend Agent SDK'ya abort verir; iş dosyası failed + hata "iptal edildi (Muzaffer Bey)".
 * Çalışan kayıt yoksa (bitmiş / başka süreç) {ok:false, error} döner — hata fırlatmaz.
 */
export async function iptalEt(isId: string): Promise<{ ok: boolean; isId: string; error?: string }> {
  try {
    const { data } = await api.post(`/ekip/isler/${encodeURIComponent(isId)}/iptal`, {}, { timeout: 15_000 });
    return { ok: data?.ok === true, isId: data?.isId || isId, error: data?.error || undefined };
  } catch (e: any) {
    if (e?.response?.status === 404) return { ok: false, isId, error: 'Omurga henüz yayında değil (iptal ucu yok)' };
    return { ok: false, isId, error: e?.message || 'Durdurma isteği gönderilemedi' };
  }
}

// ─── ONAYLAR (dışarı gönderim → Muzaffer Bey onayı) ───

export interface EkipOnay {
  id: string;
  previewId: string;
  ajanId: string;
  ajanAd: string;
  arac: string;
  kademe?: string;
  hedef?: string | null;
  mesaj?: string | null;
  payload?: any;
  etki?: string | null;
  isId?: string | null;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  approvedAt?: string | null;
  responseText?: string | null;
  confirmationText: string;
  /** Backend #7 (opsiyonel): taxpayerId/telefon → ad. Yoksa FE mükellef haritasından çözer. */
  mukellefAd?: string | null;
}

export async function getOnaylar(durum: 'PENDING' | 'tumu' = 'PENDING', limit = 50): Promise<EkipOnay[]> {
  try {
    const { data } = await api.get('/ekip/onaylar', { params: { durum, limit } });
    return Array.isArray(data?.onaylar) ? data.onaylar : [];
  } catch (e) {
    return cevir404(e);
  }
}

export async function onayla(previewId: string): Promise<{ ok: boolean; error?: string; sonuc?: any }> {
  const { data } = await api.post(`/ekip/onaylar/${encodeURIComponent(previewId)}/onayla`, {
    onayMetni: `ONAYLIYORUM #${previewId}`,
  });
  return data;
}

export async function reddet(previewId: string, not?: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post(`/ekip/onaylar/${encodeURIComponent(previewId)}/reddet`, { not });
  return data;
}

// ─── CANLI AKIŞ — iş dosyası zinciri (vaka) ───
// Sözleşme (2026-09-13): GET /ekip/akis?gun=7&filtre=tumu|suruyor|onay|istek|bitti&taxpayerId=&limit=100
// Vaka = kök iş + devirler + onay kayıtları + Koordinatör bildirimleri; Muzaffer Bey'e üç kutu: onay · istek · bitti (+ sürüyor).

export type AkisGun = 1 | 7 | 30;
export type AkisFiltre = 'tumu' | 'suruyor' | 'onay' | 'istek' | 'bitti';
export type VakaKutu = 'suruyor' | 'onay' | 'istek' | 'bitti';
export type VakaDurum = 'suruyor' | 'bitti' | 'hata';

export interface VakaAdimIs {
  tip: 'is';
  isId: string;
  ajanId: string;
  baslik: string;
  durum: IsDurumu;
  baslangic: string;
  bitis?: string | null;
  raporOzet?: string | null;
  hata?: string | null;
  /** Devir sırası (1 = ilk devir); kök iş için null. */
  devir: number | null;
  kuru: boolean;
}

export interface VakaAdimOnay {
  tip: 'onay';
  /** previewId */
  id: string;
  ajanId: string;
  baslik: string;
  durum: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'EXPIRED';
  baslangic: string;
  hedef?: string | null;
  confirmationText?: string | null;
}

export interface VakaAdimBildirim {
  tip: 'bildirim';
  id: string;
  tur: 'onay' | 'istek' | 'bilgi';
  baslik: string;
  govde?: string | null;
  durum: 'acik' | 'kapandi';
  baslangic: string;
}

export type VakaAdim = VakaAdimIs | VakaAdimOnay | VakaAdimBildirim;

export interface AcikKalem {
  tip: 'onay' | 'istek';
  /** onay → previewId; istek → bildirim id */
  id: string;
  baslik: string;
  kaynak: 'PRV' | 'bildirim';
  confirmationText?: string | null;
}

export interface Vaka {
  vakaId: string;
  mukellef: { id: string; ad: string } | null;
  konu: string;
  kuru: boolean;
  /** ajanId 'siz' → Muzaffer Bey */
  kimde: { ajanId: string; ad: string };
  durum: VakaDurum;
  kutu: VakaKutu;
  guncellendi: string;
  /** 2 devirden fazla dolaşan ya da 24 saatte çözülmeyen konu. */
  gecikti: boolean;
  olusturuldu: string;
  adimlar: VakaAdim[];
  acikKalemler: AcikKalem[];
}

export interface AkisSayaclari {
  suruyor: number;
  onay: number;
  istek: number;
  bitti: number;
  gecikti: number;
}

export interface Akis {
  vakalar: Vaka[];
  /** Süzgeçten BAĞIMSIZ — tüm gün penceresi. */
  sayaclar: AkisSayaclari;
  pencere: { gun: AkisGun; baslangic: string };
}

function sayaclariNormalle(s: any): AkisSayaclari {
  return {
    suruyor: Number(s?.suruyor || 0),
    onay: Number(s?.onay || 0),
    istek: Number(s?.istek || 0),
    bitti: Number(s?.bitti || 0),
    gecikti: Number(s?.gecikti || 0),
  };
}

function suAnNormalle(x: any): AjanSuAn | null {
  if (!x || typeof x !== 'object' || (!x.vakaId && !x.isId)) return null;
  return {
    vakaId: String(x.vakaId || x.isId),
    isId: String(x.isId || x.vakaId),
    mukellefId: x.mukellefId ?? x.taxpayerId ?? null,
    mukellefAd: x.mukellefAd ?? null,
    konu: String(x.konu || x.gorev || ''),
    basladi: String(x.basladi || x.startedAt || x.createdAt || ''),
  };
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
      raporOzet: a.raporOzet ?? null,
      hata: a.hata ?? null,
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
      confirmationText: a.confirmationText ?? null,
    };
  }
  if (a.tip === 'bildirim') {
    return {
      tip: 'bildirim',
      id: String(a.id || ''),
      tur: a.tur === 'onay' || a.tur === 'istek' ? a.tur : 'bilgi',
      baslik: String(a.baslik || ''),
      govde: a.govde ?? null,
      durum: a.durum === 'kapandi' ? 'kapandi' : 'acik',
      baslangic: String(a.baslangic || ''),
    };
  }
  return null;
}

function vakaNormalle(v: any): Vaka | null {
  if (!v || !v.vakaId) return null;
  const adimlar = (Array.isArray(v.adimlar) ? v.adimlar : []).map(adimNormalle).filter(Boolean) as VakaAdim[];
  const kutu: VakaKutu = (['suruyor', 'onay', 'istek', 'bitti'] as VakaKutu[]).includes(v.kutu) ? v.kutu : v.durum === 'suruyor' ? 'suruyor' : 'bitti';
  const ilkIs = adimlar.find((a) => a.tip === 'is') as VakaAdimIs | undefined;
  return {
    vakaId: String(v.vakaId),
    mukellef: v.mukellef && v.mukellef.id ? { id: String(v.mukellef.id), ad: String(v.mukellef.ad || v.mukellef.id) } : null,
    konu: String(v.konu || ilkIs?.baslik || ''),
    kuru: v.kuru !== false,
    kimde: { ajanId: String(v.kimde?.ajanId || 'koordinator'), ad: String(v.kimde?.ad || (v.kimde?.ajanId === 'siz' ? 'Siz' : 'Koordinatör')) },
    durum: v.durum === 'bitti' || v.durum === 'hata' ? v.durum : 'suruyor',
    kutu,
    guncellendi: String(v.guncellendi || v.olusturuldu || ''),
    gecikti: v.gecikti === true,
    olusturuldu: String(v.olusturuldu || v.guncellendi || ''),
    adimlar,
    acikKalemler: (Array.isArray(v.acikKalemler) ? v.acikKalemler : [])
      .filter((k: any) => k && k.id && (k.tip === 'onay' || k.tip === 'istek'))
      .map((k: any) => ({
        tip: k.tip,
        id: String(k.id),
        baslik: String(k.baslik || ''),
        kaynak: k.kaynak === 'bildirim' ? 'bildirim' : 'PRV',
        confirmationText: k.confirmationText ?? null,
      })),
  };
}

export async function getAkis(p?: { gun?: AkisGun; filtre?: AkisFiltre; taxpayerId?: string; limit?: number }): Promise<Akis> {
  const gun: AkisGun = p?.gun === 1 || p?.gun === 30 ? p.gun : 7;
  try {
    const { data } = await api.get('/ekip/akis', {
      params: { gun, filtre: p?.filtre || 'tumu', taxpayerId: p?.taxpayerId || undefined, limit: Math.min(p?.limit ?? 100, 500) },
    });
    return {
      vakalar: (Array.isArray(data?.vakalar) ? data.vakalar : []).map(vakaNormalle).filter(Boolean) as Vaka[],
      sayaclar: sayaclariNormalle(data?.sayaclar),
      pencere: {
        gun: (data?.pencere?.gun as AkisGun) || gun,
        baslangic: String(data?.pencere?.baslangic || new Date(Date.now() - gun * 86_400_000).toISOString()),
      },
    };
  } catch (e) {
    return cevir404(e);
  }
}

/** "Sizden istenen" kalemi kapat (fiş yüklendi / yapıldı): POST /ekip/istek/:bildirimId/kapat. */
export async function istekKapat(bildirimId: string): Promise<{ ok: boolean; id?: string; vakaId?: string; zatenKapali?: boolean; error?: string }> {
  try {
    const { data } = await api.post(`/ekip/istek/${encodeURIComponent(bildirimId)}/kapat`, {}, { timeout: 15_000 });
    return { ok: data?.ok === true, id: data?.id, vakaId: data?.vakaId, zatenKapali: data?.zatenKapali === true, error: data?.error || undefined };
  } catch (e: any) {
    if (e?.response?.status === 404) return { ok: false, error: 'Omurga henüz yayında değil (istek ucu yok)' };
    return { ok: false, error: e?.response?.data?.message || e?.message || 'Kapatma isteği gönderilemedi' };
  }
}

// ─── İŞ DÜZENİ (rutin) · KUYRUK — PLAN/20 §D (2026-09-22) ───
// Rutin = Muzaffer Bey'in açtığı, ekibin kendiliğinden yaptığı iş düzeni (varsayılan KAPALI; ekran hiçbir rutini kendiliğinden açmaz).
// Kuyruk = sıralı işleyici (rutinden ya da panodan "Personele ver" ile); Durdur / Devam; kota dolunca `kota_bekliyor`.
// Bu uçlar 404 dönerse (eski backend) OmurgaYok fırlatılmaz: `destek:false` ile boş liste döner, ekran çökmeden "yayında değil" der.

export type RutinKapsam = 'pano:kontrol_bekleyen' | 'pano:isleme_bekleyen' | 'pano:hazirlik_bekleyen' | 'liste' | 'ofis';

export type RutinZaman =
  | { tur: 'haftalik'; gunler: number[]; baslangic: string; bitis: string }
  | { tur: 'aylik'; ayGunu: number; saat: string; aylar?: number[] };

export interface Rutin {
  id: string;
  ad: string;
  ajanId: string;
  sablon: string;
  kapsam: RutinKapsam;
  taxpayerIds?: string[];
  zaman: RutinZaman;
  gunlukTavan: number;
  dryRun: boolean;
  aktif: boolean;
  sonKosuAt?: string | null;
  sonSonuc?: string | null;
  bugun: { planlanan: number; biten: number; hatali: number };
}

/** POST/PATCH gövdesi — id ve türetilen alanlar dışında her şey isteğe bağlı (PATCH kısmi gönderir). */
export type RutinGirdi = Partial<Omit<Rutin, 'id' | 'sonKosuAt' | 'sonSonuc' | 'bugun'>>;

export type KuyrukDurumu = 'bekliyor' | 'suruyor' | 'durduruldu' | 'bitti' | 'kota_bekliyor';
export type KuyrukOgeDurumu = 'bekliyor' | 'suruyor' | 'bitti' | 'hatali' | 'atlandi';

export interface KuyrukOgesi {
  taxpayerId: string;
  ad: string;
  durum: KuyrukOgeDurumu;
  isId?: string | null;
  hata?: string | null;
}

export interface Kuyruk {
  id: string;
  ad: string;
  ajanId: string;
  dryRun: boolean;
  kaynak: 'rutin' | 'toplu';
  rutinId?: string | null;
  durum: KuyrukDurumu;
  toplam: number;
  biten: number;
  hatali: number;
  siradaki: { taxpayerId: string; ad: string } | null;
  aktifIsId?: string | null;
  ogeler: KuyrukOgesi[];
  createdAt: string;
  bitisAt?: string | null;
}

function zamanNormalle(z: any): RutinZaman {
  if (z && z.tur === 'aylik') return { tur: 'aylik', ayGunu: Math.min(31, Math.max(1, Number(z.ayGunu || 1))), saat: String(z.saat || '09:30') };
  const gunler = (Array.isArray(z?.gunler) ? z.gunler : [1, 2, 3, 4, 5]).map((g: unknown) => Number(g)).filter((g: number) => g >= 1 && g <= 7);
  return { tur: 'haftalik', gunler: gunler.length ? gunler : [1, 2, 3, 4, 5], baslangic: String(z?.baslangic || '09:30'), bitis: String(z?.bitis || '17:00') };
}

const KAPSAMLAR: RutinKapsam[] = ['pano:kontrol_bekleyen', 'pano:isleme_bekleyen', 'pano:hazirlik_bekleyen', 'liste', 'ofis'];

function rutinNormalle(r: any): Rutin | null {
  if (!r || !r.id) return null;
  return {
    id: String(r.id),
    ad: String(r.ad || 'Rutin'),
    ajanId: String(r.ajanId || 'koordinator'),
    sablon: String(r.sablon || ''),
    kapsam: KAPSAMLAR.includes(r.kapsam) ? r.kapsam : 'ofis',
    taxpayerIds: Array.isArray(r.taxpayerIds) ? r.taxpayerIds.map(String) : undefined,
    zaman: zamanNormalle(r.zaman),
    gunlukTavan: Math.max(1, Number(r.gunlukTavan || 8)),
    dryRun: r.dryRun !== false,
    aktif: r.aktif === true,
    sonKosuAt: r.sonKosuAt ?? null,
    sonSonuc: r.sonSonuc ?? null,
    bugun: { planlanan: Number(r.bugun?.planlanan || 0), biten: Number(r.bugun?.biten || 0), hatali: Number(r.bugun?.hatali || 0) },
  };
}

function kuyrukNormalle(k: any): Kuyruk | null {
  if (!k || !k.id) return null;
  const ogeler: KuyrukOgesi[] = (Array.isArray(k.ogeler) ? k.ogeler : [])
    .filter((o: any) => o && o.taxpayerId)
    .map((o: any) => ({
      taxpayerId: String(o.taxpayerId),
      ad: String(o.ad || o.taxpayerId),
      durum: (['bekliyor', 'suruyor', 'bitti', 'hatali', 'atlandi'] as KuyrukOgeDurumu[]).includes(o.durum) ? o.durum : 'bekliyor',
      isId: o.isId ?? null,
      hata: o.hata ?? null,
    }));
  const durum: KuyrukDurumu = (['bekliyor', 'suruyor', 'durduruldu', 'bitti', 'kota_bekliyor'] as KuyrukDurumu[]).includes(k.durum) ? k.durum : 'bekliyor';
  return {
    id: String(k.id),
    ad: String(k.ad || 'Toplu iş'),
    ajanId: String(k.ajanId || 'koordinator'),
    dryRun: k.dryRun !== false,
    kaynak: k.kaynak === 'rutin' ? 'rutin' : 'toplu',
    rutinId: k.rutinId ?? null,
    durum,
    toplam: Number(k.toplam ?? ogeler.length),
    biten: Number(k.biten ?? ogeler.filter((o) => o.durum === 'bitti').length),
    hatali: Number(k.hatali ?? ogeler.filter((o) => o.durum === 'hatali').length),
    siradaki: k.siradaki?.taxpayerId ? { taxpayerId: String(k.siradaki.taxpayerId), ad: String(k.siradaki.ad || '') } : null,
    aktifIsId: k.aktifIsId ?? null,
    ogeler,
    createdAt: String(k.createdAt || ''),
    bitisAt: k.bitisAt ?? null,
  };
}

/** 404 → uç henüz yok (eski backend): çökmeden `destek:false`. Diğer hatalar fırlar. */
function destekYokMu(e: any): boolean {
  return e?.response?.status === 404;
}

export async function getRutinler(): Promise<{ rutinler: Rutin[]; destek: boolean }> {
  try {
    const { data } = await api.get('/ekip/rutinler');
    return { rutinler: (Array.isArray(data?.rutinler) ? data.rutinler : []).map(rutinNormalle).filter(Boolean) as Rutin[], destek: true };
  } catch (e) {
    if (destekYokMu(e)) return { rutinler: [], destek: false };
    throw e;
  }
}

export async function rutinOlustur(girdi: RutinGirdi): Promise<Rutin> {
  const { data } = await api.post('/ekip/rutinler', girdi);
  const r = rutinNormalle(data?.rutin || data);
  if (!r) throw new Error('Rutin oluşturulamadı');
  return r;
}

export async function rutinGuncelle(id: string, girdi: RutinGirdi): Promise<Rutin> {
  const { data } = await api.patch(`/ekip/rutinler/${encodeURIComponent(id)}`, girdi);
  const r = rutinNormalle(data?.rutin || data);
  if (!r) throw new Error('Rutin güncellenemedi');
  return r;
}

export async function rutinSil(id: string): Promise<void> {
  await api.delete(`/ekip/rutinler/${encodeURIComponent(id)}`);
}

/** Rutini şimdi çalıştır: kapsamı hesaplar, tavana kadar kuyruğa ekler → {ok, eklenen, kuyrukId}. */
export async function rutinSimdi(id: string): Promise<{ ok: boolean; eklenen: number; kuyrukId?: string | null; error?: string }> {
  const { data } = await api.post(`/ekip/rutinler/${encodeURIComponent(id)}/simdi`, {}, { timeout: 30_000 });
  return { ok: data?.ok === true, eklenen: Number(data?.eklenen || 0), kuyrukId: data?.kuyrukId ?? null, error: data?.error || undefined };
}

export async function getKuyruk(): Promise<{ kuyruklar: Kuyruk[]; destek: boolean }> {
  try {
    const { data } = await api.get('/ekip/kuyruk');
    return { kuyruklar: (Array.isArray(data?.kuyruklar) ? data.kuyruklar : []).map(kuyrukNormalle).filter(Boolean) as Kuyruk[], destek: true };
  } catch (e) {
    if (destekYokMu(e)) return { kuyruklar: [], destek: false };
    throw e;
  }
}

/** Toplu görev: seçili mükellefler + şablon → kuyruk. `dryRun` yalnız açıkça true gönderilirse canlı DEĞİL; kuru = true. */
export async function kuyrukOlustur(govde: { ad?: string; ajanId: string; sablon: string; taxpayerIds: string[]; dryRun: boolean }): Promise<Kuyruk> {
  const { data } = await api.post('/ekip/kuyruk', { ...govde, dryRun: govde.dryRun !== false });
  const k = kuyrukNormalle(data?.kuyruk || data);
  if (!k) throw new Error('Kuyruk oluşturulamadı');
  return k;
}

export async function kuyrukDurdur(id: string): Promise<Kuyruk | null> {
  const { data } = await api.post(`/ekip/kuyruk/${encodeURIComponent(id)}/durdur`, {});
  return kuyrukNormalle(data?.kuyruk || null);
}

export async function kuyrukDevam(id: string): Promise<Kuyruk | null> {
  const { data } = await api.post(`/ekip/kuyruk/${encodeURIComponent(id)}/devam`, {});
  return kuyrukNormalle(data?.kuyruk || null);
}
