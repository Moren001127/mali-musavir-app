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

/** e-Haciz durum metni "… TATBİK EDİLMİŞTİR" ile bitiyorsa haciz fiilen tatbik edilmiştir (tek kural, iki yerde kullanılır). */
const TATBIK_DESENI = /TATB[İI]K ED[İI]LM[İI][ŞS]T[İI]R$/i;

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
            tatbikEdildi: TATBIK_DESENI.test(String(b.durum || '')),
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

/* ────────────────────────────────────────────────────────────────────────────────
 * MÜKELLEF PANOSU (2026-09-25)
 * Güncel durum ekranı tek TÜRÜ derinlemesine gösterir; pano ise MÜKELLEF başına tek satır verir:
 * 5 türün en son sonucu yan yana + tek bir uyarı seviyesi. "Hiç sorgulanmadı" ile "sorgulandı, temiz
 * çıktı" ayrı şeylerdir: sonuç varsa alan nesnesi (sayılar 0 olsa bile) döner, sonuç yoksa null.
 * ──────────────────────────────────────────────────────────────────────────────── */

export interface PanoMukellefi {
  id: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  taxNumber: string | null;
}

export interface PanoSatiri {
  taxpayerId: string;
  taxpayer: PanoMukellefi | null;
  /** 5 türün en yeni sorgu zamanı; hiç sorgu yoksa null (ISO) */
  sonSorgu: string | null;
  /** Bu mükellefte hiç sonucu olmayan tür sayısı (0-5); dönem süzgeci varsa o aya sonucu olmayan POS/e-Arşiv de sayılır */
  sorgulanmayan: number;
  borc: { toplam: number; vadesiGecmis: number; vadesiGelmemis: number; kalemSayisi: number; sorguTarihi: string } | null;
  haciz: { bildiri: number; tatbik: number; tutar: number; sorguTarihi: string } | null;
  yoklama: { tutanak: number; sonTarih: string | null; sorguTarihi: string } | null;
  pos: { tutar: number; satir: number; donem: string | null; sorguTarihi: string } | null;
  earsiv: { fatura: number; tutar: number; donem: string | null; sorguTarihi: string } | null;
  /** 2 = vadesi geçmiş borç VEYA tatbik edilmiş haciz · 1 = borç var (vadesi gelmemiş) veya haciz bildirisi var · 0 = sakin */
  uyari: 0 | 1 | 2;
}

export interface PanoOzeti {
  mukellef: number;
  borclu: number;
  hacizli: number;
  toplamBorc: number;
  vadesiGecmis: number;
  enYeniSorgu: string | null;
}

export interface PanoYaniti {
  rows: PanoSatiri[];
  total: number;
  page: number;
  pageSize: number;
  ozet: PanoOzeti;
}

/** Kuruş yuvarlama — toplama yapılan yerlerde kayan nokta artığını temizler. */
const p2 = (n: number): number => Math.round(n * 100) / 100;

/** Sıralamada kullanılan mükellef adı (unvan yoksa ad soyad, o da yoksa VKN). */
const mukellefAdi = (t: PanoMukellefi | null): string =>
  String(t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.taxNumber || '').trim();

/**
 * POS / gelen e-Arşiv ay bazlıdır (her ay ayrı sonuç kaydı).
 *   dönem süzgeci VARSA → yalnız o ay,
 *   dönem süzgeci YOKSA → mükellefin EN SON ayı (aylar TOPLANMAZ; 07 + 08 birleştirilmez).
 */
function ayaGoreSec(rows: HamSonuc[], donem?: string): Map<string, HamSonuc[]> {
  const secim = new Map<string, HamSonuc[]>();
  for (const r of rows) {
    const ay = String(r.donem || '');
    if (donem && ay !== donem) continue;
    const onceki = secim.get(r.taxpayerId);
    if (!onceki) {
      secim.set(r.taxpayerId, [r]);
      continue;
    }
    const secilenAy = String(onceki[0].donem || '');
    if (donem || ay === secilenAy) onceki.push(r);
    else if (ay > secilenAy) secim.set(r.taxpayerId, [r]);
  }
  return secim;
}

/**
 * Mükellef panosu satırları — SAF fonksiyon (Prisma yok, test edilebilir).
 * `turBazliEnSon`: tür başına `enSonSonuclar()` süzgecinden geçmiş kayıtlar.
 * `donem` ("YYYY-MM") yalnız POS ve GELEN_EARSIV'i daraltır; diğer türlerde yok sayılır.
 * Hiç sonucu olmayan mükellef listeye GİRMEZ. Sayfalama çağırandadır.
 */
