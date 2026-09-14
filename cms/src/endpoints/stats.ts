import type { Endpoint } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { getOrCreateCurrentSeason } from '../lib/season';
import { computeGroupPlayerStats, rankPlayersByMetric, METRIC_KEYS, type MetricKey } from '../lib/stats-query';

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
    const scope: 'season' | 'alltime' = scopeParam === 'alltime' ? 'alltime' : 'season';

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
        seasonId = (await getOrCreateCurrentSeason(req.payload, groupId)).id;
      }
    }

    const allRows = await computeGroupPlayerStats(req.payload, groupId, seasonId);
    const { rows, podium } = rankPlayersByMetric(allRows, metric, scope);

    return Response.json({ scope, metric, rows, podium, seasonId }, { status: 200 });
  },
};
