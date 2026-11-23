// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, renderHook, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {BackgroundTasksList} from "../src/components/panes/background-tasks-pane";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {resetStoppingTasks, useBackgroundTaskStop} from "../src/hooks/use-background-task-stop";
import type {BackgroundTask, BackgroundTaskGroups} from "../src/lib/background-tasks";
import {requestBackgroundTaskFocus, setTaskRowsOpen} from "../src/lib/background-task-focus";
import {iconFontSize} from "../src/lib/icon-sizes";
import {defaultPaneLayout} from "../src/lib/pane-layout";
import {takePendingSubagentFocus} from "../src/lib/subagent-focus-requests";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function hostOpening(openPane: PaneHostApi["openPane"]): PaneHostApi
{
	return {
		layout: defaultPaneLayout(),
		openKinds: [],
		isOpen: () => false,
		openPane,
		closePane: () =>
		{
		},
		togglePane: () =>
		{
		},
	};
}

function withPaneHost(host: PaneHostApi, node: ReactNode)
{
	return <PaneHostContext.Provider value={host}>{node}</PaneHostContext.Provider>;
}

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask
{
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
		completedAt: null,
		durationMs: null,
		...overrides,
	};
}

const GROUPS: BackgroundTaskGroups =
{
	running: [
		task(
			{
				id: "bfab1serve",
				description: "Serve the fabricated app",
				command: "pnpm dev",
			},
		),
		task(
			{
				id: "afab1review",
				kind: "agent",
				description: "Review the fabricated diff",
			},
		),
	],
	finished: [
		task(
			{
				id: "bfab1build",
				description: "Build the fabricated app",
				command: "pnpm build",
				status: "completed",
				output: "built in 1.2s",
			},
		),
	],
};

function sections()
{
	return screen.getAllByRole("heading").map((heading) => heading.textContent);
}

/** Each row's title text, in DOM order. */
function cards()
{
	return [...document.querySelectorAll("[data-background-task] [data-task-title]")].map((title) => title.textContent);
}

function finishedToggle()
{
	return screen.getByRole(
		"button",
		{
			name: /^Finished/,
		},
	);
}

const POLL_GROUPS: BackgroundTaskGroups =
{
	running: [],
	finished: [
		task(
			{
				id: "bfab1poll",
				description: "Poll PR",
				command: "gh pr checks 42 --watch",
				status: "completed",
				output: "all checks passed",
			},
		),
	],
};

function regionSummary(name: string)
{
	const region = screen.getByRole(
		"region",
		{
			name,
		},
	);
	return {
		tag: region.tagName,
		text: region.textContent,
		className: region.className,
		prompt: region.querySelector('[aria-hidden="true"]')?.textContent ?? null,
	};
}

const TASK_PRE =
	"max-h-[200px] overflow-y-auto rounded-sm font-mono text-code leading-5 text-muted-as-secondary focus-visible:shadow-focus focus-visible:outline-hidden whitespace-pre-wrap break-all";

