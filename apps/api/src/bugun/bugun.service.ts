import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hesaplaCariBakiyeler } from '../common/cari-bakiye';

/**
 * BUGÜNÜN İŞ LİSTESİ — gösterge panelinin üst alanı.
 *
 * Muzaffer Bey (2026-09-18): "tabloya bakınca bugün hangi işi yapmam gerektiğini,
 * ne geçtiğini, nelere dikkat etmem gerektiğini göreyim; karışık olmasın."
 * Bu yüzden satırlar VERİ KAYNAĞINA göre değil ACİLİYETE göre üç bölüme ayrılır:
 *   BUGÜN   : bugün yapılacak / bugün gelen (görev, onay, yeni e-Tebligat)
 *   GECİKEN : süresi geçmiş iş (görev, takılan mükellef, evrak gelmeyen, dolmuş belge, hatalı beyanname)
 *   DİKKAT  : yaklaşan / birikmiş (tahsilat, süresi dolacak belge, fatura yığını, ajan hatası)
 * Her satırda küçük "kaynak" etiketi vardır (Görev, Mükellef, Belge, Beyanname, Tahsilat...).
 * AI yok; kiracı başına 3 dk önbellek (force=1 ile atlanır).
 * Beyanname SON TARİHLERİ burada YOK — alttaki "Bu Hafta Takvim" gösteriyor.
 */

export type BugunVurgu = 'kritik' | 'uyari' | 'normal';
export type BugunKaynak = 'Görev' | 'Mükellef' | 'Belge' | 'Beyanname' | 'Tahsilat' | 'e-Tebligat' | 'Fatura' | 'Onay' | 'Ajan';

export type BugunSatir = {
  id: string;
  kaynak: BugunKaynak;
  metin: string;          // "İSMAİL COŞKUN"
  alt?: string;           // "7 gündür evrak işlenmeyi bekliyor"
  sayi?: number | null;   // sağda büyük sayı
  sayiEtiket?: string;    // "gün" | "TL"
  vurgu: BugunVurgu;
  href?: string;
  sira: number;           // bölüm içi sıralama (küçük = üstte)
};

export type BugunBolum = {
  key: 'bugun' | 'geciken' | 'dikkat';
  baslik: string;
  satirlar: BugunSatir[];
  bosMetin: string;
};

