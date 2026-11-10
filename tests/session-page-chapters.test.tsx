// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {
	fetchEarlierTranscript,
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {SessionPage} from "../src/components/session-page";
import {addUserChapter} from "../src/lib/chapter-store";
import {
	jumpToMessage,
	TRANSCRIPT_JUMP_REQUEST_EVENT,
	TRANSCRIPT_RELEASE_END_FOLLOW_EVENT,
} from "../src/lib/jump-to-message";
import {ToastProvider} from "../src/components/toast";
import {SettingsProvider} from "../src/components/settings-provider";
import {installLocalStorage} from "./fake-storage";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => ({
	SessionChat: () => null,
}));
vi.mock(import("../src/lib/api/sessions"), async (importOriginal) => ({
	...(await importOriginal()),
	fetchEarlierTranscript: vi.fn<typeof fetchEarlierTranscript>(async () => new Promise<void>(() => {})),
}));
vi.mock(import("../src/lib/jump-to-message"), async (importOriginal) => ({
	...(await importOriginal()),
	jumpToMessage: vi.fn<typeof jumpToMessage>(() => true),
}));

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

const SESSION_ID = "session-test-chapters";

const detail: SessionDetailData = {
	title: "Alice's chaptered session",
	projectName: "example",
	projectId: "project-test-chapters",
	homeRoot: "/home/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: "/home/alice/example",
	gitSha: null,
	gitClean: null,
	messageCount: 2,
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

/** The loaded tail starts at record 40; Claude's chapter sits on record 3, on a page not loaded yet. */
const EARLY_CHAPTER = {id: "toolu_fake_plan", title: "Plan the work", uuid: "uuid-early", recordIndex: 3};

async function renderSession({chapters = [EARLY_CHAPTER]}: {chapters?: (typeof EARLY_CHAPTER)[]} = {}) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records: [
			{type: "user", uuid: "uuid-prompt", message: {role: "user", content: "Fabricated prompt"}},
			{
				type: "assistant",
				uuid: "uuid-reply",
				parentUuid: "uuid-prompt",
				message: {role: "assistant", model: "claude-opus-5-5", content: [{type: "text", text: "Done."}]},
			},
		],
		byteOffset: 0,
		startIndex: 40,
		precedingMessageCount: 0,
		hiddenUuids: [],
		cuts: [],
		chainVersion: "v1",
		chapters,
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ClaudeEventsProvider>
						<ToastProvider>
							<SessionPage sessionId={SESSION_ID} />
						</ToastProvider>
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
}

