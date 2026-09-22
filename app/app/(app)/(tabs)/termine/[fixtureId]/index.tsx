import { useState } from 'react';
import { Alert, RefreshControl, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatTile } from '@/components/ui/stat-tile';
import { PlayerChip } from '@/components/ui/player-chip';
import { useAuth } from '@/lib/auth-context';
import { useFeatures } from '@/lib/features-context';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

/**
 * Termin-Detail — team builder (implementation-plan.md §4.5). Auto-balance
 * and manual assign/unassign are admin/organizer-only client-side (§3.4);
 * the backend enforces the same restriction independently (defense in
 * depth, same pattern as the RSVP/feature-flag gates elsewhere).
 */
export default function TerminDetailScreen() {
  const { t } = useTranslation('terminDetail');
  const { t: tCommon } = useTranslation('common');
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const { membership, group } = useAuth();
  const teamOneName = group?.teamOneName ?? 'Rot';
  const teamTwoName = group?.teamTwoName ?? 'Grün';
  const features = useFeatures();
  const queryClient = useQueryClient();
  const canEdit = membership?.role === 'admin' || membership?.role === 'organizer';

  const [autoBalancing, setAutoBalancing] = useState(false);
  // Tracks only an explicit pull-to-refresh — see statistik/index.tsx's
  // comment on the same pattern. Clearing the lineup ("Zurücksetzen")
  // invalidates the lineup query in the background and used to pop the
  // native refresh spinner (and bounce the scroll) on its own.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fixtureQuery = useQuery({
    queryKey: ['fixture', fixtureId],
    queryFn: () => api.getFixture(fixtureId),
    enabled: Boolean(fixtureId),
  });
  const lineupQuery = useQuery({
    queryKey: ['lineup', fixtureId],
    queryFn: () => api.getLineup(fixtureId),
    enabled: Boolean(fixtureId),
  });
  const resultQuery = useQuery({
    queryKey: ['result', fixtureId],
    queryFn: () => api.getResult(fixtureId),
    enabled: Boolean(fixtureId),
  });

  const fixture = fixtureQuery.data;
  const lineup = lineupQuery.data;
  const hasResult = Boolean(resultQuery.data?.result);

  const lineupKey = ['lineup', fixtureId];

  /** Removes `playerId` from wherever it currently sits in a lineup snapshot. */
  function withoutPlayer(l: api.ApiLineup, playerId: string): api.ApiLineup {
    return {
      pool: l.pool.filter((p) => p.id !== playerId),
      red: l.red.filter((p) => p.id !== playerId),
      green: l.green.filter((p) => p.id !== playerId),
      notAttending: (l.notAttending ?? []).filter((p) => p.id !== playerId),
    };
  }

  // Optimistic assign/unassign (implementation-plan.md §4.4: "moving a
  // player between red/green/pool" should feel instant, like the
  // prototype's plain setState). `onMutate` moves the chip in the
  // ['lineup', fixtureId] cache immediately; `onError` rolls back to the
  // pre-move snapshot; `onSuccess` swaps in the server's own recomputed
  // lineup (already returned by `PATCH .../lineup` — no separate
  // invalidate+refetch needed).
  const assignMutation = useMutation({
    mutationFn: ({ playerId, team }: { playerId: string; team: 'red' | 'green' | 'none' | null }) =>
      api.assignLineupPlayer(fixtureId, playerId, team),
    onMutate: async ({ playerId, team }) => {
      await queryClient.cancelQueries({ queryKey: lineupKey });
      const previous = queryClient.getQueryData<api.ApiLineup>(lineupKey);
      if (previous) {
        const player = [...previous.pool, ...previous.red, ...previous.green, ...(previous.notAttending ?? [])].find(
          (p) => p.id === playerId
        );
        if (player) {
          const next = withoutPlayer(previous, playerId);
          if (team === 'red') next.red = [...next.red, player];
          else if (team === 'green') next.green = [...next.green, player];
          // 'none' ("Nicht dabei") — declines the player's RSVP server-side
          // (Fixtures.ts's PATCH .../lineup handler), so optimistically
          // reflect that as an explicit "Abgesagt" row rather than
          // guessing — `onSuccess` below reconciles with the server's own
          // recomputed `notAttending` list either way.
          else if (team === 'none') next.notAttending = [...next.notAttending, { ...player, rsvpStatus: 'no' as const }];
          else next.pool = [...next.pool, player];
          queryClient.setQueryData(lineupKey, next);
        }
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(lineupKey, context.previous);
      // Previously silent — a rejected assign (e.g. "Nicht dabei" while
      // `features.rsvp` is off, or a stale server not yet aware of the
      // `team: 'none'` action) just reverted the optimistic move with no
      // feedback, which reads as "the button does nothing." Surfacing the
      // server's own message at least makes a real failure visible instead
      // of silently no-op'ing.
      const message = err instanceof api.ApiError ? err.message : t('error.generic');
      Alert.alert(t('error.title'), message);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(lineupKey, data);
      // Assigning a player who was in "Nicht dabei" marks their RSVP as
      // 'yes' server-side (Fixtures.ts's PATCH .../lineup handler) — that
      // changes the Zusagen count/attendance bar on the Start screen and
      // the Termine list, and neither lives under ['lineup', ...], so they
      // need their own invalidation or they'd keep showing the old count.
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['fixture-summary', fixtureId] });
    },
  });

  function assign(playerId: string, team: 'red' | 'green' | 'none' | null) {
    assignMutation.mutate({ playerId, team });
  }

  const busyPlayerId = assignMutation.isPending ? (assignMutation.variables?.playerId ?? null) : null;

  // Same optimistic idea as `assignMutation`, just for the bulk "clear
  // everyone back to the pool" action — one instant cache update instead
  // of waiting on N sequential unassigns. The requests themselves still
  // run sequentially (`mutationFn`, unchanged from before) since a
  // mid-batch failure should leave a known partial server state rather
  // than racing; `onSettled` reconciles the cache with the server
  // afterward regardless of how far the batch got.
  const clearAllMutation = useMutation({
    mutationFn: async () => {
      if (!lineup) return;
      for (const p of [...lineup.red, ...lineup.green]) {
        // eslint-disable-next-line no-await-in-loop
        await api.assignLineupPlayer(fixtureId, p.id, null);
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: lineupKey });
      const previous = queryClient.getQueryData<api.ApiLineup>(lineupKey);
      if (previous) {
        queryClient.setQueryData<api.ApiLineup>(lineupKey, {
          pool: [...previous.pool, ...previous.red, ...previous.green],
          red: [],
          green: [],
          notAttending: previous.notAttending ?? [],
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(lineupKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: lineupKey });
    },
  });

  function clearAll() {
    clearAllMutation.mutate();
  }

  async function autoBalance() {
    setAutoBalancing(true);
    try {
      const data = await api.autoBalanceLineup(fixtureId);
      queryClient.setQueryData(lineupKey, data);
    } finally {
      setAutoBalancing(false);
    }
  }

  // Requested: mark a fixture as skipped when there aren't enough
  // players — takes it out of "upcoming" (so it stops being the Start
  // screen's next fixture) without pretending a result was recorded.
  // Same admin/organizer-only gate as every other mutating action here;
  // the backend enforces it independently too.
  const skipMutation = useMutation({
    mutationFn: () => api.skipFixture(fixtureId),
    onSuccess: ({ doc }) => {
      queryClient.setQueryData(['fixture', fixtureId], doc);
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
    },
    onError: (err) => {
      const message = err instanceof api.ApiError ? err.message : t('error.generic');
      Alert.alert(t('error.title'), message);
    },
  });

  const unskipMutation = useMutation({
    mutationFn: () => api.unskipFixture(fixtureId),
    onSuccess: ({ doc }) => {
      queryClient.setQueryData(['fixture', fixtureId], doc);
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
    },
    onError: (err) => {
      const message = err instanceof api.ApiError ? err.message : t('error.generic');
      Alert.alert(t('error.title'), message);
    },
  });

  const zusagenCount = lineup ? lineup.pool.length + lineup.red.length + lineup.green.length : 0;
  const eingeteiltCount = lineup ? lineup.red.length + lineup.green.length : 0;
  const balance =
    lineup && features.strength
      ? lineup.red.reduce((sum, p) => sum + (p.strength ?? 0), 0) -
        lineup.green.reduce((sum, p) => sum + (p.strength ?? 0), 0)
      : null;

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await Promise.all([fixtureQuery.refetch(), lineupQuery.refetch(), resultQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  const fixtureDate = fixture ? new Date(fixture.date) : null;
  const title = fixtureDate
    ? `${tCommon(`weekdaysAbbr.${WEEKDAY_KEYS[fixtureDate.getUTCDay()]}`)}, ${fixtureDate.getUTCDate()}. ${tCommon(`monthsShort.${MONTH_KEYS[fixtureDate.getUTCMonth()]}`)}`
    : '…';

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl tintColor={colors.dim} refreshing={isRefreshing} onRefresh={handleRefresh} />
      }
    >
      <ScreenHeader eyebrow={t('eyebrow')} title={title} onBack={() => router.back()} />

      <VStack className="gap-5 px-5 pt-4">
        {fixture && (
          <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
            {fixture.time}{tCommon('time.suffix')}
            {typeof fixture.hall === 'object' && fixture.hall?.name ? ` · ${fixture.hall.name}` : ''}
          </Text>
        )}

        {fixture?.status === 'skipped' && (
          <HStack
            className="items-center self-start rounded-[10px] px-2.5 py-1"
            style={{ backgroundColor: colors.bgSunken }}
          >
            <Text className="font-body-semibold text-dim" style={{ fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' }}>
              {t('skip.badge')}
            </Text>
          </HStack>
        )}

        {hasResult && resultQuery.data?.result ? (
          <Text className="font-heading text-green" style={{ fontSize: 30 }}>
            {resultQuery.data.result.redScore}:{resultQuery.data.result.greenScore}
          </Text>
        ) : null}

        <HStack className="gap-2.5">
          <StatTile label={t('stats.rsvps')} value={String(zusagenCount)} />
          <StatTile label={t('stats.assigned')} value={String(eingeteiltCount)} />
          {features.strength && (
            <StatTile
              label={t('stats.balance')}
              value={balance !== null ? (balance > 0 ? `+${balance}` : String(balance)) : '–'}
              valueColor={balance !== null && Math.abs(balance) <= 1 ? colors.green : colors.gold}
            />
          )}
        </HStack>

        {canEdit && (
          <HStack className="gap-2.5">
            {features.autoBalance && (
              <Pressable
                onPress={autoBalance}
                disabled={autoBalancing}
                className="flex-1 items-center rounded-[13px] bg-green py-3 active:opacity-90"
              >
                <Text className="font-body-bold" style={{ fontSize: 13.5, color: '#07120C' }}>
                  {autoBalancing ? t('autoBalance.loading') : t('autoBalance.action')}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={clearAll}
              disabled={clearAllMutation.isPending || eingeteiltCount === 0}
              className="flex-1 items-center rounded-[13px] border py-3 active:opacity-80"
              style={{ borderColor: colors.hairline }}
            >
              <Text className="font-body-semibold text-muted" style={{ fontSize: 13.5 }}>
                {clearAllMutation.isPending ? t('clearAll.loading') : t('clearAll.action')}
              </Text>
            </Pressable>
          </HStack>
        )}

        {canEdit && fixture?.status === 'upcoming' && (
          <Pressable
            onPress={() => skipMutation.mutate()}
            disabled={skipMutation.isPending}
            className="items-center rounded-[13px] border py-3 active:opacity-80"
            style={{ borderColor: colors.hairline }}
          >
            <Text className="font-body-semibold text-dim" style={{ fontSize: 13.5 }}>
              {skipMutation.isPending ? t('skip.loading') : t('skip.action')}
            </Text>
          </Pressable>
        )}

        {canEdit && fixture?.status === 'skipped' && (
          <Pressable
            onPress={() => unskipMutation.mutate()}
            disabled={unskipMutation.isPending}
            className="items-center rounded-[13px] border py-3 active:opacity-80"
            style={{ borderColor: colors.hairline }}
          >
            <Text className="font-body-semibold text-muted" style={{ fontSize: 13.5 }}>
              {unskipMutation.isPending ? t('skip.unskipLoading') : t('skip.unskipAction')}
            </Text>
          </Pressable>
        )}

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-red" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            {teamOneName}
          </Text>
          <HStack className="flex-wrap gap-2">
            {lineup?.red.length ? (
              lineup.red.map((p) => (
                <PlayerChip
                  key={p.id}
                  name={p.name}
                  nickname={p.nickname}
                  strength={features.strength ? p.strength : undefined}
                  tint="red"
                  onPress={canEdit ? () => assign(p.id, null) : undefined}
                />
              ))
            ) : (
              <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
                {t('noOneAssigned')}
              </Text>
            )}
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-green" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            {teamTwoName}
          </Text>
          <HStack className="flex-wrap gap-2">
            {lineup?.green.length ? (
              lineup.green.map((p) => (
                <PlayerChip
                  key={p.id}
                  name={p.name}
                  nickname={p.nickname}
                  strength={features.strength ? p.strength : undefined}
                  tint="green"
                  onPress={canEdit ? () => assign(p.id, null) : undefined}
                />
              ))
            ) : (
              <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
                {t('noOneAssigned')}
              </Text>
            )}
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-dim" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            {t('unassigned.title')}
          </Text>
          {lineup?.pool.length ? (
            <VStack className="gap-2">
              {lineup.pool.map((p) => (
                <HStack
                  key={p.id}
                  className="items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-3 py-2.5"
                >
                  <HStack className="items-center gap-2">
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13.5 }}>
                      {p.name}
                    </Text>
                    {p.nickname ? (
                      <Text className="font-body text-muted-soft" style={{ fontSize: 11.5 }}>
                        „{p.nickname}“
                      </Text>
                    ) : null}
                    {features.strength && typeof p.strength === 'number' ? (
                      <Text className="font-body text-muted" style={{ fontSize: 11.5 }}>
                        ★{p.strength}
                      </Text>
                    ) : null}
                  </HStack>
                  {canEdit && (
                    <HStack className="gap-2">
                      <Pressable
                        onPress={() => assign(p.id, 'red')}
                        disabled={busyPlayerId === p.id}
                        className="rounded-[10px] px-3 py-1.5"
                        style={{ backgroundColor: 'rgba(226,59,59,0.14)' }}
                      >
                        <Text className="font-body-semibold text-red" style={{ fontSize: 12 }}>
                          {teamOneName}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => assign(p.id, 'green')}
                        disabled={busyPlayerId === p.id}
                        className="rounded-[10px] px-3 py-1.5"
                        style={{ backgroundColor: 'rgba(47,191,110,0.14)' }}
                      >
                        <Text className="font-body-semibold text-green" style={{ fontSize: 12 }}>
                          {teamTwoName}
                        </Text>
                      </Pressable>
                      {features.rsvp && (
                        <Pressable
                          onPress={() => assign(p.id, 'none')}
                          disabled={busyPlayerId === p.id}
                          className="rounded-[10px] px-3 py-1.5"
                          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                        >
                          <Text className="font-body-semibold text-muted" style={{ fontSize: 12 }}>
                            {t('notAttendingAction')}
                          </Text>
                        </Pressable>
                      )}
                    </HStack>
                  )}
                </HStack>
              ))}
            </VStack>
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
              {features.rsvp ? t('unassigned.emptyRsvp') : t('unassigned.emptyNoRsvp')}
            </Text>
          )}
        </VStack>

        {canEdit && Boolean(lineup?.notAttending?.length) && (
          <VStack className="gap-2.5">
            <Text className="font-body-semibold text-dim" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
              {t('notAttending.title')}
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 12 }}>
              {t('notAttending.description')}
            </Text>
            <VStack className="gap-2">
              {(lineup?.notAttending ?? []).map((p) => (
                <HStack
                  key={p.id}
                  className="items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-3 py-2.5"
                >
                  <HStack className="items-center gap-2">
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13.5 }}>
                      {p.name}
                    </Text>
                    {p.nickname ? (
                      <Text className="font-body text-muted-soft" style={{ fontSize: 11.5 }}>
                        „{p.nickname}“
                      </Text>
                    ) : null}
                    <Text className="font-body text-muted-soft" style={{ fontSize: 11.5 }}>
                      {p.rsvpStatus === 'no' ? t('notAttending.declined') : t('notAttending.noResponse')}
                    </Text>
                  </HStack>
                  <HStack className="gap-2">
                    <Pressable
                      onPress={() => assign(p.id, 'red')}
                      disabled={busyPlayerId === p.id}
                      className="rounded-[10px] px-3 py-1.5"
                      style={{ backgroundColor: 'rgba(226,59,59,0.14)' }}
                    >
                      <Text className="font-body-semibold text-red" style={{ fontSize: 12 }}>
                        {teamOneName}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => assign(p.id, 'green')}
                      disabled={busyPlayerId === p.id}
                      className="rounded-[10px] px-3 py-1.5"
                      style={{ backgroundColor: 'rgba(47,191,110,0.14)' }}
                    >
                      <Text className="font-body-semibold text-green" style={{ fontSize: 12 }}>
                        {teamTwoName}
                      </Text>
                    </Pressable>
                  </HStack>
                </HStack>
              ))}
            </VStack>
          </VStack>
        )}

        <Pressable
          onPress={() => router.push(`/(app)/(tabs)/termine/${fixtureId}/ergebnis`)}
          className="items-center rounded-[16px] border border-hairline bg-bg-card py-4 active:opacity-85"
        >
          <Text className="font-body-bold text-ink" style={{ fontSize: 14.5 }}>
            {hasResult ? t('result.edit') : t('result.enter')}
          </Text>
        </Pressable>
      </VStack>
    </ScrollView>
  );
}
