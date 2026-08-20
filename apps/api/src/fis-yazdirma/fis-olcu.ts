/**
 * FİŞ GÖRSELİ ÖLÇÜLENDİRME — saf fonksiyon, testle kilitli.
 *
 * KÖK HATA (2026-08-20): eski kod yalnız GENİŞLİĞİ sütuna sabitliyor,
 * yüksekliği en-boy oranına bırakıyordu:
 *     displayH = imgH * (DISPLAY_W / imgW)
 * ÖKC fişi uzun ve dar olduğu için 5,2 cm genişlikte ~15-20 cm boyunda
 * çıkıyor; sayfaya 2 sıra sığmıyor (2 × 15,6 = 31,2 cm > 27,94 cm) ve
 * ikinci sıra sonraki sayfaya taşıyordu. Sonuç: "sayfa başına 8" seçilse
 * bile sayfada TEK SIRA (4 fiş) görünüyor, 456 fiş 111 sayfa oluyordu.
 *
 * Doğrusu: hem genişliğe hem yüksekliğe sığdır, en-boy oranını koru.
 */
export function fisGorselOlcusu(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
  /** OKUNABİLİRLİK TABANI — fiş bu genişliğin altına İNMEZ (px). */
  minW = 0,
  /** Hiçbir koşulda aşılamayacak yükseklik (sayfa boyu). */
  mutlakMaxH = Number.POSITIVE_INFINITY,
): { width: number; height: number } {
  // Bozuk metadata gelirse (0/NaN) sütun genişliğine düş — çökme yerine makul çıktı
  const w = Number.isFinite(imgW) && imgW > 0 ? imgW : 800;
  const h = Number.isFinite(imgH) && imgH > 0 ? imgH : 600;

  // 1) Kutuya sığdır
  let olcek = Math.min(maxW / w, maxH / h);

  // 2) OKUNABİLİRLİK ÖNCELİKLİ: yükseklik sınırı fişi okunmaz hâle
  //    getirecekse taban genişliğe geri çık. Bu durumda satır uzar ve
  //    sayfaya daha az fiş girer — kâğıt sayısı değil, OKUNABİLİRLİK öncelikli.
  //    (Kullanıcı talimatı 2026-08-20: "fişler küçülebilir de ama görüntü
  //    olarak okunmayacak şekilde olmasın".)
  if (minW > 0 && w * olcek < minW) olcek = Math.min(minW, maxW) / w;

  // 3) Hiçbir fiş sayfadan uzun olamaz — olursa hiç basılamaz
  if (h * olcek > mutlakMaxH) olcek = mutlakMaxH / h;

  return {
    width: Math.max(1, Math.round(w * olcek)),
    height: Math.max(1, Math.round(h * olcek)),
  };
}

/** Bir satıra düşen azami görsel yüksekliği (px, 96 dpi). */
export function satirYuksekligi(
  sayfaYuksekligiMm: number,
  satirSayisi: number,
  tarihEtiketiPx: number,
): number {
  const sayfaPx = (sayfaYuksekligiMm / 25.4) * 96;
  return Math.max(1, Math.floor(sayfaPx / satirSayisi) - tarihEtiketiPx);
}

/**
 * SAYFALARA AKILLI PAKETLEME.
 *
 * Eski yerleşim SABİT ızgaraydı: her sayfaya tam `perPage` fiş, satır sayısı
 * sabit. Fişler farklı boylarda olduğu için sayfanın altında kocaman boşluk
 * kalıyor, kullanıcının deyimiyle "saçma" duruyordu.
 *
 * Burada satır yüksekliği o satırdaki EN UZUN fişten gelir ve sayfa doldukça
 * yeni sayfaya geçilir. Kısa fişlerden oluşan bir sayfaya seçilenden DAHA ÇOK
 * satır sığar → daha az kâğıt, daha az boşluk.
 *
 * Sıra KORUNUR (tarih sırası). Yüksekliğe göre sıralamak boşluğu daha da
 * azaltırdı ama muhasebe dökümünde kronolojik sıra bozulmamalı.
 *
 * @returns sayfa -> satır -> öğe indeksi
 */
