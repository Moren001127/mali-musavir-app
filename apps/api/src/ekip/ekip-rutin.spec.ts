/**
 * RUTİN ZAMANLAYICISI (PLAN/20 §D): zaman uygunluğu (haftalık pencere / aylık gün), kapsam hesabı (pano aşamaları, liste, ofis),
 * günlük tavan, bugün açılmışı tekrar açmama, kota kapısı, "şimdi çalıştır", tohum, CRUD doğrulama. Sahte Prisma/runner/kuyruk.
 */
import { ajanBul } from './ajan-tanimlari';
import { EkipKotaService, istanbulTarihi } from './ekip-kota.service';
import {
  RutinZamani,
  SIMDI_CALISTIR_TAVANI,
  bugunAcilanlar,
  kapsamMukellefleri,
  secilecekOgeler,
  zamanDogrula,
  zamanUygunMu,
} from './ekip-rutin';
import { EkipRutinService, VARSAYILAN_RUTIN } from './ekip-rutin.service';

const IST = (yil: number, ay: number, gun: number, saat: number, dk = 0) => istanbulTarihi(yil, ay, gun, saat, dk);
const HAFTALIK: RutinZamani = { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '09:30', bitis: '17:00' };
const AYLIK: RutinZamani = { tur: 'aylik', ayGunu: 5, saat: '09:30' };

describe('ekip rutin — zaman uygunluğu', () => {
  it('haftalık: gün listede ve saat aralıkta → uygun; hafta sonu / pencere dışı → değil', () => {
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 21, 9, 30), null)).toBe(true); // Pazartesi 09:30
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 21, 17, 0), null)).toBe(true); // bitiş dahil
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 21, 9, 29), null)).toBe(false);
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 21, 17, 1), null)).toBe(false);
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 26, 12, 0), null)).toBe(false); // Cumartesi
    // aylik + aylar süzgeci: yalnız listedeki aylarda (çeyreklik denetim [1,4,7,10])
    const CEYREK = { tur: 'aylik' as const, ayGunu: 3, saat: '09:30', aylar: [1, 4, 7, 10] };
    expect(zamanUygunMu(CEYREK, IST(2026, 10, 3, 9, 30), null)).toBe(true); // Ekim
    expect(zamanUygunMu(CEYREK, IST(2026, 9, 3, 9, 30), null)).toBe(false); // Eylül listede yok
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 27, 12, 0), null)).toBe(false); // Pazar
    // haftalıkta sonKosuAt engel değil (tekrar açmamayı tavan + bugün-açılan süzgeci sağlar)
    expect(zamanUygunMu(HAFTALIK, IST(2026, 9, 21, 12, 0), IST(2026, 9, 21, 9, 35))).toBe(true);
  });

  it('aylık: ayın günü ∧ saat geçmiş ∧ bugün koşmamış; ay kısa ise son gün', () => {
    expect(zamanUygunMu(AYLIK, IST(2026, 9, 5, 9, 30), null)).toBe(true);
    expect(zamanUygunMu(AYLIK, IST(2026, 9, 5, 9, 29), null)).toBe(false);
    expect(zamanUygunMu(AYLIK, IST(2026, 9, 6, 9, 30), null)).toBe(false);
    expect(zamanUygunMu(AYLIK, IST(2026, 9, 5, 14, 0), IST(2026, 9, 5, 9, 31))).toBe(false); // bugün koştu
    expect(zamanUygunMu(AYLIK, IST(2026, 9, 5, 14, 0), IST(2026, 8, 5, 9, 31))).toBe(true); // geçen ay koştu
    const ay31: RutinZamani = { tur: 'aylik', ayGunu: 31, saat: '08:00' };
    expect(zamanUygunMu(ay31, IST(2026, 9, 30, 8, 0), null)).toBe(true); // Eylül 30 çeker → son gün
    expect(zamanUygunMu(ay31, IST(2026, 10, 31, 8, 0), null)).toBe(true);
    expect(zamanUygunMu(ay31, IST(2026, 10, 30, 8, 0), null)).toBe(false);
  });

  it('zamanDogrula: bozuk gövde reddedilir, geçerli gövde normalize edilir', () => {
    expect(zamanDogrula(null).hata).toMatch(/zaman zorunlu/);
    expect(zamanDogrula({ tur: 'gunluk' }).hata).toMatch(/haftalik/);
    expect(zamanDogrula({ tur: 'haftalik', gunler: [], baslangic: '09:00', bitis: '10:00' }).hata).toMatch(/gunler/);
    expect(zamanDogrula({ tur: 'haftalik', gunler: [1], baslangic: '9:00', bitis: '25:00' }).hata).toMatch(/HH:MM/);
    expect(zamanDogrula({ tur: 'haftalik', gunler: [1], baslangic: '10:00', bitis: '09:00' }).hata).toMatch(/sonra/);
    expect(zamanDogrula({ tur: 'haftalik', gunler: ['5', 1, 1, 9], baslangic: '09:30', bitis: '17:00' }).zaman).toEqual({ tur: 'haftalik', gunler: [1, 5], baslangic: '09:30', bitis: '17:00' });
    expect(zamanDogrula({ tur: 'aylik', ayGunu: 0, saat: '09:00' }).hata).toMatch(/ayGunu/);
    expect(zamanDogrula({ tur: 'aylik', ayGunu: 5, saat: 'sabah' }).hata).toMatch(/saat/);
    expect(zamanDogrula({ tur: 'aylik', ayGunu: '5', saat: '09:30' }).zaman).toEqual({ tur: 'aylik', ayGunu: 5, saat: '09:30' });
    expect(zamanUygunMu(null, IST(2026, 9, 21, 12, 0), null)).toBe(false);
  });
});

