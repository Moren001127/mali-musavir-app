/**
 * kalem-pdf.ts — KALEM TAMAMLAMA (PLAN/15 Faz 6, 2026-09-13): kalemsiz sağlayıcı XML'inde (Paraşüt /e_invoices özeti)
 * kalemler belgenin PDF/görselinden okunur; taraflar/tutarlar XML'den kalır. Saf modül, sahte AI kapısıyla.
 *  - kalemsiz XML + PDF → kalemler AI'dan, taraflar/yön/tutar XML'den (preParsed'in diğer alanları DEĞİŞMEZ)
 *  - FM_KALEM_PDF=off → eski davranış (AI hiç çağrılmaz, preParsed olduğu gibi)
 *  - kalem toplamı XML matrahından ±%5'ten fazla sapıyor → kalemKaynak='pdf-tahmin'
 *  - güven tavanı: kalemKaynak pdf/pdf-tahmin → 'yuksek' en fazla 'orta'
 *  - kalemli XML'de kapı KAPALI (görsel okunmaz — TÜRMOB yön-ters yönergesi korunur)
 */
import { parseUblInvoice } from './ubl-parse';
import {
  kalemPdfAcikMi, xmlKalemsizMi, kalemPdfGerekliMi, kalemPdfYanitiCoz, kalemPdfBirlestir, kalemPdfTamamla,
  aiMatrahGuvenTavani, kalemPdfPromptu, xmlMatrahi, KalemPdfAiCagri,
} from './kalem-pdf';

/** Paraşüt gelen e-Fatura ÖZETİNDEN üretilen sentetik UBL (parasutInboundEInvoiceXml ile aynı biçim — kalem YOK). */
const PARASUT_OZET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>ABC2026000000123</ID>
  <UUID>11111111-2222-3333-4444-555555555555</UUID>
  <IssueDate>2026-08-14</IssueDate>
  <DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>ÖRNEK TEDARİK A.Ş.</Name></PartyName><PartyIdentification><ID schemeID="VKN">1234567890</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>MÜKELLEF LTD. ŞTİ.</Name></PartyName><PartyIdentification><ID schemeID="VKN">9876543210</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">200.00</TaxAmount></TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="TRY">1000.00</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">1200.00</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">1200.00</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;

/** aiReadDocument'in UBL yolunda kurduğu preParsed'in birebir karşılığı (taraflar + kırılım + _ubl). */
function preParsedKur(ubl: any) {
  return {
    belgeNo: ubl.faturaNo, tarih: '14.08.2026', belgeTuru: 'e-fatura',
    saticiAd: ubl.satici, saticiVkn: ubl.saticiVergiNo,
    aliciAd: ubl.alici, aliciVkn: ubl.aliciVergiNo,
    toplam: ubl.toplamTutar, iade: false, tevkifat: false, tevkifatKdv: undefined,
    kdv: [{ oran: ubl.kdvOrani || 20, matrah: ubl.matrah || 1000, kdv: ubl.kdvTutari || 200 }],
    kalemler: ubl.kalemler,
    _ubl: ubl,
  };
}

const PDF_METNI = 'e-FATURA ÖRNEK TEDARİK A.Ş. Sayın MÜKELLEF LTD. ŞTİ. Fatura No ABC2026000000123 Tarih 14-08-2026 '
  + 'Sıra Mal Hizmet Miktar Birim Fiyat KDV Oranı KDV Tutarı Mal Hizmet Tutarı 1 Motorin 200 LT 4,00 %20 160,00 800,00 '
  + '2 Cam suyu 5 AD 40,00 %20 40,00 200,00 Mal Hizmet Toplam Tutarı 1.000,00 Hesaplanan KDV 200,00 Vergiler Dahil Toplam Tutar 1.200,00 Ödenecek Tutar 1.200,00';

function sahteAi(yanit: string | null, kayit: any[] = []): KalemPdfAiCagri {
  return async (p) => { kayit.push(p); return yanit == null ? { ok: false, text: '', error: 'yok' } : { ok: true, text: yanit }; };
}

