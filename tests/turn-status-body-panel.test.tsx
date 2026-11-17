// @vitest-environment jsdom

import {act, cleanup, render, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {TurnStatusBodyPanel} from "../src/components/turn-status-body-panel";
import
{
	TURN_STATUS_CARD_CLASS,
	TURN_STATUS_PANEL_CLASS,
	TURN_STATUS_PANEL_LEAVING_CLASS,
} from "../src/components/turn-status-row-geometry";
import {useTurnStatusPanelLeaving} from "../src/components/use-turn-status-panel-leaving";

afterEach(() =>
{
	cleanup();
});

function panelShape(container: HTMLElement)
{
	const panel = container.querySelector<HTMLElement>("[data-turn-status-panel]")!;
	return {
		className: panel.className,
		style: panel.getAttribute("style"),
		card: panel.firstElementChild?.className,
		cells: [...(panel.firstElementChild?.children ?? [])].map((cell) => cell.textContent),
	};
}

function stubReducedMotion(reduce: boolean)
{
	vi.stubGlobal("matchMedia", (query: string) => (
	{
		matches: reduce,
		media: query,
		addEventListener: () =>
		{
		},
		removeEventListener: () =>
		{
		},
	}));
}

describe("TurnStatusBodyPanel", () =>
{
	it("draws upstream Cd's panel and card at rest, and indents a marked row's body past its mark", () =>
	{
		const cells = (
			<>
				<div>one</div>
				<div>two</div>
			</>
		);
		const rest = render(
			<TurnStatusBodyPanel marked={false} leaving={false}>
				{cells}
			</TurnStatusBodyPanel>,
		).container;
		const marked = render(
			<TurnStatusBodyPanel marked leaving={false}>
				{cells}
			</TurnStatusBodyPanel>,
		).container;
		const leaving = render(
			<TurnStatusBodyPanel marked={false} leaving>
				{cells}
			</TurnStatusBodyPanel>,
		).container;

		expect(
			{
				rest: panelShape(rest),
				marked: panelShape(marked),
				leaving: panelShape(leaving),
			},
		).toStrictEqual(
			{
				rest:
				{
					className: "pt-sm pb-xs",
					style: null,
					card: "[--cds-assistant-message-text-inset:0px] [--cds-assistant-message-text-stop:0px] flex min-w-0 flex-col divide-y overflow-y-clip rounded-card shadow-card-ring",
					cells: ["one", "two"],
				},
				marked:
				{
					className: "pt-sm pb-xs",
					style: "padding-inline-start: calc(var(--cds-assistant-message-text-inset,0px) + 20px + 12px);",
					card: TURN_STATUS_CARD_CLASS,
					cells: ["one", "two"],
				},
				leaving:
				{
					className: `${TURN_STATUS_PANEL_CLASS} ${TURN_STATUS_PANEL_LEAVING_CLASS}`,
					style: null,
					card: TURN_STATUS_CARD_CLASS,
					cells: ["one", "two"],
				},
			},
		);
	});
});

describe("useTurnStatusPanelLeaving", () =>
{
	afterEach(() =>
	{
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("leaves for upstream's 400ms when a marked row settles, and not when it stays active or was never marked", () =>
	{
		vi.useFakeTimers();
		stubReducedMotion(false);
		const settle = renderHook(
			({marked, active}) => useTurnStatusPanelLeaving(marked, active),
			{
				initialProps:
				{
					marked: true,
					active: true,
				},
			},
		);
		const stayActive = renderHook(
			({marked, active}) => useTurnStatusPanelLeaving(marked, active),
			{
				initialProps:
				{
					marked: true,
					active: true,
				},
			},
		);
		const neverMarked = renderHook(
			({marked, active}) => useTurnStatusPanelLeaving(marked, active),
			{
				initialProps:
				{
					marked: false,
					active: true,
				},
			},
		);
		settle.rerender(
			{
				marked: false,
				active: false,
			},
		);
		stayActive.rerender(
			{
				marked: false,
				active: true,
			},
		);
		neverMarked.rerender(
			{
				marked: false,
				active: false,
			},
		);
		const settled = [settle.result.current, stayActive.result.current, neverMarked.result.current];
		act(() =>
		{
			vi.advanceTimersByTime(399);
		});
		const before = settle.result.current;
		act(() =>
		{
			vi.advanceTimersByTime(1);
		});

		expect(
			{
				settled,
				before,
				after: settle.result.current,
			},
		).toStrictEqual(
			{
				settled: [true, false, false],
				before: true,
				after: false,
			},
		);
	});

	it("ends the leave at once under reduced motion", () =>
	{
		stubReducedMotion(true);
		const hook = renderHook(
			({marked, active}) => useTurnStatusPanelLeaving(marked, active),
			{
				initialProps:
				{
					marked: true,
					active: true,
				},
			},
		);
		hook.rerender(
			{
				marked: false,
				active: false,
			},
		);

		expect(hook.result.current).toBe(false);
	});
});
