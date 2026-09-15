/**
 * SINIFLANDIRMA İÇERİK METNİ + ENTEGRATÖR BAYRAĞI (2026-09-15 canlı bulguları — ÖZ ELA / GİTO GIDA).
 *  - UBL XML'in ilk 9000 karakteri imza sertifikası + XSLT base64 → kalemler görünmüyor, model "Uyumsoft yazılım" diyordu.
 *  - TÜRMOB IptalItirazDurumu=1 çıplak bayrağı belge oluşturmayı sessizce engelliyordu (ekran "aktarılabilir" gösteriyordu).
 */
jest.mock('./fatura-muhasebelestirme.service', () => jest.requireActual('./fatura-muhasebelestirme.service'));
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

const svc: any = Object.create(FaturaMuhasebelestirmeService.prototype);
svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

describe('sinifIcerikMetni', () => {
  const base64 = 'MIIF' + 'QWxhZGRpbjpvcGVuIHNlc2FtZQ=='.repeat(40); // ≥120 karakter imza/XSLT bloğu
  const hamXml = `<?xml version="1.0"?><Invoice><ext:UBLExtensions><ds:X509Certificate>${base64}</ds:X509Certificate><cbc:Name>Uyumsoft Bilgi Sistemleri</cbc:Name></ext:UBLExtensions>`
    + `<cac:AdditionalDocumentReference><cbc:EmbeddedDocumentBinaryObject>${base64}${base64}</cbc:EmbeddedDocumentBinaryObject></cac:AdditionalDocumentReference>`
    + `<cac:InvoiceLine><cac:Item><cbc:Name>SERVİS TAŞIMACILIĞI HİZMET BEDELİ</cbc:Name></cac:Item></cac:InvoiceLine></Invoice>`;
  const parsed = {
    belgeNo: 'SLH2026000000028', tarih: '31.08.2026', saticiAd: 'SELAHATTİN KARA', saticiVkn: '43927776016', aliciAd: 'ÖZ ELA TURİZM', aliciVkn: '6620808781',
    toplam: 11520, kdv: [{ oran: 20, matrah: 9600, kdv: 1920 }],
    kalemler: [{ ad: 'SERVİS TAŞIMACILIĞI HİZMET BEDELİ', tutar: 9600, oran: 20 }],
  };

  it('XML belgede ayrıştırılmış kalemler BAŞTA, base64 imza/XSLT blokları atılır, entegratör adı içerik sayılmaz', () => {
    const metin: string = svc.sinifIcerikMetni(parsed, { kalemMetniKaynak: null, hamMetin: hamXml, yon: 'ALIS' });
    expect(metin.startsWith('BELGE ÖZETİ')).toBe(true);
    expect(metin.indexOf('SERVİS TAŞIMACILIĞI HİZMET BEDELİ')).toBeLessThan(metin.indexOf('Ham belge metni'));
    expect(metin).toContain('Fatura kalemleri (1): 1) SERVİS TAŞIMACILIĞI HİZMET BEDELİ — 9.600,00 TL (KDV %20)');
    expect(metin).toContain('Matrah: 9.600,00 TL · KDV: 1.920,00 TL · Toplam: 11.520,00 TL');
    expect(metin).toContain('Satıcı: SELAHATTİN KARA (VKN 43927776016)');
    expect(metin).not.toContain('MIIF'); // base64 bloğu yok
    expect(metin).toContain('imza/entegratör bilgileri içerik DEĞİLDİR');
    expect(metin.length).toBeLessThanOrEqual(9000);
  });

  it('PDF/görselden tamamlanan kalemler (_kalemMetni) özet bloğuna girer; kalem yoksa yalnız ham metin', () => {
    const m1: string = svc.sinifIcerikMetni({ ...parsed, kalemler: [], _kalemMetni: 'MOTORİN BEDELİ; AKARYAKIT' }, { kalemMetniKaynak: "PDF'inden", hamMetin: '<a>x</a>', yon: 'ALIS' });
    expect(m1).toContain("Fatura kalemleri (belgenin PDF'inden okundu): MOTORİN BEDELİ; AKARYAKIT");
    const m2: string = svc.sinifIcerikMetni({}, { kalemMetniKaynak: null, hamMetin: 'düz metin fatura içeriği', yon: 'ALIS' });
    expect(m2).toBe('Ham belge metni (yardımcı; imza/entegratör bilgileri içerik DEĞİLDİR): düz metin fatura içeriği');
  });

  it('çok uzun ham metin 9000 karakterde kesilir, özet bloğu korunur', () => {
    const uzun = 'kelime '.repeat(5000);
    const m: string = svc.sinifIcerikMetni(parsed, { kalemMetniKaynak: null, hamMetin: uzun, yon: 'SATIS' });
    expect(m.length).toBeLessThanOrEqual(2000 + 700); // kalemler özette → ham metin 2000 karakter (maliyet)
    const m0: string = svc.sinifIcerikMetni({}, { kalemMetniKaynak: null, hamMetin: uzun, yon: 'ALIS' });
    expect(m0.length).toBeLessThanOrEqual(9000); // kalem yoksa ham metin tek içerik: 9000
    expect(m0.length).toBeGreaterThan(8000);
    expect(m).toContain('Yön: SATIŞ (mükellef kesti)');
    expect(m).toContain('SERVİS TAŞIMACILIĞI HİZMET BEDELİ');
  });
});

describe('belgeDurumuEngelli — çıplak bayrak', () => {
  it("iptalItiraz='1' + approvalStatus 'Onaylandı' → ENGEL DEĞİL, uyarı döner", () => {
    const r = svc.belgeDurumuEngelli({ approvalStatus: 'Onaylandı', iptalItiraz: '1' });
    expect(r.engelli).toBe(false);
    expect(String(r.uyari)).toContain('iptal/itiraz işareti (1)');
  });
  it('metinli iptal/itiraz/red yine engel; Yok/0 temiz; talep reddi geçerli belge', () => {
    expect(svc.belgeDurumuEngelli({ approvalStatus: 'Onaylandı', iptalItiraz: 'İtiraz Edildi' }).engelli).toBe(true);
    expect(svc.belgeDurumuEngelli({ approvalStatus: 'Alıcı Reddetti', iptalItiraz: '0' }).engelli).toBe(true);
    expect(svc.belgeDurumuEngelli({ approvalStatus: 'Iptal', iptalItiraz: 'Yok' }).engelli).toBe(true);
    expect(svc.belgeDurumuEngelli({ approvalStatus: 'Onaylandı', iptalItiraz: '0' })).toEqual({ engelli: false, neden: '' });
    expect(svc.belgeDurumuEngelli({ approvalStatus: 'Onaylandı', iptalItiraz: 'İptal talebi reddedildi' }).engelli).toBe(false);
    expect(svc.belgeDurumuEngelli({ approvalStatus: 'Silinmiş', iptalItiraz: 'Yok' })).toEqual({ engelli: true, neden: 'silinmis' }); // GİB e-Arşiv silinen belge
  });
});
