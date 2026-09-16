import { Box, HStack, Text } from './primitives';
import { colors } from '@/theme/tokens';

export const FORM_COLORS: Record<'S' | 'U' | 'N', string> = { S: colors.green, U: colors.gold, N: colors.red };

type Props = {
  results: ('S' | 'U' | 'N')[];
  emptyLabel: string;
  size?: number;
};

/**
 * Last-5 form pills (S/U/N) — implementation-plan.md §4.2. Extracted out of
 * Spielerprofil (phase 5) so the Start screen's own-form strip (phase 5,
 * finally wired up — see (tabs)/index.tsx) can render the exact same pills
 * instead of duplicating the color map + markup.
 */
export function FormPills({ results, emptyLabel, size = 30 }: Props) {
  if (!results.length) {
    return (
      <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
        {emptyLabel}
      </Text>
    );
  }
  return (
    <HStack className="gap-2">
      {results.map((result, index) => (
        <Box
          key={index}
          className="items-center justify-center rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: `${FORM_COLORS[result]}22`,
            borderWidth: 1,
            borderColor: FORM_COLORS[result],
          }}
        >
          <Text className="font-body-bold" style={{ fontSize: Math.round(size * 0.42), color: FORM_COLORS[result] }}>
            {result}
          </Text>
        </Box>
      ))}
    </HStack>
  );
}
