import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OwnerOnlyGuard } from '../auth/guards/owner-only.guard';
import { faizOraniDegisti } from './butce-mesajlar';

/**
 * TCMB AZAMİ KART FAİZ ORANLARI
 *
 * Kullanıcı kart faizini elle takip etmesin diye TCMB'nin aylık yayımladığı
 * "Kredi Kartı İşlemlerinde Uygulanacak Azami Faiz Oranları" tablosu ayda bir
 * çekilir; kartların oranı bu orandan farklıysa kullanıcı BİLGİLENDİRİLİR.
 *
 * ÖNEMLİ — otomatik güncelleme YOK:
 *   Azami oran tavandır. Bankalar tavanın ALTINDA oran uygulayabilir ve çoğu
 *   uygular. Bu yüzden farklı oranı gören kod kartı kendiliğinden değiştirmez;
 *   yalnız haber verir, güncelleme kullanıcının onayıyla (kartlariGuncelle) olur.
 *
 * TABLONUN YAPISI (tcmb.gov.tr, doğrulandı 2026-08):
 *   Geçerlilik Tarihi | Referans Oran | ── Türk Lirası (4 kademe × akdi+gecikme) ──
 *                                     | ── Yabancı Para (akdi+gecikme) ──
 *   1/8/2026 | 3,11 | 3,25 | 3,55 | 3,75 | 4,05 | 4,25 | 4,55 | 4,25 | 4,55 | 2,98 | 3,28
 *   Satırlar yeniden eskiye sıralı; her ayın 1'i için bir satır eklenir.
 *
 * Ayıklama sütun SAYISINA değil, başlık satırındaki "Akdi/Gecikme" ETİKETLERİNE
 * dayanır: TCMB araya kademe eklerse kod kırılmaz, kademe sayısı artar.
 */

/** Bir kademe = aynı dilime ait akdi + gecikme oranı ikilisi (%) */
export interface AzamiKademe {
  akdi: number;
  gecikme: number;
}

/**
 * Sözleşme tipi. `akdi`/`gecikme` tablodaki İLK Türk Lirası kademesidir
 * (dönem borcu en düşük dilim) — sıradan bir bireysel kartın tabi olduğu oran.
 * Diğer dilimler ve yabancı para satırı `kademeler` içinde, tablodaki sırayla.
 */
export interface AzamiOran {
  akdi: number;
  gecikme: number;
  kaynak: string;
  cekilmeTarihi: Date;
  /** TCMB'nin bu satır için yazdığı geçerlilik tarihi (yyyy-mm-dd) */
  gecerlilikTarihi?: string | null;
  kademeler?: AzamiKademe[];
}

/** HTML'den ayıklanan ham sonuç — ağ katmanından bağımsız, saf. */
export interface AyiklananOran {
  akdi: number;
  gecikme: number;
  gecerlilikTarihi: string | null;
  kademeler: AzamiKademe[];
}

/** Karşılaştırmaya giren kart (Prisma kaydı da bu şekle uyar) */
export interface KartOrani {
  id?: string;
  bankaAdi?: string | null;
  kartAdi?: string | null;
  aylikFaizOrani: any; // Prisma Decimal | number | string
  gecikmeFaizOrani: any;
}

export interface OranFarki {
  id?: string;
  ad: string;
  kartAkdi: number;
  kartGecikme: number;
  azamiAkdi: number;
  azamiGecikme: number;
  /** Kart oranı tavanın ÜSTÜNDE mi? (üstündeyse kayıt yanlış/eskimiş demektir) */
  tavanUstunde: boolean;
}

export interface Kimlik {
  tenantId: string;
  userId: string;
}

/**
 * Kaynak adresler sırayla denenir; ilk ayrıştırılabilen kazanır.
 * TCMB sayfayı taşırsa MOREN_BUTCE_AZAMI_URL ile koda dokunmadan yönlendirilir.
 */
const KAYNAKLAR = [
  'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Bankacilik+Verileri/Kredi_Karti_Islemlerinde_Uygulanacak_Azami_Faiz_Oranlari',
  'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Bankacilik+Verileri/Kredi+Karti+Islemlerinde+Uygulanacak+Azami+Faiz+Oranlari',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Aylık faiz oranı için akla yatkın aralık — bunun dışı ayrıştırma hatası sayılır */
const ORAN_ALT = 0;
const ORAN_UST = 50;

/** Decimal/string/number → number */
const say = (v: any): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
};

