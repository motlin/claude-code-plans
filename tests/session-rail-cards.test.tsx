// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	type BackgroundTasksOpener,
	BackgroundTasksOpenerProvider,
} from "../src/components/background-tasks-opener-context";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SessionRailCards, type SessionRailInputs} from "../src/components/session-rail/session-rail-cards";
import {ToastProvider} from "../src/components/toast";
import {createStreamDropStore, EventStreamStatusContext} from "../src/hooks/use-claude-events";
import type {StreamDrop} from "../src/lib/stream-drop";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import type {HerdrPaneIndexData} from "../src/lib/api/herdr";
import {sessionDiffQueryOptions} from "../src/lib/api/session-diff";
import {sessionDevServersQueryOptions, sessionOpenInQueryOptions} from "../src/lib/api/sessions";
import type {BackgroundTask} from "../src/lib/background-tasks";
import type {ContextBreakdown} from "../src/lib/context-breakdown";
import {toConnectorSlug} from "../src/lib/customize/mcp-tool-permissions";
import {DEFAULT_RAIL_SECTIONS_STATE, RAIL_SECTIONS_STORAGE_KEY} from "../src/lib/session-rail-store";
import {installLocalStorage} from "./fake-storage";
import {installFrameQueue, stubReducedMotion} from "./helpers/frame-queue";
import {longhandStyle} from "./helpers/longhand-style";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

type HerdrPane = HerdrPaneIndexData["panes"][number];

