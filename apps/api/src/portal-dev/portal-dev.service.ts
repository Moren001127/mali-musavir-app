import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenRouterAdapter } from '../moren-ofis/providers/openrouter.adapter';

// FAZ 4 — Portal Geliştirme ekibi.
// 5 ajan persona — Moren Ofis ile karışmasın diye burada ayrı.
// Bu ekip kod yazmaz, sadece PR planı + diff önerisi üretir.

export type DevAgentId = 'eren' | 'melis' | 'seda' | 'okan' | 'berk';

interface DevPersona {
  id: DevAgentId;
  displayName: string;
  role: string;
  model: string;
  systemPrompt: string;
}

const DEV_PERSONAS: Record<DevAgentId, DevPersona> = {
  eren: {
    id: 'eren',
    displayName: 'EREN',
    role: 'Product Manager / Tech Lead',
    model: 'anthropic/claude-sonnet-4-6',
    systemPrompt: `Sen EREN, 34 yaşında bir PM/Tech Lead. Sakin, planlı, kapsamı keskin tutarsın.
Konuşma dili Türkçe. Yanıtlarını maddeli/kısa yaz.
Bir özellik isteği geldiğinde ŞU yapıya sok:
  1. Problem (1 cümle)
  2. Kapsam (yapacaklarımız)
  3. Kapsam dışı (yapmayacaklarımız)
  4. Kabul kriteri (3-5 madde)
  5. Risk seviyesi (low/medium/high) + sebebi
  6. Tahmin (saat)`,
  },
  melis: {
    id: 'melis',
    displayName: 'MELİS',
    role: 'UI/UX Designer',
    model: 'anthropic/claude-sonnet-4-6',
    systemPrompt: `Sen MELİS, 28 yaşında UI/UX tasarımcı. Detaycı, estetik, boutique altın paletini korursun.
Görev: gelen özellik için ekran/etkileşim tasarımı tarif et (kelimelerle, görsel üretme).
Mevcut tasarım sistemi: rounded-2xl, hairline gradient, Fraunces serif başlık, altın #d4b876 ana.
Ekleyeceğin/değiştireceğin bileşenleri net listele.`,
  },
  seda: {
    id: 'seda',
    displayName: 'SEDA',
    role: 'Senior Full-stack Developer (plan-only)',
    model: 'anthropic/claude-sonnet-4-6',
    systemPrompt: `Sen SEDA, 31 yaşında senior full-stack. Pragmatik, hızlı.
ÖNEMLİ: SEN KOD YAZMIYORSUN. Sadece PR PLANI üretirsin — başka biri (Verdent veya patron) uygular.
Stack: Next.js 14 (App Router), NestJS, Prisma, Postgres, TanStack Query, Tailwind.
Çıktın şu yapıda olmalı:
  ## Değişecek dosyalar
  - apps/web/...  (ne yapılacak — 1 satır)
  - apps/api/...  (ne yapılacak — 1 satır)
  ## Migration gerekli mi?
  Evet/Hayır + neden
  ## Diff taslağı
  Pseudokod veya kısa snippet (en fazla 30 satır toplam)
  ## Risk noktaları
  Maddeli, 2-3 nokta.
Asla "ben dosyayı yazdım" deme — sadece plan ver.`,
  },
  okan: {
    id: 'okan',
    displayName: 'OKAN',
    role: 'Code Reviewer',
    model: 'anthropic/claude-sonnet-4-6',
    systemPrompt: `Sen OKAN, 36 yaşında code reviewer. Şüpheci, güvenlik öncelikli.
Görev: SEDA'nın PR PLANINI incele. Hatalı yerleri, edge case'leri, güvenlik açıklarını yakala.
Çıktın şu yapıda:
  ## Onay durumu
  ✓ Plan sağlam / ⚠ Düzeltme gerek / ✕ Plan reddediliyor
  ## Bulgular
  - [HIGH/MED/LOW] Bulgu (1-2 cümle)
  ## Öneriler
  Maddeli, somut.`,
  },
  berk: {
    id: 'berk',
    displayName: 'BERK',
    role: 'DevOps / Release',
    model: 'anthropic/claude-haiku-4-5',
    systemPrompt: `Sen BERK, 29 yaşında DevOps. Sistematik, sakin.
Stack: Vercel (web), Railway (api+DB), Postgres. CI/CD: GitHub Actions yok, push'ta otomatik deploy.
Görev: planı deploy/operasyon açısından değerlendir.
Çıktı:
  ## Migration etkisi
  Var/Yok + dikkat
  ## Env değişikliği
  Var/Yok + neler
  ## Rollback planı
  1-2 cümle
  ## Dağıtım sırası
  Önce hangi servis, sonra hangi?`,
  },
};

@Injectable()
export class PortalDevService {
  private readonly logger = new Logger(PortalDevService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openrouter: OpenRouterAdapter,
  ) {}

