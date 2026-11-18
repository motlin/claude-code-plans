// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import
{
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useParams,
} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {SessionTitleHeading} from "../src/components/session-title-heading";
import {ToastProvider} from "../src/components/toast";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import
{
	recentSessionsQueryOptions,
	sessionDetailQueryOptions,
	type SessionDetailData,
	sessionQueryKeys,
} from "../src/lib/api/sessions";
import {pin, readPinState} from "../src/lib/pin-store";
import
{
	clearPanePaletteState,
	type PanePaletteState,
	publishPanePaletteState,
} from "../src/lib/palette-pane-commands-store";
import {resetSideChatStore} from "../src/lib/side-chat-store";
import {publishFamilyHeads, resetFamilyHeadsStore} from "../src/lib/sidebar-family-heads-store";
import {readSidebarState, setFamiliesCollapsed} from "../src/lib/sidebar-store";
import {installLocalStorage} from "./fake-storage";
import {byLabel} from "./helpers/palette-label";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const TITLE = "Migrate the indexer to incremental scans for huge projects";
const QUOTED = "“Migrate the indexer to incremental scan…”";

function detail(overrides: Partial<SessionDetailData> = {}): SessionDetailData
{
	return {
		title: TITLE,
		projectName: "project-a",
		projectId: "project-a",
		homeRoot: "/users/dev",
		imageRoots: [],
		archived: false,
		summary: null,
		projectPath: "/users/dev/project-a",
		gitBranch: null,
		cwd: null,
		gitSha: null,
		gitClean: null,
		messageCount: 1,
		pendingTaskCount: 0,
		viewedState: "unviewed",
		...overrides,
	} as SessionDetailData;
}

function Harness()
{
	const palette = useCommandPalette();
	return (
		<>
			<textarea aria-label="Composer" />
			<CommandPalette {...palette} />
		</>
	);
}

function SessionRoute()
{
	const {id} = useParams(
		{
			strict: false,
		},
	);
	return <SessionTitleHeading sessionId={id ?? ""} title={TITLE} archived={false} />;
}

