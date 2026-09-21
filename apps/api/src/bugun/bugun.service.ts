import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hesaplaCariBakiyeler } from '../common/cari-bakiye';

/**
 * BUGÜNÜN İŞ LİSTESİ — gösterge panelinin üst alanı.
 *
 * Muzaffer Bey (2026-09-18): "bakınca bugün ne yapacağımı, ne geçtiğini, nelere dikkat
 * edeceğimi göreyim; karışık olmasın." Üç dar sütun (isimler kesiliyor, boş alan) REDDEDİLDİ.
 *
 * Model: KONU satırları. Aynı türden çok kayıt tek satırda toplanır ("18 görev gecikmiş"),
 * ayrıntı (`detay[]`) istenince açılır. Az sayıda kayıt (≤2) ayrı satır olur.
 *   BUGÜN   : bugün yapılacak / bugün gelen
 *   GECİKEN : süresi geçmiş
 *   DİKKAT  : yaklaşan / birikmiş
 * AI yok; kiracı başına 3 dk önbellek (force=1 ile atlanır).
 * Beyanname SON TARİHLERİ burada YOK — alttaki "Bu Hafta Takvim" gösteriyor.
 */

export type BugunVurgu = 'kritik' | 'uyari' | 'normal';
export type BugunKaynak = 'Görev' | 'Mükellef' | 'Belge' | 'Beyanname' | 'Tahsilat' | 'e-Tebligat' | 'Fatura' | 'Onay' | 'Ajan';
export type BugunBolumKey = 'bugun' | 'geciken' | 'dikkat';

export type BugunDetay = {
  id: string;
  metin: string;          // "AYŞEGÜL ARSLAN"
  alt?: string;           // "12 gündür evrak işlenmeyi bekliyor"
  sayi?: number | null;
  sayiEtiket?: string;
  href?: string;
  taxpayerId?: string;    // mükellef odaklı görünüm için
};

export type BugunKonu = {
  id: string;
  bolum: BugunBolumKey;
  kaynak: BugunKaynak;
  baslik: string;         // "18 görev gecikmiş"
  aciklama?: string;      // "en eski: GÖKHAN AKGÖZ NEVİ DEĞİŞİKLİĞİ · 90 gün"
  sayi?: number | null;   // sağdaki sayı
  sayiEtiket?: string;
  vurgu: BugunVurgu;
  href?: string;          // "Aç" bağlantısı
  detay?: BugunDetay[];   // açılır ayrıntı
  taxpayerId?: string;    // tekil satır bir mükellefe aitse
  sira: number;           // bölüm içi öncelik (küçük üstte)
  sayac?: { okunmamis: number; yeni: number; mukellef: number; suresiIcinde: number }; // e-Tebligat: gösterge paneli sayaç kartı (2026-09-21) — okunmamış = mükellef GİB'de açmadı; suresiIcinde = tebliğ tarihi gelmemiş
};

export type BugunAy = {
  ad: string;             // "Eylül"
  toplam: number;         // bu ay akıştaki aktif mükellef
  tamam: number;          // beyannamesi verilmiş
  yuzde: number;
  isGunuKaldi: number;    // ay sonuna kalan iş günü (bugün hariç)
  kdvSonGun: string;      // "28 Eylül Pazartesi"
  kdvKalanGun: number;
  haftaninSonIsGunu: boolean;
  asamalar: { evrakBekliyor: number; isleniyor: number; kontrol: number; beyan: number; tamam: number };
};

/** Son 7 günün belge akışı (üst banttaki mini çubuk grafik) */
export type BugunAkisGunu = { etiket: string; tarih: string; fatura: number; belge: number; bugun: boolean; haftaSonu: boolean };

export type BugunResponse = {
  tarih: string;
  gun: number;
  saat: number;
  ay: BugunAy;
  akis: BugunAkisGunu[];
  konular: BugunKonu[];
  uretimZamani: string;
  onbellekten: boolean;
};

