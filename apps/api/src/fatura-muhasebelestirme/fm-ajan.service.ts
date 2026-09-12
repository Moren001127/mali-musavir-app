import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isletmeRef, getKayitAltList } from '@mali-musavir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

/**
 * FATURA MERKEZİ — AJAN SARMALAYICISI (PLAN/15 Faz 5)
 *
 * Ekip'teki Fatura Muhasebecisi'nin fm_* araçlarının arkasındaki ince katman.
 * FaturaMuhasebelestirmeService'in MEVCUT public metodlarını çağırır (list / get / accountPlan /
 * aiReadBatch / approve / batchPostToLuca / revalidateDocument); o dosyaya dokunmaz.
 * Kendi Prisma erişimi yalnız üç yerde: hesap satırına kaynak='AJAN' yazmak (update() satırı
 * KULLANICI damgalar, ajan için uygun değil), ajan işareti (ocrData.ajanIsaretleri) ve sayaçlar.
 *
 * Kurallar (kadro/fatura/kurallar.md ile aynı):
 *  - KULLANICI kaynaklı satır ASLA ezilmez.
 *  - Ajan onaylamaz (fm_onayla bu sınıfta var ama fatura ajanının araç listesinde YOK).
 *  - Luca gönderimi mevcut kuyruk (batchPostToLuca); kuru testte runner zaten engeller.
 */

export type FmDurum = 'bekleyen' | 'eslesti' | 'kod_eksik' | 'celiski' | 'demirbas' | 'okunmadi' | 'onaylandi' | 'luca';
export type FmYon = 'alis' | 'satis';
export type FmEtiket = 'demirbas' | 'tevkifat_supheli' | 'incele' | 'mukerrer_supheli' | 'iade';

const BEKLEYEN_DURUMLAR = ['READY', 'NEEDS_REVIEW', 'PENDING', 'PROCESSING'];
const OKUNMADI_OCR = new Set(['PENDING', 'IN_PROGRESS', 'FAILED', 'CANCELLED']);
const ETIKETLER: FmEtiket[] = ['demirbas', 'tevkifat_supheli', 'incele', 'mukerrer_supheli', 'iade'];

