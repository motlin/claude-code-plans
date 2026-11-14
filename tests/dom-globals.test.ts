// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";

import {captureDomGlobals, restoreDomGlobals} from "./dom-globals";

describe("restoreDomGlobals", () =>
{
	it("puts back the DOM a file patched by hand: prototype overrides, deleted natives, added APIs and globals", () =>
	{
		captureDomGlobals();
		const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
		const innerHeight = Object.getOwnPropertyDescriptor(globalThis, "innerHeight");
		Object.defineProperty(
			HTMLElement.prototype,
			"offsetParent",
			{
				configurable: true,
				get: () => document.body,
			},
		);
		Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
		Reflect.set(HTMLElement.prototype, "animate", undefined);
		Reflect.set(Range.prototype, "getBoundingClientRect", () => new DOMRect());
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				configurable: true,
				value: {},
			},
		);
		Reflect.set(document, "startViewTransition", () => undefined);
		Reflect.set(globalThis, "ResizeObserver", () => undefined);
		Object.defineProperty(
			globalThis,
			"innerHeight",
			{
				configurable: true,
				value: 1,
			},
		);

		restoreDomGlobals();

		expect(
			{
				offsetParent: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent"),
				innerHeight: Object.getOwnPropertyDescriptor(globalThis, "innerHeight"),
				added: [
					Object.hasOwn(HTMLElement.prototype, "animate"),
					Object.hasOwn(Range.prototype, "getBoundingClientRect"),
					Object.hasOwn(navigator, "clipboard"),
					Object.hasOwn(document, "startViewTransition"),
					Object.hasOwn(globalThis, "ResizeObserver"),
				],
			},
		).toStrictEqual(
			{
				offsetParent,
				innerHeight,
				added: [false, false, false, false, false],
			},
		);
	});
});
