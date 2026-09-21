import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ajanBul } from './ajan-tanimlari';
import { EkipKotaService } from './ekip-kota.service';
import {
  AKTIF_KUYRUK_DURUMLARI,
  BugunPlani,
  KuyrukKaynagi,
  KuyrukOgesi,
  KuyrukOzeti,
  KuyrukSatiri,
  LISTE_AKTIF_DURUMLARI,
  bugunPlani,
  gunBasiIstanbul,
  kotaHatasiMi,
  kuyrukOzeti,
  ogeleriOku,
  sablonDoldur,
  sablonDonemIstiyorMu,
  siradakiOgeDizini,
  tenantKuyruguSec,
} from './ekip-kuyruk';
import { EkipRunnerService } from './ekip-runner.service';

/**
 * EKİP KUYRUĞU — sıralı işleyici (PLAN/20 §D, 2026-09-22).
 *
 * Her 15 sn: kiracı başına EN FAZLA BİR kuyruk sürer, o kuyruktan TEK öğe koşar (runner.calistir), bitince sıradaki
 * bir sonraki tikte alınır. Öğe başlamadan önce üç kapı:
 *  (a) Max kotası açık mı (EkipKotaService) — değilse kuyruk `kota_bekliyor`, sıfırlanınca kendiliğinden sürer;
 *  (b) kiracıda süren başka ekip koşusu var mı (agent_commands status='running', agent 'ekip:%' — test koşuları 'ekiptest:'
 *      önekiyle zaten dışarıda) — varsa bekle (sunucu tek-koşu kilidi, PLAN/19 O3; ön yüz kilidi /ekip/durum.calisan);
 *  (c) runner kapanıyor mu (dağıtım drenajı) — evetse yeni öğe açılmaz, yeni kopya alır.
 * Durdur: kuyruk `durduruldu` + süren koşuya runner.iptalEt (POST /ekip/isler/:id/iptal ile aynı yol). Devam: `bekliyor`.
 * Koşu iş dosyasına payload.kaynak 'rutin'|'toplu' ve payload.kuyrukId yazılır; akış/işler listelerinde doğal görünür.
 */

export interface KuyrukOlusturParametreleri {
  tenantId: string;
  ad?: string | null;
  ajanId: string;
  sablon: string;
  /** Mükellef id'leri (kaynak toplu) — ya da `ogeler` */
  taxpayerIds?: string[] | null;
  /** Rutin kapsamından gelen öğeler (mükellefsiz ofis işi için taxpayerId null) */
  ogeler?: Array<{ taxpayerId: string | null; donem?: string | null }> | null;
  /** Tüm öğeler için ortak dönem (öğede yoksa) */
  donem?: string | null;
  dryRun?: boolean;
  kaynak: KuyrukKaynagi;
  rutinId?: string | null;
  olusturan?: string | null;
}

/** Bir kuyrukta en çok bu kadar öğe (toplu görevde seçim tavanı). */
export const KUYRUK_OGE_TAVANI = 50;
export const KUYRUK_TIK_MS = 15_000;

@Injectable()
export class EkipKuyrukService {
  private readonly logger = new Logger('EkipKuyrukService');
  /** Bu süreçte şu an öğe işleyen kuyruklar: tenantId → kuyrukId. */
  private readonly isleyenler = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EkipRunnerService,
    private readonly kota: EkipKotaService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  // ─── OLUŞTUR / LİSTELE / DURDUR / DEVAM ───

  /** id → görünen ad (companyName | ad soyad); yalnız bu kiracının mükellefleri. */
  private async mukellefAdlari(tenantId: string, idler: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const tekil = Array.from(new Set(idler.filter((x) => typeof x === 'string' && x)));
    if (!tekil.length) return out;
    try {
      const rows: any[] = await this.db.taxpayer.findMany({
        where: { tenantId, id: { in: tekil } },
        select: { id: true, companyName: true, firstName: true, lastName: true },
      });
      for (const t of rows || []) {
        const ad = String(t?.companyName || '').trim() || `${String(t?.firstName || '').trim()} ${String(t?.lastName || '').trim()}`.trim();
        out.set(t.id, ad || t.id);
      }
    } catch (e: any) {
      this.logger.warn(`mükellef adları okunamadı: ${e?.message || e}`);
    }
    return out;
  }

