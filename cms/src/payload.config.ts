import path from 'path';
import { fileURLToPath } from 'url';
import { buildConfig } from 'payload';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';

import { Users } from './collections/Users';
import { Groups } from './collections/Groups';
import { Memberships } from './collections/Memberships';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

/**
 * Foundation slice only — Seasons/Fixtures/Rsvps/Lineups/MatchResults/
 * PlayerSeasonStats/PlayerCareerStats/LegacyPlayers/ImportBatches from
 * implementation-plan.md §3.1 come next; this covers auth + group + roles.
 */
export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Groups, Memberships],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
});
