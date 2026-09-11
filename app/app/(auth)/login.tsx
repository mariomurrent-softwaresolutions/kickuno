import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/theme/tokens';

/**
 * Combined "create account / log in" + "join a group" screen — visually the
 * prototype's single Login screen, extended with real email/password auth
 * per documentation/implementation-plan.md §3.5.
 *
 * TODO(cms): wire `handleSubmit` to POST /api/users/login (or /api/users on
 * first run) then POST /api/groups/join { code }. Stubbed to just flip
 * local auth state until the Payload backend exists.
 */
export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('HALLE-OST');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit() {
    login();
    router.replace('/(app)/(tabs)');
  }

  return (
    <LinearGradient
      colors={['#1A1010', '#0B0E0F', '#0C1611']}
      locations={[0, 0.42, 1]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.25, y: 1 }}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1, paddingHorizontal: 24 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingTop: Math.max(56, insets.top + 28),
            paddingBottom: Math.max(24, insets.bottom + 16),
          }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="never"
        >
          <VStack className="gap-6">
            <HStack
              className="overflow-hidden rounded-[22px]"
              style={{ width: 74, height: 74, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 12 } }}
            >
              <Box className="flex-1 bg-red" />
              <Box className="flex-1 bg-green" />
            </HStack>
            <VStack className="gap-2">
              <Text
                className="font-heading uppercase text-ink"
                style={{ fontSize: 44, lineHeight: 42 }}
              >
                Unsere{'\n'}Fußballgruppe
              </Text>
              <Text
                className="font-body text-muted-soft"
                style={{ fontSize: 15, lineHeight: 22, maxWidth: 270 }}
              >
                Termine, Aufstellungen und alle Zahlen der Runde — Donnerstag, 20:00, Halle Ost.
              </Text>
            </VStack>
          </VStack>

          <VStack className="gap-3">
            <LabeledInput label="Gruppen-Code" value={code} onChangeText={setCode} placeholder="z.B. HALLE-OST" autoCapitalize="characters" />
            <LabeledInput label="E-Mail" value={email} onChangeText={setEmail} placeholder="du@example.com" autoCapitalize="none" keyboardType="email-address" />
            <LabeledInput label="Passwort" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />

            <Pressable onPress={handleSubmit} className="mt-1 h-14 overflow-hidden rounded-[15px] active:opacity-90">
              <LinearGradient
                colors={[colors.red, colors.green]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text className="font-body-bold text-white" style={{ fontSize: 17 }}>
                  Einsteigen
                </Text>
              </LinearGradient>
            </Pressable>

            <Text className="text-center font-body text-dim" style={{ fontSize: 12.5, marginTop: 2 }}>
              Noch kein Konto? Code vom Organisator bekommen und registrieren.
            </Text>
          </VStack>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'characters';
  keyboardType?: 'default' | 'email-address';
  secureTextEntry?: boolean;
}) {
  const { label, ...inputProps } = props;
  return (
    <VStack className="gap-1.5">
      <Text className="font-body-semibold text-dim" style={{ fontSize: 10, letterSpacing: 2 }}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.dim}
        className="rounded-[14px] border border-hairline bg-bg-card px-4 font-body-semibold text-ink"
        style={{ height: 52, fontSize: 17 }}
      />
    </VStack>
  );
}
