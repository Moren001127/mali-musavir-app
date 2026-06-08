'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  FileText,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Save,
  Smartphone,
  User,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const GREEN = '#22c55e';
const ROSE = '#fb7185';
const SKY = '#4f86c9';
const AMBER = '#f59e0b';
const CARD = 'rgba(255,255,255,0.022)';
const LINE = 'rgba(255,255,255,0.075)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const FAINT = 'rgba(250,250,249,0.38)';

type TaxpayerType = 'TUZEL_KISI' | 'GERCEK_KISI';
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
  evrakTeslimGunu: string;
  whatsappEvrakTalep: boolean;
  whatsappEvrakGeldi: boolean;
  isEFaturaMukellefi: boolean;
  lucaSlug: string;
  mihsapId: string;
  mihsapDefterTuru: string;
  defterTuru: DefterTuru;
};

type Payload = Omit<FormState, 'evrakTeslimGunu' | 'startDate' | 'endDate'> & {
  evrakTeslimGunu: number | null;
  startDate: string | null;
  endDate: string | null;
};

const initialForm: FormState = {
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

const inputClass = 'h-11 w-full rounded-[8px] px-3 text-[13px] font-semibold outline-none transition placeholder:text-white/24';
const textareaClass = 'min-h-[92px] w-full resize-none rounded-[8px] px-3 py-3 text-[13px] font-semibold outline-none transition placeholder:text-white/24';
const inputStyle = { background: 'rgba(255,255,255,0.032)', border: '1px solid rgba(255,255,255,0.09)', color: TEXT };

function displayName(form: FormState): string {
  if (form.type === 'TUZEL_KISI') return form.companyName.trim() || 'Yeni Firma';
  return [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'Yeni Şahıs';
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toLocaleUpperCase('tr-TR');
  return name.slice(0, 2).toLocaleUpperCase('tr-TR');
}

function taxpayerKind(form: FormState): string {
  if (form.defterTuru === 'ISLETME' || form.mihsapDefterTuru === 'DEFTER_BEYAN') return 'BASİT';
  return form.type === 'TUZEL_KISI' ? 'FİRMA' : 'ŞAHIS';
}

export default function YeniMukellefPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(initialForm);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (data: Payload) => api.post('/taxpayers', data),
    onSuccess: () => {
      toast.success('Mükellef eklendi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellef-listesi');
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Kayıt hatası');
    },
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateType = (type: TaxpayerType) => {
    setForm((current) => ({
      ...current,
      type,
      taxNumber: current.taxNumber.slice(0, type === 'TUZEL_KISI' ? 10 : 11),
    }));
  };

  const updatePhone = (index: number, value: string) => {
    setForm((current) => {
      const phones = [...current.phones];
      phones[index] = value;
      return { ...current, phones };
    });
  };

  const updateEmail = (index: number, value: string) => {
    setForm((current) => {
      const emails = [...current.emails];
      emails[index] = value;
      return { ...current, emails };
    });
  };

  const updateBook = (defterTuru: DefterTuru) => {
    setForm((current) => ({
      ...current,
      defterTuru,
      mihsapDefterTuru: defterTuru === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO',
    }));
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save({
      ...form,
      phones: form.phones.map((phone) => phone.trim()).filter(Boolean),
      emails: form.emails.map((email) => email.trim()).filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(form.evrakTeslimGunu, 10) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    });
  };

  const taxMaxLength = form.type === 'TUZEL_KISI' ? 10 : 11;

  return (
    <div className="mx-auto max-w-[1260px] space-y-4 px-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/panel/mukellef-listesi"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] transition"
            style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${LINE}`, color: MUTED }}
            title="Listeye dön"
          >
            <ArrowLeft size={17} />
          </Link>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-px w-[26px]" style={{ background: GOLD }} />
              <span className="text-[9.5px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>Mükellef CRM</span>
            </div>
            <h1 className="text-[28px] font-black leading-none" style={{ color: GOLD, fontFamily: 'Manrope, Inter, system-ui, sans-serif', letterSpacing: 0 }}>
              Yeni Mükellef
            </h1>
          </div>
        </div>
        <button
          type="submit"
          form="new-taxpayer-form"
          disabled={isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-4 text-[13px] font-black transition disabled:opacity-45"
          style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' }}
        >
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {isPending ? 'Kaydediliyor' : 'Kaydet'}
        </button>
      </header>

      <form id="new-taxpayer-form" onSubmit={handleSubmit} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="space-y-4">
          <Section icon={User} title="Kimlik">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <FieldLabel>Mükellef Tipi</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SegmentButton active={form.type === 'TUZEL_KISI'} icon={Building2} label="Firma" onClick={() => updateType('TUZEL_KISI')} color={SKY} />
                  <SegmentButton active={form.type === 'GERCEK_KISI'} icon={User} label="Şahıs" onClick={() => updateType('GERCEK_KISI')} color="#18aee2" />
                </div>
              </div>

              {form.type === 'TUZEL_KISI' ? (
                <TextField
                  className="md:col-span-2"
                  label="Şirket Adı *"
                  value={form.companyName}
                  required
                  onChange={(value) => update('companyName', value)}
                />
              ) : (
                <>
                  <TextField label="Ad *" value={form.firstName} required onChange={(value) => update('firstName', value)} />
                  <TextField label="Soyad *" value={form.lastName} required onChange={(value) => update('lastName', value)} />
                </>
              )}

              <TextField
                label={`${form.type === 'TUZEL_KISI' ? 'VKN' : 'TCKN'} *`}
                value={form.taxNumber}
                required
                maxLength={taxMaxLength}
                inputMode="numeric"
                mono
                onChange={(value) => update('taxNumber', value.replace(/\D/g, '').slice(0, taxMaxLength))}
              />
              <TextField label="Vergi Dairesi *" value={form.taxOffice} required onChange={(value) => update('taxOffice', value)} />

              <div className="md:col-span-2">
                <FieldLabel>Defter</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SegmentButton active={form.defterTuru === 'BILANCO'} icon={BookOpen} label="Bilanço" onClick={() => updateBook('BILANCO')} color={GOLD} />
                  <SegmentButton active={form.defterTuru === 'ISLETME'} icon={FileText} label="İşletme / Basit" onClick={() => updateBook('ISLETME')} color={AMBER} />
                </div>
              </div>
            </div>
          </Section>

          <Section icon={Phone} title="İletişim">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel>Telefon</FieldLabel>
                {form.phones.map((phone, index) => (
                  <TextField
                    key={`phone-${index}`}
                    label=""
                    value={phone}
                    type="tel"
                    placeholder={index === 0 ? 'Telefon 1' : `Telefon ${index + 1}`}
                    onChange={(value) => updatePhone(index, value)}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <FieldLabel>E-posta</FieldLabel>
                {form.emails.map((email, index) => (
                  <TextField
                    key={`email-${index}`}
                    label=""
                    value={email}
                    type="email"
                    placeholder={`E-posta ${index + 1}`}
                    onChange={(value) => updateEmail(index, value)}
                  />
                ))}
              </div>
              <TextField
                className="lg:col-span-2"
                label="Adres"
                value={form.address}
                onChange={(value) => update('address', value)}
              />
            </div>
          </Section>

          <Section icon={CalendarDays} title="Takip">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField label="İşe Başlama" type="date" value={form.startDate} onChange={(value) => update('startDate', value)} />
              <TextField label="İşi Bırakma" type="date" value={form.endDate} onChange={(value) => update('endDate', value)} />
              <TextField
                label="Evrak Son Günü"
                type="number"
                value={form.evrakTeslimGunu}
                min={1}
                max={30}
                placeholder="15"
                onChange={(value) => update('evrakTeslimGunu', value)}
              />
            </div>
          </Section>

          <Section icon={MessageSquareText} title="Ayarlar">
            <div className="grid gap-3 lg:grid-cols-3">
              <ToggleRow checked={form.whatsappEvrakTalep} icon={Bell} title="Evrak Talebi SMS" onChange={(value) => update('whatsappEvrakTalep', value)} />
              <ToggleRow checked={form.whatsappEvrakGeldi} icon={MessageSquareText} title="İşleme Başlama SMS" onChange={(value) => update('whatsappEvrakGeldi', value)} />
              <ToggleRow checked={form.isEFaturaMukellefi} icon={FileText} title="E-Fatura" onChange={(value) => update('isEFaturaMukellefi', value)} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <TextField label="Luca Slug" value={form.lucaSlug} placeholder="edeler_yem" onChange={(value) => update('lucaSlug', value)} />
              <TextField label="Mihsap ID" value={form.mihsapId} placeholder="110564" onChange={(value) => update('mihsapId', value)} />
              <div>
                <FieldLabel>Mihsap Defter</FieldLabel>
                <select
                  value={form.mihsapDefterTuru}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((current) => ({
                      ...current,
                      mihsapDefterTuru: value,
                      defterTuru: value === 'DEFTER_BEYAN' ? 'ISLETME' : 'BILANCO',
                    }));
                  }}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="BILANCO">Bilanço</option>
                  <option value="DEFTER_BEYAN">Defter Beyan</option>
                </select>
              </div>
            </div>
          </Section>

          <Section icon={FileText} title="Notlar">
            <textarea
              value={form.notes}
              rows={3}
              placeholder="Not ekle..."
              onChange={(e) => update('notes', e.target.value)}
              className={textareaClass}
              style={inputStyle}
            />
          </Section>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <PreviewCard form={form} />
          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/panel/mukellef-listesi"
              className="inline-flex h-10 items-center justify-center rounded-[8px] text-[13px] font-bold"
              style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${LINE}`, color: MUTED }}
            >
              İptal
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] text-[13px] font-black disabled:opacity-45"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' }}
            >
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Kaydet
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[8px] p-4" style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 12px 30px rgba(0,0,0,0.14)' }}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[7px]" style={{ background: 'rgba(212,184,118,0.10)', border: '1px solid rgba(212,184,118,0.22)', color: GOLD }}>
          <Icon size={17} />
        </span>
        <h2 className="text-[15px] font-black" style={{ color: GOLD }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-[12px] font-bold" style={{ color: MUTED }}>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  className = '',
  type = 'text',
  required,
  placeholder,
  maxLength,
  inputMode,
  min,
  max,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'numeric' | 'text' | 'tel' | 'email' | 'decimal' | 'search' | 'url';
  min?: number;
  max?: number;
  mono?: boolean;
}) {
  return (
    <div className={className}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${mono ? 'font-mono tracking-[0.02em]' : ''}`}
        style={inputStyle}
      />
    </div>
  );
}

function SegmentButton({ active, icon: Icon, label, onClick, color }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] px-3 text-[13px] font-black transition"
      style={{
        background: active ? `${color}24` : 'rgba(255,255,255,0.028)',
        border: `1px solid ${active ? `${color}66` : 'rgba(255,255,255,0.085)'}`,
        color: active ? color : MUTED,
      }}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function ToggleRow({ checked, icon: Icon, title, onChange }: { checked: boolean; icon: LucideIcon; title: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-left transition"
      style={{
        background: checked ? 'rgba(34,197,94,0.11)' : 'rgba(255,255,255,0.028)',
        border: `1px solid ${checked ? 'rgba(34,197,94,0.30)' : 'rgba(255,255,255,0.085)'}`,
        color: checked ? '#7eeaa5' : MUTED,
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={16} />
        <span className="truncate text-[12.5px] font-black">{title}</span>
      </span>
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px]"
        style={{ background: checked ? GREEN : 'rgba(255,255,255,0.055)', color: checked ? '#052111' : FAINT }}
      >
        {checked ? <Check size={13} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

function PreviewCard({ form }: { form: FormState }) {
  const name = displayName(form);
  const type = taxpayerKind(form);
  const hasPhone = form.phones.some((phone) => phone.trim());
  const hasEmail = form.emails.some((email) => email.trim());

  return (
    <section className="rounded-[8px] p-4" style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 12px 30px rgba(0,0,0,0.14)' }}>
      <div className="flex h-[170px] items-center justify-center rounded-[7px]" style={{ background: 'rgba(79,134,201,0.24)', border: '1px solid rgba(79,134,201,0.22)' }}>
        <div className="flex h-20 w-20 items-center justify-center rounded-full text-[25px] font-black" style={{ background: 'rgba(255,255,255,0.16)', color: TEXT }}>
          {initials(name)}
        </div>
      </div>
      <div className="mt-4 flex items-start gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[20px] font-black leading-tight" style={{ color: TEXT }}>{name}</h2>
        <span
          className="rounded-[5px] px-2 py-1 text-[11px] font-black"
          style={{
            background: type === 'BASİT' ? 'rgba(245,158,11,0.16)' : type === 'FİRMA' ? 'rgba(79,134,201,0.18)' : 'rgba(24,174,226,0.18)',
            color: type === 'BASİT' ? AMBER : '#7fc2f0',
          }}
        >
          {type}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PresenceIcon active={!!form.taxNumber.trim()} icon={Landmark} title="VKN/TC" />
        <PresenceIcon active={!!form.defterTuru} icon={BookOpen} title="Defter" />
        <PresenceIcon active={hasEmail} icon={Mail} title="E-posta" />
        <PresenceIcon active={hasPhone} icon={Smartphone} title="Telefon" />
      </div>
      <div className="mt-4 grid gap-2 text-[12px] font-semibold" style={{ color: MUTED }}>
        <div className="flex min-w-0 items-center gap-2">
          <Landmark size={14} style={{ color: GOLD }} />
          <span className="truncate">{form.taxNumber || 'VKN/TC eksik'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <MapPin size={14} style={{ color: GOLD }} />
          <span className="truncate">{form.taxOffice || 'Vergi dairesi eksik'}</span>
        </div>
      </div>
    </section>
  );
}

function PresenceIcon({ active, icon: Icon, title }: { active: boolean; icon: LucideIcon; title: string }) {
  const color = active ? GREEN : ROSE;
  return (
    <span
      title={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      aria-label={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      className="inline-flex h-10 w-10 items-center justify-center rounded-[5px]"
      style={{
        background: active ? 'rgba(34,197,94,0.13)' : 'rgba(251,113,133,0.12)',
        border: `1px solid ${active ? 'rgba(34,197,94,0.32)' : 'rgba(251,113,133,0.32)'}`,
        color,
      }}
    >
      <Icon size={17} />
    </span>
  );
}
