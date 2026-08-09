/**
 * Deduplicates herdr pane events across subscription replays.
 *
 * herdr replays a window of history to every new subscriber: `pane_created`
 * for panes that already exist (or died long ago), `pane_closed` for recently
 * closed panes, and old `pane_updated` revisions. Without a memory of what it
 * has already announced, the bridge treats each replay as fresh news,
 * reconnects to rebuild its pane-scoped subscriptions, and the resubscribe
 * triggers the next replay — an endless ~2 Hz loop of identical events and
 * full pane snapshots on an otherwise idle system.
 *
 * Closed panes are kept as tombstones instead of being deleted: a replayed
 * create+close pair would otherwise re-add and re-remove the pane on every
 * resubscribe, emitting both events each time. Revisions only ever advance,
 * so updates at or below the last known revision are replays.
 */

export interface PaneRevision {
  paneId: string;
  revision: number | null;
}

interface KnownPane {
  revision: number | null;
  closed: boolean;
}

export interface HerdrPaneDiffer {
  /**
   * Merge the panes herdr reports at (re)subscribe time into the known set.
   * Merging rather than replacing matters: herdr replays creates for zombie
   * panes that `session.snapshot` omits, so replacing would forget them and
   * restart the replay loop on every resubscribe.
   */
  seedKnownPanes(panes: PaneRevision[]): void;
  /** Record a pane_created push; true when the pane id is genuinely new. */
  recordCreated(pane: PaneRevision): boolean;
  /** Record a pane_updated push; true when the revision actually advanced. */
  recordUpdated(pane: PaneRevision): boolean;
  /** Record a pane_closed push; true when the pane was known and open. */
  recordClosed(paneId: string): boolean;
  /** True when the snapshot payload differs from the last broadcast one. */
  shouldBroadcastSnapshot(panes: unknown): boolean;
}

export function createHerdrPaneDiffer(): HerdrPaneDiffer {
  const knownPanes = new Map<string, KnownPane>();
  let lastSnapshotSignature: string | null = null;

  return {
    seedKnownPanes(panes) {
      for (const pane of panes) {
        knownPanes.set(pane.paneId, { revision: pane.revision, closed: false });
      }
    },

    recordCreated(pane) {
      if (knownPanes.has(pane.paneId)) return false;
      knownPanes.set(pane.paneId, { revision: pane.revision, closed: false });
      return true;
    },

    recordUpdated(pane) {
      // A payload without a revision cannot be proven redundant; pass it
      // through without recording so a later revision-bearing update still
      // compares against the last confirmed revision.
      if (pane.revision === null) return true;
      const known = knownPanes.get(pane.paneId);
      if (!known) {
        knownPanes.set(pane.paneId, { revision: pane.revision, closed: false });
        return true;
      }
      if (known.revision !== null && pane.revision <= known.revision) return false;
      known.revision = pane.revision;
      return true;
    },

    recordClosed(paneId) {
      const known = knownPanes.get(paneId);
      if (!known) {
        // A close replay can outlive its create in herdr's buffer; tombstone
        // it so the create replay on the next resubscribe stays quiet too.
        knownPanes.set(paneId, { revision: null, closed: true });
        return false;
      }
      if (known.closed) return false;
      known.closed = true;
      return true;
    },

    shouldBroadcastSnapshot(panes) {
      const signature = JSON.stringify(panes);
      if (signature === lastSnapshotSignature) return false;
      lastSnapshotSignature = signature;
      return true;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Pull the pane identity out of a pushed herdr event payload. Live pushes nest
 * the full pane under `data.pane`; pane_closed carries a bare `pane_id`.
 */
export function extractPaneRevision(data: Record<string, unknown>): PaneRevision | null {
  const pane = data["pane"];
  const source = isRecord(pane) ? pane : data;
  const paneId = source["pane_id"];
  if (typeof paneId !== "string") return null;
  const revision = source["revision"];
  return { paneId, revision: typeof revision === "number" ? revision : null };
}
