import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, Activity, CheckCircle2, XCircle } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
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

const COLOR = 'steel' as const;

type AgentStatus = {
  id?: string;
  agent: string;
  running: boolean;
  lastPing?: string;
  meta?: any;
};

type HealthSummary = {
  totals?: {
    activeJobs?: number;
    doneToday?: number;
    failedToday?: number;
    pendingLucaJobs?: number;
    runningLucaJobs?: number;
  };
  agents?: Array<{ agent: string; displayName?: string; controlState?: string }>;
};

export default function AjanlarScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const healthQ = useQuery({
    queryKey: ['advisor-agent-health'],
    enabled,
    queryFn: () => api.get('/agent/health-summary').then((r) => r.data as HealthSummary),
  });

  const statusQ = useQuery({
    queryKey: ['advisor-agent-status'],
    enabled,
    queryFn: () => api.get('/agent/status').then((r) => (r.data ?? []) as AgentStatus[]),
  });

  const health: HealthSummary = enabled ? healthQ.data ?? {} : DEMO_HEALTH;
  const statuses: AgentStatus[] = enabled ? statusQ.data ?? [] : DEMO_STATUS;
  const totals = health.totals ?? {};

  const nameMap = new Map((health.agents ?? []).map((a) => [a.agent, a.displayName || a.agent]));

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="‹ Sistem · Ajanlar"
        title="Ajanlar"
        subtitle="Otomasyon ajanları ve sağlık durumu"
        color={COLOR}
        onBack={() => router.back()}
      />

      <View style={styles.cards}>
        <StatCard color="steel" icon={<Activity size={15} color={colors.steel} strokeWidth={2.2} />} label="Aktif iş" value={totals.activeJobs ?? 0} />
        <StatCard color="green" icon={<CheckCircle2 size={15} color={colors.green} strokeWidth={2.2} />} label="Bugün biten" value={totals.doneToday ?? 0} />
        <StatCard color="rose" icon={<XCircle size={15} color={colors.rose} strokeWidth={2.2} />} label="Bugün hata" value={totals.failedToday ?? 0} />
      </View>

      {enabled && statusQ.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && statusQ.isError ? (
        <ErrorState onRetry={() => statusQ.refetch()} />
      ) : statuses.length === 0 ? (
        <EmptyState title="Ajan durumu yok" subtitle="Ajanlar bağlandığında burada görünür." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Ajanlar" />
          {statuses.map((s) => (
            <ListRow
              key={s.id || s.agent}
              color={COLOR}
              icon={<Bot size={17} color={colors.steel} strokeWidth={2} />}
              title={nameMap.get(s.agent) || s.agent}
              subtitle={pingLabel(s.lastPing)}
              right={<MiniPill label={s.running ? 'aktif' : 'durdu'} color={s.running ? 'green' : 'steel'} />}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function StatCard({ color, icon, label, value }: { color: 'steel' | 'green' | 'rose'; icon: React.ReactNode; label: string; value: number }) {
  return (
    <GradientCard color={color} style={styles.card}>
      <View style={styles.cardHead}>
        {icon}
        <SectionLabel label={label} />
      </View>
      <Text style={styles.big}>{value}</Text>
    </GradientCard>
  );
}

function pingLabel(iso?: string): string {
  if (!iso) return 'Son sinyal yok';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Son sinyal yok';
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'Az önce';
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} sa önce`;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

const DEMO_HEALTH: HealthSummary = {
  totals: { activeJobs: 1, doneToday: 12, failedToday: 0 },
  agents: [
    { agent: 'mihsap', displayName: 'Mihsap Fatura İşleyici' },
    { agent: 'luca', displayName: 'Luca E-Arşiv İndirici' },
  ],
};
const DEMO_STATUS: AgentStatus[] = [
  { id: 'mihsap', agent: 'mihsap', running: true, lastPing: new Date().toISOString() },
  { id: 'luca', agent: 'luca', running: true, lastPing: new Date(Date.now() - 8 * 60000).toISOString() },
  { id: 'sgk', agent: 'sgk', running: false, lastPing: new Date(Date.now() - 3 * 3600000).toISOString() },
];

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: { flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  big: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
});
