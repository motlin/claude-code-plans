// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ApiResponseError} from "../src/lib/api/client";
import {CRASH_RELOAD_STUCK_MS} from "../src/components/route-crash-screen";
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

const crash = vi.hoisted(() => (
{
	calls: [] as string[],
}));
vi.mock("../src/lib/route-crash-reload", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/lib/route-crash-reload")>()),
	reloadAfterCrash: () =>
	{
		crash.calls.push("reload");
	},
	navigateHomeAfterCrash: () =>
	{
		crash.calls.push("home");
	},
}));

afterEach(() =>
{
	cleanup();
	crash.calls = [];
	sessionStorage.clear();
});

const CRASH_FRAME =
	"flex h-full min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-4 py-10 text-center";
const CRASH_BUTTON =
	"h-8 rounded-r6 border-0 bg-fill-secondary px-3 text-[14px] leading-none font-normal text-primary [box-shadow:var(--error-button-edge,inset_0_0_0_1px_var(--color-fill-secondary-ring))] transition-colors hover:bg-fill-secondary-hover disabled:cursor-default disabled:opacity-60";

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
	await router.load();
	return render(<RouterProvider router={router} />);
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

	it("renders upstream's crash screen for other errors", async () =>
	{
		await renderError(
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

		const frame = document.querySelector("[data-route-crash]");
		const stack = frame?.firstElementChild;
		const sparkWrap = stack?.firstElementChild;
		const buttons = screen.getAllByRole("button");
		const reload = screen.getByRole(
			"button",
			{
				name: "Reload",
			},
		);
		fireEvent.click(reload);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Home",
				},
			),
		);
		expect(
			{
				frame: frame?.className,
				frameChildren: frame?.childElementCount,
				stack: stack?.className,
				sparkWrap: sparkWrap?.className,
				spark: [
					sparkWrap?.firstElementChild?.getAttribute("data-cds"),
					sparkWrap?.firstElementChild?.getAttribute("height"),
				],
				heading: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).outerHTML,
				body: screen.getByText("Reload to continue.").outerHTML,
				actions: buttons[0]?.parentElement?.className,
				buttonNames: buttons.map((button) => button.textContent),
				buttonClasses: buttons.map((button) => button.className),
				reloadDisabled: reload.hasAttribute("disabled"),
				calls: crash.calls,
				detail: screen.queryByText(/failing-review/),
				code: document.querySelector("code"),
			},
		).toStrictEqual(
			{
				frame: CRASH_FRAME,
				frameChildren: 1,
				stack: "flex flex-1 select-text flex-col items-center justify-center gap-2 pb-14",
				sparkWrap: "mb-11 mr-px inline-flex",
				spark: ["Spark", "28"],
				heading:
					'<h1 class="font-voice text-2xl font-medium text-primary sm:text-[2rem]">This page ran into a problem</h1>',
				body: '<p class="max-w-xl text-secondary sm:text-prose">Reload to continue.</p>',
				actions: "mt-4 flex items-center gap-3 stacks:[--error-button-edge:none]",
				buttonNames: ["Reload", "Home"],
				buttonClasses: [CRASH_BUTTON, CRASH_BUTTON],
				reloadDisabled: true,
				calls: ["reload", "home"],
				detail: null,
				code: null,
			},
		);
	});

	it("shows the error code when the same crash repeats within a minute", async () =>
	{
		const error = new TypeError("Cannot read properties of undefined (reading 'x')");
		const first = await renderError(error);
		const firstCode = document.querySelector("code");
		first.unmount();
		await renderError(error);
		const code = document.querySelector("code");

		expect(
			{
				firstCode,
				block: code?.parentElement?.outerHTML,
				title: code?.getAttribute("title"),
			},
		).toStrictEqual(
			{
				firstCode: null,
				block:
					'<div class="mt-8 flex flex-col items-center gap-2"><p class="text-sm text-secondary">Still not working? Here’s the error code:</p>' +
					'<code title="Cannot read properties of undefined (reading \'x\')" class="inline-block rounded bg-surface-0 px-3 py-1.5 text-sm text-secondary select-all" style="font-family: Monaco, Menlo, Consolas, Courier New, monospace;">13YE7Z0</code></div>',
				title: "Cannot read properties of undefined (reading 'x')",
			},
		);
	});

	it("reloads once for a stale chunk from a previous deploy behind the spark-only frame", async () =>
	{
		staleChunk.reloads = 0;
		staleChunk.allowed = true;
		await renderError(STALE_CHUNK);

		const status = screen.getByRole("status");
		expect(
			{
				frame: status.outerHTML.replace(/<svg.*<\/svg>/, "<svg/>"),
				spark: status.querySelector("svg")?.getAttribute("height"),
				updatedText: screen.queryByText("App updated, reloading…"),
				reloads: staleChunk.reloads,
			},
		).toStrictEqual(
			{
				frame: `<div role="status" aria-label="Reloading" data-route-crash-recovering="" class="${CRASH_FRAME}"><span class="mr-px inline-flex"><svg/></span></div>`,
				spark: "28",
				updatedText: null,
				reloads: 1,
			},
		);
	});

	it("shows the full chunk screen with the connection hint once the reload is stuck for 10s", async () =>
	{
		staleChunk.reloads = 0;
		staleChunk.allowed = true;
		vi.useFakeTimers();
		try
		{
			await renderError(STALE_CHUNK);
			act(() =>
			{
				vi.advanceTimersByTime(CRASH_RELOAD_STUCK_MS);
			});

			expect(
				{
					heading: screen.getByRole("heading").textContent,
					body: screen.getByText("Check your connection, then reload.").className,
					buttons: screen.getAllByRole("button").map((button) => button.textContent),
					status: screen.queryByRole("status"),
				},
			).toStrictEqual(
				{
					heading: "Couldn’t finish loading",
					body: "max-w-xl text-secondary sm:text-prose",
					buttons: ["Reload"],
					status: null,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("shows the chunk crash screen when the stale-chunk reload guard already fired", async () =>
	{
		staleChunk.reloads = 0;
		staleChunk.allowed = false;
		await renderError(STALE_CHUNK);

		expect(
			{
				heading: screen.getByRole("heading").textContent,
				body: screen.getByText("Reload to continue.").textContent,
				buttons: screen.getAllByRole("button").map((button) => button.textContent),
				status: screen.queryByRole("status"),
				reloads: staleChunk.reloads,
			},
		).toStrictEqual(
			{
				heading: "Couldn’t finish loading",
				body: "Reload to continue.",
				buttons: ["Reload"],
				status: null,
				reloads: 1,
			},
		);
	});
});
