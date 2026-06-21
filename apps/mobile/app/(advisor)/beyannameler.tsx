import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
  AmountCard,
  ColorStrip,
  EmptyState,
  ErrorState,
  formatTL,
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

type BeyanKaydi = {
  id: string;
  taxpayerId?: string;
  beyanTipi?: string;
  donem?: string;
  onayNo?: string | null;
  tahakkukTutari?: number | null;
};

type Ozet = {
  toplam: number;
  byTip: Record<string, number>;
  toplamTahakkuk: number;
};

const BEYAN_TIPI_LABEL: Record<string, string> = {
  KDV1: "KDV (1 No'lu)",
  KDV2: 'KDV Tevkifat (2)',
  MUHSGK: 'MUHSGK',
  DAMGA: 'Damga Vergisi',
  POSET: 'Poşet Beyan.',
  KURUMLAR: 'Kurumlar V.',
  GELIR: 'Gelir V.',
  BILDIRGE: 'SGK Bildirge',
  EDEFTER: 'E-Defter',
  GGECICI: 'Gelir Geçici',
  KGECICI: 'Kurum Geçici',
  GECICI_VERGI: 'Geçici Vergi',
  DIGER: 'Diğer',
};

export default function AdvisorBeyannamelerScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const ozet = useQuery({
    queryKey: ['beyan-kayitlari-ozet'],
    enabled,
    queryFn: () => api.get('/beyan-kayitlari/ozet').then((r) => r.data as Ozet),
  });

  const list = useQuery({
    queryKey: ['beyan-kayitlari-list'],
    enabled,
    queryFn: () =>
      api.get('/beyan-kayitlari', { params: { limit: 50 } }).then((r) => r.data as BeyanKaydi[]),
  });

  const items: BeyanKaydi[] = enabled ? list.data ?? [] : DEMO_LIST;
  const summary: Ozet | undefined = enabled ? ozet.data : DEMO_OZET;

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="‹ Mali Veriler · Beyannameler"
        title="Beyannameler"
        subtitle="Beyanname ve tahakkuk kayıtları"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {summary ? (
            <View style={{ gap: spacing.sm }}>
              <AmountCard
                label="Toplam Tahakkuk"
                value={formatTL(summary.toplamTahakkuk)}
                meta={`${summary.toplam} beyanname kaydı`}
                color={COLOR}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <AmountCard
                    label="KDV"
                    value={String((summary.byTip?.KDV1 || 0) + (summary.byTip?.KDV2 || 0))}
                    color="blue"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <AmountCard label="MUHSGK" value={String(summary.byTip?.MUHSGK || 0)} color="green" />
                </View>
                <View style={{ flex: 1 }}>
                  <AmountCard
                    label="Geçici"
                    value={String(
                      (summary.byTip?.GECICI_VERGI || 0) +
                        (summary.byTip?.GGECICI || 0) +
                        (summary.byTip?.KGECICI || 0),
                    )}
                    color="copper"
                  />
                </View>
              </View>
            </View>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              title="Beyanname bulunmuyor"
              subtitle="Dönem beyannameleri hazır olduğunda burada listelenir."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              <SectionLabel label="Kayıtlar" />
              {items.map((b) => (
                <ListRow
                  key={b.id}
                  color={COLOR}
                  icon={<FileText size={17} color={colors.amber} strokeWidth={2} />}
                  title={`${BEYAN_TIPI_LABEL[b.beyanTipi || ''] || b.beyanTipi || 'Beyanname'} — ${b.donem || ''}`}
                  subtitle={
                    b.tahakkukTutari != null
                      ? `Tahakkuk ${formatTL(b.tahakkukTutari)}`
                      : 'Tahakkuk bilgisi yok'
                  }
                  right={<MiniPill label={durumLabel(b)} color={durumColor(b)} />}
                />
              ))}
              <GradientCard color={COLOR}>
                <SectionLabel label="📄 Beyanname ve tahakkuk PDF'leri portal panelinden indirilir" />
              </GradientCard>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

function durumLabel(b: BeyanKaydi): string {
  if (b.onayNo) return 'gönderildi';
  return 'bekliyor';
}
function durumColor(b: BeyanKaydi): 'green' | 'amber' {
  return b.onayNo ? 'green' : 'amber';
}

/* ---- demo verisi (oturum demo modundayken) ---- */
const DEMO_OZET: Ozet = {
  toplam: 4,
  byTip: { KDV1: 2, MUHSGK: 1, GECICI_VERGI: 1 },
  toplamTahakkuk: 43750,
};
const DEMO_LIST: BeyanKaydi[] = [
  { id: '1', beyanTipi: 'KDV1', donem: 'Mayıs 2026', tahakkukTutari: 18450, onayNo: 'A123456' },
  { id: '2', beyanTipi: 'MUHSGK', donem: 'Mayıs 2026', tahakkukTutari: 4200, onayNo: 'B654321' },
  { id: '3', beyanTipi: 'KDV1', donem: 'Nisan 2026', tahakkukTutari: 21100, onayNo: 'A111222' },
  { id: '4', beyanTipi: 'GECICI_VERGI', donem: '2026/1', tahakkukTutari: null, onayNo: null },
];
