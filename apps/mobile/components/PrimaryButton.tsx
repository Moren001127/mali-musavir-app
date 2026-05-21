import React, { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '../lib/theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function PrimaryButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const content = (
    <>
      {loading ? <ActivityIndicator color={variant === 'primary' ? colors.black : colors.gold} /> : icon}
      <Text style={[styles.label, variant !== 'primary' && styles.labelSecondary]}>{label}</Text>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [styles.shell, isDisabled && styles.disabled, pressed && !isDisabled && styles.pressed, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={[colors.gold, colors.goldDeep]} style={styles.fill}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.fill, styles[variant]]}>{content}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 50,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  danger: {
    backgroundColor: 'rgba(251,113,133,0.12)',
    borderColor: 'rgba(251,113,133,0.28)',
  },
  label: {
    color: colors.black,
    fontSize: 14,
    fontWeight: '800',
  },
  labelSecondary: {
    color: colors.text,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
