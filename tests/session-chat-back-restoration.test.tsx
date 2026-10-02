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
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {StrictMode, useRef} from "react";
import {SessionDock} from "../src/components/session-dock";
import {SessionRouteIdentity} from "../src/components/session-route-identity";
import {sessionIdentityQueryOptions} from "../src/lib/api/session-identity";
import {SessionChat} from "../src/components/session-chat";
import {useMainScrollRestoration} from "../src/hooks/use-main-scroll-restoration";
import * as measurements from "../src/lib/transcript-measurements";
import {processTranscript} from "../src/lib/transcript";
import type {SessionLine} from "../src/lib/sessions";

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
const rowAdjustments = new Map<number, number>();
let footerExtent = 0;
let tailGeometry = false;
let smoothTarget: number | undefined;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const nativeScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");
const nativeScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const rowHeight = (index: number) =>
	(tailGeometry && index === 39 ? 800 : [200, 500, 150, 400][index % 4]!) + (rowAdjustments.get(index) ?? 0);
const viewportHeight = 600;
let listWidth = 800;
let phase = "initial";
let scrollPosition = 0;
const writes: Array<{phase: string; requested: number; applied: number}> = [];
const restored: Array<number | undefined> = [];
const restorationWindows: string[][] = [];
const nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;

function mountedRows(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")];
}
function spacerHeight(position: "before" | "after"): number {
	return Number.parseFloat(
		document.querySelector<HTMLElement>(`[data-transcript-spacer="${position}"]`)?.style.height ?? "0",
	);
}
function contentHeight(): number {
	return (
		spacerHeight("before") +
		mountedRows().reduce((sum, row) => sum + rowHeight(Number(row.dataset["transcriptEntryIndex"])), 0) +
		spacerHeight("after") +
		footerExtent
	);
}
function clampedPosition(): number {
	return Math.min(scrollPosition, Math.max(0, contentHeight() - viewportHeight));
}
function rowTop(row: HTMLElement): number {
	let top = spacerHeight("before");
	for (const current of mountedRows()) {
		if (current === row) return top - clampedPosition();
		top += rowHeight(Number(current.dataset["transcriptEntryIndex"]));
	}
	throw new Error("Expected a mounted transcript row.");
}
function visibleAnchor() {
	const row = mountedRows().find(
		(candidate) => rowTop(candidate) + rowHeight(Number(candidate.dataset["transcriptEntryIndex"])) > 0,
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
	rowAdjustments.clear();
	tailGeometry = false;
	footerExtent = 0;
	smoothTarget = undefined;
	frames.clear();
	nextFrame = 0;
	listWidth = 800;
	restorationWindows.length = 0;
	phase = "initial";
	scrollPosition = 0;
	writes.length = 0;
	restored.length = 0;
	vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
	vi.stubGlobal("scrollTo", vi.fn());
	Object.defineProperty(Element.prototype, "scrollTop", {
		configurable: true,
		get() {
			return clampedPosition();
		},
		set(value: number) {
			if (phase === "back-router") restorationWindows.push(mountedRows().map((row) => row.dataset["perfLine"]!));
			const applied = Math.min(Math.max(0, value), Math.max(0, contentHeight() - viewportHeight));
			scrollPosition = applied;
			writes.push({phase, requested: value, applied});
		},
	});
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		if (this.matches("main")) return new DOMRect(0, 0, 800, viewportHeight);
		if (this.matches("[data-testid=virtualized-transcript]"))
			return new DOMRect(0, -clampedPosition(), listWidth, contentHeight());
		if (this instanceof HTMLElement && this.dataset["transcriptEntryIndex"] !== undefined) {
			return new DOMRect(0, rowTop(this), 800, rowHeight(Number(this.dataset["transcriptEntryIndex"])));
		}
		return new DOMRect();
	});
}

