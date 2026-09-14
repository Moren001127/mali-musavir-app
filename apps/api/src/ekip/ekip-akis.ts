/**
 * EKİP AKIŞI — saf fonksiyonlar (DB yok): iş dosyalarını VAKA (iş dosyası zinciri) olarak gruplar ve
 * her vakayı Muzaffer Bey’in üç kutusundan birine koyar (PLAN/18 §B).
 *
 * Vaka = kök iş (AgentCommand, agent='ekip:<ajanId>') + çocukları. Bağ yalnız JSON alanlarıyla:
 *   payload.vakaId  → kök işin id'si (kökte kendi id'si; eski kayıtlarda yok → her kayıt kendi vakası)
 *   payload.ustIsId → çocuğu açan iş (kökte null)
 *   payload.devirSayisi → vakadaki kaçıncı devir (kökte 0; Koordinatör koşuları devir sayılmaz)
 *
 * Kutu önceliği (her vaka TEK kutuda):
 *   1) onay    : açık OwnerApprovalRequest (PENDING, süresi dolmamış) ya da açık tur='onay' bildirimi
 *   2) istek   : açık tur='istek' bildirimi (Muzaffer Bey’den fiziksel iş: fiş/ekstre/şifre/evrak)
 *   3) suruyor : herhangi bir iş pending/running
 *   4) bitti   : hepsi done/failed ve açık kalem yok (failed varsa durum rozeti 'hata', kutu yine 'bitti')
 * 'bilgi' bildirimleri kutu değiştirmez; satırda "Koordinatör notu" adımı olarak görünür.
 */
import { ajanBul } from './ajan-tanimlari';

export type Kutu = 'suruyor' | 'onay' | 'istek' | 'bitti';
export type VakaDurum = 'suruyor' | 'bitti' | 'hata';
export type BildirimTuru = 'onay' | 'istek' | 'bilgi';

/** Kutu süzgeci için tümü + dört kutu. */
export const KUTULAR: Kutu[] = ['suruyor', 'onay', 'istek', 'bitti'];
export const BILDIRIM_TURLERI: BildirimTuru[] = ['onay', 'istek', 'bilgi'];
/** Kutu ≠ bitti ve bu kadar süredir güncellenmeyen vaka "gecikti" sayılır (devir sınırı bildirimi açıksa süre beklenmez). */
export const GECIKME_MS = 24 * 60 * 60 * 1000;
/** Bir vakada Koordinatör dışı en çok bu kadar devir açılır; fazlası koda gömülü olarak reddedilir. */
export const DEVIR_SINIRI = 2;

export interface AkisIs {
  id: string;
  agent: string;
  action?: string | null;
  payload?: any;
  status: string;
  result?: any;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
}

export interface AkisOnay {
  id: string;
  previewId: string;
  agent: string;
  action: string;
  payload?: any;
  status: string;
  expiresAt?: Date | string | null;
  createdAt: Date | string;
}

export interface AkisBildirim {
  id: string;
  title: string;
  body?: string | null;
  isRead?: boolean;
  metadata?: any;
  createdAt: Date | string;
}

export type VakaAdim =
  | {
      tip: 'is';
      isId: string;
      ajanId: string;
      baslik: string;
      durum: 'pending' | 'running' | 'done' | 'failed';
      baslangic: string;
      bitis: string | null;
      raporOzet: string | null;
      hata: string | null;
      devir: number | null;
      kuru: boolean;
    }
  | {
      tip: 'onay';
      id: string;
      ajanId: string;
      baslik: string;
      durum: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'EXPIRED';
      baslangic: string;
      hedef: string | null;
      confirmationText: string;
    }
  | {
      tip: 'bildirim';
      id: string;
      tur: BildirimTuru;
      baslik: string;
      govde: string;
      durum: 'acik' | 'kapandi';
      baslangic: string;
    };

export interface AcikKalem {
  tip: 'onay' | 'istek';
  id: string;
  baslik: string;
  kaynak: 'PRV' | 'bildirim';
  confirmationText?: string;
}

