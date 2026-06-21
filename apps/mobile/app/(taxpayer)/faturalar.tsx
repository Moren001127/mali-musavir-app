import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, FileText } from 'lucide-react-native';
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
import { colors, spacing, withAlpha } from '../../lib/theme';

const COLOR = 'sage' as const;

type Fatura = {
  id: string;
  donem?: string | null;
  faturaTuru?: string | null;
  belgeTuru?: string | null;
  faturaNo?: string | null;
  firmaUnvan?: string | null;
  firmaKimlikNo?: string | null;
  faturaTarihi?: string | null;
  toplamTutar?: number | null;
  goruntulenebilir?: boolean;
};

type AyOzet = {
  alisToplam: number;
  satisToplam: number;
  alisAdet: number;
  satisAdet: number;
  toplamAdet?: number;
};

type FaturalarDetay = {
  yil: number;
  donem: string;
  mevcutYillar: number[];
  yilOzet: AyOzet;
  ayOzet: AyOzet;
  faturalar: Fatura[];
};

const AY_ADLARI = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export default function TaxpayerFaturalarScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const now = new Date();
  const [yil, setYil] = useState<number>(now.getFullYear());
  const [donem, setDonem] = useState<string>(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const q = useQuery({
    queryKey: ['portal-faturalar', yil, donem],
    enabled,
    queryFn: () =>
      api
        .get('/portal/faturalar', { params: { yil, donem } })
        .then((r) => r.data as FaturalarDetay),
  });

  const data: FaturalarDetay = enabled ? q.data ?? EMPTY : buildDemo(yil, donem);
  const items = data.faturalar ?? [];

  async function openFatura(f: Fatura) {
    if (!f.goruntulenebilir) {
      Alert.alert('Belge', 'Bu faturanın görüntüsü henüz hazır değil.');
      return;
    }
    try {
      const { data: r } = await api.get(`/portal/belge/fatura/${f.id}/view`);
      if (r?.url) await Linking.openURL(r.url);
      else Alert.alert('Belge', 'Bu belge şu an görüntülenemiyor.');
    } catch {
      Alert.alert('Belge', 'Belge açılamadı, lütfen tekrar deneyin.');
    }
  }

  const yillar = data.mevcutYillar?.length ? data.mevcutYillar : [yil];
  const seciliAyIdx = Number((donem.split('-')[1] || '1')) - 1;

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="Faturalarım"
        title="Faturalar"
        subtitle="Alış ve satış faturalarınız"
        color={COLOR}
        onBack={() => router.back()}
      />

      {/* Yıl seçimi */}
      <View style={{ gap: spacing.sm }}>
        <SectionLabel label="Yıl" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {yillar.map((y) => (
            <Chip
              key={y}
              label={String(y)}
              active={y === (data.yil ?? yil)}
              onPress={() => {
                setYil(y);
                setDonem(`${y}-${String(seciliAyIdx + 1).padStart(2, '0')}`);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Ay seçimi */}
      <View style={{ gap: spacing.sm }}>
        <SectionLabel label="Dönem" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {AY_ADLARI.map((ad, i) => {
            const dd = `${data.yil ?? yil}-${String(i + 1).padStart(2, '0')}`;
            return (
              <Chip
                key={dd}
                label={ad}
                active={dd === (data.donem ?? donem)}
                onPress={() => setDonem(dd)}
              />
            );
          })}
        </ScrollView>
      </View>

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {/* Dönem özeti */}
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <AmountCard
                label="Satış"
                value={formatTL(data.ayOzet?.satisToplam)}
                meta={`${data.ayOzet?.satisAdet ?? 0} fatura`}
                color="sage"
              />
            </View>
            <View style={{ flex: 1 }}>
              <AmountCard
                label="Alış"
                value={formatTL(data.ayOzet?.alisToplam)}
                meta={`${data.ayOzet?.alisAdet ?? 0} fatura`}
                color="blue"
              />
            </View>
          </View>

          {/* Liste */}
          {items.length === 0 ? (
            <EmptyState
              title="Bu dönemde fatura yok"
              subtitle="Seçtiğiniz dönem için kayıtlı fatura bulunmuyor."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              <SectionLabel label={`${AY_ADLARI[seciliAyIdx]} ${data.yil ?? yil} — ${items.length} fatura`} />
              {items.map((f) => {
                const satis = /SATIS/i.test(f.faturaTuru || '');
                return (
                  <ListRow
                    key={f.id}
                    color={COLOR}
                    icon={
                      satis ? (
                        <ArrowUpRight size={17} color={colors.sage} strokeWidth={2} />
                      ) : (
                        <ArrowDownLeft size={17} color={colors.blue} strokeWidth={2} />
                      )
                    }
                    title={f.firmaUnvan || f.faturaNo || 'Fatura'}
                    subtitle={`${f.faturaNo || '—'} • ${formatTarih(f.faturaTarihi)}`}
                    right={
                      <View style={styles.rowRight}>
                        <Text style={styles.tutar}>{formatTL(f.toplamTutar)}</Text>
                        <MiniPill label={satis ? 'satış' : 'alış'} color={satis ? 'sage' : 'blue'} />
                      </View>
                    }
                    onPress={() => openFatura(f)}
                  />
                );
              })}
              <GradientCard color={COLOR}>
                <SectionLabel label="📄 Karta dokunarak fatura görüntüsünü açın" />
              </GradientCard>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const accent = colors.sage;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active && { backgroundColor: withAlpha(accent, 0.18), borderColor: withAlpha(accent, 0.45) },
      ]}
    >
      <Text style={[styles.chipText, active && { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

function formatTarih(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

const EMPTY: FaturalarDetay = {
  yil: new Date().getFullYear(),
  donem: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  mevcutYillar: [new Date().getFullYear()],
  yilOzet: { alisToplam: 0, satisToplam: 0, alisAdet: 0, satisAdet: 0 },
  ayOzet: { alisToplam: 0, satisToplam: 0, alisAdet: 0, satisAdet: 0, toplamAdet: 0 },
  faturalar: [],
};

function buildDemo(yil: number, donem: string): FaturalarDetay {
  const ay = donem.split('-')[1] || '06';
  const t = (g: string, d: number) => `${yil}-${ay}-${String(d).padStart(2, '0')}T09:00:00.000Z`;
  const faturalar: Fatura[] = [
    { id: 'd1', donem, faturaTuru: 'SATIS', faturaNo: `EAR2026${ay}001`, firmaUnvan: 'Yıldız Gıda San. Tic. Ltd. Şti.', firmaKimlikNo: '1234567890', faturaTarihi: t('', 3), toplamTutar: 48750, goruntulenebilir: true },
    { id: 'd2', donem, faturaTuru: 'SATIS', faturaNo: `EAR2026${ay}002`, firmaUnvan: 'Mavi Deniz Turizm A.Ş.', firmaKimlikNo: '2345678901', faturaTarihi: t('', 6), toplamTutar: 12300, goruntulenebilir: true },
    { id: 'd3', donem, faturaTuru: 'ALIS', faturaNo: `A-2026-0451`, firmaUnvan: 'Anadolu Toptan Pazarlama', firmaKimlikNo: '3456789012', faturaTarihi: t('', 8), toplamTutar: 27640, goruntulenebilir: true },
    { id: 'd4', donem, faturaTuru: 'SATIS', faturaNo: `EAR2026${ay}003`, firmaUnvan: 'Kervan Lojistik Hiz.', firmaKimlikNo: '4567890123', faturaTarihi: t('', 11), toplamTutar: 8900, goruntulenebilir: true },
    { id: 'd5', donem, faturaTuru: 'TEVKIFATLI_ALIS', faturaNo: `F-99812`, firmaUnvan: 'Ege Temizlik İnşaat', firmaKimlikNo: '5678901234', faturaTarihi: t('', 12), toplamTutar: 15400, goruntulenebilir: false },
    { id: 'd6', donem, faturaTuru: 'ALIS', faturaNo: `2026/3320`, firmaUnvan: 'Net İletişim Telekom A.Ş.', firmaKimlikNo: '6789012345', faturaTarihi: t('', 15), toplamTutar: 3120, goruntulenebilir: true },
    { id: 'd7', donem, faturaTuru: 'SATIS', faturaNo: `EAR2026${ay}004`, firmaUnvan: 'Doğa Market Zinciri', firmaKimlikNo: '7890123456', faturaTarihi: t('', 18), toplamTutar: 63200, goruntulenebilir: true },
    { id: 'd8', donem, faturaTuru: 'ALIS', faturaNo: `B-7741`, firmaUnvan: 'Başak Kırtasiye Ofis', firmaKimlikNo: '8901234567', faturaTarihi: t('', 21), toplamTutar: 1875, goruntulenebilir: true },
    { id: 'd9', donem, faturaTuru: 'SATIS', faturaNo: `EAR2026${ay}005`, firmaUnvan: 'Karadeniz Balıkçılık Koop.', firmaKimlikNo: '9012345678', faturaTarihi: t('', 24), toplamTutar: 21450, goruntulenebilir: true },
    { id: 'd10', donem, faturaTuru: 'ALIS', faturaNo: `2026-118`, firmaUnvan: 'Elektrik Dağıtım A.Ş.', firmaKimlikNo: '0123456789', faturaTarihi: t('', 27), toplamTutar: 9340, goruntulenebilir: true },
  ];
  const satis = faturalar.filter((f) => /SATIS/i.test(f.faturaTuru || ''));
  const alis = faturalar.filter((f) => !/SATIS/i.test(f.faturaTuru || ''));
  const sum = (arr: Fatura[]) => arr.reduce((s, f) => s + (f.toplamTutar || 0), 0);
  return {
    yil,
    donem,
    mevcutYillar: [yil, yil - 1, yil - 2],
    yilOzet: { satisToplam: sum(satis) * 6, alisToplam: sum(alis) * 6, satisAdet: satis.length * 6, alisAdet: alis.length * 6 },
    ayOzet: { satisToplam: sum(satis), alisToplam: sum(alis), satisAdet: satis.length, alisAdet: alis.length, toplamAdet: faturalar.length },
    faturalar,
  };
}

const styles = StyleSheet.create({
  chips: { gap: spacing.xs, paddingRight: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  cardRow: { flexDirection: 'row', gap: spacing.sm },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  tutar: { color: colors.text, fontSize: 13, fontWeight: '800' },
});
