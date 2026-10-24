// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords(): ResizeObserverEntry[] {
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(cleanup);

const MEDIA_SLOT_CLASS = "order-last ms-auto inline-flex h-[1lh] shrink-0 items-center overflow-visible";

/** A Bash call and a Read of a PNG in one assistant turn, the Read returning an image block. */
function groupRecords(): unknown[] {
	return [
		{
			type: "assistant",
			uuid: "a1",
			message: {
				role: "assistant",
				content: [
					{type: "tool_use", id: "t1", name: "Bash", input: {command: "ls", description: "List files"}},
					{type: "tool_use", id: "t2", name: "Read", input: {file_path: "/repo/shots/input-debug.png"}},
				],
			},
		},
		{
			type: "user",
			uuid: "r1",
			parentUuid: "a1",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "t1", content: "a.txt"}]},
		},
		{
			type: "user",
			uuid: "r2",
			parentUuid: "r1",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t2",
						content: [{type: "image", source: {type: "base64", media_type: "image/png", data: "AAA"}}],
					},
				],
			},
		},
	];
}

function renderTranscript(records: unknown[], {turnInProgress = false} = {}): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking
			shouldScrollToEnd={false}
			turnInProgress={turnInProgress}
		/>,
	).container;
}

interface MediaSlot {
	className: string;
	title: string | null;
	labels: (string | null)[];
	captions: (string | null)[];
	srcs: (string | null)[];
	loading: (string | null)[];
	inStepRow: boolean;
}

function mediaSlots(container: HTMLElement): MediaSlot[] {
	return [...container.querySelectorAll<HTMLElement>("[data-cds-row-media]")].map((slot) => ({
		className: slot.className,
		title: slot.getAttribute("title"),
		labels: [...slot.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
		captions: [...slot.querySelectorAll("button")].map((button) => {
			const id = button.getAttribute("aria-describedby");
			return id === null ? null : (slot.querySelector(`[id="${id}"]`)?.textContent ?? null);
		}),
		srcs: [...slot.querySelectorAll("img")].map((img) => img.getAttribute("src")),
		loading: [...slot.querySelectorAll("img")].map((img) => img.getAttribute("loading")),
		inStepRow: slot.closest("[data-tool-row]")?.hasAttribute("data-turn-status") === false,
	}));
}

function groupToggle(container: HTMLElement): HTMLElement {
	const toggle = container.querySelector<HTMLElement>("[data-turn-status] button[aria-expanded]");
	if (toggle === null) throw new Error("no group toggle");
	return toggle;
}

function readStepToggle(container: HTMLElement): HTMLElement {
	const toggle = [...container.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]')].find((element) =>
		element.textContent.includes("input-debug.png"),
	);
	if (toggle === undefined) throw new Error("no Read step toggle");
	return toggle;
}

