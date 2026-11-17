import {describe, expect, it} from "vite-plus/test";

import {firstStrongDir} from "../src/lib/text-direction";

describe("firstStrongDir (upstream shared-33 Gz)", () =>
{
	it("returns the first strong direction within the limit", () =>
	{
		expect([
			firstStrongDir("123 abc"),
			firstStrongDir("١٢٣"),
			firstStrongDir("..."),
			firstStrongDir("12 ש a"),
			firstStrongDir("1234a", 4),
			firstStrongDir("‏"),
			firstStrongDir("‎"),
		]).toStrictEqual(["ltr", "rtl", undefined, "rtl", undefined, "rtl", "ltr"]);
	});
});
