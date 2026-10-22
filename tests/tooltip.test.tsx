// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Tooltip} from "../src/components/ui/tooltip";

const globalsCss = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

/** The value `token` is assigned in the first top-level block opened by `blockSelector`. */
function tokenIn(blockSelector: string, token: string): string | undefined {
	const open = globalsCss.indexOf(`\n${blockSelector} {`);
	if (open === -1) throw new Error(`block not found: ${blockSelector}`);
	const close = globalsCss.indexOf("\n}", open);
	const match = new RegExp(`${token}:\\s*([^;]+);`).exec(globalsCss.slice(open, close));
	return match?.[1]?.trim();
}

function openTooltip(): HTMLElement {
	fireEvent.pointerEnter(screen.getByRole("button"));
	act(() => {
		vi.advanceTimersByTime(300);
	});
	return screen.getByRole("tooltip");
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("tooltip colours", () => {
	it("paints upstream's near-black tooltip with white text, keeping the keycap ink", () => {
		expect({
			bg: tokenIn(":root", "--tooltip-bg"),
			fg: tokenIn(":root", "--tooltip-fg"),
			shortcutInk: tokenIn(":root", "--tooltip-shortcut-ink"),
		}).toStrictEqual({bg: "rgb(11 11 11)", fg: "#fff", shortcutInk: "#898781"});
	});
});

describe("<Tooltip> box", () => {
	it("wraps within 240px, draws upstream's hairline shadow, and keeps the keycaps on one line", () => {
		vi.useFakeTimers();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
		render(
			<Tooltip content="More options for Sync fork with upstream and a long title" shortcut="ctrl+shift+d">
				<button type="button">More</button>
			</Tooltip>,
		);

		const tooltip = openTooltip();

		expect({
			className: tooltip.className,
			shortcut: tooltip.querySelector("[data-cds=Shortcut]")?.className,
		}).toStrictEqual({
			className:
				"pointer-events-none absolute z-50 inline-flex min-h-6 w-max max-w-[240px] items-center gap-2 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-1/2 mb-1 -translate-x-1/2",
			shortcut:
				"inline-flex shrink-0 items-baseline gap-[0.3em] text-caption text-[12px] whitespace-nowrap [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]",
		});
	});

	it("stacks a secondary action on its own row with upstream's 6px 8px padding and 2px gap, unbounded width", () => {
		vi.useFakeTimers();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
		render(
			<Tooltip
				content="Send"
				shortcut="enter"
				secondary={{content: "Fork with this prompt", shortcut: "cmd+alt+enter"}}
			>
				<button type="button">Send</button>
			</Tooltip>,
		);

		const tooltip = openTooltip();

		expect({
			className: tooltip.className,
			rows: [...tooltip.children].map((row) => ({className: row.className, text: row.textContent})),
		}).toStrictEqual({
			className:
				"pointer-events-none absolute z-50 flex w-max flex-col items-start gap-0.5 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-1.5 text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-1/2 mb-1 -translate-x-1/2",
			rows: [
				{className: "inline-flex items-center gap-2", text: "Send⏎Enter"},
				{className: "inline-flex items-center gap-2", text: "Fork with this prompt⌥Option⌘Command⏎Enter"},
			],
		});
	});
});

describe("<Tooltip> over a popup trigger", () => {
	it("stays closed on hover and focus while its trigger's popup is open", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Usage">
				<button type="button" aria-expanded="true">
					Ring
				</button>
			</Tooltip>,
		);
		const button = screen.getByRole("button");

		fireEvent.pointerEnter(button);
		fireEvent.focus(button);
		act(() => {
			vi.advanceTimersByTime(300);
		});

		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("closes when its trigger's popup opens while it is showing", async () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Usage">
				<button type="button" aria-expanded="false">
					Ring
				</button>
			</Tooltip>,
		);
		openTooltip();

		await act(async () => {
			screen.getByRole("button").setAttribute("aria-expanded", "true");
			await Promise.resolve();
		});

		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});

describe("<Tooltip> click behaviour", () => {
	it("closes on click by default", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Copy">
				<button type="button">Copy</button>
			</Tooltip>,
		);
		openTooltip();

		fireEvent.click(screen.getByRole("button"));

		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("stays open on click with closeOnClick={false}, as upstream keeps a disabled reason open", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Choose an option or skip this question" closeOnClick={false}>
				<button type="button">Next</button>
			</Tooltip>,
		);
		openTooltip();

		fireEvent.click(screen.getByRole("button"));

		expect(screen.getByRole("tooltip").textContent).toBe("Choose an option or skip this question");
	});
});

