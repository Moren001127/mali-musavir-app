import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusPill } from '../../components/StatusPill';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { pendingApprovals } from '../../lib/sample-data';
import { colors, radius, spacing } from '../../lib/theme';

type PendingAction = {
  id: string;
  title: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requestedByAgent?: string | null;
};

const riskTone = {
  low: 'green',
  medium: 'amber',
  high: 'rose',
  critical: 'rose',
} as const;

function toneForRisk(riskLevel: string) {
  return riskTone[riskLevel as keyof typeof riskTone] || 'gold';
}

export default function AdvisorApprovalsScreen() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const approvals = useQuery({
    queryKey: ['pending-actions'],
    enabled,
    queryFn: () =>
      api
        .get('/pending-actions', { params: { status: 'pending', limit: 30 } })
        .then((res) => res.data as PendingAction[]),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/pending-actions/${id}/approve`, { note: 'Mobil uygulamadan onaylandı.' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-actions'] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.patch(`/pending-actions/${id}/reject`, { note: 'Mobil uygulamadan reddedildi.' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-actions'] }),
  });

  const items = approvals.data?.length ? approvals.data : pendingApprovals;

  return (
    <Screen>
      <TopBar title="AI onay kuyruğu" subtitle="Müşavir karar ekranı" audience="advisor" onLogout={auth.logout} />

      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.title}>{item.title}</Text>
              <StatusPill label={item.riskLevel.toUpperCase()} tone={toneForRisk(item.riskLevel)} />
            </View>
            <Text style={styles.summary}>{item.summary}</Text>
            <Text style={styles.agent}>{item.requestedByAgent || 'Moren Ofis'}</Text>

            <View style={styles.actions}>
              <PrimaryButton
                label="Reddet"
                variant="danger"
                disabled={auth.user?.isDemo}
                onPress={() => reject.mutate(item.id)}
                icon={<X size={17} color={colors.rose} strokeWidth={2.2} />}
                style={styles.button}
              />
              <PrimaryButton
                label="Onayla"
                disabled={auth.user?.isDemo}
                onPress={() => approve.mutate(item.id)}
                icon={<Check size={17} color={colors.black} strokeWidth={2.2} />}
                style={styles.button}
              />
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  summary: {
    color: colors.textMuted,
    lineHeight: 20,
    fontSize: 14,
  },
  agent: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    flex: 1,
    minHeight: 44,
  },
});
