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
 *   ✓ ÖNİZLEME ÇÖZÜLDÜ (eLogo dokümanı, "Belge görsel tasarımını belirleme"):
 *              paramList'e **UseDefaultXSLT=1** eklenince eLogo belgeyi hesabın ÖN TANIMLI
 *              tasarımıyla basıyor ve HTML olarak döndürüyor (~66 KB). Eksikken içerik boş
 *              geliyordu; hangi tasarımla basacağını bilmiyordu.
 *              (XSLTUUID=... ile belirli bir tasarım da seçilebilir.)
 *   ✓ CEVAP AYRIŞTIRMA TUZAĞI: içerik <a:binaryData><a:Value>BASE64</a:Value> içindedir.
 *              binaryData bloğunun TAMAMINI base64 çözünce 66 KB anlamsız ikili veri çıkar.
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
  saticiPostaKodu?: string;
  saticiMersis?: string;
  saticiVergiDairesi?: string;
  aliciVkn: string;
  aliciUnvan: string;
  aliciAdres: string;
  aliciIlce?: string;
  aliciIl?: string;
  aliciVergiDairesi?: string;
  aliciPostaKodu?: string;
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
  /**
   * Bir ani Europe/Istanbul saatiyle "YYYY-MM-DD" + "HH:mm:ss" olarak yazar.
   * Sunucunun TZ ayarina BAGLI DEGILDIR (Railway'de TZ=Europe/Istanbul ama yerelde/testte
   * baska olabilir; ayni belge her yerde ayni cikmali).
   */
  static tarihSaatTR(t: Date): { tarih: string; saat: string } {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(t);
    const al = (k: string) => (p.find((x) => x.type === k) || ({} as any)).value || '00';
    return { tarih: `${al('year')}-${al('month')}-${al('day')}`, saat: `${al('hour')}:${al('minute')}:${al('second')}` };
  }

  /**
   * Serbest yazilmis adres metninden ilce/il ayiklar.
   * NEDEN METINDEN: mukellef kaydinda ayri il/ilce alani YOK — sema'da yalniz `address` var.
   * Cikaramazsak BOS doneriz; UYDURMAYIZ (bos il, faturada eksik adres demektir ve
   * cagiran taraf bunu kullaniciya UYARI olarak bildirir).
   *   "... NO 38/4 BUYUKCEKMECE / ISTANBUL"   -> ilce=BUYUKCEKMECE  il=ISTANBUL
   *   "... CAD. NO: 1 /1 ARNAVUTKOY/ ISTANBUL" -> ilce=ARNAVUTKOY    il=ISTANBUL
   */
  static adresParcala(adres: string): { ilce: string; il: string } {
    const m = String(adres || '').trim()
      .match(/([A-Za-zÇĞİIÖŞÜçğıöşü]{3,})\s*\/\s*([A-Za-zÇĞİIÖŞÜçğıöşü]{3,})\s*$/);
    return m ? { ilce: m[1].trim(), il: m[2].trim() } : { ilce: '', il: '' };
  }

  ublOlustur(g: ElogoFaturaGirdi, uuid = randomUUID().toUpperCase()): string {
    // TARIH/SAAT — KULLANICI BULGUSU 2026-08-20: onizlemede saat "03:00:00" cikiyordu.
    //   KOK NEDEN: taslagin faturaTarihi'ni Prisma UTC gece yarisi olarak veriyor
    //   (2026-08-20T00:00:00Z); bunu getHours() ile YEREL okuyunca (TZ=Europe/Istanbul)
    //   3'e kayiyordu. Cozum: bicimlendirmeyi ACIKCA Istanbul'a sabitle — boylece sunucu
    //   saat dilimi ne olursa olsun ayni ciktiyi verir. Cagiran taraf da gercek duzenleme
    //   anini gonderir (bkz. taslaktanOnizleme). Gercek eLogo faturasi da gercek saati
    //   tasiyor: AAA2026000000045 -> IssueTime 15:30:41.
    const { tarih, saat } = ElogoFaturaService.tarihSaatTR(g.faturaTarihi);
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
      </cac:PartyIdentification>${g.saticiMersis ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="MERSISNO">${e(g.saticiMersis)}</cbc:ID>
      </cac:PartyIdentification>` : ''}
      <cac:PartyName>
        <cbc:Name>${e(g.saticiUnvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${e(g.saticiAdres)}</cbc:StreetName>
        <cbc:CitySubdivisionName>${e(g.saticiIlce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${e(g.saticiIl)}</cbc:CityName>${g.saticiPostaKodu ? `
        <cbc:PostalZone>${e(g.saticiPostaKodu)}</cbc:PostalZone>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${e(g.saticiVergiDairesi || '')}</cbc:Name>
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
          <b:string>UseDefaultXSLT=1</b:string>
        </paramList>
        <document xmlns:d="${NS}">
          <d:binaryData><d:Value>${b64}</d:Value><d:contentType>application/zip</d:contentType></d:binaryData>
          <d:currentDate>${simdi}</d:currentDate>
          <d:fileName>${this.esc(icXmlAdi.replace(/\.xml$/i, '.zip'))}</d:fileName>
          <d:hash>${hash}</d:hash>
        </document>
      </GetDocumentPreView>`);

      // CEVAP: <outDocument><a:binaryData><a:Value>BASE64</a:Value>...  — Value'yu AL,
      //   binaryData blogunun TAMAMINI degil. (Ilk yazimda blogu alip base64 cozunce
      //   66 KB'lik anlamsiz ikili veri cikti; ne zip ne PDF ne metin.)
      const disBlok = this.etiket(xml, 'binaryData') || '';
      const donen = (disBlok.match(/<(?:[\w.-]+:)?Value[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Value>/) || [])[1] || '';
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

  /**
   * ALICI e-FATURA MÜKELLEFİ Mİ? — fatura TÜRÜNÜ bu belirler.
   *
   * Doküman (eLogo Arabirim Dokümanı, CheckGibUser): "Mükellef bilgisi sorgular. Gelir
   * İdaresinin yayınladığı mükellef listesinden mükellef durumunu kontrol eder ve etiket
   * bilgilerini döner. Bir seferde en fazla 100 adet mükellef sorgulanabilir."
   *
   *   kayıtlı  → e-Fatura  (DOCUMENTTYPE=EINVOICE)
   *   kayıtsız → e-Arşiv   (DOCUMENTTYPE=EARCHIVE)
   *
   * SALT OKUMA. Cevap byte[] (userInfo) olarak geliyor; içeriği zip ya da düz metin
   * olabilir — ikisi de denenir, TAHMİN EDİLMEZ.
   */
  async mukellefSorgu(tenantId: string, taxpayerId: string, vknListesi: string[]) {
    const { kullanici, sifre, url } = await this.kimlik(tenantId, taxpayerId);
    const oturum = await this.girisYap(url, kullanici, sifre);
    try {
      const NS_ARR = 'http://schemas.microsoft.com/2003/10/Serialization/Arrays';
      const liste = vknListesi.slice(0, 100).map((v) => `<b:string>${this.esc(v)}</b:string>`).join('');
      const xml = await this.soap(url, 'CheckGibUser', `<CheckGibUser xmlns="${SOAP_NS}">
        <sessionID>${this.esc(oturum)}</sessionID>
        <vknTcknList xmlns:b="${NS_ARR}">${liste}</vknTcknList>
      </CheckGibUser>`);
      // CEVAP YAPISI CANLI GORULDU (2026-08-20): dokumanda "out byte[] userInfo" yaziyor ama
      //   servis <userList> icinde DUZ XML donduruyor: her <a:GibUserType> bir mukellef,
      //   icindeki <a:GibUserInfoType> bloklarinda <a:Identifier> (VKN) ve <a:Alias> (etiket).
      //   ETIKET SAYISI ONEMLI: dokuman "etiket gonderilmezse birden fazla etikette HATA
      //   uretilir" diyor, o yuzden etiketleri de dondurmek zorundayiz.
      const sonuc = this.etiket(xml, 'resultCode');
      const mesaj = this.etiket(xml, 'resultMsg') || '';
      const mukellefler: Array<{ vkn: string; eFaturaMi: boolean; etiketler: string[] }> = [];
      for (const blok of xml.split(/<a:GibUserType>/).slice(1)) {
        const govde = blok.split('</a:GibUserType>')[0];
        const kimlikler = [...govde.matchAll(/<a:Identifier>([^<]*)<\/a:Identifier>/g)].map((m) => m[1].trim());
        const etiketler = [...govde.matchAll(/<a:Alias>([^<]*)<\/a:Alias>/g)].map((m) => m[1].trim()).filter(Boolean);
        const vkn = kimlikler.find((k) => /^\d{10}$|^\d{11}$/.test(k)) || kimlikler[0] || '';
        if (vkn) mukellefler.push({ vkn, eFaturaMi: etiketler.length > 0, etiketler });
      }
      return { sonucKodu: Number(sonuc || 0), mesaj, mukellefler, hamXml: xml };
    } finally {
      await this.cikisYap(url, oturum);
    }
  }

  /**
   * Bir UBL bloğundan etiket değeri okur. REGEX YOK — kaçış karakteri tuzağına düşmemek
   * ve kendi kendini kapatan boş etiketleri (<cbc:Room />) yanlış okumamak için düz arama.
   */
  private static ublDeger(blok: string, etiket: string): string {
    const bas = blok.indexOf('<' + etiket);
    if (bas < 0) return '';
    const kapa = blok.indexOf('>', bas);
    if (kapa < 0) return '';
    if (blok[kapa - 1] === '/') return '';
    const son = blok.indexOf('</' + etiket + '>', kapa);
    return son < 0 ? '' : blok.slice(kapa + 1, son).trim();
  }

  /** <cbc:ID schemeID="VKN"> / schemeID="MERSISNO" gibi kimlik alanlarını okur. */
  private static ublKimlik(blok: string, sema: string): string {
    const im = 'schemeID="' + sema + '"';
    const i = blok.indexOf(im);
    if (i < 0) return '';
    const kapa = blok.indexOf('>', i);
    const son = blok.indexOf('</cbc:ID>', kapa);
    return son < 0 ? '' : blok.slice(kapa + 1, son).trim();
  }

  /**
   * Bir faturanın SATICI ya da ALICI tarafını olduğu gibi çıkarır.
   */
  static ublTarafOku(xml: string, taraf: 'AccountingSupplierParty' | 'AccountingCustomerParty') {
    const bas = xml.indexOf('<cac:' + taraf);
    const son = xml.indexOf('</cac:' + taraf + '>');
    if (bas < 0 || son < 0 || son < bas) return null;
    const b = xml.slice(bas, son);
    const adresBlok = (b.split('<cac:PostalAddress>')[1] || '').split('</cac:PostalAddress>')[0] || '';
    const adBlok = b.split('<cac:PartyName>')[1] || '';
    const vergiBlok = b.split('<cac:PartyTaxScheme>')[1] || '';
    const vkn = ElogoFaturaService.ublKimlik(b, 'VKN') || ElogoFaturaService.ublKimlik(b, 'TCKN');
    if (!vkn) return null;
    return {
      vkn,
      mersis: ElogoFaturaService.ublKimlik(b, 'MERSISNO'),
      unvan: ElogoFaturaService.ublDeger(adBlok, 'cbc:Name'),
      adres: ElogoFaturaService.ublDeger(adresBlok, 'cbc:StreetName'),
      ilce: ElogoFaturaService.ublDeger(adresBlok, 'cbc:CitySubdivisionName'),
      il: ElogoFaturaService.ublDeger(adresBlok, 'cbc:CityName'),
      postaKodu: ElogoFaturaService.ublDeger(adresBlok, 'cbc:PostalZone'),
      vergiDairesi: ElogoFaturaService.ublDeger(vergiBlok, 'cbc:Name'),
      telefon: ElogoFaturaService.ublDeger(b, 'cbc:Telephone'),
    };
  }

  /**
   * TARAF BİLGİSİ MÜKELLEFİN KENDİ FATURALARINDAN GELİR.
   * Kullanıcı sorusu (2026-08-20): "eLogo kullanan her firma için sana bilgi mi vereceğim?"
   *   HAYIR. Mükellefin entegratörden çekilmiş GİDEN faturaları UBL'iyle veritabanında
   *   duruyor (efatura_inbox · direction=OUT · ublXmlRaw). Satıcı bloğunu oradan AYNEN
   *   alırız: adres, ilçe/il, posta kodu, vergi dairesi, MERSİS, telefon.
   *   Aynı alıcıya daha önce fatura kesilmişse ALICI adresi de oradan gelir — bot bir daha
   *   adres sormaz.
   * Hiç giden fatura yoksa null döner; çağıran taraf mükellef kaydına düşer ve eksikse
   *   kullanıcıyı UYARIR (uydurmaz).
   */
  async taraflarGecmisten(tenantId: string, taxpayerId: string, aliciVkn?: string) {
    const kayitlar: any[] = await (this.prisma as any).eFaturaInbox.findMany({
      where: { tenantId, taxpayerId, direction: 'OUT', ublXmlRaw: { not: null } },
      orderBy: { faturaDate: 'desc' },
      take: 30,
      select: { ublXmlRaw: true, faturaNo: true, faturaDate: true },
    }).catch(() => [] as any[]);

    let satici: any = null;
    let saticiKaynak: string | null = null;
    let alici: any = null;
    let aliciKaynak: string | null = null;
    for (const k of kayitlar) {
      const xml = String(k.ublXmlRaw || '');
      if (!satici) {
        const t = ElogoFaturaService.ublTarafOku(xml, 'AccountingSupplierParty');
        if (t) { satici = t; saticiKaynak = k.faturaNo || null; }
      }
      if (aliciVkn && !alici) {
        const t = ElogoFaturaService.ublTarafOku(xml, 'AccountingCustomerParty');
        if (t && t.vkn === String(aliciVkn)) { alici = t; aliciKaynak = k.faturaNo || null; }
      }
      if (satici && (alici || !aliciVkn)) break;
    }
    return { satici, alici, saticiKaynak, aliciKaynak, bakilanFatura: kayitlar.length };
  }

  /**
   * FATURA NUMARASI — portalda tanımlı ön ek ve kalınan son numara.
   * Doküman: GetPrefixLastNumberList(sessionID, paramList{DOCUMENTTYPE, PREFIXYEAR}).
   * SALT OKUMA — numara TÜKETMEZ, yalnız mevcut durumu okur.
   */
  async sonNumara(tenantId: string, taxpayerId: string, belgeTuru: 'EINVOICE' | 'EARCHIVE' = 'EINVOICE', yil?: number) {
    const { kullanici, sifre, url } = await this.kimlik(tenantId, taxpayerId);
    const oturum = await this.girisYap(url, kullanici, sifre);
    try {
      const NS_ARR = 'http://schemas.microsoft.com/2003/10/Serialization/Arrays';
      const y = yil || new Date().getFullYear();
      const xml = await this.soap(url, 'GetPrefixLastNumberList', `<GetPrefixLastNumberList xmlns="${SOAP_NS}">
        <sessionID>${this.esc(oturum)}</sessionID>
        <paramList xmlns:b="${NS_ARR}">
          <b:string>DOCUMENTTYPE=${belgeTuru}</b:string>
          <b:string>PREFIXYEAR=${y}</b:string>
        </paramList>
      </GetPrefixLastNumberList>`);
      // HER BLOK AYRI OKUNUR. Ilk yazdigim regex iki blogu karistirip AA9'un numarasini
      //   AAA'nin sayacindan aliyordu (canli: AA9=0, AAA=48). Blok blok ayirmak sart.
      const onEkler: Array<{ onEk: string; sonNo: number }> = [];
      for (const blok of xml.split(/<a:PrefixLastNumber>/).slice(1)) {
        const govde = blok.split('</a:PrefixLastNumber>')[0];
        const onEk = (govde.match(/<a:InvoicePrefix>([^<]*)<\/a:InvoicePrefix>/) || [])[1];
        const sayac = (govde.match(/<a:Counter>(\d+)<\/a:Counter>/) || [])[1];
        if (onEk) onEkler.push({ onEk: onEk.trim(), sonNo: Number(sayac || 0) });
      }
      // Kullanimda olan seri = sayaci EN BUYUK olan (hic kullanilmamis on ekler 0 doner).
      onEkler.sort((a, b) => b.sonNo - a.sonNo);
      return { onEkler, kullanilan: onEkler[0] || null, mesaj: this.etiket(xml, 'resultMsg') || '', hamXml: xml };
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

    // KAYNAK SIRASI: (1) mükellefin KENDİ kesilmiş faturaları — kesin bilgi, elle giriş yok,
    //   (2) mükellef kaydı — elle girilmiş, eksik olabilir. Hiçbiri yetmezse UYARI.
    const gecmis: any = await this.taraflarGecmisten(tenantId, d.taxpayerId, String(d.aliciVkn))
      .catch(() => ({ satici: null, alici: null, saticiKaynak: null, aliciKaynak: null, bakilanFatura: 0 }));

    const kayitAdres = String(tp?.address || '');
    const kayitParca = ElogoFaturaService.adresParcala(kayitAdres);
    const saticiAdres = gecmis.satici?.adres || kayitAdres;
    const satici = {
      ilce: gecmis.satici?.ilce || kayitParca.ilce,
      il: gecmis.satici?.il || kayitParca.il,
    };

    // ALICI: kullanıcının yazdığı adres ÖNCELİKLİ (güncel olan odur); yoksa aynı alıcıya
    //   daha önce kesilmiş faturadan alınır — böylece bot aynı müşteri için adresi tekrar sormaz.
    const adres = String(d.aliciAdres || '') || gecmis.alici?.adres || '';
    const adresParca = ElogoFaturaService.adresParcala(adres);
    const alici = {
      ilce: adresParca.ilce || gecmis.alici?.ilce || '',
      il: adresParca.il || gecmis.alici?.il || '',
    };

    const uyarilar: string[] = [];
    if (!satici.il) uyarilar.push('Satıcının il/ilçe bilgisi bulunamadı (ne kendi faturalarında ne mükellef kaydında) — fatura adresi eksik basılıyor.');
    if (!alici.il) uyarilar.push('Alıcının il/ilçe bilgisi adresten okunamadı.');
    const kaynakNotu = gecmis.satici
      ? `Satıcı bilgileri kendi faturasından alındı${gecmis.saticiKaynak ? ` (${gecmis.saticiKaynak})` : ''}`
      : 'Satıcı bilgileri mükellef kaydından alındı — kendi kesilmiş faturası bulunamadı';

    // DUZENLEME ANI: gun taslagin fatura tarihinden (Prisma bunu UTC gece yarisi verir,
    //   bu yuzden UTC bilesenleri alinir), SAAT ise taslagin olusturuldugu gercek andan.
    const gunD = new Date(d.faturaTarihi);
    const saatTR = ElogoFaturaService.tarihSaatTR(new Date(d.createdAt || Date.now())).saat;
    const duzenlemeAni = new Date(
      `${gunD.getUTCFullYear()}-${this.ik(gunD.getUTCMonth() + 1)}-${this.ik(gunD.getUTCDate())}T${saatTR}+03:00`,
    );

    const ubl = this.ublOlustur({
      saticiVkn: String(tp?.taxNumber || ''),
      saticiUnvan: saticiAd,
      saticiAdres: saticiAdres,
      saticiIlce: satici.ilce,
      saticiIl: satici.il,
      saticiTel: gecmis.satici?.telefon || String(tp?.phone || ''),
      saticiPostaKodu: gecmis.satici?.postaKodu || undefined,
      saticiMersis: gecmis.satici?.mersis || undefined,
      saticiVergiDairesi: gecmis.satici?.vergiDairesi || String(tp?.taxOffice || ''),
      aliciVkn: String(d.aliciVkn),
      aliciUnvan: String(d.aliciUnvan),
      aliciAdres: adres,
      aliciIlce: alici.ilce,
      aliciIl: alici.il,
      aliciVergiDairesi: String(d.aliciVd || '') || gecmis.alici?.vergiDairesi || '',
      faturaNo: String(d.faturaNo || 'ONIZLEME'),
      faturaTarihi: duzenlemeAni,
      aciklama: String(d.aciklama),
      miktar: Number(d.miktar) || 1,
      matrah: Number(d.matrah),
      kdvOrani: Number(d.kdvOrani),
      kdvTutari: Number(d.kdvTutari),
      toplam: Number(d.toplam),
    });
    // BELGE TÜRÜ VKN'DEN TÜRETİLİR (kullanıcı kuralı): alıcı e-Fatura mükellefiyse EINVOICE,
    //   değilse EARCHIVE. Sorgu başarısız olursa e-Fatura varsayılır ve bu NOT olarak döner —
    //   sessizce yanlış tür seçilmez.
    let belgeTuru: 'EINVOICE' | 'EARCHIVE' = 'EINVOICE';
    let etiketler: string[] = [];
    let turNotu: string | null = null;
    try {
      const sorgu = await this.mukellefSorgu(tenantId, d.taxpayerId, [String(d.aliciVkn)]);
      const bulunan = sorgu.mukellefler.find((m) => m.vkn === String(d.aliciVkn));
      if (bulunan) {
        belgeTuru = bulunan.eFaturaMi ? 'EINVOICE' : 'EARCHIVE';
        etiketler = bulunan.etiketler;
      } else turNotu = 'Alıcı GİB listesinde bulunamadı — e-Fatura varsayıldı';
    } catch (e: any) {
      turNotu = `Alıcı sorgulanamadı (${e?.message || 'hata'}) — e-Fatura varsayıldı`;
    }

    const { icerik, tur } = await this.onizlemeAl(tenantId, d.taxpayerId, ubl, `${d.faturaNo || 'onizleme'}.xml`, belgeTuru);
    return { icerik, tur, ubl, belgeTuru, etiketler, turNotu, uyarilar, kaynakNotu };
  }
}
