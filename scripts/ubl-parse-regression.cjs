#!/usr/bin/env node
/**
 * UBL ayrıştırıcı regresyonu — apps/api/src/fatura-muhasebelestirme/ubl-parse.ts (Faz 0, PLAN/15).
 *
 * Kilitler:
 *   1) Tevkifatlı satış (2/10, WithholdingTaxTotal): tutar + kod (624) + yüzde (20) + oran (0,2); KDV TAM (tevkifat katılmaz).
 *   2) Telekom (0015 + 8006 karışık): yalnız 0015 KDV; 8006 digerVergiler'e; matrah şişmez; kalem oranı KDV alt-toplamından.
 *   3) İadeli alış (InvoiceTypeCode IADE): iade=true, faturaTipi=IADE; IPTAL → belgeDurumu=iptal.
 *   4) İskontolu kalem: satır iskontosu brüt LineExtensionAmount'tan düşülür; belge iskontosu kalemlere dağıtılır (Σ = matrah).
 *   5) Döviz + kur; ödenecek tutar; ublOcrDataFields alan adları (Aktar = AI-oku).
 *   6) isKdvTaxSubtotal: tanınmayan kod KDV DEĞİL; kod+ad yoksa KDV (geriye uyum).
 *   8) Kısmi tevkifat: yüzde tutarla tutarsızsa oran TUTARDAN (denetim bulgusu — Percent körü 40 ₺ sapma).
 *   9) e-SMM: stopaj (0003) KDV tevkifatı DEĞİL → stopajTutari; CreditNote kökü iade DEĞİL; documentType E_SMM.
 *  10) PayableRoundingAmount: odenecekTutar yuvarlama düşülmüş; ham tutar toplamTutar'da.
 *  11) Çok oranlı kdvOrani null (harman yok); clearUblOnlyOcrFields bayat UBL alanlarını siler.
 *   3) (güncellendi) Not metni iade/iptal KARARI VERMEZ; yalnız tip kodu boşken "İADE FATURASIDIR" bildirimi.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function loadTsNode() {
  process.env.TS_NODE_TRANSPILE_ONLY = 'true';
  process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
  for (const c of [
    'ts-node/register/transpile-only',
    path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
    path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
  ]) {
    try { require(c); return; } catch {}
  }
  throw new Error('ts-node/register/transpile-only bulunamadi');
}
loadTsNode();

const { parseUblInvoice, isKdvTaxSubtotal, ublOcrDataFields, distributeDocumentDiscount, resolveTevkifatOrani, clearUblOnlyOcrFields, kdvDisiVergiOivMi } = require(path.join(
  ROOT, 'apps', 'api', 'src', 'fatura-muhasebelestirme', 'ubl-parse.ts',
));

let failed = 0;

function assert(ok, msg) { if (!ok) { console.error(`[ubl-parse] FAIL: ${msg}`); failed++; } }
function approx(a, b, msg) { assert(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} != ${b}`); }

const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';
const party = (tag, name, vkn) => `<cac:${tag}><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">${vkn}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${name}</cbc:Name></cac:PartyName></cac:Party></cac:${tag}>`;
const sub = (base, amt, pct, code, name) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">${base}</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">${amt}</cbc:TaxAmount><cac:TaxCategory>${pct != null ? `<cbc:Percent>${pct}</cbc:Percent>` : ''}<cac:TaxScheme>${name ? `<cbc:Name>${name}</cbc:Name>` : ''}<cbc:TaxTypeCode>${code}</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
const line = (id, ad, qty, price, lea, taxXml, extra = '') => `<cac:InvoiceLine><cbc:ID>${id}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">${lea}</cbc:LineExtensionAmount>${extra}${taxXml}<cac:Item><cbc:Name>${ad}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="TRY">${price}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
const totals = (excl, incl, payable, allowance) => `<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">${excl + (allowance || 0)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">${excl}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">${incl}</cbc:TaxInclusiveAmount>${allowance ? `<cbc:AllowanceTotalAmount currencyID="TRY">${allowance}</cbc:AllowanceTotalAmount>` : ''}<cbc:PayableAmount currencyID="TRY">${payable}</cbc:PayableAmount></cac:LegalMonetaryTotal>`;

// ── 1) TEVKİFATLI SATIŞ 2/10 (nakliye 624) ──
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>YRG2026000000406</cbc:ID><cbc:UUID>11111111-1111-1111-1111-111111111111</cbc:UUID>
<cbc:IssueDate>2026-07-10</cbc:IssueDate><cbc:InvoiceTypeCode>TEVKIFAT</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'YORGUN NAKLİYAT', '1234567890')}${party('AccountingCustomerParty', 'BARANLAR A.Ş.', '9876543210')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV')}</cac:TaxTotal>
<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">400</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">2000</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">400</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:Name>Yük Taşımacılığı Hizmeti</cbc:Name><cbc:TaxTypeCode>624</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>
${totals(10000, 12000, 11600)}
${line(1, 'Nakliye hizmeti', 1, 10000, 10000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '1: parse null');
  approx(p.matrah, 10000, '1: matrah');
  approx(p.kdvTutari, 2000, '1: KDV TAM (tevkifat katılmadı, %24 harmanı yok)');
  assert(p.kdvOrani === 20, `1: kdvOrani 20 (bulundu ${p.kdvOrani})`);
  approx(p.tevkifatKdv, 400, '1: tevkifatKdv');
  assert(p.tevkifatKodu === '624', `1: tevkifatKodu 624 (bulundu ${p.tevkifatKodu})`);
  assert(p.tevkifatYuzde === 20, `1: tevkifatYuzde 20 (bulundu ${p.tevkifatYuzde})`);
  approx(p.tevkifatOrani, 0.2, '1: tevkifatOrani 0,2');
  approx(p.odenecekTutar, 11600, '1: odenecekTutar');
  approx(p.toplamTutar, 11600, '1: toplamTutar = ödenecek');
  assert(p.iade === false, '1: iade false');
  assert(p.faturaTipi === 'TEVKIFAT', '1: faturaTipi TEVKIFAT');
  assert(p.belgeDurumu === 'onayli', '1: belgeDurumu onayli');
  assert(!p.digerVergiler, '1: diğer vergi yok');
  const f = ublOcrDataFields(p);
  approx(f.tevkifatOrani, 0.2, '1: ocrData.tevkifatOrani');
  approx(f.tevkifatKdv, 400, '1: ocrData.tevkifatKdv');
  assert(f.tevkifatHint === true, '1: ocrData.tevkifatHint');
  assert(f.tevkifatKodu === '624', '1: ocrData.tevkifatKodu');
  assert(f.isReturn === false, '1: ocrData.isReturn');
  assert(f.parserVersion === 2, '1: ocrData.parserVersion');
  approx(f.odenecekTutar, 11600, '1: ocrData.odenecekTutar');
  assert(f.digerVergiToplam === 0, '1: ocrData.digerVergiToplam 0');
  // Denklem: matrah + KDV + diğer − tevkifat = ödenecek
  approx(p.matrah + p.kdvTutari + (p.digerVergiToplam || 0) - p.tevkifatKdv, p.odenecekTutar, '1: denklem');
}

// ── 1b) TEVKİFAT BLOĞU VAR AMA UYGULANMAMIŞ (CANLI BULGU BRN2026000000483, 2026-09-12): WithholdingTaxTotal 400 (624, %20)
//        ama PayableAmount = TaxInclusiveAmount (12.000) → satıcı düşmemiş → tevkifatKdv YOK, tevkifatUygulanmamis bayrağı; fiş normal. ──
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>TICARIFATURA</cbc:ProfileID><cbc:ID>BRN2026000000483</cbc:ID><cbc:UUID>050611aa-7678-449b-a860-a30036bd27f8</cbc:UUID>
<cbc:IssueDate>2026-07-06</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'BARANLAR NAKLİYAT', '1410031279')}${party('AccountingCustomerParty', 'YORGUN NAKLİYAT', '9821096129')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV GERCEK')}</cac:TaxTotal>
<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">400.0</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">2000</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">400.0</cbc:TaxAmount><cbc:Percent>20</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name /><cbc:TaxTypeCode>624</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>
${totals(10000, 12000, 12000)}
${line(1, 'GEBZE HADIMKÖY NAKLİYE HİZMET BEDELİDİR', 1, 10000, 10000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '1b: parse null');
  assert(!p.tevkifatKdv, `1b: tevkifatKdv YOK (bulundu ${p.tevkifatKdv})`);
  assert(!p.tevkifatOrani, `1b: tevkifatOrani YOK (bulundu ${p.tevkifatOrani})`);
  assert(p.tevkifatUygulanmamis && p.tevkifatUygulanmamis.beyanEdilen === 400 && p.tevkifatUygulanmamis.kod === '624' && p.tevkifatUygulanmamis.yuzde === 20, `1b: tevkifatUygulanmamis {400, 624, 20} (bulundu ${JSON.stringify(p.tevkifatUygulanmamis)})`);
  approx(p.kdvTutari, 2000, '1b: KDV tam 2000');
  approx(p.odenecekTutar, 12000, '1b: ödenecek 12000');
  approx(p.matrah + p.kdvTutari + (p.digerVergiToplam || 0), p.odenecekTutar, '1b: denklem (tevkifatsız)');
  const f = ublOcrDataFields(p);
  assert(f.tevkifatHint === false, '1b: ocrData.tevkifatHint false (fiş normal kurulur)');
  assert(f.tevkifatKdv === 0, '1b: ocrData.tevkifatKdv 0');
  assert(f.tevkifatUygulanmamis && f.tevkifatUygulanmamis.beyanEdilen === 400, '1b: ocrData.tevkifatUygulanmamis taşınır');
}

// ── 2) TELEKOM: 0015 (%20) + 8006 telsiz (sahte %100 satırı) ──
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID><cbc:ID>GB12026003785153</cbc:ID><cbc:IssueDate>2026-08-01</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'TÜRK TELEKOM', '1111111111')}${party('AccountingCustomerParty', 'GÖKHAN AKGÖZ', '2222222222')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">126.98</cbc:TaxAmount>${sub(500, 100, 20, '0015', 'KDV')}${sub(26.98, 26.98, 100, '8006', 'Telsiz Kullanım Ücreti')}</cac:TaxTotal>
${totals(500, 626.98, 626.98)}
${line(1, 'İnternet erişim hizmeti', 1, 500, 500, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">126.98</cbc:TaxAmount>${sub(26.98, 26.98, 100, '8006', 'Telsiz Kullanım Ücreti')}${sub(500, 100, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '2: parse null');
  approx(p.matrah, 500, '2: matrah şişmedi (telsiz matraha eklenmedi)');
  approx(p.kdvTutari, 100, '2: KDV yalnız 0015');
  assert(p.kdvBreakdown && p.kdvBreakdown.length === 1 && p.kdvBreakdown[0].rate === 20, `2: tek KDV kırılımı %20 (bulundu ${JSON.stringify(p.kdvBreakdown)})`);
  approx(p.kdvBreakdown[0].base, 500, '2: kırılım base 500');
  assert(Array.isArray(p.digerVergiler) && p.digerVergiler.length === 1, '2: digerVergiler 1 kayıt');
  assert(p.digerVergiler[0].kod === '8006', `2: kod 8006 (bulundu ${p.digerVergiler[0].kod})`);
  approx(p.digerVergiler[0].tutar, 26.98, '2: telsiz tutar');
  approx(p.digerVergiToplam, 26.98, '2: digerVergiToplam');
  assert(p.kalemler && p.kalemler[0].oran === 20, `2: kalem oranı KDV alt-toplamından (%20), telsiz %100 değil (bulundu ${p.kalemler && p.kalemler[0].oran})`);
  approx(p.matrah + p.kdvTutari + p.digerVergiToplam, p.odenecekTutar, '2: matrah+KDV+diğer = ödenecek');
  const f = ublOcrDataFields(p);
  approx(f.digerVergiToplam, 26.98, '2: ocrData.digerVergiToplam');
  assert(Array.isArray(f.digerVergiler) && f.digerVergiler[0].ad === 'Telsiz Kullanım Ücreti', '2: ocrData.digerVergiler.ad');
}

// ── 3) İADELİ ALIŞ + İPTAL ──
{
  const base = (tip, note) => `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>SEC2026000000269</cbc:ID><cbc:IssueDate>2026-08-05</cbc:IssueDate><cbc:InvoiceTypeCode>${tip}</cbc:InvoiceTypeCode>${note ? `<cbc:Note>${note}</cbc:Note>` : ''}<cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'SEÇKİN GIDA', '3333333333')}${party('AccountingCustomerParty', 'EDELER', '4444444444')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">100</cbc:TaxAmount>${sub(1000, 100, 10, '0015', 'KDV')}</cac:TaxTotal>
${totals(1000, 1100, 1100)}
${line(1, 'Un 50kg', 10, 100, 1000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">100</cbc:TaxAmount>${sub(1000, 100, 10, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(base('IADE', 'Bozuk ürün iadesi'));
  assert(p && p.iade === true, '3: IADE → iade true');
  assert(p.faturaTipi === 'IADE', '3: faturaTipi IADE');
  assert(p.belgeDurumu === 'onayli', '3: iade belge iptal değil');
  assert(ublOcrDataFields(p).isReturn === true, '3: ocrData.isReturn true');
  const p2 = parseUblInvoice(base('SATIS', 'Ürünler iade edilemez.'));
  assert(p2 && p2.iade === false, '3: "iade edilemez" notu iade sayılmaz (yanlış pozitif yok)');
  // NOT karar VERMEZ (denetim bulgusu): InvoiceTypeCode=SATIS + standart notlarda "İADE FATURASI" / "İPTAL FATURASI"
  //   geçen sağlam satış faturası iade/iptal sayılmaz (eskiden iade=true + belgeDurumu=iptal → INVALID, Luca'ya gitmiyordu).
  const p3 = parseUblInvoice(base('SATIS', 'Bu belge İADE FATURASI olarak düzenlenmiştir.'));
  assert(p3 && p3.iade === false, '3: InvoiceTypeCode=SATIS iken not iade yapmaz');
  const p3b = parseUblInvoice(base('SATIS', 'Bu fatura için iade faturası düzenlenmesi halinde fatura no belirtilmelidir. İptal faturası düzenlenemez.'));
  assert(p3b && p3b.iade === false, `3: standart nottaki "iade faturası" normal satışı iade yapmaz (bulundu ${p3b && p3b.iade})`);
  assert(p3b && p3b.belgeDurumu === 'onayli', `3: standart nottaki "iptal faturası" belgeyi iptal yapmaz (bulundu ${p3b && p3b.belgeDurumu})`);
  assert(ublOcrDataFields(p3b).isReturn === false && ublOcrDataFields(p3b).belgeDurumu === 'onayli', '3: ocrData isReturn=false, belgeDurumu=onayli');
  // Tip kodu BOŞ + olumlu bildirim kalıbı → iade (tek kabul edilen not yolu); olumsuz bağlamda değil.
  const p3c = parseUblInvoice(base('', 'BU BELGE İADE FATURASIDIR.'));
  assert(p3c && p3c.iade === true, `3: tip kodu boş + "İADE FATURASIDIR" bildirimi iade (bulundu ${p3c && p3c.iade})`);
  const p3d = parseUblInvoice(base('', 'İade faturasıdır ibaresi düzenlenmesi halinde geçerlidir.'));
  assert(p3d && p3d.iade === false, '3: tip kodu boş ama olumsuz bağlam ("halinde") → iade değil');
  const p4 = parseUblInvoice(base('IPTAL', ''));
  assert(p4 && p4.belgeDurumu === 'iptal', `3: IPTAL → belgeDurumu iptal (bulundu ${p4 && p4.belgeDurumu})`);
  assert(ublOcrDataFields(p4).belgeDurumu === 'iptal', '3: ocrData.belgeDurumu iptal');
  const p5 = parseUblInvoice(base('TEVKIFATIADE', ''));
  assert(p5 && p5.iade === true, '3: TEVKIFATIADE iade');
}

// ── 4) İSKONTO: satır (brüt LEA) + belge düzeyi dağıtım ──
{
  const allowance = (amt) => `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="TRY">${amt}</cbc:Amount></cac:AllowanceCharge>`;
  // Satır 1: 10 × 100 = 1000 brüt, iskonto 100, LEA hatalı BRÜT (1000) → 900 beklenir.
  // Satır 2: 4 × 100 = 400, iskontosuz.  Belge iskontosu 130 → matrah 1300 − 130 = 1170; kalemler 900/400 oranında dağıtılır.
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>BEY2026000085720</cbc:ID><cbc:IssueDate>2026-08-05</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'BEY TİCARET', '5555555555')}${party('AccountingCustomerParty', 'MÜŞTERİ', '6666666666')}
${allowance(130)}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">234</cbc:TaxAmount>${sub(1170, 234, 20, '0015', 'KDV')}</cac:TaxTotal>
${totals(1170, 1404, 1404, 130)}
${line(1, 'Strec film', 10, 100, 1000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">180</cbc:TaxAmount>${sub(900, 180, 20, '0015', 'KDV')}</cac:TaxTotal>`, allowance(100))}
${line(2, 'Koli bandı', 4, 100, 400, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">80</cbc:TaxAmount>${sub(400, 80, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '4: parse null');
  approx(p.matrah, 1170, '4: matrah TaxExclusiveAmount');
  const sum = p.kalemler.reduce((s, k) => s + k.tutar, 0);
  approx(sum, 1170, `4: Σ kalem = matrah (bulundu ${sum}; kalemler ${JSON.stringify(p.kalemler)})`);
  approx(p.kalemler[0].tutar, 810, '4: kalem 1 = 900 × 1170/1300 = 810');
  approx(p.kalemler[1].tutar, 360, '4: kalem 2 = 400 × 1170/1300 = 360');
  assert(p.iskonto && Math.abs(p.iskonto.kalem - 100) < 0.005 && Math.abs(p.iskonto.belge - 130) < 0.005, `4: iskonto {kalem:100, belge:130} (bulundu ${JSON.stringify(p.iskonto)})`);
  approx(p.iskonto.toplam, 230, '4: iskonto toplam');
  // Saf dağıtım: kuruş farkı son kaleme
  const d = distributeDocumentDiscount([{ tutar: 33.33 }, { tutar: 33.33 }, { tutar: 33.34 }], 90);
  approx(d.reduce((s, k) => s + k.tutar, 0), 90, '4: distributeDocumentDiscount Σ = hedef (kuruş sapması yok)');
}

// ── 5) DÖVİZ + KUR ──
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>IHRACAT</cbc:ProfileID><cbc:ID>EXP2026000000001</cbc:ID><cbc:IssueDate>2026-08-05</cbc:IssueDate><cbc:InvoiceTypeCode>ISTISNA</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'İHRACATÇI', '7777777777')}${party('AccountingCustomerParty', 'FOREIGN LLC', '8888888888')}
<cac:PricingExchangeRate><cbc:SourceCurrencyCode>USD</cbc:SourceCurrencyCode><cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode><cbc:CalculationRate>32.5</cbc:CalculationRate></cac:PricingExchangeRate>
<cac:TaxTotal><cbc:TaxAmount currencyID="USD">0</cbc:TaxAmount>${sub(1000, 0, 0, '0015', 'KDV')}</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="USD">1000</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="USD">1000</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="USD">1000</cbc:PayableAmount></cac:LegalMonetaryTotal>
${line(1, 'Makine parçası', 1, 1000, 1000, `<cac:TaxTotal><cbc:TaxAmount currencyID="USD">0</cbc:TaxAmount>${sub(1000, 0, 0, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p && p.paraBirimi === 'USD', `5: paraBirimi USD (bulundu ${p && p.paraBirimi})`);
  approx(p.kur, 32.5, '5: kur');
  const f = ublOcrDataFields(p);
  assert(f.paraBirimi === 'USD' && Math.abs(f.kur - 32.5) < 0.005, '5: ocrData.paraBirimi/kur');
}

// ── 6) isKdvTaxSubtotal ──
{
  const mk = (code, name) => ({ TaxCategory: { TaxScheme: { ...(code != null ? { TaxTypeCode: code } : {}), ...(name ? { Name: name } : {}) } } });
  assert(isKdvTaxSubtotal(mk(15, 'KDV')) === true, '6: 0015 (parser 15) KDV');
  assert(isKdvTaxSubtotal(mk('0015')) === true, '6: "0015" KDV');
  assert(isKdvTaxSubtotal(mk(8006, 'Telsiz Kullanım Ücreti')) === false, '6: 8006 KDV değil');
  assert(isKdvTaxSubtotal(mk(4080, 'ÖZEL İLETİŞİM VERGİSİ')) === false, '6: 4080 KDV değil');
  assert(isKdvTaxSubtotal(mk(9999)) === false, '6: tanınmayan kod KDV DEĞİL');
  assert(isKdvTaxSubtotal(mk(null, null)) === true, '6: kod+ad yok → KDV (geriye uyum, Paraşüt sentetik)');
  assert(isKdvTaxSubtotal(mk(null, 'Katma Değer Vergisi')) === true, '6: adı KDV → KDV');
  assert(isKdvTaxSubtotal(mk(null, 'Telsiz Kullanım Ücreti')) === false, '6: kodsuz telsiz KDV değil');
}

// ── 7) Regex yedeği (tam ayrıştırıcı çalışmadı) → parserVersion 1; reprocess-broken bunu 'aktar-ham' sayar ──
{
  const f = ublOcrDataFields({ faturaNo: 'X1', faturaTarihi: null, matrah: 100, kdvTutari: 20 });
  assert(f.parserVersion === 1, `7: regex yedeği parserVersion 1 (bulundu ${f.parserVersion})`);
  assert(f.belgeDurumu === 'onayli' && f.isReturn === false && f.digerVergiToplam === 0, '7: yedekte güvenli varsayılanlar');
}

// ── 8) KISMİ TEVKİFAT: nakliye 10.000 (KDV 2.000, 2/10 → 400) + ambalaj 1.000 (KDV 200, tevkifatsız) ──
//   UBL: KDV 2.200, WithholdingTaxTotal 400, Percent 20, ödenecek 12.800. Yüzde tutarla TUTARSIZ
//   (2.200×0,2=440 ≠ 400) → oran TUTARDAN (400/2200=0,182); Percent kullanılsaydı 360/391/cari 40 ₺ sapardı.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>KSM2026000000001</cbc:ID><cbc:IssueDate>2026-07-10</cbc:IssueDate><cbc:InvoiceTypeCode>TEVKIFAT</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'YORGUN NAKLİYAT', '1234567890')}${party('AccountingCustomerParty', 'BARANLAR A.Ş.', '9876543210')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2200</cbc:TaxAmount>${sub(11000, 2200, 20, '0015', 'KDV')}</cac:TaxTotal>
<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">400</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">2000</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">400</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:Name>Yük Taşımacılığı Hizmeti</cbc:Name><cbc:TaxTypeCode>624</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>
${totals(11000, 13200, 12800)}
${line(1, 'Nakliye hizmeti', 1, 10000, 10000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
${line(2, 'Ambalaj', 1, 1000, 1000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200</cbc:TaxAmount>${sub(1000, 200, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '8: parse null');
  approx(p.kdvTutari, 2200, '8: KDV tam');
  approx(p.tevkifatKdv, 400, '8: tevkifatKdv 400');
  assert(p.tevkifatYuzde === 20, '8: tevkifatYuzde 20 okundu');
  assert(p.tevkifatKodu === '624', `8: tevkifatKodu 624 (bulundu ${p.tevkifatKodu})`);
  approx(p.tevkifatOrani, 0.182, `8: tevkifatOrani TUTARDAN 0,182 (Percent 0,2 DEĞİL; bulundu ${p.tevkifatOrani})`);
  approx(p.matrah + p.kdvTutari - p.tevkifatKdv, p.odenecekTutar, '8: denklem matrah+KDV−tevkifat = ödenecek 12.800');
  // Saf kural: tutarlıysa yüzde (0,2 temiz), tutarsızsa tutar oranı; tevkifat yoksa undefined
  approx(resolveTevkifatOrani(2000, 400, 20), 0.2, '8: tutarlı → Percent/100');
  approx(resolveTevkifatOrani(2200, 400, 20), 0.182, '8: tutarsız → tutar oranı');
  approx(resolveTevkifatOrani(2000, 400, undefined), 0.2, '8: yüzde yok → tutar oranı');
  assert(resolveTevkifatOrani(2000, 0, 20) === undefined, '8: tevkifat yok → undefined');
  approx(resolveTevkifatOrani(2000, 2000, 100), 1, '8: 10/10 tam tevkifat → 1');
}

// ── 9) e-SMM (CreditNote kökü): GV stopajı (0003) WithholdingTaxTotal içinde → stopajTutari, KDV tevkifatı DEĞİL; iade DEĞİL ──
{
  const NSC = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><CreditNote ${NSC}>
<cbc:ProfileID>ESERBESTMESLEKMAKBUZU</cbc:ProfileID><cbc:ID>SMM2026000000001</cbc:ID><cbc:IssueDate>2026-08-05</cbc:IssueDate><cbc:CreditNoteTypeCode>SERBESTMESLEKMAKBUZU</cbc:CreditNoteTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'AV. AYŞE YILMAZ', '12345678901')}${party('AccountingCustomerParty', 'EDELER', '4444444444')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV')}</cac:TaxTotal>
<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">10000</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:Name>GV STOPAJI</cbc:Name><cbc:TaxTypeCode>0003</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">10000</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">10000</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">12000</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="TRY">10000</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="C62">1</cbc:CreditedQuantity><cbc:LineExtensionAmount currencyID="TRY">10000</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000</cbc:TaxAmount>${sub(10000, 2000, 20, '0015', 'KDV')}</cac:TaxTotal><cac:Item><cbc:Name>Hukuki danışmanlık</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="TRY">10000</cbc:PriceAmount></cac:Price></cac:CreditNoteLine>
</CreditNote>`;
  const p = parseUblInvoice(xml);
  assert(p, '9: parse null');
  assert(p.iade === false, `9: e-SMM CreditNote iade DEĞİL (bulundu ${p && p.iade})`);
  assert(p.documentType === 'E_SMM', `9: documentType E_SMM (bulundu ${p && p.documentType})`);
  assert(p.tevkifatKdv == null, `9: GV stopajı KDV tevkifatı sayılmaz (tevkifatKdv ${p && p.tevkifatKdv})`);
  assert(p.tevkifatOrani == null, '9: tevkifatOrani yok');
  approx(p.stopajTutari, 2000, `9: stopajTutari 2.000 (bulundu ${p && p.stopajTutari})`);
  approx(p.kdvTutari, 2000, '9: KDV 2.000');
  approx(p.matrah + p.kdvTutari - p.stopajTutari, p.odenecekTutar, '9: brüt + KDV − stopaj = ödenecek 10.000');
  const f = ublOcrDataFields(p);
  assert(f.isReturn === false, '9: ocrData.isReturn false');
  assert(f.tevkifatHint === false && f.tevkifatKdv === 0, '9: ocrData tevkifat ipucu yok');
  approx(f.stopajTutari, 2000, '9: ocrData.stopajTutari');
  assert(f.tevkifatKodu === undefined, '9: tevkifatKodu "3" gibi bozuk kod yazılmaz');
}

// ── 10) PayableRoundingAmount: ödenecek = matrah + KDV + yuvarlama → denklem yuvarlama düşülmüş tutarla ──
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>YUV2026000000001</cbc:ID><cbc:IssueDate>2026-08-05</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'ERP A.Ş.', '5555555555')}${party('AccountingCustomerParty', 'MÜŞTERİ', '6666666666')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200.13</cbc:TaxAmount>${sub(1000.67, 200.13, 20, '0015', 'KDV')}</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">1000.67</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">1000.67</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">1200.80</cbc:TaxInclusiveAmount><cbc:PayableRoundingAmount currencyID="TRY">0.20</cbc:PayableRoundingAmount><cbc:PayableAmount currencyID="TRY">1201.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
${line(1, 'Hizmet', 1, 1000.67, 1000.67, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200.13</cbc:TaxAmount>${sub(1000.67, 200.13, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '10: parse null');
  approx(p.odenecekYuvarlama, 0.2, `10: odenecekYuvarlama 0,20 (bulundu ${p && p.odenecekYuvarlama})`);
  approx(p.odenecekTutar, 1200.8, `10: odenecekTutar yuvarlama düşülmüş 1.200,80 (bulundu ${p && p.odenecekTutar})`);
  approx(p.toplamTutar, 1201, '10: toplamTutar ham ödenecek 1.201,00');
  approx(p.matrah + p.kdvTutari, p.odenecekTutar, '10: denklem yuvarlamasız tutar');
  const f = ublOcrDataFields(p);
  approx(f.odenecekTutar, 1200.8, '10: ocrData.odenecekTutar');
  approx(f.odenecekYuvarlama, 0.2, '10: ocrData.odenecekYuvarlama');
}

// ── 11) ÇOK ORANLI (%1 + %20): kdvOrani harman (14) DEĞİL null; kırılım 2 oran ──
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>
<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID><cbc:ID>MRK2026000000001</cbc:ID><cbc:IssueDate>2026-08-05</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
${party('AccountingSupplierParty', 'MARKET', '5555555555')}${party('AccountingCustomerParty', 'MÜŞTERİ', '6666666666')}
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">205</cbc:TaxAmount>${sub(500, 5, 1, '0015', 'KDV')}${sub(1000, 200, 20, '0015', 'KDV')}</cac:TaxTotal>
${totals(1500, 1705, 1705)}
${line(1, 'Ekmek', 1, 500, 500, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">5</cbc:TaxAmount>${sub(500, 5, 1, '0015', 'KDV')}</cac:TaxTotal>`)}
${line(2, 'Deterjan', 1, 1000, 1000, `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200</cbc:TaxAmount>${sub(1000, 200, 20, '0015', 'KDV')}</cac:TaxTotal>`)}
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '11: parse null');
  assert(p.kdvBreakdown && p.kdvBreakdown.length === 2, '11: 2 oran kırılımı');
  assert(p.kdvOrani === null, `11: çok oranlı belgede kdvOrani null (harman 14 DEĞİL; bulundu ${p && p.kdvOrani})`);
  // clearUblOnlyOcrFields: UBL dışı yeniden okumada bayat alanlar undefined'a çekilir
  const c = clearUblOnlyOcrFields();
  assert('odenecekTutar' in c && 'digerVergiToplam' in c && 'belgeDurumu' in c && 'parserVersion' in c && c.odenecekTutar === undefined, '11: clearUblOnlyOcrFields anahtarları');
  const merged = { odenecekTutar: 1250, digerVergiToplam: 50, matrah: 1, ...c, matrah: 1000 };
  assert(merged.odenecekTutar === undefined && merged.digerVergiToplam === undefined && merged.matrah === 1000, '11: spread ile bayat alan temizlenir, yeni alan kalır');
}

// 12) TEVKİFAT ÇIKARIMI (2026-09-15): Paraşüt sentetik XML — WithholdingTaxTotal yok, ödenecek = matrah + KDV − KDV×2/10.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>ZE22026000000009</ID><UUID>289014721</UUID><ProfileID>TICARIFATURA</ProfileID><IssueDate>2026-08-01</IssueDate>
  <DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>Mükellef</Name></PartyName><PartyIdentification><ID schemeID="TCKN">65647060374</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>CASALİNDA HASIR</Name></PartyName><PartyIdentification><ID schemeID="VKN">2030651445</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">3800.00</TaxAmount></TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="TRY">19000.00</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">22040.00</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">22040.00</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '12: parse null');
  approx(p.matrah, 19000, '12: matrah');
  approx(p.kdvTutari, 3800, '12: KDV TAM kalır (tevkifat düşülmez)');
  approx(p.tevkifatKdv, 760, '12: tevkifatKdv çıkarımı 760');
  assert(p.tevkifatYuzde === 20, `12: tevkifatYuzde 20 (bulundu ${p.tevkifatYuzde})`);
  approx(p.tevkifatOrani, 0.2, '12: tevkifatOrani 0,2');
  assert(p.tevkifatCikarim === true, '12: tevkifatCikarim bayrağı');
  approx(p.odenecekTutar, 22040, '12: odenecekTutar');
  const f = ublOcrDataFields(p);
  assert(f.tevkifatHint === true, '12: ocrData.tevkifatHint');
  approx(f.tevkifatKdv, 760, '12: ocrData.tevkifatKdv');
  assert(f.tevkifatCikarim === true, '12: ocrData.tevkifatCikarim');
  // Karşıt durum: fark KDV'nin x/10'u DEĞİL (ör. 500) → çıkarım YOK
  const p2 = parseUblInvoice(xml.replace('22040.00', '22300.00').replace('22040.00', '22300.00'));
  assert(p2 && !p2.tevkifatKdv && !p2.tevkifatCikarim, '12b: x/10 olmayan fark tevkifat sayılmaz');
  // Tevkifatsız normal belge (ödenecek = matrah + KDV) → çıkarım YOK
  const p3 = parseUblInvoice(xml.replace(/22040\.00/g, '22800.00'));
  assert(p3 && !p3.tevkifatKdv && !p3.tevkifatCikarim, '12c: tam ödenecekte tevkifat yok');
}

// 13) ALT TOPLAMSIZ TaxTotal + WithholdingTaxTotal (2026-09-15): TaxAmount TAM KDV ise düşülmez; tevkifatı da kapsıyorsa düşülür.
{
  const govde = (taxAmount, odenecek) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>SNT2026000000001</ID><ProfileID>TICARIFATURA</ProfileID><IssueDate>2026-08-01</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>SATICI</Name></PartyName><PartyIdentification><ID schemeID="VKN">1111111111</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>ALICI</Name></PartyName><PartyIdentification><ID schemeID="VKN">2222222222</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">${taxAmount}</TaxAmount></TaxTotal>
  <WithholdingTaxTotal><TaxAmount currencyID="TRY">400.00</TaxAmount><TaxSubtotal><TaxableAmount currencyID="TRY">2000.00</TaxableAmount><TaxAmount currencyID="TRY">400.00</TaxAmount><TaxCategory><Percent>20</Percent><TaxScheme><Name>KDV Tevkifatı</Name></TaxScheme></TaxCategory></TaxSubtotal></WithholdingTaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="TRY">10000.00</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">12000.00</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">${odenecek}</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  // a) TaxAmount = TAM KDV (2000): denklem 10000 + 2000 − 400 = 11600 tutar → KDV 2000 KALIR
  const pa = parseUblInvoice(govde('2000.00', '11600.00'));
  assert(pa, '13a: parse null');
  approx(pa.kdvTutari, 2000, '13a: tam KDV düşülmez');
  approx(pa.tevkifatKdv, 400, '13a: tevkifat 400');
  assert(pa.tevkifatYuzde === 20, '13a: yüzde 20');
  assert(!pa.tevkifatCikarim, '13a: açık veri, çıkarım değil');
  // b) TaxAmount tevkifatı da KAPSIYOR (2400 = 2000 + 400): denklem tutmaz → 400 düşülür → KDV 2000
  const pb = parseUblInvoice(govde('2400.00', '11600.00'));
  assert(pb, '13b: parse null');
  approx(pb.kdvTutari, 2000, '13b: kapsayan TaxAmount\'tan tevkifat düşülür');
  approx(pb.tevkifatKdv, 400, '13b: tevkifat 400');
}

// 14) ÖTV KDV MATRAHININ İÇİNDE (2026-09-15 — HAS OTOMOTİV kamyon alışı): KDV tabanı = mal bedeli + ÖTV; ÖTV çift sayılmasın.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>10N2026000000416</ID><ProfileID>TEMELFATURA</ProfileID><IssueDate>2026-08-21</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>HAS OTOMOTİV</Name></PartyName><PartyIdentification><ID schemeID="VKN">4580014378</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>YORGUN NAKLİYAT</Name></PartyName><PartyIdentification><ID schemeID="VKN">9821096129</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">894712.48</TaxAmount>
    <TaxSubtotal><TaxableAmount currencyID="TRY">3749340.84</TaxableAmount><TaxAmount currencyID="TRY">749868.17</TaxAmount><Percent>20.00</Percent><TaxCategory><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
    <TaxSubtotal><TaxableAmount currencyID="TRY">3621107.75</TaxableAmount><TaxAmount currencyID="TRY">144844.31</TaxAmount><Percent>4.00</Percent><TaxCategory><TaxScheme><Name>ÖTV</Name><TaxTypeCode>9077</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
  </TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">3621107.66</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">3621107.66</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">4499209.01</TaxInclusiveAmount>
    <AllowanceTotalAmount currencyID="TRY">16611.13</AllowanceTotalAmount>
    <PayableAmount currencyID="TRY">4499209.01</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '14: parse null');
  approx(p.digerVergiToplam, 144844.31, '14: ÖTV diğer vergi');
  assert(p.digerVergiMatrahaDahil === true, '14: digerVergiMatrahaDahil bayrağı');
  approx(p.matrah, 3604496.53, '14: matrah = mal bedeli (ÖTV arındırılmış, iskonto düşülmüş)');
  assert(p.kdvBreakdown && p.kdvBreakdown.length === 1, '14: tek oran kırılımı');
  approx(p.kdvBreakdown[0].base, 3604496.53, '14: %20 tabanı ÖTV arındırılmış');
  approx(p.kdvBreakdown[0].amount, 749868.17, '14: KDV tutarı değişmez');
  approx(p.matrah + p.kdvTutari + p.digerVergiToplam, 4499209.01, '14: mal bedeli + ÖTV + KDV = ödenecek');
  const f = ublOcrDataFields(p);
  assert(f.digerVergiMatrahaDahil === true, '14: ocrData.digerVergiMatrahaDahil');
  // Karşıt: ÖİV gibi KDV matrahına GİRMEYEN vergi (denklem zaten tutar) → dokunulmaz.
  const xmlOiv = xml
    .replace('3749340.84', '3604496.53').replace('749868.17', '720899.31').replace('749868.17', '720899.31')
    .replace('894712.48', '865743.62').replace(/4499209\.01/g, '4470240.15')
    .replace('<Name>ÖTV</Name><TaxTypeCode>9077</TaxTypeCode>', '<Name>ÖİV</Name><TaxTypeCode>4080</TaxTypeCode>');
  const q = parseUblInvoice(xmlOiv);
  assert(q && !q.digerVergiMatrahaDahil, '14b: KDV matrahına girmeyen vergide düzeltme yok');
  approx(q.kdvBreakdown[0].base, 3604496.53, '14b: taban dokunulmadı');
}

// 15) ÖDENECEK ≠ FATURA TUTARI — önceki dönem bakiyesi (2026-09-15 İGDAŞ ES02026002064120): fiş fatura tutarıyla kurulur.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>ES02026002064120</ID><ProfileID>TEMELFATURA</ProfileID><IssueDate>2026-08-18</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>İGDAŞ</Name></PartyName><PartyIdentification><ID schemeID="VKN">4700022607</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>ÖZ ELA</Name></PartyName><PartyIdentification><ID schemeID="VKN">6620808781</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">8.48</TaxAmount><TaxSubtotal><TaxableAmount currencyID="TRY">42.39</TaxableAmount><TaxAmount currencyID="TRY">8.48</TaxAmount><Percent>20</Percent><TaxCategory><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal></TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">42.39</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">42.39</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">50.87</TaxInclusiveAmount>
    <PayableRoundingAmount currencyID="TRY">-0.19</PayableRoundingAmount>
    <PayableAmount currencyID="TRY">438.00</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '15: parse null');
  approx(p.odenecekTutar, 50.87, '15: ödenecek = fatura tutarı (TaxInclusive)');
  approx(p.odenecekFarki, 387.13, '15: bakiye farkı 438,00 − 50,87');
  assert(p.odenecekFarkiNeden === 'bakiye', '15: neden bakiye');
  approx(p.toplamTutar, 438, '15: ham ödenecek toplamTutar\'da kalır');
  const f = ublOcrDataFields(p);
  approx(f.odenecekTutar, 50.87, '15: ocrData.odenecekTutar');
  approx(f.odenecekFarki, 387.13, '15: ocrData.odenecekFarki');
}

// 16) YUVARLAMA İŞARETİ ERP'ye göre (2026-09-15 Superonline 01S2026001550180): PayableRounding +0,06 ama fiilen −0,06.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>01S2026001550180</ID><ProfileID>TEMELFATURA</ProfileID><IssueDate>2026-08-31</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>SUPERONLINE</Name></PartyName><PartyIdentification><ID schemeID="VKN">1750331214</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>ÖZ ELA</Name></PartyName><PartyIdentification><ID schemeID="VKN">6620808781</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">276.42</TaxAmount>
    <TaxSubtotal><TaxableAmount currencyID="TRY">939.74</TaxableAmount><TaxAmount currencyID="TRY">187.95</TaxAmount><Percent>20</Percent><TaxCategory><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
    <TaxSubtotal><TaxableAmount currencyID="TRY">884.71</TaxableAmount><TaxAmount currencyID="TRY">88.47</TaxAmount><Percent>10</Percent><TaxCategory><TaxScheme><Name>Özel İletişim Vergisi</Name><TaxTypeCode>4081</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
  </TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">939.68</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">939.74</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">1216.10</TaxInclusiveAmount>
    <PayableRoundingAmount currencyID="TRY">0.06</PayableRoundingAmount>
    <PayableAmount currencyID="TRY">1216.10</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '16: parse null');
  approx(p.odenecekTutar, 1216.16, '16: ödenecek = denklem (ham + 0,06)');
  approx(p.odenecekFarki, -0.06, '16: yuvarlama farkı −0,06');
  assert(p.odenecekFarkiNeden === 'yuvarlama', '16: neden yuvarlama');
  assert(!p.digerVergiMatrahaDahil, '16: ÖİV tabana dahil değil');
  approx(p.matrah + p.kdvTutari + p.digerVergiToplam, 1216.16, '16: denklem');
  assert(kdvDisiVergiOivMi(p.digerVergiler[0]) === true, '16: ÖİV tanındı');
}

// 17) BTV (elektrik tüketim vergisi) KDV TABANINDA + PayableRounding alanına fatura tutarı yazan ERP (2026-09-15 CK Boğaziçi BEF2026002999464).
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>BEF2026002999464</ID><ProfileID>TEMELFATURA</ProfileID><IssueDate>2026-08-12</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>CK BOĞAZİÇİ</Name></PartyName><PartyIdentification><ID schemeID="VKN">1790617537</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>İLGİ OTO</Name></PartyName><PartyIdentification><ID schemeID="VKN">4711002578</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">267.34</TaxAmount>
    <TaxSubtotal><TaxableAmount currencyID="TRY">1182.19</TaxableAmount><TaxAmount currencyID="TRY">236.44</TaxAmount><Percent>20</Percent><TaxCategory><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
    <TaxSubtotal><TaxableAmount currencyID="TRY">30.9</TaxableAmount><TaxAmount currencyID="TRY">30.9</TaxAmount><TaxCategory><TaxScheme><Name>BTV</Name><TaxTypeCode>8005</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
  </TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">1182.19</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">1151.12</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">1418.46</TaxInclusiveAmount>
    <PayableRoundingAmount currencyID="TRY">1418.46</PayableRoundingAmount>
    <PayableAmount currencyID="TRY">1420</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '17: parse null');
  assert(p.digerVergiMatrahaDahil === true, '17: BTV tabana dahil');
  approx(p.kdvBreakdown[0].base, 1151.29, '17: taban BTV arındırılmış');
  approx(p.matrah, 1151.29, '17: matrah = enerji bedeli');
  approx(p.odenecekTutar, 1418.63, '17: ödenecek = denklem (gevşek toleransta yuvarlama fişe girmez)');
  approx(p.odenecekFarki, 1.37, '17: yuvarlama 1,37 (önceki −0,17 + güncel 1,54)');
  assert(p.odenecekFarkiNeden === 'yuvarlama', '17: neden yuvarlama');
  assert(Math.abs(p.matrah + p.kdvTutari + p.digerVergiToplam - p.odenecekTutar) <= 0.5, '17: denklem ±0,50 (önceki yuvarlama 0,17)');
}

// 18) TaxSubtotal'da TaxableAmount YOK (2026-09-15 GİTO EFA2026000000215): taban KDV/oran'dan, tek oranda TaxExclusive ile hizalanır.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>EFA2026000000215</ID><ProfileID>TEMELFATURA</ProfileID><IssueDate>2026-08-05</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>SATICI</Name></PartyName><PartyIdentification><ID schemeID="VKN">1111111111</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>GİTO</Name></PartyName><PartyIdentification><ID schemeID="VKN">2222222222</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">191.05</TaxAmount><TaxSubtotal><TaxAmount currencyID="TRY">191.05</TaxAmount><Percent>1</Percent><TaxCategory><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal></TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">19105</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">19105</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">19296.05</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">19296.05</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '18: parse null');
  assert(p.kdvBreakdown && p.kdvBreakdown.length === 1, '18: tek oran');
  approx(p.kdvBreakdown[0].base, 19105, '18: taban TaxExclusive ile hizalandı');
  approx(p.kdvBreakdown[0].amount, 191.05, '18: KDV');
  approx(p.matrah + p.kdvTutari, 19296.05, '18: denklem');
}

// 19) TaxTotal/TaxAmount kırılımdan ŞİŞKİN + TaxExclusive=TaxInclusive + PayableRounding alanına fatura tutarı (Turkcell BEA2026020373433).
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>BEA2026020373433</ID><ProfileID>EARSIVFATURA</ProfileID><IssueDate>2026-08-05</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>Turkcell Iletisim Hizmetleri A.S.</Name></PartyName><PartyIdentification><ID schemeID="VKN">8770013406</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>ERCAN ÖZTAMUR</Name></PartyName><PartyIdentification><ID schemeID="TCKN">11111111111</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">98.41</TaxAmount><TaxSubtotal><TaxableAmount currencyID="TRY">888.76</TaxableAmount><TaxAmount currencyID="TRY">88.88</TaxAmount><Percent>10</Percent><TaxCategory><TaxScheme><Name>KDV8</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal></TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">888.76</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">977.68</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">977.68</TaxInclusiveAmount>
    <PayableRoundingAmount currencyID="TRY">977.68</PayableRoundingAmount>
    <PayableAmount currencyID="TRY">980</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '19: parse null');
  approx(p.kdvTutari, 88.88, '19: KDV kırılımdan');
  approx(p.matrah, 888.76, '19: matrah taban');
  approx(p.odenecekTutar, 977.68, '19: ödenecek fatura tutarı');
  approx(p.odenecekFarki, 2.32, '19: yuvarlama 2,32');
  assert(p.odenecekFarkiNeden === 'yuvarlama', '19: neden yuvarlama');
}

// 20) KDV'SİZ KALEM (depozito 180) + aynı tabanı tekrar eden %0 muafiyet satırı (Sabri Aksoy EAG2026000002056).
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>EAG2026000002056</ID><ProfileID>EARSIVFATURA</ProfileID><IssueDate>2026-08-05</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>SATICI</Name></PartyName><PartyIdentification><ID schemeID="VKN">1111111111</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>SABRİ AKSOY</Name></PartyName><PartyIdentification><ID schemeID="TCKN">22222222222</ID></PartyIdentification></Party></AccountingCustomerParty>
  <AllowanceCharge><ChargeIndicator>true</ChargeIndicator><AllowanceChargeReason>Satış Depozito Tutarı</AllowanceChargeReason><Amount currencyID="TRY">180.00</Amount></AllowanceCharge>
  <TaxTotal><TaxAmount currencyID="TRY">318.00</TaxAmount>
    <TaxSubtotal><TaxableAmount currencyID="TRY">1590.00</TaxableAmount><TaxAmount currencyID="TRY">318.00</TaxAmount><Percent>20.00</Percent><TaxCategory><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
    <TaxSubtotal><TaxableAmount currencyID="TRY">1590.00</TaxableAmount><TaxAmount currencyID="TRY">0</TaxAmount><Percent>0</Percent><TaxCategory><TaxExemptionReasonCode>351</TaxExemptionReasonCode><TaxExemptionReason>İSTISNA OLMAYAN DIĞER</TaxExemptionReason><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal>
  </TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">1770.00</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">1770.00</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">2088.00</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">2088.00</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '20: parse null');
  approx(p.matrah, 1770, '20: matrah = 1590 + 180 depozito');
  const bd = p.kdvBreakdown || [];
  assert(bd.length === 2 && bd.some((b) => b.rate === 20 && Math.abs(b.base - 1590) < 0.01) && bd.some((b) => b.rate === 0 && Math.abs(b.base - 180) < 0.01), `20: kırılım %20 1590 + %0 180 (bulundu ${JSON.stringify(bd)})`);
  approx(p.odenecekTutar, 2088, '20: ödenecek');
  assert(p.odenecekFarki == null, '20: fark yok');
}

// 21) ÖZEL MATRAH KDVK 23/f (tütün "KDV Dahil", muafiyet 806) — Sabri Aksoy N052026000001173: mal bedeli TaxExclusive, KDV perakende tabandan.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>N052026000001173</ID><ProfileID>EARSIVFATURA</ProfileID><IssueDate>2026-08-05</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>TÜTÜN DAĞITIM A.Ş.</Name></PartyName><PartyIdentification><ID schemeID="VKN">1111111111</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>SABRİ AKSOY</Name></PartyName><PartyIdentification><ID schemeID="TCKN">22222222222</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">14518.32</TaxAmount><TaxSubtotal><TaxableAmount currencyID="TRY">72591.68</TaxableAmount><TaxAmount currencyID="TRY">14518.32</TaxAmount><Percent>20</Percent><TaxCategory><TaxExemptionReasonCode>806</TaxExemptionReasonCode><TaxExemptionReason>Tütün mamülleri ve bazi alkollü içkiler.</TaxExemptionReason><TaxScheme><Name>KDV Dahil</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal></TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="TRY">83190.05</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="TRY">68671.73</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">83190.05</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">83190.05</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '21: parse null');
  approx(p.matrah, 68671.73, '21: mal bedeli TaxExclusive');
  approx(p.kdvBreakdown[0].base, 68671.73, '21: kırılım tabanı mal bedeline çekildi');
  approx(p.kdvTutari, 14518.32, '21: KDV değişmez');
  assert(p.ozelMatrah && Math.abs(p.ozelMatrah.kdvTabani - 72591.68) < 0.01, '21: ozelMatrah.kdvTabani 72.591,68');
  approx(p.matrah + p.kdvTutari, 83190.05, '21: denklem');
  const f = ublOcrDataFields(p);
  assert(f.ozelMatrah && f.ozelMatrah.malBedeli === 68671.73, '21: ocrData.ozelMatrah');
}

// 22) ÖİV ÇIKARIMI — Paraşüt özet XML (ÖİV yok), telekom satıcı, ödenecek − (matrah + KDV) = tabanın %10'u (Zeki P012026003122101).
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>P012026003122101</ID><ProfileID>TICARIFATURA</ProfileID><IssueDate>2026-07-31</IssueDate><DocumentCurrencyCode>TRY</DocumentCurrencyCode>
  <AccountingSupplierParty><Party><PartyName><Name>Türk Telekomünikasyon A.Ş</Name></PartyName><PartyIdentification><ID schemeID="VKN">8760052205</ID></PartyIdentification></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>ZEKİ ÖZKAYNAK</Name></PartyName><PartyIdentification><ID schemeID="TCKN">65647060374</ID></PartyIdentification></Party></AccountingCustomerParty>
  <TaxTotal><TaxAmount currencyID="TRY">43.73</TaxAmount><TaxSubtotal><TaxableAmount currencyID="TRY">218.65</TaxableAmount><TaxAmount currencyID="TRY">43.73</TaxAmount><TaxCategory><Percent>20</Percent><TaxScheme><Name>KDV</Name><TaxTypeCode>0015</TaxTypeCode></TaxScheme></TaxCategory></TaxSubtotal></TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="TRY">218.65</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="TRY">284.25</TaxInclusiveAmount>
    <PayableAmount currencyID="TRY">284.25</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  const p = parseUblInvoice(xml);
  assert(p, '22: parse null');
  assert(p.oivCikarim === true, '22: oivCikarim');
  approx(p.digerVergiToplam, 21.87, '22: ÖİV 21,87');
  assert(p.digerVergiler && p.digerVergiler[0].kod === '4080', '22: ÖİV kodu 4080');
  approx(p.matrah + p.kdvTutari + p.digerVergiToplam, 284.25, '22: denklem');
  // Karşıt: telekom olmayan satıcı → çıkarım YOK
  const q = parseUblInvoice(xml.replace('Türk Telekomünikasyon A.Ş', 'KIRTASİYE LTD'));
  assert(q && !q.oivCikarim, '22b: telekom değilse çıkarım yok');
}

if (failed) { console.error(`[ubl-parse] ${failed} hata`); process.exit(1); }
console.log('[ubl-parse] OK — tevkifatlı satış, telekom karışık vergi, iade/iptal (not karar vermez), iskonto, döviz, vergi türü süzgeci, kısmi tevkifat, e-SMM stopaj, yuvarlama, çok oranlı kdvOrani, tevkifat çıkarımı (sentetik XML), alt toplamsız tevkifat aritmetiği, ÖTV/BTV KDV-matrahı arındırma, bakiye/yuvarlama ödenecek çözümü, TaxableAmount eksik taban türetme, şişkin TaxTotal, KDVsiz kalem/çift %0, özel matrah 23/f, ÖİV çıkarımı');
