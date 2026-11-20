// @vitest-environment jsdom

import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {TerminalHold} from "../src/components/terminal-view/terminal-hold";
import {TerminalSession} from "../src/components/terminal-view/terminal-session";
import {sessionDetailQueryOptions, transcriptQueryOptions, type TranscriptData} from "../src/lib/api/sessions";
import
{
	TerminalSpinner,
	TerminalTranscriptView,
	type TerminalEarlierPages,
} from "../src/components/terminal-view/terminal-transcript-view";
import type {TerminalLine, TerminalToolLine} from "../src/lib/terminal-lines";

vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		pendingTools: new Map(),
	}),
	useIsSessionActive: () => false,
	useCachedSessionSummary: () => undefined,
}));

afterEach(() =>
{
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function renderInRouter(node: () => ReactNode, url = "/session/abc?pane=terminal&view=terminal")
{
	const rootRoute = createRootRoute();
	const sessionRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/session/$id",
			component: node,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([sessionRoute]),
			history: createMemoryHistory(
				{
					initialEntries: [url],
				},
			),
		},
	);
	await router.load();
	const view = render(<RouterProvider router={router} />);
	await waitFor(() =>
	{
		expect(view.container.innerHTML).not.toBe("");
	});
	return {
		router,
		...view,
	};
}

function toolLine(partial: Partial<TerminalToolLine>): TerminalToolLine
{
	return {
		kind: "tool",
		id: "t",
		name: "Bash",
		arg: "ls",
		status: "completed",
		interrupted: false,
		rejected: false,
		isError: false,
		resultSummary: undefined,
		resultExtraLineCount: 0,
		resultFullText: undefined,
		...partial,
	};
}

describe("TerminalHold", () =>
{
	it("renders upstream's hold screen and its exit drops only ?view with a replace", async () =>
	{
		const {router, container} = await renderInRouter(() => <TerminalHold />);
		const before = router.history.length;
		expect(container.innerHTML).toBe(
			'<div class="epitaxy-terminal-hold draggable-none relative h-full"><span role="status" aria-busy="true" class="sr-only">Loading session</span><button type="button" class="epitaxy-terminal-hold-exit">Open the normal view</button></div>',
		);
		fireEvent.click(screen.getByRole("button"));
		expect([router.history.location.pathname, router.history.location.search, router.history.length]).toStrictEqual(
			["/session/abc", "?pane=terminal", before],
		);
	});
});

