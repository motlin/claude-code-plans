// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRouter,
	HeadContent,
	Outlet,
	RouterProvider,
	useLocation,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useEffect} from "react";
import {afterEach, expect, it, vi} from "vite-plus/test";
import {useMainScrollRestoration} from "../src/hooks/use-main-scroll-restoration";
import {invalidateSessionIdentities, sessionIdentityQueryOptions} from "../src/lib/api/session-identity";
import {sessionScrollKey} from "../src/lib/session-route-location";
import {AttentionBadgeBridge} from "../src/components/attention-badge-bridge";
import {sessionDetailQueryOptions, type SessionDetailData} from "../src/lib/api/sessions";
import {Route as SessionRoute} from "../src/routes/session.$id";

const ALIAS = "session_alice_100";
const ALICE = "local-alice-100";
const BOB = "local-bob-200";
const observed = vi.hoisted(() => ({owners: [] as string[], mounts: 0, scrollKeys: [] as string[]}));

// The real route, query cache and history run here. Only the expensive transcript leaf is a probe;
// existing SessionPage and transcript scroll suites cover that leaf with its real implementation.
vi.mock("../src/components/session-page", () => ({
	SessionPage: function SessionProbe({
		sessionId,
		routeId,
		onRequestedPaneHandled,
	}: {
		sessionId: string;
		routeId: string;
		onRequestedPaneHandled: () => void;
	}) {
		const key = useLocation({select: (location) => sessionScrollKey(location, sessionId)});
		const restored = useMainScrollRestoration(key);
		observed.owners.push(sessionId);
		useEffect(() => {
			observed.mounts++;
		}, []);
		useEffect(() => {
			observed.scrollKeys.push(key);
		}, [key]);
		return (
			<div
				data-testid="session"
				data-session={sessionId}
				data-route={routeId}
				data-restored={restored?.scrollY ?? "none"}
			>
				<input aria-label="Draft" defaultValue="" />
				<button type="button" onClick={onRequestedPaneHandled}>
					Pane opened
				</button>
			</div>
		);
	},
}));

vi.mock("../src/hooks/use-claude-events", () => ({useSubscribeSessionStates: () => () => () => {}}));
vi.mock("../src/components/settings-provider", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/components/settings-provider")>();
	return {...actual, useSettings: () => ({settings: actual.DEFAULTS})};
});

const ALICE_DETAIL: SessionDetailData = {
	title: "Alice session",
	projectName: "Example",
	projectId: "example",
	homeRoot: "/tmp/example",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: null,
	gitSha: null,
	gitClean: null,
	messageCount: 1,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: 0,
		lastViewedMessageIndex: -1,
		reviewTargetMessageIndex: -1,
		newMessageCount: 1,
		viewedAnywhere: false,
		viewedInCcp: false,
		viewedInHerdr: false,
	},
};

const clients: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	observed.owners = [];
	observed.mounts = 0;
	observed.scrollKeys = [];
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function deferredResponse() {
	let finish!: (response: Response) => void;
	const promise = new Promise<Response>((resolve) => {
		finish = resolve;
	});
	return {promise, finish};
}

