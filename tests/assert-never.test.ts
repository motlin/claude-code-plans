import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {assertNever} from "../src/lib/assert-never";

describe("assertNever", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("tolerates a value the lenient runtime schemas let through, warning and passing it back", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const value = "brand_new_source" as never;
		expect(assertNever(value)).toBe("brand_new_source");
		expect(warn.mock.calls).toEqual([['Unhandled case: "brand_new_source"']]);
	});
});
