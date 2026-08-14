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

  it("anchors a record that carries no uuid on a record index no bare number can name", () => {
    expect(messageAnchorValue({ lineIndex: 1_200 })).toBe("line-1200");
  });
});

describe("parseMessageAnchor", () => {
  it("reads a uuid back out of a hash, with or without the leading hash", () => {
    expect([parseMessageAnchor(`#msg-${UUID}`), parseMessageAnchor(`msg-${UUID}`)]).toStrictEqual([
      UUID,
      UUID,
    ]);
  });

  it("reads back the anchor of a record that carries no uuid", () => {
    expect(parseMessageAnchor("#msg-line-1200")).toBe("line-1200");
  });

  it("rejects an all-digit hash: no row answers to a bare record index", () => {
    expect([parseMessageAnchor("#msg-1200"), parseMessageAnchor("msg-0")]).toStrictEqual([
      undefined,
      undefined,
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
    expect(messageAnchorAction(UUID, { startIndex: 1_500, uuids: new Set([UUID]) })).toBe("jump");
  });

  it("pages history back when the anchored uuid is not among the records held", () => {
    expect(messageAnchorAction(UUID, { startIndex: 1_500, uuids: new Set() })).toBe("load-earlier");
  });

  it("stops once the whole file is loaded, so an anchor from another session cannot spin", () => {
    expect(messageAnchorAction(UUID, { startIndex: 0, uuids: new Set() })).toBe("none");
  });

  it("does nothing without an anchor", () => {
    expect(messageAnchorAction(undefined, { startIndex: 1_500, uuids: new Set() })).toBe("none");
  });
});
