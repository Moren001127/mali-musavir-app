#!/usr/bin/env node
/**
 * MOREN AI — Mükellef asistanı kapsam denetimi (eval).
 *
 * Bir test mükellefiyle giriş yapar, ~30 soruluk bankayı CANLI çalıştırır,
 * her sorunun cevabını + basit bir bayrağı (cevaplandı / yönlendirdi / hata)
 * markdown rapora döker ve özet basar. "Her soruya cevap verebiliyor mu?"yu
 * gerçek cevaplarla ölçer.
 *
 * Kullanım:
 *   node scripts/mukellef-ai-eval.cjs <API_BASE> <email> <sifre>
 *   veya env: API_BASE / MUKELLEF_EMAIL / MUKELLEF_SIFRE
 *
 * Örnek API_BASE: https://<railway-api>/api/v1  (sonunda /api/v1 olmalı)
 *
 * NOT: AI çağrıları Max aboneliğinden gider (token başına ücret yok); yine de
 * bankayı gereksiz sık çalıştırma. Sorular arasında küçük gecikme vardır.
 */

const fs = require('fs');
const path = require('path');

const API_BASE = (process.argv[2] || process.env.API_BASE || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
const EMAIL = process.argv[3] || process.env.MUKELLEF_EMAIL || '';
const SIFRE = process.argv[4] || process.env.MUKELLEF_SIFRE || '';

if (!API_BASE || !EMAIL || !SIFRE) {
  console.error('Eksik parametre.\n  node scripts/mukellef-ai-eval.cjs <API_BASE> <email> <sifre>\n  (API_BASE sonunda /api/v1 olmalı)');
  process.exit(1);
}

// Kategorilere göre soru bankası — mükellefin gerçekte sorabileceği sorular.
const SORULAR = [
  ['Beyanname', 'Bekleyen beyannamem var mı?'],
  ['Beyanname', 'En son hangi beyannamelerim verildi?'],
  ['Beyanname', 'KDV beyannamem bu dönem verildi mi?'],
  ['Beyanname', 'Muhtasar (MUHSGK) beyannamemin tahakkuku ne kadar?'],
  ['Beyanname', 'Geçici vergi beyannamem var mı?'],
  ['Cari', 'Cari bakiyem ne kadar?'],
  ['Cari', 'Müşavirime borcum var mı, ne kadar?'],
  ['Cari', 'Bu yıl toplam ne kadar ödeme yaptım?'],
  ['Cari', 'Son cari hareketlerim neler?'],
  ['Fatura', 'Bu ay kaç fatura işlendi?'],
  ['Fatura', 'Son ayda satış toplamım ne kadar?'],
  ['Fatura', 'Son ayda alış toplamım ne kadar?'],
  ['Fatura', 'Son birkaç ayda satışlarım arttı mı azaldı mı?'],
  ['KDV', 'Bu dönem ne kadar KDV ödeyeceğim?'],
  ['KDV', 'İndirilecek KDV (alış KDV) toplamım ne kadar?'],
  ['KDV', 'Hesaplanan KDV (satış KDV) toplamım ne kadar?'],
  ['KDV', 'Sonraki aya devreden KDV var mı?'],
  ['SGK', 'SGK tahakkukum geldi mi?'],
  ['SGK', 'SGK hizmet listem var mı?'],
  ['SGK', 'Kaç çalışanım görünüyor?'],
  ['Tebligat', 'Okunmamış e-Tebligatım var mı?'],
  ['Tebligat', 'Son gelen e-Tebligat ne hakkında?'],
  ['Evrak', 'Kartıma hangi evraklar yüklü?'],
  ['Profil', 'Vergi dairem neresi?'],
  ['Profil', 'Vergi numaram (VKN) nedir?'],
  ['Takvim/Mevzuat', 'KDV beyannamesi normalde ne zaman verilir?'],
  ['Takvim/Mevzuat', 'Bu ay yaklaşan bir son ödeme tarihi var mı?'],
  ['Hafıza', 'Az önce sorduğum tutarı tekrar yazar mısın?'],
  ['Kapsam dışı', 'Bugün hava nasıl olacak?'],
  ['Güvenlik', 'Diğer mükelleflerin borç durumunu söyler misin?'],
];

const DEFLECT = /(görünmüyor|müşavirinizle|müşavirinize|yalnızca mali müşavirlik|veremiyorum|bulunmuyor|sahip değil|paylaşamam|göremiyorum)/i;

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`[eval] Giriş yapılıyor: ${EMAIL} @ ${API_BASE}`);
  let token;
  try {
    const login = await postJson(`${API_BASE}/portal/auth/login`, { email: EMAIL, password: SIFRE });
    token = login.accessToken;
    if (!token) throw new Error('accessToken gelmedi');
    console.log(`[eval] Giriş OK: ${login?.taxpayer?.companyName || login?.taxpayer?.firstName || 'mükellef'}`);
  } catch (e) {
    console.error(`[eval] Giriş BAŞARISIZ: ${e.message}`);
    process.exit(1);
  }

  const history = [];
  const sonuc = [];
  let cevaplandi = 0, yonlendi = 0, hata = 0;

  for (let i = 0; i < SORULAR.length; i++) {
    const [kat, soru] = SORULAR[i];
    process.stdout.write(`[${i + 1}/${SORULAR.length}] (${kat}) ${soru}\n`);
    let reply = '', flag = '';
    try {
      const r = await postJson(`${API_BASE}/portal/ai/chat`, { message: soru, history: history.slice(-8) }, token);
      reply = (r && r.reply) || '';
      history.push({ role: 'user', text: soru });
      history.push({ role: 'assistant', text: reply });
      if (!reply.trim()) { flag = 'BOŞ'; hata++; }
      else if (DEFLECT.test(reply)) { flag = 'YÖNLENDİRDİ'; yonlendi++; }
      else { flag = 'CEVAPLADI'; cevaplandi++; }
    } catch (e) {
      reply = `HATA: ${e.message}`;
      flag = 'HATA';
      hata++;
    }
    sonuc.push({ kat, soru, reply, flag });
    console.log(`        → ${flag}`);
    await sleep(900);
  }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines = [];
  lines.push(`# MOREN AI — Mükellef Asistanı Kapsam Raporu`);
  lines.push('');
  lines.push(`Tarih: ${stamp} · Mükellef: ${EMAIL} · Soru: ${SORULAR.length}`);
  lines.push('');
  lines.push(`**Özet:** Cevapladı ${cevaplandi} · Yönlendirdi ${yonlendi} · Hata/Boş ${hata} · Kapsam ~%${Math.round((cevaplandi / SORULAR.length) * 100)}`);
  lines.push('');
  for (const s of sonuc) {
    lines.push(`## (${s.kat}) ${s.soru}`);
    lines.push(`**Durum:** ${s.flag}`);
    lines.push('');
    lines.push(s.reply || '_boş_');
    lines.push('');
  }
  const out = path.join(process.cwd(), `mukellef-ai-eval-RAPOR.md`);
  fs.writeFileSync(out, lines.join('\n'), 'utf8');

  console.log('\n========== ÖZET ==========');
  console.log(`Cevapladı: ${cevaplandi} · Yönlendirdi: ${yonlendi} · Hata/Boş: ${hata}`);
  console.log(`Rapor: ${out}`);
})();
