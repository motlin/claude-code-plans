import {describe, expect, it} from "vite-plus/test";
import {mcpStatusSummary, sanitizeMcpName} from "../src/lib/mcp-status-summary";

const SEVEN = ["a", "b", "c", "d", "e", "f", "g"].map((name): [string, string] => [name, "connected"]);

describe("mcpStatusSummary", () =>
{
	it("ports upstream's cU segments, order, plurals and name cap", () =>
	{
		expect(
			{
				none: mcpStatusSummary([]),
				mixed: mcpStatusSummary([
					["github", "connected"],
					["imcp", "failed"],
					["sentry", "connected"],
				]),
				needsOne: mcpStatusSummary([["a", "needs-auth"]]),
				needsTwo: mcpStatusSummary([
					["a", "needs_auth"],
					["b", "needs-auth"],
				]),
				connecting: mcpStatusSummary([
					["x", "connecting"],
					["y", "pending"],
				]),
				error: mcpStatusSummary([["e", "error"]]),
				off: mcpStatusSummary([["d", "disabled"]]),
				other: mcpStatusSummary([["z", "weird"]]),
				order: mcpStatusSummary([
					["z", "weird"],
					["d", "disabled"],
					["f", "failed"],
					["p", "pending"],
					["n", "needs-auth"],
					["c", "connected"],
				]),
				capped: mcpStatusSummary(SEVEN),
				uncapped: mcpStatusSummary(SEVEN, Infinity),
				sanitized: mcpStatusSummary([["<a>b", "failed"]]),
			},
		).toStrictEqual(
			{
				none: "None",
				mixed: "2 connected (github, sentry) · 1 failed (imcp)",
				needsOne: "1 needs sign-in (a)",
				needsTwo: "2 need sign-in (a, b)",
				connecting: "2 connecting (x, y)",
				error: "1 failed (e)",
				off: "1 off (d)",
				other: "1 other (z)",
				order: "1 connected (c) · 1 needs sign-in (n) · 1 connecting (p) · 1 failed (f) · 1 off (d) · 1 other (z)",
				capped: "7 connected (a, b, c, d, e, +2 more)",
				uncapped: "7 connected (a, b, c, d, e, f, g)",
				sanitized: "1 failed (a b)",
			},
		);
	});
});

describe("sanitizeMcpName", () =>
{
	it("ports upstream's oU: odd characters become spaces, runs collapse, ends trim, long names cut at 39 + …", () =>
	{
		const long = "x".repeat(41);
		expect(
			{
				cloudflare: sanitizeMcpName("claude.ai Cloudflare Developer Platform"),
				odd: sanitizeMcpName("  héllo<>world  "),
				empty: sanitizeMcpName("<>"),
				long: sanitizeMcpName(long),
				forty: sanitizeMcpName("y".repeat(40)),
				plugin: sanitizeMcpName("plugin:1password:1password"),
				leadingMark: sanitizeMcpName("́ a"),
				astral: sanitizeMcpName("𝒳".repeat(41)),
			},
		).toStrictEqual(
			{
				cloudflare: "claude.ai Cloudflare Developer Platform",
				odd: "héllo world",
				empty: "?",
				long: `${"x".repeat(39)}…`,
				forty: "y".repeat(40),
				plugin: "plugin:1password:1password",
				leadingMark: "a",
				astral: `${"𝒳".repeat(39)}…`,
			},
		);
	});
});
