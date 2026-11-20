// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	armStillClickRepin,
	FOLLOW_REPIN_DELAY_MS,
	keyReleasesPin,
	pressOrKeyReleasesPin,
	pressReleasesPin,
	secondaryPressKeepsFollow,
} from "../src/lib/transcript-follow-pin";

function element(html: string, selector: string): Element
{
	const host = document.createElement("div");
	host.innerHTML = html;
	document.body.append(host);
	const found = host.querySelector(selector);
	if (found === null) throw new Error(`No ${selector} in ${html}`);
	return found;
}

afterEach(() =>
{
	document.body.replaceChildren();
});

describe("keyReleasesPin (upstream ske keydown)", () =>
{
	it("releases on Enter or Space on a plain control only", () =>
	{
		const button = element("<button>Toggle</button>", "button");
		expect(
			{
				enter: keyReleasesPin(
					{
						key: "Enter",
						target: button,
					},
				),
				space: keyReleasesPin(
					{
						key: " ",
						target: button,
					},
				),
				letter: keyReleasesPin(
					{
						key: "a",
						target: button,
					},
				),
				textarea: keyReleasesPin(
					{
						key: "Enter",
						target: element("<textarea></textarea>", "textarea"),
					},
				),
				plaintextOnly: keyReleasesPin(
					{
						key: "Enter",
						target: element('<div contenteditable="plaintext-only">x</div>', "div"),
					},
				),
				keepsPin: keyReleasesPin(
					{
						key: "Enter",
						target: element("<div data-transcript-keeps-pin><span>Agent</span></div>", "span"),
					},
				),
			},
		).toStrictEqual(
			{
				enter: true,
				space: true,
				letter: false,
				textarea: false,
				plaintextOnly: false,
				keepsPin: false,
			},
		);
	});
});

describe("pressReleasesPin (upstream ske pointerdown + O7)", () =>
{
	it("keeps the pin for navigating steps, not-rows parts and presses below the bottom overlay", () =>
	{
		const span = element("<p><span>text</span></p>", "span");
		expect(
			{
				plain: pressReleasesPin(
					{
						target: span,
						clientY: 100,
					},
				),
				stepNavigates: pressReleasesPin(
					{
						target: element("<button data-transcript-step-navigates><span>x</span></button>", "span"),
					},
				),
				notRows: pressReleasesPin(
					{
						target: element("<div data-transcript-not-rows><i>x</i></div>", "i"),
					},
				),
				belowOverlay: pressReleasesPin(
					{
						target: span,
						clientY: 900,
					},
					800,
				),
				aboveOverlay: pressReleasesPin(
					{
						target: span,
						clientY: 700,
					},
					800,
				),
			},
		).toStrictEqual(
			{
				plain: true,
				stepNavigates: false,
				notRows: false,
				belowOverlay: false,
				aboveOverlay: true,
			},
		);
	});
});

describe("pressOrKeyReleasesPin (upstream _9)", () =>
{
	it("releases on any press and on Enter/Space outside fields, never on a keep target", () =>
	{
		const span = element("<span>row</span>", "span");
		const press = (target: Element) =>
		{
			const event = new Event("pointerdown");
			Object.defineProperty(
				event,
				"target",
				{
					value: target,
				},
			);
			return pressOrKeyReleasesPin(event);
		};
		const key = (target: Element, name: string) =>
		{
			const event = new KeyboardEvent(
				"keydown",
				{
					key: name,
				},
			);
			Object.defineProperty(
				event,
				"target",
				{
					value: target,
				},
			);
			return pressOrKeyReleasesPin(event);
		};
		expect(
			{
				press: press(span),
				pressKeep: press(element("<div data-transcript-keeps-pin><b>x</b></div>", "b")),
				enter: key(span, "Enter"),
				letter: key(span, "a"),
				enterInTextarea: key(element("<textarea></textarea>", "textarea"), "Enter"),
			},
		).toStrictEqual(
			{
				press: true,
				pressKeep: false,
				enter: true,
				letter: false,
				enterInTextarea: false,
			},
		);
	});
});

