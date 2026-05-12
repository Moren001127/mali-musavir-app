'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { lucaSessionApi, type LucaCaptchaChallenge, type LucaSessionManagerStatus } from '@/lib/luca-session';

const GOLD = '#d4b876';
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
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <ShieldCheck size={10} className="inline mr-1" /> Luca
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          Luca Oturum Yöneticisi
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.48)' }}>
          Luca kullanan modüller için ortak oturum, cihaz ve güvenlik kodu paneli.
        </p>
      </div>

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
            style={{ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.28)' }}
          >
            {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Yenile
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <Monitor size={15} style={{ color: GOLD }} /> Bağlı Cihazlar
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

        <section className="rounded-lg border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <CheckCircle2 size={15} style={{ color: GOLD }} /> Son Güvenlik Kodları
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
    <div className="rounded-lg border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 text-[11px] uppercase font-bold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.46)' }}>
        <Icon size={13} style={{ color }} /> {title}
      </div>
      <div className="mt-2 text-sm font-semibold truncate" style={{ color: '#fafaf9' }}>{value}</div>
      <div className="mt-1 text-xs truncate" style={{ color: 'rgba(250,250,249,0.48)' }}>{detail}</div>
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
