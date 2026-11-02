// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	APPROVAL_READ_ROWS_ATTR,
	createReadLatch,
	fits,
	inset,
	lineSeen,
	nearestScroller,
	readLinesSeen,
	visibleClip,
} from "../src/lib/read-gate";

type StyleOverrides = Partial<
	Record<
		| "overflowY"
		| "overflowX"
		| "display"
		| "position"
		| "flexDirection"
		| "lineHeight"
		| "paddingTop"
		| "paddingBottom"
		| "borderTopWidth"
		| "borderBottomWidth"
		| "scrollPaddingTop"
		| "scrollPaddingBottom",
		string
	>
>;

const styles = new Map<Element, StyleOverrides>();

/** Every element computes as a static, unpadded, unclipped block unless the test says otherwise. */
function stubStyles()
{
	vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
	{
		const style =
		{
			overflowY: "visible",
			overflowX: "visible",
			display: "block",
			position: "static",
			flexDirection: "row",
			lineHeight: "19px",
			paddingTop: "0px",
			paddingBottom: "0px",
			borderTopWidth: "0px",
			borderBottomWidth: "0px",
			scrollPaddingTop: "auto",
			scrollPaddingBottom: "auto",
			...styles.get(element),
		};
		return style as unknown as CSSStyleDeclaration;
	});
}

function box(element: Element, top: number, bottom: number, style: StyleOverrides = {})
{
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect(
			{
				x: 0,
				y: top,
				width: 400,
				height: bottom - top,
			},
		),
	);
	styles.set(element, style);
	return element;
}

function nest(...elements: HTMLElement[]): HTMLElement
{
	for (let index = 1; index < elements.length; index++) elements[index - 1]!.append(elements[index]!);
	document.body.append(elements[0]!);
	return elements.at(-1)!;
}

const div = () => document.createElement("div");

/** A transcript scroller > card root > card body (scrolling) > watched element. */
function cardInTranscript({
	transcript,
	body,
	element,
}: {
	transcript: [number, number, StyleOverrides?];
	body: [number, number, StyleOverrides?];
	element: [number, number];
})
{
	const scroller = box(
		div(),
		transcript[0],
		transcript[1],
		{
			overflowY: "auto",
			...transcript[2],
		},
	);
	const root = box(div(), body[0], body[1]);
	root.setAttribute("data-approval-card-root", "");
	const cardBody = box(
		div(),
		body[0],
		body[1],
		{
			overflowY: "auto",
			...body[2],
		},
	);
	const watched = box(div(), element[0], element[1]);
	return nest(scroller as HTMLElement, root as HTMLElement, cardBody as HTMLElement, watched as HTMLElement);
}

afterEach(() =>
{
	styles.clear();
	vi.restoreAllMocks();
});

describe("lineSeen", () =>
{
	it("allows a last line 2px below the window but not 3px", () =>
	{
		stubStyles();
		const lowBy = (overhang: number) =>
		{
			const element = nest(box(div(), 700, window.innerHeight + overhang) as HTMLElement);
			return lineSeen(element, window, 19, "last");
		};
		expect(
			{
				two: lowBy(2),
				three: lowBy(3),
			},
		).toStrictEqual(
			{
				two: true,
				three: false,
			},
		);
	});

	it("does not see a line inside the card body but past the transcript scroller's bottom", () =>
	{
		stubStyles();
		const clipped = cardInTranscript(
			{
				transcript: [0, 400],
				body: [300, 700],
				element: [380, 420],
			},
		);
		const inside = cardInTranscript(
			{
				transcript: [0, 500],
				body: [300, 700],
				element: [380, 420],
			},
		);
		expect(
			{
				clipped: lineSeen(clipped, window, 19, "last"),
				inside: lineSeen(inside, window, 19, "last"),
			},
		).toStrictEqual(
			{
				clipped: false,
				inside: true,
			},
		);
	});

	it("trims the transcript's scroll-padding but not the card body's own", () =>
	{
		stubStyles();
		const underPadding = cardInTranscript(
			{
				transcript: [
					0,
					600,
					{
						scrollPaddingBottom: "40px",
					},
				],
				body: [0, 700],
				element: [500, 580],
			},
		);
		const ownPadding = cardInTranscript(
			{
				transcript: [0, 600],
				body: [
					0,
					590,
					{
						scrollPaddingBottom: "40px",
					},
				],
				element: [500, 580],
			},
		);
		expect(
			{
				underPadding: lineSeen(underPadding, window, 19, "last"),
				ownPadding: lineSeen(ownPadding, window, 19, "last"),
			},
		).toStrictEqual(
			{
				underPadding: false,
				ownPadding: true,
			},
		);
	});

	it("hides a first line under the top cover of the first scroller outside the card", () =>
	{
		stubStyles();
		const element = cardInTranscript(
			{
				transcript: [100, 600],
				body: [100, 600],
				element: [110, 200],
			},
		);
		expect(
			{
				covered: lineSeen(element, window, 19, "first", 0, 30),
				uncovered: lineSeen(element, window, 19, "first", 0, 0),
			},
		).toStrictEqual(
			{
				covered: false,
				uncovered: true,
			},
		);
	});

	it("offsets the first line box by the given inset", () =>
	{
		stubStyles();
		const element = cardInTranscript(
			{
				transcript: [100, 600],
				body: [100, 600],
				element: [92, 200],
			},
		);
		expect(
			{
				atTop: lineSeen(element, window, 19, "first"),
				pastPadding: lineSeen(element, window, 19, "first", 8),
			},
		).toStrictEqual(
			{
				atTop: false,
				pastPadding: true,
			},
		);
	});

	it("counts a zero-height element as seen", () =>
	{
		stubStyles();
		const element = nest(box(div(), 2000, 2000) as HTMLElement);
		expect(lineSeen(element, window, 19, "last")).toBe(true);
	});
});

