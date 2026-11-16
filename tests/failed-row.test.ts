import {describe, expect, it} from "vite-plus/test";

import {isFailedUnacked} from "../src/lib/failed-row";

const F = "2026-11-06T10:00:00.000Z";
const M = "2026-11-06T10:05:00.000Z";

describe("isFailedUnacked", () =>
{
	it("holds a failed row until an ack covers its mtime or its failure (upstream `Q$`)", () =>
	{
		const row =
		{
			failedAt: F,
			mtime: M,
			archived: false,
		};
		expect([
			isFailedUnacked(row, undefined),
			isFailedUnacked(row, Date.parse(M)),
			isFailedUnacked(
				{
					...row,
					mtime: "2026-11-06T10:09:00.000Z",
				},
				Date.parse(F),
			),
			isFailedUnacked(row, Date.parse(F) - 1),
			isFailedUnacked(
				{
					mtime: M,
					archived: false,
				},
				undefined,
			),
			isFailedUnacked(
				{
					...row,
					archived: true,
				},
				undefined,
			),
		]).toStrictEqual([true, false, false, true, false, false]);
	});
});
