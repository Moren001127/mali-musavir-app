import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Bell, TrendingUp, ShieldCheck, Mail, FileText, GitBranch, Bot, Send, ChevronRight, Check } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../../components/Screen';
import { ClientBar } from '../../components/ClientBar';
import { Card, Section, Hero, Pill, Counters } from '../../components/ui';
import { colors, fonts, radius, spacing, withAlpha } from '../../lib/theme';

const BEYAN = [
  { t: 'KDV', s: 'Son gün · 26 Tem', ok: '37', bek: '0', kalan: '11', dot: colors.amber, kalanTone: 'warn' },
  { t: 'Muhtasar', s: 'Son gün · 26 Tem', ok: '12', bek: '30', kalan: '6', dot: colors.amber, kalanTone: 'warn' },
  { t: 'SGK Prim', s: 'Tamamlandı', ok: '48', bek: '0', kalan: '0', dot: colors.green, kalanTone: 'ok' },
  { t: 'Damga', s: 'Tamamlandı', ok: '48', bek: '0', kalan: '0', dot: colors.green, kalanTone: 'ok' },
  { t: 'E-Defter Berat', s: '2 hatalı', ok: '44', bek: '2', kalan: '2', dot: colors.rose, kalanTone: 'late' },
] as const;

const STAGES = [
  { t: 'Evrak', n: '8', now: true },
  { t: 'İşleme', n: '23' },
  { t: 'Kontrol', n: '11' },
  { t: 'Beyan', n: '6' },
  { t: 'Tamam', n: '94', done: true },
];

