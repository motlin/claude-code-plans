import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {appendClientRow, clearClientRows, readClientRows, subscribeClientRows} from "../src/lib/client-rows-store";

afterEach(() =>
{
	clearClientRows();
});

describe("client-rows-store", () =>
{
	it("keeps each session's rows in send order with distinct ids", () =>
	{
		appendClientRow(
			"s-1",
			{
				kind: "status",
				text: "/status",
				afterUuid: "u-2",
			},
			1000,
		);
		appendClientRow(
			"s-1",
			{
				kind: "usage",
				text: "/cost",
				afterUuid: null,
			},
			1000,
		);
		appendClientRow(
			"s-2",
			{
				kind: "status",
				text: "/status",
				afterUuid: "x",
			},
			2000,
		);

		expect(
			{
				s1: readClientRows("s-1"),
				s2: readClientRows("s-2"),
				none: readClientRows("s-3"),
			},
		).toEqual(
			{
				s1: [
					{
						id: "client-status-1000-1",
						kind: "status",
						text: "/status",
						afterUuid: "u-2",
						createdAt: 1000,
					},
					{
						id: "client-usage-1000-2",
						kind: "usage",
						text: "/cost",
						afterUuid: null,
						createdAt: 1000,
					},
				],
				s2: [
					{
						id: "client-status-2000-3",
						kind: "status",
						text: "/status",
						afterUuid: "x",
						createdAt: 2000,
					},
				],
				none: [],
			},
		);
	});

	it("returns the appended row and a stable snapshot until the next change", () =>
	{
		const row = appendClientRow(
			"s-1",
			{
				kind: "status",
				text: "/status",
				afterUuid: null,
			},
			5,
		);
		const snapshot = readClientRows("s-1");

		expect(
			{
				row,
				same: readClientRows("s-1") === snapshot,
				emptySame: readClientRows("s-9") === readClientRows("s-8"),
			},
		).toEqual(
			{
				row:
				{
					id: "client-status-5-1",
					kind: "status",
					text: "/status",
					afterUuid: null,
					createdAt: 5,
				},
				same: true,
				emptySame: true,
			},
		);
	});

	it("notifies subscribers on append and clear, and not after unsubscribing", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeClientRows(listener);
		appendClientRow(
			"s-1",
			{
				kind: "status",
				text: "/status",
				afterUuid: null,
			},
			1,
		);
		clearClientRows();
		unsubscribe();
		appendClientRow(
			"s-1",
			{
				kind: "status",
				text: "/status",
				afterUuid: null,
			},
			2,
		);

		expect(listener).toHaveBeenCalledTimes(2);
	});
});
