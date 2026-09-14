import {
  belgeOzetiKur,
  belgeSatiriKur,
  belgeTuruListesi,
  donemVaryantlari,
  hataSiniflandir,
  iletimEsle,
  likeKacis,
  sayfaBoyutuCoz,
  sayfaCoz,
  sgkBirlesikSatirKur,
  tebligDurumuHesapla,
  trTarihCevir,
  tutarCevir,
  type SayfaBelgeKaydi,
} from './belge-sayfa';

const GUN = 24 * 60 * 60 * 1000;

describe('hataSiniflandir — ham portal hatası → tür + kullanıcı metni', () => {
  it('"N denemede dogrulanamadi" (yeni runner metni) → sifre, N metne girer', () => {
    const ham = 'Vergi dairesi girisi 3 denemede dogrulanamadi — sifre buyuk olasilikla yanlis (her denemede yeni guvenlik kodu cozuldu): Giris dogrulanamadi: CAPTCHA cozulemedi veya portal sifreyi reddetti';
    const r = hataSiniflandir(ham);
    expect(r.tur).toBe('sifre');
    expect(r.metin).toBe('Şifre büyük olasılıkla yanlış — 3 denemede giriş doğrulanamadı');
    expect(r.ham).toBe(ham);
  });
  it('SGK "N denemede" metni de sifre', () => {
    const r = hataSiniflandir('SGK girisi 5 denemede dogrulanamadi — sifre buyuk olasilikla yanlis (her denemede yeni guvenlik kodu cozuldu): Giris dogrulanamadi: login formu hala gorunuyor');
    expect(r.tur).toBe('sifre');
    expect(r.metin).toContain('5 denemede');
  });
  it('"Portal sifresi reddedildi: <sebep>" → sifre, sebep metne eklenir', () => {
    const r = hataSiniflandir('Vergi dairesi girisi dogrulanamadi: Portal sifresi reddedildi: GIB giris hata mesaji algilandi');
    expect(r.tur).toBe('sifre');
    expect(r.metin).toBe('Şifre reddedildi: GIB giris hata mesaji algilandi');
  });
  it('Türkçe harfli "Şifre reddedildi" de yakalanır', () => {
    const r = hataSiniflandir('Şifre reddedildi: Kullanıcı adı veya şifre hatalı');
    expect(r.tur).toBe('sifre');
    expect(r.metin).toBe('Şifre reddedildi: Kullanıcı adı veya şifre hatalı');
  });
  it('tek denemelik "CAPTCHA cozulemedi veya portal sifreyi reddetti" → sifre, belirsiz metin', () => {
    const r = hataSiniflandir('Vergi dairesi girisi dogrulanamadi: Giris dogrulanamadi: CAPTCHA cozulemedi veya portal sifreyi reddetti');
    expect(r.tur).toBe('sifre');
    expect(r.metin).toBe('Giriş doğrulanamadı — şifre yanlış olabilir ya da güvenlik kodu çözülemedi; şifreyi kontrol edin');
  });
  it('2captcha bakiye/anahtar hatası → guvenlik_kodu (N denemede sarmalı içinde gelse bile)', () => {
    expect(hataSiniflandir('Vergi dairesi girisi dogrulanamadi: 2captcha res.php: ERROR_ZERO_BALANCE').tur).toBe('guvenlik_kodu');
    const sarmal = hataSiniflandir('SGK girisi 3 denemede dogrulanamadi — sifre buyuk olasilikla yanlis: 2captcha res.php: ERROR_ZERO_BALANCE');
    expect(sarmal.tur).toBe('guvenlik_kodu');
    expect(sarmal.metin).toBe('Güvenlik kodu çözülemedi (servis) — otomatik yeniden denenir');
  });
  it('TWOCAPTCHA_API_KEY yok / CAPTCHA otomatik cozulemedi / captcha zaman asimi → guvenlik_kodu', () => {
    expect(hataSiniflandir('TWOCAPTCHA_API_KEY env yok; SGK CAPTCHA cozulemez').tur).toBe('guvenlik_kodu');
    expect(hataSiniflandir('Giris dogrulanamadi: CAPTCHA otomatik cozulemedi').tur).toBe('guvenlik_kodu');
    expect(hataSiniflandir('2captcha zaman asimi (30 deneme)').tur).toBe('guvenlik_kodu');
    expect(hataSiniflandir('SGK girisi dogrulanamadi: 2captcha in.php: <!DOCTYPE html> <html>').tur).toBe('guvenlik_kodu');
    expect(hataSiniflandir('e-Beyanname login 5 denemede basarisiz. Son hata: 2captcha in.php: ERROR_ZERO_BALANCE').tur).toBe('guvenlik_kodu');
  });
  it('captcha bağlamı olmayan "zaman asimi" (runner hareketsizlik) güvenlik kodu DEĞİL → diger', () => {
    const r = hataSiniflandir('Railway runner hareketsizlik zaman asimi (45 dk)');
    expect(r.tur).toBe('diger');
    expect(r.metin).toBe('Railway runner hareketsizlik zaman asimi (45 dk)');
  });
  it('giriş alanı bulunamadı (sayfa yapısı) → diger; "N denemede basarisiz" şifre sayılmaz', () => {
    expect(hataSiniflandir('Vergi dairesi girisi dogrulanamadi: Kullanici kodu alani bulunamadi (userid); url=https://dijital.gib.gov.tr/portal').tur).toBe('diger');
    expect(hataSiniflandir('e-Beyanname login 5 denemede basarisiz. Son hata: Kullanici kodu alani bulunamadi (userid)').tur).toBe('diger');
  });
  it('timeout / net:: / ECONNRESET / 502 → baglanti', () => {
    expect(hataSiniflandir('page.goto: Timeout 45000ms exceeded').tur).toBe('baglanti');
    expect(hataSiniflandir('page.goto: net::ERR_CONNECTION_RESET at https://dijital.gib.gov.tr').tur).toBe('baglanti');
    expect(hataSiniflandir('connect ECONNREFUSED 1.2.3.4:443').tur).toBe('baglanti');
    const r = hataSiniflandir('HTTP 502 Bad Gateway');
    expect(r.tur).toBe('baglanti');
    expect(r.metin).toBe('Portala bağlanılamadı — otomatik yeniden denenir');
  });
  it('"1502" gibi sayılar bağlantı hatası sayılmaz; sınıflanamayan → diger, ham 200 karakter', () => {
    const uzun = 'Belge 1502 okunamadi ' + 'x'.repeat(300);
    const r = hataSiniflandir(uzun);
    expect(r.tur).toBe('diger');
    expect(r.metin).toHaveLength(200);
    expect(r.ham).toBe(uzun);
  });
  it('boş / null → diger, boş metin', () => {
    expect(hataSiniflandir(null)).toEqual({ tur: 'diger', metin: '', ham: '' });
    expect(hataSiniflandir('   ')).toEqual({ tur: 'diger', metin: '', ham: '' });
  });
  it('"login formu hala gorunuyor" (deneme bilgisi yok) → diger', () => {
    expect(hataSiniflandir('Vergi dairesi girisi dogrulanamadi: Giris dogrulanamadi: login formu hala gorunuyor').tur).toBe('diger');
  });
});

