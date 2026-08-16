import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ButceService, Kimlik } from './butce.service';
import { ButceAiService } from './butce-ai.service';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_DEFAULT } from '../common/max-inference';

/**
 * WhatsApp üzerinden bütçe yönetimi — yazarak kayıt, sorgu ve düzeltme.
 *
 * Kapsanan işlemler:
 *   Kayıt      : gider, gelir, kart ekstre tutarı, kart ödemesi, kredi/borç ödemesi
 *   Planlama   : beklenen tahsilat/ödeme (planlanan), düzenli kalem tanımı
 *   Tanım      : yeni kredi kartı, banka hesabı, kredi/borç, kategori
 *   Para hareketi: hesaplar arası aktarım, ofisten şahsiye çekiş
 *   Düzeltme   : son kaydı sil, beklenen kaydı gerçekleşti yap
 *   Sorgu      : borç durumu, bugünkü ödemeler, nakit durumu, harcama analizi
 *
 * Neden AI ayrıştırma: "dün akşam 3 bin lira yakıt aldım" gibi serbest cümleleri
 * kalıpla yakalamak kırılgan olurdu. Model YALNIZ ayrıştırır; doğrulama ve kayıt
 * kodda yapılır — uydurulan kart/kategori eşleşmezse kayıt oluşmaz.
 */
@Injectable()
export class ButceWhatsappService {
  private readonly logger = new Logger(ButceWhatsappService.name);

