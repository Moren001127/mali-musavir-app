export const TAX_RATES_2025 = {
  // KDV oranları
  KDV: {
    STANDARD: 0.20,   // Genel oran %20
    REDUCED_10: 0.10, // İndirimli %10
    REDUCED_1: 0.01,  // İndirimli %1
    EXEMPT: 0.00,     // İstisna
  },
  // Kurumlar vergisi oranı
  CORPORATE_TAX: 0.25,
  // Gelir vergisi stopaj oranları (işyeri kira vs.)
  WITHHOLDING: {
    RENT: 0.20,
    PROFESSIONAL_FEE: 0.17,
    DIVIDEND: 0.10,
  },
  // Vergi Usul Kanunu - yasal faiz oranı
  VUK_LATE_FEE_MONTHLY: 0.04,
} as const;
