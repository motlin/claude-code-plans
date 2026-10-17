// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {PANE_HEADER_ICON_BUTTON_CLASS} from "../src/components/panes/pane-classes";
import {planPaneDefinition} from "../src/components/panes/plan-pane-entry";
import {planQueryOptions, type PlanDetail} from "../src/lib/api/plans";
import type {SessionPlanModel} from "../src/lib/session-plan-model";

afterEach(cleanup);

const MODEL: SessionPlanModel = {content: "Do it.", todos: [], editsPlanFile: false};

async function renderInRouter(node: React.ReactNode, queryClient = new QueryClient()) {
	const router = createRouter({
		routeTree: createRootRoute({component: () => <>{node}</>}),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

function stubClipboard() {
	const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => Promise.resolve());
	Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
	return writeText;
}

const LINKED_PLAN: PlanDetail = {
	markdown: "# From the file\n",
	mtime: "2026-10-17T00:00:00.000Z",
	title: "From the file",
};

function linkedPlanClient(): QueryClient {
	const queryClient = new QueryClient();
	queryClient.setQueryData(planQueryOptions("switch-git-pager").queryKey, LINKED_PLAN);
	return queryClient;
}

function headerActionLabels(container: HTMLElement) {
	return [...container.querySelectorAll("a, button")].map((node) => node.getAttribute("aria-label"));
}

describe("planPaneDefinition", () => {
	it("has no header action without plan text or a plan file", () => {
		expect(
			planPaneDefinition(undefined, {content: null, todos: [], editsPlanFile: false}).headerActions,
		).toStrictEqual(undefined);
	});

	it("adds upstream's ghost 'Copy plan' icon button for a plan without a file", async () => {
		const view = await renderInRouter(planPaneDefinition(undefined, MODEL).headerActions);
		const button = screen.getByRole("button", {name: "Copy plan"});

		expect({
			actions: headerActionLabels(view.container),
			className: button.className,
			icon: button.querySelector("svg")?.getAttribute("class"),
		}).toStrictEqual({
			actions: ["Copy plan"],
			className: PANE_HEADER_ICON_BUTTON_CLASS,
			icon: "lucide lucide-copy h-4 w-4",
		});
	});

	it("copies the plan markdown exactly and flips to 'Copied' with a check", async () => {
		const writeText = stubClipboard();
		await renderInRouter(
			planPaneDefinition(undefined, {...MODEL, content: "# Plan\n\n- step one\n"}).headerActions,
		);

		fireEvent.click(screen.getByRole("button", {name: "Copy plan"}));
		const button = await screen.findByRole("button", {name: "Copied"});

		expect({
			calls: writeText.mock.calls,
			icon: button.querySelector("svg")?.getAttribute("class"),
		}).toStrictEqual({
			calls: [["# Plan\n\n- step one\n"]],
			icon: "lucide lucide-check h-4 w-4",
		});
	});

	it("puts the local 'Open plan file' link in upstream's 'Open in' slot, before Copy plan", async () => {
		const view = await renderInRouter(
			planPaneDefinition("switch-git-pager.md", MODEL).headerActions,
			linkedPlanClient(),
		);
		const link = screen.getByRole("link", {name: "Open plan file"});

		expect({
			actions: headerActionLabels(view.container),
			href: link.getAttribute("href"),
			className: link.className,
			icon: link.querySelector("svg")?.getAttribute("class"),
		}).toStrictEqual({
			actions: ["Open plan file", "Copy plan"],
			href: "/plan/switch-git-pager",
			className: PANE_HEADER_ICON_BUTTON_CLASS,
			icon: "lucide lucide-file-text h-4 w-4",
		});
	});

	it("copies the linked plan file's markdown, which the pane shows, over the transcript text", async () => {
		const writeText = stubClipboard();
		await renderInRouter(planPaneDefinition("switch-git-pager.md", MODEL).headerActions, linkedPlanClient());

		fireEvent.click(screen.getByRole("button", {name: "Copy plan"}));
		await screen.findByRole("button", {name: "Copied"});

		expect(writeText.mock.calls).toStrictEqual([["# From the file\n"]]);
	});
});
