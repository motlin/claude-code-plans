// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ContextBreakdownCard} from "../src/components/session-rail/context-breakdown";
import type {ContextBreakdown} from "../src/lib/context-breakdown";

const BREAKDOWN: ContextBreakdown =
{
	categories: [
		{
			name: "System prompt",
			tokens: 3_100,
			kind: "used",
		},
		{
			name: "Messages",
			tokens: 600_000,
			kind: "used",
		},
		{
			name: "Free space",
			tokens: 396_900,
			kind: "free",
		},
		{
			name: "MCP tools (deferred)",
			tokens: 5_000,
			kind: "deferred",
		},
	],
	totalTokens: 603_100,
	rawMaxTokens: 1_000_000,
	percentage: 60,
	mcpTools: [],
	memoryFiles: [
		{
			path: "/Users/test/.claude/projects/-Users-test-app/memory/notes.md",
			type: "Project",
			tokens: 1_200,
		},
	],
	agents: [],
	fetchedAt: "2026-11-04T12:00:00.000Z",
	source: "mod",
	autoCompactThreshold: null,
};

class FakeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function renderCard(expanded: boolean)
{
	return render(
		<ContextBreakdownCard
			breakdown={BREAKDOWN}
			liveTokens={null}
			expanded={expanded}
			homeRoot="/Users/test"
			mcpServers={[]}
		/>,
	);
}

const rowText = (row: Element) =>
	Array.from(row.children)
		.slice(1)
		.map((cell) => cell.textContent)
		.join("|");

describe("ContextBreakdownCard", () =>
{
	it("shows only the stacked meter while collapsed, under upstream's card root", () =>
	{
		const {container} = renderCard(false);
		const root = container.firstElementChild;
		expect(
			{
				root: root?.className,
				meters: container.querySelectorAll("[data-cds=StackedMeter]").length,
				label: container.querySelector("[data-cds=StackedMeter]")?.getAttribute("aria-label"),
				rows: container.querySelectorAll("[data-context-card-row]").length,
				headline: container.textContent.includes("% used"),
			},
		).toStrictEqual(
			{
				root: "flex flex-col gap-xs",
				meters: 1,
				label: "Context window: Messages: 600k, 60%; System prompt: 3.1k, 0.31%",
				rows: 0,
				headline: false,
			},
		);
	});

	it("opens upstream's popover legend rows and deferred groups when expanded", () =>
	{
		const {container} = renderCard(true);
		const rows = Array.from(container.querySelectorAll("[data-context-card-row]"));
		const toggle = screen.getByRole(
			"button",
			{
				name: /^Memory files/,
			},
		);
		const before = toggle.getAttribute("aria-expanded");
		fireEvent.click(toggle);
		const link = screen.getByRole(
			"link",
			{
				name: "/Users/test/.claude/projects/-Users-test-app/memory/notes.md",
			},
		);
		expect(
			{
				rows: rows.map(rowText),
				rowClasses: rows.map((row) => row.className),
				group: toggle.parentElement?.className,
				toggle: toggle.className,
				toggleText: toggle.textContent,
				before,
				after: toggle.getAttribute("aria-expanded"),
				link: link.className,
			},
		).toStrictEqual(
			{
				rows: [
					"Messages|600k|60.0%",
					"System prompt|3.1k|0.3%",
					"Free space|396.9k|39.7%",
					"MCP tools (deferred)|5k|—",
				],
				rowClasses: [
					"flex items-center gap-1 text-footnote ",
					"flex items-center gap-1 text-footnote mt-pad-xs",
					"flex items-center gap-1 text-footnote mt-pad-xs",
					"flex items-center gap-1 text-footnote mt-pad-xs",
				],
				group: "flex flex-col gap-0.5 mt-sm",
				toggle: "flex items-center gap-1 text-footnote text-start",
				toggleText: "Memory files1.2k1",
				before: "false",
				after: "true",
				link: "flex flex-1 min-w-0 text-start text-muted-as-secondary hover:text-primary hover:underline underline-offset-[3px] outline-none focus-visible:shadow-focus rounded",
			},
		);
	});
});
