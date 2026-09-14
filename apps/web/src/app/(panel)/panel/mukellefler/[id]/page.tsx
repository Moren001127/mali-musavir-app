'use client';

/**
 * Mükellef kartı — ana bileşen: veri (sorgular/mutasyonlar), form durumu ve sekme geçişi.
 * Görsel parçalar _components/, sabitler/yardımcılar _lib/ altında. Tasarım dili: _lib/tema.ts başlığı.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { BookOpen, Loader2, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { CARD_FONT, COMPLETENESS_COLOR, MUTED, STEEL, displayName, initialsFor, kartZemin } from './_lib/tema';
import { emptyForm, taxpayerKindFromForm, type DefterTuru, type FormState } from './_lib/form';
import type { Kisayol } from './_lib/kisayollar';
import { KartBasligi } from './_components/KartBasligi';
import { KisayolIcerik } from './_components/KisayolCubugu';
import { REAL_TABS, SekmeCubugu, type TabKey } from './_components/SekmeCubugu';
import { BilgilerTab } from './_components/BilgilerSekmesi';
import { BeyannamelerTab } from './_components/BeyannamelerSekmesi';
import { SgkTab } from './_components/SgkSekmesi';
import { ETebligatTab } from './_components/ETebligatSekmesi';
import { DosyalarTab } from './_components/DosyalarSekmesi';
import { CariHesapTab } from './_components/CariHesapSekmesi';
import { MorenAiSohbetTab } from './_components/MorenAiSekmesi';
import { NotlarTab } from './_components/NotlarSekmesi';
import { PlaceholderTab } from './_components/ortak/Tablo';

export default function MukellefDetayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const isNew = id === 'yeni';

  const [activeTab, setActiveTab] = useState<TabKey>('bilgiler');
  const [activeActionOpen, setActiveActionOpen] = useState(false);

  const { data: taxpayer, isLoading } = useQuery({
    queryKey: ['taxpayer', id],
    queryFn: () => api.get(`/taxpayers/${id}`).then((res) => res.data),
    enabled: !isNew,
  });

  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers', 'card-nav'],
    queryFn: () => api.get('/taxpayers').then((res) => res.data),
    enabled: !isNew,
  });

  const { data: completeness } = useQuery<any>({
    queryKey: ['taxpayer-completeness', id],
    queryFn: () => api.get(`/taxpayers/${id}/completeness`).then((r) => r.data),
    enabled: !isNew && !!id,
    refetchInterval: 60_000,
  });

  const [form, setForm] = useState<FormState>(() => emptyForm());
  // Formu dolduran son mükellef imzası. Otomatik Sorgulama şalteri Kaydet'ten bağımsız PATCH atıp
  // ['taxpayer', id] sorgusunu yeniler; yalnız otomatikSorgu/updatedAt değiştiyse form YENİDEN DOLDURULMAZ
  // (kaydedilmemiş alan düzenlemeleri kaybolmasın). Diğer alanlar değişince (Kaydet, Aktif/Pasif) eski davranış aynen.
  const sonFormImzasi = useRef<string | null>(null);

  useEffect(() => {
    if (!taxpayer) return;
    const { otomatikSorgu: _os, updatedAt: _ua, ...imzaKaynak } = taxpayer as any;
    const imza = JSON.stringify(imzaKaynak);
    if (imza === sonFormImzasi.current) return;
    sonFormImzasi.current = imza;

    const phones = [...(taxpayer.phones || []), '', '', ''].slice(0, 3);
    // Haritadan diziye: sunucu numara->ad tutuyor, form sıra bazlı çalışıyor.
    // Eşleşme RAKAMLAR üzerinden — kartta "0533 923 36 74", haritada
    // "905339233674" yazabilir; ham metin karşılaştırılsa ad kaybolurdu.
    const adHaritasi = ((taxpayer as any).telefonAdlari || {}) as Record<string, string>;
    const rakam = (v: string) => String(v || '').replace(/[^\d]/g, '').replace(/^0+/, '').replace(/^90/, '');
    const adBul = (tel: string) => {
      const hedef = rakam(tel);
      if (!hedef) return '';
      const bulunan = Object.entries(adHaritasi).find(([no]) => rakam(no) === hedef);
      return bulunan ? String(bulunan[1] || '') : '';
    };
    const telefonAdlari = phones.map(adBul);
    const emails = [...(taxpayer.emails || []), '', '', ''].slice(0, 3);
    const defterTuru = (((taxpayer as any).defterTuru || taxpayer.mihsapDefterTuru) === 'DEFTER_BEYAN'
      ? 'ISLETME'
      : ((taxpayer as any).defterTuru ?? 'BILANCO')) as DefterTuru;

    setForm({
      type: taxpayer.type || 'TUZEL_KISI',
      telefonAdlari,
      companyName: taxpayer.companyName || '',
      firstName: taxpayer.firstName || '',
      lastName: taxpayer.lastName || '',
      taxNumber: taxpayer.taxNumber || '',
      taxOffice: taxpayer.taxOffice || '',
      phones,
      emails,
      address: taxpayer.address || '',
      notes: taxpayer.notes || '',
      startDate: taxpayer.startDate ? taxpayer.startDate.substring(0, 10) : '',
      endDate: taxpayer.endDate ? taxpayer.endDate.substring(0, 10) : '',
      evrakTeslimGunu: taxpayer.evrakTeslimGunu ?? '',
      whatsappEvrakTalep: taxpayer.whatsappEvrakTalep ?? false,
      whatsappEvrakGeldi: taxpayer.whatsappEvrakGeldi ?? false,
      isEFaturaMukellefi: (taxpayer as any).isEFaturaMukellefi ?? false,
      lucaSlug: taxpayer.lucaSlug ?? '',
      mihsapId: taxpayer.mihsapId ?? '',
      mihsapDefterTuru: taxpayer.mihsapDefterTuru ?? (defterTuru === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO'),
      defterTuru,
      logoUrl: (taxpayer as any).logoUrl ?? '',
      naceKodu: (taxpayer as any).naceKodu ?? '',
      faaliyetAciklama: (taxpayer as any).faaliyetAciklama ?? '',
      ticaretSicilNo: (taxpayer as any).ticaretSicilNo ?? '',
      mersisNo: (taxpayer as any).mersisNo ?? '',
      odaSicilNo: (taxpayer as any).odaSicilNo ?? '',
      bagkurSicilNo: (taxpayer as any).bagkurSicilNo ?? '',
      kepAdresi: (taxpayer as any).kepAdresi ?? '',
      webSitesi: (taxpayer as any).webSitesi ?? '',
      eFaturaEntegrator: (taxpayer as any).eFaturaEntegrator ?? '',
    });
  }, [taxpayer]);

  const { mutate: saveData, isPending } = useMutation({
    mutationFn: (data: any) => (isNew ? api.post('/taxpayers', data) : api.put(`/taxpayers/${id}`, data)),
    onSuccess: () => {
      toast.success(isNew ? 'Mükellef eklendi' : 'Mükellef güncellendi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      qc.invalidateQueries({ queryKey: ['taxpayer', id] });
      if (isNew) router.push('/panel/mukellef-listesi');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Kayıt hatası');
    },
  });

  const { mutate: deleteMukellef, isPending: isDeleting } = useMutation({
    mutationFn: () => api.delete(`/taxpayers/${id}`),
    onSuccess: () => {
      toast.success('Mükellef pasife alındı');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellef-listesi');
    },
    onError: () => toast.error('Silme işlemi başarısız'),
  });

  const { mutate: setActiveStatus, isPending: isActiveChanging } = useMutation({
    mutationFn: (isActive: boolean) => api.put(`/taxpayers/${id}`, { isActive }),
    onSuccess: (_res, isActive) => {
      toast.success(isActive ? 'Mükellef aktife alındı' : 'Mükellef pasife alındı');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      qc.invalidateQueries({ queryKey: ['taxpayer', id] });
      qc.invalidateQueries({ queryKey: ['taxpayer-completeness', id] });
    },
    onError: () => toast.error('Mükellef durumu güncellenemedi'),
  });

  const buildPayload = () => ({
      ...form,
      phones: form.phones.filter(Boolean),
      // Diziden haritaya: numara anahtar. Paralel dizi gönderilseydi, phones
      // dizisi arka planda yeniden yazıldığında (bot yeni numara ekleyince)
      // ad yanlış numaraya yapışırdı.
      telefonAdlari: form.phones.reduce<Record<string, string>>((acc, tel, i) => {
        const ad = (form.telefonAdlari[i] || '').trim();
        if (tel && ad) acc[tel] = ad;
        return acc;
      }, {}),
      emails: form.emails.filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(String(form.evrakTeslimGunu), 10) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
  });

  const saveForm = () => {
    saveData(buildPayload());
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveForm();
  };

  const cardNav = useMemo(() => {
    const list = Array.isArray(taxpayers) ? taxpayers : [];
    const index = list.findIndex((item: any) => item.id === id);
    return {
      index,
      total: list.length,
      prev: index > 0 ? list[index - 1] : null,
      next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    };
  }, [taxpayers, id]);

  const currentName = isNew ? 'Yeni Mükellef' : displayName(taxpayer);
  const avatarText = initialsFor(currentName);
  const isTaxpayerActive = isNew ? true : taxpayer?.isActive !== false;
  const currentKind = taxpayerKindFromForm(form);

  const handleKisayolClick = (k: Kisayol) => {
    window.open(k.url, '_blank', 'noopener,noreferrer');
  };

  const visibleTabs = isNew ? REAL_TABS.filter((t) => t.key === 'bilgiler' || t.key === 'notlar') : REAL_TABS;

  const compScore: number | null = completeness?.score ?? null;
  const compColor = completeness?.durum ? (COMPLETENESS_COLOR[completeness.durum] || STEEL) : STEEL;
  const eksikler: any[] = Array.isArray(completeness?.eksikler) ? completeness.eksikler : [];

  if (!isNew && isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <Loader2 size={16} className="animate-spin" />
          Yükleniyor...
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-[1500px] space-y-3 px-1" style={{ fontFamily: CARD_FONT }}>
      <KartBasligi
        isNew={isNew}
        currentName={currentName}
        avatarText={avatarText}
        logoUrl={form.logoUrl}
        taxNumber={form.taxNumber}
        taxOffice={form.taxOffice}
        kind={currentKind}
        compScore={compScore}
        compColor={compColor}
        eksikler={eksikler}
        isTaxpayerActive={isTaxpayerActive}
        isActiveChanging={isActiveChanging}
        activeActionOpen={activeActionOpen}
        setActiveActionOpen={setActiveActionOpen}
        setActiveStatus={setActiveStatus}
        cardNav={cardNav}
        router={router}
        isPending={isPending}
        deleteMukellef={deleteMukellef}
        isDeleting={isDeleting}
      />

      {!isNew && <KisayolIcerik vkn={form.taxNumber} onKisayol={handleKisayolClick} />}

      <section className="overflow-hidden" style={kartZemin()}>
        <SekmeCubugu tabs={visibleTabs} activeTab={activeTab} onChange={setActiveTab} />

        <div className="p-4 sm:p-5">
          {activeTab === 'bilgiler' && (
            <BilgilerTab
              form={form}
              setForm={setForm}
              taxpayerId={isNew ? null : id}
              onSave={saveForm}
              saving={isPending}
              otomatikSorgu={isNew ? undefined : (taxpayer as any)?.otomatikSorgu ?? null}
            />
          )}
          {activeTab === 'beyannameler' && !isNew && id && <BeyannamelerTab taxpayerId={id} />}
          {activeTab === 'sgk' && !isNew && id && <SgkTab taxpayerId={id} />}
          {activeTab === 'tebligat' && !isNew && id && <ETebligatTab taxpayerId={id} />}
          {activeTab === 'dosyalar' && !isNew && id && <DosyalarTab taxpayerId={id} />}
          {false && activeTab === 'dosyalar' && (
            <PlaceholderTab icon={BookOpen} title="Dosyalar" description="Mükellefe bağlı evraklar ve dosya arşivi." linkLabel="Evraklar modülüne git" linkHref={`/panel/evraklar?taxpayerId=${id}`} />
          )}
          {activeTab === 'cariHesap' && !isNew && id && <CariHesapTab taxpayerId={id} />}
          {activeTab === 'morenAi' && !isNew && id && <MorenAiSohbetTab taxpayerId={id} />}
          {activeTab === 'iseGiris' && (
            <PlaceholderTab icon={UserCog} title="İşe Giriş Bildirgesi" description="İşe giriş ve işten çıkış bildirimleri için ayrılmış alan." comingSoon />
          )}
          {activeTab === 'notlar' && <NotlarTab form={form} setForm={setForm} onSave={saveForm} saving={isPending} hasRecord={!isNew} taxpayerId={isNew ? null : id} />}
        </div>
      </section>
    </form>
  );
}
