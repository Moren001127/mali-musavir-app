import { EvrakMesajService } from './evrak-mesaj.service';

/**
 * EVRAK MESAJLARI — mükellefe istenmeyen mesaj gitmesini önleyen kurallar.
 *
 * Geçmişte bir belge akışında koruma yokken üç gerçek mesaj mükellefe gitti.
 * Buradaki kuralların hiçbiri bozulduğunda ekran hata vermez — yalnız mesaj
 * yanlış kişiye, yanlış saatte veya yanlış dönemle gider. O yüzden kilitli.
 */

const servisKur = () => new EvrakMesajService({} as any, {} as any);

/** Türkiye saatiyle verilen anı Date'e çevirir (yaz saati +03, sabit) */
const tr = (iso: string) => new Date(`${iso}+03:00`);

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

describe('evrak mesajı — proaktif şalter iki mesaj türünü de kapsar', () => {
  const eski = process.env.MOREN_CLIENT_PROACTIVE_REMINDERS;
  afterEach(() => {
    if (eski === undefined) delete process.env.MOREN_CLIENT_PROACTIVE_REMINDERS;
    else process.env.MOREN_CLIENT_PROACTIVE_REMINDERS = eski;
  });

  it('env yokken proaktif KAPALI', () => {
    delete process.env.MOREN_CLIENT_PROACTIVE_REMINDERS;
    expect(servisKur().proaktifAcikMi()).toBe(false);
  });

  it('yalnız "1" açar', () => {
    process.env.MOREN_CLIENT_PROACTIVE_REMINDERS = 'evet';
    expect(servisKur().proaktifAcikMi()).toBe(false);
    process.env.MOREN_CLIENT_PROACTIVE_REMINDERS = '1';
    expect(servisKur().proaktifAcikMi()).toBe(true);
  });
});

describe('evrak mesajı — mesai penceresi (Pzt-Cum 09:00-17:00 TR)', () => {
  const s = servisKur();

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
    expect(s.mesaiIcindeMi(tr('2026-08-18T00:30:00'))).toBe(false);
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

  it('UTC gece yarısını aşan an TR gününe göre değerlendirilir', () => {
    // Cuma 23:00 UTC = Cumartesi 02:00 TR → kapalı olmalı.
    expect(s.mesaiIcindeMi(new Date('2026-08-21T23:00:00Z'))).toBe(false);
  });
});

describe('evrak mesajı — resmî tatil iki mesaj türünde de geçerli', () => {
  const s = servisKur();

  it('23 Nisan hafta içi ve mesai saatinde bile KAPALI', () => {
    // 2026-04-23 Perşembe
    expect(s.resmiTatilMi(tr('2026-04-23T11:00:00'))).toBe(true);
    expect(s.mesaiIcindeMi(tr('2026-04-23T11:00:00'))).toBe(false);
  });

  it('tatil olmayan hafta içi gün açık', () => {
    expect(s.resmiTatilMi(tr('2026-04-24T11:00:00'))).toBe(false);
    expect(s.mesaiIcindeMi(tr('2026-04-24T11:00:00'))).toBe(true);
  });
});

