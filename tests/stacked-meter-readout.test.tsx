// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {StackedMeter, StackedMeterGroup, type StackedMeterCategory} from "../src/components/ui/stacked-meter";

const CATEGORIES: StackedMeterCategory[] = [
	{id: "a", label: "Alpha"},
	{id: "b", label: "Beta"},
];

class FakeObserver {
	observe() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function renderMeter(categories = CATEGORIES) {
	const {container} = render(
		<StackedMeterGroup categories={categories} size="lg" formatValue={String}>
			<StackedMeter values={{a: 30, b: 10}} total={100} readout label="Storage" />
		</StackedMeterGroup>,
	);
	const root = container.querySelector<HTMLElement>('[data-cds="StackedMeter"]');
	if (root === null) throw new Error("no meter");
	return root;
}

async function card(): Promise<HTMLElement> {
	return screen.findByText((_, element) => element?.getAttribute("popover") === "manual");
}

function cardRows(popover: HTMLElement): string[][] {
	const grid = popover.lastElementChild!;
	const cells = [...grid.children];
	return Array.from({length: cells.length / 4}, (_, i) =>
		cells.slice(i * 4, i * 4 + 4).map((cell) => cell.textContent),
	);
}

describe("StackedMeter lg readout", () => {
	it("shows the rows on pointer move and emphasizes the pointed block", async () => {
		const root = renderMeter();
		const blocks = [...root.querySelectorAll<HTMLElement>("[data-category]")];
		blocks.forEach((block, i) => {
			vi.spyOn(block, "getBoundingClientRect").mockReturnValue(new DOMRect(i * 100, 0, 100, 28));
		});
		fireEvent.pointerMove(root, {clientX: 150});
		const popover = await card();
		expect({
			hidden: popover.getAttribute("aria-hidden"),
			heading: popover.firstElementChild?.textContent,
			rows: cardRows(popover),
			emphasized: [...popover.querySelectorAll("[data-emphasized]")].map((label) => label.textContent),
			className: popover.className,
		}).toStrictEqual({
			hidden: "true",
			heading: "Storage",
			rows: [
				["", "30", "30%", "Alpha"],
				["", "10", "10%", "Beta"],
			],
			emphasized: ["Beta"],
			className:
				"pointer-events-none absolute left-0 top-0 z-10 m-0 block w-max overflow-visible rounded border bg-surface-popover px-sm py-xs font-normal shadow-popover [inset:0_auto_auto_0]",
		});
	});

	it("hides on Escape and stays hidden on further moves until the pointer leaves", async () => {
		const root = renderMeter();
		fireEvent.pointerMove(root, {clientX: 10});
		await card();
		fireEvent.keyDown(document, {key: "Escape"});
		fireEvent.pointerMove(root, {clientX: 20});
		const dismissed = document.querySelector("[popover]");
		fireEvent.pointerLeave(root);
		fireEvent.pointerMove(root, {clientX: 30});
		expect({dismissed, back: (await card()).getAttribute("popover")}).toStrictEqual({
			dismissed: null,
			back: "manual",
		});
	});

	it("opens centred with no emphasized row on keyboard focus", async () => {
		const root = renderMeter();
		vi.spyOn(root, "matches").mockImplementation((selector) => selector === ":focus-visible");
		fireEvent.focus(root);
		const popover = await card();
		expect(popover.querySelectorAll("[data-emphasized]").length).toBe(0);
	});

	it("keeps a long label's last 8 characters in an unclipped tail", async () => {
		const label = `${"x".repeat(32)}tail1234`;
		const root = renderMeter([{id: "a", label}, CATEGORIES[1]!]);
		fireEvent.pointerMove(root, {clientX: 10});
		const popover = await card();
		const first = popover.lastElementChild?.children[3];
		expect([...(first?.children ?? [])].map((part) => [part.className, part.textContent])).toStrictEqual([
			["truncate", "x".repeat(32)],
			["shrink-0", "tail1234"],
		]);
	});

	it("has no tooltips at lg", async () => {
		const root = renderMeter();
		fireEvent.focus(root);
		await act(async () => {});
		expect(screen.queryAllByRole("tooltip")).toStrictEqual([]);
	});
});
