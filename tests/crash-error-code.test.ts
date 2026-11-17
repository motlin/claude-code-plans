import {describe, expect, it} from "vite-plus/test";
import {crashErrorCode, normalizeCrashMessage} from "../src/lib/crash-error-code";

// Expected values come from a Node run of upstream's w1/dh/Of/tU (shared-l-p-m-w-5, bundle 2026-11-10) as the oracle.
describe("crashErrorCode", () =>
{
	it("hashes upstream's normalised name:message to a 7-character base-36 code", () =>
	{
		expect([
			crashErrorCode(new TypeError("Cannot read properties of undefined (reading 'x')")),
			crashErrorCode(
				Object.assign(
					new Error("Failed at https://a.b/c for 123e4567-e89b-12d3-a456-426614174000"),
					{
						digest: "abc",
					},
				),
			),
			crashErrorCode(
				Object.assign(
					new Error(""),
					{
						name: "",
					},
				),
			),
		]).toStrictEqual([
			{
				code: "13YE7Z0",
				displayCode: "13YE7Z0",
			},
			{
				code: "1KD17L5",
				displayCode: "1KD17L5.abc",
			},
			{
				code: "1HED6JX",
				displayCode: "1HED6JX",
			},
		]);
	});

	it("normalises uuids, links, chunks, addresses, hashes and short identifiers like upstream's dh", () =>
	{
		expect(
			normalizeCrashMessage(
				"Failed at https://a.b/c for 123e4567-e89b-12d3-a456-426614174000 index-BDcv5SmC.js 10.0.0.1 deadbeefdeadbeef00",
			),
		).toBe("Failed _ <link> _ <uuid> <chunk>._ <addr> <hash>");
	});
});
