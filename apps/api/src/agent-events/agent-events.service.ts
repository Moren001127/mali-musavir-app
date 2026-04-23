import { Injectable } from '@nestjs/common';
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

    return this.prisma.agentEvent.create({
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

    // v1.14.1 — action filtresi kaldırıldı. Eski extension kayıtlarında
    // action NULL geliyordu, onlar da yoksayılıyordu. Şimdi action varsa
    // alış/satış olarak ayır, yoksa "atlanan" sayacında say (bilinmiyor).
    const rows = await this.prisma.agentEvent.findMany({
      where: {
        tenantId,
        agent,
        status: { in: SUCCESS_STATUSES },
        ts: { gte: periodStart, lt: periodEnd },
        mukellef: { not: null },
      },
      select: { mukellef: true, action: true, status: true },
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
    const { perMukellef: maliyetMap, digerUsd, toplamAiUsd } =
      await this.aiMaliyetByMukellef(tenantId, periodStart, periodEnd);

    const items = Array.from(map.entries())
      .map(([mukellef, counts]) => ({
        mukellef,
        alis: counts.alis,
        satis: counts.satis,
        atlanan: counts.atlanan,
        toplam: counts.alis + counts.satis,
        maliyetUsd: Number((maliyetMap.get(mukellef) || 0).toFixed(4)),
      }))
      .sort((a, b) => b.toplam - a.toplam);

    const toplam = items.reduce(
      (acc, i) => ({
        alis: acc.alis + i.alis,
        satis: acc.satis + i.satis,
        toplam: acc.toplam + i.toplam,
        mukellefSayisi: acc.mukellefSayisi + 1,
        maliyetUsd: acc.maliyetUsd + i.maliyetUsd,
      }),
      { alis: 0, satis: 0, toplam: 0, mukellefSayisi: 0, maliyetUsd: 0 },
    );
    // Toplam maliyete mukellef-bağsız harcamayı da ekle (Toplam Maliyet kpi için).
    // Eski extension kayıtları mukellef field'ı yok — yine de ödendiği gerçek.
    toplam.maliyetUsd = Number((toplamAiUsd || (toplam.maliyetUsd + digerUsd)).toFixed(4));

    return {
      period: { year, month },
      toplam,
      items,
      maliyet: {
        toplamAiUsd: Number((toplamAiUsd || 0).toFixed(4)),
        mukellefBagliUsd: Number((toplam.maliyetUsd - digerUsd).toFixed(4)),
        digerUsd: Number((digerUsd || 0).toFixed(4)),
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
  ): Promise<{ perMukellef: Map<string, number>; digerUsd: number; toplamAiUsd: number }> {
    const perMukellef = new Map<string, number>();
    let digerUsd = 0;
    let toplamAiUsd = 0;
    try {
      const rows = await this.prisma.aiUsageLog.findMany({
        where: {
          tenantId,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        select: { costUsd: true, mukellef: true },
      });
      for (const r of rows) {
        const cost = Number(r.costUsd || 0);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        toplamAiUsd += cost;
        const muk = (r.mukellef || '').trim();
        if (muk) {
          perMukellef.set(muk, (perMukellef.get(muk) || 0) + cost);
        } else {
          digerUsd += cost;
        }
      }
    } catch (e) {
      console.warn('[summary-by-mukellef] aiMaliyetByMukellef hatası:', e);
    }
    return { perMukellef, digerUsd, toplamAiUsd };
  }

  async upsertStatus(tenantId: string, agent: string, data: { running?: boolean; hedefAy?: string; meta?: any }) {
    return this.prisma.agentStatus.upsert({
      where: { tenantId_agent: { tenantId, agent } },
      update: { ...data, lastPing: new Date() },
      create: { tenantId, agent, ...data },
    });
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

  /** Yerel runner için bekleyen komutları claim eder (status=running yapar) */
  async claimPendingCommands(tenantId: string, agent?: string) {
    const where: any = { tenantId, status: 'pending' };
    if (agent) where.agent = agent;
    const pending = await this.prisma.agentCommand.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    if (pending.length === 0) return [];
    await this.prisma.agentCommand.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: 'running', startedAt: new Date() },
    });
    return pending;
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
    // Firma Hafızası "mükellef atanmamış" yerine gerçek mükellef-bazlı öğrenir.
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

    // Mükellef profili — yapılandırılmış (sektör, KDV hesapları, tahsilat vs.)
    // + serbest talimat + sistem kuralları (tevkifat / kasa limit).
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

    const system = `Sen bir fatura doğrulayıcısın. VARSAYILAN KARAR: ONAY.

### ÖNCELİKLİ KURAL — HER ŞEYDEN ÖNCE OKU ###
Fatura satırında şu ifadelerden HERHANGİ BİRİ geçiyorsa: "nakliye bedeli", "nakliyat bedeli", "taşıma bedeli", "sevk bedeli", "sefer bedeli", "taşımacılık bedeli", "lojistik bedeli", "nakliye ücreti", "nakl bedeli" → KARAR: ONAY.
BU CÜMLELERDE "aracın", "araç", "plaka", "otomobil", "kamyon", "tır" KELİMELERİ GEÇSE DAHİ → ONAY.
"aracın nakliye bedeli" = NAKLİYE HİZMETİ FATURASIDIR, ARAÇ SATIŞI DEĞİLDİR. Bunu "araç satışı" diye yorumlamak YASAK.
"34XXX YYY PLAKALI ARACIN [güzergah] NAKLIYE BEDELİ" formatı = nakliye faturası = ONAY.
Bu kurala uymayan ATLA kararları KESİNLİKLE geçersizdir.
### /ÖNCELİKLİ KURAL ###

Sadece aşağıdaki KESİN ATLA LİSTESİ'nden biri varsa atla. Yoksa ONAY. Görüntü okunamazsa emin_degil.

=== BACKEND ZATEN DOĞRULADI (sorgulama) ===
İşlem modu: ${islemTuru} | Kodlar: ${codesArr.join(', ')} | Kod türü: ${codeType}
Ekrandaki fatura türü: ${input.faturaTuru || '?'} | Belge türü: ${input.belgeTuru || '?'}
Mod-kod uyumu: TAMAM. Tarih ayı: TAMAM. Alış/satış yönü: TAMAM.

=== KESİN ATLA LİSTESİ (yalnızca bu 6 durumda atla) ===

[A] TARİH FARKLI: MIHSAP ekranındaki tarih (${input.faturaTarihi || '?'}) ile fatura görüntüsündeki tarih AYNI GÜN DEĞİL.
    → Gün/ay/yıl üçünden biri farklıysa atla. Okuyamazsan bu kontrolü GEÇ (atlama).

[B] KDV ORANI FARKLI: Faturadaki KDV oranı (%1/%10/%20) ile ekrandaki KDV oranı eşleşmiyor.
    → Farklıysa atla. Okuyamazsan bu kontrolü GEÇ.

[C] CARİ FİRMA TAMAMEN FARKLI: Ekrandaki firma ile fatura karşı tarafı BAŞKA ŞİRKET (örn. "Ahmet Ltd" vs "Mehmet AŞ").
    → Kısaltma/uzun ad/unvan farkı (LTD ŞTİ vs LİMİTED ŞİRKETİ) önemsiz — ONAY.
    → Bariz farklı şirket isimleriyse atla.

[D] BELGE NO FARKLI: Ekrandaki belge no (${input.belgeNo || '?'}) ile fatura üzerindeki no FARKLI.
    → Farklıysa atla. Okuyamazsan bu kontrolü GEÇ.

[E] AÇIK DEMİRBAŞ/ARAÇ/İADE SATIŞI:
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
× "Alış/satış kodu çelişkisi" / "Sektör uyumsuz"
× "Fatura içeriği matrah koduyla uyumsuz" — içerik-kod kontrolünü YAPMA, backend yapıyor
× "Nakliye firması ama nakliye alıyor/veriyor" — yorum yapma
× "Backend X demiş ama görüntüde Y" cümlesi kurma — backend doğru
× Plaka/güzergah/rota görünce araç satışı çıkarımı
× "Mükellef talimatında..." referansları — talimatı yorumlama
× "Emin değilim ama ihtimal..." — şüpheliyse direkt ONAY

=== KARAR AKIŞI ===
1. [A][B][C][D][E]'den herhangi biri KESİN olarak görüldü mü? → atla
2. Görüntü tamamen okunamıyor mu? → emin_degil
3. Diğer tüm durumlarda → onay

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
  // Sadece Bilanço SATIŞ modunda ve boş alan seçeneği verildiyse öneri bölümünü ekle
  input.action === 'isle_satis' && input.bosAlanSecenekleri &&
  ((input.bosAlanSecenekleri.matrahKodlari?.length || 0) +
   (input.bosAlanSecenekleri.kdvKodlari?.length || 0) +
   (input.bosAlanSecenekleri.cariKodlari?.length || 0)) > 0
  ? `
=== HESAP KODU ÖNERİSİ — BİLANÇO SATIŞ ===
Runner bu faturada BOŞ alan tespit etti. Dropdown'daki mevcut seçeneklerden doğru kodu sen seçeceksin.
Mevcut seçenekler aşağıda. HER ALAN İÇİN tam olarak bu listelerden BİRİNİ seç — listenin dışından kod ÜRETME.

A) MATRAH HESABI (faturanın KDV'siz bedeli hangi satış hesabına yazılacak):
   Seçenekler: ${input.bosAlanSecenekleri.matrahKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   Kural:
     • 600.xx → Yurtiçi Mal/Hizmet Satışı (en yaygın)
     • 601.xx → Yurtdışı Satış (İHRACAT faturalarında)
     • 602.xx → Diğer Satışlar
   Fatura satırındaki ÜRÜN/HİZMET AÇIKLAMASINA bak ve bu gruplara en uygun alt kodu seç.
   Eğer mükellefin sadece 1 yurtiçi satış kodu varsa (örn sadece "600.01.001") → onu seç.
   Birden fazla alt kod varsa (örn "600.01.001 Mamul Satışı", "600.01.005 Hizmet Satışı") → fatura içeriğine göre ayırt et.

B) KDV HESABI (hesaplanan KDV hangi koda yazılacak):
   Seçenekler: ${input.bosAlanSecenekleri.kdvKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   Kural: Satış tarafında KDV hep 391 grubunda olur (Hesaplanan KDV). Listede birden fazla 391.xx varsa,
          genellikle MATRAH seçtiğin kodla AYNI alt gruplama mantığı (örn 600.01.005 → 391.01.006).
          Tam eşleşme yoksa 391 grubundaki en düşük numaralıyı seç.

C) CARİ HESAP (alıcı firma hangi cari kodu):
   Seçenekler: ${input.bosAlanSecenekleri.cariKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   Kural: Alıcı firmanın adı/VKN'si ile listedeki kod açıklamasını eşleştir.
   Cari kod listesinde alıcı firma YOKSA → cari için null dön (yeni cari açılması gerekir, runner atlayacak).

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

Sadece JSON döndür: {
  "karar": "onay|atla|emin_degil",
  "sebep": "mükellef açısından 80 karakter",
  "ocrOzet": "1 satır",
  "tarih": "18.03.2026" | null,
  "belgeNo": "TEE2026000000384" | null,
  "cari": "Karşı Firma Tam Ünvanı" | null,
  "belgeTuru": "E_FATURA|E_ARSIV|FIS|IRSALIYE" | null,
  "kdvOrani": "20" | null${
    input.action === 'isle_satis' && input.bosAlanSecenekleri
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

    const startMs = Date.now();
    const MODEL = 'claude-haiku-4-5-20251001';

    const logUsage = (
      karar: string | undefined,
      sebep: string | undefined,
      usage?: any,
    ) =>
      logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        source: 'mihsap-fatura',
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
        },
        body: JSON.stringify({
          model: MODEL,
          // Öneri modunda cevap daha uzun (onerilenler JSON'u eklenir) → 900 token güvenli
          max_tokens: input.bosAlanSecenekleri ? 900 : 600,
          system,
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
      const kategoriKey = (input.hesapKodlari?.[0] || '').trim();

      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c);
          if (parsed?.karar) {
            // Öneri mod: AI'nın önerdiği kodları gerçekten dropdown'da var mı ve
            // güven skoru >= 0.8 mi diye doğrula. Halüsinasyon korumasıdır.
            if (input.bosAlanSecenekleri && parsed.onerilenler) {
              parsed.onerilenler = this.sanitizeHesapKoduOnerileri(
                parsed.onerilenler,
                input.bosAlanSecenekleri,
              );
            }

            // === FIRMA HAFIZASI ENTEGRASYONU ===
            // Sadece AI "onay" derse memory'ye yansit. "atla"/"emin_degil" etkilemez.
            if (
              parsed.karar === 'onay' &&
              input.tenantId &&
              input.firmaKimlikNo &&
              kategoriKey
            ) {
              // Sapma var mi?
              if (vendorHint) {
                const sapma = this.vendorMemory.detectDeviation({
                  topKategoriler: vendorHint.topKategoriler,
                  aiKategori: kategoriKey,
                  aiAltKategori: null,
                });
                if (sapma.isSapma) {
                  // Onay kuyruguna dus, AI'yi otomatik islemeden durdur
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
                      kararTipi: 'fatura',
                      aiKarari: { ...parsed, hesapKodu: kategoriKey },
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
                    return parsed;
                  }
                }
              }
              // Sapma yok (veya hint yok) → memory'ye kaydet
              try {
                await this.vendorMemory.recordDecision({
                  tenantId: input.tenantId,
                  firmaKimlikNo: input.firmaKimlikNo,
                  firmaUnvan: input.firma,
                  kararTipi: 'fatura',
                  kategori: kategoriKey,
                  altKategori: null,
                  taxpayerId: input.mukellefId || null, // Mükellef-bazlı kayıt
                });
              } catch {
                // Memory kaydi basarisiz olsa bile ana akis devam eder
              }
            }
            // === /FIRMA HAFIZASI ===

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
    const MIN_CONFIDENCE = 0.8;
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
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 500,
          system,
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
        },
      });
      const acc = {
        sorguSayisi: rows.length,
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
