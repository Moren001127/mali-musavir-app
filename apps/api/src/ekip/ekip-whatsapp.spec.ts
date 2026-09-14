/**
 * EKİP ↔ WHATSAPP köprüsü (PLAN/19 §C, 2026-09-14):
 *  - saf fonksiyonlar: sahipKomutu (ONAYLIYORUM/REDDET/YAPILDI), ekipYoluMu (kapı), mesaj biçimleri (✅/❌/▶️/📌/🔔), rapor sadeleştirme;
 *  - servis (sahte runner/whatsapp/prisma): kuru denemede koşu ve gönderim YOK; ilk cevap sınırı aşılınca "iletildi" + arka planda
 *    bitince ✅ mesajı; sync bitişte tek cevap, ayrı mesaj yok; çocuk koşu ▶️; komutlar (ekip kaydı değilse null; HTTP kaynağı yürütülmez);
 *    gönderim yeniden deneme; aynı vakada tampon birleştirme.
 */
import { EkipWhatsappService } from './ekip-whatsapp.service';
import { EkipKosuOlayi, EkipRunnerService } from './ekip-runner.service';
import {
  baslangicMesaji,
  bitisMesaji,
  donemEtiketi,
  ekipWhatsappAcik,
  ekipYoluMu,
  iletildiMetni,
  insanKonusu,
  istekMesaji,
  kuruDenemeMetni,
  onayMesaji,
  onaySatiri,
  sahipCevabiOlustur,
  sahipKomutu,
  whatsappRaporMetni,
  whatsappRaporOzeti,
} from './ekip-whatsapp';
import { ajanSec } from '../moren-ai/ses-koordinator';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── SAF: sahip komutu ───

