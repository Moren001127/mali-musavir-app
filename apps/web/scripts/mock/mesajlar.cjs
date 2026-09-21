// WhatsApp Mesajlar (/panel/mesajlar) sahte uçları — mock-api.cjs eklentisi.
// Sayfanın çağırdığı uçlar: /whatsapp/conversations, /whatsapp/conversations/:id, /whatsapp/conversations/:id/reply,
// /whatsapp/conversations/start, /whatsapp/conversations/:id/link, /whatsapp/conversations/:id/media/upload,
// DELETE /whatsapp/conversations/:id, /whatsapp/contacts, /integrations/whatsapp/qr/status, /documents/:id/download.
// Veri süreç belleğindedir (gönderilen mesaj sohbete eklenir); sunucu yeniden başlayınca sıfırlanır.

const simdi = () => new Date();
/** Bugünden `gun` gün önce, saat:dakika (yerel). */
function z(gun, saat, dakika = 0) {
  const d = simdi();
  d.setDate(d.getDate() - gun);
  d.setHours(saat, dakika, 0, 0);
  return d.toISOString();
}
const kimlik = (taxpayerId, tel) => `${taxpayerId}__wa__${tel}`;

// ── Rehber (mükellef kartları) ────────────────────────────────────────────────
const MUKELLEFLER = [
  { id: 'm1',  ad: 'Yavuz Nakliyat Ltd. Şti.',            vkn: '9420418377', tel: '905321447212', kisi: 'Yavuz Bey' },
  { id: 'm2',  ad: 'Famcoffee Kahve Sanayi A.Ş.',         vkn: '3851029344', tel: '905436621908', kisi: null },
  { id: 'm3',  ad: 'Aytekin Hırdavat',                    vkn: '1290334521', tel: '905057734410', kisi: 'Aytekin Usta' },
  { id: 'm4',  ad: 'Ayşegül Demir – Kuaför',              vkn: '27713408822', tel: '905338101276', kisi: 'Ayşegül Hanım' },
  { id: 'm5',  ad: 'Mert Reklam ve Tanıtım',               vkn: '6120988341', tel: '905417709081', kisi: null },
  { id: 'm6',  ad: 'Erdem Otomotiv Yedek Parça',           vkn: '3388120067', tel: '905322298711', kisi: 'Erdem Bey' },
  { id: 'm7',  ad: 'Delta Nakliyat ve Lojistik',           vkn: '2760944118', tel: '905301188342', kisi: null },
  { id: 'm8',  ad: 'Omega Hırdavat San. Tic.',             vkn: '6440183925', tel: '905449902517', kisi: null },
  { id: 'm9',  ad: 'Nur Eczanesi',                         vkn: '19822046690', tel: '905386612704', kisi: 'Nur Hanım' },
  { id: 'm10', ad: 'Sakarya Süt Ürünleri Koop.',           vkn: '7301622458', tel: '905324471150', kisi: null },
  { id: 'm11', ad: 'Ömer Özen – Serbest Meslek',           vkn: '35044120384', tel: '905337761922', kisi: 'Ömer Özen' },
  { id: 'm12', ad: 'Karadeniz Balıkçılık Ltd.',            vkn: '5218830471', tel: '905413390216', kisi: null },
  { id: 'm13', ad: 'Berrak Temizlik Hizmetleri',           vkn: '1677204983', tel: '905356628847', kisi: 'Berrak Hanım' },
  { id: 'm14', ad: 'Güneş Mobilya Dekorasyon',             vkn: '4093361270', tel: '905428804193', kisi: null },
  { id: 'm15', ad: 'Ada Yapı Malzemeleri',                 vkn: '8813025764', tel: '905309917482', kisi: null },
  { id: 'm16', ad: 'Pınar Kırtasiye',                      vkn: '2984417506', tel: null,           kisi: null },
  // Kayıtsız numara (rehberde yok) — "Mükellefe Bağla" akışı için
  { id: 'wa-905551234567', ad: 'WhatsApp 905551234567', vkn: 'WHATSAPP-905551234567', tel: '905551234567', kisi: null, kayitsiz: true },
];
const mk = (id) => MUKELLEFLER.find((m) => m.id === id);

