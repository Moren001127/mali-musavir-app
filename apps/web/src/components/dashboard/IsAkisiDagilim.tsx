import type { CSSProperties } from 'react';
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
          <div className="workflow-distribution__axis" aria-hidden="true"><span>Aşama</span><span>Toplam içindeki payı</span><span>Adet / Pay</span></div>
          <ol className="workflow-distribution__rows">
            {STAGES.map(({ key, label, color }) => {
              const value = counts[key];
              const share = value / total * 100;
              return (
                <li key={key} style={{ '--stage-color': color } as CSSProperties}>
                  <span className="workflow-distribution__label">{label}</span>
                  <span className="workflow-distribution__track" aria-hidden="true">
                    <span className="workflow-distribution__bar" style={{ width: `${share}%` }} />
                  </span>
                  <span className="workflow-distribution__value"><strong>{value.toLocaleString('tr-TR')}</strong><span>%{share.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</span></span>
                </li>
              );
            })}
          </ol>
          <figcaption>Her mükellef tek aşamada sayılır. Çubuklar toplamın yüzdesini gösterir.</figcaption>
        </figure>
      )}
    </section>
  );
}
