'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Landmark, Pencil, Trash2, ArrowLeftRight, Receipt, Wallet, PiggyBank,
  AlertTriangle, ChevronLeft, ChevronRight, Link2, Building2,
} from 'lucide-react';
import {
  butceApi, BankaHesap, HesapHareket, Defter, OfisHesap,
  para, tarihTR, donemTR, buDonem, donemKaydir,
} from '@/lib/butce';
import {
  Kutu, KPI, Dugme, Modal, Alan, Girdi, Secim, Bos, Rozet, Yukleniyor,
  ParaGirdi, paraCoz, paraGiris, Anahtar, RenkSecici,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, MUTED, TEXT, ROW_SEP, CARD_BORDER,
} from './ui';

const DEFTERLER: Array<{ deger: Defter; etiket: string; renk: string }> = [
  { deger: 'SAHSI', etiket: 'Kişisel', renk: MAVI },
  { deger: 'OFIS', etiket: 'Ofis', renk: MOR },
];

const defterBilgi = (d?: string | null) => DEFTERLER.find((x) => x.deger === d) || null;

const KAYIT_TURU: Record<HesapHareket['kayitTuru'], { etiket: string; renk: string }> = {
  ISLEM: { etiket: 'işlem', renk: MUTED },
  ODEME: { etiket: 'ödeme', renk: TURUNCU },
  TRANSFER: { etiket: 'aktarım', renk: MAVI },
  // Cari Kasa'nın kaydı — burada yalnız okunur
  CARI_TAHSILAT: { etiket: 'tahsilat', renk: MOR },
};

const bugun = () => new Date().toISOString().slice(0, 10);

