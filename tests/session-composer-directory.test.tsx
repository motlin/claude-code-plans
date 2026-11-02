// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {type HerdrPaneIndexData, herdrPanesQueryOptions} from "../src/lib/api/herdr";
import
{
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {SessionPage} from "../src/components/session-page";
import {ToastProvider} from "../src/components/toast";
import {SettingsProvider} from "../src/components/settings-provider";

// A stand-in region marks where registered notice bands stack, so the note's slot can be checked against it.
vi.mock("../src/components/composer-notice-region", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/components/composer-notice-region")>()),
	ComposerNoticeRegion: () => <div data-testid="notice-region" />,
}));

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

const SESSION_ID = "session-test-101";

const detail: SessionDetailData =
{
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
	paneId: "pane-test-101",
	terminalId: "terminal-test-101",
	workspaceId: "workspace-test-101",
	tabId: "tab-test-101",
	focused: false,
	cwd: "/home/alice/factorio.school",
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

function seededQueryClient(
	detailOverrides: Partial<SessionDetailData>,
	herdrPanes: HerdrPaneIndexData =
	{
		panes: [],
		writesEnabled: false,
	},
)
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
			...detailOverrides,
		},
	);
	queryClient.setQueryData(
		transcriptQueryOptions(SESSION_ID).queryKey,
		{
			records: [
				{
					type: "assistant",
					uuid: "uuid-test-101",
					message:
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "tool-use-read-example",
								name: "Read",
								input:
								{
									file_path: "/home/alice/example/read.ts",
								},
							},
						],
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
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, herdrPanes);
	return queryClient;
}

async function renderSession(
	detailOverrides: Partial<SessionDetailData> = {},
	herdrPanes?: HerdrPaneIndexData,
): Promise<QueryClient>
{
	const queryClient = seededQueryClient(detailOverrides, herdrPanes);
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
	return queryClient;
}

function stubBrowserGlobals(): void
{
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("localStorage", new FakeStorage());
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Promise<Response>(() => {})),
	);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session page composer directory", () =>
{
	it("shows the composer from the recorded cwd when the project path did not resolve", async () =>
	{
		stubBrowserGlobals();

		await renderSession();

		expect(
			screen.queryByRole(
				"textbox",
				{
					name: "Prompt",
				},
			) !== null,
		).toBe(true);
	});
});

describe("archived session composer note", () =>
{
	it("replaces the composer with the archived note, and brings the composer back once unarchived", async () =>
	{
		stubBrowserGlobals();

		const queryClient = await renderSession(
			{
				archived: true,
			},
		);

		expect(
			{
				composer: screen.queryByRole(
					"textbox",
					{
						name: "Prompt",
					},
				),
				standIns: document.querySelectorAll("[data-composer-stand-in]").length,
				note: screen.getByRole("note").textContent,
			},
		).toStrictEqual(
			{
				composer: null,
				standIns: 1,
				note: "This session is archived. Unarchive it to keep working in this session.Unarchive",
			},
		);

		// Already archived at first paint: the note stays put, as upstream's band slot only animates later bands.
		expect(document.querySelectorAll("[data-band-enter]").length).toBe(0);

		const unarchived: SessionDetailData =
		{
			...detail,
			archived: false,
		};
		act(() =>
		{
			queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, unarchived);
		});

		await screen.findByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		expect(
			{
				composer:
					screen.queryByRole(
						"textbox",
						{
							name: "Prompt",
						},
					) !== null,
				standIns: document.querySelectorAll("[data-composer-stand-in]").length,
			},
		).toStrictEqual(
			{
				composer: true,
				standIns: 0,
			},
		);
	});

	it("puts the archived note in the composer's slot, the dock's last child below the notice region", async () =>
	{
		stubBrowserGlobals();

		await renderSession(
			{
				archived: true,
			},
		);

		const note = screen.getByRole("note");
		const dock = note.closest(".chat-dock-column");
		expect(
			{
				lastChildHoldsNote: dock?.lastElementChild?.contains(note),
				afterNoticeRegion: Boolean(
					screen.getByTestId("notice-region").compareDocumentPosition(note) &
					Node.DOCUMENT_POSITION_FOLLOWING,
				),
			},
		).toStrictEqual(
			{
				lastChildHoldsNote: true,
				afterNoticeRegion: true,
			},
		);
	});

	it("band-enters the archived note when the session is archived while open", async () =>
	{
		stubBrowserGlobals();

		const queryClient = await renderSession();
		const archived: SessionDetailData =
		{
			...detail,
			archived: true,
		};
		act(() =>
		{
			queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, archived);
		});

		const note = await screen.findByRole("note");
		expect(
			{
				slot: note.parentElement?.hasAttribute("data-band-enter"),
				slotClass: note.parentElement?.className,
				noteClassHasBandEnter: note.classList.contains("band-enter"),
			},
		).toStrictEqual(
			{
				slot: true,
				slotClass: "contents",
				noteClassHasBandEnter: true,
			},
		);
	});
});

describe("session composer bash mode", () =>
{
	it("types !<command> into the live pane through the herdr prompt route", async () =>
	{
		stubBrowserGlobals();
		const posts: unknown[] = [];
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
		await renderSession(
			{},
			{
				panes: [LIVE_PANE],
				writesEnabled: true,
			},
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "!",
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "ls -la",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		await waitFor(() =>
		{
			expect(posts).toStrictEqual([
				{
					sessionId: SESSION_ID,
					prompt: "!ls -la",
				},
			]);
		});
	});

	it("refuses a `! command` in a session without a live pane and sends nothing", async () =>
	{
		stubBrowserGlobals();
		await renderSession();
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "!",
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "! ls",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				toast: (await screen.findByText("Shell command runner unavailable.")).textContent,
				value: textarea.value,
			},
		).toStrictEqual(
			{
				toast: "Shell command runner unavailable.",
				value: "! ls",
			},
		);
	});
});
