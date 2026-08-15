'use client';

import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, CreditCard, Upload, Pencil, Trash2, CheckCircle2, Undo2, FileText,
  Sparkles, Brain, Hand, CalendarClock,
} from 'lucide-react';
import {
  butceApi, Kart, Ekstre, KartHareket, Kategori, para, tarihTR, buDonem,
  EKSTRE_DURUM_ETIKET,
} from '@/lib/butce';
import {
  Kutu, Dugme, Modal, Alan, Girdi, Secim, Bos, Rozet, Yukleniyor,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, MUTED, TEXT, ROW_SEP, CARD_BORDER,
} from './ui';

export default function Kartlar() {
  const qc = useQueryClient();
  const [kartModal, setKartModal] = useState<Kart | 'yeni' | null>(null);
  const [ekstreModal, setEkstreModal] = useState<{ kart: Kart; ekstre: Ekstre } | null>(null);
  const [pdfModal, setPdfModal] = useState<Kart | null>(null);
  const [hareketModal, setHareketModal] = useState<{ kart: Kart; ekstreId: string } | null>(null);

  const { data: kartlar = [], isLoading } = useQuery({ queryKey: ['butce-kartlar'], queryFn: butceApi.kartlar });

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['butce-kartlar'] });
    qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    qc.invalidateQueries({ queryKey: ['butce-plan'] });
    qc.invalidateQueries({ queryKey: ['butce-islemler'] });
  };

  const kartSil = useMutation({
    mutationFn: (id: string) => butceApi.kartSil(id),
    onSuccess: () => {
      toast.success('Kart silindi');
      tazele();
    },
  });

  const ekstreUret = useMutation({
    mutationFn: (kartId: string) => butceApi.ekstreUret(kartId, buDonem()),
    onSuccess: () => {
      toast.success('Bu dönemin ekstresi açıldı');
      tazele();
    },
  });

  if (isLoading) return <Yukleniyor />;

  return (
    <div className="space-y-4">
      <Kutu
        baslik="Kredi kartlarım"
        aciklama="Hesap kesim gününü tanımlayın; son ödeme tarihi ve hatırlatmalar otomatik işler."
        sag={
          <Dugme tur="birincil" onClick={() => setKartModal('yeni')}>
            <Plus size={13} /> Kart ekle
          </Dugme>
        }
      >
        {kartlar.length === 0 ? (
          <Bos metin="Henüz kart eklenmedi." ikon={<CreditCard size={18} />} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {kartlar.map((k) => {
              const renk = k.renk || GOLD;
              const kullanimOran = k.kartLimiti > 0 ? Math.min((k.kalanBorc / k.kartLimiti) * 100, 100) : 0;
              const e = k.guncelEkstre;
              const durum = e ? EKSTRE_DURUM_ETIKET[e.durum] : null;
              return (
                <div
                  key={k.id}
                  className="relative overflow-hidden rounded-2xl p-4"
                  style={{
                    background: `linear-gradient(150deg, ${renk}14, rgba(255,255,255,0.012) 55%)`,
                    border: `1px solid ${renk}33`,
                    opacity: k.aktif ? 1 : 0.6,
                  }}
                >
                  <div
                    className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full opacity-20"
                    style={{ background: `radial-gradient(circle, ${renk}, transparent 68%)` }}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: TEXT }}>
                        {k.bankaAdi} · {k.kartAdi}
                        {!k.aktif && <Rozet metin="pasif" renk={MUTED} />}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                        {k.sonDortHane ? `**** ${k.sonDortHane} · ` : ''}
                        Kesim ayın {k.kesimGunu}’i · Son ödeme +{k.sonOdemeGunFarki} gün
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setKartModal(k)}
                        className="rounded-md p-1 transition hover:bg-white/[0.08]"
                        style={{ color: MUTED }}
                        title="Düzenle"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => kartSil.mutate(k.id)}
                        className="rounded-md p-1 transition hover:bg-white/[0.08]"
                        style={{ color: KIRMIZI }}
                        title="Sil"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                        Güncel borç
                      </div>
                      <div className="text-[20px] font-semibold tabular-nums" style={{ color: renk }}>
                        {para(k.kalanBorc)} ₺
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10.5px]" style={{ color: MUTED }}>
                        Kullanılabilir limit
                      </div>
                      <div className="text-[12.5px] tabular-nums" style={{ color: TEXT }}>
                        {para(k.kullanilabilirLimit)} ₺
                      </div>
                    </div>
                  </div>

                  {k.kartLimiti > 0 && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div
                        style={{
                          width: `${kullanimOran}%`,
                          height: '100%',
                          background: kullanimOran > 80 ? KIRMIZI : kullanimOran > 50 ? TURUNCU : OK,
                        }}
                      />
                    </div>
                  )}

                  {/* Güncel ekstre */}
                  <div
                    className="mt-3 rounded-xl px-3 py-2.5"
                    style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${ROW_SEP}` }}
                  >
                    {!e ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11.5px]" style={{ color: MUTED }}>
                          Bu dönem için ekstre kaydı yok.
                        </span>
                        <Dugme onClick={() => ekstreUret.mutate(k.id)} yukleniyor={ekstreUret.isPending}>
                          Ekstre aç
                        </Dugme>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-[11.5px]" style={{ color: MUTED }}>
                            <CalendarClock size={12} /> {e.donem} dönemi · son ödeme {tarihTR(e.sonOdemeTarihi)}
                          </span>
                          {durum && <Rozet metin={durum.etiket} renk={durum.renk} />}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="text-[13px] tabular-nums" style={{ color: TEXT }}>
                            {e.borcTutari === null ? (
                              <span style={{ color: TURUNCU }}>Ekstre tutarı girilmedi</span>
                            ) : (
                              <>
                                Borç {para(e.borcTutari)} ₺
                                {e.odenenTutar > 0 && (
                                  <span style={{ color: MUTED }}> · ödenen {para(e.odenenTutar)} ₺</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          <Dugme tur="birincil" renk={MOR} onClick={() => setPdfModal(k)}>
                            <Upload size={12} /> Ekstre PDF yükle
                          </Dugme>
                          <Dugme onClick={() => setEkstreModal({ kart: k, ekstre: e })}>
                            <FileText size={12} /> Tutar / ödeme
                          </Dugme>
                          <Dugme renk={MAVI} onClick={() => setHareketModal({ kart: k, ekstreId: e.id })}>
                            Hareketler
                          </Dugme>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Kutu>

      {/* Geçmiş ekstreler */}
      <EkstreGecmisi />

      {kartModal && (
        <KartModal
          kart={kartModal === 'yeni' ? null : kartModal}
          kapat={() => setKartModal(null)}
          kaydedildi={() => {
            setKartModal(null);
            tazele();
          }}
        />
      )}

      {ekstreModal && (
        <EkstreModal
          kart={ekstreModal.kart}
          ekstre={ekstreModal.ekstre}
          kapat={() => setEkstreModal(null)}
          kaydedildi={() => {
            setEkstreModal(null);
            tazele();
          }}
        />
      )}

      {pdfModal && (
        <PdfModal
          kart={pdfModal}
          kapat={() => setPdfModal(null)}
          tamamlandi={(ekstreId) => {
            setPdfModal(null);
            tazele();
            setHareketModal({ kart: pdfModal, ekstreId });
          }}
        />
      )}

      {hareketModal && (
        <HareketModal
          kart={hareketModal.kart}
          ekstreId={hareketModal.ekstreId}
          kapat={() => setHareketModal(null)}
          degisti={tazele}
        />
      )}
    </div>
  );
}

/* ===================== GEÇMİŞ EKSTRELER ===================== */

function EkstreGecmisi() {
  const { data: ekstreler = [] } = useQuery({ queryKey: ['butce-ekstreler'], queryFn: () => butceApi.ekstreler() });
  if (ekstreler.length === 0) return null;
  return (
    <Kutu baslik="Ekstre geçmişi" aciklama="Son 60 ekstre" renk={MAVI}>
      <div className="max-h-[320px] overflow-y-auto pr-1">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
              <th className="pb-2 font-medium">Kart</th>
              <th className="pb-2 font-medium">Dönem</th>
              <th className="pb-2 font-medium">Son ödeme</th>
              <th className="pb-2 text-right font-medium">Borç</th>
              <th className="pb-2 text-right font-medium">Ödenen</th>
              <th className="pb-2 text-right font-medium">Durum</th>
            </tr>
          </thead>
          <tbody>
            {ekstreler.map((e) => {
              const d = EKSTRE_DURUM_ETIKET[e.durum];
              return (
                <tr key={e.id} className="border-t" style={{ borderColor: ROW_SEP }}>
                  <td className="py-2" style={{ color: TEXT }}>
                    {e.kart?.bankaAdi} {e.kart?.kartAdi}
                  </td>
                  <td className="py-2" style={{ color: MUTED }}>
                    {e.donem}
                  </td>
                  <td className="py-2 tabular-nums" style={{ color: MUTED }}>
                    {tarihTR(e.sonOdemeTarihi)}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={{ color: TEXT }}>
                    {e.borcTutari === null ? '—' : `${para(e.borcTutari)} ₺`}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={{ color: MUTED }}>
                    {para(e.odenenTutar)} ₺
                  </td>
                  <td className="py-2 text-right">
                    <Rozet metin={d.etiket} renk={d.renk} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Kutu>
  );
}

/* ===================== KART MODALI ===================== */

function KartModal({ kart, kapat, kaydedildi }: { kart: Kart | null; kapat: () => void; kaydedildi: () => void }) {
  const [form, setForm] = useState({
    bankaAdi: kart?.bankaAdi || '',
    kartAdi: kart?.kartAdi || '',
    sonDortHane: kart?.sonDortHane || '',
    kartLimiti: kart ? String(kart.kartLimiti) : '',
    kesimGunu: String(kart?.kesimGunu || 1),
    sonOdemeGunFarki: String(kart?.sonOdemeGunFarki ?? 10),
    asgariOran: String(kart?.asgariOran ?? 20),
    aylikFaizOrani: String(kart?.aylikFaizOrani ?? 4.25),
    gecikmeFaizOrani: String(kart?.gecikmeFaizOrani ?? 4.75),
    renk: kart?.renk || GOLD,
    aktif: kart?.aktif ?? true,
  });

  const kaydet = useMutation({
    mutationFn: () => {
      const body = {
        bankaAdi: form.bankaAdi,
        kartAdi: form.kartAdi,
        sonDortHane: form.sonDortHane,
        kartLimiti: Number(form.kartLimiti.replace(',', '.') || 0),
        kesimGunu: Number(form.kesimGunu),
        sonOdemeGunFarki: Number(form.sonOdemeGunFarki),
        asgariOran: Number(form.asgariOran.replace(',', '.')),
        aylikFaizOrani: Number(form.aylikFaizOrani.replace(',', '.')),
        gecikmeFaizOrani: Number(form.gecikmeFaizOrani.replace(',', '.')),
        renk: form.renk,
        aktif: form.aktif,
      } as any;
      return kart ? butceApi.kartGuncelle(kart.id, body) : butceApi.kartEkle(body);
    },
    onSuccess: () => {
      toast.success('Kart kaydedildi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  return (
    <Modal
      baslik={kart ? 'Kartı düzenle' : 'Yeni kredi kartı'}
      aciklama="Son ödeme tarihi, kesim gününe gün farkı eklenerek otomatik hesaplanır."
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
        <Alan etiket="Banka">
          <Girdi autoFocus value={form.bankaAdi} onChange={(e) => setForm({ ...form, bankaAdi: e.target.value })} placeholder="Örn. Ziraat" />
        </Alan>
        <Alan etiket="Kart adı">
          <Girdi value={form.kartAdi} onChange={(e) => setForm({ ...form, kartAdi: e.target.value })} placeholder="Örn. Bankkart Combo" />
        </Alan>
        <Alan etiket="Son 4 hane">
          <Girdi value={form.sonDortHane} onChange={(e) => setForm({ ...form, sonDortHane: e.target.value })} maxLength={4} placeholder="1234" />
        </Alan>
        <Alan etiket="Kart limiti (₺)">
          <Girdi value={form.kartLimiti} onChange={(e) => setForm({ ...form, kartLimiti: e.target.value })} inputMode="decimal" />
        </Alan>
        <Alan etiket="Hesap kesim günü" ipucu="Ayın kaçında ekstre kesiliyor">
          <Girdi type="number" min={1} max={31} value={form.kesimGunu} onChange={(e) => setForm({ ...form, kesimGunu: e.target.value })} />
        </Alan>
        <Alan etiket="Son ödemeye gün farkı" ipucu="Çoğu bankada 10 gün">
          <Girdi type="number" min={0} max={30} value={form.sonOdemeGunFarki} onChange={(e) => setForm({ ...form, sonOdemeGunFarki: e.target.value })} />
        </Alan>
        <Alan etiket="Asgari ödeme oranı (%)">
          <Girdi value={form.asgariOran} onChange={(e) => setForm({ ...form, asgariOran: e.target.value })} inputMode="decimal" />
        </Alan>
        <Alan etiket="Aylık akdi faiz (%)" ipucu="Boş bırakırsanız güncel tavan varsayılır">
          <Girdi value={form.aylikFaizOrani} onChange={(e) => setForm({ ...form, aylikFaizOrani: e.target.value })} inputMode="decimal" />
        </Alan>
        <Alan etiket="Aylık gecikme faizi (%)">
          <Girdi value={form.gecikmeFaizOrani} onChange={(e) => setForm({ ...form, gecikmeFaizOrani: e.target.value })} inputMode="decimal" />
        </Alan>
        <Alan etiket="Renk">
          <input
            type="color"
            value={form.renk}
            onChange={(e) => setForm({ ...form, renk: e.target.value })}
            style={{ width: '100%', height: 34, background: 'transparent', border: `1px solid ${CARD_BORDER}`, borderRadius: 10 }}
          />
        </Alan>
        <label className="flex items-center gap-2 text-[12px] sm:col-span-2" style={{ color: MUTED }}>
          <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
          Kart aktif (kapalı kartlar plan hesabına girmez)
        </label>
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

/* ===================== EKSTRE TUTAR / ÖDEME MODALI ===================== */

function EkstreModal({
  kart,
  ekstre,
  kapat,
  kaydedildi,
}: {
  kart: Kart;
  ekstre: Ekstre;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [borc, setBorc] = useState(ekstre.borcTutari !== null ? String(ekstre.borcTutari) : '');
  const [odeme, setOdeme] = useState('');

  const tutarKaydet = useMutation({
    mutationFn: () => butceApi.ekstreTutar(ekstre.id, { borcTutari: Number(borc.replace(',', '.')) }),
    onSuccess: () => {
      toast.success('Ekstre tutarı kaydedildi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  const odemeKaydet = useMutation({
    mutationFn: () => butceApi.ekstreOdeme(ekstre.id, { tutar: Number(odeme.replace(',', '.')) }),
    onSuccess: () => {
      toast.success('Ödeme işlendi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlenemedi'),
  });

  const asgariTahmin = borc ? (Number(borc.replace(',', '.')) * kart.asgariOran) / 100 : 0;

  return (
    <Modal
      baslik={`${kart.bankaAdi} ${kart.kartAdi} — ${ekstre.donem}`}
      aciklama={`Kesim ${tarihTR(ekstre.kesimTarihi)} · Son ödeme ${tarihTR(ekstre.sonOdemeTarihi)}`}
      kapat={kapat}
    >
      <div className="space-y-4">
        <div>
          <Alan etiket="Ekstre borç tutarı (₺)" ipucu={borc ? `Asgari (%${kart.asgariOran}): ${para(asgariTahmin)} ₺` : undefined}>
            <Girdi autoFocus value={borc} onChange={(e) => setBorc(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Alan>
          <div className="mt-2 flex justify-end">
            <Dugme tur="birincil" onClick={() => tutarKaydet.mutate()} yukleniyor={tutarKaydet.isPending}>
              Tutarı kaydet
            </Dugme>
          </div>
        </div>

        {ekstre.borcTutari !== null && (
          <div className="border-t pt-4" style={{ borderColor: ROW_SEP }}>
            <div className="mb-2 flex items-center justify-between text-[12px]" style={{ color: MUTED }}>
              <span>Ödenen: {para(ekstre.odenenTutar)} ₺</span>
              <span>Kalan: {para(ekstre.kalanTutar ?? 0)} ₺</span>
            </div>
            <Alan etiket="Ödeme tutarı (₺)">
              <Girdi value={odeme} onChange={(e) => setOdeme(e.target.value)} inputMode="decimal" placeholder="0,00" />
            </Alan>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Dugme onClick={() => setOdeme(String(ekstre.asgariTutar ?? 0))}>Asgari</Dugme>
              <Dugme onClick={() => setOdeme(String(ekstre.kalanTutar ?? 0))}>Tamamı</Dugme>
              <Dugme tur="birincil" renk={OK} onClick={() => odemeKaydet.mutate()} yukleniyor={odemeKaydet.isPending}>
                Ödemeyi işle
              </Dugme>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ===================== PDF YÜKLEME MODALI ===================== */

function PdfModal({ kart, kapat, tamamlandi }: { kart: Kart; kapat: () => void; tamamlandi: (ekstreId: string) => void }) {
  const dosyaRef = useRef<HTMLInputElement>(null);
  const [dosya, setDosya] = useState<File | null>(null);
  const [sifre, setSifre] = useState('');
  const [donem, setDonem] = useState(buDonem());

  const yukle = useMutation({
    mutationFn: () => butceApi.ekstrePdfYukle(kart.id, dosya!, { donem, sifre: sifre || undefined }),
    onSuccess: (s) => {
      toast.success(`${s.hareketSayisi} hareket okundu (${s.yontem === 'KURAL' ? 'kural tabanlı' : 'yapay zekâ'})`);
      if (s.uyari) toast.warning(s.uyari, { duration: 8000 });
      tamamlandi(s.ekstreId);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'PDF işlenemedi'),
  });

  return (
    <Modal
      baslik={`${kart.bankaAdi} ${kart.kartAdi} — ekstre yükle`}
      aciklama="Bankadan indirdiğiniz PDF hesap özetini yükleyin; hareketler ve tutar otomatik okunur."
      kapat={kapat}
    >
      <div className="space-y-3">
        <div
          onClick={() => dosyaRef.current?.click()}
          className="cursor-pointer rounded-xl px-4 py-8 text-center transition hover:bg-white/[0.03]"
          style={{ border: `1px dashed ${dosya ? MOR : CARD_BORDER}`, color: dosya ? TEXT : MUTED }}
        >
          <Upload size={20} className="mx-auto mb-2" style={{ color: MOR }} />
          <div className="text-[12.5px]">{dosya ? dosya.name : 'PDF dosyasını seçmek için tıklayın'}</div>
          <div className="mt-1 text-[10.5px]" style={{ color: MUTED }}>
            En fazla 20 MB
          </div>
          <input
            ref={dosyaRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => setDosya(e.target.files?.[0] || null)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Alan etiket="Dönem" ipucu="PDF'ten okunursa o kullanılır">
            <Girdi type="month" value={donem} onChange={(e) => setDonem(e.target.value)} />
          </Alan>
          <Alan etiket="PDF şifresi (varsa)" ipucu="Bankalar genelde TC/doğum tarihi kullanır">
            <Girdi type="password" value={sifre} onChange={(e) => setSifre(e.target.value)} placeholder="Şifreli değilse boş bırakın" />
          </Alan>
        </div>

        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px]"
          style={{ background: `${MOR}12`, border: `1px solid ${MOR}30`, color: MUTED }}
        >
          <Sparkles size={13} style={{ color: MOR }} className="mt-0.5 flex-shrink-0" />
          <span>
            Hareketler önce kural tabanlı okunur (ücretsiz ve hızlı); okunamazsa yapay zekâ devreye girer.
            Kategoriler daha önce düzelttiğiniz satıcılardan öğrenilir. Onaylamadan bütçeye işlenmez.
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          <Dugme
            tur="birincil"
            renk={MOR}
            onClick={() => dosya && yukle.mutate()}
            disabled={!dosya}
            yukleniyor={yukle.isPending}
          >
            {yukle.isPending ? 'Okunuyor…' : 'Yükle ve oku'}
          </Dugme>
        </div>
      </div>
    </Modal>
  );
}

/* ===================== HAREKETLER MODALI ===================== */

function HareketModal({
  kart,
  ekstreId,
  kapat,
  degisti,
}: {
  kart: Kart;
  ekstreId: string;
  kapat: () => void;
  degisti: () => void;
}) {
  const qc = useQueryClient();
  const { data: hareketler = [], isLoading, refetch } = useQuery({
    queryKey: ['butce-hareketler', ekstreId],
    queryFn: () => butceApi.hareketler(ekstreId),
  });
  const { data: kategoriler = [] } = useQuery({ queryKey: ['butce-kategoriler'], queryFn: butceApi.kategoriler });

  const kategoriDegistir = useMutation({
    mutationFn: (p: { id: string; kategoriId: string }) => butceApi.hareketKategori(p.id, p.kategoriId, true),
    onSuccess: () => {
      refetch();
      toast.success('Kategori güncellendi ve öğrenildi');
    },
  });

  const onayla = useMutation({
    mutationFn: () => butceApi.hareketOnayla(ekstreId),
    onSuccess: (d) => {
      toast.success(`${d.islenen} hareket bütçeye işlendi`);
      refetch();
      degisti();
      qc.invalidateQueries({ queryKey: ['butce-islemler'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlenemedi'),
  });

  const geriAl = useMutation({
    mutationFn: () => butceApi.hareketGeriAl(ekstreId),
    onSuccess: (d) => {
      toast.success(`${d.geriAlinan} kayıt geri alındı`);
      refetch();
      degisti();
    },
  });

  const bekleyen = hareketler.filter((h) => !h.onaylandi);
  const toplam = hareketler.reduce((t, h) => t + h.tutar, 0);
  const kategorisiz = bekleyen.filter((h) => !h.kategoriId).length;

  const kaynakIkon = (k: KartHareket['kategoriKaynak']) =>
    k === 'HAFIZA' ? <Brain size={11} style={{ color: OK }} /> : k === 'ELLE' ? <Hand size={11} style={{ color: GOLD }} /> : <Sparkles size={11} style={{ color: MOR }} />;

  return (
    <Modal
      baslik={`${kart.bankaAdi} ${kart.kartAdi} — ekstre hareketleri`}
      aciklama={`${hareketler.length} hareket · toplam ${para(toplam)} ₺${kategorisiz > 0 ? ` · ${kategorisiz} kategorisiz` : ''}`}
      kapat={kapat}
      genislik={860}
    >
      {isLoading ? (
        <Yukleniyor />
      ) : hareketler.length === 0 ? (
        <Bos metin="Bu ekstrede hareket yok. PDF yükleyerek hareketleri okutabilirsiniz." />
      ) : (
        <>
          <div className="max-h-[440px] overflow-y-auto pr-1">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0" style={{ background: '#0c0c0e' }}>
                <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                  <th className="pb-2 font-medium">Tarih</th>
                  <th className="pb-2 font-medium">Açıklama</th>
                  <th className="pb-2 text-right font-medium">Tutar</th>
                  <th className="pb-2 font-medium">Kategori</th>
                </tr>
              </thead>
              <tbody>
                {hareketler.map((h) => (
                  <tr key={h.id} className="border-t" style={{ borderColor: ROW_SEP, opacity: h.onaylandi ? 0.55 : 1 }}>
                    <td className="py-1.5 tabular-nums" style={{ color: MUTED }}>
                      {tarihTR(h.tarih)}
                    </td>
                    <td className="py-1.5" style={{ color: TEXT }}>
                      <span className="flex items-center gap-1.5">
                        {h.aciklama}
                        {h.taksitBilgi && <Rozet metin={h.taksitBilgi} renk={TURUNCU} />}
                        {h.onaylandi && <CheckCircle2 size={11} style={{ color: OK }} />}
                      </span>
                    </td>
                    <td
                      className="py-1.5 text-right tabular-nums"
                      style={{ color: h.tutar >= 0 ? TEXT : OK }}
                    >
                      {para(h.tutar)} ₺
                    </td>
                    <td className="py-1.5 pl-3">
                      <div className="flex items-center gap-1.5">
                        {kaynakIkon(h.kategoriKaynak)}
                        <Secim
                          value={h.kategoriId || ''}
                          disabled={h.onaylandi}
                          onChange={(e) => kategoriDegistir.mutate({ id: h.id, kategoriId: e.target.value })}
                          style={{ padding: '4px 8px', fontSize: 11.5, minWidth: 150 }}
                        >
                          <option value="">Seçiniz</option>
                          {kategoriler
                            .filter((c) => c.tur === (h.tutar >= 0 ? 'GIDER' : 'GELIR'))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.ad}
                              </option>
                            ))}
                        </Secim>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px]" style={{ color: MUTED }}>
              <Brain size={11} className="mr-1 inline" style={{ color: OK }} /> hafızadan ·
              <Sparkles size={11} className="mx-1 inline" style={{ color: MOR }} /> yapay zekâ ·
              <Hand size={11} className="mx-1 inline" style={{ color: GOLD }} /> elle. Düzelttiğiniz satıcı bir daha sorulmaz.
            </span>
            <div className="flex gap-2">
              {hareketler.some((h) => h.onaylandi) && (
                <Dugme tur="tehlike" onClick={() => geriAl.mutate()} yukleniyor={geriAl.isPending}>
                  <Undo2 size={12} /> Onayı geri al
                </Dugme>
              )}
              <Dugme
                tur="birincil"
                renk={OK}
                onClick={() => onayla.mutate()}
                disabled={bekleyen.length === 0}
                yukleniyor={onayla.isPending}
              >
                <CheckCircle2 size={12} /> {bekleyen.length} hareketi bütçeye işle
              </Dugme>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
