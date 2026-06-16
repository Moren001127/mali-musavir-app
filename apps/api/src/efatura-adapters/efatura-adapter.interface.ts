/** Ham entegratör fatura kaydı — DB'ye yazılmadan önceki normalize form */
export interface RawEFatura {
  uuid: string;
  ettn?: string | null;
  senderVkn?: string | null;
  senderTitle?: string | null;
  receiverVkn?: string | null;
  faturaNo?: string | null;
  faturaDate?: Date | null;
  matrah?: number | null;
  kdv?: number | null;
  toplam?: number | null;
  paraBirimi?: string;
  direction: 'IN' | 'OUT';
  invoiceProfile?: string | null;
  ublXmlRaw?: string | null; // UBL-TR XML string (varsa)
  rawJson?: Record<string, any> | null;
}

/** Entegratör kimlik bilgileri (IntegrationConnection.config'ten) */
export interface EFaturaCredentials {
  username?: string | null;
  password?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  baseUrl?: string | null;
  firmaNo?: string | null; // Paraşüt için
  [key: string]: string | null | undefined;
}

/** Delta çekim durumu — son başarılı sync'in izleri */
export interface DeltaState {
  lastSyncAt?: Date | null; // Son başarılı sync zamanı
  lastUuid?: string | null; // Son çekilen faturanın UUID'si (varsa)
  lastCdate?: string | null; // CDATE cursor (İzibiz/EDM için)
  sessionId?: string | null; // Aktif SOAP SESSION_ID (8 saat geçerli)
  sessionExpiresAt?: Date | null; // SESSION_ID expire zamanı
}

/** Adapter temel interface */
export interface EFaturaAdapter {
  readonly provider: string;

  /**
   * Gelen (ve isteğe bağlı giden) faturaları çek.
   * direction='IN' varsayılan.
   * Delta sync için state parametresi — önceki sync izleri.
   * Döner: faturalar + güncellenen state
   */
  fetchInvoices(
    credentials: EFaturaCredentials,
    opts: {
      direction?: 'IN' | 'OUT';
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      deltaState?: DeltaState;
    },
  ): Promise<{
    invoices: RawEFatura[];
    nextState: DeltaState;
    hasMore: boolean;
  }>;

  /**
   * Faturaları "aktarıldı" olarak işaretle.
   * Delta sync'in kalbi — bu çağrılmadan aynı faturalar tekrar gelir.
   */
  markAsTransferred(
    credentials: EFaturaCredentials,
    uuids: string[],
    deltaState?: DeltaState,
  ): Promise<void>;

  /**
   * Tek fatura için UBL-TR XML içeriğini indir.
   * fetchInvoices'ta XML zaten geldiyse bu çağrılmaz.
   */
  downloadXml?(
    credentials: EFaturaCredentials,
    uuid: string,
    deltaState?: DeltaState,
  ): Promise<string | null>;
}
