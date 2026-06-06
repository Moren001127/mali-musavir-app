'use strict';

/**
 * Portal otomatik giriş — açılan gömülü tarayıcı penceresinde çalıştırılacak
 * form doldurma betiğini üretir. Reçete (alan seçicileri) portal-catalog.js'ten
 * gelir. Şifre yalnızca o pencereye enjekte edilir; loglanmaz, arayüze gitmez.
 *
 * Otomatik GÖNDERME YOK: kullanıcı kodu + şifre doldurulur, ama "Giriş Yap"a
 * kullanıcı basar. Sebep: GİB/SGK girişlerinde doğrulama kodu (captcha) var ve
 * otomatik çözülemez; ayrıca yanlış otomatik denemeyle hesap kilidini önler.
 * (Hattat da aynı şekilde doldurup bırakıyor.)
 */

// Sayfanın İÇİNDE çalışacak doldurucu. DOM hazır olana kadar tekrar dener.
function pageRunner(creds, recipe) {
  var tries = 0;
  var MAX = 40; // ~14 sn (350ms aralık)

  function fill(selectors, value) {
    if (!value || !selectors) return false;
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        if (el.value === value) return true; // zaten dolu — dokunma, kullanıcının odağını çalma
        try { el.focus(); } catch (e) {}
        // React/Angular kontrollü input'larda düz el.value ataması geri alınır;
        // framework'ün dinlediği native value setter'ı kullan. (Görünürlük kontrolü yok:
        // bazı formlar şifre alanını önce gizli oluşturup sonra gösteriyor.)
        try {
          var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          nativeSetter.call(el, value);
        } catch (e) {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('keyup', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function attempt() {
    tries++;
    // Her turda tüm alanları doldurmayı dene (zaten doluysa fill dokunmaz). Şifre
    // alanı geç render edilebildiği veya framework tarafından sıfırlanabildiği için
    // doldurmayı birkaç saniye boyunca tekrar ederiz; dolu alanlar atlanır.
    fill(recipe.code, creds.userCode);
    fill(recipe.user, creds.username);
    fill(recipe.pass, creds.password || creds.secondary);
    if (recipe.pass2) fill(recipe.pass2, creds.secondary);
    if (recipe.office) fill(recipe.office, creds.office);
    if (tries < MAX) setTimeout(attempt, 400);
  }

  attempt();
}

/**
 * @param {object} recipe  portal-catalog reçetesi
 * @param {object} creds   { username, userCode, password, secondaryPassword, officeCode }
 */
function buildLoginScript(recipe, creds) {
  var safeCreds = {
    username: creds.username || '',
    userCode: creds.userCode || '',
    password: creds.password || '',
    secondary: creds.secondaryPassword || '',
    office: creds.officeCode || '',
  };
  return (
    '(' + pageRunner.toString() + ')(' +
    JSON.stringify(safeCreds) + ',' +
    JSON.stringify(recipe) +
    ');'
  );
}

module.exports = { buildLoginScript };
