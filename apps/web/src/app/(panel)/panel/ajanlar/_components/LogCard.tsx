'use client';

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
}

export function statusStyle(status: string) {
  switch (status) {
    case 'onaylandi':
    case 'basarili':
    case 'ok':
      return { color: '#22c55e', icon: '✓', label: 'ONAY', bg: 'rgba(34,197,94,.08)' };
    case 'hata':
    case 'error':
      return { color: '#ef4444', icon: '✗', label: 'HATA', bg: 'rgba(239,68,68,.12)' };
    case 'atlandi':
    case 'skip':
      return { color: '#f59e0b', icon: '↷', label: 'ATLA', bg: 'rgba(245,158,11,.08)' };
    case 'demirbas':
      return { color: '#a855f7', icon: '⏩', label: 'DEMR', bg: 'rgba(168,85,247,.08)' };
    default:
      return { color: '#94a3b8', icon: '•', label: 'INFO', bg: 'rgba(148,163,184,.06)' };
  }
}

export function LogCard({ event }: { event: LogEvent }) {
  const d = new Date(event.ts);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const { color, icon, bg, label } = statusStyle(event.status);
  const parts = [
    event.fisNo && `#${event.fisNo}`,
    event.hesapKodu,
    event.kdv,
    event.tutar ? `${Number(event.tutar).toLocaleString('tr-TR')} TL` : null,
  ].filter(Boolean);

  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-md transition-colors hover:brightness-110"
      style={{ background: bg, borderLeft: `3px solid ${color}` }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center rounded text-[11px] font-bold px-1.5 py-0.5"
        style={{ background: color + '33', color, minWidth: 52 }}
      >
        {icon} {label}
      </span>
      <span className="text-[11px] tabular-nums flex-shrink-0 pt-0.5" style={{ color: '#94a3b8' }}>
        {t}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          {event.firma && (
            <span className="font-semibold truncate" style={{ color: 'var(--text)' }}>
              {event.firma}
            </span>
          )}
          {parts.map((p, i) => (
            <span
              key={i}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,.06)', color: 'var(--text-secondary, #cbd5e1)' }}
            >
              {p as any}
            </span>
          ))}
        </div>
        {event.message && (
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {event.message}
          </div>
        )}
        {event.mukellef && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
            {event.mukellef}
          </div>
        )}
      </div>
    </div>
  );
}
