import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { ModuleTile } from '../../components/ModuleTile';
import { useAuth } from '../../lib/auth';
import { advisorModules, groupModules } from '../../lib/mobile-modules';
import { colors, spacing } from '../../lib/theme';

export default function AdvisorModulesScreen() {
  const auth = useAuth();
  const groups = groupModules(advisorModules);

  return (
    <Screen>
      <TopBar title="Portal modülleri" subtitle="Mobil MVP kapsam matrisi" audience="advisor" onLogout={auth.logout} />

      {Object.entries(groups).map(([group, modules]) => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupTitle}>{group}</Text>
          {modules.map((module) => (
            <ModuleTile key={module.id} module={module} />
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

