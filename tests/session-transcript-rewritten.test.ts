import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryObserver} from "@tanstack/react-query";
import {applySessionLinesAppended, applySessionTranscriptRewritten} from "../src/hooks/use-claude-events";
import {
	sessionQueryKeys,
	transcriptEndIndex,
	transcriptQueryOptions,
	type TranscriptData,
} from "../src/lib/api/sessions";
import type {JsonValue} from "../src/lib/hook-events";

/**
 * The CLI removed or rewrote lines the client already holds (a retracted
 * streaming attempt, a compaction). Upstream's desktop host re-snapshots the
 * transcript by uuid; locally the server broadcasts
 * `session:transcript-rewritten` and the client replaces its cached window with
 * a fresh tail instead of merging by index.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

const SESSION = "sess-rewritten";

type TranscriptRecord = {[key: string]: JsonValue};

function row(index: number): TranscriptRecord {
	return {type: "user", uuid: `u-${index}`, message: {role: "user", content: `turn ${index}`}};
}

function rows(...indices: number[]): TranscriptRecord[] {
	return indices.map(row);
}

function transcript(records: TranscriptRecord[], startIndex: number): TranscriptData {
	return {
		records,
		byteOffset: 1000 + startIndex + records.length,
		startIndex,
		precedingMessageCount: startIndex,
		hiddenUuids: [],
		cuts: [],
		chainVersion: "v-1",
		chapters: [],
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {status: 200, headers: {"Content-Type": "application/json"}});
}

/** A client with the transcript cached and observed, as the session page holds it. */
function observedClient(data: TranscriptData): {queryClient: QueryClient; unsubscribe: () => void} {
	const queryClient = new QueryClient();
	queryClient.setQueryData(sessionQueryKeys.transcript(SESSION), data);
	const observer = new QueryObserver(queryClient, transcriptQueryOptions(SESSION));
	const unsubscribe = observer.subscribe(() => undefined);
	return {queryClient, unsubscribe};
}

describe("applySessionTranscriptRewritten", () => {
	it("replaces the cached window with the fetched tail, dropping the retracted row", async () => {
		const fresh = transcript(rows(0, 1, 2, 4, 5, 6), 0);
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Promise.resolve(jsonResponse(fresh)));
		const {queryClient, unsubscribe} = observedClient(transcript(rows(0, 1, 2, 3, 4, 5), 0));

		await applySessionTranscriptRewritten(queryClient, SESSION);

		const cached = queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript(SESSION));
		expect(fetchSpy.mock.calls.map((call) => new URL(String(call[0]), "http://localhost").pathname)).toStrictEqual([
			`/api/sessions/${SESSION}/transcript`,
		]);
		expect(cached).toStrictEqual(fresh);
		expect(transcriptEndIndex(cached!)).toBe(6);
		unsubscribe();
	});

	it("drops earlier pages, keeping only the fetched tail", async () => {
		const fresh = transcript(rows(399, 400, 401), 399);
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Promise.resolve(jsonResponse(fresh)));
		const earlierAndTail = transcript(
			Array.from({length: 400}, (_, index) => row(index)),
			0,
		);
		const {queryClient, unsubscribe} = observedClient(earlierAndTail);

		await applySessionTranscriptRewritten(queryClient, SESSION);

		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual(fresh);
		unsubscribe();
	});

	it("does not merge appended lines into the old window while the replacement is in flight", async () => {
		const fresh = transcript(rows(0, 1, 2, 4, 5, 6), 0);
		let respond: (response: Response) => void = () => undefined;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		);
		const old = transcript(rows(0, 1, 2, 3, 4, 5), 0);
		const {queryClient, unsubscribe} = observedClient(old);

		const replacing = applySessionTranscriptRewritten(queryClient, SESSION);
		const firstLine = applySessionLinesAppended(queryClient, SESSION, {sessionId: SESSION, lines: [row(6)]});

		expect(firstLine).toBeNull();
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual(old);
		await vi.waitFor(() => {
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		});
		respond(jsonResponse(fresh));
		await replacing;
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual(fresh);
		expect(applySessionLinesAppended(queryClient, SESSION, {sessionId: SESSION, lines: [row(7)]})).toBe(6);
		unsubscribe();
	});

	it("fetches nothing when no transcript is cached", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const queryClient = new QueryClient();

		await applySessionTranscriptRewritten(queryClient, SESSION);

		expect({
			calls: fetchSpy.mock.calls.length,
			cached: queryClient.getQueryData(sessionQueryKeys.transcript(SESSION)),
		}).toStrictEqual({calls: 0, cached: undefined});
	});
});
