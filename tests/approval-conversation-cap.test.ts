// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";

import
{
	APPROVAL_CAP_VAR,
	APPROVAL_RECLAIM_VAR,
	capValue,
	createConversationCapFitter,
} from "../src/lib/approval-conversation-cap";

type Style = Readonly<Record<string, string>>;

const BASE: Style =
{
	display: "block",
	position: "static",
	order: "0",
	paddingTop: "0px",
	paddingBottom: "0px",
	borderTopWidth: "0px",
	borderBottomWidth: "0px",
	minHeight: "0px",
	lineHeight: "20px",
	overflowY: "visible",
	scrollPaddingTop: "auto",
	scrollPaddingBottom: "auto",
};

/** A window whose computed styles come from a map, so jsdom's missing layout doesn't matter. */
function fakeWindow(styles: Map<Element, Style>): Window
{
	return {
		getComputedStyle: (element: Element) =>
			(
			{
				...BASE,
				...styles.get(element),
			}) as unknown as CSSStyleDeclaration,
	} as unknown as Window;
}

function setRect(
	element: Element,
	rect: () =>
	{
		top: number;
		bottom: number;
	},
)
{
	element.getBoundingClientRect = () =>
	{
		const {top, bottom} = rect();
		return {
			top,
			bottom,
			height: bottom - top,
			left: 0,
			right: 480,
			width: 480,
			x: 0,
			y: top,
			toJSON: () => ({}),
		};
	};
}

function setNumber(element: Element, key: "clientHeight" | "scrollHeight" | "scrollTop" | "clientTop", value: number)
{
	Object.defineProperty(
		element,
		key,
		{
			configurable: true,
			value,
		},
	);
}

function element(parent: Element, attributes: Record<string, string> = {}, tag = "div"): HTMLElement
{
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
	parent.append(node);
	return node;
}

/**
 * scroller (800 tall, top 0) > column > wrapper > card (100..400, 12px bottom padding) holding a body (200 tall) and
 * actions ending at 388. The wrapper ends `tail`px under the card, minus the reclaim the card's margin pulls back.
 */
function fixture({
	tail = 15,
	clientHeight = 800,
}:
{
	tail?: number;
	clientHeight?: number;
} = {})
{
	const styles = new Map<Element, Style>();
	const scroller = element(document.body);
	styles.set(
		scroller,
		{
			overflowY: "auto",
		},
	);
	setRect(scroller, () => (
	{
		top: 0,
		bottom: clientHeight,
	}));
	setNumber(scroller, "clientHeight", clientHeight);
	const column = element(scroller);
	const wrapper = element(column);
	const card = element(wrapper);
	styles.set(
		card,
		{
			paddingBottom: "12px",
		},
	);
	const geometry =
	{
		actionsBottom: 388,
	};
	const reclaimed = () => Number.parseFloat(card.style.getPropertyValue(APPROVAL_RECLAIM_VAR)) || 0;
	setRect(card, () => (
	{
		top: 100,
		bottom: 400,
	}));
	setRect(wrapper, () => (
	{
		top: 100,
		bottom: 400 + tail - reclaimed(),
	}));
	setRect(column, () => (
	{
		top: 0,
		bottom: 400 + tail - reclaimed(),
	}));
	const body = element(
		card,
		{
			"data-approval-card-body": "",
		},
	);
	setNumber(body, "clientHeight", 200);
	setRect(body, () => (
	{
		top: 150,
		bottom: 350,
	}));
	const actions = element(card);
	setRect(actions, () => (
	{
		top: 360,
		bottom: geometry.actionsBottom,
	}));
	const win = fakeWindow(styles);
	const fitter = createConversationCapFitter(card, win, scroller);
	const props = () => (
	{
		cap: card.style.getPropertyValue(APPROVAL_CAP_VAR),
		reclaim: card.style.getPropertyValue(APPROVAL_RECLAIM_VAR),
	});
	return {
		styles,
		scroller,
		column,
		wrapper,
		card,
		body,
		geometry,
		fitter,
		props,
		measure: () =>
		{
			fitter.measure();
			return props();
		},
	};
}

