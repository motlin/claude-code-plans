// @vitest-environment jsdom

import {cleanup, fireEvent, render, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {type PeerSender, type PeerSenders, PeerSendersContext} from "../src/components/peer-senders-context";
import {parsePeerMessage} from "../src/lib/agent-message";
import {processTranscript} from "../src/lib/transcript";
import type {Subagent} from "../src/lib/subagents";
import type {TranscriptMode} from "../src/lib/transcript-mode";

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
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(
		HTMLElement.prototype,
		"scrollIntoView",
		{
			configurable: true,
			value: vi.fn<HTMLElement["scrollIntoView"]>(),
		},
	);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const HANDBACK_FRAME =
	"[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:";

const AGENT_MESSAGE = [
	'<agent-message from="a2f0d355334c32c1e">',
	HANDBACK_FRAME,
	"  Both commits created **locally** on `main`.",
	"  ",
	"  - first item",
	"</agent-message>",
].join("\n");

const PEER_PROMPT = [
	"Another Claude session sent a message:",
	AGENT_MESSAGE,
	"",
	'That "other Claude session" is an agent working inside this same session.',
].join("\n");

/** The record origin the CLI stamps on a subagent hand-back. */
const HANDBACK_ORIGIN =
{
	kind: "peer",
	from: "a2f0d355334c32c1e",
	senderTaskId: "a2f0d355334c32c1e",
	handback: true,
	body: AGENT_MESSAGE,
};

const CROSS_SESSION_BODY = "Reminder fired: oxfmt-next-line 0.75.0 is 24h old.\nAll **47** projects pin `0.75.0`.";

const CROSS_SESSION_PROMPT = [
	"Another Claude session sent a message:",
	'<cross-session-message from="uds:/tmp/cc-socks/45145.sock" from-name="workflowy-5c" from-mode="prompting">',
	CROSS_SESSION_BODY,
	"</cross-session-message>",
	"",
	"This came from another Claude session \u2014 not typed by your user, but very likely working on their behalf.",
].join("\n");

const CROSS_SESSION_ORIGIN =
{
	kind: "peer",
	from: "uds:/tmp/cc-socks/45145.sock",
	name: "workflowy-5c",
	fromMode: "prompting",
	msg_id: "m1",
	verifiedPeerPid: 45145,
	body: CROSS_SESSION_BODY,
};

const SUBAGENT: Subagent =
{
	id: "agent-a2f0d355334c32c1e",
	sessionId: "test-session",
	projectId: "p",
	parentAgentId: null,
	agentType: "general-purpose",
	attributionAgent: null,
	slug: null,
	description: "Commit the test harness",
	model: null,
	startedAt: "2026-09-18T16:40:00.000Z",
	finishedAt: "2026-09-18T16:43:00.000Z",
};

function renderLines(records: unknown[], subagents: Subagent[] = [], mode: TranscriptMode = "normal"): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			subagents={subagents}
			shouldScrollToEnd={false}
			transcriptMode={mode}
		/>,
	).container;
}

function queuedCommandRecord(prompt: string, origin: unknown = HANDBACK_ORIGIN)
{
	return {
		type: "attachment",
		uuid: "att-1",
		parentUuid: null,
		isSidechain: false,
		sessionId: "test-session",
		timestamp: "2026-09-18T16:43:30.000Z",
		attachment:
		{
			type: "queued_command",
			prompt,
			commandMode: "prompt",
			timestamp: "2026-09-18T16:43:29.043Z",
			origin,
		},
	};
}

function metaUserRecord(content: string, origin: unknown, uuid = "user-1")
{
	return {
		type: "user",
		uuid,
		isMeta: true,
		origin,
		timestamp: "2026-09-18T16:47:16.203Z",
		message:
		{
			role: "user",
			content,
		},
	};
}

function rowState(container: HTMLElement)
{
	const button = within(container).getByRole(
		"button",
		{
			name: /message from subagent$/,
		},
	);
	return {
		text: container.textContent.includes("Message from"),
		label: button.getAttribute("aria-label"),
		expanded: button.getAttribute("aria-expanded"),
		strong: container.querySelector("strong")?.textContent ?? null,
		literal: container.textContent.includes("**locally**"),
		rawTag: container.textContent.includes("<agent-message"),
		frame: container.textContent.includes("[Subagent hand-back]"),
	};
}

