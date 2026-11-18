import {describe, expect, it, vi} from "vite-plus/test";
import {renderToStaticMarkup} from "react-dom/server";
import {BackgroundLaunchBanner} from "../src/components/background-launch-banner";
import {SubagentOpenerProvider} from "../src/components/subagent-opener-context";

const line =
{
	type: "background-launch",
	description: "summarize the parser tests",
	agentId: "agent-asummarize-the-p-1a2b3c4d5e6f7a8b",
	lineIndex: 0,
} as const;

function links(html: string): string[][]
{
	return Array.from(html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g), ([, href, text]) => [
		href ?? "",
		text ?? "",
	]);
}

describe("BackgroundLaunchBanner", () =>
{
	it("names the launched agent and links to its transcript", () =>
	{
		const html = renderToStaticMarkup(<BackgroundLaunchBanner line={line} />);
		expect(
			{
				text: html.replace(/<[^>]*>/g, ""),
				links: links(html),
			},
		).toStrictEqual(
			{
				text: "Started in the background: summarize the parser tests",
				links: [["/session/agent-asummarize-the-p-1a2b3c4d5e6f7a8b", "summarize the parser tests"]],
			},
		);
	});

	it("keeps the transcript link when a subagent pane can host the agent", () =>
	{
		const html = renderToStaticMarkup(
			<SubagentOpenerProvider value={vi.fn<(agentId: string) => void>()}>
				<BackgroundLaunchBanner line={line} />
			</SubagentOpenerProvider>,
		);
		expect(links(html)).toStrictEqual([
			["/session/agent-asummarize-the-p-1a2b3c4d5e6f7a8b", "summarize the parser tests"],
		]);
	});
});
