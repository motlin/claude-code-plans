// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionActionsMenu} from "../src/components/session-actions-menu";
import {SessionTitleHeading} from "../src/components/session-title-heading";
import {SessionRowStatusDot} from "../src/components/session-unread-control";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import type {SessionListItem} from "../src/lib/api/sessions";
import type {SessionBucket} from "../src/lib/session-state";
import {__awaitingAckTesting, ackedAt} from "../src/lib/awaiting-ack-store";
import
{
	__unreadStoreTesting,
	hasUnseenWork,
	isExplicitUnread,
	syncUnseenFromSummaries,
	toggleUnseen,
} from "../src/lib/unread-store";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

function listItem(bucket: SessionBucket, overrides: Partial<SessionListItem> = {}): SessionListItem
{
	return {
		id: SESSION_ID,
		title: "Fix the flaky test",
		mtime: "2026-09-28T10:00:00.000Z",
		created: "2026-09-28T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "ended",
		bucket,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

const VIEWED_STATE =
{
	currentMessageIndex: 3,
	lastViewedMessageIndex: 3,
	reviewTargetMessageIndex: 3,
	newMessageCount: 0,
	viewedInCcp: true,
	viewedInHerdr: false,
	viewedAnywhere: true,
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function viewedCalls(): Array<
{
	url: string;
	method: string;
	body: unknown;
}>
{
	return fetchMock.mock.calls
		.filter(([input]) => input.endsWith("/viewed"))
		.map(([input, init]) => (
		{
			url: input,
			method: init?.method ?? "GET",
			body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
		}));
}

async function flush()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

async function renderWithProviders(content: ReactNode)
{
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
					staleTime: Infinity,
					gcTime: Infinity,
					refetchOnMount: false,
				},
				mutations:
				{
					retry: false,
				},
			},
		},
	);
	queryClient.setQueryData(
		herdrPanesQueryOptions.queryKey,
		{
			panes: [],
			writesEnabled: false,
		},
	);
	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>{content}</ToastProvider>
				</QueryClientProvider>
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
	await router.load();
	render(<RouterProvider router={router} />);
	await flush();
}

async function renderRow(session: SessionListItem)
{
	await renderWithProviders(
		<SessionActionsMenu session={session}>
			<a href={`/session/${session.id}`}>Row title</a>
		</SessionActionsMenu>,
	);
}

async function readStateItems(): Promise<string[]>
{
	fireEvent.contextMenu(
		screen.getByText("Row title"),
		{
			clientX: 40,
			clientY: 50,
		},
	);
	await flush();
	const menu = screen.getByRole("menu");
	return [...menu.querySelectorAll('[role="menuitem"]')]
		.map((node) => `${node.textContent} [${node.getAttribute("aria-keyshortcuts") ?? ""}]`)
		.filter((label) => label.startsWith("Mark as"));
}

async function selectItem(name: string)
{
	fireEvent.contextMenu(
		screen.getByText("Row title"),
		{
			clientX: 40,
			clientY: 50,
		},
	);
	await flush();
	fireEvent.click(
		screen.getByRole(
			"menuitem",
			{
				name: new RegExp(`^${name}`),
			},
		),
	);
	await flush();
}

function pressOptionCommandU()
{
	fireEvent.keyDown(
		document.body,
		{
			key: "¨",
			code: "KeyU",
			metaKey: true,
			altKey: true,
		},
	);
}

beforeEach(() =>
{
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockImplementation(async () => Promise.resolve(Response.json(VIEWED_STATE)));
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
	__unreadStoreTesting.reset();
	__awaitingAckTesting.reset();
});

