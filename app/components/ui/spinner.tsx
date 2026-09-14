import { ActivityIndicator, type ColorValue } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * Loading indicator standing in for gluestack-ui's real Spinner
 * (https://gluestack.io/ui/docs/components/spinner) — same situation as
 * components/ui/primitives.tsx: this repo hasn't run `npx gluestack-ui add
 * spinner` yet, and gluestack's own Spinner is itself just a themed
 * wrapper around React Native's ActivityIndicator, so this thin wrapper
 * matches it directly and can be swapped later without touching call
 * sites.
 *
 * Used in place of the old "Lädt…" loading-state text throughout the app.
 */
export function Spinner({
  size = 'small',
  color = colors.mutedSoft,
}: {
  size?: 'small' | 'large';
  color?: ColorValue;
}) {
  return <ActivityIndicator size={size} color={color} />;
}
