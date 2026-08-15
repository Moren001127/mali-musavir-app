'use client';

import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, Wallet, CreditCard, AlertTriangle, Info,
  CalendarClock, Landmark,
} from 'lucide-react';
import { butceApi, Ozet, para, tarihTR, donemTR, EKSTRE_DURUM_ETIKET } from '@/lib/butce';
import {
  Kutu, KPI, Rozet, Bos, TrendGrafik, OranCubugu,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MUTED, TEXT, ROW_SEP,
} from './ui';
import AiKutu from './AiKutu';

export default function GenelBakis({ ozet, donem }: { ozet: Ozet; donem: string }) {
  const aiSorgu = useQuery({
    queryKey: ['butce-ai-aylik', donem],
    queryFn: () => butceApi.aiAylik(donem, false),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const aiYenile = useMutation({
    mutationFn: () => butceApi.aiAylik(donem, true),
    onSuccess: (d) => aiSorgu.refetch().catch(() => d),
  });

  const kalanOran = ozet.gelir > 0 ? Math.round((ozet.net / ozet.gelir) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Uyarılar */}
      {ozet.uyarilar.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {ozet.uyarilar.map((u, i) => {
            const renk = u.seviye === 'KRITIK' ? KIRMIZI : u.seviye === 'UYARI' ? TURUNCU : MAVI;
            return (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: `${renk}12`, border: `1px solid ${renk}33` }}
              >
                <span style={{ color: renk }} className="mt-0.5">
                  {u.seviye === 'BILGI' ? <Info size={15} /> : <AlertTriangle size={15} />}
                </span>
                <div>
                  <div className="text-[12.5px] font-semibold" style={{ color: renk }}>
                    {u.baslik}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
                    {u.mesaj}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KPI şeridi */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KPI etiket="Gelir" deger={`${para(ozet.gelir)} ₺`} renk={OK} ikon={<TrendingUp size={14} />} altBilgi={donemTR(donem)} />
        <KPI
          etiket="Gider"
          deger={`${para(ozet.gider)} ₺`}
          renk={KIRMIZI}
          ikon={<TrendingDown size={14} />}
          altBilgi={`Nakit ${para(ozet.nakitGider)} ₺ · Kartla ${para(ozet.kartGideri)} ₺`}
        />
        <KPI
          etiket="Ay sonu kalan"
          deger={`${para(ozet.net)} ₺`}
          renk={ozet.net >= 0 ? GOLD : KIRMIZI}
          ikon={<Wallet size={14} />}
          altBilgi={`Nakit akışı ${para(ozet.nakitNet)} ₺${ozet.gelir > 0 ? ` · gelirin %${kalanOran}’i` : ''}`}
          vurgu
        />
        <KPI
          etiket="Toplam borç"
          deger={`${para(ozet.borcOzet.toplam)} ₺`}
          renk={TURUNCU}
          ikon={<CreditCard size={14} />}
          altBilgi={`Kart ${para(ozet.borcOzet.kart)} ₺ · Kredi ${para(ozet.borcOzet.kredi)} ₺`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Trend */}
        <Kutu baslik="Son 6 ay" aciklama="Gelir ve giderin aylık seyri" className="xl:col-span-2">
          <TrendGrafik veri={ozet.trend} />
        </Kutu>

        {/* Aylık zorunlu ödeme */}
        <Kutu baslik="Bu ayın zorunlu borç ödemesi" aciklama="Kart asgarileri + kredi taksitleri" renk={TURUNCU}>
          <div className="text-[26px] font-semibold tabular-nums" style={{ color: TURUNCU }}>
            {para(ozet.borcOzet.aylikZorunluOdeme)} ₺
          </div>
          <div className="mt-2 space-y-1 text-[11.5px]" style={{ color: MUTED }}>
            <div className="flex justify-between">
              <span>Gelir − nakit gider</span>
              <span className="tabular-nums" style={{ color: ozet.nakitNet >= 0 ? OK : KIRMIZI }}>
                {para(ozet.nakitNet)} ₺
              </span>
            </div>
            <div className="flex justify-between">
              <span>Nakit yastığı</span>
              <span className="tabular-nums">{para(ozet.nakitYastigi)} ₺</span>
            </div>
            <div className="flex justify-between border-t pt-1" style={{ borderColor: ROW_SEP, color: TEXT }}>
              <span>Borca ayrılabilir</span>
              <span className="tabular-nums" style={{ color: GOLD }}>
                {para(Math.max(ozet.nakitNet - ozet.nakitYastigi, 0))} ₺
              </span>
            </div>
          </div>
        </Kutu>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Yaklaşan ödemeler */}
        <Kutu
          baslik="Yaklaşan ödemeler"
          aciklama="Önümüzdeki 30 gün"
          renk={MAVI}
          sag={<CalendarClock size={14} style={{ color: MAVI }} />}
        >
          {ozet.yaklasanOdemeler.length === 0 ? (
            <Bos metin="30 gün içinde ödemesi gelen kart ekstresi yok." />
          ) : (
            <div className="max-h-[300px] overflow-y-auto pr-1">
              <table className="w-full text-[12px]">
                <tbody>
                  {ozet.yaklasanOdemeler.map((e) => {
                    const d = EKSTRE_DURUM_ETIKET[e.durum];
                    const gecti = (e.kalanGun ?? 0) < 0;
                    return (
                      <tr key={e.id} className="border-b last:border-0" style={{ borderColor: ROW_SEP }}>
                        <td className="py-2">
                          <div style={{ color: TEXT }}>
                            {e.kart?.bankaAdi} {e.kart?.kartAdi}
                          </div>
                          <div className="text-[10.5px]" style={{ color: MUTED }}>
                            {e.donem} · son ödeme {tarihTR(e.sonOdemeTarihi)}
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums" style={{ color: TEXT }}>
                          {e.borcTutari === null ? (
                            <span style={{ color: TURUNCU }}>tutar girilmedi</span>
                          ) : (
                            `${para(e.kalanTutar ?? 0)} ₺`
                          )}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <Rozet
                            metin={gecti ? `${Math.abs(e.kalanGun ?? 0)} gün geçti` : `${e.kalanGun} gün`}
                            renk={d.renk}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Kutu>

        {/* Kategori kırılımı */}
        <Kutu baslik="Para nereye gitti" aciklama={`${donemTR(donem)} gider dağılımı`} renk={KIRMIZI}>
          {ozet.kategoriKirilim.length === 0 ? (
            <Bos metin="Bu dönem gider kaydı yok." ikon={<Landmark size={18} />} />
          ) : (
            <>
              <OranCubugu kalemler={ozet.kategoriKirilim.map((k) => ({ ad: k.ad, tutar: k.tutar, renk: k.renk }))} />
              <div className="mt-3 max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
                {ozet.kategoriKirilim.map((k) => {
                  const oran = ozet.gider > 0 ? Math.round((k.tutar / ozet.gider) * 100) : 0;
                  return (
                    <div key={k.ad} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <i className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: k.renk }} />
                        <span className="truncate" style={{ color: TEXT }}>
                          {k.ad}
                        </span>
                        {k.zorunlu && <Rozet metin="zorunlu" renk={MUTED} />}
                      </span>
                      <span className="flex-shrink-0 tabular-nums" style={{ color: MUTED }}>
                        {para(k.tutar)} ₺ · %{oran}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Kutu>
      </div>

      <AiKutu
        baslik="Yapay zekâ değerlendirmesi"
        aciklama="Kendi verinize dayalı yorum — yatırım tavsiyesi değildir"
        rapor={aiSorgu.data}
        yukleniyor={aiSorgu.isLoading || aiYenile.isPending}
        yenile={() => aiYenile.mutate()}
      />
    </div>
  );
}
