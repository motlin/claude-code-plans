import {describe, expect, it} from "vite-plus/test";

import {SessionStateKindSchema} from "../src/lib/session-state";
import {rowAttention} from "../src/components/use-row-icon-kind";

describe("rowAttention", () =>
{
	it("follows upstream vW: waiting/unread on live rows, nothing on running or archived rows", () =>
	{
		const table = Object.fromEntries(
			SessionStateKindSchema.options.map((kind) => [
				kind,
				{
					live: rowAttention(
						{
							kind,
							archived: false,
						},
					),
					archived: rowAttention(
						{
							kind,
							archived: true,
						},
					),
				},
			]),
		);
		expect(table).toStrictEqual(
			{
				awaiting:
				{
					live: "waiting",
					archived: undefined,
				},
				running:
				{
					live: undefined,
					archived: undefined,
				},
				ready:
				{
					live: "unread",
					archived: undefined,
				},
				error:
				{
					live: undefined,
					archived: undefined,
				},
				idle:
				{
					live: undefined,
					archived: undefined,
				},
			},
		);
	});
});
