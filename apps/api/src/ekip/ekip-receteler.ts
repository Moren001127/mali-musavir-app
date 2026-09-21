import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * REÇETE BAŞLIKLARI + KAPALI PERSONEL (PLAN/20 §E-6, 2026-09-22) — /ekip/kadro ekleri.
 *
 * `apps/api/kadro/<ajanId>/receteler.md` içindeki "## R1 — …", "## S1 — …", "## K1 — …", "## M1 — …", "## R-K1 — …"
 * başlıklarından {kod, baslik} listesi; kodsuz başlıklar ("## Dönem çevirisi", "## DEVİR CEVABI") alınmaz. Dosya yoksa boş.
 * Kapalı personel: ses-koordinator.ts'deki HAZIR DEĞİL kuralı — bordro/SGK modülü kapalı (portalda bordro verisi yok).
 */

export interface ReceteBasligi {
  kod: string;
  baslik: string;
}

/** Kod: harf(ler) [+ "-" harf(ler)] + rakam(lar) — R1, R10, S1, K1, M1, R-K1, C2. Ayraç: — – - : */
const BASLIK_KALIBI = /^##\s+([A-ZÇĞİÖŞÜ]{1,3}(?:-[A-ZÇĞİÖŞÜ]{1,3})?\d{1,2}[a-z]?)\s*[—–\-:]\s*(.+?)\s*$/;

export function receteBasliklariniAyikla(markdown: string): ReceteBasligi[] {
  const out: ReceteBasligi[] = [];
  const gorulen = new Set<string>();
  for (const satir of String(markdown || '').split(/\r?\n/)) {
    const m = satir.trim().match(BASLIK_KALIBI);
    if (!m) continue;
    const kod = m[1];
    if (gorulen.has(kod)) continue;
    gorulen.add(kod);
    out.push({ kod, baslik: m[2].replace(/\s+/g, ' ').trim().slice(0, 200) });
  }
  return out;
}

/** Kadro kökü adayları (runner.kadroKokAdaylari ile aynı sıra). */
function kadroKokAdaylari(): string[] {
  return [path.resolve(__dirname, '..', '..', 'kadro'), path.resolve(process.cwd(), 'apps', 'api', 'kadro'), path.resolve(process.cwd(), 'kadro')];
}

/** <kadro>/<ajanId>/receteler.md başlıkları; dosya yoksa/okunamazsa boş dizi. */
export async function receteleriOku(ajanId: string): Promise<ReceteBasligi[]> {
  const guvenli = String(ajanId || '').replace(/[^a-z0-9-]/gi, '');
  if (!guvenli) return [];
  for (const kok of kadroKokAdaylari()) {
    try {
      const icerik = await fs.readFile(path.join(kok, guvenli, 'receteler.md'), 'utf8');
      if (icerik && icerik.trim()) return receteBasliklariniAyikla(icerik);
    } catch {
      /* aday yok — sıradakine bak */
    }
  }
  return [];
}

/** Kapalı personel → neden (ses-koordinator.ts HAZIR DEĞİL kuralıyla aynı kaynak). */
export const KAPALI_PERSONEL: Record<string, { neden: string }> = {
  'bordro-sgk': { neden: 'Bordro modülü kapalı — portalda bordro verisi yok' },
};

export function personelKapaliMi(ajanId: string): { neden: string } | null {
  return KAPALI_PERSONEL[ajanId] || null;
}