const PANE: HerdrPane =
{
	host: "herdr",
	paneId: "p1",
	terminalId: "t1",
	workspaceId: "w1",
	tabId: "tab1",
	focused: false,
	cwd: "/Users/alice/projects/avalonlogs",
	foregroundCwd: null,
	agentStatus: "working",
	agent: "claude",
	terminalTitle: "claude",
	agentSessionId: SESSION_ID,
	revision: 1,
	sessionId: SESSION_ID,
	via: "env",
	viewedState:
	{
		currentMessageIndex: 3,
		lastViewedMessageIndex: 3,
		reviewTargetMessageIndex: 3,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

const BASE: SessionRailInputs =
{
	sessionId: SESSION_ID,
	homeRoot: "/Users/alice",
	cwd: "/Users/alice/projects/avalonlogs",
	gitBranch: "alice/sync-upstream",
	model: "Opus 4.7",
	herdrPane: null,
	live: true,
	working: false,
	usage: null,
	breakdown: null,
	artifacts: [],
	outputFiles: [],
	backgroundTasks:
	{
		running: [],
		finished: [],
	},
	pr: null,
	prStatus: null,
};

const FULL: SessionRailInputs =
{
	...BASE,
	usage:
	{
		contextTokens: 190_200,
		contextWindowSize: 1_000_000,
		contextPercent: 19,
		fiveHour:
		{
			usedPercentage: 42,
			resetsAt: Math.floor(Date.now() / 1000) + 3600,
		},
		weekly: null,
		updatedAt: null,
	},
	artifacts: [
		{
			url: "https://claude.ai/artifact/abc",
			id: "abc",
			kind: "html",
			title: "Rail report",
			previewable: false,
			lastEventAt: 1,
		},
	],
	backgroundTasks:
	{
		running: [
			{
				id: "b1",
				toolUseId: "toolu_1",
				kind: "bash",
				description: "Run the dev server",
				command: "just dev",
				status: "running",
				output: null,
				summary: null,
				outputFile: null,
				startedAt: null,
			},
		],
		finished: [
			{
				id: "b2",
				toolUseId: "toolu_2",
				kind: "bash",
				description: "Build",
				command: "just build",
				status: "completed",
				output: null,
				summary: null,
				outputFile: null,
				startedAt: null,
			},
		],
	},
	pr:
	{
		number: 42,
		url: "https://github.com/alice/avalonlogs/pull/42",
		repository: "alice/avalonlogs",
	},
	prStatus:
	{
		number: 42,
		state: "open",
		title: "Sync fork with upstream",
	},
};

function seed(client: QueryClient)
{
	client.setQueryData(customizeMcpServersQueryOptions.queryKey, [
		{
			id: "user:github",
			name: "github",
			scope: "user",
			transport: "http",
			urlOrCommand: "https://api.github.com/mcp",
			enabled: true,
			envKeys: [],
			headerKeys: [],
			needsAuth: false,
		},
		{
			id: "user:linear",
			name: "linear",
			scope: "user",
			transport: "http",
			urlOrCommand: "https://mcp.linear.app",
			enabled: true,
			envKeys: [],
			headerKeys: [],
			needsAuth: true,
		},
		{
			id: "user:off",
			name: "off",
			scope: "user",
			transport: "stdio",
			urlOrCommand: "off",
			enabled: false,
			envKeys: [],
			headerKeys: [],
			needsAuth: false,
		},
	]);
	client.setQueryData(
		sessionDevServersQueryOptions(SESSION_ID, true).queryKey,
		{
			servers: [
				{
					url: "http://localhost:7611",
					live: true,
				},
			],
		},
	);
	client.setQueryData(
		sessionDiffQueryOptions(SESSION_ID, "uncommitted").queryKey,
		{
			scope: "uncommitted",
			source: "git",
			root: "/repo",
			stats:
			{
				files: 3,
				additions: 120,
				deletions: 8,
			},
			files: [],
		},
	);
}

class FakeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords()
	{
		return [];
	}
}

const unregisters: Array<() => void> = [];

beforeEach(() =>
{
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	// Seeded queries refetch on mount; leave those requests pending so the seeds stand.
	vi.stubGlobal("fetch", async () => new Promise<Response>(() => {}));
});

afterEach(() =>
{
	for (const unregister of unregisters.splice(0)) unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function renderCards(
	inputs: SessionRailInputs,
	prepare: (client: QueryClient) => void = () =>
	{
	},
	opener: BackgroundTasksOpener | null = null,
	stream: StreamDrop = null,
)
{
	const client = new QueryClient(
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
	prepare(client);
	const streamDropStore = createStreamDropStore(stream);
	let setInputs: (next: SessionRailInputs) => void = () =>
	{
	};
	function Cards()
	{
		const [current, set] = useState(inputs);
		setInputs = set;
		return <SessionRailCards inputs={current} />;
	}
	const rootRoute = createRootRoute(
		{
			component: () => (
				<TileHost sessionId={SESSION_ID}>
					<BackgroundTasksOpenerProvider value={opener}>
						<Cards />
					</BackgroundTasksOpenerProvider>
				</TileHost>
			),
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	render(
		<QueryClientProvider client={client}>
			<EventStreamStatusContext.Provider value={streamDropStore}>
				<ToastProvider>
					<RouterProvider router={router} />
				</ToastProvider>
			</EventStreamStatusContext.Provider>
		</QueryClientProvider>,
	);
	await act(async () =>
	{
		await router.load();
	});
	/** Re-renders the cards with new inputs. */
	return (next: SessionRailInputs) =>
	{
		act(() =>
		{
			setInputs(next);
		});
	};
}

/** Context starts collapsed upstream; a hand toggle in another session makes it start open. */
function openContextByDefault()
{
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
}

function cards(): Array<[string, string | null]>
{
	return [...document.querySelectorAll<HTMLElement>("[data-rail-section]")].map((section) => [
		section.dataset["railSection"] ?? "",
		section.querySelector("[data-rail-summary]")?.textContent ?? null,
	]);
}

function rows(section: string): Array<[string, string | null]>
{
	const card = screen.getByRole(
		"region",
		{
			name: new RegExp(`^${section}`),
		},
	);
	return [...within(card).getByTestId("rail-rows").children].map((row) => [
		row.querySelector("[data-rail-row-label]")?.textContent ?? "",
		hintText(row.querySelector("[data-rail-row-hint]")),
	]);
}

/** A hint's visible text: a diff stat's aria-hidden digits, else the hint itself. */
function hintText(hint: Element | null): string | null
{
	if (hint === null) return null;
	return (hint.querySelector("[aria-hidden='true']") ?? hint).textContent;
}

describe("Environment card", () =>
{
	function bridge(client: QueryClient)
	{
		client.setQueryData(
			sessionOpenInQueryOptions(SESSION_ID).queryKey,
			{
				cwd: BASE.cwd,
				bridgeSessionId: "cse_bridge",
				remoteHistory: null,
				githubUrl: null,
				remoteControl:
				{
					state: "on",
					url: "https://claude.ai/code/session_bridge",
				},
			},
		);
	}

	/** The CLI still runs, but its registry entry says the bridge was torn down. */
	function bridgeTornDown(client: QueryClient)
	{
		client.setQueryData(
			sessionOpenInQueryOptions(SESSION_ID).queryKey,
			{
				cwd: BASE.cwd,
				bridgeSessionId: "cse_bridge",
				remoteHistory: null,
				githubUrl: null,
				remoteControl:
				{
					state: "off",
					url: null,
				},
			},
		);
	}

	/** Bridged once (the JSONL records it), but no live registry entry: the process ended. */
	function bridgeProcessEnded(client: QueryClient)
	{
		client.setQueryData(
			sessionOpenInQueryOptions(SESSION_ID).queryKey,
			{
				cwd: BASE.cwd,
				bridgeSessionId: "cse_bridge",
				remoteHistory: null,
				githubUrl: null,
				remoteControl: null,
			},
		);
	}

	function noBridge(client: QueryClient)
	{
		client.setQueryData(
			sessionOpenInQueryOptions(SESSION_ID).queryKey,
			{
				cwd: BASE.cwd,
				bridgeSessionId: null,
				remoteHistory: null,
				githubUrl: null,
				remoteControl: null,
			},
		);
	}

	function remoteControl()
	{
		const row = document.querySelector<HTMLElement>("[data-rail-remote-control]");
		if (row === null) return null;
		const label = row.querySelector("label");
		const control = label === null ? null : document.getElementById(label.htmlFor);
		const options = within(row).queryByRole(
			"button",
			{
				name: "Remote Control options",
			},
		);
		return {
			label: label?.textContent ?? null,
			switch: control === null ? null : [control.getAttribute("role"), control.getAttribute("aria-checked")],
			options:
				options === null
					? null
					:
						{
							hidden: options.closest(".opacity-0") !== null,
						},
		};
	}

	it("labels a session no terminal host owns Local, with its branch, model and a missing herdr pane", async () =>
	{
		await renderCards(BASE, noBridge);

		expect(
			{
				rows: rows("Environment"),
				remoteControl: remoteControl(),
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "Local"],
					["alice/sync-upstream", null],
					["Opus 4.7", null],
					["herdr", "No pane"],
				],
				remoteControl: null,
			},
		);
	});

	it("holds the Remote Control row's place after the branch with a 28px skeleton while a live session's bridge loads", async () =>
	{
		await renderCards(BASE);
		const pending = document.querySelector("[data-rail-remote-control-pending]");

		expect(
			{
				rows: rows("Environment"),
				remoteControl: remoteControl(),
				skeleton: pending?.querySelector("[data-cds=Skeleton]")?.className.includes("w-7") ?? null,
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "Local"],
					["alice/sync-upstream", null],
					["Remote Control", null],
					["Opus 4.7", null],
					["herdr", "No pane"],
				],
				remoteControl: null,
				skeleton: true,
			},
		);
	});

	it("shows a switched-off Remote Control row with no options while the CLI runs with its bridge torn down", async () =>
	{
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
			},
			bridgeTornDown,
		);
		const row = document.querySelector("[data-rail-remote-control]");
		const allowed = row === null ? null : fireEvent.contextMenu(row);

		expect(
			{
				rows: rows("Environment"),
				remoteControl: remoteControl(),
				contextMenuAllowed: allowed,
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "Local"],
					["Remote Control", null],
					["herdr", "No pane"],
				],
				remoteControl:
				{
					label: "Remote Control",
					switch: ["switch", "false"],
					options: null,
				},
				contextMenuAllowed: true,
			},
		);
	});

	it("hides the Remote Control row once a bridged session's process ended", async () =>
	{
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
				live: false,
			},
			bridgeProcessEnded,
		);

		expect(
			{
				rows: rows("Environment"),
				remoteControl: remoteControl(),
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "Local"],
					["herdr", "No pane"],
				],
				remoteControl: null,
			},
		);
	});

	it("notes on a bridged Remote Control row that the session's history never reached claude.ai, titled with the suppression cause", async () =>
	{
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
			},
			(client) =>
			{
				client.setQueryData(
					sessionOpenInQueryOptions(SESSION_ID).queryKey,
					{
						cwd: BASE.cwd,
						bridgeSessionId: "cse_bridge",
						remoteHistory:
						{
							reason: "Vetoed for another account",
						},
						githubUrl: null,
						remoteControl:
						{
							state: "on",
							url: "https://claude.ai/code/session_bridge",
						},
					},
				);
			},
		);
		const hint = document.querySelector<HTMLElement>("[data-rail-remote-control] [data-rail-row-hint]");

		expect(
			{
				rows: rows("Environment"),
				title: hint?.title ?? null,
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "Local"],
					["Remote Control", "History not synced"],
					["herdr", "No pane"],
				],
				title: "Remote history not synced to claude.ai · Vetoed for another account",
			},
		);
	});

	it("places the Remote Control row after the folder and branch rows", async () =>
	{
		await renderCards(
			{
				...BASE,
				model: null,
			},
			bridge,
		);

		expect(rows("Environment")).toStrictEqual([
			["~/projects/avalonlogs", "Local"],
			["alice/sync-upstream", null],
			["Remote Control", null],
			["herdr", "No pane"],
		]);
	});

	it("opens the Remote Control options menu at the trigger on right-click", async () =>
	{
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
			},
			bridge,
		);
		const row = document.querySelector("[data-rail-remote-control]");
		const allowed = row === null ? null : fireEvent.contextMenu(row);
		const menu = await screen.findByRole("menu");

		expect(
			{
				contextMenuAllowed: allowed,
				items: within(menu)
					.getAllByRole("menuitem")
					.map((item) => item.textContent),
			},
		).toStrictEqual(
			{
				contextMenuAllowed: false,
				items: ["Open in claude.ai", "Copy link"],
			},
		);
	});

	it("opens the bridged session in claude.ai from the options menu", async () =>
	{
		const open = vi.fn<typeof window.open>(() => null);
		vi.stubGlobal("open", open);
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
			},
			bridge,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Remote Control options",
				},
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name: "Open in claude.ai",
				},
			),
		);

		expect(open.mock.calls).toStrictEqual([
			["https://claude.ai/code/session_bridge", "_blank", "noopener,noreferrer"],
		]);
	});

	it("toasts Link copied when Copy link copies the bridged session's link, and stays silent when it fails", async () =>
	{
		const seen: Record<string, unknown> = {};
		for (const [name, succeeds] of [
			["copied", true],
			["failed", false],
		] as const)
		{
			const writeText = vi.fn<(text: string) => Promise<void>>(async () =>
				succeeds ? Promise.resolve() : Promise.reject(new Error("denied")),
			);
			Object.defineProperty(
				navigator,
				"clipboard",
				{
					value:
					{
						writeText,
					},
					configurable: true,
				},
			);
			await renderCards(
				{
					...BASE,
					gitBranch: null,
					model: null,
				},
				bridge,
			);
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Remote Control options",
					},
				),
			);
			fireEvent.click(
				await screen.findByRole(
					"menuitem",
					{
						name: "Copy link",
					},
				),
			);
			await act(async () =>
			{
				await new Promise((resolve) =>
				{
					setTimeout(resolve, 0);
				});
			});
			seen[name] =
			{
				copied: writeText.mock.calls,
				toast: document.querySelector("[data-toast-message]")?.textContent ?? null,
			};
			cleanup();
		}

		expect(seen).toStrictEqual(
			{
				copied:
				{
					copied: [["https://claude.ai/code/session_bridge"]],
					toast: "Link copied",
				},
				failed:
				{
					copied: [["https://claude.ai/code/session_bridge"]],
					toast: null,
				},
			},
		);
	});

	it("hints the folder row with the dropped event stream's state, keeping the terminal host in its title", async () =>
	{
		const states: Record<string, StreamDrop> =
		{
			reconnecting: "reconnecting",
			connecting: "connecting",
			connected: null,
		};
		const seen: Record<string, unknown> = {};
		for (const [name, stream] of Object.entries(states))
		{
			await renderCards(
				{
					...BASE,
					gitBranch: null,
					model: null,
					herdrPane: PANE,
				},
				() => {},
				null,
				stream,
			);
			const card = screen.getByRole(
				"region",
				{
					name: /^Environment/,
				},
			);
			const hint = within(card).getAllByText((_, el) => el?.hasAttribute("data-rail-row-hint") === true)[0];
			seen[name] =
			{
				hint: hint?.textContent,
				status: hint?.getAttribute("data-stream-status") ?? null,
				title: hint?.closest("[title]")?.getAttribute("title"),
			};
			cleanup();
		}

		expect(seen).toStrictEqual(
			{
				reconnecting:
				{
					hint: "Reconnecting",
					status: "reconnecting",
					title: "/Users/alice/projects/avalonlogs · herdr",
				},
				connecting:
				{
					hint: "Connecting",
					status: "connecting",
					title: "/Users/alice/projects/avalonlogs · herdr",
				},
				connected:
				{
					hint: "herdr",
					status: null,
					title: "/Users/alice/projects/avalonlogs",
				},
			},
		);
	});

	it("shows the dropped event stream's state on a plain environment row when the transcript has no cwd", async () =>
	{
		const states: Record<string, StreamDrop> =
		{
			reconnecting: "reconnecting",
			connected: null,
		};
		const seen: Record<string, unknown> = {};
		for (const [name, stream] of Object.entries(states))
		{
			await renderCards(
				{
					...BASE,
					cwd: null,
					gitBranch: null,
					model: null,
					herdrPane: PANE,
				},
				() => {},
				null,
				stream,
			);
			const card = screen.getByRole(
				"region",
				{
					name: /^Environment/,
				},
			);
			seen[name] =
			{
				rows: rows("Environment"),
				status: [...card.querySelectorAll("[data-stream-status]")].map((el) => [
					el.textContent,
					el.getAttribute("data-stream-status"),
					el.hasAttribute("data-rail-row-hint"),
				]),
				menuButtons: within(card).queryAllByRole(
					"button",
					{
						name: /herdr/,
					},
				).length,
			};
			cleanup();
		}

		expect(seen).toStrictEqual(
			{
				reconnecting:
				{
					rows: [
						["herdr", "Reconnecting"],
						["herdr", "working"],
					],
					status: [["Reconnecting", "reconnecting", true]],
					menuButtons: 0,
				},
				connected:
				{
					rows: [["herdr", "working"]],
					status: [],
					menuButtons: 0,
				},
			},
		);
	});

	it("labels a herdr session herdr and links its live pane's agent status to its terminal", async () =>
	{
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
				herdrPane: PANE,
			},
			noBridge,
		);
		const card = screen.getByRole(
			"region",
			{
				name: /^Environment/,
			},
		);

		expect(
			{
				rows: rows("Environment"),
				href: within(card)
					.getByRole(
						"link",
						{
							name: /herdr/,
						},
					)
					.getAttribute("href"),
				remoteControl: remoteControl(),
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "herdr"],
					["herdr", "working"],
				],
				href: `/terminals/${SESSION_ID}`,
				remoteControl: null,
			},
		);
	});

	it("shows a switched-on Remote Control row with hover-revealed options under a bridged herdr session", async () =>
	{
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
				herdrPane: PANE,
			},
			bridge,
		);

		expect(
			{
				rows: rows("Environment"),
				remoteControl: remoteControl(),
			},
		).toStrictEqual(
			{
				rows: [
					["~/projects/avalonlogs", "herdr"],
					["Remote Control", null],
					["herdr", "working"],
				],
				remoteControl:
				{
					label: "Remote Control",
					switch: ["switch", "true"],
					options:
					{
						hidden: true,
					},
				},
			},
		);
	});

	it("makes the Remote Control switch toggleable only where it can type into the session's pane, disabled mid-turn", async () =>
	{
		const switchState = () =>
		{
			const control = document.querySelector("[data-rail-remote-control] [role=switch]");
			return [control?.hasAttribute("aria-readonly") ?? null, control?.hasAttribute("data-disabled") ?? null];
		};
		const seen: Record<string, unknown> = {};
		for (const [name, inputs] of [
			[
				"readOnly",
				{
					...BASE,
					herdrPane: PANE,
				},
			],
			[
				"idle",
				{
					...BASE,
					herdrPane: PANE,
					canToggleRemoteControl: true,
				},
			],
			[
				"working",
				{
					...BASE,
					herdrPane: PANE,
					canToggleRemoteControl: true,
					working: true,
				},
			],
		] as const)
		{
			await renderCards(inputs, bridge);
			seen[name] = switchState();
			cleanup();
		}

		expect(seen).toStrictEqual(
			{
				readOnly: [true, false],
				idle: [false, false],
				working: [false, true],
			},
		);
	});

	it("names a herdr named session beside herdr, bridged or not", async () =>
	{
		const named =
		{
			...PANE,
			paneId: "wM:p1@later",
			workspaceId: "wM@later",
		};
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
				herdrPane: named,
			},
			noBridge,
		);
		const plain = rows("Environment");
		cleanup();
		await renderCards(
			{
				...BASE,
				gitBranch: null,
				model: null,
				herdrPane: named,
			},
			bridge,
		);

		expect(
			{
				plain,
				bridged: rows("Environment"),
			},
		).toStrictEqual(
			{
				plain: [
					["~/projects/avalonlogs", "herdr · later"],
					["herdr", "working"],
				],
				bridged: [
					["~/projects/avalonlogs", "herdr · later"],
					["Remote Control", null],
					["herdr", "working"],
				],
			},
		);
	});

	it("labels a tmux session by its tmux session and shows its pane id, without a terminal link", async () =>
	{
		const tmux: SessionRailInputs =
		{
			...BASE,
			gitBranch: null,
			model: null,
			herdrPane:
			{
				...PANE,
				host: "tmux",
				paneId: "%7",
				workspaceId: "work",
				agentStatus: "unknown",
				via: "process",
			},
		};
		await renderCards(tmux, noBridge);
		const card = screen.getByRole(
			"region",
			{
				name: /^Environment/,
			},
		);
		const plain =
		{
			rows: rows("Environment"),
			links: within(card).queryAllByRole("link"),
		};
		cleanup();
		await renderCards(tmux, bridge);

		expect(
			{
				plain,
				bridged: rows("Environment"),
			},
		).toStrictEqual(
			{
				plain:
				{
					rows: [
						["~/projects/avalonlogs", "tmux · work"],
						["tmux", "%7"],
					],
					links: [],
				},
				bridged: [
					["~/projects/avalonlogs", "tmux · work"],
					["Remote Control", null],
					["tmux", "%7"],
				],
			},
		);
	});

	function withGitHub(client: QueryClient)
	{
		client.setQueryData(
			sessionOpenInQueryOptions(SESSION_ID).queryKey,
			{
				cwd: BASE.cwd,
				bridgeSessionId: null,
				remoteControl: null,
				remoteHistory: null,
				githubUrl: "https://github.com/alice/avalonlogs",
			},
		);
	}

	async function openRowMenu(name: RegExp): Promise<string[]>
	{
		const card = screen.getByRole(
			"region",
			{
				name: /^Environment/,
			},
		);
		const trigger = within(card).getByRole(
			"button",
			{
				name,
			},
		);
		fireEvent.click(trigger);
		const menu = await screen.findByRole("menu");
		return [
			trigger.getAttribute("aria-haspopup") ?? "",
			...within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.textContent),
		];
	}

	it("opens a folder menu to open the folder in Finder or copy its path", async () =>
	{
		const writeText = vi.fn<(text: string) => Promise<void>>(async () => Promise.resolve());
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				value:
				{
					writeText,
				},
				configurable: true,
			},
		);
		await renderCards(BASE);

		const items = await openRowMenu(/avalonlogs/);
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Copy path",
				},
			),
		);
		await act(async () =>
		{
			await Promise.resolve();
		});

		expect(
			{
				items,
				copied: writeText.mock.calls,
				toast: document.querySelector("[data-toast-message]")?.textContent,
			},
		).toStrictEqual(
			{
				items: ["menu", "Open in Finder", "Copy path"],
				copied: [["/Users/alice/projects/avalonlogs"]],
				toast: "Copied to clipboard.",
			},
		);
	});

	it("lines the folder menu button like upstream: 32px tall, its label 38px in past an icon padded 8px", async () =>
	{
		await renderCards(BASE);
		const card = screen.getByRole(
			"region",
			{
				name: /^Environment/,
			},
		);
		const trigger = within(card).getByRole(
			"button",
			{
				name: /avalonlogs/,
			},
		);
		const overlay = trigger.parentElement?.querySelector(".pointer-events-none");
		const picked = (element: Element | null | undefined, wanted: readonly string[]) =>
			wanted.filter((each) => element?.className.split(" ").includes(each));

		expect(
			{
				trigger: picked(trigger, ["h-8", "h-6.5", "gap-2.5", "ps-[38px]", "ps-8", "pe-2", "pe-1"]),
				overlay: picked(overlay, ["ps-2", "ps-1"]),
			},
		).toStrictEqual(
			{
				trigger: ["h-8", "gap-2.5", "ps-[38px]", "pe-2"],
				overlay: ["ps-2"],
			},
		);
	});

	it("opens a branch menu to copy the branch name, without GitHub for a repo with no GitHub remote", async () =>
	{
		await renderCards(BASE);

		expect(await openRowMenu(/alice\/sync-upstream/)).toStrictEqual(["menu", "Copy branch name"]);
	});

	it("adds Open branch on GitHub to the branch menu when the repo has a GitHub remote", async () =>
	{
		const open = vi.fn<typeof window.open>(() => null);
		vi.stubGlobal("open", open);
		await renderCards(BASE, withGitHub);

		const items = await openRowMenu(/alice\/sync-upstream/);
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Open branch on GitHub",
				},
			),
		);

		expect(
			{
				items,
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				items: ["menu", "Copy branch name", "Open branch on GitHub"],
				opened: [
					["https://github.com/alice/avalonlogs/tree/alice/sync-upstream", "_blank", "noopener,noreferrer"],
				],
			},
		);
	});
});