  listAgents() {
    return Object.values(DEV_PERSONAS).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.role,
      model: p.model,
    }));
  }

  async listTasks(tenantId: string, status?: string) {
    return (this.prisma as any).portalDevTask.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async createTask(params: {
    tenantId: string;
    userId: string;
    title: string;
    description: string;
    priority?: string;
    type?: string;
    sourceProposalId?: string;
  }) {
    return (this.prisma as any).portalDevTask.create({
      data: {
        tenantId: params.tenantId,
        title: params.title,
        description: params.description,
        priority: params.priority || 'medium',
        type: params.type || 'feature',
        status: 'backlog',
        createdByUserId: params.userId,
        sourceProposalId: params.sourceProposalId,
      },
    });
  }

  /**
   * FAZ 6 — DENİZ proposal'ını Portal Dev görevine çevir.
   * MorenOfisProposal tablosundan tetiklenir, kullanıcı onayı ile.
   */
  async fromProposal(params: {
    tenantId: string;
    userId: string;
    proposalId: string;
  }) {
    const proposal = await (this.prisma as any).morenOfisProposal.findUnique({
      where: { id: params.proposalId },
    });
    if (!proposal || proposal.tenantId !== params.tenantId) {
      throw new NotFoundException('Proposal bulunamadı');
    }
    const task = await this.createTask({
      tenantId: params.tenantId,
      userId: params.userId,
      title: proposal.title,
      description: `Kaynak: DENİZ patrol\n\n${proposal.description}`,
      priority: proposal.priority === 'high' ? 'high' : proposal.priority === 'low' ? 'low' : 'medium',
      type: proposal.category === 'bug' ? 'bug' : proposal.category === 'perf' ? 'refactor' : 'feature',
      sourceProposalId: proposal.id,
    });
    // Proposal'ı in_progress yap
    await (this.prisma as any).morenOfisProposal.update({
      where: { id: proposal.id },
      data: { status: 'in_progress' },
    });
    return task;
  }

  async getTask(tenantId: string, id: string) {
    const t = await (this.prisma as any).portalDevTask.findUnique({ where: { id } });
    if (!t || t.tenantId !== tenantId) throw new NotFoundException();
    const messages = await (this.prisma as any).portalDevMessage.findMany({
      where: { taskId: id, tenantId },
      orderBy: { ts: 'asc' },
    });
    return { ...t, messages };
  }

  async updateTaskStatus(tenantId: string, id: string, status: string) {
    const valid = ['backlog', 'in_progress', 'in_review', 'done', 'cancelled'];
    if (!valid.includes(status)) throw new BadRequestException('Geçersiz durum');
    // Tenant izolasyonu: updateMany ile id+tenantId şartı tek atomic where'de
    const result = await (this.prisma as any).portalDevTask.updateMany({
      where: { id, tenantId },
      data: { status },
    });
    if (result.count === 0) throw new NotFoundException('Görev bulunamadı');
    return (this.prisma as any).portalDevTask.findUnique({ where: { id } });
  }

  /**
   * Ekibi sırayla çağır — EREN kapsamı keser, MELİS tasarım,
   * SEDA PR planı, OKAN inceler, BERK deploy notu. Çıktıyı task'a yaz.
   *
   * Maliyet kontrolü: her ajan max 800 token. Ardışık çağrı (~5 turn).
   */
  async runTeamPlanning(tenantId: string, userId: string, taskId: string) {
    const task = await (this.prisma as any).portalDevTask.findUnique({ where: { id: taskId } });
    if (!task || task.tenantId !== tenantId) throw new NotFoundException();

    const order: DevAgentId[] = ['eren', 'melis', 'seda', 'okan', 'berk'];
    const messages: { agent: DevAgentId; content: string }[] = [];

    let conversationContext = `Özellik isteği:\n## ${task.title}\n\n${task.description}\n`;

    for (const id of order) {
      const persona = DEV_PERSONAS[id];
      try {
        const res = await this.openrouter.chat({
          model: persona.model,
          messages: [
            { role: 'system', content: persona.systemPrompt },
            {
              role: 'user',
              content: `${conversationContext}\n\nGörevin için cevabını yaz.${
                messages.length > 0
                  ? `\n\nDiğer ekip üyelerinin yorumları:\n${messages.map((m) => `[${m.agent.toUpperCase()}] ${m.content}`).join('\n---\n')}`
                  : ''
              }`,
            },
          ],
          temperature: 0.3,
          maxTokens: 800,
        });
        messages.push({ agent: id, content: res.content });

        // DB'ye kaydet
        await (this.prisma as any).portalDevMessage.create({
          data: {
            tenantId,
            taskId,
            agent: id,
            content: res.content,
          },
        });
      } catch (e: any) {
        this.logger.error(`Portal Dev ${id} hata: ${e?.message}`);
        await (this.prisma as any).portalDevMessage.create({
          data: {
            tenantId,
            taskId,
            agent: id,
            content: `[Sistem hatası: ${e?.message}]`,
          },
        });
      }
    }

    // SEDA çıktısından proposedFiles/proposedDiff çıkar
    const sedaMsg = messages.find((m) => m.agent === 'seda');
    if (sedaMsg) {
      const files = this.extractProposedFiles(sedaMsg.content);
      await (this.prisma as any).portalDevTask.update({
        where: { id: taskId },
        data: {
          proposedFiles: files,
          proposedDiff: sedaMsg.content,
          status: 'in_review',
        },
      });
    }

    return this.getTask(tenantId, taskId);
  }

  /**
   * SEDA'nın markdown çıktısından dosya path'lerini çıkar.
   * `## Değişecek dosyalar` bölümünün altındaki bullet'ları yakalar.
   */
  private extractProposedFiles(content: string): string[] {
    const lines = content.split('\n');
    const files: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (/##\s*De.*dosya|##\s*Files|##\s*Changed/i.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection && /^##\s/.test(line)) break;
      if (inSection) {
        const m = line.match(/^[-*]\s+(?:`)?([a-zA-Z0-9_./()-]+\.[a-zA-Z]+)/);
        if (m) files.push(m[1]);
      }
    }
    return files.slice(0, 30);
  }
}
