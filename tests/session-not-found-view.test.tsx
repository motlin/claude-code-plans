// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionNotFound} from "../src/components/session-unavailable";
import {requestHomeComposerFocus} from "../src/lib/home-composer-focus";

vi.mock("../src/lib/home-composer-focus", () => ({requestHomeComposerFocus: vi.fn<() => void>()}));

afterEach(cleanup);

async function renderAtSession() {
	const root = createRootRoute();
	const home = createRoute({getParentRoute: () => root, path: "/", component: () => <p>home</p>});
	const session = createRoute({getParentRoute: () => root, path: "/session/$id", component: SessionNotFound});
	const router = createRouter({
		routeTree: root.addChildren([home, session]),
		history: createMemoryHistory({initialEntries: ["/session/missing"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];

describe("missing-session view", () => {
	it("renders upstream's centred 'This session couldn’t be found' card under an empty 32px titlebar band", async () => {
		await renderAtSession();

		const heading = await screen.findByRole("heading", {level: 2});
		const body = heading.nextElementSibling;
		const actions = body?.nextElementSibling;
		const stack = heading.parentElement;
		const wrapper = stack?.parentElement;
		const band = wrapper?.previousElementSibling;
		const button = screen.getByRole("button", {name: "Start a new session"});

		expect({
			band: {
				tag: band?.tagName,
				hidden: band?.getAttribute("aria-hidden"),
				classes: classes(band),
				text: band?.textContent,
			},
			wrapper: classes(wrapper),
			stack: classes(stack),
			heading: {tag: heading.tagName, classes: classes(heading), text: heading.textContent},
			body: {tag: body?.tagName, classes: classes(body), text: body?.textContent},
			actions: {classes: classes(actions), children: actions?.children.length},
			button: {
				type: button.getAttribute("type"),
				classes: classes(button),
				parent: button.parentElement === actions,
			},
		}).toStrictEqual({
			band: {tag: "DIV", hidden: "true", classes: ["h-8", "shrink-0"], text: ""},
			wrapper: ["h-full", "flex", "flex-col", "items-center", "justify-center", "px-4"],
			stack: ["flex", "w-full", "max-w-md", "flex-col", "items-start", "gap-3", "text-[13px]/[19px]"],
			heading: {
				tag: "H2",
				classes: ["text-pretty", "text-[20px]/[25px]", "font-normal", "text-primary"],
				text: "This session couldn’t be found",
			},
			body: {
				tag: "P",
				classes: ["text-pretty", "text-secondary"],
				text: "It may have been deleted, or you may not have access.",
			},
			actions: {classes: ["mt-4", "flex", "flex-wrap", "items-center", "gap-2"], children: 1},
			button: {
				type: "button",
				classes: [
					"h-5",
					"rounded-r5",
					"px-1.5",
					"text-[12px]/[17px]",
					"font-medium",
					"bg-fill-primary",
					"text-on-primary",
					"hover:bg-fill-primary-hover",
					"outline-none",
					"focus-visible:shadow-focus",
					"transition-shadow",
				],
				parent: true,
			},
		});
	});

	it("starts a new session like the sidebar New row: home, then focus the home composer", async () => {
		const router = await renderAtSession();

		fireEvent.click(await screen.findByRole("button", {name: "Start a new session"}));

		await waitFor(() => {
			expect(vi.mocked(requestHomeComposerFocus)).toHaveBeenCalledTimes(1);
		});
		expect({path: router.state.location.pathname, home: screen.getByText("home").textContent}).toStrictEqual({
			path: "/",
			home: "home",
		});
	});
});
