'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Loader2,
  Mail,
  MessageSquareText,
  Phone,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  Workflow,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import TaxpayerStatsCard from '@/components/TaxpayerStatsCard';
import DocumentExpiryWidget from '@/components/DocumentExpiryWidget';
import { ProfilTamamlikBanner } from '@/components/mukellef/ProfilTamamlikBanner';
import { MukellefiyetlerCard } from '@/components/mukellef/MukellefiyetlerCard';
import { TaxpayerPortalCredentialsCard } from '@/components/portal-automation/PortalCredentialCards';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const LINE = 'rgba(255,255,255,0.08)';
const LINE_GOLD = 'rgba(212,184,118,0.24)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const SOFT = 'rgba(255,255,255,0.035)';

const TAXPAYER_TYPES = [
  { value: 'TUZEL_KISI', label: 'Tüzel Kişi', detail: 'Şirket veya kurum kaydı' },
  { value: 'GERCEK_KISI', label: 'Gerçek Kişi', detail: 'Şahıs işletmesi veya bireysel kayıt' },
] as const;

type TaxpayerType = (typeof TAXPAYER_TYPES)[number]['value'];
type DefterTuru = 'BILANCO' | 'ISLETME';

type FormState = {
  type: TaxpayerType;
  companyName: string;
  firstName: string;
  lastName: string;
  taxNumber: string;
  taxOffice: string;
  phones: string[];
  emails: string[];
  address: string;
  notes: string;
  startDate: string;
  endDate: string;
  evrakTeslimGunu: string | number;
  whatsappEvrakTalep: boolean;
  whatsappEvrakGeldi: boolean;
  isEFaturaMukellefi: boolean;
  lucaSlug: string;
  mihsapId: string;
  mihsapDefterTuru: string;
  defterTuru: DefterTuru;
};

function emptyForm(): FormState {
  return {
    type: 'TUZEL_KISI',
    companyName: '',
    firstName: '',
    lastName: '',
    taxNumber: '',
    taxOffice: '',
    phones: ['', '', ''],
    emails: ['', '', ''],
    address: '',
    notes: '',
    startDate: '',
    endDate: '',
    evrakTeslimGunu: '',
    whatsappEvrakTalep: false,
    whatsappEvrakGeldi: false,
    isEFaturaMukellefi: false,
    lucaSlug: '',
    mihsapId: '',
    mihsapDefterTuru: 'BILANCO',
    defterTuru: 'BILANCO',
  };
}

function displayName(item: any) {
  return (
    item?.companyName ||
    [item?.firstName, item?.lastName].filter(Boolean).join(' ') ||
    item?.taxNumber ||
    'Mükellef'
  );
}

