/**
 * SAHTE API — Ekip uçları (yalnız tarayıcı önizlemesi; mock-api.cjs bunu yükler).
 * Gerçek sözleşmenin biçimini taklit eder: /ekip/kadro · /ekip/durum · /ekip/akis · /ekip/pano · /ekip/onaylar ·
 * /ekip/isler/:id · POST /ekip/:ajan/calistir (SSE — ~14 sn süren canlı koşu taklidi, sonunda personele devir + rapor) ·
 * POST /ekip/isler/:id/iptal · POST /ekip/koordinator/sabah-ozeti · POST /ekip/onaylar/:id/onayla|reddet · POST /ekip/istek/:id/kapat.
 * Veri süreç belleğindedir.
 */
const simdi = () => new Date();
const iso = (ms) => new Date(ms).toISOString();
const dk = (n) => n * 60_000;

const AJANLAR = [
  ['koordinator', 'Koordinatör', 'Ofis Müdürü', 'sonnet', 41],
  ['fatura', 'Fatura Muhasebecisi', 'Fatura İşleme', 'opus', 32],
  ['banka-kasa', 'Banka/Kasa Sorumlusu', 'Banka ve Kasa', 'sonnet', 22],
  ['beyanname', 'Beyanname Uzmanı', 'Beyanname ve KDV', 'opus', 53],
  ['bordro-sgk', 'Bordro/SGK Sorumlusu', 'Bordro ve SGK', 'sonnet', 27],
  ['edefter', 'e-Defter Kontrolörü', 'e-Defter', 'opus', 33],
  ['luca-operator', 'Luca Operatörü', 'Luca Ekranı', 'sonnet', 25],
  ['denetci', 'Dönem Denetçisi', 'Dönem Denetimi', 'opus', 32],
  ['analist', 'Mali Analist', 'Mali Analiz', 'opus', 27],
  ['mevzuat', 'Mevzuat Takipçisi', 'Mevzuat', 'sonnet', 14],
  ['risk', 'Risk Sorumlusu', 'Risk Puanı', 'sonnet', 22],
  ['musteri', 'Müşteri İlişkileri', 'Müşteri İlişkileri', 'sonnet', 32],
].map(([id, ad, unvan, model, aracSayisi]) => ({ id, ad, unvan, model, aciklama: '', araclar: [], onayNoktalari: [], tetikler: [], kademeler: { oku: aracSayisi - 6, portal_yaz: 4, luca_yaz: 1, disari_gonder: 1 }, aracSayisi, sonKosu: null, bekleyenOnay: 0, bugunKosu: 0, suAn: null }));

const MUK = {
  omer: { id: 'm-omer', ad: 'ÖMER ÖZEN' },
  ozela: { id: 'm-ozela', ad: 'ÖZ ELA TURİZM TAŞIMACILIK İNŞAAT TİCARET LİMİTED ŞİRKETİ' },
  huseyin: { id: 'm-huseyin', ad: 'HÜSEYİN SALI' },
  zeyrek: { id: 'm-zeyrek', ad: 'ZEYREK LOJİSTİK LTD. ŞTİ.' },
};

const RAPOR_KDV = [
  'Yaptığım iş: Ömer Özen için Ağustos 2026 KDV kontrolünü Beyanname Uzmanı’na verdim; iki oturum açıldı, Luca çekimi ve Mihsap faturaları bağlandı, OCR bitti, eşleştirme yapıldı.',
  'Baktığım kaynaklar: KDV Kontrol modülü (Ağustos 2026, 191 ve 391 oturumları), Mihsap fatura listesi (163 belge), Luca gelir-gider çekimi.',
  'Bulgular:',
  '- 191 İndirilecek KDV: 118 satır — 114 tam eşleşti, 3 incele, 1 “Luca’da var, fatura yok”.',
  '- 391 Hesaplanan KDV: 41 satır — 41 tam eşleşti.',
  '- İncele satırları: PLATFORM AKARYAKIT 12.09 (fark 4,80 TL), BİM A.Ş. 21.08 (mükerrer olabilir), OPET 30.08 (tutar okunamadı).',
  'Onayınızı bekleyen: yok',
  'Sizden istenen: yok',
  'Kime döndü: Muzaffer Bey — 4 satır sizin kararınızla kapanır; oturum kilitlenmedi.',
  'Öğrendiklerim: Fatura Merkezi boş olsa da faturalar Mihsap’ta olabilir; KDV kontrolü Mihsap bağlamasıyla yürür.',
].join('\n');