async function setup({
	initial = `/session/${ALIAS}`,
	cachedOwner,
	invalidated = false,
}: {initial?: string; cachedOwner?: string; invalidated?: boolean} = {}) {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const response = deferredResponse();
	let lookup = () => response.promise;
	const fetcher = vi.fn((url: string, _init?: RequestInit) =>
		url.endsWith("/identity") ? lookup() : new Promise<Response>(() => {}),
	);
	vi.stubGlobal("fetch", fetcher);
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	clients.push(client);
	if (cachedOwner) client.setQueryData(sessionIdentityQueryOptions(ALIAS).queryKey, {sessionId: cachedOwner});
	if (invalidated) await client.invalidateQueries({queryKey: sessionIdentityQueryOptions(ALIAS).queryKey});
	const root = createRootRouteWithContext<{queryClient: QueryClient}>()({
		component: () => (
			<>
				<HeadContent />
				<AttentionBadgeBridge />
				<main data-testid="main" data-scroll-restoration-id="main">
					<Outlet />
				</main>
			</>
		),
	});
	SessionRoute.update({id: "/session/$id", path: "/session/$id", getParentRoute: () => root} as never);
	const router = createRouter({
		routeTree: root.addChildren([SessionRoute]),
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
		finish: response.finish,
		setLookup: (next: () => Promise<Response>) => {
			lookup = next;
		},
	};
}

it("keeps a cold alias pending without sending it to UUID APIs, then opens its resolved owner", async () => {
	const {fetcher, finish} = await setup();
	const pending = {
		skeleton: screen.getByTestId("session-skeleton") !== null,
		calls: fetcher.mock.calls.map(([url]) => url),
	};
	await act(async () => finish(Response.json({sessionId: ALICE})));
	const page = await screen.findByTestId("session");
	expect({
		pending,
		owner: page.dataset["session"],
		owners: new Set(observed.owners),
		urls: fetcher.mock.calls.map(([url]) => url),
	}).toStrictEqual({
		pending: {skeleton: true, calls: [`/api/sessions/${ALIAS}/identity`]},
		owner: ALICE,
		owners: new Set([ALICE]),
		urls: [`/api/sessions/${ALIAS}/identity`, `/api/sessions/${ALICE}`],
	});
});

it("leaves UUID navigation immediate with exactly four synchronous prefetches and no identity lookup", async () => {
	const {fetcher} = await setup({initial: `/session/${ALICE}`});
	expect({
		owner: screen.getByTestId("session").dataset["session"],
		urls: fetcher.mock.calls.map(([url]) => url),
	}).toStrictEqual({
		owner: ALICE,
		urls: [
			`/api/sessions/${ALICE}`,
			`/api/sessions/${ALICE}/transcript`,
			`/api/sessions/${ALICE}/subagents`,
			"/api/herdr-panes",
		],
	});
});

it("waits for a fresh lookup rather than pinning invalidated success from a previous visit", async () => {
	const {finish} = await setup({cachedOwner: ALICE, invalidated: true});
	const pending = {owners: [...observed.owners], skeleton: screen.getByTestId("session-skeleton") !== null};
	await act(async () => finish(Response.json({sessionId: BOB})));
	const page = await screen.findByTestId("session");
	expect({pending, owner: page.dataset["session"], owners: new Set(observed.owners)}).toStrictEqual({
		pending: {owners: [], skeleton: true},
		owner: BOB,
		owners: new Set([BOB]),
	});
});

it.each([404, 409, 503])(
	"shows an honest %s lookup error and supports manual retry",
	async (status) => {
		const {finish, setLookup, fetcher, client} = await setup();
		setLookup(async () => new Response(null, {status}));
		await act(async () => finish(new Response(null, {status})));
		const message = (await screen.findByRole("alert", {}, {timeout: 8000})).textContent;
		const failedRequests = fetcher.mock.calls.length;
		const title = document.title;
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		const attentionTitle = document.title;
		client.setQueryData(sessionDetailQueryOptions(ALICE).queryKey, ALICE_DETAIL);
		setLookup(async () => Response.json({sessionId: ALICE}));
		fireEvent.click(screen.getByRole("button", {name: "Retry"}));
		const page = await screen.findByTestId("session");
		await waitFor(() => expect(document.title).toBe("Alice session"));
		expect({
			status,
			message,
			title,
			attentionTitle,
			failedRequests,
			owner: page.dataset["session"],
			owners: new Set(observed.owners),
		}).toStrictEqual({
			status,
			attentionTitle:
				status === 404 ? "Session Not Found" : status === 409 ? "Ambiguous session link" : "Indexing sessions…",
			title:
				status === 404 ? "Session Not Found" : status === 409 ? "Ambiguous session link" : "Indexing sessions…",
			message:
				status === 404
					? "Session Not Found"
					: status === 409
						? "This session link has more than one local session."
						: "Sessions are still being indexed. Try again shortly.",
			failedRequests: status === 503 ? 3 : 1,
			owner: ALICE,
			owners: new Set([ALICE]),
		});
	},
	10_000,
);

it.each(["ambiguous", "new-owner"])(
	"keeps the same mounted owner and scroll identity when a live alias becomes %s",
	async (change) => {
		const {client, router, setLookup} = await setup({
			initial: `/session/${ALIAS}?pane=changes#message-alice`,
			cachedOwner: ALICE,
		});
		const page = await screen.findByTestId("session");
		await act(async () => {
			client.setQueryData(sessionDetailQueryOptions(ALICE).queryKey, ALICE_DETAIL);
		});
		await waitFor(() => expect(document.title).toBe("Alice session"));
		const main = screen.getByTestId("main");
		const originalKey = router.state.location.state.__TSR_key;
		fireEvent.change(screen.getByRole("textbox", {name: "Draft"}), {target: {value: "Keep Alice's draft"}});
		main.scrollTop = 300;
		main.dispatchEvent(new Event("scroll"));
		setLookup(async () =>
			change === "ambiguous" ? new Response(null, {status: 409}) : Response.json({sessionId: BOB}),
		);
		await act(() => invalidateSessionIdentities(client));
		await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALICE}`));
		expect({
			title: document.title,
			samePage: screen.getByTestId("session") === page,
			owners: new Set(observed.owners),
			mounts: observed.mounts,
			keyChanged: originalKey !== router.state.location.state.__TSR_key,
			scrollKeys: observed.scrollKeys.map((key) => key === originalKey),
			route: page.dataset["route"],
			scrollTop: main.scrollTop,
			draft: (screen.getByRole("textbox", {name: "Draft"}) as HTMLInputElement).value,
			search: {...router.state.location.search},
			hash: router.state.location.hash,
			length: router.history.length,
		}).toStrictEqual({
			title: "Alice session",
			samePage: true,
			owners: new Set([ALICE]),
			mounts: 1,
			keyChanged: true,
			scrollKeys: [true],
			route: ALIAS,
			scrollTop: 300,
			draft: "Keep Alice's draft",
			search: {pane: "changes"},
			hash: "message-alice",
			length: 2,
		});
		act(() => router.history.back());
		await waitFor(() => expect(router.state.location.pathname).toBe("/session/local-charlie-300"));
		setLookup(async () => Response.json({sessionId: BOB}));
		await act(() => router.navigate({to: "/session/$id", params: {id: ALIAS}}));
		await waitFor(() => expect(screen.getByTestId("session").dataset["session"]).toBe(BOB));
	},
);

it.each([BOB, "session_bob_200"])(
	"does not carry another session's scroll identity into a new %s visit",
	async (target) => {
		const {router, finish} = await setup({initial: `/session/${ALICE}`});
		const oldKey = router.state.location.state.__TSR_key!;
		await act(() =>
			router.navigate({
				to: "/session/$id",
				params: {id: target},
				state: {sessionIdentity: {sessionId: ALICE, routeId: ALIAS, scrollKey: oldKey}},
			}),
		);
		if (target.startsWith("session_")) await act(async () => finish(Response.json({sessionId: BOB})));
		await screen.findByTestId("session");
		expect({
			owner: screen.getByTestId("session").dataset["session"],
			keys: observed.scrollKeys.map((key) => key === router.state.location.state.__TSR_key),
			route: screen.getByTestId("session").dataset["route"],
		}).toStrictEqual({owner: BOB, keys: [false, true], route: target});
	},
);

it("does not open a late alias result after navigation leaves that visit", async () => {
	const {router, finish, fetcher} = await setup();
	await act(() => router.navigate({to: "/session/$id", params: {id: BOB}}));
	await act(async () => finish(Response.json({sessionId: ALICE})));
	expect({
		aborted: fetcher.mock.calls[0]?.[1]?.signal?.aborted,
		pathname: router.state.location.pathname,
		owners: new Set(observed.owners),
		urls: fetcher.mock.calls.map(([url]) => url),
	}).toStrictEqual({
		aborted: true,
		pathname: `/session/${BOB}`,
		owners: new Set([BOB]),
		urls: [
			`/api/sessions/${ALIAS}/identity`,
			`/api/sessions/${BOB}`,
			`/api/sessions/${BOB}/transcript`,
			`/api/sessions/${BOB}/subagents`,
			"/api/herdr-panes",
		],
	});
});

it("retains the pinned visit when consuming a pane deep link during an identity refresh", async () => {
	const {client, router, finish} = await setup({
		initial: `/session/${ALIAS}?pane=changes#message-alice`,
		cachedOwner: ALICE,
	});
	const page = screen.getByTestId("session");
	const originalKey = router.state.location.state.__TSR_key;
	await act(async () => {
		void invalidateSessionIdentities(client);
	});
	await waitFor(() =>
		expect(client.getQueryState(sessionIdentityQueryOptions(ALIAS).queryKey)?.fetchStatus).toBe("fetching"),
	);
	fireEvent.click(screen.getByRole("button", {name: "Pane opened"}));
	await waitFor(() => expect({...router.state.location.search}).toStrictEqual({}));
	await act(async () => finish(new Response(null, {status: 409})));
	await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALICE}`));
	expect({
		samePage: screen.getByTestId("session") === page,
		mounts: observed.mounts,
		owners: new Set(observed.owners),
		scrollKeys: observed.scrollKeys.map((key) => key === originalKey),
		route: page.dataset["route"],
		hash: router.state.location.hash,
		length: router.history.length,
	}).toStrictEqual({
		samePage: true,
		mounts: 1,
		owners: new Set([ALICE]),
		scrollKeys: [true],
		route: ALIAS,
		hash: "message-alice",
		length: 2,
	});
});
