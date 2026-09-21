import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AJAN_TANIMLARI, ajanBul } from './ajan-tanimlari';
import { EkipKotaService } from './ekip-kota.service';
import { gunBasiIstanbul } from './ekip-kuyruk';
import { EkipKuyrukService } from './ekip-kuyruk.service';
import {
  GUNLUK_TAVAN_EN_COK,
  GUNLUK_TAVAN_VARSAYILAN,
  RUTIN_KAPSAMLARI,
  RutinZamani,
  SIMDI_CALISTIR_TAVANI,
  ayniIstanbulGunuMu,
  bugunAcilanlar,
  kapsamMukellefleri,
  secilecekOgeler,
  zamanDogrula,
  zamanUygunMu,
} from './ekip-rutin';
import { EkipRunnerService } from './ekip-runner.service';

/**
 * EKİP RUTİNLERİ — "İş düzeni" zamanlayıcısı (PLAN/20 §D, 2026-09-22).
 *
 * Her 5 dk (Europe/Istanbul): aktif rutinlerden zamanı uygun olanlar için kapsamdaki mükellefler hesaplanır
 * (pano:* → runner.pano son dönem; liste → seçili id'ler; ofis → tek iş), bugün zaten açılmış olanlar elenir, günlük tavana
 * kadar EkipKuyruk'a yazılır (kaynak 'rutin'). Kota doluysa tik atlar. "Şimdi çalıştır" aynı hesabı tavana bakmadan (≤20) yapar.
 *
 * Kural (00_ORTAK §14): rutinler Muzaffer Bey'in Ekip ekranından açtığı düzendir; rutin dışı hiçbir iş kendiliğinden başlamaz.
 * Tohum: Muzaffer Bey'in 2026-09-22 kararı — sahip kiracısında (MOREN_OWNER_TENANT_ID) hiç rutin yoksa "KDV kontrolü — kontrol
 * bekleyenler" (beyanname R1, hafta içi 09:30–17:00, günde 8, CANLI, AÇIK) bir kez oluşturulur.
 */

export interface RutinGovdesi {
  ad?: string;
  ajanId?: string;
  sablon?: string;
  kapsam?: string;
  taxpayerIds?: string[] | null;
  zaman?: any;
  gunlukTavan?: number;
  dryRun?: boolean;
  aktif?: boolean;
}

export interface RutinOzeti {
  id: string;
  ad: string;
  ajanId: string;
  ajanAd: string;
  sablon: string;
  kapsam: string;
  taxpayerIds: string[];
  zaman: RutinZamani | null;
  gunlukTavan: number;
  dryRun: boolean;
  aktif: boolean;
  sonKosuAt: Date | null;
  sonSonuc: any;
  createdAt: Date;
  updatedAt: Date;
  bugun: { planlanan: number; biten: number; hatali: number };
}

/** Tohum: Muzaffer Bey'in kararı (2026-09-22): canlı, günde 8, hafta içi 09:30–17:00. */
export const VARSAYILAN_RUTIN = {
  ad: 'KDV kontrolü — kontrol bekleyenler',
  ajanId: 'beyanname',
  sablon: '{mukellef} için {donem} dönemi KDV kontrolünü yap (R1).',
  kapsam: 'pano:kontrol_bekleyen',
  zaman: { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '09:30', bitis: '17:00' } as RutinZamani,
  gunlukTavan: 8,
  dryRun: false,
  aktif: true,
};

const TOHUM_GECIKME_MS = 20_000;
const CUID_KALIBI = /^c[a-z0-9]{20,31}$/;

