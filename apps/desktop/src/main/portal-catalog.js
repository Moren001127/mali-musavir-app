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
const GIB_LOGIN = 'https://dijital.gib.gov.tr/portal/login';
const gibRecipe = {
  code: ['#userid', 'input[name="userid"]'],
  pass: ['#sifre', 'input[name="sifre"]'],
  submit: ['button[type="submit"]'],
};

// SGK giriş formları (kullanıcı adı + sistem şifresi + işyeri şifresi).
// Seçiciler canlı testte doğrulanacak; çoklu aday denenir.
const sgkRecipe = {
  user: ['#userName', '#kullaniciAdi', 'input[name="userName"]', 'input[name="j_username"]'],
  pass: ['#sistemSifre', '#password', 'input[name="sistemSifre"]', 'input[name="j_password"]'],
  pass2: ['#isyeriSifre', 'input[name="isyeriSifre"]'],
  submit: ['button[type="submit"]', 'input[type="submit"]'],
};

const PORTAL_CATALOG = [
  { key: 'dijital_vd',    label: 'Dijital Vergi Dairesi',   group: 'Vergi / GİB', provider: 'GIB_IVD',        logo: 'dijitalVergiDairesiLogo.png', url: GIB_LOGIN, recipe: gibRecipe },
  { key: 'interaktif_vd', label: 'İnteraktif Vergi Dairesi', group: 'Vergi / GİB', provider: 'GIB_IVD',        logo: 'ivd.png',                     url: GIB_LOGIN, recipe: gibRecipe },
  { key: 'internet_vd',   label: 'İnternet Vergi Dairesi',   group: 'Vergi / GİB', provider: 'GIB_IVD',        logo: 'intvd.png',                   url: GIB_LOGIN, recipe: gibRecipe },
  { key: 'ebeyanname',    label: 'e-Beyanname',              group: 'Vergi / GİB', provider: 'GIB_EBEYANNAME', logo: 'YeniEBeyanname.svg',          url: GIB_LOGIN, recipe: gibRecipe },
  { key: 'edefter',       label: 'e-Defter',                 group: 'Muhasebe',    provider: 'GIB_IVD',        logo: 'EDefter.svg',                 url: 'https://uyg.edefter.gov.tr', recipe: gibRecipe },
  { key: 'sgk_ebildirge',   label: 'e-Bildirge',        group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_ebildirge.png',     url: 'https://uyg.sgk.gov.tr/WBildirimNet/amp/loginldap.xhtml', recipe: sgkRecipe },
  { key: 'sgk_ebildirgev2', label: 'e-Bildirge V2',     group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_ebildirgev2.png',   url: 'https://uyg.sgk.gov.tr/eBildirgeV2/', recipe: sgkRecipe },
  { key: 'sgk_isveren',     label: 'İşveren Sistemi',   group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_isveren.png',       url: 'https://uyg.sgk.gov.tr/IsverenSistemi/', recipe: sgkRecipe },
  { key: 'sgk_erapor',      label: 'e-Rapor',           group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_erapor.png',        url: 'https://uyg.sgk.gov.tr/Ws_Rapor/', recipe: sgkRecipe },
  { key: 'sgk_isgiris',     label: 'İşe Giriş / Çıkış', group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'sgk_isgiriscikis.png',  url: 'https://uyg.sgk.gov.tr/SigortaliTescil/amp/loginldap.xhtml', recipe: sgkRecipe },
  { key: 'sgk_ebildirim',   label: 'e-Bildirim',        group: 'SGK', provider: 'SGK_EBILDIRGE', logo: 'Sgk_ebildirim.png',     url: 'https://uyg.sgk.gov.tr/HizmetTakip/', recipe: sgkRecipe },
  { key: 'earsiv',        label: 'E-Arşiv Fatura',           group: 'Muhasebe',    provider: 'GIB_IVD',        logo: '__earsiv__',                  url: 'https://earsivportal.efatura.gov.tr', recipe: gibRecipe },
];

// Arayüze (renderer) gönderilen sade liste — url ve recipe GİTMEZ (güvenlik + gereksiz).
function publicCatalog() {
  return PORTAL_CATALOG.map((p) => ({ key: p.key, label: p.label, group: p.group, provider: p.provider, logo: p.logo }));
}

function findPortal(key) {
  return PORTAL_CATALOG.find((p) => p.key === key) || null;
}

module.exports = { PORTAL_CATALOG, publicCatalog, findPortal };
