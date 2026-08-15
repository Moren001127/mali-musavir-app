'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, ShieldCheck, Bell } from 'lucide-react';
import { butceApi, Kategori, para } from '@/lib/butce';
import {
  Kutu, Dugme, Alan, Girdi, Secim, Rozet, Yukleniyor,
  GOLD, OK, KIRMIZI, MAVI, MUTED, TEXT, ROW_SEP, CARD_BORDER,
} from './ui';

export default function Ayarlar() {
  const qc = useQueryClient();
  const { data: ayar, isLoading } = useQuery({ queryKey: ['butce-ayar'], queryFn: butceApi.ayar });
  const { data: kategoriler = [] } = useQuery({ queryKey: ['butce-kategoriler'], queryFn: butceApi.kategoriler });

  const [form, setForm] = useState({
    nakitYastigi: '',
    strateji: 'CIG' as 'CIG' | 'KARTOPU',
    hatirlatmaWhatsapp: true,
    hatirlatmaPortal: true,
    hatirlatmaEmail: false,
    whatsappNumara: '',
    sabahSaati: '9',
  });

  useEffect(() => {
    if (!ayar) return;
    setForm({
      nakitYastigi: String(ayar.nakitYastigi ?? 0),
      strateji: ayar.strateji,
      hatirlatmaWhatsapp: ayar.hatirlatmaWhatsapp,
      hatirlatmaPortal: ayar.hatirlatmaPortal,
      hatirlatmaEmail: ayar.hatirlatmaEmail,
      whatsappNumara: ayar.whatsappNumara || '',
      sabahSaati: String(ayar.sabahSaati ?? 9),
    });
  }, [ayar]);

  const kaydet = useMutation({
    mutationFn: () =>
      butceApi.ayarKaydet({
        nakitYastigi: Number(form.nakitYastigi.replace(',', '.') || 0),
        strateji: form.strateji,
        hatirlatmaWhatsapp: form.hatirlatmaWhatsapp,
        hatirlatmaPortal: form.hatirlatmaPortal,
        hatirlatmaEmail: form.hatirlatmaEmail,
        whatsappNumara: form.whatsappNumara,
        sabahSaati: Number(form.sabahSaati),
      }),
    onSuccess: () => {
      toast.success('Ayarlar kaydedildi');
      qc.invalidateQueries({ queryKey: ['butce-ayar'] });
      qc.invalidateQueries({ queryKey: ['butce-plan'] });
      qc.invalidateQueries({ queryKey: ['butce-ozet'] });
    },
    onError: () => toast.error('Kaydedilemedi'),
  });

  if (isLoading || !ayar) return <Yukleniyor />;

  return (
    <div className="space-y-4">
      <Kutu
        baslik="Plan ayarları"
        aciklama="Ödeme planı bu değerlere göre hesaplanır."
        sag={
          <Dugme tur="birincil" onClick={() => kaydet.mutate()} yukleniyor={kaydet.isPending}>
            Kaydet
          </Dugme>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Alan
            etiket="Nakit yastığı (₺)"
            ipucu="Acil durum için dokunulmayacak tutar. Borç kapasitesinden düşülür."
          >
            <Girdi
              value={form.nakitYastigi}
              onChange={(e) => setForm({ ...form, nakitYastigi: e.target.value })}
              inputMode="decimal"
            />
          </Alan>
          <Alan etiket="Varsayılan strateji" ipucu="Çığ: en pahalı borç önce. Kartopu: en küçük borç önce.">
            <Secim value={form.strateji} onChange={(e) => setForm({ ...form, strateji: e.target.value as any })}>
              <option value="CIG">Çığ — en yüksek faizli önce (matematiksel olarak en ucuz)</option>
              <option value="KARTOPU">Kartopu — en küçük borç önce (motivasyon)</option>
            </Secim>
          </Alan>
        </div>
      </Kutu>

      <Kutu
        baslik="Hatırlatmalar"
        aciklama="Ekstre kesildiğinde ve son ödeme yaklaştığında haber verilir."
        renk={MAVI}
        sag={<Bell size={14} style={{ color: MAVI }} />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {[
              { alan: 'hatirlatmaWhatsapp' as const, etiket: 'WhatsApp mesajı' },
              { alan: 'hatirlatmaPortal' as const, etiket: 'Portal bildirimi (zil)' },
              { alan: 'hatirlatmaEmail' as const, etiket: 'E-posta' },
            ].map((x) => (
              <label
                key={x.alan}
                className="flex cursor-pointer items-center justify-between rounded-xl px-3.5 py-2.5 text-[12.5px]"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${ROW_SEP}`, color: TEXT }}
              >
                {x.etiket}
                <input
                  type="checkbox"
                  checked={form[x.alan]}
                  onChange={(e) => setForm({ ...form, [x.alan]: e.target.checked })}
                />
              </label>
            ))}
          </div>
          <div className="space-y-3">
            <Alan etiket="WhatsApp numarası" ipucu="Boş bırakırsanız portalda tanımlı sahip numarası kullanılır">
              <Girdi
                value={form.whatsappNumara}
                onChange={(e) => setForm({ ...form, whatsappNumara: e.target.value })}
                placeholder="905xxxxxxxxx"
              />
            </Alan>
            <Alan etiket="Hatırlatma saati" ipucu="Tarama her sabah bu saatte çalışır">
              <Girdi
                type="number"
                min={0}
                max={23}
                value={form.sabahSaati}
                onChange={(e) => setForm({ ...form, sabahSaati: e.target.value })}
              />
            </Alan>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Dugme tur="birincil" renk={MAVI} onClick={() => kaydet.mutate()} yukleniyor={kaydet.isPending}>
            Kaydet
          </Dugme>
        </div>
      </Kutu>

      <KategoriYonetimi kategoriler={kategoriler} />

      <Kutu baslik="Gizlilik" renk={OK} sag={<ShieldCheck size={14} style={{ color: OK }} />}>
        <p className="text-[12px] leading-relaxed" style={{ color: MUTED }}>
          Bu modül yalnız sizin kullanıcınıza açıktır. Başka bir kullanıcı — yönetici yetkisi olsa bile — bu
          sayfayı menüde göremez ve adres çubuğuna yazsa dahi verilere erişemez; sunucu bu istekleri
          “sayfa bulunamadı” diye yanıtlar. Bildirimler yalnız sizin kullanıcınıza ve tanımlı numaranıza gider.
        </p>
      </Kutu>
    </div>
  );
}

function KategoriYonetimi({ kategoriler }: { kategoriler: Kategori[] }) {
  const qc = useQueryClient();
  const [yeni, setYeni] = useState({ ad: '', tur: 'GIDER' as 'GELIR' | 'GIDER', zorunlu: false, renk: '#9c9c9c' });

  const ekle = useMutation({
    mutationFn: () => butceApi.kategoriEkle(yeni),
    onSuccess: () => {
      toast.success('Kategori eklendi');
      setYeni({ ad: '', tur: 'GIDER', zorunlu: false, renk: '#9c9c9c' });
      qc.invalidateQueries({ queryKey: ['butce-kategoriler'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Eklenemedi'),
  });

  const sil = useMutation({
    mutationFn: (id: string) => butceApi.kategoriSil(id),
    onSuccess: () => {
      toast.success('Kategori silindi');
      qc.invalidateQueries({ queryKey: ['butce-kategoriler'] });
    },
    onError: () => toast.error('Silinemedi (kullanımda olabilir)'),
  });

  const zorunluDegistir = useMutation({
    mutationFn: (k: Kategori) => butceApi.kategoriGuncelle(k.id, { ...k, zorunlu: !k.zorunlu }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['butce-kategoriler'] }),
  });

  return (
    <Kutu
      baslik="Kategoriler"
      aciklama="“Zorunlu” işaretli giderler kısılamaz kabul edilir ve plan hesabında ayrı gösterilir."
      renk={GOLD}
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-52">
          <Alan etiket="Yeni kategori">
            <Girdi value={yeni.ad} onChange={(e) => setYeni({ ...yeni, ad: e.target.value })} placeholder="Örn. Aidat" />
          </Alan>
        </div>
        <div className="w-32">
          <Alan etiket="Tür">
            <Secim value={yeni.tur} onChange={(e) => setYeni({ ...yeni, tur: e.target.value as any })}>
              <option value="GIDER">Gider</option>
              <option value="GELIR">Gelir</option>
            </Secim>
          </Alan>
        </div>
        <div className="w-24">
          <Alan etiket="Renk">
            <input
              type="color"
              value={yeni.renk}
              onChange={(e) => setYeni({ ...yeni, renk: e.target.value })}
              style={{ width: '100%', height: 34, background: 'transparent', border: `1px solid ${CARD_BORDER}`, borderRadius: 10 }}
            />
          </Alan>
        </div>
        <label className="mb-1.5 flex items-center gap-2 text-[12px]" style={{ color: MUTED }}>
          <input type="checkbox" checked={yeni.zorunlu} onChange={(e) => setYeni({ ...yeni, zorunlu: e.target.checked })} />
          Zorunlu
        </label>
        <Dugme tur="birincil" onClick={() => ekle.mutate()} disabled={!yeni.ad.trim()} yukleniyor={ekle.isPending}>
          <Plus size={13} /> Ekle
        </Dugme>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {kategoriler.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${ROW_SEP}` }}
          >
            <span className="flex min-w-0 items-center gap-2">
              <i className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: c.renk || MUTED }} />
              <span className="truncate" style={{ color: TEXT }}>
                {c.ad}
              </span>
              <Rozet metin={c.tur === 'GELIR' ? 'gelir' : 'gider'} renk={c.tur === 'GELIR' ? OK : KIRMIZI} />
            </span>
            <span className="flex flex-shrink-0 items-center gap-1">
              {c.tur === 'GIDER' && (
                <button
                  onClick={() => zorunluDegistir.mutate(c)}
                  className="rounded-md px-1.5 py-0.5 text-[10px] transition hover:bg-white/[0.06]"
                  style={{ color: c.zorunlu ? GOLD : MUTED, border: `1px solid ${c.zorunlu ? `${GOLD}44` : 'transparent'}` }}
                  title="Zorunlu işaretini değiştir"
                >
                  zorunlu
                </button>
              )}
              <button
                onClick={() => sil.mutate(c.id)}
                className="rounded-md p-1 transition hover:bg-white/[0.06]"
                style={{ color: KIRMIZI }}
              >
                <Trash2 size={11} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </Kutu>
  );
}
