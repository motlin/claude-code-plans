// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {FileRefsProvider} from "../src/components/file-refs-context";
import {SessionChat} from "../src/components/session-chat";
import {TurnWorkingContext} from "../src/components/turn-working-context";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
			codeThemeLight: "claude-light",
			codeThemeDark: "github-dark",
		},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => (
{
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		failedTools: new Map(),
	}),
}));

class FakeResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const prompt =
{
	type: "user",
	uuid: "u-prompt",
	message:
	{
		role: "user",
		content: "Fabricated request",
	},
};

interface Call
{
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	/** The call's result has not arrived yet. */
	pending?: true;
}

/** One assistant message making every call, then each call's result. */
function turn(calls: Call[], timestamp?: string): unknown[]
{
	return [
		prompt,
		{
			type: "assistant",
			uuid: "a1",
			...(timestamp === undefined
				? {}
				:
					{
						timestamp,
					}),
			message:
			{
				id: "msg-1",
				role: "assistant",
				content: calls.map(({id, name, input}) => (
				{
					type: "tool_use",
					id,
					name,
					input,
				})),
			},
		},
		...calls
			.filter((call) => call.pending !== true)
			.map(({id, result, isError}) => (
			{
				type: "user",
				uuid: `r-${id}`,
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content: result ?? "ok",
							...(isError === true
								?
									{
										is_error: true,
									}
								: {}),
						},
					],
				},
			})),
	];
}

function chat(calls: Call[], permissionWaitToolUseId: string | null = null, timestamp?: string): React.ReactElement
{
	const {lines, toolResultMap} = processTranscript(turn(calls, timestamp));
	return (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode="normal"
			showTools
			showThinking={false}
			shouldScrollToEnd={false}
			permissionWaitToolUseId={permissionWaitToolUseId}
		/>
	);
}

function draw(calls: Call[]): HTMLElement
{
	return render(chat(calls)).container;
}

const edit = (id: string, oldString: string, newString: string, extra: Partial<Call> = {}): Call => (
{
	id,
	name: "Edit",
	input:
	{
		file_path: "/repo/a.ts",
		old_string: oldString,
		new_string: newString,
	},
	result: "The file has been updated.",
	...extra,
});

const read = (id: string, path: string, range: Record<string, number> = {}): Call => (
{
	id,
	name: "Read",
	input:
	{
		file_path: path,
		...range,
	},
	result: "1\tx",
});

/** Waits for every stacked body's lazy renderer, so none loads after the test tears down. */
async function bodiesLoaded(root: Element | null | undefined): Promise<void>
{
	await waitFor(() =>
	{
		const steps = [...(root?.querySelectorAll("[data-step-key]") ?? [])];
		expect(steps.every((step) => (step.firstElementChild?.querySelector("*") ?? null) !== null)).toBe(true);
	});
}

function headers(container: HTMLElement): (string | null)[]
{
	return [...container.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button')].map(
		(row) => row.textContent,
	);
}

