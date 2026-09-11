// @ts-ignore
import * as DevClient from 'expo-dev-client';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth-context';

export default function AppLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
