import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ButceService, Kimlik } from './butce.service';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_DEFAULT } from '../common/max-inference';

/**
 * Bütçe modülünün yapay zekâ katmanı.
 *
 * Kaynak: Max aboneliği (CLAUDE_CODE_OAUTH_TOKEN) — ücretli ANTHROPIC_API_KEY KULLANILMAZ.
 * Model, kişinin KENDİ verisini yorumlar; yatırım tavsiyesi vermez, borç maliyeti
 * matematiği ve harcama davranışı üzerinden konuşur.
 */
@Injectable()
export class ButceAiService {
  private readonly logger = new Logger(ButceAiService.name);

  constructor(
    private prisma: PrismaService,
    private butce: ButceService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  private static readonly SISTEM = [
    'Sen deneyimli bir kişisel finans danışmanısın. Türkiye koşullarını bilirsin:',
    'kredi kartı faizi kredilerden çok pahalıdır, asgari ödeme tuzaktır, gecikme',
    'faizi kredi notunu bozar.',
    '',
    'KURALLAR:',
    '- Sade Türkçe konuş, jargon kullanma. Kısa ve net ol.',
    '- Rakamları kullanıcının kendi verisinden al, UYDURMA. Veri yoksa "veri yok" de.',
    '- Yatırım tavsiyesi (hisse, döviz, kripto, fon) VERME. Konu borç ve bütçe yönetimi.',
    '- Tutarları TL olarak, binlik ayraçla yaz.',
    '- Somut ol: "tasarruf et" deme, "şu kalemde şu kadar fazla harcamışsın" de.',
    '- En fazla 6 madde yaz. Her madde tek cümle olsun.',
    '',
    'BİÇİM (portal ekranında düz metin olarak gösterilir):',
    '- Markdown KULLANMA: #, ##, **kalın**, ---, tablo (| ... |), kod bloğu YOK.',
    '- Bölüm başlığı gerekiyorsa yalnız kısa bir satır yaz ve sonuna iki nokta koy. Örn: "Bu ay:"',
    '- Maddeler için satır başına tek tire kullan: "- Market harcaman 4.200 TL."',
    '- Yıldız, boru işareti, alt çizgi gibi süs karakterleri kullanma.',
    '- Ard arda boş satır bırakma; her bölüm arasında tek boş satır yeter.',
  ].join('\n');

  /** Aylık gelir-gider yorumu: nereye para gitmiş, ne değişmiş, ne yapılmalı */
  async aylikYorum(k: Kimlik, donem: string, yenile = false) {
    if (!yenile) {
      const onceki = await this.sonRapor(k, 'AYLIK_YORUM', donem);
      if (onceki) return onceki;
    }
    const ozet = await this.butce.ozet(k, donem);
    const girdi = {
      donem,
      gelir: ozet.gelir,
      gider: ozet.gider,
      net: ozet.net,
      zorunluGider: ozet.zorunluGider,
      istegeBagliGider: ozet.istegeBagliGider,
      kategoriKirilim: ozet.kategoriKirilim,
      son6AyTrend: ozet.trend,
      borcOzet: ozet.borcOzet,
    };
    const prompt = [
      `${donem} dönemi kişisel bütçe verim aşağıda (JSON).`,
      'Bunu yorumla:',
      '1) Bu ay para nereye gitmiş, dikkat çeken kalem hangisi?',
      '2) Önceki aylara göre ne değişmiş (trend verisini kullan)?',
      '3) Borç ödeme kapasitesini artırmak için en gerçekçi 2 hamle ne?',
      '',
      JSON.stringify(girdi),
    ].join('\n');

    return this.calistirVeKaydet(k, { tur: 'AYLIK_YORUM', donem, prompt, girdiOzet: girdi });
  }

  /** Ödeme planı yorumu: motorun çıkardığı planı insan diliyle açıklar */
  async planYorum(k: Kimlik, yenile = false) {
    const donem = new Date().toISOString().slice(0, 7);
    if (!yenile) {
      const onceki = await this.sonRapor(k, 'PLAN_YORUM', donem);
      if (onceki) return onceki;
    }
    const plan = await this.butce.plan(k, {});
    const girdi = {
      aylikKapasite: plan.kapasite,
      strateji: plan.strateji,
      borclar: plan.kalemler.map((x) => ({
        ad: x.ad,
        tip: x.tip,
        kalan: x.kalan,
        aylikFaizYuzde: Math.round(x.aylikFaiz * 10000) / 100,
      })),
      buAyOdemeDagilimi: plan.secilen.ilkAy,
      kapanisAyi: plan.secilen.ayAdedi,
      toplamFaiz: plan.secilen.toplamFaiz,
      aylikAcik: plan.secilen.acik,
      kapanmiyor: plan.secilen.kapanmiyor,
      karsilastirma: {
        cigFaiz: plan.karsilastirma.cig.toplamFaiz,
        cigAy: plan.karsilastirma.cig.ayAdedi,
        kartopuFaiz: plan.karsilastirma.kartopu.toplamFaiz,
        kartopuAy: plan.karsilastirma.kartopu.ayAdedi,
      },
    };
    const prompt = [
      'Borç ödeme planım aşağıda (JSON). Hesaplamayı ben yaptım, sen yorumla:',
      '1) Bu ay hangi borca neden bu kadar ödemeliyim, tek cümleyle gerekçesi ne?',
      '2) İki strateji arasındaki fark bana ne kazandırıyor?',
      '3) Aylık açık varsa ya da borç kapanmıyorsa, ne yapmalıyım?',
      'Rakamları JSON’dan aynen kullan.',
      '',
      JSON.stringify(girdi),
    ].join('\n');

    return this.calistirVeKaydet(k, { tur: 'PLAN_YORUM', donem, prompt, girdiOzet: girdi });
  }

  /** Serbest soru: "bu ay ne kadar harcadım", "hangi kartı önce kapatmalıyım" */
  async soru(k: Kimlik, soru: string) {
    const donem = new Date().toISOString().slice(0, 7);
    const [ozet, plan] = await Promise.all([this.butce.ozet(k, donem), this.butce.plan(k, {})]);
    const girdi = {
      buAy: {
        donem,
        gelir: ozet.gelir,
        gider: ozet.gider,
        net: ozet.net,
        kategoriKirilim: ozet.kategoriKirilim,
      },
      trend: ozet.trend,
      borclar: plan.kalemler,
      yaklasanOdemeler: ozet.yaklasanOdemeler.map((e: any) => ({
        kart: `${e.kart?.bankaAdi} ${e.kart?.kartAdi}`,
        donem: e.donem,
        sonOdemeTarihi: e.sonOdemeTarihi,
        borcTutari: e.borcTutari,
        kalanTutar: e.kalanTutar,
        durum: e.durum,
      })),
      plan: { kapasite: plan.kapasite, buAy: plan.secilen.ilkAy, kapanisAyi: plan.secilen.ayAdedi },
    };
    const prompt = [
      'Kişisel finans verim aşağıda (JSON). Soruma SADECE bu veriye dayanarak cevap ver.',
      'Veride olmayan bir şey sorulursa "bu bilgi sistemde yok" de.',
      '',
      `SORU: ${soru}`,
      '',
      JSON.stringify(girdi),
    ].join('\n');

    return this.calistirVeKaydet(k, { tur: 'SORU', donem, soru, prompt, girdiOzet: null });
  }

  /* ===================== ORTAK ===================== */

  private async sonRapor(k: Kimlik, tur: string, donem: string) {
    const r = await this.db.butceAiRapor.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId, tur, donem },
      orderBy: { createdAt: 'desc' },
    });
    if (!r) return null;
    // 12 saatten eski yorumları bayat say
    if (Date.now() - new Date(r.createdAt).getTime() > 12 * 3600 * 1000) return null;
    return { ...r, onbellek: true };
  }

  private async calistirVeKaydet(
    k: Kimlik,
    p: { tur: string; donem?: string; soru?: string; prompt: string; girdiOzet: any },
  ) {
    if (!isMaxAvailable()) {
      return {
        tur: p.tur,
        donem: p.donem,
        icerik:
          'Yapay zekâ yorumu şu an kullanılamıyor (Max aboneliği bağlı değil). Rakamlar ve plan tablosu etkilenmez.',
        model: 'yok',
        hata: true,
        createdAt: new Date(),
      };
    }
    const sonuc = await claudeTextViaMax({
      prompt: p.prompt,
      system: ButceAiService.SISTEM,
      model: MAX_MODEL_DEFAULT,
      timeoutMs: 120000,
    });
    if (!sonuc.ok || !sonuc.text.trim()) {
      this.logger.warn(`[ButceAI] ${p.tur} başarısız: ${sonuc.error}`);
      return {
        tur: p.tur,
        donem: p.donem,
        icerik: `Yorum üretilemedi: ${sonuc.error || 'bilinmeyen hata'}`,
        model: sonuc.model,
        hata: true,
        createdAt: new Date(),
      };
    }
    return this.db.butceAiRapor.create({
      data: {
        tenantId: k.tenantId,
        userId: k.userId,
        tur: p.tur,
        donem: p.donem || null,
        soru: p.soru || null,
        icerik: sonuc.text.trim(),
        model: sonuc.model,
        girdiOzet: p.girdiOzet ?? undefined,
      },
    });
  }

  async gecmis(k: Kimlik, tur?: string) {
    const where: any = { tenantId: k.tenantId, userId: k.userId };
    if (tur) where.tur = tur;
    return this.db.butceAiRapor.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }
}
