// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {SessionPage} from "../src/components/session-page";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {sessionContextBreakdownQueryOptions} from "../src/lib/api/context-breakdown";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import
{
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import type {ContextBreakdown} from "../src/lib/context-breakdown";
import
{
	DEFAULT_RAIL_SECTIONS_STATE,
	RAIL_SECTIONS_STORAGE_KEY,
	setSessionRailShown,
} from "../src/lib/session-rail-store";
import {preloadSessionPageChunks} from "./session-page-chunks";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => (
{
	SessionChat: () => null,
}));

class TestEventSource extends EventTarget
{
	readonly close = vi.fn<() => void>();
	onerror: ((event: Event) => void) | null = null;
}

class FakeStorage implements Storage
{
	readonly values = new Map<string, string>();

	get length(): number
	{
		return this.values.size;
	}

	clear(): void
	{
		this.values.clear();
	}

	getItem(key: string): string | null
	{
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null
	{
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void
	{
		this.values.delete(key);
	}

	setItem(key: string, value: string): void
	{
		this.values.set(key, value);
	}
}

class TestResizeObserver
{
	observe(): void
	{
	}
	unobserve(): void
	{
	}
	disconnect(): void
	{
	}
}

class TestIntersectionObserver
{
	observe(): void
	{
	}
	unobserve(): void
	{
	}
	disconnect(): void
	{
	}
	takeRecords(): IntersectionObserverEntry[]
	{
		return [];
	}
}

const SESSION_ID = "session-test-memory";

const detail: SessionDetailData =
{
	title: "Alice's memory session",
	projectName: "example",
	projectId: "project-test-memory",
	homeRoot: "/home/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: "/home/alice/example",
	gitSha: null,
	gitClean: null,
	messageCount: 0,
	pendingTaskCount: 0,
	viewedState:
	{
		currentMessageIndex: 0,
		lastViewedMessageIndex: 0,
		reviewTargetMessageIndex: 0,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

const BREAKDOWN: ContextBreakdown =
{
	categories: [
		{
			name: "Memory files",
			tokens: 2_400,
			kind: "used",
		},
		{
			name: "Free space",
			tokens: 997_600,
			kind: "free",
		},
	],
	totalTokens: 2_400,
	rawMaxTokens: 1_000_000,
	percentage: 0,
	mcpTools: [],
	memoryFiles: [
		{
			path: "/home/alice/.claude/CLAUDE.md",
			type: "User",
			tokens: 1_200,
		},
		{
			path: "/home/alice/example/CLAUDE.local.md",
			type: "Local",
			tokens: 300,
		},
		{
			path: "/home/alice/.claude/projects/-home-alice-example/memory/MEMORY.md",
			type: "AutoMem",
			tokens: 900,
		},
	],
	agents: [],
	fetchedAt: "2026-11-17T07:00:00.000Z",
	source: "mod",
	autoCompactThreshold: 967_000,
};

let breakdownFetches = 0;

async function renderSession()
{
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
	queryClient.setQueryData(
		transcriptQueryOptions(SESSION_ID).queryKey,
		{
			records: [],
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
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(
		herdrPanesQueryOptions.queryKey,
		{
			panes: [],
			writesEnabled: false,
		},
	);
	queryClient.setQueryData(sessionContextBreakdownQueryOptions(SESSION_ID).queryKey, BREAKDOWN);
	const rootRoute = createRootRoute(
		{
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
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: [`/session/${SESSION_ID}`],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByTestId("session-titlebar");
}

function memoryRow(): HTMLElement
{
	return screen.getByRole(
		"button",
		{
			name: /^Memory files.*memory files$/,
		},
	);
}

beforeAll(preloadSessionPageChunks);

beforeEach(() =>
{
	breakdownFetches = 0;
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("localStorage", new FakeStorage());
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) =>
		{
			if (String(input) === `/api/sessions/${SESSION_ID}/context-breakdown`)
			{
				breakdownFetches += 1;
				return Response.json(BREAKDOWN);
			}
			return new Promise<Response>(() => {});
		}),
	);
	localStorage.setItem(
		RAIL_SECTIONS_STORAGE_KEY,
		JSON.stringify(
			{
				state:
				{
					...DEFAULT_RAIL_SECTIONS_STATE,
					startsOpen:
					{
						context: true,
					},
				},
				version: 0,
			},
		),
	);
	setSessionRailShown(true);
});

afterEach(() =>
{
	cleanup();
	setSessionRailShown(false);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session page rail Memory files row", () =>
{
	it("opens the Memory dialog, refetches the breakdown, and returns focus to the row on close", async () =>
	{
		await renderSession();

		const row = await screen.findByRole(
			"button",
			{
				name: /^Memory files.*memory files$/,
			},
		);
		row.focus();
		fireEvent.click(row);
		const dialog = await screen.findByRole(
			"dialog",
			{
				name: "Memory",
			},
		);
		await waitFor(() =>
		{
			expect(breakdownFetches).toBe(1);
		});
		expect(
			{
				hint: row.querySelector(".sr-only")?.textContent,
				dialogs: screen.getAllByRole("dialog").length,
			},
		).toStrictEqual(
			{
				hint: "Edit memory files",
				dialogs: 1,
			},
		);

		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Close",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(memoryRow());
		});
	});
});
