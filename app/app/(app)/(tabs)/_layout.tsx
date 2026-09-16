import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HStack, Pressable, Text } from '@/components/ui/primitives';
import { GruppeIcon, ProfilIcon, StartIcon, StatistikIcon, TermineIcon } from '@/components/ui/icons';
import { colors } from '@/theme/tokens';

const ICONS = [StartIcon, TermineIcon, StatistikIcon, GruppeIcon, ProfilIcon];

export default function TabsLayout() {
  const { t } = useTranslation('common');
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: t('tabs.start') }} />
      <Tabs.Screen name="termine" options={{ title: t('tabs.termine') }} />
      <Tabs.Screen name="statistik" options={{ title: t('tabs.statistik') }} />
      <Tabs.Screen name="gruppe" options={{ title: t('tabs.gruppe') }} />
      <Tabs.Screen name="profil" options={{ title: t('tabs.profil') }} />
    </Tabs>
  );
}

/**
 * Custom tab bar matching the prototype's bar exactly (icons + active/inactive
 * ink vs. dim coloring) — Expo Router's default bar doesn't match this look.
 *
 * A 5th tab ("Profil") was added on top of the prototype's original 4
 * (Start/Termine/Statistik/Gruppe, §4.3) — a dedicated place for the
 * signed-in user's own account + logout, instead of the "Abmelden" link
 * that used to sit on the Start screen as a dev convenience.
 *
 * Typed loosely (BottomTabBarProps isn't resolvable as a standalone import
 * here — it comes in transitively through expo-router/@react-navigation) —
 * fine for a render-prop passthrough like this.
 */
function AppTabBar({ state, descriptors, navigation }: any) {
  return (
    <HStack
      className="border-t border-hairline bg-bg-screen"
      style={{ paddingTop: 8, paddingBottom: 26, paddingHorizontal: 10 }}
    >
      {state.routes.map((route: any, index: number) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const Icon = ICONS[index];
        const color = focused ? colors.ink : colors.dim;

        return (
          <Pressable
            key={route.key}
            className="flex-1 items-center gap-1"
            style={{ paddingVertical: 6 }}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
          >
            <Icon color={color} />
            <Text style={{ color, fontSize: 10, letterSpacing: 0.5 }} className="font-body-semibold">
              {options.title}
            </Text>
          </Pressable>
        );
      })}
    </HStack>
  );
}
