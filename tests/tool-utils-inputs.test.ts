import {inputBoolean, inputNumber, inputStringArray} from "../src/lib/tool-utils";

describe("typed tool input readers", () => {
	const input = {flag: true, count: 3, names: ["a", "b"], mixed: ["a", 1], text: "x"};

	it("reads booleans", () => {
		expect([inputBoolean(input, "flag"), inputBoolean(input, "text"), inputBoolean(input, "nope")]).toEqual([
			true,
			undefined,
			undefined,
		]);
	});

	it("reads finite numbers", () => {
		expect([inputNumber(input, "count"), inputNumber(input, "text"), inputNumber({n: Number.NaN}, "n")]).toEqual([
			3,
			undefined,
			undefined,
		]);
	});

	it("reads arrays of strings only", () => {
		expect([
			inputStringArray(input, "names"),
			inputStringArray(input, "mixed"),
			inputStringArray(input, "text"),
		]).toEqual([["a", "b"], undefined, undefined]);
	});
});
