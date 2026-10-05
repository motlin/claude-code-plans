// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useParams,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {StrictMode, useRef} from "react";
import {SessionDock} from "../src/components/session-dock";
import {SessionRouteIdentity} from "../src/components/session-route-identity";
import {sessionIdentityQueryOptions} from "../src/lib/api/session-identity";
import * as measurements from "../src/lib/transcript-measurements";
import {SessionChat} from "../src/components/session-chat";
import {AppFrame} from "../src/components/app-frame";
import {TileHost, usePaneHost} from "../src/components/panes/tile-host";
import {registerPane} from "../src/components/panes/pane-registry";
import {SessionTileFrame, type SessionTileScrollPosition} from "../src/components/session-tile-frame";
import type {SessionLine} from "../src/lib/sessions";

vi.mock("../src/components/sidebar/index", () => ({Sidebar: () => null}));
vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));

const LOCAL_ID = "00000000-0000-4000-8000-000000000100";
const ALIAS = "session_alice_100";
const clients: QueryClient[] = [];

const lines: SessionLine[] = Array.from({length: 80}, (_, index) => ({
	type: index % 2 === 0 ? "user" : "assistant",
	uuid: `example-message-${index}`,
	lineIndex: index,
	message: {role: index % 2 === 0 ? "user" : "assistant", content: `Fabricated message ${index}`},
}));

// Simulate browser geometry, not the virtualizer's estimated height calculations.
let footerExtent = 0;
const nativeScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");
const nativeScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
let widthDependentRows = false;
const rowHeight = (index: number, host: Element) =>
	[200, 500, 150, 400][index % 4]! + (widthDependentRows && hostWidths.get(host) === 640 ? 100 : 0);
const viewportHeight = 600;
let listWidth = 800;
let hostWidths = new WeakMap<Element, number>();
let chatSource: object = lines;
let chatLines = lines;
let chatLayout = "example-layout";
let freshVisit = false;
let phase = "initial";
let positions = new WeakMap<Element, number>();
const writes: Array<{
	host: Element;
	phase: string;
	requested: number;
	applied: number;
	estimatedBefore: number;
	actualBefore: number;
}> = [];
let unregister = () => {};
const nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;