describe("tool-row screenshot media slots", () => {
	it("draws the collapsed group's strip in a trailing media slot beside the toggle", () => {
		const container = renderTranscript(groupRecords());

		expect(mediaSlots(container)).toStrictEqual([
			{
				className: MEDIA_SLOT_CLASS,
				title: "",
				labels: ["Screenshot"],
				captions: ["Read input-debug.png"],
				srcs: ["data:image/png;base64,AAA"],
				loading: [null],
				inStepRow: false,
			},
		]);
		const slot = container.querySelector("[data-cds-row-media]");
		expect(slot?.closest("button")).toBeNull();
		expect(slot?.previousElementSibling).toBe(groupToggle(container));
	});

	it("does not toggle the group when its thumbnail is clicked", () => {
		const container = renderTranscript(groupRecords());

		const thumb = container.querySelector<HTMLElement>('[data-cds-row-media] button[aria-label="Screenshot"]');
		if (thumb === null) throw new Error("no thumbnail");
		fireEvent.click(thumb);

		expect(groupToggle(container).getAttribute("aria-expanded")).toBe("false");
	});

	it("moves the strip to the Read step row when the group expands", () => {
		const container = renderTranscript(groupRecords());
		fireEvent.click(groupToggle(container));

		expect(mediaSlots(container)).toStrictEqual([
			{
				className: `${MEDIA_SLOT_CLASS} empty:hidden`,
				title: "",
				labels: ["Screenshot"],
				captions: ["Read input-debug.png"],
				srcs: ["data:image/png;base64,AAA"],
				loading: ["lazy"],
				inStepRow: true,
			},
		]);
		expect(readStepToggle(container).querySelector("[data-cds-row-media]")).not.toBeNull();
	});

	it("drops the step's strip while that step is expanded", () => {
		const container = renderTranscript(groupRecords());
		fireEvent.click(groupToggle(container));
		fireEvent.click(readStepToggle(container));

		expect(readStepToggle(container).getAttribute("aria-expanded")).toBe("true");
		expect(mediaSlots(container)).toStrictEqual([]);
	});

	it("keeps the step collapsed when its thumbnail is activated by click or Enter", () => {
		const container = renderTranscript(groupRecords());
		fireEvent.click(groupToggle(container));

		const thumb = readStepToggle(container).querySelector<HTMLElement>('button[aria-label="Screenshot"]');
		if (thumb === null) throw new Error("no step thumbnail");
		fireEvent.click(thumb);
		fireEvent.keyDown(thumb, {key: "Enter"});

		expect(readStepToggle(container).getAttribute("aria-expanded")).toBe("false");
	});

	it("shows an expanded step's screenshots in its body as 'View screenshot' buttons", () => {
		const container = renderTranscript(groupRecords());
		fireEvent.click(groupToggle(container));
		fireEvent.click(readStepToggle(container));

		expect(stepScreenshots(container)).toStrictEqual([
			{
				className: SCREENSHOTS_CLASS,
				inBody: true,
				buttons: [
					{
						label: "View screenshot",
						className: VIEW_BUTTON_CLASS,
						imgClass: VIEW_IMG_CLASS,
						alt: "",
						src: "data:image/png;base64,AAA",
					},
				],
			},
		]);
	});

	it("draws a lone row's screenshots in a card after the row, without top padding", () => {
		const container = renderTranscript(loneRecords());

		expect(mediaSlots(container)).toStrictEqual([]);
		expect(stepScreenshots(container)).toStrictEqual([
			{
				className: "flex flex-col items-start gap-1",
				inBody: false,
				buttons: [
					{
						label: "View screenshot",
						className: VIEW_BUTTON_CLASS,
						imgClass: VIEW_IMG_CLASS,
						alt: "",
						src: "data:image/png;base64,AAA",
					},
				],
			},
		]);
	});

	it("keeps a live turn's last lone row's screenshots in the row instead of a card", () => {
		const container = renderTranscript(loneRecords(), {turnInProgress: true});

		expect(mediaSlots(container)).toStrictEqual([
			{
				className: `${MEDIA_SLOT_CLASS} empty:hidden`,
				title: "",
				labels: ["Screenshot"],
				captions: ["Read input-debug.png"],
				srcs: ["data:image/png;base64,AAA"],
				loading: [null],
				inStepRow: false,
			},
		]);
		expect(stepScreenshots(container)).toStrictEqual([]);
	});

	it("shows a held lone row's screenshots in its expanded body", () => {
		const container = renderTranscript(loneRecords(), {turnInProgress: true});
		fireEvent.click(readStepToggle(container));

		expect(mediaSlots(container)).toStrictEqual([]);
		expect(stepScreenshots(container).map(({className, inBody}) => ({className, inBody}))).toStrictEqual([
			{className: SCREENSHOTS_CLASS, inBody: true},
		]);
	});

	it("hoists a live turn's lone row's screenshots once the turn moves on to prose", () => {
		const records = [
			...loneRecords(),
			{
				type: "assistant",
				uuid: "a2",
				parentUuid: "r2",
				message: {role: "assistant", content: [{type: "text", text: "Here is the screenshot."}]},
			},
		];
		const container = renderTranscript(records, {turnInProgress: true});

		expect(mediaSlots(container)).toStrictEqual([]);
		expect(stepScreenshots(container).map(({className, inBody}) => ({className, inBody}))).toStrictEqual([
			{className: "flex flex-col items-start gap-1", inBody: false},
		]);
	});

	it("keeps a lone row's card out of its expanded body", () => {
		const container = renderTranscript(loneRecords());
		fireEvent.click(readStepToggle(container));

		expect(readStepToggle(container).getAttribute("aria-expanded")).toBe("true");
		expect(stepScreenshots(container).map((card) => card.inBody)).toStrictEqual([false]);
	});
});

const SCREENSHOTS_CLASS = "flex flex-col items-start gap-1 pt-p8";
const VIEW_BUTTON_CLASS =
	"max-w-full cursor-zoom-in focus-visible:outline-hidden hide-focus-ring focus-visible:ring-focus rounded-sm";
const VIEW_IMG_CLASS = "max-w-full max-h-[360px] w-auto rounded-r4 border";

/** One Read of a PNG alone in its turn, which draws as a lone row. */
function loneRecords(): unknown[] {
	const [assistant, , imageResult] = groupRecords() as [Record<string, unknown>, unknown, Record<string, unknown>];
	return [
		{
			...assistant,
			message: {
				role: "assistant",
				content: [
					{type: "tool_use", id: "t2", name: "Read", input: {file_path: "/repo/shots/input-debug.png"}},
				],
			},
		},
		{...imageResult, parentUuid: "a1"},
	];
}

interface StepScreenshotsCard {
	className: string;
	inBody: boolean;
	buttons: {
		label: string | null;
		className: string;
		imgClass: string | undefined;
		alt: string | null | undefined;
		src: string | null | undefined;
	}[];
}

function stepScreenshots(container: HTMLElement): StepScreenshotsCard[] {
	return [...container.querySelectorAll<HTMLElement>("[data-step-screenshots]")].map((card) => ({
		className: card.className,
		// A lone row's card follows the row; a step's sits inside its row's body.
		inBody: card.closest("[data-tool-row]") !== null,
		buttons: [...card.querySelectorAll("button")].map((button) => {
			const img = button.querySelector("img");
			return {
				label: button.getAttribute("aria-label"),
				className: button.className,
				imgClass: img?.className,
				alt: img?.getAttribute("alt"),
				src: img?.getAttribute("src"),
			};
		}),
	}));
}
