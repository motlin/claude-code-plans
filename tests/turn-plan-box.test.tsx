// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {TurnPlanBoxCard} from "../src/components/turn-plan-box";
import {PLAN_EXIT_HOLD_MS, usePlanExitHold} from "../src/lib/plan-exit-hold";
import type {PlanTodo} from "../src/lib/session-plan-model";

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	document.documentElement.removeAttribute("data-reduce-motion");
});

const TODOS: PlanTodo[] = [
	{
		content: "Read the config",
		status: "completed",
	},
	{
		content: "Fix the loader",
		status: "in_progress",
	},
	{
		content: "Run the tests",
		status: "pending",
	},
];

function steps(count: number, active: number): PlanTodo[]
{
	return Array.from(
		{
			length: count,
		},
		(_, index) => (
		{
			content: `Step ${index + 1}`,
			status: index < active ? "completed" : index === active ? "in_progress" : "pending",
		}),
	);
}

const openPane = vi.fn<(kind: string) => void>();
const HOST =
{
	openPane,
} as unknown as PaneHostApi;

const BASE =
{
	sessionId: "s1",
	todos: TODOS,
	closing: false,
	stale: false,
	working: true,
	parked: false,
	agentsRunning: 0,
} as const;

describe("TurnPlanBoxCard (upstream EpitaxyTurnBox UF → zF + KF)", () =>
{
	it("draws the card shell, the plan body and the muted-done checklist with a spinning active item", () =>
	{
		const {container} = render(<TurnPlanBoxCard {...BASE} />);
		const shell = container.firstElementChild;
		const wrapper = shell?.firstElementChild;
		const body = wrapper?.firstElementChild?.firstElementChild;
		const items = [...container.querySelectorAll("li")];
		expect(
			{
				shell: shell?.className,
				wrapper: wrapper?.className,
				inner: wrapper?.firstElementChild?.className,
				body: body?.className,
				list: [container.querySelector("ul")?.getAttribute("role"), container.querySelector("ul")?.className],
				items: items.map((item) => item.className),
				marks: items.map((item) => item.firstElementChild?.className),
				doneGlyph: items[0]?.querySelector("svg") !== null,
				spinner: items[1]?.querySelector("[data-running-spinner]")?.className,
				pendingGlyph: items[2]
					?.querySelector("svg")
					?.getAttribute("class")
					?.includes("text-muted-as-secondary"),
				text: items.map((item) => item.textContent),
				content: items[0]?.lastElementChild?.className,
			},
		).toStrictEqual(
			{
				shell: "mt-[var(--chat-turn-gap,15px)] epitaxy-root motion-safe:animate-fade-in text-body text-primary break-words overflow-clip rounded-card shadow-[inset_0_0_0_1px_var(--card-outline)] [&:not(:has(li:not([hidden]_li),button:not([hidden]_button):not([data-turn-dismiss]_button),p:not([hidden]_p)))]:hidden",
				wrapper:
					" [&:has(+[data-turn-next]_button:not([hidden]_button):not([data-turn-dismiss]_button))]:hidden [&:has(+[data-turn-next]_p:not([hidden]_p))]:hidden",
				inner: "min-h-0 min-w-0",
				body: "flex flex-col gap-1 p-4",
				list: ["list", "m-0 list-none p-0 flex flex-col text-body select-text gap-xs"],
				items: [
					"flex items-start gap-1 [--code-chip-ink:currentColor] text-secondary",
					"flex items-start gap-1 text-primary",
					"flex items-start gap-1 text-primary",
				],
				marks: [
					"epitaxy-markdown-first-line shrink-0 w-[calc(1rem*var(--cds-rem-scale,1))] flex items-center justify-center text-secondary",
					"epitaxy-markdown-first-line shrink-0 w-[calc(1rem*var(--cds-rem-scale,1))] flex items-center justify-center text-primary",
					"epitaxy-markdown-first-line shrink-0 w-[calc(1rem*var(--cds-rem-scale,1))] flex items-center justify-center",
				],
				doneGlyph: true,
				spinner:
					"running-spinner inline-flex size-4 motion-safe:[&>span:last-child]:animate-[spin_1.6s_linear_infinite]",
				pendingGlyph: true,
				text: ["doneRead the config", "in progressFix the loader", "not doneRun the tests"],
				content: "epitaxy-markdown-inherit-color min-w-0 flex-1",
			},
		);
	});
	it("says the plan is from before the last message and stops spinning when stale", () =>
	{
		const {container} = render(<TurnPlanBoxCard {...BASE} stale="prompt" />);
		const caption = container.querySelector("p");
		expect(
			{
				caption: [caption?.textContent, caption?.className],
				spinners: container.querySelectorAll("[data-running-spinner]").length,
			},
		).toStrictEqual(
			{
				caption: ["Plan from before your last message", "text-caption text-muted-as-secondary select-text"],
				spinners: 0,
			},
		);
	});
	it("windows a long plan with earlier-steps and more-to-go captions", () =>
	{
		const {container} = render(<TurnPlanBoxCard {...BASE} todos={steps(16, 4)} />);
		expect(
			{
				captions: [...container.querySelectorAll("p")].map((p) => [p.textContent, p.className]),
				items: container.querySelectorAll("li").length,
			},
		).toStrictEqual(
			{
				captions: [
					["3 earlier steps", "ps-6 text-caption text-muted-as-secondary"],
					["1 more to go", "ps-6 text-caption text-muted-as-secondary"],
				],
				items: 12,
			},
		);
	});
	it("stops the spinner while parked (compacting)", () =>
	{
		const {container} = render(<TurnPlanBoxCard {...BASE} parked />);
		expect(container.querySelectorAll("[data-running-spinner]").length).toBe(0);
	});
	it("offers the running tasks on the active item once the turn ends with agents running", () =>
	{
		const {container} = render(
			<PaneHostContext.Provider value={HOST}>
				<TurnPlanBoxCard {...BASE} working={false} agentsRunning={2} />
			</PaneHostContext.Provider>,
		);
		const button = container.querySelector("button");
		act(() =>
		{
			if (button !== null) fireEvent.click(button);
		});
		expect(
			{
				text: button?.textContent,
				inActiveItem: button?.closest("li") === container.querySelectorAll("li")[1],
				opened: openPane.mock.calls,
			},
		).toStrictEqual(
			{
				text: "2 running tasks",
				inActiveItem: true,
				opened: [["background-tasks"]],
			},
		);
	});
	it("holds a closing plan inert in upstream's exit wrapper", () =>
	{
		const {container} = render(<TurnPlanBoxCard {...BASE} closing />);
		const wrapper = container.firstElementChild?.firstElementChild;
		expect([
			wrapper?.hasAttribute("inert"),
			wrapper?.className.startsWith("epitaxy-plan-exit grid grid-rows-[1fr] overflow-clip "),
		]).toStrictEqual([true, true]);
	});
});

