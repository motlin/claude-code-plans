// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, renderHook} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {useArchiveSessions} from "../src/hooks/use-session-archive";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

/** Stubs the archive endpoint, recording the most requests ever in flight at once. */
function stubArchive()
{
	const seen =
	{
		inFlight: 0,
		peak: 0,
		urls: [] as string[],
	};
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
	{
		seen.urls.push(String(input));
		seen.inFlight++;
		seen.peak = Math.max(seen.peak, seen.inFlight);
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 1);
		});
		seen.inFlight--;
		return new Response(
			JSON.stringify(
				{
					archived: true,
				},
			),
			{
				status: 200,
				headers:
				{
					"Content-Type": "application/json",
				},
			},
		);
	});
	return seen;
}

const toasts: Omit<ToastOptions, "action">[] = [];

function recordToast({action: _action, ...options}: ToastOptions): void
{
	toasts.push(options);
}

function renderArchive()
{
	toasts.length = 0;
	const queryClient = new QueryClient();
	const wrapper = ({children}: {children: ReactNode}) => (
		<QueryClientProvider client={queryClient}>
			<ToastContext.Provider value={recordToast}>{children}</ToastContext.Provider>
		</QueryClientProvider>
	);
	const {result} = renderHook(
		() => useArchiveSessions(),
		{
			wrapper,
		},
	);
	return {
		archive: result.current,
		toasts,
	};
}

describe("useArchiveSessions", () =>
{
	it("caps requests in flight at the given concurrency and toasts the caller's copy and duration", async () =>
	{
		const seen = stubArchive();
		const {archive, toasts} = renderArchive();
		const ids = Array.from(
			{
				length: 20,
			},
			(_, index) => `s${index}`,
		);

		await archive(
			ids,
			{
				concurrency: 8,
				message: (count) => `Archived ${count} older sessions`,
				durationMs: 3000,
				uniqueKey: "archive-older-bulk",
			},
		);

		expect(
			{
				peak: seen.peak,
				requests: seen.urls.length,
				toasts,
			},
		).toStrictEqual(
			{
				peak: 8,
				requests: 20,
				toasts: [
					{
						kind: "success",
						message: "Archived 20 older sessions",
						durationMs: 3000,
						uniqueKey: "archive-older-bulk",
					},
				],
			},
		);
	});

	it("keeps the plain copy and runs every request at once without options", async () =>
	{
		const seen = stubArchive();
		const {archive, toasts} = renderArchive();

		await archive(["a", "b", "c"]);

		expect(
			{
				peak: seen.peak,
				toasts,
			},
		).toStrictEqual(
			{
				peak: 3,
				toasts: [
					{
						kind: "success",
						message: "Archived 3 sessions",
					},
				],
			},
		);
	});
});
