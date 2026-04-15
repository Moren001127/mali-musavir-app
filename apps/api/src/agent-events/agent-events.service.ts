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
    const system = `Sen bir Türk mali müşavirlik ofisinde fatura ön-kontrolü yapan yardımcısın.
Şu an ${islemTuru} faturaları işliyorsun.

ARKA PLAN BİLGİ:
Türk muhasebesinde hesap kodları değişmez bir şablona göre atanmıştır:
• 600/601/602 = gelir hesapları → SATIŞ faturalarında kullanılır
• 391 = hesaplanan KDV → SATIŞ faturalarında (satıcının tahsil ettiği KDV)
• 120/121 = alıcı hesapları → SATIŞ faturalarında
• 153/150 = stok hesapları → ALIŞ faturalarında
• 770/740 = gider hesapları → ALIŞ faturalarında
• 191 = indirilecek KDV → ALIŞ faturalarında (alıcının ödediği KDV)
• 320/321 = satıcı hesapları → ALIŞ faturalarında
• 253/255 = sabit kıymet/demirbaş → ALIŞ, ama bunlar bize atlanır

Bu kodların türü kodun ilk 3 rakamıyla belirlenir, açıklamaya bakma. "ALIŞTAN İADE HESAPLANAN KDV" açıklamalı kod 391.02 olsa bile SATIŞ kodudur çünkü 391 ile başlıyor (iade faturası = mükellef açısından satış işlemi).

KARAR AKIŞI — MIHSAP ekranındaki TÜM alanları fatura görüntüsüyle teyit et:

1. Tarih:
   Ekrandaki "Fatura Tarihi" fatura görüntüsündeki tarihle aynı mı?
   Tarih GG-AA-YYYY formatındadır. "30-03-2026" = 30 Mart. Ay = 2. grup (03).
   Hedef ay ${input.hedefAy || '?'} — fatura ayı hedef ayla eşleşmiyorsa → atla.

2. Matrah (Muhasebe) Hesap Kodu:
   Seçilen matrah kodu fatura içeriğiyle uyumlu mu?
   Örnek: Akaryakıt faturasında matrah 153.02 (stok-yakıt) olmalı, 770 (genel gider) değil.
   SATIŞ modunda matrah 600/601/602 olmalı; ALIŞ modunda 153/150/770/740/253 olmalı.

3. KDV Hesap Kodu:
   SATIŞ modunda → 391.xx (Hesaplanan KDV) olmalı.
   ALIŞ modunda → 191.xx (İndirilecek KDV) olmalı.
   KDV oranı fatura üzerindeki oranla eşleşmeli (%1, %10, %20).
   Mod ile KDV kodu çelişirse (SATIŞ modunda 191 vs.) → atla.

4. Cari Hesap Kodu (Alıcılar/Satıcılar):
   SATIŞ modunda → 120.xx (Alıcılar) veya 121 olmalı.
   ALIŞ modunda → 320.xx (Satıcılar) veya 321 olmalı.
   Cari hesap ADI fatura karşı firma adıyla uyumlu mu? (Ör. satıcı firma "HİLAL PETROL" ise cari "HİLAL PETROL LTD" benzeri olmalı).

5. Fatura Türü / Belge Türü:
   Seçilen belge türü fatura üzerindeki belge türüyle aynı mı? (E-Fatura / E-Arşiv / Kağıt / İrsaliye / İade / Tevkifatlı vs.)
   Fatura üzerinde "İADE FATURASI" yazıyorsa belge türü de iade olmalı.
   Tevkifatlı fatura ise tevkifat oranı/kodu doldurulmuş olmalı.

6. Belge Numarası / Evrak Numarası / Fiş Numarası:
   Fatura üzerindeki belge numarası (ör. YRG2026000000260) ekrana doğru girilmiş mi?
   Numaralar boş veya anlamsız (000000, XXX) ise → atla.

7. Demirbaş / Sabit Kıymet:
   Kod 253/255 ile başlıyorsa → atla. Fatura içeriğinde "demirbaş, makine, bilgisayar, yazıcı, klima, mobilya, kompresör" → atla.

8. Genel içerik uyumu:
   Görüntüdeki ürün/hizmet kategorisi ile matrah kodu mantıklı mı?

KARAR:
• Yukarıdaki her maddede TÜM alanlar teyit edildiyse VE uyumlu ise → **onay**
• Herhangi bir maddede açık bir uyumsuzluk tespit edildiyse → **atla** (sebep olarak hangi alanda uyumsuzluk var açıkla)
• Alanlardan biri okunamıyor/bulanık/eksik veriyorsa → **emin_degil**

Sektör veya firma adı SINIRLAYICI değildir. Mükellef nakliye firması olsa bile gıda faturası gelebilir — içeriğe ve kodlara bak. Kodların ilk 3 rakamı değişmez muhasebe mantığıdır: 600=satış geliri, 391=hesaplanan KDV (satış), 191=indirilecek KDV (alış), 320=satıcı (alış), 120=alıcı (satış), 153=stok (alış).

Sadece JSON döndür: {"karar":"onay|atla|emin_degil","sebep":"kısa gerekçe (max 80 karakter)","ocrOzet":"faturanın 1 satır özeti"}${mukellefTalimat}`;

    const userText = `Mükellef (faturayı alan): ${input.mukellef || '?'}
Satıcı firma (faturayı kesen): ${input.firma || '?'}
Hesap kodları: ${kodListe || '(boş)'}
Fatura tarihi: ${input.faturaTarihi || '?'}
Belge no: ${input.belgeNo || '?'}
Belge türü: ${input.belgeTuru || '?'}
Tutar: ${input.tutar || '?'}
Hedef ay: ${input.hedefAy || '?'}

NASIL KARAR VERİLİR (ÖNEM SIRASIYLA):
1) **Fatura GÖRÜNTÜSÜNÜN İÇERİĞİNE** bak — satırlarda ne yazıyor (ürün/hizmet adları)?
   Örn: "Sprinter Ön Fren Diski", "Motorin 95", "Hamburger menü" — bu asıl kanıt
2) Hesap kodlarını o içerikle karşılaştır. Uygunsa onay, çelişiyorsa atla.
3) Firma adı sadece **destekleyici ipucu**. "DİNAMİK OTOMOTİV GIDA TEKSTİL" gibi çok kategorili isimler varsa firma adına değil faturanın içeriğine bak.
4) Görüntüden içerik netse firma adıyla ufak çelişki takılma — içerik netse onay.
5) Görüntü bulanık veya içerik seçilmiyorsa "emin_degil" de.

ÖNEMLİ: Hesap kodları 153 (ticari mallar) / 191 (indirilecek KDV) / 320 (satıcılar) kombinasyonu STANDART otomotiv/ticari alış muhasebesidir. Bu kodlar + otomotiv parça içeriği = ONAY. Bu kodlar demirbaş değildir.`;

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
