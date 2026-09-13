import { RefreshControl, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';

import { Box, HStack, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatTile } from '@/components/ui/stat-tile';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ApiPlayerKind } from '@/lib/api';
import { colors } from '@/theme/tokens';

const POSITION_LABELS: Record<string, string> = { tor: 'Tor', abwehr: 'Abwehr', mitte: 'Mitte', sturm: 'Sturm' };

// Avatar gradient — presentation-only, seeded by playerId so the same
// player always gets the same two-color gradient (implementation-plan.md
// §4.2 "avatar-gradient initials circle"). Not tied to `avatarSeed` on
// Users (§3.1) yet — that field exists but nothing writes to it currently.
const AVATAR_GRADIENTS: [string, string][] = [
  ['#E23B3B', '#F4D35E'],
  ['#2FBF6E', '#123322'],
  ['#F4D35E', '#8A5A12'],
  ['#2FBF6E', '#F4D35E'],
  ['#6E7A76', '#14181A'],
];
function avatarGradient(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

const FORM_COLORS: Record<'S' | 'U' | 'N', string> = { S: colors.green, U: colors.gold, N: colors.red };

function isPlayerKind(value: string | undefined): value is ApiPlayerKind {
  return value === 'users' || value === 'legacyPlayers';
}

/**
 * Spielerprofil — lives outside the tab groups so it can be pushed from
 * Start, Statistik, Termin-Detail, or Gruppe and back() always returns to
 * whichever tab opened it (implementation-plan.md §4.3). `playerId` may
 * resolve to a `users` or a `legacyPlayers` record (§3.7, phase 6) — every
 * call site that can link here now appends `?kind=`, defaulting to `users`
 * for the one call site that predates it ("Mein Spielerprofil", always the
 * signed-in user).
 */
export default function SpielerprofilScreen() {
  const { playerId, kind: kindParam } = useLocalSearchParams<{ playerId: string; kind?: string }>();
  const kind: ApiPlayerKind = isPlayerKind(kindParam) ? kindParam : 'users';
  const { group } = useAuth();

  const profileQuery = useQuery({
    queryKey: ['player-profile', playerId, kind, group?.id],
    queryFn: () => api.getPlayerProfile(playerId, group!.id, kind),
    enabled: Boolean(playerId) && Boolean(group),
  });

  const profile = profileQuery.data;

  if (!profile) {
    return (
      <ScrollView
        className="flex-1 bg-bg-screen"
        refreshControl={
          <RefreshControl
            tintColor={colors.dim}
            refreshing={profileQuery.isFetching}
            onRefresh={() => profileQuery.refetch()}
          />
        }
      >
        <ScreenHeader
          eyebrow="SPIELERPROFIL"
          title={profileQuery.isLoading ? '…' : 'Nicht gefunden'}
          onBack={() => router.back()}
        />
        {!profileQuery.isLoading && (
          <Text className="font-body text-muted px-5 pt-4" style={{ fontSize: 13.5 }}>
            Dieser Spieler ist kein Mitglied deiner Gruppe (mehr).
          </Text>
        )}
      </ScrollView>
    );
  }

  const isLegacy = profile.player.kind === 'legacyPlayers';
  const [gradientStart, gradientEnd] = avatarGradient(profile.player.id);
  const goalDiffColor = profile.season.goalDiff >= 0 ? colors.green : colors.red;

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          tintColor={colors.dim}
          refreshing={profileQuery.isFetching}
          onRefresh={() => profileQuery.refetch()}
        />
      }
    >
      <ScreenHeader eyebrow="SPIELERPROFIL" title={profile.player.name} onBack={() => router.back()} />
      <VStack className="gap-6 px-5 pt-4">
        <HStack className="items-center gap-4">
          <LinearGradient
            colors={[gradientStart, gradientEnd]}
            style={{ width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text className="font-heading text-white" style={{ fontSize: 24 }}>
              {profile.player.initials ?? profile.player.name.slice(0, 2).toUpperCase()}
            </Text>
          </LinearGradient>
          <VStack className="flex-1 gap-1">
            <HStack className="items-center gap-2">
              <Text className="font-heading uppercase text-ink" style={{ fontSize: 20, lineHeight: 22 }} numberOfLines={1}>
                {profile.player.name}
              </Text>
              {isLegacy ? (
                <Box
                  className="rounded-full px-2 py-0.5"
                  style={{ borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.bgSunken }}
                >
                  <Text className="font-body-semibold text-dim" style={{ fontSize: 10, letterSpacing: 0.5 }}>
                    EHEMALIG
                  </Text>
                </Box>
              ) : null}
            </HStack>
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              {[
                profile.player.position ? POSITION_LABELS[profile.player.position] ?? profile.player.position : null,
                typeof profile.player.strength === 'number' ? `Stärke ${profile.player.strength}` : null,
                profile.player.memberSinceYear ? `dabei seit ${profile.player.memberSinceYear}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {isLegacy && profile.player.note ? (
              <Text className="font-body text-muted-soft" style={{ fontSize: 12 }}>
                {profile.player.note}
              </Text>
            ) : null}
          </VStack>
        </HStack>

        <VStack className="gap-2">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">Form (letzte 5)</Text>
          <HStack className="gap-2">
            {profile.form.length ? (
              profile.form.map((result, index) => (
                <Box
                  key={index}
                  className="items-center justify-center rounded-full"
                  style={{
                    width: 30,
                    height: 30,
                    backgroundColor: `${FORM_COLORS[result]}22`,
                    borderWidth: 1,
                    borderColor: FORM_COLORS[result],
                  }}
                >
                  <Text className="font-body-bold" style={{ fontSize: 12.5, color: FORM_COLORS[result] }}>
                    {result}
                  </Text>
                </Box>
              ))
            ) : (
              <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
                –
              </Text>
            )}
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">
            Saison {profile.season.label}
          </Text>
          <HStack className="gap-2.5">
            <StatTile label="Spiele" value={String(profile.season.played)} />
            <StatTile label="Tore" value={String(profile.season.goals)} valueColor={colors.gold} />
            <StatTile label="Siegquote" value={`${profile.season.quote}%`} valueColor={colors.green} />
          </HStack>
          <HStack className="gap-2.5">
            <StatTile
              label="S / U / N"
              value={`${profile.season.wins} / ${profile.season.draws} / ${profile.season.losses}`}
            />
            <StatTile
              label="Torverhältnis"
              value={profile.season.goalDiff > 0 ? `+${profile.season.goalDiff}` : String(profile.season.goalDiff)}
              valueColor={goalDiffColor}
            />
            <StatTile label="MVP" value={String(profile.season.mvps)} />
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">All-Time</Text>
          <VStack className="rounded-[16px] border border-hairline bg-bg-card">
            {[
              { label: 'Spiele gesamt', value: String(profile.allTime.played) },
              { label: 'Tore gesamt', value: String(profile.allTime.goals) },
              { label: 'Siege gesamt', value: String(profile.allTime.wins) },
              { label: 'Siegquote all-time', value: `${profile.allTime.quote}%` },
              { label: 'MVP-Titel', value: String(profile.allTime.mvps) },
              { label: 'Eigentore', value: String(profile.allTime.ownGoals) },
            ].map((row, index, arr) => (
              <HStack
                key={row.label}
                className="items-center justify-between px-4 py-3"
                style={index < arr.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.hairline } : undefined}
              >
                <Text className="font-body text-muted" style={{ fontSize: 13 }}>
                  {row.label}
                </Text>
                <Text className="font-body-semibold text-ink" style={{ fontSize: 14 }}>
                  {row.value}
                </Text>
              </HStack>
            ))}
          </VStack>
        </VStack>
      </VStack>
    </ScrollView>
  );
}
