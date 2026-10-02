// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
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
import {recentSessionsQueryOptions, sessionDetailQueryOptions, type SessionDetailData} from "../src/lib/api/sessions";
import {sessionQueryKeys} from "../src/lib/api/sessions";
import {pin, readPinState} from "../src/lib/pin-store";
import {getSideChat, resetSideChatStore} from "../src/lib/side-chat-store";
import {installLocalStorage} from "./fake-storage";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const TITLE = "Migrate the indexer to incremental scans for huge projects";
const QUOTED = "“Migrate the indexer to incremental scan…”";

function detail(overrides: Partial<SessionDetailData> = {}): SessionDetailData {
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

function Harness() {
	const palette = useCommandPalette();
	return (
		<>
			<textarea aria-label="Composer" />
			<CommandPalette {...palette} />
		</>
	);
}

function SessionRoute() {
	const {id} = useParams({strict: false});
	return <SessionTitleHeading sessionId={id ?? ""} title={TITLE} archived={false} />;
}

async function openPalette(initialPath: string, sessionDetail: SessionDetailData = detail()) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
		sessions: [],
		nextCursor: null,
	});
	queryClient.setQueryData(sessionDetailQueryOptions("sess-1").queryKey, sessionDetail);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Harness />
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: SessionRoute,
	});
	const plansRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "plans",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([sessionRoute, plansRoute]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const composer = await screen.findByRole("textbox", {name: "Composer"});
	composer.focus();
	fireEvent.keyDown(composer, {key: "k", code: "KeyK", metaKey: true});
	const dialog = await screen.findByRole("dialog", {name: "Search"});
	return {dialog, input: within(dialog).getByRole("combobox", {name: "Search"}), queryClient};
}