async function settleMeasurements(main: HTMLElement) {
	// Browser scroll and resize callbacks arrive after the router's rendered pass.
	for (let batch = 0; batch < 20; batch++) {
		const before = JSON.stringify({
			height: contentHeight(),
			top: main.scrollTop,
			rows: mountedRows().map((row) => row.dataset["transcriptEntryIndex"]),
		});
		await act(async () => {
			fireEvent.scroll(main);
			for (const observer of [...ControlledResizeObserver.active]) {
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
			height: contentHeight(),
			top: main.scrollTop,
			rows: mountedRows().map((row) => row.dataset["transcriptEntryIndex"]),
		});
		if (before === after) return;
	}
	throw new Error("Transcript measurement did not settle within 20 observer batches.");
}

function TranscriptRoute() {
	const {id} = useParams({strict: false});
	if (id === undefined) throw new Error("Expected a session route ID.");
	return (
		<SessionRouteIdentity routeId={id}>
			{(sessionId, _routeId, scrollKey) => <RestoredChat sessionId={sessionId} scrollKey={scrollKey} />}
		</SessionRouteIdentity>
	);
}

function RestoredChat({sessionId, scrollKey}: {sessionId: string; scrollKey: string}) {
	const position = useMainScrollRestoration(scrollKey);
	restored.push(position?.scrollY);
	return (
		<SessionChat
			sessionId={sessionId}
			initialScrollKey={scrollKey}
			shouldScrollToEnd={false}
			lines={lines}
			measurementSource={lines}
			measurementLayout="example-layout"
			toolResultMap={new Map()}
		/>
	);
}

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	Object.defineProperty(Element.prototype, "scrollTop", nativeScrollTop);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	ControlledResizeObserver.active.clear();
	if (nativeScrollTo) Object.defineProperty(Element.prototype, "scrollTo", nativeScrollTo);
	else Reflect.deleteProperty(Element.prototype, "scrollTo");
	if (nativeScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", nativeScrollIntoView);
	else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
	frames.clear();
});

it.each([
	{routeId: LOCAL_ID, strict: false, initialAtEnd: false},
	{routeId: ALIAS, strict: false, initialAtEnd: false},
	{routeId: LOCAL_ID, strict: true, initialAtEnd: false},
	{routeId: ALIAS, strict: true, initialAtEnd: false},
	{routeId: LOCAL_ID, strict: false, initialAtEnd: true},
	{routeId: ALIAS, strict: false, initialAtEnd: true},
])(
	"restores the same visible transcript record after New/Back on $routeId with StrictMode=$strict and initialAtEnd=$initialAtEnd",
	async ({routeId, strict, initialAtEnd}) => {
		installGeometry();
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(performance.now()), 0),
		);
		vi.stubGlobal("cancelAnimationFrame", window.clearTimeout.bind(window));
		const root = createRootRoute({
			component: () => (
				<main style={{overflowY: "auto"}} data-testid="main" data-scroll-restoration-id="main">
					<Outlet />
				</main>
			),
		});
		const transcript = createRoute({getParentRoute: () => root, path: "/session/$id", component: TranscriptRoute});
		const home = createRoute({getParentRoute: () => root, path: "/", component: () => <p>New session</p>});
		const router = createRouter({
			routeTree: root.addChildren([transcript, home]),
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
		const main = await screen.findByTestId("main");
		Object.defineProperty(main, "clientHeight", {configurable: true, value: viewportHeight});
		Object.defineProperty(main, "scrollHeight", {configurable: true, get: contentHeight});
		if (initialAtEnd)
			await act(async () => {
				main.scrollTop = main.scrollHeight - main.clientHeight;
				fireEvent.scroll(main);
			});
		await settleMeasurements(main);
		phase = "user-scroll";
		await act(async () => {
			main.scrollTop = initialAtEnd ? main.scrollHeight - main.clientHeight : 8000;
			fireEvent.scroll(main);
		});
		await settleMeasurements(main);
		await act(async () => {
			main.scrollTop -= 480;
			fireEvent.scroll(main);
		});
		await settleMeasurements(main);
		const before = {scrollTop: main.scrollTop, anchor: visibleAnchor()};
		const beforeRows = mountedRows().map((row) => row.dataset["perfLine"]!);
		phase = "leave";
		await act(() => router.navigate({to: "/"}));
		phase = "back-router";
		await act(async () => {
			router.history.back();
		});
		await vi.waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe(`/session/${routeId}`));
		const routerWrites = writes.filter((write) => write.phase === "back-router");
		const restoredOffset = restored.at(-1);
		phase = "back-measurement";
		await settleMeasurements(main);
		expect(restorationWindows).toStrictEqual([beforeRows]);
		// The router restores the saved offset; measurement must not subsequently shift its visible record.
		expect({
			restoredOffset,
			routerWrites,
			measurementWrites: writes.filter((write) => write.phase === "back-measurement"),
			before,
			after: {scrollTop: main.scrollTop, anchor: visibleAnchor()},
		}).toStrictEqual(
			initialAtEnd
				? {
						restoredOffset: 11770,
						routerWrites: [{phase: "back-router", requested: 11770, applied: 11770}],
						measurementWrites: [],
						before: {scrollTop: 11770, anchor: {record: "72", top: -170}},
						after: {scrollTop: 11770, anchor: {record: "72", top: -170}},
					}
				: {
						restoredOffset: 7490,
						routerWrites: [{phase: "back-router", requested: 7490, applied: 7490}],
						measurementWrites: [],
						before: {scrollTop: 7490, anchor: {record: "46", top: -150}},
						after: {scrollTop: 7490, anchor: {record: "46", top: -150}},
					},
		);
	},
);