  /**
   * Kuyruk aç: mükellef adları bu kiracının taxpayer tablosundan doldurulur; kiracıda bulunmayan id 'atlandi' olur
   * (başka kiracının mükellefi kuyruğa giremez). Öğeler 'bekliyor', kuyruk 'bekliyor' — işleyici sıradaki tikte alır.
   */
  async olustur(p: KuyrukOlusturParametreleri): Promise<{ ok: true; id: string; ogeSayisi: number; atlanan: number } | { ok: false; error: string }> {
    const ajan = ajanBul(String(p.ajanId || ''));
    if (!ajan) return { ok: false, error: `Bilinmeyen personel: ${p.ajanId || '-'}` };
    const sablon = String(p.sablon || '').trim();
    if (!sablon) return { ok: false, error: 'Görev kalıbı boş olamaz.' };
    if (sablon.length > 4000) return { ok: false, error: 'Görev kalıbı çok uzun (en çok 4000 karakter).' };
    const hamOgeler: Array<{ taxpayerId: string | null; donem?: string | null }> = Array.isArray(p.ogeler)
      ? p.ogeler
      : (Array.isArray(p.taxpayerIds) ? p.taxpayerIds : []).map((id) => ({ taxpayerId: String(id || '').trim() || null }));
    if (!hamOgeler.length) return { ok: false, error: 'Kuyruk için en az bir öğe (mükellef) gerekli.' };
    if (hamOgeler.length > KUYRUK_OGE_TAVANI) return { ok: false, error: `Bir kuyrukta en çok ${KUYRUK_OGE_TAVANI} öğe olabilir.` };
    const adlar = await this.mukellefAdlari(
      p.tenantId,
      hamOgeler.map((o) => o.taxpayerId).filter((x): x is string => typeof x === 'string' && Boolean(x)),
    );
    const gorulen = new Set<string>();
    const ogeler: KuyrukOgesi[] = [];
    let atlanan = 0;
    for (const o of hamOgeler) {
      const id = o.taxpayerId || null;
      if (id && gorulen.has(id)) continue; // aynı mükellef iki kez seçilmiş
      if (id) gorulen.add(id);
      const ad = id ? adlar.get(id) || null : null;
      const bulunamadi = Boolean(id) && !ad;
      if (bulunamadi) atlanan++;
      ogeler.push({
        taxpayerId: id,
        ad,
        donem: o.donem || p.donem || null,
        durum: bulunamadi ? 'atlandi' : 'bekliyor',
        hata: bulunamadi ? 'Mükellef bu ofiste bulunamadı.' : null,
      });
    }
    const ad = String(p.ad || '').trim() || `${ajan.ad} — toplu görev`;
    const row = await this.db.ekipKuyruk.create({
      data: {
        tenantId: p.tenantId,
        ad: ad.slice(0, 160),
        ajanId: ajan.id,
        sablon,
        dryRun: p.dryRun !== false,
        kaynak: p.kaynak === 'rutin' ? 'rutin' : 'toplu',
        rutinId: p.rutinId || null,
        durum: 'bekliyor',
        ogeler,
        olusturan: p.olusturan || null,
      },
    });
    this.logger.log(`[kuyruk] ${p.tenantId} ${row.id} açıldı: ${ajan.id}, ${ogeler.length} öğe (${p.kaynak}${p.rutinId ? `, rutin ${p.rutinId}` : ''}, ${p.dryRun !== false ? 'kuru' : 'CANLI'})`);
    return { ok: true, id: row.id, ogeSayisi: ogeler.length - atlanan, atlanan };
  }

  /** Aktif (bekliyor/suruyor/kota_bekliyor/durduruldu) kuyruklar + son 5 bitmiş — GET /ekip/kuyruk. */
  async listele(tenantId: string): Promise<{ kuyruklar: KuyrukOzeti[] }> {
    const [aktifler, bitenler] = await Promise.all([
      this.db.ekipKuyruk.findMany({ where: { tenantId, durum: { in: LISTE_AKTIF_DURUMLARI } }, orderBy: { createdAt: 'asc' } }).catch(() => [] as any[]),
      this.db.ekipKuyruk.findMany({ where: { tenantId, durum: 'bitti' }, orderBy: [{ bitisAt: 'desc' }, { createdAt: 'desc' }], take: 5 }).catch(() => [] as any[]),
    ]);
    return { kuyruklar: [...(aktifler as KuyrukSatiri[]), ...(bitenler as KuyrukSatiri[])].map(kuyrukOzeti) };
  }

