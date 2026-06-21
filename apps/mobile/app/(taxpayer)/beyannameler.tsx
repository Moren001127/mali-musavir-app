import React, { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileText, ReceiptText } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
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
import { colors, radius, spacing, withAlpha } from '../../lib/theme';

const COLOR = 'amber' as const;

/** /portal/beyannameler (getBeyannamelerListe) ile birebir alanlar. */
type Beyanname = {
  id: string;
  beyanTipi: string;
  donem: string;
  beyanTarihi?: string | null;
  createdAt?: string | null;
  tahakkukTutari?: number | null;
  onayNo?: string | null;
  mahiyet?: 'ASIL' | 'DUZELTME';
  hasBeyanname?: boolean;
  hasTahakkuk?: boolean;
  hasXml?: boolean;
};

// Beyanname türü etiketleri — müşavir Beyanname Listesi ile aynı.
const TIP_ETIKET: Record<string, string> = {
  KDV1: "KDV (1 No'lu)",
  KDV2: 'KDV Tevkifat (2)',
  KDV4: "KDV (4 No'lu)",
  KDV9015: 'KDV 9015',
  MUHSGK: 'Muhtasar ve Prim',
  MUHSGK2: 'Muhtasar (2)',
  MUHTASAR: 'Muhtasar',
  DAMGA: 'Damga Vergisi',
  POSET: 'Poşet Beyanı',
  KURUMLAR: 'Kurumlar Vergisi',
  GELIR: 'Gelir Vergisi',
  BILDIRGE: 'SGK Bildirge',
  EDEFTER: 'E-Defter',
  GGECICI: 'Gelir Geçici',
  KGECICI: 'Kurum Geçici',
  GECICI_VERGI: 'Geçici Vergi',
  SGK: 'SGK Tahakkuk',
  DIGER: 'Diğer',
};

// Tür filtresi sekmeleri — eşleşen beyanTipi önekleri.
const FILTRELER: { key: string; label: string; match: (t: string) => boolean }[] = [
  { key: 'HEPSI', label: 'Tümü', match: () => true },
  { key: 'KDV1', label: 'KDV1', match: (t) => t === 'KDV1' },
  { key: 'KDV2', label: 'KDV2', match: (t) => t === 'KDV2' || t === 'KDV4' || t === 'KDV9015' },
  { key: 'MUHSGK', label: 'Muhtasar', match: (t) => t.startsWith('MUH') || t === 'MUHTASAR' },
  { key: 'GECICI', label: 'Geçici', match: (t) => t.includes('GECICI') },
  { key: 'SGK', label: 'SGK', match: (t) => t === 'SGK' || t === 'BILDIRGE' },
];

