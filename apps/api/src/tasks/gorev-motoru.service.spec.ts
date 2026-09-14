/**
 * Görev motoru — tekrar üretimi + hatırlatma (sahte prisma / bildirim / e-posta; ağ yok).
 */
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('../notifications/notifications.service', () => ({ NotificationsService: class NotificationsService {} }));
jest.mock('../email/email.service', () => ({ EmailService: class EmailService {} }));
jest.mock('../whatsapp/whatsapp.service', () => ({ WhatsAppService: class WhatsAppService {} }));
import { GorevMotoruService } from './gorev-motoru.service';

const KISILER: Record<string, any> = {
  busra: { id: 'busra', firstName: 'BÜŞRA NUR', lastName: 'ÖREN', phone: '905001112233', isActive: true, email: 'info@x' },
  dilek: { id: 'dilek', firstName: 'DİLEK', lastName: 'BAYAGELDİ', phone: null, isActive: true, email: 'd@x' },
};

function sahteDb(gorevler: any[]) {
  let sayac = 0;
  const loglar: any[] = [];
  const db: any = {
    task: {
      findMany: async (q: any) => gorevler.filter((g) => {
        const w = q.where || {};
        if (w.isTemplate !== undefined && !!g.isTemplate !== !!w.isTemplate) return false;
        if (w.status?.notIn && w.status.notIn.includes(g.status)) return false;
        if (w.status?.in && !w.status.in.includes(g.status)) return false;
        if (w.dueDate?.not === null && !g.dueDate) return false;
        return true;
      }).map((g) => ({ ...g })),
      findFirst: async (q: any) => {
        const w = q.where || {};
        const adaylar = gorevler.filter((g) => g.parentTaskId === w.parentTaskId && (!w.dueDate || (new Date(g.dueDate) >= w.dueDate.gte && new Date(g.dueDate) < w.dueDate.lt)));
        if (q.orderBy?.dueDate === 'desc') adaylar.sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
        return adaylar[0] ? { ...adaylar[0] } : null;
      },
      count: async (q: any) => gorevler.filter((g) => g.parentTaskId === q.where.parentTaskId).length,
      create: async (q: any) => { const r = { id: `c${++sayac}`, ...q.data }; gorevler.push(r); return r; },
      update: async (q: any) => { const g = gorevler.find((x) => x.id === q.where.id); if (g) Object.assign(g, q.data); return g; },
    },
    taskReminderLog: {
      findMany: async (q: any) => loglar.filter((l) => l.taskId === q.where.taskId),
      create: async (q: any) => { loglar.push({ ...q.data }); return q.data; },
    },
    user: {
      findUnique: async (q: any) => KISILER[q.where.id] || { email: 'muzaffer@morenmusavirlik.com' },
      findFirst: async (q: any) => KISILER[q.where.id] || null,
    },
    tenant: { findUnique: async () => ({ email: null }) },
  };
  return { db, gorevler, loglar };
}