// ── Sohbetler (mesajlar eskiden yeniye) ───────────────────────────────────────
const SOHBETLER = new Map();
function sohbet(id, tel, mesajlar) { SOHBETLER.set(kimlik(id, tel), mesajlar); }

// Dolu sohbet: 3 güne yayılan 18 mesaj (gelen / giden / bot / otomatik / belge / hatalı)
sohbet('m1', '905321447212', [
  { id: 'y1',  direction: 'outgoing', subject: 'Evrak hatırlatma — 2026/08 — Gönderildi', content: 'Merhaba Yavuz Bey, Ağustos 2026 dönemi için henüz ulaşmayan alış-satış faturalarınızı ve banka ekstrelerinizi en geç 10 Eylül\'e kadar iletmenizi rica ederiz. İyi çalışmalar.', occurredAt: z(2, 9, 0), deliveryStatus: 'read', deliveryAt: z(2, 9, 4) },
  { id: 'y2',  direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Günaydın, faturaları bugün toplayıp göndereceğim. Banka ekstresini de ekleyeyim mi?', occurredAt: z(2, 9, 41) },
  { id: 'y3',  direction: 'outgoing', subject: 'WhatsApp bot cevabı (MOREN AI)', content: 'Merhaba Yavuz Bey, evet lütfen banka ekstresini de ekleyin. Ağustos ayına ait tüm hesapların ekstreleri (Ziraat ve Garanti) gerekiyor. Belgeleri bu hattan gönderebilirsiniz.', occurredAt: z(2, 9, 42), deliveryStatus: 'read', deliveryAt: z(2, 9, 50) },
  { id: 'y4',  direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Tamamdır, öğleden sonra atarım.', occurredAt: z(2, 9, 55) },
  { id: 'y5',  direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Ağustos alış faturaları ektedir.', occurredAt: z(2, 15, 12), documents: [{ id: 'd1', title: 'Agustos-2026-alis-faturalari.pdf', mimeType: 'application/pdf', sizeBytes: 482113, url: null }] },
  { id: 'y6',  direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Ziraat ekstresi', occurredAt: z(2, 15, 14), documents: [{ id: 'd2', title: 'Ziraat-ekstre-2026-08.pdf', mimeType: 'application/pdf', sizeBytes: 211045, url: null }] },
  { id: 'y7',  direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Teşekkürler Yavuz Bey, belgeler ulaştı. Garanti ekstresi de gelince işlemeye başlıyoruz.', occurredAt: z(2, 15, 30), deliveryStatus: 'read', deliveryAt: z(2, 15, 31) },
  { id: 'y8',  direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Garanti\'ninkini yarın bankadan alıp göndereceğim, internet şubesi açılmıyor.', occurredAt: z(1, 10, 5) },
  { id: 'y9',  direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Olur, bekliyoruz. İsterseniz şube yerine mobil uygulamadan PDF olarak da alabilirsiniz: Hesaplar › Hesap Hareketleri › Paylaş.', occurredAt: z(1, 10, 12), deliveryStatus: 'read', deliveryAt: z(1, 10, 20) },
  { id: 'y10', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Buldum, gönderiyorum 👍', occurredAt: z(1, 11, 47) },
  { id: 'y11', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Garanti ekstresi', occurredAt: z(1, 11, 48), documents: [{ id: 'd3', title: 'Garanti-ekstre-2026-08.pdf', mimeType: 'application/pdf', sizeBytes: 168220, url: null }] },
  { id: 'y12', direction: 'outgoing', subject: 'Tahsilat hatırlatma - 2026-09 - Gönderildi', content: 'Sayın Yavuz Nakliyat Ltd. Şti., Eylül 2026 dönemi muhasebe ücretiniz (4.500 TL) için ödeme bilgilerini hatırlatırız. Ödeme yaptıysanız bu mesajı dikkate almayınız.', occurredAt: z(1, 14, 0), deliveryStatus: 'delivered', deliveryAt: z(1, 14, 1) },
  { id: 'y13', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Ödemeyi dün havale ettim, dekontu atayım mı?', occurredAt: z(1, 14, 22) },
  { id: 'y14', direction: 'outgoing', subject: 'WhatsApp bot cevabı (MOREN AI)', content: 'Teşekkür ederiz Yavuz Bey, dekont göndermenize gerek yok; hesap hareketlerinden kontrol edip kaydınıza işleyeceğiz.', occurredAt: z(1, 14, 23), deliveryStatus: 'read', deliveryAt: z(1, 14, 30) },
  { id: 'y15', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Yavuz Bey, Ağustos KDV kontrolünüz tamamlandı. Beyanname yarın verilecek; ödenecek KDV 12.480,50 TL. Tahakkuk fişini beyandan sonra göndereceğiz.', occurredAt: z(0, 9, 15), deliveryStatus: 'read', deliveryAt: z(0, 9, 18) },
  { id: 'y16', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Teşekkürler. Son ödeme tarihi neydi?', occurredAt: z(0, 9, 31) },
  { id: 'y17', direction: 'outgoing', subject: 'Portal WhatsApp mesajı (gonderilemedi)', content: 'KDV son ödeme günü 28 Eylül. Tahakkuk fişiyle birlikte ödeme cetvelini de ileteceğiz.', occurredAt: z(0, 9, 33), failed: true, deliveryStatus: 'failed' },
  { id: 'y18', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'KDV son ödeme günü 28 Eylül. Tahakkuk fişiyle birlikte ödeme cetvelini de ileteceğiz.', occurredAt: z(0, 9, 34), deliveryStatus: 'sent' },
]);
sohbet('m2', '905436621908', [
  { id: 'f1', direction: 'outgoing', subject: 'Evrak hatırlatma — 2026/08 — Gönderildi', content: 'Merhaba, Ağustos 2026 dönemi evraklarınızı bekliyoruz.', occurredAt: z(3, 9, 0), deliveryStatus: 'read' },
  { id: 'f2', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'e-Arşiv faturalarını sistemden çekebiliyor musunuz, ayrıca göndermeme gerek var mı?', occurredAt: z(0, 8, 12) },
  { id: 'f3', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Bir de POS raporunu ekliyorum.', occurredAt: z(0, 8, 13), documents: [{ id: 'd4', title: 'POS-rapor-agustos.pdf', mimeType: 'application/pdf', sizeBytes: 90211, url: null }] },
]);
sohbet('m3', '905057734410', [
  { id: 'a1', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Fatura fotoğrafları', occurredAt: z(0, 7, 58), documents: [{ id: 'd5', title: 'IMG_4471.jpg', mimeType: 'image/jpeg', sizeBytes: 1_200_000, url: null }] },
  { id: 'a2', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Bu ay 7 alış var, Luca\'ya girildi mi?', occurredAt: z(0, 7, 59) },
]);
sohbet('m4', '905338101276', [
  { id: 'k1', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Ayşegül Hanım, işletme defteri için Ağustos gider fişlerini bekliyoruz.', occurredAt: z(1, 16, 20), deliveryStatus: 'read' },
  { id: 'k2', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Yarın dükkâna uğrayıp bırakacağım 🙏', occurredAt: z(0, 6, 40) },
]);
sohbet('m5', '905417709081', [
  { id: 'r1', direction: 'outgoing', subject: 'Hesap Dökümü (ekstre PDF) — 01.01.2026 / 14.09.2026 Hesap Dökümü', content: 'Cari hesap ekstreniz ektedir.', occurredAt: z(1, 17, 5), deliveryStatus: 'delivered', documents: [{ id: 'd6', title: 'Mert-Reklam-cari-ekstre.pdf', mimeType: 'application/pdf', sizeBytes: 74001, url: null }] },
]);
sohbet('m6', '905322298711', [
  { id: 'e1', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'SGK bildirgesi verildi mi? Bankadan ödeme talimatı sordular.', occurredAt: z(1, 13, 10) },
  { id: 'e2', direction: 'outgoing', subject: 'WhatsApp bot cevabı (MOREN AI)', content: 'Merhaba Erdem Bey, Ağustos SGK bildirgeniz 19 Eylül\'de verildi; tahakkuk tutarı 8.340,12 TL, son ödeme 30 Eylül.', occurredAt: z(1, 13, 11), deliveryStatus: 'read' },
]);
sohbet('m7', '905301188342', [
  { id: 'n1', direction: 'outgoing', subject: 'Tahsilat hatırlatma - 2026-09 - Başarısız', content: 'Eylül 2026 muhasebe ücreti hatırlatması.', occurredAt: z(2, 11, 0), failed: true, deliveryStatus: 'failed' },
]);
sohbet('m8', '905449902517', [
  { id: 'o1', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Geçici vergi beyannameniz onaylandı, tahakkuk fişi ektedir.', occurredAt: z(3, 15, 42), deliveryStatus: 'read', documents: [{ id: 'd7', title: 'Gecici-vergi-tahakkuk-2026-2.pdf', mimeType: 'application/pdf', sizeBytes: 52310, url: null }] },
  { id: 'o2', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Teşekkürler, ödedik.', occurredAt: z(3, 16, 0) },
]);
sohbet('m9', '905386612704', [
  { id: 'p1', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Eczacıkart faturaları çekilebildi mi? Portalda 12 fatura görünüyor.', occurredAt: z(4, 10, 20) },
  { id: 'p2', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Nur Hanım, 12 faturanın tamamı çekildi ve işlendi.', occurredAt: z(4, 10, 45), deliveryStatus: 'read' },
]);
sohbet('m10', '905324471150', [
  { id: 's1', direction: 'outgoing', subject: 'Evrak hatırlatma — 2026/08 — Gönderildi', content: 'Ağustos 2026 dönemi evraklarınızı bekliyoruz.', occurredAt: z(5, 9, 0), deliveryStatus: 'delivered' },
]);
sohbet('m11', '905337761922', [
  { id: 'oo1', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Serbest meslek makbuzu keseceğim, KDV oranı %20 mi?', occurredAt: z(6, 14, 5) },
  { id: 'oo2', direction: 'outgoing', subject: 'WhatsApp bot cevabı (MOREN AI)', content: 'Evet Ömer Bey, serbest meslek makbuzunda KDV %20 ve stopaj %20 uygulanır. Örnek: 10.000 TL brüt için KDV 2.000 TL, stopaj 2.000 TL, net 10.000 TL.', occurredAt: z(6, 14, 6), deliveryStatus: 'read' },
]);
sohbet('m12', '905413390216', [
  { id: 'b1', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Bilanço ve gelir tablonuz hazır; imza için ofise bekliyoruz.', occurredAt: z(8, 11, 30), deliveryStatus: 'read' },
]);
sohbet('m13', '905356628847', [
  { id: 't1', direction: 'incoming', subject: 'WhatsApp gelen mükellef sorusu', content: 'Yeni personel girişi için evrakları gönderdim, sigortası bugün başlasın.', occurredAt: z(9, 8, 50) },
  { id: 't2', direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: 'Berrak Hanım, işe giriş bildirgesi verildi.', occurredAt: z(9, 9, 20), deliveryStatus: 'read' },
]);
sohbet('m14', '905428804193', [
  { id: 'g1', direction: 'outgoing', subject: 'Tahsilat hatırlatma - 2026-09 - Gönderildi', content: 'Eylül 2026 muhasebe ücreti hatırlatması.', occurredAt: z(12, 10, 0), deliveryStatus: 'delivered' },
]);
sohbet('wa-905551234567', '905551234567', [
  { id: 'u1', direction: 'incoming', subject: 'WhatsApp gelen kayitsiz numara mesaji', content: 'Merhaba, şirket kuruluşu için fiyat alabilir miyim?', occurredAt: z(0, 8, 45) },
  { id: 'u2', direction: 'outgoing', subject: 'WhatsApp kayitsiz bot cevabi', content: 'Merhaba, mesajınız için teşekkürler. Muzaffer Bey en kısa sürede size dönüş yapacak.', occurredAt: z(0, 8, 46), deliveryStatus: 'delivered' },
]);

const OKUNMAMIS = { m2: 2, m3: 2, m4: 1, 'wa-905551234567': 1 };
const DURUM = {
  m1: { status: 'online', label: 'çevrimiçi' },
  m3: { status: 'typing', label: 'yazıyor...' },
  m4: { status: 'offline', label: 'son görülme', lastSeenAt: z(0, 6, 41) },
  m6: { status: 'offline', label: 'son görülme', lastSeenAt: z(1, 13, 40) },
  m2: { status: 'paused', label: 'az önce aktifti' },
};

function konusmaListesi() {
  const liste = [];
  for (const [id, mesajlar] of SOHBETLER) {
    const [taxpayerId, tel] = id.split('__wa__');
    const m = mk(taxpayerId);
    const son = mesajlar[mesajlar.length - 1];
    const gelenler = mesajlar.filter((x) => x.direction === 'incoming');
    liste.push({
      conversationId: id,
      taxpayerId,
      taxpayerName: m.ad,
      kisiAdi: m.kisi,
      unknownContact: !!m.kayitsiz,
      phone: tel,
      lastMessage: (son.content || (son.documents?.[0] ? `📎 ${son.documents[0].title}` : '')).slice(0, 100),
      lastMessageAt: son.occurredAt,
      lastMessageDirection: son.direction,
      lastMessageFailed: !!son.failed,
      unreadCount: OKUNMAMIS[taxpayerId] || 0,
      windowOpen: gelenler.length > 0 && Date.now() - new Date(gelenler[gelenler.length - 1].occurredAt).getTime() < 86400000,
      lastInboundAt: gelenler.length ? gelenler[gelenler.length - 1].occurredAt : null,
      totalMessages: mesajlar.length,
      avatarUrl: null,
      presence: DURUM[taxpayerId] || { status: 'unknown', label: '' },
    });
  }
  liste.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  return liste;
}

function sohbetDetay(id) {
  const mesajlar = SOHBETLER.get(id);
  if (!mesajlar) return { error: 'Konuşma bulunamadı', messages: [] };
  const [taxpayerId, tel] = id.split('__wa__');
  const m = mk(taxpayerId);
  const gelenler = mesajlar.filter((x) => x.direction === 'incoming');
  const sonGelen = gelenler.length ? new Date(gelenler[gelenler.length - 1].occurredAt).getTime() : null;
  return {
    conversationId: id,
    taxpayer: {
      id: taxpayerId, name: m.ad, kisiAdi: m.kisi, phone: tel, taxNumber: m.kayitsiz ? '' : m.vkn,
      unknownContact: !!m.kayitsiz, avatarUrl: null,
      about: taxpayerId === 'm1' ? 'Yavuz Nakliyat — 7/24 yük taşıma' : null, aboutSetAt: taxpayerId === 'm1' ? z(40, 12, 0) : null,
    },
    messages: mesajlar.map((x) => ({
      id: x.id, direction: x.direction, subject: x.subject, content: x.content, occurredAt: x.occurredAt,
      failed: !!x.failed, providerMessageId: null,
      deliveryStatus: x.direction === 'incoming' ? null : (x.deliveryStatus || 'sent'),
      deliveryAt: x.deliveryAt || null,
      documents: (x.documents || []).map((d) => ({ ...d, url: d.url || `https://sahte.moren.local/belge/${d.id}` })),
    })),
    windowOpen: sonGelen ? Date.now() - sonGelen < 86400000 : false,
    windowExpiresAt: sonGelen ? new Date(sonGelen + 86400000).toISOString() : null,
    presence: DURUM[taxpayerId] || null,
  };
}

function rehber(arama) {
  const q = String(arama || '').trim().toLocaleLowerCase('tr-TR');
  return MUKELLEFLER.filter((m) => !m.kayitsiz).filter((m) => !q || m.ad.toLocaleLowerCase('tr-TR').includes(q) || (m.tel || '').includes(q)).map((m) => {
    const konusma = m.tel ? SOHBETLER.get(kimlik(m.id, m.tel)) : null;
    return {
      taxpayerId: m.id, taxpayerName: m.ad, taxNumber: m.vkn,
      phones: m.tel ? [{ phone: m.tel, label: m.kisi ? `${m.kisi} (yetkili)` : 'Firma', primary: true }] : [],
      primaryPhone: m.tel, hasConversation: !!konusma,
      lastMessageAt: konusma ? konusma[konusma.length - 1].occurredAt : null,
      windowOpen: false,
    };
  });
}

let sayac = 100;
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yol === '/integrations/whatsapp/qr/status') return jsonGonder(res, 200, { connected: true, connecting: false, hasQr: false, hasStoredSession: true });
  if (yontem === 'GET' && yol === '/whatsapp/conversations') return jsonGonder(res, 200, konusmaListesi());
  if (yontem === 'GET' && yol === '/whatsapp/contacts') return jsonGonder(res, 200, rehber(q.search));
  if (yontem === 'POST' && yol === '/whatsapp/conversations/start') {
    const taxpayerId = govde.taxpayerId || `wa-${String(govde.phone || '').replace(/\D/g, '')}`;
    if (!mk(taxpayerId)) MUKELLEFLER.push({ id: taxpayerId, ad: govde.displayName || `WhatsApp ${govde.phone}`, vkn: `WHATSAPP-${govde.phone}`, tel: String(govde.phone || '').replace(/\D/g, ''), kisi: null, kayitsiz: true });
    const tel = String(govde.phone || mk(taxpayerId).tel || '').replace(/\D/g, '');
    const id = kimlik(taxpayerId, tel);
    if (!SOHBETLER.has(id)) SOHBETLER.set(id, []);
    SOHBETLER.get(id).push({ id: `n${++sayac}`, direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: govde.initialMessage || 'Merhaba', occurredAt: new Date().toISOString(), deliveryStatus: 'sent' });
    return jsonGonder(res, 200, { ok: true, conversationId: id, taxpayerId, method: 'text' });
  }
  const m = yol.match(/^\/whatsapp\/conversations\/([^/]+)(?:\/(reply|link|media\/upload))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const alt = m[2];
    if (yontem === 'GET' && !alt) return jsonGonder(res, 200, sohbetDetay(id));
    if (yontem === 'DELETE' && !alt) { SOHBETLER.delete(id); return jsonGonder(res, 200, { ok: true }); }
    if (yontem === 'POST' && alt === 'reply') {
      const liste = SOHBETLER.get(id);
      if (!liste) return jsonGonder(res, 200, { ok: false, error: 'Konuşma bulunamadı' });
      liste.push({ id: `n${++sayac}`, direction: 'outgoing', subject: 'Portal WhatsApp mesajı', content: govde.message || `[Sablon: ${govde.templateName}] ${(govde.templateParams || []).join(' | ')}`, occurredAt: new Date().toISOString(), deliveryStatus: 'sent' });
      OKUNMAMIS[id.split('__wa__')[0]] = 0;
      return jsonGonder(res, 200, { ok: true, method: govde.templateName ? 'template' : 'text' });
    }
    if (yontem === 'POST' && alt === 'link') {
      const hedef = mk(govde.targetTaxpayerId);
      if (!hedef) return jsonGonder(res, 200, { ok: false, error: 'Mükellef bulunamadı' });
      const liste = SOHBETLER.get(id) || [];
      const tel = id.split('__wa__')[1];
      const yeni = kimlik(hedef.id, tel);
      SOHBETLER.delete(id);
      SOHBETLER.set(yeni, liste);
      return jsonGonder(res, 200, { ok: true, conversationId: yeni, taxpayerId: hedef.id });
    }
    if (yontem === 'POST' && alt === 'media/upload') {
      const liste = SOHBETLER.get(id);
      if (liste) liste.push({ id: `n${++sayac}`, direction: 'outgoing', subject: 'WhatsApp portal medya', content: '', occurredAt: new Date().toISOString(), deliveryStatus: 'sent', documents: [{ id: `d${sayac}`, title: 'yuklenen-dosya.pdf', mimeType: 'application/pdf', sizeBytes: 1024, url: null }] });
      return jsonGonder(res, 200, { ok: true });
    }
  }
  const belge = yol.match(/^\/documents\/([^/]+)\/download$/);
  if (belge) return jsonGonder(res, 200, { url: `https://sahte.moren.local/belge/${belge[1]}` });
  return false;
}

module.exports = { uclar };
