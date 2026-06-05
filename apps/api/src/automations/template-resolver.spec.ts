import {
  resolveTemplates,
  evaluateCondition,
  ResolveContext,
} from './template-resolver';

/** Test kolaylığı: boş outputs ile başlayan bir context üretir. */
const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  outputs: {},
  ...over,
});

describe('resolveTemplates', () => {
  it('string tamamen tek template ise değişkenin tam değerini (tip korunarak) döndürür', () => {
    const mukellef = { phone: '+905551112233', unvan: 'Ali Tekstil' };
    const sonuc = resolveTemplates('{{mukellef}}', ctx({ outputs: { mukellef } }));
    // Obje string'e çevrilmeden, olduğu gibi döner.
    expect(sonuc).toEqual(mukellef);
    expect(typeof sonuc).toBe('object');
  });

  it('nested path çözer ({{mukellef.phone}})', () => {
    const sonuc = resolveTemplates(
      '{{mukellef.phone}}',
      ctx({ outputs: { mukellef: { phone: '+905551112233' } } }),
    );
    expect(sonuc).toBe('+905551112233');
  });

  it('.length sayısal değeri döndürür (tek template → number tipi korunur)', () => {
    const sonuc = resolveTemplates(
      '{{gecikenler.length}}',
      ctx({ outputs: { gecikenler: [{}, {}, {}] } }),
    );
    expect(sonuc).toBe(3);
    expect(typeof sonuc).toBe('number');
  });

  it('karışık string içindeki template\'leri interpolasyon ile yerine koyar', () => {
    const sonuc = resolveTemplates(
      '{{currentMonth}} dönemi için {{adet}} mükellef',
      ctx({ outputs: { adet: 5 }, now: new Date('2026-06-15T09:00:00Z') }),
    );
    expect(sonuc).toBe('2026-06 dönemi için 5 mükellef');
  });

  it('trigger payload kök değişkenlerini çözer', () => {
    const trigger = { taxpayerId: 'tp_42', donem: '2026-04' };
    expect(resolveTemplates('{{taxpayerId}}', ctx({ trigger }))).toBe('tp_42');
    expect(resolveTemplates('Dönem: {{donem}}', ctx({ trigger }))).toBe(
      'Dönem: 2026-04',
    );
  });

  it('obje ve array içinde derinlemesine dolaşıp çözer', () => {
    const giris = { selam: 'Merhaba {{ad}}', liste: ['{{ad}}', 'sabit'] };
    const sonuc = resolveTemplates(giris, ctx({ outputs: { ad: 'Ali' } }));
    expect(sonuc).toEqual({ selam: 'Merhaba Ali', liste: ['Ali', 'sabit'] });
  });

  it('bulunamayan değişken karışık string\'de boş string olur', () => {
    expect(resolveTemplates('[{{yok}}]', ctx())).toBe('[]');
  });

  describe('built-in tokenlar Europe/Istanbul saatine göre (UTC+3 gün kayması)', () => {
    it('2026-05-31T22:30:00Z → today 2026-06-01, currentMonth 2026-06', () => {
      const c = ctx({ now: new Date('2026-05-31T22:30:00Z') });
      expect(resolveTemplates('{{today}}', c)).toBe('2026-06-01');
      expect(resolveTemplates('{{currentMonth}}', c)).toBe('2026-06');
    });

    it('gün ortası UTC saatinde kayma olmaz', () => {
      const c = ctx({ now: new Date('2026-06-15T09:00:00Z') });
      expect(resolveTemplates('{{today}}', c)).toBe('2026-06-15');
      expect(resolveTemplates('{{currentMonth}}', c)).toBe('2026-06');
    });
  });
});

describe('evaluateCondition', () => {
  it('> yalnızca iki taraf da sayıysa karşılaştırır', () => {
    expect(evaluateCondition({ left: 5, op: '>', right: 3 })).toBe(true);
    expect(evaluateCondition({ left: 2, op: '>', right: 3 })).toBe(false);
    // Sayı olmayan taraf varsa false (string "5" sayı değil).
    expect(evaluateCondition({ left: '5', op: '>', right: 3 })).toBe(false);
  });

  it('== gevşek karşılaştırma yapar ("5" == 5 → true)', () => {
    expect(evaluateCondition({ left: '5', op: '==', right: 5 })).toBe(true);
    expect(evaluateCondition({ left: 'abc', op: '==', right: 'abc' })).toBe(true);
  });

  it('exists boş string için false, dolu değer için true döner', () => {
    expect(evaluateCondition({ left: '', op: 'exists' })).toBe(false);
    expect(evaluateCondition({ left: null, op: 'exists' })).toBe(false);
    expect(evaluateCondition({ left: undefined, op: 'exists' })).toBe(false);
    expect(evaluateCondition({ left: 'dolu', op: 'exists' })).toBe(true);
    // 0 boş değildir → exists true.
    expect(evaluateCondition({ left: 0, op: 'exists' })).toBe(true);
  });

  it('in dizinin elemanı olup olmadığına bakar', () => {
    expect(evaluateCondition({ left: 'b', op: 'in', right: ['a', 'b', 'c'] })).toBe(
      true,
    );
    expect(evaluateCondition({ left: 'z', op: 'in', right: ['a', 'b', 'c'] })).toBe(
      false,
    );
    // right dizi değilse false.
    expect(evaluateCondition({ left: 'b', op: 'in', right: 'abc' })).toBe(false);
  });
});
