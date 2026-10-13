import {defined} from "../src/lib/defined";

describe("defined", () => {
	it("returns a present value unchanged", () => {
		expect(defined(0, "zero")).toBe(0);
		expect(defined("", "empty")).toBe("");
	});

	it("throws the given message for undefined", () => {
		expect(() => defined(undefined, "missing row")).toThrow("missing row");
	});

	it("throws the given message for null", () => {
		expect(() => defined(null, "missing counters")).toThrow("missing counters");
	});
});