function fmtDonem(donem?: string): string {
  if (!donem) return '';
  const q = donem.match(/^(\d{4})-Q([1-4])$/i);
  if (q) {
    const s = (Number(q[2]) - 1) * 3 + 1;
    return `${q[1]}/${s}-${s + 2}. ay`;
  }
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

export default function TaxpayerBeyannamelerScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [filtre, setFiltre] = useState('HEPSI');

  const q = useQuery({
    queryKey: ['portal-beyannameler'],
    enabled,
    queryFn: () => api.get('/portal/beyannameler').then((r) => r.data as Beyanname[]),
  });

  const all: Beyanname[] = enabled ? q.data ?? [] : DEMO;
  const aktifFiltre = FILTRELER.find((f) => f.key === filtre) ?? FILTRELER[0];
  const items = useMemo(() => all.filter((b) => aktifFiltre.match(b.beyanTipi || '')), [all, aktifFiltre]);

  // Özet rakamlar
  const toplamTahakkuk = useMemo(
    () => all.reduce((s, b) => s + (b.tahakkukTutari || 0), 0),
    [all],
  );
  const verilenSayi = all.filter((b) => b.hasBeyanname).length;

  async function openPdf(b: Beyanname, kind: 'beyanname' | 'tahakkuk' = 'beyanname') {
    const apiKind = kind === 'tahakkuk' ? undefined : 'beyanname'; // tahakkuk = pdf (varsayılan)
    try {
      const { data } = await api.get(`/portal/belge/beyanname/${b.id}/view`, {
        params: apiKind ? { kind: apiKind } : undefined,
      });
      if (data?.url) await Linking.openURL(data.url);
      else Alert.alert('Belge', 'Bu belge şu an görüntülenemiyor.');
    } catch {
      Alert.alert('Belge', 'Belge açılamadı, lütfen tekrar deneyin.');
    }
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="Vergi ve Beyan"
        title="Beyannamelerim"
        subtitle={`${all.length} beyanname kaydı`}
        color={COLOR}
        onBack={() => router.back()}
      />

      {/* Özet kartı */}
      <GradientCard color={COLOR}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.amber }]}>Toplam Tahakkuk</Text>
            <Text style={styles.summaryValue}>{formatTL(toplamTahakkuk)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.green }]}>Verilen Beyanname</Text>
            <Text style={styles.summaryValue}>{verilenSayi} / {all.length}</Text>
          </View>
        </View>
      </GradientCard>

      {/* Tür filtresi */}
      <View style={styles.filterRow}>
        {FILTRELER.map((f) => {
          const aktif = f.key === filtre;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFiltre(f.key)}
              style={[
                styles.filterChip,
                aktif && { backgroundColor: withAlpha(colors.amber, 0.18), borderColor: withAlpha(colors.amber, 0.45) },
              ]}
            >
              <Text style={[styles.filterText, aktif && { color: colors.amber }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Beyanname bulunmuyor"
          subtitle="Bu türde kayıt yok. Dönem beyannameleriniz hazır olduğunda burada görünür."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label={`Kayıtlar (${items.length})`} />
          {items.map((b) => {
            const tarih = fmtTarih(b.beyanTarihi || b.createdAt);
            const etiket = TIP_ETIKET[b.beyanTipi] || b.beyanTipi;
            return (
              <ListRow
                key={b.id}
                color={COLOR}
                icon={<FileText size={17} color={colors.amber} strokeWidth={2} />}
                title={`${etiket} — ${fmtDonem(b.donem)}`}
                subtitle={[
                  b.tahakkukTutari != null ? `Tahakkuk ${formatTL(b.tahakkukTutari)}` : 'Tahakkuk yok',
                  b.mahiyet === 'DUZELTME' ? 'Düzeltme' : null,
                  tarih,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<MiniPill label={durumLabel(b)} color={durumColor(b)} />}
                onPress={() => openPdf(b, 'beyanname')}
              />
            );
          })}

          <GradientCard color={COLOR}>
            <View style={styles.hintRow}>
              <Eye size={15} color={colors.amber} strokeWidth={2} />
              <Text style={styles.hintText}>
                Karta dokunarak beyannamenin PDF'ini açabilirsiniz. Tahakkuk fişi için de aynı kayıt kullanılır.
              </Text>
            </View>
          </GradientCard>
        </View>
      )}
    </Screen>
  );
}

function durumLabel(b: Beyanname): string {
  if (b.hasBeyanname) return 'verildi';
  if (b.hasTahakkuk) return 'tahakkuk';
  return 'bekliyor';
}
function durumColor(b: Beyanname): 'green' | 'amber' | 'rose' {
  if (b.hasBeyanname) return 'green';
  if (b.hasTahakkuk) return 'amber';
  return 'rose';
}

/* ============================ ZENGİN DEMO ============================ */
const DEMO: Beyanname[] = [
  { id: 'd1', beyanTipi: 'KDV1', donem: '2026-05', beyanTarihi: '2026-06-24', tahakkukTutari: 18450, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true, onayNo: 'KDV1-2026-0512' },
  { id: 'd2', beyanTipi: 'MUHSGK', donem: '2026-05', beyanTarihi: '2026-06-23', tahakkukTutari: 12380, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true, onayNo: 'MUH-2026-0498' },
  { id: 'd3', beyanTipi: 'KDV2', donem: '2026-05', beyanTarihi: '2026-06-23', tahakkukTutari: 2640, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true },
  { id: 'd4', beyanTipi: 'KDV1', donem: '2026-04', beyanTarihi: '2026-05-26', tahakkukTutari: 21100, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true, onayNo: 'KDV1-2026-0411' },
  { id: 'd5', beyanTipi: 'MUHSGK', donem: '2026-04', beyanTarihi: '2026-05-24', tahakkukTutari: 11920, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true },
  { id: 'd6', beyanTipi: 'GECICI_VERGI', donem: '2026-Q1', beyanTarihi: '2026-05-17', tahakkukTutari: 34800, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true, onayNo: 'GV-2026-Q1-022' },
  { id: 'd7', beyanTipi: 'KDV1', donem: '2026-03', beyanTarihi: '2026-04-25', tahakkukTutari: 0, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true },
  { id: 'd8', beyanTipi: 'DAMGA', donem: '2026-03', beyanTarihi: '2026-04-24', tahakkukTutari: 860, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true },
  { id: 'd9', beyanTipi: 'KDV1', donem: '2026-02', beyanTarihi: '2026-03-26', tahakkukTutari: 16740, mahiyet: 'DUZELTME', hasBeyanname: true, hasTahakkuk: true, onayNo: 'KDV1-2026-0233' },
  { id: 'd10', beyanTipi: 'MUHSGK', donem: '2026-02', beyanTarihi: '2026-03-25', tahakkukTutari: 10560, mahiyet: 'ASIL', hasBeyanname: true, hasTahakkuk: true },
  { id: 'd11', beyanTipi: 'KURUMLAR', donem: '2025-YIL', beyanTarihi: null, tahakkukTutari: null, mahiyet: 'ASIL', hasBeyanname: false, hasTahakkuk: false },
];

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, gap: 4 },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: spacing.md },
  summaryLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  summaryValue: { color: colors.text, fontSize: 19, fontWeight: '700' },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  filterText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hintText: { flex: 1, color: colors.textMuted, fontSize: 11.5, lineHeight: 16 },
});
