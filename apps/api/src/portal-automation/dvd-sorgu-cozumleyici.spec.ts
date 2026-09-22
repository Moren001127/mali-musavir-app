/**
 * DVD sorgu çözümleyicileri — bilgi/DVD-SORGU-UCLARI.md'deki GERÇEK örnek yanıtlarla.
 */
import {
  asciiBuyuk,
  ayEkle,
  ayinSonGunu,
  eDefterOzeti,
  eDefterPaketCoz,
  eHacizCoz,
  eHacizOzeti,
  gelenEArsivCoz,
  gelenEArsivOzeti,
  gibTarihCoz,
  gunPencereleri,
  hacizTatbikEdilmisMi,
  isoGunuGibTarihi,
  ozetMetni,
  posCoz,
  posOzeti,
  tlBicimle,
  tutarCoz,
  vergiBorcuCoz,
  vergiBorcuOzeti,
  yoklamaDenetimCoz,
  yoklamaDenetimOzeti,
} from './dvd-sorgu-cozumleyici';

describe('ortak yardımcılar — tutar ve tarih', () => {
  it('tutarCoz: GİB sayı/metin biçimlerini number yapar', () => {
    expect(tutarCoz('1448.40')).toBe(1448.4);
    expect(tutarCoz(1420.0)).toBe(1420);
    expect(tutarCoz('379614.21')).toBe(379614.21);
    expect(tutarCoz('16887.67')).toBe(16887.67);
    expect(tutarCoz('1.448,40')).toBe(1448.4);
    expect(tutarCoz(null)).toBe(0);
    expect(tutarCoz('')).toBe(0);
    expect(tutarCoz('bozuk')).toBe(0);
  });

  it('tlBicimle: Türk biçimi', () => {
    expect(tlBicimle(384303.91)).toBe('384.303,91 ₺');
    expect(tlBicimle(0)).toBe('0,00 ₺');
    expect(tlBicimle(224149)).toBe('224.149,00 ₺');
  });

  it('gibTarihCoz: tüm GİB tarih biçimleri ISO olur', () => {
    expect(gibTarihCoz('2026-02-28')).toBe('2026-02-28');
    expect(gibTarihCoz('2026-09-09 21:58:07')).toBe('2026-09-09T21:58:07');
    expect(gibTarihCoz('26.09.2025 - 12:32:16')).toBe('2025-09-26T12:32:16');
    expect(gibTarihCoz('28/03/2026')).toBe('2026-03-28');
    expect(gibTarihCoz('20260228')).toBe('2026-02-28');
    expect(gibTarihCoz('20260914144227')).toBe('2026-09-14T14:42:27');
    expect(gibTarihCoz('')).toBeNull();
    expect(gibTarihCoz(null)).toBeNull();
  });

  it('gunPencereleri: 7 günlük pencereler (uçlar dahil) ve GİB tarih biçimi', () => {
    const p = gunPencereleri('2026-09-01', '2026-09-22', 7);
    expect(p).toEqual([
      { baslangic: '2026-09-01', bitis: '2026-09-07' },
      { baslangic: '2026-09-08', bitis: '2026-09-14' },
      { baslangic: '2026-09-15', bitis: '2026-09-21' },
      { baslangic: '2026-09-22', bitis: '2026-09-22' },
    ]);
    expect(gunPencereleri('2026-09-09', '2026-09-15')).toEqual([{ baslangic: '2026-09-09', bitis: '2026-09-15' }]);
    expect(gunPencereleri('2026-09-15', '2026-09-09')).toEqual([]);
    expect(isoGunuGibTarihi('2026-09-09')).toBe('09/09/2026');
    expect(ayEkle('2026-01', -1)).toBe('2025-12');
    expect(ayinSonGunu('2026-02')).toBe('2026-02-28');
    expect(asciiBuyuk('Haciz tatbik edilmiştir')).toBe('HACIZ TATBIK EDILMISTIR');
  });
});

