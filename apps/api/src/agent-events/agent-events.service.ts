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

⚠️ ŞU AN İŞLEM TÜRÜ: ${islemTuru} FATURASI

╔══════════════════════════════════════════════════════════════════╗
║ 📘 HESAP KODU TABLOSU — KESİNLİKLE UYULACAK                     ║
║                                                                  ║
║ Her kodun SADECE TEK BİR TÜRÜ VARDIR. Kod = Tür. Değişmez.      ║
╠══════════════════════════════════════════════════════════════════╣
║ SATIŞ (GELİR) KODLARI:                                           ║
║   • 600.xx (Yurt İçi Satışlar) — HER ZAMAN SATIŞ. ASLA ALIŞ DEĞİL║
║   • 601.xx (Yurt Dışı Satışlar) — HER ZAMAN SATIŞ                ║
║   • 602.xx (Diğer Gelirler) — HER ZAMAN SATIŞ                    ║
║   • 391.xx (Hesaplanan KDV) — HER ZAMAN SATIŞ. ASLA ALIŞ DEĞİL   ║
║   • 120.xx (Alıcılar) — HER ZAMAN SATIŞ                          ║
║   "Satış", "Gelir", "Gelirleri" kelimeleri = SATIŞ KODU          ║
║                                                                  ║
║ ALIŞ (GİDER/STOK) KODLARI:                                       ║
║   • 153.xx (Ticari Mallar) — HER ZAMAN ALIŞ                      ║
║   • 150.xx (İlk Madde) — HER ZAMAN ALIŞ                          ║
║   • 253/255 (Sabit Kıymet) — HER ZAMAN ALIŞ                      ║
║   • 740/770 (Hizmet/Genel Gider) — HER ZAMAN ALIŞ                ║
║   • 191.xx (İndirilecek KDV) — HER ZAMAN ALIŞ. ASLA SATIŞ DEĞİL  ║
║   • 320.xx (Satıcılar) — HER ZAMAN ALIŞ                          ║
╚══════════════════════════════════════════════════════════════════╝

🔴 KATI KURALLAR — İHLAL ETME:

 1. Kodun baş rakamı 600/601/602 → BU BİR SATIŞ KODUDUR.
 2. Kodun baş rakamı 391 → BU BİR SATIŞ KODUDUR. (Hesaplanan KDV = satışta alınan KDV)
 3. Kodun baş rakamı 120 → BU BİR SATIŞ KODUDUR.
 4. Kodun baş rakamı 191 → BU BİR ALIŞ KODUDUR. (İndirilecek KDV)
 5. Kodun baş rakamı 320 → BU BİR ALIŞ KODUDUR.
 6. Kodun baş rakamı 153/150/253/255/740/770 → ALIŞ KODUDUR.
 7. Kod adında "SATIŞ" veya "GELİR" geçiyorsa → SATIŞ KODUDUR (örn: "600.01.001-NAKLİYE GELİRLERİ" = SATIŞ).
 8. 391 KODUNUN HER VARYANTI SATIŞ KODUDUR. Alt kodlar dahil:
    • 391.01.xxx (Hesaplanan KDV) = SATIŞ
    • 391.02.xxx (ALIŞTAN İADE HESAPLANAN KDV) = SATIŞ
      (Mükellefin aldığı malı iade ettiği iade faturası. Bu İADE FATURASI = mükellef açısından SATIŞ işlemidir,
       çünkü mükellef satıcıya ürünü geri "satıyor" gibi düşün. KDV hesaplanır, tahsil edilir.)
    • 391.03.xxx vb. = SATIŞ
    Kısaca: Kod 391 ile başlıyorsa SATIŞ, başka detaya bakma.
 9. 191 KODUNUN HER VARYANTI ALIŞ KODUDUR (191.01, 191.02 "Satıştan İade İndirilecek KDV" dahil).
10. Bu kuralların İSTİSNASI YOKTUR. Sektör, firma, tevkifat, içerik, açıklama fark etmez.
    Açıklamada "alıştan iade" yazsa da kod 391 ise SATIŞ. Açıklamada "satıştan iade" yazsa da kod 191 ise ALIŞ.