const PANO = {
  donemler: [
    {
      istenenDonem: '2026-09',
      beyannameDonem: '2026-08',
      hata: null,
      mukellefler: [
        { taxpayerId: 'a', ad: 'A Ltd', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } },
        { taxpayerId: 'b', ad: 'B AŞ', asamalar: { evrak: true, isleme: true, kontrol: true, kdvKontrol: true, beyannameHazir: false, beyanname: false } },
        { taxpayerId: 'c', ad: 'C', asamalar: { evrak: true, isleme: false, kontrol: false, beyannameHazir: false, beyanname: false } },
        { taxpayerId: 'd', ad: 'D', asamalar: { evrak: false, isleme: false, kontrol: false, beyannameHazir: false, beyanname: false } },
        { taxpayerId: 'e', ad: 'E', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } },
        { taxpayerId: 'a', ad: 'A Ltd (tekrar)', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } },
        { taxpayerId: null, ad: 'kimliksiz', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } },
      ],
    },
    { istenenDonem: '2026-08', beyannameDonem: '2026-07', hata: null, mukellefler: [{ taxpayerId: 'z', ad: 'Z', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } }] },
  ],
};

describe('ekip rutin — kapsam kdv:islenmis (2026-09-22)', () => {
  // Muzaffer Bey: "KDV kontrol edildi işaretsizlerin bir kısmının evrakı Luca'ya işlenmemiş; işlenmeden neyi kontrol edeceksin."
  // → aday YALNIZ hazır kümesindekiler (o dönem KDV oturumu + Luca kaydı olanlar); kalanı 'islenmemis' raporuna.
  it('hazır kümesindekiler aday olur; işlendi işaretli ama Luca boş olanlar islenmemis listesine düşer; kdvKontrol bitmiş elenir', () => {
    const k = kapsamMukellefleri('kdv:islenmis', PANO, null, { kdvHazirIdler: new Set(['a']) });
    expect(k.donem).toBe('2026-08');
    expect(k.mukellefler).toEqual([{ taxpayerId: 'a', ad: 'A Ltd' }]);
    expect(k.islenmemis).toEqual([{ taxpayerId: 'e', ad: 'E' }]);
  });

  // 2026-09-22 canlı bulgu: Aylık Takip "KDV kontrol edildi" işareti BEYANNAME ayına yazılır, pano satırı İŞLEM ayıdır →
  // kilitli (bitmiş) oturumlar "kontrol edilmemiş" görünüp rutine giriyordu (26 mükellefin hepsi kilitliyken 8 iş açıldı).
  it('oturumları kilitli olan (bitmis) mükellef ne aday olur ne işlenmemiş sayılır', () => {
    const k = kapsamMukellefleri('kdv:islenmis', PANO, null, { kdvHazirIdler: new Set(['a']), kdvBitmisIdler: new Set(['a', 'e']) });
    expect(k.mukellefler).toEqual([]);
    expect(k.islenmemis).toEqual([]);
  });

  it('hazır kümesi yoksa (oturum/kayıt yok) aday üretilmez, işlenmemiş listesi dolar', () => {
    const k = kapsamMukellefleri('kdv:islenmis', PANO, null, { kdvHazirIdler: new Set() });
    expect(k.mukellefler).toEqual([]);
    expect(k.islenmemis?.map((m) => m.taxpayerId)).toEqual(['a', 'e']);
  });

  it('tohum rutini bu kapsamı kullanır', () => {
    expect(VARSAYILAN_RUTIN.kapsam).toBe('kdv:islenmis');
  });
});

