'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Loader2, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { mukellefAdi, rutinGuncelle, rutinOlustur, rutinSil, rutinSimdi, type Rutin, type RutinGirdi, type RutinKapsam, type RutinZaman } from '@/lib/ekip';
import { SORGU } from '../kosular';
import { MukellefSecici } from '../MukellefSecici';
import { ajanKisaAd, ajanTamAd, goreliSaat } from '../ortak';
import { AltSayfa } from './AltSayfa';
import { Anahtar, BosDurum, Cekmece, Cip, KucukTeyit, OfisAvatar } from './Parcalar';
import { RutinCekmecesi } from './RutinCekmecesi';
import { kapsamEtiketi, zamanEtiketi } from './yardimci';

/**
 * Hazır kalemler (frontend sabiti; backend rutin uçlarıyla eşleşir — eşleşme AD ile).
 * Anahtar açılınca aynı adlı rutin varsa PATCH aktif:true, yoksa POST /ekip/rutinler (aktif:true — Muzaffer Bey'in açık eylemi);
 * kapatınca PATCH aktif:false. Hiçbir kalem kendiliğinden açılmaz (KDV kontrolü backend tohumu olarak açık gelir).
 */
interface HazirKalem {
  ad: string;
  ajanId: string;
  kapsam: RutinKapsam;
  zaman: RutinZaman;
  gunlukTavan: number;
  dryRun: boolean;
  sablon: string;
  aciklama: string;
  /** Kapsam 'liste' ise açarken mükellef seçtirilir. */
  mukellefSecimi?: boolean;
}

const HAZIR: HazirKalem[] = [
  {
    ad: 'KDV kontrolü — kontrol bekleyenler',
    ajanId: 'beyanname',
    kapsam: 'pano:kontrol_bekleyen',
    zaman: { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '09:30', bitis: '17:00' },
    gunlukTavan: 8,
    dryRun: false,
    sablon: '{mukellef} için {donem} KDV kontrolünü yap (R1): oturumları bul/aç, Luca çekimi ve fatura bağlama + OCR, eşleştir, hatalı satırları belge no ile listele. Kilitleme bende.',
    aciklama: 'Dönem panosunda "işleme tamam · kontrol yok" olan mükellefler, sırayla. Canlı: KDV Kontrol oturumları gerçekten açılır; kilitleme yine sizde.',
  },
  {
    ad: 'Mevzuat taraması',
    ajanId: 'mevzuat',
    kapsam: 'ofis',
    zaman: { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '07:45', bitis: '08:15' },
    gunlukTavan: 1,
    dryRun: true,
    sablon: 'Bugünkü Resmî Gazete ve mevzuat değişikliklerini tara (M1).',
    aciklama: 'Ofisi ve mükellefleri ilgilendiren vergi/SGK değişiklikleri 3 maddede. Kuru: mesaj/Luca yazımı yok, rapor üretir.',
  },
  {
    ad: 'Aylık risk taraması',
    ajanId: 'risk',
    kapsam: 'ofis',
    zaman: { tur: 'aylik', ayGunu: 3, saat: '09:30' },
    gunlukTavan: 1,
    dryRun: true,
    sablon: 'Ofis geneli aylık hafif risk taraması yap (R-K2).',
    aciklama: 'En riskli 5 mükellef ve nedenleri. Kuru: mesaj/Luca yazımı yok, rapor üretir.',
  },
  {
    ad: 'Dönem denetimi',
    ajanId: 'denetci',
    kapsam: 'pano:hazirlik_bekleyen',
    zaman: { tur: 'aylik', ayGunu: 3, saat: '09:30', aylar: [1, 4, 7, 10] },
    gunlukTavan: 4,
    dryRun: true,
    sablon: '{mukellef} için {donem} dönemi denetimini yap (R6).',
    aciklama: 'Yalnız Ocak · Nisan · Temmuz · Ekim ayının 3’ünde (geçici vergi öncesi). Kuru: mesaj/Luca yazımı yok, rapor üretir.',
  },
  {
    ad: 'e-Defter kontrol',
    ajanId: 'edefter',
    kapsam: 'liste',
    zaman: { tur: 'aylik', ayGunu: 20, saat: '09:30' },
    gunlukTavan: 4,
    dryRun: true,
    sablon: '{mukellef} için {donem} e-Defter kontrolünü yap (K1).',
    aciklama: 'Mükellef listesi seçilecek (anahtarı açınca sorulur). Kuru: mesaj/Luca yazımı yok, rapor üretir.',
    mukellefSecimi: true,
  },
  {
    ad: 'Aylık iletim raporu',
    ajanId: 'musteri',
    kapsam: 'ofis',
    zaman: { tur: 'aylik', ayGunu: 1, saat: '09:30' },
    gunlukTavan: 1,
    dryRun: true,
    sablon: 'Geçen ayın iletim raporunu hazırla (C3).',
    aciklama: 'Kuru: mesaj/Luca yazımı yok, rapor üretir.',
  },
];

