import {describe, expect, it} from "vite-plus/test";
import {nonEmpty} from "../src/lib/non-empty";

describe("nonEmpty", () => {
	it("maps missing and empty strings to undefined and keeps everything else", () => {
		expect([undefined, null, "", " ", "a"].map((value) => nonEmpty(value))).toStrictEqual([
			undefined,
			undefined,
			undefined,
			" ",
			"a",
		]);
	});
});
