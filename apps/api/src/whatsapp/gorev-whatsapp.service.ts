import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ayristir, kucult, sadelestir, type AyristirmaSonucu, type MukellefSecenek } from '@mali-musavir/shared';

/**
 * WhatsApp'tan GÖREV / HATIRLATMA / NOT ekleme (owner hattı) — 2026-09-14, Muzaffer Bey isteği:
 * "dışarıdayım, aklıma bir şey geldi; bota 'görev ekle …' / '… günü hatırlat' dediğimde Görevler'e
 *  aynen portaldaki akıllı giriş gibi eklesin."
 *
 * Ayrıştırıcı portalla ORTAK: packages/shared/src/gorev-akilli-giris.ts (`ayristir`). Bu servis yalnız
 *   1) KATI kapı (gorevIstegiMi) — açık işaret yoksa mesaj bu modüle GİRMEZ (bütçe / iletme / fatura kes karışmasın),
 *   2) önek temizliği + ayrıştırma + tasks tablosuna kayıt (portal create() ile aynı alanlar),
 *   3) kısa Türkçe WhatsApp cevabı
 * yapar. AI çağrısı YOK (Max'a gitmez, saniyeler içinde cevap).
 *
 * Kuru test (POST /whatsapp/webhook/deneme, __dryRun): `kuru: true` ile çağrılır → kayıt YAZILMAZ, cevap "KURU TEST" ile başlar.
 */

export interface GorevKimlik {
  tenantId: string;
  userId: string;
}

export interface GorevIslemSecenek {
  /** true → veritabanına YAZMA (yapay deneme); cevap yine üretilir */
  kuru?: boolean;
  /** test için "şimdi" (gerçek UTC an) */
  simdi?: Date;
}