  constructor(
    private prisma: PrismaService,
    private butce: ButceService,
    private ai: ButceAiService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  /** Ucuz ön kapı: bütçeyle ilgisiz mesajlar AI'ya gitmesin */
  static butceIstegiMi(metin: string): boolean {
    const t = String(metin || '').toLocaleLowerCase('tr-TR');
    if (t.length < 5) return false;
    const anahtarlar = [
      /harca(ma|d[ıi]m)/,
      /gider/,
      /gelir/,
      /tahsilat/,
      /[öo]de(d[ıi]m|me|yece[ğg]im)/,
      /kaydet/,
      /\bi[şs]le\b/,
      /bor[cç]/,
      /ekstre/,
      /kredi kart/,
      /\bkart[ıi]n/,
      /taksit/,
      /kmh|ek hesap/,
      /nakit/,
      /b[üu]t[çc]e/,
      /aktar|transfer|[çc]ek(tim|i[şs])/,
      /d[üu]zenli|her ay/,
      /hesap (a[çc]|ekle)/,
      /kategori/,
      /son kayd[ıi] sil|yanl[ıi][şs] girdim/,
      /ne kadar (borcum|param|harcad[ıi]m)/,
      /bug[üu]n ne [öo]dem/,
      /param var m[ıi]/,
    ];
    return anahtarlar.some((re) => re.test(t));
  }

  /** Mesajı işler; bütçe isteği değilse null döner (bot normal akışına devam eder) */
  async islemYap(k: Kimlik, metin: string): Promise<string | null> {
    if (!ButceWhatsappService.butceIstegiMi(metin)) return null;
    if (!isMaxAvailable()) return null;

    const [kategoriler, kartlar, hesaplar, borclar] = await Promise.all([
      this.butce.kategoriler(k),
      this.butce.kartlar(k),
      this.butce.bankaHesaplar(k),
      this.butce.borclar(k),
    ]);

    const c = await this.ayristir(metin, kategoriler, kartlar, hesaplar, borclar);
    if (!c) return null;

    try {
      switch (c.islem) {
        case 'GIDER':
        case 'GELIR':
          return await this.islemKaydet(k, c, kategoriler, kartlar, hesaplar);
        case 'PLANLANAN':
          return await this.planlananKaydet(k, c, kategoriler, hesaplar);
        case 'EKSTRE_TUTAR':
          return await this.ekstreTutarKaydet(k, c, kartlar);
        case 'KART_ODEME':
          return await this.kartOdemeKaydet(k, c, kartlar, hesaplar);
        case 'BORC_ODEME':
          return await this.borcOdemeKaydet(k, c, borclar, hesaplar);
        case 'TRANSFER':
          return await this.transferKaydet(k, c, hesaplar);
        case 'DUZENLI_EKLE':
          return await this.duzenliEkle(k, c, kategoriler);
        case 'KART_EKLE':
          return await this.kartEkle(k, c);
        case 'HESAP_EKLE':
          return await this.hesapEkle(k, c);
        case 'BORC_EKLE':
          return await this.borcEkle(k, c);
        case 'KATEGORI_EKLE':
          return await this.kategoriEkle(k, c);
        case 'SON_KAYDI_SIL':
          return await this.sonKaydiSil(k);
        case 'SORGU':
          return await this.sorguCevapla(k, metin);
        default:
          return null;
      }
    } catch (e: any) {
      this.logger.warn(`[ButceWhatsapp] ${c.islem} hatası: ${e?.message || e}`);
      return `İşlem yapılamadı: ${e?.message || 'bilinmeyen hata'}`;
    }
  }

  /* ===================== AYRIŞTIRMA ===================== */

  private jsonAyikla(text: string): any | null {
    const t = String(text || '').trim();
    const blok = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
    const aday = blok ? blok[1] : t;
    const bas = aday.indexOf('{');
    const son = aday.lastIndexOf('}');
    if (bas < 0 || son <= bas) return null;
    try {
      return JSON.parse(aday.slice(bas, son + 1));
    } catch {
      return null;
    }
  }

  private async ayristir(
    metin: string,
    kategoriler: any[],
    kartlar: any[],
    hesaplar: any[],
    borclar: any[],
  ) {
    const bugun = new Date().toISOString().slice(0, 10);
    const sonuc = await claudeTextViaMax({
      model: MAX_MODEL_DEFAULT,
      timeoutMs: 60000,
      system:
        'Kişisel bütçe isteklerini yapılandırılmış veriye çeviren bir ayrıştırıcısın. ' +
        'SADECE geçerli JSON döndür, açıklama yazma. Emin olmadığın alanı null bırak, UYDURMA.',
      prompt: [
        `Bugün: ${bugun}`,
        '',
        'KATEGORİLER (id · defter · tür · ad):',
        ...(kategoriler.length ? kategoriler.map((c) => `${c.id} · ${c.defter} · ${c.tur} · ${c.ad}`) : ['(yok)']),
        '',
        'KREDİ KARTLARI (id · banka · kart):',
        ...(kartlar.length ? kartlar.map((c: any) => `${c.id} · ${c.bankaAdi} · ${c.kartAdi}`) : ['(yok)']),
        '',
        'BANKA HESAPLARI (id · banka · ad):',
        ...(hesaplar.length ? hesaplar.map((h: any) => `${h.id} · ${h.bankaAdi} · ${h.ad}`) : ['(yok)']),
        '',
        'KREDİ/BORÇLAR (id · ad · taksit):',
        ...(borclar.length ? borclar.map((b: any) => `${b.id} · ${b.ad} · ${b.taksitTutari}`) : ['(yok)']),
        '',
        'KULLANICININ MESAJI:',
        metin,
        '',
        'Şu JSON şemasında döndür:',
        '{',
        ' "islem":"GIDER"|"GELIR"|"PLANLANAN"|"EKSTRE_TUTAR"|"KART_ODEME"|"BORC_ODEME"|"TRANSFER"',
        '        |"DUZENLI_EKLE"|"KART_EKLE"|"HESAP_EKLE"|"BORC_EKLE"|"KATEGORI_EKLE"|"SON_KAYDI_SIL"|"SORGU"|"BILINMIYOR",',
        ' "tutar":number|null, "tarih":"YYYY-MM-DD"|null, "defter":"SAHSI"|"OFIS"|null,',
        ' "kategoriId":string|null, "kartId":string|null, "bankaHesapId":string|null, "borcId":string|null,',
        ' "hedefHesapId":string|null, "kaynakDefter":"SAHSI"|"OFIS"|null, "hedefDefter":"SAHSI"|"OFIS"|null,',
        ' "kaynak":"NAKIT"|"BANKA"|"KART"|null, "aciklama":string|null,',
        ' "ad":string|null, "banka":string|null, "kesimGunu":number|null, "sonOdemeGunFarki":number|null,',
        ' "kartLimiti":number|null, "kmhLimiti":number|null, "aylikFaiz":number|null, "yillikFaiz":number|null,',
        ' "taksitTutari":number|null, "toplamTaksit":number|null, "ayinGunu":number|null, "tur":"GELIR"|"GIDER"|null,',
        ' "guven":0-1',
        '}',
        '',
        'İŞLEM SEÇİMİ:',
        '- Yapılmış harcama/gelir → GIDER veya GELIR.',
        '- Gelecek tarihli, henüz gerçekleşmemiş ("gelecek", "yatacak", "ödeyeceğim") → PLANLANAN (tur alanını doldur).',
        '- "kartın borç tutarı X" / "ekstre X TL geldi" → EKSTRE_TUTAR.',
        '- "karta X ödedim" → KART_ODEME. "krediye/taksite X ödedim" → BORC_ODEME.',
        '- "hesaptan hesaba aktardım", "bankadan para çektim" → TRANSFER.',
        '- "her ayın X inde Y TL kira" → DUZENLI_EKLE.',
        '- "X bankasından kart ekle/tanımla", kesim günü verilirse → KART_EKLE.',
        '- "X bankasında hesap aç/tanımla", KMH limiti verilirse → HESAP_EKLE.',
        '- "X TL kredi çektim, taksiti Y" → BORC_EKLE.',
        '- "X diye kategori ekle" → KATEGORI_EKLE.',
        '- "son kaydı sil", "yanlış girdim sil" → SON_KAYDI_SIL.',
        '- Soru soruyorsa (ne kadar borcum var, bugün ne ödemem var, ne kadar harcadım) → SORGU.',
        '- Bütçeyle ilgisizse → BILINMIYOR, guven 0.',
        '',
        'KURALLAR:',
        '- defter alanı YALNIZ GİDER kayıtlarında anlamlıdır. GELİR kaydında defter null bırak;',
        '  şahıs firmasında gelir tek havuzdur, ofis geliri ile kişisel gelir ayrımı YOKTUR.',
        '- Gider ofis işiyse (ofis kirası, personel, SGK, kırtasiye, yazılım) → defter OFIS.',
        '- Gider kişiselse (market, yakıt, giyim, yemek, ev kirası) → defter SAHSI.',
        '- Tarih söylenmemişse bugün. "dün" bir gün önce, "önceki gün" iki gün önce.',
        '- Kategoriyi listeden SEÇ; uygun yoksa null.',
        '- Tutarı rakama çevir: "3 bin"=3000, "12,5 bin"=12500, "1 milyon"=1000000.',
      ].join('\n'),
    });
    if (!sonuc.ok) return null;
    const veri = this.jsonAyikla(sonuc.text);
    if (!veri || veri.islem === 'BILINMIYOR') return null;
    if (!(Number(veri.guven ?? 1) >= 0.5)) return null;
    return veri;
  }

  /* ===================== ORTAK ===================== */

  private para(n: number) {
    return `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  }

  private tarihTR(d: any) {
    return new Date(d).toLocaleDateString('tr-TR');
  }

  private defterAdi(d: string) {
    return d === 'OFIS' ? 'Ofis' : 'Şahsi';
  }

  private basarili(baslik: string, satirlar: Array<string | false | null | undefined>, not?: string) {
    return ['✅ ' + baslik, '', ...satirlar.filter(Boolean), ...(not ? ['', `_${not}_`] : [])].join('\n');
  }

  /* ===================== KAYIT İŞLEMLERİ ===================== */

  private async islemKaydet(k: Kimlik, c: any, kategoriler: any[], kartlar: any[], hesaplar: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Tutarı anlayamadım. Örnek: "850 TL market harcaması yaptım".';

    const kategori = kategoriler.find((x: any) => x.id === c.kategoriId) || null;
    const defter = c.defter === 'OFIS' || c.defter === 'SAHSI' ? c.defter : kategori?.defter || 'SAHSI';
    const kart = kartlar.find((x: any) => x.id === c.kartId) || null;
    const hesap = hesaplar.find((x: any) => x.id === c.bankaHesapId) || null;
    const kaynak = kart ? 'KART' : hesap ? 'BANKA' : 'NAKIT';

    const kayit = await this.butce.islemKaydet(k, {
      tur: c.islem,
      tutar,
      tarih: c.tarih || new Date().toISOString().slice(0, 10),
      defter,
      kategoriId: kategori?.id || null,
      aciklama: c.aciklama || null,
      kaynak,
      kartId: kart?.id || null,
      bankaHesapId: hesap?.id || null,
    });

    return this.basarili(
      `${c.islem === 'GELIR' ? 'Gelir' : 'Gider'} kaydedildi`,
      [
        `Tutar: *${this.para(tutar)}*`,
        `Tarih: ${this.tarihTR(kayit.tarih)}`,
        // Gelir tek havuzdur; defter yalnız giderde anlamlıdır
        c.islem === 'GIDER' ? `Gider türü: ${this.defterAdi(defter)}` : '',
        `Kategori: ${kategori?.ad || '⚠️ seçilmedi'}`,
        kart ? `Kart: ${kart.bankaAdi} ${kart.kartAdi}` : hesap ? `Hesap: ${hesap.bankaAdi} ${hesap.ad}` : 'Kaynak: Nakit',
        c.aciklama ? `Açıklama: ${c.aciklama}` : '',
      ],
      'Yanlışsa "son kaydı sil" yazın.',
    );
  }

  private async planlananKaydet(k: Kimlik, c: any, kategoriler: any[], hesaplar: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Beklenen tutarı anlayamadım.';
    const tur = c.tur === 'GIDER' ? 'GIDER' : 'GELIR';
    const kategori = kategoriler.find((x: any) => x.id === c.kategoriId) || null;
    const hesap = hesaplar.find((x: any) => x.id === c.bankaHesapId) || null;

    const kayit = await this.butce.islemKaydet(k, {
      tur,
      tutar,
      tarih: c.tarih || new Date().toISOString().slice(0, 10),
      defter: c.defter || kategori?.defter || 'SAHSI',
      kategoriId: kategori?.id || null,
      aciklama: c.aciklama || null,
      kaynak: hesap ? 'BANKA' : 'NAKIT',
      bankaHesapId: hesap?.id || null,
      planlanan: true,
    });

    return this.basarili(
      `Beklenen ${tur === 'GELIR' ? 'tahsilat' : 'ödeme'} eklendi`,
      [
        `Tutar: *${this.para(tutar)}*`,
        `Beklenen tarih: ${this.tarihTR(kayit.tarih)}`,
        tur === 'GIDER' ? `Gider türü: ${this.defterAdi(kayit.defter)}` : '',
        c.aciklama ? `Açıklama: ${c.aciklama}` : '',
      ],
      'Nakit akışı takviminde görünecek. Gerçekleşince "geldi" diye yazın.',
    );
  }

  private async ekstreTutarKaydet(k: Kimlik, c: any, kartlar: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar >= 0)) return 'Borç tutarını anlayamadım.';
    const kart = kartlar.find((x: any) => x.id === c.kartId);
    if (!kart) {
      return kartlar.length
        ? `Hangi kart olduğunu anlayamadım. Kartlarınız: ${kartlar.map((x: any) => x.bankaAdi).join(', ')}`
        : 'Tanımlı kredi kartınız yok. Önce kart ekleyin.';
    }

    const ekstre =
      kart.ekstreler?.find((e: any) => e.borcTutari === null && !e.kesilmedi) ||
      kart.ekstreler?.find((e: any) => !e.kesilmedi) ||
      kart.guncelEkstre;
    if (!ekstre) return `${kart.bankaAdi} ${kart.kartAdi} için açık ekstre bulunamadı.`;

    const guncel = await this.butce.ekstreTutarGir(k, ekstre.id, { borcTutari: tutar });
    return this.basarili(
      'Ekstre tutarı kaydedildi',
      [
        `Kart: ${kart.bankaAdi} — ${kart.kartAdi}`,
        `Dönem: ${ekstre.donem}`,
        `Borç: *${this.para(tutar)}*`,
        `Asgari ödeme: ${this.para(Number(guncel.asgariTutar) || 0)}`,
        `Son ödeme: ${this.tarihTR(ekstre.sonOdemeTarihi)}`,
      ],
      'Ekstre PDF’ini yüklerseniz harcamalar kalem kalem de işlenir.',
    );
  }

  private async kartOdemeKaydet(k: Kimlik, c: any, kartlar: any[], hesaplar: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Ödeme tutarını anlayamadım.';
    const kart = kartlar.find((x: any) => x.id === c.kartId);
    if (!kart) return 'Hangi karta ödeme yaptığınızı anlayamadım.';
    const ekstre = kart.borcEkstresi || kart.guncelEkstre;
    if (!ekstre || ekstre.borcTutari === null) {
      return `${kart.bankaAdi} ${kart.kartAdi} için önce ekstre borç tutarını girin.`;
    }
    const hesap = hesaplar.find((x: any) => x.id === c.bankaHesapId) || null;
    const guncel = await this.butce.ekstreOdemeYap(k, ekstre.id, {
      tutar,
      tarih: c.tarih || undefined,
      bankaHesapId: hesap?.id || null,
    });
    return this.basarili('Kart ödemesi işlendi', [
      `Kart: ${kart.bankaAdi} — ${kart.kartAdi}`,
      `Ödenen: *${this.para(tutar)}*`,
      `Kalan borç: ${this.para(Number(guncel.kalanTutar) || 0)}`,
      hesap ? `Hesap: ${hesap.bankaAdi} ${hesap.ad}` : '',
    ]);
  }

  private async borcOdemeKaydet(k: Kimlik, c: any, borclar: any[], hesaplar: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Ödeme tutarını anlayamadım.';
    const borc = borclar.find((x: any) => x.id === c.borcId) || (borclar.length === 1 ? borclar[0] : null);
    if (!borc) {
      return borclar.length
        ? `Hangi kredi olduğunu anlayamadım. Kredileriniz: ${borclar.map((x: any) => x.ad).join(', ')}`
        : 'Tanımlı krediniz yok.';
    }
    const hesap = hesaplar.find((x: any) => x.id === c.bankaHesapId) || null;
    const guncel: any = await this.butce.borcOdemeYap(k, borc.id, {
      tutar,
      tarih: c.tarih || undefined,
      bankaHesapId: hesap?.id || null,
    });
    return this.basarili('Kredi ödemesi işlendi', [
      `Kredi: ${borc.ad}`,
      `Ödenen: *${this.para(tutar)}*`,
      guncel.isleyenFaiz ? `Bunun ${this.para(guncel.isleyenFaiz)} kadarı faiz` : '',
      `Kalan anapara: ${this.para(guncel.kalanAnapara)}`,
      guncel.kalanTaksit ? `Kalan taksit: ${guncel.kalanTaksit} ay` : '',
    ]);
  }

  private async transferKaydet(k: Kimlik, c: any, hesaplar: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Aktarım tutarını anlayamadım.';
    const kaynak = hesaplar.find((x: any) => x.id === c.bankaHesapId) || null;
    const hedef = hesaplar.find((x: any) => x.id === c.hedefHesapId) || null;
    const sonuc = await this.butce.transferYap(k, {
      tutar,
      tarih: c.tarih || undefined,
      kaynakDefter: c.kaynakDefter || 'OFIS',
      hedefDefter: c.hedefDefter || 'SAHSI',
      kaynakHesapId: kaynak?.id || null,
      hedefHesapId: hedef?.id || null,
      aciklama: c.aciklama || null,
    });
    return this.basarili(
      'Aktarım kaydedildi',
      [
        `Tutar: *${this.para(tutar)}*`,
        `${this.defterAdi(c.kaynakDefter || 'OFIS')} → ${this.defterAdi(c.hedefDefter || 'SAHSI')}`,
        kaynak ? `Çıkan hesap: ${kaynak.bankaAdi} ${kaynak.ad}` : '',
        hedef ? `Giren hesap: ${hedef.bankaAdi} ${hedef.ad}` : '',
        `Açıklama: ${sonuc.aciklama}`,
      ],
      'Aktarım gelir/gider sayılmaz, yalnız bakiyeleri değiştirir.',
    );
  }

  private async duzenliEkle(k: Kimlik, c: any, kategoriler: any[]) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Düzenli kalemin tutarını anlayamadım.';
    const gun = Number(c.ayinGunu) || 1;
    const kategori = kategoriler.find((x: any) => x.id === c.kategoriId) || null;
    const kayit = await this.butce.duzenliKaydet(k, {
      ad: c.ad || c.aciklama || 'Düzenli kalem',
      tur: c.tur === 'GELIR' ? 'GELIR' : 'GIDER',
      tutar,
      ayinGunu: gun,
      defter: c.defter || kategori?.defter || 'SAHSI',
      kategoriId: kategori?.id || null,
    });
    return this.basarili(
      'Düzenli kalem eklendi',
      [
        `Ad: ${kayit.ad}`,
        `Tutar: *${this.para(tutar)}*`,
        `Her ayın ${gun}. günü`,
        kayit.tur === 'GIDER' ? `Gider türü: ${this.defterAdi(kayit.defter)}` : '',
        `Kategori: ${kategori?.ad || 'seçilmedi'}`,
      ],
      'Her ay otomatik olarak beklenen kalem şeklinde düşecek.',
    );
  }

  private async kartEkle(k: Kimlik, c: any) {
    if (!c.banka && !c.ad) return 'Kartın bankasını yazar mısınız?';
    if (!c.kesimGunu) return 'Hesap kesim gününü de yazın. Örnek: "Akbank kartı ekle, kesim ayın 22’si".';
    const kart = await this.butce.kartKaydet(k, {
      bankaAdi: c.banka || c.ad,
      kartAdi: c.ad || `${c.banka} kartı`,
      kesimGunu: Number(c.kesimGunu),
      sonOdemeGunFarki: Number(c.sonOdemeGunFarki) || 10,
      kartLimiti: Number(c.kartLimiti) || 0,
      aylikFaizOrani: Number(c.aylikFaiz) || 4.25,
      varsayilanDefter: c.defter || 'SAHSI',
    });
    return this.basarili(
      'Kart eklendi',
      [
        `${kart.bankaAdi} — ${kart.kartAdi}`,
        `Kesim günü: ayın ${kart.kesimGunu}’i`,
        `Son ödeme: kesim + ${kart.sonOdemeGunFarki} gün`,
        kart.kartLimiti ? `Limit: ${this.para(kart.kartLimiti)}` : '',
      ],
      'Kesim günü geldiğinde ekstre hatırlatması göndereceğim.',
    );
  }

  private async hesapEkle(k: Kimlik, c: any) {
    if (!c.banka && !c.ad) return 'Hesabın bankasını yazar mısınız?';
    const hesap = await this.butce.bankaHesapKaydet(k, {
      ad: c.ad || 'Hesap',
      bankaAdi: c.banka || c.ad,
      tur: c.kmhLimiti ? 'KMH' : 'VADESIZ',
      acilisBakiye: Number(c.tutar) || 0,
      kmhLimiti: Number(c.kmhLimiti) || 0,
      kmhAylikFaiz: Number(c.aylikFaiz) || 0,
      varsayilanDefter: c.defter || 'SAHSI',
    });
    return this.basarili(
      'Banka hesabı eklendi',
      [
        `${hesap.bankaAdi} — ${hesap.ad}`,
        `Açılış bakiyesi: ${this.para(hesap.bakiye)}`,
        hesap.kmhLimiti ? `KMH limiti: ${this.para(hesap.kmhLimiti)} (aylık %${hesap.kmhAylikFaiz})` : '',
      ],
      'Bundan sonra banka hareketlerini bu hesaba işleyebilirsiniz.',
    );
  }

  private async borcEkle(k: Kimlik, c: any) {
    const tutar = Number(c.tutar);
    if (!(tutar > 0)) return 'Kredi tutarını anlayamadım.';
    const borc = await this.butce.borcKaydet(k, {
      ad: c.ad || 'Kredi',
      tur: 'IHTIYAC',
      kurum: c.banka || null,
      toplamTutar: tutar,
      kalanAnapara: tutar,
      taksitTutari: Number(c.taksitTutari) || 0,
      toplamTaksit: Number(c.toplamTaksit) || 0,
      yillikFaiz: Number(c.yillikFaiz) || 0,
      odemeGunu: Number(c.ayinGunu) || 1,
      defter: c.defter || 'SAHSI',
    });
    return this.basarili(
      'Kredi eklendi',
      [
        `${borc.ad}${borc.kurum ? ` · ${borc.kurum}` : ''}`,
        `Kalan anapara: *${this.para(borc.kalanAnapara)}*`,
        borc.taksitTutari ? `Aylık taksit: ${this.para(borc.taksitTutari)}` : '',
        borc.toplamTaksit ? `Taksit sayısı: ${borc.toplamTaksit}` : '',
        `Ödeme günü: ayın ${borc.odemeGunu}’i`,
      ],
      borc.yillikFaiz ? undefined : 'Faiz oranını portaldan girerseniz ödeme planı daha doğru hesaplar.',
    );
  }

  private async kategoriEkle(k: Kimlik, c: any) {
    if (!c.ad) return 'Kategori adını yazar mısınız?';
    const kategori = await this.butce.kategoriKaydet(k, {
      ad: c.ad,
      tur: c.tur === 'GELIR' ? 'GELIR' : 'GIDER',
      defter: c.defter || 'SAHSI',
    });
    return this.basarili('Kategori eklendi', [
      `${kategori.ad}`,
      `Tür: ${kategori.tur === 'GELIR' ? 'Gelir' : 'Gider'}`,
      `Defter: ${this.defterAdi(kategori.defter)}`,
    ]);
  }

  /** Son eklenen gelir/gider kaydını siler (yanlış giriş düzeltmesi) */
  private async sonKaydiSil(k: Kimlik) {
    const son = await this.db.butceIslem.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
      orderBy: { createdAt: 'desc' },
      include: { kategori: { select: { ad: true } } },
    });
    if (!son) return 'Silinecek kayıt bulunamadı.';
    await this.butce.islemSil(k, son.id);
    return this.basarili('Son kayıt silindi', [
      `${son.tur === 'GELIR' ? 'Gelir' : 'Gider'}: ${this.para(Number(son.tutar))}`,
      `Tarih: ${this.tarihTR(son.tarih)}`,
      son.kategori?.ad ? `Kategori: ${son.kategori.ad}` : '',
      son.aciklama ? `Açıklama: ${son.aciklama}` : '',
    ]);
  }

  /** Soru — mevcut AI danışmanına yönlendirilir (kendi verisiyle cevaplar) */
  private async sorguCevapla(k: Kimlik, metin: string) {
    const cevap = await this.ai.soru(k, metin);
    return cevap?.icerik || null;
  }
}