export function panoSatirlari(
  turBazliEnSon: Partial<Record<GuncelTur, HamSonuc[]>>,
  donem?: string,
): { rows: PanoSatiri[]; ozet: PanoOzeti } {
  const satirlar = new Map<string, PanoSatiri>();
  const al = (r: HamSonuc): PanoSatiri => {
    let s = satirlar.get(r.taxpayerId);
    if (!s) {
      s = {
        taxpayerId: r.taxpayerId,
        taxpayer: (r.taxpayer as PanoMukellefi) ?? null,
        sonSorgu: null,
        sorgulanmayan: 5,
        borc: null,
        haciz: null,
        yoklama: null,
        pos: null,
        earsiv: null,
        uyari: 0,
      };
      satirlar.set(r.taxpayerId, s);
    }
    if (!s.taxpayer && r.taxpayer) s.taxpayer = r.taxpayer as PanoMukellefi;
    return s;
  };

  for (const r of turBazliEnSon.VERGI_BORCU ?? []) {
    const v = r.veri || {};
    al(r).borc = {
      toplam: sayi(v.toplam),
      vadesiGecmis: sayi(v.vadesiGecmis),
      vadesiGelmemis: sayi(v.vadesiGelmemis),
      kalemSayisi: Array.isArray(v.kalemler) ? v.kalemler.length : sayi(v.kalemSayisi),
      sorguTarihi: iso(r.sorguTarihi),
    };
  }

  for (const r of turBazliEnSon.E_HACIZ ?? []) {
    const bildiriler: any[] = Array.isArray(r.veri?.bildiriler) ? r.veri.bildiriler : [];
    al(r).haciz = {
      bildiri: bildiriler.length,
      tatbik: bildiriler.filter((b) => TATBIK_DESENI.test(String(b?.durum || ''))).length,
      tutar: p2(bildiriler.reduce((t, b) => t + sayi(b?.tutar), 0)),
      sorguTarihi: iso(r.sorguTarihi),
    };
  }

  for (const r of turBazliEnSon.YOKLAMA_DENETIM ?? []) {
    const yoklamalar: any[] = Array.isArray(r.veri?.yoklamalar) ? r.veri.yoklamalar : [];
    const denetimler: any[] = Array.isArray(r.veri?.denetimler) ? r.veri.denetimler : [];
    const tarihler = [...yoklamalar, ...denetimler].map((x) => String(x?.tarih || '')).filter(Boolean).sort();
    al(r).yoklama = {
      tutanak: yoklamalar.length + denetimler.length,
      sonTarih: tarihler[tarihler.length - 1] ?? null,
      sorguTarihi: iso(r.sorguTarihi),
    };
  }

  for (const secilen of ayaGoreSec(turBazliEnSon.POS ?? [], donem).values()) {
    let satir = 0;
    let tutar = 0;
    let enYeni = '';
    for (const r of secilen) {
      const l: any[] = Array.isArray(r.veri?.satirlar) ? r.veri.satirlar : [];
      satir += l.length;
      tutar += l.reduce((t, p) => t + sayi(p?.tutar), 0);
      const z = iso(r.sorguTarihi);
      if (z > enYeni) enYeni = z;
    }
    al(secilen[0]).pos = { tutar: p2(tutar), satir, donem: secilen[0].donem ?? null, sorguTarihi: enYeni };
  }

  for (const secilen of ayaGoreSec(turBazliEnSon.GELEN_EARSIV ?? [], donem).values()) {
    let fatura = 0;
    let tutar = 0;
    let enYeni = '';
    for (const r of secilen) {
      const l: any[] = Array.isArray(r.veri?.faturalar) ? r.veri.faturalar : [];
      fatura += l.length;
      tutar += l.reduce((t, f) => t + sayi(f?.odenecekTutar), 0);
      const z = iso(r.sorguTarihi);
      if (z > enYeni) enYeni = z;
    }
    al(secilen[0]).earsiv = { fatura, tutar: p2(tutar), donem: secilen[0].donem ?? null, sorguTarihi: enYeni };
  }

  const rows = [...satirlar.values()];
  for (const s of rows) {
    const dolular = [s.borc, s.haciz, s.yoklama, s.pos, s.earsiv].filter(Boolean) as Array<{ sorguTarihi: string }>;
    s.sorgulanmayan = 5 - dolular.length;
    s.sonSorgu = dolular.map((d) => d.sorguTarihi).sort().pop() ?? null;
    if ((s.borc?.vadesiGecmis ?? 0) > 0 || (s.haciz?.tatbik ?? 0) > 0) s.uyari = 2;
    else if ((s.borc?.toplam ?? 0) > 0 || (s.haciz?.bildiri ?? 0) > 0) s.uyari = 1;
    else s.uyari = 0;
  }
  rows.sort(
    (a, b) =>
      b.uyari - a.uyari ||
      (b.borc?.vadesiGecmis ?? 0) - (a.borc?.vadesiGecmis ?? 0) ||
      (b.borc?.toplam ?? 0) - (a.borc?.toplam ?? 0) ||
      mukellefAdi(a.taxpayer).localeCompare(mukellefAdi(b.taxpayer), 'tr-TR'),
  );

  const zamanlar = (rows.map((r) => r.sonSorgu).filter(Boolean) as string[]).sort();
  return {
    rows,
    ozet: {
      mukellef: rows.length,
      borclu: rows.filter((r) => (r.borc?.toplam ?? 0) > 0).length,
      hacizli: rows.filter((r) => (r.haciz?.bildiri ?? 0) > 0).length,
      toplamBorc: p2(rows.reduce((t, r) => t + (r.borc?.toplam ?? 0), 0)),
      vadesiGecmis: p2(rows.reduce((t, r) => t + (r.borc?.vadesiGecmis ?? 0), 0)),
      enYeniSorgu: zamanlar[zamanlar.length - 1] ?? null,
    },
  };
}