describe("BackgroundTasksList", () =>
{
	it("groups running and finished rows under upstream's headings, Finished collapsed while something runs", () =>
	{
		render(<BackgroundTasksList groups={GROUPS} />);

		expect(
			{
				sections: sections(),
				cards: cards(),
				toggle: finishedToggle().getAttribute("aria-expanded"),
				meta: screen.queryByText("Bash · Running"),
			},
		).toStrictEqual(
			{
				sections: ["Running2", "Finished1"],
				cards: ["Serve the fabricated app", "Review the fabricated diff"],
				toggle: "false",
				meta: null,
			},
		);
	});

	it("expands the finished section on click", () =>
	{
		render(<BackgroundTasksList groups={GROUPS} />);

		fireEvent.click(finishedToggle());

		expect(
			{
				toggle: finishedToggle().getAttribute("aria-expanded"),
				cards: cards(),
			},
		).toStrictEqual(
			{
				toggle: "true",
				cards: ["Serve the fabricated app", "Review the fabricated diff", "Build the fabricated app"],
			},
		);
	});

	it("opens Finished by default when nothing runs, with the caret first in its toggle", () =>
	{
		render(<BackgroundTasksList groups={POLL_GROUPS} />);
		const toggle = finishedToggle();

		expect(
			{
				expanded: toggle.getAttribute("aria-expanded"),
				caretFirst: toggle.firstElementChild?.hasAttribute("data-task-caret"),
				parts: [...toggle.children].slice(1).map((part) => [part.textContent, part.className]),
				className: toggle.className,
				heading: toggle.closest("h3")?.className,
			},
		).toStrictEqual(
			{
				expanded: "true",
				caretFirst: true,
				parts: [
					["Finished", ""],
					["1", "text-ink-muted"],
				],
				className:
					"-mx-1.5 flex min-h-5 cursor-pointer items-center gap-1 rounded px-1.5 hide-focus-ring hover:text-secondary-control focus-visible:shadow-focus focus-visible:outline-hidden",
				heading: "flex min-h-5 items-center text-footnote text-muted-as-secondary",
			},
		);
	});

	it("latches Finished open after a click inside it, so collapsing that row keeps the section open", () =>
	{
		render(<BackgroundTasksList groups={GROUPS} />);
		fireEvent.click(finishedToggle());
		const row = screen.getByRole(
			"button",
			{
				name: "Background task: Build the fabricated app",
			},
		);

		fireEvent.click(row);
		fireEvent.click(row);

		expect(
			{
				finished: finishedToggle().getAttribute("aria-expanded"),
				row: row.getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				finished: "true",
				row: "false",
			},
		);
	});

	it("lays out upstream's pane content: 220px minimum, 32px between sections, density-aware pads", () =>
	{
		const {container} = render(<BackgroundTasksList groups={GROUPS} />);

		expect(
			{
				root: container.firstElementChild?.className,
				sections: [...container.querySelectorAll("section")].map((section) => section.className),
				lists: [...container.querySelectorAll("[data-task-list]")].map((list) => list.className),
			},
		).toStrictEqual(
			{
				root: "flex min-w-[220px] flex-col gap-8 px-p6 py-p6 comfortable:px-p8 comfortable:py-p8",
				sections: ["flex flex-col gap-g5 comfortable:gap-g6", "flex flex-col gap-g5 comfortable:gap-g6"],
				lists: ["@container flex flex-col gap-g5 comfortable:gap-g6"],
			},
		);
	});

	it("draws each task as upstream's rounded fill-card piece around a 44px row and a 36px opener", () =>
	{
		render(<BackgroundTasksList groups={GROUPS} />);
		const wrapper = document.querySelector('[data-task-id="bfab1serve"]');
		const piece = wrapper?.querySelector("[data-task-piece]");
		const row = piece?.firstElementChild;
		const opener = row?.querySelector("[data-task-opener]");
		const label = opener?.firstElementChild;

		expect(
			{
				wrapper: wrapper?.className,
				pieces: document.querySelectorAll("[data-task-piece]").length,
				piece: piece?.className,
				row: row?.className,
				step: row instanceof HTMLElement ? row.style.getPropertyValue("--task-step") : null,
				opener: opener?.className,
				label: label?.className,
				caretFirst: label?.firstElementChild?.hasAttribute("data-task-caret"),
				titleClass: label?.querySelector("[data-task-title]")?.className,
			},
		).toStrictEqual(
			{
				wrapper: "contents",
				pieces: 2,
				piece: "relative flex min-w-0 flex-col rounded-t-[10px] rounded-b-[10px] bg-fill-card",
				row: "group/row relative flex h-11 min-w-0 items-center px-1.5",
				step: "0",
				opener: "flex h-9 w-full min-w-0 items-center gap-g5 rounded ps-[calc(var(--task-step,0)*1.25rem+0.375rem)] pe-1.5 text-start text-body comfortable:gap-g6 cursor-pointer hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden active:bg-alpha-2 not-touch:group-has-[[data-task-stop]:hover]/row:bg-fill-ghost-hover",
				label: "flex min-w-0 flex-1 items-center gap-1 text-start text-body-medium text-primary",
				caretFirst: true,
				titleClass: "flex min-w-0",
			},
		);
	});

	it("titles finished rows in text-body and running ones in text-body-medium", () =>
	{
		render(<BackgroundTasksList groups={POLL_GROUPS} />);

		expect(document.querySelector("[data-task-opener]")?.firstElementChild?.className).toBe(
			"flex min-w-0 flex-1 items-center gap-1 text-start text-body text-primary",
		);
	});

	it("ends each row with its status: a narrow-hidden duration, Stopped, or a danger Failed, described by the opener", () =>
	{
		vi.useFakeTimers(
			{
				now: Date.parse("2026-09-28T10:01:05.000Z"),
			},
		);
		const groups: BackgroundTaskGroups =
		{
			running: [
				task(
					{
						id: "bfab1serve",
						description: "Serve",
						startedAt: "2026-09-28T10:00:00.000Z",
					},
				),
				task(
					{
						id: "bfab1untimed",
						description: "Untimed",
					},
				),
			],
			finished: [
				task(
					{
						id: "bfab1lint",
						description: "Lint",
						status: "failed",
					},
				),
				task(
					{
						id: "bfab1tail",
						description: "Tail",
						status: "stopped",
					},
				),
				task(
					{
						id: "bfab1test",
						description: "Test",
						status: "completed",
						durationMs: 8000,
					},
				),
			],
		};
		render(<BackgroundTasksList groups={groups} />);
		fireEvent.click(finishedToggle());
		const statusOf = (id: string) =>
		{
			const opener = document.querySelector(`[data-task-id="${id}"] [data-task-opener]`);
			const describedBy = opener?.getAttribute("aria-describedby");
			const status = describedBy == null ? null : document.getElementById(describedBy);
			return status === null
				? null
				:
					{
						text: status.textContent,
						className: status.className,
						inner: status.firstElementChild?.className,
					};
		};
		const STATUS = "shrink-0 text-end text-footnote text-muted-as-secondary tabular-nums";

		expect(
			{
				serve: statusOf("bfab1serve"),
				untimed: statusOf("bfab1untimed"),
				lint: statusOf("bfab1lint"),
				tail: statusOf("bfab1tail"),
				test: statusOf("bfab1test"),
			},
		).toStrictEqual(
			{
				serve:
				{
					text: "1m 05s",
					className: STATUS,
					inner: "@max-[296px]:hidden",
				},
				untimed: null,
				lint:
				{
					text: "Failed",
					className: STATUS,
					inner: "text-danger",
				},
				tail:
				{
					text: "Stopped",
					className: STATUS,
					inner: "",
				},
				test:
				{
					text: "8s",
					className: STATUS,
					inner: "@max-[296px]:hidden",
				},
			},
		);
	});

	it("names each card button after its task", () =>
	{
		render(<BackgroundTasksList groups={POLL_GROUPS} />);

		expect(
			screen
				.getByRole(
					"button",
					{
						name: "Background task: Poll PR",
					},
				)
				.getAttribute("aria-expanded"),
		).toBe("false");
	});

	it("expands a row into upstream's plain capped Command and Output pres, indented one step", () =>
	{
		render(<BackgroundTasksList groups={POLL_GROUPS} />);
		const card = screen.getByRole(
			"button",
			{
				name: "Background task: Poll PR",
			},
		);

		fireEvent.click(card);
		const detail = document.getElementById(card.getAttribute("aria-controls") ?? "");

		expect(
			{
				expanded: card.getAttribute("aria-expanded"),
				detail: detail?.className,
				step: detail?.style.getPropertyValue("--task-step"),
				inPiece: detail?.parentElement?.hasAttribute("data-task-piece"),
				command: regionSummary("Command for Poll PR"),
				output: regionSummary("Output for Poll PR"),
			},
		).toStrictEqual(
			{
				expanded: "true",
				detail: "flex flex-col pe-p6 pb-p6 ps-[calc(var(--task-step,0)*1.25rem+0.75rem)] select-text comfortable:pe-p8 comfortable:pb-p8 [&>div]:leading-5",
				step: "1",
				inPiece: true,
				command:
				{
					tag: "PRE",
					text: "$ gh pr checks 42 --watch",
					className: TASK_PRE,
					prompt: "$ ",
				},
				output:
				{
					tag: "PRE",
					text: "all checks passed",
					className: TASK_PRE,
					prompt: null,
				},
			},
		);
	});

	it("notes a task with no output: No output yet while it runs, No output captured. once finished", () =>
	{
		const groups: BackgroundTaskGroups =
		{
			running: [
				task(
					{
						id: "bfab1serve",
						description: "Serve",
					},
				),
			],
			finished: [
				task(
					{
						id: "bfab1build",
						description: "Build",
						status: "completed",
					},
				),
			],
		};
		render(<BackgroundTasksList groups={groups} />);
		fireEvent.click(finishedToggle());
		for (const name of ["Background task: Serve", "Background task: Build"])
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name,
					},
				),
			);
		}

		expect(["No output yet", "No output captured."].map((text) => screen.getByText(text).className)).toStrictEqual([
			"text-footnote text-muted-as-secondary",
			"text-footnote text-muted-as-secondary",
		]);
	});

	it("follows the output's tail as it grows, until the user scrolls up more than 16px", () =>
	{
		const running = (output: string): BackgroundTaskGroups => (
		{
			running: [
				task(
					{
						id: "bfab1tailfollow",
						description: "Follow",
						output,
					},
				),
			],
			finished: [],
		});
		const {rerender} = render(<BackgroundTasksList groups={running("one")} />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Follow",
				},
			),
		);
		const pre = screen.getByRole(
			"region",
			{
				name: "Output for Follow",
			},
		);
		Object.defineProperty(
			pre,
			"scrollHeight",
			{
				configurable: true,
				value: 500,
			},
		);
		Object.defineProperty(
			pre,
			"clientHeight",
			{
				configurable: true,
				value: 200,
			},
		);

		rerender(<BackgroundTasksList groups={running("one\ntwo")} />);
		const followed = pre.scrollTop;
		pre.scrollTop = 200;
		fireEvent.scroll(pre);
		rerender(<BackgroundTasksList groups={running("one\ntwo\nthree")} />);

		expect(
			{
				followed,
				afterScrollUp: pre.scrollTop,
			},
		).toStrictEqual(
			{
				followed: 500,
				afterScrollUp: 200,
			},
		);
	});

	it("gives a plain agent task no toggle but a View transcript button that opens its subagent", () =>
	{
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const sessionId = "5e5510a0-0000-4000-8000-0000000fab2a";
		const groups: BackgroundTaskGroups =
		{
			running: [
				task(
					{
						id: "afab1review",
						kind: "agent",
						description: "Review the fabricated diff",
					},
				),
				task(
					{
						id: "afab1summary",
						kind: "agent",
						description: "Summarise",
						summary: "Found 2 issues",
					},
				),
				task(
					{
						id: "bfab1serve",
						description: "Serve",
					},
				),
			],
			finished: [],
		};
		render(withPaneHost(hostOpening(openPane), <BackgroundTasksList groups={groups} sessionId={sessionId} />));
		const opener = (id: string) => document.querySelector(`[data-task-id="${id}"] [data-background-task]`);
		const view = screen.getByRole(
			"button",
			{
				name: "View transcript for Review the fabricated diff",
			},
		);

		fireEvent.click(view);

		expect(
			{
				review: [opener("afab1review")?.tagName, opener("afab1review")?.getAttribute("aria-expanded")],
				reviewCaret: opener("afab1review")?.querySelector("[data-task-caret]") ?? null,
				summary: opener("afab1summary")?.getAttribute("aria-expanded"),
				serve: opener("bfab1serve")?.getAttribute("aria-expanded"),
				viewOpener: view.hasAttribute("data-task-opener"),
				focus: takePendingSubagentFocus(sessionId),
				opened: openPane.mock.calls,
			},
		).toStrictEqual(
			{
				review: ["DIV", null],
				reviewCaret: null,
				summary: "false",
				serve: "false",
				viewOpener: true,
				focus: "afab1review",
				opened: [["subagents"]],
			},
		);
	});

	it("leaves Clear finished tasks to the pane header, out of the Finished heading", () =>
	{
		render(<BackgroundTasksList groups={GROUPS} />);
		fireEvent.click(finishedToggle());

		expect(
			{
				sections: sections(),
				clear: screen.queryByRole(
					"button",
					{
						name: "Clear finished tasks",
					},
				),
			},
		).toStrictEqual(
			{
				sections: ["Running2", "Finished1"],
				clear: null,
			},
		);
	});

	it("shows upstream's placeholder when there is no background work", () =>
	{
		render(
			<BackgroundTasksList
				groups={
				{
					running: [],
					finished: [],
				}}
			/>,
		);

		const title = screen.getByText("Background tasks appear here");
		expect(
			{
				tag: title.tagName,
				className: title.className,
				icon: title.previousElementSibling?.getAttribute("class")?.includes("text-muted-as-secondary"),
				old: screen.queryByText("No background tasks in this session."),
			},
		).toStrictEqual(
			{
				tag: "P",
				className: "max-w-[36ch] text-pretty break-words text-body text-primary",
				icon: true,
				old: null,
			},
		);
	});
});

