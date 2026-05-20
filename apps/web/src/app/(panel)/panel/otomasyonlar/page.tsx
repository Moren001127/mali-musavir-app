'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Wand2,
  Clock,
  Webhook,
  Sparkles,
  Pause,
  Play,
  Archive,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Zap,
  FlaskConical,
  Trash2,
} from 'lucide-react';
import { automationsApi, type Automation, type AutomationStatus } from '@/lib/automations';

const GOLD = '#d4b876';

/**
 * Otomasyonlarım — minimal liste sayfası (Faz 2 sonu için yeterli).
 *
 * Faz 4'te genişletilecek:
 *  - Sayfalama UI
 *  - Filtre/arama kutusu
 *  - Detay paneli
 *  - Çalışma geçmişi sekmesi
 */
export default function OtomasyonlarPage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['automations', { status: undefined }],
    queryFn: () => automationsApi.list({ pageSize: 50 }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AutomationStatus }) =>
      automationsApi.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Durum güncellendi');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Güncelleme başarısız');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => automationsApi.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Otomasyon arşivlendi');
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) => automationsApi.runNow(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      const icon =
        result.status === 'success' ? '✓' : result.status === 'failure' ? '✗' : '⚠';
      toast.success(`${icon} ${result.summary || 'Çalışma tamamlandı'}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Çalıştırma başarısız');
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: (id: string) => automationsApi.dryRun(id),
    onSuccess: (result) => {
      toast.info(`Dry-run: ${result.summary || 'Adımlar simüle edildi'}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Dry-run başarısız');
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => automationsApi.hardDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Otomasyon kalıcı olarak silindi');
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.message ||
          'Kalıcı silme başarısız. Sadece hiç çalışmamış DRAFT otomasyonlar tamamen silinebilir.',
      );
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Başlık */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6" style={{ color: GOLD }} />
          <h1 className="text-2xl font-serif text-stone-800 dark:text-stone-100">Otomasyonlarım</h1>
        </div>
        <Link
          href="/panel/otomasyonlar/yeni"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm"
          style={{ backgroundColor: GOLD }}
        >
          <Plus className="h-4 w-4" />
          Yeni Otomasyon
        </Link>
      </div>

      <p className="mb-6 text-sm text-stone-600 dark:text-stone-300">
        Türkçe cümleyle kurduğun otomasyonların listesi. Arka planda otomatik çalışır,
        durumlarını ve geçmişlerini buradan takip edersin.
      </p>

      {isLoading && (
        <div className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-12 text-center text-sm text-stone-500 dark:text-stone-400 dark:text-stone-500">
          Yükleniyor…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Liste yüklenemedi: {(error as any)?.message}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-12 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-stone-400 dark:text-stone-500" />
          <h3 className="text-lg font-medium text-stone-700 dark:text-stone-200">Henüz otomasyonun yok</h3>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400 dark:text-stone-500">
            "Yeni Otomasyon" diyerek bir cümleyle ilk otomasyonunu kurabilirsin.
          </p>
          <Link
            href="/panel/otomasyonlar/yeni"
            className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm"
            style={{ backgroundColor: GOLD }}
          >
            <Plus className="h-4 w-4" />
            İlkini Oluştur
          </Link>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-800 text-left text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 dark:text-stone-500">
              <tr>
                <th className="px-4 py-3 font-medium">Ad</th>
                <th className="px-4 py-3 font-medium">Tetik</th>
                <th className="px-4 py-3 font-medium">Son Çalışma</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium text-right">Run</th>
                <th className="px-4 py-3 font-medium text-right">Eylem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.items.map((auto) => (
                <Row
                  key={auto.id}
                  auto={auto}
                  onToggleActive={(id, current) =>
                    statusMutation.mutate({
                      id,
                      status: current === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                    })
                  }
                  onArchive={(id) => archiveMutation.mutate(id)}
                  onHardDelete={(id) => hardDeleteMutation.mutate(id)}
                  onRunNow={(id) => runNowMutation.mutate(id)}
                  onDryRun={(id) => dryRunMutation.mutate(id)}
                  runNowPending={runNowMutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  auto,
  onToggleActive,
  onArchive,
  onHardDelete,
  onRunNow,
  onDryRun,
  runNowPending,
}: {
  auto: Automation;
  onToggleActive: (id: string, current: AutomationStatus) => void;
  onArchive: (id: string) => void;
  onHardDelete: (id: string) => void;
  onRunNow: (id: string) => void;
  onDryRun: (id: string) => void;
  runNowPending: boolean;
}) {
  // Hiç çalışmamış DRAFT otomasyonlar tamamen silinebilir (denetim izi yok)
  const canHardDelete = auto.status === 'DRAFT' && auto.totalRuns === 0;
  const lastRunStatus = auto.lastRunStatus;
  return (
    <tr className="text-stone-800 dark:text-stone-100">
      <td className="px-4 py-3">
        <div className="font-medium">{auto.title}</div>
        <div className="line-clamp-1 max-w-md text-xs text-stone-500 dark:text-stone-400 dark:text-stone-500">{auto.prompt}</div>
      </td>
      <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
        <span className="inline-flex items-center gap-1">
          <TriggerIcon t={auto.triggerType} />
          {triggerShort(auto.triggerType, auto.triggerConfig)}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
        {auto.lastRunAt ? (
          <span className="inline-flex items-center gap-1">
            {lastRunStatus === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : lastRunStatus === 'failure' ? (
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
            ) : null}
            {new Date(auto.lastRunAt).toLocaleString('tr-TR')}
          </span>
        ) : (
          <span className="text-stone-400 dark:text-stone-500">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={auto.status} />
      </td>
      <td className="px-4 py-3 text-right text-xs text-stone-600 dark:text-stone-300">
        {auto.totalRuns} <span className="text-stone-400 dark:text-stone-500">/ {auto.successRuns} başarı</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          {auto.status !== 'ARCHIVED' && (
            <>
              <button
                onClick={() => onRunNow(auto.id)}
                disabled={runNowPending}
                className="rounded-md border border-amber-300 bg-amber-50 p-1.5 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                title="Şimdi Çalıştır (gerçek aksiyon)"
              >
                <Zap className="h-4 w-4" />
              </button>
              <button
                onClick={() => onDryRun(auto.id)}
                className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
                title="Dry-Run (aksiyon yapmadan simüle et)"
              >
                <FlaskConical className="h-4 w-4" />
              </button>
            </>
          )}
          {(auto.status === 'ACTIVE' || auto.status === 'PAUSED') && (
            <button
              onClick={() => onToggleActive(auto.id, auto.status)}
              className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
              title={auto.status === 'ACTIVE' ? 'Duraklat' : 'Aktive et'}
            >
              {auto.status === 'ACTIVE' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
          )}
          {auto.status !== 'ARCHIVED' && (
            <button
              onClick={() => {
                if (confirm(`"${auto.title}" arşivlensin mi?`)) onArchive(auto.id);
              }}
              className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
              title="Arşivle (çalışma geçmişi korunur)"
            >
              <Archive className="h-4 w-4" />
            </button>
          )}
          {canHardDelete && (
            <button
              onClick={() => {
                if (
                  confirm(
                    `"${auto.title}" KALICI olarak silinsin mi?\n\nBu işlem geri alınamaz.`,
                  )
                ) {
                  onHardDelete(auto.id);
                }
              }}
              className="rounded-md border border-rose-300 dark:border-rose-700 bg-white dark:bg-stone-900 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950"
              title="Kalıcı sil (sadece hiç çalışmamış taslaklar için)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: AutomationStatus }) {
  const styles: Record<AutomationStatus, string> = {
    DRAFT: 'bg-stone-100 text-stone-700 dark:text-stone-200',
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    PAUSED: 'bg-amber-100 text-amber-800',
    ERROR: 'bg-rose-100 text-rose-800',
    ARCHIVED: 'bg-stone-200 text-stone-500 dark:text-stone-400 dark:text-stone-500',
  };
  const labels: Record<AutomationStatus, string> = {
    DRAFT: 'Taslak',
    ACTIVE: 'Aktif',
    PAUSED: 'Duraklatıldı',
    ERROR: 'Hata',
    ARCHIVED: 'Arşivlendi',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function TriggerIcon({ t }: { t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL' }) {
  if (t === 'CRON') return <Clock className="h-3.5 w-3.5" />;
  if (t === 'WEBHOOK') return <Webhook className="h-3.5 w-3.5" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

function triggerShort(t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL', cfg: any): string {
  if (t === 'CRON') return cfg?.cron || 'Zamanlı';
  if (t === 'EVENT') return cfg?.eventName || 'Olay';
  if (t === 'WEBHOOK') return 'Webhook';
  return 'Manuel';
}