describe("usePlanExitHold (upstream WF)", () =>
{
	function hold(initial: {todos: PlanTodo[] | null; working: boolean})
	{
		return renderHook(
			({todos, working}) => usePlanExitHold(todos, working),
			{
				initialProps: initial,
			},
		);
	}
	it("keeps a dropped working plan closing for the exit's duration, then clears it", () =>
	{
		vi.useFakeTimers();
		const {result, rerender} = hold(
			{
				todos: TODOS,
				working: true,
			},
		);
		rerender(
			{
				todos: null,
				working: false,
			},
		);
		const closing = result.current;
		act(() =>
		{
			vi.advanceTimersByTime(PLAN_EXIT_HOLD_MS);
		});
		expect([closing, result.current, PLAN_EXIT_HOLD_MS]).toStrictEqual([
			{
				todos: TODOS,
				closing: true,
			},
			{
				todos: null,
				closing: false,
			},
			200,
		]);
	});
	it("drops the plan at once under reduced motion, or from the non-working state", () =>
	{
		const idle = hold(
			{
				todos: TODOS,
				working: false,
			},
		);
		idle.rerender(
			{
				todos: null,
				working: false,
			},
		);
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const reduced = hold(
			{
				todos: TODOS,
				working: true,
			},
		);
		reduced.rerender(
			{
				todos: null,
				working: false,
			},
		);
		expect([idle.result.current, reduced.result.current]).toStrictEqual([
			{
				todos: null,
				closing: false,
			},
			{
				todos: null,
				closing: false,
			},
		]);
	});
});
