/**
 * Sistem Kuralları — Tüm mükelleflere otomatik uygulanan zorunlu kontroller.
 *
 * Mükellef profili (AgentRule.profile) içinde override edilebilir; ama varsayılan
 * olarak burada tanımlanan kurallar AI prompt'una ve extension ön-doğrulamasına
 * iletilir.
 *
 * Henüz uygulamada KULLANILMIYOR — Mükellef Profil sayfası geldiğinde
 * extension/AI tarafından okunmaya başlanacak. Şimdilik referans + kayıt amaçlı.
 */

export const SISTEM_KURALLARI = {
  /**
   * Tevkifat sınırı: Tevkifata tabi içerikli faturalar KDV dahil 12.000 TL
   * ve üzeri ise mutlaka tevkifatlı düzenlenmelidir. Tevkifatsız ise hata.
   */
  tevkifat: {
    aktif: true,
    kdvDahilEsik: 12_000, // TL
    tetikleyiciIcerikler: [
      'Nakliye',
      'Servis Taşımacılığı',
      'Demir',
      // Kullanıcı yeni içerik söyledikçe buraya eklenecek.
    ],
    uyari: 'Tevkifatlı fatura sınırı: KDV dahil 12.000 TL aşıldı, tevkifatsız düzenlenemez.',
  },

  /**
   * Kasa limiti: Tahsilat/Ödeme hesabı 100.x (kasa) seçili faturalarda
   * tutar 30.000 TL'yi aşamaz. Aşıyorsa banka/POS kullanılmalı.
   */
  kasaLimit: {
    aktif: true,
    hesapPrefix: '100', // 100.x.x = kasa hesapları
    maxTutar: 30_000, // TL
    uyari: 'Kasa hesabından 30.000 TL üzeri ödeme yapılamaz; banka veya POS kullanın.',
  },
} as const;

export type SistemKurallari = typeof SISTEM_KURALLARI;
