/**
 * Genel Sorgulamalar — GÜNCEL DURUM (2026-09-22)
 *
 * Muzaffer Bey: "vergi borcu her gece sorgulanınca listeye her gün bir satır mı gelecek? Mantığı saçma."
 * Doğrusu: ekran, sorgu KOŞULARINI değil mükelleflerin GÜNCEL durumunu gösterir. GenelSorguSonucu tablosu
 * geçmişi saklar (her koşu ayrı satır); burası her mükellef (POS ve gelen e-Arşiv'de mükellef + ay) için EN SON
 * sonucu alır ve ekranın istediği düz satırlara açar:
 *   VERGI_BORCU     → mükellef başına 1 satır (toplam / vadesi geçmiş / gelmemiş / kalem; kalemler ayrıntıda)
 *   E_HACIZ         → bildiri başına 1 satır (bildirisi olmayan mükellef listelenmez, özetle sayılır)
 *   YOKLAMA_DENETIM → tutanak başına 1 satır (yoklama + denetim)
 *   POS             → mükellef + ay + banka/kuruluş başına 1 satır
 *   GELEN_EARSIV    → fatura başına 1 satır
 * Saf fonksiyonlar (Prisma yok) — test edilebilir.
 */

export type GuncelTur = 'VERGI_BORCU' | 'E_HACIZ' | 'YOKLAMA_DENETIM' | 'POS' | 'GELEN_EARSIV';

export interface HamSonuc {
  id: string;
  taxpayerId: string;
  taxpayer: unknown;
  tur: string;
  donem: string | null;
  sorguTarihi: Date | string;
  kaynak?: string | null;
  veri: any;
}

const sayi = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : String(d));

/** Anahtar: POS ve gelen e-Arşiv'de mükellef + ay; diğerlerinde yalnız mükellef. Liste sorguTarihi DESC gelir → ilk görülen en yeni. */
export function enSonSonuclar(tur: GuncelTur, rows: HamSonuc[]): HamSonuc[] {
  const ayBazli = tur === 'POS' || tur === 'GELEN_EARSIV';
  const gorulen = new Set<string>();
  const sonuc: HamSonuc[] = [];
  for (const r of rows) {
    const k = ayBazli ? `${r.taxpayerId}::${r.donem || ''}` : r.taxpayerId;
    if (gorulen.has(k)) continue;
    gorulen.add(k);
    sonuc.push(r);
  }
  return sonuc;
}

export interface GuncelOzet {
  /** Güncel sonucu olan mükellef sayısı */
  mukellef: number;
  /** Sonucu olup kaydı (bildiri/tutanak/POS/fatura) bulunmayan mükellef sayısı */
  bos: number;
  /** En eski / en yeni güncel sorgu zamanı */
  enEskiSorgu: string | null;
  enYeniSorgu: string | null;
}

function ozetle(sonuclar: HamSonuc[], bosMu: (r: HamSonuc) => boolean): GuncelOzet {
  const zamanlar = sonuclar.map((r) => iso(r.sorguTarihi)).sort();
  const mukellefler = new Set(sonuclar.map((r) => r.taxpayerId));
  const bosMukellefler = new Set(sonuclar.filter(bosMu).map((r) => r.taxpayerId));
  return {
    mukellef: mukellefler.size,
    bos: bosMukellefler.size,
    enEskiSorgu: zamanlar[0] ?? null,
    enYeniSorgu: zamanlar[zamanlar.length - 1] ?? null,
  };
}