describe("cards from local data", () =>
{
	it("shows only Environment and Context's placeholder when the session has nothing else", async () =>
	{
		openContextByDefault();
		await renderCards(BASE);

		expect(
			{
				cards: cards(),
				context: screen
					.getByRole(
						"region",
						{
							name: /^Context/,
						},
					)
					.querySelector("[data-rail-body]")?.textContent,
			},
		).toStrictEqual(
			{
				cards: [
					["environment", "alice/sync-upstream"],
					["context", null],
				],
				context: "Send a message to see context usage.",
			},
		);
	});

	it("renders every card with content in upstream's order, with its summary", async () =>
	{
		await renderCards(FULL, seed);

		expect(cards()).toStrictEqual([
			["environment", "alice/sync-upstream"],
			["context", "19%"],
			["connectors", "1 to reconnect"],
			["outputs", "1"],
			["pullRequests", "1 pull request"],
			["servers", "1 running"],
			["backgroundTasks", "1 running"],
		]);
	});

	it("lists each card's rows once expanded", async () =>
	{
		await renderCards(FULL, seed);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Connectors/,
				},
			),
			{
				altKey: true,
			},
		);

		expect(
			{
				connectors: rows("Connectors"),
				progress: screen.queryByRole(
					"region",
					{
						name: /^Progress/,
					},
				),
				outputs: rows("Outputs"),
				changes: rows("Changes"),
				servers: rows("Servers"),
				backgroundTasks: rows("Background tasks"),
				context: screen
					.getByRole(
						"progressbar",
						{
							name: "Context window",
						},
					)
					.getAttribute("aria-valuenow"),
				usage: screen.queryByRole(
					"progressbar",
					{
						name: "Session limit",
					},
				),
			},
		).toStrictEqual(
			{
				connectors: [
					["github", null],
					["linear", "Reconnect"],
				],
				progress: null,
				outputs: [["Rail report", null]],
				changes: [
					["#42 Sync fork with upstream", "Open"],
					["Uncommitted changes", "+120−8"],
				],
				servers: [["localhost:7611", null]],
				backgroundTasks: [
					["Run the dev server", null],
					["1 finished", null],
				],
				context: "19",
				usage: null,
			},
		);
	});

	describe("Uncommitted changes stat", () =>
	{
		const DIFF_KEY = sessionDiffQueryOptions(SESSION_ID, "uncommitted").queryKey;

		async function renderChanges(): Promise<QueryClient>
		{
			let captured: QueryClient | undefined;
			await renderCards(FULL, (client) =>
			{
				seed(client);
				captured = client;
			});
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Connectors/,
					},
				),
				{
					altKey: true,
				},
			);
			if (captured === undefined) throw new Error("renderCards did not prepare a client");
			return captured;
		}

		/** Writes new diff stats; the query cache notifies observers on a 0ms timer. */
		async function setDiff(client: QueryClient, additions: number, deletions: number)
		{
			await act(async () =>
			{
				client.setQueryData(
					DIFF_KEY,
					{
						scope: "uncommitted",
						source: "git",
						root: "/repo",
						stats:
						{
							files: 3,
							additions,
							deletions,
						},
						files: [],
					},
				);
				await new Promise((resolve) =>
				{
					setTimeout(resolve, 0);
				});
			});
		}

		function changesRow(): HTMLElement
		{
			return screen.getByRole(
				"button",
				{
					name: /^Open changes,/,
				},
			);
		}

		it("renders upstream's animated rail stat with the Open changes label", async () =>
		{
			stubReducedMotion(false);
			await renderChanges();
			const row = changesRow();
			expect(
				{
					label: row.getAttribute("aria-label"),
					hint: row.querySelector("[data-rail-row-hint]")?.innerHTML,
				},
			).toStrictEqual(
				{
					label: "Open changes, 120 added, 8 removed",
					hint: '<span dir="ltr" class="tabular-nums inline-flex shrink-0 gap-1 text-body"><span class="sr-only">120 additions, 8 deletions</span><span aria-hidden="true" class="contents"><span class="text-git-added">+120</span><span class="text-git-removed">−8</span></span></span>',
				},
			);
		});

		it("eases the hint to new diff counts, with the label and sr line at the new counts at once", async () =>
		{
			stubReducedMotion(false);
			const client = await renderChanges();
			const frames = installFrameQueue();
			await setDiff(client, 1220, 8);
			const read = () => (
			{
				label: changesRow().getAttribute("aria-label"),
				visible: hintText(changesRow().querySelector("[data-rail-row-hint]")),
				sr: changesRow().querySelector("[data-rail-row-hint] .sr-only")?.textContent,
			});
			const seen = [read()];
			for (const ts of [200, 400])
			{
				act(() =>
				{
					frames.frame(ts);
				});
				seen.push(read());
			}
			const final =
			{
				label: "Open changes, 1,220 added, 8 removed",
				sr: "1,220 additions, 8 deletions",
			};
			expect(seen).toStrictEqual([
				{
					...final,
					visible: "+120−8",
				},
				{
					...final,
					visible: "+1,083−8",
				},
				{
					...final,
					visible: "+1,220−8",
				},
			]);
		});

		it("snaps the hint to new diff counts under reduced motion", async () =>
		{
			stubReducedMotion(true);
			const client = await renderChanges();
			const frames = installFrameQueue();
			await setDiff(client, 220, 8);
			expect(
				{
					visible: hintText(changesRow().querySelector("[data-rail-row-hint]")),
					pending: frames.pending(),
				},
			).toStrictEqual(
				{
					visible: "+220−8",
					pending: [],
				},
			);
		});
	});

	it("opens a background task in the Background tasks pane, which swaps the rail out", async () =>
	{
		unregisters.push(
			registerPane(
				"background-tasks",
				{
					title: "Background tasks",
					render: () => <p>tasks pane body</p>,
				},
			),
		);
		await renderCards(FULL, seed);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open Run the dev server in Background tasks",
				},
			),
		);
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});

		expect(
			screen
				.getAllByRole(
					"region",
					{
						name: "Background tasks",
					},
				)
				.flatMap((region) => within(region).queryAllByText("tasks pane body"))
				.map((body) => body.tagName),
		).toStrictEqual(["P"]);
	});
});

