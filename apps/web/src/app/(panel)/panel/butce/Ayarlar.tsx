'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, ShieldCheck, Bell, MessageCircle, Mail, Wallet, Target,
  Clock, Check, TrendingUp, TrendingDown,
} from 'lucide-react';
import { butceApi, Kategori, para } from '@/lib/butce';
import {
  Kutu, Dugme, Alan, Girdi, Secim, Rozet, Yukleniyor, ParaGirdi, paraCoz, paraGiris,
  Anahtar, RenkSecici, PALET,
  GOLD, OK, KIRMIZI, MAVI, MOR, MUTED, TEXT, ROW_SEP, CARD_BORDER,
} from './ui';

export default function Ayarlar() {
  const qc = useQueryClient();
  const { data: ayar, isLoading } = useQuery({ queryKey: ['butce-ayar'], queryFn: butceApi.ayar });
  const { data: kategoriler = [] } = useQuery({ queryKey: ['butce-kategoriler'], queryFn: () => butceApi.kategoriler() });

  const [form, setForm] = useState({
    nakitYastigi: '',
    strateji: 'CIG' as 'CIG' | 'KARTOPU',
    hatirlatmaWhatsapp: true,
    hatirlatmaPortal: true,
    hatirlatmaEmail: false,
    whatsappNumara: '',
    sabahSaati: '9',
  });
  const [ilkHal, setIlkHal] = useState('');

  useEffect(() => {
    if (!ayar) return;
    const y = {
      nakitYastigi: paraGiris(ayar.nakitYastigi),
      strateji: ayar.strateji,
      hatirlatmaWhatsapp: ayar.hatirlatmaWhatsapp,
      hatirlatmaPortal: ayar.hatirlatmaPortal,
      hatirlatmaEmail: ayar.hatirlatmaEmail,
      whatsappNumara: ayar.whatsappNumara || '',
      sabahSaati: String(ayar.sabahSaati ?? 9),
    };
    setForm(y);
    setIlkHal(JSON.stringify(y));
  }, [ayar]);

  const degisti = useMemo(() => ilkHal !== '' && JSON.stringify(form) !== ilkHal, [form, ilkHal]);

  const kaydet = useMutation({
    mutationFn: () =>
      butceApi.ayarKaydet({
        nakitYastigi: paraCoz(form.nakitYastigi),
        strateji: form.strateji,
        hatirlatmaWhatsapp: form.hatirlatmaWhatsapp,
        hatirlatmaPortal: form.hatirlatmaPortal,
        hatirlatmaEmail: form.hatirlatmaEmail,
        whatsappNumara: form.whatsappNumara,
        sabahSaati: Number(form.sabahSaati),
      }),
    onSuccess: () => {
      toast.success('Ayarlar kaydedildi');
      setIlkHal(JSON.stringify(form));
      qc.invalidateQueries({ queryKey: ['butce-ayar'] });
      qc.invalidateQueries({ queryKey: ['butce-plan'] });
      qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  if (isLoading || !ayar) return <Yukleniyor />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* ===== Plan ayarları ===== */}
      <Kutu baslik="Plan ayarları" aciklama="Ödeme planı bu iki değere göre hesaplanır.">
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <Alan etiket="Nakit yastığı" ipucu="Acil durum için dokunulmayacak tutar; borç kapasitesinden düşülür.">
              <ParaGirdi
                value={form.nakitYastigi}
                onChange={(v) => setForm({ ...form, nakitYastigi: v })}
              />
            </Alan>
            {paraCoz(form.nakitYastigi) > 0 && (
              <p className="mt-1.5 text-[10.5px]" style={{ color: MUTED }}>
                Aylık kapasiteden {para(paraCoz(form.nakitYastigi))} ₺ ayrılacak.
              </p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-medium" style={{ color: MUTED }}>
              Varsayılan strateji
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                {
                  deger: 'CIG' as const,
                  ad: 'Çığ yöntemi',
                  ozet: 'En yüksek faizli borç önce kapanır',
                  fayda: 'Matematiksel olarak en az faiz',
                  ikon: TrendingDown,
                  renk: OK,
                },
                {
                  deger: 'KARTOPU' as const,
                  ad: 'Kartopu yöntemi',
                  ozet: 'En küçük borç önce kapanır',
                  fayda: 'Hızlı kapanan borç motive eder',
                  ikon: Target,
                  renk: MAVI,
                },
              ]).map((s) => {
                const secili = form.strateji === s.deger;
                const Ikon = s.ikon;
                return (
                  <button
                    key={s.deger}
                    type="button"
                    onClick={() => setForm({ ...form, strateji: s.deger })}
                    className="relative rounded-xl px-3.5 py-3 text-left transition"
                    style={{
                      background: secili ? `${s.renk}12` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${secili ? `${s.renk}4d` : ROW_SEP}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: secili ? s.renk : TEXT }}>
                        <Ikon size={13} /> {s.ad}
                      </span>
                      {secili && <Check size={13} style={{ color: s.renk }} />}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug" style={{ color: MUTED }}>
                      {s.ozet}
                    </div>
                    <div className="mt-1 text-[10.5px]" style={{ color: secili ? s.renk : 'rgba(113,113,122,0.8)' }}>
                      {s.fayda}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Kutu>

      {/* ===== Hatırlatmalar ===== */}
      <Kutu
        baslik="Hatırlatmalar"
        aciklama="Ekstre kesildiğinde, tutar girilmediğinde ve son ödeme yaklaştığında haber verilir."
        renk={MAVI}
        sag={<Bell size={14} style={{ color: MAVI }} />}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          {/* Kanallar */}
          <div className="space-y-1.5">
            {[
              {
                alan: 'hatirlatmaWhatsapp' as const,
                ad: 'WhatsApp mesajı',
                aciklama: 'Anında telefonunuza düşer',
                ikon: MessageCircle,
                renk: OK,
              },
              {
                alan: 'hatirlatmaPortal' as const,
                ad: 'Portal bildirimi',
                aciklama: 'Üstteki bildirim zilinde birikir',
                ikon: Bell,
                renk: GOLD,
              },
              {
                alan: 'hatirlatmaEmail' as const,
                ad: 'E-posta',
                aciklama: 'Ofis e-posta adresinize gönderilir',
                ikon: Mail,
                renk: MOR,
              },
            ].map((k) => {
              const Ikon = k.ikon;
              const acik = form[k.alan];
              return (
                <div
                  key={k.alan}
                  className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                  style={{
                    background: acik ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.012)',
                    border: `1px solid ${ROW_SEP}`,
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: acik ? `${k.renk}16` : 'rgba(255,255,255,0.04)',
                        color: acik ? k.renk : MUTED,
                        border: `1px solid ${acik ? `${k.renk}33` : 'transparent'}`,
                      }}
                    >
                      <Ikon size={13} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px]" style={{ color: acik ? TEXT : MUTED }}>
                        {k.ad}
                      </span>
                      <span className="block truncate text-[10.5px]" style={{ color: 'rgba(113,113,122,0.85)' }}>
                        {k.aciklama}
                      </span>
                    </span>
                  </span>
                  <Anahtar acik={acik} degistir={(v) => setForm({ ...form, [k.alan]: v })} renk={k.renk} />
                </div>
              );
            })}
          </div>

          {/* Alıcı bilgileri */}
          <div className="space-y-3">
            <Alan etiket="WhatsApp numarası" ipucu="Boş bırakırsanız portalda tanımlı numara kullanılır">
              <Girdi
                value={form.whatsappNumara}
                onChange={(e) => setForm({ ...form, whatsappNumara: e.target.value.replace(/[^\d]/g, '') })}
                placeholder="905xxxxxxxxx"
                inputMode="numeric"
                disabled={!form.hatirlatmaWhatsapp}
                style={{ opacity: form.hatirlatmaWhatsapp ? 1 : 0.45 }}
              />
            </Alan>
            <Alan etiket="Hatırlatma saati" ipucu="Günlük tarama her sabah bu saatte çalışır">
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: MUTED }} />
                <Secim
                  value={form.sabahSaati}
                  onChange={(e) => setForm({ ...form, sabahSaati: e.target.value })}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>
                      {String(i).padStart(2, '0')}:00
                    </option>
                  ))}
                </Secim>
              </div>
            </Alan>
          </div>
        </div>
      </Kutu>

      {/* ===== Tek kaydet çubuğu ===== */}
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
        style={{
          background: degisti ? `${GOLD}0f` : 'rgba(255,255,255,0.018)',
          border: `1px solid ${degisti ? `${GOLD}38` : CARD_BORDER}`,
        }}
      >
        <span className="text-[11.5px]" style={{ color: degisti ? GOLD : MUTED }}>
          {degisti ? 'Kaydedilmemiş değişiklik var.' : 'Tüm ayarlar kayıtlı.'}
        </span>
        <Dugme tur="birincil" onClick={() => kaydet.mutate()} disabled={!degisti} yukleniyor={kaydet.isPending}>
          <Check size={13} /> Ayarları kaydet
        </Dugme>
      </div>

      <KategoriYonetimi kategoriler={kategoriler} />

      <Kutu baslik="Gizlilik" renk={OK} sag={<ShieldCheck size={14} style={{ color: OK }} />}>
        <p className="text-[12px] leading-relaxed" style={{ color: MUTED }}>
          Bu modül yalnız sizin kullanıcınıza açıktır. Başka bir kullanıcı — yönetici yetkisi olsa bile — bu
          sayfayı menüde göremez, adres çubuğuna yazsa dahi verilere erişemez; sunucu bu istekleri
          “sayfa bulunamadı” diye yanıtlar. Ayrıca modül her açılışta 6 haneli şifre sorar ve bildirimler
          yalnız sizin kullanıcınıza, yukarıdaki numaraya gider.
        </p>
      </Kutu>
    </div>
  );
}