describe('evrak mesajı — dönem', () => {
  const s = servisKur();

  it('mükellefe yazılan dönem = işlem ayı − 1', () => {
    // Ağustos'ta işlenen evrak TEMMUZ dönemine aittir
    expect(s.beyannameDonemi(2026, 8).etiket).toBe('Temmuz 2026');
  });

  it('Ocak işlem ayında yıl da geriye kayar', () => {
    expect(s.beyannameDonemi(2026, 1)).toEqual({ yil: 2025, ay: 12, etiket: 'Aralık 2025' });
  });

  it('dönem adı Türkçe ay ile yazılır', () => {
    expect(s.donemAdi(2026, 7)).toBe('Temmuz 2026');
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

  it('phones[] öncelikli, yoksa phone alanına düşer', () => {
    expect(s.telefonlar({ phones: ['0555', '0533'], phone: '0111' })).toEqual(['0555', '0533']);
    expect(s.telefonlar({ phones: [], phone: '0111' })).toEqual(['0111']);
    expect(s.telefonlar({})).toEqual([]);
  });
});

describe('evrak mesajı — başlık sarmalı (ekstre ile aynı düzen)', () => {
  const s = servisKur();

  it('Gönderen ve Sayın kalın, ofis ve ad ayrı satırda', () => {
    // Ad'ın önünde BOŞLUK YOK: ekstre kalıbından ` ${ad},` diye kopyalanmıştı,
    // WhatsApp'ta satır bir tık içeriden başlıyordu (kullanıcı fark etti).
    expect(s.sarmala('MOREN MALİ MÜŞAVİRLİK', 'FİGEN KABAKCI', 'Gövde metni.')).toBe(
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

// ----------------------------------------------------------------- GÖNDERİM

const gonderimKur = () => {
  const gidenler: Array<{ no: string; metin: string }> = [];
  const izler: any[] = [];
  const whatsapp = {
    isAutomationActive: async () => true,
    sendMessage: async (no: string, metin: string) => { gidenler.push({ no, metin }); return true; },
  };
  const prisma = { communicationLog: { create: async (a: any) => { izler.push(a.data); return {}; } } };
  return { gidenler, izler, servis: new EvrakMesajService(prisma as any, whatsapp as any) };
};

const CAGRI = {
  tenantId: 't1',
  taxpayer: { id: 'x', companyName: 'DENEME LTD', phones: ['905550000001'] },
  metin: 'Birebir gidecek metin.',
  tur: 'TALEP' as const,
  donem: 'Temmuz 2026',
  sebep: 'test',
  mesaiYokSay: true,
};

describe('evrak mesajı — önizleme mükellefe GÖNDEREMEZ', () => {
  const eski = process.env.MOREN_EVRAK_CANLI;
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;

  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475'; });
  afterEach(() => {
    if (eski === undefined) delete process.env.MOREN_EVRAK_CANLI;
    else process.env.MOREN_EVRAK_CANLI = eski;
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  it('CANLI açıkken bile zorlaTest mükellefin numarasına göndermez', async () => {
    process.env.MOREN_EVRAK_CANLI = '1';
    const { gidenler, servis } = gonderimKur();
    const r = await servis.gonder({ ...CAGRI, zorlaTest: true });

    expect(r.test).toBe(true);
    expect(gidenler.map((g) => g.no)).toEqual(['905350587475']);
    expect(gidenler.some((g) => g.no === '905550000001')).toBe(false);
    expect(gidenler[0].metin).toContain('EVRAK OTOMASYONU — TEST');
    expect(gidenler[0].metin).toContain('DENEME LTD');
  });

  it('zorlaTest yokken CANLI gerçekten mükellefe gider', async () => {
    process.env.MOREN_EVRAK_CANLI = '1';
    const { gidenler, servis } = gonderimKur();
    const r = await servis.gonder({ ...CAGRI });

    expect(r.test).toBe(false);
    expect(gidenler.map((g) => g.no)).toEqual(['905550000001']);
  });

  it('mesaiYokSay verilmezse mesai dışında hiçbir şey gönderilmez', async () => {
    const { gidenler, servis } = gonderimKur();
    jest.spyOn(servis, 'mesaiIcindeMi').mockReturnValue(false);
    const r = await servis.gonder({ ...CAGRI, mesaiYokSay: false, zorlaTest: true });

    expect(r.gonderildi).toBe(false);
    expect(r.atlandi).toBe('mesai dışı');
    expect(gidenler).toHaveLength(0);
  });

  it('resmî tatilde atlama sebebi ayrı yazılır — erteleme kararı buna bakar', async () => {
    const { servis } = gonderimKur();
    jest.spyOn(servis, 'mesaiIcindeMi').mockReturnValue(false);
    jest.spyOn(servis, 'resmiTatilMi').mockReturnValue(true);
    const r = await servis.gonder({ ...CAGRI, mesaiYokSay: false });
    expect(r.atlandi).toBe('resmî tatil');
  });
});

describe('evrak mesajı — başlıksız gönderim', () => {
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;
  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475'; });
  afterEach(() => {
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  it('baslikSiz ile metnin ÖNÜNE hiçbir şey eklenmez', async () => {
    const { gidenler, servis } = gonderimKur();
    await servis.gonder({ ...CAGRI, zorlaTest: true, baslikSiz: true });
    expect(gidenler).toHaveLength(1);
    expect(gidenler[0].metin).toBe('Birebir gidecek metin.');
  });

  it('baslikSiz olsa da hedef yine SAHİP, mükellef değil', async () => {
    const { gidenler, servis } = gonderimKur();
    await servis.gonder({ ...CAGRI, zorlaTest: true, baslikSiz: true });
    expect(gidenler[0].no).toBe('905350587475');
  });

  it('baslikSiz yokken TEST başlığı eklenir', async () => {
    const { gidenler, servis } = gonderimKur();
    await servis.gonder({ ...CAGRI, zorlaTest: true });
    expect(gidenler[0].metin).toContain('EVRAK OTOMASYONU — TEST');
  });
});

describe('evrak mesajı — gönderim izi', () => {
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;
  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475'; });
  afterEach(() => {
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  it('test gönderimi de kaydedilir ve başlığında TEST der', async () => {
    const { izler, servis } = gonderimKur();
    await servis.gonder({ ...CAGRI, zorlaTest: true });
    expect(izler).toHaveLength(1);
    expect(izler[0].subject).toContain('[TEST]');
    expect(izler[0].subject).toContain('Temmuz 2026');
  });

  it('gerçek gönderim TEST etiketi TAŞIMAZ', async () => {
    const eski = process.env.MOREN_EVRAK_CANLI;
    process.env.MOREN_EVRAK_CANLI = '1';
    try {
      const { izler, servis } = gonderimKur();
      await servis.gonder({ ...CAGRI });
      expect(izler[0].subject).not.toContain('[TEST]');
      expect(izler[0].subject).toContain('Gönderildi');
    } finally {
      if (eski === undefined) delete process.env.MOREN_EVRAK_CANLI;
      else process.env.MOREN_EVRAK_CANLI = eski;
    }
  });
});

describe('evrak mesajı — başarısızlıkta sebep DOLU döner', () => {
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;
  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475'; });
  afterEach(() => {
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  /**
   * Çağıran "geçici engel mi, kalıcı ret mi" kararını `atlandi` alanına
   * bakarak veriyor. Boş kalırsa kayıt beklemeye ALINMIYOR ve onay mesajı
   * kalıcı olarak düşüyordu.
   */
  const kopukKur = () => {
    const whatsapp = { isAutomationActive: async () => true, sendMessage: async () => false };
    const prisma = { communicationLog: { create: async () => ({}) } };
    return new EvrakMesajService(prisma as any, whatsapp as any);
  };

  const cagri = {
    tenantId: 't1',
    taxpayer: { id: 'x', companyName: 'DENEME LTD', phones: ['905550000001'] },
    metin: 'Metin', tur: 'GELDI' as const, donem: 'Temmuz 2026',
    sebep: 'test', mesaiYokSay: true,
  };

  it('test modunda köprü kopuksa sebep yazılır', async () => {
    const r = await kopukKur().gonder({ ...cagri, zorlaTest: true });
    expect(r.gonderildi).toBe(false);
    expect(r.atlandi).toBe('WhatsApp gönderimi başarısız');
  });

  it('canlı modda köprü kopuksa sebep yazılır', async () => {
    const eski = process.env.MOREN_EVRAK_CANLI;
    process.env.MOREN_EVRAK_CANLI = '1';
    try {
      const r = await kopukKur().gonder({ ...cagri });
      expect(r.gonderildi).toBe(false);
      expect(r.atlandi).toBe('WhatsApp gönderimi başarısız');
    } finally {
      if (eski === undefined) delete process.env.MOREN_EVRAK_CANLI;
      else process.env.MOREN_EVRAK_CANLI = eski;
    }
  });
});

describe('evrak mesajı — TEK KURAL: teslim günü + anahtar', () => {
  const s = servisKur();
  /**
   * Kullanıcı kararı 2026-08-18: "Teslim günü tanımlanmayan mükellefe mesaj
   * gitmeyecek; sadece teslim tarihi tanımlı OLUP evrak talep / evrak geldi
   * anahtarları açık ise mesajlar gidecek."
   *
   * Bu kural bozulduğunda ekran hata vermez — yalnız istenmeyen mükellefe
   * gerçek mesaj gider. Kilitli.
   */
  const tam = {
    isActive: true, evrakTeslimGunu: 10,
    whatsappEvrakTalep: true, whatsappEvrakGeldi: true,
    phones: ['905550000001'],
  };

  it('teslim günü YOKSA hiçbir mesaj gitmez — anahtarlar açık olsa bile', () => {
    const t = { ...tam, evrakTeslimGunu: null };
    expect(s.uygunMu(t, 'TALEP')).toEqual({ uygun: false, sebep: 'teslim günü tanımsız' });
    expect(s.uygunMu(t, 'GELDI')).toEqual({ uygun: false, sebep: 'teslim günü tanımsız' });
  });

  it('teslim günü 0 değil ama undefined ise de gitmez', () => {
    const { evrakTeslimGunu, ...eksik } = tam;
    expect(s.uygunMu(eksik, 'TALEP').uygun).toBe(false);
  });

  it('teslim günü VAR ama talep anahtarı kapalıysa TALEP gitmez', () => {
    expect(s.uygunMu({ ...tam, whatsappEvrakTalep: false }, 'TALEP')).toEqual({
      uygun: false, sebep: '"Evrak talep mesajı" anahtarı kapalı',
    });
  });

  it('teslim günü VAR ama geldi anahtarı kapalıysa GELDI gitmez', () => {
    expect(s.uygunMu({ ...tam, whatsappEvrakGeldi: false }, 'GELDI')).toEqual({
      uygun: false, sebep: '"Evrak geldi onayı" anahtarı kapalı',
    });
  });

  it('iki anahtar BİRBİRİNDEN bağımsız — biri açıkken diğeri gitmez', () => {
    const yalnizTalep = { ...tam, whatsappEvrakGeldi: false };
    expect(s.uygunMu(yalnizTalep, 'TALEP').uygun).toBe(true);
    expect(s.uygunMu(yalnizTalep, 'GELDI').uygun).toBe(false);
  });

  it('anahtar "truthy" değil TAM OLARAK true olmalı', () => {
    for (const v of [1, 'true', 'evet', {}]) {
      expect(s.uygunMu({ ...tam, whatsappEvrakTalep: v }, 'TALEP').uygun).toBe(false);
    }
  });

  it('pasif mükellefe gitmez', () => {
    expect(s.uygunMu({ ...tam, isActive: false }, 'TALEP').uygun).toBe(false);
  });

  it('telefonu olmayana gitmez', () => {
    expect(s.uygunMu({ ...tam, phones: [], phone: null }, 'TALEP')).toEqual({
      uygun: false, sebep: 'telefon yok',
    });
  });

  it('hepsi tamamsa gider', () => {
    expect(s.uygunMu(tam, 'TALEP')).toEqual({ uygun: true });
    expect(s.uygunMu(tam, 'GELDI')).toEqual({ uygun: true });
  });
});

describe('evrak mesajı — gönderim aralığı', () => {
  const s = servisKur();
  const eski = process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS;
  afterEach(() => {
    if (eski === undefined) delete process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS;
    else process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS = eski;
  });

  it('varsayılan 5 saniye — toplu gönderim aralıksız olmasın', () => {
    delete process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS;
    expect(s.gonderimAralikMs()).toBe(5000);
  });

  it('env ile ayarlanabilir', () => {
    process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS = '12000';
    expect(s.gonderimAralikMs()).toBe(12000);
  });

  it('0 verilirse bekleme kapanır', () => {
    process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS = '0';
    expect(s.gonderimAralikMs()).toBe(0);
  });

  it('bozuk/negatif değer varsayılana döner — kazayla hız sınırı kalkmasın', () => {
    for (const v of ['abc', '-1', 'çok']) {
      process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS = v;
      expect(s.gonderimAralikMs()).toBe(5000);
    }
  });
});

describe('evrak mesajı — iz kaydı gönderilenin AYNISI olmalı', () => {
  const eskiTel = process.env.MOREN_OWNER_WHATSAPP_PHONES;
  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350587475'; });
  afterEach(() => {
    if (eskiTel === undefined) delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    else process.env.MOREN_OWNER_WHATSAPP_PHONES = eskiTel;
  });

  /**
   * 20 Ağustos 2026: teşhis bilgisi ("— Hedef: … · Sebep: …") kayıt metninin
   * ALTINA ekleniyordu. Mesaj Merkezi ekranı bu kaydı gösterdiği için
   * "gönderilen" ile "görünen" ayrıştı; mükellefe gitmeyen satır gitmiş gibi
   * göründü. Kayıt metni = gönderilen metin.
   */
  it('kayıt içeriğinde teşhis satırı YOK', async () => {
    const izler: any[] = [];
    const whatsapp = { isAutomationActive: async () => true, sendMessage: async () => true };
    const prisma = { communicationLog: { create: async (a: any) => { izler.push(a.data); return {}; } } };
    const servis = new EvrakMesajService(prisma as any, whatsapp as any);

    await servis.gonder({
      tenantId: 't1',
      taxpayer: { id: 'x', companyName: 'DENEME LTD', phones: ['905550000001'] },
      metin: 'Sadece bu metin gitti.',
      tur: 'GELDI', donem: 'Temmuz 2026',
      sebep: 'teşhis bilgisi', mesaiYokSay: true, zorlaTest: true,
    });

    expect(izler).toHaveLength(1);
    expect(izler[0].content).not.toContain('Hedef:');
    expect(izler[0].content).not.toContain('teşhis bilgisi');
    expect(izler[0].content).toContain('Sadece bu metin gitti.');
    // Teşhis başlıkta durur
    expect(izler[0].subject).toContain('Hedef:');
    expect(izler[0].subject).toContain('teşhis bilgisi');
  });
});
