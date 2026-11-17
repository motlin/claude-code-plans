// @vitest-environment jsdom

import {fireEvent, render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {describe, expect, it, vi} from "vite-plus/test";
import {cdsButtonClass} from "../src/components/ui/cds-button";
import {sessionDetailQueryOptions, transcriptQueryOptions} from "../src/lib/api/sessions";
import {SessionErrorComponent} from "../src/components/session-error";

describe("SessionErrorComponent", () =>
{
	it("renders upstream's EpitaxyChatPanel crash fallback and retries after dropping the session's caches", async () =>
	{
		const queryClient = new QueryClient();
		queryClient.setQueryData(sessionDetailQueryOptions("abc").queryKey, null);
		queryClient.setQueryData(transcriptQueryOptions("abc").queryKey, undefined);
		queryClient.setQueryData(sessionDetailQueryOptions("other").queryKey, null);
		const reset = vi.fn<() => void>();
		const rootRoute = createRootRoute();
		const sessionRoute = createRoute(
			{
				getParentRoute: () => rootRoute,
				path: "/session/$id",
				component: () => <SessionErrorComponent error={new Error("boom")} reset={reset} />,
			},
		);
		const router = createRouter(
			{
				routeTree: rootRoute.addChildren([sessionRoute]),
				history: createMemoryHistory(
					{
						initialEntries: ["/session/abc"],
					},
				),
			},
		);
		const invalidate = vi.spyOn(router, "invalidate");
		await router.load();
		const {container} = render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);

		const frame = container.querySelector("[data-session-crash]");
		const button = screen.getByRole("button");
		fireEvent.click(button);
		expect(
			{
				frame: frame?.className,
				inner: frame?.firstElementChild?.className,
				message: frame?.firstElementChild?.firstElementChild?.outerHTML,
				buttons: screen.getAllByRole("button").map((b) => [b.textContent, b.className]),
				pre: container.querySelector("pre"),
				boom: screen.queryByText(/boom/),
				resetCalls: reset.mock.calls.length,
				invalidateCalls: invalidate.mock.calls.length,
				cachedKeys: queryClient
					.getQueryCache()
					.getAll()
					.map((query) => query.queryKey),
			},
		).toStrictEqual(
			{
				frame: "flex h-full flex-col items-center justify-center px-4",
				inner: "max-w-md text-center",
				message:
					'<div class="mb-6 text-lg font-medium text-danger">Something went wrong loading this session.</div>',
				buttons: [["Try again", cdsButtonClass("primary")]],
				pre: null,
				boom: null,
				resetCalls: 1,
				invalidateCalls: 1,
				cachedKeys: [sessionDetailQueryOptions("other").queryKey],
			},
		);
	});
});
