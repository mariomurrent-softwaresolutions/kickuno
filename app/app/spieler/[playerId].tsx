import { router, useLocalSearchParams } from 'expo-router';
import { ComingSoonScreen } from '@/components/ui/coming-soon';

/**
 * Spielerprofil — lives outside the tab groups so it can be pushed from
 * Start, Statistik, Termin-Detail, or Gruppe and back() always returns to
 * whichever tab opened it (implementation-plan.md §4.3). `playerId` may
 * resolve to a `users` or a `legacyPlayers` record (§3.7).
 */
export default function SpielerprofilScreen() {
  const { playerId } = useLocalSearchParams<{ playerId: string }>();
  return (
    <ComingSoonScreen
      eyebrow="SPIELERPROFIL"
      title={`Spieler #${playerId}`}
      note="Kopfzeile, Form, Saison-Grid, All-Time-Liste — implementation-plan.md §4.5 (Spielerprofil)."
      onBack={() => router.back()}
    />
  );
}
