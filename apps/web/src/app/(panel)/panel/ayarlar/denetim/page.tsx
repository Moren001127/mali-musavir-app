'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Calendar,
  Filter,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import {
  auditApi,
  actionColor,
  actionLabel,
  resourceLabel,
  type AuditFilters,
  type AuditLogItem,
  type AuditFacets,
} from '@/lib/audit';

const GOLD = '#d4b876';

export default function DenetimPage() {
  const [filters, setFilters] = useState<AuditFilters>({ limit: 100, offset: 0 });
  const [searchInput, setSearchInput] = useState('');

  const { data: facets } = useQuery<AuditFacets>({
    queryKey: ['audit-facets'],
    queryFn: () => auditApi.facets(),
  });

  const { data: logsData, isLoading, isFetching } = useQuery<{
    items: AuditLogItem[];
    total: number;
    limit: number;
    offset: number;
  }>({
    queryKey: ['audit-logs', filters],
    queryFn: () => auditApi.list(filters),
    placeholderData: (prev) => prev,
  });

  const { data: stats = [] } = useQuery<Array<{ day: string; count: number }>>({
    queryKey: ['audit-daily'],
    queryFn: () => auditApi.dailyStats(30),
  });

  const logs = logsData?.items ?? [];
  const total = logsData?.total ?? 0;
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Mini bar chart için max
  const maxStat = useMemo(
    () => stats.reduce((m, s) => Math.max(m, s.count), 0) || 1,
    [stats],
  );

  function applySearch() {
    setFilters((f) => ({ ...f, search: searchInput || undefined, offset: 0 }));
  }

  function reset() {
    setFilters({ limit: 100, offset: 0 });
    setSearchInput('');
  }

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div
        className="pb-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span
            className="text-[10px] uppercase font-bold tracking-[.18em]"
            style={{ color: '#b8a06f' }}
          >
            <ShieldCheck size={10} className="inline mr-1" /> Denetim
          </span>
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 34,
            fontWeight: 600,
            color: '#fafaf9',
            letterSpacing: '-.03em',
          }}
        >
          Denetim Günlüğü
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Sistemde yapılan tüm yazma işlemleri (oluşturma, güncelleme, silme, giriş)
          buradan izlenir. Sadece ADMIN kullanıcılar görebilir.
        </p>
      </div>

      {/* Mini bar chart — son 30 gün */}
      <div
        className="rounded-xl border p-5"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} style={{ color: GOLD }} />
          <span
            className="text-[11px] uppercase font-bold tracking-[.12em]"
            style={{ color: 'rgba(250,250,249,0.6)' }}
          >
            Son 30 Gün — Günlük Aksiyon
          </span>
        </div>
        <div className="flex items-end gap-1 h-20">
          {stats.length === 0 ? (
            <div
              className="text-[12px] italic w-full text-center self-center"
              style={{ color: 'rgba(250,250,249,0.4)' }}
            >
              Veri yok
            </div>
          ) : (
            stats.map((s) => (
              <div
                key={s.day}
                className="flex-1 rounded-t-sm relative group"
                style={{
                  height: `${(s.count / maxStat) * 100}%`,
                  minHeight: 2,
                  background: `linear-gradient(180deg, ${GOLD}, rgba(184,160,111,0.4))`,
                }}
                title={`${s.day}: ${s.count}`}
              >
                <span
                  className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] opacity-0 group-hover:opacity-100 transition"
                  style={{ color: GOLD, whiteSpace: 'nowrap' }}
                >
                  {s.count}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Filtre barı */}
      <div
        className="rounded-xl border p-4"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[260px]">
            <label
              className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              <Search size={11} className="inline mr-1" /> Ara (kaynak / kayıt id)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="örn: taxpayers veya cltxxx..."
                className="flex-1 px-3 py-2.5 rounded-lg text-sm border outline-none"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: '#fafaf9',
                }}
              />
              <button
                onClick={applySearch}
                className="px-3 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-1.5"
                style={{
                  background: 'rgba(184,160,111,0.12)',
                  color: GOLD,
                  border: '1px solid rgba(184,160,111,0.3)',
                }}
              >
                <Filter size={13} /> Uygula
              </button>
            </div>
          </div>

          <div>
            <label
              className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              <UserIcon size={11} className="inline mr-1" /> Kullanıcı
            </label>
            <select
              value={filters.userId || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  userId: e.target.value || undefined,
                  offset: 0,
                }))
              }
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#fafaf9',
                minWidth: 180,
              }}
            >
              <option value="" style={{ background: '#0f0d0b' }}>
                Tümü
              </option>
              {(facets?.users || []).map((u) => (
                <option key={u.id} value={u.id} style={{ background: '#0f0d0b' }}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              Kaynak
            </label>
            <select
              value={filters.resource || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  resource: e.target.value || undefined,
                  offset: 0,
                }))
              }
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#fafaf9',
                minWidth: 180,
              }}
            >
              <option value="" style={{ background: '#0f0d0b' }}>
                Tümü
              </option>
              {(facets?.resources || []).map((r) => (
                <option key={r.value} value={r.value} style={{ background: '#0f0d0b' }}>
                  {resourceLabel(r.value)} ({r.count})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              Aksiyon
            </label>
            <select
              value={filters.action || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  action: e.target.value || undefined,
                  offset: 0,
                }))
              }
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#fafaf9',
                minWidth: 160,
              }}
            >
              <option value="" style={{ background: '#0f0d0b' }}>
                Tümü
              </option>
              {(facets?.actions || []).map((a) => (
                <option key={a.value} value={a.value} style={{ background: '#0f0d0b' }}>
                  {actionLabel(a.value)} ({a.count})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              <Calendar size={11} className="inline mr-1" /> Başlangıç
            </label>
            <input
              type="date"
              value={filters.from || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  from: e.target.value || undefined,
                  offset: 0,
                }))
              }
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#fafaf9',
              }}
            />
          </div>

          <div>
            <label
              className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
              style={{ color: 'rgba(250,250,249,0.5)' }}
            >
              Bitiş
            </label>
            <input
              type="date"
              value={filters.to || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  to: e.target.value || undefined,
                  offset: 0,
                }))
              }
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#fafaf9',
              }}
            />
          </div>

          <button
            onClick={reset}
            className="px-3 py-2.5 rounded-lg text-sm flex items-center gap-1.5"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(250,250,249,0.7)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            title="Filtreleri temizle"
          >
            <RotateCcw size={13} /> Sıfırla
          </button>
        </div>
      </div>

      {/* Liste */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        {isLoading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={14} className="animate-spin" /> Yükleniyor…
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <ShieldCheck size={32} className="mx-auto mb-2 opacity-40" />
            Bu kriterlerde kayıt bulunamadı.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  Tarih
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  Kullanıcı
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  Aksiyon
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  Kaynak
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  Kayıt ID
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t hover:bg-white/[0.02] transition"
                  style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.7)' }}>
                    {new Date(log.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: '#fafaf9' }}>
                    {log.user
                      ? `${log.user.firstName} ${log.user.lastName}`
                      : <span style={{ color: 'rgba(250,250,249,0.3)' }}>Sistem</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold"
                      style={{
                        background: actionColor(log.action) + '20',
                        color: actionColor(log.action),
                        border: `1px solid ${actionColor(log.action)}40`,
                      }}
                    >
                      {actionLabel(log.action)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'rgba(250,250,249,0.85)' }}>
                    {resourceLabel(log.resource)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    {log.resourceId ? log.resourceId.slice(0, 12) + '…' : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {log.ipAddress || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {logs.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Toplam {total.toLocaleString('tr-TR')} kayıt · Sayfa {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, (f.offset ?? 0) - limit) }))}
              disabled={offset === 0 || isFetching}
              className="px-3 py-1.5 rounded-md text-xs disabled:opacity-30"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(250,250,249,0.7)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Önceki
            </button>
            <button
              onClick={() => setFilters((f) => ({ ...f, offset: (f.offset ?? 0) + limit }))}
              disabled={page >= totalPages || isFetching}
              className="px-3 py-1.5 rounded-md text-xs disabled:opacity-30"
              style={{
                background: 'rgba(184,160,111,0.12)',
                color: GOLD,
                border: '1px solid rgba(184,160,111,0.3)',
              }}
            >
              Sonraki
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
