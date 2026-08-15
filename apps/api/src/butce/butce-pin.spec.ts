import * as crypto from 'crypto';
import { ButcePinService } from './butce-pin.service';

/**
 * PIN biletinin SAF mantığı — veritabanı yok, argon2 çağrısı yok.
 *
 * Buradaki testlerin kıymeti şu: bilet, kişisel finans modülünün tek kapısı.
 * Sessizce gevşerse (süre dolmuşu kabul etmek, PIN değişince eski bileti
 * kabul etmeye devam etmek, sürümsüz eski biçimi geçirmek) kimse fark etmez;
 * kapı açık kalır. Bu yüzden her gevşeme biçimi ayrı ayrı kilitleniyor.
 */

const GIZLI = 'test-gizli-anahtar::butce-pin';
const KULLANICI = 'kullanici-1';

/** Gerçek argon2id çıktısının biçimi — baştaki başlık her PIN'de aynıdır. */
const hashUret = (tuz: string, ozet: string) =>
  `$argon2id$v=19$m=65536,t=3,p=4$${tuz}$${ozet}`;

const HASH_A = hashUret('DUppMdejavlpneyej1A', '5GtTRKWKUoDcWuebPtnOhkWGjQMZ7x86u8ipEzsrU');
const HASH_B = hashUret('QcoLjYsJAOuX7VZryN7', 'WWyAWoFRIbY5xfMOUtxMJE5koXzLaMS90Nbfl7ElQ');

describe('butce-pin — PIN sürümü', () => {
  it('farklı PIN özetleri farklı sürüm verir (argon2 başlığı tuzağı)', () => {
    // İki özet de "$argon2id$v=19$m" ile başlar; sürüm baştan kesilseydi eşit
    // çıkardı ve "PIN değişti" hiç anlaşılmazdı.
    expect(HASH_A.slice(0, 16)).toBe(HASH_B.slice(0, 16));
    expect(ButcePinService.pinSurumu(HASH_A)).not.toBe(ButcePinService.pinSurumu(HASH_B));
  });

  it('aynı özet için sürüm sabit ve 16 hanelik hex', () => {
    const s = ButcePinService.pinSurumu(HASH_A);
    expect(s).toBe(ButcePinService.pinSurumu(HASH_A));
    expect(s).toMatch(/^[0-9a-f]{16}$/);
  });

  it('özet yoksa patlamaz', () => {
    expect(ButcePinService.pinSurumu(null)).toMatch(/^[0-9a-f]{16}$/);
    expect(ButcePinService.pinSurumu(undefined)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('butce-pin — bilet üret / doğrula', () => {
  it('üretilen bilet doğrulanır ve üç parçalıdır', () => {
    const { bilet, bitis } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    expect(bilet.split('.')).toHaveLength(3);
    expect(bilet.split('.')[1]).toBe(ButcePinService.pinSurumu(HASH_A));
    expect(bitis).toBeGreaterThan(Date.now());
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, bilet, GIZLI)).toBe(true);
  });

  it('bilet 60 dakika sonra biter', () => {
    const simdi = 1_700_000_000_000;
    const { bitis } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI, simdi);
    expect(bitis - simdi).toBe(60 * 60 * 1000);
  });

  it('başka kullanıcının bileti kabul edilmez', () => {
    const { bilet } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    expect(ButcePinService.biletDogrula('baska-kullanici', HASH_A, bilet, GIZLI)).toBe(false);
  });

  it('imza oynanmışsa kabul edilmez', () => {
    const { bilet } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    const [bitis, surum, imza] = bilet.split('.');
    const bozuk = `${bitis}.${surum}.${imza.slice(0, -1)}${imza.endsWith('a') ? 'b' : 'a'}`;
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, bozuk, GIZLI)).toBe(false);
  });

  it('bitiş ileri çekilirse imza tutmaz', () => {
    const { bilet } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    const [, surum, imza] = bilet.split('.');
    const uzatilmis = `${Date.now() + 999 * 60 * 1000}.${surum}.${imza}`;
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, uzatilmis, GIZLI)).toBe(false);
  });

  it('başka gizli anahtarla üretilmiş bilet kabul edilmez', () => {
    const { bilet } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, bilet, 'baska-gizli')).toBe(false);
  });

  it('boş / bozuk girdilerde false döner, hata fırlatmaz', () => {
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, '', GIZLI)).toBe(false);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, undefined, GIZLI)).toBe(false);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, 'saçma', GIZLI)).toBe(false);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, 'a.b.c', GIZLI)).toBe(false);
    expect(ButcePinService.biletDogrula('', HASH_A, 'a.b.c', GIZLI)).toBe(false);
  });

  it('PIN kurulu değilse (özet yok) hiçbir bilet geçmez', () => {
    const { bilet } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    expect(ButcePinService.biletDogrula(KULLANICI, null, bilet, GIZLI)).toBe(false);
    expect(ButcePinService.biletDogrula(KULLANICI, '', bilet, GIZLI)).toBe(false);
  });
});