/** Decimal(6,3) alanı karşılaştırırken kuruş altı gürültü fark sayılmasın */
const ayni = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/**
 * Türkçe harfleri sadeleştirip küçültür.
 * Gerekçe: JS'te /akdi/i deseni "AKDİ" ile EŞLEŞMEZ ('İ'.toLowerCase() nokta
 * bırakır). TCMB başlığı büyük harfe dönerse eşleşme kaybolmasın diye elle çeviriyoruz.
 */
function sadelestir(s: string): string {
  return String(s || '')
    .replace(/[İIıi]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** HTML varlıklarını çöz (sayfada bolca &nbsp; var) */
function varlikCoz(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/ /g, ' ');
}

/** Tek hücrenin görünen metni (iç içe span'lar temizlenir) */
function hucreMetni(icerik: string): string {
  return varlikCoz(
    String(icerik)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Belgedeki bütün <tr>'leri hücre metni dizilerine çevirir */
function tabloSatirlari(html: string): string[][] {
  const satirlar: string[][] = [];
  const trler = String(html || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trler) {
    const hucreler = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((h) =>
      hucreMetni(h.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '')),
    );
    if (hucreler.length) satirlar.push(hucreler);
  }
  return satirlar;
}

/** "3,25" / "1.234,56" / "%4,05" → number | null */
function trSayi(ham: string): number | null {
  const t = String(ham || '')
    .replace(/[%\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "1/8/2026" veya "01.08.2026" → yyyy-mm-dd (gün/ay/yıl sırası — TCMB biçimi) */
function trTarih(ham: string): string | null {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(String(ham || '').trim());
  if (!m) return null;
  const gun = Number(m[1]);
  const ay = Number(m[2]);
  const yil = Number(m[3]);
  if (gun < 1 || gun > 31 || ay < 1 || ay > 12 || yil < 2000 || yil > 2200) return null;
  return `${yil}-${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
}

const gecerliOran = (n: number) => Number.isFinite(n) && n > ORAN_ALT && n <= ORAN_UST;

/**
 * TCMB sayfasının HTML'inden azami oranları ayıklar. SAF fonksiyon — ağ yok,
 * bu yüzden testi girdi/çıktı olarak yazılabiliyor.
 *
 * Başarısızlıkta null döner. Bilerek "tahmin etmiyor": yanlış bir oran, boş
 * sonuçtan kötüdür — sahte "faiz değişti" bildirimi üretir ve kullanıcıyı
 * kartlarını yanlış oranla güncellemeye çağırır.
 *
 * @param bugun Hangi tarihte yürürlükte olan satır seçilecek (test için sabitlenebilir).
 *              TCMB gelecek ayın oranını önceden yayımladığı için gerekli.
 */
export function azamiOranlariAyikla(html: string, bugun: Date = new Date()): AyiklananOran | null {
  const satirlar = tabloSatirlari(html);
  if (!satirlar.length) return null;

  // 1) Başlık satırı: içinde en az iki "…Akdi Faiz…" / "…Gecikme Faiz…" hücresi olan satır
  let etiketIdx = -1;
  for (let i = 0; i < satirlar.length; i++) {
    const isaretli = satirlar[i].filter((h) => {
      const s = sadelestir(h);
      return s.includes('faiz') && (s.includes('akdi') || s.includes('gecikme'));
    }).length;
    if (isaretli >= 2) {
      etiketIdx = i;
      break;
    }
  }
  if (etiketIdx < 0) return null;
  const etiketler = satirlar[etiketIdx];

  // 2) Başlıktan sonraki veri satırları: ilk hücresi tarih olanlar
  const adaylar: Array<{ tarih: string; hucreler: string[] }> = [];
  for (let i = etiketIdx + 1; i < satirlar.length; i++) {
    const h = satirlar[i];
    const t = trTarih(h[0]);
    if (!t) continue;
    if (h.length < etiketler.length + 1) continue; // tarih + oran sütunları sığmıyor
    adaylar.push({ tarih: t, hucreler: h });
  }
  if (!adaylar.length) return null;

  // 3) Bugün yürürlükte olan satır = tarihi bugünü geçmeyenlerin en yenisi.
  //    (Hiçbiri geçmemişse tabloda yalnız gelecek tarihler var; en yenisini al.)
  const bugunIso = new Date(bugun).toISOString().slice(0, 10);
  const yururlukte = adaylar.filter((a) => a.tarih <= bugunIso);
  const havuz = yururlukte.length ? yururlukte : adaylar;
  const secilen = havuz.reduce((en, a) => (a.tarih > en.tarih ? a : en), havuz[0]);

  // 4) Hizalama: veri satırının SONUNDAKİ hücreler başlık etiketleriyle eşleşir.
  //    (Baştaki "Geçerlilik Tarihi" ve "Referans Oran" hücrelerinin başlıkta
  //     karşılığı yok — rowspan'li ayrı satırda duruyorlar.)
  const kaydirma = secilen.hucreler.length - etiketler.length;
  if (kaydirma < 0) return null;

  const kademeler: AzamiKademe[] = [];
  let bekleyenAkdi: number | null = null;
  for (let i = 0; i < etiketler.length; i++) {
    const etiket = sadelestir(etiketler[i]);
    const deger = trSayi(secilen.hucreler[kaydirma + i]);
    if (deger === null) {
      bekleyenAkdi = null;
      continue;
    }
    if (etiket.includes('akdi')) {
      bekleyenAkdi = deger;
    } else if (etiket.includes('gecikme') && bekleyenAkdi !== null) {
      kademeler.push({ akdi: bekleyenAkdi, gecikme: deger });
      bekleyenAkdi = null;
    }
  }

  // 5) Akıl süzgeci: oran aralıkta olmalı, gecikme akdiden küçük olamaz.
  const saglam = kademeler.filter(
    (k) => gecerliOran(k.akdi) && gecerliOran(k.gecikme) && k.gecikme >= k.akdi,
  );
  if (!saglam.length) return null;

  return {
    akdi: saglam[0].akdi,
    gecikme: saglam[0].gecikme,
    gecerlilikTarihi: secilen.tarih,
    kademeler: saglam,
  };
}

@Injectable()
export class ButceFaizOranlariService {
  private readonly logger = new Logger(ButceFaizOranlariService.name);

  /** 24 saatlik bellek içi önbellek — oran ayda bir değişiyor, sayfayı yormayalım */
  private onbellek: { ts: number; deger: AzamiOran } | null = null;
  private readonly ONBELLEK_MS = 24 * 60 * 60 * 1000;
  private inFlight: Promise<AzamiOran | null> | null = null;

  /** Aynı oranı iki kez duyurmamak için son duyurulan değer (süreç ömrü boyunca) */
  private sonDuyurulan: { akdi: number; gecikme: number } | null = null;

  private dispatcher: any = undefined; // undici ProxyAgent | null

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  /* ===================== ÇEKME ===================== */

  /**
   * TCMB'den azami oranları çeker. HİÇBİR DURUMDA throw etmez — bu metot cron'un
   * içinden çağrılıyor, patlarsa aylık kontrolü komple düşürür.
   *
   * @param zorla Önbelleği atla (kullanıcı "yenile" dediğinde)
   */
  async fetchAzamiOranlar(zorla = false): Promise<AzamiOran | null> {
    if (!zorla && this.onbellek && Date.now() - this.onbellek.ts < this.ONBELLEK_MS) {
      return this.onbellek.deger;
    }
    // Aynı anda gelen istekler tek çekimi paylaşsın
    if (!zorla && this.inFlight) return this.inFlight;

    this.inFlight = this.cek().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async cek(): Promise<AzamiOran | null> {
    const ekstra = String(process.env.MOREN_BUTCE_AZAMI_URL || '').trim();
    const adresler = ekstra ? [ekstra, ...KAYNAKLAR] : KAYNAKLAR;

    for (const url of adresler) {
      try {
        const r = await this.trFetch(url, 20000);
        if (!r.ok) {
          this.logger.warn(`Azami oran sayfası → HTTP ${r.status} (${url})`);
          continue;
        }
        const html = await r.text();
        const ayiklanan = azamiOranlariAyikla(html);
        if (!ayiklanan) {
          this.logger.warn(`Azami oran tablosu okunamadı (sayfa yapısı değişmiş olabilir): ${url}`);
          continue;
        }
        const deger: AzamiOran = {
          akdi: ayiklanan.akdi,
          gecikme: ayiklanan.gecikme,
          kaynak: url,
          cekilmeTarihi: new Date(),
          gecerlilikTarihi: ayiklanan.gecerlilikTarihi,
          kademeler: ayiklanan.kademeler,
        };
        this.onbellek = { ts: Date.now(), deger };
        this.logger.log(
          `TCMB azami oran: akdi %${deger.akdi} / gecikme %${deger.gecikme} (geçerlilik ${deger.gecerlilikTarihi})`,
        );
        return deger;
      } catch (e: any) {
        this.logger.warn(`Azami oran çekilemedi (${url}): ${e?.message || e}`);
      }
    }
    return null;
  }

  /**
   * Türkiye çıkışlı istek. Bazı kamu siteleri yurt dışı IP'yi (Railway) reddediyor;
   * TURMOB_PROXY_URL / PORTAL_TR_PROXY_URL tanımlıysa istek Türkiye proxy'si
   * üzerinden gider — Gündem modülüyle aynı mekanizma. Proxy yoksa doğrudan denenir.
   */
  private async trFetch(url: string, timeoutMs = 20000): Promise<any> {
    if (this.dispatcher === undefined) {
      const purl = String(process.env.TURMOB_PROXY_URL || process.env.PORTAL_TR_PROXY_URL || '').trim();
      if (purl) {
        try {
          this.dispatcher = new (require('undici').ProxyAgent)(purl);
          this.logger.log('Azami faiz: Türkiye proxy aktif');
        } catch (e: any) {
          this.logger.warn(`Azami faiz: proxy kurulamadı — ${e?.message}`);
          this.dispatcher = null;
        }
      } else {
        this.dispatcher = null;
      }
    }
    const init: any = {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (this.dispatcher) init.dispatcher = this.dispatcher;
    return fetch(url, init) as any;
  }

  /* ===================== KARŞILAŞTIRMA ===================== */

  /**
   * Oranı azamiden FARKLI olan kartları döndürür. Saf — veritabanına dokunmaz.
   *
   * Not: fark tek başına "hata" değildir; banka tavanın altında oran uygulayabilir.
   * `tavanUstunde` true ise kayıt gerçekten yanlıştır (tavan aşılamaz), onu ayırt
   * edebilmek için ayrı alan olarak veriyoruz.
   */
  oranlariKarsilastir(mevcutKartlar: KartOrani[], azami: AzamiOran | null): OranFarki[] {
    if (!azami || !gecerliOran(azami.akdi) || !gecerliOran(azami.gecikme)) return [];
    const liste = Array.isArray(mevcutKartlar) ? mevcutKartlar : [];

    return liste
      .map((k) => {
        const kartAkdi = say(k.aylikFaizOrani);
        const kartGecikme = say(k.gecikmeFaizOrani);
        return {
          id: k.id,
          ad: `${k.bankaAdi || ''} ${k.kartAdi || ''}`.trim() || 'Kart',
          kartAkdi,
          kartGecikme,
          azamiAkdi: azami.akdi,
          azamiGecikme: azami.gecikme,
          tavanUstunde: kartAkdi - azami.akdi > 0.0005 || kartGecikme - azami.gecikme > 0.0005,
        };
      })
      .filter((f) => !(ayni(f.kartAkdi, f.azamiAkdi) && ayni(f.kartGecikme, f.azamiGecikme)));
  }

  /** Portalda gösterilecek durum: güncel azami + farklı kartlar */
  async oranDurumu(k: Kimlik, zorla = false) {
    const azami = await this.fetchAzamiOranlar(zorla);
    const kartlar = await this.aktifKartlar(k);
    return {
      azami,
      farkliKartlar: this.oranlariKarsilastir(kartlar, azami),
      kartSayisi: kartlar.length,
    };
  }

  private async aktifKartlar(k: Kimlik): Promise<any[]> {
    return this.db.butceKart.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, aktif: true },
      orderBy: { sira: 'asc' },
    });
  }

  /* ===================== GÜNCELLEME ===================== */

  /**
   * Kullanıcı onayladığında bütün AKTİF kartların oranını verilen değere çeker.
   * Yalnız kullanıcı tetiklerse çalışır (cron ASLA çağırmaz) — bu yüzden burada
   * hatalı girdi sessizce yutulmaz, açıkça reddedilir.
   */
  async kartlariGuncelle(k: Kimlik, yeniAkdi: number, yeniGecikme: number) {
    const akdi = Number(yeniAkdi);
    const gecikme = Number(yeniGecikme);
    if (!gecerliOran(akdi) || !gecerliOran(gecikme)) {
      throw new BadRequestException(`Faiz oranı %${ORAN_ALT} ile %${ORAN_UST} arasında olmalı.`);
    }
    if (gecikme < akdi) {
      throw new BadRequestException('Gecikme faizi akdi faizden düşük olamaz.');
    }

    const sonuc = await this.db.butceKart.updateMany({
      where: { tenantId: k.tenantId, userId: k.userId, aktif: true },
      data: { aylikFaizOrani: akdi, gecikmeFaizOrani: gecikme },
    });

    // Kullanıcı oranları elle eşitledi; aynı oranı bir daha duyurma.
    this.sonDuyurulan = { akdi, gecikme };
    this.logger.log(`Kart faiz oranları güncellendi: ${sonuc.count} kart → %${akdi} / %${gecikme}`);
    return { guncellenen: sonuc.count, akdi, gecikme };
  }

  /* ===================== AYLIK CRON ===================== */

  /** Modülün sahibi (tek kişi). Tanımlı değilse cron sessizce çıkar. */
  private async sahip(): Promise<Kimlik | null> {
    const email = OwnerOnlyGuard.ownerEmail();
    if (!email) return null;
    const user = await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
      select: { id: true, tenantId: true },
    });
    if (!user) return null;
    return { tenantId: user.tenantId, userId: user.id };
  }

  /**
   * Her ayın 2'si 10:00 (Europe/Istanbul).
   * TCMB yeni oranı ayın 1'inden itibaren yürürlüğe koyuyor; sayfanın güncellenmesi
   * için bir gün pay bırakıldı.
   *
   * Burada YALNIZ bildirim yazılır. WhatsApp gönderimi kasten yok: mesajı ButceCron
   * dağıtıyor, iki yerden gönderilirse kullanıcı aynı metni iki kez alır.
   */
  @Cron('0 10 2 * *', { timeZone: 'Europe/Istanbul' })
  async aylikKontrol() {
    try {
      const k = await this.sahip();
      if (!k) return;

      const azami = await this.fetchAzamiOranlar(true);
      if (!azami) {
        this.logger.warn('Aylık faiz kontrolü: TCMB oranı alınamadı, bu ay atlandı.');
        return;
      }

      const kartlar = await this.aktifKartlar(k);
      const farklilar = this.oranlariKarsilastir(kartlar, azami);
      if (!farklilar.length) return; // her şey azamiyle aynı, söylenecek bir şey yok

      // Aynı azami oran için ikinci kez rahatsız etme. (Kartların bir kısmı
      // kalıcı olarak tavanın altındaysa her ay tekrar bildirim gitmesin.)
      if (this.sonDuyurulan && ayni(this.sonDuyurulan.akdi, azami.akdi) && ayni(this.sonDuyurulan.gecikme, azami.gecikme)) {
        return;
      }

      // "Eski oran" olarak farklı kartlarda EN YAYGIN oran çifti gösterilir —
      // tek kartın istisnası genel tabloyu yanıltmasın.
      const eski = this.enYayginOran(farklilar);

      const mesaj = faizOraniDegisti({
        eskiAkdi: eski.akdi,
        yeniAkdi: azami.akdi,
        eskiGecikme: eski.gecikme,
        yeniGecikme: azami.gecikme,
        kartSayisi: farklilar.length,
      });

      await this.notifications
        .create({
          tenantId: k.tenantId,
          userId: k.userId,
          title: mesaj.baslik,
          body: mesaj.govde,
          type: 'BUTCE',
          metadata: {
            modul: 'butce',
            konu: 'azami-faiz',
            azamiAkdi: azami.akdi,
            azamiGecikme: azami.gecikme,
            gecerlilikTarihi: azami.gecerlilikTarihi,
            kaynak: azami.kaynak,
            kartIdler: farklilar.map((f) => f.id).filter(Boolean),
            tavaniAsan: farklilar.filter((f) => f.tavanUstunde).length,
          },
          // Aynı oran çifti için 35 gün boyunca tek bildirim (okunmamışsa)
          dedupeKey: `butce:azami-faiz:${azami.akdi}-${azami.gecikme}`,
          dedupeWindowMin: 35 * 24 * 60,
        })
        .catch((e: any) => this.logger.warn(`Faiz bildirimi yazılamadı: ${e?.message || e}`));

      this.sonDuyurulan = { akdi: azami.akdi, gecikme: azami.gecikme };
      this.logger.log(`Azami faiz bildirimi yazıldı — ${farklilar.length} kart farklı oranda.`);
    } catch (e: any) {
      // Cron hiçbir koşulda patlamaz
      this.logger.error(`[ButceFaizOranlari] aylık kontrol hatası: ${e?.message || e}`);
    }
  }

  /** Farklı kartlar içinde en çok tekrar eden (akdi, gecikme) çifti */
  private enYayginOran(farklilar: OranFarki[]): { akdi: number; gecikme: number } {
    const sayac = new Map<string, { akdi: number; gecikme: number; adet: number }>();
    for (const f of farklilar) {
      const anahtar = `${f.kartAkdi}|${f.kartGecikme}`;
      const mevcut = sayac.get(anahtar);
      if (mevcut) mevcut.adet++;
      else sayac.set(anahtar, { akdi: f.kartAkdi, gecikme: f.kartGecikme, adet: 1 });
    }
    let en = { akdi: farklilar[0].kartAkdi, gecikme: farklilar[0].kartGecikme, adet: 0 };
    for (const v of sayac.values()) if (v.adet > en.adet) en = v;
    return { akdi: en.akdi, gecikme: en.gecikme };
  }
}
