/**
 * TAHSİLAT OTOMASYONU — saf karar katmanı.
 *
 * Ofis sahibinin talebi: "mükelleflerle mümkün olduğunca tahsilat için minimum
 * görüşmek istiyorum". Yani hatırlatma zinciri insan müdahalesi olmadan
 * yürümeli, sahip yalnız istisnalarla ilgilenmeli.
 *
 * Bu dosyada AĞ YOK, VERİTABANI YOK — yalnız kural ve metin. Böylece davranış
 * test edilebilir ve "kime neden mesaj gitti/gitmedi" sorusu tek yerden
 * cevaplanır.
 */

export type Kademe = 'K0' | 'K1' | 'K2' | 'K3' | 'ELLE';

/** Kademe eşikleri — en eski açık borcun gecikme günü */
export const KADEME_ESIK: Record<Exclude<Kademe, 'ELLE'>, number> = {
  K0: 0, // vadesi bugün gelmiş, henüz gecikmemiş
  K1: 7,
  K2: 30,
  K3: 60,
};

/** 90 günden sonra bot susar; iş sahibin elindedir */
export const ELLE_ESIK = 90;

export interface TahsilatAdayi {
  taxpayerId: string;
  ad: string;
  phone?: string | null;
  /** Açık bakiye (pozitif = borçlu) */
  bakiye: number;
  /** En eski açık borcun kaç gündür beklediği */
  gecikmeGun: number;
  /** Aylık müşavirlik ücreti — önemlilik eşiği için */
  aylikUcret?: number | null;
  sonTahsilatTarihi?: Date | string | null;
  /** En son tahsilat teması (hangi kademeden olursa olsun) */
  sonTemasTarihi?: Date | string | null;
  /** Bu mükellefe en son gönderilen kademe */
  sonKademe?: Kademe | null;
  /** Mükelleften son gelen mesaj — konuşma sürüyorsa bot araya girmez */
  sonGelenMesajTarihi?: Date | string | null;
  /** Susturma bitiş tarihi (varsa) */
  susturmaBitis?: Date | string | null;
  susturmaSebebi?: string | null;
  /** Mükellef işi bırakmış — kapanış mutabakatı kulvarına gider */
  isiBirakti?: boolean;
  aktif?: boolean;
}

export interface OtomasyonAyari {
  /** Kapalıyken hiçbir mesaj gitmez (güvenli varsayılan) */
  enabled: boolean;
  /** Açıkken bütün mesajlar test numarasına gider */
  testMode: boolean;
  testPhone?: string | null;
  /** Kalıcı olarak otomasyon dışı bırakılan mükellefler */
  haricTutulan?: string[];
  /** Günlük en fazla kaç mesaj (WhatsApp hattı korunur) */
  gunlukTavan?: number;
  /** Aynı mükellefe iki temas arasındaki en az gün */
  beklemeGun?: number;
  /** Bu tutarın altındaki bakiyeye mesaj gönderilmez */
  asgariBakiye?: number;
  /** Ofis/gönderen adı — mesajların altına yazılır */
  ofisAdi?: string;
}

export const VARSAYILAN_AYAR: Required<
  Pick<OtomasyonAyari, 'gunlukTavan' | 'beklemeGun' | 'asgariBakiye' | 'ofisAdi'>
> = {
  gunlukTavan: 20,
  beklemeGun: 14,
  asgariBakiye: 250,
  ofisAdi: 'Moren Mali Müşavirlik',
};

export interface KademeKarari {
  taxpayerId: string;
  ad: string;
  kademe: Kademe | null;
  gonderilebilir: boolean;
  /** Gönderilemiyorsa sebebi — ekranda gösterilir, sessiz atlama olmaz */
  sebep: string | null;
  /** Sahibin onayı gerekiyor mu (K3 ve üstü) */
  onayGerekli: boolean;
  mesaj: string | null;
  /** Ekstre PDF eklenmeli mi (K2) */
  ekstreEkle: boolean;
}

const gun = (d?: Date | string | null): Date | null => {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
};

const gunFarki = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);