describe("TerminalTranscriptView", () =>
{
	it("renders the focused region, its column and the prompt, chapter and event lines", () =>
	{
		const lines: TerminalLine[] = [
			{
				kind: "prompt",
				id: "p",
				text: "hi",
			},
			{
				kind: "chapter",
				id: "c",
				title: "Title",
			},
			{
				kind: "event",
				id: "e",
				label:
				{
					kind: "item",
					itemKind: "compacted",
				},
			},
			{
				kind: "todos",
				id: "todo",
				items: [
					{
						id: "a",
						content: "x",
						status: "completed",
					},
					{
						id: "b",
						content: "y",
						status: "pending",
					},
				],
			},
		];
		const {container} = render(<TerminalTranscriptView lines={lines} isWorking={false} />);
		const root = container.firstElementChild;
		expect(
			{
				root: [
					root?.className,
					root?.getAttribute("role"),
					root?.getAttribute("tabindex"),
					root?.getAttribute("aria-label"),
				],
				focused: document.activeElement === root,
				column: root?.firstElementChild?.className,
				lines: [...(root?.firstElementChild?.children ?? [])].map((child) => child.outerHTML),
			},
		).toStrictEqual(
			{
				root: [
					"epitaxy-terminal-view draggable-none relative h-full overflow-y-auto overflow-x-hidden",
					"region",
					"0",
					"Transcript",
				],
				focused: true,
				column: "epitaxy-terminal-view-column",
				lines: [
					'<div class="terminal-line terminal-prompt">hi</div>',
					'<div class="terminal-line terminal-chapter">── Title</div>',
					'<div class="terminal-line terminal-dim">◈ compacted</div>',
					'<div class="terminal-line"><div class="terminal-todo-done">☒ x</div><div class="terminal-todo-active">☐ y</div></div>',
				],
			},
		);
	});

	it("draws tool rows with status dots and ⎿ results, expanding once and unpinning", () =>
	{
		const onPinnedChange = vi.fn<(pinned: boolean) => void>();
		const lines: TerminalLine[] = [
			toolLine(
				{
					id: "done",
					resultSummary: "first",
					resultExtraLineCount: 2,
					resultFullText: "first\nsecond\nthird",
				},
			),
			toolLine(
				{
					id: "running",
					status: "running",
					arg: undefined,
				},
			),
			toolLine(
				{
					id: "error",
					status: "error",
					isError: true,
					resultSummary: "boom",
				},
			),
			toolLine(
				{
					id: "rejected",
					status: "error",
					rejected: true,
					isError: true,
					resultSummary: "no",
				},
			),
			toolLine(
				{
					id: "interrupted",
					status: "error",
					interrupted: true,
					resultSummary: "x",
				},
			),
		];
		const {container} = render(
			<TerminalTranscriptView lines={lines} isWorking={false} onPinnedChange={onPinnedChange} />,
		);
		const rows = () => [...(container.querySelector(".epitaxy-terminal-view-column")?.children ?? [])];
		expect(rows().map((row) => row.outerHTML)).toStrictEqual([
			'<div class="terminal-line"><span class="terminal-dot-completed">⏺ </span><span class="terminal-tool-name [font-variation-settings:normal]">Bash</span><span class="terminal-dim">(ls)</span><div class="terminal-result  ">⎿ first <button type="button" class="terminal-expand">+2 lines</button></div></div>',
			'<div class="terminal-line"><span class="terminal-dot-running">⏺ </span><span class="terminal-tool-name [font-variation-settings:normal]">Bash</span></div>',
			'<div class="terminal-line"><span class="terminal-dot-error">⏺ </span><span class="terminal-tool-name [font-variation-settings:normal]">Bash</span><span class="terminal-dim">(ls)</span><div class="terminal-result terminal-error ">⎿ boom</div></div>',
			'<div class="terminal-line"><span class="terminal-dot-neutral">⏺ </span><span class="terminal-tool-name [font-variation-settings:normal]">Bash</span><span class="terminal-dim">(ls)</span><div class="terminal-result">⎿ Rejected</div></div>',
			'<div class="terminal-line"><span class="terminal-dot-neutral">⏺ </span><span class="terminal-tool-name [font-variation-settings:normal]">Bash</span><span class="terminal-dim">(ls)</span><div class="terminal-result">⎿ Interrupted</div></div>',
		]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "+2 lines",
				},
			),
		);
		expect([rows()[0]?.lastElementChild?.outerHTML, onPinnedChange.mock.calls]).toStrictEqual([
			'<div class="terminal-result  terminal-result-expanded"><span class="terminal-result-glyph">⎿ </span><div class="terminal-result-full">first\nsecond\nthird</div></div>',
			[[false]],
		]);
	});

	it("shows the pending-approval line with an exit to the normal view", async () =>
	{
		const {container, router} = await renderInRouter(() => (
			<TerminalTranscriptView lines={[]} isWorking={false} pendingApproval />
		));
		expect(container.querySelector(".epitaxy-terminal-view-column")?.innerHTML).toBe(
			'<div class="terminal-line"><span class="terminal-dot-running">⏺ </span>Claude needs your permission <button type="button" class="terminal-expand">Open the normal view</button></div>',
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open the normal view",
				},
			),
		);
		expect(router.history.location.search).toBe("?pane=terminal");
	});

	it("stays pinned to new lines, holds still when unpinned, and anchors a prepended page", () =>
	{
		const line = (id: string): TerminalLine => (
		{
			kind: "assistant",
			id,
			text: id,
		});
		const onPinnedChange = vi.fn<(pinned: boolean) => void>();
		const {container, rerender} = render(
			<TerminalTranscriptView lines={[line("b")]} isWorking={false} onPinnedChange={onPinnedChange} />,
		);
		const root = container.firstElementChild as HTMLDivElement;
		let scrollHeight = 1000;
		Object.defineProperty(
			root,
			"scrollHeight",
			{
				get: () => scrollHeight,
				configurable: true,
			},
		);
		Object.defineProperty(
			root,
			"clientHeight",
			{
				value: 400,
				configurable: true,
			},
		);
		Object.defineProperty(
			root,
			"scrollTop",
			{
				value: 560,
				writable: true,
				configurable: true,
			},
		);
		fireEvent.scroll(root);
		rerender(
			<TerminalTranscriptView lines={[line("b"), line("c")]} isWorking={false} onPinnedChange={onPinnedChange} />,
		);
		const pinnedTop = root.scrollTop;
		root.scrollTop = 100;
		fireEvent.scroll(root);
		rerender(
			<TerminalTranscriptView
				lines={[line("b"), line("c"), line("d")]}
				isWorking={false}
				onPinnedChange={onPinnedChange}
			/>,
		);
		const unpinnedTop = root.scrollTop;
		scrollHeight = 1500;
		rerender(
			<TerminalTranscriptView
				lines={[line("a"), line("b"), line("c"), line("d")]}
				isWorking={false}
				onPinnedChange={onPinnedChange}
			/>,
		);
		expect([pinnedTop, unpinnedTop, root.scrollTop, onPinnedChange.mock.calls]).toStrictEqual([
			1000,
			100,
			600,
			[[true], [false]],
		]);
	});

	it("offers Load earlier, disables it while loading and auto-loads near the top", () =>
	{
		const loadEarlier = vi.fn<TerminalEarlierPages["loadEarlier"]>();
		const earlier = (isLoading: boolean): TerminalEarlierPages => (
		{
			hasEarlier: true,
			isLoading,
			error: false,
			loadEarlier,
		});
		const {container, rerender} = render(
			<TerminalTranscriptView lines={[]} isWorking={false} earlier={earlier(false)} />,
		);
		const button = () => screen.getByRole("button");
		const idle = [button().className, button().textContent, (button() as HTMLButtonElement).disabled];
		fireEvent.click(button());
		const root = container.firstElementChild as HTMLDivElement;
		Object.defineProperty(
			root,
			"scrollHeight",
			{
				value: 1000,
				configurable: true,
			},
		);
		Object.defineProperty(
			root,
			"clientHeight",
			{
				value: 400,
				configurable: true,
			},
		);
		Object.defineProperty(
			root,
			"scrollTop",
			{
				value: 150,
				writable: true,
				configurable: true,
			},
		);
		fireEvent.scroll(root);
		rerender(<TerminalTranscriptView lines={[]} isWorking={false} earlier={earlier(true)} />);
		fireEvent.scroll(root);
		expect([
			idle,
			[button().textContent, (button() as HTMLButtonElement).disabled],
			loadEarlier.mock.calls,
		]).toStrictEqual([
			["terminal-line terminal-dim terminal-expand", "Load earlier messages", false],
			["Loading earlier messages…", true],
			[["pill"], ["near_top"]],
		]);
	});
});

