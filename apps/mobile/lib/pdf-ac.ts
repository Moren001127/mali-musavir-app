/**
 * ANDROID PDF AÇMA (2026-09-13 bütünsel değerlendirme bulgusu)
 *
 * Belgeler (e-Arşiv PDF, tebligat PDF, Fatura Merkezi dosyası) HTML'de <iframe> ile gösteriliyor: iOS WKWebView PDF'i
 * çizer, ANDROID WebView PDF'i BOŞ gösterir. Android'de PDF önbelleğe yazılıp sistemin PDF görüntüleyicisinde açılır
 * (content:// + ACTION_VIEW). iOS'ta hiçbir şey değişmez (null döner → mevcut iframe yolu sürer).
 *
 * Kaynak: data:application/pdf;base64,… · https://… (imzalı depo adresi ya da API yolu) · ham base64.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import type { AxiosInstance } from 'axios';

const PDF_DOSYA_ADI = 'moren-belge.pdf';

function base64Ayikla(kaynak: string): string | null {
  const m = /^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i.exec(kaynak);
  return m ? m[1] : null;
}

/** true → Android'de sistem görüntüleyici açıldı; false → açılamadı; null → bu platformda uygulanmaz (iOS/web). */
export async function androidPdfAc(kaynak: string, opts: { api?: AxiosInstance; mimeType?: string } = {}): Promise<boolean | null> {
  if (Platform.OS !== 'android') return null;
  const pdfMi = /pdf/i.test(String(opts.mimeType || '')) || /^data:application\/pdf/i.test(kaynak) || /\.pdf(\?|$)/i.test(kaynak);
  if (!pdfMi) return null;
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return false;
    const yol = dir + PDF_DOSYA_ADI;
    const b64 = base64Ayikla(kaynak);
    if (b64) {
      await FileSystem.writeAsStringAsync(yol, b64, { encoding: FileSystem.EncodingType.Base64 });
    } else if (/^https?:\/\//i.test(kaynak)) {
      // Önce doğrudan indir (imzalı depo adresi); olmazsa API kimliğiyle (axios) çekip yaz.
      let ok = false;
      try {
        const r = await FileSystem.downloadAsync(kaynak, yol);
        ok = r.status >= 200 && r.status < 300;
      } catch { ok = false; }
      if (!ok) {
        if (!opts.api) return false;
        const resp = await opts.api.get(kaynak, { responseType: 'arraybuffer', timeout: 45000 });
        const bytes = new Uint8Array(resp.data as ArrayBuffer);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        await FileSystem.writeAsStringAsync(yol, (globalThis as any).btoa(s), { encoding: FileSystem.EncodingType.Base64 });
      }
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(kaynak) && kaynak.length > 100) {
      await FileSystem.writeAsStringAsync(yol, kaynak.replace(/\s+/g, ''), { encoding: FileSystem.EncodingType.Base64 });
    } else {
      return false;
    }
    const contentUri = await FileSystem.getContentUriAsync(yol);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/pdf',
    });
    return true;
  } catch {
    return false;
  }
}

/** HTML belge kutusuna yazılacak kısa bilgi (PDF dışarıda açıldı / açılamadı). */
export function androidPdfNotu(acildi: boolean): { html: string; ct: string } {
  const metin = acildi
    ? 'Belge, telefonun PDF görüntüleyicisinde açıldı.'
    : 'PDF bu telefonda açılamadı — bir PDF görüntüleyici (Google Drive PDF, Adobe Reader) yüklü olmalı.';
  return {
    html: '<div style="font-family:sans-serif;padding:28px 16px;text-align:center;color:#444;font-size:14px;line-height:1.5">' + metin + '</div>',
    ct: 'text/html',
  };
}
