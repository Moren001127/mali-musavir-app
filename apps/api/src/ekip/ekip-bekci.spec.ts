import { bayatKosulariSec, bayatSonucBirlestir, kosuTavanDk, EKIP_KOSU_TAVAN_DK_VARSAYILAN } from './ekip-bekci';

const T = (dkOnce: number, simdi: Date) => new Date(simdi.getTime() - dkOnce * 60000);

describe('ekip bekçi — bayat koşu seçimi', () => {
  const simdi = new Date('2026-09-13T06:00:00Z');
  const is = (id: string, dkOnce: number, ek: Partial<any> = {}) => ({
    id,
    agent: 'ekip:kdv',
    status: 'running',
    startedAt: T(dkOnce, simdi),
    createdAt: T(dkOnce + 1, simdi),
    ...ek,
  });

  it('süreç belleğinde koşan iş asla bayat sayılmaz (tavanı aşsa da)', () => {
    const k = bayatKosulariSec([is('a', 500)], { simdi, aktifMi: () => true, surecBaslangici: T(10, simdi) });
    expect(k).toEqual([]);
  });

  it('açılış taraması: süreç öncesi başlamış running iş → sunucu_yeniden_basladi', () => {
    const k = bayatKosulariSec([is('a', 20), is('b', 2)], { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi) });
    expect(k.map((x) => [x.id, x.neden])).toEqual([['a', 'sunucu_yeniden_basladi']]);
    expect(k[0].metin).toContain('Sunucu yeniden başlatıldığı');
    expect(k[0].metin).toContain('20 dk');
  });

  it('düzenli tarama: tavanı aşan iş → sure_asimi; aşmayan dokunulmaz', () => {
    const k = bayatKosulariSec([is('a', 130), is('b', 90)], { simdi, aktifMi: () => false, tavanDk: 120 });
    expect(k.map((x) => [x.id, x.neden])).toEqual([['a', 'sure_asimi']]);
    expect(k[0].metin).toContain('120 dakikalık');
  });

  it('running olmayan ya da ekip dışı işler seçilmez', () => {
    const k = bayatKosulariSec(
      [is('a', 500, { status: 'done' }), is('b', 500, { agent: 'luca' }), is('c', 500, { status: 'pending' })],
      { simdi, aktifMi: () => false, surecBaslangici: T(1, simdi), tavanDk: 10 },
    );
    expect(k).toEqual([]);
  });

  it('startedAt yoksa createdAt kullanılır', () => {
    const k = bayatKosulariSec([is('a', 0, { startedAt: null, createdAt: T(200, simdi) })], { simdi, aktifMi: () => false, tavanDk: 120 });
    expect(k.map((x) => x.id)).toEqual(['a']);
  });

  it('tavan env: geçersiz/küçük değer varsayılana düşer', () => {
    expect(kosuTavanDk({} as any)).toBe(EKIP_KOSU_TAVAN_DK_VARSAYILAN);
    expect(kosuTavanDk({ EKIP_KOSU_TAVAN_DK: 'abc' } as any)).toBe(EKIP_KOSU_TAVAN_DK_VARSAYILAN);
    expect(kosuTavanDk({ EKIP_KOSU_TAVAN_DK: '5' } as any)).toBe(EKIP_KOSU_TAVAN_DK_VARSAYILAN);
    expect(kosuTavanDk({ EKIP_KOSU_TAVAN_DK: '45' } as any)).toBe(45);
  });

  it('sonuç birleştirme eski raporu korur, hata + bayat ekler', () => {
    const r = bayatSonucBirlestir({ rapor: 'yarım rapor', toolUses: [1] }, { id: 'a', neden: 'sure_asimi', metin: 'aştı' });
    expect(r).toEqual({ rapor: 'yarım rapor', toolUses: [1], hata: 'aştı', bayat: true, bayatNeden: 'sure_asimi' });
    expect(bayatSonucBirlestir(null, { id: 'a', neden: 'sunucu_yeniden_basladi', metin: 'x' }).bayat).toBe(true);
  });
});
