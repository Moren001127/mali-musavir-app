/**
 * VERGİ TAKVİMİ TOHUMU — saf hesap (2026-09-14, Görevler & Notlar "Mali Takvim" katmanı).
 *
 * `tax_calendar` tablosu canlıda BOŞTU; Görevler ekranının Mali Takvim katmanı, "takvimden görev aç" ve Moren AI'ın
 * vergi takvimi aracı bu tablodan okur. Kayıtlar tek kaynak `calculateBeyannameDeadline` kurallarından üretilir.
 *
 * Kapsam (ofisin GERÇEKTEN verdiği beyanlar — beyan_kayitlari tablosundan teyit, 2026-09-14):
 *   KDV1 aylık (28) · MUHSGK aylık (26) + 3 aylık (çeyrek sonunu izleyen ayın 26'sı) · GGECICI / KGECICI 3 aylık
 *   (çeyrek sonunu izleyen 2. ayın 17'si; 4. dönem dahil — 2025/Q4 Şubat'ta verildi) · GELIR (31 Mart) · KURUMLAR (30 Nisan)
 * Dışarıda: KDV2, DAMGA, POSET, OTV… — canlı beyan tarihleri koddaki kuralla uyuşmuyor / tek kayıt; yanlış tarih tohumlamaktansa
 * elle eklenir. Hafta sonu / resmî tatil kayması uygulanmaz (GİB ilk iş gününe uzatır; görev açarken vade elle değiştirilebilir).
 */
import { calculateBeyannameDeadline } from './beyanname-deadline.util';

export interface TakvimKaydi {
  declarationType: string;
  periodYear: number;
  periodMonth: number | null;
  periodQuarter: number | null;
  dueDate: Date;
  description: string;
}

const AD: Record<string, string> = {
  KDV1: 'KDV Beyannamesi',
  MUHSGK: 'Muhtasar ve Prim Hizmet Beyannamesi',
  MUHSGK_3AY: 'Muhtasar ve Prim Hizmet Beyannamesi (3 aylık)',
  GGECICI: 'Gelir Geçici Vergi Beyannamesi',
  KGECICI: 'Kurum Geçici Vergi Beyannamesi',
  GELIR: 'Yıllık Gelir Vergisi Beyannamesi',
  KURUMLAR: 'Kurumlar Vergisi Beyannamesi',
};

/** Tekilleştirme anahtarı: tip + yıl + ay/çeyrek (DB'de unique kısıt yok; tohum bu anahtarla karşılaştırır). */
export function takvimAnahtari(k: { declarationType: string; periodYear: number; periodMonth?: number | null; periodQuarter?: number | null }): string {
  return `${k.declarationType}|${k.periodYear}|${k.periodMonth || 0}|${k.periodQuarter || 0}`;
}

const ayDonem = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

/** [baslangic, bitis] aralığına düşen son günler (dueDate'e göre süzülür). */
export function vergiTakvimiKayitlari(baslangic: Date, bitis: Date): TakvimKaydi[] {
  const cikti: TakvimKaydi[] = [];
  const ekle = (k: Omit<TakvimKaydi, 'dueDate'> & { dueDate: Date | null }) => {
    if (!k.dueDate || Number.isNaN(k.dueDate.getTime())) return;
    if (k.dueDate < baslangic || k.dueDate > bitis) return;
    cikti.push(k as TakvimKaydi);
  };
  const yilBas = baslangic.getFullYear() - 1;
  const yilSon = bitis.getFullYear() + 1;
  for (let y = yilBas; y <= yilSon; y++) {
    // Aylık: dönem M → son gün izleyen ay
    for (let m = 1; m <= 12; m++) {
      ekle({ declarationType: 'KDV1', periodYear: y, periodMonth: m, periodQuarter: null, dueDate: calculateBeyannameDeadline('KDV1', ayDonem(y, m)), description: AD.KDV1 });
      ekle({ declarationType: 'MUHSGK', periodYear: y, periodMonth: m, periodQuarter: null, dueDate: calculateBeyannameDeadline('MUHSGK', ayDonem(y, m)), description: AD.MUHSGK });
    }
    // 3 aylık: çeyrek Q → çeyreğin son ayı = 3Q; MUHSGK izleyen ayın 26'sı, geçici vergi izleyen 2. ayın 17'si
    for (let q = 1; q <= 4; q++) {
      const sonAy = q * 3;
      ekle({ declarationType: 'MUHSGK', periodYear: y, periodMonth: null, periodQuarter: q, dueDate: calculateBeyannameDeadline('MUHSGK', ayDonem(y, sonAy)), description: AD.MUHSGK_3AY });
      const gvAy = sonAy + 1 > 12 ? 1 : sonAy + 1; // geçici: (sonAy+1) dönemi verilince util bir ay daha ekler → 17'si
      const gvYil = sonAy + 1 > 12 ? y + 1 : y;
      ekle({ declarationType: 'GGECICI', periodYear: y, periodMonth: null, periodQuarter: q, dueDate: calculateBeyannameDeadline('GGECICI', ayDonem(gvYil, gvAy)), description: AD.GGECICI });
      ekle({ declarationType: 'KGECICI', periodYear: y, periodMonth: null, periodQuarter: q, dueDate: calculateBeyannameDeadline('KGECICI', ayDonem(gvYil, gvAy)), description: AD.KGECICI });
    }
    // Yıllık: dönem y → izleyen yıl Mart/Nisan (util 'yıl-ay' ister; ay bilgisi yıllıkta kullanılmaz)
    ekle({ declarationType: 'GELIR', periodYear: y, periodMonth: null, periodQuarter: null, dueDate: calculateBeyannameDeadline('GELIR', ayDonem(y + 1, 3)), description: AD.GELIR });
    ekle({ declarationType: 'KURUMLAR', periodYear: y, periodMonth: null, periodQuarter: null, dueDate: calculateBeyannameDeadline('KURUMLAR', ayDonem(y + 1, 4)), description: AD.KURUMLAR });
  }
  return cikti.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
