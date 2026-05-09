import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { logAiUsage } from '../common/ai-usage-logger';
import { profileToPromptText } from '../common/profile-prompt';
import { VendorMemoryService } from '../vendor-memory/vendor-memory.service';
import { PendingDecisionsService } from '../pending-decisions/pending-decisions.service';

export interface AgentEventInput {
  agent: string;
  action?: string;
  status: string;
  message?: string;
  mukellef?: string;
  firma?: string;
  fisNo?: string;
  tutar?: number;
  hesapKodu?: string;
  kdv?: string;
  meta?: any;
  ts?: string | Date;
}

@Injectable()
export class AgentEventsService {
  private readonly faturaDecisionCache = new Map<string, { expiresAt: number; value: any }>();

  constructor(
    private prisma: PrismaService,
    private vendorMemory: VendorMemoryService,
    private pendingDecisions: PendingDecisionsService,
  ) {}

  async createEvent(tenantId: string, input: AgentEventInput) {
    // Status normalizasyonu — ajan tarafı eski sürümlerde 'ok'/'skip'/'error' gönderiyordu.
    // DB şeması ve UI filter 'onaylandi'/'atlandi'/'hata' değerlerini bekliyor.
    // Hem eski hem yeni ajanlardan gelen kayıtlar aynı kanonik değere map edilsin ki
    // "Yapılan İşlemler" sayfasındaki filtreler ve sayaçlar doğru çalışsın.
    const STATUS_MAP: Record<string, string> = {
      ok: 'onaylandi',
      onay: 'onaylandi',
      onaylandi: 'onaylandi',
      basarili: 'basarili',
      skip: 'atlandi',
      atla: 'atlandi',
      atlandi: 'atlandi',
      error: 'hata',
      hata: 'hata',
      info: 'bilgi',
      bilgi: 'bilgi',
    };
    const rawStatus = String(input.status || '').toLowerCase();
    const normalizedStatus = STATUS_MAP[rawStatus] || input.status;

    // tutar boş string veya NaN gelirse null yap
    let normalizedTutar: number | null = null;
    if (input.tutar != null && input.tutar !== ('' as any)) {
      const n = Number(input.tutar);
      if (Number.isFinite(n)) normalizedTutar = n;
    }

    const event = await this.prisma.agentEvent.create({
      data: {
        tenantId,
        agent: input.agent,
        action: input.action,
        status: normalizedStatus,
        message: input.message,
        mukellef: input.mukellef,
        firma: input.firma,
        fisNo: input.fisNo,
        tutar: normalizedTutar,
        hesapKodu: input.hesapKodu,
        kdv: input.kdv,
        meta: input.meta ?? undefined,
        ts: input.ts ? new Date(input.ts) : new Date(),
      },
    });
    if (input.agent === 'mihsap' && normalizedStatus === 'onaylandi') {
      await this.recordFaturaMemoryAfterSuccessfulSave(tenantId, input).catch(() => {});
    }
    return event;
  }

  private async recordFaturaMemoryAfterSuccessfulSave(tenantId: string, input: AgentEventInput) {
    const meta = input.meta || {};
    const candidate = meta.faturaDecisionCandidate || meta.memoryCandidate || null;
    const kararTipi = candidate?.kararTipi || meta.kararTipi || 'fatura';
    if (kararTipi !== 'fatura') return;

    const firmaKimlikNo = meta.firmaKimlikNo || candidate?.firmaKimlikNo || null;
    const firmaUnvan = input.firma || meta.firma || candidate?.firmaUnvan || null;
    const kategori =
      candidate?.hesapKodu ||
      candidate?.kategori ||
      meta.finalHesapKodu ||
      input.hesapKodu ||
      null;
    if (!firmaKimlikNo || !kategori) return;

    await this.vendorMemory.recordDecision({
      tenantId,
      firmaKimlikNo,
      firmaUnvan,
      kararTipi: 'fatura',
      kategori,
      altKategori: null,
      taxpayerId: meta.mukellefId || candidate?.taxpayerId || null,
    });
  }

  async listEvents(
    tenantId: string,
    opts: { agent?: string; mukellef?: string; status?: string; limit?: number; since?: string } = {},
  ) {
    const { agent, mukellef, status, limit = 200, since } = opts;
    const where: any = { tenantId };
    if (agent) where.agent = agent;
    if (mukellef) where.mukellef = { contains: mukellef, mode: 'insensitive' };
    if (status) {
      // Eski ajan kayıtlarıyla uyum için status alternatiflerini de kapsa
      const STATUS_ALIAS: Record<string, string[]> = {
        onaylandi: ['onaylandi', 'ok', 'basarili'],
        atlandi: ['atlandi', 'skip'],
        hata: ['hata', 'error'],
        basarili: ['basarili', 'onaylandi', 'ok'],
        bilgi: ['bilgi', 'info'],
      };
      const aliases = STATUS_ALIAS[status.toLowerCase()];
      if (aliases && aliases.length > 1) where.status = { in: aliases };
      else where.status = status;
    }
    if (since) where.ts = { gte: new Date(since) };
    return this.prisma.agentEvent.findMany({
      where,
      orderBy: { ts: 'desc' },
      take: Math.min(limit, 1000),
    });
  }

  async stats(tenantId: string) {
    const now = new Date();
    const bugun = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ayBas = new Date(now.getFullYear(), now.getMonth(), 1);

    const [toplam, buGun, buAy, hata] = await Promise.all([
      this.prisma.agentEvent.count({ where: { tenantId } }),
      this.prisma.agentEvent.count({ where: { tenantId, ts: { gte: bugun } } }),
      // Eski ajan 'ok' gönderdiği için 'onaylandi' ve 'ok' ikisi de onay sayılsın
      this.prisma.agentEvent.count({
        where: { tenantId, status: { in: ['onaylandi', 'basarili', 'ok'] }, ts: { gte: ayBas } },
      }),
      this.prisma.agentEvent.count({
        where: { tenantId, status: { in: ['hata', 'error'] }, ts: { gte: bugun } },
      }),
    ]);

    const perMukellef = await this.prisma.agentEvent.groupBy({
      by: ['mukellef', 'status'],
      where: { tenantId, mukellef: { not: null } },
      _count: { _all: true },
    });

    return { toplam, buGun, buAy, hataBugun: hata, perMukellef };
  }

  /**
   * Mükellef başına ayın özet raporu — portal üzerinden kaç alış/satış faturası işlendi.
   * Sadece başarılı veya atlanan olaylar sayılır (hata olanlar işlenmiş sayılmaz).
   * Manuel işlenen faturalar bu özetin dışında kalır — kullanıcı hangi mükellefi kaçar
   * kere sistem üzerinden geçirdiğini görür.
   */
  async eventSummaryByMukellef(
    tenantId: string,
    agent: string,
    year: number,
    month: number,
  ) {
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    // İşlem başarılı/atlandı sayılır; 'hata' olanlar dahil edilmez.
    const SUCCESS_STATUSES = ['ok', 'onaylandi', 'basarili', 'skip', 'atlandi'];
    const ALIS_ACTIONS = ['isle_alis', 'isle_alis_isletme'];
    const SATIS_ACTIONS = ['isle_satis', 'isle_satis_isletme'];

    // v1.36.39: Geniş ts penceresi → meta.donem ile filtre.
    // Eski mantık ts (log yazıldığı an) bazlıydı; nisan faturalarını mayısın 2'sinde
    // işlersek nisan istatistiğinde gözükmüyordu. Artık agent her log'a meta.donem
    // (komutun ay'i, ör. "2026-04") yazıyor, biz onu kullanıyoruz.
    // donem yoksa (eski kayıtlar) ts'e fallback.
    const donemStr = `${year}-${String(month).padStart(2, '0')}`;
    const wideStart = new Date(year, month - 3, 1);
    const wideEnd = new Date(year, month + 2, 1);

    const allRows = await this.prisma.agentEvent.findMany({
      where: {
        tenantId,
        agent,
        status: { in: SUCCESS_STATUSES },
        ts: { gte: wideStart, lt: wideEnd },
        mukellef: { not: null },
      },
      select: { mukellef: true, action: true, status: true, ts: true, meta: true },
    });

    const rows = allRows.filter((r) => {
      const m = (r.meta as any) || {};
      if (typeof m.donem === 'string' && m.donem.length > 0) {
        return m.donem === donemStr;
      }
      // Fallback: meta.donem yoksa (eski kayıt) → ts ile orijinal pencereye düş.
      return r.ts >= periodStart && r.ts < periodEnd;
    });

    // Mükellef → { alis, satis, atlanan }
    const map = new Map<string, { alis: number; satis: number; atlanan: number }>();
    for (const row of rows) {
      if (!row.mukellef) continue;
      const entry = map.get(row.mukellef) || { alis: 0, satis: 0, atlanan: 0 };
      const isAlis = !!row.action && ALIS_ACTIONS.includes(row.action);
      const isSatis = !!row.action && SATIS_ACTIONS.includes(row.action);
      const isSkip = row.status === 'skip' || row.status === 'atlandi';
      if (isAlis) entry.alis++;
      else if (isSatis) entry.satis++;
      if (isSkip) entry.atlanan++;
      map.set(row.mukellef, entry);
    }

    // AI maliyeti — bu ay her mukellef için harcanan USD (Claude/Anthropic + OCR)
    // ai-usage-logger'dan dönemdeki tüm kayıtları al; mukellef dolu olanları
    // mukellefe yaz, boş olanları (eski extension kayıtları) "diger" toplamına ekle.
    const { perMukellef: maliyetMap, digerUsd, toplamAiUsd, toplamCagri, anomalousUsd } =
      await this.aiMaliyetByMukellef(tenantId, periodStart, periodEnd);

    const items = Array.from(map.entries())
      .map(([mukellef, counts]) => {
        const toplamIslem = counts.alis + counts.satis + counts.atlanan;
        const maliyet = maliyetMap.get(mukellef)?.usd || 0;
        return {
          mukellef,
          alis: counts.alis,
          satis: counts.satis,
          atlanan: counts.atlanan,
          toplam: counts.alis + counts.satis,
          maliyetUsd: Number(maliyet.toFixed(4)),
          aiCagriSayisi: maliyetMap.get(mukellef)?.count || 0,
          birimMaliyetUsd: toplamIslem > 0 ? Number((maliyet / toplamIslem).toFixed(6)) : 0,
        };
      })
      .sort((a, b) => b.toplam - a.toplam);

    const toplam = items.reduce<{
      alis: number;
      satis: number;
      toplam: number;
      mukellefSayisi: number;
      maliyetUsd: number;
      birimMaliyetUsd: number;
    }>(
      (acc, i) => ({
        alis: acc.alis + i.alis,
        satis: acc.satis + i.satis,
        toplam: acc.toplam + i.toplam,
        mukellefSayisi: acc.mukellefSayisi + 1,
        maliyetUsd: acc.maliyetUsd + i.maliyetUsd,
        birimMaliyetUsd: acc.birimMaliyetUsd,
      }),
      { alis: 0, satis: 0, toplam: 0, mukellefSayisi: 0, maliyetUsd: 0, birimMaliyetUsd: 0 },
    );
    // Toplam maliyete mukellef-bağsız harcamayı da ekle (Toplam Maliyet kpi için).
    // Eski extension kayıtları mukellef field'ı yok — yine de ödendiği gerçek.
    toplam.maliyetUsd = Number((toplamAiUsd || (toplam.maliyetUsd + digerUsd)).toFixed(4));
    const toplamIslem = items.reduce((acc, i) => acc + i.alis + i.satis + i.atlanan, 0);
    toplam.birimMaliyetUsd = toplamIslem > 0 ? Number((toplam.maliyetUsd / toplamIslem).toFixed(6)) : 0;

    return {
      period: { year, month },
      toplam,
      items,
      maliyet: {
        toplamAiUsd: Number((toplamAiUsd || 0).toFixed(4)),
        mukellefBagliUsd: Number((toplam.maliyetUsd - digerUsd).toFixed(4)),
        digerUsd: Number((digerUsd || 0).toFixed(4)),
        anomalousUsd: Number((anomalousUsd || 0).toFixed(4)),
        toplamCagri,
        toplamIslem,
        birimMaliyetUsd: toplam.birimMaliyetUsd,
      },
    };
  }

