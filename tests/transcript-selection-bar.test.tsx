// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook, screen} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {TranscriptSelectionBar} from "../src/components/transcript-selection-bar";
import {useTranscriptSelection} from "../src/hooks/use-transcript-selection";
import {type ToastOptions, ToastContext} from "../src/components/toast-context";
import {TurnUndoSendContext} from "../src/components/turn-undo-send-context";
import
{
	attachContext,
	type ComposerHandle,
	getContextChips,
	MAX_STAGED_REPLIES,
	REPLY_CAP_MESSAGE,
	registerComposer,
	takeContextChips,
} from "../src/lib/context-attach";
import {INLINE_REPLY_ENABLED} from "../src/lib/inline-reply";
import {getSideChat, openSideChat, resetSideChatStore} from "../src/lib/side-chat-store";

const SESSION = "bar-session";

interface Rect
{
	left: number;
	top: number;
	width: number;
	height: number;
}

function domRect({left, top, width, height}: Rect): DOMRect
{
	return {
		left,
		top,
		width,
		height,
		x: left,
		y: top,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

const SCROLLER_RECT: Rect =
{
	left: 100,
	top: 50,
	width: 800,
	height: 750,
};
const BAR_RECT: Rect =
{
	left: 0,
	top: 0,
	width: 165,
	height: 24,
};
let rangeRect: Rect =
{
	left: 400,
	top: 368.5,
	width: 200,
	height: 19,
};

let focus: ReturnType<typeof vi.fn<ComposerHandle["focus"]>>;
let toast: ReturnType<typeof vi.fn<(options: ToastOptions) => void>>;
let send: ReturnType<typeof vi.fn<(text: string) => void>>;
let unregister: () => void = () =>
{
};

beforeEach(() =>
{
	vi.useFakeTimers();
	rangeRect =
	{
		left: 400,
		top: 368.5,
		width: 200,
		height: 19,
	};
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
	{
		callback(0);
		return 0;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(
		Range.prototype,
		"getClientRects",
		{
			configurable: true,
			value: () => [domRect(rangeRect)],
		},
	);
	Object.defineProperty(
		Range.prototype,
		"getBoundingClientRect",
		{
			configurable: true,
			value: () => domRect(rangeRect),
		},
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
	{
		if (this.dataset["testid"] === "scroller") return domRect(SCROLLER_RECT);
		if (this.dataset["transcriptSelectionBar"] !== undefined) return domRect(BAR_RECT);
		return domRect(
			{
				left: 0,
				top: 0,
				width: 0,
				height: 0,
			},
		);
	});
	focus = vi.fn<ComposerHandle["focus"]>();
	toast = vi.fn<(options: ToastOptions) => void>();
	send = vi.fn<(text: string) => void>();
	unregister = registerComposer(
		SESSION,
		{
			insertText: vi.fn<ComposerHandle["insertText"]>(),
			focus,
		},
	);
});

afterEach(() =>
{
	unregister();
	cleanup();
	window.getSelection()?.removeAllRanges();
	takeContextChips(SESSION);
	resetSideChatStore();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(Range.prototype, "getClientRects");
	Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

function Harness({sideChatAvailable, inlineReply}: {sideChatAvailable: boolean; inlineReply?: boolean})
{
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<ToastContext.Provider value={toast}>
			<TurnUndoSendContext.Provider value={send}>
				<div
					data-testid="scroller"
					style={
					{
						overflowY: "auto",
					}}
				>
					<div ref={containerRef}>
						<p data-transcript-entry-index="3">Hermit crabs live in tide pools.</p>
						<p data-transcript-entry-index="4">Tide pools form in rocky hollows.</p>
					</div>
					<TranscriptSelectionBar
						sessionId={SESSION}
						containerRef={containerRef}
						sideChatAvailable={sideChatAvailable}
						{...(inlineReply === undefined
							? {}
							:
								{
									inlineReply,
								})}
					/>
				</div>
			</TurnUndoSendContext.Provider>
		</ToastContext.Provider>
	);
}

function renderBar(sideChatAvailable = true, inlineReply?: boolean): void
{
	render(
		<Harness
			sideChatAvailable={sideChatAvailable}
			{...(inlineReply === undefined
				? {}
				:
					{
						inlineReply,
					})}
		/>,
	);
}

function textNodeContaining(text: string): Text
{
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
	{
		if (node.textContent?.includes(text) === true && node instanceof Text) return node;
	}
	throw new Error(`no text node containing ${text}`);
}

function select(text: string, length = text.length): void
{
	const node = textNodeContaining(text);
	const start = node.data.indexOf(text);
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, start + length);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	act(() =>
	{
		document.dispatchEvent(new Event("selectionchange"));
	});
}

function advance(ms: number): void
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
}

function host(): HTMLElement | null
{
	return document.querySelector<HTMLElement>("[data-transcript-selection-host]");
}

function bar(): HTMLElement | null
{
	return document.querySelector<HTMLElement>("[data-transcript-selection-bar]");
}

function labels(): string[]
{
	return [...(bar()?.querySelectorAll("button") ?? [])].map((button) => button.textContent);
}

function button(label: string): HTMLButtonElement
{
	const found = [...(bar()?.querySelectorAll("button") ?? [])].find((each) => each.textContent === label);
	if (found === undefined) throw new Error(`no ${label} button`);
	return found;
}

describe("transcript selection hook", () =>
{
	it("shows the bar 250ms after a selection of two or more characters, not before", () =>
	{
		renderBar();
		select("Hermit crabs");

		advance(249);
		const before = host();
		advance(1);

		expect(
			{
				before,
				labels: labels(),
			},
		).toStrictEqual(
			{
				before: null,
				labels: ["Start a side chat", "Quote"],
			},
		);
	});

	it("ignores a selection shorter than two trimmed characters", () =>
	{
		renderBar();
		select("Hermit", 1);
		advance(300);

		expect(host()).toBeNull();
	});

	it("ignores a selection outside the container", () =>
	{
		renderBar();
		const outside = document.createElement("p");
		outside.textContent = "Outside text";
		document.body.append(outside);
		select("Outside text");
		advance(300);
		outside.remove();

		expect(host()).toBeNull();
	});

	it("hides at once when the selection collapses", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		act(() =>
		{
			window.getSelection()?.collapseToStart();
			document.dispatchEvent(new Event("selectionchange"));
		});

		expect(host()).toBeNull();
	});

	it("waits for mouseup during a drag", () =>
	{
		renderBar();
		fireEvent.mouseDown(textNodeContaining("Hermit").parentElement ?? document.body);
		select("Hermit crabs");
		advance(500);
		const duringDrag = host();

		act(() =>
		{
			fireEvent.mouseUp(document.body);
		});

		expect(
			{
				duringDrag,
				shown: host() !== null,
			},
		).toStrictEqual(
			{
				duringDrag: null,
				shown: true,
			},
		);
	});

	it("suppresses the bar after a touch pointerdown inside the transcript", () =>
	{
		renderBar();
		fireEvent.pointerDown(
			textNodeContaining("Hermit").parentElement ?? document.body,
			{
				pointerType: "touch",
			},
		);
		select("Hermit crabs");
		advance(300);

		expect(host()).toBeNull();
	});

	it("ignores a touch pointerdown outside the transcript", () =>
	{
		renderBar();
		fireEvent.pointerDown(
			document.body,
			{
				pointerType: "touch",
			},
		);
		select("Hermit crabs");
		advance(300);

		expect(host() !== null).toBe(true);
	});

	it("hides at once when the selection changes mid-drag, and shows again on mouseup", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);
		const before = host() !== null;

		fireEvent.mouseDown(textNodeContaining("Tide pools form").parentElement ?? document.body);
		select("Tide pools");
		const duringDrag = host();
		fireEvent.mouseUp(
			document.body,
			{
				detail: 1,
			},
		);

		expect(
			{
				before,
				duringDrag,
				after: host() !== null,
			},
		).toStrictEqual(
			{
				before: true,
				duringDrag: null,
				after: true,
			},
		);
	});

	it("counts a right-button press as a drag, ends it only once no button is held, and keeps an unchanged bar", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);
		const before = host();

		fireEvent.mouseDown(
			textNodeContaining("Hermit").parentElement ?? document.body,
			{
				button: 2,
				buttons: 2,
			},
		);
		fireEvent.mouseUp(
			document.body,
			{
				button: 2,
				buttons: 0,
			},
		);
		const afterRightClick = host();

		fireEvent.mouseDown(
			textNodeContaining("Hermit").parentElement ?? document.body,
			{
				button: 2,
				buttons: 2,
			},
		);
		fireEvent.mouseUp(
			document.body,
			{
				button: 0,
				buttons: 2,
			},
		);
		select("Tide pools");
		const stillDragging = host();
		fireEvent.mouseUp(
			document.body,
			{
				button: 2,
				buttons: 0,
			},
		);

		expect(
			{
				same: before !== null && afterRightClick === before,
				stillDragging,
				after: host() !== null,
			},
		).toStrictEqual(
			{
				same: true,
				stillDragging: null,
				after: true,
			},
		);
	});

	it("hides on a mouseup that left the selection collapsed without a selectionchange", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		fireEvent.mouseDown(textNodeContaining("Hermit").parentElement ?? document.body);
		window.getSelection()?.collapseToStart();
		fireEvent.mouseUp(document.body);

		expect(host()).toBeNull();
	});

	it("re-debounces on mouseup when the settle timer fired mid-drag", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(100);
		fireEvent.mouseDown(textNodeContaining("Hermit").parentElement ?? document.body);
		advance(200);
		const duringDrag = host();

		fireEvent.mouseUp(document.body);
		const atMouseUp = host();
		advance(249);
		const before = host();
		advance(1);

		expect(
			{
				duringDrag,
				atMouseUp,
				before,
				after: host() !== null,
			},
		).toStrictEqual(
			{
				duringDrag: null,
				atMouseUp: null,
				before: null,
				after: true,
			},
		);
	});

	it("does not start a drag from a mousedown whose default was prevented", () =>
	{
		renderBar();
		const target = textNodeContaining("Hermit").parentElement ?? document.body;
		target.addEventListener("mousedown", (event) =>
		{
			event.preventDefault();
		});

		fireEvent.mouseDown(target);
		select("Hermit crabs");
		advance(250);

		expect(host() !== null).toBe(true);
	});
});

