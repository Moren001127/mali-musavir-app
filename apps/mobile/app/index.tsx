import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function IndexScreen() {
  const { status, audience } = useAuth();

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }

    router.replace(audience === 'advisor' ? '/(advisor)' : '/(taxpayer)');
  }, [audience, status]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});