describe("BackgroundTasksList list limit", () =>
{
	const finished = Array.from(
		{
			length: 105,
		},
		(_, index) =>
			task(
				{
					id: `bfab1done${String(index).padStart(3, "0")}`,
					description: `Done ${index}`,
					status: "completed",
				},
			),
	);
	const groups: BackgroundTaskGroups =
	{
		running: [],
		finished,
	};
	let session = 0;
	function nextSession(): string
	{
		session += 1;
		return `5e5510a0-0000-4000-8000-0000000f1a${String(session).padStart(2, "0")}`;
	}
	const rowCount = () => document.querySelectorAll("[data-task-id]").length;
	const showMore = () =>
		screen.queryByRole(
			"button",
			{
				name: "Show more",
			},
		);

	it("lists the first 100 rows, then Show more reveals the rest and focuses the first new row", () =>
	{
		render(<BackgroundTasksList groups={groups} />);
		const before = rowCount();
		const toggle = showMore();

		if (toggle !== null) fireEvent.click(toggle);

		expect(
			{
				before,
				expanded: toggle?.getAttribute("aria-expanded"),
				after: rowCount(),
				less: screen
					.getByRole(
						"button",
						{
							name: "Show less",
						},
					)
					.getAttribute("aria-expanded"),
				focused: document.activeElement?.closest("[data-task-id]")?.getAttribute("data-task-id"),
			},
		).toStrictEqual(
			{
				before: 100,
				expanded: "false",
				after: 105,
				less: "true",
				focused: "bfab1done100",
			},
		);
	});

	it("keeps an open row and a focus-requested row past the limit, in order, before Show more", () =>
	{
		vi.stubGlobal("requestAnimationFrame", () => 0);
		vi.stubGlobal("cancelAnimationFrame", () => undefined);
		const sessionId = nextSession();
		setTaskRowsOpen(sessionId, ["bfab1done102"], true);
		requestBackgroundTaskFocus(
			sessionId,
			{
				taskId: "bfab1done104",
				finished: true,
			},
		);

		render(<BackgroundTasksList groups={groups} sessionId={sessionId} />);
		const ids = [...document.querySelectorAll("[data-task-id]")].map((row) => row.getAttribute("data-task-id"));

		expect(
			{
				count: ids.length,
				tail: ids.slice(-3),
				lastBeforeToggle:
					showMore()?.previousElementSibling?.getAttribute("data-task-id") ??
					showMore()?.previousElementSibling,
			},
		).toStrictEqual(
			{
				count: 102,
				tail: ["bfab1done099", "bfab1done102", "bfab1done104"],
				lastBeforeToggle: "bfab1done104",
			},
		);
	});
});

