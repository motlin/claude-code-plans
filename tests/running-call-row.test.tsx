// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import
{
	type BackgroundTasksOpener,
	BackgroundTasksOpenerProvider,
} from "../src/components/background-tasks-opener-context";
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
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(
		HTMLElement.prototype,
		"scrollIntoView",
		{
			configurable: true,
			value: vi.fn<HTMLElement["scrollIntoView"]>(),
		},
	);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[]): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

describe("an in-flight call's row", () =>
{
	it("leads with upstream's activity WorkingMark and follows the label with the live elapsed time", () =>
	{
		const records = [
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Check the login",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 22_000).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_running",
							name: "Bash",
							input:
							{
								command: "ssh -T git@github.com",
								description: "Recheck SSH auth",
							},
						},
					],
				},
			},
		];
		const container = renderRecords(records);
		const rows = [...container.querySelectorAll(".group\\/tool")].filter((row) =>
			row.textContent.includes("Rechecking SSH auth"),
		);
		const row = rows[0];

		expect(
			{
				rows: rows.length,
				spinner: row?.querySelector(".running-spinner") ?? null,
				mark: row?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
				markClass: row?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("class"),
				slotClass: row?.querySelector("[data-cds-row-mark]")?.getAttribute("class"),
				slotHolds: row?.querySelector("[data-cds-row-mark] [data-cds=WorkingMark]") !== null,
				elapsed: /^\d+s$/.test(row?.querySelector("[data-running-elapsed]")?.textContent ?? ""),
				chevron: row?.querySelector("svg[width='12']") !== null,
			},
		).toStrictEqual(
			{
				rows: 1,
				spinner: null,
				mark: "code",
				markClass: "relative block shrink-0 select-none",
				slotClass:
					"relative flex h-[1lh] shrink-0 items-center justify-center w-[20px] me-[calc(12px_-_var(--cds-gap-xs))]",
				slotHolds: true,
				elapsed: true,
				chevron: true,
			},
		);
	});

	it("plays the read sprite for an in-flight Read row", () =>
	{
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Look at the app",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 5000).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_read",
							name: "Read",
							input:
							{
								file_path: "/repo/src/app.ts",
							},
						},
					],
				},
			},
		]);
		expect(
			[...container.querySelectorAll('[data-cds="WorkingMark"]')].map((mark) =>
				mark.getAttribute("data-activity"),
			),
		).toStrictEqual(["read"]);
	});

	it("shows the row's elapsed time only from 2s, as upstream does", () =>
	{
		const runningRecords = (startedMsAgo: number) => [
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Check the login",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - startedMsAgo).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_running",
							name: "Bash",
							input:
							{
								command: "ssh -T git@github.com",
								description: "Recheck SSH auth",
							},
						},
					],
				},
			},
		];
		const elapsedTexts = (startedMsAgo: number) =>
		{
			const container = renderRecords(runningRecords(startedMsAgo));
			const texts = [...container.querySelectorAll("[data-running-elapsed]")].map((el) => el.textContent);
			cleanup();
			return texts;
		};
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
		try
		{
			expect(
				{
					early: elapsedTexts(1_000),
					atTwo: elapsedTexts(2_000),
				},
			).toStrictEqual(
				{
					early: [],
					atTwo: ["2s"],
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("leads an in-flight group header with the call's mark, then the shimmer label, elapsed time and an sr 'running'", () =>
	{
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Check the login",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 30_000).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_read",
							name: "Read",
							input:
							{
								file_path: "/repo/a.ts",
							},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "result-1",
				parentUuid: "assistant-1",
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_read",
							content: "ok",
						},
					],
				},
			},
			{
				type: "assistant",
				uuid: "assistant-2",
				timestamp: new Date(Date.now() - 22_000).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_running",
							name: "Bash",
							input:
							{
								command: "ssh -T git@github.com",
								description: "Recheck SSH auth",
							},
						},
					],
				},
			},
		]);
		const header = container.querySelector("button[aria-controls].group\\/tool");
		expect(
			{
				children: [...(header?.firstElementChild?.children ?? [])].map(
					(child) => child.getAttribute("data-cds") ?? child.getAttribute("class"),
				),
				mark: header?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
				label: header?.querySelector('[data-cds="ShimmerText"]')?.firstChild?.textContent,
				elapsed: /^2\ds$/.test(header?.querySelector("[data-running-elapsed]")?.textContent ?? ""),
				srOnly: header?.querySelector(".sr-only")?.textContent,
			},
		).toStrictEqual(
			{
				children: [
					"relative flex h-[1lh] shrink-0 items-center justify-center w-[20px] me-[calc(12px_-_var(--cds-gap-xs))]",
					"group/morph inline-grid items-center justify-items-start data-[gliding]:overflow-x-clip min-w-0 max-w-full",
					"shrink-0 text-body text-secondary tabular-nums",
					"sr-only",
				],
				mark: "code",
				label: "Rechecking SSH auth",
				elapsed: true,
				srOnly: "running",
			},
		);
	});

	it("offers 'View live output' on a background command whose task still runs, opening the Background tasks pane at its task", () =>
	{
		const opened = vi.fn<BackgroundTasksOpener["open"]>();
		const {lines, toolResultMap} = processTranscript([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Benchmark it",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 5_000).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_background",
							name: "Bash",
							input:
							{
								command: "./gradlew jmh",
								description: "After JMH finishes, git test the three new candidates",
								run_in_background: true,
							},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "user-2",
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_background",
							content: "Command running in background with ID: bjmh100",
						},
					],
				},
			},
		]);
		const {getByRole} = render(
			<BackgroundTasksOpenerProvider
				value={
				{
					open: opened,
					running: new Map([["toolu_background", "bjmh100"]]),
				}}
			>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showCompactSummaries={true}
					showTranscriptOnly={true}
					shouldScrollToEnd={false}
					transcriptMode="normal"
				/>
			</BackgroundTasksOpenerProvider>,
		);
		const button = getByRole(
			"button",
			{
				name: "View live output",
			},
		);
		fireEvent.click(button);

		expect(
			{
				className: button.className,
				opened: opened.mock.calls,
			},
		).toStrictEqual(
			{
				className:
					"shrink-0 cursor-pointer rounded-r3 text-body text-primary underline-offset-[3px] hover:underline",
				opened: [
					[
						{
							taskId: "bjmh100",
						},
					],
				],
			},
		);
	});

	function renderBackgroundAgent(description: string, running: ReadonlyMap<string, string>): Element | undefined
	{
		const {lines, toolResultMap} = processTranscript([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Do the tasks",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_agent",
							name: "Agent",
							input:
							{
								description,
								prompt: "p",
								run_in_background: true,
							},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "user-2",
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_agent",
							content: "Async agent launched successfully.\nagentId: a1b2c3",
						},
					],
				},
			},
		]);
		const {container} = render(
			<BackgroundTasksOpenerProvider
				value={
				{
					open: vi.fn<BackgroundTasksOpener["open"]>(),
					running,
				}}
			>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showCompactSummaries={true}
					showTranscriptOnly={true}
					shouldScrollToEnd={false}
					transcriptMode="normal"
				/>
			</BackgroundTasksOpenerProvider>,
		);
		return container.querySelector(".group\\/tool") ?? undefined;
	}

	function agentRowFacts(row: Element | undefined)
	{
		return {
			text: row?.textContent,
			state: row?.getAttribute("data-state") ?? null,
			shimmer: row?.querySelector("[data-cds=ShimmerText]")?.firstChild?.textContent ?? null,
			variant: row?.querySelector("[data-cds=ShimmerText]")?.getAttribute("data-variant") ?? null,
			srOnly: row?.querySelector(".sr-only")?.textContent ?? null,
		};
	}

	it("labels a still-running background Agent in the present tense with shimmer, as upstream does", () =>
	{
		expect(
			{
				inflected: agentRowFacts(renderBackgroundAgent("Do task M1-42", new Map([["toolu_agent", "a1b2c3"]]))),
				bare: agentRowFacts(
					renderBackgroundAgent("Mobile audit: session page", new Map([["toolu_agent", "a1b2c3"]])),
				),
			},
		).toStrictEqual(
			{
				inflected:
				{
					text: "Doing task M1-42running",
					state: "busy",
					shimmer: "Doing task M1-42",
					variant: "secondary",
					srOnly: "running",
				},
				bare:
				{
					text: "Mobile audit: session pagerunning",
					state: "busy",
					shimmer: "Mobile audit: session page",
					variant: "secondary",
					srOnly: "running",
				},
			},
		);
	});

	it("settles a background Agent whose task has finished on its 'Ran agent' row", () =>
	{
		expect(agentRowFacts(renderBackgroundAgent("Do task M1-42", new Map()))).toStrictEqual(
			{
				text: "Ran agentDo task M1-42",
				state: null,
				shimmer: null,
				variant: null,
				srOnly: null,
			},
		);
	});

	it("draws no message actions under a turn still waiting on its question, as upstream leaves the gap to the next row", () =>
	{
		const ask =
		{
			type: "assistant",
			uuid: "assistant-q",
			timestamp: "2026-10-13T22:40:00.000Z",
			message:
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_question",
						name: "AskUserQuestion",
						input:
						{
							questions: [
								{
									question: "Which PRs?",
									header: "PRs",
									options: [
										{
											label: "A",
										},
										{
											label: "B",
										},
									],
								},
							],
						},
					},
				],
			},
		};
		const pending = renderRecords([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Open PRs",
				},
			},
			ask,
		]);
		const pendingFooters = pending.querySelectorAll("[data-assistant-span-footer]").length;
		cleanup();
		const answered = renderRecords([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Open PRs",
				},
			},
			ask,
			{
				type: "user",
				uuid: "user-2",
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_question",
							content:
								'User has answered your questions: "Which PRs?"="A". You can now continue with the user\'s answers in mind.',
						},
					],
				},
			},
		]);

		expect(
			{
				pending: pendingFooters,
				answered: answered.querySelectorAll("[data-assistant-span-footer]").length,
			},
		).toStrictEqual(
			{
				pending: 0,
				answered: 1,
			},
		);
	});
});

