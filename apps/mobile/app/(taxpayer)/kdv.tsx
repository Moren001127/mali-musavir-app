import React, { useMemo } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, FileText, Receipt } from 'lucide-react-native';
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

/** /portal/dashboard yanıtı (yalnız KDV için gerekli alanlar). */
type Dashboard = {
  beyannameler?: {
    beyanTipi: string;
    donem: string;
    durum?: string | null;
    tahakkukTutari?: number | null;
    verildiTarihi?: string | null;
    belge?: { kayitId?: string } | null;
  }[];
  vergiTakvimi?: {
    tip: string;
    donem: string;
    sonTarih: string;
    aciklama?: string | null;
    kalanGun: number;
    tahmini?: boolean;
  }[];
};

function fmtDonem(donem?: string): string {
  if (!donem) return '';
  const m = donem.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const ay = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][Number(m[2])];
    return `${ay} ${m[1]}`;
  }
  return donem;
}
const fmtTarih = (v?: string | null): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : null;
};

const isKdv = (t: string) => /^KDV/i.test(t);

export default function TaxpayerKdvScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['portal-dashboard-kdv'],
    enabled,
    queryFn: () => api.get('/portal/dashboard').then((r) => r.data as Dashboard),
  });

  const dash: Dashboard = enabled ? q.data ?? {} : DEMO;

  // KDV beyannameleri (dönem azalan)
  const kdvBeyanlar = useMemo(
    () =>
      (dash.beyannameler ?? [])
        .filter((b) => isKdv(b.beyanTipi))
        .sort((a, b) => String(b.donem).localeCompare(String(a.donem))),
    [dash.beyannameler],
  );

  // Bu dönemin KDV1'i = en yeni KDV1 kaydı
  const buDonem = useMemo(() => kdvBeyanlar.find((b) => b.beyanTipi === 'KDV1') ?? kdvBeyanlar[0], [kdvBeyanlar]);

  // Yaklaşan KDV son tarihi
  const yakinKdv = useMemo(
    () =>
      (dash.vergiTakvimi ?? [])
        .filter((t) => /KDV/i.test(t.tip))
        .sort((a, b) => a.kalanGun - b.kalanGun)[0],
    [dash.vergiTakvimi],
  );

  async function openPdf(kayitId?: string) {
    if (!kayitId) {
      Alert.alert('Belge', 'Bu dönem için görüntülenecek beyanname bulunmuyor.');
      return;
    }
    try {
      const { data } = await api.get(`/portal/belge/beyanname/${kayitId}/view`, { params: { kind: 'beyanname' } });
      if (data?.url) await Linking.openURL(data.url);
      else Alert.alert('Belge', 'Bu belge şu an görüntülenemiyor.');
    } catch {
      Alert.alert('Belge', 'Belge açılamadı, lütfen tekrar deneyin.');
    }
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="green" />
      <ModuleHeader
        eyebrow="Katma Değer Vergisi"
        title="KDV Durumum"
        subtitle="Tahakkuk, son ödeme ve beyan geçmişi"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {/* Bu dönem KDV tahakkuku */}
          <AmountCard
            color={COLOR}
            label={`Bu dönem KDV (${buDonem ? fmtDonem(buDonem.donem) : '—'})`}
            value={buDonem?.tahakkukTutari != null ? formatTL(buDonem.tahakkukTutari) : '—'}
            meta={
              buDonem
                ? buDonem.verildiTarihi
                  ? `Beyan verildi · ${fmtTarih(buDonem.verildiTarihi)}`
                  : buDonem.durum === 'beklemede'
                  ? 'Beyan hazırlanıyor'
                  : 'Tahakkuk hazır'
                : 'KDV kaydı bulunmuyor'
            }
          />

          {/* Yaklaşan KDV son tarihi */}
          {yakinKdv ? (
            <GradientCard color="rose">
              <View style={styles.dueRow}>
                <View style={styles.dueIcon}>
                  <CalendarClock size={20} color={colors.rose} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dueLabel}>Yaklaşan KDV son tarihi</Text>
                  <Text style={styles.dueTitle}>
                    {fmtTarih(yakinKdv.sonTarih)} · {yakinKdv.kalanGun} gün kaldı
                  </Text>
                  <Text style={styles.dueText}>
                    {yakinKdv.aciklama || `KDV (${fmtDonem(yakinKdv.donem)}) beyan/ödeme son günü`}
                    {yakinKdv.tahmini ? ' (tahmini)' : ''}
                  </Text>
                </View>
              </View>
            </GradientCard>
          ) : null}

          {/* Geçmiş KDV beyannameleri */}
          <View style={{ gap: spacing.sm }}>
            <SectionLabel label={`KDV Beyan Geçmişi (${kdvBeyanlar.length})`} />
            {kdvBeyanlar.length === 0 ? (
              <EmptyState title="KDV kaydı yok" subtitle="KDV beyannameleriniz hazır olduğunda burada listelenir." />
            ) : (
              kdvBeyanlar.map((b, i) => {
                const verildi = !!b.verildiTarihi || b.durum === 'verildi' || b.durum === 'onaylandi';
                return (
                  <ListRow
                    key={`${b.beyanTipi}-${b.donem}-${i}`}
                    color={COLOR}
                    icon={<Receipt size={17} color={colors.amber} strokeWidth={2} />}
                    title={`${b.beyanTipi} — ${fmtDonem(b.donem)}`}
                    subtitle={
                      b.tahakkukTutari != null
                        ? `Tahakkuk ${formatTL(b.tahakkukTutari)}${fmtTarih(b.verildiTarihi) ? ` · ${fmtTarih(b.verildiTarihi)}` : ''}`
                        : 'Tahakkuk bilgisi yok'
                    }
                    right={<MiniPill label={verildi ? 'verildi' : 'bekliyor'} color={verildi ? 'green' : 'rose'} />}
                    onPress={() => openPdf(b.belge?.kayitId)}
                  />
                );
              })
            )}
          </View>

          <GradientCard color={COLOR}>
            <View style={styles.hintRow}>
              <FileText size={15} color={colors.amber} strokeWidth={2} />
              <Text style={styles.hintText}>
                KDV beyannamesinin PDF'ini açmak için kayda dokunun. Tüm beyannameler için "Beyannamelerim" sayfasına geçebilirsiniz.
              </Text>
            </View>
          </GradientCard>
        </View>
      )}
    </Screen>
  );
}