  /**
   * Diagnostic — son 30 AiUsageLog kaydı + özet sayaçlar.
   * Maliyet $0 sorununun kök nedenini görmek için.
   * try/catch ile hata mesajını geri döndürür (NestJS'in 500 yutmasını engellemek için).
   */
  async aiUsageDiag(tenantId: string) {
    try {
      const rows = await this.prisma.aiUsageLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const sayilari = {
        toplam: rows.length,
        mukellefDolu: rows.filter((r) => !!r.mukellef && (r.mukellef as string).trim().length > 0).length,
        mukellefBos: rows.filter((r) => !r.mukellef || (r.mukellef as string).trim().length === 0).length,
        costUsdDolu: rows.filter((r) => Number(r.costUsd || 0) > 0).length,
        costUsdSifir: rows.filter((r) => !r.costUsd || Number(r.costUsd) === 0).length,
        kayitYok: rows.length === 0,
        tenantId,
      };
      const toplamUsd = rows.reduce((acc, r) => acc + Number(r.costUsd || 0), 0);
      return {
        ok: true,
        sayilari,
        toplamUsd: Number(toplamUsd.toFixed(6)),
        sonKayitlar: rows.map((r) => ({
          createdAt: r.createdAt,
          source: r.source,
          mukellef: r.mukellef,
          model: r.model,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: r.costUsd,
          karar: r.karar,
          sebep: (r.sebep || '').slice(0, 80),
          belgeNo: r.belgeNo,
        })),
      };
    } catch (e: any) {
      return {
        ok: false,
        error: e?.message || String(e),
        stack: (e?.stack || '').split('\n').slice(0, 5).join('\n'),
        tenantId,
      };
    }
  }

  /**
   * Bu ayda AI USD harcamasını çıkarır:
   *  - perMukellef: mukellef adı dolu olan kayıtlar gruplanır
   *  - digerUsd: mukellef field NULL/boş olan kayıtların toplamı (eski extension)
   *  - toplamAiUsd: dönemdeki TÜM AI USD (Toplam Maliyet kpi için)
   */
  private async aiMaliyetByMukellef(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ perMukellef: Map<string, { usd: number; count: number }>; digerUsd: number; toplamAiUsd: number; toplamCagri: number; anomalousUsd: number }> {
    const perMukellef = new Map<string, { usd: number; count: number }>();
    let digerUsd = 0;
    let toplamAiUsd = 0;
    let toplamCagri = 0;
    let anomalousUsd = 0;
    try {
      const rows = await this.prisma.aiUsageLog.findMany({
        where: {
          tenantId,
          createdAt: { gte: periodStart, lt: periodEnd },
          source: { in: ['mihsap-fatura', 'mihsap-fatura-cache'] },
        },
        select: { costUsd: true, mukellef: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      });
      for (const r of rows) {
        const cost = Number(r.costUsd || 0);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        // Bir fatura karar çağrısının 25 cent üstüne çıkması pratikte anomali.
        // Bu koruma yanlış/mükerrer usage kayıtlarının mükellef tablosunu şişirmesini engeller.
        if (cost > 0.25) {
          anomalousUsd += cost;
          continue;
        }
        toplamAiUsd += cost;
        toplamCagri++;
        const muk = (r.mukellef || '').trim();
        if (muk) {
          const prev = perMukellef.get(muk) || { usd: 0, count: 0 };
          perMukellef.set(muk, { usd: prev.usd + cost, count: prev.count + 1 });
        } else {
          digerUsd += cost;
        }
      }
    } catch (e) {
      console.warn('[summary-by-mukellef] aiMaliyetByMukellef hatası:', e);
    }
    return { perMukellef, digerUsd, toplamAiUsd, toplamCagri, anomalousUsd };
  }

  async upsertStatus(tenantId: string, agent: string, data: { running?: boolean; hedefAy?: string; meta?: any }) {
    return this.prisma.agentStatus.upsert({
      where: { tenantId_agent: { tenantId, agent } },
      update: { ...data, lastPing: new Date() },
      create: { tenantId, agent, ...data },
    });
  }

  // === PAUSE/RESUME (control state) ===
  // Portaldan set edilir, agent her iterasyonda okur, RUNNING/PAUSED/STOP'a göre davranır.
  async setControlState(
    tenantId: string,
    agent: string,
    state: 'RUNNING' | 'PAUSED' | 'STOP',
    setBy: string,
  ) {
    return (this.prisma as any).agentStatus.upsert({
      where: { tenantId_agent: { tenantId, agent } },
      update: {
        controlState: state,
        controlSetBy: setBy,
        controlSetAt: new Date(),
      },
      create: {
        tenantId,
        agent,
        controlState: state,
        controlSetBy: setBy,
        controlSetAt: new Date(),
      },
    });
  }

  async getControlState(tenantId: string, agent: string) {
    const s = await (this.prisma as any).agentStatus.findUnique({
      where: { tenantId_agent: { tenantId, agent } },
      select: { controlState: true, controlSetBy: true, controlSetAt: true, running: true, lastPing: true },
    });
    return s || { controlState: 'RUNNING', running: false, lastPing: null };
  }

  async listStatus(tenantId: string) {
    return this.prisma.agentStatus.findMany({ where: { tenantId } });
  }

  // Rules
  async listRules(tenantId: string) {
    return this.prisma.agentRule.findMany({ where: { tenantId }, orderBy: { mukellef: 'asc' } });
  }

  async getRule(tenantId: string, mukellef: string) {
    return this.prisma.agentRule.findUnique({ where: { tenantId_mukellef: { tenantId, mukellef } } });
  }

  async upsertRule(tenantId: string, mukellef: string, data: { faaliyet?: string; defterTuru?: string; profile: any }) {
    return this.prisma.agentRule.upsert({
      where: { tenantId_mukellef: { tenantId, mukellef } },
      update: data,
      create: { tenantId, mukellef, ...data },
    });
  }

  async deleteRule(tenantId: string, mukellef: string) {
    return this.prisma.agentRule.delete({ where: { tenantId_mukellef: { tenantId, mukellef } } });
  }

  // Komut kuyruğu
  async createCommand(
    tenantId: string,
    data: { agent: string; action: string; payload: any; createdBy?: string },
  ) {
    return this.prisma.agentCommand.create({
      data: { tenantId, agent: data.agent, action: data.action, payload: data.payload, createdBy: data.createdBy },
    });
  }

  async listCommands(tenantId: string, opts: { agent?: string; status?: string; limit?: number } = {}) {
    // Stale watchdog: 30dk ustu running komutlari failed yap (Mihsap tab kapandiysa)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    await this.prisma.agentCommand.updateMany({
      where: { tenantId, status: 'running', startedAt: { lt: thirtyMinAgo } },
      data: { status: 'failed', result: { message: 'Zaman asimi (30dk) - agent yanit vermedi', stale: true } as any, finishedAt: new Date() } as any,
    });
    const { agent, status, limit = 50 } = opts;
    const where: any = { tenantId };
    if (agent) where.agent = agent;
    if (status) where.status = status;
    return this.prisma.agentCommand.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  /** Tek komutu getir - agent her iterasyonda cancel kontrolu icin */
  async getCommand(tenantId: string, id: string) {
    return this.prisma.agentCommand.findFirst({ where: { id, tenantId } });
  }

  /** Komutu iptal et - agent cancel'i gorup duracak */
  async cancelCommand(tenantId: string, id: string) {
    const cmd = await this.prisma.agentCommand.findFirst({ where: { id, tenantId } });
    if (!cmd) return null;
    if (['done', 'failed', 'cancelled'].includes(cmd.status)) return cmd;
    return this.prisma.agentCommand.update({
      where: { id },
      data: {
        status: 'cancelled',
        result: { ...(cmd.result as any || {}), message: 'Kullanici iptal etti' } as any,
        finishedAt: new Date(),
      } as any,
    });
  }

    /** Yerel runner için bekleyen komutları claim eder (status=running yapar)
     * v1.36.61: Device-aware filter — backward-compatible.
     * - Komut payload.targetDeviceId yok ise → herkes alabilir (eski davranış, etki yok)
     * - Komut payload.targetDeviceId var ise → sadece o deviceId'li agent alır
     * - Agent deviceId göndermezse → eski davranış (filter uygulanmaz)
     */
  async claimPendingCommands(tenantId: string, agent?: string, deviceId?: string) {
    const where: any = { tenantId, status: 'pending' };
    if (agent) where.agent = agent;
    const pending = await this.prisma.agentCommand.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    if (pending.length === 0) return [];
    // Device filter: targetDeviceId varsa eşleşmesi gerekir
    const matched = deviceId
      ? pending.filter((p) => {
          const target = (p.payload as any)?.targetDeviceId;
          // target yoksa herkesin (eski davranış); varsa sadece eşleşen device alır
          return !target || target === deviceId;
        })
      : pending;
    if (matched.length === 0) return [];
    await this.prisma.agentCommand.updateMany({
      where: { id: { in: matched.map((p) => p.id) } },
      data: { status: 'running', startedAt: new Date() },
    });
    return matched;
  }

  /**
   * Claude Haiku 4.5 ile fatura kararı verir.
   * Input: fatura jpeg base64 + hesap kodları
   * Output: { karar: 'onay'|'atla'|'emin_degil', sebep: string, ocrOzet?: string, onerilenler?: {...} }
   *
   * YENİ (Bilanço SATIŞ modu): bosAlanSecenekleri verilirse AI boş alanlar için
   * Mihsap dropdown'undan hesap kodu önerir (matrah / kdv / cari).
   */
  async decideFatura(input: {
    faturaImageBase64: string;
    faturaImageMediaType?: string;
    hesapKodlari: string[];
    faturaTarihi?: string;
    hedefAy?: string;
    belgeNo?: string;
    belgeTuru?: string;
    faturaTuru?: string;
    mukellef?: string;
    mukellefId?: string; // YENİ: Taxpayer.id — Firma Hafızası mükellef-bazlı öğrenme için
    firma?: string;
    firmaKimlikNo?: string; // Karsi firma VKN/TCKN — Firma Hafizasi icin
    tutar?: number | string;
    action?: string; // 'isle_alis' | 'isle_satis' | 'isle_alis_isletme' | 'isle_satis_isletme'
    tenantId?: string;
    /**
     * Boş alanlar için dropdown seçenekleri. Runner, Mihsap'ta boş alana tıkladığında
     * Luca entegrasyonundan gelen hesap kodu listesini buraya koyar.
     * AI her alan için listedeki en uygun kodu seçer.
     */
    bosAlanSecenekleri?: {
      matrahKodlari?: string[];  // Matrah hesabı (ör: 600.01.001, 600.01.005...)
      kdvKodlari?: string[];     // KDV hesabı (ör: 391.01.001, 391.01.006...)
      cariKodlari?: string[];    // Cari hesap (ör: 120.01.ABC, 120.02.XYZ...)
    };
  }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { karar: 'emin_degil', sebep: 'ANTHROPIC_API_KEY yok' };
    }

    // Mükellef ID eksikse, mükellef adından bulmaya çalış.
    // Arama stratejisi: equals / contains / reverse-contains / firstName+lastName
    if (!input.mukellefId && input.tenantId && input.mukellef) {
      try {
        const mukellefAd = input.mukellef.trim();
        // Önce tüm mükellefleri kısaca çek, kod tarafında fuzzy eşleştir
        const candidates = await this.prisma.taxpayer.findMany({
          where: { tenantId: input.tenantId, isActive: true },
          select: { id: true, companyName: true, firstName: true, lastName: true },
        });
        const normalize = (s: string) => s.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ').trim();
        const target = normalize(mukellefAd);
        let found: { id: string } | null = null;
        // 1. Tam eşleşme
        for (const c of candidates) {
          const name = c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
          if (!name) continue;
          if (normalize(name) === target) { found = c; break; }
        }
        // 2. İçerik karşılaştırması (iki yönlü)
        if (!found) {
          for (const c of candidates) {
            const name = c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            if (!name) continue;
            const n = normalize(name);
            if (n.includes(target) || target.includes(n)) { found = c; break; }
          }
        }
        // 3. İlk kelime eşleşmesi (son çare)
        if (!found) {
          const firstWord = target.split(' ')[0];
          if (firstWord && firstWord.length >= 4) {
            for (const c of candidates) {
              const name = c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
              if (!name) continue;
              const n = normalize(name);
              if (n.startsWith(firstWord + ' ') || n === firstWord) { found = c; break; }
            }
          }
        }
        if (found) input.mukellefId = found.id;
      } catch {}
    }

    // === MÜKELLEF PROFİLİ ZORUNLU KONTROL ===
    // Sektör/faaliyet tanımı yoksa AI'ya bile gitme — "önce profil tanımla" uyarısı
    let rule: any = null;
    if (input.tenantId && input.mukellef) {
      try {
        rule = await this.prisma.agentRule.findUnique({
          where: { tenantId_mukellef: { tenantId: input.tenantId, mukellef: input.mukellef } },
        });
      } catch {}
    }
    const sektor = rule?.profile?.sektor?.toString().trim();
    if (!sektor) {
      return {
        karar: 'atla',
        sebep: `⚠️ Mükellef profili eksik — Mükellef Profilleri'nden "${input.mukellef}" için sektör/faaliyet tanımlayın`,
        profilEksik: true,
        mukellef: input.mukellef,
        mukellefId: input.mukellefId,
      };
    }

    const hasBosAlanSecenekleri = !!(
      input.bosAlanSecenekleri &&
      ((input.bosAlanSecenekleri.matrahKodlari?.length || 0) +
        (input.bosAlanSecenekleri.kdvKodlari?.length || 0) +
        (input.bosAlanSecenekleri.cariKodlari?.length || 0)) > 0
    );

