import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ActionDispatcherService } from './action-dispatcher.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EDefterControlService } from '../edefter-control/edefter-control.service';
import { LucaService } from '../luca/luca.service';
import { ISLEM_OPERATIONS } from '../moren-ai/islem-operations';

/**
 * OWNER KOMUT YÜRÜTÜCÜSÜ — owner WhatsApp'tan onayladığı (ONAYLIYORUM) işlem komutlarını
 * GERÇEKTEN çalıştırır. Bot agent='islem' AgentCommand'ı kuyruğa atar; bu runner pending
 * olanları çekip ilgili servisle çalıştırır ve owner'a sonucu WhatsApp'tan bildirir.
 *
 * MİMARİ: dispatcher ToolExecutorService'i çağırdığı için tool-executor'a dispatcher
 * enjekte edilemez (döngü). Bu AYRI runner dispatcher + domain servislerini enjekte eder.
 *
 * GÜVENLİK: yalnız MOREN_OWNER_COMMAND_RUNNER=1 iken çalışır (varsayılan KAPALI).
 * Yalnız agent='islem' + ISLEM_OPERATIONS registry'sindeki action'lar. Mesaj gönderen
 * (send_*) ya da Luca'ya yazan ağır işlemler BİLİNÇLİ kapsam dışı.
 *
 * YENİ OPERASYON EKLEME: ISLEM_OPERATIONS'a 1 metadata satırı + buradaki execute() switch'ine
 * 1 case. Hepsi bu kadar — botun yeteneği otomatik genişler (registry tek kaynak).
 */
