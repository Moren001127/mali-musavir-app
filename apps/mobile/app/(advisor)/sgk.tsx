import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, FileText, Bot } from 'lucide-react-native';
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

const COLOR = 'steel' as const;

// SGK için ayrı bir mobil ucu yok; portal otomasyon belgelerinden SGK kapsamı çekilir.
type PortalDoc = {
  id: string;
  belgeTuru?: string;
  title?: string;
  period?: string;
  createdAt?: string;
  taxpayer?: { companyName?: string; firstName?: string; lastName?: string };
};

type AgentStatus = { id?: string; agent: string; running: boolean; lastPing?: string };

export default function SgkScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  // Portal otomasyon belgeleri (SGK kapsamı). Uç yoksa/yetki yoksa boş dön.
  const docsQ = useQuery({
    queryKey: ['advisor-sgk-docs'],
    enabled,
    queryFn: () =>
      api
        .get('/portal-automation/documents', { params: { scope: 'sgk' } })
        .then((r) => (r.data ?? []) as PortalDoc[])
        .catch(() => [] as PortalDoc[]),
  });

  // SGK ajanının durumu (genel ajan listesinden süzülür).
  const statusQ = useQuery({
    queryKey: ['advisor-sgk-agent'],
    enabled,
    queryFn: () =>
      api
        .get('/agent/status')
        .then((r) => (r.data ?? []) as AgentStatus[])
        .catch(() => [] as AgentStatus[]),
  });

  const docs: PortalDoc[] = enabled ? docsQ.data ?? [] : DEMO_DOCS;
  const statuses: AgentStatus[] = enabled ? statusQ.data ?? [] : DEMO_STATUS;
  const sgkAgent = statuses.find((s) => (s.agent || '').toLowerCase().includes('sgk'));

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="gold" />
      <ModuleHeader
        eyebrow="‹ SGK · e-Bildirge"
        title="SGK Bildirge"
        subtitle="Tahakkuk ve hizmet listeleri"
        color={COLOR}
        onBack={() => router.back()}
      />

      <GradientCard color={COLOR}>
        <View style={styles.infoHead}>
          <ShieldCheck size={16} color={colors.steel} strokeWidth={2.2} />
          <SectionLabel label="SGK Ajanı" />
        </View>
        <View style={styles.agentRow}>
          <Bot size={15} color={colors.steel} strokeWidth={2} />
          <MiniPill
            label={sgkAgent ? (sgkAgent.running ? 'aktif' : 'durdu') : 'pasif'}
            color={sgkAgent?.running ? 'green' : 'steel'}
          />
        </View>
        <SectionLabel label="Onaylı tahakkuk fişleri ve hizmet listeleri her gece otomatik çekilir." />
      </GradientCard>

      {enabled && docsQ.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && docsQ.isError ? (
        <ErrorState onRetry={() => docsQ.refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          title="SGK belgesi yok"
          subtitle="Gece otomatik çekim tamamlandığında tahakkuk ve hizmet listeleri burada görünür."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="SGK belgeleri" />
          {docs.map((d) => (
            <ListRow
              key={d.id}
              color={COLOR}
              icon={<FileText size={17} color={colors.steel} strokeWidth={2} />}
              title={d.title || belgeLabel(d.belgeTuru)}
              subtitle={subtitleFor(d)}
              right={<MiniPill label={belgeLabel(d.belgeTuru)} color={COLOR} />}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function taxpayerName(d: PortalDoc): string {
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
function subtitleFor(d: PortalDoc): string {
  return [taxpayerName(d), d.period, fmtDate(d.createdAt)].filter(Boolean).join(' · ') || 'SGK belgesi';
}
function belgeLabel(t?: string): string {
  const v = (t || '').toUpperCase();
  if (v.includes('HIZMET')) return 'Hizmet Listesi';
  if (v.includes('TAHAKKUK')) return 'Tahakkuk';
  if (v.includes('GIRIS') || v.includes('CIKIS')) return 'Giriş/Çıkış';
  if (v.includes('ISGOREMEZLIK')) return 'İş Göremezlik';
  return t || 'SGK';
}

const DEMO_DOCS: PortalDoc[] = [
  { id: '1', belgeTuru: 'SGK_TAHAKKUK', title: 'Mart 2026 Tahakkuk', period: 'Mart 2026', createdAt: new Date().toISOString(), taxpayer: { companyName: 'ÖZ ELA İnşaat' } },
  { id: '2', belgeTuru: 'SGK_HIZMET_LISTESI', title: 'Hizmet Listesi 2026/03', period: 'Mart 2026', createdAt: new Date(Date.now() - 86400000).toISOString(), taxpayer: { companyName: 'Demir Ticaret' } },
];
const DEMO_STATUS: AgentStatus[] = [{ id: 'sgk', agent: 'sgk', running: false, lastPing: new Date(Date.now() - 3 * 3600000).toISOString() }];

const styles = StyleSheet.create({
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
});