    // === ZORUNLU META KONTROLÜ ===
    // Agent tarih/belge türü okuyamadıysa fatura işleme — tutarsız karar vermesin.
    // Kullanıcı bu alanları canlı akışta ✗ görüyorsa sebep burada.
    const faturaTarihi = (input.faturaTarihi || '').trim();
    const belgeTuru = (input.belgeTuru || '').trim();
    if (!faturaTarihi || faturaTarihi === '?' || faturaTarihi === '??') {
      return {
        karar: 'atla',
        sebep: '⚠️ Fatura tarihi okunamadı — agent meta eksik, fatura atlandı',
        metaEksik: 'tarih',
      };
    }
    if (!hasBosAlanSecenekleri && (!belgeTuru || belgeTuru === '?' || belgeTuru === '??')) {
      return {
        karar: 'atla',
        sebep: '⚠️ Belge türü okunamadı — agent meta eksik, fatura atlandı',
        metaEksik: 'belgeTuru',
      };
    }

    // Mükellef profili prompt metni (sektör dahil tüm yapılandırılmış alanlar)
    let mukellefTalimat = '';
    if (rule?.profile) {
      mukellefTalimat = profileToPromptText(rule.profile);
    }

    // Firma Hafizasi — bu firma icin gecmis onaylari hint olarak al.
    // Hint varsa AI prompt'una OVERRIDE kuraliyla eklenecek (fatura icerigi cakisirsa
    // AI hint'i gormezden gelebilir). 3+ onay yoksa null doner (yeni/az kullanilmis firma).
    let vendorHint: Awaited<ReturnType<VendorMemoryService['getHintForVendor']>> = null;
    if (input.tenantId && input.firmaKimlikNo) {
      try {
        vendorHint = await this.vendorMemory.getHintForVendor(
          input.tenantId,
          input.firmaKimlikNo,
          'fatura',
          input.mukellefId || null, // Mükellef-bazlı hint
        );
      } catch {}
    }
    const kodListe = input.hesapKodlari.join(', ');
    // Hem Bilanço hem İşletme Defteri için alış/satış ayrımı aynı — URL farklı, işlem mantığı aynı.
    const SATIS_ACTIONS = ['isle_satis', 'isle_satis_isletme'];
    const ALIS_ACTIONS = ['isle_alis', 'isle_alis_isletme'];
    const islemTuru = SATIS_ACTIONS.includes(input.action || '')
      ? 'SATIŞ'
      : ALIS_ACTIONS.includes(input.action || '')
      ? 'ALIŞ'
      : 'ALIŞ';

    // === DETERMİNİSTİK KOD KONTROLÜ ===
    const SATIS_PFX = ['600', '601', '602', '120', '121', '122', '391'];
    const ALIS_PFX  = ['150', '153', '157', '253', '255', '320', '321', '322', '740', '770', '191'];
    const firstThree = (c: string) => (c.match(/^(\d{3})/)?.[1] || '');
    const codesArr = input.hesapKodlari.map(c => c.trim()).filter(Boolean);
    const pfxs = codesArr.map(firstThree).filter(Boolean);
    const hasSatis = pfxs.some(p => SATIS_PFX.includes(p));
    const hasAlis  = pfxs.some(p => ALIS_PFX.includes(p));
    const demirbas = pfxs.some(p => p === '253' || p === '255');
    const codeType = hasSatis && !hasAlis ? 'SATIŞ' : hasAlis && !hasSatis ? 'ALIŞ' : 'KARIŞIK';

    // Demirbaş → atla
    if (demirbas) {
      return { karar: 'atla', sebep: `Demirbaş kodu (253/255) — ${codesArr[0]}` };
    }
    // Mod/kod uyumsuzluğu → AI'ya sormadan atla
    if (islemTuru === 'SATIŞ' && codeType === 'ALIŞ') {
      return { karar: 'atla', sebep: `SATIŞ modu ama kodlar ALIŞ (${codesArr.slice(0,2).join('+')})` };
    }
    if (islemTuru === 'ALIŞ' && codeType === 'SATIŞ') {
      return { karar: 'atla', sebep: `ALIŞ modu ama kodlar SATIŞ (${codesArr.slice(0,2).join('+')})` };
    }

    // Tarih kontrolü (deterministik)
    const tarihM = (input.faturaTarihi || '').match(/^(\d{2})[-.\/](\d{2})[-.\/](\d{4})/);
    const faturaAyi = tarihM ? tarihM[2] : '';
    const hedefAyNum = (input.hedefAy || '').match(/-(\d{2})$/)?.[1] || '';
    if (faturaAyi && hedefAyNum && faturaAyi !== hedefAyNum) {
      return { karar: 'atla', sebep: `Tarih ayı ${faturaAyi} ≠ hedef ayı ${hedefAyNum}` };
    }

    const startMs = Date.now();
    const MODEL = 'claude-haiku-4-5-20251001';
    const aiCallReasons = new Set<string>();
    if (hasBosAlanSecenekleri) aiCallReasons.add('bos_kod');

