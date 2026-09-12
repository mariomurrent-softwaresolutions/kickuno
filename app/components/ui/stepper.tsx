import * as Haptics from 'expo-haptics';

import { HStack, Pressable, Text } from './primitives';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
};

// Light impact on every tap — implementation-plan.md §4.1: "expo-haptics
// (light impact) on the goal +/- steppers and RSVP buttons — small parity
// touch, not in the original but cheap and expected on a real device."
// Fire-and-forget: haptics are a side effect, never worth blocking or
// failing the actual +/- on (e.g. on a simulator with no haptics engine).
function tick() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Goal stepper ("– value +") — implementation-plan.md §4.2. */
export function Stepper({ value, onChange, min = 0 }: Props) {
  return (
    <HStack className="items-center gap-3 rounded-full bg-bg-sunken px-1 py-1">
      <Pressable
        onPress={() => {
          tick();
          onChange(Math.max(min, value - 1));
        }}
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
        onPress={() => {
          tick();
          onChange(value + 1);
        }}
        className="h-7 w-7 items-center justify-center rounded-full bg-bg-card active:opacity-70"
      >
        <Text className="font-body-bold text-ink" style={{ fontSize: 15 }}>
          +
        </Text>
      </Pressable>
    </HStack>
  );
}
