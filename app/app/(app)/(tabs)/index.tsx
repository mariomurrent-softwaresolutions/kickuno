import { ScrollView } from 'react-native';
import { Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useAuth } from '@/lib/auth-context';

/**
 * Start / dashboard tab. TODO: next-fixture card, season tiles, last-5 form,
 * last game score, top-3 scorers — see implementation-plan.md §4.5 (Start).
 */
export default function StartScreen() {
  const { logout } = useAuth();
  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 26 }}>
      <ScreenHeader eyebrow="HALLENKICK DONNERSTAG" title="Servus" />
      <VStack className="gap-3 px-5 pt-4">
        <Text className="font-body text-muted">
          Nächster Termin, Saison-Kacheln, Form und Top-Scorer kommen hier hin — siehe
          implementation-plan.md §4.5 (Start).
        </Text>
        <Text onPress={logout} className="font-body-semibold text-red">
          Abmelden (Dev)
        </Text>
      </VStack>
    </ScrollView>
  );
}
