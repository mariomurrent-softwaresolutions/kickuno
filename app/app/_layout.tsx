import '@/global.css';
import '@/lib/i18n';
import { useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
} from '@expo-google-fonts/barlow';
import {
  BarlowCondensed_500Medium,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
} from '@expo-google-fonts/barlow-condensed';

import { queryClient } from '@/lib/query-client';
import { AuthProvider } from '@/lib/auth-context';
import { FeaturesProvider } from '@/lib/features-context';
import { colors } from '@/theme/tokens';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // react-query has no built-in notion of "window focus" on native — this
  // is the standard recipe (TanStack Query's own React Native guide) for
  // getting the same effect: coming back to the app from the background
  // (or switching back to it from another app) now re-triggers a refetch
  // of every stale/active query, the same way a browser tab regaining
  // focus would on web. Without this, e.g. saving an Ergebnis and then
  // backgrounding + foregrounding the app (rather than navigating within
  // it, which invalidateQueries already covers) could still show stale
  // Statistik/Spielerprofil numbers.
  useEffect(() => {
    function onAppStateChange(status: AppStateStatus) {
      if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
      }
    }
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GluestackUIProvider mode="dark">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FeaturesProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bgScreen },
              }}
            />
          </FeaturesProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GluestackUIProvider>
  );
}
