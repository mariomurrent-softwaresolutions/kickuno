import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const TIME_OPTIONS = ['19:00', '19:30', '20:00', '20:30', '21:00'];

/**
 * Next N occurrences of `weekday` (0=Sonntag … 6=Samstag), each at local
 * midnight UTC, always strictly in the future (today itself is skipped
 * even when it happens to fall on `weekday`) — implementation-plan.md
 * §4.5. `weekday` comes from the group's `defaultGameDay` (admin-editable,
 * Gruppe → Einstellungen — §4.6), not hardcoded to Thursday.
 */
function nextOccurrencesOfWeekday(weekday: number, count = 6): Date[] {
  const dates: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + ((weekday - cursor.getUTCDay() + 7) % 7 || 7));
  for (let i = 0; i < count; i += 1) {
    dates.push(new Date(cursor.getTime() + i * 7 * 24 * 60 * 60 * 1000));
  }
  return dates;
}

/** The next `count` calendar days (any weekday), starting tomorrow — the "Anderes Datum" picker. */
function nextNDays(count = 28): Date[] {
  const dates: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= count; i += 1) {
    dates.push(new Date(cursor.getTime() + i * 24 * 60 * 60 * 1000));
  }
  return dates;
}

/**
 * "Neuer Termin" — date (next 6 Thursdays), time, hall, weekly-repeat toggle
 * — implementation-plan.md §4.5. Only reachable by organizer/admin (the
 * Termine screen hides the CTA for players; creating is also 403'd
 * server-side either way — §3.4).
 */
