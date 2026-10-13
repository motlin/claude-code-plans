import {asRecord, errnoCode, errorMessage, isKeyOf, isRecord, objectKeys} from "../src/lib/narrow";

describe("isRecord", () => {
	it("accepts non-null objects and arrays, rejects primitives and null", () => {
		expect([{}, [], null, "x", 1, undefined].map(isRecord)).toEqual([true, true, false, false, false, false]);
	});
});

describe("asRecord", () => {
	it("returns plain objects and drops arrays, null, and primitives", () => {
		const value = {a: 1};
		expect([value, [], null, "x"].map(asRecord)).toEqual([value, undefined, undefined, undefined]);
	});
});

describe("errorMessage", () => {
	it("reads Error messages and stringifies anything else", () => {
		expect([new SyntaxError("bad"), "plain", 42].map(errorMessage)).toEqual(["bad", "plain", "42"]);
	});
});

describe("errnoCode", () => {
	it("reads a string code from errors and ignores everything else", () => {
		const enoent = Object.assign(new Error("missing"), {code: "ENOENT"});
		const numeric = Object.assign(new Error("odd"), {code: 5});
		expect([enoent, numeric, new Error("none"), "ENOENT", null].map(errnoCode)).toEqual([
			"ENOENT",
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});
});

describe("objectKeys", () => {
	it("lists own keys", () => {
		expect(objectKeys({a: 1, b: 2})).toEqual(["a", "b"]);
	});
});

describe("isKeyOf", () => {
	it("accepts own keys only", () => {
		const labels = {one: "One"};
		expect(["one", "toString", "two"].map((key) => isKeyOf(labels, key))).toEqual([true, false, false]);
	});
});