    const logZeroUsage = (source: string, karar: string, sebep: string, cacheHit = true) =>
      logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        taxpayerId: input.mukellefId || null,
        source,
        model: MODEL,
        mukellef: input.mukellef,
        belgeNo: input.belgeNo,
        karar,
        sebep,
        durationMs: Date.now() - startMs,
        cacheHit,
        usage: { input_tokens: 0, output_tokens: 0 },
      });

    const imageHash = input.faturaImageBase64
      ? createHash('sha256').update(input.faturaImageBase64).digest('hex')
      : '';
    const decisionCacheKey = [
      input.tenantId || 'unknown',
      input.mukellefId || input.mukellef || '',
      input.belgeNo || '',
      input.tutar || '',
      imageHash.slice(0, 24),
      input.action || '',
    ].join('|');

    const memCached = this.faturaDecisionCache.get(decisionCacheKey);
    if (memCached && memCached.expiresAt > Date.now()) {
      await logZeroUsage('mihsap-fatura-cache', memCached.value?.karar || 'cache_hit', 'cache_hit: memory decision reused');
      return { ...memCached.value, cacheHit: true, aiCallReason: 'cache_hit' };
    }

    if (input.tenantId && input.belgeNo && input.mukellef) {
      try {
        const previous = await this.prisma.agentEvent.findFirst({
          where: {
            tenantId: input.tenantId,
            agent: 'mihsap',
            mukellef: input.mukellef,
            fisNo: input.belgeNo,
            ...(input.tutar != null && input.tutar !== '' ? { tutar: Number(input.tutar) } : {}),
            status: { in: ['onaylandi', 'basarili', 'atlandi'] },
          },
          orderBy: { ts: 'desc' },
        });
        if (previous?.meta) {
          const meta: any = previous.meta;
          const karar =
            previous.status === 'atlandi'
              ? 'atla'
              : meta?.decisionTrace?.karar?.sonuc || meta?.karar || 'onay';
          const cachedDecision = {
            karar,
            sebep: `cache_hit: ayni belge daha once islendi (${previous.status})`,
            decisionTrace: meta?.decisionTrace || null,
            faturaDecisionCandidate: meta?.faturaDecisionCandidate || null,
          };
          this.faturaDecisionCache.set(decisionCacheKey, {
            expiresAt: Date.now() + 6 * 60 * 60 * 1000,
            value: cachedDecision,
          });
          await logZeroUsage('mihsap-fatura-cache', karar, cachedDecision.sebep);
          return { ...cachedDecision, cacheHit: true, aiCallReason: 'cache_hit' };
        }
      } catch {}
    }

    const isZRaporu = /z[\s_-]*rapor/i.test(`${input.belgeTuru || ''} ${input.firma || ''}`);
    const canUseDeterministicZRaporu =
      isZRaporu &&
      !hasBosAlanSecenekleri &&
      codesArr.length > 0 &&
      Number.isFinite(Number(input.tutar)) &&
      !vendorHint;
    if (canUseDeterministicZRaporu) {
      const memoryCategory = codesArr.find((c) => /^(600|601|602|150|153|157|740|770)\./.test(c)) || codesArr[0];
      const deterministicDecision = {
        karar: 'onay',
        sebep: 'rule_fast_path: Z raporu, kod/tarih/tutar ekran verisi yeterli; Claude cagrilmadi',
        icerikSinifi: 'Mal',
        ocrOzet: 'Z raporu perakende satis',
        faturaDecisionCandidate: input.firmaKimlikNo
          ? {
              kararTipi: 'fatura',
              hesapKodu: memoryCategory,
              firmaKimlikNo: input.firmaKimlikNo || null,
              firmaUnvan: input.firma || null,
              taxpayerId: input.mukellefId || null,
            }
          : undefined,
        decisionTrace: {
          belge: {
            tarih: input.faturaTarihi || null,
            belgeNo: input.belgeNo || null,
            cari: input.firma || null,
            belgeTuru: input.belgeTuru || null,
            kdvOrani: null,
            ocrToplam: input.tutar ?? null,
          },
          ekran: {
            tarih: input.faturaTarihi || null,
            belgeNo: input.belgeNo || null,
            belgeTuru: input.belgeTuru || null,
            faturaTuru: input.faturaTuru || null,
            tutar: input.tutar ?? null,
            hesapKodlari: input.hesapKodlari || [],
          },
          karar: {
            sonuc: 'onay',
            sebep: 'Z raporu deterministik kural ile onaylandi; AI maliyeti olusmadi',
            icerikSinifi: 'Mal',
            memoryCategory,
            vendorHintUsed: false,
          },
        },
      };
      this.faturaDecisionCache.set(decisionCacheKey, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        value: deterministicDecision,
      });
      await logZeroUsage('mihsap-fatura-rule', 'onay', deterministicDecision.sebep);
      return { ...deterministicDecision, aiCallReason: 'rule_fast_path' };
    }

    if (!hasBosAlanSecenekleri) aiCallReasons.add('manuel_kontrol');
    const system = `Sen bir fatura doğrulayıcısın. VARSAYILAN KARAR: ONAY.

### 🚨 MUTLAK İLK KAPI — HER ŞEYDEN ÖNCE OKU 🚨

**E-FATURA YÖN BİLGİSİ:**
E-fatura belgesinde yazan "Fatura Tipi: SATIŞ" İFADESİ KARŞI FİRMANIN (satıcının) BAKIŞ AÇISIDIR.
Satıcı her faturasına "Fatura Tipi: SATIŞ" yazar — bu e-fatura standardıdır.
Alıcı (mükellefimiz) için aynı fatura ALIŞ'tır.

**EKRANDAKİ işlem yönü "${islemTuru}" — bu tek doğru yön bilgisidir.**

Fatura üzerinde "SATIŞ" yazmasını, ekrandaki ALIŞ moduyla çelişki olarak YORUMLAMA.
"Belge no uyumlu ama Fatura Tipi SATIŞ olarak işaretlenmiş" gibi sebeplerle ATLAMA — BU HATA.
"Senaryo: TICARIFATURA / TEMELFATURA" e-fatura standardıdır, yön bilgisi DEĞİL.
"ETTN: xxx-xxx-xxx" elektronik tebligat numarasıdır, BELGE NO DEĞİL.
"UBL-TR 1.2" / "TR 1.x" XML versiyonudur, BELGE NO DEĞİL.

### /MUTLAK İLK KAPI ###

### NAKLIYE / ARAÇ KURALI ###
Fatura satırında şu ifadelerden HERHANGİ BİRİ geçiyorsa: "nakliye bedeli", "nakliyat bedeli", "taşıma bedeli", "sevk bedeli", "sefer bedeli", "taşımacılık bedeli", "lojistik bedeli", "nakliye ücreti", "nakl bedeli" → KARAR: ONAY.
BU CÜMLELERDE "aracın", "araç", "plaka", "otomobil", "kamyon", "tır" KELİMELERİ GEÇSE DAHİ → ONAY.
"aracın nakliye bedeli" = NAKLİYE HİZMETİ FATURASIDIR, ARAÇ SATIŞI DEĞİLDİR. Bunu "araç satışı" diye yorumlamak YASAK.
"34XXX YYY PLAKALI ARACIN [güzergah] NAKLIYE BEDELİ" formatı = nakliye faturası = ONAY.
Bu kurala uymayan ATLA kararları KESİNLİKLE geçersizdir.
### /NAKLIYE KURALI ###

Sadece aşağıdaki KESİN ATLA LİSTESİ'nden biri varsa atla. Yoksa ONAY. Görüntü okunamazsa emin_degil.

=== BACKEND ZATEN DOĞRULADI (sorgulama) ===
İşlem modu: ${islemTuru} | Kodlar: ${codesArr.join(', ')} | Kod türü: ${codeType}
Ekrandaki fatura türü: ${input.faturaTuru || '?'} | Belge türü: ${input.belgeTuru || '?'}
Mod-kod uyumu: TAMAM. Tarih ayı: TAMAM. Alış/satış yönü: TAMAM.

=== KESİN ATLA LİSTESİ (yalnızca bu 6 durumda atla) ===

⚠️ **KRİTİK — YANILTICI E-FATURA ALANLARI:**
E-fatura belgesinde şu alanlar KARŞI FİRMANIN bakış açısındadır, bunları bizim ekran alanlarımızla karıştırma:
  • "Fatura Tipi: SATIŞ" — satıcı açısından yazılır. Biz alış yapıyorsak NORMAL, atlama sebebi DEĞİL.
  • "Senaryo: TICARIFATURA / TEMELFATURA" — e-fatura standardı, yön bilgisi değil.
  • "ETTN: xxx-xxx-xxx" — Elektronik Tebligat Tebliğ No, BELGE NO DEĞİL.
  • "UBL-TR 1.2" / "TR x.y" — XML versiyon, BELGE NO DEĞİL.
Belge no olarak SADECE faturanın başındaki "Fatura No: XXX" veya "Belge No: XXX" alanına bak.

[A] TARİH FARKLI: MIHSAP ekranındaki tarih (${input.faturaTarihi || '?'}) ile fatura görüntüsündeki tarih AYNI GÜN DEĞİL.
    → Gün/ay/yıl üçünden biri farklıysa atla. Okuyamazsan bu kontrolü GEÇ (atlama).

[B] KDV ORANI FARKLI: Faturadaki KDV oranı (%1/%10/%20) ile ekrandaki KDV oranı eşleşmiyor.
    → Farklıysa atla. Okuyamazsan bu kontrolü GEÇ.

[C] CARİ FİRMA TAMAMEN FARKLI: Ekrandaki firma ile fatura karşı tarafı BAŞKA ŞİRKET (örn. "Ahmet Ltd" vs "Mehmet AŞ").
    → Kısaltma/uzun ad/unvan farkı (LTD ŞTİ vs LİMİTED ŞİRKETİ) önemsiz — ONAY.
    → Bariz farklı şirket isimleriyse atla.

[D] BELGE NO FARKLI: Ekrandaki belge no (${input.belgeNo || '?'}) ile fatura üzerindeki gerçek "Fatura No" FARKLI.
    → Farklıysa atla. ETTN / UBL / Senaryo alanları belge no DEĞİL — onlara bakma.
    → Okuyamazsan bu kontrolü GEÇ.

[E] SABİT KIYMET / DEMİRBAŞ / ARAÇ / MAKİNE:
    ⛔ **Fatura içeriği şunlardan biri ise KARAR: ATLA** (hem ALIŞ hem SATIŞ'ta):
      - Bilgisayar, laptop, yazıcı, telefon (demirbaş)
      - Mobilya, masa, sandalye, dolap, koltuk (demirbaş)
      - Klima, kombi, televizyon, buzdolabı (demirbaş)
      - Araba, kamyon, minibüs, motosiklet (taşıt)
      - Üretim makinesi, tezgah, kompresör, jeneratör (makine)
      - Hat, tesisat, inşaat ekipmanı (tesis)
    Sebep: "Sabit kıymet — amortisman gerekli, kullanıcı elle işlesin"
    AI'nın 253/254/255 koduna yazma hakkı YOK — bu içerikler bulunursa atla.

[E.alt] AÇIK DEMİRBAŞ/ARAÇ/İADE SATIŞI:
    Fatura satırının TAMAMINI bir cümle olarak oku. Cümlede şu kelimelerden BİRİ geçiyorsa ONAY (atlamadan geç):
      "nakliye", "nakliyat", "taşıma", "taşımacılık", "sevk", "sevkiyat", "lojistik", "hat", "güzergah", "sefer", "bedel", "ücret"
    Bu kelimeler yoksa, cümlede AÇIKÇA şunlardan biri YAZIYORSA atla:
      - "İADE FATURASI" büyük harfle
      - "demirbaş satışı", "taşıt satışı" veya satılan şeyin kendi ismi (bilgisayar, yazıcı, klima, mobilya, kompresör, makine teçhizat)
    Parçaları tek tek analiz etme (plaka vs güzergah vs kelime), CÜMLEYİ BÜTÜN OLARAK OKU.
    Örnek: "34FPL505 AVCILAR-KARTAL NAKLİYE BEDELİ" — cümlede "nakliye" ve "bedeli" geçiyor → ONAY.

[F] FATURA TÜRÜ / BELGE TÜRÜ UYUMU:
    Ekrandaki fatura türü: ${input.faturaTuru || '?'}  (örn. NORMAL_SATIS, TEVKIFATLI_SATIS, NORMAL_ALIS, IADE, İHRACAT)
    Ekrandaki belge türü: ${input.belgeTuru || '?'}  (örn. E_FATURA, E_ARSIV, FIS, IRSALIYE)
    Görüntüye bak:
    • Fatura üzerinde "TEVKİFATLI FATURA" / "TEVKİFAT UYGULANIR" yazıyor ama ekrandaki faturaTuru TEVKIFAT içermiyorsa → atla
    • Fatura üzerinde TEVKİFAT YOK ama ekranda TEVKIFATLI seçiliyse → atla
    • Fatura üzerinde "İADE FATURASI" yazıyor ama ekran faturaTuru IADE değilse → atla
    • Fatura "e-Arşiv Fatura" yazıyor ama belgeTuru E_FATURA ise veya tam tersi → atla
    • Fatura "e-Fatura" yazıyor ama belgeTuru E_ARSIV ise → atla
    • Fatura üzerinde "İHRACAT / EXPORT" yazıyor ama faturaTuru normal satışsa → atla

    [F.1] ÖKC FİŞİ vs FATURA UYUMSUZLUĞU (ÇOK ÖNEMLİ):
      ÖKC fişi (yazarkasa fişi) belirteçleri — herhangi biri görülüyorsa belge ÖKC FİŞİ'dir:
        • "Z NO" / "Z NO:" numarası (örn "Z NO:1462")
        • "EKÜ NO" / "EKÜ NO:" numarası
        • "T. SİCİL NO" / "T.SİCİL NO" (yazarkasa sicil numarası)
        • "EMV SATIŞ TUTARI" veya "EMU SATIŞ TUTARI"
        • "FİŞ NO" küçük formatta (örn "FİŞ NO: 0099") — üstte yazarkasa adı/VD ile birlikte
        • Altta "AID:" veya "I:" ve "T:" EMV kart kodları
        • Termal yazıcı görünümlü dar kağıt, "TOPKDV" / "TOPLAM" toplu satırları
      e-Fatura/e-Arşiv belirteçleri — tek başına veya kombinasyon:
        • Üstte "e-FATURA" / "e-ARŞİV FATURA" ibaresi
        • GİB kare kodu / barkod
        • GTİP satırları, satır kalemli tablo (adet, birim fiyat, matrah, KDV, toplam sütunları)
        • ETTN numarası veya fatura no formatı "XXX2026000000123"
      KARAR KURALI:
        • Görüntüde ÖKC göstergelerinden (Z NO / EKÜ NO / T.SİCİL / EMV SATIŞ) en az 2 tanesi KESİN görünüyor
          VE ekrandaki belgeTuru "E_FATURA" veya "E_ARSIV" ise → ATLA ("ÖKC fişi ama Fatura seçilmiş")
        • Görüntüde e-Fatura/e-Arşiv göstergeleri KESİN var ama ekrandaki belgeTuru "FIS" ise → ATLA ("Fatura ama ÖKC seçilmiş")
        • Emin değilsen atlama, GEÇ.

    NOT: Okuyamadığın madde için atlama, GEÇ. Sadece KESİN gördüğün uyumsuzlukta atla.

=== MUTLAK YASAKLAR (asla bu gerekçelerle ATLA deme) ===
× "Mükellef alıcı/satıcı konumunda" / "ALIŞ/SATIŞ konumu" — yön backend'in işi
× "Alış/satış kodu çelişkisi" — yön kontrolü backend'in işi, YAPMA
× "Backend X demiş ama görüntüde Y" cümlesi kurma — backend doğru
× Plaka/güzergah/rota görünce araç satışı çıkarımı
× "Emin değilim ama ihtimal..." — şüpheliyse onay_bekliyor kullan

=== [G] İÇERİK ↔ KOD UYUM KONTROLÜ (YENİ — bir mali müşavirin yaptığı iş) ===
Fatura kalemlerini oku, içeriği SINIFLANDIR:
  • "Mal" (ticari ürün satışı/alışı — gıda, içecek, tekstil, hammadde, yedek parça, bitmiş ürün)
  • "Hizmet" (nakliye, temizlik, danışmanlık, yazılım, iletişim, muhasebe, sigorta)
  • "Sabit Kıymet" (bilgisayar, mobilya, makine, taşıt — işletmede kullanılan uzun ömürlü eşya)
  • "Kira/Kiralama" (gayrimenkul, araç, makine kiralama)
  • "Enerji/Sarf" (elektrik, su, doğalgaz, akaryakıt, kırtasiye, temizlik malzemesi)
  • "Finansal" (faiz, bankacılık, sigorta primi)

Ekrandaki matrah kodu (${codesArr.join(', ')}) içerik türüne UYUYOR mu? Hızlı eşleştirme:
  • **153.xx** (Ticari Mallar) → sadece "Mal" içeriği (ticari ürün alışı)
  • **150.xx / 151.xx / 152.xx** (İlk Madde/Yarı Mamul/Mamul) → hammadde veya üretim malzemesi
  • **157.xx** (Diğer Stoklar) → sarf malzemesi stoklanıyor
  • **253.xx** (Tesis, Makine, Cihazlar) → üretim makinesi, ağır ekipman
  • **254.xx** (Taşıtlar) → araba, kamyon, minibüs (taşıt)
  • **255.xx** (Demirbaşlar) → bilgisayar, masa, mobilya, küçük makine
  • **740.xx** (Hizmet Üretim Maliyeti) → üretimde kullanılan hizmet/sarf (ör. üretim için alınan nakliye, elektrik)
  • **760.xx** (Pazarlama Satış Dağıtım Gid.) → reklam, sosyal medya, tanıtım, kargo-dağıtım
  • **770.xx** (Genel Yönetim Giderleri) → ofis elektriği, internet, kırtasiye, muhasebe, kira
  • **600.xx / 601.xx** (Satışlar) → "Mal" satışı
  • **120.xx / 320.xx** (Alıcı/Satıcı cari) → her tür (cari hesap, matrah değil)

**ALTIN KURAL — Her fatura için mantıksal akıl yürütme (EZBERE YOK):**

Mükellefin sektörü yukarıda MÜKELLEF PROFİLİ'nde verildi. Bu bilgiyle aşağıdaki soruları sor:

1. **Fatura ne içeriyor?** (mal/hizmet açıklaması)
2. **Bu içerik mükellefin NE olduğuyla ilgili?**
   • Mükellefin **satış konusu** mu? (aynı sektörden ürün/hizmet alıyor) → **Mal/Stok grubu** (153/150/152/157)
   • Mükellefin **üretim/hizmet sürecinin parçası** mı? (hizmet sektörü için yakıt, depo elektriği, sarf gibi iş için kullanılan gider) → **Hizmet Üretim Maliyeti** (740)
   • Mükellefin **pazarlama/satış aşamasının** parçası mı? (reklam, kargo, tanıtım) → **Pazarlama Satış Dağıtım** (760)
   • **Yönetim/ofis giderleri** (ofis elektriği, kırtasiye, muhasebe hizmeti) → **Genel Yönetim** (770)
   • **İşletmede uzun süre kullanılacak eşya** mı? → **Sabit Kıymet** (253 makine / 254 taşıt / 255 demirbaş)
   • **Finansman** (faiz, bankacılık, sigorta primi) → 780 veya ilgili

3. **Ekrandaki kod** (${codesArr.join(', ')}) **yukarıda çıkardığın mantıksal koda uyuyor mu?**
   • Uyuyorsa → **onay**
   • Ana hesap grubu farklıysa → **onay_bekliyor** (sebep: "X olmalı ama Y seçilmiş")

**ÖRNEK AKIL YÜRÜTME — faaliyete göre farklılık:**
  • Mükellef = gıda toptancısı, fatura = gıda → satış konusu → 153 doğru
  • Mükellef = inşaat, fatura = gıda → satış konusu DEĞİL, personel için → 770 doğru
  • Mükellef = nakliye, fatura = akaryakıt → işin maliyeti → **740 doğru** (ezbere 770 DEĞİL)
  • Mükellef = nakliye, fatura = depo kirası → işin maliyeti → **740 doğru**
  • Mükellef = nakliye, fatura = ofis kirası → yönetim → 770 doğru
  • Mükellef = imalatçı, fatura = fabrika elektriği → üretim → **740 / 730**
  • Mükellef = imalatçı, fatura = ofis elektriği → yönetim → 770
  • Mükellef = ofis işletmesi, fatura = ofis elektriği → 770 doğru
  • Mükellef = her sektör, fatura = bilgisayar → uzun süre kullanım → **255** doğru

**NOT:** Fatura AÇIKLAMASI net değilse (sadece "hizmet bedeli" gibi) onay ver — aksi halde aşırı titiz atmış olursun.

Kontrolde **ekran kodunun ilk 3 hanesi** dikkate alınır (153.01.005 → 153). Alt kırılım (153.01.001 vs 153.01.005) kontrol EDİLMEZ.

**UYUMLUYSA** → onay. Emin değilsen → onay_bekliyor (ATLA değil — kullanıcı bakacak).

=== KARAR AKIŞI (yeni) ===
1. [A][B][C][D][E][F] kesinse → **atla** (ekran-görüntü tutarsızlığı, özel durum)
2. [G] içerik-kod uyumsuzluğu varsa (mükellef sektörü dahil) → **onay_bekliyor** (kullanıcı bakacak)
3. Görüntü tamamen okunamıyor mu? → **emin_degil**
4. Diğer tüm durumlar → **onay** (F2)

NOT: "onay_bekliyor" ATLA DEĞİL. Fatura kullanıcının onay kuyruğuna düşer, kullanıcı elle karar verir.

${vendorHint ? `
${vendorHint.hintText}` : ''}
${mukellefTalimat ? `
=== MÜKELLEF ÖZEL TALİMATI (${input.mukellef}) ===
${mukellefTalimat}

