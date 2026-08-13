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

export type GundemData = {
  tarih: string;              // yyyy-mm-dd (Türkiye)
  kurTarihi: string | null;   // TCMB'nin yayınladığı tarih
  kurlar: GundemKur[];
  mevzuat: GundemMevzuat[];
  mevzuatToplam: number;      // Resmî Gazete'de taranan madde sayısı
  uyarilar: string[];         // kaynak erişilemediyse vb.
  uretimZamani: string;
  onbellekten: boolean;
};

const TCMB_TODAY = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const RG_ANASAYFA = 'https://www.resmigazete.gov.tr/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MorenPortal/1.0';

@Injectable()
export class GundemService {
  private readonly logger = new Logger(GundemService.name);
  private cache: { key: string; data: GundemData } | null = null;
  private inFlight: Promise<GundemData> | null = null;
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
      return { ...this.cache.data, onbellekten: true };
    }
    // Aynı anda gelen istekler tek çekimi paylaşsın
    if (!force && this.inFlight) return this.inFlight;

    this.inFlight = this.build(key).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async build(key: string): Promise<GundemData> {
    const uyarilar: string[] = [];
    const [kurRes, rgRes] = await Promise.allSettled([this.fetchKurlar(), this.fetchResmiGazete()]);

    let kurlar: GundemKur[] = [];
    let kurTarihi: string | null = null;
    if (kurRes.status === 'fulfilled') {
      kurlar = kurRes.value.kurlar;
      kurTarihi = kurRes.value.tarih;
    } else {
      uyarilar.push('TCMB kuru alınamadı');
      this.logger.warn(`TCMB kur hatası: ${kurRes.reason?.message || kurRes.reason}`);
    }

    let mevzuat: GundemMevzuat[] = [];
    let mevzuatToplam = 0;
    if (rgRes.status === 'fulfilled') {
      mevzuatToplam = rgRes.value.length;
      try {
        mevzuat = await this.suzMevzuat(rgRes.value);
      } catch (e: any) {
        uyarilar.push('Resmî Gazete süzgeci çalışmadı');
        this.logger.warn(`RG AI süzgeç hatası: ${e?.message || e}`);
      }
    } else {
      uyarilar.push('Resmî Gazete okunamadı');
      this.logger.warn(`RG hatası: ${rgRes.reason?.message || rgRes.reason}`);
    }

    const data: GundemData = {
      tarih: key,
      kurTarihi,
      kurlar,
      mevzuat,
      mevzuatToplam,
      uyarilar,
      uretimZamani: new Date().toISOString(),
      onbellekten: false,
    };
    this.cache = { key, data };
    return data;
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
  private async trFetch(url: string, timeoutMs = 20000): Promise<Response> {
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
    const init: any = { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) };
    if (this.dispatcher) init.dispatcher = this.dispatcher;
    return fetch(url, init) as any;
  }

  // ─────────────────────── RESMÎ GAZETE ───────────────────────

  /** Günlük fihristten madde başlıklarını çıkarır (ilan bölümü hariç). */
  private async fetchResmiGazete(): Promise<Array<{ baslik: string; url: string }>> {
    const r = await this.trFetch(RG_ANASAYFA, 25000);
    if (!r.ok) throw new Error(`Resmî Gazete → HTTP ${r.status}`);
    const html = await r.text();

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