describe("same-target run row", () =>
{
	it("draws two Edits of one file as one row whose body stacks each call's body", async () =>
	{
		const container = draw([edit("e1", "a", "b\nc"), edit("e2", "d", "e\nf\ng")]);
		const closed =
		{
			groupToggles: container.querySelectorAll("button[aria-expanded]").length,
			headers: headers(container),
			anchor: container.querySelector("[data-tool-anchor]")?.getAttribute("data-tool-anchor"),
		};
		const toggle = container.querySelector<HTMLElement>("[data-cds-row-toggle]");
		if (toggle === null) throw new Error("no row toggle");
		fireEvent.click(toggle);
		const panel = container.querySelector("[data-cds-row-panel]");
		await bodiesLoaded(panel);

		expect(
			{
				closed,
				steps: [...(panel?.querySelectorAll("[data-step-key]") ?? [])].map((step) =>
					step.getAttribute("data-step-key"),
				),
				stepsClass: panel?.querySelector("[data-step-key]")?.parentElement?.className,
				nestedRows: panel?.querySelectorAll("[data-tool-row]").length,
			},
		).toStrictEqual(
			{
				closed:
				{
					groupToggles: 0,
					headers: ["Editeda.ts+5−25 added, 2 removed"],
					anchor: "e1 e2",
				},
				steps: ["e1", "e2"],
				stepsClass: "flex min-w-0 flex-col gap-sm",
				nestedRows: 0,
			},
		);
	});

	it("merges the ranges of repeated Reads of one file", () =>
	{
		const container = draw([
			read(
				"r1",
				"/repo/a.ts",
				{
					offset: 1,
					limit: 20,
				},
			),
			read(
				"r2",
				"/repo/a.ts",
				{
					offset: 40,
					limit: 21,
				},
			),
		]);
		expect(
			{
				headers: headers(container),
				range: container.querySelector('[id$="-range"]')?.textContent,
			},
		).toStrictEqual(
			{
				headers: ["Reada.ts(1–20, 40–60)"],
				range: "(1–20, 40–60)",
			},
		);
	});

	it("takes the run's outcome from its last call", () =>
	{
		const outcome = (calls: Call[]) =>
		{
			const container = draw(calls);
			const text = container.querySelector('[id$="-outcome"]')?.textContent ?? null;
			cleanup();
			return text;
		};
		expect(
			{
				lastFailed: outcome([
					edit("e1", "a", "b"),
					edit(
						"e2",
						"c",
						"d",
						{
							isError: true,
							result: "boom",
						},
					),
				]),
				firstFailed: outcome([
					edit(
						"e1",
						"a",
						"b",
						{
							isError: true,
							result: "boom",
						},
					),
					edit("e2", "c", "d"),
				]),
			},
		).toStrictEqual(
			{
				lastFailed: "Failed",
				firstFailed: null,
			},
		);
	});

	it("folds a same-target stretch inside a mixed group into one nested step", async () =>
	{
		const container = draw([
			{
				id: "b1",
				name: "Bash",
				input:
				{
					command: "ls",
				},
			},
			edit("e1", "a", "b\nc"),
			edit("e2", "d", "e\nf\ng"),
			read("r1", "/repo/b.ts"),
		]);
		const groupToggle = container.querySelector<HTMLElement>("button[aria-expanded]");
		if (groupToggle === null) throw new Error("no group toggle");
		fireEvent.click(groupToggle);
		const nested = [...container.querySelectorAll("[data-cds-row-panel] [data-tool-row]")];
		const editRow = nested[1];
		const editToggle = editRow?.querySelector<HTMLElement>('[role="button"]');
		if (editToggle === undefined || editToggle === null) throw new Error("no edit toggle");
		fireEvent.click(editToggle);
		await bodiesLoaded(editRow);

		expect(
			{
				labels: nested.map((row) => row.querySelector('[id$="-label"]')?.textContent),
				editStats: editRow?.querySelector('[role="button"]')?.textContent,
				editSteps: [...(editRow?.querySelectorAll("[data-step-key]") ?? [])].map((step) =>
					step.getAttribute("data-step-key"),
				),
			},
		).toStrictEqual(
			{
				labels: ["ls", "Edited a.ts", "Read b.ts"],
				editStats: "Edited a.ts+5−25 added, 2 removed",
				editSteps: ["e1", "e2"],
			},
		);
	});
});

/** A row's label pieces: its label slot's showing face, then its meta, range and outcome, in document order. */
/** Wraps `element` in a file-refs provider whose server says every path exists. */
function linked(element: React.ReactElement): React.ReactElement
{
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
		{
			const {paths} = JSON.parse(String(init?.body)) as
			{
				paths: string[];
			};
			return Promise.resolve(
				Response.json(
					{
						statuses: Object.fromEntries(paths.map((path) => [path, "exists"])),
					},
				),
			);
		}),
	);
	const client = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	return (
		<QueryClientProvider client={client}>
			<FileRefsProvider
				value={
				{
					sessionId: "test-session",
					cwd: "/repo",
					sessionPaths: [],
					open: vi.fn<() => void>(),
				}}
			>
				{element}
			</FileRefsProvider>
		</QueryClientProvider>
	);
}

/** Upstream's row subject FileLink on a run row's file meta (`data-cds-row-subject`, the full path, a linked bdi). */
async function fileMeta(container: HTMLElement): Promise<Record<string, unknown>>
{
	const meta = container.querySelector<HTMLElement>("[data-tool-row] [id$='-meta']");
	await waitFor(() =>
	{
		expect(meta?.querySelector("[data-file-ref] > bdi")).not.toBeNull();
	});
	return {
		subject: meta?.getAttribute("data-cds-row-subject"),
		title: meta?.getAttribute("title"),
		className: meta?.className,
		link: meta?.querySelector("[data-file-ref]")?.getAttribute("data-file-path"),
		name: meta?.querySelector("bdi")?.textContent,
	};
}

