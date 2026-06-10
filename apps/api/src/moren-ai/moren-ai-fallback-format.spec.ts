/**
 * WhatsApp ŞABLON garantisi + soru-kapısı testleri.
 *
 * Gerçek vakalar (2026-06-10):
 * 1) "Gito'nun gelir tablosunu analiz et, vergiyi söyle" → Max boş döndü →
 *    yedek yol DÜZ CÜMLE gönderdi, vergi cevapsız kaldı.
 * 2) "beyannameyi gönder" → KDV KONTROL şablonu cevaba yapıştı (alakasız modül).
 * Bu testler iki vakayı da kilitler.
 */
import { MorenAiService } from './moren-ai.service';
import { sablonForTool } from './whatsapp-sablon';

function svc(): any {
  // Test edilen metotlar bağımlılık kullanmaz — DI olmadan prototip yeterli.
  const s: any = Object.create(MorenAiService.prototype);
  s.logger = { warn: () => undefined, log: () => undefined, error: () => undefined };
  return s;
}

const GT_OZET = [
  '📈 GELİR TABLOSU — 2026-Q1',
  '',
  '💰 KALEMLER',
  '• Net Satışlar: 1.808.986,95 ₺',
  '• Dönem Net Kârı: 104.808,01 ₺ (%5,8)',
].join('\n');

const GT_RESULT = {
  donem: '2026-Q1',
  whatsappOzet: GT_OZET,
  kalemler: { netSatislar: 1808986.95, brutSatisKari: 275256.04, faaliyetKari: 104807.81, donemNetKari: 104808.01, vergiKarsiligi: 26201.95 },
};

const BILANCO_RESULT = {
  donem: '2026-Q1',
  whatsappOzet: '📊 BİLANÇO — 2026-Q1\n\n🏦 AKTİF\n• Aktif Toplamı: 1.000,00 ₺',
  aktif: { donenVarliklar: 500, aktifToplami: 1000 },
  pasif: { kvYabanciKaynak: 250, ozkaynaklar: -10 },
  dengeliMi: true,
};

const KDV_RESULT = {
  whatsappOzet: '🧾 KDV KONTROL — 2026/04\n\n📊 EŞLEŞME\n• Eşleşen: 12',
  aktifSeanslar: [],
  arsivlenenlerden: [],
};

describe('Yedek yol (Max boş) — şablonlu cevap', () => {
  it('gelir tablosu: ŞABLON + vergi satırı + yorum, düz cümle YOK', () => {
    const out = svc().formatGelirTablosuAnswer(GT_RESULT, { isim: 'GİTO GIDA' });
    expect(out).toContain('📈 GELİR TABLOSU — 2026-Q1');
    expect(out).toContain('GİTO GIDA');
    expect(out).toContain('Vergi Karşılığı');
    expect(out).toContain('📊 YORUM');
    expect(out).not.toContain('gelir tablosu bulundu.');
  });

  it('soruya göre tablo seçer: "bilanço" diyene bilanço döner (gelir tablosu değil)', () => {
    const logs = [
      { name: 'get_gelir_tablosu', input: {}, result: GT_RESULT },
      { name: 'get_bilanco', input: {}, result: BILANCO_RESULT },
    ];
    const out = svc().buildToolOnlyAnswer(logs, 'Gito bilanço analizini yap');
    expect(out).toContain('📊 BİLANÇO');
    expect(out).not.toContain('📈 GELİR TABLOSU');
  });

  it('bilanço: şablon + cari oran + TTK 376 (negatif özkaynak)', () => {
    const out = svc().formatBilancoAnswer(BILANCO_RESULT, null);
    expect(out).toContain('📊 BİLANÇO — 2026-Q1');
    expect(out).toContain('📐 YORUM');
    expect(out).toContain('Cari Oran: 2');
    expect(out).toContain('TTK 376');
  });

  it('mizan: şablon + yorum', () => {
    const out = svc().formatMizanAnswer(
      { donem: '2026-05', whatsappOzet: '📒 MİZAN — 2026-05\n\n💰 TOPLAMLAR\n• Toplam Borç: 1,00 ₺', dengeliMi: false },
      { isim: 'X LTD' },
    );
    expect(out).toContain('📒 MİZAN — 2026-05');
    expect(out).toContain('borç/alacak farkı');
  });

  it('finansal tablo yoksa diğer şablonlar devreye girer (beyanname örneği)', () => {
    const logs = [{
      name: 'list_beyan_kayitlari', input: {}, result: {
        adet: 2,
        kayitlar: [
          { beyanTipi: 'KDV1', donem: '2026-04', verildi: true, tahakkukTutari: 55411.67, beyanTarihi: '2026-05-24', mukellef: 'GİTO GIDA' },
          { beyanTipi: 'MUHSGK', donem: '2026-04', verildi: true, tahakkukTutari: 939.7, beyanTarihi: '2026-05-21', mukellef: 'GİTO GIDA' },
        ],
      },
    }];
    const out = svc().buildToolOnlyAnswer(logs, 'gito nisan kdv beyannamesi verildi mi');
    expect(out).toContain('📝 BEYANNAME — GİTO GIDA');
    expect(out).toContain('✅ VERİLDİ');
    expect(out).toContain('55.411,67 TL');
  });
});

