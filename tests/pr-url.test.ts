import {describe, expect, it} from "vite-plus/test";

import {prHostLabel} from "../src/lib/pr-url";

// Upstream `nm`: "GitHub" for github.com or an unparsable URL, otherwise the raw hostname.
describe("prHostLabel", () =>
{
	it("names GitHub, another forge's hostname, or GitHub for a URL that does not parse", () =>
	{
		expect(
			["https://github.com/o/r/pull/56", "https://gitlab.example.com/x/-/merge_requests/3", "not a url"].map(
				prHostLabel,
			),
		).toStrictEqual(["GitHub", "gitlab.example.com", "GitHub"]);
	});
});
