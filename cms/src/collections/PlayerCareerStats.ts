import type { CollectionConfig } from 'payload';

/**
 * One row per player per group — implementation-plan.md §3.1/§3.7. `match*`
 * fields are rebuilt from scratch by `recomputeStatsForPlayers` whenever a
 * `matchResults` row changes (§3.2); `baseline*` fields are seeded once by
 * the phase-6 career-baseline import and never touched by the stats hook.
 * The app's all-time total is `baseline* + match*` (§3.7, merged in
 * `cms/src/lib/stats-query.ts`). Locked down entirely, same reasoning as
 * `PlayerSeasonStats.ts`.
 *
 * `player` is now the polymorphic `[users, legacyPlayers]` relation (§3.1,
 * phase 6). No unique index over `(player, group)` for the same reason as
 * `PlayerSeasonStats.ts` — see that file's comment.
 */
export const PlayerCareerStats: CollectionConfig = {
  slug: 'playerCareerStats',
  admin: { useAsTitle: 'id' },
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'player', type: 'relationship', relationTo: ['users', 'legacyPlayers'], required: true },
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    {
      name: 'yearsActive',
      type: 'number',
      admin: { description: 'Not computed by any hook yet — §3.1 doesn\'t specify its derivation. Safe to leave at 0/unset for now.' },
    },
    { name: 'matchPlayed', type: 'number', defaultValue: 0 },
    { name: 'matchWins', type: 'number', defaultValue: 0 },
    { name: 'matchDraws', type: 'number', defaultValue: 0 },
    { name: 'matchLosses', type: 'number', defaultValue: 0 },
    { name: 'matchGoals', type: 'number', defaultValue: 0 },
    {
      name: 'matchOwnGoals',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Always 0 for now — matchResults records own goals at the team level only, not per player. See stats.ts.' },
    },
    { name: 'matchMvps', type: 'number', defaultValue: 0 },
    { name: 'matchGoalDiff', type: 'number', defaultValue: 0 },
    { name: 'baselinePlayed', type: 'number', defaultValue: 0 },
    { name: 'baselineWins', type: 'number', defaultValue: 0 },
    { name: 'baselineDraws', type: 'number', defaultValue: 0 },
    { name: 'baselineLosses', type: 'number', defaultValue: 0 },
    { name: 'baselineGoals', type: 'number', defaultValue: 0 },
    { name: 'baselineOwnGoals', type: 'number', defaultValue: 0 },
    { name: 'baselineMvps', type: 'number', defaultValue: 0 },
    { name: 'baselineGoalDiff', type: 'number', defaultValue: 0 },
  ],
};
