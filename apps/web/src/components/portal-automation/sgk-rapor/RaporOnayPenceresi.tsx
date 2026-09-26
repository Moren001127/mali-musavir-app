'use client';
import { portalStyle } from '@/lib/portal-theme';

// "Rapor Onayı — SGK'ya çalışmazlık bildirimi" penceresi (Hattat "EVizite Onayla" düzeni).
// SGK kuralları (bitiş ≤ rapor bitişi ve ≤ bugün vb.) SGK tarafından uygulanır; burada yalnız SGK'nın yanıtı gösterilir.
import React, { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Info, Loader2, Send } from 'lucide-react';
import type { SgkRaporSatiri } from '@mali-musavir/shared';
import { sgkViziteApi } from '@/lib/sgk-vizite';
import { ALAN_STILI, METIN } from '../belge-ortak';
import { KENAR, Pencere, PencereDugmesi, SOLUK, SonucSatiri, gunYaz, hataMetni, type IslemSonucu } from './ortak';
import { vakaAdi } from './RaporTablolari';

const KAPANMA_MS = 2500;

export function BilgiTablosu({ basliklar, degerler, genislikler }: { basliklar: string[]; degerler: React.ReactNode[]; genislikler: Array<number | undefined> }) {
  return (
    <div className="overflow-x-auto">
      <table data-sr-bilgi-tablo className="w-full text-[12.5px]" style={portalStyle({ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 700 })}>
        <colgroup>{genislikler.map((g, i) => <col key={i} style={g ? { width: g } : undefined} />)}</colgroup>
        <thead>
          <tr>
            {basliklar.map((b) => (
              <th key={b} className="px-2.5 py-2 text-left text-[10.5px] font-bold uppercase leading-tight tracking-[.08em]"
                style={portalStyle({ border: `1px solid ${KENAR}`, background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.5)' })}>
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {degerler.map((d, i) => (
              <td key={i} className="px-2.5 py-2 align-middle" style={portalStyle({ border: `1px solid ${KENAR}`, color: METIN })}>{d}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function IsverenBeyaniUyarisi() {
  return (
    <div data-sr-uyari className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium" style={portalStyle({ color: '#d4a85f' })}>
      <AlertTriangle size={14} className="flex-shrink-0" /> Bu işlem SGK&apos;ya işveren beyanı olarak gider.
    </div>
  );
}

/** Çağıran taraf `key={rapor?.id}` verir: her rapor yeni bir form (bitiş = en geç onay günü, "Çalışmamıştır"). */
export function RaporOnayPenceresi({ rapor, onKapat, onIslendi }: {
  rapor: SgkRaporSatiri | null;
  onKapat: () => void;
  /** SGK yanıtı geldi (başarılı ya da değil): listeler + özet yenilenir */
  onIslendi: () => void;
}) {
  const [bitis, setBitis] = useState(rapor?.onayEnGecBitis || '');
  const [calisti, setCalisti] = useState(false);
  const [sonuc, setSonuc] = useState<IslemSonucu>(null);

  const mut = useMutation({
    mutationFn: (v: { id: string; bitisTarihi: string; calisti: boolean }) => sgkViziteApi.onayla(v.id, { bitisTarihi: v.bitisTarihi, calisti: v.calisti }),
    onSuccess: (d) => {
      setSonuc(d.basarili
        ? { basarili: true, metin: `SGK: ${d.sonucAciklama || 'İşlem başarılı.'}`, kod: d.sonucKod }
        : { basarili: false, metin: `SGK reddetti: ${d.sonucAciklama || 'sebep belirtilmedi.'}`, kod: d.sonucKod });
      onIslendi();
    },
    onError: (e) => setSonuc({ basarili: false, metin: hataMetni(e, "SGK'ya ulaşılamadı; biraz sonra tekrar deneyin.") }),
  });

  // Başarılı sonuç kısa bir süre görünür, sonra pencere kendiliğinden kapanır.
  useEffect(() => {
    if (!sonuc?.basarili) return;
    const t = setTimeout(onKapat, KAPANMA_MS);
    return () => clearTimeout(t);
  }, [sonuc, onKapat]);

  const bitti = !!sonuc?.basarili;
  const gonder = () => {
    if (!rapor || !bitis || mut.isPending || bitti) return;
    setSonuc(null);
    mut.mutate({ id: rapor.id, bitisTarihi: bitis, calisti });
  };

  return (
    <Pencere
      acik={!!rapor}
      onKapat={onKapat}
      baslik="Rapor Onayı — SGK'ya çalışmazlık bildirimi"
      tur="sgk-onay"
      genislik={760}
      kilitli={mut.isPending}
      alt={
        <>
          <PencereDugmesi tur="ikincil" onClick={onKapat} disabled={mut.isPending}>{bitti ? 'Kapat' : 'Vazgeç'}</PencereDugmesi>
          {!bitti && (
            <PencereDugmesi tur="birincil" onClick={gonder} disabled={mut.isPending || !bitis}>
              {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />} SGK&apos;ya Gönder
            </PencereDugmesi>
          )}
        </>
      }
    >
      {rapor && (
        <>
          <BilgiTablosu
            basliklar={['TC No', 'Vaka', 'Ad Soyad', 'Rapor Başlama', 'Rapor Bitiş', 'Açıklama']}
            genislikler={[112, 104, undefined, 104, 104, 132]}
            degerler={[
              <span key="tc" className="tabular-nums">{rapor.tcKimlikNo}</span>,
              vakaAdi(rapor),
              <b key="ad" className="font-semibold">{rapor.adSoyad}</b>,
              <span key="bas" className="tabular-nums">{gunYaz(rapor.raporBaslangic)}</span>,
              <span key="bit" className="tabular-nums">{gunYaz(rapor.raporBitis)}</span>,
              rapor.raporDurumuAdi || '—',
            ]}
          />

          <div data-sr-bilgi className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]"
            style={portalStyle({ background: 'rgba(127,166,221,0.08)', borderColor: 'rgba(127,166,221,0.3)', color: '#9cc0ee' })}>
            <Info size={14} className="flex-shrink-0" /> Onay bitiş tarihi rapor bitiş tarihinden ve bugünden büyük olamaz.
          </div>

          {/* Cümle iki satır: kişi · tarih aralığı (Hattat "EVizite Onayla" kalıbı) */}
          <div data-sr-cumle className="mt-4 text-[14px]" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>
            <div className="leading-relaxed">
              <b className="font-semibold tabular-nums" style={portalStyle({ color: METIN })}>{rapor.tcKimlikNo}</b> kimlik numaralı{' '}
              <b className="font-semibold" style={portalStyle({ color: METIN })}>{rapor.adSoyad}</b> isimli çalışanım
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
              <b className="font-semibold tabular-nums" style={portalStyle({ color: METIN })}>{gunYaz(rapor.onayBaslangic)}</b>
              <span>ile</span>
              <input
                type="date"
                data-sr-alan
                aria-label="Onay bitiş tarihi"
                value={bitis}
                min={rapor.onayBaslangic || undefined}
                max={rapor.onayEnGecBitis || undefined}
                onChange={(e) => setBitis(e.target.value)}
                disabled={mut.isPending || bitti}
                className="rounded-lg border text-[13.5px] font-semibold tabular-nums disabled:opacity-60"
                style={portalStyle({ ...ALAN_STILI, width: 158, height: 36, padding: '0 10px' })}
              />
              <span>tarihleri arasında</span>
              <select
                data-sr-alan
                aria-label="Çalışma durumu"
                value={calisti ? 'calisti' : 'calismadi'}
                onChange={(e) => setCalisti(e.target.value === 'calisti')}
                disabled={mut.isPending || bitti}
                className="rounded-lg border text-[13.5px] font-semibold disabled:opacity-60"
                style={portalStyle({ ...ALAN_STILI, width: 160, height: 36, padding: '0 10px' })}
              >
                <option value="calismadi">Çalışmamıştır</option>
                <option value="calisti">Çalışmıştır</option>
              </select>
            </div>
          </div>
          {!bitis && !bitti && (
            <div data-sr-soluk className="mt-2 text-[12px]" style={portalStyle({ color: SOLUK })}>Göndermek için bitiş tarihini seçin.</div>
          )}

          <IsverenBeyaniUyarisi />
          <SonucSatiri sonuc={sonuc} />
        </>
      )}
    </Pencere>
  );
}
