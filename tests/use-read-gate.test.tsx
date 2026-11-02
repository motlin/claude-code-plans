// @vitest-environment jsdom

import {act, fireEvent, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {useReadGate} from "../src/hooks/use-read-gate";

interface Layout
{
	top: number;
	bottom: number;
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	lineHeight: string;
}

const layout: Layout =
{
	top: 100,
	bottom: 150,
	scrollTop: 0,
	scrollHeight: 200,
	clientHeight: 50,
	lineHeight: "19px",
};

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function stubLayout(element: HTMLElement, card: HTMLElement)
{
	Object.defineProperty(
		element,
		"scrollTop",
		{
			configurable: true,
			get: () => layout.scrollTop,
		},
	);
	Object.defineProperty(
		element,
		"scrollHeight",
		{
			configurable: true,
			get: () => layout.scrollHeight,
		},
	);
	Object.defineProperty(
		element,
		"clientHeight",
		{
			configurable: true,
			get: () => layout.clientHeight,
		},
	);
	Object.defineProperty(
		element,
		"clientWidth",
		{
			configurable: true,
			get: () => 400,
		},
	);
	vi.spyOn(element, "getBoundingClientRect").mockImplementation(() =>
		DOMRect.fromRect(
			{
				x: 0,
				y: layout.top,
				width: 400,
				height: layout.bottom - layout.top,
			},
		),
	);
	vi.spyOn(card, "getBoundingClientRect").mockImplementation(() =>
		DOMRect.fromRect(
			{
				x: 0,
				y: layout.top,
				width: 400,
				height: 400,
			},
		),
	);
}

function stubWindow()
{
	vi.spyOn(window, "getComputedStyle").mockImplementation(
		() =>
			(
			{
				overflowY: "visible",
				overflowX: "visible",
				display: "block",
				position: "static",
				flexDirection: "row",
				lineHeight: layout.lineHeight,
				paddingTop: "0px",
				paddingBottom: "0px",
				borderTopWidth: "0px",
				borderBottomWidth: "0px",
				scrollPaddingTop: "auto",
				scrollPaddingBottom: "auto",
			}) as unknown as CSSStyleDeclaration,
	);
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
	{
		nextFrame += 1;
		frames.set(nextFrame, callback);
		return nextFrame;
	});
	vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
	{
		frames.delete(id);
	});
}

async function flushFrames(count: number)
{
	for (let index = 0; index < count; index++)
	{
		const due = [...frames.values()];
		frames.clear();
		await act(async () =>
		{
			for (const callback of due) callback(0);
			await Promise.resolve();
		});
	}
}

type OnHeld = (held: boolean, quiet?: boolean, upward?: boolean) => void;

function Gate({
	watched,
	text,
	inScroller,
	hostClips,
	onHeld,
}: {
	watched: boolean;
	text: string;
	inScroller?: boolean;
	hostClips?: boolean;
	onHeld: OnHeld;
})
{
	const ref = useRef<HTMLDivElement | null>(null);
	useReadGate(
		{
			ref,
			watched,
			text,
			onHeld,
			...(inScroller === undefined
				? {}
				:
					{
						inScroller,
					}),
			...(hostClips === undefined
				? {}
				:
					{
						hostClips,
					}),
		},
	);
	return (
		<div
			data-approval-card-root=""
			ref={(card) =>
			{
				// The card's ref attaches after its child's, so both are in place here.
				if (card !== null && ref.current !== null) stubLayout(ref.current, card);
			}}
		>
			<div ref={ref}>{text}</div>
		</div>
	);
}

function setup(
	props:
	{
		watched?: boolean;
		text?: string;
		inScroller?: boolean;
		hostClips?: boolean;
	} = {},
)
{
	stubWindow();
	const onHeld = vi.fn<OnHeld>();
	const view = render(
		<Gate watched={props.watched ?? true} text={props.text ?? "plan one"} onHeld={onHeld} {...props} />,
	);
	return {
		onHeld,
		view,
	};
}

afterEach(() =>
{
	frames.clear();
	Object.assign(
		layout,
		{
			top: 100,
			bottom: 150,
			scrollTop: 0,
			scrollHeight: 200,
			clientHeight: 50,
			lineHeight: "19px",
		},
	);
	vi.restoreAllMocks();
});

describe("useReadGate", () =>
{
	it("holds an overflowing watched element until it is scrolled to its end and stays there two frames", async () =>
	{
		const {onHeld} = setup();
		const mounted = onHeld.mock.calls.map((call) => [...call]);
		layout.scrollTop = 150;
		act(() =>
		{
			fireEvent.scroll(document);
		});
		const scrolled = onHeld.mock.calls.slice(mounted.length).map((call) => [...call]);
		await flushFrames(2);
		expect(
			{
				mounted,
				scrolled,
				last: onHeld.mock.lastCall,
			},
		).toStrictEqual(
			{
				mounted: [[true, false, false]],
				scrolled: [[true, false, false]],
				last: [false, false, false],
			},
		);
	});

	it("releases a fitting element at once without host clipping", () =>
	{
		layout.scrollHeight = 50;
		const {onHeld} = setup();
		expect(onHeld.mock.calls).toStrictEqual([[false, false, false]]);
	});

	it("with host clipping, holds a fitting element whose head is above the window, quietly until it settles", async () =>
	{
		Object.assign(
			layout,
			{
				top: -50,
				bottom: -10,
				scrollHeight: 40,
				clientHeight: 40,
			},
		);
		const {onHeld} = setup(
			{
				hostClips: true,
			},
		);
		const mounted = onHeld.mock.calls.map((call) => [...call]);
		await flushFrames(2);
		expect(
			{
				mounted,
				last: onHeld.mock.lastCall,
			},
		).toStrictEqual(
			{
				mounted: [[true, true, true]],
				last: [true, false, true],
			},
		);
	});

	it("holds a scroller title with no line height as unlaid", () =>
	{
		layout.lineHeight = "normal";
		const {onHeld} = setup(
			{
				inScroller: true,
			},
		);
		expect(onHeld.mock.calls).toStrictEqual([[true, true]]);
	});

	it("holds again when the text changes and releases when no longer watched", async () =>
	{
		const {onHeld, view} = setup();
		layout.scrollTop = 150;
		act(() =>
		{
			fireEvent.scroll(document);
		});
		await flushFrames(2);
		const read = onHeld.mock.lastCall;
		layout.scrollTop = 0;
		view.rerender(<Gate watched text="plan two" onHeld={onHeld} />);
		const changed = onHeld.mock.lastCall;
		view.rerender(<Gate watched={false} text="plan two" onHeld={onHeld} />);
		expect(
			{
				read,
				changed,
				unwatched: onHeld.mock.lastCall,
			},
		).toStrictEqual(
			{
				read: [false, false, false],
				changed: [true, false, false],
				unwatched: [false],
			},
		);
	});
});
