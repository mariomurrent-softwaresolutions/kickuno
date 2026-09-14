import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ApiStatsMetric } from '@/lib/api';
import { colors } from '@/theme/tokens';

// Podium ring colors — presentation-only (rank → gold/silver/bronze),
// derived client-side from `podium[].rank` per implementation-plan.md §6.
// Silver/bronze aren't in theme/tokens.ts since nothing else uses them.
const PODIUM_RING: Record<1 | 2 | 3, string> = {
  1: colors.gold,
  2: '#C7CFCB',
  3: '#C98A55',
};
const PODIUM_BAR_HEIGHT: Record<1 | 2 | 3, number> = { 1: 92, 2: 70, 3: 56 };
// Left-to-right display order — silver, gold, bronze — matches the
// prototype's podium layout.
const PODIUM_DISPLAY_ORDER: (1 | 2 | 3)[] = [2, 1, 3];

/**
 * Statistik — Saison/All-Time toggle + 8 metric chips + podium + ranked
 * list (implementation-plan.md §4.5/§6). Independent of every feature flag
 * (§4.6). Tapping the podium or any row opens that player's Spielerprofil —
 * `playerKind` (§3.7, phase 6 — a row can now be a real member or an
 * imported `legacyPlayers` ghost profile) is passed along as a query param
 * so Spielerprofil knows which endpoint/shape to expect.
 *
 * Season-management feature plan §A: when `scope === 'season'`, a season
 * picker (chip row, same visual language as the metric chips below it)
 * lets a member view any of the group's seasons, not just whichever is
 * currently active — "statistics for each season and overall statistics"
 * (the latter is `scope === 'alltime'`, unaffected, already spanning every
 * season by design).
 *
 * The season-overview card, records, and all-time Hall of Fame
 * (`feature-plan-stats-enhancements.md` §A/§B) originally lived at the top
 * of this screen too, but that crowded a screen that was already doing a
 * lot — they now live on their own pushed screen (`uebersicht.tsx`),
 * reachable via the "Saison-Übersicht" row below.
 */
