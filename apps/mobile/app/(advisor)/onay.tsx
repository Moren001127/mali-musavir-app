import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Check, Sliders, Cpu, FileText } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { Card, IconBox, Badge } from '../../components/ui';
import { colors, fonts, radius, withAlpha } from '../../lib/theme';

export default function OnayScreen() {
  return (
    <Screen>
      <View style={styles.head}>
        <View>
          <Text style={styles.eyebrow}>BEKLEYEN İŞLEMLER</Text>
          <Text style={styles.title}>Onay Kuyruğu</Text>
        </View>
        <Badge tone="amber">3 bekliyor</Badge>
      </View>

      <Card>
        <View style={styles.row}>
          <IconBox icon={FileText} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rTitle}>Fatura eşleştirme</Text>
            <Text style={styles.rSub}>MERT REKLAM → 770 · AI %92</Text>
          </View>
        </View>
        <View style={styles.prog}>
          <View style={[styles.progFill, { width: '92%' }]} />
        </View>
        <Text style={styles.note}>Mihsap içerikten sınıflandırdı. Onaylıyor musun?</Text>
        <View style={styles.actions}>
          <Pressable style={[styles.act, styles.approve]}>
            <Check size={18} color={colors.green} />
            <Text style={[styles.actText, { color: colors.text }]}>Onayla</Text>
          </Pressable>
          <Pressable style={styles.act}>
            <Sliders size={18} color={colors.rose} />
            <Text style={[styles.actText, { color: colors.text }]}>Düzelt</Text>
          </Pressable>
        </View>
      </Card>

      <Card>
        <Pressable style={styles.row} onPress={() => router.push('/(advisor)/m/mihsap')}>
          <IconBox icon={Cpu} color={colors.copper} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rTitle}>Tevkifat oranı teyidi</Text>
            <Text style={styles.rSub}>191.03 · Ayşegül</Text>
          </View>
          <Badge tone="amber">İncele</Badge>
        </Pressable>
      </Card>

      <Card>
        <Pressable style={styles.row} onPress={() => router.push('/(advisor)/m/luca')}>
          <IconBox icon={Cpu} color={colors.blue} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rTitle}>Luca: mizan kilitle</Text>
            <Text style={styles.rSub}>Geri alınamaz işlem</Text>
          </View>
          <Badge tone="sky">Onay</Badge>
        </Pressable>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 11, letterSpacing: 2, color: colors.goldMuted, fontWeight: '600' },
  title: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '600', color: colors.text, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  rTitle: { fontSize: 14.5, fontWeight: '600', color: colors.text },
  rSub: { fontSize: 12, color: colors.textSoft, marginTop: 2 },
  prog: { height: 7, borderRadius: 999, backgroundColor: withAlpha(colors.white, 0.07), overflow: 'hidden', marginTop: 12 },
  progFill: { height: '100%', borderRadius: 999, backgroundColor: colors.gold },
  note: { fontSize: 12, color: colors.textMuted, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  act: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.white, 0.08) },
  approve: { borderColor: withAlpha(colors.green, 0.35) },
  actText: { fontSize: 13, fontWeight: '600' },
});
