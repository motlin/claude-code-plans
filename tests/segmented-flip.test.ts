// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {applyThumb, measureThumbRect} from "../src/lib/segmented-flip";

interface StyleStub
{
	width?: string;
	boxSizing?: string;
	backgroundColor?: string;
	vars?: Record<string, string>;
}

function stubComputedStyles(styles: Map<Element, StyleStub>)
{
	vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) =>
	{
		const stub = styles.get(element) ?? {};
		return {
			width: stub.width ?? "",
			boxSizing: stub.boxSizing ?? "border-box",
			paddingLeft: "0px",
			paddingRight: "0px",
			borderLeftWidth: "0px",
			borderRightWidth: "0px",
			backgroundColor: stub.backgroundColor ?? "rgb(255, 255, 255)",
			getPropertyValue: (name: string) => stub.vars?.[name] ?? "",
		} as unknown as CSSStyleDeclaration;
	});
}

function stubRect(element: Element, left: number, width: number)
{
	element.getBoundingClientRect = () => (
	{
		left,
		width,
		right: left + width,
		top: 0,
		bottom: 30,
		height: 30,
		x: left,
		y: 0,
		toJSON: () => ({}),
	});
}

function setup(
	options:
	{
		animating?: boolean;
		backgroundColor?: string;
	} = {},
)
{
	const group = document.createElement("div");
	const thumb = document.createElement("div");
	group.append(thumb);
	document.body.append(group);
	stubRect(group, 100, 200);
	stubRect(thumb, 101, 26);
	const animateCalls: Array<
	{
		keyframes: unknown;
		options: unknown;
	}> = [];
	thumb.animate = (keyframes: unknown, animationOptions: unknown) =>
	{
		animateCalls.push(
			{
				keyframes,
				options: animationOptions,
			},
		);
		return {
			cancel: () =>
			{
			},
			playState: "running",
		} as unknown as Animation;
	};
	thumb.getAnimations = () =>
		(options.animating === true
			? [
					{
						playState: "running",
						cancel: () =>
						{
						},
					},
				]
			: []) as unknown as Animation[];
	stubComputedStyles(
		new Map([
			[
				thumb,
				{
					backgroundColor: options.backgroundColor ?? "rgb(255, 255, 255)",
					vars:
					{
						"--cds-dur-base": "0.2s",
						"--cds-ease-snap": "cubic-bezier(.32, .72, 0, 1)",
					},
				},
			],
		]),
	);
	const state = () => (
	{
		flipAt: thumb.dataset["flipAt"],
		style: thumb.getAttribute("style") ?? "",
		animateCalls,
	});
	return {
		group,
		thumb,
		state,
	};
}

afterEach(() =>
{
	vi.restoreAllMocks();
	document.body.innerHTML = "";
	delete document.documentElement.dataset["reduceMotion"];
});

