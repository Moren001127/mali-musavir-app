'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, ShieldCheck, X, Lock, Bot, Bell, ChevronRight } from 'lucide-react';
import Link from 'next/link';

const GOLD = '#d4b876';

interface HealthCheck {
  id: string;
  type: string;
  severity: 'OK' | 'WARNING' | 'CRITICAL';
  status: string;
  message: string;
  acilTavsiye: string | null;
  detail: any;
  createdAt: string;
  updatedAt: string;
}

interface HealthData {
  summary: {
    total: number;
    critical: number;
    warning: number;
    ok: number;
    lastCheck: string | null;
  };
  checks: HealthCheck[];
}

/**
 * v1.36.78: Kritik Uyarı stat kartı — gösterge panelindeki 4. kart.
 * Tıklayınca açılan modal içerik:
 *  - Sistem sağlık uyarıları (mevcut SystemHealthCheck verisi)
 *  - Kilitli modül drift uyarıları (MODULE_HASH severity)
 *  - Ajan hataları (bugün)
 *  - Okunmamış bildirimler sayısı
 * Sağ üst sistem sağlık çanı tıklanmaz hâle getirildi → kullanıcı buradan detay görür.
 */
export function KritikUyariStatCard() {
  const [open, setOpen] = useState(false);

  const { data: health } = useQuery<HealthData>({
    queryKey: ['system-health'],
    queryFn: () => api.get('/system/health').then((r) => r.data),
    refetchInterval: 30_000,
  });

  // Yalnız KRİTİK tipteki okunmamışlar bu karta sayılır — rutin bildirimler
  // zilde kalır (eskiden tüm okunmamışlar kritik görünüyordu).
  const { data: unreadSummary } = useQuery<{ total: number; critical: number }>({
    queryKey: ['notifications', 'unread-summary'],
    queryFn: () => api.get('/notifications/unread-summary').then((r) => r.data).catch(() => ({ total: 0, critical: 0 })),
    refetchInterval: 30_000,
  });

  const { data: agentEvents = [] } = useQuery<any[]>({
    queryKey: ['agent-events', 'today-errors'],
    queryFn: () => api.get('/agent/events?limit=200').then((r) => r.data).catch(() => []),
    refetchInterval: 30_000,
  });

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  }, []);

  const todayErrors = useMemo(() => {
    const events = Array.isArray(agentEvents)
      ? agentEvents
      : Array.isArray((agentEvents as any)?.items)
        ? (agentEvents as any).items
        : Array.isArray((agentEvents as any)?.data)
          ? (agentEvents as any).data
          : [];

    return events.filter((e: any) => {
      const r = e.ts || e.createdAt || e.timestamp;
      if (!r || new Date(r) < todayStart) return false;
      const status = String(e.status || '').toUpperCase();
      return ['HATA', 'ERROR', 'FAIL', 'FAILED', 'HATALI'].includes(status);
    });
  }, [agentEvents, todayStart]);

  const allHealthChecks = useMemo(() => health?.checks || [], [health?.checks]);
  const moduleHashCheck = useMemo(
    () => allHealthChecks.find(
      (c) => (c.type === 'MODULE_HASH' || c.type === 'LOCKED_MODULES') && c.severity !== 'OK'
    ),
    [allHealthChecks],
  );
  const regularHealthChecks = useMemo(
    () => allHealthChecks.filter((c) => c.severity !== 'OK' && c.id !== moduleHashCheck?.id),
    [allHealthChecks, moduleHashCheck?.id],
  );
  const critical = regularHealthChecks.filter((c) => c.severity === 'CRITICAL').length;
  const warning = regularHealthChecks.filter((c) => c.severity === 'WARNING').length;
  const moduleHashCritical = moduleHashCheck?.severity === 'CRITICAL' ? 1 : 0;
  const moduleHashWarning = moduleHashCheck && moduleHashCheck.severity !== 'CRITICAL' ? 1 : 0;
  const criticalNotifCount = unreadSummary?.critical ?? 0;

  // Ajan hataları "uyarı" seviyesidir (kritik değil) — kart her gün kırmızı yanmasın.
  const criticalCount = critical + moduleHashCritical + criticalNotifCount;
  const totalUyari = criticalCount + warning + moduleHashWarning + todayErrors.length;
  const hasIssue = totalUyari > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-left rounded-2xl p-5 transition-all hover:scale-[1.02] cursor-pointer"
        style={{
          background: hasIssue
            ? 'linear-gradient(135deg, rgba(244,63,94,0.10), rgba(244,63,94,0.04))'
            : 'rgba(255,255,255,0.02)',
          border: `1px solid ${hasIssue ? 'rgba(244,63,94,0.30)' : 'rgba(255,255,255,0.05)'}`,
          animation: criticalCount > 0 ? 'moren-banner-pulse 2.8s ease-in-out infinite' : 'none',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: hasIssue ? '#f43f5e' : 'rgba(250,250,249,0.55)' }}>
            <AlertTriangle size={12} />
            <span>Kritik Uyarı</span>
            {criticalCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full ml-auto"
                style={{ background: '#f43f5e', boxShadow: '0 0 8px rgba(244,63,94,0.8)' }} />
            )}
          </div>
        </div>
        <p className="leading-none tabular-nums" style={{
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontSize: 26,
          fontWeight: 900,
          letterSpacing: 0,
          color: hasIssue ? '#f43f5e' : '#fafaf9',
        }}>
          {totalUyari}
        </p>
        <p className="text-[11.5px] mt-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
          {totalUyari === 0 ? 'Sorun yok — her şey yolunda' : (
            <>
              {critical > 0 && <span>{critical} sistem · </span>}
              {warning > 0 && <span>{warning} sistem uyarı · </span>}
              {moduleHashCheck && <span>1 kilit drift · </span>}
              {todayErrors.length > 0 && <span>{todayErrors.length} ajan hata · </span>}
              {criticalNotifCount > 0 && <span>{criticalNotifCount} kritik bildirim</span>}
            </>
          )}
        </p>
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[80vh] flex flex-col"
            style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2.5">
                <AlertTriangle size={16} style={{ color: hasIssue ? '#f43f5e' : '#22c55e' }} />
                <h2 className="text-[16px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
                  Kritik Uyarı Detayı
                </h2>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/5">
                <X size={16} style={{ color: 'rgba(250,250,249,0.5)' }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {totalUyari === 0 ? (
                <div className="text-center py-10">
                  <ShieldCheck size={32} className="mx-auto mb-3" style={{ color: '#22c55e' }} />
                  <p className="text-[14px]" style={{ color: '#fafaf9', fontWeight: 600 }}>
                    Her şey yolunda
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    Açık sistem uyarısı, kilit drift'i veya bekleyen kritik bildirim yok.
                  </p>
                </div>
              ) : (
                <>
                  {/* Sistem Sağlık */}
                  {(regularHealthChecks.length > 0) && (
                    <UyariBolumu
                      icon={ShieldCheck}
                      baslik="Sistem Sağlık Uyarıları"
                      sayi={regularHealthChecks.length}
                      renk={critical > 0 ? '#f43f5e' : '#7dd3fc'}
                    >
                      {regularHealthChecks
                        .slice(0, 5)
                        .map((c) => (
                          <UyariSatir
                            key={c.id}
                            renk={c.severity === 'CRITICAL' ? '#f43f5e' : '#7dd3fc'}
                            etiket={c.severity}
                            mesaj={c.message}
                            altMesaj={c.acilTavsiye || undefined}
                          />
                        ))}
                    </UyariBolumu>
                  )}

                  {/* Kilitli Modül Drift */}
                  {moduleHashCheck && (
                    <UyariBolumu
                      icon={Lock}
                      baslik="Kilitli Modül Değişikliği"
                      sayi={1}
                      renk="#f43f5e"
                    >
                      <UyariSatir
                        renk="#f43f5e"
                        etiket="DRIFT"
                        mesaj={moduleHashCheck.message}
                        altMesaj={moduleHashCheck.acilTavsiye || 'Kilitli modüllerde beklenmedik değişiklik tespit edildi'}
                      />
                      <Link
                        href="/panel/sistem/kilitli-moduller"
                        className="inline-flex items-center gap-1 text-[11.5px] font-semibold mt-2"
                        style={{ color: GOLD }}
                      >
                        Kilitli Modüller sayfasına git <ChevronRight size={12} />
                      </Link>
                    </UyariBolumu>
                  )}

                  {/* Ajan Hataları */}
                  {todayErrors.length > 0 && (
                    <UyariBolumu
                      icon={Bot}
                      baslik="Bugün Ajan Hataları"
                      sayi={todayErrors.length}
                      renk="#7dd3fc"
                    >
                      {todayErrors.slice(0, 5).map((e: any, i: number) => (
                        <UyariSatir
                          key={i}
                          renk="#7dd3fc"
                          etiket={e.agent || 'AJAN'}
                          mesaj={e.message || e.action || 'Hata oluştu'}
                          altMesaj={e.mukellef || undefined}
                        />
                      ))}
                    </UyariBolumu>
                  )}

                  {/* Kritik Bildirimler (yalnız kritik tipler — şifre hatası, Luca hatası, e-Tebligat, vergi süresi, yeni cihaz, AI tavan) */}
                  {criticalNotifCount > 0 && (
                    <UyariBolumu
                      icon={Bell}
                      baslik="Kritik Bildirimler"
                      sayi={criticalNotifCount}
                      renk="#f43f5e"
                    >
                      <Link
                        href="/panel/bildirimler"
                        className="inline-flex items-center gap-1 text-[11.5px] font-semibold"
                        style={{ color: GOLD }}
                      >
                        Bildirimleri görüntüle <ChevronRight size={12} />
                      </Link>
                    </UyariBolumu>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function UyariBolumu({ icon: Icon, baslik, sayi, renk, children }: any) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${renk}33` }}>
      <div className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <Icon size={14} style={{ color: renk }} />
        <span className="text-[12px] font-bold" style={{ color: '#fafaf9' }}>{baslik}</span>
        <span className="ml-auto text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ background: `${renk}22`, color: renk }}>
          {sayi}
        </span>
      </div>
      <div className="p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function UyariSatir({ renk, etiket, mesaj, altMesaj }: { renk: string; etiket: string; mesaj: string; altMesaj?: string }) {
  return (
    <div className="px-3 py-2 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: `${renk}22`, color: renk }}>
          {formatUyariEtiketi(etiket)}
        </span>
        <span className="text-[12.5px]" style={{ color: '#fafaf9' }}>{mesaj}</span>
      </div>
      {altMesaj && (
        <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
          {altMesaj}
        </p>
      )}
    </div>
  );
}

function formatUyariEtiketi(etiket: string) {
  if (etiket === 'CRITICAL') return 'KRİTİK';
  if (etiket === 'WARNING') return 'UYARI';
  if (etiket === 'OK') return 'TAMAM';
  return etiket;
}
