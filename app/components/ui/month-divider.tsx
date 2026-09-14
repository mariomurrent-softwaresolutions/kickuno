import { Box, HStack, Text } from './primitives';
import { colors } from '@/theme/tokens';

/**
 * A labeled hairline between two months' worth of fixtures — implements
 * "month as a separator" instead of repeating it on every date tile.
 * Shared by the main Termine list and the per-season Termine list.
 */
export function MonthDivider({ label }: { label: string }) {
  return (
    <HStack className="items-center gap-2.5">
      <Text className="font-body-semibold text-[11px] tracking-[1.5px] uppercase text-muted-soft">{label}</Text>
      <Box className="h-px flex-1" style={{ backgroundColor: colors.hairline }} />
    </HStack>
  );
}