describe('tebligDurumuHesapla', () => {
  const now = new Date('2026-09-14T10:00:00Z');
  it('tebliğe 2 günden fazla var → bekliyor', () => {
    expect(tebligDurumuHesapla(new Date(now.getTime() + 3 * GUN), now)).toBe('bekliyor');
  });
  it('tebliğe ≤2 gün → yaklasiyor (tam sınır dahil)', () => {
    expect(tebligDurumuHesapla(new Date(now.getTime() + 2 * GUN), now)).toBe('yaklasiyor');
    expect(tebligDurumuHesapla(new Date(now.getTime() + 1), now)).toBe('yaklasiyor');
  });
  it('tebliğ zamanı geldi/geçti → edildi', () => {
    expect(tebligDurumuHesapla(now, now)).toBe('edildi');
    expect(tebligDurumuHesapla(new Date(now.getTime() - GUN), now)).toBe('edildi');
  });
  it('tarih yok → null', () => {
    expect(tebligDurumuHesapla(null, now)).toBeNull();
  });
});

describe('trTarihCevir / tutarCevir', () => {
  it('dd/MM/yyyy HH:mm:ss Türkiye saati (+03:00) olarak çevrilir', () => {
    expect(trTarihCevir('18/09/2026 17:30:00')?.toISOString()).toBe('2026-09-18T14:30:00.000Z');
    expect(trTarihCevir('5.9.2026')?.toISOString()).toBe('2026-09-04T21:00:00.000Z');
    expect(trTarihCevir('')).toBeNull();
    expect(trTarihCevir('abc')).toBeNull();
  });
  it('Türkçe para biçimi → sayı', () => {
    expect(tutarCevir('690,09')).toBe(690.09);
    expect(tutarCevir('12.799,13')).toBe(12799.13);
    expect(tutarCevir('24.277')).toBe(24277);
    expect(tutarCevir('690.09')).toBe(690.09);
    expect(tutarCevir(15.5)).toBe(15.5);
    expect(tutarCevir('')).toBeNull();
    expect(tutarCevir('yok')).toBeNull();
  });
});

