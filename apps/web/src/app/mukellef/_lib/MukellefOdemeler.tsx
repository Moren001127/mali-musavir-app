'use client';
import { portalStyle } from '@/lib/portal-theme';


/**
 * Mükellef portalı — "Bu Ayki Ödemelerim".
 * Ofisin Aylık Ödeme Listesi'nde bu mükellef için hazırlanan cetvel: ödeme adı · dönem · son ödeme · tutar + toplam.
 * Kaynak: GET /taxpayer-portal/odeme-cetveli?month=YYYY-MM (mükellef JWT). Fiş bağlantısı varsa sayfa içi önizlemede açılır.
 * Portal dili: Section / THead / Th (ofis liste dili), altın vurgu; sıkışık ekranda tablo kendi içinde kayar.
 */
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Wallet } from 'lucide-react';
import { taxpayerApi } from '@/lib/taxpayer-api';
import {
  buAy, donemAdi, fisBaglantisi, grupla, odemeAdi, tarihAdi, vadeDurumu, vadeKaydirildi, type PortalOdemeCetveli,
} from '@/lib/aylik-odeme';
import { Empty, Section, Th, THead, fmtTRY, openBelgeUrl } from './shared';

const GOLD = '#d4b876';
const AY_ADI = new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

export function MukellefOdemeler() {
  const month = buAy();
  const { data, isLoading, isError } = useQuery<PortalOdemeCetveli>({
    queryKey: ['portal-odeme-cetveli', month],
    queryFn: () => taxpayerApi.get('/taxpayer-portal/odeme-cetveli', { params: { month } }).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const satirlar = data?.satirlar || [];
  const gruplar = grupla(satirlar);

  return (
    <Section
      baslik="Bu Ayki Ödemelerim"
      aciklama={`${AY_ADI} — vergi tahakkukları ve SGK primleri. Son ödeme günü hafta sonuna denk gelenler ilk iş gününe kaydırılmıştır.`}
      sag={
        satirlar.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums" style={portalStyle({ background: 'rgba(212,184,118,0.10)', border: '1px solid rgba(212,184,118,0.3)', color: GOLD })}>
            <Wallet size={12} /> Toplam {fmtTRY(data?.toplam || 0)}
          </span>
        ) : null
      }
    >
      {isLoading ? (
        <div className="px-4 py-5"><Empty>Yükleniyor…</Empty></div>
      ) : isError ? (
        <div className="px-4 py-5"><Empty>Ödeme listesi şu an alınamadı. Daha sonra tekrar deneyin.</Empty></div>
      ) : satirlar.length === 0 ? (
        <div className="px-4 py-5"><Empty>Bu ay için hazırlanmış ödeme kalemi bulunmuyor. Tahakkuklar hazırlandığında burada görünür.</Empty></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" style={portalStyle({ tableLayout: 'fixed' })}>
            <colgroup>
              <col />
              <col style={portalStyle({ width: 140 })} />
              <col style={portalStyle({ width: 150 })} />
              <col style={portalStyle({ width: 140 })} />
              <col style={portalStyle({ width: 64 })} />
            </colgroup>
            <THead>
              <Th>Ödeme</Th>
              <Th>Dönem</Th>
              <Th>Son ödeme</Th>
              <Th align="right">Tutar</Th>
              <Th align="right">Fiş</Th>
            </THead>
            <tbody>
              {gruplar.map((g) => (
                <Fragment key={g.key}>
                  {gruplar.length > 1 && (
                    <tr style={portalStyle({ background: 'rgba(212,184,118,0.07)' })}>
                      <td colSpan={3} className="px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[.14em]" style={portalStyle({ color: GOLD, borderTop: '1px solid rgba(212,184,118,0.25)' })}>
                        {g.ad}
                        <span className="ml-2 font-semibold normal-case tracking-normal" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>· {g.satirlar.length} kalem</span>
                      </td>
                      <td className="px-4 py-1.5 text-right text-[11.5px] font-semibold tabular-nums whitespace-nowrap" style={portalStyle({ color: 'rgba(250,250,249,0.7)', borderTop: '1px solid rgba(212,184,118,0.25)' })} title="Grup ara toplamı">
                        {fmtTRY(g.araToplam)}
                      </td>
                      <td style={portalStyle({ borderTop: '1px solid rgba(212,184,118,0.25)' })} />
                    </tr>
                  )}
                  {g.satirlar.map((s, i) => {
                    const vade = vadeDurumu(s);
                    const fis = fisBaglantisi(s);
                    const ad = odemeAdi(s);
                    return (
                      <tr key={`${g.key}-${i}`} className="border-t" style={portalStyle({ borderColor: 'rgba(255,255,255,0.055)' })}>
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12.5px] font-semibold" style={portalStyle({ color: '#fafaf9' })} title={ad}>{ad}</span>
                            {s.taksit && (
                              <span className="flex-shrink-0 rounded-md px-1.5 py-[1px] text-[10px] font-medium" style={portalStyle({ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.7)' })}>
                                {s.taksit} taksit
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12.5px] whitespace-nowrap" style={portalStyle({ color: 'rgba(250,250,249,0.6)' })}>{donemAdi(s.donem)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-[12.5px] tabular-nums" style={portalStyle({ color: vade.renk || 'rgba(250,250,249,0.85)' })}>
                            {tarihAdi(s.sonGun)}
                            {vade.etiket && <span className="ml-1.5 text-[10.5px] font-medium">({vade.etiket})</span>}
                          </div>
                          {vadeKaydirildi(s) && (
                            <div className="text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })} title={`Asıl gün ${tarihAdi(s.sonGunHam)} hafta sonuna denk geldi`}>
                              hafta sonu → ilk iş günü
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums whitespace-nowrap" style={portalStyle({ color: '#fafaf9' })}>{fmtTRY(s.tutar)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            {fis ? (
                              <button type="button" onClick={() => openBelgeUrl(fis, `${ad} — ${donemAdi(s.donem)}`)} title="Fişi gör" className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={portalStyle({ border: '1px solid rgba(212,184,118,0.28)', color: GOLD, background: 'rgba(212,184,118,0.08)' })}>
                                <Eye size={15} />
                              </button>
                            ) : (
                              <span className="text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.25)' })}>—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              <tr style={portalStyle({ background: 'rgba(212,184,118,0.05)', borderTop: '1px solid rgba(212,184,118,0.28)' })}>
                <td colSpan={3} className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={portalStyle({ color: 'rgba(250,250,249,0.7)' })}>
                  Toplam · {satirlar.length} kalem
                </td>
                <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums whitespace-nowrap" style={portalStyle({ color: GOLD })}>{fmtTRY(data?.toplam || 0)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
