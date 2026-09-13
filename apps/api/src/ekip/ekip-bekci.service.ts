import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EkipRunnerService } from './ekip-runner.service';
import {
  BEKCI_ACILIS_GECIKME_MS,
  BEKCI_TARAMA_ARALIGI_MS,
  BekciAdayIs,
  bayatKosulariSec,
  bayatSonucBirlestir,
  kosuTavanDk,
} from './ekip-bekci';

/**
 * EKİP BAYAT KOŞU BEKÇİSİ (2026-09-13) — karar mantığı `ekip-bekci.ts` (saf, testli); burada yalnız DB + zamanlayıcı.
 * Açılıştan 3 dk sonra bir kez (süreç öncesi 'running' işler), sonra her 5 dk (tavan aşımı).
 * Süreç belleğinde koşan işlere (runner.kosuAktifMi) dokunmaz. Hata yutulur; log düşer.
 */
@Injectable()
export class EkipBekciService implements OnApplicationBootstrap {
  private readonly logger = new Logger('EkipBekciService');
  private readonly surecBaslangici = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EkipRunnerService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.EKIP_BEKCI === 'off') return;
    const t = setTimeout(() => {
      this.tara(true).catch((e: any) => this.logger.warn(`açılış taraması hata: ${e?.message || e}`));
    }, BEKCI_ACILIS_GECIKME_MS);
    (t as any).unref?.();
  }

  @Interval(BEKCI_TARAMA_ARALIGI_MS)
  async duzenliTarama() {
    if (process.env.EKIP_BEKCI === 'off') return;
    await this.tara(false).catch((e: any) => this.logger.warn(`düzenli tarama hata: ${e?.message || e}`));
  }

  /** @returns kapatılan iş sayısı */
  async tara(acilis: boolean): Promise<number> {
    const isler: BekciAdayIs[] = await (this.prisma as any).agentCommand
      .findMany({
        where: { agent: { startsWith: 'ekip:' }, status: 'running' },
        select: { id: true, tenantId: true, agent: true, status: true, startedAt: true, createdAt: true, result: true, payload: true },
        take: 200,
      })
      .catch(() => []);
    if (!isler.length) return 0;
    const kararlar = bayatKosulariSec(isler, {
      simdi: new Date(),
      aktifMi: (id) => this.runner.kosuAktifMi(id),
      surecBaslangici: acilis ? this.surecBaslangici : null,
      tavanDk: kosuTavanDk(),
    });
    let kapatilan = 0;
    for (const k of kararlar) {
      const is: any = isler.find((i) => i.id === k.id);
      const r = await (this.prisma as any).agentCommand
        .updateMany({
          where: { id: k.id, status: 'running' }, // yarışta eski süreç 'done' yazdıysa dokunma
          data: { status: 'failed', finishedAt: new Date(), result: bayatSonucBirlestir(is?.result, k) },
        })
        .catch(() => ({ count: 0 }));
      if (!r?.count) continue;
      kapatilan++;
      const ajanId = String(is?.agent || '').replace(/^ekip:/, '');
      await (this.prisma as any).agentEvent
        .create({
          data: {
            tenantId: is?.tenantId,
            agent: 'ekip',
            action: ajanId,
            status: 'hata',
            message: k.metin.slice(0, 500),
            meta: { isId: k.id, kaynak: 'bekci', bayatNeden: k.neden, taxpayerId: is?.payload?.taxpayerId || null },
          },
        })
        .catch(() => undefined);
      this.logger.warn(`[BEKCI] ${ajanId} ${k.id} → failed (${k.neden})`);
    }
    if (kapatilan) this.logger.log(`[BEKCI] ${acilis ? 'açılış' : 'düzenli'} tarama: ${kapatilan} bayat koşu kapatıldı`);
    return kapatilan;
  }
}