describe("createConversationCapFitter (upstream c2d1aeb56 `K`)", () =>
{
	it("caps a trailing card to the scroller's room and reclaims all but 8px of the 15px under it", () =>
	{
		const {measure, fitter, column} = fixture();
		expect(
			{
				first: measure(),
				again: measure(),
				column: fitter.column === column,
			},
		).toStrictEqual(
			{
				first:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
					reclaim: "7px",
				},
				again:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
					reclaim: "7px",
				},
				column: true,
			},
		);
	});

	it("reclaims at most 40px", () =>
	{
		expect(
			fixture(
				{
					tail: 100,
				},
			).measure(),
		).toStrictEqual(
			{
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 740px), 134px)",
				reclaim: "40px",
			},
		);
	});

	it("holds the room through a 1px growth and the floor through a 1px shrink, as upstream's `z`/`B` hysteresis", () =>
	{
		const {scroller, body, measure} = fixture();
		const cap = () => measure().cap.replace("max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), ", "");
		const first = cap();
		setNumber(scroller, "clientHeight", 801);
		const roomUpOne = cap();
		setNumber(scroller, "clientHeight", 802);
		const roomUpTwo = cap();
		setNumber(body, "clientHeight", 201);
		const floorDownOne = cap();
		setNumber(body, "clientHeight", 202);
		const floorDownTwo = cap();
		expect(
			{
				first,
				roomUpOne,
				roomUpTwo,
				floorDownOne,
				floorDownTwo,
			},
		).toStrictEqual(
			{
				first: "792px), 134px)",
				roomUpOne: "792px), 134px)",
				roomUpTwo: "794px), 134px)",
				floorDownOne: "794px), 134px)",
				floorDownTwo: "794px), 132px)",
			},
		);
	});

	it("measures the scroller's content end when the card is the scroller's direct child", () =>
	{
		const styles = new Map<Element, Style>();
		const scroller = element(document.body);
		setRect(scroller, () => (
		{
			top: 0,
			bottom: 800,
		}));
		setNumber(scroller, "clientHeight", 800);
		setNumber(scroller, "clientTop", 0);
		setNumber(scroller, "scrollHeight", 1415);
		setNumber(scroller, "scrollTop", 1000);
		const card = element(scroller);
		setRect(card, () => (
		{
			top: 100,
			bottom: 400,
		}));
		const fitter = createConversationCapFitter(card, fakeWindow(styles), scroller);
		fitter.measure();
		expect(
			{
				column: fitter.column === card,
				cap: card.style.getPropertyValue(APPROVAL_CAP_VAR),
				reclaim: card.style.getPropertyValue(APPROVAL_RECLAIM_VAR),
			},
		).toStrictEqual(
			{
				column: true,
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 334px)",
				reclaim: "7px",
			},
		);
	});

	it("drops the cap and the reclaim when a visible row follows the card", () =>
	{
		const {column, measure} = fixture();
		setRect(element(column), () => (
		{
			top: 420,
			bottom: 440,
		}));
		expect(measure()).toStrictEqual(
			{
				cap: "",
				reclaim: "",
			},
		);
	});

	it("keeps the cap but reclaims nothing when a visible sibling follows the card inside its own parent", () =>
	{
		const {wrapper, measure} = fixture();
		setRect(element(wrapper), () => (
		{
			top: 400,
			bottom: 410,
		}));
		expect(measure()).toStrictEqual(
			{
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 785px), 134px)",
				reclaim: "",
			},
		);
	});

	it("ignores an empty aria-hidden row, an absolute row and a zero-height row after the card", () =>
	{
		const results = (["aria-hidden", "absolute", "empty"] as const).map((kind) =>
		{
			const {column, styles, measure} = fixture();
			const row = element(
				column,
				kind === "aria-hidden"
					?
						{
							"aria-hidden": "true",
						}
					: {},
			);
			if (kind === "absolute")
			{
				styles.set(
					row,
					{
						position: "absolute",
					},
				);
			}
			setRect(row, () =>
				kind === "empty"
					?
						{
							top: 415,
							bottom: 415,
						}
					:
						{
							top: 415,
							bottom: 435,
						},
			);
			return measure();
		});
		expect(results).toStrictEqual([
			{
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
				reclaim: "27px",
			},
			{
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
				reclaim: "7px",
			},
			{
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
				reclaim: "7px",
			},
		]);
	});

	it("counts a row before the card when the card's level is reordered", () =>
	{
		const {column, wrapper, styles, measure} = fixture();
		const before = element(column);
		column.insertBefore(before, wrapper);
		setRect(before, () => (
		{
			top: 420,
			bottom: 440,
		}));
		const unordered = measure();
		styles.set(
			wrapper,
			{
				order: "1",
			},
		);
		expect(
			{
				unordered,
				ordered: measure(),
			},
		).toStrictEqual(
			{
				unordered:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
					reclaim: "7px",
				},
				ordered:
				{
					cap: "",
					reclaim: "",
				},
			},
		);
	});

	it("drops the cap when the scroller has no room", () =>
	{
		expect(
			fixture(
				{
					clientHeight: 5,
				},
			).measure(),
		).toStrictEqual(
			{
				cap: "",
				reclaim: "7px",
			},
		);
	});

	it("stops capping for good after two clipped measures in a row", () =>
	{
		const {geometry, measure} = fixture();
		const fits = measure();
		geometry.actionsBottom = 405;
		const clippedOnce = measure();
		const clippedTwice = measure();
		geometry.actionsBottom = 388;
		expect(
			{
				fits,
				clippedOnce,
				clippedTwice,
				fitsAgain: measure(),
			},
		).toStrictEqual(
			{
				fits:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 134px)",
					reclaim: "7px",
				},
				clippedOnce:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 151px)",
					reclaim: "7px",
				},
				clippedTwice:
				{
					cap: "",
					reclaim: "7px",
				},
				fitsAgain:
				{
					cap: "",
					reclaim: "7px",
				},
			},
		);
	});

	it("floors the body at a read-gated rows panel's head line and first row, or its min-height, rounding up", () =>
	{
		const {body, styles, measure} = fixture();
		styles.set(
			body.parentElement!,
			{
				paddingBottom: "12.5px",
			},
		);
		setNumber(body, "scrollHeight", 420);
		setNumber(body, "scrollTop", 0);
		const rows = element(
			body,
			{
				"data-approval-read-rows": "",
			},
		);
		styles.set(
			rows,
			{
				paddingTop: "4px",
				paddingBottom: "4px",
			},
		);
		setRect(rows, () => (
		{
			top: 160,
			bottom: 560,
		}));
		const list = element(rows, {}, "ul");
		const row = element(list, {}, "li");
		setRect(row, () => (
		{
			top: 194,
			bottom: 214,
		}));
		const rowsFloor = measure();
		styles.set(
			body,
			{
				minHeight: "90px",
			},
		);
		expect(
			{
				rowsFloor,
				minHeight: measure(),
			},
		).toStrictEqual(
			{
				rowsFloor:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 167px)",
					reclaim: "7px",
				},
				minHeight:
				{
					cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 792px), 191px)",
					reclaim: "7px",
				},
			},
		);
	});

	it("subtracts the scroller's scroll-padding top and bottom", () =>
	{
		const {scroller, styles, measure} = fixture();
		styles.set(
			scroller,
			{
				overflowY: "auto",
				scrollPaddingTop: "45px",
				scrollPaddingBottom: "76px",
			},
		);
		expect(measure()).toStrictEqual(
			{
				cap: "max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 679px), 134px)",
				reclaim: "",
			},
		);
	});

	it("formats the cap as upstream's `R`", () =>
	{
		expect(capValue(612, 187)).toBe("max(min(max(60vh, calc(22.5rem * var(--cds-rem-scale, 1))), 612px), 187px)");
	});
});
