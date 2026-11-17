import {describe, expect, it} from "vite-plus/test";

import {sessionOutputStyle} from "../src/lib/session-output-style";

describe("sessionOutputStyle", () =>
{
	it("reads the statusline's output_style.name when it is a non-empty string", () =>
	{
		expect(
			[
				{
					output_style:
					{
						name: "Learning",
					},
				},
				{},
				{
					output_style:
					{
						name: "",
					},
				},
				null,
				{
					output_style: "Learning",
				},
			].map((statusline) => sessionOutputStyle(statusline)),
		).toStrictEqual(["Learning", undefined, undefined, undefined, undefined]);
	});
});
