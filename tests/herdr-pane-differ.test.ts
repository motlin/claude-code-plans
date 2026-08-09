import { describe, expect, it } from "vite-plus/test";
import { createHerdrPaneDiffer, extractPaneRevision } from "../src/lib/herdr/pane-differ";

describe("createHerdrPaneDiffer", () => {
  describe("recordCreated", () => {
    it("emits a pane exactly once when the same create payload is replayed N times", () => {
      const differ = createHerdrPaneDiffer();
      const pane = { paneId: "wE:p17", revision: 0 };

      const emitted = Array.from({ length: 5 }, () => differ.recordCreated(pane));

      expect(emitted).toStrictEqual([true, false, false, false, false]);
    });

    it("suppresses creates for panes seeded from the subscription snapshot", () => {
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "wE:p17", revision: 0 }]);

      expect(differ.recordCreated({ paneId: "wE:p17", revision: 0 })).toBe(false);
    });

    it("suppresses the replayed create of a pane whose close was already seen", () => {
      // herdr replays a window of history on every subscribe, so a closed
      // pane's create+close pair comes back on each resubscribe. Deleting on
      // close would make each replayed create look new and re-trigger the
      // reconnect that fetches the next replay: an endless loop.
      const differ = createHerdrPaneDiffer();

      expect([
        differ.recordCreated({ paneId: "w8:pH", revision: 0 }),
        differ.recordClosed("w8:pH"),
        differ.recordCreated({ paneId: "w8:pH", revision: 0 }),
        differ.recordClosed("w8:pH"),
      ]).toStrictEqual([true, true, false, false]);
    });

    it("suppresses a replayed create for a close that arrived with no prior create", () => {
      // Close replays outlive create replays in herdr's buffer, so a close
      // can arrive for a pane the bridge never saw created.
      const differ = createHerdrPaneDiffer();

      expect([
        differ.recordClosed("w8:pH"),
        differ.recordCreated({ paneId: "w8:pH", revision: 0 }),
      ]).toStrictEqual([false, false]);
    });
  });

  describe("recordUpdated", () => {
    it("emits for an unknown pane and records its revision", () => {
      const differ = createHerdrPaneDiffer();

      expect([
        differ.recordUpdated({ paneId: "w19:p9", revision: 228 }),
        differ.recordUpdated({ paneId: "w19:p9", revision: 228 }),
      ]).toStrictEqual([true, false]);
    });

    it("suppresses updates whose revision matches the seeded revision", () => {
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 228 }]);

      expect(differ.recordUpdated({ paneId: "w19:p9", revision: 228 })).toBe(false);
    });

    it("emits when the revision advances", () => {
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 228 }]);

      expect([
        differ.recordUpdated({ paneId: "w19:p9", revision: 229 }),
        differ.recordUpdated({ paneId: "w19:p9", revision: 229 }),
      ]).toStrictEqual([true, false]);
    });

    it("suppresses replayed updates whose revision regressed", () => {
      // Resubscribing replays a window of old updates; per-pane revisions only
      // ever advance, so anything at or below the known revision is a replay.
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 232 }]);

      expect([
        differ.recordUpdated({ paneId: "w19:p9", revision: 228 }),
        differ.recordUpdated({ paneId: "w19:p9", revision: 229 }),
        differ.recordUpdated({ paneId: "w19:p9", revision: 233 }),
      ]).toStrictEqual([false, false, true]);
    });

    it("always emits when the payload carries no revision", () => {
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 228 }]);

      expect([
        differ.recordUpdated({ paneId: "w19:p9", revision: null }),
        differ.recordUpdated({ paneId: "w19:p9", revision: null }),
      ]).toStrictEqual([true, true]);
    });
  });

  describe("recordClosed", () => {
    it("emits only for known panes and forgets them", () => {
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "wE:p17", revision: 0 }]);

      expect([
        differ.recordClosed("wE:p17"),
        differ.recordClosed("wE:p17"),
        differ.recordClosed("w19:p9"),
      ]).toStrictEqual([true, false, false]);
    });
  });

  describe("seedKnownPanes", () => {
    it("keeps panes learned from pushes that the snapshot omits", () => {
      // herdr replays pane_created for zombie panes that session.snapshot does
      // not list; forgetting them at resubscribe time would restart the replay
      // loop the differ exists to break.
      const differ = createHerdrPaneDiffer();
      differ.recordCreated({ paneId: "w19:pH", revision: 0 });
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 1 }]);

      expect([
        differ.recordCreated({ paneId: "w19:pH", revision: 0 }),
        differ.recordCreated({ paneId: "w19:p9", revision: 1 }),
      ]).toStrictEqual([false, false]);
    });

    it("updates the revision of an already-known pane", () => {
      const differ = createHerdrPaneDiffer();
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 1 }]);
      differ.seedKnownPanes([{ paneId: "w19:p9", revision: 2 }]);

      expect(differ.recordUpdated({ paneId: "w19:p9", revision: 2 })).toBe(false);
    });
  });

  describe("shouldBroadcastSnapshot", () => {
    it("broadcasts the same poll payload only on the first call", () => {
      const differ = createHerdrPaneDiffer();
      const panes = [{ paneId: "wE:p17", sessionId: "s-1", revision: 0 }];

      const emitted = Array.from({ length: 5 }, () => differ.shouldBroadcastSnapshot(panes));

      expect(emitted).toStrictEqual([true, false, false, false, false]);
    });

    it("broadcasts an empty first snapshot, then suppresses identical repeats", () => {
      const differ = createHerdrPaneDiffer();

      expect([
        differ.shouldBroadcastSnapshot([]),
        differ.shouldBroadcastSnapshot([]),
      ]).toStrictEqual([true, false]);
    });

    it("broadcasts again when the payload changes, then suppresses the new payload", () => {
      const differ = createHerdrPaneDiffer();
      const first = [{ paneId: "wE:p17", sessionId: "s-1", revision: 0 }];
      const second = [{ paneId: "wE:p17", sessionId: "s-1", revision: 1 }];

      expect([
        differ.shouldBroadcastSnapshot(first),
        differ.shouldBroadcastSnapshot(second),
        differ.shouldBroadcastSnapshot(second),
      ]).toStrictEqual([true, true, false]);
    });
  });
});

describe("extractPaneRevision", () => {
  it("reads the nested pane object herdr sends on pane_created and pane_updated", () => {
    expect(
      extractPaneRevision({ pane: { pane_id: "wE:p17", revision: 0, focused: false } }),
    ).toStrictEqual({ paneId: "wE:p17", revision: 0 });
  });

  it("falls back to top-level pane_id when no pane object is present", () => {
    expect(extractPaneRevision({ pane_id: "wE:p17" })).toStrictEqual({
      paneId: "wE:p17",
      revision: null,
    });
  });

  it("ignores a non-numeric revision", () => {
    expect(extractPaneRevision({ pane: { pane_id: "wE:p17", revision: "3" } })).toStrictEqual({
      paneId: "wE:p17",
      revision: null,
    });
  });

  it("returns null when no pane id can be found", () => {
    expect(extractPaneRevision({ pane: { revision: 3 } })).toBeNull();
    expect(extractPaneRevision({})).toBeNull();
  });
});
