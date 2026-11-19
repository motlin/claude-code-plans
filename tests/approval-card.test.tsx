// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ApprovalScrollRegion, UrlElicitationCard} from "../src/components/approval-card";
import {ElicitationFormCard} from "../src/components/elicitation-form-card";
import {InlinePlanApproval} from "../src/components/inline-plan-approval";
import {PermissionCard} from "../src/components/permission-card";
import {QuestionCard} from "../src/components/question-card";
import {compileAll, loadDesignSystem} from "./helpers/tailwind-design-system";

afterEach(cleanup);

function permissionChrome()
{
	const container = render(
		<PermissionCard
			title={
			{
				action: "run",
				meta: null,
			}}
			detail="ls"
			canAnswer
			onDecision={async () =>
			{
			}}
		/>,
	).container;
	const classOf = (element: Element | null) => element?.getAttribute("class") ?? null;
	return {
		root: container.querySelector("[data-approval-card-root]"),
		card: classOf(container.querySelector("[data-approval-card-root]")),
		actions: classOf(container.querySelector("[data-approval-card-actions]")),
		secondary: classOf(
			screen.getByRole(
				"button",
				{
					name: /^Deny/,
				},
			),
		),
		primary: classOf(
			screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			),
		),
	};
}

describe("approval card chrome", () =>
{
	// Upstream approval cards carry data-fixed-code-size, so their code keeps the default size under
	// Settings ▸ Code font size; the detail opts into the hook class that the exemption rule matches.
	it("fixes the card's code size with upstream's data-fixed-code-size root and epitaxy-code-size detail", () =>
	{
		const {root} = permissionChrome();

		expect(
			{
				fixed: root?.getAttribute("data-fixed-code-size"),
				detail: root?.querySelector("[data-permission-detail]")?.classList.contains("epitaxy-code-size"),
			},
		).toStrictEqual(
			{
				fixed: "",
				detail: true,
			},
		);
	});

	// Upstream's cds host shell `Re` (shared-40, 2026-11-10) marks every un-themed approval card root. The approval
	// host `J` (c2d1aeb56) never passes `themed`, and the permission, plan (`Ud`), form (`Nd`) and url (`Fd`)
	// elicitation cards all draw through it; only the AskUserQuestion card (`epitaxy-question-card`) is themed.
	it("marks the permission, plan and elicitation card roots with upstream's data-approval-prompt, and not the question card", async () =>
	{
		const {root} = permissionChrome();
		cleanup();
		const markOf = (container: HTMLElement) =>
			container.querySelector("[data-approval-card-root]")?.getAttribute("data-approval-prompt") ?? null;
		const plan = render(
			<InlinePlanApproval
				toolUseId="toolu_plan_1"
				planText="# Plan: X"
				plan={
				{
					sessionId: "sess_1",
					answerRoute: "live-pane",
					loadDialog: async () =>
						Promise.resolve(
							{
								forwardMode: "auto",
								manual: true,
							},
						),
					decide: async () => Promise.resolve(),
				}}
			/>,
		).container;
		await act(async () => Promise.resolve());
		const planMark = markOf(plan);
		cleanup();
		const form = markOf(
			render(
				<ElicitationFormCard
					serverName="fake-server"
					message="Name?"
					schema={
					{
						type: "object",
						properties:
						{
							name:
							{
								type: "string",
								title: "Name",
							},
						},
					}}
					fieldNames={["name"]}
					onAnswer={async () =>
					{
					}}
				/>,
			).container,
		);
		cleanup();
		const url = markOf(
			render(
				<UrlElicitationCard
					serverName="fake-server"
					message=""
					url="https://example.com/fake"
					dialogFocus={null}
					onDecision={async () =>
					{
					}}
				/>,
			).container,
		);
		cleanup();
		const question = render(
			<QuestionCard
				questions={[
					{
						question: "Pick one?",
						options: [
							{
								label: "Yes",
							},
						],
					},
				]}
				onSubmit={async () =>
				{
				}}
			/>,
		).container.querySelector("[data-approval-card-root]");
		expect(
			{
				permission: root?.getAttribute("data-approval-prompt"),
				plan: planMark,
				form,
				url,
				question: question?.hasAttribute("data-approval-prompt"),
			},
		).toStrictEqual(
			{
				permission: "",
				plan: "",
				form: "",
				url: "",
				question: false,
			},
		);
	});

	it("rounds the card with upstream's rounded-card (cds radius + 4px), not the fixed 10px rounded-r7", () =>
	{
		const classes = permissionChrome().card?.split(/\s+/) ?? [];
		expect(
			{
				card: classes.includes("rounded-card"),
				r7: classes.includes("rounded-r7"),
			},
		).toStrictEqual(
			{
				card: true,
				r7: false,
			},
		);
	});

	it("makes the permission card its own container and stacks its actions and any split button full width at upstream's 420px", () =>
	{
		const {root, actions} = permissionChrome();

		expect(
			{
				container: root?.className.split(/\s+/).includes("@container"),
				queries: (actions ?? "").split(/\s+/).filter((name) => name.startsWith("@max-[")),
			},
		).toStrictEqual(
			{
				container: true,
				queries: [
					"@max-[420px]:flex-col",
					"@max-[420px]:items-stretch",
					"@max-[420px]:[&>div]:flex-col",
					"@max-[420px]:[&>div]:items-stretch",
					"@max-[420px]:[&_[data-cds=SplitDropdownButton]]:w-full",
					"@max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child_button]:flex-auto",
					"@max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child>div>:first-child]:flex-auto",
				],
			},
		);
	});

	it("uses upstream's control-token secondary and primary cds Buttons: h-control, text-body, the button pad, --cds-radius, the control weight, no ring or drop shadow under fizzy colour", () =>
	{
		const chrome = permissionChrome();
		const base =
			"relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--upstream-radius)] whitespace-nowrap select-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus [&:disabled:not([aria-busy])]:opacity-disabled disabled:pointer-events-none stacks:[&:disabled:not([aria-busy])]:opacity-100 stacks:[&:disabled:not([aria-busy])]:text-button-disabled stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor] h-control px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))] text-body";
		expect(
			{
				card: [
					"rounded-card",
					"p-lg",
					"card-ring",
					"focus-visible:outline-1",
					"focus-visible:outline-fill-accent",
					"focus-visible:outline-offset-2",
				].filter((name) => !chrome.card?.split(/\s+/).includes(name)),
				secondary: chrome.secondary,
				primary: chrome.primary,
				shortcut: chrome.root
					?.querySelector("[data-approval-primary] [data-cds=Shortcut]")
					?.getAttribute("class"),
			},
		).toStrictEqual(
			{
				card: [],
				secondary: `${base} bg-fill-secondary font-control-regular [:root:not([data-cds-fizzy-lake~=color])_&]:shadow-field-drop after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] [:root:not([data-cds-fizzy-lake~=color])_&]:after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)] text-primary hover:bg-fill-secondary-hover stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled`,
				primary: `${base} bg-primary font-control text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-primary/80 stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled`,
				shortcut:
					"inline-flex shrink-0 items-center gap-[2px] text-caption [&:where(:root[dir=rtl]_:dir(rtl))]:flex-row-reverse pointer-coarse:hidden ms-1 me-[calc((var(--cds-h-control)-1em-6px)/2-min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md))))]",
			},
		);
	});

	it("compiles the pre-fizzy secondary depth only outside fizzy colour, like upstream's stacks:shadow-none", async () =>
	{
		const compiled = await compileAll([
			"[:root:not([data-cds-fizzy-lake~=color])_&]:shadow-field-drop",
			"[:root:not([data-cds-fizzy-lake~=color])_&]:after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
		]);
		expect(Object.values(compiled).map((css) => css?.slice(0, css.indexOf(" {")).split(" .")[0])).toStrictEqual([
			":root:not([data-cds-fizzy-lake~=color])",
			":root:not([data-cds-fizzy-lake~=color])",
		]);
	});
});