describe("visibleClip", () =>
{
	it("intersects the box with every clipping ancestor and spends the top cover once", () =>
	{
		stubStyles();
		const outer = box(
			div(),
			50,
			650,
			{
				overflowY: "scroll",
			},
		);
		const inner = box(
			div(),
			100,
			600,
			{
				overflowY: "auto",
				overflowX: "hidden",
			},
		);
		const element = box(div(), 0, 900);
		nest(outer as HTMLElement, inner as HTMLElement, element as HTMLElement);
		expect(
			visibleClip(
				element,
				{
					topCover: 30,
				},
			),
		).toStrictEqual(
			{
				top: 130,
				bottom: 600,
				left: 0,
				right: 400,
			},
		);
	});

	it("returns null for an empty box", () =>
	{
		stubStyles();
		const element = nest(box(div(), 10, 10) as HTMLElement);
		vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
			DOMRect.fromRect(
				{
					x: 0,
					y: 10,
					width: 0,
					height: 0,
				},
			),
		);
		expect(visibleClip(element)).toBeNull();
	});
});

describe("inset", () =>
{
	it("sums the padding of the first in-flow child down to the text", () =>
	{
		stubStyles();
		const wrapper = box(div(), 0, 100) as HTMLElement;
		const panel = box(
			div(),
			0,
			100,
			{
				paddingTop: "8px",
				paddingBottom: "6px",
				borderBottomWidth: "1px",
			},
		);
		panel.textContent = "Prompt";
		wrapper.append(panel);
		document.body.append(wrapper);
		expect(
			{
				first: inset(wrapper, window, "first"),
				last: inset(wrapper, window, "last"),
			},
		).toStrictEqual(
			{
				first: 8,
				last: 7,
			},
		);
	});

	it("skips hidden and absolutely positioned children and stops at an inline box", () =>
	{
		stubStyles();
		const wrapper = box(
			div(),
			0,
			100,
			{
				paddingTop: "2px",
			},
		) as HTMLElement;
		const hidden = box(
			div(),
			0,
			0,
			{
				display: "none",
				paddingTop: "50px",
			},
		);
		const floating = box(
			div(),
			0,
			0,
			{
				position: "absolute",
				paddingTop: "50px",
			},
		);
		const label = box(
			document.createElement("span"),
			0,
			19,
			{
				display: "inline",
				paddingTop: "4px",
			},
		);
		wrapper.append(hidden, floating, label);
		document.body.append(wrapper);
		expect(inset(wrapper, window, "first")).toBe(2);
	});
});