const RAPOR_TEBLIGAT = [
  'Yaptığım iş: Öz Ela Turizm için e-Tebligat modülünden son 2 kaydı okudum.',
  'Baktığım kaynaklar: e-Tebligat modülü, Öz Ela Turizm, Eylül 2026.',
  'Bulgular:',
  '- 2 adet İhbarname; ikisi de 11 Eylül 2026 tebliğ tarihli, sisteme alındı.',
  '- Referanslar: 2026091113AzP0000006 ve 2026091113AzP0000004; ikisi de görüntülenmiş.',
  'Onayınızı bekleyen: yok',
  'Öğrendiklerim: yok',
].join('\n');

const t0 = simdi().getTime();
/** Bellek içi iş dosyaları (id → iş) ve vakalar. */
const ISLER = new Map();
const VAKALAR = [];

function isEkle(is) {
  ISLER.set(is.id, is);
  return is;
}

// Geçmiş: Öz Ela tebligat (bitti), Hüseyin Salı KDV kontrol canlı (bitti, personelli), Zeyrek fatura çekimi (hata), sabah özeti (bitti)
isEkle({ id: 'is-tebligat', ajanId: 'koordinator', gorev: 'Muzaffer Bey canlı ses üzerinden konuşuyor.\n\nSORU/KOMUT: Öz Ela Turizm için gelen son 2 tebligat nedir?', status: 'done', dryRun: true, taxpayerId: MUK.ozela.id, createdAt: iso(t0 - dk(95)), startedAt: iso(t0 - dk(95)), finishedAt: iso(t0 - dk(94)), kaynak: 'ses', model: 'claude-sonnet-4-6', durationMs: 23105, result: { rapor: RAPOR_TEBLIGAT, toolUses: [{ name: 'list_taxpayers', args: { search: 'Öz Ela Turizm' } }, { name: 'list_etebligat', args: { taxpayerId: MUK.ozela.id, limit: 2 } }], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: 23105 } });
VAKALAR.push({ vakaId: 'is-tebligat', mukellef: MUK.ozela, konu: 'Öz Ela Turizm için gelen son 2 tebligat nedir?', kuru: true, kimde: { ajanId: 'koordinator', ad: 'Koordinatör' }, durum: 'bitti', kutu: 'bitti', guncellendi: iso(t0 - dk(94)), olusturuldu: iso(t0 - dk(95)), gecikti: false, adimlar: [{ tip: 'is', isId: 'is-tebligat', ajanId: 'koordinator', baslik: 'Öz Ela Turizm için gelen son 2 tebligat nedir?', durum: 'done', baslangic: iso(t0 - dk(95)), bitis: iso(t0 - dk(94)), raporOzet: RAPOR_TEBLIGAT.slice(0, 300), devir: null, kuru: true }], acikKalemler: [] });

