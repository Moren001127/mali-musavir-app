#!/usr/bin/env node
/**
 * BELGE LISTESI SAYFALAMA + GERCEK SAYAC regresyonu — portal denetimi bulgu 35b.
 *
 * SORUN: `/documents` ucu ilk 100 satiri donuyordu; ekran SUZMEYI ve SAYACLARI o 100
 * satir uzerinde yapiyordu. CANLI OLCUM (25 Eylul 2026): silinmemis belge sayisi
 * 90.215 — yani "Toplam Evrak: 100" yaziliyordu (900 kat yanlis) ve 101. belge
 * hicbir sekilde gorunmuyordu.
 *
 * SOZLESME (docs/sayfalama-sozlesme-2026-09-14.md §4): `page` verilirse
 * `{ rows, total, page, pageSize }`, verilmezse ESKI dizi yaniti aynen.
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

/** 250 belge: 100 FATURA, 80 SOZLESME, 70 DIGER */
function belgeler() {
  const out = [];
  for (let i = 0; i < 250; i++) {
    const category = i < 100 ? 'FATURA' : i < 180 ? 'SOZLESME' : 'DIGER';
    out.push({
      id: 'd' + i,
      title: 'Belge ' + i + (i === 137 ? ' KIRA' : ''),
      category,
      sizeBytes: 1000 + i,
      isDeleted: false,
      createdAt: new Date(2026, 8, 1 + (i % 25)),
      updatedAt: new Date(2026, 8, 1 + (i % 25)),
      taxpayer: { id: 'mk' + (i % 3), tenantId: OFIS, companyName: i % 3 === 0 ? 'AYTEKIN A.S.' : 'DIGER LTD', firstName: null, lastName: null },
    });
  }
  return out;
}

function kur(satirlar) {
  const { DocumentsService } = require(path.join(ROOT, 'apps/api/src/documents/documents.service.ts'));
  const svc = Object.create(DocumentsService.prototype);

  const uyar = (d, w) => {
    if (w.isDeleted !== undefined && d.isDeleted !== w.isDeleted) return false;
    if (w.taxpayer && w.taxpayer.tenantId && d.taxpayer.tenantId !== w.taxpayer.tenantId) return false;
    if (w.taxpayerId && d.taxpayer.id !== w.taxpayerId) return false;
    if (typeof w.category === 'string' && d.category !== w.category) return false;
    if (w.category && w.category.in && !w.category.in.includes(d.category)) return false;
    if (w.createdAt && w.createdAt.gte && d.createdAt < w.createdAt.gte) return false;
    if (w.OR) {
      const gecti = w.OR.some((k) => {
        if (k.title?.contains) return String(d.title).toLowerCase().includes(String(k.title.contains).toLowerCase());
        if (k.taxpayer?.companyName?.contains) return String(d.taxpayer.companyName || '').toLowerCase().includes(String(k.taxpayer.companyName.contains).toLowerCase());
        if (k.taxpayer?.firstName?.contains) return String(d.taxpayer.firstName || '').toLowerCase().includes(String(k.taxpayer.firstName.contains).toLowerCase());
        if (k.taxpayer?.lastName?.contains) return String(d.taxpayer.lastName || '').toLowerCase().includes(String(k.taxpayer.lastName.contains).toLowerCase());
        return false;
      });
      if (!gecti) return false;
    }
    return true;
  };
  const suz = (w) => satirlar.filter((d) => uyar(d, w || {}));

  svc.prisma = {
    document: {
      findMany: async (a) => {
        let r = suz(a.where);
        r = r.slice(a.skip || 0);
        if (a.take) r = r.slice(0, a.take);
        return r;
      },
      count: async (a) => suz(a.where).length,
      aggregate: async (a) => ({ _sum: { sizeBytes: suz(a.where).reduce((t, d) => t + d.sizeBytes, 0) } }),
      groupBy: async (a) => {
        const m = new Map();
        for (const d of suz(a.where)) m.set(d.category, (m.get(d.category) || 0) + 1);
        return [...m].map(([category, c]) => ({ category, _count: { _all: c } }));
      },
    },
  };
  return svc;
}

