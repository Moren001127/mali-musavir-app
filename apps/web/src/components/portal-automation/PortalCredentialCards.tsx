'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  PortalCredentialPublic,
  PortalProvider,
  portalAutomationApi,
} from '@/lib/portal-automation';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const STEEL_BR = '#74a6e6';
const STEEL_SF = 'rgba(79,134,201,0.13)';
const STEEL_LN = 'rgba(79,134,201,0.32)';
const LINE = 'rgba(255,255,255,0.08)';
const LINE_GOLD = 'rgba(212,184,118,0.24)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const SOFT = 'rgba(255,255,255,0.035)';

type FieldSpec = {
  key: 'username' | 'userCode' | 'workplaceCode';
  label: string;
  placeholder?: string;
};

type PasswordSpec = {
  // GIB_EBEYANNAME yeni UI'de "Parola" alani kaldirildi; null = field gosterme.
  passwordLabel: string | null;
  secondaryPasswordLabel: string;
};

const PROVIDER_TITLES: Record<PortalProvider, string> = {
  GIB_EBEYANNAME: 'Mali Müşavir Sistem Şifresi',
  GIB_IVD: 'Vergi Dairesi Şifresi',
  SGK_EBILDIRGE: 'SGK e-Bildirge Girişi',
};

const FIELD_SPECS: Record<PortalProvider, FieldSpec[]> = {
  GIB_EBEYANNAME: [{ key: 'userCode', label: 'Kullanıcı kodu' }],
  GIB_IVD: [{ key: 'userCode', label: 'Kullanıcı kodu' }],
  SGK_EBILDIRGE: [{ key: 'username', label: 'Kullanıcı adı / E-Kod' }],
};

const PASSWORD_SPECS: Record<PortalProvider, PasswordSpec> = {
  GIB_EBEYANNAME: { passwordLabel: null, secondaryPasswordLabel: 'Şifre' }, // YENI GIB UI'sinde Parola alani yok
  GIB_IVD: { passwordLabel: null, secondaryPasswordLabel: 'Şifre' },
  SGK_EBILDIRGE: { passwordLabel: 'Sistem şifresi', secondaryPasswordLabel: 'İşyeri şifresi' },
};

function getCredential(rows: PortalCredentialPublic[], provider: PortalProvider, taxpayerId?: string) {
  if (provider === 'GIB_EBEYANNAME') {
    return rows.find((credential) => credential.provider === provider && credential.ownerType === 'TENANT') || null;
  }
  return rows.find((credential) => credential.provider === provider && credential.taxpayerId === taxpayerId) || null;
}

export function AdvisorPortalCredentialCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-automation-credentials'],
    queryFn: () => portalAutomationApi.credentials(),
  });
  const credential = useMemo(
    () => getCredential(data?.rows || [], 'GIB_EBEYANNAME'),
    [data?.rows],
  );

  return (
    <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
      <CardHeader
        icon={KeyRound}
        title="Mali Müşavir e-Beyanname Şifresi"
        subtitle="e-Beyanname sistem girişi için kayıtlı bilgiler"
      />
      {isLoading ? <LoadingLine /> : <CredentialEditor provider="GIB_EBEYANNAME" credential={credential} />}
    </section>
  );
}

export function TaxpayerPortalCredentialsCard({ taxpayerId, provider }: { taxpayerId: string; provider?: Extract<PortalProvider, 'GIB_IVD' | 'SGK_EBILDIRGE'> }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-automation-credentials'],
    queryFn: () => portalAutomationApi.credentials(),
    enabled: !!taxpayerId,
  });

  const gibCredential = useMemo(
    () => getCredential(data?.rows || [], 'GIB_IVD', taxpayerId),
    [data?.rows, taxpayerId],
  );
  const sgkCredential = useMemo(
    () => getCredential(data?.rows || [], 'SGK_EBILDIRGE', taxpayerId),
    [data?.rows, taxpayerId],
  );

  if (provider) {
    const credential = provider === 'GIB_IVD' ? gibCredential : sgkCredential;
    return isLoading ? <LoadingLine /> : <CredentialEditor provider={provider} taxpayerId={taxpayerId} credential={credential} compact />;
  }

  return (
    <section>
      <CardHeader
        icon={ShieldCheck}
        accent="steel"
        title="Vergi ve SGK Şifreleri"
        subtitle="Bu mükellefin portal giriş bilgileri"
      />
      {isLoading ? (
        <LoadingLine />
      ) : (
        <div className="grid gap-3">
          <CredentialEditor provider="GIB_IVD" taxpayerId={taxpayerId} credential={gibCredential} compact />
          <CredentialEditor provider="SGK_EBILDIRGE" taxpayerId={taxpayerId} credential={sgkCredential} compact />
        </div>
      )}
    </section>
  );
}

