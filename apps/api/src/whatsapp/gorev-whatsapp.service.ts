import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ayristir, kucult, sadelestir, type MukellefSecenek } from '@mali-musavir/shared';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_DEFAULT } from '../common/max-inference';
import { hatirlatmaOlaylari, istanbulSaat } from '../tasks/gorev-hatirlatma-kurali';
import { istanbulGunu } from '../tasks/gorev-tekrar';

/**
 * WhatsApp'tan GÖREV / HATIRLATMA / NOT ekleme (owner hattı) — 2026-09-14, Muzaffer Bey isteği:
 * "dışarıdayım, aklıma bir şey geldi; bota 'görev ekle …' / '… günü hatırlat' dediğimde Görevler'e
 *  aynen portaldaki akıllı giriş gibi eklesin."
 *
 * Ayrıştırıcı portalla ORTAK: packages/shared/src/gorev-akilli-giris.ts (`ayristir`). Bu servis yalnız
 *   1) KATI kapı (gorevIstegiMi) — açık işaret yoksa mesaj bu modüle GİRMEZ (bütçe / iletme / fatura kes karışmasın),
 *   2) önek temizliği + ayrıştırma + tasks tablosuna kayıt (portal create() ile aynı alanlar),
 *   3) kısa Türkçe WhatsApp cevabı
 * yapar. Başlık/açıklama/kategori/tür için Max düzeltmesi (yapilandir): serbest cümle düzgün göreve dönüşür; Max yoksa kural sonucu.
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


/** Ayrıştırma sonucu — kural + (varsa) Max düzeltmesi birleşmiş hâli. */
export interface GorevYapisi {
  baslik: string;
  aciklama: string | null;
  tarih: string | null; // YYYY-MM-DD (İstanbul günü)
  saat: string | null; // HH:mm
  kategori: string;
  oncelik: string;
  mukellefId: string | null;
  mukellefAd: string | null;
  tur: 'GOREV' | 'NOT';
  /** Max düzeltmesi uygulandı mı (raporda/logda görünür) */
  ai: boolean;
}

const CIZGI = '━━━━━━━━━━━━━━━━━━━━';
const IMZA = () => `${String(process.env.MOREN_BOT_NAME || 'Elif').trim() || 'Elif'} · Moren Ofis Asistanı`;
const KATEGORI_KODLARI = Object.keys(KATEGORI_ETIKET);
const ONCELIK_KODLARI = Object.keys(ONCELIK_ETIKET);

/** İlk harf büyük (tr-TR), gerisi olduğu gibi. */
function ilkHarfBuyuk(s: string): string {
  const t = String(s || '').trim();
  return t ? t.charAt(0).toLocaleUpperCase('tr-TR') + t.slice(1) : t;
}

