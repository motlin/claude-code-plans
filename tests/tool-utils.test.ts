import {describe, expect, it} from "vite-plus/test";
import {inputString} from "../src/lib/tool-utils";

describe("inputString", () => {
	it("returns the first key that holds a string and skips missing or non-string values", () => {
		const input = {count: 3, empty: "", name: "alpha"};
		expect({
			present: inputString(input, "name"),
			emptyString: inputString(input, "empty", "name"),
			skipsNonString: inputString(input, "count", "name"),
			skipsMissing: inputString(input, "missing", "name"),
			none: inputString(input, "missing", "count"),
		}).toEqual({
			present: "alpha",
			emptyString: "",
			skipsNonString: "alpha",
			skipsMissing: "alpha",
			none: undefined,
		});
	});
});
