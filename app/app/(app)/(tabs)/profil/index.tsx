import { useState } from 'react';
import { Alert, ScrollView, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ChevronForwardIcon } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { colors } from '@/theme/tokens';
import i18n, { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/lib/i18n';

/**
 * Profil tab — the signed-in user's own account + logout. Not in the
 * original prototype (§4.3 has 4 tabs, with logout tucked into Gruppe —
 * §4.5); added as a 5th tab so logout has a real, permanent home instead
 * of the dev-only "Abmelden" link that used to sit on the Start screen.
 *
 * Distinct from Spielerprofil (`app/spieler/[playerId].tsx`, phase 5):
 * that one shows any player's season/all-time stats and is reached by
 * tapping a player anywhere in the app; this one is "my account" and lives
 * in the tab bar. "Mein Spielerprofil" below links to the former for the
 * signed-in user's own stats, once phase 5 builds that screen out.
 */
export default function ProfilScreen() {
  const { t } = useTranslation('profil');
  const { user, group, membership, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader eyebrow={t('eyebrow')} title={user?.name ?? '…'} />
      <VStack className="gap-5 px-5 pt-4">
        <VStack className="gap-3 rounded-[18px] border border-hairline bg-bg-card p-4">
          <VStack className="gap-0.5">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 16 }}>
              {user?.name ?? '—'}
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              {user?.email ?? ''}
            </Text>
          </VStack>
          {user?.position ? (
            <Text className="font-body text-muted-soft" style={{ fontSize: 12.5 }}>
              {t('position', { position: t(`positions.${user.position}`) })}
            </Text>
          ) : null}
        </VStack>

        {group ? (
          <VStack className="gap-2 rounded-[18px] border border-hairline bg-bg-card p-4">
            <Text className="font-body-semibold text-[10px] tracking-[2px] uppercase text-dim">
              {t('group.eyebrow')}
            </Text>
            <HStack className="items-center justify-between">
              <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                {group.name}
              </Text>
              {membership ? (
                <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 12 }}>
                  {t(`group.roles.${membership.role}`, { defaultValue: membership.role })}
                </Text>
              ) : null}
            </HStack>
          </VStack>
        ) : null}

        {user ? (
          <Pressable
            onPress={() => router.push(`/spieler/${user.id}`)}
            className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5 active:opacity-85"
          >
            <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
              {t('myProfileLink')}
            </Text>
            <ChevronForwardIcon color={colors.dim} />
          </Pressable>
        ) : null}

        <LanguageCard />

        <ChangePasswordCard />

        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          className="items-center rounded-[14px] border py-3.5 active:opacity-80"
          style={{ borderColor: colors.red, backgroundColor: 'rgba(226,59,59,0.10)' }}
        >
          <Text className="font-body-bold text-red" style={{ fontSize: 14.5 }}>
            {loggingOut ? t('logout.loading') : t('logout.action')}
          </Text>
        </Pressable>

        <DeleteAccountCard />
      </VStack>
    </ScrollView>
  );
}

/**
 * Irreversible account deletion — not in the original plan, added on
 * request. Two layers of confirmation on purpose, since this can't be
 * undone: the current password (proof this is actually the account
 * owner, same reasoning as `ChangePasswordCard`/`/change-password` — a
 * bare valid session token isn't enough), then a native OS confirm
 * dialog right before the request actually fires. Collapsed behind a
 * "Konto löschen" row by default, same pattern as `ChangePasswordCard`,
 * so it never sits open as a visual "danger zone" on a screen someone
 * might just be glancing at.
 */
