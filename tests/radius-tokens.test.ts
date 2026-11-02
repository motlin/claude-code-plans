import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {ruleStart} from "./css-rule";

const styles = readFileSync("src/styles/globals.css", "utf8");
// Upstream claude.ai/code's :root radius tokens, copied from the gitignored
// survey dump .llm/upstream-sync/dumps/upstream-survey-root-vars.css (lines 1208-1212).
const upstream = `
  --radius-xs:.125rem;
  --radius-sm:.25rem;
  --radius-md:.375rem;
  --radius-lg:.5rem;
  --radius-xl:.75rem;
`;

// Upstream's density-scoped cds radius (dumps/radius-sm-token-4px-upstream-radius-vars.txt):
// bare rounded, rounded-card and rounded-composer read these per element.
const upstreamTheme = `
  --radius:var(--cds-radius);
  --radius-card:calc(var(--cds-radius) + calc(.25rem * var(--cds-rem-scale,1)));
`;
const upstreamCompact = `
  --cds-radius:calc(.375rem * var(--cds-rem-scale,1));
  --cds-radius-composer:calc(.75rem * var(--cds-rem-scale,1));
`;
const upstreamComfortable = `
  --cds-radius:calc(.5rem * var(--cds-rem-scale,1));
  --cds-radius-composer:calc(.875rem * var(--cds-rem-scale,1));
`;

// The body of the first top-level rule whose selector line is exactly `selector {`.
function block(source: string, selector: string): string
{
	const start = ruleStart(source, `\n${selector}`);
	if (start === -1) throw new Error(`no ${selector} block`);
	const end = source.indexOf("\n}\n", start);
	return source.slice(start, end);
}

function token(source: string, name: string): string | null
{
	return source.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1]?.trim() ?? null;
}

describe("radius tokens match upstream claude.ai/code", () =>
{
	it("--radius-xs is upstream's .125rem (2px), so rounded-xs is 2px", () =>
	{
		expect(
			{
				local: token(styles, "--radius-xs"),
				upstream: token(upstream, "--radius-xs"),
			},
		).toStrictEqual(
			{
				local: "0.125rem",
				upstream: ".125rem",
			},
		);
	});

	it("--radius-sm is upstream's .25rem (4px), so rounded-sm is 4px", () =>
	{
		expect(
			{
				local: token(styles, "--radius-sm"),
				upstream: token(upstream, "--radius-sm"),
			},
		).toStrictEqual(
			{
				local: "0.25rem",
				upstream: ".25rem",
			},
		);
	});

	it("--radius-md is upstream's .375rem (6px), so rounded-md is 6px", () =>
	{
		expect(
			{
				local: token(styles, "--radius-md"),
				upstream: token(upstream, "--radius-md"),
			},
		).toStrictEqual(
			{
				local: "0.375rem",
				upstream: ".375rem",
			},
		);
	});

	it("--radius-lg is upstream's .5rem (8px), so rounded-lg is 8px", () =>
	{
		expect(
			{
				local: token(styles, "--radius-lg"),
				upstream: token(upstream, "--radius-lg"),
			},
		).toStrictEqual(
			{
				local: "0.5rem",
				upstream: ".5rem",
			},
		);
	});

	it("--radius-xl is upstream's .75rem (12px), so rounded-xl is 12px", () =>
	{
		expect(
			{
				local: token(styles, "--radius-xl"),
				upstream: token(upstream, "--radius-xl"),
			},
		).toStrictEqual(
			{
				local: "0.75rem",
				upstream: ".75rem",
			},
		);
	});

	it("bare rounded reads the density-scoped cds radius, like upstream --radius: var(--cds-radius)", () =>
	{
		expect(
			{
				theme: token(styles, "--radius"),
				root: token(block(styles, ":root"), "--upstream-radius"),
				compact: token(block(styles, '[data-density="compact"]'), "--upstream-radius"),
				comfortable: token(block(styles, '[data-density="comfortable"]'), "--upstream-radius"),
				upstream:
				{
					theme: token(upstreamTheme, "--radius"),
					compact: token(upstreamCompact, "--cds-radius"),
					comfortable: token(upstreamComfortable, "--cds-radius"),
				},
			},
		).toStrictEqual(
			{
				theme: "var(--upstream-radius)",
				root: "0.5rem",
				compact: "0.375rem",
				comfortable: "0.5rem",
				upstream:
				{
					theme: "var(--cds-radius)",
					compact: "calc(.375rem * var(--cds-rem-scale,1))",
					comfortable: "calc(.5rem * var(--cds-rem-scale,1))",
				},
			},
		);
	});

	it("rounded-card is cds radius + 4px, so 10px compact and 12px comfortable", () =>
	{
		expect(
			{
				local: token(styles, "--radius-card"),
				upstream: token(upstreamTheme, "--radius-card"),
			},
		).toStrictEqual(
			{
				local: "calc(var(--upstream-radius) + 0.25rem)",
				upstream: "calc(var(--cds-radius) + calc(.25rem * var(--cds-rem-scale,1)))",
			},
		);
	});

	it("rounded-composer reads the density-scoped composer radius, 12px compact and 14px comfortable", () =>
	{
		expect(
			{
				theme: token(styles, "--radius-composer"),
				root: token(block(styles, ":root"), "--upstream-radius-composer"),
				compact: token(block(styles, '[data-density="compact"]'), "--upstream-radius-composer"),
				comfortable: token(block(styles, '[data-density="comfortable"]'), "--upstream-radius-composer"),
				upstream:
				{
					compact: token(upstreamCompact, "--cds-radius-composer"),
					comfortable: token(upstreamComfortable, "--cds-radius-composer"),
				},
			},
		).toStrictEqual(
			{
				theme: "var(--upstream-radius-composer)",
				root: "0.875rem",
				compact: "0.75rem",
				comfortable: "0.875rem",
				upstream:
				{
					compact: "calc(.75rem * var(--cds-rem-scale,1))",
					comfortable: "calc(.875rem * var(--cds-rem-scale,1))",
				},
			},
		);
	});
});
