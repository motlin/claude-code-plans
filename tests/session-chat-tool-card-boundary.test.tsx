// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

const crash = vi.hoisted(() => (
{
	tool: "",
	summary: false,
	prompt: "",
}));

vi.mock("../src/components/tool-renderers", async (importOriginal) =>
{
	const actual = await importOriginal<typeof import("../src/components/tool-renderers")>();
	return {
		...actual,
		getCallRenderer: (call: Parameters<typeof actual.getCallRenderer>[0]) =>
		{
			if (call.name === crash.tool) throw new Error(`${call.name} renderer boom`);
			return actual.getCallRenderer(call);
		},
	};
});
vi.mock("../src/lib/session-utils", async (importOriginal) =>
{
	const actual = await importOriginal<typeof import("../src/lib/session-utils")>();
	return {
		...actual,
		summarizeToolCallStats: (...args: Parameters<typeof actual.summarizeToolCallStats>) =>
		{
			if (crash.summary) throw new Error("summary boom");
			return actual.summarizeToolCallStats(...args);
		},
		cleanPromptText: (text: string) =>
		{
			if (crash.prompt !== "" && text.includes(crash.prompt)) throw new Error("prompt boom");
			return actual.cleanPromptText(text);
		},
	};
});
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
	crash.tool = "";
	crash.summary = false;
	crash.prompt = "";
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const prompt = (text = "Fabricated request", uuid = "u-prompt") => (
{
	type: "user",
	uuid,
	message:
	{
		role: "user",
		content: text,
	},
});
const text = (uuid: string, body: string) => (
{
	type: "assistant",
	uuid,
	message:
	{
		id: `msg-${uuid}`,
		role: "assistant",
		content: [
			{
				type: "text",
				text: body,
			},
		],
	},
});
const toolUse = (id: string, name: string, input: object) => (
{
	type: "assistant",
	uuid: `a-${id}`,
	message:
	{
		id: `msg-${id}`,
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id,
				name,
				input,
			},
		],
	},
});
const toolResult = (id: string, content: string) => (
{
	type: "user",
	uuid: `r-${id}`,
	message:
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				content,
			},
		],
	},
});

function chat(records: unknown[])
{
	const {lines, toolResultMap} = processTranscript(records);
	return (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode="normal"
			showTools
			showThinking={false}
			shouldScrollToEnd={false}
		/>
	);
}

let root: HTMLElement = document.body;

/** Renders into a fresh container; the shared DOM pool can hold other files' leftovers in the body. */
function show(records: unknown[])
{
	const view = render(chat(records));
	root = view.container;
	return view;
}

const crashedCards = () => root.querySelectorAll("[data-testid=tool-card-crashed]");

