// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeEventsProvider} from "../src/hooks/use-claude-events";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {
	sessionDetailQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {SessionPage} from "../src/components/session-page";
import {ToastProvider} from "../src/components/toast";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => ({
	SessionChat: () => null,
}));

class TestEventSource extends EventTarget {
	readonly close = vi.fn();
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

const SESSION_ID = "session-test-100";

const detail: SessionDetailData = {
	title: "Alice's containment test",
	projectName: "example",
	projectId: "project-test-100",
	homeRoot: "/home/alice",
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
		lastViewedMessageIndex: 0,
		reviewTargetMessageIndex: 0,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

function seededQueryClient() {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false}},
	});
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records: [
			{
				type: "assistant",
				uuid: "uuid-test-100",
				message: {
					role: "assistant",
					content: [
						{type: "text", text: "Docs live at https://example.com/docs"},
						{
							type: "tool_use",
							id: "tool-use-read-example",
							name: "Read",
							input: {file_path: "/home/alice/example/read.ts"},
						},
					],
				},
			},
		],
		byteOffset: 0,
		startIndex: 0,
		precedingMessageCount: 0,
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {
		panes: [],
		writesEnabled: false,
	});
	return queryClient;
}

async function renderSessionInScroller() {
	const queryClient = seededQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ClaudeEventsProvider>
					<ToastProvider>
						<main data-testid="app-scroller" style={{overflowY: "auto"}}>
							<SessionPage sessionId={SESSION_ID} />
						</main>
					</ToastProvider>
				</ClaudeEventsProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: [`/session/${SESSION_ID}`],
		}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return screen.findByTestId("app-scroller");
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("fixed-position session UI and the contained transcript scroller", () => {
	it("keeps fixed UI outside the [contain:strict] scroller and docks the scroll pill in-flow", async () => {
		vi.stubGlobal("EventSource", TestEventSource);
		vi.stubGlobal("localStorage", new FakeStorage());
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>(() => {})),
		);

		const scroller = await renderSessionInScroller();
		fireEvent.click(await screen.findByRole("button", {name: "View options"}));
		await act(async () => {
			fireEvent.click(await screen.findByRole("menuitemcheckbox", {name: /^Links/}));
		});

		const linksPane = screen.getByRole("region", {name: "Links"});
		const scrollPill = screen.getByLabelText("Scroll to bottom", {selector: "button"});
		const containedElements = [...document.querySelectorAll("*")].filter((element) =>
			element.classList.contains("[contain:strict]"),
		);
		const fixedInsideContained = containedElements.flatMap((element) =>
			[...element.querySelectorAll("*")].filter((descendant) => descendant.classList.contains("fixed")),
		);

		expect({
			containedElements,
			// Side content is an in-flow tile now, not a fixed overlay drawer.
			linksPaneKind: linksPane.dataset["paneKind"],
			linksPaneFixed: linksPane.classList.contains("fixed"),
			fixedInsideContained,
			scrollPillPositioning: scrollPill.classList.contains("absolute"),
			transcriptWidth: scrollPill
				.closest<HTMLElement>('[style*="--max-content-width"]')
				?.style.getPropertyValue("--max-content-width"),
		}).toStrictEqual({
			containedElements: [scroller],
			linksPaneKind: "links",
			linksPaneFixed: false,
			fixedInsideContained: [],
			scrollPillPositioning: true,
			transcriptWidth: "768px",
		});
	});

	it("pads the sticky composer footer above the phone home-indicator inset", async () => {
		vi.stubGlobal("EventSource", TestEventSource);
		vi.stubGlobal("localStorage", new FakeStorage());
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>(() => {})),
		);

		const scroller = await renderSessionInScroller();
		const footers = [...scroller.querySelectorAll("[data-session-footer]")];

		expect(
			footers.map((footer) =>
				[...footer.classList].filter((token) => token.startsWith("sticky") || token.startsWith("pb-")),
			),
		).toStrictEqual([["sticky", "pb-[max(env(safe-area-inset-bottom),0.5rem)]"]]);
	});

	it("has no status footer and opens Session details from View options", async () => {
		vi.stubGlobal("EventSource", TestEventSource);
		vi.stubGlobal("localStorage", new FakeStorage());
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal(
			"fetch",
			vi.fn((input: RequestInfo | URL) =>
				String(input).endsWith("/statusline")
					? Promise.resolve(
							new Response(JSON.stringify({version: "1.0.23", cost: {total_cost_usd: 1.47}}), {
								status: 200,
								headers: {"content-type": "application/json"},
							}),
						)
					: new Promise<Response>(() => {}),
			),
		);

		const scroller = await renderSessionInScroller();
		fireEvent.click(await screen.findByRole("button", {name: "View options"}));
		const item = await screen.findByRole("menuitemcheckbox", {name: "Session details"});
		const footer = scroller.querySelector<HTMLElement>("[data-session-footer]");
		const footerContent = {
			buttons: [...(footer?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label")),
			segments: footer?.querySelectorAll("[data-status-segment]").length,
		};
		await act(async () => {
			fireEvent.click(item);
		});
		const pane = screen.getByRole("region", {name: "Session details"});

		expect({
			footerContent,
			segments: [...pane.querySelectorAll("[data-status-segment]")].map((segment) => segment.textContent),
		}).toStrictEqual({
			footerContent: {buttons: ["Scroll to bottom"], segments: 0},
			segments: ["v1.0.23", "1 msg", "$1.47"],
		});
	});

	it("paints the dock opaque to the viewport bottom with a top fade over the transcript", async () => {
		vi.stubGlobal("EventSource", TestEventSource);
		vi.stubGlobal("localStorage", new FakeStorage());
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>(() => {})),
		);

		const scroller = await renderSessionInScroller();
		const footer = scroller.querySelector("[data-session-footer]");

		expect(
			[...(footer?.classList ?? [])].filter((token) => token.startsWith("bg-") || token.startsWith("before:")),
		).toStrictEqual([
			"bg-surface-2",
			"before:pointer-events-none",
			"before:absolute",
			"before:inset-x-0",
			"before:bottom-full",
			"before:h-8",
			"before:bg-linear-to-b",
			"before:from-transparent",
			"before:to-surface-2",
		]);
	});
});