// ── Vergi borcu: belgedeki debtinformation/true örneği (BÜYÜKÇEKMECE, 14 borç, ozetBilgi 3 tip) ──
const VERGI_BORCU_HAM = {
  borclar: [
    {
      asilBorc: 47168.65,
      belgeNo: '2026031766Ayg0000570',
      donem: '2026/01-2026/01',
      gecikmeZammi: 11751.98,
      odemePlani: [{ gz: 11751.98, indirim: 0, odemeSekilleri: [], taksit: 1, toplam: 58920.63, vab: 47168.65, vade: '20260228' }],
      plaka: null,
      secim: false,
      toplam: 58920.63,
      vadeTarihi: '2026-02-28',
      vdAdi: 'BÜYÜKÇEKMECE',
      vdKodu: '034204',
      vergiKodu: '0015',
      vergiTuru: '0015 GERÇEK USULDE KATMA DEĞER VERGİSİ',
    },
    {
      asilBorc: 4500,
      belgeNo: null,
      donem: '2026/07-2026/07',
      gecikmeZammi: 0,
      odemePlani: [],
      toplam: 4689.7,
      vadeTarihi: '2026-10-26',
      vdAdi: 'BÜYÜKÇEKMECE',
      vdKodu: '034204',
      vergiKodu: '0003',
      vergiTuru: '0003 GELİR VERGİSİ STOPAJI',
    },
  ],
  config: { x: 1 },
  hesaplamaZamani: '22/09/2026 02:31:01',
  messages: null,
  ozelPlakaList: [],
  ozetBilgi: [
    { tip: '1', tipAciklama: 'Vadesi Geçmiş', toplam: '379614.21', toplamGzSum: '11751.98', toplamVabSum: '367862.23', vergiKoduDetay: [] },
    { tip: '2', tipAciklama: 'Vadesi Geçmemiş', toplam: '4689.70', toplamGzSum: '0', toplamVabSum: '4689.70', vergiKoduDetay: [] },
    {
      tip: '3',
      tipAciklama: 'Toplam',
      toplam: '384303.91',
      toplamGzSum: '11751.98',
      toplamVabSum: '372551.93',
      vergiKoduDetay: [
        { vergiKodu: '0015', toplam: '379614.21', gzSum: '11751.98', vabSum: '367862.23' },
        { vergiKodu: '0003', toplam: '4689.70', gzSum: '0', vabSum: '4689.70' },
      ],
    },
  ],
  pageDetail: { pageNo: 1, pageSize: 100, total: 14, totalPage: 1 },
  seciliBorclar: [],
  tcKimlikNo: null,
  tumBorclar: [],
  vergiNo: '2710401229',
};

