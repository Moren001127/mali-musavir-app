'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  paraTR, tarihTR,
  OK as UI_OK, MUTED as UI_MUTED, TEXT as UI_TEXT, CARD_BORDER, CARD_BG,
} from './ui';

/**
 * TAHSİLATLAR — kim, ne zaman, ne kadar ödedi.
 *
 * Tahsilat listesi eskiden yalnız tek mükellefin defterinde vardı; "bu ay
 * kimlerden ne aldım" sorusu için 75 mükellefi tek tek açmak gerekiyordu.
 *
 * Ay seçimi ve "tüm tahsilatlar" aynı kutuda: dönem daraltmak ile bütün
 * geçmişi görmek aynı işin iki ucu, ayrı düğmeye bölmek gereksiz.
 */

const CIZGI = CARD_BORDER;
const KART = CARD_BG;
const SATIR_CIZGI = 'rgba(255,255,255,0.045)';
const METIN = UI_TEXT;
const SOLUK = UI_MUTED;
const OK = UI_OK;

type TahsilatSatiri = {
  id: string;
  tarih: string;
  tutar: number | string;
  odemeYontemi?: string | null;
  belgeNo?: string | null;
  aciklama?: string | null;
  donem?: string | null;
  taxpayer?: { firstName?: string | null; lastName?: string | null; companyName?: string | null; taxNumber?: string | null } | null;
  account?: { id: string; name: string; color?: string | null } | null;
};

const TUMU = 'TUMU';

const para = (n: number | string | null | undefined) => paraTR(Number(n || 0));

const mukellefAdi = (t: TahsilatSatiri) =>
  t.taxpayer?.companyName ||
  [t.taxpayer?.firstName, t.taxpayer?.lastName].filter(Boolean).join(' ') ||
  'Bilinmeyen mükellef';

const yontemEtiket = (k?: string | null) => {
  const m: Record<string, string> = {
    NAKIT: 'Nakit', HAVALE: 'Havale / EFT', EFT: 'EFT',
    KREDI_KARTI: 'Kredi kartı', CEK: 'Çek', SENET: 'Senet',
  };
  return k ? m[k] || k : '—';
};

/** Son 24 ay + "tümü" — dönem listesi bugünden geriye üretilir */
function aySecenekleri() {
  const bugun = new Date();
  const liste: Array<{ deger: string; etiket: string }> = [
    { deger: TUMU, etiket: 'Tüm tahsilatlar' },
  ];
  for (let i = 0; i < 24; i++) {
    const d = new Date(bugun.getFullYear(), bugun.getMonth() - i, 1);
    const deger = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    liste.push({ deger, etiket: d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }) });
  }
  return liste;
}

const normalize = (s: string) =>
  s.toLocaleLowerCase('tr').replace(/[İI]/g, 'i').replace(/\s+/g, ' ').trim();

