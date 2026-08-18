import { EvrakMesajService } from './evrak-mesaj.service';

/**
 * EVRAK MESAJLARI — mükellefe istenmeyen mesaj gitmesini önleyen kurallar.
 *
 * Geçmişte bir belge akışında koruma yokken üç gerçek mesaj mükellefe gitti.
 * Buradaki üç kural o hatanın tekrarını engelliyor ve hiçbiri bozulduğunda
 * ekran hata vermez — yalnız mesaj yanlış kişiye gider. O yüzden kilitli.
 */

const servisKur = () => new EvrakMesajService({} as any, {} as any);

describe('evrak mesajı — varsayılan TEST', () => {
  const eski = process.env.MOREN_EVRAK_CANLI;
  afterEach(() => {
    if (eski === undefined) delete process.env.MOREN_EVRAK_CANLI;
    else process.env.MOREN_EVRAK_CANLI = eski;
  });

  it('env yokken canlı DEĞİL — mesaj mükellefe gitmez', () => {
    delete process.env.MOREN_EVRAK_CANLI;
    expect(servisKur().canliMi()).toBe(false);
  });

  it('"1" dışındaki hiçbir değer canlıyı açmaz', () => {
    for (const v of ['0', 'true', 'evet', 'yes', '']) {
      process.env.MOREN_EVRAK_CANLI = v;
      expect(servisKur().canliMi()).toBe(false);
    }
  });

  it('yalnız tam olarak "1" canlıyı açar', () => {
    process.env.MOREN_EVRAK_CANLI = '1';
    expect(servisKur().canliMi()).toBe(true);
  });
});

describe('evrak mesajı — mesai penceresi (Pzt-Cum 09:00-17:00 TR)', () => {
  const s = servisKur();
  /** Türkiye saatiyle verilen anı UTC Date'e çevirir (yaz saati +03) */
  const tr = (iso: string) => new Date(`${iso}+03:00`);

  it('hafta içi 09:00 açılış — dahil', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T09:00:00'))).toBe(true); // Salı
  });

  it('hafta içi 16:59 — dahil', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T16:59:00'))).toBe(true);
  });

  it('hafta içi 17:00 — HARİÇ (kapanış saati dışarıda)', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T17:00:00'))).toBe(false);
  });

  it('hafta içi 08:59 — HARİÇ', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T08:59:00'))).toBe(false);
  });

  it('gece yarısı mesaj GİTMEZ', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T03:00:00'))).toBe(false);
  });

  it('Cumartesi kapalı', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-22T12:00:00'))).toBe(false);
  });

  it('Pazar kapalı', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-23T12:00:00'))).toBe(false);
  });

  it('Cuma öğlen açık', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-21T12:00:00'))).toBe(true);
  });
});

describe('evrak mesajı — metin', () => {
  const s = servisKur();

  it('yer tutucular hem "dönem" hem "donem" yazımını kabul eder', () => {
    expect(s.doldur('{ad} · {dönem} · {donem}', 'AHMET ATALAY', 'Temmuz 2026'))
      .toBe('AHMET ATALAY · Temmuz 2026 · Temmuz 2026');
  });

  it('şirkette unvan, kişide ad soyad kullanılır', () => {
    expect(s.ad({ companyName: 'YGS PLASTİK' })).toBe('YGS PLASTİK');
    expect(s.ad({ firstName: 'Ahmet', lastName: 'Atalay' })).toBe('Ahmet Atalay');
    expect(s.ad({})).toBe('Sayın Mükellef');
  });

  it('dönem adı Türkçe ay ile yazılır', () => {
    expect(s.donemAdi(2026, 7)).toBe('Temmuz 2026');
  });

  it('phones[] öncelikli, yoksa phone alanına düşer', () => {
    expect(s.telefonlar({ phones: ['0555', '0533'], phone: '0111' })).toEqual(['0555', '0533']);
    expect(s.telefonlar({ phones: [], phone: '0111' })).toEqual(['0111']);
    expect(s.telefonlar({})).toEqual([]);
  });
});