function mountedRows(host: Element): HTMLElement[] {
	return [...host.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")];
}
function spacerHeight(host: Element, position: "before" | "after"): number {
	return Number.parseFloat(
		host.querySelector<HTMLElement>(`[data-transcript-spacer="${position}"]`)?.style.height ?? "0",
	);
}
function contentHeight(host: Element): number {
	if (host.closest("[hidden]")) return 0;
	return (
		spacerHeight(host, "before") +
		mountedRows(host).reduce((sum, row) => sum + rowHeight(Number(row.dataset["transcriptEntryIndex"]), host), 0) +
		spacerHeight(host, "after") +
		footerExtent
	);
}
function clampedPosition(host: Element): number {
	return Math.min(positions.get(host) ?? 0, Math.max(0, contentHeight(host) - viewportHeight));
}
function rowTop(row: HTMLElement): number {
	const host = row.closest("[data-session-scrollport]")!;
	let top = spacerHeight(host, "before");
	for (const current of mountedRows(host)) {
		if (current === row) return top - clampedPosition(host);
		top += rowHeight(Number(current.dataset["transcriptEntryIndex"]), host);
	}
	throw new Error("Expected a mounted transcript row.");
}
function visibleAnchor(host: Element) {
	const row = mountedRows(host).find(
		(candidate) => rowTop(candidate) + rowHeight(Number(candidate.dataset["transcriptEntryIndex"]), host) > 0,
	);
	if (!row) throw new Error("Expected a visible transcript row.");
	return {record: row.dataset["perfLine"], top: rowTop(row)};
}

class ControlledResizeObserver {
	static active = new Set<ControlledResizeObserver>();
	readonly elements = new Set<Element>();
	constructor(readonly callback: ResizeObserverCallback) {
		ControlledResizeObserver.active.add(this);
	}
	observe(element: Element) {
		this.elements.add(element);
	}
	unobserve(element: Element) {
		this.elements.delete(element);
	}
	disconnect() {
		ControlledResizeObserver.active.delete(this);
	}
}

function installGeometry() {
	footerExtent = 0;
	widthDependentRows = false;
	listWidth = 800;
	hostWidths = new WeakMap();
	chatSource = lines;
	chatLayout = "example-layout";
	phase = "initial";
	positions = new WeakMap();
	writes.length = 0;
	vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
	vi.stubGlobal("scrollTo", vi.fn());
	Object.defineProperty(Element.prototype, "scrollTo", {
		configurable: true,
		value: function (this: HTMLElement, options: ScrollToOptions) {
			this.scrollTop = options.top ?? 0;
			fireEvent.scroll(this);
		},
	});
	Object.defineProperty(Element.prototype, "scrollTop", {
		configurable: true,
		get() {
			return this.closest("[hidden]") ? 0 : clampedPosition(this);
		},
		set(value: number) {
			const applied = Math.min(Math.max(0, value), Math.max(0, contentHeight(this) - viewportHeight));
			positions.set(this, applied);
			writes.push({
				host: this,

				phase,
				requested: value,
				applied,
				estimatedBefore: Number(mountedRows(this)[0]?.dataset["transcriptEntryIndex"] ?? 0) * 320,
				actualBefore: spacerHeight(this, "before"),
			});
		},
	});
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		if (this.closest("[hidden]")) return new DOMRect();
		const host = this.closest("[data-session-scrollport]") ?? this;
		if (!hostWidths.has(host)) hostWidths.set(host, listWidth);
		if (this.matches("main,[data-session-scrollport]")) return new DOMRect(0, 0, 800, viewportHeight);
		if (this.matches("[data-testid=virtualized-transcript]"))
			return new DOMRect(0, -clampedPosition(host), hostWidths.get(host), contentHeight(host));
		if (this instanceof HTMLElement && this.dataset["transcriptEntryIndex"] !== undefined) {
			return new DOMRect(
				0,
				rowTop(this),
				hostWidths.get(host),
				rowHeight(Number(this.dataset["transcriptEntryIndex"]), host),
			);
		}
		return new DOMRect();
	});
}

