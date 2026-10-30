import {Check, CheckCheck, Copy, Loader2, Pause, Pin, RotateCcw, Split, Volume2, X} from "lucide-react";
import {
	createContext,
	type FocusEvent,
	type MouseEvent,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

import {useChapters} from "../lib/chapter-store";
import {writeClipboardText} from "../lib/clipboard";
import {messageHeading} from "../lib/transcript-action-targets";
import {type ReadAloudStatus, useReadAloud} from "../hooks/use-read-aloud";
import {TOUCH_REVEAL} from "../lib/touch-reveal";
import {useRovingToolbar} from "../lib/use-roving-toolbar";
import {formatMessageTime, formatRelativeTimestamp, formatTimestamp} from "../lib/timestamp-format";
import {type TranscriptMessageRef, TranscriptActionsContext} from "./transcript-actions-context";
import {DisabledReason} from "./ui/disabled-reason";
import {InfoTip} from "./ui/info-tip";
import {Spinner} from "./ui/spinner";
import {Tooltip} from "./ui/tooltip";

/*
 * claude.ai/code's hover toolbars under a transcript turn. Assistant turns get
 * [Copy][Fork from here][Pin as chapter][Read aloud] then the time, left-aligned;
 * user turns get the time then [Copy][Rewind to here][Fork from here],
 * right-aligned. Fork, Pin and Rewind share their handlers with the right-click
 * menu through TranscriptActionsContext, and stay disabled without one. Per-turn
 * stats and origin captions live in the time's tooltip, never inline.
 *
 * The bar fades in on hover or focus-within. It is upstream's roving toolbar: one
 * tab stop (Copy, then the last focused item) that stays in the tab order while
 * the bar is hidden, as upstream's opacity-only hiding does. A per-turn sr-only
 * "Show message actions" button (empty, labelled by aria-label) reveals the bar
 * as soon as it gets focus, as upstream's does, and moves focus to the bar's tab
 * stop; the bar hides again once focus leaves.
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
	/** The CLI took this prompt into a turn, so the user row shows upstream's "Read by Claude" receipt. */
	readByClaude?: boolean;
	/** Reads the turn's rendered prose as HTML for Copy's text/html flavour; absent or undefined copies text only. */
	getHtml?: (() => string | undefined) | undefined;
}

const BAR_CLASS = [
	"flex h-6 items-center gap-0 select-none comfortable:h-8",
	// Upstream's toolbar turns a hovered button's icon primary, except a pressed one, which keeps its accent ink.
	"[&_button:hover:not([aria-pressed=true]):not(:disabled)]:text-primary",
	"opacity-0 pointer-events-none",
	"group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto",
	"focus-within:opacity-100 focus-within:pointer-events-auto",
	"data-revealed:opacity-100 data-revealed:pointer-events-auto",
	"data-hovered:opacity-100 data-hovered:pointer-events-auto",
	// An open popover inside the bar (the read receipt's) keeps it shown, as upstream's :has([data-popup-open]) rule does.
	"has-[[data-popup-open]]:opacity-100 has-[[data-popup-open]]:pointer-events-auto",
	// Upstream reveals by opacity only (no scale): out in 60ms with no delay, hover in over 120ms after
	// 100ms (hover-capable devices only; Tailwind's group-hover is already hover:hover-gated), focus in at once.
	"motion-safe:transition-opacity motion-safe:duration-[60ms] motion-safe:ease-[cubic-bezier(.32,.72,0,1)]",
	"motion-safe:group-hover/msg:duration-[120ms] motion-safe:group-hover/msg:delay-100",
	"motion-safe:[@media(hover:hover)]:data-hovered:duration-[120ms] motion-safe:[@media(hover:hover)]:data-hovered:delay-100",
	"motion-safe:focus-within:duration-[120ms] motion-safe:focus-within:delay-0",
	"motion-safe:data-revealed:duration-[120ms] motion-safe:data-revealed:delay-0",
	"motion-safe:has-[[data-popup-open]]:duration-[120ms] motion-safe:has-[[data-popup-open]]:delay-0",
	// Touch devices never hover, so the bar is always shown there, as upstream's data-reveal rule does.
	TOUCH_REVEAL,
	"motion-safe:pointer-coarse:transition-none",
].join(" ");

const BUTTON_CLASS =
	"flex size-6 cursor-pointer items-center justify-center rounded-r5 text-ink-muted outline-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus transition-colors hover:bg-fill-ghost-hover aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-muted comfortable:size-8 comfortable:rounded-r6";

