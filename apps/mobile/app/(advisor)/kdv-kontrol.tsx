import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
  AmountCard,
  ColorStrip,
  EmptyState,
  ErrorState,
  GradientCard,
  ListRow,
  LoadingBlock,
  MiniPill,
  ModuleHeader,
  SectionLabel,
} from '../../components/ModuleKit';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing } from '../../lib/theme';

const COLOR = 'amber' as const;

type Session = {
  id: string;
  type?: string;
  taxpayerId?: string;
  periodLabel?: string;
  status?: string;
  createdAt?: string;
  taxpayer?: {
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    taxNumber?: string;
  };
};

type Stats = {
  totalRecords?: number;
  totalImages?: number;
  needsOcrConfirm?: number;
  matched?: number;
};

const TYPE_LABEL: Record<string, string> = {
  KDV_191: '191 — İndirilecek KDV (Alış)',
  KDV_391: '391 — Hesaplanan KDV (Satış)',
  ISLETME_GELIR: 'İşletme — Gelir',
  ISLETME_GIDER: 'İşletme — Gider',
};

export default function KdvKontrolScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['kdv-kontrol-list'],
    enabled,
    queryFn: () => api.get('/kdv-control/sessions').then((r) => r.data as Session[]),
  });

  const stats = useQuery({
    queryKey: ['kdv-kontrol-stats', selectedId],
    enabled: enabled && !!selectedId,
    queryFn: () => api.get(`/kdv-control/sessions/${selectedId}/stats`).then((r) => r.data as Stats),
  });

  const sessions: Session[] = enabled ? list.data ?? [] : DEMO_LIST;

  if (selectedId) {
    const active = sessions.find((s) => s.id === selectedId);
    const data = enabled ? stats.data : DEMO_STATS;
    return (
      <SessionDetail
        session={active}
        stats={data}
        loading={enabled && stats.isLoading}
        error={enabled && stats.isError}
        onRetry={() => stats.refetch()}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  const completed = sessions.filter((s) => s.status === 'COMPLETED').length;
  const review = sessions.filter((s) => s.status === 'REVIEWING' || s.status === 'PROCESSING').length;

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="copper" />
      <ModuleHeader
        eyebrow="‹ Mali Veriler · KDV Kontrol"
        title="KDV Kontrol"
        subtitle="Luca · fatura eşleştirme oturumları"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="Henüz oturum yok"
          subtitle="KDV kontrol oturumu açıldığında burada listelenir."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AmountCard label="Oturum" value={String(sessions.length)} meta="toplam" color={COLOR} />
            </View>
            <View style={{ flex: 1 }}>
              <AmountCard label="Tamamlanan" value={String(completed)} meta={`${review} işlemde`} color="green" />
            </View>
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionLabel label="Oturumlar" />
            {sessions.map((s) => (
              <ListRow
                key={s.id}
                color={COLOR}
                icon={<ShieldCheck size={17} color={colors.amber} strokeWidth={2} />}
                title={`${s.periodLabel || 'Dönem'} · ${TYPE_LABEL[s.type || ''] || s.type || 'KDV'}`}
                subtitle={`${mukellefAdi(s)}${s.createdAt ? ' · ' + fmtDate(s.createdAt) : ''}`}
                right={<MiniPill label={statusLabel(s.status)} color={statusColor(s.status)} />}
                onPress={() => setSelectedId(s.id)}
              />
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

function SessionDetail({
  session,
  stats,
  loading,
  error,
  onRetry,
  onBack,
}: {
  session?: Session;
  stats?: Stats;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <Screen>
      <ColorStrip color={COLOR} color2="copper" />
      <ModuleHeader
        eyebrow="‹ KDV Kontrol"
        title={session?.periodLabel || 'Oturum'}
        subtitle={session ? `${mukellefAdi(session)} · ${TYPE_LABEL[session.type || ''] || session.type || ''}` : 'Detay'}
        color={COLOR}
        onBack={onBack}
        right={<MiniPill label={statusLabel(session?.status)} color={statusColor(session?.status)} />}
      />

      {loading ? (
        <LoadingBlock color={COLOR} />
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : (
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AmountCard label="Luca Satırı" value={String(stats?.totalRecords ?? 0)} color={COLOR} />
            </View>
            <View style={{ flex: 1 }}>
              <AmountCard label="Fatura Görseli" value={String(stats?.totalImages ?? 0)} color="blue" />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AmountCard label="Eşleşen" value={String(stats?.matched ?? 0)} color="green" />
            </View>
            <View style={{ flex: 1 }}>
              <AmountCard
                label="Teyit Bekleyen"
                value={String(stats?.needsOcrConfirm ?? 0)}
                meta={(stats?.needsOcrConfirm ?? 0) > 0 ? 'inceleme gerek' : 'temiz'}
                color={(stats?.needsOcrConfirm ?? 0) > 0 ? 'rose' : 'green'}
              />
            </View>
          </View>

          <GradientCard color={COLOR}>
            <SectionLabel label="🔎 Detaylı eşleştirme ve düzeltme portal panelinden yapılır" />
          </GradientCard>
        </View>
      )}
    </Screen>
  );
}

function mukellefAdi(s: Session): string {
  const t = s.taxpayer;
  if (!t) return 'Mükellef';
  return (
    t.companyName ||
    `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
    t.taxNumber ||
    'Mükellef'
  );
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function statusLabel(s?: string): string {
  if (s === 'COMPLETED') return 'tamam';
  if (s === 'REVIEWING') return 'inceleme';
  if (s === 'PROCESSING') return 'işleniyor';
  return 'taslak';
}
function statusColor(s?: string): 'green' | 'amber' | 'blue' | 'steel' {
  if (s === 'COMPLETED') return 'green';
  if (s === 'REVIEWING') return 'amber';
  if (s === 'PROCESSING') return 'blue';
  return 'steel';
}

/* ---- demo verisi (oturum demo modundayken) ---- */
const DEMO_LIST: Session[] = [
  {
    id: 'demo-1',
    type: 'KDV_191',
    periodLabel: '2026/03',
    status: 'COMPLETED',
    createdAt: '2026-04-05T09:00:00.000Z',
    taxpayer: { companyName: 'ÖZ ELA İnşaat' },
  },
  {
    id: 'demo-2',
    type: 'KDV_391',
    periodLabel: '2026/03',
    status: 'REVIEWING',
    createdAt: '2026-04-05T09:10:00.000Z',
    taxpayer: { companyName: 'ÖZ ELA İnşaat' },
  },
];
const DEMO_STATS: Stats = {
  totalRecords: 126,
  totalImages: 124,
  matched: 118,
  needsOcrConfirm: 2,
};