  async getir(tenantId: string, id: string): Promise<KuyrukOzeti | null> {
    const r = await this.db.ekipKuyruk.findFirst({ where: { id, tenantId } }).catch(() => null);
    return r ? kuyrukOzeti(r) : null;
  }

  /** DURDUR: kuyruk 'durduruldu'; süren koşu varsa iptal (runner.iptalEt — POST /ekip/isler/:id/iptal ile aynı yol). */
  async durdur(tenantId: string, id: string): Promise<{ ok: boolean; id: string; durum?: string; iptal?: { ok: boolean; isId: string; error?: string } | null; error?: string }> {
    const k = await this.db.ekipKuyruk.findFirst({ where: { id, tenantId } }).catch(() => null);
    if (!k) return { ok: false, id, error: 'Kuyruk bulunamadı.' };
    if (k.durum === 'bitti') return { ok: false, id, error: 'Kuyruk zaten bitmiş.' };
    if (k.durum === 'durduruldu') return { ok: true, id, durum: 'durduruldu', iptal: null };
    await this.db.ekipKuyruk.update({ where: { id }, data: { durum: 'durduruldu' } });
    let iptal: { ok: boolean; isId: string; error?: string } | null = null;
    if (k.aktifIsId) iptal = this.runner.iptalEt(tenantId, k.aktifIsId, 'sahip');
    this.logger.log(`[kuyruk] ${tenantId} ${id} durduruldu${k.aktifIsId ? ` (süren iş ${k.aktifIsId}: ${iptal?.ok ? 'iptal verildi' : iptal?.error || '-'})` : ''}`);
    return { ok: true, id, durum: 'durduruldu', iptal };
  }

  /** DEVAM: durdurulmuş / kota bekleyen kuyruk yeniden 'bekliyor' (sıradaki tik alır; kota hâlâ doluysa yine kota_bekliyor olur). */
  async devam(tenantId: string, id: string): Promise<{ ok: boolean; id: string; durum?: string; error?: string }> {
    const k = await this.db.ekipKuyruk.findFirst({ where: { id, tenantId } }).catch(() => null);
    if (!k) return { ok: false, id, error: 'Kuyruk bulunamadı.' };
    if (k.durum === 'bitti') return { ok: false, id, error: 'Kuyruk zaten bitmiş.' };
    if (k.durum === 'bekliyor' || k.durum === 'suruyor') return { ok: true, id, durum: k.durum };
    const ogeler = ogeleriOku(k.ogeler);
    if (siradakiOgeDizini(ogeler) < 0 && !ogeler.some((o) => o.durum === 'suruyor')) {
      await this.db.ekipKuyruk.update({ where: { id }, data: { durum: 'bitti', bitisAt: new Date(), aktifIsId: null } });
      return { ok: true, id, durum: 'bitti' };
    }
    await this.db.ekipKuyruk.update({ where: { id }, data: { durum: 'bekliyor' } });
    this.logger.log(`[kuyruk] ${tenantId} ${id} devam`);
    return { ok: true, id, durum: 'bekliyor' };
  }

  // ─── /ekip/durum EKLERİ ───

  /** {aktif: bitmemiş kuyruk sayısı, suruyorId, siradaki} — kiracının ekranındaki kuyruk şeridi. */
  async durumOzeti(tenantId: string): Promise<{ aktif: number; suruyorId: string | null; siradaki: { taxpayerId: string | null; ad: string | null } | null }> {
    const rows: KuyrukSatiri[] = await this.db.ekipKuyruk
      .findMany({ where: { tenantId, durum: { in: AKTIF_KUYRUK_DURUMLARI } }, orderBy: { createdAt: 'asc' } })
      .catch(() => [] as any[]);
    const suruyor = rows.find((r) => r.durum === 'suruyor') || null;
    const ilk = suruyor || rows[0] || null;
    const siradaki = ilk ? kuyrukOzeti(ilk).siradaki : null;
    return { aktif: rows.length, suruyorId: suruyor?.id || null, siradaki };
  }

