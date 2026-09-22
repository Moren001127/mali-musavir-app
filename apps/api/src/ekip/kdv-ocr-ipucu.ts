/**
 * EKİP — KDV KONTROL OCR TEYİT YARDIMCILARI (2026-09-22, saf; DB/servis yok)
 *
 * Muzaffer Bey'in talebi: "KDV kontrolünde teyit bekleyen belge olursa ekip belgeyle OCR tablosunu karşılaştırsın, yanlışı/eksiği
 * yazsın, eşleşme hatası OCR'dan kaynaklanıyorsa düzeltip teyit etsin, kontrolü tekrar başlatsın; hâlâ hata varsa beni uyarsın."
 *
 * Canlı bulgu (YILMAZ GÖKTAŞ 2026/08): Azure %1 KDV'li hal faturalarında MATRAHI KDV sanıyor (4.335,00 %20 yazıyor; doğrusu
 * 43,35 %1) ve bunu %92 güvenle "başarılı" sayıyor; ajanın kendi raporundaki "doğru" rakamlar ise uydurmaydı (Luca'nın 2 katı).
 * Bu yüzden üç kural:
 *  1) Rakam ajandan değil BELGEDEN gelir: yeniden okuma (Max-vision) sonucu ya da belge metninde görülen değer.
 *  2) KANIT KAPISI: teyit edilen tutar/belge no/tarih belge metninde (ocrRawText: [MAX] json + [AZURE] metin) görülmüyorsa
 *     ve kırılım aritmetiğiyle (matrah × oran) türetilemiyorsa araç REDDEDER — Luca'ya uydurmak için rakam yazılamaz.
 *  3) Belge ile Luca gerçekten farklıysa mismatch gizlenmez; Muzaffer Bey'e uyarı düşer.
 */

export interface Kirilim {
  oran: number;
  tutar: number;
  matrah?: number | null;
}

