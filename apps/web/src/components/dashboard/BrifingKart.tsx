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
import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, RefreshCw, Loader2, AlertTriangle, ArrowRight,
  Receipt, FileText, FileCheck, Bell, Zap, Calendar, Clock,
  EyeOff, TimerReset, CheckCircle2,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

const GOLD = '#d4b876';

interface BrifingAlert {
  id?: string;
  severity: 'high' | 'medium' | 'low';
  text: string;
  href?: string;
  source?: string;
}
interface BrifingSuggestion {
  id?: string;
  text: string;
  href: string;
  icon?: string;
  source?: string;
}
interface BrifingSourceTag {
  key: string;
  label: string;
  count: number;
}
interface BrifingSection {
  key: 'today' | 'risk' | 'action';
  title: string;
  items: string[];
}
interface BrifingResponse {
  summary: string;
  alerts: BrifingAlert[];
  suggestions: BrifingSuggestion[];
  focus: 'calm' | 'busy' | 'critical' | 'review';
  sourceTags?: BrifingSourceTag[];
  sections?: BrifingSection[];
  metrics: Record<string, any>;
  generatedAt: string;
  fromCache: boolean;
}

const ICON_MAP: Record<string, any> = {
  Receipt, FileText, FileCheck, Bell, Sparkles, Zap, Calendar, Clock, ArrowRight,
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

const SELAMLAMA = (() => {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
})();

const KISA_TARIH = new Date().toLocaleDateString('tr-TR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const FOCUS_TONES: Record<string, { label: string; color: string; bg: string; glow: string; border: string; actionBg: string; actionBorder: string; text: string }> = {
  calm: {
    label: 'Sakin',
    color: '#7dd3a8',
    bg: 'rgba(42,118,89,0.16)',
    glow: 'rgba(42,118,89,0.18)',
    border: 'rgba(125,211,168,0.28)',
    actionBg: 'linear-gradient(135deg, rgba(125,211,168,0.14), rgba(125,211,168,0.06))',
    actionBorder: 'rgba(125,211,168,0.28)',
    text: '#b8e6c9',
  },
  busy: {
    label: 'Yoğun',
    color: '#d4b876',
    bg: 'rgba(212,184,118,0.13)',
    glow: 'rgba(212,184,118,0.13)',
    border: 'rgba(212,184,118,0.26)',
    actionBg: 'linear-gradient(135deg, rgba(212,184,118,0.14), rgba(212,184,118,0.06))',
    actionBorder: 'rgba(212,184,118,0.28)',
    text: GOLD,
  },
  critical: {
    label: 'Kritik',
    color: '#fb7185',
    bg: 'rgba(190,18,60,0.14)',
    glow: 'rgba(190,18,60,0.20)',
    border: 'rgba(251,113,133,0.34)',
    actionBg: 'linear-gradient(135deg, rgba(251,113,133,0.16), rgba(251,113,133,0.06))',
    actionBorder: 'rgba(251,113,133,0.34)',
    text: '#fda4af',
  },
  review: {
    label: 'Kontrol',
    color: '#93c5fd',
    bg: 'rgba(37,99,235,0.13)',
    glow: 'rgba(37,99,235,0.17)',
    border: 'rgba(147,197,253,0.30)',
    actionBg: 'linear-gradient(135deg, rgba(147,197,253,0.14), rgba(147,197,253,0.06))',
    actionBorder: 'rgba(147,197,253,0.30)',
    text: '#bfdbfe',
  },
};

const MOTIVATION_BY_FOCUS: Record<string, string[]> = {
  calm: [
    'Sakin akış güzel; küçük işleri kapatınca gün hafifler.',
    'Bugün tempo yumuşak; düzenli birkaç dokunuş yeter.',
    'Ritim iyi; masadaki küçük işleri sessizce bitirelim.',
    'Bugün nefes var; temizlik işleri için iyi bir pencere.',
    'Akış sakin; ufak pürüzleri toplamak için doğru zaman.',
  ],
  busy: [
    'Yoğunluk var; sırayı korursak gün kendini toplar.',
    'Bir işi seç, temiz kapat; akış hemen nefes alır.',
    'Tempo yüksek ama yönetilebilir; listeyi dağıtmadan ilerleyelim.',
    'Bugün iş çok; net sıra, kısa hamle, temiz kapanış.',
    'Kalabalık görünüyor; öncelik verince tablo güzelleşir.',
  ],
  critical: [
    'Önce kırmızıları kapatalım; kahve sonra daha tatlı.',
    'Kritik işi öne al; günün ağırlığı orada azalır.',
    'Acil noktayı şimdi çözelim; sonrası daha rahat akar.',
    'Kırmızı alanı küçültelim; ofisin nabzı hemen düşer.',
    'Bugünün kilidi kritik işte; onu açınca yol ferahlar.',
  ],
  review: [
    'Kısa bir kontrol, yarının yükünü bugünden inceltir.',
    'Kontrol turu atalım; küçük farklar büyümeden kapanır.',
    'Bugün gözden geçirme günü; netlik yarına yatırım.',
    'Bir tur kontrol iyi gelir; tabloyu pürüzsüz bırakalım.',
    'Kısa bakış, temiz karar; yarın daha hafif başlar.',
  ],
};

const COMPANY_WORD_RE = /\b(LİMİTED|ANONİM|ŞİRKETİ|TİCARET|SANAYİ|PAZARLAMA|GIDA|İNŞAAT|TURİZM|A\.Ş|LTD|LTD\.ŞTİ)\b/i;
const PERSON_NAME_RE = /\b(?!KDV\b|SGK\b|GIB\b|GİB\b|LUCA\b|MIHSAP\b|MİHSAP\b)([A-ZÇĞİÖŞÜ]{2,})(?:\s+[A-ZÇĞİÖŞÜ]{2,}){1,3}\b/g;
const TODAY_DAY = new Date().getDate();
const EARLY_MONTH = TODAY_DAY <= 12;
const SAFE_PANEL_ROUTES = [
  '/panel/ajanlar/mihsap',
  '/panel/is-yuku',
  '/panel/gorevler',
  '/panel/beyannameler',
  '/panel/kdv-kontrol',
  '/panel/mukellefler',
  '/panel/ajanlar',
];
const BRIEF_ITEM_STATE_KEY = 'moren-dashboard-briefing-item-state-v1';
type BriefItemState = Record<string, { status: 'hidden' | 'snoozed' | 'done'; until: number }>;
const SECTION_TONE: Record<string, { color: string; bg: string; border: string; icon: any }> = {
  today: { color: '#d4b876', bg: 'rgba(212,184,118,0.10)', border: 'rgba(212,184,118,0.22)', icon: Calendar },
  risk: { color: '#fb7185', bg: 'rgba(251,113,133,0.10)', border: 'rgba(251,113,133,0.24)', icon: AlertTriangle },
  action: { color: '#93c5fd', bg: 'rgba(147,197,253,0.10)', border: 'rgba(147,197,253,0.22)', icon: Zap },
};

function readBriefItemState(): BriefItemState {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(BRIEF_ITEM_STATE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeBriefItemState(state: BriefItemState) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(BRIEF_ITEM_STATE_KEY, JSON.stringify(state));
}

function normalizeDashboardHref(href?: string): string {
  const value = String(href || '').trim();
  const [path, query = ''] = value.split('?');
  for (const route of SAFE_PANEL_ROUTES) {
    if (path === route || path.startsWith(`${route}/`)) return query ? `${route}?${query}` : route;
  }
  return '/panel';
}

function softenCalendarTone(text: string): string {
  let value = String(text || '')
    .replace(/\bGeçik\s+Vergi\b/gi, 'Geçici Vergi')
    .replace(/\bGecik\s+Vergi\b/gi, 'Geçici Vergi')
    .replace(/\byapı\s*taşla\b/gi, 'planla')
    .replace(/\byapi\s*tasla\b/gi, 'planla')
    .replace(/\btakılı\b/gi, 'beklemede')
    .replace(/\btakildi\b/gi, 'beklemede')
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

function scrubTaxpayerNames(text: string): string {
  return String(text || '').replace(PERSON_NAME_RE, 'ilgili mükellef');
}

function fallbackSummary(focus: string): string {
  if (focus === 'critical') return 'Dikkat isteyen konu var; önce kırmızı işleri kapatıp akışı rahatlatmak gerekiyor.';
  if (focus === 'review') return 'Bugün kontrol günü; kısa bir tarama yarınki yükü hafifletir.';
  if (focus === 'calm') return 'Akış sakin görünüyor; küçük işleri kapatmak için iyi bir pencere var.';
  return EARLY_MONTH
    ? 'Ayın ilk akışındayız; evrak gelişini izleyip takip listesini sakin biçimde hazırlayalım.'
    : 'İş akışı dolu ama yönetilebilir; sırayı bozmazsak tablo toparlanır.';
}

function cleanBriefSummary(summary: string | undefined, focus: string): string {
  const source = scrubTaxpayerNames(String(summary || '')).replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const sentences = source.split(/(?<=[.!?])\s+/).filter(Boolean);
  let picked = sentences.find((s) => s.length <= 170 && !COMPANY_WORD_RE.test(s)) || '';
  if (!picked) picked = fallbackSummary(focus);
  picked = picked.replace(/"[^"]{14,}"/g, 'ilgili mükellef');
  if (COMPANY_WORD_RE.test(picked)) picked = fallbackSummary(focus);
  picked = softenCalendarTone(picked);
  return picked.length > 170 ? `${picked.slice(0, 167).trimEnd()}...` : picked;
}

function cleanBriefAlert(text: string): string {
  let value = scrubTaxpayerNames(String(text || '')).replace(/\s+/g, ' ').trim();
  value = value.replace(/"[^"]{14,}"/g, 'ilgili mükellef');
  if (COMPANY_WORD_RE.test(value)) value = value.replace(/:.+?(?=\s|$)/, ': ilgili kayıt');
  value = softenCalendarTone(value);
  return value.length > 120 ? `${value.slice(0, 117).trimEnd()}...` : value;
}

function cleanSuggestionText(text: string): string {
  const value = softenCalendarTone(text);
  return value.length > 92 ? `${value.slice(0, 89).trimEnd()}...` : value;
}

function hashBriefingSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickMotivation(focus: string, seed: string): string {
  const pool = MOTIVATION_BY_FOCUS[focus] ?? MOTIVATION_BY_FOCUS.busy;
  return pool[hashBriefingSeed(seed) % pool.length];
}

function briefItemId(prefix: string, id: string | undefined, text: string): string {
  return id || `${prefix}-${hashBriefingSeed(text)}`;
}

function isBriefItemVisible(id: string, state: BriefItemState): boolean {
  const item = state[id];
  return !item || item.until <= Date.now();
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  return `${hr} sa önce`;
}

function BriefingItemControls({ id, onMark }: { id: string; onMark: (id: string, status: 'hidden' | 'snoozed' | 'done') => void }) {
  const btnStyle = {
    background: 'rgba(255,255,255,0.035)',
    border: '1px solid rgba(255,255,255,0.07)',
    color: 'rgba(250,250,249,0.48)',
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" title="2 saat ertele" onClick={() => onMark(id, 'snoozed')} className="h-7 w-7 rounded-md grid place-items-center transition hover:text-[#d4b876]" style={btnStyle}>
        <TimerReset size={12} />
      </button>
      <button type="button" title="Bugün gizle" onClick={() => onMark(id, 'hidden')} className="h-7 w-7 rounded-md grid place-items-center transition hover:text-[#fda4af]" style={btnStyle}>
        <EyeOff size={12} />
      </button>
      <button type="button" title="Tamamlandı say" onClick={() => onMark(id, 'done')} className="h-7 w-7 rounded-md grid place-items-center transition hover:text-[#86efac]" style={btnStyle}>
        <CheckCircle2 size={12} />
      </button>
    </div>
  );
}

export function BrifingKart({ userName }: { userName?: string }) {
  const qc = useQueryClient();
  const [itemState, setItemState] = useState<BriefItemState>({});
  const { data, isLoading, isFetching } = useQuery<BrifingResponse>({
    queryKey: ['moren-ai-brifing'],
    queryFn: () => api.get('/moren-ai/brifing').then((r) => r.data),
    staleTime: 5 * 60 * 1000,    // 5 dk client cache
    refetchInterval: 5 * 60 * 1000, // her 5 dk yeniden iste (backend zaten 30 dk cache)
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setItemState(readBriefItemState());
  }, []);

  const handleRefresh = async () => {
    const r = await api.get('/moren-ai/brifing?force=1').then((res) => res.data);
    qc.setQueryData(['moren-ai-brifing'], r);
  };

  const markBriefItem = (id: string, status: 'hidden' | 'snoozed' | 'done') => {
    const hours = status === 'snoozed' ? 2 : status === 'done' ? 24 : 12;
    setItemState((prev) => {
      const next = { ...prev, [id]: { status, until: Date.now() + hours * 60 * 60 * 1000 } };
      writeBriefItemState(next);
      return next;
    });
  };

  const restoreBriefItems = () => {
    setItemState({});
    writeBriefItemState({});
  };

  const focus = data?.focus ?? 'busy';
  const focusTone = FOCUS_TONES[focus] ?? FOCUS_TONES.busy;
  const motivationSeed = `${focus}:${data?.generatedAt ?? KISA_TARIH}:${data?.summary ?? ''}:${data?.alerts?.length ?? 0}`;
  const motivation = pickMotivation(focus, motivationSeed);
  const visibleSummary = cleanBriefSummary(data?.summary, focus);
  const visibleAlerts = useMemo(
    () => (data?.alerts || []).filter((a) => isBriefItemVisible(briefItemId('alert', a.id, a.text), itemState)),
    [data?.alerts, itemState],
  );
  const visibleSuggestions = useMemo(
    () => (data?.suggestions || []).filter((s) => isBriefItemVisible(briefItemId('suggestion', s.id, s.text), itemState)),
    [data?.suggestions, itemState],
  );
  const hiddenCount = (data?.alerts || []).length + (data?.suggestions || []).length - visibleAlerts.length - visibleSuggestions.length;

  return (
    <div
      className="rounded-[28px] overflow-hidden relative"
      style={{
        background: `radial-gradient(circle at 12% 0%, ${focusTone.glow}, transparent 42%), radial-gradient(circle at 88% 18%, rgba(212,184,118,0.10), transparent 34%), linear-gradient(135deg, rgba(35,30,24,0.84), rgba(14,13,10,0.96))`,
        border: '1px solid rgba(212,184,118,0.22)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Üst etiket bandı */}
      <div className="px-5 pt-4 pb-1 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} style={{ color: focusTone.color }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: focusTone.text }}>
            Bugünkü Brifing
          </span>
          {data && (
            <span
              className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-1 inline-flex items-center gap-1"
              style={{ background: focusTone.bg, color: focusTone.color, border: `1px solid ${focusTone.color}30` }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: focusTone.color }} />
              {focusTone.label}
            </span>
          )}
          {(data?.sourceTags || []).slice(0, 4).map((tag) => (
            <span
              key={tag.key}
              className="text-[9.5px] font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1"
              style={{ background: 'rgba(255,255,255,0.035)', color: 'rgba(250,250,249,0.50)', border: '1px solid rgba(255,255,255,0.07)' }}
              title={`Kaynak: ${tag.label}`}
            >
              {tag.label}
              <span className="tabular-nums" style={{ color: focusTone.text }}>{tag.count}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={restoreBriefItems}
              className="text-[10.5px] px-2 py-1 rounded-md transition"
              style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.52)' }}
            >
              {hiddenCount} geri al
            </button>
          )}
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
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(250,250,249,0.6)',
            }}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      {data?.summary && (
        <div className="px-5 pb-1 flex justify-start xl:justify-end xl:absolute xl:right-5 xl:top-[72px] xl:p-0">
          <div
            className="inline-flex w-full xl:w-auto xl:max-w-[520px] items-center gap-2 rounded-2xl px-3.5 py-2 text-[12.5px] font-semibold"
            style={{
              background: `linear-gradient(135deg, ${focusTone.bg}, rgba(255,255,255,0.025))`,
              color: focusTone.text,
              border: `1px solid ${focusTone.actionBorder}`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
            }}
          >
            <Sparkles size={12} />
            {motivation}
          </div>
        </div>
      )}

      {/* Selamlama başlığı */}
      <div className="px-5 pt-2 pb-2 max-w-[920px]">
        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 26,
            fontWeight: 600,
            color: '#fafaf9',
            letterSpacing: '-.025em',
            lineHeight: 1.1,
          }}
        >
          {SELAMLAMA}
          {sanitizeFirstName(userName) ? `, ${sanitizeFirstName(userName)}` : ''}
        </h2>
        <p className="text-[12px] mt-1 tabular-nums" style={{ color: 'rgba(250,250,249,0.42)' }}>
          {KISA_TARIH}
        </p>
      </div>

      {/* Ana özet metni */}
      <div className="px-5 pb-2 max-w-[1120px]">
        {isLoading ? (
          <div className="text-[14px] flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={14} className="animate-spin" />
            Brifing hazırlanıyor...
          </div>
        ) : visibleSummary ? (
          <p
            className="text-[14px]"
            style={{
              color: 'rgba(250,250,249,0.85)',
              lineHeight: 1.55,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {visibleSummary}
          </p>
        ) : (
          <p className="text-[13.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Brifing alınamadı. Yenile butonuna basıp tekrar dene.
          </p>
        )}
      </div>

      {data?.sections && data.sections.length > 0 && (
        <div className="px-5 pb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          {data.sections.slice(0, 3).map((section) => {
            const tone = SECTION_TONE[section.key] ?? SECTION_TONE.today;
            const Icon = tone.icon;
            return (
              <div
                key={section.key}
                className="rounded-xl px-3 py-2.5 min-h-[96px]"
                style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
              >
                <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-[.16em]" style={{ color: tone.color }}>
                  <Icon size={12} />
                  {section.title}
                </div>
                <div className="mt-2 space-y-1">
                  {section.items.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="text-[12px] leading-snug" style={{ color: 'rgba(250,250,249,0.72)' }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Uyarılar (alerts) */}
      {visibleAlerts.length > 0 && (
        <div className="px-5 pb-3 space-y-1.5 max-w-[1240px]">
          {visibleAlerts.slice(0, 3).map((a, i) => {
            const effectiveSeverity = EARLY_MONTH && /evrak/i.test(a.text) ? 'low' : a.severity;
            const cfg = effectiveSeverity === 'high'
              ? { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.32)' }
              : effectiveSeverity === 'medium'
                ? { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.32)' }
                : { color: '#f5a6b8', bg: 'rgba(245,166,184,0.10)', border: 'rgba(245,166,184,0.28)' };
            const href = a.href ? normalizeDashboardHref(a.href) : undefined;
            const id = briefItemId('alert', a.id, a.text);
            const Inner = (
              <div
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition group"
                style={{
                  background: cfg.bg,
                  border: `1px solid ${cfg.border}`,
                }}
              >
                <AlertTriangle size={13} style={{ color: cfg.color }} />
                <Link href={href || '/panel'} className="min-w-0 flex flex-1 items-center gap-2">
                  <span className="text-[13px] flex-1" style={{ color: '#fafaf9' }}>
                    {cleanBriefAlert(a.text)}
                  </span>
                  {a.source && (
                    <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded" style={{ color: cfg.color, background: 'rgba(255,255,255,0.045)' }}>
                      {a.source}
                    </span>
                  )}
                  {href && (
                    <ArrowRight size={13} className="opacity-50 group-hover:opacity-100 transition" style={{ color: cfg.color }} />
                  )}
                </Link>
                <BriefingItemControls id={id} onMark={markBriefItem} />
              </div>
            );
            return <div key={id || i}>{Inner}</div>;
          })}
        </div>
      )}

      {data && hiddenCount > 0 && visibleAlerts.length === 0 && visibleSuggestions.length === 0 && (
        <div className="px-5 pb-3">
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'rgba(125,211,168,0.08)', border: '1px solid rgba(125,211,168,0.18)', color: '#b8e6c9' }}>
            Brifing maddeleri temizlendi. Geri al butonuyla tekrar gösterebilirsin.
          </div>
        </div>
      )}

      {/* Aksiyon önerileri (suggestions) */}
      {visibleSuggestions.length > 0 && (
        <div className="px-5 pb-5 pt-1 grid grid-cols-1 xl:grid-cols-3 gap-2">
          {visibleSuggestions.slice(0, 3).map((s, i) => {
            const Icon = ICON_MAP[s.icon || 'Sparkles'] || Sparkles;
            const href = normalizeDashboardHref(s.href);
            const id = briefItemId('suggestion', s.id, s.text);
            return (
              <div
                key={id || i}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5"
                style={{
                  background: focusTone.actionBg,
                  color: focusTone.text,
                  border: `1px solid ${focusTone.actionBorder}`,
                }}
              >
                <Link href={href} className="min-w-0 flex flex-1 items-center justify-between gap-2 text-[12.5px] font-semibold transition hover:scale-[1.01]">
                  <Icon size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1">{cleanSuggestionText(s.text)}</span>
                  <ArrowRight size={11} className="opacity-60 shrink-0" />
                </Link>
                <BriefingItemControls id={id} onMark={markBriefItem} />
              </div>
            );
          })}
        </div>
      )}

      {/* Suggestion yoksa boş alt boşluk verme — direkt bitir */}
      {visibleSuggestions.length === 0 && <div className="pb-5" />}
    </div>
  );
}