describe("parsePeerMessage", () =>
{
	it("parses a cross-session record: lead-in and footer stripped, the stamped name kept", () =>
	{
		expect(
			parsePeerMessage(
				CROSS_SESSION_PROMPT,
				{
					name: "workflowy-5c",
				},
			),
		).toStrictEqual(
			{
				kind: "peer",
				from: "uds:/tmp/cc-socks/45145.sock",
				name: "workflowy-5c",
				stamped: true,
				subagent: false,
				handback: false,
				deliveredWhile: "idle",
				body: CROSS_SESSION_BODY,
			},
		);
	});

	it("takes an unstamped cross-session sender's name from the envelope and unescapes an encoded body", () =>
	{
		const text = [
			"Another Claude session sent a message while you were working:",
			'<cross-session-message from="uds:/tmp/2.sock" from-name="klass-48" encoded="1">',
			"a &lt;b&gt; &amp; c",
			"</cross-session-message>",
		].join("\n");

		expect(parsePeerMessage(text, {})).toStrictEqual(
			{
				kind: "peer",
				from: "uds:/tmp/2.sock",
				name: "klass-48",
				stamped: false,
				subagent: false,
				handback: false,
				deliveredWhile: "working",
				body: "a <b> & c",
			},
		);
	});

	it("extracts the dedented report from a hand-back", () =>
	{
		expect(
			parsePeerMessage(
				PEER_PROMPT,
				{
					senderTaskId: "a2f0d355334c32c1e",
					handback: true,
				},
			),
		).toStrictEqual(
			{
				kind: "peer",
				from: "a2f0d355334c32c1e",
				stamped: false,
				subagent: true,
				handback: true,
				deliveredWhile: "idle",
				body: "Both commits created **locally** on `main`.\n\n- first item",
			},
		);
	});

	it("keeps a hand-back's text above its frame as the note", () =>
	{
		const text = AGENT_MESSAGE.replace(HANDBACK_FRAME, `  Note line\n${HANDBACK_FRAME}`);

		expect(
			parsePeerMessage(
				text,
				{
					senderTaskId: "a2f0d355334c32c1e",
					handback: true,
				},
			),
		).toStrictEqual(
			{
				kind: "peer",
				from: "a2f0d355334c32c1e",
				stamped: false,
				subagent: true,
				handback: true,
				handbackNote: "Note line",
				body: "Both commits created **locally** on `main`.\n\n- first item",
			},
		);
	});

	it("keeps a non-hand-back body whole", () =>
	{
		expect(parsePeerMessage('<agent-message from="x1">\nhello\n</agent-message>', undefined)).toStrictEqual(
			{
				kind: "peer",
				from: "x1",
				stamped: false,
				subagent: false,
				handback: false,
				body: "hello",
			},
		);
	});

	it("leaves a teammate envelope with no record origin to the fallback card", () =>
	{
		const text = [
			"Another Claude session sent a message:",
			'<teammate-message teammate_id="scene-splitter" color="blue">',
			"{}",
			"</teammate-message>",
		].join("\n");

		expect(parsePeerMessage(text, undefined)).toBeNull();
	});

	it("returns null for ordinary text", () =>
	{
		expect(parsePeerMessage("just a prompt", {})).toBeNull();
	});

	it("reads a relayed agent message (upstream Ds/Os): an agent id, a clean name, and never an encoded body", () =>
	{
		const relayed = (from: string, encoded = false) =>
			[
				`<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="klass-48"${encoded ? ' encoded="1"' : ""}>`,
				`<\\agent-message from="${from}">`,
				"hi",
				"<\\/agent-message>",
				"</cross-session-message>",
			].join("\n");
		const base =
		{
			kind: "peer",
			from: "uds:/tmp/cc-socks/1.sock",
			name: "klass-48",
			stamped: false,
			subagent: false,
			handback: false,
		};

		expect(
			{
				agentId: parsePeerMessage(relayed("a0123456789abcdef"), {}),
				named: parsePeerMessage(relayed("reviewer"), {}),
				encoded: parsePeerMessage(relayed("reviewer", true), {})?.relayedAgent,
				noOrigin: parsePeerMessage(relayed("reviewer"), undefined)?.relayedAgent,
			},
		).toStrictEqual(
			{
				agentId:
				{
					...base,
					relayedAgent: {},
					body: "hi",
				},
				named:
				{
					...base,
					relayedAgent:
					{
						name: "reviewer",
					},
					body: "hi",
				},
				encoded: undefined,
				noOrigin: undefined,
			},
		);
	});
});