function DeleteAccountCard() {
  const { t } = useTranslation('profil');
  const { deleteAccount, membership, group } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only meaningful while this account is still signed in — read once
  // before deleteAccount() below drops the session, so the warning is
  // based on the role/group the person actually had going into this.
  const isGroupAdmin = membership?.role === 'admin';

  function toggle() {
    setExpanded((prev) => !prev);
    setPassword('');
    setError(null);
  }

  function handlePress() {
    if (submitting) return;
    setError(null);
    if (!password) {
      setError(t('deleteAccount.errors.required'));
      return;
    }
    Alert.alert(t('deleteAccount.alertTitle'), t('deleteAccount.alertMessage'), [
      { text: t('deleteAccount.alertCancel'), style: 'cancel' },
      { text: t('deleteAccount.alertConfirm'), style: 'destructive', onPress: () => void handleConfirm() },
    ]);
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const transfers = await deleteAccount(password);
      // Success drops straight back to the login screen via auth-context's
      // own status change. If this account was a group's sole admin,
      // deleteAccount() already promoted someone else server-side before
      // this resolved — show who, so the person isn't left wondering.
      // Alert.alert is a native modal independent of the navigation stack,
      // so it still shows over the login screen that appears underneath.
      for (const transfer of transfers) {
        Alert.alert(
          t('deleteAccount.transferTitle'),
          t('deleteAccount.transferMessage', { group: transfer.groupName, name: transfer.promotedUserName }),
        );
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('deleteAccount.errors.generic'));
      setSubmitting(false);
    }
  }

  return (
    <VStack className="gap-3 rounded-[18px] border p-4" style={{ borderColor: colors.red, backgroundColor: 'rgba(226,59,59,0.06)' }}>
      <Pressable onPress={toggle} className="flex-row items-center justify-between active:opacity-80">
        <Text className="font-body-bold text-red" style={{ fontSize: 14.5 }}>
          {t('deleteAccount.title')}
        </Text>
        <ChevronForwardIcon color={colors.red} />
      </Pressable>

      {expanded ? (
        <VStack className="gap-3">
          <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
            {t('deleteAccount.warning')}
          </Text>

          {isGroupAdmin ? (
            <Text className="font-body-semibold text-red" style={{ fontSize: 12.5 }}>
              {t('deleteAccount.adminWarning', { group: group?.name ?? '' })}
            </Text>
          ) : null}

          <PasswordField label={t('deleteAccount.password')} value={password} onChangeText={setPassword} />

          {error ? (
            <Text className="font-body-semibold text-red" style={{ fontSize: 12.5 }}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={handlePress}
            disabled={submitting}
            className="items-center rounded-[12px] py-3 active:opacity-85"
            style={{ backgroundColor: colors.red, opacity: submitting ? 0.7 : 1 }}
          >
            <Text className="font-body-bold text-white" style={{ fontSize: 13.5 }}>
              {submitting ? t('deleteAccount.deleting') : t('deleteAccount.confirmButton')}
            </Text>
          </Pressable>
        </VStack>
      ) : null}
    </VStack>
  );
}

/**
 * Language picker — feature-plan-i18n-localization.md. Per-user, app-level:
 * defaults to the phone's language on first login (`resolveDeviceLanguage`
 * in `lib/i18n`), overridable here at any time, independent of anything
 * any other member of the same group has chosen. Same instant-apply +
 * persist pattern as the rest of this app's toggles (e.g. Gruppe/
 * Einstellungen's weekday chips): the UI updates immediately via
 * `i18n.changeLanguage`, then the choice is saved to `users.locale` so it
 * follows the account to a new device — with a rollback to the previous
 * language if the save itself fails, since a language flip that silently
 * doesn't stick would be confusing.
 */
function LanguageCard() {
  const { t, i18n: i18nInstance } = useTranslation('common');
  const { user } = useAuth();
  const [saving, setSaving] = useState<SupportedLanguage | null>(null);
  const activeLanguage = i18nInstance.language as SupportedLanguage;

  async function selectLanguage(lang: SupportedLanguage) {
    if (saving || lang === activeLanguage) return;
    const previous = activeLanguage;
    setSaving(lang);
    try {
      await i18n.changeLanguage(lang);
      if (user) await api.updateLocale(user.id, lang);
    } catch {
      await i18n.changeLanguage(previous);
    } finally {
      setSaving(null);
    }
  }

  return (
    <VStack className="gap-2.5 rounded-[18px] border border-hairline bg-bg-card p-4">
      <Text className="font-body-semibold text-[10px] tracking-[2px] uppercase text-dim">
        {t('language.label')}
      </Text>
      <HStack className="gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const active = lang === activeLanguage;
          return (
            <Pressable
              key={lang}
              onPress={() => selectLanguage(lang)}
              disabled={saving != null}
              className="rounded-full border px-4 py-2"
              style={{
                borderColor: active ? colors.green : colors.hairline,
                backgroundColor: active ? colors.bgSunken : colors.bgCard,
              }}
            >
              <Text className="font-body-semibold" style={{ fontSize: 13, color: active ? colors.green : colors.ink }}>
                {t(`language.${lang}`)}
              </Text>
            </Pressable>
          );
        })}
      </HStack>
    </VStack>
  );
}

