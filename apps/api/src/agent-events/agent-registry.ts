export type AgentMode = 'background' | 'supervised' | 'approval_first' | 'service' | 'report';

export type AgentQueue =
  | 'agent-command'
  | 'luca-fetch-job'
  | 'portal-automation-job'
  | 'mihsap-service'
  | 'hgs-agent'
  | 'service'
  | 'report-only';

export type AgentStatusStage = 'active' | 'alias_ready' | 'planned' | 'service' | 'report_only';

export interface AgentDefinition {
  id: string;
  title: string;
  mode: AgentMode;
  queue: AgentQueue;
  stage: AgentStatusStage;
  modules: string[];
  actions?: string[];
  lucaJobTips?: string[];
  legacyRunner?: 'mihsap' | 'luca' | 'hgs';
  description: string;
}

export const MIHSAP_FATURA_ACTIONS = [
  'isle_alis',
  'isle_satis',
  'isle_alis_isletme',
  'isle_satis_isletme',
] as const;

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: 'agent-core-orchestrator',
    title: 'Agent Core Orchestrator',
    mode: 'service',
    queue: 'service',
    stage: 'service',
    modules: ['agent-events', 'ajanlar'],
    description: 'Komut, durum, log, claim, iptal ve hata ozetlerini yoneten ortak altyapi.',
  },
  {
    id: 'mihsap-fatura-isleme-agent',
    title: 'Mihsap Fatura Isleme Agent',
    mode: 'supervised',
    queue: 'agent-command',
    stage: 'alias_ready',
    modules: ['ajanlar/mihsap'],
    actions: [...MIHSAP_FATURA_ACTIONS],
    legacyRunner: 'mihsap',
    description: 'Mihsap tarayicisini kullanarak alis/satis faturalarini AI karariyla isler.',
  },
  {
    id: 'mihsap-invoice-sync-agent',
    title: 'Mihsap Islenen Fatura Sync Agent',
    mode: 'background',
    queue: 'mihsap-service',
    stage: 'active',
    modules: ['faturalar'],
    description: 'Mihsapta islenmis faturalarin metadata ve gorsellerini portala ceker.',
  },
  {
    id: 'luca-ebelge-agent',
    title: 'Luca E-Belge Agent',
    mode: 'background',
    queue: 'luca-fetch-job',
    stage: 'active',
    modules: ['e-arsiv', 'e-fatura'],
    lucaJobTips: ['EARSIV_SATIS', 'EARSIV_ALIS', 'EFATURA_SATIS', 'EFATURA_ALIS'],
    legacyRunner: 'luca',
    description: 'Luca uzerinden e-Fatura/e-Arsiv arsivlerini indirir ve portala yukler.',
  },
  {
    id: 'luca-mizan-agent',
    title: 'Luca Mizan Agent',
    mode: 'background',
    queue: 'luca-fetch-job',
    stage: 'active',
    modules: ['mizan', 'bilanco', 'gelir-tablosu'],
    lucaJobTips: ['MIZAN', 'KDV_MIZAN'],
    legacyRunner: 'luca',
    description: 'Mizani Luca uzerinden ceker; bilanco ve gelir tablosu bu veriden uretilir.',
  },
  {
    id: 'luca-kdv-agent',
    title: 'Luca KDV Agent',
    mode: 'background',
    queue: 'luca-fetch-job',
    stage: 'active',
    modules: ['kdv-control', 'kdv-beyanname'],
    lucaJobTips: ['KDV_191', 'KDV_391'],
    legacyRunner: 'luca',
    description: 'KDV kontrol ve beyan on hazirligi icin Luca verilerini toplar.',
  },
  {
    id: 'luca-isletme-agent',
    title: 'Luca Isletme Agent',
    mode: 'background',
    queue: 'luca-fetch-job',
    stage: 'active',
    modules: ['isletme-hesap-ozeti'],
    lucaJobTips: ['IHO_FETCH', 'ISLETME_GELIR', 'ISLETME_GIDER'],
    legacyRunner: 'luca',
    description: 'Isletme hesap ozeti ve isletme defteri gelir/gider verilerini Luca uzerinden ceker.',
  },
  {
    id: 'hgs-agent',
    title: 'HGS Agent',
    mode: 'background',
    queue: 'hgs-agent',
    stage: 'active',
    modules: ['galeri/hgs'],
    actions: ['toplu-sorgu'],
    legacyRunner: 'hgs',
    description: 'HGS ihlal sorgularini ortak AgentCommand altyapisiyla calistirir.',
  },
  {
    id: 'beyanname-collector-agent',
    title: 'Beyanname Collector Agent',
    mode: 'background',
    queue: 'portal-automation-job',
    stage: 'active',
    modules: ['beyannameler'],
    description: 'e-Beyanname uzerinden verilen beyanname, tahakkuk ve onay dosyalarini otomatik indirir.',
  },
  {
    id: 'etebligat-watch-agent',
    title: 'E-Tebligat Watch Agent',
    mode: 'approval_first',
    queue: 'portal-automation-job',
    stage: 'active',
    modules: ['ajanlar/tebligat'],
    description: 'Mukellef GIB hesaplarinda e-Tebligat kutusunu kontrol eder ve yeni belgeleri indirir.',
  },
  {
    id: 'sgk-portal-agent',
    title: 'SGK Portal Agent',
    mode: 'background',
    queue: 'portal-automation-job',
    stage: 'active',
    modules: ['ajanlar/sgk'],
    description: 'SGK hizmet listesi, tahakkuk, ise giris/cikis ve isgoremezlik sorgularini calistirir.',
  },
  {
    id: 'finansal-rapor-agent',
    title: 'Finansal Rapor Agent',
    mode: 'report',
    queue: 'report-only',
    stage: 'report_only',
    modules: ['bilanco', 'gelir-tablosu'],
    description: 'Ayri veri cekmez; mizan verisinden rapor ve analiz uretir.',
  },
];

const MIHSAP_COMMAND_GROUP = ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent'];

export function getAgentRegistry() {
  return AGENT_DEFINITIONS;
}

export function isMihsapFaturaCommandAgent(agent?: string | null) {
  return !!agent && MIHSAP_COMMAND_GROUP.includes(agent);
}

export function commandClaimAgentsForRunner(agent?: string | null): string[] | undefined {
  if (!agent) return undefined;
  if (isMihsapFaturaCommandAgent(agent)) return MIHSAP_COMMAND_GROUP;
  if (agent === 'hgs') return ['hgs'];

  // Luca islerinde mevcut guvenli yol AgentCommand degil LucaFetchJob kuyrugu.
  // Bu nedenle luca-* alias'lari simdilik command claim'e dahil edilmiyor.
  if (agent === 'luca') return ['luca'];
  return [agent];
}

export function commandListAgentsForFilter(agent?: string | null): string[] | undefined {
  if (!agent) return undefined;
  if (isMihsapFaturaCommandAgent(agent)) return MIHSAP_COMMAND_GROUP;
  return [agent];
}
