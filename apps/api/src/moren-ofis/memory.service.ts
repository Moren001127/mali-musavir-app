import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenRouterAdapter } from './providers/openrouter.adapter';

/**
 * Moren Ofis Hafıza Servisi
 *
 * 3 katmanlı hafıza:
 *   1. Konuşma içi — MorenOfisConversation.messages (zaten var)
 *   2. Konuşma özeti — Conversation.summary (sohbet bitince ARDA üretir)
 *   3. Kalıcı gerçekler — MorenOfisFact (subject-predicate-object)
 *
 * Akış:
 *   - Yeni sorgu gelince: loadContext() → ilgili özetler + gerçekler context'e
 *   - Sohbet bitince: extractAndStore() → ARDA özet + gerçek çıkartır → DB'ye
 */
@Injectable()
export class MorenOfisMemoryService {
  private readonly logger = new Logger(MorenOfisMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openrouter: OpenRouterAdapter,
  ) {}

  /**
   * Yeni bir kullanıcı sorusu geldiğinde — ilgili geçmiş bilgileri yükle.
   * Returned string ajan system prompt'una eklenir.
   */
  async loadContext(tenantId: string, query: string): Promise<string> {
    // 1) Sorudaki muhtemel "entity"leri çıkar (basit keyword: büyük harfli kelimeler + bilinen mükellef adları)
    const entityCandidates = this.extractEntities(query);

    // 2) Son 5 konuşma özetini al (genel veya entity'li)
    const recentSummaries = await (this.prisma as any).morenOfisConversation.findMany({
      where: {
        tenantId,
        summary: { not: null },
        OR: entityCandidates.length > 0
          ? [
              { entities: { hasSome: entityCandidates } },
              // Genel sohbetler de — son 3'ünü al
            ]
          : undefined,
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 5,
      select: { summary: true, lastActivityAt: true, entities: true },
    });

    // 3) Gerçekleri yükle — entity'lerle ilgili + ofis geneli
    const subjects = ['ofis', 'patron', 'Muzaffer', 'Muzaffer Bey', ...entityCandidates];
    const facts = await (this.prisma as any).morenOfisFact.findMany({
      where: {
        tenantId,
        OR: [
          { subject: { in: subjects } },
          // Yüksek önemli olanları her zaman yükle
          { importance: { gte: 8 } },
        ],
      },
      orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
      take: 20,
    });

    // 4) Access count'u artır (yüklenenler için)
    if (facts.length > 0) {
      const ids = facts.map((f: any) => f.id);
      await (this.prisma as any).morenOfisFact.updateMany({
        where: { id: { in: ids } },
        data: {
          accessCount: { increment: 1 },
          lastAccessedAt: new Date(),
        },
      }).catch(() => {});
    }

    // 5) Context metnine dönüştür
    const parts: string[] = [];
    if (recentSummaries.length > 0) {
      parts.push('## GEÇMİŞ KONUŞMALAR (son 5)');
      for (const s of recentSummaries) {
        const tarih = new Date(s.lastActivityAt).toLocaleDateString('tr-TR');
        parts.push(`- [${tarih}] ${s.summary}${s.entities?.length ? ` (${s.entities.join(', ')})` : ''}`);
      }
    }
    if (facts.length > 0) {
      parts.push('\n## HATIRLAMAN GEREKEN GERÇEKLER');
      for (const f of facts) {
        parts.push(`- ${f.subject} → ${f.predicate}: ${f.object}`);
      }
    }
    if (parts.length === 0) {
      return ''; // Hafıza yok, bu ilk konuşma
    }
    return ['---', '## OFİS HAFIZASI (geçmişten hatırlayacakların)', ...parts, '---'].join('\n');
  }

  /**
   * Sohbet bitti — ARDA özet üretir, gerçekler çıkarır, kaydeder.
   * Asenkron çağrı, response'a kullanıcı beklemez.
   */
  async extractAndStore(params: {
    conversationId: string;
    tenantId: string;
    messagesText: string; // Tüm konuşma flat text
  }) {
    try {
      const prompt = `Sen ARDA'sın — Moren Ofis'in baş müşaviri. Aşağıdaki ekip içi sohbeti analiz et:

${params.messagesText}

İki şey üret:

1. **ÖZET** (1-2 cümle): Bu sohbette ne konuşuldu, ne karar verildi.

2. **GERÇEKLER** (0-5 madde): Gelecekte hatırlanması faydalı olan kalıcı bilgiler.
   Her gerçek subject-predicate-object formatında:
   - subject: Kim/ne hakkında (mükellef adı, "ofis", "Muzaffer Bey", "PETRAVET", vb.)
   - predicate: Ne tür bilgi (tercih_eder, son_donem_matrah, calisan_sayisi, sorun_yasiyor, vb.)
   - object: Değer (kısa, net)
   - importance: 1-10 (kritik=10, sıradan=3)

Sadece JSON döndür, başka açıklama ekleme:
{
  "summary": "...",
  "entities": ["entity1", "entity2"],
  "facts": [
    {"subject": "...", "predicate": "...", "object": "...", "importance": 5}
  ]
}`;

      const res = await this.openrouter.chat({
        model: 'google/gemini-2.5-flash', // Ucuz, hızlı, summarization iyi
        messages: [
          { role: 'system', content: 'Sen disiplinli bir mali müşavirsin. Sadece JSON yanıt verirsin, doğru formatta.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        maxTokens: 800,
      });

      // JSON parse — bazen modeller ```json wrap ile döner
      let cleaned = res.content.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      const summary = String(parsed.summary || '').trim();
      const entities: string[] = Array.isArray(parsed.entities) ? parsed.entities.slice(0, 10) : [];
      const facts = Array.isArray(parsed.facts) ? parsed.facts : [];

      // 1) Conversation'a özet + entities yaz
      if (summary) {
        await (this.prisma as any).morenOfisConversation.update({
          where: { id: params.conversationId },
          data: { summary, entities },
        });
      }

      // 2) Gerçekleri upsert
      for (const f of facts) {
        const subject = String(f.subject || '').trim().slice(0, 100);
        const predicate = String(f.predicate || '').trim().slice(0, 80);
        const object = String(f.object || '').trim().slice(0, 500);
        const importance = Math.max(1, Math.min(10, Number(f.importance) || 5));
        if (!subject || !predicate || !object) continue;

        await (this.prisma as any).morenOfisFact.upsert({
          where: {
            tenantId_subject_predicate: { tenantId: params.tenantId, subject, predicate },
          },
          update: { object, importance, updatedAt: new Date() },
          create: {
            tenantId: params.tenantId,
            createdByAgent: 'arda',
            subject,
            predicate,
            object,
            importance,
            sourceConvId: params.conversationId,
          },
        }).catch((e: any) => {
          this.logger.warn(`Fact upsert hatası: ${e?.message}`);
        });
      }

      this.logger.log(`Sohbet ${params.conversationId.slice(0,8)} hafızaya kaydedildi: ${facts.length} gerçek, ${entities.length} entity`);
    } catch (err: any) {
      this.logger.error(`Hafıza kayıt hatası: ${err?.message}`);
      // Sessizce geç — sohbeti kesmez
    }
  }

  /**
   * Basit entity çıkarımı: 2+ büyük harfli ardışık kelimeler (mükellef adı muhtemeli)
   * + bilinen anahtar kelimeler.
   */
  private extractEntities(query: string): string[] {
    const entities: string[] = [];
    // Tüm büyük harfli kelime grupları (mükellef adı)
    const upperRegex = /\b[A-ZĞÜŞİÖÇ][A-ZĞÜŞİÖÇa-zğüşıöç]+(?:\s+[A-ZĞÜŞİÖÇ][A-ZĞÜŞİÖÇa-zğüşıöç]+){0,3}\b/g;
    const matches = query.match(upperRegex) || [];
    for (const m of matches) {
      if (m.length > 3 && !['Ne', 'Nasıl', 'Niye', 'Neden', 'Hangi', 'Kaç'].includes(m)) {
        entities.push(m);
      }
    }
    // Kelime başı/sonu temizliği
    return Array.from(new Set(entities)).slice(0, 5);
  }

  /**
   * Manuel gerçek ekle/güncelle — UI'dan veya admin endpoint'inden.
   */
  async upsertFact(params: {
    tenantId: string;
    subject: string;
    predicate: string;
    object: string;
    importance?: number;
  }) {
    return (this.prisma as any).morenOfisFact.upsert({
      where: {
        tenantId_subject_predicate: {
          tenantId: params.tenantId,
          subject: params.subject,
          predicate: params.predicate,
        },
      },
      update: { object: params.object, importance: params.importance ?? 5, updatedAt: new Date() },
      create: {
        tenantId: params.tenantId,
        subject: params.subject,
        predicate: params.predicate,
        object: params.object,
        importance: params.importance ?? 5,
      },
    });
  }

  async listFacts(tenantId: string, opts: { subject?: string; limit?: number } = {}) {
    return (this.prisma as any).morenOfisFact.findMany({
      where: {
        tenantId,
        ...(opts.subject ? { subject: { contains: opts.subject, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
      take: Math.min(opts.limit || 50, 200),
    });
  }

  async deleteFact(tenantId: string, id: string) {
    return (this.prisma as any).morenOfisFact.deleteMany({
      where: { id, tenantId },
    });
  }
}
