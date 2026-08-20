import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { claudeTextViaMax, MAX_MODEL_DEFAULT } from '../common/max-inference';
import { FaturaKesService } from './fatura-kes.service';

/**
 * SERBEST METİNDEN FATURA KOMUTU.
 *
 * Kullanıcı isteği (2026-08-20): "illa bu düzende mi yazılması lazım — okuduğunu anlayan,
 * toparlayan, sonra teyit alan bir sistem olsun". Yani sabit kalıp YOK: owner nasıl yazarsa
 * yazsın alanlar çıkarılır, EKSİK olan SORULUR, sonra özet gösterilip ONAY alınır.
 *
 * İKİ TARAF DA GEREKLİ (kullanıcı düzeltmesi): "hangi firmadan keseceğimi, alıcının kim
 * olacağını söylemeyecek miyim" — komutta hem SATICI (bizim mükellefimiz) hem ALICI olmalı.
 *
 * GÜVENLİK:
 *   • Bu servis HİÇBİR ŞEY GÖNDERMEZ. En fazla bizde TASLAK oluşturur.
 *   • Onay ayrı adımdır; GİB'e gönderim FaturaKesGibService'te ve ayrıca onaylanır.
 *   • Eksik alan UYDURULMAZ. Özellikle KDV oranı: yazılmadıysa varsayılan konmaz, SORULUR
 *     (yanlış oran faturayı baştan hatalı yapar, düzeltmesi zordur).
 *   • Alıcı VKN ile ünvanın uyuştuğu DOĞRULANAMAZ — GİB'in sicil sorgu ucu bu hesap tipine
 *     kapalı ("bu işlem için yetkiniz yok"). Bu yüzden özet ekranında ikisi de gösterilir.
 */

export type KomutAlanlari = {
  saticiAdi?: string | null;
  taxpayerId?: string | null;
  aliciVkn?: string | null;
  aliciUnvan?: string | null;
  aliciAdres?: string | null;
  aliciVd?: string | null;
  faturaTarihi?: string | null; // YYYY-MM-DD
  aciklama?: string | null;
  matrah?: number | null;
  kdvOrani?: number | null;
  miktar?: number | null;
  birim?: string | null;
};

export type KomutSonucu =
  | { tip: 'ILGISIZ' }
  | { tip: 'SORU'; soru: string; toplanan: KomutAlanlari }
  | { tip: 'SECIM'; soru: string; adaylar: Array<{ id: string; ad: string }>; toplanan: KomutAlanlari }
  | { tip: 'HAZIR'; taslakId: string; ozet: string; toplanan: KomutAlanlari };

const GECERLI_KDV = [0, 1, 10, 20];

@Injectable()
export class FaturaKesKomutService {
  private readonly logger = new Logger(FaturaKesKomutService.name);

  /**
   * YARIM KALAN KOMUTLAR. Owner "edelerden fatura kes" deyip tutarı sonraki mesajda
   * yazabilir; o yüzden toplanan alanlar numara başına saklanır.
   * Bellekte tutulur ve süre dolunca silinir — kaybolursa bot yeniden sorar, yanlış iş yapmaz.
   */
  private readonly bekleyen = new Map<string, { alanlar: KomutAlanlari; beklenen: string | null; ts: number }>();
  private static readonly BEKLEME_MS = 20 * 60 * 1000;

  /**
   * ÖNİZLEMESİ GÖNDERİLMİŞ, ONAY BEKLEYEN TASLAK (numara başına tek).
   * Kullanıcı akışı: "önizleme görüntüsünü gönderecek, ben inceleyeceğim, sorun yoksa
   * onaylayabilirsin diyeceğim". Onay gelmeden GİB'e HİÇBİR ŞEY gitmez.
   */
  private readonly onayBekleyen = new Map<string, { taslakId: string; ts: number }>();

  onayaAl(kimlik: string, taslakId: string) {
    this.onayBekleyen.set(kimlik, { taslakId, ts: Date.now() });
  }

  bekleyenOnay(kimlik: string): string | null {
    const k = this.onayBekleyen.get(kimlik);
    if (!k) return null;
    if (Date.now() - k.ts > FaturaKesKomutService.BEKLEME_MS) { this.onayBekleyen.delete(kimlik); return null; }
    return k.taslakId;
  }

  onayiUnut(kimlik: string) {
    this.onayBekleyen.delete(kimlik);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly faturaKes: FaturaKesService,
  ) {}

