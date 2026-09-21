'use client';

import Link from 'next/link';
import { CalendarRange, History, ListChecks, Plus, Users } from 'lucide-react';
import type { EkipDurum } from '@/lib/ekip';
import { bugunMu } from '../ortak';
import { ilkCumle, saatEtiketi } from './yardimci';

/**
 * ÜST SATIR — beyaz, tek satır (koyu bant YOK): sol "Ekip" + bugünün tarihi + son sabah özetinden bir satır;
 * orta üç sayı çipi (Bugün · Sizden beklenen · Dönem); sağ durum noktaları (Luca · Kota · Sabah özeti) + TEK birincil düğme "Görev ver".
 * Altında üç sade bağlantı: Dönem tablosu · İş geçmişi · Düzenli işler (ayrı sayfalar).
 */
export function UstSatir({
  durum,
  kararSayisi,
  bugun,
  donem,
  onGorevVer,
  onSabahOzeti,
  sabahMesgul,
}: {
  durum: EkipDurum | undefined;
  kararSayisi: number;
  bugun: { biten: number; planlanan: number };
  donem: { etiket: string; verildi: number; toplam: number } | null;
  onGorevVer: () => void;
  /** Sabah özetini şimdi üret — yalnız üretir, GÖNDERMEZ (gonder:false); WhatsApp gönderimi iş panelindeki teyitle. */
  onSabahOzeti: () => void;
  sabahMesgul: boolean;
}) {
  const sonSabah = durum?.sonSabahOzeti;
  const sabahSatiri = ilkCumle(sonSabah?.raporIlkSatir, 110);
  const sabahSaat = sonSabah?.createdAt ? saatEtiketi(sonSabah.createdAt) : '';
  const sabahBugun = !!sonSabah?.createdAt && bugunMu(sonSabah.createdAt);
  const kota = durum?.kota;
  const kotaSaat = kota?.sifirlanma ? saatEtiketi(kota.sifirlanma) : '';
  const operatorAcik = !!durum?.operator?.acik;
  const maxKopuk = durum?.maxBagli === false;
  const tarih = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'Europe/Istanbul' });
  const planlanan = Math.max(bugun.planlanan, bugun.biten);

  return (
    <header className="of-ust" aria-label="Ekip üst satırı">
      <div className="of-ust-satir">
        <div className="of-ust-kimlik">
          <span className="of-ust-simge" aria-hidden="true">
            <Users size={18} />
          </span>
          <div className="of-ust-metin">
            <h1>Ekip</h1>
            <p>
              <span>{tarih}</span>
              {sabahSatiri && (
                <span className="of-ust-ozet" title={sonSabah?.raporIlkSatir || undefined}>
                  {sabahSatiri}
                </span>
              )}
            </p>
          </div>
        </div>

        <ul className="of-sayilar" aria-label="Bugünün sayıları">
          <li className="of-sayi" data-ton="civit">
            <b>{planlanan ? `${bugun.biten}/${planlanan}` : '0'}</b>
            <small>Bugün</small>
          </li>
          <li className="of-sayi" data-ton={kararSayisi > 0 ? "kehribar" : "kursuni"} data-dikkat={kararSayisi > 0 || undefined}>
            <b>{kararSayisi}</b>
            <small>Sizden beklenen</small>
          </li>
          <li className="of-sayi" data-ton="deniz">
            <b>{donem ? `${donem.verildi}/${donem.toplam}` : '—'}</b>
            <small>{donem ? `${donem.etiket} verildi` : 'Dönem'}</small>
          </li>
        </ul>

        <div className="of-ust-sag">
          <ul className="of-noktalar" aria-label="Bağlantı durumları">
            <li className="of-nokta" data-durum={operatorAcik ? 'iyi' : 'notr'} title={durum?.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
              <i aria-hidden="true" /> Luca {operatorAcik ? 'açık' : 'kapalı'}
            </li>
            {maxKopuk ? (
              <li className="of-nokta" data-durum="kotu">
                <i aria-hidden="true" /> Max bağlı değil
              </li>
            ) : kota?.doldu ? (
              <li className="of-nokta" data-durum="kotu" title={kota.sonHata || undefined}>
                <i aria-hidden="true" /> Kota doldu{kotaSaat ? ` · yeniden ${kotaSaat}` : ''}
              </li>
            ) : (
              <li className="of-nokta" data-durum={durum ? 'iyi' : 'notr'}>
                <i aria-hidden="true" /> {durum ? 'Kota açık' : 'Kota kontrol ediliyor'}
              </li>
            )}
            <li className="of-nokta" data-durum={sabahMesgul ? 'calisiyor' : sabahBugun ? 'iyi' : 'notr'}>
              <button type="button" onClick={onSabahOzeti} disabled={sabahMesgul} aria-busy={sabahMesgul} title="Sabah özeti her gün 08:30'da kendiliğinden üretilir — tıklayınca şimdi üretir (göndermez)">
                <i aria-hidden="true" /> Sabah özeti {sabahMesgul ? 'üretiliyor…' : sabahBugun ? sabahSaat : durum?.sabahOzeti === false ? 'kapalı' : '08:30'}
              </button>
            </li>
          </ul>
          <button type="button" className="of-dugme" data-tur="birincil" onClick={onGorevVer}>
            <Plus size={15} aria-hidden="true" /> Görev ver
          </button>
        </div>
      </div>
      <nav className="of-ust-baglantilar" aria-label="Ekip sayfaları">
        <Link href="/panel/ekip/donem" data-ton="civit">
          <CalendarRange size={15} aria-hidden="true" /> Dönem tablosu
        </Link>
        <Link href="/panel/ekip/isler" data-ton="mor">
          <History size={15} aria-hidden="true" /> İş geçmişi
        </Link>
        <Link href="/panel/ekip/duzen" data-ton="deniz">
          <ListChecks size={15} aria-hidden="true" /> Düzenli işler
        </Link>
      </nav>
    </header>
  );
}
