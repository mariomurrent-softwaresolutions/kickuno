import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Stepper } from '@/components/ui/stepper';
import { PlayerChip } from '@/components/ui/player-chip';
import * as api from '@/lib/api';

/**
 * Ergebnis erfassen — implementation-plan.md §4.5. The roster comes from
 * the fixture's lineup (red/green), not from RSVPs — you can only score a
 * match for players who were actually assigned to a side.
 *
 * Own goals are tracked at the team level only (`redOwnGoals`/
 * `greenOwnGoals`) — the schema has no way to attribute one to a specific
 * player. See cms/src/lib/stats.ts's doc comment for why that's a
 * deliberate simplification, not an oversight.
 */
export default function ErgebnisScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const queryClient = useQueryClient();

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
  const [redOwnGoals, setRedOwnGoals] = useState(0);
  const [greenOwnGoals, setGreenOwnGoals] = useState(0);
  const [mvpId, setMvpId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const existing = resultQuery.data?.result;

  useEffect(() => {
    if (!existing || prefilled) return;
    const next: Record<string, number> = {};
    for (const g of existing.goals) {
      const pid = typeof g.player === 'object' && g.player !== null ? g.player.id : g.player;
      next[pid] = (next[pid] ?? 0) + g.count;
    }
    setGoalsByPlayer(next);
    setRedOwnGoals(existing.redOwnGoals ?? 0);
    setGreenOwnGoals(existing.greenOwnGoals ?? 0);
    const mvpVal = existing.mvp;
    setMvpId(typeof mvpVal === 'object' && mvpVal !== null ? mvpVal.id : (mvpVal ?? null));
    setPrefilled(true);
  }, [existing, prefilled]);

  const red = lineupQuery.data?.red ?? [];
  const green = lineupQuery.data?.green ?? [];

  const redGoalsTotal = red.reduce((sum, p) => sum + (goalsByPlayer[p.id] ?? 0), 0);
  const greenGoalsTotal = green.reduce((sum, p) => sum + (goalsByPlayer[p.id] ?? 0), 0);
  const redScore = redGoalsTotal + greenOwnGoals;
  const greenScore = greenGoalsTotal + redOwnGoals;

  function setPlayerGoals(playerId: string, value: number) {
    setGoalsByPlayer((prev) => ({ ...prev, [playerId]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const redIds = new Set(red.map((p) => p.id));
      const goals = [...red, ...green]
        .filter((p) => (goalsByPlayer[p.id] ?? 0) > 0)
        .map((p) => ({
          player: p.id,
          team: (redIds.has(p.id) ? 'red' : 'green') as 'red' | 'green',
          count: goalsByPlayer[p.id] ?? 0,
        }));
      await api.saveResult(fixtureId, {
        redScore,
        greenScore,
        redOwnGoals,
        greenOwnGoals,
        mvp: mvpId ?? undefined,
        goals,
      });
      queryClient.invalidateQueries({ queryKey: ['result', fixtureId] });
      queryClient.invalidateQueries({ queryKey: ['fixture', fixtureId] });
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const noPlayers = red.length === 0 && green.length === 0;

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 48 }}>
      <ScreenHeader eyebrow="ERGEBNIS" title="Rot gegen Grün" onBack={() => router.back()} />

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
            Noch keine Teams eingeteilt — zuerst im Termin-Detail Rot/Grün besetzen.
          </Text>
        ) : (
          <>
            <VStack className="gap-2.5">
              <Text className="font-body-semibold text-red" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
                Rot
              </Text>
              <VStack className="gap-2">
                {red.map((p) => (
                  <HStack
                    key={p.id}
                    className="items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-3 py-2.5"
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13.5 }}>
                      {p.name}
                    </Text>
                    <Stepper value={goalsByPlayer[p.id] ?? 0} onChange={(v) => setPlayerGoals(p.id, v)} />
                  </HStack>
                ))}
                <HStack className="items-center justify-between rounded-[14px] border border-hairline bg-bg-sunken px-3 py-2.5">
                  <Text className="font-body text-muted" style={{ fontSize: 13 }}>
                    Eigentore Rot
                  </Text>
                  <Stepper value={redOwnGoals} onChange={setRedOwnGoals} />
                </HStack>
              </VStack>
            </VStack>

            <VStack className="gap-2.5">
              <Text className="font-body-semibold text-green" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
                Grün
              </Text>
              <VStack className="gap-2">
                {green.map((p) => (
                  <HStack
                    key={p.id}
                    className="items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-3 py-2.5"
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13.5 }}>
                      {p.name}
                    </Text>
                    <Stepper value={goalsByPlayer[p.id] ?? 0} onChange={(v) => setPlayerGoals(p.id, v)} />
                  </HStack>
                ))}
                <HStack className="items-center justify-between rounded-[14px] border border-hairline bg-bg-sunken px-3 py-2.5">
                  <Text className="font-body text-muted" style={{ fontSize: 13 }}>
                    Eigentore Grün
                  </Text>
                  <Stepper value={greenOwnGoals} onChange={setGreenOwnGoals} />
                </HStack>
              </VStack>
            </VStack>

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
          </>
        )}

        <Pressable
          onPress={save}
          disabled={saving || noPlayers}
          className="items-center rounded-[16px] bg-green py-4 active:opacity-90"
        >
          <Text className="font-body-bold" style={{ fontSize: 15, color: '#07120C' }}>
            {saving ? 'Speichert…' : 'Ergebnis speichern'}
          </Text>
        </Pressable>
      </VStack>
    </ScrollView>
  );
}
