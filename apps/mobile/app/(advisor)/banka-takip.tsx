import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react-native';
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

const COLOR = 'copper' as const;

/** İçinde bulunulan dönem: YYYY-MM */
function thisPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function taxpayerLabel(t: any): string {
  return (
    t?.companyName ||
    [t?.firstName, t?.lastName].filter(Boolean).join(' ') ||
    t?.taxNumber ||
    'Mükellef'
  );
}

export default function BankaTakipScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const donem = thisPeriod();

  const listQ = useQuery({
    queryKey: ['banka-takip', donem],
    enabled,
    queryFn: () =>
      api
        .get('/banka-takip/list', { params: { donem } })
        .then((r) => (r.data?.items ?? []) as any[]),
  });

  const items: any[] = enabled ? listQ.data ?? [] : DEMO_ITEMS;

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Finansal Takip · Banka"
        title="Banka Takip"
        subtitle={`Ekstre takibi · ${donem}`}
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && listQ.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && listQ.isError ? (
        <ErrorState onRetry={() => listQ.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Banka hesabı yok"
          subtitle="Bilanço esasındaki mükelleflere banka hesabı tanımlanınca burada listelenir."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Mükellef / Banka Hesapları" />
          {items.map((it, idx) => {
            const hesaplar: any[] = Array.isArray(it?.hesaplar) ? it.hesaplar : [];
            const ozet = it?.ozet || {};
            const hesapSayisi = Number(ozet.hesapSayisi ?? hesaplar.length);

            if (hesapSayisi === 0) {
              return (
                <ListRow
                  key={it?.taxpayer?.id ?? idx}
                  color={COLOR}
                  icon={<Landmark size={17} color={colors.steel} strokeWidth={2} />}
                  title={taxpayerLabel(it?.taxpayer)}
                  subtitle="Banka hesabı tanımlı değil"
                  right={<MiniPill label="hesap yok" color="steel" />}
                />
              );
            }

            return (
              <View key={it?.taxpayer?.id ?? idx} style={{ gap: spacing.xs }}>
                <ListRow
                  color={COLOR}
                  icon={<Landmark size={17} color={colors.copper} strokeWidth={2} />}
                  title={taxpayerLabel(it?.taxpayer)}
                  subtitle={`${hesapSayisi} banka hesabı`}
                  right={<MiniPill label={ozetDurum(ozet).label} color={ozetDurum(ozet).color} />}
                />
                {hesaplar.map((h, hi) => {
                  const banka = h?.bankaHesap?.bankaAdi || 'Banka';
                  const d = ekstreDurum(h?.ekstreGeldi, h?.ekstreIslendi);
                  return (
                    <View key={h?.bankaHesap?.id ?? hi} style={{ paddingLeft: spacing.lg }}>
                      <ListRow
                        color={COLOR}
                        title={banka}
                        subtitle={h?.bankaHesap?.iban || h?.bankaHesap?.hesapNo || undefined}
                        right={<MiniPill label={d.label} color={d.color} />}
                      />
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function ekstreDurum(geldi?: boolean, islendi?: boolean): { label: string; color: 'green' | 'amber' | 'rose' } {
  if (islendi) return { label: 'işlendi', color: 'green' };
  if (geldi) return { label: 'geldi', color: 'amber' };
  return { label: 'eksik', color: 'rose' };
}

function ozetDurum(ozet: any): { label: string; color: 'green' | 'amber' | 'rose' } {
  if (ozet?.tumIslendi) return { label: 'tamam', color: 'green' };
  if (ozet?.tumGeldi) return { label: 'işlenmedi', color: 'amber' };
  return { label: 'eksik', color: 'rose' };
}

/* ---- demo verisi (oturum demo modundayken) ---- */
const DEMO_ITEMS = [
  {
    taxpayer: { id: 'd1', companyName: 'ÖZ ELA İnşaat', taxNumber: '1234567890' },
    hesaplar: [
      { bankaHesap: { id: 'b1', bankaAdi: 'Ziraat Bankası', iban: 'TR12 ...' }, ekstreGeldi: true, ekstreIslendi: true },
      { bankaHesap: { id: 'b2', bankaAdi: 'İş Bankası', iban: 'TR34 ...' }, ekstreGeldi: true, ekstreIslendi: false },
    ],
    ozet: { hesapSayisi: 2, tumGeldi: true, tumIslendi: false, eksikGeldi: 0, eksikIslendi: 1 },
  },
  {
    taxpayer: { id: 'd2', companyName: 'EDELER Restaurant', taxNumber: '9876543210' },
    hesaplar: [
      { bankaHesap: { id: 'b3', bankaAdi: 'Garanti BBVA', iban: 'TR56 ...' }, ekstreGeldi: false, ekstreIslendi: false },
    ],
    ozet: { hesapSayisi: 1, tumGeldi: false, tumIslendi: false, eksikGeldi: 1, eksikIslendi: 1 },
  },
];
