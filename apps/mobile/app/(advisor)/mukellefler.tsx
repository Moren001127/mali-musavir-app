import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { StatusPill } from '../../components/StatusPill';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { taxpayerRows } from '../../lib/sample-data';
import { colors, radius, spacing } from '../../lib/theme';

type TaxpayerRow = {
  id: string;
  name?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  taxNumber?: string;
  status?: string;
  openTasks?: number;
};

function displayName(row: TaxpayerRow) {
  return row.name || row.companyName || [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Mükellef';
}

export default function AdvisorTaxpayersScreen() {
  const auth = useAuth();
  const [search, setSearch] = useState('');
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const taxpayers = useQuery({
    queryKey: ['taxpayers', search],
    enabled,
    queryFn: () => api.get('/taxpayers', { params: { search } }).then((res) => res.data as TaxpayerRow[]),
  });

  const items = useMemo(() => {
    const source = taxpayers.data?.length ? taxpayers.data : taxpayerRows;
    const needle = search.trim().toLocaleLowerCase('tr-TR');
    if (!needle || taxpayers.data?.length) return source;
    return source.filter((row) => displayName(row).toLocaleLowerCase('tr-TR').includes(needle));
  }, [search, taxpayers.data]);

  return (
    <Screen>
      <TopBar title="Mükellefler" subtitle="Mobil hızlı bakış" audience="advisor" onLogout={auth.logout} />

      <View style={styles.searchWrap}>
        <Search size={18} color={colors.textSoft} strokeWidth={2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Unvan, VKN veya ad ara"
          placeholderTextColor={colors.textSoft}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.list}>
        {items.map((row) => (
          <View key={row.id} style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{displayName(row).slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.name}>{displayName(row)}</Text>
              <Text style={styles.meta}>{row.taxNumber || 'VKN/TCKN bekleniyor'}</Text>
              <View style={styles.footer}>
                <StatusPill label={row.status || 'Aktif'} tone={row.status?.includes('eksik') ? 'rose' : 'gold'} />
                <Text style={styles.tasks}>{row.openTasks ?? 0} açık iş</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    height: 48,
    color: colors.text,
    fontSize: 15,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarText: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: '800',
  },
  body: {
    flex: 1,
    gap: 5,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12.5,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  tasks: {
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
});

