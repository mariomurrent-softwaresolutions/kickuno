import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ApiAllTimeRecords, ApiDuoStanding, ApiMatchExtreme, ApiSeasonSummary } from '@/lib/api';
import { colors } from '@/theme/tokens';

/**
 * Saison-Übersicht — split off the Statistik/Rangliste screen (§A/§B of
 * `claude/feature-plan-stats-enhancements.md`) once that screen got
 * crowded with the season-overview card, records, and the all-time Hall
 * of Fame on top of the pre-existing toggle/chips/podium/ranked list.
 * Reachable from a single entry-point row at the top of Statistik —
 * same pushed-screen pattern as Gruppe → Einstellungen's "Hallen
 * verwalten"/"Saisons verwalten" rows.
 *
 * Deliberately keeps its own Saison/All-Time toggle and season picker
 * rather than receiving scope/season as route params from the Rangliste
 * screen — the two screens' scopes are independent by design (you might
 * check this season's overview while leaving the leaderboard on
 * All-Time, or vice versa), and every value needed here (`getStatsSummary`,
 * the all-time `records` on `getStats`) was already scope/season-driven on
 * its own terms before the split.
 *
 * "Beste Duos" (§C) joined later — the pairs of players who win most
 * often when sharing a team, resolving that section's "profile-scoped vs.
 * group-wide leaderboard" open question in favor of the latter, shown
 * here rather than on Spielerprofil. It rides along on the same
 * `getStatsSummary()` response as `SeasonSummaryCard` (`bestDuos` is a
 * sibling field, scoped identically), so it needed no extra query.
 *
 * Each card has a `*Skeleton` counterpart shown while its query's
 * `isLoading` is true (first load only — not `isFetching`, which would
 * also flip true on every background refetch a scope/season switch
 * triggers; `placeholderData` already keeps the previous scope's card on
 * screen during those, so re-skeletonizing on every chip tap would be a
 * regression, not a fix) — otherwise a card renders nothing until its
 * query resolves and pops in unannounced, which read as "is this even
 * loading?" rather than as a loading state.
 */
export default function SaisonUebersichtScreen() {
  const { group } = useAuth();
  const [scope, setScope] = useState<'season' | 'alltime'>('season');
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  const seasonsQuery = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });

  const seasons = seasonsQuery.data?.docs ?? [];
  const activeSeason = seasons.find((s) => s.status === 'active') ?? null;
  const effectiveSeasonId = selectedSeasonId ?? activeSeason?.id;

  const summaryQuery = useQuery({
    queryKey: ['stats-summary', group?.id, scope, scope === 'season' ? effectiveSeasonId : null],
    queryFn: () => api.getStatsSummary(group!.id, scope === 'season' ? effectiveSeasonId : undefined),
    enabled: Boolean(group) && (scope === 'alltime' || Boolean(effectiveSeasonId)),
    placeholderData: (previousData) => previousData,
  });

  // Hall of Fame (§B) lives on the all-time ranked-list response's
  // `records` field (`scope=alltime`, any `metric` — it's the same
  // records regardless) rather than a dedicated endpoint; the metric
  // choice here is arbitrary since rows/podium are never rendered on this
  // screen.
  const allTimeRecordsQuery = useQuery({
    queryKey: ['stats', group?.id, 'alltime', 'tore', null],
    queryFn: () => api.getStats(group!.id, 'alltime', 'tore'),
    enabled: Boolean(group) && scope === 'alltime',
    placeholderData: (previousData) => previousData,
  });

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader eyebrow="STATISTIK" title="Übersicht" onBack={() => router.back()} />
      <VStack className="gap-5 px-5 pt-4">
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

        {summaryQuery.isLoading ? (
          <SeasonSummaryCardSkeleton />
        ) : summaryQuery.data ? (
          <SeasonSummaryCard summary={summaryQuery.data.summary} />
        ) : null}

        {summaryQuery.isLoading ? (
          <BesteDuosCardSkeleton />
        ) : summaryQuery.data?.bestDuos.length ? (
          <BesteDuosCard duos={summaryQuery.data.bestDuos} />
        ) : null}

        {scope === 'alltime' && allTimeRecordsQuery.isLoading ? (
          <HallOfFameCardSkeleton />
        ) : scope === 'alltime' && allTimeRecordsQuery.data?.records ? (
          <HallOfFameCard records={allTimeRecordsQuery.data.records} />
        ) : null}
      </VStack>
    </ScrollView>
  );
}

