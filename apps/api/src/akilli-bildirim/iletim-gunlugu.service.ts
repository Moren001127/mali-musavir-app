import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ayAraligi, dispatchSatirlari, gunlukExcel, gunlukSirala, gunlukSuz, iletisimKonuSuzgeci, iletisimSatiri, ozetCikar, sayfala,
  unvanKur, yenidenDenenecekSayisi,
  type BelgeBilgisi, type BeyanBilgisi, type GunlukSatiri, type GunlukSorgusu, type GunlukYaniti,
} from './iletim-gunlugu';

/**
 * İLETİM GÜNLÜĞÜ — GET /akilli-bildirim/iletim-gunlugu (+ /excel).
 * Yalnız OKUR. Kaynak birleşimi, süzgeç, sayfalama ve Excel: iletim-gunlugu.ts (saf, test edilebilir).
 * Eski `report` / `resend-failed` uçlarına dokunulmadı (AkilliBildirimService).
 */
@Injectable()
export class IletimGunluguService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ayın tüm günlük satırları (süzgeçsiz) + yeniden denenecek çift sayısı. */
  async topla(tenantId: string, month: string): Promise<{ satirlar: GunlukSatiri[]; yenidenDenenecek: number }> {
    const { start, end } = ayAraligi(month);
    const p = this.prisma as any;

    const [dispatchRows, logRows] = await Promise.all([
      p.documentDispatch.findMany({
        // Tarih = sentAt ?? createdAt: iletilen satır gönderildiği ayda, iletilemeyen ilk deneme ayında görünür
        where: { tenantId, OR: [{ sentAt: { gte: start, lt: end } }, { sentAt: null, createdAt: { gte: start, lt: end } }] },
        orderBy: { createdAt: 'desc' },
        take: 20000,
      }) as Promise<any[]>,
      p.communicationLog.findMany({
        where: {
          occurredAt: { gte: start, lt: end },
          channel: { in: ['WHATSAPP', 'EMAIL'] },
          taxpayer: { tenantId },
          OR: iletisimKonuSuzgeci(),
        },
        select: { id: true, taxpayerId: true, channel: true, subject: true, content: true, occurredAt: true },
        orderBy: { occurredAt: 'desc' },
        take: 20000,
      }).catch(() => []) as Promise<any[]>,
    ]);

    // Belge adları için referanslar (tek seferde)
    const beyanIdleri = new Set<string>();
    const belgeIdleri = new Set<string>();
    for (const r of dispatchRows) {
      if (!Array.isArray(r.docRefs)) continue;
      for (const ref of r.docRefs) {
        const id = typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? String(ref.id || '') : '';
        if (!id) continue;
        if (r.kategori === 'VERGI') beyanIdleri.add(id);
        else if (r.kategori === 'SGK' || r.kategori === 'ETEBLIGAT') belgeIdleri.add(id);
      }
    }
    const tpIdleri = new Set<string>([...dispatchRows.map((r: any) => String(r.taxpayerId)), ...logRows.map((r: any) => String(r.taxpayerId))]);

    const [beyanlar, belgeler, mukellefler] = await Promise.all([
      beyanIdleri.size
        ? (p.beyanKaydi.findMany({ where: { id: { in: [...beyanIdleri] } }, select: { id: true, beyanTipi: true, donem: true } }) as Promise<BeyanBilgisi[]>)
        : Promise.resolve([] as BeyanBilgisi[]),
      belgeIdleri.size
        ? (p.portalDocument.findMany({ where: { id: { in: [...belgeIdleri] } }, select: { id: true, title: true, period: true, belgeTuru: true, raw: true } }) as Promise<BelgeBilgisi[]>)
        : Promise.resolve([] as BelgeBilgisi[]),
      tpIdleri.size
        ? (p.taxpayer.findMany({
            where: { tenantId, id: { in: [...tpIdleri] } },
            select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
          }) as Promise<any[]>)
        : Promise.resolve([] as any[]),
    ]);

    const tpHarita = new Map<string, any>(mukellefler.map((t: any) => [t.id, t]));
    // WhatsApp Mesaj Merkezi'nin sanal kişileri (taxNumber WHATSAPP-*) mükellef değil; günlüğe girmez
    const sanal = (id: string) => String(tpHarita.get(id)?.taxNumber || '').startsWith('WHATSAPP-');
    const ctx = {
      unvan: (id: string) => unvanKur(tpHarita.get(id), id),
      beyanlar: new Map<string, BeyanBilgisi>(beyanlar.map((b) => [b.id, b])),
      belgeler: new Map<string, BelgeBilgisi>(belgeler.map((d) => [d.id, d])),
    };

    const satirlar: GunlukSatiri[] = [];
    for (const r of dispatchRows) {
      if (sanal(String(r.taxpayerId))) continue;
      satirlar.push(...dispatchSatirlari(r, ctx));
    }
    for (const r of logRows) {
      if (sanal(String(r.taxpayerId))) continue;
      const s = iletisimSatiri(r, ctx.unvan(String(r.taxpayerId)));
      if (s) satirlar.push(s);
    }
    return { satirlar, yenidenDenenecek: yenidenDenenecekSayisi(dispatchRows) };
  }

  async liste(tenantId: string, sorgu: GunlukSorgusu): Promise<GunlukYaniti> {
    const { satirlar, yenidenDenenecek } = await this.topla(tenantId, sorgu.month);
    const suzulmus = gunlukSirala(gunlukSuz(satirlar, sorgu), sorgu.sira);
    const { sayfa, satirlar: sayfadakiler } = sayfala(suzulmus, sorgu.page, sorgu.pageSize);
    return {
      month: sorgu.month,
      toplam: suzulmus.length,
      sayfa,
      sayfaBoyutu: sorgu.pageSize,
      satirlar: sayfadakiler,
      ozet: ozetCikar(suzulmus, yenidenDenenecek),
    };
  }

  /** Süzgeçlere uyan TÜM satırlar (sayfalama yok) → xlsx */
  async excel(tenantId: string, sorgu: GunlukSorgusu): Promise<Buffer> {
    const { satirlar } = await this.topla(tenantId, sorgu.month);
    return gunlukExcel(gunlukSirala(gunlukSuz(satirlar, sorgu), sorgu.sira), sorgu.month);
  }
}
