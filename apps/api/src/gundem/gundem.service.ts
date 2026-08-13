import { Injectable, Logger } from '@nestjs/common';
import { claudeTextViaMax } from '../common/max-inference';

/**
 * GÜNDEM — mali müşavirin "bugün bilmesi gereken" dış bilgileri.
 * Kaynaklar:
 *   1) TCMB günlük döviz kuru (today.xml) — resmî kur + önceki güne göre değişim
 *   2) Resmî Gazete günlük fihrist — AI (Max) ile SADECE mali müşavirliği
 *      ilgilendiren maddeler süzülür (günde ~80 madde → 0-5 madde)
 *
 * Önbellek: gün bazlı bellek içi. İlk istek çeker, gün boyu aynı sonucu döner
 * (force=true ile yenilenir). Süreç yeniden başlarsa kendini onarır.
 * Not: GİB duyuru sayfası JS ile çizildiği için HTML'den okunamıyor — kapsam dışı.
 */

export type GundemKur = {
  kod: string;
  isim: string;
  alis: number | null;
  satis: number | null;
  degisimYuzde: number | null; // önceki güne göre (satış üzerinden)
};

export type GundemMevzuat = {
  baslik: string;
  url: string;
  neden: string;      // mali müşaviri neden ilgilendiriyor
  onem: 'yuksek' | 'orta';
};

/** Borsa/altın gibi kur dışı piyasa göstergeleri */
export type GundemPiyasa = {
  kod: string;                 // 'BİST 100' | 'GRAM ALTIN'
  isim: string;
  deger: number | null;
  birim: string;               // 'TL' | ''
  degisimYuzde: number | null;
  ondalik: number;             // gösterim hassasiyeti
};

/**
 * TÜİK Tüketici Fiyat Endeksi (TÜFE). "On iki aylık ortalamalara göre değişim"
 * konut kirası artış tavanıdır (TBK 344) — mali müşavirin en sık sorulan sayısı.
 */
export type GundemEnflasyon = {
  donem: string;                    // "Temmuz 2026"
  aylik: number | null;             // bir önceki aya göre
  yillik: number | null;            // bir önceki yılın aynı ayına göre
  kiraArtisTavani: number | null;   // on iki aylık ortalamalara göre
  yilbasindan: number | null;       // bir önceki yılın Aralık ayına göre
  kaynakUrl: string;
};

export type GundemData = {
  tarih: string;              // yyyy-mm-dd (Türkiye)
  kurTarihi: string | null;   // TCMB'nin yayınladığı tarih
  kurlar: GundemKur[];
  piyasa: GundemPiyasa[];
  enflasyon: GundemEnflasyon | null;
  mevzuat: GundemMevzuat[];
  mevzuatToplam: number;      // Resmî Gazete'de taranan madde sayısı
  mevzuatHazirlaniyor: boolean; // true iken Resmî Gazete taraması hâlâ sürüyor
  uyarilar: string[];         // kaynak erişilemediyse vb.
  uretimZamani: string;
  onbellekten: boolean;
};

const TCMB_TODAY = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const BIST_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/XU100.IS?interval=1d&range=5d';
const ALTIN_URL = 'https://finans.truncgil.com/today.json';
const TUIK_API = 'https://veriportali.tuik.gov.tr/api/tr';
const RG_ANASAYFA = 'https://www.resmigazete.gov.tr/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MorenPortal/1.0';

@Injectable()
export class GundemService {
  private readonly logger = new Logger(GundemService.name);
  private cache: { key: string; data: GundemData } | null = null;
  private inFlight: Promise<GundemData> | null = null;
  private sonEnflasyon: GundemEnflasyon | null = null; // TÜİK erişilemezse son bilinen değer
  private piyasaCache: { ts: number; data: GundemPiyasa[] } | null = null;
  private readonly PIYASA_TTL_MS = 15 * 60 * 1000; // borsa/altın gün içinde değişir
  private dispatcher: any = undefined; // undici ProxyAgent | null (Türkiye çıkışı)

  /** Türkiye saatine göre gün anahtarı (yyyy-mm-dd) */
  private todayKey(): string {
    const s = new Date().toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const [d, m, y] = s.split('.');
    return `${y}-${m}-${d}`;
  }

