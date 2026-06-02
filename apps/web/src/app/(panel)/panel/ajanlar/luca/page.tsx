'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Monitor,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  lucaSessionApi,
  type LucaCaptchaChallenge,
  type LucaSessionManagerStatus,
  type LucaWorkerAccount,
} from '@/lib/luca-session';

const GOLD = '#d4b876';
const SHOW_LUCA_WORKER_ACCOUNTS =
  process.env.NEXT_PUBLIC_LUCA_WORKER_ACCOUNTS_ENABLED === 'true';
type LucaDevice = LucaSessionManagerStatus['devices'][number];

function isClassicLucaUrl(url?: string | null) {
  return /auygs\.luca\.com\.tr\/Luca\//i.test(String(url || ''));
}

function isLucaLoginUrl(url?: string | null) {
  return /agiris\.luca\.com\.tr|LUCASSO/i.test(String(url || ''));
}

function deviceStatusLabel(device: LucaDevice) {
  if (!device.running) return 'pasif';
  if (isClassicLucaUrl(device.url)) return 'hazir';
  if (isLucaLoginUrl(device.url)) return 'giris ekrani';
  return 'klasik ekran degil';
}

function deviceStatusColor(device: LucaDevice) {
  if (!device.running) return '#fca5a5';
  if (isClassicLucaUrl(device.url)) return '#4ade80';
  if (isLucaLoginUrl(device.url)) return '#fbbf24';
  return '#93c5fd';
}

function deviceStatusDetail(device: LucaDevice) {
  if (isClassicLucaUrl(device.url)) return 'Klasik Luca ekrani hazir; mizan/fatura islemleri alinabilir';
  if (isLucaLoginUrl(device.url)) return 'Luca giris ekraninda; ajan otomatik giris veya klasik ekrana gecis deneyecek';
  return 'Agent acik, fakat klasik Luca ekrani bekleniyor';
}

