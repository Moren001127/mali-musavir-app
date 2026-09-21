'use client';
import { Activity, AlertTriangle, CalendarDays, CheckCircle2, MessageSquareReply, Plus, Sunrise, Users, type LucideIcon } from 'lucide-react';
import type { EkipDurum, PanoDonemOzeti } from '@/lib/ekip';
import type { Ton } from './Tema';
import { bugunMu, donemEtiketi, saatKisa } from './ortak';

export type EkipSekme = 'genel' | 'isler' | 'pano' | 'kadro';

interface BaslikProps {
  durum: EkipDurum | undefined;
  ozet: PanoDonemOzeti | undefined;
  ajanSayisi: number;
  kararSayisi: number;
  calisan: number;
  bugunBiten: number;
  bugunYarim: number;
  isSayisi: number;
  sekme: EkipSekme;
  onSekme: (s: EkipSekme) => void;
  onSabahOzeti: () => void;
  onYeniGorev: () => void;
  sabahOzetiMesgul: boolean;
}

/**
 * Sayfa başlığı (beyaz rehber): sola yaslı simge kutusu + "Ekip" + alt satır; sağda bağlantı çipleri, "Sabah özeti" (ikincil), "+ Yeni görev" (birincil).
 * Altında 4 sayaç (beyaz kart + gradyan simge kutusu + koyu sayı + ton çubuğu) ve kapsül sekmeler; dönem aşama şeridi Dönem panosu kartındadır.
 * Bant, gradyan, altın etiket YOK.
 */
export function Baslik({ durum, ozet, ajanSayisi, kararSayisi, calisan, bugunBiten, bugunYarim, isSayisi, sekme, onSekme, onSabahOzeti, onYeniGorev, sabahOzetiMesgul }: BaslikProps) {
  const sonSabah = durum?.sonSabahOzeti?.createdAt || null;
  const sabahBugun = !!sonSabah && bugunMu(sonSabah);
  const sabahDurum = sabahOzetiMesgul ? 'üretiliyor…' : sabahBugun ? `${saatKisa(sonSabah!).slice(0, 5)} gitti` : durum?.sabahOzeti ? '08:30' : 'kapalı';
  const donemAd = ozet ? donemEtiketi(ozet.beyannameDonem || ozet.donem) : null;
  const donemNotu = ozet?.donem && ozet.beyannameDonem && ozet.beyannameDonem !== ozet.donem ? `İşlem ayı ${donemEtiketi(ozet.donem)}` : undefined;
  const operatorAcik = !!durum?.operator?.acik;
  const maxKopuk = durum?.maxBagli === false;
  const ozetler: Array<{ etiket: string; sayi: number; not: string; ton: Ton; Ikon: LucideIcon }> = [
    { etiket: 'Çalışan', sayi: calisan, not: 'Devam eden işler', ton: 'civit', Ikon: Activity },
    { etiket: 'Sizden beklenen', sayi: kararSayisi, not: 'Karar ve yanıtlar', ton: 'kehribar', Ikon: MessageSquareReply },
    { etiket: 'Bugün tamamlanan', sayi: bugunBiten, not: 'Sonuçlanan işler', ton: 'yesil', Ikon: CheckCircle2 },
    { etiket: 'Yarım kalan', sayi: bugunYarim, not: 'Bugün yeniden incelenecek', ton: 'kirmizi', Ikon: AlertTriangle },
  ];
  const sekmeler: Array<{ id: EkipSekme; etiket: string }> = [
    { id: 'genel', etiket: 'Genel bakış' },
    { id: 'isler', etiket: 'İşler' },
    { id: 'pano', etiket: 'Dönem panosu' },
    { id: 'kadro', etiket: 'Kadro' },
  ];
  return (
    <header className="ekip-baslik">
      <div className="ekip-baslik-ust">
        <div className="ekip-baslik-kimlik">
          <span className="ekip-baslik-simge" aria-hidden="true">
            <Users size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="ekip-baslik-ad">Ekip</h1>
            <p className="ekip-baslik-alt">
              {ajanSayisi} personel · Görevleri yönetin, ilerlemeyi izleyin, sonuçları inceleyin.
            </p>
          </div>
        </div>
        <div className="ekip-baslik-eylemler">
          <span className="ekip-baglantilar" aria-label="Bağlantı durumları">
            <span className="ekip-baglanti" data-durum={operatorAcik ? 'acik' : 'kapali'} title={durum?.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
              <i aria-hidden="true" /> Luca {operatorAcik ? 'açık' : 'kapalı'}
            </span>
            <span className="ekip-baglanti" data-durum={!durum ? 'belirsiz' : maxKopuk ? 'kopuk' : 'acik'}>
              <i aria-hidden="true" /> Max {!durum ? 'kontrol ediliyor' : maxKopuk ? 'bağlı değil' : 'bağlı'}
            </span>
          </span>
          <button type="button" className="ekip-dugme ekip-dugme--ikincil ekip-sabah-dugme" onClick={onSabahOzeti} disabled={sabahOzetiMesgul} aria-busy={sabahOzetiMesgul} title="Sabah özetini şimdi üret (yalnız üretir, göndermez)">
            <Sunrise size={14} aria-hidden="true" />
            <span>Sabah özeti</span>
            <small>{sabahDurum}</small>
          </button>
          <button type="button" className="ekip-dugme ekip-dugme--birincil" onClick={onYeniGorev}>
            <Plus size={14} aria-hidden="true" /> Yeni görev
          </button>
        </div>
      </div>

      <div className="ekip-sayaclar" aria-label="Bugünün özeti">
        {ozetler.map((o) => (
          <div key={o.ton} className="ekip-sayac" data-ton={o.ton}>
            <span className="ekip-sayac-simge" aria-hidden="true">
              <o.Ikon size={16} />
            </span>
            <strong className="ekip-sayac-sayi">{o.sayi}</strong>
            <span className="ekip-sayac-etiket">{o.etiket}</span>
            <small className="ekip-sayac-not">{o.not}</small>
            <i className="ekip-sayac-cubuk" aria-hidden="true" />
          </div>
        ))}
      </div>

      <div className="ekip-sekme-satiri">
        <nav role="tablist" aria-label="Ekip bölümleri" className="ekip-sekmeler">
          {sekmeler.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={sekme === s.id} onClick={() => onSekme(s.id)}>
              {s.etiket}
              {s.id === 'isler' && isSayisi > 0 && <span className="ekip-sekme-rozet">{isSayisi}</span>}
            </button>
          ))}
        </nav>
        {donemAd && (
          <span className="ekip-donem-etiketi" title={donemNotu}>
            <CalendarDays size={12} aria-hidden="true" /> {donemAd} beyannameleri
          </span>
        )}
      </div>

    </header>
  );
}