describe('Soru-kapısı — alakasız şablon yapışmaz', () => {
  it('"beyannameyi gönder" KDV KONTROL şablonunu TETİKLEMEZ', () => {
    expect(sablonForTool('get_kdv_summary', KDV_RESULT, 'Gito nun nisan beyannamesini gönder')).toBeNull();
  });

  it('"kdv kontrol sonucu" KDV KONTROL şablonunu tetikler', () => {
    expect(sablonForTool('get_kdv_summary', KDV_RESULT, 'gito kdv kontrol sonucu nasıl')).toContain('🧾 KDV KONTROL');
  });

  it('applyWhatsappOzet: beyanname-gönder sorusunda kdv bloğu eklenmez, metin aynen kalır', () => {
    const logs = [{ name: 'get_kdv_summary', input: {}, result: KDV_RESULT }];
    const out = svc().applyWhatsappOzet('Belge gönderimi için onay gerekiyor.', logs, false, 'beyannameyi gönder');
    expect(out).toBe('Belge gönderimi için onay gerekiyor.');
  });

  it('applyWhatsappOzet: bilanço sorusunda SADECE bilanço bloğu eklenir', () => {
    const logs = [
      { name: 'get_gelir_tablosu', input: {}, result: GT_RESULT },
      { name: 'get_bilanco', input: {}, result: BILANCO_RESULT },
      { name: 'get_kdv_summary', input: {}, result: KDV_RESULT },
    ];
    const out = svc().applyWhatsappOzet('Özkaynak negatif, dikkat.', logs, false, 'bilançoyu analiz et');
    expect(out).toContain('📊 BİLANÇO');
    expect(out).toContain('📊 YORUM\nÖzkaynak negatif, dikkat.');
    expect(out).not.toContain('📈 GELİR TABLOSU');
    expect(out).not.toContain('🧾 KDV');
  });

  it('applyWhatsappOzet: model şablonu zaten yazdıysa ikinci kez eklenmez', () => {
    const logs = [{ name: 'get_gelir_tablosu', input: {}, result: GT_RESULT }];
    const hazir = '📈 GELİR TABLOSU — 2026-Q1\nzaten şablonlu';
    expect(svc().applyWhatsappOzet(hazir, logs, false, 'gelir tablosu analizi')).toBe(hazir);
  });

  it('sesli modda şablon eklenmez', () => {
    const logs = [{ name: 'get_gelir_tablosu', input: {}, result: GT_RESULT }];
    expect(svc().applyWhatsappOzet('kısa cevap', logs, true, 'gelir tablosu')).toBe('kısa cevap');
  });
});

describe('Merkezi şablonlar — diğer veri tipleri', () => {
  it('beyan özeti', () => {
    const out = sablonForTool('get_beyan_ozet', {
      donem: '2026-05',
      satirlar: [{ beyanTipi: 'KDV1', toplam: 10, onaylanan: 5, bekleyen: 5, hatali: 0 }],
    }, 'bu ay beyan durumu özeti');
    expect(out).toContain('📝 BEYAN ÖZETİ — 2026-05');
    expect(out).toContain('KDV1: 5/10 onaylı · 5 bekliyor');
  });

  it('rasyolar + TTK uyarısı', () => {
    const out = sablonForTool('calculate_financial_ratios', {
      donem: '2026-Q1',
      rasyolar: { cariOran: { deger: 1.56, yorum: 'Sağlıklı' }, netKarMarji: { deger: 0.058 } },
      uyarilar: ['⚠️ **Özkaynak negatif** — TTK m.376'],
    }, 'rasyo analizi yap');
    expect(out).toContain('📐 RASYOLAR');
    expect(out).toContain('Cari Oran: 1,56');
    expect(out).toContain('TTK m.376');
  });

  it('HGS', () => {
    const out = sablonForTool('list_araclar_hgs', {
      ozet: { toplamArac: 5, ihlalliArac: 1, toplamTutar: 540 },
      araclar: [{ plaka: '34ABC123', ihlalSayisi: 3, toplamTutar: 540 }],
    }, 'hgs ihlali olan araç var mı');
    expect(out).toContain('🚗 HGS DURUMU');
    expect(out).toContain('34ABC123 — 3 ihlal');
  });

  it('tahsilat riski', () => {
    const out = sablonForTool('get_collection_risk_summary', {
      toplamBorclu: 3, toplamBakiye: 15000, enRiskli: [{ ad: 'X LTD', bakiye: 9000 }],
    }, 'tahsilat riski olan borçlular');
    expect(out).toContain('💰 TAHSİLAT RİSKİ');
    expect(out).toContain('X LTD: 9.000,00 TL');
  });

  it('dönem karşılaştırma', () => {
    const out = sablonForTool('compare_periods', {
      donem1: '2025-Q1', donem2: '2026-Q1',
      'karsilaştırma': { netSatislar: { donem1: 1000, donem2: 1500, fark: 500, degismeYuzdesi: 50 } },
    }, '2025 ile 2026 yı karşılaştır');
    expect(out).toContain('📊 KARŞILAŞTIRMA — 2025-Q1 → 2026-Q1');
    expect(out).toContain('Net Satışlar');
    expect(out).toContain('▲');
  });

  it('hata sonucu / kapı tutmayan soru → null', () => {
    expect(sablonForTool('get_gelir_tablosu', { error: 'yok' }, 'gelir tablosu')).toBeNull();
    expect(sablonForTool('get_payroll_summary', { toplamPersonel: 3, aktifPersonel: 3 }, 'merhaba')).toBeNull();
  });
});