const SESSION_ID = "5e5510a0-0000-4000-8000-00000000fab1";
const OUTPUT_FILE = "/private/tmp/claude-501/-Users-fab/dc5296db-0000-4000-8000-00000000fab1/tasks/bfab1lint.output";

function withQueryClient(node: ReactNode)
{
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
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function stubFetch(body: unknown)
{
	const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(Response.json(body)));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function fetchedUrls(fetchMock: ReturnType<typeof stubFetch>): string[]
{
	return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
}

const LINT_GROUPS: BackgroundTaskGroups =
{
	running: [
		task(
			{
				id: "bfab1lint",
				description: "Lint the fabricated app",
				command: "pnpm lint",
				summary: "Background command still running",
				outputFile: OUTPUT_FILE,
			},
		),
	],
	finished: [],
};

describe("BackgroundTasksList artifact links", () =>
{
	const ARTIFACT_GROUPS: BackgroundTaskGroups =
	{
		running: [
			task(
				{
					id: "afab1publish",
					kind: "agent",
					description: "Publish artifact https://claude.ai/code/artifact/fab1 now",
					summary: "Published",
				},
			),
			task(
				{
					id: "bfab1publish",
					description: "Publish artifact https://claude.ai/code/artifact/fab2",
					command: "true",
				},
			),
		],
		finished: [],
	};

	const TEXT_LINK =
		"text-upstream-accent hover:underline underline-offset-[1px] focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-r2";

	function cardOf(id: string)
	{
		const card = document.querySelector(`[data-task-id="${id}"]`);
		const row = card?.querySelector("[data-task-artifact-row]");
		const link = row?.querySelector("a");
		return {
			title: card?.querySelector("[data-background-task] [data-task-title]")?.textContent,
			titleLinks: card?.querySelectorAll("[data-background-task] a").length,
			label: card?.querySelector("[data-background-task]")?.getAttribute("aria-label"),
			artifactRow:
				row === undefined || row === null
					? null
					:
						{
							className: row.className,
							step: row.getAttribute("style"),
							links: row.querySelectorAll("a").length,
							link:
							{
								text: link?.textContent,
								href: link?.getAttribute("href"),
								target: link?.getAttribute("target"),
								rel: link?.getAttribute("rel"),
								className: link?.className,
							},
						},
		};
	}

	it("keeps a card title plain text and adds upstream's View artifact row for its first link, leaving bash cards plain", () =>
	{
		render(<BackgroundTasksList groups={ARTIFACT_GROUPS} />);

		expect(
			{
				agent: cardOf("afab1publish"),
				bash: cardOf("bfab1publish"),
			},
		).toStrictEqual(
			{
				agent:
				{
					title: "Publish artifact now",
					titleLinks: 0,
					label: "Background task: Publish artifact now",
					artifactRow:
					{
						className:
							"ps-[calc(var(--task-step,0)*1.25rem+0.75rem)] pe-md flex min-h-5 items-center pb-sm text-footnote",
						step: "--task-step: 1;",
						links: 1,
						link:
						{
							text: "View artifact",
							href: "https://claude.ai/code/artifact/fab1",
							target: "_blank",
							rel: "noreferrer",
							className: `shrink-0 ${TEXT_LINK}`,
						},
					},
				},
				bash:
				{
					title: "Publish artifact https://claude.ai/code/artifact/fab2",
					titleLinks: 0,
					label: "Background task: Publish artifact https://claude.ai/code/artifact/fab2",
					artifactRow: null,
				},
			},
		);
	});

	it("opening View artifact does not toggle the card", () =>
	{
		render(<BackgroundTasksList groups={ARTIFACT_GROUPS} />);
		const card = screen.getByRole(
			"button",
			{
				name: "Background task: Publish artifact now",
			},
		);

		fireEvent.click(
			screen.getByRole(
				"link",
				{
					name: "View artifact",
				},
			),
		);

		expect(card.getAttribute("aria-expanded")).toBe("false");
	});

	it("links the artifact word in an expanded agent card's summary, in upstream's footnote summary div", () =>
	{
		render(
			<BackgroundTasksList
				groups={
				{
					running: [],
					finished: [
						task(
							{
								id: "afab3done",
								kind: "agent",
								status: "completed",
								description: "Build the page",
								summary: "Done, see artifact https://claude.ai/code/artifact/fab3",
							},
						),
					],
				}}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Build the page",
				},
			),
		);

		const summary = document.querySelector(
			'[data-task-id="afab3done"] div.text-footnote.text-secondary.whitespace-pre-wrap.break-words',
		);
		expect(
			{
				tag: summary?.tagName,
				text: summary?.textContent,
				links: Array.from(summary?.querySelectorAll("a[data-artifact-link]") ?? [], (link) =>
					link.getAttribute("href"),
				),
			},
		).toStrictEqual(
			{
				tag: "DIV",
				text: "Done, see artifact",
				links: ["https://claude.ai/code/artifact/fab3"],
			},
		);
	});
});

