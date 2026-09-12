/**
 * PLAN ADAYLARI — mükellefin hesap planından AI'a verilecek matrah/gider/gelir aday listesi.
 * SAF modül: DB / Nest bağımlılığı YOK (regresyon betiği doğrudan yükler: scripts/plan-adaylari-regression.cjs).
 *
 * PLAN/15 Faz 1 — Karar çekirdeği B (2026-09-12): eskiden aiReadDocument, aiPickGiderAccount ve classify yolu
 * ayrı ayrı, plan sırasında ve rol etiketsiz "kod = ad" listesi üretiyordu; grup tavanı yoktu (153 altındaki
 * yüzlerce ürün hesabı 770'i listeden düşürebiliyordu), yön ayrımı yoktu (alışta 6xx, satışta 7xx aday oluyordu).
 * Burada TEK kaynak: YÖN SIRALI (alışta 15x → 25x → 7xx; satışta 60x → 64x/67x) + ROL ETİKETLİ
 * ("[stok/ticari mal]" gibi — AI'a gider/stok/duran varlık ayrımını açıkça verir) + GRUP TAVANLI
 * (ana hesap başına en çok N yaprak; toplam tavan aşılırsa en kalabalık gruptan kırpılır → hiçbir rol aç kalmaz).
 *
 * Kurallar:
 *  - Yalnız KAYDEDİLEBİLİR yaprak: noktalı kod, ana segment ≥ 3 hane, altında başka kod olmayan.
 *  - ALIŞ: 15x (stok), 25x (duran varlık), 73x-78x (gider). 6xx YASAK; 1xx/2xx/3xx cari-KDV-kasa (191/391 dahil),
 *    19x/39x, 79x (7/B — aiReadDocument'ta zaten hariçti) listeye GİRMEZ.
 *  - SATIŞ: 600/601/602 (gelir), 610/611/612 yalnız iade=true ise, 64x/67x (diğer olağan/olağandışı gelir).
 *    7xx/15x/25x satışta GİRMEZ.
 *  - Tevkifatlı hesap adları ELENMEZ (rematch halleder).
 */

/** Rol tablosu satırı: ön ek deseni + AI'a gösterilecek rol etiketi (+ yalnız iadede mi). */
const ALIS_ROLLER = [
  { on: /^15\d/, rol: 'stok/ticari mal' },
  { on: /^25\d/, rol: 'duran varlık (demirbaş)' },
  { on: /^73\d/, rol: 'gider (genel üretim)' },
  { on: /^74\d/, rol: 'gider (hizmet üretim maliyeti)' },
  { on: /^75\d/, rol: 'gider (araştırma-geliştirme)' },
  { on: /^76\d/, rol: 'gider (pazarlama satış dağıtım)' },
  { on: /^77\d/, rol: 'gider (genel yönetim)' },
  { on: /^78\d/, rol: 'gider (finansman)' },
];

const SATIS_ROLLER = [
  { on: /^600/, rol: 'gelir (yurtiçi satışlar)' },
  { on: /^601/, rol: 'gelir (yurtdışı satışlar)' },
  { on: /^602/, rol: 'gelir (diğer gelirler)' },
  { on: /^61[012]/, rol: 'satıştan iade/iskonto', yalnizIade: true },
  { on: /^64\d/, rol: 'diğer olağan gelir ve kâr' },
  { on: /^67\d/, rol: 'olağandışı gelir ve kâr' },
];

/** Varsayılan tavanlar: ana hesap başına 60 yaprak, toplam 300 satır (Sonnet/okuma yolu); Haiku classify yolu 150 verir. */
export const PLAN_ADAY_GRUP_TAVANI = 60;
export const PLAN_ADAY_TOPLAM_TAVAN = 300;
/** Hesap adı prompt satırında en çok bu kadar karakter. */
export const PLAN_ADAY_AD_UZUNLUK = 80;

/**
 * SATIŞ GELİR HESABI kuralı — TEK KAYNAK (PLAN/15 bulgu 3): eskiden yalnız aiReadDocument (görsel/metin okuma)
 * promptunda vardı; UBL/entegratör belgeleri classify yolundan geçtiği için bu kuraldan yararlanmıyordu.
 * Artık iki yerden de (aiReadDocument + classifyBodySegments) AYNEN bu metin kullanılır — metni değiştirirken tek yer.
 */
export const SATIS_GELIR_HESABI_KURALI =
  'SATIŞ GELİR HESABI (mükellef SATICIYSA, matrahHesapKodu): MAL satışı → yurtiçi satışlar (600); HİZMET satışı → planında hizmet geliri için varsa 600/601; İHRACAT/yurtdışı → 601. ⚠️ PRİM / CİRO PRİMİ / HAKEDİŞ / KOMİSYON / KUR FARKI / FAİZ gibi MAL-HİZMET SATIŞI OLMAYAN gelirler → 602 DİĞER GELİRLER (yoksa 649 DİĞER OLAĞAN GELİR VE KÂRLAR); bunları 600 MAL SATIŞ hesabına ASLA yazma. Uygun gelir hesabı planda yoksa matrahHesapKodu BOŞ.';

/**
 * ROL ETİKETİ açıklaması — prompt'a tek cümle (B2): köşeli parantezin ne olduğunu ve alışta
 * stok / gider / duran varlık ayrımını AI'a açıkça verir.
 */
export const PLAN_ADAY_ROL_ACIKLAMASI =
  'Köşeli parantez hesabın ROLÜ; ticaret mükellefinde satılmak üzere alınan mal STOK (15x), kullanılacak/tüketilecek şey GİDER (7xx), had üstü dayanıklı varlık DURAN VARLIK (25x).';

