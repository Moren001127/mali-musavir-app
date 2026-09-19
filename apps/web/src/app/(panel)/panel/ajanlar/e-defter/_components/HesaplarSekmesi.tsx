'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { KontrolOzeti } from './katalog';
import { BORDER, BORDER_STRONG, ERR, INFO, MUTED, MUTED2, NAVY, NAVY_SOFT, OK, PANEL, TEXT, WARN, fmtTRY, sevRank } from './tema';

// HESAPLAR — "her hesaba bakıldı" görünümü: her yaprak hesabın dönem kartı (açılış/borç/alacak/kapanış) + bulgu sayısı.
//   Satıra tıklayınca Bulgular sekmesi o hesap koduna süzülür.
const SINIFLAR: Array<{ kod: string; ad: string }> = [
  { kod: '1', ad: 'Dönen Varlıklar' }, { kod: '2', ad: 'Duran Varlıklar' }, { kod: '3', ad: 'Kısa Vadeli Borçlar' },
  { kod: '4', ad: 'Uzun Vadeli Borçlar' }, { kod: '5', ad: 'Özkaynaklar' }, { kod: '6', ad: 'Gelir Tablosu' }, { kod: '7', ad: 'Maliyet' },
];

export function HesaplarSekmesi({ kontrolOzeti, allFindings, onHesapSec, session }: {
  kontrolOzeti: KontrolOzeti | null | undefined;
  allFindings: any[];
  onHesapSec: (kod: string) => void;
  session: any;
}) {
  const [arama, setArama] = useState('');
  const [sinif, setSinif] = useState<string>('');
  const [yalnizBulgulu, setYalnizBulgulu] = useState(false);
  const [yalnizHareketsiz, setYalnizHareketsiz] = useState(false);

  const bulguByKod = useMemo(() => {
    const m = new Map<string, { adet: number; enYuksek: string }>();
    for (const f of allFindings) {
      if (!f.hesapKodu || (f.status || 'OPEN') !== 'OPEN') continue;
      const e = m.get(f.hesapKodu) || { adet: 0, enYuksek: 'INFO' };
      e.adet += 1;
      if (sevRank(f.severity) < sevRank(e.enYuksek)) e.enYuksek = f.severity;
      m.set(f.hesapKodu, e);
    }
    return m;
  }, [allFindings]);

  const hesaplar = kontrolOzeti?.hesaplar || [];
  const gorunen = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    return hesaplar.filter((h) => {
      if (sinif && !h.kod.startsWith(sinif)) return false;
      if (yalnizBulgulu && !bulguByKod.has(h.kod)) return false;
      if (yalnizHareketsiz && !h.hareketsiz) return false;
      if (q && !`${h.kod} ${h.ad}`.toLocaleLowerCase('tr-TR').includes(q)) return false;
      return true;
    });
  }, [hesaplar, arama, sinif, yalnizBulgulu, yalnizHareketsiz, bulguByKod]);

  const sinifSayim = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hesaplar) m.set(h.kod[0], (m.get(h.kod[0]) || 0) + 1);
    return m;
  }, [hesaplar]);

  if (!session) {
    return <div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}`, color: MUTED })}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>;
  }
  if (!hesaplar.length) {
    return <div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}`, color: MUTED })}>Hesap kartları yok — bu oturum eski sürümde analiz edilmiş. “Yeniden Analiz” çalıştırınca her hesabın dönem kartı burada görünür.</div>;
  }

  const bulguluSayi = hesaplar.filter((h) => bulguByKod.has(h.kod)).length;
  const hareketsizSayi = hesaplar.filter((h) => h.hareketsiz).length;
  const bakiyeYon = (v: number | null) => (v == null ? '-' : v === 0 ? '0,00' : `${fmtTRY(Math.abs(v))} ${v > 0 ? 'B' : 'A'}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[240px]" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' })}>
          <Search size={14} />
          <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Hesap kodu veya adı ara..." className="bg-transparent outline-none text-[13px] w-full" style={portalStyle({ color: TEXT })} />
        </div>
        <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5 flex-wrap" style={portalStyle({ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` })}>
          <button onClick={() => setSinif('')} className="px-2.5 rounded-md text-[11.5px] font-semibold" style={portalStyle({ background: !sinif ? NAVY_SOFT : 'transparent', color: !sinif ? NAVY : 'rgba(250,250,249,.7)' })}>Tümü</button>
          {SINIFLAR.filter((s) => sinifSayim.get(s.kod)).map((s) => {
            const on = sinif === s.kod;
            return (
              <button key={s.kod} onClick={() => setSinif(on ? '' : s.kod)} title={s.ad} className="px-2.5 rounded-md text-[11.5px] font-semibold tabular-nums" style={portalStyle({ background: on ? NAVY_SOFT : 'transparent', color: on ? NAVY : 'rgba(250,250,249,.7)' })}>
                {s.kod}xx <span style={portalStyle({ opacity: .6 })}>{sinifSayim.get(s.kod)}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setYalnizBulgulu((v) => !v)} className="h-9 px-3 rounded-lg text-[11.5px] font-semibold tabular-nums" style={portalStyle({ background: yalnizBulgulu ? 'rgba(212,168,95,.14)' : PANEL, color: yalnizBulgulu ? WARN : 'rgba(250,250,249,.7)', border: `1px solid ${yalnizBulgulu ? 'rgba(212,168,95,.3)' : BORDER}` })}>
          Bulgulu {bulguluSayi}
        </button>
        <button onClick={() => setYalnizHareketsiz((v) => !v)} className="h-9 px-3 rounded-lg text-[11.5px] font-semibold tabular-nums" style={portalStyle({ background: yalnizHareketsiz ? NAVY_SOFT : PANEL, color: yalnizHareketsiz ? NAVY : 'rgba(250,250,249,.7)', border: `1px solid ${yalnizHareketsiz ? 'rgba(91,141,239,.3)' : BORDER}` })}>
          Hareketsiz {hareketsizSayi}
        </button>
        <span className="text-[11.5px] tabular-nums" style={portalStyle({ color: MUTED })}>{gorunen.length} / {hesaplar.length} hesap</span>
      </div>

      <div className="rounded-xl overflow-hidden" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}` })}>
        <div className="overflow-x-auto max-h-[720px] overflow-y-auto">
          <table data-ops-table="true" className="w-full text-[12px]">
            <thead style={portalStyle({ background: 'rgba(0,0,0,.22)' })}>
              <tr style={portalStyle({ color: MUTED, borderBottom: `1px solid ${BORDER}` })}>
                <th className="text-left py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Hesap</th>
                <th className="text-left py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Ad</th>
                <th className="text-right py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Açılış</th>
                <th className="text-right py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Borç</th>
                <th className="text-right py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Alacak</th>
                <th className="text-right py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Kapanış</th>
                <th className="text-right py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Hareket</th>
                <th className="text-right py-2 px-3 font-semibold text-[10px] uppercase tracking-wider">Bulgu</th>
              </tr>
            </thead>
            <tbody>
              {gorunen.slice(0, 2000).map((h) => {
                const b = bulguByKod.get(h.kod);
                const renk = b ? (b.enYuksek === 'ERROR' ? ERR : b.enYuksek === 'WARN' ? WARN : INFO) : OK;
                return (
                  <tr key={h.kod} onClick={() => b && onHesapSec(h.kod)} className={b ? 'cursor-pointer hover:bg-white/[.035]' : ''} style={portalStyle({ borderBottom: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.85)', opacity: h.hareketsiz ? 0.7 : 1 })} title={b ? `${b.adet} bulgu — tıklayınca Bulgular sekmesinde süzülür` : 'Bulgu yok'}>
                    <td className="py-1.5 px-3 whitespace-nowrap font-semibold tabular-nums" style={portalStyle({ color: TEXT })}>{h.kod}</td>
                    <td className="py-1.5 px-3 max-w-[280px] truncate" style={portalStyle({ color: 'rgba(250,250,249,.72)' })}>{h.ad || <span style={portalStyle({ color: MUTED2 })}>—</span>}{h.hareketsiz && <span className="ml-1.5 text-[9.5px] px-1 py-px rounded" style={portalStyle({ background: 'rgba(255,255,255,.06)', color: MUTED2 })}>hareketsiz</span>}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap" style={portalStyle({ color: h.acilis == null ? MUTED2 : 'rgba(250,250,249,.7)' })}>{h.acilis == null ? '?' : bakiyeYon(h.acilis)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap" style={portalStyle({ color: h.borc ? TEXT : MUTED2 })}>{h.borc ? fmtTRY(h.borc) : '-'}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap" style={portalStyle({ color: h.alacak ? TEXT : MUTED2 })}>{h.alacak ? fmtTRY(h.alacak) : '-'}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap font-semibold" style={portalStyle({ color: h.kapanis == null ? MUTED2 : TEXT })}>{h.kapanis == null ? bakiyeYon(h.borc - h.alacak) + ' *' : bakiyeYon(h.kapanis)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums" style={portalStyle({ color: MUTED })}>{h.borcAdet + h.alacakAdet || '-'}</td>
                    <td className="py-1.5 px-3 text-right">
                      {b ? <span className="text-[10.5px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={portalStyle({ background: `${renk}1c`, color: renk })}>{b.adet}</span> : <span className="text-[10px]" style={portalStyle({ color: OK })}>✓</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-1.5 text-[10.5px]" style={portalStyle({ borderTop: `1px solid ${BORDER}`, color: MUTED2 })}>
          B = borç bakiye, A = alacak bakiye. Açılış Mizan'dan türetilir (Mizan yoksa “?”); “*” = yalnız dönem hareketi (açılış bilinmiyor).
        </div>
      </div>
    </div>
  );
}
