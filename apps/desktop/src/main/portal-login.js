'use strict';

/**
 * Portal otomatik giriş reçeteleri.
 *
 * Her kısayol için, açılan gömülü tarayıcı penceresinde çalıştırılacak bir
 * doldurma reçetesi (alan seçicileri) tanımlar. Şifre yalnızca o pencereye
 * enjekte edilir; loglanmaz, arayüze gönderilmez.
 *
 * NOT: Seçiciler devlet sitelerinin güncel formlarına göredir; site arayüzü
 * değişirse buradaki seçici listeleri güncellenir (canlı testte doğrulanacak).
 * Birden çok aday seçici denenir, bu yüzden küçük değişikliklere dayanıklıdır.
 */

// Sayfanın İÇİNDE çalışacak doldurucu. DOM hazır olana kadar bekler.
function pageRunner(creds, recipe, autoSubmit) {
  var tries = 0;
  var MAX = 40; // ~14 sn (350ms aralık)

  function fill(selectors, value) {
    if (!value || !selectors) return false;
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.offsetParent !== null) {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('keyup', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function submit() {
    if (recipe.submit) {
      for (var i = 0; i < recipe.submit.length; i++) {
        var btn = document.querySelector(recipe.submit[i]);
        if (btn) { btn.click(); return true; }
      }
    }
    var passSel = (recipe.pass || []).concat(recipe.pass2 || []);
    for (var j = 0; j < passSel.length; j++) {
      var pf = document.querySelector(passSel[j]);
      if (pf && pf.form) { pf.form.submit(); return true; }
    }
    return false;
  }

  function attempt() {
    tries++;
    var idOk = fill(recipe.user, creds.username) || fill(recipe.code, creds.userCode);
    var passOk = fill(recipe.pass, creds.password || creds.secondary);
    if (recipe.pass2) fill(recipe.pass2, creds.secondary);
    if (recipe.office) fill(recipe.office, creds.office);

    if (passOk) {
      if (autoSubmit) { setTimeout(submit, 400); }
      return;
    }
    if (tries < MAX) setTimeout(attempt, 350);
  }

  attempt();
}

// Reçeteler — provider grubuna göre seçici adayları.
const RECIPES = {
  // GİB vergi daireleri (kullanıcı kodu + şifre)
  dijital_vd: {
    code: ['#userId', 'input[name="userId"]', '#kullaniciKodu', 'input[name="kullaniciKodu"]', 'input[name="userCode"]'],
    pass: ['#password', 'input[name="password"]', '#sifre', 'input[name="sifre"]'],
    submit: ['#loginButton', 'button[type="submit"]', 'input[type="submit"]'],
  },
  interaktif_vd: {
    code: ['#userId', 'input[name="userId"]', '#kullaniciKodu', 'input[name="kullaniciKodu"]'],
    pass: ['#password', 'input[name="password"]', '#sifre', 'input[name="sifre"]'],
    submit: ['#loginButton', 'button[type="submit"]', 'input[type="submit"]'],
  },
  internet_vd: {
    code: ['#userId', '#kullaniciKodu', 'input[name="kullaniciKodu"]', 'input[name="userCode"]'],
    pass: ['#password', '#sifre', 'input[name="sifre"]', 'input[name="password"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]', '#girisButton'],
  },
  ebeyanname: {
    code: ['input[name="userCode"]', '#userCode', '#kullaniciKodu', 'input[name="kullaniciKodu"]'],
    pass: ['input[name="password"]', '#password', '#sifre', 'input[name="sifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  edefter: {
    code: ['#userId', '#kullaniciKodu', 'input[name="kullaniciKodu"]', 'input[name="j_username"]'],
    pass: ['#password', '#sifre', 'input[name="sifre"]', 'input[name="j_password"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  earsiv: {
    code: ['#userId', '#kullaniciKodu', 'input[name="kullaniciKodu"]', 'input[name="userCode"]'],
    pass: ['#password', '#sifre', 'input[name="sifre"]', 'input[name="password"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  // SGK (kullanıcı adı + sistem şifresi + işyeri şifresi)
  sgk_ebildirge: {
    user: ['#userName', 'input[name="userName"]', '#kullaniciAdi', 'input[name="j_username"]'],
    pass: ['#sistemSifre', '#password', 'input[name="j_password"]', 'input[name="sistemSifre"]'],
    pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]', '#girisButton'],
  },
  sgk_ebildirgev2: {
    user: ['#userName', 'input[name="userName"]', '#kullaniciAdi'],
    pass: ['#sistemSifre', '#password', 'input[name="sistemSifre"]'],
    pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  sgk_isveren: {
    user: ['#userName', 'input[name="userName"]', '#kullaniciAdi'],
    pass: ['#sistemSifre', '#password', 'input[name="sistemSifre"]'],
    pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  sgk_erapor: {
    user: ['#userName', 'input[name="userName"]', '#kullaniciAdi'],
    pass: ['#sistemSifre', '#password', 'input[name="sistemSifre"]'],
    pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  sgk_isgiris: {
    user: ['#userName', 'input[name="userName"]', '#kullaniciAdi'],
    pass: ['#sistemSifre', '#password', 'input[name="sistemSifre"]'],
    pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  sgk_ebildirim: {
    user: ['#userName', 'input[name="userName"]', '#kullaniciAdi'],
    pass: ['#sistemSifre', '#password', 'input[name="sistemSifre"]'],
    pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
  _default: {
    user: ['input[type="text"]', 'input[name="username"]', 'input[name="userName"]'],
    code: ['input[name="userCode"]', 'input[name="kullaniciKodu"]'],
    pass: ['input[type="password"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]'],
  },
};

/**
 * Verilen portal için, sayfada çalıştırılacak JS metnini üretir.
 * @param {string} portalKey
 * @param {object} creds  { username, userCode, password, secondaryPassword, officeCode }
 * @param {boolean} autoSubmit
 */
function buildLoginScript(portalKey, creds, autoSubmit) {
  const recipe = RECIPES[portalKey] || RECIPES._default;
  const safeCreds = {
    username: creds.username || '',
    userCode: creds.userCode || '',
    password: creds.password || '',
    secondary: creds.secondaryPassword || '',
    office: creds.officeCode || '',
  };
  // Kendi penceremiz; creds JSON olarak gömülür. Tek seferlik IIFE.
  return (
    '(' + pageRunner.toString() + ')(' +
    JSON.stringify(safeCreds) + ',' +
    JSON.stringify(recipe) + ',' +
    (autoSubmit ? 'true' : 'false') +
    ');'
  );
}

module.exports = { buildLoginScript, RECIPES };
