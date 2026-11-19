import
{
	type DragEvent,
	type FocusEvent,
	type HTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useRef,
	useState,
} from "react";

import {useApprovalConversationCap} from "../hooks/use-approval-conversation-cap";
import {useOverflows} from "../hooks/use-overflows";
import type {HerdrRefusalFallbackDialog, RefusalFallbackChoice} from "../lib/api/herdr";
import type {ElicitationFocus} from "../lib/herdr/elicitation-keys";
import {ApprovalActionButton} from "./approval-action-button";
import {ApprovalStackGhosts} from "./approval-stack";
import {ExternalTextLink} from "./external-text-link";
import {StatusPulse} from "./status-dot";
import {cdsButtonClass} from "./ui/cds-button";
import {CDS_BUTTON_DISABLED, CDS_ICON_ONLY_DISABLED} from "./ui/cds-button-disabled";
import {DisabledReason} from "./ui/disabled-reason";
import {Icon} from "./ui/icon";

/** Upstream's busyLabel on a held approval card's chosen action. */
export const APPROVAL_SENDING_LABEL = "Sending…";

export const APPROVAL_CARD_TITLE = "flex min-h-6 items-center text-body font-[580]";

/**
 * Upstream's `@container (width <= 420px)` stack: the action row and its allow
 * group (`[data-approval-allow]`), full width. A split button stretches too, its primary segment taking
 * the spare width (`width:100%` and `flex:auto`), through a tooltip anchor when the primary has one.
 */
export const STACK_ACTIONS =
	"@max-[420px]:flex-col @max-[420px]:items-stretch @max-[420px]:[&>div]:flex-col @max-[420px]:[&>div]:items-stretch @max-[420px]:[&_[data-cds=SplitDropdownButton]]:w-full @max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child_button]:flex-auto @max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child>div>:first-child]:flex-auto";

const ROAM_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