describe('ekip-whatsapp — sahipKomutu', () => {
  it('ONAYLIYORUM / REDDET: Türkçe İ-ı, #, küçük harf, kısa kimlik ve not', () => {
    expect(sahipKomutu('ONAYLIYORUM #PRV-1A2B')).toEqual({ tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', not: '' });
    expect(sahipKomutu('onaylıyorum prv-1a2b')).toEqual({ tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', not: '' });
    expect(sahipKomutu('  Onaylıyorum #1A2B ')).toEqual({ tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', not: '' });
    expect(sahipKomutu('reddet #PRV-1A2B yanlış mükellef')).toEqual({ tur: 'REDDET', kimlik: 'PRV-1A2B', not: 'yanlış mükellef' });
    expect(sahipKomutu('REDDET PRV-1A2B\nsonra bakarız')).toEqual({ tur: 'REDDET', kimlik: 'PRV-1A2B', not: 'sonra bakarız' });
    // WhatsApp kalın kopyası ve iki nokta
    expect(sahipKomutu('*ONAYLIYORUM #PRV-1A2B*')).toEqual({ tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', not: '' });
    expect(sahipKomutu('Onaylıyorum: #PRV-1A2B.')).toEqual({ tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', not: '' });
  });

  it('YAPILDI: bildirim kimliği ön eki küçük harfe çevrilir', () => {
    expect(sahipKomutu('YAPILDI #CMNYD1A2')).toEqual({ tur: 'YAPILDI', kimlik: 'cmnyd1a2', not: '' });
    expect(sahipKomutu('yapıldı cmnyd1a2 fişler geldi')).toEqual({ tur: 'YAPILDI', kimlik: 'cmnyd1a2', not: 'fişler geldi' });
  });

  it('çıplak "onaylıyorum", kimliksiz ya da kalıba uymayan mesaj → null (belge-gönder onayı bozulmaz)', () => {
    for (const m of ['onaylıyorum', 'onaylıyorum gönder', 'tamam', '', 'ONAYLIYORUM #PRV-1A2B-UZUN-KIMLIK-X', 'reddet 12', 'bu işi reddet lütfen'])
      expect(sahipKomutu(m)).toBeNull();
  });
});

// ─── SAF: ekip yolu kapısı ───

describe('ekip-whatsapp — ekipYoluMu', () => {
  it('iş istekleri (PLAN/17 §5 eşlemesi) ve ekip soruları → true (Türkçe ekler serbest)', () => {
    for (const m of [
      "Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın",
      "Öz Ela Turizm'in 2. dönem gelir tablosunu analiz edin",
      'İşler ne durumda?',
      'Ekibe söyle, bugün ne yaptınız',
      'Koordinatöre ilet: Tahir Sucu denetimi',
      'Mihsap faturalarını çek', // ajan yok gerekçeli — Koordinatör nedenini söyler
      'hangi iş kimde kaldı',
      'personel bugün ne yaptı',
    ])
      expect({ m, sonuc: ekipYoluMu(m) }).toEqual({ m, sonuc: true });
  });

  it('selam / teşekkür / tek kelime / sıradan veri sorusu → false', () => {
    for (const m of ['selam', 'teşekkürler', 'ekip', 'Koordinatör', 'merhaba nasılsın', "Ahmet'in cari borcu ne kadar?", '', '   '])
      expect({ m, sonuc: ekipYoluMu(m) }).toEqual({ m, sonuc: false });
  });

  it('köprü anahtarı: varsayılan açık, yalnız off kapatır', () => {
    expect(ekipWhatsappAcik({} as any)).toBe(true);
    expect(ekipWhatsappAcik({ EKIP_WHATSAPP_KOORDINATOR: 'OFF' } as any)).toBe(false);
  });
});

// ─── SAF: mesaj biçimleri ───

describe('ekip-whatsapp — mesaj biçimleri', () => {
  it('whatsappRaporMetni: RAPOR sonrası, ÖĞRENDİM düşer, markdown sadeleşir, tavan kırpar', () => {
    const rapor = ['Önce araçları çağırdım.', '**RAPOR:** Haziran döneminde **3 mükellef** bekliyor.', '- İlgi Oto: KDV kontrol bitti.', 'ÖĞRENDİM: Sahip haziranı önce sorar.'].join('\n');
    expect(whatsappRaporMetni(rapor)).toBe('Haziran döneminde 3 mükellef bekliyor.\n• İlgi Oto: KDV kontrol bitti.');
    expect(whatsappRaporMetni('x'.repeat(50), 10)).toBe('xxxxxxxxxx…');
    expect(whatsappRaporMetni('')).toBe('');
  });

  it('✅ bitirdi: ajan · mükellef · konu, rapor özeti (900, satır sınırı), onay satırı yalnız varsa, kuru test satırı', () => {
    const m = bitisMesaji({
      ajanAd: 'Beyanname Uzmanı',
      mukellefAd: 'İlgi Oto',
      konu: 'Ağustos KDV kontrolü',
      rapor: `RAPOR: ${'a'.repeat(1000)}`,
      basarisiz: false,
      dryRun: true,
      kuruTestSayisi: 2,
      onayBekleyen: [{ previewId: 'PRV-1A2B' }],
    });
    const satirlar = m.split('\n');
    expect(satirlar[0]).toBe('✅ Beyanname Uzmanı bitirdi — İlgi Oto · Ağustos KDV kontrolü');
    expect(satirlar[1].length).toBe(901); // 900 + "…"
    expect(m).toContain('Göndermek için ONAYLIYORUM #PRV-1A2B yazın.');
    expect(m).toContain("'canlı yap' yazın");
    // mükellef yok + onay yok → "Onayınızı bekleyen: yok" satırı YOK
    const m2 = bitisMesaji({ ajanAd: 'Analist', konu: 'gelir tablosu', rapor: 'RAPOR: tamam', basarisiz: false, dryRun: false, kuruTestSayisi: 0, onayBekleyen: [] });
    expect(m2).toBe('✅ Analist bitirdi — gelir tablosu (canlı)\ntamam');
    // konu mükellef adıyla başlıyorsa mükellef tekrar yazılmaz
    expect(bitisMesaji({ ajanAd: 'Analist', mukellefAd: 'YAŞAR ÖZKAN', konu: 'yaşar özkan ın ağustos kdv kontrolü', rapor: 'RAPOR: ok', basarisiz: false, dryRun: true, kuruTestSayisi: 0, onayBekleyen: [] }))
      .toBe('✅ Analist bitirdi — yaşar özkan ın ağustos kdv kontrolü\nok');
  });

  it('bölümlü personel raporu: yalnız Bulgular (+ dolu Sizden istenen / Emin değilim); başlık, Yaptığım iş, Baktığım kaynaklar, Öğrendiklerim, DEVİR düşer', () => {
    const rapor = [
      'KDV KONTROL — YAŞAR ÖZKAN 2026/08 (İşletme defteri) — KURU TEST',
      '',
      'Yaptığım iş: Ağustos 2026 KDV Kontrol zincirini (R1) kuru testte kurdum.',
      'Baktığım kaynaklar: Mükellef kartı, KDV Kontrol modülü.',
      'Bulgular:',
      '- Luca 20 satır, Mihsap 20 fatura; fark yok.',
      '- 1 fatura OCR okumadı (BASBUG).',
      'Onayınızı bekleyen: yok',
      'Sizden istenen: yok',
      'Kime döndü: Koordinatör',
      'Emin değilim: OCR eşiği düşük olabilir.',
      'Öğrendiklerim: Sahip haziranı önce sorar.',
      'DEVİR: yok',
    ].join('\n');
    expect(whatsappRaporOzeti(rapor)).toBe(['• Luca 20 satır, Mihsap 20 fatura; fark yok.', '• 1 fatura OCR okumadı (BASBUG).', 'Emin olmadığım: OCR eşiği düşük olabilir.'].join('\n'));
    // bölümsüz rapor → sadeleşmiş tam metin; tavan satır sınırında
    expect(whatsappRaporOzeti('RAPOR: **Kısa** sonuç (R1).')).toBe('Kısa sonuç.');
    const uzun = whatsappRaporOzeti(Array.from({ length: 40 }, (_, i) => `satır ${i} ${'x'.repeat(30)}`).join('\n'), 300);
    expect(uzun.length).toBeLessThanOrEqual(301);
    expect(uzun.endsWith('…')).toBe(true);
    expect(uzun.slice(0, -1).endsWith('x')).toBe(true); // yarım satır yok
  });

  it('insanKonusu: reçete kodu, taxpayerId, Mükellef/Dönem kuyruğu düşer; dönem Türkçe ay; kelime sınırında kısalır', () => {
    expect(insanKonusu('KDV Kontrol (R1). Mükellef: YAŞAR ÖZKAN (taxpayerId: cmnydmggn002beazyy1hmo434). Dönem: 2026/08. Kuru test.')).toBe('KDV Kontrol · Ağustos 2026');
    expect(insanKonusu('KDV Kontrol devam (R1). Mükellef: ERCAN SANLAV (taxpayerId: abc). Dönem: 2026-08 (Ağustos 2026); Luca çekimi bitti')).toBe('KDV Kontrol devam · Ağustos 2026');
    expect(insanKonusu('İlgi Oto 2026/08 KDV kontrolü (R1)')).toBe('İlgi Oto Ağustos 2026 KDV kontrolü');
    expect(insanKonusu("Muzaffer Bey WhatsApp'tan yazıyor; cevabın kısa olsun.\nSORU/KOMUT: yaşar özkan ın ağustos 2026 kdv kontrolünü portaldan yap — kuru test olarak değil canlı yap"))
      .toBe('yaşar özkan ın ağustos 2026 kdv kontrolünü portaldan yap');
    expect(insanKonusu('İlgi Oto Yedek Parçanın Ağustos 2026 Dönemi KDV Kontrol İşlemini Canlı Olarak Başlat')).toBe('İlgi Oto Yedek Parçanın Ağustos 2026 Dönemi KDV Kontrol…');
    expect(insanKonusu('')).toBe('iş');
    expect(donemEtiketi('Dönem: 2026/12')).toBe('Aralık 2026');
    expect(donemEtiketi('yok')).toBe('');
  });

  it('❌ yapamadı / ▶️ başladı / 📌 sizden istenen / 🔔 onay', () => {
    expect(bitisMesaji({ ajanAd: 'Denetçi', konu: '3. dönem denetimi', rapor: '', hata: 'iptal edildi (Muzaffer Bey)', basarisiz: true, dryRun: true, kuruTestSayisi: 0, onayBekleyen: [] }))
      .toBe('❌ Denetçi yapamadı — 3. dönem denetimi\niptal edildi (Muzaffer Bey)');
    expect(baslangicMesaji({ ajanAd: 'Fatura Uzmanı', mukellefAd: 'Tahir Sucu', konu: 'Ağustos faturaları', dryRun: true })).toBe('▶️ Fatura Uzmanı başladı — Tahir Sucu · Ağustos faturaları');
    expect(istekMesaji({ ajanAd: 'Banka-Kasa', mukellefAd: 'Tahir Sucu', baslik: 'Ziraat ekstresi gerekli', bildirimId: 'cmnyd1a2b3c4d5' }))
      .toBe('📌 Banka-Kasa sizden istiyor — Tahir Sucu: Ziraat ekstresi gerekli\nYapınca YAPILDI #cmnyd1a2 yazın.');
    const o = onayMesaji({ ajanAd: 'Müşteri İlişkileri', mukellefAd: 'İlgi Oto', konu: 'tebligat iletimi', previewId: 'PRV-1A2B', arac: 'send_whatsapp_message', hedef: '905551112233' });
    expect(o.split('\n')).toEqual([
      '🔔 Müşteri İlişkileri onayınızı bekliyor — İlgi Oto · tebligat iletimi',
      'WhatsApp mesajı → 905551112233',
      'Göndermek için ONAYLIYORUM #PRV-1A2B, vazgeçmek için REDDET #PRV-1A2B yazın.',
    ]);
    expect(onaySatiri([{ previewId: 'PRV-1' }, { previewId: 'PRV-2' }])).toBe('Onayınızı bekleyen: #PRV-1, #PRV-2 — her biri için ONAYLIYORUM #PRV-XXXX yazın.');
    expect(onaySatiri([])).toBe('');
  });

  it('sync cevap: rapor + onay + istek + kuru test satırı; canlıda başa CANLI modda; hata + boş rapor → ❌', () => {
    const c = sahipCevabiOlustur({ rapor: 'RAPOR: Beyanname Uzmanı başlatıldı.', dryRun: true, kuruTestSayisi: 1, onayBekleyen: [{ previewId: 'PRV-9' }], istekler: [{ id: 'cmnyd1a2xyz', baslik: 'Şifre lazım' }] });
    expect(c.split('\n\n')).toEqual([
      'Beyanname Uzmanı başlatıldı.',
      'Göndermek için ONAYLIYORUM #PRV-9 yazın.',
      'Sizden istenen: Şifre lazım — yapınca YAPILDI #cmnyd1a2 yazın.',
      "Kuru testte hazırladım; gerçekten yapmamı isterseniz 'canlı yap' yazın.",
    ]);
    expect(sahipCevabiOlustur({ rapor: 'RAPOR: ok', dryRun: false, kuruTestSayisi: 0, onayBekleyen: [] })).toBe('Canlı modda.\n\nok');
    expect(sahipCevabiOlustur({ rapor: '', hata: 'Max yok', dryRun: true, kuruTestSayisi: 0, onayBekleyen: [] })).toBe('❌ Koordinatör yapamadı: Max yok');
    // iş numarası YAZILMAZ (Muzaffer Bey 2026-09-15: gereksiz kodlar)
    expect(iletildiMetni('cmnyd1a2b3c4', true)).toBe("İsteğinizi aldım, Koordinatör'e ilettim. Sonucu buradan yazacağım.");
    expect(iletildiMetni(null, false)).toBe("İsteğinizi aldım, Koordinatör'e canlı modda ilettim. Sonucu buradan yazacağım.");
    expect(kuruDenemeMetni({ canli: false, oneri: ajanSec("Erdoğan Balçık'ın KDV kontrolünü yap") })).toBe("Kuru deneme: mesaj Koordinatör'e iletilecekti (kuru test; yönlendirme: beyanname/R1). Koşu başlatılmadı, mesaj gönderilmedi.");
  });
});

// ─── SERVİS (sahte runner / whatsapp / prisma) ───

function kosuBilgisi(p: any, isId: string, ek: any = {}) {
  return {
    isId,
    ajanId: p.ajanId,
    ajanAd: p.ajanId === 'koordinator' ? 'Koordinatör' : p.ajanId,
    tenantId: p.tenantId,
    userId: p.userId ?? null,
    taxpayerId: p.taxpayerId ?? null,
    gorev: p.gorev,
    dryRun: p.dryRun !== false,
    kaynak: p.kaynak,
    vakaId: p.vakaId || isId,
    ustIsId: p.ustIsId || null,
    whatsappHedef: p.whatsappHedef || null,
    ...ek,
  };
}

/** Sahte runner: calistir baslangic → (opsiyonel ara olaylar) → sureMs sonra bitti + sonuç. Gerçek runner gibi dinleyiciyi calistir dönmeden çağırır. */
function sahteRunner(opts: { sureMs: number; rapor?: string; onayBekleyen?: any[]; araOlay?: (tetikle: (o: any) => void, kosu: any) => Promise<void> | void } = { sureMs: 1 }) {
  let dinleyici: ((o: any) => void) | null = null;
  const cagrilar: any[] = [];
  const r = {
    cagrilar,
    bitisDinleyiciEkle: (d: any) => {
      dinleyici = d;
    },
    tetikle: (o: any) => dinleyici?.(o),
    calistir: async (p: any) => {
      cagrilar.push(p);
      const isId = 'is-kok-1';
      p.emit?.({ type: 'baslangic', isId, ajanId: p.ajanId, model: 'm', dryRun: p.dryRun !== false });
      const kosu = kosuBilgisi(p, isId);
      dinleyici?.({ tur: 'basladi', kosu });
      if (opts.araOlay) await opts.araOlay((o) => dinleyici?.(o), kosu);
      await bekle(opts.sureMs);
      const sonuc = {
        isId,
        ajanId: p.ajanId,
        rapor: opts.rapor ?? 'RAPOR: Beyanname Uzmanı başlatıldı.',
        toolUses: [],
        kuruTestYapilacaktilar: [],
        onayBekleyen: opts.onayBekleyen || [],
        ogrenilen: [],
        model: 'm',
        durationMs: opts.sureMs,
        costUsd: 0,
      };
      dinleyici?.({ tur: 'bitti', kosu, sonuc, basarisiz: false, durum: 'done' });
      return sonuc;
    },
  };
  return r;
}

function sahteWhatsapp(sonuclar: boolean[] = []) {
  const gonderilen: Array<{ tel: string; metin: string; tenantId: string; opts: any }> = [];
  let i = 0;
  return {
    gonderilen,
    sendMessage: async (tel: string, metin: string, tenantId: string, opts: any) => {
      gonderilen.push({ tel, metin, tenantId, opts });
      const ok = i < sonuclar.length ? sonuclar[i] : true;
      i++;
      return ok;
    },
  };
}

function sahtePrisma(ek: any = {}) {
  const aiMesajlar: any[] = [];
  const iletisim: any[] = [];
  const isaretler: string[] = [];
  return {
    aiMesajlar,
    iletisim,
    isaretler,
    // bitiş işareti: jsonb_set(... '{whatsappBitis}' ...) WHERE id = $2 → strings[…] + values[deger, isId]
    $executeRaw: async (_strings: TemplateStringsArray, ...values: any[]) => (isaretler.push(`${values[1]}:${String(values[0]).split('@')[0]}`), 1),
    agentCommand: { findMany: async () => [] },
    user: { findFirst: async () => ({ id: 'u1' }) },
    taxpayer: { findFirst: async (arg: any) => (arg?.where?.id === 'tp1' ? { companyName: 'İlgi Oto' } : null) },
    aiMessage: { create: async (arg: any) => (aiMesajlar.push(arg.data), { id: 'm' }) },
    communicationLog: { create: async (arg: any) => (iletisim.push(arg.data), { id: 'c' }) },
    ownerApprovalRequest: { findFirst: async () => null },
    notification: { findMany: async () => [] },
    ...ek,
  };
}

function servisKur(o: { runner?: any; whatsapp?: any; prisma?: any; onay?: any; akis?: any; ilkCevapMs?: number } = {}) {
  const runner = o.runner || sahteRunner();
  const whatsapp = o.whatsapp || sahteWhatsapp();
  const prisma = o.prisma || sahtePrisma();
  const onay = o.onay || { onayla: jest.fn(async () => ({ ok: true, yurutulen: 'send_whatsapp_message' })), reddet: jest.fn(async () => ({ ok: true })) };
  const akis = o.akis || { istekKapat: jest.fn(async () => ({ ok: true })) };
  const s = new EkipWhatsappService(whatsapp as any, runner as any, onay as any, akis as any, prisma as any);
  (s as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
  s.ilkCevapMs = o.ilkCevapMs ?? 40;
  (s as any).tamponMs = 2;
  (s as any).yenidenDenemeMs = 1;
  s.onModuleInit();
  return { s, runner, whatsapp, prisma, onay, akis };
}

const SAHIP = { tenantId: 't1', telefon: '905350587475', konusmaId: 'konusma-1', sahipKisiId: 'sahip-kisi' };

describe('EkipWhatsappService — sahip mesajı', () => {
  const eskiEmail = process.env.MOREN_OWNER_EMAIL;
  beforeAll(() => {
    process.env.MOREN_OWNER_EMAIL = 'muzaffer@example.com';
  });
  afterAll(() => {
    if (eskiEmail === undefined) delete process.env.MOREN_OWNER_EMAIL;
    else process.env.MOREN_OWNER_EMAIL = eskiEmail;
  });

  it('kuru deneme (bot __dryRun): koşu başlatılmaz, hiçbir şey gönderilmez, "iletilecekti" metni', async () => {
    const { s, runner, whatsapp } = servisKur();
    const r = await s.sahipMesaji({ ...SAHIP, metin: "Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın", kuruMesaj: true });
    expect(r.metin).toMatch(/^Kuru deneme: mesaj Koordinatör'e iletilecekti \(kuru test; yönlendirme: beyanname\/R1\)/);
    expect(r).toMatchObject({ isId: null, arkaPlanda: false });
    await bekle(10);
    expect(runner.cagrilar).toEqual([]);
    expect(whatsapp.gonderilen).toEqual([]);
  });

  it('sync bitiş: kaynak whatsapp + whatsappHedef + dryRun; tek cevap, ayrı WhatsApp mesajı YOK', async () => {
    const { s, runner, whatsapp, prisma } = servisKur({ runner: sahteRunner({ sureMs: 1, onayBekleyen: [{ previewId: 'PRV-1A2B', name: 'send_whatsapp_message', args: {} }] }) });
    const r = await s.sahipMesaji({ ...SAHIP, metin: 'Ekibe söyle KDV kontrolünü yapsın' });
    expect(runner.cagrilar[0]).toMatchObject({ ajanId: 'koordinator', tenantId: 't1', userId: 'u1', dryRun: true, kaynak: 'whatsapp', whatsappHedef: '905350587475' });
    expect(runner.cagrilar[0].gorev).toContain("Muzaffer Bey WhatsApp'tan yazıyor");
    expect(runner.cagrilar[0].gorev.endsWith('SORU/KOMUT: Ekibe söyle KDV kontrolünü yapsın')).toBe(true);
    expect(r.arkaPlanda).toBe(false);
    expect(r.isId).toBe('is-kok-1');
    expect(r.metin).toBe('Beyanname Uzmanı başlatıldı.\n\nGöndermek için ONAYLIYORUM #PRV-1A2B yazın.');
    await bekle(15);
    expect(whatsapp.gonderilen).toEqual([]);
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokArkaPlanda: false, kokBitti: true });
    expect((prisma as any).isaretler).toEqual(['is-kok-1:sync']); // sync cevap verildi → bitiş işareti (drenaj taraması tekrar üretmesin)
  });

  it('"canlı yap" → dryRun:false; sahip kullanıcısı yoksa canlı koşu başlamaz', async () => {
    const a = servisKur();
    const r1 = await a.s.sahipMesaji({ ...SAHIP, metin: 'KDV kontrolünü canlı yap' });
    expect(a.runner.cagrilar[0].dryRun).toBe(false);
    expect(r1.metin.startsWith('Canlı modda.')).toBe(true);
    const b = servisKur({ prisma: sahtePrisma({ user: { findFirst: async () => null } }) });
    const r2 = await b.s.sahipMesaji({ ...SAHIP, metin: 'KDV kontrolünü canlı yap' });
    expect(r2.metin).toMatch(/Portal kullanıcınızı bulamadım/);
    expect(b.runner.cagrilar).toEqual([]);
    // kuru koşu kullanıcısız yine olur
    const r3 = await b.s.sahipMesaji({ ...SAHIP, metin: 'KDV kontrolünü yap' });
    expect(b.runner.cagrilar[0]).toMatchObject({ userId: null, dryRun: true });
    expect(r3.isId).toBe('is-kok-1');
  });

  it('zaman aşımı: "iletildi" döner; biriken 🔔 akıtılır; koşu bitince ✅ mesajı WhatsApp\'a gider ve hafızaya yazılır', async () => {
    const runner = sahteRunner({
      sureMs: 120,
      rapor: 'RAPOR: Beyanname Uzmanı KDV kontrolünü bitirdi.',
      araOlay: async (tetikle, kosu) => {
        await bekle(5);
        tetikle({ tur: 'onay', kosu, onay: { previewId: 'PRV-7F00', name: 'send_whatsapp_message', args: { to: '905551112233' }, expiresAt: new Date(), confirmationText: 'ONAYLIYORUM #PRV-7F00' } });
      },
    });
    const { s, whatsapp, prisma } = servisKur({ runner, ilkCevapMs: 40 });
    const t0 = Date.now();
    const r = await s.sahipMesaji({ ...SAHIP, metin: "Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın" });
    expect(Date.now() - t0).toBeLessThan(110);
    expect(r).toEqual({ metin: "İsteğinizi aldım, Koordinatör'e ilettim. Sonucu buradan yazacağım.", isId: 'is-kok-1', arkaPlanda: true });
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokArkaPlanda: true, kokBitti: false, birikenSayisi: 0 });
    await bekle(30);
    // sync penceresinde biriken onay olayı zaman aşımında akıtıldı
    expect(whatsapp.gonderilen.length).toBe(1);
    expect(whatsapp.gonderilen[0]).toMatchObject({ tel: '905350587475', tenantId: 't1', opts: { quote: false } });
    expect(whatsapp.gonderilen[0].metin).toContain('🔔 Koordinatör onayınızı bekliyor');
    expect(whatsapp.gonderilen[0].metin).toContain('Göndermek için ONAYLIYORUM #PRV-7F00, vazgeçmek için REDDET #PRV-7F00 yazın.');
    await bekle(120);
    expect(whatsapp.gonderilen.length).toBe(2);
    expect(whatsapp.gonderilen[1].metin).toBe('✅ Koordinatör bitirdi — Erdoğan Balçık\'ın Ağustos KDV kontrolünü yapın\nBeyanname Uzmanı KDV kontrolünü bitirdi.');
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokBitti: true });
    await bekle(10);
    expect(prisma.isaretler).toEqual(['is-kok-1:gonderildi']);
    // hafıza: communicationLog + aiMessage (model etiketi)
    expect(prisma.iletisim.map((x: any) => x.subject)).toEqual(['WhatsApp owner ekip bildirimi', 'WhatsApp owner ekip bildirimi']);
    expect(prisma.aiMesajlar.map((x: any) => x.model)).toEqual(['ekip-koordinator:whatsapp', 'ekip-koordinator:whatsapp']);
    expect(prisma.aiMesajlar[1].conversationId).toBe('konusma-1');
  });

  it('koşu omurgada hiç başlamadıysa (Max yok) kısa neden döner, mesaj gitmez', async () => {
    const runner = { cagrilar: [], bitisDinleyiciEkle: () => undefined, calistir: async () => ({ isId: '', ajanId: 'koordinator', rapor: '', hata: 'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).', toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 0, costUsd: 0 }) };
    const { s, whatsapp } = servisKur({ runner });
    const r = await s.sahipMesaji({ ...SAHIP, metin: 'işler ne durumda' });
    expect(r.metin).toBe("Koordinatör'e iletemedim: Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).");
    await bekle(10);
    expect(whatsapp.gonderilen).toEqual([]);
  });
});

describe('EkipWhatsappService — koşu olayları (çocuk koşu, tampon, yeniden deneme)', () => {
  const cocukKosu = (ek: any = {}) => ({
    isId: 'is-cocuk-1',
    ajanId: 'beyanname',
    ajanAd: 'Beyanname Uzmanı',
    tenantId: 't1',
    userId: 'u1',
    taxpayerId: 'tp1',
    gorev: 'İlgi Oto 2026/08 KDV kontrolü (R1)',
    dryRun: true,
    kaynak: 'koordinator',
    vakaId: 'is-kok-1',
    ustIsId: 'is-kok-1',
    whatsappHedef: '905350587475',
    ...ek,
  });

  it('çocuk koşu ▶️ başladı + ✅ bitti aynı vakada tamponda birleşir; mükellef adı çözülür', async () => {
    const { s, whatsapp, prisma } = servisKur();
    const kosu = cocukKosu();
    s.kosuOlayi({ tur: 'basladi', kosu });
    s.kosuOlayi({ tur: 'bitti', kosu, sonuc: { isId: 'is-cocuk-1', ajanId: 'beyanname', rapor: 'RAPOR: fark yok.', toolUses: [], kuruTestYapilacaktilar: [{ name: 'x', args: {}, kademe: 'luca_yaz' }], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 1, costUsd: 0 }, basarisiz: false, durum: 'done' });
    await bekle(25);
    expect(whatsapp.gonderilen.length).toBe(1);
    expect(whatsapp.gonderilen[0].metin).toBe(
      ['▶️ Beyanname Uzmanı başladı — İlgi Oto Ağustos 2026 KDV kontrolü', '', '✅ Beyanname Uzmanı bitirdi — İlgi Oto Ağustos 2026 KDV kontrolü', 'fark yok.', "Kuru testte hazırladım; gerçekten yapmamı isterseniz 'canlı yap' yazın."].join('\n'),
    );
    await bekle(10);
    expect((prisma as any).isaretler).toEqual(['is-cocuk-1:gonderildi']);
  });

  // Muzaffer Bey 2026-09-15: "işi bitirdi ama hâlâ sürüyor görünüyor" — Koordinatör'ün "bitirdi"si personel daha çalışırken geliyordu.
  it('kök Koordinatör arka plandayken personele iş verdiyse kendi ✅ mesajı ATLANIR (işaret: atlandi); onay/soru/hata varsa yazılır', async () => {
    const runner = sahteRunner({
      sureMs: 100,
      rapor: "RAPOR: Beyanname Uzmanı'nı başlattım, biterken bildiririm.",
      araOlay: async (tetikle, kosu) => {
        await bekle(50);
        tetikle({ tur: 'basladi', kosu: { ...kosu, isId: 'is-cocuk-9', ajanId: 'beyanname', ajanAd: 'KDV/Beyanname Uzmanı', ustIsId: kosu.isId, gorev: 'KDV Kontrol (R1). Mükellef: İlgi Oto (taxpayerId: tp1). Dönem: 2026/08.', taxpayerId: 'tp1' } });
      },
    });
    const { s, whatsapp, prisma } = servisKur({ runner, ilkCevapMs: 20 });
    const r = await s.sahipMesaji({ ...SAHIP, metin: "İlgi Oto'nun Ağustos KDV kontrolünü yapın" });
    expect(r.arkaPlanda).toBe(true);
    await bekle(140);
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokArkaPlanda: true, kokBitti: true, cocukBasladi: true });
    expect(whatsapp.gonderilen.map((g: any) => g.metin)).toEqual(['▶️ KDV/Beyanname Uzmanı başladı — İlgi Oto · KDV Kontrol · Ağustos 2026']);
    expect(prisma.isaretler).toContain('is-kok-1:atlandi');
    // aynı durumda rapor SORU içeriyorsa kökün mesajı yine gider
    const runner2 = sahteRunner({ sureMs: 100, rapor: 'RAPOR: Başlattım.\nSORU: Beyannameyi de hazırlayayım mı?', araOlay: async (tetikle, kosu) => { await bekle(30); tetikle({ tur: 'basladi', kosu: { ...kosu, isId: 'c2', ustIsId: kosu.isId, ajanAd: 'Analist', gorev: 'x' } }); } });
    const b = servisKur({ runner: runner2, ilkCevapMs: 20 });
    await b.s.sahipMesaji({ ...SAHIP, metin: "İlgi Oto'nun Ağustos KDV kontrolünü yapın" });
    await bekle(140);
    expect(b.whatsapp.gonderilen.map((g: any) => g.metin.split('\n')[0])).toEqual(['▶️ Analist başladı — x', "✅ Koordinatör bitirdi — İlgi Oto'nun Ağustos KDV kontrolünü yapın"]);
  });

  it('drenaj taraması: başka süreçte bitmiş, whatsappHedef dolu, işaretsiz işlerin ✅/❌ mesajı bu süreçten gider; devretmiş kök ve işaretli/kendi süreci atlanır', async () => {
    const bitti = new Date(Date.now() - 60_000);
    const isler = [
      { id: 'd1', tenantId: 't1', agent: 'ekip:beyanname', status: 'done', payload: { whatsappHedef: '905350587475', surec: 'eski@1', gorev: 'KDV Kontrol (R1). Mükellef: İlgi Oto (taxpayerId: tp1). Dönem: 2026/08.', taxpayerId: 'tp1', dryRun: false, vakaId: 'k1', ustIsId: 'k1' }, result: { rapor: 'Bulgular:\n- fark yok.', toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [] }, finishedAt: bitti },
      { id: 'd2', tenantId: 't1', agent: 'ekip:fatura', status: 'failed', payload: { whatsappHedef: '905350587475', surec: 'eski@1', gorev: 'Fatura çekimi', dryRun: true, vakaId: 'k2', ustIsId: 'k2' }, result: { rapor: '', hata: 'Koşuyu yürüten sunucu kopyası durdu (son nabız 5 dk önce)' }, finishedAt: bitti },
      { id: 'kok', tenantId: 't1', agent: 'ekip:koordinator', status: 'done', payload: { whatsappHedef: '905350587475', surec: 'eski@1', gorev: 'SORU/KOMUT: x', dryRun: true, vakaId: 'kok' }, result: { rapor: 'RAPOR: verdim', toolUses: [{ name: 'ekip_ajan_baslat', args: {} }] }, finishedAt: bitti },
      { id: 'isaretli', tenantId: 't1', agent: 'ekip:analist', status: 'done', payload: { whatsappHedef: '905350587475', surec: 'eski@1', gorev: 'y', whatsappBitis: 'gonderildi@2026' }, result: { rapor: 'x' }, finishedAt: bitti },
      { id: 'portal', tenantId: 't1', agent: 'ekip:analist', status: 'done', payload: { surec: 'eski@1', gorev: 'y' }, result: { rapor: 'x' }, finishedAt: bitti },
    ];
    const sorgular: any[] = [];
    const prisma = sahtePrisma({ agentCommand: { findMany: async (q: any) => (sorgular.push(q), isler) } });
    const { s, whatsapp } = servisKur({ prisma });
    expect(await s.drenajBitisleriniTara()).toBe(2);
    expect(sorgular[0].where).toMatchObject({ agent: { startsWith: 'ekip:' }, status: { in: ['done', 'failed'] } });
    await bekle(15);
    expect(whatsapp.gonderilen.map((g: any) => g.metin)).toEqual([
      '✅ KDV/Beyanname Uzmanı bitirdi — İlgi Oto · KDV Kontrol · Ağustos 2026 (canlı)\n• fark yok.',
      '❌ Fatura Muhasebecisi yapamadı — Fatura çekimi\nKoşuyu yürüten sunucu kopyası durdu (son nabız 5 dk önce)',
    ]);
    await bekle(10);
    expect(prisma.isaretler.sort()).toEqual(['d1:gonderildi', 'd2:gonderildi', 'kok:atlandi']);
  });

  it('❌ yapamadı ve 📌 sizden istenen; whatsappHedef yoksa hiçbir şey gitmez', async () => {
    const { s, whatsapp } = servisKur();
    s.kosuOlayi({ tur: 'bitti', kosu: cocukKosu({ taxpayerId: null }), sonuc: { isId: 'is-cocuk-1', ajanId: 'beyanname', rapor: '', hata: 'iptal edildi (Muzaffer Bey)', toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 1, costUsd: 0 }, basarisiz: true, durum: 'failed' });
    s.kosuOlayi({ tur: 'istek', kosu: cocukKosu({ vakaId: 'is-kok-2', taxpayerId: null }), bildirimId: 'cmnyd1a2b3c4d5', baslik: 'Ziraat ekstresi gerekli' });
    s.kosuOlayi({ tur: 'basladi', kosu: cocukKosu({ whatsappHedef: null }) });
    await bekle(25);
    expect(whatsapp.gonderilen.map((g: any) => g.metin)).toEqual([
      '❌ Beyanname Uzmanı yapamadı — İlgi Oto Ağustos 2026 KDV kontrolü\niptal edildi (Muzaffer Bey)',
      '📌 Beyanname Uzmanı sizden istiyor — Ziraat ekstresi gerekli\nYapınca YAPILDI #cmnyd1a2 yazın.',
    ]);
  });

  it('kök koşu WhatsApp kaynaklı değilse (iz yok, ustIsId yok) bitti olayı mesaj üretmez', async () => {
    const { s, whatsapp } = servisKur();
    s.kosuOlayi({ tur: 'bitti', kosu: cocukKosu({ ustIsId: null, vakaId: 'is-portal', isId: 'is-portal' }), sonuc: { isId: 'is-portal', ajanId: 'beyanname', rapor: 'RAPOR: x', toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 1, costUsd: 0 }, basarisiz: false, durum: 'done' });
    await bekle(15);
    expect(whatsapp.gonderilen).toEqual([]);
  });

  it('gönderim başarısızsa yeniden dener (3 deneme), sonra vazgeçer', async () => {
    const a = servisKur({ whatsapp: sahteWhatsapp([false, false, true]) });
    a.s.kosuOlayi({ tur: 'basladi', kosu: cocukKosu() });
    await bekle(40);
    expect(a.whatsapp.gonderilen.length).toBe(3);
    expect(a.prisma.iletisim.length).toBe(0); // iz yok (portal kaynaklı vaka) → hafıza kaydı yok; gönderim yine gitti
    const b = servisKur({ whatsapp: sahteWhatsapp([false, false, false, false]) });
    b.s.kosuOlayi({ tur: 'basladi', kosu: cocukKosu() });
    await bekle(40);
    expect(b.whatsapp.gonderilen.length).toBe(3);
  });
});

describe('EkipWhatsappService — komutlar', () => {
  const eskiEmail = process.env.MOREN_OWNER_EMAIL;
  beforeAll(() => {
    process.env.MOREN_OWNER_EMAIL = 'muzaffer@example.com';
  });
  afterAll(() => {
    if (eskiEmail === undefined) delete process.env.MOREN_OWNER_EMAIL;
    else process.env.MOREN_OWNER_EMAIL = eskiEmail;
  });
  const ekipKaydi = { findFirst: async (arg: any) => (arg?.where?.previewId === 'PRV-1A2B' ? { id: 'oar1', status: 'PENDING', action: 'send_whatsapp_message' } : null) };

  it('ONAYLIYORUM: ekip kaydı varsa onayla(kaynak whatsapp); yoksa null (eski akış); REDDET not ile', async () => {
    const { s, onay } = servisKur({ prisma: sahtePrisma({ ownerApprovalRequest: ekipKaydi }) });
    expect(await s.komutIsle({ tenantId: 't1', tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B' })).toBe('✅ #PRV-1A2B onaylandı, gönderildi (send_whatsapp_message).');
    expect(onay.onayla).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', previewId: 'PRV-1A2B', onayMetni: 'ONAYLIYORUM #PRV-1A2B', kaynak: 'whatsapp' });
    expect(await s.komutIsle({ tenantId: 't1', tur: 'ONAYLIYORUM', kimlik: 'PRV-ZZZZ' })).toBeNull();
    expect(await s.komutIsle({ tenantId: 't1', tur: 'REDDET', kimlik: 'PRV-1A2B', not: 'yanlış mükellef' })).toBe('#PRV-1A2B reddedildi; mesaj gönderilmeyecek.');
    expect(onay.reddet).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', previewId: 'PRV-1A2B', not: 'REDDET (WhatsApp): yanlış mükellef' });
  });

  it('kuru deneme kayda dokunmaz; kimliksiz HTTP kaynağı yürütmez; onayla hata dönerse ❌', async () => {
    const onay = { onayla: jest.fn(async () => ({ ok: false, error: 'Onay süresi dolmuş' })), reddet: jest.fn() };
    const { s } = servisKur({ prisma: sahtePrisma({ ownerApprovalRequest: ekipKaydi }), onay });
    expect(await s.komutIsle({ tenantId: 't1', tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', kuruMesaj: true })).toBe('Kuru deneme: #PRV-1A2B onaylanıp yürütülecekti (send_whatsapp_message); kayda dokunulmadı.');
    expect(await s.komutIsle({ tenantId: 't1', tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', kimliksizKaynak: true })).toMatch(/gerçek WhatsApp bağlantısından gelmediği için/);
    expect(onay.onayla).not.toHaveBeenCalled();
    expect(await s.komutIsle({ tenantId: 't1', tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B' })).toBe('❌ #PRV-1A2B yürütülemedi: Onay süresi dolmuş');
  });

  it('YAPILDI: açık ekip istek bildirimi ön ekle bulunur ve kapatılır; bulunamazsa / çoğulsa metin', async () => {
    const bildirimler = [
      { id: 'cmnyd1a2b3c4', title: 'Ziraat ekstresi gerekli', isRead: false, metadata: { automationId: 'ekip:banka-kasa:is1', tur: 'istek' } },
      { id: 'cmnyd1a2zzzz', title: 'Bilgi notu', isRead: false, metadata: { automationId: 'ekip:koordinator:is1', tur: 'bilgi' } },
      { id: 'cmnyd1a2kapa', title: 'Kapanmış istek', isRead: false, metadata: { automationId: 'ekip:banka-kasa:is1', tur: 'istek', kapandi: '2026-09-14' } },
    ];
    const prisma = sahtePrisma({ notification: { findMany: async (arg: any) => bildirimler.filter((b) => b.id.startsWith(arg.where.id.startsWith)) } });
    const { s, akis } = servisKur({ prisma });
    expect(await s.komutIsle({ tenantId: 't1', tur: 'YAPILDI', kimlik: 'cmnyd1a2' })).toBe('📌 Kapatıldı: Ziraat ekstresi gerekli');
    expect(akis.istekKapat).toHaveBeenCalledWith('t1', 'u1', 'cmnyd1a2b3c4');
    expect(await s.komutIsle({ tenantId: 't1', tur: 'YAPILDI', kimlik: 'yok12345' })).toMatch(/Açık "sizden istenen" kalemi bulunamadı: #yok12345/);
    expect(await s.komutIsle({ tenantId: 't1', tur: 'YAPILDI', kimlik: 'cmnyd1a2', kuruMesaj: true })).toBe('Kuru deneme: "Ziraat ekstresi gerekli" kapatılacaktı; kayda dokunulmadı.');
    expect(await s.komutIsle({ tenantId: 't1', tur: 'YAPILDI', kimlik: 'cmnyd1a2', kimliksizKaynak: true })).toMatch(/YAPILMADI/);
    expect(akis.istekKapat).toHaveBeenCalledTimes(1);
  });
});

// ─── RUNNER: koşu olayları + whatsappHedef payload/çocuk kopyası (gerçek EkipRunnerService, sahte SDK/Prisma) ───

function sahteRunnerPrisma() {
  const olusturulan: any[] = [];
  const kayitlar = new Map<string, any>();
  let sayac = 0;
  return {
    olusturulan,
    kayitlar,
    agentCommand: {
      create: async (arg: any) => {
        const id = `is-${++sayac}`;
        olusturulan.push({ id, ...arg.data });
        kayitlar.set(id, { id, ...arg.data, result: null });
        return { id };
      },
      update: async (arg: any) => {
        const k = kayitlar.get(arg.where.id) || {};
        kayitlar.set(arg.where.id, { ...k, ...arg.data });
        return { id: arg.where.id };
      },
      findUnique: async (arg: any) => kayitlar.get(arg?.where?.id) || { payload: {} },
      findFirst: async (arg: any) => (arg?.where?.status?.in ? null : kayitlar.get(arg?.where?.id) || null),
      count: async () => 0,
    },
    agentEvent: { create: async () => ({}) },
    aiMemory: { create: async () => ({}) },
    aiUsageLog: { create: async () => ({}) },
    ownerApprovalRequest: { findUnique: async () => null, create: async (arg: any) => ({ id: 'oar', ...arg.data }) },
    auditLog: { create: async () => ({}) },
  };
}

function sahteSdk() {
  return {
    tool: () => ({}),
    createSdkMcpServer: () => ({}),
    query: () => {
      async function* uret() {
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'RAPOR: bitti.' } } };
        await bekle(5);
        yield { type: 'result', is_error: false, total_cost_usd: 0 };
      }
      return uret();
    },
  };
}

const sessizLog = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };

describe('EkipRunnerService — koşu olayları (bitisDinleyiciEkle) ve whatsappHedef', () => {
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  beforeAll(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken;
  });

  it('kök koşu: payload kaynak=whatsapp + whatsappHedef; basladi/bitti olayları; ekip_ajan_baslat çocuğa whatsappHedef kopyalar (ustIsId/vakaId dolu)', async () => {
    const prisma = sahteRunnerPrisma();
    const r = new EkipRunnerService(prisma as any, {} as any, {} as any, { getRulesForUi: async () => [] } as any, {} as any);
    (r as any).sdkYukle = async () => sahteSdk();
    (r as any).logger = sessizLog;
    const olaylar: EkipKosuOlayi[] = [];
    r.bitisDinleyiciEkle((o) => olaylar.push(o));
    r.bitisDinleyiciEkle(() => {
      throw new Error('dinleyici hatası koşuyu bozmaz');
    });
    const kok = { ajanId: 'koordinator', gorev: 'SORU/KOMUT: işler ne durumda', tenantId: 't1', userId: 'u1', kaynak: 'whatsapp' as const, dryRun: true, whatsappHedef: '905350587475' };
    const sonuc = await r.calistir(kok);
    expect(sonuc.hata).toBeUndefined();
    expect(prisma.olusturulan[0]).toMatchObject({ agent: 'ekip:koordinator' });
    expect(prisma.olusturulan[0].payload).toMatchObject({ kaynak: 'whatsapp', whatsappHedef: '905350587475', ustIsId: null });
    expect(olaylar.map((o) => o.tur)).toEqual(['basladi', 'bitti']);
    expect(olaylar[0].kosu).toMatchObject({ isId: sonuc.isId, ajanId: 'koordinator', ajanAd: 'Koordinatör', whatsappHedef: '905350587475', ustIsId: null, vakaId: sonuc.isId, kaynak: 'whatsapp', dryRun: true });
    expect(olaylar[1]).toMatchObject({ tur: 'bitti', basarisiz: false, durum: 'done', sonuc: { isId: sonuc.isId, rapor: 'RAPOR: bitti.' } });

    const cocuk = await (r as any).ekipAraciCalistir('ekip_ajan_baslat', { ajanId: 'beyanname', gorev: 'İlgi Oto 2026/08 KDV kontrolü (R1)' }, { ...kok, vakaId: sonuc.isId }, sonuc.isId);
    expect(cocuk.ok).toBe(true);
    await bekle(80);
    const cocukOlaylar = olaylar.filter((o) => o.kosu.isId === cocuk.isId);
    expect(cocukOlaylar.map((o) => o.tur)).toEqual(['basladi', 'bitti']);
    expect(cocukOlaylar[0].kosu).toMatchObject({ ustIsId: sonuc.isId, vakaId: sonuc.isId, whatsappHedef: '905350587475', kaynak: 'koordinator', ajanAd: 'KDV/Beyanname Uzmanı' });
    expect(prisma.kayitlar.get(cocuk.isId).payload).toMatchObject({ whatsappHedef: '905350587475', kaynak: 'koordinator', ustIsId: sonuc.isId });
  });

  it('portal aracı: disari_gonder → onay olayı (PRV); create_pending_action tur:istek → istek olayı (bilgi → olay yok); ekip_onayla whatsapp kaynağında açık', async () => {
    const prisma = sahteRunnerPrisma();
    const dispatcher = { dispatch: jest.fn(async (_name: string, args: any) => ({ created: true, notificationId: 'cmnyd1a2b3c4', tur: args.tur })) };
    const onay = { onayla: jest.fn(async () => ({ ok: true })), reddet: jest.fn(async () => ({ ok: true })) };
    const r = new EkipRunnerService(prisma as any, {} as any, dispatcher as any, { getRulesForUi: async () => [] } as any, onay as any);
    (r as any).logger = sessizLog;
    const olaylar: EkipKosuOlayi[] = [];
    r.bitisDinleyiciEkle((o) => olaylar.push(o));
    const { ajanBul } = await import('./ajan-tanimlari');
    const p = { ajanId: 'banka-kasa', gorev: 'SORU/KOMUT: ekstre', tenantId: 't1', userId: 'u1', kaynak: 'koordinator' as const, dryRun: false, whatsappHedef: '905350587475', vakaId: 'vaka-1', ustIsId: 'vaka-1' };
    const k = { p, ajan: ajanBul('banka-kasa'), isId: 'is-c1', dryRun: false, ctx: { tenantId: 't1', userId: 'u1', taxpayerId: null }, emit: () => undefined, toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [] };
    const isleyici = (r as any).portalAracIsleyici(k);
    const cevap = (x: any) => JSON.parse(x.content[0].text);

    const o1 = cevap(await isleyici({ name: 'send_whatsapp_freeform', args: { to: '905551112233', message: 'x' } }));
    expect(o1.onayBekliyor).toBe(true);
    expect(olaylar[0]).toMatchObject({ tur: 'onay', kosu: { isId: 'is-c1', ustIsId: 'vaka-1', whatsappHedef: '905350587475' }, onay: { previewId: o1.previewId, name: 'send_whatsapp_freeform' } });

    const o2 = cevap(await isleyici({ name: 'create_pending_action', args: { title: 'Ziraat ekstresi gerekli', tur: 'istek' } }));
    expect(o2.created).toBe(true);
    expect(olaylar[1]).toMatchObject({ tur: 'istek', bildirimId: 'cmnyd1a2b3c4', baslik: 'Ziraat ekstresi gerekli' });
    await isleyici({ name: 'create_pending_action', args: { title: 'Not', tur: 'bilgi' } });
    expect(olaylar.length).toBe(2);

    // ekip_onayla: whatsapp kaynağı + userId → yürür; koordinator kaynağı → kapalı
    const acik = await (r as any).ekipAraciCalistir('ekip_onayla', { previewId: 'PRV-1A2B' }, { ...p, ajanId: 'koordinator', kaynak: 'whatsapp' });
    expect(acik.ok).toBe(true);
    expect(onay.onayla).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', previewId: 'PRV-1A2B', onayMetni: undefined, kaynak: 'whatsapp' });
    const kapali = await (r as any).ekipAraciCalistir('ekip_onayla', { previewId: 'PRV-1A2B' }, { ...p, ajanId: 'koordinator', kaynak: 'koordinator' });
    expect(kapali.ok).toBe(false);
    expect(kapali.error).toMatch(/portal\/ses\/WhatsApp/);
  });
});
