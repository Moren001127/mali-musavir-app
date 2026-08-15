'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, CreditCard, Upload, Pencil, Trash2, CheckCircle2, Undo2, FileText,
  Sparkles, Brain, Hand, CalendarClock, AlertTriangle,
} from 'lucide-react';
import {
  butceApi, Kart, Ekstre, KartHareket, Kategori, Defter, DEFTER_ETIKET,
  para, tarihTR, buDonem, EKSTRE_DURUM_ETIKET,
} from '@/lib/butce';
import {
  Kutu, Dugme, Modal, Alan, Girdi, Secim, Bos, Rozet, Yukleniyor, ParaGirdi, paraCoz, paraGiris,
  Anahtar,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, MUTED, TEXT, ROW_SEP, CARD_BORDER,
} from './ui';

/* ===================== YARDIMCILAR ===================== */

/** Ekstre aralığı gün.ay olarak yazılır: "08.07 – 07.08" */
const gunAy = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) : '';

/* "22.08'de kesilecek" — bulunma eki ayın okunuşuna göre değişir
 * (…sekiz → 'de, …dokuz → 'da), sabit ek yazınca cümle bozuluyor. */
const AY_EKI: Record<number, string> = {
  1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da',
  7: 'de', 8: 'de', 9: 'da', 10: 'da', 11: 'de', 12: 'de',
};
const gunAyEkli = (d?: string | Date | null) => {
  if (!d) return '';
  const t = new Date(d);
  return `${gunAy(t)}'${AY_EKI[t.getMonth() + 1] || 'de'}`;
};

/** Kullanıcı dönem kodundan çok "hangi harcamalar" diye bakıyor; aralık yoksa döneme düşeriz. */
const ekstreAralik = (e: Ekstre) =>
  e.harcamaBaslangic && e.harcamaBitis
    ? `${gunAy(e.harcamaBaslangic)} – ${gunAy(e.harcamaBitis)} harcamaları`
    : `${e.donem} dönemi`;

/* Sunucu 'ASGARI_ODENDI' durumunu döndürüyor ama lib'deki eşlemede yok; eşleme
 * bulunamayınca rozet çöküyordu. Asgarisi ödenmiş ekstre GECİKME DEĞİLDİR,
 * bu yüzden uyarı rengi (turuncu/kırmızı) değil mavi gösterilir. */
const DURUM_ETIKET: Record<string, { etiket: string; renk: string }> = {
  ...EKSTRE_DURUM_ETIKET,
  ASGARI_ODENDI: { etiket: 'Asgari ödendi', renk: MAVI },
};
const durumBilgi = (d?: string | null) =>
  (d && DURUM_ETIKET[d]) || { etiket: String(d || '—'), renk: MUTED };

const DEFTERLER: Array<{ deger: Defter; etiket: string }> = [
  { deger: 'SAHSI', etiket: DEFTER_ETIKET.SAHSI },
  { deger: 'OFIS', etiket: DEFTER_ETIKET.OFIS },
];

/** Sunucu hareketin defterini gönderiyor; lib tipinde alan henüz tanımlı değil. */
type Hareket = KartHareket & { defter?: Defter | null };