describe('belgeOzetiKur — raw yanıta girmez, özet çıkar', () => {
  const now = new Date('2026-09-14T10:00:00Z');
  it('E_TEBLIGAT: receivedAt tebliğ tarihi; durum şimdiye göre', () => {
    const raw = { kurumAciklama: 'GELİR İDARESİ BAŞKANLIĞI', altKurum: 'ANKARA VD', gonderimZamani: '13/09/2026 12:00:38', tebligZamani: '18/09/2026 17:30:00', mukellefOkumaZamani: null, tebligId: 'gizli' };
    const o = belgeOzetiKur('E_TEBLIGAT', raw, new Date('2026-09-18T14:30:00Z'), now);
    expect(o).toEqual({
      kurumAciklama: 'GELİR İDARESİ BAŞKANLIĞI',
      altKurum: 'ANKARA VD',
      gonderimZamani: '13/09/2026 12:00:38',
      tebligZamani: '18/09/2026 17:30:00',
      okumaZamani: null,
      tebligTarihi: '2026-09-18T14:30:00.000Z',
      tebligDurumu: 'bekliyor',
    });
    expect((o as any).tebligId).toBeUndefined();
  });
  it('E_TEBLIGAT: receivedAt yoksa tebligZamani metninden çevrilir', () => {
    const o = belgeOzetiKur('E_TEBLIGAT', { tebligZamani: '15/09/2026 09:00:00' }, null, now);
    expect(o.tebligTarihi).toBe('2026-09-15T06:00:00.000Z');
    expect(o.tebligDurumu).toBe('yaklasiyor');
  });
  it('SGK: tutar yalnız tahakkukta; hizmet listesinde boş', () => {
    const raw = { donem: '2024/05', tutar: '690,09', calisan: '1', kanunNo: '05510', belgeMahiyeti: 'ASIL' };
    expect(belgeOzetiKur('SGK_TAHAKKUK', raw, null, now)).toEqual({ kanunNo: '05510', calisan: 1, tutar: 690.09, mahiyet: 'ASIL' });
    expect(belgeOzetiKur('SGK_HIZMET_LISTESI', raw, null, now).tutar).toBeNull();
  });
});

describe('iletimEsle — docRefs içeren gönderimler, kanal başına en yenisi', () => {
  const g = (channel: string, status: string, createdAt: string, docRefs: any, ek: Partial<{ error: string | null; testMode: boolean; sentAt: string | null }> = {}) => ({
    channel, status, createdAt: new Date(createdAt), docRefs, error: ek.error ?? null, testMode: ek.testMode ?? false, sentAt: ek.sentAt ? new Date(ek.sentAt) : null,
  });
  it('aynı kanaldan iki gönderim → yalnız en yenisi; farklı kanal ayrı; en yeni önce', () => {
    const r = iletimEsle(['d1'], [
      g('WHATSAPP', 'FAILED', '2026-09-01T10:00:00Z', ['d1'], { error: 'telefon yok' }),
      g('EMAIL', 'SENT', '2026-09-02T10:00:00Z', ['d1', 'd9'], { sentAt: '2026-09-02T10:00:01Z' }),
      g('WHATSAPP', 'SENT', '2026-09-03T10:00:00Z', ['d1'], { sentAt: '2026-09-03T10:00:01Z', testMode: true }),
      g('WHATSAPP', 'SENT', '2026-09-04T10:00:00Z', ['baska'], { sentAt: '2026-09-04T10:00:01Z' }),
    ]);
    expect(r).toEqual([
      { channel: 'WHATSAPP', status: 'SENT', sentAt: '2026-09-03T10:00:01.000Z', error: null, testMode: true },
      { channel: 'EMAIL', status: 'SENT', sentAt: '2026-09-02T10:00:01.000Z', error: null, testMode: false },
    ]);
  });
  it('docRefs dizi değilse / eşleşme yoksa boş', () => {
    expect(iletimEsle(['d1'], [g('EMAIL', 'SENT', '2026-09-02T10:00:00Z', null)])).toEqual([]);
    expect(iletimEsle([], [g('EMAIL', 'SENT', '2026-09-02T10:00:00Z', ['d1'])])).toEqual([]);
  });
});

