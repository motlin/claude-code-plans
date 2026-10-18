// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AssistantMessageActions, UserMessageActions} from "../src/components/message-actions";
import {type TranscriptActions, TranscriptActionsContext} from "../src/components/transcript-actions-context";
import {writeClipboardText} from "../src/lib/clipboard";

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

	it("dates a week-old message as upstream's user <time> does: 11px caption ink in a 24px slot, relative before", () => {
		const time = (timestamp: string) => {
			const {container, unmount} = render(
				<UserMessageActions message={MESSAGE} text="Hi" timestamp={timestamp} details={[]} />,
			);
			const element = container.querySelector("time");
			const result = {text: element?.textContent, className: element?.className};
			unmount();
			return result;
		};
		const slot = "flex h-6 items-center pe-1 text-[11px] text-ink-muted tabular-nums outline-none";

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
			rewind: ["Rewind to here", "Removes this message and what follows"],
			fork: ["Fork from here", "Starts a new session, keeps this one"],
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

	it("sizes buttons 24px with radius 6 and 16px icons, the assistant time 13px/19px and the user time 11px, each padded on its inner side", () => {
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
			userTime: ["text-[11px]", "h-6", "text-ink-muted", "pe-1"].every((c) => userTime.includes(c)),
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

	it("always shows the toolbar on coarse-pointer or hover-less devices, without the fade transition", () => {
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);
		const classes = bar(container).className.split(" ");

		expect(
			[
				"pointer-coarse:opacity-100",
				"pointer-coarse:scale-100",
				"pointer-coarse:pointer-events-auto",
				"[@media(hover:none)]:opacity-100",
				"[@media(hover:none)]:scale-100",
				"[@media(hover:none)]:pointer-events-auto",
				"motion-safe:pointer-coarse:transition-none",
			].filter((c) => !classes.includes(c)),
		).toStrictEqual([]);
	});

	it("keeps toolbar controls in the tab order on touch devices", () => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query === "(pointer: coarse), (hover: none)",
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		}));
		const {container} = render(
			<AssistantMessageActions message={MESSAGE} text="Hello" timestamp={TIMESTAMP} details={[]} />,
		);

		expect(
			Array.from(bar(container).querySelectorAll<HTMLElement>("button, time")).map((element) => element.tabIndex),
		).toStrictEqual([0, 0, 0, 0, 0]);
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
