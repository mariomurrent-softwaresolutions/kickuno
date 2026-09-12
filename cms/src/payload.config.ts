import path from 'path';
import { fileURLToPath } from 'url';
import { buildConfig } from 'payload';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';

import { Users } from './collections/Users';
import { Groups } from './collections/Groups';
import { Memberships } from './collections/Memberships';
import { Halls } from './collections/Halls';
import { Seasons } from './collections/Seasons';
import { Fixtures } from './collections/Fixtures';
import { Rsvps } from './collections/Rsvps';
import { Lineups } from './collections/Lineups';
import { MatchResults } from './collections/MatchResults';
import { PlayerSeasonStats } from './collections/PlayerSeasonStats';
import { PlayerCareerStats } from './collections/PlayerCareerStats';
import { LegacyPlayers } from './collections/LegacyPlayers';
import { ImportBatches } from './collections/ImportBatches';
import { AdminAccess } from './globals/AdminAccess';
import { statsEndpoint } from './endpoints/stats';
import { playerProfileEndpoint } from './endpoints/player-profile';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

/**
 * Phase 2 (auth + group + roles) + Phase 3 (fixtures/halls/seasons/rsvps)
 * + Phase 4 (lineups/auto-balance/results/stats) + Phase 5 (statistics &
 * profiles) + Phase 6 (historic data import — legacyPlayers/importBatches,
 * §9).
 */
export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [
    Users,
    Groups,
    Memberships,
    Halls,
    Seasons,
    Fixtures,
    Rsvps,
    Lineups,
    MatchResults,
    PlayerSeasonStats,
    PlayerCareerStats,
    LegacyPlayers,
    ImportBatches,
  ],
  globals: [AdminAccess],
  endpoints: [statsEndpoint, playerProfileEndpoint],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
});