export default function Kartlar() {
  const qc = useQueryClient();
  const [kartModal, setKartModal] = useState<Kart | 'yeni' | null>(null);
  const [ekstreModal, setEkstreModal] = useState<{ kart: Kart; ekstre: Ekstre } | null>(null);
  const [pdfModal, setPdfModal] = useState<Kart | null>(null);
  const [hareketModal, setHareketModal] = useState<{ kart: Kart; ekstreId: string } | null>(null);
  const [silModal, setSilModal] = useState<Kart | null>(null);

  const { data: kartlar = [], isLoading } = useQuery({ queryKey: ['butce-kartlar'], queryFn: butceApi.kartlar });

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['butce-kartlar'] });
    qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    qc.invalidateQueries({ queryKey: ['butce-plan'] });
    qc.invalidateQueries({ queryKey: ['butce-islemler'] });
  };

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
              const guncelBorc = k.guncelBorc ?? k.kalanBorc ?? 0;
              // Limit dolulugu ekstre borcu + dönem içi harcamanın toplamına göre; sunucu
              // vermezse yerelde aynı hesabı yaparız.
              const kullanimOran =
                k.limitDoluluk ?? (k.kartLimiti > 0 ? Math.min((guncelBorc / k.kartLimiti) * 100, 100) : 0);
              const e = k.guncelEkstre;
              const durum = e ? durumBilgi(e.durum) : null;
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
                        onClick={() => setSilModal(k)}
                        className="rounded-md p-1 transition hover:bg-white/[0.08]"
                        style={{ color: KIRMIZI }}
                        title="Sil"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Bankadaki gibi üç rakam: şimdi ödenecek olan, henüz ekstreye girmemiş
                      olan ve ikisinin toplamı. Tek rakam gösterince "ne kadar ödeyeceğim"
                      sorusu cevapsız kalıyordu. */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className="text-[11px]"
                        style={{ color: MUTED }}
                        title="Kesilen ekstrenin ödenmemiş kısmı — son ödeme tarihinde bu tutar ödenir."
                      >
                        Ekstre borcu <span style={{ color: 'rgba(113,113,122,0.75)' }}>· ödenecek</span>
                      </span>
                      <span className="text-[12.5px] tabular-nums" style={{ color: TEXT }}>
                        {para(k.ekstreBorcu ?? 0)} ₺
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className="text-[11px]"
                        style={{ color: MUTED }}
                        title="Son kesimden bugüne yapılan harcama. Gelecek ekstreye gider, şimdi ödenmez."
                      >
                        Dönem içi harcama{' '}
                        <span style={{ color: 'rgba(113,113,122,0.75)' }}>
                          · {gunAy(k.donemIciBaslangic) || '—'} – bugün
                        </span>
                      </span>
                      <span className="text-[12.5px] tabular-nums" style={{ color: TEXT }}>
                        {para(k.donemIciHarcama ?? 0)} ₺
                      </span>
                    </div>
                    <div
                      className="flex items-end justify-between gap-3 border-t pt-1.5"
                      style={{ borderColor: ROW_SEP }}
                    >
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                          Güncel borç
                        </div>
                        <div className="text-[20px] font-semibold tabular-nums" style={{ color: renk }}>
                          {para(guncelBorc)} ₺
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
                          <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: MUTED }}>
                            <CalendarClock size={12} className="flex-shrink-0" />
                            {ekstreAralik(e)} · son ödeme {tarihTR(e.sonOdemeTarihi)}
                          </span>
                          {durum && <Rozet metin={durum.etiket} renk={durum.renk} />}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="text-[13px] tabular-nums" style={{ color: TEXT }}>
                            {e.borcTutari === null ? (
                              e.kesilmedi ? (
                                /* Kesim günü daha gelmedi — eksik veri değil, uyarı rengi kullanılmaz */
                                <span style={{ color: MUTED }}>
                                  {gunAyEkli(e.kesimTarihi)} kesilecek
                                </span>
                              ) : (
                                <span style={{ color: TURUNCU }}>Ekstre tutarı girilmedi</span>
                              )
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
      <EkstreGecmisi kartlar={kartlar} />

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

      {silModal && (
        <KartSilModal
          kart={silModal}
          kapat={() => setSilModal(null)}
          silindi={() => {
            setSilModal(null);
            tazele();
            qc.invalidateQueries({ queryKey: ['butce-ekstreler'] });
          }}
        />
      )}
    </div>
  );
}

/* ===================== KART SİLME ONAYI ===================== */

