'use client';
import { portalStyle } from '@/lib/portal-theme';


import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Users } from 'lucide-react';
import { kisaGun, kisaPara, trMoney, type ListeSuzgeci, type OdemeOzet } from '@/lib/aylik-odeme';
import { GOLD, IKINCIL, KENAR_NOTR, KIRMIZI_YUMUSAK, METIN, SONUK } from './ortak';

/**
 * Başlık altı TEK SATIR özet şeridi (Görevler SayacSeridi ile aynı dil):
 * "12 mükellef · Vergi ₺… · SGK ₺… · Geçici ₺… · 1 gönderildi · 10 bekliyor · 1 hata · 14 yeni kalem · En yakın son gün 17 Eyl (Kurum Geçici)".
 * Tıklanabilir olanlar hap (mükellef → süzgeci sıfırlar; gönderildi / bekliyor / hata → sol listeyi süzer),
 * bilgi kalemleri "·" ile ayrılmış düz yazı (dar ekranda satır kayar, kesilmez).
 * `yeniKalem`: sunucu `yeniKalemToplam` vermezse sayfa listeden hesaplayıp geçirir.
 */
export function OzetSeridi({ ozet, aktif, onSec, yeniKalem }: { ozet?: OdemeOzet; aktif: ListeSuzgeci; onSec: (k: ListeSuzgeci) => void; yeniKalem?: number }) {
  const yukleniyor = !ozet;
  const yeni = ozet ? (typeof ozet.yeniKalemToplam === 'number' ? ozet.yeniKalemToplam : yeniKalem) : undefined;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5" role="group" aria-label="Ay özeti">
      <Hap kanca="mukellef" ikon={<Users size={12} />} secili={aktif === 'tumu'} onClick={() => onSec('tumu')} title="Tüm mükellefleri göster" sayi={ozet?.mukellef} yukleniyor={yukleniyor} ton="#305ea2">
        mükellef
      </Hap>
      {/* Vergi/SGK/Geçici/Yıllık tutarları kaldırıldı (Muzaffer Bey 2026-09-14: "bunlara ne gerek var") */}
      <Ayrac />
      <Hap kanca="gonderildi" ikon={<CheckCircle2 size={12} />} secili={aktif === 'gonderildi'} onClick={() => onSec(aktif === 'gonderildi' ? 'tumu' : 'gonderildi')} title="Cetveli gönderilmiş mükellefler" sayi={ozet?.gonderilen} yukleniyor={yukleniyor} ton="#227744">
        gönderildi
      </Hap>
      <Hap kanca="bekliyor" ikon={<Clock size={12} />} secili={aktif === 'bekliyor'} onClick={() => onSec(aktif === 'bekliyor' ? 'tumu' : 'bekliyor')} title="Henüz gönderilmemiş mükellefler" sayi={ozet?.bekleyen} yukleniyor={yukleniyor} ton="#75509c">
        bekliyor
      </Hap>
      <Hap kanca="hata" ikon={<AlertTriangle size={12} />} secili={aktif === 'hata'} onClick={() => onSec(aktif === 'hata' ? 'tumu' : 'hata')} title="Gönderimi hata veren mükellefler" sayi={ozet?.hatali} yukleniyor={yukleniyor} renk={KIRMIZI_YUMUSAK}>
        hata
      </Hap>
      {(yukleniyor || typeof yeni === 'number') && (
        <span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-[11.5px]" style={portalStyle({ color: yeni ? IKINCIL : SONUK })} title="Henüz hiçbir kanaldan gönderilmemiş ödeme kalemi sayısı (tüm mükellefler)" data-testid="yeni-kalem">
          {yukleniyor ? (
            <span className="inline-block h-3 w-5 animate-pulse rounded" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />
          ) : (
            <span className="font-semibold tabular-nums" style={portalStyle({ color: yeni ? METIN : SONUK })}>{yeni}</span>
          )}
          yeni kalem
        </span>
      )}
      {(!ozet || ozet.enYakinSonGun) && (
        <>
          <Ayrac />
          <span className="inline-flex min-w-0 items-center gap-1 px-1.5 text-[11.5px]" style={portalStyle({ color: IKINCIL })} title={ozet?.enYakinSonGun ? `${ozet.enYakinSonGun.turAd} son ödeme günü: ${ozet.enYakinSonGun.tarih}` : 'En yakın son ödeme günü'}>
            <CalendarClock size={12} />
            <Bilgi etiket="En yakın son gün" deger={ozet?.enYakinSonGun ? `${kisaGun(ozet.enYakinSonGun.tarih)} (${ozet.enYakinSonGun.turAd})` : undefined} />
          </span>
        </>
      )}
    </div>
  );
}

function Ayrac() {
  return <span data-ao-ayrac className="mx-0.5 h-4 w-px flex-shrink-0" style={portalStyle({ background: KENAR_NOTR })} aria-hidden="true" />;
}
function Nokta() {
  return <span aria-hidden="true" style={portalStyle({ color: 'rgba(250,250,249,0.3)' })}>·</span>;
}

/** Tıklanabilir sayaç hapı — seçili: ince altın kenar (dolgu YOK); sayı > 0: nötr; hata: yumuşak kırmızı yazı; 0: soluk. */
function Hap({ ikon, children, sayi, secili, onClick, title, yukleniyor, renk = GOLD, ton = renk, kanca }: { ikon: ReactNode; children: ReactNode; sayi?: number; secili: boolean; onClick: () => void; title: string; yukleniyor: boolean; renk?: string; ton?: string; kanca?: string }) {
  const var_ = (sayi ?? 0) > 0;
  return (
    <button data-aylik-counter data-ao-hap={kanca} data-bos={var_ ? undefined : 'true'}
      type="button"
      onClick={onClick}
      aria-pressed={secili}
      title={title}
      className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px"
      style={
        portalStyle({ ...({ '--counter-tone': portalStyle({ color: ton }).color } as CSSProperties), ...(secili
          ? { background: 'rgba(255,255,255,0.05)', border: `1px solid ${GOLD}88`, color: METIN }
          : { background: 'transparent', border: `1px solid ${KENAR_NOTR}`, color: var_ ? (renk === KIRMIZI_YUMUSAK ? renk : METIN) : IKINCIL }) })
      }
    >
      {ikon}
      {yukleniyor ? (
        <span className="inline-block h-3 w-5 animate-pulse rounded" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />
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
        <span className="inline-block h-3 w-14 animate-pulse rounded" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />
      ) : (
        <span className="font-semibold tabular-nums" style={portalStyle({ color: METIN })}>{deger}</span>
      )}
    </span>
  );
}
