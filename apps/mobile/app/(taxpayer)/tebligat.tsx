import React from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Mail, MailOpen } from 'lucide-react-native';
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

const COLOR = 'blue' as const;

type Tebligat = {
  id: string;
  title?: string | null;
  referenceNo?: string | null;
  period?: string | null;
  issuedAt?: string | null;
  receivedAt?: string | null;
  createdAt?: string | null;
  viewedAt?: string | null;
  kurumAciklama?: string | null;
  altKurum?: string | null;
  tebligZamani?: string | null;
  goruntulenebilir?: boolean;
};

export default function TaxpayerTebligatScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['portal-tebligatlar'],
    enabled,
    queryFn: () => api.get('/portal/tebligatlar').then((r) => r.data as Tebligat[]),
  });

  const items: Tebligat[] = enabled ? q.data ?? [] : DEMO;
  const yeniSayisi = items.filter((t) => !t.viewedAt).length;

  async function openTebligat(t: Tebligat) {
    if (!t.goruntulenebilir) {
      Alert.alert('Tebligat', 'Bu tebligatın belgesi henüz görüntülenemiyor.');
      return;
    }
    try {
      const { data } = await api.get(`/portal/belge/tebligat/${t.id}/view`);
      if (data?.url) await Linking.openURL(data.url);
      else Alert.alert('Tebligat', 'Bu belge şu an görüntülenemiyor.');
    } catch {
      Alert.alert('Tebligat', 'Belge açılamadı, lütfen tekrar deneyin.');
    }
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="sage" />
      <ModuleHeader
        eyebrow="e-Tebligat"
        title="Tebligatlar"
        subtitle="Resmî kurumlardan gelen tebligatlar"
        color={COLOR}
        onBack={() => router.back()}
        right={yeniSayisi > 0 ? <MiniPill label={`${yeniSayisi} yeni`} color="rose" /> : undefined}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Tebligat bulunmuyor"
          subtitle="Size bir tebligat ulaştığında burada görünür."
          icon={<Mail size={22} color={colors.blue} strokeWidth={2} />}
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label={`${items.length} tebligat`} />
          {items.map((t) => {
            const okundu = !!t.viewedAt;
            const kurum = t.kurumAciklama || t.altKurum || 'Kurum belirtilmedi';
            const tarih = formatTarih(t.tebligZamani || t.receivedAt || t.issuedAt || t.createdAt);
            return (
              <ListRow
                key={t.id}
                color={COLOR}
                icon={
                  okundu ? (
                    <MailOpen size={17} color={colors.textMuted} strokeWidth={2} />
                  ) : (
                    <Mail size={17} color={colors.blue} strokeWidth={2} />
                  )
                }
                title={t.title || 'Tebligat'}
                subtitle={`${kurum} • ${tarih}`}
                right={<MiniPill label={okundu ? 'okundu' : 'yeni'} color={okundu ? 'steel' : 'rose'} />}
                onPress={() => openTebligat(t)}
              />
            );
          })}
          <GradientCard color={COLOR}>
            <SectionLabel label="📨 Karta dokunarak tebligat belgesini açın" />
          </GradientCard>
        </View>
      )}
    </Screen>
  );
}

function formatTarih(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

const DEMO: Tebligat[] = [
  {
    id: 't1',
    title: 'KDV İade İncelemesi Bilgi İsteme Yazısı',
    kurumAciklama: 'Gelir İdaresi Başkanlığı',
    altKurum: 'Beşiktaş Vergi Dairesi',
    tebligZamani: '2026-06-18T10:30:00.000Z',
    viewedAt: null,
    goruntulenebilir: true,
  },
  {
    id: 't2',
    title: 'Geçici Vergi Beyannamesi Hatırlatması',
    kurumAciklama: 'Gelir İdaresi Başkanlığı',
    altKurum: 'Dijital Vergi Dairesi',
    tebligZamani: '2026-06-10T08:00:00.000Z',
    viewedAt: null,
    goruntulenebilir: true,
  },
  {
    id: 't3',
    title: 'SGK Prim Tahakkuk Bildirimi',
    kurumAciklama: 'Sosyal Güvenlik Kurumu',
    altKurum: 'Şişli SGK Müdürlüğü',
    tebligZamani: '2026-05-28T14:15:00.000Z',
    viewedAt: '2026-05-29T09:00:00.000Z',
    goruntulenebilir: true,
  },
  {
    id: 't4',
    title: 'Mükellefiyet Bilgileri Güncelleme Tebligatı',
    kurumAciklama: 'Gelir İdaresi Başkanlığı',
    altKurum: 'Beşiktaş Vergi Dairesi',
    tebligZamani: '2026-05-12T11:00:00.000Z',
    viewedAt: '2026-05-12T16:40:00.000Z',
    goruntulenebilir: false,
  },
];

const styles = StyleSheet.create({});
