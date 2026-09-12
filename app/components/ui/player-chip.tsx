import type { ReactNode } from 'react';
import { Pressable, Text } from './primitives';

type Props = {
  name: string;
  strength?: number;
  tint?: 'red' | 'green' | 'neutral';
  onPress?: () => void;
  trailing?: ReactNode;
};

const TINTS: Record<'red' | 'green' | 'neutral', { border: string; bg: string }> = {
  red: { border: 'rgba(226,59,59,0.35)', bg: 'rgba(226,59,59,0.10)' },
  green: { border: 'rgba(47,191,110,0.35)', bg: 'rgba(47,191,110,0.10)' },
  neutral: { border: 'rgba(255,255,255,0.07)', bg: '#101416' },
};

/**
 * Player chip — implementation-plan.md §4.2 ("pill w/ avatar + name +
 * strength, red/green tinted"). No avatar image in this pass (the prototype
 * itself just uses initials-in-a-circle, which the pool/team rows here
 * don't render yet — see the Termin-Detail screen). `onPress` unset renders
 * a plain, non-interactive chip (regular players viewing a team they can't
 * edit — §3.4).
 */
export function PlayerChip({ name, strength, tint = 'neutral', onPress, trailing }: Props) {
  const t = TINTS[tint];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center gap-2 rounded-full border px-3 py-2 active:opacity-80"
      style={{ borderColor: t.border, backgroundColor: t.bg }}
    >
      <Text className="font-body-semibold text-ink" style={{ fontSize: 13 }} numberOfLines={1}>
        {name}
      </Text>
      {typeof strength === 'number' ? (
        <Text className="font-body text-muted" style={{ fontSize: 11.5 }}>
          ★{strength}
        </Text>
      ) : null}
      {trailing}
    </Pressable>
  );
}
