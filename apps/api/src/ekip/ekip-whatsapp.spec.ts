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
  ekipWhatsappAcik,
  ekipYoluMu,
  iletildiMetni,
  istekMesaji,
  kuruDenemeMetni,
  onayMesaji,
  onaySatiri,
  sahipCevabiOlustur,
  sahipKomutu,
  whatsappRaporMetni,
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

  it('✅ bitirdi: ajan · mükellef · konu, rapor ilk 600, onay satırı, kuru test satırı', () => {
    const m = bitisMesaji({
      ajanAd: 'Beyanname Uzmanı',
      mukellefAd: 'İlgi Oto',
      konu: 'Ağustos KDV kontrolü',
      rapor: `RAPOR: ${'a'.repeat(700)}`,
      basarisiz: false,
      dryRun: true,
      kuruTestSayisi: 2,
      onayBekleyen: [{ previewId: 'PRV-1A2B' }],
    });
    const satirlar = m.split('\n');
    expect(satirlar[0]).toBe('✅ Beyanname Uzmanı bitirdi — İlgi Oto · Ağustos KDV kontrolü');
    expect(satirlar[1].length).toBe(601); // 600 + "…"
    expect(m).toContain('Onayınızı bekleyen: #PRV-1A2B → ONAYLIYORUM #PRV-1A2B yazın');
    expect(m).toContain("'canlı yap' yazın");
    // mükellef yok + onay yok
    const m2 = bitisMesaji({ ajanAd: 'Analist', konu: 'gelir tablosu', rapor: 'RAPOR: tamam', basarisiz: false, dryRun: false, kuruTestSayisi: 0, onayBekleyen: [] });
    expect(m2).toBe('✅ Analist bitirdi — gelir tablosu (canlı)\ntamam\nOnayınızı bekleyen: yok');
  });

  it('❌ yapamadı / ▶️ başladı / 📌 sizden istenen / 🔔 onay', () => {
    expect(bitisMesaji({ ajanAd: 'Denetçi', konu: '3. dönem denetimi', rapor: '', hata: 'iptal edildi (Muzaffer Bey)', basarisiz: true, dryRun: true, kuruTestSayisi: 0, onayBekleyen: [] }))
      .toBe('❌ Denetçi yapamadı — 3. dönem denetimi: iptal edildi (Muzaffer Bey)');
    expect(baslangicMesaji({ ajanAd: 'Fatura Uzmanı', mukellefAd: 'Tahir Sucu', konu: 'Ağustos faturaları', dryRun: true })).toBe('▶️ Fatura Uzmanı başladı — Tahir Sucu · Ağustos faturaları');
    expect(istekMesaji({ ajanAd: 'Banka-Kasa', mukellefAd: 'Tahir Sucu', baslik: 'Ziraat ekstresi gerekli', bildirimId: 'cmnyd1a2b3c4d5' }))
      .toBe('📌 Sizden istenen (Tahir Sucu): Ziraat ekstresi gerekli — yapınca YAPILDI #cmnyd1a2 yazın (Banka-Kasa)');
    const o = onayMesaji({ ajanAd: 'Müşteri İlişkileri', mukellefAd: 'İlgi Oto', konu: 'tebligat iletimi', previewId: 'PRV-1A2B', arac: 'send_whatsapp_message', hedef: '905551112233' });
    expect(o.split('\n')).toEqual([
      '🔔 Müşteri İlişkileri onayınızı bekliyor — İlgi Oto · tebligat iletimi',
      'send_whatsapp_message → 905551112233',
      'ONAYLIYORUM #PRV-1A2B yazın (vazgeçmek için REDDET #PRV-1A2B)',
    ]);
    expect(onaySatiri([{ previewId: 'PRV-1' }, { previewId: 'PRV-2' }])).toBe('Onayınızı bekleyen: #PRV-1, #PRV-2 → her biri için ONAYLIYORUM #PRV-XXXX yazın');
  });

  it('sync cevap: rapor + onay + istek + kuru test satırı; canlıda başa CANLI modda; hata + boş rapor → ❌', () => {
    const c = sahipCevabiOlustur({ rapor: 'RAPOR: Beyanname Uzmanı başlatıldı.', dryRun: true, kuruTestSayisi: 1, onayBekleyen: [{ previewId: 'PRV-9' }], istekler: [{ id: 'cmnyd1a2xyz', baslik: 'Şifre lazım' }] });
    expect(c.split('\n\n')).toEqual([
      'Beyanname Uzmanı başlatıldı.',
      'Onayınızı bekleyen: #PRV-9 → ONAYLIYORUM #PRV-9 yazın',
      'Sizden istenen: Şifre lazım — yapınca YAPILDI #cmnyd1a2 yazın',
      "Kuru testte hazırladım; gerçekten yapmamı isterseniz 'canlı yap' yazın.",
    ]);
    expect(sahipCevabiOlustur({ rapor: 'RAPOR: ok', dryRun: false, kuruTestSayisi: 0, onayBekleyen: [] })).toBe('CANLI modda.\n\nok');
    expect(sahipCevabiOlustur({ rapor: '', hata: 'Max yok', dryRun: true, kuruTestSayisi: 0, onayBekleyen: [] })).toBe('❌ Koordinatör yapamadı: Max yok');
    expect(iletildiMetni('cmnyd1a2b3c4', true)).toBe("İsteğinizi aldım, Koordinatör'e ilettim (iş #cmnyd1a2). Sonucu buradan yazacağım.");
    expect(iletildiMetni(null, false)).toBe("İsteğinizi aldım, Koordinatör'e ilettim. Sonucu buradan yazacağım. CANLI modda.");
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
  return {
    aiMesajlar,
    iletisim,
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
    const { s, runner, whatsapp } = servisKur({ runner: sahteRunner({ sureMs: 1, onayBekleyen: [{ previewId: 'PRV-1A2B', name: 'send_whatsapp_message', args: {} }] }) });
    const r = await s.sahipMesaji({ ...SAHIP, metin: 'Ekibe söyle KDV kontrolünü yapsın' });
    expect(runner.cagrilar[0]).toMatchObject({ ajanId: 'koordinator', tenantId: 't1', userId: 'u1', dryRun: true, kaynak: 'whatsapp', whatsappHedef: '905350587475' });
    expect(runner.cagrilar[0].gorev).toContain("Muzaffer Bey WhatsApp'tan yazıyor");
    expect(runner.cagrilar[0].gorev.endsWith('SORU/KOMUT: Ekibe söyle KDV kontrolünü yapsın')).toBe(true);
    expect(r.arkaPlanda).toBe(false);
    expect(r.isId).toBe('is-kok-1');
    expect(r.metin).toBe('Beyanname Uzmanı başlatıldı.\n\nOnayınızı bekleyen: #PRV-1A2B → ONAYLIYORUM #PRV-1A2B yazın');
    await bekle(15);
    expect(whatsapp.gonderilen).toEqual([]);
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokArkaPlanda: false, kokBitti: true });
  });

  it('"canlı yap" → dryRun:false; sahip kullanıcısı yoksa canlı koşu başlamaz', async () => {
    const a = servisKur();
    const r1 = await a.s.sahipMesaji({ ...SAHIP, metin: 'KDV kontrolünü canlı yap' });
    expect(a.runner.cagrilar[0].dryRun).toBe(false);
    expect(r1.metin.startsWith('CANLI modda.')).toBe(true);
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
    expect(r).toEqual({ metin: "İsteğinizi aldım, Koordinatör'e ilettim (iş #is-kok-1). Sonucu buradan yazacağım.", isId: 'is-kok-1', arkaPlanda: true });
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokArkaPlanda: true, kokBitti: false, birikenSayisi: 0 });
    await bekle(30);
    // sync penceresinde biriken onay olayı zaman aşımında akıtıldı
    expect(whatsapp.gonderilen.length).toBe(1);
    expect(whatsapp.gonderilen[0]).toMatchObject({ tel: '905350587475', tenantId: 't1', opts: { quote: false } });
    expect(whatsapp.gonderilen[0].metin).toContain('🔔 Koordinatör onayınızı bekliyor');
    expect(whatsapp.gonderilen[0].metin).toContain('ONAYLIYORUM #PRV-7F00 yazın');
    await bekle(120);
    expect(whatsapp.gonderilen.length).toBe(2);
    expect(whatsapp.gonderilen[1].metin).toBe('✅ Koordinatör bitirdi — Erdoğan Balçık\'ın Ağustos KDV kontrolünü yapın\nBeyanname Uzmanı KDV kontrolünü bitirdi.\nOnayınızı bekleyen: yok');
    expect(s.vakaIzi('is-kok-1')).toMatchObject({ kokBitti: true });
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
    const { s, whatsapp } = servisKur();
    const kosu = cocukKosu();
    s.kosuOlayi({ tur: 'basladi', kosu });
    s.kosuOlayi({ tur: 'bitti', kosu, sonuc: { isId: 'is-cocuk-1', ajanId: 'beyanname', rapor: 'RAPOR: fark yok.', toolUses: [], kuruTestYapilacaktilar: [{ name: 'x', args: {}, kademe: 'luca_yaz' }], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 1, costUsd: 0 }, basarisiz: false, durum: 'done' });
    await bekle(25);
    expect(whatsapp.gonderilen.length).toBe(1);
    expect(whatsapp.gonderilen[0].metin).toBe(
      ['▶️ Beyanname Uzmanı başladı — İlgi Oto · İlgi Oto 2026/08 KDV kontrolü (R1)', '', '✅ Beyanname Uzmanı bitirdi — İlgi Oto · İlgi Oto 2026/08 KDV kontrolü (R1)', 'fark yok.', 'Onayınızı bekleyen: yok', "Kuru testte hazırladım; gerçekten yapmamı isterseniz 'canlı yap' yazın."].join('\n'),
    );
  });

  it('❌ yapamadı ve 📌 sizden istenen; whatsappHedef yoksa hiçbir şey gitmez', async () => {
    const { s, whatsapp } = servisKur();
    s.kosuOlayi({ tur: 'bitti', kosu: cocukKosu({ taxpayerId: null }), sonuc: { isId: 'is-cocuk-1', ajanId: 'beyanname', rapor: '', hata: 'iptal edildi (Muzaffer Bey)', toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 1, costUsd: 0 }, basarisiz: true, durum: 'failed' });
    s.kosuOlayi({ tur: 'istek', kosu: cocukKosu({ vakaId: 'is-kok-2', taxpayerId: null }), bildirimId: 'cmnyd1a2b3c4d5', baslik: 'Ziraat ekstresi gerekli' });
    s.kosuOlayi({ tur: 'basladi', kosu: cocukKosu({ whatsappHedef: null }) });
    await bekle(25);
    expect(whatsapp.gonderilen.map((g: any) => g.metin)).toEqual([
      '❌ Beyanname Uzmanı yapamadı — İlgi Oto 2026/08 KDV kontrolü (R1): iptal edildi (Muzaffer Bey)',
      '📌 Sizden istenen: Ziraat ekstresi gerekli — yapınca YAPILDI #cmnyd1a2 yazın (Beyanname Uzmanı)',
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