describe("Background tasks card", () =>
{
	function runningTask(index: number, startedAt: string | null = null): BackgroundTask
	{
		return {
			id: `b${index}`,
			toolUseId: `toolu_${index}`,
			kind: "bash",
			description: `Task ${index}`,
			command: null,
			status: "running",
			output: null,
			summary: null,
			outputFile: null,
			startedAt,
		};
	}

	function finishedTask(): BackgroundTask
	{
		return {
			...runningTask(99),
			description: "Done",
			status: "completed",
		};
	}

	function withTasks(running: BackgroundTask[], finished: BackgroundTask[] = []): SessionRailInputs
	{
		return {
			...BASE,
			backgroundTasks:
			{
				running,
				finished,
			},
		};
	}

	const SIX = [1, 2, 3, 4, 5, 6].map((index) => runningTask(index));

	it("lists four running tasks, then a collapsed Show more", async () =>
	{
		await renderCards(withTasks(SIX));

		expect(
			{
				rows: rows("Background tasks"),
				expanded: screen
					.getByRole(
						"button",
						{
							name: "Show more",
						},
					)
					.getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				rows: [
					["Task 1", null],
					["Task 2", null],
					["Task 3", null],
					["Task 4", null],
					["Show more", null],
				],
				expanded: "false",
			},
		);
	});

	it("lines the task rows and Show more at upstream's 32px with an 8px row pad", async () =>
	{
		await renderCards(withTasks(SIX));
		const picked = (element: Element | null | undefined) =>
			["min-h-8", "min-h-6.5", "gap-2.5", "px-2", "px-1"].filter((each) =>
				element?.className.split(" ").includes(each),
			);

		expect(
			{
				row: picked(
					screen.getByRole(
						"button",
						{
							name: "Open Task 1 in Background tasks",
						},
					),
				),
				showMore: picked(
					screen.getByRole(
						"button",
						{
							name: "Show more",
						},
					),
				),
			},
		).toStrictEqual(
			{
				row: ["min-h-8", "gap-2.5", "px-2"],
				showMore: ["min-h-8", "px-2"],
			},
		);
	});

	it("expands in place to every running task with Show less, and collapses back", async () =>
	{
		await renderCards(withTasks(SIX));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show more",
				},
			),
		);
		const expanded =
		{
			rows: rows("Background tasks"),
			expanded: screen
				.getByRole(
					"button",
					{
						name: "Show less",
					},
				)
				.getAttribute("aria-expanded"),
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show less",
				},
			),
		);

		expect(
			{
				expanded,
				collapsed: rows("Background tasks").length,
			},
		).toStrictEqual(
			{
				expanded:
				{
					rows: [
						["Task 1", null],
						["Task 2", null],
						["Task 3", null],
						["Task 4", null],
						["Task 5", null],
						["Task 6", null],
						["Show less", null],
					],
					expanded: "true",
				},
				collapsed: 5,
			},
		);
	});

	it("focuses the first newly shown row when Show more is pressed from the keyboard", async () =>
	{
		await renderCards(withTasks(SIX));
		const toggle = screen.getByRole(
			"button",
			{
				name: "Show more",
			},
		);
		toggle.focus();
		fireEvent.click(
			toggle,
			{
				detail: 0,
			},
		);

		expect(document.activeElement?.getAttribute("aria-label")).toBe("Open Task 5 in Background tasks");
	});

	it("labels each row as opening it in Background tasks", async () =>
	{
		await renderCards(withTasks([runningTask(1)]));

		expect(
			within(
				screen.getByRole(
					"region",
					{
						name: /^Background tasks/,
					},
				),
			)
				.getAllByRole(
					"button",
					{
						name: /^Open /,
					},
				)
				.map((row) => row.getAttribute("aria-label")),
		).toStrictEqual(["Open Task 1 in Background tasks"]);
	});

	it("shows how long a running task has run", async () =>
	{
		await renderCards(withTasks([runningTask(1, new Date(Date.now() - 2 * 3_600_000).toISOString())]));

		expect(rows("Background tasks")).toStrictEqual([["Task 1", "2h 0m"]]);
	});

	it("gives the finished row the agents icon", async () =>
	{
		await renderCards(withTasks([runningTask(1)], [finishedTask()]));
		const finished = screen.getByRole(
			"button",
			{
				name: "1 finished",
			},
		);

		expect(finished.querySelector("svg")?.getAttribute("class")).toContain("lucide-bot");
	});

	it("opens Background tasks focused on the clicked row, the agent's transcript, or the Finished section", async () =>
	{
		const open = vi.fn<BackgroundTasksOpener["open"]>();
		const agent: BackgroundTask =
		{
			...runningTask(2),
			id: "a2",
			kind: "agent",
			description: "Review the diff",
		};
		await renderCards(
			withTasks([runningTask(1), agent], [finishedTask(), finishedTask()]),
			undefined,
			{
				open,
				running: new Map(),
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open Task 1 in Background tasks",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open Review the diff in Background tasks",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "2 finished",
				},
			),
		);

		expect(open.mock.calls).toStrictEqual([
			[
				{
					taskId: "b1",
				},
			],
			[
				{
					agentId: "a2",
				},
			],
			[
				{
					finished: true,
				},
			],
		]);
	});

	it("leaves the rail when only finished tasks remain", async () =>
	{
		await renderCards(withTasks([], [finishedTask()]));

		expect(document.querySelector('[data-rail-section="backgroundTasks"]')).toBe(null);
	});
});

