/**
 * A scripted layout for the shrinkwrap engine under jsdom, which has no real layout. The bubble is a border-box
 * flex item `box` px wide (or its inline max-width, when narrower) with `pad` px of horizontal padding. Its first
 * paragraph's text wraps into `lines(width)` line rects; every other text node is one `otherText` px line.
 */
export type FakeLayoutSpec =
{
	box: number;
	pad: number;
	lines: (width: number) => number[];
	height?: (width: number) => number;
	otherText?: number;
};

export type FakeLayout =
{
	/** The inline max-widths (px) the engine measured under, in order. */
	probes(): number[];
	/** Change the unconstrained box width, as an ancestor resize would. */
	setBox(box: number): void;
	uninstall(): void;
};

function rect(left: number, width: number, top: number): DOMRect
{
	return {
		left,
		right: left + width,
		width,
		top,
		bottom: top + 20,
		height: 20,
		x: left,
		y: top,
		toJSON: () => ({}),
	};
}

function rectList(rects: DOMRect[]): DOMRectList
{
	return Object.assign(
		rects,
		{
			item: (i: number) => rects[i] ?? null,
		},
	);
}

export function installFakeLayout(el: HTMLElement, spec: FakeLayoutSpec): FakeLayout
{
	let box = spec.box;
	const probes: number[] = [];
	const effective = () =>
	{
		const max = parseFloat(el.style.maxWidth);
		return Number.isFinite(max) ? Math.min(box, max) : box;
	};
	const lines = () => spec.lines(effective());
	const height = () => spec.height?.(effective()) ?? lines().length * 24 + 16;
	const half = `${spec.pad / 2}px`;

	const win = window;
	const originalStyle = win.getComputedStyle.bind(win);
	win.getComputedStyle = (target: Element, pseudo?: string | null) =>
	{
		const real = originalStyle(target, pseudo);
		if (target !== el) return real;
		return new Proxy(
			real,
			{
				get(t, key)
				{
					switch (key)
					{
						case "width":
							return `${effective()}px`;
						case "boxSizing":
							return "border-box";
						case "paddingLeft":
						case "paddingRight":
							return half;
						case "borderLeftWidth":
						case "borderRightWidth":
							return "0px";
						case "display":
							return "flex";
						case "position":
							return "relative";
						case "overflowX":
						case "overflowY":
							return "visible";
						default:
						{
							const value = Reflect.get(t, key) as unknown;
							if (typeof value !== "function") return value;
							return (...args: unknown[]) =>
							{
								const result: unknown = Reflect.apply(value, t, args);
								return result;
							};
						}
					}
				},
			},
		);
	};

	const paragraph = el.querySelector("p");
	const originalRects = Object.getOwnPropertyDescriptor(win.Range.prototype, "getClientRects");
	win.Range.prototype.getClientRects = function (this: Range)
	{
		const node = this.startContainer;
		if (paragraph?.contains(node) === true)
		{
			return rectList(lines().map((w, i) => rect(spec.pad / 2, w, i * 24)));
		}
		if (spec.otherText !== undefined && node.nodeType === 3 && el.contains(node))
		{
			return rectList([rect(spec.pad / 2, spec.otherText, 200)]);
		}
		return rectList([]);
	};

	el.getBoundingClientRect = () => rect(0, effective(), 0);
	Object.defineProperty(
		el,
		"scrollHeight",
		{
			configurable: true,
			get: () =>
			{
				if (el.style.maxWidth !== "") probes.push(parseFloat(el.style.maxWidth));
				return height();
			},
		},
	);
	Object.defineProperty(
		el,
		"scrollWidth",
		{
			configurable: true,
			get: () => effective(),
		},
	);
	Object.defineProperty(
		el,
		"clientWidth",
		{
			configurable: true,
			get: () => effective(),
		},
	);
	Object.defineProperty(
		el,
		"offsetWidth",
		{
			configurable: true,
			get: () => effective(),
		},
	);
	Object.defineProperty(
		el,
		"offsetHeight",
		{
			configurable: true,
			get: () => height(),
		},
	);

	return {
		probes: () => [...probes],
		setBox(next)
		{
			box = next;
		},
		uninstall()
		{
			win.getComputedStyle = originalStyle;
			if (originalRects) Object.defineProperty(win.Range.prototype, "getClientRects", originalRects);
			else Reflect.deleteProperty(win.Range.prototype, "getClientRects");
		},
	};
}
