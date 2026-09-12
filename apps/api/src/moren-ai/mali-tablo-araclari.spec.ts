/**
 * Mali tablo araçları — 2026-09-12 pilot (FATİH GEDİK, kuru test) kusurlarının kilit testleri:
 *  1) compare_periods: bilanco/mizan kaynağı BOŞ dönüyordu (anahtar d1.aktif'ten, değer d1[key]'den okunuyordu);
 *     "MIZAN"/"GELIR_TABLOSU" büyük harf → "Bilinmeyen kaynak" (geçerli değerler söylenmiyordu).
 *  2) get_mizan: 100 hesapla kesiyordu (144 hesaplık mizanda 44 hesap görünmüyordu); dizi önek süzgeci boş dönüyordu.
 *  3) calculate_financial_ratios: Q2 (geçici vergi dönemi) bilançosu yokken açıklamasız hata; "Q2"+yil kabul edilmiyordu.
 * Prisma sahte (bellek içi); canlı DB gerekmez.
 */
import { ToolExecutorService } from './tool-executor.service';

const ctx = { tenantId: 't1', userId: 'u1', taxpayerId: null };
const TP = 'cmnydmgcc000neazyxm9hlmlo';

type Satir = { tenantId: string; taxpayerId: string; donem: string; createdAt: Date; [k: string]: any };