describe("secondaryPressKeepsFollow (upstream jwe)", () =>
{
	it("keeps following on plain text and card panels, releases on an interactive control", () =>
	{
		const host = document.createElement("div");
		host.innerHTML =
			'<div data-feed><p><b data-id="text">x</b></p><button><span data-id="button">x</span></button><div data-card-panel><button><span data-id="panel-button">x</span></button><span data-id="panel">x</span></div><div data-transcript-step-navigates><span data-id="navigates">x</span></div><span data-unmodified-lines><i data-id="unmodified">x</i></span></div>';
		document.body.append(host);
		const feed = host.querySelector("[data-feed]")!;
		const keeps = (id: string) =>
		{
			const target = host.querySelector(`[data-id="${id}"]`)!;
			const path: EventTarget[] = [];
			for (let node: Element | null = target; node !== null; node = node.parentElement) path.push(node);
			path.push(document, window);
			return secondaryPressKeepsFollow(
				{
					target,
					currentTarget: feed,
					composedPath: () => path,
				},
			);
		};
		expect(
			{
				text: keeps("text"),
				button: keeps("button"),
				panel: keeps("panel"),
				panelButton: keeps("panel-button"),
				navigates: keeps("navigates"),
				unmodified: keeps("unmodified"),
			},
		).toStrictEqual(
			{
				text: true,
				button: false,
				panel: true,
				panelButton: false,
				navigates: true,
				unmodified: false,
			},
		);
	});
});

describe("armStillClickRepin (upstream k7)", () =>
{
	let scroller: HTMLElement;
	let paragraph: HTMLElement;
	let top: number;
	const repin = vi.fn<() => void>();

	beforeEach(() =>
	{
		vi.useFakeTimers();
		repin.mockReset();
		top = 900;
		scroller = document.createElement("div");
		scroller.innerHTML =
			'<p>Plain text</p><button><span>Toggle</span></button><div role="button">x</div><div data-transcript-click-acts><i>y</i></div><p id="other">Other</p>';
		document.body.append(scroller);
		paragraph = scroller.querySelector("p")!;
	});

	afterEach(() =>
	{
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function press(target: Element, {button = 0, pinned = true} = {}): void
	{
		armStillClickRepin(
			{
				button,
				target,
				composedPath: () => [target],
			},
			{
				isPinned: () => pinned,
				scroller,
				scrollTop: () => top,
				repin,
			},
		);
	}

	function click(target: Element): void
	{
		target.dispatchEvent(
			new MouseEvent(
				"click",
				{
					bubbles: true,
				},
			),
		);
	}

	it("re-pins 500ms after a still click on plain text, not at 499ms", () =>
	{
		press(paragraph);
		click(paragraph);
		vi.advanceTimersByTime(FOLLOW_REPIN_DELAY_MS - 1);
		const early = repin.mock.calls.length;
		vi.advanceTimersByTime(1);
		expect(
			{
				early,
				late: repin.mock.calls.length,
			},
		).toStrictEqual(
			{
				early: 0,
				late: 1,
			},
		);
	});

	it("keeps the pin released when the scroll moved, a selection was made, or the click landed elsewhere", () =>
	{
		press(paragraph);
		click(paragraph);
		top = 800;
		vi.advanceTimersByTime(FOLLOW_REPIN_DELAY_MS);
		const scrolled = repin.mock.calls.length;

		top = 900;
		vi.spyOn(window, "getSelection").mockReturnValue(
			{
				isCollapsed: false,
			} as Selection,
		);
		press(paragraph);
		click(paragraph);
		vi.advanceTimersByTime(FOLLOW_REPIN_DELAY_MS);
		const selected = repin.mock.calls.length;
		vi.restoreAllMocks();

		press(paragraph);
		click(scroller.querySelector("#other")!);
		vi.advanceTimersByTime(FOLLOW_REPIN_DELAY_MS);

		expect(
			{
				scrolled,
				selected,
				elsewhere: repin.mock.calls.length,
			},
		).toStrictEqual(
			{
				scrolled: 0,
				selected: 0,
				elsewhere: 0,
			},
		);
	});

	it("never arms for a secondary button, an interactive target, or an unpinned list", () =>
	{
		const targets = [
			scroller.querySelector("button span")!,
			scroller.querySelector('[role="button"]')!,
			scroller.querySelector("[data-transcript-click-acts] i")!,
		];
		press(
			paragraph,
			{
				button: 2,
			},
		);
		click(paragraph);
		press(
			paragraph,
			{
				pinned: false,
			},
		);
		click(paragraph);
		for (const target of targets)
		{
			press(target);
			click(target);
		}
		vi.advanceTimersByTime(FOLLOW_REPIN_DELAY_MS);
		expect(repin.mock.calls.length).toBe(0);
	});

	it("drops a pending re-pin when another press lands in the scroller", () =>
	{
		press(paragraph);
		click(paragraph);
		vi.advanceTimersByTime(100);
		paragraph.dispatchEvent(
			new Event(
				"pointerdown",
				{
					bubbles: true,
					composed: true,
				},
			),
		);
		vi.advanceTimersByTime(FOLLOW_REPIN_DELAY_MS);
		expect(repin.mock.calls.length).toBe(0);
	});
});