describe('vergiBorcuCoz — DVD Borç Ödeme ve Detay', () => {
  it('ozetBilgi tiplerini, kalemleri ve tür özetini çıkarır', () => {
    const v = vergiBorcuCoz(VERGI_BORCU_HAM, '2026-09-22');
    expect(v.toplam).toBe(384303.91);
    expect(v.vadesiGecmis).toBe(379614.21);
    expect(v.vadesiGelmemis).toBe(4689.7);
    expect(v.gecikmeZammiToplam).toBe(11751.98);
    expect(v.kalemSayisi).toBe(2);
    expect(v.kalemler[0]).toEqual({
      vergiTuru: '0015 GERÇEK USULDE KATMA DEĞER VERGİSİ',
      vergiKodu: '0015',
      donem: '2026/01-2026/01',
      vadeTarihi: '2026-02-28',
      asilBorc: 47168.65,
      gecikmeZammi: 11751.98,
      toplam: 58920.63,
      vergiDairesi: 'BÜYÜKÇEKMECE',
      vergiDairesiKodu: '034204',
      belgeNo: '2026031766Ayg0000570',
      vadesiGecmisMi: true,
    });
    expect(v.kalemler[1].vadesiGecmisMi).toBe(false);
    expect(v.kalemler[1].belgeNo).toBeNull();
    expect(v.turOzeti).toEqual([
      { vergiKodu: '0015', vergiTuru: '0015 GERÇEK USULDE KATMA DEĞER VERGİSİ', toplam: 379614.21, asilBorc: 367862.23, gecikmeZammi: 11751.98 },
      { vergiKodu: '0003', vergiTuru: '0003 GELİR VERGİSİ STOPAJI', toplam: 4689.7, asilBorc: 4689.7, gecikmeZammi: 0 },
    ]);
    expect(v.hesaplamaZamani).toBe('2026-09-22T02:31:01');
    // ham: config gibi gereksizler atılır, borclar/ozetBilgi kalır
    expect((v.ham as any).config).toBeUndefined();
    expect((v.ham as any).borclar).toHaveLength(2);
  });

  it('özet metni belgedeki örnekle birebir', () => {
    const v = vergiBorcuCoz(VERGI_BORCU_HAM, '2026-09-22');
    expect(vergiBorcuOzeti(v)).toBe('Toplam borç 384.303,91 ₺ (vadesi geçmiş 379.614,21 ₺, 2 kalem)');
    expect(ozetMetni('VERGI_BORCU', v)).toBe(vergiBorcuOzeti(v));
  });

  it('borç yoksa (boş/null liste) sıfır ve "Vergi borcu yok"', () => {
    const v = vergiBorcuCoz({ borclar: null, ozetBilgi: null });
    expect(v.kalemSayisi).toBe(0);
    expect(v.toplam).toBe(0);
    expect(v.turOzeti).toEqual([]);
    expect(vergiBorcuOzeti(v)).toBe('Vergi borcu yok');
    expect(vergiBorcuCoz(null).kalemSayisi).toBe(0);
  });

  it('ozetBilgi gelmezse toplamlar kalemlerden hesaplanır (vade tarihine göre geçmiş/gelmemiş)', () => {
    const v = vergiBorcuCoz({ borclar: VERGI_BORCU_HAM.borclar }, '2026-09-22');
    expect(v.toplam).toBe(63610.33);
    expect(v.vadesiGecmis).toBe(58920.63);
    expect(v.vadesiGelmemis).toBe(4689.7);
    expect(v.gecikmeZammiToplam).toBe(11751.98);
    expect(v.turOzeti.map((t) => t.vergiKodu)).toEqual(['0015', '0003']);
  });
});

// ── e-Haciz: SEDA İŞ GÜVENLİĞİ (3 banka bildirisi) ──
const EHACIZ_BANKA = [
  { durum: 'HACİZ TATBİK EDİLMİŞTİR', hbno: '2026070162L3t0024422', htutar: '16887.67', vdkod: '034294' },
  { durum: 'HACİZ TATBİK EDİLMİŞTİR', hbno: '2026070162L3t0024401', htutar: '113505.77', vdkod: '034294' },
  { durum: 'HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR', hbno: '2026070162L3t0024410', htutar: '43509.54', vdkod: '034294' },
];

