import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react-native';
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

/** Bilanço başlığı — tarih (varsa) yoksa dönem */
function bilancoLabel(item: any): string {
  if (item?.tarih) {
    const d = new Date(item.tarih);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('tr-TR');
  }
  return item?.donem || 'Bilanço';
}

/** aktif/pasif objesinden kalem listesi çıkar — {grup,toplam} olan, tutarı sıfır olmayanlar */
function kalemler(section: any): Array<{ grup: string; toplam: number; hesaplar?: any[] }> {
  if (!section) return [];
  // Dizi olarak da gelebilir, obje olarak da (key→kalem)
  const arr = Array.isArray(section) ? section : Object.values(section);
  return arr
    .filter((k: any) => k && typeof k === 'object' && (k.grup != null || k.label != null))
    .map((k: any) => ({
      grup: String(k.grup ?? k.label ?? k.ad ?? '—'),
      toplam: Number(k.toplam ?? k.tutar ?? k.value ?? 0),
      hesaplar: Array.isArray(k.hesaplar) ? k.hesaplar : [],
    }))
    .filter((k) => Math.abs(k.toplam) > 0.004);
}

export default function BilancoScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['bilanco-list'],
    enabled,
    queryFn: () => api.get('/bilanco').then((r) => r.data as any[]),
  });

  const detail = useQuery({
    queryKey: ['bilanco-detail', selectedId],
    enabled: enabled && !!selectedId,
    queryFn: () => api.get(`/bilanco/${selectedId}`).then((r) => r.data as any),
  });

  const records: any[] = enabled ? list.data ?? [] : DEMO_LIST;
  const activeDetail = enabled ? detail.data : DEMO_DETAIL;

  if (selectedId) {
    return (
      <BilancoDetail
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
        eyebrow="‹ Mali Tablolar · Bilanço"
        title="Bilanço"
        subtitle="Oluşturulan bilançolar"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : records.length === 0 ? (
        <EmptyState title="Henüz bilanço yok" subtitle="Mizandan bilanço üretildiğinde burada listelenir." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Bilançolar" />
          {records.map((b) => {
            const aktif = Number(b?.aktifToplami ?? 0);
            return (
              <ListRow
                key={String(b.id)}
                color={COLOR}
                icon={<Scale size={17} color={colors.blue} strokeWidth={2} />}
                title={b?.taxpayer?.companyName || b?.taxpayerAd || bilancoLabel(b)}
                subtitle={`${bilancoLabel(b)}${aktif ? ' · Aktif ' + formatTL(aktif) : ''}`}
                right={<MiniPill label="görüntüle" color={COLOR} />}
                onPress={() => setSelectedId(String(b.id))}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function BilancoDetail({
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
  const aktifKalemler = useMemo(() => kalemler(data?.aktif ?? data?.hesaplar?.aktif), [data]);
  const pasifKalemler = useMemo(() => kalemler(data?.pasif ?? data?.hesaplar?.pasif), [data]);

  const aktifToplam = Number(
    data?.aktifToplami ?? data?.toplamlar?.aktifToplami ?? data?.toplamlar?.aktif ?? 0,
  );
  const pasifToplam = Number(
    data?.pasifToplami ?? data?.toplamlar?.pasifToplami ?? data?.toplamlar?.pasif ?? 0,
  );
  const fark = aktifToplam - pasifToplam;
  const denk = Math.abs(fark) < 1;

  return (
    <Screen scroll={false}>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Bilanço"
        title={bilancoLabel(data)}
        subtitle={data?.taxpayer?.companyName || data?.taxpayerAd || 'Detay'}
        color={COLOR}
        onBack={onBack}
        right={<MiniPill label={denk ? '✓ denk' : 'denk değil'} color={denk ? 'green' : 'amber'} />}
      />

      {loading ? (
        <LoadingBlock color={COLOR} />
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : !data ? (
        <EmptyState title="Detay yok" />
      ) : (
        <ScrollView contentContainerStyle={styles.detailBody} showsVerticalScrollIndicator={false}>
          {/* AKTİF */}
          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="Aktif (Varlıklar)" />
            {aktifKalemler.length === 0 ? (
              <StatementRow label="Kalem yok" value="—" variant="sub" color={COLOR} />
            ) : (
              aktifKalemler.map((k, i) => (
                <StatementRow key={`a-${i}`} label={k.grup} value={formatTL(k.toplam)} variant="sub" color={COLOR} />
              ))
            )}
            <StatementRow label="AKTİF TOPLAMI" value={formatTL(aktifToplam)} variant="net" color={COLOR} />
          </View>

          {/* PASİF */}
          <View style={{ gap: spacing.xs }}>
            <SectionLabel label="Pasif (Kaynaklar)" />
            {pasifKalemler.length === 0 ? (
              <StatementRow label="Kalem yok" value="—" variant="sub" color={COLOR} />
            ) : (
              pasifKalemler.map((k, i) => (
                <StatementRow key={`p-${i}`} label={k.grup} value={formatTL(k.toplam)} variant="sub" color={COLOR} />
              ))
            )}
            <StatementRow label="PASİF TOPLAMI" value={formatTL(pasifToplam)} variant="net" color={COLOR} />
          </View>

          <GradientCard color={COLOR}>
            <View style={styles.denkRow}>
              <SectionLabel label={denk ? 'Bilanço denk' : `Fark: ${formatTL(fark)}`} />
              <MiniPill
                label={denk ? '✓ Aktif = Pasif' : 'kontrol et'}
                color={denk ? 'green' : 'amber'}
              />
            </View>
          </GradientCard>
        </ScrollView>
      )}
    </Screen>
  );
}

/* ---- demo verisi (oturum demo modundayken) ----
 * Mizan demosuyla tutarlı, kapanmış dönem bilançosu; dengeli:
 *   AKTİF TOPLAMI = PASİF TOPLAMI = 7.760.100
 *   Dönen Varlıklar 2.700.000 + Duran Varlıklar 5.060.100
 *   KV Kaynak 1.641.350 + UV Kaynak 3.325.950 + Özkaynak 2.792.800
 */
const DEMO_LIST = [
  { id: 'demo', donem: 'Mart 2026', tarih: '2026-03-31', taxpayerAd: 'ÖZ ELA İnşaat', aktifToplami: 7760100 },
];
const DEMO_DETAIL = {
  donem: 'Mart 2026',
  tarih: '2026-03-31',
  taxpayerAd: 'ÖZ ELA İnşaat',
  aktifToplami: 7760100,
  pasifToplami: 7760100,
  aktif: {
    // Dönen Varlıklar (toplam 2.700.000)
    hazirDegerler: { grup: '10 Hazır Değerler', toplam: 1011800, hesaplar: [] },
    ticariAlacaklar: { grup: '12 Ticari Alacaklar', toplam: 518900, hesaplar: [] },
    stoklar: { grup: '15 Stoklar', toplam: 989000, hesaplar: [] },
    digerDonenVarliklar: { grup: '19 Diğer Dönen Varlıklar', toplam: 180300, hesaplar: [] },
    // Duran Varlıklar (toplam 5.060.100, birikmiş amortisman düşülmüş net)
    maddiDuran: { grup: '25 Maddi Duran Varlıklar (net)', toplam: 5060100, hesaplar: [] },
  },
  pasif: {
    // Kısa Vadeli Yabancı Kaynaklar (toplam 1.641.350)
    kvMaliBorclar: { grup: '30 Mali Borçlar', toplam: 640000, hesaplar: [] },
    kvTicariBorclar: { grup: '32 Ticari Borçlar', toplam: 521400, hesaplar: [] },
    odenecekVergi: { grup: '36 Ödenecek Vergi ve Diğer Yükümlülükler', toplam: 479950, hesaplar: [] },
    // Uzun Vadeli Yabancı Kaynaklar (toplam 3.325.950)
    uvMaliBorclar: { grup: '40 Uzun Vadeli Mali Borçlar', toplam: 3325950, hesaplar: [] },
    // Özkaynaklar (toplam 2.792.800)
    odenmisSermaye: { grup: '50 Ödenmiş Sermaye', toplam: 2000000, hesaplar: [] },
    karYedekleri: { grup: '54 Kar Yedekleri', toplam: 180000, hesaplar: [] },
    gecmisYillarKarlari: { grup: '57 Geçmiş Yıllar Karları', toplam: 280000, hesaplar: [] },
    donemKarZarar: { grup: '59 Dönem Net Karı', toplam: 332800, hesaplar: [] },
  },
};

const styles = StyleSheet.create({
  detailBody: { gap: spacing.lg, paddingBottom: spacing.xxl + 40 },
  denkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
