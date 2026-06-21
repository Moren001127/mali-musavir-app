import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, Text } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { BookCheck, ShieldCheck, CalendarClock } from 'lucide-react-native';
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
import { colors, fonts, radius, spacing, withAlpha } from '../../lib/theme';

const COLOR = 'blue' as const;

/* ============================ etiket sözlükleri (web ile bire bir) ============================ */

const MONTH_LABELS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function donemTipiLabel(t?: string | null): string {
  switch (String(t || '')) {
    case 'AYLIK':
      return 'Aylık';
    case 'GECICI_Q1':
      return '1. Geçici Dönem';
    case 'GECICI_Q2':
      return '2. Geçici Dönem';
    case 'GECICI_Q3':
      return '3. Geçici Dönem';
    case 'GECICI_Q4':
      return '4. Geçici Dönem';
    case 'YILLIK':
      return 'Yıllık';
    default:
      return t || '';
  }
}

/** "2026-03" + AYLIK -> "Mart 2026"; geçici/yıllık tipini ekler */
function formatDonem(donem?: string | null, donemTipi?: string | null): string {
  const d = String(donem || '').trim();
  const m = d.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const ay = MONTH_LABELS[Number(m[2]) - 1] || m[2];
    return `${ay} ${m[1]}`;
  }
  const tip = donemTipiLabel(donemTipi);
  if (tip && d) return `${d} · ${tip}`;
  return d || tip || 'Dönem';
}