@Injectable()
export class EkipRutinService implements OnApplicationBootstrap {
  private readonly logger = new Logger('EkipRutinService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EkipRunnerService,
    private readonly kuyruk: EkipKuyrukService,
    private readonly kota: EkipKotaService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  onApplicationBootstrap() {
    if (process.env.EKIP_RUTIN === 'off') return;
    const t = setTimeout(() => {
      this.tohumla().catch((e: any) => this.logger.warn(`tohum hata: ${e?.message || e}`));
    }, TOHUM_GECIKME_MS);
    (t as any).unref?.();
  }

  /**
   * Varsayılan rutin tohumu: yalnız MOREN_OWNER_TENANT_ID kiracısında (env yoksa hiç), yalnız kiracıda hiç rutin yokken.
   * @returns oluşturulan rutin id'si ya da null
   */
  async tohumla(): Promise<string | null> {
    const tenantId = String(process.env.MOREN_OWNER_TENANT_ID || '').trim();
    if (!tenantId) return null;
    const t = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }).catch(() => null);
    if (!t) {
      this.logger.warn(`tohum atlandı: MOREN_OWNER_TENANT_ID (${tenantId}) DB'de bulunamadı`);
      return null;
    }
    const sayi = Number(await this.db.ekipRutin.count({ where: { tenantId } }).catch(() => -1));
    if (sayi !== 0) return null;
    const row = await this.db.ekipRutin.create({
      data: { tenantId, ...VARSAYILAN_RUTIN, taxpayerIds: [] },
    });
    this.logger.warn(`[rutin] tohum: "${VARSAYILAN_RUTIN.ad}" oluşturuldu (${row.id}; ${VARSAYILAN_RUTIN.dryRun ? 'kuru' : 'CANLI'}, günde ${VARSAYILAN_RUTIN.gunlukTavan}, ${VARSAYILAN_RUTIN.aktif ? 'AÇIK' : 'kapalı'})`);
    return row.id;
  }

  // ─── CRUD ───

  private ozet(r: any, bugun: { planlanan: number; biten: number; hatali: number }): RutinOzeti {
    return {
      id: r.id,
      ad: r.ad,
      ajanId: r.ajanId,
      ajanAd: ajanBul(r.ajanId)?.ad || r.ajanId,
      sablon: r.sablon,
      kapsam: r.kapsam,
      taxpayerIds: Array.isArray(r.taxpayerIds) ? r.taxpayerIds.filter((x: any) => typeof x === 'string') : [],
      zaman: zamanDogrula(r.zaman).zaman,
      gunlukTavan: Number(r.gunlukTavan) || GUNLUK_TAVAN_VARSAYILAN,
      dryRun: r.dryRun !== false,
      aktif: r.aktif === true,
      sonKosuAt: r.sonKosuAt || null,
      sonSonuc: r.sonSonuc || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      bugun,
    };
  }

  /** Bugünkü kuyruklardan rutin başına {planlanan, biten, hatali}. */
  private async bugunOzetleri(tenantId: string, simdi: Date): Promise<Map<string, { planlanan: number; biten: number; hatali: number }>> {
    const out = new Map<string, { planlanan: number; biten: number; hatali: number }>();
    const rows: Array<{ rutinId: string | null; ogeler: any }> = await this.db.ekipKuyruk
      .findMany({ where: { tenantId, rutinId: { not: null }, createdAt: { gte: gunBasiIstanbul(simdi) } }, select: { rutinId: true, ogeler: true } })
      .catch(() => [] as any[]);
    const gruplar = new Map<string, Array<{ ogeler: any }>>();
    for (const r of rows) {
      if (!r.rutinId) continue;
      const g = gruplar.get(r.rutinId) || [];
      g.push(r);
      gruplar.set(r.rutinId, g);
    }
    for (const [rutinId, g] of gruplar) {
      const a = bugunAcilanlar(g);
      out.set(rutinId, { planlanan: a.sayi, biten: a.biten, hatali: a.hatali });
    }
    return out;
  }

  async listele(tenantId: string, simdi: Date = new Date()): Promise<{ rutinler: RutinOzeti[] }> {
    const [rows, bugun] = await Promise.all([
      this.db.ekipRutin.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }).catch(() => [] as any[]),
      this.bugunOzetleri(tenantId, simdi),
    ]);
    return { rutinler: (rows as any[]).map((r) => this.ozet(r, bugun.get(r.id) || { planlanan: 0, biten: 0, hatali: 0 })) };
  }

  /** Gövde doğrulama (olustur: tüm alanlar; guncelle: yalnız gelenler). Hata varsa metin döner. */
  private govdeDogrula(b: RutinGovdesi, mevcut: any | null): { data: any; hata: string | null } {
    const data: any = {};
    const yeni = !mevcut;
    if (b.ad !== undefined || yeni) {
      const ad = String(b.ad || '').trim();
      if (!ad) return { data, hata: 'ad zorunlu.' };
      data.ad = ad.slice(0, 160);
    }
    if (b.ajanId !== undefined || yeni) {
      const ajan = ajanBul(String(b.ajanId || ''));
      if (!ajan) return { data, hata: `ajanId geçersiz. Geçerli: ${AJAN_TANIMLARI.map((a) => a.id).join(', ')}` };
      data.ajanId = ajan.id;
    }
    if (b.sablon !== undefined || yeni) {
      const sablon = String(b.sablon || '').trim();
      if (!sablon) return { data, hata: 'sablon zorunlu ({mukellef} ve {donem} yer tutucuları kullanılabilir).' };
      if (sablon.length > 4000) return { data, hata: 'sablon en çok 4000 karakter.' };
      data.sablon = sablon;
    }
    const kapsam = b.kapsam !== undefined ? String(b.kapsam || '') : mevcut?.kapsam;
    if (b.kapsam !== undefined || yeni) {
      if (!(RUTIN_KAPSAMLARI as readonly string[]).includes(kapsam)) return { data, hata: `kapsam geçersiz. Geçerli: ${RUTIN_KAPSAMLARI.join(', ')}` };
      data.kapsam = kapsam;
    }
    if (b.taxpayerIds !== undefined || yeni) {
      const idler = Array.from(new Set((Array.isArray(b.taxpayerIds) ? b.taxpayerIds : []).map((x) => String(x || '').trim()).filter((x) => CUID_KALIBI.test(x))));
      data.taxpayerIds = idler;
    }
    const sonIdler: string[] = data.taxpayerIds ?? (Array.isArray(mevcut?.taxpayerIds) ? mevcut.taxpayerIds : []);
    if (kapsam === 'liste' && !sonIdler.length) return { data, hata: 'kapsam=liste için en az bir mükellef (taxpayerIds) gerekli.' };
    if (b.zaman !== undefined || yeni) {
      const z = zamanDogrula(b.zaman);
      if (!z.zaman) return { data, hata: z.hata };
      data.zaman = z.zaman;
    }
    if (b.gunlukTavan !== undefined || yeni) {
      const n = b.gunlukTavan === undefined ? GUNLUK_TAVAN_VARSAYILAN : Number(b.gunlukTavan);
      if (!Number.isInteger(n) || n < 1 || n > GUNLUK_TAVAN_EN_COK) return { data, hata: `gunlukTavan 1-${GUNLUK_TAVAN_EN_COK} arası tam sayı olmalı.` };
      data.gunlukTavan = n;
    }
    if (b.dryRun !== undefined || yeni) data.dryRun = b.dryRun === undefined ? true : b.dryRun !== false;
    if (b.aktif !== undefined || yeni) data.aktif = b.aktif === true;
    return { data, hata: null };
  }

  async olustur(tenantId: string, b: RutinGovdesi): Promise<{ ok: true; rutin: RutinOzeti } | { ok: false; error: string }> {
    const { data, hata } = this.govdeDogrula(b || {}, null);
    if (hata) return { ok: false, error: hata };
    const row = await this.db.ekipRutin.create({ data: { tenantId, ...data } });
    this.logger.log(`[rutin] ${tenantId} ${row.id} oluşturuldu: "${row.ad}" (${row.ajanId}, ${row.kapsam}, ${row.aktif ? 'AÇIK' : 'kapalı'}, ${row.dryRun ? 'kuru' : 'CANLI'})`);
    return { ok: true, rutin: this.ozet(row, { planlanan: 0, biten: 0, hatali: 0 }) };
  }

  async guncelle(tenantId: string, id: string, b: RutinGovdesi): Promise<{ ok: true; rutin: RutinOzeti } | { ok: false; error: string }> {
    const mevcut = await this.db.ekipRutin.findFirst({ where: { id, tenantId } }).catch(() => null);
    if (!mevcut) return { ok: false, error: 'Rutin bulunamadı.' };
    const { data, hata } = this.govdeDogrula(b || {}, mevcut);
    if (hata) return { ok: false, error: hata };
    if (!Object.keys(data).length) return { ok: true, rutin: this.ozet(mevcut, (await this.bugunOzetleri(tenantId, new Date())).get(id) || { planlanan: 0, biten: 0, hatali: 0 }) };
    const row = await this.db.ekipRutin.update({ where: { id }, data });
    this.logger.log(`[rutin] ${tenantId} ${id} güncellendi: ${Object.keys(data).join(', ')}`);
    return { ok: true, rutin: this.ozet(row, (await this.bugunOzetleri(tenantId, new Date())).get(id) || { planlanan: 0, biten: 0, hatali: 0 }) };
  }

  async sil(tenantId: string, id: string): Promise<{ ok: boolean; error?: string }> {
    const mevcut = await this.db.ekipRutin.findFirst({ where: { id, tenantId }, select: { id: true } }).catch(() => null);
    if (!mevcut) return { ok: false, error: 'Rutin bulunamadı.' };
    await this.db.ekipRutin.delete({ where: { id } });
    this.logger.log(`[rutin] ${tenantId} ${id} silindi`);
    return { ok: true };
  }

  // ─── ZAMANLAYICI ───

  @Cron('0 */5 * * * *', { timeZone: 'Europe/Istanbul' })
  async tik(): Promise<void> {
    if (process.env.EKIP_RUTIN === 'off') return;
    await this.tara().catch((e: any) => this.logger.warn(`tik hata: ${e?.message || e}`));
  }

  /** Bir tarama (test için `simdi` verilir). @returns koşan rutin id'leri */
  async tara(simdi: Date = new Date()): Promise<string[]> {
    if (!this.kota.acikMi(simdi)) {
      this.logger.warn('[rutin] Max kotası dolu; rutin taraması atlandı');
      return [];
    }
    if (this.runner.kapaniyorMu()) return [];
    const rutinler: any[] = await this.db.ekipRutin.findMany({ where: { aktif: true }, orderBy: { createdAt: 'asc' } }).catch(() => [] as any[]);
    const kosan: string[] = [];
    for (const r of rutinler) {
      const zaman = zamanDogrula(r.zaman).zaman;
      if (!zamanUygunMu(zaman, simdi, r.sonKosuAt)) continue;
      try {
        await this.rutinKos(r, { tavanUygula: true, simdi });
        kosan.push(r.id);
      } catch (e: any) {
        this.logger.warn(`[rutin] ${r.tenantId} ${r.id} koşu hatası: ${e?.message || e}`);
      }
    }
    return kosan;
  }

  /** "Şimdi çalıştır": aynı hesap, günlük tavana bakmadan (en çok 20); aktif olmasa da çalışır. */
  async simdiCalistir(tenantId: string, id: string): Promise<{ ok: boolean; eklenen: number; kuyrukId: string | null; aday?: number; neden?: string | null; error?: string }> {
    const r = await this.db.ekipRutin.findFirst({ where: { id, tenantId } }).catch(() => null);
    if (!r) return { ok: false, eklenen: 0, kuyrukId: null, error: 'Rutin bulunamadı.' };
    const s = await this.rutinKos(r, { tavanUygula: false, simdi: new Date() });
    return { ok: true, eklenen: s.eklenen, kuyrukId: s.kuyrukId, aday: s.aday, neden: s.neden };
  }

  /**
   * Rutinin bir koşusu: kapsam → bugün açılmış olanları ele → tavana kadar kuyruk aç → sonKosuAt/sonSonuc yaz.
   * sonKosuAt: öğe eklendiğinde ya da bugünkü ilk değerlendirmede yazılır (aylık "bugün koştu" bayrağı; haftalıkta her 5 dk yazılmaz).
   */
  async rutinKos(
    r: any,
    opts: { tavanUygula: boolean; simdi: Date },
  ): Promise<{ eklenen: number; aday: number; kuyrukId: string | null; donem: string | null; neden: string | null }> {
    const simdi = opts.simdi;
    const tenantId: string = r.tenantId;
    const bugunku: Array<{ ogeler: any }> = await this.db.ekipKuyruk
      .findMany({ where: { tenantId, rutinId: r.id, createdAt: { gte: gunBasiIstanbul(simdi) } }, select: { ogeler: true } })
      .catch(() => [] as any[]);
    const acilan = bugunAcilanlar(bugunku);
    const gunlukTavan = Number(r.gunlukTavan) || GUNLUK_TAVAN_VARSAYILAN;
    const tavan = opts.tavanUygula ? gunlukTavan - acilan.sayi : SIMDI_CALISTIR_TAVANI;

    let sonuc: { eklenen: number; aday: number; kuyrukId: string | null; donem: string | null; neden: string | null };
    if (tavan <= 0) {
      sonuc = { eklenen: 0, aday: 0, kuyrukId: null, donem: null, neden: `günlük tavan doldu (${acilan.sayi}/${gunlukTavan})` };
    } else {
      const kapsam = String(r.kapsam || '');
      const pano = kapsam.startsWith('pano:') || sablonDonemGerekli(r.sablon) ? await this.runner.pano(tenantId, 2).catch((e: any) => (this.logger.warn(`[rutin] pano okunamadı (${tenantId}): ${e?.message || e}`), null)) : null;
      const k = kapsamMukellefleri(kapsam, pano, Array.isArray(r.taxpayerIds) ? r.taxpayerIds : []);
      const secilen = secilecekOgeler(k.mukellefler, acilan, tavan);
      if (!secilen.length) {
        const neden = !k.mukellefler.length
          ? kapsam.startsWith('pano:') && !pano
            ? 'pano okunamadı'
            : 'kapsamda mükellef yok'
          : 'kapsamdakiler bugün zaten açılmış';
        sonuc = { eklenen: 0, aday: k.mukellefler.length, kuyrukId: null, donem: k.donem, neden };
      } else {
        const acilis = await this.kuyruk.olustur({
          tenantId,
          ad: r.ad,
          ajanId: r.ajanId,
          sablon: r.sablon,
          ogeler: secilen.map((m) => ({ taxpayerId: m.taxpayerId, donem: k.donem })),
          donem: k.donem,
          dryRun: r.dryRun !== false,
          kaynak: 'rutin',
          rutinId: r.id,
          olusturan: null,
        });
        sonuc = acilis.ok
          ? { eklenen: acilis.ogeSayisi, aday: k.mukellefler.length, kuyrukId: acilis.id, donem: k.donem, neden: acilis.atlanan ? `${acilis.atlanan} mükellef bulunamadı` : null }
          : { eklenen: 0, aday: k.mukellefler.length, kuyrukId: null, donem: k.donem, neden: acilis.error };
      }
    }
    const ilkDegerlendirme = !ayniIstanbulGunuMu(r.sonKosuAt, simdi);
    if (sonuc.eklenen > 0 || ilkDegerlendirme || !opts.tavanUygula) {
      await this.db.ekipRutin
        .update({ where: { id: r.id }, data: { sonKosuAt: simdi, sonSonuc: { zaman: simdi.toISOString(), ...sonuc, elle: !opts.tavanUygula } } })
        .catch((e: any) => this.logger.warn(`[rutin] sonuç yazılamadı ${r.id}: ${e?.message || e}`));
    }
    if (sonuc.eklenen > 0 || !opts.tavanUygula) {
      this.logger.log(`[rutin] ${tenantId} "${r.ad}" ${opts.tavanUygula ? 'zamanlı' : 'şimdi'}: ${sonuc.eklenen} öğe kuyruğa girdi${sonuc.kuyrukId ? ` (${sonuc.kuyrukId})` : ''}${sonuc.neden ? ` — ${sonuc.neden}` : ''}`);
    }
    return sonuc;
  }
}

/** Kalıp {donem} istiyorsa liste/ofis kapsamında da pano dönemi okunur. */
function sablonDonemGerekli(sablon: any): boolean {
  return /\{\s*donem\s*\}/i.test(String(sablon || ''));
}
