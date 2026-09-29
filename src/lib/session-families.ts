import type { SessionBucket } from "./session-state";

export interface FamilyRow {
  sessionId: string;
  forkedFromSessionId?: string | undefined;
  bucket: SessionBucket;
  archived: boolean;
}

/** A head session plus every descendant, flattened one visual level deep. */
export interface SessionFamily<Row extends FamilyRow> {
  head: Row;
  /** Spawn-tree pre-order: each row follows its direct parent; siblings keep input order. */
  children: Row[];
  /** The most urgent bucket of any member. */
  bucket: SessionBucket;
}

/** Upstream family urgency: Needs input < Working < Ready for review < Completed. */
const BUCKET_URGENCY = {
  blocked: 0,
  working: 1,
  review: 2,
  done: 3,
} as const satisfies Record<SessionBucket, number>;

/**
 * Group the given (already filtered) rows into fork families. A parent that is
 * absent from `rows` leaves the row top-level, as does an archived parent of an
 * active row. Cycles are cut at the cycle member that comes first in `rows`.
 * Families come out in the input order of their heads.
 */
export function resolveFamilies<Row extends FamilyRow>(rows: readonly Row[]): SessionFamily<Row>[] {
  const byId = new Map(rows.map((row) => [row.sessionId, row]));
  const position = new Map(rows.map((row, index) => [row.sessionId, index]));

  const parentOf = new Map<string, string>();
  for (const row of rows) {
    const parent =
      row.forkedFromSessionId === undefined ? undefined : byId.get(row.forkedFromSessionId);
    if (parent === undefined || parent === row) continue;
    if (parent.archived && !row.archived) continue;
    parentOf.set(row.sessionId, parent.sessionId);
  }
  cutCycles(rows, parentOf, position);

  const childrenOf = new Map<string, Row[]>();
  for (const row of rows) {
    const parentId = parentOf.get(row.sessionId);
    if (parentId === undefined) continue;
    const siblings = childrenOf.get(parentId);
    if (siblings === undefined) childrenOf.set(parentId, [row]);
    else siblings.push(row);
  }

  return rows
    .filter((row) => !parentOf.has(row.sessionId))
    .map((head) => {
      const children: Row[] = [];
      const visit = (parentId: string): void => {
        for (const child of childrenOf.get(parentId) ?? []) {
          children.push(child);
          visit(child.sessionId);
        }
      };
      visit(head.sessionId);
      return { head, children, bucket: mostUrgentBucket([head, ...children]) };
    });
}

function cutCycles(
  rows: readonly FamilyRow[],
  parentOf: Map<string, string>,
  position: ReadonlyMap<string, number>,
): void {
  const settled = new Set<string>();
  for (const row of rows) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | undefined = row.sessionId;
    while (current !== undefined && !settled.has(current)) {
      if (onPath.has(current)) {
        const cycle = path.slice(path.indexOf(current));
        const first = cycle.reduce((best, id) =>
          (position.get(id) ?? 0) < (position.get(best) ?? 0) ? id : best,
        );
        parentOf.delete(first);
        break;
      }
      path.push(current);
      onPath.add(current);
      current = parentOf.get(current);
    }
    for (const id of path) settled.add(id);
  }
}

function mostUrgentBucket(rows: readonly FamilyRow[]): SessionBucket {
  return rows.reduce<SessionBucket>(
    (best, row) => (BUCKET_URGENCY[row.bucket] < BUCKET_URGENCY[best] ? row.bucket : best),
    "done",
  );
}