isEkle({ id: 'is-hs-kok', ajanId: 'koordinator', gorev: 'Hüseyin Salı Ağustos dönemi KDV kontrolünü yap', status: 'done', dryRun: false, taxpayerId: MUK.huseyin.id, createdAt: iso(t0 - dk(240)), startedAt: iso(t0 - dk(240)), finishedAt: iso(t0 - dk(239)), kaynak: 'portal', model: 'claude-sonnet-4-6', durationMs: 41000, result: { rapor: 'Yaptığım iş: Hüseyin Salı Ağustos 2026 KDV kontrolünü Beyanname Uzmanı’na canlı verdim.\nBaktığım kaynaklar: Mükellef modülü.\nBulgular:\n- İş Beyanname Uzmanı’nda; sonuç onun raporunda.\nOnayınızı bekleyen: yok\nÖğrendiklerim: yok', toolUses: [{ name: 'list_taxpayers', args: { search: 'Hüseyin Salı' } }, { name: 'ekip_ajan_baslat', args: { ajanId: 'beyanname', gorev: 'KDV Kontrol (R1). Mükellef: HÜSEYİN SALI. Dönem: 2026/08. Canlı.', taxpayerId: MUK.huseyin.id } }, { name: 'create_pending_action', args: { title: 'İŞ ATAMASI → beyanname: R1 HÜSEYİN SALI 2026/08 canlı', tur: 'bilgi' } }], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: 41000 } });
isEkle({ id: 'is-hs-by', ajanId: 'beyanname', gorev: 'KDV Kontrol (R1). Mükellef: HÜSEYİN SALI. Dönem: 2026/08. Canlı.', status: 'done', dryRun: false, taxpayerId: MUK.huseyin.id, createdAt: iso(t0 - dk(239)), startedAt: iso(t0 - dk(239)), finishedAt: iso(t0 - dk(236)), kaynak: 'koordinator', model: 'claude-opus-4-1', durationMs: 176000, result: { rapor: 'Yaptığım iş: Hüseyin Salı Ağustos 2026 KDV kontrolünü yaptım: iki oturum açıldı, Luca çekimi bitti, 17 Mihsap faturası bağlandı, OCR tamamlandı, eşleştirme yapıldı.\nBaktığım kaynaklar: KDV Kontrol modülü (191 + 391 oturumları), Mihsap faturaları, Luca gelir-gider listesi.\nBulgular:\n- 191: 35 satır — 34 tam, 1 incele (ULUSOY 14.08, tutar farkı 12,40 TL).\n- 391: 2 satır — 2 tam.\n- Oturumlar kilitlendi, fiş Word raporu oluşturuldu, aylık takip işaretlendi.\nOnayınızı bekleyen: yok\nÖğrendiklerim: yok', toolUses: [{ name: 'get_taxpayer', args: { taxpayerId: MUK.huseyin.id } }, { name: 'kdv_kontrol_oturum_bul_olustur', args: { taxpayerId: MUK.huseyin.id, donem: '2026/08' } }, { name: 'kdv_kontrol_luca_cek', args: { sessionId: 's1' } }, { name: 'kdv_kontrol_fatura_bagla', args: { sessionId: 's1' } }, { name: 'kdv_kontrol_ocr_baslat', args: { sessionId: 's1' } }, { name: 'luca_is_bekle', args: { jobId: 'j1', maxSaniye: 60 } }, { name: 'kdv_kontrol_ocr_bekle', args: { sessionId: 's1', maxSaniye: 60 } }, { name: 'kdv_kontrol_eslestir', args: { sessionId: 's1' } }, { name: 'kdv_kontrol_sonuc_satirlari', args: { sessionId: 's1', yalnizSorunlu: true, limit: 100 } }], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-opus-4-1', durationMs: 176000 } });
VAKALAR.push({ vakaId: 'is-hs-kok', mukellef: MUK.huseyin, konu: 'Hüseyin Salı Ağustos dönemi KDV kontrolünü yap', kuru: false, kimde: { ajanId: 'beyanname', ad: 'Beyanname Uzmanı' }, durum: 'bitti', kutu: 'bitti', guncellendi: iso(t0 - dk(236)), olusturuldu: iso(t0 - dk(240)), gecikti: false, adimlar: [
  { tip: 'is', isId: 'is-hs-kok', ajanId: 'koordinator', baslik: 'Hüseyin Salı Ağustos dönemi KDV kontrolünü yap', durum: 'done', baslangic: iso(t0 - dk(240)), bitis: iso(t0 - dk(239)), raporOzet: 'Beyanname Uzmanı’na canlı verdim.', devir: null, kuru: false },
  { tip: 'bildirim', id: 'b-hs-1', tur: 'bilgi', baslik: 'İŞ ATAMASI → beyanname: R1 HÜSEYİN SALI 2026/08 canlı', govde: null, durum: 'acik', baslangic: iso(t0 - dk(239)) },
  { tip: 'is', isId: 'is-hs-by', ajanId: 'beyanname', baslik: 'KDV Kontrol (R1) · Hüseyin Salı · 2026/08', durum: 'done', baslangic: iso(t0 - dk(239)), bitis: iso(t0 - dk(236)), raporOzet: '191: 35 satır — 34 tam, 1 incele; 391: 2 tam. Oturumlar kilitlendi.', devir: 1, kuru: false },
], acikKalemler: [] });

isEkle({ id: 'is-zeyrek', ajanId: 'koordinator', gorev: 'Zeyrek Lojistik Ağustos faturalarını entegratörden çek ve oku', status: 'failed', dryRun: true, taxpayerId: MUK.zeyrek.id, createdAt: iso(t0 - dk(400)), startedAt: iso(t0 - dk(400)), finishedAt: iso(t0 - dk(398)), kaynak: 'ses', model: 'claude-sonnet-4-6', durationMs: 60000, hata: 'iptal edildi (Muzaffer Bey)', result: { rapor: '', toolUses: [{ name: 'list_taxpayers', args: { search: 'Zeyrek' } }, { name: 'ekip_ajan_baslat', args: { ajanId: 'fatura', gorev: 'Fatura çekimi (R5). Mükellef: Zeyrek Lojistik. Dönem: 2026-08.' } }], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], hata: 'iptal edildi (Muzaffer Bey)' } });
VAKALAR.push({ vakaId: 'is-zeyrek', mukellef: MUK.zeyrek, konu: 'Zeyrek Lojistik Ağustos faturalarını entegratörden çek ve oku', kuru: true, kimde: { ajanId: 'siz', ad: 'Siz' }, durum: 'hata', kutu: 'istek', guncellendi: iso(t0 - dk(398)), olusturuldu: iso(t0 - dk(400)), gecikti: false, adimlar: [
  { tip: 'is', isId: 'is-zeyrek', ajanId: 'koordinator', baslik: 'Zeyrek Lojistik Ağustos faturalarını entegratörden çek ve oku', durum: 'failed', baslangic: iso(t0 - dk(400)), bitis: iso(t0 - dk(398)), raporOzet: null, hata: 'iptal edildi (Muzaffer Bey)', devir: null, kuru: true },
  { tip: 'bildirim', id: 'b-zeyrek-1', tur: 'istek', baslik: 'Fatura çekimi için entegratör aracı ekipte yok — çekimi Fatura Merkezi’nden başlatır mısınız?', govde: 'Zeyrek Lojistik · Ağustos 2026 · GİB e-Arşiv / entegratör çekimi', durum: 'acik', baslangic: iso(t0 - dk(399)) },
], acikKalemler: [{ tip: 'istek', id: 'b-zeyrek-1', baslik: 'Fatura çekimi için entegratör aracı ekipte yok — çekimi Fatura Merkezi’nden başlatır mısınız?', kaynak: 'bildirim', confirmationText: null }] });

isEkle({ id: 'is-sabah', ajanId: 'koordinator', gorev: 'Bugünün ofis özetini hazırla', status: 'done', dryRun: true, taxpayerId: null, createdAt: iso(t0 - dk(700)), startedAt: iso(t0 - dk(700)), finishedAt: iso(t0 - dk(697)), kaynak: 'cron', model: 'claude-sonnet-4-6', durationMs: 150000, result: { rapor: '📊 DURUM · 65 aktif mükellef; Ağustos: 8 beyanname hazır, 12 KDV kontrol eksik.\n⚠️ RİSKLİ/ACİL · 26 mükellefte evrak gelmedi; 5 banka ekstresi yok.\n📝 YAKLAŞAN SÜRELER · 26 Eylül MUHSGK, 28 Eylül KDV.\n🤖 EKİP · dün 2 KDV kontrolü bitti; onay bekleyen yok.\n▶️ BUGÜN ÖNCELİK · Ağustos KDV kontrollerini başlatın.', toolUses: [{ name: 'get_operation_briefing', args: {} }, { name: 'get_tax_calendar', args: {} }, { name: 'get_beyanname_readiness_summary', args: {} }, { name: 'get_collection_risk_summary', args: {} }, { name: 'ekip_pano', args: {} }, { name: 'ekip_isler', args: { limit: 20 } }], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: 150000 } });
VAKALAR.push({ vakaId: 'is-sabah', mukellef: null, konu: 'Bugünün ofis özetini hazırla', kuru: true, kimde: { ajanId: 'koordinator', ad: 'Koordinatör' }, durum: 'bitti', kutu: 'bitti', guncellendi: iso(t0 - dk(697)), olusturuldu: iso(t0 - dk(700)), gecikti: false, adimlar: [{ tip: 'is', isId: 'is-sabah', ajanId: 'koordinator', baslik: 'Bugünün ofis özetini hazırla', durum: 'done', baslangic: iso(t0 - dk(700)), bitis: iso(t0 - dk(697)), raporOzet: '📊 DURUM · 65 aktif mükellef…', devir: null, kuru: true }], acikKalemler: [] });

let sayac = 0;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** SSE canlı koşu taklidi: koordinatör 5 araç → personele devir → çocuk iş 6 sn sonra biter. */
async function sseKosu(res, govde) {
  const gorev = String(govde.gorev || '');
  const dryRun = govde.dryRun !== false;
  const id = `is-canli-${++sayac}`;
  const cocukId = `${id}-by`;
  const bas = simdi().getTime();
  const taxpayerId = govde.taxpayerId || MUK.omer.id;
  const muk = Object.values(MUK).find((m) => m.id === taxpayerId) || MUK.omer;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const yaz = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const kok = isEkle({ id, ajanId: 'koordinator', gorev, status: 'running', dryRun, taxpayerId, createdAt: iso(bas), startedAt: iso(bas), finishedAt: null, kaynak: 'portal', model: 'claude-sonnet-4-6', durationMs: null, result: null });
  const vaka = { vakaId: id, mukellef: muk, konu: gorev.split('\n')[0].slice(0, 90), kuru: dryRun, kimde: { ajanId: 'koordinator', ad: 'Koordinatör' }, durum: 'suruyor', kutu: 'suruyor', guncellendi: iso(bas), olusturuldu: iso(bas), gecikti: false, adimlar: [{ tip: 'is', isId: id, ajanId: 'koordinator', baslik: gorev.split('\n')[0].slice(0, 90), durum: 'running', baslangic: iso(bas), bitis: null, raporOzet: null, devir: null, kuru: dryRun }], acikKalemler: [] };
  VAKALAR.unshift(vaka);
  AJANLAR[0].suAn = { vakaId: id, isId: id, mukellefId: muk.id, mukellefAd: muk.ad, konu: vaka.konu, basladi: iso(bas) };
  yaz({ type: 'baslangic', isId: id, ajanId: 'koordinator', model: 'claude-sonnet-4-6', dryRun });
  const araclar = [
    ['list_taxpayers', { search: 'Ömer Özen', limit: 5 }, 2200],
    ['get_taxpayer', { taxpayerId: muk.id }, 1800],
    ['get_tax_calendar', { fromDate: '2026-09-14', toDate: '2026-10-14' }, 1600],
    ['ekip_ajan_baslat', { ajanId: 'beyanname', gorev: `KDV Kontrol (R1). Mükellef: ${muk.ad} (taxpayerId: ${muk.id}). Dönem: 2026/08. Bugün: 2026-09-14. İstenen: KDV kontrolü. ${dryRun ? 'Kuru test.' : 'Canlı.'}`, taxpayerId: muk.id }, 2600],
    ['create_pending_action', { title: `İŞ ATAMASI → beyanname: R1 ${muk.ad} 2026/08 ${dryRun ? 'kuru' : 'canlı'}`, tur: 'bilgi' }, 1400],
  ];
  const toolUses = [];
  for (const [name, args, sure] of araclar) {
    yaz({ type: 'tool', name, args });
    toolUses.push({ name, args });
    await bekle(sure);
    if (name === 'ekip_ajan_baslat') {
      const cb = simdi().getTime();
      isEkle({ id: cocukId, ajanId: 'beyanname', gorev: args.gorev, status: 'running', dryRun, taxpayerId: muk.id, createdAt: iso(cb), startedAt: iso(cb), finishedAt: null, kaynak: 'koordinator', model: 'claude-opus-4-1', durationMs: null, result: null });
      vaka.adimlar.push({ tip: 'is', isId: cocukId, ajanId: 'beyanname', baslik: `KDV Kontrol (R1) · ${muk.ad} · 2026/08`, durum: 'running', baslangic: iso(cb), bitis: null, raporOzet: null, devir: 1, kuru: dryRun });
      vaka.kimde = { ajanId: 'beyanname', ad: 'Beyanname Uzmanı' };
      AJANLAR[3].suAn = { vakaId: id, isId: cocukId, mukellefId: muk.id, mukellefAd: muk.ad, konu: 'KDV Kontrol (R1)', basladi: iso(cb) };
    }
    if (name === 'create_pending_action') vaka.adimlar.push({ tip: 'bildirim', id: `b-${id}`, tur: 'bilgi', baslik: args.title, govde: null, durum: 'acik', baslangic: iso(simdi().getTime()) });
  }
  const rapor = `Yaptığım iş: ${muk.ad} için Ağustos 2026 KDV kontrolünü Beyanname Uzmanı’na ${dryRun ? 'kuru testte' : 'canlı'} verdim; sonuç onun adımında.\nBaktığım kaynaklar: Mükellef modülü, vergi takvimi (28 Eylül KDV son günü).\nBulgular:\n- Beyanname Uzmanı arka planda çalışıyor; bitince raporu bu işin altında görünür.\nOnayınızı bekleyen: yok\nÖğrendiklerim: yok`;
  const bitis = simdi().getTime();
  kok.status = 'done';
  kok.finishedAt = iso(bitis);
  kok.durationMs = bitis - bas;
  kok.result = { rapor, toolUses, kuruTestYapilacaktilar: dryRun ? [{ name: 'ekip_ajan_baslat', args: { ajanId: 'beyanname' } }] : [], onayBekleyen: [], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: bitis - bas };
  vaka.adimlar[0].durum = 'done';
  vaka.adimlar[0].bitis = iso(bitis);
  vaka.adimlar[0].raporOzet = rapor.slice(0, 300);
  vaka.guncellendi = iso(bitis);
  AJANLAR[0].suAn = null;
  yaz({ type: 'done', isId: id, model: 'claude-sonnet-4-6', durationMs: bitis - bas, toolUses, kuruTestYapilacaktilar: kok.result.kuruTestYapilacaktilar, onayBekleyen: [], ogrenilen: [] });
  res.end();
  // Çocuk 16 sn sonra biter (canlı adımlar görülsün)
  setTimeout(() => {
    const c = ISLER.get(cocukId);
    if (!c || c.status !== 'running') return;
    const cbit = simdi().getTime();
    c.status = 'done';
    c.finishedAt = iso(cbit);
    c.durationMs = cbit - new Date(c.startedAt).getTime();
    c.result = { rapor: RAPOR_KDV, toolUses: [{ name: 'get_taxpayer', args: { taxpayerId: muk.id } }, { name: 'kdv_kontrol_oturum_bul_olustur', args: { taxpayerId: muk.id, donem: '2026/08' } }, { name: 'kdv_kontrol_luca_cek', args: { sessionId: 's-omer' } }, { name: 'kdv_kontrol_fatura_bagla', args: { sessionId: 's-omer' } }, { name: 'kdv_kontrol_ocr_baslat', args: { sessionId: 's-omer' } }, { name: 'luca_is_bekle', args: { jobId: 'j-omer', maxSaniye: 60 } }, { name: 'kdv_kontrol_eslestir', args: { sessionId: 's-omer' } }, { name: 'kdv_kontrol_sonuc_satirlari', args: { sessionId: 's-omer', yalnizSorunlu: true } }], kuruTestYapilacaktilar: dryRun ? [{ name: 'kdv_kontrol_luca_cek', args: { sessionId: 's-omer' } }, { name: 'kdv_kontrol_ocr_baslat', args: { sessionId: 's-omer' } }] : [], onayBekleyen: [], ogrenilen: ['Fatura Merkezi boş olsa da faturalar Mihsap’ta olabilir; KDV kontrolü Mihsap bağlamasıyla yürür.'], model: 'claude-opus-4-1', durationMs: c.durationMs };
    const adim = vaka.adimlar.find((a) => a.tip === 'is' && a.isId === cocukId);
    if (adim) { adim.durum = 'done'; adim.bitis = iso(cbit); adim.raporOzet = RAPOR_KDV.slice(0, 300); }
    vaka.kimde = { ajanId: 'siz', ad: 'Siz' };
    vaka.durum = 'bitti';
    vaka.kutu = 'istek';
    vaka.guncellendi = iso(cbit);
    vaka.adimlar.push({ tip: 'bildirim', id: `b-${cocukId}`, tur: 'istek', baslik: '4 incele satırı sizin kararınızı bekliyor (KDV Kontrol › Ömer Özen › Ağustos 2026)', govde: 'PLATFORM AKARYAKIT 12.09 · BİM 21.08 · OPET 30.08 · ULUSOY 14.08', durum: 'acik', baslangic: iso(cbit) });
    vaka.acikKalemler = [{ tip: 'istek', id: `b-${cocukId}`, baslik: '4 incele satırı sizin kararınızı bekliyor (KDV Kontrol › Ömer Özen › Ağustos 2026)', kaynak: 'bildirim', confirmationText: null }];
    AJANLAR[3].suAn = null;
  }, 16000);
}

function sayaclar() {
  const s = { suruyor: 0, onay: 0, istek: 0, bitti: 0, gecikti: 0 };
  for (const v of VAKALAR) {
    if (v.kutu === 'suruyor') s.suruyor++;
    else if (v.kutu === 'onay') s.onay++;
    else if (v.kutu === 'istek') s.istek++;
    else s.bitti++;
    if (v.gecikti) s.gecikti++;
  }
  return s;
}

/** mock-api.cjs: eşleşmezse false döner. */
function ekipUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (!yol.startsWith('/ekip')) return false;
  if (yontem === 'GET' && yol === '/ekip/kadro') return jsonGonder(res, 200, { ajanlar: AJANLAR });
  if (yontem === 'GET' && yol === '/ekip/durum') return jsonGonder(res, 200, { operator: { acik: true, cihaz: 'vps-radore-luca-operator' }, bekleyenOnay: sayaclar().onay, bugunKosu: 5, sabahOzeti: true, maxBagli: true, calisan: VAKALAR.filter((v) => v.kutu === 'suruyor').length, bugunHata: 1, sonSabahOzeti: { isId: 'is-sabah', createdAt: iso(t0 - dk(700)) }, akis: sayaclar() });
  if (yontem === 'GET' && yol === '/ekip/akis') {
    const f = q.filtre || 'tumu';
    const liste = VAKALAR.filter((v) => (f === 'tumu' ? true : v.kutu === f) && (!q.taxpayerId || v.mukellef?.id === q.taxpayerId));
    return jsonGonder(res, 200, { vakalar: liste, sayaclar: sayaclar(), pencere: { gun: Number(q.gun || 7), baslangic: iso(t0 - dk(60 * 24 * 7)) } });
  }
  if (yontem === 'GET' && yol === '/ekip/pano') {
    const muk = Object.values(MUK);
    return jsonGonder(res, 200, { donemler: [{ istenenDonem: '2026-09', beyannameDonem: '2026-08', bosDonemFallback: false, hata: null, toplam: 64, ozet: { kayitVar: 62, evrak: 60, isleme: 59, kontrol: 3, beyannameHazir: 8, beyanname: 1 }, mukellefler: muk.map((m, i) => ({ taxpayerId: m.id, ad: m.ad, tip: 'BILANCO', kayitVar: true, asamalar: { evrak: true, isleme: i !== 3, kontrol: i === 2, beyannameHazir: false, beyanname: false } })) }] });
  }
  if (yontem === 'GET' && yol === '/ekip/onaylar') return jsonGonder(res, 200, { onaylar: [] });
  const isM = /^\/ekip\/isler\/([^/]+)$/.exec(yol);
  if (yontem === 'GET' && isM) {
    const is = ISLER.get(isM[1]);
    if (!is) return jsonGonder(res, 404, { message: 'iş yok' });
    // Koşu sürerken canlı adımlar (gerçek API: payload.canli) — geçen süreye göre adım adım açılır, sonuncusu "sürüyor"
    if (is.status === 'running' && is.ajanId === 'beyanname') {
      const bas = new Date(is.startedAt).getTime();
      const gecen = simdi().getTime() - bas;
      const plan = [['get_taxpayer', { taxpayerId: is.taxpayerId }, 1200], ['kdv_kontrol_oturum_bul_olustur', { taxpayerId: is.taxpayerId, donem: '2026/08' }, 1500], ['kdv_kontrol_luca_cek', { sessionId: 's-omer' }, 2500], ['kdv_kontrol_fatura_bagla', { sessionId: 's-omer' }, 1800], ['kdv_kontrol_ocr_baslat', { sessionId: 's-omer' }, 900], ['kdv_kontrol_ocr_bekle', { sessionId: 's-omer', maxSaniye: 60 }, 9000]];
      const adimlar = [];
      let t = 0;
      for (const [ad, args, sure] of plan) {
        if (t > gecen) break;
        const bitti = t + sure <= gecen;
        adimlar.push({ ad, args, basladi: iso(bas + t), bitti: bitti ? iso(bas + t + sure) : undefined, durum: bitti ? (ad === 'kdv_kontrol_luca_cek' && is.dryRun ? 'kuru' : 'bitti') : 'suruyor' });
        t += sure;
      }
      return jsonGonder(res, 200, { ...is, canli: { adimlar, guncellendi: iso(simdi().getTime()) } });
    }
    return jsonGonder(res, 200, is);
  }
  const iptalM = /^\/ekip\/isler\/([^/]+)\/iptal$/.exec(yol);
  if (yontem === 'POST' && iptalM) {
    const is = ISLER.get(iptalM[1]);
    if (is && is.status === 'running') { is.status = 'failed'; is.hata = 'iptal edildi (Muzaffer Bey)'; }
    return jsonGonder(res, 200, { ok: !!is, isId: iptalM[1] });
  }
  const istekM = /^\/ekip\/istek\/([^/]+)\/kapat$/.exec(yol);
  if (yontem === 'POST' && istekM) {
    let bulundu = false;
    for (const v of VAKALAR) {
      const k = v.acikKalemler.find((x) => x.id === istekM[1]);
      if (k) { bulundu = true; v.acikKalemler = v.acikKalemler.filter((x) => x.id !== istekM[1]); v.kutu = 'bitti'; v.adimlar.forEach((a) => { if (a.tip === 'bildirim' && a.id === istekM[1]) a.durum = 'kapandi'; }); }
    }
    if (!bulundu) return false; // Görevler sahtesinin kendi istekleri (mock-api.cjs) devam etsin
    return jsonGonder(res, 200, { ok: true, id: istekM[1] });
  }
  if (yontem === 'POST' && yol === '/ekip/koordinator/sabah-ozeti') {
    const is = ISLER.get('is-sabah');
    return jsonGonder(res, 200, { isId: 'is-sabah', ajanId: 'koordinator', rapor: is.result.rapor, toolUses: is.result.toolUses, kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: 4000, gonderildi: govde.gonder ? 1 : 0 });
  }
  const calM = /^\/ekip\/([^/]+)\/calistir$/.exec(yol);
  if (yontem === 'POST' && calM) {
    sseKosu(res, govde).catch((e) => { console.error('[mock-ekip] sse', e); try { res.end(); } catch { /* */ } });
    return true;
  }
  return false;
}

/** /taxpayers listesine eklenecek mükellefler. */
function ekipMukellefler() {
  return Object.values(MUK).map((m) => ({ id: m.id, type: 'COMPANY', companyName: m.ad, firstName: null, lastName: null, taxNumber: '0000000000', status: 'active' }));
}

module.exports = { ekipUclari, ekipMukellefler };
