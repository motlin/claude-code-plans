// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	freezeScroll,
	makePaletteExitCopy,
	type PaletteExitCopy,
	PALETTE_EXIT_COPY_ATTR,
	PALETTE_EXIT_DURATION_FALLBACK_MS,
	PALETTE_EXIT_EASE_FALLBACK,
	PALETTE_EXIT_MAX_ELEMENTS,
	PALETTE_EXIT_SCALE,
	pruneBelow,
	scrubCopy,
	stripCopyAttrs,
} from "../src/lib/palette-exit-copy";
import {noteOverlayOpening, takeOverlayOpeningNote} from "../src/lib/overlay-open-note";

function attributeNames(element: Element): string[]
{
	return element.getAttributeNames();
}

function rect(top: number, height = 40, left = 0, width = 100): DOMRect
{
	return {
		top,
		left,
		width,
		height,
		bottom: top + height,
		right: left + width,
		x: left,
		y: top,
		toJSON: () => ({}),
	};
}

function stubRect(element: Element, value: DOMRect)
{
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue(value);
}

interface AnimateCall
{
	target: Element;
	keyframes: Keyframe[];
	options: KeyframeAnimationOptions;
	finish: () => void;
}

let animateCalls: AnimateCall[] = [];

function installAnimate()
{
	animateCalls = [];
	Object.defineProperty(
		HTMLElement.prototype,
		"animate",
		{
			configurable: true,
			writable: true,
			value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions)
			{
				let finish = () =>
				{
				};
				const finished = new Promise<void>((resolve) =>
				{
					finish = resolve;
				});
				animateCalls.push(
					{
						target: this,
						keyframes,
						options,
						finish,
					},
				);
				return {
					finished,
				};
			},
		},
	);
	Object.defineProperty(
		HTMLElement.prototype,
		"getAnimations",
		{
			configurable: true,
			writable: true,
			value: () => [],
		},
	);
}

function uninstallAnimate()
{
	Reflect.deleteProperty(HTMLElement.prototype, "animate");
	Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
}

/** Every copy a test made, so afterEach can drop its layers and real safety timer before they reach a later file. */
const madeCopies: PaletteExitCopy[] = [];

function makeCopy(popup: HTMLElement): PaletteExitCopy | null
{
	const copy = makePaletteExitCopy(popup);
	if (copy !== null) madeCopies.push(copy);
	return copy;
}

function removeMadeCopies()
{
	for (const copy of madeCopies.splice(0)) copy.remove();
}

/** A Base UI-shaped portal: the backdrop then the popup, as the palette mounts them. */
function mountPalette(rows = 2)
{
	const portal = document.createElement("div");
	portal.innerHTML = `<div class="fixed inset-0 z-50 bg-backdrop draggable-none" data-open="" role="presentation"></div><div id="popup" role="dialog" aria-modal="true" data-open="" data-command-palette="" class="fixed draggable-none" tabindex="-1"><div class="flex flex-col overflow-y-auto">${Array.from(
		{
			length: rows,
		},
		(_, index) => `<div>row ${index}</div>`,
	).join("")}</div></div>`;
	document.body.append(portal);
	const backdrop = portal.firstElementChild as HTMLElement;
	const popup = portal.querySelector<HTMLElement>("#popup")!;
	stubRect(popup, rect(111, 262, 300, 672));
	return {
		portal,
		backdrop,
		popup,
	};
}

function exitLayers(): HTMLElement[]
{
	return Array.from(document.body.querySelectorAll<HTMLElement>(`[${PALETTE_EXIT_COPY_ATTR}]`));
}