(async () => {
  const satirlar = belgeler();

  console.log('1) SAYFA VERILMEZSE eski dizi yaniti (sozlesme §4)');
  {
    const svc = kur(satirlar);
    const r = await svc.findAll(OFIS);
    ok(Array.isArray(r), 'dizi dondu (eski ekranlar kirilmaz)');
    ok(r.length === 100, 'eski davranis: ilk 100 satir (' + r.length + ')');
  }

  console.log('');
  console.log('2) SAYFA VERILIRSE { rows, total, page, pageSize }');
  {
    const svc = kur(satirlar);
    const s1 = await svc.findAll(OFIS, undefined, undefined, { page: 1, pageSize: 25 });
    ok(!Array.isArray(s1) && Array.isArray(s1.rows), 'nesne dondu, rows dizi');
    ok(s1.total === 250, 'total GERCEK toplam: ' + s1.total + ' (100 degil)');
    ok(s1.rows.length === 25, 'ilk sayfada 25 satir (' + s1.rows.length + ')');
    ok(s1.page === 1 && s1.pageSize === 25, 'page/pageSize donuyor');

    // 101. BELGE ERISILEBILIR MI — bulgunun ozu
    const s5 = await svc.findAll(OFIS, undefined, undefined, { page: 5, pageSize: 25 });
    ok(s5.rows.length === 25, '5. sayfa dolu (101-125. satirlar)');
    ok(s5.rows[0].id === 'd100', '101. BELGE ERISILEBILIR: ' + s5.rows[0].id);

    const son = await svc.findAll(OFIS, undefined, undefined, { page: 10, pageSize: 25 });
    ok(son.rows.length === 25 && son.rows[24].id === 'd249', 'son sayfada 250. belge var');

    const asiri = await svc.findAll(OFIS, undefined, undefined, { page: 99, pageSize: 25 });
    ok(asiri.rows.length === 0 && asiri.total === 250, 'var olmayan sayfa bos doner, total korunur');
  }

  console.log('');
  console.log('3) SAYFA BOYUTU normalize (25/50/100 disi -> 50)');
  {
    const svc = kur(satirlar);
    ok((await svc.findAll(OFIS, undefined, undefined, { page: 1, pageSize: 7 })).pageSize === 50, 'pageSize 7 -> 50');
    ok((await svc.findAll(OFIS, undefined, undefined, { page: 1, pageSize: 100 })).pageSize === 100, 'pageSize 100 aynen');
    ok((await svc.findAll(OFIS, undefined, undefined, { page: 0 })).page === 1, 'page 0 -> 1');
    ok((await svc.findAll(OFIS, undefined, undefined, { page: 'abc' })).page === 1, 'page "abc" -> 1');
  }

  console.log('');
  console.log('4) SUZME SUNUCUDA — tum veri uzerinde, elindeki sayfada degil');
  {
    const svc = kur(satirlar);
    const f = await svc.findAll(OFIS, 'FATURA', undefined, { page: 1, pageSize: 25 });
    ok(f.total === 100, 'FATURA suzgeci total 100 (' + f.total + ')');
    ok(f.rows.every((d) => d.category === 'FATURA'), 'yalniz FATURA satirlari');

    const coklu = await svc.findAll(OFIS, 'FATURA,DIGER', undefined, { page: 1, pageSize: 25 });
    ok(coklu.total === 170, 'coklu kategori (FATURA+DIGER) total 170 (' + coklu.total + ')');

    const uydurma = await svc.findAll(OFIS, 'TEBLIGAT', undefined, { page: 1, pageSize: 25 });
    ok(uydurma.total === 250, 'taninmayan kategori SESSIZCE yok sayiliyor, bos liste uretmiyor (' + uydurma.total + ')');

    // ARAMA: baslik 100. satirin OTESINDE — eski kodda asla bulunamazdi
    const ara = await svc.findAll(OFIS, undefined, 'KIRA', { page: 1, pageSize: 25 });
    ok(ara.total === 1 && ara.rows[0]?.id === 'd137',
      'BASLIKTA arama 100. satirin otesini de buluyor: ' + (ara.rows[0]?.id || 'bulunamadi'));

    const mk = await svc.findAll(OFIS, undefined, 'aytekin', { page: 1, pageSize: 25 });
    ok(mk.total > 0, 'mukellef unvaninda arama calisiyor (' + mk.total + ' sonuc)');
  }

  console.log('');
  console.log('5) OZET — sayaclar VERITABANINDAN');
  {
    const svc = kur(satirlar);
    const o = await svc.ozet(OFIS);
    ok(o.toplam === 250, 'toplam 250 (' + o.toplam + ')');
    const beklenenBoyut = satirlar.reduce((t, d) => t + d.sizeBytes, 0);
    ok(o.toplamBoyut === beklenenBoyut, 'toplam boyut tum satirlardan: ' + o.toplamBoyut);
    ok(o.kategoriDagilimi.FATURA === 100 && o.kategoriDagilimi.SOZLESME === 80 && o.kategoriDagilimi.DIGER === 70,
      'kategori dagilimi dogru: ' + JSON.stringify(o.kategoriDagilimi));

    // Suzgec verilince sayaclar da suzuluyor -> liste ile AYRISMIYOR
    const of = await svc.ozet(OFIS, { category: 'FATURA' });
    ok(of.toplam === 100, 'suzgecli ozet 100 (' + of.toplam + ')');
    const lf = await svc.findAll(OFIS, 'FATURA', undefined, { page: 1, pageSize: 25 });
    ok(of.toplam === lf.total, 'ozet ile liste total AYNI (sayac-liste ayrismasi yok)');
  }

  console.log('');
  console.log('6) SILINMIS belge ve BASKA OFIS disarida');
  {
    const karisik = belgeler();
    karisik.push({ id: 'sil1', title: 'Silinmis', category: 'FATURA', sizeBytes: 999, isDeleted: true, createdAt: new Date(), updatedAt: new Date(), taxpayer: { id: 'mk0', tenantId: OFIS, companyName: 'X', firstName: null, lastName: null } });
    karisik.push({ id: 'bo1', title: 'Baska ofis', category: 'FATURA', sizeBytes: 999, isDeleted: false, createdAt: new Date(), updatedAt: new Date(), taxpayer: { id: 'mkX', tenantId: 't2', companyName: 'Y', firstName: null, lastName: null } });
    const svc = kur(karisik);
    const o = await svc.ozet(OFIS);
    ok(o.toplam === 250, 'silinmis + baska ofis sayilmadi (' + o.toplam + ')');
    const l = await svc.findAll(OFIS, undefined, undefined, { page: 1, pageSize: 100 });
    ok(!l.rows.some((d) => d.id === 'sil1' || d.id === 'bo1'), 'listede de yok');
  }

  console.log('');
  console.log('7) GOREV/NOT listesi SESSIZCE kirpmiyor');
  {
    const { TasksService } = require(path.join(ROOT, 'apps/api/src/tasks/tasks.service.ts'));
    ok(TasksService.GOREV_TAVANI === 500 && TasksService.NOT_TAVANI === 200,
      'tavanlar sabit olarak disa aciliyor (' + TasksService.GOREV_TAVANI + '/' + TasksService.NOT_TAVANI + ')');

    // GERCEK `ajanda()` metodu sahte prisma ile cagrilir.
    const ajandaCalistir = async (gorevSayisi, notSayisi) => {
      const svc = Object.create(TasksService.prototype);
      const uret = (n, tur) => Array.from({ length: n }, (_, i) => ({
        id: tur + i, tur, status: 'OPEN', pinned: false, dueDate: null,
        priority: 'NORMAL', createdAt: new Date(), updatedAt: new Date(), _count: { notes: 0 },
      }));
      // `db` bir getter (prisma'yi dondurur) — sahteyi prisma'ya koyariz.
      svc.prisma = {
        task: {
          findMany: async (a) => {
            if (a.where?.taxCalendarId) return [];
            // `take` gercekten uygulanir, yoksa kirpma bayragi hicbir sey kanitlamaz.
            const tur = a.where?.tur;
            const hepsi = tur === 'GOREV' ? uret(gorevSayisi, 'GOREV') : uret(notSayisi, 'NOT');
            return a.take ? hepsi.slice(0, a.take) : hepsi;
          },
        },
        taxCalendar: { findMany: async () => [] },
      };
      svc.acikEkipIstekleri = async () => [];
      svc.aramaKosulu = () => [];
      svc.ajandaSayaclari = async () => ({ bugun: 0, gecikmis: 0, buHafta: 0, acik: 0, not: 0 });
      svc.turSec = () => null;
      svc.kaynakSec = () => null;
      return svc.ajanda(OFIS, {});
    };

    const dolu = await ajandaCalistir(900, 400);
    ok(dolu.kirpildi?.gorev === true, 'tavan dolunca kirpildi.gorev=true');
    ok(dolu.kirpildi?.not === true, 'tavan dolunca kirpildi.not=true');
    ok(dolu.gorevler.length === 500, 'liste gercekten 500e kirpildi (' + dolu.gorevler.length + ')');
    ok(dolu.kirpildi?.gorevTavan === 500, 'tavan degeri yanitta: ' + dolu.kirpildi?.gorevTavan);

    const canli = await ajandaCalistir(19, 5);
    ok(canli.kirpildi?.gorev === false && canli.kirpildi?.not === false,
      'canli durum (19 gorev / 5 not) kirpildi=false — yanlis uyari vermiyor');
  }

  console.log('');
  console.log('8) SOHBET daha eskisi oldugunu SOYLUYOR');
  {
    const { OfficeChatService } = require(path.join(ROOT, 'apps/api/src/office-chat/office-chat.service.ts'));
    const svc = Object.create(OfficeChatService.prototype);
    svc.threadSummary = async () => ({ id: 'th1', title: 'Genel' });
    svc.publicMessage = (m) => m;

    const mesajlar = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, createdAt: new Date(2026, 8, 1, 0, i) }));

    const dolu = await svc.threadDetail({ messages: mesajlar(80) }, 'u1', 80);
    ok(dolu.dahaEskisiVar === true, 'tavan dolunca dahaEskisiVar=true');
    ok(dolu.mesajTavani === 80, 'tavan yaniti iciyor: ' + dolu.mesajTavani);

    const az = await svc.threadDetail({ messages: mesajlar(4) }, 'u1', 80);
    ok(az.dahaEskisiVar === false, 'canli durum (4 mesaj) dahaEskisiVar=false — yanlis uyari yok');
    ok(az.messages.length === 4, 'mesajlar aynen donuyor (' + az.messages.length + ')');
    ok(new Date(az.messages[0].createdAt) <= new Date(az.messages[3].createdAt), 'mesajlar eskiden yeniye sirali');
  }

  console.log('');
  console.log(failed === 0 ? 'GECTI: belge sayfalama + gercek sayac' : 'DUSTU: ' + failed + ' kontrol');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('COKTU:', e); process.exit(1); });
