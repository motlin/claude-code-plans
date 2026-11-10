// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {renderToString} from "react-dom/server";
import {actAndSettle} from "./act-and-settle";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AssistantMessageActions, UserMessageActions, WaitingMessageActions} from "../src/components/message-actions";
import {type TranscriptActions, TranscriptActionsContext} from "../src/components/transcript-actions-context";
import {toggleUserChapterAt} from "../src/lib/chapter-store";
import {writeClipboardText} from "../src/lib/clipboard";
import {PanelsOff} from "./fizzy-lake-off";

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn<typeof import("../src/lib/clipboard").writeClipboardText>(async () =>
		Promise.resolve(true),
	),
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
	return container.querySelector<HTMLButtonElement>('button[aria-label^="Show message actions for "]')!;
}

function tooltipText(container: HTMLElement): string | null {
	fireEvent.pointerEnter(container.querySelector("time")!.parentElement!);
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
			button: ["text-plain-secondary", "text-ink-muted", "hover:text-primary"].map((c) =>
				copyClasses.includes(c),
			),
			barHover: classes.includes("[&_button:hover:not([aria-pressed=true]):not(:disabled)]:text-primary"),
		}).toStrictEqual({bar: true, button: [true, false, false], barHover: true});
	});

	it("grows to upstream's comfortable 32px buttons, 20px icons and 32px time slot under a comfortable scope (coarse pointer)", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const comfortable = (element: Element | null | undefined) =>
			(element?.getAttribute("class") ?? "").split(" ").filter((name) => name.startsWith("comfortable:"));

		expect({
			bar: comfortable(bar(container)),
			button: comfortable(button(container, "Copy")),
			icon: comfortable(button(container, "Copy").querySelector("svg")),
			time: comfortable(container.querySelector("time")),
		}).toStrictEqual({
			bar: ["comfortable:h-8"],
			button: ["comfortable:size-8", "comfortable:rounded-r6"],
			icon: ["comfortable:size-5"],
			// Panels' ms-1 already brings the time to upstream's 12px, so no comfortable ps-3 on top.
			time: ["comfortable:h-8", "comfortable:text-[14px]/[20px]"],
		});
	});

	it("paints a pinned Pin as chapter with upstream's pressed accent ink and fill", () => {
		toggleUserChapterAt(MESSAGE.sessionId, MESSAGE.uuid, "Hello", 0);
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const pin = button(container, "Pin as chapter");
		const classes = pin.className.split(" ");
		toggleUserChapterAt(MESSAGE.sessionId, MESSAGE.uuid, "Hello", 0);

		expect({
			pressed: pin.getAttribute("aria-pressed"),
			ink: classes.includes("aria-pressed:text-upstream-accent"),
			fill: classes.includes("aria-pressed:bg-upstream-accent-pressed"),
			focusRing: ["focus-visible:shadow-focus", "focus-visible:bg-fill-ghost-hover"].map((c) =>
				classes.includes(c),
			),
		}).toStrictEqual({pressed: "true", ink: true, fill: true, focusRing: [true, false]});
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
			visibleHasStats: /595|effort|advisor/.test(visible),
			tooltipHasStats: ["595.8k in / 595 out", "high effort", "advisor Fable 5.1"].every((part) =>
				(tooltip ?? "").includes(part),
			),
		}).toStrictEqual({visibleHasStats: false, tooltipHasStats: true});
	});

	it("disables Fork and Pin until the transcript provides them, then hands them the message", () => {
		const forkFrom = vi.fn<NonNullable<TranscriptActions["forkFrom"]>>();
		const pinChapter = vi.fn<NonNullable<TranscriptActions["pinChapter"]>>();
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

	it("copies the trimmed text", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text={"  hi \n"} timestamp={TIMESTAMP} details={[]} />,
		);
		fireEvent.click(button(container, "Copy"));

		expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([["hi"]]);
	});

	it("copies the turn's rendered HTML alongside the text when the footer can read it", () => {
		const {container} = render(
			<AssistantMessageActions
				message={MESSAGE}
				text="Hello **world**"
				getHtml={() => "<p>Hello <strong>world</strong></p>"}
				timestamp={TIMESTAMP}
				details={[]}
			/>,
		);
		fireEvent.click(button(container, "Copy"));

		expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([
			["Hello **world**", "<p>Hello <strong>world</strong></p>"],
		]);
	});

	it("shows the copied check for upstream's 2000ms", async () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const checked = () => button(container, "Copy").querySelector(".lucide-check") !== null;
		await actAndSettle(() => {
			fireEvent.click(button(container, "Copy"));
		});
		const atStart = checked();
		act(() => {
			vi.advanceTimersByTime(1999);
		});
		const at1999 = checked();
		act(() => {
			vi.advanceTimersByTime(2);
		});

		expect({atStart, at1999, at2001: checked()}).toStrictEqual({atStart: true, at1999: true, at2001: false});
	});

	it("disables Copy with upstream's reason when the turn has no text", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text={" \n"} timestamp={TIMESTAMP} details={[]} />,
		);
		const copy = button(container, "Copy: This message has no text to copy.");

		expect({
			disabled: copy.disabled,
			reason: copy.closest("[data-cds-disabled-reason-wrapper]")?.querySelector("[data-cds-disabled-reason]")
				?.textContent,
		}).toStrictEqual({disabled: true, reason: "This message has no text to copy."});
	});

	it("reads the message aloud as plain text, loading until speech starts, then pausing and resuming on later presses", () => {
		const speech = stubSpeech();
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello **world**" timestamp={TIMESTAMP} details={[]} />,
		);
		const states = [readAloudState(container)];
		const press = () => {
			fireEvent.click(bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!);
			states.push(readAloudState(container));
		};

		press();
		act(() => speech.start());
		states.push(readAloudState(container));
		press();
		press();
		act(() => {
			speech.finish();
		});
		states.push(readAloudState(container));

		expect({spoken: speech.spoken, calls: speech.calls, states}).toStrictEqual({
			spoken: ["Hello world"],
			calls: ["cancel", "speak", "pause", "resume"],
			states: [
				{label: "Read aloud", icon: "speaker", pressed: null},
				{label: "Loading\u2026", icon: "spinner", pressed: null},
				{label: "Pause", icon: "pause", pressed: null},
				{label: "Resume", icon: "speaker", pressed: null},
				{label: "Pause", icon: "pause", pressed: null},
				{label: "Read aloud", icon: "speaker", pressed: null},
			],
		});
	});
	it("speaks with the best installed voice for the document language", () => {
		document.documentElement.lang = "en-US";
		const speech = stubSpeech([SAMANTHA, ZOE_PREMIUM]);
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);

		fireEvent.click(bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!);

		expect(speech.voices).toStrictEqual(["Zoe (Premium) en-US"]);
	});

	it("waits for the voice list when the engine has not loaded it yet", () => {
		document.documentElement.lang = "en-US";
		const speech = stubSpeech([]);
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);

		fireEvent.click(bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!);
		const whileWaiting = {voices: [...speech.voices], state: readAloudState(container)};
		act(() => {
			speech.loadVoices([SAMANTHA, ZOE_PREMIUM]);
		});

		expect({whileWaiting, voices: speech.voices}).toStrictEqual({
			whileWaiting: {voices: [], state: {label: "Loading\u2026", icon: "spinner", pressed: null}},
			voices: ["Zoe (Premium) en-US"],
		});
	});

	it("speaks with the engine default after a short wait when no voice list ever arrives", () => {
		const speech = stubSpeech([]);
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);

		fireEvent.click(bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!);
		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(speech.voices).toStrictEqual([null]);
	});

	it("speaks the whole message as one utterance, code and links included", () => {
		const speech = stubSpeech();
		const {container} = render(
			<AssistantMessageActions
				message={MESSAGE}
				text={"Hello there. See `src/a.ts`:\n\n```ts\nconst a = 1;\n```"}
				timestamp={TIMESTAMP}
				details={[]}
			/>,
		);

		fireEvent.click(bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!);

		expect(speech.spoken).toStrictEqual(["Hello there. See src/a.ts:\n\n (code block)"]);
	});

	it("stops when pressed again before speech starts", () => {
		const speech = stubSpeech();
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const control = () => bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!;

		fireEvent.click(control());
		fireEvent.click(control());

		expect({calls: speech.calls, state: readAloudState(container)}).toStrictEqual({
			calls: ["cancel", "speak", "cancel"],
			state: {label: "Read aloud", icon: "speaker", pressed: null},
		});
	});
});

