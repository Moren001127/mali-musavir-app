import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logAiUsage } from '../common/ai-usage-logger';

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
  constructor(private prisma: PrismaService) {}

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
   * Output: { karar: 'onay'|'atla'|'emin_degil', sebep: string, ocrOzet?: string }
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
    firma?: string;
    tutar?: number | string;
    action?: string; // 'isle_alis' | 'isle_satis' | 'isle_alis_isletme' | 'isle_satis_isletme'
    tenantId?: string;
  }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { karar: 'emin_degil', sebep: 'ANTHROPIC_API_KEY yok' };
    }
    // Mükellef talimatı — panelden girilen özel kural. AI ana 6 kuralı uyguladıktan
    // SONRA, sadece açık uyumsuzluk varsa talimatı ek referans olarak kullanır.
    // Ana kuralları (özellikle [E] nakliye bedeli = ONAY) geçersiz kılmaz.
    let mukellefTalimat = '';
    if (input.tenantId && input.mukellef) {
      try {
        const rule = await this.prisma.agentRule.findUnique({
          where: { tenantId_mukellef: { tenantId: input.tenantId, mukellef: input.mukellef } },
        });
        const talimat = (rule?.profile as any)?.talimat;
        if (talimat) mukellefTalimat = String(talimat);
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

Sadece JSON döndür: {"karar":"onay|atla|emin_degil","sebep":"80 karakter","ocrOzet":"1 satır"}`;

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
          max_tokens: 600,
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

      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c);
          if (parsed?.karar) {
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
