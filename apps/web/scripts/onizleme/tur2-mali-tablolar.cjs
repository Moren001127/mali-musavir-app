// İkinci tur beyaz tema (D) — mali tablolar grubu görüntüleri: Mizan, Gelir Tablosu, Bilanço,
// İşletme Hesap Özeti, e-Defter Kontrol (+ ortak AI mali yorum kutusu).
//   Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007); veri: scripts/mock/mali-tablolar.cjs
//   node apps/web/scripts/onizleme/tur2-mali-tablolar.cjs [modul,modul…] [--cikis=klasor] [--tema=A]
// Her modül: 01 tam sayfa + 02 ilk ekran + ayrıntılar; sahte API'de 404 dönen uçlar ve tarayıcı hataları yazdırılır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const argv = process.argv.slice(2);
const cikisArg = argv.find((a) => a.startsWith('--cikis='));
const temaArg = argv.find((a) => a.startsWith('--tema='));
const TEMA = temaArg ? temaArg.slice(7) : 'D';
const KOK_CIKIS = cikisArg ? cikisArg.slice(8) : path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul2');
const secilen = argv.filter((a) => !a.startsWith('--')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
const hatalar = []; // modül başına sıfırlanır; ek adımlar da buraya yazar

// ── e-Defter: yerleşik sahte oturum küçük (3 bulgu); önizlemede tarayıcı isteği zengin dökümle karşılanır ──
function edefterFixture() {
  const simdi = new Date().toISOString();
  const taxpayer = { id: 'm-edefter', type: 'TUZEL_KISI', companyName: 'Örnek Nakliyat Ltd. Şti.', firstName: null, lastName: null, taxNumber: '0000000000', defterTuru: 'BILANCO', status: 'active' };
  const f = (id, severity, category, hesapKodu, message, detail = {}, status = 'OPEN', rowIndex = null) => ({ id, sessionId: 's-ornek', severity, category, hesapKodu, message, detail, status, createdAt: simdi, rowIndex });
  const findings = [
    f('f1', 'ERROR', 'DEFTER_GENELI_DENGESIZ', null, 'Toplam borç ile alacak eşit değil (fark 12,00 TL). Berat oluşturmadan önce dengesiz fiş düzeltilmelidir.', { tutar: 12 }),
    f('f2', 'ERROR', 'VKN_ALGORITMA_HATALI', '320.01.004', '320.01.004 KARDEŞLER PETROL: VKN 1234567890 kontrol algoritmasından geçmiyor. Ba/Bs formunda uyumsuzluk yaratır.', { tutar: 84300, hesapAdi: 'KARDEŞLER PETROL' }, 'OPEN', 118),
    f('f3', 'ERROR', 'HAVADA_KDV_KAYDI', '191.01', '191.01 İndirilecek KDV %20: 3.420,00 TL KDV kaydının matrah ya da karşılık hesabı yok. Fatura satırı eksik girilmiş olabilir.', { tutar: 3420 }, 'OPEN', 214),
    f('f4', 'WARN', 'CARI_320_ODEME_YOK', '320.01.001', '320.01.001 ANADOLU PETROL A.Ş.: dönemde 6 alış faturası (612.400,00 TL) işlenmiş, ödeme kaydı yok. Vade aşımı ya da eksik banka kaydı olabilir.', { tutar: 612400, hesapAdi: 'ANADOLU PETROL A.Ş.' }),
    f('f5', 'WARN', 'CARI_320_ODEME_YOK', '320.01.002', '320.01.002 MARMARA LASTİK LTD.: dönemde 3 alış faturası (148.900,00 TL) işlenmiş, ödeme kaydı yok.', { tutar: 148900, hesapAdi: 'MARMARA LASTİK LTD.' }),
    f('f6', 'WARN', 'CARI_TERS_BAKIYE_120', '120.01.007', '120.01.007 EGE LOJİSTİK: 24.600,00 TL alacak (ters) bakiye veriyor. Müşteri avansı olabilir ya da alış faturası 320 yerine 120\'ye işlenmiş olabilir.', { tutar: 24600, hesapAdi: 'EGE LOJİSTİK' }, 'RESOLVED'),
    f('f7', 'WARN', 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', '320.01.001', '320.01.001 ANADOLU PETROL A.Ş.: 14.05.2026 tarihinde 68.500,00 TL tutarlı 2 kayıt var. Mükerrer fatura girişi kontrol edilmeli.', { tutar: 68500, hesapAdi: 'ANADOLU PETROL A.Ş.' }, 'OPEN', 97),
    f('f8', 'WARN', 'KASA_30000_TEVSIK', '100.01', '100.01 Merkez Kasa: 22.05.2026 tarihli 41.200,00 TL nakit tahsilat 30.000 TL tevsik sınırının üstünde. Banka üzerinden yapılmalıydı.', { tutar: 41200 }, 'OPEN', 305),
    f('f9', 'INFO', 'OZELLIKLI_549_YENILEME_FONU', '549', "549 Özel Fonlar'da 988.131,88 TL bakiye var. Yenileme fonu üç yıl içinde kullanılmalı; süre 2027 sonunda doluyor.", { tutar: 988131.88 }),
    f('f10', 'INFO', 'AMORTISMAN_AYRILMAMIS', '254', '254 Taşıtlar 1.240.000,00 TL; dönem içinde 257 hareketi görünmüyor. Geçici vergi döneminde amortisman ayrılması tercihe bağlıdır.', { tutar: 1240000 }, 'IGNORED'),
    f('f11', 'INFO', 'HESAP_KODU_EKSIK', null, 'Satır 412: hesap kodu boş bırakılmış; açıklama "banka masrafı".', { tutar: 0 }, 'OPEN', 412),
  ];
  const lines = [
    { id: 'l1', rowIndex: 96, voucherKey: 'Y-118', yevmiyeNo: '118', fisTarihi: '2026-05-14', evrakNo: 'AP2026000000341', hesapKodu: '153.01', hesapAdi: 'Ticari Mallar - Akaryakıt', aciklama: 'Anadolu Petrol mazot alışı', borc: 57083.33, alacak: 0 },
    { id: 'l2', rowIndex: 97, voucherKey: 'Y-118', yevmiyeNo: '118', fisTarihi: '2026-05-14', evrakNo: 'AP2026000000341', hesapKodu: '191.01', hesapAdi: 'İndirilecek KDV %20', aciklama: 'Anadolu Petrol mazot alışı', borc: 11416.67, alacak: 0 },
    { id: 'l3', rowIndex: 98, voucherKey: 'Y-118', yevmiyeNo: '118', fisTarihi: '2026-05-14', evrakNo: 'AP2026000000341', hesapKodu: '320.01.001', hesapAdi: 'ANADOLU PETROL A.Ş.', aciklama: 'Anadolu Petrol mazot alışı', borc: 0, alacak: 68500 },
    { id: 'l4', rowIndex: 213, voucherKey: 'Y-201', yevmiyeNo: '201', fisTarihi: '2026-06-02', evrakNo: 'BM-06-02', hesapKodu: '191.01', hesapAdi: 'İndirilecek KDV %20', aciklama: 'Banka masrafı KDV', borc: 3420, alacak: 0 },
    { id: 'l5', rowIndex: 214, voucherKey: 'Y-201', yevmiyeNo: '201', fisTarihi: '2026-06-02', evrakNo: 'BM-06-02', hesapKodu: '102.01', hesapAdi: 'Ziraat Bankası', aciklama: 'Banka masrafı KDV', borc: 0, alacak: 3408 },
    { id: 'l6', rowIndex: 304, voucherKey: 'Y-260', yevmiyeNo: '260', fisTarihi: '2026-05-22', evrakNo: 'TAH-0522', hesapKodu: '100.01', hesapAdi: 'Merkez Kasa', aciklama: 'Ege Lojistik nakit tahsilat', borc: 41200, alacak: 0 },
    { id: 'l7', rowIndex: 305, voucherKey: 'Y-260', yevmiyeNo: '260', fisTarihi: '2026-05-22', evrakNo: 'TAH-0522', hesapKodu: '120.01.007', hesapAdi: 'EGE LOJİSTİK', aciklama: 'Ege Lojistik nakit tahsilat', borc: 0, alacak: 41200 },
  ];
  const hesaplar = [
    { kod: '100.01', ad: 'Merkez Kasa', ana: '100', borc: 486230, alacak: 444100, borcAdet: 41, alacakAdet: 63, acilis: 12400, kapanis: 54530, mizanKapanis: 54530, hareketsiz: false },
    { kod: '102.01', ad: 'Ziraat Bankası', ana: '102', borc: 2104880.35, alacak: 1698400, borcAdet: 118, alacakAdet: 204, acilis: 96500, kapanis: 502980.35, mizanKapanis: 502980.35, hareketsiz: false },
    { kod: '120.01.007', ad: 'EGE LOJİSTİK', ana: '120', borc: 146200, alacak: 170800, borcAdet: 6, alacakAdet: 7, acilis: 0, kapanis: -24600, mizanKapanis: -24600, hareketsiz: false },
    { kod: '153.01', ad: 'Ticari Mallar - Akaryakıt', ana: '153', borc: 3998970, alacak: 3512750, borcAdet: 72, alacakAdet: 3, acilis: 391600, kapanis: 877820, mizanKapanis: 877820, hareketsiz: false },
    { kod: '191.01', ad: 'İndirilecek KDV %20', ana: '191', borc: 641320, alacak: 502900, borcAdet: 96, alacakAdet: 3, acilis: 0, kapanis: 138420, mizanKapanis: 138420, hareketsiz: false },
    { kod: '254', ad: 'Taşıtlar', ana: '254', borc: 0, alacak: 0, borcAdet: 0, alacakAdet: 0, acilis: 1240000, kapanis: 1240000, mizanKapanis: 1240000, hareketsiz: true },
    { kod: '320.01.001', ad: 'ANADOLU PETROL A.Ş.', ana: '320', borc: 0, alacak: 612400, borcAdet: 0, alacakAdet: 6, acilis: -84000, kapanis: -696400, mizanKapanis: -696400, hareketsiz: false },
    { kod: '320.01.002', ad: 'MARMARA LASTİK LTD.', ana: '320', borc: 0, alacak: 148900, borcAdet: 0, alacakAdet: 3, acilis: 0, kapanis: -148900, mizanKapanis: -148900, hareketsiz: false },
    { kod: '320.01.004', ad: 'KARDEŞLER PETROL', ana: '320', borc: 84300, alacak: 84300, borcAdet: 2, alacakAdet: 2, acilis: 0, kapanis: 0, mizanKapanis: 0, hareketsiz: false },
    { kod: '549', ad: 'Özel Fonlar', ana: '549', borc: 0, alacak: 0, borcAdet: 0, alacakAdet: 0, acilis: -988131.88, kapanis: -988131.88, mizanKapanis: -988131.88, hareketsiz: true },
  ];
  const kapsam = [
    ['DEFTER_GENELI_DENGESIZ', 'BULGU', 1], ['HESAP_KODU_EKSIK', 'BULGU', 1], ['DONEM_DISI_TARIH', 'TEMIZ', 0], ['FIS_TARIHI_PARSE_HATASI', 'TEMIZ', 0],
    ['VKN_FORMAT_HATALI', 'TEMIZ', 0], ['VKN_ALGORITMA_HATALI', 'BULGU', 1], ['GERCEK_MUKERRER_FATURA', 'TEMIZ', 0], ['AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', 'BULGU', 1],
    ['HAVADA_KDV_KAYDI', 'BULGU', 1], ['CARI_TERS_BAKIYE_120', 'BULGU', 1], ['CARI_TERS_BAKIYE_320', 'TEMIZ', 0], ['CARI_320_ODEME_YOK', 'BULGU', 2],
    ['KASA_30000_TEVSIK', 'BULGU', 1], ['KASA_NEGATIF', 'TEMIZ', 0], ['BANKA_NEGATIF', 'TEMIZ', 0], ['OZELLIKLI_549_YENILEME_FONU', 'BULGU', 1],
    ['AMORTISMAN_AYRILMAMIS', 'BULGU', 1], ['STOK_NEGATIF', 'TEMIZ', 0], ['KAPANIS_YAPILMAMIS', 'UYGULANMAZ', 0], ['KURUMLAR_VERGISI_TAHAKKUKU', 'UYGULANMAZ', 0],
    ['MIZAN_DENGESIZ', 'TEMIZ', 0], ['KDV_INDIRIM_YAPILMAMIS', 'VERI_YOK', 0], ['SGK_ODEME_GECIKME', 'PASIF', 0],
  ].map(([kod, durum, bulgu]) => ({ kod, durum, bulgu }));
  const kontrolOzeti = {
    surum: 3, uretim: simdi,
    ozet: { kural: 150, calisti: 141, temiz: 128, bulgulu: 10, uygulanmaz: 6, veriYok: 3, pasif: 3, hesap: 184, hareketsizHesap: 12, mizanVar: true, aySayisi: 3 },
    kapsam, hesaplar,
  };
  const session = {
    id: 's-ornek', tenantId: 'moren', taxpayerId: taxpayer.id, donem: '2026-Q2', donemTipi: 'GECICI_Q2', kaynak: 'LUCA', status: 'READY',
    totalLines: 2614, totalVouchers: 812, findingCount: findings.length, rawExcelSize: 0, notes: null, createdBy: 'sahte', createdAt: simdi, updatedAt: simdi,
    kontrolOzeti, lines, taxpayer, findings,
  };
  const mizan = { id: 'mz-ornek', donem: '2026-Q2', donemTipi: 'GECICI_Q2', status: 'READY', createdAt: simdi, updatedAt: simdi, hesapCount: 184, anomaliler: [
    { id: 'a1', mizanId: 'mz-ornek', hesapKodu: '191.03.001', tip: 'ZIT_BAKIYE', seviye: 'WARN', mesaj: '191.03.001 "SATIŞTAN İADE İND KDV %20" normalde borç bakiyesi verir ama alacak bakiyesi var', detay: null },
    { id: 'a2', mizanId: 'mz-ornek', hesapKodu: '131', tip: 'ORTAK_CARI_CIFT_YONLU', seviye: 'WARN', mesaj: '131 "ORTAKLARDAN ALACAKLAR" ve 331 aynı dönemde bakiye veriyor', detay: null },
  ] };
  const kural = (kod, ad, aciklama, oneri, siddet, alan, mevzuat, varsayilanAktif = true, mizanGerekli = false) => ({ kod, ad, aciklama, oneri, siddet, alan, mevzuat, varsayilanAktif, mizanGerekli, motor: 'HDD' });
  const catalog = [
    kural('DEFTER_GENELI_DENGESIZ', 'Defter geneli borç = alacak', 'Tüm dönem toplam borç ile alacak eşit değil.', 'Dengesiz fişi bulup düzeltin; berat öncesi zorunlu.', 'ERROR', 'Temel Bütünlük', 'VUK 219'),
    kural('HESAP_KODU_EKSIK', 'Hesap kodu eksik', 'Satırda hesap kodu boş.', 'Satırı Luca\'da tamamlayın.', 'ERROR', 'Temel Bütünlük', 'VUK 219'),
    kural('DONEM_DISI_TARIH', 'Dönem dışı tarih', 'Fiş tarihi dönem aralığının dışında.', '', 'ERROR', 'Temel Bütünlük', 'VUK 219'),
    kural('FIS_TARIHI_PARSE_HATASI', 'Tarih okunamadı', 'Excel sütununda tarih okunamayan satırlar.', '', 'WARN', 'Temel Bütünlük'),
    kural('VKN_FORMAT_HATALI', 'VKN/TCKN biçim hatası', 'VKN 10 ya da TCKN 11 haneli değil.', '', 'ERROR', 'Cari Hesaplar (120/320)', 'Ba/Bs'),
    kural('VKN_ALGORITMA_HATALI', 'VKN/TCKN algoritması tutmuyor', 'Hane sayısı doğru ama kontrol algoritması başarısız.', 'Cari kartındaki VKN\'yi GİB sorgusuyla doğrulayın.', 'ERROR', 'Cari Hesaplar (120/320)', 'Ba/Bs'),
    kural('GERCEK_MUKERRER_FATURA', 'Gerçek mükerrer fatura', 'Aynı belge no + VKN + tutar birden fazla.', '', 'ERROR', 'Yevmiye / Fiş', 'KDVK 29'),
    kural('AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', 'Aynı gün / tutar / taraf', 'Aynı tarihte aynı VKN için aynı tutarlı kayıt birden fazla.', 'Fatura görsellerini karşılaştırın; mükerrerse birini iptal edin.', 'WARN', 'Yevmiye / Fiş'),
    kural('HAVADA_KDV_KAYDI', 'Havada KDV kaydı', '191/391 KDV var ama matrah ya da karşılık hesabı yok.', 'Fişi açıp eksik satırı tamamlayın.', 'ERROR', 'KDV', 'KDVK 29/34'),
    kural('CARI_TERS_BAKIYE_120', '120 ters bakiye', '120 Alıcılar alacak bakiyesi veriyor.', 'Avans ise 340\'a virman yapın.', 'WARN', 'Cari Hesaplar (120/320)', 'TDHP'),
    kural('CARI_TERS_BAKIYE_320', '320 ters bakiye', '320 Satıcılar borç bakiyesi veriyor.', '', 'WARN', 'Cari Hesaplar (120/320)', 'TDHP'),
    kural('CARI_320_ODEME_YOK', 'Satıcıya ödeme kaydı yok', 'Dönemde alış faturası var, ödeme hareketi yok.', 'Banka ekstresiyle karşılaştırın; ödenmediyse vade takibi yapın.', 'WARN', 'Cari Hesaplar (120/320)', 'VUK 227'),
    kural('KASA_30000_TEVSIK', 'Kasa 30.000 TL tevsik', 'Nakit tahsilat/ödeme tevsik sınırının üstünde.', 'Tutarı banka aracılığıyla yaptırın.', 'WARN', 'Kasa & Banka', 'VUK 459 Seri No'),
    kural('KASA_NEGATIF', 'Kasa negatif', '100 Kasa alacak bakiyesi veriyor.', '', 'ERROR', 'Kasa & Banka', 'TDHP'),
    kural('BANKA_NEGATIF', 'Banka negatif', '102 Banka alacak bakiyesi veriyor.', '', 'WARN', 'Kasa & Banka', 'TDHP'),
    kural('OZELLIKLI_549_YENILEME_FONU', '549 yenileme fonu süresi', 'Yenileme fonu üç yıl içinde kullanılmalı.', 'Süre dolmadan yeni kıymet alın ya da fonu kâra ekleyin.', 'INFO', 'Özkaynak & Özellikli Hesaplar', 'VUK 328'),
    kural('AMORTISMAN_AYRILMAMIS', 'Amortisman ayrılmamış', 'Sabit kıymet var, 257 hareketi yok.', '', 'INFO', 'Duran Varlık & Amortisman', 'VUK 313'),
    kural('STOK_NEGATIF', 'Stok negatif', 'Stok hesabı alacak bakiyesi veriyor.', '', 'ERROR', 'Stok & Maliyet', 'TDHP'),
    kural('KAPANIS_YAPILMAMIS', 'Yıl sonu kapanış yapılmamış', '6xx hesapları kapatılmamış.', '', 'WARN', 'Dönem Sonu / Açılış-Kapanış', 'TDHP'),
    kural('KURUMLAR_VERGISI_TAHAKKUKU', 'Kurumlar vergisi tahakkuku', '370/371 kapama hareketi yok.', '', 'WARN', 'Dönem Sonu / Açılış-Kapanış', 'KVK 32'),
    kural('MIZAN_DENGESIZ', 'Mizan dengesiz', 'Mizan toplam borç ile alacak eşit değil.', '', 'ERROR', 'Mizan Mutabakatı', 'VUK 219', true, true),
    kural('KDV_INDIRIM_YAPILMAMIS', 'KDV indirimi yapılmamış', '191 mizanda bakiye veriyor.', '', 'WARN', 'KDV', 'KDVK 29', true, true),
    kural('SGK_ODEME_GECIKME', 'SGK ödemesi gecikmiş', '361 bakiyesi vade sonrasına sarkıyor.', '', 'WARN', 'Vergi & SGK Ödemeleri (335/360/361)', '5510 s.K. 88', false),
  ];
  return { taxpayer, session, mizan, catalog };
}

const MODULLER = {
  mizan: {
    yol: '/panel/mizan',
    hazirla: async (pg) => {
      // mükellef seç (başlıkta ad görünsün)
      await pg.getByRole('button', { name: /Mükellef seç/ }).first().click();
      await pg.getByPlaceholder('Ara…').fill('Öz Ela');
      await pg.getByRole('button', { name: /Öz Ela/ }).first().click();
      await pg.waitForTimeout(1200);
    },
    ayrinti: ['[data-mizan-report]'],
    ek: async (pg, CIKIS) => {
      const kriter = pg.locator('button', { hasText: 'Kriterler' }).first();
      if (await kriter.count()) {
        try { await kriter.click({ timeout: 8000 }); } catch (e) {
          await pg.screenshot({ path: path.join(CIKIS, '_dbg-ek.png') });
          const dugmeler = await pg.locator('button').evaluateAll((els) => els.map((x) => x.textContent.trim()).filter(Boolean).slice(0, 40));
          hatalar.push('kriter tıklanamadı; düğmeler: ' + JSON.stringify(dugmeler) + ' — ' + String(e).slice(0, 300));
          return;
        }
        await pg.waitForTimeout(600);
        const kart = pg.locator('.financial-report-readable > div.rounded-xl.border.p-4').first();
        if (await kart.count()) { await kart.scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(CIKIS, '04-denetim-kriterleri.png'), clip: { x: 224, y: 0, width: 1276, height: 1000 } }); }
        const form = pg.locator('.financial-report-readable > div.rounded-xl.border.p-4 div.rounded-xl.border[class*="p-3.5"]').nth(1);
        if (await form.count()) { await form.scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await form.screenshot({ path: path.join(CIKIS, '07-kriter-formu.png') }); }
        await pg.locator('button', { hasText: 'Kapat' }).first().evaluate((el) => el.click()); await pg.waitForTimeout(300);
      }
      await pg.evaluate(() => { const m = document.querySelector('[data-panel-main]'); if (m) m.scrollTop = 0; });
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(CIKIS, '05-ust-bolum.png'), clip: { x: 224, y: 60, width: 1276, height: 620 } });
    },
  },
  'gelir-tablosu': {
    yol: '/panel/gelir-tablosu',
    hazirla: async (pg) => {
      await pg.getByRole('button', { name: /Mükellef seç/ }).first().click();
      await pg.getByPlaceholder('Ara…').fill('Öz Ela');
      await pg.getByRole('button', { name: /Öz Ela/ }).first().click();
      await pg.waitForTimeout(1500);
    },
    ayrinti: ['[data-gelir-report] table', '[data-gelir-ratios]', '[data-gelir-report] [data-gelir-history]'],
    ek: async (pg, CIKIS) => {
      await pg.evaluate(() => { const m = document.querySelector('[data-panel-main]'); if (m) m.scrollTop = 0; });
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(CIKIS, '06-ust-bolum.png'), clip: { x: 224, y: 60, width: 1276, height: 640 } });
    },
  },
  bilanco: {
    yol: '/panel/bilanco',
    hazirla: async (pg) => {
      await pg.getByRole('button', { name: /Mükellef seç/ }).first().click();
      await pg.getByPlaceholder('Ara…').fill('Öz Ela');
      await pg.getByRole('button', { name: /Öz Ela/ }).first().click();
      await pg.waitForTimeout(1500);
    },
    ayrinti: ['[data-bilanco-report]', '[data-bilanco-ratios]', '[data-mali-yorum]'],
    ek: async (pg, CIKIS) => {
      await pg.evaluate(() => { const m = document.querySelector('[data-panel-main]'); if (m) m.scrollTop = 0; });
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(CIKIS, '06-ust-bolum.png'), clip: { x: 224, y: 60, width: 1276, height: 640 } });
    },
  },
  'isletme-hesap-ozeti': {
    yol: '/panel/isletme-hesap-ozeti',
    hazirla: async (pg) => {
      await pg.getByRole('button', { name: /Mükellef seç/ }).first().click();
      await pg.getByPlaceholder('Ad / VKN ara…').fill('Erdoğan');
      await pg.getByRole('button', { name: /Erdoğan/ }).first().click();
      await pg.waitForTimeout(1500);
    },
    ayrinti: ['[data-report-sections]', '[data-mali-yorum]'],
    ek: async (pg, CIKIS) => {
      await pg.evaluate(() => { const m = document.querySelector('[data-panel-main]'); if (m) m.scrollTop = 0; });
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(CIKIS, '05-ust-bolum.png'), clip: { x: 224, y: 60, width: 1276, height: 640 } });
    },
  },
  'e-defter': {
    yol: '/panel/ajanlar/e-defter',
    rota: async (pg) => {
      const fx = edefterFixture();
      await pg.route(/\/api\/v1\/edefter-control(\?.*)?$/, (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const { findings, lines, kontrolOzeti, ...rest } = fx.session;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ ...rest, _count: { lines: lines.length, findings: findings.length } }]) });
      });
      await pg.route(/\/api\/v1\/edefter-control\/rule-settings$/, (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: [], defaultDisabledCodes: ['SGK_ODEME_GECIKME'], catalog: fx.catalog, manuelKurallar: [] }) });
      });
      await pg.route(/\/api\/v1\/edefter-control\/s-ornek$/, (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...fx.session, companionMizan: fx.mizan }) });
      });
    },
    hazirla: async (pg) => {
      // Sahte oturum 2026 2. çeyrek — çeyrek düğmesi "2"
      const q2 = pg.locator('[data-edefter-control] button[aria-pressed]', { hasText: /^2$/ }).first();
      if (await q2.count()) { await q2.click(); await pg.waitForTimeout(1500); }
    },
    ayrinti: ['[data-edefter-control] .ed-summary', '[data-edefter-control] .ed-findings'],
    ek: async (pg, CIKIS) => {
      const sekme = async (ad, dosya, secici) => {
        const b = pg.locator('[data-ed-tab]', { hasText: ad }).first();
        if (!(await b.count())) return;
        await b.click(); await pg.waitForTimeout(900);
        await tamSayfa(pg, path.join(CIKIS, dosya));
        if (secici) { const l = pg.locator(secici).first(); if (await l.count()) { try { await l.screenshot({ path: path.join(CIKIS, dosya.replace('.png', '-ayrinti.png')) }); } catch { /* */ } } }
      };
      await sekme('Hesaplar', '10-hesaplar.png', '[data-edefter-control] table');
      await sekme('Fiş Satırları', '11-fis-satirlari.png');
      await sekme('Mizan Denetimi', '12-mizan-denetimi.png');
      await sekme('Kontrol Kuralları', '13-kontrol-kurallari.png');
      await sekme('Geçmiş Kontroller', '14-gecmis.png');
      await sekme('Bulgular', '15-bulgular.png');
    },
  },
};
const hedefler = secilen.length ? secilen : Object.keys(MODULLER);

