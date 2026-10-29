// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionTitlebar} from "../src/components/session-titlebar";
import {ToastProvider} from "../src/components/toast";
import {
	SESSION_STICKY_HEADER_CLASS,
	TITLEBAR_ICON_BUTTON_CLASS,
	TITLEBAR_RAIL_TOGGLE_CLASS,
} from "../src/components/titlebar-classes";
import {useTitlebarHiddenCount} from "../src/components/titlebar-fold-context";
import {foldBudget, splitPanes} from "../src/lib/titlebar-fold";
import {topLeftClearance} from "../src/lib/top-left-clearance";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {sessionOpenInQueryOptions, type SessionDetailData} from "../src/lib/api/sessions";
import {__unreadStoreTesting} from "../src/lib/unread-store";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const PARENT_ID = "0a1b2c3d-1111-4222-8333-944445555666";
const FORKED_FROM_ID = "fedcba98-1111-4222-8333-944445555666";
const TITLE = "Sync fork with upstream";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";

const baseDetail: SessionDetailData = {
	title: TITLE,
	projectName: "avalonlogs",
	projectId: "-Users-alice-projects-avalonlogs",
	homeRoot: "/Users/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: PROJECT_PATH,
	gitBranch: "alice/sync-upstream",
	cwd: PROJECT_PATH,
	gitSha: null,
	gitClean: null,
	messageCount: 4,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: 3,
		lastViewedMessageIndex: 3,
		reviewTargetMessageIndex: 3,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

const fullDetail: SessionDetailData = {
	...baseDetail,
	parentSessionId: PARENT_ID,
	attributionAgent: "code-reviewer",
	model: "claude-haiku-4-5-20251001",
	entrypoint: "sdk-ts",
	sessionKind: "background",
	teamNames: ["platform"],
	forkedFromSessionId: FORKED_FROM_ID,
	pr: {
		number: 42,
		url: "https://github.com/alice/avalonlogs/pull/42",
		repository: "alice/avalonlogs",
	},
};

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const openMock = vi.fn<typeof window.open>();

type ResizeCallback = () => void;
const resizeCallbacks: ResizeCallback[] = [];

class TestResizeObserver {
	constructor(callback: ResizeCallback) {
		resizeCallbacks.push(callback);
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

/**
 * A flex-row model of the titlebar for jsdom, which has no layout: the trail
 * is its 24px padding plus 30px per button, the lead is a 40px spacer and
 * chevron, a 300px title and the pills (80px, or 20px compact), and the title
 * truncates to whatever the trail leaves.
 */
const TITLE_NATURAL_PX = 300;
const LEAD_FIXED_PX = 40;
const STEP_PX = 30;
let rowPx = 1200;

function rowGeometry(root: Element) {
	const compact = root.querySelector("[data-titlebar-lead]")?.hasAttribute("data-pills-compact") ?? false;
	const pillsPx = compact ? 20 : 80;
	const trailPx =
		24 + STEP_PX * (root.querySelector("[data-titlebar-trail]")?.querySelectorAll("button").length ?? 0);
	const leadPx = Math.max(
		LEAD_FIXED_PX + pillsPx,
		Math.min(LEAD_FIXED_PX + TITLE_NATURAL_PX + pillsPx, rowPx - trailPx),
	);
	return {leadPx, trailPx, titlePx: leadPx - LEAD_FIXED_PX - pillsPx};
}

function modelRect(element: Element): DOMRect | null {
	const root = element.closest("[data-testid=session-titlebar]");
	if (root === null) return null;
	const {leadPx, trailPx, titlePx} = rowGeometry(root);
	if (element === root) return DOMRect.fromRect({x: 0, y: 0, width: rowPx, height: 32});
	if (element.hasAttribute("data-titlebar-lead")) return DOMRect.fromRect({x: 0, y: 0, width: leadPx, height: 32});
	if (element.hasAttribute("data-titlebar-trail"))
		return DOMRect.fromRect({x: rowPx - trailPx, y: 0, width: trailPx, height: 32});
	if (element.hasAttribute("data-titlebar-title")) return DOMRect.fromRect({x: 7, y: 0, width: titlePx, height: 24});
	return null;
}

const geometryOverrides: Array<[string, PropertyDescriptor | undefined]> = [];

/** Shadows an Element geometry getter on HTMLElement.prototype, falling back to jsdom's for elements the model doesn't cover. */
function overrideGetter(
	key: "clientWidth" | "scrollWidth" | "offsetWidth",
	get: (element: HTMLElement) => number | null,
) {
	const inherited =
		Object.getOwnPropertyDescriptor(HTMLElement.prototype, key) ??
		Object.getOwnPropertyDescriptor(Element.prototype, key);
	geometryOverrides.push([key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)]);
	Object.defineProperty(HTMLElement.prototype, key, {
		configurable: true,
		get(this: HTMLElement) {
			return get(this) ?? inherited?.get?.call(this);
		},
	});
}

function installRowModel() {
	rowPx = 1200;
	const originalRect = Element.prototype.getBoundingClientRect;
	geometryOverrides.push([
		"getBoundingClientRect",
		Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect"),
	]);
	Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
		configurable: true,
		writable: true,
		value(this: HTMLElement) {
			return modelRect(this) ?? originalRect.call(this);
		},
	});
	overrideGetter("clientWidth", (element) => {
		if (element.hasAttribute("data-titlebar-title")) return modelRect(element)?.width ?? 0;
		return element.matches("[data-testid=session-titlebar]") ? rowPx : null;
	});
	overrideGetter("scrollWidth", (element) => (element.hasAttribute("data-titlebar-title") ? TITLE_NATURAL_PX : null));
	overrideGetter("offsetWidth", (element) =>
		element.parentElement?.hasAttribute("data-titlebar-toggles") ? STEP_PX : null,
	);
}

