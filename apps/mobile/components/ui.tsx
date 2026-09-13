import React, { useState, ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LucideIcon, ChevronRight, Check, Download, X } from 'lucide-react-native';
import { colors, radius, spacing, fonts, withAlpha } from '../lib/theme';

/* ============================================================
   MOREN MÜŞAVİR — Ortak Arayüz Kütüphanesi (design system)
   HTML önizlemesindeki koyu & altın tasarımın RN karşılığı.
   ============================================================ */

/* ---------- renk yardımcıları ---------- */
export const tint = (c: string, a = 0.15) => withAlpha(c, a);

/* ---------- Kart ---------- */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ---------- Bölüm başlığı ---------- */
export function Section({
  title,
  action,
  onAction,
  right,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.sec}>
      <Text style={styles.secTitle}>{title}</Text>
      {right}
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.secAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

/* ---------- İkon kutusu ---------- */
export function IconBox({ icon: Icon, color = colors.gold, size = 40 }: { icon: LucideIcon; color?: string; size?: number }) {
  return (
    <View
      style={[
        styles.iconBox,
        { width: size, height: size, backgroundColor: tint(color, 0.16), borderColor: tint(color, 0.3) },
      ]}
    >
      <Icon size={size * 0.47} color={color} />
    </View>
  );
}

/* ---------- Avatar (baş harf) ---------- */
export function Avatar({ label, color = colors.gold, size = 42 }: { label: string; color?: string; size?: number }) {
  return (
    <LinearGradient
      colors={[color, withAlpha(color, 0)]}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.33 }]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{label}</Text>
    </LinearGradient>
  );
}

/* ---------- Rozet ---------- */
export type BadgeTone = 'green' | 'amber' | 'rose' | 'sky' | 'steel' | 'violet';
const badgeColor: Record<BadgeTone, string> = {
  green: colors.sage,
  amber: colors.amber,
  rose: colors.rose,
  sky: colors.blue,
  steel: colors.steel,
  violet: colors.purple,
};
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: BadgeTone }) {
  const c = badgeColor[tone];
  return (
    <View style={[styles.badge, { backgroundColor: tint(c, 0.14) }]}>
      <Text style={[styles.badgeText, { color: c }]}>{children}</Text>
    </View>
  );
}

/* ---------- Pill (hero içi) ---------- */
export function Pill({ children, tone = 'green' }: { children: ReactNode; tone?: BadgeTone }) {
  const c = badgeColor[tone];
  return (
    <View style={[styles.pill, { backgroundColor: tint(c, 0.12) }]}>
      <Text style={[styles.pillText, { color: c }]}>{children}</Text>
    </View>
  );
}

/* ---------- Liste satırı ---------- */
export function Row({
  icon,
  iconColor = colors.gold,
  avatar,
  avatarColor,
  title,
  sub,
  sub2,
  right,
  rightSub,
  badge,
  badgeTone,
  onPress,
  children,
}: {
  icon?: LucideIcon;
  iconColor?: string;
  avatar?: string;
  avatarColor?: string;
  title: string;
  sub?: string;
  sub2?: string;
  right?: string;
  rightSub?: string;
  badge?: string;
  badgeTone?: BadgeTone;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={styles.row}>
      {avatar ? <Avatar label={avatar} color={avatarColor || colors.gold} size={40} /> : null}
      {icon ? <IconBox icon={icon} color={iconColor} size={40} /> : null}
      <View style={styles.rowMid}>
        <Text style={styles.rowTitle}>{title}</Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        {right ? <Text style={styles.rowRightVal}>{right}</Text> : null}
        {rightSub ? <Text style={styles.rowRightSub}>{rightSub}</Text> : null}
        {badge ? <Badge tone={badgeTone}>{badge}</Badge> : null}
        {children}
      </View>
    </Wrap>
  );
}

/* ---------- Çalışan sekmeler (functional tabs) ---------- */
export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [i, setI] = useState(0);
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.seg}
        contentContainerStyle={{ gap: 3 }}
      >
        {tabs.map((t, idx) => (
          <Pressable key={idx} onPress={() => setI(idx)} style={[styles.segBtn, i === idx && styles.segBtnOn]}>
            <Text style={[styles.segText, i === idx && styles.segTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ marginTop: spacing.md }}>{tabs[i].content}</View>
    </View>
  );
}

/* ---------- Seçici çip satırı ---------- */
export function SelRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {children}
    </ScrollView>
  );
}
export function SelChip({ label, value, icon: Icon, onPress }: { label: string; value: string; icon?: LucideIcon; onPress?: () => void }) {
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={styles.selChip}>
      <Text style={styles.selChipLabel}>{label}</Text>
      <View style={styles.selChipRow}>
        {Icon ? <Icon size={13} color={colors.gold} /> : null}
        <Text style={styles.selChipVal}>{value}</Text>
      </View>
    </Wrap>
  );
}