/** Hareketin ait olduğu ay ("2026-08"). Sunucu ISO metin dönerse dilim, Date dönerse ayrıştırır. */
const hareketDonemi = (tarih: string) => {
  const s = String(tarih || '');
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** KMH borcuna işleyen yaklaşık günlük faiz (aylık oran 30 güne bölünür). */
const gunlukFaiz = (h: BankaHesap) => (h.kmhBorcu * (h.kmhAylikFaiz || 0)) / 100 / 30;

export default function Hesaplar() {
  const qc = useQueryClient();
  const [hesapModal, setHesapModal] = useState<BankaHesap | 'yeni' | null>(null);
  const [aktarimAcik, setAktarimAcik] = useState(false);
  const [kasaModalAcik, setKasaModalAcik] = useState(false);
  const [hareketModal, setHareketModal] = useState<BankaHesap | null>(null);
  const [silModal, setSilModal] = useState<BankaHesap | null>(null);

  const { data: hesaplar = [], isLoading } = useQuery({
    queryKey: ['butce-hesaplar'],
    queryFn: butceApi.hesaplar,
  });

  // Nakit kasa: banka hesabı seçilmeden girilmiş hareketlerin toplamı.
  // "Hangi bankada ne kadar, kasada ne kadar" tek ekrandan görünsün.
  const kasaSorgu = useQuery({
    queryKey: ['butce-kasa'],
    queryFn: () => butceApi.kasa(),
    staleTime: 30_000,
  });

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['butce-hesaplar'] });
    qc.invalidateQueries({ queryKey: ['butce-kasa'] });
    qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    qc.invalidateQueries({ queryKey: ['butce-nakit-akis'] });
    qc.invalidateQueries({ queryKey: ['butce-hesap-hareketler'] });
  };

  const sil = useMutation({
    mutationFn: (id: string) => butceApi.hesapSil(id),
    onSuccess: (s) => {
      if (s.pasifeAlindi) {
        toast.warning(
          `Bu hesaba bağlı ${s.kullanim ?? 0} kayıt olduğu için hesap silinmedi, pasife alındı. Geçmiş kayıtlarınız duruyor.`,
          { duration: 8000 },
        );
      } else {
        toast.success('Hesap silindi');
      }
      setSilModal(null);
      tazele();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Silinemedi'),
  });

  const aktifler = useMemo(() => hesaplar.filter((h) => h.aktif), [hesaplar]);

  const toplamNakit = aktifler.reduce((t, h) => t + Math.max(h.bakiye, 0), 0);
  const toplamKmhBorc = aktifler.reduce((t, h) => t + h.kmhBorcu, 0);
  const toplamKullanilabilir = aktifler.reduce((t, h) => t + h.kullanilabilir, 0);
  const kmhSayisi = aktifler.filter((h) => h.tur === 'KMH').length;
  const toplamGunlukFaiz = aktifler.reduce((t, h) => t + gunlukFaiz(h), 0);

  // Pasif hesaplar listenin sonuna düşsün; aktif olanlar gözden kaçmasın.
  const sirali = useMemo(
    () => [...hesaplar].sort((a, b) => Number(b.aktif) - Number(a.aktif)),
    [hesaplar],
  );

  if (isLoading) return <Yukleniyor />;

  const kasa = kasaSorgu.data;
  const kasaVar = !!kasa && kasa.hareketSayisi > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KPI
          etiket="Toplam nakit"
          deger={`${para(toplamNakit + (kasa?.bakiye || 0))} ₺`}
          altBilgi={
            kasaVar
              ? `Bankada ${para(toplamNakit)} ₺ · kasada ${para(kasa!.bakiye)} ₺`
              : 'Artıda olan hesapların toplamı'
          }
          renk={OK}
          ikon={<Wallet size={13} />}
          vurgu
        />
        <KPI
          etiket="Toplam KMH borcu"
          deger={`${para(toplamKmhBorc)} ₺`}
          altBilgi={
            kmhSayisi === 0
              ? 'KMH hesabınız yok'
              : `${kmhSayisi} KMH hesabı · günlük yaklaşık ${para(toplamGunlukFaiz)} ₺ faiz`
          }
          renk={toplamKmhBorc > 0 ? KIRMIZI : MUTED}
          ikon={<AlertTriangle size={13} />}
        />
        <KPI
          etiket="Kullanılabilir"
          deger={`${para(toplamKullanilabilir + (kasa?.bakiye || 0))} ₺`}
          altBilgi={
            kasaVar
              ? `Bakiye + kasa + kalan KMH limiti`
              : 'Bakiye + kalan KMH limiti'
          }
          renk={GOLD}
          ikon={<PiggyBank size={13} />}
        />
      </div>

      <Kutu
        baslik="Banka hesaplarım"
        aciklama="Bakiyeler açılış tutarınızın üstüne işlenen hareketlerden hesaplanır."
        sag={
          <div className="flex flex-wrap items-center gap-2">
            <Dugme renk={MAVI} onClick={() => setAktarimAcik(true)} disabled={aktifler.length < 2}>
              <ArrowLeftRight size={13} /> Aktarım
            </Dugme>
            <Dugme tur="birincil" onClick={() => setHesapModal('yeni')}>
              <Plus size={13} /> Hesap ekle
            </Dugme>
          </div>
        }
      >
        {hesaplar.length === 0 ? (
          <Bos metin="Henüz banka hesabı eklenmedi." ikon={<Landmark size={18} />} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sirali.map((h) => {
              const renk = h.renk || GOLD;
              const kmh = h.tur === 'KMH';
              const doluluk = Math.min(Math.max(h.kmhDoluluk || 0, 0), 100);
              const dolulukRenk = doluluk > 80 ? KIRMIZI : doluluk > 50 ? TURUNCU : OK;
              const defter = defterBilgi(h.varsayilanDefter);
              return (
                <div
                  key={h.id}
                  className="relative overflow-hidden rounded-xl p-3"
                  style={{
                    background: `linear-gradient(150deg, ${renk}14, rgba(255,255,255,0.012) 55%)`,
                    border: `1px solid ${renk}33`,
                    opacity: h.aktif ? 1 : 0.55,
                  }}
                >
                  <div
                    className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full opacity-20"
                    style={{ background: `radial-gradient(circle, ${renk}, transparent 68%)` }}
                  />

                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: TEXT }}>
                        {h.bankaAdi} · {h.ad}
                        {!h.aktif && <Rozet metin="pasif" renk={MUTED} />}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                        {h.iban4 ? `**** ${h.iban4} · ` : ''}
                        {kmh ? 'Ek hesaplı (KMH)' : 'Vadesiz hesap'}
                      </div>
                    </div>
                    {defter && <Rozet metin={defter.etiket} renk={defter.renk} />}
                  </div>

                  <div className="mt-2">
                    <div
                      className="text-[20px] font-semibold leading-tight tabular-nums"
                      style={{ color: h.bakiye < 0 ? KIRMIZI : renk }}
                    >
                      {para(h.bakiye)} ₺
                    </div>
                    <div className="mt-0.5 text-[10.5px]" style={{ color: MUTED }}>
                      Kullanılabilir {para(h.kullanilabilir)} ₺
                    </div>
                  </div>

                  {kmh && (
                    <div
                      className="mt-2 rounded-lg px-2.5 py-2"
                      style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${ROW_SEP}` }}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: MUTED }}>
                        <span>Ek hesap kullanımı</span>
                        <span className="tabular-nums" style={{ color: dolulukRenk }}>
                          %{Math.round(doluluk)}
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                        style={{ background: 'rgba(255,255,255,0.06)' }}
                      >
                        <div style={{ width: `${doluluk}%`, height: '100%', background: dolulukRenk }} />
                      </div>
                      <div className="mt-1.5 text-[11px]" style={{ color: TEXT }}>
                        Borç {para(h.kmhBorcu)} ₺ · kalan {para(h.kmhKalanLimit)} ₺
                      </div>
                      <div
                        className="mt-0.5 text-[10.5px]"
                        style={{ color: h.kmhAylikFaiz > 0 ? (h.kmhBorcu > 0 ? TURUNCU : MUTED) : TURUNCU }}
                      >
                        {h.kmhAylikFaiz > 0
                          ? `Aylık faiz %${h.kmhAylikFaiz} · günlük ~${para(gunlukFaiz(h))} ₺`
                          : 'Faiz oranı girilmedi — öneriler TCMB azami kart faizinden tahmin edilir'}
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Dugme renk={MAVI} onClick={() => setHareketModal(h)}>
                      <Receipt size={12} /> Hareketler
                    </Dugme>
                    <Dugme onClick={() => setHesapModal(h)}>
                      <Pencil size={12} /> Düzenle
                    </Dugme>
                    <Dugme tur="tehlike" onClick={() => setSilModal(h)}>
                      <Trash2 size={12} /> Sil
                    </Dugme>
                  </div>
                </div>
              );
            })}

            {/* NAKİT KASA — ayrı bir hesap kaydı değil, hesap seçilmeden girilmiş
                hareketlerin toplamı. Banka kartlarıyla aynı yerde dursun ki
                "hangi bankada ne kadar, kasada ne kadar" tek bakışta görünsün. */}
            {kasaVar && (
              <div
                className="relative overflow-hidden rounded-xl p-3"
                style={{
                  background: `linear-gradient(150deg, ${MOR}14, rgba(255,255,255,0.012) 55%)`,
                  border: `1px dashed ${MOR}44`,
                }}
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full opacity-20"
                  style={{ background: `radial-gradient(circle, ${MOR}, transparent 68%)` }}
                />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div
                      className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold"
                      style={{ color: TEXT }}
                    >
                      <Wallet size={13} style={{ color: MOR }} /> Nakit kasa
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                      Hesap seçilmeden girilen hareketler
                    </div>
                  </div>
                  <Rozet metin={`${kasa!.hareketSayisi} kayıt`} renk={MOR} />
                </div>

                <div className="mt-2">
                  <div
                    className="text-[20px] font-semibold leading-tight tabular-nums"
                    style={{ color: kasa!.bakiye < 0 ? KIRMIZI : MOR }}
                  >
                    {para(kasa!.bakiye)} ₺
                  </div>
                  <div className="mt-0.5 text-[10.5px]" style={{ color: MUTED }}>
                    Giren {para(kasa!.giris)} ₺ · çıkan {para(kasa!.cikis)} ₺
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Dugme renk={MOR} onClick={() => setKasaModalAcik(true)}>
                    <Receipt size={12} /> Hareketler
                  </Dugme>
                </div>

                <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'rgba(113,113,122,0.9)' }}>
                  Bu paranın hangi bankada olduğunu bilmek isterseniz, ilgili kayıtları düzenleyip
                  ödeme kaynağına hesap seçin; tutar o hesabın bakiyesine geçer.
                </p>
              </div>
            )}
          </div>
        )}
      </Kutu>

      <OfisHesapKoprusu />

      {hesapModal && (
        <HesapModal
          hesap={hesapModal === 'yeni' ? null : hesapModal}
          kapat={() => setHesapModal(null)}
          kaydedildi={() => {
            setHesapModal(null);
            tazele();
          }}
        />
      )}

      {kasaModalAcik && <KasaHareketModal kapat={() => setKasaModalAcik(false)} />}

      {aktarimAcik && (
        <AktarimModal
          hesaplar={aktifler}
          kapat={() => setAktarimAcik(false)}
          tamamlandi={() => {
            setAktarimAcik(false);
            tazele();
          }}
        />
      )}

      {hareketModal && <HareketModal hesap={hareketModal} kapat={() => setHareketModal(null)} />}

      {silModal && (
        <Modal
          baslik={`${silModal.bankaAdi} ${silModal.ad} — sil`}
          aciklama="Silmeden önce bunu bilin."
          kapat={() => setSilModal(null)}
          genislik={480}
        >
          <div className="space-y-3">
            <div
              className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11.5px]"
              style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}30`, color: MUTED }}
            >
              <AlertTriangle size={13} style={{ color: TURUNCU }} className="mt-0.5 flex-shrink-0" />
              <span>
                Bu hesaba bağlı kayıt (işlem, ödeme veya aktarım) varsa hesap silinmez, pasife alınır.
                Geçmiş kayıtlarınız olduğu gibi kalır; hesap yalnızca yeni kayıt listelerinde çıkmaz.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Dugme tur="sade" onClick={() => setSilModal(null)}>
                Vazgeç
              </Dugme>
              <Dugme tur="tehlike" onClick={() => sil.mutate(silModal.id)} yukleniyor={sil.isPending}>
                <Trash2 size={12} /> Sil
              </Dugme>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ===================== HESAP MODALI ===================== */

/* ===================== CARİ KASA HESAP KÖPRÜSÜ ===================== */

/**
 * Aynı banka hesabı bugün iki yerde ayrı bakiye tutuyor: Cari Kasa'da ofis
 * hesabı, burada bütçe hesabı. Eşleştirme yapılınca bakiyenin tek sahibi bu
 * ekran olur; ofis hesabı "para hangi cüzdana girdi" etiketine döner.
 *
 * Eşleştirme ELLE yapılır. İsim benzerliğine bakan otomatik eşleştirme bilerek
 * yok: yanlış eşleşme bakiyeyi bozar ve fark aylar sonra anlaşılır.
 */
function OfisHesapKoprusu() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['butce-ofis-hesaplar'],
    queryFn: butceApi.ofisHesaplar,
    staleTime: 60_000,
  });

  const esle = useMutation({
    mutationFn: ({ id, hedef }: { id: string; hedef: string | null }) =>
      butceApi.ofisHesapEslestir(id, hedef),
    onSuccess: (s) => {
      toast.success(s.eslesti ? 'Hesap bağlandı' : 'Bağlantı kaldırıldı');
      qc.invalidateQueries({ queryKey: ['butce-ofis-hesaplar'] });
      qc.invalidateQueries({ queryKey: ['butce-hesaplar'] });
      qc.invalidateQueries({ queryKey: ['butce-ozet'] });
      qc.invalidateQueries({ queryKey: ['butce-islemler'] });
      qc.invalidateQueries({ queryKey: ['butce-nakit-akis'] });
      qc.invalidateQueries({ queryKey: ['butce-hesap-hareketler'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bağlanamadı', { duration: 8000 }),
  });

  if (isLoading) {
    return (
      <Kutu baslik="Cari Kasa hesap bağlantısı" renk={MOR}>
        <Yukleniyor metin="Ofis hesapları okunuyor…" />
      </Kutu>
    );
  }
  if (!data) return null;

  const bagli = data.hesaplar.filter((h) => h.butceBankaHesapId).length;
  const hesapsiz = data.hesabiSecilmemisTahsilat;

  return (
    <Kutu
      baslik="Cari Kasa hesap bağlantısı"
      aciklama="Müşteri tahsilatı Cari Kasa'da kalır; bağlanan hesabın bakiyesine buradan okunur."
      renk={MOR}
      sag={<Rozet metin={`${bagli}/${data.hesaplar.length} bağlı`} renk={bagli > 0 ? OK : MUTED} />}
    >
      {data.hesaplar.length === 0 ? (
        <Bos metin="Cari Kasa'da tanımlı ofis hesabı yok." ikon={<Building2 size={18} />} />
      ) : (
        <div className="space-y-2">
          {data.hesaplar.map((h) => (
            <OfisHesapSatiri
              key={h.id}
              hesap={h}
              butceHesaplar={data.butceHesaplar}
              kaydediliyor={esle.isPending}
              sec={(hedef) => esle.mutate({ id: h.id, hedef })}
            />
          ))}
        </div>
      )}

      {hesapsiz.adet > 0 && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11.5px]"
          style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}30`, color: MUTED }}
        >
          <AlertTriangle size={13} style={{ color: TURUNCU }} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong style={{ color: TURUNCU }}>{hesapsiz.adet} tahsilatta</strong> banka/kasa hesabı
            seçilmemiş (toplam {para(hesapsiz.toplam)} ₺). Paranın hangi cüzdana girdiği bilinmediği
            için hiçbir bakiyeye eklenmedi. Cari Kasa &gt; Tahsilat ekranından hesabı seçilince
            kendiliğinden görünür.
          </span>
        </div>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed" style={{ color: 'rgba(113,113,122,0.9)' }}>
        Kesim tarihi, bağladığınız bütçe hesabının <strong style={{ color: MUTED }}>açılış tarihidir</strong>.
        Öncesindeki tahsilatlar Cari Kasa'da arşiv kalır — açılış bakiyeniz o parayı zaten içerdiği
        için ikinci kez sayılmaz.
      </p>
    </Kutu>
  );
}

function OfisHesapSatiri({
  hesap,
  butceHesaplar,
  kaydediliyor,
  sec,
}: {
  hesap: OfisHesap;
  butceHesaplar: Array<{ id: string; ad: string; bankaAdi: string; kesimTarihiVar: boolean }>;
  kaydediliyor: boolean;
  sec: (hedef: string | null) => void;
}) {
  const bagli = !!hesap.butceBankaHesapId;
  const renk = bagli ? OK : MUTED;
  const disarida = hesap.tahsilatAdet - hesap.akanAdet;

  return (
    <div
      className="relative overflow-hidden rounded-xl px-3 py-2.5"
      style={{
        background: `linear-gradient(140deg, ${renk}12, rgba(255,255,255,0.012) 60%)`,
        border: `1px solid ${renk}2e`,
      }}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full opacity-20"
        style={{ background: `radial-gradient(circle, ${renk}, transparent 68%)` }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: TEXT }}>
            <Building2 size={13} style={{ color: hesap.renk || GOLD }} />
            {hesap.ad}
            {!hesap.aktif && <Rozet metin="pasif" renk={MUTED} />}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
            {hesap.tahsilatAdet === 0
              ? 'Bu hesaba girmiş tahsilat yok'
              : bagli
                ? `${hesap.akanAdet} tahsilat bütçeye akıyor · ${para(hesap.akanToplam)} ₺`
                : `${hesap.tahsilatAdet} tahsilat bekliyor · ${para(hesap.tahsilatToplam)} ₺`}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link2 size={13} style={{ color: renk }} />
          <Secim
            value={hesap.butceBankaHesapId || ''}
            disabled={kaydediliyor}
            onChange={(e) => sec(e.target.value || null)}
            style={{ minWidth: 220 }}
          >
            <option value="">— bağlı değil —</option>
            {butceHesaplar.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bankaAdi} · {b.ad}
                {b.kesimTarihiVar ? '' : ' (açılış tarihi yok)'}
              </option>
            ))}
          </Secim>
        </div>
      </div>

      {bagli && disarida > 0 && (
        <div className="mt-1.5 text-[10.5px]" style={{ color: 'rgba(113,113,122,0.9)' }}>
          Kesim tarihi {hesap.kesimTarihi ? tarihTR(hesap.kesimTarihi) : '—'} · öncesindeki {disarida}{' '}
          tahsilat ({para(hesap.tahsilatToplam - hesap.akanToplam)} ₺) arşivde kaldı.
        </div>
      )}
    </div>
  );
}

function HesapModal({
  hesap,
  kapat,
  kaydedildi,
}: {
  hesap: BankaHesap | null;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [form, setForm] = useState({
    ad: hesap?.ad || '',
    bankaAdi: hesap?.bankaAdi || '',
    iban4: hesap?.iban4 || '',
    tur: (hesap?.tur || 'VADESIZ') as 'VADESIZ' | 'KMH',
    acilisBakiye: paraGiris(Math.abs(hesap?.acilisBakiye ?? 0)),
    // Para girdisi eksi işareti kabul etmediği için işaret ayrı tutulur.
    acilisEksi: (hesap?.acilisBakiye ?? 0) < 0,
    acilisTarihi: hesap?.acilisTarihi?.slice(0, 10) || bugun(),
    kmhLimiti: paraGiris(hesap?.kmhLimiti),
    kmhAylikFaiz: hesap?.kmhAylikFaiz ? String(hesap.kmhAylikFaiz) : '',
    varsayilanDefter: (hesap?.varsayilanDefter || 'SAHSI') as Defter,
    renk: hesap?.renk || GOLD,
    aktif: hesap?.aktif ?? true,
  });

  const kmh = form.tur === 'KMH';
  const isaretGoster = kmh || form.acilisEksi;

  const kaydet = useMutation({
    mutationFn: () => {
      const body = {
        ad: form.ad.trim(),
        bankaAdi: form.bankaAdi.trim(),
        iban4: form.iban4.trim() || null,
        tur: form.tur,
        acilisBakiye: paraCoz(form.acilisBakiye) * (form.acilisEksi ? -1 : 1),
        acilisTarihi: form.acilisTarihi || null,
        kmhLimiti: kmh ? paraCoz(form.kmhLimiti) : 0,
        kmhAylikFaiz: kmh ? Number(String(form.kmhAylikFaiz).replace(',', '.') || 0) : 0,
        varsayilanDefter: form.varsayilanDefter,
        renk: form.renk,
        aktif: form.aktif,
      } as any;
      return hesap ? butceApi.hesapGuncelle(hesap.id, body) : butceApi.hesapEkle(body);
    },
    onSuccess: () => {
      toast.success('Hesap kaydedildi');
      kaydedildi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  return (
    <Modal
      baslik={hesap ? 'Hesabı düzenle' : 'Yeni banka hesabı'}
      aciklama="Hesabı tanımlayın; gelir, gider ve aktarımlar bu hesabın bakiyesine işlensin."
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
        <Alan etiket="Hesap adı">
          <Girdi
            autoFocus
            required
            value={form.ad}
            onChange={(e) => setForm({ ...form, ad: e.target.value })}
            placeholder="Örn. Maaş hesabı"
          />
        </Alan>
        <Alan etiket="Banka">
          <Girdi
            required
            value={form.bankaAdi}
            onChange={(e) => setForm({ ...form, bankaAdi: e.target.value })}
            placeholder="Örn. Ziraat"
          />
        </Alan>

        <Alan etiket="IBAN son 4 hane" ipucu="Hesapları birbirinden ayırmak için">
          <Girdi
            value={form.iban4}
            onChange={(e) => setForm({ ...form, iban4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            maxLength={4}
            inputMode="numeric"
            placeholder="1234"
          />
        </Alan>
        <Alan etiket="Hesap türü">
          <Secim value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value as 'VADESIZ' | 'KMH' })}>
            <option value="VADESIZ">Vadesiz hesap</option>
            <option value="KMH">Ek hesaplı (KMH)</option>
          </Secim>
        </Alan>

        <Alan
          etiket="Açılış bakiyesi"
          ipucu="Bugün hesabınızda ne kadar varsa onu yazın; sonraki hareketler bunun üstüne işlenir."
        >
          <div className="flex items-center gap-2">
            {isaretGoster && (
              <div className="flex flex-shrink-0 overflow-hidden rounded-lg" style={{ border: `1px solid ${CARD_BORDER}` }}>
                {[
                  { eksi: false, etiket: '+' },
                  { eksi: true, etiket: '−' },
                ].map((s) => {
                  const secili = form.acilisEksi === s.eksi;
                  const c = s.eksi ? KIRMIZI : OK;
                  return (
                    <button
                      key={s.etiket}
                      type="button"
                      onClick={() => setForm({ ...form, acilisEksi: s.eksi })}
                      className="px-2.5 py-[7px] text-[12px] transition"
                      style={{ background: secili ? `${c}22` : 'transparent', color: secili ? c : MUTED }}
                    >
                      {s.etiket}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex-1">
              <ParaGirdi value={form.acilisBakiye} onChange={(v) => setForm({ ...form, acilisBakiye: v })} />
            </div>
          </div>
        </Alan>
        <Alan etiket="Açılış tarihi" ipucu="Yalnız bilgi amaçlıdır; bakiye açılış tutarı + girdiğiniz hareketlerden hesaplanır">
          <Girdi
            type="date"
            value={form.acilisTarihi}
            onChange={(e) => setForm({ ...form, acilisTarihi: e.target.value })}
          />
        </Alan>

        {kmh && (
          <>
            <Alan etiket="KMH limiti" ipucu="Bankanın tanıdığı ek hesap limiti">
              <ParaGirdi value={form.kmhLimiti} onChange={(v) => setForm({ ...form, kmhLimiti: v })} />
            </Alan>
            <Alan etiket="Aylık faiz (%)" ipucu="Ek hesabı kullandığınızda işleyen aylık oran">
              <Girdi
                value={form.kmhAylikFaiz}
                onChange={(e) => setForm({ ...form, kmhAylikFaiz: e.target.value })}
                inputMode="decimal"
                placeholder="Örn. 4,25"
              />
            </Alan>
          </>
        )}

        <Alan etiket="Yeni kayıtta ön seçim" ipucu="Kısıt değildir: bu hesapla kayıt girerken defter olarak bu seçili gelir, her kayıtta değiştirebilirsiniz. Aynı hesabı hem şahsi hem ofis için kullanabilirsiniz.">
          <Secim
            value={form.varsayilanDefter}
            onChange={(e) => setForm({ ...form, varsayilanDefter: e.target.value as Defter })}
          >
            {DEFTERLER.map((d) => (
              <option key={d.deger} value={d.deger}>
                {d.etiket}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan etiket="Renk">
          <div className="pt-1.5">
            <RenkSecici deger={form.renk} degistir={(v) => setForm({ ...form, renk: v })} />
          </div>
        </Alan>

        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <span className="text-[11.5px]" style={{ color: MUTED }}>
            Hesap aktif · kapalı hesaplar listelerde ve toplamlarda görünmez
          </span>
          <Anahtar acik={form.aktif} degistir={(v) => setForm({ ...form, aktif: v })} />
        </div>

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
  const [form, setForm] = useState({
    tutar: '',
    tarih: bugun(),
    kaynakHesapId: hesaplar[0]?.id || '',
    hedefHesapId: hesaplar[1]?.id || '',
    kaynakDefter: (hesaplar[0]?.varsayilanDefter || 'SAHSI') as Defter,
    hedefDefter: (hesaplar[1]?.varsayilanDefter || 'SAHSI') as Defter,
    aciklama: '',
  });

  const kaynak = hesaplar.find((h) => h.id === form.kaynakHesapId) || null;
  const hedef = hesaplar.find((h) => h.id === form.hedefHesapId) || null;
  const ayniHesap = !!form.kaynakHesapId && form.kaynakHesapId === form.hedefHesapId;
  const tutar = paraCoz(form.tutar);
  const gecersiz = ayniHesap || tutar <= 0 || !form.kaynakHesapId || !form.hedefHesapId;

  // Hesap değişince o hesabın varsayılan defteri seçili gelsin; kullanıcı isterse değiştirir.
  const hesapSec = (alan: 'kaynak' | 'hedef', id: string) => {
    const h = hesaplar.find((x) => x.id === id);
    setForm((f) =>
      alan === 'kaynak'
        ? { ...f, kaynakHesapId: id, kaynakDefter: (h?.varsayilanDefter || f.kaynakDefter) as Defter }
        : { ...f, hedefHesapId: id, hedefDefter: (h?.varsayilanDefter || f.hedefDefter) as Defter },
    );
  };

  const aktar = useMutation({
    mutationFn: () =>
      butceApi.transfer({
        tutar,
        tarih: form.tarih,
        kaynakHesapId: form.kaynakHesapId,
        hedefHesapId: form.hedefHesapId,
        kaynakDefter: form.kaynakDefter,
        hedefDefter: form.hedefDefter,
        aciklama: form.aciklama.trim(),
      } as any),
    onSuccess: (s) => {
      toast.success(`${para(s.tutar)} ₺ aktarıldı`);
      tamamlandi();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Aktarım yapılamadı'),
  });

  return (
    <Modal
      baslik="Hesaplar arası aktarım"
      aciklama="Paranın bir hesaptan diğerine geçişi. Gelir ya da gider olarak sayılmaz."
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

        <Alan
          etiket="Kaynak hesap (paranın çıktığı)"
          ipucu={kaynak ? `Bakiye ${para(kaynak.bakiye)} ₺` : undefined}
        >
          <Secim value={form.kaynakHesapId} onChange={(e) => hesapSec('kaynak', e.target.value)}>
            <option value="">Seçiniz</option>
            {hesaplar.map((h) => (
              <option key={h.id} value={h.id}>
                {h.bankaAdi} · {h.ad}
                {h.iban4 ? ` (**** ${h.iban4})` : ''}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan
          etiket="Hedef hesap (paranın girdiği)"
          ipucu={hedef ? `Bakiye ${para(hedef.bakiye)} ₺` : undefined}
        >
          <Secim value={form.hedefHesapId} onChange={(e) => hesapSec('hedef', e.target.value)}>
            <option value="">Seçiniz</option>
            {hesaplar.map((h) => (
              <option key={h.id} value={h.id}>
                {h.bankaAdi} · {h.ad}
                {h.iban4 ? ` (**** ${h.iban4})` : ''}
              </option>
            ))}
          </Secim>
        </Alan>

        <Alan etiket="Kaynak defter">
          <Secim
            value={form.kaynakDefter}
            onChange={(e) => setForm({ ...form, kaynakDefter: e.target.value as Defter })}
          >
            {DEFTERLER.map((d) => (
              <option key={d.deger} value={d.deger}>
                {d.etiket}
              </option>
            ))}
          </Secim>
        </Alan>
        <Alan etiket="Hedef defter">
          <Secim
            value={form.hedefDefter}
            onChange={(e) => setForm({ ...form, hedefDefter: e.target.value as Defter })}
          >
            {DEFTERLER.map((d) => (
              <option key={d.deger} value={d.deger}>
                {d.etiket}
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

        {ayniHesap && (
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11.5px] sm:col-span-2"
            style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}30`, color: KIRMIZI }}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>Kaynak ve hedef aynı hesap olamaz. Farklı bir hesap seçin.</span>
          </div>
        )}

        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] sm:col-span-2"
          style={{ background: `${MAVI}12`, border: `1px solid ${MAVI}30`, color: MUTED }}
        >
          <ArrowLeftRight size={13} style={{ color: MAVI }} className="mt-0.5 flex-shrink-0" />
          <span>
            Aktarım gelir ya da gider sayılmaz; para bir hesaptan diğerine geçer, toplamlarınız değişmez.
            Aktarım gelir/gider sayılmaz.
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

/* ===================== HAREKETLER MODALI ===================== */

function HareketModal({ hesap, kapat }: { hesap: BankaHesap; kapat: () => void }) {
  const [donem, setDonem] = useState(buDonem());

  const { data: hareketler = [], isLoading } = useQuery({
    queryKey: ['butce-hesap-hareketleri', hesap.id],
    queryFn: () => butceApi.hesapHareketleri(hesap.id),
  });

  /* Yürüyen bakiye açılış bakiyesinden başlayıp tüm hareketler üzerinden ilerler;
     seçilen aydan önceki hareketler "dönem başı" tutarını verir. */
  const { satirlar, devir, giris, cikis } = useMemo(() => {
    const sirali = hareketler
      .map((h, i) => ({ h, i }))
      .sort((a, b) => {
        const fark = new Date(a.h.tarih).getTime() - new Date(b.h.tarih).getTime();
        return fark !== 0 ? fark : a.i - b.i;
      })
      .map((x) => x.h);

    let devirTutar = hesap.acilisBakiye || 0;
    const donemdekiler: HesapHareket[] = [];
    for (const h of sirali) {
      const d = hareketDonemi(h.tarih);
      if (d < donem) devirTutar += h.tutar;
      else if (d === donem) donemdekiler.push(h);
    }

    let yurur = devirTutar;
    const liste = donemdekiler.map((h) => {
      yurur += h.tutar;
      return { hareket: h, yurur };
    });

    return {
      satirlar: liste,
      devir: devirTutar,
      giris: donemdekiler.filter((h) => h.tutar > 0).reduce((t, h) => t + h.tutar, 0),
      cikis: donemdekiler.filter((h) => h.tutar < 0).reduce((t, h) => t + Math.abs(h.tutar), 0),
    };
  }, [hareketler, donem, hesap.acilisBakiye]);

  return (
    <Modal
      baslik={`${hesap.bankaAdi} ${hesap.ad} — hareketler`}
      aciklama={`Dönem başı ${para(devir)} ₺ · giren ${para(giris)} ₺ · çıkan ${para(cikis)} ₺`}
      kapat={kapat}
      genislik={880}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-1 rounded-xl px-1.5 py-1"
          style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CARD_BORDER}` }}
        >
          <button
            type="button"
            onClick={() => setDonem(donemKaydir(donem, -1))}
            className="rounded-lg p-1 transition hover:bg-white/[0.06]"
            style={{ color: MUTED }}
            aria-label="Önceki ay"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[110px] text-center text-[12.5px] font-medium" style={{ color: GOLD }}>
            {donemTR(donem)}
          </span>
          <button
            type="button"
            onClick={() => setDonem(donemKaydir(donem, 1))}
            className="rounded-lg p-1 transition hover:bg-white/[0.06]"
            style={{ color: MUTED }}
            aria-label="Sonraki ay"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>
          Güncel bakiye {para(hesap.bakiye)} ₺
        </span>
      </div>

      {isLoading ? (
        <Yukleniyor />
      ) : satirlar.length === 0 ? (
        <Bos metin={`${donemTR(donem)} döneminde bu hesapta hareket yok.`} ikon={<Receipt size={18} />} />
      ) : (
        <div className="max-h-[440px] overflow-y-auto pr-1">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12px]">
              <thead className="sticky top-0" style={{ background: '#0c0c0e' }}>
                <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                  <th className="pb-2 font-medium">Tarih</th>
                  <th className="pb-2 font-medium">Açıklama</th>
                  <th className="pb-2 font-medium">Defter</th>
                  <th className="pb-2 font-medium">Kayıt</th>
                  <th className="pb-2 text-right font-medium">Tutar</th>
                  <th className="pb-2 text-right font-medium">Yürüyen bakiye</th>
                </tr>
              </thead>
              <tbody>
                {satirlar.map(({ hareket: h, yurur }) => {
                  // Gelir tek havuz: sunucu gelir satırında defter göndermiyor
                  const defter = h.defter ? defterBilgi(h.defter) : null;
                  const tur = KAYIT_TURU[h.kayitTuru] || KAYIT_TURU.ISLEM;
                  const giren = h.tutar >= 0;
                  return (
                    <tr key={h.id} className="border-t" style={{ borderColor: ROW_SEP }}>
                      <td className="py-1.5 whitespace-nowrap tabular-nums" style={{ color: MUTED }}>
                        {tarihTR(h.tarih)}
                      </td>
                      <td className="py-1.5 pr-3" style={{ color: TEXT }}>
                        {h.aciklama}
                        {h.kategori && (
                          <span className="ml-1.5 text-[10.5px]" style={{ color: MUTED }}>
                            · {h.kategori}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{defter ? <Rozet metin={defter.etiket} renk={defter.renk} /> : '—'}</td>
                      <td className="py-1.5 pr-3">
                        <Rozet metin={tur.etiket} renk={tur.renk} />
                      </td>
                      <td
                        className="py-1.5 whitespace-nowrap text-right tabular-nums"
                        style={{ color: giren ? OK : KIRMIZI }}
                      >
                        {giren ? '+' : '−'}
                        {para(Math.abs(h.tutar))} ₺
                      </td>
                      <td
                        className="py-1.5 whitespace-nowrap text-right tabular-nums"
                        style={{ color: yurur < 0 ? KIRMIZI : TEXT }}
                      >
                        {para(yurur)} ₺
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Nakit kasadaki tüm hareketler.
 *
 * Kart üzerinde toplam listesi göstermek yanıltıyordu (kullanıcı onu kasanın
 * tamamı sanıyordu); ayrıntı artık istendiğinde açılan bu pencerede.
 */
function KasaHareketModal({ kapat }: { kapat: () => void }) {
  const [donem, setDonem] = useState<string>('');

  const { data: hareketler = [], isLoading } = useQuery({
    queryKey: ['butce-kasa-hareketler', donem],
    queryFn: () => butceApi.kasaHareketleri(donem || undefined),
  });

  const giren = hareketler.filter((h) => h.tur === 'GELIR').reduce((t, h) => t + h.tutar, 0);
  const cikan = hareketler.filter((h) => h.tur === 'GIDER').reduce((t, h) => t + h.tutar, 0);

  return (
    <Modal baslik="Nakit kasa hareketleri" kapat={kapat} genislik={720}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Alan etiket="Dönem" ipucu="Boş bırakırsanız tüm hareketler listelenir">
          <Girdi type="month" value={donem} onChange={(e) => setDonem(e.target.value)} />
        </Alan>
        <div className="flex gap-4 text-[12px]">
          <span style={{ color: MUTED }}>
            Giren{' '}
            <strong className="tabular-nums" style={{ color: OK }}>
              {para(giren)} ₺
            </strong>
          </span>
          <span style={{ color: MUTED }}>
            Çıkan{' '}
            <strong className="tabular-nums" style={{ color: KIRMIZI }}>
              {para(cikan)} ₺
            </strong>
          </span>
          <span style={{ color: MUTED }}>
            Kalan{' '}
            <strong className="tabular-nums" style={{ color: MOR }}>
              {para(giren - cikan)} ₺
            </strong>
          </span>
        </div>
      </div>

      <div className="mt-3">
        {isLoading ? (
          <Yukleniyor />
        ) : hareketler.length === 0 ? (
          <Bos metin="Bu dönemde kasa hareketi yok." ikon={<Receipt size={18} />} />
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {hareketler.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${ROW_SEP}` }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]" style={{ color: TEXT }}>
                    {h.aciklama || h.kategori?.ad || '—'}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
                    <span className="tabular-nums">{tarihTR(h.tarih)}</span>
                    {h.kategori?.ad && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          {h.kategori.renk && (
                            <i className="h-2 w-2 rounded-sm" style={{ background: h.kategori.renk }} />
                          )}
                          {h.kategori.ad}
                        </span>
                      </>
                    )}
                    {h.tur === 'GIDER' && (
                      <>
                        <span>·</span>
                        <span>{h.defter === 'OFIS' ? 'ofis' : 'kişisel'}</span>
                      </>
                    )}
                  </span>
                </span>
                <span
                  className="flex-shrink-0 text-[13px] font-semibold tabular-nums"
                  style={{ color: h.tur === 'GELIR' ? OK : KIRMIZI }}
                >
                  {h.tur === 'GELIR' ? '+' : '−'}
                  {para(h.tutar)} ₺
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed" style={{ color: 'rgba(113,113,122,0.9)' }}>
        Bu hareketler bir banka hesabına bağlanmadığı için kasada görünür. Bir kaydı düzenleyip ödeme
        kaynağına hesap seçerseniz tutar o hesabın bakiyesine geçer ve kasadan düşer.
      </p>
    </Modal>
  );
}
