'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, Repeat, Pencil, CreditCard, PlayCircle, ArrowLeftRight,
  Search, SlidersHorizontal, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  butceApi, Islem, Kategori, DuzenliOdeme, Kart, BankaHesap, Defter,
  para, tarihTR, buDonem, DefterSecim, DEFTER_ETIKET,
} from '@/lib/butce';
import {
  Kutu, Dugme, Modal, Alan, Girdi, Secim, Bos, Rozet, Yukleniyor, Anahtar,
  ParaGirdi, paraCoz, paraGiris,
  GOLD, OK, KIRMIZI, MUTED, TEXT, ROW_SEP, MAVI, TURUNCU, CARD_BORDER,
} from './ui';

const bugun = () => new Date().toISOString().slice(0, 10);

/** Şahsi / ofis ayrımı hareket düzeyinde tutulur; aynı kart ve hesap iki defterde de kullanılabilir. */
const DEFTERLER: Array<{ deger: Defter; etiket: string; renk: string }> = [
  { deger: 'SAHSI', etiket: 'Şahsi', renk: GOLD },
  { deger: 'OFIS', etiket: 'Ofis', renk: MAVI },
];

const defterRenk = (d?: Defter | null) => (d === 'OFIS' ? MAVI : GOLD);

/** Türkçe harf kurallarıyla küçültür — "İ" ile "I" araması birbirine karışmasın. */
const kucult = (s: string | null | undefined) => String(s || '').toLocaleLowerCase('tr-TR');

const KAYNAKLAR: Array<{ deger: 'NAKIT' | 'BANKA' | 'KART'; etiket: string }> = [
  { deger: 'NAKIT', etiket: 'Nakit' },
  { deger: 'BANKA', etiket: 'Banka / havale' },
  { deger: 'KART', etiket: 'Kredi kartı' },
];

const hesapAdi = (h: BankaHesap) => `${h.bankaAdi} · ${h.ad}${h.iban4 ? ` (**** ${h.iban4})` : ''}`;

/* ===================== DEFTER SEÇİCİ (iki düğme) ===================== */

