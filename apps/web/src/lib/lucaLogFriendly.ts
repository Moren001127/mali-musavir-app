// Luca ajan loglarını SADE, CÜMLE CÜMLE TÜRKÇE aşamalara çevirir.
// Kullanıcı isteği (2026-08-10): "jasper.jq / XHR / ham JSON / durum= gibi teknik saçmalıkları
// GÖSTERME; şuraya tıklıyor, indiriliyor gibi anlaşılır aşamalar yaz." TÜM modüllerde geçerli
// (Mizan, e-Arşiv, KDV, e-Defter, İHÖ...). Ham teknik satırları gizler, tanıdık adımları
// insan-dostu Türkçe cümleye çevirir, ardışık tekrarları teker.

const NOISE = [
  /jasper\.?j[qk]/i,             // jasper.jq / jasper.jk
  /\bXHR\b/i,
  /ct=application/i,
  /size≈|size~=|size=\d/i,
  /body=\{/i,
  /"donem_bas"|"cari_donem_bas"|"kesinlesme_tarihi"|"hesap_plani"/i,
  /response \(\d+/i,             // "response (61B)"
  /rapor_takip durum=/i,
  /native flow/i,
  /^\s*\{/,                      // ham JSON satırı
  /^\s*[a-z_]+"\s*:\s*[\d"\{\[]/i, // "em":0,"doviz_kullan":0... ham JSON parçası
  /abort edildi|tek session|fetch Excel|Excel\/tarih zorlandi/i,
];

// Teknik satırı bile anlamlı bir aşamaya çevirebiliyorsak (gizlemeden önce) bunlara bak.
const NOISE_TO_STAGE: [RegExp, string][] = [
  [/Daha önceden hazırlanmış raporunuz|zaten hazir|already prepared/i, 'Hazır rapor bulundu, alınıyor'],
  [/fetch Excel|Excel\/tarih zorlandi/i, 'Rapor Excel olarak hazırlanıyor'],
  [/rapor_takip durum=|native flow/i, 'Rapor hazırlanıyor…'],
];

// Tanıdık aşamalar → sade Türkçe cümle.
const STAGE_MAP: [RegExp, string][] = [
  [/siraya alind|sıraya alınd|queued/i, 'İşlem sıraya alındı'],
  [/agent flow (basliyor|başlıyor)|flow başl/i, 'Luca işlemi başlatıldı'],
  [/otomatik giris|LUCASSO|giris ekran|giriş ekran|login/i, 'Luca giriş ekranına gidiliyor'],
  [/guvenlik kod|güvenlik kod|captcha/i, 'Güvenlik kodu çözülüyor'],
  [/giris(i)? tamam|giriş tamam|login (ok|tamam)/i, 'Luca girişi tamamlandı'],
  [/musavirpaketi|giris aksiyonu tiklan|klasik Luca (ekranina geciliyor|gecisi|acil)/i, 'Klasik Luca ekranına geçiliyor'],
  [/klasik Luca ekranin[dı]?a hazir|ekranında hazır|hazir\b/i, 'Luca hazır'],
  [/firma (secil|seçil|bulun|dogru|doğru)|firma alan/i, 'Firma seçiliyor'],
  [/menu|menü|rapor sayfas|mizan sayfas|rapor ekran/i, 'İlgili rapor ekranı açılıyor'],
  [/mizan.*(hazirlan|hazırlan)|Excel hazirlan|rapor hazirlan/i, 'Rapor hazırlanıyor'],
  [/indir|download|excel al/i, 'Rapor indiriliyor'],
  [/yukle|yükle|backend.*gonder|kaydedil|isleniyor|işleniyor/i, 'İndirilen veri işleniyor'],
  [/tamamlan|bitti|\bdone\b|basari|başarı/i, 'Tamamlandı'],
  [/hata|error|basarisiz|başarısız|fail/i, 'Bir sorun oluştu, tekrar deneniyor'],
];

function stripPrefix(line: string): { time: string; body: string } {
  const timeM = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
  const time = timeM ? timeM[1] : '';
  const body = line
    .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '')
    // baştaki emoji / sembol / ikon karakterlerini at
    .replace(/^[^0-9A-Za-zçğışöüÇĞİŞÖÜ]+/, '')
    .trim();
  return { time, body };
}

/** Ham Luca log satırlarını sade Türkçe aşama listesine çevirir. */
export function lucaLogFriendly(rawLines: string[], opts: { withTime?: boolean } = {}): string[] {
  const withTime = opts.withTime !== false; // varsayılan: saat göster
  const out: string[] = [];
  const lastMsg = () => (out.length ? out[out.length - 1].replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '') : '');
  const push = (time: string, msg: string) => {
    if (!msg) return;
    if (lastMsg() === msg) return; // ardışık tekrarı teker
    out.push(withTime && time ? `[${time}] ${msg}` : msg);
  };

  for (const raw of rawLines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const { time, body } = stripPrefix(line);

    // 1) GÜRÜLTÜ: teknik satır → mümkünse anlamlı aşamaya çevir, değilse GİZLE.
    if (NOISE.some((re) => re.test(line))) {
      const stage = NOISE_TO_STAGE.find(([re]) => re.test(line));
      if (stage) push(time, stage[1]);
      continue;
    }

    // 2) TANIDIK AŞAMA → sade Türkçe.
    const mapped = STAGE_MAP.find(([re]) => re.test(body));
    if (mapped) { push(time, mapped[1]); continue; }

    // 3) Zaten sade/kısa Türkçe bir cümleyse aynen göster (uzun/teknik değilse).
    if (body.length <= 90 && !/[{}\[\]<>]|=\d|http/i.test(body)) push(time, body);
    // aksi halde gizle (uzun/teknik).
  }
  return out;
}