describe("Message from subagent rows", () =>
{
	it("draws nothing for a hand-back absorbed mid-turn as a queued_command in Normal mode, as upstream", () =>
	{
		const container = renderLines([queuedCommandRecord(AGENT_MESSAGE)]);

		expect(
			{
				rows: container.querySelectorAll("[data-peer-message-from]").length,
				mentioned: container.textContent.includes("Message from"),
			},
		).toStrictEqual(
			{
				rows: 0,
				mentioned: false,
			},
		);
	});

	it("renders a queued_command hand-back in Verbose mode as a Message from row forced open, its body plain text", () =>
	{
		const container = renderLines([queuedCommandRecord(AGENT_MESSAGE)], [], "verbose");

		expect(rowState(container)).toStrictEqual(
			{
				text: true,
				label: "Hide message from subagent",
				expanded: "true",
				strong: null,
				literal: true,
				rawTag: false,
				frame: false,
			},
		);
	});

	it("names a hand-back's sender subagent, as upstream does, even when the session knows its description", () =>
	{
		const named = renderLines([queuedCommandRecord(AGENT_MESSAGE)], [SUBAGENT], "verbose");
		const namedSender = named.querySelector("bdi")?.textContent;
		cleanup();
		const unnamed = renderLines([queuedCommandRecord(AGENT_MESSAGE)], [], "verbose");
		const unnamedSender = unnamed.querySelector("bdi")?.textContent;

		expect(
			{
				namedSender,
				unnamedSender,
			},
		).toStrictEqual(
			{
				namedSender: "subagent",
				unnamedSender: "subagent",
			},
		);
	});

	it("draws upstream's status row: a header div, a muted verb, and a 20x20 toggle around a 14px chevron", () =>
	{
		const container = renderLines([metaUserRecord(PEER_PROMPT, HANDBACK_ORIGIN)], [SUBAGENT]);
		const button = within(container).getByRole(
			"button",
			{
				name: "Show message from subagent",
			},
		);
		const header = button.parentElement;
		const svg = button.querySelector("svg");

		expect(
			{
				wrapper: header?.parentElement?.className,
				header: header?.className,
				parts: [...(header?.children ?? [])].map((child) => (
				{
					tag: child.tagName,
					className: child.className,
				})),
				expandedAttrs: container.querySelectorAll("[aria-expanded]").length,
				chevron: [svg?.getAttribute("width"), svg?.getAttribute("height")],
			},
		).toStrictEqual(
			{
				wrapper: "flex flex-col w-full ps-[var(--cds-assistant-message-text-inset,0px)]",
				header: "relative group/tool flex self-start max-w-full items-center py-0 gap-0.75 text-start rounded-sm text-body text-secondary",
				parts: [
					{
						tag: "SPAN",
						className:
							"shrink-0 whitespace-nowrap text-muted-as-secondary group-hover/tool:text-secondary group-focus-visible/tool:text-secondary group-has-[:focus-visible]/tool:text-secondary",
					},
					{
						tag: "SPAN",
						className: "min-w-0 truncate text-primary",
					},
					{
						tag: "BUTTON",
						className:
							"-m-0.75 flex shrink-0 cursor-pointer rounded-sm p-0.75 focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus",
					},
				],
				expandedAttrs: 1,
				chevron: ["1em", "1em"],
			},
		);
	});

	it("shows a hand-back's note as a warning line above the report", () =>
	{
		const prompt = PEER_PROMPT.replace(HANDBACK_FRAME, `  Note line\n${HANDBACK_FRAME}`);
		const container = renderLines([metaUserRecord(prompt, HANDBACK_ORIGIN)], [SUBAGENT]);
		fireEvent.click(
			within(container).getByRole(
				"button",
				{
					name: "Show message from subagent",
				},
			),
		);
		const body = container.querySelector("[data-find-included]");

		expect(
			{
				body: body?.className,
				paragraphs: [...(body?.children ?? [])].map((child) => (
				{
					className: child.className,
					text: child.textContent,
				})),
				warning: body?.querySelector('[role="img"]')?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				body: "pt-p3 comfortable:pt-p5 flex flex-col gap-g5 comfortable:gap-g6",
				paragraphs: [
					{
						className:
							"text-body whitespace-pre-wrap [overflow-wrap:anywhere] select-text flex items-start gap-1 text-warning",
						text: "Note line",
					},
					{
						className:
							"text-body whitespace-pre-wrap [overflow-wrap:anywhere] select-text text-primary [unicode-bidi:plaintext]",
						text: "Both commits created **locally** on main.\n\n- first item",
					},
				],
				warning: "Warning",
			},
		);
	});

	it("clamps a body over 1200 characters behind Show more", () =>
	{
		const long = Array.from(
			{
				length: 40,
			},
			(_, index) => `Line ${index} of a long peer message body with some padding text.`,
		).join("\n");
		const container = renderLines([
			metaUserRecord(CROSS_SESSION_PROMPT.replace(CROSS_SESSION_BODY, long), CROSS_SESSION_ORIGIN),
		]);
		fireEvent.click(
			within(container).getByRole(
				"button",
				{
					name: "Show message from workflowy-5c",
				},
			),
		);
		const state = () =>
		{
			const toggle = within(container).getByRole(
				"button",
				{
					name: /^Show (more|less)$/,
				},
			);
			return {
				srOnly: container.querySelector("[data-peer-message-from] p.sr-only")?.textContent ?? null,
				inert: container.querySelectorAll("p[inert]").length,
				clamped: container.querySelector("p[inert]")?.className.includes("max-h-[16rem]") ?? false,
				toggle: toggle.textContent,
				expanded: toggle.getAttribute("aria-expanded"),
			};
		};
		const collapsed = state();
		fireEvent.click(
			within(container).getByRole(
				"button",
				{
					name: "Show more",
				},
			),
		);

		expect(
			{
				collapsed,
				expanded: state(),
			},
		).toStrictEqual(
			{
				collapsed:
				{
					srOnly: "Line 0 of a long peer message body with some padding text.",
					inert: 1,
					clamped: true,
					toggle: "Show more",
					expanded: "false",
				},
				expanded:
				{
					srOnly: null,
					inert: 0,
					clamped: false,
					toggle: "Show less",
					expanded: "true",
				},
			},
		);
	});

	it("leaves a typed prompt that quotes the envelope as a user bubble", () =>
	{
		const container = renderLines([
			{
				type: "user",
				uuid: "user-typed",
				message:
				{
					role: "user",
					content: PEER_PROMPT,
				},
			},
		]);

		expect(
			{
				toggles: within(container).queryAllByRole(
					"button",
					{
						name: /message from subagent$/,
					},
				).length,
				quoted: container.textContent.includes('<agent-message from="a2f0d355334c32c1e">'),
			},
		).toStrictEqual(
			{
				toggles: 0,
				quoted: true,
			},
		);
	});

	it("renders a peer hand-back user message as a Message from row", () =>
	{
		const container = renderLines([metaUserRecord(PEER_PROMPT, HANDBACK_ORIGIN)], [SUBAGENT]);
		fireEvent.click(
			within(container).getByRole(
				"button",
				{
					name: "Show message from subagent",
				},
			),
		);

		expect(
			{
				sender: container.querySelector("bdi")?.textContent,
				...rowState(container),
				trailer: container.textContent.includes("other Claude session"),
				// Upstream's p8 drops a carded turn's ["copy"] action (shared-80 `Gq`), so no Copy toolbar mounts.
				toolbars: container.querySelectorAll('[data-testid="user-message-actions"]').length,
				copyButtons: container.querySelectorAll('[data-testid="user-message-copy"]').length,
			},
		).toStrictEqual(
			{
				sender: "subagent",
				text: true,
				label: "Hide message from subagent",
				expanded: "true",
				strong: null,
				literal: true,
				rawTag: false,
				frame: false,
				trailer: false,
				toolbars: 0,
				copyButtons: 0,
			},
		);
	});
});

