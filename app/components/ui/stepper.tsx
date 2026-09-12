import { HStack, Pressable, Text } from './primitives';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
};

/** Goal stepper ("– value +") — implementation-plan.md §4.2. */
export function Stepper({ value, onChange, min = 0 }: Props) {
  return (
    <HStack className="items-center gap-3 rounded-full bg-bg-sunken px-1 py-1">
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        className="h-7 w-7 items-center justify-center rounded-full bg-bg-card active:opacity-70"
      >
        <Text className="font-body-bold text-ink" style={{ fontSize: 15 }}>
          –
        </Text>
      </Pressable>
      <Text className="font-heading text-ink" style={{ fontSize: 16, minWidth: 18, textAlign: 'center' }}>
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(value + 1)}
        className="h-7 w-7 items-center justify-center rounded-full bg-bg-card active:opacity-70"
      >
        <Text className="font-body-bold text-ink" style={{ fontSize: 15 }}>
          +
        </Text>
      </Pressable>
    </HStack>
  );
}
