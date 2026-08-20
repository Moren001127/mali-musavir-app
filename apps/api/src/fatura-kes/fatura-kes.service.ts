import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { birimKodu, GIB_BIRIM } from './gib-earsiv-payload';
import { chromium } from 'playwright-core';

/**
 * FATURA KES — satış faturası hazırlama motoru.
 *
 * GÜVENLİK MODELİ (kullanıcı kuralı: tek mesajla resmî belge oluşmaz):
 *   TASLAK     → yalnız bizde. Hiçbir yere gönderilmez, önizleme üretilir.
 *   GIB_TASLAK → GİB e-Arşiv portalında taslak. Resmî belge DEĞİL, silinebilir.
 *   KESILDI    → kesinleştirilmiş resmî belge. AYRI komut + AYRI onay ister.
 *   IPTAL      → vazgeçildi.
 *
 * Bu serviste YALNIZ taslak hazırlama ve önizleme vardır; GİB'e gönderim
 * bilinçli olarak AYRI bir adımda (ayrı serviste) ele alınır.
 */

export type FaturaKesInput = {
  taxpayerId: string;
  aliciVkn: string;
  aliciUnvan: string;
  aliciAdres?: string | null;
  aliciVd?: string | null;
  aliciEposta?: string | null;
  faturaTarihi: string | Date;
  aciklama: string;
  matrah: number | string;
  kdvOrani?: number;
  miktar?: number | string;
  birim?: string;
  kanal?: 'GIB_EARSIV' | 'ENTEGRATOR';
  kaynak?: 'PORTAL' | 'WHATSAPP';
  komutMetni?: string | null;
  idempotencyKey?: string | null;
};

/** GİB'in kabul ettiği KDV oranları. Liste dışı oran sessizce %20'ye çevrilmez — reddedilir. */
const GECERLI_KDV = [0, 1, 10, 20];

