/**
 * WhatsApp / portal bildirim METİNLERİ — saf fonksiyonlar, test edilebilir.
 *
 * Tek yerde durmalarının sebebi: mesaj metni kullanıcının gördüğü ürünün kendisi.
 * Cron'un içine gömülü olsa ne test edilebilir ne de gözden geçirilebilirdi.
 *
 * ORTAK İSKELET (her mesaj aynı düzende):
 *   *BAŞLIK*                 ← ne olduğu, tek satır, büyük harf
 *   Kaynak                   ← hangi kart / kredi / hesap
 *   (boş satır)
 *   Etiket: değer            ← 2-4 satır, hizalı bilgi
 *   (boş satır)
 *   ▸ Yapılacak iş           ← tek net aksiyon
 *   _imza_
 *
 * WhatsApp biçimi: *kalın*, _italik_. Kaynak satırında kart adı bir kez geçer,
 * gövdede tekrar edilmez.
 */

const para = (n: number) =>
  `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;

const tarih = (d: Date | string) =>
  new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const gunAdi = (d: Date | string) => new Date(d).toLocaleDateString('tr-TR', { weekday: 'long' });

export interface Mesaj {
  anahtar: string;
  baslik: string;
  govde: string;
  kritik: boolean;
}

interface Iskelet {
  anahtar: string;
  baslik: string;
  kaynak?: string;
  satirlar: Array<[string, string] | null>;
  aksiyon?: string;
  not?: string;
  kritik?: boolean;
  imza?: string;
}

/** Ortak iskelet — bütün mesajlar buradan geçer, böylece görünüm tek elden kalır */
function bicimle(p: Iskelet): Mesaj {
  const satirlar = p.satirlar.filter(Boolean) as Array<[string, string]>;
  const govde = [
    `*${p.baslik.toLocaleUpperCase('tr-TR')}*`,
    p.kaynak || '',
    '',
    ...satirlar.map(([etiket, deger]) => `${etiket}: ${deger}`),
    '',
    p.aksiyon ? `▸ ${p.aksiyon}` : '',
    p.not || '',
    '',
    `_${p.imza || 'Moren · Kişisel Bütçe'}_`,
  ]
    .filter((s, i, a) => !(s === '' && a[i - 1] === '')) // arka arkaya boş satır olmasın
    .join('\n')
    .trim();

  return { anahtar: p.anahtar, baslik: p.baslik, govde, kritik: !!p.kritik };
}

/* ===================== KREDİ KARTI ===================== */

export function kesimGunu(p: {
  banka: string;
  kart: string;
  sonOdemeTarihi: Date;
  harcamaBaslangic?: Date | null;
}): Mesaj {
  return bicimle({
    anahtar: 'kesim-0',
    baslik: 'Hesap özeti bugün kesiliyor',
    kaynak: `${p.banka} — ${p.kart}`,
    satirlar: [
      p.harcamaBaslangic ? ['Kapsadığı dönem', `${tarih(p.harcamaBaslangic)} – bugün`] : null,
      ['Son ödeme tarihi', `${tarih(p.sonOdemeTarihi)} ${gunAdi(p.sonOdemeTarihi)}`],
    ],
    aksiyon: 'Ekstre elinize geçince PDF’i portala yükleyin; hareketler ve tutar otomatik işlensin.',
    not: 'Dilerseniz yalnız borç tutarını da girebilirsiniz.',
  });
}

export function tutarBekleniyor(p: {
  banka: string;
  kart: string;
  donem: string;
  gecenGun: number;
  sonOdemeTarihi: Date;
  kalanGun: number;
}): Mesaj {
  return bicimle({
    anahtar: `tutar-${p.gecenGun}`,
    baslik: 'Ekstre tutarı girilmedi',
    kaynak: `${p.banka} — ${p.kart}`,
    satirlar: [
      ['Ekstre kesildi', `${p.gecenGun} gün önce`],
      ['Son ödeme', `${tarih(p.sonOdemeTarihi)} (${p.kalanGun} gün kaldı)`],
    ],
    aksiyon: 'Ekstre PDF’ini yükleyin ya da borç tutarını girin.',
    not: 'Tutar girilmediği sürece ödeme planı bu kart olmadan hesaplanıyor.',
    kritik: p.gecenGun >= 3,
  });
}

export function sonOdemeYaklasti(p: {
  banka: string;
  kart: string;
  kalanGun: number;
  kalanTutar: number;
  asgariTutar: number;
  sonOdemeTarihi: Date;
  nakit?: number | null;
}): Mesaj {
  const ne =
    p.kalanGun === 0 ? 'BUGÜN son ödeme günü' : p.kalanGun === 1 ? 'Son ödeme yarın' : `Son ödemeye ${p.kalanGun} gün`;
  const eksik = p.nakit !== null && p.nakit !== undefined ? p.kalanTutar - p.nakit : null;
  return bicimle({
    anahtar: `son-odeme-${p.kalanGun}`,
    baslik: ne,
    kaynak: `${p.banka} — ${p.kart}`,
    satirlar: [
      ['Ödenecek tutar', `*${para(p.kalanTutar)}*`],
      ['Asgari ödeme', para(p.asgariTutar)],
      ['Son ödeme tarihi', `${tarih(p.sonOdemeTarihi)} ${gunAdi(p.sonOdemeTarihi)}`],
      p.nakit !== null && p.nakit !== undefined ? ['Hesaplarınızdaki para', para(p.nakit)] : null,
    ],
    aksiyon:
      eksik !== null && eksik > 0
        ? `${para(eksik)} eksiğiniz var. En az asgariyi ödeyip gecikmeyi önleyin.`
        : 'Ödemeyi tamamlayın.',
    kritik: p.kalanGun <= 1,
  });
}

export function odemeGecikti(p: {
  banka: string;
  kart: string;
  gecikmeGun: number;
  kalanTutar: number;
  asgariTutar?: number;
  gecikmeFaizi: number;
}): Mesaj {
  const gunlukFaiz = (p.kalanTutar * (p.gecikmeFaizi / 100)) / 30;
  return bicimle({
    anahtar: `gecikme-${p.gecikmeGun}`,
    baslik: `Ödeme gecikti · ${p.gecikmeGun} gün`,
    kaynak: `${p.banka} — ${p.kart}`,
    satirlar: [
      ['Ödenmeyen tutar', `*${para(p.kalanTutar)}*`],
      p.asgariTutar ? ['Asgari ödeme', para(p.asgariTutar)] : null,
      ['Günlük gecikme faizi', para(gunlukFaiz)],
      ['Bugüne kadar işleyen', para(gunlukFaiz * p.gecikmeGun)],
    ],
    aksiyon: 'Bugün en az asgari tutarı ödeyin.',
    not: 'Gecikme kredi notunuza işler ve sonraki kredi başvurularınızı etkiler.',
    kritik: true,
  });
}

export function asgariOdendi(p: { banka: string; kart: string; kalanTutar: number; aylikFaiz: number }): Mesaj {
  return bicimle({
    anahtar: 'asgari-odendi',
    baslik: 'Asgari ödendi · kalan devrediyor',
    kaynak: `${p.banka} — ${p.kart}`,
    satirlar: [
      ['Devreden tutar', para(p.kalanTutar)],
      ['Aylık faiz yükü', para(p.kalanTutar * (p.aylikFaiz / 100))],
    ],
    aksiyon: 'Gecikme yok. Nakit durumunuz uygunsa kalanı kapatmak en kârlısı.',
  });
}

/* ===================== KREDİ / TAKSİT ===================== */

export function krediTaksiti(p: {
  ad: string;
  tutar: number;
  kalanGun: number;
  odemeGunu: number;
  kalanAnapara: number;
  kalanTaksit?: number;
}): Mesaj {
  return bicimle({
    anahtar: `kredi-${p.kalanGun}`,
    baslik: p.kalanGun === 0 ? 'Kredi taksiti bugün' : `Kredi taksitine ${p.kalanGun} gün`,
    kaynak: p.ad,
    satirlar: [
      ['Taksit tutarı', `*${para(p.tutar)}*`],
      ['Ödeme günü', `Ayın ${p.odemeGunu}’i`],
      ['Kalan anapara', para(p.kalanAnapara)],
      p.kalanTaksit ? ['Kalan taksit', `${p.kalanTaksit} ay`] : null,
    ],
    aksiyon: p.kalanGun === 0 ? 'Bugün ödeyin; gecikme kredi notunu etkiler.' : 'Hesabınızda tutarı hazır bulundurun.',
    kritik: p.kalanGun === 0,
  });
}

/* ===================== NAKİT AKIŞI ===================== */

export function nakitAcigi(p: {
  tarih: Date;
  acik: number;
  odemeToplami?: number;
  nakit?: number;
  enUcuzSecenek?: { ad: string; aciklama: string; maliyet: number } | null;
}): Mesaj {
  return bicimle({
    anahtar: `nakit-acik-${new Date(p.tarih).toISOString().slice(0, 10)}`,
    baslik: 'Nakit açığı görünüyor',
    kaynak: `${tarih(p.tarih)} ${gunAdi(p.tarih)}`,
    satirlar: [
      p.odemeToplami !== undefined ? ['O gün ödenecek', para(p.odemeToplami)] : null,
      p.nakit !== undefined ? ['Beklenen nakit', para(p.nakit)] : null,
      ['Açık', `*${para(p.acik)}*`],
      p.enUcuzSecenek
        ? [
            'En ucuz çözüm',
            `${p.enUcuzSecenek.ad}${p.enUcuzSecenek.maliyet > 0 ? ` (~${para(p.enUcuzSecenek.maliyet)} maliyet)` : ' (maliyetsiz)'}`,
          ]
        : null,
    ],
    aksiyon: p.enUcuzSecenek ? p.enUcuzSecenek.aciklama : 'Ödeme planı ekranından seçeneklere bakın.',
    not: 'Diğer seçenekler ve maliyetleri portalda Nakit Akışı sekmesinde.',
    kritik: true,
  });
}

export function gunlukOzet(p: {
  bugun: Date;
  nakit: number;
  odemeler: Array<{ ad: string; tutar: number }>;
  beklenenGirisler: Array<{ ad: string; tutar: number }>;
}): Mesaj {
  const toplamOdeme = p.odemeler.reduce((t, o) => t + o.tutar, 0);
  const toplamGiris = p.beklenenGirisler.reduce((t, g) => t + g.tutar, 0);
  const sonrasi = p.nakit + toplamGiris - toplamOdeme;
  return bicimle({
    anahtar: 'gunluk-ozet',
    baslik: 'Bugünün ödemeleri',
    kaynak: `${tarih(p.bugun)} ${gunAdi(p.bugun)}`,
    satirlar: [
      ['Hesaplarınızdaki para', para(p.nakit)],
      ...p.odemeler.map((o) => [`• ${o.ad}`, para(o.tutar)] as [string, string]),
      ['Toplam ödeme', `*${para(toplamOdeme)}*`],
      ...(p.beklenenGirisler.length
        ? (p.beklenenGirisler.map((g) => [`• ${g.ad} (giriş)`, para(g.tutar)]) as Array<[string, string]>)
        : []),
      ['Ödemeler sonrası', sonrasi >= 0 ? para(sonrasi) : `*${para(sonrasi)}* (açık)`],
    ],
    aksiyon:
      sonrasi >= 0
        ? 'Ödemeler için para yeterli.'
        : `${para(-sonrasi)} eksik. Nakit Akışı ekranındaki seçeneklere bakın.`,
    kritik: sonrasi < 0,
  });
}

/* ===================== HESAP / LİMİT ===================== */

export function kmhUyarisi(p: {
  banka: string;
  hesap: string;
  borc: number;
  limit: number;
  aylikFaiz: number;
}): Mesaj {
  const doluluk = p.limit > 0 ? Math.round((p.borc / p.limit) * 100) : 0;
  return bicimle({
    anahtar: 'kmh',
    baslik: 'Ek hesap (KMH) kullanımda',
    kaynak: `${p.banka} — ${p.hesap}`,
    satirlar: [
      ['Eksi bakiye', `*${para(p.borc)}*`],
      ['Limit kullanımı', `%${doluluk}`],
      p.aylikFaiz > 0 ? ['Günlük faiz', para((p.borc * (p.aylikFaiz / 100)) / 30)] : null,
    ],
    aksiyon: 'Para girişi olduğunda önce burayı kapatın.',
    not: 'Ek hesap faizi genelde kart faizinden pahalıdır.',
    kritik: doluluk >= 80,
  });
}

export function limitUyarisi(p: { banka: string; kart: string; doluluk: number; kalanLimit: number }): Mesaj {
  return bicimle({
    anahtar: 'limit',
    baslik: 'Kart limiti dolmak üzere',
    kaynak: `${p.banka} — ${p.kart}`,
    satirlar: [
      ['Kullanım', `%${p.doluluk}`],
      ['Kalan limit', para(p.kalanLimit)],
    ],
    aksiyon: 'Limitin tamamen dolması kredi notunuzu olumsuz etkiler.',
    kritik: p.doluluk >= 95,
  });
}

/* ===================== AYLIK ===================== */

const AYLAR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

export function aylikOzet(p: {
  donem: string;
  gelir: number;
  gider: number;
  net: number;
  toplamBorc: number;
  kapasite: number;
  ilkAy: Array<{ ad: string; tutar: number }>;
  kapanisAy: number | null;
}): Mesaj {
  const [yil, ay] = p.donem.split('-');
  return bicimle({
    anahtar: 'aylik-ozet',
    baslik: `${AYLAR[Number(ay) - 1]} ${yil} özeti`,
    kaynak: 'Aylık bütçe raporu',
    satirlar: [
      ['Gelir', para(p.gelir)],
      ['Gider', para(p.gider)],
      ['Kalan', `*${para(p.net)}*`],
      ['Toplam borç', para(p.toplamBorc)],
      ['Borca ayrılabilir', para(p.kapasite)],
      ...(p.ilkAy.length
        ? (p.ilkAy.map((x) => [`• ${x.ad}`, para(x.tutar)]) as Array<[string, string]>)
        : ([['Borç', 'kayıt yok']] as Array<[string, string]>)),
    ],
    aksiyon: p.kapanisAy
      ? `Bu tempoda ${p.kapanisAy} ay sonra borçsuz olursunuz.`
      : 'Bu kapasiteyle borç kapanmıyor; ek gelir ya da gider kısıntısı gerekiyor.',
    not: 'Ayrıntı ve seçenekler için portaldaki Ödeme Planı ekranına bakın.',
  });
}

export function faizOraniDegisti(p: {
  eskiAkdi: number;
  yeniAkdi: number;
  eskiGecikme: number;
  yeniGecikme: number;
  kartSayisi: number;
  otomatikGuncellendi?: boolean;
}): Mesaj {
  return bicimle({
    anahtar: 'faiz-degisti',
    baslik: 'Kart faiz oranları değişti',
    kaynak: 'TCMB azami oran güncellemesi',
    satirlar: [
      ['Akdi faiz', `%${p.eskiAkdi} → *%${p.yeniAkdi}*`],
      ['Gecikme faizi', `%${p.eskiGecikme} → *%${p.yeniGecikme}*`],
      [p.otomatikGuncellendi ? 'Güncellenen kart' : 'Etkilenen kart', `${p.kartSayisi} adet`],
    ],
    aksiyon: p.otomatikGuncellendi
      ? 'Kartlarınızın oranı yeni değerle güncellendi; bir şey yapmanıza gerek yok.'
      : 'Portaldan tek tıkla güncelleyebilirsiniz.',
    not: 'Bankanız tavandan düşük oran uyguluyorsa kartın kendi oranını elle girin; otomatik güncellemeyi Ayarlar’dan kapatabilirsiniz.',
  });
}

/** WhatsApp'a gidecek nihai metin */
export function whatsappMetni(m: Mesaj): string {
  return `${m.kritik ? '🔴' : '💳'} ${m.govde}`;
}
