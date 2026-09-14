import { bildirimPolitikasi } from './notification-policy';

const temel = { tenantId: 't1', title: 'b', body: 'g' };

describe('bildirimPolitikasi — kopya / bilgi-kirliligi bildirimleri tek yerden elenir', () => {
  describe('KDV_RESULT', () => {
    it('temiz sonuc (inceleme+hatali+kismi = 0) → ATLA', () => {
      const r = bildirimPolitikasi({ ...temel, type: 'KDV_RESULT', metadata: { matched: 12, needsReview: 0, unmatched: 0, partial: 0 } });
      expect(r.atla).toBe(true);
      expect(r.neden).toContain('temiz');
    });
    it('sayilar metin olarak gelse de ("0") temiz sayilir → ATLA', () => {
      const r = bildirimPolitikasi({ ...temel, type: 'KDV_RESULT', metadata: { needsReview: '0', unmatched: '0', partial: '0' } });
      expect(r.atla).toBe(true);
    });
    it('incelenecek kayit varsa → URET', () => {
      const r = bildirimPolitikasi({ ...temel, type: 'KDV_RESULT', metadata: { needsReview: 2, unmatched: 0, partial: 0 } });
      expect(r.atla).toBe(false);
    });
    it('yalniz hatali (unmatched) varsa da → URET', () => {
      const r = bildirimPolitikasi({ ...temel, type: 'KDV_RESULT', metadata: { needsReview: 0, unmatched: 1, partial: 0 } });
      expect(r.atla).toBe(false);
    });
    it('sayilar metadata\'da hic yoksa (KDV2 tevkifat listesi gibi) → URET', () => {
      expect(bildirimPolitikasi({ ...temel, type: 'KDV_RESULT', metadata: { donem: '2026-08', kdv2: true } }).atla).toBe(false);
      expect(bildirimPolitikasi({ ...temel, type: 'KDV_RESULT' }).atla).toBe(false);
    });
  });

  describe('MOREN_AI_ALERT', () => {
    it('kdv-control modulunden gelen genel uyari KDV_RESULT kopyasi → ATLA', () => {
      const r = bildirimPolitikasi({
        ...temel, type: 'MOREN_AI_ALERT',
        metadata: { source: 'moren-ai', module: 'kdv-control', severity: 'warning', needsReview: 3 },
      });
      expect(r.atla).toBe(true);
    });
    it('kdv-control "Belge icerik denetimi" (source=kdv-content-audit) → URET', () => {
      const r = bildirimPolitikasi({
        ...temel, type: 'MOREN_AI_ALERT',
        metadata: { module: 'kdv-control', source: 'kdv-content-audit', riskyCount: 2 },
      });
      expect(r.atla).toBe(false);
    });
    it('baska modulden gelen AI uyarisi → URET', () => {
      expect(bildirimPolitikasi({ ...temel, type: 'MOREN_AI_ALERT', metadata: { module: 'fatura-merkezi' } }).atla).toBe(false);
    });
  });

  describe('SYSTEM', () => {
    it('LUCA_JOB_FAILURE saglik uyarisi (LUCA_SYNC_ERROR zaten var) → ATLA', () => {
      const r = bildirimPolitikasi({ ...temel, type: 'SYSTEM', metadata: { healthCheckType: 'LUCA_JOB_FAILURE', status: 'DEGRADED' } });
      expect(r.atla).toBe(true);
    });
    it('diger saglik uyarilari (DB_HEALTH, AGENT_PING_LUCA) → URET', () => {
      expect(bildirimPolitikasi({ ...temel, type: 'SYSTEM', metadata: { healthCheckType: 'DB_HEALTH' } }).atla).toBe(false);
      expect(bildirimPolitikasi({ ...temel, type: 'SYSTEM', metadata: { healthCheckType: 'AGENT_PING_LUCA' } }).atla).toBe(false);
      expect(bildirimPolitikasi({ ...temel, type: 'SYSTEM' }).atla).toBe(false);
    });
  });

  describe('MIHSAP_RESULT', () => {
    it('basarili aktarim (metadata.basari=true) → ATLA', () => {
      const r = bildirimPolitikasi({ ...temel, type: 'MIHSAP_RESULT', metadata: { basari: true, fetched: 21, total: 21 } });
      expect(r.atla).toBe(true);
    });
    it('hata / oturum bekleniyor (basari=false) → URET', () => {
      expect(bildirimPolitikasi({ ...temel, type: 'MIHSAP_RESULT', metadata: { basari: false, errorMsg: 'token' } }).atla).toBe(false);
    });
    it('basari alani hic yoksa (eski uretici) → URET', () => {
      expect(bildirimPolitikasi({ ...temel, type: 'MIHSAP_RESULT', metadata: { jobId: 'j1' } }).atla).toBe(false);
    });
  });

  it('kural disi tipler her zaman URET (E_TEBLIGAT, WHATSAPP, bilinmeyen)', () => {
    expect(bildirimPolitikasi({ ...temel, type: 'E_TEBLIGAT', metadata: { healthCheckType: 'LUCA_JOB_FAILURE' } }).atla).toBe(false);
    expect(bildirimPolitikasi({ ...temel, type: 'WHATSAPP' }).atla).toBe(false);
    expect(bildirimPolitikasi({ ...temel, type: 'BILINMEYEN_TIP', metadata: { basari: true } }).atla).toBe(false);
  });

  it('metadata bozuk (dizi / metin) gelse bile patlamaz → URET', () => {
    expect(bildirimPolitikasi({ ...temel, type: 'KDV_RESULT', metadata: ['x'] as any }).atla).toBe(false);
    expect(bildirimPolitikasi({ ...temel, type: 'MIHSAP_RESULT', metadata: 'abc' as any }).atla).toBe(false);
  });
});
