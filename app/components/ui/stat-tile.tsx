import { Text, VStack } from './primitives';
import { colors } from '@/theme/tokens';

type Props = {
  label: string;
  value: string;
  valueColor?: string;
};

/**
 * Grouped stat tile — implementation-plan.md §4.2 ("Grouped stat tiles
 * (4-up grid)"). Used by Termin-Detail's Zusagen/Eingeteilt/Balance row now;
 * Start's season tiles and Spielerprofil's stat grid (phase 5) reuse it.
 */
export function StatTile({ label, value, valueColor }: Props) {
  return (
    <VStack className="flex-1 items-center gap-1 rounded-[16px] border border-hairline bg-bg-card py-3">
      <Text className="font-heading text-[22px]" style={{ color: valueColor ?? colors.ink, lineHeight: 23 }}>
        {value}
      </Text>
      <Text className="font-body-semibold text-[10px] uppercase tracking-[1.5px] text-dim">{label}</Text>
    </VStack>
  );
}
