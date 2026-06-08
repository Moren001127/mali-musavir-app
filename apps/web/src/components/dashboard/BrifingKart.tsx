'use client';

/**
 * v1.36.82 — Profesyonel Sabah/Gün Brifingi Kartı
 *
 * Backend artık structured JSON döner: { summary, alerts[], suggestions[], focus, metrics }
 * Bu kart sadece düz metin değil, uyarı rozetleri + tıklanabilir aksiyon önerileri + odak
 * göstergesi (calm/busy/critical/review) gösterir.
 *
 * Auto-refresh: dashboard her 5 dakikada yeniden ister (backend cache 30 dk).
 * Force yenileme butonu cache'i bypass eder.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, RefreshCw, Loader2, AlertTriangle, ArrowRight,
  Receipt, FileText, FileCheck, Bell, Zap, Calendar, Clock,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface BrifingAlert {
  severity: 'high' | 'medium' | 'low';
  text: string;
  href?: string;
}
interface BrifingSuggestion {
  text: string;
  href: string;
  icon?: string;
}
interface BrifingResponse {
  summary: string;
  motivation?: string;
  alerts: BrifingAlert[];
  suggestions: BrifingSuggestion[];
  focus: 'calm' | 'busy' | 'critical' | 'review';
  metrics: Record<string, any>;
  generatedAt: string;
  fromCache: boolean;
}

const ICON_MAP: Record<string, any> = {
  Receipt, FileText, FileCheck, Bell, Sparkles, Zap, Calendar, Clock, ArrowRight,
  RefreshCw,
};

/** v1.36.83: Görünen adın sonundaki Bey/Hanım/Bay/Bayan'ı temizle, ilk kelimeyi al.
 * Yeni kullanıcı kayıt formuna "DİLEK Bey" yazabiliyor — bu bug değil, ad alanına unvan girmiş.
 * Selamlamada "Günaydın, DİLEK" yeterli — kibar AND cinsiyet-tarafsız. */
function sanitizeFirstName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw)
    .replace(/\b(Bey|Hanım|Hanim|Bay|Bayan)\b/gi, '')
    .trim()
    .split(/\s+/)[0];
  return cleaned || undefined;
}

const KISA_TARIH = new Date().toLocaleDateString('tr-TR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const FOCUS_TONES: Record<string, { label: string; color: string; bg: string; glow: string; border: string; actionBg: string; actionBorder: string; text: string }> = {
  calm: {
    label: 'Sakin',
    color: '#86c7a0',
    bg: 'rgba(134,199,160,0.08)',
    glow: 'rgba(134,199,160,0.08)',
    border: 'rgba(134,199,160,0.16)',
    actionBg: 'rgba(255,255,255,0.026)',
    actionBorder: 'rgba(255,255,255,0.075)',
    text: '#bddbc8',
  },
  busy: {
    label: 'Yoğun',
    color: '#d8bd86',
    bg: 'rgba(216,189,134,0.075)',
    glow: 'rgba(216,189,134,0.08)',
    border: 'rgba(216,189,134,0.16)',
    actionBg: 'rgba(255,255,255,0.026)',
    actionBorder: 'rgba(255,255,255,0.075)',
    text: '#d8c38f',
  },
  critical: {
    label: 'Kritik',
    color: '#e58c9b',
    bg: 'rgba(229,140,155,0.075)',
    glow: 'rgba(229,140,155,0.08)',
    border: 'rgba(229,140,155,0.16)',
    actionBg: 'rgba(255,255,255,0.026)',
    actionBorder: 'rgba(255,255,255,0.075)',
    text: '#e8b8c1',
  },
  review: {
    label: 'Kontrol',
    color: '#8db6c6',
    bg: 'rgba(141,182,198,0.075)',
    glow: 'rgba(141,182,198,0.08)',
    border: 'rgba(141,182,198,0.16)',
    actionBg: 'rgba(255,255,255,0.026)',
    actionBorder: 'rgba(255,255,255,0.075)',
    text: '#b7d2dc',
  },
};

