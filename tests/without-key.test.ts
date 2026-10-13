import {withoutKey} from "../src/lib/without-key";

describe("withoutKey", () => {
	it("returns a copy without the key and leaves the input untouched", () => {
		const input = {a: 1, b: 2};
		expect(withoutKey(input, "a")).toStrictEqual({b: 2});
		expect(input).toStrictEqual({a: 1, b: 2});
	});

	it("returns an equal copy when the key is absent", () => {
		expect(withoutKey({a: 1}, "z")).toStrictEqual({a: 1});
	});
});