export default function NeuerTerminScreen() {
  const { t } = useTranslation('neuerTermin');
  const { t: tCommon } = useTranslation('common');
  const { group } = useAuth();
  const queryClient = useQueryClient();
  const weekday = group?.defaultGameDay ?? 4;
  const suggested = useMemo(() => nextOccurrencesOfWeekday(weekday), [weekday]);
  const otherDates = useMemo(() => nextNDays(28), []);
  const [customMode, setCustomMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState(suggested[0]);
  const [time, setTime] = useState(TIME_OPTIONS[2]);
  const [hallId, setHallId] = useState<string | null>(null);
  const [newHallName, setNewHallName] = useState('');
  const [repeatWeekly, setRepeatWeekly] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const halls = useQuery({
    queryKey: ['halls', group?.id],
    queryFn: () => api.listHalls(group!.id),
    enabled: Boolean(group),
  });

  async function handleSubmit() {
    if (!group || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      let hall = hallId ?? undefined;
      if (!hall && newHallName.trim()) {
        const created = await api.createHall({ group: group.id, name: newHallName.trim() });
        hall = created.doc.id;
      }

      const payload = { group: group.id, date: selectedDate.toISOString(), time, hall };
      if (repeatWeekly) await api.createWeeklyFixtures(payload);
      else await api.createFixture(payload);

      await queryClient.invalidateQueries({ queryKey: ['fixtures', group.id] });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tCommon('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader eyebrow={t('eyebrow')} title={t('title')} onBack={() => router.back()} />
      <VStack className="gap-6 px-5 pt-4">
        <VStack className="gap-2">
          <HStack className="items-center justify-between">
            <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('date.label')}</Text>
            <Pressable onPress={() => setCustomMode((v) => !v)}>
              <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 12.5 }}>
                {customMode ? t('date.showSuggested') : t('date.showCustom')}
              </Text>
            </Pressable>
          </HStack>

          {customMode ? (
            <HStack className="flex-wrap gap-2">
              {otherDates.map((d) => {
                const active = d.getTime() === selectedDate.getTime();
                return (
                  <Pressable
                    key={d.toISOString()}
                    onPress={() => setSelectedDate(d)}
                    className="items-center rounded-[12px] border px-3 py-2"
                    style={{
                      borderColor: active ? colors.green : colors.hairline,
                      backgroundColor: active ? colors.bgSunken : colors.bgCard,
                    }}
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 13 }}>
                      {tCommon(`weekdaysAbbr.${WEEKDAY_KEYS[d.getUTCDay()]}`)} {d.getUTCDate()}.{d.getUTCMonth() + 1}.
                    </Text>
                  </Pressable>
                );
              })}
            </HStack>
          ) : (
            <VStack className="gap-2">
              {suggested.map((d) => {
                const active = d.getTime() === selectedDate.getTime();
                return (
                  <Pressable
                    key={d.toISOString()}
                    onPress={() => setSelectedDate(d)}
                    className="flex-row items-center gap-3 rounded-[14px] border px-4 py-3"
                    style={{
                      borderColor: active ? colors.green : colors.hairline,
                      backgroundColor: active ? colors.bgSunken : colors.bgCard,
                    }}
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                      {tCommon(`weekdaysAbbr.${WEEKDAY_KEYS[d.getUTCDay()]}`)}, {d.getUTCDate()}. {tCommon(`monthsShort.${MONTH_KEYS[d.getUTCMonth()]}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </VStack>
          )}
        </VStack>

        <VStack className="gap-2">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('time.label')}</Text>
          <HStack className="flex-wrap gap-2">
            {TIME_OPTIONS.map((opt) => {
              const active = opt === time;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setTime(opt)}
                  className="rounded-full border px-4 py-2"
                  style={{
                    borderColor: active ? colors.green : colors.hairline,
                    backgroundColor: active ? colors.bgSunken : colors.bgCard,
                  }}
                >
                  <Text className={active ? 'font-body-semibold text-ink' : 'font-body text-muted'} style={{ fontSize: 13.5 }}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack className="gap-2">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">{t('hall.label')}</Text>
          {halls.data?.docs.length ? (
            <VStack className="gap-2">
              {halls.data.docs.map((h) => {
                const active = hallId === h.id;
                return (
                  <Pressable
                    key={h.id}
                    onPress={() => setHallId(h.id)}
                    className="flex-row items-center justify-between rounded-[14px] border px-4 py-3"
                    style={{
                      borderColor: active ? colors.green : colors.hairline,
                      backgroundColor: active ? colors.bgSunken : colors.bgCard,
                    }}
                  >
                    <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>{h.name}</Text>
                    {h.note ? (
                      <Text className="font-body text-muted" style={{ fontSize: 12 }}>{h.note}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </VStack>
          ) : (
            <TextInput
              value={newHallName}
              onChangeText={setNewHallName}
              placeholder={t('hall.placeholder')}
              placeholderTextColor={colors.dim}
              className="rounded-[14px] border border-hairline bg-bg-card px-4 font-body-semibold text-ink"
              style={{ height: 50, fontSize: 15 }}
            />
          )}
        </VStack>

        <Pressable
          onPress={() => setRepeatWeekly((v) => !v)}
          className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5"
        >
          <VStack className="flex-1 gap-0.5 pr-3">
            <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
              {t('repeatWeekly.title')}
            </Text>
            <Text className="font-body text-muted" style={{ fontSize: 12 }}>
              {t('repeatWeekly.description', {
                weekdayPlural: tCommon(`weekdayPlural.${WEEKDAY_KEYS[selectedDate.getUTCDay()]}`),
              })}
            </Text>
          </VStack>
          <RepeatToggle active={repeatWeekly} />
        </Pressable>

        {error && (
          <Text className="font-body-semibold text-red" style={{ fontSize: 13 }}>
            {error}
          </Text>
        )}

        <Pressable
          onPress={handleSubmit}
          disabled={submitting}
          className="h-14 items-center justify-center rounded-[15px] bg-green active:opacity-90"
          style={{ opacity: submitting ? 0.7 : 1 }}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="font-body-bold text-white" style={{ fontSize: 17 }}>
              {t('submit')}
            </Text>
          )}
        </Pressable>
      </VStack>
    </ScrollView>
  );
}

/** Minimal pill/knob switch — stand-in until gluestack's real `Switch` is added (§4.2). */
function RepeatToggle({ active }: { active: boolean }) {
  return (
    <HStack
      className="rounded-full p-0.5"
      style={{ width: 46, height: 27, backgroundColor: active ? colors.green : colors.bgSunken }}
    >
      <Box
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#fff',
          marginLeft: active ? 19 : 0,
        }}
      />
    </HStack>
  );
}