export default function AdvisorHome() {
  return (
    <Screen>
      <ClientBar />

      <View style={styles.appbar}>
        <View>
          <Text style={styles.hello}>İyi çalışmalar</Text>
          <Text style={styles.name}>Muzaffer Ören</Text>
        </View>
        <Pressable style={styles.iconBtn} onPress={() => router.push('/(advisor)/bildirimler')}>
          <Bell size={19} color={colors.textMuted} />
          <View style={styles.dot} />
        </Pressable>
      </View>

      <Hero label="BUGÜNÜN NABZI · 27 Temmuz" big="142" suffix="aktif mükellef">
        <Pill tone="green">↗ 94 işi tamamlandı</Pill>
        <Text style={styles.heroMuted}>· 3 onay bekliyor</Text>
      </Hero>

      <Section title="Beyanname Durumu" action="Detay" onAction={() => router.push('/(advisor)/beyannameler')} />
      <Card style={{ backgroundColor: withAlpha(colors.gold, 0.06), borderColor: withAlpha(colors.gold, 0.28) }}>
        <View style={styles.thead}>
          <Text style={[styles.th, { flex: 1.7 }]}>BEYANNAME</Text>
          <Text style={styles.th}>ONAYLI</Text>
          <Text style={styles.th}>BEKLEYEN</Text>
          <Text style={styles.th}>KALAN</Text>
        </View>
        {BEYAN.map((b, i) => (
          <View key={i} style={styles.brow}>
            <View style={[styles.bcell, { flex: 1.7, flexDirection: 'row', alignItems: 'center', gap: 9 }]}>
              <View style={[styles.sd, { backgroundColor: b.dot }]} />
              <View>
                <Text style={styles.bname}>{b.t}</Text>
                <Text style={styles.bsub}>{b.s}</Text>
              </View>
            </View>
            <Text style={[styles.bval, { color: colors.green }]}>{b.ok}</Text>
            <Text style={[styles.bval, { color: b.bek === '0' ? colors.textSoft : colors.amber }]}>{b.bek}</Text>
            <View style={styles.bcellC}>
              <Text
                style={[
                  styles.kpill,
                  b.kalanTone === 'ok' && { color: colors.green, backgroundColor: withAlpha(colors.green, 0.14) },
                  b.kalanTone === 'warn' && { color: colors.amber, backgroundColor: withAlpha(colors.amber, 0.15) },
                  b.kalanTone === 'late' && { color: colors.rose, backgroundColor: withAlpha(colors.rose, 0.14) },
                ]}
              >
                {b.kalan}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <Counters
        items={[
          { icon: ShieldCheck, color: colors.green, n: '37/48', t: 'KDV mutabık' },
          { icon: Mail, color: colors.rose, n: '5', t: 'Yeni e-Tebligat' },
          { icon: FileText, color: colors.gold, n: '1.284', t: 'Bu ay fatura' },
          { icon: GitBranch, color: colors.copper, n: '8', t: 'Evrak bekleyen' },
        ]}
      />

      <Section title="Bu Ay İş Akışı" action="Aç" onAction={() => router.push('/(advisor)/mukellefler')} />
      <Card>
        <View style={styles.steps}>
          {STAGES.map((s, i) => (
            <View key={i} style={styles.step}>
              {i > 0 ? <View style={[styles.connector, s.done && { backgroundColor: colors.gold }]} /> : null}
              <View style={[styles.stepD, s.done && styles.stepDone, s.now && styles.stepNow]}>
                {s.done ? <Check size={15} color="#141109" /> : <Text style={[styles.stepN, s.now && { color: colors.gold }]}>{i + 1}</Text>}
              </View>
              <Text style={styles.stepT}>{s.t}</Text>
              <Text style={styles.stepC}>{s.n}</Text>
            </View>
          ))}
        </View>
      </Card>

      <LinearGradient
        colors={['rgba(195,166,230,0.16)', 'rgba(140,189,232,0.05)', 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.aiCard}
      >
        <View style={styles.aiHead}>
          <LinearGradient colors={['#c3a6e6', '#8cbde8']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.aiOrb}>
            <Bot size={19} color="#fff" />
          </LinearGradient>
          <Text style={styles.aiTitle}>MOREN AI</Text>
        </View>
        <Text style={styles.aiText}>“Bu ay 4 mükellefte KDV devreden tutarsızlığı buldum.”</Text>
        <Pressable style={styles.aiAsk} onPress={() => router.push('/(advisor)/ofis')}>
          <Text style={styles.aiAskText}>MOREN AI'ya sor…</Text>
          <View style={styles.aiSend}>
            <Send size={16} color="#141109" />
          </View>
        </Pressable>
      </LinearGradient>
    </Screen>
  );
}

const styles = StyleSheet.create({
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { fontSize: 12, color: colors.textSoft },
  name: { fontSize: 19, fontWeight: '600', color: colors.text, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14) },
  dot: { position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rose },
  heroMuted: { fontSize: 12.5, color: colors.textMuted },
  thead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: withAlpha(colors.gold, 0.14) },
  th: { flex: 1, fontSize: 9.5, letterSpacing: 0.6, color: colors.textSoft, fontWeight: '600', textAlign: 'center' },
  brow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: withAlpha(colors.white, 0.05) },
  bcell: {},
  bcellC: { flex: 1, alignItems: 'center' },
  bname: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  bsub: { fontSize: 10, color: colors.textSoft, marginTop: 1 },
  bval: { flex: 1, fontFamily: fonts.mono, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  sd: { width: 9, height: 9, borderRadius: 5 },
  kpill: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '600', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, overflow: 'hidden', minWidth: 30, textAlign: 'center' },
  steps: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', flex: 1 },
  connector: { position: 'absolute', top: 16, left: '-50%', width: '100%', height: 2, backgroundColor: withAlpha(colors.gold, 0.16), zIndex: 0 },
  stepD: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12100b', borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), zIndex: 1 },
  stepDone: { backgroundColor: colors.gold, borderColor: 'transparent' },
  stepNow: { backgroundColor: withAlpha(colors.gold, 0.16), borderColor: colors.gold },
  stepN: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  stepT: { fontSize: 11, color: colors.text, marginTop: 6, fontWeight: '600' },
  stepC: { fontSize: 10, color: colors.textSoft, marginTop: 2 },
  aiCard: { borderRadius: radius.xxl, padding: 18, borderWidth: 1, borderColor: withAlpha(colors.purple, 0.25), overflow: 'hidden' },
  aiGlow: { position: 'absolute', width: 160, height: 160, left: -40, bottom: -70, borderRadius: 80, backgroundColor: withAlpha(colors.purple, 0.22) },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiOrb: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '600', color: colors.text },
  aiText: { fontSize: 12.5, color: colors.textMuted, marginTop: 10, lineHeight: 19 },
  aiAsk: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: withAlpha(colors.white, 0.08), borderRadius: 14, padding: 11 },
  aiAskText: { flex: 1, fontSize: 13, color: colors.textSoft },
  aiSend: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold },
});