  async getGundem(force = false): Promise<GundemData> {
    const key = this.todayKey();
    if (!force && this.cache?.key === key) {
      // Kur ve mevzuat gün boyu sabit; borsa/altın DEĞİL — onları tazeleyerek dön.
      const piyasa = await this.fetchPiyasa().catch(() => this.cache?.data.piyasa ?? []);
      return { ...this.cache.data, piyasa, onbellekten: true };
    }
    // Aynı anda gelen istekler tek çekimi paylaşsın
    if (!force && this.inFlight) return this.inFlight;

    this.inFlight = this.build(key, force).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /**
   * Kart iki aşamada dolar. Sayısal kaynaklar (TCMB, borsa/altın, TÜİK) saniyeler
   * içinde gelir; Resmî Gazete + AI süzgeci ise 20-60 sn sürebiliyor. Kullanıcı bu
   * süre boyunca boş karta bakmasın diye önce hızlı kısım dönülür, mevzuat arkada
   * tamamlanıp önbelleğe işlenir (kart "taranıyor" der, bitince kendini günceller).
   * force=true'da (Yenile düğmesi) mevzuat beklenir — kullanıcı bilerek yeniliyor.
   */
  private async build(key: string, force = false): Promise<GundemData> {
    const uyarilar: string[] = [];
    const [kurRes, piyasaRes, enfRes] = await Promise.allSettled([
      this.fetchKurlar(), this.fetchPiyasa(), this.fetchEnflasyon(),
    ]);

    let enflasyon: GundemEnflasyon | null = null;
    if (enfRes.status === 'fulfilled') {
      enflasyon = enfRes.value;
    } else {
      // Ayda bir değişen veri — erişilemezse son bilinen değeri göstermek boş
      // göstermekten iyidir (dönem etiketi zaten kartta yazıyor).
      enflasyon = this.sonEnflasyon;
      if (!enflasyon) uyarilar.push('TÜİK enflasyon verisi alınamadı');
      this.logger.warn(`Enflasyon hatası: ${enfRes.reason?.message || enfRes.reason}`);
    }

    let piyasa: GundemPiyasa[] = [];
    if (piyasaRes.status === 'fulfilled') {
      piyasa = piyasaRes.value;
    } else {
      uyarilar.push('Borsa/altın verisi alınamadı');
      this.logger.warn(`Piyasa hatası: ${piyasaRes.reason?.message || piyasaRes.reason}`);
    }

    let kurlar: GundemKur[] = [];
    let kurTarihi: string | null = null;
    if (kurRes.status === 'fulfilled') {
      kurlar = kurRes.value.kurlar;
      kurTarihi = kurRes.value.tarih;
    } else {
      uyarilar.push('TCMB kuru alınamadı');
      this.logger.warn(`TCMB kur hatası: ${kurRes.reason?.message || kurRes.reason}`);
    }

    const data: GundemData = {
      tarih: key,
      kurTarihi,
      kurlar,
      piyasa,
      enflasyon,
      mevzuat: [],
      mevzuatToplam: 0,
      mevzuatHazirlaniyor: true,
      uyarilar,
      uretimZamani: new Date().toISOString(),
      onbellekten: false,
    };
    this.cache = { key, data };

    const mevzuatIsi = this.mevzuatTamamla(key);
    if (force) {
      await mevzuatIsi;                       // Yenile: kullanıcı sonucu bekliyor
      return this.cache?.key === key ? this.cache.data : data;
    }
    return data;                              // İlk açılış: mevzuat arkada gelir
  }

  /** Resmî Gazete + AI süzgeci — bitince günün önbelleğine işlenir. */
  private mevzuatCalisiyorKey: string | null = null;
  private async mevzuatTamamla(key: string): Promise<void> {
    // Aynı gün için ikinci kez başlatma; FARKLI gün (gece yarısı devri) engellenmesin.
    if (this.mevzuatCalisiyorKey === key) return;
    this.mevzuatCalisiyorKey = key;
    const ekUyari: string[] = [];
    let mevzuat: GundemMevzuat[] = [];
    let toplam = 0;
    try {
      const liste = await this.fetchResmiGazete();
      toplam = liste.length;
      try {
        mevzuat = await this.suzMevzuat(liste);
      } catch (e: any) {
        ekUyari.push('Resmî Gazete süzgeci çalışmadı');
        this.logger.warn(`RG AI süzgeç hatası: ${e?.message || e}`);
      }
    } catch (e: any) {
      // Sebebi GİZLEME: proxy yok mu, engel mi, zaman aşımı mı — tek bakışta görünsün.
      const sebep = String(e?.message || e || 'bilinmeyen').slice(0, 120);
      ekUyari.push(`Resmî Gazete okunamadı (${sebep})`);
      this.logger.warn(`RG hatası: ${sebep}`);
    } finally {
      if (this.mevzuatCalisiyorKey === key) this.mevzuatCalisiyorKey = null;
    }
    if (this.cache?.key === key) {
      this.cache.data = {
        ...this.cache.data,
        mevzuat,
        mevzuatToplam: toplam,
        mevzuatHazirlaniyor: false,
        uyarilar: [...this.cache.data.uyarilar, ...ekUyari],
      };
    }
  }

  // ─────────────────────────── TCMB ───────────────────────────

  private async fetchKurlar(): Promise<{ tarih: string | null; kurlar: GundemKur[] }> {
    const bugun = await this.fetchXml(TCMB_TODAY);
    const tarih = /Tarih="([^"]+)"/.exec(bugun)?.[1] || null;
    const istenen = [
      { kod: 'USD', isim: 'Dolar' },
      { kod: 'EUR', isim: 'Euro' },
      { kod: 'GBP', isim: 'Sterlin' },
    ];