describe("approval card disabled actions, as upstream's cds Button", () =>
{
	it("emits the fizzy disabled rules after the base opacity and the variants' hover paint, so they win at equal specificity", async () =>
	{
		const candidates = [
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"hover:bg-fill-secondary-hover",
			"hover:bg-primary/80",
		];
		const order = (await loadDesignSystem()).getClassOrder(candidates);
		const sorted = order.toSorted(([, a], [, b]) => (a === null || b === null ? 0 : a < b ? -1 : a > b ? 1 : 0));
		expect(sorted.map(([name]) => name)).toStrictEqual([
			"hover:bg-fill-secondary-hover",
			"hover:bg-primary/80",
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
		]);
	});

	it("compiles the disabled look: opacity .4 by default; under fizzy colour (outside forced colours and data-cds-theme) opacity 1 with the disabled ink, fill and cap ink; busy buttons excluded", async () =>
	{
		const disabled = ":disabled:not([aria-busy])";
		const stacks =
			':where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *))';
		const compiled = await compileAll([
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"disabled:pointer-events-none",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
			"stacks:[&:disabled:not([aria-busy])]:text-button-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
		]);
		expect(compiled).toStrictEqual(
			{
				"[&:disabled:not([aria-busy])]:opacity-disabled": `.\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:opacity-disabled${disabled} { opacity: var(--upstream-opacity-disabled, 0.4); }`,
				"disabled:pointer-events-none": ".disabled\\:pointer-events-none:disabled { pointer-events: none; }",
				"stacks:[&:disabled:not([aria-busy])]:opacity-100": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:opacity-100${stacks}${disabled} { opacity: 100%; } }`,
				"stacks:[&:disabled:not([aria-busy])]:text-button-disabled": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:text-button-disabled${stacks}${disabled} { color: var(--upstream-text-button-disabled, var(--upstream-text-disabled, currentColor)); } }`,
				"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:\\[--shortcut-cap-ink\\:currentColor\\]${stacks}${disabled} { --shortcut-cap-ink: currentColor; } }`,
				"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:bg-fill-disabled${stacks}${disabled} { background-color: var(--upstream-fill-disabled); } }`,
			},
		);
	});
});

