// Bildirimler sahte verisi — beyaz tema yeniden tasarım doğrulaması (2026-09-21).
//   Yerleşik `/notifications` ucu mock-api.cjs içinde BOŞ dizi döner ve eklentiden önce eşleşir; bu yüzden liste
//   burada `/bildirimler-sahte/liste` yolunda sunulur, önizleme betiği tarayıcıda `page.route` ile asıl yolu
//   buraya yönlendirir. Tercihler ve okundu işaretleme uçları asıl yollarında karşılanır (bellekte durum tutar).
const SIMDI = Date.now();
const dk = (n) => new Date(SIMDI - n * 60_000).toISOString();
const saat = (n) => dk(n * 60);
const gun = (n) => dk(n * 60 * 24);

let sayac = 0;
function b(type, title, body, zaman, ek = {}) {
  sayac += 1;
  return { id: `n${sayac}`, type, title, body, createdAt: zaman, isRead: !!ek.okundu, readAt: ek.okundu ? zaman : null, metadata: ek.metadata || null };
}

const LISTE = [
  // ── Bugün ──
  b('E_TEBLIGAT', '📩 e-Tebligat: Mert Reklam Ajansı Ltd. Şti.', '2025/2. dönem geçici vergi için bilgi isteme yazısı. Cevap süresi 15 gün (son gün 3 Ekim).', dk(25), { metadata: { taxpayerId: 'm4' } }),
  b('WHATSAPP', '💬 Famcoffee Kahve A.Ş. yanıt bekliyor', 'Dekontu gönderdik, Ağustos ücreti için makbuz alabilir miyiz?', dk(48), { metadata: { taxpayerId: 'm5', phone: '0532 411 82 07' } }),
  b('LUCA_SYNC_ERROR', '⚠️ Luca aktarımı başarısız: Balçık İnşaat A.Ş. (fiş aktarımı)', '2 satırda cari bulunamadı: "BLC2026000000412", "BLC2026000000419". Cari kart tanımlanınca yeniden deneyin.', dk(70), { metadata: { taxpayerId: 'm7' } }),
  b('AUTOMATION', '⚡ Gece işi tamamlandı: e-Arşiv sorgusu (38 mükellef)', '36 başarılı · 2 yeniden denendi · 0 hata. Rapor Otomasyonlar ekranında.', dk(95), { okundu: true }),
  b('TASK_DUE', '⏰ Görev vadesi bugün: Öz Ela Gıda — KDV kontrolü', 'Vade 21 Eylül 17:00. Sorumlu: Muzaffer Ören.', dk(130), { metadata: { taxpayerId: 'm1' } }),
  b('BUTCE_KRITIK', '💳 Kart limiti %92 doldu', 'Garanti iş kartı: 46.000 ₺ / 50.000 ₺. Ekstre kesim 27 Eylül.', dk(160)),
  b('DOCUMENT_UPLOADED', '📎 Yeni evrak: Ayşegül Kaya', 'Ağustos Z raporları (3 dosya) mükellef portalından yüklendi.', dk(190), { okundu: true, metadata: { taxpayerId: 'm3' } }),
  b('WHATSAPP', '💬 Kayıtsız numara mesaj attı: 0554 209 33 61', '"Merhaba, defter tasdiki için randevu alabilir miyim?"', dk(210), { okundu: true }),
  b('AGENT', '🤖 SGK taraması bitti: 33 mükellef', '2 mükellefte yeni tahakkuk fişi bulundu (Ela Tekstil, Balçık İnşaat).', dk(240), { okundu: true }),
  b('SYSTEM', '🛠️ Luca ajanı 14 dakika yanıt vermedi, yeniden başlatıldı', 'Bilgisayar: OFIS-PC-2. Kuyruktaki 3 iş sırasına döndü.', dk(300), { okundu: true }),
  b('SYSTEM', '🛠️ Luca ajanı 9 dakika yanıt vermedi, yeniden başlatıldı', 'Bilgisayar: OFIS-PC-2. Kuyruktaki 1 iş sırasına döndü.', dk(310), { okundu: true }),
  b('SYSTEM', '🛠️ Luca ajanı 11 dakika yanıt vermedi, yeniden başlatıldı', 'Bilgisayar: OFIS-PC-1. Kuyruk boştu.', dk(322), { okundu: true }),
  b('LUCA_SYNC_ERROR', '⚠️ Luca aktarımı başarısız: Ela Tekstil Ltd. Şti. (mizan çekimi)', 'Zaman aşımı (120 sn). İş 1 kez daha denenecek.', dk(330), { okundu: true, metadata: { taxpayerId: 'm6' } }),
  b('AI', '✨ Bot kalite raporu hazır (haftalık)', '184 mesaj · %96 doğru yanıt · 3 eskalasyon. Ayrıntı MOREN AI ekranında.', dk(400), { okundu: true }),
  b('KDV_RESULT', '🧾 KDV kontrolü: Öz Ela Gıda — 4 kayıt incelemede', '3 tutar uyuşmazlığı, 1 mükerrer fatura şüphesi.', dk(430), { okundu: true, metadata: { taxpayerId: 'm1', sessionId: 'kdv-2026-09-m1' } }),

  // ── Dün ──
  b('TAX_DEADLINE', '📅 Beyanname son 5 gün: KDV1 — 27 mükellef onaylanmadı', 'Son gün 26 Eylül. 4 mükellefte evrak eksik, 1 mükellefte hata var.', saat(26)),
  b('PENDING_DECISION', '❓ Karar bekleniyor: Famcoffee — demirbaş mı gider mi?', 'Espresso makinesi 48.500 ₺ (KDV hariç). Öneri: 255 Demirbaşlar.', saat(28), { metadata: { taxpayerId: 'm5' } }),
  b('BANK_TRANSACTION_ALERT', '🏦 Banka ekstresi geldi: Balçık İnşaat A.Ş. (Ziraat)', 'Ağustos ekstresi 214 hareket. Eşleştirme bekliyor.', saat(30), { okundu: true, metadata: { taxpayerId: 'm7' } }),
  b('WHATSAPP', '💬 Öz Ela Gıda yanıt bekliyor', 'Kira faturasını cuma gönderiyoruz, uygun mu?', saat(31), { okundu: true, metadata: { taxpayerId: 'm1' } }),
  b('MIHSAP_RESULT', '📄 Mihsap aktarımı: Famcoffee — 2 kayıt hatalı', 'Fatura tarihi okunamadı (FM-20260818-07, FM-20260818-11).', saat(33), { okundu: true, metadata: { taxpayerId: 'm5' } }),
  b('AUTOMATION', '⚡ Evrak hatırlatması gönderildi: 5 mükellef', 'Pilot liste. 4 iletildi, 1 numara WhatsApp’ta değil (Dilek Bayageldi).', saat(36), { okundu: true }),
  b('BUTCE', '💰 Ofis kirası 3 gün sonra', '24 Eylül · 18.500 ₺ · Ofis giderleri.', saat(40), { okundu: true }),
  b('SYSTEM', '🛠️ Gece işi özeti: 41 iş · 39 tamam · 2 yeniden denendi', 'e-Arşiv 38, SGK 2, e-Tebligat 1. Hata yok.', saat(44), { okundu: true }),

  // ── Bu hafta ──
  b('PORTAL_CREDENTIAL_FAIL', '🔑 Portal şifre hatası: Dilek Bayageldi (GİB)', 'İnteraktif Vergi Dairesi girişi reddedildi. Şifre güncellenene kadar sorgular durdu.', gun(2), { metadata: { taxpayerId: 'm8' } }),
  b('AUTH_NEW_DEVICE', '🔐 Yeni cihaz girişi', 'Windows · Chrome · İstanbul (85.105.•.•) — 19 Eylül 08:41. Siz değilseniz şifrenizi değiştirin.', saat(50), { okundu: true }),
  b('INVOICE_OVERDUE', '🧾 60+ gündür bekleyen alış faturaları: 17 belge', 'Öz Ela 9, Mert Reklam 5, Balçık İnşaat 3. Fatura İşleme Merkezi’nde süzgeçli görünüm.', gun(3), { okundu: true }),
  b('TASK_DUE', '⏰ Görev gecikti: Ela Tekstil — SGK bildirgesi', 'Vade 17 Eylül geçti. Sorumlu: Elif (ekip).', saat(75), { okundu: true, metadata: { taxpayerId: 'm6' } }),
  b('AGENT', '🤖 e-Tebligat taraması bitti: 38 mükellef', 'Yeni tebligat yok.', gun(4), { okundu: true }),
  b('DOCUMENT_UPLOADED', '📎 Yeni evrak: Erdoğan Balçık', 'Ağustos banka ekstresi (PDF) mükellef portalından yüklendi.', saat(100), { okundu: true, metadata: { taxpayerId: 'm2' } }),
  b('AI_PROPOSAL', '💡 DENİZ önerisi: 3 mükellefte gider sınıfı düzeltmesi', 'Motor yağı faturaları "akaryakıt" yerine "araç bakım" hesabına yazılmalı.', gun(5), { okundu: true }),
  b('WHATSAPP', '💬 Mert Reklam Ajansı yanıt bekliyor', 'Tebligat için ne yapmamız gerekiyor?', saat(122), { okundu: true, metadata: { taxpayerId: 'm4' } }),
  b('LUCA_SYNC_ERROR', '⚠️ Luca aktarımı başarısız: Dilek Bayageldi (işletme defteri)', 'Dönem kilitli (2026-08). Kilit açılınca yeniden deneyin.', gun(6), { okundu: true, metadata: { taxpayerId: 'm8' } }),

  // ── Daha eski ──
  b('GALERI_HGS_OZET', '🚗 HGS sorgusu: 3 plakada ihlal', '34 ABC 123 (2), 34 DEF 456 (1). Toplam 1.240 ₺.', gun(8), { okundu: true }),
  b('CAPTCHA_SOLVER_ERROR', '🛡️ Güvenlik kodu servisi bakiyesi bitti', 'Otomasyonlar duraklatıldı. Bakiye yüklenince kendiliğinden devam eder.', gun(9), { okundu: true }),
  b('OFFICE_CHAT', '💬 Ofis sohbeti: Elif — "Bordrolar hazır, kontrol eder misiniz?"', '', gun(10), { okundu: true }),
  b('MOREN_AI_ALERT', '✨ Belge içerik denetimi: Balçık İnşaat — 2 faturada risk', 'Hizmet kalemi ile hesap kodu uyuşmuyor (7/10 tevkifat).', gun(11), { okundu: true, metadata: { taxpayerId: 'm7' } }),
  b('AI_COST_LIMIT', '💸 AI günlük maliyet tavanına yaklaşıldı (%85)', 'Bugün 8,50 $ / 10 $. Tavan aşılırsa bot bekleme moduna geçer.', gun(12), { okundu: true }),
  b('BUTCE', '💰 Elektrik faturası ödendi', '2.140 ₺ · 9 Eylül · Ofis giderleri.', saat(300), { okundu: true }),
  b('SYSTEM', '🛠️ Gece işi özeti: 40 iş · 40 tamam', 'e-Arşiv 37, SGK 2, e-Tebligat 1.', gun(13), { okundu: true }),
  b('AUTOMATION', '⚡ Aylık ödeme listesi gönderildi: 61 mükellef', '58 iletildi · 3 numara WhatsApp’ta değil.', gun(14), { okundu: true }),
];

