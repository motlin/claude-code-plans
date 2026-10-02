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
	useLocation,
	type HistoryState,
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
import {SessionChat} from "../src/components/session-chat";

const ALIAS = "session_alice_100";
const ALICE = "local-alice-100";
const BOB = "local-bob-200";
const observed = vi.hoisted(() => ({
	owners: [] as string[],
	mounts: 0,
	scrollKeys: [] as string[],
	pairs: [] as string[],
	renderChat: false,
}));

// The real route, query cache and history run here. Only the expensive transcript leaf is a probe;
// existing SessionPage and transcript scroll suites cover that leaf with its real implementation.
vi.mock("../src/components/session-page", () => ({
	SessionPage: function SessionProbe({
		sessionId,
		routeId,
		scrollKey,
		onRequestedPaneHandled,
	}: {
		sessionId: string;
		routeId: string;
		scrollKey?: string;
		onRequestedPaneHandled: () => void;
	}) {
		const locationKey = useLocation({select: (location) => sessionScrollKey(location, sessionId)});
		const key = scrollKey ?? locationKey;
		const restored = useMainScrollRestoration(key);
		observed.owners.push(sessionId);
		observed.pairs.push(`${sessionId}:${routeId}`);
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
				{observed.renderChat && (
					<SessionChat
						sessionId={sessionId}
						initialScrollKey={key}
						shouldScrollToEnd={restored === undefined}
						lines={[
							{
								type: "user",
								uuid: "example-alice-prompt",
								lineIndex: 0,
								message: {role: "user", content: "Example Alice prompt"},
							},
						]}
						toolResultMap={new Map()}
					/>
				)}
				<input aria-label="Draft" defaultValue="" />
				<button type="button" onClick={onRequestedPaneHandled}>
					Pane opened
				</button>
			</div>
		);
	},
}));