function dragEvent(type: string, types: string[])
{
	const event = new Event(
		type,
		{
			bubbles: true,
			cancelable: true,
		},
	);
	const dataTransfer =
	{
		types,
		dropEffect: "copy",
	};
	Object.defineProperty(
		event,
		"dataTransfer",
		{
			value: dataTransfer,
		},
	);
	return {
		event,
		dataTransfer,
	};
}

let listeners = new AbortController();
afterEach(() =>
{
	listeners.abort();
	listeners = new AbortController();
});

describe("approval card file drops", () =>
{
	it("swallows file drags on the card so they never reach a parent drop handler, as upstream does", () =>
	{
		const {root} = permissionChrome();
		const reached: string[] = [];
		for (const type of ["dragenter", "dragover", "dragleave", "drop"])
		{
			document.addEventListener(
				type,
				() => reached.push(type),
				{
					signal: listeners.signal,
				},
			);
		}
		const results = ["dragenter", "dragover", "dragleave", "drop"].map((type) =>
		{
			const {event, dataTransfer} = dragEvent(type, ["Files"]);
			root?.dispatchEvent(event);
			return {
				type,
				prevented: event.defaultPrevented,
				dropEffect: dataTransfer.dropEffect,
			};
		});
		expect(
			{
				results,
				reached,
			},
		).toStrictEqual(
			{
				results: [
					{
						type: "dragenter",
						prevented: true,
						dropEffect: "none",
					},
					{
						type: "dragover",
						prevented: true,
						dropEffect: "none",
					},
					{
						type: "dragleave",
						prevented: true,
						dropEffect: "none",
					},
					{
						type: "drop",
						prevented: true,
						dropEffect: "none",
					},
				],
				reached: [],
			},
		);
	});

	it("lets non-file drags through", () =>
	{
		const {root} = permissionChrome();
		const reached: string[] = [];
		document.addEventListener(
			"drop",
			() => reached.push("drop"),
			{
				signal: listeners.signal,
			},
		);
		const {event, dataTransfer} = dragEvent("drop", ["text/plain"]);
		root?.dispatchEvent(event);
		expect(
			{
				prevented: event.defaultPrevented,
				dropEffect: dataTransfer.dropEffect,
				reached,
			},
		).toStrictEqual(
			{
				prevented: false,
				dropEffect: "copy",
				reached: ["drop"],
			},
		);
	});
});