function enabledButtons(actions: HTMLElement | null): HTMLButtonElement[]
{
	return actions === null ? [] : [...actions.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
}

function isPrimary(button: HTMLButtonElement): boolean
{
	return button.matches("[data-approval-primary]") || button.querySelector("[data-approval-primary]") !== null;
}

/**
 * Upstream's card root keys (`Sq`): from the root or an action, the arrows roam the enabled
 * action buttons, wrapping and mirrored in RTL. Enter on the root itself focuses the primary
 * (else the last button), and a repeated Enter on an action is swallowed.
 */
function onApprovalRootKeyDown(event: KeyboardEvent<HTMLDivElement>)
{
	const root = event.currentTarget;
	const actions = root.querySelector<HTMLElement>("[data-approval-card-actions]");
	const target = event.target instanceof Element ? event.target : null;
	const fromActions = target !== null && actions?.contains(target) === true;
	if (ROAM_KEYS.has(event.key))
	{
		if (target !== root && !fromActions) return;
		const buttons = enabledButtons(actions);
		if (buttons.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		const rtl = getComputedStyle(root).direction === "rtl";
		const back = event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft");
		const step = back ? -1 : 1;
		const at = buttons.findIndex((button) => button === root.ownerDocument.activeElement);
		const next = at === -1 ? (step === 1 ? 0 : buttons.length - 1) : (at + step + buttons.length) % buttons.length;
		buttons[next]?.focus();
		return;
	}
	if (event.key !== "Enter") return;
	if (event.repeat && fromActions)
	{
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if (target !== root || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
	const buttons = enabledButtons(actions);
	const primary = buttons.find(isPrimary) ?? buttons.at(-1);
	if (primary === undefined) return;
	event.preventDefault();
	event.stopPropagation();
	primary.focus();
}

/** Upstream swallows file drags on the card so a drop never reaches the composer's attach target. */
function swallowFileDrag(event: DragEvent<HTMLDivElement>)
{
	if (!event.dataTransfer.types.includes("Files")) return;
	event.preventDefault();
	event.stopPropagation();
	event.dataTransfer.dropEffect = "none";
}

/**
 * Upstream's docked card backdrop (c2d1aeb56 `y()`): `bg-surface-panel shadow-panel-sm` behind the card's content,
 * here as the local surface-2 and the approval card shadow.
 */
export function ApprovalDockBackdrop()
{
	return (
		<div
			aria-hidden="true"
			data-surface="sidebar"
			className="absolute inset-0 -z-[1] rounded-[inherit] pointer-events-none bg-surface-2 shadow-[var(--approval-card-shadow)]"
		/>
	);
}

/** Upstream's scroller classes (c2d1aeb56), ahead of the caller's. */
const SCROLL_REGION_CLASS =
	"epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * Upstream's approval scroller (c2d1aeb56): a scroll clamp with an edge fade that becomes a focusable group named
 * `label` only while its content overflows, so keyboard users can scroll it. Keyboard focus on the region itself
 * scrolls it into view; a pointer focus or focus on a child does not.
 */
export function ApprovalScrollRegion({
	label,
	className,
	onFocus,
	children,
	ref,
	...rest
}:
{
	label: string;
	className: string;
	ref?: Ref<HTMLDivElement> | undefined;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "role" | "tabIndex" | "aria-label">)
{
	const inner = useRef<HTMLDivElement | null>(null);
	const overflows = useOverflows(inner, children);
	const merged = useCallback(
		(node: HTMLDivElement | null) =>
		{
			inner.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref !== null && ref !== undefined) ref.current = node;
		},
		[ref],
	);
	return (
		<div
			ref={merged}
			tabIndex={overflows ? 0 : undefined}
			role={overflows ? "group" : undefined}
			aria-label={overflows ? label : undefined}
			data-fixed-code-size=""
			{...rest}
			onFocus={(event: FocusEvent<HTMLDivElement>) =>
			{
				onFocus?.(event);
				if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible"))
				{
					event.currentTarget.scrollIntoView(
						{
							block: "nearest",
						},
					);
				}
			}}
			className={`${SCROLL_REGION_CLASS} ${className}`}
		>
			{children}
		</div>
	);
}

/**
 * Upstream's body (c2d1aeb56): children never squash (the body scrolls instead), an empty body takes no room, and a
 * "Warnings" notices region after it makes the body give way first down to a 36px floor (72px holding a value).
 */
const BODY_GIVE_WAY_CLASS =
	"[&>*]:shrink-0 empty:hidden [&:has(~.epitaxy-approval-notices)]:shrink-[1000] [&:has(~.epitaxy-approval-notices)]:min-h-9 [&:has(~.epitaxy-approval-notices):has([data-approval-value])]:min-h-18";

/**
 * Upstream's in-flow tool card frame (c2d1aeb56 `J`'s U, W, q and J classes): the conversation cap fitter's height
 * cap (falling back to the static 60vh / 16rem one), its end reclaim pulling the tail up, and the in-flow marker.
 */
const IN_FLOW_TOOL_CARD_FRAME =
	"max-h-[var(--approval-conversation-cap,max(60vh,calc(16rem*var(--cds-rem-scale,1))))] mb-[calc(-1*var(--approval-conversation-end-reclaim,0px))] !pt-0 overflow-clip epitaxy-tool-card-in-flow";

/**
 * Upstream's approval card shell for a pending permission: a scrolling body
 * and an action row, 12px radius (cds-radius + 4px) and 12px padding. Each card is its own
 * inline-size container, and at upstream's 420px its actions stack full width.
 * Inline in the transcript ("card") it is outlined and transparent; docked above
 * the composer it sits on upstream's sidebar backdrop.
 */
export function ApprovalCardShell({
	rootRef,
	label,
	digits,
	title,
	body,
	actions,
	note,
	footer,
	titleRef,
	bodyRef,
	presentation = "dock",
	toolCard = false,
	queueDepth = 0,
	enter = false,
	compact = false,
	roam = true,
	onKeyDown,
}: {
	rootRef?: Ref<HTMLDivElement>;
	/** The card's accessible group label; omitted cards are a plain focusable box. */
	label?: string;
	/** Widest keycap digit count, which upstream uses to size the keycap column. */
	digits?: number;
	/**
	 * Upstream's in-flow tool card title: drawn in a tinted band flush with the card's top (`approval-title-region`),
	 * with the body pulled up under it. Inline ("card") presentation only.
	 */
	title?: ReactNode;
	body: ReactNode;
	actions: ReactNode;
	/** A line between the scrolling body and the actions, such as the elicitation form's caution. */
	note?: ReactNode;
	/** A line under the actions, such as the tool-approval notify tip. */
	footer?: ReactNode;
	/** The title band's scrolling region, for the title read gate. */
	titleRef?: Ref<HTMLDivElement>;
	/** The scrolling body, for the plan read gate. */
	bodyRef?: Ref<HTMLDivElement>;
	/** Upstream's inline "card" in the transcript, or the composer "dock". */
	presentation?: "card" | "dock";
	/**
	 * Upstream's `toolCard` (only the tool permission card passes it): inline, the card caps its height to the
	 * conversation's visible room and reclaims the tail space under it (`use-approval-conversation-cap.ts`).
	 */
	toolCard?: boolean;
	/** Upstream's `queueDepth`: requests pending behind this one. Only the dock draws them, as ghosts (`w`'s `V`). */
	queueDepth?: number;
	/** Upstream's 160ms enter fade for a live arrival; false marks the card `data-skip-approval-enter`. */
	enter?: boolean;
	/**
	 * Upstream's plan card (`Gc`): inline it keeps 12px gaps and the plain 60vh cap under its title band, and an
	 * empty body takes no room (`epitaxy-approval-body … empty:hidden`).
	 */
	compact?: boolean;
	/**
	 * Upstream's focusable root with its arrow roam and Enter-to-primary (`Fa`). False is upstream's plan card
	 * shell (`Fs`): no tab stop and no root keys, though a caller `onKeyDown` still runs.
	 */
	roam?: boolean;
	/** Runs before the root's own keys; a handler that calls preventDefault keeps that key from them. */
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
})
{
	// Inline, upstream's card is at most 480px wide with 24px gaps; the dock keeps its 12px rhythm on a backdrop child.
	const look =
		presentation === "card" ? `card-ring w-full max-w-[480px] ${compact ? "gap-3" : "gap-[24px]"}` : "gap-[12px]";
	// Upstream's body scrolls its overflow in place only when docked (`overscroll-contain`).
	const bodyGap = presentation === "card" ? (compact ? "gap-3" : "gap-[24px]") : "gap-[12px] overscroll-contain";
	const band = presentation === "card" && title !== undefined;
	// The banded card is upstream's in-flow tool card: no top padding, clipped to its radius, and a taller floor.
	const inFlowTool = presentation === "card" && toolCard;
	const root = useRef<HTMLDivElement | null>(null);
	const mergedRootRef = useCallback(
		(node: HTMLDivElement | null) =>
		{
			root.current = node;
			if (typeof rootRef === "function") rootRef(node);
			else if (rootRef !== null && rootRef !== undefined) rootRef.current = node;
		},
		[rootRef],
	);
	useApprovalConversationCap(root, inFlowTool);
	const frame = inFlowTool
		? IN_FLOW_TOOL_CARD_FRAME
		: band
			? compact
				? "max-h-[60vh] !pt-0 overflow-clip"
				: "max-h-[max(60vh,calc(16rem*var(--cds-rem-scale,1)))] !pt-0 overflow-clip"
			: "max-h-[60vh]";
	// Upstream's root carries a literal 12px pad; `.epitaxy-approval-card[data-approval-presentation="card"]` lifts the
	// inline card's to pad-lg (16px comfortable, 12px compact). Title band and body bleed to the same inset.
	const inset =
		presentation === "card"
			?
				{
					pad: "p-lg",
					bleed: "-mx-pad-lg",
					px: "px-lg",
				}
			:
				{
					pad: "p-3",
					bleed: "-mx-3",
					px: "px-3",
				};
	return (
		// Docked, the card root is the dock column's flex item, which its shrink and floor rules select.
		<div className={presentation === "card" ? "@container/approval-dock" : "contents"}>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- upstream's focusable card root: arrows roam its action buttons, Enter focuses the primary, and clicks stop short of the transcript */}
			<div
				ref={mergedRootRef}
				data-approval-card-root
				data-fixed-code-size=""
				data-focus-region="question"
				data-approval-card-digits={digits}
				// Upstream sets the attribute only off the dock (c2d1aeb56 `w`).
				{...(presentation === "card"
					?
						{
							"data-approval-presentation": presentation,
						}
					: {})}
				// Upstream's cds host shell `Re` (shared-40) marks every un-themed approval card root, and its approval host
				// (c2d1aeb56 `J`) never themes: the permission, plan and elicitation cards all carry it. Its only reader is a
				// desktop-glass background rule, so on the web it is DOM parity.
				data-approval-prompt=""
				{...(enter
					? {}
					:
						{
							"data-skip-approval-enter": "",
						})}
				role={label === undefined ? undefined : "group"}
				aria-label={label}
				tabIndex={roam ? 0 : undefined}
				onKeyDown={(event) =>
				{
					if (onKeyDown !== undefined)
					{
						onKeyDown(event);
						if (event.defaultPrevented) return;
					}
					if (roam) onApprovalRootKeyDown(event);
				}}
				onDragEnter={swallowFileDrag}
				onDragOver={swallowFileDrag}
				onDragLeave={swallowFileDrag}
				onDrop={swallowFileDrag}
				onClick={(event) =>
				{
					event.stopPropagation();
				}}
				className={`epitaxy-approval-card @container relative isolate flex ${frame} flex-col rounded-card ${inset.pad} text-body text-primary origin-top focus-visible:outline-1 focus-visible:outline-fill-accent focus-visible:outline-offset-2 ${look}${enter ? " animate-approval-inline-enter motion-reduce:animate-none" : ""}`}
			>
				{/* Upstream's stack root: the ghosts come first, behind the backdrop at the same z, then the card. */}
				<ApprovalStackGhosts queueDepth={presentation === "dock" ? queueDepth : 0} />
				{presentation === "dock" && <ApprovalDockBackdrop />}
				{band && (
					<div
						ref={titleRef}
						data-testid="approval-title-region"
						className="shrink-0 overflow-y-auto max-h-[max(2rem,min(30vh,calc(60vh-10rem)))] -mx-pad-lg px-lg"
					>
						<div className="-mx-pad-lg flex flex-col gap-xs px-lg bg-alpha-1 py-md">{title}</div>
					</div>
				)}
				{/* Docked, the title band is upstream's card-only frame: the title heads the card unbanded. */}
				{presentation === "dock" && title !== undefined && (
					<div ref={titleRef} className="flex shrink-0 flex-col gap-xs">
						{title}
					</div>
				)}
				<ApprovalScrollRegion
					ref={bodyRef}
					data-approval-card-body
					label="Request details"
					className={`epitaxy-approval-body ${inset.bleed} ${band ? "-mt-[18px]" : "-mt-1"} -mb-2 flex min-h-0 flex-col overflow-y-auto ${inset.px} pt-1 pb-2 ${BODY_GIVE_WAY_CLASS} ${bodyGap}`}
				>
					{body}
				</ApprovalScrollRegion>
				{note}
				<div
					data-approval-card-actions
					className={`flex flex-wrap items-start justify-end gap-x-md gap-y-sm ${STACK_ACTIONS}`}
				>
					{actions}
				</div>
				{footer}
			</div>
		</div>
	);
}

const TERMINAL_FOOTNOTE = "Answer in the terminal running this session.";

/**
 * Stands where upstream docks the pending question card, directly above the composer,
 * when no hook reported the question: the awaiting dot and a plain line, with
 * no options to pick, since the question itself is not on disk yet. A pending
 * MCP form or url elicitation names its server in `title` and adds its `message`.
 */
export function WaitingForInputNotice({
	title = "Waiting for your input",
	message,
}:
{
	title?: string;
	message?: string;
} = {})
{
	return (
		<div
			role="status"
			aria-label={title}
			data-waiting-input-notice
			className="flex items-start gap-2 rounded-r7 bg-surface-2 p-3 text-body text-primary shadow-[var(--approval-card-shadow)]"
		>
			<span aria-hidden="true" className="flex h-[19px] shrink-0 items-center">
				<StatusPulse kind="awaiting" />
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="font-[580]">{title}</span>
				{message !== undefined && (
					<span className="text-footnote text-secondary whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
						{message}
					</span>
				)}
				<span className="text-footnote text-secondary">{TERMINAL_FOOTNOTE}</span>
			</span>
		</div>
	);
}

/** Why Open is off while the terminal dialog is still being read. */
export const URL_OPEN_LOADING_REASON = "Reading the terminal dialog…";
/**
 * Why Open is off when the terminal dialog is not on Accept: the CLI starts on
 * Decline for a URL it can't show exactly or that is too long.
 */
export const URL_OPEN_UNAVAILABLE_REASON = "Claude Code won't open this URL from here. Check it in the terminal.";

/** The URL's host as upstream's link card names it; empty for text that isn't a URL. */
function urlHost(url: string): string
{
	try
	{
		return new URL(url).host;
	}
	catch
	{
		return "";
	}
}

/** Upstream's cds Card frame and its body (`zb` / `MR`), with `size="sm"` stepping the body padding down to 12px. */
const LINK_CARD_CLASS =
	"group/card relative isolate flex flex-col rounded-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-card-ring after:content-['']";
const LINK_CARD_BODY_CLASS =
	"cds-card-body flex min-h-0 flex-1 flex-col self-stretch [gap:inherit] [align-items:inherit] [justify-content:inherit] rounded-[inherit] p-3";
const LINK_TEXT = "text-body min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext]";

/**
 * A url elicitation docked above the composer, drawn as upstream's cloud link card (`wc`) and answered
 * through the CLI's terminal dialog: "{server} wants to open a URL", a cds Card with the host and the URL,
 * the message, the caution, and [Decline] then [Open link]. Open link presses the dialog's Accept, which
 * opens the link and answers in one step, so upstream's separate "I’m done, continue" has no local twin.
 * It is on only while the dialog read off the pane (`dialogFocus`; undefined while reading) sits on Accept.
 * A decision marks the chosen button busy ("Sending…") and disables the other until the
 * `ElicitationResult` drops the card, since the CLI can refuse an answer; a refused one shows its error
 * and re-enables them.
 */
export function UrlElicitationCard({
	serverName,
	message,
	url,
	dialogFocus,
	onDecision,
}: {
	serverName: string;
	message: string;
	url: string;
	dialogFocus: ElicitationFocus | null | undefined;
	onDecision: (decision: "allow" | "deny") => Promise<void>;
})
{
	const [sent, setSent] = useState<"allow" | "deny" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const title = `${serverName.trim() || "An unknown server"} wants to open a URL`;
	const openReason =
		dialogFocus === undefined
			? URL_OPEN_LOADING_REASON
			: dialogFocus?.stop === "accept"
				? null
				: URL_OPEN_UNAVAILABLE_REASON;

	const decide = async (decision: "allow" | "deny") =>
	{
		setError(null);
		setSent(decision);
		try
		{
			await onDecision(decision);
		}
		catch (err)
		{
			setError(err instanceof Error ? err.message : "Failed to answer the URL request");
			setSent(null);
		}
	};

	return (
		<ApprovalCardShell
			label={title}
			body={
				<>
					<div className="text-primary min-h-6 shrink-0 flex items-center gap-1">
						<span
							data-approval-card-title
							data-question-stop-name=""
							className={`${APPROVAL_CARD_TITLE} min-w-0 break-words [unicode-bidi:plaintext]`}
						>
							{title}
						</span>
					</div>
					<div
						data-cds="Card"
						data-size="sm"
						data-testid="epitaxy-elicitation-link"
						className={LINK_CARD_CLASS}
					>
						<div data-cds-card-body="" className={LINK_CARD_BODY_CLASS}>
							<span className={`${LINK_TEXT} font-medium text-primary`}>{urlHost(url)}</span>
							<span className={`${LINK_TEXT} text-secondary`}>{url}</span>
						</div>
					</div>
					{message !== "" && <p className={`${LINK_TEXT} text-secondary whitespace-pre-wrap`}>{message}</p>}
					{error !== null && (
						<p role="alert" className="text-footnote text-extended-pink">
							{error}
						</p>
					)}
				</>
			}
			note={
				<p className="text-body text-muted-as-secondary" data-testid="epitaxy-elicitation-caution">
					This opens a site outside Claude.
				</p>
			}
			actions={
				<>
					<ApprovalActionButton
						variant="secondary"
						busy={sent === "deny"}
						busyLabel={APPROVAL_SENDING_LABEL}
						disabled={sent === "allow"}
						onClick={() => void decide("deny")}
					>
						Decline
					</ApprovalActionButton>
					<DisabledReason reason={sent === null ? openReason : null}>
						<ApprovalActionButton
							variant="primary"
							data-approval-primary=""
							busy={sent === "allow"}
							busyLabel={APPROVAL_SENDING_LABEL}
							disabled={sent === "deny" || (sent === null && openReason !== null)}
							onClick={() => void decide("allow")}
						>
							Open link
						</ApprovalActionButton>
					</DisabledReason>
				</>
			}
		/>
	);
}

/** Upstream's learn-more article for a safeguards flag on a model before the newer generation (ca8b34310 `Xf`). */
const REFUSAL_LEARN_MORE_URL = "https://support.claude.com/en/articles/8106465";
/** Upstream's fallback copy when its runtime catalog lacks the category message, as it does live. */
const REFUSAL_FALLBACK_COPY =
	"This model's safeguards flagged this message. This sometimes happens with safe, normal conversations. ";
/** Upstream's disabledReason on the X while a choice is in flight. */
const REFUSAL_SENDING_REASON = "Sending response…";

/**
 * Upstream's "Session paused" card (cc43287c9 `h1`, flag-off) for the CLI's
 * refusal-fallback dialog, docked above the composer and answered through the
 * terminal: the title with a Dismiss X, upstream's fallback copy with Learn
 * more and the category, then [Edit prompt and retry with …] (when `canEdit`)
 * and [Switch to …], upstream's order rather than the CLI's. A choice marks
 * its button busy and disables the rest until the dialog leaves; a refused one
 * shows its error and re-enables them.
 */
export function RefusalFallbackPromptCard({
	dialog,
	canEdit,
	onChoose,
}: {
	dialog: HerdrRefusalFallbackDialog;
	canEdit: boolean;
	onChoose: (choice: RefusalFallbackChoice) => Promise<void>;
})
{
	const [sent, setSent] = useState<RefusalFallbackChoice | null>(null);
	const [error, setError] = useState<string | null>(null);

	const choose = async (choice: RefusalFallbackChoice) =>
	{
		setError(null);
		setSent(choice);
		try
		{
			await onChoose(choice);
		}
		catch (err)
		{
			setError(err instanceof Error ? err.message : "Failed to answer the dialog");
			setSent(null);
		}
	};

	return (
		<ApprovalCardShell
			label="Session paused"
			body={
				<>
					<div className="text-primary min-h-6 shrink-0 flex items-center gap-1">
						<span
							data-approval-card-title
							data-question-stop-name=""
							className={`${APPROVAL_CARD_TITLE} min-w-0 flex-1 break-words`}
						>
							<span data-dialog-announce="">Session paused</span>
						</span>
						<span className="shrink-0 self-center">
							<DisabledReason reason={sent === null ? null : REFUSAL_SENDING_REASON}>
								<button
									type="button"
									aria-label="Dismiss"
									disabled={sent !== null}
									data-cds="Button"
									className={`${cdsButtonClass("ghost")} aspect-square shrink-0 !px-0 ${CDS_BUTTON_DISABLED} ${CDS_ICON_ONLY_DISABLED}`}
									onClick={() => void choose("cancelled")}
								>
									<Icon name="X" />
								</button>
							</DisabledReason>
						</span>
					</div>
					<div data-refusal-body="" className="text-body text-secondary min-w-0 break-words">
						<span data-dialog-announce="">
							{REFUSAL_FALLBACK_COPY}
							<ExternalTextLink rel="noopener" href={REFUSAL_LEARN_MORE_URL}>
								Learn more
							</ExternalTextLink>
							.
						</span>
						{dialog.category !== null && (
							<span className="block pt-1">
								Details: <code className="font-mono-ui break-all">{`[${dialog.category}]`}</code>
							</span>
						)}
					</div>
					{dialog.guidance !== null && (
						<p className="text-footnote text-muted-as-secondary whitespace-pre-wrap">{dialog.guidance}</p>
					)}
					{error !== null && (
						<p role="alert" className="text-footnote text-extended-pink">
							{error}
						</p>
					)}
				</>
			}
			actions={
				<>
					{canEdit && (
						<ApprovalActionButton
							variant="secondary"
							busy={sent === "edit_prompt"}
							busyLabel={APPROVAL_SENDING_LABEL}
							disabled={sent !== null && sent !== "edit_prompt"}
							onClick={() => void choose("edit_prompt")}
						>
							{dialog.editLabel}
						</ApprovalActionButton>
					)}
					<ApprovalActionButton
						variant="secondary"
						busy={sent === "retry_fallback"}
						busyLabel={APPROVAL_SENDING_LABEL}
						disabled={sent !== null && sent !== "retry_fallback"}
						onClick={() => void choose("retry_fallback")}
					>
						<span className="min-w-0 truncate" title={dialog.switchLabel}>
							{dialog.switchLabel}
						</span>
					</ApprovalActionButton>
				</>
			}
		/>
	);
}
