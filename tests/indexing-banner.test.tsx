// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {IndexingBanner} from "../src/components/indexing-banner";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function bannerText(status: {isIndexing: boolean; isInitialBuild: boolean}): Promise<string> {
	vi.useFakeTimers();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Promise.resolve(Response.json(status))),
	);
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	const {container} = render(
		<QueryClientProvider client={client}>
			<IndexingBanner />
		</QueryClientProvider>,
	);
	await act(async () => vi.advanceTimersByTimeAsync(1));
	return container.textContent;
}

describe("IndexingBanner", () => {
	it("shows the banner while the index is built from empty", async () => {
		expect(await bannerText({isIndexing: true, isInitialBuild: true})).toBe(
			"Building search index... This is a one-time operation.",
		);
	});

	it("stays hidden during the routine startup scan of an existing index", async () => {
		expect(await bannerText({isIndexing: true, isInitialBuild: false})).toBe("");
	});

	it("stays hidden when no scan is running", async () => {
		expect(await bannerText({isIndexing: false, isInitialBuild: false})).toBe("");
	});
});
