/** Ek modül kayıt defteri — paketler burada birleşir (bkz. tur.ts). Yeni paket: dosya + bu listeye bir satır. */
import type { EkAksiyon, EkModulYukleyici, EkPaket } from './tur';
import { paket as fm } from './fm';
import { paket as ekip } from './ekip';
import { paket as sayfalar } from './sayfalar';

const PAKETLER: EkPaket[] = [fm, ekip, sayfalar];

export const EK_MODUL_YUKLEYICI: Record<string, EkModulYukleyici> = Object.assign({}, ...PAKETLER.map((p) => p.yukleyiciler));
export const EK_AKSIYON: Record<string, EkAksiyon> = Object.assign({}, ...PAKETLER.map((p) => p.aksiyonlar));
export type { EkBaglam } from './tur';
