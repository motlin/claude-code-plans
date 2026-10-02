// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	HeadContent,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vite-plus/test";
import {invalidateSessionIdentities, sessionIdentityQueryOptions} from "../src/lib/api/session-identity";
import {sessionSourceQueryOptions} from "../src/lib/api/session-source";
import {routeToRecent} from "../src/lib/recents-history";
import {Route as SourceRoute} from "../src/routes/session.$id_.source.$uuid";

const ALIAS = "session_alice_100";
const ALICE = "local-alice-100";
const BOB = "local-bob-200";
const RECORD = "11111111-1111-1111-1111-111111111111";
const BEFORE = "22222222-2222-2222-2222-222222222222";
const AFTER = "33333333-3333-3333-3333-333333333333";
const SOURCE = {
	window: {
		before: [{raw: '{"type":"user"}', lineIndex: 0, uuid: BEFORE}],
		focal: {raw: JSON.stringify({type: "assistant", uuid: RECORD, parentUuid: BEFORE}), lineIndex: 1, uuid: RECORD},
		after: [{raw: '{"type":"user"}', lineIndex: 2, uuid: AFTER}],
	},
	parsedBlocksJson: "[]",
	parsedBlocksCount: 0,
	paired: {
		resultEntry: {raw: '{"type":"user"}', lineIndex: 2, uuid: AFTER},
		resultLineIndex: 2,
		toolUseId: "tool-example",
	},
	sessionTitle: "Alice session",
	knownUuids: [RECORD, BEFORE, AFTER],
	projectId: "example",
};
const clients: QueryClient[] = [];

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function setup({
	initial = `/session/${ALIAS}/source/${RECORD}`,
	cachedOwner,
	source = SOURCE,
	delaySource = false,
}: {initial?: string; cachedOwner?: string; source?: typeof SOURCE | null; delaySource?: boolean} = {}) {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	let finish!: (response: Response) => void;
	const pending = new Promise<Response>((resolve) => {
		finish = resolve;
	});
	let lookup = () => pending;
	let finishSource!: (response: Response) => void;
	const pendingSource = new Promise<Response>((resolve) => {
		finishSource = resolve;
	});
	const fetcher = vi.fn((url: string) =>
		url.endsWith("/identity") ? lookup() : delaySource ? pendingSource : Promise.resolve(Response.json(source)),
	);
	vi.stubGlobal("fetch", fetcher);
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	clients.push(client);
	if (cachedOwner) client.setQueryData(sessionIdentityQueryOptions(ALIAS).queryKey, {sessionId: cachedOwner});
	const root = createRootRouteWithContext<{queryClient: QueryClient}>()({
		component: () => (
			<>
				<HeadContent />
				<main data-testid="main">
					<Outlet />
				</main>
			</>
		),
	});
	SourceRoute.update({
		id: "/session/$id_/source/$uuid",
		path: "/session/$id/source/$uuid",
		getParentRoute: () => root,
	} as never);
	const session = createRoute({getParentRoute: () => root, path: "/session/$id", component: () => <p>Session</p>});
	const router = createRouter({
		routeTree: root.addChildren([SourceRoute, session]),
		context: {queryClient: client},
		history: createMemoryHistory({initialEntries: ["/session/local-charlie-300", initial], initialIndex: 1}),
		scrollRestoration: true,
	});
	await router.load();
	await act(async () => {
		render(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
	});
	return {
		client,
		router,
		fetcher,
		finish,
		finishSource,
		setLookup: (next: () => Promise<Response>) => {
			lookup = next;
		},
	};
}

it("resolves a delayed alias before fetching source and keeps record IDs in every source link", async () => {
	const {fetcher, finish, router} = await setup();
	const pending = {
		skeleton: screen.getByTestId("session-skeleton") !== null,
		urls: fetcher.mock.calls.map(([url]) => url),
	};
	await act(async () => finish(Response.json({sessionId: ALICE})));
	await screen.findByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`});
	expect({
		pending,
		urls: fetcher.mock.calls.map(([url]) => url),
		title: document.title,
		links: screen.getAllByRole("link").map((link) => link.getAttribute("href")),
		recent: routeToRecent(router.state.location.pathname),
	}).toStrictEqual({
		pending: {skeleton: true, urls: [`/api/sessions/${ALIAS}/identity`]},
		urls: [`/api/sessions/${ALIAS}/identity`, `/api/sessions/${ALICE}/source/${RECORD}?context=5`],
		title: "Source: 11111111",
		links: [
			`/session/${ALICE}`,
			`/session/${ALICE}/source/${RECORD}`,
			`/session/${ALICE}/source/${BEFORE}`,
			`/session/${ALICE}/source/${AFTER}`,
			`/session/${ALICE}/source/${BEFORE}`,
			`/session/${ALICE}/source/${AFTER}`,
		],
		recent: null,
	});
});

it("opens UUID source routes without an identity request", async () => {
	const {fetcher} = await setup({initial: `/session/${ALICE}/source/${RECORD}`});
	await screen.findByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`});
	expect({urls: fetcher.mock.calls.map(([url]) => url), title: document.title}).toStrictEqual({
		urls: [`/api/sessions/${ALICE}/source/${RECORD}?context=5`],
		title: "Source: 11111111",
	});
});

