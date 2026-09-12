import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatTile } from '@/components/ui/stat-tile';
import { PlayerChip } from '@/components/ui/player-chip';
import { useAuth } from '@/lib/auth-context';
import { useFeatures } from '@/lib/features-context';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/**
 * Termin-Detail — team builder (implementation-plan.md §4.5). Auto-balance
 * and manual assign/unassign are admin/organizer-only client-side (§3.4);
 * the backend enforces the same restriction independently (defense in
 * depth, same pattern as the RSVP/feature-flag gates elsewhere).
 */
export default function TerminDetailScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const { membership } = useAuth();
  const features = useFeatures();
  const queryClient = useQueryClient();
  const canEdit = membership?.role === 'admin' || membership?.role === 'organizer';

  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [autoBalancing, setAutoBalancing] = useState(false);
  const [clearing, setClearing] = useState(false);

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

  function invalidateLineup() {
    queryClient.invalidateQueries({ queryKey: ['lineup', fixtureId] });
  }

  async function assign(playerId: string, team: 'red' | 'green' | null) {
    setBusyPlayerId(playerId);
    try {
      await api.assignLineupPlayer(fixtureId, playerId, team);
      invalidateLineup();
    } finally {
      setBusyPlayerId(null);
    }
  }

  async function autoBalance() {
    setAutoBalancing(true);
    try {
      await api.autoBalanceLineup(fixtureId);
      invalidateLineup();
    } finally {
      setAutoBalancing(false);
    }
  }

  async function clearAll() {
    if (!lineup) return;
    setClearing(true);
    try {
      for (const p of [...lineup.red, ...lineup.green]) {
        // Sequential on purpose — one fixture's roster is small, and each
        // unassign should land before the next so a mid-batch failure
        // leaves the lineup in a known partial state rather than racing.
        // eslint-disable-next-line no-await-in-loop
        await api.assignLineupPlayer(fixtureId, p.id, null);
      }
      invalidateLineup();
    } finally {
      setClearing(false);
    }
  }

  const zusagenCount = lineup ? lineup.pool.length + lineup.red.length + lineup.green.length : 0;
  const eingeteiltCount = lineup ? lineup.red.length + lineup.green.length : 0;
  const balance =
    lineup && features.strength
      ? lineup.red.reduce((sum, p) => sum + (p.strength ?? 0), 0) -
        lineup.green.reduce((sum, p) => sum + (p.strength ?? 0), 0)
      : null;

  const fixtureDate = fixture ? new Date(fixture.date) : null;
  const title = fixtureDate
    ? `${WEEKDAYS[fixtureDate.getUTCDay()]}, ${fixtureDate.getUTCDate()}. ${MONTHS[fixtureDate.getUTCMonth()]}`
    : '…';

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          tintColor={colors.dim}
          refreshing={lineupQuery.isFetching}
          onRefresh={() => {
            fixtureQuery.refetch();
            lineupQuery.refetch();
            resultQuery.refetch();
          }}
        />
      }
    >
      <ScreenHeader eyebrow="TERMIN" title={title} onBack={() => router.back()} />

      <VStack className="gap-5 px-5 pt-4">
        {fixture && (
          <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
            {fixture.time} Uhr
            {typeof fixture.hall === 'object' && fixture.hall?.name ? ` · ${fixture.hall.name}` : ''}
          </Text>
        )}

        <HStack className="gap-2.5">
          <StatTile label="Zusagen" value={String(zusagenCount)} />
          <StatTile label="Eingeteilt" value={String(eingeteiltCount)} />
          {features.strength && (
            <StatTile
              label="Balance"
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
                  {autoBalancing ? 'Balanciert…' : 'Auto-Aufstellung'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={clearAll}
              disabled={clearing || eingeteiltCount === 0}
              className="flex-1 items-center rounded-[13px] border py-3 active:opacity-80"
              style={{ borderColor: colors.hairline }}
            >
              <Text className="font-body-semibold text-muted" style={{ fontSize: 13.5 }}>
                {clearing ? 'Leert…' : 'Zurücksetzen'}
              </Text>
            </Pressable>
          </HStack>
        )}

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-red" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            Rot
          </Text>
          <HStack className="flex-wrap gap-2">
            {lineup?.red.length ? (
              lineup.red.map((p) => (
                <PlayerChip
                  key={p.id}
                  name={p.name}
                  strength={features.strength ? p.strength : undefined}
                  tint="red"
                  onPress={canEdit ? () => assign(p.id, null) : undefined}
                />
              ))
            ) : (
              <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
                Noch niemand eingeteilt.
              </Text>
            )}
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-green" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            Grün
          </Text>
          <HStack className="flex-wrap gap-2">
            {lineup?.green.length ? (
              lineup.green.map((p) => (
                <PlayerChip
                  key={p.id}
                  name={p.name}
                  strength={features.strength ? p.strength : undefined}
                  tint="green"
                  onPress={canEdit ? () => assign(p.id, null) : undefined}
                />
              ))
            ) : (
              <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
                Noch niemand eingeteilt.
              </Text>
            )}
          </HStack>
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-dim" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            Unverteilt
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
                          Rot
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => assign(p.id, 'green')}
                        disabled={busyPlayerId === p.id}
                        className="rounded-[10px] px-3 py-1.5"
                        style={{ backgroundColor: 'rgba(47,191,110,0.14)' }}
                      >
                        <Text className="font-body-semibold text-green" style={{ fontSize: 12 }}>
                          Grün
                        </Text>
                      </Pressable>
                    </HStack>
                  )}
                </HStack>
              ))}
            </VStack>
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
              {features.rsvp ? 'Noch keine Zusagen.' : 'Keine Mitglieder in der Gruppe.'}
            </Text>
          )}
        </VStack>

        <Pressable
          onPress={() => router.push(`/(app)/(tabs)/termine/${fixtureId}/ergebnis`)}
          className="items-center rounded-[16px] border border-hairline bg-bg-card py-4 active:opacity-85"
        >
          <Text className="font-body-bold text-ink" style={{ fontSize: 14.5 }}>
            {hasResult ? 'Ergebnis bearbeiten' : 'Ergebnis erfassen'}
          </Text>
        </Pressable>
      </VStack>
    </ScrollView>
  );
}
