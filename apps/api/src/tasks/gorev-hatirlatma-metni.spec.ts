import { hatirlatmaMesaji, kategoriAdi, ornekKalemler, trTarih } from './gorev-hatirlatma-metni';

const SIMDI = new Date('2026-09-14T06:00:00Z'); // Pazartesi 09:00 İstanbul

describe('gorev-hatirlatma-metni', () => {
  it('örnek şablon: başlık + tarih + çizgi + selam + özet + üç bölüm + bağlantı + imza + ÖRNEK uyarısı', () => {
    const m = hatirlatmaMesaji({ hitap: 'Muzaffer Bey' }, ornekKalemler(SIMDI), SIMDI, 'https://portal.morenmusavirlik.com/', true);
    expect(m).toBe(
      [
        '🗓️ *GÖREV HATIRLATMA (ÖRNEK)*',
        'Pazartesi, 14 Eylül 2026 · 09:00',
        '━━━━━━━━━━━━━━━━━━━━',
        'Muzaffer Bey, günaydın.',
        'Bugün *2 görev*, 1 yaklaşan, 1 geciken var.',
        '',
        '*BUGÜN*',
        '① *Öz Ela Gıda* — Ağustos KDV kontrolü',
        '    10:00 · 🔴 Acil · KDV Kontrol',
        '    _Devreden KDV Luca ile karşılaştırılacak_',
        '② *Famcoffee* — Tahsilat araması',
        '    Tüm gün · Tahsilat',
        '',
        '*YAKLAŞAN*',
        '▸ *Erdoğan Balçık* — Banka ekstresi iste',
        '    Yarın, Salı 15.09 · Yüksek · Banka',
        '',
        '*GECİKEN*',
        '▸ *Sultan Osman İnşaat* — Sermaye artırımı raporu',
        '    6 gündür bekliyor · vade 08.09 · 🔴 Acil · Diğer',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        'Görevler → portal.morenmusavirlik.com/panel/gorevler',
        '_Elif · Moren Ofis Asistanı_',
        '',
        '_Bu bir şablon denemesidir; içerik gerçek değildir._',
      ].join('\n'),
    );
  });

  it('tek yaklaşan kalem, akşam selamı, mükellefsiz, uzun not kısaltılır, özel imza, ÖRNEK yok', () => {
    const aksam = new Date('2026-09-14T15:30:00Z'); // 18:30
    const m = hatirlatmaMesaji(
      { hitap: 'Sayın Büşra Nur Ören', imza: 'Moren Ofis' },
      [{ id: 'x', baslik: 'Ofis kirası', tip: 'ONCEDEN', vadeGunu: '2026-09-17', saat: '14:00', kategori: 'OFIS', oncelik: 'MEDIUM', aciklama: 'a'.repeat(200) }],
      aksam,
      'https://p',
    );
    expect(m).toContain('Sayın Büşra Nur Ören, iyi akşamlar.\n1 yaklaşan var.');
    expect(m).toContain('*YAKLAŞAN*\n▸ Ofis kirası\n    Perşembe 17.09 14:00 · Ofis\n    _' + 'a'.repeat(117) + '…_');
    expect(m).not.toContain('ÖRNEK');
    expect(m).not.toContain('BUGÜN');
    expect(m).toContain('Görevler → p/panel/gorevler\n_Moren Ofis_');
  });

  it('öğlen selamı; geciken sırası gün azalan; ①…⑩ sonra •', () => {
    const oglen = new Date('2026-09-14T10:00:00Z'); // 13:00
    const bugunler = Array.from({ length: 11 }, (_, i) => ({ id: `b${i}`, baslik: `G${i}`, tip: 'VADE' as const, vadeGunu: '2026-09-14' }));
    const m = hatirlatmaMesaji({ hitap: 'Muzaffer Bey' }, [
      ...bugunler,
      { id: 'g1', baslik: 'Az', tip: 'GECIKME', vadeGunu: '2026-09-12', gecikmeGun: 2 },
      { id: 'g2', baslik: 'Çok', tip: 'GECIKME', vadeGunu: '2026-09-04', gecikmeGun: 10 },
    ], oglen, 'https://p');
    expect(m).toContain('Muzaffer Bey, iyi günler.\nBugün *11 görev*, 2 geciken var.');
    expect(m).toContain('⑩ G9\n    Tüm gün\n• G10');
    expect(m.indexOf('▸ Çok')).toBeLessThan(m.indexOf('▸ Az'));
  });

  it('yardımcılar: kategori adı (bilinmeyen → düzgün yazım), tarih biçimi', () => {
    expect(kategoriAdi('KDV_KONTROL')).toBe('KDV Kontrol');
    expect(kategoriAdi('MIHSAP_EVRAK')).toBe('Mihsap Evrak');
    expect(kategoriAdi(null)).toBe('');
    expect(trTarih('2026-09-08')).toBe('08.09.2026');
  });
});
