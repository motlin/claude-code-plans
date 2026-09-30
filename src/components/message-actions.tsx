import {Check, Copy, GitFork, Pin, RotateCcw, Volume2} from "lucide-react";
import {type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore} from "react";

import {useChapters} from "../lib/chapter-store";
import {writeClipboardText} from "../lib/clipboard";
import {markdownToPlainText} from "../lib/markdown-plain-text";
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
 */

export interface MessageActionsProps {
	/** The message the actions act on; absent for records without a uuid. */
	message: TranscriptMessageRef | undefined;
	/** The message's text as written, which Copy copies. */
	text: string;
	timestamp?: string | undefined;
	/** Extra tooltip lines after the absolute time: token usage, effort, origin and the like. */
	details: readonly string[];
}

const BAR_CLASS =
	"flex items-center gap-g1 pt-[4px] select-none opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150";

const BUTTON_CLASS =
	"flex size-6 cursor-pointer items-center justify-center rounded-r5 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

const ICON_CLASS = "size-3.5";

const COPIED_MS = 1500;

function ActionButton({
	label,
	onClick,
	pressed,
	children,
}: {
	label: string;
	onClick: (() => void) | undefined;
	pressed?: boolean;
	children: ReactNode;
}) {
	return (
		<Tooltip content={label}>
			<button
				type="button"
				aria-label={label}
				{...(pressed === undefined ? {} : {"aria-pressed": pressed})}
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
		<ActionButton label="Fork from here" onClick={bound(forkFrom, message)}>
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
		<ActionButton label="Rewind to here" onClick={bound(rewindTo, message)}>
			<RotateCcw aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

function subscribeNever(): () => void {
	return () => {};
}

function hasSpeechSynthesis(): boolean {
	return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Read aloud with the browser's `speechSynthesis`; pressing again stops. */
function ReadAloudAction({text}: {text: string}) {
	const supported = useSyncExternalStore(subscribeNever, hasSpeechSynthesis, () => false);
	const [speaking, setSpeaking] = useState(false);
	const speakingRef = useRef(false);

	useEffect(
		() => () => {
			if (speakingRef.current) speechSynthesis.cancel();
		},
		[],
	);

	const settle = (value: boolean) => {
		speakingRef.current = value;
		setSpeaking(value);
	};

	const toggle = () => {
		speechSynthesis.cancel();
		if (speaking) {
			settle(false);
			return;
		}
		const utterance = new SpeechSynthesisUtterance(markdownToPlainText(text));
		utterance.onend = () => settle(false);
		utterance.onerror = () => settle(false);
		speechSynthesis.speak(utterance);
		settle(true);
	};

	return (
		<ActionButton label="Read aloud" pressed={speaking} onClick={supported && text !== "" ? toggle : undefined}>
			<Volume2 aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

/** The relative time, with the absolute time and the turn's details in its tooltip. */
function MessageTime({timestamp, details}: {timestamp: string | undefined; details: readonly string[]}) {
	const relative = formatRelativeTimestamp(timestamp);
	if (timestamp === undefined || relative === null) return null;
	const absolute = formatTimestamp(timestamp);
	const tooltip = [absolute ?? timestamp, ...details].join("\n");
	return (
		<Tooltip content={tooltip} multiline>
			<time
				dateTime={timestamp}
				tabIndex={0}
				className="px-1 text-[12px] text-ink-muted tabular-nums outline-none"
			>
				{relative}
			</time>
		</Tooltip>
	);
}

export function AssistantMessageActions({message, text, timestamp, details}: MessageActionsProps) {
	return (
		<div data-message-actions className={BAR_CLASS}>
			<CopyAction text={text} />
			<ForkAction message={message} />
			<PinAction message={message} />
			<ReadAloudAction text={text} />
			<MessageTime timestamp={timestamp} details={details} />
		</div>
	);
}

export function UserMessageActions({message, text, timestamp, details}: MessageActionsProps) {
	return (
		<div data-message-actions className={`${BAR_CLASS} justify-end self-end`}>
			<MessageTime timestamp={timestamp} details={details} />
			<CopyAction text={text} />
			<RewindAction message={message} />
			<ForkAction message={message} />
		</div>
	);
}
