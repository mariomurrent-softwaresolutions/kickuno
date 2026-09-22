import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {Image} from "expo-image";
import { useTranslation } from 'react-i18next';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { colors } from '@/theme/tokens';
import { useAssets } from "expo-asset";

type Mode = 'login' | 'register';

/**
 * Login / create-account screen — visually the prototype's single Login
 * screen, wired to real email/password auth (implementation-plan.md §3.5).
 * The invite-code / "create a group" step happens on the next screen
 * (`(auth)/join.tsx`) once the account exists — see the (auth) layout guard.
 */
export default function LoginScreen() {
  const { t } = useTranslation('login');
  const { t: tCommon } = useTranslation('common');
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [iconAsset] = useAssets([require('../../assets/images/icon.png')]);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Defaults on — matches what most people expect from a mobile app they'll
  // reopen regularly; unchecking it is the deliberate "don't keep me signed
  // in on this device" opt-out (see api.ts#setSession for what it does).
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);

    if (!email.trim() || !password) {
      setError(t('errors.emailPasswordRequired'));
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError(t('errors.nameRequired'));
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        await register(name.trim(), email.trim(), password);
      } else {
        await login(email.trim(), password, rememberMe);
      }
      // Navigation happens automatically: the (auth) layout redirects to
      // /join or /(app)/(tabs) once useAuth()'s status updates.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tCommon('errors.generic'));
    } finally {
      setSubmitting(false);
    }
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
              {iconAsset?.[0] ? (
                <Image
                  source={{ uri: iconAsset[0].uri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <Box className="flex-1 bg-bg-card" />
              )}
            </HStack>
            <VStack className="gap-2">
              <Text
                className="font-heading uppercase text-ink"
                style={{ fontSize: 44, lineHeight: 42 }}
              >
                Kickuno
              </Text>
              <Text
                className="font-body text-muted-soft"
                style={{ fontSize: 15, lineHeight: 22, maxWidth: 270 }}
              >
                {t('tagline')}
              </Text>
            </VStack>
          </VStack>

          <VStack className="gap-3">
            <ModeToggle mode={mode} onChange={(m) => { setMode(m); setError(null); }} t={t} />

            {mode === 'register' && (
              <LabeledInput label={t('fields.name.label')} value={name} onChangeText={setName} placeholder={t('fields.name.placeholder')} />
            )}
            <LabeledInput label={t('fields.email.label')} value={email} onChangeText={setEmail} placeholder={t('fields.email.placeholder')} autoCapitalize="none" keyboardType="email-address" />
            <LabeledInput label={t('fields.password.label')} value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />

            {mode === 'login' && (
              <Pressable
                onPress={() => setRememberMe((v) => !v)}
                className="flex-row items-center gap-2.5 self-start py-1"
              >
                <HStack
                  className="rounded-full p-0.5"
                  style={{ width: 40, height: 24, backgroundColor: rememberMe ? colors.green : colors.bgSunken }}
                >
                  <Box
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: '#fff',
                      marginLeft: rememberMe ? 16 : 0,
                    }}
                  />
                </HStack>
                <Text className="font-body-semibold text-dim" style={{ fontSize: 13 }}>
                  {t('rememberMe')}
                </Text>
              </Pressable>
            )}

            {error && (
              <Text className="font-body-semibold text-red" style={{ fontSize: 13 }}>
                {error}
              </Text>
            )}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              className="mt-1 h-14 overflow-hidden rounded-[15px] active:opacity-90"
              style={{ opacity: submitting ? 0.7 : 1 }}
            >
              <LinearGradient
                colors={[colors.red, colors.green]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="font-body-bold text-white" style={{ fontSize: 17 }}>
                    {mode === 'register' ? t('submit.register') : t('submit.login')}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(null); }}>
              <Text className="text-center font-body text-dim" style={{ fontSize: 12.5, marginTop: 2 }}>
                {mode === 'register'
                  ? t('switchMode.toLogin')
                  : t('switchMode.toRegister')}
              </Text>
            </Pressable>
          </VStack>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function ModeToggle({ mode, onChange, t }: { mode: Mode; onChange: (m: Mode) => void; t: (key: string) => string }) {
  return (
    <HStack className="gap-1.5 self-start rounded-full border border-hairline bg-bg-card p-1">
      {(['login', 'register'] as const).map((m) => (
        <Pressable
          key={m}
          onPress={() => onChange(m)}
          className="rounded-full px-4"
          style={{ height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? colors.bgSunken : 'transparent' }}
        >
          <Text
            className={mode === m ? 'font-body-semibold text-ink' : 'font-body text-dim'}
            style={{ fontSize: 12.5 }}
          >
            {m === 'login' ? t('mode.login') : t('mode.register')}
          </Text>
        </Pressable>
      ))}
    </HStack>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'characters' | 'words';
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
