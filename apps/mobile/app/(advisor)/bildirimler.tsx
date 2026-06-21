import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import {
  ColorStrip,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingBlock,
  MiniPill,
  ModuleHeader,
  SectionLabel,
} from '../../components/ModuleKit';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing } from '../../lib/theme';

const COLOR = 'rose' as const;

/** Portal /notifications İngilizce alanlar döner; eski Türkçe alanlar da savunmacı desteklenir. */
type Notif = {
  id: string;
  title?: string;
  baslik?: string;
  body?: string;
  mesaj?: string;
  type?: string;
  tip?: string;
  isRead?: boolean;
  okundu?: boolean;
  createdAt?: string;
  tarih?: string;
};

const TYPE_LABELS: Record<string, string> = {
  AUTOMATION: 'Otomasyon',
  WHATSAPP: 'WhatsApp',
  AI: 'Moren AI',
  MOREN_AI: 'Moren AI',
  TASK_DUE: 'Görev',
  TAX_DEADLINE: 'Vergi Tarihi',
  KDV_RESULT: 'KDV Sonucu',
  DOCUMENT_UPLOADED: 'Yeni Evrak',
  PENDING_DECISION: 'Onay Bekliyor',
  E_TEBLIGAT: 'e-Tebligat',
  LUCA_SYNC_ERROR: 'Luca Hatası',
  PORTAL_CREDENTIAL_FAIL: 'Şifre Hatası',
  SYSTEM: 'Sistem',
  AGENT: 'Ajan',
};

export default function BildirimlerScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const q = useQuery({
    queryKey: ['advisor-notifications'],
    enabled,
    // Uç yoksa veya hata olursa boş dön — ekran demo/boş duruma düşer.
    queryFn: () => api.get('/notifications').then((r) => (r.data ?? []) as Notif[]).catch(() => [] as Notif[]),
  });

  const items: Notif[] = enabled ? q.data ?? [] : DEMO;
  const unread = items.filter((n) => !isRead(n)).length;

  return (
    <Screen>
      <ColorStrip color={COLOR} color2="gold" />
      <ModuleHeader
        eyebrow="‹ Bildirimler"
        title="Bildirimler"
        subtitle={unread > 0 ? `${unread} okunmamış bildirim` : 'Tüm bildirimler okundu'}
        color={COLOR}
        onBack={() => router.back()}
        right={unread > 0 ? <MiniPill label={`${unread} yeni`} color={COLOR} /> : undefined}
      />

      {enabled && q.isLoading ? (
        <LoadingBlock color={COLOR} />
      ) : enabled && q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Bildirim yok" subtitle="Yeni bildirimler burada görünür." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel label="Bildirimler" />
          {items.map((n) => {
            const read = isRead(n);
            return (
              <ListRow
                key={n.id}
                color={COLOR}
                icon={<Bell size={17} color={colors.rose} strokeWidth={2} />}
                title={n.title || n.baslik || typeLabel(n)}
                subtitle={subtitleFor(n)}
                right={
                  read ? (
                    <MiniPill label={timeLabel(n)} color="steel" />
                  ) : (
                    <MiniPill label="yeni" color={COLOR} />
                  )
                }
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function isRead(n: Notif): boolean {
  return n.isRead ?? n.okundu ?? false;
}
function typeLabel(n: Notif): string {
  const t = n.type || n.tip || '';
  return TYPE_LABELS[t] || t || 'Bildirim';
}
function timeLabel(n: Notif): string {
  const iso = n.createdAt || n.tarih;
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}
function subtitleFor(n: Notif): string {
  const msg = n.body || n.mesaj || '';
  const time = timeLabel(n);
  return [typeLabel(n), msg].filter(Boolean).join(' · ') || time || '';
}

const DEMO: Notif[] = [
  { id: '1', title: 'KDV beyannamesi hazır', body: 'ÖZ ELA İnşaat KDV1 taslağı oluşturuldu.', type: 'KDV_RESULT', isRead: false, createdAt: new Date().toISOString() },
  { id: '2', title: 'Yeni evrak yüklendi', body: 'Demir Ticaret 3 fatura ekledi.', type: 'DOCUMENT_UPLOADED', isRead: false, createdAt: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: '3', title: 'Otomasyon tamamlandı', body: 'Gece e-Arşiv indirme bitti.', type: 'AUTOMATION', isRead: true, createdAt: new Date(Date.now() - 86400000).toISOString() },
];

const styles = StyleSheet.create({});
