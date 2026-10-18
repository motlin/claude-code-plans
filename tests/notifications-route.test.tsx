// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {createElement} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {hookStatusQueryOptions} from "../src/lib/api/hooks";
import {notificationsQueryOptions, type Notification} from "../src/lib/api/notifications";
import {HOOK_EVENT_NAMES, hookInstallStatus} from "../src/lib/hook-config";
import {TOUCH_REVEAL} from "../src/lib/touch-reveal";
import {Route as NotificationsRoute} from "../src/routes/notifications";

afterEach(() => {
	cleanup();
});

const ORIGIN_SENTENCE =
	"Claude Code posts one here through its Notification hook, when a session is waiting on you or has finished a turn.";
const LIFETIME_SENTENCE =
	"Notifications are held in this server’s memory only: each one expires after 24 hours, and restarting the server clears them all.";
const MISSING_HOOK_SENTENCE =
	"That hook is not installed in Claude Code’s settings, so no notification can reach this page.";

const OUTDATED_HOOK_SENTENCE =
	"That hook is installed in Claude Code’s settings, but with an older command than this server now generates.";

async function renderNotifications(
	notifications: Notification[],
	missingEvents: string[],
	outdatedEvents: string[] = [],
) {
	const NotificationsPage = NotificationsRoute.options.component;
	if (!NotificationsPage) throw new Error("Expected the notifications route component");

	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications});
	queryClient.setQueryData(hookStatusQueryOptions.queryKey, {
		...hookInstallStatus(undefined),
		installed: missingEvents.length === 0 && outdatedEvents.length === 0,
		partial: missingEvents.length > 0 && missingEvents.length < HOOK_EVENT_NAMES.length,
		installedCount: HOOK_EVENT_NAMES.length - missingEvents.length,
		totalCount: HOOK_EVENT_NAMES.length,
		settingsPath: "/Users/test/.claude/settings.json",
		missingEvents,
		outdatedEvents,
	});

	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>{createElement(NotificationsPage)}</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/notifications"]}),
	});
	await router.load();

	render(<RouterProvider router={router} />);
}

async function renderEmptyNotifications(missingEvents: string[], outdatedEvents: string[] = []) {
	await renderNotifications([], missingEvents, outdatedEvents);
}

function emptyStateSentences(): string[] {
	const region = screen.getByRole("region", {name: "Why there are no notifications"});
	return [...region.querySelectorAll("p")].map((paragraph) => paragraph.textContent.replace(/\s+/g, " ").trim());
}

describe("notifications route empty state", () => {
	it("explains that the missing Notification hook is why nothing can arrive", async () => {
		await renderEmptyNotifications([...HOOK_EVENT_NAMES]);

		expect({
			sentences: emptyStateSentences(),
			setupHref: screen.getByRole("link", {name: "Install hooks"}).getAttribute("href"),
		}).toStrictEqual({
			sentences: [ORIGIN_SENTENCE, `${MISSING_HOOK_SENTENCE} Install hooks`, LIFETIME_SENTENCE],
			setupHref: "/setup",
		});
	});

	it("flags the missing Notification hook even when other hooks are installed", async () => {
		await renderEmptyNotifications(["Notification"]);

		expect(emptyStateSentences()).toStrictEqual([
			ORIGIN_SENTENCE,
			`${MISSING_HOOK_SENTENCE} Install hooks`,
			LIFETIME_SENTENCE,
		]);
	});

	it("drops the setup prompt once the Notification hook is installed", async () => {
		await renderEmptyNotifications([]);

		expect({
			sentences: emptyStateSentences(),
			setupLink: screen.queryByRole("link", {name: "Install hooks"}),
		}).toStrictEqual({
			sentences: [ORIGIN_SENTENCE, LIFETIME_SENTENCE],
			setupLink: null,
		});
	});

	it("calls an outdated Notification hook outdated rather than not installed", async () => {
		await renderEmptyNotifications([], ["Notification"]);

		expect({
			sentences: emptyStateSentences(),
			setupHref: screen.getByRole("link", {name: "Update hooks"}).getAttribute("href"),
		}).toStrictEqual({
			sentences: [ORIGIN_SENTENCE, `${OUTDATED_HOOK_SENTENCE} Update hooks`, LIFETIME_SENTENCE],
			setupHref: "/setup",
		});
	});
});

describe("notifications route dismiss button", () => {
	it("reveals on hover, keyboard focus and touch devices", async () => {
		await renderNotifications(
			[
				{
					id: "n1",
					sessionId: "s1",
					projectId: "p1",
					projectName: "proj",
					message: "Waiting for input",
					notificationType: "agent_needs_input",
					createdAt: 0,
					createdAtIso: "2026-10-18T00:00:00.000Z",
					unread: true,
				},
			],
			[],
		);

		expect(screen.getByRole("button", {name: "Dismiss notification"}).className.split(" ")).toStrictEqual([
			"absolute",
			"right-2",
			"top-2",
			"rounded",
			"p-1",
			"text-t6",
			"opacity-0",
			"transition-opacity",
			"hover:bg-fill-ghost-hover",
			"hover:text-primary",
			"group-hover:opacity-100",
			"group-focus-within:opacity-100",
			"focus-visible:opacity-100",
			...TOUCH_REVEAL.split(" "),
		]);
	});
});
