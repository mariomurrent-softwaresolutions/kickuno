import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { Box } from '@/components/ui/primitives';

export default function AuthLayout() {
  const { status } = useAuth();
  const segments = useSegments();
  // This layout wraps every (auth) screen, including join.tsx itself — so
  // the needsGroup redirect below must not fire once we're already ON the
  // join screen, or it redirects to itself forever (Redirect replaces the
  // Stack every render, so join.tsx never actually gets to mount and the
  // "already there" case never resolves — this is exactly what caused the
  // "Maximum update depth exceeded" loop right after logging in).
  const onJoinScreen = segments[segments.length - 1] === 'join';

  if (status === 'loading') return <Box className="flex-1 bg-bg-screen" />;
  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  if (status === 'needsGroup' && !onJoinScreen) return <Redirect href="/(auth)/join" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