const BRIEFING_CHROME_TONE = {
  color: '#8fd7bd',
  colorWarm: '#d8bd86',
  bg: 'rgba(143,215,189,0.075)',
  glow: 'rgba(143,215,189,0.07)',
  border: 'rgba(143,215,189,0.18)',
  actionBg: 'rgba(143,215,189,0.050)',
  actionBorder: 'rgba(143,215,189,0.15)',
  text: '#bfe9dc',
};

const MOTIVATION_BY_FOCUS: Record<string, string> = {
  calm: 'Bugün küçük işleri sakince kapatmak için güzel bir aralık var.',
  busy: 'Sırayı sakin tutalım; birkaç net hamle günü toparlar.',
  critical: 'Kritik başlığı öne alalım; günün yükü belirgin azalır.',
  review: 'Kısa kontrol, yarının yükünü bugünden hafifletir.',
};

const OPERATIONAL_MOTIVATION_RE = /\d|\b(KDV|Luca|Mihsap|evrak|fatura|çekim|hata|mükellef|beyanname|otomasyon|ajan|dosya|takip|hız|hiz|artır|artir|gecik|geciken|liste|talep|kontrol|log|işlem|islem|kayıt|kayit|bekleyen)\b/iu;
const COMPANY_WORD_RE = /\b(LİMİTED|ANONİM|ŞİRKETİ|TİCARET|SANAYİ|PAZARLAMA|GIDA|İNŞAAT|TURİZM|A\.Ş|LTD|LTD\.ŞTİ)\b/i;
const TODAY_DAY = new Date().getDate();
const EARLY_MONTH = TODAY_DAY <= 12;
const SAFE_PANEL_ROUTES = [
  '/panel/ajanlar/mihsap',
  '/panel/is-yuku',
  '/panel/gorevler',
  '/panel/beyannameler',
  '/panel/kdv-kontrol',
  '/panel/mukellef-listesi',
  '/panel/mukellefler',
  '/panel/ajanlar',
  '/panel/faturalar',
  '/panel/fatura-isleme',
  '/panel/cari-kasa',
  '/panel/banka-takip',
  '/panel/otomasyonlar',
  '/panel/onay-kuyrugu',
  '/panel/e-arsiv',
  '/panel/mizan',
  '/panel/bildirimler',
];

function normalizeDashboardHref(href?: string): string {
  const value = String(href || '').trim();
  for (const route of SAFE_PANEL_ROUTES) {
    if (value === route || value.startsWith(`${route}/`)) return route;
  }
  return '/panel';
}

function softenCalendarTone(text: string): string {
  let value = String(text || '')
    .replace(/\bGeçik\s+Vergi\b/gi, 'Geçici Vergi')
    .replace(/\bGecik\s+Vergi\b/gi, 'Geçici Vergi')
    .replace(/\byapı\s*taşla\b/gi, 'planla')
    .replace(/\byapi\s*tasla\b/gi, 'planla')
    .replace(/\bişlemde takılı\b/gi, 'işlem aşamasında bekliyor')
    .replace(/\btakılı\b/gi, 'beklemede')
    .replace(/\btakildi\b/gi, 'beklemede')
    .replace(/\bişlemde beklemede\b/gi, 'işlem aşamasında bekliyor')
    .replace(/\bhemen harekete geç\b/gi, 'öncelik listesine al')
    .replace(/\bhız ver ya da engel varsa çöz\b/gi, 'engeli kontrol edip sıraya al')
    .replace(/\bhızlandırılmalı\b/gi, 'takip edilmeli')
    .replace(/\bhizlandirilmali\b/gi, 'takip edilmeli')
    .replace(/\bzaman daralıyor\b/gi, 'takvim yaklaşıyor')
    .replace(/\bzaman daraliyor\b/gi, 'takvim yaklaşıyor')
    .replace(/\bhemen talep et\b/gi, 'talep planı çıkar');

  if (EARLY_MONTH && /evrak/i.test(value)) {
    value = value
      .replace(/evrak toplama süreci takip edilmeli/gi, 'evrak gelişini izleyip takip listesi hazırlanmalı')
      .replace(/evrak toplama sureci takip edilmeli/gi, 'evrak gelişini izleyip takip listesi hazırlanmalı')
      .replace(/evrak aşamasında beklemede/gi, 'evrak bekleme aşamasında')
      .replace(/evrak asamasinda beklemede/gi, 'evrak bekleme aşamasında');
  }
  return value.replace(/\s+/g, ' ').trim();
}

