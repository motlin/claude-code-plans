import { describe, expect, it } from "vite-plus/test";
import {
  messageAnchorAction,
  messageAnchorId,
  parseMessageAnchor,
} from "../src/lib/message-anchor";

describe("messageAnchorId", () => {
  it("names the anchor after the session-absolute record index", () => {
    expect([messageAnchorId(0), messageAnchorId(1_200)]).toStrictEqual(["msg-0", "msg-1200"]);
  });
});

describe("parseMessageAnchor", () => {
  it("reads the record index back out of a hash, with or without the leading hash", () => {
    expect([parseMessageAnchor("#msg-1200"), parseMessageAnchor("msg-0")]).toStrictEqual([
      1_200, 0,
    ]);
  });

  it("rejects hashes that are not message anchors", () => {
    expect(
      ["", "#", "#msg-", "#msg-x", "#msg-1.5", "#msg--1", "#files", "#msg-1200x"].map(
        parseMessageAnchor,
      ),
    ).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("messageAnchorAction", () => {
  it("jumps when the anchored record is inside the window the client holds", () => {
    expect([
      messageAnchorAction(1_500, 1_500),
      messageAnchorAction(1_700, 1_500),
      messageAnchorAction(0, 0),
    ]).toStrictEqual(["jump", "jump", "jump"]);
  });

  it("pages history back when the anchored record fell off the front of the window", () => {
    expect(messageAnchorAction(1_200, 1_500)).toBe("load-earlier");
  });

  it("stops once the whole file is loaded, so a bogus anchor cannot spin", () => {
    expect(messageAnchorAction(-5, 0)).toBe("none");
  });

  it("does nothing without an anchor", () => {
    expect(messageAnchorAction(undefined, 1_500)).toBe("none");
  });
});