function KartSilModal({ kart, kapat, silindi }: { kart: Kart; kapat: () => void; silindi: () => void }) {
  // Tek tıkla silinip geri alınamadığı için önce ne kaybedileceğini sayıyoruz.
  const [eminMi, setEminMi] = useState(false);

  const { data: ozet, isLoading } = useQuery({
    queryKey: ['butce-kart-silme-ozeti', kart.id],
    queryFn: async () => {
      // Kart listesi yalnız son birkaç ekstreyi taşır; gerçek sayı için ekstre ucunu sorarız.
      const ekstreler = await butceApi.ekstreler(kart.id);
      const hareketListeleri = await Promise.all(
        ekstreler.map((e) => butceApi.hareketler(e.id).catch(() => [] as KartHareket[])),
      );
      return {
        ekstre: ekstreler.length,
        hareket: hareketListeleri.reduce((t, h) => t + h.length, 0),
        odemeli: ekstreler.filter((e) => e.odenenTutar > 0).length,
      };
    },
  });

  const sil = useMutation({
    mutationFn: () => butceApi.kartSil(kart.id),
    onSuccess: () => {
      toast.success('Kart ve bağlı kayıtları silindi');
      silindi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Silinemedi'),
  });

  const ekstreSayisi = ozet?.ekstre ?? kart.ekstreler.length;

  return (
    <Modal
      baslik={`${kart.bankaAdi} ${kart.kartAdi} — kartı sil`}
      aciklama="Silmeden önce nelerin gideceğini okuyun."
      kapat={kapat}
      genislik={480}
    >
      <div className="space-y-3">
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11.5px]"
          style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}30`, color: MUTED }}
        >
          <AlertTriangle size={13} style={{ color: KIRMIZI }} className="mt-0.5 flex-shrink-0" />
          <div className="space-y-1.5">
            <div style={{ color: TEXT }}>Bu işlem geri alınamaz.</div>
            {isLoading ? (
              <div>Silinecek kayıtlar sayılıyor…</div>
            ) : (
              <ul className="list-disc space-y-0.5 pl-4">
                <li>
                  <b style={{ color: TEXT }}>{ekstreSayisi}</b> ekstre
                  {ozet && ozet.odemeli > 0 && <> (bunların {ozet.odemeli} tanesinde ödeme kaydı var)</>}
                </li>
                <li>
                  <b style={{ color: TEXT }}>{ozet?.hareket ?? 0}</b> ekstre hareketi
                </li>
                <li>Karta ait ödeme geçmişi ve hatırlatmalar</li>
              </ul>
            )}
            <div>Kartı silmek yerine düzenleyip “pasif” yaparsanız geçmiş kayıtlarınız durur.</div>
          </div>
        </div>

        {eminMi && (
          <div className="text-[11.5px]" style={{ color: KIRMIZI }}>
            Son adım: onaylarsanız yukarıdaki kayıtlar kalıcı olarak silinir.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Dugme tur="sade" onClick={kapat}>
            Vazgeç
          </Dugme>
          {!eminMi ? (
            <Dugme tur="tehlike" onClick={() => setEminMi(true)}>
              <Trash2 size={12} /> Kartı sil
            </Dugme>
          ) : (
            <Dugme tur="birincil" renk={KIRMIZI} onClick={() => sil.mutate()} yukleniyor={sil.isPending}>
              <Trash2 size={12} /> Evet, kalıcı olarak sil
            </Dugme>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ===================== GEÇMİŞ EKSTRELER ===================== */

function EkstreGecmisi({ kartlar }: { kartlar: Kart[] }) {
  const { data: ekstreler = [] } = useQuery({ queryKey: ['butce-ekstreler'], queryFn: () => butceApi.ekstreler() });

  /* Banka ekstresindeki dönem borcu önceki ayın devrini zaten içerir. Bu yüzden borç,
   * tutarı girilmiş EN SON ekstreden okunur; ondan eski ödenmemiş ekstreler o tutarın
   * içinde erimiştir ("devretti") ve toplama ikinci kez girmez. */
  const borcDonemi = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of kartlar) if (k.borcEkstresi) m.set(k.id, k.borcEkstresi.donem);
    return m;
  }, [kartlar]);

  if (ekstreler.length === 0) return null;
  return (
    <Kutu
      baslik="Ekstre geçmişi"
      aciklama="Son 60 ekstre · “devretti” işaretli olanlar bir sonraki ekstrede toplandığı için güncel borca ayrıca eklenmez."
      renk={MAVI}
    >
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
              const d = durumBilgi(e.durum);
              const borcDonem = borcDonemi.get(e.kartId);
              const devretti =
                e.devretti === true ||
                (!!borcDonem && e.donem < borcDonem && e.durum !== 'ODENDI');
              const devirNotu =
                'Bu ekstrenin kalanı bir sonraki ekstreye devretti; güncel borç toplamına ayrıca eklenmez.';
              return (
                <tr
                  key={e.id}
                  className="border-t"
                  style={{ borderColor: ROW_SEP, opacity: devretti ? 0.62 : 1 }}
                  title={devretti ? devirNotu : undefined}
                >
                  <td className="py-2" style={{ color: TEXT }}>
                    {e.kart?.bankaAdi} {e.kart?.kartAdi}
                  </td>
                  <td className="py-2" style={{ color: MUTED }}>
                    <span className="flex flex-col leading-tight">
                      <span>{e.donem}</span>
                      {e.harcamaBaslangic && e.harcamaBitis && (
                        <span className="text-[10px]" style={{ color: 'rgba(113,113,122,0.8)' }}>
                          {gunAy(e.harcamaBaslangic)} – {gunAy(e.harcamaBitis)} harcamaları
                        </span>
                      )}
                    </span>
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
                    <span className="inline-flex items-center justify-end gap-1">
                      {devretti && (
                        <span title={devirNotu}>
                          <Rozet metin="devretti" renk={MUTED} />
                        </span>
                      )}
                      <Rozet metin={d.etiket} renk={d.renk} />
                    </span>
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
    kartLimiti: paraGiris(kart?.kartLimiti),
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
        // Sunucu bu alanı her kayıtta yeniden doğruluyor; göndermezsek kartın defteri
        // düzenleme sırasında sessizce "Şahsi"ye dönüyor.
        varsayilanDefter: kart?.varsayilanDefter || 'SAHSI',
        bankaAdi: form.bankaAdi,
        kartAdi: form.kartAdi,
        sonDortHane: form.sonDortHane,
        kartLimiti: paraCoz(form.kartLimiti),
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
        <Alan etiket="Kart limiti">
          <ParaGirdi value={form.kartLimiti} onChange={(v) => setForm({ ...form, kartLimiti: v })} />
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
  const [borc, setBorc] = useState(paraGiris(ekstre.borcTutari));
  const [odeme, setOdeme] = useState('');
  const [hesapId, setHesapId] = useState('');

  const { data: hesaplar = [] } = useQuery({ queryKey: ['butce-hesaplar'], queryFn: butceApi.hesaplar });
  const aktifHesaplar = hesaplar.filter((h) => h.aktif);

  const tutarKaydet = useMutation({
    mutationFn: () => butceApi.ekstreTutar(ekstre.id, { borcTutari: paraCoz(borc) }),
    onSuccess: () => {
      toast.success('Ekstre tutarı kaydedildi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  const odemeKaydet = useMutation({
    mutationFn: () =>
      butceApi.ekstreOdeme(ekstre.id, {
        tutar: paraCoz(odeme),
        // Hesap seçilmezse ödeme eskisi gibi hesapsız işlenir.
        bankaHesapId: hesapId || undefined,
      }),
    onSuccess: () => {
      toast.success('Ödeme işlendi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlenemedi'),
  });

  const asgariTahmin = borc ? (paraCoz(borc) * kart.asgariOran) / 100 : 0;

  return (
    <Modal
      baslik={`${kart.bankaAdi} ${kart.kartAdi} — ${ekstre.donem}`}
      aciklama={`Kesim ${tarihTR(ekstre.kesimTarihi)} · Son ödeme ${tarihTR(ekstre.sonOdemeTarihi)}`}
      kapat={kapat}
    >
      <div className="space-y-4">
        <div>
          <Alan etiket="Ekstre borç tutarı" ipucu={borc ? `Asgari (%${kart.asgariOran}): ${para(asgariTahmin)} ₺` : undefined}>
            <ParaGirdi autoFocus value={borc} onChange={setBorc} />
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Alan etiket="Ödeme tutarı">
                <ParaGirdi value={odeme} onChange={setOdeme} />
              </Alan>
              {/* Hesap tanımlı değilse alan hiç görünmesin */}
              {aktifHesaplar.length > 0 && (
                <Alan etiket="Hangi hesaptan ödendi" ipucu="Seçerseniz ödeme o hesabın bakiyesinden düşer">
                  <Secim value={hesapId} onChange={(ev) => setHesapId(ev.target.value)}>
                    <option value="">Belirtmeyeyim</option>
                    {aktifHesaplar.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.bankaAdi} · {h.ad}
                      </option>
                    ))}
                  </Secim>
                </Alan>
              )}
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Dugme onClick={() => setOdeme(paraGiris(ekstre.asgariTutar ?? 0))}>Asgari</Dugme>
              <Dugme onClick={() => setOdeme(paraGiris(ekstre.kalanTutar ?? 0))}>Tamamı</Dugme>
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
  const [hepsineUygula, setHepsineUygula] = useState(true);
  const { data: hamHareketler = [], isLoading, refetch } = useQuery({
    queryKey: ['butce-hareketler', ekstreId],
    queryFn: () => butceApi.hareketler(ekstreId),
  });
  const hareketler = hamHareketler as Hareket[];
  const { data: kategoriler = [] } = useQuery({ queryKey: ['butce-kategoriler'], queryFn: () => butceApi.kategoriler() });

  const kategoriDegistir = useMutation({
    mutationFn: (p: { id: string; kategoriId: string }) => butceApi.hareketKategori(p.id, p.kategoriId, true),
    onSuccess: () => {
      refetch();
      toast.success('Kategori güncellendi ve öğrenildi');
    },
  });

  const defterDegistir = useMutation({
    mutationFn: (p: { id: string; defter: Defter }) => butceApi.hareketDefter(p.id, p.defter, hepsineUygula),
    onSuccess: () => {
      refetch();
      toast.success(hepsineUygula ? 'Defter değişti, aynı satıcının hepsine uygulandı' : 'Defter değişti');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Defter değiştirilemedi'),
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
      genislik={920}
    >
      {isLoading ? (
        <Yukleniyor />
      ) : hareketler.length === 0 ? (
        <Bos metin="Bu ekstrede hareket yok. PDF yükleyerek hareketleri okutabilirsiniz." />
      ) : (
        <>
          <div className="mb-2 flex items-center justify-end gap-2 text-[11px]" style={{ color: MUTED }}>
            <span>Defter değişikliğini aynı satıcının tüm hareketlerine uygula</span>
            <Anahtar acik={hepsineUygula} degistir={setHepsineUygula} renk={MAVI} />
          </div>

          <div className="max-h-[440px] overflow-y-auto pr-1">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0" style={{ background: '#0c0c0e' }}>
                <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                  <th className="pb-2 font-medium">Tarih</th>
                  <th className="pb-2 font-medium">Açıklama</th>
                  <th className="pb-2 text-right font-medium">Tutar</th>
                  <th className="pb-2 font-medium">Kategori</th>
                  <th className="pb-2 font-medium">Defter</th>
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
                    <td className="py-1.5 pl-2">
                      <Secim
                        value={h.defter || kart.varsayilanDefter || 'SAHSI'}
                        disabled={h.onaylandi}
                        onChange={(ev) => defterDegistir.mutate({ id: h.id, defter: ev.target.value as Defter })}
                        style={{ padding: '4px 6px', fontSize: 11.5, minWidth: 76 }}
                        title="Bu harcama şahsi mi, ofis mi?"
                      >
                        {DEFTERLER.map((d) => (
                          <option key={d.deger} value={d.deger}>
                            {d.etiket}
                          </option>
                        ))}
                      </Secim>
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
