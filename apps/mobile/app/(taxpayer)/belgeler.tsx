import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Download } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { StatusPill } from '../../components/StatusPill';
import { useAuth } from '../../lib/auth';
import { taxpayerSummary } from '../../lib/sample-data';
import { colors, radius, spacing } from '../../lib/theme';

export default function TaxpayerDocumentsScreen() {
  const auth = useAuth();

  return (
    <Screen>
      <TopBar title="Belgelerim" subtitle="Mükellef arşivi" audience="taxpayer" onLogout={auth.logout} />

      <View style={styles.list}>
        {taxpayerSummary.documents.map((doc) => (
          <View key={doc.title} style={styles.card}>
            <View style={styles.icon}>
              <Download size={18} color={colors.gold} strokeWidth={2.2} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>{doc.title}</Text>
              <Text style={styles.meta}>PDF ve ekleri</Text>
            </View>
            <StatusPill label={doc.state} tone={doc.state === 'Eksik' ? 'rose' : 'gold'} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12.5,
    marginTop: 3,
  },
});

