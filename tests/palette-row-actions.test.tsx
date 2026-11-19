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
	useRouterState,
} from "@tanstack/react-router";
import {readFileSync} from "node:fs";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {z} from "zod";
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {rowActionsAnchorRect} from "../src/components/palette-row-actions-geometry";
import {cardFromThumbOffset} from "../src/components/palette-thumb-geometry";
import {ToastProvider} from "../src/components/toast";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {artifactsQueryOptions, type ArtifactSummary} from "../src/lib/api/artifacts";
import {MemoryListResponse, projectMemoriesQueryOptions} from "../src/lib/api/memories";
import {plansQueryOptions} from "../src/lib/api/plans";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {routinesQueryOptions, type Routine} from "../src/lib/api/routines";
import {ARTIFACT_PIN_STORAGE_KEY} from "../src/lib/artifact-pins";
import {recentSessionsQueryOptions, sessionQueryKeys, type SessionListItem} from "../src/lib/api/sessions";
import {pin, readPinState} from "../src/lib/pin-store";
import {useSessionRenameRequest} from "../src/lib/session-rename-request";
import {__awaitingAckTesting, ackedAt} from "../src/lib/awaiting-ack-store";
import {clearAll, hasUnseenWork, isExplicitUnread, markUnseen} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";
import {PanelsOff} from "./fizzy-lake-off";

const renameRequests: string[] = [];

