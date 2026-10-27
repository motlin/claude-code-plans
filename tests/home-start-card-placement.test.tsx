// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {
	placeStartCard,
	START_CARD_SETUP_HIDE_CLASS,
	useStartCardPlacement,
} from "../src/components/home/start-card-placement";

describe("placeStartCard", () => {
	it.each([
		{room: 420, expected: {top: 115.5, setupFits: true}},
		{room: 300, expected: {top: 115.5, setupFits: false}},
		{room: 120, expected: {top: 15, setupFits: false}},
	])("centres env 81 + setup 108 in rest 420 for room $room like upstream's xG", ({room, expected}) => {
		expect(placeStartCard({room, rest: 420, environments: 81, setup: 108, hidden: false})).toStrictEqual(expected);
	});

	it("needs one extra pixel to bring a hidden Next steps back, so it doesn't flicker at the edge", () => {
		expect(placeStartCard({room: 328.5, rest: 420, environments: 81, setup: 108, hidden: false})).toStrictEqual({
			top: 115.5,
			setupFits: true,
		});
		expect(placeStartCard({room: 328.5, rest: 420, environments: 81, setup: 108, hidden: true})).toStrictEqual({
			top: 115.5,
			setupFits: false,
		});
	});

	it("never pads above zero when the card is taller than the space above the composer", () => {
		expect(placeStartCard({room: 100, rest: 50, environments: 81, setup: 0, hidden: false})).toStrictEqual({
			top: 0,
			setupFits: false,
		});
	});
});

function rect(top: number, height: number): DOMRect {
	return {top, bottom: top + height, height, left: 0, right: 320, width: 320, x: 0, y: top, toJSON: () => ({})};
}

/** Upstream's DOM: scroller > wrapper(pt by observer) > slot > start card(env card, gap 12, Next steps). */
function Harness() {
	const ref = useStartCardPlacement();
	return (
		<div data-home-composer-test>
			<div data-testid="scroller">
				<div ref={ref} data-testid="wrapper" className="flex min-h-full w-full flex-col pb-6">
					<div data-testid="slot" className="flex w-full flex-col">
						<div>
							<ul data-testid="env" />
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
	});

	it("pads the wrapper to centre the card above the composer and toggles data-start-card-setup-hidden as the scroller shrinks and grows", () => {
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
				unobserve() {}
				disconnect() {
					this.entry.targets = [];
				}
			},
		);
		let room = 420;
		let setupShown = true;
		vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
			return this.dataset["testid"] === "scroller" ? room : 0;
		});
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

		const {getByTestId} = render(<Harness />);
		const wrapper = getByTestId("wrapper");
		const resize = () => {
			act(() => {
				for (const {callback, targets} of observers) if (targets.length > 0) callback([], {} as ResizeObserver);
			});
		};

		expect(observers.map(({targets}) => targets)).toStrictEqual([[getByTestId("scroller"), getByTestId("slot")]]);
		// setup = 108 + the 12px gap above it (bottom − previous sibling's bottom); a = (420 − 81 − 120) / 2
		expect({
			pt: wrapper.style.paddingTop,
			hidden: wrapper.hasAttribute("data-start-card-setup-hidden"),
		}).toStrictEqual({
			pt: "109.5px",
			hidden: false,
		});

		room = 300;
		resize();
		setupShown = false;
		resize();
		expect({
			pt: wrapper.style.paddingTop,
			hidden: wrapper.hasAttribute("data-start-card-setup-hidden"),
		}).toStrictEqual({
			pt: "109.5px",
			hidden: true,
		});

		room = 120;
		resize();
		expect({
			pt: wrapper.style.paddingTop,
			hidden: wrapper.hasAttribute("data-start-card-setup-hidden"),
		}).toStrictEqual({
			pt: "15px",
			hidden: true,
		});

		room = 420;
		resize();
		setupShown = true;
		resize();
		expect({
			pt: wrapper.style.paddingTop,
			hidden: wrapper.hasAttribute("data-start-card-setup-hidden"),
		}).toStrictEqual({
			pt: "109.5px",
			hidden: false,
		});
	});
});
