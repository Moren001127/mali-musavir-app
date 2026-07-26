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
      timeoutMs: 90_000, // kompakt özet prompt — kısa sürede biter
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

    // ANA HESAP ÖZETİ — bakiyesi olan sınıf/grup/ana hesaplar (kod ≤ 3 hane).
    // Mali müşavir mizanı bu seviyede değerlendirir; 549 gibi ana hesaplar burada
    // görünür. Tüm 600 detay (100.01.001) leaf'i GÖNDERMEYİZ — gereksiz büyük prompt
    // limiti yer ve zaman aşımına sokar; tespiti zaten kural motoru + bu özet sağlar.
    // Sınır yok (cap yüksek) — hiçbir ana hesap atlanmaz.
    const hesaplar: any[] = Array.isArray(m.hesaplar) ? m.hesaplar : [];
    const ana = hesaplar
      .filter((h) => {
        const bb = this.n(h.borcBakiye);
        const ab = this.n(h.alacakBakiye);
        return (bb !== 0 || ab !== 0) && String(h.hesapKodu || '').replace(/\D/g, '').length <= 3;
      })
      .sort((a, b) => String(a.hesapKodu || '').localeCompare(String(b.hesapKodu || ''), 'tr'));
    if (ana.length) {
      L.push(
        `\nANA HESAP ÖZETİ — bakiyesi olan ${ana.length} hesap (kod hiyerarşik: ` +
          `1=sınıf, 10=grup, 100=ana hesap; üst kod alt kırılımların TOPLAMIDIR — çift sayma). ` +
          `Biçim: kod · ad · Borç bakiye / Alacak bakiye:`,
      );
      for (const h of ana.slice(0, 250)) {
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
    return this.kirp(L.join('\n'), 15000);
  }

  private bilancoMetni(b: any): string {
    const L: string[] = [];
    L.push('BİLANÇO ÖZETİ:');
    L.push(`Dönen Varlıklar: ${this.tl(b.donenVarliklar)}`);
    L.push(`Duran Varlıklar: ${this.tl(b.duranVarliklar)}`);
    L.push(`AKTİF TOPLAMI: ${this.tl(b.aktifToplami)}`);
    L.push(`Kısa Vadeli Yabancı Kaynak: ${this.tl(b.kvYabanciKaynak)}`);
    L.push(`Uzun Vadeli Yabancı Kaynak: ${this.tl(b.uvYabanciKaynak)}`);
    L.push(`Özkaynaklar: ${this.tl(b.ozkaynaklar)}`);
    L.push(`PASİF TOPLAMI: ${this.tl(b.pasifToplami)}`);
    const fark = this.n(b.aktifToplami) - this.n(b.pasifToplami);
    L.push(`Denklik farkı (aktif−pasif): ${this.tl(fark)}`);

    // AKTİF ve PASİF kalemleri — her grubun toplamı + altındaki hesaplar
    const aktifSat = this.bilancoBolum(b.aktif);
    if (aktifSat.length) {
      L.push('\nAKTİF (grup · toplam; altında hesaplar):');
      L.push(...aktifSat);
    }
    const pasifSat = this.bilancoBolum(b.pasif);
    if (pasifSat.length) {
      L.push('\nPASİF (grup · toplam; altında hesaplar):');
      L.push(...pasifSat);
    }

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
    return this.kirp(L.join('\n'), 30000);
  }

  /** Bilanço aktif/pasif nesnesini (grup → {grup,toplam,hesaplar[]}) satırlara döker. */
  private bilancoBolum(obj: any): string[] {
    const L: string[] = [];
    if (!obj || typeof obj !== 'object') return L;
    for (const v of Object.values(obj) as any[]) {
      if (!v || typeof v !== 'object') continue;
      const toplam = this.n(v.toplam);
      const hesaplar = Array.isArray(v.hesaplar) ? v.hesaplar : [];
      if (toplam === 0 && hesaplar.length === 0) continue;
      L.push(`  ${v.grup || v.kodRange || ''} · ${this.tl(toplam)}`);
      for (const h of hesaplar) {
        L.push(`      ${h.kod} ${h.ad} · ${this.tl(h.tutar)}`);
      }
    }
    return L;
  }

  private gelirMetni(g: any): string {
    const L: string[] = [];
    L.push('GELİR TABLOSU (tüm satırlar):');
    L.push(`Brüt Satışlar: ${this.tl(g.brutSatislar)}`);
    L.push(`Satış İndirimleri (−): ${this.tl(g.satisIndirimleri)}`);
    L.push(`Net Satışlar: ${this.tl(g.netSatislar)}`);
    L.push(`Satışların Maliyeti (−): ${this.tl(g.satisMaliyeti)}`);
    L.push(`Brüt Satış Kârı: ${this.tl(g.brutSatisKari ?? g.brutKar)}`);
    L.push(`Faaliyet Giderleri (−): ${this.tl(g.faaliyetGiderleri)}`);
    L.push(`Faaliyet Kârı: ${this.tl(g.faaliyetKari)}`);
    L.push(`Diğer Faaliyetlerden Gelirler: ${this.tl(g.digerGelirler)}`);
    L.push(`Diğer Faaliyetlerden Giderler (−): ${this.tl(g.digerGiderler)}`);
    L.push(`Finansman Giderleri (−): ${this.tl(g.finansmanGiderleri)}`);
    L.push(`Olağan Kâr: ${this.tl(g.olaganKar)}`);
    L.push(`Olağandışı Gelir: ${this.tl(g.olaganDisiGelir)}`);
    L.push(`Olağandışı Gider (−): ${this.tl(g.olaganDisiGider)}`);
    L.push(`Dönem Kârı: ${this.tl(g.donemKari)}`);
    L.push(`Dönem Vergi Karşılığı (−): ${this.tl(g.vergiKarsiligi)}`);
    L.push(`DÖNEM NET KÂRI: ${this.tl(g.donemNetKari)}`);

    // KKEG (varsa detay içinde)
    const detay = g.detay || {};
    if (detay.kkeg !== undefined && this.n(detay.kkeg) !== 0) {
      L.push(`Kanunen Kabul Edilmeyen Giderler (KKEG): ${this.tl(detay.kkeg)}`);
    }
    // Satışların maliyeti kaynağı (621 manuel vs otomatik)
    if (g.stokMaliyetOzet && typeof g.stokMaliyetOzet === 'object') {
      const s = g.stokMaliyetOzet;
      if (s.toplamStok !== undefined) L.push(`Toplam Stok: ${this.tl(s.toplamStok)}`);
      if (s.satisMaliyeti !== undefined) L.push(`Manuel SMM: ${this.tl(s.satisMaliyeti)}`);
    }

    const gv = g.geciciVergiHesabi || {};
    if (gv && typeof gv === 'object') {
      L.push('\nGEÇİCİ VERGİ:');
      if (gv.donemNetKari !== undefined) L.push(`Dönem net kârı: ${this.tl(gv.donemNetKari)}`);
      if (gv.matrah !== undefined) L.push(`Matrah: ${this.tl(gv.matrah)}`);
      if (gv.hesaplananGecVergi !== undefined)
        L.push(`Hesaplanan geçici vergi: ${this.tl(gv.hesaplananGecVergi)}`);
      if (gv.oncekiOdenenGecVergi !== undefined)
        L.push(`Önceki dönem ödenen: ${this.tl(gv.oncekiOdenenGecVergi)}`);
      if (gv.odenecekGecVergi !== undefined)
        L.push(`Ödenecek geçici vergi: ${this.tl(gv.odenecekGecVergi)}`);
    }
    return this.kirp(L.join('\n'), 20000);
  }

  private ihoMetni(y: any, yil: number): string {
    const L: string[] = [];
    L.push(`İŞLETME HESAP ÖZETİ — ${yil} (çeyrek çeyrek):`);
    const ceyrekler: any[] = Array.isArray(y.ceyrekler) ? y.ceyrekler : [];
    ceyrekler.forEach((c, i) => {
      const q = i + 1;
      if (!c) {
        L.push(`\n${q}. dönem: veri yok`);
        return;
      }
      L.push(`\n${q}. dönem:`);
      L.push(`  Satış hasılatı: ${this.tl(c.satisHasilati)}`);
      L.push(`  Diğer gelir: ${this.tl(c.digerGelir)}`);
      L.push(`  Mal alışı: ${this.tl(c.malAlisi)}`);
      L.push(`  Dönem başı stok: ${this.tl(c.donemBasiStok)}`);
      L.push(`  Toplam stok (dönem başı+alış): ${this.tl(c.toplamStok)}`);
      L.push(`  Satılan malın maliyeti: ${this.tl(c.satilanMalMaliyeti)}`);
      L.push(`  Kalan stok: ${this.tl(c.kalanStok)}`);
      L.push(`  Net satışlar: ${this.tl(c.netSatislar)}`);
      L.push(`  Dönem içi giderler: ${this.tl(c.donemIciGiderler)}`);
      L.push(`  Dönem kârı: ${this.tl(c.donemKari)}`);
      L.push(`  Geçmiş yıl zararı (mahsup): ${this.tl(c.gecmisYilZarari)}`);
      L.push(`  Geçici vergi matrahı: ${this.tl(c.gecVergiMatrahi)}`);
      L.push(`  Hesaplanan geçici vergi: ${this.tl(c.hesaplananGecVergi)}`);
      L.push(`  Önceki dönem ödenen geçici vergi: ${this.tl(c.oncekiOdenenGecVergi)}`);
      L.push(`  Ödenecek geçici vergi: ${this.tl(c.odenecekGecVergi)}`);
    });
    return this.kirp(L.join('\n'), 20000);
  }

  // ==================== PROMPT ====================

  private sistemPromptu(tabloAdi: string): string {
    const L = [
      'Sen Türkiye’de çalışan, deneyimli bir Serbest Muhasebeci Mali Müşavirsin (SMMM).',
      `Sana bir mükellefin ${tabloAdi} verisi veriliyor. Gerçek bir mali müşavir titizliğiyle değerlendir.`,
      '',
      'Kurallar:',
      '- Sade Türkçe kullan, gereksiz jargon yok; mükellefe/patrona anlatır gibi net konuş.',
      '- SADECE sana verilen rakamlara dayan. Olmayan hesabı/veriyi varmış gibi yorumlama, uydurma.',
      '- Vergi/mevzuat konusunda kesin hüküm verme; “dikkat edilmeli / kontrol edilmeli” diye işaret et.',
      '- Sistemin denetim bulguları verildiyse onları da değerlendir, önemlileri öne çıkar.',
      '- Bulguları önem sırasına göre yaz ve ÖNEMLİ olanların HEPSİNİ yaz — sayıyla sınırlama.',
      '- Çıktın KISA ve öz olsun: hesapları tek tek listeleme, düşünce adımlarını yazma; SADECE bulgu ve önerileri ver.',
      '- Dönemi ASLA "Q1/Q2" diye yazma; "1. dönem, 2. dönem" biçimini kullan.',
    ];

    if (tabloAdi === 'mizan') {
      L.push(
        '- MİZANI BAŞTAN SONA, hesap grubu grubu tara — sadece göze çarpanları değil, verilen TÜM bakiyeli hesapları geç.',
        '- Bakiyesi olan her hesap için o hesaba ÖZGÜ kontrolü yap. Uygun düştükçe şunları KAÇIRMA:',
        '   • Kasa (100) negatif/alacak bakiye, banka (102) ters bakiye',
        '   • 120/320 alıcı-satıcı: dönem satışına göre büyükse yaşlandırma; şüpheli alacak (128/129) karşılığı gerekli mi',
        '   • 131/331 ortaklar cari: örtülü sermaye (KVK 12) ve örtülü kazanç riski, ortağa para verilmiş mi',
        '   • 15x stok tutarlılığı (alacak/negatif stok)',
        '   • 25x sabit kıymet + 257 birikmiş amortisman ayrılmış mı',
        '   • 191/391 KDV mahsup/beyan tamamlanmış mı',
        '   • 7’li maliyet hesapları (70x-78x) dönem sonunda yansıtma ile kapanmış mı (net sıfır)',
        '   • 360/361/368 vergi-SGK ve 335 personel borçları: birikmiş/gecikmiş yükümlülük',
        '   • Karşılıklar: kıdem tazminatı (472/372), şüpheli ticari alacak karşılığı',
        '   • 549 ÖZEL FONLAR / yenileme fonu: yenileme fonu ayrıldığı yıldan itibaren 3 YIL içinde kullanılmazsa dönem kârına eklenir (VUK 328) — süre dolmuş mu, uyar',
        '   • 5xx özkaynak: sermaye (500/501 ödenmemiş), geçmiş yıl kâr/zarar devri, TTK 376 sermaye kaybı/teknik iflas',
        '   • 18x/28x/38x/48x peşin ödenen/tahsil edilen gelir-gider, reeskont ve dönemsellik',
        '- Mizan hesap kodları hiyerarşiktir; ana hesap alt kırılımların toplamıdır, aynı tutarı iki kez sayma.',
      );
    }

    if (tabloAdi === 'işletme hesap özeti') {
      L.push(
        '- Çeyrekleri kümülatif oku (işletme defteri/basit usul mükellef); dört çeyreği birlikte değerlendir.',
        '- Şunları KONTROL ET: dönem kârı negatif/zarar mı; stok mantığı tutuyor mu (kalan stok = dönem başı stok + mal alışı − satılan malın maliyeti); dönem içi giderler satışa göre orantılı mı; geçmiş yıl zararı mahsubu (kurumlarda 5 yıl kuralı) doğru mu; geçici vergi zinciri (matrah → hesaplanan → önceki ödenen → ödenecek) çeyrekler arası tutarlı mı.',
      );
    }

    if (tabloAdi === 'bilanço') {
      L.push(
        '- Verilen aktif/pasif kalemlerini tek tek geç; likidite, borç/özkaynak dengesi, ortaklar cari, karşılıklar ve dönem kâr/zarar aktarımına bak.',
      );
    }

    if (tabloAdi === 'gelir tablosu') {
      L.push(
        '- Brüt kâr marjı, faaliyet gideri oranı, finansman yükü ve dönem net kârını değerlendir; geçici vergi matrahı ve hesabı tutarlı mı bak.',
      );
    }

    L.push(
      '',
      'Şu üç başlıkla, madde madde yaz:',
      '',
      'Genel durum: (2-3 cümle)',
      'Dikkat çekenler: (önemli bulguların HEPSİ, önem sırasıyla; gerçekten sorun yoksa “belirgin bir sorun görünmüyor” yaz)',
      'Öneri: (yapılması gerekenler, madde madde)',
    );
    return L.join('\n');
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
    // "Q1/GECICI_Q2" gibi ifadeleri "1. dönem" biçimine çevir (kullanıcı: hiçbir
    // yerde Q görünmesin).
    const temizle = (s?: string) =>
      String(s || '')
        .replace(/GEC[İI]C[İI][_\-\s]?Q?([1-4])/gi, '$1. dönem')
        .replace(/\bQ([1-4])\b/gi, '$1. dönem')
        .trim();
    const d = temizle(donem);
    const t = temizle(donemTipi);
    if (!d && !t) return null;
    if (d && t && t !== d) return `${d} · ${t}`;
    return d || t || null;
  }

  private kirp(s: string, max = 9000): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + '\n…(kısaltıldı)';
  }
}