describe('evrak mesajı — önizleme mükellefe GÖNDEREMEZ', () => {
  const eski = process.env.MOREN_EVRAK_CANLI;
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;

  /** Gönderilen (numara, metin) çiftlerini toplayan sahte WhatsApp servisi */
  const kur = () => {
    const gidenler: Array<{ no: string; metin: string }> = [];
    const whatsapp = {
      isAutomationActive: async () => true,
      sendMessage: async (no: string, metin: string) => {
        gidenler.push({ no, metin });
        return true;
      },
    };
    const prisma = { communicationLog: { create: async () => ({}) } };
    return { gidenler, servis: new EvrakMesajService(prisma as any, whatsapp as any) };
  };

  const mukellef = { id: 'x', companyName: 'DENEME LTD', phones: ['905550000001'] };
  const cagri = (ek: any = {}) => ({
    tenantId: 't1',
    taxpayer: mukellef,
    metin: 'Metin',
    tur: 'TALEP' as const,
    donem: 'Temmuz 2026',
    sebep: 'test',
    mesaiYokSay: true,
    ...ek,
  });

  beforeEach(() => {
    process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475';
  });
  afterEach(() => {
    if (eski === undefined) delete process.env.MOREN_EVRAK_CANLI;
    else process.env.MOREN_EVRAK_CANLI = eski;
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  it('CANLI açıkken bile zorlaTest mükellefin numarasına göndermez', async () => {
    process.env.MOREN_EVRAK_CANLI = '1';
    const { gidenler, servis } = kur();
    const r = await servis.gonder(cagri({ zorlaTest: true }));

    expect(r.test).toBe(true);
    expect(gidenler.map((g) => g.no)).toEqual(['905350587475']);
    expect(gidenler.some((g) => g.no === '905550000001')).toBe(false);
    expect(gidenler[0].metin).toContain('EVRAK OTOMASYONU — TEST');
    expect(gidenler[0].metin).toContain('DENEME LTD');
  });

  it('zorlaTest yokken CANLI gerçekten mükellefe gider', async () => {
    process.env.MOREN_EVRAK_CANLI = '1';
    const { gidenler, servis } = kur();
    const r = await servis.gonder(cagri());

    expect(r.test).toBe(false);
    expect(gidenler.map((g) => g.no)).toEqual(['905550000001']);
  });

  it('mesaiYokSay verilmezse mesai dışında hiçbir şey gönderilmez', async () => {
    const { gidenler, servis } = kur();
    jest.spyOn(servis, 'mesaiIcindeMi').mockReturnValue(false);
    const r = await servis.gonder(cagri({ mesaiYokSay: false, zorlaTest: true }));

    expect(r.gonderildi).toBe(false);
    expect(r.atlandi).toBe('mesai dışı');
    expect(gidenler).toHaveLength(0);
  });
});

describe('evrak mesajı — başlık sarmalı (ekstre ile aynı düzen)', () => {
  const s = servisKur();

  it('Gönderen ve Sayın kalın, ofis ve ad ayrı satırda', () => {
    expect(s.sarmala('MOREN MALİ MÜŞAVİRLİK', 'FİGEN KABAKCI', 'Gövde metni.')).toBe(
      // Ad'ın önünde BOŞLUK YOK: ekstre kalıbından ` ${ad},` diye kopyalanmıştı,
      // WhatsApp'ta satır bir tık içeriden başlıyordu (kullanıcı fark etti).
      '*Gönderen*\nMOREN MALİ MÜŞAVİRLİK\n\n*Sayın*\nFİGEN KABAKCI,\n\nGövde metni.',
    );
  });

  it('gövde metinlerinde hitap ve ofis adı YOK — başlıkta zaten var', () => {
    for (const m of Object.values(EvrakMesajService.VARSAYILAN)) {
      expect(m).not.toContain('Sayın');
      expect(m).not.toMatch(/Moren Mali M/i);
      expect(m).toContain('{dönem}');
    }
  });
});

describe('evrak mesajı — başlıksız gönderim', () => {
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;

  const kur = () => {
    const gidenler: Array<{ no: string; metin: string }> = [];
    const whatsapp = {
      isAutomationActive: async () => true,
      sendMessage: async (no: string, metin: string) => { gidenler.push({ no, metin }); return true; },
    };
    return { gidenler, servis: new EvrakMesajService({} as any, whatsapp as any) };
  };

  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475'; });
  afterEach(() => {
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  const cagri = (ek: any) => ({
    tenantId: 't1',
    taxpayer: { id: 'x', companyName: 'DENEME LTD', phones: ['905550000001'] },
    metin: 'Birebir gidecek metin.',
    tur: 'TALEP' as const,
    donem: 'Temmuz 2026',
    sebep: 'test',
    mesaiYokSay: true,
    zorlaTest: true,
    ...ek,
  });

  it('baslikSiz ile metnin ÖNÜNE hiçbir şey eklenmez', async () => {
    const { gidenler, servis } = kur();
    await servis.gonder(cagri({ baslikSiz: true }));
    expect(gidenler).toHaveLength(1);
    expect(gidenler[0].metin).toBe('Birebir gidecek metin.');
  });

  it('baslikSiz olsa da hedef yine SAHİP, mükellef değil', async () => {
    const { gidenler, servis } = kur();
    await servis.gonder(cagri({ baslikSiz: true }));
    expect(gidenler[0].no).toBe('905350587475');
  });

  it('baslikSiz yokken TEST başlığı eklenir', async () => {
    const { gidenler, servis } = kur();
    await servis.gonder(cagri({}));
    expect(gidenler[0].metin).toContain('EVRAK OTOMASYONU — TEST');
  });
});