/** Pozitif tam sayı değilse varsayılanı döndür. */
function tavanDegeri(v: any, varsayilan: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : varsayilan;
}

/** Hesap kodlarını segment segment SAYISAL karşılaştır (153.01.002 < 153.01.010; "770.1" < "770.01.001" değil, doğal sıra). */
export function planKodKarsilastir(a: string, b: string): number {
  const pa = String(a || '').split('.');
  const pb = String(b || '').split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const sa = pa[i]; const sb = pb[i];
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;
    const na = Number(sa); const nb = Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb) && sa !== '' && sb !== '') {
      if (na !== nb) return na - nb;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Hesap planından yön-sıralı, rol etiketli, grup tavanlı aday listesi üretir.
 * @param hesaplar Plan satırları ({ accountCode, accountName }); grup/ana hesaplar da verilebilir, yaprak ayıklanır.
 * @param secenek yon: 'ALIS' | 'SATIS'; grupTavani (vars. 60); toplamTavan (vars. 300); iade: satışta 610/611/612 dahil edilsin mi.
 * @returns adaylar: sıralı { kod, ad, rol } dizisi; metin: prompt satırları `kod = ad [rol]` (ad ≤ 80 karakter).
 */
export function planAdaylariHazirla(
  hesaplar: Array<{ accountCode: string; accountName: string }>,
  secenek: { yon: 'ALIS' | 'SATIS'; grupTavani?: number; toplamTavan?: number; iade?: boolean },
): { adaylar: Array<{ kod: string; ad: string; rol: string }>; metin: string } {
  const yon = secenek && secenek.yon === 'SATIS' ? 'SATIS' : 'ALIS';
  const grupTavani = tavanDegeri(secenek && secenek.grupTavani, PLAN_ADAY_GRUP_TAVANI);
  const toplamTavan = tavanDegeri(secenek && secenek.toplamTavan, PLAN_ADAY_TOPLAM_TAVAN);
  const iade = !!(secenek && secenek.iade === true);

  // 1) kod → ad (tekilleştir) + grup kodları (noktalı kodların her ön eki gruptur → yaprak değildir)
  const adMap = new Map<string, string>();
  for (const h of Array.isArray(hesaplar) ? hesaplar : []) {
    const kod = String((h && h.accountCode) || '').trim();
    if (!kod || adMap.has(kod)) continue;
    adMap.set(kod, String((h && h.accountName) || '').replace(/\s+/g, ' ').trim());
  }
  const grupKodlari = new Set<string>();
  for (const kod of adMap.keys()) {
    let ix = kod.indexOf('.');
    while (ix !== -1) { grupKodlari.add(kod.slice(0, ix)); ix = kod.indexOf('.', ix + 1); }
  }
  const kaydedilebilirYaprak = (kod: string): boolean =>
    kod.includes('.') && !grupKodlari.has(kod) && kod.split('.')[0].replace(/\D/g, '').length >= 3;

  // 2) her yaprağı rolüne ata; grup anahtarı = 3 haneli ana hesap (153, 770 …)
  const roller: Array<{ on: RegExp; rol: string; yalnizIade?: boolean }> = yon === 'SATIS' ? SATIS_ROLLER : ALIS_ROLLER;
  const gruplar = new Map<string, { rolSira: number; kodlar: Array<{ kod: string; ad: string; rol: string }> }>();
  for (const [kod, ad] of adMap) {
    if (!kaydedilebilirYaprak(kod)) continue;
    const rolIx = roller.findIndex((r) => r.on.test(kod));
    if (rolIx < 0) continue;
    const r = roller[rolIx];
    if (r.yalnizIade && !iade) continue;
    const ana = kod.split('.')[0];
    let g = gruplar.get(ana);
    if (!g) { g = { rolSira: rolIx, kodlar: [] }; gruplar.set(ana, g); }
    g.kodlar.push({ kod, ad, rol: r.rol });
  }

  // 3) sıralama: rol sırası → ana hesap artan → kod artan; grup tavanı (ana hesap başına en çok N)
  const sirali = Array.from(gruplar.entries())
    .sort((a, b) => (a[1].rolSira - b[1].rolSira) || planKodKarsilastir(a[0], b[0]))
    .map(([, g]) => g.kodlar.sort((x, y) => planKodKarsilastir(x.kod, y.kod)).slice(0, grupTavani));

  // 4) toplam tavan: aşılırsa EN KALABALIK gruptan birer birer kırp (kuyruğu kesmek 7xx'i aç bırakırdı)
  let toplam = sirali.reduce((s, g) => s + g.length, 0);
  while (toplam > toplamTavan) {
    let enBuyuk = -1;
    for (let i = 0; i < sirali.length; i++) if (enBuyuk < 0 || sirali[i].length > sirali[enBuyuk].length) enBuyuk = i;
    if (enBuyuk < 0 || !sirali[enBuyuk].length) break;
    sirali[enBuyuk].pop();
    toplam--;
  }

  // 5) metin: `kod = ad [rol]`
  const adaylar: Array<{ kod: string; ad: string; rol: string }> = [];
  for (const g of sirali) for (const a of g) adaylar.push(a);
  const metin = adaylar.map((a) => `${a.kod} = ${a.ad.slice(0, PLAN_ADAY_AD_UZUNLUK)} [${a.rol}]`).join('\n');
  return { adaylar, metin };
}

/** Aday kodlarının kümesi — AI'ın döndürdüğü matrahHesapKodu'nu "listede var mı" diye doğrulamak için. */
export function planAdayKodSeti(adaylar: Array<{ kod: string }>): Set<string> {
  const s = new Set<string>();
  for (const a of Array.isArray(adaylar) ? adaylar : []) { const k = String((a && a.kod) || '').trim(); if (k) s.add(k); }
  return s;
}
