import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import {
  aramaParcalari,
  belgeSatiriKur,
  belgeTuruListesi,
  donemVaryantlari,
  hataSiniflandir,
  iletimEsle,
  iletimKategorisi,
  likeKacis,
  satirBelgeIdleri,
  sayfaBoyutuCoz,
  sayfaCoz,
  sgkBelgeTuruMu,
  sgkBirlesikAnahtar,
  sgkBirlesikSatirKur,
  type BelgeSatiri,
  type HataBilgisi,
  type SayfaBelgeKaydi,
} from './belge-sayfa';
import { StorageService } from '../storage/storage.service';
import { encrypt, tryDecrypt } from '../common/crypto';
import { resolveTenantFromAgentToken as resolveAgentTenant } from '../common/agent-token';
import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import {
  DVD_SORGU_TURLERI,
  GENEL_SORGU_TURLERI,
  OTOMATIK_SORGU_ETIKETLERI,
  acikDvdSorgulari,
  dvdSorguTuruMu,
  eDefterGeceSorguAylari,
  eDefterMukellefTipi,
  otomatikSorguCoz,
  type DvdSorguTuru,
  type EHacizVeri,
  type OtomatikSorguTuru,
  type YoklamaDenetimVeri,
} from '@mali-musavir/shared';
import { ayEkle as dvdAyEkle, hacizTatbikEdilmisMi, isoGunBicimle, istanbulGunISO, tlBicimle } from './dvd-sorgu-cozumleyici';

export const PORTAL_PROVIDERS = ['GIB_EBEYANNAME', 'GIB_IVD', 'SGK_EBILDIRGE'] as const;
export type PortalProvider = (typeof PORTAL_PROVIDERS)[number];

export const PORTAL_JOB_TYPES = [
  'EBEYANNAME_DAILY_DOWNLOAD',
  // YENİ GİB e-Beyan sistemi (ebeyan.gib.gov.tr) — AYRI iş (eski sistemle karışmasın).
  // "Yeni Beyanname Sitesinden Çek" butonundan tetiklenir; tenant-owner, gece cron'una
  // DAHIL DEĞİL. Aynı GIB_EBEYANNAME (mali müşavir) girişini kullanır.
  'EBEYAN_NEW_DOWNLOAD',
  'E_TEBLIGAT_CHECK',
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
  'EARSIV_PORTAL_FETCH',
  // Galeri HGS: Dijital Vergi Dairesi'nden araç plakalarını çek + KGM ihlal sorgusu.
  // ownerType TAXPAYER (galeri mükellefinin GIB_IVD girişi). Gece cron'una DAHIL DEĞİL —
  // yalnızca galeri ekranındaki butondan / HGS cron'undan tetiklenir.
  'GALERI_HGS',
  // Dijital Vergi Dairesi sorguları (2026-09-22): vergi borcu / e-haciz / yoklama-denetim / POS /
  // gelen e-arşiv / e-defter — mükellefin GIB_IVD girişiyle tek oturumda, tıklamasız (bkz. bilgi/DVD-SORGU-UCLARI.md).
  // payload.sorgular = DvdSorguTuru[]. Gece: e-Tebligat açıksa bu sorgular E_TEBLIGAT_CHECK'in
  // payload.ekSorgular'ı olarak aynı oturumda koşar; e-Tebligat kapalıysa ayrı DVD_SORGU işi açılır.
  'DVD_SORGU',
] as const;
export type PortalJobType = (typeof PORTAL_JOB_TYPES)[number];

/**
 * Otomatik Sorgulama Ayarı (mükellef kartı) → iş tipi eşlemesi. GECE cron'unda bu haritada
 * anahtarı olan iş tipi, mükellefin otomatikSorgu[anahtar] === false ise AÇILMAZ.
 * Haritada olmayan iş tipleri (SGK, e-Beyanname…) ayardan etkilenmez. İleride vergi borcu /
 * e-haciz / yoklama / POS / gelen e-arşiv işleri eklendiğinde buraya bir satır eklemek yeter.
 */
const OTOMATIK_SORGU_ANAHTARI: Partial<Record<PortalJobType, OtomatikSorguTuru>> = {
  E_TEBLIGAT_CHECK: 'eTebligat',
};

const SGK_JOB_TYPES: PortalJobType[] = [
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
];

const JOB_META: Record<PortalJobType, { provider: PortalProvider; ownerType: 'TENANT' | 'TAXPAYER'; label: string }> = {
  EBEYANNAME_DAILY_DOWNLOAD: {
    provider: 'GIB_EBEYANNAME',
    ownerType: 'TENANT',
    label: 'e-Beyanname onceki gun indirme',
  },
  EBEYAN_NEW_DOWNLOAD: {
    provider: 'GIB_EBEYANNAME',
    ownerType: 'TENANT',
    label: 'Yeni e-Beyan sisteminden indirme',
  },
  E_TEBLIGAT_CHECK: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'GIB e-Tebligat kontrol',
  },
  SGK_HIZMET_LISTESI: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'SGK hizmet listesi',
  },
  SGK_TAHAKKUK: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'SGK tahakkuk',
  },
  SGK_ISE_GIRIS_CIKIS: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'Ise giris / isten cikis bildirgeleri',
  },
  SGK_ISGOREMEZLIK: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'Isgoremezlik raporu sorgu',
  },
  EARSIV_PORTAL_FETCH: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'GIB e-Arsiv fatura cekimi',
  },
  GALERI_HGS: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'Galeri HGS ihlal sorgu',
  },
  DVD_SORGU: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'Dijital Vergi Dairesi sorgusu',
  },
};

type ManualRunInput = {
  scope?: 'all' | 'beyanname' | 'tebligat' | 'sgk';
  jobTypes?: string[];
  taxpayerIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  donem?: string;
  targetPeriod?: string;
  force?: boolean;
  validationOnly?: boolean;
  discover?: boolean;
  earsivMode?: 'query' | 'download';
  selectedRefs?: string[];
};

type JobProgressUpdate = {
  step?: string;
  message?: string;
  detail?: string;
  current?: number;
  total?: number;
  records?: number;
};

/** Gece DVD sorgu planı için mükellef bilgisi (döngü öncesi tek sorguyla çekilir). */
type GeceMukellefBilgisi = {
  id: string;
  type?: string | null;
  otomatikSorgu?: unknown;
  beyanConfig?: { eDefterPeriod?: string | null; eDefterBaslangic?: string | null; incomeTaxType?: string | null } | null;
};

type AgentDeclarationInput = {
  taxpayerId: string;
  beyanTipi: string;
  donem: string;
  status?: string | null;
  beyanTarihi?: string | null;
  tahakkukTutari?: number | null;
  odemeTutari?: number | null;
  onayNo?: string | null;
  beyannameBase64?: string | null;
  tahakkukBase64?: string | null;
  xmlBase64?: string | null;
  beyannameFileName?: string | null;
  tahakkukFileName?: string | null;
  raw?: any;
};

type AgentDocumentInput = {
  taxpayerId?: string | null;
  belgeTuru: string;
  title: string;
  referenceNo?: string | null;
  period?: string | null;
  issuedAt?: string | null;
  receivedAt?: string | null;
  mimeType?: string | null;
  originalName?: string | null;
  base64?: string | null;
  raw?: any;
};

/** GET /portal-automation/documents/sayfa sorgu parametreleri (sözleşme §1). */
type SayfaSorgusu = {
  belgeTuru?: string;
  taxpayerId?: string;
  search?: string;
  period?: string;
  durum?: string;
  birlesik?: string;
  page?: string | number;
  pageSize?: string | number;
  sirala?: string;
};

/** Sayfa uçlarının portalDocument.select'i — raw yalnız özet çıkarmak için okunur, yanıta girmez. */
const SAYFA_BELGE_SELECT = {
  id: true,
  taxpayerId: true,
  belgeTuru: true,
  title: true,
  referenceNo: true,
  period: true,
  issuedAt: true,
  receivedAt: true,
  createdAt: true,
  storageKey: true,
  viewedAt: true,
  raw: true,
  taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } },
} as const;

function isPortalProvider(v: string): v is PortalProvider {
  return (PORTAL_PROVIDERS as readonly string[]).includes(v);
}

function isPortalJobType(v: string): v is PortalJobType {
  return (PORTAL_JOB_TYPES as readonly string[]).includes(v);
}

function adFormat(tp: any): string {
  if (!tp) return '';
  return tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || tp.taxNumber || '';
}

function parseDateOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (tr) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = tr;
    const d = new Date(
      Date.UTC(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh),
        Number(min),
        Number(ss),
      ),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthRange(period?: string | null) {
  const match = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
  };
}

function normalizeAgentDeclarationStatus(input: AgentDeclarationInput): 'onaylandi' | 'beklemede' | 'hatali' {
  const rawStatus = [
    input.status,
    input.raw?.status,
    input.raw?.durum,
    input.raw?.phase,
    input.raw?.state,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/onay\s*bek|beklemede|pending|approval|awaiting/.test(rawStatus)) return 'beklemede';
  if (/hata|hatali|failed|fail|error/.test(rawStatus)) return 'hatali';
  return 'onaylandi';
}

function agentDeclarationStatusNote(input: AgentDeclarationInput, status: 'beklemede' | 'hatali') {
  const prefix = status === 'beklemede'
    ? 'GIB agent onay bekliyor'
    : 'GIB agent hata';
  // gibTarih EN BAŞTA: raw JSON 1000 karakterde kırpılıyor, tarih kırpılmaya kurban gitmesin.
  // Beyanname-takip güncellik kıyası (resolveBeyanState) ve aşağıdaki ezme koruması bunu okur.
  const gibTarih = parseDateOrNull(input.beyanTarihi || null);
  const tarihPart = gibTarih ? ` | gibTarih=${gibTarih.toISOString()}` : '';
  const raw = input.raw ? JSON.stringify({ source: 'portal-automation', raw: input.raw }) : '';
  return `${prefix}${tarihPart}${raw ? ` | ${raw}` : ''}`.slice(0, 1000);
}

/** Nottaki gibTarih=<ISO> değerini geri oku (beyanname-takip'teki eşleniğiyle aynı biçim). */
function gibTarihFromDurumNote(notlar?: string | null): Date | null {
  const m = String(notlar || '').match(/gibTarih=([0-9T:.Z+-]+)/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseIstanbulDateBoundary(value: string | undefined, boundary: 'start' | 'end'): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}+03:00`);
  }
  return parseDateOrNull(text);
}

function cleanBase64(input?: string | null): string | null {
  if (!input) return null;
  return input.replace(/^data:[^;]+;base64,/, '').trim();
}

function normalizeTextKey(value?: string | null) {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function startOfIstanbulDay(d: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00+03:00`);
}

function previousIstanbulDayRange(now = new Date()) {
  const todayStart = startOfIstanbulDay(now);
  const end = new Date(todayStart.getTime() - 1);
  const start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  return { start, end };
}

