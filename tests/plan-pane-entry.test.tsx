// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {PANE_HEADER_ICON_BUTTON_CLASS} from "../src/components/panes/pane-classes";
import {planPaneDefinition} from "../src/components/panes/plan-pane-entry";
import type {SessionPlanModel} from "../src/lib/session-plan-model";

afterEach(cleanup);

const MODEL: SessionPlanModel = {content: "Do it.", todos: [], editsPlanFile: false};

async function renderInRouter(node: React.ReactNode) {
	const router = createRouter({
		routeTree: createRootRoute({component: () => <>{node}</>}),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	return render(<RouterProvider router={router} />);
}

describe("planPaneDefinition", () => {
	it("has no header action for a plan without a file", () => {
		expect(planPaneDefinition(undefined, MODEL).headerActions).toStrictEqual(undefined);
	});

	it("adds a quiet 'Open plan file' header action linking to the plan page for a file-backed plan", async () => {
		await renderInRouter(planPaneDefinition("switch-git-pager.md", MODEL).headerActions);
		const link = screen.getByRole("link", {name: "Open plan file"});

		expect({
			href: link.getAttribute("href"),
			className: link.className,
			icon: link.querySelector("svg")?.getAttribute("class"),
		}).toStrictEqual({
			href: "/plan/switch-git-pager",
			className: PANE_HEADER_ICON_BUTTON_CLASS,
			icon: "lucide lucide-file-text h-4 w-4",
		});
	});
});
