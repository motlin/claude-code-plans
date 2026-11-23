// @vitest-environment jsdom

import {cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {nextApprovalPresentation} from "../src/lib/approval-presentation";
import {useApprovalPresentation} from "../src/hooks/use-approval-presentation";

afterEach(() =>
{
	cleanup();
});

describe("nextApprovalPresentation: upstream's dock decision with its per-head latch (cb534450a l, c5da7eb42 ab)", () =>
{
	it("draws an AskUserQuestion head inline and latches that it stayed inline", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					headId: "q1",
					mayGoDown: false,
					latch: null,
				},
			),
		).toStrictEqual(
			{
				presentation: "card",
				latch:
				{
					id: "q1",
					docked: false,
				},
			},
		);
	});

	it("docks a head whose tool use is an MCP call", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					headId: "toolu_mcp_call_1",
					mayGoDown: true,
					latch: null,
				},
			),
		).toStrictEqual(
			{
				presentation: "dock",
				latch:
				{
					id: "toolu_mcp_call_1",
					docked: true,
				},
			},
		);
	});

	it("docks on corner widgets only a new head, or a latched inline head that may go down", () =>
	{
		const inline =
		{
			id: "a",
			docked: false,
		};
		expect([
			nextApprovalPresentation(
				{
					headId: "a",
					mayGoDown: false,
					cornerWidgets: true,
					latch: inline,
				},
			),
			nextApprovalPresentation(
				{
					headId: "a",
					mayGoDown: true,
					cornerWidgets: true,
					latch: inline,
				},
			),
			nextApprovalPresentation(
				{
					headId: "b",
					mayGoDown: false,
					cornerWidgets: true,
					latch: inline,
				},
			),
		]).toStrictEqual([
			{
				presentation: "card",
				latch: inline,
			},
			{
				presentation: "dock",
				latch:
				{
					id: "a",
					docked: true,
				},
			},
			{
				presentation: "dock",
				latch:
				{
					id: "b",
					docked: true,
				},
			},
		]);
	});

	it("keeps a docked head docked after the corner widgets go away", () =>
	{
		const docked =
		{
			id: "a",
			docked: true,
		};
		expect(
			nextApprovalPresentation(
				{
					headId: "a",
					mayGoDown: true,
					latch: docked,
				},
			),
		).toStrictEqual(
			{
				presentation: "dock",
				latch: docked,
			},
		);
	});

	it("draws inline with no head, keeping the latch", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					headId: null,
					mayGoDown: true,
					latch: null,
				},
			),
		).toStrictEqual(
			{
				presentation: "card",
				latch: null,
			},
		);
	});
});

describe("useApprovalPresentation", () =>
{
	it("draws an AskUserQuestion head inline and docks an MCP-call head that replaces it", () =>
	{
		const {result, rerender} = renderHook(
			({headId}: {headId: string | null}) => useApprovalPresentation(headId, false),
			{
				initialProps:
				{
					headId: "q1",
				},
			},
		);
		const first = result.current;
		rerender(
			{
				headId: "toolu_mcp_call_1",
			},
		);
		expect([first, result.current]).toStrictEqual(["card", "dock"]);
	});
});
