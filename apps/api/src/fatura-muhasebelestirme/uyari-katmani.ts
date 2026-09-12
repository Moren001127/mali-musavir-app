/**
 * Faz 2 (PLAN/15 §C) — TEK UYARI MODELİ.
 *
 * ocrData.uyarilar[] = Uyari[] — kod + seviye + başlık + açıklama + öneri + tek-tık eylemler.
 *
 * GERİYE UYUM: eski model {kod, baslik, mesaj, siddet: hata|uyari|bilgi} (denetimUyariOlustur + rematch)
 * hâlâ yazılıyor ve page.tsx/approveBatch/computeDocConfidence o alanları okuyor. Bu yüzden Uyari
 * hem YENİ alanları (seviye/aciklama/oneri/eylemler) hem eski alanları (mesaj/siddet) taşır; eski
 * kayıtlar `eskiUyariyiHaritala` ile yerinde yükseltilir (idempotent).
 *
 * KAYNAK ayrımı: kaynak='dogrulama' = revalidateDocument'in TÜRETTİĞİ uyarılar (her doğrulamada
 * silinip yeniden üretilir); diğerleri (denetim/eşleme) rematch/aiRead'in yazdığı taban uyarılardır.
 *
 * SAF MODÜL (Prisma/Nest yok) — regresyon betiği doğrudan kullanır.
 */

export type UyariSeviye = 'bilgi' | 'uyari' | 'engel';
export type UyariSiddet = 'bilgi' | 'uyari' | 'hata';

export interface UyariEylem {
  id: string;
  etiket: string;
}

export interface Uyari {
  kod: string;
  seviye: UyariSeviye;
  baslik: string;
  aciklama: string;
  oneri?: string;
  eylemler?: UyariEylem[];
  /** Eylem/gösterim için ek veri (ör. ilkBelgeId, tevkifat kodu/oranı, tahmin). */
  meta?: Record<string, any>;
  kaynak?: 'dogrulama' | 'denetim' | 'esleme';
  /** Geriye uyum (eski model). */
  mesaj: string;
  siddet: UyariSiddet;
}

/** Sabit uyarı kodları (yeni model). */
export const UYARI_KOD = {
  DEMIRBAS: 'DEMIRBAS',
  TEVKIFAT_VAR: 'TEVKIFAT_VAR',
  TEVKIFAT_EKSIK: 'TEVKIFAT_EKSIK',
  ICERIK_HESAP_UYUMSUZ: 'ICERIK_HESAP_UYUMSUZ',
  MUKERRER: 'MUKERRER',
  /** PLAN/16 §C — algısal hash (dHash Hamming ≤ 6): "aynı fişin ikinci fotoğrafı gibi" (uyarı, engel değil). */
  MUKERRER_GORSEL: 'MUKERRER_GORSEL',
  /** PLAN/16 §C — kısa fiş no + VKN + tutar + gün ya da VKN + gün + saat + tutar eşleşmesi (uyarı, engel değil). */
  MUKERRER_FIS: 'MUKERRER_FIS',
  TUTAR_TUTARSIZ: 'TUTAR_TUTARSIZ',
  IADE: 'IADE',
  ALICI_TIPI_GEREKLI: 'ALICI_TIPI_GEREKLI',
  KKEG_SUPHESI: 'KKEG_SUPHESI',
  IPTAL: 'IPTAL',
  SAHIPLIK_TERS: 'SAHIPLIK_TERS',
  OKUNMADI: 'OKUNMADI',
  STOPAJ_EKSIK: 'STOPAJ_EKSIK',
  HESAP_KODU: 'HESAP_KODU',
  HAFIZA_CELISKI: 'HAFIZA_CELISKI',
} as const;

export function seviyeToSiddet(s: UyariSeviye): UyariSiddet {
  return s === 'engel' ? 'hata' : s;
}
export function siddetToSeviye(s: any): UyariSeviye {
  const v = String(s || '').toLowerCase();
  return v === 'hata' || v === 'engel' ? 'engel' : v === 'uyari' ? 'uyari' : 'bilgi';
}