/** "1.234,56" | "1234.56" | "4335" | Decimal → sayı; boş/okunamaz → null. */
export function tutarSayi(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v?.toNumber === 'function') {
    const n = v.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  let s = String(v).trim().replace(/[^\d,.\-]/g, '');
  if (!s || s === '-' ) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    // "1,234,567" (birden çok virgül) → binlik; tek virgül → ondalık
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** 1234.5 → "1234,50" (KDV Kontrol'ün sakladığı biçim; ekrandaki Teyit Et ile aynı). */
export function tutarMetni(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

export function belgeNoNormalize(s: any): string {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function kurus(n: number): number {
  return Math.round(n * 100);
}

/**
 * Belge metnindeki sayısal parçaların olası okunuşları (kuruş cinsinden). "4.335,00" → 433500; "43,35" → 4335;
 * "17301.3" → 1730130; "4.335" → hem 433500 (TR binlik) hem 434 (EN ondalık, yuvarlanır); "4335" → 433500.
 */
export function belgedekiTutarlar(rawText: string): Set<number> {
  const set = new Set<number>();
  const metin = String(rawText || '');
  const parcalar = metin.match(/\d[\d.,]*\d|\d/g) || [];
  for (const p of parcalar) {
    if (p.length > 24) continue;
    const yorumlar: number[] = [];
    const virgul = (p.match(/,/g) || []).length;
    const nokta = (p.match(/\./g) || []).length;
    if (virgul && nokta) {
      yorumlar.push(p.lastIndexOf(',') > p.lastIndexOf('.') ? parseFloat(p.replace(/\./g, '').replace(',', '.')) : parseFloat(p.replace(/,/g, '')));
    } else if (virgul === 1) {
      yorumlar.push(parseFloat(p.replace(',', '.')));
      yorumlar.push(parseFloat(p.replace(',', ''))); // "1,234" binlik okunuşu
    } else if (virgul > 1) {
      yorumlar.push(parseFloat(p.replace(/,/g, '')));
    } else if (nokta === 1) {
      yorumlar.push(parseFloat(p)); // EN ondalık
      yorumlar.push(parseFloat(p.replace('.', ''))); // TR binlik
    } else if (nokta > 1) {
      yorumlar.push(parseFloat(p.replace(/\./g, '')));
    } else {
      yorumlar.push(parseFloat(p));
    }
    for (const y of yorumlar) if (Number.isFinite(y)) set.add(kurus(y));
  }
  return set;
}

/** Tutar belge metninde görülüyor mu (kuruş eşitliği)? */
export function belgedeTutarVarMi(rawText: string, tutar: number | null | undefined, onbellek?: Set<number>): boolean {
  if (tutar === null || tutar === undefined || !Number.isFinite(tutar)) return false;
  const set = onbellek || belgedekiTutarlar(rawText);
  return set.has(kurus(tutar));
}

/** "15.08.2026" → ["15.08.2026","15/08/2026","15-08-2026","2026-08-15","15.8.2026"]; başka biçim → [girdi]. */
export function tarihBicimleri(tarih: string): string[] {
  const t = String(tarih || '').trim();
  let g: string | null = null, a: string | null = null, y: string | null = null;
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) [g, a, y] = [m[1], m[2], m[3]];
  else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, a, g] = [m[1], m[2], m[3]];
  if (!g || !a || !y) return [t];
  const gg = g.padStart(2, '0'), aa = a.padStart(2, '0');
  return [`${gg}.${aa}.${y}`, `${gg}/${aa}/${y}`, `${gg}-${aa}-${y}`, `${y}-${aa}-${gg}`, `${Number(g)}.${Number(a)}.${y}`];
}

/** Tarih "GG.AA.YYYY" biçimine çevrilir; geçersizse null. */
export function tarihNormalize(tarih: string): string | null {
  const b = tarihBicimleri(tarih);
  if (b.length < 2) return null;
  const [gg, aa, y] = b[0].split('.');
  const g = Number(gg), a = Number(aa), yy = Number(y);
  if (!(g >= 1 && g <= 31 && a >= 1 && a <= 12 && yy >= 2000 && yy <= 2100)) return null;
  return b[0];
}

/** Kırılım aritmetiği: matrah verilmişse matrah × oran/100 ≈ tutar (±0,05 ya da %1). Matrahsız satır denetlenemez. */
export function kirilimAritmetik(kirilim: Kirilim[] | null | undefined): { uyumlu: boolean | null; sorunlar: string[]; denetlenen: number } {
  const sorunlar: string[] = [];
  let denetlenen = 0;
  for (const k of Array.isArray(kirilim) ? kirilim : []) {
    const matrah = tutarSayi(k?.matrah);
    const tutar = tutarSayi(k?.tutar) ?? 0;
    const oran = Number(k?.oran);
    if (matrah === null || matrah <= 0 || !Number.isFinite(oran)) continue;
    denetlenen++;
    const beklenen = (matrah * oran) / 100;
    const fark = Math.abs(beklenen - tutar);
    if (fark > Math.max(0.05, beklenen * 0.01)) {
      sorunlar.push(`%${oran}: matrah ${tutarMetni(matrah)} × %${oran} = ${tutarMetni(beklenen)} ≠ tutar ${tutarMetni(tutar)}`);
    }
  }
  return { uyumlu: denetlenen === 0 ? null : sorunlar.length === 0, sorunlar, denetlenen };
}

export interface TeyitGirdisi {
  imageId?: string;
  belgeNo?: string | null;
  tarih?: string | null;
  kdvTutari?: string | number | null;
  kdvTevkifat?: string | number | null;
  kdvBreakdown?: Kirilim[] | null;
  gerekce?: string;
}

export interface GorselOzet {
  originalName?: string | null;
  ocrBelgeNo?: string | null;
  ocrDate?: string | null;
  ocrKdvTutari?: string | null;
  ocrKdvTevkifat?: string | null;
  ocrKdvBreakdown?: any;
  ocrRawText?: string | null;
}

export interface TeyitDto {
  belgeNo?: string;
  date?: string;
  kdvTutari?: string;
  kdvTevkifat?: string | null;
  kdvBreakdown?: Kirilim[] | null;
}

export type TeyitSonucu =
  | { ok: true; dto: TeyitDto; degisenler: string[]; kanit: string[] }
  | { ok: false; neden: string };

/**
 * KANIT KAPISI — ajanın teyit girdisi belge metniyle doğrulanır; kabul edilen dto confirmImageOcr'a (ekrandaki Teyit Et)
 * birebir gider. Girdide olmayan alan OCR değeriyle kalır (confirmImageOcr `?? ocr*`). Kurallar:
 *  - belgeNo: belge metninde ya da dosya adında geçmeli.
 *  - tarih: GG.AA.YYYY'ye çevrilir; belge metninde bir biçimiyle geçmeli.
 *  - kdvTutari (NET; tevkifatlı belgede tam − tevkifat): metinde görülmeli YA DA kırılım toplamına eşit olmalı (kırılım
 *    satırları da tek tek metinde görülmeli ya da matrah × oran ile türetilmeli).
 *  - kdvTevkifat (>0): metinde görülmeli.
 *  - Mevcut OCR değeriyle aynı olan alan kanıt istemez (ekrandaki "olduğu gibi teyit" ile aynı).
 */
export function teyitDogrula(girdi: TeyitGirdisi, gorsel: GorselOzet, secenek: { gorselKaniti?: boolean } = {}): TeyitSonucu {
  const raw = String(gorsel.ocrRawText || '');
  // GÖRSEL KANITI (Muzaffer Bey 2026-09-22: "ekip belgenin üstüne baksın, KDV'yi eliyle de yazabilsin"): ajan belgeyi
  // kdv_kontrol_belge_goster ile GÖRDÜYSE (runner işaretler) metinde geçmeyen kırılım tutarı da kabul edilir — ama yalnız
  // matrah verilmiş ve matrah × oran = tutar ise (aritmetik kapı). Belge no / tarih kuralları değişmez.
  const gorselKaniti = secenek.gorselKaniti === true;
  const tutarlar = belgedekiTutarlar(raw);
  const dto: TeyitDto = {};
  const degisenler: string[] = [];
  const kanit: string[] = [];

  // Belge no
  if (girdi.belgeNo !== undefined && girdi.belgeNo !== null && String(girdi.belgeNo).trim()) {
    const yeni = String(girdi.belgeNo).trim();
    if (belgeNoNormalize(yeni) !== belgeNoNormalize(gorsel.ocrBelgeNo)) {
      const rawN = belgeNoNormalize(raw);
      const adN = belgeNoNormalize(gorsel.originalName);
      if (!rawN.includes(belgeNoNormalize(yeni)) && !adN.includes(belgeNoNormalize(yeni))) {
        return { ok: false, neden: `belge no "${yeni}" belge metninde ve dosya adında görülmedi — yazılmadı` };
      }
      degisenler.push(`belgeNo ${gorsel.ocrBelgeNo || '—'} → ${yeni}`);
      kanit.push('belgeNo: belge metni/dosya adı');
    }
    dto.belgeNo = yeni;
  }

  // Tarih
  if (girdi.tarih !== undefined && girdi.tarih !== null && String(girdi.tarih).trim()) {
    const yeni = tarihNormalize(String(girdi.tarih));
    if (!yeni) return { ok: false, neden: `tarih "${girdi.tarih}" geçersiz (GG.AA.YYYY bekleniyor)` };
    if (yeni !== tarihNormalize(String(gorsel.ocrDate || ''))) {
      const bicimler = tarihBicimleri(yeni);
      if (!bicimler.some((b) => raw.includes(b))) {
        return { ok: false, neden: `tarih ${yeni} belge metninde görülmedi — yazılmadı` };
      }
      degisenler.push(`tarih ${gorsel.ocrDate || '—'} → ${yeni}`);
      kanit.push('tarih: belge metni');
    }
    dto.date = yeni;
  }

  // Kırılım
  let kirilim: Kirilim[] | null | undefined = undefined;
  if (girdi.kdvBreakdown !== undefined) {
    if (girdi.kdvBreakdown === null || (Array.isArray(girdi.kdvBreakdown) && girdi.kdvBreakdown.length === 0)) {
      kirilim = null;
    } else if (Array.isArray(girdi.kdvBreakdown)) {
      kirilim = [];
      for (const k of girdi.kdvBreakdown) {
        const oran = Number(k?.oran);
        const tutar = tutarSayi(k?.tutar);
        const matrah = tutarSayi(k?.matrah);
        if (!Number.isFinite(oran) || oran < 0 || oran > 100 || tutar === null || tutar < 0) {
          return { ok: false, neden: `kırılım satırı geçersiz: ${JSON.stringify(k)}` };
        }
        const dogrudan = belgedeTutarVarMi(raw, tutar, tutarlar);
        const aritmetikTutuyor = matrah !== null && matrah > 0 && Math.abs((matrah * oran) / 100 - tutar) <= Math.max(0.05, tutar * 0.01);
        const turetilmis = aritmetikTutuyor && belgedeTutarVarMi(raw, matrah!, tutarlar);
        const gorselden = gorselKaniti && aritmetikTutuyor;
        if (!dogrudan && !turetilmis && !gorselden && tutar > 0) {
          return {
            ok: false,
            neden: gorselKaniti
              ? `kırılım %${oran} tutarı ${tutarMetni(tutar)} belge metninde yok ve matrah × oran tutmuyor (matrah ${matrah === null ? '—' : tutarMetni(matrah)}) — görsel kanıtı için matrah ver, aritmetik tutsun`
              : `kırılım %${oran} tutarı ${tutarMetni(tutar)} belge metninde görülmedi ve matrah × oran ile türetilemedi — yazılmadı`,
          };
        }
        if (tutar > 0) kanit.push(`kırılım %${oran}: ${dogrudan ? 'belge metni' : turetilmis ? 'matrah × oran' : 'görsel (ekip belgeye baktı) + aritmetik'}`);
        kirilim.push({ oran, tutar: Math.round(tutar * 100) / 100, matrah: matrah !== null && matrah > 0 ? Math.round(matrah * 100) / 100 : null });
      }
    } else {
      return { ok: false, neden: 'kdvBreakdown liste olmalı' };
    }
    const eskiK = JSON.stringify(Array.isArray(gorsel.ocrKdvBreakdown) ? gorsel.ocrKdvBreakdown : null);
    if (JSON.stringify(kirilim) !== eskiK) degisenler.push(`kırılım ${eskiK} → ${JSON.stringify(kirilim)}`);
    dto.kdvBreakdown = kirilim;
  }

  // KDV (NET)
  const kirilimToplam = Array.isArray(kirilim) ? kirilim.reduce((s, k) => s + (k.tutar || 0), 0) : null;
  if (girdi.kdvTutari !== undefined && girdi.kdvTutari !== null && String(girdi.kdvTutari).trim() !== '') {
    const yeni = tutarSayi(girdi.kdvTutari);
    if (yeni === null || yeni < 0) return { ok: false, neden: `KDV tutarı "${girdi.kdvTutari}" okunamadı` };
    const eski = tutarSayi(gorsel.ocrKdvTutari);
    if (eski === null || kurus(eski) !== kurus(yeni)) {
      const dogrudan = belgedeTutarVarMi(raw, yeni, tutarlar);
      const toplamdan = kirilimToplam !== null && Array.isArray(kirilim) && kirilim.length > 0 && Math.abs(kirilimToplam - yeni) <= 0.05;
      if (!dogrudan && !toplamdan) {
        return {
          ok: false,
          neden: gorselKaniti
            ? `KDV ${tutarMetni(yeni)} belge metninde yok — görsel kanıtı için kırılımı matrahıyla ver (toplamı KDV'ye eşit olmalı)`
            : `KDV ${tutarMetni(yeni)} belge metninde görülmedi ve kırılım toplamına eşit değil — yazılmadı (Luca'ya uydurmak için rakam yazılamaz)`,
        };
      }
      degisenler.push(`kdv ${gorsel.ocrKdvTutari || '—'} → ${tutarMetni(yeni)}`);
      kanit.push(`kdv: ${dogrudan ? 'belge metni' : 'kırılım toplamı'}`);
    }
    if (kirilimToplam !== null && Array.isArray(kirilim) && kirilim.length > 0 && Math.abs(kirilimToplam - yeni) > 0.05) {
      return { ok: false, neden: `KDV ${tutarMetni(yeni)} ile kırılım toplamı ${tutarMetni(kirilimToplam)} tutmuyor` };
    }
    dto.kdvTutari = tutarMetni(yeni);
  } else if (kirilimToplam !== null && Array.isArray(kirilim) && kirilim.length > 0) {
    // Ekrandaki Teyit Et gibi: kırılım varsa KDV = kırılım toplamı.
    const eski = tutarSayi(gorsel.ocrKdvTutari);
    if (eski === null || kurus(eski) !== kurus(kirilimToplam)) degisenler.push(`kdv ${gorsel.ocrKdvTutari || '—'} → ${tutarMetni(kirilimToplam)} (kırılım toplamı)`);
    dto.kdvTutari = tutarMetni(kirilimToplam);
  }

  // Tevkifat
  if (girdi.kdvTevkifat !== undefined) {
    if (girdi.kdvTevkifat === null || String(girdi.kdvTevkifat).trim() === '' || tutarSayi(girdi.kdvTevkifat) === 0) {
      if (tutarSayi(gorsel.ocrKdvTevkifat)) degisenler.push(`tevkifat ${gorsel.ocrKdvTevkifat} → yok`);
      dto.kdvTevkifat = null;
    } else {
      const yeni = tutarSayi(girdi.kdvTevkifat);
      if (yeni === null || yeni < 0) return { ok: false, neden: `tevkifat "${girdi.kdvTevkifat}" okunamadı` };
      const eski = tutarSayi(gorsel.ocrKdvTevkifat);
      if (eski === null || kurus(eski) !== kurus(yeni)) {
        if (!belgedeTutarVarMi(raw, yeni, tutarlar)) return { ok: false, neden: `tevkifat ${tutarMetni(yeni)} belge metninde görülmedi — yazılmadı` };
        degisenler.push(`tevkifat ${gorsel.ocrKdvTevkifat || '—'} → ${tutarMetni(yeni)}`);
        kanit.push('tevkifat: belge metni');
      }
      dto.kdvTevkifat = tutarMetni(yeni);
    }
  }

  return { ok: true, dto, degisenler, kanit };
}

// ─── EŞLEŞME HATASI İPUCU ───

export interface LucaSatir {
  id: string;
  belgeNo?: string | null;
  belgeDate?: any;
  karsiTaraf?: string | null;
  kdvTutari?: any;
  kdvOrani?: any;
}

export interface GorselSatir {
  id: string;
  belgeNo?: string | null; // confirmed ?? ocr
  tarih?: string | null;
  satici?: string | null;
  kdv?: number | null; // NET
  tevkifat?: number | null;
  kirilim?: Kirilim[] | null;
  ocrStatus?: string | null;
  isManuallyConfirmed?: boolean;
}

export interface Ipucu {
  tur:
    | 'KDV_OKUNAMADI'
    | 'MATRAH_KDV_SANILMIS'
    | 'ORAN_FARKI'
    | 'TEVKIFAT_FARKI'
    | 'TUTAR_FARKI'
    | 'BELGE_NO_FARKI'
    | 'ADAY_YOK'
    | 'TEYITLI_FARK';
  metin: string;
  ocrSupheli: boolean;
  adayImageId?: string | null;
  adayKdvRecordIds?: string[];
}

function tarihGun(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const n = tarihNormalize(String(v));
  if (n) {
    const [g, a, y] = n.split('.');
    return `${y}-${a}-${g}`;
  }
  return String(v).slice(0, 10);
}

function saticiAnahtar(s: any): string {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, '')
    .slice(0, 6);
}

/** Aynı belge no'lu Luca satırlarına karşı fatura tarafı OCR açısından şüpheli mi? */
export function faturaLucaKarsilastir(g: GorselSatir, luca: LucaSatir[]): Ipucu {
  const ids = luca.map((l) => l.id);
  const lucaToplam = luca.reduce((s, l) => s + (tutarSayi(l.kdvTutari) ?? 0), 0);
  const lucaOranlar = Array.from(new Set(luca.map((l) => tutarSayi(l.kdvOrani)).filter((o): o is number => o !== null)));
  const fatura = g.kdv ?? null;
  const tev = g.tevkifat ?? 0;
  const ek = { adayImageId: g.id, adayKdvRecordIds: ids };
  if (g.isManuallyConfirmed) {
    return { tur: 'TEYITLI_FARK', metin: `Muzaffer Bey teyit etmiş; Luca ${tutarMetni(lucaToplam)} / fatura ${fatura === null ? '—' : tutarMetni(fatura)} — dokunma, rapora yaz`, ocrSupheli: false, ...ek };
  }
  if (fatura === null || fatura === 0) {
    return { tur: 'KDV_OKUNAMADI', metin: `fatura KDV'si okunamamış; Luca ${tutarMetni(lucaToplam)} → belgeyi yeniden oku`, ocrSupheli: true, ...ek };
  }
  if (lucaToplam > 0) {
    const oranK = fatura / lucaToplam;
    if (Math.abs(oranK - 100) <= 3 || Math.abs(oranK - 10) <= 0.3) {
      return {
        tur: 'MATRAH_KDV_SANILMIS',
        metin: `fatura KDV'si ${tutarMetni(fatura)} Luca'nın (${tutarMetni(lucaToplam)}) ${Math.round(oranK)} katı — OCR matrahı/ondalığı KDV sanmış olabilir → belgeyi yeniden oku`,
        ocrSupheli: true,
        ...ek,
      };
    }
    const tol = Math.max(0.02, lucaToplam * 0.01);
    if (Math.abs(fatura + tev - lucaToplam) <= tol || (tev === 0 && Math.abs(fatura * 2 - lucaToplam) <= tol) || Math.abs(fatura - tev - lucaToplam) <= tol) {
      return { tur: 'TEVKIFAT_FARKI', metin: `tevkifat farkı olabilir: Luca ${tutarMetni(lucaToplam)}, fatura net ${tutarMetni(fatura)}${tev ? ` + tevkifat ${tutarMetni(tev)}` : ''} → belgeyi yeniden oku (tevkifat alanı)`, ocrSupheli: true, ...ek };
    }
  }
  const faturaOranlar = Array.isArray(g.kirilim) ? Array.from(new Set(g.kirilim.map((k) => Number(k.oran)).filter((o) => Number.isFinite(o)))) : [];
  if (lucaOranlar.length && faturaOranlar.length && !faturaOranlar.some((o) => lucaOranlar.some((l) => Math.abs(l - o) < 0.5))) {
    return { tur: 'ORAN_FARKI', metin: `oran farkı: fatura %${faturaOranlar.join('/%')} · Luca %${lucaOranlar.join('/%')} → belgeyi yeniden oku`, ocrSupheli: true, ...ek };
  }
  return { tur: 'TUTAR_FARKI', metin: `aynı belge no, KDV farklı: Luca ${tutarMetni(lucaToplam)} / fatura ${tutarMetni(fatura)} → belgeyi yeniden oku; sürerse Muzaffer Bey`, ocrSupheli: true, ...ek };
}

/**
 * Sorunlu sonuç satırı için ipucu: eşleşme hatası OCR'dan mı? Karşı tarafta aynı belge no aranır; yoksa aynı tarih + satıcı.
 * `sinif`: luca_yok (fatura var) · fatura_yok (Luca'da var) · incele · red.
 */
export function eslesmeIpucu(
  satir: { sinif: string; imageId?: string | null; kdvRecordId?: string | null },
  gorseller: GorselSatir[],
  luca: LucaSatir[],
): Ipucu | null {
  const gorsel = satir.imageId ? gorseller.find((g) => g.id === satir.imageId) || null : null;
  const kayit = satir.kdvRecordId ? luca.find((l) => l.id === satir.kdvRecordId) || null : null;

  if (gorsel) {
    const no = belgeNoNormalize(gorsel.belgeNo);
    const ayni = no ? luca.filter((l) => belgeNoNormalize(l.belgeNo) === no) : [];
    if (ayni.length) return faturaLucaKarsilastir(gorsel, ayni);
    if (satir.sinif === 'incele' && kayit) return faturaLucaKarsilastir(gorsel, [kayit]);
    // Belge no eşleşmedi → aynı gün + satıcı
    const gun = tarihGun(gorsel.tarih);
    const sat = saticiAnahtar(gorsel.satici);
    const aday = luca.filter((l) => gun && tarihGun(l.belgeDate) === gun && sat && saticiAnahtar(l.karsiTaraf) === sat);
    if (aday.length) {
      return {
        tur: 'BELGE_NO_FARKI',
        metin: `belge no Luca'da yok (${gorsel.belgeNo || '—'}); aynı gün/satıcıda Luca: ${aday.map((a) => `${a.belgeNo || '—'} KDV ${tutarMetni(tutarSayi(a.kdvTutari) ?? 0)}`).join(', ')} → belge no OCR hatası olabilir, yeniden oku`,
        ocrSupheli: true,
        adayImageId: gorsel.id,
        adayKdvRecordIds: aday.map((a) => a.id),
      };
    }
    return { tur: 'ADAY_YOK', metin: "Luca'da aday yok — fatura kaydı gerçekten eksik olabilir (Fatura Muhasebecisi / Muzaffer Bey)", ocrSupheli: false, adayImageId: gorsel.id, adayKdvRecordIds: [] };
  }

  if (kayit) {
    const no = belgeNoNormalize(kayit.belgeNo);
    const ayni = no ? gorseller.filter((g) => belgeNoNormalize(g.belgeNo) === no) : [];
    if (ayni.length) {
      const g = ayni[0];
      const tumLuca = luca.filter((l) => belgeNoNormalize(l.belgeNo) === no);
      return faturaLucaKarsilastir(g, tumLuca.length ? tumLuca : [kayit]);
    }
    const gun = tarihGun(kayit.belgeDate);
    const sat = saticiAnahtar(kayit.karsiTaraf);
    const aday = gorseller.filter((g) => gun && tarihGun(g.tarih) === gun && sat && saticiAnahtar(g.satici) === sat);
    if (aday.length) {
      return {
        tur: 'BELGE_NO_FARKI',
        metin: `fatura görseli belge no ile bulunamadı (${kayit.belgeNo || '—'}); aynı gün/satıcıda görsel: ${aday.map((a) => `${a.belgeNo || '—'} KDV ${a.kdv === null || a.kdv === undefined ? '—' : tutarMetni(a.kdv)}`).join(', ')} → belge no OCR hatası olabilir, yeniden oku`,
        ocrSupheli: true,
        adayImageId: aday[0].id,
        adayKdvRecordIds: [kayit.id],
      };
    }
    return { tur: 'ADAY_YOK', metin: 'fatura görseli yok — belge portala inmemiş olabilir (Mihsap çekimi Muzaffer Bey’de)', ocrSupheli: false, adayImageId: null, adayKdvRecordIds: [kayit.id] };
  }
  return null;
}

// ─── YENİDEN OKUMA ÖNERİSİ ───

export interface OkumaOzeti {
  ocrStatus?: string | null;
  ocrEngine?: string | null;
  ocrBelgeNo?: string | null;
  ocrDate?: string | null;
  ocrKdvTutari?: string | null;
  ocrKdvTevkifat?: string | null;
  ocrKdvBreakdown?: any;
  ocrValidationScore?: number | null;
  ocrConfidence?: number | null;
  ocrSatici?: string | null;
}

export interface Oneri {
  oneri: 'teyit' | 'degismedi' | 'muzaffer';
  neden: string;
  farklar: string[];
  aritmetik: ReturnType<typeof kirilimAritmetik>;
  lucaUyum: { var: boolean; uyumlu: boolean | null; lucaToplam: number | null; aciklama: string };
  teyitGirdisi: TeyitGirdisi | null;
}

function kirilimListe(v: any): Kirilim[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  return v.map((k: any) => ({ oran: Number(k?.oran), tutar: tutarSayi(k?.tutar) ?? 0, matrah: tutarSayi(k?.matrah) })).filter((k: Kirilim) => Number.isFinite(k.oran));
}

/**
 * Yeniden okuma (Max-vision) sonrası ajanın ne yapacağı:
 *  - teyit: okuma Max'tan geldi, aritmetik tutuyor, alanlar dolu → `teyitGirdisi` ile kdv_kontrol_ocr_teyit (değerler aynen).
 *  - degismedi: değerler öncekiyle aynı (teyit gereksiz; Luca ile farklıysa gerçek fark → Muzaffer Bey).
 *  - muzaffer: Max okuması alınamadı / boş / aritmetik tutmuyor → dokunma, rapora "teyit Muzaffer Bey'de".
 */
export function yenidenOkumaOnerisi(once: OkumaOzeti, sonra: OkumaOzeti, lucaAyniBelge: LucaSatir[], geriAlindi = false): Oneri {
  const kir = kirilimListe(sonra.ocrKdvBreakdown);
  const aritmetik = kirilimAritmetik(kir);
  const kdv = tutarSayi(sonra.ocrKdvTutari);
  const tev = tutarSayi(sonra.ocrKdvTevkifat) ?? 0;
  const lucaToplam = lucaAyniBelge.length ? lucaAyniBelge.reduce((s, l) => s + (tutarSayi(l.kdvTutari) ?? 0), 0) : null;
  let lucaUyumlu: boolean | null = null;
  let lucaAciklama = 'Luca’da aynı belge no yok';
  if (lucaToplam !== null && kdv !== null) {
    const tol = Math.max(0.02, lucaToplam * 0.01);
    lucaUyumlu = Math.abs(kdv - lucaToplam) <= tol || Math.abs(kdv + tev - lucaToplam) <= tol;
    lucaAciklama = lucaUyumlu ? `Luca ${tutarMetni(lucaToplam)} ile uyumlu` : `Luca ${tutarMetni(lucaToplam)} / fatura ${tutarMetni(kdv)}${tev ? ` (+tevkifat ${tutarMetni(tev)})` : ''} farklı`;
  } else if (lucaToplam !== null) {
    lucaAciklama = `Luca ${tutarMetni(lucaToplam)}; fatura KDV okunamadı`;
  }
  const lucaUyum = { var: lucaAyniBelge.length > 0, uyumlu: lucaUyumlu, lucaToplam, aciklama: lucaAciklama };

  const farklar: string[] = [];
  if ((once.ocrBelgeNo || '') !== (sonra.ocrBelgeNo || '')) farklar.push(`belgeNo ${once.ocrBelgeNo || '—'} → ${sonra.ocrBelgeNo || '—'}`);
  if ((once.ocrDate || '') !== (sonra.ocrDate || '')) farklar.push(`tarih ${once.ocrDate || '—'} → ${sonra.ocrDate || '—'}`);
  const eskiKdv = tutarSayi(once.ocrKdvTutari);
  if ((eskiKdv === null ? null : kurus(eskiKdv)) !== (kdv === null ? null : kurus(kdv))) farklar.push(`kdv ${once.ocrKdvTutari || '—'} → ${sonra.ocrKdvTutari || '—'}`);
  const eskiTev = tutarSayi(once.ocrKdvTevkifat) ?? 0;
  if (kurus(eskiTev) !== kurus(tev)) farklar.push(`tevkifat ${once.ocrKdvTevkifat || '—'} → ${sonra.ocrKdvTevkifat || '—'}`);
  const eskiKir = JSON.stringify(kirilimListe(once.ocrKdvBreakdown));
  if (eskiKir !== JSON.stringify(kir)) farklar.push(`kırılım ${eskiKir} → ${JSON.stringify(kir)}`);

  const ortak = { farklar, aritmetik, lucaUyum };
  if (geriAlindi || sonra.ocrStatus === 'FAILED' || (kdv === null && !sonra.ocrDate)) {
    return { oneri: 'muzaffer', neden: 'yeniden okuma boş/başarısız (önceki değerler korundu) — teyit Muzaffer Bey’de', teyitGirdisi: null, ...ortak };
  }
  // Max alınamadı (Azure'a düştü): Azure sonucu ancak Luca ile uyumluysa YA DA kırılım aritmetiği (matrah × oran) tutuyorsa güvenilir;
  // değilse ajan belgeye bakar (kdv_kontrol_belge_goster) — 2026-09-22.
  if (!/max/i.test(String(sonra.ocrEngine || '')) && lucaUyumlu !== true && aritmetik.uyumlu !== true) {
    return { oneri: 'muzaffer', neden: `Max okuması alınamadı (motor ${sonra.ocrEngine || '—'}); Azure sonucu Luca/aritmetikle doğrulanamadı → belgeye bak (kdv_kontrol_belge_goster)`, teyitGirdisi: null, ...ortak };
  }
  if (aritmetik.uyumlu === false) {
    return { oneri: 'muzaffer', neden: `kırılım aritmetiği tutmuyor: ${aritmetik.sorunlar.join('; ')} — teyit Muzaffer Bey’de`, teyitGirdisi: null, ...ortak };
  }
  if (kdv === null || !sonra.ocrBelgeNo || !sonra.ocrDate) {
    return { oneri: 'muzaffer', neden: `okuma eksik (belgeNo ${sonra.ocrBelgeNo || '—'}, tarih ${sonra.ocrDate || '—'}, kdv ${sonra.ocrKdvTutari || '—'}) — teyit Muzaffer Bey’de`, teyitGirdisi: null, ...ortak };
  }
  const val = sonra.ocrValidationScore;
  if (typeof val === 'number' && val < 0.6 && lucaUyumlu !== true) {
    return { oneri: 'muzaffer', neden: `okuma doğrulama puanı düşük (%${Math.round(val * 100)}) ve Luca ile uyumsuz — teyit Muzaffer Bey’de`, teyitGirdisi: null, ...ortak };
  }
  const teyitGirdisi: TeyitGirdisi = {
    belgeNo: sonra.ocrBelgeNo,
    tarih: sonra.ocrDate,
    kdvTutari: sonra.ocrKdvTutari,
    kdvTevkifat: tev > 0 ? tutarMetni(tev) : null,
    kdvBreakdown: kir,
  };
  if (farklar.length === 0 && once.ocrStatus === 'SUCCESS') {
    return {
      oneri: 'degismedi',
      neden: lucaUyumlu === false ? `okuma öncekiyle aynı; ${lucaAciklama} → gerçek fark, Muzaffer Bey` : 'okuma öncekiyle aynı; teyit gerekmez',
      teyitGirdisi,
      ...ortak,
    };
  }
  return {
    oneri: 'teyit',
    neden: `${farklar.length ? farklar.join('; ') : 'değerler doğrulandı'}${aritmetik.denetlenen ? ' · aritmetik tutuyor' : ''} · ${lucaAciklama}`,
    teyitGirdisi,
    ...ortak,
  };
}