export default function TahsilatlarView() {
  const [donem, setDonem] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [arama, setArama] = useState('');

  // Dönem seçilince tarih aralığına çevrilir; "tümü"de aralık gönderilmez.
  const aralik = useMemo(() => {
    if (donem === TUMU) return {};
    const [y, a] = donem.split('-').map(Number);
    const bas = new Date(y, a - 1, 1);
    const bit = new Date(y, a, 0);
    return {
      baslangic: bas.toISOString().slice(0, 10),
      bitis: bit.toISOString().slice(0, 10),
    };
  }, [donem]);

  const { data = [], isLoading } = useQuery<TahsilatSatiri[]>({
    queryKey: ['cari-tahsilat-listesi', donem],
    queryFn: () =>
      api
        .get('/cari-kasa/hareket', { params: { tip: 'TAHSILAT', limit: 2000, ...aralik } })
        .then((r) => r.data),
  });

  const gosterilen = useMemo(() => {
    const ara = normalize(arama.trim());
    const suz = ara
      ? data.filter((t) =>
          normalize([mukellefAdi(t), t.taxpayer?.taxNumber || '', t.belgeNo || '', t.aciklama || ''].join(' ')).includes(ara),
        )
      : data;
    return [...suz].sort((a, b) => new Date(b.tarih).getTime() - new Date(a.tarih).getTime());
  }, [data, arama]);

  const toplam = useMemo(
    () => gosterilen.reduce((t, x) => t + Number(x.tutar || 0), 0),
    [gosterilen],
  );

  const excelIndir = () => {
    // Sunucuda tahsilat listesi için ayrı bir çıktı ucu yok; tarayıcıda üretiyoruz.
    const basliklar = ['Tarih', 'Mükellef', 'VKN', 'Tutar', 'Yöntem', 'Hesap', 'Belge No', 'Açıklama'];
    const satirlar = gosterilen.map((t) => [
      tarihTR(t.tarih),
      mukellefAdi(t),
      t.taxpayer?.taxNumber || '',
      String(Number(t.tutar || 0)).replace('.', ','),
      yontemEtiket(t.odemeYontemi),
      t.account?.name || '',
      t.belgeNo || '',
      (t.aciklama || '').replace(/"/g, "'"),
    ]);
    const csv = [basliklar, ...satirlar]
      .map((r) => r.map((h) => `"${h}"`).join(';'))
      .join('\r\n');
    try {
      // BOM: Excel Türkçe karakterleri UTF-8 olarak tanısın
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tahsilatlar_${donem === TUMU ? 'tumu' : donem}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast.error('Dosya oluşturulamadı');
    }
  };

  const secStil: React.CSSProperties = {
    background: 'rgba(0,0,0,0.25)', border: `1px solid ${CIZGI}`, color: METIN,
    borderRadius: 10, padding: '8px 10px', fontSize: 12.5, outline: 'none',
  };

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-2xl" style={{ background: KART, border: `1px solid ${CIZGI}` }}>
        {/* ARAÇ ÇUBUĞU */}
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${CIZGI}` }}>
          <span className="text-[13px] font-semibold" style={{ color: METIN }}>Tahsilatlar</span>

          <select
            value={donem}
            onChange={(e) => setDonem(e.target.value)}
            style={secStil}
            className="[&>option]:bg-[#0c0c0e]"
          >
            {aySecenekleri().map((a) => (
              <option key={a.deger} value={a.deger}>{a.etiket}</option>
            ))}
          </select>

          <div className="relative w-full sm:w-[240px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SOLUK }} />
            <input
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Mükellef, belge no, açıklama…"
              className="w-full rounded-lg py-2 pl-9 pr-3 text-[12.5px] outline-none"
              style={{ border: `1px solid ${CIZGI}`, background: 'rgba(0,0,0,0.25)', color: METIN }}
            />
          </div>

          <span className="ml-auto flex items-center gap-2">
            <button
              onClick={excelIndir}
              disabled={gosterilen.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition hover:brightness-125 disabled:opacity-40"
              style={{ border: `1px solid ${CIZGI}`, background: 'rgba(255,255,255,0.02)', color: '#d4d4d8' }}
            >
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          </span>
        </div>

        {isLoading ? (
          <div className="px-4 py-14 text-center text-[12.5px]" style={{ color: SOLUK }}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Tahsilatlar yükleniyor…
          </div>
        ) : gosterilen.length === 0 ? (
          <div className="px-4 py-14 text-center text-[12.5px]" style={{ color: SOLUK }}>
            {arama ? 'Aramaya uyan tahsilat yok.' : 'Bu dönemde tahsilat yok.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* table-fixed: uzun firma adı sütunları itip sağdakileri ekran
                dışına taşımasın (listede bir kez bu hataya düşüldü) */}
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col style={{ width: 104 }} />
                <col />
                <col style={{ width: 140 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider" style={{ color: SOLUK }}>
                  <th className="px-4 py-2.5 text-left font-medium">Tarih</th>
                  <th className="px-3 py-2.5 text-left font-medium">Mükellef</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tutar</th>
                  <th className="px-3 py-2.5 text-left font-medium">Yöntem</th>
                  <th className="px-3 py-2.5 text-left font-medium">Hesap</th>
                  <th className="px-4 py-2.5 text-left font-medium">Belge no</th>
                </tr>
              </thead>
              <tbody>
                {gosterilen.map((t) => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${SATIR_CIZGI}` }}>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums" style={{ color: SOLUK }}>
                      {tarihTR(t.tarih)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block truncate" style={{ color: METIN }}>{mukellefAdi(t)}</span>
                      {t.aciklama && (
                        <span className="mt-0.5 block truncate text-[11px]" style={{ color: SOLUK }}>{t.aciklama}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: OK }}>
                      {para(t.tutar)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5" style={{ color: SOLUK }}>
                      {yontemEtiket(t.odemeYontemi)}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.account?.name ? (
                        <span className="inline-flex items-center gap-1.5 truncate" style={{ color: '#d4d4d8' }}>
                          <i className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: t.account.color || '#d4b876' }} />
                          <span className="truncate">{t.account.name}</span>
                        </span>
                      ) : (
                        <span style={{ color: 'rgba(113,113,122,0.5)' }}>Nakit kasa</span>
                      )}
                    </td>
                    <td className="truncate px-4 py-2.5" style={{ color: SOLUK }}>{t.belgeNo || '—'}</td>
                  </tr>
                ))}

                <tr style={{ borderTop: `1px solid ${CIZGI}`, background: 'rgba(255,255,255,0.022)' }}>
                  <td className="px-4 py-3 text-[11.5px] uppercase tracking-wider" colSpan={2} style={{ color: SOLUK }}>
                    Toplam · {gosterilen.length} tahsilat
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums" style={{ color: OK }}>
                    {para(toplam)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