async function settleMeasurements(main: HTMLElement) {
	// Browser scroll and resize callbacks arrive after the router's rendered pass.
	for (let batch = 0; batch < 20; batch++) {
		const before = JSON.stringify({
			height: contentHeight(main),
			top: main.scrollTop,
			rows: mountedRows(main).map((row) => row.dataset["transcriptEntryIndex"]),
		});
		await act(async () => {
			fireEvent.scroll(main);
			const observers = [...ControlledResizeObserver.active];
			for (const observer of observers) {
				const observations = [...observer.elements]
					.filter((element) => element.isConnected)
					.map((target) => ({
						target,
						contentRect: target.getBoundingClientRect(),
						borderBoxSize: [{blockSize: target.getBoundingClientRect().height, inlineSize: 800}],
						contentBoxSize: [],
						devicePixelContentBoxSize: [],
					}));
				observer.callback(observations, observer as unknown as ResizeObserver);
			}
		});
		const after = JSON.stringify({
			height: contentHeight(main),
			top: main.scrollTop,
			rows: mountedRows(main).map((row) => row.dataset["transcriptEntryIndex"]),
		});
		if (before === after) return;
	}
	throw new Error("Transcript measurement did not settle within 20 observer batches.");
}

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	Object.defineProperty(Element.prototype, "scrollTop", nativeScrollTop);
	unregister();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	ControlledResizeObserver.active.clear();
	if (nativeScrollTo) Object.defineProperty(Element.prototype, "scrollTo", nativeScrollTo);
	else Reflect.deleteProperty(Element.prototype, "scrollTo");
	if (nativeScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", nativeScrollIntoView);
	else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function PaneOpenButton() {
	const host = usePaneHost();
	return <button onClick={() => host.openPane("plan")}>Open fabricated pane</button>;
}
const EMPTY_RESULTS = new Map();
function ShellVisit({
	sessionId,
	scrollKey,
	restoredScrollY,
}: {
	sessionId: string;
	scrollKey: string;
	restoredScrollY: number | undefined;
}) {
	const positionRef = useRef<SessionTileScrollPosition | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	return (
		<AppFrame collapsed={false} tileShell>
			<TileHost sessionId={sessionId}>
				<SessionTileFrame
					sessionId={sessionId}
					header={<PaneOpenButton />}
					anchorRef={anchorRef}
					visitKey={scrollKey}
					positionRef={positionRef}
					restoredScrollY={restoredScrollY}
					footer={
						<SessionDock anchorRef={anchorRef}>
							<textarea aria-label="Fabricated draft" defaultValue="Alice's draft" />
						</SessionDock>
					}
				>
					<ShellChat sessionId={sessionId} scrollKey={scrollKey} anchorRef={anchorRef} />
				</SessionTileFrame>
			</TileHost>
		</AppFrame>
	);
}
function ShellChat({
	sessionId,
	scrollKey,
	anchorRef,
}: {
	sessionId: string;
	scrollKey: string;
	anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
	return (
		<SessionChat
			sessionId={sessionId}
			initialScrollKey={scrollKey}
			shouldScrollToEnd={freshVisit}
			scrollContentRef={anchorRef}
			lines={chatLines}
			measurementSource={chatSource}
			measurementLayout={chatLayout}
			toolResultMap={EMPTY_RESULTS}
		/>
	);
}
function ShellTranscriptRoute() {
	const {id} = useParams({strict: false});
	if (!id) throw new Error("Expected fabricated session route");
	return (
		<SessionRouteIdentity routeId={id} captureScrollRestoration>
			{(sessionId, _routeId, scrollKey, snapshot) => (
				<ShellVisit sessionId={sessionId} scrollKey={scrollKey} restoredScrollY={snapshot?.entry?.scrollY} />
			)}
		</SessionRouteIdentity>
	);
}
function actualScrollport() {
	const owners = [...document.querySelectorAll<HTMLElement>('[data-scroll-restoration-id="main"]')];
	expect(
		owners.map((node) => ({tag: node.tagName, chat: node.hasAttribute("data-session-scrollport")})),
	).toStrictEqual([{tag: "DIV", chat: true}]);
	return owners[0]!;
}
function paneMove() {
	return within(document.querySelector<HTMLElement>('[data-tile-host="plan"]')!).getByRole("button", {name: "Move"});
}
function state(host: HTMLElement) {
	return {top: host.scrollTop, anchor: visibleAnchor(host)};
}
async function renderShell(strict: boolean, routeId = LOCAL_ID, fresh = false, records = lines) {
	installGeometry();
	chatLines = records;
	chatSource = records;
	freshVisit = fresh;
	vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}, removeItem: () => {}});
	const computed = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
		const result = computed(element);
		if (element.classList.contains("overflow-y-auto")) Object.defineProperty(result, "overflowY", {value: "auto"});
		return result;
	});
	vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
		return this.matches("[data-session-scrollport]") && !this.closest("[hidden]") ? viewportHeight : 0;
	});
	vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
		return contentHeight(this);
	});
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
		window.setTimeout(() => callback(performance.now()), 0),
	);
	vi.stubGlobal("cancelAnimationFrame", window.clearTimeout.bind(window));
	unregister = registerPane("plan", {title: "Fabricated pane", render: () => <p>Alice pane</p>});
	const root = createRootRoute({component: Outlet});
	const transcript = createRoute({getParentRoute: () => root, path: "/session/$id", component: ShellTranscriptRoute});
	const ordinary = createRoute({
		getParentRoute: () => root,
		path: "/plans",
		component: () => (
			<AppFrame collapsed={false}>
				<p>Plans</p>
			</AppFrame>
		),
	});
	const router = createRouter({
		routeTree: root.addChildren([transcript, ordinary]),
		history: createMemoryHistory({initialEntries: [`/session/${routeId}`]}),
		scrollRestoration: true,
	});
	await router.load();
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	clients.push(client);
	client.setQueryData(sessionIdentityQueryOptions(ALIAS).queryKey, {sessionId: LOCAL_ID});
	const page = (
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
	render(strict ? <StrictMode>{page}</StrictMode> : page);
	await screen.findByRole("button", {name: "Open fabricated pane"});
	return router;
}
it.each([false, true])(
	"retains the visible record through a same-commit nested tile move, strict=%s",
	async (strict) => {
		await renderShell(strict);
		const initial = actualScrollport();
		fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
		expect(actualScrollport()).toBe(initial);
		await settleMeasurements(initial);
		await act(async () => {
			initial.scrollTop = 8000;
			fireEvent.scroll(initial);
		});
		await settleMeasurements(initial);
		const before = state(initial);
		expect(before.top > 0).toBe(true);
		fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
		expect(actualScrollport()).toBe(initial);
		phase = "move";
		fireEvent.keyDown(paneMove(), {key: "Enter"});
		const moved = actualScrollport();
		expect(moved === initial).toBe(false);
		await settleMeasurements(moved);
		expect({
			after: state(moved),
			clamped: writes
				.filter((w) => w.phase === "move" && w.requested !== w.applied)
				.map(({requested, applied}) => ({requested, applied})),
			oldMain: writes.filter((w) => w.phase === "move" && w.host.tagName === "MAIN").length,
		}).toStrictEqual({after: before, clamped: [], oldMain: 0});
		await act(async () => {
			moved.scrollTop -= 100;
			fireEvent.scroll(moved);
		});
		await settleMeasurements(moved);
		const user = state(moved);
		await settleMeasurements(moved);
		expect(state(moved)).toStrictEqual(user);
	},
);

