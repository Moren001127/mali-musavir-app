import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import { ButceService, Kimlik } from './butce.service';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_DEFAULT } from '../common/max-inference';
import { asgariTutarHesapla } from './butce-hesap';

/**
 * Kredi kartı ekstresini (PDF) içe aktarma.
 *
 * Akış:
 *   1) PDF → metin (pdf-parse; banka şifreli PDF gönderiyorsa şifre parametresi)
 *   2) Satır çıkarımı: önce kural tabanlı (ücretsiz, hızlı), yetersizse Max ile AI ayrıştırma
 *   3) Kategori ataması: önce SATICI HAFIZASI (kesin), kalanlar için AI önerisi
 *   4) Kullanıcı ekranda düzeltir → düzeltme hafızaya yazılır (bir kez düzelt, bir daha sorma)
 *   5) Onaylanınca hareketler gider işlemi olarak bütçeye işlenir, ekstre borcu güncellenir
 *
 * Not: Kart harcaması NAKİT ÇIKIŞI değildir; kapasite hesabında gider sayılmaz,
 * kartın ekstre borcu olarak borç tarafında görünür. Nakit çıkışı ekstre ödemesidir.
 */
@Injectable()
export class ButceEkstreImportService {
  private readonly logger = new Logger(ButceEkstreImportService.name);

