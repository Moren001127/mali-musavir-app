import {
  canliModIstendi,
  raporMetniAyikla,
  sesCevabiOlustur,
  sesGoreviOlustur,
  sesIcinSadelestir,
  sesKoordinatorAcik,
} from './ses-koordinator';

describe('ses-koordinator — env kapısı', () => {
  it('varsayılan AÇIK; yalnız off kapatır', () => {
    expect(sesKoordinatorAcik({} as any)).toBe(true);
    expect(sesKoordinatorAcik({ EKIP_SES_KOORDINATOR: 'on' } as any)).toBe(true);
    expect(sesKoordinatorAcik({ EKIP_SES_KOORDINATOR: 'OFF' } as any)).toBe(false);
    expect(sesKoordinatorAcik({ EKIP_SES_KOORDINATOR: ' off ' } as any)).toBe(false);
  });
});

describe('ses-koordinator — canlı mod kalıbı', () => {
  it('sözlü canlı isteğini yakalar', () => {
    for (const q of [
      'Tahir Sucu için KDV tahakkukunu canlı yap',
      'bunu gerçek çalıştır',
      'canlı modda çalıştır lütfen',
      'kuru test olmasın, gerçekten kaydet',
      'Kuru testi kapat',
    ]) expect(canliModIstendi(q)).toBe(true);
  });

  it('normal soruları ve olumsuz kalıpları canlı saymaz', () => {
    for (const q of [
      'Haziran KDV\'ler ne durumda?',
      'canlı yapma, sadece bak',
      'kuru test olsun',
      'gerçek kişi mi bu mükellef',
      '',
    ]) expect(canliModIstendi(q)).toBe(false);
  });
});

describe('ses-koordinator — rapor ayıklama', () => {
  it('RAPOR/SORU bölümlerini alır, ÖĞRENDİM satırını atar, markdown temizler', () => {
    const rapor = [
      'Önce araçları çağırdım.',
      '**RAPOR:** Haziran döneminde **3 mükellef** beyanname bekliyor.',
      '- İlgi Oto: KDV kontrol bitti.',
      'SORU: Tahir Sucu için devam edeyim mi?',
      'ÖĞRENDİM: Sahip haziranı önce sorar.',
    ].join('\n');
    const r = raporMetniAyikla(rapor);
    expect(r.rapor).toBe('Haziran döneminde 3 mükellef beyanname bekliyor. İlgi Oto: KDV kontrol bitti.');
    expect(r.soru).toBe('Tahir Sucu için devam edeyim mi?');
    expect(r.rapor).not.toContain('ÖĞRENDİM');
  });

  it('RAPOR yoksa tüm metni kullanır', () => {
    expect(raporMetniAyikla('Veri yok.').rapor).toBe('Veri yok.');
    expect(sesIcinSadelestir('# Başlık\n* madde bir\n`kod`')).toBe('Başlık\nmadde bir\nkod');
  });
});

describe('ses-koordinator — sesli cevap', () => {
  it('kuru test + onay bekleyen + soru tek cümle olur; canlıda başa CANLI modda gelir', () => {
    const c = sesCevabiOlustur({
      rapor: 'RAPOR: Beş fatura okundu.\nSORU: Devam edeyim mi?',
      kuruTestSayisi: 2,
      onayBekleyen: [{ previewId: 'PRV-1A2B', name: 'send_whatsapp_freeform', confirmationText: 'ONAYLIYORUM #PRV-1A2B' }],
      dryRun: false,
    });
    expect(c.startsWith('CANLI modda.')).toBe(true);
    expect(c).toContain('Beş fatura okundu.');
    expect(c).toContain('Kuru testte 2 adım yapılmadı');
    expect(c).toContain('ONAYLIYORUM #PRV-1A2B');
    expect(c).toContain('Devam edeyim mi?');
  });

  it('zaman aşımında kısa "hâlâ çalışıyorum" der', () => {
    const c = sesCevabiOlustur({ rapor: '', kuruTestSayisi: 0, onayBekleyen: [], dryRun: true, zamanAsimi: true });
    expect(c).toMatch(/Hâlâ çalışıyorum/);
    expect(c.length).toBeLessThan(200);
  });

  it('hata + boş raporda hatayı kısa söyler; uzun raporu kırpar', () => {
    expect(sesCevabiOlustur({ rapor: '', kuruTestSayisi: 0, onayBekleyen: [], dryRun: true, hata: 'Max bağlı değil' })).toContain('İşi bitiremedim');
    const uzun = Array.from({ length: 40 }, (_, i) => `Cümle ${i + 1} burada.`).join(' ');
    const c = sesCevabiOlustur({ rapor: uzun, kuruTestSayisi: 0, onayBekleyen: [], dryRun: true });
    expect(c.length).toBeLessThanOrEqual(430);
  });
});

describe('ses-koordinator — görev metni', () => {
  it('bağlam satırları ve SORU/KOMUT', () => {
    const g = sesGoreviOlustur({ question: 'Haziran KDV ne durumda', currentPath: '/panel/kdv-kontrol', taxpayerAdi: 'İlgi Oto', canli: true });
    expect(g).toContain('Aktif portal ekranı: /panel/kdv-kontrol.');
    expect(g).toContain('Seçili mükellef: İlgi Oto.');
    expect(g).toContain('CANLI');
    expect(g.endsWith('SORU/KOMUT: Haziran KDV ne durumda')).toBe(true);
  });
});
