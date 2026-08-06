import { describe, expect, it } from "vite-plus/test";
import { reviewOfferAction } from "../src/components/working-copy-review-banner";

describe("working-copy review offer mode", () => {
  it("maps every persisted mode to the Stop-hook action", () => {
    expect([
      reviewOfferAction("off"),
      reviewOfferAction("offer"),
      reviewOfferAction("auto"),
    ]).toStrictEqual(["ignore", "offer", "start"]);
  });
});
