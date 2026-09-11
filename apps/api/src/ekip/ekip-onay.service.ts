import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { MOREN_AI_TOOLS } from '../moren-ai/tools';
import { ACTION_BY_NAME } from '../automations/action-catalog';
import { ActionDispatcherService } from '../automations/action-dispatcher.service';
import { LucaOperatorService } from '../calisan/luca-operator.service';
import { ajanBul } from './ajan-tanimlari';
import { aracKademesi } from './arac-defteri';

/**
 * EKİP ONAYLARI — ajanın "dışarı gönder" kademesindeki aracı (WhatsApp/SMS/e-posta)
 * çalışma sırasında GÖNDERİLMEZ; OwnerApprovalRequest (agent=`ekip:<ajanId>`) açılır.
 * Sahip portaldan (veya sesle) "ONAYLIYORUM #PRV-XXXX" derse burada YÜRÜTÜLÜR.
 *
 * Mevcut create_confirmed_agent_command yolu `ekip:*` ajanlarını tanımadığı için
 * (allowedAgents listesi) ekibin kendi onay-yürütme yolu burada.
 *
 * resmi_gonderim kademesi burada da YÜRÜTÜLMEZ — onaylansa bile.
 */
@Injectable()
export class EkipOnayService {
  private readonly logger = new Logger(EkipOnayService.name);
  private readonly portalAraclari = new Set<string>(MOREN_AI_TOOLS.map((t) => t.name));

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolExecutorService,
    private readonly dispatcher: ActionDispatcherService,
    private readonly operator: LucaOperatorService,
  ) {}

  /** Bekleyen (süresi dolmamış) ekip onayları. */
  async listele(tenantId: string, opts: { durum?: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'EXPIRED' | 'tumu'; limit?: number } = {}) {
    const durum = opts.durum || 'PENDING';
    const where: any = { tenantId, agent: { startsWith: 'ekip:' } };
    if (durum !== 'tumu') where.status = durum;
    if (durum === 'PENDING') where.expiresAt = { gt: new Date() };
    const rows = await (this.prisma as any).ownerApprovalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(opts.limit) || 50, 1), 200),
    });
    const ozetler = (rows as any[]).map((r) => this.ozet(r));
    await this.mukellefAdlariniCoz(tenantId, ozetler);
    return { onaylar: ozetler };
  }

  /** Telefonu WhatsApp/rehber biçimine getir ("905xxxxxxxxx"); sayı değilse null. */
  private telefonNormalize(raw: any): string | null {
    let d = String(raw || '').replace(/[^\d]/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = '90' + d.slice(1);
    else if (d.length === 10 && d.startsWith('5')) d = '90' + d;
    if (d.length < 7 || d.length > 15) return null;
    return d;
  }

  private mukellefGorunenAd(t: any): string | null {
    const ad = String(t?.companyName || '').trim() || `${String(t?.firstName || '').trim()} ${String(t?.lastName || '').trim()}`.trim();
    return ad || null;
  }

  /**
   * Onay özetlerine mükellef adını yazar (PLAN/14 §7-7): payload.taxpayerId → mükellef adı;
   * hedef telefonsa → o numaranın kayıtlı olduğu mükellef (phone/phones) + rehber adı (telefonAdlari[numara]).
   * Sorgu hatasında sessizce boş bırakır; liste yine döner.
   */
  private async mukellefAdlariniCoz(tenantId: string, ozetler: any[]): Promise<void> {
    const idler = new Set<string>();
    const telefonlar = new Set<string>();
    for (const o of ozetler) {
      if (o.mukellefId) idler.add(o.mukellefId);
      if (o.hedefTuru === 'telefon' && o.hedefNormalize) telefonlar.add(o.hedefNormalize);
    }
    if (!idler.size && !telefonlar.size) return;
    const select = { id: true, firstName: true, lastName: true, companyName: true, phone: true, phones: true, telefonAdlari: true };
    const or: any[] = [];
    if (idler.size) or.push({ id: { in: Array.from(idler) } });
    if (telefonlar.size) {
      const tels = Array.from(telefonlar);
      // Kayıtlı numara normalize ("905…") olabilir ya da ham ("0532…") — iki biçimi de ara
      const varyantlar = Array.from(new Set(tels.flatMap((t) => [t, t.startsWith('90') ? '0' + t.slice(2) : t])));
      or.push({ phone: { in: varyantlar } }, { phones: { hasSome: varyantlar } });
    }
    const kayitlar: any[] = await (this.prisma as any).taxpayer
      .findMany({ where: { tenantId, OR: or }, select })
      .catch(() => []);
    const idHarita = new Map<string, any>();
    const telHarita = new Map<string, any>();
    for (const t of kayitlar) {
      idHarita.set(t.id, t);
      for (const p of [t.phone, ...(Array.isArray(t.phones) ? t.phones : [])]) {
        const n = this.telefonNormalize(p);
        if (n && !telHarita.has(n)) telHarita.set(n, t);
      }
    }
    for (const o of ozetler) {
      let t: any = o.mukellefId ? idHarita.get(o.mukellefId) : null;
      if (!t && o.hedefTuru === 'telefon' && o.hedefNormalize) t = telHarita.get(o.hedefNormalize) || null;
      if (!t) continue;
      o.mukellefAd = this.mukellefGorunenAd(t);
      if (!o.mukellefId) o.mukellefId = t.id;
      if (o.hedefTuru === 'telefon' && o.hedefNormalize) {
        const rehber = t.telefonAdlari && typeof t.telefonAdlari === 'object' ? t.telefonAdlari[o.hedefNormalize] : null;
        if (rehber && String(rehber).trim()) o.hedefAd = String(rehber).trim();
      }
    }
  }

  private ozet(r: any) {
    const ajanId = String(r.agent || '').replace(/^ekip:/, '');
    const ajan = ajanBul(ajanId);
    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
    const hedef = payload.to || payload.phone || payload.email || payload.taxpayerId || null;
    const hedefTelefon = payload.to || payload.phone ? this.telefonNormalize(payload.to || payload.phone) : null;
    const hedefTuru: 'telefon' | 'eposta' | 'mukellef' | null = hedefTelefon
      ? 'telefon'
      : payload.email
        ? 'eposta'
        : payload.taxpayerId
          ? 'mukellef'
          : null;
    return {
      id: r.id,
      previewId: r.previewId,
      ajanId,
      ajanAd: ajan?.ad || ajanId,
      arac: r.action,
      kademe: aracKademesi(r.action),
      hedef,
      // Ekler (PLAN/14 §7-7): listele() içinde mükellefAdlariniCoz doldurur
      hedefTuru,
      hedefNormalize: hedefTelefon,
      mukellefId: payload.taxpayerId || null,
      mukellefAd: null as string | null,
      hedefAd: null as string | null,
      mesaj: payload.message || payload.text || payload.body || payload.mesaj || null,
      payload,
      etki: r.impact || null,
      isId: payload.isId || null,
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      approvedAt: r.approvedAt || null,
      responseText: r.responseText || null,
      confirmationText: `ONAYLIYORUM #${r.previewId}`,
    };
  }

  private async kaydiBul(tenantId: string, previewId: string) {
    const id = String(previewId || '').trim().toUpperCase().replace(/^#/, '');
    if (!id) return null;
    const r = await (this.prisma as any).ownerApprovalRequest.findFirst({
      where: { tenantId, previewId: id, agent: { startsWith: 'ekip:' } },
    });
    return r || null;
  }

  /**
   * Onayla ve yürüt. `onayMetni` tam olarak "ONAYLIYORUM #PRV-XXXX" olmalı
   * (portal düğmesi bunu kendisi üretir; sesli/yazılı komutta kullanıcı yazar).
   */
  async onayla(params: { tenantId: string; userId?: string | null; previewId: string; onayMetni?: string; kaynak?: string }) {
    const kayit = await this.kaydiBul(params.tenantId, params.previewId);
    if (!kayit) return { ok: false, error: `Onay kaydı bulunamadı: ${params.previewId}` };
    const beklenen = `ONAYLIYORUM #${kayit.previewId}`;
    const gelen = String(params.onayMetni || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (gelen && gelen !== beklenen) {
      return { ok: false, error: `Onay metni eşleşmedi. Beklenen: ${beklenen}`, requiresConfirmation: true, previewId: kayit.previewId };
    }
    if (kayit.status !== 'PENDING') return { ok: false, error: `Bu onay artık kullanılamaz: ${kayit.status}`, previewId: kayit.previewId };
    if (kayit.expiresAt && new Date(kayit.expiresAt).getTime() < Date.now()) {
      await (this.prisma as any).ownerApprovalRequest.update({ where: { id: kayit.id }, data: { status: 'EXPIRED' } }).catch(() => null);
      return { ok: false, error: `Onay süresi dolmuş: ${kayit.previewId}. Ajanı yeniden çalıştırın.`, expired: true };
    }

    const name = String(kayit.action || '');
    const kademe = aracKademesi(name);
    if (kademe === 'resmi_gonderim') {
      // Onaylansa bile ajan resmi gönderim yapmaz — kural koda gömülü.
      return { ok: false, error: 'Resmi gönderim (GİB/SGK/e-Defter) ajan tarafından yürütülmez; sahip kendisi yapar.' };
    }
    const payload = kayit.payload && typeof kayit.payload === 'object' ? { ...kayit.payload } : {};
    const isId = payload.isId || null;
    const taxpayerId = payload.taxpayerId || null;
    delete payload.isId;
    delete payload.taxpayerId;
    const ajanId = String(kayit.agent || '').replace(/^ekip:/, '');
    const ctx = { tenantId: params.tenantId, userId: params.userId ?? null, taxpayerId };

    let sonuc: any;
    try {
      sonuc = await this.yurut(name, payload, ctx, ajanId, isId);
    } catch (e: any) {
      sonuc = { ok: false, error: e?.message || String(e) };
    }
    const basarili = sonuc && sonuc.ok !== false && !sonuc.error;

    await (this.prisma as any).ownerApprovalRequest.update({
      where: { id: kayit.id },
      data: {
        status: basarili ? 'EXECUTED' : 'PENDING',
        approvedAt: new Date(),
        consumedAt: basarili ? new Date() : null,
        responseText: `${params.onayMetni || beklenen} | kaynak=${params.kaynak || 'portal'} | ${basarili ? 'gönderildi' : 'hata: ' + String(sonuc?.error || '').slice(0, 200)}`,
      },
    }).catch((e: any) => this.logger.warn(`onay kaydı güncellenemedi: ${e?.message || e}`));

    await (this.prisma as any).auditLog
      .create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId || null,
          action: basarili ? 'EXECUTE' : 'EXECUTE_FAILED',
          resource: 'owner_approval_request',
          resourceId: kayit.previewId,
          newData: { previewId: kayit.previewId, agent: kayit.agent, action: name, isId, sonuc },
        },
      })
      .catch(() => null);

    await (this.prisma as any).agentEvent
      .create({
        data: {
          tenantId: params.tenantId,
          agent: 'ekip',
          action: ajanId,
          status: basarili ? 'onaylandi' : 'hata',
          message: basarili ? `Sahip onayladı, gönderildi: ${name}` : `Onaylandı ama gönderilemedi: ${name} — ${sonuc?.error || 'bilinmeyen hata'}`,
          meta: { previewId: kayit.previewId, isId, name, args: payload, sonuc },
        },
      })
      .catch(() => null);

    // İş dosyasına da işle (AgentCommand.result.onayBekleyen[].durum)
    if (isId) {
      const is = await (this.prisma as any).agentCommand.findUnique({ where: { id: isId } }).catch(() => null);
      if (is?.result && typeof is.result === 'object') {
        const res: any = { ...is.result };
        res.onayBekleyen = (Array.isArray(res.onayBekleyen) ? res.onayBekleyen : []).map((o: any) =>
          o?.previewId === kayit.previewId ? { ...o, durum: basarili ? 'gonderildi' : 'hata', sonuc } : o,
        );
        await (this.prisma as any).agentCommand.update({ where: { id: isId }, data: { result: res } }).catch(() => null);
      }
    }

    return basarili
      ? { ok: true, previewId: kayit.previewId, yurutulen: name, sonuc }
      : { ok: false, previewId: kayit.previewId, error: sonuc?.error || 'Gönderim başarısız; onay bekliyor kalmaya devam ediyor.', sonuc };
  }

  async reddet(params: { tenantId: string; userId?: string | null; previewId: string; not?: string }) {
    const kayit = await this.kaydiBul(params.tenantId, params.previewId);
    if (!kayit) return { ok: false, error: `Onay kaydı bulunamadı: ${params.previewId}` };
    if (kayit.status !== 'PENDING') return { ok: false, error: `Bu onay artık kullanılamaz: ${kayit.status}` };
    await (this.prisma as any).ownerApprovalRequest.update({
      where: { id: kayit.id },
      data: { status: 'REJECTED', rejectedAt: new Date(), consumedAt: new Date(), responseText: params.not || 'REDDEDİLDİ' },
    });
    await (this.prisma as any).auditLog
      .create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId || null,
          action: 'REJECT',
          resource: 'owner_approval_request',
          resourceId: kayit.previewId,
          newData: { previewId: kayit.previewId, agent: kayit.agent, action: kayit.action, not: params.not || null },
        },
      })
      .catch(() => null);
    return { ok: true, previewId: kayit.previewId, status: 'REJECTED' };
  }

  /** Onaylanan aracı gerçekten çalıştır — runner'daki 3. adımla aynı dağıtım. */
  private async yurut(name: string, args: any, ctx: { tenantId: string; userId: string | null; taxpayerId: string | null }, ajanId: string, isId: string | null) {
    if (LucaOperatorService.lucaAraciMi(name)) return this.operator.executeOperatorTool(name, args, ctx);
    if (this.portalAraclari.has(name)) return this.tools.execute(name, args, ctx);
    if (ACTION_BY_NAME[name]) {
      return this.dispatcher.dispatch(name, args, { tenantId: ctx.tenantId, userId: ctx.userId, automationId: `ekip:${ajanId}:${isId || 'onay'}` });
    }
    return { ok: false, error: `Çalıştırıcı bulunamadı: ${name}` };
  }
}
