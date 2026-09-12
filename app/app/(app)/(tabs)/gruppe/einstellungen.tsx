import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ApiGroupFeatures } from '@/lib/api';
import { colors } from '@/theme/tokens';

const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'So' },
];

type FlagKey = keyof ApiGroupFeatures;

const FLAGS: { key: FlagKey; label: string; hint: string }[] = [
  { key: 'rsvp', label: 'Zusagen (RSVP)', hint: 'Bin dabei / Kann nicht auf dem nächsten Termin.' },
  { key: 'autoBalance', label: 'Auto-Aufstellung', hint: 'Automatische Teamverteilung nach Stärke/Toren.' },
  { key: 'strength', label: 'Stärke', hint: 'Stärke-Wert auf Profilen, Chips und der Balance-Anzeige.' },
];

/**
 * Admin-only group settings — implementation-plan.md §3.8/§4.5/§4.6. Every
 * change PATCHes `/api/groups/:id` immediately (no separate save step,
 * matching the plan's "instant optimistic flip" for these toggles) and then
 * reloads the group via `refreshGroup()` so the rest of the app (e.g.
 * Neuer Termin's date suggestions) picks it up right away.
 */
export default function EinstellungenScreen() {
  const { group, membership, refreshGroup } = useAuth();
  const isAdmin = membership?.role === 'admin';
  const [savingDay, setSavingDay] = useState(false);
  const [savingFlag, setSavingFlag] = useState<FlagKey | null>(null);

  async function setDefaultGameDay(day: number) {
    if (!group || savingDay || day === group.defaultGameDay) return;
    setSavingDay(true);
    try {
      await api.updateGroup(group.id, { defaultGameDay: day });
      await refreshGroup();
    } finally {
      setSavingDay(false);
    }
  }

  async function toggleFlag(key: FlagKey) {
    if (!group || savingFlag) return;
    setSavingFlag(key);
    try {
      // Send the full `features` object, not a partial one — Payload
      // replaces a `group`-type field wholesale on update rather than
      // deep-merging its sub-fields, so a partial patch here would silently
      // clear the other two flags.
      await api.updateGroup(group.id, { features: { ...group.features, [key]: !group.features[key] } });
      await refreshGroup();
    } finally {
      setSavingFlag(null);
    }
  }

  if (!group || !isAdmin) {
    return (
      <ScrollView className="flex-1 bg-bg-screen">
        <ScreenHeader eyebrow="ADMIN" title="Einstellungen" onBack={() => router.back()} />
        <Text className="font-body text-muted px-5 pt-4" style={{ fontSize: 13.5 }}>
          Nur für Admins.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader eyebrow="ADMIN" title="Einstellungen" onBack={() => router.back()} />
      <VStack className="gap-6 px-5 pt-4">
        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">
            Standard-Spieltag
          </Text>
          <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
            Der Tag, den „Neuer Termin" standardmäßig vorschlägt — andere Tage lassen sich dort
            trotzdem jederzeit über „Anderes Datum wählen" auswählen.
          </Text>
          <HStack className="flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map(({ value, label }) => {
              const active = group.defaultGameDay === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setDefaultGameDay(value)}
                  disabled={savingDay}
                  className="rounded-full border px-4 py-2"
                  style={{
                    borderColor: active ? colors.green : colors.hairline,
                    backgroundColor: active ? colors.bgSunken : colors.bgCard,
                  }}
                >
                  <Text
                    className="font-body-semibold"
                    style={{ fontSize: 13, color: active ? colors.green : colors.ink }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack className="gap-3">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">Funktionen</Text>
          {FLAGS.map(({ key, label, hint }) => {
            const on = Boolean(group.features[key]);
            return (
              <Pressable
                key={key}
                onPress={() => toggleFlag(key)}
                disabled={savingFlag === key}
                className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3"
              >
                <VStack className="flex-1 gap-0.5 pr-3">
                  <Text className="font-body-semibold text-ink" style={{ fontSize: 14 }}>
                    {label}
                  </Text>
                  <Text className="font-body text-muted" style={{ fontSize: 12 }}>
                    {hint}
                  </Text>
                </VStack>
                <HStack
                  className="rounded-full p-0.5"
                  style={{ width: 46, height: 27, backgroundColor: on ? colors.green : colors.bgSunken }}
                >
                  <Box
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: '#fff',
                      marginLeft: on ? 19 : 0,
                    }}
                  />
                </HStack>
              </Pressable>
            );
          })}
        </VStack>

        <VStack className="gap-2.5">
          <Text className="font-body-semibold text-[11px] tracking-[2px] uppercase text-dim">Hallen</Text>
          <Pressable
            onPress={() => router.push('/(app)/(tabs)/gruppe/hallen')}
            className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5"
          >
            <VStack className="flex-1 gap-0.5 pr-3">
              <Text className="font-body-semibold text-ink" style={{ fontSize: 14 }}>
                Hallen verwalten
              </Text>
              <Text className="font-body text-muted" style={{ fontSize: 12 }}>
                Namen, Kapazität und Notiz der Hallen für „Neuer Termin" bearbeiten.
              </Text>
            </VStack>
            <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 13 }}>
              ›
            </Text>
          </Pressable>
        </VStack>
      </VStack>
    </ScrollView>
  );
}
