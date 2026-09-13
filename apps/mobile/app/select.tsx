import React from 'react';
import { View, Text, Pressable, Image, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Briefcase, User, ChevronRight, LucideIcon } from 'lucide-react-native';
import { colors, fonts, radius, spacing, withAlpha } from '../lib/theme';

/* Giriş türü seçimi — portaldaki "Nasıl giriş yapmak istersiniz?" ekranı */
export default function SelectScreen() {
  return (
    <LinearGradient colors={['#0b0906', '#080706']} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false}>
          <Image source={require('../assets/moren-logo-gold.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.h2}>Nasıl giriş yapmak istersiniz?</Text>
          <Text style={styles.lead}>Lütfen giriş türünüzü seçin</Text>

          <SelectCard
            icon={Briefcase}
            title="Mali Müşavir Girişi"
            desc="Ofis personeli ve yönetici — tüm portal yönetimi"
            onPress={() => router.push('/login?audience=advisor')}
          />
          <SelectCard
            icon={User}
            title="Mükellef Girişi"
            desc="Kendi beyanname, cari ve evrak bilgilerinizi görüntüleyin"
            onPress={() => router.push('/login?audience=taxpayer')}
          />

          <Text style={styles.foot}>© 2026 Moren Mali Müşavirlik</Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function SelectCard({ icon: Icon, title, desc, onPress }: { icon: LucideIcon; title: string; desc: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.stripe} />
      <View style={styles.ci}>
        <Icon size={22} color={colors.gold} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDesc}>{desc}</Text>
      <View style={styles.go}>
        <Text style={styles.goText}>Devam et</Text>
        <ChevronRight size={15} color={colors.gold} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { padding: 26, paddingTop: 40, alignItems: 'center' },
  logo: { width: 180, height: 130, marginBottom: 6 },
  h2: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '600', color: colors.text, marginTop: 16, textAlign: 'center' },
  lead: { color: colors.textSoft, fontSize: 13, marginTop: 6 },
  card: {
    width: '100%',
    borderRadius: radius.xxl,
    padding: 20,
    marginTop: 16,
    backgroundColor: withAlpha(colors.white, 0.045),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.14),
    overflow: 'hidden',
  },
  stripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: withAlpha(colors.gold, 0.7) },
  ci: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.gold, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.28),
  },
  cardTitle: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 14 },
  cardDesc: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, lineHeight: 18 },
  go: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  goText: { color: colors.gold, fontSize: 13, fontWeight: '600' },
  foot: { color: colors.textSoft, fontSize: 10.5, marginTop: 26 },
});