describe('ekip rutin — kapsam hesabı', () => {
  it('pano:kontrol_bekleyen = işleme ∧ ¬kontrol (yalnız EN SON dönem, tekrar ve kimliksiz elenir)', () => {
    const k = kapsamMukellefleri('pano:kontrol_bekleyen', PANO, null);
    expect(k.donem).toBe('2026-08');
    expect(k.mukellefler).toEqual([
      { taxpayerId: 'a', ad: 'A Ltd' },
      { taxpayerId: 'e', ad: 'E' },
    ]);
  });

  it('pano:isleme_bekleyen = evrak ∧ ¬işleme; pano:hazirlik_bekleyen = kontrol ∧ ¬beyannameHazir', () => {
    expect(kapsamMukellefleri('pano:isleme_bekleyen', PANO, null).mukellefler).toEqual([{ taxpayerId: 'c', ad: 'C' }]);
    expect(kapsamMukellefleri('pano:hazirlik_bekleyen', PANO, null).mukellefler).toEqual([{ taxpayerId: 'b', ad: 'B AŞ' }]);
  });

  it('liste = verilen id\'ler (ad servis tarafında); ofis = mükellefsiz tek öğe; pano yoksa/hatalıysa pano kapsamı boş', () => {
    expect(kapsamMukellefleri('liste', PANO, ['x', 'y', 'x', ''])).toEqual({ donem: '2026-08', mukellefler: [{ taxpayerId: 'x', ad: null }, { taxpayerId: 'y', ad: null }] });
    expect(kapsamMukellefleri('ofis', PANO, null)).toEqual({ donem: '2026-08', mukellefler: [{ taxpayerId: null, ad: null }] });
    expect(kapsamMukellefleri('pano:kontrol_bekleyen', null, null)).toEqual({ donem: null, mukellefler: [] });
    expect(kapsamMukellefleri('pano:kontrol_bekleyen', { donemler: [{ ...PANO.donemler[0], hata: 'araç düştü' }] }, null).mukellefler).toEqual([]);
    expect(kapsamMukellefleri('pano:bilinmeyen', PANO, null).mukellefler).toEqual([]);
  });

  it('bugün açılanlar + tavan: açılmış mükellef elenir, kalan tavana kadar alınır', () => {
    const acilan = bugunAcilanlar([
      { ogeler: [{ taxpayerId: 'a', ad: 'A', durum: 'bitti' }, { taxpayerId: 'e', ad: 'E', durum: 'hata' }] },
      { ogeler: [{ taxpayerId: 'q', ad: 'Q', durum: 'bekliyor' }] },
    ]);
    expect(acilan.sayi).toBe(3);
    expect(acilan.biten).toBe(1);
    expect(acilan.hatali).toBe(1);
    expect(Array.from(acilan.taxpayerIdler).sort()).toEqual(['a', 'e', 'q']);
    const adaylar = [{ taxpayerId: 'a', ad: 'A' }, { taxpayerId: 'e', ad: 'E' }, { taxpayerId: 'f', ad: 'F' }, { taxpayerId: 'g', ad: 'G' }, { taxpayerId: 'h', ad: 'H' }];
    expect(secilecekOgeler(adaylar, acilan, 2).map((m) => m.taxpayerId)).toEqual(['f', 'g']);
    expect(secilecekOgeler(adaylar, acilan, 0)).toEqual([]);
    expect(secilecekOgeler(adaylar, acilan, 10).map((m) => m.taxpayerId)).toEqual(['f', 'g', 'h']);
    // ofis öğesi (taxpayerId null) bugün açılmışsa tekrar açılmaz
    const ofisAcilan = bugunAcilanlar([{ ogeler: [{ taxpayerId: null, ad: null, durum: 'bitti' }] }]);
    expect(secilecekOgeler([{ taxpayerId: null, ad: null }], ofisAcilan, 5)).toEqual([]);
  });
});

