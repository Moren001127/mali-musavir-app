import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import {
  ColorStrip,
  EmptyState,
  ErrorState,
  GradientCard,
  LoadingBlock,
  MiniPill,
  ModuleHeader,
  SectionLabel,
} from '../../components/ModuleKit';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, radius, spacing, withAlpha } from '../../lib/theme';

const COLOR = 'gold' as const;

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

type MonthlyStatus = {
  evraklarGeldi?: boolean;
  evraklarIslendi?: boolean;
  kdvKontrolEdildi?: boolean;
  indirilecekKdvKontrol?: boolean;
  hesaplananKdvKontrol?: boolean;
  eArsivKontrol?: boolean;
  beyannameVerildi?: boolean;
} | null;

type Taxpayer = {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  taxNumber?: string | null;
  monthlyStatus?: MonthlyStatus;
  _count?: { taxDeclarations?: number; documents?: number };
};

function adOf(t: Taxpayer) {
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || 'Mükellef';
}

// Aşama: en ileri tamamlanan adıma göre etiket + renk
function asama(s: MonthlyStatus | undefined): { label: string; color: 'green' | 'blue' | 'amber' | 'copper' | 'steel' } {
  if (!s) return { label: 'Bekliyor', color: 'steel' };
  if (s.beyannameVerildi) return { label: 'Beyan verildi', color: 'green' };
  if (s.kdvKontrolEdildi || (s.indirilecekKdvKontrol && s.hesaplananKdvKontrol)) return { label: 'Kontrol edildi', color: 'blue' };
  if (s.evraklarIslendi) return { label: 'İşlemde', color: 'amber' };
  if (s.evraklarGeldi) return { label: 'Evrak geldi', color: 'copper' };
  return { label: 'Evrak bekliyor', color: 'steel' };
}

export default function AdvisorTaxpayersScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [search, setSearch] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const q = useQuery({
    queryKey: ['taxpayers-monthly', year, month],
    enabled,
    queryFn: () => api.get('/taxpayers', { params: { year, month } }).then((r) => r.data as Taxpayer[]),
  });

  const all: Taxpayer[] = enabled ? q.data ?? [] : DEMO;

  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('tr-TR');
    if (!needle) return all;
    return all.filter(
      (t) => adOf(t).toLocaleLowerCase('tr-TR').includes(needle) || (t.taxNumber || '').includes(needle),
    );
  }, [search, all]);

  const evrakEksik = all.filter((t) => !t.monthlyStatus?.evraklarGeldi).length;
  const beyanBekleyen = all.filter((t) => !t.monthlyStatus?.beyannameVerildi).length;

  return (
    <Screen scroll={false}>
      <ColorStrip color={COLOR} color2="copper" />
      <ModuleHeader
        eyebrow="‹ Mükellef Yönetimi"
        title="Mükellefler"
        subtitle={`${AYLAR[month - 1]} ${year} · aylık takip`}
        color={COLOR}
        onBack={() => router.back()}
      />

      {/* özet */}
      <View style={styles.statsRow}>
        <GradientCard color={COLOR} style={styles.statCard}>
          <Text style={styles.statVal}>{all.length}</Text>
          <Text style={styles.statLab}>Mükellef</Text>
        </GradientCard>
        <GradientCard color="copper" style={styles.statCard}>
          <Text style={[styles.statVal, { color: colors.copper }]}>{evrakEksik}</Text>
          <Text style={styles.statLab}>Evrak eksik</Text>
        </GradientCard>
        <GradientCard color="amber" style={styles.statCard}>
          <Text style={[styles.statVal, { color: colors.amber }]}>{beyanBekleyen}</Text>
          <Text style={styles.statLab}>Beyan bekleyen</Text>
        </GradientCard>
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={colors.textSoft} strokeWidth={2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Unvan, ad veya VKN ara"
          placeholderTextColor={colors.textSoft}
          style={styles.searchInput}
        />
      </View>

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Mükellef bulunamadı" subtitle="Arama kriterini değiştirin." />
      ) : (
        <ScrollView contentContainerStyle={styles.listBody} showsVerticalScrollIndicator={false}>
          <SectionLabel label={`Aylık takip (${items.length})`} />
          {items.map((t) => {
            const s = t.monthlyStatus;
            const a = asama(s);
            return (
              <View key={t.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{adOf(t).slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {adOf(t)}
                    </Text>
                    <Text style={styles.meta}>{t.taxNumber || 'VKN/TCKN yok'}</Text>
                  </View>
                  <MiniPill label={a.label} color={a.color} />
                </View>
                {/* takip adımları — gerçek monthlyStatus alanları */}
                <View style={styles.steps}>
                  <Step label="Evrak" on={!!s?.evraklarGeldi} />
                  <Step label="İşlem" on={!!s?.evraklarIslendi} />
                  <Step label="İnd.KDV" on={!!s?.indirilecekKdvKontrol} />
                  <Step label="Hes.KDV" on={!!s?.hesaplananKdvKontrol} />
                  <Step label="Arşiv" on={!!s?.eArsivKontrol} />
                  <Step label="Beyan" on={!!s?.beyannameVerildi} />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

function Step({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.step, on ? styles.stepOn : styles.stepOff]}>
      <Text style={[styles.stepText, { color: on ? colors.green : colors.textSoft }]}>
        {on ? '✓ ' : ''}
        {label}
      </Text>
    </View>
  );
}

const DEMO: Taxpayer[] = [
  { id: '1', companyName: 'ÖZ ELA İnşaat', taxNumber: '1234567890', monthlyStatus: { evraklarGeldi: true, evraklarIslendi: true, indirilecekKdvKontrol: true, hesaplananKdvKontrol: true, eArsivKontrol: true, beyannameVerildi: true } },
  { id: '2', companyName: 'Silber Yapı', taxNumber: '2345678901', monthlyStatus: { evraklarGeldi: true, evraklarIslendi: true, indirilecekKdvKontrol: true, hesaplananKdvKontrol: false } },
  { id: '3', companyName: 'Edeler Gıda', taxNumber: '3456789012', monthlyStatus: { evraklarGeldi: true, evraklarIslendi: false } },
  { id: '4', firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '45678901234', monthlyStatus: null },
];

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  statVal: { color: colors.gold, fontSize: 24, fontWeight: '800' },
  statLab: { color: colors.textMuted, fontSize: 10.5, fontWeight: '700', marginTop: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  searchInput: { flex: 1, height: 46, color: colors.text, fontSize: 14.5 },
  listBody: { gap: spacing.sm, paddingBottom: spacing.xxl + 20 },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.gold, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.25),
  },
  avatarText: { color: colors.gold, fontSize: 17, fontWeight: '800' },
  name: { color: colors.text, fontSize: 14.5, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 11.5, marginTop: 1 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  stepOn: { backgroundColor: withAlpha(colors.green, 0.13), borderColor: withAlpha(colors.green, 0.35) },
  stepOff: { backgroundColor: 'transparent', borderColor: colors.borderSoft },
  stepText: { fontSize: 10, fontWeight: '700' },
});
