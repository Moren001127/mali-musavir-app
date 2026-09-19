import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarDays, UsersRound } from 'lucide-react';
import type { OzetRow } from '@/lib/beyanname-takip';
import './yukumluluk-karti.css';

export interface YukumlulukKartiProps {
  row?: OzetRow;
  loading: boolean;
  error: boolean;
  kind: 'sgk' | 'edefter';
  period?: string;
}

export function YukumlulukKarti({ row, loading, error, kind, period }: YukumlulukKartiProps) {
  const sgk = kind === 'sgk';
  const title = sgk ? 'SGK' : 'E-Defter';
  const Icon = sgk ? UsersRound : BookOpen;
  const valid = !!row && [row.toplam, row.onaylanan, row.kalan, row.bekleyen, row.hatali, row.muaf]
    .every(value => Number.isInteger(value) && value >= 0) && row.onaylanan <= row.toplam;
  const available = valid && !loading && !error;
  const percent = available && row.toplam > 0 ? Math.round(row.onaylanan / row.toplam * 100) : null;
  const extras = available ? [
    { label: 'Bekleyen', value: row.bekleyen, tone: 'pending' },
    { label: 'Hatalı', value: row.hatali, tone: 'error' },
    { label: 'Muaf', value: row.muaf, tone: 'exempt' },
  ].filter(item => item.value > 0) : [];
  const rawPeriod = period ?? row?.vergiDonem;
  const parsedPeriod = rawPeriod?.match(/^(\d{4})[-/](0?[1-9]|1[0-2])$/);
  const periodLabel = parsedPeriod
    ? new Date(Number(parsedPeriod[1]), Number(parsedPeriod[2]) - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
    : rawPeriod || 'Dönem belirtilmedi';
  const number = (value: number) => value.toLocaleString('tr-TR');

  return (
    <section className="yukumluluk-karti" data-kind={kind} aria-label={`${title} yükümlülük özeti`} aria-busy={loading}>
      <header className="yukumluluk-karti__header">
        <span className="yukumluluk-karti__icon"><Icon size={25} strokeWidth={2} aria-hidden="true" /></span>
        <div className="yukumluluk-karti__heading">
          <p>{sgk ? 'SOSYAL GÜVENLİK' : 'DİJİTAL DEFTER'}</p>
          <h2>{title}</h2>
        </div>
        <span className="yukumluluk-karti__period"><CalendarDays size={12} aria-hidden="true" />{periodLabel}</span>
        <Link href={sgk ? '/panel/ajanlar/sgk' : '/panel/ajanlar/e-defter'} aria-label={`${title} modülünü aç`} title={`${title} modülünü aç`}>
          <ArrowRight size={20} aria-hidden="true" />
        </Link>
      </header>
      {available ? <>
        <div className="yukumluluk-karti__body">
          <div className="yukumluluk-karti__gauge" role="img" aria-label={percent === null ? 'Oran hesaplanacak mükellef yok' : `Onaylanan yüzde ${percent}`}>
            <svg viewBox="0 0 140 100" aria-hidden="true">
              {sgk ? <>
                <circle className="yukumluluk-karti__track" cx="70" cy="50" r="41" />
                {percent !== null && percent > 0 && <circle className="yukumluluk-karti__progress" cx="70" cy="50" r="41" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 70 50)" />}
                <text className="yukumluluk-karti__percent" x="70" y="51">{percent === null ? '—' : `%${percent}`}</text>
                <text className="yukumluluk-karti__caption" x="70" y="67">onaylandı</text>
              </> : <>
                <path className="yukumluluk-karti__track" d="M 13 83 A 57 57 0 0 1 127 83" />
                {percent !== null && percent > 0 && <path className="yukumluluk-karti__progress" d="M 13 83 A 57 57 0 0 1 127 83" pathLength="100" strokeDasharray={`${percent} 100`} />}
                <text className="yukumluluk-karti__percent" x="70" y="70">{percent === null ? '—' : `%${percent}`}</text>
                <text className="yukumluluk-karti__caption" x="70" y="86">onaylandı</text>
              </>}
            </svg>
          </div>
          <div className="yukumluluk-karti__numbers">
            <p className="yukumluluk-karti__total"><strong>{number(row.toplam)}</strong><span>mükellef</span></p>
            <div className="yukumluluk-karti__statuses">
            <dl>
              <div><dt>Onaylanan</dt><dd>{number(row.onaylanan)}</dd></div>
              <div><dt>Kalan</dt><dd>{number(row.kalan)}</dd></div>
            </dl>
        {extras.length > 0 && <ul className="yukumluluk-karti__extras" aria-label="Diğer durumlar">
          {extras.map(item => <li key={item.tone} data-tone={item.tone}>{item.label} <b>{number(item.value)}</b></li>)}
        </ul>}
            </div>
          </div>
        </div>

      </> : <p className="yukumluluk-karti__state" role={error ? 'alert' : 'status'}>
        {error ? 'Özet alınamadı.' : loading ? 'Özet yükleniyor…' : 'Özet verisi yok.'}
      </p>}
    </section>
  );
}

export default YukumlulukKarti;