  constructor(
    private prisma: PrismaService,
    private butce: ButceService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  /* ===================== METİN ===================== */

  private async pdfMetin(buffer: Buffer, sifre?: string): Promise<string> {
    const parser = new PDFParse(
      sifre ? ({ data: buffer, password: sifre } as any) : ({ data: buffer } as any),
    );
    try {
      const r = await parser.getText();
      return String(r?.text || '');
    } finally {
      const destroy = (parser as any).destroy;
      if (typeof destroy === 'function') await destroy.call(parser).catch(() => {});
    }
  }

  /** "1.234,56" / "-1.234,56" / "1234.56" → number */
  private paraCevir(s: string): number | null {
    const raw = String(s || '').trim().replace(/\s/g, '');
    if (!raw) return null;
    const eksi = /^-/.test(raw) || /-$/.test(raw);
    const temiz = raw.replace(/[^\d.,]/g, '');
    if (!temiz) return null;
    let n: number;
    if (temiz.includes(',')) n = Number(temiz.replace(/\./g, '').replace(',', '.'));
    else n = Number(temiz);
    if (!Number.isFinite(n)) return null;
    return Math.round((eksi ? -n : n) * 100) / 100;
  }

  /** Satıcı anahtarı: açıklamadan şube/şehir/numara gürültüsünü atar */
  static saticiAnahtari(aciklama: string): string {
    // Türkçe yerel küçültme I→ı yaptığı için satıcı adları bozuluyordu (MIGROS→mıgros).
    // Anahtar yalnız kendi içinde tutarlı olmalı; düz küçültme yeterli ve öngörülebilir.
    let s = String(aciklama || '')
      .toLowerCase()
      .replace(/[0-9]+/g, ' ')
      .replace(/[*\-_/\\.,:;()]+/g, ' ')
      .replace(/\b(a\.?s|ltd|sti|şti|tic|san|ve|as|inc|com|tr|tl)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parcalar = s.split(' ').filter((p) => p.length > 1);
    return parcalar.slice(0, 3).join(' ').trim();
  }

  /* ===================== KURAL TABANLI AYRIŞTIRMA ===================== */

  /**
   * Ekstrede hareket SAYILMAYAN satırlar. Bunlar bütçeye harcama olarak yazılırsa
   * ay iki kez şişer: "ödeme/teşekkür" satırı zaten yapılmış ödemedir, "devir" satırı
   * ise önceki ayın bakiyesidir ve yeni dönem borcunun içinde zaten vardır.
   */
  private static readonly HAREKET_DEGIL = [
    /[öo]deme.*te[şs]ekk[üu]r/i,
    /te[şs]ekk[üu]r ederiz/i,
    /yap[ıi]lan [öo]deme/i,
    /[öo]nceki d[öo]nem/i,
    /devreden bakiye/i,
    /devir/i,
    /ge[çc]en d[öo]nem bakiye/i,
    /asgari [öo]deme/i,
    /toplam bor[cç]/i,
    /d[öo]nem bor[cç]u/i,
    /son [öo]deme tarihi/i,
    /hesap kesim/i,
    /kalan bor[cç]/i,
    /bakiye devri/i,
  ];

  private hareketSayilirMi(aciklama: string): boolean {
    const a = String(aciklama || '').trim();
    if (a.length < 3) return false;
    return !ButceEkstreImportService.HAREKET_DEGIL.some((re) => re.test(a));
  }

  /** "12.07.2026  MIGROS ISTANBUL  1.234,56" biçimli satırları yakalar */
  private kuralIleSatirlar(metin: string): Array<{ tarih: string; aciklama: string; tutar: number; taksitBilgi?: string }> {
    const cikti: Array<{ tarih: string; aciklama: string; tutar: number; taksitBilgi?: string }> = [];
    const satirlar = String(metin || '').split(/\r?\n/);
    const re = /^\s*(\d{2})[./-](\d{2})[./-](\d{2,4})\s+(.+?)\s+(-?[\d.]+,\d{2})\s*(-)?\s*$/;
    for (const satir of satirlar) {
      const m = re.exec(satir);
      if (!m) continue;
      const [, gg, aa, yy, aciklamaHam, tutarHam, sonEksi] = m;
      const yil = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
      const tutar = this.paraCevir(tutarHam);
      if (tutar === null) continue;
      const aciklama = aciklamaHam.replace(/\s{2,}/g, ' ').trim();
      if (!this.hareketSayilirMi(aciklama)) continue; // ödeme/devir satırı — harcama değil
      const taksit = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(aciklamaHam);
      cikti.push({
        tarih: `${yil}-${aa}-${gg}`,
        aciklama,
        tutar: sonEksi ? -tutar : tutar,
        taksitBilgi: taksit ? `${taksit[1]}/${taksit[2]}` : undefined,
      });
    }
    return cikti;
  }

  /** Ekstre başlığındaki toplam/asgari/tarih alanları */
  private kuralIleOzet(metin: string) {
    const d = String(metin || '').replace(/\s+/g, ' ');
    const bul = (etiketler: string[]): number | null => {
      for (const e of etiketler) {
        const re = new RegExp(`${e}[^0-9-]{0,40}(-?[\\d.]+,\\d{2})`, 'i');
        const m = re.exec(d);
        if (m) {
          const v = this.paraCevir(m[1]);
          if (v !== null) return v;
        }
      }
      return null;
    };
    const tarihBul = (etiketler: string[]): string | null => {
      for (const e of etiketler) {
        const re = new RegExp(`${e}[^0-9]{0,30}(\\d{2}[./-]\\d{2}[./-]\\d{4})`, 'i');
        const m = re.exec(d);
        if (m) {
          const [gg, aa, yyyy] = m[1].split(/[./-]/);
          return `${yyyy}-${aa}-${gg}`;
        }
      }
      return null;
    };
    return {
      donemBorcu: bul(['d[öo]nem bor[cç]u', 'toplam bor[cç]', 'hesap [öo]zeti bor[cç]', 'son bakiye']),
      asgariTutar: bul(['asgari [öo]deme tutar[ıi]', 'asgari [öo]deme', 'minimum [öo]deme']),
      sonOdemeTarihi: tarihBul(['son [öo]deme tarihi', 'son [öo]deme g[üu]n[üu]']),
      kesimTarihi: tarihBul(['hesap kesim tarihi', 'ekstre tarihi', 'hesap [öo]zeti tarihi']),
    };
  }

  /* ===================== AI AYRIŞTIRMA ===================== */

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

  private async aiIleSatirlar(metin: string) {
    if (!isMaxAvailable()) return null;
    const kisa = metin.length > 40000 ? metin.slice(0, 40000) : metin;
    const sonuc = await claudeTextViaMax({
      model: MAX_MODEL_DEFAULT,
      timeoutMs: 180000,
      system:
        'Kredi kartı ekstresi metnini yapılandırılmış veriye çeviren bir ayrıştırıcısın. ' +
        'SADECE geçerli JSON döndür, açıklama yazma. Uydurma yapma; metinde olmayan satırı ekleme.',
      prompt: [
        'Aşağıda bir kredi kartı hesap özetinin (ekstre) ham metni var.',
        'Şu JSON şemasında döndür:',
        '{"donemBorcu":number|null,"asgariTutar":number|null,"sonOdemeTarihi":"YYYY-MM-DD"|null,',
        '"kesimTarihi":"YYYY-MM-DD"|null,',
        '"hareketler":[{"tarih":"YYYY-MM-DD","aciklama":"...","tutar":number,"taksitBilgi":"3/12"|null}]}',
        '',
        'KURALLAR:',
        '- Harcama tutarı POZİTİF, iade/puan/indirim NEGATİF olsun.',
        '- Faiz, ücret, aidat satırlarını da hareket olarak ekle.',
        '- Önceki dönem bakiyesi, devir, yapılan ödeme ve "teşekkür ederiz" satırlarını EKLEME.',
        '- Asgari ödeme, dönem borcu, toplam borç gibi ÖZET satırlarını hareket olarak EKLEME.',
        '- Tutarları sayı olarak yaz (1234.56), metin değil.',
        '',
        'EKSTRE METNİ:',
        kisa,
      ].join('\n'),
    });
    if (!sonuc.ok) {
      this.logger.warn(`[EkstreImport] AI ayrıştırma hatası: ${sonuc.error}`);
      return null;
    }
    const veri = this.jsonAyikla(sonuc.text);
    if (!veri || !Array.isArray(veri.hareketler)) return null;
    return veri;
  }

  /** Bilinmeyen satıcılar için toplu kategori önerisi */
  private async aiIleKategoriOner(
    saticilar: string[],
    kategoriler: Array<{ id: string; ad: string }>,
  ): Promise<Record<string, string>> {
    if (!isMaxAvailable() || saticilar.length === 0) return {};
    const sonuc = await claudeTextViaMax({
      model: MAX_MODEL_DEFAULT,
      timeoutMs: 120000,
      system:
        'Kredi kartı harcama açıklamalarını gider kategorilerine eşleyen bir sınıflandırıcısın. ' +
        'SADECE JSON döndür. Emin olmadığın satıcıyı "Diğer Gider" kategorisine koy.',
      prompt: [
        'KATEGORİLER (sadece bu listeden seç, kategori adını birebir yaz):',
        kategoriler.map((c) => `- ${c.ad}`).join('\n'),
        '',
        'HARCAMA AÇIKLAMALARI:',
        saticilar.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        '',
        'Şu biçimde döndür: {"eslesme":{"açıklama":"Kategori Adı", ...}}',
      ].join('\n'),
    });
    if (!sonuc.ok) return {};
    const veri = this.jsonAyikla(sonuc.text);
    const eslesme = veri?.eslesme || veri;
    if (!eslesme || typeof eslesme !== 'object') return {};
    const adToId = new Map(kategoriler.map((c) => [c.ad.toLocaleLowerCase('tr-TR'), c.id]));
    const cikti: Record<string, string> = {};
    for (const [aciklama, kategoriAdi] of Object.entries(eslesme)) {
      const id = adToId.get(String(kategoriAdi).toLocaleLowerCase('tr-TR'));
      if (id) cikti[aciklama] = id;
    }
    return cikti;
  }

  /* ===================== İÇE AKTARMA ===================== */

  /**
   * PDF'i işler, hareketleri ekstreye bağlar. Hareketler ONAY BEKLER —
   * kullanıcı kategorileri gözden geçirip onaylayınca bütçeye işlenir.
   */
  async pdfIceAktar(
    k: Kimlik,
    p: { kartId: string; donem?: string; buffer: Buffer; dosyaAdi?: string; sifre?: string },
  ) {
    const kart = await this.db.butceKart.findFirst({
      where: { id: p.kartId, tenantId: k.tenantId, userId: k.userId },
    });
    if (!kart) throw new NotFoundException('Kart bulunamadı');

    let metin = '';
    try {
      metin = await this.pdfMetin(p.buffer, p.sifre);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/password|encrypt/i.test(msg)) {
        throw new BadRequestException('PDF şifreli. Bankanın verdiği şifreyi girip tekrar deneyin.');
      }
      throw new BadRequestException(`PDF okunamadı: ${msg}`);
    }
    if (metin.replace(/\s/g, '').length < 50) {
      throw new BadRequestException(
        'PDF içinde metin bulunamadı (taranmış görüntü olabilir). Tutarı elle girebilirsiniz.',
      );
    }

    // 1) Satırlar — önce kural, yetersizse AI
    let ozet = this.kuralIleOzet(metin);
    let hareketler = this.kuralIleSatirlar(metin);
    let yontem: 'KURAL' | 'AI' | 'KURAL+AI' = 'KURAL';
    if (hareketler.length < 3) {
      const ai = await this.aiIleSatirlar(metin);
      if (ai) {
        hareketler = (ai.hareketler || [])
          .map((h: any) => ({
            tarih: String(h.tarih || '').slice(0, 10),
            aciklama: String(h.aciklama || '').trim(),
            tutar: Math.round(Number(h.tutar) * 100) / 100,
            taksitBilgi: h.taksitBilgi || undefined,
          }))
          .filter(
            (h: any) =>
              h.aciklama &&
              Number.isFinite(h.tutar) &&
              /^\d{4}-\d{2}-\d{2}$/.test(h.tarih) &&
              this.hareketSayilirMi(h.aciklama), // model yine de eklerse burada elenir
          );
        ozet = {
          donemBorcu: ozet.donemBorcu ?? (Number.isFinite(ai.donemBorcu) ? ai.donemBorcu : null),
          asgariTutar: ozet.asgariTutar ?? (Number.isFinite(ai.asgariTutar) ? ai.asgariTutar : null),
          sonOdemeTarihi: ozet.sonOdemeTarihi ?? ai.sonOdemeTarihi ?? null,
          kesimTarihi: ozet.kesimTarihi ?? ai.kesimTarihi ?? null,
        };
        yontem = 'AI';
      }
    } else if (!ozet.donemBorcu) {
      const ai = await this.aiIleSatirlar(metin);
      if (ai) {
        ozet.donemBorcu = Number.isFinite(ai.donemBorcu) ? ai.donemBorcu : ozet.donemBorcu;
        ozet.asgariTutar = ozet.asgariTutar ?? (Number.isFinite(ai.asgariTutar) ? ai.asgariTutar : null);
        yontem = 'KURAL+AI';
      }
    }

    if (hareketler.length === 0 && ozet.donemBorcu === null) {
      throw new BadRequestException('Ekstreden hareket ya da toplam borç okunamadı. Tutarı elle girin.');
    }

    // 2) Ekstre kaydını bul/oluştur
    const donem =
      p.donem ||
      (ozet.kesimTarihi ? ozet.kesimTarihi.slice(0, 7) : new Date().toISOString().slice(0, 7));
    const ekstre = await this.butce.ekstreDonemUret(k, kart, donem);

    // Ekstre üzerindeki tarihler PDF'ten okunabildiyse onları kullan (gerçek banka tarihi)
    const guncelleme: any = {};
    if (ozet.kesimTarihi) guncelleme.kesimTarihi = new Date(`${ozet.kesimTarihi}T00:00:00.000Z`);
    if (ozet.sonOdemeTarihi) guncelleme.sonOdemeTarihi = new Date(`${ozet.sonOdemeTarihi}T00:00:00.000Z`);
    if (ozet.donemBorcu !== null && ozet.donemBorcu !== undefined) {
      guncelleme.borcTutari = ozet.donemBorcu;
      guncelleme.asgariTutar =
        ozet.asgariTutar ?? asgariTutarHesapla(ozet.donemBorcu, Number(kart.asgariOran) || 20);
      // Durumu sabit 'ODENMEDI' yazmak, ödenmiş ekstreyi yeniden yükleyince
      // borcu diriltiyordu. Ödenen tutara göre hesapla.
      const odenen = Number(ekstre.odenenTutar) || 0;
      const asgari = Number(guncelleme.asgariTutar) || 0;
      guncelleme.durum =
        odenen >= ozet.donemBorcu - 0.009
          ? 'ODENDI'
          : odenen >= asgari && asgari > 0
            ? 'ASGARI_ODENDI'
            : odenen > 0
              ? 'KISMI'
              : 'ODENMEDI';
    }
    if (Object.keys(guncelleme).length > 0) {
      await this.db.butceKartEkstre.update({ where: { id: ekstre.id }, data: guncelleme });
    }

    // 3) Kategori ataması — önce hafıza, kalanı AI
    const kategoriler = await this.db.butceKategori.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, tur: 'GIDER', aktif: true },
      select: { id: true, ad: true, defter: true },
    });
    const hafiza = await this.db.butceSaticiHafiza.findMany({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    // Hafıza hem kategoriyi hem defteri (şahsi/ofis) hatırlar
    const hafizaMap = new Map<string, { kategoriId: string; defter: string }>(
      hafiza.map((h: any) => [h.satici, { kategoriId: h.kategoriId, defter: h.defter || 'SAHSI' }]),
    );

    const zenginler = hareketler.map((h) => ({
      ...h,
      satici: ButceEkstreImportService.saticiAnahtari(h.aciklama),
    }));
    const bilinmeyenler = Array.from(
      new Set(zenginler.filter((h) => !hafizaMap.has(h.satici)).map((h) => h.aciklama)),
    ).slice(0, 120);
    const aiEslesme = await this.aiIleKategoriOner(bilinmeyenler, kategoriler);

    // 4) Hareketleri yaz.
    // ONAYLANMIŞ hareket varsa yükleme REDDEDİLİR: eski sürümde yalnız onaylanmamışlar
    // siliniyor, onaylıların üstüne kopya ekleniyordu ve o ayın gideri ikiye katlanıyordu.
    const onayliVar = await this.db.butceKartHareket.count({
      where: { tenantId: k.tenantId, userId: k.userId, ekstreId: ekstre.id, onaylandi: true },
    });
    if (onayliVar > 0) {
      throw new BadRequestException(
        `Bu ekstrenin ${onayliVar} hareketi zaten bütçeye işlenmiş. Yeniden yüklemek için önce "Onayı geri al" deyin.`,
      );
    }
    await this.db.butceKartHareket.deleteMany({
      where: { tenantId: k.tenantId, userId: k.userId, ekstreId: ekstre.id, onaylandi: false },
    });

    let hafizadan = 0;
    let aiden = 0;
    const kategoriDefterMap = new Map<string, string>(
      kategoriler.map((c: any) => [c.id, c.defter || 'SAHSI']),
    );
    for (const h of zenginler) {
      const hafizaKayit = hafizaMap.get(h.satici);
      const kategoriId = hafizaKayit?.kategoriId || aiEslesme[h.aciklama] || null;
      if (hafizaKayit) hafizadan++;
      else if (kategoriId) aiden++;
      // Defter sırası: satıcı hafızası → kategorinin defteri → kartın varsayılanı
      const defter =
        hafizaKayit?.defter ||
        (kategoriId ? kategoriDefterMap.get(kategoriId) : null) ||
        kart.varsayilanDefter ||
        'SAHSI';
      await this.db.butceKartHareket.create({
        data: {
          tenantId: k.tenantId,
          userId: k.userId,
          ekstreId: ekstre.id,
          tarih: new Date(`${h.tarih}T00:00:00.000Z`),
          aciklama: h.aciklama,
          satici: h.satici || null,
          tutar: h.tutar,
          taksitBilgi: h.taksitBilgi || null,
          kategoriId,
          defter,
          kategoriKaynak: hafizaKayit ? 'HAFIZA' : kategoriId ? 'AI' : 'AI',
        },
      });
    }

    const hareketToplami = zenginler.reduce((t, h) => t + h.tutar, 0);
    return {
      ekstreId: ekstre.id,
      donem,
      yontem,
      hareketSayisi: zenginler.length,
      hareketToplami: Math.round(hareketToplami * 100) / 100,
      okunanOzet: ozet,
      kategoriKaynak: { hafiza: hafizadan, ai: aiden, bos: zenginler.length - hafizadan - aiden },
      /** PDF toplamı ile satır toplamı tutmuyorsa kullanıcıya söyle */
      uyari:
        ozet.donemBorcu !== null && Math.abs(hareketToplami - Number(ozet.donemBorcu)) > 1
          ? `Satır toplamı (${hareketToplami.toFixed(2)}) ile ekstre borcu (${Number(ozet.donemBorcu).toFixed(2)}) farklı. Önceki dönem devri veya okunamayan satır olabilir; borç tutarı ekstredeki değer olarak alındı.`
          : null,
    };
  }

  /* ===================== HAREKETLER ===================== */

  async hareketler(k: Kimlik, ekstreId: string) {
    const liste = await this.db.butceKartHareket.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, ekstreId },
      orderBy: { tarih: 'asc' },
      include: { kategori: { select: { id: true, ad: true, renk: true } } },
    });
    return liste.map((h: any) => ({ ...h, tutar: Number(h.tutar) }));
  }

  /** Kategori düzeltme — düzeltilen satıcı hafızaya yazılır (bir kez düzelt, bir daha sorma) */
  async hareketKategoriDegistir(
    k: Kimlik,
    id: string,
    kategoriId: string,
    hepsineUygula = true,
    defter?: string,
  ) {
    const hareket = await this.db.butceKartHareket.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
    });
    if (!hareket) throw new NotFoundException('Hareket bulunamadı');
    const kategori = await this.db.butceKategori.findFirst({
      where: { id: kategoriId, tenantId: k.tenantId, userId: k.userId },
    });
    if (!kategori) throw new NotFoundException('Kategori bulunamadı');

    // Defter: elle verilmişse o, yoksa kategorinin defteri
    const yeniDefter = defter === 'OFIS' || defter === 'SAHSI' ? defter : kategori.defter || 'SAHSI';

    await this.db.butceKartHareket.update({
      where: { id },
      data: { kategoriId, defter: yeniDefter, kategoriKaynak: 'ELLE' },
    });

    if (hareket.satici) {
      await this.db.butceSaticiHafiza.upsert({
        where: {
          tenantId_userId_satici: {
            tenantId: k.tenantId,
            userId: k.userId,
            satici: hareket.satici,
          },
        },
        create: {
          tenantId: k.tenantId,
          userId: k.userId,
          satici: hareket.satici,
          kategoriId,
          defter: yeniDefter,
        },
        update: { kategoriId, defter: yeniDefter, sayac: { increment: 1 } },
      });

      if (hepsineUygula) {
        // Aynı satıcının onaylanmamış diğer hareketleri de düzelsin
        await this.db.butceKartHareket.updateMany({
          where: {
            tenantId: k.tenantId,
            userId: k.userId,
            satici: hareket.satici,
            onaylandi: false,
            id: { not: id },
          },
          data: { kategoriId, defter: yeniDefter, kategoriKaynak: 'HAFIZA' },
        });
      }
    }
    return { ok: true };
  }

  /** Yalnız defteri değiştir (kategori aynı kalsın) */
  async hareketDefterDegistir(k: Kimlik, id: string, defter: string, hepsineUygula = true) {
    if (defter !== 'SAHSI' && defter !== 'OFIS') {
      throw new BadRequestException('defter SAHSI veya OFIS olmalı');
    }
    const hareket = await this.db.butceKartHareket.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
    });
    if (!hareket) throw new NotFoundException('Hareket bulunamadı');
    await this.db.butceKartHareket.update({ where: { id }, data: { defter } });
    if (hareket.satici && hepsineUygula) {
      await this.db.butceKartHareket.updateMany({
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          satici: hareket.satici,
          onaylandi: false,
          id: { not: id },
        },
        data: { defter },
      });
      if (hareket.kategoriId) {
        await this.db.butceSaticiHafiza.upsert({
          where: {
            tenantId_userId_satici: { tenantId: k.tenantId, userId: k.userId, satici: hareket.satici },
          },
          create: {
            tenantId: k.tenantId,
            userId: k.userId,
            satici: hareket.satici,
            kategoriId: hareket.kategoriId,
            defter,
          },
          update: { defter },
        });
      }
    }
    return { ok: true };
  }

  /**
   * Ekstre hareketlerini bütçeye işler.
   * Her hareket, kartın harcama kalemi olarak GİDER işlemine dönüşür (kaynak=KART).
   * Nakit akışını bozmaz: kart harcaması nakit çıkışı değil, kart borcudur.
   */
  async hareketleriOnayla(k: Kimlik, ekstreId: string) {
    const ekstre = await this.db.butceKartEkstre.findFirst({
      where: { id: ekstreId, tenantId: k.tenantId, userId: k.userId },
      include: { kart: true },
    });
    if (!ekstre) throw new NotFoundException('Ekstre bulunamadı');
    const hareketler = await this.db.butceKartHareket.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, ekstreId, onaylandi: false },
    });

    let islenen = 0;
    let eslesenElleGirilen = 0;
    for (const h of hareketler) {
      const tutar = Number(h.tutar);
      if (!(Math.abs(tutar) > 0)) continue;
      const tarih = new Date(h.tarih);
      const donem = `${tarih.getUTCFullYear()}-${String(tarih.getUTCMonth() + 1).padStart(2, '0')}`;

      // ÇAKIŞMA ÇÖZÜMÜ: aynı kart + aynı tutar + ±3 gün aralığında ELLE girilmiş
      // (ekstre satırından üretilmemiş) bir kayıt varsa, onu bu satırla değiştir.
      // Aksi hâlde ay içinde elle girilen harcama, ekstre yüklenince ikinci kez sayılırdı.
      const pencereBas = new Date(tarih.getTime() - 3 * 86400000);
      const pencereBit = new Date(tarih.getTime() + 3 * 86400000);
      const elleGirilen = await this.db.butceIslem.findFirst({
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          kartId: ekstre.kartId,
          kartHareketId: null,
          tutar: Math.abs(tutar),
          tarih: { gte: pencereBas, lte: pencereBit },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (elleGirilen) {
        await this.db.butceIslem.delete({ where: { id: elleGirilen.id } });
        eslesenElleGirilen++;
      }

      const islem = await this.db.butceIslem.create({
        data: {
          tenantId: k.tenantId,
          userId: k.userId,
          tarih,
          donem,
          // İade/puan satırı negatif tutarlıdır; gideri azaltmak yerine GELIR yazılır
          tur: tutar >= 0 ? 'GIDER' : 'GELIR',
          tutar: Math.abs(tutar),
          defter: h.defter || ekstre.kart.varsayilanDefter || 'SAHSI',
          kategoriId: h.kategoriId,
          aciklama: `${h.aciklama}${h.taksitBilgi ? ` (${h.taksitBilgi})` : ''} — ${ekstre.kart.bankaAdi} ${ekstre.kart.kartAdi}`,
          kaynak: 'KART',
          kartId: ekstre.kartId,
          kartHareketId: h.id,
        },
      });
      await this.db.butceKartHareket.update({
        where: { id: h.id },
        data: { onaylandi: true, islemId: islem.id },
      });
      islenen++;
    }
    return {
      ok: true,
      islenen,
      eslesenElleGirilen,
      mesaj:
        eslesenElleGirilen > 0
          ? `${islenen} hareket işlendi. ${eslesenElleGirilen} tanesi daha önce elle girdiğiniz kayıtla eşleşti ve ekstre satırıyla değiştirildi (çift kayıt olmadı).`
          : `${islenen} hareket bütçeye işlendi.`,
    };
  }

  /** Onaylanmış hareketleri geri al (yanlış ekstre yüklenmişse) */
  async onayGeriAl(k: Kimlik, ekstreId: string) {
    const hareketler = await this.db.butceKartHareket.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, ekstreId, onaylandi: true },
    });
    const islemIdler = hareketler.map((h: any) => h.islemId).filter(Boolean);
    if (islemIdler.length > 0) {
      await this.db.butceIslem.deleteMany({
        where: { tenantId: k.tenantId, userId: k.userId, id: { in: islemIdler } },
      });
    }
    await this.db.butceKartHareket.updateMany({
      where: { tenantId: k.tenantId, userId: k.userId, ekstreId, onaylandi: true },
      data: { onaylandi: false, islemId: null },
    });
    return { ok: true, geriAlinan: islemIdler.length };
  }
}
