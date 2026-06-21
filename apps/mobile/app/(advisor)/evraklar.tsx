import React from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react-native';
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

const COLOR = 'copper' as const;

type DocumentItem = {
  id: string;
  name?: string;
  fileName?: string;
  documentType?: string;
  category?: string;
  period?: string;
  ocrCompleted?: boolean;
  taxpayer?: { companyName?: string; firstName?: string; lastName?: string };
  createdAt?: string;
};

export default function EvraklarScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['advisor-documents'],
    enabled,
    queryFn: () => api.get('/documents').then((r) => (r.data ?? []) as DocumentItem[]),
  });

  const items: DocumentItem[] = enabled ? q.data ?? [] : DEMO;

  async function openDoc(id: string) {
    try {
      const { data } = await api.get(`/documents/${id}/download`);
      if (data?.url) await Linking.openURL(data.url);
      else Alert.alert('Belge', 'Bu belge şu an açılamıyor.');
    } catch {
      Alert.alert('Belge', 'Belge açılamadı, lütfen tekrar deneyin.');
    }
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="gold" />
      <ModuleHeader
        eyebrow="‹ Arşiv · Evraklar"
        title="Evrak Yönetimi"
        subtitle="Belge arşivi"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Evrak bulunmuyor" subtitle="Yüklenen belgeler burada listelenir." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label={`${items.length} belge`} />
          {items.map((d) => (
            <ListRow
              key={d.id}
              color={COLOR}
              icon={<FileText size={17} color={colors.copper} strokeWidth={2} />}
              title={d.name || d.fileName || 'Belge'}
              subtitle={subtitleFor(d)}
              right={<MiniPill label={typeTag(d)} color={COLOR} />}
              onPress={() => openDoc(d.id)}
            />
          ))}
          <GradientCard color={COLOR}>
            <SectionLabel label="📥 Karta dokunarak belgeyi açın" />
          </GradientCard>
        </View>
      )}
    </Screen>
  );
}

function taxpayerName(d: DocumentItem): string {
  const t = d.taxpayer;
  if (!t) return '';
  return t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function subtitleFor(d: DocumentItem): string {
  return [taxpayerName(d), d.period, fmtDate(d.createdAt)].filter(Boolean).join(' · ') || 'Belge';
}

function typeTag(d: DocumentItem): string {
  const t = (d.documentType || d.category || '').toLowerCase();
  if (t.includes('fatur')) return 'Fatura';
  if (t.includes('sozles') || t.includes('sözleş')) return 'Sözleşme';
  if (t.includes('tebligat')) return 'Tebligat';
  if (t.includes('banka')) return 'Banka';
  if (t.includes('muhasebe') || t.includes('rapor')) return 'Rapor';
  return d.documentType || d.category || 'Diğer';
}

const DEMO: DocumentItem[] = [
  { id: '1', name: 'Mart 2026 Satış Faturası', documentType: 'Fatura', period: 'Mart 2026', createdAt: new Date().toISOString(), taxpayer: { companyName: 'ÖZ ELA İnşaat' }, ocrCompleted: true },
  { id: '2', name: 'Kira Sözleşmesi', documentType: 'Sözleşme', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), taxpayer: { companyName: 'Demir Ticaret' } },
  { id: '3', name: 'e-Tebligat 2026/04', documentType: 'Tebligat', period: 'Nisan 2026', createdAt: new Date(Date.now() - 12 * 86400000).toISOString() },
];

const styles = StyleSheet.create({});
