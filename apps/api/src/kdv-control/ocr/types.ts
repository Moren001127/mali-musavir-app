export interface KdvBreakdownItem {
  oran: number;
  matrah?: number | null;
  tutar: number;
}

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  kdvTevkifat?: string | null;
  totalTutari: string | null;
  satici?: string | null;
  saticiVkn?: string | null;
  belgeTipi?: string | null;
  kdvBreakdown?: KdvBreakdownItem[] | null;
  kategori?: string | null;
  imageHash?: string;
  confidence: number;
  fieldConfidence: {
    belgeNo: number | null;
    date: number | null;
    kdvTutari: number | null;
  };
  validationScore?: number | null;
  validationIssues?: string[];
  engine: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

export interface ExtractOcrOptions {
  forceClaude?: boolean;
}
