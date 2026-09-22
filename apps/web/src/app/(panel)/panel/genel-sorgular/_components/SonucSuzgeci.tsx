'use client';

import { useMemo } from 'react';
import type { TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import { SORGU_TURLERI, SORGU_TURU_ADI, sorguMukellefAdi, sorguTuruMu, type SorguOzeti, type SorguTuru } from '@/lib/genel-sorgular';
import { adet, tarihSaat } from '../_lib/bicim';

export interface Suzgec {
  /** '' → tüm mükellefler */
  mukellefId: string;
  /** null → tüm türler */
  tur: SorguTuru | null;
  /** 'YYYY-MM' ya da '' (tüm dönemler) */
  donem: string;
}

/** Süzgeç satırı: mükellef · tür · dönem (ay / tüm dönemler). Adres çubuğu durumu üst bileşende. */
export function SonucSuzgeci({ suzgec, onSuzgec, mukellefler }: { suzgec: Suzgec; onSuzgec: (s: Suzgec) => void; mukellefler: TaxpayerLite[] }) {
  const sirali = useMemo(
    () => [...mukellefler].sort((a, b) => sorguMukellefAdi(a).localeCompare(sorguMukellefAdi(b), 'tr-TR')),
    [mukellefler],
  );
  const tumDonemler = suzgec.donem === '';
  const suzgecVar = !!suzgec.mukellefId || !!suzgec.tur || !tumDonemler;

  return (
    <div className="gs-suzgec" data-gs-suzgec>
      <label>
        <span>Mükellef</span>
        <select className="gs-secim" value={suzgec.mukellefId} onChange={(e) => onSuzgec({ ...suzgec, mukellefId: e.target.value })} aria-label="Mükellef süzgeci" style={{ maxWidth: 320 }}>
          <option value="">Tüm mükellefler</option>
          {sirali.map((m) => (
            <option key={m.id} value={m.id}>{sorguMukellefAdi(m) || m.id}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Tür</span>
        <select className="gs-secim" value={suzgec.tur || ''} onChange={(e) => onSuzgec({ ...suzgec, tur: sorguTuruMu(e.target.value) ? e.target.value : null })} aria-label="Sorgu türü süzgeci">
          <option value="">Tüm türler</option>
          {SORGU_TURLERI.map((t) => (
            <option key={t} value={t}>{SORGU_TURU_ADI[t]}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Dönem</span>
        <input type="month" className="gs-girdi" value={suzgec.donem} disabled={tumDonemler} onChange={(e) => onSuzgec({ ...suzgec, donem: e.target.value || '' })} aria-label="Dönem (ay)" title={tumDonemler ? 'Ay seçmek için "Tüm dönemler" işaretini kaldırın' : 'Dönem (ay)'} />
      </label>
      <label className="gs-tumu">
        <input type="checkbox" className="gs-kutu" checked={tumDonemler} onChange={(e) => onSuzgec({ ...suzgec, donem: e.target.checked ? '' : bugunAy() })} />
        <span>Tüm dönemler</span>
      </label>
      {suzgecVar && (
        <button type="button" className="gs-baglanti" onClick={() => onSuzgec({ mukellefId: '', tur: null, donem: '' })}>Süzgeçleri temizle</button>
      )}
    </div>
  );
}

function bugunAy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Tek satır özet: "Vergi Borcu 12 · son 22.09.2026 03:12 | e-Haciz 3 · son … | …" */
export function OzetSatiri({ ozet, yukleniyor }: { ozet?: SorguOzeti; yukleniyor: boolean }) {
  return (
    <div className="gs-ozet-satir" data-gs-ozet>
      {SORGU_TURLERI.map((t, i) => {
        const k = ozet?.[t];
        return (
          <span key={t}>
            {i > 0 && <span className="gs-ayrac">|</span>}{' '}
            {SORGU_TURU_ADI[t]} <b>{yukleniyor && !ozet ? '…' : adet(k?.adet ?? 0)}</b>
            {' '}<span>· son {k?.sonSorgu ? tarihSaat(k.sonSorgu) : '—'}</span>
          </span>
        );
      })}
    </div>
  );
}
