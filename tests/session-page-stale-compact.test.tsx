// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {type HerdrPaneIndexData, herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
	groupedSessionsQueryOptions,
} from "../src/lib/api/sessions";
import {SessionPage} from "../src/components/session-page";
import type {SessionChatProps} from "../src/components/session-chat";
import {StaleCompactBand} from "../src/components/stale-compact-band";
import {resetColdResumeStore} from "../src/lib/cold-resume-notice";
import {usageQueryOptions} from "../src/lib/api/usage";
import {ToastProvider} from "../src/components/toast";
import {SettingsProvider} from "../src/components/settings-provider";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate; the stand-in renders only the band.
vi.mock("../src/components/session-chat", () => ({
	SessionChat: ({staleCompact}: SessionChatProps) =>
		staleCompact === undefined ? null : <StaleCompactBand {...staleCompact} />,
}));

class TestEventSource extends EventTarget {
	readonly close = vi.fn<() => void>();
	onerror: ((event: Event) => void) | null = null;
}

class FakeStorage implements Storage {
	readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class TestIntersectionObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

const SESSION_ID = "session-test-303";
const PROJECT_ID = "project-test-303";

const detail: SessionDetailData = {
	title: "Alice's idle session",
	projectName: "example",
	projectId: PROJECT_ID,
	homeRoot: "/home/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: null,
	gitBranch: null,
	cwd: "/home/alice/example",
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

const LIVE_PANE: HerdrPaneIndexData["panes"][number] = {
	host: "herdr",
	paneId: "pane-test-303",
	terminalId: "terminal-test-303",
	workspaceId: "workspace-test-303",
	tabId: "tab-test-303",
	focused: false,
	cwd: "/home/alice/example",
	foregroundCwd: null,
	agentStatus: "idle",
	agent: "claude",
	terminalTitle: null,
	agentSessionId: SESSION_ID,
	revision: 1,
	sessionId: SESSION_ID,
	via: "agent-session",
	viewedState: detail.viewedState,
};

const LIVE: HerdrPaneIndexData = {panes: [LIVE_PANE], writesEnabled: true};

interface Seed {
	records?: Record<string, unknown>[];
	detail?: Partial<SessionDetailData>;
	herdr?: HerdrPaneIndexData;
	state?: "working" | "idle";
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function reply(uuid: string, minutes: number) {
	return {
		type: "assistant",
		uuid,
		timestamp: minutesAgo(minutes),
		message: {
			role: "assistant",
			model: "claude-opus-5-5",
			content: [{type: "text", text: "Done."}],
			usage: {input_tokens: 2_000, cache_read_input_tokens: 410_000, cache_creation_input_tokens: 0},
		},
	};
}

function prompt(uuid: string, minutes: number) {
	return {type: "user", uuid, timestamp: minutesAgo(minutes), message: {role: "user", content: "Fabricated prompt"}};
}

function seededQueryClient(seed: Seed) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, {...detail, ...seed.detail});
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records: seed.records ?? [reply("a-1", 80)],
		byteOffset: 0,
		startIndex: 0,
		precedingMessageCount: 0,
		hiddenUuids: [],
		cuts: [],
		chainVersion: "v1",
		chapters: [],
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, seed.herdr ?? {panes: [], writesEnabled: false});
	queryClient.setQueryData(usageQueryOptions.queryKey, {
		fiveHour: {usedPct: 20, resetsAt: Math.floor(Date.now() / 1000) + 3600},
		sevenDay: null,
		updatedAt: new Date().toISOString(),
	});
	if (seed.state !== undefined) {
		queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, [
			{sessions: [{id: SESSION_ID, state: seed.state}]},
		] as never);
	}
	return queryClient;
}

async function renderSession(seed: Seed = {}) {
	const queryClient = seededQueryClient(seed);
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
	return {queryClient, router};
}

let posts: unknown[] = [];
/** What the next /api/herdr/prompt POST answers: a response, or a promise the test settles. */
let promptResponse: Response | Promise<Response> = Response.json({ok: true});

