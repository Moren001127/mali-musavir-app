'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck, X, RefreshCw, Lock, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

/**
 * SystemHealthBell — Top-bar'da sistemin sağlık durumunu gösterir.
 *
 * Davranış:
 *   - Her 30 sn `/system/health` endpoint'ini sorgular
 *   - Açık (resolved=false) check'leri severity'ye göre renklendirir
 *   - Kritik sorun varsa kırmızı pulse animation + browser tab title prefix
 *   - Tıklayınca detaylı modal — her uyarı için "neden" + "ne yapmalı"
 *   - Admin için "Şimdi Kontrol Et" butonu (cron'u beklemeden tetik)
 */
export default function SystemHealthBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{
    summary: {
      total: number;
      critical: number;
      warning: number;
      ok: number;
      lastCheck: string | null;
    };
    checks: Array<{
      id: string;
      type: string;
      severity: 'OK' | 'WARNING' | 'CRITICAL';
      status: string;
      message: string;
      detail: any;
      acilTavsiye: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }>({
    queryKey: ['system-health'],
    queryFn: () => api.get('/system/health').then((r) => r.data),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const runNow = useMutation({
    mutationFn: () => api.post('/system/health/run-now').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-health'] }),
  });

  const critical = data?.summary?.critical ?? 0;
  const warning = data?.summary?.warning ?? 0;
  const total = critical + warning;

  // Tab title — kritik sorun varsa "(!) Moren Portal"
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.title.replace(/^\(!\)\s*/, '');
    if (critical > 0) {
      document.title = `(!) ${original}`;
    } else {
      document.title = original;
    }
  }, [critical]);

  // Renk + ikon
  const isCritical = critical > 0;
  const isWarning = warning > 0 && critical === 0;
  const isOk = critical === 0 && warning === 0 && !isLoading;

  const buttonColor = isCritical ? '#f43f5e' : isWarning ? '#f59e0b' : 'rgba(250,250,249,0.7)';
  const Icon = isOk ? ShieldCheck : AlertTriangle;

  // Severity sıralı liste
  const sorted = useMemo(() => {
    if (!data?.checks) return [];
    const order = { CRITICAL: 0, WARNING: 1, OK: 2 } as const;
    return [...data.checks].sort(
      (a, b) =>
        order[a.severity] - order[b.severity] ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [data?.checks]);

  // v1.36.44: Kilitli modül drift'i için özel prominent banner
  const moduleHashCheck = useMemo(
    () =>
      (data?.checks || []).find(
        (c) => c.type === 'MODULE_HASH' && c.severity === 'CRITICAL',
      ),
    [data?.checks],
  );
  const driftCount = (moduleHashCheck?.detail as any)?.mismatches?.length || 0;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Yeni drift gelirse banner tekrar açılır
  useEffect(() => {
    if (driftCount > 0) setBannerDismissed(false);
  }, [driftCount, moduleHashCheck?.id]);

  return (
    <>
      {/* Pulse animation CSS — tek seferlik enjekte */}
      <style jsx global>{`
        @keyframes morenHealthPulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.65);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(244, 63, 94, 0);
          }
        }
      `}</style>

      {/* v1.36.44: Kilitli modül drift banner — sayfa üstünde sabit, dismiss edilebilir.
          Yeni drift gelirse otomatik tekrar görünür. */}
      {driftCount > 0 && !bannerDismissed && (
        <div
          className="fixed top-0 left-0 right-0 z-[200] px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg"
          style={{
            background: 'linear-gradient(90deg, rgba(244,63,94,0.92), rgba(220,38,38,0.92))',
            color: '#fff',
            borderBottom: '1px solid rgba(0,0,0,0.3)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Lock size={16} className="shrink-0" />
            <div className="text-[13px] truncate">
              <span className="font-bold">KİLİTLİ MODÜL DRİFT — </span>
              <span>{driftCount} dosya beklenmedik şekilde değişmiş.</span>
              <span className="opacity-80 ml-1">Kasıtlıysa baseline güncelle, değilse revert et.</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/panel/sistem/kilitli-moduller"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all hover:opacity-90"
              style={{ background: '#fff', color: '#dc2626' }}
            >
              <ExternalLink size={12} /> Kontrol Et
            </Link>
            <button
              onClick={() => setBannerDismissed(true)}
              className="w-7 h-7 rounded flex items-center justify-center hover:bg-white/15"
              title="Geçici olarak kapat"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* v1.36.78: Sağ üst sistem sağlık göstergesi — TIKLANMAZ.
          Sadece görsel uyarı; detay için Gösterge Paneli'ndeki Kritik Uyarı kartı kullanılır. */}
      <div
        className="relative w-9 h-9 rounded-lg flex items-center justify-center cursor-default"
        style={{
          border: `1px solid ${isCritical ? 'rgba(244,63,94,0.5)' : 'rgba(255,255,255,0.05)'}`,
          background: isCritical ? 'rgba(244,63,94,0.1)' : 'transparent',
          animation: isCritical ? 'morenHealthPulse 1.5s infinite' : 'none',
        }}
        title={
          isOk
            ? 'Sistem sağlıklı'
            : isCritical
            ? `${critical} kritik sorun — Gösterge Paneli'nde Kritik Uyarı kartını aç`
            : `${warning} uyarı — Gösterge Paneli'nde Kritik Uyarı kartını aç`
        }
      >
        <Icon size={16} style={{ color: buttonColor }} />
        {total > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ background: isCritical ? '#f43f5e' : '#f59e0b' }}
          >
            {total > 9 ? '9+' : total}
          </span>
        )}
      </div>

      {/* MODAL */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-16"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
              background: 'rgb(15,13,11)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
            >
              <div className="flex items-center gap-3">
                <Icon size={18} style={{ color: buttonColor }} />
                <div>
                  <h3 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>
                    Sistem Sağlık Durumu
                  </h3>
                  <p className="text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    {isOk
                      ? 'Tüm sistemler sağlıklı'
                      : `${critical} kritik · ${warning} uyarı`}
                    {data?.summary?.lastCheck && (
                      <>
                        {' · son kontrol: '}
                        {new Date(data.summary.lastCheck).toLocaleTimeString('tr-TR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => runNow.mutate()}
                  disabled={runNow.isPending}
                  className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                  style={{
                    background: 'rgba(212,184,118,0.15)',
                    border: '1px solid rgba(212,184,118,0.3)',
                    color: '#d4b876',
                  }}
                >
                  <RefreshCw
                    size={12}
                    className={runNow.isPending ? 'animate-spin' : ''}
                  />
                  Şimdi Kontrol Et
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <X size={14} style={{ color: 'rgba(250,250,249,0.7)' }} />
                </button>
              </div>
            </div>

            {/* İçerik */}
            <div className="max-h-[70vh] overflow-y-auto">
              {isLoading && !data && (
                <div className="px-5 py-12 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  Yükleniyor...
                </div>
              )}
              {!isLoading && sorted.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <ShieldCheck
                    size={48}
                    style={{ color: '#10b981', margin: '0 auto 12px' }}
                  />
                  <h4 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
                    Tüm sistemler sağlıklı
                  </h4>
                  <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    Aktif uyarı yok. Sistem her 5 dakikada bir kontrol ediliyor.
                  </p>
                </div>
              )}
              {sorted.length > 0 && (
                <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  {sorted.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CheckRow({ check: c }: { check: any }) {
  const sev = c.severity as 'OK' | 'WARNING' | 'CRITICAL';
  const color = sev === 'CRITICAL' ? '#f43f5e' : sev === 'WARNING' ? '#f59e0b' : '#10b981';
  const bg = sev === 'CRITICAL' ? 'rgba(244,63,94,0.06)' : sev === 'WARNING' ? 'rgba(245,158,11,0.06)' : 'transparent';
  const label = sev === 'CRITICAL' ? 'KRİTİK' : sev === 'WARNING' ? 'UYARI' : 'OK';

  const TYPE_LABEL: Record<string, string> = {
    AGENT_PING_MIHSAP: 'Mihsap Agent',
    AGENT_PING_LUCA: 'Luca Agent',
    LUCA_TOKEN_AGE: 'Luca Oturumu',
    MIHSAP_TOKEN_AGE: 'Mihsap Oturumu',
    PENDING_QUEUE: 'İş Kuyruğu',
    FAILED_RATIO: 'Başarısızlık Oranı',
    MODULE_HASH: 'Kilitli Modül Hash',
    AGENT_VERSION: 'Agent Sürümü',
    DB_HEALTH: 'Veritabanı',
  };

  return (
    <div className="px-5 py-3" style={{ background: bg }}>
      <div className="flex items-start gap-3">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded"
          style={{
            color,
            background: `${color}1a`,
            border: `1px solid ${color}40`,
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
            {TYPE_LABEL[c.type] || c.type}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,0.7)' }}>
            {c.message}
          </p>
          {c.acilTavsiye && (
            <p
              className="text-[11px] mt-1.5 italic"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              → {c.acilTavsiye}
            </p>
          )}
          {c.detail?.mismatches && Array.isArray(c.detail.mismatches) && (
            <ul className="text-[11px] mt-1.5 ml-3 space-y-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              {c.detail.mismatches.slice(0, 5).map((m: string, i: number) => (
                <li key={i}>• {m}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