    // Değişim tabanı: YAYIN tarihinden bir önceki iş günü.
    // (Bugünün kuru saat 15:30'da yayınlanır; o saate kadar today.xml DÜNÜN
    //  bültenidir. Takvim gününe göre geri saymak aynı güne denk gelip %0.00
    //  gösteriyordu — taban artık bültenin kendi tarihi.)
    let taban = new Date();
    if (tarih && /^\d{2}\.\d{2}\.\d{4}$/.test(tarih)) {
      const [d, m, y] = tarih.split('.').map(Number);
      taban = new Date(y, m - 1, d);
    }
    let oncekiXml = '';
    for (let i = 1; i <= 6 && !oncekiXml; i++) {
      const d = new Date(taban.getTime() - i * 86400000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      try {
        oncekiXml = await this.fetchXml(`https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`);
      } catch { /* hafta sonu/tatil — bir gün daha geriye */ }
    }

    const kurlar = istenen.map(({ kod, isim }) => {
      const satis = this.kurOku(bugun, kod);
      const oncekiSatis = oncekiXml ? this.kurOku(oncekiXml, kod) : null;
      const degisim = satis != null && oncekiSatis != null && oncekiSatis > 0
        ? Number((((satis - oncekiSatis) / oncekiSatis) * 100).toFixed(2))
        : null;
      return {
        kod,
        isim,
        alis: this.kurOku(bugun, kod, 'ForexBuying'),
        satis,
        degisimYuzde: degisim,
      };
    });
    return { tarih, kurlar };
  }