// ─── Servis (sahte Prisma + runner.pano + kuyruk.olustur) ───

function servisKur(o: { rutinler?: any[]; kuyruklar?: any[]; pano?: any; kotaDolu?: boolean; tenantVar?: boolean } = {}) {
  const rutinler: any[] = (o.rutinler || []).map((r) => ({ ...r }));
  const kuyruklar: any[] = o.kuyruklar || [];
  const acilanKuyruklar: any[] = [];
  const guncellemeler: any[] = [];
  let sayac = 0;
  const suz = (rows: any[], where: any) =>
    rows.filter((r) => {
      for (const [k, v] of Object.entries(where || {})) {
        if (k === 'createdAt') {
          if ((v as any).gte && !(r.createdAt >= (v as any).gte)) return false;
          continue;
        }
        if (v && typeof v === 'object' && 'not' in (v as any)) {
          if (r[k] === (v as any).not) return false;
          continue;
        }
        if (r[k] !== v) return false;
      }
      return true;
    });
  const prisma = {
    tenant: { findUnique: async (q: any) => (o.tenantVar === false ? null : { id: q.where.id }) },
    ekipRutin: {
      findMany: async (q: any) => suz(rutinler, q?.where),
      findFirst: async (q: any) => suz(rutinler, q?.where)[0] || null,
      count: async (q: any) => suz(rutinler, q?.where).length,
      create: async (q: any) => {
        const r = { id: `r${++sayac}`, sonKosuAt: null, sonSonuc: null, createdAt: new Date(), updatedAt: new Date(), taxpayerIds: [], ...q.data };
        rutinler.push(r);
        return r;
      },
      update: async (q: any) => {
        const r = rutinler.find((x) => x.id === q.where.id);
        Object.assign(r, q.data);
        guncellemeler.push(q);
        return r;
      },
      delete: async (q: any) => {
        const i = rutinler.findIndex((x) => x.id === q.where.id);
        return rutinler.splice(i, 1)[0];
      },
    },
    ekipKuyruk: {
      findMany: async (q: any) => suz(kuyruklar, q?.where),
    },
  };
  const runner = { pano: async () => o.pano ?? PANO, kapaniyorMu: () => false };
  const kuyruk = {
    olustur: async (p: any) => {
      acilanKuyruklar.push(p);
      const id = `k${acilanKuyruklar.length}`;
      // bugünkü kuyruk listesine düşsün (tekrar açmama süzgeci için)
      kuyruklar.push({ id, tenantId: p.tenantId, rutinId: p.rutinId, createdAt: new Date(), ogeler: p.ogeler.map((x: any) => ({ ...x, ad: null, durum: 'bekliyor' })) });
      return { ok: true, id, ogeSayisi: p.ogeler.length, atlanan: 0 };
    },
  };
  const kota = new EkipKotaService();
  (kota as any).logger = { warn: () => undefined, log: () => undefined };
  if (o.kotaDolu) kota.hatadanIsaretle('weekly limit reached');
  const s = new EkipRutinService(prisma as any, runner as any, kuyruk as any, kota);
  const loglar: string[] = [];
  (s as any).logger = { warn: (m: string) => loglar.push(`warn ${m}`), log: (m: string) => loglar.push(`log ${m}`), debug: () => undefined, error: () => undefined };
  return { s, prisma, rutinler, kuyruklar, acilanKuyruklar, guncellemeler, kota, loglar };
}

