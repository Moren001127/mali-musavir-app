/**
 * TEST MODU (kaynak='test', 2026-09-13 — Muzaffer Bey: "kafana göre iş uydurma"):
 * geliştirici pilot koşuları Muzaffer Bey'in ekranına/telefonuna HİÇ düşmez.
 *  - portalAracIsleyici: okuma araçları çalışır; portala yazan / dışarı gönderen her araç "kuruTest" cevabıyla KESİLİR
 *    (create_pending_action → bildirim yok, send_* → onay kaydı yok).
 *  - ekipAgentAdi: iş dosyası 'ekiptest:' önekiyle açılır → 'ekip:' süzgeçleri (akış, pano, sabah özeti) görmez.
 *  - PLAN/19 H4 (2026-09-14): test koşusunun "Öğrendiklerim" satırları AiMemory'ye YAZILMAZ; "yok (…)" / 8 karakterden kısa
 *    ders satırları hiçbir koşuda kaydedilmez.
 * Prisma/araçlar sahte; ağ/DB/Agent SDK yok.
 */
import { EkipRunnerService, ekipAgentAdi, ogrenmeSatiriGecerliMi } from './ekip-runner.service';
import { ajanBul } from './ajan-tanimlari';

function isleyiciKur(kaynak: 'test' | 'portal') {
  const cagrilar: string[] = [];
  const tools = { execute: async (name: string) => (cagrilar.push(name), { ok: true, name }) };
  const prisma = { agentCommand: { findUnique: async () => ({ payload: {} }), update: async () => ({}) } };
  const onay = { onayla: async () => ({}) };
  const dispatcher = { dispatch: async (name: string) => (cagrilar.push('dispatch:' + name), { ok: true }) };
  const runner = new EkipRunnerService(prisma as any, tools as any, dispatcher as any, {} as any, onay as any);
  (runner as any).onayKaydiAc = async () => ({ previewId: 'PRV-TEST', confirmationText: 'x', expiresAt: new Date() });
  const ctx = { tenantId: 't', userId: null, taxpayerId: null };
  const p: any = { ajanId: 'banka-kasa', gorev: 'x', tenantId: 't', kaynak, taxpayerId: null, dryRun: true };
  const olaylar: any[] = [];
  const kuru: any[] = [];
  const onayBekleyen: any[] = [];
  const isleyici = (runner as any).portalAracIsleyici({
    p, ajan: ajanBul('banka-kasa')!, isId: 'is1', dryRun: true, ctx, emit: (e: any) => olaylar.push(e), toolUses: [], kuruTestYapilacaktilar: kuru, onayBekleyen,
  });
  const cagir = async (name: string, args: any) => JSON.parse((await isleyici({ name, args })).content[0].text);
  return { cagir, cagrilar, olaylar, kuru, onayBekleyen };
}

describe('ekip TEST modu (kaynak=test)', () => {
  it('iş dosyası öneki: test → ekiptest:, diğer kaynaklar → ekip:', () => {
    expect(ekipAgentAdi('fatura', 'test')).toBe('ekiptest:fatura');
    expect(ekipAgentAdi('fatura', 'portal')).toBe('ekip:fatura');
    expect(ekipAgentAdi('fatura', null)).toBe('ekip:fatura');
  });

  it('test modunda okuma serbest, portala yazan araç kesilir (bildirim/onay düşmez), dışarı gönderim onay kaydı açmaz', async () => {
    const t = isleyiciKur('test');
    expect((await t.cagir('list_fatura_merkezi', { taxpayerId: 'x' })).ok).toBe(true);
    const yaz = await t.cagir('create_pending_action', { title: 'Bilgi: deneme' });
    expect(yaz.kuruTest).toBe(true);
    expect(String(yaz.mesaj)).toContain('TEST');
    const gonder = await t.cagir('send_whatsapp_template', { to: '905551112233', message: 'm' });
    expect(gonder.kuruTest).toBe(true);
    expect(gonder.onayBekliyor).toBeUndefined();
    expect(t.onayBekleyen).toHaveLength(0);
    expect(t.cagrilar).toEqual(['list_fatura_merkezi']); // yazan/gönderen araçlar hiç çalışmadı
    expect(t.kuru.map((k) => k.name)).toEqual(['create_pending_action', 'send_whatsapp_template']);
  });

  it('portal kaynağında (kuru test) portal_yaz aracı ÇALIŞIR — test modu davranışı ona bulaşmaz', async () => {
    const t = isleyiciKur('portal');
    const yaz = await t.cagir('create_pending_action', { title: 'Bilgi: gerçek' });
    expect(yaz.ok).toBe(true);
    expect(t.cagrilar).toEqual(['dispatch:create_pending_action']);
  });
});

