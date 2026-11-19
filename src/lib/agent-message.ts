import {isRecord} from "./narrow";
import {decodeXmlEntities} from "./xml-entities";

/**
 * The facts upstream's `Ks` (c1128a44c) reads from a peer record's `origin`: the CLI stamps a
 * delivered peer message `{kind: "peer", from, name?, senderTaskId?, handback?, …}`.
 */
export interface PeerOrigin
{
	name?: string | undefined;
	senderTaskId?: string | undefined;
	handback?: boolean | undefined;
}

/**
 * A message another Claude session, teammate or subagent sent this session, as upstream's peer
 * item origin (c1128a44c `Ds` merged with `Ks`).
 */
export interface PeerMessage
{
	kind: "peer" | "teammate";
	/** The sender: a socket address, an agent id, or a teammate id. */
	from: string;
	/** The sender's display name: the record's stamped name, else the envelope's. */
	name?: string;
	/** The record stamped a non-empty name (upstream `stamped`). */
	stamped: boolean;
	/** The record's `senderTaskId` is an agent id (upstream `subagent`). */
	subagent: boolean;
	/** A `[Subagent hand-back]` report. */
	handback: boolean;
	/** Text the subagent wrote above the hand-back frame, shown as a warning line. */
	handbackNote?: string;
	deliveredWhile?: "idle" | "working";
	/**
	 * A cross-session body that relays one of the sender's agents' messages (upstream `relayedAgent`): named when
	 * the agent has a clean name, empty for an anonymous subagent id.
	 */
	relayedAgent?: RelayedAgent;
	/** The message text, without the envelope, preamble, footer or hand-back frame. */
	body: string;
}

export interface RelayedAgent
{
	name?: string;
}

/** The record origin of a delivered peer message, or undefined for any other origin. */
export function peerOriginOf(origin: unknown): PeerOrigin | undefined
{
	if (!isRecord(origin) || origin["kind"] !== "peer") return undefined;
	const {name, senderTaskId, handback} = origin;
	return {
		...(typeof name === "string" &&
		{
			name,
		}),
		...(typeof senderTaskId === "string" &&
		{
			senderTaskId,
		}),
		...(handback === true &&
		{
			handback,
		}),
	};
}

/** Upstream `po`: the CLI's lead-in lines and when each says the message arrived. */
const PREAMBLES: readonly (readonly [string, "idle" | "working"])[] = [
	["Another Claude session sent a message while you were working:\n", "working"],
	["Another Claude session sent a message:\n", "idle"],
	["A peer session sent a message while you were working:\n", "working"],
];

/** The opening words of each CLI safety footer (upstream `yo`/`xo`). */
const FOOTER_STARTS = [
	"This came from another Claude session",
	'That "other Claude session" is an agent',
	"IMPORTANT: This is NOT from your user",
	"This is from another Claude session",
];

