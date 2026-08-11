// KALEM-BAZLI matrah bölme — SAF mantık (NestJS/Prisma BAĞIMSIZ, birim-testli).
//   linesFromAmounts bunu kullanır. Amaç: aynı faturada farklı kalemleri farklı hesaba yazarken
//   DENGE (borç=alacak) HER ZAMAN korunsun. Bu yüzden bölme yalnız GÜVENLİ durumda yapılır; şüphede
//   çağıran tek-hesap davranışına döner (kayıp/dengesizlik riski YOK).

export type MatrahSplitEntry = { hesap: string; rate: number; base: number };
export type SplitByRate = Map<number, Array<{ hesap: string; base: number }>>;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * breakdown oranlarına karşı matrahSplit'i doğrular + hesap bazında toplar + her oranın kalem-tabanı
 * toplamını, o oranın matrahına (breakdown.base) EŞİTLER (artığı en büyük girdiye ekleyerek).
 *
 * Döner:
 *  - SplitByRate  → bölme UYGUN. Her oran için girdiler; girdi tabanları toplamı = o oranın matrahı (EXACT).
 *  - null         → bölme UYGUN DEĞİL, çağıran TEK-HESABA düşmeli. Şu durumlarda null:
 *      • 2'den az FARKLI hesap (bölünecek bir şey yok),
 *      • bir oranda hiç kalem yok, ya da
 *      • bir oranın kalem tabanı, oran matrahına toleransta (maks(0.10 TL, %1)) denk GELMİYOR
 *        (kalem eksik/iskonto/OCR hatası → riskli, bölme).
 */
export function reconcileMatrahSplit(
  breakdown: Array<{ rate: number; base: number }>,
  matrahSplit: Array<MatrahSplitEntry> | null | undefined,
): SplitByRate | null {
  const byRate: SplitByRate = new Map();
  for (const s of matrahSplit || []) {
    const rr = Number(s?.rate) || 0;
    const hh = String(s?.hesap || '').trim();
    const bb = r2(s?.base);
    if (!hh || bb <= 0) continue;
    const arr = byRate.get(rr) || [];
    const ex = arr.find((x) => x.hesap === hh);
    if (ex) ex.base = r2(ex.base + bb);
    else arr.push({ hesap: hh, base: bb });
    byRate.set(rr, arr);
  }

  const distinct = new Set<string>();
  for (const arr of byRate.values()) for (const e of arr) distinct.add(e.hesap);
  if (distinct.size < 2) return null; // bölünecek farklı hesap yok → tek-hesap

  const out: SplitByRate = new Map();
  for (const item of breakdown) {
    const rb = r2(item?.base);
    if (rb <= 0) continue; // matrahsız oran (yalnız yuvarlama) atlanır
    const entries = (byRate.get(Number(item?.rate) || 0) || []).map((e) => ({ ...e }));
    const sum = r2(entries.reduce((a, e) => a + e.base, 0));
    const tol = Math.max(0.1, rb * 0.01);
    if (!entries.length || Math.abs(sum - rb) > tol) return null; // bu oran denk gelmedi → hiç bölme
    const residual = r2(rb - sum);
    if (residual !== 0) {
      const big = entries.reduce((a, b) => (b.base > a.base ? b : a));
      big.base = r2(big.base + residual);
    }
    out.set(Number(item?.rate) || 0, entries);
  }
  return out.size ? out : null;
}
