import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    return this.prisma.agentEvent.create({
      data: {
        tenantId,
        agent: input.agent,
        action: input.action,
        status: input.status,
        message: input.message,
        mukellef: input.mukellef,
        firma: input.firma,
        fisNo: input.fisNo,
        tutar: input.tutar,
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
    if (status) where.status = status;
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
      this.prisma.agentEvent.count({ where: { tenantId, status: 'onaylandi', ts: { gte: ayBas } } }),
      this.prisma.agentEvent.count({ where: { tenantId, status: 'hata', ts: { gte: bugun } } }),
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
    mukellef?: string;
    firma?: string;
    tutar?: number | string;
    action?: string; // 'isle_alis' | 'isle_satis'
    tenantId?: string;
  }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { karar: 'emin_degil', sebep: 'ANTHROPIC_API_KEY yok' };
    }
    // Mükellefe özel kural varsa sistem prompt'a ekle
    let mukellefTalimat = '';
    if (input.tenantId && input.mukellef) {
      try {
        const rule = await this.prisma.agentRule.findUnique({
          where: { tenantId_mukellef: { tenantId: input.tenantId, mukellef: input.mukellef } },
        });
        const talimat = (rule?.profile as any)?.talimat;
        if (talimat) mukellefTalimat = `\n\nMÜKELLEF ÖZEL TALİMATLARI (${input.mukellef}):\n${talimat}`;
      } catch {}
    }
    const kodListe = input.hesapKodlari.join(', ');
    const islemTuru = input.action === 'isle_satis' ? 'SATIŞ' : input.action === 'isle_alis' ? 'ALIŞ' : 'ALIŞ';

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

    const system = `Sen bir fatura içerik doğrulayıcısın.

=== BACKEND TARAFINDAN DOĞRULANAN BİLGİLER (kesin, değiştirilemez) ===
- İşlem modu: ${islemTuru}
- Hesap kodları: ${codesArr.join(', ')}
- Kod türü (backend hesabı): ${codeType}
- Mod/kod uyumu: ONAYLANDI
- Tarih ayı uyumu: ONAYLANDI
Bu bilgileri tekrar sorgulamak veya "alış/satış kodu çelişkisi" demek YASAKTIR.

=== SENİN GÖREVİN ===
Yalnızca fatura GÖRÜNTÜSÜ ile MIHSAP ekranındaki alanların tutarlı olduğunu doğrula:

1) TARİH: Ekrandaki tarih (${input.faturaTarihi || '?'}) ile fatura görüntüsündeki tarih aynı gün mü?
   → Farklıysa atla. Okuyamazsan bu maddeyi geç.

2) İÇERİK-MATRAH UYUMU: Fatura satırlarındaki ürün/hizmet açıklaması, seçilen matrah kodunun adıyla mantıklı mı?
   Uyum örnekleri: "Nakliye bedeli" + "600-Nakliye Gelirleri" ✓ | "Motorin" + "153-Ticari Mallar" ✓
   Çelişki örneği: "Akaryakıt faturası" + "770-Genel Yönetim Gideri" ✗
   → Açık çelişkide atla. Mantıklıysa veya emin değilsen onay.

3) KDV ORANI: Faturadaki KDV oranı (%1/%10/%20) ile seçilen KDV kodunun oranı eşleşiyor mu?
   → Farklıysa atla. Okuyamazsan bu maddeyi geç.

4) CARİ FİRMA: Fatura karşı taraf firma adı ile ekrandaki cari hesap adı aynı firma mı?
   → Bariz farklıysa atla. Kısaltma/uzun ad farkı kabul edilebilir.

5) BELGE NO: Ekrandaki belge no (${input.belgeNo || '?'}) fatura üzerindeki no ile aynı mı?
   → Farklıysa atla. Okuyamazsan bu maddeyi geç.

6) İADE FATURASI: Fatura görüntüsünde açıkça "İADE FATURASI" yazıyor ama ekranda normal satış seçili mi?
   → Evet ise atla. Yoksa bu maddeyi geç.
   NOT: "e-Arşiv Fatura", "e-Fatura", "Tevkifatlı Fatura" belge TÜRÜDÜR, alış/satış yönüyle karıştırma.

7) DEMİRBAŞ: Fatura içeriğinde "demirbaş, makine, bilgisayar, yazıcı, klima, mobilya, kompresör" varsa → atla.

8) Yukarıdakilerin HİÇBİRİ yoksa → onay. Görüntü okunamazsa → emin_degil.

YASAK: "mükellef alıcı/satıcı konumunda" deme. "alış/satış kodu" deme. "sektör uyumsuz" deme. Firma adından alış/satış yönü çıkarma.

Sadece JSON: {"karar":"onay|atla|emin_degil","sebep":"max 80 karakter","ocrOzet":"1 satır özet"}${mukellefTalimat}`;

    const userText = `Mükellef: ${input.mukellef || '?'} | Karşı firma: ${input.firma || '?'}
Kodlar: ${kodListe || '(boş)'} | Tarih: ${input.faturaTarihi || '?'} | Belge no: ${input.belgeNo || '?'}
Belge türü: ${input.belgeTuru || '?'} | Tutar: ${input.tutar || '?'} | Hedef ay: ${input.hedefAy || '?'}

Fatura görüntüsünü incele ve yukarıdaki sistem talimatlarına göre JSON döndür.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
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
        return { karar: 'emin_degil', sebep: `Claude API ${res.status}: ${errText.slice(0, 100)}` };
      }
      const json = await res.json();
      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { karar: 'emin_degil', sebep: 'JSON parse fail', raw: text.slice(0, 200) };
      try {
        const parsed = JSON.parse(match[0]);
        return parsed;
      } catch {
        return { karar: 'emin_degil', sebep: 'JSON parse fail', raw: text.slice(0, 200) };
      }
    } catch (e: any) {
      return { karar: 'emin_degil', sebep: `Network: ${e?.message || 'unknown'}` };
    }
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