/** En son sonuçları ekran satırlarına açar. Dönüş: { rows, ozet } (sayfalama çağıranda). */
export function guncelSatirlar(tur: GuncelTur, enSon: HamSonuc[]): { rows: any[]; ozet: GuncelOzet } {
  switch (tur) {
    case 'VERGI_BORCU': {
      const rows = enSon.map((r) => {
        const v = r.veri || {};
        const kalemler: any[] = Array.isArray(v.kalemler) ? v.kalemler : [];
        return {
          kind: 'borc',
          sonucId: r.id,
          taxpayerId: r.taxpayerId,
          taxpayer: r.taxpayer,
          sorguTarihi: iso(r.sorguTarihi),
          kaynak: r.kaynak ?? null,
          vadesiGecmis: sayi(v.vadesiGecmis),
          vadesiGelmemis: sayi(v.vadesiGelmemis),
          toplam: sayi(v.toplam),
          gecikmeZammi: sayi(v.gecikmeZammiToplam),
          kalemSayisi: kalemler.length,
          kalemler,
          turOzeti: Array.isArray(v.turOzeti) ? v.turOzeti : [],
          hesaplamaZamani: v.hesaplamaZamani ?? null,
        };
      });
      rows.sort((a, b) => b.toplam - a.toplam || b.vadesiGecmis - a.vadesiGecmis);
      return { rows, ozet: ozetle(enSon, (r) => sayi(r.veri?.toplam) === 0) };
    }
    case 'E_HACIZ': {
      const rows: any[] = [];
      for (const r of enSon) {
        const bildiriler: any[] = Array.isArray(r.veri?.bildiriler) ? r.veri.bildiriler : [];
        for (const b of bildiriler) {
          rows.push({
            kind: 'haciz',
            sonucId: r.id,
            taxpayerId: r.taxpayerId,
            taxpayer: r.taxpayer,
            sorguTarihi: iso(r.sorguTarihi),
            kapsam: b.kapsam === 'ARAC' ? 'ARAC' : 'BANKA',
            bildiriNo: String(b.bildiriNo || ''),
            vergiDairesi: b.vergiDairesi || null,
            vergiDairesiKodu: String(b.vergiDairesiKodu || ''),
            tutar: sayi(b.tutar),
            durum: String(b.durum || ''),
            tatbikEdildi: /TATB[İI]K ED[İI]LM[İI][ŞS]T[İI]R$/i.test(String(b.durum || '')),
            borclar: Array.isArray(b.borclar) ? b.borclar : [],
          });
        }
      }
      rows.sort((a, b) => (a.taxpayerId === b.taxpayerId ? b.tutar - a.tutar : b.sorguTarihi.localeCompare(a.sorguTarihi)));
      return { rows, ozet: ozetle(enSon, (r) => !(Array.isArray(r.veri?.bildiriler) && r.veri.bildiriler.length)) };
    }
    case 'YOKLAMA_DENETIM': {
      const rows: any[] = [];
      for (const r of enSon) {
        const yoklamalar: any[] = Array.isArray(r.veri?.yoklamalar) ? r.veri.yoklamalar : [];
        const denetimler: any[] = Array.isArray(r.veri?.denetimler) ? r.veri.denetimler : [];
        for (const y of yoklamalar) {
          rows.push({
            kind: 'yoklama',
            sonucId: r.id,
            taxpayerId: r.taxpayerId,
            taxpayer: r.taxpayer,
            sorguTarihi: iso(r.sorguTarihi),
            kayit: 'YOKLAMA',
            kod: String(y.yoklamaKodu || ''),
            vergiDairesi: String(y.vergiDairesi || ''),
            turu: String(y.yoklamaTuru || ''),
            tarih: y.tarih ?? null,
            sonuc: null,
            pdfDocumentId: y.pdfDocumentId ?? null,
            pdfVarMi: !!y.pdfVarMi,
          });
        }
        for (const d of denetimler) {
          rows.push({
            kind: 'yoklama',
            sonucId: r.id,
            taxpayerId: r.taxpayerId,
            taxpayer: r.taxpayer,
            sorguTarihi: iso(r.sorguTarihi),
            kayit: 'DENETIM',
            kod: String(d.belgeKodu || ''),
            vergiDairesi: '',
            turu: String(d.denetimAdi || d.denetimTuru || ''),
            tarih: d.tarih ?? null,
            sonuc: d.sonuc ?? null,
            pdfDocumentId: null,
            pdfVarMi: false,
          });
        }
      }
      rows.sort((a, b) => String(b.tarih || '').localeCompare(String(a.tarih || '')));
      return { rows, ozet: ozetle(enSon, (r) => !((r.veri?.yoklamalar?.length ?? 0) + (r.veri?.denetimler?.length ?? 0))) };
    }
    case 'POS': {
      const rows: any[] = [];
      for (const r of enSon) {
        const satirlar: any[] = Array.isArray(r.veri?.satirlar) ? r.veri.satirlar : [];
        for (const p of satirlar) {
          rows.push({
            kind: 'pos',
            sonucId: r.id,
            taxpayerId: r.taxpayerId,
            taxpayer: r.taxpayer,
            sorguTarihi: iso(r.sorguTarihi),
            donem: r.donem,
            kaynak: p.kaynak === 'ODEME_KURULUSU' ? 'ODEME_KURULUSU' : 'BANKA',
            unvan: String(p.unvan || '').trim(),
            vkn: String(p.vkn || ''),
            uyeIsyeriNo: String(p.uyeIsyeriNo || ''),
            tutar: sayi(p.tutar),
            donemToplami: sayi(r.veri?.toplamTutar),
          });
        }
      }
      rows.sort((a, b) => String(b.donem || '').localeCompare(String(a.donem || '')) || b.tutar - a.tutar);
      return { rows, ozet: ozetle(enSon, (r) => !(Array.isArray(r.veri?.satirlar) && r.veri.satirlar.length)) };
    }
    case 'GELEN_EARSIV': {
      const rows: any[] = [];
      for (const r of enSon) {
        const faturalar: any[] = Array.isArray(r.veri?.faturalar) ? r.veri.faturalar : [];
        for (const f of faturalar) {
          rows.push({
            kind: 'fatura',
            sonucId: r.id,
            taxpayerId: r.taxpayerId,
            taxpayer: r.taxpayer,
            sorguTarihi: iso(r.sorguTarihi),
            donem: r.donem,
            faturaNo: String(f.faturaNo || ''),
            duzenlenmeTarihi: f.duzenlenmeTarihi ?? null,
            saticiUnvan: String(f.saticiUnvan || '').trim(),
            saticiVkn: String(f.saticiVkn || ''),
            gonderimSekli: String(f.gonderimSekli || ''),
            toplamTutar: sayi(f.toplamTutar),
            vergilerTutari: sayi(f.vergilerTutari),
            odenecekTutar: sayi(f.odenecekTutar),
            iptalItirazDurum: f.iptalItirazDurum ?? null,
          });
        }
      }
      rows.sort((a, b) => String(b.duzenlenmeTarihi || '').localeCompare(String(a.duzenlenmeTarihi || '')));
      return { rows, ozet: ozetle(enSon, (r) => !(Array.isArray(r.veri?.faturalar) && r.veri.faturalar.length)) };
    }
  }
}