describe("nearestScroller and fits", () =>
{
	it("finds the closest auto or scroll ancestor and allows 2px of overflow", () =>
	{
		stubStyles();
		const outer = box(
			div(),
			0,
			100,
			{
				overflowY: "scroll",
			},
		) as HTMLElement;
		const clipper = box(
			div(),
			0,
			100,
			{
				overflowY: "hidden",
			},
		) as HTMLElement;
		const element = nest(outer, clipper, div());
		const sized = (scrollHeight: number) =>
		{
			const scroller = div();
			Object.defineProperty(
				scroller,
				"scrollHeight",
				{
					value: scrollHeight,
				},
			);
			Object.defineProperty(
				scroller,
				"clientHeight",
				{
					value: 100,
				},
			);
			return fits(scroller);
		};
		expect(
			{
				scroller: nearestScroller(element, window) === outer,
				none: nearestScroller(outer, window),
				two: sized(102),
				three: sized(103),
				missing: fits(null),
				attr: APPROVAL_READ_ROWS_ATTR,
			},
		).toStrictEqual(
			{
				scroller: true,
				none: null,
				two: true,
				three: false,
				missing: true,
				attr: "data-approval-read-rows",
			},
		);
	});
});

describe("readLinesSeen", () =>
{
	it("needs the first and the last line of every read-line, keyed by edge and text", () =>
	{
		stubStyles();
		const asked: string[] = [];
		const seen = (key: string, now: () => boolean) =>
		{
			asked.push(key);
			return now();
		};
		const notice = box(div(), 100, 140) as HTMLElement;
		notice.textContent = "Runs outside the sandbox.";
		const reason = box(div(), 700, 800) as HTMLElement;
		reason.textContent = "Reason";
		document.body.append(notice, reason);
		expect(
			{
				onScreen: readLinesSeen([notice], window, seen),
				belowWindow: readLinesSeen([notice, reason], window, seen),
				unlaid: readLinesSeen([notice], window, seen, false),
				asked,
			},
		).toStrictEqual(
			{
				onScreen: true,
				belowWindow: false,
				unlaid: false,
				asked: [
					"first\nRuns outside the sandbox.",
					"last\nRuns outside the sandbox.",
					"first\nRuns outside the sandbox.",
					"last\nRuns outside the sandbox.",
					"first\nReason",
					"last\nReason",
					"first\nRuns outside the sandbox.",
					"last\nRuns outside the sandbox.",
				],
			},
		);
	});
});

describe("createReadLatch", () =>
{
	function frames()
	{
		const queue = new Map<number, FrameRequestCallback>();
		let next = 0;
		const win =
		{
			requestAnimationFrame: (callback: FrameRequestCallback) =>
			{
				next += 1;
				queue.set(next, callback);
				return next;
			},
			cancelAnimationFrame: (id: number) =>
			{
				queue.delete(id);
			},
		};
		const flush = () =>
		{
			const due = [...queue.entries()];
			queue.clear();
			for (const [, callback] of due) callback(0);
		};
		return {
			win,
			flush,
		};
	}

	function measured()
	{
		const element = div();
		const size =
		{
			clientWidth: 400,
			clientHeight: 100,
			scrollHeight: 300,
		};
		for (const key of Object.keys(size) as (keyof typeof size)[])
		{
			Object.defineProperty(
				element,
				key,
				{
					get: () => size[key],
				},
			);
		}
		return {
			element,
			size,
		};
	}

	function gate(element: HTMLElement, win: ReturnType<typeof frames>["win"])
	{
		const states: string[] = [];
		const latch = createReadLatch(element, win, () =>
		{
			check();
		});
		function check()
		{
			latch.pass();
			const end = latch.seen("end", () => true);
			states.push(end ? (latch.waiting() ? "waiting" : "read") : "unread");
		}
		return {
			check,
			states,
			latch,
		};
	}

	it("confirms a sighting after two frames", () =>
	{
		const {win, flush} = frames();
		const {element} = measured();
		const {check, states, latch} = gate(element, win);
		check();
		const pending = latch.waiting();
		flush();
		flush();
		expect(
			{
				pending,
				states,
				after: latch.waiting(),
			},
		).toStrictEqual(
			{
				pending: true,
				states: ["waiting", "read"],
				after: false,
			},
		);
	});

	it("drops the sighting when the content height changes between the frames", () =>
	{
		const {win, flush} = frames();
		const {element, size} = measured();
		const {check, states} = gate(element, win);
		check();
		flush();
		size.scrollHeight += 2;
		flush();
		const afterReflow = [...states];
		flush();
		flush();
		expect(
			{
				afterReflow,
				states,
			},
		).toStrictEqual(
			{
				afterReflow: ["waiting", "waiting"],
				states: ["waiting", "waiting", "read"],
			},
		);
	});

	it("forgets confirmed sightings", () =>
	{
		const {win, flush} = frames();
		const {element} = measured();
		const {check, states, latch} = gate(element, win);
		check();
		flush();
		flush();
		latch.forget();
		check();
		expect(states).toStrictEqual(["waiting", "read", "waiting"]);
	});
});