const CACHE_TTL_MS = 3 * 60 * 1000;
const BEYAN_ETIKET: Record<string, string> = {
  KURUMLAR: 'Kurumlar', GELIR: 'Gelir', KDV1: 'KDV1', KDV2: 'KDV2', KDV4: 'KDV4', KDV9015: 'KDV9015',
  DAMGA: 'Damga', MUHSGK: 'MUHSGK', MUHSGK2: 'MUHSGK2', GGECICI: 'Gelir Geçici', KGECICI: 'Kurum Geçici',
  POSET: 'Poşet', BILDIRGE: 'SGK Bildirge', EDEFTER: 'e-Defter', OTV1: 'ÖTV1', OTV3A: 'ÖTV3A', OTV3B: 'ÖTV3B',
  OTV4: 'ÖTV4', KONAKLAMA: 'Konaklama', OIV: 'ÖİV', GMSI: 'GMSİ', TURIZM: 'Turizm Payı',
};
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUN_ADI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_SABIT_TATIL = new Set(['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']);
function isGunuMu(d: Date) {
  const g = d.getUTCDay();
  return !(g === 0 || g === 6 || TR_SABIT_TATIL.has(`${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`));
}
function utcGun(y: number, m: number, d: number) { return new Date(Date.UTC(y, m - 1, d, 12)); }

function trSimdi() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const year = pick('year'), month = pick('month'), day = pick('day'), hour = pick('hour');
  return { year, month, day, hour, key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
function adi(t: any): string {
  return String(t?.companyName || `${t?.firstName ?? ''} ${t?.lastName ?? ''}`.trim() || '—');
}
/** "KAYATAN MİMARLIK İNŞAAT SANAYİ TİCARET LİMİTED ŞİRKETİ" → "KAYATAN MİMARLIK" (özetlerde) */
function kisaAd(s: string, kelime = 2): string { return String(s).split(/\s+/).slice(0, kelime).join(' '); }
function gunFarki(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86400000); }
function tl(n: number) { return `${Math.round(n).toLocaleString('tr-TR')} TL`; }

@Injectable()
export class BugunService {
  private readonly logger = new Logger(BugunService.name);
  private cache = new Map<string, { ts: number; data: BugunResponse }>();

  constructor(private readonly prisma: PrismaService) {}

  async getBugun(tenantId: string, force = false): Promise<BugunResponse> {
    const c = this.cache.get(tenantId);
    if (!force && c && Date.now() - c.ts < CACHE_TTL_MS) return { ...c.data, saat: trSimdi().hour, onbellekten: true };
    const data = await this.build(tenantId);
    this.cache.set(tenantId, { ts: Date.now(), data });
    return data;
  }

