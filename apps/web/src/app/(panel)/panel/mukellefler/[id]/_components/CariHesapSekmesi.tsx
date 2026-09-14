'use client';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Landmark, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FAINT, GOLD, GREEN, HAIR, MUTED, NOTR_DUGME, RED, TEXT, fmtDateTR, fmtTutar, toMoneyNumber } from '../_lib/tema';
import { BaglantiDugme, BosDurum, Cip, GrupSatiri, SekmeBasligi, TabloSarmal, Td, Th } from './ortak/Tablo';

type CariBakiye = {
  tahakkuk?: number;
  tahsilat?: number;
  iade?: number;
  duzeltme?: number;
  borc?: number;
  alacak?: number;
  bakiye?: number;
};

type CariHareket = {
  id: string;
  tarih: string;
  tip: 'TAHAKKUK' | 'TAHSILAT' | 'IADE' | 'DUZELTME' | string;
  tutar: number | string;
  aciklama?: string | null;
  odemeYontemi?: string | null;
  donem?: string | null;
  runningBakiye?: number;
  hizmet?: { hizmetAdi?: string | null } | null;
};

const SUTUN = 6;

/** Cari Hesap: tek satır özet (sayaç kutusu YOK) + kenarlıklı gerçek tablo; açıklama satıra tıklayınca açılır. */
export function CariHesapTab({ taxpayerId }: { taxpayerId: string }) {
  const [ekstreBusy, setEkstreBusy] = useState(false);
  const [acikId, setAcikId] = useState<string | null>(null);
  const { data: bakiye, isLoading: bakiyeLoading } = useQuery<CariBakiye>({
    queryKey: ['cari-bakiye', taxpayerId],
    queryFn: () => api.get(`/cari-kasa/bakiye/${taxpayerId}`).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const { data: hareketler = [], isLoading: hareketLoading } = useQuery<CariHareket[]>({
    queryKey: ['cari-hareketler', taxpayerId, 'kart'],
    queryFn: () => api.get('/cari-kasa/hareket', { params: { taxpayerId, limit: 12 } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const loading = bakiyeLoading || hareketLoading;
  const netBakiye = Number(bakiye?.bakiye || 0);
  const borclu = netBakiye > 0;
  const downloadEkstre = async () => {
    setEkstreBusy(true);
    try {
      const now = new Date();
      const baslangic = `${now.getFullYear()}-01-01`;
      const bitis = now.toISOString().slice(0, 10);
      const resp = await api.get(`/cari-kasa/ekstre/${taxpayerId}/pdf`, {
        params: { baslangic, bitis },
        responseType: 'text',
        transformResponse: (data) => data,
      });
      const blob = new Blob([resp.data], { type: 'text/html; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      toast.success('Logolu ekstre açıldı');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ekstre indirilemedi');
    } finally {
      setEkstreBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <SekmeBasligi title="Cari Hesap" text="Cari Kasa & Tahsilat modülündeki bakiye ve son hareketler.">
        <button
          type="button"
          onClick={downloadEkstre}
          disabled={ekstreBusy}
          className="inline-flex h-9 items-center gap-1.5 px-3.5 text-[13px] font-medium transition hover:brightness-125 disabled:opacity-50"
          style={NOTR_DUGME}
        >
          {ekstreBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Ekstre indir
        </button>
        <BaglantiDugme href={`/panel/cari-kasa?mukellef=${taxpayerId}`}>
          Cari modülünde aç <ExternalLink size={13} />
        </BaglantiDugme>
      </SekmeBasligi>

      {/* Tek satır özet — sayaç kutusu yok */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y py-2 text-[13px]" style={{ borderColor: HAIR }}>
        <Ozet ad="Toplam tahakkuk" deger={`${fmtTutar(bakiye?.tahakkuk || 0)} ₺`} />
        <Ozet ad="Toplam tahsilat" deger={`${fmtTutar(bakiye?.tahsilat || 0)} ₺`} renk={GREEN} />
        <Ozet ad="Açık bakiye" deger={`${fmtTutar(Math.abs(netBakiye))} ₺ ${borclu ? 'Borç' : 'Alacak/Yok'}`} renk={borclu ? RED : GREEN} vurgu />
        <span className="ml-auto text-[11.5px]" style={{ color: FAINT }}>{loading ? 'Yükleniyor' : `${hareketler.length} son kayıt`}</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
          <Loader2 size={15} className="animate-spin" /> Cari hareketler yükleniyor...
        </div>
      ) : hareketler.length === 0 ? (
        <BosDurum icon={Landmark} title="Cari hareket yok" text="Bu mükellef için cari hareket bulunamadı." />
      ) : (
        <TabloSarmal minWidth={820}>
          <colgroup>
            <col style={{ width: 104 }} />
            <col style={{ width: 110 }} />
            <col />
            <col style={{ width: 128 }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 132 }} />
          </colgroup>
          <thead>
            <tr>
              <Th>Tarih</Th>
              <Th>Tip</Th>
              <Th>Açıklama</Th>
              <Th right>Borç</Th>
              <Th right>Alacak</Th>
              <Th right>Bakiye</Th>
            </tr>
          </thead>
          <tbody>
            <GrupSatiri ad="Son hareketler" sayi={hareketler.length} colSpan={SUTUN} />
            {hareketler.map((h) => {
              const tutar = toMoneyNumber(h.tutar);
              const borc = h.tip === 'TAHAKKUK' ? tutar : h.tip === 'IADE' ? -tutar : 0;
              const alacak = h.tip === 'TAHSILAT' ? tutar : h.tip === 'DUZELTME' ? -tutar : 0;
              const tipLabel = h.tip === 'TAHAKKUK' ? 'Tahakkuk' : h.tip === 'TAHSILAT' ? 'Tahsilat' : h.tip === 'IADE' ? 'İade' : 'Düzeltme';
              const isTahsilat = h.tip === 'TAHSILAT';
              const aciklama = `${h.hizmet?.hizmetAdi ? `${h.hizmet.hizmetAdi}${h.aciklama ? ' · ' : ''}` : ''}${h.aciklama || h.donem || '—'}`;
              const acik = acikId === h.id;
              return (
                <React.Fragment key={h.id}>
                  <tr
                    className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    onClick={() => setAcikId((v) => (v === h.id ? null : h.id))}
                    title={acik ? 'Açıklamayı kapat' : 'Açıklamayı aç'}
                  >
                    <Td muted tabular>{fmtDateTR(h.tarih?.substring(0, 10))}</Td>
                    <Td><Cip renk={isTahsilat ? GREEN : GOLD}>{tipLabel}</Cip></Td>
                    <Td><span className="block max-w-full truncate">{aciklama}</span></Td>
                    <Td right tabular style={{ color: borc ? RED : FAINT, fontWeight: borc ? 700 : 500 }}>{borc ? `${fmtTutar(borc)} ₺` : '—'}</Td>
                    <Td right tabular style={{ color: alacak ? GREEN : FAINT, fontWeight: alacak ? 700 : 500 }}>{alacak ? `${fmtTutar(alacak)} ₺` : '—'}</Td>
                    <Td right tabular style={{ fontWeight: 700 }}>{h.runningBakiye != null ? `${fmtTutar(h.runningBakiye)} ₺` : '—'}</Td>
                  </tr>
                  {acik && (
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <Td colSpan={SUTUN} muted style={{ padding: '8px 14px', whiteSpace: 'pre-wrap' }}>
                        <span className="text-[11.5px] font-medium" style={{ color: FAINT }}>Açıklama · </span>
                        {aciklama}
                        {h.odemeYontemi ? <span style={{ color: FAINT }}> · Ödeme: {h.odemeYontemi}</span> : null}
                        {h.donem ? <span style={{ color: FAINT }}> · Dönem: {h.donem}</span> : null}
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </TabloSarmal>
      )}
    </div>
  );
}

function Ozet({ ad, deger, renk = TEXT, vurgu }: { ad: string; deger: string; renk?: string; vurgu?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11.5px]" style={{ color: MUTED }}>{ad}</span>
      <span className="tabular-nums" style={{ color: renk, fontWeight: vurgu ? 700 : 500 }}>{deger}</span>
    </span>
  );
}
