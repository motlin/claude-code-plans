import {describe, expect, it} from "vite-plus/test";

import {secondaryAiTitle} from "../src/lib/ai-title";

describe("secondaryAiTitle", () => {
	it("returns the AI title when it differs from the displayed title", () => {
		expect(secondaryAiTitle("claude.ai", "Parallel do-task workstreams")).toBe("Parallel do-task workstreams");
	});

	it("returns null when the AI title is the displayed title", () => {
		expect(secondaryAiTitle("Fix login", "Fix login")).toBeNull();
	});

	it("ignores surrounding whitespace when comparing", () => {
		expect(secondaryAiTitle("Fix login ", "  Fix login")).toBeNull();
	});

	it("returns null when there is no AI title", () => {
		expect([
			secondaryAiTitle("Fix login", undefined),
			secondaryAiTitle("Fix login", null),
			secondaryAiTitle("Fix login", "  "),
		]).toStrictEqual([null, null, null]);
	});

	it("trims the returned AI title", () => {
		expect(secondaryAiTitle("claude.ai", " Fix login\n")).toBe("Fix login");
	});
});
