// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider, useSettings} from "../src/components/settings-provider";
import {SessionTitlebar} from "../src/components/session-titlebar";
import {ToastProvider} from "../src/components/toast";
import {useTranscriptModeShortcut} from "../src/hooks/use-session-transcript-mode";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {sessionOpenInQueryOptions, type SessionDetailData} from "../src/lib/api/sessions";
import {getSessionMenuItems, transcriptViewMenuItem, type SessionMenuSession} from "../src/lib/session-menu-items";
import {
	loadTranscriptViewNudge,
	recordTranscriptViewPick,
	saveTranscriptViewNudge,
	TRANSCRIPT_MODE_STORAGE_KEY,
	TRANSCRIPT_VIEW_NUDGE_STORAGE_KEY,
} from "../src/lib/transcript-mode";
import {installLocalStorage} from "./fake-storage";

const SEPARATOR = {kind: "separator"};

describe("transcriptViewMenuItem", () => {
	it("offers Normal, Thinking and Verbose radios with the current mode checked", () => {
		expect(transcriptViewMenuItem({mode: "normal", defaultMode: "normal", hasThinking: true})).toStrictEqual({
			kind: "item",
			id: "transcript-view",
			label: "Transcript view",
			submenu: [
				{
					kind: "item",
					id: "transcript-mode",
					label: "Normal",
					transcriptMode: "normal",
					checked: true,
				},
				{
					kind: "item",
					id: "transcript-mode",
					label: "Thinking",
					transcriptMode: "thinking",
					checked: false,
				},
				{
					kind: "item",
					id: "transcript-mode",
					label: "Verbose",
					transcriptMode: "verbose",
					checked: false,
				},
			],
		});
	});

	it("drops Thinking when the session has none", () => {
		const item = transcriptViewMenuItem({
			mode: "verbose",
			defaultMode: "verbose",
			hasThinking: false,
		});
		expect(
			item.submenu?.map((entry) =>
				entry.kind === "item" ? `${entry.label}${entry.checked === true ? " ✓" : ""}` : "---",
			),
		).toStrictEqual(["Normal", "Verbose ✓"]);
	});

	it("adds a separator and Make {Mode} the default when the mode differs from the default", () => {
		const item = transcriptViewMenuItem({
			mode: "verbose",
			defaultMode: "normal",
			hasThinking: true,
		});
		expect(item.submenu?.slice(3)).toStrictEqual([
			SEPARATOR,
			{kind: "item", id: "make-default-transcript-mode", label: "Make Verbose the default"},
		]);
	});
});

describe("getSessionMenuItems with a transcript view", () => {
	const base: SessionMenuSession = {
		title: "Fix the flaky test",
		pinned: false,
		readState: "read",
		archived: false,
		prUrl: null,
		hasLivePane: false,
		forkDisabledReason: null,
		cwd: null,
		bridgeSessionId: null,
		transcriptView: {mode: "normal", defaultMode: "normal", hasThinking: false},
	};
	const ids = (surface: "row" | "header") =>
		getSessionMenuItems(base, new Set(["rename", "archive"]), {surface}).map((entry) =>
			entry.kind === "item" ? entry.id : "|",
		);

	it("places Transcript view ▸ between the actions and Archive, in the header only", () => {
		expect({header: ids("header"), row: ids("row")}).toStrictEqual({
			header: ["rename", "|", "transcript-view", "|", "archive"],
			row: ["rename", "|", "archive"],
		});
	});
});

describe("recordTranscriptViewPick", () => {
	it("records the first pick of a non-default mode without nudging", () => {
		expect(recordTranscriptViewPick({}, {sessionId: "a", mode: "verbose", defaultMode: "normal"})).toStrictEqual({
			state: {verbose: "a"},
			due: false,
		});
	});

	it("nudges when the same mode is picked in a second session, then marks it shown", () => {
		expect(
			recordTranscriptViewPick({verbose: "a"}, {sessionId: "b", mode: "verbose", defaultMode: "normal"}),
		).toStrictEqual({state: {verbose: true}, due: true});
	});

	it("does not nudge again in the same session, after it was shown, or for the default", () => {
		expect([
			recordTranscriptViewPick({verbose: "a"}, {sessionId: "a", mode: "verbose", defaultMode: "normal"}),
			recordTranscriptViewPick({verbose: true}, {sessionId: "c", mode: "verbose", defaultMode: "normal"}),
			recordTranscriptViewPick({thinking: "a"}, {sessionId: "b", mode: "thinking", defaultMode: "thinking"}),
		]).toStrictEqual([
			{state: {verbose: "a"}, due: false},
			{state: {verbose: true}, due: false},
			{state: {thinking: "a"}, due: false},
		]);
	});

	it("round-trips through storage and ignores garbage", () => {
		const storage = installLocalStorage();
		saveTranscriptViewNudge({verbose: true, thinking: "a"}, storage);
		const saved = loadTranscriptViewNudge(storage);
		storage.setItem(TRANSCRIPT_VIEW_NUDGE_STORAGE_KEY, '{"summary":"a"}');
		const garbage = loadTranscriptViewNudge(storage);
		expect({saved, garbage}).toStrictEqual({
			saved: {verbose: true, thinking: "a"},
			garbage: {},
		});
	});
});