const outline = () => document.querySelector<HTMLElement>("nav[aria-label='Session chapters']");
const row = (title: string) =>
	[...(outline()?.querySelectorAll("button") ?? [])].find((button) => button.textContent === title)!;

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Promise<Response>(() => {})),
	);
	vi.spyOn(crypto, "randomUUID").mockReturnValue("fake-uuid-1" as ReturnType<typeof crypto.randomUUID>);
	vi.mocked(fetchEarlierTranscript).mockClear();
	vi.mocked(jumpToMessage).mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session page chapters outline", () => {
	it("has no outline, and no chapter chips, for a session without chapters", async () => {
		await renderSession({chapters: []});
		expect({
			outline: outline(),
			chips: document.querySelector("nav[aria-label='Chapters']"),
		}).toStrictEqual({outline: null, chips: null});
	});

	it("lists Session start, Claude's chapters and the pins beside the scroller, in place of the header chips", async () => {
		addUserChapter(SESSION_ID, "uuid-reply", "Kickoff", 41);
		await renderSession();
		const nav = outline()!;
		const scroller = document.querySelector("[data-session-scrollport]")!;

		expect({
			rows: [...nav.querySelectorAll("button")].map((button) => button.textContent),
			besideScroller: nav.parentElement?.parentElement === scroller.parentElement,
			insideScroller: scroller.contains(nav),
			insideChatPanel: nav.closest(".epitaxy-chat-panel")?.hasAttribute("data-session-tile"),
			chips: document.querySelector("nav[aria-label='Chapters']"),
		}).toStrictEqual({
			rows: ["Session start", "Plan the work", "Kickoff"],
			besideScroller: true,
			insideScroller: false,
			insideChatPanel: true,
			chips: null,
		});
	});

	it("reveals a loaded but unmounted chapter through the transcript's own jump, releasing its end-follow first", async () => {
		addUserChapter(SESSION_ID, "uuid-reply", "Kickoff", 41);
		await renderSession();
		const scroller = document.querySelector<HTMLElement>("[data-session-scrollport]")!;
		const events: string[] = [];
		scroller.addEventListener(TRANSCRIPT_RELEASE_END_FOLLOW_EVENT, () => events.push("release"));
		const onJump = (event: Event) => events.push(`jump ${(event as CustomEvent<number>).detail}`);
		window.addEventListener(TRANSCRIPT_JUMP_REQUEST_EVENT, onJump);

		fireEvent.click(row("Kickoff"));
		window.removeEventListener(TRANSCRIPT_JUMP_REQUEST_EVENT, onJump);

		expect({
			events,
			jumped: vi.mocked(jumpToMessage).mock.calls,
			fetched: vi.mocked(fetchEarlierTranscript).mock.calls.length,
		}).toStrictEqual({events: ["release", "jump 41"], jumped: [], fetched: 0});
	});

	it("scrolls smoothly to the top for Session start, and lands there even when the smooth scroll is cut short", async () => {
		await renderSession();
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		const scroller = document.querySelector<HTMLElement>("[data-session-scrollport]")!;
		const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
		scroller.scrollTo = scrollTo as typeof scroller.scrollTo;
		let released = 0;
		scroller.addEventListener(TRANSCRIPT_RELEASE_END_FOLLOW_EVENT, () => {
			released += 1;
		});
		scroller.scrollTop = 640;

		fireEvent.click(row("Session start"));
		const smooth = {calls: scrollTo.mock.calls, scrollTop: scroller.scrollTop};
		vi.advanceTimersByTime(1000);
		vi.useRealTimers();

		expect({released, smooth, settled: scroller.scrollTop}).toStrictEqual({
			released: 1,
			smooth: {calls: [[{top: 0, behavior: "smooth"}]], scrollTop: 640},
			settled: 0,
		});
	});

	it("scrolls straight to a chapter whose heading is mounted", async () => {
		await renderSession();
		const heading = document.createElement("h3");
		heading.id = "epitaxy-ch-toolu_fake_plan";
		const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>();
		heading.scrollIntoView = scrollIntoView;
		document.querySelector("[data-session-scrollport]")!.append(heading);

		fireEvent.click(row("Plan the work"));

		expect({
			scrollIntoView: scrollIntoView.mock.calls,
			jumped: vi.mocked(jumpToMessage).mock.calls,
			fetched: vi.mocked(fetchEarlierTranscript).mock.calls.length,
		}).toStrictEqual({scrollIntoView: [[{block: "start", behavior: "smooth"}]], jumped: [], fetched: 0});
	});

	it("pages earlier history in for a chapter before the loaded tail, then settles on its heading", async () => {
		await renderSession();
		act(() => {
			fireEvent.click(row("Plan the work"));
		});
		await waitFor(() => {
			expect(vi.mocked(fetchEarlierTranscript).mock.calls.map(([, sessionId]) => sessionId)).toStrictEqual([
				SESSION_ID,
			]);
		});
		const heading = document.createElement("h3");
		heading.id = "epitaxy-ch-toolu_fake_plan";
		const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>();
		heading.scrollIntoView = scrollIntoView;
		// The message jump flashes the row it lands on; a chapter jump has no flash upstream.
		const flashed = document.createElement("div");
		flashed.className = "message-highlight";
		act(() => {
			document.querySelector("[data-session-scrollport]")!.append(flashed, heading);
		});

		await waitFor(() => {
			expect(scrollIntoView.mock.calls).toStrictEqual([[{block: "start", behavior: "smooth"}]]);
		});
		expect(flashed.className).toBe("");
	});
});