describe('eHacizCoz — İnternet Vergi Dairesi e-Haciz', () => {
  it('banka + araç listelerini ve detayları birleştirir; tatbik sayısı ve toplam doğru', () => {
    const detaylar = {
      'BANKA:2026070162L3t0024422': {
        array1: [{ vergiTuru: '0015-KDV GERCEK', vergiDonem: '112025112025', hbbildirino: '2026070162L3t0024422' }],
        array2: [],
      },
    };
    const v = eHacizCoz(EHACIZ_BANKA, [], detaylar, { '034294': 'AVCILAR' });
    expect(v.bildiriSayisi).toBe(3);
    expect(v.tatbikEdilenSayisi).toBe(2);
    expect(v.toplamTutar).toBe(173902.98);
    expect(v.bildiriler[0]).toEqual({
      kapsam: 'BANKA',
      bildiriNo: '2026070162L3t0024422',
      tutar: 16887.67,
      durum: 'HACİZ TATBİK EDİLMİŞTİR',
      vergiDairesiKodu: '034294',
      vergiDairesi: 'AVCILAR',
      borclar: [{ vergiTuru: '0015-KDV GERCEK', vergiDonem: '112025112025' }],
      hesaplar: [],
    });
    expect(v.bildiriler[1].borclar).toEqual([]);
    expect(v.bildiriler[2].vergiDairesi).toBe('AVCILAR');
    expect(eHacizOzeti(v)).toBe('3 bildiri (2 tatbik edilmiş), 173.902,98 ₺');
    expect(ozetMetni('E_HACIZ', v)).toBe(eHacizOzeti(v));
  });

  it('araç kapsamı ayrı işaretlenir; ad eşlemesi yoksa vergiDairesi null', () => {
    const v = eHacizCoz([], [{ durum: 'HACİZ TATBİK EDİLMİŞTİR', hbno: 'ARAC-1', htutar: '100.5', vdkod: '034204' }], { 'ARAC-1': { array1: [], array2: [{ plaka: '34ABC123' }] } });
    expect(v.bildiriler[0].kapsam).toBe('ARAC');
    expect(v.bildiriler[0].vergiDairesi).toBeNull();
    expect(v.bildiriler[0].hesaplar).toEqual([{ plaka: '34ABC123' }]);
    expect(v.toplamTutar).toBe(100.5);
  });

  it('bildiri yoksa ("ADINIZA DÜZENLENMİŞ HACİZ BİLDİRİSİ BİLGİSİ BULUNMAMAKTADIR" → boş liste) "Haciz bildirisi yok"', () => {
    const v = eHacizCoz([], [], {});
    expect(v.bildiriSayisi).toBe(0);
    expect(v.toplamTutar).toBe(0);
    expect(eHacizOzeti(v)).toBe('Haciz bildirisi yok');
    expect(eHacizCoz(null, undefined).bildiriSayisi).toBe(0);
  });

  it('hacizTatbikEdilmisMi: Türkçe İ/Ş ile de ASCII ile de tanır', () => {
    expect(hacizTatbikEdilmisMi('HACİZ TATBİK EDİLMİŞTİR')).toBe(true);
    expect(hacizTatbikEdilmisMi('HACIZ TATBIK EDILMISTIR')).toBe(true);
    expect(hacizTatbikEdilmisMi('HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR')).toBe(false);
    expect(hacizTatbikEdilmisMi('')).toBe(false);
  });
});

// ── Yoklama / Denetim: SEDA İŞ GÜVENLİĞİ (4 yoklama, denetim boş) ──
const YOKLAMA_LIST = [
  { secureId: 'a'.repeat(64), tarih: '26.09.2025 - 12:32:16', vdKoduText: 'AVCILAR (034294)', vdkodu: '034294', ykodu: '20250925Y0342946395DE7727638A', yoklamaTuruText: 'Nakil İşe Başlama', yturu: '11' },
  { secureId: 'b'.repeat(64), tarih: '31.10.2025 - 09:10:00', vdKoduText: 'AVCILAR (034294)', vdkodu: '034294', ykodu: '20251031Y0342946395DE7727999B', yoklamaTuruText: 'Elektronik Ortamda Tüzel Kişilik Açılış Yoklaması', yturu: '16' },
  { secureId: 'c'.repeat(64), tarih: '02.10.2025 - 15:00:00', vdKoduText: 'AVCILAR (034294)', vdkodu: '034294', ykodu: '20251002Y0342946395DE7727111C', yoklamaTuruText: 'Adres Değişikliği', yturu: '12' },
  { secureId: 'd'.repeat(64), tarih: '15.10.2025 - 11:20:00', vdKoduText: 'AVCILAR (034294)', vdkodu: '034294', ykodu: '20251015Y0342946395DE7727222D', yoklamaTuruText: 'Nakil İşe Başlama', yturu: '11' },
];