vi.mock("../src/hooks/use-claude-events", () => ({
	useSubscribeSessionStates: () => () => () => {},
	useClaudeEvents: () => ({failedTools: new Map()}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
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
	observed.pairs = [];
	observed.renderChat = false;
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
	configure,
	initialState,
	homeLoader,
}: {
	initial?: string;
	cachedOwner?: string;
	invalidated?: boolean;
	configure?: (client: QueryClient) => void;
	initialState?: HistoryState;
	homeLoader?: () => Promise<void>;
} = {}) {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const response = deferredResponse();
	const detailResponse = deferredResponse();
	let lookup = () => response.promise;
	const fetcher = vi.fn((url: string, _init?: RequestInit) =>
		url.endsWith("/identity")
			? lookup()
			: url === `/api/sessions/${ALICE}`
				? detailResponse.promise
				: new Promise<Response>(() => {}),
	);
	vi.stubGlobal("fetch", fetcher);
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	clients.push(client);
	if (cachedOwner) client.setQueryData(sessionIdentityQueryOptions(ALIAS).queryKey, {sessionId: cachedOwner});
	if (invalidated) await client.invalidateQueries({queryKey: sessionIdentityQueryOptions(ALIAS).queryKey});
	configure?.(client);
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
	const history = createMemoryHistory({initialEntries: ["/session/local-charlie-300", initial], initialIndex: 1});
	if (initialState) history.replace(initial, initialState);
	const router = createRouter({
		routeTree: root.addChildren([
			SessionRoute,
			createRoute({
				getParentRoute: () => root,
				path: "/",
				...(homeLoader ? {loader: homeLoader} : {}),
				component: () => <p>New session</p>,
			}),
		]),
		context: {queryClient: client},
		history,
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
		finishDetail: detailResponse.finish,
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
		client.setQueryData<SessionDetailData | null>(sessionDetailQueryOptions(ALICE).queryKey, ALICE_DETAIL);
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
			client.setQueryData<SessionDetailData | null>(sessionDetailQueryOptions(ALICE).queryKey, ALICE_DETAIL);
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

it("replaces a UUID with its fresh alias without another request or losing the mounted visit", async () => {
	const {router, client, finishDetail, fetcher} = await setup({
		initial: `/session/${ALICE}?pane=changes#message-alice`,
	});
	const page = screen.getByTestId("session");
	const main = screen.getByTestId("main");
	const key = router.state.location.state.__TSR_key;
	fireEvent.change(screen.getByRole("textbox", {name: "Draft"}), {target: {value: "Keep Alice's draft"}});
	main.scrollTop = 300;
	main.dispatchEvent(new Event("scroll"));
	await act(async () => finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: ALIAS})));
	await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
	const canonicalSearch = {...router.state.location.search};
	fireEvent.click(screen.getByRole("button", {name: "Pane opened"}));
	await waitFor(() => expect({...router.state.location.search}).toStrictEqual({}));
	expect({
		samePage: screen.getByTestId("session") === page,
		owners: new Set(observed.owners),
		mounts: observed.mounts,
		nativeKeyChanged: key !== router.state.location.state.__TSR_key,
		scrollKeys: observed.scrollKeys.map((value) => value === key),
		initialRoute: page.dataset["route"],
		scroll: main.scrollTop,
		draft: (screen.getByRole("textbox", {name: "Draft"}) as HTMLInputElement).value,
		canonicalSearch,
		hash: router.state.location.hash,
		historyLength: router.history.length,
		identity: client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey),
		urls: fetcher.mock.calls.map(([url]) => url),
	}).toStrictEqual({
		samePage: true,
		owners: new Set([ALICE]),
		mounts: 1,
		nativeKeyChanged: true,
		scrollKeys: [true],
		initialRoute: ALICE,
		scroll: 300,
		draft: "Keep Alice's draft",
		canonicalSearch: {pane: "changes"},
		hash: "message-alice",
		historyLength: 2,
		identity: {sessionId: ALICE},
		urls: [
			`/api/sessions/${ALICE}`,
			`/api/sessions/${ALICE}/transcript`,
			`/api/sessions/${ALICE}/subagents`,
			"/api/herdr-panes",
		],
	});
	act(() => router.history.back());
	await waitFor(() => expect(router.state.location.pathname).toBe("/session/local-charlie-300"));
});

it.each(["ambiguous", "new-owner"])(
	"keeps the original UUID visit after a canonical alias becomes %s without reseeding",
	async (change) => {
		const {router, client, finishDetail, fetcher, setLookup} = await setup({initial: `/session/${ALICE}`});
		const page = screen.getByTestId("session");
		const key = router.state.location.state.__TSR_key;
		await act(async () => finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: ALIAS})));
		await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
		setLookup(async () =>
			change === "ambiguous" ? new Response(null, {status: 409}) : Response.json({sessionId: BOB}),
		);
		await act(() => invalidateSessionIdentities(client));
		await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALICE}`));
		await act(async () => {
			client.setQueryData<SessionDetailData | null>(sessionDetailQueryOptions(ALICE).queryKey, () => ({
				...ALICE_DETAIL,
				canonicalRouteId: ALIAS,
			}));
		});
		expect({
			samePage: screen.getByTestId("session") === page,
			owners: new Set(observed.owners),
			mounts: observed.mounts,
			initialRoute: page.dataset["route"],
			scrollKeys: observed.scrollKeys.map((value) => value === key),
			pathname: router.state.location.pathname,
			identityStatus: client.getQueryState(sessionIdentityQueryOptions(ALIAS).queryKey)?.status,
			identity: client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey),
			identityRequests: fetcher.mock.calls.filter(([url]) => url.endsWith("/identity")).length,
		}).toStrictEqual({
			samePage: true,
			owners: new Set([ALICE]),
			mounts: 1,
			initialRoute: ALICE,
			scrollKeys: [true],
			pathname: `/session/${ALICE}`,
			identityStatus: change === "ambiguous" ? "error" : "success",
			identity: {sessionId: change === "ambiguous" ? ALICE : BOB},
			identityRequests: 1,
		});
	},
);

it("preserves an explicitly opened historical alias even when detail advertises a newer alias", async () => {
	const {router, client, finishDetail, fetcher} = await setup({cachedOwner: ALICE});
	await act(async () => finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: "session_alice_200"})));
	await waitFor(() => expect(document.title).toBe("Alice session"));
	expect({
		pathname: router.state.location.pathname,
		initialRoute: screen.getByTestId("session").dataset["route"],
		latestIdentity: client.getQueryState(sessionIdentityQueryOptions("session_alice_200").queryKey),
		identityRequests: fetcher.mock.calls.filter(([url]) => url.endsWith("/identity")),
	}).toStrictEqual({
		pathname: `/session/${ALIAS}`,
		initialRoute: ALIAS,
		latestIdentity: undefined,
		identityRequests: [],
	});
});

it("waits for a pending backfill marker to clear before seeding a canonical alias", async () => {
	const {router, client, finishDetail, fetcher} = await setup({initial: `/session/${ALICE}`});
	await act(async () =>
		finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: ALIAS, canonicalRoutePending: true})),
	);
	const pending = {
		pathname: router.state.location.pathname,
		identity: client.getQueryState(sessionIdentityQueryOptions(ALIAS).queryKey),
	};
	act(() =>
		client.setQueryData<SessionDetailData | null>(sessionDetailQueryOptions(ALICE).queryKey, () => ({
			...ALICE_DETAIL,
			canonicalRouteId: ALIAS,
		})),
	);
	await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
	expect({pending, urls: fetcher.mock.calls.map(([url]) => url)}).toStrictEqual({
		pending: {pathname: `/session/${ALICE}`, identity: undefined},
		urls: [
			`/api/sessions/${ALICE}`,
			`/api/sessions/${ALICE}/transcript`,
			`/api/sessions/${ALICE}/subagents`,
			"/api/herdr-panes",
		],
	});
});

it.each(["fetching", "invalidated"])(
	"does not create alias cache from %s detail before a fresh result",
	async (state) => {
		const {client, router, finishDetail, fetcher} = await setup({initial: `/session/${ALICE}`});
		await act(async () => {
			client.setQueryData<SessionDetailData | null>(sessionDetailQueryOptions(ALICE).queryKey, () => ({
				...ALICE_DETAIL,
				canonicalRouteId: ALIAS,
			}));
			if (state === "invalidated")
				await client.invalidateQueries({
					queryKey: sessionDetailQueryOptions(ALICE).queryKey,
					refetchType: "none",
				});
		});
		const before = {
			pathname: router.state.location.pathname,
			identity: client.getQueryState(sessionIdentityQueryOptions(ALIAS).queryKey),
		};
		await act(async () => finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: ALIAS})));
		await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
		expect({
			before,
			identity: client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey),
			identityRequests: fetcher.mock.calls.filter(([url]) => url.endsWith("/identity")),
		}).toStrictEqual({
			before: {pathname: `/session/${ALICE}`, identity: undefined},
			identity: {sessionId: ALICE},
			identityRequests: [],
		});
	},
);

it.each(["matching", "different", "invalidated", "error", "fetching"])(
	"respects existing %s identity cache when UUID detail proves an alias",
	async (state) => {
		const {client, router, finishDetail, fetcher, finish} = await setup({
			initial: `/session/${ALICE}`,
			configure: (client) => {
				const options = sessionIdentityQueryOptions(ALIAS);
				if (state === "matching" || state === "different" || state === "invalidated") {
					client.setQueryData(options.queryKey, {sessionId: state === "different" ? BOB : ALICE});
					if (state === "invalidated") void client.invalidateQueries({queryKey: options.queryKey});
				} else if (state === "error") {
					client
						.getQueryCache()
						.build(client, {queryKey: options.queryKey})
						.setState({status: "error", error: new Error("Example identity lookup failed")});
				} else void client.prefetchQuery(options);
			},
		});
		await act(async () => finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: ALIAS})));
		await waitFor(() => expect(document.title).toBe("Alice session"));
		if (state === "matching") await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
		if (state === "invalidated" || state === "error" || state === "fetching") {
			await waitFor(() =>
				expect(client.getQueryState(sessionIdentityQueryOptions(ALIAS).queryKey)?.fetchStatus).toBe("fetching"),
			);
		}
		const before = {
			pathname: router.state.location.pathname,
			cached: client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey),
		};
		await act(async () => finish(Response.json({sessionId: BOB})));
		if (state === "invalidated" || state === "error" || state === "fetching") {
			await waitFor(() =>
				expect(client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey)).toStrictEqual({
					sessionId: BOB,
				}),
			);
		}

		expect({
			before,
			pathname: router.state.location.pathname,
			cached: client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey),
			owners: new Set(observed.owners),
			identityRequests: fetcher.mock.calls.filter(([url]) => url.endsWith("/identity")).length,
		}).toStrictEqual({
			before: {
				pathname: `/session/${state === "matching" ? ALIAS : ALICE}`,
				cached:
					state === "matching" || state === "invalidated"
						? {sessionId: ALICE}
						: state === "different"
							? {sessionId: BOB}
							: undefined,
			},
			pathname: `/session/${state === "matching" ? ALIAS : ALICE}`,
			cached: {sessionId: state === "matching" ? ALICE : BOB},
			owners: new Set([ALICE]),
			identityRequests: state === "matching" || state === "different" ? 0 : 1,
		});
	},
);

it("requires a new lookup after losing a canonical alias and removing its cache", async () => {
	const {client, router, finishDetail, setLookup, fetcher} = await setup({initial: `/session/${ALICE}`});
	await act(async () => finishDetail(Response.json({...ALICE_DETAIL, canonicalRouteId: ALIAS})));
	await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
	setLookup(async () => new Response(null, {status: 409}));
	await act(() => invalidateSessionIdentities(client));
	await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALICE}`));
	const replacement = deferredResponse();
	setLookup(() => replacement.promise);
	act(() => {
		client.removeQueries({queryKey: sessionIdentityQueryOptions(ALIAS).queryKey});
		client.setQueryData<SessionDetailData | null>(sessionDetailQueryOptions(ALICE).queryKey, () => ({
			...ALICE_DETAIL,
			canonicalRouteId: ALIAS,
			title: "Alice refreshed",
		}));
	});
	await waitFor(() =>
		expect(client.getQueryState(sessionIdentityQueryOptions(ALIAS).queryKey)?.fetchStatus).toBe("fetching"),
	);
	const pending = {
		pathname: router.state.location.pathname,
		cached: client.getQueryData(sessionIdentityQueryOptions(ALIAS).queryKey),
	};
	await act(async () => replacement.finish(Response.json({sessionId: ALICE})));
	await waitFor(() => expect(router.state.location.pathname).toBe(`/session/${ALIAS}`));
	expect({
		pending,
		owners: new Set(observed.owners),
		mounts: observed.mounts,
		historyLength: router.history.length,
		identityRequests: fetcher.mock.calls.filter(([url]) => url.endsWith("/identity")).length,
	}).toStrictEqual({
		pending: {pathname: `/session/${ALICE}`, cached: undefined},
		owners: new Set([ALICE]),
		mounts: 1,
		historyLength: 2,
		identityRequests: 2,
	});
});

