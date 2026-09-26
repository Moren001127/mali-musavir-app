'use client';
import { portalStyle } from '@/lib/portal-theme';

// Sorgu pencereleri: "Tüm mükellefler" onayı · sorgu yapılamayan mükellefler (GET /sgk-vizite/durumlar, yalnız hatalılar).
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import { sgkViziteAnahtar, sgkViziteApi } from '@/lib/sgk-vizite';
import { METIN, TON } from '../belge-ortak';
import { IKINCIL, Pencere, PencereDugmesi, SOLUK, zamanYaz } from './ortak';

export function SorguOnayPenceresi({ acik, mukellefSayisi, onKapat, onOnay }: {
  acik: boolean;
  mukellefSayisi: number | null;
  onKapat: () => void;
  onOnay: () => void;
}) {
  const n = mukellefSayisi ?? 0;
  return (
    <Pencere
      acik={acik}
      onKapat={onKapat}
      baslik="Tüm mükellefler sorgulansın mı?"
      tur="sgk-sorgu"
      genislik={520}
      alt={
        <>
          <PencereDugmesi tur="ikincil" onClick={onKapat}>Vazgeç</PencereDugmesi>
          <PencereDugmesi tur="birincil" onClick={onOnay}><Download size={15} /> Sorgula</PencereDugmesi>
        </>
      }
    >
      <p data-sr-cumle className="text-[14px] leading-relaxed" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>
        {mukellefSayisi === null
          ? "SGK şifresi olan tüm mükellefler sorgulanacak. SGK onaylanmış rapor sorgusuna dakikada bir izin verdiği için her mükellef yaklaşık bir dakika sürer; sayfayı kapatabilirsiniz."
          : `${n} mükellef sorgulanacak. SGK onaylanmış rapor sorgusuna dakikada bir izin verdiği için yaklaşık ${n} dakika sürer; sayfayı kapatabilirsiniz.`}
      </p>
    </Pencere>
  );
}

export function SorguHatalariPenceresi({ acik, onKapat }: { acik: boolean; onKapat: () => void }) {
  const q = useQuery({
    queryKey: sgkViziteAnahtar.durumlar,
    queryFn: () => sgkViziteApi.durumlar(),
    enabled: acik,
    staleTime: 30_000,
  });
  const hatalilar = useMemo(
    () => (q.data?.satirlar || []).filter((s) => !!s.hata).sort((a, b) => a.mukellefAdi.localeCompare(b.mukellefAdi, 'tr')),
    [q.data],
  );
  return (
    <Pencere
      acik={acik}
      onKapat={onKapat}
      baslik="Sorgu yapılamayan mükellefler"
      ikon={<AlertTriangle size={15} style={portalStyle({ color: TON.kirmizi.fg, flexShrink: 0 })} />}
      tur="hata"
      genislik={560}
    >
      {q.isLoading ? (
        <div className="py-4 text-[13px]" style={portalStyle({ color: SOLUK })}>Yükleniyor…</div>
      ) : q.isError ? (
        <div className="py-4 text-[13px]" style={portalStyle({ color: '#e2706f' })}>Liste alınamadı; pencereyi kapatıp tekrar açın.</div>
      ) : hatalilar.length === 0 ? (
        <div className="py-4 text-[13px]" style={portalStyle({ color: SOLUK })}>Şu an sorgu hatası olan mükellef yok.</div>
      ) : (
        <div className="-mx-1">
          {hatalilar.map((s) => (
            <div key={s.taxpayerId} data-pa-hata-satir className="px-1 py-2.5" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.06)' })}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[13px] font-semibold" style={portalStyle({ color: METIN })}>{s.mukellefAdi}</div>
                {s.sonSorgu && <div data-sr-soluk className="flex-shrink-0 text-[11.5px] tabular-nums" style={portalStyle({ color: SOLUK })}>son sorgu {zamanYaz(s.sonSorgu)}</div>}
              </div>
              <div data-sr-hata-metni className="mt-1 text-[12.5px]" style={portalStyle({ color: IKINCIL })}>{s.hata}</div>
            </div>
          ))}
        </div>
      )}
      <div data-sr-soluk className="mt-3 text-[12px]" style={portalStyle({ color: SOLUK })}>
        Mükellefi seçip &quot;Bu mükellefi sorgula&quot; ile tekrar deneyebilirsiniz.
      </div>
    </Pencere>
  );
}
