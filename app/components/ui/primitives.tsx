/**
 * Minimal placeholder primitives standing in for gluestack-ui's real
 * components.
 *
 * This repo's automated setup couldn't run `npx gluestack-ui init` / `add`
 * (both need an interactive terminal). Run these two commands yourself from
 * `app/`, in a normal terminal — they're safe to run any time and their
 * output can replace this file with gluestack-ui's actual copied-in
 * primitives without touching the screens that import from here:
 *
 *   npx gluestack-ui init
 *   npx gluestack-ui add box text vstack hstack pressable button input switch
 *
 * Until then, these thin NativeWind wrappers use the same names so every
 * screen already imports from "@/components/ui/primitives" and won't need
 * to change later.
 */
import {forwardRef} from 'react';
import {
  View,
  Text as RNText,
  Pressable as RNPressable,
  type ViewProps,
  type TextProps,
  type PressableProps,
} from 'react-native';

import {cn} from '@/lib/cn';

export const Box = View;

export const VStack = forwardRef<View, ViewProps & { className?: string }>(
  ({className, ...props}, ref) => <View ref={ref} className={cn('flex-col', className)} {...props} />
);
VStack.displayName = 'VStack';

export const HStack = forwardRef<View, ViewProps & { className?: string }>(
  ({className, ...props}, ref) => <View ref={ref} className={cn('flex-row', className)} {...props} />
);
HStack.displayName = 'HStack';

export const Text = forwardRef<RNText, TextProps & { className?: string }>(
  ({className, ...props}, ref) => (
    <RNText ref={ref} className={cn('font-body text-ink', className)} {...props} />
  )
);
Text.displayName = 'Text';

export const Pressable = forwardRef<View, PressableProps & { className?: string }>(
  ({className, ...props}, ref) => <RNPressable ref={ref} className={className} {...props} />
);
Pressable.displayName = 'Pressable';
