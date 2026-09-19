import type { CSSProperties } from 'react';
import './owned-theme.css';

// Yalnız menü, üst çubuk ve giriş ekranlarının renkleri. Değişkenler D dışında
// tanımlanmaz; her renk kendi eski değerine döner. Ölçüler ve davranışlar korunur.
const accents: Record<string, string> = {
  '212,184,118': 'primary', '184,160,111': 'primary', '139,118,73': 'primary-deep',
  '227,196,128': 'plum', '236,214,164': 'primary',
  '240,154,168': 'rose', '251,113,133': 'rose', '244,63,94': 'rose',
  '239,68,68': 'rose', '220,38,38': 'rose', '236,72,153': 'rose',
  '143,215,189': 'green', '74,222,128': 'green', '34,197,94': 'green',
  '16,185,129': 'green', '132,204,22': 'green',
  '216,173,112': 'amber', '217,160,108': 'amber', '245,158,11': 'amber',
  '251,191,36': 'amber', '217,119,6': 'amber', '234,88,12': 'amber',
  '140,189,232': 'plum', '156,200,255': 'plum', '79,134,201': 'plum',
  '59,130,246': 'plum', '37,99,235': 'plum', '168,85,247': 'plum',
  '139,92,246': 'plum', '6,182,212': 'primary',
  '157,168,183': 'muted', '100,116,139': 'muted',
};

const colorProperties = /^(color|background|backgroundColor|border.*|boxShadow|textShadow|fill|stroke)$/;

export function ownedThemeValue(value: string, property: string): string {
  if (!colorProperties.test(property)) return value;
  const text = property === 'color' || property === 'fill' || property === 'stroke';
  const border = property.startsWith('border');
  const shadow = property.endsWith('Shadow');
  return value.replace(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{3}\b|rgba?\([^()]+\)/gi, (original) => {
    let rgb: number[];
    let alpha = 1;
    if (original.startsWith('#')) {
      let hex = original.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      if (hex.length === 8) alpha = parseInt(hex.slice(6), 16) / 255;
    } else {
      const parts = original.slice(original.indexOf('(') + 1, -1).split(',').map(Number);
      if (parts.length < 3 || parts.some(Number.isNaN)) return original;
      rgb = parts.slice(0, 3);
      alpha = parts[3] ?? 1;
    }
    if (alpha === 0) return original;
    const variable = (name: string) => `var(--moren-owned-${name}, ${original})`;
    const accent = accents[rgb.join(',')];
    if (accent) {
      if (alpha >= 0.7 || text) return variable(accent);
      return `var(--moren-owned-${accent}-${border ? 'line' : 'soft'}, ${original})`;
    }
    if (Math.min(...rgb) >= 240) {
      // Saf beyaz, uyarı şeritleri ve dolu düğmelerde beyaz kalır.
      if (rgb.every((channel) => channel === 255) && alpha === 1) return original;
      return variable(text ? (alpha >= 0.8 ? 'ink' : 'muted') : border ? 'line' : shadow ? 'shine' : 'soft');
    }
    if (Math.max(...rgb) < 75) {
      if (text) return variable('on-primary');
      if (shadow) return variable('shadow');
      if (border) return variable('line');
      if (rgb.every((channel) => channel === 0)) return original;
      return variable('surface');
    }
    return original;
  });
}

export function ownedThemeStyle(style: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(style).map(([property, value]) => [
    property,
    typeof value === 'string' ? ownedThemeValue(value, property) : value,
  ])) as CSSProperties;
}
