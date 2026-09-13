import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, Users } from 'lucide-react-native';
import { useClient, CLIENTS, clientLabel } from '../lib/clients';
import { Avatar, Row } from './ui';
import { Sheet } from './ui';
import { colors, radius, withAlpha, fonts } from '../lib/theme';

export function ClientBar() {
  const { active, setActive } = useClient();
  const [open, setOpen] = useState(false);
  const isAll = active === 'all';

  return (
    <>
      <Pressable style={styles.bar} onPress={() => setOpen(true)}>
        {isAll ? (
          <View style={styles.allIc}>
            <Users size={18} color="#141109" />
          </View>
        ) : (
          <Avatar label={active.ini} color={active.color} size={36} />
        )}
        <View style={styles.mid}>
          <Text style={styles.lab}>{isAll ? 'KAPSAM' : 'SEÇİLİ MÜKELLEF'}</Text>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {clientLabel(active)}
            </Text>
            <ChevronDown size={14} color={colors.gold} />
          </View>
        </View>
        <Text style={styles.sw}>Değiştir</Text>
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} title="Mükellef Seç">
        <Row
          icon={Users}
          iconColor={colors.gold}
          title="Tüm Mükellefler"
          sub="Ofis geneli / genel modüller"
          onPress={() => {
            setActive('all');
            setOpen(false);
          }}
        />
        {CLIENTS.map((c) => (
          <Row
            key={c.id}
            avatar={c.ini}
            avatarColor={c.color}
            title={c.name}
            sub={`${c.tur} · VKN ${c.vkn}`}
            onPress={() => {
              setActive(c);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.xl,
    backgroundColor: withAlpha(colors.gold, 0.13),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.28),
  },
  allIc: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  mid: { flex: 1, minWidth: 0 },
  lab: { fontSize: 9, letterSpacing: 1.2, color: colors.goldMuted, fontWeight: '600' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  sw: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gold,
    backgroundColor: withAlpha(colors.gold, 0.14),
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    overflow: 'hidden',
  },
});