const FILE_META =
{
	subject: "",
	title: "/repo/a.ts",
	className:
		"min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em] text-body text-secondary group-hover/tool:text-primary group-focus-visible/tool:text-primary group-has-[:focus-visible]/tool:text-primary",
	link: "/repo/a.ts",
	name: "a.ts",
};

function rowParts(container: HTMLElement): string[]
{
	const row = container.querySelector('[data-tool-row] > [role="button"], [data-tool-row] > button');
	if (row === null) return [];
	return [
		...row.querySelectorAll<HTMLElement>(
			'[data-morph-key]:not([aria-hidden]), [id$="-meta"], [id$="-range"], [id$="-outcome"]',
		),
	].map((part) => part.textContent);
}

describe("busy same-target run row (upstream mergeLiveLoneStep)", () =>
{
	const pendingEdit = (id: string) =>
		edit(
			id,
			"c",
			"d",
			{
				pending: true,
			},
		);

	it("draws a run with a member in flight as one busy row: live verb, the file as its own meta, mark and sr label", async () =>
	{
		const container = render(chat([edit("e1", "a", "b"), pendingEdit("e2")])).container;
		const row = container.querySelector("[data-tool-row]");
		const toggle = container.querySelector<HTMLElement>("[data-cds-row-toggle]");
		if (toggle === null) throw new Error("no row toggle");
		const closed =
		{
			groupToggles: container.querySelectorAll("button[aria-expanded]").length,
			rows: container.querySelectorAll("[data-tool-row]").length,
			parts: rowParts(container),
			metaInShimmer: row?.querySelector("[id$='-meta']")?.closest("[data-shimmering]") !== null,
			marks: row?.querySelectorAll('[data-cds="WorkingMark"]').length,
			status: row?.querySelector('[role="status"]')?.textContent,
		};
		fireEvent.click(toggle);
		const panel = container.querySelector("[data-cds-row-panel]");
		await bodiesLoaded(panel);
		expect(
			{
				...closed,
				steps: [...(panel?.querySelectorAll("[data-step-key]") ?? [])].map((step) =>
					step.getAttribute("data-step-key"),
				),
			},
		).toStrictEqual(
			{
				groupToggles: 0,
				rows: 1,
				parts: ["Editing", "a.ts"],
				metaInShimmer: false,
				marks: 1,
				status: "Editing a.ts",
				steps: ["e1", "e2"],
			},
		);
		cleanup();
		const busyMeta = await fileMeta(render(linked(chat([edit("e1", "a", "b"), pendingEdit("e2")]))).container);
		cleanup();
		const settledMeta = await fileMeta(
			render(linked(chat([edit("e1", "a", "b"), edit("e2", "c", "d")]))).container,
		);
		expect([busyMeta, settledMeta]).toStrictEqual([FILE_META, FILE_META]);
	});

	it("keeps the merged row while the member in flight waits on a permission prompt", () =>
	{
		const container = render(chat([edit("e1", "a", "b"), pendingEdit("e2")], "e2")).container;
		expect(
			{
				groupToggles: container.querySelectorAll("button[aria-expanded]").length,
				rows: container.querySelectorAll("[data-tool-row]").length,
				parts: rowParts(container),
				state: container.querySelector("[data-morph-key]:not([aria-hidden])")?.getAttribute("data-morph-key"),
			},
		).toStrictEqual(
			{
				groupToggles: 0,
				rows: 1,
				parts: ["Editing", "a.ts"],
				state: "blocked|Editing",
			},
		);
	});

	it("counts the busy row's elapsed from the turn start, not the pending call's, across members (upstream QS hnS)", () =>
	{
		const turnStartedAt = Date.now() - 9000;
		const callStartedAt = new Date().toISOString();
		const working = (calls: Call[]) => (
			<TurnWorkingContext.Provider value={turnStartedAt}>
				{chat(calls, null, callStartedAt)}
			</TurnWorkingContext.Provider>
		);
		const elapsed = (container: HTMLElement) =>
			container.querySelector("[data-tool-row] [data-running-elapsed]")?.textContent;
		const {container, rerender} = render(working([pendingEdit("e1")]));
		const first = elapsed(container);
		rerender(working([edit("e1", "a", "b"), pendingEdit("e2")]));
		expect([first, elapsed(container)]).toStrictEqual(["9s", "9s"]);
	});

	describe("holds the run's live words for 650ms (upstream LC + relabelStep, subjectOf)", () =>
	{
		beforeEach(() =>
		{
			vi.useFakeTimers(
				{
					toFake: ["setTimeout", "clearTimeout", "performance"],
				},
			);
		});
		afterEach(() =>
		{
			vi.useRealTimers();
		});

		function advance(ms: number): void
		{
			act(() =>
			{
				vi.advanceTimersByTime(ms);
			});
		}

		it("keeps a finished member's present tense for 650ms, then settles at once", () =>
		{
			const {container, rerender} = render(chat([edit("e1", "a", "b"), pendingEdit("e2")]));
			rerender(chat([edit("e1", "a", "b"), edit("e2", "c", "d")]));
			const finished = rowParts(container);
			advance(649);
			const held = rowParts(container);
			advance(1);
			expect([finished, held, rowParts(container)]).toStrictEqual([
				["Editing", "a.ts"],
				["Editing", "a.ts"],
				["Edited", "a.ts"],
			]);
		});

		it("keeps a finished member's present tense while the turn works, then settles at once when it stops", () =>
		{
			const turnStartedAt = Date.now();
			const working = (calls: Call[], turnStart: number | null) => (
				<TurnWorkingContext.Provider value={turnStart}>{chat(calls)}</TurnWorkingContext.Provider>
			);
			const {container, rerender} = render(working([edit("e1", "a", "b"), pendingEdit("e2")], turnStartedAt));
			rerender(working([edit("e1", "a", "b"), edit("e2", "c", "d")], turnStartedAt));
			const finished = rowParts(container);
			advance(649);
			const held = rowParts(container);
			advance(4351);
			const gap = rowParts(container);
			rerender(working([edit("e1", "a", "b"), edit("e2", "c", "d")], null));
			expect([finished, held, gap, rowParts(container)]).toStrictEqual([
				["Editing", "a.ts"],
				["Editing", "a.ts"],
				["Editing", "a.ts"],
				["Edited", "a.ts"],
			]);
		});

		it("treats a lone file call as a run of one: it keeps its present tense for 650ms after finishing", () =>
		{
			const {container, rerender} = render(chat([pendingEdit("e1")]));
			rerender(chat([edit("e1", "c", "d")]));
			const finished = rowParts(container);
			advance(649);
			const held = rowParts(container);
			advance(1);
			expect([finished, held, rowParts(container)]).toStrictEqual([
				["Editing", "a.ts"],
				["Editing", "a.ts"],
				["Edited", "a.ts"],
			]);
		});

		it.each([
			{
				start: "a run of two",
				before: [edit("e1", "a", "b")],
			},
			{
				start: "a lone file call",
				before: [],
			},
		])(
			"keeps $start's words and file on the group row for 650ms after a different target joins, then settles the new label in 250ms",
			({before}) =>
			{
				const {container, rerender} = render(chat([...before, pendingEdit("e2")]));
				rerender(
					chat([
						...before,
						edit("e2", "c", "d"),
						{
							...read("r1", "/repo/b.ts"),
							pending: true,
						},
					]),
				);
				const header = () =>
				{
					const toggle = container.querySelector("button[aria-expanded]");
					return {
						parts: rowParts(container),
						status: toggle?.closest("[data-tool-row]")?.querySelector('[role="status"]')?.textContent,
					};
				};
				const handedOff = header();
				advance(649);
				const held = header();
				advance(1);
				const swapped = header();
				advance(249);
				const settling = header();
				advance(1);
				expect([handedOff, held, swapped, settling, header()]).toStrictEqual([
					{
						parts: ["Editing", "a.ts"],
						status: "Editing a.ts",
					},
					{
						parts: ["Editing", "a.ts"],
						status: "Editing a.ts",
					},
					{
						parts: ["Editing", "a.ts"],
						status: "Editing a.ts",
					},
					{
						parts: ["Editing", "a.ts"],
						status: "Editing a.ts",
					},
					{
						parts: ["Reading b.ts"],
						status: "Reading b.ts",
					},
				]);
			},
		);
	});
});
