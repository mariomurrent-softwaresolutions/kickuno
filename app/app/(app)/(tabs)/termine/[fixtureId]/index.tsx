import { router, useLocalSearchParams } from 'expo-router';
import { ComingSoonScreen } from '@/components/ui/coming-soon';

export default function TerminDetailScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  return (
    <ComingSoonScreen
      eyebrow="TERMIN"
      title={`#${fixtureId}`}
      note="Team-Builder (Zusagen/Eingeteilt/Balance, Auto-Aufstellung, Rot/Grün-Pools) — implementation-plan.md §4.5 (Termin-Detail)."
      onBack={() => router.back()}
    />
  );
}
