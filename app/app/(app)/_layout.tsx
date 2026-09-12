// @ts-ignore
import * as DevClient from 'expo-dev-client';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { FeaturesProvider } from '@/lib/features-context';
import { Box } from '@/components/ui/primitives';

export default function AppLayout() {
  const { status, group } = useAuth();
  if (status === 'loading') return <Box className="flex-1 bg-bg-screen" />;
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;
  if (status === 'needsGroup') return <Redirect href="/(auth)/join" />;
  return (
    <FeaturesProvider value={group?.features}>
      <Stack screenOptions={{ headerShown: false }} />
    </FeaturesProvider>
  );
}