describe("a status row's accessible name", () =>
{
	// The text each aria-labelledby id names, skipping aria-hidden subtrees, joined as accname does.
	const labelledByText = (toggle: Element) =>
		(toggle.getAttribute("aria-labelledby") ?? "")
			.split(" ")
			.map((id) =>
			{
				const copy = document.getElementById(id)?.cloneNode(true);
				if (!(copy instanceof Element)) return "";
				for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
				return copy.textContent;
			})
			.join(" ");
	const toggleNames = (container: HTMLElement) =>
		[...container.querySelectorAll("[aria-labelledby]")].map((toggle) => (
		{
			name: labelledByText(toggle),
			ids: (toggle.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => id.replace(/^.*-/, "")),
		}));

	it("labels a failed row's toggle by its label then its outcome, and announces both, as upstream does", () =>
	{
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Fetch it",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_fetch",
							name: "WebFetch",
							input:
							{
								url: "https://example.com",
								prompt: "x",
							},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "user-2",
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_fetch",
							content: "boom",
							is_error: true,
						},
					],
				},
			},
		]);
		expect(
			{
				toggles: toggleNames(container),
				announced: [...container.querySelectorAll('[role="status"][aria-live="polite"].sr-only')].map(
					(status) => status.textContent,
				),
			},
		).toStrictEqual(
			{
				toggles: [
					{
						name: "Fetching https://example.com Failed",
						ids: ["label", "meta", "outcome"],
					},
				],
				announced: ["Fetching https://example.com Failed"],
			},
		);
	});

	it("labels a busy Read row by its label then an sr 'running'", () =>
	{
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-1",
				message:
				{
					role: "user",
					content: "Look at the app",
				},
			},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 5000).toISOString(),
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_read",
							name: "Read",
							input:
							{
								file_path: "/repo/src/app.ts",
							},
						},
					],
				},
			},
		]);
		expect(toggleNames(container)).toStrictEqual([
			{
				name: "Reading app.ts running",
				ids: ["label", "meta", "busy"],
			},
		]);
	});
});