/* ---------- Aksiyon butonları ---------- */
export function ActionGrid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <View style={[styles.grid, { gap: 10 }]}>{React.Children.map(children, (c) => <View style={{ width: `${100 / cols}%`, paddingRight: 0 }}>{c}</View>)}</View>;
}
export function ActionButton({
  icon: Icon,
  color = colors.gold,
  title,
  sub,
  gold,
  onPress,
}: {
  icon: LucideIcon;
  color?: string;
  title: string;
  sub?: string;
  gold?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.actBtn, gold && styles.actBtnGold]}>
      <View style={[styles.actIc, { backgroundColor: gold ? 'rgba(0,0,0,0.15)' : tint(color, 0.16) }]}>
        <Icon size={17} color={gold ? '#141109' : color} />
      </View>
      <Text style={[styles.actTitle, gold && { color: '#141109' }]}>{title}</Text>
      {sub ? <Text style={[styles.actSub, gold && { color: 'rgba(20,17,9,0.7)' }]}>{sub}</Text> : null}
    </Pressable>
  );
}

/* ---------- Sayaç kartları ---------- */
export function Counters({ items, cols = 2 }: { items: { icon?: LucideIcon; color?: string; n: string; t: string; s?: string }[]; cols?: number }) {
  return (
    <View style={styles.grid}>
      {items.map((x, idx) => (
        <View key={idx} style={{ width: cols === 3 ? '33.33%' : '50%', padding: 5 }}>
          <View style={styles.ctr}>
            {x.icon ? (
              <View style={[styles.ctrIc, { backgroundColor: tint(x.color || colors.gold, 0.16) }]}>
                <x.icon size={16} color={x.color || colors.gold} />
              </View>
            ) : null}
            <Text style={[styles.ctrN, { color: x.color || colors.text }]}>{x.n}</Text>
            <Text style={styles.ctrT}>{x.t}</Text>
            {x.s ? <Text style={styles.ctrS}>{x.s}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ---------- Hero kartı ---------- */
export function Hero({ label, big, suffix, children, style }: { label: string; big: string; suffix?: string; children?: ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient colors={['#221a0f', '#12100b']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.hero, style]}>
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroBig}>
        {big}
        {suffix ? <Text style={styles.heroSuffix}>  {suffix}</Text> : null}
      </Text>
      {children ? <View style={styles.heroSub}>{children}</View> : null}
    </LinearGradient>
  );
}

/* ---------- Mali tablo satırı ---------- */
export type StmtKind = 'grp' | 'sub' | 'fin' | 'acc' | 'row';
export function StatementCard({ lines }: { lines: { n: string; code?: string; v: string; k?: StmtKind; neg?: boolean; man?: boolean }[] }) {
  return (
    <Card>
      {lines.map((l, idx) => {
        const k = l.k || 'row';
        return (
          <View key={idx} style={[styles.sline, k === 'sub' && styles.slineSub, k === 'fin' && styles.slineFin]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.slineName, k === 'grp' && styles.slineGrp, k === 'fin' && styles.slineFinName, k === 'acc' && styles.slineAcc]}>
                {l.code ? `${l.code} ` : ''}
                {l.n}
                {l.man ? '  ·MANUEL' : ''}
              </Text>
            </View>
            <Text style={[styles.slineAmt, l.neg && { color: colors.rose }, !l.neg && k !== 'grp' && k !== 'acc' && { color: colors.sage }]}>{l.v}</Text>
          </View>
        );
      })}
    </Card>
  );
}

/* ---------- KV liste (etiket → değer) ---------- */
export function KVList({ items }: { items: { label: string; value: string; tone?: 'pay' | 'pos' | 'warn' }[] }) {
  return (
    <View style={styles.kvList}>
      {items.map((x, idx) => (
        <View key={idx} style={styles.kv}>
          <Text style={styles.kvLabel}>{x.label}</Text>
          <Text style={[styles.kvVal, x.tone === 'pay' && { color: colors.gold, fontSize: 13 }, x.tone === 'pos' && { color: colors.sage }, x.tone === 'warn' && { color: colors.amber }]}>{x.value}</Text>
        </View>
      ))}
    </View>
  );
}

/* ---------- Denetim satırı (severity) ---------- */
export function DkRow({ level, title, sub }: { level: 'e' | 'w' | 'i'; title: string; sub?: string }) {
  const map = { e: { c: colors.rose, t: 'HATA' }, w: { c: colors.amber, t: 'UYARI' }, i: { c: colors.blue, t: 'BİLGİ' } }[level];
  return (
    <View style={styles.dkRow}>
      <View style={[styles.lvl, { backgroundColor: tint(map.c, 0.15) }]}>
        <Text style={[styles.lvlText, { color: map.c }]}>{map.t}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/* ---------- Luca'dan Çek butonu (animasyonlu) ---------- */
export function LucaButton({ label = "Luca'dan Çek", done = 'Güncellendi', onDone }: { label?: string; done?: string; onDone?: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const run = () => {
    if (state !== 'idle') return;
    setState('busy');
    setTimeout(() => {
      setState('done');
      onDone?.();
      setTimeout(() => setState('idle'), 2200);
    }, 1500);
  };
  return (
    <Pressable onPress={run} style={[styles.luca, state === 'done' && styles.lucaDone]}>
      {state === 'busy' ? null : state === 'done' ? <Check size={18} color="#0b1a14" /> : <Download size={18} color="#141109" />}
      <Text style={[styles.lucaText, state === 'done' && { color: '#0b1a14' }]}>
        {state === 'busy' ? "Luca'ya bağlanılıyor…" : state === 'done' ? done : label}
      </Text>
    </Pressable>
  );
}

/* ---------- Alt sayfa (bottom sheet modal) ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grab} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ---------- Chevron kısayolu ---------- */
export function Chevron() {
  return <ChevronRight size={18} color={colors.textSoft} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: withAlpha(colors.white, 0.03),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.14),
    borderRadius: radius.xxl,
    padding: spacing.md,
  },
  sec: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  secTitle: { fontFamily: fonts.heading, fontSize: 18, fontWeight: '600', color: colors.text, flex: 1 },
  secAction: { fontSize: 12.5, color: colors.gold, fontWeight: '600' },
  eyebrow: { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.goldMuted, fontWeight: '600' },
  iconBox: { borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.heading, fontWeight: '600', color: '#141109' },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10.5, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontSize: 11.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: withAlpha(colors.white, 0.05) },
  rowMid: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textSoft, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  rowRightVal: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowRightSub: { fontSize: 11, color: colors.textSoft },
  seg: { backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), borderRadius: radius.lg, padding: 4 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9 },
  segBtnOn: { backgroundColor: colors.gold },
  segText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  segTextOn: { color: '#141109' },
  selChip: { backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  selChipLabel: { fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: colors.goldMuted, fontWeight: '600' },
  selChipRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  selChipVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  actBtn: { margin: 5, padding: 13, borderRadius: radius.xl, backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14) },
  actBtnGold: { backgroundColor: colors.gold, borderColor: 'transparent' },
  actIc: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  actTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  actSub: { fontSize: 10.5, color: colors.textSoft, marginTop: 2 },
  ctr: { backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), borderRadius: radius.xl, padding: 13 },
  ctrIc: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ctrN: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '600' },
  ctrT: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  ctrS: { fontSize: 10, color: colors.textSoft, marginTop: 2 },
  hero: {
    borderRadius: radius.xxl,
    padding: 20,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.28),
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 8,
  },
  heroLabel: { fontSize: 12, color: colors.goldMuted, fontWeight: '600' },
  heroBig: { fontFamily: fonts.heading, fontSize: 33, fontWeight: '600', color: colors.text, marginTop: 6, marginBottom: 2, letterSpacing: 0.5 },
  heroSuffix: { fontFamily: fonts.body, fontSize: 16, fontWeight: '400', color: colors.textMuted },
  heroSub: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: withAlpha(colors.white, 0.05), gap: 10 },
  slineSub: { backgroundColor: withAlpha(colors.gold, 0.07), marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
  slineFin: { borderTopWidth: 2, borderTopColor: withAlpha(colors.gold, 0.28), borderBottomWidth: 0, marginTop: 2 },
  slineName: { fontSize: 14, fontWeight: '600', color: colors.text },
  slineGrp: { fontFamily: fonts.heading, color: colors.gold, fontSize: 14.5 },
  slineAcc: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted, paddingLeft: 12 },
  slineFinName: { fontFamily: fonts.heading, fontSize: 15, color: colors.gold },
  slineAmt: { fontFamily: fonts.mono, fontSize: 13.5, fontWeight: '600', color: colors.text },
  kvList: { marginTop: 8, borderTopWidth: 1, borderTopColor: withAlpha(colors.white, 0.06), paddingTop: 6 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  kvLabel: { fontSize: 11.5, color: colors.textMuted },
  kvVal: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '600', color: colors.text },
  dkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: withAlpha(colors.white, 0.05) },
  lvl: { width: 50, alignItems: 'center', paddingVertical: 3, borderRadius: 6 },
  lvlText: { fontSize: 9, fontWeight: '700' },
  luca: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 14, borderRadius: radius.xl, backgroundColor: colors.gold },
  lucaDone: { backgroundColor: colors.green },
  lucaText: { fontSize: 14, fontWeight: '600', color: '#141109' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: '#14110b', borderWidth: 1, borderColor: withAlpha(colors.gold, 0.28), borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontFamily: fonts.heading, fontSize: 19, fontWeight: '600', color: colors.text },
});
