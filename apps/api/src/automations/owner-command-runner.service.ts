import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ActionDispatcherService } from './action-dispatcher.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * OWNER KOMUT YÜRÜTÜCÜSÜ — owner WhatsApp'tan onayladığı (ONAYLIYORUM) komutları
 * GERÇEKTEN çalıştırır. Bot, agent='islem' AgentCommand'ı kuyruğa atar; bu runner
 * pending olanları çekip ActionDispatcherService ile çalıştırır ve owner'a sonucu
 * WhatsApp'tan bildirir.
 *
 * MİMARİ: dispatcher ToolExecutorService'i çağırdığı için tool-executor'a dispatcher
 * enjekte edilemez (döngü). Bu AYRI runner dispatcher'ı enjekte eder → döngü yok.
 *
 * GÜVENLİK: yalnız MOREN_OWNER_COMMAND_RUNNER=1 iken çalışır (varsayılan KAPALI).
 * Yalnız agent='islem' komutlarını işler (Mihsap isle_* komutlarının kendi runner'ı
 * var, onlara dokunmaz). Yalnız ALLOWLIST'teki aksiyonlar; mesaj gönderen (send_*)
 * aksiyonlar BİLİNÇLİ olarak yok (mükellefe proaktif mesaj kuralı).
 */
@Injectable()
export class OwnerCommandRunnerService {
  private readonly logger = new Logger(OwnerCommandRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: ActionDispatcherService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** Owner 'islem' komut action'ı → dispatcher aksiyonu + argüman eşlemesi. */
  private static readonly EXECUTABLE: Record<string, { dispatch: string; args: (p: any) => any; label: string }> = {
    mihsap_fatura_cek: {
      dispatch: 'fetch_invoices_for_period',
      args: (p) => ({ taxpayerId: p.taxpayerId || p.mukellefId, donem: p.donem || p.period, faturaTuru: p.faturaTuru }),
      label: 'Mihsap fatura çekme',
    },
    luca_kdv_cek: {
      dispatch: 'fetch_kdv_from_luca',
      args: (p) => ({ taxpayerId: p.taxpayerId || p.mukellefId, donem: p.donem || p.period }),
      label: 'Luca KDV verisi çekme',
    },
    fis_word_uret: {
      dispatch: 'generate_fis_word_from_invoices',
      args: (p) => ({ taxpayerId: p.taxpayerId || p.mukellefId, donem: p.donem || p.period }),
      label: 'Fiş Word raporu üretme',
    },
  };

  static isExecutableAction(action: string): boolean {
    return !!OwnerCommandRunnerService.EXECUTABLE[String(action || '')];
  }

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

  private async runOne(cmd: any) {
    const map = OwnerCommandRunnerService.EXECUTABLE[String(cmd.action || '')];
    if (!map) {
      await this.finish(cmd, 'failed', { error: `Desteklenmeyen işlem: ${cmd.action}` });
      return;
    }
    // running'e al (çift işleme önle — tek replica ama yine de atomik).
    const claimed = await (this.prisma as any).agentCommand.updateMany({
      where: { id: cmd.id, status: 'pending' },
      data: { status: 'running' },
    });
    if (!claimed?.count) return; // başkası aldı

    const payload = (cmd.payload && typeof cmd.payload === 'object') ? cmd.payload : {};
    const args = map.args(payload);
    if (!args.taxpayerId || !args.donem) {
      await this.finish(cmd, 'failed', { error: 'taxpayerId ve donem zorunlu.' }, `❌ ${map.label}: mükellef/dönem eksik, çalıştıramadım.`);
      return;
    }

    try {
      const res = await this.dispatcher.dispatch(map.dispatch, args, {
        tenantId: cmd.tenantId,
        userId: cmd.createdBy || null,
        automationId: `owner-command:${cmd.id}`,
      });
      await this.finish(cmd, 'done', res as any, this.successText(map.label, args, res));
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      await this.finish(cmd, 'failed', { error: msg }, `❌ ${map.label} (${args.donem}) çalışmadı: ${msg}`);
    }
  }

  private async finish(cmd: any, status: string, result: any, ownerText?: string) {
    await (this.prisma as any).agentCommand.update({
      where: { id: cmd.id },
      data: { status, result },
    }).catch(() => null);
    if (ownerText) await this.notifyOwner(cmd.tenantId, ownerText);
  }

  private successText(label: string, args: any, res: any): string {
    const r: any = res || {};
    let detay = '';
    if (typeof r.cekilen === 'number' || typeof r.bulunan === 'number') {
      detay = ` (${r.cekilen ?? 0} çekildi${r.bulunan != null ? ` / ${r.bulunan} bulundu` : ''})`;
    } else if (r.jobId || r.durum) {
      detay = r.mevcutJob ? ' (zaten kuyrukta vardı)' : ' (kuyruğa alındı, işleniyor)';
    } else if (r.outputId || r.dosya) {
      detay = ' (rapor üretildi)';
    }
    return `✅ ${label} — ${args.donem}${detay}. Tamamlandı.`;
  }

  private async notifyOwner(tenantId: string, text: string) {
    const phones = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
      .split(',').map((p) => p.trim()).filter(Boolean);
    if (!phones.length) return;
    for (const phone of phones.slice(0, 1)) {
      await this.whatsapp.sendMessage(phone, text, tenantId).catch((e: any) =>
        this.logger.warn(`[OwnerCommandRunner] owner bildirimi gönderilemedi: ${e?.message || e}`));
    }
  }
}
