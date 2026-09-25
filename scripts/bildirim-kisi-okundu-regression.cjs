#!/usr/bin/env node
/**
 * BILDIRIM KISI BAZLI "OKUNDU" regresyonu — portal denetimi bulgu 32b.
 *
 * SORUN: `Notification.isRead` TEK alandi. Ofis geneline (userId = null) gonderilen
 * bir bildirimi personelden biri acinca HERKES icin okundu oluyor; digerleri o
 * bildirimi hic gormuyordu. Kritik uyarilar da bu yolla kayboluyordu.
 *
 * AYRIM: `isRead` = "herkes icin kapandi" (sistemin kendiliginden kapatmasi + kisiye
 * ozel bildirimler). `notification_reads` = "su kisi okudu".
 *
 * Gercek servis sahte prisma ile cagrilir — kaynakta metin ARANMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error('  x ' + msg); } else console.log('  + ' + msg); }

const OFIS = 't1';
const AYSE = 'u-ayse';
const MEHMET = 'u-mehmet';

/**
 * Sahte prisma — bildirimler ve kisi okumalari bellekte. `reads: { none: { userId } }`
 * kosulu GERCEKTEN uygulanir, yoksa sinama hicbir sey kanitlamaz.
 */
function sahteVeri(bildirimler) {
  const okumalar = []; // { notificationId, userId }
  const uyar = (n, w) => {
    if (w.tenantId && n.tenantId !== w.tenantId) return false;
    if (w.isRead !== undefined && n.isRead !== w.isRead) return false;
    if (w.id) {
      if (typeof w.id === 'string' && n.id !== w.id) return false;
      if (w.id.in && !w.id.in.includes(n.id)) return false;
    }
    if (w.type && w.type.in && !w.type.in.includes(n.type)) return false;
    if (w.OR) {
      const gecti = w.OR.some((k) => (
        ('userId' in k) ? n.userId === k.userId : true
      ));
      if (!gecti) return false;
    }
    if (w.reads && w.reads.none) {
      const u = w.reads.none.userId;
      if (okumalar.some((o) => o.notificationId === n.id && o.userId === u)) return false;
    }
    return true;
  };
  const suz = (w) => bildirimler.filter((n) => uyar(n, w || {}));

  return {
    okumalar,
    prisma: {
      notification: {
        findMany: async (a) => suz(a.where).map((n) => {
          if (!a.include?.reads) return { ...n };
          const u = a.include.reads.where.userId;
          const r = okumalar.filter((o) => o.notificationId === n.id && o.userId === u)
            .map((o) => ({ readAt: o.readAt }));
          return { ...n, reads: r };
        }),
        findFirst: async (a) => suz(a.where)[0] || null,
        count: async (a) => suz(a.where).length,
        update: async (a) => {
          const n = bildirimler.find((x) => x.id === a.where.id);
          Object.assign(n, a.data);
          return n;
        },
        updateMany: async (a) => {
          const hedef = suz(a.where);
          for (const n of hedef) Object.assign(n, a.data);
          return { count: hedef.length };
        },
      },
      notificationRead: {
        upsert: async (a) => {
          const { notificationId, userId } = a.where.notificationId_userId;
          if (!okumalar.some((o) => o.notificationId === notificationId && o.userId === userId)) {
            okumalar.push({ notificationId, userId, readAt: new Date() });
          }
          return {};
        },
        createMany: async (a) => {
          for (const d of a.data) {
            if (!okumalar.some((o) => o.notificationId === d.notificationId && o.userId === d.userId)) {
              okumalar.push({ ...d, readAt: new Date() });
            }
          }
          return { count: a.data.length };
        },
      },
    },
  };
}

function kur(bildirimler) {
  const { NotificationsService } = require(path.join(ROOT, 'apps/api/src/notifications/notifications.service.ts'));
  const svc = Object.create(NotificationsService.prototype);
  const v = sahteVeri(bildirimler);
  svc.prisma = v.prisma;
  svc.logger = { warn() {}, log() {}, error() {} };
  return { svc, okumalar: v.okumalar };
}