function uninstallRowModel() {
	for (const [key, descriptor] of geometryOverrides.splice(0).toReversed()) {
		if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
		else Object.defineProperty(HTMLElement.prototype, key, descriptor);
	}
}

function resizeTitlebar(width: number) {
	rowPx = width;
	act(() => {
		for (const callback of resizeCallbacks) callback();
	});
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

async function renderTitlebar(
	data: SessionDetailData,
	slots: {withSlots?: boolean; viewOptions?: ReactNode; paneToggles?: ReactNode; railToggleFoldable?: boolean} = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
			mutations: {retry: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
		cwd: data.cwd,
		bridgeSessionId: null,
		remoteControl: null,
		remoteHistory: null,
		githubUrl: null,
	});
	const content: ReactNode = (
		<SessionTitlebar
			sessionId={SESSION_ID}
			data={data}
			isActive={false}
			{...(slots.withSlots
				? {
						paneToggles: (
							<button type="button" aria-label="Changes">
								C
							</button>
						),
						viewOptions: (
							<button type="button" aria-label="View options">
								V
							</button>
						),
					}
				: {})}
			{...(slots.viewOptions === undefined ? {} : {viewOptions: slots.viewOptions})}
			{...(slots.paneToggles === undefined ? {} : {paneToggles: slots.paneToggles})}
			{...(slots.railToggleFoldable === undefined ? {} : {railToggleFoldable: slots.railToggleFoldable})}
		/>
	);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>{content}</ToastProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [`/session/${SESSION_ID}`]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await flush();
	return screen.getByTestId("session-titlebar");
}

function accessibleName(element: Element): string {
	return element.getAttribute("aria-label") ?? element.textContent;
}

function controlsIn(container: Element): string[] {
	return [...container.querySelectorAll("button, a")].map(accessibleName);
}

beforeEach(() => {
	resizeCallbacks.length = 0;
	installRowModel();
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("open", openMock);
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => Promise.resolve(Response.json({ok: true})));
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	openMock.mockReset();
	openMock.mockReturnValue(null);
	Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(async () => Promise.resolve());
});

