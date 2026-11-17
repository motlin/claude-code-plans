// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import type {ToastOptions} from "../src/components/toast-context";
import {NESTED_STOP_CONFIRM_MS, useNestedStop, type NestedStopOptions} from "../src/hooks/use-nested-stop";

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

type Props = Omit<NestedStopOptions, "toast" | "stop">;

function setup(stop: (sessionId: string) => Promise<void>, initial: Partial<Props> = {})
{
	const toasts: ToastOptions[] = [];
	const toast = (options: ToastOptions) =>
	{
		toasts.push(options);
	};
	const props: Props =
	{
		sessionId: "session-1",
		count: 2,
		enabled: true,
		killedMarker: null,
		...initial,
	};
	const view = renderHook(
		(next: Props) =>
			useNestedStop(
				{
					...next,
					toast,
					stop,
				},
			),
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

describe("useNestedStop", () =>
{
	it("offers nothing while disabled or with nothing running", () =>
	{
		const stop = vi.fn<(sessionId: string) => Promise<void>>(async () => Promise.resolve());
		expect(
			{
				disabled: setup(
					stop,
					{
						enabled: false,
					},
				).view.result.current,
				none: setup(
					stop,
					{
						count: 0,
					},
				).view.result.current,
			},
		).toStrictEqual(
			{
				disabled: undefined,
				none: undefined,
			},
		);
	});

	it("labels the face with the running count", () =>
	{
		const {view} = setup(vi.fn<(sessionId: string) => Promise<void>>(async () => Promise.resolve()));
		expect(
			{
				label: view.result.current?.label,
				stopping: view.result.current?.stopping,
				stoppingLabel: view.result.current?.stoppingLabel,
			},
		).toStrictEqual(
			{
				label: "Stop 2 background agents",
				stopping: false,
				stoppingLabel: "Stopping background agents…",
			},
		);
	});

	it("shows an error toast with exact text when the request fails", async () =>
	{
		const {view, toasts} = setup(
			vi.fn<(sessionId: string) => Promise<void>>(async () =>
				Promise.reject(new Error("The terminal is not showing its prompt")),
			),
		);
		act(() =>
		{
			view.result.current?.onStop();
		});
		const stopping = view.result.current?.stopping;
		await settle();
		expect(
			{
				stopping,
				after: view.result.current?.stopping,
				toasts,
			},
		).toStrictEqual(
			{
				stopping: true,
				after: false,
				toasts: [
					{
						kind: "error",
						message: "Background agents couldn’t be stopped. Try again.",
						description: "The terminal is not showing its prompt",
					},
				],
			},
		);
	});

	it("confirms from a new agents_killed record and toasts the count at press time", async () =>
	{
		const stop = vi.fn<(sessionId: string) => Promise<void>>(async () => Promise.resolve());
		const {view, toasts, props} = setup(
			stop,
			{
				killedMarker: "old-kill",
			},
		);
		act(() =>
		{
			view.result.current?.onStop();
		});
		await settle();
		const waiting = view.result.current?.stopping;
		view.rerender(
			{
				...props,
				count: 1,
				killedMarker: "new-kill",
			},
		);
		expect(
			{
				calls: stop.mock.calls,
				waiting,
				stopping: view.result.current?.stopping,
				toasts,
			},
		).toStrictEqual(
			{
				calls: [["session-1"]],
				waiting: true,
				stopping: false,
				toasts: [
					{
						kind: "success",
						message: "Stopped 2 background agents.",
					},
				],
			},
		);
	});

	it("confirms when the running count reaches 0", async () =>
	{
		const {view, toasts, props} = setup(vi.fn<(sessionId: string) => Promise<void>>(async () => Promise.resolve()));
		act(() =>
		{
			view.result.current?.onStop();
		});
		await settle();
		view.rerender(
			{
				...props,
				count: 0,
			},
		);
		expect(toasts).toStrictEqual([
			{
				kind: "success",
				message: "Stopped 2 background agents.",
			},
		]);
	});

	it("reports the ones still running after the confirm window", async () =>
	{
		vi.useFakeTimers();
		const {view, toasts, props} = setup(vi.fn<(sessionId: string) => Promise<void>>(async () => Promise.resolve()));
		act(() =>
		{
			view.result.current?.onStop();
		});
		await settle();
		view.rerender(
			{
				...props,
				count: 1,
			},
		);
		act(() =>
		{
			vi.advanceTimersByTime(NESTED_STOP_CONFIRM_MS);
		});
		expect(
			{
				stopping: view.result.current?.stopping,
				toasts,
			},
		).toStrictEqual(
			{
				stopping: false,
				toasts: [
					{
						kind: "error",
						message: "1 background agent couldn’t be stopped. Try again.",
					},
				],
			},
		);
	});

	it("shows no success toast once the page has moved to another session", async () =>
	{
		const {view, toasts, props} = setup(vi.fn<(sessionId: string) => Promise<void>>(async () => Promise.resolve()));
		act(() =>
		{
			view.result.current?.onStop();
		});
		await settle();
		view.rerender(
			{
				...props,
				sessionId: "session-2",
				count: 0,
			},
		);
		expect(toasts).toStrictEqual([]);
	});
});
