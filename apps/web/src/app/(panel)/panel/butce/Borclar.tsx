'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Landmark, Pencil, Trash2, Wallet } from 'lucide-react';
import { butceApi, Borc, BORC_TURLERI, para, tarihTR } from '@/lib/butce';
import {
  Kutu, Dugme, Modal, Alan, Girdi, Secim, Bos, Rozet, Yukleniyor, ParaGirdi, paraCoz, paraGiris,
  GOLD, OK, KIRMIZI, TURUNCU, MUTED, TEXT, ROW_SEP,
} from './ui';

export default function Borclar() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Borc | 'yeni' | null>(null);
  const [odemeModal, setOdemeModal] = useState<Borc | null>(null);
  const [hepsi, setHepsi] = useState(false);

  const { data: borclar = [], isLoading } = useQuery({
    queryKey: ['butce-borclar', hepsi],
    queryFn: () => butceApi.borclar(hepsi),
  });

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['butce-borclar'] });
    qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    qc.invalidateQueries({ queryKey: ['butce-plan'] });
  };

  const sil = useMutation({
    mutationFn: (id: string) => butceApi.borcSil(id),
    onSuccess: () => {
      toast.success('Borç silindi');
      tazele();
    },
  });

  const toplamKalan = borclar.filter((b) => b.durum === 'AKTIF').reduce((t, b) => t + b.kalanAnapara, 0);
  const aylikTaksit = borclar.filter((b) => b.durum === 'AKTIF').reduce((t, b) => t + b.taksitTutari, 0);

  if (isLoading) return <Yukleniyor />;

  return (
    <div className="space-y-4">
      <Kutu
        baslik="Kredi ve diğer borçlar"
        aciklama={`Aktif borç ${para(toplamKalan)} ₺ · Aylık taksit yükü ${para(aylikTaksit)} ₺`}
        renk={TURUNCU}
        sag={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
              <input type="checkbox" checked={hepsi} onChange={(e) => setHepsi(e.target.checked)} />
              Kapananları da göster
            </label>
            <Dugme tur="birincil" renk={TURUNCU} onClick={() => setModal('yeni')}>
              <Plus size={13} /> Borç ekle
            </Dugme>
          </div>
        }
      >
        {borclar.length === 0 ? (
          <Bos metin="Kayıtlı borç yok." ikon={<Landmark size={18} />} />
        ) : (
          <div className="space-y-2">
            {borclar.map((b) => {
              const ilerleme =
                b.toplamTutar > 0 ? Math.min(((b.toplamTutar - b.kalanAnapara) / b.toplamTutar) * 100, 100) : 0;
              const tur = BORC_TURLERI.find((t) => t.deger === b.tur)?.etiket || b.tur;
              return (
                <div
                  key={b.id}
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${ROW_SEP}`,
                    opacity: b.durum === 'KAPANDI' ? 0.55 : 1,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: TEXT }}>
                        {b.ad}
                        <Rozet metin={tur} renk={MUTED} />
                        {b.durum === 'KAPANDI' && <Rozet metin="kapandı" renk={OK} />}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                        {b.kurum ? `${b.kurum} · ` : ''}
                        Yıllık %{b.yillikFaiz} (aylık %{b.aylikFaiz.toFixed(2)}) · Her ayın {b.odemeGunu}. günü
                        {b.toplamTaksit > 0 ? ` · ${b.odenenTaksit}/${b.toplamTaksit} taksit` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-[10.5px]" style={{ color: MUTED }}>
                          Kalan
                        </div>
                        <div className="text-[16px] font-semibold tabular-nums" style={{ color: TURUNCU }}>
                          {para(b.kalanAnapara)} ₺
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {b.durum === 'AKTIF' && (
                          <Dugme renk={OK} onClick={() => setOdemeModal(b)}>
                            <Wallet size={12} /> Ödeme
                          </Dugme>
                        )}
                        <button
                          onClick={() => setModal(b)}
                          className="rounded-md p-1 transition hover:bg-white/[0.06]"
                          style={{ color: MUTED }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => sil.mutate(b.id)}
                          className="rounded-md p-1 transition hover:bg-white/[0.06]"
                          style={{ color: KIRMIZI }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ width: `${ilerleme}%`, height: '100%', background: OK }} />
                    </div>
                    <span className="text-[10.5px] tabular-nums" style={{ color: MUTED }}>
                      %{Math.round(ilerleme)} ödendi · taksit {para(b.taksitTutari)} ₺
                      {b.bitisTarihi ? ` · bitiş ${tarihTR(b.bitisTarihi)}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Kutu>

      {modal && (
        <BorcModal
          borc={modal === 'yeni' ? null : modal}
          kapat={() => setModal(null)}
          kaydedildi={() => {
            setModal(null);
            tazele();
          }}
        />
      )}

      {odemeModal && (
        <OdemeModal
          borc={odemeModal}
          kapat={() => setOdemeModal(null)}
          kaydedildi={() => {
            setOdemeModal(null);
            tazele();
          }}
        />
      )}
    </div>
  );
}

function BorcModal({ borc, kapat, kaydedildi }: { borc: Borc | null; kapat: () => void; kaydedildi: () => void }) {
  const [form, setForm] = useState({
    ad: borc?.ad || '',
    tur: borc?.tur || 'IHTIYAC',
    kurum: borc?.kurum || '',
    toplamTutar: paraGiris(borc?.toplamTutar),
    kalanAnapara: paraGiris(borc?.kalanAnapara),
    yillikFaiz: borc ? String(borc.yillikFaiz) : '',
    taksitTutari: paraGiris(borc?.taksitTutari),
    toplamTaksit: borc ? String(borc.toplamTaksit) : '',
    odenenTaksit: borc ? String(borc.odenenTaksit) : '0',
    odemeGunu: String(borc?.odemeGunu || 1),
    bitisTarihi: borc?.bitisTarihi?.slice(0, 10) || '',
    notlar: borc?.notlar || '',
  });

  const kaydet = useMutation({
    mutationFn: () => {
      const oran = (v: string) => Number(String(v).replace(',', '.') || 0);
      const body = {
        ad: form.ad,
        tur: form.tur,
        kurum: form.kurum,
        toplamTutar: paraCoz(form.toplamTutar),
        kalanAnapara: paraCoz(form.kalanAnapara || form.toplamTutar),
        yillikFaiz: oran(form.yillikFaiz),
        taksitTutari: paraCoz(form.taksitTutari),
        toplamTaksit: Number(form.toplamTaksit || 0),
        odenenTaksit: Number(form.odenenTaksit || 0),
        odemeGunu: Number(form.odemeGunu),
        bitisTarihi: form.bitisTarihi || null,
        notlar: form.notlar,
      } as any;
      return borc ? butceApi.borcGuncelle(borc.id, body) : butceApi.borcEkle(body);
    },
    onSuccess: () => {
      toast.success('Borç kaydedildi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  return (
    <Modal
      baslik={borc ? 'Borcu düzenle' : 'Yeni borç'}
      aciklama="Faiz oranını girerseniz ödeme planı hangi borcun daha pahalı olduğunu hesaplayabilir."
      kapat={kapat}
      genislik={620}
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          kaydet.mutate();
        }}
      >
        <Alan etiket="Borç adı">
          <Girdi autoFocus value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. Araç kredisi" />
        </Alan>
        <Alan etiket="Tür">
          <Secim value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value })}>
            {BORC_TURLERI.map((t) => (
              <option key={t.deger} value={t.deger}>
                {t.etiket}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan etiket="Kurum / kişi">
          <Girdi value={form.kurum} onChange={(e) => setForm({ ...form, kurum: e.target.value })} />
        </Alan>
        <Alan etiket="Çekilen tutar">
          <ParaGirdi value={form.toplamTutar} onChange={(v) => setForm({ ...form, toplamTutar: v })} />
        </Alan>
        <Alan etiket="Kalan anapara" ipucu="Boş bırakırsanız çekilen tutar alınır">
          <ParaGirdi value={form.kalanAnapara} onChange={(v) => setForm({ ...form, kalanAnapara: v })} />
        </Alan>
        <Alan etiket="Yıllık faiz (%)">
          <Girdi value={form.yillikFaiz} onChange={(e) => setForm({ ...form, yillikFaiz: e.target.value })} inputMode="decimal" />
        </Alan>
        <Alan etiket="Aylık taksit">
          <ParaGirdi value={form.taksitTutari} onChange={(v) => setForm({ ...form, taksitTutari: v })} />
        </Alan>
        <Alan etiket="Ödeme günü">
          <Girdi type="number" min={1} max={31} value={form.odemeGunu} onChange={(e) => setForm({ ...form, odemeGunu: e.target.value })} />
        </Alan>
        <Alan etiket="Toplam taksit">
          <Girdi type="number" min={0} value={form.toplamTaksit} onChange={(e) => setForm({ ...form, toplamTaksit: e.target.value })} />
        </Alan>
        <Alan etiket="Ödenen taksit">
          <Girdi type="number" min={0} value={form.odenenTaksit} onChange={(e) => setForm({ ...form, odenenTaksit: e.target.value })} />
        </Alan>
        <Alan etiket="Bitiş tarihi">
          <Girdi type="date" value={form.bitisTarihi} onChange={(e) => setForm({ ...form, bitisTarihi: e.target.value })} />
        </Alan>
        <Alan etiket="Not" genis>
          <Girdi value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} />
        </Alan>
        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme type="submit" tur="birincil" renk={TURUNCU} yukleniyor={kaydet.isPending}>
            Kaydet
          </Dugme>
        </div>
      </form>
    </Modal>
  );
}

function OdemeModal({ borc, kapat, kaydedildi }: { borc: Borc; kapat: () => void; kaydedildi: () => void }) {
  const [tutar, setTutar] = useState(paraGiris(borc.taksitTutari));
  const [tip, setTip] = useState<'NORMAL' | 'EKSTRA' | 'KAPAMA'>('NORMAL');

  const kaydet = useMutation({
    mutationFn: () => butceApi.borcOdeme(borc.id, { tutar: paraCoz(tutar), tip }),
    onSuccess: () => {
      toast.success('Ödeme işlendi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlenemedi'),
  });

  return (
    <Modal baslik={`${borc.ad} — ödeme`} aciklama={`Kalan anapara ${para(borc.kalanAnapara)} ₺`} kapat={kapat}>
      <div className="space-y-3">
        <Alan etiket="Ödeme tutarı">
          <ParaGirdi autoFocus value={tutar} onChange={setTutar} />
        </Alan>
        <Alan etiket="Ödeme tipi" ipucu="Ekstra ödeme taksit sayacını ilerletmez, anaparayı düşürür">
          <Secim value={tip} onChange={(e) => setTip(e.target.value as any)}>
            <option value="NORMAL">Normal taksit</option>
            <option value="EKSTRA">Ekstra (anapara azaltma)</option>
            <option value="KAPAMA">Kapama</option>
          </Secim>
        </Alan>
        <div className="flex flex-wrap justify-end gap-2">
          <Dugme onClick={() => setTutar(paraGiris(borc.taksitTutari))}>Taksit tutarı</Dugme>
          <Dugme onClick={() => setTutar(paraGiris(borc.kalanAnapara))}>Tamamı</Dugme>
          <Dugme tur="birincil" renk={OK} onClick={() => kaydet.mutate()} yukleniyor={kaydet.isPending}>
            İşle
          </Dugme>
        </div>
      </div>
    </Modal>
  );
}