function kur(gorevler: any[]) {
  const { db, loglar } = sahteDb(gorevler);
  const bildirimler: any[] = [];
  const mailler: any[] = [];
  const wp: Array<{ tel: string; metin: string }> = [];
  const svc = new GorevMotoruService(
    db,
    { create: async (d: any) => { bildirimler.push(d); return { id: 'n' }; } } as any,
    { send: async (m: any) => { mailler.push(m); return { sent: true }; } } as any,
    { sendMessage: async (tel: string, metin: string) => { wp.push({ tel, metin }); return true; } } as any,
  );
  (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
  return { svc, gorevler, loglar, bildirimler, mailler, wp };
}

const T = (iso: string) => new Date(iso);

describe('GorevMotoruService — tekrar üretimi', () => {
  it('haftalık şablondan 14 gün ufkunda oluşumlar açılır; ikinci çalıştırma tekrar üretmez; nextOccurrence yazılır', async () => {
    const sablon = { id: 's1', tenantId: 't', title: 'KDV kontrolü', status: 'OPEN', isTemplate: true, createdById: 'u', dueDate: T('2026-09-01T00:00:00Z'), recurrence: { type: 'WEEKLY', weekdays: [1] }, tags: [] };
    const { svc, gorevler } = kur([sablon]);
    const simdi = T('2026-09-14T06:00:00Z'); // Pazartesi
    const n = await svc.tekrarlariUret(simdi);
    // dünden (13 Eyl) başlar → 14 Eyl ve 21 Eyl, 28 Eyl (ufuk 28 Eyl dahil)
    const olusumlar = gorevler.filter((g) => g.parentTaskId === 's1').map((g) => g.dueDate.toISOString().slice(0, 10));
    expect(olusumlar).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    expect(n).toBe(3);
    expect(gorevler.find((g) => g.id === 's1').nextOccurrence.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(await svc.tekrarlariUret(simdi)).toBe(0); // idempotent
  });

  it('iptal/bitmiş şablon ve tekrarsız şablon üretmez; geçmiş oluşumlar geriye dönük üretilmez', async () => {
    const { svc, gorevler } = kur([
      { id: 's2', tenantId: 't', title: 'x', status: 'CANCELLED', isTemplate: true, createdById: 'u', dueDate: T('2026-06-01T00:00:00Z'), recurrence: { type: 'DAILY' }, tags: [] },
      { id: 's3', tenantId: 't', title: 'aylık', status: 'OPEN', isTemplate: true, createdById: 'u', dueDate: T('2026-06-20T00:00:00Z'), recurrence: { type: 'MONTHLY', monthDay: 20 }, tags: [] },
    ]);
    await svc.tekrarlariUret(T('2026-09-14T06:00:00Z'));
    const s3 = gorevler.filter((g) => g.parentTaskId === 's3').map((g) => g.dueDate.toISOString().slice(0, 10));
    expect(s3).toEqual(['2026-09-20']); // Haziran-Ağustos üretilmedi
    expect(gorevler.some((g) => g.parentTaskId === 's2')).toBe(false);
  });
});

describe('GorevMotoruService — hatırlatma', () => {
  const gorev = (ek: any = {}) => ({ id: 'g1', tenantId: 't', createdById: 'u', title: 'Beyanname hazırla', status: 'OPEN', isTemplate: false, dueDate: T('2026-09-16T00:00:00Z'), dueTime: null, priority: 'HIGH', notifyInApp: true, notifyEmail: false, escalationLevel: 0, taxpayer: { companyName: 'Öz Ela' }, ...ek });

  it('vade günü 09:00 → tek bildirim (kanallar metadata), günlük yazılır; aynı tik tekrar göndermez', async () => {
    const { svc, bildirimler, loglar } = kur([gorev()]);
    const simdi = T('2026-09-16T06:05:00Z'); // 09:05 İstanbul
    expect(await svc.hatirlatmalariGonder(simdi)).toBe(1);
    expect(bildirimler[0]).toMatchObject({ tenantId: 't', userId: 'u', type: 'TASK_DUE', title: 'Bugün vadesi: Beyanname hazırla', body: 'Bugün · Öz Ela' });
    expect(bildirimler[0].metadata.kanallar).toEqual({ portal: true, push: true, whatsapp: false, email: false }); // WhatsApp'ı motor kendisi gönderir, owner-notifier kancası kapalı
    expect(bildirimler[0].metadata.link).toBe('/panel/gorevler?gorev=g1');
    expect(loglar[0]).toMatchObject({ taskId: 'g1', channel: 'BILDIRIM', status: 'SENT', olayAnahtari: 'VADE:2026-09-16' });
    expect(await svc.hatirlatmalariGonder(simdi)).toBe(0);
  });

  it('gece 23:00 ve sabah 08:30 tarama yapmaz; kanalların hepsi kapalıysa atlar; e-posta seçiliyse mail de gider', async () => {
    const { svc, bildirimler, mailler } = kur([gorev({ notifyEmail: true }), gorev({ id: 'g2', notifyInApp: false, notifyPush: false, notifyWhatsapp: false })]);
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T20:00:00Z'))).toBe(0); // 23:00 İstanbul
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T05:30:00Z'))).toBe(0); // 08:30 İstanbul — sessiz saat
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T06:30:00Z'))).toBe(1);
    expect(bildirimler).toHaveLength(1);
    expect(mailler).toHaveLength(1);
    expect(mailler[0].to).toEqual(['muzaffer@morenmusavirlik.com']);
  });

  it('gecikmede eskalasyon seviyesi artar; ertelenmiş (snoozedUntil ileride) görev atlanır; 36 saatten eski (bayat) olay gönderilmez, SKIPPED yazılır', async () => {
    const { svc, gorevler, loglar, bildirimler } = kur([
      gorev({ status: 'SNOOZED', snoozedUntil: T('2026-09-20T00:00:00Z') }),
      gorev({ id: 'g3', dueDate: T('2026-09-15T00:00:00Z') }), // 1 gün gecikti → 16.09 09:00 planlı, 30 dk önce → gider
      gorev({ id: 'g4', dueDate: T('2026-06-19T00:00:00Z') }), // 89 gün gecikti → son olay 24.07 → bayat, gitmez
    ]);
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T06:30:00Z'))).toBe(1);
    expect(gorevler.find((g) => g.id === 'g3').escalationLevel).toBe(1);
    expect(bildirimler.map((b) => b.title)).toEqual(['1 gün gecikti: Beyanname hazırla']);
    expect(loglar.find((l) => l.taskId === 'g4')).toMatchObject({ status: 'SKIPPED', olayAnahtari: 'GECIKME:2026-07-24' });
    expect(gorevler.find((g) => g.id === 'g4').escalationLevel).toBe(0);
    // ikinci tik: bayat olay SKIPPED sayıldığı için yeniden ele alınmaz
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T06:40:00Z'))).toBe(0);
    expect(loglar.filter((l) => l.taskId === 'g4')).toHaveLength(1);
  });
});

describe('GorevMotoruService — WhatsApp şablonu ve personel', () => {
  const gorev = (ek: any = {}) => ({ id: 'g1', tenantId: 't', createdById: 'u', title: 'Beyanname hazırla', status: 'OPEN', isTemplate: false, dueDate: T('2026-09-16T00:00:00Z'), dueTime: null, allDay: true, priority: 'HIGH', category: 'BEYANNAME', notifyInApp: true, notifyEmail: false, escalationLevel: 0, taxpayer: { companyName: 'Öz Ela' }, hatirlatUserIds: [], ...ek });

  beforeEach(() => { process.env.MOREN_OWNER_WHATSAPP_PHONES = '05350587475'; delete process.env.MOREN_OWNER_HITAP; });
  afterEach(() => { delete process.env.MOREN_OWNER_WHATSAPP_PHONES; });

  it('aynı tikte 2 görev → sahibe TEK WhatsApp mesajı (şablon: BUGÜN bölümü, hitap Muzaffer Bey, bağlantı); günlükte WHATSAPP satırı', async () => {
    const { svc, wp, loglar } = kur([gorev(), gorev({ id: 'g2', title: 'Tahsilat araması', category: 'TAHSILAT', priority: 'MEDIUM', dueTime: '14:00', allDay: false, taxpayer: { companyName: 'Famcoffee' } })]);
    // g2 saat 14:00 → VADE olayı 13:30'da; 09:05'te yalnız 'yaklaşıyor' (1 gün önce 14:00) gider
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T06:05:00Z'))).toBe(2);
    expect(wp).toHaveLength(1);
    expect(wp[0].tel).toBe('905350587475');
    expect(wp[0].metin).toContain('🗓️ *GÖREV HATIRLATMA*\nÇarşamba, 16 Eylül 2026 · 09:05');
    expect(wp[0].metin).toContain('Muzaffer Bey, günaydın.\nBugün *1 görev*, 1 yaklaşan var.');
    expect(wp[0].metin).toContain('*BUGÜN*\n① *Öz Ela* — Beyanname hazırla\n    Tüm gün · Yüksek · Beyanname');
    expect(wp[0].metin).toContain('*YAKLAŞAN*\n▸ *Famcoffee* — Tahsilat araması\n    Çarşamba 16.09 14:00 · Tahsilat');
    expect(wp[0].metin).toContain('Görevler → portal.morenmusavirlik.com/panel/gorevler\n_Elif · Moren Ofis Asistanı_');
    expect(wp[0].metin).not.toContain('OTOMATİK BİLDİRİM');
    expect(loglar.filter((l) => l.channel === 'WHATSAPP' && l.status === 'SENT')).toHaveLength(2);
  });

  it('ofis personeline de hatırlat: Büşra (telefonlu) → portal bildirimi + ayrı WhatsApp "Sayın …"; Dilek (telefonsuz) → yalnız portal bildirimi; WhatsApp kapalı görevde mesaj yok', async () => {
    const { svc, wp, bildirimler } = kur([gorev({ hatirlatUserIds: ['busra', 'dilek'] })]);
    expect(await svc.hatirlatmalariGonder(T('2026-09-16T06:05:00Z'))).toBe(1);
    expect(bildirimler.map((b) => b.userId).sort()).toEqual(['busra', 'dilek', 'u']);
    expect(wp.map((w) => w.tel).sort()).toEqual(['905001112233', '905350587475']);
    const busra = wp.find((w) => w.tel === '905001112233')!;
    expect(busra.metin).toContain('Sayın BÜŞRA NUR ÖREN, günaydın.\nBugün *1 görev* var.');

    const { svc: s2, wp: wp2, bildirimler: b2 } = kur([gorev({ notifyWhatsapp: false, hatirlatUserIds: ['busra'] })]);
    expect(await s2.hatirlatmalariGonder(T('2026-09-16T06:05:00Z'))).toBe(1);
    expect(wp2).toHaveLength(0);
    expect(b2).toHaveLength(2);
  });

  it('ornekGonder: sahibin numarasına ÖRNEK işaretli şablon; phone verilirse ona; numara yoksa hata', async () => {
    const { svc, wp } = kur([]);
    const r = await svc.ornekGonder('t', 'u');
    expect(r.ok).toBe(true);
    expect(r.telefonlar).toEqual(['905350587475']);
    expect(wp[0].metin).toContain('🗓️ *GÖREV HATIRLATMA (ÖRNEK)*');
    expect(wp[0].metin).toContain('*BUGÜN*');
    expect(wp[0].metin).toContain('*YAKLAŞAN*');
    expect(wp[0].metin).toContain('*GECİKEN*');
    expect(wp[0].metin).toContain('_Bu bir şablon denemesidir; içerik gerçek değildir._');
    const r2 = await svc.ornekGonder('t', 'u', { phone: '0500 111 22 33' });
    expect(r2.telefonlar).toEqual(['905001112233']);
    delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    const r3 = await svc.ornekGonder('t', 'u');
    expect(r3.ok).toBe(false);
  });
});
