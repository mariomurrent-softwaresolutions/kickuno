import { router } from 'expo-router';
import { ComingSoonScreen } from '@/components/ui/coming-soon';

export default function NeuerTerminScreen() {
  return (
    <ComingSoonScreen
      eyebrow="ANLEGEN"
      title="Neuer Termin"
      note="Datum/Uhrzeit/Halle-Auswahl + wöchentlich wiederholen — implementation-plan.md §4.5 (Neuer Termin)."
      onBack={() => router.back()}
    />
  );
}
