/**
 * Raw token values for places that can't take a Tailwind className directly
 * (SVG stroke/fill props, LinearGradient colors, style objects). Keep these
 * in sync with tailwind.config.js by hand — see implementation-plan.md §4.2.
 */
export const colors = {
  bgApp: '#07090A',
  bgScreen: '#0B0E0F',
  bgCard: '#14181A',
  bgSunken: '#101416',
  hairline: 'rgba(255,255,255,0.07)',
  red: '#E23B3B',
  green: '#2FBF6E',
  gold: '#F4D35E',
  ink: '#F2F5F4',
  muted: '#6E7A76',
  mutedSoft: '#8A9490',
  dim: '#4E5754',
} as const;

export const radii = {
  sm: 11,
  md: 14,
  lg: 18,
  xl: 20,
  xxl: 26,
  pill: 9999,
} as const;

export const fonts = {
  heading: 'BarlowCondensed_700Bold',
  headingMedium: 'BarlowCondensed_600SemiBold',
  body: 'Barlow_500Medium',
  bodyRegular: 'Barlow_400Regular',
  bodySemibold: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
} as const;
