import {describe, expect, it, vi, afterEach} from "vite-plus/test";
import {QueryClient} from "@tanstack/react-query";
import
{
	fetchEarlierTranscript,
	hasEarlierTranscript,
	mergeTranscriptData,
	sessionQueryKeys,
	transcriptEndIndex,
	type TranscriptData,
} from "../src/lib/api/sessions";

/**
 * Tests for the client half of transcript windowing in
 * `src/lib/api/sessions.ts`. The endpoint serves the tail of a long session, so
 * the cache is a window over the JSONL: merges are keyed by each record's index
 * in the file, and `fetchEarlierTranscript` pulls the page before the window.
 */

afterEach(() =>
{
	vi.restoreAllMocks();
});

function record(index: number): Record<string, unknown>
{
	return {
		type: "user",
		uuid: `u-${index}`,
		message:
		{
			role: "user",
			content: `m${index}`,
		},
	};
}

/** The record index named by a request's `?beforeUuid=u-<index>`. */
function beforeIndex(input: unknown): number
{
	return Number(new URL(String(input)).searchParams.get("beforeUuid")?.slice("u-".length));
}

function jsonResponse(body: unknown, status = 200): Response
{
	return new Response(
		JSON.stringify(body),
		{
			status,
			headers:
			{
				"Content-Type": "application/json",
			},
		},
	);
}

function requestedPaths(fetchSpy: {
	mock:
	{
		calls: unknown[][];
	};
}): string[]
{
	return fetchSpy.mock.calls.map((call) =>
	{
		const url = new URL(String(call[0]));
		return url.pathname + url.search;
	});
}

function window_(startIndex: number, count: number, overrides?: Partial<TranscriptData>)
{
	return {
		records: Array.from(
			{
				length: count,
			},
			(_, i) => record(startIndex + i),
		),
		byteOffset: 0,
		startIndex,
		precedingMessageCount: startIndex,
		hiddenUuids: [],
		cuts: [],
		chainVersion: "v1",
		chapters: [],
		goalRows: [],
		...overrides,
	};
}

describe("mergeTranscriptData", () =>
{
	it("unions both pages' hidden uuids and cuts and keeps the primary's chain version", () =>
	{
		const cut =
		{
			parentUuid: "u-0",
			replacementUuid: "u-4",
			at: "2026-10-20T10:05:00.000Z",
			count: 2,
		};
		const tail = window_(
			3,
			2,
			{
				hiddenUuids: ["u-3"],
				cuts: [cut],
				chainVersion: "v2",
			},
		);
		const earlier = window_(
			0,
			3,
			{
				hiddenUuids: ["u-2", "u-3"],
				cuts: [cut],
			},
		);

		expect(mergeTranscriptData(tail, earlier)).toStrictEqual(
			{
				records: [record(0), record(1), record(2), record(3), record(4)],
				byteOffset: 0,
				startIndex: 0,
				precedingMessageCount: 0,
				hiddenUuids: ["u-3", "u-2"],
				cuts: [cut],
				chainVersion: "v2",
				chapters: [],
				goalRows: [],
			},
		);
	});

	it("keeps an earlier page ahead of the tail it was paged back from", () =>
	{
		const tail = window_(
			3,
			2,
			{
				byteOffset: 900,
			},
		);
		const earlier = window_(0, 3);

		expect(mergeTranscriptData(tail, earlier)).toStrictEqual(
			{
				records: [record(0), record(1), record(2), record(3), record(4)],
				byteOffset: 900,
				startIndex: 0,
				precedingMessageCount: 0,
				hiddenUuids: [],
				cuts: [],
				chainVersion: "v1",
				chapters: [],
				goalRows: [],
			},
		);
	});

	it("takes the primary window's copy of an overlapping record", () =>
	{
		const refreshed =
		{
			...window_(1, 2),
			records: [
				{
					...record(1),
					edited: true,
				},
				record(2),
			],
		};

		expect(mergeTranscriptData(refreshed, window_(0, 3)).records).toStrictEqual([
			record(0),
			{
				...record(1),
				edited: true,
			},
			record(2),
		]);
	});

	it("drops a stale window that no longer touches the newest records", () =>
	{
		// A long gap means the client missed records; rendering across the hole
		// would silently splice unrelated turns together.
		expect(mergeTranscriptData(window_(50, 2), window_(0, 3))).toStrictEqual(
			{
				records: [record(50), record(51)],
				byteOffset: 0,
				startIndex: 50,
				precedingMessageCount: 50,
				hiddenUuids: [],
				cuts: [],
				chainVersion: "v1",
				chapters: [],
				goalRows: [],
			},
		);
	});

	it("never repeats a record that both windows carry under different indices", () =>
	{
		const shifted =
		{
			...window_(2, 1),
			records: [record(1)],
		};

		expect(mergeTranscriptData(shifted, window_(0, 2)).records).toStrictEqual([record(0), record(1)]);
	});

	it("keeps every held record when a re-broadcast of already-seen lines precedes an append", () =>
	{
		// The watcher re-sends lines the window already holds, so the dedupe drops
		// them; the next append must not land on top of the records that survived.
		const cached = window_(0, 5);

		const rebroadcast = mergeTranscriptData(
			cached,
			{
				records: [record(3), record(4)],
				byteOffset: cached.byteOffset,
				startIndex: transcriptEndIndex(cached),
				precedingMessageCount: cached.precedingMessageCount,
				hiddenUuids: [],
				cuts: [],
				chainVersion: cached.chainVersion,
				chapters: [],
				goalRows: [],
			},
		);
		const appended = mergeTranscriptData(
			rebroadcast,
			{
				records: [record(5), record(6)],
				byteOffset: rebroadcast.byteOffset,
				startIndex: transcriptEndIndex(rebroadcast),
				precedingMessageCount: rebroadcast.precedingMessageCount,
				hiddenUuids: [],
				cuts: [],
				chainVersion: rebroadcast.chainVersion,
				chapters: [],
				goalRows: [],
			},
		);

		expect(appended).toStrictEqual(
			{
				records: [record(0), record(1), record(2), record(3), record(4), record(5), record(6)],
				byteOffset: 0,
				startIndex: 0,
				precedingMessageCount: 0,
				hiddenUuids: [],
				cuts: [],
				chainVersion: "v1",
				chapters: [],
				goalRows: [],
			},
		);
	});
});