describe('sgkBirlesikSatirKur — tahakkuk + hizmet tek satır', () => {
  const now = new Date('2026-09-14T10:00:00Z');
  const belge = (ek: Partial<SayfaBelgeKaydi>): SayfaBelgeKaydi => ({
    id: 'x', taxpayerId: 'tp1', belgeTuru: 'SGK_TAHAKKUK', title: 'SGK Tahakkuk Fişi', referenceNo: '70605-2024-5', period: '2024/05',
    issuedAt: null, receivedAt: new Date('2026-09-10T00:00:00Z'), createdAt: new Date('2026-09-10T00:00:00Z'), storageKey: 'k', viewedAt: null,
    raw: { donem: '2024/05', tutar: '690,09', calisan: '1', kanunNo: '05510', belgeMahiyeti: 'ASIL' },
    taxpayer: { id: 'tp1', companyName: 'ABC LTD', firstName: null, lastName: null, taxNumber: '1234567890' },
    ...ek,
  });
  it('id tahakkuktan, tutar tahakkuktan, hizmet alt nesnesi dolu, raw yanıtta yok', () => {
    const r = sgkBirlesikSatirKur([
      belge({ id: 'hiz', belgeTuru: 'SGK_HIZMET_LISTESI', title: 'SGK Hizmet Listesi', storageKey: null, viewedAt: new Date('2026-09-11T00:00:00Z') }),
      belge({ id: 'tah' }),
    ], now)!;
    expect(r.id).toBe('tah');
    expect(r.belgeTuru).toBe('SGK_TAHAKKUK');
    expect(r.ozet).toEqual({ kanunNo: '05510', calisan: 1, tutar: 690.09, mahiyet: 'ASIL' });
    expect(r.tahakkuk).toEqual({ id: 'tah', pdfVar: true, viewedAt: null, tutar: 690.09 });
    expect(r.hizmet).toEqual({ id: 'hiz', pdfVar: false, viewedAt: '2026-09-11T00:00:00.000Z' });
    expect(r.taxpayer?.companyName).toBe('ABC LTD');
    expect((r as any).raw).toBeUndefined();
  });
  it('yalnız hizmet varsa id hizmetten, tahakkuk null, tutar null', () => {
    const r = sgkBirlesikSatirKur([belge({ id: 'hiz', belgeTuru: 'SGK_HIZMET_LISTESI' })], now)!;
    expect(r.id).toBe('hiz');
    expect(r.tahakkuk).toBeNull();
    expect(r.hizmet?.id).toBe('hiz');
    expect(r.ozet.tutar).toBeNull();
  });
  it('boş liste → null', () => {
    expect(sgkBirlesikSatirKur([], now)).toBeNull();
  });
});

describe('sorgu parametreleri', () => {
  it('pageSize: 25/50/100 geçerli; 100<n≤1000 dışa aktarım; diğerleri 50', () => {
    expect(sayfaBoyutuCoz('25')).toBe(25);
    expect(sayfaBoyutuCoz(100)).toBe(100);
    expect(sayfaBoyutuCoz('1000')).toBe(1000);
    expect(sayfaBoyutuCoz(500)).toBe(500);
    expect(sayfaBoyutuCoz('30')).toBe(50);
    expect(sayfaBoyutuCoz('1001')).toBe(50);
    expect(sayfaBoyutuCoz(undefined)).toBe(50);
    expect(sayfaBoyutuCoz('abc')).toBe(50);
  });
  it('page: 1 ve üstü; bozuk → 1', () => {
    expect(sayfaCoz('3')).toBe(3);
    expect(sayfaCoz('0')).toBe(1);
    expect(sayfaCoz(undefined)).toBe(1);
  });
  it('belgeTuru virgülle çoklu, büyük harf, tekil', () => {
    expect(belgeTuruListesi('sgk_tahakkuk, SGK_HIZMET_LISTESI,SGK_TAHAKKUK')).toEqual(['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI']);
    expect(belgeTuruListesi('')).toEqual([]);
  });
  it('dönem YYYY-MM / YYYY/MM her iki yazımı da üretir', () => {
    expect(donemVaryantlari('2024-05')).toEqual(['2024/05', '2024-05']);
    expect(donemVaryantlari('2024/5')).toEqual(['2024/05', '2024-05']);
    expect(donemVaryantlari('')).toEqual([]);
  });
  it('likeKacis joker karakterleri kaçırır', () => {
    expect(likeKacis('a%b_c')).toBe('a\\%b\\_c');
  });
});

describe('belgeSatiriKur — tek belge satırı', () => {
  it('pdfVar storageKey ile; tarihler ISO; raw yok', () => {
    const r = belgeSatiriKur({
      id: 'd1', taxpayerId: 'tp1', belgeTuru: 'E_TEBLIGAT', title: 'Tebligat', referenceNo: 'BN-1', period: '2026-09',
      issuedAt: new Date('2026-09-13T09:00:38Z'), receivedAt: new Date('2026-09-18T14:30:00Z'), createdAt: new Date('2026-09-13T20:00:00Z'),
      storageKey: null, viewedAt: null, raw: { kurumAciklama: 'GİB', tebligZamani: '18/09/2026 17:30:00' }, taxpayer: null,
    }, new Date('2026-09-14T10:00:00Z'));
    expect(r.pdfVar).toBe(false);
    expect(r.issuedAt).toBe('2026-09-13T09:00:38.000Z');
    expect(r.ozet.tebligDurumu).toBe('bekliyor');
    expect(r.iletim).toEqual([]);
    expect((r as any).raw).toBeUndefined();
  });
});