afterEach(() => {
	cleanup();
	uninstallRowModel();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("SessionTitlebar layout", () => {
	it("orders the lead (parent, title, chevron, origin pills) before the trail slots", async () => {
		const titlebar = await renderTitlebar(fullDetail, {withSlots: true});
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		const trail = titlebar.querySelector("[data-titlebar-trail]");
		if (lead === null || trail === null) throw new Error("titlebar lead/trail missing");

		expect({
			height: titlebar.classList.contains("h-8"),
			lead: controlsIn(lead),
			pills: [...lead.querySelectorAll("[data-origin-pill]")].map(
				(pill) => `${pill.getAttribute("data-origin-pill")}:${pill.textContent}`,
			),
			trail: controlsIn(trail),
			trailChildren: [...trail.children].map((child) => child.getAttribute("aria-label")),
			trailFollowsLead: Boolean(lead.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING),
		}).toStrictEqual({
			height: true,
			lead: [
				"Parent session",
				`${TITLE}, rename session`,
				`More options for ${TITLE}`,
				"Repository alice/avalonlogs",
				`Forked from ${FORKED_FROM_ID.slice(0, 8)}`,
			],
			pills: [
				"repository:avalonlogs",
				"model:Haiku 4.5",
				"entrypoint:sdk-ts",
				"kind:background",
				"agent:code-reviewer",
				"team:platform",
				`forked-from:Forked from ${FORKED_FROM_ID.slice(0, 8)}`,
			],
			trail: ["Changes", "View options"],
			trailChildren: ["Changes", "View options"],
			trailFollowsLead: true,
		});
	});

	it("draws no environment glyph, as upstream's titlebar shows one only on a new-session draft", async () => {
		await renderTitlebar(baseDetail);

		expect(screen.queryByRole("button", {name: "Environment"})).toBeNull();
	});

	it("leaves out the back pill and optional badges for a plain CLI session", async () => {
		const titlebar = await renderTitlebar({...baseDetail, entrypoint: "cli"});
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		if (lead === null) throw new Error("titlebar lead missing");

		expect({
			lead: controlsIn(lead),
			pills: [...lead.querySelectorAll("[data-origin-pill]")].map((pill) =>
				pill.getAttribute("data-origin-pill"),
			),
			allSessions: screen.queryByText("All Sessions"),
		}).toStrictEqual({
			lead: [`${TITLE}, rename session`, `More options for ${TITLE}`],
			pills: [],
			allSessions: null,
		});
	});

	it("opens the header menu from the chevron", async () => {
		await renderTitlebar(baseDetail);
		fireEvent.click(screen.getByRole("button", {name: `More options for ${TITLE}`}));
		await flush();

		expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toStrictEqual([
			"Open in",
			"RenameR",
			"ForkF",
			"Copy linkC",
			"ArchiveA",
		]);
	});
});

describe("SessionTitlebar chrome", () => {
	it("keeps the borderless bar and omits a repository pill without known PR metadata", async () => {
		const titlebar = await renderTitlebar(baseDetail);
		const title = screen.getByRole("button", {name: `${TITLE}, rename session`});
		const headerClasses = SESSION_STICKY_HEADER_CLASS.split(" ");

		expect({
			height: titlebar.classList.contains("h-8"),
			titleType: ["text-[13px]/[19px]", "font-medium"].every((name) => title.classList.contains(name)),
			repositoryPill: titlebar.querySelector("[data-origin-pill='repository']"),
			headerBorder: headerClasses.filter((name) => /^border(-|$)/.test(name)),
			headerBottomPadding: headerClasses.filter((name) => /^(pb|py|p)-/.test(name)),
		}).toStrictEqual({
			height: true,
			titleType: true,
			repositoryPill: null,
			headerBorder: [],
			headerBottomPadding: [],
		});
	});
});

describe("SessionTitlebar title and chevron", () => {
	async function hoverTooltip(target: Element): Promise<{text: string | null; describedBy: boolean}> {
		fireEvent.pointerEnter(target);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 350);
			});
		});
		const tooltip = screen.queryByRole("tooltip");
		const result = {
			text: tooltip?.textContent ?? null,
			describedBy: tooltip !== null && target.getAttribute("aria-describedby") === tooltip.id,
		};
		fireEvent.pointerLeave(target);
		return result;
	}

	it("sizes the title and chevron as upstream's flush 24px controls", async () => {
		await renderTitlebar(baseDetail);
		const title = screen.getByRole("button", {name: `${TITLE}, rename session`});
		const chevron = screen.getByRole("button", {name: `More options for ${TITLE}`});

		expect({
			title: ["h-6", "px-1", "rounded-r5"].every((name) => title.classList.contains(name)),
			chevron: ["size-6", "rounded-r6"].every((name) => chevron.classList.contains(name)),
		}).toStrictEqual({title: true, chevron: true});
	});

	it("leads with upstream's 7px spacer at every width so the title text clears the chat card edge, landing at x=48 at 390", async () => {
		const titlebar = await renderTitlebar(baseDetail);
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		const spacer = lead?.firstElementChild;
		if (!(spacer instanceof HTMLElement)) throw new Error("titlebar lead spacer missing");
		const title = screen.getByRole("button", {name: `${TITLE}, rename session`});
		const clearance = topLeftClearance("phone")?.start ?? 0;
		const cardInset = 9;
		const rowStart = cardInset + (clearance - cardInset);
		const spacerWidth = Number(
			/^w-\[(\d+)px\]$/.exec([...spacer.classList].find((name) => name.startsWith("w-")) ?? "")?.[1],
		);
		const buttonX = rowStart + spacerWidth + (title.classList.contains("-mx-1") ? -4 : 0);

		expect({
			spacer: {tag: spacer.tagName, hidden: spacer.getAttribute("aria-hidden"), className: spacer.className},
			rowStart,
			buttonX,
			textX: buttonX + (title.classList.contains("px-1") ? 4 : 0),
		}).toStrictEqual({
			spacer: {tag: "SPAN", hidden: "true", className: "w-[7px] shrink-0"},
			rowStart: 41,
			buttonX: 44,
			textX: 48,
		});
	});

	it("shows a styled Rename tooltip on the title instead of a native title attribute", async () => {
		await renderTitlebar(baseDetail);
		const title = screen.getByRole("button", {name: `${TITLE}, rename session`});

		expect({nativeTitle: title.getAttribute("title"), tooltip: await hoverTooltip(title)}).toStrictEqual({
			nativeTitle: null,
			tooltip: {text: "Rename", describedBy: true},
		});
	});

	it("names the session in the chevron's tooltip", async () => {
		await renderTitlebar(baseDetail);
		const chevron = screen.getByRole("button", {name: `More options for ${TITLE}`});

		expect(await hoverTooltip(chevron)).toStrictEqual({text: `More options for ${TITLE}`, describedBy: true});
	});

	it("cuts a chevron tooltip title longer than 80 characters to 79 plus an ellipsis, keeping the full aria-label", async () => {
		const longTitle = `${"a".repeat(78)} bc`;
		await renderTitlebar({...baseDetail, title: longTitle});
		const chevron = screen.getByRole("button", {name: `More options for ${longTitle}`});

		expect({length: longTitle.length, tooltip: await hoverTooltip(chevron)}).toStrictEqual({
			length: 81,
			tooltip: {text: `More options for ${"a".repeat(78)}…`, describedBy: true},
		});
	});

	it("counts graphemes, not code points, when cutting the chevron tooltip", async () => {
		const family = "👨‍👩‍👧";
		const title = family.repeat(80);
		await renderTitlebar({...baseDetail, title});
		const chevron = screen.getByRole("button", {name: `More options for ${title}`});

		expect(await hoverTooltip(chevron)).toStrictEqual({text: `More options for ${title}`, describedBy: true});
	});

	it("keeps an 80-character title whole in the chevron tooltip", async () => {
		const title = "b".repeat(80);
		await renderTitlebar({...baseDetail, title});
		const chevron = screen.getByRole("button", {name: `More options for ${title}`});

		expect(await hoverTooltip(chevron)).toStrictEqual({text: `More options for ${title}`, describedBy: true});
	});
});

