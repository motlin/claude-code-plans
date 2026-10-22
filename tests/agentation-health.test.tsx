// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AGENTATION_REPROBE_MS, useHealthyAgentationEndpoint} from "../src/lib/agentation-health";

const ENDPOINT = "http://localhost:4747";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

describe("useHealthyAgentationEndpoint", () => {
	it("withholds the endpoint after a failed health probe and stops polling well past the toolbar's 10s interval", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("Failed to fetch")));
		vi.stubGlobal("fetch", fetchMock);
		const {result} = renderHook(() => useHealthyAgentationEndpoint(ENDPOINT));
		await flush();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect({endpoint: result.current, probes: fetchMock.mock.calls}).toStrictEqual({
			endpoint: undefined,
			probes: [[`${ENDPOINT}/health`]],
		});
	});

	it("treats a proxy's 502 as no server and re-probes only after the long interval", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(new Response("Bad Gateway", {status: 502})));
		vi.stubGlobal("fetch", fetchMock);
		const {result} = renderHook(() => useHealthyAgentationEndpoint(ENDPOINT));
		await flush();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(AGENTATION_REPROBE_MS);
		});
		expect({endpoint: result.current, probes: fetchMock.mock.calls.length}).toStrictEqual({
			endpoint: undefined,
			probes: 2,
		});
	});

	it("hands the endpoint to the toolbar once the server answers", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(new Response("ok", {status: 200})));
		vi.stubGlobal("fetch", fetchMock);
		const {result} = renderHook(() => useHealthyAgentationEndpoint(ENDPOINT));
		await flush();
		expect({endpoint: result.current, probes: fetchMock.mock.calls.length}).toStrictEqual({
			endpoint: ENDPOINT,
			probes: 1,
		});
	});
});