  /** Bu metin fatura kesme isteği olabilir mi? (ucuz ön eleme — AI'ya boşuna gitmesin) */
  static faturaKomutuMu(metin: string): boolean {
    const t = String(metin || '').toLowerCase();
    if (!t.trim()) return false;
    // SORU/GEZINME cumlelerini ELE: "fatura kesme ekranini acar misin", "nasil fatura kesilir"
    //   gibi mesajlar komut DEGILDIR; bot bunlara "hangi mukelleften keselim?" diye
    //   sormamali. (Bu ayrim olmazsa normal sohbet komut sanilir.)
    if (/ekran|men[üu]|nas[ıi]l|a[çc]ar m[ıi]s[ıi]n|a[çc]abilir|nerede|ne zaman/.test(t)) return false;
    const fatura = /fatura|e-?ar[şs]iv/.test(t);
    const eylem = /kes|kese(lim|cek)?|d[üu]zenle|olu[şs]tur|hazirla|hazırla/.test(t);
    return fatura && eylem;
  }

  /** Onay kelimeleri — sadece bunlar GİB'e göndermeyi tetikler. */
  static onayMi(metin: string): boolean {
    const t = String(metin || '').toLowerCase().trim();
    return /^(onayla|onaylayabilirsin|onay|tamam|olur|evet|g[öo]nder|kes)\b/.test(t);
  }

  /** Vazgeçme kelimeleri. */
  static vazgecMi(metin: string): boolean {
    const t = String(metin || '').toLowerCase().trim();
    return /^(vazge[çc]|iptal|hay[ıi]r|dur|bo[şs] ver)\b/.test(t);
  }

  private temizle() {
    const simdi = Date.now();
    for (const [k, v] of this.bekleyen) {
      if (simdi - v.ts > FaturaKesKomutService.BEKLEME_MS) this.bekleyen.delete(k);
    }
  }

