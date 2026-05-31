import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AI Maliyet özeti — TEK yerde, GERÇEK veriyle.
 *
 * Her AI/Claude/OpenAI çağrısı `logAiUsage` ile AiUsageLog tablosuna gerçek
 * USD maliyetiyle + `source` (modül) etiketiyle yazılıyor. Bu servis o tabloyu
 * `source` bazında DİNAMİK toplar — yani yeni bir modül eklenip logAiUsage
 * kullandığı an burada otomatik görünür; hiçbir liste elle güncellenmez.
 */

// Ham source etiketlerini kullanıcı-dostu modül adlarına grupla.
// Eşleşmeyen yeni bir source gelirse "Diğer" altında ham adıyla yine görünür.
const SOURCE_LABELS: Record<string, string> = {
  'mihsap-fatura': 'Fatura İşleme',
  'mihsap-fatura-cache': 'Fatura İşleme',
  'mihsap-isletme': 'Fatura İşleme',
  'kdv-ocr': 'KDV Kontrol (OCR)',
  'kdv-content-audit': 'KDV Kontrol (OCR)',
  'moren-ai': 'Moren AI (Sohbet)',
  'moren-ai-auto-learn': 'Moren AI (Sohbet)',
  'brifing': 'Günlük Brifing',
  'calendar': 'Takvim AI',
  'moren-ai-realtime': 'Sesli Asistan',
  'whatsapp-bot-eval': 'WhatsApp Bot',
  'whatsapp-auto-memory': 'WhatsApp Bot',
  'whatsapp-portal': 'WhatsApp Bot',
  'whatsapp-meta': 'WhatsApp Bot',
  'whatsapp-bot': 'WhatsApp Bot',
  'whatsapp-owner': 'WhatsApp (Yönetici)',
  'fis-yazdirma': 'Fiş Yazdırma',
  'earsiv': 'e-Arşiv',
  'earsivFatura': 'e-Arşiv',
  'portal-automation': 'Portal Otomasyon',
  'portal-automation-pdf-parse': 'Portal Otomasyon',
  'ebeyanname-beyanname-ara': 'Portal Otomasyon',
  'moren_ofis': 'Moren Ofis Ajanı',
  'moren_ofis_patrol': 'Moren Ofis Ajanı',
  'manual_patrol': 'Moren Ofis Ajanı',
  'owner_approval_request': 'Onay İstekleri',
};

function labelFor(source: string): string {
  return SOURCE_LABELS[source] || `Diğer (${source})`;
}

type ModuleCost = {
  module: string;
  sources: string[];
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
};

@Injectable()
export class AiCostService {
  constructor(private readonly prisma: PrismaService) {}

  /** "YYYY-MM" → o ayın [başı, sonraki ayın başı) aralığı. Geçersizse içinde bulunulan ay. */
  private monthRange(month?: string): { start: Date; end: Date; label: string } {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth(); // 0-index
    const match = /^(\d{4})-(\d{2})$/.exec(month || '');
    if (match) {
      y = Number(match[1]);
      m = Number(match[2]) - 1;
    }
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 1));
    const label = `${String(m + 1).padStart(2, '0')}.${y}`;
    return { start, end, label };
  }

  private async sumByModule(tenantId: string, start: Date, end: Date): Promise<{ modules: ModuleCost[]; total: number; calls: number }> {
    const rows = await this.prisma.aiUsageLog.groupBy({
      by: ['source'],
      where: { tenantId, createdAt: { gte: start, lt: end } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: { _all: true },
    }).catch(() => [] as any[]);

    const byModule = new Map<string, ModuleCost>();
    let total = 0;
    let calls = 0;

    for (const r of rows as any[]) {
      const source = r.source || 'bilinmeyen';
      const module = labelFor(source);
      const cost = Number(r._sum?.costUsd || 0);
      const count = Number(r._count?._all || 0);
      total += cost;
      calls += count;
      const existing = byModule.get(module) || {
        module, sources: [], costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0,
      };
      existing.costUsd += cost;
      existing.calls += count;
      existing.inputTokens += Number(r._sum?.inputTokens || 0);
      existing.outputTokens += Number(r._sum?.outputTokens || 0);
      if (!existing.sources.includes(source)) existing.sources.push(source);
      byModule.set(module, existing);
    }

    const modules = Array.from(byModule.values())
      .map((m) => ({ ...m, costUsd: Number(m.costUsd.toFixed(4)) }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return { modules, total: Number(total.toFixed(4)), calls };
  }

  /** Bu ay (veya verilen ay) modül bazında gerçek maliyet + önceki ay toplamı (kıyas için). */
  async summary(tenantId: string, month?: string) {
    const cur = this.monthRange(month);
    const prevRef = new Date(cur.start);
    prevRef.setUTCMonth(prevRef.getUTCMonth() - 1);
    const prev = this.monthRange(`${prevRef.getUTCFullYear()}-${String(prevRef.getUTCMonth() + 1).padStart(2, '0')}`);

    const [current, previous] = await Promise.all([
      this.sumByModule(tenantId, cur.start, cur.end),
      this.sumByModule(tenantId, prev.start, prev.end),
    ]);

    return {
      month: cur.label,
      totalUsd: current.total,
      totalCalls: current.calls,
      previousMonth: prev.label,
      previousTotalUsd: previous.total,
      modules: current.modules,
    };
  }
}
