import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  Automation,
  AutomationRun,
  AutomationStatus,
  AutomationTriggerType,
  Prisma,
} from '@prisma/client';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ACTION_BY_NAME } from './action-catalog';
import { ActionDispatcherService } from './action-dispatcher.service';
import { AutomationEventBus } from './automation-event-bus.service';
import { evaluateCondition, resolveTemplates, ResolveContext } from './template-resolver';

const MAX_FOR_EACH_ITEMS = 1000;
const MAX_NESTED_DEPTH = 10;
const MAX_WAIT_MS = 60 * 60 * 1000; // 1 saat (daha uzun bekleme için Bull delayed job — Faz 5)
const STEP_LOG_LIMIT_BYTES = 8 * 1024; // step çıktısı log'a kaydedilirken bu kadar kırpılır
const PARALLEL_DEFAULT_CONCURRENCY = 5; // parallel branch'lerinde aynı anda en fazla kaç dal
const RETRY_MAX_ATTEMPTS = 2; // READ/AI adımlarında geçici hatada toplam deneme (1 ilk + 1 retry)
const RETRY_BACKOFF_MS = 1200; // retry öncesi bekleme
// Boot'ta bundan eski 'running' run'lar "sunucu yeniden başladı" diye kapatılır.
const STALE_RUNNING_MS = 2 * 60 * 1000;

interface StepLog {
  stepId: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  ms: number;
  ts: string;
}

type LoadedAutomation = Automation & {
  createdBy: { id: string; email: string; firstName: string; lastName: string } | null;
  tenant: { id: string; name: string };
};

interface ExecuteOptions {
  dryRun?: boolean;
  requireActive?: boolean;
  updateMetrics?: boolean;
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
  /**
   * Şu an çalışan otomasyon id'leri — aynı otomasyonun cron/event tetiğiyle
   * kendisiyle üst üste binmesini (overlap) önlemek için. Manuel "Şimdi Çalıştır"
   * ve dry-run bu kilide takılmaz (kullanıcı bilerek tetikler).
   *
   * NOT: Bu kilit TEK süreç içindir. Birden fazla sunucu kopyası (Railway replica > 1)
   * çalışırsa her kopya kendi cron'unu kurar ve bu Set paylaşılmaz → otomasyon çift
   * çalışabilir. Bu sürüm tek-kopya varsayar; yatay ölçek için Redis tabanlı dağıtık
   * kilit (veya AUTOMATIONS_SCHEDULER_ENABLED ile tek worker) gerekir.
   */
  private readonly running = new Set<string>();
  /** Zamanlayıcı bu kopyada açık mı? Çok kopyalı kurulumda yalnız birinde 'true' bırakılır. */
  private readonly schedulerEnabled = process.env.AUTOMATIONS_SCHEDULER_ENABLED !== 'false';
  private staleWatchdog?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: ActionDispatcherService,
    private readonly scheduler: SchedulerRegistry,
    private readonly eventBus: AutomationEventBus,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------
  // YAŞAM DÖNGÜSÜ
  // ---------------------------------------------------------------

