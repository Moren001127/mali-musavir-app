#!/usr/bin/env node
/**
 * BOT DOGRULAMA KOSUMU — kuru test (mesaj GITMEZ).
 *
 *   node scripts/bot-deneme/kos.cjs                 # hepsi
 *   node scripts/bot-deneme/kos.cjs o-tur-gecici    # tek/birkac id
 *   MOREN_DENEME_TOKEN=... node scripts/bot-deneme/kos.cjs
 *
 * Cikti: her soru icin GECTI/KALDI + sonunda ozet. Ayrinti sonuc.json'a yazilir.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { sorular, mukellefTelefon } = require('./sorular.cjs');

const API = process.env.MOREN_API_HOST || 'mali-musavir-app-production.up.railway.app';
const TOKEN = process.env.MOREN_DENEME_TOKEN || 'moren-deneme-2026-8f3kq7';
const SUZ = process.argv.slice(2);

function sor(taraf, metin, oncekiSoru, telefon) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ token: TOKEN, taraf, metin, oncekiSoru, telefon }), 'utf8');
    const req = https.request(
      { hostname: API, path: '/api/v1/whatsapp/webhook/deneme', method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length }, timeout: 240000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ cevap: '', hata: 'json degil: ' + d.slice(0, 120) }); } }); },
    );
    req.on('error', (e) => resolve({ cevap: '', hata: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ cevap: '', hata: 'zaman asimi' }); });
    req.write(body); req.end();
  });
}

(async () => {
  const liste = SUZ.length ? sorular.filter((s) => SUZ.includes(s.id)) : sorular;
  if (!liste.length) { console.error('Eslesen soru yok:', SUZ.join(', ')); process.exit(2); }
  console.log(`\nBOT DOGRULAMA — ${liste.length} soru · ${API}\n${'='.repeat(64)}`);
  const sonuclar = [];
  let gecti = 0;

  for (const s of liste) {
    const r = await sor(s.taraf, s.soru, s.onceki, s.taraf === 'mukellef' ? mukellefTelefon : undefined);
    const cevap = String(r.cevap || '');
    const eksik = (s.beklenen || []).filter((re) => !re.test(cevap)).map(String);
    const yasak = (s.olmamali || []).filter((re) => re.test(cevap)).map(String);
    const bos = !cevap.trim();
    const ok = !bos && !eksik.length && !yasak.length;
    if (ok) gecti++;
    sonuclar.push({ id: s.id, taraf: s.taraf, soru: s.soru, onceki: s.onceki || null, cevap, tur: r.tur || '', ms: r.ms || 0, ok, eksik, yasak, bos, hata: r.hata || null });

    console.log(`\n${ok ? '✓ GEÇTİ' : '✗ KALDI'}  [${s.id}] ${s.taraf} · ${Math.round((r.ms || 0) / 1000)} sn · ${r.tur || '-'}`);
    console.log(`   soru : ${s.soru}${s.onceki ? `   (önceki: ${s.onceki})` : ''}`);
    if (!ok) {
      if (bos) console.log('   HATA : cevap BOŞ' + (r.hata ? ` (${r.hata})` : ''));
      if (eksik.length) console.log('   eksik: ' + eksik.join(' , '));
      if (yasak.length) console.log('   yasak: ' + yasak.join(' , '));
    }
    console.log('   cevap: ' + (cevap.replace(/\n/g, '\n          ').slice(0, 600) || '(boş)'));
  }

  const dosya = path.join(__dirname, 'sonuc.json');
  fs.writeFileSync(dosya, JSON.stringify(sonuclar, null, 1), 'utf8');
  const kalan = sonuclar.filter((x) => !x.ok);
  console.log(`\n${'='.repeat(64)}\nÖZET: ${gecti}/${liste.length} geçti`);
  if (kalan.length) console.log('KALANLAR: ' + kalan.map((x) => x.id).join(', '));
  console.log(`Ayrıntı: ${dosya}`);
  process.exit(kalan.length ? 1 : 0);
})();
