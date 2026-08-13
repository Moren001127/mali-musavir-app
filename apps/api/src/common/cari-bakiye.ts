/**
 * CARI BAKIYE — TEK KAYNAK.
 *
 * Ayni hesap uc ayri yerde birbirinden FARKLI yapiliyordu ve canli dokumde owner'a
 * ayni gun sabah/aksam FARKLI toplam gidiyordu (13 gun boyunca):
 *   - tool-executor getOperationBriefing : pasif mukellefi ELIYOR,  IADE = +
 *   - tool-executor getCollectionRiskSummary : pasifi ELEMIYOR,     IADE = yok sayiliyor
 *   - moren-ai getPortalSnapshot        : pasifi ELEMIYOR,          IADE = +
 * Ayrica IADE isareti Cari Kasa modulu (cari-kasa.controller.ts:371, service:781) ve
 * mukellefe giden hizli-yol (monthly-status.shared.ts:883) ile TERSTI: onlar IADE'yi
 * bakiyeden DUSUYOR. Yani owner'a gosterilen toplam, Cari Kasa ekraniyla uyusmuyordu.
 *
 * Tek dogru tanim (Cari Kasa modulu esas alindi):
 *   TAHAKKUK = +   (mukellefin borcu artar)
 *   TAHSILAT = −   (odeme, borc azalir)
 *   IADE     = −   (iade, borc azalir)
 *   digerleri sayilmaz
 */

export type CariHareketSatiri = {
  taxpayerId: string;
  tip: string;
  tutar: any;
  tarih?: Date | string | null;
};

export type CariBakiyeKaydi = {
  taxpayerId: string;
  bakiye: number;
  sonTahsilat: Date | null;
};

function sayiyaCevir(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Hareket isaretinin TEK tanimi. */
export function cariIsaret(tip: string): number {
  if (tip === 'TAHAKKUK') return 1;
  if (tip === 'TAHSILAT') return -1;
  if (tip === 'IADE') return -1;
  return 0;
}

/**
 * Mukellef bazinda bakiye. aktifIds verilirse yalniz o mukellefler sayilir
 * (pasif/kapanmis mukellef borclusu sayilmasin diye).
 */
export function hesaplaCariBakiyeler(
  hareketler: CariHareketSatiri[] | null | undefined,
  aktifIds?: Set<string> | null,
): Map<string, CariBakiyeKaydi> {
  const sonuc = new Map<string, CariBakiyeKaydi>();
  for (const h of hareketler || []) {
    if (!h?.taxpayerId) continue;
    if (aktifIds && !aktifIds.has(h.taxpayerId)) continue;
    const kayit = sonuc.get(h.taxpayerId) || { taxpayerId: h.taxpayerId, bakiye: 0, sonTahsilat: null };
    kayit.bakiye += cariIsaret(h.tip) * sayiyaCevir(h.tutar);
    if (h.tip === 'TAHSILAT' && h.tarih) {
      const t = new Date(h.tarih as any);
      if (!Number.isNaN(t.getTime()) && (!kayit.sonTahsilat || t > kayit.sonTahsilat)) kayit.sonTahsilat = t;
    }
    sonuc.set(h.taxpayerId, kayit);
  }
  return sonuc;
}

/** Borclu listesi + toplam. Sayilar buradan gelir; MODELE saydirilmaz. */
export function borcluOzeti(bakiyeler: Map<string, CariBakiyeKaydi>) {
  const borclular = [...bakiyeler.values()]
    .filter((b) => b.bakiye > 0)
    .sort((a, b) => b.bakiye - a.bakiye);
  return {
    borcluSayisi: borclular.length,
    toplamBakiye: borclular.reduce((s, b) => s + b.bakiye, 0),
    borclular,
  };
}
