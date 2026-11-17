import {describe, expect, it} from "vite-plus/test";

import {SessionStateKindSchema} from "../src/lib/session-state";
import {rowAttention} from "../src/components/use-row-icon-kind";

describe("rowAttention", () =>
{
	it("follows upstream vW: waiting/unread always, working only while moving, nothing on archived rows", () =>
	{
		const table = Object.fromEntries(
			SessionStateKindSchema.options.map((kind) => [
				kind,
				{
					moving: rowAttention(
						{
							kind,
							archived: false,
							motion: "moving",
						},
					),
					still: rowAttention(
						{
							kind,
							archived: false,
							motion: "still",
						},
					),
					archivedMoving: rowAttention(
						{
							kind,
							archived: true,
							motion: "moving",
						},
					),
					archivedStill: rowAttention(
						{
							kind,
							archived: true,
							motion: "still",
						},
					),
				},
			]),
		);
		expect(table).toStrictEqual(
			{
				awaiting:
				{
					moving: "waiting",
					still: "waiting",
					archivedMoving: undefined,
					archivedStill: undefined,
				},
				running:
				{
					moving: "working",
					still: undefined,
					archivedMoving: undefined,
					archivedStill: undefined,
				},
				ready:
				{
					moving: "unread",
					still: "unread",
					archivedMoving: undefined,
					archivedStill: undefined,
				},
				error:
				{
					moving: undefined,
					still: undefined,
					archivedMoving: undefined,
					archivedStill: undefined,
				},
				idle:
				{
					moving: undefined,
					still: undefined,
					archivedMoving: undefined,
					archivedStill: undefined,
				},
			},
		);
	});
});
