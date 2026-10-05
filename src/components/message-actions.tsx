import {Check, Copy, GitFork, Pin, RotateCcw, Volume2} from "lucide-react";
import {createContext, type FocusEvent, type ReactNode, useContext, useEffect, useRef, useState} from "react";

import {useChapters} from "../lib/chapter-store";
import {writeClipboardText} from "../lib/clipboard";
import {messageHeading} from "../lib/transcript-action-targets";
import {useReadAloud} from "../hooks/use-read-aloud";
import {formatRelativeTimestamp, formatTimestamp} from "../lib/timestamp-format";
import {type TranscriptMessageRef, TranscriptActionsContext} from "./transcript-context-menu";
import {Tooltip} from "./ui/tooltip";

/*
 * claude.ai/code's hover toolbars under a transcript turn. Assistant turns get
 * [Copy][Fork from here][Pin as chapter][Read aloud] then the time, left-aligned;
 * user turns get the time then [Copy][Rewind to here][Fork from here],
 * right-aligned. Fork, Pin and Rewind share their handlers with the right-click
 * menu through TranscriptActionsContext, and stay disabled without one. Per-turn
 * stats and origin captions live in the time's tooltip, never inline.
 *
 * The bar fades and scales in on hover or focus-within. While hidden its controls
 * leave the tab order; a per-turn sr-only "Show message actions" button reveals
 * the bar and focuses its first button, and the bar hides again once focus leaves.
 */

export interface MessageActionsProps {
	/** The message the actions act on; absent for records without a uuid. */
	message: TranscriptMessageRef | undefined;
	/** The message's text as written, which Copy copies. */
	text: string;
	/** Context shown by the turn heading when it differs from the authored copy text. */
	contextText?: string;
	timestamp?: string | undefined;
	/** Extra tooltip lines after the absolute time: token usage, effort, origin and the like. */
	details: readonly string[];
	/** Another mounted contribution in this assistant display span owns pointer/focus. */
	hovered?: boolean | undefined;
}

const BAR_CLASS = [
	"flex items-center gap-g1 select-none",
	"opacity-0 scale-[.98] pointer-events-none",
	"group-hover/msg:opacity-100 group-hover/msg:scale-100 group-hover/msg:pointer-events-auto",
	"focus-within:opacity-100 focus-within:scale-100 focus-within:pointer-events-auto",
	"data-revealed:opacity-100 data-revealed:scale-100 data-revealed:pointer-events-auto",
	"data-hovered:opacity-100 data-hovered:scale-100 data-hovered:pointer-events-auto",
	"motion-safe:transition-[opacity,scale] motion-safe:duration-[120ms] motion-safe:delay-100 motion-safe:ease-[cubic-bezier(.32,.72,0,1)]",
].join(" ");

const BUTTON_CLASS =
	"flex size-6 cursor-pointer items-center justify-center rounded-r5 text-ink-muted outline-none focus-visible:bg-fill-ghost-hover transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

const ICON_CLASS = "size-4";

const COPIED_MS = 1500;

/** Whether the bar's controls are in the tab order: only once "Show message actions" revealed it. */
const RevealedContext = createContext(false);

function useTabIndex(): number {
	return useContext(RevealedContext) ? 0 : -1;
}

function ActionButton({
	label,
	description,
	onClick,
	pressed,
	children,
}: {
	label: string;
	/** A muted second line under the label in the tooltip, as upstream's toolbar shows for Rewind and Fork. */
	description?: string;
	onClick: (() => void) | undefined;
	pressed?: boolean;
	children: ReactNode;
}) {
	return (
		<Tooltip content={label} description={description}>
			<button
				type="button"
				aria-label={label}
				{...(pressed === undefined ? {} : {"aria-pressed": pressed})}
				tabIndex={useTabIndex()}
				disabled={onClick === undefined}
				onClick={onClick}
				className={BUTTON_CLASS}
			>
				{children}
			</button>
		</Tooltip>
	);
}

function CopyAction({text}: {text: string}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	return (
		<>
			<ActionButton
				label="Copy"
				onClick={() => {
					void writeClipboardText(text).then((ok) => {
						if (!ok) return;
						setCopied(true);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => setCopied(false), COPIED_MS);
					});
				}}
			>
				{copied ? (
					<Check aria-hidden="true" className={ICON_CLASS} />
				) : (
					<Copy aria-hidden="true" className={ICON_CLASS} />
				)}
			</ActionButton>
			<span role="status" className="sr-only">
				{copied ? "Copied" : ""}
			</span>
		</>
	);
}

