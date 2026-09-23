/**
 * posting-serbest-birak.spec.ts — POSTING'de unutulan belge kararı (2026-09-23, DOĞAN ÖZKAN olayı).
 * Canlı olay: iş "cancelled" (kullanıcı durdurdu) → belge 'Aktarılıyor…'da kilitli kaldı, aktar düğmesi pasifti.
 */
import { postingBelgeKarari, sonGunlukSatiri } from './posting-serbest-birak';

describe('sonGunlukSatiri', () => {
  it('son anlamlı satırı zaman damgasız döner, boş satırları atlar', () => {
    const log = '[09:16:52] Luca guvenlik kodu portalda bekleniyor\n\n[09:19:20] Iptal edildi: kullanici durdurdu\n   \n';
    expect(sonGunlukSatiri(log)).toBe('Iptal edildi: kullanici durdurdu');
  });
  it('boş/eksik günlükte boş döner ve 300 karaktere kırpar', () => {
    expect(sonGunlukSatiri(null)).toBe('');
    expect(sonGunlukSatiri('[00:00:00] ' + 'x'.repeat(500))).toHaveLength(300);
  });
});

describe('postingBelgeKarari', () => {
  it('iş kaydı yoksa FAILED (yeniden gönderilebilir)', () => {
    expect(postingBelgeKarari(null)).toEqual({ lucaStatus: 'FAILED', lucaErrorMessage: 'Aktarım işi kaydı bulunamadı — yeniden gönderin' });
    expect(postingBelgeKarari(undefined)?.lucaStatus).toBe('FAILED');
  });
  it('süren işe (pending/running) DOKUNMAZ', () => {
    expect(postingBelgeKarari({ status: 'pending' })).toBeNull();
    expect(postingBelgeKarari({ status: 'running', errorMsg: '[09:00:00] çalışıyor' })).toBeNull();
  });
  it('kullanıcının durdurduğu iş (cancelled) → FAILED + sebep (canlı olay 23.09 09:19)', () => {
    const k = postingBelgeKarari({ status: 'cancelled', errorMsg: '[09:16:52] Luca guvenlik kodu portalda bekleniyor\n[09:19:20] Iptal edildi: kullanici durdurdu' });
    expect(k).toEqual({ lucaStatus: 'FAILED', lucaErrorMessage: 'Aktarım durduruldu: Iptal edildi: kullanici durdurdu' });
  });
  it('günlüksüz iptalde sebep eki olmadan FAILED', () => {
    expect(postingBelgeKarari({ status: 'cancelled', errorMsg: '' })).toEqual({ lucaStatus: 'FAILED', lucaErrorMessage: 'Aktarım durduruldu' });
  });
  it('failed iş → FAILED + günlüğün son satırı; günlük yoksa genel mesaj', () => {
    expect(postingBelgeKarari({ status: 'failed', errorMsg: '[08:56:54] ✗ İşletme finalize hata: Fiş Kes doğrulanamadı' }))
      .toEqual({ lucaStatus: 'FAILED', lucaErrorMessage: '✗ İşletme finalize hata: Fiş Kes doğrulanamadı' });
    expect(postingBelgeKarari({ status: 'failed' })).toEqual({ lucaStatus: 'FAILED', lucaErrorMessage: "Luca'ya gönderilemedi" });
  });
  it('done iş → POSTED (FAILED yazılsa mükerrer fiş kesilirdi); tarih işin bitişi, yoksa şimdi', () => {
    const bitis = new Date('2026-09-23T06:00:00Z');
    expect(postingBelgeKarari({ status: 'done', finishedAt: bitis })).toEqual({ lucaStatus: 'POSTED', lucaPostedAt: bitis });
    const simdi = new Date('2026-09-23T07:00:00Z');
    expect(postingBelgeKarari({ status: 'done', finishedAt: null }, simdi)).toEqual({ lucaStatus: 'POSTED', lucaPostedAt: simdi });
  });
  it('bilinmeyen durumda DOKUNMAZ', () => {
    expect(postingBelgeKarari({ status: 'paused' })).toBeNull();
  });
});