  private kurOku(xml: string, kod: string, alan: 'ForexSelling' | 'ForexBuying' = 'ForexSelling'): number | null {
    const blok = new RegExp(`<Currency[^>]*Kod="${kod}"[\\s\\S]*?</Currency>`, 'i').exec(xml)?.[0];
    if (!blok) return null;
    const ham = new RegExp(`<${alan}>([^<]*)</${alan}>`, 'i').exec(blok)?.[1];
    const n = Number(String(ham || '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private async fetchXml(url: string): Promise<string> {
    const r = await this.trFetch(url, 15000);
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return await r.text();
  }

  /**
   * Türkiye çıkışlı istek. Resmî Gazete gibi bazı kamu siteleri yurt dışı IP'leri
   * (Railway) reddediyor; TURMOB_PROXY_URL / PORTAL_TR_PROXY_URL tanımlıysa istek
   * Türkiye proxy'si üzerinden gider (GİB e-Arşiv akışıyla aynı mekanizma).
   * Proxy yoksa doğrudan denenir — kart yine çalışır, sadece o kaynak boş kalır.
   */
  private async trFetch(url: string, timeoutMs = 20000, ekBaslik?: Record<string, string>): Promise<Response> {
    if (this.dispatcher === undefined) {
      const purl = String(process.env.TURMOB_PROXY_URL || process.env.PORTAL_TR_PROXY_URL || '').trim();
      if (purl) {
        try {
          this.dispatcher = new (require('undici').ProxyAgent)(purl);
          this.logger.log('Gündem: Türkiye proxy aktif');
        } catch (e: any) {
          this.logger.warn(`Gündem: proxy kurulamadı — ${e?.message}`);
          this.dispatcher = null;
        }
      } else {
        this.dispatcher = null;
      }
    }
    const init: any = { headers: { 'User-Agent': UA, ...(ekBaslik || {}) }, signal: AbortSignal.timeout(timeoutMs) };
    if (this.dispatcher) init.dispatcher = this.dispatcher;
    return fetch(url, init) as any;
  }

  // ─────────────────────── TÜİK ENFLASYON ───────────────────────

  /**
   * TÜFE — TÜİK veri portalının kendi JSON ucundan (anahtar gerektirmiyor).
   * Bülten numarası her ay değişiyor ve sıralı DEĞİL; önce liste ucundan bulunuyor.
   * Tarayıcı benzeri User-Agent + X-Requested-With şart (WAF aksi halde 403/404 veriyor).
   * Ayda bir değiştiği için günlük gündem önbelleğiyle birlikte günde bir kez çekilir;
   * çekilemezse en son başarılı değer korunur (kart boş kalmasın).
   */
  private async fetchEnflasyon(): Promise<GundemEnflasyon | null> {
    const bas = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    };
    const liste = await this.trFetch(`${TUIK_API}/press`, 15000, bas);
    if (!liste.ok) throw new Error(`TÜİK liste → HTTP ${liste.status}`);
    const lj: any = await liste.json();
    const kayit = (Array.isArray(lj?.data) ? lj.data : []).find(
      (x: any) => String(x?.title || '').toLocaleLowerCase('tr').includes('tüketici fiyat endeksi'),
    );
    const id = kayit?.id ? String(kayit.id) : '';
    if (!id) throw new Error('TÜİK: TÜFE bülteni bulunamadı');

    const bulten = await this.trFetch(`${TUIK_API}/press/${id}`, 20000, bas);
    if (!bulten.ok) throw new Error(`TÜİK bülten → HTTP ${bulten.status}`);
    const bj: any = await bulten.json();
    const icerik = String(bj?.data?.content || '');
    const donem = String(bj?.data?.period || '').trim();

    // 1) Bültenin özet tablosu: satır etiketi + sağdaki oran
    const satirlar = [
      ...icerik.matchAll(/<td[^>]*class="text-left"[^>]*>([^<]+)<\/td>\s*<td[^>]*class="text-right"[^>]*>([^<]+)<\/td>/gi),
    ].map((m) => ({ etiket: m[1].toLocaleLowerCase('tr'), deger: this.trSayi(m[2]) }));
    const tablodan = (parca: string): number | null =>
      satirlar.find((s) => s.etiket.includes(parca))?.deger ?? null;

    // 2) Tablo bulunamazsa aynı sayılar bültenin özet cümlesinde de geçiyor
    const duz = icerik.replace(/<[^>]+>/g, ' ').toLocaleLowerCase('tr');
    const cumleden = (parca: string): number | null => {
      const m = new RegExp(`${parca}[^%]{0,30}%\\s*([\\d.,]+)`, 'i').exec(duz);
      return m ? this.trSayi(m[1]) : null;
    };
    const oku = (tabloParca: string, cumleParca: string) => tablodan(tabloParca) ?? cumleden(cumleParca);

    const veri: GundemEnflasyon = {
      donem: donem || 'son dönem',
      aylik: oku('önceki aya göre', 'bir önceki aya göre'),
      yillik: oku('aynı ayına göre', 'aynı ayına göre'),
      kiraArtisTavani: oku('on iki aylık ortalama', 'on iki aylık ortalamalara göre'),
      yilbasindan: oku('aralık ayına göre', 'aralık ayına göre'),
      kaynakUrl: `https://veriportali.tuik.gov.tr/tr/press/${id}`,
    };
    if (veri.aylik == null && veri.yillik == null && veri.kiraArtisTavani == null) {
      throw new Error('TÜİK: bülten okundu ama oranlar ayrıştırılamadı');
    }
    this.sonEnflasyon = veri;
    return veri;
  }

  // ─────────────────────── BORSA / ALTIN ───────────────────────

  /**
   * BİST 100 ve gram altın. Kurdan farklı olarak bunlar GÜN İÇİNDE değişir;
   * günlük önbelleğe hapsedilirse akşam sabahki fiyatı gösterir. Bu yüzden
   * kendi 15 dakikalık önbelleği var ve gündem önbellekten dönerken bile tazelenir.
   */
  private async fetchPiyasa(): Promise<GundemPiyasa[]> {
    if (this.piyasaCache && Date.now() - this.piyasaCache.ts < this.PIYASA_TTL_MS) {
      return this.piyasaCache.data;
    }
    const [bistRes, altinRes] = await Promise.allSettled([this.fetchBist(), this.fetchGramAltin()]);
    const out: GundemPiyasa[] = [];
    if (bistRes.status === 'fulfilled' && bistRes.value) out.push(bistRes.value);
    else if (bistRes.status === 'rejected') this.logger.warn(`BİST: ${bistRes.reason?.message || bistRes.reason}`);
    if (altinRes.status === 'fulfilled' && altinRes.value) out.push(altinRes.value);
    else if (altinRes.status === 'rejected') this.logger.warn(`Altın: ${altinRes.reason?.message || altinRes.reason}`);

    // Hepsi başarısızsa eski değeri koru — kart boşalmasın
    if (!out.length && this.piyasaCache) return this.piyasaCache.data;
    this.piyasaCache = { ts: Date.now(), data: out };
    return out;
  }

  private async fetchBist(): Promise<GundemPiyasa | null> {
    const r = await this.webFetch(BIST_URL, 12000);
    if (!r.ok) throw new Error(`BİST → HTTP ${r.status}`);
    const j: any = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const fiyat = Number(meta?.regularMarketPrice);
    const onceki = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    if (!Number.isFinite(fiyat) || fiyat <= 0) return null;
    const degisim = Number.isFinite(onceki) && onceki > 0
      ? Number((((fiyat - onceki) / onceki) * 100).toFixed(2))
      : null;
    return { kod: 'BİST 100', isim: 'Borsa İstanbul', deger: fiyat, birim: '', degisimYuzde: degisim, ondalik: 0 };
  }

  private async fetchGramAltin(): Promise<GundemPiyasa | null> {
    const r = await this.webFetch(ALTIN_URL, 12000);
    if (!r.ok) throw new Error(`Altın → HTTP ${r.status}`);
    const j: any = await r.json();
    const blok = j?.['gram-altin'];
    if (!blok || typeof blok !== 'object') return null;
    // Alan adları Türkçe ("Satış", "Değişim") — kaynak yazımı değişirse diye
    // birebir eşleşme yerine baş harflerden bul.
    const alan = (bas: string): string => {
      const k = Object.keys(blok).find((x) => x.toLocaleLowerCase('tr').startsWith(bas));
      return k ? String(blok[k] ?? '') : '';
    };
    const fiyat = this.trSayi(alan('sat')) ?? this.trSayi(alan('alı'));
    if (fiyat == null || fiyat <= 0) return null;
    return {
      kod: 'GRAM ALTIN',
      isim: 'Gram altın',
      deger: fiyat,
      birim: 'TL',
      degisimYuzde: this.trSayi(alan('değ')),
      ondalik: 2,
    };
  }

  /** "6.768,86" / "%-0,01" / "$4.407,06" → 6768.86 / -0.01 / 4407.06 */
  private trSayi(s: string): number | null {
    const t = String(s || '').replace(/[%$₺\s]/g, '').replace(/\./g, '').replace(',', '.');
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /** Yurt dışı kaynaklar (Yahoo, truncgil) — Türkiye proxy'sine gerek yok, doğrudan git. */
  private async webFetch(url: string, timeoutMs = 12000): Promise<Response> {
    return fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    }) as any;
  }