function stubBrowserGlobals(): void {
	posts = [];
	promptResponse = Response.json({ok: true});
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("localStorage", new FakeStorage());
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/herdr/prompt") {
				posts.push(JSON.parse(String(init?.body)));
				return promptResponse;
			}
			return new Promise<Response>(() => {});
		}),
	);
}

const band = () => document.querySelector("[data-transcript-keeps-pin]");
const LINE = "Your next message re-reads all 412k tokens. Compact first so later messages start from a short summary.";

beforeEach(() => {
	resetColdResumeStore();
	stubBrowserGlobals();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session page stale-compact line", () => {
	it("advises compacting a large session idle for 80 minutes", async () => {
		await renderSession({herdr: LIVE});
		const found = await waitFor(() => {
			const element = band();
			expect(element).not.toBeNull();
			return element!;
		});
		expect(found.querySelector('[role="status"]')?.textContent).toBe(LINE);
	});

	it.each<[string, Seed]>([
		["the user's message is the last entry", {herdr: LIVE, records: [reply("a-1", 90), prompt("u-1", 80)]}],
		["idle for under 70 minutes", {herdr: LIVE, records: [reply("a-1", 60)]}],
		["the session is working", {herdr: LIVE, state: "working"}],
		["there is no live pane", {}],
		["live terminal input is off", {herdr: {panes: [LIVE_PANE], writesEnabled: false}}],
		["the session is archived", {herdr: LIVE, detail: {archived: true}}],
	])("shows nothing when %s", async (_name, seed) => {
		await renderSession(seed);
		await screen.findByRole("textbox", {name: "Prompt"}).catch(async () => screen.findByRole("note"));
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(band()).toBeNull();
	});

	it("brings the line back when the compact send fails", async () => {
		promptResponse = new Response("boom", {status: 500});
		await renderSession({herdr: LIVE});
		fireEvent.click(await screen.findByRole("button", {name: "Compact session"}));
		await waitFor(() => {
			expect(posts).toStrictEqual([{sessionId: SESSION_ID, prompt: "/compact"}]);
		});
		expect(await screen.findByRole("button", {name: "Compact session"})).not.toBeNull();
	});

	it("types /compact, shows Compacting… until the send settles, and stays away once delivered", async () => {
		let settle: (response: Response) => void = () => {};
		promptResponse = new Promise<Response>((resolve) => {
			settle = resolve;
		});
		const {queryClient} = await renderSession({herdr: LIVE});
		fireEvent.click(await screen.findByRole("button", {name: "Compact session"}));
		await waitFor(() => {
			expect(posts).toStrictEqual([{sessionId: SESSION_ID, prompt: "/compact"}]);
		});
		const link = screen.getByRole("button", {name: "Compacting…"});
		expect([link.hasAttribute("disabled"), link.getAttribute("aria-busy")]).toStrictEqual([true, "true"]);
		// The episode keeps the line while the session turns busy.
		act(() => {
			queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, [
				{sessions: [{id: SESSION_ID, state: "working"}]},
			] as never);
		});
		expect(screen.getByRole("button", {name: "Compacting…"})).toBe(link);
		await act(async () => {
			settle(Response.json({ok: true}));
			await Promise.resolve();
		});
		await waitFor(() => {
			expect(band()).toBeNull();
		});
		// A delivered /compact holds the composer until the transcript picks it up, so the line stays away.
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(band()).toBeNull();
	});

	it("yields to the cold-resume card and returns once it is dismissed (upstream LMe)", async () => {
		await renderSession({herdr: LIVE, records: [reply("a-1", 180)]});
		const card = await waitFor(() => {
			const element = document.querySelector('[data-testid="cold-resume-card"]');
			expect(element).not.toBeNull();
			return element!;
		});
		expect(band()).toBeNull();
		fireEvent.click(card.querySelector('button[aria-label="Dismiss"]')!);
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		await waitFor(() => {
			expect(band()).not.toBeNull();
		});
	});
});