/** Doğrulama kodu → uyumsuzluk grubu (fm_uyumsuzluklar). */
const UYUMSUZLUK_GRUBU: Record<string, string> = {
  ACCOUNT_IS_GROUP: 'icerikHesapUyumsuz',
  CARI_SHALLOW_CODE: 'icerikHesapUyumsuz',
  OWNERSHIP_MISMATCH: 'icerikHesapUyumsuz',
  ICERIK_HESAP_UYUMSUZ: 'icerikHesapUyumsuz',
  BALANCE_MISMATCH: 'tutarTutarsiz',
  TOTAL_MISMATCH: 'tutarTutarsiz',
  KDV_MATH_MISMATCH: 'tutarTutarsiz',
  INCOMPLETE_AMOUNTS: 'tutarTutarsiz',
  MULTI_RATE_COLLAPSED: 'tutarTutarsiz',
  TEVKIFAT_NEEDED: 'tevkifatSupheli',
  TEVKIFAT_NET_NEEDED: 'tevkifatSupheli',
  SMM_STOPAJ_NEEDED: 'tevkifatSupheli',
  FIXED_ASSET_MANUAL: 'demirbas',
  RETURN_NEEDS_REVERSAL: 'iade',
};

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  // "1.894,00" (TR) → 1894.00 ; "1894.00" → 1894
  const tr = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s);
  const n = tr ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function donemAraligi(donem: string): { start: Date; end: Date } | null {
  const m = String(donem || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const ay = Number(m[2]);
  if (!y || ay < 1 || ay > 12) return null;
  return { start: new Date(Date.UTC(y, ay - 1, 1)), end: new Date(Date.UTC(y, ay, 1)) };
}

function donemWhere(donem: string) {
  const r = donemAraligi(donem);
  if (!r) return {};
  return {
    OR: [
      { faturaTarihi: { gte: r.start, lt: r.end } },
      { faturaTarihi: null, createdAt: { gte: r.start, lt: r.end } },
    ],
  };
}

function isletmeMi(tp: any): boolean {
  const s = `${tp?.defterTuru || ''} ${tp?.mihsapDefterTuru || ''}`
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
  return /isletme|defter.?beyan|basit/.test(s);
}

function tarihStr(d: any): string | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

function karsiTaraf(doc: any): string {
  const satis = String(doc?.invoiceKind || '').toUpperCase() === 'SATIS';
  return String((satis ? doc?.customerName : doc?.vendorName) || doc?.vendorName || doc?.customerName || '-').trim() || '-';
}

/** Belgenin durum bayrakları (liste süzgeci + sayaçlar aynı tanımı kullanır). */
export function belgeBayraklari(doc: any) {
  const status = String(doc?.status || '').toUpperCase();
  const ocr: any = doc?.ocrData || {};
  const lines: any[] = Array.isArray(doc?.lines) ? doc.lines : [];
  const issues: any[] = Array.isArray(doc?.validationIssues) ? doc.validationIssues : [];
  const uyarilar: any[] = Array.isArray(ocr?.uyarilar) ? ocr.uyarilar : [];
  const vStatus = String(doc?.validationStatus || ocr?.validationStatus || '').toUpperCase();
  const bekleyen = BEKLEYEN_DURUMLAR.includes(status);
  const onaylandi = status === 'APPROVED';
  const luca = String(doc?.lucaStatus || '').toUpperCase() === 'POSTED';
  const lucaHatali = String(doc?.lucaStatus || '').toUpperCase() === 'FAILED';
  const matrah = lines.filter((l) => String(l.group || '').toLowerCase() === 'matrah');
  const dolu = (l: any) => !!String(l?.accountCode || '').trim();
  const kodEksik = lines.length === 0 || lines.some((l) => (num(l.debit) + num(l.credit)) > 0 && !dolu(l)) || (matrah.length > 0 && matrah.some((l) => !dolu(l)));
  const eslesti = matrah.length > 0 && matrah.every(dolu);
  const okunmadi =
    OKUNMADI_OCR.has(String(doc?.ocrStatus || '').toUpperCase()) ||
    ocr?.matchDeferred === true ||
    (lines.length === 0 && !(num(ocr?.matrah) > 0 || num(doc?.totalAmount) > 0));
  const celiski = vStatus === 'INVALID' || vStatus === 'INCOMPLETE' || issues.length > 0;
  const kodlar = new Set<string>([
    ...issues.map((i) => String(i?.code || '').toUpperCase()),
    ...uyarilar.map((u) => String(u?.kod || '').toUpperCase()),
  ]);
  const ajanIsaretleri: any[] = Array.isArray(ocr?.ajanIsaretleri) ? ocr.ajanIsaretleri : [];
  const isaretli = (e: FmEtiket) => ajanIsaretleri.some((i) => i?.etiket === e);
  const demirbas = kodlar.has('FIXED_ASSET_MANUAL') || ocr?.fixedAsset?.is === true || isaretli('demirbas');
  const tevkifatVar = num(ocr?.kdvTevkifat) > 0 || num(ocr?.tevkifatOrani) > 0 || !!String(ocr?.tevkifat?.kod || '').trim()
    || lines.some((l) => String(l.accountCode || '').startsWith('360') || /^(vergi-sorumlu|tevkifat)$/i.test(String(l.group || '')));
  const tevkifatSupheli = [...kodlar].some((k) => k === 'TEVKIFAT_NEEDED' || k === 'TEVKIFAT_NET_NEEDED' || k === 'SMM_STOPAJ_NEEDED' || /^TEV_.*_EKSIK$/.test(k)) || isaretli('tevkifat_supheli');
  const mukerrer = !!doc?.duplicateOfId || isaretli('mukerrer_supheli');
  const iade = ocr?.isReturn === true || kodlar.has('RETURN_NEEDS_REVERSAL') || isaretli('iade');
  return { bekleyen, onaylandi, luca, lucaHatali, eslesti: bekleyen && eslesti, kodEksik: bekleyen && kodEksik, okunmadi, celiski, demirbas, tevkifatVar, tevkifatSupheli, mukerrer, iade, kodlar: [...kodlar] };
}

function durumEtiketi(doc: any, b: ReturnType<typeof belgeBayraklari>): string {
  if (b.luca) return 'luca';
  if (b.lucaHatali) return 'luca_hatali';
  if (b.onaylandi) return 'onaylandi';
  if (String(doc?.status || '').toUpperCase() === 'REJECTED') return 'reddedildi';
  if (b.okunmadi) return 'okunmadi';
  if (b.celiski) return 'celiski';
  if (b.kodEksik) return 'kod_eksik';
  if (b.eslesti) return 'eslesti';
  return 'bekleyen';
}

function uyariOzeti(doc: any): Array<{ kod: string; mesaj: string; siddet?: string }> {
  const ocr: any = doc?.ocrData || {};
  const issues: any[] = Array.isArray(doc?.validationIssues) ? doc.validationIssues : [];
  const uyarilar: any[] = Array.isArray(ocr?.uyarilar) ? ocr.uyarilar : [];
  const out = [
    ...issues.map((i) => ({ kod: String(i?.code || ''), mesaj: String(i?.message || ''), siddet: String(i?.severity || '').toLowerCase() || undefined })),
    ...uyarilar.map((u) => ({ kod: String(u?.kod || ''), mesaj: String(u?.mesaj || u?.baslik || ''), siddet: u?.siddet ? String(u.siddet) : undefined })),
  ];
  if (doc?.duplicateOfId) out.push({ kod: 'MUKERRER', mesaj: String(doc.duplicateReason || 'Mükerrer belge şüphesi'), siddet: String(doc.duplicateSeverity || '').toLowerCase() || undefined });
  return out.filter((u) => u.kod || u.mesaj);
}

@Injectable()
export class FmAjanService {
  private readonly logger = new Logger(FmAjanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fm: FaturaMuhasebelestirmeService,
  ) {}

  // ─────────────────────────────── OKUMA ───────────────────────────────

  private async mukellef(tenantId: string, taxpayerId: string) {
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, defterTuru: true, mihsapDefterTuru: true, naceKodu: true, faaliyetAciklama: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');
    return tp;
  }

  private mukellefAdi(tp: any): string {
    return String(tp?.companyName || `${tp?.firstName || ''} ${tp?.lastName || ''}`).trim();
  }

  /** Hesap planı ad sözlüğü (kod → ad); bilanço mükellefinde satır özetine ad basmak için. */
  private async planAdlari(tenantId: string, taxpayerId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      const rows: any[] = await this.fm.accountPlan(tenantId, { taxpayerId, limit: 5000 });
      for (const r of rows || []) if (r?.code) out.set(String(r.code), String(r.name || ''));
    } catch {
      /* plan yoksa boş sözlük */
    }
    return out;
  }

  private satirOzeti(lines: any[], adlar: Map<string, string>) {
    return (lines || []).map((l: any, i: number) => ({
      satirNo: Number.isFinite(Number(l?.orderNo)) ? Number(l.orderNo) : i,
      grup: String(l?.group || 'matrah'),
      hesapKodu: l?.accountCode || null,
      hesapAdi: l?.accountCode ? (adlar.get(String(l.accountCode)) || null) : null,
      aciklama: l?.description || null,
      oran: l?.rate || null,
      borc: num(l?.debit),
      alacak: num(l?.credit),
      kaynak: l?.kaynak || null,
      ...(l?.isletmeYon ? { isletmeYon: l.isletmeYon, isletmeGiderTuru: l.isletmeGiderTuru || null } : {}),
    }));
  }

  private async donemBelgeleri(tenantId: string, taxpayerId: string, donem: string, yon?: FmYon | null) {
    if (!donemAraligi(donem)) throw new BadRequestException('donem YYYY-MM biçiminde olmalı (örn. 2026-08)');
    const where: any = { tenantId, taxpayerId, ...donemWhere(donem) };
    if (yon === 'alis') where.invoiceKind = 'ALIS';
    if (yon === 'satis') where.invoiceKind = 'SATIS';
    return (this.prisma as any).invoiceAccountingDocument.findMany({
      where,
      include: { lines: { orderBy: { orderNo: 'asc' } } },
      orderBy: [{ faturaTarihi: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
  }

  /** fm_belge_listele */
  async belgeListele(tenantId: string, p: { taxpayerId: string; donem: string; yon?: FmYon | null; durum?: FmDurum | null; limit?: number }) {
    const tp = await this.mukellef(tenantId, p.taxpayerId);
    const docs: any[] = await this.donemBelgeleri(tenantId, p.taxpayerId, p.donem, p.yon);
    const adlar = isletmeMi(tp) ? new Map<string, string>() : await this.planAdlari(tenantId, p.taxpayerId);
    const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
    const durum = p.durum || null;
    // Araç şeması alt çizgili ('kod_eksik'), bayrak anahtarı deve harfli ('kodEksik') → AÇIK EŞLEME (denetim bulgusu:
    //   b['kod_eksik'] hep undefined → süzgeç boş dönüyordu, ajan "kod eksik belge yok" diyordu).
    const ANAHTAR: Record<FmDurum, keyof ReturnType<typeof belgeBayraklari>> = {
      bekleyen: 'bekleyen', eslesti: 'eslesti', kod_eksik: 'kodEksik', celiski: 'celiski',
      demirbas: 'demirbas', okunmadi: 'okunmadi', onaylandi: 'onaylandi', luca: 'luca',
    };
    const suzulmus = docs.filter((d) => {
      if (!durum) return true;
      const b = belgeBayraklari(d);
      return b[ANAHTAR[durum]] === true;
    });
    const belgeler = suzulmus.slice(0, limit).map((d) => {
      const b = belgeBayraklari(d);
      const ocr: any = d.ocrData || {};
      return {
        id: d.id,
        belgeNo: d.belgeNo || null,
        tarih: tarihStr(d.faturaTarihi),
        yon: String(d.invoiceKind || 'ALIS').toLowerCase() === 'satis' ? 'satis' : 'alis',
        belgeTuru: d.documentType || null,
        karsiTaraf: karsiTaraf(d),
        tutar: num(d.totalAmount),
        matrah: num(ocr?.matrah),
        kdv: num(ocr?.kdvTutari),
        tevkifatVar: b.tevkifatVar,
        durum: durumEtiketi(d, b),
        guven: d.guven || null,
        bayraklar: {
          celiski: b.celiski, demirbas: b.demirbas, mukerrer: b.mukerrer, iade: b.iade,
          tevkifatSupheli: b.tevkifatSupheli, okunmadi: b.okunmadi, kodEksik: b.kodEksik,
        },
        uyarilar: uyariOzeti(d).slice(0, 6),
        hesapSatirlari: this.satirOzeti(d.lines, adlar).map((s) => `${s.grup}: ${s.hesapKodu || 'BOŞ'}${s.hesapAdi ? ' ' + s.hesapAdi : ''} (${s.borc ? 'B ' + s.borc : 'A ' + s.alacak}${s.kaynak ? ', ' + s.kaynak : ''})`),
      };
    });
    return {
      mukellef: this.mukellefAdi(tp),
      defterTuru: isletmeMi(tp) ? 'isletme' : 'bilanco',
      donem: p.donem,
      suzgec: { yon: p.yon || null, durum },
      toplam: suzulmus.length,
      gosterilen: belgeler.length,
      belgeler,
      not: suzulmus.length === 0 ? 'Bu süzgeçte belge yok.' : suzulmus.length > belgeler.length ? `${suzulmus.length - belgeler.length} belge daha var; limit artır ya da süzgeç daralt.` : undefined,
    };
  }

  /** fm_belge_detay */
  async belgeDetay(tenantId: string, belgeId: string) {
    const id = String(belgeId || '').trim();
    if (!id) throw new BadRequestException('belgeId gerekli');
    const doc: any = await this.fm.get(tenantId, id);
    const tp = doc.taxpayerId ? await this.mukellef(tenantId, doc.taxpayerId).catch(() => null) : null;
    const isletme = tp ? isletmeMi(tp) : false;
    const adlar = !isletme && doc.taxpayerId ? await this.planAdlari(tenantId, doc.taxpayerId) : new Map<string, string>();
    const ocr: any = doc.ocrData || {};
    const b = belgeBayraklari(doc);
    const kdvKirilimi = Array.isArray(ocr?.kdvBreakdown)
      ? ocr.kdvBreakdown.map((k: any) => ({ oran: num(k?.oran), matrah: num(k?.matrah), kdv: num(k?.tutar) }))
      : (num(ocr?.matrah) > 0 ? [{ oran: num(ocr?.kdvOrani), matrah: num(ocr?.matrah), kdv: num(ocr?.kdvTutari) }] : []);
    const kalemler = Array.isArray(ocr?.kalemler)
      ? ocr.kalemler.slice(0, 60).map((k: any) => ({ ad: String(k?.ad || k?.aciklama || ''), tutar: num(k?.tutar), oran: num(k?.oran), hesap: k?.hesap || null }))
      : [];
    const tevkifat = b.tevkifatVar
      ? { kod: ocr?.tevkifat?.kod || null, oran: ocr?.tevkifat?.oran || (num(ocr?.tevkifatOrani) > 0 ? String(ocr.tevkifatOrani) : null), tutar: num(ocr?.kdvTevkifat) }
      : null;
    const kdvDisiVergiler = Array.isArray(ocr?.digerVergiler) ? ocr.digerVergiler : (Array.isArray(ocr?.kdvDisiVergiler) ? ocr.kdvDisiVergiler : []);
    const satirlar = this.satirOzeti(doc.lines, adlar);
    const borc = satirlar.reduce((s, l) => s + l.borc, 0);
    const alacak = satirlar.reduce((s, l) => s + l.alacak, 0);
    return {
      id: doc.id,
      mukellef: tp ? this.mukellefAdi(tp) : null,
      defterTuru: isletme ? 'isletme' : 'bilanco',
      belgeNo: doc.belgeNo || null,
      belgeTuru: doc.documentType || null,
      yon: String(doc.invoiceKind || 'ALIS').toLowerCase() === 'satis' ? 'satis' : 'alis',
      tarih: tarihStr(doc.faturaTarihi),
      kaynak: doc.source || null,
      taraflar: { satici: doc.vendorName || null, saticiVkn: doc.sellerVkn || null, alici: doc.customerName || null, aliciVkn: doc.buyerVkn || null },
      tutar: num(doc.totalAmount),
      paraBirimi: doc.currency || 'TL',
      matrah: num(ocr?.matrah),
      kdv: num(ocr?.kdvTutari),
      kdvKirilimi,
      kdvDisiVergiler,
      tevkifat,
      iade: b.iade,
      kalemler,
      giderTuru: ocr?.giderTuru || null,
      kategori: ocr?.kategori || null,
      muhasebeGerekcesi: ocr?.muhasebeNeden || null,
      isletme: isletme ? (ocr?.isletme || null) : undefined,
      hesapSatirlari: satirlar,
      denge: { borc: Math.round(borc * 100) / 100, alacak: Math.round(alacak * 100) / 100, dengeli: Math.abs(borc - alacak) <= 0.02 },
      durum: durumEtiketi(doc, b),
      status: doc.status,
      lucaDurum: doc.lucaStatus || null,
      lucaFisNo: doc.lucaFisNo || null,
      lucaHata: doc.lucaErrorMessage || null,
      dogrulama: { durum: doc.validationStatus || ocr?.validationStatus || null, uyarilar: uyariOzeti(doc) },
      bayraklar: { celiski: b.celiski, demirbas: b.demirbas, mukerrer: b.mukerrer, iade: b.iade, tevkifatSupheli: b.tevkifatSupheli, okunmadi: b.okunmadi, kodEksik: b.kodEksik, tevkifatVar: b.tevkifatVar },
      mukerrerKaydi: doc.duplicateOfId ? { belgeId: doc.duplicateOfId, neden: doc.duplicateReason || null, siddet: doc.duplicateSeverity || null } : null,
      ajanIsaretleri: Array.isArray(ocr?.ajanIsaretleri) ? ocr.ajanIsaretleri : [],
      ajanNotlari: Array.isArray(ocr?.ajanNotlari) ? ocr.ajanNotlari : [],
    };
  }

  /** fm_donem_ozeti */
  async donemOzeti(tenantId: string, taxpayerId: string, donem: string) {
    const tp = await this.mukellef(tenantId, taxpayerId);
    const docs: any[] = await this.donemBelgeleri(tenantId, taxpayerId, donem, null);
    const say = {
      toplam: docs.length, bekleyen: 0, eslesti: 0, kodEksik: 0, celiski: 0, demirbas: 0, okunmadi: 0,
      onaylandi: 0, lucayaGitti: 0, lucaHatali: 0, mukerrer: 0, tevkifatli: 0, tevkifatSupheli: 0, iade: 0, reddedildi: 0,
    };
    const yon = { alis: { toplam: 0, bekleyen: 0, onaylandi: 0, tutar: 0 }, satis: { toplam: 0, bekleyen: 0, onaylandi: 0, tutar: 0 } };
    for (const d of docs) {
      const b = belgeBayraklari(d);
      if (b.bekleyen) say.bekleyen++;
      if (b.eslesti) say.eslesti++;
      if (b.kodEksik) say.kodEksik++;
      if (b.celiski) say.celiski++;
      if (b.demirbas) say.demirbas++;
      if (b.okunmadi) say.okunmadi++;
      if (b.onaylandi) say.onaylandi++;
      if (b.luca) say.lucayaGitti++;
      if (b.lucaHatali) say.lucaHatali++;
      if (b.mukerrer) say.mukerrer++;
      if (b.tevkifatVar) say.tevkifatli++;
      if (b.tevkifatSupheli) say.tevkifatSupheli++;
      if (b.iade) say.iade++;
      if (String(d.status || '').toUpperCase() === 'REJECTED') say.reddedildi++;
      const y = String(d.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? yon.satis : yon.alis;
      y.toplam++;
      y.tutar += num(d.totalAmount);
      if (b.bekleyen) y.bekleyen++;
      if (b.onaylandi) y.onaylandi++;
    }
    yon.alis.tutar = Math.round(yon.alis.tutar * 100) / 100;
    yon.satis.tutar = Math.round(yon.satis.tutar * 100) / 100;
    const isletme = isletmeMi(tp);
    let hesapPlaniVar: boolean | null = null;
    if (!isletme) {
      const plan = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({ where: { tenantId, taxpayerId, status: 'READY' }, select: { id: true } }).catch(() => null);
      hesapPlaniVar = !!plan;
    }
    return {
      mukellef: this.mukellefAdi(tp),
      defterTuru: isletme ? 'isletme' : 'bilanco',
      donem,
      hesapPlaniVar,
      sayaclar: say,
      yon,
      not: docs.length === 0
        ? 'Bu dönemde Fatura Merkezi belgesi yok (entegratör çekimi / Aktar yapılmamış olabilir).'
        : (!isletme && hesapPlaniVar === false ? 'Hesap planı aktarılmamış — bilanço mükellefinde hesap atanamaz; önce plan yenilenmeli.' : undefined),
    };
  }

  /** fm_uyumsuzluklar */
  async uyumsuzluklar(tenantId: string, taxpayerId: string, donem: string, limit?: number) {
    const tp = await this.mukellef(tenantId, taxpayerId);
    const docs: any[] = await this.donemBelgeleri(tenantId, taxpayerId, donem, null);
    const tavan = Math.min(Math.max(Number(limit) || 30, 1), 200);
    const gruplar: Record<string, any[]> = {
      icerikHesapUyumsuz: [], tutarTutarsiz: [], mukerrer: [], tevkifatSupheli: [], demirbas: [], iade: [], okunmadi: [],
    };
    const madde = (d: any, kod: string, mesaj: string) => ({
      belgeId: d.id, belgeNo: d.belgeNo || null, tarih: tarihStr(d.faturaTarihi), yon: String(d.invoiceKind || 'ALIS').toLowerCase(),
      karsiTaraf: karsiTaraf(d), tutar: num(d.totalAmount), kod, mesaj,
    });
    for (const d of docs) {
      if (String(d.status || '').toUpperCase() === 'REJECTED') continue;
      const b = belgeBayraklari(d);
      if (b.luca) continue; // Luca'ya gitmiş belge kapanmıştır
      const eklenen = new Set<string>();
      const ekle = (grup: string, kod: string, mesaj: string) => {
        if (!gruplar[grup] || eklenen.has(grup)) return;
        eklenen.add(grup);
        gruplar[grup].push(madde(d, kod, mesaj));
      };
      if (b.okunmadi) { ekle('okunmadi', 'OKUNMADI', 'Belge okunmamış/ham — önce fm_ai_ile_oku.'); continue; }
      for (const u of uyariOzeti(d)) {
        const k = String(u.kod || '').toUpperCase();
        const grup = UYUMSUZLUK_GRUBU[k] || (/^TEV_.*_EKSIK$/.test(k) ? 'tevkifatSupheli' : k === 'MUKERRER' ? 'mukerrer' : null);
        if (grup) ekle(grup, k, u.mesaj);
      }
      if (b.mukerrer) ekle('mukerrer', 'MUKERRER', String(d.duplicateReason || 'Mükerrer belge şüphesi (belge no + VKN + tutar).'));
      if (b.demirbas) ekle('demirbas', 'DEMIRBAS', 'Demirbaş / sabit kıymet — otomatik işlenmez, sahip kararı.');
      if (b.iade) ekle('iade', 'IADE', 'İade belgesi — normal matrah hesabına yazılmaz.');
      if (b.tevkifatSupheli) ekle('tevkifatSupheli', 'TEVKIFAT_SUPHELI', 'Tevkifat eksik/şüpheli — oran, hesap adı ve kod tutarlılığına bak.');
    }
    const ozet: Record<string, number> = {};
    for (const [k, v] of Object.entries(gruplar)) { ozet[k] = v.length; gruplar[k] = v.slice(0, tavan); }
    const toplam = Object.values(ozet).reduce((a, b) => a + b, 0);
    return {
      mukellef: this.mukellefAdi(tp),
      defterTuru: isletmeMi(tp) ? 'isletme' : 'bilanco',
      donem,
      toplamUyumsuz: toplam,
      ozet,
      gruplar,
      not: toplam === 0 ? 'Uyumsuz belge yok.' : undefined,
    };
  }

  /** fm_hesap_plani_ara */
  async hesapPlaniAra(tenantId: string, p: { taxpayerId: string; sorgu: string; yon?: FmYon | null; limit?: number }) {
    const tp = await this.mukellef(tenantId, p.taxpayerId);
    const sorgu = String(p.sorgu || '').trim();
    const limit = Math.min(Math.max(Number(p.limit) || 30, 1), 100);
    const norm = (s: string) => String(s || '').toLocaleLowerCase('tr-TR');
    const q = norm(sorgu);
    if (isletmeMi(tp)) {
      const kind = p.yon === 'satis' ? 'SATIS' : 'ALIS';
      const ref = isletmeRef(kind);
      const kayitTurleri = ref.kayitTuru.map((k: any) => ({
        kod: k.kod, ad: k.ad,
        altTurler: getKayitAltList(kind, k.kod).filter((a: any) => !q || norm(a.ad).includes(q) || String(a.kod) === sorgu).slice(0, limit).map((a: any) => ({ kod: a.kod, ad: a.ad })),
      }));
      const suzulmus = kayitTurleri.filter((k) => !q || norm(k.ad).includes(q) || String(k.kod) === sorgu || k.altTurler.length > 0);
      return {
        mukellef: this.mukellefAdi(tp), defterTuru: 'isletme', yon: kind.toLowerCase(), sorgu,
        not: 'İşletme defterinde hesap planı yok; Kayıt Türü (+ alt tür) seçilir. fm_hesap_ata: kayitTuruKod + kayitAltKod.',
        kayitTurleri: suzulmus,
      };
    }
    const rows: any[] = await this.fm.accountPlan(tenantId, { taxpayerId: p.taxpayerId, limit: 5000 });
    if (!rows?.length) {
      return { mukellef: this.mukellefAdi(tp), defterTuru: 'bilanco', sorgu, hesaplar: [], not: 'Hesap planı aktarılmamış — önce plan yenilenmeli (portal: Fatura Merkezi > Hesap Planı > Yenile).' };
    }
    const kodlar = rows.map((r) => String(r.code || ''));
    const grupMu = (kod: string) => kodlar.some((k) => k !== kod && k.startsWith(kod + '.'));
    const eslesen = rows.filter((r) => {
      const kod = String(r.code || '');
      const ad = norm(r.name);
      return !q || kod.startsWith(sorgu) || ad.includes(q);
    });
    const yapraklar = eslesen.filter((r) => !grupMu(String(r.code || '')));
    return {
      mukellef: this.mukellefAdi(tp), defterTuru: 'bilanco', sorgu,
      toplamEslesen: eslesen.length,
      hesaplar: yapraklar.slice(0, limit).map((r) => ({ kod: r.code, ad: r.name, seviye: r.level ?? null, yerel: r.local === true })),
      not: yapraklar.length === 0 ? 'Bu sorguya uyan yaprak hesap yok; sorguyu değiştir ya da hesabı BOŞ bırakıp onaya sun.' : undefined,
    };
  }

  // ─────────────────────────────── PORTAL YAZ ───────────────────────────────

  /** fm_hesap_ata — kaynak='AJAN'; KULLANICI satırı ezilmez. */
  async hesapAta(tenantId: string, p: { belgeId: string; satir?: string | number | null; hesapKodu?: string | null; kayitTuruKod?: string | null; kayitAltKod?: string | null; gerekce: string; userId?: string | null }) {
    const id = String(p.belgeId || '').trim();
    const gerekce = String(p.gerekce || '').trim();
    if (!id) throw new BadRequestException('belgeId gerekli');
    if (!gerekce) throw new BadRequestException('gerekce gerekli (tek cümle: içerik → hesap adı neden uyuşuyor)');
    const doc: any = await this.fm.get(tenantId, id);
    if (String(doc.status || '').toUpperCase() === 'APPROVED') throw new BadRequestException('Onaylı belgeye hesap atanmaz (önce sahip onayı geri alır).');
    const tp = doc.taxpayerId ? await this.mukellef(tenantId, doc.taxpayerId) : null;
    const isletme = tp ? isletmeMi(tp) : false;
    const ocr: any = doc.ocrData || {};
    const notlar: any[] = Array.isArray(ocr?.ajanNotlari) ? ocr.ajanNotlari : [];
    const zaman = new Date().toISOString();

    if (isletme) {
      const kt = String(p.kayitTuruKod || '').trim();
      if (!kt) throw new BadRequestException('İşletme defteri: kayitTuruKod gerekli (fm_hesap_plani_ara ile bul).');
      const kind = String(doc.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
      const ref = isletmeRef(kind);
      const ktKaydi = ref.kayitTuru.find((x: any) => String(x.kod) === kt);
      if (!ktKaydi) throw new BadRequestException(`Kayıt türü kodu listede yok: ${kt}`);
      const altListe = getKayitAltList(kind, kt);
      const alt = String(p.kayitAltKod || '').trim();
      const altKaydi = alt ? altListe.find((x: any) => String(x.kod) === alt) : null;
      if (alt && !altKaydi) throw new BadRequestException(`Kayıt alt tür kodu listede yok: ${alt}`);
      if (altListe.length && !alt) throw new BadRequestException(`Bu kayıt türü alt tür ister (${altListe.length} seçenek) — kayitAltKod ver.`);
      const mevcut: any = ocr?.isletme || {};
      if (mevcut?.userEdited === true) {
        return { ok: false, error: 'Bu belgenin işletme sınıfı KULLANICI tarafından seçilmiş; ajan ezmez. Farklı düşünüyorsan fm_isaretle(incele) ile not düş.', mevcut: { kayitTuruKod: mevcut.kayitTuruKod, kayitAltKod: mevcut.kayitAltKod } };
      }
      const yeni = {
        ...mevcut,
        kayitTuruKod: ktKaydi.kod, kayitTuruAd: ktKaydi.ad,
        kayitAltKod: altKaydi?.kod || '', kayitAltAd: altKaydi?.ad || '',
        autoMatched: false, kaynak: 'AJAN', neden: gerekce.slice(0, 200),
      };
      await (this.prisma as any).invoiceAccountingDocument.update({
        where: { id },
        data: { ocrData: { ...ocr, isletme: yeni, ajanNotlari: [...notlar, { zaman, tur: 'hesap_ata', kayitTuruKod: yeni.kayitTuruKod, kayitAltKod: yeni.kayitAltKod, gerekce }].slice(-20) } },
      });
      const dogrulama = await this.fm.revalidateDocument(tenantId, id).catch(() => null);
      await this.denetimIzi(tenantId, p.userId, 'AJAN_HESAP_ATA', id, { isletme: mevcut }, { isletme: yeni, gerekce });
      return { ok: true, belgeId: id, defterTuru: 'isletme', kaynak: 'AJAN', yazilan: { kayitTuruKod: yeni.kayitTuruKod, kayitTuruAd: yeni.kayitTuruAd, kayitAltKod: yeni.kayitAltKod, kayitAltAd: yeni.kayitAltAd }, dogrulama };
    }

    const hesapKodu = String(p.hesapKodu || '').trim();
    if (!hesapKodu) throw new BadRequestException('Bilanço: hesapKodu gerekli (fm_hesap_plani_ara ile yaprak hesap bul).');
    const lines: any[] = Array.isArray(doc.lines) ? doc.lines : [];
    if (!lines.length) throw new BadRequestException('Belgede hesap satırı yok — önce fm_ai_ile_oku ile satır üret.');
    // Satır seçimi: sayı = orderNo; metin = grup adı (tek eşleşme şart).
    const satirRaw = p.satir === null || p.satir === undefined ? '' : String(p.satir).trim();
    let hedef: any = null;
    if (/^\d+$/.test(satirRaw)) {
      const no = Number(satirRaw);
      hedef = lines.find((l, i) => (Number.isFinite(Number(l.orderNo)) ? Number(l.orderNo) : i) === no) || null;
      if (!hedef) throw new BadRequestException(`Satır no bulunamadı: ${no} (satırlar: ${lines.map((l, i) => `${Number.isFinite(Number(l.orderNo)) ? l.orderNo : i}:${l.group}`).join(', ')})`);
    } else {
      const grup = (satirRaw || 'matrah').toLowerCase();
      const adaylar = lines.filter((l) => String(l.group || '').toLowerCase() === grup);
      if (adaylar.length === 0) throw new BadRequestException(`"${grup}" grubunda satır yok (gruplar: ${[...new Set(lines.map((l) => l.group))].join(', ')})`);
      if (adaylar.length > 1) throw new BadRequestException(`"${grup}" grubunda ${adaylar.length} satır var; satir olarak satır no ver (fm_belge_detay).`);
      hedef = adaylar[0];
    }
    if (String(hedef.kaynak || '').toUpperCase() === 'KULLANICI') {
      return { ok: false, error: `Satır ${hedef.orderNo} (${hedef.group}) KULLANICI tarafından seçilmiş (${hedef.accountCode}); ajan ezmez. Farklı düşünüyorsan fm_isaretle(incele) ile not düş.` };
    }
    // Hesap plandaki bir YAPRAK mı? (plan varsa zorunlu; yoksa uyarıyla geç)
    const plan: any[] = await this.fm.accountPlan(tenantId, { taxpayerId: doc.taxpayerId, limit: 5000 }).catch(() => []);
    let hesapAdi: string | null = null;
    if (plan?.length) {
      const kayit = plan.find((r) => String(r.code) === hesapKodu);
      if (!kayit) throw new BadRequestException(`Hesap planında yok: ${hesapKodu}. fm_hesap_plani_ara ile bul; plan dışı kod yazılmaz.`);
      if (plan.some((r) => String(r.code).startsWith(hesapKodu + '.'))) throw new BadRequestException(`${hesapKodu} bir GRUP hesabı (altı var); yaprak hesap seç.`);
      hesapAdi = String(kayit.name || '');
    }
    const eski = { accountCode: hedef.accountCode || null, kaynak: hedef.kaynak || null };
    await (this.prisma as any).invoiceAccountingLine.update({
      where: { id: hedef.id },
      data: { accountCode: hesapKodu, kaynak: 'AJAN', ...(hesapAdi && !hedef.description ? { description: hesapAdi } : {}) },
    });
    await (this.prisma as any).invoiceAccountingDocument.update({
      where: { id },
      data: { ocrData: { ...ocr, ajanNotlari: [...notlar, { zaman, tur: 'hesap_ata', satirNo: hedef.orderNo, grup: hedef.group, hesapKodu, hesapAdi, eski: eski.accountCode, gerekce }].slice(-20) } },
    }).catch(() => {});
    const dogrulama = await this.fm.revalidateDocument(tenantId, id).catch(() => null);
    await this.denetimIzi(tenantId, p.userId, 'AJAN_HESAP_ATA', id, { satir: hedef.orderNo, ...eski }, { satir: hedef.orderNo, accountCode: hesapKodu, kaynak: 'AJAN', gerekce });
    return {
      ok: true, belgeId: id, defterTuru: 'bilanco', kaynak: 'AJAN',
      yazilan: { satirNo: hedef.orderNo, grup: hedef.group, hesapKodu, hesapAdi, eski: eski.accountCode },
      dogrulama,
      not: 'Öneri AJAN kaynaklı yazıldı; öğrenme hafızasına GİRMEZ (onayda da öğrenilmez). Sahip editörden hesabı kendi seçerse (KULLANICI) öğrenilir.',
    };
  }

  /** fm_ai_ile_oku — mevcut ai-read-batch kuyruğu. */
  async aiIleOku(tenantId: string, belgeIdler: string[]) {
    const ids = [...new Set((belgeIdler || []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 100);
    if (!ids.length) throw new BadRequestException('belgeIdler boş');
    const r = await this.fm.aiReadBatch(tenantId, ids);
    return { ok: true, kuyrugaAlinan: r?.queued ?? 0, atlanan: r?.skipped ?? 0, not: 'Okuma sunucu kuyruğunda; birkaç dakika sonra fm_belge_listele(durum=okunmadi) ile kontrol et.' };
  }

  /** fm_isaretle — ocrData.ajanIsaretleri + NEEDS_REVIEW. Hesap yazmaz. */
  async isaretle(tenantId: string, p: { belgeId: string; etiket: FmEtiket; not: string; userId?: string | null }) {
    const id = String(p.belgeId || '').trim();
    const etiket = String(p.etiket || '').trim() as FmEtiket;
    const not = String(p.not || '').trim();
    if (!id) throw new BadRequestException('belgeId gerekli');
    if (!ETIKETLER.includes(etiket)) throw new BadRequestException(`etiket şunlardan biri olmalı: ${ETIKETLER.join(' | ')}`);
    if (!not) throw new BadRequestException('not gerekli (neden şüpheli / sahipten ne bekleniyor)');
    const doc: any = await this.fm.get(tenantId, id);
    const ocr: any = doc.ocrData || {};
    const mevcut: any[] = Array.isArray(ocr?.ajanIsaretleri) ? ocr.ajanIsaretleri : [];
    const isaret = { etiket, not: not.slice(0, 300), zaman: new Date().toISOString() };
    const yeni = [...mevcut.filter((i) => i?.etiket !== etiket), isaret].slice(-10);
    const data: any = { ocrData: { ...ocr, ajanIsaretleri: yeni } };
    const status = String(doc.status || '').toUpperCase();
    if (status === 'READY') data.status = 'NEEDS_REVIEW';
    await (this.prisma as any).invoiceAccountingDocument.update({ where: { id }, data });
    await this.denetimIzi(tenantId, p.userId, 'AJAN_ISARET', id, { status }, { etiket, not, status: data.status || status });
    return { ok: true, belgeId: id, belgeNo: doc.belgeNo || null, isaret, durum: data.status || status, onayBekleyen: true };
  }

  /** fm_onayla — fatura ajanının listesinde YOK; yalnız ileride sahip-vekili akışı için. */
  async onayla(tenantId: string, belgeId: string, userId?: string | null) {
    const id = String(belgeId || '').trim();
    if (!id) throw new BadRequestException('belgeId gerekli');
    const r: any = await this.fm.approve(tenantId, id, userId || undefined, false);
    return { ok: true, belgeId: id, status: r?.status, lucaDurum: r?.lucaStatus || null };
  }

  // ─────────────────────────────── LUCA YAZ ───────────────────────────────

  /** fm_luca_gonder — mevcut batchPostToLuca (kuru testte runner engeller). */
  async lucaGonder(tenantId: string, p: { taxpayerId: string; belgeIdler?: string[]; donem?: string | null; yon?: FmYon | null; userId?: string | null }) {
    const taxpayerId = String(p.taxpayerId || '').trim();
    if (!taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const ids = [...new Set((p.belgeIdler || []).map((s) => String(s || '').trim()).filter(Boolean))];
    if (!ids.length && !donemAraligi(String(p.donem || ''))) throw new BadRequestException('belgeIdler ya da donem (YYYY-MM) gerekli');
    const r: any = await this.fm.batchPostToLuca(tenantId, {
      taxpayerId,
      documentIds: ids.length ? ids : undefined,
      period: ids.length ? undefined : String(p.donem),
      direction: p.yon === 'alis' ? 'ALIS' : p.yon === 'satis' ? 'SATIS' : undefined,
    }, p.userId || undefined);
    return { ok: true, sonuc: r };
  }

  private async denetimIzi(tenantId: string, userId: string | null | undefined, action: string, belgeId: string, eski: any, yeni: any) {
    try {
      await (this.prisma as any).auditLog?.create?.({
        data: { tenantId, userId: userId || null, action, resource: 'fatura-belge', resourceId: belgeId, oldData: eski ?? undefined, newData: yeni ?? undefined },
      });
    } catch (e: any) {
      this.logger.debug(`Denetim izi yazılamadı (${action} ${belgeId}): ${e?.message || e}`);
    }
  }
}
