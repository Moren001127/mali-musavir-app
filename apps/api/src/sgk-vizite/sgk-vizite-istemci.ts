/**
 * SGK WS_Vizite SOAP istemcisi — TARAYICISIZ, GÜVENLİK KODSUZ, SMS'SİZ (2026-09-26).
 *
 * Adres: https://uyg.sgk.gov.tr/Ws_Vizite/services/ViziteGonder (belge/literal, SOAP 1.1,
 * gövde öğesi `http://service.com` ad alanında, alt alanlar ad alanısız).
 * Giriş: e-Bildirge kullanıcı adı + işyeri kodu + İŞYERİ şifresi → 30 dk'lık wsToken.
 * SGK duyurusu: SMS doğrulaması yalnız internet ekranı içindir; web serviste 2. seviye doğrulama yok.
 *
 * CANLI GÖZLEM (2026-09-26): onayliRaporlarTarihile / onayliRaporlarDetay için SGK TÜM istemciye
 * dakikada bir izin veriyor (sonucKod 1012 "1 dakika aralıklar ile sorgulama yapabilirsiniz") —
 * mükellef başına değil. Bu yüzden bu iki çağrı `sinirliSira` ile tek sıradan ve ≥61 sn arayla gider.
 * raporAramaKimlikNo SGK tarafından kapatılmış (sonucKod -1) — kullanılmaz.
 *
 * GÜVENLİK: şifre ve token hiçbir log satırına yazılmaz; hata mesajlarına istek gövdesi eklenmez.
 */

export const VIZITE_ADRESI = process.env.SGK_VIZITE_URL || 'https://uyg.sgk.gov.tr/Ws_Vizite/services/ViziteGonder';
const ZAMAN_ASIMI_MS = 45_000;
/** Onaylı rapor / detay sorguları arası en az bekleme (SGK 1012 sınırı). */
export const SINIRLI_ARALIK_MS = Number(process.env.SGK_VIZITE_SINIR_MS || 61_000);

export const VIZITE_KOD = {
  BASARILI: 0,
  KAYIT_YOK_TARIH: 503,
  KAYIT_YOK_TC: 505,
  KAYIT_YOK: 506,
  KIMLIK_HATALI: 105,
  TOKEN_GECERSIZ: 106,
  METOD_KAPALI: -1,
  DAKIKA_SINIRI: 1012,
} as const;

/** "Kayıt bulunamadı" kodları — hata değil, boş liste. */
export const KAYIT_YOK_KODLARI = new Set<number>([VIZITE_KOD.KAYIT_YOK_TARIH, VIZITE_KOD.KAYIT_YOK_TC, VIZITE_KOD.KAYIT_YOK]);

export interface ViziteKimlik {
  kullaniciAdi: string;
  isyeriKodu: string;
  isyeriSifresi: string;
}

export interface ViziteOturum {
  kullaniciAdi: string;
  isyeriKodu: string;
  wsToken: string;
}

export interface ViziteCevap {
  sonucKod: number | null;
  sonucAciklama: string;
  /** Cevaptaki tüm kayıt öğeleri (…Bean), öğe adına göre. */
  kayitlar: Array<{ tip: string; alanlar: Record<string, string> }>;
}

export class ViziteHatasi extends Error {
  constructor(
    message: string,
    public readonly sonucKod: number | null,
    public readonly tur: 'KIMLIK' | 'SINIR' | 'AG' | 'SGK',
  ) {
    super(message);
    this.name = 'ViziteHatasi';
  }
}

// ─────────────────────────── saf yardımcılar (test edilir) ───────────────────────────

