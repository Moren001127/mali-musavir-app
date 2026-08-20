import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { tryDecrypt } from '../common/crypto';
import * as JSZip from 'jszip';

/**
 * eLOGO ÜZERİNDEN FATURA — ÖNİZLEME.
 *
 * NEDEN AYRI BİR SERVİS: GİB e-Arşiv portalı 52 alanlık bir FORM alır; eLogo ise UBL-TR
 * XML ister ve SOAP ile konuşur. İki kapı bambaşka.
 *
 * SÖZLEŞME KAYNAĞI — TAHMİN YOK, İKİ CANLI KANIT:
 *   1) UBL şablonu: GİTO GIDA'nın eLogo'dan KESTİĞİ gerçek faturalar
 *      (efatura_inbox, direction=OUT). Aynı alıcıya (SELİM İNŞAAT) kesilmiş, aynı içerik
 *      ("YEMEK BEDELİ"), aynı oran (%10) fatura şablon olarak alındı.
 *   2) SOAP sözleşmesi: canlı WSDL (https://pb.elogo.com.tr/PostBoxService.svc?wsdl)
 *      Login(login{userName,passWord,appStr,source,version}) -> {LoginResult, sessionID}
 *      GetDocumentPreView(sessionID, paramList[], document{binaryData,currentDate,fileName,hash})
 *        -> {ResultType, outDocument}
 *
 * GÜVENLİK — BU SERVİS FATURA GÖNDERMEZ:
 *   • Yalnız GetDocumentPreView çağrılır. Bu işlem belge OLUŞTURMAZ, GİB'e gitmez,
 *     alıcıya gitmez, numara tüketmez. Sadece "bu XML nasıl görünür" sorusunu yanıtlar.
 *   • SendDocument / SendDraftDocument BİLİNÇLİ OLARAK YAZILMADI. Gerçek gönderim ayrı bir
 *     adımdır ve ayrı onay ister.
 *   • İMZA/MALİ MÜHÜR BİZDE DEĞİL: alınan faturalarda XAdES imza bloğu var, onu entegratör
 *     ekler. Bizim ürettiğimiz XML imzasızdır.
 *
 * CANLI DENEME SONUCU (2026-08-20, GİTO kimliğiyle) — NEREYE KADAR ÇALIŞTI:
 *   ✓ Login  — gövde şekli: <login> sarmalayıcı + ALFABETİK alanlar (appStr, passWord,
 *              userName, version). Düz alanlar "internal error", sıra bozuk olunca
 *              "Hatalı kullanıcı adı veya şifre" veriyor. DİKKAT: 10 hatalı girişte KİLİT.
 *   ✓ Belge  — ZIP olarak gönderilir. Ham XML'de "Cannot read that as a ZipFile" döner.
 *   ✓ paramList ZORUNLU: DOCUMENTTYPE=EINVOICE|EARCHIVE (+ DATAFORMAT=UBL).
 *              Eksikse "BadRequest (DOCUMENTTYPE parametresi eksik ya da geçersiz)".
 *   ✓ ÜRETTİĞİMİZ UBL KABUL EDİLDİ: GetDocumentPreView resultCode=1 "Başarılı" döndü —
 *              yani eLogo zip'i açtı, XML'i çözdü, şemayı kabul etti.
 *   ✗ AÇIK İŞ: outDocument.binaryData.Value BOŞ (nil) geliyor. Görüntüyü hangi parametreyle
 *              ürettiği BİLİNMİYOR. Denendi ve olmadı: DATAFORMAT=PDF, yalnız DOCUMENTTYPE.
 *              TAHMİN YÜRÜTÜLMEDİ — eLogo entegrasyon dokümanından öğrenilmeli
 *              (muhtemelen bir çıktı biçimi ya da xsltUuid parametresi).
 *   ⇒ Bu yüzden kullanıcıya giden önizleme ŞU AN kendi üreticimizle basılıyor.
 */

const VARSAYILAN_SERVIS = 'https://pb.elogo.com.tr/PostBoxService.svc';
const SOAP_NS = 'http://tempuri.org/';
const SOAP_ACTION_PREFIX = 'http://tempuri.org/IPostBoxService/';

