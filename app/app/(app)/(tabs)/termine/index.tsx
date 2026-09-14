import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { FixtureRow } from '@/components/ui/fixture-row';
import { MonthDivider } from '@/components/ui/month-divider';
import { PlusIcon, ChevronForwardIcon } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { useFeatures } from '@/lib/features-context';
import { fixtureDateParts, groupFixturesByMonth } from '@/lib/fixture-groups';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

/**
 * "Termine" tab — upcoming + past fixture lists, "+ Neuen Termin anlegen"
 * entry point (organizer/admin only, since creating a fixture is gated
 * server-side the same way — §3.4/§4.5). Fixtures are grouped under a
 * month divider instead of repeating the month on every date tile.
 *
 * Also lists every non-active ("abgeschlossene") season as a tappable
 * entry — a season stays relevant for browsing its own Termine long after
 * it's no longer the active one (feature-plan-seasons-and-multigroup.md
 * §A); tapping one pushes `termine/saison/[seasonId]`, which lists every
 * fixture recorded under that season regardless of its own status.
 */
export default function TermineScreen() {
  const { group, membership } = useAuth();
  const features = useFeatures();
  const canManage = membership?.role === 'admin' || membership?.role === 'organizer';

  const upcoming = useQuery({
    queryKey: ['fixtures', group?.id, 'upcoming'],
    queryFn: () => api.listFixtures(group!.id, 'upcoming'),
    enabled: Boolean(group),
  });
  const seasons = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });
  const activeSeasonId = seasons.data?.docs.find((s) => s.status === 'active')?.id;
  // "Gespielt" only ever shows the *active* season's own played fixtures —
  // a season's own Termine, once it's no longer active, live under
  // "Vergangene Saisons" -> `termine/saison/[seasonId]` instead, so
  // showing them here too would just be the same fixtures twice.
  const past = useQuery({
    queryKey: ['fixtures', group?.id, 'played', activeSeasonId],
    queryFn: () => api.listFixtures(group!.id, 'played', activeSeasonId),
    enabled: Boolean(group && activeSeasonId),
  });

  const isRefreshing = upcoming.isFetching || past.isFetching;
  function refresh() {
    upcoming.refetch();
    past.refetch();
    seasons.refetch();
  }

  const upcomingGroups = upcoming.data ? groupFixturesByMonth(upcoming.data.docs) : [];
  const pastGroups = past.data ? groupFixturesByMonth(past.data.docs.slice().reverse()) : [];
  const pastSeasons = (seasons.data?.docs ?? []).filter((s) => s.status !== 'active');

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl tintColor={colors.dim} refreshing={isRefreshing} onRefresh={refresh} />}
    >
      <ScreenHeader eyebrow="TERMINE" title="Termine" />
      <VStack className="gap-6 px-5 pt-4">
        {canManage && (
          <Pressable
            onPress={() => router.push('/(app)/(tabs)/termine/neu')}
            className="flex-row items-center justify-center gap-2 rounded-[15px] border border-dashed border-hairline py-3.5 active:opacity-80"
          >
            <PlusIcon color={colors.mutedSoft} />
            <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 14 }}>
              Neuen Termin anlegen
            </Text>
          </Pressable>
        )}

        <VStack className="gap-3">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">Bevorstehend</Text>
          {upcomingGroups.length ? (
            <VStack className="gap-4">
              {upcomingGroups.map((group) => (
                <VStack key={group.key} className="gap-2.5">
                  <MonthDivider label={group.label} />
                  <VStack className="gap-2">
                    {group.fixtures.map((fixture) => (
                      <FixtureRow
                        key={fixture.id}
                        {...fixtureDateParts(fixture.date)}
                        time={fixture.time}
                        hallName={typeof fixture.hall === 'object' ? fixture.hall?.name : undefined}
                        hasResult={fixture.hasResult ?? false}
                        resultLabel={
                          fixture.hasResult && typeof fixture.redScore === 'number' && typeof fixture.greenScore === 'number'
                            ? `${fixture.redScore}:${fixture.greenScore}`
                            : undefined
                        }
                        attendanceLabel={
                          features.rsvp && fixture.rsvpYesCount !== undefined
                            ? `${fixture.rsvpYesCount} Zusagen`
                            : undefined
                        }
                        onPress={() => router.push(`/(app)/(tabs)/termine/${fixture.id}`)}
                      />
                    ))}
                  </VStack>
                </VStack>
              ))}
            </VStack>
          ) : upcoming.isLoading ? (
            <Spinner />
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
              Keine bevorstehenden Termine.
            </Text>
          )}
        </VStack>

        <VStack className="gap-3">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">Gespielt</Text>
          {pastGroups.length ? (
            <VStack className="gap-4">
              {pastGroups.map((group) => (
                <VStack key={group.key} className="gap-2.5">
                  <MonthDivider label={group.label} />
                  <VStack className="gap-2">
                    {group.fixtures.map((fixture) => (
                      <FixtureRow
                        key={fixture.id}
                        {...fixtureDateParts(fixture.date)}
                        time={fixture.time}
                        hallName={typeof fixture.hall === 'object' ? fixture.hall?.name : undefined}
                        hasResult={fixture.hasResult ?? false}
                        resultLabel={
                          fixture.hasResult && typeof fixture.redScore === 'number' && typeof fixture.greenScore === 'number'
                            ? `${fixture.redScore}:${fixture.greenScore}`
                            : undefined
                        }
                        onPress={() => router.push(`/(app)/(tabs)/termine/${fixture.id}`)}
                      />
                    ))}
                  </VStack>
                </VStack>
              ))}
            </VStack>
          ) : seasons.isLoading || past.isLoading ? (
            <Spinner />
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
              Noch keine gespielten Termine.
            </Text>
          )}
        </VStack>

        {pastSeasons.length > 0 && (
          <VStack className="gap-3">
            <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">
              Vergangene Saisons
            </Text>
            <VStack className="gap-2">
              {pastSeasons.map((season) => (
                <Pressable
                  key={season.id}
                  onPress={() => router.push(`/(app)/(tabs)/termine/saison/${season.id}`)}
                  className="active:opacity-80"
                >
                  <HStack className="items-center justify-between rounded-[18px] border border-hairline bg-bg-card px-4 py-3.5">
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                      {season.label}
                    </Text>
                    <ChevronForwardIcon color={colors.dim} />
                  </HStack>
                </Pressable>
              ))}
            </VStack>
          </VStack>
        )}
      </VStack>
    </ScrollView>
  );
}
