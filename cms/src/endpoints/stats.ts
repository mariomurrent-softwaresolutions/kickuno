import type { Endpoint } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { getActiveSeason } from '../lib/season';
import {
  computeAllTimeRecords,
  computeBestDuos,
  computeGroupPlayerStats,
  computeSeasonSummary,
  rankPlayersByMetric,
  METRIC_KEYS,
  type MetricKey,
} from '../lib/stats-query';

function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (METRIC_KEYS as string[]).includes(value);
}

/**
 * Root-level (not collection-scoped) endpoint — implementation-plan.md §3.6/
 * §6, extended by the season-management feature plan
 * (`claude/feature-plan-seasons-and-multigroup.md` §A):
 * `GET /api/stats?group=&scope=season|alltime&metric=&season=`. Statistik
 * screen's only data source: ranked rows + podium for one metric/scope,
 * restricted to groups the caller is a member of. `season` is optional and
 * only consulted when `scope=season` — when omitted, falls back to the
 * group's currently active season (unchanged pre-feature behavior);
 * `scope=alltime` already spans every season by design and ignores it
 * entirely.
 *
 * `scope=summary` (`claude/feature-plan-stats-enhancements.md` §A) returns a
 * different shape entirely — group/season-level totals (Spieltage, Tore,
 * Rot-vs-Grün record, …) instead of a per-player ranked list. `season` is
 * consulted the same way as `scope=season` (verified to belong to the
 * group), but omitting it means all-time — unlike `scope=season`, there is
 * no fallback-to-active-season here; the caller (the Statistik screen)
 * always resolves the season id itself before asking for a summary.
 *
 * `scope=alltime`'s response also carries `records` (§B) — the all-time
 * "Hall of Fame" (top single-match goal haul, longest-ever win streak),
 * derived from the same `allRows` already fetched for the ranked list
 * below, no extra queries. `scope=season` never carries this field;
 * season-scoped records (biggest win, closest game, highest-scoring
 * match) live on the `scope=summary` response instead.
 *
 * `scope=summary`'s response also carries `bestDuos` (§C) — the top
 * player pairs by win rate when sharing a team, scoped the same way as
 * `summary` itself (a season, or all-time when `season` is omitted).
 */
export const statsEndpoint: Endpoint = {
  path: '/stats',
  method: 'get',
  handler: async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const groupId = req.query?.group;
    if (typeof groupId !== 'string' && typeof groupId !== 'number') {
      return Response.json({ error: 'Missing group' }, { status: 400 });
    }

    const myGroupIds = await membershipGroupIds(req);
    if (!myGroupIds.map(String).includes(String(groupId))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const scopeParam = req.query?.scope;
    const scope: 'season' | 'alltime' | 'summary' =
      scopeParam === 'alltime' ? 'alltime' : scopeParam === 'summary' ? 'summary' : 'season';

    if (scope === 'summary') {
      const seasonParam = req.query?.season;
      let summarySeasonId: string | number | undefined;
      if (typeof seasonParam === 'string' || typeof seasonParam === 'number') {
        const season = await req.payload
          .findByID({ collection: 'seasons', id: seasonParam, depth: 0, overrideAccess: true })
          .catch(() => null);
        const seasonGroupId =
          season && (typeof season.group === 'object' && season.group !== null ? season.group.id : season.group);
        if (!season || String(seasonGroupId) !== String(groupId)) {
          return Response.json({ error: 'Invalid season' }, { status: 400 });
        }
        summarySeasonId = season.id;
      }
      const [summary, bestDuos] = await Promise.all([
        computeSeasonSummary(req.payload, groupId, summarySeasonId),
        computeBestDuos(req.payload, groupId, summarySeasonId),
      ]);
      return Response.json({ scope, summary, bestDuos, seasonId: summarySeasonId }, { status: 200 });
    }

    const metricParam = req.query?.metric;
    const metric: MetricKey = isMetricKey(metricParam) ? metricParam : 'tore';

    let seasonId: string | number | undefined;
    if (scope === 'season') {
      const seasonParam = req.query?.season;
      if (typeof seasonParam === 'string' || typeof seasonParam === 'number') {
        // An explicit season was requested (the Statistik screen's season
        // picker) — verify it actually belongs to this group rather than
        // trusting the client's id outright.
        const season = await req.payload
          .findByID({ collection: 'seasons', id: seasonParam, depth: 0, overrideAccess: true })
          .catch(() => null);
        const seasonGroupId =
          season && (typeof season.group === 'object' && season.group !== null ? season.group.id : season.group);
        if (!season || String(seasonGroupId) !== String(groupId)) {
          return Response.json({ error: 'Invalid season' }, { status: 400 });
        }
        seasonId = season.id;
      } else {
        // Deliberately `getActiveSeason` (read-only), never
        // `getOrCreateCurrentSeason` — this is a plain read (viewing the
        // Statistik screen), and letting it spawn a season as a side
        // effect was the exact bug reported live (see getting-started.md,
        // "fixed a season-creation bug on result save" and its follow-up
        // here): a group with zero active seasons that simply had its
        // Saison stats *viewed* would silently get a brand-new one. When
        // there's genuinely no active season yet, just report empty
        // season stats instead — the admin starts one from Saisons when
        // they're ready, nothing here should do it for them.
        const active = await getActiveSeason(req.payload, groupId);
        if (!active) {
          return Response.json({ scope, metric, rows: [], podium: [] }, { status: 200 });
        }
        seasonId = active.id;
      }
    }

    const allRows = await computeGroupPlayerStats(req.payload, groupId, seasonId);
    // Teilnahmen%'s denominator: the season's actual played-fixture count,
    // not a hardcoded assumed season length (feature-plan-stats-enhancements
    // follow-up, 2026-09-16). Only relevant for scope=season — scope=alltime's
    // "Teilnahmen" sub-label doesn't render a percentage at all.
    const seasonFixtureCount =
      scope === 'season' && seasonId !== undefined
        ? (
            await req.payload.count({
              collection: 'fixtures',
              where: { group: { equals: groupId }, season: { equals: seasonId }, status: { equals: 'played' } },
              overrideAccess: true,
            })
          ).totalDocs
        : undefined;
    const { rows, podium } = rankPlayersByMetric(allRows, metric, scope, seasonFixtureCount);
    const records = scope === 'alltime' ? computeAllTimeRecords(allRows) : undefined;

    return Response.json({ scope, metric, rows, podium, seasonId, records }, { status: 200 });
  },
};
