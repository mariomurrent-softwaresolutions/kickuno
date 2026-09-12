import type { PolyKind } from '../lib/polymorphic';

export type ImportKind = 'fixtures' | 'career-baseline' | 'legacy-players';

/** One row's validation/resolution outcome. `blocking: true` means this row is excluded from commit (and, if any row is blocking, the whole run refuses to commit unless `--force`). */
export type ImportIssue = { row: number; message: string; blocking: boolean };

export type ImportPreview = {
  kind: ImportKind;
  fileName: string;
  totalRows: number;
  issues: ImportIssue[];
  canCommit: boolean;
  /** Human-readable lines describing what a commit would do — printed by the CLI, not persisted. */
  summary: string[];
};

/** A player reference the change log can later use to identify what to undo or recompute. */
export type PlayerRef = { id: string | number; kind: PolyKind };

export type FixturesChangeLog = {
  kind: 'fixtures';
  createdFixtureIds: (string | number)[];
  createdLineupIds: (string | number)[];
  createdMatchResultIds: (string | number)[];
  createdHallIds: (string | number)[];
  createdSeasonIds: (string | number)[];
  createdLegacyPlayerIds: (string | number)[];
  affectedPlayers: PlayerRef[];
  affectedSeasonIds: (string | number)[];
};

export type CareerBaselineChangeLog = {
  kind: 'career-baseline';
  playerUpdates: {
    player: PlayerRef;
    /** `null` means the `playerCareerStats` row itself was created by this batch (rollback deletes it outright). */
    priorBaseline: Record<string, number> | null;
    careerStatsId: string | number;
    createdLegacyPlayerId?: string | number;
  }[];
  memberSinceUpdates: { userId: string | number; priorMemberSince: string | null }[];
};

export type LegacyPlayersChangeLog = {
  kind: 'legacy-players';
  createdLegacyPlayerIds: (string | number)[];
  updatedLegacyPlayers: { id: string | number; priorNote: string | null; priorPosition: string | null }[];
};

export type ChangeLog = FixturesChangeLog | CareerBaselineChangeLog | LegacyPlayersChangeLog;

export type CommitResult = {
  importBatchId: string | number;
  rowsWritten: number;
  skipped: { row: number; reason: string }[];
  changeLog: ChangeLog;
};
