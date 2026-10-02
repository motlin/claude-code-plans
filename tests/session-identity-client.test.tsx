// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useQuery} from "@tanstack/react-query";
import {act, cleanup, render, renderHook, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {IndexingBanner} from "../src/components/indexing-banner";
import {useSessionIdentity} from "../src/hooks/use-session-identity";
import {invalidateSessionIdentities} from "../src/lib/api/session-identity";
import {sessionDetailQueryOptions, sessionQueryKeys} from "../src/lib/api/sessions";

const ALIAS = "session_alice_100";
const ALICE = "session-alice";
const BOB = "session-bob";
let client: QueryClient;

function Wrapper({children}: {children: ReactNode}) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	client = new QueryClient({defaultOptions: {queries: {retry: false}}});
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function deferredResponse() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((accept) => {
		resolve = accept;
	});
	return {promise, resolve};
}

describe("shared session identity", () => {
	it("returns ordinary UUIDs immediately without a request or an identity cache entry", () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const {result, rerender} = renderHook(({id}) => useSessionIdentity(id), {
			initialProps: {id: ALICE as string | null},
			wrapper: Wrapper,
		});
		const local = result.current;
		rerender({id: null});
		expect({
			local,
			absent: result.current,
			requests: fetch.mock.calls,
			queries: client.getQueryCache().getAll(),
		}).toStrictEqual({local: ALICE, absent: null, requests: [], queries: []});
	});

	it("shares a pending alias lookup and never returns the alias as a local ID", async () => {
		const response = deferredResponse();
		const fetch = vi.fn().mockReturnValue(response.promise);
		vi.stubGlobal("fetch", fetch);
		const first = renderHook(() => useSessionIdentity(ALIAS), {wrapper: Wrapper});
		const second = renderHook(() => useSessionIdentity(ALIAS), {wrapper: Wrapper});
		expect([first.result.current, second.result.current]).toStrictEqual([null, null]);
		await act(async () => response.resolve(Response.json({sessionId: ALICE})));
		await waitFor(() => expect([first.result.current, second.result.current]).toStrictEqual([ALICE, ALICE]));
		expect(fetch.mock.calls.map(([url]) => url)).toStrictEqual([`/api/sessions/${ALIAS}/identity`]);
	});

	it.each([404, 409])("rejects cached identity after a fresh %s response without retrying", async (status) => {
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE});
		const fetch = vi.fn().mockResolvedValue(Response.json({error: "Example lookup failure"}, {status}));
		vi.stubGlobal("fetch", fetch);
		const {result} = renderHook(() => useSessionIdentity(ALIAS), {wrapper: Wrapper});
		expect(result.current).toBe(ALICE);
		await act(() => invalidateSessionIdentities(client));
		await waitFor(() => expect(result.current).toBe(null));
		expect(fetch.mock.calls.map(([url]) => url)).toStrictEqual([`/api/sessions/${ALIAS}/identity`]);
	});

	it("cancels an in-flight pre-index lookup so a late result cannot overwrite its replacement", async () => {
		const old = deferredResponse();
		const fetch = vi
			.fn()
			.mockReturnValueOnce(old.promise)
			.mockResolvedValue(Response.json({sessionId: BOB}));
		vi.stubGlobal("fetch", fetch);
		const {result} = renderHook(() => useSessionIdentity(ALIAS), {wrapper: Wrapper});
		const signal = (fetch.mock.calls[0]![1] as RequestInit).signal!;
		await act(() => invalidateSessionIdentities(client));
		await waitFor(() => expect(result.current).toBe(BOB));
		await act(async () => old.resolve(Response.json({sessionId: ALICE})));
		expect({
			aborted: signal.aborted,
			local: result.current,
			cached: client.getQueryData(sessionQueryKeys.identity(ALIAS)),
		}).toStrictEqual({aborted: true, local: BOB, cached: {sessionId: BOB}});
	});

	it("retries indexing-pending responses twice and then stops", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({}, {status: 503})));
		vi.stubGlobal("fetch", fetch);
		const {result} = renderHook(() => useSessionIdentity(ALIAS), {wrapper: Wrapper});
		await act(() => vi.advanceTimersByTimeAsync(6001));
		const requestsAfterRetries = fetch.mock.calls.length;
		await act(() => vi.advanceTimersByTimeAsync(30_000));
		expect({
			local: result.current,
			requestsAfterRetries,
			requestsAfterWaiting: fetch.mock.calls.length,
		}).toStrictEqual({local: null, requestsAfterRetries: 3, requestsAfterWaiting: 3});
	});
});

