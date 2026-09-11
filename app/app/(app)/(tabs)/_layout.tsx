import { Tabs } from 'expo-router';

import { HStack, Pressable, Text } from '@/components/ui/primitives';
import { GruppeIcon, StartIcon, StatistikIcon, TermineIcon } from '@/components/ui/icons';
import { colors } from '@/theme/tokens';

const ICONS = [StartIcon, TermineIcon, StatistikIcon, GruppeIcon];

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Start' }} />
      <Tabs.Screen name="termine" options={{ title: 'Termine' }} />
      <Tabs.Screen name="statistik" options={{ title: 'Statistik' }} />
      <Tabs.Screen name="gruppe" options={{ title: 'Gruppe' }} />
    </Tabs>
  );
}

/**
 * Custom tab bar matching the prototype's bar exactly (icons + active/inactive
 * ink vs. dim coloring) — Expo Router's default bar doesn't match this look.
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