/* ===================== KATEGORİLER ===================== */

function KategoriYonetimi({ kategoriler }: { kategoriler: Kategori[] }) {
  const qc = useQueryClient();
  const [yeni, setYeni] = useState({ ad: '', tur: 'GIDER' as 'GELIR' | 'GIDER', zorunlu: false, renk: PALET[0] });

  const tazele = () => qc.invalidateQueries({ queryKey: ['butce-kategoriler'] });

  const ekle = useMutation({
    mutationFn: () => butceApi.kategoriEkle(yeni),
    onSuccess: () => {
      toast.success('Kategori eklendi');
      setYeni({ ad: '', tur: yeni.tur, zorunlu: false, renk: PALET[0] });
      tazele();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Eklenemedi'),
  });

  const sil = useMutation({
    mutationFn: (id: string) => butceApi.kategoriSil(id),
    onSuccess: () => {
      toast.success('Kategori silindi');
      tazele();
    },
    onError: () => toast.error('Silinemedi — bu kategoride kayıt olabilir'),
  });

  const zorunluDegistir = useMutation({
    mutationFn: (k: Kategori) => butceApi.kategoriGuncelle(k.id, { ...k, zorunlu: !k.zorunlu }),
    onSuccess: tazele,
  });

  const gelirler = kategoriler.filter((c) => c.tur === 'GELIR');
  const giderler = kategoriler.filter((c) => c.tur === 'GIDER');

  const liste = (baslik: string, renk: string, ikon: React.ReactNode, kayitlar: Kategori[], gider: boolean) => (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: renk }}>
        {ikon} {baslik} <span style={{ color: MUTED }}>({kayitlar.length})</span>
      </div>
      {kayitlar.length === 0 ? (
        <div
          className="rounded-xl px-3 py-4 text-center text-[11.5px]"
          style={{ border: `1px dashed ${ROW_SEP}`, color: MUTED }}
        >
          Kategori yok
        </div>
      ) : (
        <div className="space-y-1">
          {kayitlar.map((c) => (
            <div
              key={c.id}
              className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${ROW_SEP}` }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <i className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: c.renk || MUTED }} />
                <span className="truncate text-[12.5px]" style={{ color: TEXT }}>
                  {c.ad}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-1.5">
                {gider && (
                  <button
                    onClick={() => zorunluDegistir.mutate(c)}
                    className="rounded-md px-2 py-0.5 text-[10px] transition"
                    style={{
                      color: c.zorunlu ? GOLD : 'rgba(113,113,122,0.9)',
                      background: c.zorunlu ? `${GOLD}14` : 'transparent',
                      border: `1px solid ${c.zorunlu ? `${GOLD}3d` : ROW_SEP}`,
                    }}
                    title={c.zorunlu ? 'Zorunlu — tıklayınca kaldırılır' : 'Zorunlu olarak işaretle'}
                  >
                    zorunlu
                  </button>
                )}
                <button
                  onClick={() => sil.mutate(c.id)}
                  className="rounded-md p-1 opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.06]"
                  style={{ color: KIRMIZI }}
                  title="Sil"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Kutu
      baslik="Kategoriler"
      aciklama="Gelir ve gider kalemlerinizi buradan yönetin. “Zorunlu” işaretli giderler kısılamaz kabul edilir ve ödeme planında ayrı hesaplanır."
      renk={GOLD}
    >
      {/* Ekleme satırı */}
      <div
        className="mb-4 rounded-xl px-3.5 py-3"
        style={{ background: 'rgba(255,255,255,0.022)', border: `1px solid ${ROW_SEP}` }}
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (yeni.ad.trim()) ekle.mutate();
          }}
        >
          <div className="min-w-[200px] flex-1">
            <Alan etiket="Kategori adı">
              <Girdi
                value={yeni.ad}
                onChange={(e) => setYeni({ ...yeni, ad: e.target.value })}
                placeholder="Örn. Aidat, Prim geliri…"
              />
            </Alan>
          </div>
          <div className="w-[130px]">
            <Alan etiket="Tür">
              <Secim value={yeni.tur} onChange={(e) => setYeni({ ...yeni, tur: e.target.value as any })}>
                <option value="GIDER">Gider</option>
                <option value="GELIR">Gelir</option>
              </Secim>
            </Alan>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium" style={{ color: MUTED }}>
              Renk
            </span>
            <div className="flex h-[33px] items-center">
              <RenkSecici deger={yeni.renk} degistir={(v) => setYeni({ ...yeni, renk: v })} />
            </div>
          </div>
          {yeni.tur === 'GIDER' && (
            <label className="flex h-[33px] cursor-pointer items-center gap-2 text-[12px]" style={{ color: MUTED }}>
              <Anahtar acik={yeni.zorunlu} degistir={(v) => setYeni({ ...yeni, zorunlu: v })} />
              Zorunlu
            </label>
          )}
          <div className="flex h-[33px] items-center">
            <Dugme type="submit" tur="birincil" disabled={!yeni.ad.trim()} yukleniyor={ekle.isPending}>
              <Plus size={13} /> Ekle
            </Dugme>
          </div>
        </form>
      </div>

      {/* İki sütun: gelir / gider */}
      <div className="grid gap-5 md:grid-cols-2">
        {liste('Gelir kategorileri', OK, <TrendingUp size={12} />, gelirler, false)}
        {liste('Gider kategorileri', KIRMIZI, <TrendingDown size={12} />, giderler, true)}
      </div>
    </Kutu>
  );
}