  // ─────────────────────── RESMÎ GAZETE ───────────────────────

  /** Günlük fihristten madde başlıklarını çıkarır (ilan bölümü hariç). */
  private async fetchResmiGazete(): Promise<Array<{ baslik: string; url: string }>> {
    // Bazı adres varyantları farklı davranıyor (www/non-www, fihrist sayfası) —
    // biri engellenirse diğerini dene, son hatayı sakla.
    const adaylar = [
      RG_ANASAYFA,
      'https://resmigazete.gov.tr/',
      'https://www.resmigazete.gov.tr/fihrist',
    ];
    let html = '';
    let sonHata = '';
    for (const u of adaylar) {
      try {
        const r = await this.trFetch(u, 25000);
        if (!r.ok) { sonHata = `${u.replace('https://', '')} → HTTP ${r.status}`; continue; }
        const govde = await r.text();
        if (govde && govde.length > 5000) { html = govde; break; }
        sonHata = `${u.replace('https://', '')} → boş/kısa yanıt (${govde?.length || 0})`;
      } catch (e: any) {
        sonHata = `${u.replace('https://', '')} → ${String(e?.message || e).slice(0, 60)}`;
      }
    }
    // YEDEK YOL: resmigazete.gov.tr yurt dışı/veri merkezi IP'lerini (Railway) TCP
    // seviyesinde reddediyor ("fetch failed"). Türkiye proxy'si tanımlı değilse
    // sayfayı genel bir okuyucu ayna üzerinden alırız — içerik KAMUYA AÇIK resmî
    // gazete sayfasıdır, dışarı hiçbir ofis/mükellef verisi gitmez.
    if (!html) {
      try {
        const r = await fetch(`https://r.jina.ai/${RG_ANASAYFA}`, {
          headers: { 'User-Agent': UA, 'x-respond-with': 'html' },
          signal: AbortSignal.timeout(40000),
        });
        if (r.ok) {
          const govde = await r.text();
          if (govde && govde.length > 5000) html = govde;
          else sonHata = `ayna → kısa yanıt (${govde?.length || 0})`;
        } else {
          sonHata = `ayna → HTTP ${r.status}`;
        }
      } catch (e: any) {
        sonHata = `${sonHata} | ayna → ${String(e?.message || e).slice(0, 50)}`;
      }
    }
    if (!html) throw new Error(sonHata || 'erişilemedi');

    const out: Array<{ baslik: string; url: string }> = [];
    const gorulen = new Set<string>();
    const re = /<a[^>]+href="(https:\/\/www\.resmigazete\.gov\.tr\/eskiler\/[^"]+\.(?:htm|pdf))"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const url = m[1];
      // Yargı/ihale ilanları ve günün tam PDF'i kapsam dışı
      if (/\/ilanlar\//i.test(url)) continue;
      if (/\/\d{8}\.pdf$/i.test(url)) continue;
      const baslik = m[2]
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/^[\s–—-]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (baslik.length < 12) continue;
      if (gorulen.has(baslik)) continue;
      gorulen.add(baslik);
      out.push({ baslik, url });
      if (out.length >= 120) break;
    }
    return out;
  }

  /** AI (Max) ile sadece mali müşavirliği ilgilendirenleri seçer. */
  private async suzMevzuat(maddeler: Array<{ baslik: string; url: string }>): Promise<GundemMevzuat[]> {
    if (!maddeler.length) return [];
    const liste = maddeler.map((x, i) => `${i + 1}. ${x.baslik}`).join('\n');
    const res = await claudeTextViaMax({
      system:
        'Sen Türkiye\'de çalışan deneyimli bir mali müşavirsin. Sana bugünkü Resmî Gazete madde başlıkları verilecek. ' +
        'SADECE mali müşavirlik mesleğini ve mükellefleri doğrudan ilgilendirenleri seçeceksin: vergi (VUK, KDV, ÖTV, gelir, kurumlar, damga, harç), ' +
        'SGK/prim/asgari ücret/teşvik, e-belge (e-fatura, e-arşiv, e-defter), muhasebe standartları, ticaret hukuku (TTK, şirket kuruluş/tasfiye), ' +
        'yeniden değerleme/enflasyon oranları, gecikme zammı/tecil faizi, teşvik ve destekler, asgari geçim/vergi tarifeleri. ' +
        'Üniversite yönetmelikleri, atama kararları, imar, çevre, sağlık gibi konuları ASLA seçme. ' +
        'Emin değilsen SEÇME — boş liste dönmek yanlış seçim yapmaktan iyidir.',
      prompt:
        `Bugünkü Resmî Gazete maddeleri:\n${liste}\n\n` +
        'Mali müşavirliği ilgilendirenleri seç. SADECE saf JSON dizi döndür (markdown yok, açıklama yok):\n' +
        '[{"no": <madde numarası>, "neden": "<mükellefi/müşaviri neden ilgilendiriyor, tek kısa cümle>", "onem": "yuksek|orta"}]\n' +
        'İlgilendiren madde yoksa: []',
      maxTurns: 1,
      timeoutMs: 90_000,
    });
    if (!res.ok || !res.text) return [];

    const ham = res.text.replace(/```json|```/g, '').trim();
    const bas = ham.indexOf('[');
    const son = ham.lastIndexOf(']');
    if (bas < 0 || son < bas) return [];
    let secilenler: any[] = [];
    try { secilenler = JSON.parse(ham.slice(bas, son + 1)); } catch { return []; }

    const sonuc: GundemMevzuat[] = [];
    for (const s of Array.isArray(secilenler) ? secilenler : []) {
      const idx = Number(s?.no) - 1;
      const kaynak = maddeler[idx];
      if (!kaynak) continue;
      sonuc.push({
        baslik: kaynak.baslik,
        url: kaynak.url,
        neden: String(s?.neden || '').slice(0, 200),
        onem: s?.onem === 'yuksek' ? 'yuksek' : 'orta',
      });
      if (sonuc.length >= 6) break;
    }
    return sonuc;
  }
}