/** Satırın tek satır açıklaması: zaman · kapsam · tavan · kuru/canlı. */
function ozetSatiri(k: { zaman: RutinZaman; kapsam: RutinKapsam; gunlukTavan: number; dryRun: boolean; taxpayerIds?: string[] }): string {
  return `${zamanEtiketi(k.zaman)} · ${kapsamEtiketi(k.kapsam, k.taxpayerIds?.length)} · günde en çok ${k.gunlukTavan} · ${k.dryRun ? 'kuru' : 'canlı'}`;
}

export function DuzenliIsler() {
  const qc = useQueryClient();
  const rutinlerS = useQuery(SORGU.rutinler);
  const kadroS = useQuery(SORGU.kadro);
  const mukelleflerS = useQuery(SORGU.mukellefler);
  const ajanlar = useMemo(() => kadroS.data || [], [kadroS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);
  const rutinler = useMemo(() => rutinlerS.data?.rutinler || [], [rutinlerS.data]);
  const destek = rutinlerS.data?.destek !== false;
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [teyit, setTeyit] = useState<{ ad: string; tur: 'simdi' | 'sil' } | null>(null);
  const [listeSecimi, setListeSecimi] = useState<{ kalem: HazirKalem; ids: string[] } | null>(null);
  const [ozelCekmece, setOzelCekmece] = useState<{ acik: boolean; rutin?: Rutin | null }>({ acik: false });
  const [secimNonce, setSecimNonce] = useState(0);

  const ajanAd = (id: string) => ajanlar.find((a) => a.id === id)?.ad;
  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['ekip-rutinler'] });
    qc.invalidateQueries({ queryKey: ['ekip-kuyruk'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
  };
  const bul = (ad: string) => rutinler.find((r) => r.ad === ad);
  const hazirAdlari = new Set(HAZIR.map((h) => h.ad));
  const ozelRutinler = rutinler.filter((r) => !hazirAdlari.has(r.ad));

  const ac = async (kalem: HazirKalem, taxpayerIds?: string[]) => {
    const mevcut = bul(kalem.ad);
    setMesgul(kalem.ad);
    try {
      if (mevcut) {
        await rutinGuncelle(mevcut.id, { aktif: true, ...(taxpayerIds ? { taxpayerIds } : {}) });
      } else {
        const girdi: RutinGirdi = { ad: kalem.ad, ajanId: kalem.ajanId, sablon: kalem.sablon, kapsam: kalem.kapsam, zaman: kalem.zaman, gunlukTavan: kalem.gunlukTavan, dryRun: kalem.dryRun, taxpayerIds, aktif: true };
        await rutinOlustur(girdi);
      }
      toast.success(`"${kalem.ad}" açıldı`, { description: 'Zamanı gelince kendiliğinden çalışır; kuru ise yalnız rapor üretir.' });
      tazele();
    } catch (e: any) {
      toast.error('Açılamadı', { description: e?.response?.data?.message || e?.message });
    } finally {
      setMesgul(null);
      setListeSecimi(null);
    }
  };
  const kapat = async (r: Rutin) => {
    setMesgul(r.ad);
    try {
      await rutinGuncelle(r.id, { aktif: false });
      toast.success(`"${r.ad}" kapatıldı`, { description: 'Kendiliğinden çalışmaz; istediğinizde açarsınız.' });
      tazele();
    } catch (e: any) {
      toast.error('Kapatılamadı', { description: e?.response?.data?.message || e?.message });
    } finally {
      setMesgul(null);
    }
  };
  const simdiCalistir = async (r: Rutin) => {
    setMesgul(r.ad);
    try {
      const s = await rutinSimdi(r.id);
      if (s.ok) toast.success(`${s.eklenen} iş kuyruğa alındı`, { description: 'Ekip sayfasında "Şu an" altında kuyruk olarak görünür.' });
      else toast.error('Çalıştırılamadı', { description: s.error || 'Sunucu kabul etmedi.' });
      tazele();
    } catch (e: any) {
      toast.error('Çalıştırılamadı', { description: e?.response?.data?.message || e?.message });
    } finally {
      setMesgul(null);
      setTeyit(null);
    }
  };
  const sil = async (r: Rutin) => {
    setMesgul(r.ad);
    try {
      await rutinSil(r.id);
      toast.success(`"${r.ad}" silindi`);
      tazele();
    } catch (e: any) {
      toast.error('Silinemedi', { description: e?.response?.data?.message || e?.message });
    } finally {
      setMesgul(null);
      setTeyit(null);
    }
  };

  const satir = (ad: string, ajanId: string, ozet: string, aciklama: string | undefined, r: Rutin | undefined, onAc: () => void, ozel = false) => {
    const buMesgul = mesgul === ad;
    const acik = !!r && r.aktif;
    return (
      <li key={ad} className="of-rutin" data-aktif={acik || undefined}>
        <div className="of-rutin-satir">
          <OfisAvatar ajanId={ajanId} boyut={36} title={ajanTamAd(ajanId, ajanAd(ajanId))} />
          <div className="of-rutin-metin">
            <b>{ad}</b>
            <span>
              {ajanKisaAd(ajanId, ajanAd(ajanId))} · {ozet}
            </span>
            {aciklama && <span className="of-rutin-aciklama">{aciklama}</span>}
          </div>
          <div className="of-rutin-sayilar">
            {r ? (
              <>
                <span>
                  Bugün <b className="of-tabular">{r.bugun.biten}</b>/<span className="of-tabular">{r.bugun.planlanan}</span>
                  {r.bugun.hatali ? <em> · {r.bugun.hatali} yarım</em> : null}
                </span>
                <span>Son çalışma {r.sonKosuAt ? goreliSaat(r.sonKosuAt) : '—'}</span>
              </>
            ) : (
              <span>Henüz açılmadı</span>
            )}
          </div>
          <div className="of-rutin-eylemler">
            <Cip ton={acik ? 'yesil' : 'kursuni'} nokta>
              {acik ? 'Açık' : 'Kapalı'}
            </Cip>
            <Anahtar acik={acik} etiket={acik ? `${ad} — kapat` : `${ad} — aç`} mesgul={buMesgul || !destek} onChange={(v) => (v ? onAc() : r && void kapat(r))} />
          </div>
        </div>
        <div className="of-rutin-alt">
          {teyit?.ad === ad && teyit.tur === 'simdi' && r ? (
            <KucukTeyit metin={<>Kapsamdaki mükellefler (en çok {r.gunlukTavan}) {r.dryRun ? 'kuru testte' : <b>CANLI</b>} kuyruğa alınacak.</>} evet="Evet, çalıştır" mesgul={buMesgul} tehlike={!r.dryRun} onEvet={() => void simdiCalistir(r)} onVazgec={() => setTeyit(null)} />
          ) : teyit?.ad === ad && teyit.tur === 'sil' && r ? (
            <KucukTeyit metin={<>“{r.ad}” silinsin mi? Bu geri alınamaz.</>} evet="Evet, sil" mesgul={buMesgul} tehlike onEvet={() => void sil(r)} onVazgec={() => setTeyit(null)} />
          ) : (
            <>
              <button type="button" className="of-dugme" data-tur="civit-yumusak" disabled={!r || buMesgul} onClick={() => setTeyit({ ad, tur: 'simdi' })} title={r ? 'Kapsamı hesapla, tavana kadar kuyruğa ekle' : 'Önce anahtarı açın'}>
                <Play size={14} /> Şimdi çalıştır
              </button>
              {ozel && r && (
                <>
                  <button type="button" className="of-dugme" data-tur="ikincil" disabled={buMesgul} onClick={() => setOzelCekmece({ acik: true, rutin: r })}>
                    <Pencil size={14} /> Düzenle
                  </button>
                  <button type="button" className="of-dugme" data-tur="tehlike" disabled={buMesgul} onClick={() => setTeyit({ ad, tur: 'sil' })}>
                    <Trash2 size={14} /> Sil
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <AltSayfa
      baslik="Düzenli işler"
      alt="Ekibin kendiliğinden yaptığı işler — anahtarı siz açarsınız. Kuru: mesaj/Luca yazımı yok, rapor üretir."
      sag={
        <button type="button" className="of-baglanti" onClick={() => setOzelCekmece({ acik: true, rutin: null })} disabled={!destek}>
          <Plus size={14} aria-hidden="true" /> Özel rutin
        </button>
      }
    >
      <section className="of-kart">
        <header className="of-kart-baslik">
          <span className="of-kart-simge" aria-hidden="true">
            <ListChecks size={16} />
          </span>
          <div className="of-kart-baslik-metin">
            <h2>Hazır işler</h2>
            <p>{destek ? `${HAZIR.filter((h) => bul(h.ad)?.aktif).length} açık · ${HAZIR.length} kalem` : 'İş düzeni ucu sunucuda henüz yayında değil'}</p>
          </div>
        </header>
        {!destek ? (
          <div className="of-kart-govde">
            <BosDurum simge={<ListChecks size={20} />}>İş düzeni ucu sunucuda henüz yayında değil; backend yayına alınınca anahtarlar burada çalışır.</BosDurum>
          </div>
        ) : rutinlerS.isLoading && !rutinlerS.data ? (
          <div className="of-soluk-satir of-yukleniyor">
            <Loader2 size={14} className="animate-spin" /> Rutinler yükleniyor…
          </div>
        ) : (
          <ul className="of-rutinler">
            {HAZIR.map((h) => {
              const r = bul(h.ad);
              return satir(h.ad, h.ajanId, ozetSatiri(r || h), h.aciklama, r, () => {
                if (h.mukellefSecimi && !(r?.taxpayerIds?.length)) setListeSecimi({ kalem: h, ids: [] });
                else void ac(h);
              });
            })}
          </ul>
        )}
      </section>

      {ozelRutinler.length > 0 && (
        <section className="of-kart">
          <header className="of-kart-baslik">
            <span className="of-kart-simge" aria-hidden="true">
              <Pencil size={16} />
            </span>
            <div className="of-kart-baslik-metin">
              <h2>Özel rutinler</h2>
              <p>Sizin tanımladığınız işler</p>
            </div>
          </header>
          <ul className="of-rutinler">{ozelRutinler.map((r) => satir(r.ad, r.ajanId, ozetSatiri(r), undefined, r, () => void rutinGuncelle(r.id, { aktif: true }).then(tazele), true))}</ul>
        </section>
      )}

      {listeSecimi && (
        <Cekmece
          acik
          baslik={listeSecimi.kalem.ad}
          alt="Bu iş için mükellef listesi seçin; anahtar seçimle birlikte açılır."
          onKapat={() => setListeSecimi(null)}
          altBar={
            <>
              <span className="of-cekmece-not">{listeSecimi.ids.length} mükellef seçildi</span>
              <button type="button" className="of-dugme" data-tur="ikincil" onClick={() => setListeSecimi(null)}>
                Vazgeç
              </button>
              <button type="button" className="of-dugme" data-tur="birincil" disabled={!listeSecimi.ids.length || mesgul === listeSecimi.kalem.ad} onClick={() => void ac(listeSecimi.kalem, listeSecimi.ids)}>
                {mesgul === listeSecimi.kalem.ad ? <Loader2 size={14} className="animate-spin" /> : null} Seç ve aç
              </button>
            </>
          }
        >
          <div className="of-form">
            <div className="of-alan">
              <span>Mükellef ekle</span>
              <span className="of-gorev-secici">
                <MukellefSecici sade yerTutucu="Mükellef ara…" mukellefler={mukellefler.filter((m) => !listeSecimi.ids.includes(m.id))} value="" onChange={(id) => { if (id) setListeSecimi((s) => (s && !s.ids.includes(id) ? { ...s, ids: [...s.ids, id] } : s)); setSecimNonce((n) => n + 1); }} renk="#4263eb" escNonce={secimNonce} />
              </span>
            </div>
            {listeSecimi.ids.length > 0 && (
              <ul className="of-secim-listesi">
                {listeSecimi.ids.map((id) => (
                  <li key={id}>
                    <span className="min-w-0 flex-1 truncate">{mukellefAdi(mukellefler.find((m) => m.id === id)) || id}</span>
                    <button type="button" className="of-cip-kapat" onClick={() => setListeSecimi((s) => (s ? { ...s, ids: s.ids.filter((x) => x !== id) } : s))} title="Kaldır">
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Cekmece>
      )}

      {ozelCekmece.acik && <RutinCekmecesi rutin={ozelCekmece.rutin || null} ajanlar={ajanlar} mukellefler={mukellefler} onKapat={() => setOzelCekmece({ acik: false })} onKaydedildi={() => { setOzelCekmece({ acik: false }); tazele(); }} />}
    </AltSayfa>
  );
}
