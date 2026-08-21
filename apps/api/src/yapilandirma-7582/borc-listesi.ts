/**
 * GİB BORÇ LİSTESİ EXCEL'İNİ OKUR (SAF — ağ/DB yok).
 *
 * BİÇİM (canlı dosyadan çıkarıldı, 2026-08-21 · 65 mükellef · 1.392 satır):
 *
 *   1.  FİGEN KABAKCI                          ← mükellef başlığı: "sıra. AD"
 *   Vadesi Geçmiş: 4.709,32  TL                ← o mükellefin GİB'e göre toplamı
 *   Vergi Dairesi | Belge No | Vergi Türü | Vergi Dönemi | Plaka | Toplam Borç   ← başlık
 *   BÜYÜKÇEKMECE… | 2026061801Azr… | 0015 GERÇEK USULDE… | 05/2026-05/2026 | - | 843,69 TL
 *   …
 *   (boş satır)
 *   2.  MUZAFFER ÖREN
 *   …
 *
 * NEDEN AYRI MODÜL: bu düz bir tablo değil, tekrar eden bloklar. Standart "ilk satır
 * başlıktır" okuması bu dosyada mükellef adlarını veri sanır ve tutarları birbirine karıştırır.
 *
 * TUTAR: "1.960,65  TL" → binlik nokta, ondalık virgül. Türkçe ayraç yanlış okunursa
 * 1.960,65 TL borç 1,96 TL görünür (bu hata bu projede daha önce yaşandı, bkz. Fatura Kes).
 */

export type BorcListesiSatiri = {
  daire: string;
  belgeNo: string;
  vergiTuru: string;
  donem: string;
  plaka: string;
  tutar: number;
};

export type BorcListesiMukellefi = {
  sira: number;
  ad: string;
  /** GİB'in listede yazdığı toplam — bizim topladığımızla karşılaştırılır. */
  beyanEdilenToplam: number | null;
  satirlar: BorcListesiSatiri[];
};

/** "1.960,65  TL" → 1960.65 · "-" → 0 */
export function tutarOku(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const ham = String(v).replace(/TL/gi, '').replace(/ /g, ' ').trim();
  if (!ham || ham === '-') return 0;
  // Binlik ayracı nokta, ondalık virgül: "1.960,65"
  const n = Number(ham.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const metin = (v: any) => (v == null ? '' : String(v).trim());

/**
 * Satır dizisinden (her satır = hücre dizisi) mükellef bloklarını çıkarır.
 * Excel okuma işi çağırana ait; burada yalnız yapı çözümlenir (test edilebilirlik için).
 */
export function borcListesiCoz(satirlar: any[][]): BorcListesiMukellefi[] {
  const sonuc: BorcListesiMukellefi[] = [];
  let aktif: BorcListesiMukellefi | null = null;

  for (const ham of satirlar || []) {
    const h = (ham || []).map(metin);
    const ilk = h[0] || '';
    if (!ilk && !h.some(Boolean)) continue; // boş satır

    // Mükellef başlığı: "12.  AHMET YILMAZ"
    const bas = ilk.match(/^(\d+)\.\s+(\S.*)$/);
    if (bas) {
      aktif = { sira: Number(bas[1]), ad: bas[2].trim(), beyanEdilenToplam: null, satirlar: [] };
      sonuc.push(aktif);
      continue;
    }

    if (/^vadesi\s*ge/i.test(ilk)) {
      if (aktif) aktif.beyanEdilenToplam = tutarOku(ilk.split(':').slice(1).join(':'));
      continue;
    }

    // Tablo başlığı — atlanır
    if (/^vergi\s*dairesi$/i.test(ilk)) continue;

    // Veri satırı: en az vergi türü ve tutar dolu olmalı
    if (aktif && ilk && h[2]) {
      aktif.satirlar.push({
        daire: ilk,
        belgeNo: h[1] || '',
        vergiTuru: h[2] || '',
        donem: h[3] || '',
        plaka: h[4] || '',
        tutar: tutarOku(ham[5]),
      });
    }
  }

  return sonuc;
}

/**
 * MÜKELLEF ADI EŞLEŞTİRME ANAHTARI.
 * "İŞIKLAR LOJİSTİK TAHMİL TAHLİYE İNŞAAT" gibi adlar portal kaydında farklı yazılabildiği
 * için karşılaştırma sadeleştirilmiş metin üzerinden yapılır. Eşleşme bulunamazsa
 * UYDURULMAZ — null döner ve kullanıcı elle seçer.
 */
export function adAnahtari(ad: string): string {
  return String(ad || '')
    .replace(/[İIı]/g, 'i').replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(limited|ltd|sirketi|sti|anonim|as|a s|sanayi|ticaret|tic|san|ve)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
