// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {BackgroundTasksList} from "../src/components/panes/background-tasks-pane";
import type {BackgroundTask, BackgroundTaskGroups} from "../src/lib/background-tasks";
import {requestBackgroundTaskFocus, setTaskRowsOpen} from "../src/lib/background-task-focus";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
	return {
		toolUseId: null,
		kind: "bash",
		description: "",
		command: null,
		status: "running",
		output: null,
		summary: null,
		outputFile: null,
		startedAt: null,
		...overrides,
	};
}

const GROUPS: BackgroundTaskGroups = {
	running: [
		task({id: "bfab1serve", description: "Serve the fabricated app", command: "pnpm dev"}),
		task({id: "afab1review", kind: "agent", description: "Review the fabricated diff"}),
	],
	finished: [
		task({
			id: "bfab1build",
			description: "Build the fabricated app",
			command: "pnpm build",
			status: "completed",
			output: "built in 1.2s",
		}),
	],
};

function sections() {
	return screen.getAllByRole("heading").map((heading) => heading.textContent);
}

function cards() {
	return [...document.querySelectorAll("button[data-background-task]")].map((button) => button.textContent);
}

const POLL_GROUPS: BackgroundTaskGroups = {
	running: [],
	finished: [
		task({
			id: "bfab1poll",
			description: "Poll PR",
			command: "gh pr checks 42 --watch",
			status: "completed",
			output: "all checks passed",
		}),
	],
};

function regionSummary(name: string) {
	const region = screen.getByRole("region", {name});
	return {text: region.textContent, capped: region.classList.contains("max-h-[200px]")};
}

describe("BackgroundTasksList", () => {
	it("groups running and finished cards with kind and status meta, finished starting collapsed", () => {
		render(<BackgroundTasksList groups={GROUPS} />);

		expect({
			sections: sections(),
			cards: cards(),
			toggle: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
		}).toStrictEqual({
			sections: ["2 running", "Finished 1"],
			cards: ["Serve the fabricated appBash · Running", "Review the fabricated diffAgent · Running"],
			toggle: "false",
		});
	});

	it("expands the finished section on click", () => {
		render(<BackgroundTasksList groups={GROUPS} />);

		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));

		expect({
			toggle: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
			cards: cards(),
		}).toStrictEqual({
			toggle: "true",
			cards: [
				"Serve the fabricated appBash · Running",
				"Review the fabricated diffAgent · Running",
				"Build the fabricated appBash · Completed",
			],
		});
	});

	it("names each card button after its task", () => {
		render(<BackgroundTasksList groups={POLL_GROUPS} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));

		expect(screen.getByRole("button", {name: "Background task: Poll PR"}).getAttribute("aria-expanded")).toBe(
			"false",
		);
	});

	it("expands a card into capped Command and Output regions", () => {
		render(<BackgroundTasksList groups={POLL_GROUPS} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));
		const card = screen.getByRole("button", {name: "Background task: Poll PR"});

		fireEvent.click(card);

		expect({
			expanded: card.getAttribute("aria-expanded"),
			command: regionSummary("Command for Poll PR"),
			output: regionSummary("Output for Poll PR"),
		}).toStrictEqual({
			expanded: "true",
			command: {text: "$\u00a0gh pr checks 42 --watch", capped: true},
			output: {text: "all checks passed", capped: true},
		});
	});

	it("Clear finished tasks is an icon button that hides only the finished cards", () => {
		render(<BackgroundTasksList groups={GROUPS} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));
		const clear = screen.getByRole("button", {name: "Clear finished tasks"});

		const icon = clear.textContent;
		fireEvent.click(clear);

		expect({
			icon,
			sections: sections(),
			cards: cards(),
			clear: screen.queryByRole("button", {name: "Clear finished tasks"}),
		}).toStrictEqual({
			icon: "",
			sections: ["2 running"],
			cards: ["Serve the fabricated appBash · Running", "Review the fabricated diffAgent · Running"],
			clear: null,
		});
	});

	it("shows empty copy when there is no background work", () => {
		render(<BackgroundTasksList groups={{running: [], finished: []}} />);

		const empty = screen.getByText("No background tasks in this session.");
		expect({tag: empty.tagName, muted: empty.classList.contains("text-ink-muted")}).toStrictEqual({
			tag: "P",
			muted: true,
		});
	});
});

