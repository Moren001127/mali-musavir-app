import React from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Users } from 'lucide-react-native';
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

const COLOR = 'steel' as const;

type SgkBelge = {
  id: string;
  belgeTuru?: string | null; // SGK_TAHAKKUK | SGK_HIZMET_LISTESI
  donem?: string | null;
  mahiyet?: string | null;
  calisan?: string | null;
  tutar?: string | null; // "1.234,56" biçiminde gelebilir
  viewedAt?: string | null;
  goruntulenebilir?: boolean;
};

export default function TaxpayerSgkScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['portal-sgk'],
    enabled,
    queryFn: () => api.get('/portal/sgk').then((r) => r.data as SgkBelge[]),
  });

  const items: SgkBelge[] = enabled ? q.data ?? [] : DEMO;

  // Özet: en güncel tahakkuk tutarı + en güncel çalışan sayısı
  const tahakkuklar = items.filter((b) => b.belgeTuru === 'SGK_TAHAKKUK');
  const sonTahakkuk = tahakkuklar[0];
  const sonCalisanBelge = items.find((b) => parseCalisan(b.calisan) != null);

  async function openBelge(b: SgkBelge) {
    if (!b.goruntulenebilir) {
      Alert.alert('SGK', 'Bu belgenin görüntüsü henüz hazır değil.');
      return;
    }
    try {
      const { data } = await api.get(`/portal/belge/sgk/${b.id}/view`);
      if (data?.url) await Linking.openURL(data.url);
      else Alert.alert('SGK', 'Bu belge şu an görüntülenemiyor.');
    } catch {
      Alert.alert('SGK', 'Belge açılamadı, lütfen tekrar deneyin.');
    }
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="SGK"
        title="SGK Belgeleri"
        subtitle="Prim tahakkukları ve aylık bildirgeler"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="SGK belgesi bulunmuyor"
          subtitle="Tahakkuk fişiniz ve aylık bildirgeniz hazır olduğunda burada görünür."
          icon={<FileText size={22} color={colors.steel} strokeWidth={2} />}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {/* Özet kartları */}
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <AmountCard
                label="Son Prim Tahakkuku"
                value={fmtTutar(sonTahakkuk?.tutar)}
                meta={sonTahakkuk?.donem ? `${sonTahakkuk.donem} dönemi` : 'Tahakkuk yok'}
                color="steel"
              />
            </View>
            <View style={{ flex: 1 }}>
              <AmountCard
                label="Çalışan Sayısı"
                value={sonCalisanBelge?.calisan ? String(parseCalisan(sonCalisanBelge.calisan)) : '—'}
                meta={sonCalisanBelge?.donem ? `${sonCalisanBelge.donem} bildirgesi` : 'Bildirge yok'}
                color="blue"
              />
            </View>
          </View>

          {/* Liste */}
          <View style={{ gap: spacing.sm }}>
            <SectionLabel label={`${items.length} belge`} />
            {items.map((b) => {
              const tahakkuk = b.belgeTuru === 'SGK_TAHAKKUK';
              const tutarVar = !!fmtTutar(b.tutar) && fmtTutar(b.tutar) !== '—';
              return (
                <ListRow
                  key={b.id}
                  color={COLOR}
                  icon={
                    tahakkuk ? (
                      <FileText size={17} color={colors.steel} strokeWidth={2} />
                    ) : (
                      <Users size={17} color={colors.blue} strokeWidth={2} />
                    )
                  }
                  title={`${turAdi(b.belgeTuru)} — ${b.donem || '—'}`}
                  subtitle={altBilgi(b)}
                  right={
                    <View style={styles.rowRight}>
                      {tutarVar ? <MiniPill label={fmtTutar(b.tutar)} color="steel" /> : null}
                      {b.mahiyet ? <MiniPill label={b.mahiyet.toLowerCase()} color={tahakkuk ? 'steel' : 'blue'} /> : null}
                    </View>
                  }
                  onPress={() => openBelge(b)}
                />
              );
            })}
            <GradientCard color={COLOR}>
              <SectionLabel label="📑 Karta dokunarak SGK belgesini açın" />
            </GradientCard>
          </View>
        </View>
      )}
    </Screen>
  );
}

function turAdi(t?: string | null): string {
  if (t === 'SGK_TAHAKKUK') return 'Prim Tahakkuk Fişi';
  if (t === 'SGK_HIZMET_LISTESI') return 'Aylık Hizmet Listesi';
  return 'SGK Belgesi';
}

function altBilgi(b: SgkBelge): string {
  const parts: string[] = [];
  const c = parseCalisan(b.calisan);
  if (c != null) parts.push(`${c} çalışan`);
  if (b.mahiyet) parts.push(b.mahiyet);
  return parts.length ? parts.join(' • ') : turAdi(b.belgeTuru);
}

/** "1.234,56" / "1234.56" / number → sayı; çözemezse null. */
function parseTutar(v?: string | null): number | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().replace(/[^\d.,]/g, '');
  if (!s) return null;
  // Türkçe biçim: nokta=binlik, virgül=ondalık
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isNaN(n) ? null : n;
}

function fmtTutar(v?: string | null): string {
  const n = parseTutar(v);
  if (n == null) return v ? String(v) : '—';
  return formatTL(n);
}

function parseCalisan(v?: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isNaN(n) || n === 0 ? null : n;
}

const DEMO: SgkBelge[] = [
  { id: 's1', belgeTuru: 'SGK_TAHAKKUK', donem: '2026-05', mahiyet: 'ASIL', calisan: '8', tutar: '42.350,00', viewedAt: null, goruntulenebilir: true },
  { id: 's2', belgeTuru: 'SGK_HIZMET_LISTESI', donem: '2026-05', mahiyet: 'ASIL', calisan: '8', tutar: '', viewedAt: '2026-06-02T09:00:00.000Z', goruntulenebilir: true },
  { id: 's3', belgeTuru: 'SGK_TAHAKKUK', donem: '2026-04', mahiyet: 'ASIL', calisan: '8', tutar: '41.980,00', viewedAt: '2026-05-04T10:00:00.000Z', goruntulenebilir: true },
  { id: 's4', belgeTuru: 'SGK_HIZMET_LISTESI', donem: '2026-04', mahiyet: 'EK', calisan: '1', tutar: '', viewedAt: '2026-05-05T11:00:00.000Z', goruntulenebilir: true },
  { id: 's5', belgeTuru: 'SGK_TAHAKKUK', donem: '2026-03', mahiyet: 'ASIL', calisan: '7', tutar: '38.420,00', viewedAt: '2026-04-03T09:30:00.000Z', goruntulenebilir: true },
  { id: 's6', belgeTuru: 'SGK_HIZMET_LISTESI', donem: '2026-03', mahiyet: 'ASIL', calisan: '7', tutar: '', viewedAt: '2026-04-04T08:00:00.000Z', goruntulenebilir: false },
];

const styles = StyleSheet.create({
  cardRow: { flexDirection: 'row', gap: spacing.sm },
  rowRight: { alignItems: 'flex-end', gap: 4 },
});