describe("approval queue ghost stack (upstream shared-40 Re, c2d1aeb56 w)", () =>
{
	function ghosts(presentation: "card" | "dock", queueDepth: number)
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				presentation={presentation}
				queueDepth={queueDepth}
				onDecision={async () =>
				{
				}}
			/>,
		);
		const root = container.querySelector("[data-approval-card-root]");
		const children = [...(root?.children ?? [])];
		return (
			children
				// Upstream's ghosts are the root's bare aria-hidden layers; the backdrop is the one marked as the sidebar surface.
				.filter((child) => child.getAttribute("aria-hidden") === "true" && !child.hasAttribute("data-surface"))
				.map((ghost) => (
				{
					index: children.indexOf(ghost),
					ariaHidden: ghost.getAttribute("aria-hidden"),
					className: ghost.getAttribute("class"),
					transform: (ghost as HTMLElement).style.transform,
					zIndex: (ghost as HTMLElement).style.zIndex,
					opacity: (ghost as HTMLElement).style.opacity,
				}))
		);
	}

	const GHOST_CLASS =
		"absolute inset-0 rounded-card bg-surface-1 origin-top transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none";

	it("draws one ghost per queued request behind the docked card, capped at two, before its sidebar backdrop", () =>
	{
		expect(
			{
				one: ghosts("dock", 1),
				five: ghosts("dock", 5),
				none: ghosts("dock", 0),
			},
		).toStrictEqual(
			{
				one: [
					{
						index: 0,
						ariaHidden: "true",
						className: GHOST_CLASS,
						transform: "translateY(-6px) scale(0.97)",
						zIndex: "-1",
						opacity: "0.75",
					},
				],
				five: [
					{
						index: 0,
						ariaHidden: "true",
						className: GHOST_CLASS,
						transform: "translateY(-6px) scale(0.97)",
						zIndex: "-1",
						opacity: "0.75",
					},
					{
						index: 1,
						ariaHidden: "true",
						className: GHOST_CLASS,
						transform: "translateY(-12px) scale(0.94)",
						zIndex: "-2",
						opacity: "0.5",
					},
				],
				none: [],
			},
		);
		cleanup();
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				presentation="dock"
				queueDepth={2}
				onDecision={async () =>
				{
				}}
			/>,
		);
		const root = container.querySelector("[data-approval-card-root]");
		expect(
			{
				backdropIndex: [...(root?.children ?? [])].findIndex(
					(child) => child.getAttribute("data-surface") === "sidebar",
				),
				originTop: root?.classList.contains("origin-top"),
			},
		).toStrictEqual(
			{
				backdropIndex: 2,
				originTop: true,
			},
		);
	});

	it("draws no ghost on the inline card, whatever the depth", () =>
	{
		expect(ghosts("card", 3)).toStrictEqual([]);
	});
});

