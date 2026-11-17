// @vitest-environment jsdom

import {cleanup, fireEvent, render, renderHook, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {ClearFinishedTasksButton} from "../src/components/panes/background-tasks-header-actions";
import {BackgroundTasksList} from "../src/components/panes/background-tasks-pane";
import {useVisibleBackgroundTasks} from "../src/components/panes/background-tasks-pane-entry";
import type {BackgroundTask, BackgroundTaskGroups} from "../src/lib/background-tasks";
import {resetDismissedTasksForTests} from "../src/lib/dismissed-tasks";

const KEY = "epitaxy.dismissedTasksMap";

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask
{
	return {
		toolUseId: null,
		kind: "bash",
		description: overrides.id,
		command: null,
		status: "completed",
		output: null,
		summary: null,
		outputFile: null,
		startedAt: null,
		completedAt: null,
		durationMs: null,
		...overrides,
	};
}

const R1 = task(
	{
		id: "r1",
		status: "running",
	},
);
const F1 = task(
	{
		id: "f1",
	},
);
const F2 = task(
	{
		id: "f2",
	},
);

function stored(): unknown
{
	const raw = localStorage.getItem(KEY);
	return raw === null ? null : JSON.parse(raw);
}

function clearButton(): HTMLElement
{
	return screen.getByRole(
		"button",
		{
			name: "Clear finished tasks",
		},
	);
}

beforeEach(() =>
{
	localStorage.clear();
	resetDismissedTasksForTests();
});

afterEach(() =>
{
	cleanup();
});

describe("useVisibleBackgroundTasks, as upstream's qL filter with XL's prune", () =>
{
	it("hides the session's dismissed tasks", () =>
	{
		localStorage.setItem(
			KEY,
			JSON.stringify(
				{
					s1: ["f1"],
				},
			),
		);
		const {result} = renderHook(() =>
			useVisibleBackgroundTasks(
				"s1",
				{
					running: [R1],
					finished: [F1, F2],
				},
			),
		);

		expect(result.current).toStrictEqual(
			{
				running: [R1],
				finished: [F2],
			},
		);
	});

	it("un-dismisses a dismissed task that is running again", () =>
	{
		localStorage.setItem(
			KEY,
			JSON.stringify(
				{
					s1: ["r1"],
				},
			),
		);
		const {result} = renderHook(() =>
			useVisibleBackgroundTasks(
				"s1",
				{
					running: [R1],
					finished: [],
				},
			),
		);

		expect(
			{
				stored: stored(),
				running: result.current.running,
			},
		).toStrictEqual(
			{
				stored: {},
				running: [R1],
			},
		);
	});
});

describe("ClearFinishedTasksButton, as upstream's pane-header YL", () =>
{
	it("stays focusable but aria-disabled, and does nothing, when nothing is finished", () =>
	{
		render(
			<ClearFinishedTasksButton
				sessionId="s1"
				groups={
				{
					running: [R1],
					finished: [],
				}}
			/>,
		);
		const button = clearButton();
		fireEvent.click(button);

		expect(
			{
				ariaDisabled: button.getAttribute("aria-disabled"),
				disabled: button.hasAttribute("disabled"),
				tabIndex: button.tabIndex,
				stored: stored(),
			},
		).toStrictEqual(
			{
				ariaDisabled: "true",
				disabled: false,
				tabIndex: 0,
				stored: null,
			},
		);
	});

	it("dismisses every finished task with upstream's pane-header look", () =>
	{
		render(
			<ClearFinishedTasksButton
				sessionId="s1"
				groups={
				{
					running: [R1],
					finished: [F1, F2],
				}}
			/>,
		);
		const button = clearButton();
		const ariaDisabled = button.getAttribute("aria-disabled");
		fireEvent.click(button);
		const classes = button.className.split(" ");

		expect(
			{
				ariaDisabled,
				stored: stored(),
				classes: ["h-6", "w-6", "aria-disabled:cursor-default", "aria-disabled:opacity-disabled"].filter(
					(name) => classes.includes(name),
				),
				icon:
				{
					cds: button.querySelector("svg")?.getAttribute("data-cds"),
					fontSize: button.querySelector("svg")?.style.fontSize,
				},
			},
		).toStrictEqual(
			{
				ariaDisabled: null,
				stored:
				{
					s1: ["f1", "f2"],
				},
				classes: ["h-6", "w-6", "aria-disabled:cursor-default", "aria-disabled:opacity-disabled"],
				icon:
				{
					cds: "Icon",
					fontSize: "calc(1rem * var(--cds-rem-scale, 1))",
				},
			},
		);
	});
});

function ClearablePane({groups}: {groups: BackgroundTaskGroups})
{
	const visible = useVisibleBackgroundTasks("s1", groups);
	return (
		<>
			<ClearFinishedTasksButton sessionId="s1" groups={visible} />
			<BackgroundTasksList groups={visible} sessionId="s1" />
		</>
	);
}

function finishedHeading(): string | null
{
	return (
		screen.queryAllByRole("heading").find((heading) => heading.textContent.startsWith("Finished"))?.textContent ??
		null
	);
}

describe("Clear finished tasks persists across remounts", () =>
{
	it("keeps cleared tasks hidden after a remount while a newly finished one shows", () =>
	{
		const groups =
		{
			running: [R1],
			finished: [F1],
		};
		const first = render(<ClearablePane groups={groups} />);
		const before = finishedHeading();
		fireEvent.click(clearButton());
		const afterClear =
		{
			heading: finishedHeading(),
			ariaDisabled: clearButton().getAttribute("aria-disabled"),
		};
		first.unmount();

		render(<ClearablePane groups={groups} />);
		const remounted = finishedHeading();
		cleanup();

		render(
			<ClearablePane
				groups={
				{
					running: [R1],
					finished: [F2, F1],
				}}
			/>,
		);

		expect(
			{
				before,
				afterClear,
				remounted,
				newlyFinished:
				{
					heading: finishedHeading(),
					ariaDisabled: clearButton().getAttribute("aria-disabled"),
				},
			},
		).toStrictEqual(
			{
				before: "Finished1",
				afterClear:
				{
					heading: null,
					ariaDisabled: "true",
				},
				remounted: null,
				newlyFinished:
				{
					heading: "Finished1",
					ariaDisabled: null,
				},
			},
		);
	});
});
