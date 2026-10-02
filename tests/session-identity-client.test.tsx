// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, render, renderHook, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {IndexingBanner} from "../src/components/indexing-banner";
import {useSessionIdentity} from "../src/hooks/use-session-identity";
import {invalidateSessionIdentities} from "../src/lib/api/session-identity";
import {sessionQueryKeys} from "../src/lib/api/sessions";

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
