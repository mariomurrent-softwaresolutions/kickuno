import { HStack, Pressable, Text, VStack } from './primitives';
import { ChevronForwardIcon } from './icons';
import { colors } from '@/theme/tokens';

type Props = {
  weekday: string;
  day: string;
  time: string;
  hallName?: string;
  /** e.g. "12 Zusagen" — omit entirely when `features.rsvp` is off (§3.8/§4.6). */
  attendanceLabel?: string;
  onPress: () => void;
};

/** Termine list row — implementation-plan.md §4.2/§4.5. */
export function FixtureRow({ weekday, day, time, hallName, attendanceLabel, onPress }: Props) {
  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <HStack className="items-center gap-3 rounded-[18px] border border-hairline bg-bg-card px-4 py-3">
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
