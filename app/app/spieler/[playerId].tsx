import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatTile } from '@/components/ui/stat-tile';
import { FormPills } from '@/components/ui/form-pills';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ApiPlayerKind } from '@/lib/api';
import { colors } from '@/theme/tokens';

const POSITION_KEYS: Record<string, 'tor' | 'abwehr' | 'mitte' | 'sturm'> = { tor: 'tor', abwehr: 'abwehr', mitte: 'mitte', sturm: 'sturm' };

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
  const { t } = useTranslation('spielerprofil');
  const { playerId, kind: kindParam } = useLocalSearchParams<{ playerId: string; kind?: string }>();
  const kind: ApiPlayerKind = isPlayerKind(kindParam) ? kindParam : 'users';
  const { group } = useAuth();
  const mvpEnabled = Boolean(group?.features.mvp);

  // `null` means "no explicit choice yet — use whichever season is
  // active", same convention as the Statistik screen's own season picker
  // (feature-plan-stats-enhancements.md context) — kept independent state
  // here rather than shared, since a profile can be opened straight from
  // several different screens with no season context to inherit.
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  const seasonsQuery = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });
  const seasons = seasonsQuery.data?.docs ?? [];
  const activeSeason = seasons.find((s) => s.status === 'active') ?? null;
  const effectiveSeasonId = selectedSeasonId ?? activeSeason?.id;

  const profileQuery = useQuery({
    queryKey: ['player-profile', playerId, kind, group?.id, effectiveSeasonId],
    queryFn: () => api.getPlayerProfile(playerId, group!.id, kind, effectiveSeasonId),
    enabled: Boolean(playerId) && Boolean(group),
    placeholderData: (previousData) => previousData,
  });

  const profile = profileQuery.data;

  // Tracks only an explicit pull-to-refresh — see statistik/index.tsx's
  // comment on the same pattern.
  const [isRefreshing, setIsRefreshing] = useState(false);
  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await Promise.all([profileQuery.refetch(), seasonsQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  if (!profile) {
    return (
      <ScrollView
        className="flex-1 bg-bg-screen"
        refreshControl={
          <RefreshControl tintColor={colors.dim} refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        <ScreenHeader
          eyebrow={t('eyebrow')}
          title={profileQuery.isLoading ? '…' : t('notFound')}
          onBack={() => router.back()}
        />
        {!profileQuery.isLoading && (
          <Text className="font-body text-muted px-5 pt-4" style={{ fontSize: 13.5 }}>
            {t('notFoundBody')}
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
        <RefreshControl tintColor={colors.dim} refreshing={isRefreshing} onRefresh={handleRefresh} />
      }
    >
      <ScreenHeader eyebrow={t('eyebrow')} title={profile.player.name} onBack={() => router.back()} />
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
                    {t('legacyBadge')}
                  </Text>
                </Box>
              ) : null}
            </HStack>
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              {[
                profile.player.position
                  ? POSITION_KEYS[profile.player.position]
                    ? t(`positions.${POSITION_KEYS[profile.player.position]}`)
                    : profile.player.position
                  : null,
                typeof profile.player.strength === 'number' ? t('strength', { value: profile.player.strength }) : null,
                profile.player.memberSinceYear ? t('memberSince', { year: profile.player.memberSinceYear }) : null,
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
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('form.title')}</Text>
          <FormPills results={profile.form} emptyLabel="–" />
        </VStack>

        <VStack className="gap-2.5">
          <HStack className="items-center justify-between">
            <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">
              {t('season.title', { label: profile.season.label })}
            </Text>
          </HStack>
          {seasons.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              {seasons.map((s) => {
                const active = s.id === effectiveSeasonId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSelectedSeasonId(s.id)}
                    className="rounded-full border px-4 py-2"
                    style={{
                      borderColor: active ? colors.green : colors.hairline,
                      backgroundColor: active ? 'rgba(47,191,110,0.12)' : colors.bgCard,
                    }}
                  >
                    <HStack className="items-center gap-1.5">
                      <Text className="font-body-semibold" style={{ fontSize: 13, color: active ? colors.green : colors.ink }}>
                        {s.label}
                      </Text>
                      {s.status === 'active' ? (
                        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green }} />
                      ) : null}
                    </HStack>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <HStack className="gap-2.5">
            <StatTile label={t('season.played')} value={String(profile.season.played)} />
            <StatTile label={t('season.goals')} value={String(profile.season.goals)} valueColor={colors.gold} />
            <StatTile label={t('season.quote')} value={`${profile.season.quote}%`} valueColor={colors.green} />
          </HStack>
          <HStack className="gap-2.5">
            <StatTile
              label={t('season.record')}
              value={`${profile.season.wins} / ${profile.season.draws} / ${profile.season.losses}`}
            />
            <StatTile
              label={t('season.goalDiff')}
              value={profile.season.goalDiff > 0 ? `+${profile.season.goalDiff}` : String(profile.season.goalDiff)}
              valueColor={goalDiffColor}
            />
            {mvpEnabled && <StatTile label={t('season.mvp')} value={String(profile.season.mvps)} />}
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('allTime.title')}</Text>
          <VStack className="rounded-[16px] border border-hairline bg-bg-card">
            {[
              { label: t('allTime.played'), value: String(profile.allTime.played) },
              { label: t('allTime.goals'), value: String(profile.allTime.goals) },
              { label: t('allTime.wins'), value: String(profile.allTime.wins) },
              { label: t('allTime.quote'), value: `${profile.allTime.quote}%` },
              ...(mvpEnabled ? [{ label: t('allTime.mvps'), value: String(profile.allTime.mvps) }] : []),
              { label: t('allTime.ownGoals'), value: String(profile.allTime.ownGoals) },
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