afterEach(() =>
{
	cleanup();
	fetchMock.mockReset();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("read state in the row menu", () =>
{
	it("labels the item by the row's state", async () =>
	{
		await renderRow(listItem("done"));
		const read = await readStateItems();
		cleanup();

		syncUnseenFromSummaries([
			{
				id: SESSION_ID,
				unseen: true,
			},
		]);
		await renderRow(
			listItem(
				"review",
				{
					unseen: true,
				},
			),
		);
		const unread = await readStateItems();
		cleanup();

		await renderRow(
			listItem(
				"blocked",
				{
					state: "waiting",
				},
			),
		);
		const waiting = await readStateItems();

		expect(
			{
				read,
				unread,
				waiting,
			},
		).toStrictEqual(
			{
				read: ["Mark as unreadU [u]"],
				unread: ["Mark as readU [u]"],
				waiting: ["Mark as read []", "Mark as completedU [u]"],
			},
		);
	});

	it("keeps a working row's read toggle disabled with its u shortcut", async () =>
	{
		await renderRow(
			listItem(
				"working",
				{
					state: "working",
				},
			),
		);

		expect(await readStateItems()).toStrictEqual(["Mark as unreadU [u]"]);
	});

	it("round-trips unread and read through the viewed-state API", async () =>
	{
		await renderRow(listItem("done"));

		await selectItem("Mark as unread");
		const afterUnread = hasUnseenWork(SESSION_ID);
		const explicitAfterUnread = isExplicitUnread(SESSION_ID);
		await selectItem("Mark as read");

		expect(
			{
				afterUnread,
				explicitAfterUnread,
				afterRead: hasUnseenWork(SESSION_ID),
				explicitAfterRead: isExplicitUnread(SESSION_ID),
				calls: viewedCalls(),
			},
		).toStrictEqual(
			{
				afterUnread: true,
				explicitAfterUnread: true,
				afterRead: false,
				explicitAfterRead: false,
				calls: [
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "unreviewed",
						},
					},
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "reviewed",
						},
					},
				],
			},
		);
	});

	it("acknowledges a waiting row without answering it", async () =>
	{
		syncUnseenFromSummaries([
			{
				id: SESSION_ID,
				unseen: true,
			},
		]);
		// A hand mark first, so completing must clear the explicit bit too.
		toggleUnseen(SESSION_ID);
		toggleUnseen(SESSION_ID);
		await flush();
		const explicitBefore = isExplicitUnread(SESSION_ID);
		fetchMock.mockClear();
		await renderRow(
			listItem(
				"blocked",
				{
					state: "waiting",
					unseen: true,
					mtime: "2026-11-04T10:00:00.000Z",
				},
			),
		);

		await selectItem("Mark as completed");

		expect(
			{
				explicitBefore,
				unseen: hasUnseenWork(SESSION_ID),
				explicit: isExplicitUnread(SESSION_ID),
				ackedAt: ackedAt(SESSION_ID),
				calls: viewedCalls(),
			},
		).toStrictEqual(
			{
				explicitBefore: true,
				unseen: false,
				explicit: false,
				ackedAt: Date.parse("2026-11-04T10:00:00.000Z"),
				calls: [
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "reviewed",
						},
					},
				],
			},
		);
	});

	it("marks a finished row read without acking it", async () =>
	{
		syncUnseenFromSummaries([
			{
				id: SESSION_ID,
				unseen: true,
			},
		]);
		await renderRow(
			listItem(
				"done",
				{
					unseen: true,
				},
			),
		);

		await selectItem("Mark as read");

		expect(
			{
				unseen: hasUnseenWork(SESSION_ID),
				ackedAt: ackedAt(SESSION_ID),
			},
		).toStrictEqual(
			{
				unseen: false,
				ackedAt: undefined,
			},
		);
	});
});

describe("Mark as completed undo (SESSION_UNDO, __gb__3095207653)", () =>
{
	const OTHER_ID = "8f0c2c7e-1111-4222-8333-944445555777";

	function undoToast():
	{
		title: string;
		button: string;
		keyShortcuts: string | null;
	} | null
	{
		const card = document.querySelector("[data-toast]");
		if (card === null) return null;
		const button = card.querySelector("[data-cds=Button]");
		return {
			title: card.querySelector("[data-toast-message]")?.textContent ?? "",
			button: button?.querySelector("[data-toast-action-label]")?.textContent ?? "",
			keyShortcuts: button?.getAttribute("aria-keyshortcuts") ?? null,
		};
	}

	async function renderRows(sessions: SessionListItem[])
	{
		await renderWithProviders(
			<>
				{sessions.map((session) => (
					<SessionActionsMenu key={session.id} session={session}>
						<a href={`/session/${session.id}`}>{`Row ${session.id}`}</a>
					</SessionActionsMenu>
				))}
			</>,
		);
	}

	async function complete(id: string)
	{
		fireEvent.contextMenu(
			screen.getByText(`Row ${id}`),
			{
				clientX: 40,
				clientY: 50,
			},
		);
		await flush();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: /^Mark as completed/,
				},
			),
		);
		await flush();
	}

	function waitingRow(id: string): SessionListItem
	{
		return listItem(
			"blocked",
			{
				id,
				state: "waiting",
				unseen: true,
				mtime: "2026-11-04T10:00:00.000Z",
			},
		);
	}

	beforeEach(() =>
	{
		syncUnseenFromSummaries([
			{
				id: SESSION_ID,
				unseen: true,
			},
			{
				id: OTHER_ID,
				unseen: true,
			},
		]);
	});

	it("offers Undo, which marks the row unseen again and drops its ack", async () =>
	{
		await renderRows([waitingRow(SESSION_ID)]);
		await complete(SESSION_ID);
		const toast = undoToast();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Undo/,
				},
			),
		);
		await flush();

		expect(
			{
				toast,
				unseen: hasUnseenWork(SESSION_ID),
				ackedAt: ackedAt(SESSION_ID),
				after: undoToast(),
			},
		).toStrictEqual(
			{
				toast:
				{
					title: "Marked 1 session as completed",
					button: "Undo",
					keyShortcuts: "Meta+z",
				},
				unseen: true,
				ackedAt: undefined,
				after: null,
			},
		);
	});

	it("folds two completions into one toast that ⌘Z undoes together", async () =>
	{
		await renderRows([waitingRow(SESSION_ID), waitingRow(OTHER_ID)]);
		await complete(SESSION_ID);
		await complete(OTHER_ID);
		const toast = undoToast();

		fireEvent.keyDown(
			document.body,
			{
				key: "z",
				code: "KeyZ",
				metaKey: true,
			},
		);
		await flush();

		expect(
			{
				title: toast?.title,
				unseen: [hasUnseenWork(SESSION_ID), hasUnseenWork(OTHER_ID)],
				acked: [ackedAt(SESSION_ID), ackedAt(OTHER_ID)],
				after: undoToast(),
			},
		).toStrictEqual(
			{
				title: "Marked 2 sessions as completed",
				unseen: [true, true],
				acked: [undefined, undefined],
				after: null,
			},
		);
	});

	it("offers nothing for Mark as read", async () =>
	{
		await renderRows([
			listItem(
				"done",
				{
					unseen: true,
				},
			),
		]);
		fireEvent.contextMenu(
			screen.getByText(`Row ${SESSION_ID}`),
			{
				clientX: 40,
				clientY: 50,
			},
		);
		await flush();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: /^Mark as read/,
				},
			),
		);
		await flush();

		expect(undoToast()).toBeNull();
	});
});

