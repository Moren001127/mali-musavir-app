import { Platform } from 'react-native';

export const colors = {
  bg: '#0a0906',
  bgTop: '#1a1612',
  surface: '#0f0d0b',
  surface2: '#16130f',
  surface3: '#1f1a13',
  border: '#2a241c',
  borderSoft: '#1e1a14',
  text: '#fafaf9',
  textMuted: 'rgba(250,250,249,0.62)',
  textSoft: 'rgba(250,250,249,0.42)',
  gold: '#d4b876',
  goldMuted: '#b8a06f',
  goldDeep: '#8b7649',
  goldSoft: 'rgba(212,184,118,0.12)',
  green: '#34d399',
  blue: '#60a5fa',
  amber: '#fbbf24',
  rose: '#fb7185',
  purple: '#a78bfa',
  sage: '#8fd7bd',
  copper: '#d9a06c',
  steel: '#9da8b7',
  white: '#ffffff',
  black: '#000000',
};

// Portal imzası: her modül grubunun kendi aksan rengi
export type ModuleColor =
  | 'gold'
  | 'rose'
  | 'amber'
  | 'sage'
  | 'green'
  | 'blue'
  | 'copper'
  | 'steel'
  | 'purple';

export const moduleAccents: Record<ModuleColor, string> = {
  gold: colors.gold,
  rose: colors.rose,
  amber: colors.amber,
  sage: colors.sage,
  green: colors.green,
  blue: colors.blue,
  copper: colors.copper,
  steel: colors.steel,
  purple: colors.purple,
};

/** Hex renge alfa ekler: withAlpha('#d4b876', 0.12) -> hex8 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
};

export const fonts = {
  body: Platform.select({ web: 'Inter, system-ui, sans-serif', default: undefined }),
  heading: Platform.select({ web: 'Fraunces, Georgia, serif', default: undefined }),
  mono: Platform.select({ web: 'Menlo, Consolas, monospace', default: 'monospace' }),
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  android: {
    elevation: 6,
  },
  default: {},
});