describe("BackgroundTasksList touch summary", () =>
{
	const SUMMARY_CLASS =
		"hidden truncate pe-p6 pb-p5 ps-[calc(var(--task-step,0)*1.25rem+0.75rem)] text-body text-secondary [@media(pointer:coarse)]:block";

	it("shows a failed or stopped task's summary inline on coarse pointers only, and not for completed tasks", () =>
	{
		const groups: BackgroundTaskGroups =
		{
			running: [],
			finished: [
				task(
					{
						id: "bfab1lint",
						description: "Lint the fabricated app",
						status: "failed",
						summary: "Background command failed with exit code 1",
					},
				),
				task(
					{
						id: "bfab1tail",
						description: "Tail the logs",
						status: "stopped",
						summary: "Stopped by user",
					},
				),
				task(
					{
						id: "bfab1done",
						description: "Build",
						status: "completed",
						summary: "Background command completed",
					},
				),
			],
		};
		render(<BackgroundTasksList groups={groups} />);

		expect(
			[...document.querySelectorAll("[data-background-task-summary]")].map((span) => (
			{
				text: span.textContent,
				className: span.className,
			})),
		).toStrictEqual([
			{
				text: "Background command failed with exit code 1",
				className: SUMMARY_CLASS,
			},
			{
				text: "Stopped by user",
				className: SUMMARY_CLASS,
			},
		]);
	});
});

