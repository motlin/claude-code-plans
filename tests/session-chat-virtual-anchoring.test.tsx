// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import type {SessionLine} from "../src/lib/sessions";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));

const lines: SessionLine[] = Array.from({length: 120}, (_, index) => ({
	type: index % 2 === 0 ? "user" : "assistant",
	uuid: `example-message-${index}`,
	lineIndex: index,
	message: {role: index % 2 === 0 ? "user" : "assistant", content: `Fabricated message ${index}`},
}));

// Browser geometry: every row is far shorter than the virtualizer's 320px estimate.
const ROW_HEIGHT = 60;
const VIEWPORT_HEIGHT = 600;
let scrollPosition = 0;
const nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;

/** A long prompt paints at its full height until TruncatedContent's clamp lands in a follow-up render. */
const LONG_PROMPT = "Fabricated long prompt";
const LONG_PROMPT_FULL_HEIGHT = 1266;
const LONG_PROMPT_CLAMPED_HEIGHT = 326;
function rowHeight(row: HTMLElement): number {
	if (!row.textContent?.includes(LONG_PROMPT)) return ROW_HEIGHT;
	return row.querySelector(".max-h-\\[16rem\\]") ? LONG_PROMPT_CLAMPED_HEIGHT : LONG_PROMPT_FULL_HEIGHT;
}

interface Layout {
	rows: HTMLElement[];
	/** Each mounted row's height and top within the transcript's content. */
	boxes: Map<HTMLElement, {top: number; height: number}>;
	height: number;
}
let transcript: HTMLElement | null = null;
/**
 * Lay the transcript out in one walk over its children. The mocked geometry runs for every
 * getBoundingClientRect, so a document-wide selector per call made the file slow enough
 * to hit the test timeout when the full suite loads the machine.
 */
function layout(): Layout {
	if (!transcript?.isConnected) {
		transcript = document.querySelector<HTMLElement>("[data-testid=virtualized-transcript]");
	}
	const rows: HTMLElement[] = [];
	const boxes = new Map<HTMLElement, {top: number; height: number}>();
	let height = 0;
	for (const child of transcript?.children ?? []) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.dataset["transcriptSpacer"] !== undefined) {
			height += Number.parseFloat(child.style.height || "0");
		} else if (child.dataset["transcriptEntryIndex"] !== undefined) {
			const box = {top: height, height: rowHeight(child)};
			rows.push(child);
			boxes.set(child, box);
			height += box.height;
		}
	}
	return {rows, boxes, height};
}
function mountedRows(): HTMLElement[] {
	return layout().rows;
}
function contentHeight(): number {
	return layout().height;
}
function clampedPosition(height = contentHeight()): number {
	return Math.min(scrollPosition, Math.max(0, height - VIEWPORT_HEIGHT));
}
/** A mounted row's viewport top and height. */
function rowBox(row: HTMLElement, current = layout()): {top: number; height: number} {
	const box = current.boxes.get(row) ?? {top: 0, height: rowHeight(row)};
	return {top: box.top - clampedPosition(current.height), height: box.height};
}
/** Rows the browser would paint inside the viewport, with their viewport boxes. */
function paintedBoxes(): Array<{row: HTMLElement; top: number; height: number}> {
	const current = layout();
	return current.rows
		.map((row) => ({row, ...rowBox(row, current)}))
		.filter(({top, height}) => top + height > 0 && top < VIEWPORT_HEIGHT);
}
function paintedRows(): Array<{entry: string; top: number}> {
	return paintedBoxes().map(({row, top}) => ({entry: row.dataset["transcriptEntryIndex"]!, top}));
}
/** Viewport pixels showing a spacer rather than a row. */
function blankPixels(): number {
	const painted = paintedBoxes().map(({top, height}) => Math.min(VIEWPORT_HEIGHT, top + height) - Math.max(0, top));
	return VIEWPORT_HEIGHT - painted.reduce((sum, height) => sum + height, 0);
}