describe("useTranscriptSelection", () =>
{
	it("keeps the same selection object when an unchanged selection is re-read", () =>
	{
		const container = document.createElement("div");
		container.innerHTML = "<p>Hermit crabs live in tide pools.</p>";
		document.body.append(container);
		const {result} = renderHook(() =>
			useTranscriptSelection(
				{
					current: container,
				},
			),
		);

		select("Hermit crabs");
		advance(250);
		const first = result.current.selection;
		act(() =>
		{
			document.dispatchEvent(new Event("selectionchange"));
		});
		advance(250);
		const second = result.current.selection;
		container.remove();

		expect(
			{
				shown: first !== null,
				same: second === first,
			},
		).toStrictEqual(
			{
				shown: true,
				same: true,
			},
		);
	});
});

describe("transcript selection bar", () =>
{
	it("portals a fixed host centred above the first selection line", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		expect(
			{
				className: host()?.className,
				zIndex: host()?.style.zIndex,
				transform: host()?.style.transform,
				parent: host()?.closest("[data-testid=scroller]") ?? null,
			},
		).toStrictEqual(
			{
				className:
					"text-body text-primary break-words pointer-events-auto fixed left-0 top-0 will-change-transform isolate draggable-none",
				zIndex: "55",
				transform: "translate(500px, 337px) translateX(-50%)",
				parent: null,
			},
		);
	});

	it("clamps x inside the container and drops below when there is no room above", () =>
	{
		rangeRect =
		{
			left: 110,
			top: 60,
			width: 20,
			height: 19,
		};
		renderBar();
		select("Hermit crabs");
		advance(250);

		// x clamps to 100 + 165/2 + 12 = 194.5; y falls to bottom 79 + 8.
		expect(host()?.style.transform).toBe("translate(195px, 87px) translateX(-50%)");
	});

	it("renders upstream's bar, ghost buttons and separator", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);
		const separator = bar()?.querySelector(":scope > span[aria-hidden]");

		expect(
			{
				bar: bar()?.className,
				surface: bar()?.getAttribute("data-surface"),
				buttons: [...(bar()?.querySelectorAll("button") ?? [])].map((each) => (
				{
					type: each.type,
					className: each.className,
				})),
				separator: separator?.className,
			},
		).toStrictEqual(
			{
				bar: "rounded-r5 bg-surface-3 shadow-[var(--menu-shadow)] forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] group/split flex comfortable:rounded-r6",
				surface: "popover",
				buttons: [
					{
						type: "button",
						className:
							"cds-reset group/btn relative isolate inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-r5 px-2 text-body font-control-regular text-primary select-none outline-none focus-visible:shadow-focus comfortable:h-7 comfortable:px-3 comfortable:rounded-r6",
					},
					{
						type: "button",
						className:
							"cds-reset group/btn relative isolate inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-r5 px-2 text-body font-control-regular text-primary select-none outline-none focus-visible:shadow-focus comfortable:h-7 comfortable:px-3 comfortable:rounded-r6",
					},
				],
				separator:
					"w-px my-[7px] bg-alpha-2 shrink-0 transition-opacity motion-reduce:transition-none group-hover/split:opacity-0 group-focus-within/split:opacity-0",
			},
		);
	});

	it("keeps the selection on button mousedown", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		const prevented = !fireEvent.mouseDown(button("Quote"));

		expect(prevented).toBe(true);
	});

	it("says Send to side chat while the session's side chat is open", () =>
	{
		openSideChat(SESSION);
		renderBar();
		select("Hermit crabs");
		advance(250);

		expect(labels()).toStrictEqual(["Send to side chat", "Quote"]);
	});

	it("offers only Quote without a side chat", () =>
	{
		renderBar(false);
		select("Hermit crabs");
		advance(250);

		expect(
			{
				labels: labels(),
				separator: bar()?.querySelector(":scope > span[aria-hidden]") ?? null,
			},
		).toStrictEqual(
			{
				labels: ["Quote"],
				separator: null,
			},
		);
	});

	it("offers only the side chat without a composer", () =>
	{
		unregister();
		renderBar();
		select("Hermit crabs");
		advance(250);

		expect(labels()).toStrictEqual(["Start a side chat"]);
	});

	it("with inline reply off, Quote attaches the trimmed selection as an Excerpt, focuses the composer and clears the selection", () =>
	{
		renderBar(true, false);
		select("Hermit crabs ");
		advance(250);

		fireEvent.click(button("Quote"));

		expect(
			{
				chips: getContextChips(SESSION).map(({id: _id, ...chip}) => chip),
				focused: focus.mock.calls.length,
				ranges: window.getSelection()?.rangeCount,
				host: host(),
			},
		).toStrictEqual(
			{
				chips: [
					{
						kind: "excerpt",
						text: "Hermit crabs",
					},
				],
				focused: 1,
				ranges: 0,
				host: null,
			},
		);
	});

	it("Quote truncates a long selection to 1500 characters", () =>
	{
		const long = "x".repeat(1600);
		render(<HarnessWithText text={long} />);
		select(long);
		advance(250);

		fireEvent.click(button("Quote"));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add to prompt",
				},
			),
		);

		expect(getContextChips(SESSION).map(({text}) => text)).toStrictEqual([`${"x".repeat(1500)}…`]);
	});

	it("Start a side chat opens the side chat and clears the selection", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		fireEvent.click(button("Start a side chat"));

		expect(
			{
				open: getSideChat(SESSION).open,
				excerpts: getSideChat(SESSION).excerpts.map(({text}) => text),
				ranges: window.getSelection()?.rangeCount,
			},
		).toStrictEqual(
			{
				open: true,
				excerpts: ["Hermit crabs"],
				ranges: 0,
			},
		);
	});

	it("hides once a scroll moves the selection more than 100px", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		rangeRect =
		{
			...rangeRect,
			top: rangeRect.top - 100,
		};
		act(() =>
		{
			document.dispatchEvent(new Event("scroll"));
		});
		const within = host()?.style.transform;
		rangeRect =
		{
			...rangeRect,
			top: rangeRect.top - 1,
		};
		act(() =>
		{
			document.dispatchEvent(new Event("scroll"));
		});

		expect(
			{
				within,
				after: host(),
			},
		).toStrictEqual(
			{
				within: "translate(500px, 237px) translateX(-50%)",
				after: null,
			},
		);
	});

	it("stays mounted with visibility hidden while a menu is open", async () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);

		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		await act(async () =>
		{
			document.body.append(menu);
			await Promise.resolve();
		});
		const whileOpen =
		{
			bar: bar()?.style.visibility,
			host: host()?.style.visibility,
			transform: host()?.style.transform,
		};
		await act(async () =>
		{
			menu.remove();
			await Promise.resolve();
		});

		expect(
			{
				whileOpen,
				after: bar()?.style.visibility,
			},
		).toStrictEqual(
			{
				whileOpen:
				{
					bar: "hidden",
					host: "",
					transform: "translate(500px, 337px) translateX(-50%)",
				},
				after: "",
			},
		);
	});
});

