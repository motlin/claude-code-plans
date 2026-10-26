import {describe, expect, it} from "vite-plus/test";
import {PALETTE_SEARCH_MAX_CHARS, offersQuickNewSession, paletteSearchable} from "../src/lib/palette-quick-action";

const QUERIES = ["", "abcdefg", "a".repeat(50), "a".repeat(51), "a".repeat(50) + " ", " ".repeat(51), "a\n".repeat(26)];

describe("palette quick action gate", () => {
	it("caps search at upstream's 50 characters", () => {
		expect(PALETTE_SEARCH_MAX_CHARS).toStrictEqual(50);
	});

	it("searches only raw, untrimmed queries of at most 50 characters", () => {
		expect(QUERIES.map(paletteSearchable)).toStrictEqual([true, true, true, false, false, false, false]);
	});

	it("offers New session only for non-blank queries over 50 characters", () => {
		expect(QUERIES.map(offersQuickNewSession)).toStrictEqual([false, false, false, true, true, false, true]);
	});
});
