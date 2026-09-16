import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { colors } from '@/theme/tokens';

type Mode = 'join' | 'create';

/**
 * implementation-plan.md §3.5 step 2: shown once an account exists but has
 * no membership yet — join an existing group by invite code, or create a
 * new one (auto-becomes admin — see cms/src/collections/Groups.ts).
 */
export default function JoinGroupScreen() {
  const { t } = useTranslation('join');
  const { t: tCommon } = useTranslation('common');
  const { joinGroup, createGroup, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('join');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (!value.trim()) {
      setError(mode === 'join' ? t('errors.codeRequired') : t('errors.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'join') await joinGroup(value.trim());
      else await createGroup(value.trim());
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1, paddingHorizontal: 24 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingTop: Math.max(56, insets.top + 28),
            paddingBottom: Math.max(24, insets.bottom + 16),
          }}
          keyboardShouldPersistTaps="handled"
        >
          <VStack className="gap-2">
            <Text className="font-heading uppercase text-ink" style={{ fontSize: 36, lineHeight: 36 }}>
              {t('title')}
            </Text>
            <Text className="font-body text-muted-soft" style={{ fontSize: 15, lineHeight: 22, maxWidth: 280 }}>
              {t('subtitle')}
            </Text>
          </VStack>

          <VStack className="gap-3">
            <HStack className="gap-1.5 self-start rounded-full border border-hairline bg-bg-card p-1">
              {(['join', 'create'] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => { setMode(m); setError(null); setValue(''); }}
                  className="rounded-full px-4"
                  style={{ height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? colors.bgSunken : 'transparent' }}
                >
                  <Text className={mode === m ? 'font-body-semibold text-ink' : 'font-body text-dim'} style={{ fontSize: 12.5 }}>
                    {m === 'join' ? t('mode.join') : t('mode.create')}
                  </Text>
                </Pressable>
              ))}
            </HStack>

            <VStack className="gap-1.5">
              <Text className="font-body-semibold text-dim" style={{ fontSize: 10, letterSpacing: 2 }}>
                {(mode === 'join' ? t('field.codeLabel') : t('field.nameLabel')).toUpperCase()}
              </Text>
              <TextInput
                value={value}
                onChangeText={setValue}
                placeholder={mode === 'join' ? t('field.codePlaceholder') : t('field.namePlaceholder')}
                autoCapitalize={mode === 'join' ? 'characters' : 'words'}
                placeholderTextColor={colors.dim}
                className="rounded-[14px] border border-hairline bg-bg-card px-4 font-body-semibold text-ink"
                style={{ height: 52, fontSize: 17 }}
              />
            </VStack>

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
                    {mode === 'join' ? t('submit.join') : t('submit.create')}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => logout()}>
              <Text className="text-center font-body text-dim" style={{ fontSize: 12.5, marginTop: 2 }}>
                {t('logout')}
              </Text>
            </Pressable>
          </VStack>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
