/**
 * Beyanname İndirme — sayfalı liste yardımcıları (sözleşme §4) davranış kilidi.
 *
 *  1. Dönem aralığı: aylık kayıtlar string karşılaştırmasıyla, yıllık ("YYYY-YIL") kayıtlar YIL olarak
 *     süzülür. Yanlış kurulursa yıllık beyannameler (KURUMLAR, GELIR) aralıktan sessizce düşer.
 *  2. İletim haritası: docRefs bu kaydı içeren gönderimlerden KANAL BAŞINA en yenisi, en yeni önce.
 *     Web `iletim[0]`'ı rozet olarak gösterir; sıra bozulursa eski hata yeni başarının üstünü örter.
 *  3. iletim süzgeci: iletildi / iletilmedi / hata id kümeleri.
 */
import {
  donemAraligiWhere,
  donemCoz,
  iletimHaritasiKur,
  iletimSuzgecIdleri,
  sayfaBoyutuNormalize,
  sayfaNoNormalize,
} from './beyan-sayfa';

describe('sayfaBoyutuNormalize / sayfaNoNormalize', () => {
  it('25/50/100 aynen; başka küçük değer → 50; 101..1000 dışa aktarım; 1000 üstü tavana çekilir', () => {
    expect(sayfaBoyutuNormalize('25')).toBe(25);
    expect(sayfaBoyutuNormalize(100)).toBe(100);
    expect(sayfaBoyutuNormalize('30')).toBe(50);
    expect(sayfaBoyutuNormalize(undefined)).toBe(50);
    expect(sayfaBoyutuNormalize('abc')).toBe(50);
    expect(sayfaBoyutuNormalize(500)).toBe(500);
    expect(sayfaBoyutuNormalize(5000)).toBe(1000);
    expect(sayfaNoNormalize('0')).toBe(1);
    expect(sayfaNoNormalize('x')).toBe(1);
    expect(sayfaNoNormalize('3')).toBe(3);
  });
});

describe('donemAraligiWhere — dönem aralığı', () => {
  it('donemCoz: YYYY-MM, YYYY/M ve yalnız yıl tanınır; bozuk değer null', () => {
    expect(donemCoz('2026-03')).toEqual({ yil: 2026, ay: 3, donem: '2026-03' });
    expect(donemCoz('2026/3')).toEqual({ yil: 2026, ay: 3, donem: '2026-03' });
    expect(donemCoz('2025')).toEqual({ yil: 2025, ay: null, donem: '2025' });
    expect(donemCoz('2026-13')).toBeNull();
    expect(donemCoz('ocak')).toBeNull();
    expect(donemCoz('')).toBeNull();
  });

  it('iki uç: aylıklar gte/lte, yıllık kayıtlar aralıktaki her yıl için "YYYY-YIL" ile alınır', () => {
    expect(donemAraligiWhere('2025-03', '2026-05')).toEqual({
      OR: [
        { donem: { gte: '2025-03', lte: '2026-05' } },
        { donem: { in: ['2025-YIL', '2026-YIL'] } },
      ],
    });
  });

  it('aynı yıl içinde tek yıllık dönem; uçlar ters verilirse yer değiştirir', () => {
    expect(donemAraligiWhere('2026-01', '2026-12')).toEqual({
      OR: [{ donem: { gte: '2026-01', lte: '2026-12' } }, { donem: { in: ['2026-YIL'] } }],
    });
    expect(donemAraligiWhere('2026-06', '2026-02')).toEqual({
      OR: [{ donem: { gte: '2026-02', lte: '2026-06' } }, { donem: { in: ['2026-YIL'] } }],
    });
  });

  it('tek uç: yalnız baş → gte (string sırası yıllığı da doğru süzer); yalnız bit → yıllık için ek dal', () => {
    expect(donemAraligiWhere('2025-03', undefined)).toEqual({ donem: { gte: '2025-03' } });
    // "2025-YIL" >= "2025-03" ve "2024-YIL" < "2025-03": alt sınır yıllıkta da doğru
    expect('2025-YIL' >= '2025-03').toBe(true);
    expect('2024-YIL' >= '2025-03').toBe(false);
    expect(donemAraligiWhere(null, '2026-05')).toEqual({
      OR: [{ donem: { lte: '2026-05' } }, { donem: { endsWith: '-YIL', lte: '2026-YIL' } }],
    });
  });

  it('iki uç da yoksa / bozuksa süzgeç yok (null); yalnız yıl verilirse Ocak..Aralık', () => {
    expect(donemAraligiWhere(undefined, undefined)).toBeNull();
    expect(donemAraligiWhere('bozuk', '')).toBeNull();
    expect(donemAraligiWhere('2025', '2026')).toEqual({
      OR: [{ donem: { gte: '2025-01', lte: '2026-12' } }, { donem: { in: ['2025-YIL', '2026-YIL'] } }],
    });
  });
});