  private async build(tenantId: string): Promise<BugunResponse> {
    const now = new Date();
    const { year, month, day, hour, key } = trSimdi();
    const bugunBas = new Date(`${key}T00:00:00+03:00`);
    const yarinBas = new Date(bugunBas.getTime() + 86400000);
    const dun = new Date(now.getTime() - 24 * 3600 * 1000);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    const p = this.prisma as any;

    const taxpayers: any[] = await p.taxpayer.findMany({
      where: {
        tenantId, isActive: true,
        NOT: { taxNumber: { startsWith: 'WHATSAPP-' } },
        OR: [{ startDate: null }, { startDate: { lte: lastDay } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: firstDay } }] }],
      },
      select: { id: true, companyName: true, firstName: true, lastName: true, startDate: true },
    }).catch(() => []);
    const adById = new Map<string, string>(taxpayers.map((t) => [t.id, adi(t)]));
    const ids = taxpayers.map((t) => t.id);

    const konular: BugunKonu[] = [];
    const asamalar = { evrakBekliyor: 0, isleniyor: 0, kontrol: 0, beyan: 0, tamam: 0 };
    const guvenli = async (ad: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { this.logger.warn(`${ad}: ${e?.message}`); } };

    /** ≤2 kayıt → ayrı satırlar; fazlası → tek konu + açılır ayrıntı */
    const topla = (o: { id: string; bolum: BugunBolumKey; kaynak: BugunKaynak; sira: number; vurgu: BugunVurgu; href?: string; sayiEtiket?: string; cogul: (n: number) => string; aciklama?: (d: BugunDetay[]) => string | undefined }, detay: BugunDetay[]) => {
      if (!detay.length) return;
      if (detay.length <= 2) {
        detay.forEach((d, i) => konular.push({ id: `${o.id}-${d.id}`, bolum: o.bolum, kaynak: o.kaynak, baslik: d.metin, aciklama: d.alt, sayi: d.sayi, sayiEtiket: d.sayiEtiket, vurgu: o.vurgu, href: d.href || o.href, taxpayerId: d.taxpayerId, sira: o.sira + i / 100 }));
        return;
      }
      konular.push({ id: o.id, bolum: o.bolum, kaynak: o.kaynak, baslik: o.cogul(detay.length), aciklama: o.aciklama?.(detay), sayi: detay.length, sayiEtiket: o.sayiEtiket, vurgu: o.vurgu, href: o.href, detay, sira: o.sira });
    };

    await Promise.all([
      // ---- GÖREVLER
      guvenli('görev', async () => {
        const tasks: any[] = await p.task.findMany({
          where: { tenantId, isTemplate: false, status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] }, dueDate: { lt: yarinBas } },
          select: { id: true, title: true, dueDate: true, taxpayerId: true },
          orderBy: { dueDate: 'asc' },
        });
        const adla = (t: any) => {
          const ad = t.taxpayerId ? adById.get(t.taxpayerId) : undefined;
          return ad && !String(t.title).toLocaleUpperCase('tr-TR').includes(ad.split(' ')[0]) ? `${t.title} — ${ad}` : String(t.title);
        };
        const bugunku = tasks.filter((t) => new Date(t.dueDate) >= bugunBas);
        const gecikenler = tasks.filter((t) => new Date(t.dueDate) < bugunBas);
        // Bugünün görevleri somut yapılacaklardır → her biri ayrı satır
        bugunku.forEach((t) => konular.push({ id: `gv-${t.id}`, bolum: 'bugun', kaynak: 'Görev', baslik: adla(t), aciklama: 'bugün son gün', vurgu: 'uyari', href: '/panel/gorevler', taxpayerId: t.taxpayerId || undefined, sira: 10 }));
        const detay = gecikenler.map((t) => { const gun = Math.max(1, gunFarki(new Date(t.dueDate), bugunBas)); return { id: t.id, metin: adla(t), alt: `${gun} gün gecikti`, sayi: gun, sayiEtiket: 'gün', href: '/panel/gorevler', taxpayerId: t.taxpayerId || undefined }; }).sort((a, b) => b.sayi - a.sayi);
        topla({ id: 'gv', bolum: 'geciken', kaynak: 'Görev', sira: 40, vurgu: 'kritik', href: '/panel/gorevler', cogul: (n) => `${n} görev gecikmiş`, aciklama: (d) => `en eski: ${kisaAd(d[0].metin, 4)} · ${d[0].sayi} gün` }, detay);
      }),

      // ---- AYLIK DURUM: evrak gelmeyen + takılan mükellefler → GECİKEN
      guvenli('aylık durum', async () => {
        if (!ids.length) return;
        const statuses: any[] = await p.taxpayerMonthlyStatus.findMany({ where: { tenantId, year, month, taxpayerId: { in: ids } } });
        const by = month === 1 ? year - 1 : year, bm = month === 1 ? 12 : month - 1;
        const verildi = new Set<string>();
        try {
          const k: any[] = await p.beyanKaydi.findMany({
            where: { tenantId, taxpayerId: { in: ids }, donem: `${by}-${String(bm).padStart(2, '0')}`, beyanTipi: { in: ['KDV1', 'KDV'] }, OR: [{ beyannameUrl: { not: null } }, { pdfUrl: { not: null } }] },
            select: { taxpayerId: true },
          });
          for (const x of k) verildi.add(x.taxpayerId);
        } catch {}
        const map = new Map(statuses.map((s) => [s.taxpayerId, s]));
        const esik = day <= 12 ? 10 : 5;
        const ASAMA: Record<string, string> = { ISLENIYOR: 'evrak işlenmeyi bekliyor', KONTROL: 'KDV kontrol bekliyor', BEYAN: 'beyanname bekliyor' };
        const evrakYok: BugunDetay[] = [], takili: BugunDetay[] = [];
        for (const t of taxpayers) {
          const s = map.get(t.id);
          if (s?.beyannameVerildi || verildi.has(t.id)) { asamalar.tamam++; continue; }
          if (!s || !s.evraklarGeldi) {
            asamalar.evrakBekliyor++;
            if (day <= 12) continue; // ayın ilk günlerinde beklemek doğaldır
            const bekleme = gunFarki(t.startDate && new Date(t.startDate) > firstDay ? new Date(t.startDate) : firstDay, now);
            evrakYok.push({ id: t.id, metin: adi(t), alt: `${bekleme} gündür bekleniyor`, sayi: bekleme, sayiEtiket: 'gün', href: `/panel/mukellefler/${t.id}`, taxpayerId: t.id });
            continue;
          }
          const kdvHepsi = s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
          const stage = (s.kontrolEdildi || kdvHepsi) ? 'BEYAN' : s.evraklarIslendi ? 'KONTROL' : 'ISLENIYOR';
          if (stage === 'BEYAN') asamalar.beyan++; else if (stage === 'KONTROL') asamalar.kontrol++; else asamalar.isleniyor++;
          const gun = gunFarki(new Date(s.updatedAt || firstDay), now);
          if (gun < esik) continue;
          takili.push({ id: t.id, metin: adi(t), alt: `${gun} gündür ${ASAMA[stage]}`, sayi: gun, sayiEtiket: 'gün', href: `/panel/mukellefler/${t.id}`, taxpayerId: t.id });
        }
        takili.sort((a, b) => (b.sayi || 0) - (a.sayi || 0));
        evrakYok.sort((a, b) => a.metin.localeCompare(b.metin, 'tr'));
        topla({ id: 'tk', bolum: 'geciken', kaynak: 'Mükellef', sira: 20, vurgu: 'kritik', href: '/panel/is-yuku', cogul: (n) => `${n} mükellef ${esik}+ gündür aynı aşamada bekliyor`, aciklama: (d) => d.slice(0, 3).map((x) => `${kisaAd(x.metin)} ${x.sayi}g`).join(' · ') }, takili);
        topla({ id: 'ev', bolum: 'geciken', kaynak: 'Mükellef', sira: 25, vurgu: day >= 20 ? 'kritik' : 'uyari', href: '/panel/is-yuku', cogul: (n) => `${n} mükellefin ${AY_ADI[month - 1]} evrakı gelmedi`, aciklama: (d) => d.slice(0, 4).map((x) => kisaAd(x.metin)).join(' · ') + (d.length > 4 ? ' …' : '') }, evrakYok);
      }),

      // ---- HATALI BEYANNAMELER → GECİKEN
      guvenli('beyan', async () => {
        const donem = `${year}-${String(month).padStart(2, '0')}`;
        const by = month === 1 ? year - 1 : year, bm = month === 1 ? 12 : month - 1;
        const rows: any[] = await p.beyanDurumu.findMany({
          where: { tenantId, durum: 'hatali', donem: { in: [donem, `${by}-${String(bm).padStart(2, '0')}`] }, ...(ids.length ? { taxpayerId: { in: ids } } : {}) },
          select: { id: true, taxpayerId: true, beyanTipi: true, notlar: true },
        });
        const detay = rows.map((r) => ({ id: r.id, metin: `${BEYAN_ETIKET[r.beyanTipi] || r.beyanTipi} — ${adById.get(r.taxpayerId) || '—'}`, alt: `GİB'de hatalı · ${r.notlar ? String(r.notlar).slice(0, 60) : 'yeniden gönderilmeli'}`, href: '/panel/beyannameler', taxpayerId: r.taxpayerId }));
        topla({ id: 'by', bolum: 'geciken', kaynak: 'Beyanname', sira: 10, vurgu: 'kritik', href: '/panel/beyannameler', cogul: (n) => `${n} beyanname GİB'de hatalı`, aciklama: (d) => d.slice(0, 3).map((x) => x.metin).join(' · ') }, detay);
      }),

      // ---- BELGE SÜRELERİ: dolmuş → GECİKEN, hatırlatma penceresinde → DİKKAT
      guvenli('belge', async () => {
        const ufuk = new Date(now.getTime() + 60 * 86400000);
        const docs: any[] = await p.document.findMany({
          where: { isDeleted: false, expiresAt: { not: null, lte: ufuk }, taxpayer: { tenantId, isActive: true } },
          select: { id: true, title: true, expiresAt: true, reminderDays: true, taxpayerId: true },
          orderBy: { expiresAt: 'asc' }, take: 60,
        });
        const dolmus: BugunDetay[] = [], dolacak: BugunDetay[] = [];
        for (const d of docs) {
          const kalan = gunFarki(bugunBas, new Date(d.expiresAt));
          const ad = adById.get(d.taxpayerId) || '—';
          if (kalan < 0) dolmus.push({ id: d.id, metin: `${d.title} — ${ad}`, alt: `${-kalan} gün önce doldu`, sayi: -kalan, sayiEtiket: 'gün', href: `/panel/mukellefler/${d.taxpayerId}`, taxpayerId: d.taxpayerId });
          else if (kalan <= (d.reminderDays || 30)) dolacak.push({ id: d.id, metin: `${d.title} — ${ad}`, alt: kalan === 0 ? 'bugün doluyor' : `${kalan} gün sonra doluyor`, sayi: kalan, sayiEtiket: 'gün', href: `/panel/mukellefler/${d.taxpayerId}`, taxpayerId: d.taxpayerId });
        }
        topla({ id: 'bd', bolum: 'geciken', kaynak: 'Belge', sira: 30, vurgu: 'kritik', href: '/panel/evraklar', cogul: (n) => `${n} belgenin süresi doldu`, aciklama: (d) => d.slice(0, 3).map((x) => x.metin).join(' · ') }, dolmus);
        topla({ id: 'bk', bolum: 'dikkat', kaynak: 'Belge', sira: 20, vurgu: 'uyari', href: '/panel/evraklar', cogul: (n) => `${n} belgenin süresi yakında doluyor`, aciklama: (d) => d.slice(0, 3).map((x) => `${x.metin} (${x.sayi}g)`).join(' · ') }, dolacak);
      }),

      // ---- TAHSİLAT → DİKKAT (tek satır + açılır liste)
      guvenli('tahsilat', async () => {
        const rows: any[] = await p.cariHareket.findMany({ where: { tenantId }, select: { taxpayerId: true, tip: true, tutar: true } });
        const bak = hesaplaCariBakiyeler(rows, new Set(ids));
        const borclu = [...bak.values()].filter((b) => b.bakiye > 0).sort((a, b) => b.bakiye - a.bakiye);
        if (!borclu.length) return;
        const toplam = borclu.reduce((s, b) => s + b.bakiye, 0);
        const detay: BugunDetay[] = borclu.slice(0, 12).map((b) => ({ id: b.taxpayerId, metin: adById.get(b.taxpayerId) || '—', alt: 'açık bakiye', sayi: Math.round(b.bakiye), sayiEtiket: 'TL', href: `/panel/cari-kasa?mukellef=${b.taxpayerId}`, taxpayerId: b.taxpayerId }));
        konular.push({
          id: 'th', bolum: 'dikkat', kaynak: 'Tahsilat',
          baslik: `${borclu.length} mükellefte ${tl(toplam)} açık bakiye`,
          aciklama: `en yüksek: ${detay.slice(0, 3).map((d) => `${kisaAd(d.metin)} ${tl(d.sayi || 0)}`).join(' · ')}`,
          sayi: Math.round(toplam), sayiEtiket: 'TL', vurgu: 'uyari', href: '/panel/cari-kasa', detay, sira: 40,
        });
      }),

      // ---- e-TEBLİGAT → BUGÜN
      // "Okunmamış" = GİB e-Tebligat sisteminde MÜKELLEFİN henüz açmadığı tebligat (raw.mukellefOkumaZamani boş);
      // gece sorgusu mevcut kayıtların okuma zamanını da tazeler. Portalda PDF'in açılıp açılmaması (viewedAt) sayılmaz
      // (Muzaffer Bey 2026-09-21: "toplam gelen değil, okunmamış tebligat sayısı olsun"). Tebliğ tarihi geçmemiş olanlar
      // (5 günlük süre içinde) ayrıca sayılır: en acil olanlar.
      guvenli('tebligat', async () => {
        const rows: any[] = await p.$queryRaw`
          select "taxpayerId", "createdAt", "receivedAt"
          from portal_documents
          where "tenantId" = ${tenantId} and "belgeTuru" = 'E_TEBLIGAT'
            and nullif(trim(coalesce(raw->>'mukellefOkumaZamani', '')), '') is null
          order by "createdAt" desc
          limit 5000`;
        if (!rows.length) return;
        const yeni = rows.filter((r) => new Date(r.createdAt) >= dun);
        const suresiIcinde = rows.filter((r) => r.receivedAt && new Date(r.receivedAt) > now).length;
        const perTp = new Map<string, { n: number; yeni: number }>();
        for (const r of rows) { const k = r.taxpayerId || '?'; const c = perTp.get(k) || { n: 0, yeni: 0 }; c.n++; if (new Date(r.createdAt) >= dun) c.yeni++; perTp.set(k, c); }
        const detay: BugunDetay[] = [...perTp.entries()].sort((a, b) => b[1].yeni - a[1].yeni || b[1].n - a[1].n).slice(0, 12)
          .map(([tp, c]) => ({ id: tp, metin: adById.get(tp) || '—', alt: c.yeni ? `${c.yeni} yeni · ${c.n} okunmamış` : `${c.n} okunmamış`, sayi: c.n, href: `/panel/mukellefler/${tp}`, taxpayerId: tp !== '?' ? tp : undefined }));
        konular.push({
          id: 'tb', bolum: 'bugun', kaynak: 'e-Tebligat',
          baslik: yeni.length ? `${yeni.length} yeni e-Tebligat geldi` : `${rows.length} okunmamış e-Tebligat`,
          aciklama: `${perTp.size} mükellef · mükellef henüz okumadı${suresiIcinde ? ` · ${suresiIcinde} tebliğ süresi içinde` : ''} · ${detay.slice(0, 3).map((d) => kisaAd(d.metin)).join(' · ')}`,
          sayi: rows.length, vurgu: yeni.length || suresiIcinde ? 'kritik' : 'uyari', href: '/panel/ajanlar/tebligat', detay, sira: 5,
          sayac: { okunmamis: rows.length, yeni: yeni.length, mukellef: perTp.size, suresiIcinde },
        });
      }),

      // ---- ONAY KUYRUĞU → BUGÜN
      guvenli('onay', async () => {
        if (!p.pendingDecision?.count) return;
        const n = await p.pendingDecision.count({ where: { tenantId, durum: 'bekliyor' } });
        if (n) konular.push({ id: 'on', bolum: 'bugun', kaynak: 'Onay', baslik: `${n} AI kararı onayınızı bekliyor`, aciklama: 'fatura / işletme sınıflandırması', sayi: n, vurgu: 'uyari', href: '/panel/onay-kuyrugu', sira: 15 });
      }),

      // ---- FATURA: yığın → DİKKAT; son 24 saat → BUGÜN
      guvenli('fatura', async () => {
        const grp: any[] = await p.eFaturaInbox.groupBy({ by: ['taxpayerId'], where: { tenantId, processedAt: null, isTransferred: false }, _count: { _all: true } });
        const toplam = grp.reduce((s, g) => s + (g._count?._all || 0), 0);
        if (toplam) {
          const sirali = grp.filter((g) => adById.has(g.taxpayerId)).sort((a, b) => b._count._all - a._count._all);
          const detay: BugunDetay[] = sirali.slice(0, 12).map((g) => ({ id: g.taxpayerId, metin: adById.get(g.taxpayerId)!, alt: 'işlenmemiş fatura', sayi: g._count._all, href: '/fatura-merkezi', taxpayerId: g.taxpayerId }));
          konular.push({ id: 'fy', bolum: 'dikkat', kaynak: 'Fatura', baslik: `${toplam.toLocaleString('tr-TR')} işlenmemiş fatura birikti`, aciklama: `${sirali.length} mükellef · ${detay.slice(0, 3).map((d) => `${kisaAd(d.metin)} ${d.sayi}`).join(' · ')}`, sayi: toplam, vurgu: toplam >= 100 ? 'uyari' : 'normal', href: '/fatura-merkezi', detay, sira: 10 });
        }
        const yeniGrp: any[] = await p.eFaturaInbox.groupBy({ by: ['taxpayerId'], where: { tenantId, syncedAt: { gte: dun } }, _count: { _all: true } }).catch(() => []);
        const yeni = yeniGrp.reduce((s, g) => s + (g._count?._all || 0), 0);
        if (yeni) {
          const detay: BugunDetay[] = yeniGrp.filter((g) => adById.has(g.taxpayerId)).sort((a, b) => b._count._all - a._count._all).slice(0, 12).map((g) => ({ id: g.taxpayerId, metin: adById.get(g.taxpayerId)!, alt: 'yeni fatura', sayi: g._count._all, href: '/fatura-merkezi', taxpayerId: g.taxpayerId }));
          konular.push({ id: 'fn', bolum: 'bugun', kaynak: 'Fatura', baslik: `${yeni} yeni fatura düştü`, aciklama: `son 24 saat · ${detay.slice(0, 3).map((d) => `${kisaAd(d.metin)} ${d.sayi}`).join(' · ')}`, sayi: yeni, vurgu: 'normal', href: '/fatura-merkezi', detay, sira: 40 });
        }
      }),

      // ---- YENİ BELGE (son 24 saat) → BUGÜN
      guvenli('yeni belge', async () => {
        const docs: any[] = await p.document.findMany({ where: { isDeleted: false, createdAt: { gte: dun }, taxpayer: { tenantId } }, select: { id: true, title: true, taxpayerId: true }, orderBy: { createdAt: 'desc' }, take: 12 });
        const n = await p.document.count({ where: { isDeleted: false, createdAt: { gte: dun }, taxpayer: { tenantId } } });
        if (!n) return;
        const detay: BugunDetay[] = docs.map((d) => ({ id: d.id, metin: `${d.title} — ${adById.get(d.taxpayerId) || '—'}`, href: `/panel/mukellefler/${d.taxpayerId}`, taxpayerId: d.taxpayerId }));
        konular.push({ id: 'yb', bolum: 'bugun', kaynak: 'Belge', baslik: `${n} yeni belge yüklendi`, aciklama: `${[...new Set(docs.map((d) => adById.get(d.taxpayerId)).filter(Boolean))].slice(0, 3).map((a) => kisaAd(a as string)).join(' · ')}`, sayi: n, vurgu: 'normal', href: '/panel/evraklar', detay, sira: 50 });
      }),

      // ---- AJAN / ÇEKİM HATALARI (son 24 saat) → DİKKAT
      guvenli('ajan', async () => {
        const [ev, luca, mihsap] = await Promise.all([
          p.agentEvent.groupBy({ by: ['agent'], where: { tenantId, ts: { gte: dun }, status: { in: ['hata', 'HATA', 'ERROR', 'FAIL', 'FAILED', 'HATALI'] } }, _count: { _all: true } }).catch(() => []),
          p.lucaFetchJob.count({ where: { tenantId, status: 'failed', OR: [{ finishedAt: { gte: dun } }, { finishedAt: null, createdAt: { gte: dun } }] } }).catch(() => 0),
          p.mihsapFetchJob.count({ where: { tenantId, status: 'failed', OR: [{ finishedAt: { gte: dun } }, { finishedAt: null, createdAt: { gte: dun } }] } }).catch(() => 0),
        ]);
        const detay: BugunDetay[] = (ev as any[]).map((a) => ({ id: a.agent, metin: `${a.agent} ajanı`, alt: 'hata', sayi: a._count._all, href: '/panel/ajanlar' }));
        if (luca) detay.push({ id: 'luca', metin: 'Luca çekimi', alt: 'başarısız iş', sayi: luca, href: '/panel/ajanlar/luca' });
        if (mihsap) detay.push({ id: 'mihsap', metin: 'Mihsap çekimi', alt: 'başarısız iş', sayi: mihsap, href: '/panel/ajanlar/mihsap' });
        const toplam = detay.reduce((s, d) => s + (d.sayi || 0), 0);
        if (!toplam) return;
        konular.push({ id: 'aj', bolum: 'dikkat', kaynak: 'Ajan', baslik: `${toplam} ajan hatası (son 24 saat)`, aciklama: detay.map((d) => `${d.metin} ${d.sayi}`).join(' · '), sayi: toplam, vurgu: 'uyari', href: '/panel/ajanlar', detay: detay.length > 1 ? detay : undefined, sira: 30 });
      }),
    ]);

    konular.sort((a, b) => a.sira - b.sira || (b.sayi || 0) - (a.sayi || 0));

    // ---- AY İLERLEMESİ (üst bant halkası): aylık durumdan tamam/toplam + kalan iş günü + KDV son günü
    let tamam = 0;
    try {
      const by = month === 1 ? year - 1 : year, bm = month === 1 ? 12 : month - 1;
      const [st, kayit] = await Promise.all([
        ids.length ? p.taxpayerMonthlyStatus.findMany({ where: { tenantId, year, month, taxpayerId: { in: ids }, beyannameVerildi: true }, select: { taxpayerId: true } }) : [],
        ids.length ? p.beyanKaydi.findMany({ where: { tenantId, taxpayerId: { in: ids }, donem: `${by}-${String(bm).padStart(2, '0')}`, beyanTipi: { in: ['KDV1', 'KDV'] }, OR: [{ beyannameUrl: { not: null } }, { pdfUrl: { not: null } }] }, select: { taxpayerId: true } }) : [],
      ]);
      tamam = new Set([...(st as any[]).map((x) => x.taxpayerId), ...(kayit as any[]).map((x) => x.taxpayerId)]).size;
    } catch (e: any) { this.logger.warn(`ay ilerlemesi: ${e?.message}`); }
    const sonGun = new Date(year, month, 0).getDate();
    let isGunuKaldi = 0;
    for (let d = day + 1; d <= sonGun; d++) if (isGunuMu(utcGun(year, month, d))) isGunuKaldi++;
    let kdv = utcGun(year, month, Math.min(28, sonGun));
    while (!isGunuMu(kdv)) kdv.setUTCDate(kdv.getUTCDate() + 1);
    const bugunUtc = utcGun(year, month, day);
    const yarin = utcGun(year, month, day); yarin.setUTCDate(yarin.getUTCDate() + 1);
    let sonrakiIsGunu = new Date(yarin); while (!isGunuMu(sonrakiIsGunu)) sonrakiIsGunu.setUTCDate(sonrakiIsGunu.getUTCDate() + 1);
    const ay: BugunAy = {
      ad: AY_ADI[month - 1], toplam: ids.length, tamam,
      yuzde: ids.length ? Math.round((tamam / ids.length) * 100) : 0,
      isGunuKaldi,
      kdvSonGun: `${kdv.getUTCDate()} ${AY_ADI[kdv.getUTCMonth()]} ${GUN_ADI[kdv.getUTCDay()]}`,
      kdvKalanGun: Math.round((kdv.getTime() - bugunUtc.getTime()) / 86400000),
      haftaninSonIsGunu: isGunuMu(bugunUtc) && sonrakiIsGunu.getUTCDay() === 1,
      asamalar,
    };

    // ---- SON 7 GÜN BELGE AKIŞI (fatura kutusu + yüklenen belge, Türkiye günü)
    const akis: BugunAkisGunu[] = [];
    try {
      const KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
      const gunKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      const baslangic = new Date(bugunBas.getTime() - 6 * 86400000);
      const [fat, bel] = await Promise.all([
        p.eFaturaInbox.findMany({ where: { tenantId, syncedAt: { gte: baslangic } }, select: { syncedAt: true } }).catch(() => []),
        p.document.findMany({ where: { isDeleted: false, createdAt: { gte: baslangic }, taxpayer: { tenantId } }, select: { createdAt: true } }).catch(() => []),
      ]);
      const say = new Map<string, { fatura: number; belge: number }>();
      for (const f of fat as any[]) { const k = gunKey(new Date(f.syncedAt)); const c = say.get(k) || { fatura: 0, belge: 0 }; c.fatura++; say.set(k, c); }
      for (const b of bel as any[]) { const k = gunKey(new Date(b.createdAt)); const c = say.get(k) || { fatura: 0, belge: 0 }; c.belge++; say.set(k, c); }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(bugunBas.getTime() - i * 86400000 + 12 * 3600000);
        const k = gunKey(d);
        const c = say.get(k) || { fatura: 0, belge: 0 };
        const dow = new Date(`${k}T12:00:00+03:00`).getDay();
        akis.push({ etiket: KISA[dow], tarih: k, fatura: c.fatura, belge: c.belge, bugun: i === 0, haftaSonu: dow === 0 || dow === 6 });
      }
    } catch (e: any) { this.logger.warn(`akış: ${e?.message}`); }

    return { tarih: key, gun: day, saat: hour, ay, akis, konular, uretimZamani: now.toISOString(), onbellekten: false };
  }
}