(async () => {
  console.log('1) OFIS GENELI bildirim — Ayse okuyunca Mehmet HALA goruyor');
  {
    const bildirimler = [
      { id: 'n1', tenantId: OFIS, userId: null, type: 'SYSTEM', title: 'Ofis geneli', body: '-', isRead: false, readAt: null, createdAt: new Date() },
    ];
    const { svc, okumalar } = kur(bildirimler);

    ok((await svc.getUnreadCount(OFIS, AYSE)) === 1, 'baslangic: Ayse icin 1 okunmamis');
    ok((await svc.getUnreadCount(OFIS, MEHMET)) === 1, 'baslangic: Mehmet icin 1 okunmamis');

    const r = await svc.markRead('n1', OFIS, AYSE);
    ok(r.updated === 1, 'Ayse okundu isaretledi');
    ok(bildirimler[0].isRead === false, 'OFIS GENELI bildirimde isRead DEGISMEDI (kritik)');
    ok(okumalar.length === 1 && okumalar[0].userId === AYSE, 'yalniz Ayse icin okuma satiri yazildi');

    ok((await svc.getUnreadCount(OFIS, AYSE)) === 0, 'Ayse icin artik 0 okunmamis');
    ok((await svc.getUnreadCount(OFIS, MEHMET)) === 1, 'MEHMET ICIN HALA 1 — bildirim kaybolmadi');

    const listeAyse = await svc.findAll(OFIS, AYSE);
    const listeMehmet = await svc.findAll(OFIS, MEHMET);
    ok(listeAyse[0].isRead === true, 'listede Ayse icin isRead=true (etkin deger)');
    ok(listeMehmet[0].isRead === false, 'listede Mehmet icin isRead=false');
    ok(!('reads' in listeAyse[0]), 'ic alan `reads` disa sizmiyor');
  }

  console.log('');
  console.log('2) KISIYE OZEL bildirim — eski davranis (isRead) surer');
  {
    const bildirimler = [
      { id: 'n2', tenantId: OFIS, userId: AYSE, type: 'TASK_DUE', title: 'Sana ozel', body: '-', isRead: false, readAt: null, createdAt: new Date() },
    ];
    const { svc, okumalar } = kur(bildirimler);

    ok((await svc.getUnreadCount(OFIS, MEHMET)) === 0, 'Mehmet baskasinin bildirimini gormuyor');
    await svc.markRead('n2', OFIS, AYSE);
    ok(bildirimler[0].isRead === true, 'kisiye ozel bildirimde isRead=true yazildi');
    ok(okumalar.length === 1, 'okuma satiri da yazildi (sayac tek olcutten beslenir)');
    ok((await svc.getUnreadCount(OFIS, AYSE)) === 0, 'Ayse icin 0 okunmamis');
  }

  console.log('');
  console.log('3) BASKA OFIS / baskasinin bildirimi isaretlenemiyor (IDOR)');
  {
    const bildirimler = [
      { id: 'n3', tenantId: 't2', userId: null, type: 'SYSTEM', title: 'Baska ofis', body: '-', isRead: false, readAt: null, createdAt: new Date() },
      { id: 'n4', tenantId: OFIS, userId: MEHMET, type: 'SYSTEM', title: 'Mehmet e ozel', body: '-', isRead: false, readAt: null, createdAt: new Date() },
    ];
    const { svc, okumalar } = kur(bildirimler);
    ok((await svc.markRead('n3', OFIS, AYSE)).updated === 0, 'baska ofisin bildirimi isaretlenemedi');
    ok((await svc.markRead('n4', OFIS, AYSE)).updated === 0, 'baskasina ozel bildirim isaretlenemedi');
    ok(okumalar.length === 0, 'reddedilen isteklerde okuma satiri yazilmadi');
    ok(bildirimler[0].isRead === false && bildirimler[1].isRead === false, 'hicbiri okundu olmadi');
  }

  console.log('');
  console.log('4) TUMUNU OKUNDU — ofis genelinde digerleri etkilenmiyor');
  {
    const bildirimler = [
      { id: 'a1', tenantId: OFIS, userId: null, type: 'SYSTEM', title: 'Ofis 1', body: '-', isRead: false, readAt: null, createdAt: new Date() },
      { id: 'a2', tenantId: OFIS, userId: null, type: 'SYSTEM', title: 'Ofis 2', body: '-', isRead: false, readAt: null, createdAt: new Date() },
      { id: 'a3', tenantId: OFIS, userId: AYSE, type: 'TASK_DUE', title: 'Ayse ye ozel', body: '-', isRead: false, readAt: null, createdAt: new Date() },
    ];
    const { svc, okumalar } = kur(bildirimler);

    const r = await svc.markAllRead(OFIS, AYSE);
    ok(r.count === 3, 'ucu de Ayse icin okundu sayildi (' + r.count + ')');
    ok(bildirimler[0].isRead === false && bildirimler[1].isRead === false,
      'ofis geneli ikisinde isRead DEGISMEDI');
    ok(bildirimler[2].isRead === true, 'kisiye ozel olanda isRead=true');
    ok(okumalar.filter((o) => o.userId === AYSE).length === 3, 'Ayse icin uc okuma satiri');

    ok((await svc.getUnreadCount(OFIS, AYSE)) === 0, 'Ayse icin 0');
    ok((await svc.getUnreadCount(OFIS, MEHMET)) === 2, 'MEHMET ICIN HALA 2 ofis geneli bildirim');
  }

  console.log('');
  console.log('5) SISTEM KENDILIGINDEN KAPATIRSA herkes icin kapanir');
  {
    const bildirimler = [
      { id: 's1', tenantId: OFIS, userId: null, type: 'SYSTEM', title: 'Sifre hatasi', body: '-', isRead: false, readAt: null, createdAt: new Date(), metadata: { dedupeKey: 'luca-sifre:mk1' } },
    ];
    const { svc } = kur(bildirimler);
    // Durum duzeldi: isRead=true yazilir (bu yol kasitli olarak HERKES icin kapatir)
    bildirimler[0].isRead = true;
    ok((await svc.getUnreadCount(OFIS, AYSE)) === 0, 'sistem kapatinca Ayse icin 0');
    ok((await svc.getUnreadCount(OFIS, MEHMET)) === 0, 'sistem kapatinca Mehmet icin de 0');
  }

  console.log('');
  console.log('6) KRITIK OZET de ayni olcutten besleniyor');
  {
    const bildirimler = [
      { id: 'k1', tenantId: OFIS, userId: null, type: 'SYSTEM_HEALTH', title: 'Kritik', body: '-', isRead: false, readAt: null, createdAt: new Date() },
      { id: 'k2', tenantId: OFIS, userId: null, type: 'TASK_DUE', title: 'Rutin', body: '-', isRead: false, readAt: null, createdAt: new Date() },
    ];
    const { svc } = kur(bildirimler);
    const o1 = await svc.getUnreadSummary(OFIS, AYSE);
    ok(o1.total === 2, 'Ayse ozet toplam 2 (' + o1.total + ')');
    await svc.markRead('k1', OFIS, AYSE);
    const o2 = await svc.getUnreadSummary(OFIS, AYSE);
    const o3 = await svc.getUnreadSummary(OFIS, MEHMET);
    ok(o2.total === 1, 'Ayse okuduktan sonra ozet 1 (' + o2.total + ')');
    ok(o3.total === 2, 'Mehmet ozeti HALA 2 — sayac ile liste ayrismadi (' + o3.total + ')');
  }

  console.log('');
  console.log(failed === 0 ? 'GECTI: bildirim kisi bazli okundu' : 'DUSTU: ' + failed + ' kontrol');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('COKTU:', e); process.exit(1); });