interface StubVoice {
	name: string;
	lang: string;
	voiceURI: string;
	localService: boolean;
	default: boolean;
}

interface StubUtterance {
	text: string;
	voice: StubVoice | null;
	lang: string;
	onstart: (() => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
}

const SAMANTHA: StubVoice = {
	name: "Samantha",
	lang: "en-US",
	voiceURI: "com.apple.voice.compact.en-US.Samantha",
	localService: true,
	default: true,
};
const ZOE_PREMIUM: StubVoice = {
	name: "Zoe (Premium)",
	lang: "en-US",
	voiceURI: "com.apple.voice.premium.en-US.Zoe",
	localService: true,
	default: false,
};

/**
 * A fake speech service recording what it was asked to do; `finish` ends every queued utterance in order, and
 * `loadVoices` installs voices and fires `voiceschanged`, as Chrome does once its list arrives.
 */
function stubSpeech(initialVoices: StubVoice[] = [SAMANTHA]) {
	const queue: StubUtterance[] = [];
	const record = {spoken: [] as string[], calls: [] as string[], voices: [] as (string | null)[]};
	let voices = initialVoices;
	const listeners = new Set<() => void>();
	vi.stubGlobal("speechSynthesis", {
		speak: (utterance: StubUtterance) => {
			record.calls.push("speak");
			record.spoken.push(utterance.text);
			record.voices.push(utterance.voice === null ? null : `${utterance.voice.name} ${utterance.lang}`);
			queue.push(utterance);
		},
		pause: () => record.calls.push("pause"),
		resume: () => record.calls.push("resume"),
		cancel: () => {
			record.calls.push("cancel");
			queue.splice(0).forEach((utterance) => utterance.onerror?.());
		},
		getVoices: () => voices,
		addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
	});
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class implements StubUtterance {
			text: string;
			voice: StubVoice | null = null;
			lang = "";
			onstart: (() => void) | null = null;
			onend: (() => void) | null = null;
			onerror: (() => void) | null = null;
			constructor(text: string) {
				this.text = text;
			}
		},
	);
	return {
		...record,
		loadVoices: (next: StubVoice[]) => {
			voices = next;
			listeners.forEach((listener) => {
				listener();
			});
		},
		start: () => queue[0]?.onstart?.(),
		finish: () => {
			while (queue.length > 0) {
				const utterance = queue.shift()!;
				utterance.onstart?.();
				utterance.onend?.();
			}
		},
	};
}

