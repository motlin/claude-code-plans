// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";
import {
	APP_VISUAL_VIEWPORT_HEIGHT_VAR,
	installVisualViewportHeight,
	type VisualViewportHost,
} from "../src/lib/visual-viewport-height";

class FakeVisualViewport extends EventTarget {
	height: number;
	constructor(height: number) {
		super();
		this.height = height;
	}
}

function makeHost(coarse: boolean, innerHeight: number) {
	const visualViewport = new FakeVisualViewport(innerHeight);
	const host: VisualViewportHost = {
		innerHeight,
		visualViewport,
		matchMedia: (query: string) => ({matches: query === "(pointer: coarse)" && coarse}),
		document,
	};
	return {host, visualViewport};
}

function readVar(): string {
	return document.documentElement.style.getPropertyValue(APP_VISUAL_VIEWPORT_HEIGHT_VAR);
}

describe("installVisualViewportHeight", () => {
	let uninstall: (() => void) | undefined;

	afterEach(() => {
		uninstall?.();
		uninstall = undefined;
		document.documentElement.style.removeProperty(APP_VISUAL_VIEWPORT_HEIGHT_VAR);
	});

	it("sets the var while the soft keyboard shrinks the visual viewport and removes it when it closes", () => {
		const {host, visualViewport} = makeHost(true, 800);
		uninstall = installVisualViewportHeight(host);
		expect(readVar()).toBe("");

		visualViewport.height = 450;
		visualViewport.dispatchEvent(new Event("resize"));
		expect(readVar()).toBe("450px");

		visualViewport.height = 440;
		visualViewport.dispatchEvent(new Event("scroll"));
		expect(readVar()).toBe("440px");

		visualViewport.height = 800;
		visualViewport.dispatchEvent(new Event("resize"));
		expect(readVar()).toBe("");
	});

	it("ignores sub-pixel differences between the visual viewport and innerHeight", () => {
		const {host, visualViewport} = makeHost(true, 800);
		uninstall = installVisualViewportHeight(host);

		visualViewport.height = 799.5;
		visualViewport.dispatchEvent(new Event("resize"));
		expect(readVar()).toBe("");
	});

	it("is a no-op where the browser has no visualViewport", () => {
		const host: VisualViewportHost = {innerHeight: 800, matchMedia: () => ({matches: true}), document};
		uninstall = installVisualViewportHeight(host);
		expect(readVar()).toBe("");
	});

	it("never sets the var with a fine pointer", () => {
		const {host, visualViewport} = makeHost(false, 800);
		uninstall = installVisualViewportHeight(host);

		visualViewport.height = 450;
		visualViewport.dispatchEvent(new Event("resize"));
		expect(readVar()).toBe("");
	});

	it("stops tracking and clears the var on uninstall", () => {
		const {host, visualViewport} = makeHost(true, 800);
		uninstall = installVisualViewportHeight(host);

		visualViewport.height = 450;
		visualViewport.dispatchEvent(new Event("resize"));
		expect(readVar()).toBe("450px");

		uninstall();
		uninstall = undefined;
		expect(readVar()).toBe("");

		visualViewport.height = 400;
		visualViewport.dispatchEvent(new Event("resize"));
		expect(readVar()).toBe("");
	});
});