describe('kalem-pdf — kapı ve XML kalemsizlik', () => {
  it('Paraşüt özet XML: gerçek UBL ayrıştırıcı kalem VERMEZ ama taraflar/tutarlar gelir → kalem tamamlama GEREKLİ', () => {
    const ubl: any = parseUblInvoice(PARASUT_OZET_XML);
    expect(ubl).toBeTruthy();
    expect(ubl.saticiVergiNo).toBe('1234567890');
    expect(ubl.aliciVergiNo).toBe('9876543210');
    expect(ubl.matrah).toBe(1000);
    expect(xmlKalemsizMi(preParsedKur(ubl))).toBe(true);
    expect(kalemPdfGerekliMi(preParsedKur(ubl), true, {})).toBe(true);
    // Sağlayıcı XML'i yoksa (elle yüklenen PDF/JPEG) bu yol devreye girmez — mevcut vision okuması çalışır.
    expect(kalemPdfGerekliMi(preParsedKur(ubl), false, {})).toBe(false);
  });

  it('KALEMLİ XML\'de kapı KAPALI (görsel okunmaz; TÜRMOB yön-ters yönergesi korunur)', () => {
    const p = { ...preParsedKur(parseUblInvoice(PARASUT_OZET_XML)), kalemler: [{ ad: 'Nakliye hizmeti', tutar: 1000, oran: 20 }] };
    expect(xmlKalemsizMi(p)).toBe(false);
    expect(kalemPdfGerekliMi(p, true, {})).toBe(false);
  });

  it('FM_KALEM_PDF=off/0/false/kapali kapatır; boş/1/on açık (varsayılan AÇIK)', () => {
    for (const v of ['off', '0', 'false', 'kapali', ' OFF ']) expect(kalemPdfAcikMi({ FM_KALEM_PDF: v })).toBe(false);
    for (const v of ['', '1', 'on', 'acik']) expect(kalemPdfAcikMi({ FM_KALEM_PDF: v })).toBe(true);
    expect(kalemPdfAcikMi({})).toBe(true);
  });
});

