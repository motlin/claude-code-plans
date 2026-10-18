// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionRow} from "../src/components/session-row";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import type {SessionListItem} from "../src/lib/api/sessions";
import {installLocalStorage} from "./fake-storage";

const SESSION: SessionListItem = {
	id: "8f0c2c7e-1111-4222-8333-944445555666",
	title: "Fix the flaky test",
	mtime: "2026-09-28T10:00:00.000Z",
	created: "2026-09-28T09:00:00.000Z",
	project: "-projects-alpha",
	projectName: "alpha",
	messageCount: 4,
	archived: false,
	state: "ended",
	bucket: "done",
	liveAgentCount: 0,
	unseen: false,
	blockedSince: null,
	gitBranch: "feature/long-branch-name",
};

async function renderRow(session: SessionListItem) {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false}},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<ul>
						<SessionRow session={session} isActive={false} />
					</ul>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const sessionRoute = createRoute({getParentRoute: () => rootRoute, path: "/session/$id", component: () => null});
	const router = createRouter({
		routeTree: rootRoute.addChildren([sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await waitFor(() => {
		expect(screen.getByText(session.gitBranch ?? "")).toBeTruthy();
	});
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
});

describe("SessionRow", () => {
	it("drops the branch chip and its separator under 640px, where it would collapse to a stub", async () => {
		await renderRow(SESSION);
		const chip = screen.getByText("feature/long-branch-name");
		const separator = chip.previousElementSibling;
		expect({
			chipHidden: chip.classList.contains("max-sm:hidden"),
			separator: separator?.textContent,
			separatorHidden: separator?.classList.contains("max-sm:hidden"),
		}).toStrictEqual({chipHidden: true, separator: "·", separatorHidden: true});
	});
});
