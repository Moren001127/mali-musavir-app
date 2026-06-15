/**
 * OWNER İŞLEM REGİSTRY'Sİ — botun owner komutuyla GERÇEKTEN çalıştırabildiği portal
 * operasyonları. TEK kaynak: hem bot tarafı (preview doğrulama + yetenek listesi +
 * etki açıklaması) hem OwnerCommandRunnerService (yürütme) bunu kullanır.
 *
 * Yeni bir operasyon eklemek = buraya BİR satır metadata + runner'a BİR yürütme bindingi.
 * Hepsi tek mükellef + tek dönem (payload: { taxpayerId, donem:"YYYY-MM" }).
 *
 * NOT: mesaj gönderen / mükellefe yazan operasyonlar (send_*) BİLİNÇLİ olarak YOK
 * (proaktif-mesaj kuralı). Luca'ya yazan (INVOICE_POST, ACCOUNT_PLAN_PUSH) gibi
 * geri-alınamaz ağır işlemler de kapsam dışı — yalnız çekme/kontrol/üretme.
 */
export interface IslemOperation {
  key: string;
  label: string;            // owner'a gösterilen kısa ad
  impact: (donem: string) => string; // "şunu yapacağım" net açıklama (teyit için)
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const CEYREK: Record<string, string> = { '1': 'Ocak-Mart', '2': 'Nisan-Haziran', '3': 'Temmuz-Eylül', '4': 'Ekim-Aralık' };

/** "2026-Q1" → "2026 1. dönem (Ocak-Mart)", "2026-04" → "Nisan 2026", "2026" → "2026 yıllık". */
export function formatIslemDonem(donem: string): string {
  const q = String(donem || '').match(/^(\d{4})-Q([1-4])$/i);
  if (q) return `${q[1]} ${q[2]}. dönem (${CEYREK[q[2]] || ''})`;
  const m = String(donem || '').match(/^(\d{4})-(\d{2})$/);
  if (m) { const mi = Number(m[2]); if (mi >= 1 && mi <= 12) return `${AYLAR[mi - 1]} ${m[1]}`; }
  if (/^\d{4}$/.test(String(donem || ''))) return `${donem} yıllık`;
  return String(donem || '');
}

export const ISLEM_OPERATIONS: Record<string, IslemOperation> = {
  mihsap_fatura_cek: {
    key: 'mihsap_fatura_cek',
    label: 'Mihsap fatura çekme',
    impact: (d) => `Mihsap'tan ${formatIslemDonem(d)} faturaları (alış+satış) çekilir ve portala işlenir`,
  },
  luca_kdv_cek: {
    key: 'luca_kdv_cek',
    label: 'Luca KDV verisi çekme',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} KDV verisi çekilir (KDV kontrol için)`,
  },
  fis_word_uret: {
    key: 'fis_word_uret',
    label: 'Fiş Word raporu üretme',
    impact: (d) => `${formatIslemDonem(d)} faturalarından fiş Word raporu üretilir (Fiş Yazdırma çıktıları)`,
  },
  edefter_kontrol: {
    key: 'edefter_kontrol',
    label: 'e-Defter kontrol başlatma',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} e-Defter detay fiş listesi çekilip e-Defter ön kontrolü başlatılır`,
  },
  mizan_cek: {
    key: 'mizan_cek',
    label: 'Mizan çekme',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} mizanı çekilir ve portala işlenir`,
  },
  earsiv_alis_cek: {
    key: 'earsiv_alis_cek',
    label: 'e-Arşiv alış faturaları çekme',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} e-Arşiv ALIŞ faturaları çekilir ve portala işlenir`,
  },
  earsiv_satis_cek: {
    key: 'earsiv_satis_cek',
    label: 'e-Arşiv satış faturaları çekme',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} e-Arşiv SATIŞ faturaları çekilir ve portala işlenir`,
  },
  efatura_alis_cek: {
    key: 'efatura_alis_cek',
    label: 'e-Fatura alış faturaları çekme',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} e-Fatura ALIŞ faturaları çekilir ve portala işlenir`,
  },
  efatura_satis_cek: {
    key: 'efatura_satis_cek',
    label: 'e-Fatura satış faturaları çekme',
    impact: (d) => `Luca'dan ${formatIslemDonem(d)} e-Fatura SATIŞ faturaları çekilir ve portala işlenir`,
  },
  sgk_hizmet_listesi_cek: {
    key: 'sgk_hizmet_listesi_cek',
    label: 'SGK hizmet listesi çekme',
    impact: (d) => `SGK e-Bildirge'den ${formatIslemDonem(d)} hizmet listesi çekilir (mükellefin SGK portal şifresi kayıtlı olmalı)`,
  },
  sgk_tahakkuk_cek: {
    key: 'sgk_tahakkuk_cek',
    label: 'SGK tahakkuk fişi çekme',
    impact: (d) => `SGK e-Bildirge'den ${formatIslemDonem(d)} tahakkuk (prim) fişi çekilir (SGK portal şifresi gerekli)`,
  },
};

export const ISLEM_ACTION_KEYS = Object.keys(ISLEM_OPERATIONS);

export function isIslemAction(action: string): boolean {
  return !!ISLEM_OPERATIONS[String(action || '')];
}

/** Botun "neler yapabilirim" için kullanacağı kısa liste. */
export function islemCapabilityList(): Array<{ action: string; aciklama: string }> {
  return ISLEM_ACTION_KEYS.map((k) => ({ action: k, aciklama: ISLEM_OPERATIONS[k].label }));
}