function guardChat(source: object, layout = "example-layout", transcriptLines = lines, toolResultMap = new Map()) {
	return (
		<main style={{overflowY: "auto"}} data-testid="main">
			<SessionChat
				sessionId={LOCAL_ID}
				initialScrollKey="example-guard-visit"
				lines={transcriptLines}
				toolResultMap={toolResultMap}
				measurementSource={source}
				measurementLayout={layout}
				shouldScrollToEnd={false}
			/>
		</main>
	);
}

async function learnGuardMeasurements() {
	const main = screen.getByTestId("main");
	Object.defineProperty(main, "scrollHeight", {configurable: true, get: contentHeight});
	Object.defineProperty(main, "clientHeight", {configurable: true, value: viewportHeight});
	await settleMeasurements(main);
	await act(async () => {
		main.scrollTop = 8000;
		fireEvent.scroll(main);
	});
	await settleMeasurements(main);
	return main;
}

it.each(["width-return", "source-return", "source-away", "layout-away", "width-away"] as const)(
	"discards unsafe retained geometry after %s",
	async (change) => {
		installGeometry();
		const read = vi.spyOn(measurements, "readTranscriptMeasurements");
		const remember = vi.spyOn(measurements, "rememberTranscriptMeasurements");
		const source = {};
		const changedSource = {};
		const view = render(guardChat(source));
		const main = await learnGuardMeasurements();
		if (change === "width-return") {
			listWidth = 640;
			await settleMeasurements(main);
			listWidth = 800;
			await settleMeasurements(main);
		}
		if (change === "source-return") {
			view.rerender(guardChat(changedSource));
			view.rerender(guardChat(source));
		}
		view.unmount();
		const saved = remember.mock.calls.map(([, value]) => ({width: value.width, rows: value.heights.size}));
		read.mockClear();
		if (change === "width-away") listWidth = 640;
		render(
			guardChat(
				change === "source-away" ? changedSource : source,
				change === "layout-away" ? "example-larger-font" : "example-layout",
			),
		);
		const recovered = read.mock.results.map((result) =>
			result.value === undefined ? undefined : {width: result.value.width, rows: result.value.heights.size},
		);
		// Before ResizeObserver runs, an incompatible visit uses the same estimated geometry as a fresh visit.
		const geometry = {
			before: spacerHeight("before"),
			after: spacerHeight("after"),
			rows: mountedRows().map((row) => row.dataset["perfLine"]),
		};
		expect({saved, recovered, geometry}).toStrictEqual({
			saved: change === "width-return" || change === "source-return" ? [] : [{width: 800, rows: 9}],
			recovered: [change === "width-away" ? {width: 800, rows: 9} : undefined],
			geometry: {before: 7360, after: 3840, rows: ["46", "48", "50", "52", "54"]},
		});
	},
);