// Paylaşılan geliştirme sunucusunda başka ajanların yarım kalan içe aktarımları geçici derleme hatası üretir;
// sayfa sağlıklı gelene kadar (en çok ~4 dk) yeniden dener.
async function saglamGit(pg, url) {
  for (let deneme = 0; deneme < 12; deneme++) {
    const yanit = await pg.goto(url, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => null);
    await pg.waitForTimeout(800);
    const bozuk = await pg.evaluate(() => {
      const portal = document.querySelector('nextjs-portal');
      const metin = (portal && portal.shadowRoot ? portal.shadowRoot.textContent : '') || '';
      return /Build Error|Module not found|Failed to compile/i.test(metin) || /Module not found/.test(document.body.innerText || '');
    }).catch(() => false);
    if (yanit && yanit.status() < 500 && !bozuk) return;
    console.warn(`[onizleme] sayfa hazır değil (${yanit ? yanit.status() : 'yanıt yok'}${bozuk ? ', derleme hatası' : ''}) — 20 sn sonra yeniden: ${url}`);
    await pg.waitForTimeout(20000);
  }
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const eksikUclar = new Set();
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 200)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 200)));
  pg.on('response', (r) => { if (r.status() === 404 && r.url().includes('/api/v1/')) eksikUclar.add(r.request().method() + ' ' + r.url().replace(/^.*\/api\/v1/, '')); });
  await saglamGit(pg, `${KOK}/giris/musavir`);
  await pg.locator('input[type=email]').waitFor({ timeout: 60000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000, waitUntil: 'commit' });
  await pg.waitForTimeout(1500);
  if (TEMA !== 'D') {
    await pg.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('moren-theme', t); } catch { /* */ } }, TEMA);
  }
  const rapor = {};
  for (const ad of hedefler) {
    const m = MODULLER[ad];
    if (!m) { console.warn('bilinmeyen modül', ad); continue; }
    const CIKIS = path.join(KOK_CIKIS, ad);
    fs.mkdirSync(CIKIS, { recursive: true });
    hatalar.length = 0; eksikUclar.clear();
    if (typeof m.rota === 'function') await m.rota(pg);
    await saglamGit(pg, `${KOK}${m.yol}`);
    if (TEMA !== 'D') await pg.evaluate((t) => document.documentElement.setAttribute('data-theme', t), TEMA);
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(2000);
    try { if (typeof m.hazirla === 'function') await m.hazirla(pg); } catch (e) { hatalar.push('hazirla: ' + String(e).slice(0, 160)); }
    await pg.waitForTimeout(800);
    await pg.mouse.move(2, 2);
    await pg.screenshot({ path: path.join(CIKIS, '02-ilk-ekran.png') });
    await tamSayfa(pg, path.join(CIKIS, '01-tam-sayfa.png'));
    let n = 3;
    for (const sec of m.ayrinti) {
      const loc = pg.locator(sec).first();
      if (await loc.count()) { try { await loc.scrollIntoViewIfNeeded(); await pg.waitForTimeout(200); await loc.screenshot({ path: path.join(CIKIS, `${String(n).padStart(2, '0')}-ayrinti.png`) }); n++; } catch (e) { hatalar.push('ayrinti ' + sec + ': ' + String(e).slice(0, 120)); } }
    }
    if (typeof m.ek === 'function') { try { await m.ek(pg, CIKIS, tamSayfa); } catch (e) { hatalar.push('ek: ' + String(e).slice(0, 600)); } }
    const tasma = await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]') || document.documentElement; return el.scrollWidth > el.clientWidth + 2; });
    rapor[ad] = { hatalar: [...hatalar], eksikUclar: [...eksikUclar], yatayTasma: tasma, cikis: CIKIS };
    if (typeof m.rota === 'function') await pg.unrouteAll({ behavior: 'ignoreErrors' });
  }
  console.log(JSON.stringify(rapor, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
