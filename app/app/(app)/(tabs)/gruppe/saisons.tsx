import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { ApiSeason } from '@/lib/api';
import { colors } from '@/theme/tokens';

function seasonSub(s: ApiSeason): string {
  if (!s.startDate && !s.endDate) return s.status === 'active' ? 'Aktive Saison' : 'Abgeschlossen';
  const from = s.startDate ? new Date(s.startDate).toLocaleDateString('de-AT', { month: '2-digit', year: 'numeric' }) : '?';
  const to = s.endDate ? new Date(s.endDate).toLocaleDateString('de-AT', { month: '2-digit', year: 'numeric' }) : '?';
  return `${from} – ${to}`;
}

/**
 * Saisons verwalten — admin-only, reachable from Gruppe → Einstellungen.
 * Season-management feature plan (`claude/feature-plan-seasons-and-multigroup.md`
 * §A): a group can have several seasons over time, but exactly one is
 * `active` at once — `playerSeasonStats`, fixtures, and the Statistik
 * screen's "Saison" scope all key off whichever that is.
 *
 * "Neue Saison starten" always makes the new season active immediately —
 * matching the everyday flow of "close out the old one, begin the new
 * one" — which is why there's no separate makeActive toggle here even
 * though the backend endpoint supports one. "Season abschließen" ends the
 * active season without necessarily starting a new one right away (the
 * backend lazily seeds a placeholder active season the next time one is
 * needed, e.g. a new fixture, so nothing else breaks in the meantime);
 * "Reaktivieren" reopens a completed season if a rollover was a mistake.
 */
export default function SaisonsScreen() {
  const { group, membership } = useAuth();
  const isAdmin = membership?.role === 'admin' || membership?.role === 'organizer';
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const seasonsQuery = useQuery({
    queryKey: ['seasons', group?.id],
    queryFn: () => api.getSeasons(group!.id),
    enabled: Boolean(group),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['seasons', group?.id] });
    // Which season is active affects every `scope=season` stats query and
    // Fixtures.ts's default season for new fixtures.
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'stats' });
  }

  const createMutation = useMutation({
    mutationFn: (data: { label: string }) => api.createSeason(group!.id, data),
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setLabel('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Etwas ist schiefgelaufen.'),
  });

  const completeMutation = useMutation({
    mutationFn: (seasonId: string) => api.completeSeason(seasonId),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Etwas ist schiefgelaufen.'),
  });

  const activateMutation = useMutation({
    mutationFn: (seasonId: string) => api.activateSeason(seasonId),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Etwas ist schiefgelaufen.'),
  });

  function startCreate() {
    setCreating(true);
    setLabel('');
    setError(null);
  }

  function save() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Bezeichnung ist erforderlich.');
      return;
    }
    setError(null);
    createMutation.mutate({ label: trimmed });
  }

  if (!group || !isAdmin) {
    return (
      <ScrollView className="flex-1 bg-bg-screen">
        <ScreenHeader eyebrow="ADMIN" title="Saisons" onBack={() => router.back()} />
        <Text className="font-body text-muted px-5 pt-4" style={{ fontSize: 13.5 }}>
          Nur für Admins und Organisatoren.
        </Text>
      </ScrollView>
    );
  }

  const seasons = seasonsQuery.data?.docs ?? [];
  const pending = completeMutation.isPending || activateMutation.isPending;

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader eyebrow="ADMIN" title="Saisons" onBack={() => router.back()} />
      <VStack className="gap-5 px-5 pt-4">
        <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
          Genau eine Saison ist zu jedem Zeitpunkt aktiv — an ihr hängen neue Termine und die
          „Saison"-Statistik. Eine neue Saison zu starten schließt die aktuelle automatisch ab.
        </Text>

        <VStack className="gap-2.5">
          {seasonsQuery.isLoading ? (
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              Lädt…
            </Text>
          ) : seasons.length === 0 ? (
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              Noch keine Saisons angelegt.
            </Text>
          ) : (
            seasons.map((s) => {
              const active = s.status === 'active';
              return (
                <HStack
                  key={s.id}
                  className="items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5"
                >
                  <HStack className="flex-1 items-center gap-2 pr-3">
                    <VStack className="flex-1 gap-0.5">
                      <HStack className="items-center gap-1.5">
                        <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                          {s.label}
                        </Text>
                        {active ? (
                          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green }} />
                        ) : null}
                      </HStack>
                      <Text className="font-body text-muted" style={{ fontSize: 12 }}>
                        {seasonSub(s)}
                      </Text>
                    </VStack>
                  </HStack>
                  {active ? (
                    <Pressable
                      onPress={() => completeMutation.mutate(s.id)}
                      disabled={pending}
                      className="rounded-[12px] border px-3.5 py-2"
                      style={{ borderColor: colors.hairline }}
                    >
                      <Text className="font-body-semibold text-muted" style={{ fontSize: 12.5 }}>
                        {completeMutation.isPending ? '…' : 'Abschließen'}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => activateMutation.mutate(s.id)}
                      disabled={pending}
                      className="rounded-[12px] border px-3.5 py-2"
                      style={{ borderColor: colors.green }}
                    >
                      <Text className="font-body-semibold text-green" style={{ fontSize: 12.5 }}>
                        {activateMutation.isPending ? '…' : 'Reaktivieren'}
                      </Text>
                    </Pressable>
                  )}
                </HStack>
              );
            })
          )}
        </VStack>

        {creating ? (
          <VStack className="gap-3 rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5">
            <VStack className="gap-1.5">
              <Text className="font-body-semibold text-[10px] tracking-[1.5px] uppercase text-dim">
                Bezeichnung
              </Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="z.B. 26/27"
                placeholderTextColor={colors.dim}
                className="rounded-[12px] border border-hairline bg-bg-sunken px-3.5 font-body-semibold text-ink"
                style={{ height: 44, fontSize: 14.5 }}
              />
            </VStack>
            <HStack className="items-center justify-between pt-1">
              <Pressable onPress={() => setCreating(false)} className="px-1 py-1.5">
                <Text className="font-body-semibold text-muted" style={{ fontSize: 13 }}>
                  Abbrechen
                </Text>
              </Pressable>
              <Pressable onPress={save} disabled={createMutation.isPending} className="rounded-[12px] bg-green px-4 py-2">
                <Text className="font-body-bold" style={{ fontSize: 13, color: '#07120C' }}>
                  {createMutation.isPending ? '…' : 'Speichern'}
                </Text>
              </Pressable>
            </HStack>
          </VStack>
        ) : (
          <Pressable
            onPress={startCreate}
            className="items-center rounded-[14px] border border-dashed px-4 py-3.5 active:opacity-80"
            style={{ borderColor: colors.hairline }}
          >
            <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 13.5 }}>
              + Neue Saison starten
            </Text>
          </Pressable>
        )}

        {error ? (
          <Text className="font-body-semibold text-red" style={{ fontSize: 13 }}>
            {error}
          </Text>
        ) : null}
      </VStack>
    </ScrollView>
  );
}
