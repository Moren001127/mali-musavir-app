'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EKSIK_DURUM_ADI, genelSorgularApi, sorguMukellefAdi, type EksikGorselSatiri } from '@/lib/genel-sorgular';
import { adet, donemEtiketi, tarihKisa, tutar } from '../_lib/bicim';
import { csvIndir } from '../_lib/disa-aktar';

/*
 * "Görseli eksik faturalar" — Dijital Vergi Dairesi'nden çekilen GELEN e-Arşiv listesi ile Luca'dan indirilen
 * alış e-Arşiv/e-Fatura kayıtları karşılaştırılır; Luca'da olmayan ya da görseli inmemiş faturalar listelenir.
 * Kenarlıklı düz tablo; durum kelimeyle ("Luca'da yok" / "Görsel yok"). Fatura Merkezi'ne hiçbir şey yazılmaz.
 */
export function EksikGorseller({ suzgec }: { suzgec: { taxpayerId?: string; donem?: string } }) {
  const [indiriliyor, setIndiriliyor] = useState(false);
  const q = useQuery({
    queryKey: ['genel-sorgular', 'eksik-gorseller', suzgec.taxpayerId || '', suzgec.donem || ''],
    queryFn: () => genelSorgularApi.eksikGorseller(suzgec),
    staleTime: 60_000,
  });
  const rows = q.data?.rows ?? [];
  const ozet = q.data?.ozet;

  const excelIndir = () => {
    if (!rows.length) { toast.info('İndirilecek satır yok.'); return; }
    setIndiriliyor(true);
    try {
      const gun = new Date().toISOString().slice(0, 10);
      csvIndir(`Gorseli-Eksik-Faturalar_${gun}.csv`,
        ['Mükellef', 'VKN/TCKN', 'Dönem', 'Fatura no', 'Fatura tarihi', 'Satıcı', 'Satıcı VKN', 'Mal/hizmet', 'Vergi', 'Ödenecek', 'Durum'],
        rows.map((r) => [sorguMukellefAdi(r.taxpayer) || r.taxpayerId, r.taxpayer?.taxNumber || '', donemEtiketi(r.donem), r.faturaNo, tarihKisa(r.duzenlenmeTarihi), r.saticiUnvan, r.saticiVkn, r.toplamTutar, r.vergilerTutari, r.odenecekTutar, EKSIK_DURUM_ADI[r.durum]]));
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <div data-gs-eksik>
      <div className="gs-eksik-ozet">
        {q.isLoading ? 'Karşılaştırılıyor…' : ozet ? (
          <>
            Dijital Vergi Dairesi listesi <b>{adet(ozet.dvd)}</b> fatura · Luca'da görselli <b>{adet(ozet.lucaVar)}</b> · Luca'da yok <b className={ozet.lucaYok ? 'gs-kirmizi' : ''}>{adet(ozet.lucaYok)}</b> · görsel yok <b className={ozet.gorselYok ? 'gs-kirmizi' : ''}>{adet(ozet.gorselYok)}</b>
            <span className="gs-eksik-not"> — Luca çekimi: <Link href="/panel/e-arsiv" className="gs-baglanti">E-Fatura / E-Arşiv</Link></span>
          </>
        ) : null}
        <button type="button" className="gs-dugme-ikincil" style={{ marginLeft: 'auto' }} onClick={excelIndir} disabled={indiriliyor || rows.length === 0}>Excel indir</button>
      </div>
      {q.isError ? (
        <div className="gs-hata">Karşılaştırma yapılamadı: {(q.error as { message?: string })?.message || 'bilinmeyen hata'}</div>
      ) : !q.isLoading && rows.length === 0 ? (
        <div className="gs-bos">
          <b>{ozet && ozet.dvd > 0 ? 'Eksik yok' : 'Karşılaştırılacak liste yok'}</b>
          <span>
            {ozet && ozet.dvd > 0
              ? 'Dijital Vergi Dairesi listesindeki her faturanın Luca çekiminde görseli var.'
              : 'Önce Gelen e-Arşiv sorgusu çalışmalı (gece ya da Sorgula).'}
          </span>
        </div>
      ) : (
        <div className="gs-tablo-sar">
          <table className="gs-tablo" style={{ minWidth: 1150 }}>
            <colgroup>
              <col style={{ width: 200 }} /><col style={{ width: 116 }} /><col style={{ width: 118 }} /><col style={{ width: 168 }} /><col style={{ width: 104 }} /><col /><col style={{ width: 112 }} /><col style={{ width: 124 }} /><col style={{ width: 112 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Mükellef</th><th>VKN / TCKN</th><th>Dönem</th><th>Fatura no</th><th>Tarih</th><th>Satıcı</th><th>Satıcı VKN</th><th className="sag">Ödenecek (₺)</th><th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: EksikGorselSatiri) => (
                <tr key={`${r.taxpayerId}-${r.faturaNo}-${r.saticiVkn}`}>
                  <td className="gs-tek-satir">
                    <Link href={`/panel/mukellefler/${r.taxpayerId}`} className="gs-mukellef" title={sorguMukellefAdi(r.taxpayer) || r.taxpayerId}>{sorguMukellefAdi(r.taxpayer) || r.taxpayerId}</Link>
                  </td>
                  <td>{r.taxpayer?.taxNumber ? <span className="gs-vkn">{r.taxpayer.taxNumber}</span> : <span className="gs-sifir">—</span>}</td>
                  <td className="gs-tek-satir"><span>{donemEtiketi(r.donem) || '—'}</span></td>
                  <td className="gs-sayi gs-tek-satir"><span title={r.faturaNo}>{r.faturaNo}</span></td>
                  <td className="gs-sayi">{tarihKisa(r.duzenlenmeTarihi) || '—'}</td>
                  <td className="gs-tek-satir"><span title={r.saticiUnvan}>{r.saticiUnvan || '—'}</span></td>
                  <td className="gs-sayi gs-soluk">{r.saticiVkn || '—'}</td>
                  <td className="sag gs-sayi">{tutar(r.odenecekTutar)}</td>
                  <td className={r.durum === 'LUCA_YOK' ? 'gs-kirmizi' : 'gs-soluk'}>{EKSIK_DURUM_ADI[r.durum]}</td>
                </tr>
              ))}
              {q.isLoading && <tr className="gs-yukleniyor-satir"><td colSpan={9}>Karşılaştırılıyor…</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
