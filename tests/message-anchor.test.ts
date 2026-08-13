import { describe, expect, it } from "vite-plus/test";
import {
  messageAnchorAction,
  messageAnchorId,
  messageAnchorValue,
  parseMessageAnchor,
} from "../src/lib/message-anchor";

const UUID = "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

describe("messageAnchorId", () => {
  it("names the anchor after the message uuid", () => {
    expect(messageAnchorId(UUID)).toBe(`msg-${UUID}`);
  });
});

describe("messageAnchorValue", () => {
  it("addresses a record by its own uuid", () => {
    expect(messageAnchorValue({ uuid: UUID, lineIndex: 1_200 })).toBe(UUID);
  });

  it("falls back to the record index for a record that carries no uuid", () => {
    expect(messageAnchorValue({ lineIndex: 1_200 })).toBe("1200");
  });
});

describe("parseMessageAnchor", () => {
  it("reads a uuid back out of a hash, with or without the leading hash", () => {
    expect([parseMessageAnchor(`#msg-${UUID}`), parseMessageAnchor(`msg-${UUID}`)]).toStrictEqual([
      { uuid: UUID },
      { uuid: UUID },
    ]);
  });

  it("still reads an all-digit hash as a record index, so links copied before the switch keep working", () => {
    expect([parseMessageAnchor("#msg-1200"), parseMessageAnchor("msg-0")]).toStrictEqual([
      { recordIndex: 1_200 },
      { recordIndex: 0 },
    ]);
  });

  it("rejects hashes that are not message anchors", () => {
    expect(
      ["", "#", "#msg-", "#msg-1.5", "#files", "#msg-a b", '#msg-a"]'].map(parseMessageAnchor),
    ).toStrictEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("messageAnchorAction", () => {
  it("jumps when the anchored uuid is among the records the client holds", () => {
    expect(messageAnchorAction({ uuid: UUID }, { startIndex: 1_500, uuids: new Set([UUID]) })).toBe(
      "jump",
    );
  });

  it("pages history back when the anchored uuid is not among the records held", () => {
    expect(messageAnchorAction({ uuid: UUID }, { startIndex: 1_500, uuids: new Set() })).toBe(
      "load-earlier",
    );
  });

  it("stops once the whole file is loaded, so an anchor from another session cannot spin", () => {
    expect(messageAnchorAction({ uuid: UUID }, { startIndex: 0, uuids: new Set() })).toBe("none");
  });

  it("resolves a legacy record-index anchor against the window boundary", () => {
    const held = { uuids: new Set<string>() };
    expect([
      messageAnchorAction({ recordIndex: 1_500 }, { startIndex: 1_500, ...held }),
      messageAnchorAction({ recordIndex: 1_700 }, { startIndex: 1_500, ...held }),
      messageAnchorAction({ recordIndex: 1_200 }, { startIndex: 1_500, ...held }),
      messageAnchorAction({ recordIndex: 1_200 }, { startIndex: 0, ...held }),
    ]).toStrictEqual(["jump", "jump", "load-earlier", "jump"]);
  });

  it("does nothing without an anchor", () => {
    expect(messageAnchorAction(undefined, { startIndex: 1_500, uuids: new Set() })).toBe("none");
  });
});