it.each([
	{strict: false, initialWidth: 800},
	{strict: true, initialWidth: 800},
	{strict: false, initialWidth: 640},
])(
	"retains a clipped record through successive width-changing moves, strict=$strict, initialWidth=$initialWidth",
	async ({strict, initialWidth}) => {
		await renderShell(strict);
		widthDependentRows = true;
		const routerHost = actualScrollport();
		fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
		hostWidths.set(routerHost, initialWidth);
		await settleMeasurements(routerHost);
		await act(async () => {
			routerHost.scrollTop = 8050;
			fireEvent.scroll(routerHost);
		});
		await settleMeasurements(routerHost);
		const before = visibleAnchor(routerHost);
		const snapshots = [];
		for (const [width, direction] of [
			[initialWidth === 800 ? 640 : 800, "ArrowDown"],
			[initialWidth, "ArrowRight"],
			[initialWidth === 800 ? 640 : 800, "ArrowDown"],
		] as const) {
			listWidth = width;
			fireEvent.keyDown(paneMove(), {key: direction});
			fireEvent.keyDown(paneMove(), {key: "Enter"});
			const moved = actualScrollport();
			const immediate = visibleAnchor(moved);
			await settleMeasurements(moved);
			snapshots.push({immediate, settled: visibleAnchor(moved)});
		}
		expect({before, snapshots}).toStrictEqual({
			before,
			snapshots: Array.from({length: 3}, () => ({immediate: before, settled: before})),
		});
	},
);

it.each([false, true])(
	"restores the settled reading anchor on Back after a pane width cycle, strict=%s",
	async (strict) => {
		const router = await renderShell(strict, ALIAS);
		widthDependentRows = true;
		const initial = actualScrollport();
		fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
		await settleMeasurements(initial);
		await act(async () => {
			initial.scrollTop = 8050;
			fireEvent.scroll(initial);
		});
		await settleMeasurements(initial);
		for (const [width, direction] of [
			[640, "ArrowDown"],
			[800, "ArrowRight"],
			[640, "ArrowDown"],
			[800, "ArrowRight"],
		] as const) {
			listWidth = width;
			fireEvent.keyDown(paneMove(), {key: direction});
			fireEvent.keyDown(paneMove(), {key: "Enter"});
			await settleMeasurements(actualScrollport());
		}
		fireEvent.click(screen.getByRole("button", {name: "Close"}));
		await settleMeasurements(actualScrollport());
		const before = state(actualScrollport());
		await act(() => router.navigate({to: "/plans"}));
		await act(async () => router.history.back());
		await screen.findByRole("button", {name: "Open fabricated pane"});
		await settleMeasurements(actualScrollport());
		expect(state(actualScrollport())).toStrictEqual(before);
	},
);

