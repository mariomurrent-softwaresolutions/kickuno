import { Box, HStack, Pressable, Text, VStack } from './primitives';
import { ChevronForwardIcon } from './icons';
import { colors } from '@/theme/tokens';

type Props = {
  weekday: string;
  day: string;
  time: string;
  hallName?: string;
  /** e.g. "12 Zusagen" — omit entirely when `features.rsvp` is off (§3.8/§4.6). */
  attendanceLabel?: string;
  /** Shows a small green dot when this fixture's Ergebnis is already recorded. */
  hasResult?: boolean;
  /** e.g. "3:2" — shown beneath the hall name once an Ergebnis is recorded. */
  resultLabel?: string;
  onPress: () => void;
};

/** Termine list row — implementation-plan.md §4.2/§4.5. */
export function FixtureRow({ weekday, day, time, hallName, attendanceLabel, hasResult, resultLabel, onPress }: Props) {
  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <HStack className="items-center gap-3 rounded-[18px] border border-hairline bg-bg-card px-4 py-3">
        {/* Fixed-width slot at the start of the row, reserved on every row
            (not just the ones with a result) so the date tile still lines
            up regardless of whether this particular fixture has one. */}
        <Box style={{ width: 7, alignItems: 'center' }}>
          {hasResult ? (
            <Box style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.green }} />
          ) : null}
        </Box>
        <VStack className="w-12 items-center justify-center gap-0.5 rounded-[12px] bg-bg-sunken py-2">
          <Text className="font-body-semibold text-[10px] tracking-[1.5px] uppercase text-dim">{weekday}</Text>
          <Text className="font-heading text-ink" style={{ fontSize: 22, lineHeight: 23 }}>
            {day}
          </Text>
        </VStack>
        <VStack className="flex-1 gap-0.5">
          <Text className="font-body-semibold text-ink" style={{ fontSize: 15 }}>
            {time} Uhr
          </Text>
          {hallName ? (
            <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
              {hallName}
            </Text>
          ) : null}
          {resultLabel ? (
            <Text className="font-body-semibold text-green" style={{ fontSize: 12.5 }}>
              {resultLabel}
            </Text>
          ) : null}
        </VStack>
        {attendanceLabel ? (
          <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 12.5 }}>
            {attendanceLabel}
          </Text>
        ) : null}
        <ChevronForwardIcon color={colors.dim} />
      </HStack>
    </Pressable>
  );
}
