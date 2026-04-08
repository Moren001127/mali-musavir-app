export enum UserRole {
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  READONLY = 'READONLY',
}

export enum TaxpayerType {
  GERCEK_KISI = 'GERCEK_KISI',   // Gerçek kişi
  TUZEL_KISI = 'TUZEL_KISI',     // Tüzel kişi (şirket)
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
}

export enum DeclarationStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SUBMITTED = 'SUBMITTED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum DocumentCategory {
  SOZLESME = 'SOZLESME',
  FATURA = 'FATURA',
  BEYANNAME = 'BEYANNAME',
  EVRAK = 'EVRAK',
  DIGER = 'DIGER',
}
