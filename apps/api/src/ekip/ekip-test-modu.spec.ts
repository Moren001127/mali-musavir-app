/**
 * TEST MODU (kaynak='test', 2026-09-13 — Muzaffer Bey: "kafana göre iş uydurma"):
 * geliştirici pilot koşuları Muzaffer Bey'in ekranına/telefonuna HİÇ düşmez.
 *  - portalAracIsleyici: okuma araçları çalışır; portala yazan / dışarı gönderen her araç "kuruTest" cevabıyla KESİLİR
 *    (create_pending_action → bildirim yok, send_* → onay kaydı yok).
 *  - ekipAgentAdi: iş dosyası 'ekiptest:' önekiyle açılır → 'ekip:' süzgeçleri (akış, pano, sabah özeti) görmez.
 * Prisma/araçlar sahte; ağ/DB/Agent SDK yok.
 */
import { EkipRunnerService, ekipAgentAdi } from './ekip-runner.service';
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
