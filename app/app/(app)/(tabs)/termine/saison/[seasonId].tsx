import { RefreshControl, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { FixtureRow } from '@/components/ui/fixture-row';
import { MonthDivider } from '@/components/ui/month-divider';
import { useAuth } from '@/lib/auth-context';
import { fixtureDateParts, groupFixturesByMonth } from '@/lib/fixture-groups';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

/**
 * All Termine recorded under one season, reached by tapping a season in
 * the "Vergangene Saisons" list on the main Termine screen — a season
 * keeps its own history browsable long after it's no longer active
 * (feature-plan-seasons-and-multigroup.md §A). Unlike the main list this
 * doesn't split by fixture `status` — a season is normally closed out
 * once every fixture in it has actually been played, so the distinction
 * doesn't carry the same weight here; every fixture still shows the same
 * green "Ergebnis vorhanden" dot as the main list.
 */
export default function SaisonTermineScreen() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  const { group } = useAuth();

  const seasonsQuery = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });
  const fixturesQuery = useQuery({
    queryKey: ['fixtures', group?.id, 'season', seasonId],
    queryFn: () => api.listFixtures(group!.id, undefined, seasonId),
    enabled: Boolean(group && seasonId),
  });

  const season = seasonsQuery.data?.docs.find((s) => s.id === seasonId);
  const groups = fixturesQuery.data ? groupFixturesByMonth(fixturesQuery.data.docs.slice().reverse()) : [];

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl tintColor={colors.dim} refreshing={fixturesQuery.isFetching} onRefresh={() => fixturesQuery.refetch()} />
      }
    >
      <ScreenHeader eyebrow="SAISON" title={season?.label ?? '…'} onBack={() => router.back()} />
      <VStack className="gap-4 px-5 pt-4">
        {groups.length ? (
          <VStack className="gap-4">
            {groups.map((g) => (
              <VStack key={g.key} className="gap-2.5">
                <MonthDivider label={g.label} />
                <VStack className="gap-2">
                  {g.fixtures.map((fixture) => (
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
        ) : (
          <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
            {fixturesQuery.isLoading ? 'Lädt…' : 'Keine Termine in dieser Saison.'}
          </Text>
        )}
      </VStack>
    </ScrollView>
  );
}
