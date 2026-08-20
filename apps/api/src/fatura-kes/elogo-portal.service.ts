import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * eLOGO PORTAL İSTEMCİSİ — "Fatura Oluştur" ekranının arkasındaki API.
 *
 * NEDEN AYRI BİR SERVİS: eLogo'nun SOAP servisinde (PostBoxService) TASLAK OLUŞTURMA YOK.
 *   WSDL'in 48 operasyonu tarandı: taslakları listeleme/okuma/gönderme var, YAZMA yok.
 *   Ama eLogo portalının kendi ekranı bunu yapıyor ve arkasında düzgün bir HTTP API var.
 *   Kullanıcı isteği (2026-08-20): "fatura oluştur alanından ben komut verince faturayı
 *   oluştursun kayıt etsin, önizlemesini göndersin, ben onaylarsam fatura no ve gönderimi yapsın".
 *
 * SÖZLEŞME CANLIDAN ÇIKARILDI (2026-08-20, GİTO hesabıyla, tarayıcı üzerinden):
 *   POST {GATEWAY}/InvoiceCreation/SaveUserInvoice     → taslağı kaydeder (NUMARA VERMEZ)
 *   POST {GATEWAY}/InvoiceCreation/ListInvoiceCreation → taslak listesi
 *   POST {GATEWAY}/InvoiceCreation/GetInvoiceCreation  → tek taslağı okur
 *   POST {GATEWAY}/InvoiceCreation/DeleteInvoiceCreation → taslağı siler
 *   POST {GATEWAY}/DocumentView/GetDocument            → görüntü (HTML/PDF/UBL)
 *   POST {GATEWAY}/Tools/GetGIBUserList                → alıcı VKN'den etiket/kayıt
 *
 * ⛔ BİLEREK YAZILMADI — kullanıcı talimatı: "sakın fatura no verip gönder yapma,
 *    firmaya gider fatura yoksa":
 *   • CreateElementId / ControlAndGenerateElementId  (Numara Ver)
 *   • SendUserInvoice / CreateAndSendInvoice          (Alıcıya Gönder)
 *   • ConfirmSmsUserInvoice / SendSmsIVD              (e-Arşiv SMS onayı)
 *   Bu uçların adları biliniyor; gövdeleri İLK GERÇEK GÖNDERİMDE, kullanıcı kendi eliyle
 *   "Numara Ver ve Gönder" derken yakalanacak. Tahminle çağrılmayacak.
 *
 * KİMLİK: portal API'si Bearer jeton ister (tarayıcıda localStorage.access_token).
 *   Jeton portal girişinden gelir (/Account/CheckLogin → {IsSuccess, Message, Data}).
 *   Giriş gövdesinin tam şekli HENÜZ BİLİNMİYOR — bu yüzden jeton şimdilik
 *   entegrasyon ayarından okunur (config.taxpayers[id].portalToken).
 */
@Injectable()
export class ElogoPortalService {
  private readonly logger = new Logger(ElogoPortalService.name);

  /** Portal API ağ geçidi (canlıda gözlendi). */
  static readonly GATEWAY = 'https://efatura-apigateway-g.elogo.com.tr';

  constructor(private readonly prisma: PrismaService) {}

  // ————————————————————————————————————————————————————————————————
  // GÖVDE ÜRETİMİ (saf — ağ yok, testlenebilir)
  // ————————————————————————————————————————————————————————————————

  /**
   * SaveUserInvoice gövdesi. Alan adları CANLI İSTEKTEN alındı; uydurma alan yok.
   *
   * FATURA NUMARASI YOK: gövdede numara alanı BİLİNÇLİ olarak bulunmaz. Numara ancak
   *   "Numara Ver" adımında verilir; kullanıcı kuralı: numara verilmiş fatura eLogo'da
   *   iptal/silme kabul etmiyor.
   */
  static payloadOlustur(g: {
    /** 0 = yeni taslak, dolu = mevcut taslağı güncelle (Değiştir) */
    id?: number;
    /** ETTN — taslağa bir kez üretilip SAKLANIR, her kayıtta değişmez */
    uuid: string;
    /** "YYYY-MM-DD HH:mm:ss" — İstanbul saati */
    faturaTarihi: string;
    onEk: string;
    tasarimId: number;
    aliciId: number;
    aliciVkn: string;
    aliciUnvan: string;
    aliciEtiket: string;
    aliciTipi?: number;
    aciklama: string;
    miktar: number;
    birimKodu: string;
    birimFiyat: number;
    matrah: number;
    kdvOrani: number;
    kdvTutari: number;
    toplam: number;
    yaziyla: string;
    ticariMi: boolean;
  }): any {
    const profil = g.ticariMi ? 'TICARIFATURA' : 'TEMELFATURA';
    return {
      id: g.id || 0,
      IssueDate: g.faturaTarihi,
      Uuid: g.uuid,
      ElementType: 0,
      ProfileId: profil,
      DocumentTypeCode: 'SATIS',
      CustomerId: g.aliciId,
      RequiredPayment: g.toplam,
      InvoicePrefix: g.onEk,
      CurrencyUnit: 'TRY',
      InvoiceType: 0,
      PaymentText: g.yaziyla,
      Customer: {
        id: g.aliciId,
        VknTckn: g.aliciVkn,
        PartyName: g.aliciUnvan,
        Alias: g.aliciEtiket,
        CountryIdentificationCode: 'TR',
        Type: g.aliciTipi ?? 2,
        UploadAddressBook: false,
        FreeInvoice: false,
        fromGetInvoice: true,
        invoiceDate: g.faturaTarihi.replace(' ', 'T'),
        profileId: profil,
        checkEtahsilatLink: false,
      },
      UserInvoiceProductsAndServicesList: [
        {
          id: 0,
          Name: g.aciklama,
          OrderAmount: g.miktar,
          UnitCode: g.birimKodu,
          UnitPrice: g.birimFiyat,
          Cost: g.matrah,
          TaxesTotalAmount: g.kdvTutari,
          STPJ_Visible: false,
          KDV_GERCEK_Visible: true,
          KDV_GERCEK_Orani: g.kdvOrani,
          KDV_GERCEK_Tutari: g.kdvTutari,
          KKDF_KESINTI_Visible: false,
          OTV_1_LISTE_Visible: false,
          OTV_2_LISTE_Visible: false,
        },
      ],
      isErrorFromGIB: false,
      KDVTaxReturnType: 0,
      XsltType: 0,
      InvoiceCreationType: 0,
      SendType: 0,
      DesignId: g.tasarimId,
      FreeInvoice: false,
      CalculationType: 0,
      CheckETahsilatLink: false,
      bypassAmountWarning: true,
    };
  }

