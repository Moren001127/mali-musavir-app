import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
  ColorStrip,
  EmptyState,
  ErrorState,
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

type Takvim = {
  tip?: string;
  donem?: string;
  sonTarih?: string;
  aciklama?: string;
  kalanGun?: number;
  tahmini?: boolean;
};

function fmtTarih(v?: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : v;
}

export default function TaxpayerTakvimScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['portal-dashboard-takvim'],
    enabled,
    queryFn: () => api.get('/portal/dashboard').then((r) => r.data as any),
  });

  const takvim: Takvim[] = enabled ? (q.data?.vergiTakvimi ?? []) : DEMO;

  function pill(t: Takvim): { label: string; color: 'rose' | 'amber' | 'green' | 'steel' } {
    const g = t.kalanGun;
    if (g == null) return { label: t.tahmini ? 'tahmini' : 'planlı', color: 'steel' };
    if (g < 0) return { label: 'gecikti', color: 'rose' };
    if (g <= 3) return { label: `${g} gün`, color: 'rose' };
    if (g <= 7) return { label: `${g} gün`, color: 'amber' };
    return { label: `${g} gün`, color: 'green' };
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="Vergi Takvimi"
        title="Yaklaşan Tarihler"
        subtitle="Beyan ve ödeme son günleri"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : takvim.length === 0 ? (
        <EmptyState title="Yaklaşan tarih yok" subtitle="Bu dönem için planlı bir son tarih bulunmuyor." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Son tarihler" />
          {takvim.map((t, i) => {
            const p = pill(t);
            return (
              <ListRow
                key={i}
                color={COLOR}
                icon={<CalendarClock size={17} color={colors.steel} strokeWidth={2} />}
                title={t.aciklama || t.tip || 'Beyan/Ödeme'}
                subtitle={`${t.donem ? t.donem + ' · ' : ''}Son tarih: ${fmtTarih(t.sonTarih)}`}
                right={<MiniPill label={p.label} color={p.color} />}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const DEMO: Takvim[] = [
  { tip: 'KDV1', donem: 'Mayıs 2026', sonTarih: '2026-06-26', aciklama: 'KDV Beyannamesi ödemesi', kalanGun: 5 },
  { tip: 'MUHSGK', donem: 'Mayıs 2026', sonTarih: '2026-06-26', aciklama: 'Muhtasar ve Prim Hizmet', kalanGun: 5 },
  { tip: 'GECICI', donem: '2026/Q1', sonTarih: '2026-08-17', aciklama: 'Geçici Vergi', kalanGun: 57, tahmini: true },
  { tip: 'DAMGA', donem: 'Mayıs 2026', sonTarih: '2026-06-26', aciklama: 'Damga Vergisi', kalanGun: 5 },
];
