// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastProvider} from "../src/components/toast";
import {useSessionRename} from "../src/hooks/use-session-rename";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const AI_TITLE = "Parallel do-task workstreams";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderRename() {
	const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
	const wrapper = ({children}: {children: ReactNode}) => (
		<QueryClientProvider client={queryClient}>
			<ToastProvider>{children}</ToastProvider>
		</QueryClientProvider>
	);
	return renderHook(({serverTitle}: {serverTitle: string}) => useSessionRename(SESSION_ID, serverTitle), {
		wrapper,
		initialProps: {serverTitle: AI_TITLE},
	});
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useSessionRename for a bridged session", () => {
	it("shows the pushed name while the bridge has not titled the session yet, then the bridge's title", async () => {
		fetchMock.mockResolvedValue(Response.json({customTitle: "Build fixer", title: "Build fixer"}));
		const {result, rerender} = renderRename();

		act(() => {
			result.current.commit("Build fixer");
		});
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
		// The refetched server title still lags: the CLI has not recorded the rename.
		rerender({serverTitle: AI_TITLE});
		const lagging = result.current.title;
		rerender({serverTitle: "Build fixer"});
		const landed = result.current.title;
		rerender({serverTitle: "Renamed on claude.ai"});

		expect({lagging, landed, later: result.current.title}).toStrictEqual({
			lagging: "Build fixer",
			landed: "Build fixer",
			later: "Renamed on claude.ai",
		});
	});

	it("rolls back to the server title when the live CLI cannot take the rename", async () => {
		fetchMock.mockResolvedValue(Response.json({error: "agent is busy", code: "agent_not_ready"}, {status: 409}));
		const {result} = renderRename();

		act(() => {
			result.current.commit("Build fixer");
		});

		await waitFor(() => {
			expect(result.current.title).toBe(AI_TITLE);
		});
	});
});