@Injectable()
export class FaturaKesService {
  private readonly logger = new Logger(FaturaKesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * TR biçimli ya da düz sayıyı sayıya çevirir.
   *
   * PARA HATASI DÜZELTİLDİ (denetim 2026-08-20): eski hal "en sağdaki ayraç ondalıktır"
   * diyordu ve "8.000" değerini 8 TL okuyordu — fatura 1000 KAT KÜÇÜK kesiliyordu.
   * Ekranın kendi ipucu metni de "8.000,00" yazdığı için kullanıcıyı tam bu yazıma
   * yönlendiriyordu.
   *
   * Kural (projenin parseDecimal'i ile AYNI — fatura-muhasebelestirme.service.ts):
   *   • virgül varsa → ondalık virgüldür, noktalar binliktir      "1.234,56" → 1234.56
   *   • yalnız nokta + TEK nokta + 1-2 haneli kesir → ondalıktır  "1234.56"  → 1234.56
   *   • yalnız nokta, aksi her durum → TR BİNLİK ayracıdır        "8.000"    → 8000
   *                                                               "1.234.567"→ 1234567
   */
  private sayi(v: any): number {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const ham = String(v).trim().replace(/\s|₺|TL/gi, '');
    if (!ham) return NaN;
    const eksi = /^-/.test(ham);
    const s = ham.replace(/^[-+]/, '');
    const sonVirgul = s.lastIndexOf(',');
    const sonNokta = s.lastIndexOf('.');
    let d: string;
    if (sonVirgul >= 0) {
      // Virgül ondalıktır; solundaki tüm ayraçlar binliktir.
      d = s.slice(0, sonVirgul).replace(/\D/g, '') + '.' + s.slice(sonVirgul + 1).replace(/\D/g, '');
    } else if (sonNokta >= 0) {
      const kesir = s.slice(sonNokta + 1);
      const tekNokta = s.indexOf('.') === sonNokta;
      d = tekNokta && /^\d{1,2}$/.test(kesir)
        ? s.slice(0, sonNokta).replace(/\D/g, '') + '.' + kesir
        : s.replace(/\D/g, '');
    } else {
      d = s.replace(/\D/g, '');
    }
    if (!d || d === '.') return NaN;
    const n = Number((eksi ? '-' : '') + d);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Türkiye takvim günü (YYYY-MM-DD). Sunucu UTC olsa da doğru günü verir. */
  private gunTR(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }

  private yuvarla(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Taslak oluştur. Hiçbir yere gönderilmez — yalnız hesaplanır, kaydedilir, önizlenir.
   * Doğrulama BİLEREK katıdır: eksik/şüpheli veriyle GİB'e gidilmesindense burada durulur.
   */
  /**
   * KANAL TESPİTİ — fatura hangi kapıdan kesilecek?
   *
   * Mükellef bir entegratöre bağlıysa satış faturalarını ORADAN kesiyordur. Aynı mükellef için
   * GİB portalından da fatura kesmek BELGE NUMARASINI ÇAKIŞTIRIR: iki ayrı sistem ayrı seri
   * üretir, aynı numara iki kez doğabilir. Bu yüzden entegratörlü mükellefte GİB gönderimi
   * VARSAYILAN OLARAK DURDURULUR — kullanıcı bile bile isterse açıkça geçer.
   *
   * Canlı veri (2026-08-20): 76 aktif mükellefin 76'sında GİB e-Arşiv kimliği var,
   * 11'i ayrıca entegratöre bağlı (ELOGO/PARASUT/TURMOB_EFATURA/UYUMSOFT/TURKCELL/MIKRO).
   * Entegratör adaptörleri şu an SADECE OKUMA yapıyor — oradan fatura kesme henüz yok.
   */
  async kanalTespit(
    tenantId: string,
    taxpayerId: string,
  ): Promise<{ kanal: 'GIB_EARSIV' | 'ENTEGRATOR'; saglayici: string | null; gibdenKesilebilir: boolean; sebep: 'ENTEGRATOR' | 'KIMLIK_YOK' | null; uyari: string | null }> {
    // Entegratör olmayan bağlantılar (mesajlaşma/eposta/Luca) kanal sayılmaz.
    const KANAL_DISI = new Set(['EMAIL_SMTP', 'WHATSAPP_BAILEYS', 'WHATSAPP_META', 'LUCA_WORKER_ACCOUNTS']);
    const baglantilar = await (this.prisma as any).integrationConnection
      .findMany({ where: { tenantId, isActive: true }, select: { provider: true, config: true } })
      .catch(() => [] as any[]);

    for (const b of baglantilar || []) {
      const saglayici = String(b?.provider || '').toUpperCase();
      if (!saglayici || KANAL_DISI.has(saglayici)) continue;
      const mukellefler = (b?.config as any)?.taxpayers || {};
      if (mukellefler && mukellefler[taxpayerId]) {
        return {
          kanal: 'ENTEGRATOR',
          saglayici,
          gibdenKesilebilir: false,
          sebep: 'ENTEGRATOR',
          uyari:
            `Bu mükellef ${saglayici} ile bağlı. Bu bağlantı fatura ÇEKMEK için kurulmuş olabilir; ` +
            `mükellefin faturalarını oradan KESTİĞİNİ kanıtlamaz. Eğer oradan kesiyorsa GİB portalından ` +
            `kesmek belge numarasını çakıştırır — bu yüzden onayın isteniyor.`,
        };
      }
    }

    const gib = await (this.prisma as any).portalCredential
      .findFirst({ where: { tenantId, taxpayerId, provider: 'GIB_IVD', isActive: true }, select: { id: true } })
      .catch(() => null);
    if (!gib) {
      return {
        kanal: 'GIB_EARSIV',
        saglayici: null,
        gibdenKesilebilir: false,
        sebep: 'KIMLIK_YOK',
        uyari: 'Bu mükellefin GİB e-Arşiv kimliği tanımlı değil — fatura kesilemez.',
      };
    }
    return { kanal: 'GIB_EARSIV', saglayici: null, gibdenKesilebilir: true, sebep: null, uyari: null };
  }

  async createDraft(tenantId: string, userId: string | null, input: FaturaKesInput) {
    if (!input?.taxpayerId) throw new BadRequestException('Mükellef seçilmeli');

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, isActive: true },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');
    if (taxpayer.isActive === false) throw new BadRequestException('Pasif mükellef adına fatura kesilemez');

    const vkn = String(input.aliciVkn || '').replace(/\D/g, '');
    if (vkn.length !== 10 && vkn.length !== 11) {
      throw new BadRequestException('Alıcı VKN 10 hane, TCKN 11 hane olmalı');
    }
    const unvan = String(input.aliciUnvan || '').trim();
    if (unvan.length < 2) throw new BadRequestException('Alıcı ünvanı / adı soyadı gerekli');

    const aciklama = String(input.aciklama || '').trim();
    if (aciklama.length < 2) throw new BadRequestException('Fatura içeriği (açıklama) gerekli');

    const matrah = this.yuvarla(this.sayi(input.matrah));
    if (!Number.isFinite(matrah) || matrah <= 0) throw new BadRequestException('Tutar (KDV hariç) 0’dan büyük olmalı');

    const kdvOrani = input.kdvOrani === undefined || input.kdvOrani === null ? 20 : Number(input.kdvOrani);
    if (!GECERLI_KDV.includes(kdvOrani)) {
      throw new BadRequestException(`KDV oranı geçersiz (${kdvOrani}). Geçerli oranlar: ${GECERLI_KDV.join(', ')}`);
    }

    const miktarNum = input.miktar === undefined || input.miktar === null || input.miktar === '' ? 1 : this.sayi(input.miktar);
    if (!Number.isFinite(miktarNum) || miktarNum <= 0) throw new BadRequestException('Miktar 0’dan büyük olmalı');

    const tarih = new Date(input.faturaTarihi);
    if (isNaN(tarih.getTime())) throw new BadRequestException('Fatura tarihi geçersiz');
    // GELECEK TARİH ENGELİ: e-Arşiv'de ileri tarihli fatura düzenlenemez; sessizce göndermek
    //   yerine burada durdurulur (GİB tarafında anlaşılmaz hata dönüyor).
    // TÜRKİYE SAATİ (denetim 2026-08-20): sunucu UTC çalışıyor. Sunucunun yerel gününe
    //   bakılınca Türkiye'de gece 00:00-03:00 arasında BUGÜNÜN faturası "ileri tarihli"
    //   sayılıp reddediliyordu. Karşılaştırma Türkiye takvim gününe göre yapılır.
    if (this.gunTR(tarih) > this.gunTR(new Date())) {
      throw new BadRequestException('Fatura tarihi ileri tarihli olamaz');
    }

    const kdvTutari = this.yuvarla((matrah * kdvOrani) / 100);
    const toplam = this.yuvarla(matrah + kdvTutari);

    // MÜKERRER KORUMASI: aynı komut/istek iki kez gelirse İKİNCİ TASLAK OLUŞMAZ.
    //   WhatsApp'ta mesaj tekrarı çok olası; idempotencyKey ile aynı kayıt döner.
    const key = String(input.idempotencyKey || '').trim() || null;
    if (key) {
      const mevcut = await (this.prisma as any).salesInvoiceDraft.findFirst({
        where: { tenantId, idempotencyKey: key },
      });
      if (mevcut) {
        this.logger.log(`[FATURA-KES] mukerrer istek — mevcut taslak donduruldu (${mevcut.id})`);
        return this.sonuc(mevcut, taxpayer);
      }
    }

    // BİRİM: GİB birim ADI değil KODU bekler. Tanınmayan birim SESSİZCE gönderilmez —
    //   yanlış kodla fatura kesmektense burada dururuz.
    const birimAdi = String(input.birim || 'ADET').trim().toUpperCase().slice(0, 16);
    if (!birimKodu(birimAdi)) {
      throw new BadRequestException(
        `Birim tanınmadı: "${birimAdi}". Kullanılabilir birimler: ${[...new Set(Object.keys(GIB_BIRIM))].slice(0, 14).join(', ')} ...`,
      );
    }

    // Kanal ELLE DEĞİL tespitle belirlenir: entegratörlü mükellefte GİB'e gönderim engellenir.
    const kanalBilgi = await this.kanalTespit(tenantId, taxpayer.id);

    const draft = await (this.prisma as any).salesInvoiceDraft.create({
      data: {
        tenantId,
        taxpayerId: taxpayer.id,
        kanal: kanalBilgi.kanal,
        durum: 'TASLAK',
        aliciVkn: vkn,
        aliciUnvan: unvan,
        aliciAdres: input.aliciAdres?.trim() || null,
        aliciVd: input.aliciVd?.trim() || null,
        aliciEposta: input.aliciEposta?.trim() || null,
        faturaTarihi: tarih,
        aciklama,
        miktar: new Prisma.Decimal(miktarNum.toFixed(3)),
        birim: birimAdi,
        matrah: new Prisma.Decimal(matrah.toFixed(2)),
        kdvOrani,
        kdvTutari: new Prisma.Decimal(kdvTutari.toFixed(2)),
        toplam: new Prisma.Decimal(toplam.toFixed(2)),
        kaynak: input.kaynak === 'WHATSAPP' ? 'WHATSAPP' : 'PORTAL',
        komutMetni: input.komutMetni || null,
        idempotencyKey: key,
        createdBy: userId || null,
      },
    });

    this.logger.log(
      `[FATURA-KES] taslak olusturuldu ${draft.id} · ${this.mukellefAdi(taxpayer)} → ${unvan} (${vkn}) · `
      + `${matrah.toFixed(2)} + %${kdvOrani} KDV = ${toplam.toFixed(2)} · GONDERILMEDI`,
    );
    return this.sonuc(draft, taxpayer);
  }

  async listDrafts(tenantId: string, opts: { taxpayerId?: string; durum?: string; limit?: number } = {}) {
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.durum) where.durum = opts.durum;
    // SUTUN SECIMI ZORUNLU: gorselHtml faturanin GIB'deki tam HTML'i (belge basina ~400 KB'a
    //   kadar). Select verilmezse 500 satirlik liste yuz megabaytlik veriyi bosuna tasiyor —
    //   sonuc() zaten bu alani DONDURMUYOR. Yalniz listede gosterilen sutunlar cekilir.
    const rows = await (this.prisma as any).salesInvoiceDraft.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(opts.limit) || 100, 1), 500),
      select: {
        id: true, taxpayerId: true, kanal: true, durum: true,
        aliciVkn: true, aliciUnvan: true, aliciAdres: true, aliciVd: true,
        faturaTarihi: true, aciklama: true, miktar: true, birim: true,
        matrah: true, kdvOrani: true, kdvTutari: true, toplam: true,
        faturaNo: true, ettn: true, hata: true, kaynak: true, createdAt: true,
      },
    });
    const ids = [...new Set(rows.map((r: any) => r.taxpayerId))];
    const tps = ids.length
      ? await (this.prisma as any).taxpayer.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
        })
      : [];
    const map = new Map(tps.map((t: any) => [t.id, t]));
    return rows.map((r: any) => this.sonuc(r, map.get(r.taxpayerId)));
  }

  async getDraft(tenantId: string, id: string) {
    const draft = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: draft.taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, taxOffice: true, address: true, email: true, phone: true },
    });
    // GİB'de belge oluştuysa GERÇEK belgeyi göster; yoksa bizim önizlememizi.
    //   (gorselHtml gönderim anında, aynı GİB oturumunda alınır.)
    const gercek = typeof draft.gorselHtml === 'string' && draft.gorselHtml.length > 100 ? draft.gorselHtml : null;
    return {
      ...this.sonuc(draft, taxpayer),
      gercekBelge: !!gercek,
      onizlemeHtml: gercek || this.onizleme(draft, taxpayer),
    };
  }

  /**
   * Taslağı iptal et.
   *
   * DÜRÜSTLÜK KURALI (denetim 2026-08-20): GİB'e gönderilmiş bir taslak burada "iptal"
   * edilince GİB tarafındaki taslak SİLİNMEZ — orada durmaya devam eder ve mükellef
   * kendi portalından onu imzalayıp RESMİ FATURA yapabilir. Eskiden kullanıcıya sadece
   * "iptal edildi" deniyordu; bu yanıltıcıydı. Artık sonuçta açıkça bildirilir ve kayda
   * not düşülür. (GİB'de silme komutu HENÜZ YAKALANMADI — tahminle silme yapılmaz.)
   */
  async cancelDraft(tenantId: string, id: string) {
    const draft = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    if (draft.durum === 'KESILDI') {
      throw new BadRequestException('Bu fatura kesinleşmiş — iptali GİB/entegratör tarafında ayrı süreçtir, buradan silinemez');
    }
    if (draft.durum === 'GONDERILIYOR') {
      throw new BadRequestException(
        'Bu taslağın GİB gönderimi sürüyor ya da yarıda kaldı. Önce GİB portalından belge oluşup oluşmadığına bakılmalı.',
      );
    }
    const gibdeDuruyor = draft.durum === 'GIB_TASLAK';
    await (this.prisma as any).salesInvoiceDraft.update({
      where: { id },
      data: {
        durum: 'IPTAL',
        hata: gibdeDuruyor
          ? `Bizde iptal edildi ama GİB'deki taslak DURUYOR${draft.faturaNo ? ' (' + draft.faturaNo + ')' : ''} — GİB portalından silinmeli`
          : draft.hata,
      },
    });
    return {
      ok: true,
      gibdeDuruyor,
      faturaNo: draft.faturaNo || null,
      uyari: gibdeDuruyor
        ? `Yalnız bizdeki kayıt iptal edildi. GİB'de taslak${draft.faturaNo ? ' ' + draft.faturaNo : ''} DURUYOR ve imzalanabilir — GİB portalından silinmeli.`
        : null,
    };
  }

  /**
   * ONIZLEMEYI PDF YAP — WhatsApp'a goruntu gondermek icin.
   *
   * WhatsApp HTML gonderemez; GIB'in belgesi de HTML olarak geliyor. Ayni HTML Chromium ile
   * PDF'e cevrilir. Kalip Cari Kasa ekstresiyle AYNI (playwright-core, imajin sistem
   * Chromium'u — kendi Chromium'unu indirmez).
   *
   * Belge GIB'de olustuysa GERCEK belge, yoksa onizleme basilir; dosya adi bunu soyler.
   */
  async onizlemePdf(tenantId: string, id: string): Promise<{ pdf: Buffer; ad: string; gercek: boolean }> {
    const draft: any = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: draft.taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, taxOffice: true, address: true, email: true, phone: true },
    });
    const gercek = typeof draft.gorselHtml === 'string' && draft.gorselHtml.length > 100;
    const html = gercek ? draft.gorselHtml : this.onizleme(draft, taxpayer);

    let browser: any;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = Buffer.from(
        await page.pdf({ format: 'A4', landscape: true, margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }, printBackground: true }),
      );
      const kim = String(draft.aliciUnvan || '').replace(/[^\p{L}\p{N} .-]/gu, '').slice(0, 40).trim() || 'fatura';
      const ad = `${gercek ? (draft.faturaNo || 'fatura') : 'onizleme'} - ${kim}.pdf`;
      return { pdf, ad, gercek };
    } catch (e: any) {
      this.logger.error(`[FATURA-KES] PDF uretilemedi: ${e?.message}`);
      throw new BadRequestException(`Fatura PDF'i üretilemedi: ${e?.message || e}`);
    } finally {
      try { if (browser) await browser.close(); } catch { /* onemsiz */ }
    }
  }

  private mukellefAdi(t: any): string {
    if (!t) return '';
    return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || t.id;
  }

  private sonuc(d: any, taxpayer?: any) {
    return {
      id: d.id,
      taxpayerId: d.taxpayerId,
      mukellef: this.mukellefAdi(taxpayer),
      mukellefVkn: taxpayer?.taxNumber || null,
      kanal: d.kanal,
      durum: d.durum,
      aliciVkn: d.aliciVkn,
      aliciUnvan: d.aliciUnvan,
      aliciAdres: d.aliciAdres,
      aliciVd: d.aliciVd,
      faturaTarihi: d.faturaTarihi,
      aciklama: d.aciklama,
      miktar: Number(d.miktar),
      birim: d.birim,
      matrah: Number(d.matrah),
      kdvOrani: d.kdvOrani,
      kdvTutari: Number(d.kdvTutari),
      toplam: Number(d.toplam),
      faturaNo: d.faturaNo,
      ettn: d.ettn,
      hata: d.hata,
      kaynak: d.kaynak,
      createdAt: d.createdAt,
    };
  }

  /** Basit, yazdırılabilir önizleme. GİB'e giden belge DEĞİL — yalnız kontrol içindir. */
  /**
   * ÖNİZLEME — GİB e-Arşiv Portalı'nın KENDİ fatura düzeni.
   *
   * Kullanıcı isteği (2026-08-20): "önizleme tıkladığımda açılan görüntü GİB e-Arşiv
   * portaldaki gibi olsa". Düzen GİB'in kendi belgesinden birebir alındı: satıcı bloğu,
   * kalın çizgiler, "e-Arşiv Fatura" başlığı, Özelleştirme No/Senaryo/Fatura Tipi/No/Tarih
   * tablosu, ETTN satırı ve 11 sütunlu kalem tablosu.
   *
   * FARK AÇIKÇA GÖSTERİLİR: bu belge GİB'de HENÜZ OLUŞMADIĞI için karekod ve fatura
   * numarası YOKTUR; GİB'in "İMZASIZ" filigranının yerinde "TASLAK" filigranı durur.
   * Belge GİB'de oluştuysa zaten GERÇEK GİB görüntüsü gösterilir, bu düzen kullanılmaz.
   */
  private onizleme(d: any, taxpayer?: any): string {
    const tl = (n: any) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const t = new Date(d.faturaTarihi);
    const ik = (n: number) => String(n).padStart(2, '0');
    const tarih = `${ik(t.getDate())}-${ik(t.getMonth() + 1)}-${t.getFullYear()}`;
    const esc = (x: any) => String(x ?? '').replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] as string));
    const tckn = String(d.aliciVkn || '').replace(/\D/g, '').length === 11;
    const cizgi = 'border-top:3px solid #111;margin:10px 0';
    const hucre = 'border:1px solid #999;padding:6px 8px;font-size:12px';
    const bas = 'border:1px solid #999;padding:6px 8px;font-size:12px;font-weight:700;text-align:center;background:#fff';

    return `<!doctype html><meta charset="utf-8">
<div style="font-family:'Times New Roman',Georgia,serif;color:#111;background:#fff;padding:18px 22px;position:relative">
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
    <div style="transform:rotate(-32deg);font-size:96px;font-weight:700;color:rgba(239,68,68,.35);letter-spacing:6px">TASLAK</div>
  </div>

  <div style="${cizgi}"></div>
  <div style="display:flex;gap:18px;align-items:flex-start">
    <div style="flex:1.2;font-size:13px;line-height:1.45">
      <div style="font-weight:700">${esc(this.mukellefAdi(taxpayer))}</div>
      ${taxpayer?.address
        ? `<div>${esc(taxpayer.address)}</div>`
        : `<div style="color:#999;font-style:italic;font-size:12px">adres mükellef kartında boş — gerçek faturada GİB kendi kaydından basar</div>`}
      <div>Tel: ${esc(taxpayer?.phone || '')} Fax:</div>
      <div>Web Sitesi:</div>
      <div>E-Posta: ${esc(taxpayer?.email || '')}</div>
      <div>Vergi Dairesi: ${esc(taxpayer?.taxOffice || '')}</div>
      <div>VKN: ${esc(taxpayer?.taxNumber || '')}</div>
    </div>
    <div style="flex:.8;text-align:center;padding-top:26px">
      <div style="font-size:19px;font-weight:700">e-Arşiv Fatura</div>
    </div>
    <div style="flex:.9;text-align:right">
      <div style="display:inline-block;width:150px;height:150px;border:1px dashed #bbb;color:#999;font-size:11px;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px">
        Karekod<br />GİB'de belge oluşunca gelir
      </div>
    </div>
  </div>
  <div style="${cizgi}"></div>

  <div style="display:flex;gap:18px;align-items:flex-start;margin-top:8px">
    <div style="flex:1.4;font-size:13px;line-height:1.45">
      <div style="font-weight:700">SAYIN</div>
      <div>${esc(d.aliciUnvan)}</div>
      ${d.aliciAdres ? `<div>${esc(d.aliciAdres)}</div>` : ''}
      <div>Web Sitesi:</div>
      <div>E-Posta: ${esc(d.aliciEposta || '')}</div>
      <div>Tel: Fax:</div>
      <div>Vergi Dairesi: ${esc(d.aliciVd || '')}</div>
      <div>${tckn ? 'TCKN' : 'VKN'}: ${esc(d.aliciVkn)}</div>
    </div>
    <div style="flex:1">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="${hucre};font-weight:700">Özelleştirme No:</td><td style="${hucre}">TR1.2</td></tr>
        <tr><td style="${hucre};font-weight:700">Senaryo:</td><td style="${hucre}">EARSIVFATURA</td></tr>
        <tr><td style="${hucre};font-weight:700">Fatura Tipi:</td><td style="${hucre}">SATIS</td></tr>
        <tr><td style="${hucre};font-weight:700">Fatura No:</td><td style="${hucre};color:#999">GİB verecek</td></tr>
        <tr><td style="${hucre};font-weight:700">Fatura Tarihi:</td><td style="${hucre}">${esc(tarih)}</td></tr>
      </table>
    </div>
  </div>
  <div style="${cizgi}"></div>
  <div style="font-size:13px"><b>ETTN:</b> <span style="color:#999">GİB verecek</span></div>

  <table style="width:100%;border-collapse:collapse;margin-top:12px">
    <thead><tr>
      <th style="${bas}">Sıra No</th><th style="${bas}">Mal Hizmet</th><th style="${bas}">Miktar</th>
      <th style="${bas}">Birim Fiyat</th><th style="${bas}">İskonto/<br/>Arttırım Oranı</th>
      <th style="${bas}">İskonto/<br/>Arttırım Tutarı</th><th style="${bas}">İskonto/<br/>Arttırım Nedeni</th>
      <th style="${bas}">KDV Oranı</th><th style="${bas}">KDV Tutarı</th>
      <th style="${bas}">Diğer Vergiler</th><th style="${bas}">Mal Hizmet Tutarı</th>
    </tr></thead>
    <tbody><tr>
      <td style="${hucre};text-align:center">1</td>
      <td style="${hucre}">${esc(d.aciklama)}</td>
      <td style="${hucre};text-align:right">${tl(d.miktar)} ${esc(d.birim)}</td>
      <td style="${hucre};text-align:right">${tl(Number(d.miktar) > 0 ? Number(d.matrah) / Number(d.miktar) : d.matrah)} TL</td>
      <td style="${hucre};text-align:right">%0,00</td>
      <td style="${hucre};text-align:right">0,00 TL</td>
      <td style="${hucre}">İskonto -</td>
      <td style="${hucre};text-align:right">%${tl(d.kdvOrani)}</td>
      <td style="${hucre};text-align:right">${tl(d.kdvTutari)} TL</td>
      <td style="${hucre}"></td>
      <td style="${hucre};text-align:right">${tl(d.matrah)} TL</td>
    </tr></tbody>
  </table>

  <table style="border-collapse:collapse;margin-top:14px;margin-left:auto">
    <tr><td style="${hucre};font-weight:700">Mal Hizmet Toplam Tutarı</td><td style="${hucre};text-align:right">${tl(d.matrah)} TL</td></tr>
    <tr><td style="${hucre};font-weight:700">Toplam İskonto</td><td style="${hucre};text-align:right">0,00 TL</td></tr>
    <tr><td style="${hucre};font-weight:700">Hesaplanan KDV (%${tl(d.kdvOrani)})</td><td style="${hucre};text-align:right">${tl(d.kdvTutari)} TL</td></tr>
    <tr><td style="${hucre};font-weight:700">Vergiler Dahil Toplam Tutar</td><td style="${hucre};text-align:right">${tl(d.toplam)} TL</td></tr>
    <tr><td style="${hucre};font-weight:700">Ödenecek Tutar</td><td style="${hucre};text-align:right;font-weight:700">${tl(d.toplam)} TL</td></tr>
  </table>

  <div style="margin-top:12px;font-size:12px;color:#b91c1c;font-family:system-ui,sans-serif">
    Bu bir ÖNİZLEMEDİR — GİB'e gönderilmemiştir. Fatura numarası ve karekod, belge GİB'de oluştuğunda gelir.
  </div>
</div>`;
  }

}
