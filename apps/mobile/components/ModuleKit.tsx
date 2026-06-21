import React, { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Send } from 'lucide-react-native';
import { colors, fonts, ModuleColor, moduleAccents, radius, spacing, withAlpha } from '../lib/theme';

/* ============================ yardımcılar ============================ */

export function accentOf(color: ModuleColor = 'gold'): string {
  return moduleAccents[color] || colors.gold;
}

/** 18450 -> "₺18.450" (Türkçe binlik ayraç). withSign ile +/- gösterir. */
export function formatTL(value?: number | null, opts?: { withSign?: boolean; kurus?: boolean }): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  const fixed = opts?.kurus ? abs.toFixed(2) : Math.round(abs).toString();
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = decPart ? `${grouped},${decPart}` : grouped;
  const sign = n < 0 ? '−' : opts?.withSign ? '+' : '';
  return `${sign}₺${body}`;
}

/* ============================ başlık ============================ */

export function ColorStrip({ color = 'gold', color2 }: { color?: ModuleColor; color2?: ModuleColor }) {
  const a = accentOf(color);
  const b = color2 ? accentOf(color2) : withAlpha(a, 0.5);
  return <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.strip} />;
}

export function ModuleHeader({
  eyebrow,
  title,
  subtitle,
  color = 'gold',
  onBack,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  color?: ModuleColor;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const accent = accentOf(color);
  return (
    <View style={styles.header}>
      {/* radyal ışıma imzası (RN için yumuşak yuvarlak parıltı) */}
      <View style={[styles.glow, { backgroundColor: withAlpha(accent, 0.16) }]} pointerEvents="none" />
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {onBack ? (
            <Pressable accessibilityRole="button" onPress={onBack} style={styles.backBtn}>
              <ChevronLeft size={20} color={accent} strokeWidth={2.2} />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            {eyebrow ? <Text style={[styles.eyebrow, { color: accent }]}>{eyebrow}</Text> : null}
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}

/* ============================ kartlar ============================ */

export function GradientCard({
  color = 'gold',
  children,
  style,
}: PropsWithChildren<{ color?: ModuleColor; style?: ViewStyle }>) {
  const accent = accentOf(color);
  return (
    <LinearGradient
      colors={[withAlpha(accent, 0.14), withAlpha(colors.surface, 0.6)]}
      style={[styles.gcard, { borderColor: withAlpha(accent, 0.28) }, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** Büyük tutar kartı (ör. açık bakiye) */
export function AmountCard({
  label,
  value,
  meta,
  color = 'gold',
}: {
  label: string;
  value: string;
  meta?: string;
  color?: ModuleColor;
}) {
  const accent = accentOf(color);
  return (
    <GradientCard color={color}>
      <Text style={[styles.amountLabel, { color: accent }]}>{label}</Text>
      <Text style={styles.amountValue}>{value}</Text>
      {meta ? <Text style={styles.amountMeta}>{meta}</Text> : null}
    </GradientCard>
  );
}

/* ============================ liste satırı ============================ */

export function MiniPill({ label, color = 'gold' }: { label: string; color?: ModuleColor | string }) {
  const c = typeof color === 'string' && color.startsWith('#') ? color : accentOf(color as ModuleColor);
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(c, 0.15), borderColor: withAlpha(c, 0.4) }]}>
      <Text style={[styles.pillText, { color: c }]}>{label}</Text>
    </View>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  color = 'gold',
  right,
  onPress,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  color?: ModuleColor;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const accent = accentOf(color);
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }: { pressed?: boolean }) => [styles.row, pressed && styles.pressed]}
    >
      {icon ? <View style={[styles.rowIcon, { backgroundColor: withAlpha(accent, 0.16) }]}>{icon}</View> : null}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </Wrap>
  );
}

export function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

/* ============================ mizan / defter tablosu ============================ */

export function LedgerTable({ children }: PropsWithChildren) {
  return <View style={styles.ledger}>{children}</View>;
}

export function LedgerHead({ left = 'Hesap', mid = 'Borç', right = 'Alacak' }: { left?: string; mid?: string; right?: string }) {
  return (
    <View style={[styles.ledgerRow, styles.ledgerHead]}>
      <Text style={[styles.lhCell, styles.lhLeft]}>{left}</Text>
      <Text style={[styles.lhCell, styles.lhNum]}>{mid}</Text>
      <Text style={[styles.lhCell, styles.lhNum]}>{right}</Text>
    </View>
  );
}

export function LedgerGroup({ label, color = 'gold' }: { label: string; color?: ModuleColor }) {
  return (
    <View style={[styles.ledgerRow, styles.ledgerGroup]}>
      <Text style={[styles.ledgerGroupText, { color: accentOf(color) }]}>{label}</Text>
    </View>
  );
}

export function LedgerRow({
  code,
  name,
  borc,
  alacak,
  color = 'gold',
}: {
  code?: string;
  name: string;
  borc?: number | null;
  alacak?: number | null;
  color?: ModuleColor;
}) {
  return (
    <View style={styles.ledgerRow}>
      <View style={styles.lLeft}>
        <Text style={styles.lName} numberOfLines={1}>
          {name}
        </Text>
        {code ? <Text style={[styles.lCode, { color: accentOf(color) }]}>{code}</Text> : null}
      </View>
      <Text style={[styles.lNum, !borc && styles.lNumZero]}>{borc ? formatNum(borc) : '—'}</Text>
      <Text style={[styles.lNum, !alacak && styles.lNumZero]}>{alacak ? formatNum(alacak) : '—'}</Text>
    </View>
  );
}

export function LedgerTotal({
  label = 'GENEL TOPLAM',
  borc,
  alacak,
  color = 'gold',
}: {
  label?: string;
  borc?: number | null;
  alacak?: number | null;
  color?: ModuleColor;
}) {
  const accent = accentOf(color);
  return (
    <View style={[styles.ledgerRow, styles.ledgerTotal, { backgroundColor: withAlpha(accent, 0.14) }]}>
      <Text style={[styles.lName, styles.lTotalText]}>{label}</Text>
      <Text style={[styles.lNum, styles.lTotalText, { color: accent }]}>{formatNum(borc)}</Text>
      <Text style={[styles.lNum, styles.lTotalText, { color: accent }]}>{formatNum(alacak)}</Text>
    </View>
  );
}

function formatNum(value?: number | null): string {
  if (value == null) return '—';
  return Math.round(Math.abs(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* ============================ gelir tablosu / bilanço satırı ============================ */

export function StatementRow({
  label,
  value,
  variant = 'normal',
  color = 'blue',
}: {
  label: string;
  value: string;
  variant?: 'normal' | 'sub' | 'key' | 'net' | 'minus';
  color?: ModuleColor;
}) {
  const accent = accentOf(color);
  const isKey = variant === 'key';
  const isNet = variant === 'net';
  const isSub = variant === 'sub';
  const isMinus = variant === 'minus';

  return (
    <View
      style={[
        styles.stmt,
        isSub && styles.stmtSub,
        isKey && [styles.stmtKey, { backgroundColor: withAlpha(accent, 0.12), borderColor: withAlpha(accent, 0.28) }],
        isNet && [styles.stmtNet, { backgroundColor: withAlpha(accent, 0.18), borderColor: withAlpha(accent, 0.42) }],
      ]}
    >
      <Text style={[styles.stmtLabel, isSub && styles.stmtSubText, isNet && styles.stmtNetLabel]}>{label}</Text>
      <Text
        style={[
          styles.stmtValue,
          (isKey || isNet) && { color: accent },
          isNet && styles.stmtNetValue,
          isMinus && { color: colors.rose },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/* ============================ sohbet ============================ */

export function ChatBubble({
  role,
  children,
  time,
  color = 'rose',
}: PropsWithChildren<{ role: 'ai' | 'me'; time?: string; color?: ModuleColor }>) {
  const accent = accentOf(color);
  const isMe = role === 'me';
  return (
    <View
      style={[
        styles.bubble,
        isMe
          ? [styles.bubbleMe, { backgroundColor: withAlpha(accent, 0.2), borderColor: withAlpha(accent, 0.3) }]
          : styles.bubbleAi,
      ]}
    >
      <Text style={styles.bubbleText}>{children}</Text>
      {time ? <Text style={styles.bubbleTime}>{time}</Text> : null}
    </View>
  );
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  placeholder = 'Bir şey sor…',
  color = 'rose',
  sending,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  placeholder?: string;
  color?: ModuleColor;
  sending?: boolean;
}) {
  const accent = accentOf(color);
  return (
    <View style={styles.composer}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSoft}
        style={styles.composerInput}
        multiline
      />
      <Pressable
        accessibilityRole="button"
        onPress={onSend}
        disabled={sending || !value.trim()}
        style={[styles.sendBtn, { backgroundColor: accent, opacity: sending || !value.trim() ? 0.5 : 1 }]}
      >
        {sending ? <ActivityIndicator size="small" color={colors.black} /> : <Send size={18} color={colors.black} strokeWidth={2.2} />}
      </Pressable>
    </View>
  );
}

/* ============================ durum bileşenleri ============================ */

export function LoadingBlock({ label = 'Yükleniyor…', color = 'gold' }: { label?: string; color?: ModuleColor }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={accentOf(color)} />
      <Text style={styles.centerText}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  return (
    <View style={styles.center}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.centerText}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>Veri alınamadı</Text>
      <Text style={styles.centerText}>{message || 'Bağlantıyı kontrol edip tekrar deneyin.'}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>Tekrar dene</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ============================ stiller ============================ */

const styles = StyleSheet.create({
  strip: { height: 4, borderRadius: 4 },
  header: { position: 'relative', overflow: 'hidden', paddingVertical: spacing.sm },
  glow: { position: 'absolute', top: -90, right: -50, width: 220, height: 220, borderRadius: 110 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24, fontWeight: '700', marginTop: 3 },
  subtitle: { color: colors.textMuted, fontSize: 12.5, marginTop: 3 },

  gcard: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.md, overflow: 'hidden' },
  amountLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  amountValue: { color: colors.text, fontFamily: fonts.heading, fontSize: 32, fontWeight: '700', marginTop: 4 },
  amountMeta: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },

  pill: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  pillText: { fontSize: 10, fontWeight: '800' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  pressed: { opacity: 0.82, transform: [{ translateY: 1 }] },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  rowSub: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },

  sectionLabel: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  ledger: { borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  ledgerHead: { backgroundColor: colors.surface3, borderTopWidth: 0 },
  lhCell: { color: colors.textSoft, fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  lhLeft: { flex: 1 },
  lhNum: { width: 70, textAlign: 'right' },
  ledgerGroup: { backgroundColor: colors.surface3 },
  ledgerGroupText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  lLeft: { flex: 1 },
  lName: { color: colors.text, fontSize: 11.5, fontWeight: '600' },
  lCode: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  lNum: { width: 70, textAlign: 'right', color: colors.text, fontFamily: fonts.heading, fontSize: 11.5, fontWeight: '600' },
  lNumZero: { color: colors.textSoft, fontWeight: '400', fontFamily: fonts.body },
  ledgerTotal: {},
  lTotalText: { fontWeight: '800' },

  stmt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stmtSub: { backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 2, paddingLeft: spacing.xl },
  stmtKey: {},
  stmtNet: { paddingVertical: 14 },
  stmtLabel: { color: colors.text, fontSize: 12, fontWeight: '600', flex: 1 },
  stmtSubText: { color: colors.textMuted, fontSize: 11, fontWeight: '500' },
  stmtNetLabel: { fontSize: 13, fontWeight: '800' },
  stmtValue: { color: colors.text, fontFamily: fonts.heading, fontSize: 13, fontWeight: '600' },
  stmtNetValue: { fontSize: 22, fontWeight: '700' },

  bubble: { maxWidth: '84%', padding: spacing.md, borderRadius: 16 },
  bubbleAi: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderBottomLeftRadius: 5,
  },
  bubbleMe: { alignSelf: 'flex-end', borderWidth: 1, borderBottomRightRadius: 5 },
  bubbleText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  bubbleTime: { color: colors.textSoft, fontSize: 9, fontWeight: '700', marginTop: 5 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  composerInput: { flex: 1, color: colors.text, fontSize: 13.5, maxHeight: 96, paddingHorizontal: spacing.sm, paddingVertical: 8 },
  sendBtn: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  centerText: { color: colors.textMuted, fontSize: 12.5, textAlign: 'center' },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  retryBtn: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.gold, 0.15),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.35),
  },
  retryText: { color: colors.gold, fontSize: 12.5, fontWeight: '800' },
});