[TALİMAT YORUM KURALLARI — ÇOK ÖNEMLİ]
Yukarıdaki talimatta "araç satışı" geçiyor. Bunu UYGULAMAK için şu ŞART'ı ara:
  Fatura satırında AÇIKÇA şunlardan biri yazıyor olmalı:
    • "ARAÇ SATIŞ BEDELİ" / "TAŞIT SATIŞ BEDELİ" / "OTO SATIŞ BEDELİ"
    • "aracın satış bedeli" / "aracın satışı"
    • "DEMİRBAŞ SATIŞI" + araç modeli/şasisi

ŞUNLAR "ARAÇ SATIŞI" DEĞİLDİR — TALİMATI TETİKLEMEZ:
  ✗ "plakalı aracın X nakliye bedeli" → taşımayı yapan aracın nakliye ücreti (ONAY)
  ✗ "34ABC123 PLAKALI ARAÇ [güzergah] NAKLIYE" → nakliye hizmeti (ONAY)
  ✗ Plaka + güzergah + "bedel/ücret/nakliye" kombinasyonu → hizmet faturası (ONAY)
  ✗ İçerikte "araç" kelimesi geçiyor olması tek başına araç satışı DEĞİL

Cümlede "nakliye/taşıma/sevk/lojistik/sefer" kelimesi geçiyorsa, içerikte plaka veya "araç" kelimesi de olsa DAHİ → ONAY.
` : ''}
${
  // Hem ALIŞ hem SATIŞ modunda — boş alan seçeneği verildiyse öneri bölümünü ekle
  ['isle_satis', 'isle_alis', 'isle_satis_isletme', 'isle_alis_isletme'].includes(input.action || '') && input.bosAlanSecenekleri &&
  ((input.bosAlanSecenekleri.matrahKodlari?.length || 0) +
   (input.bosAlanSecenekleri.kdvKodlari?.length || 0) +
   (input.bosAlanSecenekleri.cariKodlari?.length || 0)) > 0
  ? `
=== HESAP KODU ÖNERİSİ — ${islemTuru} ===
Runner bu faturada BOŞ alan tespit etti. Dropdown'daki mevcut seçeneklerden doğru kodu sen seçeceksin.
Mevcut seçenekler aşağıda. HER ALAN İÇİN tam olarak bu listelerden BİRİNİ seç — listenin dışından kod ÜRETME.

