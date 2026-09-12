import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ChevronForwardIcon } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/theme/tokens';

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', organizer: 'Organisator', player: 'Spieler' };
const POSITION_LABELS: Record<string, string> = { tor: 'Tor', abwehr: 'Abwehr', mitte: 'Mitte', sturm: 'Sturm' };

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
      <ScreenHeader eyebrow="PROFIL" title={user?.name ?? '…'} />
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
              Position: {POSITION_LABELS[user.position] ?? user.position}
            </Text>
          ) : null}
        </VStack>

        {group ? (
          <VStack className="gap-2 rounded-[18px] border border-hairline bg-bg-card p-4">
            <Text className="font-body-semibold text-[10px] tracking-[2px] uppercase text-dim">Gruppe</Text>
            <HStack className="items-center justify-between">
              <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                {group.name}
              </Text>
              {membership ? (
                <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 12 }}>
                  {ROLE_LABELS[membership.role] ?? membership.role}
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
              Mein Spielerprofil
            </Text>
            <ChevronForwardIcon color={colors.dim} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          className="items-center rounded-[14px] border py-3.5 active:opacity-80"
          style={{ borderColor: colors.red, backgroundColor: 'rgba(226,59,59,0.10)' }}
        >
          <Text className="font-body-bold text-red" style={{ fontSize: 14.5 }}>
            {loggingOut ? 'Meldet ab…' : 'Abmelden'}
          </Text>
        </Pressable>
      </VStack>
    </ScrollView>
  );
}