/** Bind a transcript action to this message, or leave it unbound (disabled). */
function bound(
	action: ((message: TranscriptMessageRef) => void) | undefined,
	message: TranscriptMessageRef | undefined,
): (() => void) | undefined {
	if (action === undefined || message === undefined) return undefined;
	return () => action(message);
}

function ForkAction({message}: {message: TranscriptMessageRef | undefined}) {
	const {forkFrom} = useContext(TranscriptActionsContext);
	return (
		<ActionButton
			label="Fork from here"
			description="Starts a new session, keeps this one"
			onClick={bound(forkFrom, message)}
		>
			<GitFork aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

function PinAction({message}: {message: TranscriptMessageRef | undefined}) {
	const {pinChapter} = useContext(TranscriptActionsContext);
	const chapters = useChapters(message?.sessionId ?? "");
	const pinned = message !== undefined && chapters.some((chapter) => chapter.uuid === message.uuid);
	return (
		<ActionButton label="Pin as chapter" pressed={pinned} onClick={bound(pinChapter, message)}>
			<Pin aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

function RewindAction({message}: {message: TranscriptMessageRef | undefined}) {
	const {rewindTo} = useContext(TranscriptActionsContext);
	return (
		<ActionButton
			label="Rewind to here"
			description="Removes this message and what follows"
			onClick={bound(rewindTo, message)}
		>
			<RotateCcw aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

/** Read aloud with the browser's speech service; pressing again stops. */
function ReadAloudAction({text}: {text: string}) {
	const {speaking, toggle} = useReadAloud(text);
	return (
		<ActionButton label="Read aloud" pressed={speaking} onClick={toggle}>
			<Volume2 aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

/** The relative time, with the absolute time and the turn's details in its tooltip. */
function MessageTime({
	timestamp,
	details,
	inner,
}: {
	timestamp: string | undefined;
	details: readonly string[];
	/** The side facing the buttons, which gets 8px of padding. */
	inner: "left" | "right";
}) {
	const tabIndex = useTabIndex();
	const relative = formatRelativeTimestamp(timestamp);
	if (timestamp === undefined || relative === null) return null;
	const absolute = formatTimestamp(timestamp);
	const tooltip = [absolute ?? timestamp, ...details].join("\n");
	return (
		<Tooltip content={tooltip} multiline>
			<time
				dateTime={timestamp}
				tabIndex={tabIndex}
				className={`${inner === "left" ? "pl-2" : "pr-2"} text-[13px]/[19px] text-ink-muted tabular-nums outline-none`}
			>
				{relative}
			</time>
		</Tooltip>
	);
}

/** The sr-only reveal button and the bar it reveals. */
function ActionBar({
	className,
	children,
	label,
	hovered,
}: {
	className: string;
	children: ReactNode;
	label: string;
	hovered?: boolean | undefined;
}) {
	const [revealed, setRevealed] = useState(false);
	const barRef = useRef<HTMLDivElement>(null);
	const focusPending = useRef(false);

	useEffect(() => {
		if (!revealed || !focusPending.current) return;
		focusPending.current = false;
		barRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
	}, [revealed]);

	function hideWhenFocusLeaves(event: FocusEvent<HTMLDivElement>) {
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget.contains(next)) return;
		setRevealed(false);
	}

	return (
		<>
			<button
				type="button"
				className="sr-only"
				aria-label={label}
				onClick={() => {
					focusPending.current = true;
					setRevealed(true);
				}}
			>
				Show message actions
			</button>
			<div
				ref={barRef}
				data-message-actions
				data-hovered={hovered ? "" : undefined}
				{...(revealed ? {"data-revealed": ""} : {})}
				className={className}
				onBlur={hideWhenFocusLeaves}
			>
				<RevealedContext.Provider value={revealed}>{children}</RevealedContext.Provider>
			</div>
		</>
	);
}

export function AssistantMessageActions({message, text, timestamp, details, hovered}: MessageActionsProps) {
	return (
		<ActionBar
			className={`${BAR_CLASS} pt-[4px]`}
			label={`Show message actions for ${messageHeading("assistant", text)}`}
			hovered={hovered}
		>
			<CopyAction text={text} />
			<ForkAction message={message} />
			<PinAction message={message} />
			<ReadAloudAction text={text} />
			<MessageTime timestamp={timestamp} details={details} inner="left" />
		</ActionBar>
	);
}

export function UserMessageActions({message, text, contextText = text, timestamp, details}: MessageActionsProps) {
	return (
		<ActionBar
			className={`${BAR_CLASS} justify-end self-end`}
			label={`Show message actions for ${messageHeading("user", contextText)}`}
		>
			<MessageTime timestamp={timestamp} details={details} inner="right" />
			<CopyAction text={text} />
			<RewindAction message={message} />
			<ForkAction message={message} />
		</ActionBar>
	);
}
