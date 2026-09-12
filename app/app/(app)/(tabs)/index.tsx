import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ChevronForwardIcon } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { useFeatures } from '@/lib/features-context';
import * as api from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function fixtureDateTime(fixture: api.ApiFixture): Date {
  const d = new Date(fixture.date);
  const [h, m] = fixture.time.split(':').map((n) => parseInt(n, 10));
  d.setUTCHours(h || 0, m || 0, 0, 0);
  return d;
}

function countdownLabel(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'Heute';
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days === 1 ? 'Morgen' : `in ${days} Tagen`;
}

/**
 * Start tab — next-fixture card + RSVP (implementation-plan.md §4.5).
 * Season tiles / last-5 form / last game score / top scorers are phase 5
 * (need matchResults/playerSeasonStats, which don't exist yet).
 */
export default function StartScreen() {
  const { group } = useAuth();
  const features = useFeatures();
  const queryClient = useQueryClient();

  const upcoming = useQuery({
    queryKey: ['fixtures', group?.id, 'upcoming'],
    queryFn: () => api.listFixtures(group!.id, 'upcoming'),
    enabled: Boolean(group),
  });
  const nextFixture = upcoming.data?.docs[0];

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

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl tintColor={colors.dim} refreshing={upcoming.isFetching} onRefresh={() => upcoming.refetch()} />}
    >
      <ScreenHeader eyebrow="HALLENKICK" title="Servus" />
      <VStack className="gap-4 px-5 pt-4">
        <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">Nächster Termin</Text>

        {nextFixture ? (
          <Pressable
            onPress={() => router.push(`/(app)/(tabs)/termine/${nextFixture.id}`)}
            className="rounded-[22px] border border-hairline bg-bg-card p-5 active:opacity-90"
          >
            <HStack className="items-start justify-between">
              <VStack className="gap-1">
                <Text className="font-heading uppercase text-ink" style={{ fontSize: 22, lineHeight: 24 }}>
                  {WEEKDAYS_LONG[fixtureDateTime(nextFixture).getUTCDay()]}
                </Text>
                <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
                  {new Date(nextFixture.date).getUTCDate()}. {MONTHS[new Date(nextFixture.date).getUTCMonth()]} ·{' '}
                  {nextFixture.time} Uhr
                  {typeof nextFixture.hall === 'object' && nextFixture.hall?.name ? ` · ${nextFixture.hall.name}` : ''}
                </Text>
              </VStack>
              <VStack className="items-end gap-1">
                <Text className="font-body-semibold text-green" style={{ fontSize: 12.5 }}>
                  {countdownLabel(fixtureDateTime(nextFixture))}
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
                      Bin dabei
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
                      Kann nicht
                    </Text>
                  </Pressable>
                </HStack>
              </VStack>
            )}
          </Pressable>
        ) : (
          <Box className="rounded-[22px] border border-hairline bg-bg-card p-5">
            <Text className="font-body text-muted" style={{ fontSize: 13.5 }}>
              {upcoming.isLoading ? 'Lädt…' : 'Kein bevorstehender Termin.'}
            </Text>
          </Box>
        )}

        <Text className="font-body text-muted" style={{ fontSize: 13 }}>
          Saison-Kacheln, Form der letzten 5 Spiele und Top-Scorer kommen in Phase 5 —
          implementation-plan.md §4.5.
        </Text>
      </VStack>
    </ScrollView>
  );
}