it("uses the actual alias launch marker on a fresh mount with carried UUID replacement history", async () => {
	const {router, fetcher} = await setup({
		cachedOwner: ALICE,
		initialState: {
			sessionIdentity: {sessionId: ALICE, routeId: ALICE, aliasRouteId: ALIAS, scrollKey: "example-uuid-entry"},
		},
	});
	expect({
		pathname: router.state.location.pathname,
		initialRoute: screen.getByTestId("session").dataset["route"],
		scrollKeys: observed.scrollKeys,
		owners: new Set(observed.owners),
		identityRequests: fetcher.mock.calls.filter(([url]) => url.endsWith("/identity")),
	}).toStrictEqual({
		pathname: `/session/${ALIAS}`,
		initialRoute: ALIAS,
		scrollKeys: ["example-uuid-entry"],
		owners: new Set([ALICE]),
		identityRequests: [],
	});
});

it("never stamps the destination launch marker onto the previous alias owner's page during navigation", async () => {
	const {router} = await setup({cachedOwner: ALICE});
	await act(() => router.navigate({to: "/session/$id", params: {id: BOB}}));
	await waitFor(() => expect(screen.getByTestId("session").dataset["session"]).toBe(BOB));
	expect({pairs: new Set(observed.pairs), pathname: router.state.location.pathname}).toStrictEqual({
		pairs: new Set([`${ALICE}:${ALIAS}`, `${BOB}:${BOB}`]),
		pathname: `/session/${BOB}`,
	});
});

