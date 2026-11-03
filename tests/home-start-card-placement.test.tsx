// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {
	placeStartCard,
	START_CARD_SETUP_HIDE_CLASS,
	useStartCardPlacement,
} from "../src/components/home/start-card-placement";

describe("placeStartCard", () => {
	const base = {rest: 677, list: 81, rem: 16, environments: 93, setup: 108, foot: 24, hidden: false};

	it.each([
		{room: 677, expected: {top: 271, setupFits: true}},
		// 271 + 93 + 108 + 24 > 300, and unlike the old xG the top isn't clamped
		{room: 300, expected: {top: 271, setupFits: false}},
	])(
		"centres only the 81px env card plus 2px + 3.25rem in rest 677 for room $room like upstream's AZ",
		({room, expected}) => {
			expect(placeStartCard({...base, room})).toStrictEqual(expected);
		},
	);

	it("allows 2px + 2.5rem when there is no env card", () => {
		expect(
			placeStartCard({
				room: 400,
				rest: 400,
				list: 0,
				rem: 16,
				environments: 0,
				setup: 108,
				foot: 24,
				hidden: false,
			}),
		).toStrictEqual({top: 179, setupFits: true});
	});

	it("needs one extra pixel to bring a hidden Next steps back, so it doesn't flicker at the edge", () => {
		expect(placeStartCard({...base, room: 496})).toStrictEqual({top: 271, setupFits: true});
		expect(placeStartCard({...base, room: 496, hidden: true})).toStrictEqual({top: 271, setupFits: false});
	});

	it("never sets a negative top when the card is taller than the space above the composer", () => {
		expect(placeStartCard({...base, room: 100, rest: 50})).toStrictEqual({top: 0, setupFits: false});
	});
});

function rect(top: number, height: number): DOMRect {
	return {top, bottom: top + height, height, left: 0, right: 320, width: 320, x: 0, y: top, toJSON: () => ({})};
}

/** Upstream's DOM: scroller > wrapper(pb-6) > [spacer(max-height by observer), slot > start card(env card, gap 12, Next steps)]. */
function Harness({envMarked}: Readonly<{envMarked: boolean}>) {
	const ref = useStartCardPlacement();
	return (
		<div data-home-composer-test>
			<div data-testid="scroller">
				<div
					ref={ref}
					data-testid="wrapper"
					className="flex min-h-full w-full flex-col pb-6"
					style={{paddingBottom: "24px"}}
				>
					<div aria-hidden="true" data-testid="spacer" className="max-h-0 grow basis-0" />
					<div data-testid="slot" className="flex w-full flex-col">
						<div>
							<ul data-testid="env" data-start-card-environments={envMarked ? "" : undefined} />
							<ul data-testid="setup" data-start-card-setup className={START_CARD_SETUP_HIDE_CLASS} />
						</div>
					</div>
				</div>
			</div>
			<div data-home-composer>
				<div data-composer-card data-testid="composer" />
			</div>
		</div>
	);
}

describe("useStartCardPlacement", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		document.documentElement.style.fontSize = "";
	});

	it("sets the spacer's max-height to centre the env card above the composer, watches the env card, and toggles data-start-card-setup-hidden", () => {
		const observers: {callback: ResizeObserverCallback; targets: Element[]}[] = [];
		vi.stubGlobal(
			"ResizeObserver",
			class {
				private readonly entry: {callback: ResizeObserverCallback; targets: Element[]};
				constructor(callback: ResizeObserverCallback) {
					this.entry = {callback, targets: []};
					observers.push(this.entry);
				}
				observe(target: Element) {
					this.entry.targets.push(target);
				}
				unobserve(target: Element) {
					this.entry.targets = this.entry.targets.filter((t) => t !== target);
				}
				disconnect() {
					this.entry.targets = [];
				}
			},
		);
		document.documentElement.style.fontSize = "16px";
		let room = 420;
		let setupShown = true;
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
			return this.dataset["testid"] === "setup" ? (setupShown ? 108 : 0) : 0;
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			switch (this.dataset["testid"]) {
				case "scroller": {
					return rect(32, room);
				}
				// rest = composer bottom − 2.75rem (44px at 16px) − scroller top = 496 − 44 − 32 = 420
				case "composer": {
					return rect(400, 96);
				}
				case "slot": {
					return rect(0, setupShown ? 201 : 81);
				}
				case "env": {
					return rect(0, 81);
				}
				case "setup": {
					return setupShown ? rect(93, 108) : rect(0, 0);
				}
				default: {
					return rect(0, 0);
				}
			}
		});

		const {getByTestId, rerender} = render(<Harness envMarked />);
		const wrapper = getByTestId("wrapper");
		const spacer = getByTestId("spacer");
		const resize = () => {
			act(() => {
				for (const {callback, targets} of observers) if (targets.length > 0) callback([], {} as ResizeObserver);
			});
		};
		const state = () => ({
			maxHeight: spacer.style.maxHeight,
			paddingTop: wrapper.style.paddingTop,
			hidden: wrapper.hasAttribute("data-start-card-setup-hidden"),
		});

		const observed = observers.map(({targets}) => targets);
		// allow = 81 + 2 + 3.25rem = 135; top = (420 − 135) / 2; 142.5 + 81 + 120 + 24 fits in 420
		const tall = state();

		room = 300;
		resize();
		setupShown = false;
		resize();
		const short = state();

		room = 420;
		resize();
		setupShown = true;
		resize();
		const back = state();

		// A 0.5 rem scale halves the 2.75rem clearance: rest = 496 − 22 − 32 = 442; top = (442 − 135) / 2
		wrapper.style.setProperty("--cds-rem-scale", "0.5");
		resize();
		const scaled = state();
		wrapper.style.removeProperty("--cds-rem-scale");

		// Without an env card: allow = 2 + 2.5rem = 42; top = (420 − 42) / 2
		rerender(<Harness envMarked={false} />);
		resize();
		const noEnv = state();

		expect({
			observed,
			tall,
			short,
			back,
			scaled,
			noEnv,
			finalTargets: observers.map(({targets}) => targets),
		}).toStrictEqual({
			observed: [[getByTestId("scroller"), getByTestId("slot"), getByTestId("env")]],
			tall: {maxHeight: "142.5px", paddingTop: "", hidden: false},
			short: {maxHeight: "142.5px", paddingTop: "", hidden: true},
			back: {maxHeight: "142.5px", paddingTop: "", hidden: false},
			scaled: {maxHeight: "153.5px", paddingTop: "", hidden: false},
			noEnv: {maxHeight: "189px", paddingTop: "", hidden: false},
			finalTargets: [[getByTestId("scroller"), getByTestId("slot")]],
		});
	});
});