function SessionPage()
{
	const {id = ""} = useParams(
		{
			strict: false,
		},
	);
	useSessionRenameRequest(id, () => renameRequests.push(id));
	return null;
}

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function recentSession(id: string, title: string)
{
	return {
		id,
		title,
		summary: undefined,
		mtime: new Date().toISOString(),
		created: new Date().toISOString(),
		project: "/users/dev/project-a",
		projectName: "project-a",
		messageCount: 1,
		gitBranch: undefined,
		archived: false,
		state: "unknown" as const,
		bucket: "done" as const,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

function Location()
{
	const pathname = useRouterState(
		{
			select: (state) => state.location.pathname,
		},
	);
	return <output aria-label="Location">{pathname}</output>;
}

function Harness()
{
	const palette = useCommandPalette();
	return (
		<>
			<textarea aria-label="Composer" />
			<Location />
			<CommandPalette {...palette} />
		</>
	);
}

async function openPalette(
	sessions: SessionListItem[] = [
		recentSession("sess-1", "Refactor auth module"),
		recentSession("sess-2", "Write release notes"),
	],
	seed: (queryClient: QueryClient) => void = () =>
	{
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
		recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey,
		{
			sessions,
			nextCursor: null,
		},
	);
	seed(queryClient);
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
			component: SessionPage,
		},
	);
	const artifactRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "artifact/$id",
			component: () => null,
		},
	);
	const projectRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "project/$id",
			component: () => null,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([sessionRoute, artifactRoute, projectRoute]),
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	render(
		<PanelsOff>
			<RouterProvider router={router} />
		</PanelsOff>,
	);
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
	await within(dialog).findByRole(
		"option",
		{
			name: /Refactor auth module/,
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

async function openCard()
{
	const opened = await openPalette();
	fireEvent.keyDown(
		opened.input,
		{
			key: "Enter",
			code: "Enter",
			altKey: true,
		},
	);
	const card = await screen.findByRole(
		"menu",
		{
			name: "Actions",
		},
	);
	return {
		...opened,
		card,
	};
}

/** The cmdk values of the rows whose wrapper currently holds the "…" button. */
function rowsWithActionsButton(dialog: HTMLElement)
{
	return [...dialog.querySelectorAll("[cmdk-item]")]
		.filter((row) => row.parentElement?.querySelector("[data-palette-row-actions-button]") !== null)
		.map((row) => row.getAttribute("data-value"));
}

function menuItems(card: HTMLElement)
{
	return within(card)
		.getAllByRole("menuitem")
		.map((item) => [item.textContent, item.getAttribute("aria-keyshortcuts")]);
}

describe("palette row actions card", () =>
{
	const writeText = vi.fn<(text: string) => Promise<void>>(async () => Promise.resolve());
	const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Promise<Response>(() => {}));

	beforeEach(() =>
	{
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
		clearAll();
		__awaitingAckTesting.reset();
		renameRequests.length = 0;
	});

	afterEach(() =>
	{
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		writeText.mockClear();
		fetchMock.mockClear();
	});

	it("⌥⏎ opens the card for the selected session row with focus on Open", async () =>
	{
		const {card, input} = await openCard();

		await waitFor(() =>
		{
			expect(document.activeElement).toBe(
				within(card).getByRole(
					"menuitem",
					{
						name: "Open",
					},
				),
			);
		});
		expect(
			{
				heading: card.querySelector("[data-palette-card-title]")?.textContent,
				meta: card.querySelector("[data-palette-card-meta]")?.textContent,
				items: menuItems(card),
				inputFocused: document.activeElement === input,
			},
		).toStrictEqual(
			{
				heading: "Refactor auth module",
				meta: "Code session · Just now",
				items: [
					["Open1", "1"],
					["Open in new tab2", "2"],
					["Copy link3", "3"],
					["Pin4", "4"],
					["Rename5", "5"],
					["Archive6", "6"],
					["Mark as unread7", "7"],
				],
				inputFocused: false,
			},
		);
	});

	it("boxes each item's digit in upstream's Kbd keycap, shown on touch too, after the row's gap-xs", async () =>
	{
		const {card} = await openCard();
		const open = card.querySelector('[data-card-item="open"]');
		const kbd = open?.querySelector("kbd");

		expect(
			{
				trailing: kbd?.parentElement?.className,
				trailingHidden: kbd?.parentElement?.getAttribute("aria-hidden"),
				kbd:
				{
					cds: kbd?.getAttribute("data-cds"),
					className: kbd?.className,
					text: kbd?.textContent,
				},
				shortcut: open?.querySelector('[data-cds="Shortcut"]') ?? null,
			},
		).toStrictEqual(
			{
				trailing: "ms-3 flex shrink-0 items-center gap-1.5",
				trailingHidden: "true",
				kbd:
				{
					cds: "Kbd",
					className:
						"text-caption inline-flex shrink-0 items-center justify-center h-[calc(1em+6px)] rounded-r3 [color:var(--shortcut-cap-ink)] bg-transparent border border-[color:var(--shortcut-cap-line)] [font-family:inherit] [font-variation-settings:inherit] [line-height:1] w-[calc(1em+6px)] px-0",
					text: "1",
				},
				shortcut: null,
			},
		);
	});

	it("pads the card header with upstream's px-2.5 in every density", async () =>
	{
		const {card} = await openCard();

		expect(card.querySelector("[data-palette-card-title]")?.parentElement?.className).toBe(
			"flex flex-col gap-0.5 px-2.5 pt-1 pb-1",
		);
	});

	it('reads just "Code session" in the meta when the session is older than a year', async () =>
	{
		const ancient =
		{
			...recentSession("sess-2", "Write release notes"),
			mtime: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
		};
		const {dialog, input} = await openPalette([recentSession("sess-1", "Refactor auth module"), ancient]);

		fireEvent.keyDown(
			input,
			{
				key: "ArrowDown",
				code: "ArrowDown",
			},
		);
		await waitFor(() =>
		{
			expect(rowsWithActionsButton(dialog)).toStrictEqual(["session:sess-2"]);
		});
		fireEvent.click(dialog.querySelector("[data-palette-row-actions-button]")!);

		const card = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);
		expect(
			{
				heading: card.querySelector("[data-palette-card-title]")?.textContent,
				meta: card.querySelector("[data-palette-card-meta]")?.textContent,
			},
		).toStrictEqual(
			{
				heading: "Write release notes",
				meta: "Code session",
			},
		);
	});

	it("renders the row … button only on the selected row, in upstream's end-9 own-keys wrapper", async () =>
	{
		const {dialog, input} = await openPalette();
		expect(rowsWithActionsButton(dialog)).toStrictEqual(["session:sess-1"]);
		const wrapper = dialog.querySelector("[data-palette-row-actions-button]")?.closest("span[aria-hidden]");
		expect(
			{
				ariaHidden: wrapper?.getAttribute("aria-hidden"),
				ownKeys: wrapper?.getAttribute("data-palette-own-keys"),
				className: wrapper?.className,
			},
		).toStrictEqual(
			{
				ariaHidden: "true",
				ownKeys: "",
				className: "pointer-events-none absolute inset-y-0 end-9 flex items-center *:pointer-events-auto",
			},
		);

		fireEvent.keyDown(
			input,
			{
				key: "ArrowDown",
				code: "ArrowDown",
			},
		);

		await waitFor(() =>
		{
			expect(rowsWithActionsButton(dialog)).toStrictEqual(["session:sess-2"]);
		});
	});

	it("shows the footer Actions ⌥⏎ hint only while the selected row supports actions", async () =>
	{
		const {dialog, input} = await openPalette();
		const footerLabels = () =>
			[...dialog.querySelectorAll("[data-palette-footer-hint]")].map(
				(hint) => hint.querySelector("span")?.textContent,
			);
		const selected = () => dialog.querySelector("[cmdk-item][data-selected=true]")?.getAttribute("data-value");
		const step = async (key: "ArrowDown" | "ArrowUp", value: string) =>
		{
			fireEvent.keyDown(
				input,
				{
					key,
					code: key,
				},
			);
			await waitFor(() =>
			{
				expect(selected()).toBe(value);
			});
			return {
				selected: value,
				footer: footerLabels(),
			};
		};

		const first =
		{
			selected: selected(),
			footer: footerLabels(),
		};
		const second = await step("ArrowDown", "session:sess-2");
		const newSession = await step("ArrowDown", "action:New session");
		const back = await step("ArrowUp", "session:sess-2");

		expect(
			{
				first,
				second,
				newSession,
				back,
			},
		).toStrictEqual(
			{
				first:
				{
					selected: "session:sess-1",
					footer: ["Close", "Change type", "Filters", "Actions"],
				},
				second:
				{
					selected: "session:sess-2",
					footer: ["Close", "Change type", "Filters", "Actions"],
				},
				newSession:
				{
					selected: "action:New session",
					footer: ["Close", "Change type", "Filters"],
				},
				back:
				{
					selected: "session:sess-2",
					footer: ["Close", "Change type", "Filters", "Actions"],
				},
			},
		);
	});

	it("opens from the selected row's … button", async () =>
	{
		const {dialog, input} = await openPalette();

		fireEvent.keyDown(
			input,
			{
				key: "ArrowDown",
				code: "ArrowDown",
			},
		);
		const buttons = await waitFor(() =>
		{
			const found = dialog.querySelectorAll("[data-palette-row-actions-button]");
			expect(found.length).toBe(1);
			return found;
		});
		fireEvent.click(buttons[0]!);

		const card = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);
		expect(card.querySelector("[data-palette-card-title]")?.textContent).toBe("Write release notes");
	});

	it("copies the current fresh canonical proof from the selected row card", async () =>
	{
		const {card, queryClient} = await openCard();
		queryClient.setQueryData(
			sessionQueryKeys.detail("sess-1"),
			{
				canonicalRouteId: "session_alice_100",
			},
		);
		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
			},
		);
		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/session_alice_100"]]);
		});
	});

	it("ignores stale or conflicting canonical ownership when copying from a row card", async () =>
	{
		const {card, queryClient} = await openCard();
		queryClient.setQueryData(
			sessionQueryKeys.detail("sess-1"),
			{
				canonicalRouteId: "session_alice_100",
			},
		);
		queryClient.setQueryData(
			sessionQueryKeys.identity("session_alice_100"),
			{
				sessionId: "sess-2",
			},
		);
		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
			},
		);
		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]);
		});
	});

	it("number keys activate items", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
			},
		);

		await waitFor(() =>
		{
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]);
		});
		expect(await screen.findByText("Link copied to clipboard.")).toBeTruthy();
		expect(
			screen.queryByRole(
				"menu",
				{
					name: "Actions",
				},
			),
		).toBeNull();
	});

	it("marks the session unread from the card", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "7",
				code: "Digit7",
			},
		);

		expect(
			{
				unseen: hasUnseenWork("sess-1"),
				explicit: isExplicitUnread("sess-1"),
			},
		).toStrictEqual(
			{
				unseen: true,
				explicit: true,
			},
		);
	});

	it("Mark as completed on a waiting row acks it at the session's mtime", async () =>
	{
		const mtime = new Date().toISOString();
		const {input} = await openPalette([
			{
				...recentSession("sess-1", "Refactor auth module"),
				mtime,
				state: "waiting",
				bucket: "blocked",
			},
			recentSession("sess-2", "Write release notes"),
		]);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const card = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);

		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Mark as completed/,
				},
			),
		);

		const undoTitle = document.querySelector("[data-toast] [data-toast-message]")?.textContent;

		expect(
			{
				unseen: hasUnseenWork("sess-1"),
				ackedAt: ackedAt("sess-1"),
				undoTitle,
			},
		).toStrictEqual(
			{
				unseen: false,
				ackedAt: Date.parse(mtime),
				undoTitle: "Marked 1 session as completed",
			},
		);
	});

	it("offers a seen failed row Mark as completed after the toggle, and drops it once acked", async () =>
	{
		const mtime = new Date().toISOString();
		const failedAt = new Date(Date.parse(mtime) - 60_000).toISOString();
		const {input} = await openPalette([
			{
				...recentSession("sess-1", "Refactor auth module"),
				mtime,
				failedAt,
			},
			recentSession("sess-2", "Write release notes"),
		]);
		const openActions = async () =>
		{
			fireEvent.keyDown(
				input,
				{
					key: "Enter",
					code: "Enter",
					altKey: true,
				},
			);
			return screen.findByRole(
				"menu",
				{
					name: "Actions",
				},
			);
		};
		const card = await openActions();
		const before = menuItems(card).map(([label]) => label);
		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Mark as completed/,
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"menu",
					{
						name: "Actions",
					},
				),
			).toBeNull();
		});
		const after = menuItems(await openActions()).map(([label]) => label);

		expect(
			{
				before: before.slice(-2),
				ackedAt: ackedAt("sess-1"),
				after: after.slice(-2),
			},
		).toStrictEqual(
			{
				before: ["Mark as unread7", "Mark as completed8"],
				ackedAt: Date.parse(mtime),
				after: ["Archive6", "Mark as unread7"],
			},
		);
	});

	it("offers an unseen failed row Mark as read, then Mark as completed, not the waiting ack alone", async () =>
	{
		const mtime = new Date().toISOString();
		markUnseen("sess-1");
		const {input} = await openPalette([
			{
				...recentSession("sess-1", "Refactor auth module"),
				mtime,
				bucket: "blocked",
				unseen: true,
				unseenError: true,
				erroredAt: mtime,
				failedAt: mtime,
			},
			recentSession("sess-2", "Write release notes"),
		]);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const card = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);

		expect(
			menuItems(card)
				.map(([label]) => label)
				.slice(-2),
		).toStrictEqual(["Mark as read7", "Mark as completed8"]);
	});

	it("archives the session from the card", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "6",
				code: "Digit6",
			},
		);

		await waitFor(() =>
		{
			expect(fetchMock).toHaveBeenCalled();
		});
		expect(fetchMock.mock.calls.at(-1)).toStrictEqual([
			"/api/sessions/sess-1/archived",
			expect.objectContaining(
				{
					method: "PUT",
				},
			),
		]);
	});

	it("pins the session in this browser from the card", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "4",
				code: "Digit4",
			},
		);

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

	it("Rename opens upstream's Rename session dialog over the palette", async () =>
	{
		const {dialog: palette, card} = await openCard();

		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Rename/,
				},
			),
		);

		const rename = await screen.findByRole(
			"dialog",
			{
				name: "Rename session",
			},
		);
		const field = within(rename).getByRole(
			"textbox",
			{
				name: "Rename session",
			},
		);
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(field);
		});
		expect(
			{
				card: screen.queryByRole(
					"menu",
					{
						name: "Actions",
					},
				),
				paletteOpen: palette.isConnected && palette.hasAttribute("data-open"),
				paletteOwned: rename.hasAttribute("data-palette-owned"),
				value: (field as HTMLInputElement).value,
				testId: field.getAttribute("data-testid"),
				buttons: within(rename)
					.getAllByRole("button")
					.map((button) => [button.textContent, (button as HTMLButtonElement).disabled]),
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
				inlineRenames: renameRequests,
			},
		).toStrictEqual(
			{
				card: null,
				paletteOpen: true,
				paletteOwned: true,
				value: "Refactor auth module",
				testId: "name-session",
				buttons: [
					["Cancel", false],
					["Save", false],
				],
				location: "/",
				inlineRenames: [],
			},
		);
	});

	it("disables Save while the rename field is blank", async () =>
	{
		const {card} = await openCard();
		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Rename/,
				},
			),
		);
		const rename = await screen.findByRole(
			"dialog",
			{
				name: "Rename session",
			},
		);

		fireEvent.change(
			within(rename).getByRole(
				"textbox",
				{
					name: "Rename session",
				},
			),
			{
				target:
				{
					value: "   ",
				},
			},
		);

		expect(
			within(rename).getByRole<HTMLButtonElement>(
				"button",
				{
					name: "Save",
				},
			).disabled,
		).toBe(true);
	});

	it("Save renames the session and keeps the palette open", async () =>
	{
		const {dialog: palette, card} = await openCard();
		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Rename/,
				},
			),
		);
		const rename = await screen.findByRole(
			"dialog",
			{
				name: "Rename session",
			},
		);

		fireEvent.change(
			within(rename).getByRole(
				"textbox",
				{
					name: "Rename session",
				},
			),
			{
				target:
				{
					value: "  Auth rewrite  ",
				},
			},
		);
		fireEvent.click(
			within(rename).getByRole(
				"button",
				{
					name: "Save",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"dialog",
					{
						name: "Rename session",
					},
				),
			).toBeNull();
		});
		expect(
			{
				request: fetchMock.mock.calls.at(-1),
				paletteOpen: palette.isConnected,
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
			},
		).toStrictEqual(
			{
				request: [
					"/api/sessions/sess-1/title",
					{
						method: "PUT",
						headers:
						{
							"Content-Type": "application/json",
						},
						body: JSON.stringify(
							{
								title: "Auth rewrite",
							},
						),
						credentials: "same-origin",
					},
				],
				paletteOpen: true,
				location: "/",
			},
		);
	});

	it("Save with the name unchanged closes the dialog without renaming", async () =>
	{
		const {card} = await openCard();
		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Rename/,
				},
			),
		);
		const rename = await screen.findByRole(
			"dialog",
			{
				name: "Rename session",
			},
		);

		fireEvent.click(
			within(rename).getByRole(
				"button",
				{
					name: "Save",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"dialog",
					{
						name: "Rename session",
					},
				),
			).toBeNull();
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("Cancel closes only the rename dialog", async () =>
	{
		const {dialog: palette, card} = await openCard();
		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Rename/,
				},
			),
		);
		const rename = await screen.findByRole(
			"dialog",
			{
				name: "Rename session",
			},
		);

		fireEvent.click(
			within(rename).getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"dialog",
					{
						name: "Rename session",
					},
				),
			).toBeNull();
		});
		expect(
			{
				paletteOpen: palette.isConnected,
				fetched: fetchMock.mock.calls.length,
			},
		).toStrictEqual(
			{
				paletteOpen: true,
				fetched: 0,
			},
		);
	});

	it("Escape closes only the rename dialog and returns focus to the Search input", async () =>
	{
		const {dialog: palette, input, card} = await openCard();
		fireEvent.click(
			within(card).getByRole(
				"menuitem",
				{
					name: /^Rename/,
				},
			),
		);
		const rename = await screen.findByRole(
			"dialog",
			{
				name: "Rename session",
			},
		);

		fireEvent.keyDown(
			within(rename).getByRole(
				"textbox",
				{
					name: "Rename session",
				},
			),
			{
				key: "Escape",
				code: "Escape",
			},
		);

		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"dialog",
					{
						name: "Rename session",
					},
				),
			).toBeNull();
		});
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(input);
		});
		expect(palette.isConnected).toBe(true);
	});

	it("shows the Actions tooltip on the row's hover … button", async () =>
	{
		const {dialog} = await openPalette();

		const button = dialog.querySelector<HTMLElement>("[data-palette-row-actions-button]");
		fireEvent.pointerEnter(button!);

		expect(
			(
				await screen.findByRole(
					"tooltip",
					{
						hidden: true,
					},
				)
			).textContent,
		).toBe("Actions");
	});

	it("opens in a new tab with 2", async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "2",
				code: "Digit2",
			},
		);

		expect(open.mock.calls).toStrictEqual([
			["http://localhost:3000/session/sess-1", "_blank", "noopener,noreferrer"],
		]);
	});

	it("opens the session with 1 and closes the palette", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "1",
				code: "Digit1",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(
			screen.getByRole(
				"status",
				{
					name: "Location",
				},
			).textContent,
		).toBe("/session/sess-1");
	});

	it("← closes the card and returns focus to the row", async () =>
	{
		const {card, input, dialog} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "ArrowLeft",
				code: "ArrowLeft",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			{
				focused: document.activeElement === input,
				selected: within(dialog)
					.getAllByRole(
						"option",
						{
							selected: true,
						},
					)
					.map((option) => option.textContent),
			},
		).toStrictEqual(
			{
				focused: true,
				selected: ["Refactor auth module"],
			},
		);
	});

	it("Esc closes the card first, then the palette", async () =>
	{
		const {card, input, dialog} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			screen.getByRole(
				"dialog",
				{
					name: "Search",
				},
			),
		).toBe(dialog);
		expect(document.activeElement).toBe(input);

		fireEvent.keyDown(
			input,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("⌥⏎ inside the card closes it and returns focus to the Search input", async () =>
	{
		const {card, input} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});

	it("AltGraph+Enter opens the card, and Ctrl doesn't block it", async () =>
	{
		const {input} = await openPalette();

		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				ctrlKey: true,
				modifierAltGraph: true,
			},
		);

		expect(
			await screen.findByRole(
				"menu",
				{
					name: "Actions",
				},
			),
		).toBeTruthy();
	});

	it("held-Enter repeats on the input after ⌥⏎ don't run the selected row", async () =>
	{
		const {input} = await openPalette();

		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
				repeat: true,
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				repeat: true,
			},
		);

		expect(
			{
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
				card:
					screen.queryByRole(
						"menu",
						{
							name: "Actions",
						},
					) !== null,
			},
		).toStrictEqual(
			{
				location: "/",
				card: true,
			},
		);
	});

	it("a repeated Enter inside the card closes it without running the item", async () =>
	{
		const {card} = await openCard();
		const [open] = within(card).getAllByRole("menuitem");
		open!.focus();

		fireEvent.keyDown(
			open!,
			{
				key: "Enter",
				code: "Enter",
				repeat: true,
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			{
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
				palette:
					screen.queryByRole(
						"dialog",
						{
							name: "Search",
						},
					) !== null,
			},
		).toStrictEqual(
			{
				location: "/",
				palette: true,
			},
		);
	});

	it("Tab closes the card", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "Tab",
				code: "Tab",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			screen.queryByRole(
				"dialog",
				{
					name: "Search",
				},
			),
		).not.toBeNull();
	});

	it("a repeated digit does nothing", async () =>
	{
		const {card} = await openCard();

		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
				repeat: true,
			},
		);

		expect(
			{
				copied: writeText.mock.calls,
				card:
					screen.queryByRole(
						"menu",
						{
							name: "Actions",
						},
					) !== null,
			},
		).toStrictEqual(
			{
				copied: [],
				card: true,
			},
		);
	});

	it("ignores digits for 300ms after the item list changes", async () =>
	{
		let now = 1000;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		const {card} = await openCard();

		now = 2000;
		act(() =>
		{
			pin("sess-1");
		});
		await within(card).findByRole(
			"menuitem",
			{
				name: /^Unpin/,
			},
		);
		now = 2299;
		fireEvent.keyDown(
			card,
			{
				key: "4",
				code: "Digit4",
			},
		);
		const guarded = readPinState();
		now = 2300;
		fireEvent.keyDown(
			card,
			{
				key: "4",
				code: "Digit4",
			},
		);

		await waitFor(() =>
		{
			expect(
				{
					guarded,
					after: readPinState(),
				},
			).toStrictEqual(
				{
					guarded:
					{
						pinnedIds: ["sess-1"],
						pinnedOrder: [],
					},
					after:
					{
						pinnedIds: [],
						pinnedOrder: [],
					},
				},
			);
		});
	});

	it("renders as a 280px cds Menu beside the palette, overlapping it by upstream's 44px", async () =>
	{
		const {card} = await openCard();

		const positioner = card.parentElement!;
		expect(
			{
				width: card.classList.contains("w-[280px]"),
				side: card.getAttribute("data-side"),
				sideOffset: positioner.getAttribute("data-side-offset"),
				density: positioner.getAttribute("data-density"),
				itemClasses: within(card)
					.getAllByRole("menuitem")
					.map((item) => item.classList.contains("h-6") && item.classList.contains("text-body")),
			},
		).toStrictEqual(
			{
				width: true,
				side: "right",
				sideOffset: "-44",
				density: "compact",
				itemClasses: [true, true, true, true, true, true, true],
			},
		);
	});

	it("recedes the palette from its top over 200ms like upstream, and not under reduced motion", async () =>
	{
		const motion = [
			"origin-top",
			"transition-[scale]",
			"duration-200",
			"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
			"motion-reduce:transition-none",
			"scale-[.97]",
			"motion-reduce:scale-100",
		];
		const veilMotion = [
			"bg-surface-0",
			"after:absolute",
			"after:inset-0",
			"after:rounded-[inherit]",
			"after:bg-backdrop",
			"transition-opacity",
			"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
			"opacity-0",
			"duration-[120ms]",
			"opacity-20",
			"duration-200",
		];
		const read = () =>
		{
			const veil = document.querySelector<HTMLElement>("[data-palette-recede-veil]")!;
			return {
				recedeCard: veil.parentElement!.hasAttribute("data-palette-recede-card"),
				dialog: motion.filter((name) => veil.parentElement!.classList.contains(name)),
				veil: veilMotion.filter((name) => veil.classList.contains(name)),
			};
		};

		const {input} = await openPalette();
		const closed = read();
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const card = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);

		expect(
			{
				closed,
				open: read(),
				card:
				{
					animation: card.classList.contains("animate-palette-card-in"),
					reduced: card.classList.contains("motion-reduce:animate-none"),
					slide: card.style.getPropertyValue("--cp-card-slide"),
				},
			},
		).toStrictEqual(
			{
				closed:
				{
					recedeCard: true,
					dialog: [
						"origin-top",
						"transition-[scale]",
						"duration-200",
						"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
						"motion-reduce:transition-none",
						"motion-reduce:scale-100",
					],
					veil: [
						"bg-surface-0",
						"after:absolute",
						"after:inset-0",
						"after:rounded-[inherit]",
						"after:bg-backdrop",
						"transition-opacity",
						"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
						"opacity-0",
						"duration-[120ms]",
					],
				},
				open:
				{
					recedeCard: true,
					dialog: motion,
					veil: [
						"bg-surface-0",
						"after:absolute",
						"after:inset-0",
						"after:rounded-[inherit]",
						"after:bg-backdrop",
						"transition-opacity",
						"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
						"opacity-20",
						"duration-200",
					],
				},
				card:
				{
					animation: true,
					reduced: true,
					slide: "-12px",
				},
			},
		);
	});

	it("defines upstream's palette-card-in keyframes and 200ms ease-out animation", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		expect(
			{
				animation: /--animate-palette-card-in: [^;]*;/.exec(styles)?.[0],
				keyframes: /@keyframes palette-card-in\s*\{[^}]*\}\n\}/.exec(styles)?.[0],
			},
		).toStrictEqual(
			{
				animation: "--animate-palette-card-in: palette-card-in 200ms cubic-bezier(0.165, 0.84, 0.44, 1);",
				keyframes:
					"@keyframes palette-card-in\n{\n\t0%\n\t{\n\t\topacity: 0;\n\t\ttransform: translateX(var(--cp-card-slide));\n\t}\n}",
			},
		);
	});

	it("defines upstream's thumb card and morph animations, keyframes and placeholder reveal", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const animation = (name: string) => new RegExp(`--animate-${name}: [^;]*;`).exec(styles)?.[0];
		const keyframes = (name: string) =>
			new RegExp(`@keyframes ${name}\\n\\{(?:\\n\\t[^\\n]*)*\\n\\}`).exec(styles)?.[0];
		expect(
			{
				morph: animation("palette-card-morph"),
				titleIn: animation("palette-card-title-in"),
				unfold: animation("palette-card-unfold"),
				thumbReturn: animation("palette-thumb-return"),
				placeholderReveal: animation("placeholder-reveal"),
				morphKeyframes: keyframes("palette-card-morph"),
				unfoldKeyframes: keyframes("palette-card-unfold"),
				thumbReturnKeyframes: keyframes("palette-thumb-return"),
				fadeInKeyframes: keyframes("fade-in"),
			},
		).toStrictEqual(
			{
				morph: "--animate-palette-card-morph: palette-card-morph 200ms cubic-bezier(0.165, 0.84, 0.44, 1);",
				titleIn: "--animate-palette-card-title-in: fade-in 200ms cubic-bezier(0.165, 0.84, 0.44, 1);",
				unfold: "--animate-palette-card-unfold: palette-card-unfold 200ms cubic-bezier(0.165, 0.84, 0.44, 1);",
				thumbReturn:
					"--animate-palette-thumb-return: palette-thumb-return 120ms cubic-bezier(0.165, 0.84, 0.44, 1);",
				placeholderReveal:
					"--animate-placeholder-reveal: fade-in 150ms ease-out var(--placeholder-reveal-delay, 0.5s) backwards;",
				morphKeyframes:
					"@keyframes palette-card-morph\n{\n\t0%\n\t{\n\t\ttransform: translate(var(--cp-card-from-x), var(--cp-card-from-y));\n\t}\n}",
				unfoldKeyframes:
					"@keyframes palette-card-unfold\n{\n\t0%\n\t{\n\t\tgrid-template-rows: 0fr;\n\t}\n\tto\n\t{\n\t\tgrid-template-rows: 1fr;\n\t}\n}",
				thumbReturnKeyframes:
					"@keyframes palette-thumb-return\n{\n\t0%\n\t{\n\t\ttransform: translate(var(--cp-thumb-from-x), var(--cp-thumb-from-y));\n\t}\n}",
				fadeInKeyframes:
					"@keyframes fade-in\n{\n\tfrom\n\t{\n\t\topacity: 0;\n\t}\n\tto\n\t{\n\t\topacity: 1;\n\t}\n}",
			},
		);
	});

	it("freezes the palette selection while the card is open", async () =>
	{
		const {dialog} = await openCard();

		const other = dialog.querySelector<HTMLElement>('[cmdk-item][data-value="session:sess-2"]')!;
		fireEvent.pointerMove(other);

		expect(
			[...dialog.querySelectorAll<HTMLElement>('[cmdk-item][data-selected="true"]')].map(
				(item) => item.dataset["value"],
			),
		).toStrictEqual(["session:sess-1"]);
	});

	it("a click on the palette while the card is open closes the card without opening the row", async () =>
	{
		const {dialog} = await openCard();

		const other = dialog.querySelector<HTMLElement>('[cmdk-item][data-value="session:sess-2"]')!;
		fireEvent.pointerDown(other);
		fireEvent.mouseDown(other);
		fireEvent.click(other);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			{
				// The modal palette hides the rest of the page from AT, so read the output directly.
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
				palette:
					screen.queryByRole(
						"dialog",
						{
							name: "Search",
						},
					) === dialog,
			},
		).toStrictEqual(
			{
				location: "/",
				palette: true,
			},
		);
	});

	it("closes the card when its row leaves the list", async () =>
	{
		const {dialog, input} = await openCard();

		fireEvent.change(
			input,
			{
				target:
				{
					value: "release",
				},
			},
		);

		await waitFor(() =>
		{
			expect(dialog.querySelector('[cmdk-item][data-value="session:sess-1"]')).toBeNull();
		});
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});

	function artifact(id: string, title: string, overrides: Partial<ArtifactSummary> = {}): ArtifactSummary
	{
		return {
			url: `https://claude.ai/artifact/${id}`,
			id,
			kind: "html",
			icon: null,
			title,
			description: null,
			sourcePath: null,
			sourceExists: false,
			sourceModifiedAt: null,
			thumbnailUrl: null,
			audience: null,
			firstSeenAt: Date.now(),
			lastPublishedAt: Date.now(),
			lastOpenedAt: null,
			publishCount: 1,
			sessionId: "sess-1",
			projectId: "-users-dev-project-a",
			...overrides,
		};
	}

	function project(id: string, name: string)
	{
		return {
			id,
			name,
			projectPath: null,
			sessionCount: 1,
			memoryCount: 0,
			planCount: 0,
			taskCount: 0,
			activeCount: 0,
			lastActivity: new Date().toISOString(),
		};
	}

	type CardTab = "Artifacts" | "Projects" | "Scheduled" | "Plans" | "Memories";

	async function openTab(tab: CardTab, seed: (queryClient: QueryClient) => void)
	{
		const opened = await openPalette(undefined, seed);
		fireEvent.click(
			within(opened.dialog).getByRole(
				"tab",
				{
					name: tab,
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				opened.dialog
					.querySelector("[cmdk-item][data-selected=true]")
					?.getAttribute("data-value")
					?.startsWith("session:"),
			).toBe(false);
		});
		return opened;
	}

	async function openTabCard(tab: CardTab, seed: (queryClient: QueryClient) => void)
	{
		const opened = await openTab(tab, seed);
		fireEvent.keyDown(
			opened.input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const card = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);
		return {
			...opened,
			card,
		};
	}

	function seedArtifacts(...artifacts: ArtifactSummary[])
	{
		return (queryClient: QueryClient) =>
		{
			queryClient.setQueryData(artifactsQueryOptions.queryKey, artifacts);
		};
	}

	function seedProjects(...projects: ReturnType<typeof project>[])
	{
		return (queryClient: QueryClient) =>
		{
			queryClient.setQueryData(projectsQueryOptions().queryKey, projects);
		};
	}

	function cardSummary(card: HTMLElement)
	{
		return {
			heading: card.querySelector("[data-palette-card-title]")?.textContent,
			meta: card.querySelector("[data-palette-card-meta]")?.textContent ?? null,
			items: menuItems(card),
			ids: [...card.querySelectorAll("[data-card-item]")].map((item) => item.getAttribute("data-card-item")),
		};
	}

	function selectedRowAffordances(dialog: HTMLElement)
	{
		const row = dialog.querySelector<HTMLElement>("[cmdk-item][data-selected=true]");
		return {
			value: row?.getAttribute("data-value"),
			keyShortcuts: row?.getAttribute("aria-keyshortcuts") ?? null,
			labelClass: row?.firstElementChild?.className,
			button: row?.parentElement?.querySelector("[data-palette-row-actions-button]") !== null,
			footer: [...dialog.querySelectorAll("[data-palette-footer-hint]")].map(
				(hint) => hint.querySelector("span")?.textContent,
			),
		};
	}

	it("gives a selected artifact row the session row's ⌥⏎ affordances", async () =>
	{
		const {dialog} = await openTab("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		expect(selectedRowAffordances(dialog)).toStrictEqual(
			{
				value: "artifact:art-1",
				keyShortcuts: "Alt+Enter",
				labelClass: "flex min-w-0 flex-1 items-center gap-2 me-7 pointer-coarse:me-0",
				button: true,
				footer: ["Close", "Change type", "Filters", "Actions"],
			},
		);
	});

	it("gives a selected project row the session row's ⌥⏎ affordances", async () =>
	{
		const {dialog} = await openTab("Projects", seedProjects(project("-Users-x-proj", "proj")));

		expect(selectedRowAffordances(dialog)).toStrictEqual(
			{
				value: "project:-Users-x-proj",
				keyShortcuts: "Alt+Enter",
				labelClass: "flex min-w-0 flex-1 items-center gap-2 me-7 pointer-coarse:me-0",
				button: true,
				footer: ["Close", "Change type", "Filters", "Actions"],
			},
		);
	});

	function routine(overrides: Partial<Routine> = {}): Routine
	{
		return {
			toolUseId: "r-1",
			recordUuid: null,
			kind: "cron",
			routineId: null,
			name: "Nightly digest",
			schedule: "0 9 * * *",
			humanSchedule: "Every day at 9:00 AM",
			delaySeconds: null,
			runOnceAt: null,
			recurring: true,
			durable: true,
			prompt: "Check the build",
			createdAt: 0,
			deletedAt: null,
			sessionId: "sess-1",
			projectId: "-users-dev-project-a",
			sessionTitle: null,
			status: "active",
			nextRunAt: Date.now() + 3_600_000,
			...overrides,
		};
	}

	function seedRoutines(...routines: Routine[])
	{
		return (queryClient: QueryClient) =>
		{
			queryClient.setQueryData(routinesQueryOptions.queryKey, routines);
		};
	}

	it("gives a selected routine row the session row's ⌥⏎ affordances, as upstream's web scheduled_task rows", async () =>
	{
		const {dialog} = await openTab("Scheduled", seedRoutines(routine()));

		expect(selectedRowAffordances(dialog)).toStrictEqual(
			{
				value: "routine:r-1",
				keyShortcuts: "Alt+Enter",
				labelClass: "flex min-w-0 flex-1 items-center gap-2 me-7 pointer-coarse:me-0",
				button: true,
				footer: ["Close", "Change type", "Filters", "Actions"],
			},
		);
	});

	it('⌥⏎ on a routine row opens upstream\'s generic card, its meta just "Scheduled task" without the next run', async () =>
	{
		const {card} = await openTabCard("Scheduled", seedRoutines(routine()));

		expect(cardSummary(card)).toStrictEqual(
			{
				heading: "Nightly digest",
				meta: "Scheduled task",
				items: [
					["Open1", "1"],
					["Open in new tab2", "2"],
				],
				ids: ["open", "open-new-tab"],
			},
		);
	});

	it("opens the routine's source record in a new tab with 2, and a 3 does nothing", async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const {card, input} = await openTabCard(
			"Scheduled",
			seedRoutines(
				routine(
					{
						recordUuid: "rec-1",
					},
				),
			),
		);

		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
			},
		);
		const afterThree =
		{
			calls: open.mock.calls.length,
			card: screen.queryByRole("menu") !== null,
		};
		fireEvent.keyDown(
			card,
			{
				key: "2",
				code: "Digit2",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});

		expect(
			{
				afterThree,
				calls: open.mock.calls,
				focused: document.activeElement === input,
			},
		).toStrictEqual(
			{
				afterThree:
				{
					calls: 0,
					card: true,
				},
				calls: [["http://localhost:3000/session/sess-1/source/rec-1", "_blank", "noopener,noreferrer"]],
				focused: true,
			},
		);
	});

	it("opens the routine's session with 1 and closes the palette", async () =>
	{
		const {card} = await openTabCard("Scheduled", seedRoutines(routine()));

		fireEvent.keyDown(
			card,
			{
				key: "1",
				code: "Digit1",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(
			screen.getByRole(
				"status",
				{
					name: "Location",
				},
			).textContent,
		).toBe("/session/sess-1");
	});

	it("← and a held Enter close a routine card with focus back on the Search input", async () =>
	{
		const {card, input} = await openTabCard("Scheduled", seedRoutines(routine()));

		fireEvent.keyDown(
			card,
			{
				key: "ArrowLeft",
				code: "ArrowLeft",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const afterLeft = document.activeElement === input;
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const reopened = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);
		fireEvent.keyDown(
			reopened,
			{
				key: "Enter",
				code: "Enter",
				repeat: true,
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});

		expect(
			{
				afterLeft,
				focused: document.activeElement === input,
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
			},
		).toStrictEqual(
			{
				afterLeft: true,
				focused: true,
				location: "/",
			},
		);
	});

	it("closes the routine card when its row leaves the list", async () =>
	{
		const {dialog, input} = await openTabCard(
			"Scheduled",
			seedRoutines(
				routine(),
				routine(
					{
						toolUseId: "r-2",
						name: "Weekly report",
					},
				),
			),
		);

		fireEvent.change(
			input,
			{
				target:
				{
					value: "weekly",
				},
			},
		);

		await waitFor(() =>
		{
			expect(dialog.querySelector('[cmdk-item][data-value="routine:r-1"]')).toBeNull();
		});
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});

	it('⌥⏎ on a plan row opens the generic card under "Plan · <bucket>", opening /plan/<slug> in a new tab', async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const {card} = await openTabCard("Plans", (queryClient) =>
		{
			queryClient.setQueryData(plansQueryOptions().queryKey, [
				{
					filename: "cozy-plan.md",
					title: "Cozy plan",
					mtime: new Date(Date.now() - 30 * 60_000).toISOString(),
					projects: [],
				},
			]);
		});
		const summary = cardSummary(card);

		fireEvent.keyDown(
			card,
			{
				key: "2",
				code: "Digit2",
			},
		);

		expect(
			{
				summary,
				calls: open.mock.calls,
			},
		).toStrictEqual(
			{
				summary:
				{
					heading: "Cozy plan",
					meta: "Plan · Past hour",
					items: [
						["Open1", "1"],
						["Open in new tab2", "2"],
					],
					ids: ["open", "open-new-tab"],
				},
				calls: [["http://localhost:3000/plan/cozy-plan", "_blank", "noopener,noreferrer"]],
			},
		);
	});

	it('⌥⏎ on a memory row opens the generic card under "Memory · <bucket>"', async () =>
	{
		const {card} = await openTabCard("Memories", (queryClient) =>
		{
			queryClient.setQueryData(projectsQueryOptions().queryKey, [
				{
					...project("proj-a", "proj-a"),
					memoryCount: 1,
				},
			]);
			const memories: z.infer<typeof MemoryListResponse> =
			{
				project:
				{
					id: "proj-a",
					name: "proj-a",
					projectPath: null,
				},
				memories: [
					{
						filename: "notes.md",
						title: "Team notes",
						mtime: new Date().toISOString(),
						project: "proj-a",
					},
				],
			};
			queryClient.setQueryData(projectMemoriesQueryOptions("proj-a").queryKey, memories);
		});

		expect(
			{
				heading: cardSummary(card).heading,
				meta: cardSummary(card).meta,
			},
		).toStrictEqual(
			{
				heading: "Team notes",
				meta: "Memory · Just now",
			},
		);
	});

	it("⌥⏎ on an artifact row opens upstream's artifact card", async () =>
	{
		const {card} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		expect(cardSummary(card)).toStrictEqual(
			{
				heading: "Quarterly report",
				meta: "Artifact · Just now",
				items: [
					["Open1", "1"],
					["Open in new tab2", "2"],
					["Copy link3", "3"],
					["Pin4", "4"],
				],
				ids: ["open", "open-new-tab", "copy-link", "pin"],
			},
		);
	});

	it('labels a docs artifact "Docs" and an untitled one "Untitled artifact"', async () =>
	{
		const {card} = await openTabCard(
			"Artifacts",
			seedArtifacts(
				artifact(
					"art-1",
					"",
					{
						kind: "docs",
						lastPublishedAt: Date.now() - 30 * 60_000,
					},
				),
			),
		);

		expect(
			{
				heading: cardSummary(card).heading,
				meta: cardSummary(card).meta,
			},
		).toStrictEqual(
			{
				heading: "Untitled artifact",
				meta: "Docs · Past hour",
			},
		);
	});

	it("pins the artifact in this browser with 4, then offers Unpin", async () =>
	{
		const seed = seedArtifacts(artifact("art-1", "Quarterly report"));
		const {card, input} = await openTabCard("Artifacts", seed);

		fireEvent.keyDown(
			card,
			{
				key: "4",
				code: "Digit4",
			},
		);
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(input);
		});
		const afterPin =
		{
			stored: localStorage.getItem(ARTIFACT_PIN_STORAGE_KEY),
			focused: document.activeElement === input,
		};
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const reopened = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);

		expect(
			{
				afterPin,
				items: cardSummary(reopened).ids,
			},
		).toStrictEqual(
			{
				afterPin:
				{
					stored: '["https://claude.ai/artifact/art-1"]',
					focused: true,
				},
				items: ["open", "open-new-tab", "copy-link", "unpin"],
			},
		);
	});

	it("copies the artifact's claude.ai link with 3, toasts, and closes the card", async () =>
	{
		const {card, input} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
			},
		);

		await screen.findByText("Link copied to clipboard.");
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(input);
		});
		expect(
			{
				copied: writeText.mock.calls,
				card: screen.queryByRole("menu"),
				focused: document.activeElement === input,
			},
		).toStrictEqual(
			{
				copied: [["https://claude.ai/artifact/art-1"]],
				card: null,
				focused: true,
			},
		);
	});

	it("opens the artifact with 1 and closes the palette", async () =>
	{
		const {card} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		fireEvent.keyDown(
			card,
			{
				key: "1",
				code: "Digit1",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(
			screen.getByRole(
				"status",
				{
					name: "Location",
				},
			).textContent,
		).toBe("/artifact/art-1");
	});

	it("opens the artifact in a new tab with 2", async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const {card} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		fireEvent.keyDown(
			card,
			{
				key: "2",
				code: "Digit2",
			},
		);

		expect(
			{
				calls: open.mock.calls,
				card: screen.queryByRole("menu"),
			},
		).toStrictEqual(
			{
				calls: [["http://localhost:3000/artifact/art-1", "_blank", "noopener,noreferrer"]],
				card: null,
			},
		);
	});

	it("← closes an artifact card with focus back on the Search input", async () =>
	{
		const {card, input} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		fireEvent.keyDown(
			card,
			{
				key: "ArrowLeft",
				code: "ArrowLeft",
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});

	it("a held Enter closes an artifact card without running an item", async () =>
	{
		const {card} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

		fireEvent.keyDown(
			card,
			{
				key: "Enter",
				code: "Enter",
				repeat: true,
			},
		);

		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			{
				dialog: screen.queryByRole("dialog") !== null,
				location: document.querySelector('output[aria-label="Location"]')?.textContent,
			},
		).toStrictEqual(
			{
				dialog: true,
				location: "/",
			},
		);
	});

	it("closes the artifact card when its row leaves the list", async () =>
	{
		const {dialog, input} = await openTabCard(
			"Artifacts",
			seedArtifacts(artifact("art-1", "Quarterly report"), artifact("art-2", "Release deck")),
		);

		fireEvent.change(
			input,
			{
				target:
				{
					value: "deck",
				},
			},
		);

		await waitFor(() =>
		{
			expect(dialog.querySelector('[cmdk-item][data-value="artifact:art-1"]')).toBeNull();
		});
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});

	it('⌥⏎ on a project row opens upstream\'s project card, its meta just "Project"', async () =>
	{
		const {card} = await openTabCard("Projects", seedProjects(project("-Users-x-proj", "proj")));

		expect(cardSummary(card)).toStrictEqual(
			{
				heading: "proj",
				meta: "Project",
				items: [
					["Open1", "1"],
					["Open in new tab2", "2"],
					["Copy link3", "3"],
				],
				ids: ["open", "open-new-tab", "copy-link"],
			},
		);
	});

	it('titles a nameless project "Untitled project"', async () =>
	{
		const {card} = await openTabCard("Projects", seedProjects(project("-Users-x-proj", "")));

		expect(cardSummary(card).heading).toBe("Untitled project");
	});

	it("copies the project's local link with 3 and toasts", async () =>
	{
		const {card} = await openTabCard("Projects", seedProjects(project("-Users-x proj", "proj")));

		fireEvent.keyDown(
			card,
			{
				key: "3",
				code: "Digit3",
			},
		);

		await screen.findByText("Link copied to clipboard.");
		expect(
			{
				copied: writeText.mock.calls,
				card: screen.queryByRole("menu"),
			},
		).toStrictEqual(
			{
				copied: [["http://localhost:3000/project/-Users-x%20proj"]],
				card: null,
			},
		);
	});

	it("opens the project with 1, or in a new tab with 2", async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const {card, input} = await openTabCard("Projects", seedProjects(project("-Users-x-proj", "proj")));

		fireEvent.keyDown(
			card,
			{
				key: "2",
				code: "Digit2",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
				code: "Enter",
				altKey: true,
			},
		);
		const reopened = await screen.findByRole(
			"menu",
			{
				name: "Actions",
			},
		);
		fireEvent.keyDown(
			reopened,
			{
				key: "1",
				code: "Digit1",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		expect(
			{
				newTab: open.mock.calls,
				location: screen.getByRole(
					"status",
					{
						name: "Location",
					},
				).textContent,
			},
		).toStrictEqual(
			{
				newTab: [["http://localhost:3000/project/-Users-x-proj", "_blank", "noopener,noreferrer"]],
				location: "/project/-Users-x-proj",
			},
		);
	});

	describe("artifact thumb card", () =>
	{
		const DIALOG =
		{
			x: 300,
			y: 83,
			width: 672,
			height: 583,
		};
		const LIST =
		{
			x: 300,
			y: 160,
			width: 672,
			height: 400,
		};
		const ROW_HEIGHT = 36;
		const THUMB = "/api/artifacts/art-thumb/thumbnail?v=1";

		function rect({x, y, width, height}: {x: number; y: number; width: number; height: number})
		{
			return {
				x,
				y,
				width,
				height,
				top: y,
				left: x,
				right: x + width,
				bottom: y + height,
				toJSON: () => ({}),
			};
		}

		// Upstream's 1272×750 layout: the dialog, its results list, and rows stacked 36px apart from the list top.
		beforeEach(() =>
		{
			vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1272);
			vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(750);
			vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
			{
				if (this.getAttribute("role") === "dialog" || this.hasAttribute("data-palette-recede-card"))
					return rect(DIALOG);
				if (this.hasAttribute("cmdk-list")) return rect(LIST);
				if (this.hasAttribute("cmdk-item"))
				{
					const index = [...(this.closest("[cmdk-list]")?.querySelectorAll("[cmdk-item]") ?? [])].indexOf(
						this,
					);
					return rect(
						{
							x: LIST.x,
							y: LIST.y + index * ROW_HEIGHT,
							width: LIST.width,
							height: ROW_HEIGHT,
						},
					);
				}
				return rect(
					{
						x: 0,
						y: 0,
						width: 0,
						height: 0,
					},
				);
			});
		});

		afterEach(() =>
		{
			document.documentElement.removeAttribute("data-reduce-motion");
		});

		const seedThumbs = seedArtifacts(
			artifact(
				"art-thumb",
				"Blueprint Tag Comparison",
				{
					thumbnailUrl: THUMB,
				},
			),
			artifact(
				"art-docs",
				"Team docs",
				{
					kind: "docs",
					firstSeenAt: Date.now() - 1000,
					lastPublishedAt: Date.now() - 1000,
				},
			),
		);

		function thumbCard()
		{
			return document.querySelector<HTMLElement>('[data-testid="palette-thumb-card"]');
		}

		function loadThumb()
		{
			fireEvent.load(thumbCard()!.querySelector("img")!);
		}

		function arrow(input: HTMLElement, key: "ArrowDown" | "ArrowUp")
		{
			fireEvent.keyDown(
				input,
				{
					key,
					code: key,
				},
			);
		}

		function altEnter(input: HTMLElement)
		{
			fireEvent.keyDown(
				input,
				{
					key: "Enter",
					code: "Enter",
					altKey: true,
				},
			);
		}

		function morphOffset()
		{
			return cardFromThumbOffset(
				{
					dialog: DIALOG,
					list: LIST,
					row:
					{
						y: LIST.y,
						height: ROW_HEIGHT,
					},
					viewport:
					{
						width: 1272,
						height: 750,
					},
					cardHeight: 204,
					dir: "ltr",
					reducedMotion: false,
				},
			)!;
		}

		it("portals upstream's thumb card beside the palette for a selected artifact row with a screenshot", async () =>
		{
			const {dialog} = await openTab("Artifacts", seedThumbs);
			const card = thumbCard()!;
			const beforeLoad = card.className;
			loadThumb();

			expect(
				{
					slot: card.parentElement === dialog.firstElementChild,
					slotClass: card.parentElement?.className,
					hidden: card.getAttribute("aria-hidden"),
					beforeLoad,
					className: card.className,
					style: card.getAttribute("style"),
					image: card.querySelector("img")?.getAttribute("src"),
					meta: card.lastElementChild?.textContent,
					metaClass: card.lastElementChild?.className,
				},
			).toStrictEqual(
				{
					slot: true,
					slotClass: "pointer-events-none absolute top-0 left-full z-3",
					hidden: "true",
					beforeLoad:
						"pointer-events-auto absolute p-1.5 bg-[var(--menu-bg)] shadow-[var(--menu-shadow)] rounded-card forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] invisible",
					className:
						"pointer-events-auto absolute p-1.5 bg-[var(--menu-bg)] shadow-[var(--menu-shadow)] rounded-card forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText]",
					// x = min(972 + 12, 1272 - 16 - 280) = 976: 4px past the dialog; the row's y 160 is 77px below its top.
					style: "width: 280px; top: 77px; left: 4px;",
					image: THUMB,
					meta: "Artifact · Just now",
					metaClass: "truncate px-1 pt-1.5 pb-0.5 text-caption text-muted-as-secondary",
				},
			);
		});

		it("shows no thumb card for a docs row or in Compose", async () =>
		{
			const {input} = await openTab("Artifacts", seedThumbs);
			loadThumb();
			arrow(input, "ArrowDown");
			const onDocs = thumbCard();
			arrow(input, "ArrowUp");
			const back = thumbCard() !== null;
			fireEvent.keyDown(
				input,
				{
					key: "Tab",
					code: "Tab",
				},
			);
			await screen.findByRole(
				"combobox",
				{
					name: "Write a message…",
				},
			);
			const inCompose = thumbCard();

			expect(
				{
					onDocs,
					back,
					inCompose,
				},
			).toStrictEqual(
				{
					onDocs: null,
					back: true,
					inCompose: null,
				},
			);
		});

		it("shows no thumb card and no card screenshot for a phone-latched open (upstream Cs/Ts: !phone)", async () =>
		{
			vi.stubGlobal("matchMedia", (query: string) => (
			{
				matches: query === "(pointer: coarse), (hover: none)" || query === "(width < 40rem)",
				media: query,
				addEventListener()
				{
				},
				removeEventListener()
				{
				},
			}));
			const {input} = await openTab("Artifacts", seedThumbs);
			const selected = document.querySelector("[cmdk-item][data-selected=true]")?.getAttribute("data-value");
			const thumb = thumbCard();
			altEnter(input);
			const card = await screen.findByRole(
				"menu",
				{
					name: "Actions",
				},
			);

			expect(
				{
					selected,
					thumb,
					fromThumb: card.getAttribute("data-from-thumb-card"),
					header: card.querySelector('[data-testid="palette-thumb-image"]'),
				},
			).toStrictEqual(
				{
					selected: "artifact:art-thumb",
					thumb: null,
					fromThumb: null,
					header: null,
				},
			);
		});

		it("drops the card for good when its screenshot fails to load", async () =>
		{
			const failing = "/api/artifacts/art-fail/thumbnail?v=1";
			const {input} = await openTab(
				"Artifacts",
				seedArtifacts(
					artifact(
						"art-fail",
						"Broken shot",
						{
							thumbnailUrl: failing,
						},
					),
					artifact(
						"art-other",
						"Other",
						{
							firstSeenAt: Date.now() - 1000,
							lastPublishedAt: Date.now() - 1000,
						},
					),
				),
			);
			fireEvent.error(thumbCard()!.querySelector("img")!);
			const afterError = thumbCard();
			arrow(input, "ArrowDown");
			arrow(input, "ArrowUp");

			expect(
				{
					afterError,
					afterReturn: thumbCard(),
				},
			).toStrictEqual(
				{
					afterError: null,
					afterReturn: null,
				},
			);
		});

		it("keeps the palette input focused on a press and scrolls the results on a wheel", async () =>
		{
			const {dialog, input} = await openTab("Artifacts", seedThumbs);
			loadThumb();
			const list = dialog.querySelector<HTMLElement>("[cmdk-list]")!;
			const scrollBy = vi.fn<(options: ScrollToOptions) => void>();
			list.scrollBy = scrollBy as HTMLElement["scrollBy"];
			input.focus();

			const pressed = fireEvent.mouseDown(thumbCard()!);
			fireEvent.wheel(
				thumbCard()!,
				{
					deltaX: 3,
					deltaY: 40,
				},
			);

			expect(
				{
					pressed,
					focused: document.activeElement === input,
					scrolls: scrollBy.mock.calls,
				},
			).toStrictEqual(
				{
					pressed: false,
					focused: true,
					scrolls: [
						[
							{
								top: 40,
								left: 3,
							},
						],
					],
				},
			);
		});

		it("⌥⏎ morphs the shown thumb into the artifact card, and ← slides the thumb back out of it", async () =>
		{
			const {input} = await openTab("Artifacts", seedThumbs);
			loadThumb();
			altEnter(input);
			const card = await screen.findByRole(
				"menu",
				{
					name: "Actions",
				},
			);
			const offset = morphOffset();
			const opened =
			{
				thumbCard: thumbCard(),
				fromThumb: card.getAttribute("data-from-thumb-card"),
				morph: card.classList.contains("animate-palette-card-morph"),
				enter: card.classList.contains("animate-palette-card-in"),
				fromX: card.style.getPropertyValue("--cp-card-from-x"),
				fromY: card.style.getPropertyValue("--cp-card-from-y"),
				header: card.querySelector('[data-testid="palette-thumb-image"]')?.parentElement?.className,
				headerSrc: card.querySelector('[data-testid="palette-thumb-image"]')?.getAttribute("src"),
				titleIn: card.querySelector("[data-palette-card-title]")?.parentElement?.className,
				unfold: card.querySelector('[role="menuitem"]')?.parentElement?.parentElement?.className,
				clip: card.querySelector('[role="menuitem"]')?.parentElement?.className,
			};

			fireEvent.keyDown(
				card,
				{
					key: "ArrowLeft",
					code: "ArrowLeft",
				},
			);
			await waitFor(() =>
			{
				expect(screen.queryByRole("menu")).toBeNull();
			});
			const returned = thumbCard()!;

			expect(
				{
					opened,
					returned:
					{
						animation: returned.classList.contains("animate-palette-thumb-return"),
						fromX: returned.style.getPropertyValue("--cp-thumb-from-x"),
						fromY: returned.style.getPropertyValue("--cp-thumb-from-y"),
					},
				},
			).toStrictEqual(
				{
					opened:
					{
						thumbCard: null,
						fromThumb: "true",
						morph: true,
						enter: false,
						fromX: `${offset.x}px`,
						fromY: `${offset.y}px`,
						header: "-mx-[var(--cds-menu-gutter,0.25rem)] -mt-[var(--cds-menu-gutter,0.25rem)] px-1.5 pt-1.5 pb-1",
						headerSrc: THUMB,
						titleIn:
							"flex flex-col gap-0.5 px-2.5 pt-1 pb-1 animate-palette-card-title-in motion-reduce:animate-none",
						unfold: "grid animate-palette-card-unfold motion-reduce:animate-none",
						clip: "min-h-0 overflow-hidden",
					},
					returned:
					{
						animation: true,
						fromX: `${-offset.x}px`,
						fromY: `${-offset.y}px`,
					},
				},
			);
		});

		it("opens the plain card under reduced motion, still headed by the screenshot", async () =>
		{
			document.documentElement.setAttribute("data-reduce-motion", "true");
			const {input} = await openTab("Artifacts", seedThumbs);
			loadThumb();
			altEnter(input);
			const card = await screen.findByRole(
				"menu",
				{
					name: "Actions",
				},
			);

			expect(
				{
					fromThumb: card.getAttribute("data-from-thumb-card"),
					enter: card.classList.contains("animate-palette-card-in"),
					fromX: card.style.getPropertyValue("--cp-card-from-x"),
					header: card.querySelector('[data-testid="palette-thumb-image"]')?.getAttribute("src"),
					titleIn: card.querySelector("[data-palette-card-title]")?.parentElement?.className,
				},
			).toStrictEqual(
				{
					fromThumb: null,
					enter: true,
					fromX: "",
					header: THUMB,
					titleIn: "flex flex-col gap-0.5 px-2.5 pt-1 pb-1",
				},
			);
		});

		it("opens the plain card for an artifact row without a screenshot", async () =>
		{
			const {card} = await openTabCard("Artifacts", seedArtifacts(artifact("art-1", "Quarterly report")));

			expect(
				{
					fromThumb: card.getAttribute("data-from-thumb-card"),
					enter: card.classList.contains("animate-palette-card-in"),
					header: card.querySelector('[data-testid="palette-thumb-image"]'),
				},
			).toStrictEqual(
				{
					fromThumb: null,
					enter: true,
					header: null,
				},
			);
		});
	});
});