const ICON_CLASS = "size-4 comfortable:size-5";

const COPIED_MS = 2000;

const NOTHING_TO_COPY = "This message has no text to copy.";

/**
 * Inside a roving bar: items render the tab index the roving hook would elect at rest (the first item 0, the rest
 * -1), so the hook has nothing to rewrite after mount. Outside one (the waiting row) they keep the native tab order.
 */
const RovingBarContext = createContext(false);

function useRovingTabIndex(first: boolean): number | undefined {
	if (!useContext(RovingBarContext)) return undefined;
	return first ? 0 : -1;
}

function preventFocusSteal(event: MouseEvent) {
	event.preventDefault();
}

function ActionButton({
	label,
	description,
	onClick,
	pressed,
	readAloud,
	disabledReason,
	first = false,
	children,
}: {
	label: string;
	/** The bar's first item, its tab stop at rest. */
	first?: boolean;
	/**
	 * Mounts upstream's disabled-reason span around the control; while it holds a reason the control is disabled
	 * and the span, focusable and described by the reason, shows it in place of the label's tooltip.
	 */
	disabledReason?: string | null;
	/** A muted second line under the label in the tooltip, as upstream's toolbar shows for Rewind and Fork. */
	description?: string;
	onClick: (() => void) | undefined;
	pressed?: boolean;
	/** Marks the Read aloud control, whose label changes with its state. */
	readAloud?: boolean;
	children: ReactNode;
}) {
	const tabIndex = useRovingTabIndex(first);
	const blocked = disabledReason !== undefined && disabledReason !== null;
	const control = (
		<Tooltip content={label} description={description} openWhen={() => !blocked}>
			<button
				type="button"
				aria-label={label}
				// Upstream's aria-description is the tooltip detail, or the reason while disabled.
				{...(description === undefined ? {} : {"aria-description": blocked ? disabledReason : description})}
				{...(pressed === undefined ? {} : {"aria-pressed": pressed})}
				{...(readAloud ? {"data-read-aloud": ""} : {})}
				{...(tabIndex === undefined ? {} : {tabIndex})}
				disabled={onClick === undefined || blocked}
				// Pressing keeps focus where it was (the composer), as upstream's toolbar buttons do.
				onMouseDown={preventFocusSteal}
				onClick={blocked ? undefined : onClick}
				className={BUTTON_CLASS}
			>
				{children}
			</button>
		</Tooltip>
	);
	if (disabledReason === undefined) return control;
	return (
		// A roving bar's first item may be the disabled-reason wrapper (Copy on a turn with no text), which the
		// roving hook then elects as the tab stop; render that index up front so the hook has nothing to rewrite.
		<DisabledReason reason={disabledReason} tabIndex={tabIndex === 0 ? 0 : -1}>
			{control}
		</DisabledReason>
	);
}

/**
 * Upstream's Copy: writes the trimmed text (plus the turn's rendered HTML when `getHtml` reads it), swaps to a
 * check for 2000ms, and is disabled with a reason when the turn has no text.
 */