it("paints the source loading state before UUID source data arrives", async () => {
	const {fetcher, finishSource} = await setup({initial: `/session/${ALICE}/source/${RECORD}`, delaySource: true});
	expect({
		loading: screen.getByRole("status").textContent,
		title: document.title,
		urls: fetcher.mock.calls.map(([url]) => url),
	}).toStrictEqual({
		loading: "Loading source…",
		title: "Source: 11111111",
		urls: [`/api/sessions/${ALICE}/source/${RECORD}?context=5`],
	});
	await act(async () => finishSource(Response.json(SOURCE)));
	await screen.findByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`});
	expect(screen.queryByRole("status")).toBeNull();
});

it.each([404, 409])(
	"shows the shared %s failure title without a source request and restores the source title after retry",
	async (status) => {
		const {finish, setLookup, fetcher} = await setup();
		await act(async () => finish(new Response(null, {status})));
		const title = status === 404 ? "Session Not Found" : "Ambiguous session link";
		await waitFor(() => expect(document.title).toBe(title));
		const failure = {message: screen.getByRole("alert").textContent, urls: fetcher.mock.calls.map(([url]) => url)};
		setLookup(async () => Response.json({sessionId: ALICE}));
		fireEvent.click(screen.getByRole("button", {name: "Retry"}));
		await screen.findByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`});
		await waitFor(() => expect(document.title).toBe("Source: 11111111"));
		expect(failure).toStrictEqual({
			message: status === 404 ? "Session Not Found" : "This session link has more than one local session.",
			urls: [`/api/sessions/${ALIAS}/identity`],
		});
	},
);

it.each(["ambiguous", "reassigned"])(
	"preserves record suffix, owner, history and scroll when a source alias becomes %s",
	async (change) => {
		const {router, client, setLookup, fetcher} = await setup({
			initial: `/session/${ALIAS}/source/${RECORD}?context=5#focal`,
			cachedOwner: ALICE,
		});
		const heading = await screen.findByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`});
		const main = screen.getByTestId("main");
		main.scrollTop = 300;
		const originalKey = router.state.location.state.__TSR_key;
		const navigate = vi.spyOn(router, "navigate");
		setLookup(async () =>
			change === "ambiguous" ? new Response(null, {status: 409}) : Response.json({sessionId: BOB}),
		);
		await act(() => invalidateSessionIdentities(client));
		await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALICE}/source/${RECORD}`));
		expect({
			title: document.title,
			sameHeading: screen.getByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`}) === heading,
			search: {...router.state.location.search},
			hash: router.state.location.hash,
			identity: router.state.location.state.sessionIdentity,
			historyLength: router.history.length,
			scroll: main.scrollTop,
			urls: fetcher.mock.calls.map(([url]) => url),
			replacement: {
				replace: navigate.mock.calls.at(-1)?.[0].replace,
				resetScroll: navigate.mock.calls.at(-1)?.[0].resetScroll,
				hashScrollIntoView: navigate.mock.calls.at(-1)?.[0].hashScrollIntoView,
			},
		}).toStrictEqual({
			title: "Source: 11111111",
			sameHeading: true,
			search: {context: 5},
			hash: "focal",
			identity: {sessionId: ALICE, scrollKey: originalKey, routeId: ALIAS},
			historyLength: 2,
			scroll: 300,
			urls: [`/api/sessions/${ALICE}/source/${RECORD}?context=5`, `/api/sessions/${ALIAS}/identity`],
			replacement: {replace: true, resetScroll: false, hashScrollIntoView: false},
		});
	},
);

it("renders source data that arrives after a cached missing record without changing hook order", async () => {
	const {client} = await setup({initial: `/session/${ALICE}/source/${RECORD}`, source: null});
	await screen.findByRole("heading", {name: "Source not found"});
	act(() => client.setQueryData(sessionSourceQueryOptions(ALICE, RECORD, 5).queryKey, SOURCE));
	await screen.findByRole("heading", {name: `JSONL source · line 1 · ${RECORD}`});
	expect(screen.getByRole("link", {name: "← Alice session"}).getAttribute("href")).toBe(`/session/${ALICE}`);
});
