// @vitest-environment jsdom

import {describe, expect, it, vi} from "vite-plus/test";
import {installViewportHeightAttributes, VIEWPORT_HEIGHT_STEPS} from "../src/lib/viewport-height-attributes";

interface FakeQuery {
	matches: boolean;
	listener: (() => void) | undefined;
}

function makeDocument(matching: readonly number[]) {
	const doc = document.implementation.createHTMLDocument("vh");
	const queries = new Map<string, FakeQuery>();
	const addEventListener = vi.fn<(type: string) => void>();
	const matchMedia = (query: string) => {
		const step = Number(/\(max-height: (\d+)px\)/.exec(query)?.[1]);
		const fake: FakeQuery = {matches: matching.includes(step), listener: undefined};
		queries.set(query, fake);
		return {
			get matches() {
				return fake.matches;
			},
			addEventListener: (type: string, listener: () => void) => {
				addEventListener(type);
				fake.listener = listener;
			},
		};
	};
	Object.defineProperty(doc, "defaultView", {value: {matchMedia}});
	return {doc, queries, addEventListener};
}

function attributes(doc: Document): string[] {
	return doc.body.getAttributeNames().filter((name) => name.startsWith("data-vh-max-"));
}

describe("installViewportHeightAttributes", () => {
	it("watches upstream's three steps", () => {
		expect(VIEWPORT_HEIGHT_STEPS).toStrictEqual([400, 420, 520]);
	});

	it("sets data-vh-max-N on body for every step the viewport is at most that tall", () => {
		const {doc} = makeDocument([420, 520]);

		installViewportHeightAttributes(doc);

		expect(attributes(doc)).toStrictEqual(["data-vh-max-420", "data-vh-max-520"]);
	});

	it("toggles an attribute live when its media query changes", () => {
		const {doc, queries} = makeDocument([420, 520]);
		installViewportHeightAttributes(doc);

		const q420 = queries.get("(max-height: 420px)");
		if (q420 === undefined) throw new Error("no 420 query");
		q420.matches = false;
		q420.listener?.();

		expect(attributes(doc)).toStrictEqual(["data-vh-max-520"]);
	});

	it("installs once per document", () => {
		const {doc, addEventListener} = makeDocument([]);

		installViewportHeightAttributes(doc);
		installViewportHeightAttributes(doc);

		expect(addEventListener.mock.calls).toStrictEqual([["change"], ["change"], ["change"]]);
	});

	it("does nothing without matchMedia", () => {
		const doc = document.implementation.createHTMLDocument("vh");
		Object.defineProperty(doc, "defaultView", {value: {}});

		expect(() => {
			installViewportHeightAttributes(doc);
		}).not.toThrow();
		expect(attributes(doc)).toStrictEqual([]);
	});
});
