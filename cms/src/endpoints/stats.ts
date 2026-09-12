import type { Endpoint } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { getOrCreateCurrentSeason } from '../lib/season';
import { computeGroupPlayerStats, rankPlayersByMetric, METRIC_KEYS, type MetricKey } from '../lib/stats-query';

function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (METRIC_KEYS as string[]).includes(value);
}

/**
 * Root-level (not collection-scoped) endpoint — implementation-plan.md §3.6/
 * §6: `GET /api/stats?group=&scope=season|alltime&metric=`. Statistik screen's
 * only data source: ranked rows + podium for one metric/scope, restricted to
 * groups the caller is a member of.
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

    const seasonId =
      scope === 'season' ? (await getOrCreateCurrentSeason(req.payload, groupId)).id : undefined;

    const allRows = await computeGroupPlayerStats(req.payload, groupId, seasonId);
    const { rows, podium } = rankPlayersByMetric(allRows, metric, scope);

    return Response.json({ scope, metric, rows, podium }, { status: 200 });
  },
};