export function uyariYap(p: {
  kod: string; seviye: UyariSeviye; baslik: string; aciklama: string; oneri?: string;
  eylemler?: UyariEylem[]; meta?: Record<string, any>; kaynak?: Uyari['kaynak'];
}): Uyari {
  return {
    kod: p.kod,
    seviye: p.seviye,
    baslik: p.baslik,
    aciklama: p.aciklama,
    ...(p.oneri ? { oneri: p.oneri } : {}),
    ...(p.eylemler && p.eylemler.length ? { eylemler: p.eylemler } : {}),
    ...(p.meta && Object.keys(p.meta).length ? { meta: p.meta } : {}),
    ...(p.kaynak ? { kaynak: p.kaynak } : {}),
    mesaj: p.aciklama,
    siddet: seviyeToSiddet(p.seviye),
  };
}

/** Eski model kaydını yeni modele yükselt (zaten yeni modelse olduğu gibi döner). */
export function eskiUyariyiHaritala(u: any): Uyari | null {
  if (!u || typeof u !== 'object') return null;
  const kodRaw = String(u.kod || '').trim();
  if (!kodRaw) return null;
  if (u.seviye && u.aciklama != null) {
    // Yeni model — eski alanları tamamla (eksikse).
    return { ...u, mesaj: u.mesaj ?? u.aciklama, siddet: u.siddet ?? seviyeToSiddet(u.seviye) } as Uyari;
  }
  let kod = kodRaw;
  let seviye = siddetToSeviye(u.siddet);
  let oneri: string | undefined;
  let eylemler: UyariEylem[] | undefined;
  const meta: Record<string, any> = {};
  if (/^TEV_[A-Z_]+_EKSIK$/.test(kodRaw)) {
    // denetimUyariOlustur tevkifat kuralı (eski, 'hata') → TEVKIFAT_EKSIK (sahip kararı: uyarı seviyesi).
    //   B.14: tevkifatı portalda "fişle kurmak" faturayı düzeltmez — alışta satıcıdan düzeltme (iptal + tevkifatlı
    //   yeni) fatura istenir; satışta fatura tevkifatlı düzenlenir.
    kod = UYARI_KOD.TEVKIFAT_EKSIK;
    seviye = 'uyari';
    meta.eskiKod = kodRaw;
    oneri = 'Alışta satıcıdan düzeltme faturası isteyin (mevcut faturanın iptali + tevkifatlı yeni fatura); satışta faturayı tevkifatlı düzenleyin.';
  } else if (kodRaw === 'INDIRME_BINEK') {
    kod = UYARI_KOD.KKEG_SUPHESI;
    seviye = 'uyari';
    meta.eskiKod = kodRaw;
    oneri = 'Binek araç KDV\'si indirilemez — KDV\'yi gidere/KKEG\'e yazın.';
  }
  return uyariYap({
    kod,
    seviye,
    baslik: String(u.baslik || kod),
    aciklama: String(u.mesaj || u.aciklama || ''),
    oneri,
    eylemler,
    meta,
    kaynak: (u.kaynak as any) || 'denetim',
  });
}

/** runValidation issue'larını (kod + severity + message) yeni modele haritalar. FIXED_ASSET_MANUAL,
 *  FIXED_ASSET_SALE_INCOMPLETE, MUKERRER ve TEVKIFAT_* burada üretilmez — revalidateDocument bağlamıyla
 *  (karar durumu, kod/oran) üretir. */
