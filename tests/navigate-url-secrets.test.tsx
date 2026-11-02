// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {getToolRenderer} from "../src/components/tool-renderers";

afterEach(() =>
{
	cleanup();
});

/** Obviously fake: a GitHub-token-shaped run of A's. */
const FAKE_GH = `ghp_${"A".repeat(36)}`;
const URL_WITH_SECRET = `https://example.invalid/hook?token=${FAKE_GH}`;

async function urlView(name: string): Promise<
{
	text: string | null;
	links: number;
}>
{
	const Renderer = getToolRenderer(name);
	const {container} = render(
		<Renderer
			toolCall={
			{
				id: "n1",
				name,
				input:
				{
					url: URL_WITH_SECRET,
				},
				param: URL_WITH_SECRET,
				result: `Navigated to ${URL_WITH_SECRET}`,
				sourceUuid: "source-n1",
			}}
		/>,
	);
	await waitFor(() =>
	{
		expect(container.textContent).toContain("Navigated to");
	});
	const span = container.querySelector("[data-navigate-url]");
	return {
		text: span?.textContent ?? null,
		links: container.querySelectorAll("a[href]").length,
	};
}

describe("navigate renderers mask a URL that holds a secret (upstream $2, unlinked)", () =>
{
	it.each([
		"mcp__claude-in-chrome__navigate",
		"mcp__chrome-devtools__navigate_page",
		"mcp__plugin_playwright_playwright__browser_navigate",
	])("%s", async (name) =>
	{
		expect(await urlView(name)).toStrictEqual(
			{
				text: "https://example.invalid/hook?token=ghp_AAAA••••••••••••••••••••••••••••••••",
				links: 0,
			},
		);
	});
});
