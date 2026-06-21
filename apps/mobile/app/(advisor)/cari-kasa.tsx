import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Users, ArrowDownCircle, ArrowUpCircle, Wallet } from 'lucide-react-native';
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

const COLOR = 'copper' as const;

function taxpayerLabel(t: any): string {
  return (
    t?.companyName ||
    [t?.firstName, t?.lastName].filter(Boolean).join(' ') ||
    t?.unvan ||
    t?.taxNumber ||
    'Mükellef'
  );
}

export default function CariKasaScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [selected, setSelected] = useState<any | null>(null);

  const list = useQuery({
    queryKey: ['cari-taxpayers'],
    enabled,
    queryFn: () =>
      api.get('/taxpayers').then((r) => (r.data?.data ?? r.data ?? []) as any[]),
  });

  const taxpayers: any[] = enabled ? list.data ?? [] : DEMO_TAXPAYERS;

  if (selected) {
    return (
      <CariDetail
        taxpayer={selected}
        enabled={enabled}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="gold" />
      <ModuleHeader
        eyebrow="‹ Finansal Takip · Cari"
        title="Cari Kasa"
        subtitle="Mükellef seçin · bakiye ve hareketler"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : taxpayers.length === 0 ? (
        <EmptyState title="Mükellef yok" subtitle="Önce mükellef eklendiğinde burada listelenir." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Mükellefler" />
          {taxpayers.map((t) => (
            <ListRow
              key={t.id}
              color={COLOR}
              icon={<Users size={17} color={colors.copper} strokeWidth={2} />}
              title={taxpayerLabel(t)}
              subtitle={t.taxNumber ? `VKN ${t.taxNumber}` : undefined}
              onPress={() => setSelected(t)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function CariDetail({
  taxpayer,
  enabled,
  onBack,
}: {
  taxpayer: any;
  enabled: boolean;
  onBack: () => void;
}) {
  const taxpayerId = taxpayer?.id;
  const realEnabled = enabled && !!taxpayerId && !String(taxpayerId).startsWith('demo');

  const bakiyeQ = useQuery({
    queryKey: ['cari-bakiye', taxpayerId],
    enabled: realEnabled,
    queryFn: () => api.get(`/cari-kasa/bakiye/${taxpayerId}`).then((r) => r.data as any),
  });

  const hareketQ = useQuery({
    queryKey: ['cari-hareket', taxpayerId],
    enabled: realEnabled,
    queryFn: () =>
      api
        .get('/cari-kasa/hareket', { params: { taxpayerId, limit: 100 } })
        .then((r) => (Array.isArray(r.data) ? r.data : []) as any[]),
  });

  const bakiye: any = realEnabled ? bakiyeQ.data : DEMO_BAKIYE;
  const hareketler: any[] = realEnabled ? hareketQ.data ?? [] : DEMO_HAREKET;

  const loading = realEnabled && (bakiyeQ.isLoading || hareketQ.isLoading);
  const isError = realEnabled && (bakiyeQ.isError || hareketQ.isError);

  const bakiyeVal = Number(bakiye?.bakiye ?? 0);

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="gold" />
      <ModuleHeader
        eyebrow="‹ Cari Kasa"
        title={taxpayerLabel(taxpayer)}
        subtitle={taxpayer?.taxNumber ? `VKN ${taxpayer.taxNumber}` : 'Cari hesap'}
        color={COLOR}
        onBack={onBack}
        right={
          <MiniPill
            label={bakiyeVal > 0 ? 'açık bakiye' : 'kapalı'}
            color={bakiyeVal > 0 ? 'rose' : 'green'}
          />
        }
      />

      {loading ? (
        <LoadingBlock color={COLOR} />
      ) : isError ? (
        <ErrorState
          onRetry={() => {
            bakiyeQ.refetch();
            hareketQ.refetch();
          }}
        />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {/* Bakiye kartları */}
          <View style={{ gap: spacing.sm }}>
            <AmountCard
              label="Açık Bakiye"
              value={formatTL(bakiyeVal)}
              meta="tahakkuk − tahsilat"
              color={bakiyeVal > 0 ? 'rose' : 'green'}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AmountCard
                  label="Toplam Tahakkuk"
                  value={formatTL(Number(bakiye?.tahakkuk ?? 0))}
                  color="copper"
                />
              </View>
              <View style={{ flex: 1 }}>
                <AmountCard
                  label="Toplam Tahsilat"
                  value={formatTL(Number(bakiye?.tahsilat ?? 0))}
                  color="green"
                />
              </View>
            </View>
          </View>

          {/* Son hareketler */}
          <View style={{ gap: spacing.sm }}>
            <SectionLabel label="Son Hareketler" />
            {hareketler.length === 0 ? (
              <EmptyState title="Hareket yok" subtitle="Tahakkuk veya tahsilat girildiğinde burada görünür." />
            ) : (
              hareketler.map((h, i) => {
                const tahsilat = h?.tip === 'TAHSILAT' || h?.tip === 'IADE';
                const accent = tahsilat ? 'green' : 'rose';
                const baslik =
                  h?.hizmet?.hizmetAdi || h?.aciklama || tipLabel(h?.tip);
                return (
                  <ListRow
                    key={h?.id ?? i}
                    color={COLOR}
                    icon={
                      tahsilat ? (
                        <ArrowDownCircle size={17} color={colors.green} strokeWidth={2} />
                      ) : (
                        <ArrowUpCircle size={17} color={colors.rose} strokeWidth={2} />
                      )
                    }
                    title={baslik}
                    subtitle={fmtDate(h?.tarih)}
                    right={
                      <MiniPill
                        label={`${tahsilat ? '−' : '+'}${formatTL(Number(h?.tutar ?? 0)).replace('₺', '₺')}`}
                        color={accent}
                      />
                    }
                  />
                );
              })
            )}
          </View>

          <GradientCard color={COLOR}>
            <SectionLabel label="Detaylı ekstre ve tahsilat girişi portalda yapılır." />
          </GradientCard>
        </View>
      )}
    </Screen>
  );
}

function tipLabel(tip?: string): string {
  if (tip === 'TAHSILAT') return 'Tahsilat';
  if (tip === 'TAHAKKUK') return 'Tahakkuk';
  if (tip === 'IADE') return 'İade';
  if (tip === 'DUZELTME') return 'Düzeltme';
  return 'Hareket';
}

function fmtDate(v?: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR');
}

/* ---- demo verisi (oturum demo modundayken) ---- */
const DEMO_TAXPAYERS = [
  { id: 'demo-1', companyName: 'ÖZ ELA İnşaat Ltd. Şti.', taxNumber: '1234567890' },
  { id: 'demo-2', companyName: 'EDELER Restaurant', taxNumber: '9876543210' },
];
const DEMO_BAKIYE = { tahakkuk: 36000, tahsilat: 24000, bakiye: 12000, borc: 36000, alacak: 24000 };
const DEMO_HAREKET = [
  { id: 'h1', tip: 'TAHAKKUK', tutar: 3000, tarih: '2026-06-01', hizmet: { hizmetAdi: 'Aylık Defter Ücreti' } },
  { id: 'h2', tip: 'TAHSILAT', tutar: 3000, tarih: '2026-06-05', aciklama: 'Havale' },
  { id: 'h3', tip: 'TAHAKKUK', tutar: 3000, tarih: '2026-05-01', hizmet: { hizmetAdi: 'Aylık Defter Ücreti' } },
  { id: 'h4', tip: 'TAHSILAT', tutar: 1500, tarih: '2026-05-10', aciklama: 'Kısmi ödeme' },
];