describe("tool card crash boundaries in the transcript", () =>
{
	const bashThenRead = [
		prompt(),
		toolUse(
			"bash-1",
			"Bash",
			{
				command: "echo fabricated-bash",
			},
		),
		text("between", "Between the calls."),
		toolUse(
			"read-1",
			"Read",
			{
				file_path: "/tmp/fabricated-read.txt",
			},
		),
		toolResult("read-1", "fabricated contents"),
	];

	it("replaces a crashed card, header included, inside its own row and recovers when its result lands", () =>
	{
		crash.tool = "Bash";
		const view = show(bashThenRead);
		const fallback = crashedCards();
		expect(fallback.length).toEqual(1);
		expect(fallback[0]?.closest("[data-testid=transcript-row]")?.getAttribute("role")).toEqual("article");
		expect(root.textContent).not.toContain("echo fabricated-bash");
		expect(root.textContent).toContain("fabricated-read.txt");
		expect(root.querySelector("[data-transcript-row-crashed]")).toBeNull();

		crash.tool = "";
		view.rerender(chat([...bashThenRead, toolResult("bash-1", "fabricated output")]));
		expect(crashedCards().length).toEqual(0);
		expect(root.textContent).toContain("echo fabricated-bash");
	});

	it("stays on the fallback when the card re-renders in the same stage", () =>
	{
		crash.tool = "Bash";
		const view = show(bashThenRead);
		crash.tool = "";
		view.rerender(chat([...bashThenRead, text("later", "A later reply.")]));
		expect(crashedCards().length).toEqual(1);
		expect(root.textContent).not.toContain("echo fabricated-bash");
	});

	it("replaces a crashed prominent call's whole card", () =>
	{
		crash.tool = "AskUserQuestion";
		show([
			prompt(),
			toolUse(
				"question-1",
				"AskUserQuestion",
				{
					questions: [
						{
							question: "Continue the fabricated example?",
							header: "Example",
							multiSelect: false,
							options: [
								{
									label: "Continue",
									description: "Run it",
								},
								{
									label: "Stop",
									description: "Stop it",
								},
							],
						},
					],
				},
			),
			toolResult("question-1", "User answered: Continue"),
		]);
		const fallback = crashedCards();
		expect(fallback.length).toEqual(1);
		expect(fallback[0]?.parentElement?.className).not.toEqual("relative");
		expect(root.textContent).not.toContain("Continue the fabricated example?");
	});

	const group = (withSecondResult: boolean) => [
		prompt(),
		toolUse(
			"bash-a",
			"Bash",
			{
				command: "echo fabricated-a",
			},
		),
		toolResult("bash-a", "a"),
		toolUse(
			"bash-b",
			"Bash",
			{
				command: "echo fabricated-b",
			},
		),
		...(withSecondResult ? [toolResult("bash-b", "b")] : []),
		toolUse(
			"read-c",
			"Read",
			{
				file_path: "/tmp/fabricated-c.txt",
			},
		),
		toolResult("read-c", "c"),
	];

	it("gives a multi-call group one fallback and redraws it when the group's last result lands", () =>
	{
		crash.summary = true;
		const view = show(group(false));
		expect(crashedCards().length).toEqual(1);
		expect(root.querySelector("button[aria-expanded]")).toBeNull();

		crash.summary = false;
		view.rerender(chat(group(true)));
		expect(crashedCards().length).toEqual(0);
		expect(root.querySelector("button[aria-expanded]")?.tagName).toEqual("BUTTON");
	});

	it("keeps a grouped row's crash inside that row while the group header stays", () =>
	{
		const view = show(group(true));
		const toggle = root.querySelector<HTMLElement>("button[aria-expanded]");
		if (toggle === null) throw new Error("no group toggle");
		fireEvent.click(toggle);
		crash.tool = "Read";
		view.rerender(chat([...group(true), text("later", "A later reply.")]));
		expect(crashedCards().length).toEqual(1);
		expect(root.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toEqual("true");
		expect(root.textContent).toContain("echo fabricated-a");
	});
});

describe("transcript row crash boundary", () =>
{
	it("replaces only the crashed row with the row banner", () =>
	{
		const records = [
			prompt("Explode this prompt", "u-boom"),
			text("reply-1", "A fabricated reply."),
			prompt("A second fabricated prompt", "u-second"),
		];
		const intactRows = show(records).container.querySelectorAll("[data-testid=transcript-row]").length;
		cleanup();
		crash.prompt = "Explode this prompt";
		show(records);
		const rows = root.querySelectorAll("[data-testid=transcript-row]");
		const crashed = root.querySelector("[data-transcript-row-crashed]");
		const article = crashed?.closest("[data-testid=transcript-row]");
		expect(
			{
				kind: crashed?.getAttribute("data-transcript-row-crashed"),
				role: article?.getAttribute("role"),
				posinset: article?.getAttribute("aria-posinset"),
				rows: rows.length,
				copy: crashed?.textContent,
			},
		).toEqual(
			{
				kind: "row",
				role: "article",
				posinset: "1",
				rows: intactRows,
				copy: "Couldn’t load this.Try again",
			},
		);
		expect(root.textContent).toContain("A fabricated reply.");
		expect(root.textContent).toContain("A second fabricated prompt");
	});
});