export type BugunResponse = {
  tarih: string;
  gun: number;
  saat: number;           // Türkiye saati (selam için)
  bolumler: BugunBolum[];
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

function trSimdi() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const year = pick('year'), month = pick('month'), day = pick('day'), hour = pick('hour');
  return { year, month, day, hour, key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
function adi(t: any): string {
  return String(t?.companyName || `${t?.firstName ?? ''} ${t?.lastName ?? ''}`.trim() || '—');
}
function gunFarki(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86400000); }

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

    const bugun: BugunSatir[] = [], geciken: BugunSatir[] = [], dikkat: BugunSatir[] = [];
    const guvenli = async (ad: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { this.logger.warn(`${ad}: ${e?.message}`); } };

    await Promise.all([
      // ---- GÖREVLER: bugün → BUGÜN, geçmiş → GECİKEN
      guvenli('görev', async () => {
        const tasks: any[] = await p.task.findMany({
          where: { tenantId, isTemplate: false, status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] }, dueDate: { lt: yarinBas } },
          select: { id: true, title: true, dueDate: true, taxpayerId: true },
          orderBy: { dueDate: 'asc' },
        });
        for (const t of tasks) {
          const ad = t.taxpayerId ? adById.get(t.taxpayerId) : undefined;
          const metin = ad && !String(t.title).toLocaleUpperCase('tr-TR').includes(ad.split(' ')[0]) ? `${t.title} — ${ad}` : t.title;
          const d = new Date(t.dueDate);
          if (d >= bugunBas) bugun.push({ id: `gv-${t.id}`, kaynak: 'Görev', metin, alt: 'bugün son gün', vurgu: 'uyari', href: '/panel/gorevler', sira: 20 });
          else {
            const gun = Math.max(1, gunFarki(d, bugunBas));
            geciken.push({ id: `gv-${t.id}`, kaynak: 'Görev', metin, alt: `${gun} gün gecikti`, sayi: gun, sayiEtiket: 'gün', vurgu: 'kritik', href: '/panel/gorevler', sira: 30 - Math.min(gun, 20) / 10 });
          }
        }
      }),

      // ---- AYLIK DURUM: evrak gelmeyen (ayın 12'sinden sonra) + takılan mükellefler → GECİKEN
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
        for (const t of taxpayers) {
          const s = map.get(t.id);
          if (s?.beyannameVerildi || verildi.has(t.id)) continue;
          if (!s || !s.evraklarGeldi) {
            // Evrak gelmemiş — ayın 12'sinden sonra listeye girer (ilk günlerde beklemek doğaldır)
            if (day <= 12) continue;
            const bekleme = gunFarki(t.startDate && new Date(t.startDate) > firstDay ? new Date(t.startDate) : firstDay, now);
            geciken.push({ id: `ev-${t.id}`, kaynak: 'Mükellef', metin: adi(t), alt: `${month}. ay evrakı gelmedi · ${bekleme} gün`, sayi: bekleme, sayiEtiket: 'gün', vurgu: day >= 20 ? 'kritik' : 'uyari', href: `/panel/mukellefler/${t.id}`, sira: 40 });
            continue;
          }
          const kdvHepsi = s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
          const stage = (s.kontrolEdildi || kdvHepsi) ? 'BEYAN' : s.evraklarIslendi ? 'KONTROL' : 'ISLENIYOR';
          const gun = gunFarki(new Date(s.updatedAt || firstDay), now);
          if (gun < esik) continue;
          geciken.push({ id: `tk-${t.id}`, kaynak: 'Mükellef', metin: adi(t), alt: `${gun} gündür ${ASAMA[stage]}`, sayi: gun, sayiEtiket: 'gün', vurgu: gun >= 10 ? 'kritik' : 'uyari', href: `/panel/mukellefler/${t.id}`, sira: 35 - Math.min(gun, 20) / 10 });
        }
      }),

      // ---- HATALI BEYANNAMELER (bu verilme dönemi) → GECİKEN
      guvenli('beyan', async () => {
        const donem = `${year}-${String(month).padStart(2, '0')}`;
        const by = month === 1 ? year - 1 : year, bm = month === 1 ? 12 : month - 1;
        const vergiDonem = `${by}-${String(bm).padStart(2, '0')}`;
        const rows: any[] = await p.beyanDurumu.findMany({
          where: { tenantId, durum: 'hatali', donem: { in: [donem, vergiDonem] }, ...(ids.length ? { taxpayerId: { in: ids } } : {}) },
          select: { id: true, taxpayerId: true, beyanTipi: true, donem: true, notlar: true },
        });
        for (const r of rows) {
          geciken.push({ id: `by-${r.id}`, kaynak: 'Beyanname', metin: `${BEYAN_ETIKET[r.beyanTipi] || r.beyanTipi} — ${adById.get(r.taxpayerId) || '—'}`, alt: `GİB'de hatalı · ${r.notlar ? String(r.notlar).slice(0, 60) : 'yeniden gönderilmeli'}`, vurgu: 'kritik', href: '/panel/beyannameler', sira: 10 });
        }
      }),

      // ---- BELGE SÜRELERİ: dolmuş → GECİKEN, hatırlatma penceresinde → DİKKAT
      guvenli('belge', async () => {
        const ufuk = new Date(now.getTime() + 60 * 86400000);
        const docs: any[] = await p.document.findMany({
          where: { isDeleted: false, expiresAt: { not: null, lte: ufuk }, taxpayer: { tenantId, isActive: true } },
          select: { id: true, title: true, expiresAt: true, reminderDays: true, taxpayerId: true },
          orderBy: { expiresAt: 'asc' }, take: 40,
        });
        for (const d of docs) {
          const kalan = gunFarki(bugunBas, new Date(d.expiresAt));
          const ad = adById.get(d.taxpayerId) || '—';
          if (kalan < 0) geciken.push({ id: `bl-${d.id}`, kaynak: 'Belge', metin: `${d.title} — ${ad}`, alt: `${-kalan} gün önce süresi doldu`, sayi: -kalan, sayiEtiket: 'gün', vurgu: 'kritik', href: `/panel/mukellefler/${d.taxpayerId}`, sira: 25 });
          else if (kalan <= (d.reminderDays || 30)) dikkat.push({ id: `bl-${d.id}`, kaynak: 'Belge', metin: `${d.title} — ${ad}`, alt: kalan === 0 ? 'bugün doluyor' : `${kalan} gün sonra doluyor`, sayi: kalan, sayiEtiket: 'gün', vurgu: kalan <= 7 ? 'uyari' : 'normal', href: `/panel/mukellefler/${d.taxpayerId}`, sira: 20 + kalan / 100 });
        }
      }),

      // ---- TAHSİLAT: en yüksek 5 açık bakiye → DİKKAT
      guvenli('tahsilat', async () => {
        const rows: any[] = await p.cariHareket.findMany({ where: { tenantId }, select: { taxpayerId: true, tip: true, tutar: true } });
        const bak = hesaplaCariBakiyeler(rows, new Set(ids));
        const borclu = [...bak.values()].filter((b) => b.bakiye > 0).sort((a, b) => b.bakiye - a.bakiye);
        const toplam = Math.round(borclu.reduce((s, b) => s + b.bakiye, 0));
        borclu.slice(0, 5).forEach((b, i) => dikkat.push({
          id: `th-${b.taxpayerId}`, kaynak: 'Tahsilat', metin: adById.get(b.taxpayerId) || '—',
          alt: i === 0 && borclu.length > 1 ? `açık bakiye · toplam ${borclu.length} mükellef, ${toplam.toLocaleString('tr-TR')} TL` : 'açık bakiye',
          sayi: Math.round(b.bakiye), sayiEtiket: 'TL', vurgu: b.bakiye >= 50000 ? 'uyari' : 'normal', href: `/panel/cari-kasa?mukellef=${b.taxpayerId}`, sira: 40 + i,
        }));
      }),

      // ---- e-TEBLİGAT: okunmamış → BUGÜN (yeni gelen varsa üstte)
      guvenli('tebligat', async () => {
        const rows: any[] = await p.portalDocument.findMany({ where: { tenantId, belgeTuru: 'E_TEBLIGAT', viewedAt: null }, select: { taxpayerId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
        if (!rows.length) return;
        const yeni = rows.filter((r) => new Date(r.createdAt) >= dun);
        const ilk = yeni[0] || rows[0];
        const ad = adById.get(ilk.taxpayerId) || '—';
        bugun.push({
          id: 'tb', kaynak: 'e-Tebligat',
          metin: yeni.length ? `${yeni.length} yeni e-Tebligat geldi` : `${rows.length} okunmamış e-Tebligat`,
          alt: yeni.length ? `${ad}${yeni.length > 1 ? ` +${yeni.length - 1}` : ''} · toplam ${rows.length} okunmamış` : `en son: ${ad}`,
          sayi: rows.length, vurgu: yeni.length ? 'kritik' : 'uyari', href: ilk.taxpayerId ? `/panel/mukellefler/${ilk.taxpayerId}` : '/panel/genel-sorgular', sira: 5,
        });
      }),

      // ---- ONAY KUYRUĞU → BUGÜN
      guvenli('onay', async () => {
        if (!p.pendingDecision?.count) return;
        const n = await p.pendingDecision.count({ where: { tenantId, durum: 'bekliyor' } });
        if (n) bugun.push({ id: 'on', kaynak: 'Onay', metin: `${n} AI kararı onayınızı bekliyor`, alt: 'fatura / işletme sınıflandırması', sayi: n, vurgu: 'uyari', href: '/panel/onay-kuyrugu', sira: 15 });
      }),

      // ---- FATURA YIĞINI: işlenmemiş toplam + en çok biriken 3 → DİKKAT; son 24 saat → BUGÜN bilgi
      guvenli('fatura', async () => {
        const grp: any[] = await p.eFaturaInbox.groupBy({ by: ['taxpayerId'], where: { tenantId, processedAt: null, isTransferred: false }, _count: { _all: true } });
        const toplam = grp.reduce((s, g) => s + (g._count?._all || 0), 0);
        if (toplam) {
          const enCok = grp.filter((g) => adById.has(g.taxpayerId)).sort((a, b) => b._count._all - a._count._all).slice(0, 3);
          dikkat.push({ id: 'fy', kaynak: 'Fatura', metin: `${toplam} işlenmemiş fatura birikti`, alt: enCok.map((g) => `${adById.get(g.taxpayerId)!.split(' ').slice(0, 2).join(' ')} ${g._count._all}`).join(' · '), sayi: toplam, vurgu: toplam >= 100 ? 'uyari' : 'normal', href: '/fatura-merkezi', sira: 10 });
        }
        const yeni = await p.eFaturaInbox.count({ where: { tenantId, syncedAt: { gte: dun } } });
        if (yeni) bugun.push({ id: 'fn', kaynak: 'Fatura', metin: `${yeni} yeni fatura düştü`, alt: 'son 24 saat · Fatura Merkezi', sayi: yeni, vurgu: 'normal', href: '/fatura-merkezi', sira: 50 });
      }),

      // ---- YENİ BELGE (son 24 saat) → BUGÜN bilgi
      guvenli('yeni belge', async () => {
        const n = await p.document.count({ where: { isDeleted: false, createdAt: { gte: dun }, taxpayer: { tenantId } } });
        if (n) bugun.push({ id: 'yb', kaynak: 'Belge', metin: `${n} yeni belge yüklendi`, alt: 'WhatsApp / portal / sürükle-bırak', sayi: n, vurgu: 'normal', href: '/panel/evraklar', sira: 55 });
      }),

      // ---- AJAN / ÇEKİM HATALARI (son 24 saat) → DİKKAT
      guvenli('ajan', async () => {
        const [ev, luca, mihsap] = await Promise.all([
          p.agentEvent.groupBy({ by: ['agent'], where: { tenantId, ts: { gte: dun }, status: { in: ['hata', 'HATA', 'ERROR', 'FAIL', 'FAILED', 'HATALI'] } }, _count: { _all: true } }).catch(() => []),
          p.lucaFetchJob.count({ where: { tenantId, status: 'failed', OR: [{ finishedAt: { gte: dun } }, { finishedAt: null, createdAt: { gte: dun } }] } }).catch(() => 0),
          p.mihsapFetchJob.count({ where: { tenantId, status: 'failed', OR: [{ finishedAt: { gte: dun } }, { finishedAt: null, createdAt: { gte: dun } }] } }).catch(() => 0),
        ]);
        const toplam = (ev as any[]).reduce((s, a) => s + (a._count?._all || 0), 0) + luca + mihsap;
        if (!toplam) return;
        const parca = (ev as any[]).map((a) => `${a.agent} ${a._count._all}`);
        if (luca) parca.push(`Luca çekim ${luca}`);
        if (mihsap) parca.push(`Mihsap çekim ${mihsap}`);
        dikkat.push({ id: 'aj', kaynak: 'Ajan', metin: `${toplam} ajan hatası (son 24 saat)`, alt: parca.join(' · '), sayi: toplam, vurgu: 'uyari', href: '/panel/ajanlar', sira: 30 });
      }),
    ]);

    const sirala = (a: BugunSatir[]) => a.sort((x, y) => x.sira - y.sira || (y.sayi || 0) - (x.sayi || 0));

    return {
      tarih: key, gun: day, saat: hour,
      bolumler: [
        { key: 'bugun', baslik: 'Bugün', satirlar: sirala(bugun), bosMetin: 'Bugün için bekleyen iş yok' },
        { key: 'geciken', baslik: 'Geciken', satirlar: sirala(geciken), bosMetin: 'Süresi geçmiş iş yok' },
        { key: 'dikkat', baslik: 'Dikkat', satirlar: sirala(dikkat), bosMetin: 'Dikkat gerektiren bir şey yok' },
      ],
      uretimZamani: now.toISOString(),
      onbellekten: false,
    };
  }
}