@Injectable()
export class OwnerCommandRunnerService {
  private readonly logger = new Logger(OwnerCommandRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: ActionDispatcherService,
    private readonly whatsapp: WhatsAppService,
    private readonly edefter: EDefterControlService,
    private readonly luca: LucaService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processPending() {
    if (process.env.MOREN_OWNER_COMMAND_RUNNER !== '1') return; // VARSAYILAN KAPALI
    let commands: any[] = [];
    try {
      commands = await (this.prisma as any).agentCommand.findMany({
        where: { agent: 'islem', status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 5,
      });
    } catch (e: any) {
      this.logger.warn(`[OwnerCommandRunner] kuyruk okunamadı: ${e?.message || e}`);
      return;
    }
    for (const cmd of commands) {
      await this.runOne(cmd).catch((e: any) =>
        this.logger.error(`[OwnerCommandRunner] cmd=${cmd.id} işlenemedi: ${e?.message || e}`));
    }
  }

  /** İŞLEM yürütme — registry action → ilgili servis çağrısı. Yeni operasyon = 1 case. */
  private async execute(action: string, ctx: { tenantId: string; userId?: string | null }, p: { taxpayerId: string; donem: string }): Promise<any> {
    const dispatchCtx = { tenantId: ctx.tenantId, userId: ctx.userId ?? null, automationId: `owner-command:${action}` };
    switch (action) {
      case 'mihsap_fatura_cek':
        return this.dispatcher.dispatch('fetch_invoices_for_period', { taxpayerId: p.taxpayerId, donem: p.donem }, dispatchCtx);
      case 'luca_kdv_cek':
        return this.dispatcher.dispatch('fetch_kdv_from_luca', { taxpayerId: p.taxpayerId, donem: p.donem }, dispatchCtx);
      case 'fis_word_uret':
        return this.dispatcher.dispatch('generate_fis_word_from_invoices', { taxpayerId: p.taxpayerId, donem: p.donem }, dispatchCtx);
      case 'edefter_kontrol': {
        // Dönem tipini formattan türet: "YYYY-Qn"→GECICI_Qn (geçici/3-aylık, "1. dönem"=Q1),
        // "YYYY-MM"→AYLIK, "YYYY"→YILLIK.
        const q = String(p.donem).match(/^(\d{4})-Q([1-4])$/i);
        const donemTipi: any = q ? `GECICI_Q${q[2]}` : /^\d{4}-\d{2}$/.test(p.donem) ? 'AYLIK' : /^\d{4}$/.test(p.donem) ? 'YILLIK' : undefined;
        return this.edefter.createFetchJob({ tenantId: ctx.tenantId, mukellefId: p.taxpayerId, donem: p.donem, donemTipi, createdBy: ctx.userId ?? undefined });
      }
      case 'mizan_cek':
        return this.luca.createFetchJob({ tenantId: ctx.tenantId, sessionId: undefined as any, mukellefId: p.taxpayerId, donem: p.donem, tip: 'MIZAN', createdBy: ctx.userId ?? undefined });
      default:
        throw new Error(`Bilinmeyen işlem: ${action}`);
    }
  }

  private async runOne(cmd: any) {
    const op = ISLEM_OPERATIONS[String(cmd.action || '')];
    if (!op) {
      await this.finish(cmd, 'failed', { error: `Desteklenmeyen işlem: ${cmd.action}` });
      return;
    }
    // running'e al (çift işleme önle).
    const claimed = await (this.prisma as any).agentCommand.updateMany({
      where: { id: cmd.id, status: 'pending' },
      data: { status: 'running' },
    });
    if (!claimed?.count) return;

    const payload = (cmd.payload && typeof cmd.payload === 'object') ? cmd.payload : {};
    const taxpayerId = String(payload.taxpayerId || payload.mukellefId || '');
    const donem = String(payload.donem || payload.period || '');
    if (!taxpayerId || !/^\d{4}(-(\d{2}|Q[1-4]))?$/i.test(donem)) {
      await this.finish(cmd, 'failed', { error: 'taxpayerId ve donem ("YYYY-MM" / "YYYY-Qn" / "YYYY") zorunlu.' }, `❌ ${op.label}: mükellef/dönem eksik, çalıştıramadım.`);
      return;
    }

    try {
      const res = await this.execute(cmd.action, { tenantId: cmd.tenantId, userId: cmd.createdBy || null }, { taxpayerId, donem });
      await this.finish(cmd, 'done', this.safe(res), `✅ ${op.label} — ${donem}${this.detayText(res)}. Tamamlandı.`);
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      await this.finish(cmd, 'failed', { error: msg }, `❌ ${op.label} (${donem}) çalışmadı: ${msg}`);
    }
  }

  private async finish(cmd: any, status: string, result: any, ownerText?: string) {
    await (this.prisma as any).agentCommand.update({ where: { id: cmd.id }, data: { status, result } }).catch(() => null);
    if (ownerText) await this.notifyOwner(cmd.tenantId, ownerText);
  }

  /** Sonuç JSON'unu güvenli (döngüsüz, kısa) hale getir. */
  private safe(res: any): any {
    try { return JSON.parse(JSON.stringify(res ?? {})); } catch { return { ok: true }; }
  }

  private detayText(res: any): string {
    const r: any = res || {};
    if (typeof r.cekilen === 'number' || typeof r.bulunan === 'number') return ` (${r.cekilen ?? 0} çekildi${r.bulunan != null ? ` / ${r.bulunan} bulundu` : ''})`;
    if (r.detailJob?.id || r.jobId || r.durum) return r.mevcutJob ? ' (zaten kuyrukta vardı)' : ' (kuyruğa alındı, işleniyor)';
    if (r.outputId || r.dosya || r.success) return ' (üretildi)';
    return '';
  }

  private async notifyOwner(tenantId: string, text: string) {
    const phones = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
      .split(',').map((p) => p.trim()).filter(Boolean);
    for (const phone of phones.slice(0, 1)) {
      await this.whatsapp.sendMessage(phone, text, tenantId).catch((e: any) =>
        this.logger.warn(`[OwnerCommandRunner] owner bildirimi gönderilemedi: ${e?.message || e}`));
    }
  }
}
