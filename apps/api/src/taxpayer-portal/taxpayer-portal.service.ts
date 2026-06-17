import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { claudeTextViaMax } from '../common/max-inference';
import { KdvBeyannameService } from '../kdv-beyanname/kdv-beyanname.service';

/**
 * Mükellef self-servis portal mantığı.
 * TÜM veri okumaları taxpayerId'ye KİLİTLİdir; client'tan gelen taxpayerId asla
 * kullanılmaz — yalnız token'daki (doğrulanmış) taxpayerId kullanılır.
 */
@Injectable()
export class TaxpayerPortalService {
  private readonly logger = new Logger(TaxpayerPortalService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private storage: StorageService,
    private kdvBeyanname: KdvBeyannameService,
  ) {}

  // ============ AUTH ============

  async login(email: string, password: string) {
    const mail = String(email || '').trim().toLowerCase();
    if (!mail || !password) throw new UnauthorizedException('E-posta ve şifre gerekli');

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: {
        portalEmail: { equals: mail, mode: 'insensitive' },
        portalEnabled: true,
        isActive: true,
      },
    });
    if (!taxpayer || !taxpayer.portalPasswordHash) {
      throw new UnauthorizedException('Geçersiz e-posta veya şifre');
    }
    const ok = await argon2.verify(taxpayer.portalPasswordHash, password);
    if (!ok) throw new UnauthorizedException('Geçersiz e-posta veya şifre');

    await this.prisma.taxpayer
      .update({ where: { id: taxpayer.id }, data: { portalLastLoginAt: new Date() } })
      .catch(() => null);

    const accessToken = this.jwt.sign(
      { sub: taxpayer.id, tenantId: taxpayer.tenantId, type: 'taxpayer' },
      { expiresIn: '12h' },
    );
    return { accessToken, taxpayer: this.publicProfile(taxpayer) };
  }

  // ============ MÜŞAVİR TARAFI: portal erişimi aç/kapat ============

  /** Müşavir bir mükellefin portal erişimini açar/şifresini belirler. Tenant doğrulanır. */
  async setPortalAccess(
    tenantId: string,
    taxpayerId: string,
    opts: { enabled?: boolean; portalEmail?: string; password?: string },
  ) {
    const tp = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    const data: any = {};
    if (opts.enabled === false) {
      data.portalEnabled = false;
    } else {
      const mail = String(opts.portalEmail || tp.portalEmail || tp.email || '').trim();
      if (!mail) throw new BadRequestException('Portal e-postası gerekli (mükellefin e-postası yok)');
      data.portalEmail = mail;
      data.portalEnabled = true;
      if (opts.password) {
        if (String(opts.password).length < 6) {
          throw new BadRequestException('Şifre en az 6 karakter olmalı');
        }
        data.portalPasswordHash = await argon2.hash(opts.password, {
          type: argon2.argon2id,
          memoryCost: 65536,
          timeCost: 3,
        });
      }
      if (!tp.portalPasswordHash && !opts.password) {
        throw new BadRequestException('İlk açılışta şifre belirleyin');
      }
    }

    const updated = await this.prisma.taxpayer.update({ where: { id: taxpayerId }, data });
    return {
      taxpayerId,
      portalEnabled: updated.portalEnabled,
      portalEmail: updated.portalEmail,
      hasPassword: !!updated.portalPasswordHash,
    };
  }

  async getPortalAccessStatus(tenantId: string, taxpayerId: string) {
    const tp = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { portalEnabled: true, portalEmail: true, portalPasswordHash: true, portalLastLoginAt: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');
    return {
      portalEnabled: tp.portalEnabled,
      portalEmail: tp.portalEmail,
      hasPassword: !!tp.portalPasswordHash,
      portalLastLoginAt: tp.portalLastLoginAt,
    };
  }

  // ============ MÜKELLEFE KİLİTLİ VERİ ============

  async getProfile(taxpayerId: string) {
    const tp = await this.prisma.taxpayer.findUnique({ where: { id: taxpayerId } });
    if (!tp) throw new NotFoundException();
    return this.publicProfile(tp);
  }

  async getBeyannameler(taxpayerId: string) {
    const [rows, kayitlar] = await Promise.all([
      this.prisma.beyanDurumu.findMany({
        where: { taxpayerId },
        orderBy: [{ donem: 'desc' }, { beyanTipi: 'asc' }],
        take: 80,
        select: { beyanTipi: true, donem: true, durum: true, onayTarihi: true, tahakkukTutari: true },
      }),
      this.prisma.beyanKaydi.findMany({
        where: { taxpayerId },
        select: { id: true, beyanTipi: true, donem: true, pdfUrl: true, beyannameUrl: true, xmlUrl: true, beyanTarihi: true, onayNo: true },
      }),
    ]);
    const kmap = new Map(kayitlar.map((k) => [`${k.beyanTipi}::${k.donem}`, k]));
    return rows.map((r) => {
      const k = kmap.get(`${r.beyanTipi}::${r.donem}`);
      // Resmî beyanname kaydı (verilme tarihi / onay no / belge) varsa beyanname
      // fiilen VERİLMİŞ demektir. Durum hâlâ "beklemede" kalmışsa "verildi"ye çek
      // — verilmiş beyannamenin "bekleyen" görünmesi hatası buradan kaynaklanıyordu.
      const verildi = !!(k && (k.beyanTarihi || k.onayNo || k.beyannameUrl || k.pdfUrl || k.xmlUrl));
      const durum = verildi && (!r.durum || r.durum === 'beklemede') ? 'verildi' : r.durum;
      return {
        ...r,
        durum,
        tahakkukTutari: r.tahakkukTutari ? Number(r.tahakkukTutari) : null,
        verildiTarihi: k?.beyanTarihi ?? r.onayTarihi ?? null,
        belge: k
          ? { kayitId: k.id, pdf: !!k.pdfUrl, beyanname: !!k.beyannameUrl, xml: !!k.xmlUrl, beyanTarihi: k.beyanTarihi, onayNo: k.onayNo }
          : null,
      };
    });
  }

  /**
   * Beyanname Listesi (mükellef) — müşavir "Beyanname Listesi" ile aynı dil:
   * fiilen verilmiş (BeyanKaydi) kayıtlar, yeni tarihliler üstte. Her kayıt frontend'de
   * iki satır olur (EBeyanname + Tahakkuk). "beklemede" satırı YOK.
   */
  async getBeyannamelerListe(taxpayerId: string) {
    const rows = await this.prisma.beyanKaydi.findMany({
      where: { taxpayerId },
      orderBy: [{ beyanTarihi: 'desc' }, { createdAt: 'desc' }],
      take: 400,
      select: {
        id: true, beyanTipi: true, donem: true, beyanTarihi: true, createdAt: true,
        tahakkukTutari: true, onayNo: true, notlar: true, pdfUrl: true, beyannameUrl: true, xmlUrl: true,
      },
    });
    const isDuzeltme = (s: string | null) => !!s && /D[ÜU]ZELTME/i.test(s);
    return rows.map((r) => ({
      id: r.id,
      beyanTipi: r.beyanTipi,
      donem: r.donem,
      beyanTarihi: r.beyanTarihi,
      createdAt: r.createdAt,
      tahakkukTutari: r.tahakkukTutari != null ? Number(r.tahakkukTutari) : null,
      onayNo: r.onayNo,
      mahiyet: isDuzeltme(r.notlar) ? 'DUZELTME' : 'ASIL',
      hasBeyanname: !!r.beyannameUrl,
      hasTahakkuk: !!r.pdfUrl,
      hasXml: !!r.xmlUrl,
    }));
  }

  /**
   * Cari özet — müşavir "Cari Hesap" sekmesi (CariHesapTab) ile aynı: 4 metrik +
   * Tarih/Tip/Açıklama/Borç/Alacak/Bakiye (yürüyen bakiye) hareket tablosu.
   * Borç = TAHAKKUK (+) / IADE (−), Alacak = TAHSILAT (+) / DÜZELTME (−).
   */
  async getCariOzet(taxpayerId: string) {
    const hareketler = await this.prisma.cariHareket.findMany({
      where: { taxpayerId },
      orderBy: [{ tarih: 'asc' }, { createdAt: 'asc' }],
      take: 500,
      select: { tarih: true, tip: true, tutar: true, aciklama: true, donem: true, hizmet: { select: { hizmetAdi: true } } },
    });
    let tahakkuk = 0;
    let tahsilat = 0;
    let running = 0;
    const withRunning = hareketler.map((h) => {
      const t = Number(h.tutar);
      const borc = h.tip === 'TAHAKKUK' ? t : h.tip === 'IADE' ? -t : 0;
      const alacak = h.tip === 'TAHSILAT' ? t : h.tip === 'DUZELTME' ? -t : 0;
      running += borc - alacak;
      if (h.tip === 'TAHAKKUK') tahakkuk += t;
      else if (h.tip === 'TAHSILAT') tahsilat += t;
      return {
        tarih: h.tarih, tip: h.tip, tutar: t, aciklama: h.aciklama, donem: h.donem,
        hizmetAdi: h.hizmet?.hizmetAdi || null, borc, alacak, runningBakiye: running,
      };
    });
    return {
      bakiye: running,
      tahakkukToplam: tahakkuk,
      tahsilatToplam: tahsilat,
      hareketler: withRunning.reverse().slice(0, 120),
    };
  }

  async getEvraklar(taxpayerId: string) {
    const docs = await this.prisma.document.findMany({
      where: { taxpayerId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, title: true, category: true, notes: true, sizeBytes: true, mimeType: true, createdAt: true, updatedAt: true, expiresAt: true, s3Key: true },
    });
    return docs.map((d) => ({
      id: d.id, title: d.title, category: d.category, notes: d.notes ?? null,
      sizeBytes: d.sizeBytes ?? null, mimeType: d.mimeType ?? null,
      createdAt: d.createdAt, updatedAt: d.updatedAt, expiresAt: d.expiresAt,
      goruntulenebilir: !!d.s3Key,
    }));
  }

  /** İşlenen faturalar (Mihsap) — liste + aylık/tür toplama (grafik için). */
  async getFaturalar(taxpayerId: string, tenantId: string) {
    const rows = await (this.prisma as any).mihsapInvoice.findMany({
      where: { tenantId, mukellefId: taxpayerId },
      orderBy: { faturaTarihi: 'desc' },
      take: 400,
      select: {
        id: true, donem: true, faturaTuru: true, belgeTuru: true, faturaNo: true,
        firmaUnvan: true, firmaKimlikNo: true, faturaTarihi: true, toplamTutar: true, storageKey: true,
      },
    });
    const aylik = new Map<string, { donem: string; alis: number; satis: number; alisAdet: number; satisAdet: number }>();
    let alisToplam = 0, satisToplam = 0, alisAdet = 0, satisAdet = 0;
    for (const r of rows) {
      const isSatis = /SATIS/i.test(r.faturaTuru || '');
      const isAlis = !isSatis; // ALIS / TEVKIFATLI_ALIS / diğer → alış sayılır
      const d = r.donem || (r.faturaTarihi ? new Date(r.faturaTarihi).toISOString().slice(0, 7) : '—');
      if (!aylik.has(d)) aylik.set(d, { donem: d, alis: 0, satis: 0, alisAdet: 0, satisAdet: 0 });
      const a = aylik.get(d)!;
      const tut = Number(r.toplamTutar) || 0;
      if (isSatis) { a.satis += tut; a.satisAdet++; satisToplam += tut; satisAdet++; }
      else if (isAlis) { a.alis += tut; a.alisAdet++; alisToplam += tut; alisAdet++; }
    }
    const aylikArr = Array.from(aylik.values()).filter((x) => x.donem !== '—').sort((a, b) => a.donem.localeCompare(b.donem)).slice(-12);
    return {
      ozet: { toplamAdet: rows.length, alisAdet, satisAdet, alisToplam, satisToplam },
      aylik: aylikArr,
      faturalar: rows.slice(0, 120).map((r: any) => ({
        id: r.id, donem: r.donem, faturaTuru: r.faturaTuru, belgeTuru: r.belgeTuru, faturaNo: r.faturaNo,
        firmaUnvan: r.firmaUnvan, firmaKimlikNo: r.firmaKimlikNo, faturaTarihi: r.faturaTarihi,
        toplamTutar: Number(r.toplamTutar) || 0, goruntulenebilir: !!r.storageKey,
      })),
    };
  }

  /**
   * Faturalar sayfası — yıl/ay seçimli detay.
   * Seçili yılın 12 aylık alış/satış grafiği + yıl özeti + seçili ay listesi/özeti
   * + seçili dönem KDV özeti (Luca-mutabık ön-hazırlıktan: alış/satış/ödenecek KDV).
   * NOT: getFaturalar (dashboard) bilerek korunur; bu metot ayrıdır.
   */
  async getFaturalarDetay(
    taxpayerId: string,
    tenantId: string,
    opts: { yil?: number; donem?: string },
  ) {
    const now = new Date();

    // Mevcut yıllar (dropdown için) — fatura dönemlerinden türet
    const donemRows: { donem: string | null }[] = await (this.prisma as any).mihsapInvoice.findMany({
      where: { tenantId, mukellefId: taxpayerId },
      select: { donem: true },
      distinct: ['donem'],
    });
    const yillarSet = new Set<number>();
    for (const d of donemRows) {
      const m = /^(\d{4})-\d{2}$/.exec(d.donem || '');
      if (m) yillarSet.add(Number(m[1]));
    }
    yillarSet.add(now.getFullYear());
    const mevcutYillar = Array.from(yillarSet).sort((a, b) => b - a);

    const yil = opts.yil && yillarSet.has(opts.yil) ? opts.yil : mevcutYillar[0];
    const donem =
      opts.donem && /^\d{4}-\d{2}$/.test(opts.donem) && opts.donem.startsWith(`${yil}-`)
        ? opts.donem
        : `${yil}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Seçili yılın tüm faturaları
    const rows = await (this.prisma as any).mihsapInvoice.findMany({
      where: { tenantId, mukellefId: taxpayerId, donem: { startsWith: `${yil}-` } },
      orderBy: { faturaTarihi: 'desc' },
      select: {
        id: true, donem: true, faturaTuru: true, belgeTuru: true, faturaNo: true,
        firmaUnvan: true, firmaKimlikNo: true, faturaTarihi: true, toplamTutar: true, storageKey: true,
      },
    });

    // 12 aylık grafik iskeleti + yıl özeti
    const aylar = new Map<string, { donem: string; alis: number; satis: number; alisAdet: number; satisAdet: number }>();
    for (let m = 1; m <= 12; m++) {
      const dd = `${yil}-${String(m).padStart(2, '0')}`;
      aylar.set(dd, { donem: dd, alis: 0, satis: 0, alisAdet: 0, satisAdet: 0 });
    }
    let yAlis = 0, ySatis = 0, yAlisAdet = 0, ySatisAdet = 0;
    for (const r of rows) {
      const isSatis = /SATIS/i.test(r.faturaTuru || '');
      const dd = r.donem || (r.faturaTarihi ? new Date(r.faturaTarihi).toISOString().slice(0, 7) : '');
      const a = aylar.get(dd);
      const tut = Number(r.toplamTutar) || 0;
      if (isSatis) { ySatis += tut; ySatisAdet++; if (a) { a.satis += tut; a.satisAdet++; } }
      else { yAlis += tut; yAlisAdet++; if (a) { a.alis += tut; a.alisAdet++; } }
    }
    const aylik = Array.from(aylar.values());

    // Seçili ay listesi + özeti
    const ayRows = rows.filter((r: any) => (r.donem || '') === donem);
    let aAlis = 0, aSatis = 0, aAlisAdet = 0, aSatisAdet = 0;
    for (const r of ayRows) {
      const isSatis = /SATIS/i.test(r.faturaTuru || '');
      const tut = Number(r.toplamTutar) || 0;
      if (isSatis) { aSatis += tut; aSatisAdet++; } else { aAlis += tut; aAlisAdet++; }
    }

    const kdv = await this.kdvOzetForDonem(tenantId, taxpayerId, donem);

    return {
      yil,
      donem,
      mevcutYillar,
      yilOzet: { alisToplam: yAlis, satisToplam: ySatis, alisAdet: yAlisAdet, satisAdet: ySatisAdet },
      ayOzet: { alisToplam: aAlis, satisToplam: aSatis, alisAdet: aAlisAdet, satisAdet: aSatisAdet, toplamAdet: ayRows.length },
      aylik,
      kdv,
      faturalar: ayRows.slice(0, 300).map((r: any) => ({
        id: r.id, donem: r.donem, faturaTuru: r.faturaTuru, belgeTuru: r.belgeTuru, faturaNo: r.faturaNo,
        firmaUnvan: r.firmaUnvan, firmaKimlikNo: r.firmaKimlikNo, faturaTarihi: r.faturaTarihi,
        toplamTutar: Number(r.toplamTutar) || 0, goruntulenebilir: !!r.storageKey,
      })),
    };
  }

  /**
   * Seçili dönemin KDV özeti — Luca-mutabık KDV1 ön-hazırlıktan.
   * Ödenecek KDV: resmî beyan (BeyanDurumu KDV1 tahakkuk) varsa o; yoksa ön-hazırlık sonucu.
   * Hesaplanamazsa (KDV1 mükellefi değil / veri yok) null döner → frontend kartı gizler.
   */
  private async kdvOzetForDonem(tenantId: string, taxpayerId: string, donem: string) {
    try {
      const [beyan, oh] = await Promise.all([
        this.prisma.beyanDurumu.findFirst({
          where: { taxpayerId, donem, beyanTipi: 'KDV1' },
          select: { tahakkukTutari: true, durum: true },
        }),
        this.kdvBeyanname.kdv1OnHazirlik({ tenantId, mukellefId: taxpayerId, donem, computePrevDevreden: false }),
      ]);
      const beyanOdenecek = beyan?.tahakkukTutari != null ? Number(beyan.tahakkukTutari) : null;
      const faturaAdet = (oh.satis?.faturaAdet || 0) + (oh.alis?.faturaAdet || 0);
      if (faturaAdet === 0 && beyanOdenecek == null) return null;
      return {
        donem,
        hesaplananKdv: oh.sonuc?.hesaplananKdv ?? 0,
        indirilecekKdv: oh.sonuc?.indirilecekKdv ?? 0,
        odenecekKdv: beyanOdenecek ?? oh.sonuc?.odenecekKdv ?? 0,
        devredenKdv: oh.sonuc?.sonrakiAyaDevreden ?? 0,
        veriGuveni: oh.veriGuveni?.seviye || 'eksik',
        faturaAdet,
        beyanVar: !!beyan,
        beyanDurum: beyan?.durum || null,
      };
    } catch (e) {
      this.logger.warn(`KDV özeti hesaplanamadı (${donem}): ${(e as Error).message}`);
      return null;
    }
  }

  /** e-Tebligat belgeleri (GİB'den çekilen). */
  async getTebligatlar(taxpayerId: string, tenantId: string) {
    const rows = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, taxpayerId, belgeTuru: 'E_TEBLIGAT' },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      select: { id: true, title: true, referenceNo: true, period: true, issuedAt: true, receivedAt: true, createdAt: true, viewedAt: true, storageKey: true, raw: true },
    });
    return rows.map((r: any) => {
      const raw = r.raw || {};
      return {
        id: r.id,
        title: r.title,
        referenceNo: r.referenceNo,
        period: r.period,
        issuedAt: r.issuedAt,
        receivedAt: r.receivedAt,
        createdAt: r.createdAt,
        viewedAt: r.viewedAt,
        // Müşavir e-Tebligat tablosu ile aynı alanlar:
        kurumAciklama: raw.kurumAciklama || null,
        altKurum: raw.altKurum || null,
        tebligZamani: raw.tebligZamani || null,
        goruntulenebilir: !!r.storageKey,
      };
    });
  }

  /**
   * SGK belgeleri — müşavir SGK sekmesi (SgkTab) ile aynı: Tahakkuk Fişi + Hizmet
   * Listesi TEK tabloda, dönem/tür/mahiyet/çalışan/tutar kolonlarıyla, dönem azalan.
   * Meta (dönem/mahiyet/çalışan/tutar) belge raw'ından çıkarılır (sgkDocMeta ile aynı).
   */
  async getSgkBelgeleri(taxpayerId: string, tenantId: string) {
    const rows = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, taxpayerId, belgeTuru: { in: ['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'] } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, belgeTuru: true, period: true, viewedAt: true, storageKey: true, raw: true },
    });
    const meta = (d: any) => {
      const raw = d?.raw || {};
      const cells: string[] = Array.isArray(raw.cells) ? raw.cells : [];
      const text = String(raw.rowText || cells.join(' ') || '');
      const donem = String(raw.donem || d?.period || '').trim();
      const mahiyet = String(raw.belgeMahiyeti || '').trim() || (text.match(/\b(ASIL|EK|İPTAL|IPTAL)\b/i) || [])[0] || '';
      let tutar = String(raw.tutar || '').trim();
      if (!tutar) { const tt = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []; tutar = tt.length ? tt[tt.length - 1] : ''; }
      const calisan = String(raw.calisan || '').trim();
      return { donem, mahiyet, calisan, tutar };
    };
    return rows
      .map((r: any) => {
        const m = meta(r);
        return {
          id: r.id,
          belgeTuru: r.belgeTuru,
          donem: m.donem || r.period || '',
          mahiyet: m.mahiyet || '',
          calisan: m.calisan || '',
          tutar: m.tutar || '',
          viewedAt: r.viewedAt,
          goruntulenebilir: !!r.storageKey,
        };
      })
      .sort((a: any, b: any) => String(b.donem).localeCompare(String(a.donem)));
  }

  /** Mükellefe-kilitli belge görüntüleme — presigned inline URL döner. */
  async getBelgeViewUrl(taxpayerId: string, tenantId: string, tur: string, id: string, kind?: string) {
    const inline = (key: string, filename: string, ct?: string) => this.storage.getPresignedInlineUrl(key, filename, ct);
    if (tur === 'beyanname') {
      const k = await this.prisma.beyanKaydi.findFirst({ where: { id, taxpayerId } });
      if (!k) throw new NotFoundException('Belge bulunamadı');
      const key = kind === 'beyanname' ? k.beyannameUrl : kind === 'xml' ? k.xmlUrl : k.pdfUrl;
      if (!key) throw new NotFoundException('Bu belge mevcut değil');
      const ext = kind === 'xml' ? 'xml' : 'pdf';
      return { url: await inline(key, `${k.beyanTipi}-${k.donem}.${ext}`, ext === 'xml' ? 'application/xml' : 'application/pdf') };
    }
    if (tur === 'evrak') {
      const d = await this.prisma.document.findFirst({ where: { id, taxpayerId, isDeleted: false } });
      if (!d || !d.s3Key) throw new NotFoundException('Belge bulunamadı');
      return { url: await inline(d.s3Key, d.title || 'belge') };
    }
    if (tur === 'tebligat' || tur === 'sgk') {
      const doc = await (this.prisma as any).portalDocument.findFirst({ where: { id, taxpayerId, tenantId } });
      if (!doc || !doc.storageKey) throw new NotFoundException('Belge bulunamadı');
      if (!doc.viewedAt) {
        await (this.prisma as any).portalDocument.update({ where: { id: doc.id }, data: { viewedAt: new Date() } }).catch(() => null);
      }
      return { url: await inline(doc.storageKey, doc.title || 'belge', doc.mimeType || undefined) };
    }
    if (tur === 'fatura') {
      const f = await (this.prisma as any).mihsapInvoice.findFirst({ where: { id, mukellefId: taxpayerId, tenantId } });
      if (!f || !f.storageKey) throw new NotFoundException('Belge bulunamadı');
      return { url: await inline(f.storageKey, f.faturaNo || 'fatura') };
    }
    throw new BadRequestException('Geçersiz belge türü');
  }

  async getDashboard(taxpayerId: string, tenantId: string) {
    const [profile, beyannameler, cari, evraklar, faturalar, tebligatlar] = await Promise.all([
      this.getProfile(taxpayerId),
      this.getBeyannameler(taxpayerId),
      this.getCariOzet(taxpayerId),
      this.getEvraklar(taxpayerId),
      this.getFaturalar(taxpayerId, tenantId),
      this.getTebligatlar(taxpayerId, tenantId),
    ]);
    const bekleyenBeyan = beyannameler.filter((b) => b.durum === 'beklemede').length;
    const okunmamisTebligat = tebligatlar.filter((t: any) => !t.viewedAt).length;
    return {
      profile,
      ozet: {
        bekleyenBeyan,
        cariBakiye: cari.bakiye,
        evrakSayisi: evraklar.length,
        faturaSayisi: faturalar.ozet.toplamAdet,
        okunmamisTebligat,
      },
      beyannameler: beyannameler.slice(0, 12),
      cari,
      evraklar: evraklar.slice(0, 12),
      faturaOzet: faturalar.ozet,
      faturaAylik: faturalar.aylik,
      sonTebligatlar: tebligatlar.slice(0, 5),
    };
  }

  // ============ MÜKELLEFE KİLİTLİ AI SOHBETİ (araçsız, bağlam-temelli) ============

  async chat(taxpayerId: string, tenantId: string, message: string) {
    const msg = String(message || '').trim();
    if (!msg) throw new BadRequestException('Mesaj boş olamaz');

    const dash = await this.getDashboard(taxpayerId, tenantId);
    const p = dash.profile;
    const ad = p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Mükellef';

    const beyanSatir = dash.beyannameler
      .map((b) => `- ${b.beyanTipi} ${b.donem}: ${b.durum}${b.tahakkukTutari ? ` (tahakkuk ${b.tahakkukTutari.toLocaleString('tr-TR')} TL)` : ''}`)
      .join('\n') || 'Kayıt yok.';

    const context = [
      `MÜKELLEF: ${ad}`,
      `Bekleyen beyanname: ${dash.ozet.bekleyenBeyan} · Cari bakiye: ${dash.ozet.cariBakiye.toLocaleString('tr-TR')} TL · Evrak: ${dash.ozet.evrakSayisi}`,
      '',
      'BEYANNAME DURUMU:',
      beyanSatir,
      '',
      `CARİ: Tahakkuk ${dash.cari.tahakkukToplam.toLocaleString('tr-TR')} TL, Tahsilat ${dash.cari.tahsilatToplam.toLocaleString('tr-TR')} TL, Bakiye ${dash.cari.bakiye.toLocaleString('tr-TR')} TL.`,
    ].join('\n');

    const system = [
      'Sen MOREN AI\'sın — Moren Mali Müşavirlik\'in mükellef asistanısın.',
      `Karşındaki kişi "${ad}" adlı mükelleftir. SADECE bu mükellefin aşağıda verilen kendi verisi hakkında konuş.`,
      'Başka mükellef, ofis geneli bilgi veya gizli bilgi ASLA verme. Soru kapsam dışıysa kibarca "Bu konuda müşavirinizle görüşün" de.',
      'Kısa, sade, Türkçe ve mesleki konuş. Rakam verirken mükellefin kendi verisini kullan. Vergi tavsiyesi verirken kesin hüküm yerine yönlendir.',
      '',
      'MÜKELLEFİN GÜNCEL VERİSİ:',
      context,
    ].join('\n');

    try {
      const res = await claudeTextViaMax({ prompt: msg, system, model: 'claude-sonnet-4-6' });
      if (res.ok) return { reply: res.text };
      this.logger.warn(`Mükellef AI Max hatası: ${res.error}`);
      return { reply: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.' };
    } catch (e) {
      this.logger.error(`Mükellef AI hata: ${(e as Error).message}`);
      return { reply: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.' };
    }
  }

  // ============ yardımcı ============

  private publicProfile(tp: any) {
    return {
      id: tp.id,
      type: tp.type,
      firstName: tp.firstName,
      lastName: tp.lastName,
      companyName: tp.companyName,
      taxOffice: tp.taxOffice,
      email: tp.email,
      phone: tp.phone,
      portalEmail: tp.portalEmail,
    };
  }
}
