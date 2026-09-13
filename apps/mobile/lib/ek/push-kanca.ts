/**
 * ANLIK BİLDİRİM KANCALARI — (push paketi ajanı doldurur; bkz. lib/ek/tur.ts)
 *  - girisSonrasi(): başarılı girişte cihaz push belirtecini sunucuya kaydeder.
 *  - cikisOncesi(): çıkışta belirteci sunucudan siler.
 *  - dinle(gitRoute): bildirime dokununca ilgili ekrana gider (route: 'bildirim', 'm:ekip' ...).
 */
import type { AxiosInstance } from 'axios';

export async function girisSonrasi(_api: AxiosInstance, _persona: 'adv' | 'tax'): Promise<void> {
  /* henüz yok */
}

export async function cikisOncesi(_api: AxiosInstance): Promise<void> {
  /* henüz yok */
}

export function dinle(_gitRoute: (route: string) => void): () => void {
  return () => undefined;
}
