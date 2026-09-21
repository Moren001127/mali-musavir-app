'use client';
import React, { ReactNode } from 'react';
import { BookOpenCheck, ClipboardList, FileCheck2, FileText, Landmark, Receipt, Search, Stamp, Wallet } from 'lucide-react';
import { BEYAN_ETIKETLER, type BeyanTipi, type DonemTuru, type OzetRow } from '@/lib/beyanname-takip';
import './beyan-durum.css';

/**
 * Beyanname Durum Takibi — ÖZET KAROSU + SATIR KARTLARI (2026-09-22 gece, Muzaffer Bey: "bu tabloyu da yeniden tasarla").
 * Eski yedi sütunlu tablo yerine: solda çivit karo (tamamlanma halkası + beş sayaç), sağda her beyanname için satır kartı
 * (tür simgesi, ad + vergi dönemi, bölümlü ilerleme çubuğu, tıklanabilir sayı çipleri, durum rozeti + yüzde).
 * Veri, dönem/mod seçimi, Sorgula ve sayıya tıklayınca açılan mükellef listesi (onNumberClick → modal) aynı.
 * Görünüm `beyan-durum.css`te: koyu tema A varsayılan, beyaz tema D ezer.
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

/** Tür ailesi: simge + renk (CSS `data-family`). */
function aile(tip: BeyanTipi): { family: string; icon: any } {
  if (tip.startsWith('KDV')) return { family: 'vat', icon: Receipt };
  if (tip.startsWith('MUHSGK')) return { family: 'payroll', icon: FileText };
  if (tip === 'DAMGA') return { family: 'stamp', icon: Stamp };
  if (tip === 'KURUMLAR' || tip === 'GELIR' || tip === 'GGECICI' || tip === 'KGECICI' || tip === 'GMSI') return { family: 'income', icon: Landmark };
  if (tip === 'BILDIRGE') return { family: 'ledger', icon: ClipboardList };
  if (tip === 'EDEFTER') return { family: 'book', icon: BookOpenCheck };
  return { family: 'other', icon: Wallet };
}

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
  const tamamKalem = aktif.filter((r) => r.kalan <= 0 && r.hatali <= 0).length;
  const modeLabel = donemTuru === 'VERILME' ? 'Verilme dönemi' : 'Vergi dönemi';
  const modeNote = donemTuru === 'VERILME' ? 'Seçilen ayda verilmesi gerekenler' : 'Seçilen vergi dönemine ait olanlar';
  const bos = !isLoading && aktif.length === 0;

  // Halka: r=52 → çevre ≈ 326.7
  const CEVRE = 2 * Math.PI * 52;

  return (
    <section className="bd" data-beyan-panel aria-label="Beyanname durum takibi">
      <header className="bd-band">
        <span className="bd-band-icon" aria-hidden="true"><FileCheck2 size={17} /></span>
        <div className="bd-band-text">
          <h3>Beyanname Durum Takibi</h3>
          <p>{modeLabel} · {donemEtiket(selectedDonem)} · {modeNote}</p>
        </div>
        <div className="bd-band-tools">
          <div className="bd-mode" role="tablist" aria-label="Dönem türü">
            {([['VERILME', 'Verilme dönemi'], ['VERGI', 'Vergi dönemi']] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={donemTuru === value} data-active={donemTuru === value ? 'true' : undefined} onClick={() => setDonemTuru(value)}>
                {label}
              </button>
            ))}
          </div>
          <select className="bd-select" aria-label="Beyanname takip dönemi" value={donem} onChange={(e) => setDonem(e.target.value)}>
            {donemOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" className="bd-query" onClick={onRefetch}><Search size={13} /> Sorgula</button>
        </div>
      </header>

      <div className="bd-body">
        {/* Sol: özet karosu */}
        <aside className="bd-tile" data-state={toplam.hatali > 0 ? 'error' : yuzde >= 100 && toplam.toplam > 0 ? 'done' : 'pending'}>
          <div className="bd-tile-head">
            <span className="bd-tile-label">{donemEtiket(selectedDonem)}</span>
            <span className="bd-tile-mode">{modeLabel}</span>
          </div>
          <div className="bd-ring" role="img" aria-label={`Onaylanan oranı yüzde ${yuzde}`}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="bd-ring-track" cx="60" cy="60" r="52" />
              <circle className="bd-ring-fill" cx="60" cy="60" r="52" strokeDasharray={`${(CEVRE * yuzde) / 100} ${CEVRE}`} />
            </svg>
            <div className="bd-ring-text">
              <b>%{yuzde}</b>
              <small>onaylandı</small>
            </div>
          </div>
          <p className="bd-tile-sub">{aktif.length} takip kalemi · {tamamKalem} tamam</p>
          <dl className="bd-tile-stats">
            <Sayac etiket="Toplam" deger={toplam.toplam} ton="total" />
            <Sayac etiket="Onaylanan" deger={toplam.onaylanan} ton="ok" />
            <Sayac etiket="Kalan" deger={toplam.kalan} ton="left" />
            <Sayac etiket="Bekleyen · Hatalı" deger={toplam.bekleyen + toplam.hatali} ton={toplam.hatali > 0 ? 'err' : 'wait'} />
          </dl>
        </aside>

        {/* Sağ: satır kartları */}
        <div className="bd-list">
          {isLoading && <div className="bd-empty">Yükleniyor…</div>}
          {bos && (
            <div className="bd-empty">
              <b>Bu dönem için takip edilecek beyanname bulunmadı.</b>
              <span>Mükellef kartlarındaki beyanname dönemleri ve türleri kontrol edilmeli.</span>
            </div>
          )}
          {beyanRows.length > 0 && (
            <div className="bd-group" style={{ ["--satir" as string]: beyanRows.length } as React.CSSProperties}>
              <div className="bd-group-head"><span>Beyannameler</span><em>{beyanRows.length} tür</em></div>
              <ul className="bd-rows">
                {beyanRows.map((row) => <BeyanSatiri key={row.beyanTipi} row={row} onNumberClick={onNumberClick} />)}
              </ul>
            </div>
          )}
          {yardimciRows.length > 0 && (
            <div className="bd-group" style={{ ["--satir" as string]: yardimciRows.length } as React.CSSProperties}>
              <div className="bd-group-head"><span>Bildirge ve E-Defter</span><em>{donemEtiket(selectedDonem)}</em></div>
              <ul className="bd-rows">
                {yardimciRows.map((row) => <BeyanSatiri key={row.beyanTipi} row={row} onNumberClick={onNumberClick} onayLabel={row.beyanTipi === 'EDEFTER' ? 'verilen' : 'onaylanan'} />)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Sayac({ etiket, deger, ton, wide }: { etiket: string; deger: number; ton: string; wide?: boolean }) {
  return (
    <div className="bd-stat" data-ton={ton} data-zero={deger === 0 ? 'true' : undefined} data-wide={wide ? 'true' : undefined}>
      <dt>{etiket}</dt>
      <dd>{deger}</dd>
    </div>
  );
}

function BeyanSatiri({ row, onNumberClick, onayLabel = 'onaylanan' }: { row: OzetRow; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void; onayLabel?: string }) {
  const { family, icon: Icon } = aile(row.beyanTipi);
  const d = durum(row);
  // Bildirge ve E-Defter'de "bekleyen" / "hatalı" kavramı yok (Muzaffer Bey); diğerlerinde sıfırsa çip gösterilmez
  const yardimci = row.beyanTipi === 'BILDIRGE' || row.beyanTipi === 'EDEFTER';
  const pct = Math.max(0, Math.min(100, row.yuzde));
  const pay = (v: number) => (row.toplam > 0 ? (v / row.toplam) * 100 : 0);
  const label = BEYAN_ETIKETLER[row.beyanTipi];
  return (
    <li className="bd-row" data-family={family} data-state={d.key}>
      <button type="button" className="bd-row-id" onClick={() => onNumberClick(row.beyanTipi, 'toplam')} title="Mükellef listesini göster">
        <span className="bd-row-icon" aria-hidden="true"><Icon size={17} /></span>
        <span className="bd-row-name">
          <b>{label}</b>
          <small>{donemEtiket(row.vergiDonem)} · {row.toplam} mükellef</small>
        </span>
      </button>
      <div className="bd-row-progress">
        <div className="bd-bar" role="img" aria-label={`${row.onaylanan} onaylanan, ${row.bekleyen} bekleyen, ${row.hatali} hatalı, ${row.kalan} kalan`}>
          {row.onaylanan > 0 && <i data-seg="ok" style={{ width: `${pay(row.onaylanan)}%` }} />}
          {row.bekleyen > 0 && <i data-seg="wait" style={{ width: `${pay(row.bekleyen)}%` }} />}
          {row.hatali > 0 && <i data-seg="err" style={{ width: `${pay(row.hatali)}%` }} />}
        </div>
        <div className="bd-chips">
          <Cip deger={row.onaylanan} etiket={onayLabel} ton="ok" onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
          {!yardimci && row.bekleyen > 0 && <Cip deger={row.bekleyen} etiket="bekleyen" ton="wait" onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />}
          {!yardimci && row.hatali > 0 && <Cip deger={row.hatali} etiket="hatalı" ton="err" onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />}
          <Cip deger={row.kalan} etiket="kalan" ton="left" onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
        </div>
      </div>
      <div className="bd-row-status">
        <b className="bd-pct">%{pct}</b>
        {d.key === 'pending' ? <span className="bd-status-text">{d.label}</span> : <span className="bd-status" data-state={d.key}>{d.label}</span>}
      </div>
    </li>
  );
}

function Cip({ deger, etiket, ton, onClick }: { deger: number; etiket: ReactNode; ton: string; onClick: () => void }) {
  const tiklanir = deger > 0;
  return (
    <button type="button" className="bd-chip" data-ton={ton} data-zero={tiklanir ? undefined : 'true'} disabled={!tiklanir} onClick={tiklanir ? onClick : undefined} title={tiklanir ? 'Mükellef listesini göster' : undefined}>
      <b>{deger}</b> {etiket}
    </button>
  );
}
