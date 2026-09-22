/**
 * Dijital Vergi Dairesi (DVD) sorgu çözümleyicileri — 2026-09-22
 *
 * GİB'in HAM JSON yanıtlarını (uçlar ve örnek yanıtlar: bilgi/DVD-SORGU-UCLARI.md) packages/shared'deki
 * sonuç VERİ şekillerine (genel-sorgu-veri.ts) çevirir. Playwright'sız SAF fonksiyonlar → jest ile test edilir.
 * Kurallar: tutarlar number (TL, 2 hane), tarihler ISO ("2026-09-09" / "2026-09-09T21:58:07"), ham yanıt `ham` altında.
 *
 * Ekrandaki tek satırlık özetler de burada üretilir (ozetMetni), böylece runner ile ekran aynı metni kullanır.
 */
import type {
  DenetimTutanagi,
  EDefterBeratGirdisi,
  EHacizBildirisi,
  EHacizKapsam,
  EHacizVeri,
  GelenEArsivFaturasi,
  GelenEArsivVeri,
  GenelSorguTuru,
  GenelSorguVeri,
  PosSatiri,
  PosVeri,
  VergiBorcuKalemi,
  VergiBorcuVeri,
  YoklamaDenetimVeri,
  YoklamaTutanagi,
} from '@mali-musavir/shared';

// ───────────────────────────── Ortak yardımcılar ─────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

function yuvarla(n: number): number {
  return Math.round(n * 100) / 100;
}

