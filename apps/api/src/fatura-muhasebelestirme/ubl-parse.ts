/**
 * UBL-TR (e-Fatura / e-Arşiv) XML → tek okuma sonucu (SAF, servis bağımsız).
 *
 * Faz 0 "Kanamayı durdur" (PLAN/15 sentez, 2026-09-12): Aktar yolu ile "AI ile oku" yolu AYNI
 * ayrıştırıcıyı kullanır; tevkifat (kod + yüzde + tutar), iade işareti, belge durumu, KDV dışı
 * vergiler (ÖİV / telsiz / ÖTV / damga …), iskonto dağılımı, döviz + kur ve UBL ödenecek tutar
 * BURADAN çıkar. Servisteki `parseProviderUblInvoice` yalnız bu fonksiyona sarmaldır.
 *
 * Regresyon: scripts/ubl-parse-regression.cjs (tevkifatlı satış, telekom karışık vergi, iadeli alış,
 * iskontolu kalem).
 */
import { XMLParser } from 'fast-xml-parser';

export type ParsedProviderInvoice = {
  faturaNo: string;
  faturaTarihi: Date | null;
  ettn?: string | null;
  satici?: string | null;
  saticiVergiNo?: string | null;
  alici?: string | null;
  aliciVergiNo?: string | null;
  matrah?: number | null;
  kdvTutari?: number | null;
  kdvOrani?: number | null;
  /** Çok-oranlı KDV kırılımı (her oran ayrı): %10 ve %20 gibi karma faturada şart. */
  kdvBreakdown?: Array<{ rate: number; base: number; amount: number }>;
  /** Tevkif edilen (alıkonan) KDV tutarı — UBL WithholdingTaxTotal. Satışta 391'e NET KDV gider. */
  tevkifatKdv?: number;
  /** UBL WithholdingTaxTotal/TaxSubtotal/TaxCategory/TaxScheme/TaxTypeCode (UBL-TR 6xx; ör. 624 yük taşımacılığı). */
  tevkifatKodu?: string;
  /** UBL'deki tevkifat yüzdesi (TaxCategory/Percent; 2/10 → 20). */
  tevkifatYuzde?: number;
  /**
   * Tevkifat oranı 0..1. Percent/100 YALNIZ tutarla tutarlıysa (|kdvTutari × yüzde/100 − tevkifatKdv| ≤ 0,05)
   * kullanılır; kısmi tevkifatlı (bazı kalemler tevkifatsız) faturada tutar oranı (tevkifatKdv / kdvTutari).
   * Hesap seçimi (191/391 tevkifat payı) için; 360/sorumlu-191 TUTARI tevkifatKdv'den kurulur.
   */
  tevkifatOrani?: number;
  /** CANLI BULGU (BRN2026000000483, 2026-09-12): WithholdingTaxTotal dolu (kod 624, 400 TL) ama PayableAmount = TaxInclusiveAmount
   *  (tevkifat düşülmemiş) → satıcı tevkifatı UYGULAMAMIŞ; belge tam KDV ile ödenecek. tevkifatKdv 0'a çekilir, kod/yüzde bilgi olarak
   *  kalır ve bu bayrak + beyan edilen tutar (uyarı katmanı TEVKIFAT_UYGULANMAMIS) döner. */
  tevkifatUygulanmamis?: { kod?: string; yuzde?: number; beyanEdilen: number };
  /** SMM gelir vergisi stopajı (UBL WithholdingTaxTotal, TaxTypeCode 0003/0011 — KDV tevkifatı DEĞİL). */
  stopajTutari?: number;
  /** Belge türü ipucu: e-SMM (ProfileID ESERBESTMESLEKMAKBUZU / CreditNoteTypeCode SERBESTMESLEKMAKBUZU). */
  documentType?: 'E_SMM' | null;
  /**
   * İade belgesi: CreditNote kökü (SMM hariç) ya da InvoiceTypeCode IADE/TEVKIFATIADE. Serbest metin
   * <cbc:Note> KARAR VERMEZ (standart satış notlarında "iade faturası düzenlenmesi halinde…" geçer);
   * yalnız InvoiceTypeCode BOŞKEN olumlu bildirim kalıbı ("İADE FATURASIDIR") kabul edilir.
   */
  iade?: boolean;
  /** InvoiceTypeCode ham değeri (SATIS / IADE / TEVKIFAT / ISTISNA / OZELMATRAH …). */
  faturaTipi?: string | null;
  /** Belge durumu: iptal (InvoiceTypeCode IPTAL), taslak (ProfileID/ID TASLAK), yoksa onayli. Not metni karar vermez. */
  belgeDurumu?: 'onayli' | 'iptal' | 'taslak';
  /** KDV dışı vergiler (0015 dışındaki her TaxSubtotal): ÖİV 4080/4081, telsiz 8001-8008, ÖTV, damga … */
  digerVergiler?: Array<{ kod: string; ad: string; tutar: number; oran?: number }>;
  digerVergiToplam?: number;
  /** İskonto: kalem düzeyi (satır AllowanceCharge) + belge düzeyi (kalemlere oransal dağıtıldı). */
  iskonto?: { kalem: number; belge: number; toplam: number };
  toplamTutar?: number | null;
  /**
   * UBL LegalMonetaryTotal/PayableAmount − PayableRoundingAmount (yuvarlama düşülmüş) — belge toplamı
   * doğrulaması için: matrah + KDV + diğer vergi − tevkifat − stopaj = odenecekTutar.
   */
  odenecekTutar?: number;
  /** UBL PayableRoundingAmount (bazı ERP'ler yazar; isteğe bağlı). Bilgi amaçlı, denkleme girmez. */
  odenecekYuvarlama?: number;
  paraBirimi?: string | null;
  /** Döviz kuru (PricingExchangeRate/CalculationRate); TL belgede yok. */
  kur?: number;
  kalemler?: Array<{ ad: string; tutar: number; oran: number }>;
};