describe("rowActionsAnchorRect", () =>
{
	const list =
	{
		x: 100,
		y: 200,
		width: 600,
		height: 400,
	};
	const dialog =
	{
		x: 100,
		y: 150,
		width: 600,
		height: 500,
	};

	it("takes the list's x and width at the row's y, scaled .97 about the dialog centre, then lifted 4px", () =>
	{
		const rect = rowActionsAnchorRect(
			{
				list,
				row:
				{
					y: 300,
					height: 32,
				},
				dialog,
				reducedMotion: false,
			},
		);

		expect(rect).toStrictEqual(
			{
				x: 109,
				y: 299,
				width: 582,
				height: 31.04,
			},
		);
	});

	it("clamps the row into the list viewport", () =>
	{
		const above = rowActionsAnchorRect(
			{
				list,
				row:
				{
					y: 120,
					height: 32,
				},
				dialog,
				reducedMotion: true,
			},
		);
		const below = rowActionsAnchorRect(
			{
				list,
				row:
				{
					y: 900,
					height: 32,
				},
				dialog,
				reducedMotion: true,
			},
		);

		expect([above, below]).toStrictEqual([
			{
				x: 100,
				y: 196,
				width: 600,
				height: 32,
			},
			{
				x: 100,
				y: 564,
				width: 600,
				height: 32,
			},
		]);
	});
});
