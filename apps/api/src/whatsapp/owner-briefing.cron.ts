import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';

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
  ) {}

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
        `Bugün ${tarih}. Owner'a WhatsApp'tan gidecek SABAH GÜNLÜK PLAN brifingi hazırla.`,
        'get_operation_briefing (+ gerekiyorsa get_beyanname_readiness_summary, get_collection_risk_summary, get_system_health) ile GERÇEK portal verisini çek.',
        '"Günaydın." ile başla; sonra emoji başlıklı kısa maddeler ver:',
        '📊 BUGÜNÜN DURUMU · ⚠️ RİSKLİ/ACİL · 📝 YAKLAŞAN SÜRELER · ▶️ BUGÜN ÖNCELİK',
        'Yıldız markdown yok, • madde kullan, Türk sayı formatı. Kısa ve net ol, UYDURMA yok — veri yoksa açıkça "veri yok" yaz.',
      ].join('\n');
    }
    return [
      `Bugün ${tarih} akşamı. Owner'a WhatsApp'tan gidecek GÜN DEĞERLENDİRME brifingi hazırla.`,
      'get_operation_briefing (+ gerekiyorsa get_agent_status, get_system_health) ile GERÇEK portal verisini çek.',
      'Kısa bir kapanış girişiyle başla; sonra emoji başlıklı maddeler ver:',
      '✅ BUGÜN İLERLEYEN · ⏳ BEKLEYEN/YARINA KALAN · ⚠️ DİKKAT · ▶️ YARIN ÖNCELİK',
      'Yıldız markdown yok, • madde kullan, Türk sayı formatı. Kısa ve net ol, UYDURMA yok.',
    ].join('\n');
  }

  private async run(tur: 'sabah' | 'aksam'): Promise<void> {
    if (process.env.MOREN_OWNER_BRIEFING_ENABLED !== '1') return;
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

    const prompt = this.buildPrompt(tur);
    for (const t of tenants) {
      try {
        if (!(await this.whatsapp.isAutomationActive(t.id))) continue;
        const answer: any = await this.morenAi.chat(t.id, null, {
          message: prompt,
          toolMode: 'owner',
          source: 'owner-briefing-cron',
          currentPath: '/panel/mesajlar',
        } as any);
        const text = this.postFilter.filterTaxpayerReply(String(answer?.assistantMessage || ''), { mode: 'owner' });
        if (!text || text === '—') {
          this.logger.warn(`[OwnerBriefing] ${t.id} ${tur}: bos brifing uretildi, atlandi`);
          continue;
        }
        for (const phone of phones) {
          await this.whatsapp
            .sendMessage(phone, text, t.id)
            .catch((e: any) => this.logger.warn(`[OwnerBriefing] gonderim hatasi ${phone}: ${e?.message || e}`));
        }
        this.logger.log(`[OwnerBriefing] ${t.id} ${tur} brifing gonderildi (${phones.length} numara)`);
      } catch (e: any) {
        this.logger.warn(`[OwnerBriefing] ${t.id} ${tur}: ${e?.message || e}`);
      }
    }
  }
}
