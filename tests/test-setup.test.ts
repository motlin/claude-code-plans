// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";

describe("jsdom test setup", () => {
	it("provides navigator.sendBeacon, which the perf journey tracker's flush timer calls and jsdom lacks", () => {
		expect(typeof navigator.sendBeacon).toBe("function");
	});
});