/**
 * Inline "Passwort ändern" — collapsed to a single row by default, like the
 * rest of Profil; expands to a 3-field form on tap. Not a plan-called-out
 * feature (implementation-plan.md's auth section only ever specified
 * login/register), added on request: every account so far can only ever
 * get a password via `POST /api/users` at signup, with no way to change it
 * afterwards short of editing Mongo directly.
 *
 * Deliberately its own endpoint rather than a plain
 * `PATCH /api/users/:id { password }` — see `Users.ts`'s `/change-password`
 * endpoint and this file's `api.changePassword` for why (proof of the
 * current password, not just a valid session token).
 */
function ChangePasswordCard() {
  const { t } = useTranslation('profil');
  const [expanded, setExpanded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  }

  function toggle() {
    setExpanded((prev) => !prev);
    reset();
    setSuccess(false);
  }

  async function handleSave() {
    if (submitting) return;
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('changePassword.errors.required'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('changePassword.errors.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.errors.mismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      // The server's own message here stays German regardless of app
      // language (feature-plan-i18n-localization.md: backend is out of
      // scope) — shown as-is, same as every other server error in the app.
      setError(e instanceof ApiError ? e.message : t('changePassword.errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VStack className="gap-3 rounded-[18px] border border-hairline bg-bg-card p-4">
      <Pressable onPress={toggle} className="flex-row items-center justify-between active:opacity-80">
        <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
          {t('changePassword.title')}
        </Text>
        <ChevronForwardIcon color={colors.dim} />
      </Pressable>

      {expanded ? (
        <VStack className="gap-3">
          <PasswordField label={t('changePassword.currentPassword')} value={currentPassword} onChangeText={setCurrentPassword} />
          <PasswordField label={t('changePassword.newPassword')} value={newPassword} onChangeText={setNewPassword} />
          <PasswordField label={t('changePassword.confirmPassword')} value={confirmPassword} onChangeText={setConfirmPassword} />

          {error ? (
            <Text className="font-body-semibold text-red" style={{ fontSize: 12.5 }}>
              {error}
            </Text>
          ) : null}
          {success ? (
            <Text className="font-body-semibold text-green" style={{ fontSize: 12.5 }}>
              {t('changePassword.success')}
            </Text>
          ) : null}

          <Pressable
            onPress={handleSave}
            disabled={submitting}
            className="items-center rounded-[12px] py-3 active:opacity-85"
            style={{ backgroundColor: colors.green, opacity: submitting ? 0.7 : 1 }}
          >
            <Text className="font-body-bold text-white" style={{ fontSize: 13.5 }}>
              {submitting ? t('changePassword.saving') : t('changePassword.save')}
            </Text>
          </Pressable>
        </VStack>
      ) : null}
    </VStack>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <VStack className="gap-1.5">
      <Text className="font-body-semibold text-[10px] tracking-[1.5px] uppercase text-dim">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={colors.dim}
        className="rounded-[12px] border border-hairline bg-bg-sunken px-3.5 font-body-semibold text-ink"
        style={{ height: 44, fontSize: 14.5 }}
      />
    </VStack>
  );
}
