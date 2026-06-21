import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, AlertTriangle, CalendarClock } from 'lucide-react-native';
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

const COLOR = 'gold' as const;

type TaskCounts = { today: number; overdue: number; thisWeek?: number; totalOpen?: number };
type Task = {
  id: string;
  title: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate?: string | null;
  dueTime?: string | null;
  allDay?: boolean;
  status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'SNOOZED' | 'MISSED' | 'CANCELLED';
  taxpayer?: { companyName?: string; firstName?: string; lastName?: string };
};

export default function GorevlerScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const countsQ = useQuery({
    queryKey: ['advisor-task-counts'],
    enabled,
    queryFn: () => api.get('/tasks/counts').then((r) => r.data as TaskCounts),
  });

  const listQ = useQuery({
    queryKey: ['advisor-tasks'],
    enabled,
    queryFn: () =>
      api
        .get('/tasks', { params: { status: 'OPEN', isTemplate: 'false', limit: 100 } })
        .then((r) => (r.data?.items ?? r.data ?? []) as Task[]),
  });

  const counts: TaskCounts = enabled ? countsQ.data ?? { today: 0, overdue: 0 } : DEMO_COUNTS;
  const tasks: Task[] = enabled ? listQ.data ?? [] : DEMO_TASKS;

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="copper" />
      <ModuleHeader
        eyebrow="‹ Ofis · Görevler"
        title="Görevler"
        subtitle="Bugün ve geciken işler"
        color={COLOR}
        onBack={() => router.back()}
      />

      <View style={styles.cards}>
        <GradientCard color={COLOR} style={styles.card}>
          <View style={styles.cardHead}>
            <CalendarClock size={15} color={colors.gold} strokeWidth={2.2} />
            <SectionLabel label="Bugün" />
          </View>
          <Big value={counts.today ?? 0} />
        </GradientCard>
        <GradientCard color="rose" style={styles.card}>
          <View style={styles.cardHead}>
            <AlertTriangle size={15} color={colors.rose} strokeWidth={2.2} />
            <SectionLabel label="Geciken" />
          </View>
          <Big value={counts.overdue ?? 0} />
        </GradientCard>
      </View>

      {enabled && listQ.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && listQ.isError ? (
        <ErrorState onRetry={() => listQ.refetch()} />
      ) : tasks.length === 0 ? (
        <EmptyState title="Açık görev yok" subtitle="Yeni görevler eklendiğinde burada listelenir." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Açık görevler" />
          {tasks.map((t) => (
            <ListRow
              key={t.id}
              color={COLOR}
              icon={<CheckSquare size={17} color={colors.gold} strokeWidth={2} />}
              title={t.title}
              subtitle={subtitleFor(t)}
              right={<MiniPill label={dueLabel(t)} color={dueColor(t)} />}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function Big({ value }: { value: number }) {
  return (
    <View style={styles.bigWrap}>
      <Text style={styles.big}>{value}</Text>
    </View>
  );
}

function subtitleFor(t: Task): string {
  const tp = t.taxpayer;
  const name = tp ? tp.companyName || `${tp.firstName ?? ''} ${tp.lastName ?? ''}`.trim() : '';
  const d = formatDue(t);
  return [name, d].filter(Boolean).join(' · ') || 'Tarih belirtilmemiş';
}

function formatDue(t: Task): string {
  if (!t.dueDate) return '';
  const d = new Date(t.dueDate);
  if (isNaN(d.getTime())) return '';
  const ds = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  return t.allDay || !t.dueTime ? ds : `${ds} ${t.dueTime}`;
}

function dueStatus(t: Task): 'overdue' | 'today' | 'upcoming' | 'done' | 'none' {
  if (t.status === 'DONE') return 'done';
  if (!t.dueDate) return 'none';
  const due = new Date(t.dueDate);
  if (isNaN(due.getTime())) return 'none';
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  if (due < start) return 'overdue';
  if (due <= end) return 'today';
  return 'upcoming';
}

function dueLabel(t: Task): string {
  switch (dueStatus(t)) {
    case 'done':
      return 'tamam';
    case 'overdue':
      return 'geciken';
    case 'today':
      return 'bugün';
    case 'upcoming':
      return 'yaklaşan';
    default:
      return 'tarihsiz';
  }
}
function dueColor(t: Task): 'green' | 'rose' | 'gold' | 'blue' | 'steel' {
  switch (dueStatus(t)) {
    case 'done':
      return 'green';
    case 'overdue':
      return 'rose';
    case 'today':
      return 'gold';
    case 'upcoming':
      return 'blue';
    default:
      return 'steel';
  }
}

const DEMO_COUNTS: TaskCounts = { today: 3, overdue: 1 };
const DEMO_TASKS: Task[] = [
  { id: '1', title: 'KDV beyannamesi gönder', dueDate: new Date().toISOString(), allDay: true, status: 'OPEN', taxpayer: { companyName: 'ÖZ ELA İnşaat' } },
  { id: '2', title: 'Muhtasar tahakkuk kontrolü', dueDate: new Date(Date.now() - 86400000).toISOString(), allDay: true, status: 'OPEN', taxpayer: { companyName: 'Demir Ticaret' } },
  { id: '3', title: 'Bordro hazırlığı', dueDate: new Date(Date.now() + 3 * 86400000).toISOString(), allDay: true, status: 'OPEN' },
];

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: { flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  bigWrap: { marginTop: 4 },
  big: { color: colors.text, fontSize: 30, fontWeight: '800' },
});
