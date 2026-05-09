'use client';

import { FieldRow } from '@/lib/log-format';

const DOCUMENT_LABELS = new Set([
  'Tarih',
  'Belge No',
  'Cari',
  'Kaynak',
  'Belge Türü',
  'Belge TÃ¼rÃ¼',
  'Fatura Tipi',
  'Alış/Satış Türü',
  'AlÄ±ÅŸ/SatÄ±ÅŸ TÃ¼rÃ¼',
  'Toplam Tutar',
]);

function isAccountRow(row: FieldRow) {
  return /^(Matrah|KDV|Cari Hesab|Gider Hesab)/i.test(row.label);
}

export function LogFieldTable({ rows }: { rows: FieldRow[] }) {
  if (!rows || rows.length === 0) return null;

  const documentRows = rows.filter((row) => DOCUMENT_LABELS.has(row.label));
  const accountRows = rows.filter(isAccountRow);
  const decisionRows = rows.filter((row) => row.label === 'Onay' || row.label === 'İçerik' || row.label === 'Ä°Ã§erik');
  const otherRows = rows.filter(
    (row) => !DOCUMENT_LABELS.has(row.label) && !isAccountRow(row) && row.label !== 'Onay' && row.label !== 'İçerik' && row.label !== 'Ä°Ã§erik',
  );

  return (
    <div className="mt-2 space-y-2">
      {documentRows.length > 0 && (
        <section
          className="grid gap-1.5 rounded-md p-2"
          style={{
            background: 'rgba(255,255,255,0.018)',
            border: '1px solid rgba(255,255,255,0.04)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          }}
        >
          {documentRows.map((row, i) => (
            <InfoTile key={`${row.label}-${i}`} row={row} />
          ))}
        </section>
      )}

      {accountRows.length > 0 && (
        <section
          className="rounded-md p-2"
          style={{
            background: 'rgba(15,13,10,0.34)',
            border: '1px solid rgba(184,160,111,0.10)',
          }}
        >
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#8d7442' }}>
            Muhasebe kaydı
          </div>
          <div className="space-y-1">
            {accountRows.map((row, i) => (
              <AccountLine key={`${row.label}-${i}`} row={row} />
            ))}
          </div>
        </section>
      )}

      {(decisionRows.length > 0 || otherRows.length > 0) && (
        <section
          className="grid gap-1.5 rounded-md p-2"
          style={{
            background: 'rgba(255,255,255,0.012)',
            border: '1px solid rgba(255,255,255,0.035)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          {[...otherRows, ...decisionRows].map((row, i) => (
            <InfoTile key={`${row.label}-${i}`} row={row} quiet />
          ))}
        </section>
      )}
    </div>
  );
}

function InfoTile({ row, quiet = false }: { row: FieldRow; quiet?: boolean }) {
  const style = statusStyle(row.status);
  return (
    <div
      className="min-w-0 rounded px-2 py-1.5"
      style={{
        background: quiet ? 'rgba(255,255,255,0.012)' : 'rgba(255,255,255,0.018)',
        border: `1px solid ${style.border}`,
      }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#6f6a62' }}>
        <StatusDot color={style.color} />
        <span>{row.label}</span>
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold" style={{ color: style.text }}>
        {row.value || '-'}
      </div>
      {row.meta && (
        <div className="mt-0.5 truncate text-[10.5px]" style={{ color: style.meta }}>
          {row.meta}
        </div>
      )}
    </div>
  );
}

function AccountLine({ row }: { row: FieldRow }) {
  const style = statusStyle(row.status);
  const isKdv = /^KDV/i.test(row.label);
  const isMatrah = /^Matrah|^Gider/i.test(row.label);

  return (
    <div
      className="grid items-center gap-2 rounded px-2 py-1.5 text-[12px]"
      style={{
        gridTemplateColumns: '96px 1fr',
        background: isMatrah
          ? 'rgba(34,197,94,0.045)'
          : isKdv
            ? 'rgba(59,130,246,0.045)'
            : 'rgba(255,255,255,0.018)',
        border: `1px solid ${style.border}`,
      }}
    >
      <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide" style={{ color: style.label }}>
        <StatusDot color={style.color} />
        <span>{row.label}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold tabular-nums" style={{ color: style.text }}>
          {row.value || '-'}
        </div>
        {row.meta && (
          <div className="truncate text-[10.5px]" style={{ color: style.meta }}>
            {row.meta}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 0 3px ${color}1f`,
        flexShrink: 0,
      }}
    />
  );
}

function statusStyle(status: FieldRow['status']) {
  switch (status) {
    case 'full':
      return {
        color: '#6fa873',
        label: '#8ea98f',
        text: '#d0d0ce',
        meta: '#7b8a78',
        border: 'rgba(111,168,115,0.14)',
      };
    case 'empty-with-suggestion':
      return {
        color: '#d1a84e',
        label: '#b89a5d',
        text: '#e2cf9d',
        meta: '#a88745',
        border: 'rgba(209,168,78,0.18)',
      };
    case 'warning':
      return {
        color: '#e0b44f',
        label: '#c7a257',
        text: '#e4c681',
        meta: '#c69b42',
        border: 'rgba(224,180,79,0.22)',
      };
    case 'missing':
      return {
        color: '#d65f5f',
        label: '#bd7777',
        text: '#e0a0a0',
        meta: '#c87878',
        border: 'rgba(214,95,95,0.22)',
      };
  }
}

export function LogSummary({
  sonuc,
  mihsapUyarisi,
  hata,
  rawLines,
}: {
  sonuc?: { ok: boolean; text: string };
  mihsapUyarisi?: string;
  hata?: string;
  rawLines?: string[];
}) {
  const hasAny = !!(sonuc || mihsapUyarisi || hata || (rawLines && rawLines.length));
  if (!hasAny) return null;

  return (
    <div
      className="mt-2 rounded-md px-2 py-1.5 text-[12px]"
      style={{
        background: 'rgba(255,255,255,0.012)',
        border: '1px dashed rgba(255,255,255,0.055)',
        color: '#8a8a8a',
        lineHeight: 1.5,
      }}
    >
      {sonuc && (
        <div style={{ color: sonuc.ok ? '#6fa873' : '#d65f5f', fontWeight: 700 }}>
          Sonuc: {sonuc.text}
        </div>
      )}
      {mihsapUyarisi && (
        <div>
          <span style={{ color: '#6f6a62' }}>Mihsap uyarisi: </span>
          <span style={{ color: '#c9c0ae' }}>"{mihsapUyarisi}"</span>
        </div>
      )}
      {hata && (
        <div>
          <span style={{ color: '#6f6a62' }}>Hata: </span>
          <span style={{ color: '#d65f5f', fontWeight: 700 }}>{hata}</span>
        </div>
      )}
      {rawLines?.map((line, i) => (
        <div key={i} style={{ color: '#8a8a8a' }}>
          {line}
        </div>
      ))}
    </div>
  );
}
