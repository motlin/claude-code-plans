// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {StickyPromptOverlay, type StickyPromptCandidate} from "../src/components/sticky-prompt-overlay";

interface Box
{
	top: number;
	bottom: number;
	paddingBottom?: number;
}

class FakeResizeObserver
{
	static callbacks: Array<() => void> = [];
	constructor(callback: () => void)
	{
		FakeResizeObserver.callbacks.push(callback);
	}
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

let frames: FrameRequestCallback[] = [];
function flushFrames()
{
	act(() =>
	{
		const pending = frames;
		frames = [];
		for (const frame of pending) frame(0);
	});
}

function rect(top: number, bottom: number): DOMRect
{
	return {
		top,
		bottom,
		height: bottom - top,
		left: 0,
		right: 800,
		width: 800,
		x: 0,
		y: top,
		toJSON: () => ({}),
	};
}

/** A scroller at viewport top 0 holding transcript rows at the given boxes (keyed by entry index). */
function makeScroller(
	boxes: Map<number, Box>,
	metrics =
	{
		scrollHeight: 4000,
		scrollTop: 1000,
		clientHeight: 600,
	},
)
{
	const scroller = document.createElement("div");
	const content = document.createElement("div");
	scroller.append(content);
	const rows = new Map<number, HTMLElement>();
	const sync = () =>
	{
		for (const [index, box] of boxes)
		{
			let row = rows.get(index);
			if (!row)
			{
				row = document.createElement("div");
				row.dataset["transcriptEntryIndex"] = String(index);
				rows.set(index, row);
			}
			row.style.paddingBottom = `${box.paddingBottom ?? 0}px`;
			row.getBoundingClientRect = () => rect(box.top, box.bottom);
		}
		content.replaceChildren(
			...[...rows.entries()]
				.filter(([index]) => boxes.has(index))
				.toSorted(([a], [b]) => a - b)
				.map(([, row]) => row),
		);
	};
	sync();
	scroller.getBoundingClientRect = () => rect(0, 600);
	Object.defineProperty(
		scroller,
		"offsetParent",
		{
			configurable: true,
			get: () => document.body,
		},
	);
	Object.defineProperty(
		scroller,
		"scrollHeight",
		{
			configurable: true,
			get: () => metrics.scrollHeight,
		},
	);
	Object.defineProperty(
		scroller,
		"clientHeight",
		{
			configurable: true,
			get: () => metrics.clientHeight,
		},
	);
	Object.defineProperty(
		scroller,
		"scrollTop",
		{
			configurable: true,
			get: () => metrics.scrollTop,
		},
	);
	const scrollBy = vi.fn<(options: ScrollToOptions) => void>();
	Object.defineProperty(
		scroller,
		"scrollBy",
		{
			configurable: true,
			value: scrollBy,
		},
	);
	document.body.append(scroller);
	return {
		scroller,
		scrollBy,
		sync,
		metrics,
	};
}

const CANDIDATES: StickyPromptCandidate[] = [
	{
		key: "line-0",
		index: 0,
		text: "first prompt",
	},
	{
		key: "line-4",
		index: 4,
		text: "second prompt",
	},
];

function renderOverlay(
	scroller: Element,
	candidates = CANDIDATES,
	scrollToEntry = vi.fn<(index: number, behavior: ScrollBehavior) => void>(),
	scrollKey = "fabricated-session",
)
{
	const host = document.createElement("div");
	host.dataset["transcriptOverlayHost"] = "";
	document.body.append(host);
	const utils = render(
		<StickyPromptOverlay
			candidates={candidates}
			scroller={() => scroller}
			scrollKey={scrollKey}
			scrollToEntry={scrollToEntry}
		/>,
		{
			container: host,
		},
	);
	return {
		...utils,
		host,
		scrollToEntry,
	};
}

const button = () =>
	screen.queryByRole(
		"button",
		{
			name: "Scroll to your message",
		},
	);

describe("StickyPromptOverlay (upstream $w)", () =>
{
	beforeEach(() =>
	{
		frames = [];
		FakeResizeObserver.callbacks = [];
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
		vi.stubGlobal("cancelAnimationFrame", () => {});
	});
	afterEach(() =>
	{
		cleanup();
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("shows a prompt that scrolled fully past the line, with upstream's markup", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: -200,
						bottom: -20,
					},
				],
				[
					4,
					{
						top: 300,
						bottom: 400,
					},
				],
			]),
		);
		const {container} = renderOverlay(scroller);
		expect(container.innerHTML).toBe(
			'<div class="absolute top-0 inset-x-0 z-[12] pointer-events-none draggable-none">' +
				'<div class="epitaxy-transcript-typography chat-column flex justify-start">' +
				'<button type="button" aria-label="Scroll to your message" class="epitaxy-sticky-prompt-clip hide-focus-ring pointer-events-auto max-w-[85%] min-w-0">' +
				'<span class="epitaxy-sticky-prompt-bubble">first prompt</span></button></div></div>',
		);
	});

	it("hides while the latest passed prompt still straddles the line, even past an earlier one", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: -500,
						bottom: -300,
					},
				],
				[
					4,
					{
						top: -100,
						bottom: 40,
					},
				],
			]),
		);
		renderOverlay(scroller);
		expect(button()).toBeNull();
	});

	it("counts the row's bottom padding out of the straddle test", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: -100,
						bottom: 40,
						paddingBottom: 20,
					},
				],
			]),
		);
		renderOverlay(scroller);
		expect(button()?.textContent).toBe("first prompt");
	});

	it("hides within 8px of the bottom", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: -200,
						bottom: -20,
					},
				],
			]),
			{
				scrollHeight: 1608,
				scrollTop: 1000,
				clientHeight: 600,
			},
		);
		renderOverlay(scroller);
		expect(button()).toBeNull();
	});

	it("hides while the scroller is not displayed", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: -200,
						bottom: -20,
					},
				],
			]),
		);
		Object.defineProperty(
			scroller,
			"offsetParent",
			{
				configurable: true,
				get: () => null,
			},
		);
		renderOverlay(scroller);
		expect(button()).toBeNull();
	});

	it("treats an unmounted prompt before the first mounted candidate as passed", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					4,
					{
						top: 300,
						bottom: 400,
					},
				],
			]),
		);
		renderOverlay(scroller);
		expect(button()?.textContent).toBe("first prompt");
	});

	it("stops at an unmounted prompt after the anchor", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: 100,
						bottom: 200,
					},
				],
			]),
		);
		renderOverlay(scroller);
		expect(button()).toBeNull();
	});

	it("scrolls smoothly to the shown prompt on click", () =>
	{
		const {scroller} = makeScroller(
			new Map([
				[
					0,
					{
						top: -200,
						bottom: -20,
					},
				],
			]),
		);
		const {scrollToEntry} = renderOverlay(scroller);
		fireEvent.click(button()!);
		expect(scrollToEntry.mock.calls).toStrictEqual([[0, "smooth"]]);
	});

	it("forwards a wheel over the overlay to the scroller, in lines, unless ctrl is held", () =>
	{
		const {scroller, scrollBy} = makeScroller(
			new Map([
				[
					0,
					{
						top: -200,
						bottom: -20,
					},
				],
			]),
		);
		const forwarded: Array<
		{
			deltaY: number;
			deltaMode: number;
		}> = [];
		scroller.addEventListener("wheel", (event) =>
		{
			forwarded.push(
				{
					deltaY: event.deltaY,
					deltaMode: event.deltaMode,
				},
			);
		});
		renderOverlay(scroller);
		fireEvent.wheel(
			button()!,
			{
				deltaY: 3,
				deltaMode: 1,
			},
		);
		fireEvent.wheel(
			button()!,
			{
				deltaY: 2,
				deltaX: 1,
				deltaMode: 2,
			},
		);
		fireEvent.wheel(
			button()!,
			{
				deltaY: 5,
				deltaMode: 0,
				ctrlKey: true,
			},
		);
		expect(
			{
				scrollBy: scrollBy.mock.calls,
				forwarded,
			},
		).toStrictEqual(
			{
				scrollBy: [
					[
						{
							top: 48,
							left: 0,
						},
					],
					[
						{
							top: 1600,
							left: 800,
						},
					],
				],
				forwarded: [
					{
						deltaY: 3,
						deltaMode: 1,
					},
					{
						deltaY: 2,
						deltaMode: 2,
					},
				],
			},
		);
	});

	it("writes --epitaxy-sticky-prompt-end on the host while shown and removes it when hidden", () =>
	{
		const boxes = new Map<number, Box>([
			[
				0,
				{
					top: -200,
					bottom: -20,
				},
			],
		]);
		const {scroller, sync} = makeScroller(boxes);
		const {host, container} = renderOverlay(scroller);
		host.getBoundingClientRect = () => rect(0, 600);
		const overlay = container.firstElementChild as HTMLElement;
		overlay.getBoundingClientRect = () => rect(0, 40);
		act(() =>
		{
			for (const callback of FakeResizeObserver.callbacks) callback();
		});
		const shown = host.style.getPropertyValue("--epitaxy-sticky-prompt-end");
		boxes.set(
			0,
			{
				top: 100,
				bottom: 200,
			},
		);
		sync();
		fireEvent.scroll(scroller);
		flushFrames();
		expect(
			{
				shown,
				hidden: host.style.getPropertyValue("--epitaxy-sticky-prompt-end"),
			},
		).toStrictEqual(
			{
				shown: "40px",
				hidden: "",
			},
		);
	});

	it("re-detects when the scroll key changes, with no scroll event", () =>
	{
		const boxes = new Map<number, Box>([
			[
				0,
				{
					top: -200,
					bottom: -20,
				},
			],
		]);
		const {scroller, sync} = makeScroller(boxes);
		const {rerender, scrollToEntry} = renderOverlay(scroller);
		const before = button()?.textContent;
		boxes.set(
			0,
			{
				top: 100,
				bottom: 200,
			},
		);
		sync();
		const overlay = (scrollKey: string) => (
			<StickyPromptOverlay
				candidates={CANDIDATES}
				scroller={() => scroller}
				scrollKey={scrollKey}
				scrollToEntry={scrollToEntry}
			/>
		);
		rerender(overlay("fabricated-session"));
		const sameKey = button()?.textContent;
		rerender(overlay("fabricated-session:loading"));
		expect(
			{
				before,
				sameKey,
				newKey: button(),
			},
		).toStrictEqual(
			{
				before: "first prompt",
				sameKey: "first prompt",
				newKey: null,
			},
		);
	});

	it("keeps the bubble node when the shown prompt changes, and makes a new one after hiding", () =>
	{
		const boxes = new Map<number, Box>([
			[
				0,
				{
					top: -200,
					bottom: -20,
				},
			],
			[
				4,
				{
					top: 300,
					bottom: 400,
				},
			],
		]);
		const {scroller, sync} = makeScroller(boxes);
		const {container} = renderOverlay(scroller);
		const bubbleA = container.querySelector(".epitaxy-sticky-prompt-bubble");
		const scrollTo = (next: Array<[number, Box]>) =>
		{
			for (const [index, box] of next) boxes.set(index, box);
			sync();
			fireEvent.scroll(scroller);
			flushFrames();
		};
		scrollTo([
			[
				0,
				{
					top: -800,
					bottom: -620,
				},
			],
			[
				4,
				{
					top: -200,
					bottom: -20,
				},
			],
		]);
		const bubbleB = container.querySelector(".epitaxy-sticky-prompt-bubble");
		scrollTo([
			[
				0,
				{
					top: 100,
					bottom: 200,
				},
			],
			[
				4,
				{
					top: 300,
					bottom: 400,
				},
			],
		]);
		const hidden = container.querySelector(".epitaxy-sticky-prompt-bubble");
		scrollTo([
			[
				0,
				{
					top: -200,
					bottom: -20,
				},
			],
			[
				4,
				{
					top: 300,
					bottom: 400,
				},
			],
		]);
		const bubbleAgain = container.querySelector(".epitaxy-sticky-prompt-bubble");
		expect(
			{
				sameNode: bubbleB === bubbleA,
				textB: bubbleB?.textContent,
				hidden,
				newNode: bubbleAgain !== null && bubbleAgain !== bubbleA,
			},
		).toStrictEqual(
			{
				sameNode: true,
				textB: "second prompt",
				hidden: null,
				newNode: true,
			},
		);
	});
});
