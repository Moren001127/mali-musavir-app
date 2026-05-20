import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AutomationStatus, AutomationTriggerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationRunnerService } from './automation-runner.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { ListAutomationsQueryDto } from './dto/list-automations-query.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

const DEFAULT_PAGE_SIZE = 20;

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
    if (query.status) where.status = query.status as unknown as AutomationStatus;
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

    if (dto.triggerType && dto.triggerConfig) {
      this.validateTriggerConfig(dto.triggerType as unknown as AutomationTriggerType, dto.triggerConfig);
    } else if (dto.triggerConfig) {
      this.validateTriggerConfig(existing.triggerType, dto.triggerConfig);
    }
    if (dto.steps) this.validateSteps(dto.steps);

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
        ...(dto.status !== undefined && { status: dto.status as unknown as AutomationStatus }),
        ...(dto.failurePolicy !== undefined && { failurePolicy: dto.failurePolicy }),
      },
    });
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

    const updated = await this.prisma.automation.update({
      where: { id },
      data: { status },
    });

    // Runner'ı bilgilendir: CRON tetikleyici varsa cron job'ı ekle/kaldır.
    try {
      if (updated.triggerType === AutomationTriggerType.CRON) {
        if (status === AutomationStatus.ACTIVE) {
          this.runner.registerCron(updated);
        } else {
          // PAUSED, ERROR, ARCHIVED — cron'u kaldır
          this.runner.unregisterCron(updated.id);
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Runner bilgilendirme hatası id=${id} status=${status}: ${err.message}`,
      );
      // Status güncellemesi başarılı oldu ama cron register başarısız —
      // ERROR durumuna alıp kullanıcıya hata mesajı dönelim.
      if (status === AutomationStatus.ACTIVE) {
        await this.prisma.automation.update({
          where: { id },
          data: { status: AutomationStatus.ERROR },
        });
        throw new BadRequestException(
          `Otomasyon aktif edilemedi (cron register hatası): ${err.message}`,
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
        // Secret service tarafında otomatik üretilir — DTO'da zorunlu değil.
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
    // Adım doğrulaması (tool adı, parametreler) Faz 2'de parser tarafında daha sıkı yapılır.
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