function IdentityProbe() {
	return <output>{useSessionIdentity(ALIAS) ?? "Unresolved"}</output>;
}

describe("indexing completion catch-up", () => {
	it("refreshes aliases when the existing status poll changes from indexing to ready", async () => {
		vi.useFakeTimers();
		let indexing = true;
		const fetch = vi
			.fn()
			.mockImplementation((url: string) =>
				Promise.resolve(
					url === "/api/indexing-status"
						? Response.json({isIndexing: indexing})
						: indexing
							? Response.json({}, {status: 503})
							: Response.json({sessionId: ALICE}),
				),
			);
		vi.stubGlobal("fetch", fetch);
		render(
			<Wrapper>
				<IndexingBanner />
				<IdentityProbe />
			</Wrapper>,
		);
		await act(() => vi.advanceTimersByTimeAsync(1));
		indexing = false;
		await act(() => vi.advanceTimersByTimeAsync(3001));
		expect(screen.getByRole("status").textContent).toBe(ALICE);
	});

	it("retries an unseen indexing transition once, even when every status sample is already ready", async () => {
		vi.useFakeTimers();
		const fetch = vi
			.fn()
			.mockImplementation((url: string) =>
				Promise.resolve(
					url === "/api/indexing-status"
						? Response.json({isIndexing: false})
						: Response.json({}, {status: 503}),
				),
			);
		vi.stubGlobal("fetch", fetch);
		render(
			<Wrapper>
				<IndexingBanner />
				<IdentityProbe />
			</Wrapper>,
		);
		await act(() => vi.advanceTimersByTimeAsync(20_000));
		const count = () => fetch.mock.calls.filter(([url]) => url !== "/api/indexing-status").length;
		const afterCatchUp = count();
		await act(() => vi.advanceTimersByTimeAsync(30_000));
		expect({afterCatchUp, afterWaiting: count(), identity: screen.getByRole("status").textContent}).toStrictEqual({
			afterCatchUp: 6,
			afterWaiting: 6,
			identity: "Unresolved",
		});
	});
});

const DETAIL = {
	title: "Alice session",
	projectName: "Example",
	projectId: "example",
	homeRoot: "/tmp/example",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: null,
	gitSha: null,
	gitClean: null,
	messageCount: 0,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: -1,
		lastViewedMessageIndex: -1,
		newMessageCount: 0,
		reviewTargetMessageIndex: -1,
		viewedAnywhere: true,
		viewedInCcp: true,
		viewedInHerdr: false,
	},
};
function DetailProbe({id}: {id: string}) {
	const result = useQuery(sessionDetailQueryOptions(id));
	return <output data-testid={id}>{result.data?.canonicalRouteId ?? result.data?.title ?? "Loading"}</output>;
}

