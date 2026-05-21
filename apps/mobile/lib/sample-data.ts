export const advisorStats = [
  { label: 'Bekleyen onay', value: '8', tone: 'amber' as const },
  { label: 'Bugünkü görev', value: '14', tone: 'blue' as const },
  { label: 'Eksik evrak', value: '23', tone: 'rose' as const },
  { label: 'Hazır beyan', value: '6', tone: 'green' as const },
];

export const advisorBriefing = [
  'DENİZ gece kontrolünde 3 kritik işi işaretledi.',
  'KDV hazırlıkta 7 mükellefin evrakı eksik görünüyor.',
  'Mihsap fatura akışında 2 işlem onay bekliyor.',
];

export const pendingApprovals = [
  {
    id: 'demo-1',
    title: 'Petravet için KDV hatırlatması',
    summary: 'Mükellefe WhatsApp üzerinden evrak talebi gönderilecek.',
    riskLevel: 'medium',
    requestedByAgent: 'DENİZ',
  },
  {
    id: 'demo-2',
    title: 'Mihsap alış faturası işleme',
    summary: 'Nisan dönemi 18 alış faturası işlenecek.',
    riskLevel: 'high',
    requestedByAgent: 'KAYRA',
  },
  {
    id: 'demo-3',
    title: 'Beyanname PDF arşivleme',
    summary: 'Hazır beyannameler ilgili mükellef klasörüne taşınacak.',
    riskLevel: 'low',
    requestedByAgent: 'ELİF',
  },
];

export const taxpayerRows = [
  {
    id: 'tp-1',
    name: 'Petravet Veterinerlik',
    taxNumber: '1234567890',
    status: 'KDV evrakı eksik',
    openTasks: 3,
  },
  {
    id: 'tp-2',
    name: 'Selim Motors',
    taxNumber: '9876543210',
    status: 'Beyanname hazır',
    openTasks: 1,
  },
  {
    id: 'tp-3',
    name: 'Dilek Bayageldi',
    taxNumber: '11111111111',
    status: 'Mizan bekleniyor',
    openTasks: 2,
  },
];

export const taxpayerSummary = {
  title: 'Mayıs 2026 dönemi',
  balance: '12.450 TL',
  dueDate: '27 Mayıs',
  documents: [
    { title: 'Nisan KDV Beyannamesi', state: 'Hazır' },
    { title: 'Tahakkuk fişi', state: 'Ödeme bekliyor' },
    { title: 'Banka ekstresi', state: 'Eksik' },
  ],
};

