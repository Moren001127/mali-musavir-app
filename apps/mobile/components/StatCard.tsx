import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radius, spacing } from '../lib/theme';

type Tone = 'green' | 'amber' | 'rose' | 'blue' | 'gold';

const toneColor: Record<Tone, string> = {
  green: colors.green,
  amber: colors.amber,
  rose: colors.rose,
  blue: colors.blue,
  gold: colors.gold,
};

const toneGradient: Record<Tone, [string, string]> = {
  green: ['rgba(52,211,153,0.14)', 'rgba(52,211,153,0.03)'],
  amber: ['rgba(251,191,36,0.14)', 'rgba(251,191,36,0.03)'],
  rose: ['rgba(251,113,133,0.14)', 'rgba(251,113,133,0.03)'],
  blue: ['rgba(96,165,250,0.14)', 'rgba(96,165,250,0.03)'],
  gold: ['rgba(212,184,118,0.16)', 'rgba(212,184,118,0.03)'],
};

export function StatCard({ label, value, tone, hint }: { label: string; value: string; tone: Tone; hint?: string }) {
  const accent = toneColor[tone];

  return (
    <LinearGradient colors={toneGradient[tone]} style={[styles.card, { borderColor: `${accent}33` }]}>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: accent }]}>{value}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '47%',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accent: {
    width: 28,
    height: 3,
    borderRadius: 3,
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0,
  },
  value: {
    fontFamily: fonts.heading,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 3,
  },
  hint: {
    color: colors.textSoft,
    fontSize: 10.5,
    marginTop: 2,
  },
});
