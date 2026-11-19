/*
 * Upstream's peer message row (c8a556f2c `en` = `Gt` header + `$t` body, laid out by `Pt`): a muted
 * "Received message from" / "Message from" verb, the sender, and a 20x20 chevron toggle that alone
 * opens the body. The body is plain pre-wrap text with inline code (no markdown), clamped past 1200
 * characters behind Show more. Its fallback (c01e7498d `AE`) is the bordered card for an envelope
 * the parser could not read.
 */
import {useContext, useState} from "react";

import {displayName, type PeerMessage, type RelayedAgent} from "../lib/agent-message";
import {type PeerSender, type PeerSenders, PeerSendersContext} from "./peer-senders-context";
import {TranscriptModeContext} from "./transcript-mode-context";
import {Icon} from "./ui/icon";
import {UserInlineText} from "./user-plain-text";

/** Upstream `K`: a peer body line. */
const PEER_LINE_CLASS = "text-body whitespace-pre-wrap [overflow-wrap:anywhere] select-text";
/** Upstream `Kt`: the peer content paragraph. */
const PEER_CONTENT_CLASS = `${PEER_LINE_CLASS} text-primary [unicode-bidi:plaintext]`;
/** Upstream `it` (c8a6d9da5 `z`): content longer than this clamps behind Show more. */
const PEER_CLAMP_CHARS = 1200;
const PEER_CLAMP_CLASS =
	"max-h-[16rem] overflow-clip [mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]";
/** Upstream's status-row label ink (c425fb3cf `Z`). */
const MUTED_LABEL_CLASS =
	"text-muted-as-secondary group-hover/tool:text-secondary group-focus-visible/tool:text-secondary group-has-[:focus-visible]/tool:text-secondary";
/** Upstream cds Button `variant="ghost" size="xxs"`. */
const GHOST_XXS_CLASS =
	"relative inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-r4 whitespace-nowrap select-none px-1.5 font-control-regular text-footnote text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus self-start";

/** Upstream `Bt`: names that would read as one of the row's own placeholder subjects. */
const PLACEHOLDER_SUBJECTS = new Set(["teamlead", "teammate", "subagent", "anothersession"]);
function normalizedName(name: string): string
{
	return name
		.normalize("NFKC")
		.toLocaleLowerCase()
		.trim()
		.replace(/^(the|an|a)\s+/u, "")
		.replaceAll(/[^\p{L}\p{N}]+/gu, "");
}

/** Upstream `ns`: a subagent's message. */
function fromSubagent(message: PeerMessage): boolean
{
	return message.subagent || message.handback;
}

/** Upstream `sp`: the row's verb and subject; a known sender session's title replaces the stamped name. */
function peerRowCopy(
	message: PeerMessage,
	title: string | undefined,
):
{
	verb: string;
	subject: string;
}
{
	const verb = fromSubagent(message) ? "Message from" : "Received message from";
	if (message.kind === "teammate")
		return {
			verb,
			subject: "a teammate",
		};
	if (title !== undefined)
		return {
			verb,
			subject: title,
		};
	// Upstream `es`/`Vt`: only a stamped, non-subagent name heads the row, and never a placeholder word.
	const stamped = message.stamped && !fromSubagent(message) ? displayName(message.name) : undefined;
	const named = stamped !== undefined && !PLACEHOLDER_SUBJECTS.has(normalizedName(stamped)) ? stamped : undefined;
	return {
		verb,
		subject: named ?? (fromSubagent(message) ? "subagent" : "another session"),
	};
}

/** Upstream `ts`: the sender name the From line shows. */
function fromName(message: PeerMessage): string | undefined
{
	if (message.kind === "teammate") return message.from === "unknown" ? undefined : displayName(message.from);
	if (message.name !== undefined) return displayName(message.name);
	return fromSubagent(message) ? displayName(message.from) : undefined;
}

/** Upstream `qt`: the content paragraph, clamped past 1200 characters behind Show more. */
function PeerContent({content}: {content: string})
{
	const [showAll, setShowAll] = useState(false);
	const long = content.length > PEER_CLAMP_CHARS;
	const clamped = long && !showAll;
	return (
		<>
			{clamped && (
				<p className="sr-only" data-find-omitted="">
					{content.split("\n", 1)[0]}
				</p>
			)}
			<p inert={clamped} className={clamped ? `${PEER_CONTENT_CLASS} ${PEER_CLAMP_CLASS}` : PEER_CONTENT_CLASS}>
				<UserInlineText text={content} />
			</p>
			{long && (
				<button
					type="button"
					aria-expanded={showAll}
					data-find-omitted=""
					onMouseDown={(event) =>
					{
						event.preventDefault();
					}}
					onClick={() =>
					{
						setShowAll((was) => !was);
					}}
					className={GHOST_XXS_CLASS}
				>
					{showAll ? "Show less" : "Show more"}
				</button>
			)}
		</>
	);
}

/** Upstream `Dt`: who relayed the message, an anonymous subagent or a named agent. */
function RelayedAgentLine({agent}: {agent: RelayedAgent})
{
	return (
		<p data-find-omitted="" className={`${PEER_LINE_CLASS} text-secondary`}>
			{agent.name === undefined ? (
				"Sent by a subagent"
			) : (
				<>
					Agent: <bdi>{agent.name}</bdi>
				</>
			)}
		</p>
	);
}