function CredentialEditor({
  provider,
  taxpayerId,
  credential,
  compact,
}: {
  provider: PortalProvider;
  taxpayerId?: string;
  credential: PortalCredentialPublic | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [userCode, setUserCode] = useState('');
  const [workplaceCode, setWorkplaceCode] = useState('');
  const [password, setPassword] = useState('');
  const [secondaryPassword, setSecondaryPassword] = useState('');

  useEffect(() => {
    setUsername(credential?.username || '');
    setUserCode(credential?.userCode || '');
    setWorkplaceCode(credential?.workplaceCode || '');
    setPassword(credential?.password || '');
    setSecondaryPassword(credential?.secondaryPassword || '');
  }, [
    credential?.id,
    credential?.username,
    credential?.userCode,
    credential?.workplaceCode,
    credential?.password,
    credential?.secondaryPassword,
  ]);

  const passwordSpec = PASSWORD_SPECS[provider];
  const fields: FieldSpec[] = provider === 'SGK_EBILDIRGE'
    ? [
        { key: 'username', label: 'Kullanici adi' },
        { key: 'workplaceCode', label: 'E-Kod', placeholder: 'Orn. 2' },
      ]
    : FIELD_SPECS[provider];

  const saveMut = useMutation({
    mutationFn: () =>
      portalAutomationApi.saveCredential({
        provider,
        taxpayerId: provider === 'GIB_EBEYANNAME' ? undefined : taxpayerId,
        username: fields.some((field) => field.key === 'username') ? username : '',
        userCode: fields.some((field) => field.key === 'userCode') ? userCode : '',
        officeCode: '',
        workplaceCode: fields.some((field) => field.key === 'workplaceCode') ? workplaceCode : '',
        password: passwordSpec.passwordLabel ? password : '',
        secondaryPassword,
        isActive: true,
      }),
    onSuccess: (result) => {
      if (result.validation?.checked && result.validation.ok) {
        toast.success('Şifre kaydedildi ve doğrulandı');
      } else if (result.validation?.checked && !result.validation.ok) {
        toast.warning(`Şifre kaydedildi, doğrulama başarısız: ${result.validation.error || 'Portal girişi reddedildi'}`);
      } else {
        toast.success('Şifre kaydı güncellendi');
      }
      qc.invalidateQueries({ queryKey: ['portal-automation-credentials'] });
      qc.invalidateQueries({ queryKey: ['portal-automation-credential-insights'] });
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      qc.invalidateQueries({ queryKey: ['beyan-config-list'] });
      qc.invalidateQueries({ queryKey: ['beyanname-ozet'] });
      qc.invalidateQueries({ queryKey: ['beyanname-takip'] });
      qc.invalidateQueries({ queryKey: ['beyanname-takip-configs'] });
      qc.invalidateQueries({ queryKey: ['taxpayer-completeness', taxpayerId] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || error?.message || 'Şifre kaydedilemedi'),
  });

  const hasIdentity = provider === 'SGK_EBILDIRGE' ? username.trim() && workplaceCode.trim() : userCode.trim();
  const disabled =
    saveMut.isPending ||
    (provider !== 'GIB_EBEYANNAME' && !taxpayerId) ||
    !hasIdentity ||
    (!credential && (
      passwordSpec.passwordLabel
        ? (!password || !secondaryPassword)
        : !secondaryPassword
    ));

  return (
    <div className="rounded-xl border p-4" style={{ background: compact ? 'rgba(255,255,255,0.025)' : SOFT, borderColor: LINE }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: TEXT }}>{PROVIDER_TITLES[provider]}</h3>
          <p className="mt-0.5 text-[11.5px]" style={{ color: credential ? '#86efac' : MUTED }}>
            {credential ? 'Kayıtlı' : 'Kayıt yok'}
          </p>
        </div>
        {credential?.lastSuccessAt && (
          <span className="rounded-md border px-2 py-1 text-[10.5px] font-semibold" style={{ borderColor: 'rgba(134,239,172,0.25)', background: 'rgba(34,197,94,0.10)', color: '#86efac' }}>
            Çalışıyor
          </span>
        )}
      </div>

      <div className="grid gap-3">
        {provider === 'SGK_EBILDIRGE' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextInput label="Kullanici adi" value={username} onChange={setUsername} />
            <TextInput label="E-Kod" value={workplaceCode} onChange={setWorkplaceCode} placeholder="Orn. 2" />
          </div>
        ) : (
          fields.map((field) => (
            <TextInput
              key={field.key}
              label={field.label}
              value={field.key === 'username' ? username : field.key === 'workplaceCode' ? workplaceCode : userCode}
              onChange={field.key === 'username' ? setUsername : field.key === 'workplaceCode' ? setWorkplaceCode : setUserCode}
              placeholder={field.placeholder}
            />
          ))
        )}
        {provider === 'SGK_EBILDIRGE' && passwordSpec.passwordLabel ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PasswordInput
              label={passwordSpec.passwordLabel}
              value={password}
              onChange={setPassword}
              hasSaved={!!credential?.hasPassword}
            />
            <PasswordInput
              label={passwordSpec.secondaryPasswordLabel}
              value={secondaryPassword}
              onChange={setSecondaryPassword}
              hasSaved={!!credential?.hasSecondaryPassword}
            />
          </div>
        ) : (
          <>
            {passwordSpec.passwordLabel && (
              <PasswordInput
                label={passwordSpec.passwordLabel}
                value={password}
                onChange={setPassword}
                hasSaved={!!credential?.hasPassword}
              />
            )}
            <PasswordInput
              label={passwordSpec.secondaryPasswordLabel}
              value={secondaryPassword}
              onChange={setSecondaryPassword}
              hasSaved={!!credential?.hasSecondaryPassword}
            />
          </>
        )}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => saveMut.mutate()}
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[12.5px] font-bold transition disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
      >
        {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Şifreyi Kaydet
      </button>
    </div>
  );
}

