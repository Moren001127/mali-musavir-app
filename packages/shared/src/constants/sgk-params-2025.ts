export const SGK_PARAMS_2025 = {
  // Asgari ücret (brüt) - 2025
  MIN_WAGE_GROSS: 22104.67,
  // SGK prime esas kazanç tavan - 2025 (asgari ücretin 7.5 katı)
  SGK_CEILING: 166085.03,
  // SGK prim oranları
  SGK_WORKER_RATE: 0.14,      // İşçi payı: %14
  SGK_EMPLOYER_RATE: 0.155,   // İşveren payı: %15.5
  // İşsizlik sigortası oranları
  UNEMP_WORKER_RATE: 0.01,    // İşçi: %1
  UNEMP_EMPLOYER_RATE: 0.02,  // İşveren: %2
  // Damga vergisi oranı (ücret üzerinden)
  STAMP_TAX_RATE: 0.00759,
  // Asgari geçim indirimi katsayısı
  AGI_COEFF: 0.5,
  // Gelir vergisi dilimleri 2025 (yıllık)
  INCOME_TAX_BRACKETS: [
    { upTo: 110000, rate: 0.15 },
    { upTo: 230000, rate: 0.20 },
    { upTo: 580000, rate: 0.27 },
    { upTo: 3000000, rate: 0.35 },
    { upTo: Infinity, rate: 0.40 },
  ],
} as const;
