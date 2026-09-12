import { useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ChevronForwardIcon } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ApiMemberRow } from '@/lib/api';
import { colors } from '@/theme/tokens';

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', organizer: 'Organisator', player: 'Spieler' };
const ROLE_COLORS: Record<string, string> = { admin: colors.gold, organizer: colors.green, player: colors.dim };
const POSITION_LABELS: Record<string, string> = { tor: 'Tor', abwehr: 'Abwehr', mitte: 'Mitte', sturm: 'Sturm' };

// implementation-plan.md §4.5 names the prototype's three filter chips
// verbatim ("Alle/Organisatoren/Stammspieler"), but "Stammspieler" there
// means "played >= 10 games" (`support.js`'s `p.s.sp >= 10`) — an
// activity cut, not a role, and this screen's member-list endpoint
// (`GET /groups/:id/members`, this codebase's own design for §3.6) doesn't
// carry a played-games count. Reinterpreted as a clean role partition
// instead — Alle / Organisatoren (admin+organizer) / Spieler — which covers
// every member exactly once, rather than pulling in an unrelated stats call
// just to reproduce an activity threshold the plan didn't otherwise need.
type RoleFilter = 'all' | 'leadership' | 'player';
const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'leadership', label: 'Organisatoren' },
  { key: 'player', label: 'Spieler' },
];

function avatarInitials(row: ApiMemberRow): string {
  return row.user?.initials ?? row.user?.name?.slice(0, 2).toUpperCase() ?? '?';
}

/**
 * Gruppe — implementation-plan.md §4.5: invite code + share, role filter
 * chips, member list (role badge; admin/organizer additionally see
 * `strength` next to a `suggestedStrength` hint with one-tap "Übernehmen"
 * whenever they differ and a suggestion exists — §3.3), and the admin-only
 * entry into Einstellungen (pulled forward in phase 4).
 *
 * "Logout" is deliberately not repeated here even though §4.5 lists it for
 * this screen — that was written before the Profil tab existed; Abmelden
 * has lived there since phase 4 (see `getting-started.md`), and duplicating
 * it in two places would just be inconsistent.
 *
 * The invite-code button is a straight clipboard copy, matching the
 * prototype's actual `onCopy` byte-for-byte: label flips "Teilen" ->
 * "Kopiert" for ~2s (its `copied` boolean), no share sheet involved — the
 * prototype's own button is literally named for sharing but its
 * implementation only ever copies, on the assumption the recipient pastes
 * that into WhatsApp themselves.
 */