function findingLabel(code: string): string {
  const dict: Record<string, string> = {
    HESAP_KODU_EKSIK: 'Hesap kodu eksik',
    DONEM_DISI_TARIH: 'Dönem dışı tarih',
    SATIRDA_BORC_ALACAK_BIRLIKTE: 'Aynı satırda borç+alacak',
    SIFIR_TUTARLI_SATIR: 'Sıfır tutarlı satır',
    '191_TERS_CALISMA': '191 ters çalışıyor',
    '391_TERS_CALISMA': '391 ters çalışıyor',
    FIS_DENGESIZ: 'Fiş dengesiz',
    FIS_TARIHI_EKSIK: 'Fiş tarihi eksik',
    FIS_TARIHI_PARSE_HATASI: 'Fiş tarihi parse hatası',
    BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'Belge tarihi > fiş tarihi',
    BELGE_TARIHI_DONEM_DISI: 'Belge tarihi dönem dışı',
    BOS_FIS: 'Boş fiş',
    TEK_SATIRLI_FIS: 'Tek satırlı fiş',
    VKN_FORMAT_HATALI: 'VKN/TCKN format hatalı',
    VKN_ALGORITMA_HATALI: 'VKN/TCKN algoritması tutmuyor',
    GERCEK_MUKERRER_FATURA: 'Mükerrer fatura (VKN+No+Tutar)',
    AYNI_GUN_AYNI_TUTAR_AYNI_TARAF: 'Aynı gün/tutar/taraf mükerrer',
    DEFTER_GENELI_DENGESIZ: 'Defter geneli dengesiz',
    CARI_TERS_BAKIYE_120: '120 ters bakiye (alacaklı)',
    CARI_TERS_BAKIYE_320: '320 ters bakiye (borçlu)',
    HAVADA_KDV_KAYDI: 'Havada KDV kaydı',
    YUKSEK_TUTAR_ACIKLAMA_EKSIK: 'Yüksek tutar açıklama eksik',
    ORTAK_ALACAK_FAIZ_RISKI: '131 ortak alacağı faiz riski',
    KDV_TAHAKKUK_EKSIK: 'KDV tahakkuk eksik',
    KDV_ODENECEK_360_UYUMSUZ: "Ödenecek KDV 360'a aktarılmamış",
    KDV_DEVREDEN_190_UYUMSUZ: "Devreden KDV 190'a aktarılmamış",
    DONEM_SONU_191_BAKIYE: '191 dönem sonu bakiye var',
    DONEM_SONU_391_BAKIYE: '391 dönem sonu bakiye var',
    BORDRO_TAHAKKUK_EKSIK: 'Bordro tahakkuk eksik (aylık)',
    KIRA_STOPAJI_EKSIK: 'Kira stopajı kesilmemiş',
    KIRA_STOPAJI_ORAN: 'Kira stopaj oranı sapma',
    SMM_STOPAJI_KONTROL: 'Serbest meslek stopaj eksik',
    DAMGA_VERGISI_KONTROL: 'Damga vergisi eksik',
    ACILIS_FISI_YOK: 'Açılış fişi yok',
    ACILIS_FISINDE_GELIR_GIDER: 'Açılış fişinde gelir/gider hesabı',
    YILLIK_KAPANIS_690_EKSIK: 'Yıllık kapanış 690 eksik',
    AVANS_KAPANMAMIS_159: '159 Verilen avans açık',
    AVANS_KAPANMAMIS_340: '340 Alınan avans açık',
    CEK_SENET_BAKIYE_121: '121 Alınan çek bakiyesi',
    CEK_SENET_BAKIYE_122: '122 Alınan senet bakiyesi',
    CEK_SENET_BAKIYE_322: '322 Verilen çek bakiyesi',
    CEK_SENET_BAKIYE_323: '323 Verilen senet bakiyesi',
    BANKA_EKSI_BAKIYE_102: '102 Banka eksi bakiye (kredi?)',
    POS_VALOR_108_BAKIYE: '108 POS valör bakiyesi',
    KKEG_689_KONTROL: '689 KKEG kontrolü',
    YILSONU_AMORTISMAN_EKSIK: 'Yıl sonu amortisman eksik',
    VERGI_KARSILIGI_370_YOK: '370 Vergi karşılığı yok',
    BENFORD_SAPMA: 'Benford yasası sapması',
    YUVARLAK_TUTAR_YIGILMASI: 'Yuvarlak tutar yığılması',
    HAFTA_SONU_KAYDI: 'Hafta sonu kaydı',
    SUPHELI_ACIKLAMA: 'Şüpheli açıklama',
    KASA_30000_TEVSIK_RISKI: 'Kasa 30.000 tevsik riski',
    ORTAK_CARI_KASA_KULLANIMI: 'Ortak cari kasa kullanımı',
  };
  return dict[code] || code.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

// Bulgu kategorisi → grup (web categoryGroup ile uyumlu, sade)
function categoryGroup(code: string): { id: string; label: string; order: number; icon: string } {
  if (code === 'DEFTER_GENELI_DENGESIZ') return { id: 'temel', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code.startsWith('VKN_')) return { id: 'vkn', label: 'VKN / TCKN Doğrulama', order: 1, icon: '🆔' };
  if (code === 'GERCEK_MUKERRER_FATURA' || code === 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF')
    return { id: 'mukerrer', label: 'Mükerrer Kayıt Kontrolü', order: 2, icon: '⚠️' };
  if (code === 'HAVADA_KDV_KAYDI' || code.startsWith('KDV_') || code === 'DONEM_SONU_191_BAKIYE' || code === 'DONEM_SONU_391_BAKIYE' || code === '191_TERS_CALISMA' || code === '391_TERS_CALISMA')
    return { id: 'kdv', label: 'KDV Kontrolleri', order: 3, icon: '🧾' };
  if (code.startsWith('CARI_TERS_BAKIYE')) return { id: 'cari', label: 'Cari Hesap Tutarlılığı', order: 4, icon: '👥' };
  if (code === 'ORTAK_ALACAK_FAIZ_RISKI' || code === 'ORTAK_CARI_KASA_KULLANIMI')
    return { id: 'ortak', label: 'Ortak Alacakları / KKEG', order: 5, icon: '⚖️' };
  if (code.startsWith('KASA_')) return { id: 'tevsik', label: 'Tevsik / Kasa', order: 6, icon: '💰' };
  if (code === 'FIS_DENGESIZ' || code === 'BOS_FIS' || code === 'TEK_SATIRLI_FIS' || code === 'SATIRDA_BORC_ALACAK_BIRLIKTE' || code === 'SIFIR_TUTARLI_SATIR')
    return { id: 'yevmiye', label: 'Yevmiye / Fiş Bütünlüğü', order: 7, icon: '📋' };
  if (code.includes('BELGE')) return { id: 'belge', label: 'Belge / Evrak', order: 8, icon: '📄' };
  if (code === 'HESAP_KODU_EKSIK' || code === 'FIS_TARIHI_EKSIK' || code === 'FIS_TARIHI_PARSE_HATASI' || code === 'DONEM_DISI_TARIH')
    return { id: 'tem2', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code === 'YUKSEK_TUTAR_ACIKLAMA_EKSIK') return { id: 'aciklama', label: 'Açıklama / Kalite', order: 10, icon: '📝' };
  if (code === 'BORDRO_TAHAKKUK_EKSIK') return { id: 'bordro', label: 'Bordro / SGK', order: 5, icon: '👷' };
  if (code.startsWith('KIRA_STOPAJI') || code === 'SMM_STOPAJI_KONTROL' || code === 'DAMGA_VERGISI_KONTROL')
    return { id: 'stopaj', label: 'Stopaj / Vergi Kesintisi', order: 6, icon: '💸' };
  if (code === 'ACILIS_FISI_YOK' || code === 'ACILIS_FISINDE_GELIR_GIDER' || code === 'YILLIK_KAPANIS_690_EKSIK' || code === 'VERGI_KARSILIGI_370_YOK' || code === 'YILSONU_AMORTISMAN_EKSIK')
    return { id: 'donem-baslangic', label: 'Açılış / Kapanış / Yıl Sonu', order: 7, icon: '📅' };
  if (code.startsWith('AVANS_KAPANMAMIS')) return { id: 'avans', label: 'Avans Hesapları', order: 8, icon: '💳' };
  if (code.startsWith('CEK_SENET_BAKIYE')) return { id: 'cek-senet', label: 'Çek / Senet', order: 9, icon: '📜' };
  if (code === 'BANKA_EKSI_BAKIYE_102' || code === 'POS_VALOR_108_BAKIYE') return { id: 'banka', label: 'Banka / POS', order: 10, icon: '🏦' };
  if (code === 'KKEG_689_KONTROL') return { id: 'kkeg', label: 'KKEG / KVK', order: 11, icon: '⚖️' };
  if (code === 'BENFORD_SAPMA' || code === 'YUVARLAK_TUTAR_YIGILMASI' || code === 'HAFTA_SONU_KAYDI' || code === 'SUPHELI_ACIKLAMA')
    return { id: 'forensic', label: 'Forensic / Anomali', order: 12, icon: '🔬' };
  return { id: 'diger', label: 'Diğer', order: 99, icon: '•' };
}

// Bulgu kategorisi → mevzuat dayanağı (müşteri raporu güveni)
const MEVZUAT_REF: Record<string, string> = {
  KASA_30000_TEVSIK_RISKI: 'VUK 459',
  FIS_DENGESIZ: 'VUK 219',
  DEFTER_GENELI_DENGESIZ: 'VUK 219',
  DONEM_DISI_TARIH: 'VUK 219',
  BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'VUK 219',
  BELGE_TARIHI_DONEM_DISI: 'VUK 219',
  HAVADA_KDV_KAYDI: 'KDVK 29',
  KDV_TAHAKKUK_EKSIK: 'KDVK 41',
  KDV_ODENECEK_360_UYUMSUZ: 'KDVK 41',
  KDV_DEVREDEN_190_UYUMSUZ: 'KDVK 29',
  DONEM_SONU_191_BAKIYE: 'KDVK 29',
  DONEM_SONU_391_BAKIYE: 'KDVK 41',
  '191_TERS_CALISMA': 'KDVK 29',
  '391_TERS_CALISMA': 'KDVK 41',
  KIRA_STOPAJI_EKSIK: 'GVK 94',
  KIRA_STOPAJI_ORAN: 'GVK 94',
  SMM_STOPAJI_KONTROL: 'GVK 94',
  DAMGA_VERGISI_KONTROL: 'Damga V.K.',
  VKN_FORMAT_HATALI: 'VUK 230',
  VKN_ALGORITMA_HATALI: 'VUK 230',
  GERCEK_MUKERRER_FATURA: 'KDVK 29',
  AYNI_GUN_AYNI_TUTAR_AYNI_TARAF: 'BDS 240',
  ORTAK_ALACAK_FAIZ_RISKI: 'KVK 13',
  KKEG_689_KONTROL: 'KVK 11',
  BANKA_EKSI_BAKIYE_102: 'TDHP',
  YILSONU_AMORTISMAN_EKSIK: 'VUK 313/333',
  ACILIS_FISINDE_GELIR_GIDER: 'TDHP',
  YILLIK_KAPANIS_690_EKSIK: 'TDHP',
  VERGI_KARSILIGI_370_YOK: 'KVK 32',
  BENFORD_SAPMA: 'Benford · VEDAS',
  YUVARLAK_TUTAR_YIGILMASI: 'Forensic',
  HAFTA_SONU_KAYDI: 'BDS 240',
  SUPHELI_ACIKLAMA: 'BDS 240',
};

/* ============================ durum yardımcıları ============================ */

function statusLabel(s?: string): string {
  const v = String(s || '').toUpperCase();
  if (v === 'READY' || v === 'DONE' || v === 'OK') return 'temiz';
  if (v === 'REVIEWING') return 'incelemede';
  if (v === 'PENDING' || v === 'QUEUED') return 'bekliyor';
  if (v === 'RUNNING' || v === 'PROCESSING') return 'işleniyor';
  if (v === 'FAILED' || v === 'ERROR') return 'hata';
  return s || '-';
}
function statusColor(s?: string): 'green' | 'amber' | 'blue' | 'rose' {
  const v = String(s || '').toUpperCase();
  if (v === 'READY' || v === 'DONE' || v === 'OK') return 'green';
  if (v === 'REVIEWING') return 'amber';
  if (v === 'FAILED' || v === 'ERROR') return 'rose';
  return 'blue';
}

function severityColor(sev?: string): 'rose' | 'amber' | 'blue' {
  const v = String(sev || '').toUpperCase();
  if (v === 'ERROR') return 'rose';
  if (v === 'WARN') return 'amber';
  return 'blue';
}
function severityLabel(sev?: string): string {
  const v = String(sev || '').toUpperCase();
  if (v === 'ERROR') return 'Hata';
  if (v === 'WARN') return 'Uyarı';
  return 'Bilgi';
}

function taxpayerName(t?: any): string {
  if (!t) return '';
  if (t.companyName) return t.companyName;
  const ad = [t.firstName, t.lastName].filter(Boolean).join(' ').trim();
  return ad || t.unvan || t.taxNumber || '';
}

/* ============================ ekran: liste ============================ */

export default function EDefterScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['edefter-list'],
    enabled,
    queryFn: () => api.get('/edefter-control').then((r) => r.data as any[]),
  });

  const detail = useQuery({
    queryKey: ['edefter-detail', selectedId],
    enabled: enabled && !!selectedId,
    queryFn: () => api.get(`/edefter-control/${selectedId}`).then((r) => r.data as any),
  });

  const records: any[] = enabled ? list.data ?? [] : DEMO_LIST;

  if (selectedId) {
    const activeDetail = enabled
      ? detail.data
      : DEMO_DETAILS[selectedId] || DEMO_DETAILS[DEMO_LIST[0].id];
    return (
      <EDefterDetail
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
        eyebrow="‹ Mali Veriler · e-Defter"
        title="e-Defter Denetimi"
        subtitle="Dönem bazlı defter ön kontrolü ve berat durumu"
        color={COLOR}
        onBack={() => router.back()}
      />

      {enabled && list.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : records.length === 0 ? (
        <EmptyState
          title="Henüz e-Defter kontrolü yok"
          subtitle="Luca'dan Detay Fiş Listesi çekildiğinde dönemler burada listelenir."
          icon={<BookCheck size={24} color={colors.blue} strokeWidth={2} />}
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Dönemler · Berat Durumu" />
          {records.map((s) => {
            const fc = Number(s?.findingCount ?? s?._count?.findings ?? 0);
            const unvan = taxpayerName(s?.taxpayer) || formatDonem(s?.donem, s?.donemTipi);
            return (
              <ListRow
                key={String(s.id)}
                color={COLOR}
                icon={<BookCheck size={17} color={colors.blue} strokeWidth={2} />}
                title={unvan}
                subtitle={`${formatDonem(s?.donem, s?.donemTipi)} · ${s?.totalVouchers ?? '—'} fiş${
                  fc ? ` · ${fc} bulgu` : ' · temiz'
                }`}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <MiniPill label={beratLabel(s?.beratDurumu, s?.status)} color={beratColor(s?.beratDurumu, s?.status)} />
                    {fc ? <MiniPill label={`${fc} bulgu`} color={statusColor(s?.status)} /> : null}
                  </View>
                }
                onPress={() => setSelectedId(String(s.id))}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

// Berat (GİB'e yükleme) durumu — beratDurumu alanı varsa onu, yoksa kontrol durumunu göster
function beratLabel(berat?: string, status?: string): string {
  const v = String(berat || '').toUpperCase();
  if (v === 'YUKLENDI' || v === 'ONAYLI') return 'yüklendi';
  if (v === 'EKSIK' || v === 'BEKLIYOR') return 'eksik';
  if (v === 'HATALI') return 'hatalı';
  return statusLabel(status);
}
function beratColor(berat?: string, status?: string): 'green' | 'amber' | 'rose' | 'blue' {
  const v = String(berat || '').toUpperCase();
  if (v === 'YUKLENDI' || v === 'ONAYLI') return 'green';
  if (v === 'EKSIK' || v === 'BEKLIYOR') return 'amber';
  if (v === 'HATALI') return 'rose';
  return statusColor(status);
}

/* ============================ ekran: detay ============================ */

function EDefterDetail({
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
  const findings: any[] = useMemo(() => (data?.findings ?? []) as any[], [data]);

  const stats = useMemo(() => {
    let error = 0;
    let warn = 0;
    let info = 0;
    let open = 0;
    for (const f of findings) {
      const sev = String(f?.severity || '').toUpperCase();
      if (sev === 'ERROR') error++;
      else if (sev === 'WARN') warn++;
      else info++;
      if ((f?.status || 'OPEN') === 'OPEN') open++;
    }
    return { error, warn, info, open, total: findings.length };
  }, [findings]);

  // Denetim skoru (0-100): açık hata/uyarı ağırlığından türetilir (web ile aynı mantık, sade)
  const score = useMemo(() => {
    const ceza = stats.error * 12 + stats.warn * 4 + stats.info * 1;
    return Math.max(0, Math.min(100, 100 - ceza));
  }, [stats]);

  // Bulguları gruba göre topla
  const groups = useMemo(() => {
    const map: Record<string, { label: string; icon: string; order: number; items: any[] }> = {};
    for (const f of findings) {
      const g = categoryGroup(String(f?.category || ''));
      if (!map[g.id]) map[g.id] = { label: g.label, icon: g.icon, order: g.order, items: [] };
      map[g.id].items.push(f);
    }
    return Object.values(map).sort((a, b) => a.order - b.order);
  }, [findings]);

  if (loading) {
    return (
      <Screen>
        <ColorStrip color={COLOR} color2="steel" />
        <ModuleHeader eyebrow="‹ e-Defter" title="Yükleniyor" color={COLOR} onBack={onBack} />
        <LoadingBlock color={COLOR} />
      </Screen>
    );
  }
  if (error || !data) {
    return (
      <Screen>
        <ColorStrip color={COLOR} color2="steel" />
        <ModuleHeader eyebrow="‹ e-Defter" title="Detay" color={COLOR} onBack={onBack} />
        <ErrorState onRetry={onRetry} />
      </Screen>
    );
  }

  const unvan = taxpayerName(data?.taxpayer) || 'Mükellef';
  const donemMetni = formatDonem(data?.donem, data?.donemTipi);
  const dengeli = stats.error === 0;

  return (
    <Screen scroll={false}>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ e-Defter"
        title={donemMetni}
        subtitle={unvan}
        color={COLOR}
        onBack={onBack}
        right={
          <MiniPill
            label={dengeli ? '✓ kontrolden geçti' : `${stats.error} hata`}
            color={dengeli ? 'green' : 'rose'}
          />
        }
      />

      <ScrollView contentContainerStyle={styles.detailBody} showsVerticalScrollIndicator={false}>
        {/* Denetim skoru */}
        <AmountCard
          label="Denetim Skoru"
          value={`${score} / 100`}
          meta={
            stats.error > 0
              ? `${stats.error} hata düzeltilmeden berat oluşturmayın.`
              : stats.warn > 0
              ? `${stats.warn} uyarı incelenmeli.`
              : 'Defter ön kontrolden temiz geçti.'
          }
          color={dengeli ? (stats.warn ? 'amber' : 'green') : 'rose'}
        />

        {/* Özet rakamlar */}
        <View style={styles.statRow}>
          <StatBox label="Satır" value={String(data?.totalLines ?? '—')} color="steel" />
          <StatBox label="Fiş" value={String(data?.totalVouchers ?? '—')} color="blue" />
          <StatBox label="Açık Bulgu" value={String(stats.open)} color={stats.open ? 'amber' : 'green'} />
        </View>

        {/* Şiddet dağılımı */}
        <SectionLabel label="Şiddet Dağılımı" />
        <View style={styles.statRow}>
          <StatBox label="Hata" value={String(stats.error)} color={stats.error ? 'rose' : 'steel'} />
          <StatBox label="Uyarı" value={String(stats.warn)} color={stats.warn ? 'amber' : 'steel'} />
          <StatBox label="Bilgi" value={String(stats.info)} color="blue" />
        </View>

        {/* Tahakkuk tarihi düzeltme bilgisi (proje notu: e-Defter tahakkukta ay sonu) */}
        <GradientCard color="amber">
          <View style={styles.noteHead}>
            <CalendarClock size={15} color={colors.amber} strokeWidth={2.2} />
            <Text style={[styles.noteTitle, { color: colors.amber }]}>Tahakkuk Tarihi Düzeltmesi</Text>
          </View>
          <Text style={styles.noteBody}>
            Luca Detay Fiş Listesi'nde KDV tahakkuk fişleri için EVRAK tarihi (örn. 31.03) gelir, FİŞ tarihi
            (örn. 28.02) değil. Sistem her iki tarihi de dönemin ay sonuna çeker; ay sonu tahakkuku yoksa
            "KDV tahakkuk eksik" bulgusu üretir.
          </Text>
          {data?.donemBaslangic || data?.donemBitis ? (
            <Text style={styles.noteMeta}>
              Dönem aralığı: {fmtDate(data?.donemBaslangic)} — {fmtDate(data?.donemBitis)}
            </Text>
          ) : null}
        </GradientCard>

        {/* Mükellef bazlı durum */}
        <GradientCard color={COLOR}>
          <View style={styles.noteHead}>
            <ShieldCheck size={15} color={colors.blue} strokeWidth={2.2} />
            <Text style={[styles.noteTitle, { color: colors.blue }]}>Mükellef Durumu</Text>
          </View>
          <KV k="Mükellef" v={unvan} />
          <KV k="VKN/TCKN" v={data?.taxpayer?.taxNumber || '—'} />
          <KV k="Dönem" v={donemMetni} />
          <KV k="Kaynak" v={data?.kaynak === 'LUCA' ? 'Luca · Detay Fiş Listesi' : data?.kaynak || '—'} />
          <KV k="Berat" v={beratLabel(data?.beratDurumu, data?.status)} />
        </GradientCard>

        {/* Denetim bulguları kartları (gruplu) */}
        <SectionLabel label={`Denetim Bulguları · ${stats.total}`} />
        {groups.length === 0 ? (
          <GradientCard color="green">
            <Text style={styles.cleanTitle}>Bu dönem temiz geçti</Text>
            <Text style={styles.noteBody}>e-Defter ön kontrol bulgu üretmedi. Berat oluşturulabilir.</Text>
          </GradientCard>
        ) : (
          groups.map((g) => (
            <View key={g.label} style={{ gap: spacing.xs }}>
              <Text style={styles.groupHead}>
                {g.icon} {g.label} · {g.items.length}
              </Text>
              {g.items.map((f, i) => (
                <FindingCard key={`${f?.id || f?.category}-${i}`} f={f} />
              ))}
            </View>
          ))
        )}

        <GradientCard color={COLOR}>
          <SectionLabel label="📥 Bulgu raporu (Excel) · 🔒 Beratı kilitle" />
        </GradientCard>
      </ScrollView>
    </Screen>
  );
}

/* ============================ alt bileşenler ============================ */

function FindingCard({ f }: { f: any }) {
  const sevColor = severityColor(f?.severity);
  const ref = MEVZUAT_REF[String(f?.category || '')];
  const yer =
    f?.voucherKey || (f?.rowIndex != null ? `Satır ${f.rowIndex}` : null) || (f?.hesapKodu ? `Hesap ${f.hesapKodu}` : null);
  return (
    <View style={styles.finding}>
      <View style={styles.findingTop}>
        <MiniPill label={severityLabel(f?.severity)} color={sevColor} />
        <Text style={styles.findingCat} numberOfLines={1}>
          {findingLabel(String(f?.category || ''))}
        </Text>
        {ref ? <MiniPill label={ref} color="steel" /> : null}
      </View>
      <Text style={styles.findingMsg}>{f?.message || '—'}</Text>
      {yer ? <Text style={styles.findingWhere}>📍 {yer}</Text> : null}
    </View>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: any }) {
  const accent =
    color === 'rose' ? colors.rose : color === 'amber' ? colors.amber : color === 'green' ? colors.green : color === 'steel' ? colors.steel : colors.blue;
  return (
    <View style={[styles.statBox, { borderColor: withAlpha(accent, 0.28) }]}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvK}>{k}</Text>
      <Text style={styles.kvV} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
}

/* ============================ zengin demo verisi ============================ */

const DEMO_LIST = [
  {
    id: 'demo-mart',
    donem: '2026-03',
    donemTipi: 'AYLIK',
    status: 'REVIEWING',
    beratDurumu: 'YUKLENDI',
    totalLines: 1842,
    totalVouchers: 312,
    findingCount: 5,
    taxpayer: { companyName: 'ÖZ ELA İnşaat A.Ş.', taxNumber: '1234567890' },
    _count: { findings: 5 },
  },
  {
    id: 'demo-subat',
    donem: '2026-02',
    donemTipi: 'AYLIK',
    status: 'REVIEWING',
    beratDurumu: 'EKSIK',
    totalLines: 1654,
    totalVouchers: 289,
    findingCount: 3,
    taxpayer: { companyName: 'ÖZ ELA İnşaat A.Ş.', taxNumber: '1234567890' },
    _count: { findings: 3 },
  },
  {
    id: 'demo-ocak',
    donem: '2026-01',
    donemTipi: 'AYLIK',
    status: 'READY',
    beratDurumu: 'YUKLENDI',
    totalLines: 1490,
    totalVouchers: 264,
    findingCount: 0,
    taxpayer: { companyName: 'ÖZ ELA İnşaat A.Ş.', taxNumber: '1234567890' },
    _count: { findings: 0 },
  },
  {
    id: 'demo-q1',
    donem: '2026-Q1',
    donemTipi: 'GECICI_Q1',
    status: 'REVIEWING',
    beratDurumu: 'HATALI',
    totalLines: 740,
    totalVouchers: 128,
    findingCount: 2,
    taxpayer: { companyName: 'DİLEK BAYAGELDİ Ticaret Ltd.', taxNumber: '9876543210' },
    _count: { findings: 2 },
  },
];

const DEMO_DETAILS: Record<string, any> = {
  'demo-mart': {
    id: 'demo-mart',
    donem: '2026-03',
    donemTipi: 'AYLIK',
    status: 'REVIEWING',
    kaynak: 'LUCA',
    beratDurumu: 'YUKLENDI',
    donemBaslangic: '2026-03-01',
    donemBitis: '2026-03-31',
    totalLines: 1842,
    totalVouchers: 312,
    findingCount: 5,
    taxpayer: { companyName: 'ÖZ ELA İnşaat A.Ş.', taxNumber: '1234567890' },
    findings: [
      {
        id: 'f1',
        severity: 'ERROR',
        category: 'KDV_TAHAKKUK_EKSIK',
        message: 'Mart dönemi sonunda (31.03) KDV tahakkuk fişi bulunamadı. 191 indirilecek KDV bakiyesi 360/391 ile mahsuplaşmamış.',
        voucherKey: null,
        status: 'OPEN',
      },
      {
        id: 'f2',
        severity: 'WARN',
        category: 'KASA_30000_TEVSIK_RISKI',
        message: 'Tek günde 30.000 TL üzeri nakit kasa hareketi (45.200 TL). VUK 459 tevsik zorunluluğu riski.',
        voucherKey: 'FIS-2026-0188',
        status: 'OPEN',
      },
      {
        id: 'f3',
        severity: 'WARN',
        category: 'CARI_TERS_BAKIYE_120',
        message: '120.04 Alıcı hesabı dönem sonunda alacak bakiye veriyor (−18.450 TL). Cari mutabakat gerekli.',
        hesapKodu: '120.04',
        status: 'OPEN',
      },
      {
        id: 'f4',
        severity: 'INFO',
        category: 'YUVARLAK_TUTAR_YIGILMASI',
        message: '14 fişte yuvarlak tutar (xx.000) yığılması saptandı. Forensic gözden geçirme önerilir.',
        status: 'OPEN',
      },
      {
        id: 'f5',
        severity: 'INFO',
        category: 'HAFTA_SONU_KAYDI',
        message: '6 yevmiye kaydı hafta sonu tarihli. Bilgi amaçlıdır.',
        status: 'IGNORED',
      },
    ],
  },
  'demo-subat': {
    id: 'demo-subat',
    donem: '2026-02',
    donemTipi: 'AYLIK',
    status: 'REVIEWING',
    kaynak: 'LUCA',
    beratDurumu: 'EKSIK',
    donemBaslangic: '2026-02-01',
    donemBitis: '2026-02-28',
    totalLines: 1654,
    totalVouchers: 289,
    findingCount: 3,
    taxpayer: { companyName: 'ÖZ ELA İnşaat A.Ş.', taxNumber: '1234567890' },
    findings: [
      {
        id: 'g1',
        severity: 'ERROR',
        category: 'FIS_DENGESIZ',
        message: 'FIS-2026-0142 borç/alacak dengesiz: 12.300 TL fark. VUK 219 çift taraflı kayıt ihlali.',
        voucherKey: 'FIS-2026-0142',
        status: 'OPEN',
      },
      {
        id: 'g2',
        severity: 'WARN',
        category: 'BORDRO_TAHAKKUK_EKSIK',
        message: 'Aylık dönemde 770/335-360 bordro tahakkuk fişi görünmüyor. SGK ve stopaj eşleşmesini kontrol edin.',
        status: 'OPEN',
      },
      {
        id: 'g3',
        severity: 'WARN',
        category: 'VKN_ALGORITMA_HATALI',
        message: '3 satırda VKN algoritması tutmuyor (kontrol hanesi hatalı). VUK 230 belge bilgisi.',
        status: 'OPEN',
      },
    ],
  },
  'demo-ocak': {
    id: 'demo-ocak',
    donem: '2026-01',
    donemTipi: 'AYLIK',
    status: 'READY',
    kaynak: 'LUCA',
    beratDurumu: 'YUKLENDI',
    donemBaslangic: '2026-01-01',
    donemBitis: '2026-01-31',
    totalLines: 1490,
    totalVouchers: 264,
    findingCount: 0,
    taxpayer: { companyName: 'ÖZ ELA İnşaat A.Ş.', taxNumber: '1234567890' },
    findings: [],
  },
  'demo-q1': {
    id: 'demo-q1',
    donem: '2026-Q1',
    donemTipi: 'GECICI_Q1',
    status: 'REVIEWING',
    kaynak: 'LUCA',
    beratDurumu: 'HATALI',
    donemBaslangic: '2026-01-01',
    donemBitis: '2026-03-31',
    totalLines: 740,
    totalVouchers: 128,
    findingCount: 2,
    taxpayer: { companyName: 'DİLEK BAYAGELDİ Ticaret Ltd.', taxNumber: '9876543210' },
    findings: [
      {
        id: 'q1a',
        severity: 'ERROR',
        category: 'GERCEK_MUKERRER_FATURA',
        message: 'Aynı VKN + fatura no + tutar ile 2 ayrı kayıt (24.600 TL). Mükerrer fatura riski, KDVK 29.',
        voucherKey: 'FIS-2026-0061',
        status: 'OPEN',
      },
      {
        id: 'q1b',
        severity: 'WARN',
        category: 'ORTAK_CARI_KASA_KULLANIMI',
        message: '131 Ortaklardan alacaklar hesabı kasa ile sık kapatılıyor. KVK 13 örtülü kazanç / faiz riski.',
        hesapKodu: '131.01',
        status: 'OPEN',
      },
    ],
  },
};

/* ============================ stiller ============================ */

const styles = StyleSheet.create({
  detailBody: { gap: spacing.md, paddingBottom: spacing.xxl + 40 },

  statRow: { flexDirection: 'row', gap: spacing.sm },
  statBox: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.surface2,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 3,
  },
  statValue: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '700' },
  statLabel: { color: colors.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },

  noteHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  noteTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  noteBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  noteMeta: { color: colors.textSoft, fontSize: 11, marginTop: spacing.xs, fontWeight: '600' },

  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: spacing.md },
  kvK: { color: colors.textSoft, fontSize: 11.5, fontWeight: '600' },
  kvV: { color: colors.text, fontSize: 12.5, fontWeight: '700', flexShrink: 1, textAlign: 'right' },

  groupHead: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },

  finding: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: 6,
  },
  findingTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  findingCat: { flex: 1, color: colors.text, fontSize: 12.5, fontWeight: '800' },
  findingMsg: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  findingWhere: { color: colors.textSoft, fontSize: 10.5, fontWeight: '700' },

  cleanTitle: { color: colors.green, fontSize: 14, fontWeight: '800', marginBottom: 4 },
});
