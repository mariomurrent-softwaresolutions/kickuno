import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Box, HStack, Pressable, Text, VStack } from '@/components/ui/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { ApiHall } from '@/lib/api';
import { colors } from '@/theme/tokens';
import i18n from '@/lib/i18n';

type FormState = { name: string; capacity: string; note: string };
const EMPTY_FORM: FormState = { name: '', capacity: '', note: '' };

function hallSub(h: ApiHall): string {
  return [
    typeof h.capacity === 'number' ? i18n.t('hallen:capacitySuffix', { count: h.capacity }) : null,
    h.note || null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Hallen verwalten — admin-only, reachable from Gruppe → Einstellungen.
 * Known rough edge #7 from getting-started.md, now closed: a group's
 * halls previously could only ever be created (one at a time, on the fly)
 * from "Neuer Termin"'s free-text fallback, with no way to rename, set a
 * capacity/note after the fact, or remove one. Not in the original
 * prototype (which hardcoded 3 fixed halls) — implementation-plan.md's own
 * §10 open-items list called this out as worth adding "once a group has
 * more than one hall".
 *
 * Deleting a hall in use is blocked server-side (`Halls.ts`'s
 * `beforeDelete` hook) rather than silently orphaning any fixture that
 * references it — the error message from that hook is shown as-is (stays
 * German regardless of app language, feature-plan-i18n-localization.md).
 */
export default function HallenScreen() {
  const { t } = useTranslation('hallen');
  const { group, membership } = useAuth();
  const isAdmin = membership?.role === 'admin';
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const hallsQuery = useQuery({
    queryKey: ['halls', group?.id],
    queryFn: () => api.listHalls(group!.id),
    enabled: Boolean(group),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['halls', group?.id] });
    // Fixtures embed their hall (depth=1) in Termine/Start/Termin-Detail —
    // a rename should show up there without waiting for those screens'
    // own refetch interval.
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'fixtures' });
  }

  function startNew() {
    setEditingId('new');
    setForm(EMPTY_FORM);
    setError(null);
  }

  function startEdit(hall: ApiHall) {
    setEditingId(hall.id);
    setForm({ name: hall.name, capacity: typeof hall.capacity === 'number' ? String(hall.capacity) : '', note: hall.note ?? '' });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function parseCapacity(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  }

  const createMutation = useMutation({
    mutationFn: (data: { group: string; name: string; capacity?: number; note?: string }) => api.createHall(data),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : i18n.t('common:errors.generic')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ hallId, data }: { hallId: string; data: { name?: string; capacity?: number | null; note?: string | null } }) =>
      api.updateHall(hallId, data),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : i18n.t('common:errors.generic')),
  });

  const deleteMutation = useMutation({
    mutationFn: (hallId: string) => api.deleteHall(hallId),
    onSuccess: () => {
      invalidate();
      if (editingId !== 'new') setEditingId(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : i18n.t('common:errors.generic')),
  });

  function save() {
    if (!group) return;
    const name = form.name.trim();
    if (!name) {
      setError(t('errors.nameRequired'));
      return;
    }
    setError(null);
    const capacity = parseCapacity(form.capacity);
    const note = form.note.trim();
    if (editingId === 'new') {
      createMutation.mutate({ group: group.id, name, capacity, note: note || undefined });
    } else if (editingId) {
      updateMutation.mutate({ hallId: editingId, data: { name, capacity: capacity ?? null, note: note || null } });
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  if (!isAdmin) {
    return (
      <ScrollView className="flex-1 bg-bg-screen">
        <ScreenHeader eyebrow={t('eyebrow')} title={t('title')} onBack={() => router.back()} />
        <Text className="font-body text-muted px-5 pt-4" style={{ fontSize: 13.5 }}>
          {t('adminOnly')}
        </Text>
      </ScrollView>
    );
  }

  const halls = hallsQuery.data?.docs ?? [];

  return (
    <ScrollView className="flex-1 bg-bg-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader eyebrow={t('eyebrow')} title={t('title')} onBack={() => router.back()} />
      <VStack className="gap-5 px-5 pt-4">
        <Text className="font-body text-muted" style={{ fontSize: 12.5 }}>
          {t('description')}
        </Text>

        <VStack className="gap-2.5">
          {hallsQuery.isLoading ? (
            <Spinner />
          ) : halls.length === 0 && editingId !== 'new' ? (
            <Text className="font-body text-muted" style={{ fontSize: 13 }}>
              {t('empty')}
            </Text>
          ) : (
            halls.map((hall) => {
              const isEditing = editingId === hall.id;
              return (
                <VStack key={hall.id} className="rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5">
                  {isEditing ? (
                    <HallForm
                      form={form}
                      setForm={setForm}
                      onCancel={cancelEdit}
                      onSave={save}
                      onDelete={() => deleteMutation.mutate(hall.id)}
                      saving={saving}
                      deleting={deleteMutation.isPending}
                      showDelete
                    />
                  ) : (
                    <Pressable onPress={() => startEdit(hall)} className="flex-row items-center justify-between active:opacity-80">
                      <VStack className="flex-1 gap-0.5 pr-3">
                        <Text className="font-body-semibold text-ink" style={{ fontSize: 14.5 }}>
                          {hall.name}
                        </Text>
                        {hallSub(hall) ? (
                          <Text className="font-body text-muted" style={{ fontSize: 12 }}>
                            {hallSub(hall)}
                          </Text>
                        ) : null}
                      </VStack>
                      <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 12.5 }}>
                        {t('edit')}
                      </Text>
                    </Pressable>
                  )}
                </VStack>
              );
            })
          )}
        </VStack>

        {editingId === 'new' ? (
          <VStack className="rounded-[14px] border border-hairline bg-bg-card px-4 py-3.5">
            <HallForm form={form} setForm={setForm} onCancel={cancelEdit} onSave={save} saving={saving} showDelete={false} />
          </VStack>
        ) : (
          <Pressable
            onPress={startNew}
            className="items-center rounded-[14px] border border-dashed px-4 py-3.5 active:opacity-80"
            style={{ borderColor: colors.hairline }}
          >
            <Text className="font-body-semibold text-muted-soft" style={{ fontSize: 13.5 }}>
              {t('addNew')}
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

function HallForm({
  form,
  setForm,
  onCancel,
  onSave,
  onDelete,
  saving,
  deleting,
  showDelete,
}: {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  deleting?: boolean;
  showDelete: boolean;
}) {
  const { t } = useTranslation('hallen');
  return (
    <VStack className="gap-3">
      <VStack className="gap-1.5">
        <Text className="font-body-semibold text-[10px] tracking-[1.5px] uppercase text-dim">{t('form.nameLabel')}</Text>
        <TextInput
          value={form.name}
          onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
          placeholder={t('form.namePlaceholder')}
          placeholderTextColor={colors.dim}
          className="rounded-[12px] border border-hairline bg-bg-sunken px-3.5 font-body-semibold text-ink"
          style={{ height: 44, fontSize: 14.5 }}
        />
      </VStack>
      <HStack className="gap-3">
        <VStack className="flex-1 gap-1.5">
          <Text className="font-body-semibold text-[10px] tracking-[1.5px] uppercase text-dim">{t('form.capacityLabel')}</Text>
          <TextInput
            value={form.capacity}
            onChangeText={(v) => setForm((prev) => ({ ...prev, capacity: v.replace(/[^0-9]/g, '') }))}
            placeholder={t('form.capacityPlaceholder')}
            placeholderTextColor={colors.dim}
            keyboardType="number-pad"
            className="rounded-[12px] border border-hairline bg-bg-sunken px-3.5 font-body-semibold text-ink"
            style={{ height: 44, fontSize: 14.5 }}
          />
        </VStack>
        <VStack className="flex-[2] gap-1.5">
          <Text className="font-body-semibold text-[10px] tracking-[1.5px] uppercase text-dim">{t('form.noteLabel')}</Text>
          <TextInput
            value={form.note}
            onChangeText={(v) => setForm((prev) => ({ ...prev, note: v }))}
            placeholder={t('form.notePlaceholder')}
            placeholderTextColor={colors.dim}
            className="rounded-[12px] border border-hairline bg-bg-sunken px-3.5 font-body-semibold text-ink"
            style={{ height: 44, fontSize: 14.5 }}
          />
        </VStack>
      </HStack>
      <HStack className="items-center justify-between pt-1">
        <Pressable onPress={onCancel} className="px-1 py-1.5">
          <Text className="font-body-semibold text-muted" style={{ fontSize: 13 }}>
            {t('form.cancel')}
          </Text>
        </Pressable>
        <HStack className="gap-2">
          {showDelete && onDelete ? (
            <Pressable
              onPress={onDelete}
              disabled={deleting}
              className="rounded-[12px] border px-3.5 py-2"
              style={{ borderColor: colors.hairline }}
            >
              <Text className="font-body-semibold text-red" style={{ fontSize: 13 }}>
                {deleting ? '…' : t('form.delete')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onSave} disabled={saving} className="rounded-[12px] bg-green px-4 py-2">
            <Text className="font-body-bold" style={{ fontSize: 13, color: '#07120C' }}>
              {saving ? '…' : t('form.save')}
            </Text>
          </Pressable>
        </HStack>
      </HStack>
    </VStack>
  );
}
