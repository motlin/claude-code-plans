// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {SessionPage} from "../src/components/session-page";
import {ToastProvider} from "../src/components/toast";
import {SettingsProvider} from "../src/components/settings-provider";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => ({
	SessionChat: () => null,
}));

class TestEventSource extends EventTarget {
	readonly close = vi.fn();
	onerror: ((event: Event) => void) | null = null;
}

class FakeStorage implements Storage {
	readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class TestIntersectionObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

const SESSION_ID = "session-test-101";

const detail: SessionDetailData = {
	title: "Alice's dotted project session",
	projectName: "example",
	projectId: "project-test-101",
	homeRoot: "/home/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: "/home/alice/factorio.school",
	gitSha: null,
	gitClean: null,
	messageCount: 1,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: 0,
		lastViewedMessageIndex: 0,
		reviewTargetMessageIndex: 0,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

function seededQueryClient() {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false}},
	});
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records: [
			{
				type: "assistant",
				uuid: "uuid-test-101",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-use-read-example",
							name: "Read",
							input: {file_path: "/home/alice/example/read.ts"},
						},
					],
				},
			},
		],
		byteOffset: 0,
		startIndex: 0,
		precedingMessageCount: 0,
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {
		panes: [],
		writesEnabled: false,
	});
	return queryClient;
}

async function renderSession() {
	const queryClient = seededQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ClaudeEventsProvider>
						<ToastProvider>
							<SessionPage sessionId={SESSION_ID} />
						</ToastProvider>
					</ClaudeEventsProvider>
				</SettingsProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: [`/session/${SESSION_ID}`],
		}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByTestId("session-titlebar");
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session page composer directory", () => {
	it("shows the composer from the recorded cwd when the project path did not resolve", async () => {
		vi.stubGlobal("EventSource", TestEventSource);
		vi.stubGlobal("localStorage", new FakeStorage());
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);

		await renderSession();

		expect(screen.queryByRole("textbox", {name: "Prompt"}) !== null).toBe(true);
	});
});
