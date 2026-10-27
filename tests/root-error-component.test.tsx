// @vitest-environment jsdom

import {fireEvent, render, screen} from "@testing-library/react";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {describe, expect, it, vi} from "vite-plus/test";
import {ApiResponseError} from "../src/lib/api/client";
import {DefaultErrorComponent} from "../src/routes/__root";

async function renderError(error: Error) {
	const rootRoute = createRootRoute({
		component: () => <DefaultErrorComponent error={error} reset={() => undefined} />,
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	const invalidate = vi.spyOn(router, "invalidate");
	await router.load();
	render(<RouterProvider router={router} />);
	return {invalidate};
}

describe("DefaultErrorComponent", () => {
	it("renders API 404 errors as upstream's not-found page with Go back home and the request detail", async () => {
		await renderError(
			new ApiResponseError(
				"/api/reviews/missing-review",
				new Response(null, {status: 404, statusText: "Not Found"}),
			),
		);

		const homeLink = screen.getByRole("link", {name: "Go back home"});
		expect({
			heading: screen.getByRole("heading", {level: 2}).textContent,
			description: screen.getByText("Claude can help with many things, but finding this page isn’t one of them.")
				.textContent,
			detail: screen.getByText("/api/reviews/missing-review -> 404 Not Found").textContent,
			homeLink: {
				text: homeLink.textContent,
				destination: homeLink.getAttribute("href"),
			},
		}).toStrictEqual({
			heading: "Page not found",
			description: "Claude can help with many things, but finding this page isn’t one of them.",
			detail: "/api/reviews/missing-review -> 404 Not Found",
			homeLink: {text: "Go back home", destination: "/"},
		});
	});

	it("renders other errors with retry and home actions", async () => {
		const {invalidate} = await renderError(
			new ApiResponseError(
				"/api/reviews/failing-review",
				new Response(null, {status: 500, statusText: "Internal Server Error"}),
			),
		);

		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		const homeLink = screen.getByRole("link", {name: "Back to home"});
		expect({
			heading: screen.getByRole("heading").textContent,
			description: screen.getByText("We couldn't load this page.").textContent,
			detail: screen.getByText("/api/reviews/failing-review -> 500 Internal Server Error").textContent,
			homeLink: {
				text: homeLink.textContent,
				destination: homeLink.getAttribute("href"),
			},
			invalidateCalls: invalidate.mock.calls,
		}).toStrictEqual({
			heading: "Something went wrong",
			description: "We couldn't load this page.",
			detail: "/api/reviews/failing-review -> 500 Internal Server Error",
			homeLink: {text: "Back to home", destination: "/"},
			invalidateCalls: [[]],
		});
	});
});