  /** Bugün (Istanbul) açılmış ya da hâlâ bitmemiş kuyrukların öğe sayaçları — /ekip/durum `bugunPlan`. */
  async bugunPlan(tenantId: string, simdi: Date = new Date()): Promise<BugunPlani> {
    const rows: Array<{ ogeler: any }> = await this.db.ekipKuyruk
      .findMany({
        where: { tenantId, OR: [{ createdAt: { gte: gunBasiIstanbul(simdi) } }, { durum: { in: AKTIF_KUYRUK_DURUMLARI } }] },
        select: { ogeler: true },
      })
      .catch(() => [] as any[]);
    return bugunPlani(rows);
  }

  // ─── İŞLEYİCİ ───

  /** Kiracıda şu an süren ekip koşusu var mı (tek koşu kilidi). 'ekiptest:' önekli test koşuları sayılmaz. Sorgu düşerse "var" say (temkin). */
  private async surenKosuVarMi(tenantId: string): Promise<boolean> {
    try {
      const n = await this.db.agentCommand.count({ where: { tenantId, status: 'running', agent: { startsWith: 'ekip:' } } });
      return Number(n) > 0;
    } catch (e: any) {
      this.logger.warn(`süren koşu sayısı okunamadı (${tenantId}): ${e?.message || e}`);
      return true;
    }
  }

  /** {donem} için pano'nun en son beyanname dönemi (YYYY-MM); okunamazsa null. */
  private async beyannameDonemi(tenantId: string): Promise<string | null> {
    try {
      const pano: any = await this.runner.pano(tenantId, 1);
      const d = pano?.donemler?.[0];
      return (d?.beyannameDonem as string) || null;
    } catch (e: any) {
      this.logger.warn(`pano dönemi okunamadı (${tenantId}): ${e?.message || e}`);
      return null;
    }
  }

  @Interval(KUYRUK_TIK_MS)
  async tik(): Promise<void> {
    if (process.env.EKIP_KUYRUK === 'off') return;
    await this.tara().catch((e: any) => this.logger.warn(`tik hata: ${e?.message || e}`));
  }

  /**
   * Bir tarama: her kiracı için (bu süreçte işlenmiyorsa) kapıları kontrol et ve tek öğe başlat (beklemeden).
   * @returns bu tikte öğe başlatılan kuyruk id'leri
   */
  async tara(simdi: Date = new Date()): Promise<string[]> {
    if (this.runner.kapaniyorMu()) return [];
    const adaylar: KuyrukSatiri[] = await this.db.ekipKuyruk
      .findMany({ where: { durum: { in: AKTIF_KUYRUK_DURUMLARI } }, orderBy: { createdAt: 'asc' }, take: 200 })
      .catch((e: any) => (this.logger.warn(`kuyruklar okunamadı: ${e?.message || e}`), [] as any[]));
    if (!adaylar.length) return [];
    const kiracilar = new Map<string, KuyrukSatiri[]>();
    for (const k of adaylar) {
      const g = kiracilar.get(k.tenantId) || [];
      g.push(k);
      kiracilar.set(k.tenantId, g);
    }
    const baslatilan: string[] = [];
    const kotaAcik = this.kota.acikMi(simdi);
    for (const [tenantId, grup] of kiracilar) {
      if (this.isleyenler.has(tenantId)) continue; // bu süreçte zaten bir öğe koşuyor
      const kuyruk = tenantKuyruguSec(grup);
      if (!kuyruk) continue;
      if (!kotaAcik) {
        // (a) kota dolu → kuyruk beklemeye (bir kez yaz)
        if (kuyruk.durum !== 'kota_bekliyor') {
          await this.db.ekipKuyruk.update({ where: { id: kuyruk.id }, data: { durum: 'kota_bekliyor' } }).catch(() => undefined);
          this.logger.warn(`[kuyruk] ${tenantId} ${kuyruk.id} Max kotası dolu; kota_bekliyor`);
        }
        continue;
      }
      // (b) tek koşu kilidi
      if (await this.surenKosuVarMi(tenantId)) continue;
      this.isleyenler.set(tenantId, kuyruk.id);
      baslatilan.push(kuyruk.id);
      void this.ogeIsle(kuyruk.id)
        .catch((e: any) => this.logger.error(`[kuyruk] ${kuyruk.id} öğe işleme hatası: ${e?.message || e}`))
        .finally(() => this.isleyenler.delete(tenantId));
    }
    return baslatilan;
  }