export type ElogoFaturaGirdi = {
  saticiVkn: string;
  saticiUnvan: string;
  saticiAdres: string;
  saticiIlce: string;
  saticiIl: string;
  saticiTel?: string;
  aliciVkn: string;
  aliciUnvan: string;
  aliciAdres: string;
  aliciIlce?: string;
  aliciIl?: string;
  aliciVergiDairesi?: string;
  faturaNo: string;
  faturaTarihi: Date;
  aciklama: string;
  miktar: number;
  matrah: number;
  kdvOrani: number;
  kdvTutari: number;
  toplam: number;
};

/** UBL tutar biçimi: NOKTA ondalık, gereksiz sıfır yok (GİTO'nun kendi faturasında da böyle). */
export function ublTutar(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const y = Math.round((n + Number.EPSILON) * 100) / 100;
  return String(y);
}

const BIRLER = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
const ONLAR = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];

/** Türkçe yazıyla tutar — faturada standart. Kural sabittir, uydurma değildir. */
export function yaziyla(n: number): string {
  const tam = Math.floor(Math.abs(n));
  if (tam === 0) return 'Sıfır';
  const uclu = (s: number): string => {
    const y = Math.floor(s / 100), o = Math.floor((s % 100) / 10), b = s % 10;
    let r = '';
    if (y) r += (y === 1 ? '' : BIRLER[y]) + 'Yüz';
    r += ONLAR[o] + BIRLER[b];
    return r;
  };
  const gruplar = [
    { deger: Math.floor(tam / 1e9) % 1000, ad: 'Milyar' },
    { deger: Math.floor(tam / 1e6) % 1000, ad: 'Milyon' },
    { deger: Math.floor(tam / 1e3) % 1000, ad: 'Bin' },
    { deger: tam % 1000, ad: '' },
  ];
  let out = '';
  for (const g of gruplar) {
    if (!g.deger) continue;
    if (g.ad === 'Bin' && g.deger === 1) out += 'Bin';
    else out += uclu(g.deger) + g.ad;
  }
  return out;
}