describe('yoklamaDenetimCoz — DVD e-Yoklamalarım', () => {
  it('yoklamaları ISO tarih + vergi dairesi kodu ile çözer, yeniden eskiye sıralar, PDF işaretini işler', () => {
    const v = yoklamaDenetimCoz(YOKLAMA_LIST, [], ['20250925Y0342946395DE7727638A']);
    expect(v.yoklamaSayisi).toBe(4);
    expect(v.denetimSayisi).toBe(0);
    expect(v.sonYoklamaTarihi).toBe('2025-10-31T09:10:00');
    expect(v.yoklamalar[0].yoklamaKodu).toBe('20251031Y0342946395DE7727999B');
    expect(v.yoklamalar[3]).toEqual({
      yoklamaKodu: '20250925Y0342946395DE7727638A',
      tarih: '2025-09-26T12:32:16',
      vergiDairesi: 'AVCILAR (034294)',
      vergiDairesiKodu: '034294',
      yoklamaTuru: 'Nakil İşe Başlama',
      yoklamaTuruKodu: '11',
      pdfVarMi: true,
      pdfDocumentId: null,
    });
    expect(v.yoklamalar[0].pdfVarMi).toBe(false);
    expect(yoklamaDenetimOzeti(v)).toBe('4 yoklama, 0 denetim; son 31.10.2025');
    expect(ozetMetni('YOKLAMA_DENETIM', v)).toBe(yoklamaDenetimOzeti(v));
  });

  it('denetim satırlarında bilinen alan adayları denenir, ham satır saklanır', () => {
    const v = yoklamaDenetimCoz([], [{ bkodu: 'D-1', denetimAdi: 'Yaygın Yoğun Denetim', denetimTuru: 'Yoklama Fişi', denetimTarihi: '05/06/2026', sonuc: 'Uygun' }]);
    expect(v.denetimSayisi).toBe(1);
    expect(v.denetimler[0].belgeKodu).toBe('D-1');
    expect(v.denetimler[0].denetimAdi).toBe('Yaygın Yoğun Denetim');
    expect(v.denetimler[0].tarih).toBe('2026-06-05');
    expect(v.denetimler[0].sonuc).toBe('Uygun');
    expect((v.denetimler[0].ham as any).bkodu).toBe('D-1');
    expect(v.sonYoklamaTarihi).toBe('2026-06-05');
    expect(yoklamaDenetimOzeti(v)).toBe('0 yoklama, 1 denetim; son 05.06.2026');
  });

  it('boş listeler → "Yoklama / denetim kaydı yok"', () => {
    const v = yoklamaDenetimCoz([], []);
    expect(v.yoklamaSayisi).toBe(0);
    expect(v.sonYoklamaTarihi).toBeNull();
    expect(yoklamaDenetimOzeti(v)).toBe('Yoklama / denetim kaydı yok');
    expect(yoklamaDenetimCoz(null, undefined).yoklamaSayisi).toBe(0);
  });
});

// ── POS: belgedeki VAKIFBANK örneği (2026/07) ──
describe('posCoz — DVD POS İşlem Bilgilerim', () => {
  it('banka listesi + ödeme kuruluşu (null) → satırlar ve toplam', () => {
    const banka = [
      { tutar: 220179.0, unvan: 'VAKIFBANK ', uyeIsyeriNo: '043600000885661', vkn: '9220034970' },
      { tutar: 3970.0, unvan: 'VAKIFBANK ', uyeIsyeriNo: '043600000885662', vkn: '9220034970' },
    ];
    const v = posCoz('2026', '07', banka, null);
    expect(v.yil).toBe(2026);
    expect(v.ay).toBe(7);
    expect(v.satirSayisi).toBe(2);
    expect(v.toplamTutar).toBe(224149);
    expect(v.satirlar[0]).toEqual({ kaynak: 'BANKA', unvan: 'VAKIFBANK', vkn: '9220034970', uyeIsyeriNo: '043600000885661', tutar: 220179 });
    expect(posOzeti(v)).toBe('VAKIFBANK 2 üye işyeri, 224.149,00 ₺');
    expect(ozetMetni('POS', v)).toBe(posOzeti(v));
  });

  it('veri yoksa satır yine üretilir: satirSayisi 0, "POS işlemi yok"', () => {
    const v = posCoz(2026, 8, null, null);
    expect(v.satirSayisi).toBe(0);
    expect(v.toplamTutar).toBe(0);
    expect(posOzeti(v)).toBe('POS işlemi yok');
  });

  it('birden çok banka ve ödeme kuruluşu özetlenir', () => {
    const v = posCoz(2026, 8, [{ tutar: 100, unvan: 'VAKIFBANK', uyeIsyeriNo: '1', vkn: '1' }], [{ tutar: 50.5, unvan: 'IYZICO', uyeIsyeriNo: '2', vkn: '2' }]);
    expect(v.satirlar[1].kaynak).toBe('ODEME_KURULUSU');
    expect(posOzeti(v)).toBe('2 üye işyeri (VAKIFBANK, IYZICO), 150,50 ₺');
  });
});

