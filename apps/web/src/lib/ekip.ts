import { api, authorizedFetch, API_BASE } from './api';

/**
 * Moren Ekip (13 ajan kadrosu) — API sözleşmesi.
 * Backend omurgası ayrı yazılıyor; uçlar 404 dönerse OmurgaYokError fırlatılır,
 * ekran "Omurga henüz yayında değil" gösterir (çökmez).
 */

export type AjanId =
  | 'koordinator'
  | 'evrak'
  | 'fatura'
  | 'banka-kasa'
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

export type EkipKaynak = 'portal' | 'ses' | 'cron' | 'koordinator';

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

export interface EkipDurum {
  operator: { acik: boolean; cihaz: string | null };
  bekleyenOnay: number;
  bugunKosu: number;
  kota?: { kullanilan: number; limit?: number };
  sabahOzeti?: boolean;
  maxBagli?: boolean;
  /** Backend #2 (opsiyonel) — yoksa FE isler(200)'den hesaplar. */
  calisan?: number;
  bugunHata?: number;
  sonSabahOzeti?: { isId: string; createdAt: string; raporIlkSatir?: string | null } | null;
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
      kota: data?.kota,
      sabahOzeti: data?.sabahOzeti,
      maxBagli: data?.maxBagli,
      calisan: typeof data?.calisan === 'number' ? data.calisan : undefined,
      bugunHata: typeof data?.bugunHata === 'number' ? data.bugunHata : undefined,
      sonSabahOzeti: data?.sonSabahOzeti ?? undefined,
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
  body: { gorev: string; taxpayerId?: string; dryRun?: boolean },
  onEvent: (e: EkipStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await authorizedFetch(`${API_BASE}/ekip/${encodeURIComponent(ajanId)}/calistir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, dryRun: body.dryRun ?? true }),
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

// ─── ONAYLAR (dışarı gönderim → sahip onayı) ───

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