const RUTIN = {
  id: 'r-kdv',
  tenantId: 't1',
  ad: 'KDV kontrolü — kontrol bekleyenler',
  ajanId: 'beyanname',
  sablon: '{mukellef} için {donem} dönemi KDV kontrolünü yap (R1).',
  kapsam: 'pano:kontrol_bekleyen',
  taxpayerIds: [],
  zaman: HAFTALIK,
  gunlukTavan: 8,
  dryRun: false,
  aktif: true,
  sonKosuAt: null,
  sonSonuc: null,
  createdAt: new Date('2026-09-20T00:00:00Z'),
  updatedAt: new Date('2026-09-20T00:00:00Z'),
};

describe('ekip rutin — servis taraması', () => {
  it('pencere içinde: kapsamdaki mükellefler kuyruğa girer (kaynak rutin, dönem, canlı); sonKosuAt/sonSonuc yazılır', async () => {
    const t = servisKur({ rutinler: [RUTIN] });
    const simdi = IST(2026, 9, 21, 9, 35);
    expect(await t.s.tara(simdi)).toEqual(['r-kdv']);
    expect(t.acilanKuyruklar).toHaveLength(1);
    expect(t.acilanKuyruklar[0]).toMatchObject({
      tenantId: 't1',
      ad: RUTIN.ad,
      ajanId: 'beyanname',
      sablon: RUTIN.sablon,
      dryRun: false,
      kaynak: 'rutin',
      rutinId: 'r-kdv',
      olusturan: null,
      donem: '2026-08',
    });
    expect(t.acilanKuyruklar[0].ogeler).toEqual([{ taxpayerId: 'a', donem: '2026-08' }, { taxpayerId: 'e', donem: '2026-08' }]);
    expect(t.rutinler[0].sonKosuAt).toEqual(simdi);
    expect(t.rutinler[0].sonSonuc).toMatchObject({ eklenen: 2, aday: 2, kuyrukId: 'k1', donem: '2026-08', neden: null, elle: false });
  });

  it('pencere dışında ya da pasif rutin koşmaz', async () => {
    const t = servisKur({ rutinler: [RUTIN, { ...RUTIN, id: 'r-pasif', aktif: false }] });
    expect(await t.s.tara(IST(2026, 9, 21, 8, 0))).toEqual([]);
    expect(await t.s.tara(IST(2026, 9, 26, 12, 0))).toEqual([]);
    expect(t.acilanKuyruklar).toEqual([]);
    // pasif olan pencere içinde de koşmaz
    expect(await t.s.tara(IST(2026, 9, 21, 12, 0))).toEqual(['r-kdv']);
  });

  it('bugün açılmış mükellef tekrar açılmaz; günlük tavan dolunca yeni öğe eklenmez', async () => {
    const t = servisKur({ rutinler: [{ ...RUTIN, gunlukTavan: 3 }] });
    const bugun = IST(2026, 9, 21, 9, 35);
    await t.s.tara(bugun);
    expect(t.acilanKuyruklar).toHaveLength(1); // a, e
    // ikinci tik: a ve e bugün zaten açılmış → yeni kuyruk yok, sonSonuc nedeni
    await t.s.tara(IST(2026, 9, 21, 9, 40));
    expect(t.acilanKuyruklar).toHaveLength(1);
    // pano'ya yeni bir kontrol bekleyen düşerse (gün içinde işleme bitti) 1 kişilik yer kaldı (tavan 3, açılan 2)
    (t.s as any).runner.pano = async () => ({
      donemler: [{ ...PANO.donemler[0], mukellefler: [...PANO.donemler[0].mukellefler, { taxpayerId: 'f', ad: 'F', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } }, { taxpayerId: 'g', ad: 'G', asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } }] }],
    });
    await t.s.tara(IST(2026, 9, 21, 10, 0));
    expect(t.acilanKuyruklar).toHaveLength(2);
    expect(t.acilanKuyruklar[1].ogeler.map((o: any) => o.taxpayerId)).toEqual(['f']); // g tavana takıldı
    // tavan doldu (3/3): dördüncü tikte hiç açılmaz; sonSonuc son eklemeyi gösterir (boş tik yeniden yazmaz)
    await t.s.tara(IST(2026, 9, 21, 10, 5));
    expect(t.acilanKuyruklar).toHaveLength(2);
    expect(t.rutinler[0].sonSonuc).toMatchObject({ eklenen: 1, kuyrukId: 'k2' });
    // "şimdi çalıştır" tavana bakmaz: g açılır
    expect(await t.s.simdiCalistir('t1', 'r-kdv')).toMatchObject({ ok: true, eklenen: 1, kuyrukId: 'k3' });
    expect(t.acilanKuyruklar[2].ogeler.map((o: any) => o.taxpayerId)).toEqual(['g']);
  });

  it('kota doluysa tarama atlanır; runner kapanıyorsa da', async () => {
    const t = servisKur({ rutinler: [RUTIN], kotaDolu: true });
    expect(await t.s.tara(IST(2026, 9, 21, 9, 35))).toEqual([]);
    expect(t.acilanKuyruklar).toEqual([]);
    expect(t.loglar.some((m) => /kotası dolu/.test(m))).toBe(true);
    const t2 = servisKur({ rutinler: [RUTIN] });
    (t2.s as any).runner.kapaniyorMu = () => true;
    expect(await t2.s.tara(IST(2026, 9, 21, 9, 35))).toEqual([]);
  });

  it('aylık rutin: gün + saat geldiğinde bir kez koşar; aynı gün ikinci tikte koşmaz (sonKosuAt)', async () => {
    const t = servisKur({ rutinler: [{ ...RUTIN, id: 'r-ay', zaman: AYLIK, kapsam: 'ofis', sablon: 'Ayın 5\'i ofis özeti' }] });
    expect(await t.s.tara(IST(2026, 9, 5, 9, 30))).toEqual(['r-ay']);
    expect(t.acilanKuyruklar[0].ogeler).toEqual([{ taxpayerId: null, donem: null }]); // kalıp {donem} istemiyor → pano okunmaz
    expect(await t.s.tara(IST(2026, 9, 5, 9, 35))).toEqual([]);
    expect(await t.s.tara(IST(2026, 10, 5, 9, 35))).toEqual(['r-ay']);
  });

  it('liste kapsamı: verilen mükellefler; pano hatalıysa pano kapsamında "pano okunamadı"', async () => {
    const t = servisKur({ rutinler: [{ ...RUTIN, id: 'r-liste', kapsam: 'liste', taxpayerIds: ['x', 'y'], sablon: '{mukellef} faturalarını işle' }] });
    await t.s.tara(IST(2026, 9, 21, 9, 35));
    expect(t.acilanKuyruklar[0].ogeler.map((o: any) => o.taxpayerId)).toEqual(['x', 'y']);
    const t2 = servisKur({ rutinler: [RUTIN], pano: { donemler: [{ istenenDonem: '2026-09', beyannameDonem: null, hata: 'araç düştü', mukellefler: [] }] } });
    await t2.s.tara(IST(2026, 9, 21, 9, 35));
    expect(t2.acilanKuyruklar).toEqual([]);
    expect(t2.rutinler[0].sonSonuc).toMatchObject({ eklenen: 0, aday: 0, neden: 'kapsamda mükellef yok' });
  });

  it('şimdi çalıştır: pencere/tavan/aktif bakılmaz, en çok 20; bugün açılmışlar yine elenir', async () => {
    const cok = Array.from({ length: 25 }, (_, i) => ({ taxpayerId: `m${i}`, ad: `M${i}`, asamalar: { evrak: true, isleme: true, kontrol: false, beyannameHazir: false, beyanname: false } }));
    const t = servisKur({
      rutinler: [{ ...RUTIN, aktif: false, gunlukTavan: 2 }],
      pano: { donemler: [{ istenenDonem: '2026-09', beyannameDonem: '2026-08', hata: null, mukellefler: cok }] },
    });
    const r = await t.s.simdiCalistir('t1', 'r-kdv');
    expect(r).toMatchObject({ ok: true, eklenen: SIMDI_CALISTIR_TAVANI, kuyrukId: 'k1', aday: 25 });
    expect(t.acilanKuyruklar[0].ogeler).toHaveLength(20);
    const r2 = await t.s.simdiCalistir('t1', 'r-kdv');
    expect(r2).toMatchObject({ ok: true, eklenen: 5, kuyrukId: 'k2' });
    expect(t.acilanKuyruklar[1].ogeler.map((o: any) => o.taxpayerId)).toEqual(['m20', 'm21', 'm22', 'm23', 'm24']);
    expect(await t.s.simdiCalistir('t1', 'yok')).toMatchObject({ ok: false, error: 'Rutin bulunamadı.' });
    expect(await t.s.simdiCalistir('baska', 'r-kdv')).toMatchObject({ ok: false });
  });

  it('listele: rutin + bugun {planlanan, biten, hatali}; başka kiracının rutini görünmez', async () => {
    const t = servisKur({
      rutinler: [RUTIN, { ...RUTIN, id: 'r-baska', tenantId: 't2' }],
      kuyruklar: [
        { id: 'k0', tenantId: 't1', rutinId: 'r-kdv', createdAt: new Date(), ogeler: [{ taxpayerId: 'a', durum: 'bitti' }, { taxpayerId: 'e', durum: 'hata' }, { taxpayerId: 'f', durum: 'bekliyor' }] },
        { id: 'k-dun', tenantId: 't1', rutinId: 'r-kdv', createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), ogeler: [{ taxpayerId: 'q', durum: 'bitti' }] },
      ],
    });
    const l = await t.s.listele('t1');
    expect(l.rutinler).toHaveLength(1);
    expect(l.rutinler[0]).toMatchObject({ id: 'r-kdv', ajanAd: ajanBul('beyanname')!.ad, zaman: HAFTALIK, bugun: { planlanan: 3, biten: 1, hatali: 1 } });
  });
});

