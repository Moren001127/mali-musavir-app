// e-Defter modülü tema sabitleri — TEK KAYNAK (page.tsx ve _components buradan okur).
//   Kimlik: kurumsal lacivert/mavi; sakin nötr gövde + renkli vurgular (tek renge boğma).
export const NAVY = '#5b8def';
export const NAVY_SOFT = 'rgba(91,141,239,.14)';
export const ERR = '#e2706f';   // hata (yumuşatılmış kırmızı)
export const WARN = '#d4a85f';  // uyarı (mat altın)
export const INFO = '#7fa6dd';  // bilgi (gök-mavisi)
export const OK = '#5cbf8a';    // temiz/çözüldü (mat zümrüt)
export const PANEL = 'rgba(255,255,255,0.025)';
export const PANEL_HOVER = 'rgba(255,255,255,0.045)';
export const BORDER = 'rgba(255,255,255,0.07)';
export const BORDER_STRONG = 'rgba(255,255,255,0.12)';
export const TEXT = '#fafaf9';
export const MUTED = 'rgba(250,250,249,.55)';
export const MUTED2 = 'rgba(250,250,249,.42)';
export const GRAY = '#94a3b8'; // görmezden / uygulanmaz
export const HERO_BG = 'radial-gradient(120% 150% at 0% 0%, rgba(59,130,246,.18), transparent 46%), radial-gradient(120% 150% at 100% 0%, rgba(99,102,241,.14), transparent 46%), #0f0d0b';
export const LIGHTBAR = 'linear-gradient(90deg,#3b82f6,#5b8def,#6366f1,#38bdf8)';
export const ICON_GRAD = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
export const LEAD_GRAD = 'linear-gradient(135deg, rgba(91,141,239,0.20), rgba(37,99,235,0.07))';
export const ARROW = (c: string) => `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${c}' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`;

export function sevColor(s: string) { return s === 'ERROR' ? ERR : s === 'WARN' ? WARN : INFO; }
export function sevLabel(s: string) { return s === 'ERROR' ? 'HATA' : s === 'WARN' ? 'UYARI' : 'BİLGİ'; }
export function sevRank(s: string) { return s === 'ERROR' ? 0 : s === 'WARN' ? 1 : 2; }
export function fmtTRY(value: any) { const n = Number(value || 0); return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function fmtDate(value?: string | Date | null) { if (!value) return '-'; return new Date(value).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }); }
export function fmtDateTime(value?: string | Date | null) { if (!value) return '-'; return new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' }); }

// Kart üstü ince renk şeridi (portal tasarım dili)
export const seritStili = (renk: string) => ({ background: `linear-gradient(90deg, transparent, ${renk}66, transparent)` });