describe('kalem-pdf — birleştirme kuralı', () => {
  it('kalemsiz XML + PDF → kalemler AI\'dan, taraflar/yön/tutar XML\'den; diğer alanlar DEĞİŞMEZ; kaynak=pdf', async () => {
    const preParsed: any = preParsedKur(parseUblInvoice(PARASUT_OZET_XML));
    const once = JSON.parse(JSON.stringify(preParsed));
    const cagrilar: any[] = [];
    const ai = sahteAi(
      // AI kod bloğu + saçma yön/taraf alanları döndürse bile YALNIZ kalemler + giderTuru alınır.
      '```json\n{"saticiAd":"YANLIŞ SATICI","saticiVkn":"0000000000","toplam":99,"kalemler":[{"ad":"Motorin","tutar":"800,00","oran":20},{"ad":"Cam suyu","tutar":200,"oran":"20"}],"giderTuru":"akaryakıt"}\n```',
      cagrilar,
    );
    const r = await kalemPdfTamamla(preParsed, { tur: 'pdf-metin', metin: PDF_METNI }, ai, { yon: 'ALIS', belgeNo: 'ABC2026000000123', env: {}, modeller: ['hizli', undefined] });
    expect(r).toMatchObject({ kalemKaynak: 'pdf', kalemSayisi: 2, kalemToplam: 1000, xmlMatrah: 1000, sapmaYuzde: 0, model: 'hizli', dosyaTuru: 'pdf-metin' });
    expect(cagrilar).toHaveLength(1); // hızlı model kalem verdi → güçlü modele gidilmedi
    expect(cagrilar[0].images).toBeUndefined(); // PDF → metin yolu (vision PDF okuyamaz)
    expect(cagrilar[0].prompt).toContain('İÇERİK:');
    expect(cagrilar[0].prompt).toContain('Motorin');
    // Kalemler AI'dan (Türk sayı biçimi çözüldü)
    expect(preParsed.kalemler).toEqual([{ ad: 'Motorin', tutar: 800, oran: 20 }, { ad: 'Cam suyu', tutar: 200, oran: 20 }]);
    expect(preParsed._kalemMetni).toBe('Motorin; Cam suyu');
    expect(preParsed._pdfGiderTuru).toBe('akaryakıt');
    expect(preParsed._kalemKaynak).toBe('pdf');
    // Taraflar / tutar / no / tarih / yön alanları XML'den, DOKUNULMADI (AI'ın "YANLIŞ SATICI"sı yok sayıldı)
    const { kalemler: _k, _kalemMetni: _m, _pdfGiderTuru: _g, _kalemKaynak: _c, ...sonraDigerleri } = preParsed;
    const { kalemler: _k0, ...onceDigerleri } = once;
    expect(JSON.parse(JSON.stringify(sonraDigerleri))).toEqual(onceDigerleri);
    expect(preParsed.saticiAd).toBe('ÖRNEK TEDARİK A.Ş.');
    expect(preParsed.saticiVkn).toBe('1234567890');
    expect(preParsed.aliciVkn).toBe('9876543210');
    expect(preParsed.toplam).toBe(1200);
    expect(preParsed.kdv).toEqual([{ oran: 20, matrah: 1000, kdv: 200 }]);
  });

  it('FM_KALEM_PDF=off → eski davranış: AI HİÇ çağrılmaz, preParsed olduğu gibi (kalemsiz) kalır', async () => {
    const preParsed: any = preParsedKur(parseUblInvoice(PARASUT_OZET_XML));
    const once = JSON.parse(JSON.stringify(preParsed));
    const cagrilar: any[] = [];
    const r = await kalemPdfTamamla(preParsed, { tur: 'pdf-metin', metin: PDF_METNI }, sahteAi('{"kalemler":[{"ad":"Motorin","tutar":1000,"oran":20}]}', cagrilar), { yon: 'ALIS', env: { FM_KALEM_PDF: 'off' } });
    expect(r).toBeNull();
    expect(cagrilar).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(preParsed))).toEqual(once);
    expect(preParsed.kalemler).toBeUndefined();
    expect(preParsed._kalemKaynak).toBeUndefined();
  });

  it('kalem toplamı XML matrahından ±%5\'ten fazla sapıyor → kalemler yine alınır ama kalemKaynak=pdf-tahmin', async () => {
    const preParsed: any = preParsedKur(parseUblInvoice(PARASUT_OZET_XML));
    const r = await kalemPdfTamamla(preParsed, { tur: 'pdf-metin', metin: PDF_METNI }, sahteAi('{"kalemler":[{"ad":"Motorin","tutar":700,"oran":20},{"ad":"Cam suyu","tutar":200,"oran":20}],"giderTuru":""}'), { yon: 'ALIS', env: {} });
    expect(r).toMatchObject({ kalemKaynak: 'pdf-tahmin', kalemSayisi: 2, kalemToplam: 900, xmlMatrah: 1000, sapmaYuzde: 10 });
    expect(preParsed.kalemler).toHaveLength(2);
    expect(preParsed._kalemKaynak).toBe('pdf-tahmin');
    expect(preParsed._pdfGiderTuru).toBeUndefined(); // boş gider türü yazılmaz
    // ±%5 içi → pdf (1030 / 1000 = %3)
    const p2: any = preParsedKur(parseUblInvoice(PARASUT_OZET_XML));
    expect(kalemPdfBirlestir(p2, { kalemler: [{ ad: 'Motorin', tutar: 1030, oran: 20 }] })).toMatchObject({ kalemKaynak: 'pdf', sapmaYuzde: 3 });
    // XML matrahı bilinmiyorsa doğrulanamaz → pdf-tahmin
    const p3: any = { saticiAd: 'X', kdv: [], _ubl: {} };
    expect(xmlMatrahi(p3)).toBe(0);
    expect(kalemPdfBirlestir(p3, { kalemler: [{ ad: 'Kalem', tutar: 10, oran: 20 }] })).toMatchObject({ kalemKaynak: 'pdf-tahmin', sapmaYuzde: null });
  });

  it('hızlı model kalem vermezse güçlü modele geçilir; ikisi de vermezse null ve preParsed değişmez; görselde images geçer', async () => {
    const preParsed: any = preParsedKur(parseUblInvoice(PARASUT_OZET_XML));
    const cagrilar: any[] = [];
    let sira = 0;
    const ai: KalemPdfAiCagri = async (p) => { cagrilar.push(p); sira++; return sira === 1 ? { ok: true, text: '{"kalemler":[]}' } : { ok: true, text: '{"kalemler":[{"ad":"Bakım hizmeti","tutar":1000,"oran":20}]}' }; };
    const gorsel = { tur: 'gorsel' as const, base64: 'A'.repeat(500), mediaType: 'image/jpeg' };
    const r = await kalemPdfTamamla(preParsed, gorsel, ai, { yon: 'ALIS', env: {}, modeller: ['hizli', 'guclu'] });
    expect(r).toMatchObject({ kalemKaynak: 'pdf', model: 'guclu', dosyaTuru: 'gorsel' });
    expect(cagrilar).toHaveLength(2);
    expect(cagrilar[1].images).toEqual([{ base64: gorsel.base64, mediaType: 'image/jpeg' }]);
    expect(cagrilar[1].prompt).not.toContain('İÇERİK:');

    const p2: any = preParsedKur(parseUblInvoice(PARASUT_OZET_XML));
    const once = JSON.parse(JSON.stringify(p2));
    expect(await kalemPdfTamamla(p2, { tur: 'pdf-metin', metin: PDF_METNI }, sahteAi(null), { yon: 'ALIS', env: {}, modeller: ['a', 'b'] })).toBeNull();
    expect(JSON.parse(JSON.stringify(p2))).toEqual(once);
    // Taranmış PDF (metin yok) → dosya yok sayılır
    expect(await kalemPdfTamamla(p2, { tur: 'pdf-metin', metin: 'kısa' }, sahteAi('{"kalemler":[{"ad":"x","tutar":1,"oran":1}]}'), { yon: 'ALIS', env: {} })).toBeNull();
  });
});

