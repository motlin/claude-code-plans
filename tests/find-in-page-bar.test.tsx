// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FindInPage} from "../src/components/find-in-page-bar";
import {cdsButtonClass} from "../src/components/ui/cds-button";
import {CDS_ICON_ONLY_DISABLED} from "../src/components/ui/cds-button-disabled";
import {registerTruncatingLabel} from "../src/lib/find-in-page/label-shift";
import {endFind, registerFindProvider} from "../src/lib/find-in-page/store";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const BAR_CLASS =
	"rounded-card bg-surface-2 shadow-panel-sm-cds forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] fixed end-4 top-14 flex max-w-[calc(100%-var(--spacing)*8)] items-center gap-1 py-1 ps-2 pe-1";
const INPUT_CLASS =
	"w-48 min-w-0 border-0 bg-transparent outline-none text-body text-primary placeholder:text-ink-muted hide-focus-ring";
const STATUS_CLASS = "whitespace-nowrap text-footnote text-muted-as-secondary tabular-nums";
const BUTTON_CLASS = `${cdsButtonClass("ghost")} aspect-square w-control !px-0 ${CDS_ICON_ONLY_DISABLED}`;

/** A page with three "e"s outside the bar, and a provider so the bar is on offer. */
function setup():
{
	opener: HTMLButtonElement;
	off: () => void;
}
{
	document.body.innerHTML = '<main><button id="opener">open</button><p>one</p><p>three</p></main>';
	const off = registerFindProvider(
		{
			surface: "test",
			count: () => 0,
			show: () => undefined,
			clear: () => undefined,
			getScopeEl: () => null,
		},
	);
	render(<FindInPage />);
	const opener = document.getElementById("opener") as HTMLButtonElement;
	opener.focus();
	return {
		opener,
		off,
	};
}

function pressFind(init: KeyboardEventInit = {}): KeyboardEvent
{
	const event = new KeyboardEvent(
		"keydown",
		{
			key: "f",
			metaKey: true,
			bubbles: true,
			cancelable: true,
			...init,
		},
	);
	act(() =>
	{
		window.dispatchEvent(event);
	});
	return event;
}

function bar(): HTMLElement | null
{
	return document.querySelector("[data-find-in-page-bar]");
}

function input(): HTMLInputElement
{
	const element = document.querySelector<HTMLInputElement>("[data-find-in-page-bar] input");
	if (element === null) throw new Error("the find bar is closed");
	return element;
}

function status(): string
{
	return document.querySelector('[data-find-in-page-bar] [role="status"]')?.textContent ?? "missing";
}

function buttons(): Record<string, boolean>
{
	return Object.fromEntries(
		[...document.querySelectorAll<HTMLButtonElement>("[data-find-in-page-bar] button")].map((button) => [
			button.getAttribute("aria-label"),
			button.disabled,
		]),
	);
}

function type(value: string): void
{
	fireEvent.change(
		input(),
		{
			target:
			{
				value,
			},
		},
	);
	act(() =>
	{
		vi.advanceTimersByTime(120);
	});
}

function key(target: EventTarget, init: KeyboardEventInit): void
{
	act(() =>
	{
		target.dispatchEvent(
			new KeyboardEvent(
				"keydown",
				{
					bubbles: true,
					cancelable: true,
					...init,
				},
			),
		);
	});
}

