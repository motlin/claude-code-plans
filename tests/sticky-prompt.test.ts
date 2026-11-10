import {describe, expect, it} from "vite-plus/test";
import {STICKY_PROMPT_MAX_CHARS, STICKY_PROMPT_SCAN_CHARS, stickyPromptText} from "../src/lib/sticky-prompt";

describe("stickyPromptText (upstream qw + Jw)", () => {
	it("trims, drops empty prompts, and keeps the last 800 characters", () => {
		expect([
			stickyPromptText("  hi  "),
			stickyPromptText("   "),
			stickyPromptText(`${"a".repeat(799)}XYZ`),
			stickyPromptText("a".repeat(800)),
		]).toStrictEqual(["hi", null, `${"a".repeat(797)}XYZ`, "a".repeat(800)]);
	});

	it("masks secrets in the scanned tail before clipping", () => {
		const fakeKey =
			"sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE-FAKEAA";
		const text = stickyPromptText(`fabricated key ${fakeKey}`);
		expect({
			constants: [STICKY_PROMPT_SCAN_CHARS, STICKY_PROMPT_MAX_CHARS],
			hidesKey: text?.includes(fakeKey),
			startsWith: text?.startsWith("fabricated key "),
		}).toStrictEqual({constants: [8992, 800], hidesKey: false, startsWith: true});
	});
});
