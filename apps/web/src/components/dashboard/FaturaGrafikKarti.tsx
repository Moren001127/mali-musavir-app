'use client';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';
import { ArrowRight, FileText } from 'lucide-react';
import './fatura-grafik-karti.css';
type Row = { taxpayerId: string; pendingAlis: number; pendingSatis: number; postedToLuca: number; hasIssue: number };
const n = (v: number) => Number.isFinite(v) && v >= 0 ? v : 0;
const fmt = (v: number) => v.toLocaleString('tr-TR');
export function FaturaGrafikKarti({ period }: { period: string }) {
  const id = useId().replace(/:/g, '');
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const q = useQuery<Row[]>({ queryKey: ['fm2', 'per-taxpayer', period], enabled: valid, queryFn: async () => {
    const { data } = await api.get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } });
    if (!Array.isArray(data)) throw new Error('Belge dağılımı alınamadı');
    return data;
  }});
  const summary = useQuery<{ total: number }>({ queryKey: ['fm2', 'summary', '', period], enabled: valid, queryFn: async () => {
    const { data } = await api.get('/fatura-muhasebelestirme/summary', { params: { period } });
    if (typeof data?.total !== 'number' || !Number.isFinite(data.total) || data.total < 0) throw new Error('Toplam alınamadı');
    return data;
  }});
  // Sıfır bekleyenli satırlar korunur; eksen tarih değil mükellef sırasıdır.
  const rows = [...(q.data || [])].sort((a,b) => n(b.pendingAlis)+n(b.pendingSatis)-n(a.pendingAlis)-n(a.pendingSatis) || String(a.taxpayerId).localeCompare(String(b.taxpayerId), 'tr'));
  const totals = rows.reduce((a,r) => ({ pending:a.pending+n(r.pendingAlis)+n(r.pendingSatis), posted:a.posted+n(r.postedToLuca), issue:a.issue+n(r.hasIssue) }), {pending:0,posted:0,issue:0});
  const max = rows.reduce((m,r)=>Math.max(m,n(r.pendingAlis),n(r.pendingSatis)),1);
  const x = (i:number) => rows.length===1 ? 300 : 24+i*552/(rows.length-1);
  const y = (v:number) => 88-n(v)/max*72;
  const ready = valid && !q.isPending && !q.isError;
  const message = !valid ? 'Geçerli bir ay seçin.' : q.isPending ? 'Belgeler yükleniyor…' : q.isError ? 'Belge dağılımı alınamadı.' : !rows.length ? 'Bu dönemde mükellefe bağlı belge yok.' : '';
  return <section className="fatura-grafik-karti" aria-label="Fatura belge özeti">
    <header><h3><FileText size={17} /> Fatura</h3><span title="Seçili dönemdeki tüm belgeler; mükellefsiz ve banka belgeleri dahil."><strong>{valid && summary.data && !summary.isError ? fmt(summary.data.total) : '—'}</strong> belge</span><Link href="/fatura-merkezi" aria-label="Fatura merkezini aç" className="fgk-link"><ArrowRight size={15} /></Link></header>
    <div className="fgk-caption"><span>Mükellef bazında bekleyen belge</span><span className="fgk-legend"><i className="fgk-blue"/>Alış <i className="fgk-purple"/>Satış</span></div>
    {summary.isError && <p role="status" className="fgk-notice">Toplam belge sayısı alınamadı.</p>}
    {message ? <div className="fgk-state" role="status">{message}{q.isError && <button type="button" onClick={()=>{void q.refetch();void summary.refetch();}}>Yeniden dene</button>}</div> : <>
      <svg className="fgk-chart" viewBox="0 0 600 108" preserveAspectRatio="none" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>Bekleyen alış ve satış belgeleri; mükellef sırası, zaman ekseni değildir.</title>
        <defs>{['blue','purple'].map((color,i)=><linearGradient key={color} id={`${id}-${color}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={i?'#9063ce':'#4285df'} stopOpacity=".25"/><stop offset="1" stopColor={i?'#9063ce':'#4285df'} stopOpacity=".04"/></linearGradient>)}</defs>
        <path className="fgk-grid" d="M24 16H576 M24 52H576 M24 88H576"/><text x="2" y="20">{fmt(max)}</text><text x="8" y="90">0</text>
        {(['pendingAlis','pendingSatis'] as const).map((key,i)=>{const path=rows.map((r,j)=>{if(!j)return `M${x(j)},${y(r[key])}`;const mid=(x(j-1)+x(j))/2;return `C${mid},${y(rows[j-1][key])} ${mid},${y(r[key])} ${x(j)},${y(r[key])}`;}).join(' ');return <g key={key}>
          {rows.length>1 && <path d={`${path} L${x(rows.length-1)},88 L${x(0)},88 Z`} fill={`url(#${id}-${i?'purple':'blue'})`}/>}
          <path d={path} fill="none" stroke={i?'#9063ce':'#4285df'} strokeWidth="2"/>
          {rows.map((r,j)=><circle key={r.taxpayerId} cx={x(j)} cy={y(r[key])} r={rows.length===1?3:2} fill={i?'#9063ce':'#4285df'}><title>{`${j+1}. ${r.taxpayerId}: ${i?'Satış':'Alış'} ${fmt(n(r[key]))}`}</title></circle>)}
        </g>;})}
        <text x="24" y="105">1</text><text x="576" y="105" textAnchor="end">{rows.length>1?rows.length:''}</text>
      </svg><div className="fgk-axis">Mükellef sırası · {rows.length} kayıt · çoktan aza</div>
    </>}
    <footer aria-label="Mükellefe bağlı belgeler; sayaçlar çakışabilir">
      <span title="Mükellefe bağlı Luca POSTED belgeleri; banka dahil.">Aktarıldı <b>{ready?fmt(totals.posted):'—'}</b></span>
      <span title="Bekleyen alış ve satış; banka hariç.">Bekleyen <b>{ready?fmt(totals.pending):'—'}</b></span>
      <span title="Doğrulaması INVALID veya INCOMPLETE olan belgeler; diğer sayaçlarla çakışabilir.">Sorunlu <b>{ready?fmt(totals.issue):'—'}</b></span>
    </footer>
  </section>;
}