describe("FindInPage", () =>
{
	const offs: (() => void)[] = [];

	beforeEach(() =>
	{
		vi.useFakeTimers();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		// jsdom lays nothing out and has no Range rects; this file's ranges all count as laid out.
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
	});

	afterEach(() =>
	{
		Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
		cleanup();
		for (const off of offs.splice(0)) off();
		endFind();
		vi.useRealTimers();
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("renders upstream's markup, focused, with an empty status and only Close enabled", () =>
	{
		offs.push(setup().off);
		const event = pressFind();
		const root = bar();
		expect(
			{
				prevented: event.defaultPrevented,
				role: root?.getAttribute("role"),
				tabIndex: root?.getAttribute("tabindex"),
				scope: root?.getAttribute("data-find-provider-scope"),
				cds: root?.getAttribute("data-cds"),
				surface: root?.getAttribute("data-surface"),
				overlay: root?.getAttribute("data-find-overlay"),
				escapeOwner: root?.getAttribute("data-escape-owner"),
				ownsBareDigits: root?.getAttribute("data-owns-bare-digits"),
				className: root?.className,
				zIndex: root?.style.zIndex,
				pageBg: root?.style.getPropertyValue("--cds-page-bg"),
				portaled: root?.parentElement?.parentElement === document.body,
				input:
				{
					className: input().className,
					label: input().getAttribute("aria-label"),
					placeholder: input().placeholder,
					spellcheck: input().getAttribute("spellcheck"),
					autocomplete: input().getAttribute("autocomplete"),
					focused: document.activeElement === input(),
				},
				status:
				{
					text: status(),
					className: document.querySelector('[role="status"]')?.className,
					atomic: document.querySelector('[role="status"]')?.getAttribute("aria-atomic"),
				},
				buttonClasses: [...document.querySelectorAll("[data-find-in-page-bar] button")].map((b) => b.className),
				buttonCds: [...document.querySelectorAll("[data-find-in-page-bar] button")].map((b) => [
					b.getAttribute("data-cds"),
					b.getAttribute("data-cds-icon-only"),
					b.getAttribute("data-cds-ghost"),
					b.querySelector<SVGElement>("[data-cds=Icon]")?.style.fontSize,
				]),
				buttons: buttons(),
			},
		).toStrictEqual(
			{
				prevented: true,
				role: "search",
				tabIndex: "-1",
				scope: "",
				cds: "Surface",
				surface: "panel",
				overlay: "",
				escapeOwner: "",
				ownsBareDigits: "",
				className: BAR_CLASS,
				zIndex: "9000",
				pageBg: "var(--color-surface-2)",
				portaled: true,
				input:
				{
					className: INPUT_CLASS,
					label: "Find",
					placeholder: "Find…",
					spellcheck: "false",
					autocomplete: "off",
					focused: true,
				},
				status:
				{
					text: "",
					className: STATUS_CLASS,
					atomic: "true",
				},
				buttonClasses: [BUTTON_CLASS, BUTTON_CLASS, BUTTON_CLASS],
				buttonCds: [
					["Button", "", "", "calc(1.25rem * var(--cds-rem-scale, 1))"],
					["Button", "", "", "calc(1.25rem * var(--cds-rem-scale, 1))"],
					["Button", "", "", "calc(1.25rem * var(--cds-rem-scale, 1))"],
				],
				buttons:
				{
					"Go to previous match": true,
					"Go to next match": true,
					"Close find bar": false,
				},
			},
		);
	});

	it("searches 120ms after typing, steps with wrap and reports 0/0 with no matches", () =>
	{
		offs.push(setup().off);
		pressFind();
		fireEvent.compositionStart(input());
		fireEvent.change(
			input(),
			{
				target:
				{
					value: "o",
				},
			},
		);
		act(() =>
		{
			vi.advanceTimersByTime(300);
		});
		const composing = status();
		fireEvent.compositionEnd(input());
		fireEvent.change(
			input(),
			{
				target:
				{
					value: "e",
				},
			},
		);
		const beforeDebounce = status();
		act(() =>
		{
			vi.advanceTimersByTime(120);
		});
		const found = status();
		key(
			input(),
			{
				key: "Enter",
			},
		);
		const next = status();
		key(
			input(),
			{
				key: "Enter",
			},
		);
		key(
			input(),
			{
				key: "Enter",
			},
		);
		const wrapped = status();
		key(
			input(),
			{
				key: "Enter",
				shiftKey: true,
			},
		);
		const back = status();
		key(
			document.body,
			{
				key: "g",
				metaKey: true,
			},
		);
		const commandG = status();
		key(
			document.body,
			{
				key: "F3",
				shiftKey: true,
			},
		);
		const shiftF3 = status();
		const foundButtons = buttons();
		type("zzqxq");
		expect(
			{
				composing,
				beforeDebounce,
				found,
				next,
				wrapped,
				back,
				commandG,
				shiftF3,
				foundButtons,
				missing: status(),
				missingButtons: buttons(),
			},
		).toStrictEqual(
			{
				// "one" and "three" twice: "open" sits inside the opener button and counts too.
				composing: "",
				beforeDebounce: "",
				found: "1/4",
				next: "2/4",
				wrapped: "4/4",
				back: "3/4",
				commandG: "4/4",
				shiftF3: "3/4",
				foundButtons:
				{
					"Go to previous match": false,
					"Go to next match": false,
					"Close find bar": false,
				},
				missing: "0/0",
				missingButtons:
				{
					"Go to previous match": true,
					"Go to next match": true,
					"Close find bar": false,
				},
			},
		);
	});

	it("closes on Escape and returns focus to the opener; reopens empty", () =>
	{
		const {opener, off} = setup();
		offs.push(off);
		pressFind();
		type("e");
		key(
			input(),
			{
				key: "Escape",
			},
		);
		const closed = bar() === null;
		const refocused = document.activeElement === opener;
		pressFind();
		expect(
			{
				closed,
				refocused,
				reopenedQuery: input().value,
				reopenedStatus: status(),
			},
		).toStrictEqual(
			{
				closed: true,
				refocused: true,
				reopenedQuery: "",
				reopenedStatus: "",
			},
		);
	});

	it("refocuses and selects the input on ⌘F while open", () =>
	{
		const {opener, off} = setup();
		offs.push(off);
		pressFind();
		type("one");
		opener.focus();
		pressFind();
		expect(
			{
				focused: document.activeElement === input(),
				selection: [input().selectionStart, input().selectionEnd],
			},
		).toStrictEqual(
			{
				focused: true,
				selection: [0, 3],
			},
		);
	});

	it("closes without moving focus when a modal dialog opens", async () =>
	{
		const {off} = setup();
		offs.push(off);
		pressFind();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		dialog.tabIndex = -1;
		// The overlay observer reports in a microtask.
		await act(async () =>
		{
			document.body.append(dialog);
			dialog.focus();
			await Promise.resolve();
		});
		expect(
			{
				closed: bar() === null,
				focusInDialog: document.activeElement === dialog,
			},
		).toStrictEqual(
			{
				closed: true,
				focusInDialog: true,
			},
		);
	});

	it("stays closed without a provider, after an earlier handler took ⌘F, or under a modal dialog", () =>
	{
		document.body.innerHTML = "<p>text</p>";
		render(<FindInPage />);
		const noProvider = pressFind();
		const noProviderOpened = bar() !== null;
		offs.push(
			registerFindProvider(
				{
					surface: "test",
					count: () => 0,
					show: () => undefined,
					clear: () => undefined,
					getScopeEl: () => null,
				},
			),
		);
		const takeFind = (event: KeyboardEvent) =>
		{
			event.preventDefault();
		};
		window.addEventListener(
			"keydown",
			takeFind,
			{
				capture: true,
			},
		);
		pressFind();
		const takenOpened = bar() !== null;
		window.removeEventListener(
			"keydown",
			takeFind,
			{
				capture: true,
			},
		);
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		document.body.append(dialog);
		const underDialog = pressFind();
		const dialogOpened = bar() !== null;
		dialog.remove();
		const ctrlOnMac = pressFind(
			{
				metaKey: false,
				ctrlKey: true,
			},
		);
		expect(
			{
				noProvider: [noProvider.defaultPrevented, noProviderOpened],
				takenOpened,
				underDialog: [underDialog.defaultPrevented, dialogOpened],
				ctrlOnMac: [ctrlOnMac.defaultPrevented, bar() !== null],
			},
		).toStrictEqual(
			{
				noProvider: [false, false],
				takenOpened: false,
				underDialog: [false, false],
				ctrlOnMac: [false, false],
			},
		);
	});

	it("shifts a clipped label so its active match shows, resets it when the match moves on or find closes, and scrolls the label box", () =>
	{
		offs.push(setup().off);
		document.body.insertAdjacentHTML(
			"afterbegin",
			'<nav><span id="box"><span id="text">A long title ending in needle</span></span></nav><p>needle in prose</p>',
		);
		const box = document.getElementById("box")!;
		const text = document.getElementById("text")!;
		box.getBoundingClientRect = () => new DOMRect(0, 0, 200, 20);
		// The label's match sits under its end fade; every other range is laid out at the origin.
		Range.prototype.getBoundingClientRect = function (this: Range)
		{
			return text.contains(this.startContainer) ? new DOMRect(190, 0, 20, 20) : new DOMRect(0, 0, 10, 10);
		};
		offs.push(
			registerTruncatingLabel(
				{
					box,
					text,
					endBandPx: () => 24,
				},
			),
		);
		const scrolled: Element[] = [];
		Object.defineProperty(
			HTMLElement.prototype,
			"scrollIntoView",
			{
				configurable: true,
				value(this: HTMLElement)
				{
					scrolled.push(this);
				},
			},
		);
		offs.push(() =>
		{
			Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
		});
		pressFind();
		type("needle");
		const onLabel = text.style.transform;
		key(
			input(),
			{
				key: "Enter",
			},
		);
		const onProse = text.style.transform;
		key(
			input(),
			{
				key: "Enter",
			},
		);
		const backOnLabel = text.style.transform;
		key(
			input(),
			{
				key: "Escape",
			},
		);
		expect(
			{
				onLabel,
				onProse,
				backOnLabel,
				closed: text.style.transform,
				firstScroll: scrolled[0]?.id,
			},
		).toStrictEqual(
			{
				onLabel: "translateX(-162px)",
				onProse: "",
				backOnLabel: "translateX(-162px)",
				closed: "",
				firstScroll: "box",
			},
		);
	});
});
