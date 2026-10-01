/** A message one agent in this session sent another, such as a subagent's hand-back report. */
export interface AgentMessage {
	/** The sender's bare agent id. */
	from: string;
	/** The message body as markdown, without the hand-back frame or the harness indent. */
	body: string;
}

const AGENT_MESSAGE_RE = /<agent-message from="([^"]*)">\n?([\s\S]*?)\n?<\/agent-message>/;
const HANDBACK_FRAME_RE = /^\[Subagent hand-back\][^\n]*\n?/;
const HARNESS_INDENT = "  ";

/**
 * Parse an `<agent-message from="…">` envelope, wherever it sits in a prompt.
 * Hand-backs drop their `[Subagent hand-back]` frame line and the two-space
 * indent the harness puts on every report line.
 */
export function parseAgentMessage(text: string): AgentMessage | null {
	const match = AGENT_MESSAGE_RE.exec(text);
	if (match === null) return null;
	const from = match[1]!;
	const raw = match[2]!;
	if (!HANDBACK_FRAME_RE.test(raw)) return {from, body: raw.trim()};
	const body = raw
		.replace(HANDBACK_FRAME_RE, "")
		.split("\n")
		.map((line) => (line.startsWith(HARNESS_INDENT) ? line.slice(HARNESS_INDENT.length) : line).trimEnd())
		.join("\n")
		.trim();
	return {from, body};
}
