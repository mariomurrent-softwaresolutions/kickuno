import { HStack, Pressable, Text, VStack } from './primitives';
import { ChevronBackIcon } from './icons';
import { colors } from '@/theme/tokens';

type Props = {
  eyebrow: string;
  title: string;
  onBack?: () => void;
};

/**
 * The single header pattern used across every in-app screen (see the
 * prototype's "app shell" header markup) — eyebrow label + big condensed
 * title, with an optional back chevron for pushed screens.
 */
export function ScreenHeader({ eyebrow, title, onBack }: Props) {
  return (
    <HStack
      className="items-end gap-3 bg-bg-app border-b border-hairline px-5"
      style={{ paddingTop: 60, paddingBottom: 12 }}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          className="w-9 h-9 rounded-[11px] border border-hairline bg-bg-card items-center justify-center"
        >
          <ChevronBackIcon color={colors.ink} />
        </Pressable>
      ) : null}
      <VStack className="flex-1 gap-0.5">
        <Text className="font-body-semibold text-[10px] tracking-[3px] uppercase text-dim">
          {eyebrow}
        </Text>
        <Text
          className="font-heading text-[27px] uppercase text-ink"
          style={{ lineHeight: 29 }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </VStack>
    </HStack>
  );
}