/**
 * Upstream `vp`: the sender's session and title. A title that reads as one of the row's placeholder subjects
 * is dropped, like upstream drops one that is not an explicit title.
 */
function usePeerSender(
	message: PeerMessage,
	sentAt: string | undefined,
):
{
	sender: PeerSender | undefined;
	senders: PeerSenders | null;
}
{
	const senders = useContext(PeerSendersContext);
	const found = message.kind === "peer" ? senders?.lookup(message.from, sentAt) : undefined;
	const sender = found !== undefined && !PLACEHOLDER_SUBJECTS.has(normalizedName(found.title)) ? found : undefined;
	return {
		sender,
		senders,
	};
}

/** Upstream `Zt`: a hand-back's note, drawn as a warning. */
function HandbackNote({note}: {note: string})
{
	return (
		<p className={`${PEER_LINE_CLASS} flex items-start gap-1 text-warning`}>
			<span data-find-omitted="" className="flex h-[1lh] shrink-0 items-center">
				<Icon name="Warning" size="sm" alt="Warning" />
			</span>
			<span className="min-w-0">{note}</span>
		</p>
	);
}

/**
 * Upstream's collapsible peer row (c3453114c `bt`): collapsed by default, opened only by its chevron button
 * (the header itself does not toggle), and forced open by Verbose, the transcript's expand-all. A sender
 * session the app knows heads the row by its title, as a link unless it is this session.
 */
export function PeerMessageRow({message, sentAt}: {message: PeerMessage; sentAt?: string | undefined})
{
	const forcedOpen = useContext(TranscriptModeContext) === "verbose";
	const [toggled, setOpen] = useState(false);
	const open = forcedOpen || toggled;
	const {sender, senders} = usePeerSender(message, sentAt);
	const {verb, subject} = peerRowCopy(message, sender?.title);
	const from = fromName(message);
	// Upstream `Tt`: no From line once the sender's title is known.
	const showFrom = from !== undefined && from !== subject && sender === undefined;
	const link = sender !== undefined && senders !== null && sender.sessionId !== senders.hostSessionId;
	const subjectText = (
		<bdi className="[&:where(:root[dir=rtl]_*)]:[direction:inherit] [&:where(:root[dir=rtl]_*)]:[unicode-bidi:plaintext]">
			{subject}
		</bdi>
	);
	return (
		<div
			data-find-omitted=""
			data-peer-message-from={message.from}
			className="flex flex-col w-full ps-[var(--cds-assistant-message-text-inset,0px)]"
		>
			<div className="relative group/tool flex self-start max-w-full items-center py-0 gap-0.75 text-start rounded-sm text-body text-secondary">
				<span className={`shrink-0 whitespace-nowrap ${MUTED_LABEL_CLASS}`}>{verb}</span>
				{link ? (
					<button
						type="button"
						data-cds="TextLink"
						onClick={() =>
						{
							senders.openSession(sender.sessionId);
						}}
						className="cds-reset text-link-inherit min-w-0 truncate text-primary"
					>
						{subjectText}
					</button>
				) : (
					<span className="min-w-0 truncate text-primary">{subjectText}</span>
				)}
				<button
					type="button"
					aria-label={open ? `Hide message from ${subject}` : `Show message from ${subject}`}
					aria-expanded={open}
					onClick={() =>
					{
						if (!forcedOpen) setOpen((was) => !was);
					}}
					className="-m-0.75 flex shrink-0 cursor-pointer rounded-sm p-0.75 focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus"
				>
					<span className={open ? "shrink-0 text-secondary" : `shrink-0 ${MUTED_LABEL_CLASS}`}>
						{/* Upstream's duration-fast is the local duration-[60ms] (ui/collapsible-classes.ts). */}
						<Icon
							name="CaretRight"
							customSize={14}
							rotate={open ? 90 : 0}
							className="transition-transform duration-[60ms] motion-reduce:transition-none"
						/>
					</span>
				</button>
			</div>
			{open && (
				<div className="flow-root">
					<div
						data-find-included=""
						className="pt-p3 comfortable:pt-p5 flex flex-col gap-g5 comfortable:gap-g6"
					>
						{showFrom && (
							<p data-find-omitted="" className={`${PEER_LINE_CLASS} text-secondary`}>
								From: <bdi>{from}</bdi>
							</p>
						)}
						{message.relayedAgent !== undefined && <RelayedAgentLine agent={message.relayedAgent} />}
						{message.handbackNote !== undefined && <HandbackNote note={message.handbackNote} />}
						<PeerContent content={message.body} />
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Upstream's bordered fallback card (c01e7498d `AE`) for a peer envelope the parser could not read:
 * an origin-less teammate line keeps its lead-in and footer as the body.
 */
export function PeerFallbackCard({kind, content}: {kind: "peer" | "teammate"; content: string})
{
	return (
		<div className="flex flex-col gap-1 w-full" data-peer-card="">
			<div className="flex w-full flex-col gap-1 rounded-r6 border border-alpha-2 bg-alpha-1 p-p5 comfortable:p-p6">
				<div data-find-omitted="" className="flex items-center gap-1 text-body text-secondary">
					<Icon name="ChatSimple" size="sm" />
					<span className="truncate">
						{kind === "teammate" ? "Message from a teammate" : "Message from another session"}
					</span>
				</div>
				<PeerContent content={content} />
			</div>
		</div>
	);
}
