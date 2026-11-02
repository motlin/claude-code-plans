// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {ProseMarkdown} from "../src/components/file-refs";
import {MarkdownView} from "../src/components/markdown-view";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
			codeThemeLight: "claude-light",
			codeThemeDark: "github-dark",
		},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => (
{
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		failedTools: new Map(),
	}),
}));
// The island itself is covered elsewhere; here only which surfaces opt into the diagram context matters.
vi.mock("../src/components/mermaid-fence-gate", () => (
{
	MermaidFenceGate: ({code}: {code: string}) => <span data-testid="island">{code}</span>,
}));

class FakeResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const FENCE = "Here it is:\n\n```mermaid\ngraph TD; A-->B\n```";

function transcriptFences(records: unknown[])
{
	const {lines, toolResultMap} = processTranscript(records);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showThinking
			showTools
			shouldScrollToEnd={false}
		/>,
	);
	return Array.from(container.querySelectorAll("[data-mermaid-fence]"), (fence) => (
	{
		inProse: fence.closest("[data-transcript-prose]") !== null,
		source: fence.getAttribute("data-mermaid-source"),
	}));
}

describe("which markdown surfaces draw mermaid (upstream's diagram vs code context)", () =>
{
	it("marks the fence in assistant transcript text", () =>
	{
		const records = [
			{
				type: "user",
				uuid: "u-1",
				message:
				{
					role: "user",
					content: "Fabricated question",
				},
			},
			{
				type: "assistant",
				uuid: "a-1",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: FENCE,
						},
					],
				},
			},
		];
		expect(transcriptFences(records)).toStrictEqual([
			{
				inProse: true,
				source: "graph TD; A-->B",
			},
		]);
	});

	it("keeps user turns as code", () =>
	{
		const records = [
			{
				type: "user",
				uuid: "u-1",
				message:
				{
					role: "user",
					content: FENCE,
				},
			},
		];
		expect(transcriptFences(records)).toStrictEqual([]);
	});

	it("keeps thinking blocks as code", () =>
	{
		const records = [
			{
				type: "user",
				uuid: "u-1",
				message:
				{
					role: "user",
					content: "Fabricated question",
				},
			},
			{
				type: "assistant",
				uuid: "a-1",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: FENCE,
							signature: "",
						},
					],
				},
			},
		];
		expect(transcriptFences(records)).toStrictEqual([]);
	});

	it("keeps prose markdown, plans and memories as code unless asked", () =>
	{
		const {container} = render(
			<>
				<ProseMarkdown markdown={FENCE} />
				<MarkdownView markdown={FENCE} />
			</>,
		);
		expect(
			{
				fences: container.querySelectorAll("[data-mermaid-fence]").length,
				codeBlocks: container.querySelectorAll(".markdown-codeblock").length,
			},
		).toStrictEqual(
			{
				fences: 0,
				codeBlocks: 2,
			},
		);
	});
});
