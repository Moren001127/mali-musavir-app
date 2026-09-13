// analyzeFull: hesap davranis motoru + kapsam raporu ucundan uca (YORGUN kalibi: yalniz fatura islenmis defter)
import { EDefterControlService } from './edefter-control.service';
import type { ParsedEDefterFisLine } from './edefter-fis-listesi-parser.service';
import { Q2, alisFaturasi, bordroFisi, kdvTahakkuk, mizan, satisFaturasi, tahsilat } from './hesap-davranis/kurallar/test-yardimcilari';

describe('EDefterControlService analyzeFull — kapsam raporu', () => {
  const service = new EDefterControlService(null as any, null as any, null as any);
  const full = (rows: ParsedEDefterFisLine[], mizanCtx: any = null, ruleSettings = new Map<string, boolean>()) =>
    (service as any).analyzeFull(rows, Q2, 'GECICI_Q2', ruleSettings, mizanCtx) as {
      findings: Array<{ category: string; severity: string; message: string; hesapKodu?: string | null }>;
      kontrolOzeti: { ozet: Record<string, number | boolean>; kapsam: Array<{ kod: string; durum: string; bulgu: number }>; hesaplar: Array<{ kod: string }> };
    };

  function yorgunKalibi(): ParsedEDefterFisLine[] {
    const rows: ParsedEDefterFisLine[] = [];
    // 8 alici: yalniz satis faturasi, hic tahsilat yok
    for (let i = 1; i <= 8; i += 1) {
      rows.push(...satisFaturasi(`s${i}a`, '2026-04-10', `120.01.M00${i}`, `MUSTERI ${i} LTD`, 30_000 + i * 1_000));
      rows.push(...satisFaturasi(`s${i}b`, '2026-05-12', `120.01.M00${i}`, `MUSTERI ${i} LTD`, 25_000));
    }
    // 4 satici: yalniz alis faturasi
    for (let i = 1; i <= 4; i += 1) {
      rows.push(...alisFaturasi(`a${i}a`, '2026-04-15', `320.01.S00${i}`, `SATICI ${i}`, 40_000));
      rows.push(...alisFaturasi(`a${i}b`, '2026-06-15', `320.01.S00${i}`, `SATICI ${i}`, 20_000));
    }
    // Bordro: 3 ay tahakkuk, odeme yok; KDV tahakkuku ay sonlarinda, odeme yok
    rows.push(...bordroFisi('b4', '2026-04-30'), ...bordroFisi('b5', '2026-05-31'), ...bordroFisi('b6', '2026-06-30'));
    rows.push(...kdvTahakkuk('k4', '2026-04-30', 80_000, 30_000), ...kdvTahakkuk('k5', '2026-05-31', 60_000, 20_000), ...kdvTahakkuk('k6', '2026-06-30', 50_000, 40_000));
    return rows;
  }

  it('yalniz fatura islenmis defterde defter geneli HATA + cari/vergi/SGK/ucret odeme bulgulari cikar', () => {
    const { findings, kontrolOzeti } = full(yorgunKalibi());
    const kodlar = new Set(findings.map((f) => f.category));
    expect(kodlar.has('DEFTER_TAHSILAT_ODEME_ISLENMEMIS')).toBe(true);
    expect(findings.find((f) => f.category === 'DEFTER_TAHSILAT_ODEME_ISLENMEMIS')?.severity).toBe('ERROR');
    expect(kodlar.has('CARI_120_TAHSILAT_YOK')).toBe(true);
    expect(kodlar.has('CARI_320_ODEME_YOK')).toBe(true);
    expect(kodlar.has('VERGI_360_ODEME_YOK')).toBe(true);
    expect(kodlar.has('SGK_361_ODEME_YOK')).toBe(true);
    expect(kodlar.has('PERSONEL_335_ODEME_YOK')).toBe(true);
    expect(kodlar.has('BANKA_HAREKETI_YOK')).toBe(true);
    // Kapsam raporu: eski + yeni motor kurallari, her biri bir durumla
    const ozet = kontrolOzeti.ozet;
    expect(Number(ozet.kural)).toBeGreaterThan(120);
    expect(Number(ozet.calisti)).toBeGreaterThan(40);
    expect(Number(ozet.bulgulu)).toBeGreaterThanOrEqual(7);
    expect(Number(ozet.uygulanmaz)).toBeGreaterThan(0); // yillik kurallar ceyrekte uygulanmaz
    expect(Number(ozet.pasif)).toBeGreaterThan(0); // varsayilan kapali kurallar
    expect(kontrolOzeti.kapsam.find((k) => k.kod === 'CARI_120_TAHSILAT_YOK')?.durum).toBe('BULGU');
    expect(kontrolOzeti.kapsam.find((k) => k.kod === 'YILLIK_KAPANIS_690_EKSIK')?.durum).toBe('UYGULANMAZ');
    expect(kontrolOzeti.kapsam.find((k) => k.kod === 'SIFIR_TUTARLI_SATIR')?.durum).toBe('PASIF');
    expect(kontrolOzeti.kapsam.find((k) => k.kod === 'CARI_HAREKETSIZ_BAKIYE')?.durum).toBe('VERI_YOK'); // Mizan yok
    // Hesap kartlari: her yaprak hesap
    expect(kontrolOzeti.hesaplar.some((h) => h.kod === '120.01.M001')).toBe(true);
    expect(kontrolOzeti.hesaplar.some((h) => h.kod === '361.01.001')).toBe(true);
  });

  it('kural ayari ile kapatilan yeni motor kurali bulgu uretmez ve kapsamda PASIF gorunur', () => {
    const ayar = new Map<string, boolean>([['CARI_120_TAHSILAT_YOK', false]]);
    const { findings, kontrolOzeti } = full(yorgunKalibi(), null, ayar);
    expect(findings.some((f) => f.category === 'CARI_120_TAHSILAT_YOK')).toBe(false);
    expect(kontrolOzeti.kapsam.find((k) => k.kod === 'CARI_120_TAHSILAT_YOK')?.durum).toBe('PASIF');
  });

  it('Mizan ile CARI_TERS_BAKIYE kesinlesir ve hareketsiz cari bakiyesi bulunur', () => {
    const rows = [...satisFaturasi('s1', '2026-04-10', '120.01.A001', 'ALICI A', 10_000)];
    const mz = mizan({
      '120.01.A001': { bakiye: 12_000, ad: 'ALICI A' },
      '120.01.T001': { bakiye: -8_000, ad: 'TERS ALICI' }, // alacakli 120 → ters (kesin)
      '120.01.H001': { bakiye: 60_000, ad: 'HAREKETSIZ ALICI' },
    });
    const { findings } = full(rows, mz);
    const ters = findings.find((f) => f.category === 'CARI_TERS_BAKIYE_120');
    expect(ters).toBeTruthy();
    expect(ters!.hesapKodu).toBe('120.01.T001');
    expect(ters!.message).toContain('kesin');
    expect(findings.some((f) => f.category === 'CARI_HAREKETSIZ_BAKIYE' && f.hesapKodu === '120.01.H001')).toBe(true);
  });

  it('temiz defterde (tahsilat/odeme islenmis) davranis kurallari bulgu uretmez', () => {
    const rows: ParsedEDefterFisLine[] = [
      ...satisFaturasi('s1', '2026-04-10', '120.01.A001', 'ALICI A', 50_000),
      ...satisFaturasi('s2', '2026-05-10', '120.01.A001', 'ALICI A', 50_000),
    ];
    // tahsilat: 102 borc / 120 alacak
    rows.push(...tahsilat('t1', '2026-05-20', '120.01.A001', 'ALICI A', 60_000));
    rows.push(...tahsilat('t2', '2026-06-20', '120.01.A001', 'ALICI A', 60_000));
    const { findings } = full(rows);
    const davranis = findings.filter((f) => /^(CARI_120|CARI_320|DEFTER_TAHSILAT|VERGI_360|SGK_361|PERSONEL_335)/.test(f.category));
    expect(davranis).toEqual([]);
  });
});