describe("Context card", () =>
{
	beforeEach(openContextByDefault);

	const SIXTEEN_HOURS_AGO = () => new Date(Date.now() - 16 * 3_600_000).toISOString();

	function contextInputs(updatedAt: string | null, working = false): SessionRailInputs
	{
		return {
			...BASE,
			working,
			usage:
			{
				contextTokens: 178_500,
				contextWindowSize: 1_000_000,
				contextPercent: 18,
				fiveHour: null,
				weekly: null,
				updatedAt,
			},
		};
	}

	function contextBody()
	{
		const body = screen
			.getByRole(
				"region",
				{
					name: /^Context/,
				},
			)
			.querySelector("[data-rail-body]");
		if (!body) throw new Error("no Context body");
		return body;
	}

	it("headlines the percent used over the token summary and a 4px meter, like upstream", async () =>
	{
		await renderCards(contextInputs(null));

		const body = contextBody();
		const summary = body.querySelector("[data-rail-context-summary]");
		const bar = within(body as HTMLElement).getByRole(
			"progressbar",
			{
				name: "Context window",
			},
		);
		expect(
			{
				text: body.textContent,
				summary: summary?.textContent,
				pct: summary?.getAttribute("data-rail-context-pct"),
				bar: bar.className,
				track: bar.style.backgroundColor,
				fill: bar.firstElementChild?.className,
			},
		).toStrictEqual(
			{
				text: "18% used178.5k / 1MSend a message to see the breakdown.",
				summary: "178.5k / 1M",
				pct: "18",
				bar: "h-[4px] rounded-full overflow-hidden",
				track: "var(--chart-reference-tint)",
				fill: "h-full bg-accent-100 transition-[width]",
			},
		);
	});

	const HINT_CLASS = "mt-1 flex min-h-6 items-center px-2 pb-1 text-[12px]/[15px] text-secondary";

	it("says a message brings the breakdown, with no Last updated footer, when only window totals are known", async () =>
	{
		await renderCards(contextInputs(SIXTEEN_HOURS_AGO()));

		const hint = contextBody().querySelector("[data-rail-context-hint]");
		expect(
			{
				text: hint?.textContent,
				className: hint?.className,
				footer: contextBody().querySelector("[data-rail-context-updated]"),
			},
		).toStrictEqual(
			{
				text: "Send a message to see the breakdown.",
				className: HINT_CLASS,
				footer: null,
			},
		);
	});

	it("drops the breakdown hint while the session is working", async () =>
	{
		await renderCards(contextInputs(SIXTEEN_HOURS_AGO(), true));

		expect(
			{
				hint: contextBody().querySelector("[data-rail-context-hint]"),
				footer: contextBody().querySelector("[data-rail-context-updated]"),
			},
		).toStrictEqual(
			{
				hint: null,
				footer: null,
			},
		);
	});
});

