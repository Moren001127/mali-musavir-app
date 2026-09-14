'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Users } from 'lucide-react';
import { kisaGun, kisaPara, trMoney, type ListeSuzgeci, type OdemeOzet } from '@/lib/aylik-odeme';
import { GOLD, GOLD_SOFT, IKINCIL, KENAR_NOTR, KIRMIZI_YUMUSAK, METIN } from './ortak';

/**
 * Başlık altı TEK SATIR özet şeridi (Görevler SayacSeridi ile aynı dil):
 * "12 mükellef · Vergi ₺… · SGK ₺… · Geçici ₺… · 1 gönderildi · 10 bekliyor · 1 hata · En yakın son gün 17 Eyl (Kurum Geçici)".
 * Tıklanabilir olanlar hap (mükellef → süzgeci sıfırlar; gönderildi / bekliyor / hata → sol listeyi süzer),
 * bilgi kalemleri "·" ile ayrılmış düz yazı (dar ekranda satır kayar, kesilmez).
 */
export function OzetSeridi({ ozet, aktif, onSec }: { ozet?: OdemeOzet; aktif: ListeSuzgeci; onSec: (k: ListeSuzgeci) => void }) {
  const yukleniyor = !ozet;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5" role="group" aria-label="Ay özeti">
      <Hap ikon={<Users size={12} />} secili={aktif === 'tumu'} onClick={() => onSec('tumu')} title="Tüm mükellefleri göster" sayi={ozet?.mukellef} yukleniyor={yukleniyor}>
        mükellef
      </Hap>
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 px-1.5 text-[11.5px]" style={{ color: IKINCIL }}>
        <Bilgi etiket="Vergi" deger={ozet ? kisaPara(ozet.vergiToplam) : undefined} title={ozet ? `Aylık vergi tahakkukları toplamı: ${trMoney(ozet.vergiToplam)}` : undefined} />
        <Nokta />
        <Bilgi etiket="SGK" deger={ozet ? kisaPara(ozet.sgkToplam) : undefined} title={ozet ? `SGK prim tahakkukları toplamı: ${trMoney(ozet.sgkToplam)}` : undefined} />
        {(!ozet || ozet.geciciToplam > 0) && (
          <>
            <Nokta />
            <Bilgi etiket="Geçici" deger={ozet ? kisaPara(ozet.geciciToplam) : undefined} title={ozet ? `Geçici vergi toplamı: ${trMoney(ozet.geciciToplam)}` : undefined} />
          </>
        )}
        {ozet && ozet.yillikToplam > 0 && (
          <>
            <Nokta />
            <Bilgi etiket="Yıllık" deger={kisaPara(ozet.yillikToplam)} title={`Yıllık gelir/kurumlar vergisi toplamı: ${trMoney(ozet.yillikToplam)}`} />
          </>
        )}
      </span>
      <Ayrac />
      <Hap ikon={<CheckCircle2 size={12} />} secili={aktif === 'gonderildi'} onClick={() => onSec(aktif === 'gonderildi' ? 'tumu' : 'gonderildi')} title="Cetveli gönderilmiş mükellefler" sayi={ozet?.gonderilen} yukleniyor={yukleniyor}>
        gönderildi
      </Hap>
      <Hap ikon={<Clock size={12} />} secili={aktif === 'bekliyor'} onClick={() => onSec(aktif === 'bekliyor' ? 'tumu' : 'bekliyor')} title="Henüz gönderilmemiş mükellefler" sayi={ozet?.bekleyen} yukleniyor={yukleniyor}>
        bekliyor
      </Hap>
      <Hap ikon={<AlertTriangle size={12} />} secili={aktif === 'hata'} onClick={() => onSec(aktif === 'hata' ? 'tumu' : 'hata')} title="Gönderimi hata veren mükellefler" sayi={ozet?.hatali} yukleniyor={yukleniyor} renk={KIRMIZI_YUMUSAK}>
        hata
      </Hap>
      {(!ozet || ozet.enYakinSonGun) && (
        <>
          <Ayrac />
          <span className="inline-flex min-w-0 items-center gap-1 px-1.5 text-[11.5px]" style={{ color: IKINCIL }} title={ozet?.enYakinSonGun ? `${ozet.enYakinSonGun.turAd} son ödeme günü: ${ozet.enYakinSonGun.tarih}` : 'En yakın son ödeme günü'}>
            <CalendarClock size={12} />
            <Bilgi etiket="En yakın son gün" deger={ozet?.enYakinSonGun ? `${kisaGun(ozet.enYakinSonGun.tarih)} (${ozet.enYakinSonGun.turAd})` : undefined} />
          </span>
        </>
      )}
    </div>
  );
}

function Ayrac() {
  return <span className="mx-0.5 h-4 w-px flex-shrink-0" style={{ background: KENAR_NOTR }} aria-hidden="true" />;
}
function Nokta() {
  return <span aria-hidden="true" style={{ color: 'rgba(250,250,249,0.3)' }}>·</span>;
}

/** Tıklanabilir sayaç hapı — seçili: altın dolu; sayı > 0: ince altın/kırmızı kenar; 0: soluk. */
function Hap({ ikon, children, sayi, secili, onClick, title, yukleniyor, renk = GOLD }: { ikon: ReactNode; children: ReactNode; sayi?: number; secili: boolean; onClick: () => void; title: string; yukleniyor: boolean; renk?: string }) {
  const var_ = (sayi ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={secili}
      title={title}
      className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px"
      style={
        secili
          ? { background: `linear-gradient(135deg, ${renk}, ${renk === GOLD ? GOLD_SOFT : renk + 'bb'})`, border: '1px solid transparent', color: '#0f0d0b' }
          : { background: var_ ? `${renk}12` : 'transparent', border: `1px solid ${var_ ? `${renk}55` : KENAR_NOTR}`, color: var_ ? renk : IKINCIL }
      }
    >
      {ikon}
      {yukleniyor ? (
        <span className="inline-block h-3 w-5 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.12)' }} />
      ) : (
        <span className="tabular-nums">{sayi ?? 0}</span>
      )}
      {children}
    </button>
  );
}

/** Bilgi kalemi (tıklanmaz): etiket soluk, değer beyaz. */
function Bilgi({ etiket, deger, title }: { etiket: string; deger?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
      <span className="font-medium">{etiket}</span>
      {deger === undefined ? (
        <span className="inline-block h-3 w-14 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.12)' }} />
      ) : (
        <span className="font-semibold tabular-nums" style={{ color: METIN }}>{deger}</span>
      )}
    </span>
  );
}