it("resets virtual measurements when the active layout changes", async () => {
	installGeometry();
	const source = {};
	const view = render(guardChat(source));
	await learnGuardMeasurements();
	const measured = {before: spacerHeight("before"), after: spacerHeight("after")};
	view.rerender(guardChat(source, "example-larger-font"));
	const reset = {before: spacerHeight("before"), after: spacerHeight("after")};
	expect({measured, reset}).toStrictEqual({
		measured: {before: 7330, after: 3840},
		reset: {before: 7360, after: 3840},
	});
});

it("does not retain expanded row heights after a disclosure is opened and closed", async () => {
	installGeometry();
	const records = [
		{type: "user", uuid: "example-user-100", message: {role: "user", content: "Inspect the fabricated file."}},
		{
			type: "assistant",
			uuid: "example-assistant-100",
			parentUuid: "example-user-100",
			message: {
				role: "assistant",
				content: [{type: "tool_use", id: "example-tool-100", name: "Grep", input: {pattern: "example"}}],
			},
		},
		{
			type: "user",
			uuid: "example-result-100",
			parentUuid: "example-assistant-100",
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: "example-tool-100", content: "1 example match"}],
			},
		},
	];
	const transcript = processTranscript(records);
	const remember = vi.spyOn(measurements, "rememberTranscriptMeasurements");
	const view = render(guardChat(records, "example-layout", transcript.lines, transcript.toolResultMap));
	const main = screen.getByTestId("main");
	await settleMeasurements(main);
	const control = view.container.querySelector('[role="button"][aria-expanded]')!;
	fireEvent.click(control);
	const opened = control.getAttribute("aria-expanded");
	view.rerender(guardChat(records, "example-larger-font", transcript.lines, transcript.toolResultMap));
	const retained = view.container.querySelector('[role="button"][aria-expanded]')!;
	const afterLayout = retained.getAttribute("aria-expanded");
	fireEvent.click(retained);
	const closed = retained.getAttribute("aria-expanded");
	await settleMeasurements(main);
	view.unmount();
	expect({opened, afterLayout, closed, saves: remember.mock.calls}).toStrictEqual({
		opened: "true",
		afterLayout: "true",
		closed: "false",
		saves: [],
	});
});

it("rejects geometry after an independent compact-summary disclosure changes", async () => {
	installGeometry();
	const records = [
		{
			type: "user",
			uuid: "example-compact-100",
			isCompactSummary: true,
			message: {role: "user", content: "Fabricated compact summary"},
		},
	];
	const transcript = processTranscript(records);
	const remember = vi.spyOn(measurements, "rememberTranscriptMeasurements");
	const view = render(guardChat(records, "example-layout", transcript.lines, transcript.toolResultMap));
	const main = screen.getByTestId("main");
	await settleMeasurements(main);
	const control = screen.getByRole("button", {name: "Compacted conversation"});
	fireEvent.click(control);
	const expanded = control.getAttribute("aria-expanded");
	await settleMeasurements(main);
	view.unmount();
	expect({expanded, saves: remember.mock.calls}).toStrictEqual({expanded: "true", saves: []});
});

