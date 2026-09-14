import { BadRequestException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright-core';
import * as ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { ilkIsGunu, isoGun } from '../schedule/is-gunu';
import { DEFAULT_SENDER } from './akilli-bildirim.service';
import { ShortLinkService } from './short-link.controller';
import { BeyannameTakipService } from '../beyanname-takip/beyanname-takip.service';
import { mergePdfBuffers } from './pdf-merge.util';
import {
  ayAdi,
  beyanYili,
  donemEtiketi,
  gelirTaksitTutari,
  GonderimBilgisi,
  hamSonGun,
  kaydinSecimi,
  OdemeListesi,
  OdemeSatiri,
  odemeAyiDonemleri,
  SGK_TUR_AD,
  turAdi,
} from './aylik-odeme-donem';
import { CetvelGrup, odemeCetveliEposta, odemeCetveliMesaji, paraTR } from './aylik-odeme-metin';
import { cetvelHtml } from './aylik-odeme-cetvel-html';

export type { OdemeSatiri, OdemeListesi, GonderimBilgisi } from './aylik-odeme-donem';

export type GonderimModu = 'gonderilmemis' | 'hepsi' | 'yeniden';

export interface OtomatikAyar {
  aktif: boolean;
  gun: number;
  saat: number;
  onayGerekli: boolean;
  sonKosu: { tarih: string; sonuc: string | null; gonderilen: number | null } | null;
}

export interface IstanbulAn {
  month: string; // "YYYY-MM"
  gun: number; // ayın günü
  saat: number; // 0-23
}

// Hattat ile birebir: "28.2.2026" (sıfırsız) — ekran ve eski akış bu biçimi bekler
function trDate(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}
function parseTutar(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? n : null;
}
function ayDogrula(month: string): { my: number; mm: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new BadRequestException('month "YYYY-MM" biçiminde olmalı');
  return { my: Number(m[1]), mm: Number(m[2]) };
}

/** İstanbul saatine göre şu an (ay anahtarı, ayın günü, saat). */
export function istanbulSimdi(d: Date = new Date()): IstanbulAn {
  const parcalar = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const al = (t: string) => parcalar.find((p) => p.type === t)?.value || '';
  return { month: `${al('year')}-${al('month')}`, gun: Number(al('day')), saat: Number(al('hour')) % 24 };
}

/** Sahibin WhatsApp numaraları (virgülle ayrılmış env). */
export function ownerTelefonlari(): string[] {
  return String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

let _logoCache: string | null | undefined;
/** Ofis logosu (apps/api/src/assets/moren-logo.png) — base64 data URI; yoksa null. */
export function morenLogoDataUri(): string | null {
  if (_logoCache !== undefined) return _logoCache;
  const adaylar = [
    join(__dirname, '..', 'assets', 'moren-logo.png'), // ts-node / jest (src/akilli-bildirim → src/assets)
    join(__dirname, '..', 'src', 'assets', 'moren-logo.png'), // webpack dist → apps/api/src/assets
    join(process.cwd(), 'src', 'assets', 'moren-logo.png'),
    join(process.cwd(), 'apps', 'api', 'src', 'assets', 'moren-logo.png'),
    process.env.MOREN_LOGO_PATH || '',
  ].filter(Boolean);
  for (const p of adaylar) {
    try {
      if (existsSync(p)) {
        _logoCache = `data:image/png;base64,${readFileSync(p).toString('base64')}`;
        return _logoCache;
      }
    } catch {
      /* sıradaki aday */
    }
  }
  _logoCache = null;
  return null;
}

interface HazirGrupMesaji {
  grup: CetvelGrup;
  satirlar: OdemeSatiri[];
  message: string;
  links: string[];
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; content: Buffer; contentType?: string }>;
  toplam: number;
}

@Injectable()
export class AylikOdemeService {
  private readonly logger = new Logger(AylikOdemeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
    private readonly shortLink: ShortLinkService,
    // "Bu mükellef bu dönem şu beyannameleri vermeli" hesabı TEK YERDE durur.
    // Mantığı kopyalamak yerine sahibini çağırıyoruz — repoda bu mantığın
    // sapmış bir kopyası zaten var (tool-executor.service.ts) ve ikisi
    // birbirini tutmuyor.
    private readonly beyannameTakip: BeyannameTakipService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * AYLIK TAKİP LİSTESİ ÜYELİĞİ — dört koşul.
   * `reminder.cron.ts:52-60` (takipPenceresi) ile birebir aynı kural; orası
   * private olduğu için buraya aynı koşullar yazıldı.
   *
   * İŞİ BIRAKMIŞ mükellefi eleyen alan `endDate`'tir, `isActive` DEĞİL.
   * endDate dolu olsa bile kayıt aktif kalabilir. Bu yüzden ikisi de şart:
   * `isActive` elle pasifleştirilenleri, `endDate` işi bırakanları eler.
   *
   * Pencere ÖDEME AYINA değil, TAKİP EDİLEN DÖNEME kurulur (Ağustos listesi
   * Temmuz dönemini takip eder). Temmuz'da işi bırakan mükellef Temmuz
   * beyannamesini/primini yine ödeyecektir — listede KALMALI.
   */
  private async takipUyeleri(tenantId: string, donemIlkGun: Date, donemSonGun: Date) {
    const uyeler = await (this.prisma as any).taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: donemSonGun } }] },
          { OR: [{ endDate: null }, { endDate: { gte: donemIlkGun } }] },
          // WHATSAPP-* kayıtlar gerçek mükellef değil, sanal sohbet kaydı
          { NOT: { taxNumber: { startsWith: 'WHATSAPP-' } } },
        ],
      },
      select: { id: true, companyName: true, firstName: true, lastName: true },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });
    return new Map<string, string>(
      uyeler.map((t: any) => [
        t.id,
        t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.id,
      ]),
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // LİSTE
  // ───────────────────────────────────────────────────────────────────────

  /**
   * month: ÖDEME AYI ('YYYY-MM'). Hangi dönemlerin bu aya düştüğü `odemeAyiDonemleri`'nde
   * (aylık: M-1; geçici vergi çeyreği: Şubat/Mayıs/Ağustos/Kasım; üç aylık diğerleri: Ocak/Nisan/
   * Temmuz/Ekim; yıllık GELIR Mart 1. taksit + Temmuz 2. taksit, KURUMLAR Nisan).
   * Son günler hafta sonu/resmî tatilden ilk iş gününe kaydırılır (`sonGunHam` ham günü tutar).
   * taxpayerId verilirse tek mükellef.
   */
  async list(tenantId: string, month: string, taxpayerId?: string): Promise<OdemeListesi[]> {
    const { my, mm } = ayDogrula(month);
    const secimler = odemeAyiDonemleri(month);
    const aylikDonem = secimler[0].donem;
    const sgkPeriod = aylikDonem.replace('-', '/');
    const map = new Map<string, OdemeListesi>();

    const ensure = (tp: any): OdemeListesi => {
      let row = map.get(tp.id);
      if (!row) {
        row = {
          taxpayerId: tp.id,
          unvan: (tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`.trim() || 'Mükellef').toString(),
          phone: tp.phone || (tp.phones && tp.phones[0]) || null,
          email: tp.email || (tp.emails && tp.emails[0]) || null,
          satirlar: [],
          toplam: 0,
          gonderim: { VERGI: null, SGK: null },
        };
        map.set(tp.id, row);
      }
      return row;
    };
    const gunler = (ham: Date | null) => {
      if (!ham || Number.isNaN(ham.getTime())) return { sonGun: null, sonGunHam: null, sonGunIso: null };
      const kaydirilmis = ilkIsGunu(ham);
      return { sonGun: trDate(kaydirilmis), sonGunHam: trDate(ham), sonGunIso: isoGun(kaydirilmis) };
    };

    // Vergi tahakkukları — bu aya düşen tüm dönem anahtarları tek sorguda
    const beyanlar = await (this.prisma as any).beyanKaydi.findMany({
      where: {
        tenantId,
        donem: { in: Array.from(new Set(secimler.map((s) => s.donem))) },
        tahakkukTutari: { not: null },
        ...(taxpayerId ? { taxpayerId } : {}),
      },
      include: { taxpayer: true },
      take: 5000,
    });
    for (const b of beyanlar) {
      if (!b.taxpayer) continue;
      const secim = kaydinSecimi(secimler, b.beyanTipi, b.donem);
      if (!secim) continue;
      const tahakkuk = Number(b.tahakkukTutari);
      if (!Number.isFinite(tahakkuk) || tahakkuk === 0) continue;
      // Yıllık GELIR: taksit tutarı (damga 1. taksitle; `odemeTutari` canlıda hiç dolu değil → tahakkuktan)
      const tutar = secim.taksit ? gelirTaksitTutari(tahakkuk, beyanYili(b.donem) || my, secim.taksit) : tahakkuk;
      if (tutar <= 0) continue;
      const row = ensure(b.taxpayer);
      row.satirlar.push({
        tur: b.beyanTipi,
        turAd: turAdi(b.beyanTipi, b.donem, secim.taksit),
        kaynak: 'VERGI',
        grup: secim.grup,
        donem: b.donem,
        ...gunler(hamSonGun(b.beyanTipi, b.donem, month)),
        taksit: secim.taksit || null,
        tutar,
        storageKey: b.pdfUrl || b.beyannameUrl || null,
      });
      row.toplam += tutar;
    }

    // SGK tahakkuk fişleri — son ödeme = ödeme ayının son günü (iş gününe kaydırılır)
    const sgkDocs = await (this.prisma as any).portalDocument.findMany({
      where: {
        tenantId,
        belgeTuru: 'SGK_TAHAKKUK',
        ...(taxpayerId ? { taxpayerId } : {}),
        OR: [{ period: sgkPeriod }, { period: aylikDonem }],
      },
      include: { taxpayer: true },
      take: 5000,
    });
    for (const d of sgkDocs) {
      if (!d.taxpayer) continue;
      const raw = (d.raw || {}) as Record<string, any>;
      const tutar = parseTutar(raw.tutar);
      if (tutar == null) continue;
      const row = ensure(d.taxpayer);
      row.satirlar.push({
        tur: (d.title || 'Tahakkuk Fişi').replace(/^SGK\s+/i, ''),
        turAd: SGK_TUR_AD,
        kaynak: 'SGK',
        grup: 'SGK',
        donem: d.period || sgkPeriod,
        ...gunler(new Date(my, mm, 0, 23, 59, 59)),
        taksit: null,
        tutar,
        storageKey: d.storageKey || null,
      });
      row.toplam += tutar;
    }

    const rows = [...map.values()].filter((r) => r.satirlar.length > 0);
    for (const r of rows) r.toplam = Math.round(r.toplam * 100) / 100;

    // Gönderim durumu (documentDispatch, ODEME_LISTESI, donem = ödeme ayı)
    if (rows.length) {
      const durum = await this.gonderimHaritasi(tenantId, month, taxpayerId);
      for (const r of rows) {
        const g = durum.get(r.taxpayerId);
        if (g) r.gonderim = g;
      }
    }
    return rows.sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr'));
  }

  /** Mükellef → { VERGI, SGK } gönderim özeti. Test gönderimleri de görünür, `test:true` işaretli. */
  private async gonderimHaritasi(tenantId: string, month: string, taxpayerId?: string) {
    const kayitlar: any[] = await (this.prisma as any).documentDispatch
      .findMany({
        where: { tenantId, kategori: 'ODEME_LISTESI', donem: month, ...(taxpayerId ? { taxpayerId } : {}) },
        select: { taxpayerId: true, channel: true, status: true, testMode: true, sentAt: true, dedupeKey: true },
        take: 10000,
      })
      .catch(() => []);
    const grupla = new Map<string, Map<CetvelGrup, any[]>>();
    for (const k of kayitlar) {
      const grup = String(k.dedupeKey || '').split(':')[3] as CetvelGrup | undefined;
      if (grup !== 'VERGI' && grup !== 'SGK') continue; // eski biçim (grup eki yok) sayılmaz
      if (!grupla.has(k.taxpayerId)) grupla.set(k.taxpayerId, new Map());
      const g = grupla.get(k.taxpayerId)!;
      if (!g.has(grup)) g.set(grup, []);
      g.get(grup)!.push(k);
    }
    const ozetle = (rows: any[]): GonderimBilgisi => {
      const gercek = rows.filter((r) => r.status === 'SENT' && !r.testMode);
      const test = rows.filter((r) => r.status === 'SENT' && r.testMode);
      const secili = gercek.length ? gercek : test;
      if (secili.length) {
        const sonTarih = secili.reduce((a: Date | null, r) => (r.sentAt && (!a || r.sentAt > a) ? r.sentAt : a), null);
        return {
          status: 'SENT',
          sentAt: sonTarih ? new Date(sonTarih).toISOString() : null,
          kanallar: Array.from(new Set(secili.map((r) => String(r.channel)))),
          test: !gercek.length,
        };
      }
      return { status: 'FAILED', sentAt: null, kanallar: [], test: rows.every((r) => !!r.testMode) };
    };
    const sonuc = new Map<string, { VERGI: GonderimBilgisi | null; SGK: GonderimBilgisi | null }>();
    for (const [tid, g] of grupla) {
      sonuc.set(tid, {
        VERGI: g.has('VERGI') ? ozetle(g.get('VERGI')!) : null,
        SGK: g.has('SGK') ? ozetle(g.get('SGK')!) : null,
      });
    }
    return sonuc;
  }

  // ───────────────────────────────────────────────────────────────────────
  // EKSİKLER (değişmedi — yalnız okur)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * LİSTEDE NEDEN YOK — ödeme listesine girmeyen mükellefler ve sebepleri.
   *
   * İKİ KURAL:
   *  1. AYLIK TAKİP LİSTESİNDE OLMAYAN MÜKELLEF BURAYA YAZILMAZ. Önceki hâli
   *     hiç süzmüyordu; işi bırakmış mükellefin ESKİ SGK fişi yüzünden o
   *     mükellef her ay "eksik" olarak görünüyordu. Kök neden şuydu: geçmiş
   *     SGK taraması DÖNEM SINIRSIZDI — kapanmış mükellefin yıllar önceki
   *     fişi bile "bu dönem fişi yok" satırı üretiyordu.
   *  2. Sadece SGK değil, VERİLMEMİŞ BEYANNAMELER de yazılır. Verilmemiş
   *     beyannamenin tahakkuku da olmaz, dolayısıyla ödeme listesine de
   *     yansımaz — kullanıcının göremediği ikinci grup buydu.
   *
   * Beklenen beyanname listesi BeyannameTakipService'ten gelir. O servis
   * mükellefin dönem tercihlerini (TaxpayerBeyanConfig), vergi döneminde
   * aktif olup olmadığını, 3 aylık/yıllık takvimi ve "SGK tahakkuk fişi
   * geldiyse bildirge verilmiş sayılır" kuralını zaten uyguluyor.
   *
   * Yalnız OKUR. `list()` ve mesaj üretimi etkilenmez.
   */
  async eksikler(tenantId: string, month: string) {
    const [my, mm] = month.split('-').map(Number);
    const prev = new Date(my, mm - 2, 1);
    const donem = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const sgkPeriod = donem.replace('-', '/');
    const donemIlkGun = new Date(prev.getFullYear(), prev.getMonth(), 1);
    const donemSonGun = new Date(prev.getFullYear(), prev.getMonth() + 1, 0, 23, 59, 59);

    const uyeAdi = await this.takipUyeleri(tenantId, donemIlkGun, donemSonGun);

    const [sgkDocs, beyanTutarsiz, beyanDetay, listeSatirlari] = await Promise.all([
      // Bu döneme ait SGK fişleri — tutarı okunamayanları görmek için
      (this.prisma as any).portalDocument.findMany({
        where: {
          tenantId,
          belgeTuru: 'SGK_TAHAKKUK',
          OR: [{ period: sgkPeriod }, { period: donem }],
        },
        select: { taxpayerId: true, raw: true },
        take: 5000,
      }),
      // Beyanname kaydı var ama tahakkuk tutarı okunmamış → satır üretilemiyor
      (this.prisma as any).beyanKaydi.findMany({
        where: { tenantId, donem, tahakkukTutari: null },
        select: { taxpayerId: true, beyanTipi: true },
        take: 5000,
      }),
      // `month` = VERİLME ayı. Ödeme ayı ile aynıdır (Ağustos'ta Temmuz
      // beyannamesi verilir ve ödenir).
      this.beyannameTakip.listDonemDetay(tenantId, month, 'VERILME'),
      // Mükellef listede zaten var mı — "listede görünmeyen" başlığı
      // altında listede OLAN mükellefi göstermemek için
      this.list(tenantId, month),
    ]);

    const listedeVar = new Set<string>(listeSatirlari.map((r: any) => r.taxpayerId));
    const eksik: Array<{
      taxpayerId: string;
      unvan: string;
      kaynak: 'VERGI' | 'SGK';
      sebep: string;
      beyanTipi?: string;
      donem?: string;
      listedeVar: boolean;
    }> = [];
    const gorulen = new Set<string>();

    const ekle = (
      taxpayerId: string,
      kaynak: 'VERGI' | 'SGK',
      sebep: string,
      ek?: { beyanTipi?: string; donem?: string },
    ) => {
      const unvan = uyeAdi.get(taxpayerId);
      if (!unvan) return; // AYLIK TAKİP LİSTESİ KAPISI — üye değilse yazılmaz
      const anahtar = `${taxpayerId}|${kaynak}|${ek?.beyanTipi || ''}|${sebep}`;
      if (gorulen.has(anahtar)) return; // aynı sebep iki kez sayılmasın
      gorulen.add(anahtar);
      eksik.push({ taxpayerId, unvan, kaynak, sebep, ...ek, listedeVar: listedeVar.has(taxpayerId) });
    };

    // 1) SGK fişi var ama tutar okunamıyor / sıfır → satır sessizce düşüyordu
    for (const d of sgkDocs) {
      if (!d.taxpayerId) continue;
      if (parseTutar((d.raw as any)?.tutar) != null) continue;
      const ham = (d.raw as any)?.tutar;
      ekle(
        d.taxpayerId,
        'SGK',
        ham == null ? 'SGK fişinde tutar alanı yok' : `SGK tahakkuku ${String(ham)} — ödenecek tutar yok`,
        { donem: sgkPeriod },
      );
    }

    // 2) VERİLMEMİŞ BEYANNAMELER — beklenen ama 'kalan' durumda olanlar.
    //    BILDIRGE burada SGK tarafını da kapsar: o döneme ait SGK tahakkuk
    //    fişi geldiyse BeyannameTakipService bunu 'onaylandi' sayar, gelmediyse
    //    'kalan' bırakır. Eski "geçmişte SGK'sı vardı" kuralının yerini bu alır
    //    ve kapanmış mükellef üretmez.
    for (const row of beyanDetay as any[]) {
      for (const b of row.beyanlar || []) {
        if (b.durum !== 'kalan') continue;
        ekle(
          row.taxpayerId,
          b.beyanTipi === 'BILDIRGE' ? 'SGK' : 'VERGI',
          b.beyanTipi === 'BILDIRGE'
            ? 'SGK bildirgesi verilmemiş — tahakkuk fişi de yok'
            : 'beyanname verilmemiş',
          { beyanTipi: b.beyanTipi, donem: b.vergiDonem },
        );
      }
    }

    // 3) Beyanname verilmiş ama tahakkuk tutarı okunmamış
    for (const b of beyanTutarsiz) {
      if (!b.taxpayerId) continue;
      ekle(b.taxpayerId, 'VERGI', 'tahakkuk tutarı okunmamış', { beyanTipi: b.beyanTipi, donem });
    }

    // 4) Mükellefiyet/dönem bilgisi hiç girilmemiş olanlar sessizce kaybolur:
    //    beklenen beyanname üretilemediği için 2. maddede hiç görünmezler.
    const detayliIdler = new Set((beyanDetay as any[]).map((r) => r.taxpayerId));
    for (const [id] of uyeAdi) {
      if (detayliIdler.has(id)) continue;
      ekle(id, 'VERGI', 'mükellefiyet/dönem bilgisi girilmemiş — beklenen beyanname üretilemiyor');
    }

    return {
      month,
      donem,
      sgkDonemi: sgkPeriod,
      takipUyeSayisi: uyeAdi.size,
      eksik: eksik.sort(
        (a, b) => a.unvan.localeCompare(b.unvan, 'tr') || a.kaynak.localeCompare(b.kaynak),
      ),
    };
  }

  /** Eksikler hızlı düzeltme: "bu mükellefin SGK bildirgesi yok" → beklenti kapatılır. */
  async sgkYok(tenantId: string, taxpayerId: string) {
    if (!taxpayerId) throw new BadRequestException('taxpayerId zorunlu');
    await this.beyannameTakip.upsertConfig(tenantId, taxpayerId, { sgkBildirgeEnabled: false });
    // BeyannameTakipService: aktif SGK e-Bildirge kimliği olan mükellefte bayrak yine TRUE sayılır
    // (effectiveBeyanConfig). Kullanıcı bunu bilsin diye uyarı döner; kayıt yine de yazıldı.
    const kimlik = await (this.prisma as any).portalCredential
      .findFirst({ where: { tenantId, taxpayerId, provider: 'SGK_EBILDIRGE', isActive: true }, select: { id: true } })
      .catch(() => null);
    return {
      ok: true,
      ...(kimlik
        ? { uyari: 'Mükellefin aktif SGK e-Bildirge kimliği var; kimlik pasif edilmedikçe beklenti listesinde görünmeye devam edebilir.' }
        : {}),
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // MESAJ + GÖNDERİM
  // ───────────────────────────────────────────────────────────────────────

  /** Cetvel mesajı (WhatsApp) — vergi ve SGK ayrı; saf üretim `aylik-odeme-metin.ts`'de. */
  composeMessage(month: string, senderName: string, unvan: string, grup: CetvelGrup, satirlar: OdemeSatiri[], links: string[] = [], onEk?: string | null): string {
    return odemeCetveliMesaji({ month, unvan, grup, satirlar, linkler: links, senderName, onEk });
  }

  private async vergiAyari(tenantId: string) {
    return (this.prisma as any).smartDispatchSetting
      .findUnique({ where: { tenantId_kategori: { tenantId, kategori: 'VERGI' } } })
      .catch(() => null);
  }

  private gruplar(row: OdemeListesi): Array<{ grup: CetvelGrup; satirlar: OdemeSatiri[] }> {
    return (['VERGI', 'SGK'] as CetvelGrup[])
      .map((grup) => ({ grup, satirlar: row.satirlar.filter((s) => s.kaynak === grup) }))
      .filter((g) => g.satirlar.length > 0);
  }

  /** Bir mükellefin bir grubu için mesaj + belge linki + e-posta gövdesi/ekleri (belgeler TEK PDF'te birleşir). */
  private async hazirlaGrupMesaji(
    tenantId: string,
    month: string,
    row: OdemeListesi,
    grup: CetvelGrup,
    satirlar: OdemeSatiri[],
    senderName: string,
    onEk?: string | null,
  ): Promise<HazirGrupMesaji> {
    const bufs: Buffer[] = [];
    for (const s of satirlar) {
      if (!s.storageKey) continue;
      try {
        bufs.push(await this.storage.getBuffer(s.storageKey));
      } catch (e: any) {
        this.logger.warn(`belge okunamadı ${s.tur} ${s.donem}: ${e?.message}`);
      }
    }
    const merged = await mergePdfBuffers(bufs, this.logger);
    const mergedName = `${grup === 'SGK' ? 'SGK' : 'Vergi'}-Odeme-Cetveli-${month}.pdf`;
    let links: string[] = [];
    let attachments: HazirGrupMesaji['attachments'] = [];
    if (merged) {
      const key = `${tenantId}/${row.taxpayerId}/bildirim/ODEME_${grup}_${randomUUID()}.pdf`;
      await this.storage.putBuffer(key, merged, 'application/pdf');
      links = [await this.shortLink.create(tenantId, key, mergedName)];
      attachments = [{ filename: mergedName, content: merged, contentType: 'application/pdf' }];
    } else {
      for (const s of satirlar) {
        if (!s.storageKey) continue;
        try {
          links.push(await this.shortLink.create(tenantId, s.storageKey, `${s.tur}-${s.donem}.pdf`));
        } catch (e: any) {
          this.logger.warn(`link üretilemedi ${s.tur} ${s.donem}: ${e?.message}`);
        }
      }
    }
    const girdi = { month, unvan: row.unvan, grup, satirlar, linkler: links, senderName, onEk };
    const message = odemeCetveliMesaji(girdi);
    const eposta = odemeCetveliEposta(girdi);
    return {
      grup,
      satirlar,
      message,
      links,
      subject: eposta.subject,
      text: eposta.text,
      html: eposta.html,
      attachments,
      toplam: satirlar.reduce((a, s) => a + s.tutar, 0),
    };
  }

  /**
   * Cetvel gönderimi. mod:
   *   'gonderilmemis' (varsayılan) — daha önce GERÇEK (test olmayan) SENT olan kanal atlanır;
   *   'hepsi'   — hepsine yeniden gider;
   *   'yeniden' — tek mükellef için zorla (taxpayerId şart).
   * Test modu (VERGI ayarı) açıkken alıcı test telefonu/e-postasıdır; kayıt testMode=true yazılır.
   */
  async send(tenantId: string, month: string, taxpayerId?: string, mod: GonderimModu = 'gonderilmemis') {
    ayDogrula(month);
    if (!['gonderilmemis', 'hepsi', 'yeniden'].includes(mod)) throw new BadRequestException('mod: gonderilmemis | hepsi | yeniden');
    if (mod === 'yeniden' && !taxpayerId) throw new BadRequestException("'yeniden' modu tek mükellef ister (taxpayerId)");
    const settings = await this.vergiAyari(tenantId);
    const testMode = settings?.testMode ?? true;
    const senderName = (settings?.senderName || DEFAULT_SENDER).toString();

    const rows = await this.list(tenantId, month, taxpayerId);
    const results: any[] = [];
    let atlanan = 0;
    for (const row of rows) {
      const targetPhone = testMode ? settings?.testPhone : row.phone;
      const targetEmail = testMode ? settings?.testEmail : row.email;

      for (const g of this.gruplar(row)) {
        const onceki = row.gonderim?.[g.grup] || null;
        const kanallar = (['WHATSAPP', 'EMAIL'] as const).filter((channel) => {
          if (channel === 'WHATSAPP' && settings && !settings.whatsapp) return false;
          if (channel === 'EMAIL' && settings && !settings.email) return false;
          return true;
        });
        // Daha önce gerçekten iletilmiş kanal, 'gonderilmemis' modunda bir daha gitmez
        const gidecek = kanallar.filter((channel) => {
          if (mod !== 'gonderilmemis') return true;
          const zatenGitti = !!onceki && onceki.status === 'SENT' && !onceki.test && onceki.kanallar.includes(channel);
          if (zatenGitti) atlanan++;
          return !zatenGitti;
        });
        if (!gidecek.length) continue;

        const hazir = await this.hazirlaGrupMesaji(tenantId, month, row, g.grup, g.satirlar, senderName);
        const dedupeKey = `ODEME:${row.taxpayerId}:${month}:${g.grup}`;

        for (const channel of gidecek) {
          let status = 'FAILED';
          let error: string | null = null;
          try {
            if (channel === 'WHATSAPP') {
              if (!targetPhone) throw new Error(testMode ? 'test telefonu girilmemiş' : 'mükellefin telefon numarası yok');
              const sent = await this.whatsapp.sendMessageDetailed(targetPhone, hazir.message, tenantId, { quote: false } as any);
              if (!(sent as any)?.ok) throw new Error((sent as any)?.error || 'whatsapp gönderilemedi');
              status = 'SENT';
            } else {
              if (!targetEmail) throw new Error(testMode ? 'test e-postası girilmemiş' : 'mükellefin e-postası yok');
              const res = await this.email.send(
                { to: targetEmail, subject: hazir.subject, text: hazir.text, html: hazir.html, attachments: hazir.attachments },
                tenantId,
              );
              if (!res.sent) throw new Error('e-posta gönderilemedi');
              status = 'SENT';
            }
          } catch (e: any) {
            error = e?.message || String(e);
          }
          await (this.prisma as any).documentDispatch.upsert({
            where: { tenantId_dedupeKey_channel: { tenantId, dedupeKey, channel } },
            create: {
              tenantId,
              taxpayerId: row.taxpayerId,
              kategori: 'ODEME_LISTESI',
              donem: month,
              channel,
              status,
              error,
              itemCount: g.satirlar.length,
              totalAmount: hazir.toplam,
              docRefs: null,
              dedupeKey,
              testMode: !!testMode,
              sentAt: status === 'SENT' ? new Date() : null,
            },
            update: { status, error, sentAt: status === 'SENT' ? new Date() : null, testMode: !!testMode },
          });
          results.push({ taxpayerId: row.taxpayerId, unvan: row.unvan, grup: g.grup, channel, status, error });
        }
      }
    }
    return { ok: true, month, testMode, mod, count: results.length, atlanan, results };
  }

  /**
   * ÖRNEK GÖNDERİM — seçilen (yoksa hem vergi hem SGK kalemi olan ilk) mükellefin GERÇEK cetvel
   * mesajları YALNIZ sahibin numaralarına gider. Başına "(ÖRNEK · ad)" konur; documentDispatch'e
   * YAZILMAZ; mükellefe/test numarasına GİTMEZ. PDF kısa linki gerçektir.
   */
  async ornekGonder(tenantId: string, month: string, taxpayerId?: string) {
    ayDogrula(month);
    const telefonlar = ownerTelefonlari();
    if (!telefonlar.length) throw new BadRequestException('Sahip numarası tanımlı değil (MOREN_OWNER_WHATSAPP_PHONES)');
    const rows = await this.list(tenantId, month, taxpayerId);
    const row = taxpayerId
      ? rows[0]
      : rows.find((r) => r.satirlar.some((s) => s.kaynak === 'VERGI') && r.satirlar.some((s) => s.kaynak === 'SGK')) || rows[0];
    if (!row) throw new NotFoundException('Bu ay için ödeme kalemi olan mükellef bulunamadı');
    const settings = await this.vergiAyari(tenantId);
    const senderName = (settings?.senderName || DEFAULT_SENDER).toString();

    const mesajlar: string[] = [];
    for (const g of this.gruplar(row)) {
      const hazir = await this.hazirlaGrupMesaji(tenantId, month, row, g.grup, g.satirlar, senderName, `(ÖRNEK · ${row.unvan})`);
      mesajlar.push(hazir.message);
    }
    const gonderimler: Array<{ telefon: string; ok: boolean; error?: string | null }> = [];
    for (const tel of telefonlar) {
      for (const m of mesajlar) {
        try {
          const r: any = await this.whatsapp.sendMessageDetailed(tel, m, tenantId, { quote: false } as any);
          gonderimler.push({ telefon: tel, ok: !!r?.ok, error: r?.ok ? null : r?.error || 'gönderilemedi' });
        } catch (e: any) {
          gonderimler.push({ telefon: tel, ok: false, error: e?.message || String(e) });
        }
      }
    }
    return { ok: gonderimler.length > 0 && gonderimler.every((g) => g.ok), taxpayerId: row.taxpayerId, unvan: row.unvan, telefonlar, mesajlar, gonderimler };
  }

  // ───────────────────────────────────────────────────────────────────────
  // ÖZET
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Toplamlar bir BÖLÜMLEMEDİR: vergiToplam (AYLIK grup: KDV/Muhtasar/Damga… dönemsel beyannameler)
   * + sgkToplam + geciciToplam + yillikToplam = toplam.
   * gonderilen/bekleyen/hatali MÜKELLEF sayısıdır (gonderilen + bekleyen + hatali = mukellef);
   * test gönderimi "gönderildi" SAYILMAZ.
   */
  async ozet(tenantId: string, month: string) {
    ayDogrula(month);
    const [rows, ayar, otomatik] = await Promise.all([this.list(tenantId, month), this.vergiAyari(tenantId), this.otomatikAyar(tenantId)]);
    const t = { AYLIK: 0, GECICI: 0, YILLIK: 0, SGK: 0 } as Record<string, number>;
    let kalem = 0;
    let gonderilen = 0;
    let hatali = 0;
    const bugun = isoGun(new Date());
    let enYakin: { tarih: string; turAd: string } | null = null;
    for (const r of rows) {
      for (const s of r.satirlar) {
        kalem++;
        t[s.grup] = (t[s.grup] || 0) + s.tutar;
        if (s.sonGunIso && s.sonGunIso >= bugun && (!enYakin || s.sonGunIso < enYakin.tarih)) {
          enYakin = { tarih: s.sonGunIso, turAd: s.turAd || s.tur };
        }
      }
      const gruplar = this.gruplar(r).map((g) => r.gonderim?.[g.grup] || null);
      if (gruplar.length && gruplar.every((g) => g && g.status === 'SENT' && !g.test)) gonderilen++;
      else if (gruplar.some((g) => g && g.status === 'FAILED')) hatali++;
    }
    const yuvarla = (n: number) => Math.round(n * 100) / 100;
    const toplam = yuvarla(t.AYLIK + t.GECICI + t.YILLIK + t.SGK);
    return {
      month,
      mukellef: rows.length,
      kalem,
      vergiToplam: yuvarla(t.AYLIK),
      sgkToplam: yuvarla(t.SGK),
      geciciToplam: yuvarla(t.GECICI),
      yillikToplam: yuvarla(t.YILLIK),
      toplam,
      gonderilen,
      bekleyen: rows.length - gonderilen - hatali,
      hatali,
      enYakinSonGun: enYakin,
      testMode: ayar?.testMode ?? true,
      testPhone: ayar?.testPhone || null,
      testEmail: ayar?.testEmail || null,
      kanallar: { whatsapp: ayar?.whatsapp ?? true, email: ayar?.email ?? true },
      otomatik,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // EXCEL / PDF
  // ───────────────────────────────────────────────────────────────────────

  private gonderimMetni(g: GonderimBilgisi | null): string {
    if (!g) return 'Gönderilmedi';
    const kanal = g.kanallar.map((k) => (k === 'WHATSAPP' ? 'WhatsApp' : k === 'EMAIL' ? 'E-posta' : k)).join(', ');
    if (g.status === 'SENT' && g.test) return `Test gönderimi${kanal ? ` (${kanal})` : ''}`;
    if (g.status === 'SENT') return `Gönderildi${g.sentAt ? ' ' + new Date(g.sentAt).toLocaleDateString('tr-TR') : ''}${kanal ? ` (${kanal})` : ''}`;
    return 'Hatalı';
  }

  async excel(tenantId: string, month: string): Promise<Buffer> {
    ayDogrula(month);
    const rows = await this.list(tenantId, month);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Portal';
    wb.created = new Date();

    const baslikStili = (ws: ExcelJS.Worksheet) => {
      const h = ws.getRow(1);
      h.font = { bold: true };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4EFE3' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };

    const ws = wb.addWorksheet('Ödeme Listesi');
    ws.columns = [
      { header: 'Mükellef', key: 'mukellef', width: 42 },
      { header: 'Ödeme', key: 'odeme', width: 40 },
      { header: 'Grup', key: 'grup', width: 10 },
      { header: 'Dönem', key: 'donem', width: 22 },
      { header: 'Son Ödeme', key: 'sonOdeme', width: 14, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Tutar', key: 'tutar', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Gönderim', key: 'gonderim', width: 30 },
    ];
    baslikStili(ws);
    let genel = 0;
    for (const r of rows) {
      for (const s of r.satirlar) {
        const iso = s.sonGunIso;
        ws.addRow({
          mukellef: r.unvan,
          odeme: (s.kaynak === 'SGK' ? SGK_TUR_AD : s.turAd || s.tur) + (s.taksit ? ` (${s.taksit})` : ''),
          grup: s.grup,
          donem: donemEtiketi(s.donem),
          // ExcelJS tarihi UTC'ye göre yazar → yerel gece yarısı bir gün geri kayardı; UTC gece yarısı ver
          sonOdeme: iso ? new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))) : null,
          tutar: s.tutar,
          gonderim: this.gonderimMetni(r.gonderim?.[s.kaynak] || null),
        });
        genel += s.tutar;
      }
    }
    const altToplam = ws.addRow({ mukellef: 'TOPLAM', tutar: Math.round(genel * 100) / 100 });
    altToplam.font = { bold: true };

    const oz = wb.addWorksheet('Özet');
    oz.columns = [
      { header: 'Mükellef', key: 'mukellef', width: 42 },
      { header: 'Kalem', key: 'kalem', width: 8 },
      { header: 'Vergi', key: 'vergi', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'SGK', key: 'sgk', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Toplam', key: 'toplam', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Vergi Gönderimi', key: 'gVergi', width: 28 },
      { header: 'SGK Gönderimi', key: 'gSgk', width: 28 },
    ];
    baslikStili(oz);
    const oTop = { vergi: 0, sgk: 0, toplam: 0 };
    for (const r of rows) {
      const vergi = r.satirlar.filter((s) => s.kaynak === 'VERGI').reduce((a, s) => a + s.tutar, 0);
      const sgk = r.satirlar.filter((s) => s.kaynak === 'SGK').reduce((a, s) => a + s.tutar, 0);
      oz.addRow({
        mukellef: r.unvan,
        kalem: r.satirlar.length,
        vergi: Math.round(vergi * 100) / 100,
        sgk: Math.round(sgk * 100) / 100,
        toplam: r.toplam,
        gVergi: vergi ? this.gonderimMetni(r.gonderim?.VERGI || null) : '—',
        gSgk: sgk ? this.gonderimMetni(r.gonderim?.SGK || null) : '—',
      });
      oTop.vergi += vergi;
      oTop.sgk += sgk;
      oTop.toplam += r.toplam;
    }
    const ozToplam = oz.addRow({
      mukellef: 'TOPLAM',
      kalem: rows.reduce((a, r) => a + r.satirlar.length, 0),
      vergi: Math.round(oTop.vergi * 100) / 100,
      sgk: Math.round(oTop.sgk * 100) / 100,
      toplam: Math.round(oTop.toplam * 100) / 100,
    });
    ozToplam.font = { bold: true };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Cetvel HTML'i (PDF'e girmeden önce de bakılabilsin diye ayrı). */
  async cetvelHtml(tenantId: string, month: string, taxpayerId?: string): Promise<{ html: string; adet: number }> {
    ayDogrula(month);
    const rows = await this.list(tenantId, month, taxpayerId);
    if (taxpayerId && !rows.length) throw new NotFoundException('Bu mükellefin bu ay ödeme kalemi yok');
    const ayar = await this.vergiAyari(tenantId);
    const senderName = (ayar?.senderName || DEFAULT_SENDER).toString();
    // Üst şeritte ofis iletişimi (tenant telefon · e-posta · adres) — boşsa satır çıkmaz
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId }, select: { phone: true, email: true, address: true } }).catch(() => null);
    const ofisIletisim = [tenant?.phone, tenant?.email, tenant?.address].map((x: any) => String(x || '').trim()).filter(Boolean).join(' · ') || null;
    return { html: cetvelHtml({ month, senderName, logoDataUri: morenLogoDataUri(), ofisIletisim, mukellefler: rows }), adet: rows.length };
  }

  /** A4 cetvel PDF'i (Playwright Chromium). Chromium yoksa 503 + anlaşılır mesaj. */
  async pdf(tenantId: string, month: string, taxpayerId?: string): Promise<Buffer> {
    const { html } = await this.cetvelHtml(tenantId, month, taxpayerId);
    let browser: any;
    try {
      browser = await chromium.launch({
        headless: true,
        // playwright-core kendi Chromium'unu indirmez — imajdaki sistem Chromium'u kullan
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    } catch (e: any) {
      this.logger.error(`Cetvel PDF: Chromium açılamadı: ${e?.message}`);
      throw new ServiceUnavailableException(
        'PDF üretimi için Chromium bulunamadı. Sunucuda imaj Chromium içerir; yerel geliştirmede PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (veya CHROMIUM_PATH) tanımlayın.',
      );
    }
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      return Buffer.from(
        await page.pdf({ format: 'A4', margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }, printBackground: true }),
      );
    } catch (e: any) {
      this.logger.error(`Cetvel PDF üretilemedi: ${e?.message}`);
      throw new BadRequestException(`Cetvel PDF üretilemedi: ${e?.message || e}`);
    } finally {
      try { if (browser) await browser.close(); } catch { /* kapanmadıysa geç */ }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // OTOMATİK GÖNDERİM AYARI + KOŞU
  // ───────────────────────────────────────────────────────────────────────

  private otomatikAyarSatiri(row: any): OtomatikAyar {
    const r = row?.lastRunResult && typeof row.lastRunResult === 'object' ? row.lastRunResult : null;
    return {
      aktif: !!row?.enabled,
      gun: Number(row?.sendDay) || 1,
      saat: row?.sendHour == null ? 10 : Number(row.sendHour),
      onayGerekli: row?.onayGerekli ?? true,
      sonKosu: row?.lastRunAt
        ? { tarih: new Date(row.lastRunAt).toISOString(), sonuc: r?.sonuc ?? null, gonderilen: r?.gonderilen ?? null }
        : null,
    };
  }

  /** ODEME_LISTESI ayar satırı — yoksa VERGI satırının test/kanal değerleriyle KAPALI oluşturulur. */
  private async otomatikSatir(tenantId: string) {
    const ayar = (this.prisma as any).smartDispatchSetting;
    let row = await ayar.findUnique({ where: { tenantId_kategori: { tenantId, kategori: 'ODEME_LISTESI' } } });
    if (!row) {
      const vergi = await this.vergiAyari(tenantId);
      row = await ayar.create({
        data: {
          tenantId,
          kategori: 'ODEME_LISTESI',
          enabled: false,
          sendDay: null,
          sendHour: 10,
          onayGerekli: true,
          testMode: vergi?.testMode ?? true,
          testPhone: vergi?.testPhone ?? null,
          testEmail: vergi?.testEmail ?? null,
          whatsapp: vergi?.whatsapp ?? true,
          email: vergi?.email ?? true,
          senderName: vergi?.senderName ?? null,
        },
      });
    }
    return row;
  }

  async otomatikAyar(tenantId: string): Promise<OtomatikAyar> {
    return this.otomatikAyarSatiri(await this.otomatikSatir(tenantId));
  }

  async otomatikKaydet(tenantId: string, body: { aktif?: boolean; gun?: number; saat?: number; onayGerekli?: boolean }): Promise<OtomatikAyar> {
    const gun = Number(body?.gun);
    const saat = Number(body?.saat);
    if (!Number.isInteger(gun) || gun < 1 || gun > 28) throw new BadRequestException('gun 1-28 arasında olmalı');
    if (!Number.isInteger(saat) || saat < 0 || saat > 23) throw new BadRequestException('saat 0-23 arasında olmalı');
    await this.otomatikSatir(tenantId);
    const row = await (this.prisma as any).smartDispatchSetting.update({
      where: { tenantId_kategori: { tenantId, kategori: 'ODEME_LISTESI' } },
      data: { enabled: !!body?.aktif, sendDay: gun, sendHour: saat, onayGerekli: body?.onayGerekli !== false },
    });
    return this.otomatikAyarSatiri(row);
  }

  /**
   * Saat başı cron buradan girer: aktif && bugün == gun && saat == sendHour && bu ay koşulmamışsa koşar.
   * Döndürdüğü null = "bu saatte iş yok".
   */
  async otomatikTetikle(tenantId: string, simdi: IstanbulAn = istanbulSimdi()) {
    const row = await this.otomatikSatir(tenantId);
    if (!row.enabled || !row.sendDay) return null;
    if (Number(row.sendDay) !== simdi.gun || Number(row.sendHour) !== simdi.saat) return null;
    if (row.lastRunAt && istanbulSimdi(new Date(row.lastRunAt)).month === simdi.month) return null;
    return this.otomatikKosu(tenantId, simdi.month, !!row.onayGerekli);
  }

  /** Koşu: onay gerekiyorsa sahibe WhatsApp + portal bildirimi; değilse gönderilmemişlere gönder. */
  async otomatikKosu(tenantId: string, month: string, onayGerekli: boolean) {
    const link = `${process.env.PORTAL_PUBLIC_URL || 'https://portal.morenmusavirlik.com'}/panel/aylik-odeme`;
    let sonuc = '';
    let gonderilen: number | null = null;
    try {
      if (onayGerekli) {
        const oz = await this.ozet(tenantId, month);
        const govde = `${ayAdi(month)} ödeme cetveli hazır: ${oz.mukellef} mükellef, ${paraTR(oz.toplam)} — göndermek için Aylık Ödeme Listesi'nde 'Gönderilmemişlere gönder'`;
        for (const tel of ownerTelefonlari()) {
          await this.whatsapp.sendMessage(tel, `🧾 ${govde}\n${link}`, tenantId).catch((e: any) => this.logger.warn(`sahibe WhatsApp gidemedi: ${e?.message || e}`));
        }
        await this.notifications
          ?.createForTenant({
            tenantId,
            type: NOTIFICATION_TYPES.PENDING_DECISION,
            title: `${ayAdi(month)} ödeme cetveli hazır`,
            body: govde,
            metadata: { link, month, mukellef: oz.mukellef, toplam: oz.toplam, kaynak: 'aylik-odeme' },
            dedupeKey: `odeme-cetveli-onay:${month}`,
            dedupeWindowMin: 60 * 24 * 25,
          } as any)
          .catch((e: any) => this.logger.warn(`portal bildirimi yazılamadı: ${e?.message || e}`));
        sonuc = 'onay-bekliyor';
      } else {
        const r = await this.send(tenantId, month, undefined, 'gonderilmemis');
        gonderilen = r.results.filter((x: any) => x.status === 'SENT').length;
        const hatali = r.results.length - gonderilen;
        await this.notifications
          ?.createForTenant({
            tenantId,
            type: NOTIFICATION_TYPES.AUTOMATION,
            title: `${ayAdi(month)} ödeme cetveli otomatik gönderildi${r.testMode ? ' (test modu)' : ''}`,
            body: `${gonderilen} gönderim başarılı, ${hatali} hatalı, ${r.atlanan} daha önce gönderildiği için atlandı.`,
            metadata: { link, month, gonderilen, hatali, atlanan: r.atlanan, testMode: r.testMode, kaynak: 'aylik-odeme' },
            dedupeKey: `odeme-cetveli-otomatik:${month}`,
            dedupeWindowMin: 60 * 24 * 25,
          } as any)
          .catch((e: any) => this.logger.warn(`portal bildirimi yazılamadı: ${e?.message || e}`));
        sonuc = 'gonderildi';
      }
    } catch (e: any) {
      sonuc = `hata: ${String(e?.message || e).slice(0, 200)}`;
      this.logger.error(`otomatik ödeme cetveli koşusu (${month}) hata: ${e?.message || e}`);
    }
    await (this.prisma as any).smartDispatchSetting
      .update({
        where: { tenantId_kategori: { tenantId, kategori: 'ODEME_LISTESI' } },
        data: { lastRunAt: new Date(), lastRunResult: { month, sonuc, gonderilen } },
      })
      .catch((e: any) => this.logger.warn(`koşu izi yazılamadı: ${e?.message || e}`));
    return { month, sonuc, gonderilen };
  }
}
