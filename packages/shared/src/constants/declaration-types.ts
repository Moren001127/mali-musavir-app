export enum DeclarationType {
  KDV1 = 'KDV1',           // KDV Beyannamesi (aylık)
  KDV2 = 'KDV2',           // KDV Beyannamesi (3 aylık)
  MUHTASAR = 'MUHTASAR',   // Muhtasar ve Prim Hizmet Beyannamesi
  GELIR_VERGISI = 'GELIR_VERGISI', // Yıllık Gelir Vergisi
  KURUMLAR_VERGISI = 'KURUMLAR_VERGISI', // Kurumlar Vergisi
  GECICI_VERGI = 'GECICI_VERGI',   // Geçici Vergi
  BA_BS = 'BA_BS',          // Form Ba - Bs
  DAMGA_VERGISI = 'DAMGA_VERGISI', // Damga Vergisi
}

export enum DeclarationPeriodicity {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

export const DECLARATION_INFO: Record<DeclarationType, {
  label: string;
  periodicity: DeclarationPeriodicity;
  dueDayOfMonth: number; // Beyanname son günü (ay sonu + gün)
  description: string;
}> = {
  [DeclarationType.KDV1]: {
    label: 'KDV Beyannamesi (Aylık)',
    periodicity: DeclarationPeriodicity.MONTHLY,
    dueDayOfMonth: 28,
    description: 'Aylık katma değer vergisi beyannamesi',
  },
  [DeclarationType.KDV2]: {
    label: 'KDV Beyannamesi (3 Aylık)',
    periodicity: DeclarationPeriodicity.QUARTERLY,
    dueDayOfMonth: 28,
    description: '3 aylık katma değer vergisi beyannamesi',
  },
  [DeclarationType.MUHTASAR]: {
    label: 'Muhtasar ve Prim Hizmet Beyannamesi',
    periodicity: DeclarationPeriodicity.MONTHLY,
    dueDayOfMonth: 26,
    description: 'Stopaj ve SGK prim beyannamesi',
  },
  [DeclarationType.GELIR_VERGISI]: {
    label: 'Yıllık Gelir Vergisi',
    periodicity: DeclarationPeriodicity.YEARLY,
    dueDayOfMonth: 31, // Mart ayının sonu
    description: 'Yıllık gelir vergisi beyannamesi',
  },
  [DeclarationType.KURUMLAR_VERGISI]: {
    label: 'Kurumlar Vergisi',
    periodicity: DeclarationPeriodicity.YEARLY,
    dueDayOfMonth: 30, // Nisan ayının sonu
    description: 'Yıllık kurumlar vergisi beyannamesi',
  },
  [DeclarationType.GECICI_VERGI]: {
    label: 'Geçici Vergi',
    periodicity: DeclarationPeriodicity.QUARTERLY,
    dueDayOfMonth: 17,
    description: 'Üç aylık geçici vergi beyannamesi',
  },
  [DeclarationType.BA_BS]: {
    label: 'Form Ba - Bs',
    periodicity: DeclarationPeriodicity.MONTHLY,
    dueDayOfMonth: 31,
    description: 'Mal ve hizmet alım/satım bildirimi',
  },
  [DeclarationType.DAMGA_VERGISI]: {
    label: 'Damga Vergisi',
    periodicity: DeclarationPeriodicity.MONTHLY,
    dueDayOfMonth: 26,
    description: 'Aylık damga vergisi beyannamesi',
  },
};
