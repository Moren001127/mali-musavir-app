import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaxpayerDto } from '@mali-musavir/shared';
import { AutomationEventBus } from '../automations/automation-event-bus.service';

type TaxpayerListOptions = {
  scope?: 'monthly' | 'directory';
  status?: 'active' | 'inactive' | 'all';
};

@Injectable()
export class TaxpayersService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly eventBus?: AutomationEventBus,
  ) {}

  private normalizeDefterFields<T extends Record<string, any>>(dto: T): T {
    const data: any = { ...dto };
    const defter = String(data.defterTuru || '').trim().toUpperCase();
    const mihsap = String(data.mihsapDefterTuru || '').trim().toUpperCase();

    if (/BASIT|BASİT|BASIT[_\s-]*USUL/.test(`${defter} ${mihsap}`)) {
      data.defterTuru = 'ISLETME';
      data.mihsapDefterTuru = 'BASIT';
    } else if (/ISLETME|İŞLETME|DEFTER[_\s-]*BEYAN/.test(defter)) {
      data.defterTuru = 'ISLETME';
      data.mihsapDefterTuru = 'DEFTER_BEYAN';
    } else if (/BILANCO|BİLANÇO|BILANÇO/.test(defter)) {
      data.defterTuru = 'BILANCO';
      data.mihsapDefterTuru = 'BILANCO';
    } else if (/DEFTER[_\s-]*BEYAN|ISLETME|İŞLETME/.test(mihsap)) {
      data.defterTuru = 'ISLETME';
      data.mihsapDefterTuru = 'DEFTER_BEYAN';
    } else if (/BILANCO|BİLANÇO|BILANÇO/.test(mihsap)) {
      data.defterTuru = 'BILANCO';
      data.mihsapDefterTuru = 'BILANCO';
    }

    return data as T;
  }

  /**
   * defterTuru (ESAS defter türü — Bilanço/İşletme) BOŞ kalmış mükellefleri, Mihsap'tan
   * gelen mihsapDefterTuru'ndan bir kez doldurur. Import edilmiş mükelleflerde defterTuru
   * NULL kalıyordu → KDV Kontrol'de defter/işlem butonları filtrelenemiyordu. Esas kaynak
   * hep defterTuru olsun diye boşları burada kalıcı dolduruyoruz (Mihsap runtime bağımlılığı yok).
   */
  async backfillDefterTuruFromMihsap(tenantId: string) {
    const rows = await this.prisma.taxpayer.findMany({
      where: { tenantId, mihsapDefterTuru: { not: null }, OR: [{ defterTuru: null }, { defterTuru: '' }] },
      select: { id: true, defterTuru: true, mihsapDefterTuru: true },
    });
    let fixed = 0;
    for (const t of rows) {
      const n = this.normalizeDefterFields({ defterTuru: t.defterTuru, mihsapDefterTuru: t.mihsapDefterTuru });
      if (n.defterTuru && n.defterTuru !== t.defterTuru) {
        await this.prisma.taxpayer
          .update({ where: { id: t.id }, data: { defterTuru: n.defterTuru } })
          .catch(() => {});
        fixed++;
      }
    }
    return { scanned: rows.length, fixed };
  }

  async findAll(
    tenantId: string,
    search?: string,
    year?: number,
    month?: number,
    options: TaxpayerListOptions = {},
  ) {
    // WHERE koşulları düzgün AND ile birleştiriliyor
    const andConditions: any[] = [{ tenantId }];
    // WhatsApp Mesaj Merkezi'nin sanal "ofis sahibi / kişi" kayıtları (taxNumber WHATSAPP-*)
    // gerçek mükellef DEĞİL; CRM listesinde gösterilmez (silinince tekrar açıldığı için listeyi kirletiyordu).
    andConditions.push({ taxNumber: { not: { startsWith: 'WHATSAPP-' } } });
    const status = options.status ?? 'active';
    if (status === 'inactive') {
      andConditions.push({ isActive: false });
    } else if (status !== 'all') {
      andConditions.push({ isActive: true });
    }

    // İşe başlama / işi bırakma tarihi filtreleri
    if (options.scope !== 'directory' && year && month) {
      const firstDay = new Date(year, month - 1, 1);   // Ayın 1'i
      const lastDay = new Date(year, month, 0, 23, 59, 59); // Ayın son günü
      andConditions.push({
        // İşe başlama: null VEYA seçili ayın son gününden önce başlayanlar
        OR: [
          { startDate: null },
          { startDate: { lte: lastDay } },
        ],
      });
      andConditions.push({
        // İşi bırakma: null VEYA seçili ayın ilk gününden sonra bırakanlar
        OR: [
          { endDate: null },
          { endDate: { gte: firstDay } },
        ],
      });
    }

    // Arama filtresi
    if (search) {
      andConditions.push({
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
          { taxNumber: { contains: search, mode: 'insensitive' } },
          { taxOffice: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const taxpayersRaw = await this.prisma.taxpayer.findMany({
      where: { AND: andConditions },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        type: true,
        firstName: true,
        lastName: true,
        companyName: true,
        taxNumber: true,
        taxOffice: true,
        email: true,
        emails: true,
        phone: true,
        phones: true,
        telefonAdlari: true, // rehber: numara -> ad
        address: true,
        evrakTeslimGunu: true,
        whatsappEvrakTalep: true,
        whatsappEvrakGeldi: true,
        isActive: true,
        isEFaturaMukellefi: true,
        notes: true,
        logoUrl: true,
        hattatId: true,
        naceKodu: true,
        faaliyetAciklama: true,
        ticaretSicilNo: true,
        mersisNo: true,
        odaSicilNo: true,
        bagkurSicilNo: true,
        kepAdresi: true,
        webSitesi: true,
        eFaturaEntegrator: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        lucaSlug: true,
        mihsapId: true,
        mihsapDefterTuru: true,
        defterTuru: true,
        cariHizmetler: { select: { id: true, aktif: true } },
        portalCredentials: {
          select: {
            provider: true,
            isActive: true,
            username: true,
            userCode: true,
            workplaceCode: true,
            encryptedPassword: true,
            encryptedSecondaryPassword: true,
          },
        },
        _count: { select: { taxDeclarations: true, documents: true } },
      },
    });

    // Türkçe locale-aware sıralama. PostgreSQL default collation İ/Ğ/Ş/Ç/Ü/Ö
    // karakterlerini yanlış sıralıyor — JS Intl.Collator ile düzeltiyoruz.
    // Görüntü adı: companyName öncelikli, yoksa "firstName lastName".
    const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: false });
    const displayName = (t: any): string =>
      (t.companyName ||
        `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
        t.taxNumber ||
        '').trim();
    const credentialIsReady = (credential: any) => {
      if (credential?.isActive === false) return false;
      if (credential?.provider === 'GIB_IVD') {
        return Boolean(credential?.userCode && (credential?.encryptedSecondaryPassword || credential?.encryptedPassword));
      }
      if (credential?.provider === 'SGK_EBILDIRGE') {
        return Boolean(
          (credential?.username || credential?.userCode) &&
          credential?.workplaceCode &&
          credential?.encryptedPassword &&
          credential?.encryptedSecondaryPassword,
        );
      }
      return Boolean(
        (credential?.username || credential?.userCode) &&
        (credential?.encryptedPassword || credential?.encryptedSecondaryPassword),
      );
    };

    const taxpayers = [...taxpayersRaw].map(({ cariHizmetler, portalCredentials, ...taxpayer }: any) => {
      const hizmetler = Array.isArray(cariHizmetler) ? cariHizmetler : [];
      const credentials = Array.isArray(portalCredentials) ? portalCredentials : [];
      const aktifCariHizmetCount = hizmetler.filter((h: any) => h.aktif).length;
      return {
        ...taxpayer,
        cariHizmetCount: hizmetler.length,
        aktifCariHizmetCount,
        cariTakipAktif: aktifCariHizmetCount > 0,
        hasVergiDairesiCredential: credentials.some((c: any) => c.provider === 'GIB_IVD' && credentialIsReady(c)),
        hasSgkCredential: credentials.some((c: any) => c.provider === 'SGK_EBILDIRGE' && credentialIsReady(c)),
      };
    }).sort((a, b) =>
      collator.compare(displayName(a), displayName(b)),
    );

    if (!year || !month) return taxpayers.map(t => ({ ...t, monthlyStatus: null }));

    const taxpayerIds = taxpayers.map(t => t.id);
    const statuses = await this.prisma.taxpayerMonthlyStatus.findMany({
      where: { taxpayerId: { in: taxpayerIds }, year, month },
    });
    const statusMap = new Map(statuses.map(s => [s.taxpayerId, s]));

    // OTOMATİK BEYAN İŞARETİ: bu İŞLEM ayının (month) beyanname dönemi = month−1.
    // O dönem için KDV beyannamesi İNDİRİLMİŞSE (BeyanKaydi'nde PDF var) → beyanname
    // GİB'e verilmiş demektir; Aylık Takip BEYAN kutusunu otomatik işaretli göster.
    const byYear = month === 1 ? year - 1 : year;
    const byMonth = month === 1 ? 12 : month - 1;
    const beyannameDonem = `${byYear}-${String(byMonth).padStart(2, '0')}`;
    const kdvIndirilenler = new Set<string>();
    try {
      const kdvKayitlari = await (this.prisma as any).beyanKaydi.findMany({
        where: {
          tenantId,
          taxpayerId: { in: taxpayerIds },
          donem: beyannameDonem,
          // SADECE KDV1 (1 No'lu / normal KDV). KDV2 (tevkifat) AYRI bir beyanname → indirilmiş olması
          //   normal KDV'nin verildiği ANLAMINA GELMEZ. KDV2'yi de sayınca, yalnız KDV2 veren mükellef
          //   (ör. ÖZELA/YORGUN/ZEYREK Mayıs) Aylık Takip + İş Akışı'nda yanlışlıkla "verildi/TAMAM" görünüyordu.
          beyanTipi: { in: ['KDV1', 'KDV'] },
          OR: [{ beyannameUrl: { not: null } }, { pdfUrl: { not: null } }],
        },
        select: { taxpayerId: true },
      });
      for (const k of kdvKayitlari) if (k?.taxpayerId) kdvIndirilenler.add(k.taxpayerId);
    } catch { /* beyan kaydı sorgusu başarısızsa otomatik işaret atlanır, akış bozulmaz */ }

    return taxpayers.map(t => {
      let monthlyStatus: any = statusMap.get(t.id) ?? null;
      if (kdvIndirilenler.has(t.id) && !monthlyStatus?.beyannameVerildi) {
        // KDV beyannamesi indirilmiş → BEYAN otomatik işaretli (verildi). Kayıt yoksa
        // türetilmiş bir durum objesi döndür (deriveStage → 'verildi').
        monthlyStatus = { ...(monthlyStatus || {}), beyannameVerildi: true, beyannameOtomatik: true };
      }
      return { ...t, monthlyStatus };
    });
  }

  async findOne(id: string, tenantId: string) {
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id, tenantId },
      include: {
        contacts: true,
        yetkililer: {
          where: { isActive: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            taxDeclarations: true,
            invoices: true,
            documents: true,
            employees: true,
          },
        },
      },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');
    return taxpayer;
  }

  // ============================================================
  // v1.37.0: Firma Yetkilileri CRUD (TaxpayerYetkili)
  // ============================================================
  async listYetkililer(taxpayerId: string, tenantId: string) {
    await this.assertOwnership(taxpayerId, tenantId);
    return (this.prisma as any).taxpayerYetkili.findMany({
      where: { taxpayerId, tenantId, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createYetkili(taxpayerId: string, tenantId: string, dto: any) {
    await this.assertOwnership(taxpayerId, tenantId);
    // İlk yetkili otomatik primary olsun
    const existingCount = await (this.prisma as any).taxpayerYetkili.count({
      where: { taxpayerId, isActive: true },
    });
    const isPrimary = dto.isPrimary || existingCount === 0;
    if (isPrimary && existingCount > 0) {
      // Diğer primary'leri temizle
      await (this.prisma as any).taxpayerYetkili.updateMany({
        where: { taxpayerId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return (this.prisma as any).taxpayerYetkili.create({
      data: {
        tenantId,
        taxpayerId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        tcNo: dto.tcNo || null,
        gorev: dto.gorev || null,
        telefon: dto.telefon || null,
        eposta: dto.eposta || null,
        notes: dto.notes || null,
        isPrimary,
      },
    });
  }

  async updateYetkili(taxpayerId: string, yetkiliId: string, tenantId: string, dto: any) {
    await this.assertOwnership(taxpayerId, tenantId);
    const existing = await (this.prisma as any).taxpayerYetkili.findFirst({
      where: { id: yetkiliId, taxpayerId, tenantId },
    });
    if (!existing) throw new NotFoundException('Yetkili bulunamadı');
    if (dto.isPrimary && !existing.isPrimary) {
      await (this.prisma as any).taxpayerYetkili.updateMany({
        where: { taxpayerId, isPrimary: true, id: { not: yetkiliId } },
        data: { isPrimary: false },
      });
    }
    return (this.prisma as any).taxpayerYetkili.update({
      where: { id: yetkiliId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.tcNo !== undefined && { tcNo: dto.tcNo || null }),
        ...(dto.gorev !== undefined && { gorev: dto.gorev || null }),
        ...(dto.telefon !== undefined && { telefon: dto.telefon || null }),
        ...(dto.eposta !== undefined && { eposta: dto.eposta || null }),
        ...(dto.notes !== undefined && { notes: dto.notes || null }),
        ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
      },
    });
  }

  async deleteYetkili(taxpayerId: string, yetkiliId: string, tenantId: string) {
    await this.assertOwnership(taxpayerId, tenantId);
    const existing = await (this.prisma as any).taxpayerYetkili.findFirst({
      where: { id: yetkiliId, taxpayerId, tenantId },
    });
    if (!existing) throw new NotFoundException('Yetkili bulunamadı');
    return (this.prisma as any).taxpayerYetkili.update({
      where: { id: yetkiliId },
      data: { isActive: false },
    });
  }

  private async assertOwnership(taxpayerId: string, tenantId: string) {
    const tp = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');
  }

  async create(tenantId: string, dto: any) {
    try {
      const created = await this.prisma.taxpayer.create({
        data: { tenantId, ...this.normalizeDefterFields(dto) },
      });

      // Otomasyon event'i: yeni müvekkel kaydı
      if (this.eventBus) {
        const t = created as any;
        const unvan =
          t.type === 'TUZEL_KISI'
            ? t.companyName || ''
            : `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
        this.eventBus.emit('Taxpayer.Created', {
          tenantId,
          taxpayerId: created.id,
          taxpayerUnvan: unvan || '(isim yok)',
          taxpayerVkn: t.taxNumber ?? '',
          taxpayerType: t.type,
        });
      }

      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new BadRequestException('Bu VKN/TCKN ile kayıtlı mükellef zaten mevcut');
      }
      throw e;
    }
  }

  async update(id: string, tenantId: string, dto: Partial<CreateTaxpayerDto>) {
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id, tenantId } });
    if (!taxpayer) throw new NotFoundException();
    return this.prisma.taxpayer.update({ where: { id }, data: this.normalizeDefterFields(dto as any) });
  }

  async setCariTakip(id: string, tenantId: string, cariTakipAktif: boolean) {
    await this.assertOwnership(id, tenantId);

    const hizmetler = await (this.prisma as any).cariHizmet.findMany({
      where: { tenantId, taxpayerId: id },
      select: { id: true, aktif: true },
    });

    if (hizmetler.length === 0) {
      throw new BadRequestException('Cari takip icin once Cari Tahsilat modulunde hizmet tanimlayin');
    }

    const result = await (this.prisma as any).cariHizmet.updateMany({
      where: { tenantId, taxpayerId: id },
      data: { aktif: cariTakipAktif },
    });

    return {
      taxpayerId: id,
      cariTakipAktif,
      cariHizmetCount: hizmetler.length,
      aktifCariHizmetCount: cariTakipAktif ? hizmetler.length : 0,
      updatedCount: result.count,
    };
  }

  async softDelete(id: string, tenantId: string) {
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id, tenantId } });
    if (!taxpayer) throw new NotFoundException();
    return this.prisma.taxpayer.update({ where: { id }, data: { isActive: false } });
  }

  private assertValidYearMonth(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('year 2000-2100 araliginda olmali');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month 1-12 araliginda olmali');
    }
  }

  /**
   * v1.36.76: Mükellef profil tamamlığı.
   * Üç katman puanlama (toplam 100):
   *  - KRİTİK (50p): Ad/VKN/Vergi Dairesi/Defter Türü/En az 1 mükellefiyet türü
   *  - ÖNEMLİ (30p): Hukuki tip + telefon + email + adres + mali müşavirlik ücreti
   *  - YARARLI (20p): Faaliyet, WA, evrak günü, Luca slug, Mihsap ID, banka, e-posta tercih
   */
  async getCompleteness(id: string, tenantId: string) {
    const tp: any = await this.prisma.taxpayer.findFirst({
      where: { id, tenantId },
      include: {
        beyanConfig: true,
        bankaHesaplar: { where: { aktif: true }, select: { id: true } },
      },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    // Mali müşavirlik ücreti — Cari Hizmet'te kayıt var mı (aktif)
    const cariHizmetCount = await (this.prisma as any).cariHizmet.count({
      where: { tenantId, taxpayerId: id, aktif: true },
    });

    type Field = { key: string; label: string; tier: 'KRITIK' | 'ONEMLI' | 'YARARLI'; value: any; ok: boolean };
    const fields: Field[] = [];

    // === KRİTİK ===
    const adVar = tp.companyName || (tp.firstName && tp.lastName);
    fields.push({ key: 'ad', label: 'Ad / Ünvan', tier: 'KRITIK', value: adVar, ok: !!adVar });
    fields.push({ key: 'taxNumber', label: 'VKN / TCKN', tier: 'KRITIK', value: tp.taxNumber, ok: !!tp.taxNumber });
    fields.push({ key: 'taxOffice', label: 'Vergi Dairesi', tier: 'KRITIK', value: tp.taxOffice, ok: !!tp.taxOffice });
    fields.push({ key: 'defterTuru', label: 'Defter Türü', tier: 'KRITIK', value: tp.defterTuru, ok: !!tp.defterTuru });

    // En az 1 mükellefiyet seçili mi (TaxpayerBeyanConfig)
    const cfg = tp.beyanConfig;
    const hasAnyMukellefiyet = !!cfg && (
      !!cfg.kdv1Period || !!cfg.kdv2Enabled || !!cfg.muhtasarPeriod ||
      !!cfg.damgaEnabled || !!cfg.posetEnabled || !!cfg.sgkBildirgeEnabled ||
      !!cfg.eDefterPeriod || !!cfg.incomeTaxType
    );
    fields.push({
      key: 'mukellefiyetler', label: 'Mükellefiyet Türleri (KDV/Muhtasar/vb.)',
      tier: 'KRITIK', value: hasAnyMukellefiyet, ok: hasAnyMukellefiyet,
    });

    // === ÖNEMLİ ===
    fields.push({ key: 'type', label: 'Hukuki Tip (Gerçek/Tüzel)', tier: 'ONEMLI', value: tp.type, ok: !!tp.type });
    fields.push({
      key: 'telefon', label: 'Telefon', tier: 'ONEMLI',
      value: tp.phone || (tp.phones || []).filter(Boolean).length > 0,
      ok: !!(tp.phone || (tp.phones || []).filter(Boolean).length > 0),
    });
    fields.push({
      key: 'email', label: 'E-posta', tier: 'ONEMLI',
      value: tp.email || (tp.emails || []).filter(Boolean).length > 0,
      ok: !!(tp.email || (tp.emails || []).filter(Boolean).length > 0),
    });
    fields.push({ key: 'adres', label: 'Adres', tier: 'ONEMLI', value: tp.address, ok: !!tp.address });
    fields.push({
      key: 'mmUcret', label: 'Mali Müşavirlik Ücreti (Cari Hizmet)',
      tier: 'ONEMLI', value: cariHizmetCount > 0, ok: cariHizmetCount > 0,
    });

    // === YARARLI ===
    fields.push({ key: 'evrakGunu', label: 'Evrak Teslim Günü', tier: 'YARARLI', value: tp.evrakTeslimGunu, ok: !!tp.evrakTeslimGunu });
    fields.push({ key: 'lucaSlug', label: 'Luca Slug', tier: 'YARARLI', value: tp.lucaSlug, ok: !!tp.lucaSlug });
    fields.push({ key: 'mihsapId', label: 'Mihsap ID', tier: 'YARARLI', value: tp.mihsapId, ok: !!tp.mihsapId });
    fields.push({
      key: 'banka', label: 'Banka Hesabı (en az 1)',
      tier: 'YARARLI', value: tp.bankaHesaplar?.length > 0, ok: (tp.bankaHesaplar?.length ?? 0) > 0,
    });
    fields.push({
      key: 'baslangic', label: 'İşe Başlama Tarihi',
      tier: 'YARARLI', value: tp.startDate, ok: !!tp.startDate,
    });

    // Puanlama
    const kritik = fields.filter((f) => f.tier === 'KRITIK');
    const onemli = fields.filter((f) => f.tier === 'ONEMLI');
    const yararli = fields.filter((f) => f.tier === 'YARARLI');

    const kritikScore = (kritik.filter((f) => f.ok).length / kritik.length) * 50;
    const onemliScore = (onemli.filter((f) => f.ok).length / onemli.length) * 30;
    const yararliScore = (yararli.filter((f) => f.ok).length / yararli.length) * 20;
    const totalScore = Math.round(kritikScore + onemliScore + yararliScore);

    let durum: 'TAM' | 'IYI' | 'EKSIK' | 'KRITIK_EKSIK';
    if (totalScore >= 95) durum = 'TAM';
    else if (totalScore >= 80) durum = 'IYI';
    else if (totalScore >= 60) durum = 'EKSIK';
    else durum = 'KRITIK_EKSIK';

    const eksikler = fields.filter((f) => !f.ok);
    const kritikEksikSayisi = eksikler.filter((f) => f.tier === 'KRITIK').length;

    return {
      taxpayerId: id,
      score: totalScore,
      durum,
      kritikEksikSayisi,
      eksikSayisi: eksikler.length,
      fields,
      eksikler,
      breakdown: {
        kritik: { dolu: kritik.filter((f) => f.ok).length, toplam: kritik.length, puan: Math.round(kritikScore) },
        onemli: { dolu: onemli.filter((f) => f.ok).length, toplam: onemli.length, puan: Math.round(onemliScore) },
        yararli: { dolu: yararli.filter((f) => f.ok).length, toplam: yararli.length, puan: Math.round(yararliScore) },
      },
    };
  }

  /**
   * v1.36.78: İş Akışı — sıralı görev listesi.
   * Mükellef × dönem monthly status'u okur, aşamalara böler, FIFO sıralar.
   * Aşamalar (öncelik sırası):
   *   1. KONTROL_BEKLIYOR   — evrak işlendi ama kontrol edilmedi
   *   2. ISLENMEYI_BEKLIYOR — evrak geldi ama işlenmedi (kim önce geldi → o önce)
   *   3. BEYANNAME_BEKLIYOR — kontrol tamam ama beyanname verilmedi
   *   4. EVRAK_BEKLIYOR     — evrak henüz gelmedi
   * Her aşamada updatedAt ASC (en eski güncelleme önce — yani en uzun bekleyen önce işlenir).
   */
  async getWorkflowQueue(tenantId: string, year?: number, month?: number) {
    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = month ?? now.getMonth() + 1;

    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0, 23, 59, 59);
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        // WhatsApp Mesaj Merkezi'nin sanal kayıtları (WHATSAPP-*) gerçek mükellef değil — iş akışına sayma.
        taxNumber: { not: { startsWith: 'WHATSAPP-' } },
        OR: [{ startDate: null }, { startDate: { lte: lastDay } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: firstDay } }] }],
      },
      select: { id: true, type: true, firstName: true, lastName: true, companyName: true, taxNumber: true, isActive: true, startDate: true },
    });
    const taxpayerIds = taxpayers.map((t) => t.id);
    const statuses = taxpayerIds.length
      ? await this.prisma.taxpayerMonthlyStatus.findMany({
          where: { tenantId, year: y, month: m, taxpayerId: { in: taxpayerIds } },
        })
      : [];
    const statusMap = new Map(statuses.map((s) => [s.taxpayerId, s]));

    // OTOMATİK BEYAN İŞARETİ (Aylık Takip listesiyle BİREBİR aynı kural): işlem ayının (m)
    // beyanname dönemi = m−1. O dönem için KDV beyannamesi İNDİRİLMİŞSE (BeyanKaydi'nde
    // beyanname/tahakkuk PDF var) → beyanname GİB'e verilmiş demektir → TAMAM say.
    // (Eskiden İş Akışı bu oto-işareti uygulamıyordu; verilmiş beyannameler TAMAM yerine
    // BEYAN'da kalıyor, Aylık Takip ile çelişiyordu.)
    const byYear = m === 1 ? y - 1 : y;
    const byMonth = m === 1 ? 12 : m - 1;
    const beyannameDonem = `${byYear}-${String(byMonth).padStart(2, '0')}`;
    const kdvIndirilenler = new Set<string>();
    try {
      const kdvKayitlari = await (this.prisma as any).beyanKaydi.findMany({
        where: {
          tenantId,
          taxpayerId: { in: taxpayerIds },
          donem: beyannameDonem,
          // SADECE KDV1 (1 No'lu / normal KDV). KDV2 (tevkifat) AYRI bir beyanname → indirilmiş olması
          //   normal KDV'nin verildiği ANLAMINA GELMEZ. KDV2'yi de sayınca, yalnız KDV2 veren mükellef
          //   (ör. ÖZELA/YORGUN/ZEYREK Mayıs) Aylık Takip + İş Akışı'nda yanlışlıkla "verildi/TAMAM" görünüyordu.
          beyanTipi: { in: ['KDV1', 'KDV'] },
          OR: [{ beyannameUrl: { not: null } }, { pdfUrl: { not: null } }],
        },
        select: { taxpayerId: true },
      });
      for (const k of kdvKayitlari) if (k?.taxpayerId) kdvIndirilenler.add(k.taxpayerId);
    } catch { /* beyan kaydı sorgusu başarısızsa oto-işaret atlanır, akış bozulmaz */ }

    // Aktif olmayan mükellefleri filtrele
    // Aşamayı belirle
    const items = taxpayers.map((taxpayer) => {
      const existingStatus: any = statusMap.get(taxpayer.id);
      const s: any = existingStatus || {
        id: `virtual-${taxpayer.id}-${y}-${m}`,
        updatedAt: taxpayer.startDate || firstDay,
        evraklarGeldi: false,
        yuklendi: false,
        evraklarIslendi: false,
        kontrolEdildi: false,
        beyannameVerildi: false,
        indirilecekKdvKontrol: false,
        hesaplananKdvKontrol: false,
        eArsivKontrol: false,
      };
      const ad = taxpayer.companyName || `${taxpayer.firstName ?? ''} ${taxpayer.lastName ?? ''}`.trim();

      // Hangi aşamada?
      let stage: 'EVRAK_BEKLIYOR' | 'YUKLEME_BEKLIYOR' | 'ISLENMEYI_BEKLIYOR' | 'KONTROL_BEKLIYOR' | 'BEYANNAME_BEKLIYOR' | 'TAMAM';
      let actionLabel: string;
      let actionPath: string;

      // v1.36.80 FIX: Mükellef listesi ile uyumlu — 3 KDV checkbox (indirilecek + hesaplanan + e-arşiv)
      // hepsi tıklı olunca KONTROL TAMAM sayılır (eski: kdvKontrolEdildi legacy field aranıyordu)
      const kdvKontrolHepsiTamam =
        s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
      // KDV beyannamesi indirilmişse (oto-işaret) verilmiş say — Aylık Takip listesiyle uyumlu.
      const beyannameVerildi = s.beyannameVerildi || kdvIndirilenler.has(taxpayer.id);

      if (beyannameVerildi) {
        stage = 'TAMAM';
        actionLabel = 'Tamamlandı';
        actionPath = `/panel/mukellefler/${taxpayer.id}`;
      } else if (s.kontrolEdildi || kdvKontrolHepsiTamam) {
        stage = 'BEYANNAME_BEKLIYOR';
        actionLabel = 'Beyanname Hazırla';
        actionPath = `/panel/beyannameler`;
      } else if (s.evraklarIslendi) {
        stage = 'KONTROL_BEKLIYOR';
        actionLabel = 'KDV Kontrol Yap';
        actionPath = `/panel/kdv-kontrol`;
      } else if (s.yuklendi) {
        stage = 'ISLENMEYI_BEKLIYOR';
        actionLabel = 'Faturaları İşle';
        actionPath = `/panel/ajanlar/mihsap`;
      } else if (s.evraklarGeldi) {
        stage = 'YUKLEME_BEKLIYOR';
        actionLabel = 'Sisteme Yükle';
        actionPath = `/panel/kdv-kontrol`;
      } else {
        stage = 'EVRAK_BEKLIYOR';
        actionLabel = 'Evrak Bekleniyor';
        actionPath = `/panel/mukellefler/${taxpayer.id}`;
      }

      // Bekleme süresi: updatedAt'ten şimdiye kaç gün
      const bekleyenGun = Math.floor(
        (now.getTime() - new Date(s.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        statusId: s.id,
        taxpayerId: taxpayer.id,
        taxpayerName: ad,
        taxNumber: taxpayer.taxNumber,
        type: taxpayer.type,
        stage,
        actionLabel,
        actionPath,
        bekleyenGun,
        updatedAt: s.updatedAt,
        evraklarGeldi: s.evraklarGeldi,
        evraklarIslendi: s.evraklarIslendi,
        kontrolEdildi: s.kontrolEdildi || kdvKontrolHepsiTamam,
        beyannameVerildi,
        monthlyStatusExists: !!existingStatus,
      };
    });

    // Aşamaya göre öncelik (acil olan önce)
    const stageOrder = {
      KONTROL_BEKLIYOR: 1,
      ISLENMEYI_BEKLIYOR: 2,
      YUKLEME_BEKLIYOR: 3,
      BEYANNAME_BEKLIYOR: 4,
      EVRAK_BEKLIYOR: 5,
      TAMAM: 6,
    };

    // Sırala: aşama önceliği DESC, sonra updatedAt ASC (en eski önce — kim önce hazır geldiyse o işlensin)
    const siralanmis = [...items].sort((a, b) => {
      const stageDiff = stageOrder[a.stage] - stageOrder[b.stage];
      if (stageDiff !== 0) return stageDiff;
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    });

    // Aşama bazında grupla
    const grouped = {
      KONTROL_BEKLIYOR: items.filter((i) => i.stage === 'KONTROL_BEKLIYOR').sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()),
      ISLENMEYI_BEKLIYOR: items.filter((i) => i.stage === 'ISLENMEYI_BEKLIYOR').sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()),
      YUKLEME_BEKLIYOR: items.filter((i) => i.stage === 'YUKLEME_BEKLIYOR').sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()),
      BEYANNAME_BEKLIYOR: items.filter((i) => i.stage === 'BEYANNAME_BEKLIYOR').sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()),
      EVRAK_BEKLIYOR: items.filter((i) => i.stage === 'EVRAK_BEKLIYOR'),
      TAMAM: items.filter((i) => i.stage === 'TAMAM'),
    };

    return {
      year: y,
      month: m,
      donem: `${y}-${String(m).padStart(2, '0')}`,
      total: items.length,
      counts: {
        evrak: grouped.EVRAK_BEKLIYOR.length,
        yukleme: grouped.YUKLEME_BEKLIYOR.length,
        islenme: grouped.ISLENMEYI_BEKLIYOR.length,
        kontrol: grouped.KONTROL_BEKLIYOR.length,
        beyanname: grouped.BEYANNAME_BEKLIYOR.length,
        tamam: grouped.TAMAM.length,
      },
      siradaki: siralanmis.filter((i) => i.stage !== 'TAMAM' && i.stage !== 'EVRAK_BEKLIYOR').slice(0, 10),
      grouped,
    };
  }

  /**
   * v1.36.77: Belge Takibi matrix — mükellef × dönem, FATURA + BANKA durumu.
   * Her mükellef için belirli bir dönemin (YYYY-MM):
   *   - Fatura geldi mi (MihsapInvoice'dan: o donem'de en az 1 fatura)
   *   - Banka ekstresi geldi mi (BankaEkstreKaydi'ndan: aktif bankalar için ekstreGeldi=true sayısı)
   * @param donem "YYYY-MM" formatında
   */
  async getBelgeTakipMatrix(tenantId: string, donem: string) {
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true, type: true, firstName: true, lastName: true, companyName: true, taxNumber: true,
      },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });

    // Tüm mükelleflerin o donem fatura sayısı (MihsapInvoice — donem alanı)
    const invoiceCounts = await (this.prisma as any).mihsapInvoice.groupBy({
      by: ['mukellefId'],
      where: { tenantId, donem },
      _count: { _all: true },
    });
    const invoiceMap = new Map<string, number>();
    invoiceCounts.forEach((r: any) => invoiceMap.set(r.mukellefId, r._count._all));

    // Tüm mükelleflerin aktif banka hesapları
    const bankaHesaplar = await (this.prisma as any).bankaHesap.findMany({
      where: { tenantId, aktif: true },
      select: { id: true, taxpayerId: true },
    });
    const hesapMap = new Map<string, string[]>(); // taxpayerId → hesap id'leri
    bankaHesaplar.forEach((h: any) => {
      if (!hesapMap.has(h.taxpayerId)) hesapMap.set(h.taxpayerId, []);
      hesapMap.get(h.taxpayerId)!.push(h.id);
    });

    // O donem için banka ekstresi durumları
    const ekstreler = await (this.prisma as any).bankaEkstreKaydi.findMany({
      where: { donem, hesapId: { in: bankaHesaplar.map((b: any) => b.id) } },
      select: { hesapId: true, ekstreGeldi: true, islendi: true },
    });
    const ekstreMap = new Map<string, { geldi: boolean; islendi: boolean }>();
    ekstreler.forEach((e: any) => ekstreMap.set(e.hesapId, { geldi: !!e.ekstreGeldi, islendi: !!e.islendi }));

    // Her mükellef için durumu hesapla
    const items = taxpayers.map((t) => {
      const ad = t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
      const fatCount = invoiceMap.get(t.id) || 0;
      const hesapIds = hesapMap.get(t.id) || [];
      const toplamHesap = hesapIds.length;
      const gelenHesap = hesapIds.filter((id) => ekstreMap.get(id)?.geldi).length;
      const islenenHesap = hesapIds.filter((id) => ekstreMap.get(id)?.islendi).length;

      // Durum kategorisi
      const fatOk = fatCount > 0;
      const bankaOk = toplamHesap === 0 ? null : gelenHesap === toplamHesap;
      const bankaIslendiOk = toplamHesap === 0 ? null : islenenHesap === toplamHesap;

      let durum: 'TAM' | 'EKSIK' | 'KRITIK' | 'YOK';
      if (toplamHesap === 0 && fatCount === 0) durum = 'YOK';
      else if ((fatOk || fatCount === 0) && (bankaOk === null || bankaOk)) durum = 'TAM';
      else if (!fatOk && (bankaOk === null || !bankaOk) && gelenHesap === 0) durum = 'KRITIK';
      else durum = 'EKSIK';

      return {
        taxpayerId: t.id,
        ad,
        taxNumber: t.taxNumber,
        type: t.type,
        fatura: { count: fatCount, ok: fatOk },
        banka: {
          toplam: toplamHesap,
          gelen: gelenHesap,
          islenen: islenenHesap,
          ok: bankaOk,
          islendiOk: bankaIslendiOk,
        },
        durum,
      };
    });

    return {
      donem,
      total: items.length,
      tam: items.filter((i) => i.durum === 'TAM').length,
      eksik: items.filter((i) => i.durum === 'EKSIK').length,
      kritik: items.filter((i) => i.durum === 'KRITIK').length,
      yok: items.filter((i) => i.durum === 'YOK').length,
      items,
    };
  }

  /**
   * v1.36.76: Tüm mükelleflerin tamamlık özeti (dashboard widget için).
   * Her mükellefin score'unu hesaplar — N+1 query'den kaçınmak için tek transaction.
   */
  async getCompletenessSummary(tenantId: string) {
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true, companyName: true },
    });
    const items = await Promise.all(
      taxpayers.map(async (t) => {
        try {
          const c = await this.getCompleteness(t.id, tenantId);
          return {
            id: t.id,
            ad: t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim(),
            score: c.score,
            durum: c.durum,
            kritikEksikSayisi: c.kritikEksikSayisi,
            eksikSayisi: c.eksikSayisi,
            // HANGI alan eksik — yalniz sayi dondurulunce "neyi doldurayim"
            // sorusu ekrandan yanitlanamiyordu (2026-08-18).
            eksikAlanlar: (c.eksikler || []).map((f: any) => ({ anahtar: f.key, alan: f.label, onem: f.tier })),
          };
        } catch {
          return null;
        }
      }),
    );
    const valid = items.filter(Boolean) as any[];
    return {
      total: valid.length,
      tam: valid.filter((i) => i.durum === 'TAM').length,
      iyi: valid.filter((i) => i.durum === 'IYI').length,
      eksik: valid.filter((i) => i.durum === 'EKSIK').length,
      kritikEksik: valid.filter((i) => i.durum === 'KRITIK_EKSIK').length,
      averageScore: Math.round(valid.reduce((s, i) => s + i.score, 0) / (valid.length || 1)),
      taxpayers: valid.sort((a, b) => a.score - b.score), // en eksik üstte
    };
  }

  async getMonthlyStatus(taxpayerId: string, tenantId: string, year: number, month: number) {
    this.assertValidYearMonth(year, month);
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    return this.prisma.taxpayerMonthlyStatus.upsert({
      where: { taxpayerId_year_month: { taxpayerId, year, month } },
      create: { taxpayerId, tenantId, year, month },
      update: {},
    });
  }

  async updateMonthlyStatus(
    taxpayerId: string,
    tenantId: string,
    year: number,
    month: number,
    data: {
      evraklarGeldi?: boolean;
      yuklendi?: boolean;
      evraklarIslendi?: boolean;
      kontrolEdildi?: boolean;
      beyannameVerildi?: boolean;
      kdvKontrolEdildi?: boolean;
      indirilecekKdvKontrol?: boolean;
      hesaplananKdvKontrol?: boolean;
      eArsivKontrol?: boolean;
      notes?: string | null;
    },
  ) {
    this.assertValidYearMonth(year, month);
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const cleanData = { ...data };
    if (typeof cleanData.notes === 'string') {
      const trimmed = cleanData.notes.trim();
      cleanData.notes = trimmed ? trimmed.slice(0, 1000) : null;
    }

    // Event emit için eski durum (varsa) okunur — değişikliği tespit etmek için.
    const existing = await this.prisma.taxpayerMonthlyStatus.findUnique({
      where: { taxpayerId_year_month: { taxpayerId, year, month } },
    });

    const result = await this.prisma.taxpayerMonthlyStatus.upsert({
      where: { taxpayerId_year_month: { taxpayerId, year, month } },
      create: { taxpayerId, tenantId, year, month, ...cleanData },
      update: cleanData,
    });

    // Otomasyon event'leri — değişen alan başına ayrı event yayınla.
    // Bu, "evrak geldi", "beyanname verildi" gibi spesifik tetikleyicileri
    // ayrı ayrı dinleyebilmek için tasarlandı.
    if (this.eventBus) {
      const emitIfChanged = (
        eventName: string,
        field: keyof typeof cleanData,
      ) => {
        if (cleanData[field] === undefined) return;
        const oldValue = existing ? (existing as any)[field] : false;
        const newValue = (result as any)[field];
        if (oldValue !== newValue) {
          // Müvekkel ismini doğru alandan üret:
          // - TUZEL_KISI (şirket): companyName
          // - GERCEK_KISI (kişi): firstName + lastName
          const t = taxpayer as any;
          const unvan =
            t.type === 'TUZEL_KISI'
              ? t.companyName || ''
              : `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
          this.eventBus!.emit(eventName, {
            tenantId,
            taxpayerId,
            year,
            month,
            // İŞLEM ayı (year-month) — sıfır-dolgulu "YYYY-MM".
            periodLabel: `${year}-${String(month).padStart(2, '0')}`,
            // BEYANNAME dönemi = işlem ayının BİR ÖNCEKİ ayı. Fatura/KDV verisi bu
            // döneme aittir (örn. Haziran'da işlenen evrak = Mayıs beyannamesi).
            beyannamePeriodLabel: `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`,
            field,
            oldValue,
            newValue,
            taxpayerUnvan: unvan || '(isim yok)',
            taxpayerVkn: t.taxNumber ?? '',
            taxpayerType: t.type,
          });
        }
      };
      emitIfChanged('Taxpayer.EvrakDurumuChanged', 'evraklarGeldi');
      emitIfChanged('Taxpayer.EvrakIslendiChanged', 'evraklarIslendi');
      emitIfChanged('Taxpayer.KontrolEdildiChanged', 'kontrolEdildi');
      emitIfChanged('Taxpayer.BeyannameDurumuChanged', 'beyannameVerildi');

      // Composite event: HEM evraklar geldi HEM evraklar islendi true ise,
      // ve bu son guncellemede bu duruma yeni gectiyse, EvraklarHazir tetiklenir.
      // Bu otomasyonu kuran kullanici "evraklari toplandi mi" ile "isleme alindi mi"
      // ikisini de gormeden tetiklenmesin istiyor. (Tipik otomasyon: hepsini cek)
      const wasReady =
        (existing?.evraklarGeldi ?? false) && (existing?.evraklarIslendi ?? false);
      const isReady = result.evraklarGeldi && result.evraklarIslendi;
      if (!wasReady && isReady) {
        const t = taxpayer as any;
        const unvan =
          t.type === 'TUZEL_KISI'
            ? t.companyName || ''
            : `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
        const periodLabel = `${year}-${String(month).padStart(2, '0')}`;
        const beyannamePeriodLabel = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
        this.eventBus.emit('Taxpayer.EvraklarHazir', {
          tenantId,
          taxpayerId,
          year,
          month,
          periodLabel,            // işlem ayı
          beyannamePeriodLabel,   // beyanname dönemi (işlem ayı - 1) — fatura/KDV bunu kullanır
          taxpayerUnvan: unvan || '(isim yok)',
          taxpayerVkn: t.taxNumber ?? '',
          taxpayerType: t.type,
        });
      }

      // KDV kontrolü tamam mı? (evrak geldi+işlendi + indirilecek+hesaplanan+e-arşiv
      // kontrol hepsi true) → KDV beyanname otomasyonu için event yayınla.
      // Dinleyen: KdvAutoFetchService (bilanço→Luca mizan, işletme→gelir-gider).
      const kdvKontrolFields = [
        'evraklarGeldi',
        'evraklarIslendi',
        'indirilecekKdvKontrol',
        'hesaplananKdvKontrol',
        'eArsivKontrol',
      ] as const;
      const kdvKontrolTamam = (src: any) =>
        !!src && kdvKontrolFields.every((f) => src[f] === true);
      if (!kdvKontrolTamam(existing) && kdvKontrolTamam(result)) {
        const t = taxpayer as any;
        const unvan =
          t.type === 'TUZEL_KISI'
            ? t.companyName || ''
            : `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
        this.eventBus.emit('Taxpayer.KdvKontrolTamam', {
          tenantId,
          taxpayerId,
          year,
          month,
          donem: `${year}-${String(month).padStart(2, '0')}`,                 // işlem ayı
          beyannamePeriodLabel: `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`, // beyanname dönemi (işlem ayı - 1)
          taxpayerUnvan: unvan || '(isim yok)',
          taxpayerVkn: t.taxNumber ?? '',
          taxpayerType: t.type,
        });
      }
    }

    return result;
  }

  /**
   * Mükellef için son N ayın özet istatistikleri.
   * Karlılık / iş yükü takibi için kullanılır.
   *
   * Not: AiUsageLog'da taxpayerId alanı yok (sadece mukellef adı string).
   * Bu yüzden AI kullanım istatistikleri mükellef adıyla eşleştirilir.
   * CariHareket bakiyesi: TAHAKKUK + → TAHSILAT/IADE − ile net bakiye.
   */
  async getStats(taxpayerId: string, tenantId: string, months: number = 1) {
    const tp = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setHours(0, 0, 0, 0);

    const p = this.prisma as any;
    const safeCount = async (fn: () => Promise<number>): Promise<number> => {
      try { return await fn(); } catch { return 0; }
    };
    const safeAgg = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };

    const [
      kdvSessions,
      mihsapInvoices,
      earsivInvoices,
      documents,
      receiptImages,
      mizanCount,
      beyanCount,
      cariTahakkuk,
      cariTahsilat,
    ] = await Promise.all([
      safeCount(() => p.kdvControlSession.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.mihsapInvoice.count({
        where: { mukellefId: taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.earsivFatura.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.document.count({
        where: { taxpayerId, isDeleted: false, createdAt: { gte: since } },
      })),
      safeCount(() => p.receiptImage.count({
        where: {
          kdvSession: { taxpayerId },
          createdAt: { gte: since },
        },
      })),
      safeCount(() => p.mizan.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.beyanKaydi.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeAgg(
        () => p.cariHareket.aggregate({
          where: { taxpayerId, tip: 'TAHAKKUK' },
          _sum: { tutar: true },
        }),
        { _sum: { tutar: 0 } } as any,
      ),
      safeAgg(
        () => p.cariHareket.aggregate({
          where: { taxpayerId, tip: { in: ['TAHSILAT', 'IADE', 'DUZELTME'] } },
          _sum: { tutar: true },
        }),
        { _sum: { tutar: 0 } } as any,
      ),
    ]);

    const tahakkukToplam = Number((cariTahakkuk as any)?._sum?.tutar ?? 0);
    const tahsilatToplam = Number((cariTahsilat as any)?._sum?.tutar ?? 0);
    const cariBakiye = tahakkukToplam - tahsilatToplam;

    // AI usage — taxpayer.companyName veya firstName lastName'e göre eşleştir
    const tpNames = [
      tp.companyName,
      [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim(),
    ].filter((name): name is string => !!name);
    const aiUsage = await safeAgg(
      () => p.aiUsageLog.aggregate({
        where: {
          tenantId,
          createdAt: { gte: since },
          OR: [
            { taxpayerId },
            ...tpNames.map((name) => ({ mukellef: { contains: name, mode: 'insensitive' as const } })),
          ],
        },
        _count: { _all: true },
        _sum: {
          costUsd: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
      }),
      { _count: { _all: 0 }, _sum: {} } as any,
    );
    const inputTokens = Number((aiUsage as any)?._sum?.inputTokens ?? 0);
    const outputTokens = Number((aiUsage as any)?._sum?.outputTokens ?? 0);
    const cacheReadTokens = Number((aiUsage as any)?._sum?.cacheReadTokens ?? 0);
    const cacheWriteTokens = Number((aiUsage as any)?._sum?.cacheWriteTokens ?? 0);

    return {
      taxpayerId,
      months,
      since: since.toISOString(),
      counts: {
        kdvSessions,
        mihsapInvoices,
        earsivInvoices,
        documents,
        receiptImages,
        mizanCount,
        beyanCount,
        aiCalls: (aiUsage as any)?._count?._all ?? 0,
      },
      aiUsage: {
        calls: (aiUsage as any)?._count?._all ?? 0,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        costUsd: Number((aiUsage as any)?._sum?.costUsd ?? 0),
      },
      cari: {
        tahakkukToplam,
        tahsilatToplam,
        bakiye: cariBakiye,
      },
    };
  }
}
