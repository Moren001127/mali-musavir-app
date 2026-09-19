import { meslekiBilgiOku } from './mesleki-bilgi';
import { MESLEKI_BILGI } from './mesleki-bilgi-verisi';
import { AJAN_TANIMLARI } from './ajan-tanimlari';
import { aracAcikMi } from './arac-defteri';
import { EkipRunnerService } from './ekip-runner.service';

describe('kaynaklı mesleki bilgi kütüphanesi', () => {
  it('okuma hiçbir konuyu ekran veya canlı işlem bakımından doğrulanmış göstermez', () => {
    for (const konu of [undefined, ...MESLEKI_BILGI.map((x) => x.id)]) {
      expect(meslekiBilgiOku(konu)).toMatchObject({
        ok: true, ekranDogrulandi: false, canliIslemDogrulandi: false,
        otomatikYurutulebilir: false, yetkiDegisikligi: false,
      });
    }
  });

  it('konu seçimi dosya yolu veya keyfi URL kabul etmez; bilinmeyen konuda seçenek verir', () => {
    for (const konu of ['../../.env', 'https://example.com', 'constructor', {}, []]) {
      expect(meslekiBilgiOku(konu)).toMatchObject({ ok: false, konular: expect.any(Array) });
    }
  });

  it('tüm kaynaklar resmî kaynak veya resmî sayfadan bağlı eğitim adresleridir', () => {
    expect(new Set(MESLEKI_BILGI.map((x) => x.id)).size).toBe(MESLEKI_BILGI.length);
    for (const konu of MESLEKI_BILGI) {
      expect(konu.eksikler.length).toBeGreaterThan(0);
      expect(konu.sonucKontrolleri.length).toBeGreaterThan(0);
      expect(konu.kaynaklar.length).toBeGreaterThan(0);
      for (const kaynak of konu.kaynaklar) {
        const url = new URL(kaynak.url);
        expect(url.protocol).toBe('https:');
        expect(/(^|\.)(gib\.gov\.tr|defterbeyan\.gov\.tr|luca\.com\.tr|youtube\.com)$/.test(url.hostname) || url.hostname === 'lucayazilim.freshdesk.com').toBe(true);
        expect(['icerik_okundu', 'baglanti_bulundu']).toContain(kaynak.inceleme);
      }
    }
  });

  it('dönen bilgi değiştirilse de sonraki okumayı etkilemez', () => {
    const id = MESLEKI_BILGI[0].id;
    const ilk: any = meslekiBilgiOku(id);
    ilk.bilgi.adimlar.length = 0;
    expect((meslekiBilgiOku(id) as any).bilgi.adimlar.length).toBeGreaterThan(0);
  });

  it('bütün aktif personel kuru testte kütüphaneyi okuyabilir; resmî gönderim yine kapalıdır', () => {
    for (const ajan of AJAN_TANIMLARI) {
      expect(aracAcikMi(ajan, 'ekip_bilgi_oku', true)).toMatchObject({ acik: true, kademe: 'oku' });
      expect(aracAcikMi(ajan, 'gib_beyanname_gonder', false).acik).toBe(false);
    }
  });

  it('gerçek araç yönlendirmesi veri tabanı, tarayıcı veya gönderim çağırmadan bilgi döndürür', async () => {
    const yasak = new Proxy({}, { get() { throw new Error('Yan etki çağrısı'); } });
    const runner = new EkipRunnerService(yasak as any, yasak as any, yasak as any, yasak as any, yasak as any);
    const sonuc = await (runner as any).ekipAraciCalistir('ekip_bilgi_oku', { konu: MESLEKI_BILGI[0].id }, { tenantId: 'deneme' });
    expect(sonuc).toMatchObject({ ok: true, bilgi: { id: MESLEKI_BILGI[0].id } });
  });
});