export interface Vaka {
  vakaId: string;
  mukellef: { id: string; ad: string | null } | null;
  konu: string;
  kuru: boolean;
  kimde: { ajanId: string; ad: string };
  durum: VakaDurum;
  kutu: Kutu;
  guncellendi: string;
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

const SIZ = { ajanId: 'siz', ad: 'Muzaffer Bey' } as const;

// ─── küçük yardımcılar ───

const ms = (d: Date | string | null | undefined): number => {
  if (!d) return 0;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};
const iso = (d: Date | string | null | undefined): string | null => (ms(d) ? new Date(ms(d)).toISOString() : null);
const ajanIdsi = (agent: any) => String(agent || '').replace(/^ekip:/, '');
const ajanAdi = (ajanId: string) => ajanBul(ajanId)?.ad || ajanId;
const nesne = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** İşin vakası: payload.vakaId, yoksa kendisi (eski kayıt). */
export function isinVakasi(is: AkisIs): string {
  const v = nesne(is.payload).vakaId;
  return typeof v === 'string' && v ? v : is.id;
}

/** Bildirim türü: metadata.tur enumda değilse 'onay' (varsayılan); "İŞ ATAMASI" başlığı her zaman 'bilgi'. */
export function bildirimTuru(b: { title?: string | null; metadata?: any }): BildirimTuru {
  if (/^İŞ ATAMASI/i.test(String(b.title || '').trim())) return 'bilgi';
  const t = nesne(b.metadata).tur;
  return BILDIRIM_TURLERI.includes(t) ? t : 'onay';
}

/** Açık kalem = okunmamış VE metadata.kapandi yok. */
export function bildirimAcikMi(b: AkisBildirim): boolean {
  return b.isRead !== true && !nesne(b.metadata).kapandi;
}

/** Onay kaydı açık mı: PENDING ve süresi dolmamış. */
export function onayAcikMi(o: AkisOnay, now = Date.now()): boolean {
  return o.status === 'PENDING' && (!o.expiresAt || ms(o.expiresAt) > now);
}

/** automationId `ekip:<ajanId>:<isId>` → isId (eski bildirimlerde vakaId/isId alanı yok, buradan çözülür). */
export function automationIdIsId(automationId: any): string | null {
  const m = String(automationId || '').match(/^ekip:[^:]+:([A-Za-z0-9]+)$/);
  return m ? m[1] : null;
}

/** Bildirimin ajanı: metadata.ajanId, yoksa automationId'nin ortası. */
function bildirimAjani(b: AkisBildirim): string | null {
  const md = nesne(b.metadata);
  if (typeof md.ajanId === 'string' && md.ajanId) return md.ajanId;
  const m = String(md.automationId || '').match(/^ekip:([^:]+):/);
  return m ? m[1] : null;
}

/**
 * Kök görev metninin ilk satırı (≤80 kr); "İŞ ATAMASI → …" ise ok işaretinden sonrası.
 * Sesli/WhatsApp görevlerinde (sesGoreviOlustur) asıl istek "SORU/KOMUT:" satırındadır; bağlam satırları ("Muzaffer Bey canlı ses
 * üzerinden konuşuyor…") konu olarak gösterilmez (PLAN/19 A, 2026-09-14).
 */
export function konuBasligi(gorev: any, tavan = 80): string {
  const metin = String(gorev || '');
  const soru = metin.match(/^\s*SORU\/KOMUT\s*:\s*(.+)$/im);
  let s = soru
    ? soru[1].trim()
    : metin
        .split(/\r?\n/)
        .map((x) => x.trim())
        .find((x) => x.length > 0) || '';
  const m = s.match(/^İŞ ATAMASI\s*(?:→|->)\s*(.*)$/i);
  if (m) s = m[1].trim();
  s = s.replace(/^[\s*_`#>\-•]+/, '').replace(/\*\*|`/g, '').trim();
  return s.length > tavan ? `${s.slice(0, tavan - 1).trimEnd()}…` : s;
}

/** Kutu kararı — saf; açık kalemler ve iş durumlarından. */
export function vakaKutusu(input: {
  isler: Array<{ status: string }>;
  acikOnayVar: boolean;
  acikIstekVar: boolean;
}): { kutu: Kutu; durum: VakaDurum } {
  const suruyor = input.isler.some((i) => i.status === 'pending' || i.status === 'running');
  const hata = !suruyor && input.isler.some((i) => i.status === 'failed');
  const durum: VakaDurum = suruyor ? 'suruyor' : hata ? 'hata' : 'bitti';
  if (input.acikOnayVar) return { kutu: 'onay', durum };
  if (input.acikIstekVar) return { kutu: 'istek', durum };
  return { kutu: suruyor ? 'suruyor' : 'bitti', durum };
}

/**
 * Gruplama: işler + onaylar + bildirimler → Vaka[] (guncellendi'ye göre yeni → eski).
 * Mükellef adı burada çözülmez (ad:null); servis toplu taxpayer sorgusuyla doldurur.
 * Onay/bildirim, vakaya isId (payload.isId / metadata.isId / automationId) ya da metadata.vakaId ile bağlanır;
 * bağlanamayan kayıt atlanır.
 */
export function vakaGrupla(
  isler: AkisIs[],
  onaylar: AkisOnay[] = [],
  bildirimler: AkisBildirim[] = [],
  opts: { now?: number; gecikmeMs?: number } = {},
): Vaka[] {
  const now = opts.now ?? Date.now();
  const gecikmeMs = opts.gecikmeMs ?? GECIKME_MS;

  // 1) işleri vakaya böl (zamana göre artan)
  const gruplar = new Map<string, AkisIs[]>();
  const isVakasi = new Map<string, string>();
  for (const is of isler) {
    const v = isinVakasi(is);
    isVakasi.set(is.id, v);
    const g = gruplar.get(v) || [];
    g.push(is);
    gruplar.set(v, g);
  }
  const vakaBul = (isId: string | null | undefined, vakaId: string | null | undefined): string | null => {
    if (vakaId && gruplar.has(vakaId)) return vakaId;
    if (isId && isVakasi.has(isId)) return isVakasi.get(isId)!;
    return null;
  };

  // 2) onay + bildirimleri vakaya bağla
  const vakaOnaylari = new Map<string, AkisOnay[]>();
  for (const o of onaylar) {
    const pl = nesne(o.payload);
    const v = vakaBul(pl.isId, pl.vakaId);
    if (!v) continue;
    const g = vakaOnaylari.get(v) || [];
    g.push(o);
    vakaOnaylari.set(v, g);
  }
  const vakaBildirimleri = new Map<string, AkisBildirim[]>();
  for (const b of bildirimler) {
    const md = nesne(b.metadata);
    const v = vakaBul(md.isId || automationIdIsId(md.automationId), md.vakaId);
    if (!v) continue;
    const g = vakaBildirimleri.get(v) || [];
    g.push(b);
    vakaBildirimleri.set(v, g);
  }

  // 3) her vaka
  const out: Vaka[] = [];
  for (const [vakaId, grup] of gruplar) {
    grup.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    const kok = grup.find((i) => i.id === vakaId) || grup[0];
    const kokPayload = nesne(kok.payload);
    const onaylari = vakaOnaylari.get(vakaId) || [];
    const bildirimleri = vakaBildirimleri.get(vakaId) || [];

    const acikOnaylar = onaylari.filter((o) => onayAcikMi(o, now));
    const acikBildirimler = bildirimleri.filter(bildirimAcikMi);
    const acikOnayBildirimi = acikBildirimler.filter((b) => bildirimTuru(b) === 'onay');
    const acikIstekBildirimi = acikBildirimler.filter((b) => bildirimTuru(b) === 'istek');
    const { kutu, durum } = vakaKutusu({
      isler: grup,
      acikOnayVar: acikOnaylar.length > 0 || acikOnayBildirimi.length > 0,
      acikIstekVar: acikIstekBildirimi.length > 0,
    });

    // adımlar
    const adimlar: VakaAdim[] = [];
    for (const i of grup) {
      const pl = nesne(i.payload);
      const res = nesne(i.result);
      adimlar.push({
        tip: 'is',
        isId: i.id,
        ajanId: ajanIdsi(i.agent),
        baslik: konuBasligi(pl.gorev || i.action, 120),
        durum: (['pending', 'running', 'done', 'failed'].includes(i.status) ? i.status : 'done') as any,
        baslangic: iso(i.startedAt || i.createdAt) || new Date(now).toISOString(),
        bitis: iso(i.finishedAt),
        raporOzet: typeof res.rapor === 'string' && res.rapor.trim() ? res.rapor.slice(0, 300) : null,
        hata: res.hata ? String(res.hata) : null,
        devir: typeof pl.devirSayisi === 'number' ? pl.devirSayisi : null,
        kuru: pl.dryRun !== false,
      });
    }
    for (const o of onaylari) {
      const pl = nesne(o.payload);
      const hedef = pl.to || pl.phone || pl.email || pl.taxpayerId || null;
      const durumO = (['PENDING', 'EXECUTED', 'REJECTED', 'EXPIRED'].includes(o.status) ? o.status : 'PENDING') as any;
      adimlar.push({
        tip: 'onay',
        id: o.previewId,
        ajanId: ajanIdsi(o.agent),
        baslik: `${ajanAdi(ajanIdsi(o.agent))} → ${hedef ? String(hedef) : 'dışarı mesaj'} (${o.action})`,
        durum: durumO === 'PENDING' && !onayAcikMi(o, now) ? 'EXPIRED' : durumO,
        baslangic: iso(o.createdAt) || new Date(now).toISOString(),
        hedef: hedef ? String(hedef) : null,
        confirmationText: `ONAYLIYORUM #${o.previewId}`,
      });
    }
    for (const b of bildirimleri) {
      adimlar.push({
        tip: 'bildirim',
        id: b.id,
        tur: bildirimTuru(b),
        baslik: String(b.title || '').slice(0, 200),
        govde: String(b.body || '').slice(0, 1000),
        durum: bildirimAcikMi(b) ? 'acik' : 'kapandi',
        baslangic: iso(b.createdAt) || new Date(now).toISOString(),
      });
    }
    adimlar.sort((a, b) => ms(a.baslangic) - ms(b.baslangic));

    // açık kalemler
    const acikKalemler: AcikKalem[] = [];
    for (const o of acikOnaylar) {
      const pl = nesne(o.payload);
      const hedef = pl.to || pl.phone || pl.email || pl.taxpayerId || null;
      acikKalemler.push({
        tip: 'onay',
        id: o.previewId,
        baslik: `${ajanAdi(ajanIdsi(o.agent))} → ${hedef ? String(hedef) : 'dışarı mesaj'} (${o.action})`,
        kaynak: 'PRV',
        confirmationText: `ONAYLIYORUM #${o.previewId}`,
      });
    }
    for (const b of acikOnayBildirimi) acikKalemler.push({ tip: 'onay', id: b.id, baslik: String(b.title || '').slice(0, 200), kaynak: 'bildirim' });
    for (const b of acikIstekBildirimi) acikKalemler.push({ tip: 'istek', id: b.id, baslik: String(b.title || '').slice(0, 200), kaynak: 'bildirim' });

    // kimde
    let kimde: { ajanId: string; ad: string };
    if (kutu === 'onay' || kutu === 'istek') kimde = { ...SIZ };
    else if (kutu === 'suruyor') {
      const kosan = [...grup].reverse().find((i) => i.status === 'running') || [...grup].reverse().find((i) => i.status === 'pending') || grup[grup.length - 1];
      const aid = ajanIdsi(kosan.agent);
      kimde = { ajanId: aid, ad: ajanAdi(aid) };
    } else {
      const sonBiten = [...grup].sort((a, b) => ms(b.finishedAt || b.createdAt) - ms(a.finishedAt || a.createdAt))[0];
      const aid = ajanIdsi(sonBiten.agent);
      kimde = { ajanId: aid, ad: ajanAdi(aid) };
    }

    // mükellef: kök, yoksa taxpayerId'li ilk çocuk
    const mukellefId: string | null = kokPayload.taxpayerId || grup.map((i) => nesne(i.payload).taxpayerId).find((t) => typeof t === 'string' && t) || null;

    // güncellendi: iş zamanları + açık kalem zamanları
    let guncellendiMs = 0;
    for (const i of grup) guncellendiMs = Math.max(guncellendiMs, ms(i.finishedAt), ms(i.startedAt), ms(i.createdAt));
    for (const o of acikOnaylar) guncellendiMs = Math.max(guncellendiMs, ms(o.createdAt));
    for (const b of acikBildirimler) guncellendiMs = Math.max(guncellendiMs, ms(b.createdAt));
    if (!guncellendiMs) guncellendiMs = now;

    // Devir sınırına takılan vaka ("Karar sizde" bildirimi, metadata.gecikme='devir') okunana dek GECİKTİ sayılır —
    // Muzaffer Bey'e tek satırla gelsin (PLAN/18 §11); 24 saat kuralını beklemez, kutu 'bitti' olsa da bayrak kalkmaz.
    const devirTikandi = acikBildirimler.some((b) => nesne(b.metadata).gecikme === 'devir');

    out.push({
      vakaId,
      mukellef: mukellefId ? { id: mukellefId, ad: null } : null,
      konu: konuBasligi(kokPayload.gorev || kok.action) || '(görev yok)',
      kuru: grup.every((i) => nesne(i.payload).dryRun !== false),
      kimde,
      durum,
      kutu,
      guncellendi: new Date(guncellendiMs).toISOString(),
      gecikti: devirTikandi || (kutu !== 'bitti' && guncellendiMs < now - gecikmeMs),
      olusturuldu: iso(kok.createdAt) || new Date(guncellendiMs).toISOString(),
      adimlar,
      acikKalemler,
    });
  }
  out.sort((a, b) => ms(b.guncellendi) - ms(a.guncellendi));
  return out;
}

/** Sayaçlar — süzgeçten bağımsız (tüm pencere). */
export function akisSayaclari(vakalar: Vaka[]): AkisSayaclari {
  const s: AkisSayaclari = { suruyor: 0, onay: 0, istek: 0, bitti: 0, gecikti: 0 };
  for (const v of vakalar) {
    s[v.kutu]++;
    if (v.gecikti) s.gecikti++;
  }
  return s;
}

/**
 * Sabah özeti satırı: "Ekip akışı: sürüyor N · onayınızı bekleyen N · sizden istenen N · dün bitti N · gecikti: …".
 * "dün bitti" = kutu bitti ve son 24 saatte güncellenen. Gecikenler en çok 3: <mükellef · konu · kimde>.
 */
export function akisOzetSatiri(vakalar: Vaka[], now = Date.now()): string {
  const s = akisSayaclari(vakalar);
  const dunBitti = vakalar.filter((v) => v.kutu === 'bitti' && ms(v.guncellendi) >= now - GECIKME_MS).length;
  const gecikenler = vakalar
    .filter((v) => v.gecikti)
    .slice(0, 3)
    .map((v) => `${v.mukellef?.ad || v.mukellef?.id || 'mükellefsiz'} · ${v.konu} · ${v.kimde.ad}`);
  const gecikti = gecikenler.length ? `gecikti: ${gecikenler.join(' / ')}${s.gecikti > 3 ? ` (+${s.gecikti - 3})` : ''}` : 'gecikti: yok';
  return `Ekip akışı: sürüyor ${s.suruyor} · onayınızı bekleyen ${s.onay} · sizden istenen ${s.istek} · dün bitti ${dunBitti} · ${gecikti}`;
}