// T24 regression drafts: no execution yet. Geometry uses actual mounted rows plus an explicit footer extent.
// Smooth animation interruption is modeled here; confirm its ordering in the independent browser control.
function TailFixture({fresh, visit}: {fresh: boolean; visit: string}) {
	const anchor = useRef<HTMLDivElement>(null);
	return (
		<main style={{overflowY: "auto"}} data-testid="main">
			<div ref={anchor}>
				<SessionChat
					sessionId={LOCAL_ID}
					initialScrollKey={visit}
					lines={lines}
					toolResultMap={new Map()}
					shouldScrollToEnd={fresh}
				/>
				<div data-testid="test-footer">
					<SessionDock anchorRef={anchor}>
						<p>Fabricated composer footer</p>
					</SessionDock>
				</div>
			</div>
		</main>
	);
}
function installTailGeometry(footer: number) {
	installGeometry();
	tailGeometry = true;
	footerExtent = footer;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: function (this: Element) {
			const main = document.querySelector("main")!;
			// SessionChat's sentinel is before footer content. This is intentionally not total scrollHeight.
			main.scrollTop = contentHeight() - footerExtent - viewportHeight;
		},
	});
	Object.defineProperty(Element.prototype, "scrollTo", {
		configurable: true,
		value: function (this: Element, options: ScrollToOptions) {
			if (options.behavior === "smooth") smoothTarget = options.top ?? this.scrollTop;
			else this.scrollTop = options.top ?? this.scrollTop;
		},
	});
}
async function flushTailFrame(main: HTMLElement) {
	await act(async () => {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(performance.now());
	});
	await act(async () => fireEvent.scroll(main));
}
async function deliverTailMeasurements(main: HTMLElement) {
	await act(async () => {
		for (const observer of [...ControlledResizeObserver.active]) {
			const observations = [...observer.elements]
				.filter((element) => element.isConnected)
				.map((target) => ({
					target,
					contentRect: target.getBoundingClientRect(),
					borderBoxSize: [{blockSize: target.getBoundingClientRect().height, inlineSize: listWidth}],
					contentBoxSize: [],
					devicePixelContentBoxSize: [],
				}));
			observer.callback(observations, observer as unknown as ResizeObserver);
		}
	});
	// Native scrolling from clamping/measurement commits is observed before the queued follow frame.
	await act(async () => fireEvent.scroll(main));
}
async function settleTail(main: HTMLElement) {
	for (let batch = 0; batch < 20; batch++) {
		const before = JSON.stringify({
			height: contentHeight(),
			top: main.scrollTop,
			rows: mountedRows().map((row) => row.dataset["perfLine"]),
		});
		await deliverTailMeasurements(main);
		await flushTailFrame(main);
		const after = JSON.stringify({
			height: contentHeight(),
			top: main.scrollTop,
			rows: mountedRows().map((row) => row.dataset["perfLine"]),
		});
		if (before === after && frames.size === 0) return;
	}
	throw new Error("Tail geometry did not settle in twenty deterministic batches.");
}
function tailDistance(main: HTMLElement) {
	return contentHeight() - main.clientHeight - main.scrollTop;
}
function shrinkAboveAnchor(pixels: number) {
	const row = mountedRows().find(
		(candidate) => rowTop(candidate) + rowHeight(Number(candidate.dataset["transcriptEntryIndex"])) <= 0,
	);
	if (!row) throw new Error("Expected a mounted row entirely above the visible anchor.");
	const index = Number(row.dataset["transcriptEntryIndex"]);
	rowAdjustments.set(index, (rowAdjustments.get(index) ?? 0) - pixels);
	return index;
}
async function mountTail(fresh: boolean, visit: string) {
	render(<TailFixture fresh={fresh} visit={visit} />);
	const main = screen.getByTestId("main");
	Object.defineProperty(main, "clientHeight", {configurable: true, value: viewportHeight});
	Object.defineProperty(main, "scrollHeight", {configurable: true, get: contentHeight});
	await flushTailFrame(main);
	await flushTailFrame(main);
	await settleTail(main);
	return main;
}

