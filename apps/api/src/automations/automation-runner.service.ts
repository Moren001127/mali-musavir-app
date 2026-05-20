import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Automation, AutomationStatus, AutomationTriggerType, Prisma } from '@prisma/client';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { ACTION_BY_NAME } from './action-catalog';
import { ActionDispatcherService } from './action-dispatcher.service';
import { AutomationEventBus } from './automation-event-bus.service';
import { evaluateCondition, resolveTemplates, ResolveContext } from './template-resolver';

const MAX_FOR_EACH_ITEMS = 1000;
const MAX_NESTED_DEPTH = 10;
const MAX_WAIT_MS = 60 * 60 * 1000; // 1 saat (daha uzun bekleme için Bull delayed job — Faz 5)
const STEP_LOG_LIMIT_BYTES = 8 * 1024; // step çıktısı log'a kaydedilirken bu kadar kırpılır

interface StepLog {
  stepId: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  ms: number;
  ts: string;
}

/**
 * Otomasyon çalıştırıcı motoru — Faz 3'ün kalbi.
 *
 * Sorumluluklar:
 *  - Boot'ta tüm ACTIVE + CRON otomasyonları SchedulerRegistry'e register etmek.
 *  - Status değişimlerinde cron job ekle/kaldır (AutomationsService bunu çağırır).
 *  - executeAutomation(id, triggerPayload) — herhangi bir tetikleyiciden çağrılır:
 *    cron, manuel "Şimdi Çalıştır", webhook, event.
 *  - Step'leri recursive yürütmek (for_each / branch_if / parallel / wait).
 *  - Her run için AutomationRun + step log'ları yazmak.
 *  - Sayaçları (totalRuns / successRuns / failureRuns) güncellemek.
 *  - Hata politikası uygulamak (notify / pause_after_3 / ignore).
 */
