import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Stepper } from '@/components/ui/stepper';
import { PlayerChip } from '@/components/ui/player-chip';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/theme/tokens';

/**
 * Ergebnis erfassen — implementation-plan.md §4.5. The roster comes from
 * the fixture's lineup (red/green), not from RSVPs — you can only score a
 * match for players who were actually assigned to a side.
 *
 * Own goals (feature-plan-seasons-and-multigroup.md §C) can now be
 * attributed to a specific player via their own "Eigentor" stepper,
 * alongside their regular "Tore" stepper — `ownGoalsByPlayer` here, mapped
 * to `goals[]` entries with `isOwnGoal: true` on save. A per-team
 * "Sonstiges Eigentor" stepper remains underneath each roster for own
 * goals with no known scorer (kept as the team-level
 * `redOwnGoals`/`greenOwnGoals` counters, same as before this feature) —
 * intentionally coexisting with per-player attribution rather than forcing
 * every own goal to name someone.
 */
export default function ErgebnisScreen() {
  const { t } = useTranslation('ergebnis');
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const queryClient = useQueryClient();

  const { group } = useAuth();
  const teamOneName = group?.teamOneName ?? 'Rot';
  const teamTwoName = group?.teamTwoName ?? 'Grün';
  const mvpEnabled = Boolean(group?.features.mvp);

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

  const [goalsByPlayer, setGoalsByPlayer] = useState<Record<string, number>>({});
  const [ownGoalsByPlayer, setOwnGoalsByPlayer] = useState<Record<string, number>>({});
  // Unattributed remainder only — "Sonstiges Eigentor" (own goal, unknown
  // scorer). The *total* own goals per team sent to/from the server also
  // folds in whatever's attributed via `ownGoalsByPlayer` above; see
  // `redOwnGoalsTotal`/`greenOwnGoalsTotal` below and this screen's header
  // comment.
  const [redOwnGoals, setRedOwnGoals] = useState(0);
  const [greenOwnGoals, setGreenOwnGoals] = useState(0);
  const [mvpId, setMvpId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  // Tracks only an explicit pull-to-refresh — see statistik/index.tsx's
  // comment on the same pattern.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const existing = resultQuery.data?.result;

  useEffect(() => {
    if (!existing || prefilled) return;
    const nextGoals: Record<string, number> = {};
    const nextOwnGoals: Record<string, number> = {};
    for (const g of existing.goals) {
      const pid = typeof g.player === 'object' && g.player !== null ? g.player.id : g.player;
      if (g.isOwnGoal) {
        nextOwnGoals[pid] = (nextOwnGoals[pid] ?? 0) + g.count;
      } else {
        nextGoals[pid] = (nextGoals[pid] ?? 0) + g.count;
      }
    }
    setGoalsByPlayer(nextGoals);
    setOwnGoalsByPlayer(nextOwnGoals);
    // `existing.redOwnGoals`/`greenOwnGoals` are the stored *totals*
    // (attributed + unattributed, per Fixtures.ts's POST handler) — back
    // out the attributed portion (from the own-goal `goals[]` entries
    // above, split by their own `team` tag) so the "Sonstiges Eigentor"
    // stepper below shows only the unattributed remainder, not a
    // double-count.
    let attributedRedFromGoals = 0;
    let attributedGreenFromGoals = 0;
    for (const g of existing.goals) {
      if (!g.isOwnGoal) continue;
      if (g.team === 'red') attributedRedFromGoals += g.count;
      else attributedGreenFromGoals += g.count;
    }
    setRedOwnGoals(Math.max(0, (existing.redOwnGoals ?? 0) - attributedRedFromGoals));
    setGreenOwnGoals(Math.max(0, (existing.greenOwnGoals ?? 0) - attributedGreenFromGoals));
    const mvpVal = existing.mvp;
    setMvpId(typeof mvpVal === 'object' && mvpVal !== null ? mvpVal.id : (mvpVal ?? null));
    setPrefilled(true);
  }, [existing, prefilled]);

  const red = lineupQuery.data?.red ?? [];
  const green = lineupQuery.data?.green ?? [];
  const redIds = new Set(red.map((p) => p.id));

  const redGoalsTotal = red.reduce((sum, p) => sum + (goalsByPlayer[p.id] ?? 0), 0);
  const greenGoalsTotal = green.reduce((sum, p) => sum + (goalsByPlayer[p.id] ?? 0), 0);
  // Total own goals per team = attributed (per-player, this team's own
  // players) + unattributed ("Sonstiges Eigentor" stepper for this team).
  const attributedRedOwnGoals = red.reduce((sum, p) => sum + (ownGoalsByPlayer[p.id] ?? 0), 0);
  const attributedGreenOwnGoals = green.reduce((sum, p) => sum + (ownGoalsByPlayer[p.id] ?? 0), 0);
  const redOwnGoalsTotal = redOwnGoals + attributedRedOwnGoals;
  const greenOwnGoalsTotal = greenOwnGoals + attributedGreenOwnGoals;
  // An own goal by a red player benefits green, and vice versa.
  const redScore = redGoalsTotal + greenOwnGoalsTotal;
  const greenScore = greenGoalsTotal + redOwnGoalsTotal;

  function setPlayerGoals(playerId: string, value: number) {
    setGoalsByPlayer((prev) => ({ ...prev, [playerId]: value }));
  }

  function setPlayerOwnGoals(playerId: string, value: number) {
    setOwnGoalsByPlayer((prev) => ({ ...prev, [playerId]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const goalEntries = [...red, ...green]
        .filter((p) => (goalsByPlayer[p.id] ?? 0) > 0)
        .map((p) => ({
          player: p.id,
          team: (redIds.has(p.id) ? 'red' : 'green') as 'red' | 'green',
          count: goalsByPlayer[p.id] ?? 0,
        }));
      // A player can have both a regular-goal entry and a separate
      // own-goal entry in the same match — two entries, not merged.
      const ownGoalEntries = [...red, ...green]
        .filter((p) => (ownGoalsByPlayer[p.id] ?? 0) > 0)
        .map((p) => ({
          player: p.id,
          team: (redIds.has(p.id) ? 'red' : 'green') as 'red' | 'green',
          count: ownGoalsByPlayer[p.id] ?? 0,
          isOwnGoal: true,
        }));
      await api.saveResult(fixtureId, {
        redScore,
        greenScore,
        // Unattributed remainder only — the server adds the attributed
        // (`isOwnGoal: true`) sums from `goals` on top before storing the
        // total. See Fixtures.ts's `/:id/result` POST handler.
        redOwnGoals,
        greenOwnGoals,
        // Omitted when `features.mvp` is off — the picker below never gets shown to set
        // one, but this also guards a stale `mvpId` from a moment the flag was on.
        mvp: mvpEnabled ? (mvpId ?? undefined) : undefined,
        goals: [...goalEntries, ...ownGoalEntries],
      });
      // Saving a result recomputes playerSeasonStats/playerCareerStats (and,
      // if features.strength is on, suggestedStrength) server-side — none
      // of that lives at ['result'/'fixture'/'fixtures'], so every screen
      // that reads it needs its own invalidation here too, or it'll keep
      // showing pre-save numbers until the user happens to pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ['result', fixtureId] });
      queryClient.invalidateQueries({ queryKey: ['fixture', fixtureId] });
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['stats', group?.id] });
      queryClient.invalidateQueries({ queryKey: ['player-profile'] });
      queryClient.invalidateQueries({ queryKey: ['group-members', group?.id] });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await Promise.all([lineupQuery.refetch(), resultQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  const noPlayers = red.length === 0 && green.length === 0;

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl tintColor={colors.dim} refreshing={isRefreshing} onRefresh={handleRefresh} />
      }
    >
      <ScreenHeader eyebrow={t('eyebrow')} title={t('titleVs', { teamOne: teamOneName, teamTwo: teamTwoName })} onBack={() => router.back()} />

      <VStack className="gap-6 px-5 pt-4">
        <HStack className="items-center justify-center gap-4 rounded-[22px] border border-hairline bg-bg-card py-6">
          <Text className="font-heading text-red" style={{ fontSize: 48, lineHeight: 50 }}>
            {redScore}
          </Text>
          <Text className="font-heading text-dim" style={{ fontSize: 30 }}>
            :
          </Text>
          <Text className="font-heading text-green" style={{ fontSize: 48, lineHeight: 50 }}>
            {greenScore}
          </Text>
        </HStack>

        {noPlayers ? (
          <Text className="font-body text-muted" style={{ fontSize: 13 }}>
            {t('noTeams', { teamOne: teamOneName, teamTwo: teamTwoName })}
          </Text>
        ) : (
          <>
            <VStack className="gap-2.5">
              <Text className="font-body-semibold text-red" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
                {teamOneName}
              </Text>
              <VStack className="gap-2">
                {red.map((p) => (
                  <VStack
                    key={p.id}
                    className="gap-2 rounded-[14px] border border-hairline bg-bg-card px-3 py-2.5"
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13.5 }}>
                      {p.name}
                    </Text>
                    <HStack className="items-center justify-between">
                      <HStack className="items-center gap-2">
                        <Text className="font-body text-muted" style={{ fontSize: 11 }}>
                          {t('goals')}
                        </Text>
                        <Stepper value={goalsByPlayer[p.id] ?? 0} onChange={(v) => setPlayerGoals(p.id, v)} />
                      </HStack>
                      <HStack className="items-center gap-2">
                        <Text className="font-body text-muted" style={{ fontSize: 11 }}>
                          {t('ownGoal')}
                        </Text>
                        <Stepper value={ownGoalsByPlayer[p.id] ?? 0} onChange={(v) => setPlayerOwnGoals(p.id, v)} />
                      </HStack>
                    </HStack>
                  </VStack>
                ))}
                <HStack className="items-center justify-between rounded-[14px] border border-hairline bg-bg-sunken px-3 py-2.5">
                  <Text className="font-body text-muted" style={{ fontSize: 13 }}>
                    {t('otherOwnGoal', { team: teamOneName })}
                  </Text>
                  <Stepper value={redOwnGoals} onChange={setRedOwnGoals} />
                </HStack>
              </VStack>
            </VStack>

            <VStack className="gap-2.5">
              <Text className="font-body-semibold text-green" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
                {teamTwoName}
              </Text>
              <VStack className="gap-2">
                {green.map((p) => (
                  <VStack
                    key={p.id}
                    className="gap-2 rounded-[14px] border border-hairline bg-bg-card px-3 py-2.5"
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13.5 }}>
                      {p.name}
                    </Text>
                    <HStack className="items-center justify-between">
                      <HStack className="items-center gap-2">
                        <Text className="font-body text-muted" style={{ fontSize: 11 }}>
                          {t('goals')}
                        </Text>
                        <Stepper value={goalsByPlayer[p.id] ?? 0} onChange={(v) => setPlayerGoals(p.id, v)} />
                      </HStack>
                      <HStack className="items-center gap-2">
                        <Text className="font-body text-muted" style={{ fontSize: 11 }}>
                          {t('ownGoal')}
                        </Text>
                        <Stepper value={ownGoalsByPlayer[p.id] ?? 0} onChange={(v) => setPlayerOwnGoals(p.id, v)} />
                      </HStack>
                    </HStack>
                  </VStack>
                ))}
                <HStack className="items-center justify-between rounded-[14px] border border-hairline bg-bg-sunken px-3 py-2.5">
                  <Text className="font-body text-muted" style={{ fontSize: 13 }}>
                    {t('otherOwnGoal', { team: teamTwoName })}
                  </Text>
                  <Stepper value={greenOwnGoals} onChange={setGreenOwnGoals} />
                </HStack>
              </VStack>
            </VStack>

            {mvpEnabled && (
              <VStack className="gap-2.5">
                <Text className="font-body-semibold text-dim" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
                  MVP
                </Text>
                <HStack className="flex-wrap gap-2">
                  {[...red, ...green].map((p) => (
                    <PlayerChip
                      key={p.id}
                      name={p.name}
                      tint={mvpId === p.id ? 'green' : 'neutral'}
                      onPress={() => setMvpId(mvpId === p.id ? null : p.id)}
                    />
                  ))}
                </HStack>
              </VStack>
            )}
          </>
        )}

        <Pressable
          onPress={save}
          disabled={saving || noPlayers}
          className="items-center rounded-[16px] bg-green py-4 active:opacity-90"
        >
          <Text className="font-body-bold" style={{ fontSize: 15, color: '#07120C' }}>
            {saving ? t('save.loading') : t('save.action')}
          </Text>
        </Pressable>
      </VStack>
    </ScrollView>
  );
}