describe("Received message from rows", () =>
{
	function senderState(container: HTMLElement)
	{
		return {
			verb: container.querySelector("[data-peer-message-from] span")?.textContent,
			subject: container.querySelector("[data-peer-message-from] bdi")?.textContent,
			from: container.querySelector("p[data-find-omitted]:not(.sr-only)")?.textContent ?? null,
			body: container.querySelector("[data-find-included] p:last-child")?.textContent ?? null,
			bubbles: container.querySelectorAll(".user-message-bubble").length,
		};
	}

	function expand(container: HTMLElement, sender: string)
	{
		fireEvent.click(
			within(container).getByRole(
				"button",
				{
					name: `Show message from ${sender}`,
				},
			),
		);
	}

	it("draws a cross-session line as Received message from its stamped name, its body plain text with code spans", () =>
	{
		const container = renderLines([metaUserRecord(CROSS_SESSION_PROMPT, CROSS_SESSION_ORIGIN)]);
		expand(container, "workflowy-5c");

		expect(
			{
				...senderState(container),
				code: container.querySelector("[data-find-included] code")?.textContent,
			},
		).toStrictEqual(
			{
				verb: "Received message from",
				subject: "workflowy-5c",
				from: null,
				body: "Reminder fired: oxfmt-next-line 0.75.0 is 24h old.\nAll **47** projects pin 0.75.0.",
				bubbles: 0,
				code: "0.75.0",
			},
		);
	});

	it("names an unstamped cross-session sender another session, with a From line", () =>
	{
		const {name: _name, ...unstamped} = CROSS_SESSION_ORIGIN;
		const container = renderLines([metaUserRecord(CROSS_SESSION_PROMPT, unstamped)]);
		expand(container, "another session");

		expect(senderState(container)).toStrictEqual(
			{
				verb: "Received message from",
				subject: "another session",
				from: "From: workflowy-5c",
				body: "Reminder fired: oxfmt-next-line 0.75.0 is 24h old.\nAll **47** projects pin 0.75.0.",
				bubbles: 0,
			},
		);
	});

	it("opens every peer row in Verbose (upstream's expand-all) and ignores the toggle there", () =>
	{
		const container = renderLines([metaUserRecord(CROSS_SESSION_PROMPT, CROSS_SESSION_ORIGIN)], [], "verbose");
		const toggle = within(container).getByRole(
			"button",
			{
				name: "Hide message from workflowy-5c",
			},
		);
		const before = toggle.getAttribute("aria-expanded");
		fireEvent.click(toggle);

		expect(
			{
				before,
				after: toggle.getAttribute("aria-expanded"),
				body: senderState(container).body,
			},
		).toStrictEqual(
			{
				before: "true",
				after: "true",
				body: "Reminder fired: oxfmt-next-line 0.75.0 is 24h old.\nAll **47** projects pin 0.75.0.",
			},
		);
	});

	it("shows a relayed agent's line above the content: Sent by a subagent, or Agent: {name}", () =>
	{
		const prompt = (from: string) =>
			CROSS_SESSION_PROMPT.replace(
				CROSS_SESSION_BODY,
				[`<\\agent-message from="${from}">`, "hi", "<\\/agent-message>"].join("\n"),
			);
		const lines = (container: HTMLElement) =>
			[...container.querySelectorAll("[data-find-included] p")].map((p) => p.textContent);
		const anonymous = lines(
			renderLines([metaUserRecord(prompt("a0123456789abcdef"), CROSS_SESSION_ORIGIN)], [], "verbose"),
		);
		cleanup();
		const named = lines(renderLines([metaUserRecord(prompt("reviewer"), CROSS_SESSION_ORIGIN)], [], "verbose"));

		expect(
			{
				anonymous,
				named,
			},
		).toStrictEqual(
			{
				anonymous: ["Sent by a subagent", "hi"],
				named: ["Agent: reviewer", "hi"],
			},
		);
	});

	it("names and links a known sender session by its title (upstream bt), plain when it is this session", () =>
	{
		const openSession = vi.fn<(sessionId: string) => void>();
		const lookups: (readonly [string, string | undefined])[] = [];
		const sendersFor = (sender: PeerSender | undefined): PeerSenders => (
		{
			hostSessionId: "S1",
			lookup: (from, sentAt) =>
			{
				lookups.push([from, sentAt]);
				return sender;
			},
			openSession,
		});
		const renderWith = (sender: PeerSender | undefined, origin: unknown) =>
		{
			const {lines, toolResultMap} = processTranscript([metaUserRecord(CROSS_SESSION_PROMPT, origin)]);
			const senders = sendersFor(sender);
			return render(
				<PeerSendersContext.Provider value={senders}>
					<SessionChat
						sessionId="S1"
						lines={lines}
						toolResultMap={toolResultMap}
						subagents={[]}
						shouldScrollToEnd={false}
						transcriptMode="verbose"
					/>
				</PeerSendersContext.Provider>,
			).container;
		};
		const {name: _name, ...unstamped} = CROSS_SESSION_ORIGIN;

		const other = renderWith(
			{
				sessionId: "S2",
				title: "Fix login",
			},
			unstamped,
		);
		const link = other.querySelector("[data-peer-message-from] button:not([aria-expanded])");
		if (link instanceof HTMLElement) fireEvent.click(link);
		const linked =
		{
			...senderState(other),
			link: link?.className,
		};
		cleanup();
		const host = renderWith(
			{
				sessionId: "S1",
				title: "Fix login",
			},
			CROSS_SESSION_ORIGIN,
		);
		const plain =
		{
			...senderState(host),
			link: host.querySelector("[data-peer-message-from] button:not([aria-expanded])")?.className,
		};

		expect(
			{
				linked,
				plain,
				opened: openSession.mock.calls,
				lookups: lookups.slice(0, 1),
			},
		).toStrictEqual(
			{
				linked:
				{
					verb: "Received message from",
					subject: "Fix login",
					from: null,
					body: "Reminder fired: oxfmt-next-line 0.75.0 is 24h old.\nAll **47** projects pin 0.75.0.",
					bubbles: 0,
					link: "cds-reset text-link-inherit min-w-0 truncate text-primary",
				},
				plain:
				{
					verb: "Received message from",
					subject: "Fix login",
					from: null,
					body: "Reminder fired: oxfmt-next-line 0.75.0 is 24h old.\nAll **47** projects pin 0.75.0.",
					bubbles: 0,
					link: undefined,
				},
				opened: [["S2"]],
				lookups: [["uds:/tmp/cc-socks/45145.sock", "2026-09-18T16:47:16.203Z"]],
			},
		);
	});

	it("folds a cross-session line between two tool calls into the run", () =>
	{
		const toolUse = (id: string, uuid: string) => (
		{
			type: "assistant",
			uuid,
			timestamp: "2026-09-18T16:47:00.000Z",
			message:
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id,
						name: "Bash",
						input:
						{
							command: "ls",
						},
					},
				],
			},
		});
		const toolResult = (id: string, uuid: string) => (
		{
			type: "user",
			uuid,
			timestamp: "2026-09-18T16:47:01.000Z",
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: "ok",
					},
				],
			},
		});
		const container = renderLines([
			toolUse("t1", "a1"),
			toolResult("t1", "r1"),
			metaUserRecord(CROSS_SESSION_PROMPT, CROSS_SESSION_ORIGIN, "peer-1"),
			toolUse("t2", "a2"),
			toolResult("t2", "r2"),
		]);
		const status = container.querySelector("[data-turn-status] > button");
		const label = status?.querySelector("span:first-child")?.textContent;
		if (status instanceof HTMLElement) fireEvent.click(status);

		expect(
			{
				label,
				rows: [...container.querySelectorAll("[data-peer-message-from]")].map((row) => row.textContent),
				inRun: container.querySelector("[data-peer-message-from]")?.closest("[data-turn-status]") !== null,
			},
		).toStrictEqual(
			{
				label: "Ran 2 commands, received a message",
				rows: ["Received message fromworkflowy-5c"],
				inRun: true,
			},
		);
	});
});