export function dogrulamaUyarilari(issues: Array<{ code: string; severity: string; message: string }> | null | undefined): Uyari[] {
  const out: Uyari[] = [];
  const grup = new Map<string, { seviye: UyariSeviye; baslik: string; mesajlar: string[]; oneri?: string; eylemler?: UyariEylem[] }>();
  const ekle = (kod: string, seviye: UyariSeviye, baslik: string, mesaj: string, oneri?: string, eylemler?: UyariEylem[]) => {
    const g = grup.get(kod);
    if (g) {
      g.mesajlar.push(mesaj);
      if (seviye === 'engel' || (seviye === 'uyari' && g.seviye === 'bilgi')) g.seviye = seviye;
    } else grup.set(kod, { seviye, baslik, mesajlar: [mesaj], oneri, eylemler });
  };
  for (const i of issues || []) {
    const code = String(i?.code || '');
    const sev: UyariSeviye = String(i?.severity || '').toUpperCase() === 'WARNING' ? 'uyari' : 'engel';
    const msg = String(i?.message || '');
    switch (code) {
      case 'FIXED_ASSET_MANUAL':
      case 'FIXED_ASSET_SALE_INCOMPLETE':
      case 'TEVKIFAT_NEEDED':
      case 'TEVKIFAT_NET_NEEDED':
      case 'MUKERRER':
      case 'MUKERRER_FIS':
      case 'MUKERRER_GORSEL':
        continue; // bağlamla üretilir
      case 'TOTAL_MISMATCH':
      case 'BALANCE_MISMATCH':
      case 'KDV_MATH_MISMATCH':
      case 'TOTAL_MISMATCH_UBL':
      case 'AMOUNT_EQUATION_MISMATCH':
      case 'MULTI_RATE_COLLAPSED':
        ekle(UYARI_KOD.TUTAR_TUTARSIZ, sev, 'Tutar tutarsız', msg, 'Belgeyi "AI ile oku" ile yeniden okuyun ya da satır tutarlarını düzeltin.');
        break;
      case 'RETURN_NEEDS_REVERSAL':
      case 'RETURN_DIRECTION_REVERSED':
        ekle(UYARI_KOD.IADE, sev, 'İade belgesi', msg, 'Editörde "Yönü çevir" ile ters kaydı kurun (satıştan iade 610, alıştan iade stok/gider alacak).', [{ id: 'yonu-cevir', etiket: 'Yönü çevir' }]);
        break;
      case 'DOCUMENT_CANCELLED':
        ekle(UYARI_KOD.IPTAL, 'engel', 'İptal / taslak belge', msg, 'Belge muhasebeleştirilmez; yanlışsa belge durumunu düzeltin.');
        break;
      case 'OWNERSHIP_MISMATCH':
        ekle(UYARI_KOD.SAHIPLIK_TERS, sev, 'Sahiplik / yön şüphesi', msg, 'Belgenin yönünü (alış/satış) ve mükellefi kontrol edin.');
        break;
      case 'INCOMPLETE_AMOUNTS':
        ekle(UYARI_KOD.OKUNMADI, 'uyari', 'Tutar ayrıştırılamadı', msg, '"AI ile oku" ile matrah/KDV\'yi çıkarın.');
        break;
      case 'SMM_STOPAJ_NEEDED':
        ekle(UYARI_KOD.STOPAJ_EKSIK, sev, 'Stopaj eksik', msg, 'Stopaj satırını (360) ekleyin.');
        break;
      case 'ACCOUNT_IS_GROUP':
      case 'CARI_SHALLOW_CODE':
        ekle(UYARI_KOD.HESAP_KODU, sev, 'Hesap kodu sorunu', msg, 'Alt (en derin) hesabı seçin.');
        break;
      default:
        ekle(code || 'DOGRULAMA', sev, 'Doğrulama', msg);
    }
  }
  for (const [kod, g] of grup) {
    out.push(uyariYap({ kod, seviye: g.seviye, baslik: g.baslik, aciklama: g.mesajlar.join(' · '), oneri: g.oneri, eylemler: g.eylemler, kaynak: 'dogrulama' }));
  }
  return out;
}

/** Tevkifat kararını veren türetilen kodlar (yeni kural tablosu): bunlardan biri varsa taban TEVKIFAT_EKSIK atılır. */
const TEVKIFAT_KARAR_KODLARI: string[] = [UYARI_KOD.TEVKIFAT_EKSIK, UYARI_KOD.ALICI_TIPI_GEREKLI, UYARI_KOD.TEVKIFAT_VAR];