it("restores the settled reading anchor after a live width round trip without remounting", async () => {
	const router = await renderShell(false, ALIAS);
	widthDependentRows = true;
	const initial = actualScrollport();
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8050;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	for (const width of [640, 800]) {
		hostWidths.set(initial, width);
		await settleMeasurements(initial);
	}
	const before = state(initial);
	await act(() => router.navigate({to: "/plans"}));
	await act(async () => router.history.back());
	await screen.findByRole("button", {name: "Open fabricated pane"});
	await settleMeasurements(actualScrollport());
	expect(state(actualScrollport())).toStrictEqual(before);
});

it("rejects a tile width change that has not delivered observations before departure", async () => {
	const router = await renderShell(false);
	widthDependentRows = true;
	const initial = actualScrollport();
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8050;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const remember = vi.spyOn(measurements, "rememberTranscriptMeasurements");
	hostWidths.set(initial, 640);
	await act(() => router.navigate({to: "/plans"}));
	expect(remember.mock.calls).toStrictEqual([]);
});

it("preserves saved zero through a nested move", async () => {
	await renderShell(false);
	const initial = actualScrollport();
	fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8000;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 0;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const before = state(initial);
	fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
	fireEvent.keyDown(paneMove(), {key: "Enter"});
	const moved = actualScrollport();
	await settleMeasurements(moved);
	expect({changedHost: moved !== initial, top: moved.scrollTop, anchor: visibleAnchor(moved)}).toStrictEqual({
		changedHost: true,
		top: 0,
		anchor: before.anchor,
	});
});
it.each([LOCAL_ID, ALIAS])("restores chat on Back after an ordinary route owns main: %s", async (routeId) => {
	const router = await renderShell(false, routeId);
	const initial = actualScrollport();
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8000;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const before = state(initial);
	await act(() => router.navigate({to: "/plans"}));
	expect(
		[...document.querySelectorAll('[data-scroll-restoration-id="main"]')].map((node) => ({
			tag: node.tagName,
			chat: node.hasAttribute("data-session-scrollport"),
		})),
	).toStrictEqual([{tag: "MAIN", chat: false}]);
	await act(async () => router.history.back());
	await screen.findByRole("button", {name: "Open fabricated pane"});
	const returned = actualScrollport();
	await settleMeasurements(returned);
	expect(state(returned)).toStrictEqual(before);
});
it.each([false, true])(
	"binds the moved dock and preserves reading position through hidden Expand/Collapse, strict=%s",
	async (strict) => {
		await renderShell(strict);
		const initial = actualScrollport();
		fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
		await settleMeasurements(initial);
		await act(async () => {
			initial.scrollTop = 8000;
			fireEvent.scroll(initial);
		});
		await settleMeasurements(initial);
		fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
		fireEvent.keyDown(paneMove(), {key: "Enter"});
		const moved = actualScrollport();
		await settleMeasurements(moved);
		const before = state(moved);
		const draft = screen.getByRole("textbox", {name: "Fabricated draft"});
		fireEvent.change(draft, {target: {value: "Alice's unsent revised draft"}});
		const beforeRows = mountedRows(moved);
		phase = "hidden-nested";
		fireEvent.click(screen.getByRole("button", {name: "Expand"}));
		const hiddenHost = actualScrollport();
		expect(hiddenHost).toBe(moved);
		expect({
			hidden: hiddenHost.closest("[hidden]") !== null,
			height: hiddenHost.clientHeight,
			width: hiddenHost.getBoundingClientRect().width,
			scrollHeight: hiddenHost.scrollHeight,
		}).toStrictEqual({hidden: true, height: 0, width: 0, scrollHeight: 0});
		await settleFresh(hiddenHost);
		expect(mountedRows(hiddenHost)).toStrictEqual(beforeRows);
		expect({
			paneCount: screen.getAllByText("Alice pane").length,
			overlayCount: document.querySelectorAll("[data-pane-overlay]").length,
		}).toStrictEqual({paneCount: 1, overlayCount: 1});
		fireEvent.click(screen.getByRole("button", {name: "Collapse"}));
		const collapsed = actualScrollport();
		expect(collapsed).toBe(moved);
		await settleMeasurements(collapsed);
		expect(state(collapsed)).toStrictEqual(before);
		expect(screen.getByRole("textbox", {name: "Fabricated draft"})).toBe(draft);
		expect((draft as HTMLTextAreaElement).value).toBe("Alice's unsent revised draft");
		expect(
			writes
				.filter((write) => write.phase === "hidden-nested")
				.map(({requested, applied}) => ({requested, applied})),
		).toStrictEqual([]);
		const targetHeight = collapsed.scrollHeight;
		phase = "dock";
		fireEvent.click(screen.getByRole("button", {name: "Scroll to bottom"}));
		expect(
			writes
				.filter((w) => w.phase === "dock")
				.map((w) => ({
					newHost: w.host === collapsed,
					oldHost: w.host === initial,
					requested: w.requested,
					applied: w.applied,
				})),
		).toStrictEqual([
			{
				newHost: true,
				oldHost: false,
				requested: targetHeight,
				applied: targetHeight - collapsed.clientHeight,
			},
		]);
	},
);

