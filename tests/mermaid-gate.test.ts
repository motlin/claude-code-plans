import {describe, expect, it} from "vite-plus/test";
import {mermaidSourceDrawable} from "../src/lib/mermaid-gate";

describe("mermaidSourceDrawable (upstream pre-gate Z)", () => {
	it("draws sources up to 262144 chars", () => {
		expect(
			[
				["short", "graph TD; A-->B"],
				["at limit", "a".repeat(262_144)],
				["over limit", "a".repeat(262_145)],
			].map(([name, code]) => [name, mermaidSourceDrawable(code!)]),
		).toStrictEqual([
			["short", true],
			["at limit", true],
			["over limit", false],
		]);
	});
});
