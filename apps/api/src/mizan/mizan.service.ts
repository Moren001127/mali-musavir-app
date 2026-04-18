import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LucaAutoScraperService } from '../luca/luca-auto-scraper.service';
import { MizanParserService, ParsedMizanRow } from './mizan-parser.service';

export type MizanDonemTipi =
  | 'AYLIK'
  | 'GECICI_Q1'
  | 'GECICI_Q2'
  | 'GECICI_Q3'
  | 'GECICI_Q4'
  | 'YILLIK';

/**
 * TDHP (Tek Düzen Hesap Planı) standart ana hesap kodu prefix seti.
 * Denetimde "TDHP dışı" tespiti için.
 */
const TDHP_ANA_HESAPLAR = new Set([
  // Aktif — Dönen Varlıklar
  '100','101','102','103','108','110','111','112','118','120','121','122','126','127','128','129',
  '131','132','133','135','136','137','138','139','150','151','152','153','157','158','159',
  '170','171','172','173','178','179','180','181','190','191','192','193','195','196','197','198','199',
  // Aktif — Duran Varlıklar
  '220','221','222','226','227','228','229','231','232','235','236','237','238','239',
  '240','241','242','243','244','245','246','247','248','249','250','251','252','253','254','255','256','257','258','259',
  '260','261','262','263','264','267','268','269','271','272','277','278','280','281','289','291','292','293','294','295','298','299',
  // Pasif — Kısa Vadeli Yabancı Kaynaklar
  '300','301','303','304','308','309','320','321','322','326','329','331','332','333','335','336','337','338','339',
  '340','349','350','351','358','359','360','361','368','369','370','371','372','373','379','380','381','382','383','385','386','387','391','392','393','397','399',
  // Pasif — Uzun Vadeli Yabancı Kaynaklar
  '400','405','407','408','409','420','421','422','426','429','431','432','433','436','437','438','439',
  '440','449','470','471','472','473','478','479','480','481','482','483','492','493','499',
  // Özkaynaklar
  '500','501','502','520','521','522','523','524','525','526','529','540','541','542','548','549',
  '570','571','580','590','591',
  // Gelir tablosu — 6XX
  '600','601','602','610','611','612','620','621','622','623','630','631','632','633',
  '640','641','642','643','644','645','646','647','648','649',
  '653','654','655','656','657','658','659','660','661',
  '671','672','679','680','681','689','690','691','692',
  // 7/A gider hesapları
  '710','711','720','721','730','731','740','741','750','751','760','761','770','771','780','781',
  // Nazım
  '900','901','902','910','911','920','921','950','951','952','953','954','955','956','957','958','959','960','961',
]);

@Injectable()
export class MizanService {
  private readonly logger = new Logger(MizanService.name);

  constructor(
    private prisma: PrismaService,
    private parser: MizanParserService,
    @Inject(forwardRef(() => LucaAutoScraperService))
    private lucaAutoScraper: LucaAutoScraperService,
  ) {}

  // ==================== IMPORT ====================

