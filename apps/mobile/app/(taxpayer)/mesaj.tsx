import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Send } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../lib/auth';
import { colors, radius, spacing } from '../../lib/theme';

export default function TaxpayerMessageScreen() {
  const auth = useAuth();
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  function send() {
    setSent(true);
    setMessage('');
  }

  return (
    <Screen>
      <TopBar title="Ofise mesaj" subtitle="Soru ve randevu" audience="taxpayer" onLogout={auth.logout} />

      <View style={styles.card}>
        <Text style={styles.title}>Mesaj</Text>
        <TextInput
          value={message}
          onChangeText={(value) => {
            setSent(false);
            setMessage(value);
          }}
          placeholder="Moren ofisine mesaj yaz..."
          placeholderTextColor={colors.textSoft}
          style={styles.input}
          multiline
        />
        {sent ? <Text style={styles.sent}>Mesaj taslak kuyruğuna alındı.</Text> : null}
        <PrimaryButton
          label="Gönder"
          disabled={!message.trim()}
          onPress={send}
          icon={<Send size={17} color={colors.black} strokeWidth={2.2} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  input: {
    minHeight: 160,
    padding: spacing.md,
    borderRadius: radius.md,
    textAlignVertical: 'top',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
  },
  sent: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '700',
  },
});
