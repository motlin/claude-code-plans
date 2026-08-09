import { describe, expect, it } from "vite-plus/test";
import { navItems } from "../src/components/sidebar/navigation";
import { cards } from "../src/routes/index";

describe("home grid", () => {
  it("has exactly one card per sidebar destination", () => {
    expect(cards.map(({ label, to }) => ({ label, to }))).toStrictEqual(
      navItems.map(({ label, to }) => ({ label, to })),
    );
  });

  it("gives every card a non-empty description", () => {
    for (const card of cards) {
      expect(card.description.length, `description for ${card.label}`).toBeGreaterThan(0);
    }
  });

  it("uses the Herdr name for the terminal fleet card", () => {
    expect(
      cards
        .filter((card) => card.to === "/herdr")
        .map(({ label, to, description }) => ({ label, to, description })),
    ).toStrictEqual([
      { label: "Herdr", to: "/herdr", description: "Live terminals managed by Herdr" },
    ]);
  });
});