/** Model çıktısından JSON gövdesini ayıkla (kod çiti / açıklama olsa da). */
function jsonAyikla(metin: string): any | null {
  const t = String(metin || '').replace(/```(?:json)?/gi, '').trim();
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(t.slice(i, j + 1));
  } catch {
    return null;
  }
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
   * Mesajı ayrıştırır (kural + Max düzeltmesi), görevi kaydeder; WhatsApp cevap metnini döndürür.
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
      const yapi = await this.yapilandir(govde, onekNot, mukellefler, bugunIst);
      if (!yapi.baslik) return null;

      const dueDate = yapi.tarih ? vadeTarihi(yapi.tarih, yapi.saat) : null;
      const data = {
        tenantId: k.tenantId,
        createdById: k.userId,
        title: yapi.baslik,
        description: yapi.aciklama,
        category: yapi.kategori,
        priority: yapi.oncelik,
        tags: [] as string[],
        taxpayerId: yapi.mukellefId,
        dueDate,
        dueTime: yapi.saat || null, // portal AkilliGiris ile aynı: saat varsa yazılır
        allDay: !yapi.saat,
        kaynak: 'WHATSAPP',
        tur: yapi.tur,
        notifyInApp: true,
        notifyBrowser: true,
        notifyWhatsapp: true,
        notifyPush: true,
        notifyEmail: false,
      };

      if (!secenek.kuru) {
        await this.db.task.create({ data });
        this.logger.log(`[GorevWhatsapp] ${yapi.tur} eklendi${yapi.ai ? ' (Max düzeltmeli)' : ''}: "${yapi.baslik.slice(0, 60)}" vade=${yapi.tarih || '-'} ${yapi.saat || ''} mukellef=${yapi.mukellefId || '-'}`);
      }

      const adaylar = yapi.mukellefId ? [] : ayristir(govde, mukellefler, bugunIst).mukellefAdaylar.slice(0, ADAY_GOSTER).map((a) => a.ad);
      const cevap = this.cevapMetni(yapi, adaylar, bugunIst, simdi);
      return secenek.kuru ? `KURU TEST (kaydedilmedi)\n${cevap}` : cevap;
    } catch (e: any) {
      this.logger.warn(`[GorevWhatsapp] islem hatasi: ${e?.message || e}`);
      return null;
    }
  }

  /**
   * Kural ayrıştırıcısı (tarih/saat/mükellef adayı/kategori/öncelik) + Max düzeltmesi (başlık/açıklama/kategori/tür):
   * serbest konuşma ("… kontrol etmemi hatırlat portala da ekle") düzgün bir görev başlığına dönüşsün, hitap kalıntıları
   * ("bana", "bunu", "portala da ekle") başlığa girmesin, mükellef adı başlıkta tekrar etmesin. Max yoksa/başarısızsa kural
   * sonucu (ilk harfi büyütülmüş) kullanılır. Mükellef YALNIZ kuralın bulduğu adaylar arasından seçilir (uydurma yok).
   */
  async yapilandir(govde: string, onekNot: boolean, mukellefler: MukellefSecenek[], bugunIst: Date): Promise<GorevYapisi> {
    const sonuc = ayristir(govde, mukellefler, bugunIst);
    const kural: GorevYapisi = {
      baslik: ilkHarfBuyuk((sonuc.baslik || govde).trim()),
      aciklama: null,
      tarih: sonuc.tarih,
      saat: sonuc.saat,
      kategori: sonuc.kategori || 'DIGER',
      oncelik: sonuc.oncelik || 'MEDIUM',
      mukellefId: sonuc.mukellef ? sonuc.mukellef.id : null,
      mukellefAd: sonuc.mukellef ? sonuc.mukellef.ad : null,
      tur: onekNot || sonuc.tur === 'NOT' ? 'NOT' : 'GOREV',
      ai: false,
    };
    if (!isMaxAvailable()) return kural;

    // Adaylar: net eşleşme + kuralın bulduğu adaylar (en çok 6) — model yalnız bunlardan seçebilir
    const adaylar: Array<{ id: string; ad: string }> = [];
    if (sonuc.mukellef) adaylar.push({ id: sonuc.mukellef.id, ad: sonuc.mukellef.ad });
    for (const a of sonuc.mukellefAdaylar.slice(0, 6)) if (!adaylar.some((x) => x.id === a.id)) adaylar.push({ id: a.id, ad: a.ad });

    const bugun = isoGun(bugunIst);
    const gunAdi = GUN_ADLARI[bugunIst.getDay()];
    try {
      const r = await claudeTextViaMax({
        model: MAX_MODEL_DEFAULT,
        timeoutMs: 45000,
        system:
          'Bir mali müşavirlik ofisinin asistanısın. Ofis sahibinin WhatsApp\'tan serbest cümleyle yazdığı görev/hatırlatma/not isteğini ' +
          'yapılandırılmış göreve çeviriyorsun. SADECE geçerli JSON döndür; açıklama yazma. Emin olmadığın alanı null bırak, UYDURMA.',
        prompt: [
          `Bugün: ${bugun} (${gunAdi}), saat ${String(bugunIst.getHours()).padStart(2, '0')}:${String(bugunIst.getMinutes()).padStart(2, '0')} (İstanbul).`,
          '',
          'SAHİBİN MESAJI (önek/hitap temizlenmiş):',
          govde,
          '',
          'KURAL AYRIŞTIRICISININ TAHMİNİ (ipucu; yanlışsa düzelt):',
          `tarih=${sonuc.tarih || 'null'} saat=${sonuc.saat || 'null'} kategori=${sonuc.kategori || 'null'} oncelik=${sonuc.oncelik || 'null'} tur=${kural.tur}`,
          '',
          'MÜKELLEF ADAYLARI (id · ad) — mükellef YALNIZ bunlardan seçilebilir; hiçbiri değilse null:',
          ...(adaylar.length ? adaylar.map((a) => `${a.id} · ${a.ad}`) : ['(aday yok)']),
          '',
          `KATEGORİ KODLARI: ${KATEGORI_KODLARI.join(' | ')} (${KATEGORI_KODLARI.map((c) => `${c}=${KATEGORI_ETIKET[c]}`).join(', ')})`,
          `ÖNCELİK KODLARI: ${ONCELIK_KODLARI.join(' | ')} (acil/ivedi→URGENT, önemli→HIGH, belirtilmemiş→MEDIUM)`,
          '',
          'KURALLAR:',
          '- baslik: kısa (en çok 80 karakter), düzgün Türkçe, ilk harf büyük, emir ya da isim kipi ("Mükelleflerin sermaye tutarlarını kontrol et", "Ceza ihbarnamelerine uzlaşma/indirim talebi").',
          '  Bota hitap kalıntıları ("bana", "bunu", "hatırlat", "portala da ekle", "lütfen") başlığa GİRMEZ. Mükellef seçildiyse adı başlıkta TEKRAR ETMEZ.',
          '- aciklama: isteğin tam anlamını koruyan tek düzgün cümle (bağlam kaybolmasın); gerekmiyorsa null.',
          '- tarih: mesajdaki göreli ifadeye göre YYYY-MM-DD ("yarın", "cuma", "ayın 20\'si", "3 gün sonra" — bugüne göre hesapla); yoksa null. saat: HH:mm ya da null.',
          '- tur: "not:" ile başladıysa ya da yapılacak iş değil bilgi kaydıysa NOT, yoksa GOREV.',
          '',
          'ŞEMA: {"baslik":string,"aciklama":string|null,"tarih":"YYYY-MM-DD"|null,"saat":"HH:mm"|null,"kategori":string,"oncelik":string,"mukellefId":string|null,"tur":"GOREV"|"NOT"}',
        ].join('\n'),
      });
      if (!r.ok) {
        this.logger.warn(`[GorevWhatsapp] Max düzeltmesi başarısız, kural sonucu kullanılıyor: ${r.error || '-'}`);
        return kural;
      }
      const j = jsonAyikla(r.text);
      if (!j || typeof j !== 'object') return kural;

      const baslik = ilkHarfBuyuk(String(j.baslik || '').replace(/\s+/g, ' ').trim()).slice(0, 120);
      const tarih = typeof j.tarih === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.tarih) ? j.tarih : kural.tarih;
      const saat = typeof j.saat === 'string' && /^\d{2}:\d{2}$/.test(j.saat) ? j.saat : kural.saat;
      const kategori = KATEGORI_KODLARI.includes(String(j.kategori)) ? String(j.kategori) : kural.kategori;
      const oncelik = ONCELIK_KODLARI.includes(String(j.oncelik)) ? String(j.oncelik) : kural.oncelik;
      const aday = adaylar.find((a) => a.id === String(j.mukellefId || ''));
      const mukellefId = aday ? aday.id : j.mukellefId === null ? null : kural.mukellefId;
      const mukellefAd = aday ? aday.ad : j.mukellefId === null ? null : kural.mukellefAd;
      const aciklama = typeof j.aciklama === 'string' && j.aciklama.trim() ? j.aciklama.trim().slice(0, 600) : null;
      const tur: 'GOREV' | 'NOT' = onekNot ? 'NOT' : j.tur === 'NOT' ? 'NOT' : 'GOREV';
      return { baslik: baslik || kural.baslik, aciklama, tarih, saat, kategori, oncelik, mukellefId, mukellefAd, tur, ai: true };
    } catch (e: any) {
      this.logger.warn(`[GorevWhatsapp] Max düzeltmesi hata: ${e?.message || e}`);
      return kural;
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

  /** Gelecekteki hatırlatma anları (gorev-hatirlatma-kurali ile aynı kural), en çok 2; "yarın 09:00", "17.09 13:30" */
  private hatirlatmaPlani(yapi: GorevYapisi, bugunIst: Date, simdi: Date): string {
    if (!yapi.tarih) return '';
    const vade = vadeTarihi(yapi.tarih, null);
    if (!vade) return '';
    const olaylar = hatirlatmaOlaylari(
      { id: 'x', title: yapi.baslik, status: 'OPEN', dueDate: vade, dueTime: yapi.saat, priority: yapi.oncelik },
      istanbulSaat(istanbulGunu(vade), 23, 59), // vade günü gece: TÜM önceden + vade olayları üretilir (gecikme yok)
    ).filter((o) => o.tip !== 'GECIKME' && o.planlanan.getTime() > simdi.getTime());
    if (!olaylar.length) return 'vade geçince gecikme uyarısı';
    const yarin = isoGun(gunEkle(bugunIst, 1));
    const bugun = isoGun(bugunIst);
    const anlar = olaylar.slice(0, 2).map((o) => {
      const p = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(o.planlanan);
      const al = (t: string) => p.find((x) => x.type === t)?.value || '';
      const gun = `${al('year')}-${al('month')}-${al('day')}`;
      const on = gun === bugun ? 'bugün' : gun === yarin ? 'yarın' : `${al('day')}.${al('month')}`;
      return `${on} ${al('hour')}:${al('minute')}`;
    });
    return anlar.join(' ve ');
  }

  /**
   *   ✅ *Görev eklendi*
   *   ━━━━━━━━━━━━━━━━━━━━
   *   *Öz Ela Turizm* — Ceza ihbarnamelerine uzlaşma / indirim talebi
   *   Yarın, Salı 15.09.2026 · Diğer
   *   _Öz Ela Turizm'in gelen ceza ihbarnamelerine uzlaşma ya da indirim talep edilecek._
   *
   *   🔔 Hatırlatma: yarın 09:00 → portal · telefon · WhatsApp
   *   ━━━━━━━━━━━━━━━━━━━━
   *   _Elif · Moren Ofis Asistanı_
   */
  private cevapMetni(yapi: GorevYapisi, adaylar: string[], bugunIst: Date, simdi: Date): string {
    const s: string[] = [];
    s.push(yapi.tur === 'NOT' ? '📝 *Not eklendi*' : '✅ *Görev eklendi*');
    s.push(CIZGI);
    s.push(yapi.mukellefAd ? `*${yapi.mukellefAd}* — ${yapi.baslik}` : `*${yapi.baslik}*`);
    const parcalar: string[] = [];
    if (yapi.tarih) parcalar.push(`${tarihEtiketi(yapi.tarih, bugunIst)}${yapi.saat ? ' ' + yapi.saat : ''}`);
    else if (yapi.tur === 'GOREV') parcalar.push('Vadesiz');
    if (yapi.oncelik === 'URGENT') parcalar.push('🔴 Acil');
    else if (yapi.oncelik === 'HIGH') parcalar.push('Yüksek');
    parcalar.push(KATEGORI_ETIKET[yapi.kategori] || yapi.kategori);
    s.push(parcalar.join(' · '));
    if (yapi.aciklama) s.push(`_${yapi.aciklama}_`);
    if (yapi.tur === 'GOREV') {
      s.push('');
      const plan = yapi.tarih ? this.hatirlatmaPlani(yapi, bugunIst, simdi) : '';
      s.push(yapi.tarih ? `🔔 Hatırlatma: ${plan || '—'} → portal · telefon · WhatsApp` : '🔔 Vade verilmedi — portaldan tarih ekleyince hatırlatma kurulur');
    }
    if (!yapi.mukellefId && adaylar.length) s.push(`👤 Mükellef netleşmedi — adaylar: ${adaylar.join(', ')} (portaldan seçin)`);
    s.push(CIZGI);
    s.push(`_${IMZA()}_`);
    return s.join('\n');
  }
}