const TITLE = "Sync fork with upstream";

function detail(): SessionDetailData {
	return {
		title: TITLE,
		projectName: "avalonlogs",
		projectId: "-Users-alice-projects-avalonlogs",
		homeRoot: "/Users/alice",
		imageRoots: [],
		archived: false,
		summary: null,
		projectPath: "/Users/alice/projects/avalonlogs",
		gitBranch: null,
		cwd: "/Users/alice/projects/avalonlogs",
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
}

class TestResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function Harness({sessionId}: {sessionId: string}) {
	const transcriptView = useTranscriptModeShortcut(sessionId, {hasThinking: true});
	const {settings} = useSettings();
	return (
		<>
			<output aria-label="state">{`${transcriptView.mode}/${settings.verbosity}`}</output>
			<SessionTitlebar sessionId={sessionId} data={detail()} isActive={false} transcriptView={transcriptView} />
		</>
	);
}

let storage: ReturnType<typeof installLocalStorage>;

async function renderHarness(sessionId: string) {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false, staleTime: Infinity, gcTime: Infinity}},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	queryClient.setQueryData(sessionOpenInQueryOptions(sessionId).queryKey, {
		cwd: null,
		bridgeSessionId: null,
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ToastProvider>
						<Harness sessionId={sessionId} />
					</ToastProvider>
				</SettingsProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [`/session/${sessionId}`]}),
	});
	await router.load();
	const result = render(<RouterProvider router={router} />);
	await flush();
	return result;
}

async function openTranscriptView() {
	fireEvent.click(screen.getByRole("button", {name: `More options for ${TITLE}`}));
	await flush();
	fireEvent.click(screen.getByRole("menuitem", {name: "Transcript view"}));
	await flush();
}

async function pick(label: string) {
	await openTranscriptView();
	fireEvent.click(screen.getByRole("menuitemradio", {name: label}));
	await flush();
}

function state(): string | null {
	return screen.getByLabelText("state").textContent;
}

beforeEach(() => {
	storage = installLocalStorage();
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ok: true})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("header Transcript view submenu", () => {
	it("checks the session's mode and switches it from a radio", async () => {
		await renderHarness("menu-radio-a");
		await openTranscriptView();
		const checked = screen
			.getAllByRole("menuitemradio")
			.map((item) => `${item.textContent}:${item.getAttribute("aria-checked")}`);
		fireEvent.click(screen.getByRole("menuitemradio", {name: "Verbose"}));
		await flush();
		expect({checked, after: state()}).toStrictEqual({
			checked: ["Normal:true", "Thinking:false", "Verbose:false"],
			after: "verbose/normal",
		});
	});

	it("makes the session's mode the default, clears its override and toasts", async () => {
		await renderHarness("menu-default-a");
		await pick("Thinking");
		await openTranscriptView();
		fireEvent.click(screen.getByRole("menuitem", {name: "Make Thinking the default"}));
		await flush();
		const overrides = JSON.parse(storage.getItem(TRANSCRIPT_MODE_STORAGE_KEY) ?? "{}");
		expect({
			state: state(),
			override: overrides["menu-default-a"] ?? null,
			toast: screen.getByText("Thinking is now the default view.").textContent,
		}).toStrictEqual({
			state: "thinking/thinking",
			override: null,
			toast: "Thinking is now the default view.",
		});
	});

	it("nudges once the same non-default mode is picked in a second session", async () => {
		const first = await renderHarness("menu-nudge-a");
		await pick("Verbose");
		const nudgedFirst = screen.queryByText("Make Verbose your default view?") !== null;
		first.unmount();

		await renderHarness("menu-nudge-b");
		await pick("Verbose");
		fireEvent.click(screen.getByRole("button", {name: "Make default"}));
		await flush();
		expect({
			nudgedFirst,
			state: state(),
			confirmed: screen.queryByText("Verbose is now the default view.") !== null,
			nudge: JSON.parse(storage.getItem(TRANSCRIPT_VIEW_NUDGE_STORAGE_KEY) ?? "null"),
		}).toStrictEqual({
			nudgedFirst: false,
			state: "verbose/verbose",
			confirmed: true,
			nudge: {verbose: true},
		});
	});
});