describe('kalem-pdf — yanıt çözme, prompt ve güven tavanı', () => {
  it('yanıt çözme: kod bloğu/gürültü, Türk sayı biçimi, adsız kalem elenir, çözülemeyen → null', () => {
    expect(kalemPdfYanitiCoz('metin ```json {"kalemler":[{"ad":" A  B ","tutar":"1.234,56","oran":"%20"},{"ad":"","tutar":5}],"giderTuru":" kira "} ```')).toEqual({ kalemler: [{ ad: 'A B', tutar: 1234.56, oran: 20 }], giderTuru: 'kira' });
    expect(kalemPdfYanitiCoz('{"kalemler":[]}')).toBeNull();
    expect(kalemPdfYanitiCoz('hiç json yok')).toBeNull();
    expect(kalemPdfYanitiCoz('{bozuk')).toBeNull();
  });

  it('prompt yalnız KALEM ister; taraf/tutar/yönün bilindiğini söyler; XML matrahını ipucu verir', () => {
    const p = kalemPdfPromptu({ yon: 'ALIS', dosya: { tur: 'pdf-metin', metin: PDF_METNI }, xmlMatrah: 1000, belgeNo: 'ABC1' });
    expect(p).toContain('YALNIZ mal/hizmet KALEMLERİNİ çıkar');
    expect(p).toContain('ZATEN BİLİNİYOR');
    expect(p).toContain('1.000,00 TL');
    expect(p).toContain('"kalemler"');
    expect(p).not.toContain('"saticiAd"');
    const g = kalemPdfPromptu({ yon: 'SATIS', dosya: { tur: 'gorsel', base64: 'x', mediaType: 'image/jpeg' } });
    expect(g).toContain('görüntü');
    expect(g).not.toContain('İÇERİK:');
  });

  it('güven tavanı: kalemKaynak pdf/pdf-tahmin → yuksek en fazla orta; diğerleri olduğu gibi', () => {
    expect(aiMatrahGuvenTavani('yuksek', 'pdf')).toBe('orta');
    expect(aiMatrahGuvenTavani('yuksek', 'pdf-tahmin')).toBe('orta');
    expect(aiMatrahGuvenTavani('orta', 'pdf')).toBe('orta');
    expect(aiMatrahGuvenTavani('dusuk', 'pdf')).toBe('dusuk');
    expect(aiMatrahGuvenTavani('yuksek', undefined)).toBe('yuksek');
    expect(aiMatrahGuvenTavani(undefined, 'pdf')).toBeUndefined();
  });
});