describe("fetchEarlierTranscript", () =>
{
	it("requests the page before the cached window and prepends it", async () =>
	{
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(
			queryKey,
			window_(
				3,
				2,
				{
					byteOffset: 900,
				},
			),
		);
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify(window_(0, 3)),
				{
					status: 200,
					headers:
					{
						"Content-Type": "application/json",
					},
				},
			),
		);

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(
			fetchSpy.mock.calls.map((call) =>
			{
				const url = new URL(String(call[0]));
				return url.pathname + url.search;
			}),
		).toStrictEqual(["/api/sessions/sess-1/transcript?beforeUuid=u-3"]);
		expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual(
			{
				records: [record(0), record(1), record(2), record(3), record(4)],
				byteOffset: 900,
				startIndex: 0,
				precedingMessageCount: 0,
				hiddenUuids: [],
				cuts: [],
				chainVersion: "v1",
				chapters: [],
				goalRows: [],
			},
		);
	});

	it("serves concurrent callers one request for the same page", async () =>
	{
		// The scroll sentinel and the deep-link anchor both page backwards, and
		// they page over the same window, so two overlapping asks for the page
		// before it must not become two trips to the server.
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(
			queryKey,
			window_(
				3,
				2,
				{
					byteOffset: 900,
				},
			),
		);
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			Promise.resolve(
				new Response(
					JSON.stringify(window_(0, 3)),
					{
						status: 200,
						headers:
						{
							"Content-Type": "application/json",
						},
					},
				),
			),
		);

		await Promise.all([
			fetchEarlierTranscript(queryClient, "sess-1"),
			fetchEarlierTranscript(queryClient, "sess-1"),
		]);

		expect(fetchSpy.mock.calls.length).toBe(1);
		expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual(
			{
				records: [record(0), record(1), record(2), record(3), record(4)],
				byteOffset: 900,
				startIndex: 0,
				precedingMessageCount: 0,
				hiddenUuids: [],
				cuts: [],
				chainVersion: "v1",
				chapters: [],
				goalRows: [],
			},
		);
	});

	it("pages again once the previous page has landed", async () =>
	{
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(4, 1));
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
		{
			const before = beforeIndex(input);
			return Promise.resolve(
				new Response(
					JSON.stringify(window_(before - 2, 2)),
					{
						status: 200,
						headers:
						{
							"Content-Type": "application/json",
						},
					},
				),
			);
		});

		await fetchEarlierTranscript(queryClient, "sess-1");
		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(queryClient.getQueryData<TranscriptData>(queryKey)?.startIndex).toBe(0);
	});

	it("does not call the endpoint when the window already starts at the first record", async () =>
	{
		const queryClient = new QueryClient();
		queryClient.setQueryData(sessionQueryKeys.transcript("sess-1"), window_(0, 3));
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(fetchSpy.mock.calls).toStrictEqual([]);
	});

	it("discards a page that lands after the chain changed and pages again from the new window", async () =>
	{
		// A forking prompt replaced the cached pages with the new tail while an
		// earlier page was on the wire. That page was cut under the old chain, so
		// its hidden rows are wrong (upstream `discarded_in_flight`).
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(3, 2));
		let resolveStale: (response: Response) => void = () =>
		{
		};
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
		{
			const before = beforeIndex(input);
			if (before === 3)
			{
				return new Promise<Response>((resolve) =>
				{
					resolveStale = resolve;
				});
			}
			return Promise.resolve(
				new Response(
					JSON.stringify(
						window_(
							4,
							2,
							{
								chainVersion: "v2",
							},
						),
					),
					{
						status: 200,
						headers:
						{
							"Content-Type": "application/json",
						},
					},
				),
			);
		});

		const pending = fetchEarlierTranscript(queryClient, "sess-1");
		await vi.waitFor(() =>
		{
			expect(fetchSpy.mock.calls.length).toBe(1);
		});
		queryClient.setQueryData(
			queryKey,
			window_(
				6,
				2,
				{
					chainVersion: "v2",
				},
			),
		);
		resolveStale(
			new Response(
				JSON.stringify(window_(0, 3)),
				{
					status: 200,
					headers:
					{
						"Content-Type": "application/json",
					},
				},
			),
		);
		await pending;

		expect(
			fetchSpy.mock.calls.map((call) =>
			{
				const url = new URL(String(call[0]));
				return url.pathname + url.search;
			}),
		).toStrictEqual([
			"/api/sessions/sess-1/transcript?beforeUuid=u-3",
			"/api/sessions/sess-1/transcript?beforeUuid=u-6",
		]);
		expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual(
			{
				records: [record(4), record(5), record(6), record(7)],
				byteOffset: 0,
				startIndex: 4,
				precedingMessageCount: 4,
				hiddenUuids: [],
				cuts: [],
				chainVersion: "v2",
				chapters: [],
				goalRows: [],
			},
		);
	});

	it("discards a page cut under a newer chain than the cache and refetches the tail", async () =>
	{
		// The server saw the fork before the cache did: merging would splice a
		// post-fork page onto pre-fork rows, so the tail is refetched instead.
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(3, 2));
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify(
					window_(
						0,
						3,
						{
							chainVersion: "v2",
						},
					),
				),
				{
					status: 200,
					headers:
					{
						"Content-Type": "application/json",
					},
				},
			),
		);

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual(window_(3, 2));
		expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
	});

	it("does not call the endpoint when nothing is cached yet", async () =>
	{
		const queryClient = new QueryClient();
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(fetchSpy.mock.calls).toStrictEqual([]);
	});
});