describe("BackgroundTasksList output file", () =>
{
	// Open rows outlive the pane per session, so collapse this suite's cards between tests.
	afterEach(() =>
	{
		setTaskRowsOpen(SESSION_ID, ["bfab1lint", "afab1review"], false);
	});

	it("fetches a task's output file only once its card expands, and shows it in the Output region", async () =>
	{
		const fetchMock = stubFetch(
			{
				status: "ok",
				output: "\u001b[32m0 problems\u001b[0m\n",
				truncated: false,
			},
		);
		render(withQueryClient(<BackgroundTasksList groups={LINT_GROUPS} sessionId={SESSION_ID} />));

		const beforeExpand = fetchedUrls(fetchMock);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Lint the fabricated app",
				},
			),
		);
		const region = await screen.findByRole(
			"region",
			{
				name: "Output for Lint the fabricated app",
			},
		);

		expect(
			{
				beforeExpand,
				urls: fetchedUrls(fetchMock),
				text: region.textContent,
			},
		).toStrictEqual(
			{
				beforeExpand: [],
				urls: [`/api/sessions/${SESSION_ID}/task-output?file=${encodeURIComponent(OUTPUT_FILE)}`],
				text: "0 problems\n",
			},
		);
	});

	it("notes when the output was truncated to its tail", async () =>
	{
		stubFetch(
			{
				status: "ok",
				output: "last line\n",
				truncated: true,
			},
		);
		render(withQueryClient(<BackgroundTasksList groups={LINT_GROUPS} sessionId={SESSION_ID} />));

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Lint the fabricated app",
				},
			),
		);

		expect((await screen.findByText("Showing the last 64 KB of output.")).tagName).toBe("P");
	});

	it("says the output is unavailable when the file was cleaned up", async () =>
	{
		stubFetch(
			{
				status: "missing",
			},
		);
		render(withQueryClient(<BackgroundTasksList groups={LINT_GROUPS} sessionId={SESSION_ID} />));

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Lint the fabricated app",
				},
			),
		);

		expect((await screen.findByText("Output unavailable")).tagName).toBe("P");
	});

	it("shows an agent task's result and never fetches its output file", () =>
	{
		const fetchMock = stubFetch(
			{
				status: "ok",
				output: '{"type":"user"}',
				truncated: false,
			},
		);
		const groups: BackgroundTaskGroups =
		{
			running: [
				task(
					{
						id: "afab1review",
						kind: "agent",
						description: "Review the fabricated diff",
						summary: 'Agent "Review the fabricated diff" finished',
						output: "The fabricated diff looks good.",
						outputFile: OUTPUT_FILE,
					},
				),
			],
			finished: [],
		};
		render(withQueryClient(<BackgroundTasksList groups={groups} sessionId={SESSION_ID} />));

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Review the fabricated diff",
				},
			),
		);

		expect(
			{
				urls: fetchedUrls(fetchMock),
				text: screen.getByRole(
					"region",
					{
						name: "Output for Review the fabricated diff",
					},
				).textContent,
			},
		).toStrictEqual(
			{
				urls: [],
				text: "The fabricated diff looks good.",
			},
		);
	});
});

