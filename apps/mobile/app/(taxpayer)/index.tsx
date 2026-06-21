import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FileArchive, FileText, MessageCircle, ReceiptText, ShieldCheck, UploadCloud, Users } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { StatCard } from '../../components/StatCard';
import { StatusPill } from '../../components/StatusPill';
import { ModuleTile } from '../../components/ModuleTile';
import { ActivityRow, CompanyHero, PremiumCard, QuickAction, SectionLabel } from '../../components/Premium';
import { useAuth } from '../../lib/auth';
import { getModuleNav, taxpayerModules } from '../../lib/mobile-modules';
import { taxpayerSummary } from '../../lib/sample-data';
import { colors, fonts, spacing } from '../../lib/theme';

export default function TaxpayerHomeScreen() {
  const auth = useAuth();

  return (
    <Screen>
      <TopBar title="Mükellef portalı" subtitle={taxpayerSummary.title} audience="taxpayer" onLogout={auth.logout} />

      <CompanyHero
        label="Firma"
        name="Yorgun Nakliyat Lojistik ve Depolama"
        meta={['VKN: 1234567890', 'Bilanço', 'KDV: Aylık']}
      />

      <View style={styles.statsGrid}>
        <Pressable style={styles.statPress} onPress={() => router.push('/(taxpayer)/cari')}>
          <StatCard label="Açık bakiye" value={taxpayerSummary.balance} tone="amber" hint="Bu ay ödenecek" />
        </Pressable>
        <Pressable style={styles.statPress} onPress={() => router.push('/(taxpayer)/beyannameler')}>
          <StatCard label="Yakın son tarih" value={taxpayerSummary.dueDate} tone="rose" hint="Beyan ödeme" />
        </Pressable>
      </View>

      <SectionLabel label="Hızlı erişim" right="Mali müşavir bağlı" />
      <View style={styles.quickGrid}>
        <QuickAction label="Evrak gönder" Icon={UploadCloud} active onPress={() => router.push('/(taxpayer)/evrak')} />
        <QuickAction label="Belgelerim" Icon={FileArchive} tone="blue" onPress={() => router.push('/(taxpayer)/belgeler')} />
        <QuickAction label="Beyanlar" Icon={FileText} tone="green" onPress={() => router.push('/(taxpayer)/beyannameler')} />
        <QuickAction label="Asistan" Icon={MessageCircle} tone="purple" onPress={() => router.push('/(taxpayer)/asistan')} />
      </View>

      <SectionLabel label="Bu ay" right="Mart 2026" />
      <PremiumCard tone="green" style={styles.monthCard}>
        <View style={styles.monthHead}>
          <View>
            <Text style={styles.monthKicker}>Hazırlık durumu</Text>
            <Text style={styles.monthTitle}>KDV dosyanız kontrol aşamasında</Text>
          </View>
          <StatusPill label="Ofiste" tone="green" />
        </View>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <Text style={styles.monthText}>87 alış, 56 satış faturası alındı. Banka ekstresi bekleniyor.</Text>
      </PremiumCard>

      <SectionLabel label="Beyanname ve evrak" right="Güncel" />
      <View style={styles.activityList}>
        <ActivityRow
          title="KDV1 Beyanname"
          meta="Dönem: 2026/03 · Ödeme: 27 Mayıs"
          amount="4.130 TL"
          Icon={ShieldCheck}
          tone="amber"
        />
        <ActivityRow
          title="Tahakkuk fişi"
          meta="Mali müşaviriniz tarafından hazırlandı"
          amount="Hazır"
          Icon={ReceiptText}
          tone="green"
        />
        <ActivityRow
          title="Banka ekstresi"
          meta="Bu ay için eksik belge bekleniyor"
          amount="Eksik"
          Icon={Users}
          tone="rose"
        />
      </View>

      <SectionLabel label="Mobil öncelik" right="Mükellef modülleri" />
      <View style={styles.moduleList}>
        {taxpayerModules
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
  monthCard: {
    gap: spacing.md,
  },
  monthHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  monthKicker: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '800',
  },
  monthTitle: {
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  progressTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    width: '74%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: colors.green,
  },
  monthText: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  activityList: {
    gap: spacing.sm,
  },
  moduleList: {
    gap: spacing.sm,
  },
});