it.each(["source", "layout"] as const)("rejects incompatible same-commit %s measurements", async (change) => {
	const router = await renderShell(false);
	const initial = actualScrollport();
	fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8000;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const remember = vi.spyOn(measurements, "rememberTranscriptMeasurements");
	if (change === "source") chatSource = {};
	if (change === "layout") chatLayout = "example-larger-font";
	fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
	fireEvent.keyDown(paneMove(), {key: "Enter"});
	expect(actualScrollport() === initial).toBe(false);
	// No observer measurements occur before departure. Reusing the old snapshot
	// here would save its nonempty height map from the new incompatible instance.
	await act(() => router.navigate({to: "/plans"}));
	expect(remember.mock.calls.at(-1)?.[1].heights).toStrictEqual(new Map());
});

it("does not hand off geometry after a compact-summary disclosure", async () => {
	const records = lines.map((line, index) => (index === 0 ? {...line, isCompactSummary: true} : line));
	await renderShell(false, LOCAL_ID, false, records);
	fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
	await settleMeasurements(actualScrollport());
	fireEvent.click(screen.getByRole("button", {name: "Compacted conversation"}));
	await settleMeasurements(actualScrollport());
	const remember = vi.spyOn(measurements, "rememberTranscriptHandoff");
	listWidth = 640;
	fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
	fireEvent.keyDown(paneMove(), {key: "Enter"});
	expect(remember.mock.calls).toStrictEqual([]);
});

