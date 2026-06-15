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

export const ISLEM_OPERATIONS: Record<string, IslemOperation> = {
  mihsap_fatura_cek: {
    key: 'mihsap_fatura_cek',
    label: 'Mihsap fatura çekme',
    impact: (d) => `Mihsap'tan ${d} dönemi faturaları (alış+satış) çekilir ve portala işlenir`,
  },
  luca_kdv_cek: {
    key: 'luca_kdv_cek',
    label: 'Luca KDV verisi çekme',
    impact: (d) => `Luca'dan ${d} dönemi KDV verisi çekilir (KDV kontrol için)`,
  },
  fis_word_uret: {
    key: 'fis_word_uret',
    label: 'Fiş Word raporu üretme',
    impact: (d) => `${d} dönemi faturalarından fiş Word raporu üretilir (Fiş Yazdırma çıktıları)`,
  },
  edefter_kontrol: {
    key: 'edefter_kontrol',
    label: 'e-Defter kontrol başlatma',
    impact: (d) => `Luca'dan ${d} dönemi e-Defter detay fiş listesi çekilip e-Defter ön kontrolü başlatılır`,
  },
  mizan_cek: {
    key: 'mizan_cek',
    label: 'Mizan çekme',
    impact: (d) => `Luca'dan ${d} dönemi mizanı çekilir ve portala işlenir`,
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
