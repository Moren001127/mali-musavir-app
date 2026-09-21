'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Users } from 'lucide-react';
import type { Ajan, Vaka, VakaAdimIs } from '@/lib/ekip';
import type { Kosu } from '../kosular';
import { AJAN_UNVAN, ajanKisaAd, ajanTamAd, firmaKisalt, gorevSadelestir, sayacMetni, tarihKisa } from '../ortak';
import type { KomutTaslak } from './GorevKutusu';
import { BosDurum, Cekmece, Cip, OfisAvatar } from './Parcalar';
import { saatEtiketi } from './yardimci';

/** Kadroda GÖSTERİLMEYEN kimlikler (2026-09-13/19'da kaldırıldı; eski backend listede döndürürse gizlenir). */
const GIZLI = new Set(['banka-kasa', 'evrak']);

type Durum = 'calisiyor' | 'kapali' | 'hata' | 'bos';

function ajanDurumu(a: Ajan, kosu: Kosu | undefined): { durum: Durum; metin: string; basladi?: number; mukellef?: string | null } {
  if (kosu && !kosu.bitti) return { durum: 'calisiyor', metin: 'Çalışıyor', basladi: kosu.basladi, mukellef: null };
  if (a.suAn) {
    const basladi = new Date(a.suAn.basladi).getTime();
    return { durum: 'calisiyor', metin: 'Çalışıyor', basladi: isNaN(basladi) ? undefined : basladi, mukellef: a.suAn.mukellefAd || null };
  }
  if (a.kapali) return { durum: 'kapali', metin: 'Modül kapalı' };
  if (a.sonKosu?.status === 'failed') return { durum: 'hata', metin: 'Boşta' };
  return { durum: 'bos', metin: 'Boşta' };
}

const DURUM_TONU: Record<Durum, string> = { calisiyor: 'civit', kapali: 'kursuni', hata: 'kursuni', bos: 'kursuni' };

/** Personelin son işleri: akıştaki 'is' adımlarından (en yeni önce). */
function sonIsler(ajanId: string, vakalar: Vaka[] | undefined, tavan = 8): Array<{ vaka: Vaka; adim: VakaAdimIs }> {
  const out: Array<{ vaka: Vaka; adim: VakaAdimIs }> = [];
  for (const v of vakalar || []) for (const a of v.adimlar) if (a.tip === 'is' && a.ajanId === ajanId) out.push({ vaka: v, adim: a });
  return out.sort((x, y) => new Date(y.adim.baslangic).getTime() - new Date(x.adim.baslangic).getTime()).slice(0, tavan);
}

/**
 * KADRO — sağ dar sütun: 11 satır (avatar · ad + rol · durum çipi · bugün sayısı). Satır → personel çekmecesi
 * (reçeteler, son 8 iş, "Bu personele görev ver" → görev kutusunu doğrudan o personele bağlar; Koordinatör atlanır).
 */