it("waits for invalid-width geometry to commit before restoring Back", async () => {
	const router = await renderShell(false);
	const initial = actualScrollport();
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8000;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	await act(() => router.navigate({to: "/plans"}));
	listWidth = 640;
	phase = "changed-width-back";
	await act(async () => router.history.back());
	await screen.findByRole("button", {name: "Open fabricated pane"});
	const returned = actualScrollport();
	// The only restore sees estimated spacers for the new width, never the old measured spacer.
	expect(
		writes
			.filter((w) => w.phase === "changed-width-back" && w.host === returned)
			.map((w) => ({
				expected: w.estimatedBefore,
				actual: w.actualBefore,
				requested: w.requested,
				applied: w.applied,
			})),
	).toStrictEqual([{expected: 0, actual: 0, requested: 7960, applied: 7960}]);
});
async function settleFresh(host: HTMLElement) {
	for (let turn = 0; turn < 3; turn++) {
		await act(async () => {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		});
		await settleMeasurements(host);
	}
}
it("does not restart fresh tail scrolling when a reader moves the tile after scrolling away", async () => {
	await renderShell(false, LOCAL_ID, true);
	const initial = actualScrollport();
	await settleFresh(initial);
	expect(initial.scrollHeight - initial.clientHeight - initial.scrollTop).toBe(0);
	fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
	await act(async () => {
		fireEvent.wheel(initial, {deltaY: -600});
		initial.scrollTop -= 600;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const before = state(initial);
	fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
	fireEvent.keyDown(paneMove(), {key: "Enter"});
	const moved = actualScrollport();
	await settleFresh(moved);
	footerExtent = 200;
	await settleFresh(moved);
	expect(state(moved)).toStrictEqual(before);
});
it.each([
	{strict: false, fresh: true},
	{strict: true, fresh: true},
	{strict: false, fresh: false},
	{strict: true, fresh: false},
])(
	"retains end-follow through width-changing moves and later footer growth, strict=$strict, fresh=$fresh",
	async ({strict, fresh}) => {
		await renderShell(strict, LOCAL_ID, fresh);
		widthDependentRows = true;
		const initial = actualScrollport();
		await settleFresh(initial);
		if (!fresh) {
			await act(async () => {
				initial.scrollTo({top: initial.scrollHeight});
			});
			await settleFresh(initial);
		}
		fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
		const distances = [];
		for (const [width, direction] of [
			[640, "ArrowDown"],
			[800, "ArrowRight"],
		] as const) {
			listWidth = width;
			fireEvent.keyDown(paneMove(), {key: direction});
			fireEvent.keyDown(paneMove(), {key: "Enter"});
			const moved = actualScrollport();
			await settleFresh(moved);
			distances.push(moved.scrollHeight - moved.clientHeight - moved.scrollTop);
			footerExtent += 200;
			await settleFresh(moved);
			distances.push(moved.scrollHeight - moved.clientHeight - moved.scrollTop);
		}
		expect(distances).toStrictEqual([0, 0, 0, 0]);
		const moved = actualScrollport();
		await act(async () => {
			fireEvent.wheel(moved, {deltaY: -600});
			moved.scrollTop -= 600;
			fireEvent.scroll(moved);
		});
		await settleMeasurements(moved);
		const before = state(moved);
		footerExtent += 200;
		await settleFresh(moved);
		expect(state(moved)).toStrictEqual(before);
	},
);

it("follows footer growth through the actual shell content ref until upward input", async () => {
	await renderShell(false, LOCAL_ID, true);
	const host = actualScrollport();
	await settleFresh(host);
	const content = host.firstElementChild!;
	expect([...ControlledResizeObserver.active].some((observer) => observer.elements.has(content))).toBe(true);
	footerExtent = 200;
	await settleFresh(host);
	expect(host.scrollHeight - host.clientHeight - host.scrollTop).toBe(0);
	await act(async () => {
		fireEvent.wheel(host, {deltaY: -600});
		host.scrollTop -= 600;
		fireEvent.scroll(host);
	});
	await settleMeasurements(host);
	const before = state(host);
	footerExtent = 400;
	await settleFresh(host);
	expect(state(host)).toStrictEqual(before);
});

it.each([0, 8000])("restores a captured offset when alias resolution mounts the host late: %s", async (offset) => {
	const router = await renderShell(false, ALIAS);
	const initial = actualScrollport();
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = offset;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const before = state(initial);
	await act(() => router.navigate({to: "/plans"}));
	clients.at(-1)!.removeQueries({queryKey: sessionIdentityQueryOptions(ALIAS).queryKey});
	let resolveIdentity: (response: Response) => void = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveIdentity = resolve;
				}),
		),
	);
	await act(async () => router.history.back());
	await screen.findByTestId("session-skeleton");
	expect(document.querySelector("[data-session-scrollport]")).toBeNull();
	phase = "cold-host";
	await act(async () =>
		resolveIdentity(
			new Response(JSON.stringify({sessionId: LOCAL_ID}), {headers: {"Content-Type": "application/json"}}),
		),
	);
	await screen.findByRole("button", {name: "Open fabricated pane"});
	const returned = actualScrollport();
	await settleFresh(returned);
	expect({
		position: state(returned),
		writes: writes
			.filter((write) => write.phase === "cold-host" && write.host === returned)
			.map(({requested, applied}) => ({requested, applied})),
	}).toStrictEqual({position: before, writes: offset === 0 ? [] : [{requested: before.top, applied: before.top}]});
});
it("cancels a delayed-host restore when the reader scrolls before its fallback frame", async () => {
	const router = await renderShell(false, ALIAS);
	const initial = actualScrollport();
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8000;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	await act(() => router.navigate({to: "/plans"}));
	clients.at(-1)!.removeQueries({queryKey: sessionIdentityQueryOptions(ALIAS).queryKey});
	let resolveIdentity: (response: Response) => void = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveIdentity = resolve;
				}),
		),
	);
	await act(async () => router.history.back());
	await screen.findByTestId("session-skeleton");
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => {
		frames.delete(id);
	});
	await act(async () =>
		resolveIdentity(
			new Response(JSON.stringify({sessionId: LOCAL_ID}), {headers: {"Content-Type": "application/json"}}),
		),
	);
	await screen.findByRole("button", {name: "Open fabricated pane"});
	const returned = actualScrollport();
	await act(async () => {
		fireEvent.wheel(returned, {deltaY: 500});
		returned.scrollTop = 500;
		fireEvent.scroll(returned);
	});
	const before = state(returned);
	phase = "cancelled-fallback";
	await act(async () => {
		const pending = [...frames];
		for (const [id, callback] of pending) {
			frames.delete(id);
			callback(0);
		}
	});
	expect({
		position: state(returned),
		writes: writes
			.filter((write) => write.phase === "cancelled-fallback")
			.map(({requested, applied}) => ({requested, applied})),
	}).toStrictEqual({position: before, writes: []});
});