// ── Gelen e-Arşiv: belgedeki alici-list örneği (MURAT DAYAN, 09–15/09/2026) ──
const EARSIV_FATURA = {
  duzenlenmeTarihi: '2026-09-09 21:58:07',
  faturaNo: 'ARS2026000007485',
  gonderimSekli: 'ELEKTRONIK',
  iptalItirazDurum: null,
  iptalItirazTarihi: null,
  mukellefTckn: '11111111111',
  mukellefVkn: '2710401229',
  odenecekTutar: '1448.40',
  paraBirimi: 'TRY',
  tcknVkn: '22222222222',
  tesisatNumarasi: ' ',
  toplamTutar: 1420.0,
  unvan: 'MURAT DAYAN',
  vergilerTutari: 28.4,
};

describe('gelenEArsivCoz — DVD e-Arşiv Faturalarım (7 günlük pencereler)', () => {
  it('faturaNo ile tekrarsız, aya göre gruplanır; kapsanan boş aylar da satır alır', () => {
    const p1 = { baslangic: '2026-08-26', bitis: '2026-09-01', faturalar: [] };
    const p2 = { baslangic: '2026-09-02', bitis: '2026-09-08', faturalar: [{ ...EARSIV_FATURA, faturaNo: 'ARS2026000007000', duzenlenmeTarihi: '2026-09-03 10:00:00', odenecekTutar: '100.00' }] };
    const p3 = { baslangic: '2026-09-09', bitis: '2026-09-15', faturalar: [EARSIV_FATURA, EARSIV_FATURA, { ...EARSIV_FATURA, faturaNo: 'ARS2026000007486', odenecekTutar: '77196.00', duzenlenmeTarihi: '2026-09-12 08:00:00' }] };
    const satirlar = gelenEArsivCoz([p1, p2, p3]);
    expect(satirlar.map((s) => s.donem)).toEqual(['2026-08', '2026-09']);
    const agustos = satirlar[0].veri;
    expect(agustos.faturaSayisi).toBe(0);
    expect(agustos.baslangic).toBe('2026-08-26');
    expect(agustos.bitis).toBe('2026-08-31');
    expect(agustos.pencereSayisi).toBe(1);
    expect(gelenEArsivOzeti(agustos)).toBe('Gelen e-Arşiv faturası yok');
    const eylul = satirlar[1].veri;
    expect(eylul.faturaSayisi).toBe(3); // ARS…7485 iki pencerede geldi, bir kez sayıldı
    expect(eylul.toplamOdenecek).toBe(78744.4);
    expect(eylul.baslangic).toBe('2026-09-01');
    expect(eylul.bitis).toBe('2026-09-15');
    expect(eylul.pencereSayisi).toBe(3);
    expect(eylul.hataliPencereler).toEqual([]);
    expect(eylul.faturalar[0].faturaNo).toBe('ARS2026000007486'); // yeniden eskiye
    expect(eylul.faturalar[1]).toEqual({
      faturaNo: 'ARS2026000007485',
      duzenlenmeTarihi: '2026-09-09T21:58:07',
      saticiUnvan: 'MURAT DAYAN',
      saticiVkn: '22222222222',
      gonderimSekli: 'ELEKTRONIK',
      toplamTutar: 1420,
      vergilerTutari: 28.4,
      odenecekTutar: 1448.4,
      paraBirimi: 'TRY',
      iptalItirazDurum: null,
    });
    expect(gelenEArsivOzeti(eylul)).toBe('3 fatura, 78.744,40 ₺');
    expect(ozetMetni('GELEN_EARSIV', eylul)).toBe(gelenEArsivOzeti(eylul));
  });

  it('hatalı pencere ilgili ayın hataliPencereler listesine düşer ve özete yansır', () => {
    const satirlar = gelenEArsivCoz([
      { baslangic: '2026-09-01', bitis: '2026-09-07', faturalar: [EARSIV_FATURA] },
      { baslangic: '2026-09-08', bitis: '2026-09-14', faturalar: null, hata: 'HTTP 500' },
    ]);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].veri.hataliPencereler).toEqual([{ baslangic: '2026-09-08', bitis: '2026-09-14', hata: 'HTTP 500' }]);
    expect(gelenEArsivOzeti(satirlar[0].veri)).toBe('1 fatura, 1.448,40 ₺ (1 pencere hatalı)');
  });

  it('pencere yoksa boş; 409 "bulunmamaktadır" penceresi boş fatura listesi olarak gelir', () => {
    expect(gelenEArsivCoz([])).toEqual([]);
    const satirlar = gelenEArsivCoz([{ baslangic: '2026-09-09', bitis: '2026-09-15', faturalar: [] }]);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].donem).toBe('2026-09');
    expect(satirlar[0].veri.faturaSayisi).toBe(0);
  });
});

