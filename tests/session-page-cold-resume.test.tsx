// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {type HerdrPaneIndexData, herdrPanesQueryOptions} from "../src/lib/api/herdr";
import
{
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
	groupedSessionsQueryOptions,
} from "../src/lib/api/sessions";
import {SessionPage} from "../src/components/session-page";
import {resetColdResumeStore} from "../src/lib/cold-resume-notice";
import {usageQueryOptions} from "../src/lib/api/usage";
import {takePendingHomeLaunchFolder} from "../src/lib/home-composer-focus";
import {ToastProvider} from "../src/components/toast";
import {SettingsProvider} from "../src/components/settings-provider";

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

const SESSION_ID = "session-test-202";
const PROJECT_ID = "project-test-202";

const detail: SessionDetailData =
{
	title: "Alice's idle session",
	projectName: "example",
	projectId: PROJECT_ID,
	homeRoot: "/home/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: "/home/alice/example",
	gitSha: null,
	gitClean: null,
	messageCount: 1,
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

const LIVE_PANE: HerdrPaneIndexData["panes"][number] =
{
	host: "herdr",
	paneId: "pane-test-202",
	terminalId: "terminal-test-202",
	workspaceId: "workspace-test-202",
	tabId: "tab-test-202",
	focused: false,
	cwd: "/home/alice/example",
	foregroundCwd: null,
	agentStatus: "idle",
	agent: "claude",
	terminalTitle: null,
	agentSessionId: SESSION_ID,
	revision: 1,
	sessionId: SESSION_ID,
	via: "agent-session",
	viewedState: detail.viewedState,
};

const LIVE: HerdrPaneIndexData =
{
	panes: [LIVE_PANE],
	writesEnabled: true,
};

interface Seed
{
	detail?: Partial<SessionDetailData>;
	herdr?: HerdrPaneIndexData;
	state?: "working" | "idle";
}

function seededQueryClient(seed: Seed)
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
	queryClient.setQueryData(
		sessionDetailQueryOptions(SESSION_ID).queryKey,
		{
			...detail,
			...seed.detail,
		},
	);
	queryClient.setQueryData(
		transcriptQueryOptions(SESSION_ID).queryKey,
		{
			records: [
				{
					type: "assistant",
					uuid: "uuid-test-202",
					timestamp: new Date(Date.now() - 3 * 3600e3).toISOString(),
					message:
					{
						role: "assistant",
						model: "claude-opus-5-5",
						content: [
							{
								type: "text",
								text: "Done.",
							},
						],
						usage:
						{
							input_tokens: 2_000,
							cache_read_input_tokens: 410_000,
							cache_creation_input_tokens: 0,
						},
					},
				},
			],
			byteOffset: 0,
			startIndex: 0,
			precedingMessageCount: 0,
			hiddenUuids: [],
			cuts: [],
			chainVersion: "v1",
			chapters: [],
		},
	);
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(
		herdrPanesQueryOptions.queryKey,
		seed.herdr ??
		{
			panes: [],
			writesEnabled: false,
		},
	);
	queryClient.setQueryData(
		usageQueryOptions.queryKey,
		{
			fiveHour:
			{
				usedPct: 20,
				resetsAt: Math.floor(Date.now() / 1000) + 3600,
			},
			sevenDay: null,
			updatedAt: new Date().toISOString(),
		},
	);
	if (seed.state !== undefined)
	{
		queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, [
			{
				sessions: [
					{
						id: SESSION_ID,
						state: seed.state,
					},
				],
			},
		] as never);
	}
	return queryClient;
}

async function renderSession(seed: Seed = {})
{
	const queryClient = seededQueryClient(seed);
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
	return {
		queryClient,
		router,
	};
}

let posts: unknown[] = [];

function stubBrowserGlobals(): void
{
	posts = [];
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("localStorage", new FakeStorage());
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
		{
			if (String(input) === "/api/herdr/prompt")
			{
				posts.push(JSON.parse(String(init?.body)));
				return Response.json(
					{
						ok: true,
					},
				);
			}
			return new Promise<Response>(() => {});
		}),
	);
}

const card = () => document.querySelector('[data-testid="cold-resume-card"]');

beforeEach(() =>
{
	resetColdResumeStore();
	takePendingHomeLaunchFolder();
	stubBrowserGlobals();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session page cold-resume notice", () =>
{
	it("shows the card in the dock's notice region after three idle hours", async () =>
	{
		await renderSession(
			{
				herdr: LIVE,
			},
		);
		const found = await waitFor(() =>
		{
			const element = card();
			expect(element).not.toBeNull();
			return element!;
		});
		expect(found.closest('[data-cds="ChatComposerNotices"]')).not.toBeNull();
		expect(found.textContent).toContain("Idle 3 hours. Resuming will use about 16% of your 5-hour limit.");
	});

	it("Compact types /compact into the live pane", async () =>
	{
		await renderSession(
			{
				herdr: LIVE,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Compact",
				},
			),
		);
		await waitFor(() =>
		{
			expect(posts).toStrictEqual([
				{
					sessionId: SESSION_ID,
					prompt: "/compact",
				},
			]);
		});
	});

	it("Resume focuses the composer", async () =>
	{
		await renderSession(
			{
				herdr: LIVE,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Resume here",
				},
			),
		);
		expect(document.activeElement).toBe(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
		);
	});

	it("New session goes home with this session's folder as the launch folder", async () =>
	{
		const {router} = await renderSession(
			{
				herdr: LIVE,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "New session",
				},
			),
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/");
		});
		expect(takePendingHomeLaunchFolder()).toBe(PROJECT_ID);
	});

	it("offers no Compact without a live pane but still shows the card", async () =>
	{
		await renderSession();
		await screen.findByRole(
			"button",
			{
				name: "Resume here",
			},
		);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Compact",
				},
			),
		).toBeNull();
	});

	it("offers no Compact when live terminal input is off", async () =>
	{
		await renderSession(
			{
				herdr:
				{
					panes: [LIVE_PANE],
					writesEnabled: false,
				},
			},
		);
		await screen.findByRole(
			"button",
			{
				name: "Resume here",
			},
		);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Compact",
				},
			),
		).toBeNull();
	});

	it("shows no card while the session is working", async () =>
	{
		await renderSession(
			{
				herdr: LIVE,
				state: "working",
			},
		);
		await screen.findByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		expect(card()).toBeNull();
	});

	it("shows no card for an archived session", async () =>
	{
		await renderSession(
			{
				herdr: LIVE,
				detail:
				{
					archived: true,
				},
			},
		);
		await screen.findByRole("note");
		expect(card()).toBeNull();
	});
});
