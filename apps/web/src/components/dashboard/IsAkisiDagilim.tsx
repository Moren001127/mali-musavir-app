import { useId } from 'react';
import './is-akisi-dagilim.css';

const STAGES = [
  { key: 'evrak', label: 'Evrak bekliyor', color: '#b98044' },
  { key: 'yukleme', label: 'Yükleme', color: '#38998d' },
  { key: 'islenme', label: 'Fatura işleme', color: '#6089c7' },
  { key: 'kontrol', label: 'KDV kontrol', color: '#5897ad' },
  { key: 'beyanname', label: 'Beyanname', color: '#9972b6' },
  { key: 'tamam', label: 'Tamamlandı', color: '#4f9b70' },
] as const;

type Counts = Record<(typeof STAGES)[number]['key'], number>;

export function IsAkisiDagilim({ counts, period, loading }: {
  counts?: Counts;
  period?: string;
  loading: boolean;
}) {
  const chartId = useId();
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
  const step = Math.max(1, Math.ceil(Math.max(...values) / 4));
  const points = values.map((value, index) => ({ x: 70 + index * 174, y: 260 - value / (step * 4) * 200 }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');

  return (
    <section className="workflow-distribution" aria-label="İş akışı aşama dağılımı" aria-busy={loading}>
      <header className="workflow-distribution__header">
        <div>
          <p className="workflow-distribution__eyebrow">{periodLabel} · Güncel durum</p>
          <h2>İşin hangi aşamasındayız?</h2>
          <p>İş akışındaki mükelleflerin aşamalara göre dağılımı</p>
        </div>
        {valid && <div className="workflow-distribution__total"><strong>{total.toLocaleString('tr-TR')}</strong><span>mükellef</span></div>}
      </header>
      {loading || !valid || total === 0 ? (
        <p className="workflow-distribution__message" role="status">
          {loading ? 'İş akışı yükleniyor…' : !valid ? 'İş akışı verisi alınamadı.' : 'Bu dönem iş akışında mükellef bulunmuyor.'}
        </p>
      ) : (
        <figure className="workflow-distribution__figure">
          <div className="workflow-distribution__scroll" tabIndex={0} role="region" aria-label="Aşama grafiği; dar ekranlarda yatay kaydırılabilir">
            <svg className="workflow-distribution__chart" viewBox="0 0 1010 340" role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
              <title id={`${chartId}-title`}>İş akışının aşamalara göre dağılımı</title>
              <desc id={`${chartId}-description`}>{STAGES.map(({ label }, index) => `${label}: ${values[index]} mükellef`).join('. ')}. Güncel aşama dağılımı.</desc>
              <defs>
                <linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#458eac" stopOpacity=".32" /><stop offset="100%" stopColor="#458eac" stopOpacity=".03" />
                </linearGradient>
                <linearGradient id={`${chartId}-stroke`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#4276b8" /><stop offset="100%" stopColor="#298c76" />
                </linearGradient>
              </defs>
              <text x="24" y="25" className="workflow-distribution__tick">Mükellef sayısı</text>
              {[0, 1, 2, 3, 4].map(index => <g key={index}>
                <line x1="70" x2="940" y1={260 - index * 50} y2={260 - index * 50} className="workflow-distribution__grid" />
                <text x="48" y={265 - index * 50} textAnchor="end" className="workflow-distribution__tick">{(index * step).toLocaleString('tr-TR')}</text>
              </g>)}
              <path d={`${line} L 940 260 L 70 260 Z`} fill={`url(#${chartId}-fill)`} />
              <path d={line} fill="none" stroke={`url(#${chartId}-stroke)`} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
              {STAGES.map(({ key, label, color }, index) => {
                const point = points[index];
                return <g key={key}>
                  <title>{label}: {values[index]} mükellef</title>
                  <circle cx={point.x} cy={point.y} r="12" fill={color} fillOpacity=".14" />
                  <circle cx={point.x} cy={point.y} r="5.5" fill={color} stroke="var(--distribution-bg)" strokeWidth="2.5" />
                  <text x={point.x} y={point.y - 20} textAnchor="middle" className="workflow-distribution__point-value">{values[index].toLocaleString('tr-TR')}</text>
                  <text x={point.x} y="292" textAnchor="middle" className="workflow-distribution__stage">{label}</text>
                  <text x={point.x} y="314" textAnchor="middle" className="workflow-distribution__tick">%{(values[index] / total * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</text>
                </g>;
              })}
            </svg>
          </div>
          <figcaption>Her nokta, ilgili aşamadaki mükellef sayısını gösterir. Her mükellef tek aşamada sayılır.</figcaption>
        </figure>
      )}
    </section>
  );
}