export const paraTR = (n: number) =>
  `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;

const tarihTR = (d: Date) =>
  d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Gecikme gününe göre kademe. Kademe ATLANMAZ: 60 gün gecikmiş ama hiç
 * hatırlatma gitmemiş bir mükellefe önce K1 gider (yeni devralınan borç,
 * yeni müşteri senaryosu). Böylece ilk temas "görüşme çağrısı" olmaz.
 */
export function kademeBelirle(gecikmeGun: number, sonKademe?: Kademe | null): Kademe {
  const hedef: Kademe =
    gecikmeGun >= ELLE_ESIK
      ? 'ELLE'
      : gecikmeGun >= KADEME_ESIK.K3
        ? 'K3'
        : gecikmeGun >= KADEME_ESIK.K2
          ? 'K2'
          : gecikmeGun >= KADEME_ESIK.K1
            ? 'K1'
            : 'K0';

  if (hedef === 'ELLE') return 'ELLE';

  const sira: Kademe[] = ['K0', 'K1', 'K2', 'K3'];
  const hedefIdx = sira.indexOf(hedef);
  const oncekiIdx = sonKademe ? sira.indexOf(sonKademe) : -1;
  // Bir sonraki kademeye geç; hedefi aşma
  const yeniIdx = Math.min(oncekiIdx + 1, hedefIdx);
  return sira[Math.max(yeniIdx, 0)];
}

/**
 * Kademe metinleri — is yazismasi tonu: kisa, net, bilgi odakli.
 * Gevsetici kaliplar ve "dikkate almayiniz / dekont iletiniz" gibi
 * hatirlatmayi gecersiz kilan ifadeler bilincli olarak yok.
 */
export function kademeMesaji(
  kademe: Kademe,
  p: { ad: string; bakiye: number; gecikmeGun: number; ofisAdi: string; sonTahsilat?: Date | null },
): string {
  const tutar = paraTR(p.bakiye);
  const imza = `\n\n${p.ofisAdi}`;

  switch (kademe) {
    case 'K0':
      return (
        `Sayın ${p.ad},\n\n` +
        `Cari hesabınızdaki açık bakiye: *${tutar}*\n\n` +
        `Ödemenizi bekliyoruz.` +
        imza
      );

    case 'K1':
      return (
        `Sayın ${p.ad},\n\n` +
        `Cari hesabınızdaki *${tutar}* tutarındaki bakiye için ödeme kaydı bulunmuyor.\n\n` +
        `Ödeme planınızı bize iletebilirsiniz.` +
        imza
      );

    case 'K2':
      return (
        `Sayın ${p.ad},\n\n` +
        `Cari hesabınızda *${tutar}* tutarında, ${p.gecikmeGun} gündür bekleyen bakiye bulunuyor. ` +
        `Hesap dökümünüz ektedir.\n\n` +
        `Dökümde uyuşmazlık varsa bildirin; yoksa ödemenizi bekliyoruz.` +
        imza
      );

    case 'K3':
      return (
        `Sayın ${p.ad},\n\n` +
        `Cari hesabınızdaki *${tutar}* tutarındaki bakiye ${p.gecikmeGun} gündür açık ve ` +
        `hatırlatmalarımıza dönüş alamadık.\n\n` +
        `Konuyu görüşmek üzere size uygun bir zaman bildirmenizi bekliyoruz. ` +
        `Ödeme planı yapılabilir.` +
        imza
      );

    default:
      return '';
  }
}

/**
 * Bir mükellef için karar. Sıra önemlidir: en kesin engeller önce.
 * Hiçbir eleme sessiz değildir — her atlamanın okunur bir sebebi vardır.
 */
export function kademeKarari(
  a: TahsilatAdayi,
  ayar: OtomasyonAyari,
  bugun: Date = new Date(),
): KademeKarari {
  const ofisAdi = ayar.ofisAdi || VARSAYILAN_AYAR.ofisAdi;
  const bos = (sebep: string): KademeKarari => ({
    taxpayerId: a.taxpayerId,
    ad: a.ad,
    kademe: null,
    gonderilebilir: false,
    sebep,
    onayGerekli: false,
    mesaj: null,
    ekstreEkle: false,
  });

  if (!ayar.enabled) return bos('Otomasyon kapalı');
  if (a.aktif === false) return bos('Mükellef pasif');
  if (a.isiBirakti) return bos('İşi bırakmış — kapanış mutabakatı gerekiyor');
  if ((ayar.haricTutulan || []).includes(a.taxpayerId)) return bos('Otomasyon dışı bırakılmış');

  const susturma = gun(a.susturmaBitis);
  if (susturma && susturma > bugun) {
    const sebepMetni = a.susturmaSebebi ? ` (${a.susturmaSebebi})` : '';
    return bos(`${tarihTR(susturma)} tarihine kadar susturulmuş${sebepMetni}`);
  }

  if (!a.phone) return bos('Telefon kayıtlı değil');
  if (a.bakiye <= 0) return bos('Açık bakiye yok');

  // Önemlilik eşiği: FIFO artığı küçük bakiyeye "90 gün gecikti" mesajı gitmesin
  const asgari = Math.max(
    ayar.asgariBakiye ?? VARSAYILAN_AYAR.asgariBakiye,
    (a.aylikUcret || 0) * 0.5,
  );
  if (a.bakiye < asgari) return bos(`Bakiye önemlilik eşiğinin altında (${paraTR(asgari)})`);

  // Mükelleften son 7 günde mesaj geldiyse konuşma sürüyordur; bot araya girmez
  const gelen = gun(a.sonGelenMesajTarihi);
  if (gelen && gunFarki(bugun, gelen) < 7) return bos('Mükellefle görüşme sürüyor');

  // Ödeme sinyali: son tahsilat son temastan yeniyse sıra başa döner
  const sonTahsilat = gun(a.sonTahsilatTarihi);
  const sonTemas = gun(a.sonTemasTarihi);
  if (sonTahsilat && sonTemas && sonTahsilat > sonTemas && gunFarki(bugun, sonTahsilat) < 7) {
    return bos('Yakın zamanda ödeme alınmış');
  }

  // Bekleme: aynı mükellefe çok sık yazılmaz
  const bekleme = ayar.beklemeGun ?? VARSAYILAN_AYAR.beklemeGun;
  if (sonTemas && gunFarki(bugun, sonTemas) < bekleme) {
    return bos(`Son hatırlatmadan ${gunFarki(bugun, sonTemas)} gün geçti (en az ${bekleme} gün)`);
  }

  const kademe = kademeBelirle(a.gecikmeGun, a.sonKademe);

  if (kademe === 'ELLE') {
    return {
      taxpayerId: a.taxpayerId,
      ad: a.ad,
      kademe: 'ELLE',
      gonderilebilir: false,
      sebep: `${a.gecikmeGun} gün — otomatik mesaj durdu, elle görüşülmeli`,
      onayGerekli: false,
      mesaj: null,
      ekstreEkle: false,
    };
  }

  return {
    taxpayerId: a.taxpayerId,
    ad: a.ad,
    kademe,
    gonderilebilir: true,
    sebep: null,
    // K3 "görüşme çağrısı" — ilişki hassas, sahip görmeden gitmez
    onayGerekli: kademe === 'K3',
    mesaj: kademeMesaji(kademe, {
      ad: a.ad,
      bakiye: a.bakiye,
      gecikmeGun: a.gecikmeGun,
      ofisAdi,
      sonTahsilat,
    }),
    ekstreEkle: kademe === 'K2',
  };
}

/**
 * Günlük gönderim listesi. Tavan aşılırsa EN RİSKLİ olanlar öne alınır;
 * kalanlar sessizce düşmez, "yarına kaldı" olarak raporlanır.
 */
export function gunlukPlan(
  adaylar: TahsilatAdayi[],
  ayar: OtomasyonAyari,
  bugun: Date = new Date(),
): {
  gonderilecek: KademeKarari[];
  onayBekleyen: KademeKarari[];
  elleGorusulecek: KademeKarari[];
  atlanan: KademeKarari[];
  yarinaKalan: KademeKarari[];
} {
  const kararlar = adaylar.map((a) => kademeKarari(a, ayar, bugun));

  const onayBekleyen = kararlar.filter((k) => k.gonderilebilir && k.onayGerekli);
  const elleGorusulecek = kararlar.filter((k) => k.kademe === 'ELLE');
  const atlanan = kararlar.filter((k) => !k.gonderilebilir && k.kademe !== 'ELLE');

  const otomatik = kararlar.filter((k) => k.gonderilebilir && !k.onayGerekli);
  // Riskli olan önce: yüksek kademe, sonra büyük bakiye
  const sira: Record<string, number> = { K3: 3, K2: 2, K1: 1, K0: 0 };
  const bakiyeHarita = new Map(adaylar.map((a) => [a.taxpayerId, a.bakiye]));
  otomatik.sort(
    (x, y) =>
      (sira[y.kademe || 'K0'] || 0) - (sira[x.kademe || 'K0'] || 0) ||
      (bakiyeHarita.get(y.taxpayerId) || 0) - (bakiyeHarita.get(x.taxpayerId) || 0),
  );

  const tavan = ayar.gunlukTavan ?? VARSAYILAN_AYAR.gunlukTavan;
  return {
    gonderilecek: otomatik.slice(0, tavan),
    yarinaKalan: otomatik.slice(tavan),
    onayBekleyen,
    elleGorusulecek,
    atlanan,
  };
}
