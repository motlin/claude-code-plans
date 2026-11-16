import {describe, expect, it} from "vite-plus/test";

import {familyFoldState} from "../src/lib/palette-nested-sessions";

describe("familyFoldState", () =>
{
	// Upstream `sS`: counts folded keys among the listed heads only.
	it.each([
		{
			heads: null,
			collapsed: [],
			expected:
			{
				anyHidden: false,
				anyShown: false,
			},
		},
		{
			heads: [],
			collapsed: ["code:h1"],
			expected:
			{
				anyHidden: false,
				anyShown: false,
			},
		},
		{
			heads: ["h1", "h2"],
			collapsed: [],
			expected:
			{
				anyHidden: false,
				anyShown: true,
			},
		},
		{
			heads: ["h1", "h2"],
			collapsed: ["code:h1"],
			expected:
			{
				anyHidden: true,
				anyShown: true,
			},
		},
		{
			heads: ["h1", "h2"],
			collapsed: ["code:h1", "code:h2"],
			expected:
			{
				anyHidden: true,
				anyShown: false,
			},
		},
		{
			heads: ["h1", "h2"],
			collapsed: ["code:other"],
			expected:
			{
				anyHidden: false,
				anyShown: true,
			},
		},
	])("heads $heads with $collapsed folded → $expected", ({heads, collapsed, expected}) =>
	{
		expect(familyFoldState(heads, collapsed)).toStrictEqual(expected);
	});
});