it.each([ALICE, ALIAS])("keeps the outgoing %s chat at its reading position while New is loading", async (routeId) => {
	observed.renderChat = true;
	const frames = new Map<number, FrameRequestCallback>();
	let frameId = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++frameId, callback);
		return frameId;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	const scrollIntoView = vi.fn();
	vi.stubGlobal("scrollIntoView", scrollIntoView);
	const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
	Object.defineProperty(Element.prototype, "scrollIntoView", {configurable: true, value: scrollIntoView});
	const flushFrames = () => {
		for (let turn = 0; frames.size > 0 && turn < 10; turn++) {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback(0);
		}
	};
	let finishHome!: () => void;
	const home = new Promise<void>((resolve) => {
		finishHome = resolve;
	});
	try {
		const {router} = await setup({initial: `/session/${routeId}`, cachedOwner: ALICE, homeLoader: () => home});
		const originalKey = router.state.location.state.__TSR_key;
		act(flushFrames);
		const initialScrolls = [...scrollIntoView.mock.calls];
		scrollIntoView.mockClear();
		const main = screen.getByTestId("main");
		act(() => {
			main.scrollTop = 300;
			fireEvent.scroll(main);
		});
		let navigation!: Promise<void>;
		await act(async () => {
			navigation = router.navigate({to: "/"});
		});
		await waitFor(() => expect(router.state.location.pathname).toBe("/"));
		act(flushFrames);
		const duringNavigation = {
			owner: screen.getByTestId("session").dataset["session"],
			scrollKeys: observed.scrollKeys.map((key) => key === originalKey),
			scrollTop: main.scrollTop,
			endScrolls: [...scrollIntoView.mock.calls],
		};
		await act(async () => {
			finishHome();
			await navigation;
		});
		expect({initialScrolls, duringNavigation, home: screen.getByText("New session").textContent}).toStrictEqual({
			initialScrolls: [[{block: "end"}]],
			duringNavigation: {owner: ALICE, scrollKeys: [true], scrollTop: 300, endScrolls: []},
			home: "New session",
		});
	} finally {
		if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
		else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
	}
});
