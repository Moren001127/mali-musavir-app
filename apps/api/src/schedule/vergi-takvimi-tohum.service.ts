import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { takvimAnahtari, vergiTakvimiKayitlari } from './vergi-takvimi-tohum';

/**
 * Vergi takvimi tohumlayıcı (2026-09-14): `tax_calendar` tablosunu bu aydan 15 ay ileriye kadar standart son günlerle
 * doldurur. Var olan kayıtlara DOKUNMAZ (elle düzeltilen / uzatılan tarihler korunur), yalnız eksik olanları ekler.
 * Açılıştan 90 sn sonra + her ayın 1'i 00:40 (İstanbul). Kapatma: VERGI_TAKVIMI_TOHUM=off.
 */
@Injectable()
export class VergiTakvimiTohumService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VergiTakvimiTohumService.name);
  private calisiyor = false;

  constructor(private readonly prisma: PrismaService) {}

  private kapali(): boolean {
    return String(process.env.VERGI_TAKVIMI_TOHUM || '').toLowerCase() === 'off';
  }

  onApplicationBootstrap() {
    if (this.kapali()) return;
    const t = setTimeout(() => { void this.tohumla().catch((e: any) => this.logger.warn(`açılış tohumu hata: ${e?.message || e}`)); }, 90 * 1000);
    (t as any).unref?.();
  }

  @Cron('0 40 0 1 * *', { timeZone: 'Europe/Istanbul' })
  async aylik() {
    if (this.kapali()) return;
    await this.tohumla().catch((e: any) => this.logger.warn(`aylık tohum hata: ${e?.message || e}`));
  }

  /** @returns eklenen kayıt sayısı */
  async tohumla(simdi: Date = new Date(), ileriAy = 15): Promise<number> {
    if (this.calisiyor) return 0;
    this.calisiyor = true;
    try {
      const db: any = this.prisma;
      const baslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
      const bitis = new Date(simdi.getFullYear(), simdi.getMonth() + ileriAy + 1, 0, 23, 59, 59);
      const adaylar = vergiTakvimiKayitlari(baslangic, bitis);
      const mevcut: any[] = await db.taxCalendar.findMany({
        where: { dueDate: { gte: new Date(baslangic.getTime() - 40 * 86400000), lte: new Date(bitis.getTime() + 40 * 86400000) } },
        select: { declarationType: true, periodYear: true, periodMonth: true, periodQuarter: true },
      });
      const varOlan = new Set(mevcut.map(takvimAnahtari));
      const eksik = adaylar.filter((k) => !varOlan.has(takvimAnahtari(k)));
      if (!eksik.length) return 0;
      const r = await db.taxCalendar.createMany({ data: eksik });
      const n = Number(r?.count ?? eksik.length);
      this.logger.log(`[VERGI-TAKVIMI] ${n} kayıt eklendi (${baslangic.toISOString().slice(0, 10)} → ${bitis.toISOString().slice(0, 10)}; mevcut ${mevcut.length})`);
      return n;
    } finally {
      this.calisiyor = false;
    }
  }
}
