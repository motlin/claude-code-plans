import {describe, expect, it} from "vite-plus/test";

import {recapText} from "../src/lib/recap-text";

describe("recapText", () => {
	it("collapses whitespace runs and line separators to single spaces and trims", () => {
		expect([recapText("  a\n\n  b\t c  "), recapText("a\u2028b\u2029c")]).toStrictEqual(["a b c", "a b c"]);
	});

	it("strips control and format characters but keeps ZWJ and ZWNJ", () => {
		expect([recapText("a\u0007b\u0085c\u200bd"), recapText("x\u200dy\u200cz")]).toStrictEqual([
			"abcd",
			"x\u200dy\u200cz",
		]);
	});

	it("is undefined for empty or whitespace-only text", () => {
		expect([recapText(""), recapText("   \n"), recapText("\u0007")]).toStrictEqual([
			undefined,
			undefined,
			undefined,
		]);
	});

	it("keeps the recaps-in-config suffix", () => {
		expect(recapText("Done. (disable recaps in /config)")).toBe("Done. (disable recaps in /config)");
	});

	it("caps at 500 UTF-16 units plus an ellipsis", () => {
		expect([recapText("a".repeat(500)), recapText("a".repeat(600))]).toStrictEqual([
			"a".repeat(500),
			`${"a".repeat(500)}…`,
		]);
	});

	it("cuts at 499 when unit 499 starts a surrogate pair", () => {
		expect(recapText(`${"a".repeat(499)}😀${"b".repeat(10)}`)).toBe(`${"a".repeat(499)}…`);
	});
});