  /** Bu süreçte şu an işlenen kuyruklar (teşhis/test). */
  isleyenKuyruklar(): string[] {
    return Array.from(this.isleyenler.values());
  }

  /**
   * TEK ÖĞE: kuyruğu taze oku (Durdur gelmiş olabilir), takılı 'suruyor' öğeyi çöz (süreç yeniden başlamış olabilir),
   * sıradaki 'bekliyor' öğeyi koştur, sonucu yaz. Kota hatasında öğe 'bekliyor'da kalır, kuyruk 'kota_bekliyor'.
   */
  async ogeIsle(kuyrukId: string): Promise<{ islendi: boolean; isId?: string | null; durum?: string }> {
    const k: KuyrukSatiri | null = await this.db.ekipKuyruk.findUnique({ where: { id: kuyrukId } }).catch(() => null);
    if (!k || !(AKTIF_KUYRUK_DURUMLARI as string[]).includes(k.durum)) return { islendi: false, durum: k?.durum };
    const ogeler = ogeleriOku(k.ogeler);

    // Takılı 'suruyor' öğe: iş dosyası hâlâ koşuyorsa (başka süreç / drenaj) bekle; bittiyse sonucunu işle.
    for (const o of ogeler) {
      if (o.durum !== 'suruyor') continue;
      if (!o.isId) {
        o.durum = 'bekliyor';
        continue;
      }
      const is = await this.db.agentCommand.findUnique({ where: { id: o.isId }, select: { status: true, result: true } }).catch(() => null);
      if (is && (is.status === 'running' || is.status === 'pending')) return { islendi: false, durum: k.durum };
      const hata = is?.result?.hata ? String(is.result.hata) : null;
      o.durum = is?.status === 'done' && !hata ? 'bitti' : 'hata';
      o.hata = o.durum === 'hata' ? hata || 'Koşu yarım kaldı (sunucu yeniden başladı).' : null;
      o.bitisAt = new Date().toISOString();
    }

    const sira = siradakiOgeDizini(ogeler);
    if (sira < 0) {
      await this.db.ekipKuyruk.update({ where: { id: kuyrukId }, data: { durum: 'bitti', bitisAt: new Date(), aktifIsId: null, ogeler } });
      this.logger.log(`[kuyruk] ${k.tenantId} ${kuyrukId} bitti (${ogeler.filter((o) => o.durum === 'bitti').length}/${ogeler.length} başarılı)`);
      return { islendi: false, durum: 'bitti' };
    }
    const oge = ogeler[sira];
    const donem = oge.donem || (sablonDonemIstiyorMu(k.sablon) ? await this.beyannameDonemi(k.tenantId) : null);
    if (donem && !oge.donem) oge.donem = donem;
    const gorev = sablonDoldur(k.sablon, { mukellef: oge.ad, donem });
    oge.durum = 'suruyor';
    oge.isId = null;
    oge.hata = null;
    await this.db.ekipKuyruk.update({ where: { id: kuyrukId }, data: { durum: 'suruyor', aktifIsId: null, ogeler } });

    let isId: string | null = null;
    let bittiMi = false;
    let hata: string | null = null;
    /** Runner sonucundaki hata metni (iş 'done' kapansa da dolu olabilir: yarım cevap + SDK hatası) */
    let sonucHatasi: string | null = null;
    let aktifYazimi: Promise<unknown> = Promise.resolve();
    const kaynak = k.kaynak === 'rutin' ? 'rutin' : 'toplu';
    try {
      const sonuc = await this.runner.calistir({
        ajanId: k.ajanId,
        gorev,
        tenantId: k.tenantId,
        userId: k.olusturan || null,
        taxpayerId: oge.taxpayerId,
        dryRun: k.dryRun !== false,
        kaynak,
        kuyrukId,
        // SSE yok: sessiz tüketici — iş kimliğini (aktifIsId; Durdur bunu iptal eder) ve bitiş/hata olayını yakalar
        emit: (e) => {
          if (e.type === 'baslangic') {
            isId = e.isId;
            oge.isId = e.isId; // süren öğe ekranda iş paneline bağlansın
            aktifYazimi = this.db.ekipKuyruk.update({ where: { id: kuyrukId }, data: { aktifIsId: e.isId, ogeler } }).catch(() => undefined);
          } else if (e.type === 'done') bittiMi = true;
          else if (e.type === 'error' && !hata) hata = e.error;
        },
      });
      isId = isId || sonuc?.isId || null;
      sonucHatasi = sonuc?.hata || null;
      if (!bittiMi && !hata) hata = sonucHatasi || (isId ? null : 'Koşu başlatılamadı.');
      if (bittiMi) hata = null;
    } catch (e: any) {
      hata = e?.message || String(e);
    }
    await aktifYazimi;

    // Sunucu kapanırken açılmayan iş: öğe bekliyor'da kalsın, yeni kopya alsın.
    if (!isId && /Sunucu yeniden başlıyor/i.test(String(hata || ''))) {
      oge.durum = 'bekliyor';
      oge.isId = null;
      await this.db.ekipKuyruk.update({ where: { id: kuyrukId }, data: { aktifIsId: null, ogeler } }).catch(() => undefined);
      return { islendi: false, durum: k.durum };
    }

    // Sonucu TAZE kayda yaz (Durdur bu arada gelmiş olabilir; ogeler dizisi aynı sırada).
    const taze: KuyrukSatiri | null = await this.db.ekipKuyruk.findUnique({ where: { id: kuyrukId } }).catch(() => null);
    const sonOgeler = taze ? ogeleriOku(taze.ogeler) : ogeler;
    const hedef = sonOgeler[sira] && sonOgeler[sira].taxpayerId === oge.taxpayerId ? sonOgeler[sira] : sonOgeler.find((o) => o.durum === 'suruyor') || oge;
    // Kota: hata metni ya da (iş 'done' kapansa bile) runner sonucundaki hata metni kota kalıbına uyuyorsa öğe yeniden sıraya
    const kotaMetni = kotaHatasiMi(hata) ? hata : kotaHatasiMi(sonucHatasi) ? sonucHatasi : null;
    const kotaHatasi = Boolean(kotaMetni);
    if (kotaHatasi) {
      hata = kotaMetni;
      this.kota.hatadanIsaretle(kotaMetni); // runner işaretlemediyse (metin farklı yoldan geldiyse) burada işaretle
      hedef.durum = 'bekliyor';
      hedef.isId = isId;
      hedef.hata = hata;
      hedef.bitisAt = null;
    } else {
      hedef.durum = hata ? 'hata' : 'bitti';
      hedef.isId = isId;
      hedef.hata = hata;
      hedef.bitisAt = new Date().toISOString();
    }
    const durduruldu = taze?.durum === 'durduruldu';
    const kalanVar = siradakiOgeDizini(sonOgeler) >= 0;
    const yeniDurum = durduruldu ? 'durduruldu' : kotaHatasi ? 'kota_bekliyor' : kalanVar ? 'suruyor' : 'bitti';
    await this.db.ekipKuyruk.update({
      where: { id: kuyrukId },
      data: { durum: yeniDurum, aktifIsId: null, ogeler: sonOgeler, bitisAt: yeniDurum === 'bitti' ? new Date() : null },
    });
    this.logger.log(
      `[kuyruk] ${k.tenantId} ${kuyrukId} öğe ${sira + 1}/${sonOgeler.length} ${hedef.ad || 'ofis'} → ${hedef.durum}${isId ? ` (iş ${isId})` : ''}${hata ? `: ${String(hata).slice(0, 160)}` : ''}; kuyruk ${yeniDurum}`,
    );
    return { islendi: true, isId, durum: yeniDurum };
  }
}
