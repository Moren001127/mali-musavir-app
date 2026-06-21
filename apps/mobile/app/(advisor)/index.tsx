import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Bot,
  Camera,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  ReceiptText,
  ShieldCheck,
  Users,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { StatCard } from '../../components/StatCard';
import { ModuleTile } from '../../components/ModuleTile';
import { ActivityRow, PremiumCard, QuickAction, SectionLabel } from '../../components/Premium';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { advisorStats } from '../../lib/sample-data';
import { advisorModules, getModuleNav } from '../../lib/mobile-modules';
import { colors, fonts, spacing } from '../../lib/theme';

export default function AdvisorHomeScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const pendingCount = useQuery({
    queryKey: ['pending-actions-count'],
    enabled,
    queryFn: () => api.get('/pending-actions/count').then((res) => res.data.count as number),
  });

  const taskCounts = useQuery({
    queryKey: ['task-counts'],
    enabled,
    queryFn: () => api.get('/tasks/counts').then((res) => res.data as { today: number; overdue: number }),
  });

  const stats = [
    { ...advisorStats[0], value: String(pendingCount.data ?? advisorStats[0].value), hint: 'AI karar bekliyor' },
    { ...advisorStats[1], value: String(taskCounts.data?.today ?? advisorStats[1].value), hint: 'Bugünkü iş yükü' },
    { ...advisorStats[2], hint: 'Mükellef evrakı' },
    { ...advisorStats[3], hint: 'Gönderime yakın' },
  ];

  const statRoutes = ['/(advisor)/onay', '/(advisor)/gorevler', '/(advisor)/mukellefler', '/(advisor)/beyannameler'];

  return (
    <Screen>
      <TopBar title="Ofis kontrol" subtitle="Moren mobil operasyon" audience="advisor" onLogout={auth.logout} />

      <View style={styles.statsGrid}>
        {stats.map((stat, i) => (
          <Pressable key={stat.label} style={styles.statPress} onPress={() => router.push(statRoutes[i] as any)}>
            <StatCard {...stat} />
          </Pressable>
        ))}
      </View>

      <SectionLabel label="Hızlı işlem" right="Portal bağlı" />
      <View style={styles.quickGrid}>
        <QuickAction label="OCR tara" Icon={Camera} active onPress={() => router.push('/(advisor)/ocr')} />
        <QuickAction label="Mükellefler" Icon={Users} tone="blue" onPress={() => router.push('/(advisor)/mukellefler')} />
        <QuickAction label="Onay kuyruğu" Icon={CheckCircle2} tone="green" onPress={() => router.push('/(advisor)/onay')} />
        <QuickAction label="Ofis AI" Icon={MessageCircle} tone="purple" onPress={() => router.push('/(advisor)/ofis')} />
      </View>

      <PremiumCard tone="gold" style={styles.aiCard}>
        <View style={styles.aiHead}>
          <View style={styles.aiIcon}>
            <Bot size={22} color={colors.gold} strokeWidth={2.1} />
          </View>
          <View style={styles.aiBody}>
            <Text style={styles.aiKicker}>Claude destekli ekip</Text>
            <Text style={styles.aiTitle}>DENİZ bugün 3 kritik işi öne aldı</Text>
          </View>
        </View>
        <View style={styles.aiMetrics}>
          <View style={styles.aiMetric}>
            <Text style={styles.aiValue}>124</Text>
            <Text style={styles.aiLabel}>24s onay</Text>
          </View>
          <View style={styles.aiMetric}>
            <Text style={styles.aiValue}>7</Text>
            <Text style={styles.aiLabel}>KDV eksiği</Text>
          </View>
          <View style={styles.aiMetric}>
            <Text style={styles.aiValue}>2</Text>
            <Text style={styles.aiLabel}>Riskli kayıt</Text>
          </View>
        </View>
      </PremiumCard>

      <SectionLabel label="Bugün" right="Canlı akış" />
      <View style={styles.activityList}>
        <ActivityRow
          title="Petravet KDV evrakı"
          meta="Mükellefe eksik belge talebi hazırlanıyor"
          amount="3 eksik"
          Icon={ShieldCheck}
          tone="amber"
        />
        <ActivityRow
          title="Mihsap OCR kuyruğu"
          meta="Nisan dönemi alış belgeleri portala düştü"
          amount="18 fiş"
          Icon={ReceiptText}
          tone="gold"
        />
        <ActivityRow
          title="Görev planı"
          meta="Geciken işler ve randevular mobilde senkron"
          amount="14"
          Icon={ClipboardList}
          tone="blue"
        />
      </View>

      <SectionLabel label="Mobil öncelik" right="Müşavir modülleri" />
      <View style={styles.moduleList}>
        {advisorModules
          .filter((module) => module.priority === 'high')
          .slice(0, 4)
          .map((module) => (
            <ModuleTile
              key={module.id}
              module={module}
              onPress={() => router.push(getModuleNav(module.id).route as any)}
            />
          ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statPress: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  aiCard: {
    gap: spacing.md,
  },
  aiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  aiIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,184,118,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(212,184,118,0.25)',
  },
  aiBody: {
    flex: 1,
  },
  aiKicker: {
    color: colors.goldMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  aiTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  aiMetrics: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  aiMetric: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  aiValue: {
    color: colors.gold,
    fontFamily: fonts.heading,
    fontSize: 22,
    fontWeight: '800',
  },
  aiLabel: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontWeight: '700',
  },
  activityList: {
    gap: spacing.sm,
  },
  moduleList: {
    gap: spacing.sm,
  },
});
