// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionPage} from "../src/components/session-page";
import {SettingsProvider} from "../src/components/settings-provider";
import {VERBOSITY_PRESETS, writeStoredValue} from "../src/components/settings-context";
import {objectKeys} from "../src/lib/narrow";
import {processTranscript} from "../src/lib/transcript";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {
	sessionDetailQueryOptions,
	sessionOpenInQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {__unreadStoreTesting} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {preloadSideChatPanel} from "../src/components/side-chat";
import {loadSessionPromptCards} from "../src/components/session-prompt-cards-entry";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () => {
	await Promise.all([preloadComposerSurfaces(), preloadSideChatPanel(), loadSessionPromptCards()]);
});

vi.mock(import("../src/lib/hmr-persist"), async (importOriginal) => ({
	...(await importOriginal()),
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const TITLE = "Write the novel";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";

const detail: SessionDetailData = {
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
	messageCount: 1,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: 0,
		lastViewedMessageIndex: 0,
		reviewTargetMessageIndex: 0,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

class TestResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

class TestEventSource extends EventTarget {
	readonly close = vi.fn<() => void>();
	onerror: ((event: Event) => void) | null = null;
}

class TestIntersectionObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function newQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
		cwd: PROJECT_PATH,
		bridgeSessionId: null,
		githubUrl: null,
	});
	return queryClient;
}

async function renderInRouter(queryClient: QueryClient, content: ReactNode) {
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ClaudeEventsProvider>
						<ToastProvider>{content}</ToastProvider>
					</ClaudeEventsProvider>
				</SettingsProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [`/session/${SESSION_ID}`]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByTestId("session-titlebar");
	await flush();
}

// The `649c3fab` shape: "do chapter 2" was pulled back and "do chapter 3"
// re-sent onto the same parent, so the server hides the older prompt.
const START_INDEX = 448;
const records: Record<string, unknown>[] = [
	{
		type: "user",
		uuid: "u1",
		parentUuid: null,
		sessionId: SESSION_ID,
		timestamp: "2026-09-28T10:00:00.000Z",
		message: {role: "user", content: "Fabricated prompt: do chapter 1"},
	},
	{
		type: "assistant",
		uuid: "a1",
		parentUuid: "u1",
		sessionId: SESSION_ID,
		timestamp: "2026-09-28T10:00:05.000Z",
		message: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude-opus-4-1",
			content: [{type: "text", text: "Fabricated reply: chapter 1 is done."}],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: {input_tokens: 1, output_tokens: 1},
		},
	},
	{
		type: "user",
		uuid: "u2",
		parentUuid: "a1",
		sessionId: SESSION_ID,
		timestamp: "2026-09-28T10:01:00.000Z",
		message: {role: "user", content: "Fabricated prompt: do chapter 2"},
	},
	{
		type: "user",
		uuid: "u3",
		parentUuid: "a1",
		sessionId: SESSION_ID,
		timestamp: "2026-09-28T10:01:08.000Z",
		message: {role: "user", content: "Fabricated prompt: do chapter 3"},
	},
];
const cut = {parentUuid: "a1", replacementUuid: "u3", at: "2026-09-28T10:01:00.000Z", count: 1};

async function renderSessionPage() {
	const queryClient = newQueryClient();
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records,
		byteOffset: 0,
		startIndex: START_INDEX,
		precedingMessageCount: 0,
		hiddenUuids: ["u2"],
		cuts: [cut],
		chainVersion: "v1",
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	await renderInRouter(queryClient, <SessionPage sessionId={SESSION_ID} />);
}

function promptRecordIndex(text: string): string | null | undefined {
	return screen.getByText(text).closest("[data-record-index]")?.getAttribute("data-record-index");
}

beforeEach(() => {
	installLocalStorage();
	sessionStorage.clear();
	Element.prototype.scrollIntoView = vi.fn<Element["scrollIntoView"]>();
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Promise<Response>(() => {})),
	);
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(async () => Promise.resolve());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("processTranscript with the served active chain", () => {
	it("skips hidden records but keeps every visible line's raw record index, and passes cuts through by replacement", () => {
		const processed = processTranscript(records, START_INDEX, {hidden: new Set(["u2"]), cuts: [cut]});

		expect({
			lines: processed.lines.map((line) => [line.type, line.lineIndex]),
			uuidToLine: [...processed.uuidToLine],
			cuts: [...processed.cutsByReplacement],
		}).toStrictEqual({
			lines: [
				["user", 448],
				["assistant", 449],
				["user", 451],
			],
			uuidToLine: [
				["u1", 448],
				["a1", 449],
				["u3", 451],
			],
			cuts: [["u3", cut]],
		});
	});

	it("renders every record and no cuts without a served chain", () => {
		const processed = processTranscript(records, START_INDEX);

		expect({
			lines: processed.lines.map((line) => line.lineIndex),
			cuts: processed.cutsByReplacement.size,
		}).toStrictEqual({lines: [448, 449, 450, 451], cuts: 0});
	});
});

describe("session page active chain", () => {
	it("hides the abandoned prompt in normal mode and keeps the visible rows' record indices", async () => {
		await renderSessionPage();

		expect({
			chapter3: screen.getAllByText("Fabricated prompt: do chapter 3").length,
			chapter2: screen.queryAllByText("Fabricated prompt: do chapter 2").length,
			chapter1Index: promptRecordIndex("Fabricated prompt: do chapter 1"),
			chapter3Index: promptRecordIndex("Fabricated prompt: do chapter 3"),
		}).toStrictEqual({chapter3: 1, chapter2: 0, chapter1Index: "448", chapter3Index: "451"});
	});

	it("shows both prompts in verbose mode, the raw JSONL view", async () => {
		const preset = VERBOSITY_PRESETS.verbose;
		for (const key of objectKeys(preset)) {
			const value = preset[key];
			if (value !== undefined) writeStoredValue(key, value);
		}
		writeStoredValue("verbosity", "verbose");
		await renderSessionPage();

		expect({
			chapter3: screen.getAllByText("Fabricated prompt: do chapter 3").length,
			chapter2: screen.getAllByText("Fabricated prompt: do chapter 2").length,
			chapter2Index: promptRecordIndex("Fabricated prompt: do chapter 2"),
			chapter3Index: promptRecordIndex("Fabricated prompt: do chapter 3"),
		}).toStrictEqual({chapter3: 1, chapter2: 1, chapter2Index: "450", chapter3Index: "451"});
	});
});