async function openPalette(initialPath: string, sessionDetail: SessionDetailData = detail())
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
		recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey,
		{
			sessions: [],
			nextCursor: null,
		},
	);
	queryClient.setQueryData(sessionDetailQueryOptions("sess-1").queryKey, sessionDetail);
	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<Harness />
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
			),
		},
	);
	const sessionRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "session/$id",
			component: SessionRoute,
		},
	);
	const plansRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "plans",
			component: () => null,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([sessionRoute, plansRoute]),
			history: createMemoryHistory(
				{
					initialEntries: [initialPath],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
	const composer = await screen.findByRole(
		"textbox",
		{
			name: "Composer",
		},
	);
	composer.focus();
	fireEvent.keyDown(
		composer,
		{
			key: "k",
			code: "KeyK",
			metaKey: true,
		},
	);
	const dialog = await screen.findByRole(
		"dialog",
		{
			name: "Search",
		},
	);
	return {
		dialog,
		input: within(dialog).getByRole(
			"combobox",
			{
				name: "Search",
			},
		),
		queryClient,
	};
}

/** The listed nested-sessions commands, in order. */
function nestedLabels(dialog: HTMLElement): string[]
{
	return optionLabels(dialog).filter((label) => label.includes("nested sessions"));
}

async function typeQuery(dialog: HTMLElement, input: HTMLElement, value: string)
{
	fireEvent.change(
		input,
		{
			target:
			{
				value,
			},
		},
	);
	// The search never settles here, so the settling skeleton marks the typed query as rendered.
	await waitFor(() =>
	{
		expect(dialog.querySelector("[data-palette-skeleton]")).not.toBeNull();
	});
}

function optionLabels(dialog: HTMLElement): string[]
{
	return [...dialog.querySelectorAll("[cmdk-item]")].map(
		(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
	);
}

describe("palette contextual session commands", () =>
{
	const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => Promise.resolve());
	const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
		async (_url: string, _init?: RequestInit) => new Promise<Response>(() => {}),
	);

	beforeEach(() =>
	{
		fetchMock.mockImplementation(async () => new Promise<Response>(() => {}));
		installLocalStorage();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal(
			"ResizeObserver",
			class
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
			},
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
		Element.prototype.scrollIntoView = () =>
		{
		};
	});

	afterEach(() =>
	{
		cleanup();
		resetFamilyHeadsStore();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		writeText.mockClear();
		fetchMock.mockClear();
	});

	it("lists the copy commands with the quoted title when 'copy' is typed on a session page", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "copy",
				},
			},
		);

		await within(dialog).findByRole("option", byLabel(`Copy link to ${QUOTED}`));
		expect(optionLabels(dialog).slice(0, 3)).toStrictEqual([
			`Copy link to ${QUOTED}`,
			"Copy resume command",
			"Copy fork command",
		]);
		expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/identity"))).toStrictEqual([]);
	});

	it.each([
		{
			query: "resume",
			label: "Copy resume command",
			copied: "cd '/users/dev/project-a' && claude -r sess-1",
		},
		{
			query: "fork",
			label: "Copy fork command",
			copied: "cd '/users/dev/project-a' && claude -r sess-1 --fork-session",
		},
		{
			query: "link",
			label: `Copy link to ${QUOTED}`,
			copied: "http://localhost:3000/session/sess-1",
		},
	])("uses the resolved local ID for the alias route's $query command", async ({query, label, copied}) =>
	{
		fetchMock.mockImplementation(async (url) =>
			url.endsWith("/identity")
				? Promise.resolve(
						Response.json(
							{
								sessionId: "sess-1",
							},
						),
					)
				: new Promise<Response>(() => {}),
		);
		const {dialog, input} = await openPalette("/session/session_alice_100");
		fireEvent.change(
			input,
			{
				target:
				{
					value: query,
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(label)));
		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([[copied]]);
		});
		expect(
			fetchMock.mock.calls.filter(([url]) => url.includes("session_alice_100")).map(([url]) => url),
		).toStrictEqual(["/api/sessions/session_alice_100/identity"]);
	});

	it("pins the local UUID after resolving an alias", async () =>
	{
		fetchMock.mockImplementation(async (url) =>
			url.endsWith("/identity")
				? Promise.resolve(
						Response.json(
							{
								sessionId: "sess-1",
							},
						),
					)
				: new Promise<Response>(() => {}),
		);
		const {dialog, input} = await openPalette("/session/session_alice_100");
		fireEvent.change(
			input,
			{
				target:
				{
					value: "pin",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Pin ${QUOTED}`)));
		await waitFor(() =>
		{
			expect(readPinState()).toStrictEqual(
				{
					pinnedIds: ["sess-1"],
					pinnedOrder: [],
				},
			);
		});
	});

	it("archives the local UUID after resolving an alias", async () =>
	{
		fetchMock.mockImplementation(async (url) =>
			url.endsWith("/identity")
				? Promise.resolve(
						Response.json(
							{
								sessionId: "sess-1",
							},
						),
					)
				: new Promise<Response>(() => {}),
		);
		const {dialog, input} = await openPalette("/session/session_alice_100");
		fireEvent.change(
			input,
			{
				target:
				{
					value: "archive",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Archive ${QUOTED}`)));
		await waitFor(() =>
		{
			expect(
				fetchMock.mock.calls
					.filter(([, init]) => init?.method === "PUT")
					.map(([url, init]) => (
					{
						url,
						method: init?.method,
					})),
			).toStrictEqual([
				{
					url: "/api/sessions/sess-1/archived",
					method: "PUT",
				},
			]);
		});
	});

	it.each([null, 404, 409])("does not offer local session actions for an unresolved alias (%s)", async (status) =>
	{
		if (status !== null)
			fetchMock.mockImplementation(async (url) =>
				url.endsWith("/identity")
					? Promise.resolve(
							Response.json(
								{
									error: "Fabricated identity failure",
								},
								{
									status,
								},
							),
						)
					: new Promise<Response>(() => {}),
			);
		const {dialog, input, queryClient} = await openPalette("/session/session_alice_100");
		if (status !== null)
			await waitFor(() =>
			{
				expect(queryClient.getQueryState(sessionQueryKeys.identity("session_alice_100"))?.status).toBe("error");
			});
		fireEvent.change(
			input,
			{
				target:
				{
					value: "session",
				},
			},
		);
		// The search never settles here, so the settling skeleton marks the typed query as rendered.
		await waitFor(() =>
		{
			expect(dialog.querySelector("[data-palette-skeleton]")).not.toBeNull();
		});
		expect(
			{
				actions: optionLabels(dialog).filter((label) =>
					/^(Pin |Rename |Archive |Copy |Show side chat)/.test(label),
				),
				aliasRequests: fetchMock.mock.calls
					.filter(([url]) => url.includes("session_alice_100"))
					.map(([url]) => url),
				writes: fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT" || init?.method === "POST"),
			},
		).toStrictEqual(
			{
				actions: [],
				aliasRequests: ["/api/sessions/session_alice_100/identity"],
				writes: [],
			},
		);
	});

	it("offers Pin, Rename and Copy link for 'session' within the organic cap", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "session",
				},
			},
		);

		await within(dialog).findByRole("option", byLabel(`Pin ${QUOTED}`));
		// The session commands match by keyword only (rank 2), so the rank-0/1 labels lead and upstream's cap of 7 ends the list.
		expect(optionLabels(dialog)).toStrictEqual([
			"Sessions",
			"Search sessions",
			"Mark all sessions seen",
			"Settings → Sessions",
			`Pin ${QUOTED}`,
			`Rename ${QUOTED}`,
			`Copy link to ${QUOTED}`,
		]);
	});

	it("offers Unpin for a session pinned in this browser", async () =>
	{
		pin("sess-1");
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "pin",
				},
			},
		);

		await within(dialog).findByRole("option", byLabel(`Unpin ${QUOTED}`));
	});

	it("offers Unarchive for an archived session", async () =>
	{
		const {dialog, input} = await openPalette(
			"/session/sess-1",
			detail(
				{
					archived: true,
				},
			),
		);

		fireEvent.change(
			input,
			{
				target:
				{
					value: "archive",
				},
			},
		);

		await within(dialog).findByRole("option", byLabel(`Unarchive ${QUOTED}`));
		expect(within(dialog).queryByRole("option", byLabel(`Archive ${QUOTED}`))).toBeNull();
	});

	it("archives the current session from its command", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");
		fireEvent.change(
			input,
			{
				target:
				{
					value: "archive",
				},
			},
		);

		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Archive ${QUOTED}`)));

		await waitFor(() =>
		{
			expect(fetchMock.mock.calls.filter(([url]) => url === "/api/sessions/sess-1/archived")).toEqual([
				[
					"/api/sessions/sess-1/archived",
					expect.objectContaining(
						{
							method: "PUT",
						},
					),
				],
			]);
		});
	});

	it("hides the commands in the empty state", async () =>
	{
		const {dialog} = await openPalette("/session/sess-1");

		await within(dialog).findByRole("option", byLabel(/^New session/));
		expect(optionLabels(dialog).filter((label) => label.includes("Copy"))).toStrictEqual([]);
	});

	describe("pane commands", () =>
	{
		const PANE_LABELS = new Set([
			"Show terminal",
			"Hide terminal",
			"Show changes",
			"Hide changes",
			"Show files",
			"Hide files",
			"Show side chat",
			"Hide side chat",
			"New terminal",
			"Close pane",
			"Expand pane",
			"Collapse pane",
		]);
		const run = vi.fn<PanePaletteState["run"]>();

		function publish(overrides: Partial<PanePaletteState> = {})
		{
			const hidden =
			{
				enabled: true,
				shown: false,
			};
			publishPanePaletteState(
				{
					sessionId: "sess-1",
					terminal: hidden,
					changes: hidden,
					files: hidden,
					sideChat: hidden,
					newTerminalEnabled: true,
					closePaneEnabled: false,
					paneExpanded: false,
					run,
					...overrides,
				},
			);
		}

		/** The listed pane commands as [label, aria-keyshortcuts]. */
		function paneRows(dialog: HTMLElement): [string, string | null][]
		{
			return [...dialog.querySelectorAll("[cmdk-item]")].flatMap((item): [string, string | null][] =>
			{
				const label = item.querySelector("[data-palette-label]")?.textContent ?? "";
				return PANE_LABELS.has(label) ? [[label, item.getAttribute("aria-keyshortcuts")]] : [];
			});
		}

		async function paneRowsFor(query: string, path = "/session/sess-1"): Promise<[string, string | null][]>
		{
			const {dialog, input} = await openPalette(path);
			await typeQuery(dialog, input, query);
			return paneRows(dialog);
		}

		afterEach(() =>
		{
			clearPanePaletteState("sess-1");
			resetSideChatStore();
			run.mockReset();
			vi.useRealTimers();
		});

		it("lists Show terminal with ⌃` and New terminal without keycaps for 'terminal'", async () =>
		{
			publish();
			expect(await paneRowsFor("terminal")).toStrictEqual([
				["Show terminal", "Control+Backquote"],
				["New terminal", null],
			]);
		});

		it("says Hide terminal while the terminal is shown", async () =>
		{
			publish(
				{
					terminal:
					{
						enabled: true,
						shown: true,
					},
				},
			);
			expect(await paneRowsFor("terminal")).toStrictEqual([
				["Hide terminal", "Control+Backquote"],
				["New terminal", null],
			]);
		});

		it("matches both terminal rows through their 'console' hint", async () =>
		{
			publish();
			expect(await paneRowsFor("console")).toStrictEqual([
				["Show terminal", "Control+Backquote"],
				["New terminal", null],
			]);
		});

		it("matches Show files through 'explorer'", async () =>
		{
			publish();
			expect(await paneRowsFor("explorer")).toStrictEqual([["Show files", "Shift+Meta+f"]]);
		});

		it("matches Show side chat through 'btw'", async () =>
		{
			publish();
			expect(await paneRowsFor("btw")).toStrictEqual([["Show side chat", "Meta+;"]]);
		});

		it("lists Close and Expand pane for 'panel' while a pane is open", async () =>
		{
			publish(
				{
					closePaneEnabled: true,
				},
			);
			expect(await paneRowsFor("panel")).toStrictEqual([
				["Close pane", "Meta+\\"],
				["Expand pane", "Shift+Meta+\\"],
			]);
		});

		it("lists none off a session page", async () =>
		{
			expect(await paneRowsFor("terminal", "/plans")).toStrictEqual([]);
		});

		it("closes the palette and runs Hide side chat 100ms later", async () =>
		{
			publish(
				{
					sideChat:
					{
						enabled: true,
						shown: true,
					},
				},
			);
			const {dialog, input} = await openPalette("/session/sess-1");
			await typeQuery(dialog, input, "side chat");
			const option = await within(dialog).findByRole("option", byLabel(/Hide side chat/));

			vi.useFakeTimers();
			fireEvent.click(option);
			const before = run.mock.calls.length;
			vi.advanceTimersByTime(100);

			expect(
				{
					dialogOpen: dialog.isConnected,
					before,
					after: run.mock.calls,
				},
			).toStrictEqual(
				{
					dialogOpen: false,
					before: 0,
					after: [["toggle_side_chat"]],
				},
			);
		});
	});

	it("does not offer the commands on other routes", async () =>
	{
		const {dialog, input} = await openPalette("/plans");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "copy",
				},
			},
		);

		// The search never settles here, so the settling skeleton marks the typed query as rendered.
		await waitFor(() =>
		{
			expect(dialog.querySelector("[data-palette-skeleton]")).not.toBeNull();
		});
		expect(optionLabels(dialog).filter((label) => label.startsWith("Copy"))).toStrictEqual([]);
	});

	it("copies the resume command in the project directory", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "resume",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel("Copy resume command")));

		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([["cd '/users/dev/project-a' && claude -r sess-1"]]);
		});
		expect(await screen.findByText("Command copied to clipboard.")).toBeTruthy();
	});

	it("copies the fork command", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "fork",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel("Copy fork command")));

		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([
				["cd '/users/dev/project-a' && claude -r sess-1 --fork-session"],
			]);
		});
	});

	it.each([
		{
			query: "link",
			label: `Copy link to ${QUOTED}`,
			copied: "http://localhost:3000/session/session_alice_100",
		},
		{
			query: "resume",
			label: "Copy resume command",
			copied: "cd '/users/dev/project-a' && claude -r sess-1",
		},
		{
			query: "fork",
			label: "Copy fork command",
			copied: "cd '/users/dev/project-a' && claude -r sess-1 --fork-session",
		},
	])("uses canonical proof only for the copied URL, preserving the $query command", async ({query, label, copied}) =>
	{
		const {dialog, input} = await openPalette(
			"/session/sess-1",
			detail(
				{
					canonicalRouteId: "session_alice_100",
				},
			),
		);
		fireEvent.change(
			input,
			{
				target:
				{
					value: query,
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(label)));
		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([[copied]]);
		});
		expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/identity"))).toStrictEqual([]);
	});

	it("copies the session link", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "link",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Copy link to ${QUOTED}`)));

		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]);
		});
		expect(await screen.findByText("Link copied to clipboard.")).toBeTruthy();
	});

	it("pins the session in this browser without a server call", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "pin",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Pin ${QUOTED}`)));

		await waitFor(() =>
		{
			expect(readPinState()).toStrictEqual(
				{
					pinnedIds: ["sess-1"],
					pinnedOrder: [],
				},
			);
		});
		expect(fetchMock.mock.calls.filter(([url]) => url.includes("/starred"))).toStrictEqual([]);
	});

	it("starts renaming the session title", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "rename",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Rename ${QUOTED}`)));

		const rename = await screen.findByRole(
			"textbox",
			{
				name: "Rename",
			},
		);
		expect((rename as HTMLInputElement).value).toBe(TITLE);
	});

	it("leaves focus in the inline rename input when the palette closes behind it", async () =>
	{
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(
			input,
			{
				target:
				{
					value: "rename",
				},
			},
		);
		fireEvent.click(await within(dialog).findByRole("option", byLabel(`Rename ${QUOTED}`)));
		const rename = await screen.findByRole(
			"textbox",
			{
				name: "Rename",
			},
		);
		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"dialog",
					{
						name: "Search",
					},
				),
			).toBe(null);
		});
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 50);
		});

		expect(document.activeElement).toBe(rename);
	});

	describe("Hide/Show (all) nested sessions", () =>
	{
		const owner = Symbol("sidebar");

		// Upstream `sS`: Hide all needs an unfolded listed family, Show all a folded one.
		it.each([
			{
				folded: [],
				listed: ["Hide all nested sessions"],
			},
			{
				folded: ["h1"],
				listed: ["Hide all nested sessions", "Show all nested sessions"],
			},
			{
				folded: ["h1", "h2"],
				listed: ["Show all nested sessions"],
			},
		])("lists $listed for 'nested' with $folded folded", async ({folded, listed}) =>
		{
			publishFamilyHeads(owner, ["h1", "h2"]);
			setFamiliesCollapsed(folded, true);
			const {dialog, input} = await openPalette("/plans");
			await typeQuery(dialog, input, "nested");

			expect(nestedLabels(dialog)).toStrictEqual(listed);
			const rows = [...dialog.querySelectorAll("[cmdk-item]")].filter((row) =>
				row.textContent.includes("nested sessions"),
			);
			// Upstream binds no shortcut, so the rows carry no keycaps.
			expect(rows.map((row) => row.getAttribute("aria-keyshortcuts"))).toStrictEqual(listed.map(() => null));
		});

		it("matches Show all through its 'Unfold sessions' hint", async () =>
		{
			publishFamilyHeads(owner, ["h1", "h2"]);
			setFamiliesCollapsed(["h1"], true);
			const {dialog, input} = await openPalette("/plans");
			await typeQuery(dialog, input, "unfold");

			expect(nestedLabels(dialog)).toStrictEqual(["Show all nested sessions"]);
		});

		it("folds every listed family from Hide all and closes", async () =>
		{
			publishFamilyHeads(owner, ["h1", "h2"]);
			const {dialog, input} = await openPalette("/plans");
			await typeQuery(dialog, input, "nested");
			fireEvent.click(within(dialog).getByRole("option", byLabel("Hide all nested sessions")));

			expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:h1", "code:h2"]);
			await waitFor(() =>
			{
				expect(
					screen.queryByRole(
						"dialog",
						{
							name: "Search",
						},
					),
				).toBeNull();
			});
		});

		it("offers none while no session list is mounted", async () =>
		{
			const {dialog, input} = await openPalette("/plans");
			await typeQuery(dialog, input, "nested");

			expect(nestedLabels(dialog)).toStrictEqual([]);
		});

		it("offers none in the empty Search view", async () =>
		{
			publishFamilyHeads(owner, ["h1", "h2"]);
			const {dialog} = await openPalette("/plans");
			await within(dialog).findByRole("option", byLabel(/^New session/));

			expect(nestedLabels(dialog)).toStrictEqual([]);
		});

		it("hides the current family head's nested sessions", async () =>
		{
			publishFamilyHeads(owner, ["sess-1"]);
			const {dialog, input} = await openPalette("/session/sess-1");
			await typeQuery(dialog, input, "nested");

			expect(nestedLabels(dialog)).toStrictEqual(["Hide nested sessions", "Hide all nested sessions"]);
			fireEvent.click(within(dialog).getByRole("option", byLabel("Hide nested sessions")));
			expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:sess-1"]);
		});

		it("shows a folded current family head's nested sessions", async () =>
		{
			publishFamilyHeads(owner, ["sess-1"]);
			setFamiliesCollapsed(["sess-1"], true);
			const {dialog, input} = await openPalette("/session/sess-1");
			await typeQuery(dialog, input, "nested");

			expect(nestedLabels(dialog)).toStrictEqual(["Show nested sessions", "Show all nested sessions"]);
			fireEvent.click(within(dialog).getByRole("option", byLabel("Show nested sessions")));
			expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
		});

		it("offers no per-session command when the current session heads no listed family", async () =>
		{
			publishFamilyHeads(owner, ["other"]);
			const {dialog, input} = await openPalette("/session/sess-1");
			await typeQuery(dialog, input, "nested");

			expect(nestedLabels(dialog)).toStrictEqual(["Hide all nested sessions"]);
		});

		it("matches Hide nested sessions through 'fold'", async () =>
		{
			publishFamilyHeads(owner, ["sess-1"]);
			const {dialog, input} = await openPalette("/session/sess-1");
			await typeQuery(dialog, input, "fold");

			expect(nestedLabels(dialog)).toStrictEqual(["Hide nested sessions", "Hide all nested sessions"]);
		});
	});
});
