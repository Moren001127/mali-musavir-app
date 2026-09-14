/**
 * e-Tebligat · SGK sayfalı belge listeleri için SAF yardımcılar (DB / Nest yok; girdi → çıktı).
 * Alan adları docs/sayfalama-sozlesme-2026-09-14.md §1 ve §3 ile BİREBİR — web tarafı aynı sözleşmeye göre yazılıyor.
 * Testler: belge-sayfa.spec.ts
 */

export type HataTuru = 'sifre' | 'guvenlik_kodu' | 'baglanti' | 'diger';
export type HataBilgisi = { tur: HataTuru; metin: string; ham: string };

export type IletimBilgisi = {
  channel: 'WHATSAPP' | 'EMAIL';
  status: 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED';
  sentAt: string | null;
  error: string | null;
  testMode: boolean;
};

export type TebligDurumu = 'bekliyor' | 'yaklasiyor' | 'edildi';

export type BelgeOzeti = {
  // tebligat
  kurumAciklama?: string | null;
  altKurum?: string | null;
  gonderimZamani?: string | null; // ham metin (dd/MM/yyyy HH:mm:ss)
  tebligZamani?: string | null;
  okumaZamani?: string | null;
  tebligTarihi?: string | null; // ISO — receivedAt; yoksa tebligZamani'ndan çevrilmiş
  tebligDurumu?: TebligDurumu | null;
  // SGK
  kanunNo?: string | null;
  calisan?: number | null;
  tutar?: number | null;
  mahiyet?: string | null;
};

export type SayfaMukellef = {
  id: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  taxNumber: string | null;
};

export type BelgeSatiri = {
  id: string;
  taxpayerId: string | null;
  taxpayer: SayfaMukellef | null;
  belgeTuru: string;
  title: string;
  referenceNo: string | null;
  period: string | null;
  issuedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  pdfVar: boolean;
  viewedAt: string | null;
  ozet: BelgeOzeti;
  iletim: IletimBilgisi[];
  // yalnız birlesik=1 (SGK)
  hizmet?: { id: string; pdfVar: boolean; viewedAt: string | null } | null;
  tahakkuk?: { id: string; pdfVar: boolean; viewedAt: string | null; tutar: number | null } | null;
};

/** DB'den `select` ile çekilen belge (raw burada okunur, YANITA GİRMEZ). */
export type SayfaBelgeKaydi = {
  id: string;
  taxpayerId: string | null;
  belgeTuru: string;
  title: string;
  referenceNo: string | null;
  period: string | null;
  issuedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  storageKey: string | null;
  viewedAt: Date | null;
  raw?: any;
  taxpayer?: SayfaMukellef | null;
};

/** document_dispatches satırının bu iş için gereken kısmı. */
export type GonderimKaydi = {
  channel: string;
  status: string;
  sentAt: Date | string | null;
  error: string | null;
  testMode: boolean;
  docRefs: any;
  createdAt: Date | string;
};

export const SAYFA_BOYUTLARI = [25, 50, 100] as const;
export const SAYFA_BOYUTU_VARSAYILAN = 50;
export const SAYFA_BOYUTU_EN_COK = 1000; // dışa aktarım
export const TEBLIG_YAKLASMA_GUN = 2;
const GUN_MS = 24 * 60 * 60 * 1000;

// ───────────────────────── sorgu parametreleri ─────────────────────────

/** 25 | 50 | 100 ya da dışa aktarım için 100 < n ≤ 1000; başka her değer → 50. */
export function sayfaBoyutuCoz(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n)) return SAYFA_BOYUTU_VARSAYILAN;
  if ((SAYFA_BOYUTLARI as readonly number[]).includes(n)) return n;
  if (n > 100 && n <= SAYFA_BOYUTU_EN_COK) return n;
  return SAYFA_BOYUTU_VARSAYILAN;
}