describe("a status row's morph slot", () =>
{
	const FACE_CLASS =
		"col-start-1 row-start-1 flex min-w-0 max-w-full items-center group-data-[gliding]/morph:max-w-none";
	const SLOT_CLASS =
		"group/morph inline-grid items-center justify-items-start data-[gliding]:overflow-x-clip min-w-0 max-w-full";
	const prompt =
	{
		type: "user",
		uuid: "user-1",
		message:
		{
			role: "user",
			content: "Look",
		},
	};
	const toolUse = (uuid: string, id: string, name: string, input: Record<string, unknown>) => (
	{
		type: "assistant",
		uuid,
		timestamp: new Date(Date.now() - 5000).toISOString(),
		message:
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id,
					name,
					input,
				},
			],
		},
	});
	const toolResult = (uuid: string, id: string, content: string, isError = false) => (
	{
		type: "user",
		uuid,
		message:
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content,
					...(isError
						?
							{
								is_error: true,
							}
						: {}),
				},
			],
		},
	});
	const readA = toolUse(
		"assistant-1",
		"toolu_read",
		"Read",
		{
			file_path: "/repo/a.ts",
		},
	);
	const readResult = toolResult("result-1", "toolu_read", "ok");

	function chat(records: unknown[])
	{
		const {lines, toolResultMap} = processTranscript(records);
		return (
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showCompactSummaries={true}
				showTranscriptOnly={true}
				shouldScrollToEnd={false}
				transcriptMode="normal"
			/>
		);
	}

	const faces = (slot: Element | null | undefined) =>
		[...(slot?.children ?? [])].map((face) => (
		{
			key: face.getAttribute("data-morph-key"),
			hidden: face.getAttribute("aria-hidden"),
			text: face.textContent,
		}));

	function installFakeAnimate(): void
	{
		HTMLElement.prototype.animate = function animate(): Animation
		{
			return {
				finished: new Promise<Animation>(() => {}),
				cancel: () =>
				{
				},
				playState: "running",
				startTime: null,
				effect:
				{
					getComputedTiming: () => (
					{
						progress: 0,
					}),
				},
			} as unknown as Animation;
		};
	}

	afterEach(() =>
	{
		Reflect.deleteProperty(HTMLElement.prototype, "animate");
	});

	/** Completes the Read, then lets its group's 650ms live-key hold (upstream `LC`) lapse so the row settles. */
	function complete(view: ReturnType<typeof render>): void
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout", "performance"],
			},
		);
		try
		{
			view.rerender(chat([prompt, readA, readResult]));
			act(() =>
			{
				vi.advanceTimersByTime(650);
			});
		}
		finally
		{
			vi.useRealTimers();
		}
	}

	it("seats a settled Read row's label in a done|Read face on the -label slot, beside its meta", () =>
	{
		const {container} = render(chat([prompt, readA, readResult]));
		const toggle = container.querySelector("[aria-labelledby]");
		const labelId = toggle?.getAttribute("aria-labelledby")?.split(" ")[0] ?? "";
		const slot = document.getElementById(labelId);
		expect(
			{
				slotClass: slot?.className,
				faceClass: slot?.firstElementChild?.className,
				faces: faces(slot),
			},
		).toStrictEqual(
			{
				slotClass: `${SLOT_CLASS} shrink-0`,
				faceClass: FACE_CLASS,
				faces: [
					{
						key: "done|Read",
						hidden: null,
						text: "Read",
					},
				],
			},
		);
	});

	it("cross-fades a row from busy|Reading to done|Read when its call completes", () =>
	{
		installFakeAnimate();
		const view = render(chat([prompt, readA]));
		complete(view);
		const toggle = view.container.querySelector("[aria-labelledby]");
		const labelId = toggle?.getAttribute("aria-labelledby")?.split(" ")[0] ?? "";
		expect(faces(document.getElementById(labelId))).toStrictEqual([
			{
				key: "busy|Reading",
				hidden: "true",
				text: "Reading",
			},
			{
				key: "done|Read",
				hidden: null,
				text: "Read",
			},
		]);
	});

	it("keeps a settled row's mark slot while upstream's 400ms leave plays, then drops it", async () =>
	{
		let finish = () =>
		{
		};
		const finished = new Promise<void>((resolve) =>
		{
			finish = resolve;
		});
		const keyframes: unknown[] = [];
		HTMLElement.prototype.animate = function animate(
			frames: Keyframe[] | PropertyIndexedKeyframes | null,
		): Animation
		{
			if (this.hasAttribute("data-cds-row-mark")) keyframes.push(frames);
			return {
				finished,
				cancel: () =>
				{
				},
				playState: "running",
				startTime: null,
				effect:
				{
					getComputedTiming: () => (
					{
						progress: 0,
					}),
				},
			} as unknown as Animation;
		};
		const view = render(chat([prompt, readA]));
		const busy = view.container.querySelectorAll("[data-cds-row-mark]").length;
		complete(view);
		await act(async () =>
		{
			await Promise.resolve();
		});
		const leaving = view.container.querySelectorAll("[data-cds-row-mark]").length;
		await act(async () =>
		{
			finish();
			await finished;
		});
		expect(
			{
				busy,
				leaving,
				leaves: keyframes.length,
				left: view.container.querySelectorAll("[data-cds-row-mark]").length,
			},
		).toStrictEqual(
			{
				busy: 1,
				leaving: 1,
				leaves: 1,
				left: 0,
			},
		);
	});

	it("keys a failed row failed|<label> and keeps its outcome outside the slot", () =>
	{
		const {container} = render(
			chat([
				prompt,
				toolUse(
					"assistant-1",
					"toolu_fetch",
					"WebFetch",
					{
						url: "https://example.com",
						prompt: "x",
					},
				),
				toolResult("result-1", "toolu_fetch", "boom", true),
			]),
		);
		const ids = container.querySelector("[aria-labelledby]")?.getAttribute("aria-labelledby")?.split(" ") ?? [];
		const slot = document.getElementById(ids[0] ?? "");
		const outcome = document.getElementById(ids.at(-1) ?? "");
		expect(
			{
				faces: faces(slot),
				outcome: outcome?.textContent,
				outcomeInSlot: slot?.contains(outcome ?? null),
			},
		).toStrictEqual(
			{
				faces: [
					{
						key: "failed|Fetching",
						hidden: null,
						text: "Fetching",
					},
				],
				outcome: "Failed",
				outcomeInSlot: false,
			},
		);
	});

	it("swaps a group header from its busy running label to the done| counted line", () =>
	{
		installFakeAnimate();
		const bash = toolUse(
			"assistant-2",
			"toolu_bash",
			"Bash",
			{
				command: "ls",
				description: "List files",
			},
		);
		const view = render(chat([prompt, readA, readResult, bash]));
		const header = () => view.container.querySelector("button[aria-controls].group\\/tool");
		const busySlot = header()?.querySelector(".group\\/morph");
		const busy =
		{
			id: busySlot?.id.endsWith("-label"),
			faces: faces(busySlot),
		};
		view.rerender(chat([prompt, readA, readResult, bash, toolResult("result-2", "toolu_bash", "a.ts")]));
		const doneSlot = header()?.querySelector(".group\\/morph");
		expect(
			{
				busy,
				same: doneSlot === busySlot,
				done: faces(doneSlot).map(({key, hidden}) => (
				{
					key,
					hidden,
				})),
			},
		).toStrictEqual(
			{
				busy:
				{
					id: true,
					faces: [
						{
							key: "busy|Listing files",
							hidden: null,
							text: "Listing files",
						},
					],
				},
				same: true,
				done: [
					{
						key: "busy|Listing files",
						hidden: "true",
					},
					{
						key: "done|",
						hidden: null,
					},
				],
			},
		);
	});
});
