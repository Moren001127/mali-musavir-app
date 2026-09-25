'use client';

import { CheckCircle2, FileCheck2, Inbox, ScanSearch, Settings2, Upload, Users, type LucideIcon } from 'lucide-react';

/*
 * Aylık Takip — aşama sayaçları: TAKVİM NABZI + AKAN RENK YELPAZESİ
 * (Muzaffer Bey'in seçimi, 2026-09-25; önceki "dağılım çubuğu + lejant" hâli değişti).
 *
 * SOLDA geri sayım kartı: beyanname son gününe kalan süreyi gösterir ve RENGİ GÜNE GÖRE DEĞİŞİR
 *   (rahat → planda → yaklaşıyor → bugün son). İçinde ayın günleri şerit hâlinde: geçen günler soluk,
 *   bugün beyaz, kalan günler yarı saydam. Arkada dev soluk rakam derinlik verir; son iki günde
 *   durum noktası yavaşça atar. Altında "X / Y verildi" ve ilerleme çubuğu.
 * SAĞDA yalnız BEKLEYEN aşamalar; verilenler kartta özetlendiği için listede tekrar edilmez.
 *   Kutular soldan sağa akan tek renk yelpazesi (kehribar → turkuaz → gök → kurşuni → çivit);
 *   arkalarından geçen degrade ray akışı görünür kılar. Kutuya tıklayınca liste süzülür.
 *
 * SON GÜN: bu sayfada YALNIZ KDV takip edilir → dönemi takip eden ayın 28'i (mevzuat 2026-09-25
 *   doğrulandı). Hafta sonuna denk gelirse ilk iş gününe kayar (resmi tatiller burada hesaplanmaz —
 *   GİB duyurusuyla süre uzayabilir).
 *
 * Reddedilenler: dolu gradyan KPI kart · iş akışı şeridi · halka sayaçlar · sol şeritli düz kutular ·
 *   dağılım çubuğu + lejant (eski hâli) · huni · nokta ızgarası.
 */

export type SayacAnahtari = 'all' | 'evrak-gelmedi' | 'yukleme-bekliyor' | 'islem-bekliyor' | 'kontrol-bekliyor' | 'beyanname-bekliyor' | 'verildi';

export const STAGE_CARD_META: Record<SayacAnahtari, { tone: string; icon: LucideIcon }> = {
  'all':                { tone: 'slate', icon: Users },
  'evrak-gelmedi':      { tone: 'amber', icon: Inbox },
  'yukleme-bekliyor':   { tone: 'teal', icon: Upload },
  'islem-bekliyor':     { tone: 'blue', icon: Settings2 },
  'kontrol-bekliyor':   { tone: 'violet', icon: ScanSearch },
  'beyanname-bekliyor': { tone: 'indigo', icon: FileCheck2 },
  'verildi':            { tone: 'green', icon: CheckCircle2 },
};

export interface SayacKarti { key: SayacAnahtari; label: string; count: number }

export interface AsamaSayaclariProps {
  kartlar: SayacKarti[];
  toplam: number;
  secili: SayacAnahtari;
  onSec: (k: SayacAnahtari) => void;
  /** İşlem ayı (beyannamelerin VERİLDİĞİ ay) — son gün bu aydan hesaplanır. */
  yil: number;
  ay: number; // 1-12
  /** Beyanname dönemi etiketi ("Ağustos 2026") — kartın alt satırında yazar. */
  donemEtiketi: string;
}

const yuzde = (n: number, toplam: number) => (toplam > 0 ? Math.round((n / toplam) * 100) : 0);

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Hafta sonuna denk gelen son günü ilk iş gününe kaydırır (resmi tatil hesaplanmaz). */
function isGununeKaydir(d: Date): Date {
  const g = new Date(d);
  while (g.getDay() === 0 || g.getDay() === 6) g.setDate(g.getDate() + 1);
  return g;
}

/** KDV beyannamesi son günü: dönemi takip eden ayın 28'i (bu sayfada YALNIZ KDV takip edilir). */
function sonGunBul(yil: number, ay: number) {
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const tarih = isGununeKaydir(new Date(yil, ay - 1, 28));
  const kalan = Math.round((tarih.getTime() - bugun.getTime()) / 86_400_000);
  return { ad: 'KDV BEYANNAMESİ', tarih, kalan, gecti: kalan < 0 };
}

