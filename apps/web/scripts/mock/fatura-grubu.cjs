// Fatura grubu (2. tur beyaz tema, 2026-09-21) — sayfaların çağırdığı eksik uçlar:
//   e-Arşiv (/earsiv/list), İşlenen Faturalar (/agent/mihsap/*, /agent/drive/*),
//   Fiş Yazdırma (/fis-yazdirma/outputs), Banka Takip (/banka-takip/*), Mükellef Profilleri (/agent/rules).
// Mükellef kimlikleri mock-api.cjs'teki MUKELLEFLER ile aynı (m1…m8); adlar birebir (profiller ada göre eşler).
// Bellekte tutulur; sunucu yeniden başlayınca sıfırlanır. mock-api.cjs'e DOKUNULMAZ.

const MUKELLEF = {
  m1: { id: 'm1', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6420011234' },
  m2: { id: 'm2', companyName: null, firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '14523698745' },
  m3: { id: 'm3', companyName: null, firstName: 'Ayşegül', lastName: 'Kaya', taxNumber: '25874136982' },
  m4: { id: 'm4', companyName: 'Mert Reklam Ajansı Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6170045678' },
  m5: { id: 'm5', companyName: 'Famcoffee Kahve A.Ş.', firstName: null, lastName: null, taxNumber: '3850098765' },
  m6: { id: 'm6', companyName: 'Ela Tekstil Ltd. Şti.', firstName: null, lastName: null, taxNumber: '3250076543' },
  m7: { id: 'm7', companyName: 'Balçık İnşaat A.Ş.', firstName: null, lastName: null, taxNumber: '1400032109' },
  m8: { id: 'm8', companyName: null, firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '36985214778' },
};
const ad = (m) => m.companyName || `${m.firstName} ${m.lastName}`;
const simdi = new Date();
const buAy = `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`;
const gunOnce = (n, saat = 10) => { const d = new Date(simdi.getTime() - n * 86400000); d.setHours(saat, 15, 0, 0); return d.toISOString(); };
/** Dönem içi tarih: 'YYYY-MM' + gün → ISO tarih (saat 09:00). */
const donemGunu = (donem, gun) => `${donem}-${String(gun).padStart(2, '0')}T09:00:00.000Z`;

// ── e-Arşiv / e-Fatura listesi ───────────────────────────────────────────────
const SATICILAR = [
  ['Anadolu Akaryakıt Dağıtım A.Ş.', '0710046512'], ['Delta Nakliyat ve Lojistik Ltd. Şti.', '2750012389'],
  ['Omega Hırdavat San. Tic. Ltd. Şti.', '6410098834'], ['Turkcell İletişim Hizmetleri A.Ş.', '8790012345'],
  ['Başak Kırtasiye ve Ofis Malz.', '1520067890'], ['Sancak Ecza Deposu A.Ş.', '7460033421'],
  ['Medaş Elektrik Perakende Satış A.Ş.', '6140056789'], ['Ada Yapı Malzemeleri Ltd. Şti.', '0080076543'],
  ['Ege Su Dağıtım', '3300021098'], ['Kaya İnşaat Taahhüt Ltd. Şti.', '5210087654'],
];
const ALICILAR = [
  ['Yavuz Nakliyat Ltd. Şti.', '9420418377'], ['Tuna Gıda Toptan Ltd. Şti.', '8610023456'],
  ['Irmak Danışmanlık', '4650078901'], ['Nur Eczanesi', '6310045678'], ['Safran Baharat', '7720012345'],
];
function earsivSatirlari(tip, belgeKaynak, donem, taxpayerIds) {
  const ids = taxpayerIds.length ? taxpayerIds : ['m7'];
  const rows = [];
  ids.forEach((tid, ti) => {
    const m = MUKELLEF[tid] || MUKELLEF.m7;
    const adet = tip === 'ALIS' ? 6 : 4;
    for (let i = 0; i < adet; i++) {
      const [karsi, vkn] = tip === 'ALIS' ? SATICILAR[(i + ti * 3) % SATICILAR.length] : ALICILAR[(i + ti) % ALICILAR.length];
      const matrah = Math.round((1850 + ((i * 7919 + ti * 1237) % 42000)) * 100) / 100;
      const oran = i % 4 === 0 ? 10 : 20;
      const kdv = Math.round(matrah * oran) / 100;
      const gun = 2 + ((i * 5 + ti) % 26);
      const no = `${belgeKaynak === 'EFATURA' ? 'EFT' : 'EAR'}${donem.replace('-', '')}${String(100 + i + ti * 10).padStart(6, '0')}`;
      const aktarildi = i % 3 !== 2;
      rows.push({
        id: `ea-${tid}-${tip}-${belgeKaynak}-${i}`, tip, belgeKaynak, donem, faturaNo: no, faturaTarihi: donemGunu(donem, gun),
        ettn: `b2c1${i}${ti}e0-4f1a-4c3e-9d2b-00000000${i}${ti}`,
        satici: tip === 'ALIS' ? karsi : ad(m), saticiVergiNo: tip === 'ALIS' ? vkn : m.taxNumber,
        alici: tip === 'ALIS' ? ad(m) : karsi, aliciVergiNo: tip === 'ALIS' ? m.taxNumber : vkn,
        matrah, kdvTutari: kdv, kdvOrani: oran, toplamTutar: Math.round((matrah + kdv) * 100) / 100, paraBirimi: 'TRY', durum: 'ONAYLANDI',
        taxpayerId: tid, createdAt: gunOnce(3 + i),
        accounting: aktarildi ? { id: `fm-${tid}-${i}`, status: i % 3 === 0 ? 'APPROVED' : 'READY', ocrStatus: 'DONE', lucaStatus: i % 3 === 0 ? 'POSTED' : null } : null,
        mihsapUploadStatus: i % 3 === 0 ? 'uploaded' : i === 4 ? 'failed' : null,
        mihsapUploadedAt: i % 3 === 0 ? gunOnce(2) : null,
        mihsapUploadError: i === 4 ? 'Mihsap oturumu yenilenmeli' : undefined,
      });
    }
  });
  return rows;
}

// ── MIHSAP faturaları (İşlenen Faturalar) ───────────────────────────────────
const BELGE_TURU = ['e-Fatura', 'e-Arşiv', 'e-Fatura', 'Fiş', 'e-Arşiv', 'Z Raporu'];
function mihsapFaturalari(donem, mukellefId) {
  const ids = mukellefId ? [mukellefId] : ['m1', 'm4', 'm5', 'm7'];
  const rows = [];
  ids.forEach((tid, ti) => {
    const m = MUKELLEF[tid] || MUKELLEF.m7;
    for (let i = 0; i < 7; i++) {
      const alis = i % 3 !== 1;
      const [firma, vkn] = alis ? SATICILAR[(i * 2 + ti) % SATICILAR.length] : ALICILAR[(i + ti) % ALICILAR.length];
      const tutar = Math.round((980 + ((i * 6131 + ti * 977) % 38500)) * 100) / 100;
      rows.push({
        id: `mh-${tid}-${i}`, mukellefId: m.id, donem, faturaTuru: alis ? 'ALIS_FATURASI' : 'SATIS_FATURASI', belgeTuru: BELGE_TURU[i % BELGE_TURU.length],
        faturaNo: `${alis ? 'GIB' : 'MRN'}${donem.replace('-', '')}${String(2000 + i * 13 + ti).padStart(9, '0')}`,
        firmaUnvan: firma, firmaKimlikNo: vkn, faturaTarihi: donemGunu(donem, 1 + ((i * 4 + ti) % 27)), toplamTutar: tutar,
        storageKey: i % 4 === 3 ? null : `mihsap/${tid}/${donem}/${i}.pdf`, downloadedAt: gunOnce(1 + i), orjDosyaTuru: 'pdf',
        kaynak: i % 5 === 4 ? 'fm-arsiv' : 'arsiv', mihsapFileLink: null,
      });
    }
  });
  return rows;
}

// ── Fiş Yazdırma geçmiş çıktıları ───────────────────────────────────────────
const FIS_CIKTILARI = [
  { id: 'fo1', mukellefName: ad(MUKELLEF.m5), donem: buAy, fileCount: 46, pagesPerSheet: 8, filename: 'fisler-famcoffee-eylul.docx', fileSize: 18_400_000, createdAt: gunOnce(1, 16), printStatus: 'DONE', printedAt: gunOnce(1, 17), printError: null, printDeviceId: 'ofis-pc-1' },
  { id: 'fo2', mukellefName: ad(MUKELLEF.m1), donem: buAy, fileCount: 112, pagesPerSheet: 12, filename: 'fisler-oz-ela-eylul.docx', fileSize: 41_200_000, createdAt: gunOnce(2, 11), printStatus: 'REQUESTED', printedAt: null, printError: null, printDeviceId: null },
  { id: 'fo3', mukellefName: ad(MUKELLEF.m3), donem: buAy, fileCount: 23, pagesPerSheet: 8, filename: 'fisler-aysegul-kaya-eylul.docx', fileSize: 9_800_000, createdAt: gunOnce(4, 9), printStatus: 'FAILED', printedAt: null, printError: 'Yazıcı çevrimdışı', printDeviceId: 'ofis-pc-2' },
  { id: 'fo4', mukellefName: ad(MUKELLEF.m7), donem: buAy, fileCount: 68, pagesPerSheet: 4, filename: 'fisler-balcik-insaat-eylul.docx', fileSize: 27_300_000, createdAt: gunOnce(6, 14), printStatus: null, printedAt: null, printError: null, printDeviceId: null },
];

// ── Banka Takip ─────────────────────────────────────────────────────────────
const BANKA_HESAPLARI = {
  m1: [{ bankaAdi: 'Ziraat Bankası', iban: 'TR33 0001 0002 3456 7890 1234 56', paraBirimi: 'TRY' }, { bankaAdi: 'Garanti BBVA', iban: 'TR12 0006 2000 1234 5678 9012 34', paraBirimi: 'TRY' }],
  m4: [{ bankaAdi: 'İş Bankası', iban: 'TR64 0006 4000 0011 2345 6789 01', paraBirimi: 'TRY' }],
  m5: [{ bankaAdi: 'Yapı Kredi', iban: 'TR56 0006 7010 0000 0012 3456 78', paraBirimi: 'TRY' }, { bankaAdi: 'Akbank', iban: 'TR21 0004 6000 1288 8000 1234 56', paraBirimi: 'TRY' }, { bankaAdi: 'Garanti BBVA', hesapNo: '6299-1234567', paraBirimi: 'EUR', aciklama: 'İhracat hesabı' }],
  m6: [{ bankaAdi: 'Halkbank', iban: 'TR90 0001 2009 4520 0010 2600 12', paraBirimi: 'TRY' }],
  m7: [{ bankaAdi: 'Vakıfbank', iban: 'TR77 0001 5001 5800 7300 1234 56', paraBirimi: 'TRY' }, { bankaAdi: 'QNB', iban: 'TR45 0011 1000 0000 0012 3456 78', paraBirimi: 'TRY' }],
  m8: [],
};
let hesapSira = 0;
const hesaplar = {}; // taxpayerId → BankaHesap[]
for (const [tid, liste] of Object.entries(BANKA_HESAPLARI)) {
  hesaplar[tid] = liste.map((h, i) => ({ id: `bh-${tid}-${++hesapSira}`, tenantId: 't1', taxpayerId: tid, bankaAdi: h.bankaAdi, hesapNo: h.hesapNo || null, iban: h.iban || null, sube: null, paraBirimi: h.paraBirimi || 'TRY', aciklama: h.aciklama || null, aktif: true, sira: i, createdAt: gunOnce(120), updatedAt: gunOnce(30) }));
}
// Ekstre durumu: (donem, hesapId) → { geldi, islendi, geldiTarihi, islenmeTarihi }
const ekstreDurum = new Map();
const ekstreAnahtar = (donem, hesapId) => `${donem}|${hesapId}`;
// Başlangıç durumu: m1 hepsi işlendi · m5 ikisi geldi biri işlenmedi · m7 biri geldi · m4/m6 eksik · m8 hesapsız
function ekstreBaslangic(donem) {
  const kur = (tid, i, geldi, islendi) => { const h = hesaplar[tid][i]; if (h) ekstreDurum.set(ekstreAnahtar(donem, h.id), { geldi, islendi, geldiTarihi: geldi ? gunOnce(9) : null, islenmeTarihi: islendi ? gunOnce(4) : null }); };
  kur('m1', 0, true, true); kur('m1', 1, true, true);
  kur('m5', 0, true, true); kur('m5', 1, true, false); kur('m5', 2, true, false);
  kur('m7', 0, true, false); kur('m7', 1, false, false);
}
const hazirDonemler = new Set();
function bankaListesi(donem) {
  if (!hazirDonemler.has(donem)) { hazirDonemler.add(donem); ekstreBaslangic(donem); }
  const items = Object.keys(BANKA_HESAPLARI).map((tid) => {
    const m = MUKELLEF[tid];
    const hs = (hesaplar[tid] || []).map((h) => {
      const d = ekstreDurum.get(ekstreAnahtar(donem, h.id)) || { geldi: false, islendi: false, geldiTarihi: null, islenmeTarihi: null };
      return { bankaHesap: h, ekstreGeldi: d.geldi, geldiTarihi: d.geldiTarihi, ekstreIslendi: d.islendi, islenmeTarihi: d.islenmeTarihi, islenmeNotu: null, notlar: null };
    });
    const eksikGeldi = hs.filter((x) => !x.ekstreGeldi).length;
    const eksikIslendi = hs.filter((x) => !x.ekstreIslendi).length;
    return {
      taxpayer: { id: m.id, firstName: m.firstName, lastName: m.lastName, companyName: m.companyName, taxNumber: m.taxNumber },
      hesaplar: hs, genel: null,
      ozet: { hesapSayisi: hs.length, tumGeldi: hs.length > 0 && eksikGeldi === 0, tumIslendi: hs.length > 0 && eksikIslendi === 0, eksikGeldi, eksikIslendi },
    };
  });
  return { donem, items };
}

// ── Mükellef profilleri (ajan kuralları) ────────────────────────────────────
const kdv = (taban) => ({ yuzde1: `${taban}.001`, yuzde8: '', yuzde10: `${taban}.010`, yuzde18: '', yuzde20: `${taban}.020` });
const PROFILLER = [
  { mukellef: ad(MUKELLEF.m5), faaliyet: 'kahve dükkânı / perakende', defterTuru: 'bilanco', profile: {
    sektor: 'Kahve dükkânı, perakende gıda', defterTuru: 'bilanco',
    faturaSatisMatrah: kdv('600.01'), perakendeSatisMatrah: kdv('600.02'), malAlisMatrah: kdv('153.01'), hesaplananKdv: kdv('391.01'), indirilecekKdv: kdv('191.01'),
    cariFormat: '120.01.{kod} / 320.01.{kod}', cariTakipPolitikasi: 'sadece_tanimli', cariYoksaHesap: '100.01.001', tahsilatHesabi: '102.01.001', tahsilatHesapTuru: 'banka', odemeHesabi: '100.01.001', odemeHesapTuru: 'kasa',
    surekliTedarikciler: 'ANADOLU KAHVE İTHALAT -> 320.01.004\nSÜTAŞ -> 320.01.011', tevkifataTabi: false, demirbasKontrolAktif: true,
    demirbasAnahtarKelimeler: 'espresso makinesi, öğütücü, buzdolabı, klima, demirbaş, şasi, motor no, ÖTV',
    demirbasTalimat: 'Espresso makinesi ve soğutucu alımlarını 255 hesabına aday olarak işaretle; otomatik F2 yapma.',
    ozelKararKurallari: 'Aynı gün birden fazla Z raporu varsa tek fişte birleştir.\nKurye platformu komisyon faturaları 760 hesabına gider.',
    firmaOzelTalimatlar: 'GETİR -> Komisyon faturasını 760.01.002 hesabına yaz, cari açma.',
    otomatikOnayNotlari: 'Sabit telefon ve internet faturaları 770 ile otomatik onaylanabilir.', talimat: '' } },
  { mukellef: ad(MUKELLEF.m1), faaliyet: 'gıda toptan', defterTuru: 'bilanco', profile: {
    sektor: 'Gıda toptan ticareti', defterTuru: 'bilanco',
    faturaSatisMatrah: kdv('600.01'), malAlisMatrah: kdv('153.01'), hesaplananKdv: kdv('391.01'), indirilecekKdv: kdv('191.01'),
    cariFormat: '120.{kod} / 320.{kod}', cariTakipPolitikasi: 'hepsi_cari', tahsilatHesabi: '102.01.002', tahsilatHesapTuru: 'banka', odemeHesabi: '102.01.002', odemeHesapTuru: 'banka',
    tevkifataTabi: false, demirbasKontrolAktif: true, demirbasAnahtarKelimeler: 'kamyonet, soğuk hava deposu, forklift, demirbaş, şasi, ÖTV',
    demirbasTalimat: 'Araç ve forklift alımlarında otomatik onay verme.', ozelKararKurallari: 'Nakliye faturaları 760.01.005 hesabına.', firmaOzelTalimatlar: '', otomatikOnayNotlari: '', talimat: '' } },
  { mukellef: ad(MUKELLEF.m7), faaliyet: 'inşaat taahhüt', defterTuru: 'bilanco', profile: {
    sektor: 'İnşaat taahhüt', defterTuru: 'bilanco', faturaSatisMatrah: { yuzde1: '', yuzde8: '', yuzde10: '600.01.010', yuzde18: '', yuzde20: '600.01.020' },
    malAlisMatrah: { yuzde1: '', yuzde8: '', yuzde10: '', yuzde18: '', yuzde20: '150.01.020' }, hesaplananKdv: kdv('391.01'), indirilecekKdv: kdv('191.01'),
    cariFormat: '120.01.{kod} / 320.01.{kod}', cariTakipPolitikasi: 'cari_yoksa_onay', tevkifataTabi: true, demirbasKontrolAktif: true,
    demirbasAnahtarKelimeler: 'iş makinesi, ekskavatör, kamyon, şasi, motor no, ÖTV', demirbasTalimat: 'İş makinesi alımlarını manuel incelemeye düşür.',
    ozelKararKurallari: '', firmaOzelTalimatlar: '', otomatikOnayNotlari: '', talimat: 'Hakediş faturalarında tevkifat oranını (4/10) kontrol et.' } },
  { mukellef: ad(MUKELLEF.m3), faaliyet: 'kuaför', defterTuru: 'isletme', profile: {
    sektor: 'Kuaför / güzellik salonu', defterTuru: 'isletme', perakendeSatisMatrah: { yuzde1: '', yuzde8: '', yuzde10: '600.02.010', yuzde18: '', yuzde20: '' },
    cariTakipPolitikasi: 'cari_yoksa_odeme', cariYoksaHesap: '100.01.001', tevkifataTabi: false, demirbasKontrolAktif: true,
    demirbasAnahtarKelimeler: 'koltuk, fön makinesi, klima, demirbaş', demirbasTalimat: '', ozelKararKurallari: '', firmaOzelTalimatlar: '', otomatikOnayNotlari: '', talimat: '' } },
];
const kurallar = PROFILLER.map((p, i) => ({ id: `rule-${i + 1}`, mukellef: p.mukellef, faaliyet: p.faaliyet, defterTuru: p.defterTuru, profile: p.profile, updatedAt: gunOnce(3 + i) }));

// ── Uçlar ───────────────────────────────────────────────────────────────────
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // e-Arşiv
  if (yontem === 'GET' && yol === '/earsiv/list') {
    const ids = String(q.taxpayerId || '').split(',').map((s) => s.trim()).filter(Boolean);
    const donem = q.donem || buAy;
    let rows = earsivSatirlari(q.tip === 'SATIS' ? 'SATIS' : 'ALIS', q.belgeKaynak === 'EFATURA' ? 'EFATURA' : 'EARSIV', donem, ids);
    if (q.search) { const s = String(q.search).toLocaleLowerCase('tr-TR'); rows = rows.filter((r) => [r.faturaNo, r.satici, r.alici, r.saticiVergiNo, r.aliciVergiNo].some((v) => String(v || '').toLocaleLowerCase('tr-TR').includes(s))); }
    return jsonGonder(res, 200, { rows, total: rows.length, page: 1, pageSize: Number(q.pageSize || 5000) });
  }
  if (yontem === 'POST' && yol === '/earsiv/fetch-from-luca') return jsonGonder(res, 200, { jobId: `luca-${Date.now()}`, status: 'pending' });
  if (yontem === 'GET' && yol.startsWith('/earsiv/luca-job/')) return jsonGonder(res, 200, { job: { id: yol.split('/').pop(), status: 'done', recordCount: 6, errorMsg: '' } });

  // İşlenen Faturalar (MIHSAP + Drive)
  if (yontem === 'GET' && yol === '/agent/mihsap/session') return jsonGonder(res, 200, { connected: true, email: 'muzaffer@morenmusavirlik.com', expiresAt: gunOnce(-1) });
  if (yontem === 'GET' && yol === '/agent/mihsap/invoices') return jsonGonder(res, 200, mihsapFaturalari(q.donem || buAy, q.mukellefId || ''));
  if (yontem === 'GET' && yol === '/agent/mihsap/jobs') return jsonGonder(res, 200, []);
  if (yontem === 'GET' && yol === '/agent/drive/status') return jsonGonder(res, 200, { connected: true, email: 'arsiv@morenmusavirlik.com', pendingBackupCount: 0 });
  if (yontem === 'GET' && yol === '/agent/drive/jobs') return jsonGonder(res, 200, []);
  if (yontem === 'GET' && yol === '/agent/drive/backed-up') {
    const ids = mihsapFaturalari(q.donem || buAy, q.mukellefId || '').filter((_, i) => i % 2 === 0).map((r) => r.id);
    return jsonGonder(res, 200, { ids });
  }

  // Fiş Yazdırma
  if (yontem === 'GET' && yol === '/fis-yazdirma/outputs') return jsonGonder(res, 200, FIS_CIKTILARI);
  if (yontem === 'POST' && yol === '/fis-yazdirma/scan') {
    // Çok parçalı gövde okunmaz; sabit bir tarama sonucu döner (5 okundu + 3 teyit bekliyor). Küçük parçalar SVG veri adresi.
    const kucuk = (n) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#f1f5f9"/><rect x="70" y="20" width="100" height="140" fill="#fff" stroke="#cbd5e1"/><text x="120" y="95" font-size="16" text-anchor="middle" fill="#94a3b8" font-family="Arial">FİŞ ${n}</text></svg>`)}`;
    return jsonGonder(res, 200, {
      detected: [
        { filename: 'fis-001.jpg', date: `${buAy}-02`, belge_no: '0001', cari: 'ANADOLU AKARYAKIT', toplam: '1.250,00' },
        { filename: 'fis-002.jpg', date: `${buAy}-03`, belge_no: '0087', cari: 'MİGROS', toplam: '486,90' },
        { filename: 'fis-003.jpg', date: `${buAy}-07`, belge_no: '0212', cari: 'SHELL', toplam: '2.100,00' },
        { filename: 'fis-004.jpg', date: `${buAy}-11`, belge_no: '0034', cari: 'A101', toplam: '312,45' },
        { filename: 'fis-005.jpg', date: `${buAy}-15`, belge_no: '0450', cari: 'OPET', toplam: '1.780,00' },
      ],
      unread: [
        { filename: 'fis-006.jpg', thumbnail: kucuk(6) },
        { filename: 'fis-007.jpg', thumbnail: kucuk(7) },
        { filename: 'fis-008.jpg', thumbnail: kucuk(8) },
      ],
      total: 8,
    });
  }

  // Banka Takip
  if (yontem === 'GET' && yol === '/banka-takip/list') return jsonGonder(res, 200, bankaListesi(q.donem || buAy));
  if (yontem === 'GET' && yol === '/banka-takip/hesaplar') return jsonGonder(res, 200, q.taxpayerId ? (hesaplar[q.taxpayerId] || []) : Object.values(hesaplar).flat());
  if (yontem === 'POST' && yol === '/banka-takip/hesaplar') {
    const tid = govde.taxpayerId; if (!hesaplar[tid]) hesaplar[tid] = [];
    const h = { id: `bh-${tid}-${++hesapSira}`, tenantId: 't1', taxpayerId: tid, bankaAdi: govde.bankaAdi, hesapNo: govde.hesapNo || null, iban: govde.iban || null, sube: govde.sube || null, paraBirimi: govde.paraBirimi || 'TRY', aciklama: govde.aciklama || null, aktif: true, sira: hesaplar[tid].length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    hesaplar[tid].push(h); return jsonGonder(res, 201, h);
  }
  if (yontem === 'DELETE' && yol.startsWith('/banka-takip/hesaplar/')) {
    const id = yol.split('/').pop(); for (const tid of Object.keys(hesaplar)) hesaplar[tid] = hesaplar[tid].filter((h) => h.id !== id);
    return jsonGonder(res, 200, { ok: true });
  }
  if (yontem === 'POST' && yol === '/banka-takip/ekstre') {
    const k = ekstreAnahtar(govde.donem, govde.bankaHesapId); const d = ekstreDurum.get(k) || { geldi: false, islendi: false, geldiTarihi: null, islenmeTarihi: null };
    if (typeof govde.ekstreGeldi === 'boolean') { d.geldi = govde.ekstreGeldi; d.geldiTarihi = d.geldi ? new Date().toISOString() : null; if (!d.geldi) { d.islendi = false; d.islenmeTarihi = null; } }
    if (typeof govde.ekstreIslendi === 'boolean') { d.islendi = govde.ekstreIslendi; d.islenmeTarihi = d.islendi ? new Date().toISOString() : null; }
    ekstreDurum.set(k, d); return jsonGonder(res, 200, { ok: true });
  }
  if (yontem === 'POST' && yol === '/banka-takip/eksik-ekstre-gorevleri') return jsonGonder(res, 200, { count: 3 });

  // Mükellef Profilleri
  if (yontem === 'GET' && yol === '/agent/rules') return jsonGonder(res, 200, kurallar);
  if (yontem === 'PUT' && yol.startsWith('/agent/rules/')) {
    const mukellef = decodeURIComponent(yol.slice('/agent/rules/'.length)); let k = kurallar.find((x) => x.mukellef === mukellef);
    if (!k) { k = { id: `rule-${kurallar.length + 1}`, mukellef, faaliyet: null, defterTuru: null, profile: {}, updatedAt: '' }; kurallar.push(k); }
    k.profile = govde.profile || {}; k.updatedAt = new Date().toISOString(); return jsonGonder(res, 200, k);
  }
  if (yontem === 'DELETE' && yol.startsWith('/agent/rules/')) {
    const mukellef = decodeURIComponent(yol.slice('/agent/rules/'.length)); const i = kurallar.findIndex((x) => x.mukellef === mukellef);
    if (i >= 0) kurallar.splice(i, 1); return jsonGonder(res, 200, { ok: true });
  }
  return false;
}
module.exports = { uclar };
