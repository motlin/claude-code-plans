// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AssistantMessageActions, UserMessageActions} from "../src/components/message-actions";
import {type TranscriptActions, TranscriptActionsContext} from "../src/components/transcript-context-menu";
import {writeClipboardText} from "../src/lib/clipboard";

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn(async () => true),
}));

const MESSAGE = {sessionId: "session-alice", uuid: "message-1"};
const TIMESTAMP = "2026-09-30T08:00:00.000Z";

beforeEach(() => {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
	vi.setSystemTime(new Date("2026-09-30T18:00:00.000Z"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function withActions(actions: TranscriptActions, children: ReactNode) {
	return <TranscriptActionsContext.Provider value={actions}>{children}</TranscriptActionsContext.Provider>;
}

/** The bar's controls in document order: each button's aria-label, and the `<time>` as "time". */
function controlOrder(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("button, time")).map((element) =>
		element.tagName === "TIME" ? "time" : (element.getAttribute("aria-label") ?? ""),
	);
}

function bar(container: HTMLElement): HTMLElement {
	return container.querySelector<HTMLElement>("[data-message-actions]")!;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
	return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

function tooltipText(container: HTMLElement): string | null {
	fireEvent.focus(container.querySelector("time")!);
	act(() => {
		vi.advanceTimersByTime(300);
	});
	return container.querySelector('[role="tooltip"]')?.textContent ?? null;
}

describe("AssistantMessageActions", () => {
	it("lists Copy, Fork from here, Pin as chapter and Read aloud, then the time, left-aligned", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);

		expect({
			order: controlOrder(container),
			justify: bar(container).className.includes("justify-end"),
			time: container.querySelector("time")?.getAttribute("dateTime"),
		}).toStrictEqual({
			order: ["Copy", "Fork from here", "Pin as chapter", "Read aloud", "time"],
			justify: false,
			time: TIMESTAMP,
		});
	});

	it("shows on hover and focus-within with muted buttons that turn primary on hover", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const classes = bar(container).className.split(" ");
		const copyClasses = button(container, "Copy").className.split(" ");

		expect({
			bar: ["opacity-0", "group-hover/msg:opacity-100", "focus-within:opacity-100"].every((c) =>
				classes.includes(c),
			),
			button: ["text-ink-muted", "hover:text-primary"].every((c) => copyClasses.includes(c)),
		}).toStrictEqual({bar: true, button: true});
	});

	it("keeps token, model and effort stats out of the visible text and in the time tooltip", () => {
		const {container} = render(
			<AssistantMessageActions
				message={MESSAGE}
				text="Hello"
				timestamp={TIMESTAMP}
				details={["595.8k in / 595 out", "high effort", "advisor Fable 5.1"]}
			/>,
		);

		const visible = bar(container).textContent;
		const tooltip = tooltipText(container);

		expect({
			visibleHasStats: /595|effort|advisor/.test(visible ?? ""),
			tooltipHasStats: ["595.8k in / 595 out", "high effort", "advisor Fable 5.1"].every((part) =>
				(tooltip ?? "").includes(part),
			),
		}).toStrictEqual({visibleHasStats: false, tooltipHasStats: true});
	});

	it("disables Fork and Pin until the transcript provides them, then hands them the message", () => {
		const forkFrom = vi.fn();
		const pinChapter = vi.fn();
		const disabled = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		).container;
		const disabledState = [
			button(disabled, "Fork from here").disabled,
			button(disabled, "Pin as chapter").disabled,
		];
		cleanup();

		const {container} = render(
			withActions(
				{forkFrom, pinChapter},
				<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		fireEvent.click(button(container, "Fork from here"));
		fireEvent.click(button(container, "Pin as chapter"));

		expect({
			disabledState,
			forkFrom: forkFrom.mock.calls,
			pinChapter: pinChapter.mock.calls,
		}).toStrictEqual({
			disabledState: [true, true],
			forkFrom: [[MESSAGE]],
			pinChapter: [[MESSAGE]],
		});
	});

	it("copies the message text", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello **world**" timestamp={TIMESTAMP} details={[]} />,
		);
		fireEvent.click(button(container, "Copy"));

		expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([["Hello **world**"]]);
	});

	it("reads the message aloud as plain text, and stops when pressed again", () => {
		const speak = vi.fn();
		const cancel = vi.fn();
		const speechState = {speaking: false};
		vi.stubGlobal("speechSynthesis", {
			speak: (utterance: {text: string}) => {
				speechState.speaking = true;
				speak(utterance.text);
			},
			cancel,
			get speaking() {
				return speechState.speaking;
			},
		});
		vi.stubGlobal(
			"SpeechSynthesisUtterance",
			class {
				text: string;
				onend: (() => void) | null = null;
				constructor(text: string) {
					this.text = text;
				}
			},
		);
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello **world**" timestamp={TIMESTAMP} details={[]} />,
		);

		fireEvent.click(button(container, "Read aloud"));
		const pressedWhileSpeaking = button(container, "Read aloud").getAttribute("aria-pressed");
		fireEvent.click(button(container, "Read aloud"));

		expect({
			spoken: speak.mock.calls,
			pressedWhileSpeaking,
			cancelled: cancel.mock.calls.length > 0,
			pressedAfter: button(container, "Read aloud").getAttribute("aria-pressed"),
		}).toStrictEqual({
			spoken: [["Hello world"]],
			pressedWhileSpeaking: "true",
			cancelled: true,
			pressedAfter: "false",
		});
	});
});

describe("UserMessageActions", () => {
	it("puts the time first, then Copy, Rewind to here and Fork from here, right-aligned", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		);

		expect({
			order: controlOrder(container),
			justify: bar(container).className.includes("justify-end"),
		}).toStrictEqual({
			order: ["time", "Copy", "Rewind to here", "Fork from here"],
			justify: true,
		});
	});

	it("moves the origin caption into the time tooltip", () => {
		const {container} = render(
			<UserMessageActions
				message={MESSAGE}
				text="Hi"
				timestamp={TIMESTAMP}
				details={["Scheduled task ecc5631f · queued for later"]}
			/>,
		);

		const visible = bar(container).textContent;
		const tooltip = tooltipText(container);

		expect({
			visibleHasCaption: (visible ?? "").includes("Scheduled task"),
			tooltipHasCaption: (tooltip ?? "").includes("Scheduled task ecc5631f · queued for later"),
		}).toStrictEqual({visibleHasCaption: false, tooltipHasCaption: true});
	});

	it("hands Rewind and Fork the message", () => {
		const rewindTo = vi.fn();
		const forkFrom = vi.fn();
		const {container} = render(
			withActions(
				{rewindTo, forkFrom},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		fireEvent.click(button(container, "Rewind to here"));
		fireEvent.click(button(container, "Fork from here"));

		expect({rewindTo: rewindTo.mock.calls, forkFrom: forkFrom.mock.calls}).toStrictEqual({
			rewindTo: [[MESSAGE]],
			forkFrom: [[MESSAGE]],
		});
	});
});
