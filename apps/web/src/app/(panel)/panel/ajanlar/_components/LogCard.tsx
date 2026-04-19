'use client';

import { parseAgentMessage, buildFieldRows } from '@/lib/log-format';
import { LogFieldTable, LogSummary } from './LogFieldTable';

export interface LogEvent {
  id: string;
  ts: string;
  agent?: string;
  status: string;
  mukellef?: string;
  firma?: string;
  fisNo?: string;
  hesapKodu?: string;
  kdv?: string;
  tutar?: number | string;
  message?: string;
  action?: string;
  meta?: any;
}

export function statusStyle(status: string) {
  switch (status) {
    case 'onaylandi':
    case 'basarili':
    case 'ok':
      return { color: '#7aa07c', icon: '✓', label: 'ONAY', bg: 'rgba(60,120,70,.05)', border: '#4d7c4f' };
    case 'hata':
    case 'error':
      return { color: '#d97070', icon: '✗', label: 'HATA', bg: 'rgba(180,50,50,.07)', border: '#b04040' };
    case 'atlandi':
    case 'skip':
      return { color: '#b89870', icon: '↷', label: 'ATLA', bg: 'rgba(180,120,40,.05)', border: '#92744a' };
    case 'demirbas':
      return { color: '#a78bfa', icon: '⏩', label: 'DEMR', bg: 'rgba(168,85,247,.06)', border: '#8b6db5' };
    default:
      return { color: '#94a3b8', icon: '•', label: 'INFO', bg: 'rgba(148,163,184,.04)', border: '#6b6b6b' };
  }
}

export function LogCard({ event }: { event: LogEvent }) {
  const d = new Date(event.ts);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const { color, icon, bg, label, border } = statusStyle(event.status);

  // Mesajı yapısal hale çevir
  const parsed = parseAgentMessage(event.message);
  const rows = buildFieldRows(event, parsed);
  const hasFields = rows.length > 0;
  const hasSummary = !!(parsed.sonuc || parsed.mihsapUyarisi || parsed.hata || parsed.rawLines.length);

  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-md transition-colors hover:brightness-110"
      style={{ background: bg, borderLeft: `3px solid ${border}` }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center rounded text-[11px] font-bold px-1.5 py-0.5"
        style={{ background: color + '33', color, minWidth: 52 }}
      >
        {icon} {label}
      </span>
      <span className="text-[11px] tabular-nums flex-shrink-0 pt-0.5" style={{ color: '#6b6b6b' }}>
        {t}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          {event.firma && (
            <span className="font-semibold truncate" style={{ color: '#b8a06f' }}>
              {event.firma}
            </span>
          )}
          {event.fisNo && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded tabular-nums"
              style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,0.55)' }}
            >
              #{event.fisNo}
            </span>
          )}
          {event.tutar != null && event.tutar !== '' && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded tabular-nums"
              style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,0.55)' }}
            >
              {Number(event.tutar).toLocaleString('tr-TR')} TL
            </span>
          )}
        </div>

        {hasFields && <LogFieldTable rows={rows} />}

        {hasSummary && (
          <LogSummary
            sonuc={parsed.sonuc}
            mihsapUyarisi={parsed.mihsapUyarisi}
            hata={parsed.hata}
            rawLines={parsed.rawLines}
          />
        )}

        {/* Hiç structured veri yoksa düz mesaj göster (eski kayıtlar için) */}
        {!hasFields && !hasSummary && event.message && (
          <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a', lineHeight: '1.5' }}>
            {event.message}
          </div>
        )}

        {event.mukellef && (
          <div className="text-[10px] mt-1 truncate uppercase tracking-wide" style={{ color: '#4a4a4a' }}>
            {event.mukellef}
          </div>
        )}
      </div>
    </div>
  );
}
