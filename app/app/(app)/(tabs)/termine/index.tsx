import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { FixtureRow } from '@/components/ui/fixture-row';
import { PlusIcon } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { useFeatures } from '@/lib/features-context';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAYS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
const MONTHS_LONG = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

function fixtureDateParts(iso: string) {
  const d = new Date(iso);
  return { weekday: WEEKDAYS[d.getUTCDay()], day: String(d.getUTCDate()).padStart(2, '0') };
}

type FixtureGroup = { key: string; label: string; fixtures: api.ApiFixture[] };

/**
 * Buckets an already-date-sorted fixture list into contiguous per-month
 * runs (a single pass is enough since a sorted list never revisits a
 * month once it's moved past it, in either direction — upcoming ascending,
 * past reversed to descending, both still monotonic). The month label
 * drops the year for the current year and shows it otherwise, since a
 * season spans a calendar-year boundary (§1) and the list can otherwise
 * read as ambiguous around New Year's.
 */
function groupFixturesByMonth(fixtures: api.ApiFixture[]): FixtureGroup[] {
  const currentYear = new Date().getUTCFullYear();
  const groups: FixtureGroup[] = [];
  for (const fixture of fixtures) {
    const d = new Date(fixture.date);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.fixtures.push(fixture);
    } else {
      const label = year === currentYear ? MONTHS_LONG[month] : `${MONTHS_LONG[month]} ${year}`;
      groups.push({ key, label, fixtures: [fixture] });
    }
  }
  return groups;
}

/**
 * A labeled hairline between two months' worth of fixtures — implements
 * "month as a separator" instead of repeating it on every date tile
 * (`FixtureRow`'s weekday/day tile is unchanged).
 */
function MonthDivider({ label }: { label: string }) {
  return (
    <HStack className="items-center gap-2.5">
      <Text className="font-body-semibold text-[11px] tracking-[1.5px] uppercase text-muted-soft">{label}</Text>
      <Box className="h-px flex-1" style={{ backgroundColor: colors.hairline }} />
    </HStack>
  );
}

/**
 * "Termine" tab — upcoming + past fixture lists, "+ Neuen Termin anlegen"
 * entry point (organizer/admin only, since creating a fixture is gated
 * server-side the same way — §3.4/§4.5). Fixtures are grouped under a
 * month divider instead of repeating the month on every date tile.
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
  const past = useQuery({
    queryKey: ['fixtures', group?.id, 'played'],
    queryFn: () => api.listFixtures(group!.id, 'played'),
    enabled: Boolean(group),
  });

  const isRefreshing = upcoming.isFetching || past.isFetching;
  function refresh() {
    upcoming.refetch();
    past.refetch();
  }

  const upcomingGroups = upcoming.data ? groupFixturesByMonth(upcoming.data.docs) : [];
  const pastGroups = past.data ? groupFixturesByMonth(past.data.docs.slice().reverse()) : [];

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
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
              {upcoming.isLoading ? 'Lädt…' : 'Keine bevorstehenden Termine.'}
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
                        onPress={() => router.push(`/(app)/(tabs)/termine/${fixture.id}`)}
                      />
                    ))}
                  </VStack>
                </VStack>
              ))}
            </VStack>
          ) : (
            <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
              {past.isLoading ? 'Lädt…' : 'Noch keine gespielten Termine.'}
            </Text>
          )}
        </VStack>
      </VStack>
    </ScrollView>
  );
}