export function xmlKacis(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** SGK Türkçe harfleri sayısal varlık olarak gönderiyor ("Ba&#351;ar&#305;l&#305;"). */
export function varlikCoz(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function soapZarfi(islem: string, alanlar: Record<string, string>): string {
  const govde = Object.entries(alanlar)
    .map(([k, v]) => `<${k}>${xmlKacis(v)}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.com">' +
    `<soapenv:Header/><soapenv:Body><ser:${islem}>${govde}</ser:${islem}></soapenv:Body></soapenv:Envelope>`
  );
}

function ilkEtiket(xml: string, ad: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${ad}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${ad}>)`));
  if (!m) return null;
  return m[1] === undefined ? '' : m[1].trim();
}

/**
 * SOAP cevabını çözer: sonucKod, sonucAciklama ve BÜYÜK harfle başlayıp "Bean" ile biten her kayıt öğesi
 * (RaporAramaTarihleBean, OnayliRaporlarTarihleBean, OnayliRaporDetayBean, HastaneBildirimiIsKazasiBean,
 * IsKazasiHastaneBilgiBean …). Sarmalayıcılar küçük harfle başlar (raporAramaTarihleBeanArray) — atlanır.
 */
export function cevapCoz(xml: string): ViziteCevap {
  const fault = ilkEtiket(xml, 'faultstring');
  if (fault !== null && ilkEtiket(xml, 'sonucKod') === null) {
    return { sonucKod: null, sonucAciklama: `SOAP hatası: ${varlikCoz(fault).slice(0, 300)}`, kayitlar: [] };
  }
  const kodMetni = ilkEtiket(xml, 'sonucKod');
  const kod = kodMetni !== null && /^-?\d+$/.test(kodMetni) ? parseInt(kodMetni, 10) : null;
  const aciklama = varlikCoz(ilkEtiket(xml, 'sonucAciklama') || '').trim();
  const kayitlar: ViziteCevap['kayitlar'] = [];
  const kayitRe = /<(?:[\w-]+:)?([A-Z]\w*Bean)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/g;
  let m: RegExpExecArray | null;
  while ((m = kayitRe.exec(xml))) {
    const ic = m[2];
    const alanlar: Record<string, string> = {};
    const alanRe = /<(?:[\w-]+:)?([A-Za-z_][\w]*)\b([^>]*?)(?:\/>|>([^<]*)<\/(?:[\w-]+:)?\1>)/g;
    let a: RegExpExecArray | null;
    while ((a = alanRe.exec(ic))) {
      const nil = /xsi:nil\s*=\s*"true"/.test(a[2] || '');
      alanlar[a[1]] = nil ? '' : varlikCoz((a[3] ?? '').trim());
    }
    if (Object.keys(alanlar).length) kayitlar.push({ tip: m[1], alanlar });
  }
  return { sonucKod: kod, sonucAciklama: aciklama, kayitlar };
}

/** SGK tarihi → "YYYY-AA-GG" ya da null ("0001-01-01", "-", boş). "gg.aa.yyyy" da kabul edilir. */
export function sgkTarih(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  if (!s || s === '-' || s.startsWith('0001-01-01')) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** "YYYY-AA-GG" → "gg.aa.yyyy" (SGK istek biçimi). */
export function sgkIstekTarihi(iso: string): string {
  const [y, a, g] = iso.split('-');
  return `${g}.${a}.${y}`;
}

// ─────────────────────────── ağ ───────────────────────────

let dispatcherHazir: any = undefined;
function dispatcher(): any {
  if (dispatcherHazir !== undefined) return dispatcherHazir;
  const vekil = String(process.env.SGK_VIZITE_PROXY_URL || '').trim();
  if (!vekil) {
    dispatcherHazir = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ProxyAgent } = require('undici');
    dispatcherHazir = new ProxyAgent(vekil);
  } catch {
    dispatcherHazir = null;
  }
  return dispatcherHazir;
}

async function soapCagir(islem: string, alanlar: Record<string, string>): Promise<ViziteCevap> {
  let res: Response;
  try {
    const init: any = {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${islem}"` },
      body: soapZarfi(islem, alanlar),
      signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
    };
    const d = dispatcher();
    if (d) init.dispatcher = d;
    res = await fetch(VIZITE_ADRESI, init);
  } catch (e: any) {
    throw new ViziteHatasi(`SGK'ya bağlanılamadı (${islem}): ${String(e?.cause?.code || e?.name || e?.message || e).slice(0, 120)}`, null, 'AG');
  }
  const metin = await res.text();
  const cevap = cevapCoz(metin);
  if (cevap.sonucKod === null && !res.ok) {
    throw new ViziteHatasi(`SGK cevabı okunamadı (${islem}, HTTP ${res.status})`, null, 'AG');
  }
  return cevap;
}

const uyku = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Onaylı rapor / detay sorguları için süreç geneli tek sıra (SGK dakikada bir izin veriyor).
let sinirKuyrugu: Promise<unknown> = Promise.resolve();
let sonSinirliCagri = 0;

export function sinirliSira<T>(fn: () => Promise<T>): Promise<T> {
  const calis = async () => {
    const bekle = sonSinirliCagri + SINIRLI_ARALIK_MS - Date.now();
    if (bekle > 0) await uyku(bekle);
    try {
      return await fn();
    } finally {
      sonSinirliCagri = Date.now();
    }
  };
  const p = sinirKuyrugu.then(calis, calis);
  sinirKuyrugu = p.catch(() => undefined);
  return p;
}

// ─────────────────────────── işlemler ───────────────────────────

function kontrol(islem: string, c: ViziteCevap, kayitYokHataDegil = true): ViziteCevap {
  if (c.sonucKod === VIZITE_KOD.BASARILI) return c;
  if (kayitYokHataDegil && c.sonucKod !== null && KAYIT_YOK_KODLARI.has(c.sonucKod)) return { ...c, kayitlar: [] };
  if (c.sonucKod === VIZITE_KOD.KIMLIK_HATALI) throw new ViziteHatasi(`SGK girişi reddetti: ${c.sonucAciklama}`, c.sonucKod, 'KIMLIK');
  if (c.sonucKod === VIZITE_KOD.DAKIKA_SINIRI) throw new ViziteHatasi(`SGK sınırı: ${c.sonucAciklama}`, c.sonucKod, 'SINIR');
  throw new ViziteHatasi(`SGK ${islem}: ${c.sonucAciklama || 'bilinmeyen cevap'} (kod ${c.sonucKod ?? '?'})`, c.sonucKod, 'SGK');
}

/** wsLogin → 30 dk'lık token. Token bir "Bean" değil, ayrıca okunur; değeri ASLA loglanmaz. */
export async function viziteOturumAc(k: ViziteKimlik): Promise<ViziteOturum> {
  let res: Response;
  try {
    const init: any = {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"wsLogin"' },
      body: soapZarfi('wsLogin', { kullaniciAdi: k.kullaniciAdi, isyeriKodu: k.isyeriKodu, isyeriSifresi: k.isyeriSifresi }),
      signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
    };
    const d = dispatcher();
    if (d) init.dispatcher = d;
    res = await fetch(VIZITE_ADRESI, init);
  } catch (e: any) {
    throw new ViziteHatasi(`SGK'ya bağlanılamadı (giriş): ${String(e?.cause?.code || e?.name || e?.message || e).slice(0, 120)}`, null, 'AG');
  }
  const metin = await res.text();
  const c = cevapCoz(metin);
  const token = ilkEtiket(metin, 'wsToken');
  if (c.sonucKod === VIZITE_KOD.BASARILI && token && token.length >= 10) {
    return { kullaniciAdi: k.kullaniciAdi, isyeriKodu: k.isyeriKodu, wsToken: token };
  }
  if (c.sonucKod === null) throw new ViziteHatasi(`SGK giriş cevabı okunamadı (HTTP ${res.status})`, null, 'AG');
  kontrol('wsLogin', c, false);
  throw new ViziteHatasi(`SGK girişi token vermedi: ${c.sonucAciklama}`, c.sonucKod, 'SGK');
}

function ortak(o: ViziteOturum) {
  return { kullaniciAdi: o.kullaniciAdi, isyeriKodu: o.isyeriKodu, wsToken: o.wsToken };
}

/** Onay bekleyen raporlar (poliklinik tarihi < `oncesiIso`), en çok 100. */
export async function onayBekleyenRaporlar(o: ViziteOturum, oncesiIso: string) {
  const c = kontrol('raporAramaTarihile', await soapCagir('raporAramaTarihile', { ...ortak(o), tarih: sgkIstekTarihi(oncesiIso) }));
  return c.kayitlar.filter((k) => k.tip === 'RaporAramaTarihleBean').map((k) => k.alanlar);
}

/** SGK dakika sınırına takılınca bir kez bekleyip yeniden dener (sıra zaten ≥61 sn aralıklı). */
async function sinirliCagir(islem: string, alanlar: Record<string, string>): Promise<ViziteCevap> {
  return sinirliSira(async () => {
    let c = await soapCagir(islem, alanlar);
    if (c.sonucKod === VIZITE_KOD.DAKIKA_SINIRI) {
      await uyku(SINIRLI_ARALIK_MS);
      c = await soapCagir(islem, alanlar);
    }
    return c;
  });
}

/** Onaylanmış raporlar (tarih aralığı). SINIRLI: dakikada bir. */
export async function onayliRaporlar(o: ViziteOturum, basIso: string, bitIso: string) {
  const c = kontrol(
    'onayliRaporlarTarihile',
    await sinirliCagir('onayliRaporlarTarihile', { ...ortak(o), tarih1: sgkIstekTarihi(basIso), tarih2: sgkIstekTarihi(bitIso) }),
  );
  return c.kayitlar.filter((k) => k.tip === 'OnayliRaporlarTarihleBean').map((k) => k.alanlar);
}

/** Bir raporun onaylanmış aralıkları. SINIRLI: dakikada bir. */
export async function onayliRaporDetayi(o: ViziteOturum, medulaRaporId: string) {
  const c = kontrol('onayliRaporlarDetay', await sinirliCagir('onayliRaporlarDetay', { ...ortak(o), medulaRaporId }));
  return c.kayitlar.filter((k) => k.tip === 'OnayliRaporDetayBean').map((k) => k.alanlar);
}

/** Hastane iş kazası bildirimleri (tarih aralığı). */
export async function hastaneIsKazalari(o: ViziteOturum, basIso: string, bitIso: string) {
  const c = kontrol(
    'hasIsKazSorguTarihle',
    await soapCagir('hasIsKazSorguTarihle', { ...ortak(o), tarih: sgkIstekTarihi(basIso), tarih2: sgkIstekTarihi(bitIso) }),
  );
  return c.kayitlar
    .filter((k) => k.tip === 'HastaneBildirimiIsKazasiBean' || k.tip === 'IsKazasiHastaneBilgiBean')
    .map((k) => k.alanlar);
}

/** İŞVEREN BEYANI — rapora çalıştı/çalışmadı onayı. Yalnız kullanıcı düğmesinden çağrılır. */
export async function raporOnayla(
  o: ViziteOturum,
  p: { tcKimlikNo: string; vaka: string; medulaRaporId: string; calisti: boolean; bitisIso: string },
): Promise<ViziteCevap> {
  return soapCagir('raporOnay', {
    ...ortak(o),
    tckNo: p.tcKimlikNo,
    vaka: p.vaka,
    medulaRaporId: p.medulaRaporId,
    nitelikDurumu: p.calisti ? '1' : '0',
    tarih: sgkIstekTarihi(p.bitisIso),
  });
}

/** İŞVEREN BEYANI — "personelim değil". Yalnız kullanıcı düğmesinden çağrılır. */
export async function personelimDegil(o: ViziteOturum, p: { tcKimlikNo: string; vaka: string; medulaRaporId: string }): Promise<ViziteCevap> {
  return soapCagir('personelimDegildir', { ...ortak(o), tckNo: p.tcKimlikNo, vaka: p.vaka, medulaRaporId: p.medulaRaporId });
}