function lastThreeDaysRange(now = new Date()) {
  const todayStart = startOfIstanbulDay(now);
  const end = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const start = new Date(todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class PortalAutomationService {
  private readonly logger = new Logger(PortalAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private beyanKayitlari: BeyanKayitlariService,
    private notifications: NotificationsService,
  ) {}

  /**
   * AKTAR → OKU kancası (2026-09-15 canlı bulgu — ÖMER ÖZEN 42 satış belgesi "Kod eksik" bekliyordu): GİB e-Arşiv portal
   * aktarımı belgeyi doğrudan oluşturuyor, e-Fatura yolundaki otomatik AI okuması (aktarSonrasiOkumaKuyruga) burada YOKTU.
   * FaturaMuhasebelestirmeService (bu modülü zaten içe alır; ters yönde DI döngü olur) açılışta kancayı kaydeder.
   */
  private aktarSonrasiOkumaKancasi: ((tenantId: string, documentIds: string[], kaynak: string) => Promise<number>) | null = null;
  setAktarSonrasiOkumaKancasi(fn: (tenantId: string, documentIds: string[], kaynak: string) => Promise<number>) {
    this.aktarSonrasiOkumaKancasi = fn;
  }

  private isTemporaryTaxType(type?: string | null) {
    return /^(GECICI_VERGI|GGECICI|KGECICI)$/i.test(String(type || ''));
  }

  private normalizeTextKey(value?: string | null) {
    return String(value || '')
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private taxpayerLooksCorporate(taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    const nameKey = this.normalizeTextKey([
      taxpayer?.companyName,
      taxpayer?.firstName,
      taxpayer?.lastName,
    ].filter(Boolean).join(' '));
    if (/\b(LIMITED|LTD|ANONIM|A S|AS|SIRKET|SIRKETI|STI|KOOPERATIF)\b/.test(nameKey)) return true;
    return taxNumber.length === 10;
  }

  private taxpayerLooksPersonal(taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    return taxNumber.length === 11 && !this.taxpayerLooksCorporate(taxpayer);
  }

  private canonicalDeclarationIdentity(
    input: AgentDeclarationInput,
    taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null,
  ) {
    let beyanTipi = String(input.beyanTipi || '').toUpperCase();
    let donem = String(input.donem || '');
    if (this.isTemporaryTaxType(beyanTipi) && this.taxpayerLooksCorporate(taxpayer)) {
      beyanTipi = 'KGECICI';
    } else if (this.isTemporaryTaxType(beyanTipi) && this.taxpayerLooksPersonal(taxpayer)) {
      beyanTipi = 'GGECICI';
    } else if (beyanTipi === 'GECICI_VERGI') {
      const rawKey = this.normalizeTextKey(JSON.stringify(input.raw || {})).replace(/\s+/g, '');
      if (/GGECICI|GELIRGECICI|GELIRVERGISIGECICI/.test(rawKey)) beyanTipi = 'GGECICI';
      else if (/KGECICI|KURUMGECICI|KURUMLARGECICI|KURUMLARVERGISIGECICI/.test(rawKey)) beyanTipi = 'KGECICI';
    }
    if (this.isTemporaryTaxType(beyanTipi)) {
      const monthly = donem.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
      if (monthly) donem = `${monthly[1]}-Q${Math.ceil(Number(monthly[2]) / 3)}`;
    }
    return { beyanTipi, donem };
  }

  @Cron('0 15 2 * * *', { timeZone: 'Europe/Istanbul' })
  async nightlyTick() {
    if (this.envFlag(process.env.PORTAL_AUTOMATION_DISABLE_NIGHTLY || '')) return;
    try {
      const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true, name: true } });
      for (const tenant of tenants) {
        const res = await this.createNightlyJobsForTenant(tenant.id);
        if (res.created.length || res.skipped.length) {
          this.logger.log(`[PortalNightly] ${tenant.name || tenant.id}: created=${res.created.length}, skipped=${res.skipped.length}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[PortalNightly] hata: ${err?.message || err}`);
    }
  }

  async summary(tenantId: string) {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { start, end } = previousIstanbulDayRange(now);

    const [
      credentialRows,
      activeJobs,
      failed24h,
      done24h,
      docs7d,
      tebligat7d,
      tebligatTotal,
      tebligatErrorRows,
      sgkTotal,
      sgkErrorRows,
      latestJobs,
      latestDocuments,
      tebligatBuHaftaTeblig,
      failedNightly7d,
    ] = await Promise.all([
      (this.prisma as any).portalCredential.findMany({
        where: { tenantId },
        include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, isActive: true } } },
      }),
      (this.prisma as any).portalAutomationJob.count({ where: { tenantId, status: { in: ['pending', 'running'] } } }),
      (this.prisma as any).portalAutomationJob.count({ where: { tenantId, status: 'failed', createdAt: { gte: dayAgo } } }),
      (this.prisma as any).portalAutomationJob.count({ where: { tenantId, status: 'done', createdAt: { gte: dayAgo } } }),
      (this.prisma as any).portalDocument.count({ where: { tenantId, createdAt: { gte: sevenDaysAgo } } }),
      // "Bu hafta yeni" = tebligatın GERÇEK gönderim tarihi son 7 günde (kayıt tarihi DEĞİL;
      // bugün toplu çekilen eski tebligatları yeni saymasın).
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: 'E_TEBLIGAT', issuedAt: { gte: sevenDaysAgo } } }),
      // Gerçek TOPLAM e-Tebligat (frontend liste limitinden bağımsız).
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: 'E_TEBLIGAT' } }),
      // Gece sorgusunda HATA alan mükellefler (son 24s E_TEBLIGAT_CHECK failed, mükellef bazında,
      // en güncel hata mesajı + mükellef adı ile — KPI'a tıklayınca liste gösterilir).
      (this.prisma as any).portalAutomationJob.findMany({
        where: { tenantId, jobType: 'E_TEBLIGAT_CHECK', status: 'failed', createdAt: { gte: dayAgo } },
        distinct: ['taxpayerId'],
        orderBy: { createdAt: 'desc' },
        select: {
          taxpayerId: true,
          errorMessage: true,
          createdAt: true,
          taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } },
        },
      }),
      // Toplam SGK belgesi (tahakkuk + hizmet listesi).
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: { in: ['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'] } } }),
      // Son 24s SGK sorgusunda HATA alan mükellefler (mükellef bazında, ad+sebep ile).
      (this.prisma as any).portalAutomationJob.findMany({
        where: { tenantId, jobType: { in: ['SGK_HIZMET_LISTESI', 'SGK_TAHAKKUK'] }, status: 'failed', createdAt: { gte: dayAgo } },
        distinct: ['taxpayerId'],
        orderBy: { createdAt: 'desc' },
        select: {
          taxpayerId: true,
          errorMessage: true,
          taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } },
        },
      }),
      this.listJobs(tenantId, { limit: 8 }),
      this.listDocuments(tenantId, { limit: 8 }),
      // Bu hafta tebliğ edilecekler: tebliğ zamanı (receivedAt) ∈ (şimdi, şimdi+7g] (sözleşme §3).
      (this.prisma as any).portalDocument.count({
        where: { tenantId, belgeTuru: 'E_TEBLIGAT', receivedAt: { gt: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } },
      }),
      // Son 7 gecenin başarısız gece işleri (şifre bloğu kartındaki "gece sayısı" için; mükellef bazında gruplanır).
      (this.prisma as any).portalAutomationJob.findMany({
        where: { tenantId, source: 'nightly', status: 'failed', createdAt: { gte: sevenDaysAgo }, taxpayerId: { not: null } },
        select: { taxpayerId: true, jobType: true, errorMessage: true, createdAt: true },
        take: 5000,
      }),
    ]);

    const tebligatErrors = (Array.isArray(tebligatErrorRows) ? tebligatErrorRows : [])
      .filter((r: any) => r?.taxpayerId)
      .map((r: any) => ({
        taxpayerId: r.taxpayerId,
        name: r.taxpayer?.companyName
          || [r.taxpayer?.firstName, r.taxpayer?.lastName].filter(Boolean).join(' ').trim()
          || r.taxpayer?.taxNumber
          || 'Mükellef',
        taxNumber: r.taxpayer?.taxNumber || null,
        reason: r.errorMessage || null,
        // Sınıflandırılmış hata (şifre / güvenlik kodu / bağlantı / diğer) — kullanıcı metniyle (sözleşme §3).
        hata: hataSiniflandir(r.errorMessage),
      }));
    const tebligatErrorCount = tebligatErrors.length;
    const sgkErrors = (Array.isArray(sgkErrorRows) ? sgkErrorRows : [])
      .filter((r: any) => r?.taxpayerId)
      .map((r: any) => ({
        taxpayerId: r.taxpayerId,
        name: r.taxpayer?.companyName
          || [r.taxpayer?.firstName, r.taxpayer?.lastName].filter(Boolean).join(' ').trim()
          || r.taxpayer?.taxNumber
          || 'Mükellef',
        taxNumber: r.taxpayer?.taxNumber || null,
        reason: r.errorMessage || null,
        hata: hataSiniflandir(r.errorMessage),
      }));
    const sgkErrorCount = sgkErrors.length;
    const credentials = this.summarizeCredentials(credentialRows);
    const credentialsBlocked = this.blockedCredentials(credentialRows, Array.isArray(failedNightly7d) ? failedNightly7d : []);
    return {
      nightly: {
        active: true,
        time: '02:15',
        timezone: 'Europe/Istanbul',
        declarationRange: { start, end },
      },
      runner: {
        enabled: this.runnerEnabled(),
        includeNightly: this.runnerIncludeNightly(),
        deviceId: process.env.PORTAL_AUTOMATION_RAILWAY_DEVICE_ID || 'railway-portal-runner',
        jobTypes: this.runnerJobTypes(),
      },
      stats: { activeJobs, failed24h, done24h, docs7d, tebligat7d, tebligatTotal, tebligatErrorCount, tebligatErrors, sgkTotal, sgkErrorCount, sgkErrors, tebligatBuHaftaTeblig },
      credentials,
      credentialsBlocked,
      latestJobs,
      latestDocuments,
      jobTypes: PORTAL_JOB_TYPES.map((type) => ({ type, ...JOB_META[type] })),
    };
  }

  /**
   * Şifre hatasıyla bloklu portal girişleri (sözleşme §3 credentialsBlocked): lastError sınıfı 'sifre' olan
   * aktif şifreler. geceSayisi = son 7 gecede o mükellef/portal için başarısız GECE işi olan farklı gün sayısı
   * (aynı gece birden çok SGK işi tek gece sayılır); since = bu penceredeki ilk şifre-hatalı gece işi, yoksa lastCheckedAt.
   */
  private blockedCredentials(
    credentialRows: any[],
    failedNightly7d: Array<{ taxpayerId: string | null; jobType: string; errorMessage: string | null; createdAt: Date }>,
  ): Array<{ provider: string; taxpayerId: string | null; ad: string; taxNumber: string | null; since: string | null; hata: HataBilgisi; geceSayisi: number }> {
    const geceler = new Map<string, Set<string>>(); // `${taxpayerId}|${provider}` → gün anahtarları
    const ilkHata = new Map<string, Date>();
    for (const j of failedNightly7d) {
      const provider = JOB_META[j.jobType as PortalJobType]?.provider;
      if (!provider || !j.taxpayerId) continue;
      if (hataSiniflandir(j.errorMessage).tur !== 'sifre') continue;
      const key = `${j.taxpayerId}|${provider}`;
      const gun = startOfIstanbulDay(new Date(j.createdAt)).toISOString();
      const set = geceler.get(key) || new Set<string>();
      set.add(gun);
      geceler.set(key, set);
      const onceki = ilkHata.get(key);
      if (!onceki || new Date(j.createdAt) < onceki) ilkHata.set(key, new Date(j.createdAt));
    }
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    return (Array.isArray(credentialRows) ? credentialRows : [])
      .filter((c: any) => c?.lastError && c.isActive !== false && c.taxpayer?.isActive !== false)
      .map((c: any) => ({ c, hata: hataSiniflandir(c.lastError) }))
      .filter(({ hata }) => hata.tur === 'sifre')
      .map(({ c, hata }) => {
        const key = `${c.taxpayerId || ''}|${c.provider}`;
        const since = ilkHata.get(key) || (c.lastCheckedAt ? new Date(c.lastCheckedAt) : null);
        return {
          provider: String(c.provider),
          taxpayerId: c.taxpayerId || null,
          ad: c.ownerType === 'TENANT' ? 'Mali müşavir (e-Beyanname)' : adFormat(c.taxpayer) || 'Mükellef',
          taxNumber: c.taxpayer?.taxNumber || null,
          since: since && !Number.isNaN(since.getTime()) ? since.toISOString() : null,
          hata,
          geceSayisi: geceler.get(key)?.size || 0,
        };
      })
      .sort((a, b) => collator.compare(a.ad, b.ad));
  }

  async credentialStatus(tenantId: string) {
    const rows: any[] = await (this.prisma as any).portalCredential.findMany({
      where: { tenantId },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ provider: 'asc' }, { updatedAt: 'desc' }],
    });
    return {
      summary: this.summarizeCredentials(rows),
      rows: rows.map((c: any) => this.publicCredential(c)),
    };
  }

  async credentialInsights(tenantId: string) {
    const rows: any[] = await (this.prisma as any).portalCredential.findMany({
      where: {
        tenantId,
        ownerType: 'TAXPAYER',
        provider: { in: ['GIB_IVD', 'SGK_EBILDIRGE'] },
        isActive: true,
      },
      include: {
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            taxNumber: true,
            taxOffice: true,
            isActive: true,
          },
        },
      },
    });

    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    const itemFor = (row: any, reason?: string) => ({
      id: row.taxpayer?.id || row.taxpayerId || row.ownerId,
      name: adFormat(row.taxpayer),
      taxNumber: row.taxpayer?.taxNumber || null,
      taxOffice: row.taxpayer?.taxOffice || null,
      reason: reason || row.lastError || null,
    });
    const sortItems = (items: any[]) => items.sort((a, b) => collator.compare(a.name || '', b.name || ''));
    const credentialKey = (...parts: Array<string | null | undefined>) => {
      const exactParts = parts.map((part) => String(part || '').trim());
      return exactParts.every(Boolean) ? exactParts.join('\u0001') : '';
    };
    const isWrongCredentialError = (error?: string | null) => {
      const normalized = normalizeTextKey(String(error || ''));
      if (!normalized) return false;
      if (normalized.includes('PORTAL GIRIS ALANLARI BULUNAMADI')) return false;
      if (normalized.includes('PORTAL LOGIN FORMU YUKLENMEDI')) return false;
      if (normalized.includes('ALANI BULUNAMADI')) return false;
      return true;
    };
    const groupByCredential = (provider: PortalProvider, keyOf: (row: any) => string) => {
      const groups = new Map<string, any[]>();
      for (const row of rows) {
        if (row.provider !== provider || row.taxpayer?.isActive === false) continue;
        const key = keyOf(row);
        if (!key) continue;
        const group = groups.get(key) || [];
        group.push(row);
        groups.set(key, group);
      }
      const affected = Array.from(groups.values())
        .filter((group) => group.length > 1)
        .flatMap((group) => group.map((row) => itemFor(row, 'Aynı portal giriş bilgisi kullanılıyor')));
      return sortItems(affected);
    };

    const gibSame = groupByCredential('GIB_IVD', (row) => {
      return credentialKey(
        row.userCode || row.username,
        tryDecrypt(row.encryptedSecondaryPassword) || tryDecrypt(row.encryptedPassword),
      );
    });
    const sgkSame = groupByCredential('SGK_EBILDIRGE', (row) => {
      return credentialKey(
        row.username || row.userCode,
        row.workplaceCode,
        tryDecrypt(row.encryptedPassword),
        tryDecrypt(row.encryptedSecondaryPassword),
      );
    });

    const wrongFor = (provider: PortalProvider) => sortItems(rows
      .filter((row) => row.provider === provider && row.taxpayer?.isActive !== false && isWrongCredentialError(row.lastError))
      .map((row) => itemFor(row)));

    const workplaceIz = sortItems(rows
      .filter((row) => row.provider === 'SGK_EBILDIRGE' && row.taxpayer?.isActive !== false)
      .filter((row) => {
        const workplace = this.plainCredentialPart(row.workplaceCode);
        const secondary = this.plainCredentialPart(tryDecrypt(row.encryptedSecondaryPassword));
        return workplace === 'IZ' || secondary === 'IZ';
      })
      .map((row) => itemFor(row, 'İş yeri bilgisi "iz" olarak kayıtlı')));

    const cards = [
      { key: 'sgk_same', label: 'Bildirge şifresi aynı olanlar', tone: 'blue', count: sgkSame.length, taxpayers: sgkSame },
      { key: 'gib_same', label: 'VD şifresi aynı olanlar', tone: 'blue', count: gibSame.length, taxpayers: gibSame },
      { key: 'gib_wrong', label: 'VD şifresi yanlış olanlar', tone: 'amber', count: wrongFor('GIB_IVD').length, taxpayers: wrongFor('GIB_IVD') },
      { key: 'sgk_wrong', label: 'Bildirge şifresi yanlış olanlar', tone: 'amber', count: wrongFor('SGK_EBILDIRGE').length, taxpayers: wrongFor('SGK_EBILDIRGE') },
      { key: 'workplace_iz', label: 'İş yeri "iz" olanlar', tone: 'amber', count: workplaceIz.length, taxpayers: workplaceIz },
    ];

    return { cards };
  }

  async saveCredential(tenantId: string, userId: string | null, input: any) {
    const provider = String(input?.provider || '').trim().toUpperCase();
    if (!isPortalProvider(provider)) throw new BadRequestException('Gecersiz provider');

    const ownerType = provider === 'GIB_EBEYANNAME' ? 'TENANT' : 'TAXPAYER';
    const taxpayerId = ownerType === 'TAXPAYER' ? String(input?.taxpayerId || '').trim() : null;
    if (ownerType === 'TAXPAYER' && !taxpayerId) throw new BadRequestException('Mukellef secimi gerekli');

    if (taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
      if (!tp) throw new NotFoundException('Mukellef bulunamadi');
    }

    const ownerId = ownerType === 'TENANT' ? tenantId : taxpayerId!;
    const existing = await (this.prisma as any).portalCredential.findUnique({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
    });

    if (!existing && !input?.password && !input?.secondaryPassword) {
      throw new BadRequestException('Yeni sifre kaydi icin sifre zorunlu');
    }

    const credentialPasswordChanged = Boolean(input?.password || input?.secondaryPassword);
    const data: any = {
      username: input?.username ? String(input.username).trim() : null,
      userCode: input?.userCode ? String(input.userCode).trim() : null,
      officeCode: input?.officeCode ? String(input.officeCode).trim() : null,
      workplaceCode: input?.workplaceCode ? String(input.workplaceCode).trim() : null,
      isActive: input?.isActive !== false,
      notes: input?.notes ? String(input.notes).slice(0, 1000) : null,
      updatedBy: userId,
      lastError: credentialPasswordChanged ? null : existing?.lastError || null,
    };
    if (['GIB_EBEYANNAME', 'GIB_IVD'].includes(provider) && input?.secondaryPassword) {
      data.encryptedPassword = null;
    }
    if (input?.password) data.encryptedPassword = encrypt(String(input.password));
    if (input?.secondaryPassword) data.encryptedSecondaryPassword = encrypt(String(input.secondaryPassword));

    const row = await (this.prisma as any).portalCredential.upsert({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
      create: {
        tenantId,
        provider,
        ownerType,
        ownerId,
        taxpayerId,
        ...data,
      },
      update: data,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
    });
    if (credentialPasswordChanged) {
      // Şifre yenilendi → bu portal/mükellef için açık "Portal şifre hatası" bildirimlerini kendiliğinden kapat.
      //   (dedupe anahtarı: portal-cred-fail:<provider>:<ownerId>; hata sürerse bir sonraki işte yeniden üretilir.)
      await this.notifications
        .resolveByDedupePrefix(tenantId, `portal-cred-fail:${provider}:${ownerId}`)
        .catch(() => 0);
    }
    if (provider === 'SGK_EBILDIRGE' && taxpayerId && this.isReadySgkCredential(row)) {
      await this.ensureSgkBildirgeConfig(taxpayerId);
    }
    return this.publicCredential(row);
  }

  async listJobs(tenantId: string, opts: { limit?: number; status?: string; jobType?: string } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit || 30), 1), 200);
    const where: any = { tenantId };
    if (opts.status) where.status = { in: String(opts.status).split(',').map((s) => s.trim()).filter(Boolean) };
    if (opts.jobType) where.jobType = { in: String(opts.jobType).split(',').map((s) => s.trim()).filter(Boolean) };
    return (this.prisma as any).portalAutomationJob.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    });
  }

  async listDocuments(tenantId: string, opts: { limit?: number; taxpayerId?: string; belgeTuru?: string; period?: string } = {}) {
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    const range = monthRange(opts.period);
    if (range) {
      where.OR = [
        { period: opts.period },
        { issuedAt: { gte: range.start, lt: range.end } },
        // ESKİ-BOZUK DÖNEM KAYDI (Ercan Haziran bulgusu): ilk kaydeden iş dönem/tarihi yanlış
        //   yazmışsa (örn. '2026-05' etiketi) mükerrer-önleme sonraki doğru sorgularda da
        //   düzeltmiyordu → belge dönem filtresinde hiç görünmüyordu. GİB'in kendi satırındaki
        //   belge tarihi (dd/MM/yyyy) raw.row'da durur; onunla da eşleştir.
        { raw: { path: ['row', 'belgeTarihi'], string_contains: `/${String(opts.period).slice(5, 7)}/${String(opts.period).slice(0, 4)}` } },
      ];
    } else if (opts.period) {
      where.period = opts.period;
    }
    if (opts.belgeTuru) {
      // virgülle çoklu belgeTürü (örn. SGK_TAHAKKUK,SGK_HIZMET_LISTESI)
      const ts = String(opts.belgeTuru).split(',').map((s) => s.trim()).filter(Boolean);
      where.belgeTuru = ts.length > 1 ? { in: ts } : ts[0];
    }
    // limit === 0 -> SINIRSIZ (hepsi); aksi halde varsayılan 50, üst sınır 50000.
    const raw = Number(opts.limit);
    const take = raw === 0 ? undefined : Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 50, 1), 50000);
    return (this.prisma as any).portalDocument.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      // GÖNDERIM tarihine göre (yeni→eski); tarihsizler en sona; eşitlikte kayıt zamanı.
      orderBy: [{ issuedAt: { sort: 'desc', nulls: 'last' } }, { receivedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      ...(take !== undefined ? { take } : {}),
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SAYFALI belge listesi — GET /portal-automation/documents/sayfa (sözleşme §1)
  // listDocuments() mobil/masaüstü tarafından kullanıldığı için DOKUNULMADI; bu ayrı uç.
  // Yol: süzgeç + sıralama + sayfa TEK ham SQL'de (parametreli $queryRaw şablonu, metin birleştirme YOK) →
  //   sayfanın belge id'leri/anahtarları; veri Prisma findMany + select ile çekilir. Neden ham SQL:
  //   (1) 'mukellef' sıralaması unvan '' / NULL karışık (canlı veri) — COALESCE(NULLIF(...)) gerekiyor,
  //   (2) raw JSON'da kurum/kanun araması ILIKE ile harfe DUYARSIZ olsun, (3) SGK birleşik mod GROUP BY ister;
  //   böylece iki mod aynı süzgeç kodunu paylaşır. raw JSON yanıta girmez; yalnız özet (ozet) çıkarılır.
  // ══════════════════════════════════════════════════════════════════════
  async listDocumentsSayfa(tenantId: string, q: SayfaSorgusu = {}) {
    const belgeTurleri = belgeTuruListesi(q.belgeTuru);
    if (!belgeTurleri.length) throw new BadRequestException('belgeTuru zorunlu');
    const page = sayfaCoz(q.page);
    const pageSize = sayfaBoyutuCoz(q.pageSize);
    const now = new Date();
    const sirala = ['yeni', 'eski', 'mukellef'].includes(String(q.sirala || '')) ? String(q.sirala) : 'yeni';
    const durum = String(q.durum || '').trim();
    const taxpayerId = String(q.taxpayerId || '').trim();
    const donemler = donemVaryantlari(q.period);
    const parcalar = aramaParcalari(q.search);
    const tebligatVar = belgeTurleri.includes('E_TEBLIGAT');
    const sgkVar = belgeTurleri.some(sgkBelgeTuruMu);
    // Birleşik mod yalnız SGK belgeleri için anlamlı (tahakkuk + hizmet listesi tek satır).
    const birlesik = ['1', 'true', 'evet'].includes(String(q.birlesik || '').trim().toLowerCase()) && sgkVar && !tebligatVar;

    // ── WHERE (her iki mod ortak) ──
    const kosullar: Prisma.Sql[] = [
      Prisma.sql`d."tenantId" = ${tenantId}`,
      Prisma.sql`d."belgeTuru" IN (${Prisma.join(belgeTurleri)})`,
    ];
    if (taxpayerId) kosullar.push(Prisma.sql`d."taxpayerId" = ${taxpayerId}`);
    // Dönem: SGK → period alanı ('2024/05' ya da '2024-05'); tebligat → issuedAt ayı (YYYY-MM).
    if (donemler.length) {
      const aylik = monthRange(donemler.find((d) => d.includes('-')) || null);
      const donemKosullari: Prisma.Sql[] = [];
      if (sgkVar || !tebligatVar || !aylik) donemKosullari.push(Prisma.sql`d."period" IN (${Prisma.join(donemler)})`);
      if (tebligatVar && aylik) donemKosullari.push(Prisma.sql`(d."issuedAt" >= ${aylik.start} AND d."issuedAt" < ${aylik.end})`);
      kosullar.push(Prisma.sql`(${Prisma.join(donemKosullari, ' OR ')})`);
    }
    // Durum süzgeci (SGK tahakkuk/hizmet birleşik modda HAVING ile).
    switch (durum) {
      case 'teblig_yaklasan':
        kosullar.push(Prisma.sql`(d."receivedAt" >= ${now} AND d."receivedAt" <= ${new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)})`);
        break;
      case 'teblig_edildi':
        kosullar.push(Prisma.sql`d."receivedAt" < ${now}`);
        break;
      case 'goruntulenmemis':
        kosullar.push(Prisma.sql`d."viewedAt" IS NULL`);
        break;
      case 'tahakkuk':
        if (!birlesik) kosullar.push(Prisma.sql`d."belgeTuru" = 'SGK_TAHAKKUK'`);
        break;
      case 'hizmet':
        if (!birlesik) kosullar.push(Prisma.sql`d."belgeTuru" = 'SGK_HIZMET_LISTESI'`);
        break;
      default:
        break;
    }
    // Arama: her parça (boşlukla ayrılmış) ayrı ayrı eşleşmeli; ILIKE → büyük/küçük harf duyarsız
    //   (mükellef adı/VKN, belge no, kurum/alt kurum; SGK'da dönem ve kanun no).
    for (const parca of parcalar) {
      const p = `%${likeKacis(parca)}%`;
      const alanlar: Prisma.Sql[] = [
        Prisma.sql`t."companyName" ILIKE ${p}`,
        Prisma.sql`t."firstName" ILIKE ${p}`,
        Prisma.sql`t."lastName" ILIKE ${p}`,
        Prisma.sql`t."taxNumber" ILIKE ${p}`,
        Prisma.sql`d."referenceNo" ILIKE ${p}`,
        Prisma.sql`d."raw"->>'kurumAciklama' ILIKE ${p}`,
        Prisma.sql`d."raw"->>'altKurum' ILIKE ${p}`,
      ];
      if (sgkVar) alanlar.push(Prisma.sql`d."period" ILIKE ${p}`, Prisma.sql`d."raw"->>'kanunNo' ILIKE ${p}`);
      kosullar.push(Prisma.sql`(${Prisma.join(alanlar, ' OR ')})`);
    }
    const kaynak = Prisma.sql`FROM "portal_documents" d LEFT JOIN "taxpayers" t ON t."id" = d."taxpayerId" WHERE ${Prisma.join(kosullar, ' AND ')}`;
    // LIMIT/OFFSET doğrulanmış tam sayılar (sayfaCoz/sayfaBoyutuCoz) → metne gömülür.
    const limit = Prisma.raw(String(pageSize));
    const offset = Prisma.raw(String((page - 1) * pageSize));
    // Mükellef adı: unvan; unvan boş/NULL ise ad soyad (canlı veride her iki biçim de var).
    const mukellefAdi = Prisma.sql`COALESCE(NULLIF(t."companyName", ''), NULLIF(TRIM(CONCAT(t."firstName", ' ', t."lastName")), ''))`;

    if (birlesik) {
      return this.listSgkBirlesikSayfa(tenantId, { belgeTurleri, kaynak, durum, sirala, page, pageSize, limit, offset, mukellefAdi, now });
    }

    // ── Düz mod: id sayfası + toplam (SQL) → belgeler (Prisma) ──
    const tarihAlani = tebligatVar || !sgkVar ? Prisma.sql`d."issuedAt"` : Prisma.sql`d."period"`;
    const siralama = sirala === 'mukellef'
      ? Prisma.sql`ORDER BY ${mukellefAdi} ASC NULLS LAST, ${tarihAlani} DESC NULLS LAST, d."createdAt" DESC`
      : sirala === 'eski'
        ? Prisma.sql`ORDER BY ${tarihAlani} ASC NULLS LAST, d."createdAt" ASC`
        : Prisma.sql`ORDER BY ${tarihAlani} DESC NULLS LAST, d."createdAt" DESC`;
    const [idSatirlari, sayim] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`SELECT d."id" ${kaynak} ${siralama} LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS "n" ${kaynak}`,
    ]);
    const total = Number(sayim?.[0]?.n ?? 0);
    const idler = idSatirlari.map((r) => r.id);
    if (!idler.length) return { rows: [] as BelgeSatiri[], total, page, pageSize };
    const docs: SayfaBelgeKaydi[] = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, id: { in: idler } },
      select: SAYFA_BELGE_SELECT,
    });
    const sira = new Map(idler.map((id, i) => [id, i]));
    docs.sort((a, b) => (sira.get(a.id) ?? 0) - (sira.get(b.id) ?? 0));
    const rows = docs.map((d) => belgeSatiriKur(d, now));
    await this.sayfaIletimEkle(tenantId, belgeTurleri, rows, pageSize);
    return { rows, total, page, pageSize };
  }

  /**
   * SGK birleşik sayfa: aynı bildirgenin tahakkuk + hizmet listesi belgeleri mükellef + (referenceNo || period)
   * anahtarıyla TEK satır. Sayfalama birleşik satır üzerinden: ham SQL GROUP BY ile anahtar sayfası + toplam,
   * sonra o anahtarların belgeleri Prisma ile çekilip satırlar kurulur (tahakkuk id'si satır id'si).
   */
  private async listSgkBirlesikSayfa(
    tenantId: string,
    o: { belgeTurleri: string[]; kaynak: Prisma.Sql; durum: string; sirala: string; page: number; pageSize: number; limit: Prisma.Sql; offset: Prisma.Sql; mukellefAdi: Prisma.Sql; now: Date },
  ) {
    // durum=tahakkuk|hizmet → birleşik satırda ilgili alt belgesi olanlar.
    const having = o.durum === 'tahakkuk'
      ? Prisma.sql`HAVING bool_or(d."belgeTuru" = 'SGK_TAHAKKUK')`
      : o.durum === 'hizmet'
        ? Prisma.sql`HAVING bool_or(d."belgeTuru" = 'SGK_HIZMET_LISTESI')`
        : Prisma.empty;
    const govde = Prisma.sql`${o.kaynak} GROUP BY d."taxpayerId", COALESCE(d."referenceNo", d."period") ${having}`;
    const siralama = o.sirala === 'mukellef'
      ? Prisma.sql`ORDER BY MAX(${o.mukellefAdi}) ASC NULLS LAST, MAX(d."period") DESC NULLS LAST, MAX(d."createdAt") DESC`
      : o.sirala === 'eski'
        ? Prisma.sql`ORDER BY MAX(d."period") ASC NULLS LAST, MAX(d."createdAt") ASC`
        : Prisma.sql`ORDER BY MAX(d."period") DESC NULLS LAST, MAX(d."createdAt") DESC`;

    const [anahtarlar, sayim] = await Promise.all([
      this.prisma.$queryRaw<Array<{ taxpayerId: string | null; anahtar: string | null }>>`
        SELECT d."taxpayerId" AS "taxpayerId", COALESCE(d."referenceNo", d."period") AS "anahtar"
        ${govde}
        ${siralama}
        LIMIT ${o.limit} OFFSET ${o.offset}`,
      this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS "n" FROM (SELECT 1 ${govde}) g`,
    ]);
    const total = Number(sayim?.[0]?.n ?? 0);
    if (!anahtarlar.length) return { rows: [] as BelgeSatiri[], total, page: o.page, pageSize: o.pageSize };

    // Sayfadaki anahtarların belgeleri (tahakkuk + hizmet) — IN ile çek, bellekte anahtara göre grupla.
    const tpIdler = Array.from(new Set(anahtarlar.map((a) => a.taxpayerId).filter((v): v is string => Boolean(v))));
    const anahtarMetinleri = Array.from(new Set(anahtarlar.map((a) => a.anahtar).filter((v): v is string => Boolean(v))));
    const docs: SayfaBelgeKaydi[] = await (this.prisma as any).portalDocument.findMany({
      where: {
        tenantId,
        belgeTuru: { in: o.belgeTurleri },
        ...(tpIdler.length ? { taxpayerId: { in: tpIdler } } : {}),
        OR: [
          { referenceNo: { in: anahtarMetinleri } },
          { referenceNo: null, period: { in: anahtarMetinleri } },
        ],
      },
      select: SAYFA_BELGE_SELECT,
    });
    const gruplar = new Map<string, SayfaBelgeKaydi[]>();
    for (const d of docs) {
      const k = sgkBirlesikAnahtar(d);
      const g = gruplar.get(k) || [];
      g.push(d);
      gruplar.set(k, g);
    }
    const rows: BelgeSatiri[] = [];
    for (const a of anahtarlar) {
      const grup = gruplar.get(`${a.taxpayerId || ''}|${a.anahtar || ''}`) || [];
      const satir = sgkBirlesikSatirKur(grup, o.now);
      if (satir) rows.push(satir);
    }
    await this.sayfaIletimEkle(tenantId, o.belgeTurleri, rows, o.pageSize);
    return { rows, total, page: o.page, pageSize: o.pageSize };
  }

  /**
   * Sayfadaki satırlara iletim bilgisini yazar: document_dispatches (kategori ETEBLIGAT/SGK, sayfadaki
   * mükellefler) çekilir, docRefs dizisi belge id'sini içerenler bellekte eşlenir (kanal başına en yenisi).
   */
  private async sayfaIletimEkle(tenantId: string, belgeTurleri: string[], rows: BelgeSatiri[], pageSize: number) {
    if (!rows.length) return;
    const kategoriler = Array.from(new Set(belgeTurleri.map(iletimKategorisi).filter((v): v is 'SGK' | 'ETEBLIGAT' => Boolean(v))));
    const tpIdler = Array.from(new Set(rows.map((r) => r.taxpayerId).filter((v): v is string => Boolean(v))));
    if (!kategoriler.length || !tpIdler.length) return;
    const gonderimler: any[] = await (this.prisma as any).documentDispatch.findMany({
      where: { tenantId, kategori: kategoriler.length > 1 ? { in: kategoriler } : kategoriler[0], taxpayerId: { in: tpIdler } },
      orderBy: { createdAt: 'desc' },
      select: { channel: true, status: true, sentAt: true, error: true, testMode: true, docRefs: true, createdAt: true },
      // Dışa aktarım sayfalarında (pageSize > 100) daha geniş pencere.
      take: pageSize > 100 ? 3000 : 500,
    }).catch(() => []);
    if (!gonderimler.length) return;
    for (const satir of rows) satir.iletim = iletimEsle(satirBelgeIdleri(satir), gonderimler);
  }

  /**
   * GET /portal-automation/documents/mukellefler?belgeTuru=… (sözleşme §2)
   * Süzgeç listesi: belgesi olan mükellefler ∪ ilgili portal şifresi olanlar (tebligat GIB_IVD, SGK SGK_EBILDIRGE).
   */
  async listDocumentTaxpayers(tenantId: string, belgeTuru?: string) {
    const belgeTurleri = belgeTuruListesi(belgeTuru);
    if (!belgeTurleri.length) throw new BadRequestException('belgeTuru zorunlu');
    const providers: PortalProvider[] = [];
    if (belgeTurleri.includes('E_TEBLIGAT')) providers.push('GIB_IVD');
    if (belgeTurleri.some(sgkBelgeTuruMu)) providers.push('SGK_EBILDIRGE');

    const [sayimlar, sifreler] = await Promise.all([
      (this.prisma as any).portalDocument.groupBy({
        by: ['taxpayerId'],
        where: { tenantId, belgeTuru: { in: belgeTurleri }, taxpayerId: { not: null } },
        _count: { _all: true },
      }) as Promise<Array<{ taxpayerId: string | null; _count: { _all: number } }>>,
      providers.length
        ? ((this.prisma as any).portalCredential.findMany({
            where: { tenantId, provider: { in: providers }, ownerType: 'TAXPAYER', taxpayerId: { not: null } },
            select: { taxpayerId: true, provider: true, isActive: true, lastError: true, encryptedPassword: true, encryptedSecondaryPassword: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
          }) as Promise<any[]>)
        : Promise.resolve([] as any[]),
    ]);

    const belgeSayisi = new Map<string, number>();
    for (const s of sayimlar) if (s.taxpayerId) belgeSayisi.set(s.taxpayerId, Number(s._count?._all ?? 0));
    const sifreVar = new Map<string, boolean>();
    const sifreHatasi = new Map<string, string | null>();
    for (const c of sifreler) {
      const id = String(c.taxpayerId);
      const var_ = c.isActive !== false && Boolean(c.encryptedPassword || c.encryptedSecondaryPassword);
      sifreVar.set(id, Boolean(sifreVar.get(id)) || var_);
      if (!sifreHatasi.has(id) || (!sifreHatasi.get(id) && c.lastError)) sifreHatasi.set(id, c.lastError || null);
    }
    const idler = Array.from(new Set([...belgeSayisi.keys(), ...sifreVar.keys()]));
    if (!idler.length) return { rows: [] };
    const mukellefler: any[] = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, id: { in: idler } },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
    });
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    const rows = mukellefler
      .map((tp) => ({
        id: tp.id,
        ad: adFormat(tp),
        taxNumber: tp.taxNumber || null,
        belgeSayisi: belgeSayisi.get(tp.id) || 0,
        sifreVar: sifreVar.get(tp.id) || false,
        sifreHatasi: sifreHatasi.get(tp.id) || null,
      }))
      .sort((a, b) => collator.compare(a.ad, b.ad));
    return { rows };
  }

  async getDocumentViewUrl(tenantId: string, docId: string) {
    const doc = await (this.prisma as any).portalDocument.findFirst({
      where: { id: docId, tenantId },
      select: { id: true, storageKey: true, mimeType: true, title: true, referenceNo: true, viewedAt: true },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadi');
    if (!doc.storageKey) throw new BadRequestException('Bu tebligatin PDF dosyasi henuz indirilmedi (bir sonraki sorguda gelir).');
    // İlk görüntülemede damgala → buton kalıcı yeşile döner.
    let viewedAt = doc.viewedAt;
    if (!viewedAt) {
      viewedAt = new Date();
      await (this.prisma as any).portalDocument.update({ where: { id: doc.id }, data: { viewedAt } }).catch(() => {});
    }
    const filename = `${doc.referenceNo || doc.title || 'tebligat'}.pdf`;
    const url = await this.storage.getPresignedInlineUrl(doc.storageKey, filename, doc.mimeType || 'application/pdf');
    return { url, viewedAt };
  }

  async listEarsivPortalInvoices(
    tenantId: string,
    opts: { taxpayerId?: string; period?: string; limit?: number } = {},
  ) {
    const docs = await this.listDocuments(tenantId, {
      taxpayerId: opts.taxpayerId,
      period: opts.period,
      belgeTuru: 'EARSIV_FATURA',
      limit: Math.min(Math.max(Number(opts.limit || 300), 1), 1000),
    });
    this.logger.log(`[EARSIV-READ] taxpayerId=${opts.taxpayerId} period=${opts.period} -> DB'de ${docs.length} EARSIV_FATURA belge bulundu`);
    const refs = new Set<string>();
    const rows = docs.map((doc: any) => {
      const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : {};
      const portalRow = raw.row && typeof raw.row === 'object' ? raw.row : {};
      const ettn = String(raw.ettn || portalRow.ettn || portalRow.uuid || '').trim();
      const belgeNo = String(raw.belgeNumarasi || doc.referenceNo || portalRow.belgeNumarasi || portalRow.faturaNo || '').trim();
      const sourceRefId = ettn || belgeNo || String(doc.referenceNo || '').trim();
      if (sourceRefId) refs.add(sourceRefId);
      const onayDurumu = String(raw.onayDurumu || portalRow.onayDurumu || portalRow.durum || '').trim() || 'Onaylandi';
      const iptalDurumu = String(portalRow.iptalItirazDurumu || portalRow.iptalDurumu || portalRow.itirazDurumu || raw.iptalDurumu || '').trim();
      const issuedAt = doc.issuedAt || parseDateOrNull(String(
        portalRow.belgeTarihi ||
        portalRow.faturaTarihi ||
        portalRow.duzenlemeTarihi ||
        portalRow.tarih ||
        '',
      ));
      // "Silinmiş/Silindi" (2026-09-15 canlı bulgu, EDELER Ağustos): GİB portalında silinen belge onay durumu "Silinmiş" gelir;
      //   eski süzgeç yalnız iptal/itiraz/red bakıyordu → aktarılabilir sayılıyordu. Silinmiş belge de işlenmez.
      // "Onay bekliyor" (2026-09-15 canlı bulgu, ÖMER ÖZEN GIB2026000000473 İMZASIZ): GİB'de onaylanmamış/imzasız belge henüz
      //   fatura değildir → aktarılmaz (ekranda "Onay bekleyen" sayacında kalır, aktarılabilir sayılmaz).
      const onayBekliyor = /onaylanmad|bekl|taslak|draft|imzas[ıi]z|pending|wait/i.test(onayDurumu);
      const blocked = onayBekliyor || /iptal|itiraz|red|reddedil|cancel|silin/i.test(`${onayDurumu} ${iptalDurumu}`);
      return {
        id: doc.id,
        portalDocumentId: doc.id,
        taxpayerId: doc.taxpayerId,
        referenceNo: doc.referenceNo,
        belgeNo,
        ettn,
        buyerName: String(portalRow.aliciUnvanAdSoyad || portalRow.aliciUnvan || portalRow.unvan || '').trim(),
        buyerVkn: String(portalRow.vknTckn || portalRow.aliciVknTckn || portalRow.aliciVkn || portalRow.aliciTckn || portalRow.aliciVergiNo || portalRow.kimlikNo || '').replace(/\D/g, ''),
        issuedAt,
        period: doc.period,
        title: doc.title,
        onayDurumu,
        iptalDurumu: iptalDurumu || 'Yok',
        aktarimDurumu: doc.storageKey ? 'indirildi' : 'sorgulandi',
        sorguMode: String(raw.mode || portalRow.mode || 'query'),
        isProcessable: !blocked,
        blockedReason: blocked ? (onayBekliyor ? 'Onay bekleyen (imzasiz) fatura islenmez' : /silin/i.test(onayDurumu) ? 'Silinmis fatura islenmez' : 'Iptal/itiraz/reddedilen fatura islenmez') : null,
        sourceRefId,
        // AKTARIM ÖNCESİ TUTAR (2026-09-15, Muzaffer Bey ERDOĞAN BALÇIK: "sorgulama tutarları getirmiyor"): GİB liste API'si tutar
        //   vermez; indirilmiş HTML'den ayrıştırılıp raw.tutarlar'a önbelleklenir (aşağıda). Muhasebe belgesi varsa o esastır.
        _storageKey: doc.storageKey || null,
        _tutarlar: raw.tutarlar && typeof raw.tutarlar === 'object' ? raw.tutarlar : null,
      };
    });
    // Belgesi olmayan, HTML'i indirilmiş satırlar: tutarları dosyadan oku (istek başına en çok 40; gerisi sonraki yenilemede).
    //   Sonuç portal_documents.raw.tutarlar'a yazılır → bir sonraki listede dosya okunmaz.
    {
      const okunacak = rows.filter((r: any) => r._storageKey && !r._tutarlar).slice(0, 40);
      for (const r of okunacak) {
        try {
          const b64 = await this.storage.getBuffer(r._storageKey).then((b) => b.toString('base64'));
          const t = await this.parseEarsivPayloadBase64(b64);
          const tutarlar = { kdvHaric: t?.matrah ?? null, kdv: t?.kdvTutari ?? null, toplam: t?.total ?? null, okundu: new Date().toISOString() };
          r._tutarlar = tutarlar;
          const mevcut: any = docs.find((d: any) => d.id === r.portalDocumentId);
          const rawEski = mevcut?.raw && typeof mevcut.raw === 'object' ? mevcut.raw : {};
          await (this.prisma as any).portalDocument.update({ where: { id: r.portalDocumentId }, data: { raw: { ...rawEski, tutarlar } } }).catch(() => null);
        } catch (e: any) {
          r._tutarlar = { kdvHaric: null, kdv: null, toplam: null, okundu: new Date().toISOString(), hata: String(e?.message || e).slice(0, 120) };
        }
      }
    }
    // KAYNAKLAR-ARASI EŞLEŞME (Gülşen Haziran bulgusu): ayni fatura Fatura Merkezi'ne GİB yerine
    //   entegratör yolundan (örn. TÜRMOB) gelmiş ve işlenmiş/Luca'ya aktarılmış olabilir. Eski
    //   sorgu yalnız source='gib-earsiv-api' kayıtlarına baktığından bu belgeler AKTARIM sütununda
    //   ✗ görünüyor, tutarlar boş kalıyordu (yanlış-negatif) ve "aktar" mükerrer içe aktarım riski
    //   doğuruyordu. ETTN ve belge no ile KAYNAKTAN BAĞIMSIZ eşleştir.
    const belgeNos = [...new Set(rows.map((r: any) => String(r.belgeNo || '').trim()).filter(Boolean))];
    // ETTN/belge no iki tarafta farklı harf biçimiyle (büyük/küçük ETTN) tutulmuş olabilir —
    //   birebir IN sorgusu bu yüzden kaçırıyordu; hem sorgu hem harita harf-duyarsız yapıldı.
    const accountingRows = (refs.size || belgeNos.length)
      ? await (this.prisma as any).invoiceAccountingDocument.findMany({
          where: {
            tenantId,
            ...(opts.taxpayerId ? { taxpayerId: opts.taxpayerId } : {}),
            OR: [
              ...(refs.size ? [{ sourceRefId: { in: [...refs], mode: 'insensitive' } }] : []),
              ...(belgeNos.length ? [{ belgeNo: { in: belgeNos, mode: 'insensitive' } }] : []),
            ],
          },
          select: { id: true, taxpayerId: true, sourceRefId: true, belgeNo: true, status: true, lucaStatus: true, totalAmount: true, ocrData: true },
        }).catch(() => [])
      : [];
    const accByRef = new Map<string, any>();
    const accByBelgeNo = new Map<string, any>();
    for (const r of accountingRows) {
      const ref = String(r.sourceRefId || '').trim().toUpperCase();
      if (ref && !accByRef.has(ref)) accByRef.set(ref, r);
      const bn = String(r.belgeNo || '').trim().toUpperCase();
      if (bn) {
        const key = `${r.taxpayerId || ''}|${bn}`;
        if (!accByBelgeNo.has(key)) accByBelgeNo.set(key, r);
      }
    }
    const num = (v: any): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return rows.map((row: any) => {
      const acc = accByRef.get(String(row.sourceRefId || '').trim().toUpperCase())
        || (row.belgeNo ? accByBelgeNo.get(`${row.taxpayerId || ''}|${String(row.belgeNo).trim().toUpperCase()}`) : undefined);
      // "Aktarıldı mı" YALNIZ GERÇEK kaynaktan (invoiceAccountingDocument.lucaStatus) okunur.
      //   Denetim bulgusu: eski YEDEK OR bacağı (aktarimDurumu==='indirildi' && sorguMode==='download')
      //   YANLIŞ-POZİTİF üretiyordu — belge indirilmiş ama Luca'ya HİÇ gönderilmemişken (lucaStatus
      //   null) AKTARIM sütunu ✓ görünüyor, kullanıcı Luca'ya aktarıldı sanıyordu. Bacak kaldırıldı;
      //   lucaStatus='POSTED'/'POSTING' tek doğru kaynaktır.
      const importedByDownload = !!acc && ['POSTED', 'POSTING'].includes(String(acc.lucaStatus || ''));
      // Muhasebe belgesinden tutar (matrah / KDV / genel toplam) — listede göstermek için.
      const ocr = acc?.ocrData && typeof acc.ocrData === 'object' ? acc.ocrData : null;
      const dosyaTutar: any = row._tutarlar || null;
      const { _storageKey, _tutarlar, ...temiz } = row;
      return {
        ...temiz,
        muhasebeBelgeId: acc?.id || null,
        muhasebeDurumu: acc?.status || null,
        lucaDurumu: acc?.lucaStatus || null,
        kdvHaric: ocr ? num(ocr.matrah) : (dosyaTutar ? num(dosyaTutar.kdvHaric) : null),
        kdv: ocr ? num(ocr.kdvTutari) : (dosyaTutar ? num(dosyaTutar.kdv) : null),
        toplam: acc ? num(acc.totalAmount) : (dosyaTutar ? num(dosyaTutar.toplam) : null),
        tutarKaynak: acc ? 'belge' : (dosyaTutar && dosyaTutar.toplam != null ? 'dosya' : null),
        zatenVar: !!acc,
        aktarildi: importedByDownload,
      };
    });
  }

  // "Tümünü Görüntüle": verilen belgeleri (ya da filtreye uyan E_TEBLIGAT'ları) görüntülendi
  // işaretle -> butonlar kalıcı yeşile döner. ids verilirse onlar; verilmezse belgeTuru/taxpayerId
  // kapsamındaki, PDF'i olan (storageKey) ve henüz görüntülenmemiş tüm belgeler.
  async markDocumentsViewed(
    tenantId: string,
    input: { ids?: string[]; belgeTuru?: string; taxpayerId?: string } = {},
  ) {
    const now = new Date();
    const where: any = { tenantId, viewedAt: null, storageKey: { not: null } };
    if (Array.isArray(input.ids) && input.ids.length) {
      where.id = { in: input.ids.slice(0, 2000) };
    } else {
      if (input.belgeTuru) where.belgeTuru = input.belgeTuru;
      if (input.taxpayerId) where.taxpayerId = input.taxpayerId;
    }
    const res = await (this.prisma as any).portalDocument.updateMany({ where, data: { viewedAt: now } });
    return { updated: res?.count ?? 0, viewedAt: now };
  }

  async manualRun(tenantId: string, userId: string | null, input: ManualRunInput) {
    const jobTypes = this.resolveRequestedJobTypes(input);
    const period = this.resolvePeriod(input);
    const res = await this.createJobs(tenantId, {
      jobTypes,
      source: 'manual',
      userId,
      taxpayerIds: input.taxpayerIds || [],
      period,
      donem: input.donem,
      targetPeriod: input.targetPeriod,
      force: input.force === true,
      validationOnly: input.validationOnly === true,
      discover: input.discover === true,
      earsivMode: input.earsivMode,
      selectedRefs: input.selectedRefs,
    });
    return {
      ...res,
      message: `${res.created.length} is kuyruga alindi, ${res.skipped.length} atlandi`,
    };
  }

  async createNightlyJobsForTenant(tenantId: string) {
    const { start, end } = lastThreeDaysRange();
    const todayStart = startOfIstanbulDay(new Date());
    return this.createJobs(tenantId, {
      // 2026-09-26: SGK_ISE_GIRIS_CIKIS / SGK_ISGOREMEZLIK içi boş iskeletti — her gece mükellef başına güvenlik
      // kodlu SGK girişi yapıp 0 belgeyle bitiyordu (26.09 gecesi 84 iş). e-Rapor + hastane iş kazası artık
      // sgk-vizite modülünde (WS_Vizite web servisi, 02:30); işe giriş/çıkış ikinci aşamada bağlanacak.
      jobTypes: ['EBEYANNAME_DAILY_DOWNLOAD', 'E_TEBLIGAT_CHECK', ...SGK_JOB_TYPES.filter((t) => t !== 'SGK_ISE_GIRIS_CIKIS' && t !== 'SGK_ISGOREMEZLIK')],
      source: 'nightly',
      userId: 'scheduler',
      taxpayerIds: [],
      period: { start, end },
      force: false,
      dedupeAfter: todayStart,
    });
  }

  async pendingJobsForAgent(tenantId: string, opts: { deviceId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit || 10), 1), 50);
    const where: any = { tenantId, status: 'pending' };
    if (opts.deviceId) {
      where.OR = [{ targetDeviceId: null }, { targetDeviceId: opts.deviceId }];
    }
    const jobs = await (this.prisma as any).portalAutomationJob.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, taxOffice: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });
    return jobs.map((job: any) => ({
      ...job,
      jobLabel: JOB_META[job.jobType as PortalJobType]?.label || job.jobType,
      provider: JOB_META[job.jobType as PortalJobType]?.provider || null,
    }));
  }

  async recentJobsForAgent(
    tenantId: string,
    opts: { limit?: number; jobType?: string; taxpayerId?: string } = {},
  ) {
    const limit = Math.min(Math.max(Number(opts.limit || 20), 1), 100);
    const where: any = { tenantId };
    if (opts.jobType) where.jobType = { in: String(opts.jobType).split(',').map((s) => s.trim()).filter(Boolean) };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    const jobs = await (this.prisma as any).portalAutomationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        taxpayerId: true,
        jobType: true,
        status: true,
        source: true,
        donem: true,
        periodStart: true,
        periodEnd: true,
        recordCount: true,
        attempts: true,
        targetDeviceId: true,
        result: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        finishedAt: true,
        taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      },
    });
    return jobs.map((job: any) => ({
      ...job,
      jobLabel: JOB_META[job.jobType as PortalJobType]?.label || job.jobType,
      provider: JOB_META[job.jobType as PortalJobType]?.provider || null,
    }));
  }

  async getJobStatusForAgent(tenantId: string, jobId: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        tenantId: true,
        taxpayerId: true,
        jobType: true,
        status: true,
        source: true,
        periodStart: true,
        periodEnd: true,
        donem: true,
        payload: true,
        result: true,
        errorMessage: true,
        recordCount: true,
        attempts: true,
        targetDeviceId: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        finishedAt: true,
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            taxNumber: true,
            taxOffice: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    const documents = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, jobId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        taxpayerId: true,
        belgeTuru: true,
        sourceProvider: true,
        title: true,
        referenceNo: true,
        period: true,
        issuedAt: true,
        receivedAt: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        documentId: true,
        createdAt: true,
      },
    });
    const meta = JOB_META[job.jobType as PortalJobType];
    return {
      ...job,
      jobLabel: meta?.label || job.jobType,
      provider: meta?.provider || null,
      documentCount: documents.length,
      documents,
    };
  }

  async syncEarsivPortalDocumentsToAccounting(
    tenantId: string,
    opts: { taxpayerId?: string; period?: string; limit?: number; selectedRefs?: string[] } = {},
  ) {
    const limit = Math.min(Math.max(Number(opts.limit || 500), 1), 1000);
    const where: any = { tenantId, belgeTuru: 'EARSIV_FATURA', storageKey: { not: null } };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    const range = monthRange(opts.period);
    if (opts.period && !range) where.period = opts.period;
    if (range) {
      where.OR = [
        { period: opts.period },
        { issuedAt: { gte: range.start, lt: range.end } },
        // listDocuments'taki eski-bozuk dönem kaydı düzeltmesiyle aynı (Ercan Haziran bulgusu).
        { raw: { path: ['row', 'belgeTarihi'], string_contains: `/${String(opts.period).slice(5, 7)}/${String(opts.period).slice(0, 4)}` } },
      ];
    }
    const docs = await (this.prisma as any).portalDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        taxpayerId: true,
        jobId: true,
        title: true,
        referenceNo: true,
        period: true,
        issuedAt: true,
        receivedAt: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        raw: true,
      },
    });
    let processed = 0;
    let imported = 0;
    let skipped = 0;
    const okunacakBelgeler: string[] = []; // AKTAR → OKU: bu aktarımda oluşan/yenilenen belgeler (okunmamışlar kuyruğa)
    const selectedRefs = new Set((Array.isArray(opts.selectedRefs) ? opts.selectedRefs : [])
      .map((v) => String(v || '').trim())
      .filter(Boolean));
    for (const doc of docs) {
      if (!doc.taxpayerId || !doc.storageKey) {
        skipped++;
        continue;
      }
      const raw: any = doc.raw && typeof doc.raw === 'object' ? doc.raw : {};
      const portalRow: any = raw.row && typeof raw.row === 'object' ? raw.row : {};
      const ettn = String(raw.ettn || portalRow.ettn || portalRow.uuid || '').trim();
      const belgeNo = String(raw.belgeNumarasi || doc.referenceNo || portalRow.belgeNumarasi || portalRow.faturaNo || '').trim();
      if (selectedRefs.size && !selectedRefs.has(String(doc.referenceNo || '')) && !selectedRefs.has(ettn) && !selectedRefs.has(belgeNo)) {
        skipped++;
        continue;
      }
      // MÜKERRER İÇE AKTARIM ENGELİ (Gülşen Haziran bulgusu): aynı fatura Fatura Merkezi'ne
      //   entegratör yolundan (örn. TÜRMOB) zaten gelmişse GİB kopyasını ikinci kez açma.
      //   (gib-earsiv-api kaynaklı mevcut kayıt importEarsivPortalDocumentToAccounting içinde
      //   zaten güncelleme olarak ele alınıyor; burada yalnız FARKLI kaynaktan olanı atlıyoruz.)
      if (ettn || belgeNo) {
        const dupOther = await (this.prisma as any).invoiceAccountingDocument.findFirst({
          where: {
            tenantId,
            taxpayerId: doc.taxpayerId,
            source: { not: 'gib-earsiv-api' },
            OR: [
              ...(ettn ? [{ sourceRefId: { equals: ettn, mode: 'insensitive' } }] : []),
              ...(belgeNo ? [{ belgeNo: { equals: belgeNo, mode: 'insensitive' } }] : []),
            ],
          },
          select: { id: true },
        }).catch(() => null);
        if (dupOther) {
          skipped++;
          continue;
        }
      }
      processed++;
      const accountingRaw = { ...raw, mode: 'download', prefetched: raw.prefetched === true };
      await (this.prisma as any).portalDocument.update({
        where: { id: doc.id },
        data: { raw: accountingRaw },
      }).catch(() => null);
      const before = await (this.prisma as any).invoiceAccountingDocument.count({
        where: { tenantId, taxpayerId: doc.taxpayerId, source: 'gib-earsiv-api' },
      }).catch(() => 0);
      const olusan = await this.importEarsivPortalDocumentToAccounting(
        tenantId,
        doc.jobId || '',
        {
          taxpayerId: doc.taxpayerId,
          belgeTuru: 'EARSIV_FATURA',
          title: doc.title || 'GIB e-Arsiv Fatura',
          referenceNo: doc.referenceNo,
          period: doc.period,
          issuedAt: doc.issuedAt ? doc.issuedAt.toISOString() : null,
          receivedAt: doc.receivedAt ? doc.receivedAt.toISOString() : null,
          mimeType: doc.mimeType,
          originalName: doc.title || doc.referenceNo || 'earsiv-fatura.json',
          base64: await this.storage.getBuffer(doc.storageKey).then((b) => b.toString('base64')).catch(() => undefined),
          raw: accountingRaw,
        },
        'EARSIV_PORTAL_FETCH',
        doc.storageKey,
        doc.sizeBytes,
        doc.mimeType || 'application/json',
      );
      const after = await (this.prisma as any).invoiceAccountingDocument.count({
        where: { tenantId, taxpayerId: doc.taxpayerId, source: 'gib-earsiv-api' },
      }).catch(() => before);
      if (after > before) imported++;
      if (olusan?.id) okunacakBelgeler.push(String(olusan.id));
    }
    // AKTAR → OKU (2026-09-15): e-Fatura aktarımıyla aynı — okunmamış belgeler kalıcı kuyrukta AI ile okunur, sonra sınıflanır.
    if (okunacakBelgeler.length && this.aktarSonrasiOkumaKancasi) {
      void this.aktarSonrasiOkumaKancasi(tenantId, okunacakBelgeler, 'gib e-arşiv aktar')
        .catch((e: any) => this.logger.warn(`[AKTAR-OKU] gib e-arşiv: kuyruğa alınamadı: ${e?.message || e}`));
    } else if (okunacakBelgeler.length) {
      this.logger.warn(`[AKTAR-OKU] gib e-arşiv: kanca kayıtlı değil — ${okunacakBelgeler.length} belge okunmadan bekliyor`);
    }
    return { processed, imported, skipped, totalPortalDocuments: docs.length, okumaKuyruguna: okunacakBelgeler.length };
  }

  async cancelJob(tenantId: string, jobId: string, reason = 'Kullanici iptal etti') {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, payload: true },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    // 2026-09-25 (portal denetimi bulgu 28, kardes desen) — IPTAL KOSULLU.
    //   Eskiden kapi okuma ile, yazma kosulsuzdu: kullanici "Iptal"e bastigi anda kosucu
    //   completeJob cagirirsa is 'cancelled' yazilip TAMAMLANMIS is kayboluyordu
    //   (sonuclar yazilmis ama durum iptal gorunuyor). Artik yalniz hala bitmemis isler
    //   iptal edilir; bittiyse guncel kayit aynen doner.
    const iptal = await (this.prisma as any).portalAutomationJob.updateMany({
      where: { id: jobId, tenantId, status: { notIn: ['done', 'failed', 'cancelled'] } },
      data: {
        status: 'cancelled',
        errorMessage: reason.slice(0, 2000),
        finishedAt: new Date(),
        payload: this.withJobProgress(job.payload, {
          step: 'cancelled',
          message: 'Is iptal edildi.',
          detail: reason.slice(0, 500),
        }),
      },
    });
    if (!iptal || iptal.count === 0) {
      this.logger.warn(`[IS-IPTAL] ${jobId} iptal edilemedi — is bu arada tamamlanmis olabilir.`);
    }
    return (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
  }

  async getCredentialForJob(tenantId: string, jobId: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, taxOffice: true } } },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) throw new BadRequestException('Job tipi bilinmiyor');
    const ownerId = meta.ownerType === 'TENANT' ? tenantId : job.taxpayerId;
    if (!ownerId) throw new BadRequestException('Job icin mukellef gerekli');

    const credential = await (this.prisma as any).portalCredential.findUnique({
      where: {
        tenantId_provider_ownerType_ownerId: {
          tenantId,
          provider: meta.provider,
          ownerType: meta.ownerType,
          ownerId,
        },
      },
    });
    if (!credential || credential.isActive === false) throw new NotFoundException('Aktif portal sifresi bulunamadi');
    await (this.prisma as any).portalCredential.update({
      where: { id: credential.id },
      data: { lastCheckedAt: new Date() },
    }).catch(() => {});

    return {
      job: {
        id: job.id,
        taxpayerId: job.taxpayerId,
        jobType: job.jobType,
        source: job.source,
        periodStart: job.periodStart,
        periodEnd: job.periodEnd,
        donem: job.donem,
        payload: job.payload,
      },
      taxpayer: job.taxpayer,
      credential: {
        provider: credential.provider,
        username: credential.username,
        userCode: credential.userCode,
        officeCode: credential.officeCode,
        workplaceCode: credential.workplaceCode,
        password: tryDecrypt(credential.encryptedPassword),
        secondaryPassword: tryDecrypt(credential.encryptedSecondaryPassword),
      },
    };
  }

  async markRunning(tenantId: string, jobId: string, deviceId?: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId, status: 'pending' },
      select: { id: true, payload: true },
    });
    if (!job) throw new NotFoundException('Baslatilacak job bulunamadi');
    const mode = String(job.payload?.runnerMode || '');
    const message = mode.startsWith('local')
      ? 'Yerel ajan isi aldi, giris hazirligi yapiliyor.'
      : 'Runner isi aldi, giris hazirligi yapiliyor.';
    // 2026-09-25 (portal denetimi bulgu 28) — IS KAPMA KOSULLU.
    //   Eskiden update'in where'inde durum kosulu YOKTU: iki ajan ayni 'pending' isi
    //   okuyup ikisi de 'running' yazabiliyordu (targetDeviceId null isler her cihaza
    //   gosteriliyor). Ayni is iki kez calisinca cift cekim / cift fis riski dogar.
    //   Koşullu updateMany ile ilk kapan kazanir; ikinci ajan 404 alip baska ise gecer.
    const kapma = await (this.prisma as any).portalAutomationJob.updateMany({
      where: { id: jobId, tenantId, status: 'pending' },
      data: {
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
        attempts: { increment: 1 },
        ...(deviceId ? { targetDeviceId: deviceId } : {}),
        payload: this.withJobProgress(job.payload, {
          step: 'runner',
          message,
        }),
      },
    });
    if (!kapma || kapma.count === 0) {
      this.logger.warn(`[IS-KAPMA] ${jobId} baska bir ajan tarafindan alinmis (cihaz: ${deviceId || 'bilinmiyor'}).`);
      throw new NotFoundException('Bu isi baska bir ajan aldi');
    }
    return (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
  }

  async updateJobProgress(tenantId: string, jobId: string, progress: JobProgressUpdate) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, payload: true },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') throw new BadRequestException('Job iptal edildi');
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: { payload: this.withJobProgress(job.payload, progress) },
    });
  }

  async markFailed(tenantId: string, jobId: string, errorMessage: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') return job;
    await this.markCredentialError(job, errorMessage).catch(() => {});
    await this.maybeAlert2captchaAccountIssue(tenantId, errorMessage).catch(() => {});
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: errorMessage.slice(0, 2000),
        finishedAt: new Date(),
        payload: this.withJobProgress(job.payload, {
          step: 'failed',
          message: 'Is hata ile durdu.',
          detail: errorMessage.slice(0, 500),
        }),
      },
    });
  }

  // 2captcha HESAP hatasi (bakiye bitti / anahtar gecersiz) tenant basina son uyari zamani —
  // ayni hatada her basarisiz iste degil, 6 saatte 1 kez owner'a bildirim (spam yok).
  private static readonly last2captchaAlertAt = new Map<string, number>();

  /**
   * Job hata mesaji 2captcha HESAP-seviyesi hata iceriyorsa (bakiye 0, anahtar gecersiz/yasakli)
   * owner'a KRITIK bildirim yazar. Bu servis bitince SGK/beyanname/HGS/e-Tebligat gibi guvenlik-kodlu
   * TUM otomasyonlar sessizce basarisiz oluyordu; artik ilk hatada net uyari gider.
   * Dedup: tenant+kod basina 6 saat.
   */
  private async maybeAlert2captchaAccountIssue(tenantId: string, errorMessage: string) {
    const m = /ERROR_ZERO_BALANCE|ERROR_WRONG_USER_KEY|ERROR_KEY_DOES_NOT_EXIST|IP_BANNED|ERROR_NO_SLOT_AVAILABLE/i.exec(
      String(errorMessage || ''),
    );
    if (!m) return;
    const code = m[0].toUpperCase();
    const key = `${tenantId}:${code}`;
    const now = Date.now();
    const last = PortalAutomationService.last2captchaAlertAt.get(key) || 0;
    if (now - last < 6 * 60 * 60 * 1000) return; // 6 saat dedup
    PortalAutomationService.last2captchaAlertAt.set(key, now);

    const isBalance = /ZERO_BALANCE|NO_SLOT/i.test(code);
    const title = isBalance
      ? '🔴 2captcha bakiyesi bitti — otomasyonlar durdu'
      : '🔴 2captcha güvenlik kodu servisi hatası — otomasyonlar durdu';
    const body = isBalance
      ? 'Güvenlik kodu (captcha) çözücü servisin bakiyesi bitti. SGK, beyanname, HGS gibi güvenlik kodu isteyen TÜM otomasyonlar başarısız oluyor. 2captcha.com hesabına bakiye yükleyin — yükleyince otomasyonlar kendiliğinden çalışır.'
      : `2captcha servisi "${code}" hatası veriyor (anahtar geçersiz/yasaklı olabilir). Güvenlik kodu isteyen tüm otomasyonlar duruyor. TWOCAPTCHA_API_KEY ayarını kontrol edin.`;
    await (this.prisma as any).notification
      .create({ data: { tenantId, title, body, type: 'CAPTCHA_SOLVER_ERROR', metadata: { code } } })
      .catch(() => {});
    this.logger.warn(`[2captcha] hesap hatasi (${code}) → owner uyarildi (tenant ${tenantId})`);
  }

  async completeJob(
    tenantId: string,
    jobId: string,
    input: { declarations?: AgentDeclarationInput[]; documents?: AgentDocumentInput[]; result?: any; recordCount?: number },
  ) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') return job;
    // Watchdog uzun süren işi 'failed' işaretlemiş olabilir; indirme aslında başarılıysa sonuçları
    // yine de kaydet, ama iz bırak (denetim bulgusu).
    if (job.status === 'failed') {
      this.logger.warn(`completeJob: job ${jobId} durumu 'failed' (watchdog olabilir); sonuclar yine de kaydediliyor.`);
    }

    let recordCount = 0;
    const declarations = Array.isArray(input?.declarations) ? input.declarations : [];
    const documents = Array.isArray(input?.documents) ? input.documents : [];
    const saveErrors: string[] = [];

    // E_TEBLIGAT: PDF'i BU sorguda ILK KEZ inen tebligatlari belirlemek icin, saklamadan
    // ONCE mevcut (storageKey'li) belge no'lari snapshot al. Boylece her re-query'de owner'a
    // tekrar bildirim/PDF gitmez.
    const etbDocs = documents.filter((d) => d.belgeTuru === 'E_TEBLIGAT' && d.referenceNo);
    let etbAlreadyBacked = new Set<string>();
    if (etbDocs.length) {
      const refs = etbDocs.map((d) => String(d.referenceNo));
      const prevBacked = await (this.prisma as any).portalDocument.findMany({
        where: { tenantId, belgeTuru: 'E_TEBLIGAT', referenceNo: { in: refs }, storageKey: { not: null } },
        select: { referenceNo: true },
      });
      etbAlreadyBacked = new Set(prevBacked.map((p: any) => String(p.referenceNo)));
    }

    // TOPLU KAYIP KORUMASI (denetim bulgusu): k'ıncı belgede hata fırlarsa k+1..n belgeler HİÇ
    // saklanmıyor ve job failed oluyordu (indirme başarılıyken). Belge-başına try/catch: hatalı
    // belge loglanır + result.saveErrors'a işlenir, kalanlar kaydedilmeye devam eder.
    for (const decl of declarations) {
      try {
        await this.storeDeclarationFromAgent(tenantId, jobId, decl);
        recordCount++;
      } catch (err: any) {
        const msg = `Beyanname kaydedilemedi (${(decl as any)?.donem || (decl as any)?.beyannameTuru || '?'}): ${err?.message || err}`;
        saveErrors.push(msg.slice(0, 300));
        this.logger.warn(`completeJob ${jobId}: ${msg}`);
      }
    }
    for (const doc of documents) {
      try {
        await this.storePortalDocumentFromAgent(tenantId, jobId, doc, job.jobType);
        recordCount++;
      } catch (err: any) {
        const msg = `Belge kaydedilemedi (${doc?.referenceNo || doc?.title || doc?.originalName || '?'}): ${err?.message || err}`;
        saveErrors.push(msg.slice(0, 300));
        this.logger.warn(`completeJob ${jobId}: ${msg}`);
      }
    }

    // DİJİTAL VERGİ DAİRESİ SORGULARI (2026-09-22): result.genelSorgular → GenelSorguSonucu, result.eDefterBeratlar →
    //   EDefterBerat (upsert), result.eDefterSorgular → EDefterSorguKaydi; e-Haciz / yoklama'da YENİ bulgu bildirimi.
    //   Belgeler saklandıktan SONRA ki yoklama PDF'lerinin portalDocument id'si veriye yazılabilsin.
    if (job.taxpayerId && input?.result && typeof input.result === 'object') {
      const dvdKayit = await this.dvdSonuclariniKaydet(tenantId, job, input.result, saveErrors).catch((err: any) => {
        saveErrors.push(`DVD sonuçları kaydedilemedi: ${String(err?.message || err)}`.slice(0, 300));
        return 0;
      });
      recordCount += dvdKayit;
    }

    // 2026-09-25 (portal denetimi bulgu 30) — SAYI ARTIK GERÇEKTEN SAKLANANDAN.
    //   Eskiden `input.recordCount` (İSTEMCİNİN bildirdiği sayı) esastı. Depo erişilemezken
    //   40 e-Tebligat indirilip hiçbiri saklanamıyor, ekran yine "40 kayit portala yazildi"
    //   diyordu. Tebligat bildirimi de üretilmiyordu (storageKey şartı) → kullanıcı ne belgeyi
    //   görüyor ne uyarıyı alıyordu; gece işi olduğu için kimse fark etmiyordu.
    //   Bu, Fatura Merkezi'nde aeb14fb ile kapatılan 14(a) bulgusunun birebir aynısı.
    const bildirilen = Number.isFinite(Number(input?.recordCount)) ? Number(input.recordCount) : null;
    const finalCount = recordCount;
    if (bildirilen != null && bildirilen !== recordCount) {
      const fark = `ajan ${bildirilen} kayit bildirdi, portala ${recordCount} yazildi`;
      saveErrors.push(`Sayi uyusmuyor: ${fark}.`.slice(0, 300));
      this.logger.warn(`[TEYIT-EDILEMEDI] completeJob ${jobId}: ${fark}.`);
    }
    await this.markCredentialSuccess(job).catch(() => {});
    let doneMessage = input?.result?.validationOnly
      ? 'Portal girisi dogrulandi.'
      : finalCount > 0
      ? `${finalCount} kayit portala yazildi.`
      : bildirilen
      ? `Ajan ${bildirilen} kayit bildirdi ama PORTALA HICBIRI YAZILAMADI — teyit edilemedi.`
      : 'GIB sorgusu tamamlandi, indirilecek kayit bulunamadi.';
    let resultData: any = input?.result || { declarations: declarations.length, documents: documents.length };
    if (saveErrors.length) {
      resultData = resultData && typeof resultData === 'object' && !Array.isArray(resultData) ? { ...resultData } : { value: resultData };
      resultData.saveErrors = saveErrors.slice(0, 50);
      if (Array.isArray(resultData.notes)) {
        resultData.notes = [...resultData.notes, `⚠ ${saveErrors.length} kayit saklanirken hata oldu (detay: saveErrors)`];
      }
      doneMessage = `${doneMessage} (${saveErrors.length} kayit saklanamadi)`;
    }
    // Ajan kayit bildirdi ama portala HICBIRI yazilamadiysa bu basarili bir is degildir.
    // Kismi basari (bazisi yazildi) 'done' kalir; ekranda saveErrors ile gorunur.
    const tamamenBasarisiz = !!bildirilen && bildirilen > 0 && finalCount === 0;
    if (tamamenBasarisiz) {
      this.logger.error(`[TEYIT-EDILEMEDI] completeJob ${jobId}: ${bildirilen} kayit bildirildi, HICBIRI saklanamadi — is 'failed'.`);
    }
    const updated = await (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: tamamenBasarisiz ? 'failed' : 'done',
        errorMessage: tamamenBasarisiz
          ? `Ajan ${bildirilen} kayit bildirdi ama hicbiri saklanamadi. ${saveErrors.slice(0, 3).join(' | ')}`.slice(0, 2000)
          : undefined,
        result: resultData,
        recordCount: finalCount,
        finishedAt: new Date(),
        payload: this.withJobProgress(job.payload, {
          step: tamamenBasarisiz ? 'failed' : 'done',
          message: doneMessage,
          records: finalCount,
        }),
      },
    });

    // Sadece PDF'i BU sorguda ilk kez inen tebligatlar icin bildirim uret (re-query'de
    // tekrarlanmasin). metadata.newDocIds -> owner-notifier firma ismiyle + PDF dosyasini
    // WhatsApp'tan gonderir.
    const newEtbRefs = etbDocs
      .filter((d) => d.base64 && !etbAlreadyBacked.has(String(d.referenceNo)))
      .map((d) => String(d.referenceNo));
    if (newEtbRefs.length) {
      const newRows = await (this.prisma as any).portalDocument.findMany({
        where: { tenantId, belgeTuru: 'E_TEBLIGAT', referenceNo: { in: newEtbRefs }, storageKey: { not: null } },
        select: { id: true },
      });
      const newDocIds = newRows.map((r: any) => r.id);
      if (newDocIds.length) {
        await (this.prisma as any).notification.create({
          data: {
            tenantId,
            title: 'Yeni e-Tebligat',
            body: `${newDocIds.length} yeni e-Tebligat geldi.`,
            type: 'E_TEBLIGAT',
            metadata: { jobId, newDocIds },
          },
        }).catch(() => {});
      }
    }

    return updated;
  }

  /**
   * Runner'ın DVD sorgu sonuçlarını kalıcı tablolara yazar (2026-09-22):
   *   result.genelSorgular  → GenelSorguSonucu (tur/donem/ozet/veri, kaynak = iş kaynağı, jobId)
   *   result.eDefterBeratlar → EDefterBerat upsert (taxpayerId + paketId benzersiz)
   *   result.eDefterSorgular → EDefterSorguKaydi (dönem başına paket sayısı / hata)
   * Her kayıt ayrı try/catch: hata saveErrors'a düşer, kalanlar yazılmaya devam eder. Dönüş: yazılan kayıt sayısı.
   * YOKLAMA_DENETIM verisinde yoklamalar[].pdfDocumentId saklanan E_YOKLAMA portal belgesinin id'siyle doldurulur.
   * YENİ BULGU BİLDİRİMİ: e-Haciz'de önceki en son satırda olmayan bildiriNo, yoklamada olmayan yoklamaKodu varsa
   * (ilk sorguda da) GENEL_SORGU bildirimi yazılır → owner-notifier WhatsApp'a taşır (sessiz saatte sabah özetine düşer).
   * Vergi borcu / POS / gelen e-Arşiv için bildirim YOK.
   */
  private async dvdSonuclariniKaydet(tenantId: string, job: any, result: any, saveErrors: string[]): Promise<number> {
    const taxpayerId = String(job.taxpayerId);
    const jobId = String(job.id);
    const kaynak = job.source === 'nightly' ? 'nightly' : 'manual';
    const genelSorgular: any[] = Array.isArray(result?.genelSorgular) ? result.genelSorgular : [];
    const eDefterBeratlar: any[] = Array.isArray(result?.eDefterBeratlar) ? result.eDefterBeratlar : [];
    const eDefterSorgular: any[] = Array.isArray(result?.eDefterSorgular) ? result.eDefterSorgular : [];
    if (!genelSorgular.length && !eDefterBeratlar.length && !eDefterSorgular.length) return 0;

    let yazilan = 0;
    let mukellefAdi: string | null = null;
    const adiGetir = async () => {
      if (mukellefAdi === null) {
        const tp = await (this.prisma as any).taxpayer
          .findFirst({ where: { id: taxpayerId, tenantId }, select: { companyName: true, firstName: true, lastName: true, taxNumber: true } })
          .catch(() => null);
        mukellefAdi = adFormat(tp) || 'Mükellef';
      }
      return mukellefAdi;
    };

    for (const satir of genelSorgular) {
      const tur = String(satir?.tur || '');
      try {
        if (!(GENEL_SORGU_TURLERI as readonly string[]).includes(tur)) {
          saveErrors.push(`Genel sorgu türü bilinmiyor: ${tur || '?'}`.slice(0, 300));
          continue;
        }
        let veri: any = satir?.veri && typeof satir.veri === 'object' ? satir.veri : {};
        const donem = typeof satir?.donem === 'string' && /^\d{4}-\d{2}$/.test(satir.donem) ? satir.donem : null;
        if (tur === 'YOKLAMA_DENETIM') veri = await this.yoklamaPdfIdleriniDoldur(tenantId, taxpayerId, veri);
        // Yeni bulgu tespiti KAYITTAN ÖNCE (önceki en son satırla karşılaştırılır).
        const yeniler = tur === 'E_HACIZ' || tur === 'YOKLAMA_DENETIM' ? await this.dvdYeniBulgular(tenantId, taxpayerId, tur, veri) : [];
        await (this.prisma as any).genelSorguSonucu.create({
          data: {
            tenantId,
            taxpayerId,
            tur,
            donem,
            ozet: satir?.ozet ? String(satir.ozet).slice(0, 500) : null,
            veri,
            kaynak,
            jobId,
          },
        });
        yazilan++;
        if (yeniler.length) {
          await this.dvdYeniBulguBildir(tenantId, taxpayerId, await adiGetir(), tur, veri, yeniler, jobId).catch((err: any) =>
            this.logger.warn(`GENEL_SORGU bildirimi yazılamadı (${tur}, ${taxpayerId}): ${err?.message || err}`));
        }
      } catch (err: any) {
        const msg = `Genel sorgu sonucu kaydedilemedi (${tur || '?'}${satir?.donem ? ` ${satir.donem}` : ''}): ${err?.message || err}`;
        saveErrors.push(msg.slice(0, 300));
        this.logger.warn(`completeJob ${jobId}: ${msg}`);
      }
    }

    for (const b of eDefterBeratlar) {
      const paketId = String(b?.paketId || '').trim();
      try {
        if (!paketId) {
          saveErrors.push('e-Defter paketi paketId olmadan geldi, atlandı');
          continue;
        }
        const alan = {
          donem: String(b?.donem || '').slice(0, 7),
          belgeTuru: String(b?.belgeTuru || ''),
          islemOid: b?.islemOid ? String(b.islemOid) : null,
          oid: b?.oid ? String(b.oid) : null,
          alinmaZamani: this.dvdIsoTarihiDate(b?.alinmaZamani),
          durumKodu: Number.isFinite(Number(b?.durumKodu)) && b?.durumKodu !== null && b?.durumKodu !== '' ? Number(b.durumKodu) : null,
          durumAciklama: b?.durumAciklama ? String(b.durumAciklama).slice(0, 500) : null,
          ham: b?.ham ?? null,
          sorguTarihi: new Date(),
          jobId,
        };
        await (this.prisma as any).eDefterBerat.upsert({
          where: { taxpayerId_paketId: { taxpayerId, paketId } },
          create: { tenantId, taxpayerId, paketId, ...alan },
          update: alan,
        });
        yazilan++;
      } catch (err: any) {
        const msg = `e-Defter paketi kaydedilemedi (${paketId || '?'}): ${err?.message || err}`;
        saveErrors.push(msg.slice(0, 300));
        this.logger.warn(`completeJob ${jobId}: ${msg}`);
      }
    }

    for (const s of eDefterSorgular) {
      const donem = String(s?.donem || '').slice(0, 7);
      try {
        if (!/^\d{4}-\d{2}$/.test(donem)) {
          saveErrors.push(`e-Defter sorgu kaydı dönemsiz geldi (${s?.donem ?? '?'}), atlandı`);
          continue;
        }
        await (this.prisma as any).eDefterSorguKaydi.create({
          data: {
            tenantId,
            taxpayerId,
            donem,
            paketSayisi: Number.isFinite(Number(s?.paketSayisi)) ? Number(s.paketSayisi) : 0,
            kaynak,
            jobId,
            hata: s?.hata ? String(s.hata).slice(0, 1000) : null,
          },
        });
      } catch (err: any) {
        const msg = `e-Defter sorgu kaydı yazılamadı (${donem || '?'}): ${err?.message || err}`;
        saveErrors.push(msg.slice(0, 300));
        this.logger.warn(`completeJob ${jobId}: ${msg}`);
      }
    }

    return yazilan;
  }

  /** "2026-09-14T14:42:27" (dilimsiz) → İstanbul saati Date; "2026-09-14" → o günün başı; bozuk → null. */
  private dvdIsoTarihiDate(v: unknown): Date | null {
    if (!v) return null;
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return parseDateOrNull(`${s}+03:00`);
    return parseIstanbulDateBoundary(s, 'start');
  }

  /** YOKLAMA_DENETIM verisi: yoklamalar[].pdfDocumentId ← saklanmış E_YOKLAMA portal belgesi (referenceNo = yoklamaKodu). */
  private async yoklamaPdfIdleriniDoldur(tenantId: string, taxpayerId: string, veri: any) {
    const yoklamalar: any[] = Array.isArray(veri?.yoklamalar) ? veri.yoklamalar : [];
    const kodlar = yoklamalar.map((y) => String(y?.yoklamaKodu || '')).filter(Boolean);
    if (!kodlar.length) return veri;
    const belgeler: Array<{ id: string; referenceNo: string | null }> = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, taxpayerId, belgeTuru: 'E_YOKLAMA', referenceNo: { in: kodlar }, storageKey: { not: null } },
      select: { id: true, referenceNo: true },
      orderBy: { createdAt: 'desc' },
    });
    const harita = new Map<string, string>();
    for (const b of belgeler) if (b.referenceNo && !harita.has(b.referenceNo)) harita.set(b.referenceNo, b.id);
    return {
      ...veri,
      yoklamalar: yoklamalar.map((y) => {
        const id = harita.get(String(y?.yoklamaKodu || '')) || null;
        return { ...y, pdfVarMi: !!id, pdfDocumentId: id };
      }),
    };
  }

  /** Önceki en son satırda olmayan bildiriNo (E_HACIZ) / yoklamaKodu (YOKLAMA_DENETIM). Önceki satır yoksa hepsi yeni. */
  private async dvdYeniBulgular(tenantId: string, taxpayerId: string, tur: string, veri: any): Promise<string[]> {
    const anahtarlar = (v: any): string[] =>
      tur === 'E_HACIZ'
        ? (Array.isArray(v?.bildiriler) ? v.bildiriler : []).map((b: any) => String(b?.bildiriNo || '')).filter(Boolean)
        : (Array.isArray(v?.yoklamalar) ? v.yoklamalar : []).map((y: any) => String(y?.yoklamaKodu || '')).filter(Boolean);
    const simdiki = anahtarlar(veri);
    if (!simdiki.length) return [];
    const onceki = await (this.prisma as any).genelSorguSonucu.findFirst({
      where: { tenantId, taxpayerId, tur },
      orderBy: [{ sorguTarihi: 'desc' }, { createdAt: 'desc' }],
      select: { veri: true },
    });
    if (!onceki) return simdiki;
    const eskiler = new Set(anahtarlar(onceki.veri));
    return simdiki.filter((k) => !eskiler.has(k));
  }

  /** GENEL_SORGU bildirimi: başlıkta mükellef adı, gövdede kısa özet (adet + tutar / tür + tarih). */
  private async dvdYeniBulguBildir(tenantId: string, taxpayerId: string, mukellefAdi: string, tur: string, veri: any, yeniler: string[], jobId: string) {
    let title: string;
    let body: string;
    if (tur === 'E_HACIZ') {
      const v = veri as EHacizVeri;
      const yeniBildiriler = (Array.isArray(v?.bildiriler) ? v.bildiriler : []).filter((b) => yeniler.includes(String(b?.bildiriNo || '')));
      const tutar = yeniBildiriler.reduce((s, b) => s + (Number(b?.tutar) || 0), 0);
      const tatbik = yeniBildiriler.filter((b) => hacizTatbikEdilmisMi(String(b?.durum || ''))).length;
      title = `e-Haciz bildirisi: ${mukellefAdi}`;
      body = `${yeniBildiriler.length} yeni haciz bildirisi, ${tlBicimle(tutar)} (${tatbik} tatbik edilmiş; toplam ${v?.bildiriSayisi ?? yeniBildiriler.length} bildiri)`;
    } else {
      const v = veri as YoklamaDenetimVeri;
      const yeniYoklamalar = (Array.isArray(v?.yoklamalar) ? v.yoklamalar : []).filter((y) => yeniler.includes(String(y?.yoklamaKodu || '')));
      title = `Yoklama tutanağı: ${mukellefAdi}`;
      if (yeniYoklamalar.length === 1) {
        const y = yeniYoklamalar[0];
        body = `${y.yoklamaTuru || 'Yoklama'} — ${isoGunBicimle(y.tarih) || 'tarih yok'}${y.vergiDairesi ? ` (${y.vergiDairesi})` : ''}`;
      } else {
        const parcalar = yeniYoklamalar.slice(0, 3).map((y) => `${y.yoklamaTuru || 'Yoklama'} ${isoGunBicimle(y.tarih)}`.trim());
        body = `${yeniYoklamalar.length} yeni yoklama: ${parcalar.join('; ')}${yeniYoklamalar.length > 3 ? '; …' : ''}`;
      }
    }
    await (this.prisma as any).notification.create({
      data: {
        tenantId,
        title,
        body,
        type: NOTIFICATION_TYPES.GENEL_SORGU,
        metadata: { taxpayerId, tur, jobId, yeniler: yeniler.slice(0, 100) },
      },
    });
  }

  async savePartialJobResults(
    tenantId: string,
    jobId: string,
    input: { declarations?: AgentDeclarationInput[]; documents?: AgentDocumentInput[] },
  ) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') return job;
    // 'failed' de kabul edilir (denetim bulgusu): stale-watchdog uzun süren işi 'failed' işaretlemiş
    //   olabilir; runner o ana kadar topladığı belgeleri yine de kaydedebilmeli. Yalnız cancelled
    //   (yukarıda) ve done/pending gibi durumlar reddedilir.
    if (!['running', 'failed'].includes(String(job.status))) {
      throw new BadRequestException(`Job ara kayit icin uygun durumda degil (running/failed bekleniyor): ${job.status}`);
    }

    let recordCount = 0;
    const declarations = Array.isArray(input?.declarations) ? input.declarations : [];
    const documents = Array.isArray(input?.documents) ? input.documents : [];

    for (const decl of declarations) {
      await this.storeDeclarationFromAgent(tenantId, jobId, decl);
      recordCount++;
    }
    for (const doc of documents) {
      await this.storePortalDocumentFromAgent(tenantId, jobId, doc, job.jobType);
      recordCount++;
    }

    if (recordCount > 0) {
      const previousResult = job.result && typeof job.result === 'object' && !Array.isArray(job.result) ? job.result : {};
      await (this.prisma as any).portalAutomationJob.update({
        where: { id: jobId },
        data: {
          recordCount: { increment: recordCount },
          result: {
            ...previousResult,
            partialSaved: Number((previousResult as any).partialSaved || 0) + recordCount,
            partialSavedAt: new Date().toISOString(),
          },
        },
      });
    }

    return recordCount;
  }

  resolveTenantFromAgentToken(token?: string): Promise<string> {
    return this.resolveTenantFromToken(token);
  }

  private async createJobs(
    tenantId: string,
    opts: {
      jobTypes: PortalJobType[];
      source: 'manual' | 'nightly';
      userId: string | null;
      taxpayerIds: string[];
      period: { start: Date; end: Date };
      donem?: string;
      targetPeriod?: string;
      force?: boolean;
      validationOnly?: boolean;
      discover?: boolean;
      dedupeAfter?: Date;
      earsivMode?: 'query' | 'download';
      selectedRefs?: string[];
    },
  ) {
    const created: any[] = [];
    const skipped: Array<{ jobType: string; taxpayerId?: string | null; reason: string }> = [];

    // Otomatik Sorgulama Ayarı: yalnız GECE işlerinde bakılır (elle sorgu MUAF). Ayarları döngü
    //   öncesi TEK sorguyla çekip haritada tutuyoruz; mükellef başına ayrı sorgu atılmaz.
    //   (2026-09-22) Aynı sorguda mükellef tipi + e-Defter tercihi de gelir: gece DVD sorgu planı
    //   (ekSorgular / DVD_SORGU + eDefterAylar) buradan kurulur.
    const otomatikSorguHaritasi = new Map<string, ReturnType<typeof otomatikSorguCoz>>();
    const geceMukellefBilgisi = new Map<string, GeceMukellefBilgisi>();
    if (opts.source === 'nightly' && opts.jobTypes.some((t) => OTOMATIK_SORGU_ANAHTARI[t])) {
      const ayarlar: GeceMukellefBilgisi[] = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId, ...(opts.taxpayerIds?.length ? { id: { in: opts.taxpayerIds } } : {}) },
        select: {
          id: true,
          type: true,
          otomatikSorgu: true,
          beyanConfig: { select: { eDefterPeriod: true, eDefterBaslangic: true, incomeTaxType: true } },
        },
      });
      for (const a of ayarlar) {
        otomatikSorguHaritasi.set(a.id, otomatikSorguCoz(a.otomatikSorgu));
        geceMukellefBilgisi.set(a.id, a);
      }
    }
    const bugun = istanbulGunISO();

    for (const jobType of opts.jobTypes) {
      const meta = JOB_META[jobType];
      if (meta.ownerType === 'TENANT') {
        const credential = await this.findCredential(tenantId, meta.provider, 'TENANT', tenantId);
        if (!credential) {
          skipped.push({ jobType, taxpayerId: null, reason: 'Mali musavir e-Beyanname sifresi kayitli degil' });
          continue;
        }
        const duplicate = opts.force ? null : await this.findDuplicateJob(tenantId, jobType, null, opts.source, opts.dedupeAfter);
        if (duplicate) {
          skipped.push({ jobType, taxpayerId: null, reason: 'Bu gece icin zaten kuyrukta' });
          continue;
        }
        created.push(await this.createJobRow(tenantId, null, jobType, opts));
        continue;
      }

      const taxpayerIds = await this.resolveTaxpayerTargets(tenantId, meta.provider, opts.taxpayerIds);
      if (!taxpayerIds.length) {
        skipped.push({ jobType, reason: `${meta.provider} sifresi olan aktif mukellef bulunamadi` });
        continue;
      }

      for (const taxpayerId of taxpayerIds) {
        const credential = await this.findCredential(tenantId, meta.provider, 'TAXPAYER', taxpayerId);
        if (!credential) {
          skipped.push({ jobType, taxpayerId, reason: 'Mukellef portal sifresi yok' });
          continue;
        }
        // GECE TEK GİRİŞ (2026-09-22): E_TEBLIGAT_CHECK döngüsünde mükellefin şalterleri okunur.
        //   e-Tebligat açık → E_TEBLIGAT_CHECK + payload.ekSorgular (+ eDefterAylar) aynı oturumda;
        //   e-Tebligat kapalı ama başka şalter açık → DVD_SORGU işi (payload.sorgular);
        //   hiçbiri açık değil → atla. Şifre kontrolünden SONRA ki "şifre yok" gerekçesi kaybolmasın.
        let gercekJobType: PortalJobType = jobType;
        let dvdSecenekleri: { sorgular?: DvdSorguTuru[]; ekSorgular?: DvdSorguTuru[]; eDefterAylar?: string[] } = {};
        if (opts.source === 'nightly' && jobType === 'E_TEBLIGAT_CHECK') {
          const plan = this.geceDvdPlani(geceMukellefBilgisi.get(taxpayerId), otomatikSorguHaritasi.get(taxpayerId), bugun);
          if (!plan.eTebligat && !plan.sorgular.length) {
            skipped.push({ jobType, taxpayerId, reason: 'Otomatik sorgu kapalı (mükellef kartı)' });
            continue;
          }
          if (!plan.eTebligat) {
            gercekJobType = 'DVD_SORGU';
            dvdSecenekleri = { sorgular: plan.sorgular, eDefterAylar: plan.eDefterAylar };
          } else if (plan.sorgular.length) {
            dvdSecenekleri = { ekSorgular: plan.sorgular, eDefterAylar: plan.eDefterAylar };
          }
        } else {
          // OTOMATİK SORGU AYARI (diğer iş tipleri): mükellef kartında bu sorgu kapalıysa gece işi AÇILMAZ
          //   (kayıt NULL = varsayılan, e-Tebligat açık).
          const ayarAnahtari = OTOMATIK_SORGU_ANAHTARI[jobType];
          if (opts.source === 'nightly' && ayarAnahtari) {
            const ayar = otomatikSorguHaritasi.get(taxpayerId) ?? otomatikSorguCoz(null);
            if (ayar[ayarAnahtari] === false) {
              skipped.push({ jobType, taxpayerId, reason: 'Otomatik sorgu kapalı (mükellef kartı)' });
              continue;
            }
          }
        }
        // 3 GECE KURALI (sözleşme §3): yalnız GECE işlerinde. Şifre kaydı 'sifre' türü hatadaysa VE bu
        //   mükellefin aynı iş tipindeki son 3 işi de şifre hatasıyla bittiyse iş AÇILMAZ — her gece aynı
        //   yanlış şifreyle portalı yormanın (ve hesabı kilitletmenin) anlamı yok. saveCredential şifre
        //   değişince lastError=null yapar → ertesi gece yeniden denenir. Elle "Şimdi sorgula" (manual) MUAF.
        if (opts.source === 'nightly' && (await this.ucGeceSifreHatasiMi(tenantId, taxpayerId, gercekJobType, credential))) {
          skipped.push({ jobType: gercekJobType, taxpayerId, reason: '3 gece üst üste şifre hatası — şifre güncellenene kadar sorgu dışı' });
          continue;
        }
        const duplicate = opts.force ? null : await this.findDuplicateJob(tenantId, gercekJobType, taxpayerId, opts.source, opts.dedupeAfter);
        if (duplicate) {
          skipped.push({ jobType: gercekJobType, taxpayerId, reason: 'Bu gece icin zaten kuyrukta' });
          continue;
        }
        created.push(await this.createJobRow(tenantId, taxpayerId, gercekJobType, { ...opts, ...dvdSecenekleri }));
      }
    }

    return { created, skipped };
  }

  /**
   * GECE DVD planı (2026-09-22): mükellefin Otomatik Sorgulama şalterlerinden o gece koşacak DVD sorguları.
   * e-Defter yalnız e-Defter mükellefinde (beyanConfig.eDefterPeriod dolu) VE takvime göre bu ay / önceki ay
   * son günü olan dönem varsa (eDefterGeceSorguAylari boş değilse) plana girer; aylar payload.eDefterAylar olur.
   */
  private geceDvdPlani(
    tp: GeceMukellefBilgisi | undefined,
    ayarHam: ReturnType<typeof otomatikSorguCoz> | undefined,
    bugun: string,
  ): { eTebligat: boolean; sorgular: DvdSorguTuru[]; eDefterAylar?: string[] } {
    const ayar = ayarHam ?? otomatikSorguCoz(tp?.otomatikSorgu ?? null);
    let sorgular = acikDvdSorgulari(ayar);
    let eDefterAylar: string[] | undefined;
    if (sorgular.includes('eDefter')) {
      const aylar = this.eDefterSorguAylari(tp, bugun);
      if (aylar.length) eDefterAylar = aylar;
      else sorgular = sorgular.filter((s) => s !== 'eDefter');
    }
    return { eTebligat: ayar.eTebligat !== false, sorgular, eDefterAylar };
  }

  /** e-Defter mükellefiyse (tercih dolu) takvime göre sorgulanacak aylar; değilse boş. */
  private eDefterSorguAylari(tp: GeceMukellefBilgisi | undefined, bugun: string): string[] {
    const tercih = tp?.beyanConfig?.eDefterPeriod;
    if (tercih !== 'AYLIK' && tercih !== 'UCAYLIK') return [];
    return eDefterGeceSorguAylari(bugun, tercih, eDefterMukellefTipi(tp?.type, tp?.beyanConfig?.incomeTaxType), tp?.beyanConfig?.eDefterBaslangic);
  }

  /**
   * ELLE Dijital Vergi Dairesi sorgusu — POST /portal-automation/dvd-sorgu (2026-09-22). Şalterden MUAF.
   *   taxpayerIds boşsa GIB_IVD şifresi olan tüm aktif mükellefler. sorgular yalnız ['eDefter'] ise e-Defter
   *   mükellefleriyle sınırlı; eDefterAylar verilmediyse mükellef başına takvimden hesaplanır, boş çıkarsa
   *   o mükellef için e-Defter düşer. Aynı mükellefte bekleyen/koşan DVD_SORGU varsa atlanır ("Zaten kuyrukta").
   *   priority 50, source 'manual'. Gelen e-Arşiv aralığı payload.dateFrom/dateTo = önceki ayın 1'i → şimdi.
   */
  async dvdSorguBaslat(
    tenantId: string,
    userId: string | null,
    input: { taxpayerIds?: string[]; sorgular: DvdSorguTuru[]; eDefterAylar?: string[] },
  ) {
    const sorgular = Array.from(new Set((Array.isArray(input?.sorgular) ? input.sorgular : []).filter(dvdSorguTuruMu)));
    if (!sorgular.length) throw new BadRequestException(`sorgular boş olamaz; geçerli değerler: ${DVD_SORGU_TURLERI.join(', ')}`);
    const eDefterAylarGiris = (Array.isArray(input?.eDefterAylar) ? input.eDefterAylar : [])
      .map((a) => String(a).trim())
      .filter((a) => /^\d{4}-(0[1-9]|1[0-2])$/.test(a));
    if (Array.isArray(input?.eDefterAylar) && input.eDefterAylar.length && !eDefterAylarGiris.length) {
      throw new BadRequestException('eDefterAylar "YYYY-MM" biçiminde olmalı');
    }

    const created: Array<{ id: string; taxpayerId: string; jobType: PortalJobType; sorgular: DvdSorguTuru[] }> = [];
    const skipped: Array<{ taxpayerId: string | null; reason: string }> = [];
    const secilenIdler = Array.isArray(input?.taxpayerIds) ? input.taxpayerIds.map((x) => String(x).trim()).filter(Boolean) : [];
    const taxpayerIds: string[] = await this.resolveTaxpayerTargets(tenantId, 'GIB_IVD', secilenIdler);
    if (!taxpayerIds.length) {
      skipped.push({ taxpayerId: null, reason: secilenIdler.length ? 'Seçilen mükellef bulunamadı ya da pasif' : 'GIB_IVD şifresi olan aktif mükellef bulunamadı' });
      return { created, skipped, message: `0 sorgu işi kuyruğa alındı, ${skipped.length} atlandı` };
    }

    const bilgiler: GeceMukellefBilgisi[] = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, id: { in: taxpayerIds } },
      select: { id: true, type: true, otomatikSorgu: true, beyanConfig: { select: { eDefterPeriod: true, eDefterBaslangic: true, incomeTaxType: true } } },
    });
    const bilgiHaritasi = new Map(bilgiler.map((b) => [b.id, b] as const));
    const bugun = istanbulGunISO();
    const yalnizEDefter = sorgular.length === 1 && sorgular[0] === 'eDefter';
    // Gelen e-Arşiv aralığı için işin tarih aralığı: önceki ayın 1'i (İstanbul) → şimdi.
    const oncekiAyBasi = parseIstanbulDateBoundary(`${dvdAyEkle(bugun.slice(0, 7), -1)}-01`, 'start') || new Date();
    const period = { start: oncekiAyBasi, end: new Date() };

    for (const taxpayerId of taxpayerIds) {
      const tp = bilgiHaritasi.get(taxpayerId);
      const credential = await this.findCredential(tenantId, 'GIB_IVD', 'TAXPAYER', taxpayerId);
      if (!credential || credential.isActive === false) {
        skipped.push({ taxpayerId, reason: 'Mükellef portal şifresi yok' });
        continue;
      }
      let mukellefSorgulari: DvdSorguTuru[] = [...sorgular];
      let eDefterAylar: string[] | undefined;
      if (mukellefSorgulari.includes('eDefter')) {
        const tercih = tp?.beyanConfig?.eDefterPeriod;
        const eDefterMukellefi = tercih === 'AYLIK' || tercih === 'UCAYLIK';
        const aylar = !eDefterMukellefi ? [] : eDefterAylarGiris.length ? eDefterAylarGiris : this.eDefterSorguAylari(tp, bugun);
        if (aylar.length) eDefterAylar = aylar;
        else mukellefSorgulari = mukellefSorgulari.filter((s) => s !== 'eDefter');
      }
      if (!mukellefSorgulari.length) {
        skipped.push({ taxpayerId, reason: yalnizEDefter ? 'e-Defter mükellefi değil ya da sorgulanacak dönem yok' : 'Sorgulanacak sorgu kalmadı' });
        continue;
      }
      const bekleyen = await (this.prisma as any).portalAutomationJob.findFirst({
        where: { tenantId, taxpayerId, jobType: 'DVD_SORGU', status: { in: ['pending', 'running'] } },
        select: { id: true },
      });
      if (bekleyen) {
        skipped.push({ taxpayerId, reason: 'Zaten kuyrukta' });
        continue;
      }
      const job = await this.createJobRow(tenantId, taxpayerId, 'DVD_SORGU', {
        source: 'manual',
        userId,
        period,
        sorgular: mukellefSorgulari,
        eDefterAylar,
      });
      created.push({ id: job.id, taxpayerId, jobType: 'DVD_SORGU', sorgular: mukellefSorgulari });
    }

    return { created, skipped, message: `${created.length} sorgu işi kuyruğa alındı, ${skipped.length} atlandı` };
  }

  private async createJobRow(
    tenantId: string,
    taxpayerId: string | null,
    jobType: PortalJobType,
    opts: {
      source: 'manual' | 'nightly';
      userId: string | null;
      period: { start: Date; end: Date };
      donem?: string;
      targetPeriod?: string;
      force?: boolean;
      validationOnly?: boolean;
      discover?: boolean;
      earsivMode?: 'query' | 'download';
      selectedRefs?: string[];
      // Dijital Vergi Dairesi sorguları (2026-09-22): DVD_SORGU → sorgular; E_TEBLIGAT_CHECK → ekSorgular (aynı oturum);
      //   eDefterAylar = e-Defter paket listesi sorgulanacak aylar ("YYYY-MM").
      sorgular?: DvdSorguTuru[];
      ekSorgular?: DvdSorguTuru[];
      eDefterAylar?: string[];
    },
  ) {
    const meta = JOB_META[jobType];
    const validationOnly = opts.validationOnly === true;
    const runnerMode = this.runnerModeForJob(jobType, opts.source);
    const pendingMessage = validationOnly
      ? 'Kuyrukta, sadece portal girisi dogrulanacak.'
      : runnerMode === 'local_first' || runnerMode === 'local_first_with_server_fallback'
      ? 'Kuyrukta, yerel Moren ajan bekleniyor.'
      : 'Kuyrukta, runner bekleniyor.';
    const sorgular = Array.isArray(opts.sorgular) ? opts.sorgular.filter(dvdSorguTuruMu) : [];
    const ekSorgular = Array.isArray(opts.ekSorgular) ? opts.ekSorgular.filter(dvdSorguTuruMu) : [];
    const eDefterAylar = Array.isArray(opts.eDefterAylar) ? opts.eDefterAylar.filter((a) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(a))) : [];
    const sorguEtiketi = (liste: DvdSorguTuru[]) => liste.map((s) => OTOMATIK_SORGU_ETIKETLERI[s] || s).join(', ');
    // İş listesinde ne koşacağı görünsün: "Dijital Vergi Dairesi sorgusu: Vergi Borcu, POS" / "GIB e-Tebligat kontrol + Vergi Borcu".
    const label = validationOnly
      ? `${meta.provider} sifre dogrulama`
      : jobType === 'DVD_SORGU' && sorgular.length
      ? `${meta.label}: ${sorguEtiketi(sorgular)}`
      : ekSorgular.length
      ? `${meta.label} + ${sorguEtiketi(ekSorgular)}`
      : meta.label;
    return (this.prisma as any).portalAutomationJob.create({
      data: {
        tenantId,
        taxpayerId,
        jobType,
        source: opts.source,
        status: 'pending',
        periodStart: opts.period.start,
        periodEnd: opts.period.end,
        donem: opts.donem || this.inferDonem(opts.period.end),
        scheduledAt: new Date(),
        createdBy: opts.userId,
        priority: opts.source === 'manual' ? 50 : 0,
        payload: {
          label,
          provider: meta.provider,
          ownerType: meta.ownerType,
          runnerMode,
          force: opts.force === true,
          validationOnly,
          discover: opts.discover === true,
          earsivMode: opts.earsivMode || undefined,
          selectedRefs: Array.isArray(opts.selectedRefs) ? opts.selectedRefs.slice(0, 500) : undefined,
          sorgular: sorgular.length ? sorgular : undefined,
          ekSorgular: ekSorgular.length ? ekSorgular : undefined,
          eDefterAylar: eDefterAylar.length ? eDefterAylar : undefined,
          targetPeriod: opts.targetPeriod || undefined,
          dateFrom: opts.period.start.toISOString(),
          dateTo: opts.period.end.toISOString(),
          instruction: validationOnly
            ? 'Kayitli portal bilgileriyle sadece giris sayfasinda login dene; belge, tebligat veya liste taramasi yapma.'
            : this.instructionForJob(jobType),
          progress: {
            at: new Date().toISOString(),
            step: 'pending',
            message: pendingMessage,
          },
          progressLog: [
            {
              at: new Date().toISOString(),
              step: 'pending',
              message: pendingMessage,
            },
          ],
        },
      },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
    });
  }

  private runnerModeForJob(jobType: PortalJobType, source: 'manual' | 'nightly') {
    if (jobType !== 'EBEYANNAME_DAILY_DOWNLOAD') return 'server';
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_RUNNER_MODE || '').trim().toLowerCase();
    if (['server', 'railway', 'cloud'].includes(raw)) return 'server';
    if (['local', 'local_only', 'local-only'].includes(raw)) return 'local_first';
    if (['local_first_with_server_fallback', 'server_fallback', 'fallback'].includes(raw)) return 'local_first_with_server_fallback';
    return 'server';
  }

  private withJobProgress(payload: any, progress: JobProgressUpdate) {
    const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
    const previous = base.progress && typeof base.progress === 'object' && !Array.isArray(base.progress) ? base.progress : {};
    const entry: Record<string, any> = {
      at: new Date().toISOString(),
      step: String(progress.step || previous.step || 'progress').slice(0, 80),
      message: String(progress.message || previous.message || 'Islem suruyor.').slice(0, 300),
    };
    if (progress.detail) entry.detail = String(progress.detail).slice(0, 500);
    if (Number.isFinite(Number(progress.current))) entry.current = Number(progress.current);
    if (Number.isFinite(Number(progress.total))) entry.total = Number(progress.total);
    if (Number.isFinite(Number(progress.records))) entry.records = Number(progress.records);

    const existingLog = Array.isArray(base.progressLog) ? base.progressLog : [];
    return {
      ...base,
      progress: entry,
      progressLog: [...existingLog.slice(-11), entry],
    };
  }

  private async findDuplicateJob(
    tenantId: string,
    jobType: PortalJobType,
    taxpayerId: string | null,
    source: string,
    dedupeAfter?: Date,
  ) {
    if (!dedupeAfter) return null;
    return (this.prisma as any).portalAutomationJob.findFirst({
      where: {
        tenantId,
        jobType,
        taxpayerId,
        source,
        createdAt: { gte: dedupeAfter },
        status: { in: ['pending', 'running', 'done'] },
      },
      select: { id: true },
    });
  }

  private async resolveTaxpayerTargets(tenantId: string, provider: PortalProvider, selectedIds: string[]) {
    if (selectedIds?.length) {
      const rows = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId, id: { in: selectedIds }, isActive: true },
        select: { id: true },
      });
      return rows.map((r: any) => r.id);
    }
    const credentials = await (this.prisma as any).portalCredential.findMany({
      where: {
        tenantId,
        provider,
        ownerType: 'TAXPAYER',
        isActive: true,
        taxpayer: { isActive: true },
        ...(provider === 'SGK_EBILDIRGE'
          ? {
              AND: [
                { OR: [{ username: { not: null } }, { userCode: { not: null } }] },
                { workplaceCode: { not: null } },
                { encryptedPassword: { not: null } },
                { encryptedSecondaryPassword: { not: null } },
              ],
            }
          : {}),
        ...(provider === 'GIB_IVD'
          ? {
              AND: [
                { userCode: { not: null } },
                { OR: [{ encryptedSecondaryPassword: { not: null } }, { encryptedPassword: { not: null } }] },
              ],
            }
          : {}),
      },
      select: { ownerId: true },
      take: 2000,
    });
    return credentials.map((c: any) => c.ownerId);
  }

  private async findCredential(tenantId: string, provider: PortalProvider, ownerType: 'TENANT' | 'TAXPAYER', ownerId: string) {
    return (this.prisma as any).portalCredential.findUnique({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
    });
  }

  /**
   * 3 GECE KURALI denetimi: şifre kaydının son hatası 'sifre' türü mü VE aynı tenant/mükellef/iş tipinde
   * son 3 iş (kaynağa bakılmaksızın; elle deneme başarılı olduysa seri kırılır) hepsi failed + 'sifre' türü mü?
   * Sorgu yalnız lastError şifre hatası olduğunda atılır (gece döngüsünde ek yük yok).
   */
  private async ucGeceSifreHatasiMi(tenantId: string, taxpayerId: string, jobType: PortalJobType, credential: any): Promise<boolean> {
    if (!credential?.lastError || hataSiniflandir(credential.lastError).tur !== 'sifre') return false;
    const sonIsler: Array<{ status: string; errorMessage: string | null }> = await (this.prisma as any).portalAutomationJob.findMany({
      where: { tenantId, taxpayerId, jobType },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { status: true, errorMessage: true },
    });
    if (sonIsler.length < 3) return false;
    return sonIsler.every((j) => j.status === 'failed' && hataSiniflandir(j.errorMessage).tur === 'sifre');
  }

  private resolveRequestedJobTypes(input: ManualRunInput): PortalJobType[] {
    if (Array.isArray(input.jobTypes) && input.jobTypes.length) {
      return Array.from(new Set(input.jobTypes.map((j) => String(j).trim().toUpperCase()).filter(isPortalJobType)));
    }
    switch (input.scope) {
      case 'beyanname': return ['EBEYANNAME_DAILY_DOWNLOAD'];
      case 'tebligat': return ['E_TEBLIGAT_CHECK'];
      case 'sgk': return SGK_JOB_TYPES;
      default: return ['EBEYANNAME_DAILY_DOWNLOAD', 'E_TEBLIGAT_CHECK', ...SGK_JOB_TYPES];
    }
  }

  private resolvePeriod(input: ManualRunInput) {
    const from = parseIstanbulDateBoundary(input.dateFrom, 'start');
    const to = parseIstanbulDateBoundary(input.dateTo, 'end');
    if (from && to) return { start: from, end: to };
    return lastThreeDaysRange();
  }

  private inferDonem(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value || String(date.getFullYear());
    const month = parts.find((p) => p.type === 'month')?.value || String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private summarizeCredentials(rows: any[]) {
    const readyCredential = (row: any) => {
      if (row?.isActive === false) return false;
      if (row.provider === 'GIB_EBEYANNAME') {
        return Boolean(row.userCode && (row.encryptedPassword || row.encryptedSecondaryPassword));
      }
      if (row.provider === 'GIB_IVD') {
        return Boolean(row.userCode && (row.encryptedSecondaryPassword || row.encryptedPassword));
      }
      if (row.provider === 'SGK_EBILDIRGE') {
        return Boolean((row.username || row.userCode) && row.workplaceCode && row.encryptedPassword && row.encryptedSecondaryPassword);
      }
      return false;
    };
    const byProvider = {
      GIB_EBEYANNAME: { total: 0, active: 0 },
      GIB_IVD: { total: 0, active: 0 },
      SGK_EBILDIRGE: { total: 0, active: 0 },
    } as Record<PortalProvider, { total: number; active: number }>;
    for (const row of rows) {
      const provider = String(row.provider);
      if (!isPortalProvider(provider)) continue;
      byProvider[provider].total++;
      if (readyCredential(row)) byProvider[provider].active++;
    }
    return {
      eBeyannameReady: byProvider.GIB_EBEYANNAME.active > 0,
      eTebligatTaxpayerCount: byProvider.GIB_IVD.active,
      sgkTaxpayerCount: byProvider.SGK_EBILDIRGE.active,
      byProvider,
    };
  }

  private isReadySgkCredential(row: any): boolean {
    return Boolean(
      row?.provider === 'SGK_EBILDIRGE' &&
      row?.isActive !== false &&
      (row?.username || row?.userCode) &&
      row?.workplaceCode &&
      row?.encryptedPassword &&
      row?.encryptedSecondaryPassword,
    );
  }

  private plainCredentialPart(value?: string | null) {
    return normalizeTextKey(String(value || '').trim());
  }

  private async ensureSgkBildirgeConfig(taxpayerId: string) {
    await (this.prisma as any).taxpayerBeyanConfig.upsert({
      where: { taxpayerId },
      create: { taxpayerId, sgkBildirgeEnabled: true },
      update: { sgkBildirgeEnabled: true },
    });
  }

  private publicCredential(c: any) {
    return {
      id: c.id,
      provider: c.provider,
      ownerType: c.ownerType,
      ownerId: c.ownerId,
      taxpayerId: c.taxpayerId,
      taxpayer: c.taxpayer
        ? { ...c.taxpayer, name: adFormat(c.taxpayer) }
        : null,
      username: c.username,
      userCode: c.userCode,
      officeCode: c.officeCode,
      workplaceCode: c.workplaceCode,
      password: tryDecrypt(c.encryptedPassword),
      secondaryPassword: tryDecrypt(c.encryptedSecondaryPassword),
      hasPassword: !!c.encryptedPassword,
      hasSecondaryPassword: !!c.encryptedSecondaryPassword,
      isActive: c.isActive,
      lastCheckedAt: c.lastCheckedAt,
      lastSuccessAt: c.lastSuccessAt,
      lastError: c.lastError,
      updatedAt: c.updatedAt,
      notes: c.notes,
    };
  }

  private async storeDeclarationFromAgent(tenantId: string, jobId: string, input: AgentDeclarationInput) {
    if (!input?.taxpayerId || !input?.beyanTipi || !input?.donem) {
      throw new BadRequestException('Beyanname icin taxpayerId, beyanTipi ve donem zorunlu');
    }
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId },
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
    });
    if (!taxpayer) throw new NotFoundException('Beyanname mukellefi bulunamadi');

    const identity = this.canonicalDeclarationIdentity(input, taxpayer);
    const beyanTipi = identity.beyanTipi;
    const donem = identity.donem;
    const declarationStatus = normalizeAgentDeclarationStatus(input);
    if (declarationStatus !== 'onaylandi') {
      // ÖNCELİK + ÖZ-ONARIM: GİB bu beyannameyi "onay bekliyor" / "hatalı" raporluyor.
      const existingKayit = await (this.prisma as any).beyanKaydi.findUnique({
        where: {
          tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId: taxpayer.id, beyanTipi, donem },
        },
        select: { id: true, tahakkukTutari: true, pdfUrl: true },
      });
      // (1) ÖNCELİK: bu beyanname GERÇEKTEN onaylı/indirilmiş (tahakkuku veya tahakkuk PDF'i var).
      //     Onaylanmış beyanname iptal edilemez (yalnız düzeltme verilir); GİB'in hâlâ gösterdiği
      //     eski hatalı denemesi onu DÜŞÜRMESİN → durumu değiştirme, onaylı kalsın.
      if (existingKayit && (existingKayit.tahakkukTutari != null || existingKayit.pdfUrl)) {
        return existingKayit;
      }
      // (2) ÖZ-ONARIM: gerçek onaylı yok; pending "onaylı sızıntısı"ndan kalan TAHAKKUKSUZ sahte
      //     BeyanKaydı ("Tutar okunamadı" satırı) varsa temizle — liste ve panel doğru yansısın.
      //     Yalnız gib_agent + tahakkukTutari yok + tahakkuk PDF yok kayıtlara dokunur.
      if (existingKayit) {
        await (this.prisma as any).beyanKaydi.deleteMany({
          where: { tenantId, taxpayerId: taxpayer.id, beyanTipi, donem, kaynak: 'gib_agent', tahakkukTutari: null, pdfUrl: null },
        }).catch(() => {});
      }
      // GÜNCELLİK KORUMASI: aynı beyannamenin iki paketi iki listede olabilir
      // (eski deneme "onay bekliyor"da takılı + güncel paket "hatalı" ya da tersi).
      // Sorgu sırası hatalı→onay-bekliyor olduğu için sonra yazılan eskiyi ezebiliyordu;
      // GİB satır tarihi (gibTarih) daha yeni olan kayıt korunur.
      const incomingGibTarih = parseDateOrNull(input.beyanTarihi || null);
      const existingDurum = await (this.prisma as any).beyanDurumu.findUnique({
        where: {
          tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId: taxpayer.id, beyanTipi, donem },
        },
        select: { id: true, durum: true, notlar: true },
      }).catch(() => null);
      const existingGibTarih = gibTarihFromDurumNote(existingDurum?.notlar);
      if (
        existingDurum
        && existingDurum.durum !== declarationStatus
        && incomingGibTarih
        && existingGibTarih
        && existingGibTarih.getTime() > incomingGibTarih.getTime()
      ) {
        return existingDurum;
      }
      return (this.prisma as any).beyanDurumu.upsert({
        where: {
          tenantId_taxpayerId_beyanTipi_donem: {
            tenantId,
            taxpayerId: taxpayer.id,
            beyanTipi,
            donem,
          },
        },
        create: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
          durum: declarationStatus,
          onayTarihi: null,
          tahakkukTutari: input.tahakkukTutari ?? null,
          notlar: agentDeclarationStatusNote(input, declarationStatus),
        },
        update: {
          durum: declarationStatus,
          onayTarihi: null,
          tahakkukTutari: input.tahakkukTutari ?? null,
          notlar: agentDeclarationStatusNote(input, declarationStatus),
        },
      });
    }

    const existingKayit = await (this.prisma as any).beyanKaydi.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      select: { id: true, beyannameUrl: true, pdfUrl: true, xmlUrl: true },
    });
    const isCorrection = this.isCorrectionDeclarationInput(input);
    const forceRefresh = input.raw?.forceRefresh === true;
    const skipBeyannameStorage = !!existingKayit?.beyannameUrl && !isCorrection && !forceRefresh;
    const skipTahakkukStorage = !!existingKayit?.pdfUrl && !isCorrection && !forceRefresh;
    const skipXmlStorage = !!existingKayit?.xmlUrl && !isCorrection && !forceRefresh;
    const beyannameCheck = await this.prepareIncomingDeclarationPdf(tenantId, jobId, input, taxpayer, 'beyanname', skipBeyannameStorage);
    const tahakkukCheck = await this.prepareIncomingDeclarationPdf(tenantId, jobId, input, taxpayer, 'tahakkuk', skipTahakkukStorage);
    const hasIncomingFile = !!(cleanBase64(beyannameCheck.base64) || cleanBase64(tahakkukCheck.base64) || cleanBase64(input.xmlBase64));
    const hasMissingIncomingFile =
      (!!cleanBase64(beyannameCheck.base64) && !skipBeyannameStorage)
      || (!!cleanBase64(tahakkukCheck.base64) && !skipTahakkukStorage)
      || (!!cleanBase64(input.xmlBase64) && !skipXmlStorage);
    if (existingKayit && !isCorrection && hasIncomingFile && !hasMissingIncomingFile && input.tahakkukTutari == null && !input.onayNo) {
      return existingKayit;
    }

    const base = `${tenantId}/${taxpayer.id}/gib-beyan/${beyanTipi}_${donem}`;
    const beyannameUrl = await this.storeBase64IfPresent(
      `${base}_Beyanname_${randomUUID()}.pdf`,
      skipBeyannameStorage ? null : beyannameCheck.base64,
      'application/pdf',
      input.beyannameFileName || 'beyanname.pdf',
    );
    const pdfUrl = await this.storeBase64IfPresent(
      `${base}_Tahakkuk_${randomUUID()}.pdf`,
      skipTahakkukStorage ? null : tahakkukCheck.base64,
      'application/pdf',
      input.tahakkukFileName || 'tahakkuk.pdf',
    );
    const xmlUrl = await this.storeBase64IfPresent(
      `${base}_${randomUUID()}.xml`,
      skipXmlStorage ? null : input.xmlBase64,
      'application/xml',
      'beyanname.xml',
    );
    const pdfMeta: { tahakkukTutari?: number | null; onayNo?: string | null } = tahakkukCheck.text
      ? {
          tahakkukTutari: this.extractTahakkukAmount(tahakkukCheck.text),
          onayNo: this.extractTahakkukOnayNo(tahakkukCheck.text),
        }
      : await this.extractTahakkukMetaFromBase64(tahakkukCheck.base64).catch((err) => {
          this.logger.warn(`Tahakkuk PDF meta okunamadi: ${err?.message || err}`);
          return {};
        });
    const tahakkukTutari = input.tahakkukTutari ?? pdfMeta.tahakkukTutari ?? null;
    const onayNo = input.onayNo || pdfMeta.onayNo || null;

    const data: any = {
      beyanTarihi: parseDateOrNull(input.beyanTarihi),
      kaynak: 'gib_agent',
      importBatchId: jobId,
      notlar: input.raw ? JSON.stringify({ source: 'portal-automation', raw: input.raw }).slice(0, 1000) : null,
    };
    if (tahakkukTutari != null) data.tahakkukTutari = tahakkukTutari;
    if (input.odemeTutari != null) data.odemeTutari = input.odemeTutari;
    if (onayNo) data.onayNo = onayNo;
    if (beyannameUrl) data.beyannameUrl = beyannameUrl;
    else if (beyannameCheck.clearCurrent) data.beyannameUrl = null;
    if (pdfUrl) data.pdfUrl = pdfUrl;
    else if (tahakkukCheck.clearCurrent) data.pdfUrl = null;
    if (xmlUrl) data.xmlUrl = xmlUrl;

    const kayit = await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi,
        donem,
        tahakkukTutari: tahakkukTutari ?? null,
        odemeTutari: input.odemeTutari ?? null,
        onayNo,
        ...data,
      },
      update: data,
    });

    const durumUpdate: any = {
      durum: 'onaylandi',
      onayTarihi: parseDateOrNull(input.beyanTarihi) || new Date(),
    };
    if (tahakkukTutari != null) durumUpdate.tahakkukTutari = tahakkukTutari;

    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
          durum: 'onaylandi',
          onayTarihi: parseDateOrNull(input.beyanTarihi) || new Date(),
          tahakkukTutari,
          notlar: 'GIB agent tarafindan indirildi',
        },
        update: durumUpdate,
      }).catch(() => {});

    return kayit;
  }

  private async prepareIncomingDeclarationPdf(
    tenantId: string,
    jobId: string,
    input: AgentDeclarationInput,
    taxpayer: { id: string; taxNumber?: string | null },
    kind: 'beyanname' | 'tahakkuk',
    skipStorage: boolean,
  ): Promise<{ base64: string | null; clearCurrent: boolean; text?: string | null }> {
    if (skipStorage) return { base64: null, clearCurrent: false, text: null };

    const base64 = cleanBase64(kind === 'beyanname' ? input.beyannameBase64 : input.tahakkukBase64);
    if (!base64) return { base64: null, clearCurrent: false, text: null };

    const expectedTaxNo = this.normalizeTaxNoValue(taxpayer.taxNumber);
    if (!expectedTaxNo) return { base64, clearCurrent: false, text: null };

    const text = await this.pdfTextFromBase64(base64).catch((err) => {
      this.logger.warn(`${kind} PDF VKN kontrolu yapilamadi: ${err?.message || err}`);
      return '';
    });
    const compactDigits = text.replace(/\D/g, '');
    if (compactDigits.includes(expectedTaxNo)) return { base64, clearCurrent: false, text };

    // Beklenen VKN metinde gorunmedi. Eski tiklama/popup yolu zaman zaman BASKA mukellefin PDF'ini
    // yakaliyor (cross-taxpayer swap). Bu yuzden PDF icinde NET ve FARKLI bir VKN bulunursa belgeyi
    // yanlis kayda baglamak yerine, dogru sahibe tasi + bu kaydin URL'sini temizle (clearCurrent).
    // (Liste-API/Oid yolu duzeldiginde PDF'ler dogru iner, beklenen VKN metinde olur ve bu blok hic
    // tetiklenmez; bu nedenle koruma zararsiz ama swap'a karsi gerekli.)
    const seenTaxNos = this.extractTaxNumbers(text);
    let ownerTaxNo = seenTaxNos.find((taxNo) => taxNo !== expectedTaxNo) || null;
    let parsed: any = null;
    if (!ownerTaxNo) {
      parsed = await this.beyanKayitlari.parseBeyannamePdf(base64).catch((err) => {
        this.logger.warn(`${kind} PDF AI VKN kontrolu yapilamadi: ${err?.message || err}`);
        return null;
      });
      const parsedTaxNo = this.normalizeTaxNoValue(parsed?.vkn);
      if (parsedTaxNo === expectedTaxNo) return { base64, clearCurrent: false, text };
      ownerTaxNo = parsedTaxNo || null;
    }

    if (!ownerTaxNo) {
      this.logger.warn(`${kind} PDF icinde VKN/TCKN okunamadi; net farkli VKN bulunmadigi icin kayda baglanacak. Beklenen: ${expectedTaxNo}.`);
      return { base64, clearCurrent: false, text };
    }

    await this.storePortalDocumentFromAgent(tenantId, jobId, {
      taxpayerId: null,
      belgeTuru: kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : 'GIB_BEYANNAME',
      title: kind === 'tahakkuk'
        ? input.tahakkukFileName || 'tahakkuk.pdf'
        : input.beyannameFileName || 'beyanname.pdf',
      period: input.donem,
      issuedAt: input.beyanTarihi || null,
      receivedAt: new Date().toISOString(),
      mimeType: 'application/pdf',
      originalName: kind === 'tahakkuk'
        ? input.tahakkukFileName || 'tahakkuk.pdf'
        : input.beyannameFileName || 'beyanname.pdf',
      base64,
      raw: {
        runner: 'portal-automation',
        source: 'declaration-owner-repair',
        ownerMismatch: true,
        expectedTaxNo,
        ownerTaxNo,
        originalTaxpayerId: taxpayer.id,
        originalRaw: input.raw || null,
      },
    }, 'EBEYANNAME_DAILY_DOWNLOAD').catch((err) => {
      this.logger.warn(`${kind} PDF dogru mukellefe tasinamadi: ${err?.message || err}`);
    });

    return { base64: null, clearCurrent: true, text };
  }

  private async storePortalDocumentFromAgent(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
  ) {
    let taxpayerId = input.taxpayerId || null;
    // Belgeye mukellef gelmemisse isin mukellefini kullan (e-Tebligat kayitlari job'a baglidir).
    if (!taxpayerId && jobId) {
      const ownerJob = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId }, select: { taxpayerId: true } });
      if (ownerJob?.taxpayerId) taxpayerId = ownerJob.taxpayerId;
    }
    if (taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
      if (!tp) throw new NotFoundException('Belge mukellefi bulunamadi');
    }
    // MÜKERRER ÖNLEME (denetim bulgusu): dedup kontrolü eskiden blob upload + Document/DocumentVersion
    //   olusturmadan SONRA yapiliyordu — tekrar sorguda ayni fatura icin her seferinde yeni blob ve
    //   yeni Document (Evrak) olusuyor, dedup "existing" dondugu icin bunlar OKSUZ birikiyordu.
    //   Kontrol EN BASA alindi: mevcut kayitta storageKey VARSA upload + Document/Version olusturma
    //   tamamen atlanir. Kayit var ama storageKey YOKSA (dosya ilk kez geldi) olusturma yapilir ve
    //   asagidaki patch ile mevcut kayda baglanir (eski davranis korunur).
    // E_YOKLAMA (2026-09-22): yoklama tutanağı PDF'i, referenceNo = yoklama kodu; tekrar sorguda kopya oluşmasın.
    const DEDUP_BELGE_TURU = ['E_TEBLIGAT', 'EARSIV_FATURA', 'SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI', 'E_YOKLAMA'];
    let existingDedup: any = null;
    if (DEDUP_BELGE_TURU.includes(String(input.belgeTuru)) && input.referenceNo) {
      existingDedup = await (this.prisma as any).portalDocument.findFirst({
        // taxpayerId ile SCOPE (KRİTİK kök — Hanife/Hüseyin bulgusu, DB'den kanıtlı): GİB e-Arşiv belge
        //   numaraları MÜKELLEF-BAZINDA sıralıdır (her mükellef GIB2026000000001'den başlar) → farklı
        //   mükelleflerin AYNI belge numarası olur. taxpayerId'siz dedup, bir mükellefin faturasını aynı
        //   numaralı BAŞKA mükellefin belgesiyle eşleştirip onun ÜSTÜNE yazıyor, gerçek mükellefe HİÇ
        //   kaydetmiyordu → ekranda "0 kayıt" (tüm mükelleflerde). taxpayerId biliniyorsa dedup'ı onunla sınırla.
        where: { tenantId, belgeTuru: String(input.belgeTuru), referenceNo: String(input.referenceNo), ...(taxpayerId ? { taxpayerId } : {}) },
        select: { id: true, taxpayerId: true, storageKey: true, sizeBytes: true, mimeType: true, raw: true, period: true, issuedAt: true },
      });
    }
    if (String(input.belgeTuru) === 'EARSIV_FATURA') {
      this.logger.log(`[EARSIV-STORE] taxpayerId=${taxpayerId} period=${input.period} ref=${input.referenceNo} mode=${(input.raw as any)?.mode} dedup=${existingDedup ? `VAR(tp=${existingDedup.taxpayerId}/period=${existingDedup.period})` : 'yok'}`);
    }
    const skipBlobCreate = !!existingDedup?.storageKey;
    const mimeType = input.mimeType || 'application/pdf';
    const sourceProvider = JOB_META[jobType as PortalJobType]?.provider || 'GIB_IVD';
    let storageKey: string | null = null;
    let sizeBytes: number | null = null;
    const base64 = cleanBase64(input.base64);
    if (base64 && !skipBlobCreate) {
      const buffer = Buffer.from(base64, 'base64');
      sizeBytes = buffer.length;
      const ext = this.extensionFromMime(mimeType, input.originalName);
      storageKey = `${tenantId}/${taxpayerId || 'tenant'}/portal-documents/${input.belgeTuru}_${randomUUID()}.${ext}`;
      await this.storage.putBuffer(storageKey, buffer, mimeType, {
        source: 'portal-automation',
        belgeTuru: input.belgeTuru,
      });
    }

    const linkedBeyan = await this.linkEBeyannameDocumentToBeyanKaydi(tenantId, jobId, input, jobType, storageKey).catch((err) => {
      this.logger.warn(`e-Beyanname PDF kayda baglanamadi: ${err?.message || err}`);
      return null;
    });
    if (!taxpayerId && linkedBeyan?.taxpayerId) taxpayerId = linkedBeyan.taxpayerId;

    const belgeTuruKey = String(input.belgeTuru || '').toLocaleUpperCase('tr-TR');
    const isBeyannameBelgesi =
      belgeTuruKey.includes('GIB_BEYANNAME') ||
      belgeTuruKey.includes('GİB_BEYANNAME') ||
      belgeTuruKey.includes('GIB_TAHAKKUK') ||
      belgeTuruKey.includes('GİB_TAHAKKUK');

    let documentId: string | null = null;
    if (taxpayerId && storageKey && sizeBytes != null) {
      const doc = await (this.prisma as any).document.create({
        data: {
          taxpayerId,
          title: input.title,
          category: isBeyannameBelgesi ? 'BEYANNAME' : 'EVRAK',
          mimeType,
          sizeBytes,
          s3Key: storageKey,
          notes: `${input.belgeTuru} portaldan otomatik indirildi.`,
          tags: { create: [{ tag: input.belgeTuru }, { tag: sourceProvider }, { tag: 'otomatik' }] },
        },
      });
      const version = await (this.prisma as any).documentVersion.create({
        data: {
          documentId: doc.id,
          versionNo: 1,
          s3Key: storageKey,
          sizeBytes,
          uploadedBy: 'portal-automation',
          notes: 'Portal otomasyonu ilk indirme',
          // 2026-09-25 (bulgu 36b): tür saklanıyor. Özgün ad YOK — bu bir otomatik
          // indirme, kullanıcının verdiği bir dosya adı hiç olmadı; uydurulmaz.
          mimeType: mimeType || null,
        },
      });
      await (this.prisma as any).document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
      });
      documentId = doc.id;
    }

    // E-Tebligat + SGK (tahakkuk/hizmet) mukerrer engelle (belge no + belgeTuru benzersiz).
    // Varsa: eksik mukellefi / PDF'i geri doldur, kopya olusturma. (Lookup yukarida, blob upload'dan
    // ONCE yapildi — existingDedup.)
    if (existingDedup) {
      const existing = existingDedup;
      // Fatura Merkezi aktarimi icin etkin depolama bilgisi: bu cagride yeni blob olusturulduysa o,
      // olusturulmadiysa (skipBlobCreate) mevcut kayittaki — eski davranistaki gibi import calisir.
      const effStorageKey = storageKey || existing.storageKey || null;
      const effSizeBytes = storageKey ? sizeBytes : (existing.sizeBytes ?? null);
      const effMimeType = storageKey ? mimeType : (existing.mimeType || mimeType);
      const patch: any = {};
      if (!existing.taxpayerId && taxpayerId) patch.taxpayerId = taxpayerId;
      if (!existing.storageKey && storageKey) {
        patch.storageKey = storageKey;
        patch.sizeBytes = sizeBytes;
        patch.mimeType = mimeType;
        if (documentId) patch.documentId = documentId;
      }
      // SGK meta backfill: PDF'ten meta işlendiyse mevcut raw'ı güncelle (eksik alanları/tutarı doldurur).
      const newRaw: any = input.raw || {};
      if (newRaw.metaVersion || newRaw.metaParsed || newRaw.kanunNo || newRaw.belgeMahiyeti || newRaw.tutar) {
        patch.raw = input.raw;
      }
      if (String(input.belgeTuru) === 'EARSIV_FATURA' && newRaw.mode) {
        patch.raw = { ...(existing.raw && typeof existing.raw === 'object' ? existing.raw : {}), ...newRaw };
      }
      // DÖNEM/TARİH TAZELEME (Ercan Haziran bulgusu): ilk kayıt yanlış dönem-tarih ile oluşmuşsa
      //   mükerrer-önleme sonraki doğru sorgularda düzeltmiyordu → belge dönem filtresinde (liste +
      //   aktarım) hiç görünmüyordu. Taze sorgudaki dönem işin kendi tarih aralığından, tarih GİB
      //   satırından gelir; farklıysa güncelle.
      if (String(input.belgeTuru) === 'EARSIV_FATURA') {
        const freshPeriod = String(input.period || '').trim();
        if (/^\d{4}-\d{2}$/.test(freshPeriod) && existing.period !== freshPeriod) patch.period = freshPeriod;
        const freshIssued = parseDateOrNull(input.issuedAt);
        const oldIssued = existing.issuedAt ? new Date(existing.issuedAt).getTime() : null;
        if (freshIssued && (oldIssued == null || Math.abs(oldIssued - freshIssued.getTime()) > 1000)) patch.issuedAt = freshIssued;
      }
      if (Object.keys(patch).length) {
        const updated = await (this.prisma as any).portalDocument.update({ where: { id: existing.id }, data: patch });
        if ((input.raw as any)?.mode !== 'query') {
          await this.importEarsivPortalDocumentToAccounting(tenantId, jobId, input, jobType, effStorageKey, effSizeBytes, effMimeType)
            .catch((err) => this.logger.warn(`e-Arsiv Fatura Merkezi aktarimi yapilamadi: ${err?.message || err}`));
        }
        return updated;
      }
      if ((input.raw as any)?.mode !== 'query') {
        await this.importEarsivPortalDocumentToAccounting(tenantId, jobId, input, jobType, effStorageKey, effSizeBytes, effMimeType)
          .catch((err) => this.logger.warn(`e-Arsiv Fatura Merkezi aktarimi yapilamadi: ${err?.message || err}`));
      }
      return existing;
    }

    const created = await (this.prisma as any).portalDocument.create({
      data: {
        tenantId,
        taxpayerId,
        jobId,
        belgeTuru: input.belgeTuru || 'DIGER',
        sourceProvider,
        title: input.title || input.originalName || 'Portal belgesi',
        referenceNo: input.referenceNo || null,
        period: input.period || null,
        issuedAt: parseDateOrNull(input.issuedAt),
        receivedAt: parseDateOrNull(input.receivedAt) || new Date(),
        mimeType,
        sizeBytes,
        storageKey,
        documentId,
        raw: input.raw || null,
      },
    });
    if ((input.raw as any)?.mode !== 'query') {
      await this.importEarsivPortalDocumentToAccounting(tenantId, jobId, input, jobType, storageKey, sizeBytes, mimeType)
        .catch((err) => this.logger.warn(`e-Arsiv Fatura Merkezi aktarimi yapilamadi: ${err?.message || err}`));
    }
    return created;
  }

  private async importEarsivPortalDocumentToAccounting(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
    storageKey: string | null,
    sizeBytes: number | null,
    mimeType: string,
  ) {
    if (jobType !== 'EARSIV_PORTAL_FETCH') return null;
    if (String(input.belgeTuru || '') !== 'EARSIV_FATURA') return null;
    const taxpayerId = input.taxpayerId || (await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: { taxpayerId: true },
    }).catch(() => null))?.taxpayerId;
    if (!taxpayerId || !storageKey) return null;

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
    });
    if (!taxpayer) return null;

    const parsed = await this.parseEarsivPortalAccounting(input);
    const sourceRefId = parsed.ettn || parsed.belgeNo || input.referenceNo;
    if (!sourceRefId) return null;
    const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, taxpayerId, source: 'gib-earsiv-api', sourceRefId },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });

    const taxpayerName = String(taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ')).trim();
    const taxpayerVkn = String(tryDecrypt(taxpayer.taxNumber) || taxpayer.taxNumber || '').replace(/\D/g, '');
    const matrah = parsed.matrah ?? (parsed.total != null && parsed.kdvTutari != null ? this.roundMoney(parsed.total - parsed.kdvTutari) : null);
    const kdv = parsed.kdvTutari ?? (parsed.total != null && matrah != null ? this.roundMoney(parsed.total - matrah) : null);
    const total = parsed.total ?? (matrah != null && kdv != null ? this.roundMoney(matrah + kdv) : null);
    const status = total != null && matrah != null ? 'READY' : 'NEEDS_REVIEW';
    const lines = this.earsivAccountingLines({ matrah, kdv, total, rate: parsed.kdvOrani, customerName: parsed.customerName });

    if (existing) {
      const currentOcr: any = existing.ocrData && typeof existing.ocrData === 'object' ? existing.ocrData : {};
      const existingHasAmounts =
        Number(existing.totalAmount || 0) > 0 &&
        Number(currentOcr.matrah || 0) > 0 &&
        Number(currentOcr.kdvTutari || 0) >= 0 &&
        Array.isArray(existing.lines) &&
        existing.lines.length > 0;
      if (existingHasAmounts || (total == null && !lines.length)) return existing;

      await (this.prisma as any).$transaction(async (tx: any) => {
        await tx.invoiceAccountingLine.deleteMany({ where: { documentId: existing.id } });
        if (lines.length) {
          await tx.invoiceAccountingLine.createMany({
            data: lines.map((line, index) => ({
              documentId: existing.id,
              group: line.group || 'matrah',
              accountCode: line.accountCode || null,
              description: line.description || null,
              rate: line.rate || null,
              debit: line.debit || 0,
              credit: line.credit || 0,
              orderNo: index + 1,
            })),
          });
        }
        await tx.invoiceAccountingDocument.update({
          where: { id: existing.id },
          data: {
            status,
            mimeType,
            sizeBytes: sizeBytes || existing.sizeBytes || 0,
            s3Key: storageKey,
            currency: parsed.currency || existing.currency || 'TL',
            belgeNo: parsed.belgeNo || input.referenceNo || existing.belgeNo || null,
            faturaTarihi: parseDateOrNull(parsed.faturaTarihi || input.issuedAt) || existing.faturaTarihi || null,
            sellerVkn: taxpayerVkn || existing.sellerVkn || null,
            buyerVkn: parsed.buyerVkn || existing.buyerVkn || null,
            vendorName: taxpayerName || existing.vendorName || null,
            customerName: parsed.customerName || existing.customerName || null,
            totalAmount: total,
            ocrStatus: 'SUCCESS',
            ocrEngine: 'gib-earsiv-api',
            ocrConfidence: 1,
            ocrData: {
              ...currentOcr,
              provider: 'GIB_PORTAL',
              source: 'gib-earsiv-api',
              direction: 'SATIS',
              matrah,
              kdvTutari: kdv,
              kdvOrani: parsed.kdvOrani,
              ettn: parsed.ettn,
              portalReferenceNo: input.referenceNo || null,
            },
          },
        });
      });
      return (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: { id: existing.id, tenantId },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
      });
    }

    return (this.prisma as any).invoiceAccountingDocument.create({
      data: {
        tenantId,
        taxpayerId,
        source: 'gib-earsiv-api',
        sourceRefId,
        documentType: 'E_ARSIV',
        invoiceKind: 'SATIS',
        status,
        originalName: input.originalName || `${parsed.belgeNo || sourceRefId}.json`,
        mimeType,
        sizeBytes: sizeBytes || 0,
        s3Key: storageKey,
        currency: parsed.currency || 'TL',
        belgeNo: parsed.belgeNo || input.referenceNo || null,
        faturaTarihi: parseDateOrNull(parsed.faturaTarihi || input.issuedAt) || null,
        sellerVkn: taxpayerVkn || null,
        buyerVkn: parsed.buyerVkn || null,
        vendorName: taxpayerName || null,
        customerName: parsed.customerName || null,
        totalAmount: total,
        ocrStatus: 'SUCCESS',
        ocrEngine: 'gib-earsiv-api',
        ocrConfidence: 1,
        ocrData: {
          provider: 'GIB_PORTAL',
          source: 'gib-earsiv-api',
          direction: 'SATIS',
          matrah,
          kdvTutari: kdv,
          kdvOrani: parsed.kdvOrani,
          ettn: parsed.ettn,
          portalReferenceNo: input.referenceNo || null,
        },
        createdBy: null,
        ...(lines.length ? { lines: { create: lines } } : {}),
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
  }

  private async parseEarsivPortalAccounting(input: AgentDocumentInput) {
    const raw: any = input.raw && typeof input.raw === 'object' ? input.raw : {};
    const row: any = raw.row && typeof raw.row === 'object' ? raw.row : {};
    const json = this.tryParseJsonBase64(input.base64);
    const root = (json?.data && typeof json.data === 'object') ? json.data : (json && typeof json === 'object' ? json : {});
    const payload = await this.parseEarsivPayloadBase64(input.base64);
    const read = (keys: RegExp[]) => this.findEarsivValue(root, keys) || this.findEarsivValue(row, keys) || this.findEarsivValue(raw, keys);
    // GİB e-Arşiv API çok-oranlı faturalarda bazı alanları dizi olarak döndürür:
    //   hesaplananKdv: ["180,00","90,00"]  →  parseEarsivMoney dizi alırsa null döner.
    //   Çözüm: dizi ise elemanları topla; tek değerse normal parse et.
    const readMoney = (keys: RegExp[]): number | null => {
      const value = read(keys);
      if (Array.isArray(value)) {
        const sum = value.reduce((acc: number, v: any) => acc + (this.parseEarsivMoney(v) ?? 0), 0);
        return sum > 0 ? this.roundMoney(sum) : null;
      }
      return this.parseEarsivMoney(value);
    };
    const belgeNo = String(raw.belgeNumarasi || input.referenceNo || read([/^(belgeNumarasi|faturaNumarasi|faturaNo|belgeNo)$/i]) || payload.belgeNo || '').trim();
    const ettn = String(raw.ettn || read([/^(ettn|uuid|faturaUuid|belgeUuid)$/i]) || payload.ettn || '').trim();
    const buyerVkn = String(read([/^(vknTckn|aliciVkn|aliciVknTckn|aliciTckn|aliciVergiNo)$/i]) || payload.buyerVkn || '').replace(/\D/g, '');
    const customerName = String(read([/^(aliciUnvanAdSoyad|aliciUnvan|aliciAdiSoyadi|aliciAdSoyad|musteriUnvan|unvan)$/i]) || payload.customerName || '').trim();
    const faturaTarihi = String(read([/^(belgeTarihi|faturaTarihi|duzenlemeTarihi|tarih)$/i]) || payload.faturaTarihi || '').trim();
    const currency = String(read([/^(paraBirimi|dovizCinsi|currency)$/i]) || payload.currency || 'TL').trim() || 'TL';
    const total = payload.total ?? readMoney([
      /^(odenecek|ödenecek).*tutar/i,
      /^vergiler.*dahil.*toplam/i,
      /^genel.*toplam/i,
      /^toplam.*tutar/i,
      /^net.*tutar/i,
      /^tutar(?:Formatted|Formatli|Text)?$/i,
    ]);
    const matrah = payload.matrah ?? readMoney([
      /^mal.*hizmet.*toplam.*tutar/i,
      /^kdv.*matrah/i,
      /^matrah/i,
      /^vergi.*haric/i,
      /^vergisiz.*tutar/i,
    ]);
    const kdvTutari = payload.kdvTutari ?? readMoney([
      /^hesaplanan.*kdv/i,
      /^kdv.*tutar/i,
      /^toplam.*kdv/i,
      /^vergi.*tutar/i,
      /^tax.*amount/i,
    ]);
    const kdvOrani = String(read([/^(kdvOrani|kdvOran)$/i]) || payload.kdvOrani || '').replace(/[^\d.,]/g, '').replace(',', '.');
    return {
      belgeNo,
      ettn,
      buyerVkn: buyerVkn.length >= 10 ? buyerVkn : null,
      customerName: customerName || null,
      faturaTarihi: faturaTarihi || null,
      currency,
      total,
      matrah,
      kdvTutari,
      kdvOrani: kdvOrani || null,
    };
  }

  private async extractEarsivPayloadText(buffer: Buffer, depth = 0): Promise<string | null> {
    if (!buffer.length || depth > 5) return null;
    if (buffer[0] === 0x25) return null; // PDF: structured total extraction is not reliable here.
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const entries = Object.values(zip.files)
          .filter((entry) => !entry.dir)
          .sort((a, b) => {
            const rank = (name: string) => /\.(xml|ubl)$/i.test(name) ? 0 : /\.(html?|xhtml)$/i.test(name) ? 1 : /\.json$/i.test(name) ? 2 : 3;
            return rank(a.name || '') - rank(b.name || '');
          });
        for (const entry of entries) {
          const name = entry.name || '';
          const nested = Buffer.from(await entry.async('uint8array'));
          if (!nested.length) continue;
          if (nested[0] === 0x50 && nested[1] === 0x4b) {
            const inner = await this.extractEarsivPayloadText(nested, depth + 1).catch(() => null);
            if (inner) return inner;
            continue;
          }
          const candidate = this.htmlDecode(nested.toString('utf8')).trim();
          if (/\.(xml|ubl|html?|xhtml)$/i.test(name) && candidate.length > 20) return candidate;
          if (/\.json$/i.test(name) || /^[\[{]/.test(candidate)) {
            const embedded = await this.extractEarsivInvoiceTextFromJson(candidate);
            if (embedded) return embedded;
          }
          const compact = candidate.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
          if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length > 120) {
            const decoded = await this.extractEarsivPayloadText(Buffer.from(compact, 'base64'), depth + 1).catch(() => null);
            if (decoded) return decoded;
          }
        }
      } catch {
        return null;
      }
      return null;
    }

    const text = this.htmlDecode(buffer.toString('utf8')).trim();
    if (!text || text.length < 20) return null;
    const embeddedInvoice = await this.extractEarsivInvoiceTextFromJson(text);
    if (embeddedInvoice) return embeddedInvoice;
    return text;
  }

  private parseEarsivPortalHtmlTotals(html: string) {
    if (!html || !/malHizmetKDV\(|hesaplananKDV\(|vergidahil|odenecek/i.test(html)) return null;
    const matrahByRate: Record<string, number> = {};
    const kdvByRate: Record<string, number> = {};
    for (const m of html.matchAll(/malHizmetKDV\((\d+(?:[.,]\d+)?)\)['"]?\s*:\s*['"]?([\d.,]+)/gi)) {
      const rate = m[1].replace(',', '.');
      const value = this.parseEarsivMoney(m[2]);
      if (value != null) matrahByRate[rate] = (matrahByRate[rate] || 0) + value;
    }
    for (const m of html.matchAll(/hesaplananKDV\((\d+(?:[.,]\d+)?)\)['"]?\s*:\s*['"]?([\d.,]+)/gi)) {
      const rate = m[1].replace(',', '.');
      const value = this.parseEarsivMoney(m[2]);
      if (value != null) kdvByRate[rate] = (kdvByRate[rate] || 0) + value;
    }
    const rates = Array.from(new Set([...Object.keys(matrahByRate), ...Object.keys(kdvByRate)]));
    const matrah = this.roundMoney(rates.reduce((sum, rate) => sum + (matrahByRate[rate] || 0), 0));
    const kdvTutari = this.roundMoney(rates.reduce((sum, rate) => sum + (kdvByRate[rate] || 0), 0));
    const totalMatch = html.match(/(?:vergidahil|odenecek)['"]?\s*:\s*['"]?([\d.,]+)/i);
    const total = this.parseEarsivMoney(totalMatch?.[1]) ?? (matrah || kdvTutari ? this.roundMoney(matrah + kdvTutari) : null);
    if (!total && !matrah && !kdvTutari) return null;
    return {
      matrah: matrah || null,
      kdvTutari: kdvTutari || null,
      total,
      kdvOrani: rates.length === 1 ? rates[0] : null,
    };
  }

  private async parseEarsivPayloadBase64(base64?: string | null) {
    const clean = cleanBase64(base64);
    if (!clean) return {} as any;
    const buffer = Buffer.from(clean, 'base64');
    let text = await this.extractEarsivPayloadText(buffer).catch(() => null);
    if (!text || text.length < 20) return {} as any;
    const embeddedInvoice = await this.extractEarsivInvoiceTextFromJson(text);
    if (embeddedInvoice) text = embeddedInvoice;
    const htmlTotals = this.parseEarsivPortalHtmlTotals(text);

    const stripBlocks = (src: string, tag: string) =>
      src.replace(new RegExp(`<[^:>]*(?::)?${tag}\\b[\\s\\S]*?<\\/[^:>]*(?::)?${tag}>`, 'gi'), ' ');
    const amountTag = (src: string, tag: string) => {
      const m = src.match(new RegExp(`<[^:>]*(?::)?${tag}\\b[^>]*>([^<]+)<\\/[^:>]*(?::)?${tag}>`, 'i'));
      return m ? this.parseEarsivMoney(m[1]) : null;
    };
    const textTag = (src: string, tag: string) => {
      const m = src.match(new RegExp(`<[^:>]*(?::)?${tag}\\b[^>]*>([^<]+)<\\/[^:>]*(?::)?${tag}>`, 'i'));
      return m ? this.htmlDecode(m[1]).trim() : null;
    };

    let xmlInvoiceOnly = stripBlocks(text, 'InvoiceLine');
    xmlInvoiceOnly = stripBlocks(xmlInvoiceOnly, 'CreditNoteLine');
    const xmlTaxOnly = stripBlocks(xmlInvoiceOnly, 'WithholdingTaxTotal');
    const monetary = xmlInvoiceOnly.match(/<[^:>]*(?::)?LegalMonetaryTotal\b[\s\S]*?<\/[^:>]*(?::)?LegalMonetaryTotal>/i)?.[0] || xmlInvoiceOnly;
    const taxTotal = xmlTaxOnly.match(/<[^:>]*(?::)?TaxTotal\b[\s\S]*?<\/[^:>]*(?::)?TaxTotal>/i)?.[0] || xmlTaxOnly;
    const taxSubtotal = taxTotal.match(/<[^:>]*(?::)?TaxSubtotal\b[\s\S]*?<\/[^:>]*(?::)?TaxSubtotal>/i)?.[0] || taxTotal;
    const taxSubtotalBlocks = Array.from(taxTotal.matchAll(/<[^:>]*(?::)?TaxSubtotal\b[\s\S]*?<\/[^:>]*(?::)?TaxSubtotal>/gi)).map((m) => m[0]);
    const taxBreakdown = taxSubtotalBlocks
      .map((block) => ({
        base: amountTag(block, 'TaxableAmount'),
        amount: amountTag(block, 'TaxAmount'),
        rate: Number(String(textTag(block, 'Percent') || '').replace(',', '.')),
      }))
      .filter((item) => (item.base != null || item.amount != null) && Number.isFinite(item.rate));
    const breakdownMatrah = taxBreakdown.length ? this.roundMoney(taxBreakdown.reduce((sum, item) => sum + Number(item.base || 0), 0)) : null;
    const breakdownKdv = taxBreakdown.length ? this.roundMoney(taxBreakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0)) : null;

    const plain = this.htmlDecode(text)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const labelMoney = (labels: RegExp[]) => {
      for (const label of labels) {
        const re = new RegExp(`${label.source}.{0,120}?(\\d{1,3}(?:[.\\s]\\d{3})*(?:,\\d{2})|\\d+(?:[.,]\\d{2}))\\s*(?:TL|TRY)?`, 'i');
        const m = plain.match(re);
        const v = m ? this.parseEarsivMoney(m[1]) : null;
        if (v != null) return v;
      }
      return null;
    };

    const matrah = amountTag(monetary, 'TaxExclusiveAmount')
      ?? amountTag(monetary, 'LineExtensionAmount')
      ?? htmlTotals?.matrah
      ?? breakdownMatrah
      ?? labelMoney([/mal\s*hizmet\s*toplam\s*tutar/i, /kdv\s*matrah/i, /matrah/i]);
    const kdvTutari = amountTag(taxTotal, 'TaxAmount')
      ?? htmlTotals?.kdvTutari
      ?? breakdownKdv
      ?? labelMoney([/hesaplanan\s*kdv/i, /kdv\s*tutar/i, /toplam\s*kdv/i]);
    const total = amountTag(monetary, 'PayableAmount')
      ?? amountTag(monetary, 'TaxInclusiveAmount')
      ?? htmlTotals?.total
      ?? labelMoney([/(?:o|ö)denecek\s*tutar/i, /vergiler\s*dahil\s*toplam\s*tutar/i, /genel\s*toplam/i]);
    const kdvOrani = textTag(taxSubtotal, 'Percent') || htmlTotals?.kdvOrani || (plain.match(/KDV\s*Oran[^\d]{0,20}(\d{1,2}(?:[.,]\d+)?)/i)?.[1] || null);
    const belgeNo = textTag(xmlInvoiceOnly, 'ID') || null;
    const ettn = textTag(xmlInvoiceOnly, 'UUID') || null;
    const issueDate = textTag(xmlInvoiceOnly, 'IssueDate') || null;

    return {
      belgeNo,
      ettn,
      faturaTarihi: issueDate,
      currency: text.match(/currencyID=["']([^"']+)["']/i)?.[1] || null,
      matrah,
      kdvTutari,
      total,
      kdvOrani,
    };
  }

  private async extractEarsivInvoiceTextFromJson(text: string): Promise<string | null> {
    const source = String(text || '').trim();
    if (!/^[\[{]/.test(source)) return null;
    let json: any;
    try {
      json = JSON.parse(source);
    } catch {
      return null;
    }
    const strings: string[] = [];
    const visit = (node: any, key = '', depth = 0) => {
      if (node == null || depth > 8) return;
      if (typeof node === 'string') {
        const value = node.trim();
        if (value.length > 20 && (/xml|ubl|html|content|data|base64|document|invoice|fatura|belge/i.test(key) || /<html[\s>]|<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(value) || /^[A-Za-z0-9+/=\s]{240,}$/.test(value))) {
          strings.push(value);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, key, depth + 1));
        return;
      }
      if (typeof node === 'object') {
        for (const [childKey, childValue] of Object.entries(node)) visit(childValue, childKey, depth + 1);
      }
    };
    visit(json);

    const unpackBuffer = async (buffer: Buffer): Promise<string | null> => {
      if (!buffer.length) return null;
      if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
        const zip = await JSZip.loadAsync(buffer);
        const entries = Object.values(zip.files)
          .filter((entry) => !entry.dir)
          .sort((a, b) => {
            const rank = (name: string) => /\.(xml|ubl)$/i.test(name) ? 0 : /\.(html?|xhtml)$/i.test(name) ? 1 : 2;
            return rank(a.name || '') - rank(b.name || '');
          });
        for (const entry of entries) {
          if (!/\.(xml|ubl|html?|xhtml)$/i.test(entry.name || '')) continue;
          const nested = Buffer.from(await entry.async('uint8array'));
          if (nested[0] === 0x50 && nested[1] === 0x4b) {
            const inner = await unpackBuffer(nested);
            if (inner) return inner;
            continue;
          }
          const candidate = this.htmlDecode(nested.toString('utf8')).trim();
          if (candidate.length > 20) return candidate;
        }
        return null;
      }
      const candidate = this.htmlDecode(buffer.toString('utf8')).trim();
      return candidate.length > 20 ? candidate : null;
    };

    for (const raw of strings) {
      const candidate = this.htmlDecode(raw).trim();
      if (/<html[\s>]/i.test(candidate.slice(0, 1000)) || /<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(candidate)) {
        return candidate;
      }
      const compact = candidate.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length < 80) continue;
      const decoded = await unpackBuffer(Buffer.from(compact, 'base64')).catch(() => null);
      if (decoded) return decoded;
    }
    return null;
  }

  private htmlDecode(value: string) {
    return String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_m, n) => {
        const code = Number(n);
        return Number.isFinite(code) ? String.fromCharCode(code) : '';
      });
  }

  private tryParseJsonBase64(base64?: string | null) {
    const clean = cleanBase64(base64);
    if (!clean) return null;
    const text = Buffer.from(clean, 'base64').toString('utf8').trim();
    if (!text || !/^[\[{]/.test(text)) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private findEarsivValue(obj: any, keyPatterns: RegExp[], depth = 0): any {
    if (!obj || depth > 7) return null;
    if (typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = this.findEarsivValue(item, keyPatterns, depth + 1);
        if (found !== null && found !== undefined && String(found).trim() !== '') return found;
      }
      return null;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (keyPatterns.some((re) => re.test(key)) && value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
    for (const value of Object.values(obj)) {
      const found = this.findEarsivValue(value, keyPatterns, depth + 1);
      if (found !== null && found !== undefined && String(found).trim() !== '') return found;
    }
    return null;
  }

  private parseEarsivMoney(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return this.roundMoney(value);
    const raw = String(value).replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw;
    const num = Number(normalized);
    return Number.isFinite(num) ? this.roundMoney(num) : null;
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private earsivAccountingLines(input: { matrah: number | null; kdv: number | null; total: number | null; rate?: string | null; customerName?: string | null }) {
    const lines: any[] = [];
    if (input.matrah != null) {
      lines.push({ group: 'matrah', description: 'Matrah (Gelir)', rate: input.rate || null, debit: 0, credit: input.matrah, orderNo: 1 });
    }
    if (input.kdv != null && Math.abs(input.kdv) > 0.004) {
      lines.push({ group: 'vergi', description: 'Hesaplanan KDV', rate: input.rate || null, debit: 0, credit: input.kdv, orderNo: 2 });
    }
    if (input.total != null) {
      lines.push({ group: 'cari', description: input.customerName || 'Cari Hesap', rate: null, debit: input.total, credit: 0, orderNo: 3 });
    }
    return lines;
  }

  private async linkEBeyannameDocumentToBeyanKaydi(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
    storageKey: string | null,
  ): Promise<{ taxpayerId: string; beyanKaydiId: string } | null> {
    if (jobType !== 'EBEYANNAME_DAILY_DOWNLOAD') return null;
    if (!storageKey) return null;
    if (input.belgeTuru === 'GIB_XML') return null;

    const name = input.originalName || input.title || '';
    const mimeType = input.mimeType || '';
    if (!/pdf/i.test(mimeType) && !/\.pdf$/i.test(name)) return null;

    const base64 = cleanBase64(input.base64);
    if (!base64) return null;

    // PDF metni cogu GIB beyannamesinde okunamiyor (OCR kapali). O zaman runner'in GIB listesinden
    // KAZIDIGI VKN + tur + donem'e DUS (input.raw/period) -> beyan kaydi yine de olusur, gorunur olur.
    const parsed: any = await this.beyanKayitlari.parseBeyannamePdf(base64).catch(() => ({}));
    const rawMeta: any = (input.raw && typeof input.raw === 'object') ? input.raw : {};
    // ONEMLI: VKN/tip/donem'de HER ZAMAN GIB listesinden gelen SATIR verisini (rawMeta/period) oncele,
    // PDF parse'i DEGIL. Cunku beyanname PDF'i metin-okunabilir olunca parseBeyannamePdf cogu zaman
    // YANLIS bir numara (mali musavir VKN'si / fis no vb.) okuyup beyannameyi BASKA kayda yaziyordu;
    // tahakkuk PDF'i okunamayinca dogru satir-VKN'sine dusup gorunen kayda baglaniyordu. Bu yuzden
    // ayni mukellefte "tahakkuk var, beyanname yok" oluyordu. Satir verisi = kaydin eslestigi veri.
    const rowVkn = String(rawMeta.taxNumber || rawMeta.vkn || '').replace(/\D/g, '');
    const vkn = (rowVkn || String(parsed?.vkn || '').replace(/\D/g, '')) || null;
    const beyanTipi = rawMeta.beyanTipi || parsed?.beyanTipi || null;
    const donem = input.period || parsed?.donem || rawMeta.donem || null;
    const taxpayer = vkn ? await this.findTaxpayerByTaxNo(tenantId, vkn) : null;

    if (!taxpayer?.id || !beyanTipi || !donem) {
      this.logger.warn(`[EBLINK] beyan kaydi olusmadi: vkn=${vkn ? '...' + vkn.slice(-3) : 'YOK'} tip=${beyanTipi || '-'} donem=${donem || '-'} mukellef=${taxpayer?.id ? 'bulundu' : 'YOK'} (pdf=${parsed?.vkn ? 'okundu' : 'okunamadi'})`);
      return null;
    }

    const isTahakkuk = input.belgeTuru === 'GIB_TAHAKKUK' || /tahakkuk|fis|fiş/i.test(name);
    const tahakkukMeta: { tahakkukTutari?: number | null; onayNo?: string | null } = isTahakkuk
      ? await this.extractTahakkukMetaFromBase64(base64).catch((err) => {
          this.logger.warn(`Tahakkuk PDF meta okunamadi: ${err?.message || err}`);
          return {};
        })
      : {};
    const tahakkukTutari = isTahakkuk ? tahakkukMeta.tahakkukTutari ?? parsed.tahakkukTutari ?? null : null;
    const onayNo = tahakkukMeta.onayNo || parsed.onayNo || null;
    const parsedDate = parsed.beyanTarihi ? parseDateOrNull(parsed.beyanTarihi) : null;
    const rawNote = JSON.stringify({
      source: 'portal-automation-pdf-parse',
      fileName: name,
      parsed,
      tahakkukMeta,
      raw: input.raw || null,
    }).slice(0, 1000);

    const data: any = {
      kaynak: 'gib_agent',
      importBatchId: jobId,
      notlar: rawNote,
    };
    if (parsedDate) data.beyanTarihi = parsedDate;
    if (isTahakkuk && tahakkukTutari != null) data.tahakkukTutari = tahakkukTutari;
    if (onayNo) data.onayNo = onayNo;
    if (isTahakkuk) data.pdfUrl = storageKey;
    else data.beyannameUrl = storageKey;

    const kayit = await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi,
        donem,
        beyanTarihi: parsedDate,
        tahakkukTutari,
        onayNo,
        kaynak: 'gib_agent',
        importBatchId: jobId,
        notlar: rawNote,
        ...(isTahakkuk ? { pdfUrl: storageKey } : { beyannameUrl: storageKey }),
      },
      update: data,
    });

    const durumUpdate: any = {
      durum: 'onaylandi',
      onayTarihi: parsedDate || new Date(),
    };
    if (isTahakkuk && tahakkukTutari != null) durumUpdate.tahakkukTutari = tahakkukTutari;

    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi,
        donem,
        durum: 'onaylandi',
        onayTarihi: parsedDate || new Date(),
        tahakkukTutari,
        notlar: 'GIB agent PDF parse ile indirildi',
      },
      update: {
        ...durumUpdate,
      },
    }).catch(() => {});

    return { taxpayerId: taxpayer.id, beyanKaydiId: kayit.id };
  }

  private normalizeTaxNoValue(value?: string | null): string {
    return String(tryDecrypt(value) || value || '').replace(/\D/g, '');
  }

  private extractTaxNumbers(text: string): string[] {
    return Array.from(new Set(
      Array.from(String(text || '').matchAll(/\b\d{10,11}\b/g))
        .map((m) => m[0])
        .filter((value) => value.length === 10 || value.length === 11),
    ));
  }

  private async findTaxpayerByTaxNo(tenantId: string, taxNo: string): Promise<{ id: string } | null> {
    const normalized = this.normalizeTaxNoValue(taxNo);
    if (!normalized) return null;
    const direct = await (this.prisma as any).taxpayer.findFirst({
      where: { tenantId, taxNumber: normalized },
      select: { id: true },
    });
    if (direct?.id) return direct;

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId },
      select: { id: true, taxNumber: true },
      take: 5000,
    });
    return taxpayers.find((taxpayer: any) => this.normalizeTaxNoValue(taxpayer.taxNumber) === normalized) || null;
  }

  private async pdfTextFromBase64(base64: string) {
    const buffer = Buffer.from(base64, 'base64');
    const parser = new PDFParse({ data: buffer });
    let text = '';
    try {
      const result = await parser.getText();
      text = String(result?.text || '').replace(/\s+/g, ' ').trim();
    } finally {
      const destroy = (parser as any).destroy;
      if (typeof destroy === 'function') await destroy.call(parser).catch(() => {});
    }
    if (text.length >= 20 || !this.portalPdfOcrFallbackEnabled()) return text;
    const ocrText = await this.azureReadPdfText(buffer).catch((err) => {
      this.logger.warn(`Portal PDF OCR fallback hata: ${err?.message || err}`);
      return '';
    });
    return String(ocrText || '').replace(/\s+/g, ' ').trim() || text;
  }

  private async storeBase64IfPresent(s3Key: string, base64Input: string | null | undefined, mimeType: string, originalName: string) {
    const base64 = cleanBase64(base64Input);
    if (!base64) return null;
    const buffer = Buffer.from(base64, 'base64');
    await this.storage.putBuffer(s3Key, buffer, mimeType, {
      originalName: encodeURIComponent(originalName),
      source: 'portal-automation',
    });
    return s3Key;
  }

  private async extractTahakkukMetaFromBase64(base64Input: string | null | undefined): Promise<{ tahakkukTutari?: number | null; onayNo?: string | null }> {
    const base64 = cleanBase64(base64Input);
    if (!base64) return {};
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 200) return {};

    const text = await this.pdfTextFromBase64(base64);
    return {
      tahakkukTutari: this.extractTahakkukAmount(text),
      onayNo: this.extractTahakkukOnayNo(text),
    };
  }

  private extractTahakkukAmount(text: string): number | null {
    const compact = String(text || '').replace(/\s+/g, ' ');
    const preferredLabels = [
      /terkin\s+sonrasi\s+kalan\s+vergi\s+tutari/i,
      /tahakkuk\s+eden\s+(?:vergi\s+)?tutar/i,
      /tahakkuk\s+tutar[ıi]/i,
      /tahakkuk\s+fi[şs]i\s+tutar[ıi]/i,
      /odenecek\s+(?:vergi\s+)?tutar/i,
      /ödenecek\s+(?:vergi\s+)?tutar/i,
      /odenmesi\s+gereken\s+(?:vergi\s+)?tutar/i,
      /ödenmesi\s+gereken\s+(?:vergi\s+)?tutar/i,
      /toplam\s+tahakkuk/i,
      /toplam\s+vergi/i,
    ];
    for (const label of preferredLabels) {
      const match = compact.match(new RegExp(`${label.source}.{0,180}`, 'i'));
      const amount = match ? this.lastTurkishMoney(match[0]) : null;
      if (amount != null) return amount;
    }

    const lines = String(text || '').split(/\r?\n| {2,}/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!/tahakkuk|odenecek|ödenecek|terkin|kalan vergi|toplam/i.test(line)) continue;
      const amount = this.lastTurkishMoney(line);
      if (amount != null) return amount;
    }
    return null;
  }

  private portalPdfOcrFallbackEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_PDF_OCR_FALLBACK;
    if (raw != null) return this.envFlag(raw);
    return !!(process.env.AZURE_VISION_KEY && process.env.AZURE_VISION_ENDPOINT);
  }

  private async azureReadPdfText(buffer: Buffer): Promise<string> {
    const key = process.env.AZURE_VISION_KEY;
    const endpoint = String(process.env.AZURE_VISION_ENDPOINT || '').replace(/\/+$/, '');
    if (!key || !endpoint) return '';

    const analyze = await fetch(`${endpoint}/vision/v3.2/read/analyze`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/pdf',
      },
      body: buffer as any,
    });
    if (!analyze.ok) throw new Error(`Azure Read ${analyze.status}: ${(await analyze.text()).slice(0, 120)}`);
    const operationLocation = analyze.headers.get('operation-location');
    if (!operationLocation) throw new Error('Azure operation-location yok');

    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });
      if (!poll.ok) throw new Error(`Azure poll ${poll.status}`);
      const json: any = await poll.json();
      const status = String(json?.status || '').toLowerCase();
      if (status === 'succeeded') {
        const lines: string[] = [];
        for (const pageResult of json?.analyzeResult?.readResults || []) {
          for (const line of pageResult?.lines || []) {
            if (line?.text) lines.push(String(line.text));
          }
        }
        return lines.join('\n');
      }
      if (status === 'failed') throw new Error('Azure Read failed');
    }
    throw new Error('Azure Read timeout');
  }

  private extractTahakkukOnayNo(text: string): string | null {
    const compact = String(text || '').replace(/\s+/g, ' ');
    const match = compact.match(/(?:onay|tahakkuk|fis|fiş)\s*(?:no|numarasi|numarası)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./-]{5,})/i);
    return match?.[1]?.slice(0, 80) || null;
  }

  private lastTurkishMoney(text: string): number | null {
    const matches = Array.from(String(text || '').matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d{4,},\d{2}\b|\b\d{1,3},\d{2}\b/g)).map((m) => m[0]);
    for (const raw of matches.reverse()) {
      const normalized = raw.replace(/\./g, '').replace(',', '.');
      const value = Number(normalized);
      if (Number.isFinite(value)) return Math.round(value * 100) / 100;
    }
    return null;
  }

  private isCorrectionDeclarationInput(input: AgentDeclarationInput) {
    const text = [
      input.raw?.isCorrection ? 'DUZELTME' : '',
      input.raw?.mahiyet,
      input.raw?.rowText,
      Array.isArray(input.raw?.cells) ? input.raw.cells.join(' ') : '',
    ].filter(Boolean).join(' ');
    return /\bDUZELTME\b/.test(normalizeTextKey(text));
  }

  private extensionFromMime(mimeType: string, originalName?: string | null) {
    const byName = originalName?.split('.').pop();
    if (byName && byName.length <= 8) return byName.toLowerCase();
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('xml')) return 'xml';
    if (mimeType.includes('zip')) return 'zip';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'xlsx';
    return 'bin';
  }

  private instructionForJob(jobType: PortalJobType) {
    switch (jobType) {
      case 'EBEYANNAME_DAILY_DOWNLOAD':
        return 'Mali musavir e-Beyanname kullanici kodu ve sifresi ile onceki gun verilen beyannameleri, tahakkuklari ve varsa XML dosyalarini indir; BeyanKaydi olarak teslim et.';
      case 'E_TEBLIGAT_CHECK':
        return 'Mukellefin vergi dairesi kullanici kodu ve sifresi ile e-Tebligat kutusunu kontrol et; yeni tebligat varsa PDF ve metadata olarak teslim et.';
      case 'EARSIV_PORTAL_FETCH':
        return 'Mukellefin vergi dairesi kullanici kodu ve sifresi ile GIB e-Arsiv portalina gir; secili donemde kestigi e-Arsiv satis faturalarini indir ve Fatura Merkezi is akisi icin teslim et.';
      case 'SGK_HIZMET_LISTESI':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile hizmet listesini indir ve portal belgesi olarak teslim et.';
      case 'SGK_TAHAKKUK':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile cari donem tahakkuklarini indir ve portal belgesi olarak teslim et.';
      case 'SGK_ISE_GIRIS_CIKIS':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile ise giris ve isten cikis bildirgelerini indir ve portal belgesi olarak teslim et.';
      case 'SGK_ISGOREMEZLIK':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile isgoremezlik raporlarini sorgula; rapor varsa portal belgesi olarak teslim et.';
      case 'DVD_SORGU':
        return 'Mukellefin Dijital Vergi Dairesi kullanici kodu ve sifresi ile payload.sorgular listesindeki sorgulari (vergi borcu, e-haciz, yoklama/denetim, POS, gelen e-arsiv, e-defter) tiklamasiz API ile calistir; sonuclari result.genelSorgular / result.eDefterBeratlar olarak teslim et.';
    }
  }

  private async markCredentialError(job: any, errorMessage: string) {
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) return;
    const ownerId = meta.ownerType === 'TENANT' ? job.tenantId : job.taxpayerId;
    if (!ownerId) return;
    await (this.prisma as any).portalCredential.updateMany({
      where: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId },
      data: { lastCheckedAt: new Date(), lastError: errorMessage.slice(0, 1000) },
    });

    // === IN-APP BILDIRIM: Portal sifresi hatasi ===
    // Sadece kimlik-bilgisi hatasi gibi gorunenler icin (timeout/network degil)
    const looksLikeCredentialIssue = this.classifyCredentialError(errorMessage);
    if (!looksLikeCredentialIssue) return;

    // Şifre "sürümü": kayıtlı şifre her kaydedişte yeni şifreli metin üretir (rastgele IV) → kısa özeti
    //   dedupe anahtarına eklenir. Böylece 7 günlük pencerede aynı şifre için 1 bildirim; şifre
    //   güncellenip YİNE hata verirse anahtar değişir, kullanıcı hemen yeniden uyarılır.
    const cred = await (this.prisma as any).portalCredential.findUnique({
      where: { tenantId_provider_ownerType_ownerId: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId } },
      select: { encryptedPassword: true, encryptedSecondaryPassword: true },
    }).catch(() => null);
    const sifreSurumu = createHash('sha1')
      .update(`${cred?.encryptedPassword || ''}|${cred?.encryptedSecondaryPassword || ''}`)
      .digest('hex')
      .slice(0, 8);

    // Taxpayer-owned credential icin mukellef adini cek
    let scopeLabel = meta.provider.replace(/_/g, ' ');
    if (meta.ownerType === 'TAXPAYER' && job.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: job.taxpayerId, tenantId: job.tenantId },
        select: { companyName: true, firstName: true, lastName: true },
      }).catch(() => null);
      if (tp) {
        const name = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ');
        if (name) scopeLabel = `${scopeLabel} — ${name}`;
      }
    }

    await this.notifications.createForTenant({
      tenantId: job.tenantId,
      type: NOTIFICATION_TYPES.PORTAL_CREDENTIAL_FAIL,
      title: `🔑 Portal şifre hatası: ${scopeLabel}`,
      body: `${meta.label} işlemi sırasında giriş yapılamadı. Lütfen ayarlardan parolayı güncelleyin. (${errorMessage.slice(0, 200)})`,
      metadata: {
        provider: meta.provider,
        ownerType: meta.ownerType,
        ownerId,
        jobId: job.id,
        jobType: job.jobType,
        link: '/panel/ayarlar/entegrasyonlar',
      },
      // Önek `portal-cred-fail:<provider>:<ownerId>` sabit — saveCredential bu önekle açık bildirimleri kapatır.
      dedupeKey: `portal-cred-fail:${meta.provider}:${ownerId}:${sifreSurumu}`,
      // 7 gün: şifre güncellenene kadar 1 kez (eskiden 12 saat → aynı hata ayda ~90 bildirim).
      //   Şifre kaydedilince saveCredential açık bildirimleri kapatır; hata sürerse 7 gün sonra yeniden hatırlatır.
      dedupeWindowMin: 60 * 24 * 7,
    }).catch((e) => {
      this.logger.warn(`PORTAL_CREDENTIAL_FAIL notif failed: ${(e as Error).message}`);
    });
  }

  /** Hata mesaji credential/parola/login hatasi gibi mi? */
  private classifyCredentialError(message: string): boolean {
    if (!message) return false;
    const m = message.toLowerCase();
    const triggers = [
      'sifre', 'şifre', 'parola', 'password', 'login fail', 'kullan', 'invalid credential',
      'unauthorized', 'authentication', 'auth failed', 'gecersiz', 'geçersiz', 'kimlik',
      '401', 'forbidden', '403', 'oturum',
    ];
    return triggers.some((t) => m.includes(t));
  }

  private async markCredentialSuccess(job: any) {
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) return;
    const ownerId = meta.ownerType === 'TENANT' ? job.tenantId : job.taxpayerId;
    if (!ownerId) return;
    await (this.prisma as any).portalCredential.updateMany({
      where: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId },
      data: { lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
    });
  }

  private async resolveTenantFromToken(token?: string): Promise<string> {
    return resolveAgentTenant(token, this.prisma as any, { kaynak: 'portal-automation' });
  }

  private envFlag(value?: string | null) {
    return ['1', 'true', 'yes', 'on', 'evet'].includes(String(value || '').trim().toLowerCase());
  }

  private runnerEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_ENABLED;
    if (raw != null) return this.envFlag(raw);
    return process.env.NODE_ENV !== 'test';
  }

  private runnerIncludeNightly() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_INCLUDE_NIGHTLY;
    if (raw != null) return this.envFlag(raw);
    return this.runnerEnabled();
  }

  private runnerJobTypes() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_JOB_TYPES;
    if (!raw) return PORTAL_JOB_TYPES;
    const parsed = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(isPortalJobType);
    return parsed.length ? parsed : PORTAL_JOB_TYPES;
  }
}
