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
}

export type AsamaDurumu = 'tamam' | 'eksik' | 'yok';
export type AsamaAdi = 'evrak' | 'isleme' | 'kontrol' | 'beyanname' | 'gonderim' | 'tahakkukIletildi';

export interface PanoDonem {
  donem: string; // '2026-08'
  asamalar: Partial<Record<AsamaAdi, AsamaDurumu>>;
}

export interface PanoSatiri {
  taxpayerId: string;
  unvan: string;
  defterTuru?: string | null;
  donemler: PanoDonem[];
}

export interface EkipDurum {
  operator: { acik: boolean; cihaz: string | null };
  bekleyenOnay: number;
  bugunKosu: number;
  kota?: { kullanilan: number; limit?: number };
  sabahOzeti?: boolean;
  maxBagli?: boolean;
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

export async function getIsler(params?: { ajanId?: string; limit?: number }): Promise<IsDosyasi[]> {
  try {
    const { data } = await api.get('/ekip/isler', {
      params: { ajanId: params?.ajanId || undefined, limit: params?.limit ?? 50 },
    });
    return Array.isArray(data?.isler) ? data.isler : [];
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

export async function getPano(): Promise<PanoSatiri[]> {
  try {
    const { data } = await api.get('/ekip/pano');
    if (Array.isArray(data?.satirlar)) return data.satirlar;
    // Backend şekli: {donemler:[{istenenDonem, mukellefler:[{taxpayerId, ad, tip, kayitVar, asamalar:{evrak,isleme,kontrol,beyannameHazir,beyanname}}]}]}
    // Ekran şekli: mükellef satırı × dönem sütunu. Burada çevrilir; ekran bileşenleri değişmez.
    const donemler: any[] = Array.isArray(data?.donemler) ? data.donemler : [];
    const satirlar = new Map<string, PanoSatiri>();
    const durum = (v: unknown, kayitVar: boolean): AsamaDurumu => (v === true ? 'tamam' : kayitVar ? 'eksik' : 'yok');
    for (const d of donemler) {
      const donem = String(d?.istenenDonem || d?.beyannameDonem || '');
      for (const m of Array.isArray(d?.mukellefler) ? d.mukellefler : []) {
        const id = String(m?.taxpayerId || m?.ad || '');
        if (!id) continue;
        const kayitVar = m?.kayitVar === true;
        const a = m?.asamalar || {};
        const satir: PanoSatiri = satirlar.get(id) || { taxpayerId: id, unvan: m?.ad || id, defterTuru: m?.tip || null, donemler: [] as PanoDonem[] };
        satir.donemler.push({
          donem,
          asamalar: {
            evrak: durum(a.evrak, kayitVar),
            isleme: durum(a.isleme, kayitVar),
            kontrol: durum(a.kontrol, kayitVar),
            beyanname: durum(a.beyannameHazir, kayitVar),
            gonderim: durum(a.beyanname, kayitVar),
            tahakkukIletildi: 'yok' as AsamaDurumu,
          },
        });
        satirlar.set(id, satir);
      }
    }
    return Array.from(satirlar.values()).sort((x, y) => x.unvan.localeCompare(y.unvan, 'tr'));
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
    };
  } catch (e) {
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