const g = (p: Partial<{ docRefs: unknown; status: string; channel: string; sentAt: string | null; error: string | null; testMode: boolean; createdAt: string }>) => ({
  docRefs: ['k1'],
  status: 'SENT',
  channel: 'WHATSAPP',
  sentAt: '2026-09-12T10:00:00.000Z',
  error: null,
  testMode: false,
  createdAt: '2026-09-12T10:00:00.000Z',
  ...p,
});

describe('iletimHaritasiKur — kayıt → iletim listesi', () => {
  it('docRefs içindeki her kayıt için satır açılır; alan adları sözleşmeyle birebir', () => {
    const h = iletimHaritasiKur([g({ docRefs: ['k1', 'k2'], testMode: true })]);
    expect([...h.keys()].sort()).toEqual(['k1', 'k2']);
    expect(h.get('k1')).toEqual([
      { channel: 'WHATSAPP', status: 'SENT', sentAt: '2026-09-12T10:00:00.000Z', error: null, testMode: true },
    ]);
  });

  it('kanal başına EN YENİ gönderim kalır (eski FAILED, yeni SENT → SENT)', () => {
    const h = iletimHaritasiKur([
      g({ status: 'SENT', createdAt: '2026-09-12T10:00:00.000Z' }),
      g({ status: 'FAILED', error: 'ILETISIM-mükellefin telefon numarası yok', sentAt: null, createdAt: '2026-09-10T10:00:00.000Z' }),
    ]);
    expect(h.get('k1')).toHaveLength(1);
    expect(h.get('k1')![0]).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
  });

  it('iki kanal varsa liste en yeni önce sıralıdır (sıra veritabanı sırasından bağımsız)', () => {
    const h = iletimHaritasiKur([
      g({ channel: 'WHATSAPP', status: 'SENT', createdAt: '2026-09-10T10:00:00.000Z' }),
      g({ channel: 'EMAIL', status: 'FAILED', error: 'e-posta gönderilemedi', sentAt: null, createdAt: '2026-09-12T10:00:00.000Z' }),
    ]);
    expect(h.get('k1')!.map((x) => x.channel)).toEqual(['EMAIL', 'WHATSAPP']);
    expect(h.get('k1')![0].status).toBe('FAILED');
  });

  it('docRefs boş/dizi değil ya da kanal tanınmıyorsa satır atlanır; sentAt Date ise ISO metne çevrilir', () => {
    const h = iletimHaritasiKur([
      g({ docRefs: null }),
      g({ docRefs: 'k1' }),
      g({ channel: 'SMS' }),
      g({ docRefs: ['k9'], sentAt: new Date('2026-09-01T08:00:00.000Z') as any, createdAt: new Date('2026-09-01T08:00:00.000Z') as any }),
    ]);
    expect(h.has('k1')).toBe(false);
    expect(h.get('k9')![0].sentAt).toBe('2026-09-01T08:00:00.000Z');
  });
});

describe('iletimSuzgecIdleri — iletildi / iletilmedi / hata', () => {
  const harita = iletimHaritasiKur([
    // k1: WhatsApp SENT
    g({ docRefs: ['k1'], channel: 'WHATSAPP', status: 'SENT' }),
    // k2: son gönderim FAILED (e-posta), daha eski WhatsApp SENT
    g({ docRefs: ['k2'], channel: 'WHATSAPP', status: 'SENT', createdAt: '2026-09-01T10:00:00.000Z' }),
    g({ docRefs: ['k2'], channel: 'EMAIL', status: 'FAILED', error: 'x', sentAt: null, createdAt: '2026-09-12T10:00:00.000Z' }),
    // k3: yalnız FAILED
    g({ docRefs: ['k3'], status: 'FAILED', error: 'y', sentAt: null }),
    // k4: yalnız PENDING (denenmiş ama gitmemiş)
    g({ docRefs: ['k4'], status: 'PENDING', sentAt: null }),
  ]);

  it('iletildi → en az bir kanalda SENT olanlar (in)', () => {
    const s = iletimSuzgecIdleri(harita, 'iletildi');
    expect('in' in s && [...s.in].sort()).toEqual(['k1', 'k2']);
  });

  it('hata → en yeni gönderimi FAILED olanlar (in)', () => {
    const s = iletimSuzgecIdleri(harita, 'hata');
    expect('in' in s && [...s.in].sort()).toEqual(['k2', 'k3']);
  });

  it('iletilmedi → SENT ya da FAILED gönderimi olanlar dışarıda (notIn); PENDING ve hiç denenmemiş kalır', () => {
    const s = iletimSuzgecIdleri(harita, 'iletilmedi');
    expect('notIn' in s && [...s.notIn].sort()).toEqual(['k1', 'k2', 'k3']);
  });

  it('boş haritada iletildi/hata boş küme, iletilmedi boş notIn (süzgeçsiz)', () => {
    const bos = iletimHaritasiKur([]);
    expect(iletimSuzgecIdleri(bos, 'iletildi')).toEqual({ in: [] });
    expect(iletimSuzgecIdleri(bos, 'hata')).toEqual({ in: [] });
    expect(iletimSuzgecIdleri(bos, 'iletilmedi')).toEqual({ notIn: [] });
  });
});