/**
 * Taban uyarılar (rematch/aiRead: denetim + eşleme) + türetilen (doğrulama) → tek liste.
 *   • eski 'dogrulama' kaynaklı kayıtlar atılır (yeniden üretildi),
 *   • taban kayıtlar yeni modele yükseltilir,
 *   • aynı kod tekrar ederse türetilen kazanır (daha güncel bağlam),
 *   • B.1 — taban TEVKIFAT_EKSIK (eski TEV_*_EKSIK kelime kuralı) YALNIZ yeni kural tablosu henüz karar
 *     vermemişse kalır: `opts.tamDogrulama` (revalidate türetilen listeyi tam üretti) ya da türetilende
 *     TEVKIFAT_EKSIK / ALICI_TIPI_GEREKLI / TEVKIFAT_VAR varsa taban kayıt ATILIR → ALICI_TIPI_GEREKLI ile
 *     TEVKIFAT_EKSIK aynı belgede birlikte çıkmaz; kapsam dışı (kurumTuru=diger) belgede bayat uyarı kalmaz.
 * Sıra: engel → uyarı → bilgi.
 */
export function uyarilariBirlestir(taban: any[] | null | undefined, turetilen: Uyari[], opts?: { tamDogrulama?: boolean }): Uyari[] {
  const map = new Map<string, Uyari>();
  const tevkifatKarariVar = opts?.tamDogrulama === true || turetilen.some((u) => TEVKIFAT_KARAR_KODLARI.includes(u.kod));
  for (const raw of Array.isArray(taban) ? taban : []) {
    if (raw && raw.kaynak === 'dogrulama') continue;
    const u = eskiUyariyiHaritala(raw);
    if (!u) continue;
    if (u.kod === UYARI_KOD.TEVKIFAT_EKSIK && tevkifatKarariVar) continue; // yeni tablo karar verdi
    if (!map.has(u.kod)) map.set(u.kod, u);
  }
  for (const u of turetilen) map.set(u.kod, u);
  const sira = (s: UyariSeviye) => (s === 'engel' ? 0 : s === 'uyari' ? 1 : 2);
  return [...map.values()].sort((a, b) => sira(a.seviye) - sira(b.seviye));
}

/**
 * A.10 — Uyarı listesi İMZASI: anahtarlar sıralı, kayıtlar yeni modele yükseltilmiş, koda göre sıralı.
 * İki liste aynı içeriği taşıyorsa (alan sırası / eski-yeni model farkı olsa da) imza eşittir → gereksiz UPDATE yok.
 */
export function uyariImza(list: any[] | null | undefined): string {
  const stable = (v: any): any => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      const o: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = stable(v[k]);
      return o;
    }
    return v;
  };
  const norm = (Array.isArray(list) ? list : []).map(eskiUyariyiHaritala).filter(Boolean) as Uyari[];
  norm.sort((a, b) => (a.kod < b.kod ? -1 : a.kod > b.kod ? 1 : 0));
  return JSON.stringify(norm.map(stable));
}

export interface UyariOzet {
  engel: boolean;
  kararBekliyor: boolean;
  tevkifatli: boolean;
  /** Kesin mükerrer (MUKERRER, engel). */
  mukerrer: boolean;
  /** PLAN/16 §C — mükerrer ŞÜPHESİ (MUKERRER_GORSEL / MUKERRER_FIS; uyarı, sahip karar verir). */
  mukerrerSuphe: boolean;
  enYuksek: UyariSeviye | null;
  engelKodlari: string[];
}

export function uyariOzet(uyarilar: any[] | null | undefined): UyariOzet {
  const list = (Array.isArray(uyarilar) ? uyarilar : []).map(eskiUyariyiHaritala).filter(Boolean) as Uyari[];
  const engelKodlari = list.filter((u) => u.seviye === 'engel').map((u) => u.kod);
  const dem = list.find((u) => u.kod === UYARI_KOD.DEMIRBAS);
  return {
    engel: engelKodlari.length > 0,
    kararBekliyor: !!dem && dem.meta?.karar == null,
    tevkifatli: list.some((u) => u.kod === UYARI_KOD.TEVKIFAT_VAR),
    mukerrer: list.some((u) => u.kod === UYARI_KOD.MUKERRER),
    mukerrerSuphe: list.some((u) => u.kod === UYARI_KOD.MUKERRER_GORSEL || u.kod === UYARI_KOD.MUKERRER_FIS),
    enYuksek: list.length ? (engelKodlari.length ? 'engel' : list.some((u) => u.seviye === 'uyari') ? 'uyari' : 'bilgi') : null,
    engelKodlari,
  };
}