describe("approval scroll region (upstream c2d1aeb56 scroller)", () =>
{
	const callbacks: ResizeObserverCallback[] = [];

	class CapturingResizeObserver
	{
		constructor(callback: ResizeObserverCallback)
		{
			callbacks.push(callback);
		}
		observe()
		{
		}
		unobserve()
		{
		}
		disconnect()
		{
		}
		takeRecords()
		{
			return [];
		}
	}

	beforeEach(() =>
	{
		callbacks.length = 0;
		vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
	});

	afterEach(() =>
	{
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function region()
	{
		render(
			<ApprovalScrollRegion data-testid="region" label="Request details" className="flex flex-col">
				<button type="button">Inside</button>
			</ApprovalScrollRegion>,
		);
		return screen.getByTestId("region");
	}

	function overflow(element: HTMLElement)
	{
		vi.spyOn(element, "scrollHeight", "get").mockReturnValue(200);
		vi.spyOn(element, "clientHeight", "get").mockReturnValue(100);
		act(() =>
		{
			for (const callback of callbacks) callback([], {} as ResizeObserver);
		});
	}

	const attributes = (element: HTMLElement) => (
	{
		tabindex: element.getAttribute("tabindex"),
		role: element.getAttribute("role"),
		"aria-label": element.getAttribute("aria-label"),
		"data-fixed-code-size": element.getAttribute("data-fixed-code-size"),
	});

	it("is a plain box while it fits and a focusable labelled group once it overflows, with upstream's clamp classes", () =>
	{
		const element = region();
		const fits = attributes(element);
		overflow(element);
		expect(
			{
				fits,
				overflowing: attributes(element),
				group:
					screen.getByRole(
						"group",
						{
							name: "Request details",
						},
					) === element,
				className: element.getAttribute("class"),
			},
		).toStrictEqual(
			{
				fits:
				{
					tabindex: null,
					role: null,
					"aria-label": null,
					"data-fixed-code-size": "",
				},
				overflowing:
				{
					tabindex: "0",
					role: "group",
					"aria-label": "Request details",
					"data-fixed-code-size": "",
				},
				group: true,
				className:
					"epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus flex flex-col",
			},
		);
	});

	it("scrolls itself into view only on keyboard focus of the region itself", () =>
	{
		const element = region();
		overflow(element);
		const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>();
		element.scrollIntoView = scrollIntoView;
		const focusVisible = vi.spyOn(element, "matches");
		const calls = (visible: boolean, target: HTMLElement) =>
		{
			scrollIntoView.mockClear();
			focusVisible.mockImplementation((selector) => selector === ":focus-visible" && visible);
			act(() =>
			{
				target.blur();
				target.focus();
			});
			return scrollIntoView.mock.calls;
		};
		expect(
			{
				keyboard: calls(true, element),
				pointer: calls(false, element),
				child: calls(
					true,
					screen.getByRole(
						"button",
						{
							name: "Inside",
						},
					),
				),
			},
		).toStrictEqual(
			{
				keyboard: [
					[
						{
							block: "nearest",
						},
					],
				],
				pointer: [],
				child: [],
			},
		);
	});
});

describe("approval conversation cap (upstream c2d1aeb56 `B`)", () =>
{
	it("compiles the in-flow tool card's cap and end reclaim from the fitter's properties", async () =>
	{
		expect(
			await compileAll([
				"max-h-[var(--approval-conversation-cap,max(60vh,calc(16rem*var(--cds-rem-scale,1))))]",
				"mb-[calc(-1*var(--approval-conversation-end-reclaim,0px))]",
			]),
		).toStrictEqual(
			{
				"max-h-[var(--approval-conversation-cap,max(60vh,calc(16rem*var(--cds-rem-scale,1))))]":
					".max-h-\\[var\\(--approval-conversation-cap\\,max\\(60vh\\,calc\\(16rem\\*var\\(--cds-rem-scale\\,1\\)\\)\\)\\)\\] { max-height: var(--approval-conversation-cap,max(60vh, calc(16rem * var(--cds-rem-scale,1)))); }",
				"mb-[calc(-1*var(--approval-conversation-end-reclaim,0px))]":
					".mb-\\[calc\\(-1\\*var\\(--approval-conversation-end-reclaim\\,0px\\)\\)\\] { margin-bottom: calc(-1 * var(--approval-conversation-end-reclaim,0px)); }",
			},
		);
	});

	class FakeResizeObserver
	{
		static instances: FakeResizeObserver[] = [];
		observed: Element[] = [];
		disconnected = false;
		constructor(readonly callback: () => void)
		{
			FakeResizeObserver.instances.push(this);
		}
		observe(element: Element)
		{
			this.observed.push(element);
		}
		unobserve()
		{
		}
		disconnect()
		{
			this.disconnected = true;
		}
		/** The fitter's observer: the only one watching the scroller. */
		static fitters(scroller: Element)
		{
			return FakeResizeObserver.instances.filter((instance) => instance.observed.includes(scroller));
		}
		static fire()
		{
			act(() =>
			{
				for (const instance of FakeResizeObserver.instances) instance.callback();
			});
		}
	}

	beforeEach(() =>
	{
		FakeResizeObserver.instances = [];
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	});
	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	function card(presentation: "card" | "dock")
	{
		return (
			<div
				data-testid="scroller"
				style={
				{
					overflowY: "auto",
				}}
			>
				<PermissionCard
					title={
					{
						action: "run",
						meta: null,
					}}
					detail="ls"
					canAnswer
					presentation={presentation}
					onDecision={async () =>
					{
					}}
				/>
			</div>
		);
	}

	function setClientHeight(element: Element, value: number)
	{
		Object.defineProperty(
			element,
			"clientHeight",
			{
				configurable: true,
				value,
			},
		);
	}

	it("fits an inline tool card to its scroller, re-measures on resize and clears both properties on unmount", () =>
	{
		const view = render(card("card"));
		const scroller = screen.getByTestId("scroller");
		const root = view.container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const cap = () => root.style.getPropertyValue("--approval-conversation-cap");
		const mounted = cap();
		setClientHeight(scroller, 800);
		FakeResizeObserver.fire();
		const tall = cap();
		setClientHeight(scroller, 600);
		FakeResizeObserver.fire();
		const short = cap();
		const fitters = FakeResizeObserver.fitters(scroller);
		const observed = fitters
			.flatMap(({observed}) => observed)
			.map((element) =>
				element === scroller
					? "scroller"
					: element === root.parentElement
						? "column"
						: element.matches("[data-approval-card-body]")
							? "body"
							: "other",
			);
		view.unmount();
		expect(
			{
				mounted,
				tall,
				short,
				observed,
				afterUnmount: [cap(), root.style.getPropertyValue("--approval-conversation-end-reclaim")],
				disconnected: fitters.map(({disconnected}) => disconnected),
			},
		).toStrictEqual(
			{
				mounted: "",
				tall: "max(min(60vh, 800px), 34px)",
				short: "max(min(60vh, 600px), 34px)",
				observed: ["scroller", "column", "body"],
				afterUnmount: ["", ""],
				disconnected: [true],
			},
		);
	});

	it("stops fitting when the card docks, and never fits a docked card", () =>
	{
		const view = render(card("card"));
		const scroller = screen.getByTestId("scroller");
		setClientHeight(scroller, 800);
		FakeResizeObserver.fire();
		const root = view.container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const inline = root.style.getPropertyValue("--approval-conversation-cap");
		view.rerender(card("dock"));
		const docked = view.container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		expect(
			{
				inline,
				sameRoot: docked === root,
				docked: docked.style.getPropertyValue("--approval-conversation-cap"),
				fitters: FakeResizeObserver.fitters(scroller).map(({disconnected}) => disconnected),
			},
		).toStrictEqual(
			{
				inline: "max(min(60vh, 800px), 34px)",
				sameRoot: true,
				docked: "",
				fitters: [true],
			},
		);
	});
});