describe("Context card breakdown", () =>
{
	beforeEach(openContextByDefault);

	const MCP_TOOLS = Array.from(
		{
			length: 13,
		},
		(_, i) => (
		{
			name: `mcp__github__tool_${i}`,
			serverName: "github",
			tokens: 100 + i,
		}),
	);

	const BREAKDOWN: ContextBreakdown =
	{
		categories: [
			{
				name: "System prompt",
				tokens: 3_100,
				kind: "used",
			},
			{
				name: "System tools",
				tokens: 14_500,
				kind: "used",
			},
			{
				name: "MCP server instructions",
				tokens: 1_500,
				kind: "used",
			},
			{
				name: "MCP tools (deferred)",
				tokens: 94_200,
				kind: "deferred",
			},
			{
				name: "System tools (deferred)",
				tokens: 26_700,
				kind: "deferred",
			},
			{
				name: "Custom agents",
				tokens: 1_200,
				kind: "used",
			},
			{
				name: "Memory files",
				tokens: 6_300,
				kind: "used",
			},
			{
				name: "Skills",
				tokens: 9_900,
				kind: "used",
			},
			{
				name: "Messages",
				tokens: 143_500,
				kind: "used",
			},
			{
				name: "Autocompact buffer",
				tokens: 33_000,
				kind: "buffer",
			},
			{
				name: "Free space",
				tokens: 787_000,
				kind: "free",
			},
		],
		totalTokens: 180_000,
		rawMaxTokens: 1_000_000,
		percentage: 18,
		mcpTools: MCP_TOOLS,
		memoryFiles: [
			{
				path: "/Users/alice/.claude/CLAUDE.md",
				type: "User",
				tokens: 1_200,
			},
			{
				path: "/Users/alice/.claude/projects/-Users-alice-projects-avalonlogs/memory/MEMORY.md",
				type: "AutoMem",
				tokens: 900,
			},
		],
		agents: [
			{
				agentType: "Explore",
				source: "built-in",
				tokens: 340,
			},
		],
		fetchedAt: "2026-10-20T13:50:04.000Z",
		source: "context-command",
	};

	const INPUTS: SessionRailInputs =
	{
		...BASE,
		usage:
		{
			contextTokens: 180_000,
			contextWindowSize: 1_000_000,
			contextPercent: 18,
			fiveHour: null,
			weekly: null,
			updatedAt: null,
		},
		breakdown: BREAKDOWN,
	};

	function body(): HTMLElement
	{
		const found = screen
			.getByRole(
				"region",
				{
					name: /^Context/,
				},
			)
			.querySelector<HTMLElement>("[data-rail-body]");
		if (!found) throw new Error("no Context body");
		return found;
	}

	function legendRows(): string[][]
	{
		return [...body().querySelectorAll("[data-rail-context-row]")].map((row) =>
			[...row.children].map((cell) => cell.textContent),
		);
	}

	function toggle(label: string): HTMLElement
	{
		return within(body()).getByRole(
			"button",
			{
				name: new RegExp(`^${label}\\d+$`),
			},
		);
	}

	it("headlines the breakdown's used tokens over a stacked meter", async () =>
	{
		await renderCards(INPUTS);

		const meter = within(body()).getByRole(
			"img",
			{
				name: /^Context window/,
			},
		);
		expect(
			{
				headline: body().querySelector("[data-rail-context-summary]")?.parentElement?.textContent,
				label: meter.getAttribute("aria-label"),
				tabIndex: meter.tabIndex,
				className: meter.className,
				style: meter.getAttribute("style"),
			},
		).toStrictEqual(
			{
				headline: "18% used180k / 1M",
				label: "Context window: Messages: 143.5k, 14%; System tools: 14.5k, 1.5%; Skills: 9.9k, 0.99%; Memory files: 6.3k, 0.63%; Other: 5.8k, 0.58%; Autocompact buffer: 33k, 3.3%",
				tabIndex: 0,
				className:
					"relative w-full overflow-hidden forced-colors:outline forced-colors:outline-solid forced-colors:outline-[color:CanvasText] rounded-full outline-none focus-visible:outline-hidden focus-visible:shadow-focus shrink-0",
				style: "background-color: var(--chart-reference-tint); container-type: inline-size; height: 4px;",
			},
		);
	});

	it("floors the meter's small segments to 2px plus a 1px seam at upstream's 246px rail width", async () =>
	{
		const measure = HTMLElement.prototype.getBoundingClientRect;
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			return this.matches('[data-cds="StackedMeter"]') ? new DOMRect(0, 0, 246, 4) : measure.call(this);
		});
		await renderCards(INPUTS);

		const meter = within(body()).getByRole(
			"img",
			{
				name: /^Context window/,
			},
		);
		expect(
			[...meter.children].map((anchor) => (
			{
				anchor: anchor.getAttribute("style"),
				segment: anchor.firstElementChild?.className,
				paint: longhandStyle(anchor.firstElementChild),
			})),
		).toStrictEqual(
			[
				["calc(0% + 0px)", "calc(13.104% + 0px)", "categorical-1", "2px", "1px"],
				["calc(13.104% + 1px)", "calc(1.429% - 1px)", "categorical-2", "1px", "1px"],
				["calc(14.533% + 1px)", "calc(1.22% - 1px)", "categorical-3", "1px", "1px"],
				["calc(15.752% + 1px)", "calc(1.22% - 1px)", "categorical-4", "1px", "1px"],
				["calc(16.972% + 1px)", "calc(1.22% - 1px)", "reference", "1px", "1px"],
				["calc(18.191% + 1px)", "calc(3.109% - 1px)", "muted", "1px", "2px"],
			].map(([start, width, color, radiusStart, radiusEnd]) => (
			{
				anchor: `inset-inline-start: ${start}; width: ${width};`,
				segment: "absolute inset-0 forced-color-adjust-none",
				paint: `background-color: var(--chart-${color}); border-start-start-radius: ${radiusStart}; border-end-start-radius: ${radiusStart}; border-start-end-radius: ${radiusEnd}; border-end-end-radius: ${radiusEnd};`,
			})),
		);
	});

	it("draws a 4px dot in the largest series' color when the used run is narrower than the meter is tall", async () =>
	{
		await renderCards(
			{
				...INPUTS,
				usage: null,
				breakdown:
				{
					...BREAKDOWN,
					categories: [
						{
							name: "Messages",
							tokens: 3_000,
							kind: "used",
						},
						{
							name: "System prompt",
							tokens: 1_000,
							kind: "used",
						},
						{
							name: "Free space",
							tokens: 996_000,
							kind: "free",
						},
					],
					totalTokens: 4_000,
				},
			},
		);

		const meter = within(body()).getByRole(
			"img",
			{
				name: /^Context window/,
			},
		);
		expect(
			[...meter.children].map((anchor) => [
				anchor.firstElementChild?.className,
				anchor.firstElementChild?.getAttribute("style"),
			]),
		).toStrictEqual([
			[
				"absolute inset-y-0 start-0 rounded-full forced-color-adjust-none",
				"width: 4px; background-color: var(--chart-categorical-1);",
			],
		]);
	});

	describe("meter tooltips", () =>
	{
		beforeEach(() =>
		{
			vi.useFakeTimers(
				{
					toFake: ["setTimeout", "clearTimeout"],
				},
			);
		});

		afterEach(() =>
		{
			vi.useRealTimers();
		});

		const LINES = [
			"Messages: 143.5k, 14%",
			"System tools: 14.5k, 1.5%",
			"Skills: 9.9k, 0.99%",
			"Memory files: 6.3k, 0.63%",
			"Other: 5.8k, 0.58%",
			"Autocompact buffer: 33k, 3.3%",
		];

		function tooltips(): string[]
		{
			return [...document.querySelectorAll('[role="tooltip"]')].map((tip) => tip.textContent);
		}

		it("lists every series, one per line, when the meter is hovered", async () =>
		{
			await renderCards(INPUTS);

			const meter = within(body()).getByRole(
				"img",
				{
					name: /^Context window/,
				},
			);
			fireEvent.pointerEnter(meter.parentElement!);
			act(() =>
			{
				vi.advanceTimersByTime(300);
			});
			expect(tooltips()).toStrictEqual([LINES.join("\n")]);
		});

		it("lists every series when the meter takes keyboard focus", async () =>
		{
			await renderCards(INPUTS);

			fireEvent.focus(
				within(body()).getByRole(
					"img",
					{
						name: /^Context window/,
					},
				),
			);
			expect(tooltips()).toStrictEqual([LINES.join("\n")]);
		});

		it("names a hovered segment's series, amount and share", async () =>
		{
			await renderCards(INPUTS);

			const meter = within(body()).getByRole(
				"img",
				{
					name: /^Context window/,
				},
			);
			fireEvent.pointerEnter(meter.children[1] as HTMLElement);
			act(() =>
			{
				vi.advanceTimersByTime(300);
			});
			expect(tooltips()).toStrictEqual(["System tools: 14.5k, 1.5%"]);
		});
	});

	it("lists used rows, buffer and free space, then deferred rows, in upstream's legend order", async () =>
	{
		await renderCards(INPUTS);

		expect(legendRows()).toStrictEqual([
			["", "Messages", "143.5k", "14.4%"],
			["", "System tools", "14.5k", "1.5%"],
			["", "Skills", "9.9k", "1.0%", "Manage skills"],
			["", "Memory files", "6.3k", "0.6%", "View memory files"],
			["", "System prompt", "3.1k", "0.3%"],
			["", "MCP server instructions", "1.5k", "0.2%", "Manage connectors"],
			["", "Custom agents", "1.2k", "0.1%", "View custom agents"],
			["", "Autocompact buffer", "33k", "3.3%"],
			["", "Free space", "787k", "78.7%"],
			["", "MCP tools (deferred)", "94.2k", "—"],
			["", "System tools (deferred)", "26.7k", "—"],
		]);
	});

	it("draws each row's swatch in its meter series color, folded rows in the reference color", async () =>
	{
		await renderCards(INPUTS);

		expect(
			[...body().querySelectorAll("[data-rail-context-row]")].map(
				(row) => row.querySelector<HTMLElement>("[data-rail-context-swatch]")?.style.background,
			),
		).toStrictEqual([
			"var(--chart-categorical-1)",
			"var(--chart-categorical-2)",
			"var(--chart-categorical-3)",
			"var(--chart-categorical-4)",
			"var(--chart-reference)",
			"var(--chart-reference)",
			"var(--chart-reference)",
			"var(--chart-muted)",
			"var(--chart-reference-tint)",
			"var(--chart-muted)",
			"var(--chart-muted)",
		]);
	});

	it("mutes deferred rows' names and percents", async () =>
	{
		await renderCards(INPUTS);

		const deferred = [...body().querySelectorAll("[data-rail-context-row]")].at(-1);
		expect([...(deferred?.children ?? [])].map((cell) => cell.className)).toStrictEqual([
			"flex w-3 shrink-0 items-center justify-center",
			"min-w-0 flex-1 truncate text-ink-muted",
			"shrink-0 tabular-nums text-ink-muted",
			"w-11 shrink-0 text-end tabular-nums text-ink-muted",
		]);
	});

	it("links the Skills row to the skills page", async () =>
	{
		await renderCards(INPUTS);

		expect(
			within(body())
				.getByRole(
					"link",
					{
						name: /^Skills/,
					},
				)
				.getAttribute("href"),
		).toBe("/customize/skills");
	});

	it("links the MCP server instructions row to the connectors page", async () =>
	{
		await renderCards(INPUTS);

		expect(
			within(body())
				.getByRole(
					"link",
					{
						name: /^MCP server instructions.*Manage connectors$/,
					},
				)
				.getAttribute("href"),
		).toBe("/customize/connectors");
	});

	it("shows an action row's hint in a tooltip above it on hover", async () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		try
		{
			await renderCards(INPUTS);

			fireEvent.pointerEnter(
				within(body()).getByRole(
					"link",
					{
						name: /^Skills/,
					},
				).parentElement!,
			);
			act(() =>
			{
				vi.advanceTimersByTime(300);
			});
			expect(
				[...document.querySelectorAll('[role="tooltip"]')].map((tip) => [
					tip.textContent,
					tip.getAttribute("data-side"),
				]),
			).toStrictEqual([["Manage skills", "top"]]);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("opens the MCP tools expander, scrolling a list of more than 12 rows", async () =>
	{
		await renderCards(INPUTS);

		const mcp = toggle("MCP tools");
		expect(mcp.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(mcp);

		const list = mcp.nextElementSibling?.firstElementChild;
		expect(
			{
				expanded: mcp.getAttribute("aria-expanded"),
				count: mcp.textContent,
				list: list?.className,
				first: list?.firstElementChild?.textContent,
			},
		).toStrictEqual(
			{
				expanded: "true",
				count: "MCP tools13",
				list: "flex flex-col -mx-0.5 max-h-73 scroll-py-0.5 overflow-y-auto overscroll-contain p-0.5",
				first: "github · tool_0100",
			},
		);
	});

	it("gives expander rows upstream's 24px height and clips long names with an overflow tooltip", async () =>
	{
		await renderCards(INPUTS);

		const mcp = toggle("MCP tools");
		fireEvent.click(mcp);
		const row = mcp.nextElementSibling?.firstElementChild?.firstElementChild;
		const name = row?.children[1];
		expect(
			{
				row: row?.className,
				name: name?.className,
				clip: name?.querySelector("[data-rail-context-row-name]")?.className,
			},
		).toStrictEqual(
			{
				row: "flex min-h-6 w-full min-w-0 items-center gap-2 px-1 text-[12px]/[15px]",
				name: "flex min-w-0 flex-1 text-ink-muted",
				clip: "block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap flex-1",
			},
		);
	});

	it("names an MCP tool without a local connector by upstream's fallback", async () =>
	{
		await renderCards(
			{
				...INPUTS,
				breakdown:
				{
					...BREAKDOWN,
					mcpTools: [
						{
							name: "mcp__claude_ai_Claude_Docs__batch",
							serverName: "claude_ai_Claude_Docs",
							tokens: 144,
						},
					],
				},
			},
		);

		const mcp = toggle("MCP tools");
		fireEvent.click(mcp);
		expect(mcp.nextElementSibling?.firstElementChild?.firstElementChild?.textContent).toBe(
			"claude ai Claude Docs · batch144",
		);
	});

	it("links an MCP tool row to its connector when the session can manage it", async () =>
	{
		await renderCards(INPUTS, seed);

		fireEvent.click(toggle("MCP tools"));
		const first = within(body()).getByRole(
			"link",
			{
				name: /^github · tool_0100/,
			},
		);
		expect(
			{
				name: first.textContent,
				href: first.getAttribute("href"),
				className: first.className,
			},
		).toStrictEqual(
			{
				name: "github · tool_0100Manage connector",
				href: `/customize/connectors/id/${toConnectorSlug("user:github")}`,
				className:
					"group/press relative text-start flex min-h-6 w-full min-w-0 items-center gap-2 px-1 text-[12px]/[15px] rounded focus-visible:outline-hidden focus-visible:shadow-focus hover:bg-fill-ghost-hover active:bg-alpha-2",
			},
		);
	});

	it("moves focus to the MCP tools toggle when the focused tool row goes away", async () =>
	{
		const update = await renderCards(INPUTS, seed);

		fireEvent.click(toggle("MCP tools"));
		within(body())
			.getByRole(
				"link",
				{
					name: /^github · tool_12112/,
				},
			)
			.focus();
		update(
			{
				...INPUTS,
				breakdown:
				{
					...BREAKDOWN,
					mcpTools: MCP_TOOLS.slice(0, 12),
				},
			},
		);
		expect(document.activeElement).toBe(toggle("MCP tools"));
	});

	it("reveals and focuses the Custom agents expander from its action row", async () =>
	{
		await renderCards(INPUTS);

		fireEvent.click(
			within(body()).getByRole(
				"button",
				{
					name: /^Custom agents.*View custom agents/,
				},
			),
		);

		const agents = toggle("Custom agents");
		expect(
			{
				expanded: agents.getAttribute("aria-expanded"),
				focused: document.activeElement === agents,
			},
		).toStrictEqual(
			{
				expanded: "true",
				focused: true,
			},
		);
	});

	it("links auto-memory files from the Memory files expander", async () =>
	{
		await renderCards(INPUTS);

		fireEvent.click(
			within(body()).getByRole(
				"button",
				{
					name: /^Memory files.*View memory files/,
				},
			),
		);

		const memory = toggle("Memory files");
		const list = memory.nextElementSibling?.firstElementChild;
		expect(
			{
				focused: document.activeElement === memory,
				rows: [...(list?.children ?? [])].map((row) => [
					row.textContent,
					row.querySelector("a")?.getAttribute("href") ?? null,
				]),
			},
		).toStrictEqual(
			{
				focused: true,
				rows: [
					["/Users/alice/.claude/CLAUDE.md1.2k", null],
					[
						"/Users/alice/.claude/projects/-Users-alice-projects-avalonlogs/memory/MEMORY.md900",
						"/memory/-Users-alice-projects-avalonlogs/MEMORY",
					],
				],
			},
		);
	});

	it("ignores a held Enter's auto-repeat on an expander toggle", async () =>
	{
		await renderCards(INPUTS);

		const mcp = toggle("MCP tools");
		const notPrevented = fireEvent.keyDown(
			mcp,
			{
				key: "Enter",
				repeat: true,
			},
		);
		expect(
			{
				notPrevented,
				expanded: mcp.getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				notPrevented: false,
				expanded: "false",
			},
		);
	});

	describe("footer", () =>
	{
		const SIXTEEN_HOURS_LATER = new Date(Date.parse(BREAKDOWN.fetchedAt) + 16 * 3_600_000);

		beforeEach(() =>
		{
			vi.useFakeTimers(
				{
					toFake: ["Date"],
				},
			);
			vi.setSystemTime(SIXTEEN_HOURS_LATER);
		});

		afterEach(() =>
		{
			vi.useRealTimers();
		});

		async function footer(source: ContextBreakdown["source"], working: boolean)
		{
			await renderCards(
				{
					...INPUTS,
					working,
					breakdown:
					{
						...BREAKDOWN,
						source,
					},
				},
			);
			const found = body().querySelector("[data-rail-context-updated]");
			return {
				text: found?.textContent,
				dateTime: found?.querySelector("time")?.getAttribute("datetime"),
				className: found?.className,
			};
		}

		const className = "mt-1 px-2 pb-1 text-[12px]/[15px] text-secondary";

		it("dates a /context breakdown by its run and says a new run refreshes it", async () =>
		{
			const results = [await footer("context-command", false)];
			cleanup();
			results.push(await footer("context-command", true));
			expect(results).toStrictEqual([
				{
					text: "Last updated 16 hours ago. Run /context to refresh.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
				{
					text: "Last updated 16 hours ago. Run /context to refresh.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
			]);
		});

		it("says a message refreshes a mod breakdown, or the turn's end while working", async () =>
		{
			const results = [await footer("mod", false)];
			cleanup();
			results.push(await footer("mod", true));
			expect(results).toStrictEqual([
				{
					text: "Last updated 16 hours ago. Send a message to refresh.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
				{
					text: "Last updated 16 hours ago. Refreshes when this turn ends.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
			]);
		});
	});
});

describe("Outputs card", () =>
{
	function artifact(index: number): SessionRailInputs["artifacts"][number]
	{
		return {
			url: `https://claude.ai/artifact/a${index}`,
			id: `a${index}`,
			kind: "html",
			title: `Artifact ${index}`,
			previewable: false,
			lastEventAt: index,
		};
	}

	it("counts its outputs and lists five newest first, then Show more", async () =>
	{
		await renderCards(
			{
				...BASE,
				artifacts: [1, 2, 3, 4, 5, 6, 7].map(artifact),
			},
		);

		expect(
			{
				summary: cards().find(([id]) => id === "outputs")?.[1],
				rows: rows("Outputs"),
			},
		).toStrictEqual(
			{
				summary: "7",
				rows: [
					["Artifact 7", null],
					["Artifact 6", null],
					["Artifact 5", null],
					["Artifact 4", null],
					["Artifact 3", null],
					["Show more", null],
				],
			},
		);
	});

	it("expands in place to every output", async () =>
	{
		await renderCards(
			{
				...BASE,
				artifacts: [1, 2, 3, 4, 5, 6, 7].map(artifact),
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show more",
				},
			),
		);

		expect(rows("Outputs").map(([label]) => label)).toStrictEqual([
			"Artifact 7",
			"Artifact 6",
			"Artifact 5",
			"Artifact 4",
			"Artifact 3",
			"Artifact 2",
			"Artifact 1",
			"Show less",
		]);
	});

	it("draws a written file's monochrome 16px glyph, never a coloured file-type icon", async () =>
	{
		localStorage.setItem("ccp-code-theme-light", "github-light");
		await renderCards(
			{
				...BASE,
				artifacts: [],
				outputFiles: [
					{
						path: "/tmp/data.json",
						at: 2,
					},
				],
			},
		);
		const card = screen.getByRole(
			"region",
			{
				name: /^Outputs/,
			},
		);
		const svg = within(card)
			.getByRole(
				"button",
				{
					name: "Open data.json in Files",
				},
			)
			.querySelector("svg");

		expect(
			{
				coloured: card.querySelector("[data-file-type-icon]") !== null,
				className: svg?.getAttribute("class"),
				width: svg?.style.width,
			},
		).toStrictEqual(
			{
				coloured: false,
				className: "lucide lucide-code-xml shrink-0",
				width: "16px",
			},
		);
	});

	it("lists a written file by its basename among the artifacts by time, opening it in the Files pane", async () =>
	{
		unregisters.push(
			registerPane(
				"files",
				{
					title: "Files",
					render: () => <p>files pane body</p>,
				},
			),
		);
		await renderCards(
			{
				...BASE,
				artifacts: [artifact(1), artifact(3)],
				outputFiles: [
					{
						path: "/tmp/report.md",
						at: 2,
					},
				],
			},
		);
		const labels = rows("Outputs");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open report.md in Files",
				},
			),
		);
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});

		expect(
			{
				labels,
				pane: screen.queryAllByText("files pane body").map((body) => body.tagName),
			},
		).toStrictEqual(
			{
				labels: [
					["Artifact 3", null],
					["report.md", null],
					["Artifact 1", null],
				],
				pane: ["P"],
			},
		);
	});
});

