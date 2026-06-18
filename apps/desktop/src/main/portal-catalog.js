'use strict';

/**
 * Portal kataloğu — TEK KAYNAK (Electron tarafı).
 *
 * Her kısayolun giriş adresi, logosu, hangi şifre grubunu (provider) kullandığı
 * ve giriş formu seçicileri burada. Bu bilgiler "masaüstüne ait" olduğu ve
 * devlet siteleri değiştikçe güncellenebileceği için API'de değil burada tutulur
 * (otomatik güncelleme ile dağıtılır; sunucu deploy'u gerekmez).
 *
 * provider → mevcut PortalCredential şifre grubu:
 *   GIB_IVD        → Vergi Dairesi şifresi (mükellef bazlı)
 *   GIB_EBEYANNAME → Mali Müşavir Sistem şifresi (müşavir geneli)
 *   SGK_EBILDIRGE  → SGK e-Bildirge şifresi (mükellef bazlı)
 */

// GİB tek kapı: Dijital Vergi Dairesi giriş sayfası. İnteraktif/İnternet VD ve
// e-Beyanname de buraya yönleniyor (GİB tüm hizmetleri burada topladı).
// Form: kullanıcı kodu #userid, şifre #sifre, doğrulama kodu (captcha) #dk.
// Seçiciler portal-automation runner'ında (e-Tebligat/şifre doğrulama) ÜRETİMDE
// doğrulanmış olanlarla aynıdır.
const GIB_LOGIN = 'https://dijital.gib.gov.tr/portal/login';
const gibRecipe = {
  code: ['#userid', 'input[name="userid"]', 'input[name*="user" i]', 'input[id*="user" i]', 'input[autocomplete="username"]'],
  pass: ['#sifre', 'input[name="sifre"]', 'input[name*="sifre" i]', 'input[id*="sifre" i]', 'input[autocomplete="current-password"]', 'input[type="password"]'],
  // Güvenlik kodu (CAPTCHA) görseli ve giriş alanı — yeni GİB UI: img[alt="captchaImg"], #dk.
  captchaImg: ['img[alt="captchaImg"]', 'img[alt*="captcha" i]', 'img[src*="captcha" i]', 'img[id*="captcha" i]', 'canvas'],
  captcha: ['#dk', 'input[name="dk"]', 'input[name*="dogrulama" i]', 'input[id*="dogrulama" i]', 'input[placeholder*="doğrulama" i]', 'input[placeholder*="güvenlik" i]', 'input[placeholder*="kod" i]', 'input[maxlength="6"]'],
  submit: ['button:has-text("Giriş Yap")', 'button:has-text("Giris Yap")', 'button[type="submit"]', 'input[type="submit"]', 'button:has-text("Giriş")', 'button:has-text("Giris")'],
};

// SGK giriş formları (kullanıcı adı + e-kod/işyeri kodu + sistem şifresi + işyeri
// şifresi + güvenlik kodu). Seçiciler runner'daki kullaniciIlkKontrollerGiris_*
// alanlarıyla aynı; eski portallar için yedek adaylar da var.
const sgkRecipe = {
  user: ['#kullaniciIlkKontrollerGiris_username', 'input[name="username"]', '#userName', '#kullaniciAdi', 'input[name="userName"]', 'input[name="j_username"]'],
  workplace: ['#kullaniciIlkKontrollerGiris_isyeri_kod', 'input[name="isyeri_kod"]'],
  pass: ['#kullaniciIlkKontrollerGiris_password', 'input[name="password"]', '#sistemSifre', 'input[name="sistemSifre"]', 'input[name="j_password"]'],
  pass2: ['#kullaniciIlkKontrollerGiris_isyeri_sifre', 'input[name="isyeri_sifre"]', '#isyeriSifre', 'input[name="isyeriSifre"]'],
  captchaImg: ['#guvenlik_kod', 'img[src*="/PG"]', 'img[id*="guvenlik" i]', 'img[src*="captcha" i]', 'img[id*="captcha" i]'],
  captcha: ['#kullaniciIlkKontrollerGiris_isyeri_guvenlik', 'input[name="isyeri_guvenlik"]', 'input[id*="guvenlik" i]', 'input[name*="guvenlik" i]', 'input[name*="captcha" i]'],
  submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Giriş")', 'button:has-text("Giris")', 'a:has-text("Giriş")'],
};

const PORTAL_CATALOG = [
  { key: 'dijital_vd',    label: 'Dijital Vergi Dairesi',   group: 'Vergi / GİB', provider: 'GIB_IVD',        logo: 'dijitalVergiDairesiLogo.png', url: GIB_LOGIN, recipe: gibRecipe },
  { key: 'ebeyanname',    label: 'e-Beyanname',              group: 'Vergi / GİB', provider: 'GIB_EBEYANNAME', logo: 'YeniEBeyanname.svg',          url: GIB_LOGIN, recipe: gibRecipe },
  // e-Defter: ana sayfaya gidince GİB OAuth (authebelge.gib.gov.tr realm=ebelge,
  // IdP broker=dijital) üzerinden Dijital Vergi Dairesi giriş formuna yönlenir —
  // aynı #userid/#sifre/#dk formu, gibRecipe uyar. (state tek kullanımlık, sabitlenmez.)
  { key: 'edefter',       label: 'e-Defter',                 group: 'Muhasebe',    provider: 'GIB_IVD',        logo: 'EDefter.svg',                 url: 'https://edefter.gib.gov.tr/default/home', recipe: gibRecipe },
  { key: 'sgk_ebildirge',   label: 'e-Bildirge',        group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_ebildirge.png',     url: 'https://ebildirge.sgk.gov.tr/WPEB/amp/loginldap', recipe: sgkRecipe },
  { key: 'sgk_ebildirgev2', label: 'e-Bildirge V2',     group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_ebildirgev2.png',   url: 'https://ebildirge.sgk.gov.tr/EBildirgeV2', recipe: sgkRecipe },
  { key: 'sgk_isveren',     label: 'İşveren Sistemi',   group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_isveren.png',       url: 'https://uyg.sgk.gov.tr/IsverenSistemi', recipe: sgkRecipe },
  { key: 'sgk_erapor',      label: 'e-Rapor',           group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_erapor.png',        url: 'https://uyg.sgk.gov.tr/vizite/welcome.do', recipe: sgkRecipe },
  { key: 'sgk_isgiris',     label: 'İşe Giriş / Çıkış', group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_isgiriscikis.png',  url: 'https://uyg.sgk.gov.tr/SigortaliTescil/amp/loginldap', recipe: sgkRecipe },
  { key: 'earsiv',        label: 'E-Arşiv Fatura',           group: 'Muhasebe',    provider: 'GIB_IVD',        logo: '__earsiv__',                  url: 'https://earsivportal.efatura.gov.tr/intragiris.html', recipe: gibRecipe },
];

// Arayüze (renderer) gönderilen sade liste — url ve recipe GİTMEZ (güvenlik + gereksiz).
function publicCatalog() {
  return PORTAL_CATALOG.map((p) => ({ key: p.key, label: p.label, group: p.group, provider: p.provider, logo: p.logo }));
}

function findPortal(key) {
  return PORTAL_CATALOG.find((p) => p.key === key) || null;
}

module.exports = { PORTAL_CATALOG, publicCatalog, findPortal };
