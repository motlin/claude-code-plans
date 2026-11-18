// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import type {ToastOptions} from "../src/components/toast-context";
import
{
	BACKGROUND_TASK_STOP_CONFIRM_MS,
	resetStoppingTasks,
	useBackgroundTaskStop,
	useStoppingTaskIds,
	type BackgroundTaskStopOptions,
} from "../src/hooks/use-background-task-stop";
import type {BackgroundTask} from "../src/lib/background-tasks";
import type {StoppableTask} from "../src/lib/api/herdr";

afterEach(() =>
{
	cleanup();
	resetStoppingTasks();
	vi.useRealTimers();
});

function task(id: string, status: BackgroundTask["status"] = "running"): BackgroundTask
{
	return {
		id,
		toolUseId: null,
		kind: "bash",
		description: `Task ${id}`,
		command: `sleep ${id}`,
		status,
		output: null,
		summary: null,
		outputFile: null,
		startedAt: null,
		completedAt: null,
		durationMs: null,
	};
}

type Props = Omit<BackgroundTaskStopOptions, "toast" | "stop">;
type StopFn = (sessionId: string, target: StoppableTask) => Promise<void>;

/** The stop hook and two readers of the stopping set (the pane and the rail), rendered together. */
function setup(stop: StopFn, initial: Partial<Props> = {})
{
	const toasts: ToastOptions[] = [];
	const toast = (options: ToastOptions) =>
	{
		toasts.push(options);
	};
	const props: Props =
	{
		sessionId: "session-1",
		enabled: true,
		running: [task("a"), task("b")],
		...initial,
	};
	const view = renderHook(
		(next: Props) =>
		{
			const control = useBackgroundTaskStop(
				{
					...next,
					toast,
					stop,
				},
			);
			const pane = useStoppingTaskIds(next.sessionId);
			const rail = useStoppingTaskIds(next.sessionId);
			return {
				control,
				pane: [...pane],
				rail: [...rail],
			};
		},
		{
			initialProps: props,
		},
	);
	return {
		toasts,
		view,
		props,
	};
}

async function settle()
{
	await act(async () =>
	{
		await Promise.resolve();
	});
}

const FAILED = "Couldn’t stop the task — check your connection and try again.";

describe("useBackgroundTaskStop", () =>
{
	it("offers no stop while the session can't take writes", () =>
	{
		const stop = vi.fn<StopFn>(async () => Promise.resolve());
		expect(
			setup(
				stop,
				{
					enabled: false,
				},
			).view.result.current.control,
		).toBeNull();
	});

	it("puts a pressed task in both readers' stopping set and sends what the dialog matches on", () =>
	{
		const stop = vi.fn<StopFn>(async () => new Promise<void>(() => {}));
		const {view} = setup(stop);
		act(() =>
		{
			view.result.current.control?.stop(task("a"));
			view.result.current.control?.stop(task("a"));
		});
		expect(
			{
				pane: view.result.current.pane,
				rail: view.result.current.rail,
				calls: stop.mock.calls,
			},
		).toStrictEqual(
			{
				pane: ["a"],
				rail: ["a"],
				calls: [
					[
						"session-1",
						{
							id: "a",
							kind: "bash",
							description: "Task a",
							command: "sleep a",
						},
					],
				],
			},
		);
	});

	it("drops a failed stop from the set with upstream's error toast", async () =>
	{
		const stop = vi.fn<StopFn>(async () =>
			Promise.reject(new Error("That task isn’t in the terminal’s task list")),
		);
		const {view, toasts} = setup(stop);
		act(() =>
		{
			view.result.current.control?.stop(task("a"));
		});
		await settle();
		expect(
			{
				pane: view.result.current.pane,
				toasts,
			},
		).toStrictEqual(
			{
				pane: [],
				toasts: [
					{
						kind: "error",
						message: FAILED,
						description: "That task isn’t in the terminal’s task list",
					},
				],
			},
		);
	});

	it("keeps a sent stop until the transcript shows the task no longer running", async () =>
	{
		const stop = vi.fn<StopFn>(async () => Promise.resolve());
		const {view, toasts, props} = setup(stop);
		act(() =>
		{
			view.result.current.control?.stop(task("a"));
		});
		await settle();
		const whileConfirming = view.result.current.pane;
		view.rerender(
			{
				...props,
				running: [task("b")],
			},
		);
		expect(
			{
				whileConfirming,
				after: view.result.current.pane,
				toasts,
			},
		).toStrictEqual(
			{
				whileConfirming: ["a"],
				after: [],
				toasts: [],
			},
		);
	});

	it("gives up with the error toast when the task still runs after the confirm window", async () =>
	{
		vi.useFakeTimers();
		const stop = vi.fn<StopFn>(async () => Promise.resolve());
		const {view, toasts} = setup(stop);
		act(() =>
		{
			view.result.current.control?.stop(task("a"));
		});
		await settle();
		act(() =>
		{
			vi.advanceTimersByTime(BACKGROUND_TASK_STOP_CONFIRM_MS);
		});
		expect(
			{
				pane: view.result.current.pane,
				toasts,
			},
		).toStrictEqual(
			{
				pane: [],
				toasts: [
					{
						kind: "error",
						message: FAILED,
					},
				],
			},
		);
	});

	it("keeps each session's stopping set apart", () =>
	{
		const stop = vi.fn<StopFn>(async () => new Promise<void>(() => {}));
		const {view} = setup(stop);
		act(() =>
		{
			view.result.current.control?.stop(task("a"));
		});
		const other = renderHook(() => [...useStoppingTaskIds("session-2")]);
		expect(other.result.current).toStrictEqual([]);
	});
});
