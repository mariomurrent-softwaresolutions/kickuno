import { useEffect, useRef } from 'react';
import { Animated, Easing, type DimensionValue } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * A pulsing placeholder block, standing in for content that hasn't loaded
 * yet. Used on the Saison-Übersicht screen (`claude/
 * feature-plan-stats-enhancements.md` §A/§B/§C) so the season-overview
 * card, Beste Duos, and Hall of Fame have a visible loading shape instead
 * of rendering nothing until their query resolves and popping in
 * unannounced — the same complaint `Spinner` already solves for the
 * Rangliste screen's ranked list, just shaped like the content it's
 * standing in for rather than a spinner, since these are card-shaped
 * blocks rather than a single async action.
 *
 * No new dependency — a plain `Animated.loop` (React Native core), same
 * situation as `Spinner`'s own doc comment: nothing here needed
 * react-native-reanimated, which isn't otherwise used in this app yet.
 */
export function Skeleton({
  width = '100%',
  height,
  radius = 6,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
}) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{ width, height, borderRadius: radius, backgroundColor: colors.bgSunken, opacity }}
    />
  );
}