describe('butce-pin — süre dolması', () => {
  it('süresi dolmuş bilet reddedilir', () => {
    const simdi = 1_700_000_000_000;
    const { bilet, bitis } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI, simdi);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, bilet, GIZLI, bitis)).toBe(true);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, bilet, GIZLI, bitis + 1)).toBe(false);
  });

  it('bir saat önce üretilmiş bilet şu an geçersizdir', () => {
    const { bilet } = ButcePinService.biletOlustur(
      KULLANICI,
      HASH_A,
      GIZLI,
      Date.now() - 61 * 60 * 1000,
    );
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, bilet, GIZLI)).toBe(false);
  });
});

describe('butce-pin — PIN değişince eski bilet düşer', () => {
  it('PIN değiştikten sonra eski bilet geçersiz, yenisi geçerli', () => {
    const eski = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI).bilet;
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, eski, GIZLI)).toBe(true);

    // Kullanıcı PIN'ini değiştirdi → kayıttaki özet artık HASH_B.
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_B, eski, GIZLI)).toBe(false);

    const yeni = ButcePinService.biletOlustur(KULLANICI, HASH_B, GIZLI).bilet;
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_B, yeni, GIZLI)).toBe(true);
  });

  it('sürüm alanı elle değiştirilirse imza tutmaz', () => {
    const { bilet } = ButcePinService.biletOlustur(KULLANICI, HASH_A, GIZLI);
    const [bitis, , imza] = bilet.split('.');
    const sahte = `${bitis}.${ButcePinService.pinSurumu(HASH_B)}.${imza}`;
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_B, sahte, GIZLI)).toBe(false);
  });
});

describe('butce-pin — eski biçimli bilet reddi', () => {
  /** Sürüm eklenmeden önceki biçim: "<bitis>.<imza>", imza userId.bitis üzerinden. */
  const eskiBiletUret = (userId: string, bitis: number) => {
    const imza = crypto.createHmac('sha256', GIZLI).update(`${userId}.${bitis}`).digest('hex');
    return `${bitis}.${imza}`;
  };

  it('imzası doğru olsa ve süresi dolmasa bile iki parçalı bilet reddedilir', () => {
    const bitis = Date.now() + 30 * 60 * 1000;
    const eski = eskiBiletUret(KULLANICI, bitis);
    expect(eski.split('.')).toHaveLength(2);
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, eski, GIZLI)).toBe(false);
  });

  it('eski bilete rastgele bir sürüm eklenerek üç parçaya çevrilemez', () => {
    const bitis = Date.now() + 30 * 60 * 1000;
    const imza = crypto.createHmac('sha256', GIZLI).update(`${KULLANICI}.${bitis}`).digest('hex');
    const uydurma = `${bitis}.${ButcePinService.pinSurumu(HASH_A)}.${imza}`;
    expect(ButcePinService.biletDogrula(KULLANICI, HASH_A, uydurma, GIZLI)).toBe(false);
  });
});

describe('butce-pin — ayar kaydından PIN alanlarını ayıklama', () => {
  it('pinHash, pinDenemeSayisi ve pinKilitBitis dışarı çıkmaz', () => {
    const ayar = {
      id: 'a1',
      tenantId: 't1',
      userId: 'u1',
      nakitYastigi: 1000,
      strateji: 'CIG',
      pinHash: HASH_A,
      pinDenemeSayisi: 3,
      pinKilitBitis: new Date(),
    };
    const temiz: any = ButcePinService.pinAlanlariniAyikla(ayar);
    expect(temiz).not.toHaveProperty('pinHash');
    expect(temiz).not.toHaveProperty('pinDenemeSayisi');
    expect(temiz).not.toHaveProperty('pinKilitBitis');
    // Geri kalan ayarlar olduğu gibi durmalı
    expect(temiz.id).toBe('a1');
    expect(temiz.nakitYastigi).toBe(1000);
    expect(temiz.strateji).toBe('CIG');
    // Özgün nesne bozulmamalı (çağıran hâlâ hash'e ihtiyaç duyabilir)
    expect(ayar.pinHash).toBe(HASH_A);
  });

  it('null/undefined ve nesne olmayan girdide patlamaz', () => {
    expect(ButcePinService.pinAlanlariniAyikla(null as any)).toBeNull();
    expect(ButcePinService.pinAlanlariniAyikla(undefined as any)).toBeUndefined();
    expect(ButcePinService.pinAlanlariniAyikla('metin' as any)).toBe('metin');
  });
});
