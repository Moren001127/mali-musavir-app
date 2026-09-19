import Link from 'next/link';
import { ArrowUpRight, BookOpen, ShieldCheck } from 'lucide-react';
import type { OzetRow } from '@/lib/beyanname-takip';
import './yukumluluk-karti.css';

export interface YukumlulukKartiProps {
  row?: OzetRow;
  loading: boolean;
  error: boolean;
  kind: 'sgk' | 'edefter';
}

export function YukumlulukKarti({ row, loading, error, kind }: YukumlulukKartiProps) {
  const sgk = kind === 'sgk';
  const title = sgk ? 'SGK' : 'E-Defter';
  const Icon = sgk ? ShieldCheck : BookOpen;
  const valid = !!row && [row.toplam, row.onaylanan, row.kalan, row.bekleyen, row.hatali, row.muaf]
    .every(value => Number.isInteger(value) && value >= 0) && row.onaylanan <= row.toplam;
  const available = valid && !loading && !error;
  const percent = available && row.toplam > 0 ? Math.round(row.onaylanan / row.toplam * 100) : null;
  const extras = available ? [
    { label: 'Bekleyen', value: row.bekleyen, tone: 'pending' },
    { label: 'Hatalı', value: row.hatali, tone: 'error' },
    { label: 'Muaf', value: row.muaf, tone: 'exempt' },
  ].filter(item => item.value > 0) : [];
  const number = (value: number) => value.toLocaleString('tr-TR');

  return (
    <section className="yukumluluk-karti" data-kind={kind} aria-label={`${title} yükümlülük özeti`} aria-busy={loading}>
      <header className="yukumluluk-karti__header">
        <span className="yukumluluk-karti__icon"><Icon size={14} aria-hidden="true" /></span>
        <h2>{title}</h2>
        {extras.length > 0 && <ul className="yukumluluk-karti__extras" aria-label="Diğer durumlar">
          {extras.map(item => <li key={item.tone} data-tone={item.tone}>{item.label} <b>{number(item.value)}</b></li>)}
        </ul>}
        <Link href={sgk ? '/panel/ajanlar/sgk' : '/panel/ajanlar/e-defter'} aria-label={`${title} modülünü aç`} title={`${title} modülünü aç`}>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </header>
      {available ? <>
        <div className="yukumluluk-karti__body">
          <div className="yukumluluk-karti__gauge" role="img" aria-label={percent === null ? 'Oran hesaplanacak mükellef yok' : `Onaylanan yüzde ${percent}`}>
            <svg viewBox="0 0 80 65" aria-hidden="true">
              {sgk ? <>
                <circle className="yukumluluk-karti__track" cx="40" cy="32.5" r="26" />
                <circle className="yukumluluk-karti__progress" cx="40" cy="32.5" r="26" pathLength="100" strokeDasharray={`${percent ?? 0} 100`} transform="rotate(-90 40 32.5)" />
                <text x="40" y="37">{percent === null ? '—' : `${percent}%`}</text>
              </> : <>
                <path className="yukumluluk-karti__track" d="M 10 48 A 30 30 0 0 1 70 48" />
                <path className="yukumluluk-karti__progress" d="M 10 48 A 30 30 0 0 1 70 48" pathLength="100" strokeDasharray={`${percent ?? 0} 100`} />
                <text x="40" y="47">{percent === null ? '—' : `${percent}%`}</text>
              </>}
            </svg>
          </div>
          <div className="yukumluluk-karti__numbers">
            <p className="yukumluluk-karti__total"><strong>{number(row.toplam)}</strong><span>mükellef</span></p>
            <dl>
              <div><dt>Onaylanan</dt><dd>{number(row.onaylanan)}</dd></div>
              <div><dt>Kalan</dt><dd>{number(row.kalan)}</dd></div>
            </dl>
          </div>
        </div>

      </> : <p className="yukumluluk-karti__state" role={error ? 'alert' : 'status'}>
        {error ? 'Özet alınamadı.' : loading ? 'Özet yükleniyor…' : 'Özet verisi yok.'}
      </p>}
    </section>
  );
}

export default YukumlulukKarti;
