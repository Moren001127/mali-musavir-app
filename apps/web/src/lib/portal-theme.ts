import type { CSSProperties } from 'react';

/** Renk uyumluluk katmanı. Ölçü, konum, içerik ve olaylara dokunmaz.
 * Değişkenlerin karşılığı yalnız D temasında bulunur; A'da özgün renk kullanılır.
 * Renkler birleştirildikten sonra işlenir: `${renk}1a` gibi eski kullanımlar korunur.
 */
const COLOR = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|rgba?\([\d\s.,%]+\)/gi;
type Role = 'ink' | 'surface' | 'gradient' | 'border' | 'shadow';
function parseColor(value: string): [number, number, number, number] | null {
  if (value[0] === '#') {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1];
  }
  if (!/^rgba?\(/i.test(value)) return null;
  const parts = value.match(/[\d.]+%?/g);
  if (!parts || parts.length < 3) return null;
  return [0, 1, 2].map(i => parseFloat(parts[i]) * (parts[i].includes('%') ? 2.55 : 1)).concat(parts[3] ? parseFloat(parts[3]) / (parts[3].includes('%') ? 100 : 1) : 1) as [number, number, number, number];
}
function family(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < 20 || (max > 0 && delta / max < .08)) return 'slate';
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 335) return 'rose';
  if (hue < 43) return 'copper';
  if (hue < 70) return 'amber';
  if (hue < 165) return 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return 'blue';
  return 'plum';
}

function colorToken(original: string, role: Role, keepWhite = false): string {
  const parsed = parseColor(original);
  if (!parsed) return original;
  const [r, g, b, a] = parsed;
  if (a === 0) return original;
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  const neutral = high - low < 35 || high < 48;
  let token: string;
  if (role === 'shadow') token = 'shadow';
  else if (role === 'border') token = neutral ? 'line' : `${family(r,g,b)}-line`;
  else if (role === 'surface' || role === 'gradient') {
    if (role === 'surface' && high === 0 && a >= .45 && a < 1) return `var(--portal-overlay, ${original})`;
    if (neutral) {
      if (low > 240 && a > .9) return original;
      token = a < .35 ? 'wash' : high < 45 ? 'surface' : 'raised';
    } else token = `${family(r,g,b)}-${role === 'gradient' || a < .45 || high < 105 || low > 175 ? 'wash' : 'surface'}`;
  } else {
    if (keepWhite && neutral && a > .7) return `var(--portal-on-color, ${original})`;
    token = neutral ? (a < .55 ? 'muted' : a < .85 ? 'secondary' : 'ink') : `${family(r,g,b)}-ink`;
  }
  return `var(--portal-${token}, ${original})`;
}

/** Pure, SSR-safe and independent of document/window. */
export function portalStyle<T extends CSSProperties | undefined>(style: T): T {
  if (!style) return style;
  const result = { ...style } as CSSProperties;
  const rawBackground = String(style.backgroundColor || style.background || '');
  const base = parseColor(rawBackground);
  // Solid, saturated action backgrounds retain white foreground text.
  const keepWhite = !!base && base[3] > .75 && Math.min(...base.slice(0,3)) < 175 && Math.max(...base.slice(0,3)) >= 105 && Math.max(...base.slice(0,3)) - Math.min(...base.slice(0,3)) > 45;
  for (const key of Object.keys(style) as (keyof CSSProperties)[]) {
    const value = style[key];
    if (typeof value !== 'string' || value.includes('var(--portal-') || value.includes('url(')) continue;
    let role: Role | undefined;
    if (key === 'color' || key === 'fill' || key === 'stroke' || key === 'caretColor' || key === 'textDecorationColor') role = 'ink';
    else if (key === 'background' || key === 'backgroundColor' || key === 'backgroundImage') role = value.includes('gradient(') ? 'gradient' : 'surface';
    else if (key === 'boxShadow' || key === 'textShadow') role = 'shadow';
    else if (key.startsWith('border') || key.startsWith('outline')) role = 'border';
    if (!role) continue;
    const mapped = value.replace(COLOR, color => colorToken(color, role!, keepWhite));
    if (mapped !== value) (result as Record<string, unknown>)[key] = mapped;
  }
  return result as T;
}

/** Legacy inline style sheets share the same tokens without altering selectors. */
export function portalCss(css: string): string {
  return css.replace(/((?:background(?:-color|-image)?|color|border(?:-[\w-]+)?|box-shadow|text-shadow|outline(?:-color)?)\s*:\s*)([^;{}]+)(?=[;}])/g, (all, prefix: string, value: string) => {
    if (value.includes('var(--portal-') || value.includes('url(')) return all;
    const role: Role = prefix.startsWith('background') ? (value.includes('gradient(') ? 'gradient' : 'surface') : prefix.includes('shadow') ? 'shadow' : prefix.startsWith('color') ? 'ink' : 'border';
    return prefix + value.replace(COLOR, color => colorToken(color, role));
  });
}

/** Eski fare olaylarındaki doğrudan renk atamaları için aynı dönüşüm. */
export function portalPaint(value: string, property: 'color' | 'background' | 'backgroundColor' | 'borderColor' | 'boxShadow'): string {
  return String(portalStyle({ [property]: value })[property]);
}