function metin(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * GİB tutarı → number (2 hane). Sayı, "1448.40", "379614.21", "1.448,40" (Türk biçimi) kabul edilir; boş/bozuk → 0.
 */
export function tutarCoz(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? yuvarla(v) : 0;
  let s = String(v).trim().replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  const sonVirgul = s.lastIndexOf(',');
  const sonNokta = s.lastIndexOf('.');
  if (sonVirgul > sonNokta) {
    // Türk biçimi: 1.448,40 → binlik nokta atılır, ondalık virgül noktaya
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (sonVirgul >= 0 && sonNokta > sonVirgul) {
    // 1,448.40 → binlik virgül atılır
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? yuvarla(n) : 0;
}

/** 384303.91 → "384.303,91 ₺" (ekran özeti) */
export function tlBicimle(n: number): string {
  const sayi = Number.isFinite(n) ? n : 0;
  const isaret = sayi < 0 ? '-' : '';
  const [tam, ondalik] = Math.abs(sayi).toFixed(2).split('.');
  const binlik = tam.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${isaret}${binlik},${ondalik} ₺`;
}

/**
 * GİB tarih biçimleri → ISO. Boş → null; tanınmayan biçim olduğu gibi döner.
 *   "2026-02-28" · "2026-09-09 21:58:07" → "2026-09-09T21:58:07" · "26.09.2025 - 12:32:16" → "2025-09-26T12:32:16"
 *   "28/03/2026" → "2026-03-28" · "20260228" → "2026-02-28" · "20260914144227" → "2026-09-14T14:42:27"
 */
export function gibTarihCoz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/))) {
    return m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}` : `${m[1]}-${m[2]}-${m[3]}`;
  }
  if ((m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})(?:\s*-?\s*(\d{2}):(\d{2})(?::(\d{2}))?)?/))) {
    return m[4] ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}` : `${m[3]}-${m[2]}-${m[1]}`;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/))) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

/** ISO gün/tarih → "14.09.2026" (ekran) */
export function isoGunBicimle(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}

/** ISO gün → GİB'in istediği "DD/MM/YYYY" (e-Arşiv alıcı listesi gövdesi) */
export function isoGunuGibTarihi(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

/** Bugünün Europe/Istanbul günü "YYYY-MM-DD" (sunucu UTC olsa da). */
export function istanbulGunISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** ISO güne n gün ekler (takvim günü, saat dilimi yok). */
export function gunEkle(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** "YYYY-MM" anahtarına n ay ekler. */
export function ayEkle(ayAnahtari: string, n: number): string {
  const [y, m] = ayAnahtari.split('-').map((x) => parseInt(x, 10));
  const toplam = y * 12 + (m - 1) + n;
  return `${Math.floor(toplam / 12)}-${pad2((toplam % 12) + 1)}`;
}

/** Ayın son günü ("2026-02" → "2026-02-28"). */
export function ayinSonGunu(ayAnahtari: string): string {
  const [y, m] = ayAnahtari.split('-').map((x) => parseInt(x, 10));
  const son = new Date(Date.UTC(y, m, 0));
  return `${y}-${pad2(m)}-${pad2(son.getUTCDate())}`;
}

/** Sıralama/karşılaştırma için (ISO metinleri sözlük sırasıyla kronolojiktir). */
function enBuyukTarih(tarihler: Array<string | null | undefined>): string | null {
  let enBuyuk: string | null = null;
  for (const t of tarihler) {
    if (!t) continue;
    if (!enBuyuk || t > enBuyuk) enBuyuk = t;
  }
  return enBuyuk;
}

/** Türkçe büyük harf + aksan temizliği ("HACİZ TATBİK EDİLMİŞTİR" → "HACIZ TATBIK EDILMISTIR"); karşılaştırma için. */
export function asciiBuyuk(s: unknown): string {
  return metin(s)
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');
}

/**
 * Tarih aralığını en fazla `maxGun` günlük (uçlar dahil) pencerelere böler: GİB e-Arşiv alıcı listesi tek sorguda
 * en fazla 7 gün kabul eder. "2026-08-01".."2026-08-10" → [01–07, 08–10].
 */
export function gunPencereleri(basISO: string, bitISO: string, maxGun = 7): Array<{ baslangic: string; bitis: string }> {
  const pencereler: Array<{ baslangic: string; bitis: string }> = [];
  if (!basISO || !bitISO || basISO > bitISO) return pencereler;
  const adim = Math.max(1, Math.floor(maxGun));
  let bas = basISO;
  for (let i = 0; i < 400 && bas <= bitISO; i++) {
    const sonAday = gunEkle(bas, adim - 1);
    const bit = sonAday < bitISO ? sonAday : bitISO;
    pencereler.push({ baslangic: bas, bitis: bit });
    bas = gunEkle(bit, 1);
  }
  return pencereler;
}

// ───────────────────────────── Vergi borcu ─────────────────────────────

/**
 * POST apigateway/payment/api/debtinformation/true yanıtı → VergiBorcuVeri.
 * `bugun` (ISO gün) kalem bazında "vadesi geçmiş" işareti için; verilmezse bugünün İstanbul günü.
 * Sayfalar birleştirilmişse `ham.borclar` tüm kalemleri içermeli (runner sayfaları gezip birleştirir).
 */
export function vergiBorcuCoz(ham: any, bugun: string = istanbulGunISO()): VergiBorcuVeri {
  const kaynak = ham && typeof ham === 'object' ? ham : {};
  const borclar: any[] = Array.isArray(kaynak.borclar) ? kaynak.borclar : Array.isArray(kaynak.tumBorclar) ? kaynak.tumBorclar : [];
  const ozetBilgi: any[] = Array.isArray(kaynak.ozetBilgi) ? kaynak.ozetBilgi : [];

  const kalemler: VergiBorcuKalemi[] = borclar
    .filter((b) => b && typeof b === 'object')
    .map((b) => {
      const vade = gibTarihCoz(b.vadeTarihi);
      const vadeGun = vade ? vade.slice(0, 10) : null;
      return {
        vergiTuru: metin(b.vergiTuru),
        vergiKodu: metin(b.vergiKodu),
        donem: metin(b.donem),
        vadeTarihi: vadeGun,
        asilBorc: tutarCoz(b.asilBorc),
        gecikmeZammi: tutarCoz(b.gecikmeZammi),
        toplam: tutarCoz(b.toplam),
        vergiDairesi: metin(b.vdAdi),
        vergiDairesiKodu: metin(b.vdKodu),
        belgeNo: metin(b.belgeNo) || null,
        vadesiGecmisMi: !!vadeGun && vadeGun < bugun,
      };
    });

  const ozetTip = (tip: string) => ozetBilgi.find((o) => o && String(o.tip) === tip);
  const gecmisOzet = ozetTip('1');
  const gelmemisOzet = ozetTip('2');
  const toplamOzet = ozetTip('3');
  const topla = (liste: VergiBorcuKalemi[], alan: 'toplam' | 'gecikmeZammi' | 'asilBorc') => yuvarla(liste.reduce((s, k) => s + k[alan], 0));

  const vadesiGecmis = gecmisOzet ? tutarCoz(gecmisOzet.toplam) : topla(kalemler.filter((k) => k.vadesiGecmisMi), 'toplam');
  const vadesiGelmemis = gelmemisOzet ? tutarCoz(gelmemisOzet.toplam) : topla(kalemler.filter((k) => !k.vadesiGecmisMi), 'toplam');
  const toplam = toplamOzet ? tutarCoz(toplamOzet.toplam) : topla(kalemler, 'toplam');
  const gecikmeZammiToplam =
    toplamOzet && toplamOzet.toplamGzSum !== undefined && toplamOzet.toplamGzSum !== null
      ? tutarCoz(toplamOzet.toplamGzSum)
      : topla(kalemler, 'gecikmeZammi');

  // Vergi türü özeti: GİB'in tip 3 vergiKoduDetay'ı; yoksa kalemlerden gruplanır. Tür adı kalemlerden bulunur.
  const turAdi = new Map<string, string>();
  for (const k of kalemler) if (k.vergiKodu && k.vergiTuru && !turAdi.has(k.vergiKodu)) turAdi.set(k.vergiKodu, k.vergiTuru);
  let turOzeti: VergiBorcuVeri['turOzeti'] = [];
  const detay: any[] = Array.isArray(toplamOzet?.vergiKoduDetay) ? toplamOzet.vergiKoduDetay : [];
  if (detay.length) {
    turOzeti = detay
      .filter((d) => d && typeof d === 'object')
      .map((d) => {
        const kod = metin(d.vergiKodu);
        return {
          vergiKodu: kod,
          vergiTuru: turAdi.get(kod) || metin(d.vergiTuru) || kod,
          toplam: tutarCoz(d.toplam),
          asilBorc: tutarCoz(d.vabSum),
          gecikmeZammi: tutarCoz(d.gzSum),
        };
      });
  } else {
    const grup = new Map<string, { vergiKodu: string; vergiTuru: string; toplam: number; asilBorc: number; gecikmeZammi: number }>();
    for (const k of kalemler) {
      const g = grup.get(k.vergiKodu) || { vergiKodu: k.vergiKodu, vergiTuru: k.vergiTuru || k.vergiKodu, toplam: 0, asilBorc: 0, gecikmeZammi: 0 };
      g.toplam = yuvarla(g.toplam + k.toplam);
      g.asilBorc = yuvarla(g.asilBorc + k.asilBorc);
      g.gecikmeZammi = yuvarla(g.gecikmeZammi + k.gecikmeZammi);
      grup.set(k.vergiKodu, g);
    }
    turOzeti = Array.from(grup.values());
  }

  return {
    vadesiGecmis,
    vadesiGelmemis,
    toplam,
    gecikmeZammiToplam,
    kalemSayisi: kalemler.length,
    kalemler,
    turOzeti,
    hesaplamaZamani: gibTarihCoz(kaynak.hesaplamaZamani),
    ham: {
      borclar,
      ozetBilgi,
      ozelPlakaList: kaynak.ozelPlakaList ?? null,
      hesaplamaZamani: kaynak.hesaplamaZamani ?? null,
      pageDetail: kaynak.pageDetail ?? null,
      messages: kaynak.messages ?? null,
    },
  };
}

/** "Toplam borç 384.303,91 ₺ (vadesi geçmiş 379.614,21 ₺, 14 kalem)" | "Vergi borcu yok" */
export function vergiBorcuOzeti(v: VergiBorcuVeri): string {
  if (!v.kalemSayisi && v.toplam <= 0) return 'Vergi borcu yok';
  return `Toplam borç ${tlBicimle(v.toplam)} (vadesi geçmiş ${tlBicimle(v.vadesiGecmis)}, ${v.kalemSayisi} kalem)`;
}

// ───────────────────────────── e-Haciz ─────────────────────────────

/** İnternet Vergi Dairesi detay yanıtı (`data`): array1 = borçlar, array2 = banka/hesap satırları */
export type EHacizHamDetay = { array1?: unknown; array2?: unknown } | null | undefined;

/**
 * İnternet Vergi Dairesi e-Haciz sorgu sonucu → EHacizVeri.
 *   bankaListesi / aracListesi: dispatch(secim 1 / 2) yanıtındaki `data` dizisi ({durum,hbno,htutar,vdkod})
 *   detaylar: bildiri anahtarı → detay `data` ({array1,array2}). Anahtar "BANKA:<hbno>" / "ARAC:<hbno>" ya da yalın hbno.
 *   vergiDaireleri: vdkod → ad eşlemesi (aynı oturumdaki vergi borcu / yoklama sonuçlarından derlenir; yoksa null kalır).
 */
export function eHacizCoz(
  bankaListesi: unknown,
  aracListesi: unknown,
  detaylar: Record<string, EHacizHamDetay> = {},
  vergiDaireleri: Record<string, string> = {},
): EHacizVeri {
  const listeyiCoz = (liste: unknown, kapsam: EHacizKapsam): EHacizBildirisi[] => {
    if (!Array.isArray(liste)) return [];
    return liste
      .filter((b) => b && typeof b === 'object' && (metin(b.hbno) || metin(b.htutar)))
      .map((b) => {
        const bildiriNo = metin(b.hbno);
        const detay = detaylar[`${kapsam}:${bildiriNo}`] ?? detaylar[bildiriNo] ?? null;
        const vdkod = metin(b.vdkod);
        const array1 = Array.isArray(detay?.array1) ? (detay!.array1 as any[]) : [];
        const array2 = Array.isArray(detay?.array2) ? (detay!.array2 as any[]) : [];
        return {
          kapsam,
          bildiriNo,
          tutar: tutarCoz(b.htutar),
          durum: metin(b.durum),
          vergiDairesiKodu: vdkod,
          vergiDairesi: vergiDaireleri[vdkod] || null,
          borclar: array1
            .filter((x) => x && typeof x === 'object')
            .map((x) => ({ vergiTuru: metin(x.vergiTuru), vergiDonem: metin(x.vergiDonem) })),
          hesaplar: array2.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>,
        };
      });
  };
  const bildiriler = [...listeyiCoz(bankaListesi, 'BANKA'), ...listeyiCoz(aracListesi, 'ARAC')];
  const tatbikEdilenSayisi = bildiriler.filter((b) => hacizTatbikEdilmisMi(b.durum)).length;
  return {
    bildiriSayisi: bildiriler.length,
    tatbikEdilenSayisi,
    toplamTutar: yuvarla(bildiriler.reduce((s, b) => s + b.tutar, 0)),
    bildiriler,
    ham: { banka: Array.isArray(bankaListesi) ? bankaListesi : null, arac: Array.isArray(aracListesi) ? aracListesi : null, detaylar },
  };
}

/** "HACİZ TATBİK EDİLMİŞTİR" → true; "…TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR" → false */
export function hacizTatbikEdilmisMi(durum: string): boolean {
  const d = asciiBuyuk(durum);
  return d.includes('TATBIK EDILMISTIR') && !d.includes('BULUNAMAMISTIR');
}

/** "3 bildiri (2 tatbik edilmiş), 173.902,98 ₺" | "Haciz bildirisi yok" */
export function eHacizOzeti(v: EHacizVeri): string {
  if (!v.bildiriSayisi) return 'Haciz bildirisi yok';
  return `${v.bildiriSayisi} bildiri (${v.tatbikEdilenSayisi} tatbik edilmiş), ${tlBicimle(v.toplamTutar)}`;
}

// ───────────────────────────── Yoklama / Denetim ─────────────────────────────

/**
 * get-yoklama-list `yoklamaList` + get-denetim-list `denetimlerResponseDto` → YoklamaDenetimVeri.
 * `pdfVarOlanlar`: PDF'i portal belgesi olarak saklı/indirilmiş yoklama kodları (pdfVarMi işareti).
 * Denetim alan adları canlıda görülemedi (liste boştu); bilinen adaylar denenir, ham satır `ham`da kalır.
 */
export function yoklamaDenetimCoz(yoklamaList: unknown, denetimList: unknown, pdfVarOlanlar: Iterable<string> = []): YoklamaDenetimVeri {
  const pdfSet = new Set(Array.from(pdfVarOlanlar).map((k) => String(k)));
  const yoklamalar: YoklamaTutanagi[] = (Array.isArray(yoklamaList) ? yoklamaList : [])
    .filter((y) => y && typeof y === 'object')
    .map((y: any) => {
      const kod = metin(y.ykodu ?? y.yoklamaKodu);
      const vdText = metin(y.vdKoduText);
      const vdKod = metin(y.vdkodu ?? y.vdKodu) || ((vdText.match(/\((\d+)\)/) || [])[1] ?? '');
      return {
        yoklamaKodu: kod,
        tarih: gibTarihCoz(y.tarih ?? y.yoklamaTarihi) || '',
        vergiDairesi: vdText || vdKod,
        vergiDairesiKodu: vdKod,
        yoklamaTuru: metin(y.yoklamaTuruText ?? y.yoklamaTuru),
        yoklamaTuruKodu: metin(y.yturu ?? y.yoklamaTuruKodu),
        pdfVarMi: pdfSet.has(kod),
        pdfDocumentId: null,
      };
    })
    .sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0));

  const denetimler: DenetimTutanagi[] = (Array.isArray(denetimList) ? denetimList : [])
    .filter((d) => d && typeof d === 'object')
    .map((d: any) => ({
      belgeKodu: metin(d.bkodu ?? d.belgeKodu ?? d.denetimBelgeKodu ?? d.dkodu),
      denetimAdi: metin(d.denetimAdi ?? d.denetimAdiText ?? d.dadi),
      denetimTuru: metin(d.denetimTuruText ?? d.denetimTuru ?? d.dturu),
      tarih: gibTarihCoz(d.tarih ?? d.denetimTarihi) || '',
      sonuc: metin(d.sonuc ?? d.sonucText) || null,
      ham: d,
    }))
    .sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0));

  return {
    yoklamaSayisi: yoklamalar.length,
    denetimSayisi: denetimler.length,
    sonYoklamaTarihi: enBuyukTarih(yoklamalar.map((y) => y.tarih)) ?? enBuyukTarih(denetimler.map((d) => d.tarih)),
    yoklamalar,
    denetimler,
    ham: { yoklamaList: Array.isArray(yoklamaList) ? yoklamaList : null, denetimList: Array.isArray(denetimList) ? denetimList : null },
  };
}

/** "4 yoklama, 0 denetim; son 31.10.2025" | "Yoklama / denetim kaydı yok" */
export function yoklamaDenetimOzeti(v: YoklamaDenetimVeri): string {
  if (!v.yoklamaSayisi && !v.denetimSayisi) return 'Yoklama / denetim kaydı yok';
  const son = v.sonYoklamaTarihi ? `; son ${isoGunBicimle(v.sonYoklamaTarihi)}` : '';
  return `${v.yoklamaSayisi} yoklama, ${v.denetimSayisi} denetim${son}`;
}

// ───────────────────────────── POS ─────────────────────────────

/**
 * pos-islem/banka-bilgileri + odeme-kurulus-bilgileri `dataList`leri (null olabilir) → PosVeri (yıl+ay).
 */
export function posCoz(yil: number | string, ay: number | string, bankaDataList: unknown, odemeKurulusDataList: unknown): PosVeri {
  const satirCoz = (liste: unknown, kaynak: PosSatiri['kaynak']): PosSatiri[] =>
    (Array.isArray(liste) ? liste : [])
      .filter((r) => r && typeof r === 'object')
      .map((r: any) => ({
        kaynak,
        unvan: metin(r.unvan),
        vkn: metin(r.vkn),
        uyeIsyeriNo: metin(r.uyeIsyeriNo),
        tutar: tutarCoz(r.tutar),
      }));
  const satirlar = [...satirCoz(bankaDataList, 'BANKA'), ...satirCoz(odemeKurulusDataList, 'ODEME_KURULUSU')];
  return {
    yil: Number(yil),
    ay: Number(ay),
    toplamTutar: yuvarla(satirlar.reduce((s, r) => s + r.tutar, 0)),
    satirSayisi: satirlar.length,
    satirlar,
    ham: { bankaDataList: Array.isArray(bankaDataList) ? bankaDataList : null, odemeKurulusDataList: Array.isArray(odemeKurulusDataList) ? odemeKurulusDataList : null },
  };
}

/** "VAKIFBANK 2 üye işyeri, 224.149,00 ₺" | "3 üye işyeri (VAKIFBANK, ZİRAAT), …" | "POS işlemi yok" */
export function posOzeti(v: PosVeri): string {
  if (!v.satirSayisi) return 'POS işlemi yok';
  const unvanlar = Array.from(new Set(v.satirlar.map((s) => s.unvan).filter(Boolean)));
  const adet = `${v.satirSayisi} üye işyeri`;
  if (unvanlar.length === 1) return `${unvanlar[0]} ${adet}, ${tlBicimle(v.toplamTutar)}`;
  if (unvanlar.length > 1) return `${adet} (${unvanlar.slice(0, 4).join(', ')}${unvanlar.length > 4 ? ', …' : ''}), ${tlBicimle(v.toplamTutar)}`;
  return `${adet}, ${tlBicimle(v.toplamTutar)}`;
}

// ───────────────────────────── Gelen e-Arşiv ─────────────────────────────

/** Bir 7 günlük sorgu penceresinin ham sonucu (`faturalar` = resultListDenormalized; hata varsa `hata`). */
export type GelenEArsivPenceresi = { baslangic: string; bitis: string; faturalar?: unknown; hata?: string | null };

function eArsivFaturaCoz(f: any): GelenEArsivFaturasi {
  return {
    faturaNo: metin(f.faturaNo),
    duzenlenmeTarihi: gibTarihCoz(f.duzenlenmeTarihi) || '',
    saticiUnvan: metin(f.unvan),
    saticiVkn: metin(f.tcknVkn) || metin(f.mukellefVkn) || metin(f.mukellefTckn),
    gonderimSekli: metin(f.gonderimSekli),
    toplamTutar: tutarCoz(f.toplamTutar),
    vergilerTutari: tutarCoz(f.vergilerTutari),
    odenecekTutar: tutarCoz(f.odenecekTutar),
    paraBirimi: metin(f.paraBirimi) || 'TRY',
    iptalItirazDurum: metin(f.iptalItirazDurum) || null,
  };
}

/**
 * Pencere sonuçları → aya göre gruplanmış satırlar (donem "YYYY-MM"). Faturalar faturaNo ile tekrarsızdır
 * (pencere sınırında çift gelen fatura bir kez sayılır). Sorgulanan aralığın kapsadığı HER ay için satır üretilir
 * (fatura yoksa faturaSayisi 0 — "bu ay sorgulandı, fatura yok" bilgisi ekranda kalsın).
 */
export function gelenEArsivCoz(pencereler: GelenEArsivPenceresi[]): Array<{ donem: string; veri: GelenEArsivVeri }> {
  const gorulen = new Set<string>();
  const faturalar: GelenEArsivFaturasi[] = [];
  let genelBas: string | null = null;
  let genelBit: string | null = null;
  const gecerli = (Array.isArray(pencereler) ? pencereler : []).filter((p) => p && p.baslangic && p.bitis);
  for (const p of gecerli) {
    if (!genelBas || p.baslangic < genelBas) genelBas = p.baslangic;
    if (!genelBit || p.bitis > genelBit) genelBit = p.bitis;
    for (const ham of Array.isArray(p.faturalar) ? p.faturalar : []) {
      if (!ham || typeof ham !== 'object') continue;
      const f = eArsivFaturaCoz(ham);
      const anahtar = f.faturaNo || `${f.saticiVkn}|${f.duzenlenmeTarihi}|${f.odenecekTutar}`;
      if (gorulen.has(anahtar)) continue;
      gorulen.add(anahtar);
      faturalar.push(f);
    }
  }
  if (!genelBas || !genelBit) return [];

  // Aylar: aralığın kapsadığı aylar + (beklenmedik biçimde) aralık dışına düşen fatura ayları
  const aylar = new Set<string>();
  for (let a = genelBas.slice(0, 7); a <= genelBit.slice(0, 7); a = ayEkle(a, 1)) aylar.add(a);
  for (const f of faturalar) if (/^\d{4}-\d{2}/.test(f.duzenlenmeTarihi)) aylar.add(f.duzenlenmeTarihi.slice(0, 7));

  const pencereAyaDeger = (p: GelenEArsivPenceresi, ay: string) => p.baslangic.slice(0, 7) <= ay && p.bitis.slice(0, 7) >= ay;

  return Array.from(aylar)
    .sort()
    .map((ay) => {
      const ayBas = `${ay}-01`;
      const aySon = ayinSonGunu(ay);
      const ayFaturalari = faturalar
        .filter((f) => f.duzenlenmeTarihi.slice(0, 7) === ay)
        .sort((a, b) => (a.duzenlenmeTarihi < b.duzenlenmeTarihi ? 1 : a.duzenlenmeTarihi > b.duzenlenmeTarihi ? -1 : 0));
      const ayPencereleri = gecerli.filter((p) => pencereAyaDeger(p, ay));
      const veri: GelenEArsivVeri = {
        baslangic: genelBas! > ayBas ? genelBas! : ayBas,
        bitis: genelBit! < aySon ? genelBit! : aySon,
        faturaSayisi: ayFaturalari.length,
        toplamOdenecek: yuvarla(ayFaturalari.reduce((s, f) => s + f.odenecekTutar, 0)),
        faturalar: ayFaturalari,
        pencereSayisi: ayPencereleri.length,
        hataliPencereler: ayPencereleri
          .filter((p) => p.hata)
          .map((p) => ({ baslangic: p.baslangic, bitis: p.bitis, hata: String(p.hata) })),
      };
      return { donem: ay, veri };
    });
}

/** "6 fatura, 78.744,40 ₺" | "Gelen e-Arşiv faturası yok" (+ " (1 pencere hatalı)") */
export function gelenEArsivOzeti(v: GelenEArsivVeri): string {
  const govde = v.faturaSayisi ? `${v.faturaSayisi} fatura, ${tlBicimle(v.toplamOdenecek)}` : 'Gelen e-Arşiv faturası yok';
  const hata = v.hataliPencereler?.length ? ` (${v.hataliPencereler.length} pencere hatalı)` : '';
  return `${govde}${hata}`;
}

// ───────────────────────────── e-Defter beratları ─────────────────────────────

/** "202605" | "2026-05" → "2026-05" */
export function eDefterDonemAnahtari(donem: string): string {
  const s = metin(donem);
  const m = s.match(/^(\d{4})-?(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

/**
 * EDEFTER_PAKET_LISTESI_GETIR `result[]` → EDefterBeratGirdisi[] (dönem "YYYY-MM"; alinmaZamani ISO).
 * paketId olmayan satır atlanır.
 */
export function eDefterPaketCoz(donemYYYYMM: string, result: unknown): EDefterBeratGirdisi[] {
  const donem = eDefterDonemAnahtari(donemYYYYMM);
  return (Array.isArray(result) ? result : [])
    .filter((p) => p && typeof p === 'object' && metin(p.paketId))
    .map((p: any) => {
      const durumHam = p.durumKodu;
      const durumKodu =
        durumHam === null || durumHam === undefined || durumHam === '' ? null : Number.isFinite(Number(durumHam)) ? Number(durumHam) : null;
      return {
        donem,
        belgeTuru: metin(p.belgeTuru),
        paketId: metin(p.paketId),
        islemOid: metin(p.islemOid) || null,
        oid: metin(p.oid) || null,
        alinmaZamani: gibTarihCoz(p.alinmaZamani),
        durumKodu,
        durumAciklama: metin(p.durumAciklama) || null,
        ham: p,
      };
    });
}

/** "3 paket (KB, YB, Y) — beratlar verildi" | "Paket yok" */
export function eDefterOzeti(beratlar: EDefterBeratGirdisi[]): string {
  if (!beratlar.length) return 'Paket yok';
  const turler = Array.from(new Set(beratlar.map((b) => b.belgeTuru).filter(Boolean)));
  const basarili = (tur: string) => beratlar.some((b) => b.belgeTuru === tur && b.durumKodu === 0);
  const verildi = basarili('KB') && basarili('YB') ? ' — beratlar verildi' : '';
  return `${beratlar.length} paket (${turler.join(', ')})${verildi}`;
}

// ───────────────────────────── Özet dağıtıcı ─────────────────────────────

/** Sonuç türüne göre tek satırlık ekran özeti. */
export function ozetMetni(tur: GenelSorguTuru, veri: GenelSorguVeri): string {
  switch (tur) {
    case 'VERGI_BORCU':
      return vergiBorcuOzeti(veri as VergiBorcuVeri);
    case 'E_HACIZ':
      return eHacizOzeti(veri as EHacizVeri);
    case 'YOKLAMA_DENETIM':
      return yoklamaDenetimOzeti(veri as YoklamaDenetimVeri);
    case 'POS':
      return posOzeti(veri as PosVeri);
    case 'GELEN_EARSIV':
      return gelenEArsivOzeti(veri as GelenEArsivVeri);
    default:
      return '';
  }
}