/** UBL-TR vergi türü kodları → okunur ad (KDV dışı). Tanınmayan kod → "Diğer vergi (<kod>)". */
export const KDV_DISI_VERGI_ADLARI: Record<string, string> = {
  '4080': 'Özel İletişim Vergisi',
  '4081': '5035 Sayılı Kanuna Göre Özel İletişim Vergisi',
  '4071': 'Elektrik ve Havagazı Tüketim Vergisi',
  '8001': 'Borsa Tescil Ücreti',
  '8002': 'Enerji Fonu',
  '8004': 'TRT Payı',
  '8005': 'Elektrik Tüketim Vergisi',
  '8006': 'Telsiz Kullanım Ücreti',
  '8007': 'Telsiz Ruhsat Ücreti',
  '8008': 'Çevre Temizlik Vergisi',
  '9077': 'Motorlu Taşıt Araçları ÖTV',
  '0071': 'Petrol ve Doğalgaz Ürünleri ÖTV',
  '0073': 'Kolalı Gazoz, Alkollü İçecek ve Tütün ÖTV',
  '0074': 'Dayanıklı Tüketim ve Diğer Mallar ÖTV',
  '0075': 'Alkollü İçkiler ÖTV',
  '0076': 'Tütün Mamulleri ÖTV',
  '0077': 'Kolalı Gazozlar ÖTV',
  '0059': 'Konaklama Vergisi',
  '0021': 'Banka ve Sigorta Muameleleri Vergisi',
  '1047': 'Damga Vergisi',
  '1048': '5035 Sayılı Kanuna Göre Damga Vergisi',
  '9040': 'Mera Fonu',
  '9021': 'Enerji Fonu',
  '9944': 'Belediye Tüketim Vergisi',
  '9945': 'Bakanlık Payı',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Metin düğümü → string (parser sayıyı Number'a çevirir; dizi/obje sarmalını açar). */
export function ublText(value: any): string | undefined {
  if (value == null) return undefined;
  // Parser "false"/"true" metnini boolean'a çevirir (ChargeIndicator) → string'e döndür.
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return ublText(value[0]);
  if (typeof value === 'object') return ublText(value['#text'] ?? value._);
  return undefined;
}

/** UBL sayısal alan → number (TR "1.234,56" ve EN "1234.56" ikisini de okur). */
export function ublNum(value: any): number | undefined {
  const raw = ublText(value);
  if (!raw) return undefined;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

/** Vergi türü kodunu 4 haneye tamamla ("15" → "0015"; parser baştaki sıfırları atar). */
export function normalizeTaxTypeCode(code: any): string {
  const raw = String(ublText(code) ?? '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? raw.padStart(4, '0') : raw.toUpperCase();
}

/**
 * Bir TaxSubtotal KDV mi? YALNIZ 0015 (Gerçek usulde KDV) ya da adında açıkça "KDV / Katma Değer"
 * geçen tür KDV'dir. 8001-8008 (telsiz/fon/pay), 4080/4081 (ÖİV), 0071-0077/9077 (ÖTV), 0059,
 * damga ve TANINMAYAN kodlar KDV DEĞİLDİR. Kod da ad da yoksa (Paraşüt sentetik XML, eksik UBL)
 * eski davranış korunur: KDV sayılır.
 */
export function isKdvTaxSubtotal(sub: any): boolean {
  const scheme: any = sub?.TaxCategory?.TaxScheme || sub?.TaxScheme || null;
  const code = normalizeTaxTypeCode(scheme?.TaxTypeCode);
  const nameFold = String(ublText(scheme?.Name) || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  if (code === '0015' || /KDV/.test(code)) return true; // bazı entegratörler kodu 'KDV' yazar
  if (/(^|[^a-z])kdv([^a-z]|$)|katma\s*deger/.test(nameFold)) return true;
  if (code) return false; // 0015 dışı her kod KDV değil (tanınmayan dahil)
  if (/ozel iletisim|ozel tuketim|damga verg|konaklama verg|banka ve sigorta|(^|\s)bsmv(\s|$)|telsiz|enerji fonu|trt pay/.test(nameFold)) return false;
  return true; // kod yok, ad yok → KDV (geriye uyum)
}

function asArray(value: any): any[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }

/**
 * Belge düzeyi iskontoyu kalemlere ORANSAL dağıt: Σ kalem.tutar = hedef (TaxExclusiveAmount).
 * Kuruş farkı son kaleme yazılır (toplam TAM tutar). Kalem yoksa / hedef geçersizse dokunmaz.
 */
export function distributeDocumentDiscount<T extends { tutar: number }>(kalemler: T[], hedefToplam: number): T[] {
  if (!Array.isArray(kalemler) || !kalemler.length) return kalemler;
  const sum = kalemler.reduce((s, k) => s + (Number(k.tutar) || 0), 0);
  if (!(sum > 0) || !(hedefToplam >= 0) || Math.abs(sum - hedefToplam) < 0.005) return kalemler;
  const out = kalemler.map((k) => ({ ...k, tutar: round2((Number(k.tutar) || 0) * hedefToplam / sum) }));
  const dist = out.reduce((s, k) => s + k.tutar, 0);
  const diff = round2(hedefToplam - dist);
  if (diff !== 0) out[out.length - 1].tutar = round2(out[out.length - 1].tutar + diff);
  return out;
}

export function parseUblInvoice(xml: string, warn?: (msg: string) => void): ParsedProviderInvoice | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xml);
    const findRoot = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      for (const key of Object.keys(obj)) {
        if (/^(Invoice|CreditNote)$/i.test(key)) return obj[key];
      }
      for (const key of Object.keys(obj)) {
        const inner = findRoot(obj[key]);
        if (inner) return inner;
      }
      return null;
    };
    const root = findRoot(parsed);
    if (!root) return null;
    const get = (path: string[]) => {
      let cur = root;
      for (const part of path) {
        if (!cur) return undefined;
        cur = cur[part];
      }
      return cur;
    };
    const txt = ublText;
    const num = ublNum;
    const digits = (value: any): string | undefined => {
      const cleaned = String(value || '').replace(/\D/g, '');
      return cleaned.length === 10 || cleaned.length === 11 ? cleaned : undefined;
    };
    const idText = (node: any): string | undefined => txt(node?.ID) || txt(node?.CompanyID) || txt(node);
    const idScheme = (node: any): string =>
      String(node?.ID?.['@schemeID'] || node?.CompanyID?.['@schemeID'] || node?.['@schemeID'] || '').toUpperCase();
    const taxNoFromParty = (party: any): string | undefined => {
      const nodes = [
        ...asArray(party?.PartyTaxScheme),
        ...asArray(party?.PartyIdentification),
        ...asArray(party?.PartyLegalEntity),
      ];
      for (const node of nodes) {
        const no = digits(idText(node));
        const scheme = idScheme(node);
        if (no && (scheme === 'VKN' || scheme === 'TCKN')) return no;
      }
      for (const node of nodes) {
        const no = digits(idText(node));
        if (no) return no;
      }
      return undefined;
    };
    const taxNoFromXmlBlock = (tag: string): string | undefined => {
      const block = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}>`, 'i'))?.[1] || '';
      return (
        block.match(/<[^>]*(?:ID|CompanyID)[^>]*schemeID=["'](?:VKN|TCKN)["'][^>]*>\s*(\d{10,11})\s*<\//i)?.[1] ||
        block.match(/<[^>]*CompanyID[^>]*>\s*(\d{10,11})\s*<\//i)?.[1]
      );
    };
    // Belge no = HAM XML'deki İLK <cbc:ID> (fatura no; ProfileID/party-ID değil). Parser sayısal/uzun
    //   ID'yi number'a çevirip "NaN"/bilimsel-gösterime bozabiliyor (ANPA/MENGERLER "NaN" idi) → regex
    //   ile aynen string al; parser sonucu yedek. "NaN"/boş asla yazılmaz.
    const faturaNoRegex = xml.match(/<(?:cbc:)?ID>\s*([^<]+?)\s*<\/(?:cbc:)?ID>/i)?.[1];
    const faturaNoRaw = (faturaNoRegex || txt(get(['ID'])) || '').trim();
    const faturaNo = /^nan$/i.test(faturaNoRaw) ? '' : faturaNoRaw;
    const ettn = txt(get(['UUID']));
    const issueDateRaw = txt(get(['IssueDate']));
    const issueDate = issueDateRaw ? new Date(issueDateRaw) : null;
    const supplier = get(['AccountingSupplierParty', 'Party']);
    const customer = get(['AccountingCustomerParty', 'Party']);
    const monetaryTotal = get(['LegalMonetaryTotal']) || get(['RequestedMonetaryTotal']) || {};
    const taxTotalRaw = get(['TaxTotal']);
    const taxTotals = asArray(taxTotalRaw);

    // ── TEVKİFAT / STOPAJ: cac:WithholdingTaxTotal → koda göre AYRIŞTIR ──
    //   6xx (UBL-TR tevkifat kodları; ör. 624 yük taşımacılığı) → KDV tevkifatı (tevkifatKdv).
    //   0003 (GV stopajı) / 0011 (KV stopajı) → stopajTutari (e-SMM: serbest meslek makbuzunda stopaj
    //   WithholdingTaxTotal içinde gelir; KDV tevkifatı DEĞİLDİR, 360 KDV2 satırı kurulmaz).
    //   Kodsuz alt toplam → KDV tevkifatı (geriye uyum). Stopaj kodu 4 haneye tamamlanır (parser "0003" → 3
    //   yapar); tevkifat kodu 3 hane kalır (624). Birden çok alt toplam varsa tutarlar toplanır, ilk kod/yüzde alınır.
    const STOPAJ_KODLARI = new Set(['0003', '0011']);
    // Tevkifat kodu 3 hane (601-6xx) → olduğu gibi; stopaj 4 hane (0003/0011) → başa sıfır (parser "0003" → 3 yapar).
    const normalizeWithholdingCode = (code: any): string => {
      const raw = String(txt(code) ?? '').trim();
      if (!raw) return '';
      if (/^\d+$/.test(raw)) return Number(raw) < 100 ? raw.padStart(4, '0') : raw;
      return raw.toUpperCase();
    };
    const withholdingSubs = (w: any): any[] => asArray(w?.TaxSubtotal);
    const subKind = (sub: any): 'stopaj' | 'tevkifat' => {
      const scheme: any = sub?.TaxCategory?.TaxScheme || sub?.TaxScheme || null;
      const kod = normalizeWithholdingCode(scheme?.TaxTypeCode);
      const nameFold = String(txt(scheme?.Name) || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
      if (STOPAJ_KODLARI.has(kod)) return 'stopaj';
      if (!kod && /gelir\s*vergisi|stopaj|kurumlar\s*vergisi/.test(nameFold) && !/kdv|katma/.test(nameFold)) return 'stopaj';
      return 'tevkifat';
    };
    let tevkifatKdvSum = 0;
    let stopajSum = 0;
    let tevkifatKodu: string | undefined;
    let tevkifatYuzde: number | undefined;
    const withholdingSweep = (totals: any[]) => {
      for (const w of totals) {
        const subs = withholdingSubs(w);
        const wTotal = num(w?.TaxAmount);
        if (!subs.length) { if (wTotal != null && wTotal > 0) tevkifatKdvSum += wTotal; continue; }
        let subSum = 0;
        for (const sub of subs) {
          const scheme: any = sub?.TaxCategory?.TaxScheme || sub?.TaxScheme || null;
          const kod = normalizeWithholdingCode(scheme?.TaxTypeCode);
          const yuzde = num(sub?.TaxCategory?.Percent) ?? num(sub?.Percent);
          const tutar = num(sub?.TaxAmount);
          const kind = subKind(sub);
          if (tutar != null && tutar > 0) { subSum += tutar; if (kind === 'stopaj') stopajSum += tutar; else tevkifatKdvSum += tutar; }
          if (kind === 'tevkifat') {
            if (!tevkifatKodu && kod) tevkifatKodu = kod;
            if (tevkifatYuzde == null && yuzde != null && yuzde > 0) tevkifatYuzde = yuzde;
          }
        }
        // Alt toplam tutarları boş ama toplam dolu (eksik UBL) → toplamı tevkifat say (geriye uyum).
        if (!(subSum > 0) && wTotal != null && wTotal > 0) tevkifatKdvSum += wTotal;
      }
    };
    withholdingSweep(asArray(get(['WithholdingTaxTotal'])));
    // WithholdingTaxTotal yoksa ama InvoiceLine/WithholdingTaxTotal varsa (bazı entegratörler satır bazlı yazar)
    const lineNodes = [...asArray(get(['InvoiceLine'])), ...asArray(get(['CreditNoteLine']))];
    if (!(tevkifatKdvSum > 0) && !(stopajSum > 0)) {
      withholdingSweep(lineNodes.flatMap((line) => asArray(line?.WithholdingTaxTotal)));
    }

    const taxAmounts = taxTotals
      .map((taxTotal) => num(taxTotal?.TaxAmount))
      .filter((amount): amount is number => amount != null);
    const lineMatrah = lineNodes
      .map((line) => num(line?.LineExtensionAmount))
      .filter((amount): amount is number => amount != null)
      .reduce((sum, amount) => sum + amount, 0);
    const lineTax = lineNodes
      .flatMap((line) => asArray(line?.TaxTotal))
      .map((taxTotal) => num(taxTotal?.TaxAmount))
      .filter((amount): amount is number => amount != null)
      .reduce((sum, amount) => sum + amount, 0);
    const matrah = num(monetaryTotal?.TaxExclusiveAmount)
      ?? num(monetaryTotal?.LineExtensionAmount)
      ?? (lineMatrah || undefined);
    let kdvTutari = (taxAmounts.length ? taxAmounts.reduce((sum, amount) => sum + amount, 0) : undefined)
      ?? (lineTax || undefined);
    // PayableRoundingAmount (isteğe bağlı yuvarlama; bazı ERP'ler 0,20 gibi yazar): ödenecek tutar denklemi
    //   (matrah + KDV + diğer − tevkifat) yuvarlama DÜŞÜLMÜŞ tutarla kurulur; ham tutar toplamTutar'da kalır.
    const odenecekHam = num(monetaryTotal?.PayableAmount);
    const odenecekYuvarlamaRaw = num(monetaryTotal?.PayableRoundingAmount);
    const odenecekYuvarlama = odenecekYuvarlamaRaw != null && odenecekYuvarlamaRaw !== 0 ? round2(odenecekYuvarlamaRaw) : undefined;
    const odenecekTutar = odenecekHam != null ? round2(odenecekHam - (odenecekYuvarlama || 0)) : undefined;
    const toplamTutar = odenecekHam
      ?? num(monetaryTotal?.TaxInclusiveAmount)
      ?? ((matrah != null || kdvTutari != null) ? (matrah || 0) + (kdvTutari || 0) : undefined);

    // ── İSKONTO (kalem düzeyi) ──
    //   UBL-TR'de LineExtensionAmount = fiyat × miktar − satır iskontosu (NET) olmalı; bazı entegratörler
    //   BRÜT yazıyor (BEY2026000085720: 714,16 vs matrah 302,25). Fiyat×miktar ile doğrula: LEA brüte
    //   eşitse iskontoyu düş, nete eşitse dokunma.
    let kalemIskonto = 0;
    // UBL satır kalemleri: ad + tutar + KDV oranı (oran KDV alt-toplamından; ÖİV/telsiz satırından DEĞİL).
    let rawKalemler = lineNodes
      .map((line) => {
        const ad = String(txt(line?.Item?.Name) || txt(line?.Item?.Description) || '').trim();
        let tutar = num(line?.LineExtensionAmount);
        const lineSubs = asArray(line?.TaxTotal).flatMap((tt: any) => asArray(tt?.TaxSubtotal));
        const kdvSub = lineSubs.find((s: any) => isKdvTaxSubtotal(s)) || null;
        const oran = kdvSub ? (num(kdvSub?.TaxCategory?.Percent) ?? num(kdvSub?.Percent)) : undefined;
        const allowances = asArray(line?.AllowanceCharge);
        const satirIskonto = allowances
          .filter((a: any) => String(txt(a?.ChargeIndicator) || '').toLowerCase() === 'false')
          .map((a: any) => num(a?.Amount) || 0)
          .reduce((s: number, x: number) => s + x, 0);
        const satirEkUcret = allowances
          .filter((a: any) => String(txt(a?.ChargeIndicator) || '').toLowerCase() === 'true')
          .map((a: any) => num(a?.Amount) || 0)
          .reduce((s: number, x: number) => s + x, 0);
        if (tutar != null && (satirIskonto > 0 || satirEkUcret > 0)) {
          kalemIskonto += satirIskonto;
          const fiyat = num(line?.Price?.PriceAmount);
          const miktar = num(line?.InvoicedQuantity) ?? num(line?.CreditedQuantity);
          if (fiyat != null && miktar != null) {
            const brut = round2(fiyat * miktar);
            const net = round2(brut - satirIskonto + satirEkUcret);
            // LEA brüte eşit (net değil) → entegratör iskontoyu düşmemiş → biz düşeriz.
            if (Math.abs(tutar - brut) < 0.02 && Math.abs(tutar - net) >= 0.02) tutar = net;
          }
        }
        return ad && tutar != null ? { ad, tutar, oran: oran ?? 0 } : null;
      })
      .filter((k): k is { ad: string; tutar: number; oran: number } => k !== null);
    // ── İSKONTO (belge düzeyi) ── kök AllowanceCharge(false) / AllowanceTotalAmount → kalemlere oransal dağıt.
    const belgeIskontoNodes = asArray(get(['AllowanceCharge']))
      .filter((a: any) => String(txt(a?.ChargeIndicator) || '').toLowerCase() === 'false')
      .map((a: any) => num(a?.Amount) || 0)
      .reduce((s: number, x: number) => s + x, 0);
    const belgeIskonto = round2(belgeIskontoNodes > 0 ? belgeIskontoNodes : (num(monetaryTotal?.AllowanceTotalAmount) || 0));
    if (belgeIskonto > 0 && matrah != null && rawKalemler.length) {
      const kalemSum = rawKalemler.reduce((s, k) => s + k.tutar, 0);
      // Kalemler matrahtan iskonto kadar fazlaysa (brüt) dağıt; zaten nete eşitse dokunma.
      if (Math.abs(kalemSum - belgeIskonto - matrah) < Math.max(0.05, matrah * 0.001)) {
        rawKalemler = distributeDocumentDiscount(rawKalemler, matrah);
      }
    }
    const iskontoToplam = round2(kalemIskonto + belgeIskonto);

    // ── KDV KIRILIMI + KDV DIŞI VERGİLER ──
    //   Her TaxSubtotal = bir vergi türü + oran. Yalnız 0015/KDV kırılıma girer; gerisi digerVergiler'e
    //   AYRI yazılır (matraha EKLENMEZ; hesap satırında 'diger_vergi' grubu olarak gidere gider).
    const taxSubs = taxTotals.flatMap((tt) => asArray(tt?.TaxSubtotal));
    const digerVergiler: Array<{ kod: string; ad: string; tutar: number; oran?: number }> = [];
    const subMap = new Map<number, { base: number; amount: number }>();
    for (const sub of taxSubs) {
      if (!isKdvTaxSubtotal(sub)) {
        const scheme: any = sub?.TaxCategory?.TaxScheme || sub?.TaxScheme || null;
        const kod = normalizeTaxTypeCode(scheme?.TaxTypeCode) || '????';
        const adUbl = String(txt(scheme?.Name) || '').trim();
        const tutar = round2(num(sub?.TaxAmount) || 0);
        const oran = num(sub?.TaxCategory?.Percent) ?? num(sub?.Percent);
        if (tutar > 0) digerVergiler.push({ kod, ad: adUbl || KDV_DISI_VERGI_ADLARI[kod] || `Diğer vergi (${kod})`, tutar, ...(oran != null ? { oran } : {}) });
        continue;
      }
      const r = num(sub?.TaxCategory?.Percent) ?? num(sub?.Percent);
      if (r == null) continue;
      const key = Math.round(r);
      const cur = subMap.get(key) || { base: 0, amount: 0 };
      const b = num(sub?.TaxableAmount); const a = num(sub?.TaxAmount);
      if (b != null) cur.base += b;
      if (a != null) cur.amount += a;
      subMap.set(key, cur);
    }
    const digerVergiToplam = round2(digerVergiler.reduce((s, d) => s + d.tutar, 0));
    let kdvBreakdown = [...subMap.entries()]
      .filter(([, v]) => v.base > 0 || v.amount > 0)
      .map(([rate, v]) => ({ rate, base: round2(v.base), amount: round2(v.amount) }));
    // Belge TaxSubtotal tek-oran döndü ama KALEMLERDE birden çok oran var → kalemleri oran-bazlı topla.
    const kalemRates = new Set(rawKalemler.map((k) => Math.round(Number(k.oran) || 0)).filter((r) => r > 0));
    if (kdvBreakdown.length < 2 && kalemRates.size >= 2) {
      const km = new Map<number, number>();
      for (const k of rawKalemler) { const r = Math.round(Number(k.oran) || 0); if (r <= 0) continue; km.set(r, (km.get(r) || 0) + (Number(k.tutar) || 0)); }
      kdvBreakdown = [...km.entries()].map(([rate, base]) => ({ rate, base: round2(base), amount: round2(base * rate / 100) }));
    }
    // KDV-dışı vergi varsa: KDV tutarı YALNIZ KDV kırılımından (TaxTotal/TaxAmount ÖİV'i de içerir).
    if (digerVergiToplam > 0) {
      const kdvOnly = [...subMap.values()].reduce((s, v) => s + v.amount, 0);
      kdvTutari = kdvOnly > 0 ? round2(kdvOnly) : (kdvTutari != null ? Math.max(0, round2(kdvTutari - digerVergiToplam)) : undefined);
    }
    // Tevkifat bloğu var ama ÖDENECEK tutar KDV dahil toplama eşit (tevkifat düşülmemiş) → satıcı uygulamamış:
    //   tevkifat fişi KURULMAZ (aksi halde belge toplamı ödenecekle tutmaz, 'Tutar tutarsız' engeli çıkar); bilgi bayrağı döner.
    const taxInclusiveRaw = num(monetaryTotal?.TaxInclusiveAmount);
    let tevkifatUygulanmamis: { kod?: string; yuzde?: number; beyanEdilen: number } | undefined;
    if (tevkifatKdvSum > 0 && odenecekHam != null && taxInclusiveRaw != null && Math.abs(odenecekHam - taxInclusiveRaw) <= 0.05) {
      tevkifatUygulanmamis = { ...(tevkifatKodu ? { kod: tevkifatKodu } : {}), ...(tevkifatYuzde != null ? { yuzde: tevkifatYuzde } : {}), beyanEdilen: round2(tevkifatKdvSum) };
      tevkifatKdvSum = 0;
    }
    // TEVKİFAT KDV'yi kdvTutari'ye KATMA (gevşek TaxTotal eşleşmesi WithholdingTaxTotal'ı kapsayabilir).
    if (tevkifatKdvSum > 0 && kdvTutari != null) {
      const bdSum = kdvBreakdown.reduce((s, b) => s + b.amount, 0);
      kdvTutari = bdSum > 0 ? round2(bdSum) : Math.max(0, round2(kdvTutari - tevkifatKdvSum));
    }
    const tevkifatKdv = tevkifatKdvSum > 0 ? round2(tevkifatKdvSum) : undefined;
    const stopajTutari = stopajSum > 0 ? round2(stopajSum) : undefined;
    const tevkifatOrani = tevkifatKdv ? resolveTevkifatOrani(kdvTutari, tevkifatKdv, tevkifatYuzde) : undefined;

    // ── İADE / İPTAL / TASLAK ──
    //   Karar KAYNAKLARI: CreditNote kökü (e-SMM hariç), InvoiceTypeCode IADE/TEVKIFATIADE/IPTAL,
    //   ProfileID/ID TASLAK. Serbest metin <cbc:Note> karar VERMEZ: normal satış faturalarının standart
    //   notlarında "iade faturası düzenlenmesi halinde…" / "iptal faturası düzenlenemez" geçer ve sağlam
    //   belgeyi INVALID'e düşürüyordu. Yalnız InvoiceTypeCode BOŞKEN, olumlu bildirim kalıbı
    //   ("İADE FATURASIDIR") ve olumsuz bağlam ("düzenlenemez", "halinde", "durumunda", "edilemez")
    //   YOKKEN nota bakılır. UBL-TR'de iade için InvoiceTypeCode=IADE zorunludur.
    const faturaTipi = String(txt(get(['InvoiceTypeCode'])) || txt(get(['CreditNoteTypeCode'])) || '').trim().toUpperCase() || null;
    const profileId = String(txt(get(['ProfileID'])) || '').trim().toUpperCase();
    const isCreditNote = /<(?:[\w.-]+:)?CreditNote[\s>]/i.test(xml);
    const isSmm = /SERBESTMESLEK|^SMM$/.test(profileId) || /SERBESTMESLEK|^SMM$/.test(faturaTipi || '');
    const documentType: 'E_SMM' | null = isSmm ? 'E_SMM' : null;
    const notlar = asArray(get(['Note'])).map((n: any) => String(txt(n) || '')).join(' \n ');
    const notNorm = notlar.replace(/İ/g, 'I').replace(/ı/g, 'i').toUpperCase();
    const notIadeBildirimi = !faturaTipi
      && /(^|\W)IADE\s+FATURASIDIR(\W|$)/.test(notNorm)
      && !/DUZENLENEMEZ|DÜZENLENEMEZ|HALINDE|DURUMUNDA|EDILEMEZ|YAPILAMAZ/.test(notNorm);
    const iade = (isCreditNote && !isSmm)
      || /^(IADE|TEVKIFATIADE)$/.test(faturaTipi || '')
      || notIadeBildirimi;
    const belgeDurumu: 'onayli' | 'iptal' | 'taslak' =
      faturaTipi === 'IPTAL' ? 'iptal'
        : /TASLAK|DRAFT/.test(profileId) || /^TASLAK/i.test(faturaNo) ? 'taslak'
          : 'onayli';

    // ── DÖVİZ + KUR ──
    const currencyCode = String(txt(get(['DocumentCurrencyCode'])) || 'TRY').trim().toUpperCase();
    const paraBirimi = currencyCode === 'TRY' || currencyCode === 'TRL' || currencyCode === 'TL' ? 'TL' : currencyCode;
    const kurRaw = num(get(['PricingExchangeRate', 'CalculationRate']));
    const kur = kurRaw != null && kurRaw > 0 && paraBirimi !== 'TL' ? kurRaw : undefined;

    // ŞAHIS taraf: ünvan PartyName/PartyLegalEntity'de değil <cac:Person> (Ad+Soyad) altında.
    const kisiAdi = (party: any): string | null => {
      const p = party?.Person;
      if (!p) return null;
      const parcalar = [txt(p.Title), txt(p.FirstName), txt(p.MiddleName), txt(p.FamilyName)].filter((x: any) => x && String(x).trim());
      return parcalar.length ? parcalar.join(' ').replace(/\s+/g, ' ').trim() : null;
    };
    return {
      faturaNo: faturaNo || ettn || 'BILINMIYOR',
      faturaTarihi: issueDate && !Number.isNaN(issueDate.getTime()) ? issueDate : null,
      ettn,
      satici: txt(supplier?.PartyName?.Name) || txt(supplier?.PartyLegalEntity?.RegistrationName) || kisiAdi(supplier) || null,
      saticiVergiNo: taxNoFromParty(supplier) || taxNoFromXmlBlock('AccountingSupplierParty') || null,
      alici: txt(customer?.PartyName?.Name) || txt(customer?.PartyLegalEntity?.RegistrationName) || kisiAdi(customer) || null,
      aliciVergiNo: taxNoFromParty(customer) || taxNoFromXmlBlock('AccountingCustomerParty') || null,
      matrah,
      kdvTutari,
      // kdvOrani: tek oranlı belgede o oran; ÇOK ORANLI (%1+%20) belgede null (harman "%14" gibi sahte oran
      //   yazılmaz — reprocess 'kdv-oran-gecersiz' adayı üretmesin); kırılım yoksa tutar oranı (yedek).
      kdvOrani: kdvBreakdown.length === 1 ? kdvBreakdown[0].rate
        : kdvBreakdown.length >= 2 ? null
          : (matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : null),
      kdvBreakdown: kdvBreakdown.length ? kdvBreakdown : undefined,
      tevkifatKdv,
      ...(tevkifatKodu ? { tevkifatKodu } : {}),
      ...(tevkifatYuzde != null ? { tevkifatYuzde } : {}),
      ...(tevkifatOrani != null ? { tevkifatOrani } : {}),
      ...(tevkifatUygulanmamis ? { tevkifatUygulanmamis } : {}),
      ...(stopajTutari != null ? { stopajTutari } : {}),
      ...(documentType ? { documentType } : {}),
      iade,
      faturaTipi,
      belgeDurumu,
      ...(digerVergiler.length ? { digerVergiler, digerVergiToplam } : {}),
      ...(iskontoToplam > 0 ? { iskonto: { kalem: round2(kalemIskonto), belge: belgeIskonto, toplam: iskontoToplam } } : {}),
      toplamTutar,
      ...(odenecekTutar != null ? { odenecekTutar } : {}),
      ...(odenecekYuvarlama != null ? { odenecekYuvarlama } : {}),
      paraBirimi,
      ...(kur != null ? { kur } : {}),
      kalemler: rawKalemler.length ? rawKalemler : undefined,
    };
  } catch (e: any) {
    if (warn) warn(`Provider XML parse hata: ${e?.message || e}`);
    return null;
  }
}

/**
 * Ayrıştırma sonucunu ocrData'ya yazılacak ORTAK alanlara çevirir (Aktar yolu ve "AI ile oku" yolu
 * AYNI adları kullanır: tevkifatOrani / tevkifatKdv / tevkifatHint / tevkifatKodu / tevkifatYuzde /
 * isReturn / belgeDurumu / digerVergiler / digerVergiToplam / iskonto / paraBirimi / kur / odenecekTutar).
 * Tüketiciler: revalidateDocument (kdvTevkifat|tevkifatOrani, isReturn), rematch (tevkifatHint|tevkifatOrani,
 * tevkifatKdv/kdvTutari), işletme tür türetimi (isReturn, tevkifatHint|tevkifatOrani), runValidation
 * (odenecekTutar, digerVergiToplam, tevkifatKdv).
 */
export function ublOcrDataFields(p: ParsedProviderInvoice | null | undefined): Record<string, any> {
  if (!p) return {};
  const tevkKdv = Number(p.tevkifatKdv) || 0;
  const tevkOran = Number(p.tevkifatOrani) || 0;
  return {
    // 2 = tam UBL ayrıştırıcı (tevkifat kodu/diğer vergi/iade okundu); 1 = regex yedeği (yalnız temel alanlar).
    parserVersion: p.belgeDurumu ? 2 : 1,
    tevkifatKdv: tevkKdv,
    tevkifatOrani: tevkOran,
    tevkifatHint: tevkKdv > 0 || tevkOran > 0 || /^TEVKIFAT/i.test(String(p.faturaTipi || '')),
    ...(p.tevkifatKodu ? { tevkifatKodu: String(p.tevkifatKodu) } : {}),
    ...(p.tevkifatYuzde != null ? { tevkifatYuzde: p.tevkifatYuzde } : {}),
    // Tevkifat bloğu var ama ödenecekten düşülmemiş (satıcı uygulamamış) — uyarı katmanı TEVKIFAT_UYGULANMAMIS üretir; fiş normal kurulur.
    ...(p.tevkifatUygulanmamis ? { tevkifatUygulanmamis: p.tevkifatUygulanmamis } : {}),
    // SMM stopajı (UBL 0003/0011) — KDV tevkifatından AYRI; linesFromAmounts 'kesinti' 360 satırını bundan kurar.
    ...(Number(p.stopajTutari) > 0 ? { stopajTutari: Number(p.stopajTutari) } : {}),
    isReturn: p.iade === true,
    ...(p.faturaTipi ? { faturaTipi: p.faturaTipi } : {}),
    belgeDurumu: p.belgeDurumu || 'onayli',
    ...(Array.isArray(p.digerVergiler) && p.digerVergiler.length ? { digerVergiler: p.digerVergiler, digerVergiToplam: p.digerVergiToplam || 0 } : { digerVergiToplam: 0 }),
    ...(p.iskonto ? { iskonto: p.iskonto } : {}),
    paraBirimi: p.paraBirimi || 'TL',
    ...(p.kur != null ? { kur: p.kur } : {}),
    ...(p.odenecekTutar != null ? { odenecekTutar: p.odenecekTutar } : {}),
    ...(p.odenecekYuvarlama != null ? { odenecekYuvarlama: p.odenecekYuvarlama } : {}),
  };
}

/**
 * Aktar / AI-oku yolu UBL DIŞI bir okumaya düştüğünde (HTML/PDF/görsel; provider XML bulunamadı) eski
 * ocrData'da UBL'den kalmış alanlar BAYAT kalmasın diye açıkça sıfırlanacak anahtarlar. Yeni denklemler
 * (TOTAL_MISMATCH_UBL / AMOUNT_EQUATION_MISMATCH / DOCUMENT_CANCELLED) bu alanları okur; bayat kalırsa
 * temizlenemeyen sahte hata üretir (aynı kalıp 'uyarilar' için daha önce yaşanmıştı).
 */
export const UBL_ONLY_OCR_FIELDS = [
  'odenecekTutar', 'odenecekYuvarlama', 'digerVergiToplam', 'digerVergiler', 'belgeDurumu', 'parserVersion',
  'tevkifatKodu', 'tevkifatYuzde', 'tevkifatUygulanmamis', 'iskonto', 'kur', 'faturaTipi',
] as const;

/** Spread ile ocrData'ya yazılır: `{ ...eski, ...clearUblOnlyOcrFields(), ...yeni }` → bayat UBL alanı kalmaz. */
export function clearUblOnlyOcrFields(): Record<string, undefined> {
  const out: Record<string, undefined> = {};
  for (const k of UBL_ONLY_OCR_FIELDS) out[k] = undefined;
  return out;
}

/**
 * Tevkifat oranı (0..1) — UBL yüzdesi YALNIZ tutarla tutarlıysa kullanılır:
 *   |kdvTutari × yüzde/100 − tevkifatKdv| ≤ 0,05 → yüzde/100; değilse tevkifatKdv / kdvTutari.
 * Kısmi tevkifatlı fatura (nakliye 2/10 + tevkifatsız ambalaj): yüzde 20 ama tutar 400/2200 → 0,182.
 * Servisteki providerTevkifatOrani ve AI-oku _ublTevkOran dalları da bu kuralı kullanır.
 */
export function resolveTevkifatOrani(kdvTutari: number | null | undefined, tevkifatKdv: number | null | undefined, tevkifatYuzde?: number | null): number | undefined {
  const kdv = Number(kdvTutari) || 0;
  const tk = Number(tevkifatKdv) || 0;
  const yuzde = Number(tevkifatYuzde) || 0;
  if (!(tk > 0)) return undefined;
  if (yuzde > 0 && yuzde <= 100) {
    const beklenen = kdv * yuzde / 100;
    if (!(kdv > 0) || Math.abs(beklenen - tk) <= 0.05) return Math.round(yuzde / 100 * 1000) / 1000;
  }
  if (kdv > 0 && tk <= kdv + 0.005) return Math.min(1, Math.round(tk / kdv * 1000) / 1000);
  return undefined;
}
