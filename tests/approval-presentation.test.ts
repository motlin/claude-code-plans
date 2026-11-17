// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {renderToString} from "react-dom/server";
import {createElement} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {nextApprovalPresentation, SHORT_VIEWPORT_QUERY} from "../src/lib/approval-presentation";
import {useApprovalPresentation} from "../src/hooks/use-approval-presentation";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("nextApprovalPresentation: upstream's dock decision with its per-card latch (cc970fefe jR/NR)", () =>
{
	it("docks a card that arrives on a short viewport and latches its id", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					shortViewport: true,
					headId: "a",
					latchedId: null,
				},
			),
		).toStrictEqual(
			{
				presentation: "dock",
				latchedId: "a",
			},
		);
	});

	it("keeps the latched card docked after the viewport grows", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					shortViewport: false,
					headId: "a",
					latchedId: "a",
				},
			),
		).toStrictEqual(
			{
				presentation: "dock",
				latchedId: "a",
			},
		);
	});

	it("draws a new head card inline once the viewport is tall again", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					shortViewport: false,
					headId: "b",
					latchedId: "a",
				},
			),
		).toStrictEqual(
			{
				presentation: "card",
				latchedId: "a",
			},
		);
	});

	it("docks with no head on a short viewport, latching nothing", () =>
	{
		expect(
			nextApprovalPresentation(
				{
					shortViewport: true,
					headId: null,
					latchedId: null,
				},
			),
		).toStrictEqual(
			{
				presentation: "dock",
				latchedId: null,
			},
		);
	});
});

function stubShortViewport(initial: boolean)
{
	const listeners = new Set<() => void>();
	const list =
	{
		matches: initial,
		addEventListener: (_type: string, listener: () => void) =>
		{
			listeners.add(listener);
		},
		removeEventListener: (_type: string, listener: () => void) =>
		{
			listeners.delete(listener);
		},
	};
	const queries: string[] = [];
	vi.stubGlobal("matchMedia", (query: string) =>
	{
		queries.push(query);
		return list;
	});
	return {
		queries,
		set(matches: boolean)
		{
			list.matches = matches;
			for (const listener of listeners) listener();
		},
	};
}

describe("useApprovalPresentation", () =>
{
	it("follows (max-height: 420px) and keeps a docked card docked until a different head arrives", () =>
	{
		const viewport = stubShortViewport(true);
		const {result, rerender} = renderHook(
			({headId}: {headId: string | null}) => useApprovalPresentation(headId),
			{
				initialProps:
				{
					headId: "a",
				},
			},
		);
		expect(result.current).toBe("dock");
		act(() =>
		{
			viewport.set(false);
		});
		expect(result.current).toBe("dock");
		rerender(
			{
				headId: "b",
			},
		);
		expect(
			{
				presentation: result.current,
				query: viewport.queries.at(-1),
			},
		).toStrictEqual(
			{
				presentation: "card",
				query: SHORT_VIEWPORT_QUERY,
			},
		);
	});

	it("renders the inline card on the server, as upstream's false server snapshot", () =>
	{
		stubShortViewport(true);
		function Probe()
		{
			return createElement("span", null, useApprovalPresentation("a"));
		}
		expect(renderToString(createElement(Probe))).toBe("<span>card</span>");
	});
});