  // ————————————————————————————————————————————————————————————————
  // AĞ KATMANI
  // ————————————————————————————————————————————————————————————————

  private async jeton(tenantId: string, taxpayerId: string): Promise<string> {
    const baglanti: any = await (this.prisma as any).integrationConnection.findFirst({
      where: { tenantId, provider: 'ELOGO', isActive: true },
      select: { config: true },
    });
    const tp: any = ((baglanti?.config || {}).taxpayers || {})[taxpayerId] || {};
    const jeton = String(tp.portalToken || '').trim();
    if (!jeton) {
      throw new BadRequestException(
        'eLogo portal jetonu tanımlı değil. Entegratörler ekranından bu mükellef için portal ' +
          'girişi tanımlanmalı (Bearer jeton). Jeton olmadan eLogo taslağı oluşturulamaz.',
      );
    }
    return jeton;
  }

  private async cagir(jeton: string, yol: string, govde: any): Promise<any> {
    const cevap = await fetch(`${ElogoPortalService.GATEWAY}${yol}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
      body: JSON.stringify(govde),
    });
    const metin = await cevap.text();
    if (cevap.status === 401 || cevap.status === 403) {
      throw new BadRequestException('eLogo portal jetonu geçersiz ya da süresi dolmuş — yenilenmeli.');
    }
    if (!cevap.ok) {
      throw new BadRequestException(`eLogo portal hatası (${cevap.status}): ${metin.slice(0, 300)}`);
    }
    try {
      return JSON.parse(metin);
    } catch {
      return metin;
    }
  }

  /** Alıcıyı GİB kayıtlarında sorgular; etiket ve adres defteri kimliği buradan gelir. */
  async aliciSorgu(tenantId: string, taxpayerId: string, vkn: string, tarihISO: string) {
    const jeton = await this.jeton(tenantId, taxpayerId);
    return this.cagir(jeton, '/Tools/GetGIBUserList', {
      id: String(vkn),
      documentType: 2,
      registerTime: tarihISO,
    });
  }

  /** Taslağı KAYDEDER. Numara VERMEZ, hiçbir yere göndermez. */
  async taslakKaydet(tenantId: string, taxpayerId: string, govde: any) {
    const jeton = await this.jeton(tenantId, taxpayerId);
    const sonuc = await this.cagir(jeton, '/InvoiceCreation/SaveUserInvoice', govde);
    this.logger.log(`[ELOGO-PORTAL] taslak kaydedildi · alici=${govde?.Customer?.VknTckn} · tutar=${govde?.RequiredPayment}`);
    return sonuc;
  }

  /** Kaydedilmiş taslağın görüntüsü. Numara harcamaz. */
  async belgeGoruntu(
    tenantId: string,
    taxpayerId: string,
    id: number,
    olusturma: string,
    bicim: 'HTML' | 'PDF' | 'UBL' = 'HTML',
  ) {
    const jeton = await this.jeton(tenantId, taxpayerId);
    return this.cagir(jeton, '/DocumentView/GetDocument', {
      id,
      DocType: 0,
      DocFormat: bicim,
      isCreation: true,
      getAllAccount: false,
      Created: olusturma,
      invoiceCreationType: null,
    });
  }

  /** eLogo'daki taslak listesi (Fatura Oluştur ekranı). */
  async taslakListesi(tenantId: string, taxpayerId: string, sayfa = 1, adet = 50) {
    const jeton = await this.jeton(tenantId, taxpayerId);
    return this.cagir(jeton, '/InvoiceCreation/ListInvoiceCreation', {
      Status: -99,
      InvoiceType: -99,
      GetAllAccount: 0,
      UploadType: -1,
      pageNo: sayfa,
      pageSize: adet,
      sortCol: '',
      direction: '',
    });
  }

  /** Taslağı okur (düzeltme ekranının beslendiği uç). */
  async taslakOku(tenantId: string, taxpayerId: string, id: number) {
    const jeton = await this.jeton(tenantId, taxpayerId);
    return this.cagir(jeton, '/InvoiceCreation/GetInvoiceCreation', { id });
  }

  /**
   * Taslağı SİLER. Yalnız NUMARASIZ taslak silinebilir — numara verilmiş fatura
   * eLogo'da silinemez (kullanıcı kuralı, 2026-08-20).
   */
  async taslakSil(tenantId: string, taxpayerId: string, id: number) {
    const jeton = await this.jeton(tenantId, taxpayerId);
    const sonuc = await this.cagir(jeton, '/InvoiceCreation/DeleteInvoiceCreation', { id });
    this.logger.log(`[ELOGO-PORTAL] taslak silindi · id=${id}`);
    return sonuc;
  }
}
