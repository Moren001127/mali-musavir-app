/**
 * POST /tasks/:id/ekibe-ver (2026-09-14) — görevi Koordinatör'e verir (runner sahte):
 *  - koşu arka planda; 'baslangic' olayından isId alınır; görev ekipIsId + IN_PROGRESS; TaskNote "Ekibe verildi …"
 *  - görev metni: başlık + açıklama + "Mükellef: <ad> (taxpayerId: <id>)"; dryRun = !canli; kaynak portal; gorevId
 *  - aynı görevde koşan/bekleyen iş varsa ikinci çağrı reddedilir, runner çağrılmaz; iş bitmişse yeniden verilebilir
 *  - runner 'error' verirse {ok:false}, görev değişmez
 * Prisma sahte; ağ yok.
 */
import { NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sahtePrisma(gorev: any, isDurumlari: Record<string, string> = {}) {
  const guncellemeler: any[] = [];
  const notlar: any[] = [];
  const durum = { gorev: { ...gorev } };
  return {
    guncellemeler,
    notlar,
    durum,
    task: {
      findFirst: async (arg: any) => (arg.where.id === durum.gorev.id && arg.where.tenantId === durum.gorev.tenantId ? { ...durum.gorev } : null),
      update: async (arg: any) => {
        guncellemeler.push(arg);
        durum.gorev = { ...durum.gorev, ...arg.data };
        return durum.gorev;
      },
    },
    taskNote: {
      create: async (arg: any) => {
        notlar.push(arg.data);
        return { id: `n${notlar.length}`, ...arg.data };
      },
    },
    agentCommand: {
      findFirst: async (arg: any) => (isDurumlari[arg.where.id] ? { id: arg.where.id, status: isDurumlari[arg.where.id] } : null),
    },
  };
}

/** Sahte runner: baslangic (isId) → kısa süre sonra done. `hata` verilirse error olayı. */
function sahteRunner(opts: { hata?: string } = {}) {
  const cagrilar: any[] = [];
  let sayac = 0;
  return {
    cagrilar,
    calistir: async (p: any) => {
      cagrilar.push(p);
      await bekle(5);
      if (opts.hata) {
        p.emit?.({ type: 'error', error: opts.hata });
        return { isId: '', ajanId: p.ajanId, rapor: '', hata: opts.hata };
      }
      const isId = `is-${++sayac}`;
      p.emit?.({ type: 'baslangic', isId, ajanId: p.ajanId, model: 'm', dryRun: p.dryRun !== false });
      await bekle(20);
      p.emit?.({ type: 'done', isId, model: 'm', toolUses: [], durationMs: 1, kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [] });
      return { isId, ajanId: p.ajanId, rapor: 'RAPOR: bitti' };
    },
  };
}

const GOREV = {
  id: 'g1',
  tenantId: 't1',
  title: 'Erdoğan Balçık 2026/08 KDV kontrolü',
  description: 'Fişler yüklendi, kontrol et.',
  taxpayerId: 'tp1',
  taxpayer: { id: 'tp1', companyName: 'ERDOĞAN BALÇIK', firstName: 'Erdoğan', lastName: 'Balçık' },
  status: 'OPEN',
  ekipIsId: null,
};

function servisKur(prisma: any, runner: any) {
  const s = new TasksService(prisma as any, runner as any);
  (s as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
  return s;
}

describe('POST /tasks/:id/ekibe-ver', () => {
  it('kuru test: Koordinatör koşusu arka planda; isId döner; görev IN_PROGRESS + ekipIsId; not düşer', async () => {
    const prisma = sahtePrisma(GOREV);
    const runner = sahteRunner();
    const s = servisKur(prisma, runner);
    const t0 = Date.now();
    const r = await s.ekibeVer('t1', 'u1', 'g1');
    expect(r).toEqual({ ok: true, isId: 'is-1' });
    expect(Date.now() - t0).toBeLessThan(2500); // done beklenmez

    expect(runner.cagrilar).toHaveLength(1);
    const p = runner.cagrilar[0];
    expect(p).toMatchObject({ ajanId: 'koordinator', tenantId: 't1', userId: 'u1', taxpayerId: 'tp1', dryRun: true, kaynak: 'portal', gorevId: 'g1' });
    expect(p.gorev).toBe('Erdoğan Balçık 2026/08 KDV kontrolü\nFişler yüklendi, kontrol et.\nMükellef: ERDOĞAN BALÇIK (taxpayerId: tp1)');

    expect(prisma.guncellemeler).toEqual([{ where: { id: 'g1' }, data: { ekipIsId: 'is-1', status: 'IN_PROGRESS' } }]);
    expect(prisma.notlar).toEqual([{ taskId: 'g1', userId: 'u1', content: 'Ekibe verildi (kuru test) — iş is-1' }]);
    await bekle(40);
  });

  it('canli:true → dryRun false, not "canlı"; mükellefsiz görevde Mükellef satırı yok', async () => {
    const prisma = sahtePrisma({ ...GOREV, id: 'g2', taxpayerId: null, taxpayer: null, description: null });
    const runner = sahteRunner();
    const s = servisKur(prisma, runner);
    const r = await s.ekibeVer('t1', 'u1', 'g2', true);
    expect(r.ok).toBe(true);
    expect(runner.cagrilar[0]).toMatchObject({ dryRun: false, taxpayerId: null, gorevId: 'g2' });
    expect(runner.cagrilar[0].gorev).toBe('Erdoğan Balçık 2026/08 KDV kontrolü');
    expect(prisma.notlar[0].content).toBe('Ekibe verildi (canlı) — iş is-1');
    await bekle(40);
  });

  it('ikinci çağrı: iş hâlâ koşuyorsa reddedilir (runner çağrılmaz); iş bitmişse yeniden verilebilir', async () => {
    const prisma = sahtePrisma({ ...GOREV, ekipIsId: 'is-eski' }, { 'is-eski': 'running' });
    const runner = sahteRunner();
    const s = servisKur(prisma, runner);
    const r = await s.ekibeVer('t1', 'u1', 'g1');
    expect(r).toEqual({ ok: false, error: 'Bu görev için ekip zaten çalışıyor' });
    expect(runner.cagrilar).toEqual([]);
    expect(prisma.guncellemeler).toEqual([]);

    const bekleyen = servisKur(sahtePrisma({ ...GOREV, ekipIsId: 'is-eski' }, { 'is-eski': 'pending' }), runner);
    expect((await bekleyen.ekibeVer('t1', 'u1', 'g1')).ok).toBe(false);
    expect(runner.cagrilar).toEqual([]);

    const bitmisPrisma = sahtePrisma({ ...GOREV, ekipIsId: 'is-eski' }, { 'is-eski': 'done' });
    const s2 = servisKur(bitmisPrisma, runner);
    const r2 = await s2.ekibeVer('t1', 'u1', 'g1');
    expect(r2).toEqual({ ok: true, isId: 'is-1' });
    expect(bitmisPrisma.durum.gorev.ekipIsId).toBe('is-1');
    await bekle(40);
  });

  it('runner error olayı → {ok:false, error}; görev ve notlar değişmez', async () => {
    const prisma = sahtePrisma(GOREV);
    const s = servisKur(prisma, sahteRunner({ hata: 'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).' }));
    const r = await s.ekibeVer('t1', 'u1', 'g1');
    expect(r).toEqual({ ok: false, error: 'Ekip başlatılamadı: Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).' });
    expect(prisma.guncellemeler).toEqual([]);
    expect(prisma.notlar).toEqual([]);
  });

  it('başka tenant / bilinmeyen görev → 404', async () => {
    const s = servisKur(sahtePrisma(GOREV), sahteRunner());
    await expect(s.ekibeVer('t2', 'u1', 'g1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.ekibeVer('t1', 'u1', 'yok')).rejects.toBeInstanceOf(NotFoundException);
  });
});
