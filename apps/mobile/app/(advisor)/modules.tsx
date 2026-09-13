import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import {
  Bot, MessageCircle, Home, Users, CalendarCheck, GitBranch, CheckSquare, Bell, FileText, Search, Cpu, Files,
  Printer, Landmark, UserCog, ShieldCheck, PieChart, Layers, Mail, Briefcase, Scale, BookOpen, BarChart3,
  FileCheck2, Wallet, Archive, KeyRound, Megaphone, Car, Sliders, MessageSquare, Gauge, Monitor, Activity, Settings,
  LucideIcon,
} from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { ClientBar } from '../../components/ClientBar';
import { colors, fonts, radius, withAlpha } from '../../lib/theme';

type Tile = { id: string; label: string; icon: LucideIcon; color: string; route: string };
const M = (id: string, label: string, icon: LucideIcon, color: string, route?: string): Tile => ({
  id, label, icon, color, route: route || `/(advisor)/m/${id}`,
});

const GROUPS: { g: string; items: Tile[] }[] = [
  { g: 'Moren AI', items: [M('ai', 'MOREN AI', Bot, colors.purple, '/(advisor)/ofis'), M('whatsapp', 'WhatsApp', MessageCircle, colors.green)] },
  {
    g: 'Genel',
    items: [
      M('panel', 'Panel', Home, colors.gold, '/(advisor)'),
      M('mukellef-listesi', 'Mükellef Listesi', Users, colors.blue),
      M('aylik-takip', 'Aylık Takip', CalendarCheck, colors.amber),
      M('is-akisi', 'İş Akışı', GitBranch, colors.copper),
      M('gorevler', 'Görevler', CheckSquare, colors.green),
      M('bildirim', 'Bildirim', Bell, colors.rose, '/(advisor)/bildirimler'),
    ],
  },
  {
    g: 'Fatura & Muhasebe',
    items: [
      M('fatura-merkezi', 'Fatura Merkezi', FileText, colors.gold),
      M('e-arsiv', 'E-Arşiv Sorgu', Search, colors.blue),
      M('mihsap', 'Mihsap', Cpu, colors.copper),
      M('faturalar', 'İşlenen Fat.', Files, colors.amber),
      M('fis-yazdirma', 'Fiş Yazdır', Printer, colors.steel),
      M('banka', 'Banka Takip', Landmark, colors.green),
      M('profiller', 'Profiller', UserCog, colors.purple),
    ],
  },
  {
    g: 'Vergi & Beyanname',
    items: [
      M('kdv-kontrol', 'KDV Kontrol', ShieldCheck, colors.green),
      M('kdv-panosu', 'KDV Panosu', PieChart, colors.gold),
      M('beyanname', 'Beyanname', Layers, colors.blue),
      M('tebligat', 'e-Tebligat', Mail, colors.rose),
      M('sgk', 'SGK', Briefcase, colors.amber),
    ],
  },
  {
    g: 'Mali Veriler',
    items: [
      M('mizan', 'Mizan', Scale, colors.gold),
      M('hesap-ozeti', 'Hesap Özeti', BookOpen, colors.copper),
      M('gelir', 'Gelir Tablosu', BarChart3, colors.green),
      M('bilanco', 'Bilanço', Scale, colors.blue),
      M('edefter', 'E-Defter', FileCheck2, colors.amber),
    ],
  },
  {
    g: 'Ofis',
    items: [
      M('cari', 'Cari Kasa', Wallet, colors.green),
      M('evrak', 'Evrak Arşivi', Archive, colors.amber),
      M('portal-erisim', 'Portal Erişim', KeyRound, colors.blue),
      M('duyurular', 'Duyurular', Megaphone, colors.gold),
      M('hgs', 'HGS İhlal', Car, colors.rose),
    ],
  },
  {
    g: 'Teknik & Sistem',
    items: [
      M('luca', 'Luca Operatör', Cpu, colors.copper),
      M('otomasyon', 'Otomasyon', Sliders, colors.purple),
      M('hatirlatmalar', 'WhatsApp Oto.', MessageSquare, colors.green),
      M('sablonlar', 'Şablonlar', MessageSquare, colors.blue),
      M('bot-kalite', 'Bot Kalite', Gauge, colors.green),
      M('masaustu', 'Masaüstü', Monitor, colors.steel),
      M('ajanlar', 'Tüm Ajanlar', Bot, colors.amber),
      M('saglik', 'Sağlık', Activity, colors.rose),
      M('ayarlar', 'Ayarlar', Settings, colors.gold),
    ],
  },
];

export default function ModulesScreen() {
  return (
    <Screen>
      <ClientBar />
      <View style={styles.head}>
        <Text style={styles.eyebrow}>TÜM MODÜLLER</Text>
        <Text style={styles.title}>Modüller</Text>
      </View>
      {GROUPS.map((grp) => (
        <View key={grp.g}>
          <Text style={styles.groupLabel}>{grp.g}</Text>
          <View style={styles.grid}>
            {grp.items.map((t) => (
              <Pressable key={t.id} style={styles.tile} onPress={() => router.push(t.route as any)}>
                <View style={[styles.tIc, { backgroundColor: withAlpha(t.color, 0.15), borderColor: withAlpha(t.color, 0.3) }]}>
                  <t.icon size={24} color={t.color} />
                </View>
                <Text style={styles.tLabel} numberOfLines={2}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 2 },
  eyebrow: { fontSize: 11, letterSpacing: 2, color: colors.goldMuted, fontWeight: '600' },
  title: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '600', color: colors.text, marginTop: 4 },
  groupLabel: { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.goldMuted, fontWeight: '600', marginTop: 14, marginBottom: 10, marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '25%', alignItems: 'center', paddingVertical: 6, gap: 8 },
  tIc: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tLabel: { fontSize: 10.5, color: colors.textMuted, textAlign: 'center', fontWeight: '500', paddingHorizontal: 2 },
});
