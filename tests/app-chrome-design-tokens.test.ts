import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const RETIRED_CHROME_UTILITY =
  /(?:text-text|bg-bg|border-border)-[A-Za-z0-9]+|rounded-\[[0-9]+px\]/g;

describe("app chrome design tokens", () => {
  it("does not use the retired numeric palette or ad-hoc pixel radii", () => {
    const violations = Object.fromEntries(
      globSync("src/**/*.{css,ts,tsx}").flatMap((path) => {
        const matches = [...readFileSync(path, "utf8").matchAll(RETIRED_CHROME_UTILITY)].map(
          ([utility]) => utility,
        );
        return matches.length === 0 ? [] : [[path, matches]];
      }),
    );

    expect(violations).toStrictEqual({});
  });
});
