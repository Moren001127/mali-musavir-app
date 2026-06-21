import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
  ColorStrip,
  EmptyState,
  ErrorState,
  GradientCard,
  LedgerGroup,
  LedgerHead,
  LedgerRow,
  LedgerTable,
  LedgerTotal,
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

const SINIF_ADI: Record<string, string> = {
  '1': '1 — Dönen Varlıklar',
  '2': '2 — Duran Varlıklar',
  '3': '3 — Kısa Vadeli Yabancı Kaynaklar',
  '4': '4 — Uzun Vadeli Yabancı Kaynaklar',
  '5': '5 — Özkaynaklar',
  '6': '6 — Gelir Tablosu Hesapları',
  '7': '7 — Maliyet Hesapları',
};

export default function MizanScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['mizan-list'],
    enabled,
    queryFn: () => api.get('/mizan').then((r) => r.data as any[]),
  });

  const detail = useQuery({
    queryKey: ['mizan-detail', selectedId],
    enabled: enabled && !!selectedId,
    queryFn: () => api.get(`/mizan/${selectedId}`).then((r) => r.data as any),
  });

  const records: any[] = enabled ? list.data ?? [] : DEMO_LIST;
  const activeDetail = enabled ? detail.data : DEMO_DETAIL;

  if (selectedId || (!enabled && false)) {
    return (
      <MizanDetail
        data={activeDetail}
        loading={enabled && detail.isLoading}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Mali Veriler · Mizan"
        title="Mizan"
        subtitle="Oluşturulan mizanlar"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : records.length === 0 ? (
        <EmptyState title="Henüz mizan yok" subtitle="Luca'dan mizan çekildiğinde burada listelenir." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Mizanlar" />
          {records.map((m) => {
            const t = m?.toplamlar || {};
            return (
              <ListRow
                key={m.id}
                color={COLOR}
                icon={<FileSpreadsheet size={17} color={colors.blue} strokeWidth={2} />}
                title={m?.taxpayer?.unvan || m?.taxpayerAd || m?.donem || 'Mizan'}
                subtitle={`${m?.donem || ''}${m?.donemTipi ? ' · ' + m.donemTipi : ''}`}
                right={<MiniPill label={statusLabel(m?.status)} color={statusColor(m?.status)} />}
                onPress={() => setSelectedId(String(m.id))}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function MizanDetail({ data, loading, onBack }: { data: any; loading?: boolean; onBack: () => void }) {
  const hesaplar: any[] = useMemo(() => (data?.hesaplar ?? []) as any[], [data]);

  // Ana hesapları (3 haneli) sınıfa göre grupla
  const groups = useMemo(() => {
    const anaHesaplar = hesaplar.filter((h) => /^\d{3}$/.test(String(h?.hesapKodu || '').trim()));
    const map: Record<string, any[]> = {};
    for (const h of anaHesaplar) {
      const sinif = String(h?.hesapKodu || '').trim().charAt(0);
      (map[sinif] = map[sinif] || []).push(h);
    }
    return map;
  }, [hesaplar]);

  const toplamlar = data?.toplamlar || {};
  const borcT = toplamlar.borcBakiye ?? toplamlar.borcToplami ?? data?.toplamBorc;
  const alacakT = toplamlar.alacakBakiye ?? toplamlar.alacakToplami ?? data?.toplamAlacak;
  const dengeli = borcT != null && alacakT != null && Math.abs(Number(borcT) - Number(alacakT)) < 1;

  return (
    <Screen scroll={false}>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Mizan"
        title={data?.donem || 'Mizan'}
        subtitle={data?.taxpayer?.unvan || data?.taxpayerAd || 'Detay'}
        color={COLOR}
        onBack={onBack}
        right={<MiniPill label={dengeli ? '✓ dengeli' : 'kontrol et'} color={dengeli ? 'green' : 'amber'} />}
      />

      {loading ? (
        <LoadingBlock color={COLOR} />
      ) : (
        <ScrollView contentContainerStyle={styles.detailBody} showsVerticalScrollIndicator={false}>
          <LedgerTable>
            <LedgerHead left="Hesap" mid="Borç Bk." right="Alacak Bk." />
            {Object.keys(groups)
              .sort()
              .map((sinif) => (
                <React.Fragment key={sinif}>
                  <LedgerGroup label={SINIF_ADI[sinif] || `${sinif} — Hesaplar`} color={COLOR} />
                  {groups[sinif].map((h, i) => (
                    <LedgerRow
                      key={`${h?.hesapKodu}-${i}`}
                      color={COLOR}
                      code={String(h?.hesapKodu || '')}
                      name={h?.hesapAdi || h?.hesapAd || '—'}
                      borc={Number(h?.borcBakiye) || 0}
                      alacak={Number(h?.alacakBakiye) || 0}
                    />
                  ))}
                </React.Fragment>
              ))}
            <LedgerTotal label="GENEL TOPLAM" borc={Number(borcT) || 0} alacak={Number(alacakT) || 0} color={COLOR} />
          </LedgerTable>

          <GradientCard color={COLOR}>
            <SectionLabel label="📥 Excel indir · 🔒 Mizanı kilitle" />
          </GradientCard>
        </ScrollView>
      )}
    </Screen>
  );
}

function statusLabel(s?: string) {
  if (s === 'LOCKED') return 'kilitli';
  if (s === 'COMPLETED') return 'tamam';
  if (s === 'ANALYZED') return 'analiz';
  return 'geçici';
}
function statusColor(s?: string): 'green' | 'amber' | 'blue' {
  if (s === 'LOCKED' || s === 'COMPLETED') return 'green';
  if (s === 'ANALYZED') return 'blue';
  return 'amber';
}

/* ---- demo verisi (oturum demo modundayken) ----
 * Tek Düzen Hesap Planına yakın örnek mizan; kendi içinde dengeli:
 *   Borç bakiye toplamı  = 10.656.000
 *   Alacak bakiye toplamı = 10.656.000
 * Gelir tablosu hesapları (6xx) dönem içi bakiyeleriyle yer alır (dönem henüz
 * kapatılmadığı için 690 sıfırdır); satış kârı 2.418.000 − 1.996.000 = 422.000
 * olup gelir tablosu demosuyla tutarlıdır.
 */
const DEMO_LIST = [
  {
    id: 'demo',
    donem: 'Mart 2026',
    donemTipi: 'Geçici',
    status: 'COMPLETED',
    taxpayerAd: 'ÖZ ELA İnşaat',
    toplamlar: { borcBakiye: 10656000, alacakBakiye: 10656000 },
  },
];

// Her hesap: borç/alacak hareket toplamları ve net bakiyeleriyle.
const DEMO_HESAPLAR = [
  // 1 — Dönen Varlıklar (borç bakiyeli)
  { hesapKodu: '100', hesapAdi: 'Kasa', borcToplami: 420000, alacakToplami: 295500, borcBakiye: 124500, alacakBakiye: 0 },
  { hesapKodu: '102', hesapAdi: 'Bankalar', borcToplami: 2850000, alacakToplami: 1962700, borcBakiye: 887300, alacakBakiye: 0 },
  { hesapKodu: '120', hesapAdi: 'Alıcılar', borcToplami: 1640000, alacakToplami: 1181100, borcBakiye: 458900, alacakBakiye: 0 },
  { hesapKodu: '128', hesapAdi: 'Şüpheli Ticari Alacaklar', borcToplami: 60000, alacakToplami: 0, borcBakiye: 60000, alacakBakiye: 0 },
  { hesapKodu: '153', hesapAdi: 'Ticari Mallar', borcToplami: 2380000, alacakToplami: 1466000, borcBakiye: 914000, alacakBakiye: 0 },
  { hesapKodu: '157', hesapAdi: 'Diğer Stoklar', borcToplami: 75000, alacakToplami: 0, borcBakiye: 75000, alacakBakiye: 0 },
  { hesapKodu: '191', hesapAdi: 'İndirilecek KDV', borcToplami: 642000, alacakToplami: 509550, borcBakiye: 132450, alacakBakiye: 0 },
  { hesapKodu: '193', hesapAdi: 'Peşin Ödenen Vergiler', borcToplami: 47850, alacakToplami: 0, borcBakiye: 47850, alacakBakiye: 0 },
  // 2 — Duran Varlıklar (borç bakiyeli; 257 birikmiş amortisman alacak)
  { hesapKodu: '252', hesapAdi: 'Binalar', borcToplami: 3200000, alacakToplami: 0, borcBakiye: 3200000, alacakBakiye: 0 },
  { hesapKodu: '253', hesapAdi: 'Tesis, Makine ve Cihazlar', borcToplami: 1480000, alacakToplami: 0, borcBakiye: 1480000, alacakBakiye: 0 },
  { hesapKodu: '254', hesapAdi: 'Taşıtlar', borcToplami: 920000, alacakToplami: 0, borcBakiye: 920000, alacakBakiye: 0 },
  { hesapKodu: '255', hesapAdi: 'Demirbaşlar', borcToplami: 360000, alacakToplami: 0, borcBakiye: 360000, alacakBakiye: 0 },
  { hesapKodu: '257', hesapAdi: 'Birikmiş Amortismanlar (-)', borcToplami: 0, alacakToplami: 899900, borcBakiye: 0, alacakBakiye: 899900 },
  // 3 — Kısa Vadeli Yabancı Kaynaklar (alacak bakiyeli)
  { hesapKodu: '300', hesapAdi: 'Banka Kredileri', borcToplami: 120000, alacakToplami: 760000, borcBakiye: 0, alacakBakiye: 640000 },
  { hesapKodu: '320', hesapAdi: 'Satıcılar', borcToplami: 980000, alacakToplami: 1501400, borcBakiye: 0, alacakBakiye: 521400 },
  { hesapKodu: '360', hesapAdi: 'Ödenecek Vergi ve Fonlar', borcToplami: 88000, alacakToplami: 324850, borcBakiye: 0, alacakBakiye: 236850 },
  { hesapKodu: '361', hesapAdi: 'Ödenecek Sosyal Güvenlik Kesintileri', borcToplami: 42000, alacakToplami: 110800, borcBakiye: 0, alacakBakiye: 68800 },
  { hesapKodu: '391', hesapAdi: 'Hesaplanan KDV', borcToplami: 509550, alacakToplami: 683850, borcBakiye: 0, alacakBakiye: 174300 },
  // 4 — Uzun Vadeli Yabancı Kaynaklar (alacak bakiyeli)
  { hesapKodu: '400', hesapAdi: 'Banka Kredileri', borcToplami: 0, alacakToplami: 2903950, borcBakiye: 0, alacakBakiye: 2903950 },
  // 5 — Özkaynaklar (alacak bakiyeli)
  { hesapKodu: '500', hesapAdi: 'Sermaye', borcToplami: 0, alacakToplami: 2000000, borcBakiye: 0, alacakBakiye: 2000000 },
  { hesapKodu: '540', hesapAdi: 'Yasal Yedekler', borcToplami: 0, alacakToplami: 180000, borcBakiye: 0, alacakBakiye: 180000 },
  { hesapKodu: '570', hesapAdi: 'Geçmiş Yıllar Karları', borcToplami: 0, alacakToplami: 280000, borcBakiye: 0, alacakBakiye: 280000 },
  { hesapKodu: '590', hesapAdi: 'Dönem Net Karı', borcToplami: 0, alacakToplami: 332800, borcBakiye: 0, alacakBakiye: 332800 },
  // 6 — Gelir Tablosu Hesapları (dönem içi bakiyeleri)
  { hesapKodu: '600', hesapAdi: 'Yurtiçi Satışlar', borcToplami: 0, alacakToplami: 2400000, borcBakiye: 0, alacakBakiye: 2400000 },
  { hesapKodu: '610', hesapAdi: 'Satıştan İadeler (-)', borcToplami: 60000, alacakToplami: 0, borcBakiye: 60000, alacakBakiye: 0 },
  { hesapKodu: '621', hesapAdi: 'Satılan Ticari Mallar Maliyeti (-)', borcToplami: 1620000, alacakToplami: 0, borcBakiye: 1620000, alacakBakiye: 0 },
  { hesapKodu: '631', hesapAdi: 'Pazarlama, Satış ve Dağıtım Giderleri (-)', borcToplami: 165000, alacakToplami: 0, borcBakiye: 165000, alacakBakiye: 0 },
  { hesapKodu: '632', hesapAdi: 'Genel Yönetim Giderleri (-)', borcToplami: 115000, alacakToplami: 0, borcBakiye: 115000, alacakBakiye: 0 },
  { hesapKodu: '642', hesapAdi: 'Faiz Gelirleri', borcToplami: 0, alacakToplami: 18000, borcBakiye: 0, alacakBakiye: 18000 },
  { hesapKodu: '660', hesapAdi: 'Kısa Vadeli Borçlanma Giderleri (-)', borcToplami: 36000, alacakToplami: 0, borcBakiye: 36000, alacakBakiye: 0 },
];

const DEMO_DETAIL = {
  donem: 'Mart 2026',
  taxpayerAd: 'ÖZ ELA İnşaat',
  toplamlar: { borcToplami: 17810400, alacakToplami: 17810400, borcBakiye: 10656000, alacakBakiye: 10656000 },
  hesaplar: DEMO_HESAPLAR,
};

const styles = StyleSheet.create({
  detailBody: { gap: spacing.md, paddingBottom: spacing.xxl + 40 },
});
