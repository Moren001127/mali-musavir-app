import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hesaplaCariBakiyeler } from '../common/cari-bakiye';

/**
 * BUGÜNÜN İŞ LİSTESİ — gösterge panelinin üst alanı.
 *
 * Eski "AI brifing" 20+ veriyi tek cümleye sıkıştırıyordu (bilgi kaybı + 30 dk
 * önbellek bayatlığı). Bu servis aynı verileri AI'sız, İSİMLİ ve TIKLANABİLİR
 * satırlar hâlinde döner; her satır bir aksiyondur:
 *   (Son tarihler grubu 2026-09-18'de kaldırıldı — alttaki 'Bu Hafta Takvim' zaten gösteriyor.)
 *   - Takılan        : uzun süredir aynı aşamada bekleyen mükellefler
 *   - Tahsilat       : en yüksek açık bakiyeler
 *   - Görevler       : bugün + geciken
 *   - Dünden beri    : son 24 saatte gelen e-Tebligat / fatura / belge / hata
 *
 * Önbellek: kiracı başına 3 dk (force=1 ile atlanır).
 */

export type BugunVurgu = 'kritik' | 'uyari' | 'normal' | 'tamam';

export type BugunSatir = {
  id: string;
  metin: string;          // "KDV1 · 28 Eylül Pazartesi"
  alt?: string;           // "14 / 52 mükellef kaldı"
  sayi?: number | null;   // sağda büyük gösterilecek sayı (kalan, gün, TL)
  sayiEtiket?: string;    // "kaldı" | "gün" | "TL"
  vurgu: BugunVurgu;
  href?: string;
};

export type BugunGrup = {
  key: 'takilan' | 'tahsilat' | 'gorev' | 'dun';
  baslik: string;
  satirlar: BugunSatir[];
  toplam?: number;        // listelenenden fazlası varsa (+N)
  ozet?: string;          // başlıkta küçük özet ("58 mükellef · 1,7 M TL")
  bosMetin: string;       // satır yoksa gösterilecek sakin metin
  href?: string;          // grup başlığı tıklanınca
};

export type BugunResponse = {
  tarih: string;          // yyyy-mm-dd
  gun: number;            // ayın günü
  odak: string | null;    // tek satır: bugün önce ne?
  odakHref?: string;
  gruplar: BugunGrup[];
  uretimZamani: string;
  onbellekten: boolean;
};

const CACHE_TTL_MS = 3 * 60 * 1000;