function CardHeader({ icon: Icon, title, subtitle, accent = 'gold' }: { icon: React.ElementType; title: string; subtitle: string; accent?: 'gold' | 'steel' }) {
  const aColor = accent === 'steel' ? STEEL_BR : GOLD;
  const aBg = accent === 'steel' ? STEEL_SF : 'rgba(212,184,118,0.09)';
  const aLine = accent === 'steel' ? STEEL_LN : LINE_GOLD;
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ borderColor: aLine, background: aBg, color: aColor }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</h2>
        <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>{subtitle}</p>
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold" style={{ color: MUTED }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border px-3 text-sm outline-none"
        style={{ background: SOFT, borderColor: LINE, color: TEXT }}
      />
    </label>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  hasSaved,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hasSaved: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold" style={{ color: MUTED }}>{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={hasSaved ? 'Kayitli - degistirmek icin yaz' : ''}
          className="h-10 w-full rounded-lg border px-3 pr-10 text-sm outline-none placeholder:text-transparent"
          style={{ background: SOFT, borderColor: LINE, color: TEXT }}
        />
        {hasSaved && !value && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm tracking-[0.18em]" style={{ color: MUTED }}>
            &bull;&bull;&bull;&bull;&bull;&bull;
          </span>
        )}
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition hover:bg-white/[0.06]"
          style={{ color: MUTED }}
          title={visible ? 'Sifreyi gizle' : 'Sifreyi goster'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}

function LoadingLine() {
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
      <Loader2 size={14} className="animate-spin" />
      Yükleniyor...
    </div>
  );
}