function DefterSecici({
  deger,
  degistir,
}: {
  deger: Defter;
  degistir: (d: Defter) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-xl p-1"
      style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${CARD_BORDER}` }}
    >
      {DEFTERLER.map((d) => {
        const aktif = deger === d.deger;
        return (
          <button
            key={d.deger}
            type="button"
            onClick={() => degistir(d.deger)}
            className="flex-1 rounded-lg px-2.5 py-1 text-[11.5px] transition"
            style={{
              background: aktif ? `${d.renk}1f` : 'transparent',
              border: `1px solid ${aktif ? `${d.renk}44` : 'transparent'}`,
              color: aktif ? d.renk : MUTED,
            }}
          >
            {d.etiket}
          </button>
        );
      })}
    </div>
  );
}

/** Alan bileşeni <label> olduğu için düğme grubunu sarmalayamıyor; başlık burada elle yazılır. */
function DefterAlani({
  deger,
  degistir,
  ipucu,
}: {
  deger: Defter;
  degistir: (d: Defter) => void;
  ipucu?: string;
}) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium" style={{ color: MUTED }}>
        Defter
      </span>
      <DefterSecici deger={deger} degistir={degistir} />
      {ipucu && (
        <span className="mt-1 block text-[10px]" style={{ color: 'rgba(113,113,122,0.85)' }}>
          {ipucu}
        </span>
      )}
    </div>
  );
}

/* ===================== ANA EKRAN ===================== */

export default function GelirGider({ donem, defter = 'TUMU' }: { donem: string; defter?: DefterSecim }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Islem | 'yeni' | null>(null);
  const [duzenliModal, setDuzenliModal] = useState<DuzenliOdeme | 'yeni' | null>(null);
  const [aktarimAcik, setAktarimAcik] = useState(false);
  const [gerceklesKayit, setGerceklesKayit] = useState<Islem | null>(null);

  const [filtre, setFiltre] = useState<'HEPSI' | 'GELIR' | 'GIDER'>('HEPSI');
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [arama, setArama] = useState('');
  const [fKategori, setFKategori] = useState('');
  const [fKaynak, setFKaynak] = useState('');
  const [fMin, setFMin] = useState('');
  const [fMax, setFMax] = useState('');

  const { data: islemler = [], isLoading } = useQuery({
    queryKey: ['butce-islemler', donem, defter],
    queryFn: () => butceApi.islemler({ donem, defter }),
  });
  const { data: kategoriler = [] } = useQuery({ queryKey: ['butce-kategoriler'], queryFn: () => butceApi.kategoriler() });
  const { data: kartlar = [] } = useQuery({ queryKey: ['butce-kartlar'], queryFn: butceApi.kartlar });
  const { data: hesaplar = [] } = useQuery({ queryKey: ['butce-hesaplar'], queryFn: butceApi.hesaplar });
  const { data: duzenliler = [] } = useQuery({ queryKey: ['butce-duzenliler'], queryFn: () => butceApi.duzenliler() });

  const aktifHesaplar = useMemo(() => hesaplar.filter((h) => h.aktif), [hesaplar]);

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['butce-islemler'] });
    qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    qc.invalidateQueries({ queryKey: ['butce-plan'] });
    // Banka hesabına bağlı kayıtlar bakiyeyi ve nakit akışını da değiştirir.
    qc.invalidateQueries({ queryKey: ['butce-hesaplar'] });
    qc.invalidateQueries({ queryKey: ['butce-nakit-akis'] });
  };

  const sil = useMutation({
    mutationFn: (id: string) => butceApi.islemSil(id),
    onSuccess: () => {
      toast.success('Kayıt silindi');
      tazele();
    },
    onError: () => toast.error('Silinemedi'),
  });

  // Hiç banka hesabı yoksa "hangi hesaba girdi" sorusunun karşılığı yok; tek tıkla işaretlenir.
  const gerceklestiHizli = useMutation({
    mutationFn: (id: string) => butceApi.islemGerceklesti(id, { tarih: bugun() }),
    onSuccess: () => {
      toast.success('Kayıt gerçekleşti olarak işaretlendi');
      tazele();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşaretlenemedi'),
  });

  const duzenliUygula = useMutation({
    mutationFn: () => butceApi.duzenliUygula(donem),
    onSuccess: (d) => {
      toast.success(d.eklenen > 0 ? `${d.eklenen} düzenli kayıt bu aya eklendi` : 'Bu ay için eklenecek yeni kayıt yok');
      tazele();
    },
    onError: () => toast.error('Uygulanamadı'),
  });

  const duzenliSil = useMutation({
    mutationFn: (id: string) => butceApi.duzenliSil(id),
    onSuccess: () => {
      toast.success('Düzenli kayıt silindi');
      qc.invalidateQueries({ queryKey: ['butce-duzenliler'] });
    },
  });

  const gosterilen = useMemo(() => {
    const q = kucult(arama.trim());
    const min = paraCoz(fMin);
    const max = paraCoz(fMax);
    return islemler.filter((i) => {
      if (filtre !== 'HEPSI' && i.tur !== filtre) return false;
      if (fKategori && i.kategoriId !== fKategori) return false;
      if (fKaynak && i.kaynak !== fKaynak) return false;
      if (fMin && i.tutar < min) return false;
      if (fMax && i.tutar > max) return false;
      if (q && !kucult(`${i.aciklama || ''} ${i.kategori?.ad || ''}`).includes(q)) return false;
      return true;
    });
  }, [islemler, filtre, arama, fKategori, fKaynak, fMin, fMax]);

  const aktifFiltreSayisi = [arama.trim(), fKategori, fKaynak, fMin, fMax].filter(Boolean).length;
  const filtreleriTemizle = () => {
    setArama('');
    setFKategori('');
    setFKaynak('');
    setFMin('');
    setFMax('');
  };

  const toplamGelir = islemler.filter((i) => i.tur === 'GELIR').reduce((t, i) => t + i.tutar, 0);
  const toplamGider = islemler.filter((i) => i.tur === 'GIDER').reduce((t, i) => t + i.tutar, 0);
  const beklenenSayisi = islemler.filter((i) => i.planlanan).length;

  const sayiMetni =
    gosterilen.length === islemler.length
      ? `${islemler.length} kayıt`
      : `${gosterilen.length} / ${islemler.length} kayıt`;

  return (
    <div className="space-y-4">
      <Kutu
        baslik="Gelir ve giderler"
        aciklama={
          `${sayiMetni} · Gelir ${para(toplamGelir)} ₺ · Gider ${para(toplamGider)} ₺` +
          (beklenenSayisi > 0 ? ` · ${beklenenSayisi} beklenen` : '')
        }
        sag={
          <div className="flex flex-wrap items-center gap-2">
            {(['HEPSI', 'GELIR', 'GIDER'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltre(f)}
                className="rounded-lg px-2.5 py-1 text-[11px] transition"
                style={{
                  background: filtre === f ? `${GOLD}1f` : 'transparent',
                  border: `1px solid ${filtre === f ? `${GOLD}44` : 'transparent'}`,
                  color: filtre === f ? GOLD : MUTED,
                }}
              >
                {f === 'HEPSI' ? 'Hepsi' : f === 'GELIR' ? 'Gelir' : 'Gider'}
              </button>
            ))}
            <Dugme
              renk={aktifFiltreSayisi > 0 ? GOLD : MUTED}
              onClick={() => setFiltreAcik((a) => !a)}
            >
              <SlidersHorizontal size={13} /> Filtreler
              {aktifFiltreSayisi > 0 && (
                <span
                  className="ml-0.5 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                  style={{ background: `${GOLD}2e`, color: GOLD, border: `1px solid ${GOLD}55` }}
                >
                  {aktifFiltreSayisi}
                </span>
              )}
            </Dugme>
            <Dugme renk={MAVI} onClick={() => setAktarimAcik(true)}>
              <ArrowLeftRight size={13} /> Aktarım
            </Dugme>
            <Dugme tur="birincil" onClick={() => setModal('yeni')}>
              <Plus size={13} /> Kayıt ekle
            </Dugme>
          </div>
        }
      >
        {filtreAcik && (
          <div
            className="mb-3 rounded-xl p-3"
            style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${CARD_BORDER}` }}
          >
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <Alan etiket="Ara" genis>
                <div className="relative">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                    style={{ color: MUTED }}
                  />
                  <Girdi
                    value={arama}
                    onChange={(e) => setArama(e.target.value)}
                    placeholder="Açıklama veya kategori adı"
                    style={{ paddingLeft: 28 }}
                  />
                </div>
              </Alan>
              <Alan etiket="Kategori">
                <Secim value={fKategori} onChange={(e) => setFKategori(e.target.value)}>
                  <option value="">Tüm kategoriler</option>
                  <optgroup label="Gider">
                    {kategoriler.filter((c) => c.tur === 'GIDER').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.ad}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Gelir">
                    {kategoriler.filter((c) => c.tur === 'GELIR').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.ad}
                      </option>
                    ))}
                  </optgroup>
                </Secim>
              </Alan>
              <Alan etiket="Kaynak">
                <Secim value={fKaynak} onChange={(e) => setFKaynak(e.target.value)}>
                  <option value="">Tüm kaynaklar</option>
                  {KAYNAKLAR.map((k) => (
                    <option key={k.deger} value={k.deger}>
                      {k.etiket}
                    </option>
                  ))}
                </Secim>
              </Alan>
              <Alan etiket="En az tutar">
                <ParaGirdi value={fMin} onChange={setFMin} />
              </Alan>
              <Alan etiket="En çok tutar">
                <ParaGirdi value={fMax} onChange={setFMax} />
              </Alan>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10.5px]" style={{ color: MUTED }}>
                {aktifFiltreSayisi === 0
                  ? 'Filtre uygulanmadı; dönemdeki tüm kayıtlar listeleniyor.'
                  : `${aktifFiltreSayisi} filtre açık · ${gosterilen.length} kayıt görünüyor`}
              </span>
              <Dugme tur="sade" onClick={filtreleriTemizle} disabled={aktifFiltreSayisi === 0}>
                Temizle
              </Dugme>
            </div>
          </div>
        )}

        {isLoading ? (
          <Yukleniyor />
        ) : gosterilen.length === 0 ? (
          <Bos
            metin={
              islemler.length === 0
                ? 'Bu dönemde kayıt yok. “Kayıt ekle” ile başlayın.'
                : 'Filtreye uyan kayıt yok. “Temizle” ile filtreleri kaldırabilirsiniz.'
            }
          />
        ) : (
          <div className="max-h-[520px] overflow-y-auto pr-1">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                  <th className="pb-2 font-medium">Tarih</th>
                  <th className="pb-2 font-medium">Açıklama</th>
                  <th className="pb-2 font-medium">Kategori</th>
                  <th className="pb-2 text-right font-medium">Tutar</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {gosterilen.map((i) => (
                  <tr
                    key={i.id}
                    className="border-t"
                    style={{
                      borderColor: ROW_SEP,
                      // Beklenen kayıt henüz gerçekleşmedi; kesikli çerçeve onu gerçekleşmişten ayırır.
                      ...(i.planlanan
                        ? {
                            background: `${TURUNCU}0a`,
                            outline: `1px dashed ${TURUNCU}55`,
                            outlineOffset: '-1px',
                          }
                        : null),
                    }}
                  >
                    <td className="py-2 tabular-nums" style={{ color: MUTED }}>
                      {tarihTR(i.tarih)}
                    </td>
                    <td className="py-2" style={{ color: TEXT }}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {i.aciklama || '—'}
                        {i.kaynak === 'KART' && <CreditCard size={11} style={{ color: MAVI }} />}
                        {i.planlanan && <Rozet metin="beklenen" renk={TURUNCU} />}
                        {i.transferGrupId && <Rozet metin="aktarım" renk={MAVI} />}
                        {defter === 'TUMU' && (
                          <Rozet metin={DEFTER_ETIKET[i.defter]} renk={defterRenk(i.defter)} />
                        )}
                      </span>
                    </td>
                    <td className="py-2" style={{ color: MUTED }}>
                      <span className="flex items-center gap-1.5">
                        {i.kategori?.renk && (
                          <i className="h-2 w-2 rounded-sm" style={{ background: i.kategori.renk }} />
                        )}
                        {i.kategori?.ad || '—'}
                      </span>
                    </td>
                    <td
                      className="py-2 text-right font-medium tabular-nums"
                      style={{ color: i.tur === 'GELIR' ? OK : KIRMIZI }}
                    >
                      {i.tur === 'GELIR' ? '+' : '−'}
                      {para(i.tutar)} ₺
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {i.planlanan && (
                          <button
                            onClick={() =>
                              aktifHesaplar.length > 0
                                ? setGerceklesKayit(i)
                                : gerceklestiHizli.mutate(i.id)
                            }
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[10.5px] transition hover:brightness-110"
                            style={{ background: `${OK}14`, border: `1px solid ${OK}3d`, color: OK }}
                            title="Bu beklenen kaydı gerçekleşmiş yap"
                          >
                            <CheckCircle2 size={11} /> Gerçekleşti
                          </button>
                        )}
                        <button
                          onClick={() => setModal(i)}
                          className="rounded-md p-1 transition hover:bg-white/[0.06]"
                          style={{ color: MUTED }}
                          title="Düzenle"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => sil.mutate(i.id)}
                          className="rounded-md p-1 transition hover:bg-white/[0.06]"
                          style={{ color: KIRMIZI }}
                          title="Sil"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Kutu>

      <Kutu
        baslik="Düzenli gelir ve giderler"
        aciklama="Her ay tekrar eden kalemler (kira, maaş, abonelik). Bir kez tanımlayın, her ay otomatik düşsün."
        renk={MAVI}
        sag={
          <div className="flex gap-2">
            <Dugme renk={MAVI} onClick={() => duzenliUygula.mutate()} yukleniyor={duzenliUygula.isPending}>
              <PlayCircle size={13} /> Bu aya uygula
            </Dugme>
            <Dugme tur="birincil" renk={MAVI} onClick={() => setDuzenliModal('yeni')}>
              <Plus size={13} /> Ekle
            </Dugme>
          </div>
        }
      >
        {duzenliler.length === 0 ? (
          <Bos metin="Düzenli kalem tanımlanmadı." ikon={<Repeat size={18} />} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {duzenliler.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${ROW_SEP}` }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: TEXT }}>
                    <span className="truncate">{d.ad}</span>
                    <Rozet metin={DEFTER_ETIKET[d.defter]} renk={defterRenk(d.defter)} />
                    {!d.aktif && <Rozet metin="pasif" renk={MUTED} />}
                    {d.zorunlu && <Rozet metin="kısılamaz" renk={TURUNCU} />}
                  </div>
                  <div className="text-[10.5px]" style={{ color: MUTED }}>
                    Her ayın {d.ayinGunu}. günü · {d.kategori?.ad || 'kategorisiz'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="whitespace-nowrap text-[13px] font-medium tabular-nums"
                    style={{ color: d.tur === 'GELIR' ? OK : KIRMIZI }}
                  >
                    {d.tur === 'GELIR' ? '+' : '−'}
                    {para(d.tutar)} ₺
                  </span>
                  <button
                    onClick={() => setDuzenliModal(d)}
                    className="rounded-md p-1 transition hover:bg-white/[0.06]"
                    style={{ color: MUTED }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => duzenliSil.mutate(d.id)}
                    className="rounded-md p-1 transition hover:bg-white/[0.06]"
                    style={{ color: KIRMIZI }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Kutu>

      {modal && (
        <IslemModal
          kayit={modal === 'yeni' ? null : modal}
          kategoriler={kategoriler}
          kartlar={kartlar}
          hesaplar={aktifHesaplar}
          donem={donem}
          kapat={() => setModal(null)}
          kaydedildi={() => {
            setModal(null);
            tazele();
          }}
        />
      )}

      {gerceklesKayit && (
        <GerceklestiModal
          kayit={gerceklesKayit}
          hesaplar={aktifHesaplar}
          kapat={() => setGerceklesKayit(null)}
          tamamlandi={() => {
            setGerceklesKayit(null);
            tazele();
          }}
        />
      )}

      {aktarimAcik && (
        <AktarimModal
          hesaplar={aktifHesaplar}
          kapat={() => setAktarimAcik(false)}
          tamamlandi={() => {
            setAktarimAcik(false);
            tazele();
          }}
        />
      )}

      {duzenliModal && (
        <DuzenliModal
          kayit={duzenliModal === 'yeni' ? null : duzenliModal}
          kategoriler={kategoriler}
          kartlar={kartlar}
          kapat={() => setDuzenliModal(null)}
          kaydedildi={() => {
            setDuzenliModal(null);
            qc.invalidateQueries({ queryKey: ['butce-duzenliler'] });
          }}
        />
      )}
    </div>
  );
}

/* ===================== İŞLEM MODALI ===================== */

function IslemModal({
  kayit,
  kategoriler,
  kartlar,
  hesaplar,
  donem,
  kapat,
  kaydedildi,
}: {
  kayit: Islem | null;
  kategoriler: Kategori[];
  kartlar: Kart[];
  hesaplar: BankaHesap[];
  donem: string;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const varsayilanTarih =
    kayit?.tarih?.slice(0, 10) || (donem === buDonem() ? bugun() : `${donem}-01`);
  const [form, setForm] = useState({
    tur: kayit?.tur || ('GIDER' as 'GELIR' | 'GIDER'),
    tutar: paraGiris(kayit?.tutar),
    tarih: varsayilanTarih,
    kategoriId: kayit?.kategoriId || '',
    aciklama: kayit?.aciklama || '',
    kaynak: kayit?.kaynak || 'NAKIT',
    kartId: kayit?.kartId || '',
    bankaHesapId: kayit?.bankaHesapId || '',
    defter: (kayit?.defter || 'SAHSI') as Defter,
    planlanan: kayit?.planlanan ?? false,
  });

  const kaydet = useMutation({
    mutationFn: () => {
      const body = {
        tur: form.tur,
        tutar: paraCoz(form.tutar),
        tarih: form.tarih,
        kategoriId: form.kategoriId || null,
        aciklama: form.aciklama || null,
        kaynak: form.kaynak,
        kartId: form.kaynak === 'KART' ? form.kartId || null : null,
        bankaHesapId: form.kaynak === 'BANKA' ? form.bankaHesapId || null : null,
        defter: form.defter,
        planlanan: form.planlanan,
      } as any;
      return kayit ? butceApi.islemGuncelle(kayit.id, body) : butceApi.islemEkle(body);
    },
    onSuccess: () => {
      toast.success(kayit ? 'Kayıt güncellendi' : 'Kayıt eklendi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  const uygunKategoriler = kategoriler.filter((c) => c.tur === form.tur && c.aktif);

  // Kategorinin defteri kaydın defterini belirler ("Ofis geliri" seçilince şahsiye yazılmasın).
  const kategoriSec = (id: string) => {
    const secilen = kategoriler.find((c) => c.id === id);
    setForm((f) => ({ ...f, kategoriId: id, defter: (secilen?.defter as Defter) || f.defter }));
  };

  const tutar = paraCoz(form.tutar);
  const hesapEksik = form.kaynak === 'BANKA' && !form.bankaHesapId;
  const kartEksik = form.kaynak === 'KART' && !form.kartId;
  const gecersiz = tutar <= 0 || hesapEksik || kartEksik;

  return (
    <Modal baslik={kayit ? 'Kaydı düzenle' : 'Yeni gelir / gider'} kapat={kapat} genislik={620}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (gecersiz) return;
          kaydet.mutate();
        }}
      >
        <Alan etiket="Tür">
          <Secim value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value as any, kategoriId: '' })}>
            <option value="GIDER">Gider</option>
            <option value="GELIR">Gelir</option>
          </Secim>
        </Alan>
        <Alan etiket="Tutar">
          <ParaGirdi autoFocus value={form.tutar} onChange={(v) => setForm({ ...form, tutar: v })} />
        </Alan>
        <Alan etiket="Tarih">
          <Girdi type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} />
        </Alan>
        <Alan etiket="Kategori">
          <Secim value={form.kategoriId} onChange={(e) => kategoriSec(e.target.value)}>
            <option value="">Seçiniz</option>
            {uygunKategoriler.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ad}
              </option>
            ))}
          </Secim>
        </Alan>

        {/* Gelir TEK HAVUZ olduğu için yalnız giderde mesleki/kişisel sorulur */}
        {form.tur === 'GIDER' && (
          <DefterAlani
            deger={form.defter}
            degistir={(d) => setForm({ ...form, defter: d })}
            ipucu="Mesleki gider kazançtan indirilir; kişisel harcama indirilemez."
          />
        )}

        <Alan etiket="Ödeme kaynağı">
          <Secim value={form.kaynak} onChange={(e) => setForm({ ...form, kaynak: e.target.value as any })}>
            {KAYNAKLAR.map((k) => (
              <option key={k.deger} value={k.deger}>
                {k.etiket}
              </option>
            ))}
          </Secim>
        </Alan>
        {form.kaynak === 'BANKA' && (
          <Alan
            etiket="Hesap"
            genis
            ipucu={
              hesaplar.length === 0
                ? 'Banka hesabı tanımlı değil. Hesaplar sekmesinden hesap ekleyin.'
                : 'Tutar bu hesabın bakiyesine işlenir.'
            }
          >
            <Secim value={form.bankaHesapId} onChange={(e) => setForm({ ...form, bankaHesapId: e.target.value })}>
              <option value="">Seçiniz</option>
              {hesaplar.map((h) => (
                <option key={h.id} value={h.id}>
                  {hesapAdi(h)}
                </option>
              ))}
            </Secim>
          </Alan>
        )}
        {form.kaynak === 'KART' && (
          <Alan etiket="Kart">
            <Secim value={form.kartId} onChange={(e) => setForm({ ...form, kartId: e.target.value })}>
              <option value="">Seçiniz</option>
              {kartlar.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bankaAdi} {k.kartAdi}
                </option>
              ))}
            </Secim>
          </Alan>
        )}
        <Alan etiket="Açıklama" genis>
          <Girdi
            value={form.aciklama}
            onChange={(e) => setForm({ ...form, aciklama: e.target.value })}
            placeholder="Örn. Market alışverişi"
          />
        </Alan>

        <div
          className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 sm:col-span-2"
          style={{ background: `${TURUNCU}10`, border: `1px solid ${TURUNCU}30` }}
        >
          <div className="min-w-0">
            <div className="text-[12px]" style={{ color: TEXT }}>
              Henüz olmadı, ileride olacak
            </div>
            <div className="mt-0.5 text-[10.5px] leading-relaxed" style={{ color: MUTED }}>
              Örnek: “20 Ağustos’ta gelecek tahsilat”. Gelir/gider toplamlarına{' '}
              <strong style={{ color: TEXT }}>girmez</strong>; yalnız Nakit Akışı takviminde o günün hareketi
              olarak görünür — “o gün param yeter mi” sorusunun cevabı doğru çıksın diye. Para gerçekten
              gelince bu işareti kaldırın.
            </div>
          </div>
          <Anahtar acik={form.planlanan} degistir={(v) => setForm({ ...form, planlanan: v })} renk={TURUNCU} />
        </div>

        {(hesapEksik || kartEksik) && (
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11.5px] sm:col-span-2"
            style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}30`, color: KIRMIZI }}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>
              {hesapEksik
                ? 'Banka seçtiniz; hangi hesap olduğunu da seçin.'
                : 'Kredi kartı seçtiniz; hangi kart olduğunu da seçin.'}
            </span>
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme type="submit" tur="birincil" disabled={gecersiz} yukleniyor={kaydet.isPending}>
            Kaydet
          </Dugme>
        </div>
      </form>
    </Modal>
  );
}

/* ===================== BEKLENEN KAYIT → GERÇEKLEŞTİ ===================== */

function GerceklestiModal({
  kayit,
  hesaplar,
  kapat,
  tamamlandi,
}: {
  kayit: Islem;
  hesaplar: BankaHesap[];
  kapat: () => void;
  tamamlandi: () => void;
}) {
  const [tarih, setTarih] = useState(bugun());
  const [bankaHesapId, setBankaHesapId] = useState(kayit.bankaHesapId || '');

  const isaretle = useMutation({
    mutationFn: () =>
      butceApi.islemGerceklesti(kayit.id, {
        tarih,
        bankaHesapId: bankaHesapId || undefined,
      }),
    onSuccess: () => {
      toast.success('Kayıt gerçekleşti olarak işaretlendi');
      tamamlandi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşaretlenemedi'),
  });

  return (
    <Modal
      baslik="Gerçekleşti olarak işaretle"
      aciklama="Beklenen kayıt gerçek hareket olur; nakit akışında “beklenen” görünmez."
      kapat={kapat}
      genislik={480}
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          isaretle.mutate();
        }}
      >
        <div
          className="rounded-xl px-3 py-2.5 sm:col-span-2"
          style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${CARD_BORDER}` }}
        >
          <div className="text-[12.5px]" style={{ color: TEXT }}>
            {kayit.aciklama || 'Açıklamasız kayıt'}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: kayit.tur === 'GELIR' ? OK : KIRMIZI }}>
            {kayit.tur === 'GELIR' ? '+' : '−'}
            {para(kayit.tutar)} ₺ · {kayit.kategori?.ad || 'kategorisiz'}
          </div>
        </div>

        <Alan etiket="Gerçekleşme tarihi">
          <Girdi type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
        </Alan>
        <Alan etiket="Hangi hesaba girdi / çıktı" ipucu="Boş bırakırsanız kaydın kaynağı değişmez.">
          <Secim value={bankaHesapId} onChange={(e) => setBankaHesapId(e.target.value)}>
            <option value="">Hesap belirtilmesin</option>
            {hesaplar.map((h) => (
              <option key={h.id} value={h.id}>
                {hesapAdi(h)}
              </option>
            ))}
          </Secim>
        </Alan>

        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme type="submit" tur="birincil" renk={OK} yukleniyor={isaretle.isPending}>
            <CheckCircle2 size={12} /> Gerçekleşti
          </Dugme>
        </div>
      </form>
    </Modal>
  );
}

/* ===================== AKTARIM MODALI ===================== */

function AktarimModal({
  hesaplar,
  kapat,
  tamamlandi,
}: {
  hesaplar: BankaHesap[];
  kapat: () => void;
  tamamlandi: () => void;
}) {
  // Bu ekrandaki en sık kullanım ofisten kendine çekiş: kaynak Ofis, hedef Şahsi gelir.
  const [form, setForm] = useState({
    tutar: '',
    tarih: bugun(),
    kaynakDefter: 'OFIS' as Defter,
    hedefDefter: 'SAHSI' as Defter,
    kaynakHesapId: '',
    hedefHesapId: '',
    aciklama: '',
  });

  const tutar = paraCoz(form.tutar);
  const ayniHesap = !!form.kaynakHesapId && form.kaynakHesapId === form.hedefHesapId;
  // Aktarım para taşımaktır: en az bir hesap belirtilmezse hiçbir bakiye değişmez
  const hesapsizAyniDefter = !form.kaynakHesapId && !form.hedefHesapId;
  const gecersiz = tutar <= 0 || ayniHesap || hesapsizAyniDefter;

  const aktar = useMutation({
    mutationFn: () =>
      butceApi.transfer({
        tutar,
        tarih: form.tarih,
        kaynakDefter: form.kaynakDefter,
        hedefDefter: form.hedefDefter,
        kaynakHesapId: form.kaynakHesapId || null,
        hedefHesapId: form.hedefHesapId || null,
        aciklama: form.aciklama.trim(),
      }),
    onSuccess: (s) => {
      toast.success(`${para(s.tutar)} ₺ aktarıldı`);
      tamamlandi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Aktarım yapılamadı'),
  });

  return (
    <Modal
      baslik="Aktarım"
      aciklama="Defterler ya da hesaplar arasında para geçişi. Gelir veya gider olarak sayılmaz."
      kapat={kapat}
      genislik={620}
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (gecersiz) return;
          aktar.mutate();
        }}
      >
        <Alan etiket="Tutar">
          <ParaGirdi autoFocus value={form.tutar} onChange={(v) => setForm({ ...form, tutar: v })} />
        </Alan>
        <Alan etiket="Tarih">
          <Girdi type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} />
        </Alan>

        <Alan etiket="Kaynak hesap (paranın çıktığı)" ipucu="Nakit çekiş ise boş bırakın.">
          <Secim
            value={form.kaynakHesapId}
            onChange={(e) => setForm({ ...form, kaynakHesapId: e.target.value })}
          >
            <option value="">Hesap belirtilmesin</option>
            {hesaplar.map((h) => (
              <option key={h.id} value={h.id}>
                {hesapAdi(h)}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan etiket="Hedef hesap (paranın girdiği)" ipucu="Nakit alındıysa boş bırakın.">
          <Secim
            value={form.hedefHesapId}
            onChange={(e) => setForm({ ...form, hedefHesapId: e.target.value })}
          >
            <option value="">Hesap belirtilmesin</option>
            {hesaplar.map((h) => (
              <option key={h.id} value={h.id}>
                {hesapAdi(h)}
              </option>
            ))}
          </Secim>
        </Alan>

        <Alan etiket="Açıklama" genis>
          <Girdi
            value={form.aciklama}
            onChange={(e) => setForm({ ...form, aciklama: e.target.value })}
            placeholder="Örn. Ziraat’tan İş Bankası’na aktarım"
          />
        </Alan>

        {(ayniHesap || hesapsizAyniDefter) && (
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11.5px] sm:col-span-2"
            style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}30`, color: KIRMIZI }}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>
              {ayniHesap
                ? 'Kaynak ve hedef aynı hesap olamaz. Farklı bir hesap seçin.'
                : 'En az bir hesap seçin; yoksa aktarımın hiçbir bakiyeye etkisi olmaz.'}
            </span>
          </div>
        )}

        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] sm:col-span-2"
          style={{ background: `${MAVI}12`, border: `1px solid ${MAVI}30`, color: MUTED }}
        >
          <ArrowLeftRight size={13} style={{ color: MAVI }} className="mt-0.5 flex-shrink-0" />
          <span>
            Aktarım gelir ya da gider değildir; para yalnız yer değiştirir. Bu yüzden gelir–gider
            toplamlarını etkilemez, sadece hesap bakiyelerini günceller.
          </span>
        </div>

        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme type="submit" tur="birincil" renk={MAVI} disabled={gecersiz} yukleniyor={aktar.isPending}>
            <ArrowLeftRight size={12} /> Aktar
          </Dugme>
        </div>
      </form>
    </Modal>
  );
}