  async onModuleInit() {
    try {
      // 0) Yeniden başlatma temizliği: bir önceki süreçte yarıda kalmış (deploy/crash)
      // 'running' run'lar sonsuza dek asılı kalmasın — "kesildi" olarak kapat.
      await this.closeStaleRunningRuns();

      if (!this.schedulerEnabled) {
        this.logger.warn(
          'AUTOMATIONS_SCHEDULER_ENABLED=false — bu kopyada cron/event tetikleyiciler KURULMAYACAK ' +
            '(çok kopyalı kurulumda çift çalışmayı önlemek için yalnız bir kopyada açık olmalı).',
        );
        return;
      }

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

      // Faz 2: Mihsap token tazelendiğinde, token/oturum hatasıyla başarısız olmuş
      // fatura-çekme otomasyonlarını otomatik yeniden dene. (Bu bir otomasyon
      // tetikleyicisi değil, iç mekanizmadır — yalnız scheduler açık kopyada kurulur.)
      this.eventBus.on('Mihsap.TokenYenilendi', (payload: any) => {
        const tenantId = String(payload?.tenantId ?? '');
        if (!tenantId) return;
        this.retryFailedMihsapFetches(tenantId).catch((err) =>
          this.logger.error(`Mihsap token-retry hatası: ${err?.message ?? err}`),
        );
      });
      this.logger.log('Mihsap token-retry dinleyicisi kuruldu.');

      // Periyodik takılan-iş temizliği: eskiden closeStaleRunningRuns YALNIZ boot'ta
      // çalışıyordu; süreç ayakta kalırken bir run kill/deadlock ile 'running' takılırsa
      // sunucu yeniden başlamadan temizlenmiyor ve sonraki turlar this.running ile sessizce
      // atlanıyordu. Artık dakikada bir watchdog ile kendi kendine iyileşir.
      this.staleWatchdog = setInterval(() => {
        this.closeStaleRunningRuns().catch((err) =>
          this.logger.warn(`Stale-run watchdog hatası: ${err?.message ?? err}`),
        );
      }, 60_000);
      if (typeof this.staleWatchdog?.unref === 'function') this.staleWatchdog.unref();
    } catch (err: any) {
      this.logger.error(`Otomasyon boot hatası: ${err.message}`);
    }
  }