const FOOTER_SPLIT = /^([\s\S]*<\/(?:agent-message|cross-session-message|teammate-message)>)\n\n([\s\S]*)$/;
/** Upstream `fo`: exactly one element, nothing around it. */
const ELEMENT = /^\s*<(agent-message|cross-session-message|teammate-message)(?=[\s/>])([^>]*)>([\s\S]*?)<\/\1>\s*$/;
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;
/** Upstream `So`/`Co`: a subagent's task id. */
const AGENT_ID = /^a(?:[\w-]{1,63}-)?[0-9a-f]{16}$/;
const HANDBACK_FRAME = /^\[Subagent hand-back\][^\n]*$/m;
const HARNESS_INDENT = "  ";
/** Upstream `ws`: a backslash-escaped agent-message envelope, the whole of a cross-session body. */
const RELAYED_AGENT_MESSAGE = /^<\\(~?)agent-message from="([^"<>\n]*)">\n([\s\S]*)\n<\\\1\/agent-message>$/;
/** Upstream `Es`: an anonymous subagent's id. */
const RELAYED_SUBAGENT_ID = /^a[0-9a-f]{16}$/;
/** Names that are ids rather than names (upstream `K` drops these). */
const ID_LIKE_NAME =
	/^(?:a(?:[\w-]{1,63}-)?[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|uds:.*)$/i;
/** An envelope still inside the relayed text, escaped (`~` stands for a nested backslash) or not. */
const NESTED_ENVELOPE = /<\\?\/?(?:agent-message|cross-session-message|teammate-message)[\s>]/;

function attributes(raw: string): Map<string, string>
{
	return new Map([...raw.matchAll(ATTRIBUTE)].map(([, key = "", value = ""]) => [key, value]));
}

/** Upstream `De`: drop the harness's two-space indent from every line. */
function dedent(text: string): string
{
	return text
		.split("\n")
		.map((line) => (line.startsWith(HARNESS_INDENT) ? line.slice(HARNESS_INDENT.length) : line).trimEnd())
		.join("\n")
		.trim();
}

/** Upstream `To`: split a hand-back into the note above its frame and the dedented report below. */
function splitHandback(inner: string):
{
	note?: string;
	report: string;
} | null
{
	const frame = HANDBACK_FRAME.exec(inner);
	if (frame === null) return null;
	const note = dedent(inner.slice(0, frame.index));
	return {
		...(note !== "" &&
		{
			note,
		}),
		report: dedent(inner.slice(frame.index + frame[0].length)),
	};
}

/** Upstream `K`: a displayable sender name, or undefined for an empty or id-like one. */
export function displayName(name: string | undefined): string | undefined
{
	const trimmed = name?.trim();
	return trimmed === undefined || trimmed === "" || ID_LIKE_NAME.test(trimmed) ? undefined : trimmed;
}

/**
 * Upstream `Ds`/`Os`: a cross-session body that is exactly one escaped `<\\agent-message from="X">` envelope
 * relays that agent's message. Only a peer record's plain (not encoded) body counts.
 */
function relayedAgentOf(body: string):
{
	agent: RelayedAgent;
	content: string;
} | null
{
	const [, , from, inner] = RELAYED_AGENT_MESSAGE.exec(body) ?? [];
	if (from === undefined || inner === undefined || NESTED_ENVELOPE.test(inner.replaceAll("~", "\\"))) return null;
	const content = inner.trim();
	if (RELAYED_SUBAGENT_ID.test(from))
		return {
			agent: {},
			content,
		};
	return displayName(from) === from
		?
			{
				agent:
				{
					name: from,
				},
				content,
			}
		: null;
}

/** Upstream `Io`: a peer record's text without its lead-in line and safety footer. */
function stripPeerFrame(text: string):
{
	text: string;
	deliveredWhile?: "idle" | "working";
}
{
	const preamble = PREAMBLES.find(([lead]) => text.startsWith(lead));
	const rest = preamble === undefined ? text : text.slice(preamble[0].length);
	const footer = FOOTER_SPLIT.exec(rest);
	const stripped =
		footer?.[1] !== undefined && FOOTER_STARTS.some((start) => footer[2]?.startsWith(start) === true)
			? footer[1]
			: rest;
	return {
		text: stripped,
		...(preamble !== undefined &&
		{
			deliveredWhile: preamble[1],
		}),
	};
}

/**
 * Parse a delivered peer message (upstream c1128a44c `Io` → `Es`/`Ds` → `Ks`/`To`). Only a peer
 * record's lead-in line and footer are stripped; what remains must be exactly one
 * `<cross-session-message>`, `<teammate-message>` or `<agent-message>` element.
 */
export function parsePeerMessage(text: string, origin: PeerOrigin | undefined): PeerMessage | null
{
	const framed =
		origin === undefined
			?
				{
					text,
				}
			: stripPeerFrame(text);
	const [, tag, rawAttributes = "", inner = ""] = ELEMENT.exec(framed.text) ?? [];
	if (tag === undefined || inner.includes(`<${tag}`)) return null;
	const attrs = attributes(rawAttributes);
	const subagent = origin?.senderTaskId !== undefined && AGENT_ID.test(origin.senderTaskId);
	const stampedName = origin?.name !== undefined && origin.name !== "" ? origin.name : undefined;
	const shared =
	{
		stamped: stampedName !== undefined,
		subagent,
		...(framed.deliveredWhile !== undefined &&
		{
			deliveredWhile: framed.deliveredWhile,
		}),
	};
	const named = (name: string | undefined) =>
		name === undefined || name === ""
			? {}
			:
				{
					name,
				};
	const trimmed = inner.trim();
	if (tag === "teammate-message")
		return {
			kind: "teammate",
			from: attrs.get("teammate_id") ?? "unknown",
			...named(stampedName),
			handback: false,
			...shared,
			body: trimmed,
		};
	if (tag === "cross-session-message")
	{
		const encoded = attrs.get("encoded") === "1";
		const relayed = origin === undefined || encoded ? null : relayedAgentOf(trimmed);
		return {
			kind: "peer",
			from: attrs.get("from") ?? "unknown",
			...named(stampedName ?? [attrs.get("from-name"), attrs.get("name")].find((name) => name !== "")),
			handback: false,
			...shared,
			...(relayed !== null &&
			{
				relayedAgent: relayed.agent,
			}),
			body: relayed?.content ?? (encoded ? decodeXmlEntities(trimmed) : trimmed),
		};
	}
	const handback =
		subagent && origin.handback === true && inner.startsWith("\n") && inner.endsWith("\n")
			? splitHandback(inner.slice(1, -1))
			: null;
	return {
		kind: "peer",
		from: attrs.get("from") ?? "unknown",
		...named(stampedName ?? attrs.get("name")),
		...shared,
		handback: handback !== null,
		...(handback?.note !== undefined &&
		{
			handbackNote: handback.note,
		}),
		body: handback?.report ?? (subagent ? dedent(inner) : trimmed),
	};
}
