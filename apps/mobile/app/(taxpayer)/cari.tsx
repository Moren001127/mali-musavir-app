import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react-native';
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

/** /portal/cari (getCariOzet) ile birebir alanlar. */
type Hareket = {
  tarih?: string | null;
  tip: string;
  tutar: number;
  aciklama?: string | null;
  donem?: string | null;
  hizmetAdi?: string | null;
  borc: number;
  alacak: number;
  runningBakiye: number;
};
type CariOzet = {
  bakiye: number;
  tahakkukToplam: number;
  tahsilatToplam: number;
  hareketler: Hareket[];
};

const TIP_ETIKET: Record<string, string> = {
  TAHAKKUK: 'Tahakkuk',
  TAHSILAT: 'Tahsilat',
  IADE: 'İade',
  DUZELTME: 'Düzeltme',
};

const fmtTarih = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : '—';
};

export default function TaxpayerCariScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['portal-cari'],
    enabled,
    queryFn: () => api.get('/portal/cari').then((r) => r.data as CariOzet),
  });

  const data: CariOzet = enabled ? q.data ?? EMPTY : DEMO;
  const netBakiye = Number(data.bakiye || 0);
  const borclu = netBakiye > 0;
  const hareketler = data.hareketler || [];

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="gold" />
      <ModuleHeader
        eyebrow="Ofis Hesabı"
        title="Cari Hesabım"
        subtitle="Tahakkuk, tahsilat ve yürüyen bakiye"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {/* Açık bakiye */}
          <AmountCard
            color={borclu ? 'rose' : 'green'}
            label="Açık Bakiye"
            value={formatTL(Math.abs(netBakiye))}
            meta={borclu ? 'Ödenmesi gereken borç' : netBakiye < 0 ? 'Lehinize bakiye' : 'Borcunuz yok'}
          />

          {/* Tahakkuk / Tahsilat ikili kart */}
          <View style={styles.dualRow}>
            <GradientCard color={COLOR} style={styles.dualCard}>
              <View style={styles.dualHead}>
                <ArrowUpRight size={15} color={colors.copper} strokeWidth={2.2} />
                <Text style={[styles.dualLabel, { color: colors.copper }]}>Toplam Tahakkuk</Text>
              </View>
              <Text style={styles.dualValue}>{formatTL(data.tahakkukToplam)}</Text>
            </GradientCard>
            <GradientCard color="green" style={styles.dualCard}>
              <View style={styles.dualHead}>
                <ArrowDownLeft size={15} color={colors.green} strokeWidth={2.2} />
                <Text style={[styles.dualLabel, { color: colors.green }]}>Toplam Tahsilat</Text>
              </View>
              <Text style={styles.dualValue}>{formatTL(data.tahsilatToplam)}</Text>
            </GradientCard>
          </View>

          {/* Hareket listesi */}
          <View style={{ gap: spacing.sm }}>
            <SectionLabel label={`Cari Hareketler (${hareketler.length})`} />
            {hareketler.length === 0 ? (
              <EmptyState
                title="Hareket bulunmuyor"
                subtitle="Cari hesap hareketleriniz oluştuğunda burada görünür."
                icon={<Wallet size={24} color={colors.copper} strokeWidth={1.8} />}
              />
            ) : (
              hareketler.map((h, i) => {
                const tahsilat = h.tip === 'TAHSILAT';
                const tutarLi = h.borc ? h.borc : h.alacak;
                const isAlacak = h.alacak > 0;
                const aciklama = [h.hizmetAdi, h.aciklama || h.donem].filter(Boolean).join(' · ') || 'Hareket';
                return (
                  <ListRow
                    key={i}
                    color={tahsilat ? 'green' : COLOR}
                    icon={
                      isAlacak ? (
                        <ArrowDownLeft size={17} color={colors.green} strokeWidth={2} />
                      ) : (
                        <ArrowUpRight size={17} color={colors.copper} strokeWidth={2} />
                      )
                    }
                    title={aciklama}
                    subtitle={`${fmtTarih(h.tarih)} · Bakiye ${formatTL(h.runningBakiye)}`}
                    right={
                      <View style={styles.rowAmount}>
                        <Text style={[styles.amountText, { color: isAlacak ? colors.green : colors.copper }]}>
                          {formatTL(tutarLi, { withSign: false })}
                          {isAlacak ? ' +' : ' −'}
                        </Text>
                        <MiniPill label={TIP_ETIKET[h.tip] || h.tip} color={tahsilat ? 'green' : COLOR} />
                      </View>
                    }
                  />
                );
              })
            )}
          </View>
        </View>
      )}
    </Screen>
  );
}

