/**
 * İLETİM RAPORU — saf mantık (ekran bileşeni yok, test edilebilir).
 *
 * GET /akilli-bildirim/report?month= yanıtını "düz Türkçe" hücre ve satır
 * metinlerine çevirir. Muzaffer Bey (2026-09-14): "değişik değişik şekiller
 * var, ne gönderildi ne gönderilmedi hiçbir şey anlamıyorum" → ikon/sembol
 * YOK, her hücre iki satır yazı: üstte durum, altta ayrıntı.
 *
 * Sunucu sözleşmesi (akilli-bildirim.service.ts report()):
 *   taxpayers[]: { taxpayerId, unvan, VERGI, SGK, ETEBLIGAT, ODEME_LISTESI }
 *   hücre: null (belge yok) | { status:'BEKLIYOR', error: sebep } |
 *          { status: SENT|FAILED|PENDING|SKIPPED, error, channel, testMode, sentAt, createdAt,
 *            kanallar: [aynı alanlar] }   — üst seviye = EN KÖTÜ kanal
 *   totals: { total, sent, failed, bekleyen, badContact, testGonderim, mukellefSayisi }
 *   ayarlar?: [{ kategori, enabled, testMode, whatsapp, email }]   (2026-09-14 eklendi)
 */

export type Kategori = 'VERGI' | 'SGK' | 'ETEBLIGAT' | 'ODEME_LISTESI';

export const KATEGORILER: Array<{ key: Kategori; ad: string }> = [
  { key: 'VERGI', ad: 'Vergi' },
  { key: 'SGK', ad: 'SGK' },
  { key: 'ETEBLIGAT', ad: 'e-Tebligat' },
  { key: 'ODEME_LISTESI', ad: 'Ödeme Listesi' },
];

/** "Başarısızları yeniden dene" yalnız bu üçünü kapsar; Ödeme Listesi ayrı servisten gider. */
export const YENIDEN_DENENEBILIR: Kategori[] = ['VERGI', 'SGK', 'ETEBLIGAT'];

export interface KanalKaydi {
  status: string;
  error?: string | null;
  channel?: string | null;
  testMode?: boolean;
  sentAt?: string | null;
  createdAt?: string | null;
}

export interface Hucre extends KanalKaydi {
  kanallar?: KanalKaydi[];
}

export interface RaporSatiri {
  taxpayerId: string;
  unvan: string;
  VERGI: Hucre | null;
  SGK: Hucre | null;
  ETEBLIGAT: Hucre | null;
  ODEME_LISTESI: Hucre | null;
}

export interface RaporAyari {
  kategori: string;
  enabled: boolean;
  testMode: boolean;
  whatsapp: boolean;
  email: boolean;
}

export interface Rapor {
  month: string;
  totals: { total: number; sent: number; failed: number; bekleyen?: number; badContact?: number; testGonderim?: number; mukellefSayisi?: number };
  taxpayers: RaporSatiri[];
  ayarlar?: RaporAyari[];
}

/** Hücrenin tek karar noktası. */
export type HucreDurumu =
  | 'iletildi' // gerçek gönderim, tüm kanallar tamam
  | 'kismen' // bir kanal gitti, diğeri hata
  | 'hata' // denendi, hiçbir kanal gitmedi
  | 'gonderilmedi' // belge var, gönderim kaydı yok
  | 'kapali' // belge var, kategori Ayarlar'da kapalı
  | 'kapsamDisi' // belge var, mükellef ayarda hariç tutulmuş
  | 'test' // yalnız test alıcısına gitti
  | 'sirada' // PENDING — gönderim henüz tamamlanmadı
  | 'yok'; // belge / kayıt yok

export interface HucreGorunumu {
  durum: HucreDurumu;
  /** Üst satır: "İletildi · 12.09 14:20" */
  ust: string;
  /** Alt satır: "WhatsApp ve e-posta ile" — boş olabilir */
  alt: string;
  /** Üzerine gelince tamamı */
  ipucu: string;
  /** "test" etiketi basılsın */
  testEtiketi?: boolean;
  /** Kısmen iletildi: gitmeyen kanal(lar) — "WhatsApp: telefon numarası yok" (satır cümlesi için) */
  hataOzeti?: string;
}

export type SatirDurumu = 'hata' | 'bekliyor' | 'test' | 'kapali' | 'iletildi' | 'yok';

export type Suzgec = 'tumu' | 'sorunlu' | 'iletilen' | 'hata' | 'bekliyor' | 'kapali' | 'test' | 'yok';

// ─── küçük yardımcılar ───────────────────────────────────────────────────────