function HarnessWithText({text}: {text: string})
{
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			data-testid="scroller"
			style={
			{
				overflowY: "auto",
			}}
		>
			<div ref={containerRef}>
				<p data-transcript-entry-index="0">{text}</p>
			</div>
			<TranscriptSelectionBar sessionId={SESSION} containerRef={containerRef} sideChatAvailable={false} />
		</div>
	);
}

function selectAcross(fromText: string, toText: string): void
{
	const from = textNodeContaining(fromText);
	const to = textNodeContaining(toText);
	const range = document.createRange();
	range.setStart(from, from.data.indexOf(fromText));
	range.setEnd(to, to.data.indexOf(toText) + toText.length);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	act(() =>
	{
		document.dispatchEvent(new Event("selectionchange"));
	});
}

function card(): HTMLElement | null
{
	return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Comment on selection"]');
}

function replyBox(): HTMLTextAreaElement
{
	return screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Reply",
		},
	);
}

function pressEnter(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent
{
	const event = new KeyboardEvent(
		"keydown",
		{
			key: "Enter",
			bubbles: true,
			cancelable: true,
			...init,
		},
	);
	act(() =>
	{
		target.dispatchEvent(event);
	});
	return event;
}

function openCard(text = "Hermit crabs"): void
{
	renderBar();
	select(text);
	advance(250);
	fireEvent.click(button("Quote"));
}

describe("transcript selection bar, inline reply (__gb__554343014)", () =>
{
	it("is on locally", () =>
	{
		expect(INLINE_REPLY_ENABLED).toBe(true);
	});

	it("gives Reply aria-keyshortcuts=Enter only with inline reply on", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);
		const on = button("Quote").getAttribute("aria-keyshortcuts");
		cleanup();
		renderBar(true, false);
		select("Hermit crabs");
		advance(250);

		expect(
			{
				on,
				off: button("Quote").getAttribute("aria-keyshortcuts"),
			},
		).toStrictEqual(
			{
				on: "Enter",
				off: null,
			},
		);
	});

	it("hides Reply when the selection spans two entries", () =>
	{
		renderBar();
		selectAcross("tide pools.", "Tide pools");
		advance(250);

		expect(labels()).toStrictEqual(["Start a side chat"]);
	});

	it("opens the reply card on a plain Enter while the bar shows, hiding the bar and clearing the selection", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);
		const event = pressEnter(document.body);

		expect(
			{
				prevented: event.defaultPrevented,
				quote: card()?.querySelector("blockquote")?.textContent,
				placeholder: replyBox().placeholder,
				save: screen
					.getByRole(
						"button",
						{
							name: "Add to prompt",
						},
					)
					.getAttribute("aria-keyshortcuts"),
				bar: host(),
				ranges: window.getSelection()?.rangeCount,
			},
		).toStrictEqual(
			{
				prevented: true,
				quote: "Hermit crabs",
				placeholder: "Reply to Claude",
				save: "Enter",
				bar: null,
				ranges: 0,
			},
		);
	});

	it("ignores Enter with a modifier, on repeat, or typed in a field", () =>
	{
		renderBar();
		select("Hermit crabs");
		advance(250);
		const field = document.createElement("textarea");
		document.body.append(field);
		const events = [
			pressEnter(
				document.body,
				{
					metaKey: true,
				},
			),
			pressEnter(
				document.body,
				{
					shiftKey: true,
				},
			),
			pressEnter(
				document.body,
				{
					repeat: true,
				},
			),
			pressEnter(field),
		];
		field.remove();

		expect(
			{
				prevented: events.map((event) => event.defaultPrevented),
				card: card(),
			},
		).toStrictEqual(
			{
				prevented: [false, false, false, false],
				card: null,
			},
		);
	});

	it("Add to prompt with a blank comment attaches a plain Excerpt, closes the card and focuses the composer", () =>
	{
		openCard();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add to prompt",
				},
			),
		);

		expect(
			{
				chips: getContextChips(SESSION).map(({id: _id, ...chip}) => chip),
				card: card(),
				focused: focus.mock.calls.length > 0,
			},
		).toStrictEqual(
			{
				chips: [
					{
						kind: "excerpt",
						text: "Hermit crabs",
					},
				],
				card: null,
				focused: true,
			},
		);
	});

	it("Enter with a comment stages a reply chip", () =>
	{
		openCard();
		fireEvent.change(
			replyBox(),
			{
				target:
				{
					value: "Why tide pools?",
				},
			},
		);
		pressEnter(replyBox());

		expect(
			{
				chips: getContextChips(SESSION).map(({id: _id, ...chip}) => chip),
				card: card(),
			},
		).toStrictEqual(
			{
				chips: [
					{
						kind: "excerpt",
						text: "Hermit crabs",
						comment: "Why tide pools?",
					},
				],
				card: null,
			},
		);
	});

	it("refuses the 100th staged reply with upstream's cap toast and keeps the card", () =>
	{
		for (let index = 0; index < MAX_STAGED_REPLIES; index++)
			attachContext(
				SESSION,
				{
					kind: "excerpt",
					text: `q${index}`,
					comment: "c",
				},
			);
		openCard();
		fireEvent.change(
			replyBox(),
			{
				target:
				{
					value: "one more",
				},
			},
		);
		pressEnter(replyBox());

		expect(
			{
				toasts: toast.mock.calls.map(([options]) => options.message),
				open: card() !== null,
			},
		).toStrictEqual(
			{
				toasts: [REPLY_CAP_MESSAGE],
				open: true,
			},
		);
	});

	it("⌘⏎ with a comment sends the reply prompt and closes the card; a blank ⌘⏎ does nothing", () =>
	{
		openCard();
		pressEnter(
			replyBox(),
			{
				metaKey: true,
			},
		);
		const blankSends = send.mock.calls.length;
		fireEvent.change(
			replyBox(),
			{
				target:
				{
					value: " Why? ",
				},
			},
		);
		pressEnter(
			replyBox(),
			{
				metaKey: true,
			},
		);

		expect(
			{
				blankSends,
				sends: send.mock.calls,
				card: card(),
				chips: getContextChips(SESSION),
			},
		).toStrictEqual(
			{
				blankSends: 0,
				sends: [["<!-- reply -->\n> Hermit crabs\n\nWhy?"]],
				card: null,
				chips: [],
			},
		);
	});

	it("toasts instead of adding when the composer went away", () =>
	{
		openCard();
		unregister();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add to prompt",
				},
			),
		);

		expect(
			{
				toasts: toast.mock.calls.map(([options]) => options.message),
				open: card() !== null,
			},
		).toStrictEqual(
			{
				toasts: ["Can\u2019t add to your prompt until the message box is back."],
				open: true,
			},
		);
	});
});
