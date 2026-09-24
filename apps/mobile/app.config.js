/**
 * app.config.js — BELGE TARAYICI AYRI UYGULAMA (2026-09-23, Muzaffer Bey).
 *
 * Sorun: `tarayici` profili de MOREN Müşavir ile AYNI paket adıyla (com.moren.mobil) derleniyordu;
 *   telefonda Müşavir kuruluysa Android "uygulama yüklenmedi" diyor, kurulsa bile adı/ikonu aynı
 *   göründüğü için personel karıştırıyordu. İki uygulama yan yana dursun:
 *     EXPO_PUBLIC_MOREN_APP=tara → paket/bundle com.moren.tarayici, ad "MOREN Belge Tarayıcı".
 *   Bayrak yoksa app.json aynen geçerli (MOREN Müşavir) — mevcut derlemeler etkilenmez.
 */
// KANAL AYRI OLMALI (2026-09-24): eas.json'da `tarayici` profili "tarayici" kanalını kullanır.
//   Eskiden MOREN Müşavir ile aynı "preview" kanalındaydı; expo-updates açılışta o kanalın son JS
//   paketini indirdiği için Belge Tarayıcı bazen Müşavir paketini çekip PORTAL ekranını açıyordu
//   (o pakette EXPO_PUBLIC_MOREN_APP bayrağı yok). Kanalı bir daha "preview" yapma.
const TARAYICI = process.env.EXPO_PUBLIC_MOREN_APP === 'tara';

module.exports = ({ config }) => {
  if (!TARAYICI) return config;
  return {
    ...config,
    name: 'MOREN Belge Tarayıcı',
    // slug + extra.eas.projectId AYNI kalır (aynı EAS projesi, aynı derleme geçmişi).
    scheme: 'morentara',
    android: {
      ...config.android,
      package: 'com.moren.tarayici',
      // Müşavir uygulamasından bakışta ayrılsın: ikon zemini marka mavisi (portal beyaz teması).
      adaptiveIcon: { ...(config.android && config.android.adaptiveIcon), backgroundColor: '#4263eb' },
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.moren.tarayici',
    },
  };
};