function CopyAction({
	text,
	getHtml,
	first = false,
}: {
	text: string;
	getHtml?: (() => string | undefined) | undefined;
	first?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);
	const trimmed = text.trim();
	const empty = trimmed === "";

	return (
		<>
			<ActionButton
				label={empty ? `Copy: ${NOTHING_TO_COPY}` : "Copy"}
				first={first}
				{...(empty ? {disabledReason: NOTHING_TO_COPY} : {})}
				onClick={() => {
					const html = getHtml?.();
					const write = html === undefined ? writeClipboardText(trimmed) : writeClipboardText(trimmed, html);
					void write.then((ok) => {
						if (!ok) return;
						setCopied(true);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => {
							setCopied(false);
						}, COPIED_MS);
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
	return () => {
		action(message);
	};
}

function ForkAction({message}: {message: TranscriptMessageRef | undefined}) {
	const {forkFrom, forkDisabledReason} = useContext(TranscriptActionsContext);
	return (
		<ActionButton
			label="Fork from here"
			description="Starts a new session from this point. This one stays as it is."
			disabledReason={forkDisabledReason ?? null}
			onClick={bound(forkFrom, message)}
		>
			{/* Upstream's ArrowSplitRight: lucide's upward split, turned to point right. */}
			<Split aria-hidden="true" className={`${ICON_CLASS} rotate-90`} />
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
	const {rewindTo, rewindDisabledReason, rewindHidden = false} = useContext(TranscriptActionsContext);
	if (rewindHidden) return null;
	return (
		<ActionButton
			label="Rewind to here"
			description="Removes this message and everything after it."
			disabledReason={rewindDisabledReason ?? null}
			onClick={bound(rewindTo, message)}
		>
			<RotateCcw aria-hidden="true" className={ICON_CLASS} />
		</ActionButton>
	);
}

const READ_ALOUD_LABELS: Record<ReadAloudStatus, string> = {
	idle: "Read aloud",
	loading: "Loading\u2026",
	playing: "Pause",
	paused: "Resume",
};

/**
 * Read aloud with the browser's speech service. Like upstream, a press starts,
 * pauses or resumes, and the label and icon say what the next press does.
 */
function ReadAloudAction({text}: {text: string}) {
	const {status, toggle} = useReadAloud(text);
	return (
		<ActionButton label={READ_ALOUD_LABELS[status]} onClick={toggle} readAloud>
			{status === "loading" ? (
				<Loader2 aria-hidden="true" data-icon="spinner" className={`${ICON_CLASS} animate-spin`} />
			) : status === "playing" ? (
				<Pause aria-hidden="true" data-icon="pause" className={ICON_CLASS} />
			) : (
				<Volume2 aria-hidden="true" data-icon="speaker" className={ICON_CLASS} />
			)}
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
	// Upstream's user <time> turns absolute after a week; the assistant's stays relative.
	const relative = inner === "right" ? formatMessageTime(timestamp) : formatRelativeTimestamp(timestamp);
	if (timestamp === undefined || relative === null) return null;
	const absolute = formatTimestamp(timestamp);
	const tooltip = [absolute ?? timestamp, ...details].join("\n");
	return (
		<Tooltip content={tooltip} multiline>
			<time
				dateTime={timestamp}
				className={
					inner === "left"
						? "flex h-6 items-center ps-2 text-[13px]/[19px] text-ink-muted tabular-nums outline-none comfortable:h-8 comfortable:ps-3 comfortable:text-[14px]/[20px]"
						: "flex h-6 items-center pe-[6px] text-[11px]/[17px] text-ink-muted tabular-nums outline-none comfortable:h-8"
				}
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
	testId,
}: {
	className: string;
	children: ReactNode;
	label: string;
	hovered?: boolean | undefined;
	/** Upstream tags only the assistant bar `data-testid="message-actions"`. */
	testId?: string;
}) {
	const [revealed, setRevealed] = useState(false);
	const {ref: barRef, onFocus, onKeyDown} = useRovingToolbar();
	const barElement = useRef<HTMLDivElement | null>(null);
	const [revealRequest, setRevealRequest] = useState(0);

	// Upstream focuses the roving tab stop, else the first enabled button.
	useEffect(() => {
		if (revealRequest === 0) return;
		const element = barElement.current;
		const target =
			element?.querySelector<HTMLElement>('[tabindex="0"]:not([data-base-ui-focus-guard])') ??
			element?.querySelector<HTMLElement>("button:not(:disabled)");
		target?.focus();
	}, [revealRequest]);

	function reveal() {
		setRevealed(true);
		setRevealRequest((count) => count + 1);
	}

	function hideWhenFocusLeaves(event: FocusEvent<HTMLDivElement>) {
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget.contains(next)) return;
		setRevealed(false);
	}

	return (
		<>
			<button type="button" className="sr-only" aria-label={label} onFocus={reveal} onClick={reveal} />
			<div
				ref={(element) => {
					barElement.current = element;
					barRef(element);
				}}
				data-message-actions
				data-cds="MessageActions"
				data-reveal="fade"
				role="toolbar"
				aria-label="Message actions"
				tabIndex={-1}
				{...(testId === undefined ? {} : {"data-testid": testId})}
				data-hovered={hovered ? "" : undefined}
				{...(revealed ? {"data-revealed": ""} : {})}
				className={className}
				onBlur={hideWhenFocusLeaves}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
			>
				<RovingBarContext.Provider value>{children}</RovingBarContext.Provider>
			</div>
		</>
	);
}

export function AssistantMessageActions({message, text, timestamp, details, hovered, getHtml}: MessageActionsProps) {
	return (
		<ActionBar
			// Upstream sets the toolbar 6px (its column's gap-xs) under the last prose block, its left edge 2px left of the text.
			className={`${BAR_CLASS} mt-[6px] -ms-[2px]`}
			label={`Show message actions for ${messageHeading("assistant", text)}`}
			hovered={hovered}
			testId="message-actions"
		>
			<CopyAction text={text} getHtml={getHtml} first />
			<ForkAction message={message} />
			<PinAction message={message} />
			<ReadAloudAction text={text} />
			<MessageTime timestamp={timestamp} details={details} inner="left" />
		</ActionBar>
	);
}

/** Upstream's "Read by Claude" CheckDouble InfoTip; the toolbar's hover rule turns it primary. */
function ReadByClaudeReceipt() {
	const tabIndex = useRovingTabIndex(true);
	return (
		<InfoTip
			aria-label="Read by Claude"
			content="Read by Claude"
			delay={0}
			icon={<CheckCheck aria-hidden className={ICON_CLASS} />}
			className="hover:text-primary"
			{...(tabIndex === undefined ? {} : {tabIndex})}
		/>
	);
}

export function UserMessageActions({
	message,
	text,
	contextText = text,
	timestamp,
	details,
	readByClaude = false,
}: MessageActionsProps) {
	return (
		<ActionBar
			className={`${BAR_CLASS} justify-end self-end`}
			label={`Show message actions for ${messageHeading("user", contextText)}`}
		>
			<MessageTime timestamp={timestamp} details={details} inner="right" />
			{readByClaude && <ReadByClaudeReceipt />}
			<CopyAction text={text} first={!readByClaude} />
			<RewindAction message={message} />
			<ForkAction message={message} />
		</ActionBar>
	);
}

const REVEAL_ON_HOVER_CLASS = [
	"flex items-center",
	"opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100",
	"pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100",
	"motion-safe:transition-opacity motion-safe:duration-[120ms] motion-safe:delay-100 motion-safe:ease-[cubic-bezier(.32,.72,0,1)]",
].join(" ");

/**
 * Upstream's X on a waiting row the browser still holds: busy ("Removing…") until the take-back
 * settles. The mouse-down keeps focus where it is, so the composer can take it.
 */
function CancelEditAction({onCancel}: {onCancel: () => Promise<void> | void}) {
	const [removing, setRemoving] = useState(false);
	return (
		<span className="epitaxy-hint-fade-in flex items-center gap-[3px]">
			<Tooltip content="Cancel and edit message">
				<button
					type="button"
					aria-label="Cancel and edit message"
					aria-busy={removing ? true : undefined}
					aria-disabled={removing ? true : undefined}
					className={`relative ${BUTTON_CLASS} hover:text-primary`}
					onMouseDown={(event) => {
						event.preventDefault();
					}}
					onClick={() => {
						if (removing) return;
						setRemoving(true);
						void Promise.resolve(onCancel()).finally(() => {
							setRemoving(false);
						});
					}}
				>
					{removing ? (
						<>
							<Spinner size="sm" />
							<span className="sr-only">Removing…</span>
						</>
					) : (
						<X aria-hidden="true" className={ICON_CLASS} />
					)}
				</button>
			</Tooltip>
		</span>
	);
}

/**
 * Upstream's always-visible toolbar under a waiting user row. Copy and a disabled Rewind fade in on
 * hover; `children` (Send now on the head row) sit outside that group, so they show at rest.
 */
export function WaitingMessageActions({
	text,
	unread = false,
	onCancel,
	children,
}: {
	text: string;
	/** A stacked (not head) waiting row leads with upstream's at-rest "Unread" receipt. */
	unread?: boolean;
	/** Takes a browser-held steer back into the composer; absent once the CLI owns the text. */
	onCancel?: (() => Promise<void> | void) | undefined;
	children?: ReactNode;
}) {
	return (
		<div
			data-message-actions
			data-always-visible
			role="toolbar"
			aria-label="Message actions"
			className="flex items-center select-none"
		>
			{unread && (
				<span
					data-testid="epitaxy-receipt-at-rest"
					className="text-body text-ink-muted tabular-nums flex min-h-6 items-center self-center ps-[5px] epitaxy-hint-fade-in"
				>
					<InfoTip
						aria-label="Unread"
						content="Unread"
						delay={0}
						icon={<Check aria-hidden className={ICON_CLASS} />}
						className="opacity-50 hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
						tabIndex={0}
					/>
				</span>
			)}
			<div data-reveal-on-hover className={REVEAL_ON_HOVER_CLASS}>
				<CopyAction text={text} />
				<RewindAction message={undefined} />
				{onCancel !== undefined && <CancelEditAction onCancel={onCancel} />}
			</div>
			{children}
		</div>
	);
}