function prismaKur(veri: { mizanlar?: Satir[]; bilancolar?: Satir[]; gelirTablolari?: Satir[] }) {
  const esles = (r: Satir, where: any) =>
    r.tenantId === where.tenantId &&
    r.taxpayerId === where.taxpayerId &&
    (where.donem == null || (typeof where.donem === 'string' ? r.donem === where.donem : where.donem.in.includes(r.donem)));
  const tablo = (rows: Satir[]) => ({
    findFirst: async ({ where, include }: any) => {
      const hit = rows.filter((r) => esles(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (!hit) return null;
      return include ? { hesaplar: [], anomaliler: [], ...hit } : hit;
    },
    findMany: async ({ where }: any) => rows.filter((r) => esles(r, where)).map((r) => ({ donem: r.donem })),
  });
  return {
    mizan: tablo(veri.mizanlar || []),
    bilanco: tablo(veri.bilancolar || []),
    gelirTablosu: tablo(veri.gelirTablolari || []),
  };
}

function hesapUret(adet: number, kokler = ['1', '2', '3', '5', '6', '7']) {
  const out: any[] = [];
  for (let i = 0; i < adet; i++) {
    const kok = kokler[i % kokler.length];
    const kod = `${kok}${String(i).padStart(2, '0')}.${String(i % 7).padStart(2, '0')}`;
    out.push({ hesapKodu: kod, hesapAdi: `HESAP ${kod}`, borcToplami: 100 + i, alacakToplami: 50 + i, borcBakiye: 50, alacakBakiye: 0 });
  }
  return out.sort((a, b) => a.hesapKodu.localeCompare(b.hesapKodu));
}

const mizanSatiri = (donem: string, hesaplar: any[], ekstra: any = {}): Satir => ({
  id: `mz-${donem}`,
  tenantId: 't1',
  taxpayerId: TP,
  donem,
  donemTipi: donem.includes('Q') ? `GECICI_${donem.split('-')[1]}` : 'AYLIK',
  kaynak: 'LUCA',
  status: 'READY',
  locked: false,
  createdAt: new Date('2026-09-10T12:00:00Z'),
  hesaplar,
  anomaliler: [],
  ...ekstra,
});

const bilancoSatiri = (donem: string, ek: any = {}): Satir => ({
  id: `bl-${donem}`,
  tenantId: 't1',
  taxpayerId: TP,
  donem,
  donemTipi: 'GECICI_Q1',
  tarih: new Date('2026-03-31'),
  locked: false,
  createdAt: new Date('2026-05-01'),
  donenVarliklar: 1000,
  duranVarliklar: 500,
  aktifToplami: 1500,
  kvYabanciKaynak: 400,
  uvYabanciKaynak: 100,
  ozkaynaklar: 1000,
  pasifToplami: 1500,
  aktif: {
    hazirDegerler: { grup: '10 Hazır Değerler', toplam: 600, hesaplar: [{ kod: '100', ad: 'KASA', tutar: 100 }, { kod: '102', ad: 'BANKALAR', tutar: 500 }] },
    ticariAlacaklar: { grup: '12 Ticari Alacaklar', toplam: 400, hesaplar: [{ kod: '120', ad: 'ALICILAR', tutar: 400 }] },
  },
  pasif: {
    ticariBorclar: { grup: '32 Ticari Borçlar', toplam: 400, hesaplar: [{ kod: '320', ad: 'SATICILAR', tutar: 400 }] },
    sermaye: { grup: '50 Ödenmiş Sermaye', toplam: 1000, hesaplar: [{ kod: '500', ad: 'SERMAYE', tutar: 1000 }] },
  },
  ...ek,
});

const gelirTablosuSatiri = (donem: string, ek: any = {}): Satir => ({
  id: `gt-${donem}`,
  tenantId: 't1',
  taxpayerId: TP,
  donem,
  donemTipi: 'GECICI_Q1',
  locked: false,
  createdAt: new Date('2026-05-01'),
  brutSatislar: 1000, satisIndirimleri: 0, netSatislar: 1000, satisMaliyeti: 600, brutSatisKari: 400,
  faaliyetGiderleri: 100, faaliyetKari: 300, digerGelirler: 0, digerGiderler: 0, finansmanGiderleri: 0,
  olaganKar: 300, olaganDisiGelir: 0, olaganDisiGider: 0, donemKari: 300, vergiKarsiligi: 60, donemNetKari: 240,
  notes: null,
  ...ek,
});

function aracKur(veri: Parameters<typeof prismaKur>[0]) {
  return new ToolExecutorService(prismaKur(veri) as any, undefined);
}

// ────────────────────────────────────────────────────────────────
describe('get_mizan — 100 hesap tavanı kalktı, sayfalama + önek süzgeci', () => {
  it('144 hesaplık mizanın TAMAMI döner (eski tavan 100 idi); truncated:false', async () => {
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q2', hesapUret(144))] });
    const r = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.hesaplar).toHaveLength(144);
    expect(r.toplamHesap).toBe(144);
    expect(r.truncated).toBe(false);
    expect(r.hesapSayisiToplam).toBe(144); // geriye uyum alanı
    expect(r.mizanId).toBe('mz-2026-Q2');
  });

  it('400 üstü mizan: sayfa 1 = 400 hesap, truncated:true + toplamHesap + daraltma notu; sayfa:3 kalanı; sayfa:4 hata', async () => {
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q2', hesapUret(900))] });
    const s1 = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2' }, ctx);
    expect(s1.hesaplar).toHaveLength(400);
    expect(s1.truncated).toBe(true);
    expect(s1.toplamHesap).toBe(900);
    expect(s1.toplamSayfa).toBe(3);
    expect(s1.daraltmaNotu).toMatch(/hesapKodu:'136'/);
    expect(s1.daraltmaNotu).toMatch(/sayfa:2/);
    // Toplamlar tüm hesaplar üzerinden (sayfadan bağımsız)
    expect(s1.hesapSayisi).toBe(900);

    const s3 = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2', sayfa: 3 }, ctx);
    expect(s3.hesaplar).toHaveLength(100);
    expect(s3.sayfa).toBe(3);
    expect(s3.truncated).toBe(true);
    // Sayfalar kesişmez, birleşimi tüm mizandır
    const s2 = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2', sayfa: 2 }, ctx);
    const kodlar = new Set([...s1.hesaplar, ...s2.hesaplar, ...s3.hesaplar].map((h: any) => h.hesapKodu));
    expect(kodlar.size).toBe(900);

    const s4 = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2', sayfa: 4 }, ctx);
    expect(s4.error).toMatch(/sayfa 4 yok/);
  });

  it('önek süzgeci: hesapKodu "136", dizi ["100","102"] ve "100,102" metni aynı sonucu verir (dizi eskiden boş dönüyordu)', async () => {
    const hesaplar = [
      ...hesapUret(30, ['2', '3', '5', '7']),
      { hesapKodu: '136', hesapAdi: 'DİĞER ÇEŞİTLİ ALACAKLAR', borcToplami: 10, alacakToplami: 0, borcBakiye: 10, alacakBakiye: 0 },
      { hesapKodu: '136.22', hesapAdi: 'PERSONEL', borcToplami: 4, alacakToplami: 0, borcBakiye: 4, alacakBakiye: 0 },
      { hesapKodu: '100', hesapAdi: 'KASA', borcToplami: 1, alacakToplami: 0, borcBakiye: 1, alacakBakiye: 0 },
      { hesapKodu: '102.01', hesapAdi: 'BANKA', borcToplami: 2, alacakToplami: 0, borcBakiye: 2, alacakBakiye: 0 },
    ];
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q2', hesaplar)] });
    const grup = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2', hesapKodu: '136' }, ctx);
    expect(grup.hesaplar.map((h: any) => h.hesapKodu)).toEqual(['136', '136.22']);
    expect(grup.hesapKoduFiltresi).toEqual(['136']);

    const dizi = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2', hesapKoduFiltresi: ['100', '102'] }, ctx);
    const metin = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q2', hesapKoduFiltresi: '100,102' }, ctx);
    const kodlar = (r: any) => r.hesaplar.map((h: any) => h.hesapKodu).sort();
    expect(kodlar(dizi)).toEqual(['100', '102.01']);
    expect(kodlar(metin)).toEqual(kodlar(dizi));
    expect(dizi.toplamBorc).toBe(3);
  });

  it('dönem yoksa hata mevcut mizan dönemlerini ve biçimi söyler', async () => {
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q1', hesapUret(5)), mizanSatiri('2026-Q2', hesapUret(5))] });
    const r = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-Q3' }, ctx);
    expect(r.error).toMatch(/2026-Q3 dönemine ait mizan bulunamadı/);
    expect(r.error).toMatch(/Mevcut mizan dönemleri: 2026-Q2, 2026-Q1/);
    expect(r.error).toMatch(/YYYY-Qn/);
    expect(r.mevcutDonemler).toEqual(['2026-Q2', '2026-Q1']);
  });

  it('"2026-06" istenince "2026-Q2" etiketli kayıt bulunur (çeyrek sonu ayı = geçici dönem)', async () => {
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q2', hesapUret(3))] });
    const r = await tool.execute('get_mizan', { taxpayerId: TP, donem: '2026-06' }, ctx);
    expect(r.donem).toBe('2026-Q2');
  });
});

// ────────────────────────────────────────────────────────────────
describe('compare_periods — bilanco/mizan gerçek kırılım, geçersiz kaynak/dönem açıklamalı hata', () => {
  const q1 = hesapUret(20);
  // Q2: 100 kasa +500, bir hesap kapandı, bir yeni hesap açıldı
  const q2 = q1
    .filter((h) => h.hesapKodu !== q1[3].hesapKodu)
    .map((h) => (h.hesapKodu === q1[0].hesapKodu ? { ...h, borcBakiye: h.borcBakiye + 500 } : { ...h }))
    .concat([{ hesapKodu: '136.22', hesapAdi: 'PERSONELDEN ALACAK', borcToplami: 70, alacakToplami: 0, borcBakiye: 70, alacakBakiye: 0 }]);

  it('kaynak "MIZAN" (büyük harf) kabul edilir; hesap bazında fark, yeni/kapanan hesap, toplamlar', async () => {
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q1', q1, { createdAt: new Date('2026-05-18') }), mizanSatiri('2026-Q2', q2)] });
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'MIZAN' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.kaynak).toBe('mizan');
    expect(r.karsilastirilanHesap).toBe(21);
    expect(r.enBuyukFarklar[0]).toMatchObject({ hesapKodu: q1[0].hesapKodu, donem1: 50, donem2: 550, fark: 500, degismeYuzdesi: 1000 });
    expect(r.yeniHesaplar).toEqual(['136.22']);
    expect(r.kapananHesaplar).toEqual([q1[3].hesapKodu]);
    expect(r.enBuyukFarklar.find((s: any) => s.hesapKodu === '136.22')).toMatchObject({ durum: 'yeni', donem1: 0, donem2: 70, degismeYuzdesi: null });
    expect(r.toplamlar.toplamBorc.fark).toBeCloseTo(q2.reduce((s, h) => s + h.borcToplami, 0) - q1.reduce((s, h) => s + h.borcToplami, 0), 2);
    // WhatsApp şablonu için düz harita korunur
    expect(r['karsilaştırma'].toplamBorc).toBeDefined();
    expect(r.not).toMatch(/KÜMÜLATİF/);
  });

  it('mizan: hesapKoduFiltresi ile daraltılır; en büyük fark listesi 30 ile sınırlı', async () => {
    const buyuk1 = hesapUret(120);
    const buyuk2 = buyuk1.map((h, i) => ({ ...h, borcBakiye: h.borcBakiye + i }));
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q1', buyuk1), mizanSatiri('2026-Q2', buyuk2)] });
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'mizan' }, ctx);
    expect(r.enBuyukFarklar).toHaveLength(30);
    expect(r.degisenHesap).toBe(119);
    const dar = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'mizan', hesapKoduFiltresi: '6' }, ctx);
    expect(dar.karsilastirilanHesap).toBe(buyuk1.filter((h) => h.hesapKodu.startsWith('6')).length);
    expect(dar.hesapKoduFiltresi).toEqual(['6']);
  });

  it('mizan hiyerarşisi (1 → 12 → 120 → 120.01 → 120.01.001): enBuyukFarklar yalnız yaprak, anaHesapFarklari yalnız 3 haneli', async () => {
    const satir = (kod: string, ad: string, bakiye: number) => ({ hesapKodu: kod, hesapAdi: ad, borcToplami: bakiye, alacakToplami: 0, borcBakiye: bakiye, alacakBakiye: 0 });
    const kademeli = (b: number) => [satir('1', 'DÖNEN VARLIKLAR', b), satir('12', 'TİCARİ ALACAKLAR', b), satir('120', 'ALICILAR', b), satir('120.01', 'ALICILAR', b), satir('120.01.001', 'AHMET', b)];
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q1', kademeli(100)), mizanSatiri('2026-Q2', kademeli(600))] });
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'mizan' }, ctx);
    expect(r.karsilastirilanHesap).toBe(5);
    expect(r.yaprakHesapSayisi).toBe(1);
    expect(r.enBuyukFarklar.map((s: any) => s.hesapKodu)).toEqual(['120.01.001']);
    expect(r.enBuyukFarklar[0]).toMatchObject({ donem1: 100, donem2: 600, fark: 500, degismeYuzdesi: 500 });
    expect(r.anaHesapFarklari.map((s: any) => s.hesapKodu)).toEqual(['120']);
    expect(r.not).toMatch(/yaprak/);
  });

  it('kaynak "bilanco": toplamlar + grup/hesap kırılımı dolu (eskiden BOŞ dönüyordu)', async () => {
    const tool = aracKur({
      bilancolar: [
        bilancoSatiri('2026-Q1'),
        bilancoSatiri('2026-Q2', {
          donenVarliklar: 1600, aktifToplami: 2100, kvYabanciKaynak: 900, pasifToplami: 2100, ozkaynaklar: 1100,
          aktif: {
            hazirDegerler: { grup: '10 Hazır Değerler', toplam: 1200, hesaplar: [{ kod: '100', ad: 'KASA', tutar: 100 }, { kod: '102', ad: 'BANKALAR', tutar: 1100 }] },
            ticariAlacaklar: { grup: '12 Ticari Alacaklar', toplam: 400, hesaplar: [{ kod: '120', ad: 'ALICILAR', tutar: 400 }] },
          },
          pasif: {
            ticariBorclar: { grup: '32 Ticari Borçlar', toplam: 900, hesaplar: [{ kod: '320', ad: 'SATICILAR', tutar: 900 }] },
            sermaye: { grup: '50 Ödenmiş Sermaye', toplam: 1000, hesaplar: [{ kod: '500', ad: 'SERMAYE', tutar: 1000 }] },
            donemKar: { grup: '59 Dönem Net Kar/Zarar', toplam: 100, hesaplar: [{ kod: '590', ad: 'DÖNEM NET KARI', tutar: 100 }] },
          },
        }),
      ],
    });
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'bilanco' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.toplamlar.donenVarliklar).toEqual({ donem1: 1000, donem2: 1600, fark: 600, degismeYuzdesi: 60 });
    expect(r.toplamlar.kvYabanciKaynak.fark).toBe(500);
    expect(r['karsilaştırma'].aktifToplami.fark).toBe(600); // WhatsApp şablonu haritası
    expect(r.enBuyukFarklar.length).toBeGreaterThan(0);
    const banka = r.enBuyukFarklar.find((s: any) => s.hesapKodu === '102');
    expect(banka).toMatchObject({ tur: 'hesap', taraf: 'aktif', donem1: 500, donem2: 1100, fark: 600 });
    const grup = r.enBuyukFarklar.find((s: any) => s.tur === 'grup' && s.ad === '10 Hazır Değerler');
    expect(grup).toMatchObject({ donem1: 600, donem2: 1200, fark: 600 });
    expect(r.enBuyukFarklar.find((s: any) => s.hesapKodu === '590')).toMatchObject({ durum: 'yeni', donem2: 100 });
    // Değişmeyen hesap (120) listeye girmez
    expect(r.enBuyukFarklar.find((s: any) => s.hesapKodu === '120')).toBeUndefined();
  });

  it('kaynak "gelir_tablosu" (ve "GELIR_TABLOSU") eski kalem haritasını korur', async () => {
    const tool = aracKur({ gelirTablolari: [gelirTablosuSatiri('2026-Q1'), gelirTablosuSatiri('2026-Q2', { netSatislar: 1500, donemNetKari: 300 })] });
    for (const kaynak of ['gelir_tablosu', 'GELIR_TABLOSU', 'gelir tablosu']) {
      const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak }, ctx);
      expect(r.error).toBeUndefined();
      expect(r.kaynak).toBe('gelir_tablosu');
      expect(r['karsilaştırma'].netSatislar).toEqual({ donem1: 1000, donem2: 1500, fark: 500, degismeYuzdesi: 50 });
      expect(r.enBuyukFarklar[0].kalem).toBe('netSatislar');
    }
  });

  it('geçersiz kaynak → hata geçerli kaynakları ve dönem biçimini LİSTELER', async () => {
    const tool = aracKur({});
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'nakit_akis' }, ctx);
    expect(r.error).toMatch(/Geçersiz kaynak: "nakit_akis"/);
    expect(r.error).toMatch(/gelir_tablosu \| bilanco \| mizan/);
    expect(r.error).toMatch(/YYYY-MM/);
    expect(r.error).toMatch(/YYYY-Qn/);
    expect(r.gecerliKaynaklar).toEqual(['gelir_tablosu', 'bilanco', 'mizan']);
  });

  it('geçersiz dönem ve aynı dönem → açıklamalı hata', async () => {
    const tool = aracKur({});
    const bozuk = await tool.execute('compare_periods', { taxpayerId: TP, donem1: 'ilk çeyrek', donem2: '2026-Q2', kaynak: 'mizan' }, ctx);
    expect(bozuk.error).toMatch(/Dönem anlaşılamadı: donem1="ilk çeyrek"/);
    expect(bozuk.error).toMatch(/YYYY-Qn/);
    const ayni = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q2', donem2: '2026-Q2', kaynak: 'mizan' }, ctx);
    expect(ayni.error).toMatch(/aynı/);
  });

  it('"2026-06" ile "2026-Q2" aynı kayda çözülürse kendisiyle kıyaslamaz, açık hata verir', async () => {
    const tool = aracKur({ mizanlar: [mizanSatiri('2026-Q2', hesapUret(3))] });
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-06', donem2: '2026-Q2', kaynak: 'mizan' }, ctx);
    expect(r.error).toMatch(/aynı kayda \(2026-Q2\) çözüldü/);
    expect(r.enBuyukFarklar).toBeUndefined();
  });

  it('kaynak belgesi olmayan dönem → hata mevcut dönemleri söyler (bilanço yalnız Q1 varken Q2 istenirse)', async () => {
    const tool = aracKur({ bilancolar: [bilancoSatiri('2026-Q1')], mizanlar: [mizanSatiri('2026-Q2', hesapUret(3))] });
    const r = await tool.execute('compare_periods', { taxpayerId: TP, donem1: '2026-Q1', donem2: '2026-Q2', kaynak: 'bilanco' }, ctx);
    expect(r.error).toMatch(/2026-Q2 için bilanço yok/);
    expect(r.error).toMatch(/Mevcut bilanço dönemleri: 2026-Q1/);
    expect(r.mevcutDonemler).toEqual({ mizan: ['2026-Q2'], bilanco: ['2026-Q1'], gelirTablosu: [] });
    expect(r['karsilaştırma']).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
describe('calculate_financial_ratios — çeyrek dönemi kabul, eksik tabloyu açıkça söyler', () => {
  it('"2026-Q2" bilanço + gelir tablosu varken rasyolar hesaplanır', async () => {
    const tool = aracKur({ bilancolar: [bilancoSatiri('2026-Q2')], gelirTablolari: [gelirTablosuSatiri('2026-Q2')] });
    const r = await tool.execute('calculate_financial_ratios', { taxpayerId: TP, donem: '2026-Q2' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.donem).toBe('2026-Q2');
    expect(r.rasyolar.cariOran.deger).toBeCloseTo(2.5, 6);
    expect(r.rasyolar.netKarMarji.deger).toBeCloseTo(0.24, 6);
    expect(r.rasyolar.roe.deger).toBeCloseTo(0.24, 6);
    expect(r.eksik).toBeUndefined();
    expect(r.bilancoDonemi).toBe('2026-Q2');
  });

  it('donem:"Q2" + yil:2026, "2026/Q2", "2026-06" hepsi 2026-Q2 kaydını bulur; yılsız "Q2" hata', async () => {
    const tool = aracKur({ bilancolar: [bilancoSatiri('2026-Q2')], gelirTablolari: [gelirTablosuSatiri('2026-Q2')] });
    for (const girdi of [{ donem: 'Q2', yil: 2026 }, { donem: '2026/Q2' }, { donem: '2026-06' }, { donem: 'Q2 2026' }]) {
      const r = await tool.execute('calculate_financial_ratios', { taxpayerId: TP, ...girdi }, ctx);
      expect(r.error).toBeUndefined();
      expect(r.donem).toBe(girdi.donem === '2026-06' ? '2026-06' : '2026-Q2'); // istenen (normalleşmiş) dönem
      expect(r.bilancoDonemi).toBe('2026-Q2'); // bulunan kayıt
      expect(r.gelirTablosuDonemi).toBe('2026-Q2');
      expect(r.rasyolar.cariOran).toBeDefined();
    }
    const yilsiz = await tool.execute('calculate_financial_ratios', { taxpayerId: TP, donem: 'Q2' }, ctx);
    expect(yilsiz.error).toMatch(/Dönem anlaşılamadı: "Q2"/);
    expect(yilsiz.error).toMatch(/yil:2026/);
  });

  it('Q2 bilançosu yok, gelir tablosu var → marjlar hesaplanır, bilanço rasyoları yok; uyarı mevcut bilanço dönemlerini söyler', async () => {
    const tool = aracKur({ bilancolar: [bilancoSatiri('2026-Q1')], gelirTablolari: [gelirTablosuSatiri('2026-Q2')] });
    const r = await tool.execute('calculate_financial_ratios', { taxpayerId: TP, donem: '2026-Q2' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.eksik).toEqual(['bilanco']);
    expect(r.bilancoDonemi).toBeNull();
    expect(r.rasyolar.cariOran).toBeUndefined();
    expect(r.rasyolar.roe).toBeUndefined();
    expect(r.rasyolar.brutKarMarji.deger).toBeCloseTo(0.4, 6);
    expect(r.uyarilar.join('\n')).toMatch(/2026-Q2 bilançosu yok; mevcut bilanço dönemleri: 2026-Q1/);
    expect(r.uyarilar.join('\n')).toMatch(/HESAPLANMADI/);
  });

  it('ne bilanço ne gelir tablosu → hata: mevcut dönemler (bilanço/GT/mizan) + mizandan türetme yolu; rasyo alanı YOK', async () => {
    const tool = aracKur({
      bilancolar: [],
      gelirTablolari: [gelirTablosuSatiri('2026-Q1')],
      mizanlar: [mizanSatiri('2026-Q1', hesapUret(2)), mizanSatiri('2026-Q2', hesapUret(2))],
    });
    const r = await tool.execute('calculate_financial_ratios', { taxpayerId: TP, donem: '2026-Q2' }, ctx);
    expect(r.error).toMatch(/2026-Q2 için bilanço ve gelir tablosu yok/);
    expect(r.error).toMatch(/Mevcut bilanço dönemleri: yok/);
    expect(r.error).toMatch(/gelir tablosu dönemleri: 2026-Q1/);
    expect(r.error).toMatch(/mizan dönemleri: 2026-Q2, 2026-Q1/);
    expect(r.error).toMatch(/2026-Q2 mizanı var: get_mizan/);
    expect(r.rasyolar).toBeUndefined();
    expect(r.mevcutDonemler.mizan).toEqual(['2026-Q2', '2026-Q1']);
  });
});
