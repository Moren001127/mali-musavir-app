import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Automation, AutomationStatus, AutomationTriggerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationRunnerService } from './automation-runner.service';
import { ACTION_BY_NAME } from './action-catalog';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { ListAutomationsQueryDto } from './dto/list-automations-query.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

const DEFAULT_PAGE_SIZE = 20;
const DISABLED_ACTIONS = new Set(['ocr_pdf', 'post_to_luca', 'send_sms']);

/**
 * Otomasyon kayıtlarının CRUD işlemleri.
 *
 * Faz 1: Sadece veri katmanı (CRUD).
 * Faz 3: Status değiştiğinde Runner'a cron register/unregister sinyali verir.
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private prisma: PrismaService,
    private runner: AutomationRunnerService,
  ) {}

  // ---------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------
  async create(tenantId: string, userId: string, dto: CreateAutomationDto) {
    this.validateTriggerConfig(dto.triggerType as unknown as AutomationTriggerType, dto.triggerConfig);
    this.validateSteps(dto.steps);
    this.validateFailurePolicy(dto.failurePolicy);

    const automation = await this.prisma.automation.create({
      data: {
        tenantId,
        createdById: userId,
        prompt: dto.prompt,
        title: dto.title,
        description: dto.description,
        triggerType: dto.triggerType as unknown as AutomationTriggerType,
        triggerConfig: dto.triggerConfig as Prisma.InputJsonValue,
        steps: dto.steps as Prisma.InputJsonValue,
        failurePolicy: dto.failurePolicy ?? 'notify',
        estimatedCostPerRun: dto.estimatedCostPerRun,
        status: AutomationStatus.DRAFT,
      },
    });

    this.logger.log(
      `Automation created: id=${automation.id} tenant=${tenantId} title="${automation.title}"`,
    );
    return automation;
  }

  // ---------------------------------------------------------------
  // LIST (paginated, filtered)
  // ---------------------------------------------------------------
  async list(tenantId: string, query: ListAutomationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.AutomationWhereInput = { tenantId };
    if (query.status) {
      where.status = query.status as unknown as AutomationStatus;
    } else {
      // Durum filtresi seçilmemişse arşivlenenleri gizle — listeyi şişirmesinler.
      // Kullanıcı "Arşiv" filtresini seçince yalnızca arşivlenenler görünür.
      where.status = { not: AutomationStatus.ARCHIVED };
    }
    if (query.triggerType) where.triggerType = query.triggerType as unknown as AutomationTriggerType;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { prompt: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.automation.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          _count: { select: { runs: true } },
        },
      }),
      this.prisma.automation.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ---------------------------------------------------------------
  // GET ONE
  // ---------------------------------------------------------------
  async findOne(tenantId: string, id: string) {
    const automation = await this.prisma.automation.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { runs: true } },
      },
    });
    if (!automation) throw new NotFoundException('Otomasyon bulunamadı.');
    this.assertTenantOwnership(automation.tenantId, tenantId);
    return automation;
  }

  // ---------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------
  async update(tenantId: string, id: string, dto: UpdateAutomationDto) {
    const existing = await this.prisma.automation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Otomasyon bulunamadı.');
    this.assertTenantOwnership(existing.tenantId, tenantId);

    if (dto.triggerType !== undefined || dto.triggerConfig !== undefined) {
      const nextTriggerType = (dto.triggerType ??
        existing.triggerType) as unknown as AutomationTriggerType;
      const nextTriggerConfig = (dto.triggerConfig ??
        existing.triggerConfig) as Record<string, unknown>;
      this.validateTriggerConfig(nextTriggerType, nextTriggerConfig);
    }
    if (dto.steps) this.validateSteps(dto.steps);
    this.validateFailurePolicy(dto.failurePolicy);

    const updated = await this.prisma.automation.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.triggerType !== undefined && {
          triggerType: dto.triggerType as unknown as AutomationTriggerType,
        }),
        ...(dto.triggerConfig !== undefined && {
          triggerConfig: dto.triggerConfig as Prisma.InputJsonValue,
        }),
        ...(dto.steps !== undefined && { steps: dto.steps as Prisma.InputJsonValue }),
        ...(dto.failurePolicy !== undefined && { failurePolicy: dto.failurePolicy }),
      },
    });

    if (
      existing.status === AutomationStatus.ACTIVE &&
      (dto.triggerType !== undefined || dto.triggerConfig !== undefined)
    ) {
      try {
        this.unregisterRunner(existing);
        this.registerRunner(updated);
      } catch (err: any) {
        this.logger.error(`Aktif otomasyon yeniden register edilemedi id=${id}: ${err.message}`);
        await this.prisma.automation.update({
          where: { id },
          data: { status: AutomationStatus.ERROR },
        });
        throw new BadRequestException(
          `Otomasyon güncellendi ama tetikleyici yeniden kurulamadı: ${err.message}`,
        );
      }
    }

    return updated;
  }

  // ---------------------------------------------------------------
  // SET STATUS (sade durum geçişi — daha az hata yüzeyi)
  // ---------------------------------------------------------------
  async setStatus(tenantId: string, id: string, status: AutomationStatus) {
    const existing = await this.prisma.automation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Otomasyon bulunamadı.');
    this.assertTenantOwnership(existing.tenantId, tenantId);

    // Geçerli geçişleri kısıtla (DRAFT → ACTIVE/ARCHIVED, ACTIVE ↔ PAUSED/ERROR/ARCHIVED gibi).
    const allowed = this.isAllowedTransition(existing.status, status);
    if (!allowed) {
      throw new BadRequestException(
        `${existing.status} → ${status} geçişi desteklenmiyor.`,
      );
    }

    if (status === AutomationStatus.ACTIVE) {
      this.validateTriggerConfig(
        existing.triggerType,
        existing.triggerConfig as Record<string, unknown>,
      );
    }

    const updated = await this.prisma.automation.update({
      where: { id },
      data: { status },
    });

    // Runner'ı bilgilendir: CRON veya EVENT tetikleyici varsa register/unregister.
    try {
      if (status === AutomationStatus.ACTIVE) {
        this.registerRunner(updated);
      } else {
        this.unregisterRunner(updated);
      }
    } catch (err: any) {
      this.logger.error(
        `Runner bilgilendirme hatası id=${id} status=${status}: ${err.message}`,
      );
      if (status === AutomationStatus.ACTIVE) {
        await this.prisma.automation.update({
          where: { id },
          data: { status: AutomationStatus.ERROR },
        });
        throw new BadRequestException(
          `Otomasyon aktif edilemedi (tetikleyici register hatası): ${err.message}`,
        );
      }
    }

    return updated;
  }

  // ---------------------------------------------------------------
  // DELETE (yumuşak silme — ARCHIVED)
  // ---------------------------------------------------------------
  async archive(tenantId: string, id: string) {
    return this.setStatus(tenantId, id, AutomationStatus.ARCHIVED);
  }

  /** Sert silme — yalnızca DRAFT durumdaki, hiç çalışmamış otomasyonlar için. */
  async hardDelete(tenantId: string, id: string) {
    const existing = await this.prisma.automation.findUnique({
      where: { id },
      include: { _count: { select: { runs: true } } },
    });
    if (!existing) throw new NotFoundException('Otomasyon bulunamadı.');
    this.assertTenantOwnership(existing.tenantId, tenantId);

    if (existing.status !== AutomationStatus.DRAFT || existing._count.runs > 0) {
      throw new BadRequestException(
        'Sadece hiç çalıştırılmamış DRAFT otomasyonlar tamamen silinebilir. Bu otomasyon ARŞİVLE.',
      );
    }
    await this.prisma.automation.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------
  // DUPLICATE — mevcut otomasyondan yeni DRAFT yarat
  // ---------------------------------------------------------------
  async duplicate(tenantId: string, userId: string, sourceId: string) {
    const source = await this.prisma.automation.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('Kaynak otomasyon bulunamadı.');
    this.assertTenantOwnership(source.tenantId, tenantId);

    const dup = await this.prisma.automation.create({
      data: {
        tenantId,
        createdById: userId,
        prompt: source.prompt,
        title: `${source.title} (kopya)`,
        description: source.description,
        triggerType: source.triggerType,
        triggerConfig: source.triggerConfig as Prisma.InputJsonValue,
        steps: source.steps as Prisma.InputJsonValue,
        failurePolicy: source.failurePolicy,
        estimatedCostPerRun: source.estimatedCostPerRun,
        status: AutomationStatus.DRAFT,
      },
    });
    this.logger.log(`Automation duplicated: source=${sourceId} new=${dup.id}`);
    return dup;
  }

  // ---------------------------------------------------------------
  // ÖZET — tenant geneli istatistikler (liste sayfasında üst bant için)
  // ---------------------------------------------------------------
  async summary(tenantId: string) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const runScope = {
      automation: { tenantId },
      startedAt: { gte: oneWeekAgo },
      NOT: [{ triggerPayload: { path: ['_mode'], equals: 'dry-run' } } as any],
    } as Prisma.AutomationRunWhereInput;

    const monthScope = {
      automation: { tenantId },
      startedAt: { gte: monthStart },
      NOT: [{ triggerPayload: { path: ['_mode'], equals: 'dry-run' } } as any],
    } as Prisma.AutomationRunWhereInput;

    // groupBy yerine ayrı count'lar — Prisma 5.22 type inference daha temiz oluyor.
    const [
      active,
      paused,
      error,
      draft,
      weeklySuccess,
      weeklyFailure,
      weeklyPartial,
      weeklyRunning,
      totalCost,
      monthlyCost,
    ] = await this.prisma.$transaction([
      this.prisma.automation.count({ where: { tenantId, status: AutomationStatus.ACTIVE } }),
      this.prisma.automation.count({ where: { tenantId, status: AutomationStatus.PAUSED } }),
      this.prisma.automation.count({ where: { tenantId, status: AutomationStatus.ERROR } }),
      this.prisma.automation.count({ where: { tenantId, status: AutomationStatus.DRAFT } }),
      this.prisma.automationRun.count({ where: { ...runScope, status: 'success' } }),
      this.prisma.automationRun.count({ where: { ...runScope, status: 'failure' } }),
      this.prisma.automationRun.count({ where: { ...runScope, status: 'partial' } }),
      this.prisma.automationRun.count({ where: { ...runScope, status: 'running' } }),
      this.prisma.automationRun.aggregate({
        where: runScope,
        _sum: { costUsd: true },
      }),
      this.prisma.automationRun.aggregate({
        where: monthScope,
        _sum: { costUsd: true },
      }),
    ]);

    const monthlyBudgetUsd = Number(process.env.AUTOMATIONS_MONTHLY_BUDGET_USD ?? 0) || null;

    return {
      active,
      paused,
      error,
      draft,
      weeklyTotal: weeklySuccess + weeklyFailure + weeklyPartial + weeklyRunning,
      weeklySuccess,
      weeklyFailure,
      weeklyPartial,
      weeklyCostUsd: totalCost._sum.costUsd || 0,
      monthlyCostUsd: monthlyCost._sum.costUsd || 0,
      monthlyBudgetUsd,
    };
  }

  // ---------------------------------------------------------------
  // RECENT RUNS — tenant geneli son N çalışma
  // ---------------------------------------------------------------
  async listRecentRuns(tenantId: string, limit = 20) {
    return this.prisma.automationRun.findMany({
      where: { automation: { tenantId } },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        automation: {
          select: { id: true, title: true, triggerType: true },
        },
      },
    });
  }

  // ---------------------------------------------------------------
  // RUNS (çalışma geçmişi)
  // ---------------------------------------------------------------
  async listRuns(tenantId: string, automationId: string, limit = 50) {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      select: { tenantId: true },
    });
    if (!automation) throw new NotFoundException('Otomasyon bulunamadı.');
    this.assertTenantOwnership(automation.tenantId, tenantId);

    return this.prisma.automationRun.findMany({
      where: { automationId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async getRun(tenantId: string, runId: string) {
    const run = await this.prisma.automationRun.findUnique({
      where: { id: runId },
      include: { automation: { select: { tenantId: true, title: true } } },
    });
    if (!run) throw new NotFoundException('Çalışma kaydı bulunamadı.');
    this.assertTenantOwnership(run.automation.tenantId, tenantId);
    return run;
  }

  // ---------------------------------------------------------------
  // VALIDATION HELPERS
  // ---------------------------------------------------------------
  private assertTenantOwnership(resourceTenantId: string, requestTenantId: string) {
    if (resourceTenantId !== requestTenantId) {
      throw new ForbiddenException('Bu otomasyona erişim yetkiniz yok.');
    }
  }

  private validateTriggerConfig(
    triggerType: AutomationTriggerType,
    config: Record<string, unknown>,
  ): void {
    if (!config || typeof config !== 'object') {
      throw new BadRequestException('triggerConfig bir JSON objesi olmalı.');
    }
    switch (triggerType) {
      case AutomationTriggerType.CRON:
        if (typeof config.cron !== 'string' || !config.cron.trim()) {
          throw new BadRequestException('CRON tetikleyici için config.cron (cron expression) zorunlu.');
        }
        // Cron expression detaylı doğrulaması Faz 3'te (runner motorunda) yapılacak —
        // burada sadece varlık kontrolü yeterli.
        break;
      case AutomationTriggerType.EVENT:
        if (typeof config.eventName !== 'string' || !config.eventName.trim()) {
          throw new BadRequestException('EVENT tetikleyici için config.eventName zorunlu.');
        }
        break;
      case AutomationTriggerType.WEBHOOK:
        if (process.env.AUTOMATIONS_ENABLE_WEBHOOKS !== 'true') {
          throw new BadRequestException(
            'WEBHOOK tetikleyici bu sürümde aktif değil. AUTOMATIONS_ENABLE_WEBHOOKS=true olmadan kullanılamaz.',
          );
        }
        break;
      case AutomationTriggerType.MANUAL:
        // Konfigürasyon gerekmez.
        break;
    }
  }

  private validateSteps(steps: Record<string, unknown>): void {
    if (!steps || typeof steps !== 'object') {
      throw new BadRequestException('steps bir JSON objesi olmalı.');
    }
    const schemaVersion = (steps as any).schemaVersion;
    const stepList = (steps as any).steps;
    if (schemaVersion !== 1) {
      throw new BadRequestException('Bu sürümde sadece steps.schemaVersion=1 destekleniyor.');
    }
    if (!Array.isArray(stepList) || stepList.length === 0) {
      throw new BadRequestException('steps.steps boş olmayan bir dizi olmalı.');
    }
    const unknownTools = this.collectUnknownTools(stepList);
    if (unknownTools.length > 0) {
      throw new BadRequestException(`Bilinmeyen otomasyon aksiyonu: ${unknownTools.join(', ')}`);
    }
    const disabledTools = this.collectDisabledTools(stepList);
    if (disabledTools.length > 0) {
      throw new BadRequestException(
        `Bu aksiyonlar henüz gerçek çalışmaya açık değil: ${disabledTools.join(', ')}.`,
      );
    }
  }

  private collectUnknownTools(steps: any[]): string[] {
    const unknown = new Set<string>();
    const walk = (list: any[]) => {
      for (const step of list) {
        if (!step || typeof step !== 'object') continue;
        if (typeof step.tool !== 'string' || !ACTION_BY_NAME[step.tool]) {
          unknown.add(String(step.tool ?? '(eksik)'));
        }
        if (Array.isArray(step.steps)) walk(step.steps);
        if (Array.isArray(step.then)) walk(step.then);
        if (Array.isArray(step.else)) walk(step.else);
        if (Array.isArray(step.branches)) {
          for (const branch of step.branches) {
            if (Array.isArray(branch)) walk(branch);
          }
        }
      }
    };
    walk(steps);
    return [...unknown];
  }

  private collectDisabledTools(steps: any[]): string[] {
    const disabled = new Set<string>();
    const walk = (list: any[]) => {
      for (const step of list) {
        if (!step || typeof step !== 'object') continue;
        if (typeof step.tool === 'string' && DISABLED_ACTIONS.has(step.tool)) {
          disabled.add(step.tool);
        }
        if (Array.isArray(step.steps)) walk(step.steps);
        if (Array.isArray(step.then)) walk(step.then);
        if (Array.isArray(step.else)) walk(step.else);
        if (Array.isArray(step.branches)) {
          for (const branch of step.branches) {
            if (Array.isArray(branch)) walk(branch);
          }
        }
      }
    };
    walk(steps);
    return [...disabled];
  }

  private validateFailurePolicy(policy?: string): void {
    if (!policy) return;
    if (!['notify', 'pause_after_3', 'ignore'].includes(policy)) {
      throw new BadRequestException('failurePolicy notify, pause_after_3 veya ignore olmalı.');
    }
  }

  private registerRunner(automation: Automation): void {
    if (automation.triggerType === AutomationTriggerType.CRON) {
      this.runner.registerCron(automation);
    } else if (automation.triggerType === AutomationTriggerType.EVENT) {
      this.runner.registerEvent(automation);
    }
  }

  private unregisterRunner(automation: Pick<Automation, 'id' | 'triggerType'>): void {
    if (automation.triggerType === AutomationTriggerType.CRON) {
      this.runner.unregisterCron(automation.id);
    } else if (automation.triggerType === AutomationTriggerType.EVENT) {
      this.runner.unregisterEvent(automation.id);
    }
  }

  private isAllowedTransition(from: AutomationStatus, to: AutomationStatus): boolean {
    if (from === to) return true;
    const matrix: Record<AutomationStatus, AutomationStatus[]> = {
      [AutomationStatus.DRAFT]: [AutomationStatus.ACTIVE, AutomationStatus.ARCHIVED],
      [AutomationStatus.ACTIVE]: [
        AutomationStatus.PAUSED,
        AutomationStatus.ERROR,
        AutomationStatus.ARCHIVED,
      ],
      [AutomationStatus.PAUSED]: [AutomationStatus.ACTIVE, AutomationStatus.ARCHIVED],
      [AutomationStatus.ERROR]: [
        AutomationStatus.ACTIVE,
        AutomationStatus.PAUSED,
        AutomationStatus.ARCHIVED,
      ],
      [AutomationStatus.ARCHIVED]: [], // Arşivlenen geri alınamaz (manuel DB müdahalesi gerek).
    };
    return matrix[from]?.includes(to) ?? false;
  }
}