export default function GruppeScreen() {
  const { group, membership } = useAuth();
  const isAdmin = membership?.role === 'admin';
  const isLeadership = membership?.role === 'admin' || membership?.role === 'organizer';
  const strengthEnabled = Boolean(group?.features.strength);

  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [regenerating, setRegenerating] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const membersQuery = useQuery({
    queryKey: ['group-members', group?.id],
    queryFn: () => api.getGroupMembers(group!.id),
    enabled: Boolean(group),
  });

  const members = membersQuery.data?.docs ?? [];
  const filtered = useMemo(
    () =>
      members.filter((m) => {
        if (roleFilter === 'all') return true;
        if (roleFilter === 'leadership') return m.role === 'admin' || m.role === 'organizer';
        return m.role === 'player';
      }),
    [members, roleFilter]
  );

  async function handleCopyCode() {
    if (!group) return;
    await Clipboard.setStringAsync(group.inviteCode);
    setCopied(true);
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
    // 2.2s, matching the prototype's own toast-dismiss timer (`flash()`'s
    // setTimeout) — there's no app-wide toast yet (phase 8), so the button
    // label flip is standing in for the "Code kopiert — ab in die
    // WhatsApp-Gruppe" confirmation until one exists.
    copyTimeout.current = setTimeout(() => setCopied(false), 2200);
  }

  async function handleRegenerateCode() {
    if (!group || regenerating) return;
    setRegenerating(true);
    try {
      await api.regenerateInviteCode(group.id);
      // The group's `inviteCode` in AuthContext only refreshes on the next
      // membership reload — there's no direct group setter, and this is a
      // rare admin action, so a full membersQuery refetch plus a page
      // revisit picking up the new code from AuthContext is an acceptable
      // trade-off over threading a new context setter through for this one
      // field.
      await membersQuery.refetch();
    } finally {
      setRegenerating(false);
    }
  }

  async function handleApplySuggested(row: ApiMemberRow) {
    if (applyingId || typeof row.suggestedStrength !== 'number') return;
    setApplyingId(row.id);
    try {
      await api.applySuggestedStrength(row.id);
      await membersQuery.refetch();
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-bg-screen"
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl tintColor={colors.dim} refreshing={membersQuery.isFetching} onRefresh={() => membersQuery.refetch()} />
      }
    >
      <ScreenHeader eyebrow="GRUPPE" title={group?.name ?? '…'} />
      <VStack className="gap-5 px-5 pt-4">
        {group ? (
          <VStack className="gap-3 rounded-[18px] border border-hairline bg-bg-card p-4">
            <Text className="font-body-semibold text-[10px] tracking-[2px] uppercase text-dim">Einladungs-Code</Text>
            <HStack className="items-center justify-between">
              <Text className="font-heading text-ink" style={{ fontSize: 26, letterSpacing: 3 }}>
                {group.inviteCode}
              </Text>
              <HStack className="gap-2">
                <Pressable
                  onPress={handleCopyCode}
                  className="rounded-[12px] border px-3.5 py-2.5"
                  style={{ borderColor: colors.green, backgroundColor: 'rgba(47,191,110,0.10)' }}
                >
                  <Text className="font-body-bold text-green" style={{ fontSize: 13 }}>
                    {copied ? 'Kopiert' : 'Teilen'}
                  </Text>
                </Pressable>
                {isLeadership ? (
                  <Pressable
                    onPress={handleRegenerateCode}
                    disabled={regenerating}
                    className="rounded-[12px] border border-hairline bg-bg-sunken px-3.5 py-2.5"
                  >
                    <Text className="font-body-semibold text-muted" style={{ fontSize: 13 }}>
                      {regenerating ? '…' : 'Neuer Code'}
                    </Text>
                  </Pressable>
                ) : null}
              </HStack>
            </HStack>
          </VStack>
        ) : null}

        {isAdmin && (
          <Pressable
            onPress={() => router.push('/(app)/(tabs)/gruppe/einstellungen')}
            className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5 active:opacity-85"
          >
            <VStack className="gap-0.5">
              <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                Einstellungen
              </Text>
              <Text className="font-body text-muted" style={{ fontSize: 12 }}>
                Standard-Spieltag, Zusagen, Auto-Aufstellung, Stärke
              </Text>
            </VStack>
            <ChevronForwardIcon color={colors.dim} />
          </Pressable>
        )}

        <HStack className="rounded-full border border-hairline bg-bg-card p-1">
          {ROLE_FILTERS.map(({ key, label }) => {
            const active = roleFilter === key;
            return (
              <Pressable
                key={key}
                onPress={() => setRoleFilter(key)}
                className="flex-1 items-center rounded-full py-2.5"
                style={{ backgroundColor: active ? colors.bgSunken : 'transparent' }}
              >
                <Text className="font-body-semibold" style={{ fontSize: 12.5, color: active ? colors.ink : colors.muted }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </HStack>

        <VStack className="gap-2">
          {membersQuery.isLoading ? (
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              Lädt…
            </Text>
          ) : filtered.length === 0 ? (
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              Keine Mitglieder in dieser Ansicht.
            </Text>
          ) : (
            filtered.map((row) => {
              const showSuggestion =
                isLeadership &&
                strengthEnabled &&
                typeof row.suggestedStrength === 'number' &&
                row.suggestedStrength !== row.strength;
              return (
                <Pressable
                  key={row.id}
                  onPress={() => row.user && router.push(`/spieler/${row.user.id}?kind=users`)}
                  disabled={!row.user}
                  className="rounded-[14px] border border-hairline bg-bg-card px-4 py-3 active:opacity-90"
                >
                  <HStack className="items-center justify-between">
                    <HStack className="flex-1 items-center gap-3 pr-3">
                      <Box
                        className="items-center justify-center rounded-full"
                        style={{ width: 38, height: 38, backgroundColor: colors.bgSunken }}
                      >
                        <Text className="font-body-bold text-ink" style={{ fontSize: 13 }}>
                          {avatarInitials(row)}
                        </Text>
                      </Box>
                      <VStack className="flex-1 gap-0.5">
                        <Text className="font-body-semibold text-ink" style={{ fontSize: 14 }} numberOfLines={1}>
                          {row.user?.name ?? 'Unbekannt'}
                        </Text>
                        <Text className="font-body text-muted" style={{ fontSize: 11.5 }} numberOfLines={1}>
                          {[
                            row.user?.position ? POSITION_LABELS[row.user.position] ?? row.user.position : null,
                            strengthEnabled && typeof row.strength === 'number' ? `Stärke ${row.strength}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </VStack>
                    </HStack>
                    <Box
                      className="rounded-full px-2.5 py-1"
                      style={{ borderWidth: 1, borderColor: `${ROLE_COLORS[row.role]}66` }}
                    >
                      <Text className="font-body-semibold" style={{ fontSize: 10.5, color: ROLE_COLORS[row.role] }}>
                        {ROLE_LABELS[row.role] ?? row.role}
                      </Text>
                    </Box>
                  </HStack>

                  {showSuggestion ? (
                    <HStack className="items-center justify-between pt-2.5 mt-2.5" style={{ borderTopWidth: 1, borderTopColor: colors.hairline }}>
                      <Text className="font-body text-muted-soft" style={{ fontSize: 12 }}>
                        Vorschlag: Stärke {row.suggestedStrength}
                      </Text>
                      <Pressable
                        onPress={() => handleApplySuggested(row)}
                        disabled={applyingId === row.id}
                        className="rounded-full border px-3 py-1.5"
                        style={{ borderColor: colors.gold, backgroundColor: 'rgba(244,211,94,0.10)' }}
                      >
                        <Text className="font-body-bold text-gold" style={{ fontSize: 11.5 }}>
                          {applyingId === row.id ? '…' : 'Übernehmen'}
                        </Text>
                      </Pressable>
                    </HStack>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </VStack>
      </VStack>
    </ScrollView>
  );
}