  /**
   * Faz 2 — Mihsap token tazelendiğinde otomatik yeniden deneme.
   *
   * Token/oturum süresi dolduğu için fatura çekemeyip başarısız olmuş otomasyon
   * çalışmalarını bulur ve ORİJİNAL payload'la yeniden çalıştırır (fetch + backup tüm
   * zincir). Eklenti Mihsap sayfası açıkken token'ı yeniler; bu noktaya gelindiğinde
   * "bekleyen" çekme işleri kendiliğinden tamamlanır — kullanıcı elle uğraşmaz.
   *
   * Dedupe: o mükellef+dönem için fatura ARTIK çekildiyse yeniden denenmez
   * (MihsapInvoice kontrolü). Migration gerektirmez; AutomationRun geçmişinden türetir.
   */
  /** 12 ay öncesini YYYY-MM formatında döndürür — eski dönem filtresi için. */
  private donemCutoff(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 11);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Faz 2 — Mihsap token tazelendiğinde otomatik yeniden deneme.
   *
   * Sonsuz döngü koruması:
   *  - _isTokenRetry=true olan payload'lardan açılan run'lar atlanır
   *  - 12 aydan eski dönemler atlanır (geçmiş yıl faturası sonsuz döngüsü önlenir)
   */
  private async retryFailedMihsapFetches(tenantId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cutoff = this.donemCutoff();
    const failedRuns = await this.prisma.automationRun.findMany({
      where: {
        status: 'failure',
        startedAt: { gte: since },
        errorMessage: { contains: 'Mihsap' },
        automation: { tenantId, status: AutomationStatus.ACTIVE },
        // Kendi açtığı retry run'larını tekrar deneme (sonsuz döngü koruması)
        NOT: [{ triggerPayload: { path: ['_isTokenRetry'], equals: true } } as any],
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    if (failedRuns.length === 0) return;

    const seen = new Set<string>();
    for (const run of failedRuns) {
      const payload = (run.triggerPayload ?? {}) as any;
      const taxpayerId = String(payload.taxpayerId ?? '');
      const donem = String(payload.beyannamePeriodLabel ?? payload.donem ?? '');
      if (!taxpayerId || !donem) continue;

      // 12 aydan eski dönemler denenmez
      if (donem < cutoff) {
        this.logger.log(`Mihsap retry atlandı (eski dönem ${donem} < ${cutoff}): automation=${run.automationId}`);
        continue;
      }

      // Aynı (otomasyon + mükellef + dönem) en fazla bir kez denensin.
      const key = `${run.automationId}|${taxpayerId}|${donem}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Otomasyon hâlâ çalışıyorsa (overlap) atla.
      if (this.running.has(run.automationId)) continue;

      // Dedupe: bu mükellef+dönem için fatura zaten çekildiyse yeniden deneme.
      const zatenVar = await this.prisma.mihsapInvoice.count({
        where: { tenantId, mukellefId: taxpayerId, donem },
      });
      if (zatenVar > 0) continue;

      this.logger.log(
        `Mihsap token yenilendi → fatura çekme yeniden deneniyor: ` +
          `automation=${run.automationId} taxpayer=${taxpayerId} donem=${donem}`,
      );
      // Orijinal payload ile tüm zinciri yeniden çalıştır; _isTokenRetry işareti
      // bu run'un tekrar retry'a girmesini engeller.
      this.executeAutomation(run.automationId, { ...payload, _isTokenRetry: true }).catch((err) =>
        this.logger.error(
          `Mihsap retry run hatası (automation=${run.automationId}): ${err?.message ?? err}`,
        ),
      );
    }
  }

  /**
   * Önceki süreçten kalan asılı 'running' run'ları kapatır. Sunucu deploy/crash ile
   * yeniden başladığında bellekteki çalışmalar ölür ama DB'deki run kaydı 'running'
   * kalır — bu, listede sonsuza dek "çalışıyor" görünmesine yol açar. Boot'ta bunları
   * 'failure' olarak işaretleyip ilgili otomasyonun son durumunu da güncelliyoruz.
   */
  private async closeStaleRunningRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
    try {
      const stale = await this.prisma.automationRun.findMany({
        where: { status: 'running', startedAt: { lt: cutoff } },
        select: { id: true, automationId: true, triggerPayload: true },
      });
      if (stale.length === 0) return;

      await this.prisma.automationRun.updateMany({
        where: { id: { in: stale.map((r) => r.id) } },
        data: {
          status: 'failure',
          finishedAt: new Date(),
          errorMessage: 'Sunucu yeniden başlatıldı — çalışma yarıda kaldı.',
          summary: 'Çalışma sunucu yeniden başlatılınca kesildi.',
        },
      });

      // Gerçek (dry-run olmayan) kesik run'lar için otomasyon sayaçlarını da düzelt.
      const realStale = stale.filter(
        (r) => (r.triggerPayload as any)?._mode !== 'dry-run',
      );
      for (const r of realStale) {
        await this.prisma.automation
          .update({
            where: { id: r.automationId },
            data: {
              lastRunAt: new Date(),
              lastRunStatus: 'failure',
              totalRuns: { increment: 1 },
              failureRuns: { increment: 1 },
            },
          })
          .catch(() => undefined);
      }
      this.logger.warn(`Boot temizliği: ${stale.length} asılı 'running' run kapatıldı.`);
    } catch (err: any) {
      this.logger.error(`Asılı run temizliği hatası: ${err.message}`);
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
        // Üst üste binme koruması: önceki tetik hâlâ çalışıyorsa bu turu atla.
        if (this.running.has(automation.id)) {
          this.logger.warn(`Cron atlandı (önceki çalışma sürüyor): id=${automation.id}`);
          this.updateNextRunAt(automation.id);
          return;
        }
        this.executeAutomation(automation.id, { source: 'cron', firedAt: new Date().toISOString() })
          .catch((err) => {
            this.logger.error(`Cron run hata id=${automation.id}: ${err.message}`);
          })
          .finally(() => this.updateNextRunAt(automation.id));
      },
      null, // onComplete
      false, // start
      timezone, // timezone
    );
    this.scheduler.addCronJob(jobId, job as unknown as any);
    job.start();
    this.updateNextRunAt(automation.id, job as unknown as CronJob);
    this.logger.log(`Cron register: id=${automation.id} expr="${cronExpr}" tz=${timezone}`);
  }

  /**
   * Cron job'un bir sonraki çalışma zamanını otomasyon kaydına yazar.
   * Liste/detay sayfasında "Sonraki çalışma" göstergesi bunu kullanır.
   */
  private updateNextRunAt(automationId: string, job?: CronJob): void {
    try {
      const j: any =
        job ?? (this.scheduler.getCronJob(this.cronPrefix + automationId) as unknown);
      const next = j?.nextDate?.();
      const date: Date | null = next?.toJSDate
        ? next.toJSDate()
        : next instanceof Date
          ? next
          : typeof next?.toMillis === 'function'
            ? new Date(next.toMillis())
            : null;
      if (date && !Number.isNaN(date.getTime())) {
        this.prisma.automation
          .update({ where: { id: automationId }, data: { nextRunAt: date } })
          .catch(() => undefined);
      }
    } catch {
      // Sessiz — nextRunAt göstergesi kritik değil.
    }
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
    // Duraklatılan/arşivlenen otomasyonda "sonraki çalışma" gösterilmesin.
    this.prisma.automation
      .update({ where: { id: automationId }, data: { nextRunAt: null } })
      .catch(() => undefined);
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

      // EVRAK ŞALTERİ (2026-08-18): Taxpayer.Evrak* olayları evrak otomasyonuna
      // ait; o akışın gönderim izni MOREN_EVRAK_CANLI + proaktif şalterle
      // yönetiliyor. Otomasyon motoru bu şalterleri hiç bilmediği için, bu
      // olaylara bağlı bir WhatsApp kuralı tanımlanmışsa mesaj şalter kapalıyken
      // de, gece de, cumartesi de mükellefe gidiyordu.
      if (eventName.startsWith('Taxpayer.Evrak')) {
        const canli = process.env.MOREN_EVRAK_CANLI === '1';
        const proaktif = process.env.MOREN_CLIENT_PROACTIVE_REMINDERS === '1';
        if (!canli || !proaktif) {
          this.logger.warn(
            `Evrak olayı atlandı (şalter kapalı): id=${automation.id} event=${eventName}. ` +
            'Açmak için MOREN_EVRAK_CANLI=1 ve MOREN_CLIENT_PROACTIVE_REMINDERS=1.',
          );
          return;
        }
      }

      // Filter eşleşmesi — her filter key'i payload'a eşit olmalı
      for (const [key, expected] of Object.entries(filters)) {
        if ((payload as any)[key] !== expected) {
          return; // filter geçemedi
        }
      }

      // Olay fırtınası koruması: aynı otomasyon hâlâ çalışıyorsa bu olayı atla
      // (örn. toplu içe aktarımda yüzlerce Taxpayer.Created peş peşe gelebilir).
      if (this.running.has(automation.id)) {
        this.logger.warn(`Event atlandı (önceki çalışma sürüyor): id=${automation.id} event=${eventName}`);
        return;
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
    options?: ExecuteOptions,
  ): Promise<{ runId: string; status: string; summary?: string }> {
    const { automation, run } = await this.prepareRun(automationId, triggerPayload, options);
    return this.executePreparedRun(automation, run, triggerPayload, options);
  }

  /**
   * HTTP isteklerini uzun süre açık tutmamak için run kaydını hemen yaratır ve
   * çalışmayı event loop'a bırakır. Kalıcı kuyruk ihtiyacı için Bull/Redis'e
   * taşınabilecek tek giriş noktası burasıdır.
   */
  async enqueueAutomation(
    automationId: string,
    triggerPayload?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<{ runId: string; status: string; summary: string }> {
    const { automation, run } = await this.prepareRun(automationId, triggerPayload, options);
    setImmediate(() => {
      this.executePreparedRun(automation, run, triggerPayload, options).catch((err) => {
        this.markRunFailure(run.id, err).catch((markErr) => {
          this.logger.error(`Run ${run.id} hata olarak işaretlenemedi: ${markErr.message}`);
        });
      });
    });
    return {
      runId: run.id,
      status: 'running',
      summary: options?.dryRun ? 'Dry-run kuyruğa alındı.' : 'Çalışma kuyruğa alındı.',
    };
  }

  private async prepareRun(
    automationId: string,
    triggerPayload?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<{ automation: LoadedAutomation; run: AutomationRun }> {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: { createdBy: { select: { id: true, email: true, firstName: true, lastName: true } }, tenant: true },
    });
    if (!automation) throw new NotFoundException('Otomasyon bulunamadı.');

    this.assertRunnable(automation, options);

    // Gerçek çalışmalardan önce tenant aylık AI bütçesini kontrol et (dry-run muaf).
    if (options?.dryRun !== true) {
      await this.assertWithinBudget(automation);
    }

    const storedPayload = {
      ...(triggerPayload ?? {}),
      ...(options?.dryRun ? { _mode: 'dry-run' } : {}),
    };

    const run = await this.prisma.automationRun.create({
      data: {
        automationId,
        status: 'running',
        triggerPayload: storedPayload as Prisma.InputJsonValue,
        stepLogs: [] as unknown as Prisma.InputJsonValue,
      },
    });

    return { automation: automation as LoadedAutomation, run };
  }

  private assertRunnable(automation: Automation, options?: ExecuteOptions): void {
    if (options?.dryRun) {
      if (automation.status === AutomationStatus.ARCHIVED) {
        throw new BadRequestException('Arşivlenmiş otomasyon dry-run ile çalıştırılamaz.');
      }
      return;
    }

    const requireActive = options?.requireActive !== false;
    if (requireActive && automation.status !== AutomationStatus.ACTIVE) {
      this.logger.warn(`Çalıştırma reddedildi: id=${automation.id} status=${automation.status}`);
      throw new BadRequestException(
        `Otomasyon ${automation.status} durumda — gerçek çalışma için önce ACTIVE'e alın.`,
      );
    }
  }

  private async executePreparedRun(
    automation: LoadedAutomation,
    run: AutomationRun,
    triggerPayload?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<{ runId: string; status: string; summary?: string }> {
    // Üst üste binme kilidi — sadece gerçek çalışmalar için (dry-run kullanıcı testi).
    const useLock = options?.dryRun !== true;
    if (useLock) this.running.add(automation.id);
    try {
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
    if (options?.updateMetrics !== false && options?.dryRun !== true) {
      await this.updateCountersAfterRun(automation, status, errorMessage ?? summary);
    }

    return { runId: run.id, status, summary };
    } finally {
      if (useLock) this.running.delete(automation.id);
    }
  }

  private async markRunFailure(runId: string, err: unknown): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    this.logger.error(`Run ${runId} background fatal: ${errorMessage}`);
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        status: 'failure',
        errorMessage,
        summary: `Çalışma başlatılamadı: ${errorMessage}`,
      },
    });
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
      const output = { dryRun: true, message: 'Dry-run: gerçek çalıştırma yapılmadı' };
      if (step.outputAs) {
        ctx.outputs[step.outputAs] = output;
      }
      log.push({
        stepId,
        tool,
        input: args,
        output,
        ms: 0,
        ts: new Date().toISOString(),
      });
      return { cost: 0 };
    }

    // LEAF aksiyon — dispatcher'a yolla
    const startMs = Date.now();
    try {
      const output = await this.dispatchWithRetry(
        tool,
        args as Record<string, unknown>,
        dispatchCtx,
        action.category,
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
          // Toplu gönderimlerde sağlayıcı oran sınırına takılmamak için iterasyonlar
          // arasına opsiyonel gecikme. 0..10sn arası; dry-run'da beklenmez.
          const throttleMs = Math.min(Math.max(Number(args.throttleMs ?? 0), 0), 10_000);
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
            if (throttleMs > 0 && !opts.dryRun && i < list.length - 1) {
              await new Promise((r) => setTimeout(r, throttleMs));
            }
          }
          log.push({
            stepId,
            tool: 'for_each',
            input: { count: list.length, as: asName, throttleMs },
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
          // Aynı anda en fazla `concurrency` dal — varsayılan 5, args ile ayarlanabilir.
          const concurrency = Math.max(
            1,
            Math.min(Number(args.concurrency ?? PARALLEL_DEFAULT_CONCURRENCY), branches.length || 1),
          );
          const results = await this.runWithConcurrency(
            branches as any[][],
            concurrency,
            (branchSteps) =>
              this.executeStepList(branchSteps, ctx, dispatchCtx, log, {
                ...opts,
                depth: opts.depth + 1,
              }),
          );
          const cost = results.reduce((a, b) => a + b.cost, 0);
          log.push({
            stepId,
            tool: 'parallel',
            input: { branchCount: branches.length, concurrency },
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

  /**
   * Bir LEAF aksiyonu çalıştırır; geçici hatada yeniden dener.
   *
   * ÖNEMLİ: Retry yalnızca READ ve AI aksiyonları içindir — bunlar idempotenttir
   * (tekrar okumak/özetlemek güvenli). WRITE/EXTERNAL aksiyonlara (WhatsApp, e-posta,
   * fiş üretimi vb.) ASLA otomatik retry yapılmaz; aksi halde aynı mesaj iki kez gider.
   */
  private async dispatchWithRetry(
    tool: string,
    args: Record<string, unknown>,
    ctx: { tenantId: string; userId: string; automationId: string },
    category: string,
  ): Promise<unknown> {
    const retriable = category === 'READ' || category === 'AI';
    const maxAttempts = retriable ? RETRY_MAX_ATTEMPTS : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.dispatcher.dispatch(tool, args, ctx);
      } catch (err: any) {
        lastErr = err;
        if (attempt >= maxAttempts) break;
        this.logger.warn(
          `Aksiyon "${tool}" ${attempt}. denemede başarısız, yeniden denenecek: ${err?.message}`,
        );
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
    throw lastErr;
  }

  /**
   * Bir dizi işi en fazla `limit` tanesi aynı anda olacak şekilde çalıştırır.
   * parallel akış aksiyonunda branch sayısı çok olduğunda hepsini birden başlatıp
   * sağlayıcı limitlerini zorlamamak için kullanılır.
   */
  private async runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let idx = 0;
    const runnerCount = Math.max(1, Math.min(limit, items.length));
    const runners = Array.from({ length: runnerCount }, async () => {
      while (idx < items.length) {
        const cur = idx++;
        results[cur] = await worker(items[cur], cur);
      }
    });
    await Promise.all(runners);
    return results;
  }

  // ---------------------------------------------------------------
  // SAYIM + HATA POLİTİKASI
  // ---------------------------------------------------------------

  private async updateCountersAfterRun(
    automation: Automation,
    status: 'success' | 'failure' | 'partial',
    failureContext?: string,
  ): Promise<void> {
    const lastRunStatus = status;
    const incSuccess = status === 'success' ? 1 : 0;
    const incFailure = status === 'failure' || status === 'partial' ? 1 : 0;

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

    if (status === 'success') return;

    // Hata politikası: "ignore" → hiçbir şey yapma.
    if (automation.failurePolicy === 'ignore') return;

    // "notify" ve "pause_after_3" → sahibe in-app bildirim gönder (dedupe ile spam önle).
    await this.notifyOwnerOfFailure(automation, status, failureContext);

    // "pause_after_3" → son 3 gerçek run sorunluysa otomasyonu duraklat.
    if (automation.failurePolicy === 'pause_after_3') {
      const recent = await this.prisma.automationRun.findMany({
        where: {
          automationId: automation.id,
          NOT: [{ triggerPayload: { path: ['_mode'], equals: 'dry-run' } } as any],
        },
        orderBy: { startedAt: 'desc' },
        take: 3,
        select: { status: true },
      });
      if (recent.length === 3 && recent.every((r) => r.status === 'failure' || r.status === 'partial')) {
        await this.prisma.automation.update({
          where: { id: automation.id },
          data: { status: AutomationStatus.PAUSED },
        });
        if (automation.triggerType === AutomationTriggerType.CRON) {
          this.unregisterCron(automation.id);
        } else if (automation.triggerType === AutomationTriggerType.EVENT) {
          this.unregisterEvent(automation.id);
        }
        this.logger.warn(
          `Otomasyon ${automation.id} 3 ardışık sorunlu run sonrası PAUSED'a alındı.`,
        );
        await this.notifyOwnerOfFailure(
          automation,
          status,
          '3 ardışık başarısız çalışma sonrası otomatik DURAKLATILDI. Düzelttikten sonra yeniden başlat.',
          true,
        );
      }
    }
  }

  /**
   * Otomasyon sahibine (yoksa tenant geneline) hata bildirimi oluşturur.
   * dedupeKey ile 3 saatte aynı otomasyon için en fazla bir hata bildirimi düşer —
   * her dakika çalışan bir otomasyon bozulduğunda bildirim yağmuru olmaz.
   */
  private async notifyOwnerOfFailure(
    automation: Automation,
    status: 'failure' | 'partial',
    context?: string,
    paused = false,
  ): Promise<void> {
    try {
      const durum = paused
        ? 'arka arkaya başarısız olduğu için DURAKLATILDI'
        : status === 'partial'
          ? 'kısmen başarısız oldu (bazı adımlar hata verdi)'
          : 'başarısız oldu';
      const sebep = context ? ` Sebep: ${String(context).slice(0, 280)}` : '';
      await this.notifications.create({
        tenantId: automation.tenantId,
        userId: automation.createdById ?? undefined,
        title: `Otomasyon: ${automation.title}`,
        body: `"${automation.title}" otomasyonu ${durum}.${sebep} Ayrıntı için Otomasyonlar → çalışma geçmişine bak.`,
        type: 'AUTOMATION',
        metadata: { automationId: automation.id, kind: paused ? 'auto-paused' : 'failure' },
        dedupeKey: paused ? `auto-paused:${automation.id}` : `auto-fail:${automation.id}`,
        dedupeWindowMin: paused ? 60 : 180,
      });
    } catch (err: any) {
      this.logger.error(`Hata bildirimi oluşturulamadı id=${automation.id}: ${err.message}`);
    }
  }

  /**
   * Tenant'ın bu ayki toplam otomasyon AI harcaması limiti aştıysa çalışmayı reddeder.
   * Limit env `AUTOMATIONS_MONTHLY_BUDGET_USD` ile verilir; 0/boş = limitsiz (varsayılan).
   * Beklenmedik kesinti olmasın diye varsayılan kapalıdır — ofis isterse env ile açar.
   */
  private async assertWithinBudget(automation: Automation): Promise<void> {
    const limit = Number(process.env.AUTOMATIONS_MONTHLY_BUDGET_USD ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) return;

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const agg = await this.prisma.automationRun.aggregate({
      where: {
        automation: { tenantId: automation.tenantId },
        startedAt: { gte: monthStart },
        NOT: [{ triggerPayload: { path: ['_mode'], equals: 'dry-run' } } as any],
      },
      _sum: { costUsd: true },
    });
    const spent = agg._sum.costUsd ?? 0;
    if (spent >= limit) {
      await this.notifyBudgetExceeded(automation, spent, limit);
      throw new BadRequestException(
        `Bu ayki otomasyon AI bütçesi doldu ($${spent.toFixed(2)} / $${limit.toFixed(2)}). ` +
          `Otomasyon çalıştırılmadı.`,
      );
    }
  }

  private async notifyBudgetExceeded(
    automation: Automation,
    spent: number,
    limit: number,
  ): Promise<void> {
    try {
      await this.notifications.create({
        tenantId: automation.tenantId,
        userId: automation.createdById ?? undefined,
        title: 'Otomasyon bütçesi doldu',
        body:
          `Bu ayki otomasyon yapay zekâ harcaması $${spent.toFixed(2)} oldu ve limiti ($${limit.toFixed(2)}) aştı. ` +
          `Yeni otomasyon çalışmaları, ay yenilenene veya limit artırılana kadar duracak.`,
        type: 'AUTOMATION',
        metadata: { kind: 'budget-exceeded' },
        dedupeKey: `auto-budget:${automation.tenantId}`,
        dedupeWindowMin: 720,
      });
    } catch {
      // bildirim opsiyonel
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