function readAloudState(container: HTMLElement) {
	const control = bar(container).querySelector<HTMLButtonElement>("[data-read-aloud]")!;
	return {
		label: control.getAttribute("aria-label"),
		icon: control.querySelector("[data-icon]")?.getAttribute("data-icon") ?? null,
		pressed: control.getAttribute("aria-pressed"),
	};
}

describe("UserMessageActions", () => {
	it("draws Fork from here with an arrow splitting right, as upstream's ArrowSplitRight", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		);
		const icon = button(container, "Fork from here").querySelector("svg")?.getAttribute("class")?.split(" ") ?? [];

		expect(icon.filter((name) => name.startsWith("lucide-") || name === "rotate-90")).toStrictEqual([
			"lucide-split",
			"rotate-90",
		]);
	});

	it("without panels: dates a week-old message as upstream's user <time> does: 11px caption ink in a 24px slot, relative before", () => {
		const time = (timestamp: string) => {
			const {container, unmount} = render(
				<PanelsOff>
					<UserMessageActions message={MESSAGE} text="Hi" timestamp={timestamp} details={[]} />
				</PanelsOff>,
			);
			const element = container.querySelector("time");
			const result = {text: element?.textContent, className: element?.className};
			unmount();
			return result;
		};
		const slot =
			"flex h-6 items-center pe-[6px] text-[11px]/[17px] text-ink-muted tabular-nums outline-none comfortable:h-8";

		expect([
			time("2026-09-26T10:00:00.000Z"),
			time("2026-09-20T10:00:00.000Z"),
			time("2025-09-20T10:00:00.000Z"),
		]).toStrictEqual([
			{text: "4 days ago", className: slot},
			{text: "Sep 20", className: slot},
			{text: "Sep 20, 2025", className: slot},
		]);
	});

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

	it("puts the Read by Claude receipt between the time and Copy only when the CLI read the prompt", () => {
		const read = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		).container;
		const readOrder = controlOrder(read);
		cleanup();
		const unread = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		).container;

		expect({read: readOrder, unread: controlOrder(unread)}).toStrictEqual({
			read: ["time", "Read by Claude", "Copy", "Rewind to here", "Fork from here"],
			unread: ["time", "Copy", "Rewind to here", "Fork from here"],
		});
	});

	it("draws the receipt on a fine pointer as a toolbar CheckDouble icon button with no ghost fill", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		);
		const receipt = button(container, "Read by Claude");
		const classes = receipt.className.split(" ");
		expect({
			infoTip: receipt.hasAttribute("data-info-tip"),
			hasPopup: receipt.getAttribute("aria-haspopup"),
			icon: receipt.querySelector("svg")?.getAttribute("class")?.split(" ").includes("lucide-check-check"),
			button: ["size-6", "hover:bg-transparent"].every((c) => classes.includes(c)),
			infoTipSpacing: ["p-1", "-m-1"].some((c) => classes.includes(c)),
		}).toStrictEqual({infoTip: false, hasPopup: null, icon: true, button: true, infoTipSpacing: false});
	});

	it("without panels: spaces the receipt as a plain 24px toolbar button in a gapless bar, overlapping nothing", () => {
		const {container} = render(
			<PanelsOff>
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />
			</PanelsOff>,
		);
		const spacing = (element: Element) =>
			(element.getAttribute("class") ?? "").split(" ").filter((c) => /^-?(?:[pm][xyseltrb]?|gap|size)-/.test(c));
		const items = Array.from(bar(container).querySelectorAll("button, time")).map((element) => [
			element.tagName === "TIME" ? "time" : (element.getAttribute("aria-label") ?? ""),
			spacing(element),
		]);

		expect({bar: spacing(bar(container)), items}).toStrictEqual({
			bar: ["gap-0"],
			items: [
				["time", ["pe-[6px]"]],
				["Read by Claude", ["size-6"]],
				["Copy", ["size-6"]],
				["Rewind to here", ["size-6"]],
				["Fork from here", ["size-6"]],
			],
		});
	});

	it("keeps the bar shown while a popup inside it is open", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		);
		const classes = bar(container).className.split(" ");
		expect(
			["has-[[data-popup-open]]:opacity-100", "has-[[data-popup-open]]:pointer-events-auto"].filter(
				(c) => !classes.includes(c),
			),
		).toStrictEqual([]);
	});

	it("focuses the receipt first after a keyboard reveal, as upstream's first tabbable item", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		);
		const hidden = button(container, "Read by Claude").tabIndex;
		fireEvent.click(showActions(container));
		expect({
			hidden,
			revealed: button(container, "Read by Claude").tabIndex,
			focused: document.activeElement?.getAttribute("aria-label") ?? null,
		}).toStrictEqual({hidden: 0, revealed: 0, focused: "Read by Claude"});
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
			visibleHasCaption: visible.includes("Scheduled task"),
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
			const lines = Array.from(tooltip.children).map((line) => line.textContent);
			fireEvent.pointerLeave(button(container, label).parentElement!);
			return lines;
		}

		expect({
			rewind: hoverTooltip("Rewind to here"),
			fork: hoverTooltip("Fork from here"),
		}).toStrictEqual({
			rewind: ["Rewind to here", "Removes this message and everything after it."],
			fork: ["Fork from here", "Starts a new session from this point. This one stays as it is."],
		});
	});

	it("describes Rewind and Fork with upstream's toolbar detail as aria-description", () => {
		const {container} = render(
			withActions(
				{
					rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>(),
					forkFrom: vi.fn<NonNullable<TranscriptActions["forkFrom"]>>(),
				},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);

		expect({
			copy: button(container, "Copy").getAttribute("aria-description"),
			rewind: button(container, "Rewind to here").getAttribute("aria-description"),
			fork: button(container, "Fork from here").getAttribute("aria-description"),
		}).toStrictEqual({
			copy: null,
			rewind: "Removes this message and everything after it.",
			fork: "Starts a new session from this point. This one stays as it is.",
		});
	});

	it("keeps focus where it was when a toolbar button is pressed, as upstream's onMouseDown preventDefault", () => {
		const {container} = render(
			<>
				<textarea aria-label="Composer" />
				{withActions(
					{
						rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>(),
						forkFrom: vi.fn<NonNullable<TranscriptActions["forkFrom"]>>(),
					},
					<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
				)}
			</>,
		);
		const composer = container.querySelector("textarea")!;
		composer.focus();

		const prevented = ["Copy", "Rewind to here", "Fork from here"].map(
			(label) => !fireEvent.mouseDown(button(container, label)),
		);

		expect({prevented, focused: document.activeElement === composer}).toStrictEqual({
			prevented: [true, true, true],
			focused: true,
		});
	});

	it("hands Rewind and Fork the message", () => {
		const rewindTo = vi.fn<NonNullable<TranscriptActions["rewindTo"]>>();
		const forkFrom = vi.fn<NonNullable<TranscriptActions["forkFrom"]>>();
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

describe("Rewind while Claude is working", () => {
	const REASON = "Rewind is unavailable while Claude is working";

	function rewindState(container: HTMLElement) {
		const rewind = button(container, "Rewind to here");
		const wrapper = rewind.closest<HTMLElement>("[data-cds-disabled-reason-wrapper]");
		const describedBy = wrapper?.getAttribute("aria-describedby") ?? null;
		return {
			disabled: rewind.disabled,
			wrapperTabIndex: wrapper?.tabIndex ?? null,
			description: describedBy === null ? null : (document.getElementById(describedBy)?.textContent ?? null),
		};
	}

	it("disables Rewind to here inside upstream's disabled-reason wrapper, described by the working reason", () => {
		const rewindTo = vi.fn<NonNullable<TranscriptActions["rewindTo"]>>();
		const {container} = render(
			withActions(
				{rewindTo, rewindDisabledReason: REASON},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		fireEvent.click(button(container, "Rewind to here"));

		expect({...rewindState(container), calls: rewindTo.mock.calls}).toStrictEqual({
			disabled: true,
			wrapperTabIndex: -1,
			description: REASON,
			calls: [],
		});
	});

	it("drops the toolbar detail from a blocked Rewind, leaving the wrapper's reason as its only description", () => {
		const {container} = render(
			withActions(
				{rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>(), rewindDisabledReason: REASON},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);

		expect({
			buttonDescription: button(container, "Rewind to here").getAttribute("aria-description"),
			wrapperDescription: rewindState(container).description,
		}).toStrictEqual({buttonDescription: null, wrapperDescription: REASON});
	});

	it("shows only the working reason on hover, not the Rewind to here label", () => {
		const {container} = render(
			withActions(
				{rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>(), rewindDisabledReason: REASON},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		const wrapper = button(container, "Rewind to here").closest<HTMLElement>("[data-cds-disabled-reason-wrapper]")!;
		fireEvent.pointerEnter(wrapper.parentElement!);
		fireEvent.pointerEnter(button(container, "Rewind to here").parentElement!);
		act(() => {
			vi.advanceTimersByTime(300);
		});

		expect(Array.from(container.querySelectorAll('[role="tooltip"]')).map((tip) => tip.textContent)).toStrictEqual([
			REASON,
		]);
	});

	it("hands focus to the reason wrapper when a focused Rewind gains a reason, ahead of the roving heir", async () => {
		const rewindTo = vi.fn<NonNullable<TranscriptActions["rewindTo"]>>();
		const view = (reason: string | null) =>
			withActions(
				{rewindTo, ...(reason === null ? {} : {rewindDisabledReason: reason})},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			);
		const {container, rerender} = render(view(null));
		button(container, "Rewind to here").focus();
		rerender(view(REASON));
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect({
			focusedWrapper: document.activeElement?.hasAttribute("data-cds-disabled-reason-wrapper") ?? false,
			wrapperTabIndex: rewindState(container).wrapperTabIndex,
		}).toStrictEqual({focusedWrapper: true, wrapperTabIndex: 0});
	});

	it("reaches the reason wrapper with ArrowRight from Copy, as a roving toolbar item", () => {
		const {container} = render(
			withActions(
				{rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>(), rewindDisabledReason: REASON},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		const copy = button(container, "Copy");
		copy.focus();
		fireEvent.keyDown(copy, {key: "ArrowRight"});

		expect({
			focusedWrapper: document.activeElement?.hasAttribute("data-cds-disabled-reason-wrapper") ?? false,
			wrapperTabIndex: rewindState(container).wrapperTabIndex,
		}).toStrictEqual({focusedWrapper: true, wrapperTabIndex: 0});
	});

	it("skips an undescribed reason wrapper, moving from Copy straight to the enabled Rewind", () => {
		const {container} = render(
			withActions(
				{rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>()},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		const copy = button(container, "Copy");
		copy.focus();
		fireEvent.keyDown(copy, {key: "ArrowRight"});

		expect(document.activeElement?.getAttribute("aria-label") ?? null).toBe("Rewind to here");
	});

	it("leaves Rewind enabled and undescribed while the pane is idle", () => {
		const {container} = render(
			withActions(
				{rewindTo: vi.fn<NonNullable<TranscriptActions["rewindTo"]>>()},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);

		expect(rewindState(container)).toStrictEqual({disabled: false, wrapperTabIndex: -1, description: null});
	});
});

describe("Fork from here's disabled reason", () => {
	const REASON = "Session directory is unknown";

	function forkState(container: HTMLElement) {
		const fork = button(container, "Fork from here");
		const wrapper = fork.closest<HTMLElement>("[data-cds-disabled-reason-wrapper]");
		const describedBy = wrapper?.getAttribute("aria-describedby") ?? null;
		return {
			disabled: fork.disabled,
			wrapped: wrapper !== null,
			wrapperTabIndex: wrapper?.tabIndex ?? null,
			description: describedBy === null ? null : (document.getElementById(describedBy)?.textContent ?? null),
		};
	}

	it("keeps an enabled Fork inside an undescribed reason wrapper, as upstream's stable DOM", () => {
		const {container} = render(
			withActions(
				{forkFrom: vi.fn<NonNullable<TranscriptActions["forkFrom"]>>()},
				<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
			),
		);

		expect(forkState(container)).toStrictEqual({
			disabled: false,
			wrapped: true,
			wrapperTabIndex: -1,
			description: null,
		});
	});

	it("disables Fork described by the reason, and hovering shows only the reason, not the label", () => {
		const {container} = render(
			withActions(
				{forkDisabledReason: REASON},
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		const wrapper = button(container, "Fork from here").closest<HTMLElement>("[data-cds-disabled-reason-wrapper]")!;
		fireEvent.pointerEnter(wrapper.parentElement!);
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const tooltips = Array.from(container.querySelectorAll('[role="tooltip"]')).map((tip) => tip.textContent);

		expect({...forkState(container), tooltips}).toStrictEqual({
			disabled: true,
			wrapped: true,
			wrapperTabIndex: -1,
			description: REASON,
			tooltips: [REASON],
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

	it("sizes buttons 24px with radius 6 and 16px icons, the assistant time a 24px 13px/19px flex box and the user time 11px/17px, each padded on its inner side", () => {
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
			assistantTime: ["flex", "h-6", "items-center", "text-[13px]/[19px]", "text-ink-muted", "ps-2"].every((c) =>
				assistantTime.includes(c),
			),
			userTime: ["text-[11px]/[17px]", "h-6", "text-ink-muted", "pe-[6px]"].every((c) => userTime.includes(c)),
		}).toStrictEqual({button: true, icon: true, assistantTime: true, userTime: true});
	});

	it("lays the bar out as upstream's 24px toolbar: no inter-button gap, 6px under the prose and 2px left of it on assistant turns", () => {
		const has = (classes: string[], wanted: readonly string[]) => wanted.filter((c) => classes.includes(c));
		const assistant = bar(
			render(<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />)
				.container,
		).className.split(" ");
		cleanup();
		const user = bar(
			render(<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />).container,
		).className.split(" ");
		const wanted = ["gap-0", "h-6", "mt-xs", "-ms-[2px]", "gap-g1", "pt-[4px]"] as const;

		expect({assistant: has(assistant, wanted), user: has(user, wanted)}).toStrictEqual({
			assistant: ["gap-0", "h-6", "mt-xs", "-ms-[2px]"],
			user: ["gap-0", "h-6"],
		});
	});

	it("fades the bar in after 100ms on hover, at once on focus, and out in 60ms, with no scale", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const classes = bar(container).className.split(" ");

		expect({
			scales: classes.filter((c) => c.includes("scale")),
			restDelay: classes.includes("motion-safe:delay-100"),
			missing: [
				"motion-safe:transition-opacity",
				"motion-safe:duration-[60ms]",
				"motion-safe:ease-[cubic-bezier(.32,.72,0,1)]",
				"motion-safe:group-hover/msg:duration-[120ms]",
				"motion-safe:group-hover/msg:delay-100",
				"motion-safe:[@media(hover:hover)]:data-hovered:duration-[120ms]",
				"motion-safe:[@media(hover:hover)]:data-hovered:delay-100",
				"motion-safe:focus-within:duration-[120ms]",
				"motion-safe:focus-within:delay-0",
				"motion-safe:data-revealed:duration-[120ms]",
				"motion-safe:data-revealed:delay-0",
			].filter((c) => !classes.includes(c)),
		}).toStrictEqual({scales: [], restDelay: false, missing: []});
	});

	it("gives the assistant bar upstream's toolbar semantics with Copy as its single tab stop", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const toolbar = bar(container);

		expect({
			role: toolbar.getAttribute("role"),
			label: toolbar.getAttribute("aria-label"),
			tabIndex: toolbar.getAttribute("tabindex"),
			cds: toolbar.getAttribute("data-cds"),
			reveal: toolbar.getAttribute("data-reveal"),
			testId: toolbar.getAttribute("data-testid"),
			stops: Array.from(toolbar.querySelectorAll('[tabindex="0"]')).map((element) =>
				element.getAttribute("aria-label"),
			),
			timeTabIndex: toolbar.querySelector("time")!.getAttribute("tabindex"),
		}).toStrictEqual({
			role: "toolbar",
			label: "Message actions",
			tabIndex: "-1",
			cds: "MessageActions",
			reveal: "fade",
			testId: "message-actions",
			stops: ["Copy"],
			timeTabIndex: null,
		});
	});

	it("lets Space on the bar itself through, as upstream's unparked MessageActions root (the transcript scrolls)", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		expect(fireEvent.keyDown(bar(container), {key: " "})).toBe(true);
	});

	it("gives the user bar toolbar semantics and upstream's user-message-actions test id", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		);
		const toolbar = bar(container);

		expect({
			role: toolbar.getAttribute("role"),
			label: toolbar.getAttribute("aria-label"),
			cds: toolbar.getAttribute("data-cds"),
			testId: toolbar.getAttribute("data-testid"),
			timeTabIndex: toolbar.querySelector("time")!.getAttribute("tabindex"),
		}).toStrictEqual({
			role: "toolbar",
			label: "Message actions",
			cds: "MessageActions",
			testId: "user-message-actions",
			timeTabIndex: null,
		});
	});

	it("roves the assistant bar with the arrows (wrapping), Home and End, and remembers the last focused item", () => {
		stubSpeech();
		const {container} = render(
			withActions(
				{
					forkFrom: vi.fn<NonNullable<TranscriptActions["forkFrom"]>>(),
					pinChapter: vi.fn<NonNullable<TranscriptActions["pinChapter"]>>(),
				},
				<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		const focused = () => document.activeElement?.getAttribute("aria-label") ?? null;
		const press = (key: string) => {
			fireEvent.keyDown(document.activeElement!, {key});
			return focused();
		};
		button(container, "Copy").focus();
		const right = press("ArrowRight");
		button(container, "Copy").focus();
		const left = press("ArrowLeft");
		const home = press("Home");
		const end = press("End");
		button(container, "Pin as chapter").focus();
		fireEvent.blur(button(container, "Pin as chapter"), {relatedTarget: document.body});

		expect({
			right,
			left,
			home,
			end,
			stops: Array.from(bar(container).querySelectorAll('[tabindex="0"]')).map((element) =>
				element.getAttribute("aria-label"),
			),
		}).toStrictEqual({
			right: "Fork from here",
			left: "Read aloud",
			home: "Copy",
			end: "Read aloud",
			stops: ["Pin as chapter"],
		});
	});

	it("reveals the bar from Show message actions and focuses Copy", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const show = showActions(container);
		const showIsSrOnly = show.className.split(" ").includes("sr-only");
		fireEvent.click(show);

		expect({
			showIsSrOnly,
			barRevealed: bar(container).hasAttribute("data-revealed"),
			focused: document.activeElement?.getAttribute("aria-label") ?? null,
		}).toStrictEqual({showIsSrOnly: true, barRevealed: true, focused: "Copy"});
	});

	it("reveals the bar as soon as Tab lands on the empty sr-only button, focusing Copy", () => {
		const {container, getByRole} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const show = showActions(container);
		fireEvent.focus(show);

		expect({
			text: show.textContent,
			byRole: getByRole("button", {name: /^Show message actions for /}) === show,
			barRevealed: bar(container).hasAttribute("data-revealed"),
			focused: document.activeElement?.getAttribute("aria-label") ?? null,
		}).toStrictEqual({text: "", byRole: true, barRevealed: true, focused: "Copy"});
	});

	it("reveals onto the last focused item, the toolbar's single tab stop", () => {
		const {container} = render(
			withActions(
				{pinChapter: vi.fn<NonNullable<TranscriptActions["pinChapter"]>>()},
				<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
			),
		);
		fireEvent.focus(showActions(container));
		act(() => {
			button(container, "Pin as chapter").focus();
		});
		fireEvent.blur(button(container, "Pin as chapter"), {relatedTarget: document.body});
		act(() => {
			showActions(container).focus();
		});

		expect(document.activeElement?.getAttribute("aria-label") ?? null).toBe("Pin as chapter");
	});

	it("always shows the toolbar on coarse-pointer or hover-less devices, without the fade transition", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const classes = bar(container).className.split(" ");

		expect(
			[
				"pointer-coarse:opacity-100",
				"pointer-coarse:pointer-events-auto",
				"[@media(hover:none)]:opacity-100",
				"[@media(hover:none)]:pointer-events-auto",
				"motion-safe:pointer-coarse:transition-none",
			].filter((c) => !classes.includes(c)),
		).toStrictEqual([]);
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
		}).toStrictEqual({revealed: false, copyTabIndex: 0});
	});

	it("announces a copy in an sr-only status region instead of a visible bubble", async () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const status = () => container.querySelector('[role="status"]');
		const before = status()?.textContent ?? null;
		await actAndSettle(() => {
			fireEvent.click(button(container, "Copy"));
		});

		expect({
			before,
			after: status()?.textContent ?? null,
			srOnly: status()?.className.split(" ").includes("sr-only") ?? false,
		}).toStrictEqual({before: "", after: "Copied", srOnly: true});
	});
});

describe("message actions states (upstream 2026-11-01)", () => {
	const toolbarAttrs = (element: Element | null) =>
		element === null
			? null
			: {testId: element.getAttribute("data-testid"), size: element.getAttribute("data-size")};

	it("tags the user, assistant and waiting toolbars as upstream and marks each data-size xs", () => {
		const user = toolbarAttrs(
			bar(
				render(<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />).container,
			),
		);
		cleanup();
		const assistant = toolbarAttrs(
			bar(
				render(<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />)
					.container,
			),
		);
		cleanup();
		const waiting = toolbarAttrs(
			render(<WaitingMessageActions text="Hi" />).container.querySelector("[role=toolbar]"),
		);

		expect({user, assistant, waiting}).toStrictEqual({
			user: {testId: "user-message-actions", size: "xs"},
			assistant: {testId: "message-actions", size: "xs"},
			waiting: {testId: "user-message-actions", size: "xs"},
		});
	});

	function receiptLayout(container: HTMLElement) {
		const receipt = button(container, "Read by Claude");
		const separator = bar(container).querySelector("[data-testid=epitaxy-row-words-end]");
		return {
			// The bar's flex items in DOM order, each named by the control it holds.
			children: Array.from(bar(container).children).map((child) => {
				if (child.querySelector("time") !== null) return "time";
				if (child.getAttribute("role") === "status") return "status";
				const control = child.matches("button") ? child : child.querySelector("button");
				return control?.getAttribute("aria-label") ?? child.getAttribute("data-testid") ?? child.tagName;
			}),
			// The bar's flex item holding the receipt: the button itself, or the tooltip anchor around it.
			receipt: ["order-first", "me-0"].filter((c) =>
				(Array.from(bar(container).children).find((child) => child.contains(receipt))?.className ?? "")
					.split(" ")
					.includes(c),
			),
			separator:
				separator === null
					? null
					: {
							ariaHidden: separator.getAttribute("aria-hidden"),
							className: separator.className,
						},
		};
	}

	it("panels: leads the user toolbar with the receipt (order-first me-0) and a · separator shown when something follows the time", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		);

		expect(receiptLayout(container)).toStrictEqual({
			children: [
				"time",
				"Read by Claude",
				"epitaxy-row-words-end",
				"Copy",
				"status",
				"Rewind to here",
				"Fork from here",
			],
			receipt: ["order-first", "me-0"],
			separator: {
				ariaHidden: "true",
				className:
					"hidden min-h-6 items-center self-center pe-0.5 text-caption text-muted-as-secondary before:content-['·'] [:has(>time)~&:not(:last-child)]:flex comfortable:min-h-8",
			},
		});
	});

	it("panels: draws no separator without the receipt", () => {
		const {container} = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		);
		expect(bar(container).querySelector("[data-testid=epitaxy-row-words-end]")).toBeNull();
	});

	it("without panels: keeps the receipt after the time with no separator", () => {
		const {container} = render(
			<PanelsOff>
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />
			</PanelsOff>,
		);

		expect(receiptLayout(container)).toStrictEqual({
			children: ["time", "Read by Claude", "Copy", "status", "Rewind to here", "Fork from here"],
			receipt: [],
			separator: null,
		});
	});

	it("panels: sentence-cases the user time as a block box, leaving the assistant time alone", () => {
		const user = render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />,
		).container.querySelector("time")!.className;
		cleanup();
		const assistant = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		).container.querySelector("time")!.className;
		cleanup();
		const userOff = render(
			<PanelsOff>
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} />
			</PanelsOff>,
		).container.querySelector("time")!.className;

		expect({
			user,
			assistantCased: assistant.split(" ").includes("first-letter:uppercase"),
			userOff,
		}).toStrictEqual({
			user: "block h-6 content-center pe-[6px] text-[11px]/[17px] text-ink-muted tabular-nums outline-none first-letter:uppercase comfortable:h-8",
			assistantCased: false,
			userOff:
				"flex h-6 items-center pe-[6px] text-[11px]/[17px] text-ink-muted tabular-nums outline-none comfortable:h-8",
		});
	});

	it("panels: starts the assistant time 12px from the last button at both densities (flat-look ms-1 on ps-2)", () => {
		const spacing = (className: string) => className.split(" ").filter((c) => /^(?:comfortable:)?[mp]s-/.test(c));
		const on = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		).container.querySelector("time")!.className;
		cleanup();
		const off = render(
			<PanelsOff>
				<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />
			</PanelsOff>,
		).container.querySelector("time")!.className;

		expect({on: spacing(on), off: spacing(off)}).toStrictEqual({
			on: ["ps-2", "ms-1"],
			off: ["ps-2", "comfortable:ps-3"],
		});
	});

	it("fades the waiting row's reveal-on-hover group with the bar's timing: out 60ms at once, hover in after 100ms, focus in at once", () => {
		const {container} = render(<WaitingMessageActions text="Hi" />);
		const group = container.querySelector("[data-cds-reveal-on-hover]");
		const classes = group?.className.split(" ") ?? [];

		expect({
			found: group !== null,
			legacy: container.querySelector("[data-reveal-on-hover]") !== null,
			bareDelay: classes.includes("motion-safe:delay-100"),
			missing: [
				"motion-safe:duration-[60ms]",
				"motion-safe:delay-0",
				"motion-safe:group-hover/msg:duration-[120ms]",
				"motion-safe:group-hover/msg:delay-100",
				"motion-safe:focus-within:duration-[120ms]",
				"motion-safe:focus-within:delay-0",
				"motion-safe:pointer-coarse:transition-none",
			].filter((c) => !classes.includes(c)),
		}).toStrictEqual({found: true, legacy: false, bareDelay: false, missing: []});
	});
});

describe("pointer-forked receipt mark (user-row-read-receipt T1)", () => {
	/** Stubs `matchMedia` so only upstream's touch query `(pointer: coarse), (hover: none)` matches, when `touch`. */
	function stubPointer(touch: boolean) {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: touch && query === "(pointer: coarse), (hover: none)",
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}));
	}

	function readByClaude() {
		return render(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		).container;
	}

	function tooltips(): string[] {
		return Array.from(document.querySelectorAll('[role="tooltip"]')).map((tip) => tip.textContent);
	}

	it("fine pointer: a click opens the Read by Claude tooltip and keeps focus on the button, with no dialog", () => {
		stubPointer(false);
		const container = readByClaude();
		const receipt = button(container, "Read by Claude");
		act(() => {
			receipt.focus();
		});
		fireEvent.click(receipt);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect({
			tooltips: tooltips(),
			dialogs: document.querySelectorAll('[role="dialog"]').length,
			focused: document.activeElement === receipt,
		}).toStrictEqual({tooltips: ["Read by Claude"], dialogs: 0, focused: true});
	});

	it("fine pointer: the tooltip a click opened closes when the pointer leaves", () => {
		stubPointer(false);
		const container = readByClaude();
		const receipt = button(container, "Read by Claude");
		fireEvent.pointerEnter(receipt);
		fireEvent.click(receipt);
		const opened = tooltips();
		fireEvent.pointerLeave(receipt);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect({opened, left: tooltips()}).toStrictEqual({opened: ["Read by Claude"], left: []});
	});

	it("fine pointer: keyboard focus opens the tooltip", () => {
		stubPointer(false);
		const container = readByClaude();
		fireEvent.focus(button(container, "Read by Claude"));
		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect(tooltips()).toStrictEqual(["Read by Claude"]);
	});

	it("touch / no hover: keeps upstream's InfoTip, whose click opens a Read by Claude dialog", async () => {
		stubPointer(true);
		const container = readByClaude();
		const receipt = button(container, "Read by Claude");
		const attributes = {
			hasPopup: receipt.getAttribute("aria-haspopup"),
			infoTip: receipt.hasAttribute("data-info-tip"),
		};
		await actAndSettle(() => {
			fireEvent.click(receipt);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});
		const dialog = document.querySelector('[role="dialog"]');
		expect({
			attributes,
			dialog: {label: dialog?.getAttribute("aria-label"), text: dialog?.textContent},
		}).toStrictEqual({
			attributes: {hasPopup: "dialog", infoTip: true},
			dialog: {label: "Read by Claude", text: "Read by Claude"},
		});
	});

	it("fine pointer: a stacked waiting row's Unread is a dimmed 24px button whose click shows its tooltip and marks it popup-open", () => {
		stubPointer(false);
		const {container} = render(
			<PanelsOff>
				<WaitingMessageActions text="two" stacked />
			</PanelsOff>,
		);
		const unread = button(container, "Unread");
		const classes = unread.className.split(" ");
		const at = {
			infoTip: unread.hasAttribute("data-info-tip"),
			button: ["size-6", "opacity-50", "data-[popup-open]:opacity-100"].every((c) => classes.includes(c)),
		};
		fireEvent.click(unread);
		expect({at, tooltips: tooltips(), popupOpen: unread.hasAttribute("data-popup-open")}).toStrictEqual({
			at: {infoTip: false, button: true},
			tooltips: ["Unread"],
			popupOpen: true,
		});
	});

	it("server render draws the button form, as upstream's false server snapshot does", () => {
		const html = renderToString(
			<UserMessageActions message={MESSAGE} text="Hi" timestamp={TIMESTAMP} details={[]} readByClaude />,
		);
		expect({
			label: html.includes('aria-label="Read by Claude"'),
			hasPopup: html.includes("aria-haspopup"),
		}).toStrictEqual({label: true, hasPopup: false});
	});
});