describe("fetchEarlierTranscript lost cursors", () =>
{
	const NOT_FOUND =
	{
		found: false,
	};

	it("pages before the window's first cursor row by uuid", async () =>
	{
		const queryClient = new QueryClient();
		queryClient.setQueryData(sessionQueryKeys.transcript("sess-1"), window_(10, 3));
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Promise.resolve(jsonResponse(window_(8, 2))));

		const outcome = await fetchEarlierTranscript(queryClient, "sess-1");

		expect(
			{
				outcome,
				paths: requestedPaths(fetchSpy),
			},
		).toStrictEqual(
			{
				outcome: "merged",
				paths: ["/api/sessions/sess-1/transcript?beforeUuid=u-10"],
			},
		);
	});

	it("retries with the next held cursor row after a lost one and keeps the page", async () =>
	{
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(10, 3));
		const responses = [jsonResponse(NOT_FOUND, 404), jsonResponse(window_(8, 2))];
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Promise.resolve(responses.shift()!));

		const outcome = await fetchEarlierTranscript(queryClient, "sess-1");

		// u-10 is gone from the file: the page lands ahead of u-11, and u-10 goes with it.
		expect(
			{
				outcome,
				paths: requestedPaths(fetchSpy),
				window: queryClient.getQueryData<TranscriptData>(queryKey),
			},
		).toStrictEqual(
			{
				outcome: "cursor_recovered",
				paths: [
					"/api/sessions/sess-1/transcript?beforeUuid=u-10",
					"/api/sessions/sess-1/transcript?beforeUuid=u-11",
				],
				window: window_(
					8,
					4,
					{
						records: [record(8), record(9), record(11), record(12)],
					},
				),
			},
		);
	});

	it("gives up after three retries, leaving the window as it was", async () =>
	{
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(10, 5));
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Promise.resolve(jsonResponse(NOT_FOUND, 404)));

		const outcome = await fetchEarlierTranscript(queryClient, "sess-1");
		const again = await fetchEarlierTranscript(queryClient, "sess-1");

		expect(
			{
				outcome,
				again,
				paths: requestedPaths(fetchSpy),
				window: queryClient.getQueryData<TranscriptData>(queryKey),
				hasEarlier: hasEarlierTranscript(queryClient, "sess-1", window_(10, 5)),
			},
		).toStrictEqual(
			{
				outcome: "cursor_lost",
				again: undefined,
				paths: [
					"/api/sessions/sess-1/transcript?beforeUuid=u-10",
					"/api/sessions/sess-1/transcript?beforeUuid=u-11",
					"/api/sessions/sess-1/transcript?beforeUuid=u-12",
					"/api/sessions/sess-1/transcript?beforeUuid=u-13",
				],
				window: window_(10, 5),
				hasEarlier: false,
			},
		);
	});

	it("pages again once the chain changes after a lost cursor", async () =>
	{
		const queryClient = new QueryClient();
		queryClient.setQueryData(sessionQueryKeys.transcript("sess-1"), window_(10, 1));
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Promise.resolve(jsonResponse(NOT_FOUND, 404)));

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(
			hasEarlierTranscript(
				queryClient,
				"sess-1",
				window_(
					10,
					1,
					{
						chainVersion: "v2",
					},
				),
			),
		).toBe(true);
	});

	it("lands a page served for a file that shifted under the window, keyed from where the page ends", async () =>
	{
		// A line above the window was removed: the cache still says u-10 is record
		// 10, but the file now has it at line 9, so the page is lines 0-8.
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(10, 2));
		const page = window_(
			0,
			9,
			{
				records: [0, 1, 2, 4, 5, 6, 7, 8, 9].map((index) => record(index)),
			},
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Promise.resolve(jsonResponse(page)));

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual(
			window_(
				0,
				11,
				{
					records: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11].map((index) => record(index)),
				},
			),
		);
	});

	it("reports nothing above when the page before the cursor is empty and the window reaches the start", async () =>
	{
		const queryClient = new QueryClient();
		const queryKey = sessionQueryKeys.transcript("sess-1");
		queryClient.setQueryData(queryKey, window_(3, 2));
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Promise.resolve(jsonResponse(window_(0, 0))));

		const outcome = await fetchEarlierTranscript(queryClient, "sess-1");

		expect(
			{
				outcome,
				window: queryClient.getQueryData<TranscriptData>(queryKey),
			},
		).toStrictEqual(
			{
				outcome: "nothing_above",
				window: window_(
					0,
					2,
					{
						records: [record(3), record(4)],
					},
				),
			},
		);
	});

	it("passes over rows that can't anchor a page", async () =>
	{
		const queryClient = new QueryClient();
		const thinkingOnly =
		{
			type: "assistant",
			uuid: "a-thinking",
			message:
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "hm",
					},
				],
			},
		};
		queryClient.setQueryData(
			sessionQueryKeys.transcript("sess-1"),
			window_(
				10,
				4,
				{
					records: [
						{
							type: "file-history-snapshot",
							messageId: "m",
						},
						{
							...record(11),
							uuid: "client-1",
						},
						thinkingOnly,
						{
							...record(13),
							isCompactSummary: true,
						},
						record(14),
					],
				},
			),
		);
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Promise.resolve(jsonResponse(window_(0, 0))));

		await fetchEarlierTranscript(queryClient, "sess-1");

		expect(requestedPaths(fetchSpy)).toStrictEqual(["/api/sessions/sess-1/transcript?beforeUuid=u-14"]);
	});
});