export default function LucaSessionPage() {
  const qc = useQueryClient();
  const [captchaText, setCaptchaText] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['luca-session-manager'],
    queryFn: lucaSessionApi.status,
    refetchInterval: 2500,
  });

  const { data: challenges = [] } = useQuery({
    queryKey: ['luca-captcha-challenges'],
    queryFn: lucaSessionApi.challenges,
    refetchInterval: 5000,
  });

  const activeChallenge = data?.activeChallenge || null;
  const currentDeviceId =
    typeof window !== 'undefined' ? (window as any).__morenAutoAgent?.deviceId : null;
  const devices = data?.devices || [];
  const currentDevice = useMemo(
    () => devices.find((d) => d.id && d.id === currentDeviceId),
    [devices, currentDeviceId],
  );

  const answerMut = useMutation({
    mutationFn: (args: { id: string; answer: string }) =>
      lucaSessionApi.answerCaptcha(args.id, args.answer),
    onSuccess: () => {
      setCaptchaText('');
      toast.success('Güvenlik kodu agenta gönderildi');
      qc.invalidateQueries({ queryKey: ['luca-session-manager'] });
      qc.invalidateQueries({ queryKey: ['luca-captcha-challenges'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Kod gönderilemedi'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => lucaSessionApi.cancelCaptcha(id),
    onSuccess: () => {
      setCaptchaText('');
      toast.info('Güvenlik kodu isteği iptal edildi');
      qc.invalidateQueries({ queryKey: ['luca-session-manager'] });
      qc.invalidateQueries({ queryKey: ['luca-captcha-challenges'] });
    },
  });

  return (
    <div className="space-y-5 max-w-6xl">
      {/* === BASLIK (AI Maliyet imzasi — camgobegi/teal + altin temasi) === */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(45,212,191,0.18), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(212,184,118,0.14), transparent 45%), #0f0d0b',
        }}
      >
        {/* ust renk seridi */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #2dd4bf, #22d3ee, #5eead4, #d4b876)' }}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #2dd4bf, #0d9488)', boxShadow: '0 6px 18px rgba(45,212,191,0.35)' }}
            >
              <ShieldCheck size={22} style={{ color: '#07201c' }} />
            </span>
            Luca Oturum Yöneticisi
          </h1>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
            title="Yenile"
            style={{ background: 'rgba(45,212,191,0.16)', color: '#5eead4', border: '1px solid rgba(45,212,191,0.35)' }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Luca kullanan modüller için ortak oturum, cihaz ve güvenlik kodu paneli.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <StatusCard
          icon={KeyRound}
          title="Luca Şifresi"
          value={data?.credential?.saved ? data.credential.username || 'Kayıtlı' : 'Tanımlı değil'}
          tone={data?.credential?.saved ? 'ok' : 'warn'}
          detail={data?.credential?.saved ? `Üye no: ${data.credential.uyeNo || '-'}` : 'Ayarlar üzerinden tanımlanacak'}
        />
        <StatusCard
          icon={Bot}
          title="Bu Cihaz"
          value={currentDeviceId || 'Extension yok'}
          tone={currentDevice && isClassicLucaUrl(currentDevice.url) ? 'ok' : 'warn'}
          detail={currentDevice ? deviceStatusDetail(currentDevice) : 'Moren Auto-Agent bekleniyor'}
        />
        <StatusCard
          icon={Clock}
          title="Aktif Kod"
          value={activeChallenge ? 'Kod bekleniyor' : 'Bekleyen yok'}
          tone={activeChallenge ? 'warn' : 'ok'}
          detail={activeChallenge ? 'Kod portal içinde girilecek' : 'Luca CAPTCHA istediğinde burada görünecek'}
        />
      </div>

      {SHOW_LUCA_WORKER_ACCOUNTS ? <LucaWorkerAccountsPanel /> : null}

      {activeChallenge ? (
        <CaptchaPanel
          challenge={activeChallenge}
          value={captchaText}
          onChange={setCaptchaText}
          isSubmitting={answerMut.isPending}
          isCancelling={cancelMut.isPending}
          onSubmit={() => answerMut.mutate({ id: activeChallenge.id, answer: captchaText })}
          onCancel={() => cancelMut.mutate(activeChallenge.id)}
        />
      ) : (
        <div
          className="rounded-lg border p-5 flex items-center justify-between gap-4"
          style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Portal içinde güvenlik kodu hazır</div>
            <div className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.52)' }}>
              Fatura, mizan veya hesap planı çekiminde Luca kod isterse görsel burada açılacak.
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="px-3 py-2 rounded-md text-xs font-semibold flex items-center gap-2"
            style={{ background: 'rgba(45,212,191,0.16)', color: '#5eead4', border: '1px solid rgba(45,212,191,0.35)' }}
          >
            {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Yenile
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="relative overflow-hidden rounded-2xl border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #2dd4bf, rgba(45,212,191,0.2))' }} />
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'linear-gradient(135deg, #2dd4bf, #0d9488)', boxShadow: '0 4px 12px rgba(45,212,191,0.30)' }}>
              <Monitor size={14} style={{ color: '#07201c' }} />
            </span>
            Bağlı Cihazlar
          </h2>
          <div className="space-y-2">
            {devices.length === 0 ? (
              <EmptyLine text="Henüz Luca agent ping'i yok" />
            ) : (
              devices.map((d, i) => (
                <div key={`${d.id || 'unknown'}-${i}`} className="rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs" style={{ color: d.id === currentDeviceId ? GOLD : '#fafaf9' }}>{d.id || 'cihaz kimliği yok'}</span>
                    <span className="text-[11px]" style={{ color: deviceStatusColor(d) }}>
                      {deviceStatusLabel(d)}
                    </span>
                  </div>
                  <div className="text-[11px] mt-1 truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    Son ping: {new Date(d.lastPing).toLocaleTimeString('tr-TR')} · {d.url || 'url yok'}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #d4b876, rgba(212,184,118,0.2))' }} />
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'linear-gradient(135deg, #d4b876, #b8863a)', boxShadow: '0 4px 12px rgba(212,184,118,0.30)' }}>
              <CheckCircle2 size={14} style={{ color: '#1a1410' }} />
            </span>
            Son Güvenlik Kodları
          </h2>
          <p className="mb-3 text-[11px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.50)' }}>
            Bunlar girilecek kod degil; Luca'nin actigi guvenlik kodu istek kayitlaridir.
            Aktif olan kod ustte "Aktif Kod" olarak, gorseliyle birlikte acilir.
          </p>
          <div className="space-y-2">
            {challenges.length === 0 ? (
              <EmptyLine text="Henüz güvenlik kodu isteği yok" />
            ) : (
              challenges.slice(0, 8).map((ch) => (
                <div key={ch.id} className="rounded-md px-3 py-2 flex items-center justify-between gap-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="min-w-0">
                    <div className="text-xs font-mono truncate" style={{ color: '#fafaf9' }}>{ch.jobId || ch.id}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      {new Date(ch.createdAt).toLocaleString('tr-TR')}
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-1 rounded" style={statusPill(ch.status)}>
                    {statusLabel(ch.status)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function LucaWorkerAccountsPanel() {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['luca-worker-accounts'],
    queryFn: lucaSessionApi.workerAccounts,
  });

  const slots = useMemo(() => {
    const sorted = [...accounts].sort((a, b) => a.sortOrder - b.sortOrder);
    const blanks = Array.from({ length: Math.max(5 - sorted.length, 0) }, (_, i) => ({
      key: `new-${i}`,
      account: null as LucaWorkerAccount | null,
      slotIndex: sorted.length + i,
    }));
    return [
      ...sorted.map((account, i) => ({ key: account.id, account, slotIndex: i })),
      ...blanks,
    ];
  }, [accounts]);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #2dd4bf, #d4b876)' }} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'linear-gradient(135deg, #2dd4bf, #0d9488)', boxShadow: '0 4px 12px rgba(45,212,191,0.30)' }}>
              <Users size={14} style={{ color: '#07201c' }} />
            </span>
            Luca Kullanici Havuzu
          </h2>
          <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>
            5 Luca kullanicisini buradan tanimla; sifreler kaydedilirken sifreli tutulur.
          </div>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}
        >
          {accounts.filter((a) => a.isActive).length}/{Math.max(5, accounts.length)} aktif
        </span>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <EmptyLine text="Luca kullanicilari yukleniyor" />
        ) : (
          slots.map((slot) => (
            <LucaWorkerAccountRow
              key={slot.key}
              account={slot.account}
              slotIndex={slot.slotIndex}
            />
          ))
        )}
      </div>
    </section>
  );
}

function LucaWorkerAccountRow({
  account,
  slotIndex,
}: {
  account: LucaWorkerAccount | null;
  slotIndex: number;
}) {
  const qc = useQueryClient();
  const defaultName = `Luca ${slotIndex + 1}`;
  const [displayName, setDisplayName] = useState(account?.displayName || defaultName);
  const [uyeNo, setUyeNo] = useState(account?.uyeNo || '');
  const [username, setUsername] = useState(account?.username || '');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(account?.isActive ?? true);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setDisplayName(account?.displayName || defaultName);
    setUyeNo(account?.uyeNo || '');
    setUsername(account?.username || '');
    setPassword('');
    setIsActive(account?.isActive ?? true);
    setShowPassword(false);
  }, [account?.id, account?.displayName, account?.uyeNo, account?.username, account?.isActive, defaultName]);

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        displayName: displayName.trim(),
        uyeNo: uyeNo.trim(),
        username: username.trim(),
        password: password.trim() || undefined,
        isActive,
        sortOrder: slotIndex,
      };
      if (!payload.displayName || !payload.uyeNo || !payload.username) {
        throw new Error('Ad, uye no ve kullanici adi zorunlu');
      }
      if (!account && !payload.password) {
        throw new Error('Yeni Luca kullanicisi icin sifre zorunlu');
      }
      return account
        ? lucaSessionApi.updateWorkerAccount(account.id, payload)
        : lucaSessionApi.createWorkerAccount(payload);
    },
    onSuccess: () => {
      setPassword('');
      toast.success('Luca kullanicisi kaydedildi');
      qc.invalidateQueries({ queryKey: ['luca-worker-accounts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Kaydedilemedi'),
  });

  const deleteMut = useMutation({
    mutationFn: () => lucaSessionApi.deleteWorkerAccount(account!.id),
    onSuccess: () => {
      toast.info('Luca kullanicisi silindi');
      qc.invalidateQueries({ queryKey: ['luca-worker-accounts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Silinemedi'),
  });

  return (
    <div
      className="rounded-md border px-3 py-3"
      style={{ background: account ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.014)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_.9fr_1fr_1fr_auto] gap-2 items-end">
        <CompactField label="Gorunen Ad">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-2.5 py-2 rounded-md text-xs outline-none"
            style={inputStyle()}
          />
        </CompactField>
        <CompactField label="Uye No">
          <input
            value={uyeNo}
            onChange={(e) => setUyeNo(e.target.value)}
            className="w-full px-2.5 py-2 rounded-md text-xs outline-none"
            style={inputStyle()}
          />
        </CompactField>
        <CompactField label="Kullanici Adi">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-2.5 py-2 rounded-md text-xs outline-none"
            style={inputStyle()}
          />
        </CompactField>
        <CompactField label={account?.hasPassword ? 'Sifre (degistir)' : 'Sifre'}>
          <div className="flex">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              placeholder={account?.hasPassword ? 'mevcut korunur' : ''}
              className="w-full px-2.5 py-2 rounded-l-md text-xs outline-none"
              style={inputStyle()}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="px-2 rounded-r-md"
              style={{ ...inputStyle(), borderLeft: '0' }}
              title={showPassword ? 'Gizle' : 'Goster'}
            >
              {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </CompactField>

        <div className="flex items-center gap-2 xl:justify-end">
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
            className="h-9 px-3 rounded-md text-xs font-semibold"
            style={{
              background: isActive ? 'rgba(34,197,94,0.14)' : 'rgba(148,163,184,0.10)',
              color: isActive ? '#86efac' : 'rgba(250,250,249,0.48)',
              border: `1px solid ${isActive ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            {isActive ? 'Aktif' : 'Pasif'}
          </button>
          <button
            type="button"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: GOLD, color: '#111827' }}
          >
            {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Kaydet
          </button>
          {account ? (
            <button
              type="button"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (window.confirm(`${displayName} silinsin mi?`)) deleteMut.mutate();
              }}
              className="h-9 w-9 rounded-md inline-flex items-center justify-center disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.10)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.18)' }}
              title="Sil"
            >
              {deleteMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          ) : null}
        </div>
      </div>

      {account?.lastError ? (
        <div className="mt-2 text-[11px]" style={{ color: '#fca5a5' }}>
          Son hata: {account.lastError}
        </div>
      ) : null}
    </div>
  );
}

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase font-bold tracking-[.10em] mb-1" style={{ color: 'rgba(250,250,249,0.42)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'rgba(15,13,11,0.72)',
    color: '#fafaf9',
    border: '1px solid rgba(255,255,255,0.08)',
  };
}

function CaptchaPanel({
  challenge,
  value,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  isCancelling,
}: {
  challenge: LucaCaptchaChallenge;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  isCancelling: boolean;
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'rgba(212,184,118,0.075)', borderColor: 'rgba(212,184,118,0.32)' }}>
      <div className="flex flex-col lg:flex-row gap-5 lg:items-center">
        <div className="rounded-lg p-3 inline-flex items-center justify-center" style={{ background: '#f8fafc', minWidth: 220 }}>
          {challenge.captchaImage ? (
            <img src={challenge.captchaImage} alt="Luca güvenlik kodu" style={{ maxWidth: 260, maxHeight: 120, objectFit: 'contain' }} />
          ) : (
            <span className="text-xs text-slate-500">Görsel bekleniyor</span>
          )}
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold" style={{ color: '#fafaf9' }}>Luca güvenlik kodu gerekiyor</div>
          <div className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.62)' }}>
            Kod Luca sekmesinde değil, burada girilecek. Agent cevabı alıp arka plandaki Luca ekranına uygulayacak.
          </div>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim().length >= 3) onSubmit();
              }}
              autoFocus
              placeholder="Güvenlik kodu"
              className="px-3 py-2 rounded-md text-sm outline-none"
              style={{ background: 'rgba(15,13,11,0.9)', color: '#fafaf9', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <button
              disabled={isSubmitting || value.trim().length < 3}
              onClick={onSubmit}
              className="px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: GOLD, color: '#111827' }}
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Devam Et
            </button>
            <button
              disabled={isCancelling}
              onClick={onCancel}
              className="px-3 py-2 rounded-md text-sm font-semibold flex items-center justify-center gap-2"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.72)' }}
            >
              <X size={14} />
              İptal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: any;
  title: string;
  value: string;
  detail: string;
  tone: 'ok' | 'warn';
}) {
  const color = tone === 'ok' ? '#4ade80' : '#fbbf24';
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{ borderColor: `${color}40`, background: `linear-gradient(135deg, ${color}26, ${color}0a 58%, rgba(255,255,255,0.02))` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase font-bold tracking-[.12em]" style={{ color }}>{title}</span>
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${color}22`, border: `1px solid ${color}40` }}>
          <Icon size={14} style={{ color }} />
        </span>
      </div>
      <div className="mt-3 text-sm font-semibold truncate" style={{ color: '#fafaf9' }}>{value}</div>
      <div className="mt-1 text-xs truncate" style={{ color: 'rgba(250,250,249,0.5)' }}>{detail}</div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-md px-3 py-3 text-xs" style={{ background: 'rgba(255,255,255,0.025)', color: 'rgba(250,250,249,0.45)' }}>
      {text}
    </div>
  );
}

function statusLabel(status: string) {
  if (status === 'pending') return 'bekliyor';
  if (status === 'answered') return 'girildi';
  if (status === 'consumed') return 'kullanıldı';
  if (status === 'expired') return 'süresi doldu';
  if (status === 'cancelled') return 'iptal';
  return status;
}

function statusPill(status: string): React.CSSProperties {
  if (status === 'pending') return { background: 'rgba(245,158,11,0.14)', color: '#fbbf24' };
  if (status === 'answered') return { background: 'rgba(59,130,246,0.14)', color: '#93c5fd' };
  if (status === 'consumed') return { background: 'rgba(34,197,94,0.14)', color: '#86efac' };
  return { background: 'rgba(148,163,184,0.14)', color: '#cbd5e1' };
}