function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function MukellefDetayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const isNew = id === 'yeni';

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

  const [form, setForm] = useState<FormState>(() => emptyForm());

  useEffect(() => {
    if (!taxpayer) return;

    const phones = [...(taxpayer.phones || []), '', '', ''].slice(0, 3);
    const emails = [...(taxpayer.emails || []), '', '', ''].slice(0, 3);
    const defterTuru = (((taxpayer as any).defterTuru || taxpayer.mihsapDefterTuru) === 'DEFTER_BEYAN'
      ? 'ISLETME'
      : ((taxpayer as any).defterTuru ?? 'BILANCO')) as DefterTuru;

    setForm({
      type: taxpayer.type || 'TUZEL_KISI',
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
    });
  }, [taxpayer]);

  const { mutate: saveData, isPending } = useMutation({
    mutationFn: (data: any) => (isNew ? api.post('/taxpayers', data) : api.put(`/taxpayers/${id}`, data)),
    onSuccess: () => {
      toast.success(isNew ? 'Mükellef eklendi' : 'Mükellef güncellendi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      qc.invalidateQueries({ queryKey: ['taxpayer', id] });
      if (isNew) router.push('/panel/mukellefler');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Kayıt hatası');
    },
  });

  const { mutate: deleteMukellef, isPending: isDeleting } = useMutation({
    mutationFn: () => api.delete(`/taxpayers/${id}`),
    onSuccess: () => {
      toast.success('Mükellef silindi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellefler');
    },
    onError: () => toast.error('Silme işlemi başarısız'),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      phones: form.phones.filter(Boolean),
      emails: form.emails.filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(String(form.evrakTeslimGunu), 10) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    };
    saveData(payload);
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

  const CardNavButtons = ({ compact = false }: { compact?: boolean }) => {
    if (isNew || cardNav.total <= 1) return null;
    return (
      <div className={`flex ${compact ? 'flex-wrap justify-end' : 'flex-col sm:flex-row'} items-center gap-2`}>
        <button
          type="button"
          onClick={() => cardNav.prev && router.push(`/panel/mukellefler/${cardNav.prev.id}`)}
          disabled={!cardNav.prev}
          title={cardNav.prev ? displayName(cardNav.prev) : 'İlk mükellef'}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
          style={{ borderColor: LINE, color: TEXT, background: SOFT }}
        >
          <ChevronLeft size={15} />
          Önceki
        </button>
        <div className="inline-flex h-9 min-w-[78px] items-center justify-center rounded-lg border px-3 text-[12px] font-semibold tabular-nums" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.09)', color: GOLD }}>
          {cardNav.index >= 0 ? cardNav.index + 1 : '-'} / {cardNav.total}
        </div>
        <button
          type="button"
          onClick={() => cardNav.next && router.push(`/panel/mukellefler/${cardNav.next.id}`)}
          disabled={!cardNav.next}
          title={cardNav.next ? displayName(cardNav.next) : 'Son mükellef'}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
          style={{ borderColor: LINE, color: TEXT, background: SOFT }}
        >
          Sonraki
          <ChevronRight size={15} />
        </button>
      </div>
    );
  };

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
    <form onSubmit={handleSubmit} className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Link
              href="/panel/mukellefler"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]"
              style={{ borderColor: LINE, color: MUTED }}
              title="Listeye dön"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border text-[17px] font-bold" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.12)', color: GOLD }}>
              {avatarText}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>
                {isNew ? 'Yeni kayıt' : form.type === 'TUZEL_KISI' ? 'Şirket kartı' : 'Gerçek kişi kartı'}
              </p>
              <h1 className="truncate text-[26px] font-semibold leading-tight" style={{ color: TEXT }}>{currentName}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
                <InfoPill icon={Landmark} label={form.taxNumber || 'VKN/TCKN yok'} />
                <InfoPill icon={ShieldCheck} label={form.taxOffice || 'Vergi dairesi yok'} />
                <InfoPill icon={BookOpen} label={form.defterTuru === 'BILANCO' ? 'Bilanço' : 'İşletme defteri'} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CardNavButtons compact />
            {!isNew && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Mükellef silinsin mi?')) deleteMukellef();
                }}
                disabled={isDeleting}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition hover:bg-red-500/10 disabled:opacity-40"
                style={{ borderColor: 'rgba(248,113,113,0.32)', color: '#fca5a5' }}
              >
                {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Sil
              </button>
            )}
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[12.5px] font-bold transition disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
            >
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isNew ? 'Kaydı Oluştur' : 'Kaydet'}
            </button>
          </div>
        </div>
      </header>

      {!isNew && id && <ProfilTamamlikBanner taxpayerId={id} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="space-y-5">
          <Section icon={UserRound} title="Kimlik ve vergi bilgileri">
            <div className="grid gap-3 sm:grid-cols-2">
              {TAXPAYER_TYPES.map((item) => (
                <RadioCard
                  key={item.value}
                  checked={form.type === item.value}
                  title={item.label}
                  detail={item.detail}
                  onClick={() => setForm((prev) => ({ ...prev, type: item.value }))}
                />
              ))}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {form.type === 'TUZEL_KISI' ? (
                <Field label="Şirket adı" required className="md:col-span-2">
                  <InputBase
                    value={form.companyName}
                    onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))}
                    required
                  />
                </Field>
              ) : (
                <>
                  <Field label="Ad" required>
                    <InputBase value={form.firstName} onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))} required />
                  </Field>
                  <Field label="Soyad" required>
                    <InputBase value={form.lastName} onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))} required />
                  </Field>
                </>
              )}
              <Field label={form.type === 'TUZEL_KISI' ? 'VKN' : 'TCKN'} required>
                <InputBase
                  value={form.taxNumber}
                  onChange={(event) => setForm((prev) => ({ ...prev, taxNumber: event.target.value.replace(/\D/g, '') }))}
                  maxLength={11}
                  required
                  className="font-mono"
                />
              </Field>
              <Field label="Vergi dairesi" required>
                <InputBase value={form.taxOffice} onChange={(event) => setForm((prev) => ({ ...prev, taxOffice: event.target.value }))} required />
              </Field>
              <Field label="İşe başlama tarihi">
                <InputBase type="date" value={form.startDate} onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))} />
              </Field>
              <Field label="İşi bırakma tarihi">
                <InputBase type="date" value={form.endDate} onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))} />
              </Field>
              <Field label="Adres" className="md:col-span-2">
                <InputBase value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} />
              </Field>
            </div>
          </Section>

          <Section icon={Phone} title="İletişim bilgileri">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <Subhead icon={Phone} label="Telefonlar" />
                {form.phones.map((phone, index) => (
                  <InputBase
                    key={index}
                    type="tel"
                    value={phone}
                    onChange={(event) => setForm((prev) => {
                      const phones = [...prev.phones];
                      phones[index] = event.target.value;
                      return { ...prev, phones };
                    })}
                    placeholder={index === 0 ? 'Ana telefon' : `Telefon ${index + 1}`}
                  />
                ))}
              </div>
              <div className="space-y-3">
                <Subhead icon={Mail} label="E-postalar" />
                {form.emails.map((email, index) => (
                  <InputBase
                    key={index}
                    type="email"
                    value={email}
                    onChange={(event) => setForm((prev) => {
                      const emails = [...prev.emails];
                      emails[index] = event.target.value;
                      return { ...prev, emails };
                    })}
                    placeholder={index === 0 ? 'Ana e-posta' : `E-posta ${index + 1}`}
                  />
                ))}
              </div>
            </div>
          </Section>

          <Section icon={Workflow} title="Evrak ve otomasyon">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
              <Field label="Evrak teslim son günü">
                <InputBase
                  type="number"
                  min={1}
                  max={30}
                  value={form.evrakTeslimGunu}
                  onChange={(event) => setForm((prev) => ({ ...prev, evrakTeslimGunu: event.target.value }))}
                  placeholder="Örn: 15"
                />
              </Field>
              <div className="grid gap-3">
                <ToggleRow
                  checked={form.whatsappEvrakTalep}
                  onChange={(checked) => setForm((prev) => ({ ...prev, whatsappEvrakTalep: checked }))}
                  title="Evrak talep mesajı"
                  detail="Aylık evrak akışı için WhatsApp hatırlatması."
                />
                <ToggleRow
                  checked={form.whatsappEvrakGeldi}
                  onChange={(checked) => setForm((prev) => ({ ...prev, whatsappEvrakGeldi: checked }))}
                  title="Evrak geldi onayı"
                  detail="Evrak geldi işaretlendiğinde bilgilendirme mesajı."
                />
                <ToggleRow
                  checked={form.isEFaturaMukellefi}
                  onChange={(checked) => setForm((prev) => ({ ...prev, isEFaturaMukellefi: checked }))}
                  title="E-Fatura mükellefi"
                  detail="Fatura sorgulama modüllerindeki varsayılan kanal."
                />
              </div>
            </div>
          </Section>

          <Section icon={Settings2} title="Defter ve sistem eşleşmeleri">
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                checked={form.defterTuru === 'BILANCO'}
                title="Bilanço"
                detail="Banka takip ve bilanço modülleri aktif."
                onClick={() => setForm((prev) => ({ ...prev, defterTuru: 'BILANCO', mihsapDefterTuru: 'BILANCO' }))}
              />
              <RadioCard
                checked={form.defterTuru === 'ISLETME'}
                title="İşletme defteri"
                detail="Defter beyan akışı için sade profil."
                onClick={() => setForm((prev) => ({ ...prev, defterTuru: 'ISLETME', mihsapDefterTuru: 'DEFTER_BEYAN' }))}
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Luca slug">
                <InputBase value={form.lucaSlug} onChange={(event) => setForm((prev) => ({ ...prev, lucaSlug: event.target.value }))} placeholder="selim_motors" />
              </Field>
              <Field label="Mihsap ID">
                <InputBase value={form.mihsapId} onChange={(event) => setForm((prev) => ({ ...prev, mihsapId: event.target.value }))} placeholder="110564" />
              </Field>
              <Field label="Mihsap defter türü">
                <select
                  value={form.mihsapDefterTuru}
                  onChange={(event) => setForm((prev) => ({
                    ...prev,
                    mihsapDefterTuru: event.target.value,
                    defterTuru: event.target.value === 'DEFTER_BEYAN' ? 'ISLETME' : 'BILANCO',
                  }))}
                  className="h-10 rounded-lg border px-3 text-sm"
                  style={{ background: SOFT, borderColor: LINE, color: TEXT }}
                >
                  <option value="BILANCO">Bilanço</option>
                  <option value="DEFTER_BEYAN">Defter Beyan</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section icon={MessageSquareText} title="Notlar">
            <textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              rows={4}
              placeholder="Mükellef hakkında notlar..."
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: SOFT, borderColor: LINE, color: TEXT }}
            />
          </Section>
        </main>

        <aside className="space-y-5">
          {!isNew && id ? (
            <>
              <TaxpayerStatsCard taxpayerId={id} />
              <DocumentExpiryWidget taxpayerId={id} compact={false} daysAhead={90} />
              <MukellefiyetlerCard taxpayerId={id} />
              <TaxpayerPortalCredentialsCard taxpayerId={id} />
            </>
          ) : (
            <div className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, color: GOLD, background: 'rgba(212,184,118,0.10)' }}>
                <CheckCircle2 size={19} />
              </div>
              <h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>Kayıt sonrası açılır</h2>
              <p className="mt-2 text-[13px] leading-relaxed" style={{ color: MUTED }}>
                Mükellef oluşturulduktan sonra beyanname, evrak yenileme ve portal şifreleri burada görünür.
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 border-t bg-[#0a0906]/95 px-1 py-4 backdrop-blur" style={{ borderColor: LINE }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardNavButtons />
          <div className="flex justify-end gap-2">
            <Link href="/panel/mukellefler">
              <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[13px] font-semibold transition hover:bg-white/[0.06]" style={{ borderColor: LINE, color: TEXT }}>
                İptal
              </button>
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-5 text-[13px] font-bold transition disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
            >
              {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {isNew ? 'Mükellef Ekle' : 'Değişiklikleri Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function InfoPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ borderColor: LINE, color: MUTED, background: SOFT }}>
      <Icon size={12} style={{ color: GOLD }} />
      {label}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.09)', color: GOLD }}>
          <Icon size={17} />
        </div>
        <h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, className = '', children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: MUTED }}>
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