let TERCIH = { mutedTypes: ['OFFICE_CHAT'] };

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // Liste (yerleşik uç boş döndüğü için ayrı yol; önizleme betiği page.route ile buraya yönlendirir)
  if (yontem === 'GET' && yol === '/bildirimler-sahte/liste') {
    const sirali = [...LISTE].sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1));
    return jsonGonder(res, 200, sirali.slice(0, Number(q.limit) || 100));
  }
  if (yol === '/notifications/preferences') {
    if (yontem === 'GET') return jsonGonder(res, 200, TERCIH);
    if (yontem === 'PUT') { TERCIH = { mutedTypes: Array.isArray(govde.mutedTypes) ? govde.mutedTypes : [] }; return jsonGonder(res, 200, TERCIH); }
  }
  if (yontem === 'PATCH' && yol === '/notifications/read-all') {
    let n = 0;
    for (const x of LISTE) if (!x.isRead) { x.isRead = true; x.readAt = new Date().toISOString(); n++; }
    return jsonGonder(res, 200, { count: n });
  }
  const tek = /^\/notifications\/([^/]+)\/read$/.exec(yol);
  if (yontem === 'PATCH' && tek) {
    const x = LISTE.find((k) => k.id === tek[1]);
    if (x) { x.isRead = true; x.readAt = new Date().toISOString(); }
    return jsonGonder(res, 200, { ok: true });
  }
  return false;
}

module.exports = { uclar, LISTE };