/**
 * Group/season-level overview card — `claude/
 * feature-plan-stats-enhancements.md` §A/§B. Four stat tiles, a Rot-vs-Grün
 * record row, and (when any exist) a season-scoped records section.
 */
function SeasonSummaryCard({ summary }: { summary: ApiSeasonSummary }) {
  const redRecord = `${summary.red.wins}S · ${summary.red.draws}U · ${summary.red.losses}N`;
  const greenRecord = `${summary.green.wins}S · ${summary.green.draws}U · ${summary.green.losses}N`;

  return (
    <VStack className="gap-3 rounded-[14px] border border-hairline bg-bg-card px-4 py-4">
      <HStack className="flex-wrap gap-4">
        <SummaryTile label="Spieltage" value={String(summary.playedCount)} />
        <SummaryTile label="Tore gesamt" value={String(summary.totalGoals)} />
        <SummaryTile label="Ø Tore/Spiel" value={summary.avgGoalsPerMatch.toFixed(1)} />
        <SummaryTile label="Ø Teilnehmer" value={summary.avgAttendance.toFixed(1)} />
      </HStack>

      {summary.playedCount > 0 ? (
        <HStack className="items-center justify-between gap-3 rounded-[10px] bg-bg-sunken px-3 py-2.5">
          <HStack className="items-center gap-2">
            <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red }} />
            <Text className="font-body-semibold text-ink" style={{ fontSize: 12.5 }}>
              Rot {redRecord}
            </Text>
          </HStack>
          <HStack className="items-center gap-2">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 12.5 }}>
              Grün {greenRecord}
            </Text>
            <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green }} />
          </HStack>
        </HStack>
      ) : (
        <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
          Noch keine gespielten Termine.
        </Text>
      )}

      {summary.records.biggestWin || summary.records.closestGame || summary.records.highestScoring ? (
        <VStack className="gap-1.5 border-t border-hairline pt-3">
          <Text className="font-body-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: 0.4 }}>
            REKORDE
          </Text>
          <RecordRow label="Kantersieg" extreme={summary.records.biggestWin} />
          <RecordRow label="Knappstes Spiel" extreme={summary.records.closestGame} />
          <RecordRow label="Torreichstes Spiel" extreme={summary.records.highestScoring} />
        </VStack>
      ) : null}
    </VStack>
  );
}

/** Loading placeholder matching `SeasonSummaryCard`'s shape — see the screen's own doc comment for when this is shown. */
function SeasonSummaryCardSkeleton() {
  return (
    <VStack className="gap-3 rounded-[14px] border border-hairline bg-bg-card px-4 py-4">
      <HStack className="flex-wrap gap-4">
        {[0, 1, 2, 3].map((i) => (
          <VStack key={i} className="gap-1.5" style={{ minWidth: 64 }}>
            <Skeleton width={36} height={20} />
            <Skeleton width={56} height={10} />
          </VStack>
        ))}
      </HStack>
      <Skeleton height={38} radius={10} />
      <VStack className="gap-2 border-t border-hairline pt-3">
        <Skeleton width={64} height={10} />
        <Skeleton height={15} />
        <Skeleton height={15} />
        <Skeleton height={15} />
      </VStack>
    </VStack>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <VStack className="gap-0.5" style={{ minWidth: 64 }}>
      <Text className="font-heading text-ink" style={{ fontSize: 20 }}>
        {value}
      </Text>
      <Text className="font-body text-muted" style={{ fontSize: 10.5 }}>
        {label}
      </Text>
    </VStack>
  );
}

/**
 * §C ("Beste Duos") — the top player pairs by win rate when sharing a
 * team. Named plainly rather than "Chemie"/"generelle Statistiken" —
 * every card on this screen already names what it shows (REKORDE, HALL OF
 * FAME); this one does too. Not pressable (unlike the Hall of Fame rows)
 * since a duo doesn't map to a single Spielerprofil to open.
 */
