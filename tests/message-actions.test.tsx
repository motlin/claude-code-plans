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
	return Array.from(bar(container).querySelectorAll("button, time")).map((element) =>
		element.tagName === "TIME" ? "time" : (element.getAttribute("aria-label") ?? ""),
	);
}

function bar(container: HTMLElement): HTMLElement {
	return container.querySelector<HTMLElement>("[data-message-actions]")!;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
	return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

function showActions(container: HTMLElement): HTMLButtonElement {
	return Array.from(container.querySelectorAll("button")).find(
		(element) => element.textContent === "Show message actions",
	)!;
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

	it("gives Rewind and Fork a label plus a muted description line on hover", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		);

		function hoverTooltip(label: string): string[] {
			fireEvent.pointerEnter(button(container, label).parentElement!);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = container.querySelector('[role="tooltip"]')!;
			const lines = Array.from(tooltip.children).map((line) => line.textContent ?? "");
			fireEvent.pointerLeave(button(container, label).parentElement!);
			return lines;
		}

		expect({
			rewind: hoverTooltip("Rewind to here"),
			fork: hoverTooltip("Fork from here"),
		}).toStrictEqual({
			rewind: ["Rewind to here", "Removes this message and what follows"],
			fork: ["Fork from here", "Starts a new session, keeps this one"],
		});
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

describe("message action toolbar sizing and reveal", () => {
	it("wraps Copy in a Copy tooltip instead of a native title", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const copy = button(container, "Copy");
		fireEvent.pointerEnter(copy.parentElement!);
		act(() => {
			vi.advanceTimersByTime(300);
		});

		expect({
			title: copy.getAttribute("title"),
			tooltip: copy.parentElement!.querySelector('[role="tooltip"]')?.textContent ?? null,
		}).toStrictEqual({title: null, tooltip: "Copy"});
	});

	it("sizes buttons 24px with radius 6 and 16px icons, and the time 13px/19px with 8px inner padding", () => {
		const assistant = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		).container;
		const copy = button(assistant, "Copy");
		const assistantTime = assistant.querySelector("time")!.className.split(" ");
		cleanup();
		const user = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		).container;
		const userTime = user.querySelector("time")!.className.split(" ");

		expect({
			button: ["size-6", "rounded-r5"].every((c) => copy.className.split(" ").includes(c)),
			icon: copy.querySelector("svg")!.getAttribute("class")!.split(" ").includes("size-4"),
			assistantTime: ["text-[13px]/[19px]", "text-ink-muted", "pl-2"].every((c) => assistantTime.includes(c)),
			userTime: ["text-[13px]/[19px]", "text-ink-muted", "pr-2"].every((c) => userTime.includes(c)),
		}).toStrictEqual({button: true, icon: true, assistantTime: true, userTime: true});
	});

	it("fades and scales the bar in after a short delay, only when motion is allowed", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const classes = bar(container).className.split(" ");

		expect(
			[
				"scale-[.98]",
				"group-hover/msg:scale-100",
				"motion-safe:transition-[opacity,scale]",
				"motion-safe:duration-[120ms]",
				"motion-safe:delay-100",
				"motion-safe:ease-[cubic-bezier(.32,.72,0,1)]",
			].filter((c) => !classes.includes(c)),
		).toStrictEqual([]);
	});

	it("keeps hidden toolbar controls out of the tab order until Show message actions reveals them", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const tabIndexes = () =>
			Array.from(bar(container).querySelectorAll<HTMLElement>("button, time")).map((element) => element.tabIndex);
		const hidden = tabIndexes();
		const show = showActions(container);
		const showIsSrOnly = show.className.split(" ").includes("sr-only");
		fireEvent.click(show);

		expect({
			hidden,
			showIsSrOnly,
			revealed: tabIndexes(),
			barRevealed: bar(container).hasAttribute("data-revealed"),
			focused: document.activeElement?.getAttribute("aria-label") ?? null,
		}).toStrictEqual({
			hidden: [-1, -1, -1, -1, -1],
			showIsSrOnly: true,
			revealed: [0, 0, 0, 0, 0],
			barRevealed: true,
			focused: "Copy",
		});
	});

	it("hides the toolbar again once focus leaves it", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		fireEvent.click(showActions(container));
		fireEvent.blur(button(container, "Copy"), {relatedTarget: document.body});

		expect({
			revealed: bar(container).hasAttribute("data-revealed"),
			copyTabIndex: button(container, "Copy").tabIndex,
		}).toStrictEqual({revealed: false, copyTabIndex: -1});
	});

	it("announces a copy in an sr-only status region instead of a visible bubble", async () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const status = () => container.querySelector('[role="status"]');
		const before = status()?.textContent ?? null;
		await act(async () => {
			fireEvent.click(button(container, "Copy"));
		});

		expect({
			before,
			after: status()?.textContent ?? null,
			srOnly: status()?.className.split(" ").includes("sr-only") ?? false,
		}).toStrictEqual({before: "", after: "Copied", srOnly: true});
	});
});
