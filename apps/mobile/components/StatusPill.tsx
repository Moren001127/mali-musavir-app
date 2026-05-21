import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../lib/theme';

type Tone = 'green' | 'amber' | 'rose' | 'blue' | 'gold';

const toneColor: Record<Tone, string> = {
  green: colors.green,
  amber: colors.amber,
  rose: colors.rose,
  blue: colors.blue,
  gold: colors.gold,
};

export function StatusPill({ label, tone = 'gold' }: { label: string; tone?: Tone }) {
  const color = toneColor[tone];

  return (
    <View style={[styles.wrap, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
});