/**
 * Sunucudaki hata metni → kısa, düz Türkçe. 'ILETISIM-' kodu ekrana sızmaz;
 * "mükellefin telefon numarası yok" → "telefon numarası yok" (hücre dar, kelime israfı yok).
 */
export function sebepMetni(e?: string | null): string {
  const s = String(e || '').replace(/^ILETISIM-/, '').trim();
  if (/^mükellefin telefon numarası yok$/i.test(s)) return 'telefon numarası yok';
  if (/^mükellefin e-postası yok$/i.test(s)) return 'e-posta adresi yok';
  return s.replace(/^whatsapp gönderilemedi:\s*/i, '').replace(/^e-posta gönderilemedi:\s*/i, '');
}

const KANAL_ADI: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'e-posta' };

export function kanalAdi(ch?: string | null): string {
  return KANAL_ADI[String(ch || '').toUpperCase()] || 'kanal';
}

/** ["WHATSAPP","EMAIL"] → "WhatsApp ve e-posta" (tekrarlar tek) */
export function kanalAdlari(kayitlar: KanalKaydi[]): string {
  const adlar = [...new Set(kayitlar.map((k) => kanalAdi(k.channel)))];
  if (adlar.length <= 1) return adlar[0] || '';
  return `${adlar.slice(0, -1).join(', ')} ve ${adlar[adlar.length - 1]}`;
}