describe("applyThumb (upstream kO)", () =>
{
	it("snaps into place on the first measure without animating", () =>
	{
		const {group, thumb, state} = setup();

		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();

		expect(state()).toStrictEqual(
			{
				flipAt: "1,26",
				style: "width: 26px; transform: translateX(1px); visibility: inherit;",
				animateCalls: [],
			},
		);
	});

	it("FLIPs transform-only from the current visual rect over --cds-dur-base with --cds-ease-snap", () =>
	{
		const {group, thumb, state} = setup();
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();

		applyThumb(
			thumb,
			group,
			{
				left: 27,
				width: 26,
			},
		)();

		expect(state()).toStrictEqual(
			{
				flipAt: "27,26",
				style: "width: 26px; transform: translateX(27px); visibility: inherit;",
				animateCalls: [
					{
						keyframes:
						{
							transform: ["translateX(1px) scaleX(1)", "translateX(27px) scaleX(1)"],
						},
						options:
						{
							duration: 200,
							easing: "cubic-bezier(.32, .72, 0, 1)",
						},
					},
				],
			},
		);
	});

	it("does nothing when the rect matches the cached data-flip-at", () =>
	{
		const {group, thumb, state} = setup();
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();
		thumb.style.width = "99px";

		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();

		expect(state()).toStrictEqual(
			{
				flipAt: "1,26",
				style: "width: 99px; transform: translateX(1px); visibility: inherit;",
				animateCalls: [],
			},
		);
	});

	it("moves without animating under html[data-reduce-motion=true]", () =>
	{
		const {group, thumb, state} = setup();
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();
		document.documentElement.dataset["reduceMotion"] = "true";

		applyThumb(
			thumb,
			group,
			{
				left: 27,
				width: 30,
			},
		)();

		expect(state()).toStrictEqual(
			{
				flipAt: "27,30",
				style: "width: 30px; transform: translateX(27px); visibility: inherit;",
				animateCalls: [],
			},
		);
	});

	it("snaps a correction pass when no animation is running", () =>
	{
		const {group, thumb, state} = setup();
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();

		applyThumb(
			thumb,
			group,
			{
				left: 2,
				width: 27,
			},
			{
				correction: true,
			},
		)();

		expect(state()).toStrictEqual(
			{
				flipAt: "2,27",
				style: "width: 27px; transform: translateX(2px); visibility: inherit;",
				animateCalls: [],
			},
		);
	});

	it("re-animates a correction that lands during a running animation", () =>
	{
		const {group, thumb, state} = setup(
			{
				animating: true,
			},
		);
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();

		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 52,
			},
			{
				correction: true,
			},
		)();

		expect(state().animateCalls).toStrictEqual([
			{
				keyframes:
				{
					transform: ["translateX(1px) scaleX(0.5)", "translateX(1px) scaleX(1)"],
				},
				options:
				{
					duration: 200,
					easing: "cubic-bezier(.32, .72, 0, 1)",
				},
			},
		]);
	});

	it("hides the thumb again and clears the flip cache when nothing is checked", () =>
	{
		const {group, thumb, state} = setup();
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();

		applyThumb(thumb, group, null)();

		expect(state()).toStrictEqual(
			{
				flipAt: undefined,
				style: "width: 26px; transform: translateX(1px);",
				animateCalls: [],
			},
		);
	});

	it("leaves will-change: transform on a translucent thumb after animating", () =>
	{
		const {group, thumb} = setup(
			{
				backgroundColor: "hsl(none 0% 100% / 0.1)",
			},
		);
		applyThumb(
			thumb,
			group,
			{
				left: 1,
				width: 26,
			},
		)();
		const first = thumb.style.willChange;

		applyThumb(
			thumb,
			group,
			{
				left: 27,
				width: 26,
			},
		)();

		expect(
			{
				first,
				after: thumb.style.willChange,
			},
		).toStrictEqual(
			{
				first: "",
				after: "transform",
			},
		);
	});
});

describe("measureThumbRect (upstream LL)", () =>
{
	it("divides the group-relative rect by the group's scale so the thumb sits in unscaled px", () =>
	{
		const group = document.createElement("div");
		const radio = document.createElement("span");
		group.append(radio);
		stubRect(group, 100, 150);
		stubRect(radio, 145, 58.5);
		stubComputedStyles(
			new Map([
				[
					group,
					{
						width: "200px",
					},
				],
			]),
		);
		vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);

		expect(measureThumbRect(radio, group)).toStrictEqual(
			{
				left: 60,
				width: 78,
			},
		);
	});

	it("rounds each edge to device pixels", () =>
	{
		const group = document.createElement("div");
		const radio = document.createElement("span");
		group.append(radio);
		stubRect(group, 0, 200);
		stubRect(radio, 10.3, 40.5);
		stubComputedStyles(
			new Map([
				[
					group,
					{
						width: "200px",
					},
				],
			]),
		);
		vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);

		expect(measureThumbRect(radio, group)).toStrictEqual(
			{
				left: 10.5,
				width: 40.5,
			},
		);
	});
});