describe("SessionTitlebar pill collapse", () => {
	function compactState(titlebar: HTMLElement) {
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		if (lead === null) throw new Error("titlebar lead missing");
		return {
			compact: lead.hasAttribute("data-pills-compact"),
			srOnlyLabels: [...lead.querySelectorAll("[data-origin-label]")].map((label) =>
				label.classList.contains("sr-only"),
			),
		};
	}

	it("collapses the origin pills to icons when the titlebar is narrow", async () => {
		const titlebar = await renderTitlebar({
			...baseDetail,
			model: "claude-haiku-4-5-20251001",
		});
		resizeTitlebar(1200);
		const wide = compactState(titlebar);
		resizeTitlebar(420);
		const narrow = compactState(titlebar);

		expect({wide, narrow}).toStrictEqual({
			wide: {compact: false, srOnlyLabels: [false]},
			narrow: {compact: true, srOnlyLabels: [true]},
		});
	});

	it("compacts once the title truncates with no free space and re-expands only with 96px to spare, as upstream's qt", async () => {
		const titlebar = await renderTitlebar({
			...baseDetail,
			model: "claude-haiku-4-5-20251001",
		});
		resizeTitlebar(444);
		const at444 = compactState(titlebar);
		resizeTitlebar(443);
		const at443 = compactState(titlebar);
		resizeTitlebar(460);
		const at460 = compactState(titlebar);
		resizeTitlebar(500);
		const at500 = compactState(titlebar);

		expect({at444, at443, at460, at500}).toStrictEqual({
			at444: {compact: false, srOnlyLabels: [false]},
			at443: {compact: true, srOnlyLabels: [true]},
			at460: {compact: true, srOnlyLabels: [true]},
			at500: {compact: false, srOnlyLabels: [false]},
		});
	});
});