it("keeps a fresh end-follow visit at the true end after a row above the anchor shrinks by 64px", async () => {
	installTailGeometry(0);
	const main = await mountTail(true, "example-fresh-tail-100");
	// Establish a fully measured end before the isolated late resize.
	await act(async () => {
		main.scrollTop = contentHeight();
		fireEvent.scroll(main);
	});
	await settleTail(main);
	const before = tailDistance(main);
	phase = "tail-shrink";
	const changedRow = shrinkAboveAnchor(64);
	await deliverTailMeasurements(main);
	await flushTailFrame(main);
	await settleTail(main);
	expect({
		before,
		after: tailDistance(main),
		changedRow,
		writes: writes.filter((write) => write.phase === "tail-shrink"),
	}).toStrictEqual({
		before: 0,
		after: 0,
		changedRow: 38,
		writes: [
			{phase: "tail-shrink", requested: 13106, applied: 12506},
			{phase: "tail-shrink", requested: 13106, applied: 12506},
		],
	});
});

it("the actual bottom button targets the full static extent including content after the chat sentinel", async () => {
	installTailGeometry(120);
	const main = await mountTail(false, "example-static-button-100");
	await act(async () => {
		main.scrollTop = contentHeight() - viewportHeight - 600;
		fireEvent.scroll(main);
	});
	await settleTail(main);
	const extent = contentHeight();
	fireEvent.click(screen.getByRole("button", {name: "Scroll to bottom"}));
	const target = smoothTarget;
	if (target === undefined) throw new Error("Expected actual SessionDock smooth target.");
	scrollPosition = Math.min(target, contentHeight() - viewportHeight);
	smoothTarget = undefined;
	await act(async () => fireEvent.scroll(main));
	expect({target, extent, distance: tailDistance(main)}).toStrictEqual({
		target: 13340,
		extent: 13340,
		distance: 0,
	});
});

it.each([false, true])(
	"preserves the reader's record after shrinking above an away-from-bottom visit (fresh=%s)",
	async (fresh) => {
		installTailGeometry(0);
		const main = await mountTail(fresh, `example-away-tail-${fresh}`);
		await act(async () => {
			main.scrollTop = contentHeight() - viewportHeight - 1000;
			fireEvent.wheel(main, {deltaY: -1000});
			fireEvent.scroll(main);
		});
		await settleTail(main);
		const anchor = mountedRows().find(
			(row) => rowTop(row) <= 0 && rowTop(row) + rowHeight(Number(row.dataset["transcriptEntryIndex"])) > 0,
		)!;
		const before = {
			index: Number(anchor.dataset["transcriptEntryIndex"]),
			top: rowTop(anchor),
			distance: tailDistance(main),
		};
		phase = "away-shrink";
		const changedRow = shrinkAboveAnchor(64);
		await deliverTailMeasurements(main);
		await flushTailFrame(main);
		await settleTail(main);
		const currentAnchor = mountedRows().find(
			(row) => Number(row.dataset["transcriptEntryIndex"]) === before.index,
		)!;
		expect({
			before,
			after: {
				index: Number(currentAnchor.dataset["transcriptEntryIndex"]),
				top: rowTop(currentAnchor),
				distance: tailDistance(main),
			},
			changedRow,
			writes: writes.filter((write) => write.phase === "away-shrink"),
		}).toStrictEqual(
			fresh
				? {
						before: {index: 36, top: -50, distance: 1000},
						after: {index: 36, top: -50, distance: 1000},
						changedRow: 35,
						writes: [{phase: "away-shrink", requested: 11586, applied: 11586}],
					}
				: {
						before: {index: 35, top: 0, distance: 1140},
						after: {index: 35, top: 0, distance: 1140},
						changedRow: 33,
						writes: [{phase: "away-shrink", requested: 11116, applied: 11116}],
					},
		);
	},
);