// PLAN/19 H4 (2026-09-14): test koşusu hafızaya yazmaz; boş/"yok" dersler hiçbir koşuda kaydedilmez
describe('öğrenme kaydı — test koşusu ve anlamsız satırlar (PLAN/19 H4)', () => {
  function kaydediciKur() {
    const yazilan: any[] = [];
    const prisma = { aiMemory: { create: async (d: any) => (yazilan.push(d.data), { id: 'm1' }) } };
    const runner = new EkipRunnerService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    (runner as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
    const kaydet = (kaynak: string, satirlar: string[]) =>
      (runner as any).ogrenilenleriKaydet({ tenantId: 't', kaynak, taxpayerId: null, userId: null, dryRun: true }, 'fatura', 'is1', satirlar);
    const ayikla = (m: string) => (runner as any).ogrenilenleriAyikla(m) as string[];
    return { yazilan, kaydet, ayikla };
  }

  it('kaynak=test → AiMemory.create HİÇ çağrılmaz; aynı satırlar portal koşusunda yazılır', async () => {
    const t = kaydediciKur();
    const dersler = ['get_tax_calendar boş dönebiliyor; ofis kuralından hesapla.', 'Q2 gelir tablosu yoksa mizan 6xx hesaplarından türet.'];
    await t.kaydet('test', dersler);
    expect(t.yazilan).toEqual([]);
    await t.kaydet('portal', dersler);
    expect(t.yazilan.map((d) => d.title)).toEqual(dersler);
    expect(t.yazilan[0]).toMatchObject({ scope: 'ekip', source: 'fatura', tags: ['ekip', 'fatura'] });
  });

  it('"yok", "yok (tek mükellefe özel…)", 8 karakterden kısa satırlar ne ayıklanır ne kaydedilir', async () => {
    const t = kaydediciKur();
    expect(ogrenmeSatiriGecerliMi('yok')).toBe(false);
    expect(ogrenmeSatiriGecerliMi('Yok.')).toBe(false);
    expect(ogrenmeSatiriGecerliMi('yok (tek mükellefe özel bilgi, genellenemez)')).toBe(false);
    expect(ogrenmeSatiriGecerliMi('Yok — tek seferlik talimattı')).toBe(false);
    expect(ogrenmeSatiriGecerliMi('kısa')).toBe(false);
    expect(ogrenmeSatiriGecerliMi('————————')).toBe(false);
    expect(ogrenmeSatiriGecerliMi('yoklama listesi her ay güncellenir')).toBe(true); // "yok" ile başlayan başka kelime ders olabilir
    expect(ogrenmeSatiriGecerliMi('get_mizan dönem etiketi YYYY-MM ister')).toBe(true);

    const metin = [
      'ÖĞRENDİM: yok (tek mükellefe özel, genellenemez)',
      '**Öğrendiklerim:**',
      '- yok',
      '- Yok.',
      '- yok (bu koşuda öğrenilen bir kural olmadı)',
      '- compare_periods kaynak adı küçük harf olmalı.',
    ].join('\n');
    expect(t.ayikla(metin)).toEqual(['compare_periods kaynak adı küçük harf olmalı.']);

    // Ayıklama dışından gelen listede de aynı süzgeç (kaydet katmanı)
    await t.kaydet('portal', ['yok (tek mükellefe özel)', 'kısa', 'get_mizan dönem etiketi YYYY-MM ister']);
    expect(t.yazilan.map((d) => d.title)).toEqual(['get_mizan dönem etiketi YYYY-MM ister']);
  });
});