describe('ekip rutin — CRUD doğrulama + tohum', () => {
  it('olustur: eksik/bozuk gövde reddedilir; geçerli gövde varsayılanlarla (kuru, kapalı, tavan 8) kaydedilir', async () => {
    const t = servisKur();
    expect(await t.s.olustur('t1', { ad: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/ajanId/) });
    expect(await t.s.olustur('t1', { ad: 'x', ajanId: 'beyanname' })).toMatchObject({ ok: false, error: expect.stringMatching(/sablon/) });
    expect(await t.s.olustur('t1', { ad: 'x', ajanId: 'beyanname', sablon: 's', kapsam: 'hepsi' })).toMatchObject({ ok: false, error: expect.stringMatching(/kapsam/) });
    expect(await t.s.olustur('t1', { ad: 'x', ajanId: 'beyanname', sablon: 's', kapsam: 'liste', taxpayerIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/liste/) });
    expect(await t.s.olustur('t1', { ad: 'x', ajanId: 'beyanname', sablon: 's', kapsam: 'ofis', zaman: { tur: 'aylik' } })).toMatchObject({ ok: false, error: expect.stringMatching(/ayGunu/) });
    expect(await t.s.olustur('t1', { ad: 'x', ajanId: 'beyanname', sablon: 's', kapsam: 'ofis', zaman: AYLIK, gunlukTavan: 99 })).toMatchObject({ ok: false, error: expect.stringMatching(/gunlukTavan/) });
    const r: any = await t.s.olustur('t1', { ad: '  Ofis özeti ', ajanId: 'koordinator', sablon: 'Ofis özeti çıkar', kapsam: 'ofis', zaman: AYLIK });
    expect(r.ok).toBe(true);
    expect(r.rutin).toMatchObject({ ad: 'Ofis özeti', ajanId: 'koordinator', kapsam: 'ofis', gunlukTavan: 8, dryRun: true, aktif: false, taxpayerIds: [], bugun: { planlanan: 0, biten: 0, hatali: 0 } });
    expect(t.rutinler[0].tenantId).toBe('t1');
  });

  it('guncelle: yalnız gelen alanlar; başka kiracı göremez; sil', async () => {
    const t = servisKur({ rutinler: [RUTIN] });
    expect(await t.s.guncelle('t2', 'r-kdv', { aktif: false })).toMatchObject({ ok: false });
    const r: any = await t.s.guncelle('t1', 'r-kdv', { aktif: false, gunlukTavan: 4, zaman: { tur: 'haftalik', gunler: [1, 3], baslangic: '10:00', bitis: '12:00' } });
    expect(r.ok).toBe(true);
    expect(r.rutin).toMatchObject({ aktif: false, gunlukTavan: 4, dryRun: false, sablon: RUTIN.sablon, zaman: { tur: 'haftalik', gunler: [1, 3], baslangic: '10:00', bitis: '12:00' } });
    expect(await t.s.guncelle('t1', 'r-kdv', { zaman: { tur: 'aylik', ayGunu: 40, saat: '09:00' } })).toMatchObject({ ok: false });
    expect(await t.s.sil('t2', 'r-kdv')).toMatchObject({ ok: false });
    expect(await t.s.sil('t1', 'r-kdv')).toEqual({ ok: true });
    expect(t.rutinler).toEqual([]);
  });

  it('tohum: yalnız MOREN_OWNER_TENANT_ID kiracısında, yalnız hiç rutin yokken; canlı + günde 8 + açık (Muzaffer Bey kararı)', async () => {
    const eski = process.env.MOREN_OWNER_TENANT_ID;
    try {
      delete process.env.MOREN_OWNER_TENANT_ID;
      const t0 = servisKur();
      expect(await t0.s.tohumla()).toBeNull();
      expect(t0.rutinler).toEqual([]);

      process.env.MOREN_OWNER_TENANT_ID = 'sahip';
      const t1 = servisKur();
      const id = await t1.s.tohumla();
      expect(id).toBe('r1');
      expect(t1.rutinler[0]).toMatchObject({
        tenantId: 'sahip',
        ad: 'KDV kontrolü — kontrol bekleyenler',
        ajanId: 'beyanname',
        sablon: '{mukellef} için {donem} dönemi KDV kontrolünü yap (R1).',
        kapsam: 'kdv:islenmis',
        zaman: { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '09:30', bitis: '17:00' },
        gunlukTavan: 8,
        dryRun: false,
        aktif: true,
      });
      expect(VARSAYILAN_RUTIN.dryRun).toBe(false);
      // ikinci çağrı: rutin var → tohumlama yok
      expect(await t1.s.tohumla()).toBeNull();
      expect(t1.rutinler).toHaveLength(1);
      // kiracı DB'de yoksa tohum yok
      const t2 = servisKur({ tenantVar: false });
      expect(await t2.s.tohumla()).toBeNull();
      expect(t2.rutinler).toEqual([]);
    } finally {
      if (eski === undefined) delete process.env.MOREN_OWNER_TENANT_ID;
      else process.env.MOREN_OWNER_TENANT_ID = eski;
    }
  });
});