export function fisleriSayfalaraBol(
  yukseklikler: number[],
  cols: number,
  sayfaYuksekligiPx: number,
): number[][][] {
  const sayfalar: number[][][] = [];
  let sayfa: number[][] = [];
  let doluluk = 0;

  for (let i = 0; i < yukseklikler.length; i += cols) {
    const satir: number[] = [];
    for (let j = i; j < Math.min(i + cols, yukseklikler.length); j++) satir.push(j);
    const satirH = Math.max(...satir.map((k) => yukseklikler[k]));

    // Sayfada en az bir satır varsa ve bu satır taşıracaksa yeni sayfaya geç.
    // "En az bir satır" şartı olmazsa, tek başına sayfadan uzun bir fiş
    // sonsuz boş sayfa üretirdi.
    if (sayfa.length > 0 && doluluk + satirH > sayfaYuksekligiPx) {
      sayfalar.push(sayfa);
      sayfa = [];
      doluluk = 0;
    }
    sayfa.push(satir);
    doluluk += satirH;
  }
  if (sayfa.length > 0) sayfalar.push(sayfa);
  return sayfalar;
}

/**
 * SÜTUN YERLEŞİMİ — gazete kolonu gibi.
 *
 * NEDEN SATIR DEĞİL: fişler farklı boylarda (ölçüm 2026-08-20: boy/en oranı
 * ortanca 2,30 · en uzun 3,81). Satır düzeninde bir satırdaki TEK uzun fiş
 * bütün satırı uzatır; fişlerin yarısı uzun olduğu için hemen her satır tek
 * başına sayfayı doldurup 456 fiş 105 sayfaya çıkıyordu.
 *
 * Sütunda ise uzun fiş yalnız KENDİ sütununu etkiler; diğer sütunlar dolmaya
 * devam eder. Aynı okunabilirlikte (tam sütun genişliği) kâğıt neredeyse
 * yarıya iner.
 *
 * Sıra korunur: sütun sütun aşağı doğru okunur (1. sütun bitince 2. sütun).
 *
 * @returns sayfa -> sütun -> öğe indeksi
 */
export function fisleriSutunlaraBol(
  yukseklikler: number[],
  cols: number,
  sayfaYuksekligiPx: number,
): number[][][] {
  const sayfalar: number[][][] = [];
  let sayfa: number[][] = Array.from({ length: cols }, () => []);
  let doluluk = new Array(cols).fill(0);

  const sayfayiKapat = () => {
    if (sayfa.some((k) => k.length > 0)) sayfalar.push(sayfa);
    sayfa = Array.from({ length: cols }, () => []);
    doluluk = new Array(cols).fill(0);
  };

  for (let i = 0; i < yukseklikler.length; i++) {
    const h = yukseklikler[i];

    // İLK SIĞAN SÜTUN. Önce "sıradaki sütuna geç" deniyordu ama geçilen sütuna
    // bir daha dönülmüyordu: yarısı boş bir sütun varken sayfa kapanıyor,
    // 456 fiş yine 103 sayfa ediyordu. Her fiş için sütunların HEPSİNE bakılır.
    let s = -1;
    for (let k = 0; k < cols; k++) {
      if (doluluk[k] === 0 || doluluk[k] + h <= sayfaYuksekligiPx) {
        s = k;
        break;
      }
    }

    if (s === -1) {
      sayfayiKapat();
      s = 0;
    }
    sayfa[s].push(i);
    doluluk[s] += h;
  }
  sayfayiKapat();
  return sayfalar;
}

/**
 * ÖLÇÜLDÜ, İŞE YARAMADI — bir daha denenmesin.
 *
 * "Fişe %10 küçülme payı verip sütunun dibindeki boşluğu doldurmak" denendi
 * (2026-08-20, 456 gerçek fiş): 69 sayfa -> 69 sayfa. HİÇBİR KAZANÇ YOK.
 * Sebep geometrik: 1:3,8 oranındaki bir fiş 1056 px'lik sütunda 263 px boşluk
 * bırakıyor, oraya en kısa fiş (420 px) ancak %37 küçülerek girer — %10 payın
 * çok ötesinde. %20 pay 63 sayfa veriyor ama 90 fişi 4,3 cm'ye düşürüyor;
 * bu, doğrudan "Küçük" boyutu seçmekle aynı şey, üstelik habersizce.
 *
 * "Sıradaki fiş sığmıyorsa birkaç ileriden sığanı öne al" da denendi:
 * pencere 5/10/20/50 -> hepsi 69 sayfa. Kazanç yok.
 *
 * SONUÇ: bu genişlikte 69 sayfa gerçek tabandır. Tek gerçek kaldıraç
 * FİŞ GENİŞLİĞİDİR (sütun sayısı): 4 sütun 69 sayfa, 5 sütun 46 sayfa.
 */
