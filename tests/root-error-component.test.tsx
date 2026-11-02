// @vitest-environment jsdom

import {fireEvent, render, screen} from "@testing-library/react";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {describe, expect, it, vi} from "vite-plus/test";
import {ApiResponseError} from "../src/lib/api/client";
import {DefaultErrorComponent} from "../src/routes/__root";

const staleChunk = vi.hoisted(() => (
{
	reloads: 0,
	allowed: true,
}));
vi.mock("../src/lib/stale-chunk-reload", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/lib/stale-chunk-reload")>()),
	reloadForStaleChunk: () =>
	{
		staleChunk.reloads += 1;
		return staleChunk.allowed;
	},
}));

const STALE_CHUNK = new TypeError(
	"Failed to fetch dynamically imported module: https://plans.m4.notlin.com/assets/tool-approval-notify-tip-PCUCVhl8.js",
);

async function renderError(error: Error)
{
	const rootRoute = createRootRoute(
		{
			component: () => <DefaultErrorComponent error={error} reset={() => undefined} />,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	const invalidate = vi.spyOn(router, "invalidate");
	await router.load();
	render(<RouterProvider router={router} />);
	return {
		invalidate,
	};
}

describe("DefaultErrorComponent", () =>
{
	it("renders API 404 errors as upstream's not-found page with Go back home and the request detail", async () =>
	{
		await renderError(
			new ApiResponseError(
				"/api/reviews/missing-review",
				new Response(
					null,
					{
						status: 404,
						statusText: "Not Found",
					},
				),
			),
		);

		const homeLink = screen.getByRole(
			"link",
			{
				name: "Go back home",
			},
		);
		expect(
			{
				heading: screen.getByRole(
					"heading",
					{
						level: 2,
					},
				).textContent,
				description: screen.getByText(
					"Claude can help with many things, but finding this page isn’t one of them.",
				).textContent,
				detail: screen.getByText("/api/reviews/missing-review -> 404 Not Found").textContent,
				homeLink:
				{
					text: homeLink.textContent,
					destination: homeLink.getAttribute("href"),
				},
			},
		).toStrictEqual(
			{
				heading: "Page not found",
				description: "Claude can help with many things, but finding this page isn’t one of them.",
				detail: "/api/reviews/missing-review -> 404 Not Found",
				homeLink:
				{
					text: "Go back home",
					destination: "/",
				},
			},
		);
	});

	it("renders other errors with retry and home actions", async () =>
	{
		const {invalidate} = await renderError(
			new ApiResponseError(
				"/api/reviews/failing-review",
				new Response(
					null,
					{
						status: 500,
						statusText: "Internal Server Error",
					},
				),
			),
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Try again",
				},
			),
		);
		const homeLink = screen.getByRole(
			"link",
			{
				name: "Back to home",
			},
		);
		expect(
			{
				heading: screen.getByRole("heading").textContent,
				description: screen.getByText("We couldn't load this page.").textContent,
				detail: screen.getByText("/api/reviews/failing-review -> 500 Internal Server Error").textContent,
				homeLink:
				{
					text: homeLink.textContent,
					destination: homeLink.getAttribute("href"),
				},
				invalidateCalls: invalidate.mock.calls,
			},
		).toStrictEqual(
			{
				heading: "Something went wrong",
				description: "We couldn't load this page.",
				detail: "/api/reviews/failing-review -> 500 Internal Server Error",
				homeLink:
				{
					text: "Back to home",
					destination: "/",
				},
				invalidateCalls: [[]],
			},
		);
	});

	it("reloads once for a stale chunk from a previous deploy and says the app updated", async () =>
	{
		staleChunk.reloads = 0;
		staleChunk.allowed = true;
		await renderError(STALE_CHUNK);

		expect(
			{
				status: screen.getByRole("status").textContent,
				reloads: staleChunk.reloads,
			},
		).toStrictEqual(
			{
				status: "App updated, reloading…",
				reloads: 1,
			},
		);
	});

	it("shows the error when the stale-chunk reload guard already fired", async () =>
	{
		staleChunk.reloads = 0;
		staleChunk.allowed = false;
		await renderError(STALE_CHUNK);

		expect(
			{
				heading: screen.getByRole("heading").textContent,
				status: screen.queryByRole("status"),
				reloads: staleChunk.reloads,
			},
		).toStrictEqual(
			{
				heading: "Something went wrong",
				status: null,
				reloads: 1,
			},
		);
	});
});
