/**
 * Kısayollar & Sorgulamalar — devlet portalları + sık sorgular.
 * Şimdilik yalnız dış bağlantı; `sorguTuru` ileride gerçek sorgulara bağlanmak için ayrılmıştır (kullanılmıyor).
 */
import type React from 'react';
import { FileCheck, FileText, Landmark, Shield } from 'lucide-react';
import { STEEL } from './tema';

// ============================================================
// KISAYOL GİRİŞLERİ — devlet portalları + sık sorgular (açılır panelde)
// ============================================================
export type Kisayol = { id: string; label: string; url: string; renk: string; kisaltma: string; logo?: string; /** İleride gerçek sorguya bağlanacak (şimdilik kullanılmıyor) */ sorguTuru?: string };

export type KisayolGrup = {
  id: string;
  baslik: string;
  aciklama: string;
  renk: string;
  ikon: React.ElementType;
  items: Kisayol[];
};

// Sorguların çoğunun yaşadığı portallar — gerçek tanımlar (deep-link/otomasyon) sonra kesinleşecek
export const IVD_URL = 'https://ivd.gib.gov.tr';
export const SGK_URL = 'https://uyg.sgk.gov.tr/IsverenSistemi';
export const EARSIV_URL = 'https://earsivportal.efatura.gov.tr';

