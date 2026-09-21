'use client';
import { BookOpenCheck, CalendarDays, ClipboardList, FileCheck2, FileText, Landmark, Receipt, Search, Stamp, Wallet } from 'lucide-react';
import { BEYAN_ETIKETLER, type BeyanTipi, type DonemTuru, type OzetRow } from '@/lib/beyanname-takip';
import './beyan-durum.css';

/**
 * Beyanname Durum Takibi — panorama dili (2026-09-22, Muzaffer Bey: üst bölümdeki SGK/E-Defter/Fatura kartları gibi
 * "göz yormayan, kusursuz"): açık çivit yıkamalı kart, soluk simge kutuları, noktalı sayı listesi, ince satır kartları.
 * Solda özet (onay halkası + toplam + noktalı liste), sağda her beyanname için satır (simge, ad + vergi dönemi + mükellef,
 * ince bölümlü çubuk, tıklanabilir sayılar, yüzde + durum). Veri, dönem/mod seçimi, Sorgula ve sayıya tıklayınca açılan
 * mükellef listesi (onNumberClick → pencere) aynı. Görünüm `beyan-durum.css`te: koyu tema A varsayılan, D ezer.
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

function simge(tip: BeyanTipi): any {
  if (tip.startsWith('KDV')) return Receipt;
  if (tip.startsWith('MUHSGK')) return FileText;
  if (tip === 'DAMGA') return Stamp;
  if (tip === 'KURUMLAR' || tip === 'GELIR' || tip === 'GGECICI' || tip === 'KGECICI' || tip === 'GMSI') return Landmark;
  if (tip === 'BILDIRGE') return ClipboardList;
  if (tip === 'EDEFTER') return BookOpenCheck;
  return Wallet;
}

function durum(row: OzetRow): { key: 'done' | 'error' | 'pending'; label: string } {
  if (row.hatali > 0) return { key: 'error', label: 'Hata var' };
  if (row.kalan <= 0) return { key: 'done', label: 'Tamam' };
  return { key: 'pending', label: 'Devam ediyor' };
}

// Halka: r=44 → çevre
const CEVRE = 2 * Math.PI * 44;

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
  const tamamKalem = aktif.filter((r) => r.kalan <= 0 && r.hatali <= 0).length;
  const modeLabel = donemTuru === 'VERILME' ? 'Verilme dönemi' : 'Vergi dönemi';
  const modeNote = donemTuru === 'VERILME' ? 'Seçilen ayda verilmesi gerekenler' : 'Seçilen vergi dönemine ait olanlar';
  const bos = !isLoading && aktif.length === 0;

  return (
    <section className="bd" data-beyan-panel aria-label="Beyanname durum takibi">
      <header className="bd-head">
        <span className="bd-icon" aria-hidden="true"><FileCheck2 size={17} /></span>
        <div className="bd-heading">
          <p>BEYANNAME TAKİBİ</p>
          <h3>Beyanname Durum Takibi</h3>
        </div>
        <span className="bd-note">{modeNote}</span>
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

      <div className="bd-body">
        {/* Sol: özet (halka + toplam + noktalı liste) */}
        <aside className="bd-summary" data-state={toplam.hatali > 0 ? 'error' : yuzde >= 100 && toplam.toplam > 0 ? 'done' : 'pending'}>
          <div className="bd-gauge" role="img" aria-label={`Onaylanan oranı yüzde ${yuzde}`}>
            <svg viewBox="0 0 110 110" aria-hidden="true">
              <circle className="bd-track" cx="55" cy="55" r="44" />
              <circle className="bd-progress" cx="55" cy="55" r="44" strokeDasharray={`${(CEVRE * yuzde) / 100} ${CEVRE}`} />
            </svg>
            <div className="bd-gauge-text"><b>%{yuzde}</b><small>onaylandı</small></div>
          </div>
          <div className="bd-numbers">
            <p className="bd-total"><strong>{toplam.toplam}</strong> <span>mükellef</span></p>
            <dl>
              <div data-ton="ok"><dt>Onaylanan</dt><dd>{toplam.onaylanan}</dd></div>
              <div data-ton="wait" data-zero={toplam.bekleyen === 0 ? 'true' : undefined}><dt>Bekleyen</dt><dd>{toplam.bekleyen}</dd></div>
              <div data-ton="err" data-zero={toplam.hatali === 0 ? 'true' : undefined}><dt>Hatalı</dt><dd>{toplam.hatali}</dd></div>
              <div data-ton="left"><dt>Kalan</dt><dd>{toplam.kalan}</dd></div>
            </dl>
            <p className="bd-summary-sub">{donemEtiket(selectedDonem)} · {modeLabel} · {aktif.length} kalem, {tamamKalem} tamam</p>
          </div>
        </aside>

        {/* Sağ: satırlar */}
        <div className="bd-list">
          {isLoading && <div className="bd-empty">Yükleniyor…</div>}
          {bos && (
            <div className="bd-empty">
              <b>Bu dönem için takip edilecek beyanname bulunmadı.</b>
              <span>Mükellef kartlarındaki beyanname dönemleri ve türleri kontrol edilmeli.</span>
            </div>
          )}
          {beyanRows.length > 0 && (
            <div className="bd-group" style={{ flexGrow: beyanRows.length }}>
              <div className="bd-group-head"><span>Beyannameler</span><em>{beyanRows.length} tür</em></div>
              <ul className="bd-rows">
                {beyanRows.map((row) => <BeyanSatiri key={row.beyanTipi} row={row} onNumberClick={onNumberClick} />)}
              </ul>
            </div>
          )}
          {yardimciRows.length > 0 && (
            <div className="bd-group" style={{ flexGrow: yardimciRows.length }}>
              <div className="bd-group-head"><span>Bildirge ve E-Defter</span><em>{donemEtiket(selectedDonem)}</em></div>
              <ul className="bd-rows">
                {yardimciRows.map((row) => <BeyanSatiri key={row.beyanTipi} row={row} onNumberClick={onNumberClick} />)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BeyanSatiri({ row, onNumberClick }: { row: OzetRow; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void }) {
  const Icon = simge(row.beyanTipi);
  const d = durum(row);
  const pct = Math.max(0, Math.min(100, row.yuzde));
  const pay = (v: number) => (row.toplam > 0 ? (v / row.toplam) * 100 : 0);
  // Muzaffer Bey: beyannamelerde "bekleyen" ve "hatalı" HER ZAMAN görünür (sıfır olsa da); Bildirge ve E-Defter'de bu kavramlar yok
  const yardimci = row.beyanTipi === 'BILDIRGE' || row.beyanTipi === 'EDEFTER';
  const onayEtiket = row.beyanTipi === 'EDEFTER' ? 'verilen' : 'onaylanan';
  return (
    <li className="bd-row" data-state={d.key}>
      <button type="button" className="bd-row-id" onClick={() => onNumberClick(row.beyanTipi, 'toplam')} title="Mükellef listesini göster">
        <span className="bd-row-icon" aria-hidden="true"><Icon size={16} /></span>
        <span className="bd-row-name">
          <b>{BEYAN_ETIKETLER[row.beyanTipi]}</b>
          <small>{donemEtiket(row.vergiDonem)} · {row.toplam} mükellef</small>
        </span>
      </button>
      <div className="bd-row-progress">
        <div className="bd-bar" role="img" aria-label={`${row.onaylanan} onaylanan, ${row.bekleyen} bekleyen, ${row.hatali} hatalı, ${row.kalan} kalan`}>
          {row.onaylanan > 0 && <i data-seg="ok" style={{ width: `${pay(row.onaylanan)}%` }} />}
          {row.bekleyen > 0 && <i data-seg="wait" style={{ width: `${pay(row.bekleyen)}%` }} />}
          {row.hatali > 0 && <i data-seg="err" style={{ width: `${pay(row.hatali)}%` }} />}
        </div>
        <div className="bd-nums">
          <Sayi deger={row.onaylanan} etiket={onayEtiket} ton="ok" onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
          {!yardimci && <Sayi deger={row.bekleyen} etiket="bekleyen" ton="wait" onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />}
          {!yardimci && <Sayi deger={row.hatali} etiket="hatalı" ton="err" onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />}
          <Sayi deger={row.kalan} etiket="kalan" ton="left" onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
        </div>
      </div>
      <div className="bd-row-status">
        <b className="bd-pct">%{pct}</b>
        <span className="bd-status" data-state={d.key}>{d.label}</span>
      </div>
    </li>
  );
}

function Sayi({ deger, etiket, ton, onClick }: { deger: number; etiket: string; ton: string; onClick: () => void }) {
  const tiklanir = deger > 0;
  return (
    <button type="button" className="bd-num" data-ton={ton} data-zero={tiklanir ? undefined : 'true'} disabled={!tiklanir} onClick={tiklanir ? onClick : undefined} title={tiklanir ? 'Mükellef listesini göster' : undefined}>
      <i aria-hidden="true" /><b>{deger}</b> {etiket}
    </button>
  );
}
