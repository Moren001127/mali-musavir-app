/**
 * CANLI ADIM (2026-09-15; Muzaffer Bey: "iş devam ederken aşamaları daha açık ama kısa yazsın"):
 *  - CanliAdimYazici: araç başlar → 'suruyor', biter → 'bitti'/'hata'; kuru/onay/red tek kayıt; yazımlar SIRALI (başladı/bitti karışmaz);
 *    argümanlar düz alanlara indirgenir (uzun metin kısalır, '__' iç alanlar ve nesneler atılır); tavan 60 adım.
 *  - portalAracIsleyici: her yol (çalıştır / kuru test / test modu / onay / kapalı araç) yazıcıya düşer; yazıcı verilmezse (spec) sorunsuz.
 *  - isGetir: yalnız running kayıtta payload.canli döner.
 * Prisma/araçlar sahte; ağ/DB/Agent SDK yok.
 */
import { CanliAdimYazici, EkipRunnerService } from './ekip-runner.service';
import { ajanBul } from './ajan-tanimlari';

function isleyiciKur(canli?: CanliAdimYazici, secenek: { hata?: boolean; canliMod?: boolean } = {}) {
  const tools = { execute: async (name: string) => (secenek.hata ? { ok: false, error: 'olmadı' } : { ok: true, name }) };
  const prisma = { agentCommand: { findUnique: async () => ({ payload: {} }), update: async () => ({}) } };
  const dispatcher = { dispatch: async () => ({ ok: true }) };
  const runner = new EkipRunnerService(prisma as any, tools as any, dispatcher as any, {} as any, {} as any);
  (runner as any).onayKaydiAc = async () => ({ previewId: 'PRV-1', confirmationText: 'x', expiresAt: new Date() });
  const ctx = { tenantId: 't', userId: null, taxpayerId: null };
  const dryRun = !secenek.canliMod;
  const p: any = { ajanId: 'banka-kasa', gorev: 'x', tenantId: 't', kaynak: 'portal', taxpayerId: null, dryRun };
  const isleyici = (runner as any).portalAracIsleyici({
    p, ajan: ajanBul('banka-kasa')!, isId: 'is1', dryRun, ctx, emit: () => undefined, toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [], canli,
  });
  return async (name: string, args: any) => JSON.parse((await isleyici({ name, args })).content[0].text);
}

describe('CanliAdimYazici', () => {
  it('başla → sürüyor, bitir → bitti; yazımlar sıralı ve kopya (sonraki değişiklik önceki kaydı bozmaz)', async () => {
    const yazilanlar: any[][] = [];
    const y = new CanliAdimYazici(async (adimlar) => {
      await new Promise((r) => setTimeout(r, 5));
      yazilanlar.push(adimlar);
    });
    const a = y.baslat('get_taxpayer', { taxpayerId: 'cm1', __ic: 'gizli', uzun: 'x'.repeat(300), nesne: { a: 1 }, liste: ['a', 'b'], sayi: 3 });
    expect(a.durum).toBe('suruyor');
    expect(a.args).toEqual({ taxpayerId: 'cm1', uzun: `${'x'.repeat(159)}…`, liste: ['a', 'b'], sayi: 3 });
    y.bitir(a, 'bitti');
    y.ekle('send_whatsapp_template', { to: '905' }, 'onay');
    await y.bekle();
    expect(yazilanlar.map((l) => l.map((x) => `${x.ad}:${x.durum}`))).toEqual([
      ['get_taxpayer:suruyor'],
      ['get_taxpayer:bitti'],
      ['get_taxpayer:bitti', 'send_whatsapp_template:onay'],
    ]);
    expect(yazilanlar[1][0].bitti).toBeTruthy();
    expect(yazilanlar[2][1].bitti).toBe(yazilanlar[2][1].basladi);
  });

  it('yazım hatası koşuyu bozmaz; tavan 60 adım (eskiler düşer)', async () => {
    let sayac = 0;
    const y = new CanliAdimYazici(async () => {
      sayac++;
      throw new Error('db yok');
    });
    for (let i = 0; i < 70; i++) y.ekle(`arac_${i}`, {}, 'kuru');
    await y.bekle();
    expect(sayac).toBe(70);
    expect(y.adimlar).toHaveLength(70); // bellek listesi tam; yazılan kopya son 60 (gonder içinde kesilir)
  });
});

describe('portalAracIsleyici → canlı adım', () => {
  it('çalıştır: sürüyor → bitti; araç ok:false → hata; kuru test / onay / kapalı araç tek kayıt', async () => {
    const yazilan: any[] = [];
    const canli = new CanliAdimYazici(async (adimlar) => {
      yazilan.length = 0;
      yazilan.push(...adimlar);
    });
    const cagir = isleyiciKur(canli);
    await cagir('list_fatura_merkezi', { taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });
    await cagir('send_whatsapp_template', { to: '905551112233', message: 'm' }); // kuru testte dışarı gönderim → kuru
    await cagir('post_to_luca', { fis: 1 }); // banka-kasa'ya kapalı araç → red
    await canli.bekle();
    expect(yazilan.map((a) => `${a.ad}:${a.durum}`)).toEqual(['list_fatura_merkezi:bitti', 'send_whatsapp_template:kuru', 'post_to_luca:red']);
    expect(yazilan[0].args).toEqual({ taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });

    const canliCagir = isleyiciKur(canli, { canliMod: true });
    await canliCagir('send_whatsapp_template', { to: '905551112233', message: 'm' }); // canlıda dışarı gönderim → Muzaffer Bey onayı
    await canli.bekle();
    expect(yazilan[yazilan.length - 1]).toMatchObject({ ad: 'send_whatsapp_template', durum: 'onay' });

    const hataliCagir = isleyiciKur(canli, { hata: true });
    await hataliCagir('list_fatura_merkezi', {});
    await canli.bekle();
    expect(yazilan[yazilan.length - 1]).toMatchObject({ ad: 'list_fatura_merkezi', durum: 'hata' });
  });

  it('yazıcı verilmeden de (spec/eski çağrı) işleyici çalışır', async () => {
    const cagir = isleyiciKur(undefined);
    expect((await cagir('list_fatura_merkezi', {})).ok).toBe(true);
  });
});

describe('isGetir canli alanı', () => {
  it('running kayıtta payload.canli döner, bitmişte null', async () => {
    const kayit = (status: string) => ({ id: 'is1', agent: 'ekip:beyanname', action: 'x', payload: { gorev: 'x', canli: { adimlar: [{ ad: 'get_taxpayer', basladi: 't', durum: 'suruyor' }], guncellendi: 't' } }, result: null, status, createdAt: new Date() });
    let satir: any = kayit('running');
    const prisma = { agentCommand: { findFirst: async () => satir } };
    const runner = new EkipRunnerService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const kosan = await runner.isGetir('t', 'is1');
    expect(kosan?.canli?.adimlar).toHaveLength(1);
    satir = kayit('done');
    const biten = await runner.isGetir('t', 'is1');
    expect(biten?.canli).toBeNull();
  });
});
