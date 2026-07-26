import { api } from './api';

export type MaliYorumKaynak = 'MIZAN' | 'BILANCO' | 'GELIR_TABLOSU' | 'IHO';

export type MaliYorum = {
  id: string;
  kaynak: MaliYorumKaynak;
  kaynakId: string;
  donem?: string | null;
  ozet: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export const maliYorumApi = {
  /** Kayıtlı değerlendirmeyi getir (yoksa null). */
  get: (kaynak: MaliYorumKaynak, kaynakId: string): Promise<MaliYorum | null> =>
    api.get(`/mali-yorum/${kaynak}/${encodeURIComponent(kaynakId)}`).then((r) => r.data ?? null),
  /**
   * Değerlendirme üret. force=true yeniden üretir. derin=true güçlü model
   * (Sonnet, "Derin Analiz"); false = ucuz model (Haiku, limit dostu).
   */
  uret: (
    kaynak: MaliYorumKaynak,
    kaynakId: string,
    force = false,
    derin = false,
  ): Promise<MaliYorum> =>
    api
      .post(`/mali-yorum/${kaynak}/${encodeURIComponent(kaynakId)}/uret`, null, {
        params: {
          ...(force ? { force: '1' } : {}),
          ...(derin ? { derin: '1' } : {}),
        },
      })
      .then((r) => r.data),
};