const MUKELLEF_TAVANI = 2000;
const ADAY_GOSTER = 3;
const VARSAYILAN_HATIRLATMA_SAATI = '09:00';
const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** apps/web/src/lib/tasks.ts CATEGORY_OPTIONS ile birebir */
const KATEGORI_ETIKET: Record<string, string> = {
  BEYANNAME: 'Beyanname',
  KDV_KONTROL: 'KDV Kontrol',
  EVRAK: 'Evrak',
  BANKA: 'Banka',
  TAHSILAT: 'Tahsilat',
  MUKELLEF: 'Mükellef görüşmesi',
  BORDRO: 'Bordro/SGK',
  OFIS: 'Ofis',
  DIGER: 'Diğer',
};
const ONCELIK_ETIKET: Record<string, string> = {
  URGENT: 'ACİL',
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

// ---------------------------------------------------------------------------
// KAPI — ASCII'ye indirgenmiş (sadelestir: ı→i, ö→o, ş→s …) küçük harfli metin üzerinde çalışır;
// böylece "hatirlat" / "gorev" (Türkçe harfsiz yazım) da yakalanır.
// ---------------------------------------------------------------------------

/** Açık önek: metin bunlardan biriyle BAŞLAMALI. */
const ONEK_RE = /^(?:gorev ekle|gorev yaz|yeni gorev|gorev\s*:|hatirlatma ekle|hatirlatma\s*:|hatirlat\s*:|not ekle|not\s*:)/;
/** "hatırlat" fiili (bana/sana/…ır mısın) — "hatırlatma" (isim) EŞLEŞMEZ (sözcük sınırı). */
const HATIRLAT_RE = /\bhatirlat(?:abilir misin(?:iz)?|ir misin(?:iz)?|sana|bana)?\b/;
/**
 * İletme fiilleri: mesaj BİRİNE gidecek demektir (owner→mükellef iletme / numaraya gönderme akışları), görev değil.
 *   ilet / gönder / yolla / söyle (emir + "…ir misin" + "…iver" + "…elim" biçimleri), "mesaj at/yaz/gönder",
 *   ve "yaz" fiili — yalnız mükellefe hitap (…'ya / …'ye / …'a / …'e) ile birlikteyse.
 */
const ILETME_RE = /\b(?:ilet|gonder|yolla|soyle)(?:in|iniz|ir misin(?:iz)?|r misin(?:iz)?|iver|elim|yelim|yalim|sene|sana|yin)?\b|\b(?:mesaj|whatsapp|wp)\s+(?:at|yaz|gonder)|'[yn]?[ae]\b.*\byaz(?:in|ar misin|sana|iver)?\b/;
/** Önek temizliği — tr-TR küçük harfli KOPYA üzerinde (uzunluk korunur, indeksler orijinalle aynı). */
const ONEK_TEMIZLE_RE = /^(?:g[öo]rev ekle|g[öo]rev yaz|yeni g[öo]rev|g[öo]rev\s*:|hat[ıi]rlatma ekle|hat[ıi]rlatma\s*:|hat[ıi]rlat\s*:|not ekle|not\s*:)\s*[:\-–—]?\s*/;
const ONEK_NOT_RE = /^not\b/;
/** JS \b yalnız ASCII: Türkçe harfli sözcük sınırı (ortak ayrıştırıcıdaki kalıp). */
const HARF = 'a-z0-9çğıöşüâîû';
/**
 * Bota yöneltilen "hatırlat" fiili başlığa girmesin: "… yarın 10:00 hatırlat" → "…"; "bana hatırlatır mısın" → "".
 * (tr-TR küçük harfli kopya üzerinde; uzunluk korunur.)
 */
const HATIRLAT_TEMIZLE_RE = new RegExp(
  String.raw`(?<![${HARF}])(?:(?:bana|sana)\s+)?hat[ıi]rlat(?:abilir misin(?:iz)?|[ıi]r m[ıi]s[ıi]n(?:[ıi]z)?|sana|bana)?(?:\s+(?:bana|sana))?(?![${HARF}])`,
  'g',
);

/** Kapı için düzleştirme: tr-TR küçük harf + ASCII + tek boşluk + düz kesme işareti. */
function duzlestir(metin: string): string {
  return sadelestir(String(metin || ''))
    .replace(/['’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Tarih yardımcıları — Türkiye sabit +03:00 (tasks.service istanbulGunBasi / gorev-hatirlatma-kurali ile aynı kalıp)
// ---------------------------------------------------------------------------

/**
 * Sunucu saat dilimi ne olursa olsun, ayrıştırıcının `simdi` olarak İstanbul duvar saatini görmesi için:
 * yerel alanları (getFullYear/getDate/…) İstanbul'daki yıl-ay-gün-saat-dakikaya eşit bir Date üretir.
 * (Railway UTC'de; gece 00:00–03:00 arası "yarın" bir gün kaymasın.)
 */
export function istanbulDuvarSaati(simdi: Date): Date {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(simdi);
  const al = (tip: string) => Number(p.find((x) => x.type === tip)?.value);
  return new Date(al('year'), al('month') - 1, al('day'), al('hour') % 24, al('minute'), 0, 0);
}

/** "YYYY-MM-DD" + "HH:mm" (yoksa gün başı) → İstanbul saatiyle Date (UTC). Portal vadeIso() ile aynı an. */
export function vadeTarihi(gunIso: string, saat: string | null): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gunIso)) return null;
  const s = saat && /^\d{2}:\d{2}$/.test(saat) ? saat : '00:00';
  const d = new Date(`${gunIso}T${s}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoGun(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function gunEkle(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** "2026-09-15" → "Yarın 15.09.2026" / "Bugün 14.09.2026" / "Çarşamba 17.09.2026" */
export function tarihEtiketi(gunIso: string, bugunIstanbul: Date): string {
  const [y, m, g] = gunIso.split('-').map(Number);
  const d = new Date(y, m - 1, g);
  const bicim = `${String(g).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  const bugun = isoGun(bugunIstanbul);
  const yarin = isoGun(gunEkle(bugunIstanbul, 1));
  const on = gunIso === bugun ? 'Bugün' : gunIso === yarin ? 'Yarın' : GUN_ADLARI[d.getDay()];
  return `${on} ${bicim}`;
}

/** "HH:mm" − dakika → "HH:mm" (gün altına inmez, 00:00'da kalır) */
function saatGeri(saat: string, dakika: number): string {
  const [h, m] = saat.split(':').map(Number);
  const toplam = Math.max(0, h * 60 + m - dakika);
  return `${String(Math.floor(toplam / 60)).padStart(2, '0')}:${String(toplam % 60).padStart(2, '0')}`;
}

@Injectable()
export class GorevWhatsappService {
  private readonly logger = new Logger(GorevWhatsappService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  /**
   * KATI kapı — yalnız açık işaret:
   *   • metin şu öneklerden biriyle BAŞLAR: "görev ekle", "görev:", "görev yaz", "yeni görev",
   *     "hatırlatma ekle", "hatırlatma:", "hatırlat:", "not ekle", "not:"
   *   • YA DA metinde "hatırlat / hatırlat bana / hatırlatır mısın / hatırlatsana" geçer ve iletme fiili
   *     (ilet, gönder, yolla, söyle, mesaj at, mükellefe hitap + yaz) GEÇMEZ.
   * Bütçe ("… harcaması yaptım işle", "Ziraat kartı borcu …"), fatura kes, "X'e … söyle/ilet" → false.
   */
  static gorevIstegiMi(metin: string): boolean {
    const t = duzlestir(metin);
    if (!t) return false;
    if (ONEK_RE.test(t)) return true;
    if (HATIRLAT_RE.test(t) && !ILETME_RE.test(t)) return true;
    return false;
  }

  /**
   * Öneki ayırır ("görev ekle:", "hatırlat:", "not:" …); "not ekle" / "not:" öneki NOT türü demektir.
   * Bota söylenen "hatırlat / bana hatırlatır mısın" fiili de gövdeden çıkarılır (başlığa girmesin).
   */
  static onekiAyir(metin: string): { govde: string; onekNot: boolean } {
    const ham = String(metin || '').replace(/\s+/g, ' ').trim();
    const k = kucult(ham);
    const m = ONEK_TEMIZLE_RE.exec(k);
    const onekNot = !!m && ONEK_NOT_RE.test(k);
    let govde = m ? ham.slice(m[0].length) : ham;
    // "hatırlat" fiilini sil — indeksler orijinalle aynı (tr-TR küçük harf uzunluğu korur)
    let kk = kucult(govde);
    let f: RegExpExecArray | null;
    HATIRLAT_TEMIZLE_RE.lastIndex = 0;
    while ((f = HATIRLAT_TEMIZLE_RE.exec(kk))) {
      govde = govde.slice(0, f.index) + ' '.repeat(f[0].length) + govde.slice(f.index + f[0].length);
      kk = kucult(govde);
    }
    govde = govde
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '')
      .trim();
    // Bota hitap kalıntıları: baştaki/sondaki "bana / sana / lütfen" ("bana yarın … hatırlatır mısın" → "yarın …")
    for (let i = 0; i < 2; i++) {
      const kb = kucult(govde);
      const bas = /^(?:bana|sana|lütfen)\s+/.exec(kb);
      if (bas) govde = govde.slice(bas[0].length);
      const kson = kucult(govde);
      const son = /\s+(?:bana|sana|lütfen)[\s,.;:!?]*$/.exec(kson);
      if (son) govde = govde.slice(0, son.index);
    }
    govde = govde.replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '').trim();
    return { govde, onekNot };
  }

  /**
   * Mesajı ayrıştırıp görevi kaydeder; WhatsApp cevap metnini döndürür.
   * Hata → null (bot normal akışına devam eder) + logger.warn.
   */
  async islemYap(k: GorevKimlik, metin: string, secenek: GorevIslemSecenek = {}): Promise<string | null> {
    try {
      const { govde, onekNot } = GorevWhatsappService.onekiAyir(metin);
      if (!govde) {
        return 'Görev metni boş. Örnek: "görev ekle: Öz Ela KDV kontrolü yarın 10:00" ya da "not: SİLBER Luca\'da açılmadı".';
      }
      const simdi = secenek.simdi ?? new Date();
      const bugunIst = istanbulDuvarSaati(simdi);
      const mukellefler = await this.mukellefler(k.tenantId);
      const sonuc = ayristir(govde, mukellefler, bugunIst);
      const baslik = (sonuc.baslik || govde).trim();
      if (!baslik) return null;

      const tur: 'GOREV' | 'NOT' = onekNot || sonuc.tur === 'NOT' ? 'NOT' : 'GOREV';
      const kategori = sonuc.kategori || 'DIGER';
      const oncelik = sonuc.oncelik || 'MEDIUM';
      const saat = sonuc.saat;
      const dueDate = sonuc.tarih ? vadeTarihi(sonuc.tarih, saat) : null;
      const mukellef = sonuc.mukellef;

      const data = {
        tenantId: k.tenantId,
        createdById: k.userId,
        title: baslik,
        description: null,
        category: kategori,
        priority: oncelik,
        tags: [] as string[],
        taxpayerId: mukellef ? mukellef.id : null,
        dueDate,
        dueTime: saat || null, // portal AkilliGiris ile aynı: saat varsa yazılır
        allDay: !saat,
        kaynak: 'WHATSAPP',
        tur,
        notifyInApp: true,
        notifyBrowser: true,
        notifyWhatsapp: true,
        notifyPush: true,
        notifyEmail: false,
      };

      if (!secenek.kuru) {
        await this.db.task.create({ data });
        this.logger.log(`[GorevWhatsapp] ${tur} eklendi: "${baslik.slice(0, 60)}" vade=${sonuc.tarih || '-'} ${saat || ''} mukellef=${mukellef?.id || '-'}`);
      }

      const cevap = this.cevapMetni(sonuc, { tur, baslik, kategori, oncelik, mukellefAd: mukellef ? mukellef.ad : null }, bugunIst);
      return secenek.kuru ? `KURU TEST (kaydedilmedi)\n${cevap}` : cevap;
    } catch (e: any) {
      this.logger.warn(`[GorevWhatsapp] islem hatasi: ${e?.message || e}`);
      return null;
    }
  }

  /** Portal listesiyle aynı küme: aktif + sanal WhatsApp kayıtları (taxNumber WHATSAPP-*) hariç. */
  private async mukellefler(tenantId: string): Promise<MukellefSecenek[]> {
    const rows: any[] = await this.db.taxpayer.findMany({
      where: { tenantId, isActive: true, taxNumber: { not: { startsWith: 'WHATSAPP-' } } },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
      take: MUKELLEF_TAVANI,
    });
    return (rows || []).map((r) => ({ id: r.id, companyName: r.companyName, firstName: r.firstName, lastName: r.lastName, taxNumber: r.taxNumber }));
  }

  /**
   *   ✅ Görev eklendi
   *   Öz Ela Gıda — Ağustos KDV kontrolü
   *   📅 Yarın 15.09.2026 · 10:00 · KDV Kontrol · Öncelik: ACİL
   *   🔔 Hatırlatma: 1 gün önce 10:00 + vade günü 09:30 (portal + telefon + WhatsApp)
   *   [👤 Mükellef netleşmedi (adaylar: A, B) — portaldan seçebilirsiniz]
   */
  private cevapMetni(
    sonuc: AyristirmaSonucu,
    g: { tur: 'GOREV' | 'NOT'; baslik: string; kategori: string; oncelik: string; mukellefAd: string | null },
    bugunIst: Date,
  ): string {
    const satirlar: string[] = [];
    satirlar.push(g.tur === 'NOT' ? '📝 Not eklendi' : '✅ Görev eklendi');
    satirlar.push(g.mukellefAd ? `${g.mukellefAd} — ${g.baslik}` : g.baslik);

    const etiketler = `${KATEGORI_ETIKET[g.kategori] || g.kategori} · Öncelik: ${ONCELIK_ETIKET[g.oncelik] || g.oncelik}`;
    if (sonuc.tarih) {
      const saat = sonuc.saat;
      satirlar.push(`📅 ${tarihEtiketi(sonuc.tarih, bugunIst)}${saat ? ` · ${saat}` : ''} · ${etiketler}`);
      // gorev-hatirlatma-kurali: ÖNCEDEN = vadeden 1 gün önce (saat varsa aynı saat, yoksa 09:00); VADE = saat varsa 30 dk önce, yoksa 09:00
      const oncedenSaat = saat || VARSAYILAN_HATIRLATMA_SAATI;
      const vadeSaat = saat ? saatGeri(saat, 30) : VARSAYILAN_HATIRLATMA_SAATI;
      const bugunMu = sonuc.tarih === isoGun(bugunIst);
      satirlar.push(
        bugunMu
          ? `🔔 Hatırlatma: vade günü ${vadeSaat} (portal + telefon + WhatsApp)`
          : `🔔 Hatırlatma: 1 gün önce ${oncedenSaat} + vade günü ${vadeSaat} (portal + telefon + WhatsApp)`,
      );
    } else {
      satirlar.push(`📅 Vadesiz (portaldan tarih verebilirsiniz) · ${etiketler}`);
    }

    if (!g.mukellefAd && sonuc.mukellefAdaylar.length > 0) {
      const adlar = sonuc.mukellefAdaylar.slice(0, ADAY_GOSTER).map((a) => a.ad).join(', ');
      satirlar.push(`👤 Mükellef netleşmedi (adaylar: ${adlar}) — portaldan seçebilirsiniz`);
    }
    return satirlar.join('\n');
  }
}
