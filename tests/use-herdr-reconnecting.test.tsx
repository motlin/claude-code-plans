// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {useHerdrReconnecting} from "../src/hooks/use-herdr-reconnecting";
import {herdrConnectionQueryOptions} from "../src/lib/api/herdr-connection";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function wrapperFor(client: QueryClient) {
	return function Wrapper({children}: {children: ReactNode}) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	};
}

describe("useHerdrReconnecting", () => {
	it("reads the reconnect state the server pushed", () => {
		const client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
		client.setQueryData(herdrConnectionQueryOptions.queryKey, {reconnecting: true});

		const {result} = renderHook(() => useHerdrReconnecting(true), {wrapper: wrapperFor(client)});

		expect(result.current).toBe(true);
	});

	it("fetches the state once enabled and asks nothing while disabled", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => Promise.resolve(Response.json({reconnecting: true})));
		vi.stubGlobal("fetch", fetcher);
		const client = new QueryClient({defaultOptions: {queries: {retry: false}}});

		const {result, rerender} = renderHook(({enabled}: {enabled: boolean}) => useHerdrReconnecting(enabled), {
			wrapper: wrapperFor(client),
			initialProps: {enabled: false},
		});
		const whileDisabled = {value: result.current, fetches: fetcher.mock.calls.length};
		rerender({enabled: true});
		await waitFor(() => {
			expect(result.current).toBe(true);
		});

		expect({whileDisabled, fetches: fetcher.mock.calls.length}).toStrictEqual({
			whileDisabled: {value: false, fetches: 0},
			fetches: 1,
		});
	});
});
