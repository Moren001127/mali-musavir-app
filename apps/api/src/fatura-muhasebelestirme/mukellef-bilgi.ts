/**
 * PLAN/16 §F — Motor beslemesi: mükellefin faaliyet tanımını TEK SATIR metne çevirir
 * (bilanço + işletme promptlarına "mükellef bilgisi" olarak verilir).
 *
 * SAF dosya: DB/Nest bağımlılığı yok; regresyon betiği doğrudan çalıştırır.
 * NOT: Servise bağlanması sonraki turda (çakışma olmasın) — şimdilik yalnız yardımcı + select nesnesi.
 *
 * Örnek: "ÖRNEK GIDA LTD — NACE 56.10.06 · faaliyet: yemek üretimi · sektör: gıda · kurum: Kamu kurumu · defter: bilanço"
 */
import { kurumTuruEtiketi } from '@mali-musavir/shared';

export type MukellefBilgiGirdisi = {
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  naceKodu?: string | null;
  faaliyetAciklama?: string | null;
  sektorEtiketi?: string | null;
  kurumTuru?: string | null;
  defterTuru?: string | null;
  mihsapDefterTuru?: string | null;
};

/** Prisma `select` nesnesi — mukellefFaaliyetMetni için gereken alanlar. */
export const mukellefBilgiSelect = {
  companyName: true,
  firstName: true,
  lastName: true,
  naceKodu: true,
  faaliyetAciklama: true,
  sektorEtiketi: true,
  kurumTuru: true,
  defterTuru: true,
  mihsapDefterTuru: true,
} as const;

const temiz = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Defter türü etiketi: defterTuru öncelikli, boşsa mihsapDefterTuru'ndan türetilir; bilinmiyorsa ''. */
export function defterTuruMetni(defterTuru?: string | null, mihsapDefterTuru?: string | null): string {
  const d = temiz(defterTuru).toUpperCase();
  const m = temiz(mihsapDefterTuru).toUpperCase();
  if (/BASIT/.test(`${d} ${m}`)) return 'basit usul';
  if (/ISLETME|İŞLETME|DEFTER[_\s-]*BEYAN/.test(d) || (!d && /ISLETME|İŞLETME|DEFTER[_\s-]*BEYAN/.test(m))) return 'işletme';
  if (/BILANCO|BİLANÇO|BILANÇO/.test(d) || (!d && /BILANCO|BİLANÇO|BILANÇO/.test(m))) return 'bilanço';
  return '';
}

/** Mükellef ünvanı: companyName, yoksa "Ad Soyad"; ikisi de boşsa ''. */
export function mukellefUnvani(tp: Pick<MukellefBilgiGirdisi, 'companyName' | 'firstName' | 'lastName'>): string {
  return temiz(tp.companyName) || temiz(`${tp.firstName || ''} ${tp.lastName || ''}`);
}

/**
 * Tek satır faaliyet metni. Boş alanlar atlanır; hiç bilgi yoksa yalnız ünvan (o da yoksa '').
 */
export function mukellefFaaliyetMetni(tp: MukellefBilgiGirdisi | null | undefined): string {
  if (!tp) return '';
  const unvan = mukellefUnvani(tp);
  const parcalar: string[] = [];
  const nace = temiz(tp.naceKodu);
  if (nace) parcalar.push(`NACE ${nace}`);
  const faaliyet = temiz(tp.faaliyetAciklama);
  if (faaliyet) parcalar.push(`faaliyet: ${faaliyet}`);
  const sektor = temiz(tp.sektorEtiketi);
  if (sektor) parcalar.push(`sektör: ${sektor}`);
  const kurum = kurumTuruEtiketi(tp.kurumTuru);
  if (kurum) parcalar.push(`kurum: ${kurum}`);
  const defter = defterTuruMetni(tp.defterTuru, tp.mihsapDefterTuru);
  if (defter) parcalar.push(`defter: ${defter}`);
  if (!parcalar.length) return unvan;
  return `${unvan ? unvan + ' — ' : ''}${parcalar.join(' · ')}`;
}