describe("BackgroundTasksList focus requests", () =>
{
	let session = 0;
	function nextSession(): string
	{
		session += 1;
		return `5e5510a0-0000-4000-8000-0000000f0c${String(session).padStart(2, "0")}`;
	}

	function stubFrames()
	{
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
		{
			callback(0);
			return 0;
		});
		vi.stubGlobal("cancelAnimationFrame", () => undefined);
		return vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
	}

	function expandedCards()
	{
		return [...document.querySelectorAll('button[data-background-task][aria-expanded="true"]')].map((button) =>
			button.getAttribute("aria-label"),
		);
	}

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("opens Finished, expands and scrolls to a task requested before the pane mounts, without moving focus", () =>
	{
		const scroll = stubFrames();
		const sessionId = nextSession();
		requestBackgroundTaskFocus(
			sessionId,
			{
				taskId: "bfab1build",
				finished: true,
			},
		);

		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		expect(
			{
				finished: finishedToggle().getAttribute("aria-expanded"),
				card: screen
					.getByRole(
						"button",
						{
							name: "Background task: Build the fabricated app",
						},
					)
					.getAttribute("aria-expanded"),
				scrollCalls: scroll.mock.calls,
				scrolled: scroll.mock.contexts.map((element) =>
					(element as Element).closest("[data-task-id]")?.getAttribute("data-task-id"),
				),
				active: document.activeElement === document.body,
			},
		).toStrictEqual(
			{
				finished: "true",
				card: "true",
				scrollCalls: [
					[
						{
							block: "start",
						},
					],
				],
				scrolled: ["bfab1build"],
				active: true,
			},
		);
	});

	it("adds a task requested after mount to the open rows, keeping the earlier one open", () =>
	{
		stubFrames();
		const sessionId = nextSession();
		requestBackgroundTaskFocus(
			sessionId,
			{
				taskId: "bfab1build",
				finished: true,
			},
		);
		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		act(() =>
		{
			requestBackgroundTaskFocus(
				sessionId,
				{
					taskId: "bfab1serve",
					finished: false,
				},
			);
		});

		expect(expandedCards()).toStrictEqual([
			"Background task: Serve the fabricated app",
			"Background task: Build the fabricated app",
		]);
	});

	it("re-opens a Finished section the user collapsed", () =>
	{
		stubFrames();
		const sessionId = nextSession();
		requestBackgroundTaskFocus(
			sessionId,
			{
				taskId: "bfab1build",
				finished: true,
			},
		);
		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);
		fireEvent.click(finishedToggle());
		const collapsed = finishedToggle().getAttribute("aria-expanded");

		act(() =>
		{
			requestBackgroundTaskFocus(
				sessionId,
				{
					taskId: "bfab1build",
					finished: true,
				},
			);
		});

		expect(
			{
				collapsed,
				reopened: finishedToggle().getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				collapsed: "false",
				reopened: "true",
			},
		);
	});

	it("keeps Finished and the expanded rows across a remount in the same session", () =>
	{
		stubFrames();
		const sessionId = nextSession();
		const first = render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);
		fireEvent.click(finishedToggle());
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Background task: Build the fabricated app",
				},
			),
		);
		first.unmount();

		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		expect(
			{
				finished: finishedToggle().getAttribute("aria-expanded"),
				expanded: expandedCards(),
			},
		).toStrictEqual(
			{
				finished: "true",
				expanded: ["Background task: Build the fabricated app"],
			},
		);
	});

	it("ignores a request for a task with no row", () =>
	{
		const scroll = stubFrames();
		const sessionId = nextSession();
		render(<BackgroundTasksList groups={GROUPS} sessionId={sessionId} />);

		act(() =>
		{
			requestBackgroundTaskFocus(
				sessionId,
				{
					taskId: "missing",
					finished: false,
				},
			);
		});

		expect(
			{
				scrollCalls: scroll.mock.calls,
				expanded: expandedCards(),
			},
		).toStrictEqual(
			{
				scrollCalls: [],
				expanded: [],
			},
		);
	});
});

