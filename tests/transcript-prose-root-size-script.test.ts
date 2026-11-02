import {describe, expect, it} from "vite-plus/test";
import {parseProseRootSizeArgs, proseRootSizeFailures, ROOT_FONT_SIZE_PX} from "../scripts/transcript-prose-root-size";

describe("ROOT_FONT_SIZE_PX", () =>
{
	it("zooms the root font size to 20px, where Medium's .875rem/1.42857 prose measures 17.5/25px", () =>
	{
		expect(ROOT_FONT_SIZE_PX).toBe(20);
	});
});

describe("proseRootSizeFailures", () =>
{
	it("passes Medium prose that scales with the root font size", () =>
	{
		expect(
			proseRootSizeFailures(
				{
					fontSize: 17.5,
					lineHeight: 24.9999,
				},
			),
		).toStrictEqual([]);
	});

	it("reports the pre-8451a349 px prose that ignored the root font size", () =>
	{
		expect(
			proseRootSizeFailures(
				{
					fontSize: 14,
					lineHeight: 20,
				},
			),
		).toStrictEqual([
			"prose font size 14px, expected 17.5px (±0.5)",
			"prose line height 20px, expected 25px (±0.5)",
		]);
	});
});

describe("parseProseRootSizeArgs", () =>
{
	it("defaults to the 7526 server and the first listed session", () =>
	{
		expect(parseProseRootSizeArgs([])).toStrictEqual(
			{
				baseUrl: "http://127.0.0.1:7526",
				session: null,
			},
		);
	});

	it("takes a base URL without its trailing slash and a session id", () =>
	{
		expect(parseProseRootSizeArgs(["--base-url", "http://127.0.0.1:7600/", "--session", "abc-123"])).toStrictEqual(
			{
				baseUrl: "http://127.0.0.1:7600",
				session: "abc-123",
			},
		);
	});

	it("rejects unknown and valueless arguments", () =>
	{
		expect(() => parseProseRootSizeArgs(["--port"])).toThrow("Unknown argument: --port");
		expect(() => parseProseRootSizeArgs(["--session"])).toThrow("--session needs a session id");
	});
});