@Injectable()
export class ElogoFaturaService {
  private readonly logger = new Logger(ElogoFaturaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private esc(s: any): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  private ik(n: number) { return String(n).padStart(2, '0'); }

  /**
   * UBL-TR fatura XML'i üret.
   *
   * Şablon GİTO'nun kendi kesilmiş faturasından çıkarıldı; eleman sırası ve ad alanları
   * BİREBİR aynıdır (sıra UBL'de zorunludur, karıştırılırsa belge reddedilir).
   * İmza bloğu (ext:UBLExtensions) ve gömülü XSLT KOYULMAZ — onları entegratör ekler.
   */
  ublOlustur(g: ElogoFaturaGirdi, uuid = randomUUID().toUpperCase()): string {
    const t = g.faturaTarihi;
    const tarih = `${t.getFullYear()}-${this.ik(t.getMonth() + 1)}-${this.ik(t.getDate())}`;
    const saat = `${this.ik(t.getHours())}:${this.ik(t.getMinutes())}:${this.ik(t.getSeconds())}`;
    const e = (x: any) => this.esc(x);

    // PROLOG YOK: GİTO'nun eLogo'dan gelen gerçek faturaları da <Invoice ile başlıyor.
    return `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>${e(g.faturaNo)}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${e(uuid)}</cbc:UUID>
  <cbc:IssueDate>${tarih}</cbc:IssueDate>
  <cbc:IssueTime>${saat}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:Note>Yalnız ${e(yaziyla(g.toplam))} TL</cbc:Note>
  <cbc:DocumentCurrencyCode listAgencyName="United Nations Economic Commission for Europe" listID="ISO 4217 Alpha" listName="Currency" listVersionID="2001">TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:Signature>
    <cbc:ID schemeID="VKN_TCKN">${e(g.saticiVkn)}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${e(g.saticiVkn)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>${e(g.saticiIlce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${e(g.saticiIl)}</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
    </cac:SignatoryParty>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${e(g.saticiVkn)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${e(g.saticiUnvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${e(g.saticiAdres)}</cbc:StreetName>
        <cbc:CitySubdivisionName>${e(g.saticiIlce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${e(g.saticiIl)}</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name />
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${e(g.saticiTel || '')}</cbc:Telephone>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${e(g.aliciVkn)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${e(g.aliciUnvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${e(g.aliciAdres)}</cbc:StreetName>
        <cbc:CitySubdivisionName>${e(g.aliciIlce || '')}</cbc:CitySubdivisionName>
        <cbc:CityName>${e(g.aliciIl || '')}</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${e(g.aliciVergiDairesi || '')}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone />
      </cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">${ublTutar(g.kdvTutari)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">${ublTutar(g.matrah)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">${ublTutar(g.kdvTutari)}</cbc:TaxAmount>
      <cbc:Percent>${ublTutar(g.kdvOrani)}</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV GERCEK</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">${ublTutar(g.matrah)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">${ublTutar(g.matrah)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">${ublTutar(g.toplam)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="TRY">0</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="TRY">0</cbc:ChargeTotalAmount>
    <cbc:PayableAmount currencyID="TRY">${ublTutar(g.toplam)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">${ublTutar(g.miktar)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">${ublTutar(g.matrah)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="TRY">${ublTutar(g.kdvTutari)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">${ublTutar(g.matrah)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">${ublTutar(g.kdvTutari)}</cbc:TaxAmount>
        <cbc:Percent>${ublTutar(g.kdvOrani)}</cbc:Percent>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:Name>KDV GERCEK</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${e(g.aciklama)}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>${e(g.aciklama)}</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="TRY">${ublTutar(g.miktar > 0 ? g.matrah / g.miktar : g.matrah)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
  }

  // ---------------- SOAP ----------------

  private async soap(url: string, action: string, govde: string): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: `"${SOAP_ACTION_PREFIX}${action}"` },
      body: `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>${govde}</soapenv:Body>
</soapenv:Envelope>`,
      signal: AbortSignal.timeout(90_000),
    });
    const metin = await res.text();
    // TESHIS: ELOGO_HAM_DUMP tanimliysa ham cevabi dosyaya yaz. Normalde KAPALI.
    //   eLogo hatalari cogu zaman SOAP govdesinde saklidir; ham cevap olmadan kor kalinir.
    if (process.env.ELOGO_HAM_DUMP) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('fs').writeFileSync(`${process.env.ELOGO_HAM_DUMP}-${action}.xml`, metin, 'utf8');
      } catch { /* teshis yazilamadi, akisi bozma */ }
    }
    if (!res.ok && !/soap:Fault|<\w+:Fault/i.test(metin)) {
      throw new Error(`eLogo ${action}: HTTP ${res.status} ${metin.slice(0, 200)}`);
    }
    return metin;
  }

  private etiket(xml: string, ad: string): string | null {
    const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${ad}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${ad}>`, 'i'));
    return m ? m[1] : null;
  }

  /** eLogo kimliği (GİTO gibi mükellef bazlı) — integration_connections.config.taxpayers[id] */
  private async kimlik(tenantId: string, taxpayerId: string) {
    const baglanti: any = await (this.prisma as any).integrationConnection.findFirst({
      where: { tenantId, provider: 'ELOGO', isActive: true },
      select: { config: true },
    });
    const cfg: any = baglanti?.config || {};
    const tp: any = (cfg.taxpayers || {})[taxpayerId] || (cfg.taxpayers || {}).global;
    if (!tp) throw new BadRequestException('Bu mükellefin eLogo bağlantısı tanımlı değil');
    const kullanici = String(tp.username || '').trim();
    const sifre = tryDecrypt(tp.encryptedPassword) || '';
    if (!kullanici || !sifre) throw new BadRequestException('eLogo kullanıcı adı/şifresi eksik');
    return { kullanici, sifre, url: String(tp.baseUrl || cfg.baseUrl || VARSAYILAN_SERVIS) };
  }

  private async girisYap(url: string, kullanici: string, sifre: string): Promise<string> {
    // GİRİŞ GÖVDESİ — DEPODA KANITLI ÇALIŞAN ŞEKİL.
    //   Kaynak: fatura-muhasebelestirme.service.ts (eLogo fatura çekimi bununla çalışıyor).
    //   WCF DataContract alan sırası ALFABETİKTİR: appStr, passWord, userName, version.
    //   Canlı denemeler (2026-08-20):
    //     düz <userName>/<passWord>          -> "internal error" (istek çözülemedi)
    //     sarmalayıcı ama sıra bozuk         -> "Hatalı kullanıcı adı veya şifre"
    //   DİKKAT: eLogo 10 hatalı girişte hesabı KİLİTLER — körlemesine deneme YAPILMAZ.
    const NS_DC = 'http://schemas.datacontract.org/2004/07/eFaturaWebService';
    const xml = await this.soap(url, 'Login',
      `<Login xmlns="${SOAP_NS}">` +
      `<login xmlns:a="${NS_DC}">` +
      `<a:appStr>MOREN</a:appStr>` +
      `<a:passWord>${this.esc(sifre)}</a:passWord>` +
      `<a:userName>${this.esc(kullanici)}</a:userName>` +
      `<a:version>1.0</a:version>` +
      `</login></Login>`);
    const sonuc = this.etiket(xml, 'LoginResult');
    const oturum = this.etiket(xml, 'sessionID');
    if (!oturum || (sonuc && /^false$/i.test(sonuc.trim()))) {
      const hata = this.etiket(xml, 'Text') || this.etiket(xml, 'faultstring') || xml.slice(0, 250);
      throw new BadRequestException(`eLogo girişi başarısız: ${String(hata).slice(0, 250)}`);
    }
    return oturum.trim();
  }

  private async cikisYap(url: string, oturum: string) {
    await this.soap(url, 'Logout', `<Logout xmlns="${SOAP_NS}"><sessionID>${this.esc(oturum)}</sessionID></Logout>`)
      .catch(() => null);
  }

  /**
   * FATURA ÖNİZLEMESİ AL — BELGE OLUŞTURMAZ.
   * GetDocumentPreView yalnız "bu XML nasıl görünür" sorusunu yanıtlar; GİB'e ve alıcıya
   * hiçbir şey gitmez, fatura numarası tüketilmez.
   */
  async onizlemeAl(tenantId: string, taxpayerId: string, ubl: string, dosyaAdi: string, belgeTuru: 'EINVOICE' | 'EARCHIVE' = 'EINVOICE'): Promise<{ icerik: Buffer; tur: string }> {
    const { kullanici, sifre, url } = await this.kimlik(tenantId, taxpayerId);
    const oturum = await this.girisYap(url, kullanici, sifre);
    try {
      // BELGE ZIP OLARAK GONDERILIR — eLogo'nun kendi cevabi (2026-08-20):
      //   ham XML gonderilince "Cannot read that as a ZipFile" donuyor.
      //   Okuma tarafi da zaten zip aciyor (elogoUnzipXml), yani cift yonlu kural.
      const icXmlAdi = dosyaAdi.replace(/\.(xml|zip)$/i, '') + '.xml';
      const zip = new (JSZip as any)();
      zip.file(icXmlAdi, ubl);
      const zipBuf: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const b64 = zipBuf.toString('base64');
      const hash = createHash('md5').update(zipBuf).digest('hex');
      const simdi = new Date().toISOString();
      const NS = 'http://schemas.datacontract.org/2004/07/eFaturaWebService';
      // document alt alanlari WSDL'e gore DataContract ad alanindadir; alfabetik sira
      //   (binaryData, currentDate, fileName, hash) WCF icin ONEMLIDIR.
      // paramList ZORUNLU — eLogo'nun kendi cevabi (2026-08-20):
      //   "BadRequest (DOCUMENTTYPE parametresi eksik ya da gecersiz)"
      //   Degerler cekim tarafindan KANITLI: EINVOICE (e-Fatura) / EARCHIVE (e-Arsiv),
      //   DATAFORMAT=UBL (eksikse cekimde "Gecersiz DATAFORMAT parametresi" donuyordu).
      const NS_ARR = 'http://schemas.microsoft.com/2003/10/Serialization/Arrays';
      const xml = await this.soap(url, 'GetDocumentPreView', `<GetDocumentPreView xmlns="${SOAP_NS}">
        <sessionID>${this.esc(oturum)}</sessionID>
        <paramList xmlns:b="${NS_ARR}">
          <b:string>DOCUMENTTYPE=${belgeTuru}</b:string>
          <b:string>DATAFORMAT=UBL</b:string>
        </paramList>
        <document xmlns:d="${NS}">
          <d:binaryData><d:Value>${b64}</d:Value><d:contentType>application/zip</d:contentType></d:binaryData>
          <d:currentDate>${simdi}</d:currentDate>
          <d:fileName>${this.esc(icXmlAdi.replace(/\.xml$/i, '.zip'))}</d:fileName>
          <d:hash>${hash}</d:hash>
        </document>
      </GetDocumentPreView>`);

      const donen = this.etiket(xml, 'binaryData');
      if (!donen || donen.trim().length < 100) {
        const hata = this.etiket(xml, 'resultMsg') || this.etiket(xml, 'Text') || this.etiket(xml, 'ErrorMessage') || this.etiket(xml, 'faultstring') || '';
        throw new BadRequestException(
          `eLogo önizleme döndürmedi${hata ? ': ' + String(hata).replace(/\s+/g, ' ').slice(0, 250) : ''}`,
        );
      }
      const icerik = Buffer.from(donen.trim(), 'base64');
      const tur = icerik.slice(0, 4).toString('latin1') === '%PDF' ? 'application/pdf' : 'text/html';
      this.logger.log(`[ELOGO] onizleme alindi: ${Math.round(icerik.length / 1024)} KB, tur=${tur}`);
      return { icerik, tur };
    } finally {
      await this.cikisYap(url, oturum);
    }
  }

  /** Taslak kaydından UBL üret + eLogo önizlemesini getir. GÖNDERİM YOK. */
  async taslaktanOnizleme(tenantId: string, draftId: string) {
    const d: any = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!d) throw new NotFoundException('Taslak bulunamadı');
    const tp: any = await (this.prisma as any).taxpayer.findFirst({
      where: { id: d.taxpayerId, tenantId },
      select: { companyName: true, firstName: true, lastName: true, taxNumber: true, address: true, phone: true, taxOffice: true },
    });
    const saticiAd = tp?.companyName || [tp?.firstName, tp?.lastName].filter(Boolean).join(' ') || '';
    const adres = String(d.aliciAdres || '');
    const ilce = (adres.match(/([A-ZÇĞİÖŞÜa-zçğıöşü]+)\s*\/\s*[A-ZÇĞİÖŞÜa-zçğıöşü]+\s*$/) || [])[1] || '';
    const il = (adres.match(/\/\s*([A-ZÇĞİÖŞÜa-zçğıöşü]+)\s*$/) || [])[1] || 'İSTANBUL';

    const ubl = this.ublOlustur({
      saticiVkn: String(tp?.taxNumber || ''),
      saticiUnvan: saticiAd,
      saticiAdres: String(tp?.address || ''),
      saticiIlce: '',
      saticiIl: '',
      saticiTel: String(tp?.phone || ''),
      aliciVkn: String(d.aliciVkn),
      aliciUnvan: String(d.aliciUnvan),
      aliciAdres: adres,
      aliciIlce: ilce,
      aliciIl: il,
      aliciVergiDairesi: String(d.aliciVd || ''),
      faturaNo: String(d.faturaNo || 'ONIZLEME'),
      faturaTarihi: new Date(d.faturaTarihi),
      aciklama: String(d.aciklama),
      miktar: Number(d.miktar) || 1,
      matrah: Number(d.matrah),
      kdvOrani: Number(d.kdvOrani),
      kdvTutari: Number(d.kdvTutari),
      toplam: Number(d.toplam),
    });
    const { icerik, tur } = await this.onizlemeAl(tenantId, d.taxpayerId, ubl, `${d.faturaNo || 'onizleme'}.xml`, 'EINVOICE');
    return { icerik, tur, ubl };
  }
}
