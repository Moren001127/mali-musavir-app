/**
 * karsi-taraf-bilgisi.spec.ts — GİB e-Arşiv görünümünden karşı taraf vergi dairesi/adres (2026-09-23, DOĞAN ÖZKAN).
 * Metin, canlı belgenin (GIB2026000000010) tarayıcı görünümünden birebir alındı.
 */
import { earsivHtmlKarsiTaraf, htmlMetne } from './karsi-taraf-bilgisi';

const GIB_HTML = `
<div><div>DOĞAN ÖZKAN <br>HADIMKÖY MEVLANA  No:128B  Kapı No:6 <br> ARNAVUTKÖY/ İstanbul / Türkiye <br>Tel: Fax:  <br>Web Sitesi:<br>E-Posta:<br>Vergi Dairesi: BÜYÜKÇEKMECE VERGİ DAİRESİ MÜD. <br>TCKN: 27166699466</div></div>
<div>e-Arşiv Fatura</div>
<div><b>SAYIN</b><br>ECT TURİZM VE OTOMOTİV TİCARET LİMİTED ŞİRKETİ<br><br>YAKUPLU MAH. HÜRRİYET CAD. EVAL YAKUPLU PLAZA NO:131/6 BEYLİKDÜZÜ/İSTANBUL  No: <br>Kapı No: <br> /  Türkiye <br>Web Sitesi:<br>E-Posta:<br>Tel: Fax:  <br>Vergi Dairesi: BEYLİKDÜZÜ VERGİ DAİRESİ MÜD.<br>VKN: 3241180695</div>
<table><tr><td>Özelleştirme No:</td><td>TR1.2</td></tr><tr><td>Fatura No:</td><td>GIB2026000000010</td></tr></table>
<script>var x = "Vergi Dairesi: SAHTE";</script>`;

describe('htmlMetne', () => {
  it('script/style atılır, br ve bloklar satır olur, hücreler sekme olur, varlıklar çözülür', () => {
    const t = htmlMetne('<p>A&amp;B&nbsp;C</p><table><tr><td>x</td><td>y</td></tr></table><script>zzz</script>');
    expect(t).toContain('A&B C');
    expect(t).toMatch(/x\s*\t\s*y/);
    expect(t).not.toContain('zzz');
  });
});

describe('earsivHtmlKarsiTaraf — adlı/sayısal HTML varlıkları (canlı 23.09: &Uuml; çözülmeyince Luca\'ya bozuk gitti)', () => {
  it('&Uuml; &uuml; &#304; &#x15E; çözülür; vergi dairesi ve adres temiz çıkar', () => {
    const html = '<div>SAYIN<br>ECT TUR&#304;ZM &#x15E;&#x130;RKET&#x130;<br>YAKUPLU MAH. H&Uuml;RR&#304;YET CAD. NO:131/6 BEYL&#304;KD&Uuml;Z&Uuml;/&#304;STANBUL  No: <br>Kap&#305; No: <br> /  T&uuml;rkiye <br>Vergi Dairesi: BEYL&#304;KD&Uuml;Z&Uuml; VERG&#304; DA&#304;RES&#304; M&Uuml;D.<br>VKN: 3241180695</div><div>Fatura No: X</div>';
    const k = earsivHtmlKarsiTaraf(html, 'SATIS');
    expect(k!.vergiDairesi).toBe('BEYLİKDÜZÜ VERGİ DAİRESİ MÜD.');
    expect(k!.unvan).toBe('ECT TURİZM ŞİRKETİ');
    expect(k!.adres).toBe('YAKUPLU MAH. HÜRRİYET CAD. NO:131/6 BEYLİKDÜZÜ/İSTANBUL');
    expect(k!.adres).not.toMatch(/&|Türkiye/);
  });
});

describe('earsivHtmlKarsiTaraf', () => {
  it('SATIS: "SAYIN" altındaki alıcı — vergi dairesi, VKN, ünvan, temiz adres', () => {
    const k = earsivHtmlKarsiTaraf(GIB_HTML, 'SATIS');
    expect(k).not.toBeNull();
    expect(k!.vergiDairesi).toBe('BEYLİKDÜZÜ VERGİ DAİRESİ MÜD.');
    expect(k!.kimlikNo).toBe('3241180695');
    expect(k!.unvan).toBe('ECT TURİZM VE OTOMOTİV TİCARET LİMİTED ŞİRKETİ');
    // "No:" / "Kapı No:" boş etiketleri ve "/ Türkiye" kalıntısı atılır; "131/6" ve "BEYLİKDÜZÜ/İSTANBUL" olduğu gibi kalır.
    expect(k!.adres).toBe('YAKUPLU MAH. HÜRRİYET CAD. EVAL YAKUPLU PLAZA NO:131/6 BEYLİKDÜZÜ/İSTANBUL');
  });
  it('başlık ("e-Arşiv Fatura") satıcı bloğunun ÜSTÜNDE olsa da satıcı doğru sınırlanır; "Kapı No: 5" değeri korunur', () => {
    const html = '<div>e-Arşiv Fatura</div><div>SATICI A.Ş.<br>CADDE No:1 Kapı No: 5<br>KADIKÖY/ İstanbul / Türkiye<br>Vergi Dairesi: KADIKÖY VERGİ DAİRESİ MÜD.<br>VKN: 1234567890</div><div>SAYIN</div><div>ALICI<br>Vergi Dairesi: X</div>';
    const k = earsivHtmlKarsiTaraf(html, 'ALIS');
    expect(k!.unvan).toBe('SATICI A.Ş.');
    expect(k!.vergiDairesi).toBe('KADIKÖY VERGİ DAİRESİ MÜD.');
    expect(k!.adres).toBe('CADDE No:1 Kapı No: 5 KADIKÖY/ İstanbul');
  });
  it('ALIS: üstteki satıcı bloğu — künye satırından önce biter', () => {
    const k = earsivHtmlKarsiTaraf(GIB_HTML, 'ALIS');
    expect(k!.vergiDairesi).toBe('BÜYÜKÇEKMECE VERGİ DAİRESİ MÜD.');
    expect(k!.kimlikNo).toBe('27166699466');
    expect(k!.unvan).toBe('DOĞAN ÖZKAN');
    expect(k!.adres).toBe('HADIMKÖY MEVLANA No:128B Kapı No:6 ARNAVUTKÖY/ İstanbul');
  });
  it('beklenen kimlik no uyuşmazsa null (yanlış tarafa yazılmaz); uyuşursa okur', () => {
    expect(earsivHtmlKarsiTaraf(GIB_HTML, 'SATIS', '1111111111')).toBeNull();
    expect(earsivHtmlKarsiTaraf(GIB_HTML, 'SATIS', '3241180695')!.vergiDairesi).toContain('BEYLİKDÜZÜ');
  });
  it('"SAYIN" yoksa ya da blok boşsa null; script içindeki sahte etiket okunmaz', () => {
    expect(earsivHtmlKarsiTaraf('<div>hiç bir şey</div>', 'SATIS')).toBeNull();
    expect(earsivHtmlKarsiTaraf('<div>SAYIN</div><script>Vergi Dairesi: X</script>', 'SATIS')).toBeNull();
  });
});