export function sayfaCoz(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 'SGK_TAHAKKUK, sgk_hizmet_listesi' → ['SGK_TAHAKKUK','SGK_HIZMET_LISTESI'] (boşsuz, tekil). */
export function belgeTuruListesi(v: unknown): string[] {
  return Array.from(new Set(
    String(v ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  ));
}

export function sgkBelgeTuruMu(belgeTuru: string): boolean {
  return String(belgeTuru || '').toUpperCase().startsWith('SGK_');
}

/** 'YYYY-MM' ya da 'YYYY/MM' → her iki yazım (SGK dönemi 'YYYY/MM' saklanır); başka metin olduğu gibi. */
export function donemVaryantlari(v: unknown): string[] {
  const text = String(v ?? '').trim();
  if (!text) return [];
  const m = text.match(/^(\d{4})[-/](\d{1,2})$/);
  if (!m) return [text];
  const ay = m[2].padStart(2, '0');
  return [`${m[1]}/${ay}`, `${m[1]}-${ay}`];
}

/** Arama metnini boşluktan böler (en çok 5 parça); her parça ayrı ayrı eşleşmeli (VE). */
export function aramaParcalari(v: unknown): string[] {
  return String(v ?? '')
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** ILIKE/LIKE joker karakterlerini kaçır (kullanıcı '%' yazarsa harfiyen aransın). */
export function likeKacis(v: string): string {
  return String(v).replace(/[\\%_]/g, '\\$&');
}

// ───────────────────────── hata sınıflandırma ─────────────────────────

/** Türkçe harfleri ASCII'ye indirip küçük harfe çevirir (yalnız EŞLEŞTİRME için; ham metin değişmez). */
export function asciiKatla(v: string): string {
  return String(v || '')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 's')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'u')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c')
    .toLowerCase();
}

const METIN_GUVENLIK_KODU = 'Güvenlik kodu çözülemedi (servis) — otomatik yeniden denenir';
const METIN_BAGLANTI = 'Portala bağlanılamadı — otomatik yeniden denenir';
const METIN_GIRIS_BELIRSIZ = 'Giriş doğrulanamadı — şifre yanlış olabilir ya da güvenlik kodu çözülemedi; şifreyi kontrol edin';

/**
 * Ham portal/iş hata metnini kullanıcıya gösterilecek türe indirger.
 *  sifre          → şifre büyük olasılıkla yanlış (3 GECE KURALI yalnız bu türe bakar)
 *  guvenlik_kodu  → captcha servisi (2captcha) sorunu; kendiliğinden yeniden denenir
 *  baglanti       → ağ / portal erişim sorunu; kendiliğinden yeniden denenir
 *  diger          → sınıflanamadı; ham metin (200 karakter)
 */
export function hataSiniflandir(hamGirdi: unknown): HataBilgisi {
  const ham = String(hamGirdi ?? '').trim();
  const k = asciiKatla(ham);
  if (!ham) return { tur: 'diger', metin: '', ham: '' };

  // 1) Güvenlik kodu SERVİSİNİN kendi hataları (bakiye/anahtar/zaman aşımı) — şifreyle ilgisi yok;
  //    "N denemede doğrulanamadı" sarmalının içinde gelse bile kök neden budur, önce ayıklanır.
  if (/2captcha|twocaptcha|captcha bakiye|error_zero_balance|error_wrong_user_key|error_key_does_not_exist|ip_banned|error_no_slot_available/.test(k)) {
    return { tur: 'guvenlik_kodu', metin: METIN_GUVENLIK_KODU, ham };
  }

  // 2) Şifre hatası
  const deneme = k.match(/(\d+) denemede (?:giris )?dogrulanamadi/);
  if (deneme) {
    return { tur: 'sifre', metin: `Şifre büyük olasılıkla yanlış — ${deneme[1]} denemede giriş doğrulanamadı`, ham };
  }
  if (/sifre(?:si)? reddedildi/.test(k)) {
    const kuyruk = ham.match(/[sş]ifre(?:si)?\s+reddedildi\s*:?\s*(.*)$/i);
    const sebep = String(kuyruk?.[1] || '').trim().slice(0, 200);
    return { tur: 'sifre', metin: sebep ? `Şifre reddedildi: ${sebep}` : 'Şifre reddedildi', ham };
  }
  if (/buyuk olasilikla yanlis/.test(k)) {
    return { tur: 'sifre', metin: 'Şifre büyük olasılıkla yanlış', ham };
  }

  // 3) Güvenlik kodu çözülemedi (servis yanıt vermedi / captcha zaman aşımı). "zaman asimi" TEK BAŞINA yetmez:
  //    "Railway runner hareketsizlik zaman asimi (45 dk)" (canlı veride 56 kayıt) güvenlik kodu sorunu değil → diger.
  if (/captcha otomatik cozulemedi|captcha[^|]*zaman asimi|zaman asimi[^|]*captcha/.test(k)) {
    return { tur: 'guvenlik_kodu', metin: METIN_GUVENLIK_KODU, ham };
  }

  // 4) Bağlantı
  if (/timeout|econn|enotfound|net::|navigation|baglan|\b50[234]\b/.test(k)) {
    return { tur: 'baglanti', metin: METIN_BAGLANTI, ham };
  }

  // 5) Tek denemelik belirsiz giriş hatası (deneme sayısı yok) → şifre olabilir
  if (/captcha cozulemedi veya portal sifreyi reddetti/.test(k)) {
    return { tur: 'sifre', metin: METIN_GIRIS_BELIRSIZ, ham };
  }

  return { tur: 'diger', metin: ham.slice(0, 200), ham };
}

// ───────────────────────── tarih / sayı çevirme ─────────────────────────

/** GİB/SGK ham tarihi ('13/09/2026 12:00:38', '13.09.2026') → Date (Türkiye saati +03:00). */
export function trTarihCevir(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, gg, aa, yyyy, hh = '00', dk = '00', sn = '00'] = m;
    const d = new Date(`${yyyy}-${aa.padStart(2, '0')}-${gg.padStart(2, '0')}T${hh.padStart(2, '0')}:${dk}:${sn}+03:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '690,09' → 690.09; '12.799,13' → 12799.13; 690.09 → 690.09; boş/bozuk → null. */
export function tutarCevir(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  let normal: string;
  if (s.includes(',')) normal = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, ''); // yalnız binlik nokta
  else normal = s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** '1' → 1; boş/bozuk → null. */
export function tamSayiCevir(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9-]/g, ''));
  return Number.isInteger(n) ? n : null;
}

function isoVeyaNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function metinVeyaNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ───────────────────────── tebliğ durumu ─────────────────────────

/** now < tebliğ-2g → bekliyor | tebliğ-2g ≤ now < tebliğ → yaklasiyor | now ≥ tebliğ → edildi */
export function tebligDurumuHesapla(tebligTarihi: Date | null, now: Date = new Date()): TebligDurumu | null {
  if (!tebligTarihi || Number.isNaN(tebligTarihi.getTime())) return null;
  const t = tebligTarihi.getTime();
  const simdi = now.getTime();
  if (simdi >= t) return 'edildi';
  if (simdi >= t - TEBLIG_YAKLASMA_GUN * GUN_MS) return 'yaklasiyor';
  return 'bekliyor';
}

// ───────────────────────── ham → özet ─────────────────────────

/** raw JSON'dan yanıta girecek kısa özet (raw'ın kendisi dönmez). */
export function belgeOzetiKur(belgeTuru: string, rawGirdi: unknown, receivedAt: Date | null, now: Date = new Date()): BelgeOzeti {
  const raw: Record<string, any> = rawGirdi && typeof rawGirdi === 'object' && !Array.isArray(rawGirdi) ? (rawGirdi as any) : {};
  const tur = String(belgeTuru || '').toUpperCase();
  if (tur === 'E_TEBLIGAT') {
    const tebligTarihi = (receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : null) || trTarihCevir(raw.tebligZamani);
    return {
      kurumAciklama: metinVeyaNull(raw.kurumAciklama),
      altKurum: metinVeyaNull(raw.altKurum),
      gonderimZamani: metinVeyaNull(raw.gonderimZamani),
      tebligZamani: metinVeyaNull(raw.tebligZamani),
      okumaZamani: metinVeyaNull(raw.mukellefOkumaZamani ?? raw.okumaZamani),
      tebligTarihi: tebligTarihi ? tebligTarihi.toISOString() : null,
      tebligDurumu: tebligDurumuHesapla(tebligTarihi, now),
    };
  }
  if (sgkBelgeTuruMu(tur)) {
    return {
      kanunNo: metinVeyaNull(raw.kanunNo),
      calisan: tamSayiCevir(raw.calisan),
      // Tutar yalnız TAHAKKUK fişinindir; hizmet listesine aynı meta yazılsa da toplamı şişirmesin diye boş.
      tutar: tur === 'SGK_TAHAKKUK' ? tutarCevir(raw.tutar) : null,
      mahiyet: metinVeyaNull(raw.belgeMahiyeti ?? raw.mahiyet),
    };
  }
  return {};
}

// ───────────────────────── iletim eşleme ─────────────────────────

/** Verilen belge id'lerinden birini docRefs'inde taşıyan gönderimler: kanal başına EN YENİSİ, en yeni önce. */
export function iletimEsle(belgeIdleri: string[], gonderimler: GonderimKaydi[]): IletimBilgisi[] {
  const idler = new Set(belgeIdleri.filter(Boolean).map(String));
  if (!idler.size || !gonderimler?.length) return [];
  const zaman = (g: GonderimKaydi) => {
    const d = g.createdAt instanceof Date ? g.createdAt : new Date(g.createdAt);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  };
  const sirali = [...gonderimler].sort((a, b) => zaman(b) - zaman(a));
  const kanalBasina = new Map<string, IletimBilgisi>();
  for (const g of sirali) {
    const refs = Array.isArray(g.docRefs) ? g.docRefs : [];
    if (!refs.some((r) => idler.has(String(r)))) continue;
    const channel = String(g.channel || '').toUpperCase();
    if (!channel || kanalBasina.has(channel)) continue;
    kanalBasina.set(channel, {
      channel: channel as IletimBilgisi['channel'],
      status: String(g.status || 'PENDING').toUpperCase() as IletimBilgisi['status'],
      sentAt: isoVeyaNull(g.sentAt),
      error: g.error || null,
      testMode: g.testMode === true,
    });
  }
  return Array.from(kanalBasina.values());
}

// ───────────────────────── satır kurma ─────────────────────────

function mukellefKur(tp: SayfaMukellef | null | undefined): SayfaMukellef | null {
  if (!tp) return null;
  return {
    id: tp.id,
    companyName: tp.companyName ?? null,
    firstName: tp.firstName ?? null,
    lastName: tp.lastName ?? null,
    taxNumber: tp.taxNumber ?? null,
  };
}

/** Tek belge → sözleşme satırı (iletim boş gelir; servis sonradan doldurur). */
export function belgeSatiriKur(doc: SayfaBelgeKaydi, now: Date = new Date()): BelgeSatiri {
  return {
    id: doc.id,
    taxpayerId: doc.taxpayerId ?? null,
    taxpayer: mukellefKur(doc.taxpayer),
    belgeTuru: doc.belgeTuru,
    title: doc.title,
    referenceNo: doc.referenceNo ?? null,
    period: doc.period ?? null,
    issuedAt: isoVeyaNull(doc.issuedAt),
    receivedAt: isoVeyaNull(doc.receivedAt),
    createdAt: isoVeyaNull(doc.createdAt) || new Date(0).toISOString(),
    pdfVar: Boolean(doc.storageKey),
    viewedAt: isoVeyaNull(doc.viewedAt),
    ozet: belgeOzetiKur(doc.belgeTuru, doc.raw, doc.receivedAt ?? null, now),
    iletim: [],
  };
}

/** SGK birleşik anahtarı: mükellef + (referenceNo || period). */
export function sgkBirlesikAnahtar(doc: Pick<SayfaBelgeKaydi, 'taxpayerId' | 'referenceNo' | 'period'>): string {
  return `${doc.taxpayerId || ''}|${doc.referenceNo || doc.period || ''}`;
}

function enYeni(docs: SayfaBelgeKaydi[]): SayfaBelgeKaydi | null {
  if (!docs.length) return null;
  return [...docs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

/**
 * Aynı bildirgenin tahakkuk + hizmet belgeleri → TEK satır. id = tahakkuk id'si (yoksa hizmet).
 * ozet.tutar tahakkuktan gelir; hizmet/tahakkuk alt nesneleri PDF ve görüntülenme bilgisini taşır.
 */
export function sgkBirlesikSatirKur(docs: SayfaBelgeKaydi[], now: Date = new Date()): BelgeSatiri | null {
  const tahakkukDoc = enYeni(docs.filter((d) => String(d.belgeTuru).toUpperCase() === 'SGK_TAHAKKUK'));
  const hizmetDoc = enYeni(docs.filter((d) => String(d.belgeTuru).toUpperCase() === 'SGK_HIZMET_LISTESI'));
  const ana = tahakkukDoc || hizmetDoc || enYeni(docs);
  if (!ana) return null;
  const satir = belgeSatiriKur(ana, now);
  const tahakkukOzet = tahakkukDoc ? belgeOzetiKur('SGK_TAHAKKUK', tahakkukDoc.raw, tahakkukDoc.receivedAt ?? null, now) : null;
  // Özet: kanun/çalışan/mahiyet hangisinde doluysa oradan; tutar YALNIZ tahakkuktan.
  const hizmetOzet = hizmetDoc ? belgeOzetiKur('SGK_HIZMET_LISTESI', hizmetDoc.raw, hizmetDoc.receivedAt ?? null, now) : null;
  satir.ozet = {
    kanunNo: tahakkukOzet?.kanunNo ?? hizmetOzet?.kanunNo ?? null,
    calisan: tahakkukOzet?.calisan ?? hizmetOzet?.calisan ?? null,
    tutar: tahakkukOzet?.tutar ?? null,
    mahiyet: tahakkukOzet?.mahiyet ?? hizmetOzet?.mahiyet ?? null,
  };
  satir.period = ana.period ?? tahakkukDoc?.period ?? hizmetDoc?.period ?? null;
  satir.hizmet = hizmetDoc
    ? { id: hizmetDoc.id, pdfVar: Boolean(hizmetDoc.storageKey), viewedAt: isoVeyaNull(hizmetDoc.viewedAt) }
    : null;
  satir.tahakkuk = tahakkukDoc
    ? { id: tahakkukDoc.id, pdfVar: Boolean(tahakkukDoc.storageKey), viewedAt: isoVeyaNull(tahakkukDoc.viewedAt), tutar: tahakkukOzet?.tutar ?? null }
    : null;
  return satir;
}

/** Satırın iletim eşlemesinde kullanılacak belge id'leri (birleşikte alt belgeler de). */
export function satirBelgeIdleri(satir: BelgeSatiri): string[] {
  return Array.from(new Set([satir.id, satir.hizmet?.id, satir.tahakkuk?.id].filter((v): v is string => Boolean(v))));
}

/** belgeTuru → DocumentDispatch.kategori (VERGI|SGK|ETEBLIGAT). */
export function iletimKategorisi(belgeTuru: string): 'SGK' | 'ETEBLIGAT' | null {
  const t = String(belgeTuru || '').toUpperCase();
  if (t === 'E_TEBLIGAT') return 'ETEBLIGAT';
  if (sgkBelgeTuruMu(t)) return 'SGK';
  return null;
}