describe("palette exit copy helpers (upstream Cm / wm / Tm / Em)", () =>
{
	afterEach(() =>
	{
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("copies upstream's constants", () =>
	{
		expect(
			{
				attr: PALETTE_EXIT_COPY_ATTR,
				scale: PALETTE_EXIT_SCALE,
				max: PALETTE_EXIT_MAX_ELEMENTS,
				duration: PALETTE_EXIT_DURATION_FALLBACK_MS,
				ease: PALETTE_EXIT_EASE_FALLBACK,
			},
		).toStrictEqual(
			{
				attr: "data-palette-exit-copy",
				scale: 0.98,
				max: 750,
				duration: 200,
				ease: "cubic-bezier(0.165, 0.84, 0.44, 1)",
			},
		);
	});

	it("strips exactly upstream's identity and state attributes", () =>
	{
		const element = document.createElement("div");
		for (const name of [
			"id",
			"role",
			"tabindex",
			"aria-modal",
			"aria-labelledby",
			"aria-describedby",
			"data-cds",
			"data-cds-overlay",
			"data-cds-portal",
			"data-open",
			"data-popup-open",
			"data-starting-style",
			"data-ending-style",
			"data-command-palette",
			"class",
			"style",
			"aria-label",
		])
		{
			element.setAttribute(name, "");
		}

		stripCopyAttrs(element);

		expect(attributeNames(element)).toStrictEqual(["class", "style", "aria-label"]);
	});

	it("scrubs embeds, ids, form wiring and popup roles from the copy", () =>
	{
		const root = document.createElement("div");
		root.innerHTML = [
			`<iframe class="frame" style="width: 10px;" src="x"></iframe>`,
			`<canvas class="paint"></canvas>`,
			`<input id="query" name="q" form="f" autofocus="" tabindex="0" data-testid="t" aria-label="Search">`,
			`<label for="query" contenteditable="true">Label</label>`,
			`<svg><defs><linearGradient id="grad"></linearGradient></defs></svg>`,
			`<div role="listbox" data-open="" aria-expanded="true" class="list"></div>`,
			`<div role="combobox" aria-expanded="true" data-popup-open=""></div>`,
			`<div role="combobox" aria-expanded="false"></div>`,
			`<div role="option" data-open=""></div>`,
		].join("");

		scrubCopy(root);

		expect(root.innerHTML).toBe(
			[
				`<div class="frame" style="width: 10px;"></div>`,
				`<div class="paint"></div>`,
				`<input aria-label="Search">`,
				`<label>Label</label>`,
				`<svg><defs><linearGradient id="grad"></linearGradient></defs></svg>`,
				`<div class="list"></div>`,
				`<div></div>`,
				`<div role="combobox" aria-expanded="false"></div>`,
				`<div role="option" data-open=""></div>`,
			].join(""),
		);
	});

	it("prunes copy rows whose live top is at or below the bottom edge, recursing into the straddler only", () =>
	{
		const live = document.createElement("div");
		live.innerHTML = `<div></div><div></div><div><span></span><span></span></div><div></div>`;
		const copy = live.cloneNode(true) as HTMLElement;
		const rows = Array.from(live.children);
		[0, 40, 80, 120].forEach((top, index) =>
		{
			stubRect(rows[index]!, rect(top));
		});
		const spans = Array.from(rows[2]!.children);
		stubRect(spans[0]!, rect(80, 15));
		stubRect(spans[1]!, rect(100, 15));

		pruneBelow(live, copy, 100);

		expect(copy.innerHTML).toBe(`<div></div><div></div><div><span></span></div>`);
	});

	it("freezes a scrolled list: pinned height, hidden scrollbar, non-sticky rows shifted by the scroll", () =>
	{
		const live = document.createElement("div");
		live.innerHTML = `<div class="overflow-y-auto"><div class="sticky"></div><div></div><div></div></div>`;
		document.body.append(live);
		const scroller = live.firstElementChild as HTMLElement;
		Object.defineProperties(
			scroller,
			{
				scrollTop:
				{
					value: 120,
				},
				clientHeight:
				{
					value: 160,
				},
				scrollHeight:
				{
					value: 344,
				},
			},
		);
		stubRect(scroller, rect(0, 160));
		Array.from(scroller.children).forEach((child, index) =>
		{
			stubRect(child, rect(index * 40 - 120));
		});
		const computed = window.getComputedStyle.bind(window);
		vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
		{
			const style = computed(element);
			if (element.classList.contains("sticky"))
			{
				return {
					position: "sticky",
				} as CSSStyleDeclaration;
			}
			return style;
		});
		const copy = live.cloneNode(true) as HTMLElement;

		freezeScroll(live, copy);

		const copyScroller = copy.firstElementChild as HTMLElement;
		expect(
			{
				scroller:
				{
					height: copyScroller.style.height,
					minHeight: copyScroller.style.minHeight,
					scrollbarColor: copyScroller.style.getPropertyValue("scrollbar-color"),
				},
				translates: Array.from(copyScroller.children, (child) =>
					(child as HTMLElement).style.getPropertyValue("translate"),
				),
			},
		).toStrictEqual(
			{
				scroller:
				{
					height: "160px",
					minHeight: "160px",
					scrollbarColor: "transparent transparent",
				},
				translates: ["", "0px -120px", "0px -120px"],
			},
		);
	});
});

describe("makePaletteExitCopy (upstream km)", () =>
{
	beforeEach(() =>
	{
		installAnimate();
		takeOverlayOpeningNote();
	});

	afterEach(() =>
	{
		removeMadeCopies();
		uninstallAnimate();
		document.body.innerHTML = "";
		document.documentElement.removeAttribute("data-reduce-motion");
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("bails out without animate", () =>
	{
		uninstallAnimate();
		const {popup} = mountPalette();

		expect(makeCopy(popup)).toBeNull();
	});

	it("bails out under reduced motion (OS query or html[data-reduce-motion])", () =>
	{
		const {popup} = mountPalette();
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const byAttribute = makeCopy(popup);
		document.documentElement.removeAttribute("data-reduce-motion");
		Object.defineProperty(
			window,
			"matchMedia",
			{
				configurable: true,
				value: (query: string) => (
				{
					matches: query === "(prefers-reduced-motion: reduce)",
				}),
			},
		);
		const byQuery = makeCopy(popup);
		Reflect.deleteProperty(window, "matchMedia");

		expect([byAttribute, byQuery, exitLayers()]).toStrictEqual([null, null, []]);
	});

	it("bails out while the palette or its card is scaled (receded)", () =>
	{
		const {popup} = mountPalette();
		const card = document.createElement("div");
		card.setAttribute("data-palette-recede-card", "");
		card.style.setProperty("scale", "0.97");
		popup.append(card);

		expect(makeCopy(popup)).toBeNull();
		card.style.setProperty("scale", "1");
		popup.style.setProperty("scale", "0.98");
		expect(makeCopy(popup)).toBeNull();
	});

	it("bails out mid-animation", () =>
	{
		const {popup} = mountPalette();
		popup.getAnimations = () => [
			{
				playState: "running",
			} as Animation,
		];

		expect(makeCopy(popup)).toBeNull();
	});

	it("bails out past 750 descendants or at zero size", () =>
	{
		const big = mountPalette(PALETTE_EXIT_MAX_ELEMENTS);
		const tooBig = makeCopy(big.popup);
		const small = mountPalette();
		stubRect(small.popup, rect(0, 0, 0, 0));

		expect([tooBig, makeCopy(small.popup), exitLayers()]).toStrictEqual([null, null, []]);
	});

	it("builds an inert layer holding the scrim then a fixed panel clone at the live rect", () =>
	{
		const {popup} = mountPalette();

		expect(makeCopy(popup)).not.toBeNull();

		const layers = exitLayers();
		const panel = layers[0]!.lastElementChild as HTMLElement;
		const panelStyle = Object.fromEntries(
			[
				"animation",
				"transition",
				"position",
				"left",
				"top",
				"width",
				"height",
				"max-width",
				"max-height",
				"margin",
				"transform",
				"translate",
				"will-change",
			].map((name) => [name, panel.style.getPropertyValue(name)]),
		);
		panel.removeAttribute("style");
		expect(
			{
				html: layers.map((layer) => layer.outerHTML),
				panelStyle,
			},
		).toStrictEqual(
			{
				html: [
					`<div class="fixed inset-0 z-50 pointer-events-none" data-palette-exit-copy="" aria-hidden="true" inert="" style="pointer-events: none;">` +
						`<div class="fixed inset-0 z-50 bg-backdrop" style="animation: none; transition: none; opacity: 1;"></div>` +
						`<div class="fixed">` +
						`<div class="flex flex-col overflow-y-auto" style="animation: none; transition: none;">` +
						`<div style="animation: none; transition: none;">row 0</div><div style="animation: none; transition: none;">row 1</div>` +
						`</div></div></div>`,
				],
				panelStyle:
				{
					animation: "none",
					transition: "none",
					position: "fixed",
					left: "300px",
					top: "111px",
					width: "672px",
					height: "262px",
					"max-width": "none",
					"max-height": "none",
					margin: "0px",
					transform: "none",
					translate: "none",
					"will-change": "scale, opacity",
				},
			},
		);
		expect(document.body.lastElementChild).toBe(layers[0]);
	});

	it("plays upstream's fade and scale, then removes the layer when the panel finishes", async () =>
	{
		const {popup} = mountPalette();
		const copy = makeCopy(popup)!;

		copy.play();

		const [layer] = exitLayers();
		const scrim = layer!.firstElementChild!;
		const panel = layer!.lastElementChild!;
		const timing =
		{
			duration: 200,
			easing: "cubic-bezier(0.165, 0.84, 0.44, 1)",
			fill: "forwards",
		};
		expect(
			animateCalls.map(({target, keyframes, options}) => (
			{
				target,
				keyframes,
				options,
			})),
		).toStrictEqual([
			{
				target: scrim,
				keyframes: [
					{
						opacity: 1,
					},
					{
						opacity: 0,
					},
				],
				options: timing,
			},
			{
				target: panel,
				keyframes: [
					{
						opacity: 1,
						scale: 1,
					},
					{
						opacity: 0,
						scale: 0.98,
					},
				],
				options: timing,
			},
		]);
		animateCalls[1]!.finish();
		await Promise.resolve();
		await Promise.resolve();
		expect(exitLayers()).toStrictEqual([]);
	});

	it("reads the duration and easing tokens from the popup when defined", () =>
	{
		const {popup} = mountPalette();
		popup.style.setProperty("--cds-dur-base", "0.3s");
		popup.style.setProperty("--cds-ease-out", "linear");

		makeCopy(popup)!.play();

		expect(animateCalls.map(({options}) => options)).toStrictEqual([
			{
				duration: 300,
				easing: "linear",
				fill: "forwards",
			},
			{
				duration: 300,
				easing: "linear",
				fill: "forwards",
			},
		]);
	});

	it("remove() and the dur + 400ms safety timer drop the layer", () =>
	{
		vi.useFakeTimers();
		const first = mountPalette();
		makeCopy(first.popup)!.remove();
		expect(exitLayers()).toStrictEqual([]);

		const second = mountPalette();
		makeCopy(second.popup)!.play();
		vi.advanceTimersByTime(599);
		expect(exitLayers()).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(exitLayers()).toStrictEqual([]);
	});
});

describe("scrim hand-off to the next overlay (upstream km's k loop)", () =>
{
	let frames: FrameRequestCallback[] = [];

	function runFrame()
	{
		const pending = frames;
		frames = [];
		for (const frame of pending) frame(performance.now());
	}

	beforeEach(() =>
	{
		vi.useFakeTimers();
		installAnimate();
		takeOverlayOpeningNote();
		frames = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
		{
			frames.push(callback);
			return frames.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() =>
		{
			frames = [];
		});
	});

	afterEach(() =>
	{
		removeMadeCopies();
		uninstallAnimate();
		document.body.innerHTML = "";
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	function incomingBackdrop(opacity: string)
	{
		const portal = document.createElement("div");
		const backdrop = document.createElement("div");
		backdrop.className = "fixed inset-0 bg-backdrop";
		backdrop.setAttribute("data-open", "");
		backdrop.style.opacity = opacity;
		portal.append(backdrop);
		document.body.append(portal);
		return backdrop;
	}

	it("without a note the scrim stays in the panel layer", () =>
	{
		const {popup} = mountPalette();

		makeCopy(popup);

		expect(exitLayers().map((layer) => layer.childElementCount)).toStrictEqual([2]);
	});

	it("with a note the scrim gets its own layer ahead of the panel layer, so later dialogs stack over it", () =>
	{
		const {popup} = mountPalette();
		noteOverlayOpening(100);

		makeCopy(popup);

		const layers = exitLayers();
		expect(
			{
				children: layers.map((layer) => Array.from(layer.children, (child) => child.className)),
				order: layers[1]!.previousElementSibling === layers[0],
			},
		).toStrictEqual(
			{
				children: [["fixed inset-0 z-50 bg-backdrop"], ["fixed"]],
				order: true,
			},
		);
		expect(takeOverlayOpeningNote()).toBeNull();
	});

	it("keeps the scrim in the panel layer while another overlay is already open", () =>
	{
		const other = document.createElement("div");
		other.setAttribute("data-cds-overlay", "");
		other.setAttribute("data-open", "");
		document.body.append(other);
		const {popup} = mountPalette();
		noteOverlayOpening(100);

		makeCopy(popup);

		expect(exitLayers().map((layer) => layer.childElementCount)).toStrictEqual([2]);
	});

	it("the panel finish removes only the panel layer; the scrim tracks 1 - n and leaves at n ≥ .99", async () =>
	{
		const {popup} = mountPalette();
		noteOverlayOpening(100);
		const copy = makeCopy(popup)!;
		copy.play();
		const [scrimLayer, panelLayer] = exitLayers();
		const scrim = scrimLayer!.firstElementChild as HTMLElement;

		expect(animateCalls.map(({target}) => target)).toStrictEqual([panelLayer!.lastElementChild]);
		animateCalls[0]!.finish();
		await Promise.resolve();
		await Promise.resolve();
		expect(exitLayers()).toStrictEqual([scrimLayer]);

		const backdrop = incomingBackdrop("0.25");
		runFrame();
		expect(scrim.style.opacity).toBe("0.75");
		backdrop.style.opacity = "0.6";
		runFrame();
		expect(scrim.style.opacity).toBe("0.4");
		backdrop.style.opacity = "0.995";
		runFrame();
		expect(exitLayers()).toStrictEqual([]);
	});

	it("fades the scrim when the incoming backdrop's opacity drops", () =>
	{
		const {popup} = mountPalette();
		noteOverlayOpening(100);
		makeCopy(popup)!.play();
		const [scrimLayer] = exitLayers();
		const scrim = scrimLayer!.firstElementChild as HTMLElement;
		const backdrop = incomingBackdrop("0.5");
		runFrame();
		backdrop.style.opacity = "0.48";

		runFrame();

		expect(
			animateCalls.slice(1).map(({target, keyframes}) => (
			{
				target,
				keyframes,
			})),
		).toStrictEqual([
			{
				target: scrim,
				keyframes: [
					{
						opacity: 0.5,
					},
					{
						opacity: 0,
					},
				],
			},
		]);
		expect(frames).toStrictEqual([]);
	});

	it("fades the scrim when no overlay arrives by note + 400ms", () =>
	{
		const {popup} = mountPalette();
		noteOverlayOpening(100);
		makeCopy(popup)!.play();
		const [scrimLayer] = exitLayers();

		vi.advanceTimersByTime(499);
		runFrame();
		expect(animateCalls).toHaveLength(1);
		vi.advanceTimersByTime(1);
		runFrame();

		expect(
			animateCalls.slice(1).map(({target, keyframes}) => (
			{
				target,
				keyframes,
			})),
		).toStrictEqual([
			{
				target: scrimLayer!.firstElementChild,
				keyframes: [
					{
						opacity: 1,
					},
					{
						opacity: 0,
					},
				],
			},
		]);
	});

	it("the safety timer drops both layers after note + 400 + 2 × dur + 400ms", () =>
	{
		const {popup} = mountPalette();
		noteOverlayOpening(100);
		makeCopy(popup)!.play();

		vi.advanceTimersByTime(1299);
		expect(exitLayers()).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(exitLayers()).toStrictEqual([]);
	});
});
