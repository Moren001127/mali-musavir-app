import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { ModuleTile } from '../../components/ModuleTile';
import { useAuth } from '../../lib/auth';
import { getModuleNav, groupModules, taxpayerModules } from '../../lib/mobile-modules';
import { colors, spacing } from '../../lib/theme';

export default function TaxpayerModulesScreen() {
  const auth = useAuth();
  const groups = groupModules(taxpayerModules);

  return (
    <Screen>
      <TopBar title="Bölümler" subtitle="Tüm mükellef modülleri" audience="taxpayer" onLogout={auth.logout} />

      {Object.entries(groups).map(([group, modules]) => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupTitle}>{group}</Text>
          {modules.map((module) => (
            <ModuleTile
              key={module.id}
              module={module}
              onPress={() => router.push(getModuleNav(module.id).route as any)}
            />
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  groupTitle: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
});
