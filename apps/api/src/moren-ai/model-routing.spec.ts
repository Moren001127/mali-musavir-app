import { needsLegislationModel, pickDefaultModel } from './moren-ai.service';

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5-20251001';

describe('Model yönlendirme — mevzuat/bilgi → Opus', () => {
  describe('needsLegislationModel', () => {
    it('mevzuat/oran/süre/ceza sorularını yakalar', () => {
      const yes = [
        'makine yedek parçalarında kdv oranı % kaç',
        'sgk işe giriş bildirme süresi nedir süresinde bildirilmezse ne olur',
        'kıdem tazminatı tavanı ne kadar',
        'damga vergisi oranı nedir',
        'VUK 168 madde ne diyor',
        'adres değişikliği vergi dairesine kaç gün içinde bildirilir',
        'tevkifat hangi durumda uygulanır',
      ];
      for (const q of yes) expect(needsLegislationModel(q)).toBe(true);
    });

    it('belirli mükellef VERİSİ sorularını mevzuat saymaz', () => {
      const no = [
        'Adem Can a ne kadar kdv çıkıyor',
        "Özela'nın nisan kdv beyannamesini gönder",
        'benim bu ay kdv ne kadar',
        'kaç mükellefim var',
        'merhaba nasılsın',
      ];
      for (const q of no) expect(needsLegislationModel(q)).toBe(false);
    });
  });

  describe('pickDefaultModel', () => {
    it('owner mevzuat sorusu → Opus', () => {
      expect(pickDefaultModel('owner', 'kdv tevkifat oranı kaç')).toBe(OPUS);
    });
    it('mükellef mevzuat sorusu → Opus', () => {
      expect(pickDefaultModel('taxpayer-readonly', undefined, 'kıdem tazminatı nasıl hesaplanır')).toBe(OPUS);
    });
    it('owner derin analiz → Sonnet', () => {
      expect(pickDefaultModel('owner', 'sultan osman inşaatın gelir tablosunu analiz et')).toBe(SONNET);
    });
    it('basit/sohbet → Haiku', () => {
      expect(pickDefaultModel('owner', 'merhaba')).toBe(HAIKU);
      expect(pickDefaultModel('none', 'mevzuat kanun madde')).toBe(HAIKU);
    });
  });
});