it.each([false, true])("ignores hidden observations without reparenting the root chat, strict=%s", async (strict) => {
	await renderShell(strict);
	const initial = actualScrollport();
	fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
	await settleMeasurements(initial);
	await act(async () => {
		initial.scrollTop = 8000;
		fireEvent.scroll(initial);
	});
	await settleMeasurements(initial);
	const before = state(initial);
	phase = "hidden-root";
	fireEvent.click(screen.getByRole("button", {name: "Expand"}));
	expect(actualScrollport()).toBe(initial);
	await settleFresh(initial);
	expect(
		writes.filter((write) => write.phase === "hidden-root").map(({requested, applied}) => ({requested, applied})),
	).toStrictEqual([]);
	fireEvent.click(screen.getByRole("button", {name: "Collapse"}));
	await settleMeasurements(initial);
	expect({sameHost: actualScrollport() === initial, position: state(initial)}).toStrictEqual({
		sameHost: true,
		position: before,
	});
});
it.each(["source", "layout", "width"] as const)(
	"rejects changed %s when a hidden nested chat becomes visible",
	async (change) => {
		const router = await renderShell(false);
		const initial = actualScrollport();
		fireEvent.click(screen.getByRole("button", {name: "Open fabricated pane"}));
		await settleMeasurements(initial);
		await act(async () => {
			initial.scrollTop = 8000;
			fireEvent.scroll(initial);
		});
		await settleMeasurements(initial);
		fireEvent.keyDown(paneMove(), {key: "ArrowDown"});
		fireEvent.keyDown(paneMove(), {key: "Enter"});
		await settleMeasurements(actualScrollport());
		fireEvent.click(screen.getByRole("button", {name: "Expand"}));
		await settleFresh(actualScrollport());
		if (change === "source") chatSource = {};
		if (change === "layout") chatLayout = "example-larger-font";
		if (change === "width") {
			listWidth = 640;
			hostWidths.set(actualScrollport(), listWidth);
		}
		const remember = vi.spyOn(measurements, "rememberTranscriptMeasurements");
		fireEvent.click(screen.getByRole("button", {name: "Collapse"}));
		await act(() => router.navigate({to: "/plans"}));
		expect(remember.mock.calls.at(-1)?.[1].heights ?? new Map()).toStrictEqual(new Map());
	},
);
