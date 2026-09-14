import { hatirlatmaMesaji, kategoriAdi, ornekKalemler, trTarih } from './gorev-hatirlatma-metni';

const SIMDI = new Date('2026-09-14T06:00:00Z'); // 09:00 İstanbul

describe('gorev-hatirlatma-metni', () => {
  it('örnek şablon: başlık + özet + üç bölüm + bağlantı + ÖRNEK uyarısı; geciken gün sırasına göre', () => {
    const m = hatirlatmaMesaji({ hitap: 'Muzaffer Bey' }, ornekKalemler(), SIMDI, 'https://portal.morenmusavirlik.com/', true);
    const satirlar = m.split('\n');
    expect(satirlar[0]).toBe('⏰ GÖREV HATIRLATMA (ÖRNEK) · 14.09.2026 09:00');
    expect(satirlar[1]).toBe('Muzaffer Bey, bugün 2 görev, 1 yaklaşan, 1 geciken var.');
    expect(m).toContain('📌 BUGÜN\n1) Öz Ela Gıda — Ağustos KDV kontrolü\n   Bugün saat 10:00 · ACİL · KDV Kontrol\n   Not: Devreden KDV Luca ile karşılaştırılacak\n2) Famcoffee — Tahsilat araması\n   Bugün · Tahsilat');
    expect(m).toContain('🔜 YAKLAŞIYOR\n• Erdoğan Balçık — Banka ekstresi iste\n   15.09.2026 Salı · Yüksek · Banka');
    expect(m).toContain('⚠️ GECİKEN\n• Sultan Osman İnşaat — Sermaye artırımı raporu\n   6 gün gecikti (vade 08.09.2026) · ACİL · Diğer');
    expect(m).toContain('🔗 Görevler: https://portal.morenmusavirlik.com/panel/gorevler');
    expect(m.endsWith('ℹ️ Bu bir şablon denemesidir; içerik gerçek değildir.')).toBe(true);
  });

  it('tek kalem: numarasız madde; mükellefsiz görev; uzun not kısaltılır; ÖRNEK yok', () => {
    const m = hatirlatmaMesaji({ hitap: 'Sayın Büşra Nur Ören' }, [{ id: 'x', baslik: 'Ofis kirası', tip: 'VADE', vadeGunu: '2026-09-14', kategori: 'OFIS', oncelik: 'MEDIUM', aciklama: 'a'.repeat(200) }], SIMDI, 'https://p');
    expect(m).toContain('Sayın Büşra Nur Ören, bugün 1 görev var.');
    expect(m).toContain('• Ofis kirası\n   Bugün · Ofis\n   Not: ' + 'a'.repeat(137) + '…');
    expect(m).not.toContain('ÖRNEK');
    expect(m).toContain('🔗 Görevler: https://p/panel/gorevler');
  });

  it('yardımcılar: kategori adı (bilinmeyen → düzgün yazım), tarih biçimi', () => {
    expect(kategoriAdi('KDV_KONTROL')).toBe('KDV Kontrol');
    expect(kategoriAdi('MIHSAP_EVRAK')).toBe('Mihsap Evrak');
    expect(kategoriAdi(null)).toBe('');
    expect(trTarih('2026-09-08')).toBe('08.09.2026');
  });
});