function fallbackSummary(focus: string): string {
  if (focus === 'critical') return 'Dikkat isteyen konu var; kritik işleri sıraya alıp akışı rahatlatmak gerekiyor.';
  if (focus === 'review') return 'Bugün kontrol günü; kısa bir tarama yarınki yükü hafifletir.';
  if (focus === 'calm') return 'Akış sakin görünüyor; küçük işleri kapatmak için iyi bir pencere var.';
  return EARLY_MONTH
    ? 'Ayın ilk akışındayız; evrak gelişini izleyip takip listesini sakin biçimde hazırlayalım.'
    : 'İş akışı dolu ama yönetilebilir; sırayı bozmazsak tablo toparlanır.';
}

function cleanBriefSummary(summary: string | undefined, focus: string): string {
  const source = String(summary || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const sentences = source.split(/(?<=[.!?])\s+/).filter(Boolean);
  let picked = sentences.find((s) => s.length <= 170 && !COMPANY_WORD_RE.test(s)) || '';
  if (!picked) picked = fallbackSummary(focus);
  picked = picked.replace(/"[^"]{14,}"/g, 'ilgili mükellef');
  if (COMPANY_WORD_RE.test(picked)) picked = fallbackSummary(focus);
  picked = softenCalendarTone(picked);
  picked = picked
    .replace(/\bMOREN AI\s+[^.;!?]{0,80}\btarad[ıi]\b\.?/gi, '')
    .replace(/\bportal verisi\s+[^.;!?]{0,40}\btarand[ıi]\b\.?/gi, '')
    .replace(/\bLuca,\s*Mihsap,\s*KDV\s+[^.;!?]{0,60}\b(okundu|tarandı)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!picked) return fallbackSummary(focus);
  return picked.length > 170 ? `${picked.slice(0, 167).trimEnd()}...` : picked;
}

function cleanBriefMotivation(text: string | undefined, focus: string): string {
  const value = softenCalendarTone(String(text || MOTIVATION_BY_FOCUS[focus] || MOTIVATION_BY_FOCUS.busy))
    .replace(/\bMOREN AI\s+[^.;!?]{0,80}\btarad[ıi]\b\.?/gi, '')
    .replace(/\bportal verisi\s+[^.;!?]{0,40}\btarand[ıi]\b\.?/gi, '')
    .replace(/\bLuca,\s*Mihsap,\s*KDV\s+[^.;!?]{0,60}\b(okundu|tarandı)\b\.?/gi, '')
    .replace(/\s*[—–-]\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = (value.split(/(?<=[.!?])\s+/).find(Boolean) || '').trim();
  const fallback = MOTIVATION_BY_FOCUS[focus] || MOTIVATION_BY_FOCUS.busy;
  const clean = !firstSentence || OPERATIONAL_MOTIVATION_RE.test(firstSentence)
    ? fallback
    : firstSentence;
  return clean.length > 78 ? `${clean.slice(0, 75).trimEnd()}...` : clean;
}

function cleanBriefAlert(text: string): string {
  let value = String(text || '').replace(/\s+/g, ' ').trim();
  value = value.replace(/"[^"]{14,}"/g, 'ilgili mükellef');
  if (COMPANY_WORD_RE.test(value)) value = value.replace(/:.+?(?=\s|$)/, ': ilgili kayıt');
  value = softenCalendarTone(value);
  return value.length > 120 ? `${value.slice(0, 117).trimEnd()}...` : value;
}

function cleanSuggestionText(text: string): string {
  const value = softenCalendarTone(text);
  return value.length > 92 ? `${value.slice(0, 89).trimEnd()}...` : value;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  return `${hr} sa önce`;
}

export function BrifingKart({ userName }: { userName?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<BrifingResponse>({
    queryKey: ['moren-ai-brifing'],
    queryFn: () => api.get('/moren-ai/brifing').then((r) => r.data),
    staleTime: 5 * 60 * 1000,    // 5 dk client cache
    refetchInterval: 5 * 60 * 1000, // her 5 dk yeniden iste (backend zaten 30 dk cache)
    refetchOnWindowFocus: true,
  });

  const handleRefresh = async () => {
    const r = await api.get('/moren-ai/brifing?force=1').then((res) => res.data);
    qc.setQueryData(['moren-ai-brifing'], r);
  };

  const focus = data?.focus ?? 'busy';
  const focusTone = FOCUS_TONES[focus] ?? FOCUS_TONES.busy;
  const chromeTone = BRIEFING_CHROME_TONE;
  const motivation = cleanBriefMotivation(data?.motivation, focus);
  const visibleSummary = cleanBriefSummary(data?.summary, focus);

  return (
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{
        background: 'radial-gradient(circle at 7% 0%, rgba(143,215,189,0.11), transparent 34%), radial-gradient(circle at 95% 10%, rgba(216,189,134,0.08), transparent 31%), linear-gradient(180deg, rgba(8,14,13,0.96), rgba(5,7,7,0.94))',
        border: `1px solid ${chromeTone.border}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      {/* Üst etiket bandı */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(143,215,189,0.65), rgba(216,189,134,0.38), transparent)' }}
      />
      <div
        className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full"
        style={{ background: 'linear-gradient(180deg, #8fd7bd, #d8bd86)', boxShadow: '0 0 18px rgba(143,215,189,0.22)' }}
      />
      <div
        className="px-5 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderBottom: '1px solid rgba(143,215,189,0.08)' }}
      >
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} style={{ color: chromeTone.color }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: chromeTone.text }}>
            Bugünkü Brifing
          </span>
          {data && (
            <span
              className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ml-1 inline-flex items-center gap-1"
              style={{ background: focusTone.bg, color: focusTone.color, border: `1px solid ${focusTone.border}` }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: focusTone.color }} />
              {focusTone.label}
            </span>
          )}
          {data && (
            <span
              className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md inline-flex items-center gap-1"
              style={{ background: 'rgba(216,189,134,0.075)', color: '#d8c38f', border: '1px solid rgba(216,189,134,0.18)' }}
            >
              AI Destekli
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data?.generatedAt && (
            <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
              {data.fromCache ? '↻' : '✓'} {formatRelativeTime(data.generatedAt)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            title="Brifingi yeniden üret"
            className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50"
            style={{
              background: 'rgba(143,215,189,0.055)',
              border: '1px solid rgba(143,215,189,0.14)',
              color: 'rgba(221,246,238,0.72)',
            }}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      {/* Selamlama + AI motivasyon */}
      <div className="px-5 pt-3 pb-2 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] xl:items-start">
        <div className="min-w-0">
          <h2
            style={{
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
              fontSize: 22,
              fontWeight: 800,
              color: '#f6fbf7',
              letterSpacing: 0,
              lineHeight: 1.1,
            }}
          >
            Bugünkü Öncelikler
          </h2>
          <p className="text-[12px] mt-1 tabular-nums" style={{ color: 'rgba(250,250,249,0.42)' }}>
            {KISA_TARIH}{sanitizeFirstName(userName) ? ` · ${sanitizeFirstName(userName)}` : ''}
          </p>
        </div>

        {!isLoading && motivation && (
          <div
            className="w-full rounded-lg px-3 py-2 flex items-center gap-2.5 select-none xl:justify-self-end"
            style={{
              background: 'linear-gradient(135deg, rgba(143,215,189,0.075), rgba(216,189,134,0.045))',
              border: '1px solid rgba(143,215,189,0.16)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)',
            }}
          >
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-black shrink-0"
              style={{ background: focusTone.bg, border: `1px solid ${focusTone.border}`, color: focusTone.color }}
            >
              <Sparkles size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[9px] uppercase font-black tracking-[.14em]" style={{ color: '#d8c38f' }}>
                <Sparkles size={10} />
                Odak Notu
              </span>
              <span className="block mt-0.5 text-[12.5px] font-semibold leading-snug" style={{ color: 'rgba(250,250,249,0.88)' }}>
                {motivation}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Ana özet metni */}
      <div className="px-5 pt-1.5 pb-2 max-w-[1180px]">
        {isLoading ? (
          <div className="rounded-xl px-4 py-3 text-[14px] flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.5)', background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Loader2 size={14} className="animate-spin" />
            Brifing hazırlanıyor...
          </div>
        ) : visibleSummary ? (
          <div
            className="rounded-xl px-4 py-3"
            style={{
              background: 'rgba(255,255,255,0.018)',
              border: '1px solid rgba(143,215,189,0.10)',
              boxShadow: 'inset 3px 0 0 rgba(143,215,189,0.55)',
            }}
          >
          <p
            className="text-[14px]"
            style={{
              color: 'rgba(250,250,249,0.88)',
              lineHeight: 1.58,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {visibleSummary}
          </p>
          </div>
        ) : (
          <p className="rounded-xl px-4 py-3 text-[13.5px]" style={{ color: 'rgba(250,250,249,0.5)', background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.06)' }}>
            Brifing alınamadı. Yenile butonuna basıp tekrar dene.
          </p>
        )}
      </div>

      {/* Uyarılar (alerts) */}
      {data?.alerts && data.alerts.length > 0 && (
        <div className="px-5 pb-3 space-y-1.5 max-w-[1240px]">
          {data.alerts.slice(0, 2).map((a, i) => {
            const effectiveSeverity = EARLY_MONTH && /evrak/i.test(a.text) ? 'low' : a.severity;
            const cfg = effectiveSeverity === 'high'
              ? { color: '#d8bd86', bg: 'rgba(255,255,255,0.024)', border: 'rgba(216,189,134,0.17)' }
              : effectiveSeverity === 'medium'
                ? { color: '#8db6c6', bg: 'rgba(255,255,255,0.022)', border: 'rgba(141,182,198,0.14)' }
                : { color: '#86c7a0', bg: 'rgba(255,255,255,0.020)', border: 'rgba(134,199,160,0.13)' };
            const href = a.href ? normalizeDashboardHref(a.href) : undefined;
            const Inner = (
              <div
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition group"
                style={{
                  background: `linear-gradient(90deg, ${cfg.bg}, rgba(255,255,255,0.012))`,
                  border: `1px solid ${cfg.border}`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.018)',
                }}
              >
                <AlertTriangle size={13} style={{ color: cfg.color }} />
                <span className="text-[13px] flex-1" style={{ color: '#fafaf9' }}>
                  {cleanBriefAlert(a.text)}
                </span>
                {href && (
                  <ArrowRight size={13} className="opacity-50 group-hover:opacity-100 transition" style={{ color: cfg.color }} />
                )}
              </div>
            );
            return href ? (
              <Link key={i} href={href} className="block">
                {Inner}
              </Link>
            ) : (
              <div key={i}>{Inner}</div>
            );
          })}
        </div>
      )}

      {/* Aksiyon önerileri (suggestions) */}
      {data?.suggestions && data.suggestions.length > 0 && (
        <div className="px-5 pb-4 pt-1 grid grid-cols-1 xl:grid-cols-3 gap-2">
          {data.suggestions.slice(0, 3).map((s, i) => {
            const Icon = ICON_MAP[s.icon || 'Sparkles'] || Sparkles;
            const href = normalizeDashboardHref(s.href);
            return (
              <Link
                key={i}
                href={href}
                className="inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition hover:bg-white/[0.035]"
                style={{
                  background: `linear-gradient(135deg, ${chromeTone.actionBg}, rgba(216,189,134,0.035))`,
                  color: 'rgba(228,248,241,0.80)',
                  border: `1px solid ${chromeTone.actionBorder}`,
                }}
              >
                <Icon size={12} />
                {cleanSuggestionText(s.text)}
                <ArrowRight size={11} className="opacity-60" />
              </Link>
            );
          })}
        </div>
      )}

      {/* Suggestion yoksa boş alt boşluk verme — direkt bitir */}
      {(!data?.suggestions || data.suggestions.length === 0) && <div className="pb-4" />}
    </div>
  );
}