describe("status dot toggle", () =>
{
	function dot():
	{
		label: string | null;
		title: string | null;
		kind: string | null;
	}
	{
		const button = screen.queryByRole("button");
		const glyph = button ?? screen.getByRole("img");
		return {
			label: button?.getAttribute("aria-label") ?? null,
			title: glyph.getAttribute("title"),
			kind: glyph.querySelector("[data-kind]")?.getAttribute("data-kind") ?? "idle",
		};
	}

	it("is a plain icon on a read row and marks an unread row read", async () =>
	{
		render(<SessionRowStatusDot session={listItem("done")} />);
		const before = dot();

		act(() =>
		{
			toggleUnseen(SESSION_ID);
		});
		await flush();
		const afterUnread = dot();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Click to mark as read",
				},
			),
		);
		await flush();

		expect(
			{
				before,
				afterUnread,
				afterRead: dot(),
				calls: viewedCalls(),
			},
		).toStrictEqual(
			{
				before:
				{
					label: null,
					title: null,
					kind: "idle",
				},
				afterUnread:
				{
					label: "Click to mark as read",
					title: null,
					kind: "ready",
				},
				afterRead:
				{
					label: null,
					title: null,
					kind: "idle",
				},
				calls: [
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "unreviewed",
						},
					},
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "reviewed",
						},
					},
				],
			},
		);
	});

	it.each([
		["working", "working", "running"],
		["blocked", "waiting", "awaiting"],
	] as const)("is a plain icon on a %s row", (bucket, state, kind) =>
	{
		const {container} = render(
			<SessionRowStatusDot
				session={listItem(
					bucket,
					{
						state,
					},
				)}
			/>,
		);

		expect(
			{
				button: screen.queryByRole("button"),
				kind: container.querySelector("[data-kind]")?.getAttribute("data-kind"),
			},
		).toStrictEqual(
			{
				button: null,
				kind,
			},
		);
	});
});

describe("⌥⌘U on the session page", () =>
{
	it("toggles the session between unread and read", async () =>
	{
		await renderWithProviders(
			<SessionTitleHeading sessionId={SESSION_ID} title="Fix the flaky test" archived={false} />,
		);

		pressOptionCommandU();
		await flush();
		const afterFirst = hasUnseenWork(SESSION_ID);
		const explicitAfterFirst = isExplicitUnread(SESSION_ID);
		pressOptionCommandU();
		await flush();

		expect(
			{
				afterFirst,
				explicitAfterFirst,
				afterSecond: hasUnseenWork(SESSION_ID),
				explicitAfterSecond: isExplicitUnread(SESSION_ID),
				calls: viewedCalls(),
			},
		).toStrictEqual(
			{
				afterFirst: true,
				explicitAfterFirst: true,
				afterSecond: false,
				explicitAfterSecond: false,
				calls: [
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "unreviewed",
						},
					},
					{
						url: `/api/sessions/${SESSION_ID}/viewed`,
						method: "PUT",
						body:
						{
							action: "reviewed",
						},
					},
				],
			},
		);
	});
});
