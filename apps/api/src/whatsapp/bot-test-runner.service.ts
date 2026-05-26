import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotEvalService } from './bot-eval.service';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { QualityLogService } from './quality-log.service';
import { BOT_TEST_SCENARIOS, BotTestScenario } from './test-scenarios';

@Injectable()
export class BotTestRunnerService {
  private readonly logger = new Logger(BotTestRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: IntentClassifierService,
    private readonly postFilter: WhatsAppBotPostFilterService,
    private readonly evaluator: BotEvalService,
    private readonly qualityLog: QualityLogService,
  ) {}

  async runNow(tenantId?: string) {
    const scratch = await this.ensureScratchTenant(tenantId);
    const batchId = `qa-${Date.now().toString(36)}`;
    const results = [];

    for (const scenario of BOT_TEST_SCENARIOS) {
      const classified = this.classifier.classify(scenario.message);
      const rawCandidate = scenario.candidateReply || this.defaultCandidate(scenario, classified.intent);
      const candidate = this.postFilter.filterTaxpayerReply(rawCandidate, {
        recentReplies: scenario.lastOutgoing || [],
      });
      const evalResult = await this.evaluator.evaluateReply(
        candidate,
        {
          tenantId: scratch.tenantId,
          taxpayerId: scratch.taxpayerId,
          intent: classified.intent,
          message: scenario.message,
          source: 'synthetic',
        },
        scenario.lastOutgoing || [],
        { allowLlm: process.env.BOT_QA_SYNTHETIC_LLM === '1' },
      );

      const validationReasons = this.validateScenario(scenario, candidate, classified.intent, evalResult.score);
      const pass = validationReasons.length === 0;
      const status = pass ? 'PASSED' : 'SYNTHETIC_FAIL';
      const reasons = Array.from(new Set([...evalResult.reasons, ...validationReasons]));

      const log = await this.qualityLog.createLog({
        tenantId: scratch.tenantId,
        taxpayerId: scratch.taxpayerId,
        source: 'SYNTHETIC_TEST',
        status,
        score: pass ? Math.max(evalResult.score, 6) : Math.min(evalResult.score, 5),
        intent: classified.intent,
        reasons,
        originalReply: rawCandidate,
        finalReply: candidate,
        evalModel: evalResult.model,
        inputTokens: evalResult.inputTokens,
        outputTokens: evalResult.outputTokens,
        costUsd: evalResult.costUsd,
        scenarioKey: scenario.key,
        metadata: {
          batchId,
          title: scenario.title,
          message: scenario.message,
          expectedIntent: scenario.expectedIntent || null,
          evalWarning: evalResult.warning || null,
        },
      });

      results.push({
        id: log.id,
        scenarioKey: scenario.key,
        title: scenario.title,
        pass,
        status,
        score: log.score,
        intent: classified.intent,
        reasons,
        reply: candidate,
      });
    }

    const failed = results.filter((r) => !r.pass);
    this.logger.log(`[BotQA] batch=${batchId} total=${results.length} failed=${failed.length}`);
    return {
      batchId,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };
  }

  private defaultCandidate(scenario: BotTestScenario, intent: string): string {
    const canned = this.classifier.cannedReply(intent as any, scenario.lastOutgoing || []);
    if (canned) return canned;
    if (/kdv|borc|tutar|durum|iban|tc kimlik/i.test(scenario.message)) {
      return 'Mesajiniz alindi; kayitlar incelendikten sonra size bilgi verilecek.';
    }
    return 'Mesajinizi aldik; ilgili kayda ekledik.';
  }

  private validateScenario(scenario: BotTestScenario, reply: string, intent: string, score: number): string[] {
    const reasons: string[] = [];
    if (scenario.expectedIntent && scenario.expectedIntent !== intent) {
      reasons.push(`EXPECTED_INTENT:${scenario.expectedIntent}:GOT:${intent}`);
    }
    for (const re of scenario.mustInclude || []) {
      if (!re.test(reply)) reasons.push(`MISSING_PATTERN:${re.source.slice(0, 60)}`);
    }
    for (const re of scenario.mustNotInclude || []) {
      if (re.test(reply)) reasons.push(`FORBIDDEN_PATTERN:${re.source.slice(0, 60)}`);
    }
    const sentenceCount = reply.match(/[^.!?]+[.!?]?/g)?.map((p) => p.trim()).filter(Boolean).length || 1;
    if (scenario.maxSentences && sentenceCount > scenario.maxSentences) {
      reasons.push(`MAX_SENTENCES:${scenario.maxSentences}:GOT:${sentenceCount}`);
    }
    if (scenario.maxChars && reply.length > scenario.maxChars) {
      reasons.push(`MAX_CHARS:${scenario.maxChars}:GOT:${reply.length}`);
    }
    if (scenario.expectLowScore && score >= 6) {
      reasons.push(`EXPECTED_LOW_SCORE:GOT:${score}`);
    }
    if (!scenario.expectLowScore && score < 6) {
      reasons.push(`UNEXPECTED_LOW_SCORE:${score}`);
    }
    return reasons;
  }

  private async ensureScratchTenant(preferredTenantId?: string) {
    if (preferredTenantId) {
      const taxpayer = await this.ensureScratchTaxpayer(preferredTenantId);
      return { tenantId: preferredTenantId, taxpayerId: taxpayer.id };
    }

    const tenant = await this.prisma.tenant.upsert({
      where: { slug: 'bot-qa-scratch' },
      update: {},
      create: {
        slug: 'bot-qa-scratch',
        name: 'Bot QA Scratch',
        email: 'bot-qa@moren.local',
      },
      select: { id: true },
    });
    const taxpayer = await this.ensureScratchTaxpayer(tenant.id);
    return { tenantId: tenant.id, taxpayerId: taxpayer.id };
  }

  private async ensureScratchTaxpayer(tenantId: string) {
    const taxNumber = `BOT-QA-${tenantId.slice(0, 8)}`;
    const existing = await this.prisma.taxpayer.findFirst({
      where: { tenantId, taxNumber },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.taxpayer.create({
      data: {
        tenantId,
        type: 'GERCEK_KISI',
        firstName: 'Bot',
        lastName: 'QA',
        companyName: 'Bot QA Test Mukellefi',
        taxNumber,
        taxOffice: 'TEST',
        phone: '905000000000',
        phones: ['905000000000'],
        emails: [],
        isActive: false,
      },
      select: { id: true },
    });
  }
}