@Injectable()
export class AutomationRunnerService implements OnModuleInit {
  private readonly logger = new Logger(AutomationRunnerService.name);
  /** Cron job ID prefix — registry'de çakışmasın diye */
  private readonly cronPrefix = 'auto.';
  /** EVENT otomasyonları için unsubscribe fonksiyonları (id → unsubscribe) */
  private readonly eventUnsubscribers = new Map<string, () => void>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: ActionDispatcherService,
    private readonly scheduler: SchedulerRegistry,
    private readonly eventBus: AutomationEventBus,
  ) {}

  // ---------------------------------------------------------------
  // YAŞAM DÖNGÜSÜ
  // ---------------------------------------------------------------

  async onModuleInit() {
    try {
      // CRON otomasyonları
      const activeCron = await this.prisma.automation.findMany({
        where: { status: AutomationStatus.ACTIVE, triggerType: AutomationTriggerType.CRON },
      });
      this.logger.log(`Boot: ${activeCron.length} aktif cron otomasyonu yüklenecek.`);
      for (const a of activeCron) {
        try {
          this.registerCron(a);
        } catch (err: any) {
          this.logger.error(`Cron register hatası id=${a.id}: ${err.message}`);
        }
      }

      // EVENT otomasyonları
      const activeEvent = await this.prisma.automation.findMany({
        where: { status: AutomationStatus.ACTIVE, triggerType: AutomationTriggerType.EVENT },
      });
      this.logger.log(`Boot: ${activeEvent.length} aktif event otomasyonu yüklenecek.`);
      for (const a of activeEvent) {
        try {
          this.registerEvent(a);
        } catch (err: any) {
          this.logger.error(`Event register hatası id=${a.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Otomasyon boot hatası: ${err.message}`);
    }
  }

  /**
   * Bir otomasyonu cron registry'sine ekler.
   * AutomationsService bir otomasyonu ACTIVE'e geçirdiğinde çağrılır.
   */
  registerCron(automation: Automation): void {
    if (automation.triggerType !== AutomationTriggerType.CRON) return;
    const cfg = automation.triggerConfig as any;
    const cronExpr = cfg?.cron;
    if (!cronExpr) throw new Error('triggerConfig.cron eksik.');
    // Varsayılan Türkiye saati. Parser bunu default olarak üretir, ama eski
    // otomasyonlarda eksik olabilir — kullanıcı zaten Türk mali müşaviri.
    const timezone = cfg?.timezone || 'Europe/Istanbul';
    const jobId = this.cronPrefix + automation.id;

    // Mevcut bir job varsa önce sil
    this.unregisterCron(automation.id);

    const job = new CronJob(
      cronExpr,
      () => {
        this.executeAutomation(automation.id, { source: 'cron', firedAt: new Date().toISOString() })
          .catch((err) => {
            this.logger.error(`Cron run hata id=${automation.id}: ${err.message}`);
          });
      },
      null, // onComplete
      false, // start
      timezone, // timezone
    );
    this.scheduler.addCronJob(jobId, job as unknown as any);
    job.start();
    this.logger.log(`Cron register: id=${automation.id} expr="${cronExpr}" tz=${timezone}`);
  }

  /**
   * Cron job'ı kaldırır. AutomationsService PAUSED/ARCHIVED'a geçirdiğinde çağrılır.
   */
  unregisterCron(automationId: string): void {
    const jobId = this.cronPrefix + automationId;
    try {
      const existing = this.scheduler.getCronJob(jobId);
      if (existing) {
        existing.stop();
        this.scheduler.deleteCronJob(jobId);
        this.logger.log(`Cron unregister: id=${automationId}`);
      }
    } catch {
      // Yoksa sessiz geç
    }
  }

  /**
   * EVENT otomasyonunu event bus'a kaydeder.
   * Bir event yayınlandığında bu otomasyonun tetikleyici filtresi geçtiyse çalıştırılır.
   */
  registerEvent(automation: Automation): void {
    if (automation.triggerType !== AutomationTriggerType.EVENT) return;
    const cfg = automation.triggerConfig as any;
    const eventName = cfg?.eventName;
    const filters: Record<string, unknown> = cfg?.filters ?? {};
    if (!eventName) throw new Error('triggerConfig.eventName eksik.');

    // Mevcut listener varsa önce kaldır
    this.unregisterEvent(automation.id);

    const unsubscribe = this.eventBus.on(eventName, (payload) => {
      // Tenant izolasyonu — bu otomasyon başka tenant'ın event'ini dinlemesin
      if (payload.tenantId !== automation.tenantId) return;

      // Filter eşleşmesi — her filter key'i payload'a eşit olmalı
      for (const [key, expected] of Object.entries(filters)) {
        if ((payload as any)[key] !== expected) {
          return; // filter geçemedi
        }
      }

      // Async fire-and-forget
      this.executeAutomation(automation.id, {
        source: 'event',
        eventName,
        payload,
        firedAt: new Date().toISOString(),
      }).catch((err) => {
        this.logger.error(`Event run hata id=${automation.id}: ${err.message}`);
      });
    });

    this.eventUnsubscribers.set(automation.id, unsubscribe);
    this.logger.log(
      `Event register: id=${automation.id} event="${eventName}" filters=${JSON.stringify(filters)}`,
    );
  }

  /**
   * EVENT listener'ı kaldırır.
   */
  unregisterEvent(automationId: string): void {
    const unsubscribe = this.eventUnsubscribers.get(automationId);
    if (unsubscribe) {
      unsubscribe();
      this.eventUnsubscribers.delete(automationId);
      this.logger.log(`Event unregister: id=${automationId}`);
    }
  }

  // ---------------------------------------------------------------
  // ANA ÇALIŞTIRMA — herhangi bir tetikleyiciden çağrılır
  // ---------------------------------------------------------------

  /**
   * Bir otomasyonu çalıştır. AutomationRun kaydı yaratır, step'leri yürütür,
   * log'ları yazar, sayaçları günceller.
   *
   * Hata fırlatmaz — tüm hatalar AutomationRun.errorMessage'a yazılır.
   */
  async executeAutomation(
    automationId: string,
    triggerPayload?: Record<string, unknown>,
    options?: { dryRun?: boolean },
  ): Promise<{ runId: string; status: string; summary?: string }> {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: { createdBy: { select: { id: true, email: true, firstName: true, lastName: true } }, tenant: true },
    });
    if (!automation) throw new NotFoundException('Otomasyon bulunamadı.');

    if (
      automation.status !== AutomationStatus.ACTIVE &&
      automation.status !== AutomationStatus.DRAFT
    ) {
      // PAUSED/ERROR/ARCHIVED durumdayken manuel "şimdi çalıştır" gibi durumlarda
      // yine de bilgi verelim
      this.logger.warn(
        `Çalıştırma reddedildi: id=${automationId} status=${automation.status}`,
      );
      throw new Error(`Otomasyon ${automation.status} durumda — önce ACTIVE'e alın.`);
    }

    const run = await this.prisma.automationRun.create({
      data: {
        automationId,
        status: 'running',
        triggerPayload: (triggerPayload ?? {}) as Prisma.InputJsonValue,
        stepLogs: [] as unknown as Prisma.InputJsonValue,
      },
    });

    const stepLogs: StepLog[] = [];
    const ctx: ResolveContext = {
      outputs: {},
      trigger: triggerPayload,
      currentUser: automation.createdBy
        ? {
            id: automation.createdBy.id,
            email: automation.createdBy.email,
            firstName: automation.createdBy.firstName,
            lastName: automation.createdBy.lastName,
          }
        : undefined,
      tenant: { id: automation.tenant.id, name: automation.tenant.name },
    };

    const dispatchCtx = {
      tenantId: automation.tenantId,
      userId: automation.createdById,
      automationId: automation.id,
    };

    const stepsBlob = automation.steps as any;
    const stepList = Array.isArray(stepsBlob?.steps) ? stepsBlob.steps : [];

    let status: 'success' | 'failure' | 'partial' = 'success';
    let errorMessage: string | undefined;
    let totalCost = 0;
    const startMs = Date.now();

    try {
      const result = await this.executeStepList(
        stepList,
        ctx,
        dispatchCtx,
        stepLogs,
        { depth: 0, dryRun: options?.dryRun === true },
      );
      totalCost = result.cost;
      // Hata olduysa ama akış bittiyse "partial"
      const anyError = stepLogs.some((s) => s.error);
      if (anyError) status = 'partial';
    } catch (err: any) {
      status = 'failure';
      errorMessage = err?.message ?? String(err);
      this.logger.error(`Run ${run.id} fatal: ${errorMessage}`);
    }

    const ms = Date.now() - startMs;
    const summary = this.buildSummary(stepLogs, status, ms);

    await this.prisma.automationRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        stepLogs: stepLogs as unknown as Prisma.InputJsonValue,
        summary,
        errorMessage,
        costUsd: totalCost,
      },
    });

    // Otomasyon sayaçlarını ve son çalışma bilgisini güncelle
    await this.updateCountersAfterRun(automation, status);

    return { runId: run.id, status, summary };
  }

  // ---------------------------------------------------------------
  // STEP YÜRÜTME — recursive
  // ---------------------------------------------------------------

  private async executeStepList(
    steps: any[],
    ctx: ResolveContext,
    dispatchCtx: { tenantId: string; userId: string; automationId: string },
    log: StepLog[],
    opts: { depth: number; dryRun: boolean },
  ): Promise<{ cost: number }> {
    if (opts.depth > MAX_NESTED_DEPTH) {
      throw new Error(`Maksimum iç içe geçme derinliği aşıldı (${MAX_NESTED_DEPTH}).`);
    }
    let totalCost = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const result = await this.executeStep(step, ctx, dispatchCtx, log, opts);
      totalCost += result.cost;
    }
    return { cost: totalCost };
  }

  private async executeStep(
    step: any,
    ctx: ResolveContext,
    dispatchCtx: { tenantId: string; userId: string; automationId: string },
    log: StepLog[],
    opts: { depth: number; dryRun: boolean },
  ): Promise<{ cost: number; output?: unknown }> {
    const stepId = step.id ?? `step_${log.length + 1}`;
    const tool = step.tool;
    const action = ACTION_BY_NAME[tool];
    if (!action) {
      const entry: StepLog = {
        stepId,
        tool,
        error: `Bilinmeyen aksiyon: ${tool}`,
        ms: 0,
        ts: new Date().toISOString(),
      };
      log.push(entry);
      throw new Error(`Bilinmeyen aksiyon: ${tool}`);
    }

    // Args'ları çöz (templates)
    const args = resolveTemplates(step.args ?? {}, ctx);

    // FLOW aksiyonları — burada yorumlanır
    if (action.category === 'FLOW') {
      return this.executeFlowStep(step, args, ctx, dispatchCtx, log, opts, stepId);
    }

    // Dry-run: sadece logla, gerçekten çalıştırma
    if (opts.dryRun) {
      log.push({
        stepId,
        tool,
        input: args,
        output: { dryRun: true, message: 'Dry-run: gerçek çalıştırma yapılmadı' },
        ms: 0,
        ts: new Date().toISOString(),
      });
      return { cost: 0 };
    }

    // LEAF aksiyon — dispatcher'a yolla
    const startMs = Date.now();
    try {
      const output = await this.dispatcher.dispatch(
        tool,
        args as Record<string, unknown>,
        dispatchCtx,
      );
      const ms = Date.now() - startMs;
      // Output'u outputs'a yaz (varsa outputAs)
      if (step.outputAs) {
        ctx.outputs[step.outputAs] = output;
      }
      log.push({
        stepId,
        tool,
        input: args,
        output: this.truncate(output),
        ms,
        ts: new Date().toISOString(),
      });
      return { cost: action.estimatedClaudeCostPerCall, output };
    } catch (err: any) {
      const ms = Date.now() - startMs;
      log.push({
        stepId,
        tool,
        input: args,
        error: err?.message ?? String(err),
        ms,
        ts: new Date().toISOString(),
      });
      // Tek bir step hatası tüm akışı durdurmasın — partial mode için devam et
      this.logger.warn(`Step hata: ${stepId}/${tool}: ${err?.message}`);
      return { cost: action.estimatedClaudeCostPerCall };
    }
  }

  private async executeFlowStep(
    step: any,
    args: any,
    ctx: ResolveContext,
    dispatchCtx: { tenantId: string; userId: string; automationId: string },
    log: StepLog[],
    opts: { depth: number; dryRun: boolean },
    stepId: string,
  ): Promise<{ cost: number }> {
    const startMs = Date.now();
    try {
      switch (step.tool) {
        case 'format_list': {
          const output = this.formatList(args);
          if (step.outputAs) {
            ctx.outputs[step.outputAs] = output;
          }
          log.push({
            stepId,
            tool: 'format_list',
            input: { itemTemplate: args.itemTemplate, listLength: Array.isArray(args.list) ? args.list.length : 0 },
            output: typeof output === 'string' ? output.slice(0, 500) : output,
            ms: Date.now() - startMs,
            ts: new Date().toISOString(),
          });
          return { cost: 0 };
        }

        case 'for_each': {
          const list = args.list;
          if (!Array.isArray(list)) {
            throw new Error('for_each.list bir dizi olmalı (resolve edildikten sonra).');
          }
          if (list.length > MAX_FOR_EACH_ITEMS) {
            throw new Error(
              `for_each ${list.length} eleman var, üst limit ${MAX_FOR_EACH_ITEMS}.`,
            );
          }
          let cost = 0;
          const asName = String(args.as ?? 'item');
          const innerSteps = step.steps ?? [];
          for (let i = 0; i < list.length; i++) {
            // Geçici olarak ctx.outputs'a item'ı koy (varsa eski değeri yedekle)
            const prev = ctx.outputs[asName];
            ctx.outputs[asName] = list[i];
            try {
              const r = await this.executeStepList(innerSteps, ctx, dispatchCtx, log, {
                ...opts,
                depth: opts.depth + 1,
              });
              cost += r.cost;
            } finally {
              if (prev === undefined) delete ctx.outputs[asName];
              else ctx.outputs[asName] = prev;
            }
          }
          log.push({
            stepId,
            tool: 'for_each',
            input: { count: list.length, as: asName },
            ms: Date.now() - startMs,
            ts: new Date().toISOString(),
          });
          return { cost };
        }

        case 'branch_if': {
          const cond = args.condition ?? { left: undefined, op: '==', right: undefined };
          const truthy = evaluateCondition(cond);
          const branchSteps = truthy ? step.then ?? [] : step.else ?? [];
          const r = await this.executeStepList(branchSteps, ctx, dispatchCtx, log, {
            ...opts,
            depth: opts.depth + 1,
          });
          log.push({
            stepId,
            tool: 'branch_if',
            input: { condition: cond, branch: truthy ? 'then' : 'else' },
            ms: Date.now() - startMs,
            ts: new Date().toISOString(),
          });
          return { cost: r.cost };
        }

        case 'parallel': {
          const branches = step.branches ?? [];
          const results = await Promise.all(
            branches.map((branchSteps: any[]) =>
              this.executeStepList(branchSteps, ctx, dispatchCtx, log, {
                ...opts,
                depth: opts.depth + 1,
              }),
            ),
          );
          const cost = results.reduce((a, b) => a + b.cost, 0);
          log.push({
            stepId,
            tool: 'parallel',
            input: { branchCount: branches.length },
            ms: Date.now() - startMs,
            ts: new Date().toISOString(),
          });
          return { cost };
        }

        case 'wait': {
          const amount = Number(args.amount ?? 0);
          const unit = String(args.unit ?? 'minutes');
          const ms =
            unit === 'minutes' ? amount * 60_000 :
            unit === 'hours' ? amount * 3_600_000 :
            unit === 'days' ? amount * 86_400_000 :
            0;
          if (ms > MAX_WAIT_MS) {
            log.push({
              stepId,
              tool: 'wait',
              input: { amount, unit },
              error: `Wait ${ms}ms üst limiti (${MAX_WAIT_MS}ms) aşıyor. Bull delayed job desteği Faz 5'te eklenecek — bu run'da atlandı.`,
              ms: 0,
              ts: new Date().toISOString(),
            });
            return { cost: 0 };
          }
          if (!opts.dryRun) await new Promise((r) => setTimeout(r, ms));
          log.push({
            stepId,
            tool: 'wait',
            input: { amount, unit },
            ms: Date.now() - startMs,
            ts: new Date().toISOString(),
          });
          return { cost: 0 };
        }

        default:
          throw new Error(`Bilinmeyen flow aksiyonu: ${step.tool}`);
      }
    } catch (err: any) {
      log.push({
        stepId,
        tool: step.tool,
        error: err?.message ?? String(err),
        ms: Date.now() - startMs,
        ts: new Date().toISOString(),
      });
      throw err; // flow hataları genelde fatal
    }
  }

  // ---------------------------------------------------------------
  // SAYIM + HATA POLİTİKASI
  // ---------------------------------------------------------------

  private async updateCountersAfterRun(
    automation: Automation,
    status: 'success' | 'failure' | 'partial',
  ): Promise<void> {
    const lastRunStatus = status;
    const incSuccess = status === 'success' ? 1 : 0;
    const incFailure = status === 'failure' ? 1 : 0;

    await this.prisma.automation.update({
      where: { id: automation.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus,
        totalRuns: { increment: 1 },
        successRuns: { increment: incSuccess },
        failureRuns: { increment: incFailure },
      },
    });

    // Hata politikası: pause_after_3 — 3 ardışık başarısızsa duraklat
    if (
      status === 'failure' &&
      automation.failurePolicy === 'pause_after_3'
    ) {
      const recent = await this.prisma.automationRun.findMany({
        where: { automationId: automation.id },
        orderBy: { startedAt: 'desc' },
        take: 3,
        select: { status: true },
      });
      if (recent.length === 3 && recent.every((r) => r.status === 'failure')) {
        await this.prisma.automation.update({
          where: { id: automation.id },
          data: { status: AutomationStatus.PAUSED },
        });
        this.unregisterCron(automation.id);
        this.logger.warn(
          `Otomasyon ${automation.id} 3 ardışık hata sonrası PAUSED'a alındı.`,
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // YARDIMCILAR
  // ---------------------------------------------------------------

  /**
   * format_list aksiyonu — diziyi insan-okur metne çevirir.
   * Deterministik, Claude çağırmaz.
   */
  private formatList(args: any): string {
    const list = args.list;
    const itemTemplate = String(args.itemTemplate ?? '');
    const separator = String(args.separator ?? '\n');
    const emptyMessage = String(args.emptyMessage ?? '');
    const prefix = String(args.prefix ?? '');
    const suffix = String(args.suffix ?? '');
    const maxItems = typeof args.maxItems === 'number' ? args.maxItems : Infinity;

    // list, üst seviyede mukellefler objesinin .mukellefler alanı gibi nested olabilir
    // Eğer doğrudan dizi değilse, bazı yaygın alanlarda ara
    let arr: unknown[] = [];
    if (Array.isArray(list)) {
      arr = list;
    } else if (list && typeof list === 'object') {
      const candidates = ['mukellefler', 'items', 'data', 'results', 'list'];
      for (const c of candidates) {
        if (Array.isArray((list as any)[c])) {
          arr = (list as any)[c];
          break;
        }
      }
    }

    if (arr.length === 0) return emptyMessage;

    const limited = arr.slice(0, maxItems);
    const lines = limited.map((item) => {
      // Item'ı template içine yerleştir — küçük bir mini template-resolver
      return itemTemplate.replace(/\{\{\s*item\.([^}]+?)\s*\}\}/g, (_full, path) => {
        const parts = String(path).trim().split('.');
        let cur: any = item;
        for (const p of parts) {
          if (cur === null || cur === undefined) return '';
          cur = cur[p];
        }
        if (cur === null || cur === undefined) return '';
        return typeof cur === 'string' ? cur : String(cur);
      });
    });

    let body = lines.join(separator);
    if (arr.length > limited.length) {
      body += `${separator}... ve ${arr.length - limited.length} tane daha`;
    }
    return prefix + body + suffix;
  }

  private buildSummary(
    log: StepLog[],
    status: 'success' | 'failure' | 'partial',
    ms: number,
  ): string {
    const ok = log.filter((s) => !s.error).length;
    const err = log.filter((s) => s.error).length;
    const seconds = (ms / 1000).toFixed(1);
    if (status === 'success') return `${ok} adım başarıyla tamamlandı (${seconds}s).`;
    if (status === 'partial') return `${ok} adım başarılı, ${err} adım hatalı (${seconds}s).`;
    return `Çalışma başarısız: ${err} adım hata verdi (${seconds}s).`;
  }

  private truncate(value: unknown): unknown {
    try {
      const json = JSON.stringify(value);
      if (json.length <= STEP_LOG_LIMIT_BYTES) return value;
      return {
        truncated: true,
        preview: json.slice(0, STEP_LOG_LIMIT_BYTES),
        originalSize: json.length,
      };
    } catch {
      return { unserializable: true };
    }
  }
}