describe('<Tooltip variant="reason">', () => {
	it("draws upstream's balanced 240px reason box with 6px 8px padding", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Choose an option or skip this question" variant="reason">
				<button type="button">Next</button>
			</Tooltip>,
		);

		expect(openTooltip().className).toBe(
			"pointer-events-none absolute z-50 flex w-max max-w-[240px] flex-col gap-0.5 whitespace-normal text-balance rounded-r5 bg-[var(--tooltip-bg)] px-2 py-1.5 text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-1/2 mb-1 -translate-x-1/2",
		);
	});

	it("opens synchronously when focus arrives (upstream data-instant=focus)", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Choose an option or skip this question" variant="reason">
				<button type="button">Next</button>
			</Tooltip>,
		);

		fireEvent.focus(screen.getByRole("button"));

		expect(screen.getByRole("tooltip").textContent).toBe("Choose an option or skip this question");
	});

	it("still waits 300ms on focus for the default variant", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Copy">
				<button type="button">Copy</button>
			</Tooltip>,
		);

		fireEvent.focus(screen.getByRole("button"));

		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});

describe('<Tooltip align="start" stacked>', () => {
	it("stacks upstream's row title over its 11px detail in the 480px balanced box, start-aligned above the anchor", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="daily" detail="Asked a question" stacked align="start">
				<button type="button">daily</button>
			</Tooltip>,
		);

		const tooltip = openTooltip();

		expect({
			align: tooltip.dataset["align"],
			className: tooltip.className,
			children: [...tooltip.children].map((child) => ({className: child.className, text: child.textContent})),
			title: tooltip.firstElementChild?.innerHTML,
		}).toStrictEqual({
			align: "start",
			className:
				"pointer-events-none absolute z-50 flex w-max max-w-[min(480px,calc(100vw-16px))] flex-col gap-0.5 whitespace-normal text-balance rounded-r5 bg-[var(--tooltip-bg)] px-2 py-1.5 text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-0 mb-1",
			children: [
				{className: "inline-flex min-w-0 items-center gap-2", text: "daily"},
				{
					className: "break-words text-[11px]/[14px] text-[var(--tooltip-description-ink)]",
					text: "Asked a question",
				},
			],
			title: '<span class="min-w-0 break-words">daily</span>',
		});
	});

	it("keeps the centred default and data-align=center, e.g. upstream's Dismiss tooltip", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Dismiss">
				<button type="button">X</button>
			</Tooltip>,
		);

		const tooltip = openTooltip();

		expect({
			align: tooltip.dataset["align"],
			className: tooltip.className.endsWith("bottom-full left-1/2 mb-1 -translate-x-1/2"),
		}).toStrictEqual({
			align: "center",
			className: true,
		});
	});

	it("aligns a bottom tip to the anchor's start edge", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="daily" side="bottom" align="start">
				<button type="button">daily</button>
			</Tooltip>,
		);

		expect(openTooltip().className.endsWith(" top-full left-0 mt-1")).toBe(true);
	});
});

describe('<Tooltip trackCursor="y">', () => {
	function renderEdge(trackCursor?: "y") {
		vi.useFakeTimers();
		render(
			<Tooltip
				content="Show sidebar"
				description="Drag to resize"
				side="right"
				{...(trackCursor === undefined ? {} : {trackCursor})}
			>
				<button type="button">Edge</button>
			</Tooltip>,
		);
	}

	function tipStyle(): {top: string; className: string} {
		const tooltip = openTooltip();
		return {top: tooltip.style.top, className: tooltip.className};
	}

	it("wraps the stacked description box within upstream's 240px", () => {
		renderEdge();

		expect(
			tipStyle()
				.className.split(" ")
				.filter((name) => name.startsWith("max-w-")),
		).toStrictEqual(["max-w-[240px]"]);
	});

	it("centres the popup on the pointer's Y, flush with the anchor's top instead of its middle", () => {
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(46);
		renderEdge("y");

		const {className} = tipStyle();
		fireEvent.pointerMove(screen.getByRole("button"), {clientY: 400});
		const {top} = screen.getByRole("tooltip").style;
		fireEvent.pointerMove(screen.getByRole("button"), {clientY: 500});

		expect({
			top,
			side: className.endsWith(" left-full top-0 ml-1"),
			moved: screen.getByRole("tooltip").style.top,
		}).toStrictEqual({top: "377px", side: true, moved: "477px"});
	});

	it("keeps the popup 8px inside the viewport's top and bottom", () => {
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(46);
		renderEdge("y");

		openTooltip();
		fireEvent.pointerMove(screen.getByRole("button"), {clientY: 10});
		const nearTop = screen.getByRole("tooltip").style.top;
		fireEvent.pointerMove(screen.getByRole("button"), {clientY: window.innerHeight - 2});

		expect({nearTop, nearBottom: screen.getByRole("tooltip").style.top}).toStrictEqual({
			nearTop: "8px",
			nearBottom: `${window.innerHeight - 46 - 8}px`,
		});
	});

	it("leaves the popup centred on the anchor without tracking", () => {
		renderEdge();

		fireEvent.pointerMove(screen.getByRole("button"), {clientY: 400});

		expect(tipStyle()).toStrictEqual({
			top: "",
			className: expect.stringMatching(/ left-full top-1\/2 ml-1 -translate-y-1\/2$/),
		});
	});
});