class ControlledResizeObserver {
	static active = new Set<ControlledResizeObserver>();
	readonly elements = new Set<Element>();
	constructor(readonly callback: ResizeObserverCallback) {
		ControlledResizeObserver.active.add(this);
	}
	observe(element: Element) {
		this.elements.add(element);
	}
	unobserve(element: Element) {
		this.elements.delete(element);
	}
	disconnect() {
		ControlledResizeObserver.active.delete(this);
	}
}

async function deliverMeasurements() {
	await act(async () => {
		for (const observer of ControlledResizeObserver.active) {
			const observations = [...observer.elements]
				.filter((element) => element.isConnected)
				.map((target) => ({
					target,
					contentRect: target.getBoundingClientRect(),
					borderBoxSize: [{blockSize: target.getBoundingClientRect().height, inlineSize: 800}],
					contentBoxSize: [],
					devicePixelContentBoxSize: [],
				}));
			observer.callback(observations, observer);
		}
	});
}

async function scrollTo(main: HTMLElement, top: number) {
	await act(async () => {
		main.scrollTop = top;
		fireEvent.scroll(main);
	});
}

async function settle(main: HTMLElement) {
	for (let batch = 0; batch < 30; batch++) {
		const before = JSON.stringify({top: main.scrollTop, rows: paintedRows(), height: contentHeight()});
		await deliverMeasurements();
		await act(async () => fireEvent.scroll(main));
		if (before === JSON.stringify({top: main.scrollTop, rows: paintedRows(), height: contentHeight()})) return;
	}
	throw new Error("Transcript geometry did not settle within 30 batches.");
}

function chat(windowLines: SessionLine[]) {
	return (
		<main style={{overflowY: "auto"}} data-testid="main">
			<SessionChat
				sessionId="example-virtual-anchoring"
				shouldScrollToEnd={false}
				lines={windowLines}
				toolResultMap={new Map()}
			/>
		</main>
	);
}

/** The painted rows, named by the message each draws rather than by its shifting window index. */
function paintedMessages(): Array<{message: string; top: number}> {
	return paintedBoxes().map(({row, top}) => ({
		message: /Fabricated (?:long prompt|message \d+)/.exec(row.textContent ?? "")![0],
		top,
	}));
}

async function mountChat(windowLines = lines): Promise<HTMLElement> {
	render(chat(windowLines));
	const main = screen.getByTestId("main");
	Object.defineProperty(main, "clientHeight", {configurable: true, value: VIEWPORT_HEIGHT});
	Object.defineProperty(main, "scrollHeight", {configurable: true, get: contentHeight});
	await settle(main);
	return main;
}

beforeEach(() => {
	scrollPosition = 0;
	vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	Object.defineProperty(Element.prototype, "scrollTop", {
		configurable: true,
		get() {
			return clampedPosition();
		},
		set(value: number) {
			scrollPosition = Math.min(Math.max(0, value), Math.max(0, contentHeight() - VIEWPORT_HEIGHT));
		},
	});
	// TruncatedContent clamps a bubble whose content overflows its threshold.
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get(this: HTMLElement) {
			return this.textContent?.includes(LONG_PROMPT) ? LONG_PROMPT_FULL_HEIGHT : 0;
		},
	});
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		if (this.matches("main")) return new DOMRect(0, 0, 800, VIEWPORT_HEIGHT);
		if (this.matches("[data-testid=virtualized-transcript]")) {
			const {height} = layout();
			return new DOMRect(0, -clampedPosition(height), 800, height);
		}
		if (this instanceof HTMLElement && this.dataset["transcriptEntryIndex"] !== undefined) {
			const {top, height} = rowBox(this);
			return new DOMRect(0, top, 800, height);
		}
		return new DOMRect();
	});
});

afterEach(() => {
	cleanup();
	Object.defineProperty(Element.prototype, "scrollTop", nativeScrollTop);
	delete (HTMLElement.prototype as {scrollHeight?: number}).scrollHeight;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	ControlledResizeObserver.active.clear();
});