describe("BackgroundTasksList per-row Stop", () =>
{
	afterEach(() =>
	{
		resetStoppingTasks();
	});

	function stopButtons()
	{
		return screen.queryAllByRole(
			"button",
			{
				name: "Stop this task",
			},
		);
	}

	it("puts a Stop after each running row's opener, described by the row's title, and none on finished rows", () =>
	{
		const stop = vi.fn<(task: BackgroundTask) => void>();
		render(
			<BackgroundTasksList
				groups={GROUPS}
				sessionId="session-stop"
				stop={
				{
					stop,
				}}
			/>,
		);
		fireEvent.click(finishedToggle());
		expect(
			stopButtons().map((button) => (
			{
				slot: button.closest("[data-task-stop]")?.className,
				description: document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent,
				row: button.closest("[data-task-id]")?.getAttribute("data-task-id"),
				busy: button.getAttribute("aria-busy"),
				glyph: button.querySelector<SVGElement>("[data-cds=Icon]")?.style.fontSize,
			})),
		).toStrictEqual([
			{
				slot: "absolute inset-y-0 end-0 flex w-10 items-center justify-end pe-3",
				description: "Serve the fabricated app",
				row: "bfab1serve",
				busy: null,
				glyph: iconFontSize(16),
			},
			{
				// The agent row's opener is not a button, so upstream sets no data-task-stop on its slot.
				slot: undefined,
				description: "Review the fabricated diff",
				row: "afab1review",
				busy: null,
				glyph: iconFontSize(16),
			},
		]);
	});

	it("clears the Stop with pe-9.5 on a running row's opener, and not on a finished one", () =>
	{
		render(
			<BackgroundTasksList
				groups={GROUPS}
				sessionId="session-stop"
				stop={
				{
					stop: vi.fn<(task: BackgroundTask) => void>(),
				}}
			/>,
		);
		fireEvent.click(finishedToggle());
		expect(
			[...document.querySelectorAll("[data-task-id] [data-background-task]")].map((opener) =>
				opener.className.split(" ").includes("pe-9.5"),
			),
		).toStrictEqual([true, true, false]);
	});

	it("draws no Stop when the session can't take writes", () =>
	{
		render(<BackgroundTasksList groups={GROUPS} sessionId="session-stop" stop={null} />);
		expect(stopButtons()).toStrictEqual([]);
	});

	it("stops once on a press, ignores a double-click's second press, and leaves the row closed", () =>
	{
		const stop = vi.fn<(task: BackgroundTask) => void>();
		render(
			<BackgroundTasksList
				groups={GROUPS}
				sessionId="session-stop"
				stop={
				{
					stop,
				}}
			/>,
		);
		const [first] = stopButtons();
		if (first === undefined) throw new Error("no Stop");
		fireEvent.click(
			first,
			{
				detail: 1,
			},
		);
		fireEvent.click(
			first,
			{
				detail: 2,
			},
		);
		expect(
			{
				stopped: stop.mock.calls.map(([stopped]) => stopped.id),
				expanded: document
					.querySelector("[data-task-id='bfab1serve'] [data-background-task]")
					?.getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				stopped: ["bfab1serve"],
				expanded: "false",
			},
		);
	});

	it("shows a stopping task busy, with Stopping… in its status column", () =>
	{
		const control = renderHook(() =>
			useBackgroundTaskStop(
				{
					sessionId: "session-stop",
					enabled: true,
					running: GROUPS.running,
					toast: () =>
					{
					},
					stop: async () => new Promise<void>(() => {}),
				},
			),
		);
		render(<BackgroundTasksList groups={GROUPS} sessionId="session-stop" stop={control.result.current} />);
		act(() =>
		{
			stopButtons()[0]?.click();
		});
		const row = document.querySelector("[data-task-id='bfab1serve']");
		expect(
			{
				busy: row?.querySelector("[data-task-stop] button")?.getAttribute("aria-busy"),
				status: row?.querySelector("[data-background-task] > span:last-child")?.textContent,
			},
		).toStrictEqual(
			{
				busy: "true",
				status: "Stopping…",
			},
		);
	});
});