const SESSION_ID = "5e5510a0-0000-4000-8000-00000000fab1";
const OUTPUT_FILE = "/private/tmp/claude-501/-Users-fab/dc5296db-0000-4000-8000-00000000fab1/tasks/bfab1lint.output";

function withQueryClient(node: ReactNode) {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function stubFetch(body: unknown) {
	const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(Response.json(body)));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function fetchedUrls(fetchMock: ReturnType<typeof stubFetch>): string[] {
	return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
}

const LINT_GROUPS: BackgroundTaskGroups = {
	running: [
		task({
			id: "bfab1lint",
			description: "Lint the fabricated app",
			command: "pnpm lint",
			summary: "Background command still running",
			outputFile: OUTPUT_FILE,
		}),
	],
	finished: [],
};

describe("BackgroundTasksList touch summary", () => {
	it("shows a failed or stopped task's summary inline on coarse pointers only, and not for completed tasks", () => {
		const groups: BackgroundTaskGroups = {
			running: [],
			finished: [
				task({
					id: "bfab1lint",
					description: "Lint the fabricated app",
					status: "failed",
					summary: "Background command failed with exit code 1",
				}),
				task({id: "bfab1tail", description: "Tail the logs", status: "stopped", summary: "Stopped by user"}),
				task({
					id: "bfab1done",
					description: "Build",
					status: "completed",
					summary: "Background command completed",
				}),
			],
		};
		render(<BackgroundTasksList groups={groups} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 3"}));

		expect(
			[...document.querySelectorAll("[data-background-task-summary]")].map((span) => ({
				text: span.textContent,
				className: span.className,
			})),
		).toStrictEqual([
			{
				text: "Background command failed with exit code 1",
				className: "hidden [@media(pointer:coarse)]:block text-body text-secondary truncate min-w-0",
			},
			{
				text: "Stopped by user",
				className: "hidden [@media(pointer:coarse)]:block text-body text-secondary truncate min-w-0",
			},
		]);
	});
});

describe("BackgroundTasksList output file", () => {
	// Open rows outlive the pane per session, so collapse this suite's cards between tests.
	afterEach(() => {
		setTaskRowsOpen(SESSION_ID, ["bfab1lint", "afab1review"], false);
	});

	it("fetches a task's output file only once its card expands, and shows it in the Output region", async () => {
		const fetchMock = stubFetch({status: "ok", output: "\u001b[32m0 problems\u001b[0m\n", truncated: false});
		render(withQueryClient(<BackgroundTasksList groups={LINT_GROUPS} sessionId={SESSION_ID} />));

		const beforeExpand = fetchedUrls(fetchMock);
		fireEvent.click(screen.getByRole("button", {name: "Background task: Lint the fabricated app"}));
		const region = await screen.findByRole("region", {name: "Output for Lint the fabricated app"});

		expect({beforeExpand, urls: fetchedUrls(fetchMock), text: region.textContent}).toStrictEqual({
			beforeExpand: [],
			urls: [`/api/sessions/${SESSION_ID}/task-output?file=${encodeURIComponent(OUTPUT_FILE)}`],
			text: "0 problems\n",
		});
	});

	it("notes when the output was truncated to its tail", async () => {
		stubFetch({status: "ok", output: "last line\n", truncated: true});
		render(withQueryClient(<BackgroundTasksList groups={LINT_GROUPS} sessionId={SESSION_ID} />));

		fireEvent.click(screen.getByRole("button", {name: "Background task: Lint the fabricated app"}));

		expect((await screen.findByText("Showing the last 64 KB of output.")).tagName).toBe("P");
	});

	it("says the output is no longer available when the file was cleaned up", async () => {
		stubFetch({status: "missing"});
		render(withQueryClient(<BackgroundTasksList groups={LINT_GROUPS} sessionId={SESSION_ID} />));

		fireEvent.click(screen.getByRole("button", {name: "Background task: Lint the fabricated app"}));

		expect((await screen.findByText("Output no longer available")).tagName).toBe("P");
	});

	it("shows an agent task's result and never fetches its output file", () => {
		const fetchMock = stubFetch({status: "ok", output: '{"type":"user"}', truncated: false});
		const groups: BackgroundTaskGroups = {
			running: [
				task({
					id: "afab1review",
					kind: "agent",
					description: "Review the fabricated diff",
					output: "The fabricated diff looks good.",
					outputFile: OUTPUT_FILE,
				}),
			],
			finished: [],
		};
		render(withQueryClient(<BackgroundTasksList groups={groups} sessionId={SESSION_ID} />));

		fireEvent.click(screen.getByRole("button", {name: "Background task: Review the fabricated diff"}));

		expect({
			urls: fetchedUrls(fetchMock),
			text: screen.getByRole("region", {name: "Output for Review the fabricated diff"}).textContent,
		}).toStrictEqual({urls: [], text: "The fabricated diff looks good."});
	});
});

describe("BackgroundTasksList focus requests", () => {
	let session = 0;
	function nextSession(): string {
		session += 1;
		return `5e5510a0-0000-4000-8000-0000000f0c${String(session).padStart(2, "0")}`;
	}

	function stubFrames() {
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		});
		vi.stubGlobal("cancelAnimationFrame", () => undefined);
		return vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
	}

	function expandedCards() {
		return [...document.querySelectorAll('button[data-background-task][aria-expanded="true"]')].map((button) =>
			button.getAttribute("aria-label"),
		);
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("opens Finished, expands and scrolls to a task requested before the pane mounts, without moving focus", () => {
		const scroll = stubFrames();
		const sessionId = nextSession();
		requestBackgroundTaskFocus(sessionId, {taskId: "bfab1build", finished: true});

		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		expect({
			finished: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
			card: screen
				.getByRole("button", {name: "Background task: Build the fabricated app"})
				.getAttribute("aria-expanded"),
			scrollCalls: scroll.mock.calls,
			scrolled: scroll.mock.contexts.map((element) => (element as Element).getAttribute("data-task-id")),
			active: document.activeElement === document.body,
		}).toStrictEqual({
			finished: "true",
			card: "true",
			scrollCalls: [[{block: "start"}]],
			scrolled: ["bfab1build"],
			active: true,
		});
	});

	it("adds a task requested after mount to the open rows, keeping the earlier one open", () => {
		stubFrames();
		const sessionId = nextSession();
		requestBackgroundTaskFocus(sessionId, {taskId: "bfab1build", finished: true});
		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		act(() => {
			requestBackgroundTaskFocus(sessionId, {taskId: "bfab1serve", finished: false});
		});

		expect(expandedCards()).toStrictEqual([
			"Background task: Serve the fabricated app",
			"Background task: Build the fabricated app",
		]);
	});

	it("re-opens a Finished section the user collapsed", () => {
		stubFrames();
		const sessionId = nextSession();
		requestBackgroundTaskFocus(sessionId, {taskId: "bfab1build", finished: true});
		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));
		const collapsed = screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded");

		act(() => {
			requestBackgroundTaskFocus(sessionId, {taskId: "bfab1build", finished: true});
		});

		expect({
			collapsed,
			reopened: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
		}).toStrictEqual({collapsed: "false", reopened: "true"});
	});

	it("keeps Finished and the expanded rows across a remount in the same session", () => {
		stubFrames();
		const sessionId = nextSession();
		const first = render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));
		fireEvent.click(screen.getByRole("button", {name: "Background task: Build the fabricated app"}));
		first.unmount();

		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		expect({
			finished: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
			expanded: expandedCards(),
		}).toStrictEqual({finished: "true", expanded: ["Background task: Build the fabricated app"]});
	});

	it("ignores a request for a task with no row", () => {
		const scroll = stubFrames();
		const sessionId = nextSession();
		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		act(() => {
			requestBackgroundTaskFocus(sessionId, {taskId: "missing", finished: false});
		});

		expect({scrollCalls: scroll.mock.calls, expanded: expandedCards()}).toStrictEqual({
			scrollCalls: [],
			expanded: [],
		});
	});
});