/** Stands in for SessionPaneControls: the rail toggle, Changes and Files fold as the hidden count grows. */
function FoldProbe({rail = true}: {rail?: boolean}) {
	const hiddenCount = useTitlebarHiddenCount();
	const {railToggleFolded, hiddenMainPanes} = foldBudget({railToggleFoldable: rail, hiddenCount});
	const {inline} = splitPanes(
		[
			{label: "Changes", active: false},
			{label: "Files", active: false},
		],
		hiddenMainPanes,
	);
	return (
		<>
			{rail && !railToggleFolded && <button type="button" aria-label="Hide session rail" />}
			<div data-titlebar-toggles="">
				{inline.map((pane) => (
					<button key={pane.label} type="button" aria-label={pane.label} />
				))}
			</div>
			<button type="button" aria-label="View options" />
			<output data-testid="hidden">{hiddenCount}</output>
		</>
	);
}

describe("SessionTitlebar trail fold", () => {
	function foldState(titlebar: HTMLElement) {
		const trail = titlebar.querySelector("[data-titlebar-trail]");
		if (trail === null) throw new Error("titlebar trail missing");
		return {
			hidden: Number(screen.getByTestId("hidden").textContent),
			compact: titlebar.querySelector("[data-titlebar-lead]")?.hasAttribute("data-pills-compact"),
			trail: controlsIn(trail),
		};
	}

	it("compacts the pills, then folds the rail, Changes and Files one step at a time as the title drops under 100px", async () => {
		const titlebar = await renderTitlebar(baseDetail, {paneToggles: <FoldProbe />, railToggleFoldable: true});
		resizeTitlebar(1200);
		const at1200 = foldState(titlebar);
		resizeTitlebar(500);
		const at500 = foldState(titlebar);
		resizeTitlebar(300);
		const at300 = foldState(titlebar);
		resizeTitlebar(260);
		const at260 = foldState(titlebar);
		resizeTitlebar(200);
		const at200 = foldState(titlebar);
		resizeTitlebar(1200);
		const wideAgain = foldState(titlebar);

		expect({at1200, at500, at300, at260, at200, wideAgain}).toStrictEqual({
			at1200: {hidden: 0, compact: false, trail: ["Hide session rail", "Changes", "Files", "View options"]},
			at500: {hidden: 0, compact: true, trail: ["Hide session rail", "Changes", "Files", "View options"]},
			at300: {hidden: 1, compact: true, trail: ["Changes", "Files", "View options"]},
			at260: {hidden: 2, compact: true, trail: ["Files", "View options"]},
			at200: {hidden: 7, compact: true, trail: ["View options"]},
			wideAgain: {hidden: 0, compact: false, trail: ["Hide session rail", "Changes", "Files", "View options"]},
		});
	});

	it("caps the hidden count at 6 when the trail has no rail toggle", async () => {
		await renderTitlebar(baseDetail, {paneToggles: <FoldProbe rail={false} />});
		resizeTitlebar(260);
		resizeTitlebar(200);

		expect(screen.getByTestId("hidden").textContent).toBe("6");
	});
});

