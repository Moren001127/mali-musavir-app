'use client';
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Card, Section, Empty, Spinner, PageTitle, StatStrip, GOLD, Badge, Th, THead, openBelge } from '../_lib/shared';
import {
  ArrowDownLeft, ArrowUpRight, Eye, BarChart3, Calendar,
  Scale, Percent, FileStack, TrendingUp,
} from 'lucide-react';

const ALIS = '#d4b876';
const SATIS = '#4ade80';
const KDV_RENK = '#a78bfa';

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

const turEtiket = (t: string) => /SATIS/i.test(t) ? 'Satış' : /TEVKIFAT/i.test(t) ? 'Tevkifatlı Alış' : 'Alış';
const belgeEtiket = (t: string) => (t === 'E_FATURA' ? 'e-Fatura' : t === 'E_ARSIV' ? 'e-Arşiv' : t === 'FIS' ? 'Fiş' : t || '—');
const VERI_GUVENI: Record<string, { label: string; color: string }> = {
  kesin: { label: 'Kesin', color: '#4ade80' },
  kontrol_gerekli: { label: 'Kontrol gerekli', color: '#fbbf24' },
  eksik: { label: 'Eksik veri', color: '#f87171' },
};

export default function MukellefFaturalar() {
  const now = new Date();
  const [yil, setYil] = useState(now.getFullYear());
  const [ay, setAy] = useState(now.getMonth() + 1); // 1-12
  const donem = `${yil}-${String(ay).padStart(2, '0')}`;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['portal-faturalar', yil, donem],
    queryFn: () => taxpayerApi.get('/portal/faturalar', { params: { yil, donem } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const mevcutYillar: number[] = data?.mevcutYillar?.length ? data.mevcutYillar : [now.getFullYear()];
  const ayOzet = data?.ayOzet || { alisToplam: 0, satisToplam: 0, alisAdet: 0, satisAdet: 0, toplamAdet: 0 };
  const aylik: any[] = data?.aylik || [];
  const faturalar: any[] = data?.faturalar || [];
  const kdv = data?.kdv;
  const net = (ayOzet.satisToplam || 0) - (ayOzet.alisToplam || 0);
  const maxAy = Math.max(1, ...aylik.map((a) => Math.max(a.alis, a.satis)));

  // Sağ üst — yıl + ay seçici araç çubuğu
  const seciciler = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 px-2.5 h-[36px] rounded-[10px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <Calendar size={13} style={{ color: 'rgba(250,250,249,0.5)' }} />
        <select value={yil} onChange={(e) => setYil(Number(e.target.value))} className="bg-transparent text-[13px] outline-none cursor-pointer" style={{ color: '#fafaf9' }}>
          {mevcutYillar.map((y) => <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>)}
        </select>
      </div>
      <div className="flex items-center px-2.5 h-[36px] rounded-[10px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <select value={ay} onChange={(e) => setAy(Number(e.target.value))} className="bg-transparent text-[13px] outline-none cursor-pointer" style={{ color: '#fafaf9' }}>
          {AY_ADLARI.map((adi, i) => <option key={adi} value={i + 1} style={{ background: '#0f0d0b' }}>{adi}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageTitle ust="Fatura Merkezi" baslik="Faturalarım" right={seciciler} />

      {isLoading ? <Spinner /> : (
        <div className={`space-y-5 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          {/* Seçili ay sayaç şeridi */}
          <StatStrip
            items={[
              { label: 'Alış (Seçili Ay)', value: fmtTRY(ayOzet.alisToplam), sub: `${ayOzet.alisAdet} belge`, icon: ArrowDownLeft, accent: ALIS },
              { label: 'Satış (Seçili Ay)', value: fmtTRY(ayOzet.satisToplam), sub: `${ayOzet.satisAdet} belge`, icon: ArrowUpRight, accent: SATIS },
              { label: 'Belge Adedi', value: String(ayOzet.toplamAdet), icon: FileStack, accent: GOLD },
              { label: 'Net (Satış − Alış)', value: fmtTRY(net), icon: Scale, accent: net >= 0 ? SATIS : '#f87171' },
            ]}
          />

          {/* KDV Özeti — KDV1 beyanname / Luca-mutabık ön-hazırlık */}
          {kdv ? (
            <Card accent={KDV_RENK}>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Percent size={15} style={{ color: KDV_RENK }} />
                <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>KDV Özeti · {AY_ADLARI[ay - 1]} {yil}</h2>
                {VERI_GUVENI[kdv.veriGuveni] && (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: `${VERI_GUVENI[kdv.veriGuveni].color}1a`, color: VERI_GUVENI[kdv.veriGuveni].color }}>
                    Veri güveni: {VERI_GUVENI[kdv.veriGuveni].label}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KdvKutu label="İndirilecek KDV (Alış)" value={kdv.indirilecekKdv != null ? fmtTRY(kdv.indirilecekKdv) : '—'} accent={ALIS} icon={ArrowDownLeft} />
                <KdvKutu label="Hesaplanan KDV (Satış)" value={kdv.hesaplananKdv != null ? fmtTRY(kdv.hesaplananKdv) : '—'} accent={SATIS} icon={ArrowUpRight} />
                <KdvKutu label="Ödenecek KDV" value={kdv.odenecekKdv != null ? fmtTRY(kdv.odenecekKdv) : '—'} accent={KDV_RENK} icon={TrendingUp} />
                <KdvKutu label="Sonraki Aya Devreden" value={kdv.devredenKdv != null ? fmtTRY(kdv.devredenKdv) : '—'} accent="#60a5fa" icon={Scale} />
              </div>
              <p className="text-[11.5px] mt-3" style={{ color: 'rgba(250,250,249,0.38)' }}>
                {kdv.beyanVar
                  ? 'Ödenecek KDV resmî KDV beyannamenizden alınmıştır. Alış/satış KDV kırılımı dönem verinizden hesaplanır.'
                  : 'Bu dönem KDV beyannamesi henüz görünmüyor; tutarlar dönem verinizden hesaplanan ön bilgidir.'}
              </p>
            </Card>
          ) : null}

          {/* Aylık grafik (seçili yıl, 12 ay) */}
          <Card accent={GOLD}>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <BarChart3 size={15} style={{ color: GOLD }} />
              <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Aylık Alış / Satış · {yil}</h2>
              <div className="ml-auto flex items-center gap-3 text-[11.5px]">
                <span className="inline-flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ALIS }} /> Alış</span>
                <span className="inline-flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SATIS }} /> Satış</span>
              </div>
            </div>
            <div className="flex items-end justify-between gap-1.5 sm:gap-2.5" style={{ height: 184 }}>
              {aylik.map((a, i) => {
                const secili = i + 1 === ay;
                return (
                  <button
                    key={a.donem}
                    type="button"
                    onClick={() => setAy(i + 1)}
                    title={`${AY_ADLARI[i]}: Alış ${fmtTRY(a.alis)} · Satış ${fmtTRY(a.satis)}`}
                    className="group flex flex-1 flex-col items-center gap-1.5 rounded-lg pt-1.5 transition"
                    style={{ background: secili ? 'rgba(212,184,118,0.10)' : 'transparent' }}
                  >
                    <div className="flex items-end gap-[3px] sm:gap-1.5" style={{ height: 140 }}>
                      <div className="w-2.5 sm:w-3 rounded-t transition-all" style={{ height: `${Math.max(2, (a.alis / maxAy) * 140)}px`, background: `linear-gradient(180deg, ${ALIS}, ${ALIS}55)`, opacity: secili ? 1 : 0.85 }} />
                      <div className="w-2.5 sm:w-3 rounded-t transition-all" style={{ height: `${Math.max(2, (a.satis / maxAy) * 140)}px`, background: `linear-gradient(180deg, ${SATIS}, ${SATIS}55)`, opacity: secili ? 1 : 0.85 }} />
                    </div>
                    <span className="text-[10px] sm:text-[10.5px]" style={{ color: secili ? GOLD : 'rgba(250,250,249,0.42)', fontWeight: secili ? 700 : 400 }}>{AY_KISA[i]}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] mt-2.5" style={{ color: 'rgba(250,250,249,0.35)' }}>Bir aya tıklayarak o ayın faturalarını ve KDV özetini görebilirsiniz.</p>
          </Card>

          {/* Liste — seçili ay */}
          <Section baslik={`İşlenen Faturalar · ${AY_ADLARI[ay - 1]} ${yil}`} aciklama={`${ayOzet.toplamAdet} belge`}>
            {faturalar.length === 0 ? <div className="px-5 py-5"><Empty>Bu dönem için işlenen fatura bulunamadı.</Empty></div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <THead>
                    <Th>Tür</Th>
                    <Th>Karşı Firma</Th>
                    <Th>Belge</Th>
                    <Th>Tarih</Th>
                    <Th align="right">Tutar</Th>
                    <Th align="center">İşlem</Th>
                  </THead>
                  <tbody>
                    {faturalar.map((f) => {
                      const satis = /SATIS/i.test(f.faturaTuru || '');
                      const renk = satis ? SATIS : ALIS;
                      return (
                        <tr key={f.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                          <td className="px-4 py-2.5"><Badge color={renk}>{turEtiket(f.faturaTuru)}</Badge></td>
                          <td className="px-4 py-2.5 text-[13px] max-w-[240px] truncate" style={{ color: '#fafaf9' }}>{f.firmaUnvan || f.faturaNo || '—'}</td>
                          <td className="px-4 py-2.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{belgeEtiket(f.belgeTuru)} · {f.faturaNo}</td>
                          <td className="px-4 py-2.5 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{f.faturaTarihi ? new Date(f.faturaTarihi).toLocaleDateString('tr-TR') : '—'}</td>
                          <td className="px-4 py-2.5 text-right text-[13px] tabular-nums font-semibold" style={{ color: '#fafaf9' }}>{fmtTRY(f.toplamTutar)}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-center">
                              {f.goruntulenebilir
                                ? <button type="button" onClick={() => openBelge('fatura', f.id)} title="Görüntüle" className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}><Eye size={14} /></button>
                                : <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function KdvKutu({ label, value, accent, icon: Icon }: { label: string; value: string; accent: string; icon: any }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md shrink-0" style={{ background: `${accent}16`, border: `1px solid ${accent}30`, color: accent }}><Icon size={12} /></span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[.04em] leading-tight" style={{ color: 'rgba(250,250,249,0.45)' }}>{label}</span>
      </div>
      <div className="tabular-nums" style={{ color: '#fafaf9', fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}
