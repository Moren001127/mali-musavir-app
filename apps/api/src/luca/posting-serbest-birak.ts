/**
 * posting-serbest-birak.ts — "AKTARILIYOR"DA (POSTING) UNUTULAN BELGE KARARI (2026-09-23, DOĞAN ÖZKAN olayı).
 *
 * Toplu Luca aktarımı belgeyi POSTING'e alıp bir INVOICE_POST işine bağlar; belge ancak
 * markJobDone (POSTED) / markJobFailed (FAILED) ile serbest kalırdı. İş bu iki yoldan geçmeden
 * bitince (kullanıcı "durdur" dedi → cancelled; takılı iş temizliği doğrudan failed yazdı; bayat
 * iş otomatik iptal edildi; iş kaydı silindi) belge SONSUZA KADAR "Aktarılıyor…"da kalıyordu:
 * aktar düğmesi pasif, tekrar dene yok, geri al kilitli — kullanıcının çıkış yolu yoktu.
 *
 * Bu dosya SAF karar mantığıdır (veritabanı yok): işin durumuna göre belgeye ne yazılacağını söyler.
 * Uygulama LucaService.postingBelgeleriSerbestBirak'ta; iptalde anında, temizleyicide dakikada bir.
 */

export type SerbestIs = { status: string; errorMsg?: string | null; finishedAt?: Date | null } | null | undefined;

export type SerbestKarar =
  | { lucaStatus: 'FAILED'; lucaErrorMessage: string }
  | { lucaStatus: 'POSTED'; lucaPostedAt: Date }
  | null;

/** Ajan günlüğünün son anlamlı satırı — "[HH:MM:SS] " damgası atılır, 300 karaktere kırpılır. */
export function sonGunlukSatiri(log: string | null | undefined): string {
  const satirlar = String(log || '')
    .split('\n')
    .map((s) => s.replace(/^\s*\[\d{2}:\d{2}:\d{2}\]\s*/, '').trim())
    .filter(Boolean);
  return (satirlar[satirlar.length - 1] || '').slice(0, 300);
}

/**
 * POSTING'deki belge için karar:
 *  - iş yok (silinmiş / bağ kopmuş)  → FAILED, yeniden gönderilebilir
 *  - pending / running               → DOKUNMA (aktarım gerçekten sürüyor)
 *  - cancelled                       → FAILED + "Aktarım durduruldu: …"
 *  - failed                          → FAILED + günlüğün son satırı (markJobFailed'ın yapacağı şey)
 *  - done                            → POSTED (fiş kesilmiş; FAILED yazmak mükerrer fişe yol açar)
 *  - bilinmeyen durum                → DOKUNMA
 */
export function postingBelgeKarari(is: SerbestIs, simdi: Date = new Date()): SerbestKarar {
  if (!is) return { lucaStatus: 'FAILED', lucaErrorMessage: 'Aktarım işi kaydı bulunamadı — yeniden gönderin' };
  const st = String(is.status || '').toLowerCase();
  if (st === 'pending' || st === 'running') return null;
  if (st === 'cancelled') {
    const son = sonGunlukSatiri(is.errorMsg);
    return { lucaStatus: 'FAILED', lucaErrorMessage: `Aktarım durduruldu${son ? `: ${son}` : ''}`.slice(0, 1000) };
  }
  if (st === 'failed') {
    const son = sonGunlukSatiri(is.errorMsg);
    return { lucaStatus: 'FAILED', lucaErrorMessage: (son || "Luca'ya gönderilemedi").slice(0, 1000) };
  }
  if (st === 'done') return { lucaStatus: 'POSTED', lucaPostedAt: is.finishedAt || simdi };
  return null;
}
