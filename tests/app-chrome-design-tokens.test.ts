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

  it("washes the user bubble and inline-code chip in the cds-era 5% alpha layer", () => {
    const styles = readFileSync("src/styles/globals.css", "utf8");
    const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
    const dark = styles.slice(styles.indexOf(".dark {"));
    const token = (block: string, name: string) =>
      block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

    expect({
      lightBubble: token(light, "--user-msg-bg"),
      darkBubble: token(dark, "--user-msg-bg"),
      lightAlpha: token(light, "--upstream-alpha-1"),
      darkAlpha: token(dark, "--upstream-alpha-1"),
    }).toStrictEqual({
      lightBubble: "var(--upstream-alpha-1)",
      darkBubble: "var(--upstream-alpha-1)",
      lightAlpha: "rgb(11 11 11 / 0.05)",
      darkAlpha: "rgb(255 255 255 / 0.05)",
    });
  });
});
