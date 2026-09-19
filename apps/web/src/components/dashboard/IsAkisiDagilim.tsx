import { useState } from 'react';
import './is-akisi-dagilim.css';

const STAGES = [
  { key: 'evrak', label: 'Evrak bekliyor', color: '#db9435' },
  { key: 'yukleme', label: 'Yükleme', color: '#159caa' },
  { key: 'islenme', label: 'Fatura işleme', color: '#4279db' },
  { key: 'kontrol', label: 'KDV kontrol', color: '#8861c4' },
  { key: 'beyanname', label: 'Beyanname', color: '#cf658b' },
  { key: 'tamam', label: 'Tamamlandı', color: '#249b72' },
] as const;

type Counts = Record<(typeof STAGES)[number]['key'], number>;

export function IsAkisiDagilim({ counts, period, loading }: {
  counts?: Counts;
  period?: string;
  loading: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const valid = counts && STAGES.every(({ key }) => Number.isInteger(counts[key]) && counts[key] >= 0);
  const total = valid ? STAGES.reduce((sum, { key }) => sum + counts[key], 0) : 0;
  const yearFirst = period?.trim().match(/^(\d{4})[-/](0?[1-9]|1[0-2])$/);
  const monthFirst = period?.trim().match(/^(0?[1-9]|1[0-2])\/(\d{4})$/);
  const year = yearFirst?.[1] ?? monthFirst?.[2];
  const month = yearFirst?.[2] ?? monthFirst?.[1];
  const periodLabel = year && month
    ? new Date(Number(year), Number(month) - 1, 1)
      .toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
    : 'Bu ay';

  const values = STAGES.map(({ key }) => valid ? counts[key] : 0);
  const circumference = 2 * Math.PI * 88;
  let offset = 0;
  const segments = values.map(value => {
    const length = total ? value / total * circumference : 0;
    const segment = { offset, length };
    offset += length;
    return segment;
  });
  const selected = active === null ? null : STAGES[active];
  const selectedValue = active === null ? (valid ? counts.tamam : 0) : values[active];

  return (
    <section className="workflow-distribution" aria-label="İş akışı aşama dağılımı" aria-busy={loading}>
      <header className="workflow-distribution__header">
        <div>
          <p className="workflow-distribution__eyebrow">{periodLabel} · Güncel durum</p>
          <h2>Ofisin iş akışı</h2>
          <p>Aşamaların dağılımı ve tamamlanma oranı</p>
        </div>
        {valid && <div className="workflow-distribution__total"><strong>{total.toLocaleString('tr-TR')}</strong><span>mükellef</span></div>}
      </header>
      {loading || !valid || total === 0 ? (
        <p className="workflow-distribution__message" role="status">
          {loading ? 'İş akışı yükleniyor…' : !valid ? 'İş akışı verisi alınamadı.' : 'Bu dönem iş akışında mükellef bulunmuyor.'}
        </p>
      ) : (
        <div className="workflow-distribution__body">
          <figure className="workflow-distribution__ring-wrap">
            <svg className="workflow-distribution__ring" viewBox="0 0 240 240" role="img" aria-label={STAGES.map(({label}, i) => label + ': ' + values[i]).join(', ')}>
              <circle cx="120" cy="120" r="88" fill="none" stroke="var(--distribution-track)" strokeWidth="24" />
              {STAGES.map(({key, color}, i) => values[i] > 0 && <circle key={key}
                cx="120" cy="120" r="88" fill="none" stroke={color}
                strokeWidth={active === i ? 30 : 24}
                strokeDasharray={Math.max(0, segments[i].length - Math.min(3, segments[i].length * .15)) + ' ' + circumference}
                strokeDashoffset={-segments[i].offset} transform="rotate(-90 120 120)"
                opacity={active === null || active === i ? 1 : .3}
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                <title>{STAGES[i].label}: {values[i]} mükellef</title>
              </circle>)}
              <text x="120" y="112" textAnchor="middle" className="workflow-distribution__ring-value">%{Math.round(selectedValue / total * 100)}</text>
              <text x="120" y="139" textAnchor="middle" className="workflow-distribution__ring-label">{selected?.label ?? 'Tamamlandı'}</text>
              <text x="120" y="160" textAnchor="middle" className="workflow-distribution__ring-count">{selectedValue} / {total} mükellef</text>
            </svg>
            <figcaption>İş akışının güncel dağılımı</figcaption>
          </figure>
          <div className="workflow-distribution__legend" aria-label="Aşama ayrıntıları">
            {STAGES.map(({key, label, color}, i) => <button type="button" key={key}
              className="workflow-distribution__legend-item" aria-pressed={active === i}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}>
              <span className="workflow-distribution__dot" style={{background:color}} />
              <span className="workflow-distribution__legend-label">{label}</span>
              <strong>{values[i].toLocaleString('tr-TR')}</strong>
              <span className="workflow-distribution__share">%{(values[i] / total * 100).toLocaleString('tr-TR', {maximumFractionDigits:1})}</span>
            </button>)}
          </div>
        </div>
      )}
    </section>
  );
}
