'use client';

import { FieldRow } from '@/lib/log-format';

/**
 * Log mesajını 6-alan tablo halinde render eder.
 * Mockup tasarımına bire bir uyumlu — tüm akış widget'larında ortak.
 *
 * Renk paleti (ağır/mat tonlar):
 *   ✓ full        → koyu yeşil  (#6a9a6c)
 *   ○ empty+öneri → koyu kahve  (#8b6f3a)
 *   ✗ missing     → mat kırmızı (#c85555)
 */
export function LogFieldTable({ rows }: { rows: FieldRow[] }) {
  if (!rows || rows.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 4,
        display: 'grid',
        gridTemplateColumns: '90px 22px 1fr',
        rowGap: 4,
        columnGap: 8,
        fontSize: 11.5,
        padding: '6px 8px',
        background: 'rgba(255,255,255,0.015)',
        borderRadius: 4,
      }}
    >
      {rows.map((r, i) => (
        <RowItem key={`${r.label}-${i}`} row={r} />
      ))}
    </div>
  );
}

function RowItem({ row }: { row: FieldRow }) {
  const { icon, color } = statusStyle(row.status);
  return (
    <>
      <div style={{ color: '#6b6b6b' }}>{row.label}</div>
      <div style={{ textAlign: 'center', fontWeight: 700, color }}>{icon}</div>
      <div style={{ color: '#b0b0b0' }}>
        {row.value}
        {row.meta && (
          <span style={{ color: '#6b6b6b', fontSize: 10.5, marginLeft: 4 }}>{row.meta}</span>
        )}
      </div>
    </>
  );
}

function statusStyle(status: FieldRow['status']) {
  switch (status) {
    case 'full':
      return { icon: '✓', color: '#6a9a6c' };
    case 'empty-with-suggestion':
      return { icon: '○', color: '#8b6f3a' };
    case 'missing':
      return { icon: '✗', color: '#c85555' };
  }
}

/**
 * Sonuç + ek satırlar (Mihsap uyarısı / Hata / kalan satırlar) için ortak block.
 */
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
      style={{
        marginTop: 6,
        paddingTop: 6,
        borderTop: '1px dashed rgba(255,255,255,0.04)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#8a8a8a',
      }}
    >
      {sonuc && (
        <div style={{ color: sonuc.ok ? '#6a9a6c' : '#c85555', fontWeight: 600 }}>
          Sonuç: {sonuc.text}
        </div>
      )}
      {mihsapUyarisi && (
        <div>
          <span style={{ color: '#6b6b6b' }}>Mihsap uyarısı: </span>
          <span style={{ color: '#b0b0b0' }}>"{mihsapUyarisi}"</span>
        </div>
      )}
      {hata && (
        <div>
          <span style={{ color: '#6b6b6b' }}>Hata: </span>
          <span style={{ color: '#c85555', fontWeight: 600 }}>{hata}</span>
        </div>
      )}
      {rawLines?.map((l, i) => (
        <div key={i} style={{ color: '#8a8a8a' }}>{l}</div>
      ))}
    </div>
  );
}