it("keeps the painted rows in place when scrolling up mounts a row shorter than its estimate", async () => {
	const main = await mountChat();
	await scrollTo(main, 3000);
	await settle(main);
	const [anchor] = paintedRows();

	// Mount the unmeasured row above the window; nothing has observed it yet.
	await scrollTo(main, main.scrollTop - 400);

	const row = mountedRows().find((candidate) => candidate.dataset["transcriptEntryIndex"] === anchor!.entry)!;
	expect({entry: anchor!.entry, top: rowBox(row).top}).toStrictEqual({entry: anchor!.entry, top: anchor!.top + 400});
});

it("covers the viewport in the scroll's own commit when the mounted rows are shorter than their estimates", async () => {
	const main = await mountChat();

	await scrollTo(main, 1500);

	expect({blank: blankPixels(), rows: paintedRows().length}).toStrictEqual({blank: 0, rows: 10});
});

it("commits the scrolled-to window inside the scroll event, before the browser paints it", async () => {
	const main = await mountChat();
	main.scrollTop = 3000;

	// Dispatched outside act: a render React merely schedules would land after this frame's paint.
	main.dispatchEvent(new Event("scroll"));

	expect({blank: blankPixels(), rows: paintedRows().length}).toStrictEqual({blank: 0, rows: 11});
	await act(async () => {});
});

it("keeps the reader's rows in place when an earlier page of records lands above them", async () => {
	const {rerender} = render(chat(lines.slice(60)));
	const main = screen.getByTestId("main");
	Object.defineProperty(main, "clientHeight", {configurable: true, value: VIEWPORT_HEIGHT});
	Object.defineProperty(main, "scrollHeight", {configurable: true, get: contentHeight});
	await settle(main);
	await scrollTo(main, 900);
	await settle(main);
	const before = paintedMessages();

	await act(async () => {
		rerender(chat(lines));
	});
	const landed = paintedMessages();
	await settle(main);

	expect({landed, measured: paintedMessages()}).toStrictEqual({landed: before, measured: before});
});

it("keeps the reader's rows in place across repeated earlier pages while scrolling up", async () => {
	const {rerender} = render(chat(lines.slice(80)));
	const main = screen.getByTestId("main");
	Object.defineProperty(main, "clientHeight", {configurable: true, value: VIEWPORT_HEIGHT});
	Object.defineProperty(main, "scrollHeight", {configurable: true, get: contentHeight});
	await settle(main);
	await scrollTo(main, 400);
	await settle(main);
	const moves: Array<{message: string; moved: number}> = [];
	for (const start of [60, 40, 20, 0]) {
		const [anchor] = paintedMessages();
		await scrollTo(main, main.scrollTop - 100);
		await act(async () => {
			rerender(chat(lines.slice(start)));
		});
		await settle(main);
		const now = paintedMessages().find((row) => row.message === anchor!.message);
		moves.push({message: anchor!.message, moved: now!.top - anchor!.top});
	}

	expect(moves.map(({moved}) => moved)).toStrictEqual([100, 100, 100, 100]);
});

it("lets the reader scroll up past a long prompt whose clamp lands after it mounts", async () => {
	const withLongPrompt = lines.map((line, index) =>
		index === 0 ? {...line, message: {role: "user", content: `${LONG_PROMPT}\n${"plan step\n".repeat(80)}`}} : line,
	);
	const main = await mountChat(withLongPrompt);
	await scrollTo(main, 1500);
	await settle(main);

	// Wheel up 400px at a time, one frame each, as the reader would.
	const pushedBack: Array<{asked: number; landed: number}> = [];
	for (let wheel = 0; wheel < 12 && main.scrollTop > 0 && pushedBack.length === 0; wheel++) {
		const asked = Math.max(0, main.scrollTop - 400);
		await scrollTo(main, asked);
		await settle(main);
		if (main.scrollTop > asked + 400) pushedBack.push({asked, landed: main.scrollTop});
	}

	expect({pushedBack, top: main.scrollTop, first: paintedMessages()[0]?.message}).toStrictEqual({
		pushedBack: [],
		top: 0,
		first: LONG_PROMPT,
	});
});
