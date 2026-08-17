'use client';

import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, Wallet, CreditCard, AlertTriangle, Info,
  CalendarClock, Landmark, Coins, Scale,
} from 'lucide-react';
import {
  butceApi, Ozet, para, tarihTR, donemTR, ekstreDurumBilgi,
} from '@/lib/butce';
import {
  Kutu, KPI, Rozet, Bos, TrendGrafik, OranCubugu,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, MUTED, TEXT, ROW_SEP,
} from './ui';
import AiKutu from './AiKutu';

/* Sunucu bu alanları döndürüyor ama ortak tip dosyası (lib/butce.ts) bu iş
 * kapsamında değiştirilmediği için sözleşme burada yerel tanımlandı.
 * Alanlar isteğe bağlı: eski bir yanıt gelirse ekran çökmesin. */
type OzetAkis = Ozet & {
  aktarimGiris?: number;
  aktarimCikis?: number;
  toplamNakitGirisi?: number;
};

export default function GenelBakis({
  ozet,
  donem,
}: {
  ozet: Ozet;
  donem: string;
}) {
  const akis = ozet as OzetAkis;
  const aktarimGiris = akis.aktarimGiris ?? 0;
  const aktarimCikis = akis.aktarimCikis ?? 0;
  const toplamGiris = akis.toplamNakitGirisi ?? ozet.gelir + aktarimGiris;

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
  const hesapSayisi = ozet.hesapOzet?.length ?? 0;

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
      <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(113,113,122,0.9)' }}>
        Üst sıra <strong style={{ color: MUTED }}>bu ayın hareketini</strong>, alt sıra{' '}
        <strong style={{ color: MUTED }}>bugünkü durumunuzu</strong> gösterir.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <KPI
            etiket="Gelir"
            deger={`${para(ozet.gelir)} ₺`}
            renk={OK}
            ikon={<TrendingUp size={14} />}
            altBilgi={donemTR(donem)}
          />
                  </div>

        <KPI
          etiket="Gider"
          deger={`${para(ozet.gider)} ₺`}
          renk={KIRMIZI}
          ikon={<TrendingDown size={14} />}
          altBilgi={`Ofis ${para(ozet.meslekiGider)} ₺ · Kişisel ${para(ozet.kisiselGider)} ₺`}
        />
        <KPI
          etiket="Bu ay net"
          deger={`${para(ozet.net)} ₺`}
          renk={ozet.net >= 0 ? GOLD : KIRMIZI}
          ikon={<Wallet size={14} />}
          altBilgi={`Gelir − gider${ozet.gelir > 0 ? ` · gelirin %${kalanOran}’i` : ''}`}
          vurgu
        />
        <KPI
          etiket="Net varlıklar"
          deger={`${para(ozet.nakitVarlik)} ₺`}
          renk={MOR}
          ikon={<Coins size={14} />}
          altBilgi={
            ozet.nakitKasasi !== 0
              ? `Bankada ${para(ozet.bankaBakiyesi)} ₺ · elde ${para(ozet.nakitKasasi)} ₺`
              : hesapSayisi > 0
                ? `${hesapSayisi} banka hesabındaki bugünkü bakiye`
                : 'Banka hesabı tanımlı değil'
          }
        />
        <KPI
          etiket="Toplam borç"
          deger={`${para(ozet.borcOzet.toplam)} ₺`}
          renk={TURUNCU}
          ikon={<CreditCard size={14} />}
          altBilgi={
            `Kart ${para(ozet.borcOzet.kart + ozet.borcOzet.kartDonemIci)} ₺` +
            (ozet.borcOzet.kartDonemIci > 0
              ? ` (${para(ozet.borcOzet.kartDonemIci)} ₺ dönem içi)`
              : '') +
            ` · Kredi ${para(ozet.borcOzet.kredi)} ₺` +
            (ozet.borcOzet.kmh > 0 ? ` · Ek hesap ${para(ozet.borcOzet.kmh)} ₺` : '')
          }
        />
        <KPI
          etiket="Varlık − borç"
          deger={`${para(ozet.netVarlik)} ₺`}
          renk={ozet.netVarlik >= 0 ? OK : KIRMIZI}
          ikon={<Scale size={14} />}
          altBilgi="Hesabımdaki para − tüm borçlar"
          vurgu={ozet.netVarlik < 0}
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
          {/* Kapasite ELDEKİ PARADAN okunur — Ödeme Planı ekranıyla aynı hesap */}
          <div className="mt-2 space-y-1 text-[11.5px]" style={{ color: MUTED }}>
            <div className="flex justify-between">
              <span>Hesaplardaki para</span>
              <span className="tabular-nums" style={{ color: MOR }}>
                {para(ozet.nakitVarlik)} ₺
              </span>
            </div>
            <div className="flex justify-between">
              <span>Nakit yastığı</span>
              <span className="tabular-nums">{para(ozet.nakitYastigi)} ₺</span>
            </div>
            <div className="flex justify-between border-t pt-1" style={{ borderColor: ROW_SEP, color: TEXT }}>
              <span>Borca ayrılabilir</span>
              <span className="tabular-nums" style={{ color: GOLD }}>
                {para(ozet.odemeKapasitesi)} ₺
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
                    const d = ekstreDurumBilgi(e.durum);
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
                        {/* Mesleki/kişisel ayrımı artık kategori satırında görünür */}
                        <Rozet
                          metin={k.defter === 'OFIS' ? 'ofis' : 'kişisel'}
                          renk={k.defter === 'OFIS' ? MAVI : GOLD}
                        />
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
