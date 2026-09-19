'use client';

import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { BarChart3 } from 'lucide-react';
import { BEYAN_ETIKETLER } from '@/lib/beyanname-takip';
import type { OzetRow } from '@/lib/beyanname-takip';
import './beyan-grafigi.css';

const PARTS = [
  { key: 'onaylanan', label: 'Onaylanan', color: '#299c78' },
  { key: 'bekleyen', label: 'Onay bekleyen', color: '#dfac49' },
  { key: 'hatali', label: 'Hatalı', color: '#d46b85' },
  { key: 'kalan', label: 'Kalan', color: '#bbc9dc' },
  { key: 'muaf', label: 'Muaf', color: '#c5ceda' },
] as const;

const TYPE_ORDER: Partial<Record<OzetRow['beyanTipi'], number>> = { KDV1: 0, KDV2: 1, DAMGA: 2, MUHSGK: 3 };

export function BeyanGrafigi({ rows, loading, error }: {
  rows: OzetRow[];
  loading: boolean;
  error: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const declarations = rows.filter(row => row.beyanTipi !== 'BILDIRGE' && row.beyanTipi !== 'EDEFTER')
    .sort((a, b) => (TYPE_ORDER[a.beyanTipi] ?? 4) - (TYPE_ORDER[b.beyanTipi] ?? 4));
  const hasExempt = declarations.some(row => row.muaf > 0);
  const active = declarations.filter(row => row.toplam > 0);
  const visible = showAll ? declarations : active.slice(0, 8);
  const valid = declarations.every(row => [row.toplam, ...PARTS.map(part => row[part.key])]
    .every(value => Number.isInteger(value) && value >= 0)
    && PARTS.reduce((sum, part) => sum + row[part.key], 0) === row.toplam);
  const max = Math.max(1, ...visible.map(row => row.toplam));
  // Tam sayılı, eşit dört aralık; veri üstünde etiket için boşluk kalır.
  const step = max > 20 ? Math.ceil(max / 20) * 5 : Math.max(1, Math.ceil(max / 4));
  const ceiling = step * 4;
  const unavailable = error || !valid;
  const selectedKey = hovered ?? focused;
  const selectedIndex = visible.findIndex(row => `${row.beyanTipi}-${row.vergiDonem}` === selectedKey);
  const selected = visible[selectedIndex];

  return (
    <section className="ofis-beyan" aria-label="Beyanname dağılımı" aria-busy={loading}>
      <header className="ofis-beyan__header">
        <div className="ofis-beyan__heading"><span className="ofis-beyan__icon" aria-hidden="true"><BarChart3 size={17} /></span><div><h3>Beyanname görünümü</h3><p>Türlere göre durum dağılımı</p></div></div>
        {!loading && !unavailable && declarations.length > 0 && (
          <button type="button" aria-pressed={showAll} onClick={() => { setShowAll(!showAll); setHovered(null); setFocused(null); }}>
            {showAll ? 'İlk 8 aktif tür' : `Tüm türler (${declarations.length})`}
          </button>
        )}
      </header>
      <ul className="ofis-beyan__legend" aria-label="Durum renkleri">
        {PARTS.filter(part => part.key !== 'muaf' || hasExempt).map(part => <li key={part.key}><i style={{ background: part.color }} aria-hidden="true" />{part.label}</li>)}
      </ul>
      {loading || unavailable || visible.length === 0 ? (
        <div className="ofis-beyan__empty" role="status">
          {loading ? 'Beyannameler yükleniyor…' : unavailable ? 'Beyanname verisi görüntülenemiyor.' : declarations.length === 0 ? 'Bu dönemde beyanname kaydı yok.' : 'Bu dönemde aktif beyanname yok. Tüm türleri görüntüleyebilirsiniz.'}
        </div>
      ) : (
        <div className="ofis-beyan__plot">
          <div className="ofis-beyan__scale" aria-hidden="true">{[4,3,2,1,0].map((n,i)=><span key={n} style={{ top: `${9.677 + i * 20.1615}%` }}>{step*n}</span>)}</div>
          <div className="ofis-beyan__scroll" tabIndex={0} role="region" aria-label="Beyanname sütunları; diğer türler için yatay kaydırın">
            <div className="ofis-beyan__columns" style={{ '--beyan-columns': visible.length } as CSSProperties}>
              {visible.map((row, index) => {
                const key = `${row.beyanTipi}-${row.vergiDonem}`;
                const height = row.toplam / ceiling * 100;
                const clip = `${id}-column-${index}`;
                const label = BEYAN_ETIKETLER[row.beyanTipi];
                let used = 0;
                let previousHeight = 0;
                return (
                  <button type="button" key={key} className="ofis-beyan__column"
                    aria-label={`${label}, toplam ${row.toplam}. ${PARTS.map(part => `${part.label} ${row[part.key]}`).join(', ')}`}
                    aria-describedby={selectedKey === key ? `${id}-tooltip` : undefined}
                    onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}
                    onFocus={() => setFocused(key)} onBlur={() => setFocused(null)}
                    onKeyDown={event => { if (event.key === 'Escape') { setHovered(null); setFocused(null); } }}>
                    <span className="ofis-beyan__drawing">
                      <svg viewBox="0 0 80 124" preserveAspectRatio="none" aria-hidden="true">
                        <defs><clipPath id={clip}><path d={`M 20 112 V ${112 - height + Math.min(7, height)} Q 20 ${112 - height} 27 ${112 - height} H 53 Q 60 ${112 - height} 60 ${112 - height + Math.min(7, height)} V 112 Z`} /></clipPath></defs>
                        <g clipPath={`url(#${clip})`}>
                          {PARTS.map(part => {
                            const segmentHeight = row[part.key] / ceiling * 100;
                            const boundary = 112 - used;
                            const separator = segmentHeight >= 4 && previousHeight >= 4;
                            used += segmentHeight;
                            if (segmentHeight > 0) previousHeight = segmentHeight;
                            return <g key={part.key}>
                              <rect x="20" y={112 - used} width="40" height={segmentHeight} fill={part.color} />
                              {separator && <line x1="20" x2="60" y1={boundary} y2={boundary} stroke="#fff" strokeOpacity="0.55" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />}
                            </g>;
                          })}
                        </g>
                      </svg>
                      <strong className="ofis-beyan__total" style={{ bottom: `${(12 + height) / 124 * 100}%` }}>{row.toplam.toLocaleString('tr-TR')}</strong>
                    </span>
                    <span className="ofis-beyan__name">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {selected && <div id={`${id}-tooltip`} role="tooltip" className={`ofis-beyan__tooltip${selectedIndex < visible.length / 2 ? ' ofis-beyan__tooltip--right' : ''}`}>
            <strong>{BEYAN_ETIKETLER[selected.beyanTipi]} · {selected.vergiDonem}</strong>
            <span>Toplam: {selected.toplam.toLocaleString('tr-TR')}</span>
            {PARTS.map(part => <span key={part.key}>{part.label}<b>{selected[part.key].toLocaleString('tr-TR')}</b></span>)}
          </div>}
        </div>
      )}
    </section>
  );
}