function optionLabels(dialog: HTMLElement): string[] {
	return [...dialog.querySelectorAll("[cmdk-item]")].map(
		(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
	);
}

describe("palette contextual session commands", () => {
	const writeText = vi.fn((_text: string) => Promise.resolve());
	const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));

	beforeEach(() => {
		fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
		installLocalStorage();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		Element.prototype.scrollIntoView = () => {};
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		writeText.mockClear();
		fetchMock.mockClear();
	});

	it("lists the copy commands with the quoted title when 'copy' is typed on a session page", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "copy"}});

		await within(dialog).findByRole("option", {name: `Copy link to ${QUOTED}`});
		expect(optionLabels(dialog).slice(0, 4)).toStrictEqual([
			"New session",
			`Copy link to ${QUOTED}`,
			"Copy resume command",
			"Copy fork command",
		]);
		expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/identity"))).toStrictEqual([]);
	});

	it.each([
		{query: "resume", label: "Copy resume command", copied: "cd '/users/dev/project-a' && claude -r sess-1"},
		{
			query: "fork",
			label: "Copy fork command",
			copied: "cd '/users/dev/project-a' && claude -r sess-1 --fork-session",
		},
		{query: "link", label: `Copy link to ${QUOTED}`, copied: "http://localhost:3000/session/sess-1"},
	])("uses the resolved local ID for the alias route's $query command", async ({query, label, copied}) => {
		fetchMock.mockImplementation((url) =>
			url.endsWith("/identity")
				? Promise.resolve(Response.json({sessionId: "sess-1"}))
				: new Promise<Response>(() => {}),
		);
		const {dialog, input} = await openPalette("/session/session_alice_100");
		fireEvent.change(input, {target: {value: query}});
		fireEvent.click(await within(dialog).findByRole("option", {name: label}));
		await waitFor(() => expect(writeText.mock.calls).toStrictEqual([[copied]]));
		expect(
			fetchMock.mock.calls.filter(([url]) => url.includes("session_alice_100")).map(([url]) => url),
		).toStrictEqual(["/api/sessions/session_alice_100/identity"]);
	});

	it("pins the local UUID after resolving an alias", async () => {
		fetchMock.mockImplementation((url) =>
			url.endsWith("/identity")
				? Promise.resolve(Response.json({sessionId: "sess-1"}))
				: new Promise<Response>(() => {}),
		);
		const {dialog, input} = await openPalette("/session/session_alice_100");
		fireEvent.change(input, {target: {value: "pin"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: `Pin ${QUOTED}`}));
		await waitFor(() => expect(readPinState()).toStrictEqual({pinnedIds: ["sess-1"], pinnedOrder: []}));
	});

	it("archives the local UUID after resolving an alias", async () => {
		fetchMock.mockImplementation((url) =>
			url.endsWith("/identity")
				? Promise.resolve(Response.json({sessionId: "sess-1"}))
				: new Promise<Response>(() => {}),
		);
		const {dialog, input} = await openPalette("/session/session_alice_100");
		fireEvent.change(input, {target: {value: "archive"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: `Archive ${QUOTED}`}));
		await waitFor(() =>
			expect(
				fetchMock.mock.calls
					.filter(([, init]) => init?.method === "PUT")
					.map(([url, init]) => ({url, method: init?.method})),
			).toStrictEqual([{url: "/api/sessions/sess-1/archived", method: "PUT"}]),
		);
	});

	it.each([null, 404, 409])("does not offer local session actions for an unresolved alias (%s)", async (status) => {
		if (status !== null)
			fetchMock.mockImplementation((url) =>
				url.endsWith("/identity")
					? Promise.resolve(Response.json({error: "Fabricated identity failure"}, {status}))
					: new Promise<Response>(() => {}),
			);
		const {dialog, input, queryClient} = await openPalette("/session/session_alice_100");
		if (status !== null)
			await waitFor(() =>
				expect(queryClient.getQueryState(sessionQueryKeys.identity("session_alice_100"))?.status).toBe("error"),
			);
		fireEvent.change(input, {target: {value: "session"}});
		await within(dialog).findByRole("option", {name: /See all results/});
		expect({
			actions: optionLabels(dialog).filter((label) =>
				/^(Pin |Rename |Archive |Copy |Show side chat)/.test(label),
			),
			aliasRequests: fetchMock.mock.calls
				.filter(([url]) => url.includes("session_alice_100"))
				.map(([url]) => url),
			writes: fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT" || init?.method === "POST"),
		}).toStrictEqual({actions: [], aliasRequests: ["/api/sessions/session_alice_100/identity"], writes: []});
	});

	it("offers Pin, Rename and the session commands for 'session'", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "session"}});

		await within(dialog).findByRole("option", {name: `Pin ${QUOTED}`});
		expect(optionLabels(dialog).slice(0, 7)).toStrictEqual([
			"New session",
			`Pin ${QUOTED}`,
			`Rename ${QUOTED}`,
			`Copy link to ${QUOTED}`,
			`Archive ${QUOTED}`,
			"Copy resume command",
			"Copy fork command",
		]);
	});

	it("offers Unpin for a session pinned in this browser", async () => {
		pin("sess-1");
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "pin"}});

		await within(dialog).findByRole("option", {name: `Unpin ${QUOTED}`});
	});

	it("offers Unarchive for an archived session", async () => {
		const {dialog, input} = await openPalette("/session/sess-1", detail({archived: true}));

		fireEvent.change(input, {target: {value: "archive"}});

		await within(dialog).findByRole("option", {name: `Unarchive ${QUOTED}`});
		expect(within(dialog).queryByRole("option", {name: `Archive ${QUOTED}`})).toBeNull();
	});

	it("archives the current session from its command", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");
		fireEvent.change(input, {target: {value: "archive"}});

		fireEvent.click(await within(dialog).findByRole("option", {name: `Archive ${QUOTED}`}));

		await waitFor(() =>
			expect(fetchMock.mock.calls.filter(([url]) => url === "/api/sessions/sess-1/archived")).toEqual([
				["/api/sessions/sess-1/archived", expect.objectContaining({method: "PUT"})],
			]),
		);
	});

	it("hides the commands in the empty state", async () => {
		const {dialog} = await openPalette("/session/sess-1");

		await within(dialog).findByRole("option", {name: "Settings"});
		expect(optionLabels(dialog).filter((label) => label.includes("Copy"))).toStrictEqual([]);
	});

	it("offers Show side chat with its ⌘; keycaps on a session page and opens it", async () => {
		resetSideChatStore();
		const {dialog} = await openPalette("/session/sess-1");

		const option = await within(dialog).findByRole("option", {name: /Show side chat/});
		expect([
			option.querySelector("[data-palette-label]")?.textContent,
			option.getAttribute("aria-keyshortcuts"),
		]).toStrictEqual(["Show side chat", "Meta+;"]);

		fireEvent.click(option);

		expect(getSideChat("sess-1").open).toBe(true);
	});

	it("does not offer Show side chat off a session page", async () => {
		const {dialog} = await openPalette("/plans");

		await within(dialog).findByRole("option", {name: "Settings"});
		expect(optionLabels(dialog).filter((label) => label === "Show side chat")).toStrictEqual([]);
	});

	it("does not offer the commands on other routes", async () => {
		const {dialog, input} = await openPalette("/plans");

		fireEvent.change(input, {target: {value: "copy"}});

		await within(dialog).findByRole("option", {name: /See all results/});
		expect(optionLabels(dialog).filter((label) => label.startsWith("Copy"))).toStrictEqual([]);
	});

	it("copies the resume command in the project directory", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "resume"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: "Copy resume command"}));

		await waitFor(() =>
			expect(writeText.mock.calls).toStrictEqual([["cd '/users/dev/project-a' && claude -r sess-1"]]),
		);
		expect(await screen.findByText("Command copied to clipboard.")).toBeTruthy();
	});

	it("copies the fork command", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "fork"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: "Copy fork command"}));

		await waitFor(() =>
			expect(writeText.mock.calls).toStrictEqual([
				["cd '/users/dev/project-a' && claude -r sess-1 --fork-session"],
			]),
		);
	});

	it.each([
		{query: "link", label: `Copy link to ${QUOTED}`, copied: "http://localhost:3000/session/session_alice_100"},
		{query: "resume", label: "Copy resume command", copied: "cd '/users/dev/project-a' && claude -r sess-1"},
		{
			query: "fork",
			label: "Copy fork command",
			copied: "cd '/users/dev/project-a' && claude -r sess-1 --fork-session",
		},
	])(
		"uses canonical proof only for the copied URL, preserving the $query command",
		async ({query, label, copied}) => {
			const {dialog, input} = await openPalette(
				"/session/sess-1",
				detail({canonicalRouteId: "session_alice_100"}),
			);
			fireEvent.change(input, {target: {value: query}});
			fireEvent.click(await within(dialog).findByRole("option", {name: label}));
			await waitFor(() => expect(writeText.mock.calls).toStrictEqual([[copied]]));
			expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/identity"))).toStrictEqual([]);
		},
	);

	it("copies the session link", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "link"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: `Copy link to ${QUOTED}`}));

		await waitFor(() => expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]));
		expect(await screen.findByText("Link copied to clipboard.")).toBeTruthy();
	});

	it("pins the session in this browser without a server call", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "pin"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: `Pin ${QUOTED}`}));

		await waitFor(() => expect(readPinState()).toStrictEqual({pinnedIds: ["sess-1"], pinnedOrder: []}));
		expect(fetchMock.mock.calls.filter(([url]) => url.includes("/starred"))).toStrictEqual([]);
	});

	it("starts renaming the session title", async () => {
		const {dialog, input} = await openPalette("/session/sess-1");

		fireEvent.change(input, {target: {value: "rename"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: `Rename ${QUOTED}`}));

		const rename = await screen.findByRole("textbox", {name: "Rename"});
		expect((rename as HTMLInputElement).value).toBe(TITLE);
	});
});
