import React, { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, RefreshCw, CheckCircle2 } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
  AmountCard,
  ColorStrip,
  EmptyState,
  ErrorState,
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

const COLOR = 'sage' as const;

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

export default function FaturaMerkeziScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const period = thisPeriod();

  // Genel özet: çekilen / işlenen / bekleyen / hata sayıları
  const summary = useQuery({
    queryKey: ['fm-summary', period],
    enabled,
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/summary', { params: { period } })
        .then((r) => r.data || {}),
  });

  // Mükellef kırılımı: işlem zinciri satırları için
  const perTaxpayer = useQuery({
    queryKey: ['fm-per-taxpayer', period],
    enabled,
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } })
        .then((r) => (Array.isArray(r.data) ? r.data : [])),
  });

  const sum: any = enabled ? summary.data ?? {} : DEMO_SUMMARY;
  const rows: any[] = enabled ? perTaxpayer.data ?? [] : DEMO_ROWS;

  const loading = enabled && (summary.isLoading || perTaxpayer.isLoading);
  const isError = enabled && (summary.isError || perTaxpayer.isError);

  // Özet kart değerleri — alanlar belirsiz olabilir; savunmacı türet.
  const pending = num(sum.pending);
  const posted = num(sum.posted);
  const approved = num(sum.approved);
  const total = num(sum.total) || num(sum.documents);
  // "çekilen" = toplam belge; "işlenen" = onaylanan + aktarılan; "hata" = sorunlu/geçersiz
  const cekilen = total || pending + posted + approved + num(sum.invalid);
  const islenen = posted + approved;
  const hata = num(sum.invalid) || num(sum.issue) || num(sum.hasIssue);

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="green" />
      <ModuleHeader
        eyebrow="‹ Belgeler · Fatura Merkezi"
        title="Fatura Merkezi"
        subtitle={`Fatura işleme özeti · ${period}`}
        color={COLOR}
        onBack={() => router.back()}
      />

      {loading ? (
        <LoadingBlock color={COLOR} />
      ) : isError ? (
        <ErrorState
          onRetry={() => {
            summary.refetch();
            perTaxpayer.refetch();
          }}
        />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {/* Özet kartları */}
          <View style={{ gap: spacing.sm }}>
            <AmountCard
              label="Çekilen belge"
              value={String(cekilen)}
              meta={`${period} dönemi · entegratörden`}
              color={COLOR}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AmountCard label="İşlenen" value={String(islenen)} meta="onaylı + aktarılan" color="green" />
              </View>
              <View style={{ flex: 1 }}>
                <AmountCard label="Hata / kontrol" value={String(hata)} meta="incelenmeli" color={hata > 0 ? 'rose' : 'steel'} />
              </View>
            </View>
          </View>

          {/* İşlem zinciri durumu */}
          <GradientCard color={COLOR}>
            <SectionLabel label="İşlem Zinciri" />
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <ChainStep
                icon={<Download size={16} color={colors.sage} strokeWidth={2} />}
                title="Belgeler çekildi"
                value={cekilen}
                done={cekilen > 0}
              />
              <ChainStep
                icon={<RefreshCw size={16} color={colors.amber} strokeWidth={2} />}
                title="Muhasebeleştirme bekleyen"
                value={pending}
                pending={pending > 0}
              />
              <ChainStep
                icon={<CheckCircle2 size={16} color={colors.green} strokeWidth={2} />}
                title="Luca'ya aktarılan"
                value={posted || approved}
                done={(posted || approved) > 0}
              />
            </View>
          </GradientCard>

          {/* Mükellef satırları */}
          <View style={{ gap: spacing.sm }}>
            <SectionLabel label="Mükellef Bazında" />
            {rows.length === 0 ? (
              <EmptyState
                title="Bu dönemde işlem yok"
                subtitle="Belge çekildiğinde mükellef bazında burada listelenir."
              />
            ) : (
              rows.map((r) => {
                const pend = num(r.pendingAlis) + num(r.pendingSatis);
                const issue = num(r.hasIssue);
                const post = num(r.postedToLuca);
                const durum =
                  issue > 0
                    ? { label: 'incele', color: 'rose' as const }
                    : pend > 0
                      ? { label: 'bekliyor', color: 'amber' as const }
                      : { label: 'tamam', color: 'green' as const };
                return (
                  <ListRow
                    key={r.taxpayerId}
                    color={COLOR}
                    icon={<FileText size={17} color={colors.sage} strokeWidth={2} />}
                    title={taxpayerLabel(r.taxpayer || r)}
                    subtitle={`Bekleyen ${pend} · Luca'ya ${post}${issue ? ` · ${issue} sorunlu` : ''}`}
                    right={<MiniPill label={durum.label} color={durum.color} />}
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

function ChainStep({
  icon,
  title,
  value,
  done,
  pending,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  done?: boolean;
  pending?: boolean;
}) {
  const pill = done
    ? { label: 'tamam', color: 'green' as const }
    : pending
      ? { label: 'incele', color: 'amber' as const }
      : { label: '—', color: 'steel' as const };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: 26, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <SectionLabel label={title} />
      </View>
      <MiniPill label={`${value}`} color={COLOR} />
      <MiniPill label={pill.label} color={pill.color} />
    </View>
  );
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---- demo verisi (oturum demo modundayken) ---- */
const DEMO_SUMMARY = { total: 142, pending: 18, posted: 116, approved: 8, invalid: 0 };
const DEMO_ROWS = [
  { taxpayerId: 'd1', taxpayer: { companyName: 'ÖZ ELA İnşaat' }, pendingAlis: 4, pendingSatis: 2, postedToLuca: 38, hasIssue: 0 },
  { taxpayerId: 'd2', taxpayer: { companyName: 'EDELER Restaurant' }, pendingAlis: 0, pendingSatis: 0, postedToLuca: 51, hasIssue: 1 },
  { taxpayerId: 'd3', taxpayer: { companyName: 'Bayageldi Tekstil' }, pendingAlis: 8, pendingSatis: 2, postedToLuca: 27, hasIssue: 0 },
];