describe("Servers card", () =>
{
	function withServers(
		servers: ReadonlyArray<
		{
			url: string;
			name?: string;
			live: boolean;
		}>,
	)
	{
		return (client: QueryClient) =>
		{
			client.setQueryData(
				sessionDevServersQueryOptions(SESSION_ID, true).queryKey,
				{
					servers: [...servers],
				},
			);
		};
	}

	function ports(...numbers: number[])
	{
		return numbers.map((port) => (
		{
			url: `http://localhost:${port}`,
			live: true,
		}));
	}

	it("opens a running server in the browser under upstream's Open {name} in Browser name", async () =>
	{
		await renderCards(BASE, withServers(ports(7611)));
		const link = within(
			screen.getByRole(
				"region",
				{
					name: /^Servers/,
				},
			),
		).getByRole("link");

		expect(
			{
				name: link.getAttribute("aria-label"),
				href: link.getAttribute("href"),
				target: link.getAttribute("target"),
				rel: link.getAttribute("rel"),
			},
		).toStrictEqual(
			{
				name: "Open localhost:7611 in Browser",
				href: "http://localhost:7611",
				target: "_blank",
				rel: "noopener noreferrer",
			},
		);
	});

	it("labels a named server by its name with localhost:<port> trailing", async () =>
	{
		await renderCards(
			BASE,
			withServers([
				{
					url: "http://localhost:5173",
					name: "web",
					live: true,
				},
			]),
		);

		expect(
			{
				rows: rows("Servers"),
				name: screen.getByRole(
					"link",
					{
						name: "Open web in Browser",
					},
				).tagName,
			},
		).toStrictEqual(
			{
				rows: [["web", "localhost:5173"]],
				name: "A",
			},
		);
	});

	it("counts only live servers and draws a dead one as a plain Not responding row", async () =>
	{
		await renderCards(
			BASE,
			withServers([
				{
					url: "http://localhost:7611",
					live: true,
				},
				{
					url: "http://localhost:9000",
					live: false,
				},
			]),
		);
		const card = screen.getByRole(
			"region",
			{
				name: /^Servers/,
			},
		);

		expect(
			{
				summary: cards().find(([id]) => id === "servers")?.[1],
				rows: rows("Servers"),
				links: within(card)
					.queryAllByRole("link")
					.map((link) => link.getAttribute("aria-label")),
				deadTag: within(card).getByText("localhost:9000").closest("[data-rail-row-label]")?.parentElement
					?.tagName,
			},
		).toStrictEqual(
			{
				summary: "1 running",
				rows: [
					["localhost:7611", null],
					["localhost:9000", "Not responding"],
				],
				links: ["Open localhost:7611 in Browser"],
				deadTag: "DIV",
			},
		);
	});

	it("says 0 running when no server responds", async () =>
	{
		await renderCards(
			BASE,
			withServers([
				{
					url: "http://localhost:9000",
					live: false,
				},
			]),
		);

		expect(cards().find(([id]) => id === "servers")?.[1]).toBe("0 running");
	});

	it("lists four servers, then Show more, which expands in place and back", async () =>
	{
		await renderCards(BASE, withServers(ports(1, 2, 3, 4, 5, 6)));
		const collapsed =
		{
			rows: rows("Servers").map(([label]) => label),
			expanded: screen
				.getByRole(
					"button",
					{
						name: "Show more",
					},
				)
				.getAttribute("aria-expanded"),
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show more",
				},
			),
		);

		expect(
			{
				collapsed,
				expanded: rows("Servers").map(([label]) => label),
			},
		).toStrictEqual(
			{
				collapsed:
				{
					rows: ["localhost:1", "localhost:2", "localhost:3", "localhost:4", "Show more"],
					expanded: "false",
				},
				expanded: [
					"localhost:1",
					"localhost:2",
					"localhost:3",
					"localhost:4",
					"localhost:5",
					"localhost:6",
					"Show less",
				],
			},
		);
	});

	it("focuses the fifth server when Show more is pressed from the keyboard", async () =>
	{
		await renderCards(BASE, withServers(ports(1, 2, 3, 4, 5, 6)));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show more",
				},
			),
			{
				detail: 0,
			},
		);

		expect(document.activeElement?.getAttribute("aria-label")).toBe("Open localhost:5 in Browser");
	});

	it("wraps its rows in upstream's unfocusable flex column", async () =>
	{
		await renderCards(BASE, withServers(ports(7611)));
		const list = within(
			screen.getByRole(
				"region",
				{
					name: /^Servers/,
				},
			),
		).getByTestId("rail-rows");

		expect(
			{
				tabIndex: list.getAttribute("tabindex"),
				className: list.className,
			},
		).toStrictEqual(
			{
				tabIndex: "-1",
				className: "flex flex-col outline-none",
			},
		);
	});
});