const EMPTY: CariOzet = { bakiye: 0, tahakkukToplam: 0, tahsilatToplam: 0, hareketler: [] };

/* ============================ ZENGİN DEMO ============================
 * Yürüyen bakiye gerçekçi: en yeni satır üstte, runningBakiye = o işlem sonrası bakiye.
 * Borç = TAHAKKUK (+), Alacak = TAHSILAT (+). Net bakiye = tahakkuk − tahsilat = 33.470.
 */
const DEMO: CariOzet = {
  bakiye: 33470,
  tahakkukToplam: 121870,
  tahsilatToplam: 88400,
  hareketler: [
    { tarih: '2026-06-24', tip: 'TAHAKKUK', tutar: 18450, aciklama: 'KDV1 tahakkuk', donem: '2026-05', hizmetAdi: 'KDV Beyan', borc: 18450, alacak: 0, runningBakiye: 33470 },
    { tarih: '2026-06-20', tip: 'TAHSILAT', tutar: 15000, aciklama: 'Havale ile ödeme', donem: '2026-05', hizmetAdi: null, borc: 0, alacak: 15000, runningBakiye: 15020 },
    { tarih: '2026-06-12', tip: 'TAHAKKUK', tutar: 12380, aciklama: 'Muhtasar tahakkuk', donem: '2026-05', hizmetAdi: 'MUHSGK', borc: 12380, alacak: 0, runningBakiye: 30020 },
    { tarih: '2026-05-28', tip: 'TAHSILAT', tutar: 20000, aciklama: 'Nakit tahsilat', donem: '2026-04', hizmetAdi: null, borc: 0, alacak: 20000, runningBakiye: 17640 },
    { tarih: '2026-05-26', tip: 'TAHAKKUK', tutar: 21100, aciklama: 'KDV1 tahakkuk', donem: '2026-04', hizmetAdi: 'KDV Beyan', borc: 21100, alacak: 0, runningBakiye: 37640 },
    { tarih: '2026-05-15', tip: 'TAHSILAT', tutar: 18400, aciklama: 'Havale ile ödeme', donem: '2026-03', hizmetAdi: null, borc: 0, alacak: 18400, runningBakiye: 16540 },
    { tarih: '2026-04-25', tip: 'TAHAKKUK', tutar: 34800, aciklama: 'Geçici vergi tahakkuk', donem: '2026-Q1', hizmetAdi: 'Geçici Vergi', borc: 34800, alacak: 0, runningBakiye: 34940 },
    { tarih: '2026-04-10', tip: 'TAHSILAT', tutar: 25000, aciklama: 'Havale ile ödeme', donem: '2026-02', hizmetAdi: null, borc: 0, alacak: 25000, runningBakiye: 140 },
    { tarih: '2026-03-26', tip: 'DUZELTME', tutar: 1860, aciklama: 'Mahsup düzeltme', donem: '2026-02', hizmetAdi: null, borc: 0, alacak: -1860, runningBakiye: 25140 },
    { tarih: '2026-02-25', tip: 'TAHAKKUK', tutar: 16740, aciklama: 'KDV1 tahakkuk', donem: '2026-01', hizmetAdi: 'KDV Beyan', borc: 16740, alacak: 0, runningBakiye: 23280 },
  ],
};

const styles = StyleSheet.create({
  dualRow: { flexDirection: 'row', gap: spacing.sm },
  dualCard: { flex: 1, gap: spacing.xs },
  dualHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dualLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  dualValue: { color: colors.text, fontSize: 18, fontWeight: '700' },

  rowAmount: { alignItems: 'flex-end', gap: 5 },
  amountText: { fontSize: 13, fontWeight: '800' },
});