  /** Türkiye takvim günü (sunucu UTC olsa da doğru). */
  private bugunTR(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  private norm(s: any): string {
    return String(s || '')
      .toLocaleUpperCase('tr-TR')
      .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
      .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private mukellefAdi(t: any): string {
    return t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.taxNumber || t?.id;
  }

  /** Serbest metni alanlara çevir (Max). Başarısızsa null döner — uydurma yapılmaz. */
  private async alanlariCikar(metin: string, mukellefAdlari: string[]): Promise<KomutAlanlari | null> {
    const sistem = [
      'Türk mali müşavirlik ofisinde çalışan bir yardımcısın.',
      'Sana gelen serbest metinden SATIŞ FATURASI bilgilerini çıkaracaksın.',
      'YALNIZCA JSON döndür, başka hiçbir şey yazma.',
      'Alanlar: saticiAdi, aliciVkn, aliciUnvan, aliciAdres, aliciVd, faturaTarihi (YYYY-MM-DD), aciklama, matrah (sayı), kdvOrani (sayı), miktar (sayı), birim.',
      'aliciAdres = alıcının açık adresi (mahalle/cadde/no/ilçe/il). Metinde yoksa null bırak.',
      'Bulamadığın alanı null bırak. ASLA TAHMİN ETME, ASLA UYDURMA.',
      'saticiAdi = faturayı KESEN firma (mali müşavirin mükellefi). aliciUnvan = faturanın KESİLDİĞİ firma.',
      'matrah KDV HARİÇ tutardır. "5 bin" gibi yazımları sayıya çevir (5000).',
      'Türkçe tutar yazımı: "8.000" sekiz bin demektir, "8,50" sekiz buçuk demektir.',
      '"bugün" yazarsa faturaTarihi alanını null bırak (tarihi sistem koyar).',
      'kdvOrani metinde açıkça yoksa null bırak — varsayılan koyma.',
    ].join('\n');

    const istem = [
      'Ofisin mükellefleri (saticiAdi bunlardan birine uymalı, uymuyorsa yine de metindeki adı yaz):',
      mukellefAdlari.slice(0, 200).map((a) => '- ' + a).join('\n'),
      '',
      'METİN:',
      metin,
      '',
      'JSON:',
    ].join('\n');

    const cevap = await claudeTextViaMax({ prompt: istem, system: sistem, model: MAX_MODEL_DEFAULT, maxTurns: 1 })
      .catch(() => null);
    if (!cevap?.ok || !cevap.text) {
      this.logger.warn(`[FATURA-KES/KOMUT] Max cevap vermedi: ${cevap?.error || 'bilinmiyor'}`);
      return null;
    }
    const ham = cevap.text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    try {
      const j = JSON.parse(ham.slice(ham.indexOf('{'), ham.lastIndexOf('}') + 1));
      return {
        saticiAdi: j.saticiAdi ?? null,
        aliciVkn: j.aliciVkn ? String(j.aliciVkn).replace(/\D/g, '') : null,
        aliciUnvan: j.aliciUnvan ?? null,
        aliciAdres: j.aliciAdres ?? null,
        aliciVd: j.aliciVd ?? null,
        faturaTarihi: j.faturaTarihi ?? null,
        aciklama: j.aciklama ?? null,
        matrah: Number.isFinite(Number(j.matrah)) && j.matrah !== null ? Number(j.matrah) : null,
        kdvOrani: Number.isFinite(Number(j.kdvOrani)) && j.kdvOrani !== null ? Number(j.kdvOrani) : null,
        miktar: Number.isFinite(Number(j.miktar)) && j.miktar !== null ? Number(j.miktar) : null,
        birim: j.birim ?? null,
      };
    } catch {
      this.logger.warn(`[FATURA-KES/KOMUT] JSON cozulemedi: ${ham.slice(0, 160)}`);
      return null;
    }
  }

  /** TR biçimli sayıyı çöz — sunucudaki sayi() ile AYNI kural ("8.000" = sekiz bin). */
  private static sayiCoz(v: any): number {
    const ham = String(v || '').trim().replace(/\s|₺|TL/gi, '');
    if (!ham) return NaN;
    const s = ham.replace(/^[-+]/, '');
    const sonVirgul = s.lastIndexOf(',');
    const sonNokta = s.lastIndexOf('.');
    let d: string;
    if (sonVirgul >= 0) d = s.slice(0, sonVirgul).replace(/\D/g, '') + '.' + s.slice(sonVirgul + 1).replace(/\D/g, '');
    else if (sonNokta >= 0) {
      const kesir = s.slice(sonNokta + 1);
      const tekNokta = s.indexOf('.') === sonNokta;
      d = tekNokta && /^\d{1,2}$/.test(kesir) ? s.slice(0, sonNokta).replace(/\D/g, '') + '.' + kesir : s.replace(/\D/g, '');
    } else d = s.replace(/\D/g, '');
    const n = Number(d);
    return Number.isFinite(n) ? n : NaN;
  }

  /**
   * SORDUĞUMUZ ALANIN CEVABINI DOĞRUDAN YAZ — yapay zekâya hiç gitmeden.
   *
   * Canlı hata (2026-08-20): "Alıcının adresi nedir?" sorusuna kullanıcı adresi yazdı,
   * cevap YENİ KOMUT sanılıp AI'ya verildi, düz adresten fatura alanı çıkmayınca aynı soru
   * tekrar edildi. Sorulan alan biliniyorsa cevabı doğrudan o alana yazmak hem doğru hem ucuz.
   */
  static cevabiAlanaYaz(alan: string, metin: string): KomutAlanlari | null {
    const t = String(metin || '').trim();
    if (!t) return null;
    // SİTEM/İTİRAZ cümlesi cevap DEĞİLDİR. Bu eleme olmasa "yazdım ya" gibi bir mesaj
    //   doğrudan adres alanına yazılır ve faturaya öyle basılırdı.
    if (/^(yazd[ıi]m|dedim|g[öo]nderdim|s[öo]yledim|verdim|ya|i[şs]te|hani|zaten|olmad[ıi]|anlamad[ıi])/i.test(t)) return null;
    switch (alan) {
      case 'aliciVkn': {
        const rakam = t.replace(/\D/g, '');
        return rakam ? { aliciVkn: rakam } : null;
      }
      case 'matrah': {
        const n = FaturaKesKomutService.sayiCoz(t);
        return Number.isFinite(n) ? { matrah: n } : null;
      }
      case 'kdvOrani': {
        const m = t.match(/\d+/);
        return m ? { kdvOrani: Number(m[0]) } : null;
      }
      case 'saticiAdi':
        return { saticiAdi: t };
      case 'aliciUnvan':
        return { aliciUnvan: t };
      case 'aliciAdres':
        return { aliciAdres: t };
      case 'aciklama':
        return { aciklama: t };
      default:
        return null;
    }
  }

  /** Mükellef adını listeyle eşleştir. Tek aday → seç, çok aday → sor, yok → sor. */
  private mukellefEslestir(ad: string | null | undefined, liste: any[]): { secilen?: any; adaylar: any[] } {
    const aranan = this.norm(ad);
    if (!aranan) return { adaylar: [] };
    const tam = liste.filter((t) => this.norm(this.mukellefAdi(t)) === aranan);
    if (tam.length === 1) return { secilen: tam[0], adaylar: tam };
    const kelimeler = aranan.split(' ').filter((k) => k.length >= 3);
    const kismi = liste.filter((t) => {
      const n = this.norm(this.mukellefAdi(t));
      return kelimeler.length > 0 && kelimeler.every((k) => n.includes(k));
    });
    if (kismi.length === 1) return { secilen: kismi[0], adaylar: kismi };
    return { adaylar: kismi.slice(0, 6) };
  }

  /**
   * EKSİK ALAN DENETİMİ — saf fonksiyon (test edilebilir).
   * Sıra ÖNEMLİ: en belirleyici eksikten başlanır ki bot tek tek doğru soru sorsun.
   */
  /**
   * Eksik alanı VE sorusunu birlikte döndürür.
   *
   * "Hangi alanı sorduk" bilgisi ŞART (canlı hata 2026-08-20): bot adresi sordu, kullanıcı
   * adresi yazdı, bot yine adresi sordu. Sebep: gelen cevap YENİ BİR KOMUT sanılıp yapay
   * zekâya "bundan fatura bilgisi çıkar" diye veriliyordu; düz bir adres metninden fatura
   * çıkmayınca alan boş kalıyor ve aynı soru tekrar ediyordu.
   */
  static eksikAlan(a: KomutAlanlari): { alan: string; soru: string } | null {
    const s = FaturaKesKomutService.eksikSorusuHam(a);
    return s;
  }

  static eksikSorusu(a: KomutAlanlari): string | null {
    return FaturaKesKomutService.eksikSorusuHam(a)?.soru || null;
  }

  private static eksikSorusuHam(a: KomutAlanlari): { alan: string; soru: string } | null {
    if (!a.taxpayerId) return { alan: 'saticiAdi', soru: 'Hangi mükelleften keselim?' };
    if (!a.aliciVkn) return { alan: 'aliciVkn', soru: 'Alıcının vergi kimlik numarası (ya da TC kimlik numarası) nedir?' };
    if (!/^\d{10}$|^\d{11}$/.test(String(a.aliciVkn))) {
      return { alan: 'aliciVkn', soru: `"${a.aliciVkn}" geçerli bir vergi/TC kimlik numarası değil (10 ya da 11 hane olmalı). Doğrusu nedir?` };
    }
    if (!a.aliciUnvan || String(a.aliciUnvan).trim().length < 2) return { alan: 'aliciUnvan', soru: 'Alıcının ünvanı (ya da ad soyadı) nedir?' };
    // ADRES ZORUNLU (kullanıcı talimatı 2026-08-20: "alıcının adresini sormadı, onu da sorsun mutlaka").
    //   GİB payload'ında bulvarcaddesokak alanına gider; boş gitmesi faturayı eksik bırakır.
    if (!a.aliciAdres || String(a.aliciAdres).trim().length < 5) return { alan: 'aliciAdres', soru: 'Alıcının adresi nedir?' };
    if (!a.aciklama || String(a.aciklama).trim().length < 2) return { alan: 'aciklama', soru: 'Fatura içeriği ne yazsın?' };
    if (!Number.isFinite(Number(a.matrah)) || Number(a.matrah) <= 0) return { alan: 'matrah', soru: 'Tutar (KDV hariç) ne kadar?' };
    if (a.kdvOrani === null || a.kdvOrani === undefined) return { alan: 'kdvOrani', soru: 'KDV oranı kaç? (%0, %1, %10, %20)' };
    if (!GECERLI_KDV.includes(Number(a.kdvOrani))) {
      return { alan: 'kdvOrani', soru: `KDV oranı %${a.kdvOrani} olamaz. %0, %1, %10 ya da %20 olmalı — hangisi?` };
    }
    return null;
  }

  /** Onay için gösterilecek özet. Satıcı ve alıcı BİRLİKTE gösterilir. */
  private ozet(taslak: any, mukellefAdi: string): string {
    const tl = (n: any) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const t = new Date(taslak.faturaTarihi);
    const g = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul' }).format(t);
    return [
      `*Satıcı:* ${mukellefAdi}`,
      `*Alıcı:* ${taslak.aliciUnvan} · VKN/TCKN ${taslak.aliciVkn}`,
      taslak.aliciAdres ? `${taslak.aliciAdres}` : '',
      `${g} · ${taslak.aciklama}`,
      `Matrah ${tl(taslak.matrah)} ₺ + KDV %${taslak.kdvOrani} ${tl(taslak.kdvTutari)} ₺ = *${tl(taslak.toplam)} ₺*`,
      '',
    ].filter(Boolean).join('\n');
  }

  /**
   * Serbest metni işle. Sonuç: soru sor / mükellef seçtir / taslak hazır (onay bekler).
   * HİÇBİR DURUMDA GİB'e gönderim yapılmaz.
   */
  async isle(tenantId: string, kimlik: string, metin: string): Promise<KomutSonucu> {
    this.temizle();
    const oncekiKayit = this.bekleyen.get(kimlik);
    const devam = !!oncekiKayit;
    if (!devam && !FaturaKesKomutService.faturaKomutuMu(metin)) return { tip: 'ILGISIZ' };

    const mukellefler = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
    }).catch(() => [] as any[]);

    // SORDUĞUMUZ ALAN VARSA: gelen mesaj o alanın cevabıdır. Kullanıcı araya YENİ bir
    //   fatura komutu yazmadıysa yapay zekâya hiç gitmeyiz (döngüyü kıran kısım budur).
    const beklenenAlan = oncekiKayit?.beklenen || null;
    let yeni: KomutAlanlari | null = null;
    if (beklenenAlan && !FaturaKesKomutService.faturaKomutuMu(metin)) {
      yeni = FaturaKesKomutService.cevabiAlanaYaz(beklenenAlan, metin);
    }
    if (!yeni) yeni = await this.alanlariCikar(metin, (mukellefler || []).map((t: any) => this.mukellefAdi(t)));
    if (!yeni && !devam) {
      return { tip: 'SORU', soru: 'Şu an mesajı çözemedim. Kısaca yazar mısın: hangi mükelleften, kime, ne içerik, ne kadar?', toplanan: {} };
    }

    // ÖNCEKİ bilgiler korunur, yeni gelenler ÜSTÜNE yazar (owner eksik alanı tek tek yazabilir).
    const a: KomutAlanlari = { ...(oncekiKayit?.alanlar || {}) };
    for (const [k, v] of Object.entries(yeni || {})) {
      if (v !== null && v !== undefined && v !== '') (a as any)[k] = v;
    }

    // Mükellef çözümü
    if (!a.taxpayerId && a.saticiAdi) {
      const { secilen, adaylar } = this.mukellefEslestir(a.saticiAdi, mukellefler || []);
      if (secilen) a.taxpayerId = secilen.id;
      else if (adaylar.length > 1) {
        this.bekleyen.set(kimlik, { alanlar: a, beklenen: 'saticiAdi', ts: Date.now() });
        return {
          tip: 'SECIM',
          soru: `"${a.saticiAdi}" birden fazla mükellefe uyuyor. Hangisi?`,
          adaylar: adaylar.map((t) => ({ id: t.id, ad: this.mukellefAdi(t) })),
          toplanan: a,
        };
      }
    }

    const eksik = FaturaKesKomutService.eksikAlan(a);
    if (eksik) {
      this.bekleyen.set(kimlik, { alanlar: a, beklenen: eksik.alan, ts: Date.now() });
      return { tip: 'SORU', soru: eksik.soru, toplanan: a };
    }

    // Taslak oluştur (yalnız bizde; hiçbir yere gitmez)
    const taslak: any = await this.faturaKes.createDraft(tenantId, null, {
      taxpayerId: a.taxpayerId!,
      aliciVkn: String(a.aliciVkn),
      aliciUnvan: String(a.aliciUnvan),
      aliciAdres: a.aliciAdres || undefined,
      aliciVd: a.aliciVd || undefined,
      faturaTarihi: a.faturaTarihi || this.bugunTR(),
      aciklama: String(a.aciklama),
      matrah: Number(a.matrah),
      kdvOrani: Number(a.kdvOrani),
      miktar: a.miktar || 1,
      birim: a.birim || 'ADET',
      kaynak: 'WHATSAPP',
      komutMetni: String(metin).slice(0, 1000),
    });

    this.bekleyen.delete(kimlik);
    const mk = (mukellefler || []).find((t: any) => t.id === a.taxpayerId);
    return { tip: 'HAZIR', taslakId: taslak.id, ozet: this.ozet(taslak, this.mukellefAdi(mk)), toplanan: a };
  }

  /** Owner "vazgeç" derse yarım kalan komutu unut. */
  unut(kimlik: string) {
    this.bekleyen.delete(kimlik);
  }
}