describe("waiting row toolbar roving (upstream n0 MessageActions with RC defaults)", () => {
	function stopsIn(root: Element): string[] {
		return [...root.querySelectorAll('[tabindex="0"]')].map(
			(element) => element.getAttribute("aria-label") ?? element.textContent,
		);
	}

	function activeLabel(): string | null {
		return document.activeElement?.getAttribute("aria-label") ?? null;
	}

	it("makes a stacked non-panels waiting bar one roving stop, the Unread receipt, through Copy to Send now", () => {
		const {container} = render(
			<PanelsOff>
				<WaitingMessageActions text="two" stacked onCancel={() => undefined}>
					<button type="button" aria-label="Send now" />
				</WaitingMessageActions>
			</PanelsOff>,
		);
		const toolbar = container.querySelector<HTMLElement>("[role=toolbar]")!;
		const unread = button(container, "Unread");
		const stops = stopsIn(toolbar);
		act(() => {
			unread.focus();
		});
		fireEvent.keyDown(unread, {key: "ArrowRight"});
		const afterRight = activeLabel();
		fireEvent.keyDown(document.activeElement!, {key: "End"});
		const afterEnd = activeLabel();

		expect({
			stops,
			afterRight,
			afterEnd,
			cds: toolbar.getAttribute("data-cds"),
			reveal: toolbar.getAttribute("data-reveal"),
			tabIndex: toolbar.getAttribute("tabindex"),
		}).toStrictEqual({
			stops: ["Unread"],
			afterRight: "Copy",
			afterEnd: "Send now",
			cds: "MessageActions",
			reveal: "fade",
			tabIndex: "-1",
		});
	});

	it("makes Copy the single stop on the head waiting row", () => {
		const {container} = render(
			<WaitingMessageActions text="one">
				<button type="button" aria-label="Send now" />
			</WaitingMessageActions>,
		);

		expect(stopsIn(container.querySelector("[role=toolbar]")!)).toStrictEqual(["Copy"]);
	});
});
