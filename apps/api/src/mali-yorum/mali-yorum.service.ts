import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MizanService } from '../mizan/mizan.service';
import { BilancoService } from '../mizan/bilanco.service';
import { GelirTablosuService } from '../mizan/gelir-tablosu.service';
import { IsletmeHesapOzetiService } from '../isletme-hesap-ozeti/isletme-hesap-ozeti.service';
import { claudeTextViaMax, MAX_MODEL_DEFAULT, isMaxAvailable } from '../common/max-inference';

export type MaliYorumKaynak = 'MIZAN' | 'BILANCO' | 'GELIR_TABLOSU' | 'IHO';
const GECERLI_KAYNAKLAR: MaliYorumKaynak[] = ['MIZAN', 'BILANCO', 'GELIR_TABLOSU', 'IHO'];

/**
 * MALİ YORUM — Yapay zeka değerlendirmesi.
 * Mizan / Bilanço / Gelir Tablosu / İşletme Hesap Özeti verisini OKUR (asla
 * değiştirmez), bir mali müşavir gözüyle sade Türkçe değerlendirme üretir,
 * sonucu saklar. Yeniden üretmek "force" ister. AI yolu SADECE Max (ücretli
 * API yok).
 */
@Injectable()
export class MaliYorumService {
  private readonly logger = new Logger('MaliYorum');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mizanService: MizanService,
    private readonly bilancoService: BilancoService,
    private readonly gelirTablosuService: GelirTablosuService,
    private readonly isletmeService: IsletmeHesapOzetiService,
  ) {}

  private normKaynak(k: string): MaliYorumKaynak {
    const up = String(k || '').toUpperCase() as MaliYorumKaynak;
    if (!GECERLI_KAYNAKLAR.includes(up)) {
      throw new BadRequestException(`Geçersiz kaynak: ${k}`);
    }
    return up;
  }

  /** Kayıtlı değerlendirmeyi getir (yoksa null). */
  async get(tenantId: string, kaynak: string, kaynakId: string) {
    const k = this.normKaynak(kaynak);
    const row = await (this.prisma as any).maliYorum.findUnique({
      where: { tenantId_kaynak_kaynakId: { tenantId, kaynak: k, kaynakId } },
    });
    return row || null;
  }

  /**
   * Değerlendirme üret. force=false ve kayıt varsa mevcut kaydı döner (hızlı
   * açılış). force=true her seferinde yeniden üretir.
   */
  async generate(tenantId: string, kaynak: string, kaynakId: string, force = false) {
    const k = this.normKaynak(kaynak);

    if (!force) {
      const mevcut = await this.get(tenantId, k, kaynakId);
      if (mevcut) return mevcut;
    }

    if (!isMaxAvailable()) {
      throw new BadRequestException(
        'Yapay zeka bağlı değil (Max token yok) — değerlendirme üretilemedi.',
      );
    }

    const { taxpayerId, donem, mukellefAdi, veriMetni, tabloAdi } =
      await this.kaynakVerisiHazirla(tenantId, k, kaynakId);

    const system = this.sistemPromptu(tabloAdi);
    const prompt = `Mükellef: ${mukellefAdi}\nDönem: ${donem || '—'}\n\n${veriMetni}`;

    const sonuc = await claudeTextViaMax({
      prompt,
      system,
      model: MAX_MODEL_DEFAULT, // Sonnet — mali müşavir seviyesinde akıl yürütme
      timeoutMs: 90_000,
    });

    if (!sonuc.ok || !sonuc.text.trim()) {
      const neden = sonuc.authExpired
        ? 'Max oturumunun süresi dolmuş — yenilenmeli.'
        : sonuc.error || 'yapay zeka yanıt vermedi';
      throw new BadRequestException(`Değerlendirme üretilemedi: ${neden}`);
    }

    const row = await (this.prisma as any).maliYorum.upsert({
      where: { tenantId_kaynak_kaynakId: { tenantId, kaynak: k, kaynakId } },
      create: {
        tenantId,
        taxpayerId,
        kaynak: k,
        kaynakId,
        donem: donem || null,
        ozet: sonuc.text.trim(),
        model: sonuc.model,
      },
      update: {
        ozet: sonuc.text.trim(),
        model: sonuc.model,
        donem: donem || null,
      },
    });
    this.logger.log(`Mali yorum üretildi: ${k} · ${kaynakId} · ${sonuc.model}`);
    return row;
  }

  // ==================== VERİ HAZIRLAMA ====================

  private async kaynakVerisiHazirla(
    tenantId: string,
    kaynak: MaliYorumKaynak,
    kaynakId: string,
  ): Promise<{
    taxpayerId: string;
    donem: string | null;
    mukellefAdi: string;
    veriMetni: string;
    tabloAdi: string;
  }> {
    if (kaynak === 'MIZAN') {
      const m = await this.mizanService.getMizan(kaynakId, tenantId);
      return {
        taxpayerId: m.taxpayerId,
        donem: this.donemEtiketi(m.donem, m.donemTipi),
        mukellefAdi: this.mukellefAdi(m.taxpayer),
        veriMetni: this.mizanMetni(m),
        tabloAdi: 'mizan',
      };
    }
    if (kaynak === 'BILANCO') {
      const b = await this.bilancoService.getBilanco(kaynakId, tenantId);
      return {
        taxpayerId: b.taxpayerId,
        donem: this.donemEtiketi(b.donem, b.donemTipi),
        mukellefAdi: this.mukellefAdi(b.taxpayer),
        veriMetni: this.bilancoMetni(b),
        tabloAdi: 'bilanço',
      };
    }
    if (kaynak === 'GELIR_TABLOSU') {
      const g = await this.gelirTablosuService.getGelirTablosu(kaynakId, tenantId);
      return {
        taxpayerId: g.taxpayerId,
        donem: this.donemEtiketi(g.donem, g.donemTipi),
        mukellefAdi: this.mukellefAdi(g.taxpayer),
        veriMetni: this.gelirMetni(g),
        tabloAdi: 'gelir tablosu',
      };
    }
    // IHO — kaynakId = "taxpayerId:yil"
    const [taxpayerId, yilStr] = String(kaynakId).split(':');
    const yil = parseInt(yilStr, 10);
    if (!taxpayerId || !Number.isFinite(yil)) {
      throw new BadRequestException('İşletme Hesap Özeti için kaynakId "taxpayerId:yil" olmalı.');
    }
    const y = await this.isletmeService.getYil(tenantId, taxpayerId, yil);
    return {
      taxpayerId,
      donem: `${yil}`,
      mukellefAdi: this.mukellefAdi(y.taxpayer),
      veriMetni: this.ihoMetni(y, yil),
      tabloAdi: 'işletme hesap özeti',
    };
  }

  // ==================== METİN SERİLEŞTİRİCİLER ====================

  private mizanMetni(m: any): string {
    const L: string[] = [];
    L.push(
      `MİZAN ÖZETİ — Toplam Borç: ${this.tl(m.toplamBorc)} | Toplam Alacak: ${this.tl(
        m.toplamAlacak,
      )} | Borç Bakiye: ${this.tl(m.toplamBorcBakiye)} | Alacak Bakiye: ${this.tl(
        m.toplamAlacakBakiye,
      )}`,
    );

    // Ana hesaplar (seviye 0 / üç basamaklı) — bakiyesi olanlar
    const hesaplar: any[] = Array.isArray(m.hesaplar) ? m.hesaplar : [];
    const ana = hesaplar
      .filter((h) => {
        const bb = this.n(h.borcBakiye);
        const ab = this.n(h.alacakBakiye);
        return (bb !== 0 || ab !== 0) && String(h.hesapKodu || '').replace(/\D/g, '').length <= 3;
      })
      .slice(0, 90);
    if (ana.length) {
      L.push('\nANA HESAPLAR (kod · ad · borç bakiye / alacak bakiye):');
      for (const h of ana) {
        L.push(
          `${h.hesapKodu} · ${h.hesapAdi} · ${this.tl(h.borcBakiye)} / ${this.tl(h.alacakBakiye)}`,
        );
      }
    }

    // Denetim bulguları
    const an: any[] = Array.isArray(m.anomaliler) ? m.anomaliler : [];
    if (an.length) {
      L.push(`\nSİSTEMİN DENETİM BULGULARI (${an.length} adet — kural motoru):`);
      for (const a of an.slice(0, 60)) {
        L.push(`[${a.seviye || '—'}] ${a.mesaj}`);
      }
    } else {
      L.push('\nSİSTEMİN DENETİM BULGULARI: yok.');
    }
    return this.kirp(L.join('\n'));
  }

  private bilancoMetni(b: any): string {
    const L: string[] = [];
    L.push('BİLANÇO ÖZETİ:');
    L.push(`Dönen Varlıklar: ${this.tl(b.donenVarliklar)}`);
    L.push(`Duran Varlıklar: ${this.tl(b.duranVarliklar)}`);
    L.push(`Aktif Toplamı: ${this.tl(b.aktifToplami)}`);
    L.push(`Kısa Vadeli Yabancı Kaynak: ${this.tl(b.kvYabanciKaynak)}`);
    L.push(`Uzun Vadeli Yabancı Kaynak: ${this.tl(b.uvYabanciKaynak)}`);
    L.push(`Özkaynaklar: ${this.tl(b.ozkaynaklar)}`);
    L.push(`Pasif Toplamı: ${this.tl(b.pasifToplami)}`);

    const o = b.oranlar || {};
    if (o && typeof o === 'object') {
      L.push('\nFİNANSAL ORANLAR:');
      const oranAd: Record<string, string> = {
        cari: 'Cari oran',
        asitTest: 'Asit-test',
        nakit: 'Nakit oran',
        kaldirac: 'Kaldıraç',
        ozkaynak: 'Özkaynak oranı',
        borcOzk: 'Borç/Özkaynak',
        roa: 'Aktif kârlılık (ROA)',
        roe: 'Özkaynak kârlılığı (ROE)',
        karMarji: 'Net kâr marjı',
      };
      for (const [key, ad] of Object.entries(oranAd)) {
        const v = o[key];
        if (v !== undefined && v !== null && Number(v) !== 0) {
          L.push(`${ad}: ${this.oran(v)}`);
        }
      }
    }
    if (b.genelYorum) L.push(`\nSİSTEMİN OTOMATİK NOTU: ${b.genelYorum}`);
    return this.kirp(L.join('\n'));
  }

  private gelirMetni(g: any): string {
    const L: string[] = [];
    L.push('GELİR TABLOSU ÖZETİ:');
    L.push(`Brüt Satışlar: ${this.tl(g.brutSatislar)}`);
    L.push(`Net Satışlar: ${this.tl(g.netSatislar)}`);
    L.push(`Satışların Maliyeti: ${this.tl(g.satisMaliyeti)}`);
    L.push(`Brüt Satış Kârı: ${this.tl(g.brutKar ?? g.brutSatisKari)}`);
    L.push(`Faaliyet Kârı: ${this.tl(g.faaliyetKari)}`);
    L.push(`Dönem Kârı: ${this.tl(g.donemKari)}`);
    L.push(`Dönem Net Kârı: ${this.tl(g.donemNetKari)}`);

    const gv = g.geciciVergiHesabi || {};
    if (gv && typeof gv === 'object') {
      L.push('\nGEÇİCİ VERGİ:');
      if (gv.matrah !== undefined) L.push(`Matrah: ${this.tl(gv.matrah)}`);
      if (gv.hesaplananGecVergi !== undefined)
        L.push(`Hesaplanan geçici vergi: ${this.tl(gv.hesaplananGecVergi)}`);
      if (gv.odenecekGecVergi !== undefined)
        L.push(`Ödenecek geçici vergi: ${this.tl(gv.odenecekGecVergi)}`);
    }
    return this.kirp(L.join('\n'));
  }

  private ihoMetni(y: any, yil: number): string {
    const L: string[] = [];
    L.push(`İŞLETME HESAP ÖZETİ — ${yil} (çeyrek çeyrek):`);
    const ceyrekler: any[] = Array.isArray(y.ceyrekler) ? y.ceyrekler : [];
    ceyrekler.forEach((c, i) => {
      const q = i + 1;
      if (!c) {
        L.push(`\nQ${q}: veri yok`);
        return;
      }
      L.push(`\nQ${q}:`);
      L.push(`  Satış hasılatı: ${this.tl(c.satisHasilati)}`);
      L.push(`  Diğer gelir: ${this.tl(c.digerGelir)}`);
      L.push(`  Mal alışı: ${this.tl(c.malAlisi)}`);
      L.push(`  Dönem başı stok: ${this.tl(c.donemBasiStok)}`);
      L.push(`  Satılan mal maliyeti: ${this.tl(c.satilanMalMaliyeti)}`);
      L.push(`  Kalan stok: ${this.tl(c.kalanStok)}`);
      L.push(`  Dönem içi giderler: ${this.tl(c.donemIciGiderler)}`);
      L.push(`  Dönem kârı: ${this.tl(c.donemKari)}`);
      L.push(`  Geçici vergi matrahı: ${this.tl(c.gecVergiMatrahi)}`);
      L.push(`  Ödenecek geçici vergi: ${this.tl(c.odenecekGecVergi)}`);
    });
    return this.kirp(L.join('\n'));
  }

  // ==================== PROMPT ====================

  private sistemPromptu(tabloAdi: string): string {
    return [
      'Sen Türkiye’de çalışan, deneyimli bir Serbest Muhasebeci Mali Müşavirsin (SMMM).',
      `Sana bir mükellefin ${tabloAdi} verisi veriliyor. Bütün rakamlara bakıp gerçek bir mali müşavir gibi kısa ve sade bir değerlendirme yaz.`,
      '',
      'Kurallar:',
      '- Sade Türkçe kullan, gereksiz jargon yok; mükellefe/patrona anlatır gibi net konuş.',
      '- SADECE sana verilen rakamlara dayan. Olmayan hesabı/veriyi varmış gibi yorumlama, uydurma.',
      '- Vergi/mevzuat konusunda kesin hüküm verme; “dikkat edilmeli / kontrol edilmeli” diye işaret et.',
      '- Sistemin denetim bulguları verildiyse onları da değerlendir, önemlileri öne çıkar.',
      '- Kısa tut. Şu üç başlıkla, madde madde yaz:',
      '',
      'Genel durum: (1-2 cümle)',
      'Dikkat çekenler: (en fazla 5 madde; gerçekten bir sorun yoksa “belirgin bir sorun görünmüyor” yaz)',
      'Öneri: (en fazla 4 madde)',
    ].join('\n');
  }

  // ==================== YARDIMCILAR ====================

  private n(v: any): number {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }

  private tl(v: any): string {
    const x = this.n(v);
    return x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
  }

  private oran(v: any): string {
    const x = this.n(v);
    return x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private mukellefAdi(tp: any): string {
    if (!tp) return 'Mükellef';
    return (
      tp.companyName ||
      [tp.firstName, tp.lastName].filter(Boolean).join(' ') ||
      'Mükellef'
    );
  }

  private donemEtiketi(donem?: string, donemTipi?: string): string | null {
    if (!donem) return donemTipi || null;
    return donemTipi ? `${donem} · ${donemTipi}` : donem;
  }

  private kirp(s: string, max = 9000): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + '\n…(kısaltıldı)';
  }
}