function InputBase({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded-lg border px-3 text-sm outline-none transition ${className}`}
      style={{ background: SOFT, borderColor: LINE, color: TEXT, ...(props.style || {}) }}
    />
  );
}

function Subhead({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: MUTED }}>
      <Icon size={14} style={{ color: GOLD }} />
      {label}
    </div>
  );
}

function RadioCard({ checked, title, detail, onClick }: { checked: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border p-4 text-left transition hover:bg-white/[0.05]"
      style={{
        borderColor: checked ? LINE_GOLD : LINE,
        background: checked ? 'rgba(212,184,118,0.10)' : SOFT,
      }}
    >
      <span className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border" style={{ borderColor: checked ? GOLD : LINE, color: checked ? GOLD : 'transparent' }}>
          <CheckCircle2 size={14} />
        </span>
        <span>
          <span className="block text-sm font-semibold" style={{ color: TEXT }}>{title}</span>
          <span className="mt-1 block text-[12px]" style={{ color: MUTED }}>{detail}</span>
        </span>
      </span>
    </button>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition hover:bg-white/[0.04]" style={{ borderColor: checked ? LINE_GOLD : LINE, background: checked ? 'rgba(212,184,118,0.08)' : SOFT }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: checked ? LINE_GOLD : LINE, color: checked ? GOLD : 'rgba(250,250,249,0.30)' }}>
        <CheckCircle2 size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold" style={{ color: TEXT }}>{title}</span>
        <span className="mt-0.5 block text-[12px]" style={{ color: MUTED }}>{detail}</span>
      </span>
    </label>
  );
}