// ── e-Defter: belgedeki EDEFTER_PAKET_LISTESI_GETIR örneği (202605: KB + YB + Y) ──
const EDEFTER_RESULT = [
  { oid: '2fmu1043a91w8w', paketId: '3241199696-202605-KB-000000', islemOid: '2fmu1043a91w8x', belgeTuru: 'KB', alinmaZamani: '20260914144227', durumKodu: 0, durumAciklama: 'Paket başarı ile işlendi.', dfsPath: 'x.zip', gibDfsPath: 'GIB-x.zip' },
  { oid: '2fmu1043a91w8y', paketId: '3241199696-202605-YB-000000', islemOid: '2fmu1043a91w8z', belgeTuru: 'YB', alinmaZamani: '20260914144230', durumKodu: 0, durumAciklama: 'Paket başarı ile işlendi.', dfsPath: 'y.zip', gibDfsPath: 'GIB-y.zip' },
  { oid: '2fmu1043a91w90', paketId: '3241199696-202605-Y-000000', islemOid: '2fmu1043a91w91', belgeTuru: 'Y', alinmaZamani: '20260914144231', durumKodu: 0, durumAciklama: 'Paket başarı ile işlendi.', dfsPath: ' ', gibDfsPath: 'GIB-z.zip' },
];

describe('eDefterPaketCoz — e-Defter paket listesi', () => {
  it('paketleri EDefterBeratGirdisi şekline çevirir (dönem YYYY-MM, alinmaZamani ISO)', () => {
    const b = eDefterPaketCoz('202605', EDEFTER_RESULT);
    expect(b).toHaveLength(3);
    expect(b[0]).toEqual({
      donem: '2026-05',
      belgeTuru: 'KB',
      paketId: '3241199696-202605-KB-000000',
      islemOid: '2fmu1043a91w8x',
      oid: '2fmu1043a91w8w',
      alinmaZamani: '2026-09-14T14:42:27',
      durumKodu: 0,
      durumAciklama: 'Paket başarı ile işlendi.',
      ham: EDEFTER_RESULT[0],
    });
    expect(b.map((x) => x.belgeTuru)).toEqual(['KB', 'YB', 'Y']);
    expect(eDefterPaketCoz('2026-05', EDEFTER_RESULT)[1].donem).toBe('2026-05');
    expect(eDefterOzeti(b)).toBe('3 paket (KB, YB, Y) — beratlar verildi');
  });

  it('boş/bozuk sonuç → boş liste; paketId olmayan satır atlanır; durumKodu bozuksa null', () => {
    expect(eDefterPaketCoz('202605', null)).toEqual([]);
    expect(eDefterPaketCoz('202605', [{ belgeTuru: 'KB' }])).toEqual([]);
    const b = eDefterPaketCoz('202606', [{ paketId: 'P-1', belgeTuru: 'KB', durumKodu: 'x', alinmaZamani: null }]);
    expect(b[0].durumKodu).toBeNull();
    expect(b[0].alinmaZamani).toBeNull();
    expect(b[0].islemOid).toBeNull();
    expect(eDefterOzeti([])).toBe('Paket yok');
    expect(eDefterOzeti(b)).toBe('1 paket (KB)');
  });
});
