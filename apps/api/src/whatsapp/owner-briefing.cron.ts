import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Owner'a günde iki kez WhatsApp brifingi (kullanıcı isteği — "her sabah ve akşam
 * gün değerlendirmesi/planlaması özeti"):
 *   - SABAH (varsayılan 08:00 Istanbul): günlük plan — bugün öncelikli işler,
 *     yaklaşan beyanname/ödeme süreleri, bekleyen evrak/tahsilat, riskli mükellefler.
 *   - AKŞAM (varsayılan 19:00 Istanbul): gün değerlendirmesi — ne ilerledi, ne bekliyor,
 *     yarına ne kaldı, dikkat noktaları.
 *
 * Brifing metni MorenAI beyninden (toolMode 'owner') GERÇEK portal verisiyle üretilir.
 *
 * Açma şartları (hepsi gerekli):
 *   - MOREN_OWNER_BRIEFING_ENABLED=1
 *   - MOREN_OWNER_WHATSAPP_PHONES tanımlı (owner numarası)
 *   - İlgili tenant'ta WhatsApp master switch açık
 * Saat ayarı (6 alanlı cron, Istanbul): MOREN_OWNER_BRIEFING_MORNING_CRON / _EVENING_CRON
 */
@Injectable()
export class OwnerBriefingCron {
  private readonly logger = new Logger(OwnerBriefingCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly morenAi: MorenAiService,
    private readonly postFilter: WhatsAppBotPostFilterService,
    private readonly toolExecutor: ToolExecutorService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * SAYILAR KODDAN. Brifingdeki rakamlar eskiden tamamen modelin kalemindeydi; canli
   * dokumde kendi icinde celisen toplamlar cikti (ornek: 108.000 + 100.000 = 208.000
   * yerine baska sayi) ve ayni gun sabah/aksam FARKLI cari toplam gitti. Artik rakamlar
   * arac ciktisindan hazir metin olarak veriliyor, modele "bu blogu AYNEN kullan,
   * toplama/cikarma YAPMA" deniyor.
   */
  private async sayilarBloku(tenantId: string): Promise<string> {
    try {
      const b: any = await this.toolExecutor.execute('get_operation_briefing', {}, { tenantId });
      const o = b?.ozet || {};
      const tl = (v: any) => (v === null || v === undefined
        ? 'veri alınamadı'
        : new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)) + ' ₺');
      const say = (v: any) => (v === null || v === undefined ? 'veri alınamadı' : String(v));
      const satirlar = [
        '═══ SAYILAR (kodun hesapladigi — AYNEN kullan) ═══',
        `Aktif mükellef: ${say(o.aktifMukellef)}`,
        `Beyannamesi verilebilir: ${say(o.beyannameVerilebilir)}`,
        `Borçlu mükellef: ${say(o.borcluMukellef)}`,
        `Toplam açık bakiye: ${tl(o.toplamBakiye)}`,
      ];
      const yaklasan = Array.isArray(b?.yaklasanSureler) ? b.yaklasanSureler.slice(0, 3) : [];
      for (const y of yaklasan) {
        satirlar.push(`Yaklaşan: ${y.mukellef} · ${y.beyanTipi} · son gün ${y.sonGun} ${y.sonGunAdi || ''} · ${y.kalanGun} gün kaldı`);
      }
      const geciken = Array.isArray(b?.gecikenBeyanname) ? b.gecikenBeyanname.slice(0, 3) : [];
      for (const g of geciken) {
        satirlar.push(`Geciken: ${g.mukellef} · ${g.beyanTipi} · dönem ${g.donem || '?'} · son gün ${g.sonGun} · ${g.gecenGun} gün geçti`);
      }
      const enBorclu = Array.isArray(b?.enBorclular) ? b.enBorclular.slice(0, 3) : [];
      for (const e of enBorclu) satirlar.push(`En borçlu: ${e.ad} · ${tl(e.bakiye ?? e.tutar)}`);
      satirlar.push('═══════════════════════════════════');
      return satirlar.join('\n');
    } catch (e: any) {
      this.logger.warn(`[OwnerBriefing] sayilar bloku uretilemedi: ${e?.message || e}`);
      return '═══ SAYILAR ═══\nSayısal veri alınamadı — brifingde RAKAM VERME, "veri alınamadı" yaz.\n═══════════════';
    }
  }

  /** Brifing uretilemedigi gun owner SESSIZ kalmasin (canli dokumde %24'u hic gitmemis). */
  private async brifingUretilemediBildir(tenantId: string, tur: 'sabah' | 'aksam', phones: string[]): Promise<void> {
    const metin = `${tur === 'sabah' ? 'Sabah' : 'Akşam'} brifingi bugün üretilemedi (sistem tarafı). Panelden bakabilirsin; sonraki brifing normal saatinde gelecek.`;
    for (const phone of phones) {
      await this.whatsapp.sendMessage(phone, metin, tenantId, { quote: false })
        .catch((e: any) => this.logger.warn(`[OwnerBriefing] uyari gonderilemedi ${phone}: ${e?.message || e}`));
    }
    try {
      await (this.prisma as any).notification.create({
        data: {
          tenantId, type: 'WHATSAPP',
          title: `${tur === 'sabah' ? 'Sabah' : 'Akşam'} brifingi üretilemedi`,
          body: 'MOREN AI brifing metnini standart formatta üretemedi; brifing gönderilmedi.',
          metadata: { tur },
        },
      });
    } catch { /* bildirim yazilamazsa sessiz gec */ }
  }

  @Cron(process.env.MOREN_OWNER_BRIEFING_MORNING_CRON || '0 0 8 * * *', { timeZone: 'Europe/Istanbul' })
  async morning(): Promise<void> {
    await this.run('sabah').catch((e) => this.logger.warn(`[OwnerBriefing] sabah hata: ${e?.message || e}`));
  }

  @Cron(process.env.MOREN_OWNER_BRIEFING_EVENING_CRON || '0 0 19 * * *', { timeZone: 'Europe/Istanbul' })
  async evening(): Promise<void> {
    await this.run('aksam').catch((e) => this.logger.warn(`[OwnerBriefing] aksam hata: ${e?.message || e}`));
  }

  private getOwnerPhones(): string[] {
    const raw = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '').trim();
    if (!raw) return [];
    return raw.split(',').map((p) => this.normalizePhone(p)).filter(Boolean);
  }

  private normalizePhone(raw: string): string {
    let d = String(raw).replace(/[^\d]/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = '90' + d.slice(1);
    if (d.length === 10 && d.startsWith('5')) d = '90' + d;
    return d;
  }

  private buildPrompt(tur: 'sabah' | 'aksam'): string {
    const tarih = new Date().toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
    if (tur === 'sabah') {
      return [
        `Bugün ${tarih}. Owner'a WhatsApp'tan gidecek SABAH GÜNLÜK PLAN brifingi (operasyon durumu) hazırla.`,
        'Güncel portal verisini (operasyon brifingi, beyanname hazırlığı, tahsilat riski, sistem sağlığı) SİSTEM sana hazır olarak verir; SADECE o veriyle yaz. ASLA araç/tool/fonksiyon adı (get_... gibi) ya da "çağırıyorum/çağıracağım/çekiyorum/sorguluyorum" gibi iç adım YAZMA.',
        '"Günaydın." ile başla; sonra TAM OLARAK şu 4 emoji başlığını bu sırayla kullan (başka başlık ekleme):',
        '📊 BUGÜNÜN DURUMU · ⚠️ RİSKLİ/ACİL · 📝 YAKLAŞAN SÜRELER · ▶️ BUGÜN ÖNCELİK',
        'SIKI STANDART: her başlık altında üç maddeyi aşma, her madde TEK satır; mesajın tamamı 900 karakteri aşmasın. Selamlaşma dışında dolgu cümlesi, tekrar, genel tavsiye YAZMA.',
        'Yıldız markdown yok, • madde kullan, Türk sayı formatı. Kısa ve net ol, UYDURMA yok — veri yoksa açıkça "veri yok" yaz.',
        'SAYI KURALI: aşağıdaki SAYILAR bloğundaki rakamları AYNEN kullan. Kendin toplama/çıkarma/yüzde HESAPLAMA, blokta olmayan rakam YAZMA, tarih ve gün adı UYDURMA. Bir rakam blokta yoksa o cümleyi kurma.',
        'Borçlu/cari sayısı boş (null) ya da "veri alınamadı" ise ASLA "borçlu yok / sıfır borçlu" yazma; "borçlu verisi şu an alınamadı" de (veri yokluğu ile sıfır farklıdır).',
      ].join('\n');
    }
    return [
      `Bugün ${tarih} akşamı. Owner'a WhatsApp'tan gidecek GÜN DEĞERLENDİRME brifingi (operasyon durumu) hazırla.`,
      'Güncel portal verisini (operasyon brifingi, ajan durumu, sistem sağlığı) SİSTEM sana hazır olarak verir; SADECE o veriyle yaz. ASLA araç/tool/fonksiyon adı (get_... gibi) ya da "çağırıyorum/çağıracağım/çekiyorum/sorguluyorum" gibi iç adım YAZMA.',
      'Tek cümlelik kapanış girişiyle başla; sonra TAM OLARAK şu 4 emoji başlığını bu sırayla kullan (başka başlık ekleme):',
      '✅ BUGÜN İLERLEYEN · ⏳ BEKLEYEN/YARINA KALAN · ⚠️ DİKKAT · ▶️ YARIN ÖNCELİK',
      'SIKI STANDART: her başlık altında üç maddeyi aşma, her madde TEK satır; mesajın tamamı 900 karakteri aşmasın. Dolgu cümlesi, tekrar, genel tavsiye YAZMA.',
      'Yıldız markdown yok, • madde kullan, Türk sayı formatı. Kısa ve net ol, UYDURMA yok.',
      'SAYI KURALI: aşağıdaki SAYILAR bloğundaki rakamları AYNEN kullan. Kendin toplama/çıkarma/yüzde HESAPLAMA, blokta olmayan rakam YAZMA, tarih ve gün adı UYDURMA. Bir rakam blokta yoksa o cümleyi kurma.',
    ].join('\n');
  }

  /**
   * Brifingi owner sohbetine (communicationLog) yazar ki portalda görünür/denetlenebilir
   * olsun. Owner kişisi controller'daki kalıpla aynı: taxNumber = WHATSAPP-OWNER-{tenantId}.
   * Kişi henüz yoksa (owner bot ile hiç yazışmamış) sessizce atlanır — burada kişi YARATMAZ.
   */
  private async logBriefingToPortal(tenantId: string, tur: 'sabah' | 'aksam', text: string): Promise<void> {
    const owner = await (this.prisma as any).taxpayer.findFirst({
      where: { tenantId, taxNumber: `WHATSAPP-OWNER-${tenantId}` },
      select: { id: true },
    });
    if (!owner) return;
    await (this.prisma as any).communicationLog.create({
      data: {
        taxpayerId: owner.id,
        channel: 'WHATSAPP',
        subject: `WhatsApp owner ${tur === 'sabah' ? 'sabah' : 'akşam'} brifingi`,
        content: text,
        occurredAt: new Date(),
      },
    });
  }

  /** Canlı test: cron'u ve env kapısını beklemeden brifingi hemen gönder (yalnız owner ucu çağırır). */
  async triggerNow(tur: 'sabah' | 'aksam'): Promise<void> {
    await this.run(tur, true);
  }

  /** Cevap gerçekten brifing mi? Zorunlu başlıklardan en az biri + makul uzunluk. */
  private brifingFormatindaMi(tur: 'sabah' | 'aksam', text: string): boolean {
    const t = String(text || '');
    if (t.length < 80) return false;
    return tur === 'sabah'
      ? /BUGÜNÜN DURUMU|BUGUN ÖNCELİK|BUGÜN ÖNCELİK/i.test(t)
      : /BUGÜN İLERLEYEN|YARIN ÖNCELİK/i.test(t);
  }

  private async run(tur: 'sabah' | 'aksam', force = false): Promise<void> {
    if (!force && process.env.MOREN_OWNER_BRIEFING_ENABLED !== '1') return;
    const phones = this.getOwnerPhones();
    if (!phones.length) {
      this.logger.warn('[OwnerBriefing] MOREN_OWNER_WHATSAPP_PHONES tanimli degil, brifing atlandi');
      return;
    }
    let tenants: Array<{ id: string }> = [];
    try {
      tenants = await (this.prisma as any).tenant.findMany({ select: { id: true } });
    } catch (e: any) {
      this.logger.warn(`[OwnerBriefing] tenant listesi alinamadi: ${e?.message || e}`);
      return;
    }

    for (const t of tenants) {
      try {
        if (!(await this.whatsapp.isAutomationActive(t.id))) continue;
        // Sayilar tenant bazinda hesaplanip prompt'a EKLENIR (model saymaz).
        const prompt = `${this.buildPrompt(tur)}\n\n${await this.sayilarBloku(t.id)}`;
        // KALİTE BEKÇİSİ (2026-07-04): model bazen boş final bırakıyor → araç-şablonu
        // yedeği (ör. "💰 TAHSİLAT RİSKİ" dökümü) brifing diye gidiyordu. Cevap brifing
        // formatında değilse BİR kez yeniden dene; yine değilse HİÇ gönderme (standart
        // dışı mesaj owner'a gitmesin — kullanıcı kararı).
        let text = '';
        for (let deneme = 1; deneme <= 2; deneme++) {
          const answer: any = await this.morenAi.chat(t.id, null, {
            message: prompt,
            toolMode: 'owner',
            source: 'owner-briefing-cron',
            currentPath: '/panel/mesajlar',
          } as any);
          text = this.postFilter.filterTaxpayerReply(String(answer?.assistantMessage || ''), { mode: 'owner' });
          if (this.brifingFormatindaMi(tur, text)) break;
          this.logger.warn(`[OwnerBriefing] ${t.id} ${tur}: cevap brifing formatında değil (deneme ${deneme}/2)`);
          text = '';
        }
        if (!text || text === '—') {
          this.logger.warn(`[OwnerBriefing] ${t.id} ${tur}: standart brifing uretilemedi, GONDERILMEDI`);
          await this.brifingUretilemediBildir(t.id, tur, phones);
          continue;
        }
        for (const phone of phones) {
          await this.whatsapp
            .sendMessage(phone, text, t.id, { quote: false })
            .catch((e: any) => this.logger.warn(`[OwnerBriefing] gonderim hatasi ${phone}: ${e?.message || e}`));
        }
        // Portalda (Mesajlar → owner sohbeti) görünsün diye kaydet. Eskiden cron
        // communicationLog'a HİÇ yazmıyordu → brifingler portalda görünmüyordu.
        await this.logBriefingToPortal(t.id, tur, text)
          .catch((e: any) => this.logger.warn(`[OwnerBriefing] portal log hatasi ${t.id}: ${e?.message || e}`));
        this.logger.log(`[OwnerBriefing] ${t.id} ${tur} brifing gonderildi (${phones.length} numara)`);
      } catch (e: any) {
        this.logger.warn(`[OwnerBriefing] ${t.id} ${tur}: ${e?.message || e}`);
      }
    }
  }
}
