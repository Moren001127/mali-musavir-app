import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Mic, Send } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { colors, fonts, radius, withAlpha } from '../../lib/theme';

export default function OfisAI() {
  return (
    <Screen scroll={false}>
      <View style={styles.head}>
        <Text style={styles.title}>MOREN AI</Text>
        <Text style={styles.sub}>Ofis asistanı · çevrimiçi</Text>
      </View>

      <ScrollView style={styles.chat} contentContainerStyle={{ gap: 12, paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.msg, styles.ai]}>
          <Text style={styles.k}>MOREN AI</Text>
          <Text style={styles.msgText}>Merhaba Muzaffer. Bugün 3 mükellefte dikkat çeken durum var. Nereden başlayalım?</Text>
        </View>
        <View style={[styles.msg, styles.me]}>
          <Text style={styles.meText}>Temmuz KDV'de riskli olanları listele</Text>
        </View>
        <View style={[styles.msg, styles.ai]}>
          <Text style={styles.k}>MOREN AI</Text>
          <Text style={styles.msgText}>
            Devreden KDV'si sapan 4 mükellef:{'\n'}• Leyla Bozkurt — %41 sapma{'\n'}• Doğan Tic. — eksik alış{'\n'}• Ayşegül A.Ş. — tevkifat oranı{'\n'}• Ercan — devreden farkı
          </Text>
        </View>
        <View style={styles.chips}>
          <Pressable style={styles.chip} onPress={() => router.push('/(advisor)/m/kdv-panosu')}>
            <Text style={styles.chipText}>KDV Panosu'nu aç</Text>
          </Pressable>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Rapor hazırla</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Sesli anlat</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.ask}>
        <Mic size={18} color={colors.gold} />
        <TextInput placeholder="Yaz ya da söyle…" placeholderTextColor={colors.textSoft} style={styles.input} />
        <View style={styles.send}>
          <Send size={16} color="#141109" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: 4 },
  title: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontSize: 11.5, color: colors.textSoft, marginTop: 2 },
  chat: { flex: 1 },
  msg: { maxWidth: '86%', padding: 12, borderRadius: 18 },
  ai: { alignSelf: 'flex-start', backgroundColor: withAlpha(colors.white, 0.05), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), borderBottomLeftRadius: 6 },
  me: { alignSelf: 'flex-end', backgroundColor: colors.gold, borderBottomRightRadius: 6 },
  k: { fontSize: 10.5, letterSpacing: 1, color: colors.goldMuted, fontWeight: '600', marginBottom: 6 },
  msgText: { fontSize: 13.5, color: colors.text, lineHeight: 20 },
  meText: { fontSize: 13.5, color: '#141109', fontWeight: '500', lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: withAlpha(colors.white, 0.05), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  chipText: { fontSize: 12, color: colors.textMuted },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: withAlpha(colors.white, 0.08), borderRadius: 14, padding: 11, marginTop: 8 },
  input: { flex: 1, color: colors.text, fontSize: 13 },
  send: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold },
});