  /**
   * Luca'dan mizan Excel'i çek, parse et, DB'ye yaz, denetim çalıştır.
   * Aynı mükellef + dönem + tip için eski mizan varsa silinir.
   */
  async importFromLuca(params: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    donemTipi?: MizanDonemTipi;
    createdBy?: string;
  }) {
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: params.taxpayerId, tenantId: params.tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const mukellefAdi =
      taxpayer.companyName ||
      [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') ||
      taxpayer.taxNumber;

    // Eski mizanı sil (aynı dönem) — ama KILITLI ise reddet
    const existing = await (this.prisma as any).mizan.findFirst({
      where: {
        tenantId: params.tenantId,
        taxpayerId: params.taxpayerId,
        donem: params.donem,
        donemTipi: params.donemTipi || 'AYLIK',
      },
    });
    if (existing?.locked) {
      throw new BadRequestException(
        `Bu dönem için kesin kayıtlı mizan var (${existing.lockedAt ? new Date(existing.lockedAt).toLocaleString('tr-TR') : ''}). Yeniden çekmek için önce kilidi açın.`,
      );
    }
    if (existing) {
      await (this.prisma as any).mizan.delete({ where: { id: existing.id } });
    }

    const mizan = await (this.prisma as any).mizan.create({
      data: {
        tenantId: params.tenantId,
        taxpayerId: params.taxpayerId,
        donem: params.donem,
        donemTipi: params.donemTipi || 'AYLIK',
        kaynak: 'LUCA',
        status: 'PENDING',
        createdBy: params.createdBy || null,
      },
    });

    try {
      const buffer = await this.lucaAutoScraper.fetchMizanExcel({
        tenantId: params.tenantId,
        donem: params.donem,
        donemTipi: params.donemTipi,
        mukellefAdi,
      });
      const rows = this.parser.parse(buffer);
      if (rows.length === 0) {
        throw new Error('Mizan Excel parse edildi ama hiçbir satır okunamadı');
      }

      await (this.prisma as any).mizanHesap.createMany({
        data: rows.map((r) => ({
          mizanId: mizan.id,
          hesapKodu: r.hesapKodu,
          hesapAdi: r.hesapAdi,
          seviye: r.seviye,
          borcToplami: r.borcToplami,
          alacakToplami: r.alacakToplami,
          borcBakiye: r.borcBakiye,
          alacakBakiye: r.alacakBakiye,
          rowIndex: r.rowIndex,
        })),
      });

      await (this.prisma as any).mizan.update({
        where: { id: mizan.id },
        data: { status: 'READY' },
      });

      // Denetim çalıştır
      await this.analyzeAccounts(mizan.id);

      return { mizanId: mizan.id, rows: rows.length };
    } catch (e: any) {
      await (this.prisma as any).mizan.update({
        where: { id: mizan.id },
        data: { status: 'FAILED', notes: (e?.message || 'bilinmeyen hata').slice(0, 500) },
      });
      throw new BadRequestException(`Mizan çekilemedi: ${e?.message}`);
    }
  }

  /**
   * Elle yüklenmiş Excel'den mizan oluştur (fallback — Luca credential yoksa).
   */
  async importFromExcel(params: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    donemTipi?: MizanDonemTipi;
    buffer: Buffer;
    createdBy?: string;
  }) {
    let rows;
    try {
      rows = this.parser.parse(params.buffer);
    } catch (err: any) {
      // Parser'ın detaylı hata mesajını kullanıcıya ilet
      throw new BadRequestException(err?.message || 'Excel parse edilemedi');
    }
    if (rows.length === 0) {
      throw new BadRequestException(
        'Excel başlık bulundu ama hiç geçerli hesap satırı okunamadı. ' +
          'Dosyada "Hesap Kodu" sütunu altında rakamla başlayan hesap kodları olmalı (örn: 100, 120.01).',
      );
    }

    this.logger.log(
      `Mizan import başladı: tenant=${params.tenantId}, taxpayer=${params.taxpayerId}, donem=${params.donem}, donemTipi=${params.donemTipi || 'AYLIK'}, satir=${rows.length}`,
    );

    try {
      // Önce eski mizanları sil — aynı dönem için tek mizan kalsın
      const deleted = await (this.prisma as any).mizan.deleteMany({
        where: {
          tenantId: params.tenantId,
          taxpayerId: params.taxpayerId,
          donem: params.donem,
          donemTipi: params.donemTipi || 'AYLIK',
        },
      });
      if (deleted.count > 0) {
        this.logger.log(`Eski ${deleted.count} mizan silindi (aynı dönem)`);
      }

      // Mizan başlık kaydını oluştur
      const mizan = await (this.prisma as any).mizan.create({
        data: {
          tenantId: params.tenantId,
          taxpayerId: params.taxpayerId,
          donem: params.donem,
          donemTipi: params.donemTipi || 'AYLIK',
          kaynak: 'EXCEL',
          status: 'READY',
          createdBy: params.createdBy || null,
        },
      });
      this.logger.log(`Mizan kaydı oluşturuldu: id=${mizan.id}`);

      // Hesap satırlarını yaz
      const created = await (this.prisma as any).mizanHesap.createMany({
        data: rows.map((r) => ({
          mizanId: mizan.id,
          hesapKodu: r.hesapKodu,
          hesapAdi: r.hesapAdi,
          seviye: r.seviye,
          borcToplami: r.borcToplami,
          alacakToplami: r.alacakToplami,
          borcBakiye: r.borcBakiye,
          alacakBakiye: r.alacakBakiye,
          rowIndex: r.rowIndex,
        })),
      });
      this.logger.log(`${created.count} mizan hesap satırı yazıldı`);

      // Denetim — başarısız olursa mizan kaydı yine de duracak (try/catch içinde)
      try {
        await this.analyzeAccounts(mizan.id);
      } catch (analyzeErr: any) {
        this.logger.warn(
          `Mizan analizi başarısız (mizan ${mizan.id}): ${analyzeErr?.message}. Mizan kaydı korunuyor.`,
        );
      }

      return { mizanId: mizan.id, rows: rows.length };
    } catch (err: any) {
      this.logger.error(
        `Mizan import HATASI: ${err?.message}\n${err?.stack || ''}`,
      );
      throw new BadRequestException(
        `Mizan kaydedilemedi: ${err?.message || 'bilinmeyen hata'}`,
      );
    }
  }

  // ==================== DENETIM ====================

  /**
   * Mizan üzerinde otomatik denetim çalıştırır:
   *  - TDHP dışı hesap kodu
   *  - Zıt bakiye (alıcı/satıcı normalde bekleneni ters)
   *  - Net olmayan bakiye (hem borç hem alacak bakiye var)
   *  - Kritik eksik hesaplar (beklenmesi gereken ana hesap yok)
   */
  async analyzeAccounts(mizanId: string) {
    const hesaplar = await (this.prisma as any).mizanHesap.findMany({
      where: { mizanId },
    });

    // Eski anomalileri temizle
    await (this.prisma as any).mizanAnomali.deleteMany({ where: { mizanId } });

    const anomaliler: Array<{
      hesapKodu: string | null;
      tip: string;
      seviye: string;
      mesaj: string;
      detay?: any;
    }> = [];

    const mevcutAnaHesaplar = new Set<string>();

    for (const h of hesaplar) {
      const anaKod = h.hesapKodu.split('.')[0];
      mevcutAnaHesaplar.add(anaKod);

      // 1) TDHP dışı
      if (h.seviye === 0 && !TDHP_ANA_HESAPLAR.has(anaKod)) {
        anomaliler.push({
          hesapKodu: h.hesapKodu,
          tip: 'TDHP_DISI',
          seviye: 'WARN',
          mesaj: `${h.hesapKodu} "${h.hesapAdi}" TDHP'de yer almıyor — aktarım hatası olabilir`,
          detay: { borcBakiye: h.borcBakiye, alacakBakiye: h.alacakBakiye },
        });
      }

      // 2) Net olmayan bakiye — hem borç hem alacak bakiye var (sadece detay hesaplar)
      if (h.seviye >= 1 && Number(h.borcBakiye) > 0 && Number(h.alacakBakiye) > 0) {
        anomaliler.push({
          hesapKodu: h.hesapKodu,
          tip: 'NET_OLMAYAN',
          seviye: 'ERROR',
          mesaj: `${h.hesapKodu} "${h.hesapAdi}" hem borç hem alacak bakiye veriyor (mutabakat gerekli)`,
          detay: { borcBakiye: h.borcBakiye, alacakBakiye: h.alacakBakiye },
        });
      }

      // 3) Zıt bakiye — 120 (alıcılar) alacak bakiye verirse yanlış, 320 (satıcılar) borç bakiye verirse yanlış
      const beklenen = this.beklenenBakiyeTipi(anaKod);
      if (beklenen === 'borç' && Number(h.alacakBakiye) > 0 && Number(h.borcBakiye) === 0) {
        anomaliler.push({
          hesapKodu: h.hesapKodu,
          tip: 'ZIT_BAKIYE',
          seviye: 'WARN',
          mesaj: `${h.hesapKodu} "${h.hesapAdi}" normalde borç bakiyesi verir ama alacak bakiyesi var`,
          detay: { alacakBakiye: h.alacakBakiye },
        });
      } else if (beklenen === 'alacak' && Number(h.borcBakiye) > 0 && Number(h.alacakBakiye) === 0) {
        anomaliler.push({
          hesapKodu: h.hesapKodu,
          tip: 'ZIT_BAKIYE',
          seviye: 'WARN',
          mesaj: `${h.hesapKodu} "${h.hesapAdi}" normalde alacak bakiyesi verir ama borç bakiyesi var`,
          detay: { borcBakiye: h.borcBakiye },
        });
      }
    }

    // 4) Eksik kritik hesaplar (satış varsa KDV olmalı vb.)
    const satis = hesaplar.some((h: any) => h.hesapKodu.startsWith('600') || h.hesapKodu.startsWith('601'));
    const kdv391 = hesaplar.some((h: any) => h.hesapKodu.startsWith('391'));
    if (satis && !kdv391) {
      anomaliler.push({
        hesapKodu: '391',
        tip: 'EKSIK_HESAP',
        seviye: 'WARN',
        mesaj: 'Satış hesapları var ama 391 "Hesaplanan KDV" bulunamadı',
      });
    }

    const alis = hesaplar.some((h: any) => h.hesapKodu.startsWith('153') || h.hesapKodu.startsWith('621'));
    const kdv191 = hesaplar.some((h: any) => h.hesapKodu.startsWith('191'));
    if (alis && !kdv191) {
      anomaliler.push({
        hesapKodu: '191',
        tip: 'EKSIK_HESAP',
        seviye: 'WARN',
        mesaj: 'Alış/maliyet hesapları var ama 191 "İndirilecek KDV" bulunamadı',
      });
    }

    if (anomaliler.length > 0) {
      await (this.prisma as any).mizanAnomali.createMany({
        data: anomaliler.map((a) => ({
          mizanId,
          hesapKodu: a.hesapKodu,
          tip: a.tip,
          seviye: a.seviye,
          mesaj: a.mesaj,
          detay: a.detay || null,
        })),
      });
    }

    return { count: anomaliler.length };
  }

  /** 120/121 borç beklenir, 320/321 alacak beklenir... */
  private beklenenBakiyeTipi(anaKod: string): 'borç' | 'alacak' | null {
    const borcBeklenen = ['1', '2']; // Aktif + bazı giderler
    const alacakBeklenen = ['3', '4', '5']; // Pasif + özkaynak
    // Gelir tablosu hesapları için kesin kural yok (6XX satış alacak, 6XX gider borç)
    // 120, 150, 153 gibi ana hesap kodu ile hareket et
    if (['600', '601', '602', '640', '641', '642', '643', '644', '645', '646', '647', '648', '649'].includes(anaKod)) return 'alacak';
    if (['620', '621', '622', '623', '630', '631', '632', '633', '653', '654', '655', '656', '657', '658', '659', '660', '661'].includes(anaKod)) return 'borç';
    const first = anaKod.charAt(0);
    if (borcBeklenen.includes(first)) return 'borç';
    if (alacakBeklenen.includes(first)) return 'alacak';
    return null;
  }

  // ==================== LIST / GET / DELETE ====================

  async listMizans(tenantId: string, taxpayerId?: string) {
    const results = await (this.prisma as any).mizan.findMany({
      where: { tenantId, ...(taxpayerId ? { taxpayerId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        _count: { select: { hesaplar: true, anomaliler: true } },
      },
      take: 100,
    });
    this.logger.log(
      `Mizan list: tenant=${tenantId}, taxpayer=${taxpayerId || '(hepsi)'}, sonuç=${results.length}`,
    );
    return results;
  }

  async getMizan(id: string, tenantId: string) {
    const m = await (this.prisma as any).mizan.findFirst({
      where: { id, tenantId },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        hesaplar: { orderBy: { rowIndex: 'asc' } },
        anomaliler: true,
      },
    });
    if (!m) throw new NotFoundException('Mizan bulunamadı');

    // Toplam borç/alacak hesapla
    // En düşük seviyeli hesapları topla (detay mizanlarda seviye 0 ana hesap
    // bulunmayabilir — "320.01.A003" tipinde doğrudan alt kırılımlar olabilir).
    const hesaplar = m.hesaplar as any[];
    const minSeviye = hesaplar.length > 0
      ? Math.min(...hesaplar.map((h) => h.seviye ?? 0))
      : 0;
    const toplamBorc = hesaplar
      .filter((h) => (h.seviye ?? 0) === minSeviye)
      .reduce((s, h) => s + Number(h.borcToplami), 0);
    const toplamAlacak = hesaplar
      .filter((h) => (h.seviye ?? 0) === minSeviye)
      .reduce((s, h) => s + Number(h.alacakToplami), 0);

    return { ...m, toplamBorc, toplamAlacak };
  }

  async deleteMizan(id: string, tenantId: string) {
    const m = await (this.prisma as any).mizan.findFirst({ where: { id, tenantId } });
    if (!m) throw new NotFoundException('Mizan bulunamadı');
    if (m.locked) throw new BadRequestException('Bu mizan kesin kayıtlı, silmek için önce kilidi açın');
    await (this.prisma as any).mizan.delete({ where: { id } });
    return { deleted: true };
  }

  // ==================== LOCK / UNLOCK ====================

  async lockMizan(id: string, tenantId: string, userId: string, note?: string) {
    const m = await (this.prisma as any).mizan.findFirst({ where: { id, tenantId } });
    if (!m) throw new NotFoundException('Mizan bulunamadı');
    if (m.locked) throw new BadRequestException('Bu mizan zaten kesin kayıtlı');
    return (this.prisma as any).mizan.update({
      where: { id },
      data: {
        locked: true,
        lockedAt: new Date(),
        lockedBy: userId,
        lockNote: note?.slice(0, 500) || null,
      },
    });
  }

  async unlockMizan(id: string, tenantId: string, userId: string, reason?: string) {
    const m = await (this.prisma as any).mizan.findFirst({ where: { id, tenantId } });
    if (!m) throw new NotFoundException('Mizan bulunamadı');
    if (!m.locked) throw new BadRequestException('Bu mizan zaten açık');
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Kilidi açmak için sebep belirtmelisiniz (en az 5 karakter)');
    }
    return (this.prisma as any).mizan.update({
      where: { id },
      data: {
        locked: false,
        lockedAt: null,
        lockedBy: null,
        lockNote: `Kilit açıldı (${new Date().toLocaleString('tr-TR')}): ${reason}`.slice(0, 500),
      },
    });
  }

  // ==================== YARDIMCI (SERVİS İÇİ) ====================

  /** Gelir Tablosu ve Bilanço servisleri bu metotla mizanı hesap haritası olarak alır */
  async getHesaplarMap(mizanId: string): Promise<Map<string, ParsedMizanRow>> {
    const hesaplar = await (this.prisma as any).mizanHesap.findMany({
      where: { mizanId },
    });
    const map = new Map<string, ParsedMizanRow>();
    for (const h of hesaplar as any[]) {
      map.set(h.hesapKodu, {
        rowIndex: h.rowIndex,
        hesapKodu: h.hesapKodu,
        hesapAdi: h.hesapAdi,
        seviye: h.seviye,
        borcToplami: Number(h.borcToplami),
        alacakToplami: Number(h.alacakToplami),
        borcBakiye: Number(h.borcBakiye),
        alacakBakiye: Number(h.alacakBakiye),
      });
    }
    return map;
  }
}