export function AsamaSayaclari(p: AsamaSayaclariProps) {
  const [toplamKarti, ...asamalar] = p.kartlar;
  const verildi = asamalar.find((k) => k.key === 'verildi');
  const bekleyenler = asamalar.filter((k) => k.key !== 'verildi');
  const verildiSayi = verildi?.count ?? 0;
  const verildiYuzde = yuzde(verildiSayi, p.toplam);

  const sonGun = sonGunBul(p.yil, p.ay);
  const aciliyet = sonGun.gecti ? 'gecti' : sonGun.kalan <= 0 ? 'kritik' : sonGun.kalan <= 2 ? 'yaklas' : sonGun.kalan <= 7 ? 'normal' : 'rahat';
  const durumYazi = sonGun.gecti ? 'SÜRE DOLDU' : sonGun.kalan === 0 ? 'BUGÜN SON' : sonGun.kalan <= 2 ? 'YAKLAŞIYOR' : sonGun.kalan <= 7 ? 'PLANDA' : 'RAHAT';
  const nabizVar = aciliyet === 'kritik' || aciliyet === 'yaklas' || aciliyet === 'gecti';

  // Ay şeridi: işlem ayının günleri; bugün ve son gün işaretli.
  const ayGunSayisi = new Date(p.yil, p.ay, 0).getDate();
  const bugunD = new Date();
  const buAydaMiyiz = bugunD.getFullYear() === p.yil && bugunD.getMonth() + 1 === p.ay;
  const bugunGunu = buAydaMiyiz ? bugunD.getDate() : sonGun.gecti ? ayGunSayisi : 0;

  const ortak = (k: SayacKarti) => {
    const aktif = p.secili === k.key;
    return {
      'data-tone': STAGE_CARD_META[k.key].tone,
      'data-zero': k.count === 0 ? 'true' : undefined,
      'aria-pressed': aktif,
      onClick: () => p.onSec(k.key),
      title: aktif && k.key !== 'all' ? 'Süzgeci kaldır' : `${k.label} olanları göster`,
      type: 'button' as const,
    };
  };

  return (
    <div className="at-nabiz" data-at-sayac>
      {/* ── SOL: güne göre renk değiştiren geri sayım ── */}
      <div className="at-sayac" data-aciliyet={aciliyet}>
        <span className="at-sayac-hayalet" aria-hidden>{sonGun.gecti ? '!' : sonGun.kalan}</span>
        <div className="at-sayac-ust">
          <span className="at-sayac-k">{sonGun.ad} · SON GÜN</span>
          <span className={`at-sayac-durum${nabizVar ? ' at-nabiz-at' : ''}`}><i aria-hidden />{durumYazi}</span>
        </div>

        <div className="at-sayac-g">
          {sonGun.gecti ? <b>Süre doldu</b> : sonGun.kalan === 0 ? <b>Bugün</b> : <><b>{sonGun.kalan}</b><span>gün kaldı</span></>}
        </div>
        <div className="at-sayac-t">
          {sonGun.tarih.getDate()} {AY_ADLARI[sonGun.tarih.getMonth()]} {GUN_ADLARI[sonGun.tarih.getDay()]} · {p.donemEtiketi} dönemi
        </div>

        <div className="at-sayac-ay" role="img" aria-label={`${AY_ADLARI[p.ay - 1]} ayı ilerlemesi`}>
          {Array.from({ length: ayGunSayisi }, (_, i) => {
            const gun = i + 1;
            const durum = gun === bugunGunu ? 'bugun' : gun < bugunGunu ? 'gecti' : 'kalan';
            return <span key={gun} data-gun={durum} data-son={gun === sonGun.tarih.getDate() ? 'true' : undefined} />;
          })}
        </div>

        <div className="at-sayac-ayrac" />
        <button {...ortak(toplamKarti)} className="at-sayac-oran">
          <span><b>{verildiSayi}</b> / {p.toplam} verildi</span>
          <em>%{verildiYuzde}</em>
        </button>
        <div className="at-sayac-cizgi"><i style={{ width: `${verildiYuzde}%` }} /></div>
      </div>

      {/* ── SAĞ: bekleyen aşamalar, akan renk yelpazesi ── */}
      <div className="at-bekleyen">
        <div className="at-bekleyen-ray">
          <div className="at-bekleyen-kutular">
            {bekleyenler.map((k, i) => (
              <button key={k.key} {...ortak(k)} className="at-asama">
                <span className="at-asama-ust">
                  <span className="at-asama-no">{i + 1}</span>
                  <small>%{yuzde(k.count, p.toplam)}</small>
                </span>
                <b className="at-asama-say">{k.count}</b>
                <span className="at-asama-ad">{k.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
