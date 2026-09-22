/**
 * CARİ DEFTERİ — VKN/TCKN → ünvan + vergi dairesi + adres.
 *
 * NEDEN: Fatura işlenirken VKN yazılınca cari bilgileri kendiliğinden dolsun (Mihsap'ta olduğu gibi).
 * Mihsap bunu TÜRMOB KPS anahtarıyla yapıyor ama o anahtar **günde 10 istekle** sınırlı — tek başına
 * işe yaramaz. Bizim asıl kaynağımız KENDİ ARŞİVİMİZ: elimizde 3.300'den fazla e-Fatura/e-Arşiv UBL
 * XML'i var ve her birinde karşı tarafın vergi dairesi ve adresi yazılı. TÜRMOB yalnız defterde
 * olmayan VKN için son çare olarak kullanılır.
 *
 * Bu dosya SAF ayrıştırma yapar (DB/HTTP yok) → test edilebilir.
 */

export type CariBilgi = {
  kimlikNo: string;
  unvan: string;
  vergiDairesi: string;
  adres: string;
};

/** XML'den ilk eşleşen etiketin metni. */
function etiket(xml: string, ad: string): string {
  const m = xml.match(new RegExp(`<(?:[a-zA-Z][\\w.-]*:)?${ad}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w.-]*:)?${ad}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** UBL'de bir taraf bloğu (AccountingSupplierParty / AccountingCustomerParty) çıkarılır. */
function tarafBlogu(xml: string, ad: 'AccountingSupplierParty' | 'AccountingCustomerParty'): string {
  const m = xml.match(new RegExp(`<(?:[a-zA-Z][\\w.-]*:)?${ad}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w.-]*:)?${ad}>`, 'i'));
  return m ? m[1] : '';
}

/** Blok içindeki VKN/TCKN: PartyIdentification > ID (schemeID VKN/TCKN) ya da TaxScheme'in yanındaki ID. */
function kimlikNoBul(blok: string): string {
  // schemeID="VKN" / "TCKN" öncelikli
  const hepsi = [...blok.matchAll(/<(?:[a-zA-Z][\w.-]*:)?ID\b([^>]*)>([^<]*)</gi)];
  for (const m of hepsi) {
    const oznitelik = String(m[1] || '');
    const deger = String(m[2] || '').replace(/\D/g, '');
    if (/VKN|TCKN/i.test(oznitelik) && (deger.length === 10 || deger.length === 11)) return deger;
  }
  // öznitelik yoksa: 10/11 haneli ilk sayı
  for (const m of hepsi) {
    const deger = String(m[2] || '').replace(/\D/g, '');
    if (deger.length === 10 || deger.length === 11) return deger;
  }
  return '';
}

/** Bir taraf bloğundan cari bilgisi. */
export function tarafCarisi(blok: string): CariBilgi | null {
  if (!blok) return null;
  const kimlikNo = kimlikNoBul(blok);
  if (!kimlikNo) return null;

  const unvan = etiket(blok, 'PartyName') || etiket(blok, 'RegistrationName') || '';
  // Vergi dairesi: <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>…
  const vergiBlok = (blok.match(/<(?:[a-zA-Z][\w.-]*:)?PartyTaxScheme\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z][\w.-]*:)?PartyTaxScheme>/i) || [])[1] || '';
  const vergiDairesi = vergiBlok ? etiket(vergiBlok, 'Name') : '';

  const adresBlok = (blok.match(/<(?:[a-zA-Z][\w.-]*:)?PostalAddress\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z][\w.-]*:)?PostalAddress>/i) || [])[1] || '';
  const adres = adresBlok
    ? [etiket(adresBlok, 'StreetName'), etiket(adresBlok, 'BuildingNumber'), etiket(adresBlok, 'CitySubdivisionName'), etiket(adresBlok, 'CityName')]
        .map((x) => x.trim())
        .filter(Boolean)
        .join(' / ')
    : '';

  return { kimlikNo, unvan: unvan.trim(), vergiDairesi: vergiDairesi.trim(), adres };
}

/** Bir UBL faturasındaki İKİ tarafı da döndürür (satıcı + alıcı). */
export function faturadanCariler(xml: string): CariBilgi[] {
  const metin = String(xml || '');
  if (!metin) return [];
  const cikti: CariBilgi[] = [];
  for (const ad of ['AccountingSupplierParty', 'AccountingCustomerParty'] as const) {
    const c = tarafCarisi(tarafBlogu(metin, ad));
    // Ünvanı VE vergi dairesi/adresi olmayan kayıt defteri kirletir — en az biri olmalı.
    if (c && c.kimlikNo && (c.unvan || c.vergiDairesi || c.adres)) cikti.push(c);
  }
  return cikti;
}

/**
 * Aynı VKN için iki kayıt birleştirilir: DOLU alan boşu ezer, yeni bilgi eskiyi günceller.
 * (Ünvan/adres zamanla değişir; en son görülen esastır.)
 */
export function cariBirlestir(eski: Partial<CariBilgi> | null, yeni: CariBilgi): CariBilgi {
  return {
    kimlikNo: yeni.kimlikNo || String(eski?.kimlikNo || ''),
    unvan: yeni.unvan || String(eski?.unvan || ''),
    vergiDairesi: yeni.vergiDairesi || String(eski?.vergiDairesi || ''),
    adres: yeni.adres || String(eski?.adres || ''),
  };
}
