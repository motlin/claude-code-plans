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
import {sessionSubagentsQueryOptions} from "../src/lib/api/sessions";
import type {LiveSubagentNode} from "../src/lib/live-subagent-store";
import type {Subagent} from "../src/lib/subagents";
import {Route as SubagentsRoute} from "../src/routes/session.$id_.subagents";

const ALIAS = "session_alice_100";
const ALICE = "local-alice-100";
const BOB = "local-bob-200";
const harness = vi.hoisted(() => ({liveSubagents: new Map<string, LiveSubagentNode>()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => harness}));
vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {defaultSubagentView: "tree"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
	hmrTake: () => undefined,
	hmrDispose: () => {},
}));

function agent(id: string, sessionId: string, description: string, parentAgentId: string | null = null): Subagent {
	return {
		id,
		sessionId,
		projectId: "example",
		parentAgentId,
		agentType: "Explore",
		attributionAgent: null,
		slug: null,
		description,
		model: null,
		startedAt: "2000-01-01T00:00:00.000Z",
		finishedAt: "2000-01-01T00:01:00.000Z",
	};
}
const ALICE_AGENTS = [
	agent("agent-alice-100", ALICE, "Alice parent"),
	agent("agent-alice-200", ALICE, "Alice child", "agent-alice-100"),
];
const BOB_AGENTS = [agent("agent-bob-100", BOB, "Bob parent")];
function live(agentId: string, sessionId: string, description: string): LiveSubagentNode {
	return {
		agentId,
		sessionId,
		description,
		parentAgentId: null,
		agentType: "Explore",
		startedAt: "2000-01-02T00:00:00.000Z",
		endedAt: null,
	};
}
const clients: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	harness.liveSubagents.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function setup({
	initial = `/session/${ALIAS}/subagents`,
	cachedOwner,
	invalidated = false,
}: {initial?: string; cachedOwner?: string; invalidated?: boolean} = {}) {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	let finish!: (response: Response) => void;
	const pending = new Promise<Response>((resolve) => {
		finish = resolve;
	});
	let lookup = () => pending;
	const fetcher = vi.fn((url: string, _init?: RequestInit) => {
		if (url.endsWith("/identity")) return lookup();
		if (url === `/api/sessions/${ALICE}/subagents`) return Promise.resolve(Response.json(ALICE_AGENTS));
		if (url === `/api/sessions/${BOB}/subagents`) return Promise.resolve(Response.json(BOB_AGENTS));
		throw new Error(`Unexpected request: ${url}`);
	});
	vi.stubGlobal("fetch", fetcher);
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	clients.push(client);
	if (cachedOwner) client.setQueryData(sessionIdentityQueryOptions(ALIAS).queryKey, {sessionId: cachedOwner});
	if (invalidated) await client.invalidateQueries({queryKey: sessionIdentityQueryOptions(ALIAS).queryKey});
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
	SubagentsRoute.update({
		id: "/session/$id_/subagents",
		path: "/session/$id/subagents",
		getParentRoute: () => root,
	} as never);
	const parentLoader = vi.fn();
	const session = createRoute({
		getParentRoute: () => root,
		path: "/session/$id",
		loader: parentLoader,
		component: () => <p>Session</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([SubagentsRoute, session]),
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
		parentLoader,
		finish,
		setLookup: (next: () => Promise<Response>) => {
			lookup = next;
		},
	};
}

it("resolves aliases before fetching UUID subagents and filters/deduplicates real indexed and live tree nodes", async () => {
	harness.liveSubagents.set("agent-alice-100", live("agent-alice-100", ALICE, "Alice duplicate live"));
	harness.liveSubagents.set("agent-alice-300", live("agent-alice-300", ALICE, "Alice live only"));
	harness.liveSubagents.set("agent-bob-100", live("agent-bob-100", BOB, "Bob unrelated live"));
	const {fetcher, finish, client, parentLoader} = await setup();
	const pending = {
		skeleton: screen.getByTestId("session-skeleton") !== null,
		urls: fetcher.mock.calls.map(([url]) => url),
	};
	await act(async () => finish(Response.json({sessionId: ALICE})));
	await screen.findByRole("heading", {name: "Subagents (3)"});
	await waitFor(() => expect(document.title).toBe("Subagents - local-al"));
	expect({
		pending,
		title: document.title,
		urls: fetcher.mock.calls.map(([url]) => url),
		parentLoads: parentLoader.mock.calls.length,
		aliceIndexed: screen.getByText("Alice parent").textContent,
		aliceChild: screen.getByText("Alice child").textContent,
		aliceLive: screen.getByText("Alice live only").textContent,
		duplicateLive: screen.queryByText("Alice duplicate live"),
		unrelatedLive: screen.queryByText("Bob unrelated live"),
		links: screen.getAllByRole("link").map((link) => link.getAttribute("href")),
		cached: client.getQueryData(sessionSubagentsQueryOptions(ALICE).queryKey),
	}).toStrictEqual({
		pending: {skeleton: true, urls: [`/api/sessions/${ALIAS}/identity`]},
		title: "Subagents - local-al",
		urls: [`/api/sessions/${ALIAS}/identity`, `/api/sessions/${ALICE}/subagents`],
		parentLoads: 0,
		aliceIndexed: "Alice parent",
		aliceChild: "Alice child",
		aliceLive: "Alice live only",
		duplicateLive: null,
		unrelatedLive: null,
		links: [`/session/${ALICE}`, "/session/agent-alice-100", "/session/agent-alice-200"],
		cached: ALICE_AGENTS,
	});
});

it("keeps UUID subagent visits free of identity requests", async () => {
	const {fetcher, parentLoader} = await setup({initial: `/session/${ALICE}/subagents`});
	await screen.findByRole("heading", {name: "Subagents (2)"});
	expect({
		urls: fetcher.mock.calls.map(([url]) => url),
		parentLoads: parentLoader.mock.calls.length,
		title: document.title,
		back: screen.getByRole("link", {name: "Back to session"}).getAttribute("href"),
	}).toStrictEqual({
		urls: [`/api/sessions/${ALICE}/subagents`],
		parentLoads: 0,
		title: "Subagents - local-al",
		back: `/session/${ALICE}`,
	});
});

it.each([404, 409])("restores the subagents title after retrying the shared %s alias failure", async (status) => {
	const {finish, setLookup, fetcher} = await setup();
	await act(async () => finish(new Response(null, {status})));
	await waitFor(() => expect(document.title).toBe(status === 404 ? "Session Not Found" : "Ambiguous session link"));
	const failure = {message: screen.getByRole("alert").textContent, urls: fetcher.mock.calls.map(([url]) => url)};
	setLookup(async () => Response.json({sessionId: ALICE}));
	fireEvent.click(screen.getByRole("button", {name: "Retry"}));
	await screen.findByRole("heading", {name: "Subagents (2)"});
	await waitFor(() => expect(document.title).toBe("Subagents - local-al"));
	expect(failure).toStrictEqual({
		message: status === 404 ? "Session Not Found" : "This session link has more than one local session.",
		urls: [`/api/sessions/${ALIAS}/identity`],
	});
});

it("waits for fresh B when a new entry has invalidated cached owner A", async () => {
	const {finish, fetcher} = await setup({cachedOwner: ALICE, invalidated: true});
	const pending = {
		alice: screen.queryByText("Alice parent"),
		skeleton: screen.getByTestId("session-skeleton") !== null,
	};
	await act(async () => finish(Response.json({sessionId: BOB})));
	await screen.findByText("Bob parent");
	expect({
		pending,
		alice: screen.queryByText("Alice parent"),
		urls: fetcher.mock.calls.map(([url]) => url),
		back: screen.getByRole("link", {name: "Back to session"}).getAttribute("href"),
	}).toStrictEqual({
		pending: {alice: null, skeleton: true},
		alice: null,
		urls: [`/api/sessions/${ALIAS}/identity`, `/api/sessions/${BOB}/subagents`],
		back: `/session/${BOB}`,
	});
});

it.each(["ambiguous", "reassigned"])(
	"retains Alice's actual collapsed tree and suffix when the alias becomes %s",
	async (change) => {
		const {client, router, setLookup, fetcher} = await setup({
			initial: `/session/${ALIAS}/subagents?example=1#tree`,
			cachedOwner: ALICE,
		});
		const heading = await screen.findByRole("heading", {name: "Subagents (2)"});
		await screen.findByText("Alice child");
		fireEvent.click(screen.getByText("Alice parent"));
		const main = screen.getByTestId("main");
		main.scrollTop = 300;
		const originalKey = router.state.location.state.__TSR_key;
		setLookup(async () =>
			change === "ambiguous" ? new Response(null, {status: 409}) : Response.json({sessionId: BOB}),
		);
		await act(() => invalidateSessionIdentities(client));
		await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALICE}/subagents`));
		expect({
			sameHeading: screen.getByRole("heading", {name: "Subagents (2)"}) === heading,
			collapsedChild: screen.queryByText("Alice child"),
			bob: screen.queryByText("Bob parent"),
			title: document.title,
			search: {...router.state.location.search},
			hash: router.state.location.hash,
			carried: router.state.location.state.sessionIdentity,
			originalKey,
			scroll: main.scrollTop,
			historyLength: router.history.length,
			urls: fetcher.mock.calls.map(([url]) => url),
		}).toStrictEqual({
			sameHeading: true,
			collapsedChild: null,
			bob: null,
			title: "Subagents - local-al",
			search: {example: 1},
			hash: "tree",
			carried: {sessionId: ALICE, scrollKey: originalKey, routeId: ALIAS, aliasRouteId: ALIAS},
			originalKey,
			scroll: 300,
			historyLength: 2,
			urls: [`/api/sessions/${ALICE}/subagents`, `/api/sessions/${ALIAS}/identity`],
		});
		act(() => router.history.back());
		await waitFor(() => expect(router.state.location.pathname).toBe("/session/local-charlie-300"));
	},
);

it("cancels a pending lookup and ignores its late answer after leaving the subagents visit", async () => {
	const {router, finish, fetcher} = await setup();
	await act(() => router.navigate({to: "/session/$id", params: {id: BOB}}));
	await act(async () => finish(Response.json({sessionId: ALICE})));
	expect({
		pathname: router.state.location.pathname,
		heading: screen.queryByRole("heading", {name: /Subagents/}),
		aborted: fetcher.mock.calls[0]?.[1]?.signal?.aborted,
		urls: fetcher.mock.calls.map(([url]) => url),
	}).toStrictEqual({
		pathname: `/session/${BOB}`,
		heading: null,
		aborted: true,
		urls: [`/api/sessions/${ALIAS}/identity`],
	});
});
