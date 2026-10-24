import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryObserver} from "@tanstack/react-query";
import {applySessionLinesAppended} from "../src/hooks/use-claude-events";
import {sessionQueryKeys, transcriptQueryOptions, type TranscriptData} from "../src/lib/api/sessions";
import type {JsonValue} from "../src/lib/hook-events";

type TranscriptRecord = {[key: string]: JsonValue};

/**
 * A live fork: the CLI appends a prompt re-parented onto an earlier turn (a
 * pull-back and resend, or an interrupt followed by a new prompt). Only the
 * server knows the whole file's chain, so the append is not merged; the tail
 * is refetched, and a response whose chainVersion differs replaces the cached
 * window, retiring earlier pages (upstream `verify_rewind` →
 * `fetchFullTranscript` + `retireEarlierTranscript`).
 */

afterEach(() => {
	vi.restoreAllMocks();
});

const SESSION = "sess-fork";

function prompt(uuid: string, parentUuid: string, text: string): TranscriptRecord {
	return {
		type: "user",
		uuid,
		parentUuid,
		isSidechain: false,
		timestamp: "1999-12-31T00:00:00.000Z",
		message: {role: "user", content: text},
	};
}

function assistant(uuid: string, parentUuid: string, content: JsonValue[]): TranscriptRecord {
	return {
		type: "assistant",
		uuid,
		parentUuid,
		isSidechain: false,
		timestamp: "1999-12-31T00:00:01.000Z",
		message: {role: "assistant", content},
	};
}

function toolResult(uuid: string, parentUuid: string, toolUseId: string): TranscriptRecord {
	return {
		type: "user",
		uuid,
		parentUuid,
		isSidechain: false,
		timestamp: "1999-12-31T00:00:02.000Z",
		message: {role: "user", content: [{type: "tool_result", tool_use_id: toolUseId, content: "ok"}]},
	};
}

const p1 = prompt("p-1", "root", "do chapter 1");
const a1 = assistant("a-1", "p-1", [{type: "text", text: "chapter 1 done"}]);
const p2 = prompt("p-2", "a-1", "do chapter 2");
const a2 = assistant("a-2", "p-2", [{type: "text", text: "starting chapter 2"}]);

/** Two pages already merged: an earlier page (10-11) and the tail (12-13). */
const twoPages: TranscriptData = {
	records: [p1, a1, p2, a2],
	byteOffset: 4000,
	startIndex: 10,
	precedingMessageCount: 7,
	hiddenUuids: [],
	cuts: [],
	chainVersion: "v-linear",
};

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {status: 200, headers: {"Content-Type": "application/json"}});
}

function requestedPaths(fetchSpy: {mock: {calls: unknown[][]}}): string[] {
	return fetchSpy.mock.calls.map((call) => {
		const url = new URL(String(call[0]), "http://localhost");
		return url.pathname + url.search;
	});
}

/** A client with the transcript cached and observed, as the session page holds it. */
function observedClient(data: TranscriptData): {queryClient: QueryClient; unsubscribe: () => void} {
	const queryClient = new QueryClient();
	queryClient.setQueryData(sessionQueryKeys.transcript(SESSION), data);
	const observer = new QueryObserver(queryClient, transcriptQueryOptions(SESSION));
	const unsubscribe = observer.subscribe(() => undefined);
	return {queryClient, unsubscribe};
}

async function settle(queryClient: QueryClient): Promise<void> {
	await vi.waitFor(() => {
		expect(queryClient.isFetching()).toBe(0);
	});
}

describe("applySessionLinesAppended on a live fork", () => {
	it("refetches the tail and replaces the cached window, retiring the earlier page", async () => {
		const p3 = prompt("p-3", "a-1", "do chapter 3");
		const tail: TranscriptData = {
			records: [p2, a2, p3],
			byteOffset: 4400,
			startIndex: 12,
			precedingMessageCount: 8,
			hiddenUuids: ["p-2", "a-2"],
			cuts: [{parentUuid: "a-1", replacementUuid: "p-3", at: "1999-12-31T00:00:00.000Z", count: 2}],
			chainVersion: "v-forked",
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Promise.resolve(jsonResponse(tail)));
		const {queryClient, unsubscribe} = observedClient(twoPages);

		const firstLine = applySessionLinesAppended(queryClient, SESSION, {sessionId: SESSION, lines: [p3]});

		expect(firstLine).toBe(14);
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual(twoPages);
		await settle(queryClient);
		expect(requestedPaths(fetchSpy)).toStrictEqual([`/api/sessions/${SESSION}/transcript`]);
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual(tail);
		unsubscribe();
	});

	it("merges a normal append onto the cached window without a refetch", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const {queryClient, unsubscribe} = observedClient(twoPages);
		const p3 = prompt("p-3", "a-2", "do chapter 3");

		applySessionLinesAppended(queryClient, SESSION, {sessionId: SESSION, lines: [p3]});

		await settle(queryClient);
		expect(requestedPaths(fetchSpy)).toStrictEqual([]);
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual({
			...twoPages,
			records: [p1, a1, p2, a2, p3],
		});
		unsubscribe();
	});

	it("does not refetch for a parallel tool result parented on an earlier assistant split", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const split1 = assistant("a-3a", "a-2", [{type: "tool_use", id: "toolu_1", name: "Read", input: {}}]);
		const split2 = assistant("a-3b", "a-3a", [{type: "tool_use", id: "toolu_2", name: "Read", input: {}}]);
		const cached: TranscriptData = {...twoPages, records: [p1, a1, p2, a2, split1, split2]};
		const {queryClient, unsubscribe} = observedClient(cached);
		const result1 = toolResult("r-1", "a-3a", "toolu_1");
		const result2 = toolResult("r-2", "a-3b", "toolu_2");

		applySessionLinesAppended(queryClient, SESSION, {sessionId: SESSION, lines: [result1, result2]});

		await settle(queryClient);
		expect(requestedPaths(fetchSpy)).toStrictEqual([]);
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual({
			...cached,
			records: [p1, a1, p2, a2, split1, split2, result1, result2],
		});
		unsubscribe();
	});

	it("keeps earlier pages when the refetched tail reports the same chain", async () => {
		const p3 = prompt("p-3", "a-1", "do chapter 3");
		const tail: TranscriptData = {
			records: [p2, a2, p3],
			byteOffset: 4400,
			startIndex: 12,
			precedingMessageCount: 8,
			hiddenUuids: [],
			cuts: [],
			chainVersion: "v-linear",
		};
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Promise.resolve(jsonResponse(tail)));
		const {queryClient, unsubscribe} = observedClient(twoPages);

		applySessionLinesAppended(queryClient, SESSION, {sessionId: SESSION, lines: [p3]});

		await settle(queryClient);
		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual({
			...tail,
			records: [p1, a1, p2, a2, p3],
			startIndex: 10,
			precedingMessageCount: 7,
		});
		unsubscribe();
	});
});

describe("transcriptQueryOptions refetch", () => {
	it("replaces the cached window when the chain version changed", async () => {
		const tail: TranscriptData = {
			records: [a2],
			byteOffset: 4400,
			startIndex: 13,
			precedingMessageCount: 8,
			hiddenUuids: ["a-2"],
			cuts: [],
			chainVersion: "v-switched",
		};
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Promise.resolve(jsonResponse(tail)));
		const {queryClient, unsubscribe} = observedClient(twoPages);

		await queryClient.refetchQueries({queryKey: sessionQueryKeys.transcript(SESSION)});

		expect(queryClient.getQueryData(sessionQueryKeys.transcript(SESSION))).toStrictEqual(tail);
		unsubscribe();
	});
});
