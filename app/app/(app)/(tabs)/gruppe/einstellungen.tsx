import { router } from 'expo-router';
import { ComingSoonScreen } from '@/components/ui/coming-soon';

/** Admin-only feature-flag toggles (RSVP / Auto-Balance / Stärke) — implementation-plan.md §3.8 + §4.6. */
export default function EinstellungenScreen() {
  return (
    <ComingSoonScreen
      eyebrow="ADMIN"
      title="Einstellungen"
      note="Drei Switches: RSVP, Auto-Aufstellung, Stärke — PATCH /api/groups/:id auf group.features."
      onBack={() => router.back()}
    />
  );
}
