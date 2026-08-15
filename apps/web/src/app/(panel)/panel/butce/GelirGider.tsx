'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Repeat, Pencil, CreditCard, PlayCircle } from 'lucide-react';
import {
  butceApi, Islem, Kategori, DuzenliOdeme, Kart, para, tarihTR, buDonem, DefterSecim, DEFTER_ETIKET,
} from '@/lib/butce';
import {
  Kutu, Dugme, Modal, Alan, Girdi, Secim, Bos, Rozet, Yukleniyor, ParaGirdi, paraCoz, paraGiris,
  GOLD, OK, KIRMIZI, MUTED, TEXT, ROW_SEP, MAVI, TURUNCU,
} from './ui';

const bugun = () => new Date().toISOString().slice(0, 10);

export default function GelirGider({ donem, defter = 'TUMU' }: { donem: string; defter?: DefterSecim }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Islem | 'yeni' | null>(null);
  const [duzenliModal, setDuzenliModal] = useState<DuzenliOdeme | 'yeni' | null>(null);
  const [filtre, setFiltre] = useState<'HEPSI' | 'GELIR' | 'GIDER'>('HEPSI');

  const { data: islemler = [], isLoading } = useQuery({
    queryKey: ['butce-islemler', donem, defter],
    queryFn: () => butceApi.islemler({ donem, defter }),
  });
  const { data: kategoriler = [] } = useQuery({ queryKey: ['butce-kategoriler'], queryFn: () => butceApi.kategoriler() });
  const { data: kartlar = [] } = useQuery({ queryKey: ['butce-kartlar'], queryFn: butceApi.kartlar });
  const { data: duzenliler = [] } = useQuery({ queryKey: ['butce-duzenliler'], queryFn: () => butceApi.duzenliler() });

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['butce-islemler'] });
    qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    qc.invalidateQueries({ queryKey: ['butce-plan'] });
  };

  const sil = useMutation({
    mutationFn: (id: string) => butceApi.islemSil(id),
    onSuccess: () => {
      toast.success('Kayıt silindi');
      tazele();
    },
    onError: () => toast.error('Silinemedi'),
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

  const gosterilen = useMemo(
    () => islemler.filter((i) => (filtre === 'HEPSI' ? true : i.tur === filtre)),
    [islemler, filtre],
  );
  const toplamGelir = islemler.filter((i) => i.tur === 'GELIR').reduce((t, i) => t + i.tutar, 0);
  const toplamGider = islemler.filter((i) => i.tur === 'GIDER').reduce((t, i) => t + i.tutar, 0);

  return (
    <div className="space-y-4">
      <Kutu
        baslik="Gelir ve giderler"
        aciklama={`${gosterilen.length} kayıt · Gelir ${para(toplamGelir)} ₺ · Gider ${para(toplamGider)} ₺`}
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
            <Dugme tur="birincil" onClick={() => setModal('yeni')}>
              <Plus size={13} /> Kayıt ekle
            </Dugme>
          </div>
        }
      >
        {isLoading ? (
          <Yukleniyor />
        ) : gosterilen.length === 0 ? (
          <Bos metin="Bu dönemde kayıt yok. “Kayıt ekle” ile başlayın." />
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
                  <tr key={i.id} className="border-t" style={{ borderColor: ROW_SEP }}>
                    <td className="py-2 tabular-nums" style={{ color: MUTED }}>
                      {tarihTR(i.tarih)}
                    </td>
                    <td className="py-2" style={{ color: TEXT }}>
                      <span className="flex items-center gap-1.5">
                        {i.aciklama || '—'}
                        {i.kaynak === 'KART' && <CreditCard size={11} style={{ color: MAVI }} />}
                        {i.planlanan && <Rozet metin="beklenen" renk={TURUNCU} />}
                        {defter === 'TUMU' && (
                          <Rozet
                            metin={DEFTER_ETIKET[i.defter]}
                            renk={i.defter === 'OFIS' ? MAVI : GOLD}
                          />
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
                      <div className="flex justify-end gap-1">
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
                  <div className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXT }}>
                    <span className="truncate">{d.ad}</span>
                    {!d.aktif && <Rozet metin="pasif" renk={MUTED} />}
                    {d.zorunlu && <Rozet metin="zorunlu" renk={TURUNCU} />}
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
          donem={donem}
          kapat={() => setModal(null)}
          kaydedildi={() => {
            setModal(null);
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
  donem,
  kapat,
  kaydedildi,
}: {
  kayit: Islem | null;
  kategoriler: Kategori[];
  kartlar: Kart[];
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

  return (
    <Modal baslik={kayit ? 'Kaydı düzenle' : 'Yeni gelir / gider'} kapat={kapat}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
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
          <Secim value={form.kategoriId} onChange={(e) => setForm({ ...form, kategoriId: e.target.value })}>
            <option value="">Seçiniz</option>
            {uygunKategoriler.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ad}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan etiket="Ödeme kaynağı">
          <Secim value={form.kaynak} onChange={(e) => setForm({ ...form, kaynak: e.target.value as any })}>
            <option value="NAKIT">Nakit</option>
            <option value="BANKA">Banka / havale</option>
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
        <Alan etiket="Açıklama" genis>
          <Girdi
            value={form.aciklama}
            onChange={(e) => setForm({ ...form, aciklama: e.target.value })}
            placeholder="Örn. Market alışverişi"
          />
        </Alan>
        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme type="submit" tur="birincil" yukleniyor={kaydet.isPending}>
            Kaydet
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
