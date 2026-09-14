import { hatirlatmaOlaylari, gonderilecekOlay, istanbulSaat } from './gorev-hatirlatma-kurali';
import { gunYap } from './gorev-tekrar';

const ist = (gun: string, saat: number, dk = 0) => { const [y, m, d] = gun.split('-').map(Number); return istanbulSaat(gunYap(y, m, d), saat, dk); };
const gorev = (ek: Partial<any> = {}): any => ({ id: 'g1', title: 'KDV kontrolü', status: 'OPEN', dueDate: '2026-09-16T00:00:00.000Z', dueTime: null, priority: 'HIGH', taxpayerAd: 'Öz Ela', ...ek });

describe('hatirlatmaOlaylari', () => {
  it('1 gün önce 09:00 ÖNCEDEN; vade günü 09:00 VADE (saat yoksa)', () => {
    expect(hatirlatmaOlaylari(gorev(), ist('2026-09-15', 8, 59))).toEqual([]);
    const onceden = hatirlatmaOlaylari(gorev(), ist('2026-09-15', 9, 0));
    expect(onceden.map((o) => o.anahtar)).toEqual(['ONCEDEN:2026-09-15']);
    expect(onceden[0].baslik).toBe('Yaklaşıyor: KDV kontrolü');
    expect(onceden[0].govde).toBe('Vade 16.09.2026 · Öz Ela');
    const vade = hatirlatmaOlaylari(gorev(), ist('2026-09-16', 9, 0));
    expect(vade.map((o) => o.anahtar)).toEqual(['ONCEDEN:2026-09-15', 'VADE:2026-09-16']);
  });

  it('saat verilmişse VADE 30 dk önce; ÖNCEDEN vade anından 1 gün önce', () => {
    const g = gorev({ dueTime: '14:00' });
    expect(hatirlatmaOlaylari(g, ist('2026-09-16', 13, 29)).map((o) => o.tip)).toEqual(['ONCEDEN']);
    const v = hatirlatmaOlaylari(g, ist('2026-09-16', 13, 30));
    expect(v.map((o) => o.tip)).toEqual(['ONCEDEN', 'VADE']);
    expect(v[1].govde).toBe('Saat 14:00 · Öz Ela');
    // ÖNCEDEN: 15.09 14:00
    expect(hatirlatmaOlaylari(g, ist('2026-09-15', 13, 59))).toEqual([]);
    expect(hatirlatmaOlaylari(g, ist('2026-09-15', 14, 0)).map((o) => o.tip)).toEqual(['ONCEDEN']);
  });

  it('gecikme kademeleri 1/3/7/14 gün 09:00; ACİL öneki; bitmiş görev → boş', () => {
    const olaylar = hatirlatmaOlaylari(gorev({ priority: 'URGENT' }), ist('2026-09-30', 9, 0));
    expect(olaylar.filter((o) => o.tip === 'GECIKME').map((o) => o.gecikmeGun)).toEqual([1, 3, 7, 14]);
    expect(olaylar.find((o) => o.gecikmeGun === 3)!.baslik).toBe('ACİL · 3 gün gecikti: KDV kontrolü');
    expect(hatirlatmaOlaylari(gorev({ status: 'DONE' }), ist('2026-09-30', 9, 0))).toEqual([]);
    expect(hatirlatmaOlaylari(gorev({ dueDate: null }), ist('2026-09-30', 9, 0))).toEqual([]);
  });

  it('reminderConfig.beforeOffsets: 2 gün ve 3 saat önce', () => {
    const g = gorev({ dueTime: '10:00', reminderConfig: { beforeOffsets: [{ days: 2 }, { hours: 3 }] } });
    const o = hatirlatmaOlaylari(g, ist('2026-09-16', 7, 0));
    expect(o.map((x) => x.anahtar)).toEqual(['ONCEDEN:2026-09-14', 'ONCEDEN:2026-09-16']);
  });

  it('gonderilecekOlay: gönderilmişleri eler, en son planlananı seçer', () => {
    const olaylar = hatirlatmaOlaylari(gorev(), ist('2026-09-19', 9, 0)); // vade geçti → yalnız GECIKME 1, 3 (yaklaşıyor/vade artık gönderilmez)
    expect(olaylar.map((o) => o.anahtar)).toEqual(['GECIKME:2026-09-17', 'GECIKME:2026-09-19']);
    const sec = gonderilecekOlay(olaylar, new Set(['GECIKME:2026-09-17']));
    expect(sec!.anahtar).toBe('GECIKME:2026-09-19');
    expect(gonderilecekOlay(olaylar, new Set(olaylar.map((o) => o.anahtar)))).toBeNull();
  });
});