describe("SessionTitlebar repository pill", () => {
	const pr = {
		number: 100,
		url: "https://example.com/alice/example-repository/pull/100",
		repository: "alice/example-repository",
	};

	it.each(["example-repository", "example-repository-with-a-long-name-that-stays-accessible"])(
		"keeps the full repository identity accessible at normal and compact widths: %s",
		async (basename) => {
			const repository = `alice/${basename}`;
			await renderTitlebar({...baseDetail, pr: {...pr, repository}});
			const trigger = screen.getByRole("button", {name: `Repository ${repository}`});
			resizeTitlebar(1200);
			const wide = {
				label: trigger.textContent,
				title: trigger.title,
				icons: trigger.querySelectorAll("svg").length,
			};
			resizeTitlebar(420);
			expect({
				wide,
				compact: {
					label: trigger.textContent,
					title: trigger.title,
					name: accessibleName(trigger),
					iconHidden: trigger.querySelector("svg")?.getAttribute("aria-hidden"),
				},
			}).toStrictEqual({
				wide: {label: basename, title: repository, icons: 0},
				compact: {label: basename, title: repository, name: `Repository ${repository}`, iconHidden: "true"},
			});
		},
	);

	it.each(["", "   ", "alice/", "alice/   "])("omits an empty repository basename: %j", async (repository) => {
		const titlebar = await renderTitlebar({...baseDetail, pr: {...pr, repository}});
		expect(titlebar.querySelector("[data-origin-pill='repository']")).toBe(null);
	});

	it("omits a malformed PR URL instead of inferring a repository from cwd", async () => {
		const titlebar = await renderTitlebar({...baseDetail, pr: {...pr, url: "not-a-url"}});
		expect(titlebar.querySelector("[data-origin-pill='repository']")).toBe(null);
	});

	it("opens by keyboard without a request and restores focus on Escape", async () => {
		await renderTitlebar({...baseDetail, pr});
		const trigger = screen.getByRole("button", {name: "Repository alice/example-repository"});
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowDown"});
		await flush();
		const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await flush();
		expect({
			items,
			requests: fetchMock.mock.calls,
			menu: screen.queryByRole("menu"),
			focused: document.activeElement === trigger,
		}).toStrictEqual({
			items: ["Open in Finder", "Copy path", "Copy branch name", "Open repository on GitHub"],
			requests: [],
			menu: null,
			focused: true,
		});
	});

	it("preserves repository, branch, path and Finder actions from the existing project menu", async () => {
		await renderTitlebar({...baseDetail, pr});
		for (const name of ["Open repository on GitHub", "Copy branch name", "Copy path", "Open in Finder"]) {
			fireEvent.click(screen.getByRole("button", {name: "Repository alice/example-repository"}));
			await flush();
			fireEvent.click(screen.getByRole("menuitem", {name}));
			await flush();
		}
		expect({
			opened: openMock.mock.calls,
			clipboard: writeText.mock.calls,
			requests: fetchMock.mock.calls,
		}).toStrictEqual({
			opened: [["https://example.com/alice/example-repository", "_blank", "noopener,noreferrer"]],
			clipboard: [["alice/sync-upstream"], [PROJECT_PATH]],
			requests: [
				[
					"/api/open-in-finder",
					{
						body: JSON.stringify({sessionId: SESSION_ID}),
						credentials: "same-origin",
						headers: {"Content-Type": "application/json"},
						method: "POST",
					},
				],
			],
		});
	});

	it("omits local actions when only the remote repository is known", async () => {
		await renderTitlebar({...baseDetail, projectPath: null, cwd: null, gitBranch: null, pr});
		fireEvent.click(screen.getByRole("button", {name: "Repository alice/example-repository"}));
		await flush();
		expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toStrictEqual([
			"Open repository on GitHub",
		]);
	});
});

