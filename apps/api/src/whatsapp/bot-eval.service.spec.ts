import { BotEvalService } from './bot-eval.service';

/**
 * localEval içerik korumaları (prod denetim 2026-06-15 kanıtı): uydurma teorik
 * tahakkuk, yanlış vergi oranı (%20), yalan teslim/timeout sızıntısı ve içi boş
 * araştırma sözü cevap GÖNDERİLMEDEN (skor<6 → fallback) yakalanmalı; geçerli
 * komut onayı ("başlattım") ve doğru cevaplar CEZALANDIRILMAMALI.
 */
describe('BotEvalService.localEval içerik korumaları', () => {
  const svc = new BotEvalService({} as any);
  const local = (reply: string, ownerMode = true): { score: number; reasons: string[] } =>
    (svc as any).localEval(reply, { ownerMode, intent: ownerMode ? 'OWNER' : 'GENEL' }, []);

  it('uydurma teorik tahakkuğu yakalar (skor<6)', () => {
    const r = local('Geçici vergi = 2.761.480,92 × %20 = 552.296,18 (teorik hesap). Geçici vergi beyannamesi sistemde yok.');
    expect(r.reasons).toContain('FABRICATED_THEORETICAL_TAHAKKUK');
    expect(r.score).toBeLessThan(6);
  });

  it('"teorik tahakkuk" ibaresini doğrudan yakalar', () => {
    const r = local('Teorik tahakkuk (önceki hesap): Net kâr 936.665,62 ₺ üzerinden.');
    expect(r.reasons).toContain('FABRICATED_THEORETICAL_TAHAKKUK');
    expect(r.score).toBeLessThan(6);
  });

  it('kurumlar/geçici vergiyi %20 ile hesaplamayı yakalar', () => {
    const r = local('Kurumlar vergisi oranı %20 üzerinden hesaplanır.');
    expect(r.reasons).toContain('WRONG_TAX_RATE_20');
    expect(r.score).toBeLessThan(6);
  });

  it('düzeltme cümlesini (%20 değil %25) CEZALANDIRMAZ', () => {
    const r = local('Kurumlar vergisi %20 değil, doğrusu %25 oranındadır.');
    expect(r.reasons).not.toContain('WRONG_TAX_RATE_20');
  });

  it('KDV genel %20 oranını (kurumlar/geçici bağlamı yok) CEZALANDIRMAZ', () => {
    const r = local('KDV genel oranı %20, indirimli oranlar %10 ve %1.');
    expect(r.reasons).not.toContain('WRONG_TAX_RATE_20');
  });

  it('yalan teslim/erteleme ifadesini yakalar', () => {
    const r = local('Tamam, 2. ödeme emri gönderime alındı. Dakikalar içinde alacaksın.');
    expect(r.reasons).toContain('FALSE_ACTION_OR_EXCUSE');
    expect(r.score).toBeLessThan(6);
  });

  it('timeout sızıntısını yakalar', () => {
    const r = local('Timout oldu, sistem güncellemesinin ardından yeniden sorun.');
    expect(r.reasons).toContain('FALSE_ACTION_OR_EXCUSE');
  });

  it('geçerli komut onayını ("başlattım") CEZALANDIRMAZ', () => {
    const r = local('Fatih Gedik için 1. dönem e-Defter kontrolü başlatıldı; sonucu sana ileteceğim.');
    expect(r.reasons).not.toContain('FALSE_ACTION_OR_EXCUSE');
    expect(r.score).toBeGreaterThanOrEqual(6);
  });

  it('içi boş "araştırıyorum" sözünü yakalar', () => {
    const r = local('Pekala. Araştırıyorum.');
    expect(r.reasons).toContain('EMPTY_RESEARCH_PROMISE');
    expect(r.score).toBeLessThan(6);
  });

  it('doğru/dolu cevabı yüksek puanlar', () => {
    const r = local('Geçici vergi oranı %25 (kurumlar mükellefi). Sultan Osman için tahakkukta yazan tutarı kayıttan teyit edip ileteyim.');
    expect(r.score).toBeGreaterThanOrEqual(6);
    expect(r.reasons).not.toContain('FABRICATED_THEORETICAL_TAHAKKUK');
    expect(r.reasons).not.toContain('WRONG_TAX_RATE_20');
  });
});