export const KISAYOL_GRUPLARI: KisayolGrup[] = [
  {
    id: 'portallar',
    baslik: 'Devlet Portalları',
    aciklama: 'Resmî portallara tek tıkla giriş',
    renk: STEEL,
    ikon: Landmark,
    items: [
      { id: 'dijital_vd',     label: 'Dijital Vergi Dairesi',  url: 'https://dijital.gib.gov.tr',           renk: '#2f7ed8', kisaltma: 'VD',  logo: '/portal-logos/dvdLogo.png' },
      { id: 'gib_ivd',        label: 'GİB İnteraktif V.D.',    url: IVD_URL,                                renk: '#c8102e', kisaltma: 'GİB', logo: '/portal-logos/ivdlogo.png' },
      { id: 'ebeyanname',     label: 'E-Beyanname',            url: 'https://ebeyanname.gib.gov.tr',        renk: '#28a745', kisaltma: 'eB',  logo: '/portal-logos/ebeyanlogo.jpg' },
      { id: 'edefter',        label: 'e-Defter',               url: 'https://uyg.edefter.gov.tr',           renk: '#7a52d0', kisaltma: 'eD',  logo: '/portal-logos/edefterlogo.jpg' },
      { id: 'earsiv',         label: 'E-Arşiv Portal',         url: EARSIV_URL,                             renk: '#e0603a', kisaltma: 'eA',  logo: '/portal-logos/earsivportal.png' },
      { id: 'efatura',        label: 'E-Fatura Portal',        url: 'https://portal.efatura.gov.tr',        renk: '#e0603a', kisaltma: 'eF' },
      { id: 'mersis',         label: 'Mersis',                 url: 'https://mersis.ticaret.gov.tr',        renk: '#2f7ed8', kisaltma: 'M' },
      { id: 'tobb',           label: 'TOBB Bilgi Merkezi',     url: 'https://bilgimerkezi.tobb.org.tr',     renk: '#fd7e14', kisaltma: 'TB',  logo: '/portal-logos/tobblogo.png' },
      { id: 'sgk_ebildirge',  label: 'SGK E-Bildirge',         url: SGK_URL,                                renk: '#1d70b8', kisaltma: 'SGK', logo: '/portal-logos/ebildirgeV1logo.png' },
      { id: 'sgk_ebildirge2', label: 'SGK E-Bildirge V2',      url: SGK_URL,                                renk: '#1d70b8', kisaltma: 'V2',  logo: '/portal-logos/ebildirgeV2logo.png' },
      { id: 'sgk_isveren',    label: 'SGK İşveren Sistemi',    url: SGK_URL,                                renk: '#1d70b8', kisaltma: 'İS',  logo: '/portal-logos/isverenlogo.png' },
      { id: 'sgk_erapor',     label: 'SGK E-Rapor',            url: 'https://uyg.sgk.gov.tr/eRaporIsveren', renk: '#1d70b8', kisaltma: 'ER',  logo: '/portal-logos/evizitelogo.png' },
      { id: 'sgk_isegiris',   label: 'SGK İşe Giriş/Çıkış',    url: 'https://uyg.sgk.gov.tr/SgkIsgs',       renk: '#1d70b8', kisaltma: 'İG',  logo: '/portal-logos/isgiriscikislogo.png' },
      { id: 'sgk_ebildirim',  label: 'SGK E-Bildirim',         url: 'https://uyg.sgk.gov.tr',               renk: '#1d70b8', kisaltma: 'EB',  logo: '/portal-logos/ebildirimlogo.png' },
      { id: 'edevlet',        label: 'e-Devlet (Türkiye.gov)', url: 'https://www.turkiye.gov.tr',           renk: '#c8102e', kisaltma: 'eD',  logo: '/portal-logos/Edevlet.png' },
    ],
  },
  {
    id: 'gib_sorgu',
    baslik: 'GİB Sorgulamaları',
    aciklama: 'Gelir İdaresi sorgu ve dilekçeleri',
    renk: '#d64550',
    ikon: FileText,
    items: [
      { id: 'q_arac',        label: 'Araç Bilgileri',              url: IVD_URL, renk: '#d64550', kisaltma: 'AR' },
      { id: 'q_ehaciz',      label: 'EHaciz',                      url: IVD_URL, renk: '#d64550', kisaltma: 'EH' },
      { id: 'q_eyoklama',    label: 'EYoklama',                    url: IVD_URL, renk: '#d64550', kisaltma: 'EY' },
      { id: 'q_vlevha',      label: 'Güncel Vergi Levhası',        url: IVD_URL, renk: '#d64550', kisaltma: 'VL' },
      { id: 'q_gumruk',      label: 'Gümrük Çıkış Beyannamesi',    url: IVD_URL, renk: '#d64550', kisaltma: 'GÇ' },
      { id: 'q_islenemeyen', label: 'İşlenemeyen Ödemeler',        url: IVD_URL, renk: '#d64550', kisaltma: 'İÖ' },
      { id: 'q_mukyazi',     label: 'Mükellefiyet Yazısı',         url: IVD_URL, renk: '#d64550', kisaltma: 'MY' },
      { id: 'q_dilekce',     label: 'Önceki Talep Dilekçeleri',    url: IVD_URL, renk: '#d64550', kisaltma: 'DL' },
      { id: 'q_pos',         label: 'POS Sorgulama',               url: IVD_URL, renk: '#d64550', kisaltma: 'POS' },
      { id: 'q_todeb',       label: 'Elektronik POS (TÖDEB)',      url: IVD_URL, renk: '#d64550', kisaltma: 'TÖ' },
      { id: 'q_sube',        label: 'Şube Bilgisi Sorgulama',      url: IVD_URL, renk: '#d64550', kisaltma: 'ŞB' },
      { id: 'q_tahsilat',    label: 'Tahsilat Bilgisi Sorgulama',  url: IVD_URL, renk: '#d64550', kisaltma: 'TH' },
      { id: 'q_alindilar',   label: 'Ödemelerim ve Alındılarım',   url: IVD_URL, renk: '#d64550', kisaltma: 'ÖA' },
      { id: 'q_vborcu',      label: 'Vergi Borcu Sorgulama',       url: IVD_URL, renk: '#d64550', kisaltma: 'VB' },
      { id: 'q_vonay',       label: 'Vergi Levhası Onayla',        url: IVD_URL, renk: '#d64550', kisaltma: 'VO' },
      { id: 'q_borcyoktur',  label: 'Vergi Borcu Yoktur Yazısı',   url: IVD_URL, renk: '#d64550', kisaltma: 'BY' },
      { id: 'q_yapvbs',      label: 'Yapılandırılmış V.B.S.',      url: IVD_URL, renk: '#d64550', kisaltma: 'YP' },
      { id: 'q_7256vbs',     label: '7256 Yapılandırılmış V.B.S.', url: IVD_URL, renk: '#d64550', kisaltma: '56' },
      { id: 'q_7326vbs',     label: '7326 Yapılandırılmış V.B.S.', url: IVD_URL, renk: '#d64550', kisaltma: '26' },
      { id: 'q_7440vbs',     label: '7440 Yapılandırılmış V.B.S.', url: IVD_URL, renk: '#d64550', kisaltma: '40' },
      { id: 'q_esm',         label: 'E-SM Makbuzu Sorgulama',      url: IVD_URL, renk: '#d64550', kisaltma: 'SM' },
      { id: 'q_muhsgkmuaf',  label: 'MUHSGK Muafiyet Dilekçe',     url: IVD_URL, renk: '#d64550', kisaltma: 'MU' },
      { id: 'q_uyumindirim', label: 'Vergiye Uyumda İndirim',      url: IVD_URL, renk: '#d64550', kisaltma: 'Uİ' },
      { id: 'q_okccihaz',    label: 'OKC Cihaz Listesi',           url: IVD_URL, renk: '#d64550', kisaltma: 'OK' },
      { id: 'q_okcsatis',    label: 'OKC Satış Raporları',         url: IVD_URL, renk: '#d64550', kisaltma: 'OS' },
      { id: 'q_ithalkdv',    label: 'İthalde Ödenen KDV',          url: IVD_URL, renk: '#d64550', kisaltma: 'İK' },
      { id: 'q_kesinti',     label: 'Kesinti Sorgulama',           url: IVD_URL, renk: '#d64550', kisaltma: 'KS' },
      { id: 'q_nace',        label: 'NACE Kodu Sorgulama',         url: IVD_URL, renk: '#d64550', kisaltma: 'NC' },
      { id: 'q_iban',        label: 'Banka (IBAN) Sorgulama',      url: IVD_URL, renk: '#d64550', kisaltma: 'IB' },
    ],
  },
  {
    id: 'sgk_sorgu',
    baslik: 'SGK Sorgulamaları',
    aciklama: 'Sosyal Güvenlik sorgu ve yapılandırmaları',
    renk: '#2f7ed8',
    ikon: Shield,
    items: [
      { id: 's_tesvik',   label: 'Potansiyel Teşvik Sorgula', url: SGK_URL, renk: '#2f7ed8', kisaltma: 'TŞ' },
      { id: 's_borcyok',  label: 'SGK Borcu Yoktur Yazısı',   url: SGK_URL, renk: '#2f7ed8', kisaltma: 'BY' },
      { id: 's_emanet',   label: 'Emanetteki Tahsilatlar',    url: SGK_URL, renk: '#2f7ed8', kisaltma: 'EM' },
      { id: 's_donem',    label: 'SGK Dönem Borcu',           url: SGK_URL, renk: '#2f7ed8', kisaltma: 'DB' },
      { id: 's_odeme',    label: 'SGK Ödeme Sorgula',         url: SGK_URL, renk: '#2f7ed8', kisaltma: 'ÖD' },
      { id: 's_6661',     label: '6661 Asgari Ücret Desteği', url: SGK_URL, renk: '#2f7ed8', kisaltma: '66' },
      { id: 's_7252',     label: '7252 K.Ç.Ö. Sorgulama',     url: SGK_URL, renk: '#2f7ed8', kisaltma: '52' },
      { id: 's_7256',     label: '7256 SGK Yapılandırılmış',  url: SGK_URL, renk: '#2f7ed8', kisaltma: '56' },
      { id: 's_7326',     label: '7326 SGK Yapılandırılmış',  url: SGK_URL, renk: '#2f7ed8', kisaltma: '26' },
      { id: 's_7440',     label: '7440 SGK Yapılandırılmış',  url: SGK_URL, renk: '#2f7ed8', kisaltma: '40' },
      { id: 's_personel', label: 'Güncel Personel Sorgulama', url: SGK_URL, renk: '#2f7ed8', kisaltma: 'PR' },
    ],
  },
  {
    id: 'earsiv_sorgu',
    baslik: 'E-Arşiv / E-Fatura',
    aciklama: 'Fatura ve makbuz işlemleri',
    renk: '#e0603a',
    ikon: FileCheck,
    items: [
      { id: 'e_gelenarsiv', label: 'Gelen E-Arşiv Fatura',      url: EARSIV_URL,                      renk: '#e0603a', kisaltma: 'GA' },
      { id: 'e_kesilen',    label: 'Kesilen E-Arşiv Fatura',    url: EARSIV_URL,                      renk: '#e0603a', kisaltma: 'KA' },
      { id: 'e_efatura',    label: 'E-Fatura İşlemleri',        url: 'https://portal.efatura.gov.tr', renk: '#e0603a', kisaltma: 'EF' },
      { id: 'e_tevkifat',   label: 'Gelen Tevkifatlı E-Fatura', url: 'https://portal.efatura.gov.tr', renk: '#e0603a', kisaltma: 'TV' },
      { id: 'e_esm',        label: 'Gelen E-SM Makbuzu',        url: EARSIV_URL,                      renk: '#e0603a', kisaltma: 'SM' },
    ],
  },
];

export function kisayolFold(s: string) {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