describe("active detail alias backfill catch-up", () => {
	it("refreshes only active marked detail once on ready and preserves unmarked/inactive caches", async () => {
		vi.useFakeTimers();
		let indexing = true;
		client.setQueryData(sessionQueryKeys.detail(ALICE), {...DETAIL, canonicalRoutePending: true});
		client.setQueryData(sessionQueryKeys.detail(BOB), DETAIL);
		client.setQueryData(sessionQueryKeys.detail("session-charlie"), {...DETAIL, canonicalRoutePending: true});
		const fetcher = vi.fn((url: string) =>
			Promise.resolve(
				Response.json(
					url === "/api/indexing-status" ? {isIndexing: indexing} : {...DETAIL, canonicalRouteId: ALIAS},
				),
			),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<Wrapper>
				<IndexingBanner />
				<DetailProbe id={ALICE} />
				<DetailProbe id={BOB} />
			</Wrapper>,
		);
		await act(() => vi.advanceTimersByTimeAsync(1));
		indexing = false;
		await act(() => vi.advanceTimersByTimeAsync(30_001));
		expect({
			requests: fetcher.mock.calls.filter(([url]) => url !== "/api/indexing-status"),
			alice: client.getQueryData(sessionQueryKeys.detail(ALICE)),
			bob: client.getQueryData(sessionQueryKeys.detail(BOB)),
			charlie: client.getQueryData(sessionQueryKeys.detail("session-charlie")),
		}).toStrictEqual({
			requests: [[`/api/sessions/${ALICE}`, {credentials: "same-origin"}]],
			alice: {...DETAIL, canonicalRouteId: ALIAS},
			bob: DETAIL,
			charlie: {...DETAIL, canonicalRoutePending: true},
		});
	});

	it("catches a marked result arriving after the first ready sample and cannot loop on a still-marked refresh", async () => {
		let indexing = false;
		vi.useFakeTimers();
		const old = deferredResponse();
		let detailRequests = 0;
		const fetcher = vi.fn((url: string) => {
			if (url === "/api/indexing-status") return Promise.resolve(Response.json({isIndexing: indexing}));
			detailRequests++;
			return detailRequests === 1
				? old.promise
				: Promise.resolve(Response.json({...DETAIL, canonicalRoutePending: true}));
		});
		vi.stubGlobal("fetch", fetcher);
		render(
			<Wrapper>
				<IndexingBanner />
				<DetailProbe id={ALICE} />
			</Wrapper>,
		);
		await act(() => vi.advanceTimersByTimeAsync(1));
		await act(async () => old.resolve(Response.json({...DETAIL, canonicalRoutePending: true})));
		await act(() => vi.advanceTimersByTimeAsync(30_001));
		const afterCatchUp = detailRequests;
		await act(() => vi.advanceTimersByTimeAsync(30_000));
		expect({
			afterCatchUp,
			afterWaiting: detailRequests,
			cached: client.getQueryData(sessionQueryKeys.detail(ALICE)),
		}).toStrictEqual({afterCatchUp: 2, afterWaiting: 2, cached: {...DETAIL, canonicalRoutePending: true}});
		indexing = true;
		await act(() => vi.advanceTimersByTimeAsync(3001));
		indexing = false;
		await act(() => vi.advanceTimersByTimeAsync(30_001));
		expect({
			afterSecondEpisode: detailRequests,
			cached: client.getQueryData(sessionQueryKeys.detail(ALICE)),
		}).toStrictEqual({afterSecondEpisode: 3, cached: {...DETAIL, canonicalRoutePending: true}});
	});

	it("cancels an old marked detail refresh before replacing it with ready metadata", async () => {
		vi.useFakeTimers();
		const old = deferredResponse();
		let detailRequests = 0;
		client.setQueryData(sessionQueryKeys.detail(ALICE), {...DETAIL, canonicalRoutePending: true});
		const fetcher = vi.fn((url: string) => {
			if (url === "/api/indexing-status") return Promise.resolve(Response.json({isIndexing: false}));
			detailRequests++;
			return detailRequests === 1
				? old.promise
				: Promise.resolve(Response.json({...DETAIL, canonicalRouteId: ALIAS}));
		});
		vi.stubGlobal("fetch", fetcher);
		// Begin an explicit refresh of cached pending data before mounting the ready poll.
		const refreshing = client
			.fetchQuery({...sessionDetailQueryOptions(ALICE), staleTime: 0})
			.catch(() => undefined);
		render(
			<Wrapper>
				<IndexingBanner />
				<DetailProbe id={ALICE} />
			</Wrapper>,
		);
		await act(() => vi.advanceTimersByTimeAsync(1));
		await act(async () => old.resolve(Response.json({...DETAIL, canonicalRoutePending: true})));
		await refreshing;
		await act(() => vi.advanceTimersByTimeAsync(30_001));
		expect({detailRequests, cached: client.getQueryData(sessionQueryKeys.detail(ALICE))}).toStrictEqual({
			detailRequests: 2,
			cached: {...DETAIL, canonicalRouteId: ALIAS},
		});
	});
});