/* ===================== DÜZENLİ ÖDEME MODALI ===================== */

function DuzenliModal({
  kayit,
  kategoriler,
  kartlar,
  kapat,
  kaydedildi,
}: {
  kayit: DuzenliOdeme | null;
  kategoriler: Kategori[];
  kartlar: Kart[];
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [form, setForm] = useState({
    ad: kayit?.ad || '',
    tur: kayit?.tur || ('GIDER' as 'GELIR' | 'GIDER'),
    tutar: paraGiris(kayit?.tutar),
    ayinGunu: String(kayit?.ayinGunu || 1),
    kategoriId: kayit?.kategoriId || '',
    kaynak: kayit?.kaynak || 'NAKIT',
    kartId: kayit?.kartId || '',
    zorunlu: kayit?.zorunlu ?? true,
    aktif: kayit?.aktif ?? true,
    baslangicDonem: kayit?.baslangicDonem || buDonem(),
    bitisDonem: kayit?.bitisDonem || '',
  });

  const kaydet = useMutation({
    mutationFn: () => {
      const body = {
        ad: form.ad,
        tur: form.tur,
        tutar: paraCoz(form.tutar),
        ayinGunu: Number(form.ayinGunu),
        kategoriId: form.kategoriId || null,
        kaynak: form.kaynak,
        kartId: form.kaynak === 'KART' ? form.kartId || null : null,
        zorunlu: form.zorunlu,
        aktif: form.aktif,
        baslangicDonem: form.baslangicDonem,
        bitisDonem: form.bitisDonem || null,
      } as any;
      return kayit ? butceApi.duzenliGuncelle(kayit.id, body) : butceApi.duzenliEkle(body);
    },
    onSuccess: () => {
      toast.success('Düzenli kalem kaydedildi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  return (
    <Modal
      baslik={kayit ? 'Düzenli kalemi düzenle' : 'Yeni düzenli kalem'}
      aciklama="Her ay tekrar eden gelir/gider. “Bu aya uygula” ile döneme yansır."
      kapat={kapat}
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          kaydet.mutate();
        }}
      >
        <Alan etiket="Ad" genis>
          <Girdi autoFocus value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. Ev kirası" />
        </Alan>
        <Alan etiket="Tür">
          <Secim value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value as any, kategoriId: '' })}>
            <option value="GIDER">Gider</option>
            <option value="GELIR">Gelir</option>
          </Secim>
        </Alan>
        <Alan etiket="Tutar">
          <ParaGirdi value={form.tutar} onChange={(v) => setForm({ ...form, tutar: v })} />
        </Alan>
        <Alan etiket="Ayın kaçında">
          <Girdi
            type="number"
            min={1}
            max={31}
            value={form.ayinGunu}
            onChange={(e) => setForm({ ...form, ayinGunu: e.target.value })}
          />
        </Alan>
        <Alan etiket="Kategori">
          <Secim value={form.kategoriId} onChange={(e) => setForm({ ...form, kategoriId: e.target.value })}>
            <option value="">Seçiniz</option>
            {kategoriler.filter((c) => c.tur === form.tur).map((c) => (
              <option key={c.id} value={c.id}>
                {c.ad}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan etiket="Ödeme kaynağı">
          <Secim value={form.kaynak} onChange={(e) => setForm({ ...form, kaynak: e.target.value })}>
            <option value="NAKIT">Nakit</option>
            <option value="BANKA">Banka / otomatik ödeme</option>
            <option value="KART">Kredi kartı</option>
          </Secim>
        </Alan>
        {form.kaynak === 'KART' && (
          <Alan etiket="Kart">
            <Secim value={form.kartId} onChange={(e) => setForm({ ...form, kartId: e.target.value })}>
              <option value="">Seçiniz</option>
              {kartlar.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bankaAdi} {k.kartAdi}
                </option>
              ))}
            </Secim>
          </Alan>
        )}
        <Alan etiket="Başlangıç dönemi">
          <Girdi type="month" value={form.baslangicDonem} onChange={(e) => setForm({ ...form, baslangicDonem: e.target.value })} />
        </Alan>
        <Alan etiket="Bitiş dönemi (boş = süresiz)">
          <Girdi type="month" value={form.bitisDonem} onChange={(e) => setForm({ ...form, bitisDonem: e.target.value })} />
        </Alan>
        <div className="flex items-center gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-[12px]" style={{ color: MUTED }}>
            <input type="checkbox" checked={form.zorunlu} onChange={(e) => setForm({ ...form, zorunlu: e.target.checked })} />
            Zorunlu kalem (kısılamaz)
          </label>
          <label className="flex items-center gap-2 text-[12px]" style={{ color: MUTED }}>
            <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
            Aktif
          </label>
        </div>
        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme type="submit" tur="birincil" renk={MAVI} yukleniyor={kaydet.isPending}>
            Kaydet
          </Dugme>
        </div>
      </form>
    </Modal>
  );
}
