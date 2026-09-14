/**
 * Mükellef kartı — form durumu tipi, boş form, tip/tür yardımcıları.
 */
import type React from 'react';

export const TAXPAYER_TYPES = [
  { value: 'TUZEL_KISI', label: 'Tüzel Kişi', detail: 'Şirket veya kurum kaydı' },
  { value: 'GERCEK_KISI', label: 'Gerçek Kişi', detail: 'Şahıs işletmesi veya bireysel kayıt' },
] as const;

export type TaxpayerType = (typeof TAXPAYER_TYPES)[number]['value'];
export type DefterTuru = 'BILANCO' | 'ISLETME';
export type TaxpayerKind = 'FIRMA' | 'SAHIS' | 'BASIT';

export const TAXPAYER_KIND_OPTIONS: Array<{ value: TaxpayerKind; label: string }> = [
  { value: 'FIRMA', label: 'Firma' },
  { value: 'SAHIS', label: 'Şahıs' },
  { value: 'BASIT', label: 'Basit' },
];

export type FormState = {
  type: TaxpayerType;
  companyName: string;
  firstName: string;
  lastName: string;
  taxNumber: string;
  taxOffice: string;
  phones: string[];
  /** REHBER: phones ile aynı sıradaki adlar. Form içinde dizi tutulur; sunucuya
   *  numara->ad HARİTASI gönderilir (dizi sırası arka planda değişebiliyor). */
  telefonAdlari: string[];
  emails: string[];
  address: string;
  notes: string;
  startDate: string;
  endDate: string;
  evrakTeslimGunu: string | number;
  whatsappEvrakTalep: boolean;
  whatsappEvrakGeldi: boolean;
  isEFaturaMukellefi: boolean;
  lucaSlug: string;
  mihsapId: string;
  mihsapDefterTuru: string;
  defterTuru: DefterTuru;
  // v1.37.0 yeni alanlar
  logoUrl: string;
  naceKodu: string;
  faaliyetAciklama: string;
  ticaretSicilNo: string;
  mersisNo: string;
  odaSicilNo: string;
  bagkurSicilNo: string;
  kepAdresi: string;
  webSitesi: string;
  eFaturaEntegrator: string;
};

export function emptyForm(): FormState {
  return {
    type: 'TUZEL_KISI',
    companyName: '',
    firstName: '',
    lastName: '',
    taxNumber: '',
    taxOffice: '',
    phones: ['', '', ''],
    telefonAdlari: ['', '', ''],
    emails: ['', '', ''],
    address: '',
    notes: '',
    startDate: '',
    endDate: '',
    evrakTeslimGunu: '',
    whatsappEvrakTalep: false,
    whatsappEvrakGeldi: false,
    isEFaturaMukellefi: false,
    lucaSlug: '',
    mihsapId: '',
    mihsapDefterTuru: 'BILANCO',
    defterTuru: 'BILANCO',
    logoUrl: '',
    naceKodu: '',
    faaliyetAciklama: '',
    ticaretSicilNo: '',
    mersisNo: '',
    odaSicilNo: '',
    bagkurSicilNo: '',
    kepAdresi: '',
    webSitesi: '',
    eFaturaEntegrator: '',
  };
}

export function taxpayerKindFromForm(form: FormState): TaxpayerKind {
  const marker = `${form.mihsapDefterTuru || ''}`.toLocaleUpperCase('tr-TR');
  if (/BASIT|BASİT|BASIT[_\s-]*USUL/.test(marker)) return 'BASIT';
  return form.type === 'TUZEL_KISI' ? 'FIRMA' : 'SAHIS';
}

export function taxpayerKindLabel(kind: TaxpayerKind): string {
  if (kind === 'FIRMA') return 'FİRMA';
  if (kind === 'SAHIS') return 'ŞAHIS';
  return 'BASİT';
}

export function applyTaxpayerKind(kind: TaxpayerKind, setForm: React.Dispatch<React.SetStateAction<FormState>>) {
  setForm((prev) => {
    if (kind === 'FIRMA') {
      return { ...prev, type: 'TUZEL_KISI', defterTuru: 'BILANCO', mihsapDefterTuru: /BASIT|BASİT|DEFTER[_\s-]*BEYAN/i.test(prev.mihsapDefterTuru || '') ? 'BILANCO' : prev.mihsapDefterTuru || 'BILANCO' };
    }
    if (kind === 'SAHIS') {
      return { ...prev, type: 'GERCEK_KISI', defterTuru: 'BILANCO', mihsapDefterTuru: /BASIT|BASİT|DEFTER[_\s-]*BEYAN/i.test(prev.mihsapDefterTuru || '') ? 'BILANCO' : prev.mihsapDefterTuru || 'BILANCO' };
    }
    return { ...prev, type: 'GERCEK_KISI', defterTuru: 'ISLETME', mihsapDefterTuru: 'BASIT' };
  });
}