describe("TerminalSpinner", () =>
{
	it("spins braille frames, rotates its verb, counts seconds, then leaves a done line", () =>
	{
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const {container, rerender} = render(<TerminalSpinner isWorking />);
		const text = () => [...(container.firstElementChild?.children ?? [])].map((child) => child.textContent);
		const first = text();
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		const second = text();
		act(() =>
		{
			vi.advanceTimersByTime(4900);
		});
		const fifth = [container.firstElementChild?.className, ...text()];
		rerender(<TerminalSpinner isWorking={false} />);
		expect([first, second, fifth, container.innerHTML]).toStrictEqual([
			["⠋ ", "Thinking…", " 0s"],
			["⠙ ", "Thinking…", " 0s"],
			["terminal-line terminal-spinner", "⠋ ", "Pondering…", " 5s"],
			'<div class="terminal-line terminal-done" role="status">⏺ 5s</div>',
		]);
	});

	it("renders nothing before the first turn", () =>
	{
		const {container} = render(<TerminalSpinner isWorking={false} />);
		expect(container.innerHTML).toBe("");
	});
});

describe("TerminalSession", () =>
{
	function seeded(detail: unknown, transcript: TranscriptData | undefined)
	{
		vi.stubGlobal("fetch", async () => new Promise<never>(() => {}));
		const queryClient = new QueryClient();
		if (detail !== undefined) queryClient.setQueryData(sessionDetailQueryOptions("abc").queryKey, detail as never);
		if (transcript !== undefined) queryClient.setQueryData(transcriptQueryOptions("abc").queryKey, transcript);
		return () => (
			<QueryClientProvider client={queryClient}>
				<TerminalSession sessionId="abc" />
			</QueryClientProvider>
		);
	}

	const transcript = (records: unknown[]): TranscriptData => (
	{
		records: records as TranscriptData["records"],
		byteOffset: 0,
		startIndex: 0,
		precedingMessageCount: 0,
		hiddenUuids: [],
		cuts: [],
		chainVersion: "v",
		chapters: [],
		goalRows: [],
	});

	it("holds until the transcript loads, then draws its lines", async () =>
	{
		const {container} = await renderInRouter(
			seeded(
				undefined,
				transcript([
					{
						type: "user",
						uuid: "u1",
						sessionId: "abc",
						timestamp: "2026-11-17T00:00:00.000Z",
						message:
						{
							role: "user",
							content: "fix it",
						},
					},
				]),
			),
		);
		expect(container.querySelector(".epitaxy-terminal-view-column")?.innerHTML).toBe(
			'<div class="terminal-line terminal-prompt">fix it</div>',
		);
	});

	it("leaves for the normal view when the session is not found", async () =>
	{
		const {router} = await renderInRouter(seeded(null, undefined));
		expect(router.history.location.search).toBe("?pane=terminal");
	});
});