function BesteDuosCard({ duos }: { duos: ApiDuoStanding[] }) {
  return (
    <VStack className="gap-2.5 rounded-[14px] border border-hairline bg-bg-card px-4 py-4">
      <Text className="font-body-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: 0.4 }}>
        BESTE DUOS
      </Text>
      {duos.map((duo) => (
        <HStack key={`${duo.playerA.playerId}-${duo.playerB.playerId}`} className="items-center justify-between">
          <VStack className="flex-1 gap-0.5 pr-3">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 13 }} numberOfLines={1}>
              {duo.playerA.name} & {duo.playerB.name}
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 11 }}>
              {duo.wins}S · {duo.draws}U · {duo.losses}N zusammen
            </Text>
          </VStack>
          <Text className="font-heading text-gold" style={{ fontSize: 20 }}>
            {duo.winRate}%
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** Loading placeholder matching `BesteDuosCard`'s shape. */
function BesteDuosCardSkeleton() {
  return (
    <VStack className="gap-2.5 rounded-[14px] border border-hairline bg-bg-card px-4 py-4">
      <Skeleton width={80} height={10} />
      {[0, 1, 2].map((i) => (
        <HStack key={i} className="items-center justify-between">
          <VStack className="flex-1 gap-1.5 pr-3">
            <Skeleton width="65%" height={13} />
            <Skeleton width="45%" height={11} />
          </VStack>
          <Skeleton width={32} height={18} />
        </HStack>
      ))}
    </VStack>
  );
}

function fmtRecordDate(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function RecordRow({ label, extreme }: { label: string; extreme: ApiMatchExtreme | null }) {
  if (!extreme) return null;
  return (
    <HStack className="items-center justify-between">
      <Text className="font-body text-muted" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <HStack className="items-center gap-2">
        <Text className="font-body-semibold text-ink" style={{ fontSize: 12.5 }}>
          {extreme.redScore}:{extreme.greenScore}
        </Text>
        <Text className="font-body text-dim" style={{ fontSize: 11 }}>
          {fmtRecordDate(extreme.date)}
        </Text>
      </HStack>
    </HStack>
  );
}

/**
 * All-time-only "Hall of Fame" — `claude/feature-plan-stats-enhancements.md`
 * §B. Rendered only under the All-Time scope, right below the season
 * summary card; a season has no meaningful "longest win streak ever"
 * distinct from the existing `streak` metric, so this block is
 * deliberately all-time-only rather than season-scoped like `RecordRow`
 * above.
 */
function HallOfFameCard({ records }: { records: ApiAllTimeRecords }) {
  if (!records.topSingleMatchGoals && !records.longestWinStreak) return null;

  return (
    <VStack className="gap-2.5 rounded-[14px] border border-hairline bg-bg-card px-4 py-4">
      <Text className="font-body-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: 0.4 }}>
        HALL OF FAME
      </Text>

      {records.topSingleMatchGoals ? (
        <Pressable
          onPress={() =>
            router.push(
              `/spieler/${records.topSingleMatchGoals!.playerId}?kind=${records.topSingleMatchGoals!.playerKind}`,
            )
          }
          className="flex-row items-center justify-between active:opacity-80"
        >
          <VStack className="gap-0.5">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 13 }}>
              {records.topSingleMatchGoals.name}
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 11 }}>
              Tore in einem Spiel · {fmtRecordDate(records.topSingleMatchGoals.date)}
            </Text>
          </VStack>
          <Text className="font-heading text-gold" style={{ fontSize: 20 }}>
            {records.topSingleMatchGoals.goals}
          </Text>
        </Pressable>
      ) : null}

      {records.longestWinStreak ? (
        <Pressable
          onPress={() =>
            router.push(`/spieler/${records.longestWinStreak!.playerId}?kind=${records.longestWinStreak!.playerKind}`)
          }
          className="flex-row items-center justify-between active:opacity-80"
        >
          <VStack className="gap-0.5">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 13 }}>
              {records.longestWinStreak.name}
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 11 }}>
              Längste Siegesserie
            </Text>
          </VStack>
          <Text className="font-heading text-gold" style={{ fontSize: 20 }}>
            {records.longestWinStreak.streak}×S
          </Text>
        </Pressable>
      ) : null}
    </VStack>
  );
}

/** Loading placeholder matching `HallOfFameCard`'s shape. */
function HallOfFameCardSkeleton() {
  return (
    <VStack className="gap-2.5 rounded-[14px] border border-hairline bg-bg-card px-4 py-4">
      <Skeleton width={100} height={10} />
      {[0, 1].map((i) => (
        <HStack key={i} className="items-center justify-between">
          <VStack className="flex-1 gap-1.5 pr-3">
            <Skeleton width="55%" height={13} />
            <Skeleton width="75%" height={11} />
          </VStack>
          <Skeleton width={28} height={20} />
        </HStack>
      ))}
    </VStack>
  );
}

