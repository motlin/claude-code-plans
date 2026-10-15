// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {Route as RootRoute} from "../src/routes/__root";

afterEach(cleanup);

describe("404 page", () => {
	it("centres upstream's not-found: the wordmark, a 20/28 serif 'Page not found', its line and a filled Go back home", async () => {
		const NotFound = RootRoute.options.notFoundComponent;
		if (NotFound === undefined) throw new Error("no notFoundComponent");
		const root = createRootRoute({component: () => <Outlet />, notFoundComponent: NotFound});
		const router = createRouter({routeTree: root, history: createMemoryHistory({initialEntries: ["/nowhere"]})});
		await router.load();
		render(<RouterProvider router={router} />);

		const heading = await screen.findByRole("heading", {level: 1});
		const home = screen.getByRole("link", {name: "Go back home"});
		const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
		expect({
			heading: heading.textContent,
			headingType: classes(heading).filter((name) =>
				["font-voice", "text-[20px]/[28px]", "font-normal"].includes(name),
			),
			line: heading.nextElementSibling?.textContent,
			home: [home.getAttribute("href"), classes(home).includes("bg-fill-primary")],
			centred: classes(heading.closest("[data-not-found]")).filter((name) =>
				["items-center", "justify-center", "text-center"].includes(name),
			),
		}).toStrictEqual({
			heading: "Page not found",
			headingType: ["font-voice", "text-[20px]/[28px]", "font-normal"],
			line: "Claude can help with many things, but finding this page isn’t one of them.",
			home: ["/", true],
			centred: ["items-center", "justify-center", "text-center"],
		});
	});
});
