import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ChevronForwardIcon } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { StatTile } from '@/components/ui/stat-tile';
import { FormPills } from '@/components/ui/form-pills';
import { useAuth } from '@/lib/auth-context';
import { useFeatures } from '@/lib/features-context';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

function fixtureDateTime(fixture: api.ApiFixture): Date {
  const d = new Date(fixture.date);
  const [h, m] = fixture.time.split(':').map((n) => parseInt(n, 10));
  d.setUTCHours(h || 0, m || 0, 0, 0);
  return d;
}

function countdownLabel(target: Date, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return t('countdown.today');
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days === 1 ? t('countdown.tomorrow') : t('countdown.inDays', { days });
}

/**
 * Start tab — next-fixture card + RSVP, plus the phase-5 "my stats"
 * summary (implementation-plan.md §4.5): my season tiles, my last-5 form,
 * the last recorded game's score, and the group's top-3 scorers. Each
 * reuses the exact same endpoints/components as Statistik and
 * Spielerprofil (`getPlayerProfile`, `getStats`, `StatTile`, `FormPills`)
 * rather than duplicating that logic — this screen is just a compact
 * preview, "see all" links push into the full Statistik/Spielerprofil
 * screens.
 */
export default function StartScreen() {
  const { t } = useTranslation('start');
  const { t: tCommon } = useTranslation('common');
  const { group, user } = useAuth();
  const features = useFeatures();
  const queryClient = useQueryClient();

  const upcoming = useQuery({
    queryKey: ['fixtures', group?.id, 'upcoming'],
    queryFn: () => api.listFixtures(group!.id, 'upcoming'),
    enabled: Boolean(group),
  });
  const nextFixture = upcoming.data?.docs[0];

  // Tracks only an explicit pull-to-refresh — kept separate from
  // upcoming.isFetching, which also flips true whenever an RSVP tap
  // invalidates ['fixtures', ...] in the background. Binding RefreshControl
  // to that instead made the native refresh spinner (and a scroll bounce)
  // pop in on every RSVP tap, not just an actual pull-down.
  const [isRefreshing, setIsRefreshing] = useState(false);
  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await upcoming.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  const summary = useQuery({
    queryKey: ['fixture-summary', nextFixture?.id],
    queryFn: () => api.fixtureSummary(nextFixture!.id),
    enabled: Boolean(nextFixture) && features.rsvp,
  });

  // Optimistic RSVP (implementation-plan.md §4.4): "Bin dabei"/"Kann nicht"
  // should feel instant, no spinner, same as the prototype's plain
  // setState. `onMutate` writes the new status (and an adjusted yesCount)
  // straight into the ['fixture-summary', ...] cache before the request
  // even lands; `onError` rolls that back; `onSuccess` reconciles yesCount
  // with the server's own count (still authoritative — other members'
  // RSVPs aren't reflected in our optimistic guess).
  const rsvpMutation = useMutation({
    mutationFn: (status: 'yes' | 'no') => api.setRsvp(nextFixture!.id, status),
    onMutate: async (status) => {
      if (!nextFixture) return undefined;
      const summaryKey = ['fixture-summary', nextFixture.id];
      await queryClient.cancelQueries({ queryKey: summaryKey });
      const previousSummary = queryClient.getQueryData<api.ApiRsvpSummary>(summaryKey);
      const previousStatus = previousSummary?.myStatus ?? null;
      const previousCount = previousSummary?.yesCount ?? nextFixture.rsvpYesCount ?? 0;
      let nextCount = previousCount;
      if (previousStatus !== status) {
        if (status === 'yes') nextCount += 1;
        else if (previousStatus === 'yes') nextCount -= 1;
      }
      queryClient.setQueryData<api.ApiRsvpSummary>(summaryKey, {
        myStatus: status,
        yesCount: Math.max(0, nextCount),
      });
      return { previousSummary, summaryKey };
    },
    onError: (_err, _status, context) => {
      if (context?.summaryKey) queryClient.setQueryData(context.summaryKey, context.previousSummary);
    },
    onSuccess: (data, _status, context) => {
      if (context?.summaryKey) {
        queryClient.setQueryData<api.ApiRsvpSummary>(context.summaryKey, (old) => ({
          myStatus: old?.myStatus ?? null,
          yesCount: data.yesCount,
        }));
      }
      queryClient.invalidateQueries({ queryKey: ['fixtures', group?.id] });
    },
  });

  function respond(status: 'yes' | 'no') {
    if (!nextFixture) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    rsvpMutation.mutate(status);
  }

  const capacity = (typeof nextFixture?.hall === 'object' && nextFixture.hall?.capacity) || 16;
  const yesCount = summary.data?.yesCount ?? nextFixture?.rsvpYesCount ?? 0;
  const attendancePct = Math.min(100, Math.round((yesCount / capacity) * 100));

  // Resolve "the active season" the exact same way Spielerprofil does —
  // client-side, from the group's season list — rather than omitting
  // `season` and letting the server fall back to its own `getActiveSeason`
  // lookup. The two are only guaranteed to agree if a group never ends up
  // with more than one season flagged `active` at once; passing the same
  // explicit id Spielerprofil resolves to removes that whole class of
  // discrepancy instead of relying on the invariant always holding.
  const seasons = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });
  const activeSeasonId = seasons.data?.docs.find((s) => s.status === 'active')?.id;

  // My season tiles + last-5 form (implementation-plan.md §4.5) — same
  // `/api/players/:id/profile` Spielerprofil already uses ("Mein
  // Spielerprofil" call site), just for the signed-in user, explicit
  // active-season id (see above). Query key deliberately mirrors
  // Spielerprofil's own (`['player-profile', playerId, kind, groupId,
  // seasonId]`) rather than a screen-local key — `ergebnis.tsx`'s
  // save-result mutation only invalidates the `'player-profile'` prefix,
  // so a differently-named key here would silently go stale on this
  // screen after every new result while Spielerprofil/Statistik
  // refreshed fine.
  const myProfile = useQuery({
    queryKey: ['player-profile', user?.id, 'users', group?.id, activeSeasonId],
    queryFn: () => api.getPlayerProfile(user!.id, group!.id, 'users', activeSeasonId),
    enabled: Boolean(user && group) && seasons.isSuccess,
  });
  const goalDiffColor = (myProfile.data?.season.goalDiff ?? 0) >= 0 ? colors.green : colors.red;
  const goalDiffLabel = myProfile.data
    ? myProfile.data.season.goalDiff > 0
      ? `+${myProfile.data.season.goalDiff}`
      : String(myProfile.data.season.goalDiff)
    : '0';

  // Last recorded game's score — same `listFixtures(..., 'played')` shape
  // Termine's past-fixtures section already fetches; sorted ascending by
  // date (§4.4's query key convention), so the most recent played fixture
  // is the last entry rather than the first (unlike `nextFixture` above).
  const played = useQuery({
    queryKey: ['fixtures', group?.id, 'played'],
    queryFn: () => api.listFixtures(group!.id, 'played'),
    enabled: Boolean(group),
  });
  const lastPlayed = played.data?.docs[played.data.docs.length - 1];

  // Top-3 scorers — same `/api/stats` endpoint Statistik uses
  // (`scope=season&metric=tore`), just the first 3 ranked rows rather than
  // the full podium + list.
  const topScorers = useQuery({
    queryKey: ['stats', group?.id, 'season', 'tore'],
    queryFn: () => api.getStats(group!.id, 'season', 'tore'),
    enabled: Boolean(group),
  });

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl tintColor={colors.dim} refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <ScreenHeader eyebrow={t('eyebrow')} title={t('title')} />
      <VStack className="gap-4 px-5 pt-4">
        <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('nextFixture')}</Text>

        {nextFixture ? (
          <Pressable
            onPress={() => router.push(`/(app)/(tabs)/termine/${nextFixture.id}`)}
            className="rounded-[22px] border border-hairline bg-bg-card p-5 active:opacity-90"
          >
            <HStack className="items-start justify-between">
              <VStack className="gap-1">
                <Text className="font-heading uppercase text-ink" style={{ fontSize: 22, lineHeight: 24 }}>
                  {tCommon(`weekdaysLong.${WEEKDAY_KEYS[fixtureDateTime(nextFixture).getUTCDay()]}`)}
                </Text>
                <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
                  {new Date(nextFixture.date).getUTCDate()}. {tCommon(`monthsShort.${MONTH_KEYS[new Date(nextFixture.date).getUTCMonth()]}`)} ·{' '}
                  {nextFixture.time}{tCommon('time.suffix')}
                  {typeof nextFixture.hall === 'object' && nextFixture.hall?.name ? ` · ${nextFixture.hall.name}` : ''}
                </Text>
              </VStack>
              <VStack className="items-end gap-1">
                <Text className="font-body-semibold text-green" style={{ fontSize: 12.5 }}>
                  {countdownLabel(fixtureDateTime(nextFixture), t)}
                </Text>
                {!features.rsvp && <ChevronForwardIcon color={colors.dim} />}
              </VStack>
            </HStack>

            {features.rsvp && (
              <VStack className="mt-4 gap-3">
                <Box className="h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                  <Box className="h-full rounded-full bg-green" style={{ width: `${attendancePct}%` }} />
                </Box>
                <HStack className="gap-2.5">
                  <Pressable
                    onPress={() => respond('yes')}
                    className="flex-1 items-center rounded-[13px] py-3"
                    style={{
                      backgroundColor: summary.data?.myStatus === 'yes' ? colors.green : colors.bgSunken,
                    }}
                  >
                    <Text
                      className="font-body-bold"
                      style={{ fontSize: 14, color: summary.data?.myStatus === 'yes' ? '#fff' : colors.ink }}
                    >
                      {t('rsvp.yes')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respond('no')}
                    className="flex-1 items-center rounded-[13px] border py-3"
                    style={{
                      borderColor: summary.data?.myStatus === 'no' ? colors.red : colors.hairline,
                      backgroundColor: summary.data?.myStatus === 'no' ? 'rgba(226,59,59,0.12)' : 'transparent',
                    }}
                  >
                    <Text
                      className="font-body-semibold"
                      style={{ fontSize: 14, color: summary.data?.myStatus === 'no' ? colors.red : colors.muted }}
                    >
                      {t('rsvp.no')}
                    </Text>
                  </Pressable>
                </HStack>
              </VStack>
            )}
          </Pressable>
        ) : (
          <Box className="rounded-[22px] border border-hairline bg-bg-card p-5 items-center">
            {upcoming.isLoading ? (
              <Spinner />
            ) : (
              <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
                {t('none')}
              </Text>
            )}
          </Box>
        )}

        {myProfile.isLoading ? (
          <Box className="items-center py-2">
            <Spinner />
          </Box>
        ) : myProfile.isError ? (
          <Text className="font-body text-red" style={{ fontSize: 12.5 }}>
            {String((myProfile.error as Error)?.message ?? myProfile.error)}
          </Text>
        ) : myProfile.data ? (
          <VStack className="gap-2.5">
            <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">
              {t('myStats.title', { label: myProfile.data.season.label })}
            </Text>
            <HStack className="gap-2.5">
              <StatTile label={t('myStats.played')} value={String(myProfile.data.season.played)} />
              <StatTile label={t('myStats.goals')} value={String(myProfile.data.season.goals)} valueColor={colors.gold} />
              <StatTile label={t('myStats.quote')} value={`${myProfile.data.season.quote}%`} valueColor={colors.green} />
              <StatTile label={t('myStats.goalDiff')} value={goalDiffLabel} valueColor={goalDiffColor} />
            </HStack>
          </VStack>
        ) : null}

        <VStack className="gap-2">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('myForm.title')}</Text>
          <FormPills results={myProfile.data?.form ?? []} emptyLabel={t('myForm.empty')} />
        </VStack>

        {lastPlayed ? (
          <Pressable
            onPress={() => router.push(`/(app)/(tabs)/termine/${lastPlayed.id}`)}
            className="flex-row items-center justify-between rounded-[18px] border border-hairline bg-bg-card px-4 py-3.5 active:opacity-85"
          >
            <VStack className="gap-0.5">
              <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('lastGame.title')}</Text>
              <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
                {new Date(lastPlayed.date).getUTCDate()}. {tCommon(`monthsShort.${MONTH_KEYS[new Date(lastPlayed.date).getUTCMonth()]}`)}
              </Text>
            </VStack>
            <Text className="font-heading text-ink" style={{ fontSize: 22 }}>
              {lastPlayed.redScore}:{lastPlayed.greenScore}
            </Text>
          </Pressable>
        ) : null}

        {topScorers.data && topScorers.data.rows.length > 0 && (
          <VStack className="gap-2.5">
            <HStack className="items-center justify-between">
              <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('topScorers.title')}</Text>
              <Pressable onPress={() => router.push('/(app)/(tabs)/statistik')}>
                <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 13 }}>
                  {tCommon('seeAll')}
                </Text>
              </Pressable>
            </HStack>
            <VStack className="rounded-[16px] border border-hairline bg-bg-card">
              {topScorers.data.rows.slice(0, 3).map((row, index) => (
                <Pressable
                  key={row.playerId}
                  onPress={() => router.push(`/spieler/${row.playerId}?kind=${row.playerKind}`)}
                  className="flex-row items-center gap-3 px-4 py-3 active:opacity-80"
                  style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.hairline } : undefined}
                >
                  <Text className="font-heading text-dim" style={{ fontSize: 15, width: 20 }}>
                    {row.rank}
                  </Text>
                  <Text className="font-body-semibold text-ink flex-1" style={{ fontSize: 14 }} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text className="font-body-bold" style={{ fontSize: 14, color: colors.gold }}>
                    {row.valueLabel}
                  </Text>
                </Pressable>
              ))}
            </VStack>
          </VStack>
        )}
      </VStack>
    </ScrollView>
  );
}
