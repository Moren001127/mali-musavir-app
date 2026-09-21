'use client';
import { CalendarDays, FileCheck2, HelpCircle, Search } from 'lucide-react';
import { BEYAN_ETIKETLER, type BeyanTipi, type DonemTuru, type OzetRow } from '@/lib/beyanname-takip';
import './beyan-durum.css';

/**
 * Beyanname Durum Takibi — HATTAT KALIBI TABLO (2026-09-22, Muzaffer Bey: "toplam / onaylanan / onay bekleyen / hatalı /
 * kalan sütunları + durum çubuğu olsun, bu tablo yapısına göre tasarla"). Üstte başlık + renk açıklaması + dönem araçları,
 * altta tek tablo: Beyanname Türü · Toplam · Onaylanan · Onay Bekleyen · Hatalı · Kalan · Durum (çubuk + %). Bildirge ve
 * E-Defter aynı tabloda ayrı grup başlığı altında; onlarda bekleyen/hatalı YOK ("—"). Sayılar tıklanınca mükellef listesi
 * penceresi açılır (onNumberClick). Görünüm `beyan-durum.css`te: koyu tema A varsayılan, beyaz tema D ezer.
 */

export type BeyanFilter = 'toplam' | 'onaylanan' | 'bekleyen' | 'hatali' | 'kalan';

const AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const CEYREK_AYLAR = ['Oca-Mar', 'Nis-Haz', 'Tem-Eyl', 'Eki-Ara'];
/** "2026-05" → "Mayıs 2026" · "2026-Q1" → "2026 1. Dönem (Oca-Mar)" · "2026-YIL" → "2026 Yıllık" */
export function donemEtiket(key?: string | null): string {
  if (!key) return '-';
  const ay = key.match(/^(\d{4})-(\d{2})$/);
  if (ay) return `${AYLAR_TR[parseInt(ay[2], 10) - 1] || ay[2]} ${ay[1]}`;
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]} ${q[2]}. Dönem (${CEYREK_AYLAR[parseInt(q[2], 10) - 1]})`;
  const yil = key.match(/^(\d{4})-YIL$/i);
  if (yil) return `${yil[1]} Yıllık`;
  return key;
}

const BEYAN_TIPLERI: BeyanTipi[] = [
  'KURUMLAR', 'GELIR',
  'KDV1', 'KDV2', 'KDV4', 'KDV9015',
  'DAMGA', 'POSET',
  'MUHSGK', 'MUHSGK2',
  'GGECICI', 'KGECICI',
  'TURIZM', 'KONAKLAMA', 'OIV', 'GMSI',
  'OTV1', 'OTV3A', 'OTV3B', 'OTV4',
];

function durum(row: OzetRow): { key: 'done' | 'error' | 'pending'; label: string } {
  if (row.hatali > 0) return { key: 'error', label: 'Hata var' };
  if (row.kalan <= 0) return { key: 'done', label: 'Tamam' };
  return { key: 'pending', label: 'Devam ediyor' };
}

export function BeyanDurumTakibi({
  donem, setDonem, donemTuru, setDonemTuru, donemOptions, selectedDonem, rows, isLoading, onRefetch, onNumberClick,
}: {
  donem: string;
  setDonem: (v: string) => void;
  donemTuru: DonemTuru;
  setDonemTuru: (v: DonemTuru) => void;
  donemOptions: { value: string; label: string }[];
  selectedDonem: string;
  rows: OzetRow[];
  isLoading: boolean;
  onRefetch: () => void;
  onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void;
}) {
  const aktif = rows.filter((r) => r.toplam > 0);
  const beyanRows = aktif.filter((r) => BEYAN_TIPLERI.includes(r.beyanTipi));
  const yardimciRows = aktif.filter((r) => r.beyanTipi === 'BILDIRGE' || r.beyanTipi === 'EDEFTER');
  const toplam = aktif.reduce((a, r) => ({ toplam: a.toplam + r.toplam, onaylanan: a.onaylanan + r.onaylanan, bekleyen: a.bekleyen + r.bekleyen, hatali: a.hatali + r.hatali, kalan: a.kalan + r.kalan }), { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0, kalan: 0 });
  const yuzde = toplam.toplam > 0 ? Math.round((toplam.onaylanan / toplam.toplam) * 100) : 0;
  const modeLabel = donemTuru === 'VERILME' ? 'Verilme dönemi' : 'Vergi dönemi';
  const modeNote = donemTuru === 'VERILME' ? 'Seçilen ayda verilmesi gerekenler' : 'Seçilen vergi dönemine ait olanlar';
  const bos = !isLoading && aktif.length === 0;

  return (
    <section className="bd" data-beyan-panel aria-label="Beyanname durum takibi">
      <header className="bd-head">
        <span className="bd-icon" aria-hidden="true"><FileCheck2 size={17} /></span>
        <div className="bd-heading">
          <p>BEYANNAME TAKİBİ</p>
          <h3>Beyanname Durum Takibi <span className="bd-donem">{donemEtiket(selectedDonem)}</span> <span className="bd-help" title={modeNote}><HelpCircle size={13} /></span></h3>
        </div>
        <ul className="bd-legend" aria-label="Renk açıklaması">
          <li data-ton="ok">Onaylanan</li>
          <li data-ton="wait">Bekleyen</li>
          <li data-ton="err">Hatalı</li>
          <li data-ton="left">Kalan</li>
        </ul>
        <div className="bd-tools">
          <div className="bd-mode" role="tablist" aria-label="Dönem türü">
            {([['VERILME', 'Verilme dönemi'], ['VERGI', 'Vergi dönemi']] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={donemTuru === value} data-active={donemTuru === value ? 'true' : undefined} onClick={() => setDonemTuru(value)}>
                {label}
              </button>
            ))}
          </div>
          <label className="bd-period">
            <CalendarDays size={12} aria-hidden="true" />
            <select aria-label="Beyanname takip dönemi" value={donem} onChange={(e) => setDonem(e.target.value)}>
              {donemOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" className="bd-query" onClick={onRefetch}><Search size={13} aria-hidden="true" /> Sorgula</button>
        </div>
      </header>

      {isLoading && <div className="bd-empty">Yükleniyor…</div>}
      {bos && (
        <div className="bd-empty">
          <b>Bu dönem için takip edilecek beyanname bulunmadı.</b>
          <span>Mükellef kartlarındaki beyanname dönemleri ve türleri kontrol edilmeli.</span>
        </div>
      )}

      {!isLoading && aktif.length > 0 && (
        <div className="bd-table-wrap">
          <table className="bd-table">
            <thead>
              <tr>
                <th scope="col" className="bd-th-left">Beyanname Türü</th>
                <th scope="col">Toplam</th>
                <th scope="col">Onaylanan</th>
                <th scope="col">Onay Bekleyen</th>
                <th scope="col">Hatalı</th>
                <th scope="col">Kalan</th>
                <th scope="col" className="bd-th-left bd-th-durum">Durum</th>
              </tr>
            </thead>
            <tbody>
              {beyanRows.map((row) => <BeyanSatiri key={row.beyanTipi} row={row} onNumberClick={onNumberClick} />)}
              {yardimciRows.length > 0 && (
                <tr className="bd-subhead"><th scope="rowgroup" colSpan={7}>Bildirge ve E-Defter <em>{donemEtiket(selectedDonem)}</em></th></tr>
              )}
              {yardimciRows.map((row) => <BeyanSatiri key={row.beyanTipi} row={row} onNumberClick={onNumberClick} yardimci />)}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="bd-th-left">Toplam <em>{aktif.length} kalem · {modeLabel}</em></th>
                <td><b>{toplam.toplam}</b></td>
                <td data-ton="ok" data-zero={toplam.onaylanan === 0 ? 'true' : undefined}><b>{toplam.onaylanan}</b></td>
                <td data-ton="wait" data-zero={toplam.bekleyen === 0 ? 'true' : undefined}><b>{toplam.bekleyen}</b></td>
                <td data-ton="err" data-zero={toplam.hatali === 0 ? 'true' : undefined}><b>{toplam.hatali}</b></td>
                <td data-ton="left" data-zero={toplam.kalan === 0 ? 'true' : undefined}><b>{toplam.kalan}</b></td>
                <td className="bd-td-durum"><Durum pct={yuzde} state={toplam.hatali > 0 ? 'error' : toplam.kalan <= 0 ? 'done' : 'pending'} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function Durum({ pct, state, etiket }: { pct: number; state: 'done' | 'error' | 'pending'; etiket?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className="bd-durum" data-state={state}>
      <span className="bd-bar" role="img" aria-label={`Yüzde ${p}`}><i style={{ width: `${p}%` }} /></span>
      <b>%{p}</b>
      {etiket && <em>{etiket}</em>}
    </span>
  );
}

function BeyanSatiri({ row, onNumberClick, yardimci }: { row: OzetRow; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void; yardimci?: boolean }) {
  const d = durum(row);
  const pct = Math.max(0, Math.min(100, row.yuzde));
  return (
    <tr className="bd-row" data-state={d.key}>
      <th scope="row" className="bd-th-left">
        <button type="button" className="bd-name" onClick={() => onNumberClick(row.beyanTipi, 'toplam')} title="Mükellef listesini göster">
          <b>{BEYAN_ETIKETLER[row.beyanTipi]}</b> <small>{donemEtiket(row.vergiDonem)}</small>
        </button>
      </th>
      <Sayi deger={row.toplam} ton="total" onClick={() => onNumberClick(row.beyanTipi, 'toplam')} />
      <Sayi deger={row.onaylanan} ton="ok" onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
      {yardimci ? <td className="bd-na" aria-label="Bu türde yok">—</td> : <Sayi deger={row.bekleyen} ton="wait" onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />}
      {yardimci ? <td className="bd-na" aria-label="Bu türde yok">—</td> : <Sayi deger={row.hatali} ton="err" onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />}
      <Sayi deger={row.kalan} ton="left" onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
      <td className="bd-td-durum"><Durum pct={pct} state={d.key} etiket={d.label} /></td>
    </tr>
  );
}

function Sayi({ deger, ton, onClick }: { deger: number; ton: string; onClick: () => void }) {
  const tiklanir = deger > 0;
  return (
    <td data-ton={ton} data-zero={tiklanir ? undefined : 'true'}>
      <button type="button" className="bd-num" disabled={!tiklanir} onClick={tiklanir ? onClick : undefined} title={tiklanir ? 'Mükellef listesini göster' : undefined}>{deger}</button>
    </td>
  );
}
