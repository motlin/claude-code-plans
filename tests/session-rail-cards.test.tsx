// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionRailCards, type SessionRailInputs} from "../src/components/session-rail/session-rail-cards";
import {ToastProvider} from "../src/components/toast";
import type {HerdrPaneIndexData} from "../src/lib/api/herdr";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

type HerdrPane = HerdrPaneIndexData["panes"][number];

const PANE: HerdrPane = {
	paneId: "p1",
	terminalId: "t1",
	workspaceId: "w1",
	tabId: "tab1",
	focused: false,
	cwd: "/Users/alice/projects/avalonlogs",
	foregroundCwd: null,
	agentStatus: "working",
	agent: "claude",
	terminalTitle: "claude",
	agentSessionId: SESSION_ID,
	revision: 1,
	sessionId: SESSION_ID,
	via: "env",
	viewedState: {
		currentMessageIndex: 3,
		lastViewedMessageIndex: 3,
		reviewTargetMessageIndex: 3,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

const BASE: SessionRailInputs = {
	sessionId: SESSION_ID,
	homeRoot: "/Users/alice",
	cwd: "/Users/alice/projects/avalonlogs",
	gitBranch: "alice/sync-upstream",
	model: "Opus 4.7",
	herdrPane: null,
};

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
});

async function renderCards(inputs: SessionRailInputs) {
	const rootRoute = createRootRoute({component: () => <SessionRailCards inputs={inputs} />});
	const router = createRouter({routeTree: rootRoute, history: createMemoryHistory({initialEntries: ["/"]})});
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ToastProvider>
				<RouterProvider router={router} />
			</ToastProvider>
		</QueryClientProvider>,
	);
	await act(async () => {
		await router.load();
	});
}

function rows(section: string): Array<[string, string | null]> {
	const card = screen.getByRole("region", {name: new RegExp(`^${section}`)});
	return [...within(card).getByTestId("rail-rows").children].map((row) => [
		row.querySelector("[data-rail-row-label]")?.textContent ?? "",
		row.querySelector("[data-rail-row-hint]")?.textContent ?? null,
	]);
}

describe("Environment card", () => {
	it("lists the working directory, branch, model and an unconnected herdr pane", async () => {
		await renderCards(BASE);

		expect(rows("Environment")).toStrictEqual([
			["~/projects/avalonlogs", null],
			["alice/sync-upstream", null],
			["Opus 4.7", null],
			["herdr", "Not connected"],
		]);
	});

	it("shows a live herdr pane's agent status and links to its terminal", async () => {
		await renderCards({...BASE, gitBranch: null, model: null, herdrPane: PANE});
		const card = screen.getByRole("region", {name: /^Environment/});

		expect({
			rows: rows("Environment"),
			href: within(card).getByRole("link", {name: /herdr/}).getAttribute("href"),
		}).toStrictEqual({
			rows: [
				["~/projects/avalonlogs", null],
				["herdr", "working"],
			],
			href: `/herdr/terminal/${SESSION_ID}`,
		});
	});
});