/** ISO → "12.09 14:20"; geçersizse '' */
export function kisaTarihSaat(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function enSon(kayitlar: KanalKaydi[], alan: 'sentAt' | 'createdAt'): string | null {
  let en: string | null = null;
  for (const k of kayitlar) {
    const v = k[alan];
    if (!v) continue;
    if (!en || new Date(v).getTime() > new Date(en).getTime()) en = v;
  }
  return en;
}

function kanalListesi(h: Hucre): KanalKaydi[] {
  return h.kanallar && h.kanallar.length ? h.kanallar : [h];
}

const KAPALI_SEBEP = /kategori kapalı|kategori ayarı tanımlı değil/i;
const KAPSAM_DISI_SEBEP = /kapsam dışı/i;

// ─── hücre ───────────────────────────────────────────────────────────────────

export function hucreGorunumu(h: Hucre | null | undefined, kategori: Kategori): HucreGorunumu {
  if (!h) {
    return kategori === 'ODEME_LISTESI'
      ? { durum: 'yok', ust: 'Gönderim yok', alt: '', ipucu: 'Bu ay ödeme listesi gönderim kaydı yok. Aylık Ödeme Listesi ekranından gönderilir.' }
      : { durum: 'yok', ust: 'Belge yok', alt: '', ipucu: 'Bu ay bu kategoride mükellefe ait belge yok; gönderilecek bir şey olmadı.' };
  }

  if (h.status === 'BEKLIYOR') {
    const sebep = sebepMetni(h.error) || 'henüz denenmedi';
    if (KAPALI_SEBEP.test(sebep)) {
      return { durum: 'kapali', ust: 'Kategori kapalı', alt: 'belge var, gönderilmedi', ipucu: `Belge var ama ${sebep}. Ayarlar → Akıllı Bildirim'den açılabilir.` };
    }
    if (KAPSAM_DISI_SEBEP.test(sebep)) {
      return { durum: 'kapsamDisi', ust: 'Kapsam dışı', alt: 'mükellef hariç tutulmuş', ipucu: `Belge var ama ${sebep} (Ayarlar → Akıllı Bildirim).` };
    }
    const alt = sebep === 'henüz denenmedi' ? 'belge var, gönderim yapılmadı' : sebep;
    return { durum: 'gonderilmedi', ust: 'Gönderilmedi', alt, ipucu: `Belge var, gönderim yapılmadı: ${sebep}` };
  }

  const kanallar = kanalListesi(h);
  const gercek = kanallar.filter((k) => k.status === 'SENT' && !k.testMode);
  const test = kanallar.filter((k) => k.status === 'SENT' && k.testMode);
  const hatali = kanallar.filter((k) => k.status === 'FAILED');
  const sirada = kanallar.filter((k) => k.status === 'PENDING');
  const atlanan = kanallar.filter((k) => k.status === 'SKIPPED');

  if (hatali.length) {
    const hataParcalari = hatali.map((k) => `${kanalAdi(k.channel)}: ${sebepMetni(k.error) || 'gönderilemedi'}`);
    const denemeSaati = kisaTarihSaat(enSon(hatali, 'createdAt'));
    if (gercek.length) {
      const alt = `${kanalAdlari(gercek)} gitti · ${hataParcalari.join(' · ')}`;
      return {
        durum: 'kismen',
        ust: 'Kısmen iletildi',
        alt,
        ipucu: `${kanalAdlari(gercek)} ile gitti; ${hataParcalari.join('; ')}${denemeSaati ? ` (denendi ${denemeSaati})` : ''}`,
        hataOzeti: hataParcalari.join(', '),
      };
    }
    // Hepsi aynı sebepse tek satırda sebep; farklıysa kanal kanal
    const sebepler = [...new Set(hatali.map((k) => sebepMetni(k.error) || 'gönderilemedi'))];
    const alt = sebepler.length === 1 ? sebepler[0] : hataParcalari.join(' · ');
    return { durum: 'hata', ust: 'İletilemedi', alt, ipucu: `${hataParcalari.join('; ')}${denemeSaati ? ` (denendi ${denemeSaati})` : ''}` };
  }

  if (gercek.length) {
    const saat = kisaTarihSaat(enSon(gercek, 'sentAt'));
    const alt = `${kanalAdlari(gercek)} ile`;
    return { durum: 'iletildi', ust: saat ? `İletildi · ${saat}` : 'İletildi', alt, ipucu: `Mükellefe ${kanalAdlari(gercek)} ile iletildi${saat ? ` (${saat})` : ''}` };
  }

  if (test.length) {
    const saat = kisaTarihSaat(enSon(test, 'sentAt'));
    // Saat alt satırda: üst satırda "test" etiketiyle birlikte dar sütuna sığmıyor
    return {
      durum: 'test',
      ust: 'Test gönderimi',
      alt: `${saat ? `${saat} · ` : ''}test alıcısına gitti, mükellef almadı`,
      ipucu: `Test modu açıkken ${kanalAdlari(test)} ile TEST alıcısına gitti; mükellef almadı, "iletildi" sayılmaz.`,
      testEtiketi: true,
    };
  }

  if (sirada.length) return { durum: 'sirada', ust: 'Sırada', alt: 'gönderim henüz tamamlanmadı', ipucu: 'Gönderim kaydı açıldı, sonuç henüz yazılmadı.' };
  if (atlanan.length) return { durum: 'yok', ust: 'Atlandı', alt: 'daha önce gönderilmişti', ipucu: 'Aynı belgeler daha önce gönderildiği için atlandı.' };
  return { durum: 'yok', ust: String(h.status || '—'), alt: '', ipucu: String(h.status || '') };
}

// ─── satır ───────────────────────────────────────────────────────────────────

export interface SatirGorunumu {
  satir: RaporSatiri;
  hucreler: Record<Kategori, HucreGorunumu>;
  durum: SatirDurumu;
  /** "Son durum" sütunu — kısa cümle */
  cumle: string;
  /** Üzerine gelince tamamı */
  cumleTam: string;
  /** Yeniden denenebilecek kategoriler (VERGI/SGK/ETEBLIGAT'ta hata/kısmen) */
  yenidenDenenecek: Kategori[];
  /** Ödeme Listesi hatalı → Aylık Ödeme Listesi ekranına yönlendir */
  odemeHatali: boolean;
}

export function satirGorunumu(r: RaporSatiri): SatirGorunumu {
  const hucreler = {} as Record<Kategori, HucreGorunumu>;
  for (const k of KATEGORILER) hucreler[k.key] = hucreGorunumu(r[k.key], k.key);
  const olan = (d: HucreDurumu | HucreDurumu[]) => {
    const set = Array.isArray(d) ? d : [d];
    return KATEGORILER.filter((k) => set.includes(hucreler[k.key].durum));
  };

  const hatali = olan(['hata', 'kismen']);
  const bekleyen = olan(['gonderilmedi', 'sirada']);
  const iletilen = olan('iletildi');
  const testli = olan('test');
  const kapali = olan(['kapali', 'kapsamDisi']);
  const belgeli = KATEGORILER.filter((k) => hucreler[k.key].durum !== 'yok');

  const yenidenDenenecek = hatali.map((k) => k.key).filter((k) => YENIDEN_DENENEBILIR.includes(k));
  const odemeHatali = hatali.some((k) => k.key === 'ODEME_LISTESI');

  const parcalar = (liste: typeof KATEGORILER, fiil: (g: HucreGorunumu) => string) => liste.map((k) => `${k.ad} ${fiil(hucreler[k.key])}`);
  const kisalt = (p: string[]) => (p.length <= 1 ? p[0] || '' : `${p[0]} (+${p.length - 1})`);

  if (hatali.length) {
    const p = parcalar(hatali, (g) => (g.durum === 'kismen' ? `kısmen iletildi (${g.hataOzeti || g.alt})` : `iletilemedi: ${g.alt}`));
    // Aynı sebeple birden çok kategori → "Vergi, SGK iletilemedi: telefon numarası yok"
    const sebepler = new Set(hatali.map((k) => hucreler[k.key].alt));
    const kisa = hatali.length > 1 && sebepler.size === 1 && hatali.every((k) => hucreler[k.key].durum === 'hata')
      ? `${hatali.map((k) => k.ad).join(', ')} iletilemedi: ${hucreler[hatali[0].key].alt}`
      : kisalt(p);
    return { satir: r, hucreler, durum: 'hata', cumle: kisa, cumleTam: p.join('\n'), yenidenDenenecek, odemeHatali };
  }
  if (bekleyen.length) {
    const p = parcalar(bekleyen, (g) => (g.durum === 'sirada' ? 'sırada' : `gönderilmedi: ${g.alt}`));
    const sebepler = new Set(bekleyen.map((k) => hucreler[k.key].alt));
    const kisa = bekleyen.length > 1 && sebepler.size === 1
      ? `${bekleyen.map((k) => k.ad).join(', ')} gönderilmedi: ${hucreler[bekleyen[0].key].alt}`
      : kisalt(p);
    return { satir: r, hucreler, durum: 'bekliyor', cumle: kisa, cumleTam: p.join('\n'), yenidenDenenecek, odemeHatali };
  }
  if (iletilen.length) {
    const digerleri = [...testli, ...kapali];
    if (!digerleri.length) {
      const tam = parcalar(iletilen, (g) => g.ust.toLocaleLowerCase('tr-TR')).join('\n');
      return { satir: r, hucreler, durum: 'iletildi', cumle: 'Hepsi iletildi', cumleTam: tam, yenidenDenenecek, odemeHatali };
    }
    const kisa = [
      `${iletilen.map((k) => k.ad).join(', ')} iletildi`,
      kapali.length ? `${kapali.map((k) => k.ad).join(', ')} kapalı` : '',
      testli.length ? `${testli.map((k) => k.ad).join(', ')} yalnız test` : '',
    ].filter(Boolean).join(' · ');
    const tam = [
      ...parcalar(iletilen, (g) => g.ust.toLocaleLowerCase('tr-TR')),
      ...parcalar(kapali, (g) => `${g.ust.toLocaleLowerCase('tr-TR')} — ${g.alt}`),
      ...parcalar(testli, () => 'yalnız test alıcısına gitti'),
    ].join('\n');
    return { satir: r, hucreler, durum: 'iletildi', cumle: kisa, cumleTam: tam, yenidenDenenecek, odemeHatali };
  }
  if (testli.length) {
    return { satir: r, hucreler, durum: 'test', cumle: 'Yalnız test gönderimi, mükellef almadı', cumleTam: parcalar(testli, () => 'test alıcısına gitti').join('\n'), yenidenDenenecek, odemeHatali };
  }
  if (kapali.length) {
    const kapsam = kapali.every((k) => hucreler[k.key].durum === 'kapsamDisi');
    const cumle = kapsam ? 'Kapsam dışı, gönderilmedi' : 'Kategori kapalı, gönderilmedi';
    return { satir: r, hucreler, durum: 'kapali', cumle, cumleTam: parcalar(kapali, (g) => `${g.ust.toLocaleLowerCase('tr-TR')} — ${g.alt}`).join('\n'), yenidenDenenecek, odemeHatali };
  }
  if (!belgeli.length) {
    return { satir: r, hucreler, durum: 'yok', cumle: 'Bu ay belge yok', cumleTam: 'Bu ay hiçbir kategoride belge yok.', yenidenDenenecek, odemeHatali };
  }
  return { satir: r, hucreler, durum: 'yok', cumle: 'Gönderim yok', cumleTam: 'Bu ay gönderim kaydı yok.', yenidenDenenecek, odemeHatali };
}

// ─── özet / süzgeç / sıralama ───────────────────────────────────────────────

export interface Ozet {
  mukellef: number;
  iletildi: number;
  hata: number;
  bekliyor: number;
  test: number;
  yok: number;
  /** Hücre (kalem) sayısı — "19 kalem kategori kapalı" */
  kapaliKalem: number;
  /** "Başarısızları yeniden dene (N)" — VERGI/SGK/ETEBLIGAT'taki hatalı hücre sayısı */
  yenidenDenenecek: number;
  /** Ödeme Listesi hatalı hücre sayısı (buradan denenmez) */
  odemeHatali: number;
}

export function ozetCikar(satirlar: SatirGorunumu[]): Ozet {
  const o: Ozet = { mukellef: satirlar.length, iletildi: 0, hata: 0, bekliyor: 0, test: 0, yok: 0, kapaliKalem: 0, yenidenDenenecek: 0, odemeHatali: 0 };
  for (const s of satirlar) {
    if (s.durum === 'iletildi') o.iletildi++;
    else if (s.durum === 'hata') o.hata++;
    else if (s.durum === 'bekliyor') o.bekliyor++;
    else if (s.durum === 'test') o.test++;
    else if (s.durum === 'yok') o.yok++;
    for (const k of KATEGORILER) {
      const d = s.hucreler[k.key].durum;
      if (d === 'kapali') o.kapaliKalem++;
      if (d === 'hata' || d === 'kismen') {
        if (k.key === 'ODEME_LISTESI') o.odemeHatali++;
        else o.yenidenDenenecek++;
      }
    }
  }
  return o;
}

const SIRA: Record<SatirDurumu, number> = { hata: 0, bekliyor: 1, test: 2, kapali: 3, iletildi: 4, yok: 5 };

function kucuk(s: string): string {
  return String(s || '').toLocaleLowerCase('tr-TR');
}

/** Süz + sırala: sorunlular üstte, sonra ada göre. */
export function satirlariHazirla(rows: RaporSatiri[], suzgec: Suzgec, arama: string): SatirGorunumu[] {
  const a = kucuk(arama).trim();
  return rows
    .map(satirGorunumu)
    .filter((s) => {
      if (a && !kucuk(s.satir.unvan).includes(a)) return false;
      switch (suzgec) {
        case 'tumu': return true;
        case 'sorunlu': return s.durum === 'hata' || s.durum === 'bekliyor' || s.durum === 'test' || s.durum === 'kapali';
        case 'iletilen': return s.durum === 'iletildi';
        case 'kapali': return KATEGORILER.some((k) => s.hucreler[k.key].durum === 'kapali');
        default: return s.durum === suzgec;
      }
    })
    .sort((x, y) => SIRA[x.durum] - SIRA[y.durum] || x.satir.unvan.localeCompare(y.satir.unvan, 'tr'));
}

// ─── uyarı satırları ────────────────────────────────────────────────────────

export interface KapaliUyarisi {
  /** "Vergi", "e-Tebligat" */
  adlar: string[];
  /** bu yüzden yapılmayan gönderim (hücre) sayısı */
  adet: number;
}

/**
 * "e-Tebligat kategorisi Ayarlar → Akıllı Bildirim'de KAPALI; bu ay 13 gönderim
 * bu yüzden yapılmadı". Hücrelerdeki "kategori kapalı" sebebinden türer; yalnız
 * gerçekten engellenen gönderim varsa gösterilir (kapalı ama belgesiz kategori
 * için uyarı yok — engellenen bir şey olmadı).
 */
export function kapaliUyarisi(rapor: Rapor | undefined, satirlar: SatirGorunumu[]): KapaliUyarisi | null {
  if (!rapor) return null;
  const adetler = new Map<Kategori, number>();
  for (const s of satirlar) {
    for (const k of KATEGORILER) {
      if (s.hucreler[k.key].durum === 'kapali') adetler.set(k.key, (adetler.get(k.key) || 0) + 1);
    }
  }
  const adet = [...adetler.values()].reduce((a, b) => a + b, 0);
  if (!adet) return null;
  return { adlar: KATEGORILER.filter((k) => adetler.has(k.key)).map((k) => k.ad), adet };
}

export interface TestUyarisi {
  /** test modu açık ve kategorisi açık olanlar */
  adlar: string[];
  /** bu ay test alıcısına giden gönderim sayısı */
  adet: number;
}

export function testUyarisi(rapor: Rapor | undefined): TestUyarisi | null {
  if (!rapor) return null;
  const adlar = KATEGORILER.filter((k) => (rapor.ayarlar || []).some((a) => a.kategori === k.key && a.enabled && a.testMode)).map((k) => k.ad);
  const adet = Number(rapor.totals?.testGonderim || 0);
  if (!adlar.length && !adet) return null;
  return { adlar, adet };
}

/** Sunucudaki resendFailed ile aynı pencere: ay başından şimdiye kaç saat. */
export function ayBasindanSaat(month: string, simdi: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 24;
  const ayBasi = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Math.max(1, Math.ceil((simdi.getTime() - ayBasi.getTime()) / 3_600_000));
}