describe("SessionTitlebar cost pill", () => {
	const costedDetail: SessionDetailData = {
		...baseDetail,
		costState: {
			totalCostUSD: 3.5,
			linesAdded: 120,
			linesRemoved: 30,
			apiDurationMs: 90_000,
			toolDurationMs: 12_000,
			hasUnknownModelCost: true,
			models: [
				{
					model: "claude-opus-5-5[1m]",
					costUSD: 3,
					inputTokens: 1_000,
					outputTokens: 2_000,
					cacheReadInputTokens: 30_000,
					cacheCreationInputTokens: 4_000,
					cacheCreation5mInputTokens: 3_000,
					cacheCreation1hInputTokens: 1_000,
				},
				{
					model: "claude-haiku-4-5-20251001",
					costUSD: 0.5,
					inputTokens: 10,
					outputTokens: 5,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
				},
			],
		},
	};

	it("leaves the pill out when the transcript has no cost-state", async () => {
		const titlebar = await renderTitlebar(baseDetail);

		expect(titlebar.querySelector('[data-origin-pill="cost"]')).toBe(null);
	});

	it("shows the total and opens the cost, lines and per-model breakdown", async () => {
		const titlebar = await renderTitlebar(costedDetail);
		const pill = titlebar.querySelector('[data-origin-pill="cost"]');
		fireEvent.click(screen.getByRole("button", {name: "Session cost: $3.50"}));
		await flush();

		expect({
			pill: pill?.textContent,
			rows: [...document.querySelectorAll("[data-cost-row]")].map((row) => [
				row.getAttribute("data-cost-row"),
				[...row.children].map((cell) => cell.textContent),
			]),
			note: document.querySelector("[data-cost-unknown]")?.textContent,
		}).toStrictEqual({
			pill: "$3.50",
			rows: [
				["total", ["Total cost", "$3.50"]],
				["lines", ["Lines changed", "+120 −30"]],
				["api", ["API time", "1m 30s"]],
				["tools", ["Tool time", "12.0s"]],
				["model", ["Opus 5.5", "$3.00", "1K in · 2K out · 30K cache read · 4K cache write (3K 5m, 1K 1h)"]],
				["model", ["Haiku 4.5", "$0.50", "10 in · 5 out"]],
			],
			note: "Some models have no known price, so the total is a floor.",
		});
	});
});

describe("titlebar icon button press and focus (upstream cds-btn-squish + focus shadow)", () => {
	it("squishes on press and draws the focus shadow instead of a 1px ring", () => {
		const classes = (value: string) => value.split(" ");
		const pick = (value: string) =>
			classes(value).filter(
				(c) =>
					["btn-squish", "transition-colors", "focus-visible:shadow-focus"].includes(c) ||
					c.includes("ring-1"),
			);
		expect({icon: pick(TITLEBAR_ICON_BUTTON_CLASS), rail: pick(TITLEBAR_RAIL_TOGGLE_CLASS)}).toStrictEqual({
			icon: ["btn-squish", "focus-visible:shadow-focus"],
			rail: ["btn-squish", "focus-visible:shadow-focus"],
		});
	});
});