export function Kadro({
  ajanlar,
  kosular,
  vakalar,
  mukellefAd,
  yukleniyor,
  onGorevVer,
  onIsAc,
}: {
  ajanlar: Ajan[];
  kosular: Map<string, Kosu>;
  vakalar: Vaka[] | undefined;
  mukellefAd: (id?: string | null) => string | undefined;
  yukleniyor?: boolean;
  onGorevVer: (t: Omit<KomutTaslak, 'nonce'>) => void;
  onIsAc: (vakaId: string) => void;
}) {
  const [acik, setAcik] = useState<string | null>(null);
  const [simdi, setSimdi] = useState(() => Date.now());
  const liste = useMemo(() => ajanlar.filter((a) => !GIZLI.has(a.id)), [ajanlar]);
  const canliVar = liste.some((a) => !!a.suAn) || Array.from(kosular.values()).some((k) => !k.bitti);
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), canliVar ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [canliVar]);
  const secili = liste.find((a) => a.id === acik) || null;
  const calisan = liste.filter((a) => ajanDurumu(a, kosular.get(a.id)).durum === 'calisiyor').length;

  return (
    <section className="of-kart of-kadro" aria-label="Kadro">
      <header className="of-kart-baslik">
        <span className="of-kart-simge" aria-hidden="true">
          <Users size={16} />
        </span>
        <div className="of-kart-baslik-metin">
          <h2>Kadro</h2>
          <p>{liste.length ? `${liste.length} dijital personel · ${calisan} çalışıyor` : 'Dijital personel'}</p>
        </div>
      </header>
      {yukleniyor && !liste.length ? (
        <div className="of-soluk-satir of-yukleniyor">
          <Loader2 size={14} className="animate-spin" /> Kadro yükleniyor…
        </div>
      ) : !liste.length ? (
        <div className="of-kart-govde">
          <BosDurum simge={<Users size={20} />}>Kadro bilgisi alınamadı.</BosDurum>
        </div>
      ) : (
        <ul className="of-kadro-liste">
          {liste.map((a) => {
            const d = ajanDurumu(a, kosular.get(a.id));
            const calisiyor = d.durum === 'calisiyor';
            const bugun = a.bugunKosu ?? 0;
            return (
              <li key={a.id}>
                <button type="button" className="of-personel" data-durum={d.durum} onClick={() => setAcik(a.id)} title={calisiyor ? `${a.ad} — ${d.mukellef ? `${d.mukellef} işinde` : 'çalışıyor'}` : `${a.ad} — ${AJAN_UNVAN[a.id] || a.unvan}`}>
                  <OfisAvatar ajanId={a.id} boyut={36} canli={calisiyor} kapali={d.durum === 'kapali'} />
                  <span className="of-personel-kimlik">
                    <b>{ajanKisaAd(a.id, a.ad)}</b>
                    <span>{calisiyor ? (d.mukellef ? firmaKisalt(d.mukellef, 99) : 'çalışıyor') : AJAN_UNVAN[a.id] || a.unvan}</span>
                  </span>
                  <Cip ton={DURUM_TONU[d.durum]} nokta nabiz={calisiyor} title={d.durum === 'kapali' ? a.kapali?.neden : undefined}>
                    {d.metin}
                  </Cip>
                  <span className="of-personel-bugun" data-sifir={!bugun || undefined} title="Bugün yaptığı iş">
                    {calisiyor && d.basladi ? <span className="of-tabular of-personel-sayac">{sayacMetni(simdi - d.basladi)}</span> : <span className="of-tabular">{bugun}</span>}
                    <small>{calisiyor && d.basladi ? 'süre' : 'bugün'}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Cekmece acik={!!secili} baslik={secili ? ajanTamAd(secili.id, secili.ad) : ''} alt={secili ? AJAN_UNVAN[secili.id] || secili.unvan : undefined} onKapat={() => setAcik(null)}>
        {secili && <PersonelCekmecesi ajan={secili} kosu={kosular.get(secili.id)} vakalar={vakalar} mukellefAd={mukellefAd} simdi={simdi} onGorevVer={(t) => { setAcik(null); onGorevVer(t); }} onIsAc={(id) => { setAcik(null); onIsAc(id); }} />}
      </Cekmece>
    </section>
  );
}

function PersonelCekmecesi({ ajan, kosu, vakalar, mukellefAd, simdi, onGorevVer, onIsAc }: { ajan: Ajan; kosu: Kosu | undefined; vakalar: Vaka[] | undefined; mukellefAd: (id?: string | null) => string | undefined; simdi: number; onGorevVer: (t: Omit<KomutTaslak, 'nonce'>) => void; onIsAc: (vakaId: string) => void }) {
  const d = ajanDurumu(ajan, kosu);
  const isler = useMemo(() => sonIsler(ajan.id, vakalar), [ajan.id, vakalar]);
  const suAnMukellef = ajan.suAn ? ajan.suAn.mukellefAd || mukellefAd(ajan.suAn.mukellefId) : kosu && !kosu.bitti ? mukellefAd(kosu.taxpayerId) : undefined;
  return (
    <div className="of-personel-cekmece">
      <div className="of-personel-cekmece-ust">
        <OfisAvatar ajanId={ajan.id} boyut={64} canli={d.durum === 'calisiyor'} kapali={d.durum === 'kapali'} />
        <div className="min-w-0 flex-1">
          <div className="of-personel-cekmece-cipler">
            <Cip ton={DURUM_TONU[d.durum]} nokta nabiz={d.durum === 'calisiyor'}>
              {d.metin}
            </Cip>
            {ajan.model && <Cip ton="kursuni">{ajan.model}</Cip>}
            {typeof ajan.aracSayisi === 'number' && <Cip ton="kursuni">{ajan.aracSayisi} araç</Cip>}
            <Cip ton="kursuni">bugün {ajan.bugunKosu ?? 0}</Cip>
          </div>
          <p className="of-personel-cekmece-not">
            {d.durum === 'calisiyor'
              ? `Şu an ${suAnMukellef ? `${suAnMukellef} işinde` : 'bir işte'}${d.basladi ? ` · ${sayacMetni(simdi - d.basladi)}` : ''}${ajan.suAn?.konu ? ` · ${gorevSadelestir(ajan.suAn.konu, suAnMukellef, 70)}` : ''}`
              : d.durum === 'kapali'
                ? ajan.kapali?.neden || 'Modül kapalı'
                : ajan.sonKosu?.createdAt
                  ? `Son iş ${tarihKisa(ajan.sonKosu.createdAt)}${ajan.sonKosu.status === 'failed' ? ' · yarım kaldı' : ''}`
                  : 'Henüz iş almadı — görev verdiğinizde burada görünür.'}
          </p>
          {ajan.aciklama && <p className="of-personel-cekmece-aciklama">{ajan.aciklama}</p>}
        </div>
      </div>

      <section className="of-cekmece-bolum">
        <h4>Yaptığı işler</h4>
        {ajan.receteler.length ? (
          <ul className="of-recete-listesi">
            {ajan.receteler.map((r) => (
              <li key={r.kod}>
                <em>{r.kod}</em>
                <span>{r.baslik}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="of-soluk-satir">Bu personel için reçete tanımı henüz yok.</p>
        )}
      </section>

      <section className="of-cekmece-bolum">
        <h4>Son işler</h4>
        {isler.length ? (
          <ul className="of-son-isler">
            {isler.map(({ vaka, adim }) => (
              <li key={adim.isId}>
                <button type="button" className="of-son-is" onClick={() => onIsAc(vaka.vakaId)} title="İşi aç">
                  <span className="of-son-is-metin">
                    <b>{vaka.mukellef?.ad || 'Ofis geneli'}</b>
                    <span>{gorevSadelestir(adim.baslik, vaka.mukellef?.ad, 80) || vaka.konu}</span>
                  </span>
                  <span className="of-son-is-sag">
                    <Cip ton={adim.durum === 'done' ? 'yesil' : adim.durum === 'failed' ? 'kirmizi' : adim.durum === 'running' ? 'civit' : 'kursuni'} nokta nabiz={adim.durum === 'running'}>
                      {adim.durum === 'done' ? 'bitti' : adim.durum === 'failed' ? 'yarım' : adim.durum === 'running' ? 'sürüyor' : 'sırada'}
                    </Cip>
                    <small>{saatEtiketi(adim.baslangic)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="of-soluk-satir">Son 7 günde iş kaydı yok.</p>
        )}
      </section>

      <section className="of-cekmece-bolum">
        <button type="button" className="of-dugme" data-tur="birincil" disabled={d.durum === 'kapali'} onClick={() => onGorevVer({ gorev: '', dryRun: true, kaynak: 'kadro', hedefAjanId: ajan.id })} title={d.durum === 'kapali' ? ajan.kapali?.neden : 'Görev kutusunu bu personele bağlar; Koordinatör atlanır'}>
          Bu personele görev ver <ArrowRight size={14} />
        </button>
        <p className="of-soluk-satir of-kucuk">Görev kutusu bu personele bağlanır; Başlat doğrudan ona gider (Koordinatör atlanır). Kuru test varsayılandır.</p>
      </section>
    </div>
  );
}
