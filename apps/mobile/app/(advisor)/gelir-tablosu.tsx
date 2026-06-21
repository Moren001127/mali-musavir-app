import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'lucide-react-native';
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
  StatementRow,
  formatTL,
} from '../../components/ModuleKit';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing } from '../../lib/theme';

const COLOR = 'blue' as const;

/** Dönem etiketi — donem + donemTipi'nden güvenli üret */
function donemLabel(item: any): string {
  const donem = item?.donem || item?.tarih || '';
  const tip = formatDonemTipi(item?.donemTipi);
  return [donem, tip].filter(Boolean).join(' · ') || 'Gelir Tablosu';
}
function formatDonemTipi(t?: string): string {
  if (!t) return '';
  const map: Record<string, string> = {
    AYLIK: 'Aylık',
    GECICI_Q1: '1. Geçici',
    GECICI_Q2: '2. Geçici',
    GECICI_Q3: '3. Geçici',
    GECICI_Q4: '4. Geçici',
    YILLIK: 'Yıllık',
  };
  return map[t] || t;
}

/** Liste satırı için sonuç (net kâr/zarar) — savunmacı eriş */
function listSonuc(item: any): number {
  return Number(item?.donemNetKari ?? item?.sonuc ?? 0);
}

export default function GelirTablosuScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['gelir-tablosu-list'],
    enabled,
    queryFn: () => api.get('/gelir-tablosu').then((r) => r.data as any[]),
  });

  const detail = useQuery({
    queryKey: ['gelir-tablosu-detail', selectedId],
    enabled: enabled && !!selectedId,
    queryFn: () => api.get(`/gelir-tablosu/${selectedId}`).then((r) => r.data as any),
  });

  const records: any[] = enabled ? list.data ?? [] : DEMO_LIST;
  const activeDetail = enabled ? detail.data : DEMO_DETAIL;

  if (selectedId) {
    return (
      <GelirTablosuDetail
        data={activeDetail}
        loading={enabled && detail.isLoading}
        error={enabled && detail.isError}
        onRetry={() => detail.refetch()}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Mali Tablolar · Gelir Tablosu"
        title="Gelir Tablosu"
        subtitle="Oluşturulan gelir tabloları"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : records.length === 0 ? (
        <EmptyState
          title="Henüz gelir tablosu yok"
          subtitle="Mizandan gelir tablosu üretildiğinde burada listelenir."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Gelir Tabloları" />
          {records.map((g) => {
            const sonuc = listSonuc(g);
            return (
              <ListRow
                key={String(g.id)}
                color={COLOR}
                icon={<LineChart size={17} color={colors.blue} strokeWidth={2} />}
                title={g?.taxpayer?.companyName || g?.taxpayerAd || donemLabel(g)}
                subtitle={donemLabel(g)}
                right={
                  <MiniPill
                    label={(sonuc < 0 ? 'zarar ' : 'kâr ') + formatTL(Math.abs(sonuc))}
                    color={sonuc < 0 ? 'rose' : 'green'}
                  />
                }
                onPress={() => setSelectedId(String(g.id))}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function GelirTablosuDetail({
  data,
  loading,
  error,
  onRetry,
  onBack,
}: {
  data: any;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  // Backend düz kayıt döndürüyor; yine de {satirlar,toplamlar} sarmalına savunmacı bak.
  const v = useMemo(() => {
    const t = data?.toplamlar || data || {};
    const num = (...keys: string[]) => {
      for (const k of keys) {
        if (t[k] != null) return Number(t[k]) || 0;
        if (data?.[k] != null) return Number(data[k]) || 0;
      }
      return 0;
    };
    return {
      brutSatislar: num('brutSatislar'),
      satisIndirimleri: num('satisIndirimleri'),
      netSatislar: num('netSatislar'),
      satisMaliyeti: num('satisMaliyeti'),
      brutSatisKari: num('brutSatisKari'),
      faaliyetGiderleri: num('faaliyetGiderleri'),
      faaliyetKari: num('faaliyetKari'),
      digerGelirler: num('digerGelirler'),
      digerGiderler: num('digerGiderler'),
      finansmanGiderleri: num('finansmanGiderleri'),
      olaganKar: num('olaganKar'),
      olaganDisiGelir: num('olaganDisiGelir'),
      olaganDisiGider: num('olaganDisiGider'),
      donemKari: num('donemKari'),
      vergiKarsiligi: num('vergiKarsiligi'),
      donemNetKari: num('donemNetKari', 'sonuc'),
    };
  }, [data]);

  const net = v.donemNetKari;

  return (
    <Screen scroll={false}>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Gelir Tablosu"
        title={donemLabel(data)}
        subtitle={data?.taxpayer?.companyName || data?.taxpayerAd || 'Detay'}
        color={COLOR}
        onBack={onBack}
        right={<MiniPill label={net < 0 ? 'zarar' : 'kâr'} color={net < 0 ? 'rose' : 'green'} />}
      />

      {loading ? (
        <LoadingBlock color={COLOR} />
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : !data ? (
        <EmptyState title="Detay yok" />
      ) : (
        <ScrollView contentContainerStyle={styles.detailBody} showsVerticalScrollIndicator={false}>
          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="A · Brüt Satışlar" />
            <StatementRow label="Brüt Satışlar" value={formatTL(v.brutSatislar)} color={COLOR} />
            {v.satisIndirimleri ? (
              <StatementRow
                label="Satış İndirimleri (-)"
                value={formatTL(-v.satisIndirimleri)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            <StatementRow label="Net Satışlar" value={formatTL(v.netSatislar)} variant="key" color={COLOR} />
          </View>

          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="Satışların Maliyeti" />
            {v.satisMaliyeti ? (
              <StatementRow
                label="Satışların Maliyeti (-)"
                value={formatTL(-v.satisMaliyeti)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            <StatementRow label="Brüt Satış Karı" value={formatTL(v.brutSatisKari)} variant="key" color={COLOR} />
          </View>

          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="Faaliyet" />
            {v.faaliyetGiderleri ? (
              <StatementRow
                label="Faaliyet Giderleri (-)"
                value={formatTL(-v.faaliyetGiderleri)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            <StatementRow label="Faaliyet Karı" value={formatTL(v.faaliyetKari)} variant="key" color={COLOR} />
          </View>

          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="Diğer / Finansman" />
            {v.digerGelirler ? (
              <StatementRow label="Diğer Olağan Gelirler" value={formatTL(v.digerGelirler)} variant="sub" color={COLOR} />
            ) : null}
            {v.digerGiderler ? (
              <StatementRow
                label="Diğer Olağan Giderler (-)"
                value={formatTL(-v.digerGiderler)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            {v.finansmanGiderleri ? (
              <StatementRow
                label="Finansman Giderleri (-)"
                value={formatTL(-v.finansmanGiderleri)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            <StatementRow label="Olağan Kar" value={formatTL(v.olaganKar)} variant="key" color={COLOR} />
          </View>

          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="Dönem Sonucu" />
            {v.olaganDisiGelir ? (
              <StatementRow label="Olağandışı Gelirler" value={formatTL(v.olaganDisiGelir)} variant="sub" color={COLOR} />
            ) : null}
            {v.olaganDisiGider ? (
              <StatementRow
                label="Olağandışı Giderler (-)"
                value={formatTL(-v.olaganDisiGider)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            <StatementRow label="Dönem Karı" value={formatTL(v.donemKari)} variant="key" color={COLOR} />
            {v.vergiKarsiligi ? (
              <StatementRow
                label="Dönem Karı Vergi Karşılığı (-)"
                value={formatTL(-v.vergiKarsiligi)}
                variant="minus"
                color={COLOR}
              />
            ) : null}
            <StatementRow
              label="Dönem Net Karı / Zararı"
              value={formatTL(v.donemNetKari)}
              variant="net"
              color={COLOR}
            />
          </View>

          <GradientCard color={COLOR}>
            <SectionLabel label="📊 Mizandan otomatik üretildi · 📥 Excel portalde" />
          </GradientCard>
        </ScrollView>
      )}
    </Screen>
  );
}

/* ---- demo verisi (oturum demo modundayken) ---- */
const DEMO_LIST = [
  {
    id: 'demo',
    donem: '2026',
    donemTipi: 'GECICI_Q1',
    taxpayerAd: 'ÖZ ELA İnşaat',
    donemNetKari: 332800,
  },
];
const DEMO_DETAIL = {
  donem: '2026',
  donemTipi: 'GECICI_Q1',
  taxpayerAd: 'ÖZ ELA İnşaat',
  brutSatislar: 2400000,
  satisIndirimleri: 60000,
  netSatislar: 2340000,
  satisMaliyeti: 1620000,
  brutSatisKari: 720000,
  faaliyetGiderleri: 280000,
  faaliyetKari: 440000,
  digerGelirler: 18000,
  digerGiderler: 0,
  finansmanGiderleri: 36000,
  olaganKar: 422000,
  olaganDisiGelir: 0,
  olaganDisiGider: 0,
  donemKari: 422000,
  vergiKarsiligi: 89200,
  donemNetKari: 332800,
};

const styles = StyleSheet.create({
  detailBody: { gap: spacing.lg, paddingBottom: spacing.xxl + 40 },
});
