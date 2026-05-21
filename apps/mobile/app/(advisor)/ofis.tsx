import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Send, Volume2 } from 'lucide-react-native';
import * as Speech from 'expo-speech';
import { useMutation } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { PrimaryButton } from '../../components/PrimaryButton';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, radius, spacing } from '../../lib/theme';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export default function AdvisorOfficeScreen() {
  const auth = useAuth();
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'ARDA hazır. Mükellef, KDV, beyanname veya iş yükü sorusunu yazabilirsin.',
    },
  ]);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant')?.text,
    [messages],
  );

  const mutation = useMutation({
    mutationFn: async (message: string) => {
      if (auth.user?.isDemo) {
        return {
          content:
            'Demo yanıtta önce eksik evrak ve bekleyen onaylara bakarım. Gerçek bağlantıda /moren-ofis/chat endpointi kullanılacak.',
        };
      }
      const { data } = await api.post('/moren-ofis/chat', { text: message });
      return data;
    },
    onSuccess: (data) => {
      const content = data?.content || data?.message || data?.reply || 'Yanıt alındı.';
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: content }]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: 'Ofis AI bağlantısı şu an cevap vermedi.' },
      ]);
    },
  });

  function send() {
    const clean = text.trim();
    if (!clean) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: clean }]);
    setText('');
    mutation.mutate(clean);
  }

  function speak() {
    if (lastAssistant) {
      Speech.speak(lastAssistant, { language: 'tr-TR', pitch: 1, rate: 0.96 });
    }
  }

  return (
    <Screen scroll={false}>
      <TopBar title="Moren Ofis AI" subtitle="Mobil sohbet hazırlığı" audience="advisor" onLogout={auth.logout} />

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            <Text style={[styles.bubbleText, item.role === 'user' && styles.userText]}>{item.text}</Text>
          </View>
        )}
      />

      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="ARDA'ya yaz..."
          placeholderTextColor={colors.textSoft}
          style={styles.input}
          multiline
        />
        <View style={styles.composerActions}>
          <PrimaryButton
            label="Ses"
            variant="secondary"
            onPress={speak}
            icon={<Volume2 size={17} color={colors.gold} strokeWidth={2.2} />}
            style={styles.compactButton}
          />
          <PrimaryButton
            label="Gönder"
            onPress={send}
            loading={mutation.isPending}
            disabled={!text.trim()}
            icon={<Send size={17} color={colors.black} strokeWidth={2.2} />}
            style={styles.compactButton}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  messages: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  bubble: {
    maxWidth: '86%',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  bubbleText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: colors.black,
    fontWeight: '700',
  },
  composer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    minHeight: 58,
    maxHeight: 120,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
  },
  composerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  compactButton: {
    flex: 1,
    minHeight: 44,
  },
});