function trBugun(): { year: number; month: number; day: number; key: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const year = pick('year'), month = pick('month'), day = pick('day');
  return { year, month, day, key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
function utcNoon(y: number, m: number, d: number) { return new Date(Date.UTC(y, m - 1, d, 12)); }
function adi(t: any): string {
  return String(t?.companyName || `${t?.firstName ?? ''} ${t?.lastName ?? ''}`.trim() || '—');
}
function tl(n: number) { return `${Math.round(n).toLocaleString('tr-TR')} TL`; }

@Injectable()
export class BugunService {
  private readonly logger = new Logger(BugunService.name);
  private cache = new Map<string, { ts: number; data: BugunResponse }>();

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getBugun(tenantId: string, force = false): Promise<BugunResponse> {
    const c = this.cache.get(tenantId);
    if (!force && c && Date.now() - c.ts < CACHE_TTL_MS) return { ...c.data, onbellekten: true };
    const data = await this.build(tenantId);
    this.cache.set(tenantId, { ts: Date.now(), data });
    return data;
  }

  private async build(tenantId: string): Promise<BugunResponse> {
    const now = new Date();
    const { year, month, day, key } = trBugun();
    const bugun = utcNoon(year, month, day);
    const dun = new Date(now.getTime() - 24 * 3600 * 1000);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);

    const taxpayers: any[] = await (this.prisma as any).taxpayer.findMany({
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

    const [takilan, tahsilat, gorev, dunGrubu] = await Promise.all([
      this.takilanlar(tenantId, taxpayers, year, month, day, now, firstDay).catch((e) => { this.logger.warn(`takılan: ${e?.message}`); return this.bosGrup('takilan'); }),
      this.tahsilat(tenantId, ids, adById).catch((e) => { this.logger.warn(`tahsilat: ${e?.message}`); return this.bosGrup('tahsilat'); }),
      this.gorevler(tenantId, bugun, adById).catch((e) => { this.logger.warn(`görev: ${e?.message}`); return this.bosGrup('gorev'); }),
      this.dundenBeri(tenantId, dun, adById).catch((e) => { this.logger.warn(`dün: ${e?.message}`); return this.bosGrup('dun'); }),
    ]);

    const gruplar = [takilan, tahsilat, gorev, dunGrubu];
    const odak = this.odakSec(gruplar, day);

    return {
      tarih: key, gun: day,
      odak: odak?.metin ?? null, odakHref: odak?.href,
      gruplar,
      uretimZamani: now.toISOString(),
      onbellekten: false,
    };
  }

  private bosGrup(key: BugunGrup['key']): BugunGrup {
    const tanim: Record<BugunGrup['key'], { baslik: string; bos: string; href: string }> = {
      takilan:     { baslik: 'Takılan Mükellefler', bos: 'Uzun süredir bekleyen mükellef yok', href: '/panel/is-yuku' },
      tahsilat:    { baslik: 'Tahsilat', bos: 'Açık bakiye yok', href: '/panel/cari-kasa' },
      gorev:       { baslik: 'Görevler', bos: 'Bugün ve geciken görev yok', href: '/panel/gorevler' },
      dun:         { baslik: 'Dünden Beri', bos: 'Son 24 saatte yeni bir şey gelmedi', href: '/panel/bildirimler' },
    };
    const t = tanim[key];
    return { key, baslik: t.baslik, satirlar: [], bosMetin: t.bos, href: t.href };
  }

  // ---------------- TAKILAN MÜKELLEFLER ----------------
  private async takilanlar(tenantId: string, taxpayers: any[], year: number, month: number, day: number, now: Date, firstDay: Date): Promise<BugunGrup> {
    const g = this.bosGrup('takilan');
    if (!taxpayers.length) return g;
    const ids = taxpayers.map((t) => t.id);
    const statuses: any[] = await (this.prisma as any).taxpayerMonthlyStatus.findMany({ where: { tenantId, year, month, taxpayerId: { in: ids } } });
    // Beyanname dönemi = işlem ayı − 1; KDV1 kaydında PDF/URL varsa "verildi" say (Aylık Takip ile aynı kural)
    const by = month === 1 ? year - 1 : year, bm = month === 1 ? 12 : month - 1;
    const verildi = new Set<string>();
    try {
      const k: any[] = await (this.prisma as any).beyanKaydi.findMany({
        where: { tenantId, taxpayerId: { in: ids }, donem: `${by}-${String(bm).padStart(2, '0')}`, beyanTipi: { in: ['KDV1', 'KDV'] }, OR: [{ beyannameUrl: { not: null } }, { pdfUrl: { not: null } }] },
        select: { taxpayerId: true },
      });
      for (const x of k) verildi.add(x.taxpayerId);
    } catch {}
    const map = new Map(statuses.map((s) => [s.taxpayerId, s]));
    // Ayın ilk 12 günü evrak/işlem gecikmesi doğaldır → eşik yumuşak (10 gün), sonrası 5 gün
    const esik = day <= 12 ? 10 : 5;
    const ASAMA: Record<string, string> = { ISLENIYOR: 'evrak işlenmeyi bekliyor', KONTROL: 'KDV kontrol bekliyor', BEYAN: 'beyanname bekliyor' };
    const rows: Array<BugunSatir & { gun: number }> = [];
    for (const t of taxpayers) {
      const s = map.get(t.id);
      if (!s) continue; // hiç işaret yoksa "evrak bekliyor" → bu grupta değil
      if (s.beyannameVerildi || verildi.has(t.id)) continue;
      const kdvHepsi = s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
      let stage: string | null = null;
      if (s.kontrolEdildi || kdvHepsi) stage = 'BEYAN';
      else if (s.evraklarIslendi) stage = 'KONTROL';
      else if (s.evraklarGeldi) stage = 'ISLENIYOR';
      if (!stage) continue;
      const gun = Math.floor((now.getTime() - new Date(s.updatedAt || firstDay).getTime()) / 86400000);
      if (gun < esik) continue;
      rows.push({
        id: `tk-${t.id}`, metin: adi(t), alt: `${gun} gündür ${ASAMA[stage]}`,
        sayi: gun, sayiEtiket: 'gün', vurgu: gun >= 10 ? 'kritik' : 'uyari',
        href: `/panel/mukellefler/${t.id}`, gun,
      });
    }
    rows.sort((a, b) => b.gun - a.gun);
    g.toplam = rows.length;
    g.satirlar = rows.slice(0, 5).map(({ gun: _g, ...s }) => s);
    return g;
  }

  // ---------------- TAHSİLAT ----------------
  private async tahsilat(tenantId: string, ids: string[], adById: Map<string, string>): Promise<BugunGrup> {
    const g = this.bosGrup('tahsilat');
    const rows: any[] = await (this.prisma as any).cariHareket.findMany({ where: { tenantId }, select: { taxpayerId: true, tip: true, tutar: true } });
    const bak = hesaplaCariBakiyeler(rows, new Set(ids));
    const borclu = [...bak.values()].filter((b) => b.bakiye > 0).sort((a, b) => b.bakiye - a.bakiye);
    const toplam = borclu.reduce((s, b) => s + b.bakiye, 0);
    g.toplam = borclu.length;
    g.satirlar = borclu.slice(0, 5).map((b) => ({
      id: `th-${b.taxpayerId}`, metin: adById.get(b.taxpayerId) || '—', alt: 'açık bakiye',
      sayi: Math.round(b.bakiye), sayiEtiket: 'TL',
      vurgu: b.bakiye >= 50000 ? 'uyari' : 'normal',
      href: `/panel/cari-kasa?mukellef=${b.taxpayerId}`,
    }));
    if (borclu.length) g.ozet = `${borclu.length} mükellef · ${tl(toplam)}`;
    return g;
  }

  // ---------------- GÖREVLER ----------------
  private async gorevler(tenantId: string, bugun: Date, adById: Map<string, string>): Promise<BugunGrup> {
    const g = this.bosGrup('gorev');
    const yarin = new Date(bugun); yarin.setUTCDate(yarin.getUTCDate() + 1);
    const bugunBas = new Date(`${bugun.toISOString().slice(0, 10)}T00:00:00+03:00`);
    const yarinBas = new Date(`${yarin.toISOString().slice(0, 10)}T00:00:00+03:00`);
    const tasks: any[] = await (this.prisma as any).task.findMany({
      where: { tenantId, isTemplate: false, status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] }, dueDate: { lt: yarinBas } },
      select: { id: true, title: true, dueDate: true, taxpayerId: true },
      orderBy: { dueDate: 'asc' },
    });
    const geciken = tasks.filter((t) => new Date(t.dueDate) < bugunBas);
    const bugunku = tasks.filter((t) => new Date(t.dueDate) >= bugunBas);
    const satir = (t: any, vurgu: BugunVurgu, alt: string, gun?: number): BugunSatir => ({
      id: `gv-${t.id}`,
      metin: t.taxpayerId && adById.get(t.taxpayerId) ? `${t.title} — ${adById.get(t.taxpayerId)}` : t.title,
      alt, sayi: gun ?? null, sayiEtiket: gun != null ? 'gün' : undefined, vurgu, href: '/panel/gorevler',
    });
    const out: BugunSatir[] = [];
    for (const t of bugunku.slice(0, 3)) out.push(satir(t, 'uyari', 'bugün'));
    for (const t of geciken.slice(0, 4)) {
      const gun = Math.max(1, Math.floor((bugunBas.getTime() - new Date(t.dueDate).getTime()) / 86400000));
      out.push(satir(t, 'kritik', `${gun} gün gecikti`, gun));
    }
    g.satirlar = out;
    g.toplam = tasks.length;
    if (tasks.length) g.ozet = `${bugunku.length} bugün · ${geciken.length} geciken`;
    return g;
  }

  // ---------------- DÜNDEN BERİ (son 24 saat) ----------------
  private async dundenBeri(tenantId: string, dun: Date, adById: Map<string, string>): Promise<BugunGrup> {
    const g = this.bosGrup('dun');
    const p = this.prisma as any;
    const [tebligat, faturaYeni, faturaIslenmemis, belge, ajanHata, lucaHata, mihsapHata, onay] = await Promise.all([
      p.portalDocument.findMany({ where: { tenantId, belgeTuru: 'E_TEBLIGAT', viewedAt: null }, select: { taxpayerId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }).catch(() => []),
      p.eFaturaInbox.count({ where: { tenantId, syncedAt: { gte: dun } } }).catch(() => 0),
      p.eFaturaInbox.count({ where: { tenantId, syncedAt: { gte: dun }, processedAt: null } }).catch(() => 0),
      p.document.count({ where: { isDeleted: false, createdAt: { gte: dun }, taxpayer: { tenantId } } }).catch(() => 0),
      p.agentEvent.groupBy({ by: ['agent'], where: { tenantId, ts: { gte: dun }, status: { in: ['hata', 'HATA', 'ERROR', 'FAIL', 'FAILED', 'HATALI'] } }, _count: { _all: true } }).catch(() => []),
      p.lucaFetchJob.count({ where: { tenantId, status: 'failed', OR: [{ finishedAt: { gte: dun } }, { finishedAt: null, createdAt: { gte: dun } }] } }).catch(() => 0),
      p.mihsapFetchJob.count({ where: { tenantId, status: 'failed', OR: [{ finishedAt: { gte: dun } }, { finishedAt: null, createdAt: { gte: dun } }] } }).catch(() => 0),
      p.pendingDecision?.count ? p.pendingDecision.count({ where: { tenantId, durum: 'bekliyor' } }).catch(() => 0) : Promise.resolve(0),
    ]);

    const out: BugunSatir[] = [];
    if (tebligat.length) {
      const yeni = tebligat.filter((t: any) => new Date(t.createdAt) >= dun).length;
      const adlar = [...new Set(tebligat.map((t: any) => adById.get(t.taxpayerId)).filter(Boolean))].slice(0, 3) as string[];
      const ilkId = tebligat[0]?.taxpayerId;
      out.push({
        id: 'dn-tebligat', metin: `${tebligat.length} okunmamış e-Tebligat${yeni ? ` (${yeni} yeni)` : ''}`,
        alt: adlar.join(' · ') + (tebligat.length > adlar.length ? ' …' : ''),
        sayi: tebligat.length, vurgu: 'kritik',
        href: ilkId ? `/panel/mukellefler/${ilkId}` : '/panel/genel-sorgular',
      });
    }
    if (faturaYeni) out.push({ id: 'dn-fatura', metin: `${faturaYeni} yeni fatura düştü`, alt: faturaIslenmemis ? `${faturaIslenmemis} tanesi henüz işlenmedi` : 'hepsi işlendi', sayi: faturaIslenmemis, sayiEtiket: 'işlenmedi', vurgu: faturaIslenmemis ? 'uyari' : 'normal', href: '/fatura-merkezi' });
    if (belge) out.push({ id: 'dn-belge', metin: `${belge} yeni belge yüklendi`, alt: 'WhatsApp / portal / sürükle-bırak', sayi: belge, vurgu: 'normal', href: '/panel/evraklar' });
    const ajanToplam = (ajanHata as any[]).reduce((s, a) => s + (a?._count?._all || 0), 0) + lucaHata + mihsapHata;
    if (ajanToplam) {
      const parcalar = (ajanHata as any[]).map((a) => `${a.agent} ${a._count._all}`);
      if (lucaHata) parcalar.push(`Luca çekim ${lucaHata}`);
      if (mihsapHata) parcalar.push(`Mihsap çekim ${mihsapHata}`);
      out.push({ id: 'dn-ajan', metin: `${ajanToplam} ajan hatası`, alt: parcalar.join(' · '), sayi: ajanToplam, vurgu: 'uyari', href: '/panel/ajanlar' });
    }
    if (onay) out.push({ id: 'dn-onay', metin: `${onay} AI kararı onay bekliyor`, alt: 'fatura / işletme sınıflandırması', sayi: onay, vurgu: 'uyari', href: '/panel/onay-kuyrugu' });
    g.satirlar = out;
    return g;
  }

  // ---------------- ODAK (tek satır) ----------------
  private odakSec(gruplar: BugunGrup[], day: number): { metin: string; href?: string } | null {
    const by = (k: BugunGrup['key']) => gruplar.find((g) => g.key === k)!;
    const teb = by('dun').satirlar.find((s) => s.id === 'dn-tebligat');
    if (teb) return { metin: `Önce: ${teb.metin} — ${(teb.alt || '').split(' · ')[0]}`, href: teb.href };
    const tk = by('takilan').satirlar[0];
    if (tk && day > 12) return { metin: `Önce: ${tk.metin} ${tk.alt}`, href: tk.href };
    const gv = by('gorev').satirlar.find((s) => s.vurgu === 'kritik');
    if (gv) return { metin: `Önce: ${gv.metin} — ${gv.alt}`, href: gv.href };
    const th = by('tahsilat').satirlar[0];
    if (th) return { metin: `Tahsilat: ${th.metin} ${tl(th.sayi || 0)} açık`, href: th.href };
    return { metin: 'Gün sakin — açık iş yok.' };
  }
}