/* ============================ ZENGİN DEMO ============================ */
const DEMO: Dashboard = {
  beyannameler: [
    { beyanTipi: 'KDV1', donem: '2026-05', durum: 'verildi', tahakkukTutari: 18450, verildiTarihi: '2026-06-24', belge: { kayitId: 'k1' } },
    { beyanTipi: 'KDV2', donem: '2026-05', durum: 'verildi', tahakkukTutari: 2640, verildiTarihi: '2026-06-23', belge: { kayitId: 'k2' } },
    { beyanTipi: 'KDV1', donem: '2026-04', durum: 'verildi', tahakkukTutari: 21100, verildiTarihi: '2026-05-26', belge: { kayitId: 'k3' } },
    { beyanTipi: 'KDV1', donem: '2026-03', durum: 'verildi', tahakkukTutari: 0, verildiTarihi: '2026-04-25', belge: { kayitId: 'k4' } },
    { beyanTipi: 'KDV1', donem: '2026-02', durum: 'verildi', tahakkukTutari: 16740, verildiTarihi: '2026-03-26', belge: { kayitId: 'k5' } },
    { beyanTipi: 'KDV1', donem: '2026-01', durum: 'verildi', tahakkukTutari: 14320, verildiTarihi: '2026-02-25', belge: { kayitId: 'k6' } },
    { beyanTipi: 'MUHSGK', donem: '2026-05', durum: 'verildi', tahakkukTutari: 12380, verildiTarihi: '2026-06-23' },
  ],
  vergiTakvimi: [
    { tip: 'KDV1', donem: '2026-06', sonTarih: '2026-07-28', aciklama: 'KDV Beyannamesi (2026-06) beyan/ödeme son günü', kalanGun: 7, tahmini: true },
    { tip: 'MUHSGK', donem: '2026-06', sonTarih: '2026-07-26', aciklama: 'Muhtasar ve Prim (2026-06) son günü', kalanGun: 5, tahmini: true },
  ],
};

const styles = StyleSheet.create({
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dueIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,113,133,0.14)',
  },
  dueLabel: { color: colors.rose, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  dueTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  dueText: { color: colors.textMuted, fontSize: 11.5, marginTop: 3, lineHeight: 16 },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hintText: { flex: 1, color: colors.textMuted, fontSize: 11.5, lineHeight: 16 },
});