A) MATRAH HESABI (faturanın KDV'siz bedeli hangi ${islemTuru === 'SATIŞ' ? 'satış' : 'alış/gider'} hesabına yazılacak):
   Seçenekler: ${input.bosAlanSecenekleri.matrahKodlari?.join(', ') || '(runner listelemedi — önerme)'}

   🔴 KRİTİK KURAL (v1.36.23) — KDV ORAN EŞLEŞMESİ (KOŞULLU):
   ÖNCE listedeki hesap kodu AÇIKLAMALARINDA KDV oranı (%1, %01, %8, %08, %10, %18, %20) yazıyor mu kontrol et.

   ───────────────────────────────────────────────────────────
   DURUM 1: Hesaplardan EN AZ İKİSİ farklı KDV oranı içeriyor
   ───────────────────────────────────────────────────────────
   Örn: "153.01.010-%10 TİCARİ MAL ALIŞLARI" + "153.01.020-%20 TİCARİ MAL ALIŞLARI"
   → KDV oran eşleşmesi ZORUNLU. Faturanın KDV oranıyla AYNI %X içeren kodu seç.
   → Eşleşmezse matrahHesapKodu: null + onay_bekliyor.
   → Geçmişte farklı oranda kullanıldıysa bile bu faturanın oranına göre git.

   ───────────────────────────────────────────────────────────
   DURUM 2: Hesaplardan HİÇBİRİNDE KDV oranı YAZMIYOR (veya hepsi aynı)
   ───────────────────────────────────────────────────────────
   Örn: sadece "153.01.001 TİCARİ MAL ALIŞLARI" + "150.01.001 İLK MADDE"
   → KDV oran eşleşmesi UYGULANMAZ. Sektör/içerik mantığıyla seç.
   → Tek kod varsa direkt onu seç.

   ───────────────────────────────────────────────────────────
   DURUM 3: Bazı kodlarda %X var, bazılarında yok (KARIŞIK)
   ───────────────────────────────────────────────────────────
   → Önce %X yazan kodlar arasında oran eşleşeni bul. Bulursan onu seç.
   → Bulamazsan: %X yazmayan kodlardan içeriğe en uyanı seç.
   → Hiçbiri uymadıysa null + onay_bekliyor.

   ${islemTuru === 'SATIŞ' ? `SATIŞ kuralı:
     • 600.xx → Yurtiçi Mal/Hizmet Satışı (en yaygın)
     • 601.xx → Yurtdışı Satış (İHRACAT faturalarında)
     • 602.xx → Diğer Satışlar` : `ALIŞ kuralı — fatura içeriğine göre seç:
     • 153.xx → Ticari Mal Alışı (mükellefin satış konusuyla aynı ürün)
     • 150.xx → İlk Madde/Malzeme (üretimde kullanılacak hammadde)
     • 740.xx → Hizmet Üretim Maliyeti (mükellefin işinin maliyeti — ör. nakliyecinin yakıtı)
     • 760.xx → Pazarlama/Satış/Dağıtım Gideri (reklam, kargo, tanıtım)
     • 770.xx → Genel Yönetim Gideri (ofis, elektrik, kira, muhasebe, internet)

     ⛔ **SABİT KIYMET (253/254/255) YASAK**: Fatura içeriği bilgisayar/mobilya/makine/taşıt ise
     → karar: "atla", sebep: "Sabit kıymet alımı — kullanıcı elle işlesin"
     → Bu ürünler amortisman gerektirir, AI otomatik işlemez.`}
   Fatura satırındaki ÜRÜN/HİZMET AÇIKLAMASINA + mükellef sektörüne bak.
   ÖNCELİK: KDV oran eşleşmesi → sektör/içerik uygunluğu → tek kod ise direkt seç.

B) KDV HESABI:
   Seçenekler: ${input.bosAlanSecenekleri.kdvKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   ${islemTuru === 'SATIŞ' ? `Kural: Satışta KDV hep 391 grubunda (Hesaplanan KDV).`
    : `Kural: Alışta KDV hep 191 grubunda (İndirilecek KDV).`}
   🔴 KDV oran eşleşmesi MATRAH ile aynı kuralda: hesap kodu açıklamasındaki %X faturanın KDV oranı ile eşleşmeli.
   Listede birden fazla alt kod varsa, MATRAH seçtiğin kodla AYNI alt gruplama mantığı önceliklidir.
   ⚠ KDV oran eşleşmiyorsa → kdvHesapKodu: null + onay_bekliyor.

C) CARİ HESAP:
   Seçenekler: ${input.bosAlanSecenekleri.cariKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   ${islemTuru === 'SATIŞ' ? `Kural: Alici firmayi 120.xx cariye sadece profil buna izin veriyorsa eslestir.`
    : `Kural: Satici firmayi 320.xx cariye sadece profil buna izin veriyorsa eslestir.`}
   PROFIL KAPISI ZORUNLU:
   - Cari takip politikasi "hepsi_cari" ise cari eslestirme serbesttir.
   - "sadece_tanimli" veya "cari_yoksa_odeme" ise 120/320 sadece firma adi "Cari takip edilecek surekli tedarikciler" listesinde acikca geciyorsa secilir.
   - Firma bu listede degilse 120/320 secme; cari yoksa kullanilacak hesap / odeme hesabi / tahsilat hesabi neyse onu sec (orn. 100.01.001).
   - Emin degilsen 120/320 yerine odeme hesabi sec veya null birak; yanlis cariye otomatik F2 en riskli hatadir.
   Cari kod listesinde firma YOKSA ama mukellef profilinde cari yoksa kullanilacak hesap/odeme hesabi tanimliysa (orn. 100.01.001), onu cariHesapKodu olarak oner.
   Profilde acik tanimli hesap kodu varsa ve fatura icerigiyle uyumluysa, dropdown sondaj listesinde gorunmese bile onu onerebilirsin; runner kodu yazarak secmeyi deneyecek.

ÇIKTI: JSON response'una "onerilenler" objesi ekle (AŞAĞIDAKİ JSON ŞEMASINA BAK).
       Emin olmadığın alanı null bırak. Yanlış tahmin etme — null daha güvenli.
       Confidence: her alan için 0-1 arası skor. 0.8 altındaki önerileri runner uygulamayacak.
` : ''
}

=== SEBEP YAZIM KURALI (ÇOK ÖNEMLİ) ===
İşlem yönü "${islemTuru}" — MÜKELLEF AÇISINDAN yazarken:
• ALIŞ ise: "mal alışı", "hizmet alışı", "gider kaydı", "tedarik" gibi terim kullan.
• SATIŞ ise: "mal satışı", "hizmet satışı", "gelir kaydı" gibi terim kullan.
• Karşı firmanın bakış açısını YAZMA. Mükellef ALIŞ yaparken "mal satışı geçerli" DEME, "mal alışı geçerli" de.
• "fatura geçerli" tarzı nötr ifadeler de olabilir.

=== STRUCTURED ALAN ÇIKARIMI ===
Fatura görüntüsünden şu alanları da çıkarıp JSON'a ekle (okunamazsa null):
• tarih: "DD.MM.YYYY" veya "DD-MM-YYYY" formatında
• belgeNo: fatura üzerindeki belge/fiş/ETTN numarası
• cari: fatura üzerindeki karşı tarafın tam ünvanı
• belgeTuru: "E_FATURA" | "E_ARSIV" | "FIS" | "IRSALIYE" (görüntüden tespit ettiğin)
• kdvOrani: "0" | "1" | "10" | "20" (ana KDV oranı, birden fazla varsa dominant olan)
• ocrToplam: faturadaki TOPLAM (ödenecek/genel toplam) tutarı, sayı olarak (örn: 3316.00). Para birimi/TL/virgül olmadan.
• ocrMatrah: faturadaki MATRAH (KDV hariç toplam) tutarı, sayı olarak. Birden fazla matrah varsa AYNI orandakileri topla.
• ocrKdvTutari: faturadaki TOPLAM KDV tutarı, sayı olarak.
NOT: Bu üç değer ÇOK ÖNEMLİ — Mihsap'a giriş hatası kontrolü için kullanılacak. Görüntüden tam okunmuyorsa null dön, asla tahmin etme.

Sadece JSON döndür: {
  "karar": "onay|atla|onay_bekliyor|emin_degil",
  "sebep": "mükellef açısından 80 karakter (onay_bekliyor ise net sebep: 'Sabit kıymet 253 olmalı', 'Faaliyet uymuyor' vb.)",
  "icerikSinifi": "Mal|Hizmet|Sabit Kıymet|Kira|Enerji/Sarf|Finansal" ,
  "ocrOzet": "1 satır",
  "tarih": "18.03.2026" | null,
  "belgeNo": "TEE2026000000384" | null,
  "cari": "Karşı Firma Tam Ünvanı" | null,
  "belgeTuru": "E_FATURA|E_ARSIV|FIS|IRSALIYE" | null,
  "kdvOrani": "20" | null,
  "ocrToplam": 3316.00 | null,
  "ocrMatrah": 2763.33 | null,
  "ocrKdvTutari": 552.67 | null${
    ['isle_satis', 'isle_alis', 'isle_satis_isletme', 'isle_alis_isletme'].includes(input.action || '') && input.bosAlanSecenekleri
      ? `,
  "onerilenler": {
    "matrahHesapKodu": "600.01.005" | null,
    "kdvHesapKodu": "391.01.006" | null,
    "cariHesapKodu": "120.01.ABC" | null,
    "confidence": { "matrah": 0.92, "kdv": 0.95, "cari": 0.75 }
  }`
      : ''
  }
}`;

    const userText = `Mükellef: ${input.mukellef || '?'} | Karşı firma: ${input.firma || '?'}
Kodlar: ${kodListe || '(boş)'} | Tarih: ${input.faturaTarihi || '?'} | Belge no: ${input.belgeNo || '?'}
Belge türü: ${input.belgeTuru || '?'} | Tutar: ${input.tutar || '?'} | Hedef ay: ${input.hedefAy || '?'}

Fatura görüntüsünü incele ve yukarıdaki sistem talimatlarına göre JSON döndür.`;

    const logUsage = (
      karar: string | undefined,
      sebep: string | undefined,
      usage?: any,
    ) => {
      const reasonText = [...aiCallReasons].join(',') || 'manuel_kontrol';
      return logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        taxpayerId: input.mukellefId || null,
        source: 'mihsap-fatura',
        model: MODEL,
        mukellef: input.mukellef,
        belgeNo: input.belgeNo,
        karar,
        sebep: `[reason=${reasonText}] ${sebep || ''}`.trim(),
        durationMs: Date.now() - startMs,
        cacheHit: false,
        usage,
      });
    };

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // v1.36.40: Prompt caching aktif — system prompt 5 dk cache'lenir.
          // Haiku 4.5 fiyatlama: cache write 1.25×, cache read 0.1× (10× ucuz).
          // Aynı islemTuru + benzer hesap planı ardışık çağrılarda input maliyeti düşer.
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: MODEL,
          // Öneri modunda cevap daha uzun (onerilenler JSON'u eklenir) → 900 token güvenli
          max_tokens: input.bosAlanSecenekleri ? 900 : 600,
          // v1.36.40: system'i array yap + cache_control ekle.
          // Tüm system bloğu önbelleğe alınır; benzer prefix'li çağrılar input maliyetinde
          // ~%80-90 tasarruf sağlar (cache hit halinde $1.0/M → $0.1/M).
          system: [
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.faturaImageMediaType || 'image/jpeg',
                    data: input.faturaImageBase64,
                  },
                },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        await logUsage('emin_degil', `API ${res.status}`);
        return { karar: 'emin_degil', sebep: `Claude API ${res.status}: ${errText.slice(0, 100)}` };
      }
      const json = await res.json();
      const text = json?.content?.[0]?.text || '';
      const usage = json?.usage || {};

      // JSON parse (çok katmanlı)
      const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const candidates: string[] = [];
      if (codeBlock) candidates.push(codeBlock[1]);
      const greedy = text.match(/\{[\s\S]*\}/);
      if (greedy) candidates.push(greedy[0]);
      const nonGreedy = text.match(/\{[\s\S]*?"karar"[\s\S]*?\}/);
      if (nonGreedy) candidates.push(nonGreedy[0]);

      // kategori key (Firma Hafizasi icin) — fatura modunda ilk hesap kodu
      // (Mihsap satirinda AI bu kodu onayladi sayilir). Liste bossa memory skip edilir.
      const ekranKategoriAdayi = (input.hesapKodlari?.[0] || '').trim();

      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c);
          if (parsed?.karar) {
            // === POST-PROCESSING: AI Hallüsinasyon Filtresi ===
            // AI "atla" dediğinde sebep'i kontrol et — geçersiz sebep varsa ONAY'a çevir.
            // Bunlar prompt'ta açıkça yasaklanmış ama AI bazen inatçı, burada override ediyoruz.
            if (parsed.karar === 'atla' && typeof parsed.sebep === 'string') {
              const sebepLower = parsed.sebep.toLowerCase();
              const gecersizSebepKaliplari = [
                'fatura tipi sati',      // "Fatura Tipi: SATIŞ" / "Fatura Tipi SATIŞ"
                'fatura tipi: sati',
                'satıcı: mükellef',      // "satıcı: Mükellef"
                'senaryo: ticari',       // e-fatura senaryo
                'senaryo:ticari',
                'senaryo ticari',
                'ettn',                  // ETTN numarası belge no değil
                'ubl-tr',                // XML versiyon
                'ubl tr 1',
                'tr 1.2',
                'tr1.2',
                'tr 1.3',
                'satış türü (satıcı',    // "SATIŞ türü (satıcı: Mükellef)"
              ];
              const gecersizMi = gecersizSebepKaliplari.some(k => sebepLower.includes(k));
              if (gecersizMi) {
                // AI hatalı atladı — override et, ONAY'a çevir
                const orijSebep = parsed.sebep;
                parsed.karar = 'onay';
                parsed.sebep = `F2 · otomatik onay (AI\'nın "${orijSebep.slice(0, 60)}" sebebi geçersiz — karşı firma yön bilgisi)`;
                parsed._overrideReason = 'ai-gecersiz-sebep';
              }
            }

            // Öneri mod: AI'nın önerdiği kodları gerçekten dropdown'da var mı ve
            // güven skoru >= 0.8 mi diye doğrula. Halüsinasyon korumasıdır.
            if (input.bosAlanSecenekleri && parsed.onerilenler) {
              parsed.onerilenler = this.applyCariPolicyToOneriler(
                parsed.onerilenler,
                input,
                rule?.profile,
              );
              parsed.onerilenler = this.sanitizeHesapKoduOnerileri(
                parsed.onerilenler,
                input.bosAlanSecenekleri,
              );
            }
            const memoryCategory = this.resolveFaturaMemoryCategory(parsed, ekranKategoriAdayi);
            const decisionTrace = {
              belge: {
                tarih: parsed.tarih || null,
                belgeNo: parsed.belgeNo || null,
                cari: parsed.cari || null,
                belgeTuru: parsed.belgeTuru || null,
                kdvOrani: parsed.kdvOrani ?? null,
                ocrToplam: parsed.ocrToplam ?? null,
                ocrMatrah: parsed.ocrMatrah ?? null,
                ocrKdvTutari: parsed.ocrKdvTutari ?? null,
              },
              ekran: {
                tarih: input.faturaTarihi || null,
                belgeNo: input.belgeNo || null,
                belgeTuru: input.belgeTuru || null,
                faturaTuru: input.faturaTuru || null,
                tutar: input.tutar ?? null,
                hesapKodlari: input.hesapKodlari || [],
              },
              karar: {
                sonuc: parsed.karar,
                sebep: parsed.sebep || null,
                icerikSinifi: parsed.icerikSinifi || null,
                memoryCategory: memoryCategory || null,
                vendorHintUsed: !!vendorHint,
              },
            };

            // === FIRMA HAFIZASI ENTEGRASYONU ===
            // Sadece AI "onay" derse memory'ye yansit. "atla"/"emin_degil" etkilemez.
            if (
              parsed.karar === 'onay' &&
              input.tenantId &&
              input.firmaKimlikNo &&
              memoryCategory
            ) {
              // Sapma var mi?
              if (vendorHint) {
                const sapma = this.vendorMemory.detectDeviation({
                  topKategoriler: vendorHint.topKategoriler,
                  aiKategori: memoryCategory,
                  aiAltKategori: null,
                });
                if (sapma.isSapma) {
                  // Onay kuyruguna dus, AI'yi otomatik islemeden durdur
                  try {
                    const pending = await this.pendingDecisions.create({
                      tenantId: input.tenantId,
                      taxpayerId: input.mukellefId || null,
                      mukellef: input.mukellef,
                      firmaKimlikNo: input.firmaKimlikNo,
                      firmaUnvan: input.firma,
                      belgeNo: input.belgeNo,
                      belgeTuru: input.belgeTuru,
                      faturaTarihi: input.faturaTarihi,
                      tutar: typeof input.tutar === 'number' ? input.tutar : (input.tutar ? Number(input.tutar) : null),
                      kararTipi: 'fatura',
                      aiKarari: { ...parsed, hesapKodu: memoryCategory, decisionTrace },
                      gecmisBeklenen: {
                        topKategoriler: vendorHint.topKategoriler,
                        enCok: sapma.enCokGecmisKategori,
                        enCokSayisi: sapma.enCokGecmisOnaySayisi,
                      },
                      sapmaSebep: sapma.sebep,
                      imageBase64: input.faturaImageBase64,
                    });
                    await logUsage('onay_bekliyor', sapma.sebep, usage);
                    return {
                      karar: 'onay_bekliyor',
                      sebep: sapma.sebep,
                      pendingId: pending.id,
                      sapmaSebep: sapma.sebep,
                    };
                  } catch (e: any) {
                    // Pending olusturma basarisizsa AI kararina gec — guvenli fallback
                    await logUsage(parsed.karar, `pending create failed: ${e?.message}`, usage);
                    return {
                      karar: 'onay_bekliyor',
                      sebep: `Onay kuyruğu oluşturulamadı: ${e?.message || 'bilinmeyen hata'}`,
                      decisionTrace,
                    };
                  }
                }
              }
              // Sapma yoksa hafiza kaydi burada yapilmaz; F2 basari log'u geldikten
              // sonra createEvent icinde kaydedilir.
            }
            // === /FIRMA HAFIZASI ===

            if (parsed.karar === 'onay' && memoryCategory) {
              parsed.faturaDecisionCandidate = {
                kararTipi: 'fatura',
                hesapKodu: memoryCategory,
                firmaKimlikNo: input.firmaKimlikNo || null,
                firmaUnvan: input.firma || null,
                taxpayerId: input.mukellefId || null,
              };
            }
      parsed.decisionTrace = decisionTrace;
      parsed.aiCallReason = [...aiCallReasons].join(',') || 'manuel_kontrol';
      this.faturaDecisionCache.set(decisionCacheKey, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        value: parsed,
      });
      await logUsage(parsed.karar, parsed.sebep, usage);
      return parsed;
          }
        } catch {}
      }

      const kararM = text.match(/"karar"\s*:\s*"(onay|atla|emin_degil)"/);
      const sebepM = text.match(/"sebep"\s*:\s*"([^"]{0,200})"/);
      if (kararM) {
        await logUsage(kararM[1], sebepM?.[1] || 'partial parse', usage);
        return { karar: kararM[1], sebep: sebepM?.[1] || 'partial parse', raw: text.slice(0, 200) };
      }

      await logUsage('emin_degil', 'JSON parse fail', usage);
      return { karar: 'emin_degil', sebep: 'JSON parse fail', raw: text.slice(0, 200) };
    } catch (e: any) {
      await logUsage('emin_degil', `Network: ${e?.message || 'unknown'}`);
      return { karar: 'emin_degil', sebep: `Network: ${e?.message || 'unknown'}` };
    }
  }

  /**
   * AI'nın önerdiği hesap kodlarını doğrular:
   *  - Kod gerçekten dropdown seçeneklerinde var mı? (halüsinasyon koruması)
   *  - Güven skoru MIN_CONFIDENCE (0.8) üstü mü? Değilse null.
   * Geçersiz öneri → null döner → runner bu alanı boş bırakıp atlar.
   */
  private sanitizeHesapKoduOnerileri(
    oneriler: any,
    secenekler: { matrahKodlari?: string[]; kdvKodlari?: string[]; cariKodlari?: string[] },
  ): any {
    const MIN_CONFIDENCE = 0.7;
    const conf = (oneriler?.confidence as Record<string, number>) || {};
    const validateKod = (
      kod: any,
      izinliListe: string[] | undefined,
      guvenSkoru: number | undefined,
    ): string | null => {
      if (!kod || typeof kod !== 'string') return null;
      const trimmed = kod.trim();
      if (!trimmed) return null;
      // Listede yoksa halüsinasyon → reddet
      if (!izinliListe || izinliListe.length === 0) return null;
      if (!izinliListe.includes(trimmed)) return null;
      // Güven düşükse → reddet
      if (typeof guvenSkoru === 'number' && guvenSkoru < MIN_CONFIDENCE) return null;
      return trimmed;
    };
    return {
      matrahHesapKodu: validateKod(oneriler?.matrahHesapKodu, secenekler.matrahKodlari, conf.matrah),
      kdvHesapKodu: validateKod(oneriler?.kdvHesapKodu, secenekler.kdvKodlari, conf.kdv),
      cariHesapKodu: validateKod(oneriler?.cariHesapKodu, secenekler.cariKodlari, conf.cari),
      confidence: conf,
    };
  }

  private applyCariPolicyToOneriler(
    oneriler: any,
    input: { firma?: string; action?: string; bosAlanSecenekleri?: { cariKodlari?: string[] } },
    profile: any,
  ): any {
    if (!oneriler || !profile) return oneriler;
    const policy = String(profile.cariTakipPolitikasi || '').trim();
    if (!policy || policy === 'hepsi_cari') return oneriler;

    const selected = typeof oneriler.cariHesapKodu === 'string' ? oneriler.cariHesapKodu.trim() : '';
    const selectedCari = /^(120|320)\./.test(selected);
    if (!selectedCari) return oneriler;

    const firma = this.normalizeCariName(input.firma || '');
    const listed = this.isFirmaInSurekliTedarikciler(firma, profile.surekliTedarikciler);
    if (listed) return oneriler;

    if (policy === 'cari_yoksa_onay') {
      const next = { ...oneriler, confidence: { ...(oneriler.confidence || {}) } };
      next.cariHesapKodu = null;
      next.confidence.cari = 0;
      next._cariPolicyOverride = `non-listed vendor requires approval: ${selected}`;
      return next;
    }

    const allowed = input.bosAlanSecenekleri?.cariKodlari || [];
    const candidates = [
      profile.cariYoksaHesap,
      input.action === 'isle_satis' || input.action === 'isle_satis_isletme'
        ? profile.tahsilatHesabi
        : profile.odemeHesabi,
      profile.odemeHesabi,
      profile.tahsilatHesabi,
      '100.01.001',
      '102.01.001',
    ]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());

    const preferred = candidates.find((code) => allowed.includes(code));
    const next = { ...oneriler, confidence: { ...(oneriler.confidence || {}) } };
    if (preferred) {
      next.cariHesapKodu = preferred;
      next.confidence.cari = Math.max(Number(next.confidence.cari) || 0, 0.95);
      next._cariPolicyOverride = `non-listed vendor: ${selected} -> ${preferred}`;
    } else {
      next.cariHesapKodu = null;
      next.confidence.cari = 0;
      next._cariPolicyOverride = `non-listed vendor blocked: ${selected}`;
    }
    return next;
  }

  private isFirmaInSurekliTedarikciler(firma: string, surekliTedarikciler: any): boolean {
    if (!firma || typeof surekliTedarikciler !== 'string') return false;
    return surekliTedarikciler
      .split(/[\n,;]+/)
      .map((v) => this.normalizeCariName(v))
      .filter((v) => v.length >= 4)
      .some((name) => firma.includes(name) || name.includes(firma));
  }

  private normalizeCariName(value: string): string {
    return value
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(ANONIM|LIMITED|SIRKETI|SIRKET|TICARET|SANAYI|VE|A S|LTD|STI)\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private resolveFaturaMemoryCategory(parsed: any, ekranKategoriAdayi: string): string {
    const direct =
      parsed?.hesapKodu ||
      parsed?.kategori ||
      parsed?.matrahHesapKodu ||
      parsed?.onerilenler?.matrahHesapKodu ||
      ekranKategoriAdayi;
    return typeof direct === 'string' ? direct.trim() : '';
  }

  /**
   * Claude ile İşletme Defteri bloğu için Kayıt Türü + K. Alt Türü seçimi.
   * Input: fatura görüntüsü + ekranda mevcut seçenekler.
   * Output: { kayitTuru?, altTuru?, emin: true|false, sebep }
   * Emin değilse (kayitTuru veya altTuru eşleşmezse) karar=atla.
   */
  async decideIsletme(input: {
    faturaImageBase64: string;
    faturaImageMediaType?: string;
    kayitTuruOptions: string[];
    altTuruOptions: string[];
    faturaTarihi?: string;
    belgeNo?: string;
    belgeTuru?: string;
    faturaTuru?: string;
    mukellef?: string;
    mukellefId?: string; // YENİ: Taxpayer.id — Firma Hafızası mükellef-bazlı öğrenme için
    firma?: string;
    firmaKimlikNo?: string; // Karsi firma VKN/TCKN — Firma Hafizasi icin
    tutar?: number | string;
    action?: string;
    matrah?: string | number;
    kdv?: string;
    blokIndex?: number;
    blokToplam?: number;
    tenantId?: string;
  }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { emin: false, sebep: 'ANTHROPIC_API_KEY yok' };
    }

    const SATIS_ACTIONS = ['isle_satis', 'isle_satis_isletme'];
    const ALIS_ACTIONS = ['isle_alis', 'isle_alis_isletme'];
    const islemTuru = SATIS_ACTIONS.includes(input.action || '')
      ? 'SATIŞ'
      : ALIS_ACTIONS.includes(input.action || '')
      ? 'ALIŞ'
      : 'ALIŞ';

    // Mükellef ID eksikse mükellef adından bul (Firma Hafızası mükellef-bazlı)
    if (!input.mukellefId && input.tenantId && input.mukellef) {
      try {
        const mukellefAd = input.mukellef.trim();
        const taxpayer = await this.prisma.taxpayer.findFirst({
          where: {
            tenantId: input.tenantId,
            OR: [
              { companyName: { equals: mukellefAd, mode: 'insensitive' } },
              { companyName: { contains: mukellefAd, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (taxpayer) input.mukellefId = taxpayer.id;
      } catch {}
    }

    // Mükellef profili (yapılandırılmış + sistem kuralları)
    let mukellefTalimat = '';
    if (input.tenantId && input.mukellef) {
      try {
        const rule = await this.prisma.agentRule.findUnique({
          where: { tenantId_mukellef: { tenantId: input.tenantId, mukellef: input.mukellef } },
        });
        if (rule?.profile) {
          mukellefTalimat = profileToPromptText(rule.profile);
        }
      } catch {}
    }

    // Firma Hafizasi hint — isletme defteri modu icin (kayitTuru + altTuru kombinasyonu)
    let vendorHintIsletme: Awaited<ReturnType<VendorMemoryService['getHintForVendor']>> = null;
    if (input.tenantId && input.firmaKimlikNo) {
      try {
        vendorHintIsletme = await this.vendorMemory.getHintForVendor(
          input.tenantId,
          input.firmaKimlikNo,
          'isletme',
          input.mukellefId || null, // Mükellef-bazlı hint
        );
      } catch {}
    }

    const kayitListe = input.kayitTuruOptions.filter(Boolean).join(' | ');
    const altListe = input.altTuruOptions.filter(Boolean).join(' | ');

    const system = `Sen bir işletme defteri kayıt kategorisi seçicisin. Fatura görüntüsüne bakıp bir blok için Kayıt Türü ve K. Alt Türü karar vereceksin.
${vendorHintIsletme ? '\n' + vendorHintIsletme.hintText : ''}
### İŞLEM BAĞLAMI ###
İşlem yönü: ${islemTuru}  (ALIŞ = alış/gider, SATIŞ = satış/gelir)
Blok: ${input.blokIndex || 1}/${input.blokToplam || 1}
Ekrandaki fatura türü: ${input.faturaTuru || '?'} | Belge türü: ${input.belgeTuru || '?'}
Ekrandaki blok matrah: ${input.matrah ?? '?'} | KDV: ${input.kdv || '?'}

### MEVCUT SEÇENEKLER (sadece bu listeden seç, eşleştiremezsen emin_degil) ###
Kayıt Türü seçenekleri: ${kayitListe || '(boş)'}
K. Alt Türü seçenekleri: ${altListe || '(boş)'}

### KAYIT TÜRÜ SEÇİM KURALLARI (ÇOK ÖNEMLİ) ###

**VARSAYILAN YOK.** Emin değilsen → emin:false. Tahmin etme, "En yakın" diye alakasız kategori seçme.

**"Mal Alışı" SADECE şu durumlarda kullanılır:**
- Mükellef bir MARKET, BÜFE, BAKKAL, TOPTAN SATIŞ veya PERAKENDE TİCARET işletmesiyse VE
- Faturadaki ürünler mükellefin SATIŞ AMAÇLI aldığı TİCARİ EMTIA ise (raftan satacağı ürünler)
- Örnek: Büfe sahibi → toptancıdan çikolata/içecek alışı = Mal Alışı
- Örnek: Büfe sahibi → elektrik faturası = İndirilecek Giderler (Mal Alışı DEĞİL!)

**"Mal Alışı" KULLANILMAZ şu durumlarda:**
- Mağazadan/marketten kendi kullanım için alışveriş (ofis malzemesi, temizlik vb.)
- Akaryakıt, kira, telefon, internet, sigorta, muhasebe ücreti
- Yemek, konaklama, ulaşım giderleri
- Herhangi bir HİZMET faturası

**"Sabit Kıymet Alışı":** Bilgisayar, araç, makine, ofis mobilyası gibi uzun ömürlü varlıklar
**"Gider Kabul Edilmeyen Ödemeler (GVK Md. 41)":** Cezalar, bağışlar, kişisel harcamalar
**"İndirilecek Giderler (GVK Md. 40)":** Fatura içeriği SOMUT bir gider kalemiyse (akaryakıt, telefon, kira, yemek, vb.)

### K. ALT TÜRÜ SEÇİM KURALLARI — SOMUT KALEMLE EŞLEŞME ZORUNLU ###
Fatura içeriği → alt tür (birebir eşleşme olmalı):
- Akaryakıt/benzin/mazot/LPG → "Taşıt Akaryakıt Giderleri (GVK 40/1-40/5)"
- Telefon/GSM → "Telefon Giderleri (GVK 40/1)"
- Elektrik → "Elektrik Giderleri (GVK 40/1)"
- Doğalgaz → "Doğalgaz/Isınma Giderleri (GVK 40/1)" (listedeyse)
- Su → "Su Giderleri (GVK 40/1)" (listedeyse)
- Kırtasiye/kalem/defter → "Kırtasiye Harcamaları (GVK 40/1)"
- Yemek/gıda/baklava/pasta/kebap/lokanta → "Gıda Harcamaları (GVK 40/1-40/2)" veya "Temsil ve Ağırlama Gideri (İş yemeği vb.) (GVK 40/1)"
- Ofis temizlik/çay/kahve/şeker → "Ofis Giderleri(Çay, Kahve, Şeker, Temizlik vb.) (GVK 40/1)"
- Muhasebe/mali müşavir → "Muhasebe/Mali Müşavirlik Giderleri (GVK 40/1)"
- Kira/işyeri kirası → "Kira Giderleri (GVK 40/1)"
- İnternet → "İnternet Giderleri (GVK 40/1)"
- Mal Alışı için alt tür genellikle "Mal Alışı" (aynı isim)

### GENEL KURALLAR ###
1. Emin olduğun değerler MEVCUT SEÇENEKLER'de birebir var olmalı (karakter karakter). Yoksa emin:false.
2. Fatura görüntüsü okunamıyorsa → emin:false
3. ÖKC fişi / perakende satış fişi içeriği okunamıyorsa → emin:false (kesinlikle "Diğer" demiyorsun)
4. Makul çıkarım yapabilirsin (OPET = akaryakıt, TURKCELL = telefon). Ama MARKA TANIMLAMADIYSAN → emin:false.

### ⛔ MUTLAK YASAKLAR ⛔ ###
× Listede olmayan değer üretmek
× "Belki", "muhtemelen", "sanırım" ile emin=true demek
× **"Diğer" içeren HERHANGİ BİR kategori seçmek** (ör: "Diğer (GVK 40/1)", "Diğer Giderler", "Diğer Gelir", "Diğer Hasılat", "Diğer Sabit Kıymet Alışı")
  → İçerik bu somut kalemlerden birine denk gelmiyorsa **emin:false** dön. "Diğer" seçmektense atla.
× İçerik okunamıyorsa herhangi bir tahminle kategori seçmek — emin:false

${mukellefTalimat ? `### MÜKELLEF ÖZEL TALİMATI ###\n${mukellefTalimat}\n` : ''}

### STRUCTURED ALAN ÇIKARIMI ###
Fatura görüntüsünden şu alanları çıkarıp JSON'a da ekle (okunamazsa null):
• tarih: "DD.MM.YYYY" formatında
• belgeNo: fatura/fiş numarası
• cari: fatura üzerindeki karşı firma tam ünvanı
• belgeTuru: "E_FATURA" | "E_ARSIV" | "FIS" | "IRSALIYE"
• kdvOrani: "0" | "1" | "10" | "20"

### SEBEP YAZIM KURALI ###
Sebep yazarken MÜKELLEF AÇISINDAN yaz (işlem yönü "${islemTuru}"):
• ALIŞ ise "gider/alış" terimleri kullan, karşı firmanın "satış" ifadesini YAZMA.
• SATIŞ ise "gelir/satış" terimleri kullan.

### ÇIKTI ###
Sadece JSON: {"emin":true,"kayitTuru":"<liste değeri>","altTuru":"<liste değeri>","sebep":"60 karakter","tarih":"DD.MM.YYYY"|null,"belgeNo":"..."|null,"cari":"..."|null,"belgeTuru":"..."|null,"kdvOrani":"..."|null}
veya: {"emin":false,"sebep":"60 karakter","tarih":null,"belgeNo":null,"cari":null,"belgeTuru":null,"kdvOrani":null}`;

    const userText = `Mükellef: ${input.mukellef || '?'} | Karşı firma: ${input.firma || '?'}
Belge no: ${input.belgeNo || '?'} | Tarih: ${input.faturaTarihi || '?'} | Tutar: ${input.tutar || '?'}
Blok matrah: ${input.matrah ?? '?'} | KDV: ${input.kdv || '?'}

Fatura görüntüsünü incele. Yukarıdaki MEVCUT SEÇENEKLER'den Kayıt Türü + K. Alt Türü seç ya da emin:false dön.`;

    const startMs = Date.now();
    const MODEL = 'claude-haiku-4-5-20251001';
    const logUsage = (
      karar: string | undefined,
      sebep: string | undefined,
      usage?: any,
    ) =>
      logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        source: 'mihsap-isletme',
        model: MODEL,
        mukellef: input.mukellef,
        belgeNo: input.belgeNo,
        karar,
        sebep,
        durationMs: Date.now() - startMs,
        usage,
      });

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // v1.36.40: Prompt caching aktif (decideIsletme).
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 500,
          system: [
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.faturaImageMediaType || 'image/jpeg',
                    data: input.faturaImageBase64,
                  },
                },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        await logUsage('emin_degil', `API ${res.status}`);
        return { emin: false, sebep: `Claude API ${res.status}: ${errText.slice(0, 80)}` };
      }
      const json = await res.json();
      const text = json?.content?.[0]?.text || '';
      const usage = json?.usage || {};

      const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const candidates: string[] = [];
      if (codeBlock) candidates.push(codeBlock[1]);
      const greedy = text.match(/\{[\s\S]*\}/);
      if (greedy) candidates.push(greedy[0]);

      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c);
          if (typeof parsed?.emin === 'boolean') {
            // Sanity: seçilen değerler gerçekten listede mi?
            if (parsed.emin) {
              // ⛔ "Diğer" kategorisi yasağı — AI prompt'a rağmen "Diğer..." dediyse override et, atla
              const isDigerKayit = /diger|diğer/i.test(String(parsed.kayitTuru || ''));
              const isDigerAlt = /diger|diğer/i.test(String(parsed.altTuru || ''));
              if (isDigerKayit || isDigerAlt) {
                await logUsage(
                  'emin_degil',
                  `Diğer kategorisi yasağı: kayit=${parsed.kayitTuru} alt=${parsed.altTuru}`,
                  usage,
                );
                return {
                  emin: false,
                  sebep: `AI "Diğer" kategorisi seçti, atlandı (kayit=${parsed.kayitTuru}, alt=${parsed.altTuru})`,
                };
              }

              // 2-aşamalı yaklaşım: ilk çağrıda altTuruOptions boş gönderilir (sadece kayıt kararı).
              // Bu durumda altTuru validasyonunu atla.
              const inKayit = input.kayitTuruOptions.length === 0 || input.kayitTuruOptions.includes(parsed.kayitTuru);
              const altListeVar = input.altTuruOptions && input.altTuruOptions.length > 0;
              const inAlt = !altListeVar || input.altTuruOptions.includes(parsed.altTuru);
              if (!inKayit || !inAlt) {
                await logUsage('emin_degil', `liste dışı: kayit=${inKayit} alt=${inAlt}`, usage);
                return {
                  emin: false,
                  sebep: `AI liste dışı değer döndü (kayit=${parsed.kayitTuru}, alt=${parsed.altTuru})`,
                };
              }

              // === FIRMA HAFIZASI ENTEGRASYONU (isletme modu) ===
              // Sadece tam karar (hem kayitTuru hem altTuru belli) + firma VKN varsa
              const altTuruKey = altListeVar ? (parsed.altTuru || '').trim() : null;
              if (
                input.tenantId &&
                input.firmaKimlikNo &&
                parsed.kayitTuru
              ) {
                if (vendorHintIsletme) {
                  const sapma = this.vendorMemory.detectDeviation({
                    topKategoriler: vendorHintIsletme.topKategoriler,
                    aiKategori: String(parsed.kayitTuru),
                    aiAltKategori: altTuruKey,
                  });
                  if (sapma.isSapma) {
                    try {
                      const pending = await this.pendingDecisions.create({
                        tenantId: input.tenantId,
                        mukellef: input.mukellef,
                        firmaKimlikNo: input.firmaKimlikNo,
                        firmaUnvan: input.firma,
                        belgeNo: input.belgeNo,
                        belgeTuru: input.belgeTuru,
                        faturaTarihi: input.faturaTarihi,
                        tutar: typeof input.tutar === 'number' ? input.tutar : (input.tutar ? Number(input.tutar) : null),
                        kararTipi: 'isletme',
                        aiKarari: parsed,
                        gecmisBeklenen: {
                          topKategoriler: vendorHintIsletme.topKategoriler,
                          enCok: sapma.enCokGecmisKategori,
                          enCokSayisi: sapma.enCokGecmisOnaySayisi,
                        },
                        sapmaSebep: sapma.sebep,
                        imageBase64: input.faturaImageBase64,
                      });
                      await logUsage('onay_bekliyor', sapma.sebep, usage);
                      return {
                        emin: false,
                        karar: 'onay_bekliyor',
                        sebep: sapma.sebep,
                        pendingId: pending.id,
                        sapmaSebep: sapma.sebep,
                      };
                    } catch (e: any) {
                      // Fallback: pending olusmazsa normal AI kararini don
                      await logUsage('onay', `pending create failed: ${e?.message}`, usage);
                      return parsed;
                    }
                  }
                }
                // Sapma yok → memory'ye kaydet
                try {
                  await this.vendorMemory.recordDecision({
                    tenantId: input.tenantId,
                    firmaKimlikNo: input.firmaKimlikNo,
                    firmaUnvan: input.firma,
                    kararTipi: 'isletme',
                    kategori: String(parsed.kayitTuru),
                    altKategori: altTuruKey,
                    taxpayerId: input.mukellefId || null,
                  });
                } catch {}
              }
              // === /FIRMA HAFIZASI ===
            }
            await logUsage(parsed.emin ? 'onay' : 'emin_degil', parsed.sebep, usage);
            return parsed;
          }
        } catch {}
      }

      await logUsage('emin_degil', 'JSON parse fail', usage);
      return { emin: false, sebep: 'JSON parse fail', raw: text.slice(0, 200) };
    } catch (e: any) {
      await logUsage('emin_degil', `Network: ${e?.message || 'unknown'}`);
      return { emin: false, sebep: `Network: ${e?.message || 'unknown'}` };
    }
  }

  // USD/TRY kur cache'i — TCMB'den günde 1 kez çekilir
  private usdTryCache: { rate: number; fetchedAt: Date } | null = null;

  private async getUsdTryRate(): Promise<number> {
    const now = new Date();
    // 6 saatten eski ise yeniden çek
    if (
      this.usdTryCache &&
      now.getTime() - this.usdTryCache.fetchedAt.getTime() < 6 * 60 * 60 * 1000
    ) {
      return this.usdTryCache.rate;
    }
    try {
      const res = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const xml = await res.text();
        // <Currency Kod="USD"> ... <ForexSelling>X.XXXX</ForexSelling>
        const usdBlock = xml.match(/<Currency[^>]*Kod="USD"[\s\S]*?<\/Currency>/);
        if (usdBlock) {
          const sell = usdBlock[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
          const rate = sell ? parseFloat(sell[1]) : NaN;
          if (!isNaN(rate) && rate > 0) {
            this.usdTryCache = { rate, fetchedAt: now };
            return rate;
          }
        }
      }
    } catch {
      // TCMB erişilmezse (hafta sonu / tatil) önceki cache varsa kullan
    }
    if (this.usdTryCache) return this.usdTryCache.rate;
    // Hiç değer yoksa makul bir fallback (env'den de okunur)
    return parseFloat(process.env.USD_TRY_FALLBACK || '40');
  }

  /**
   * AI kullanım istatistikleri — panel widget'ı için.
   * Bugün / Bu ay / Toplam istatistikleri döner.
   */
  async getAiUsageStats(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const aggregate = async (since?: Date) => {
      const where: any = { tenantId };
      if (since) where.createdAt = { gte: since };
      const rows = await (this.prisma as any).aiUsageLog.findMany({
        where,
        select: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          costUsd: true,
          karar: true,
          cacheHit: true,
        },
      });
      const acc = {
        sorguSayisi: rows.length,
        cacheHitSayisi: 0,
        gercekCagriSayisi: 0,
        onaySayisi: 0,
        atlaSayisi: 0,
        eminDegilSayisi: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toplamToken: 0,
        maliyetUsd: 0,
      };
      for (const r of rows) {
        if (r.cacheHit) acc.cacheHitSayisi++;
        else acc.gercekCagriSayisi++;
        if (r.karar === 'onay') acc.onaySayisi++;
        else if (r.karar === 'atla') acc.atlaSayisi++;
        else acc.eminDegilSayisi++;
        acc.inputTokens += r.inputTokens || 0;
        acc.outputTokens += r.outputTokens || 0;
        acc.cacheReadTokens += r.cacheReadTokens || 0;
        acc.cacheWriteTokens += r.cacheWriteTokens || 0;
        acc.maliyetUsd += r.costUsd || 0;
      }
      acc.toplamToken = acc.inputTokens + acc.outputTokens + acc.cacheReadTokens + acc.cacheWriteTokens;
      return acc;
    };

    // Topup toplamı (yüklenmiş kontör)
    const topupAgg = async () => {
      const rows = await (this.prisma as any).aiCreditTopup.findMany({
        where: { tenantId },
        select: { amountUsd: true },
      });
      return rows.reduce((s: number, r: any) => s + (r.amountUsd || 0), 0);
    };

    const [bugun, buAy, toplam, usdTry, toplamYuklenenUsd] = await Promise.all([
      aggregate(todayStart),
      aggregate(monthStart),
      aggregate(),
      this.getUsdTryRate(),
      topupAgg(),
    ]);

    const kalanBakiyeUsd = Math.max(0, toplamYuklenenUsd - toplam.maliyetUsd);

    return {
      bugun,
      buAy,
      toplam,
      usdTry,
      bakiye: {
        toplamYuklenenUsd,
        toplamHarcananUsd: toplam.maliyetUsd,
        kalanBakiyeUsd,
      },
      updatedAt: now,
    };
  }

  /** Kontör yükleme kaydı ekle */
  async addCreditTopup(tenantId: string, userId: string | null, amountUsd: number, note?: string) {
    if (!amountUsd || amountUsd <= 0) {
      throw new Error('amountUsd > 0 olmalı');
    }
    return (this.prisma as any).aiCreditTopup.create({
      data: {
        tenantId,
        amountUsd,
        note: note || null,
        addedBy: userId,
      },
    });
  }

  /** Kontör yükleme geçmişi */
  async listCreditTopups(tenantId: string, limit = 50) {
    return (this.prisma as any).aiCreditTopup.findMany({
      where: { tenantId },
      orderBy: { addedAt: 'desc' },
      take: limit,
    });
  }

  async updateCommand(
    tenantId: string,
    id: string,
    data: { status?: string; result?: any },
  ) {
    const finishedAt = data.status === 'done' || data.status === 'failed' ? new Date() : undefined;
    return this.prisma.agentCommand.update({
      where: { id },
      data: { ...data, finishedAt } as any,
    });
  }

  /** Mihsap'tan çekilen mükellefleri toplu upsert (taxNumber ile eşle) */
  async bulkImportTaxpayers(
    tenantId: string,
    taxpayers: Array<{
      type: string;
      taxNumber: string;
      taxOffice?: string;
      companyName?: string;
      firstName?: string;
      lastName?: string;
      mihsapId?: string;
      mihsapDefterTuru?: string;
      lucaSlug?: string;
    }>,
  ) {
    const created: string[] = [];
    const updated: string[] = [];
    const errors: Array<{ taxNumber: string; error: string }> = [];

    for (const t of taxpayers) {
      if (!t.taxNumber || t.taxNumber.length < 10) {
        errors.push({ taxNumber: t.taxNumber || '(bos)', error: 'gecersiz vergi no' });
        continue;
      }
      try {
        const existing = await this.prisma.taxpayer.findFirst({
          where: { tenantId, taxNumber: t.taxNumber },
          select: { id: true },
        });
        const data: any = {
          tenantId,
          type: t.type as any,
          taxNumber: t.taxNumber,
          taxOffice: t.taxOffice || '-',
          companyName: t.companyName || null,
          firstName: t.firstName || null,
          lastName: t.lastName || null,
          mihsapId: t.mihsapId || null,
          mihsapDefterTuru: t.mihsapDefterTuru || null,
          lucaSlug: t.lucaSlug || null,
        };
        if (existing) {
          await this.prisma.taxpayer.update({ where: { id: existing.id }, data });
          updated.push(t.taxNumber);
        } else {
          await this.prisma.taxpayer.create({ data });
          created.push(t.taxNumber);
        }
      } catch (e: any) {
        errors.push({ taxNumber: t.taxNumber, error: e?.message ?? 'unknown' });
      }
    }
    return { created: created.length, updated: updated.length, errors };
  }
}
