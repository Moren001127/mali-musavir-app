import React, { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { colors, fonts, radius, spacing } from '../lib/theme';

type IconType = LucideIcon;
type Tone = 'gold' | 'green' | 'blue' | 'amber' | 'rose' | 'purple';

const toneColor: Record<Tone, string> = {
  gold: colors.gold,
  green: colors.green,
  blue: colors.blue,
  amber: colors.amber,
  rose: colors.rose,
  purple: colors.purple,
};

const toneGradient: Record<Tone, [string, string]> = {
  gold: ['rgba(212,184,118,0.15)', 'rgba(212,184,118,0.03)'],
  green: ['rgba(52,211,153,0.13)', 'rgba(52,211,153,0.03)'],
  blue: ['rgba(96,165,250,0.13)', 'rgba(96,165,250,0.03)'],
  amber: ['rgba(251,191,36,0.13)', 'rgba(251,191,36,0.03)'],
  rose: ['rgba(251,113,133,0.13)', 'rgba(251,113,133,0.03)'],
  purple: ['rgba(167,139,250,0.13)', 'rgba(167,139,250,0.03)'],
};

export function SectionLabel({ label, right }: { label: string; right?: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
    </View>
  );
}

export function PremiumCard({ children, tone = 'gold', style }: PropsWithChildren<{ tone?: Tone; style?: ViewStyle }>) {
  const accent = toneColor[tone];

  return (
    <LinearGradient colors={toneGradient[tone]} style={[styles.card, { borderColor: `${accent}33` }, style]}>
      {children}
    </LinearGradient>
  );
}

export function QuickAction({
  label,
  Icon,
  tone = 'gold',
  active = false,
  onPress,
}: {
  label: string;
  Icon: IconType;
  tone?: Tone;
  active?: boolean;
  onPress?: () => void;
}) {
  const accent = toneColor[tone];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, active && { borderColor: `${accent}66` }, pressed && styles.pressed]}
    >
      <View style={[styles.quickIcon, { backgroundColor: `${accent}1F`, borderColor: `${accent}33` }]}>
        <Icon size={21} color={accent} strokeWidth={2.1} />
      </View>
      <Text style={[styles.quickLabel, active && { color: accent }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ActivityRow({
  title,
  meta,
  amount,
  Icon,
  tone = 'gold',
}: {
  title: string;
  meta: string;
  amount?: string;
  Icon: IconType;
  tone?: Tone;
}) {
  const accent = toneColor[tone];

  return (
    <View style={[styles.activity, { borderLeftColor: accent }]}>
      <View style={styles.activityIcon}>
        <Icon size={17} color={accent} strokeWidth={2.1} />
      </View>
      <View style={styles.activityBody}>
        <Text style={styles.activityTitle}>{title}</Text>
        <Text style={styles.activityMeta}>{meta}</Text>
      </View>
      {amount ? <Text style={[styles.activityAmount, { color: accent }]}>{amount}</Text> : null}
    </View>
  );
}

export function CompanyHero({
  label = 'Firma',
  name,
  meta,
  tone = 'gold',
}: {
  label?: string;
  name: string;
  meta: string[];
  tone?: Tone;
}) {
  const accent = toneColor[tone];

  return (
    <PremiumCard tone={tone} style={styles.companyHero}>
      <Text style={styles.companyLabel}>{label}</Text>
      <Text style={styles.companyName}>{name}</Text>
      <View style={styles.companyMetaRow}>
        {meta.map((item) => (
          <View key={item} style={[styles.companyChip, { borderColor: `${accent}33`, backgroundColor: `${accent}14` }]}>
            <Text style={[styles.companyChipText, { color: item.includes(':') ? accent : colors.textMuted }]}>{item}</Text>
          </View>
        ))}
      </View>
    </PremiumCard>
  );
}

export function ScanFrame({
  title,
  subtitle,
  count,
}: {
  title: string;
  subtitle: string;
  count?: number;
}) {
  return (
    <View style={styles.cameraView}>
      <View style={styles.cameraHint}>
        <Text style={styles.cameraHintText}>{subtitle}</Text>
      </View>
      <View style={styles.frame}>
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
        <Text style={styles.frameTitle}>{title}</Text>
        {typeof count === 'number' ? <Text style={styles.frameCount}>{count} görüntü</Text> : null}
      </View>
      <View style={styles.cameraControls}>
        <View style={styles.camButton}>
          <Text style={styles.camButtonText}>FL</Text>
        </View>
        <View style={styles.shutterOuter}>
          <LinearGradient colors={[colors.gold, colors.goldDeep]} style={styles.shutterInner} />
        </View>
        <View style={styles.camButton}>
          <Text style={styles.camButtonText}>GL</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: -spacing.sm,
  },
  sectionLabel: {
    color: colors.textSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sectionRight: {
    color: colors.goldMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.md,
    overflow: 'hidden',
  },
  quickAction: {
    flex: 1,
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  quickIcon: {
    width: 37,
    height: 37,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  quickLabel: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ translateY: 1 }],
  },
  activity: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderLeftWidth: 3,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderRightColor: 'rgba(255,255,255,0.06)',
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  activityBody: {
    flex: 1,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  activityMeta: {
    color: colors.textSoft,
    fontSize: 11,
    marginTop: 2,
  },
  activityAmount: {
    fontSize: 12,
    fontWeight: '800',
  },
  companyHero: {
    gap: spacing.sm,
  },
  companyLabel: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontWeight: '800',
  },
  companyName: {
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 26,
  },
  companyMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  companyChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  companyChipText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  cameraView: {
    minHeight: 360,
    borderRadius: radius.xl,
    backgroundColor: colors.black,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  cameraHint: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  cameraHintText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  frame: {
    width: '76%',
    aspectRatio: 0.72,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: 'rgba(212,184,118,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: colors.gold,
  },
  cornerTopLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: radius.lg,
  },
  cornerTopRight: {
    top: -2,
    right: -2,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: radius.lg,
  },
  cornerBottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: radius.lg,
  },
  cornerBottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: radius.lg,
  },
  frameTitle: {
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  frameCount: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  cameraControls: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  camButton: {
    width: 45,
    height: 45,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.11)',
  },
  camButtonText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '800',
  },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 4,
    borderColor: 'rgba(212,184,118,0.8)',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
});