🚫 BU CÜMLELERİ ASLA YAZMA:
  ✗ "600/391/120 alış kodları" — YANLIŞ. Bunlar SATIŞ kodları.
  ✗ "SATIŞ faturasında ALIŞ kodları (600/391/120)" — YANLIŞ. 600/391/120 ZATEN satış kodları.
  ✗ "391 hesaplanan KDV alış kodudur" — YANLIŞ. 391 satış kodudur.
  ✗ "SATIŞ faturası beklenirken ALIŞ kodu (391.01.002) görüldü" — YANLIŞ. 391 satış kodu.

✅ DOĞRU ÖRNEKLER:
  ✓ SATIŞ faturasında 600.01.002 + 391.01.002 + 120.01.A001 → DOĞRU, onay.
  ✓ ALIŞ faturasında 153.01.001 + 191.01.001 + 320.01.001 → DOĞRU, onay.
  ✓ ALIŞ faturasında 770.01.001 + 191.01.001 + 320.01.001 → DOĞRU, onay.

🗓️ TARİH YORUMLAMA — DİKKAT:
  • Tarih formatı Türkiye standardı: GG-AA-YYYY veya GG.AA.YYYY (gün-ay-yıl)
  • "30-03-2026" = 30 Mart 2026 (AY = 03 = MART). Nisan DEĞİL!
  • "05-04-2026" = 5 Nisan 2026 (AY = 04 = NİSAN)
  • Hedef ay "2026-03" ise: ay numarası 03 yani MART — sadece 01-31 Mart tarihli faturalar uygundur.
  • Ay karşılaştırması yaparken fatura tarihindeki 2. sayı grubunu (ay) hedef aydaki AA ile eşleştir.
  • Tarihi yorumlamadan önce mutlaka GG-AA-YYYY olduğunu DOĞRULA.

Eğer fatura türü talimata uymuyorsa (ör. satış beklerken alış görürsen) emin_degil de.

ÖNEMLİ BIAS UYARISI: Mükellefin sektörü ne olursa olsun, her faturanın KENDİ içeriğine bakarak karar ver. Örneğin mükellef nakliye firması olsa bile bir yemek/gıda faturası gelebilir — içerik "yiyecek" ise yakıt sayma. Görüntüde net göremediğin faturada "emin_degil" de.
Kararın: "onay" (F2 Kaydet ve Onayla) / "atla" (İleri, kaydetme) / "emin_degil" (güvenli: atla).

KURALLAR (sırayla):
1) Fatura tarihini GG-AA-YYYY olarak oku; AA (ay numarası) hedef aydaki ay numarasıyla EŞLEŞMİYORSA → atla. Eşleşiyorsa bu kuralda atlama.
2) Hesap kodları boş, eksik veya tutarsızsa → atla
3) Hesap kodu 255 ile başlıyorsa VEYA kodların metni "demirbaş" içeriyorsa → atla
4) Fatura içeriğinde "demirbaş, makine, teçhizat, mobilya, bilgisayar, yazıcı, kompresör, fotokopi, klima" gibi sabit kıymet ibareleri varsa → atla
5) İşlem türü ile kod türü uyumsuzsa → atla. Yani:
   • SATIŞ işleminde 191/320/153 gibi ALIŞ kodları varsa → atla
   • ALIŞ işleminde 600/391/120 gibi SATIŞ kodları varsa → atla
   Ancak: ${islemTuru} işleminde ${islemTuru === 'SATIŞ' ? '600/391/120' : '153/191/320 veya 770/191/320'} kodları varsa → bu DOĞRUDUR, bu kuralla atlamayacaksın.
6) Hesap kodu ile fatura içeriği bariz çelişiyorsa (örn. kod 770-Genel Yönetim ama fatura akaryakıt stok) → atla
7) Yukarıdaki hiçbiri değilse VE kodlar içeriğe uygunsa → onay
8) Tereddüt varsa → emin_degil

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
