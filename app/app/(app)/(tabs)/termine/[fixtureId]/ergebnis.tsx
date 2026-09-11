import { router } from 'expo-router';
import { ComingSoonScreen } from '@/components/ui/coming-soon';

export default function ErgebnisScreen() {
  return (
    <ComingSoonScreen
      eyebrow="ERGEBNIS"
      title="Rot gegen Grün"
      note="Score, Torschützen-Stepper, Eigentore, MVP-Auswahl — implementation-plan.md §4.5 (Ergebnis erfassen)."
      onBack={() => router.back()}
    />
  );
}
