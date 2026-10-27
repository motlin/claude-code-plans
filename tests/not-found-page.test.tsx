// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {Route as RootRoute} from "../src/routes/__root";

afterEach(cleanup);

/** Class lists compared as sets, so the formatter's class sorting can't break the assertion. */
const classSet = (className: string | undefined) => (className ?? "").split(" ").toSorted();

describe("404 page", () => {
	it("lays out upstream's not-found grid: wordmark wrapper, h2 'Page not found', h3 line and the button wrapper", async () => {
		const NotFound = RootRoute.options.notFoundComponent;
		if (NotFound === undefined) throw new Error("no notFoundComponent");
		const root = createRootRoute({component: () => <Outlet />, notFoundComponent: NotFound});
		const router = createRouter({routeTree: root, history: createMemoryHistory({initialEntries: ["/nowhere"]})});
		await router.load();
		render(<RouterProvider router={router} />);

		const heading = await screen.findByRole("heading", {level: 2});
		const home = screen.getByRole("link", {name: "Go back home"});
		const page = heading.closest("[data-not-found]");
		const wordmark = screen.getByRole("img", {name: "Claude Code Browser"});
		expect({
			page: classSet(page?.className),
			children: Array.from(page?.children ?? [], (child) => ({
				tag: child.tagName.toLowerCase(),
				className: classSet(child.className),
				text: child.textContent,
			})),
			wordmarkParent: wordmark.parentElement === page?.firstElementChild,
			wordmarkHidden: Array.from(wordmark.childNodes, (node) =>
				node instanceof Element ? node.getAttribute("aria-hidden") : node.textContent,
			),
			homeParent: home.parentElement === page?.lastElementChild,
			homeHref: home.getAttribute("href"),
			h1: screen.queryByRole("heading", {level: 1}),
		}).toStrictEqual({
			page: classSet(
				"grid h-[calc(100dvh-4.5rem)] max-sm:h-[calc(100dvh-9rem)] min-h-min place-content-center gap-2 px-4 pt-24 pb-32 mx-auto w-fit max-w-2xl text-center",
			),
			children: [
				{tag: "div", className: classSet("mb-10 text-center"), text: "Claude Code Browser"},
				{
					tag: "h2",
					className: classSet("font-voice text-balance text-[20px]/[28px] font-normal text-primary"),
					text: "Page not found",
				},
				{
					tag: "h3",
					className: classSet("text-balance text-[14px]/[18px] font-normal text-secondary"),
					text: "Claude can help with many things, but finding this page isn’t one of them.",
				},
				{tag: "div", className: classSet("mx-0 mt-4 min-w-[16rem]"), text: "Go back home"},
			],
			wordmarkParent: true,
			wordmarkHidden: ["true", "true"],
			homeParent: true,
			homeHref: "/",
			h1: null,
		});
	});

	it("puts upstream's orange Claude spark before the wordmark in one row", async () => {
		const NotFound = RootRoute.options.notFoundComponent;
		if (NotFound === undefined) throw new Error("no notFoundComponent");
		const root = createRootRoute({component: () => <Outlet />, notFoundComponent: NotFound});
		const router = createRouter({routeTree: root, history: createMemoryHistory({initialEntries: ["/nowhere"]})});
		await router.load();
		render(<RouterProvider router={router} />);

		await screen.findByRole("heading", {level: 2});
		const wordmark = screen.getByRole("img", {name: "Claude Code Browser"});
		expect({
			children: Array.from(wordmark.childNodes, (node) =>
				node instanceof Element
					? `${node.tagName.toLowerCase()}[${node.getAttribute("data-cds")}]`
					: node.textContent,
			),
			spark: wordmark.querySelector("svg")?.getAttribute("width"),
			// Upstream's 24px lockup draws the 24-unit spark, then the wordmark from x=30: a 6px gap.
			row: wordmark.className
				.split(" ")
				.filter((name) => ["inline-flex", "items-center"].includes(name) || name.startsWith("gap-")),
		}).toStrictEqual({
			children: ["svg[Spark]", "span[null]"],
			spark: "24",
			row: ["inline-flex", "items-center", "gap-1.5"],
		});
	});
});
