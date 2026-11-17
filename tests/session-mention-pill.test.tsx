// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SessionMentionsProvider} from "../src/components/session-mention-pill";
import {UserPlainText} from "../src/components/user-plain-text";
import type {ResolvedSessionMention} from "../src/lib/mention-sessions";

afterEach(() =>
{
	cleanup();
});

async function renderPrompt(text: string, mentions: readonly ResolvedSessionMention[]): Promise<HTMLElement>
{
	const rootRoute = createRootRoute(
		{
			component: () => (
				<SessionMentionsProvider mentions={mentions}>
					<UserPlainText text={text} />
				</SessionMentionsProvider>
			),
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
	render(<RouterProvider router={router} />);
	return waitFor(() => screen.getByTestId("user-message"));
}

describe("transcript session mention pill", () =>
{
	it("links a recorded live session's @[Title] as upstream's session link chip", async () =>
	{
		const message = await renderPrompt("see @[Fix bug] now", [
			{
				sessionId: "session-bob",
				title: "Fix bug",
				archived: false,
			},
		]);

		const link = message.querySelector("a");
		expect(
			{
				paragraph: message.querySelector("p")?.textContent,
				href: link?.getAttribute("href"),
				className: link?.className,
				label: link?.querySelector("bdi")?.outerHTML,
			},
		).toStrictEqual(
			{
				paragraph: "see Fix bug now",
				href: "/session/session-bob",
				className:
					"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight text-upstream-accent no-underline hover:bg-upstream-accent-pressed data-[menu-open]:bg-upstream-accent-pressed focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus",
				label: '<bdi dir="ltr">Fix bug</bdi>',
			},
		);
	});

	it("shows an archived session's title as a words-only chip, with no link", async () =>
	{
		const message = await renderPrompt("see @[Fix bug] now", [
			{
				sessionId: "session-bob",
				title: "Fix bug",
				archived: true,
			},
		]);

		expect(
			{
				text: message.querySelector("p")?.textContent,
				links: message.querySelectorAll("a").length,
				chip: message.querySelector(".epitaxy-link-chip")?.tagName,
			},
		).toStrictEqual(
			{
				text: "see Fix bug now",
				links: 0,
				chip: "SPAN",
			},
		);
	});

	it("leaves an unrecorded @[Title] as typed", async () =>
	{
		const message = await renderPrompt("see @[Fix bug] now", []);

		expect(
			{
				text: message.querySelector("p")?.textContent,
				links: message.querySelectorAll("a").length,
			},
		).toStrictEqual(
			{
				text: "see @[Fix bug] now",
				links: 0,
			},
		);
	});
});