export default function StatistikScreen() {
  const { group } = useAuth();
  const [scope, setScope] = useState<'season' | 'alltime'>('season');
  const [metric, setMetric] = useState<ApiStatsMetric>('tore');
  // `null` means "no explicit choice yet — use whichever season is active".
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  // Tracks only an explicit pull-to-refresh — kept separate from
  // statsQuery.isFetching, which also flips true on every background
  // refetch caused by switching a chip. Wiring RefreshControl to that
  // instead made the native refresh spinner pop in (and the ScrollView
  // bounce) on every metric/scope tap, not just an actual pull-down.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const seasonsQuery = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });

  const seasons = seasonsQuery.data?.docs ?? [];
  const activeSeason = seasons.find((s) => s.status === 'active') ?? null;
  const effectiveSeasonId = selectedSeasonId ?? activeSeason?.id;

  const statsQuery = useQuery({
    queryKey: ['stats', group?.id, scope, metric, scope === 'season' ? effectiveSeasonId : null],
    queryFn: () => api.getStats(group!.id, scope, metric, scope === 'season' ? effectiveSeasonId : undefined),
    enabled: Boolean(group) && (scope === 'alltime' || Boolean(effectiveSeasonId)),
    // Keep showing the previous metric's data while the next one loads so
    // toggling chips doesn't collapse the podium/rows down to a spinner and
    // snap back — that layout jump is what read as "the page moving".
    placeholderData: (previousData) => previousData,
  });

  const podiumByRank = new Map((statsQuery.data?.podium ?? []).map((p) => [p.rank, p]));

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([statsQuery.refetch(), seasonsQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [statsQuery, seasonsQuery]);

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          tintColor={colors.dim}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
        />
      }
    >
      <ScreenHeader eyebrow="STATISTIK" title="Rangliste" />
      <VStack className="gap-5 px-5 pt-4">
        <Pressable
          onPress={() => router.push('/(app)/(tabs)/statistik/uebersicht')}
          className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5 active:opacity-85"
        >
          <VStack className="flex-1 gap-0.5 pr-3">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 14 }}>
              Saison-Übersicht
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 12 }}>
              Spieltage, Tore, Rekorde und die Hall of Fame.
            </Text>
          </VStack>
          <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 13 }}>
            ›
          </Text>
        </Pressable>

        <HStack className="rounded-full border border-hairline bg-bg-card p-1">
          {(['season', 'alltime'] as const).map((s) => {
            const active = scope === s;
            return (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                className="flex-1 items-center rounded-full py-2.5"
                style={{ backgroundColor: active ? colors.bgSunken : 'transparent' }}
              >
                <Text className="font-body-semibold" style={{ fontSize: 13, color: active ? colors.ink : colors.muted }}>
                  {s === 'season' ? 'Saison' : 'All-Time'}
                </Text>
              </Pressable>
            );
          })}
        </HStack>

        {scope === 'season' && seasons.length > 0 && (
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
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
        >
          {api.STATS_METRICS.map(({ key, label }) => {
            const active = metric === key;
            return (
              <Pressable
                key={key}
                onPress={() => setMetric(key)}
                className="rounded-full border px-4 py-2"
                style={{
                  borderColor: active ? colors.gold : colors.hairline,
                  backgroundColor: active ? 'rgba(244,211,94,0.12)' : colors.bgCard,
                }}
              >
                <Text className="font-body-semibold" style={{ fontSize: 13, color: active ? colors.gold : colors.ink }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {statsQuery.data && statsQuery.data.podium.length > 0 && (
          <HStack className="items-end justify-center gap-3 pt-2">
            {PODIUM_DISPLAY_ORDER.map((rank) => {
              const entry = podiumByRank.get(rank);
              if (!entry) return <Box key={rank} style={{ width: 88 }} />;
              return (
                <Pressable
                  key={rank}
                  onPress={() => router.push(`/spieler/${entry.playerId}?kind=${entry.playerKind}`)}
                  className="items-center gap-2 active:opacity-85"
                  style={{ width: 88 }}
                >
                  <Box
                    className="items-center justify-center rounded-full"
                    style={{ width: 52, height: 52, borderWidth: 2.5, borderColor: PODIUM_RING[rank] }}
                  >
                    <Text className="font-heading text-ink" style={{ fontSize: 17 }}>
                      {entry.initials ?? entry.firstName.slice(0, 2).toUpperCase()}
                    </Text>
                  </Box>
                  <Text className="font-body-semibold text-ink" style={{ fontSize: 12 }} numberOfLines={1}>
                    {entry.firstName}
                  </Text>
                  <VStack
                    className="w-full items-center justify-end rounded-t-[10px] border border-b-0 border-hairline bg-bg-card"
                    style={{ height: PODIUM_BAR_HEIGHT[rank] }}
                  >
                    <Text className="font-heading pb-2" style={{ fontSize: 15, color: PODIUM_RING[rank] }}>
                      {entry.valueLabel}
                    </Text>
                  </VStack>
                </Pressable>
              );
            })}
          </HStack>
        )}

        <VStack className="gap-2">
          {statsQuery.isLoading ? (
            <Spinner />
          ) : statsQuery.data?.rows.length ? (
            statsQuery.data.rows.map((row) => (
              <Pressable
                key={row.playerId}
                onPress={() => router.push(`/spieler/${row.playerId}?kind=${row.playerKind}`)}
                className="overflow-hidden rounded-[14px] border border-hairline bg-bg-card px-4 py-3 active:opacity-90"
              >
                <Box
                  className="absolute bottom-0 left-0 top-0"
                  style={{ width: `${row.pct}%`, backgroundColor: 'rgba(244,211,94,0.08)' }}
                />
                <HStack className="items-center justify-between">
                  <HStack className="flex-1 items-center gap-3 pr-3">
                    <Text className="font-heading text-dim" style={{ fontSize: 15, width: 20 }}>
                      {row.rank}
                    </Text>
                    <VStack className="flex-1 gap-0.5">
                      <Text className="font-body-semibold text-ink" style={{ fontSize: 14 }} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text className="font-body text-muted" style={{ fontSize: 11.5 }} numberOfLines={1}>
                        {row.sub}
                      </Text>
                    </VStack>
                  </HStack>
                  <Text className="font-heading text-ink" style={{ fontSize: 16 }}>
                    {row.valueLabel}
                  </Text>
                </HStack>
              </Pressable>
            ))
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              Noch keine Daten.
            </Text>
          )}
        </VStack>
      </VStack>
    </ScrollView>
  );
}
