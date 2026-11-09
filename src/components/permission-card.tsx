import {useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject} from "react";

import {useIsMac} from "../hooks/use-is-mac";
import {useRowsReadGate} from "../hooks/use-rows-read-gate";
import {
	acknowledgeApproval,
	clearApprovalAnswered,
	markApprovalAnswered,
	useApprovalAnswered,
} from "../lib/answered-approvals";
import {holdAnswered, releaseAnswered} from "../lib/answered-sessions";
import {approvalEnterSeen, markApprovalEnterSeen} from "../lib/approval-enter-seen";
import {installLandingKeys} from "../lib/approval-slot-landing";
import {APPROVAL_ARM_GRACE_MS, approvalHotkeyFocusAllowed, isIdleComposer, onScreen} from "../lib/dock-keys";
import {storeLeadingAllow, useLeadingAllow} from "../lib/approval-leading-allow";
import {
	permissionDecisionForKey,
	type PermissionDecision,
	type PermissionDetailLang,
	type PermissionTitle,
} from "../lib/permission-card";
import type {PermissionDialogShape} from "../lib/herdr/permission-screen";
import type {PermissionRow} from "../lib/permission-rows";
import {toAriaKeyShortcuts} from "../lib/shortcuts/format";
import {
	PERSISTENT_ALLOW_LABELS,
	PERSISTENT_ALLOW_SCOPES,
	type PersistentAllowKind,
} from "../lib/permission-suggestions";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";
import {APPROVAL_SENDING_LABEL, ApprovalActionButton, ApprovalCardShell} from "./approval-card";
import {PermissionRowsList, PERMISSION_ROWS_LABEL} from "./permission-rows";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {HighlightedCommand} from "./tool-renderers/bash-renderer";
import {DisabledReason} from "./ui/disabled-reason";
import {Shortcut} from "./ui/shortcut";
import {SplitDropdownButton} from "./ui/split-dropdown-button";

/**
 * The tool-permission card, drawn inline as claude.ai/code's approvals:
 * "Allow Claude to <action> <meta>?" in a tinted title band, the detail block, and [Deny] then the allow
 * group [Allow once ⌘⏎]. When the CLI's dialog offers a persistent option, the allow group is a
 * primary split button that leads with upstream's stored preference: the persistent option ("Always allow" /
 * "Allow for this session", tipped with its scope) with Allow once in the menu, or the reverse. Picking the
 * non-leading option from the menu makes it the lead for the next card.
 * Upstream's keys (Esc deny, ⌘⏎ allow once, ⇧⌘⏎ the persistent option) and no digits, which are dock-only.
 * A decision hides the card at once, with no busy state; a failed answer brings it back with the error.
 * With `sessionId` and `answerKey` the decision also marks the prompt answered for every view,
 * so a remount of the same prompt stays hidden until the mark clears on a failed answer.
 * With `hideOnDecision` false the card stays until its parent drops it: the chosen action busy ("Sending…")
 * and the others disabled, as upstream's held form and link cards.
 * A live arrival fades in over 160ms; a remount or reload of the same prompt (`enterKey`) does not.
 * With `dialog`, the terminal's dialog shapes the card as upstream's ask flags do: a deny-first dialog,
 * or one whose shape is still unknown (upstream's askFlagsUnknown), draws upstream's defaultToNo card
 * (Deny primary, Allow once secondary, no keys, no persistent option); a dialog with no persistent row
 * drops the hook's persistent option.
 */
export function PermissionCard({
	title,
	detail,
	detailLang = null,
	clampTitle = false,
	detailNote = null,
	description = null,
	tokenWarning = false,
	detailFirst = false,
	rows = null,
	rowsTrail = false,
	rowsGate = false,
	canAnswer,
	persistentAllow: hookPersistentAllow = null,
	dialog,
	onDecision,
	footer,
	enterKey,
	sessionId,
	answerKey,
	hideOnDecision = true,
}: {
	title: PermissionTitle;
	detail: string | null;
	/** A command detail's language: drawn as upstream's highlighted code card with a `$ ` gutter. */
	detailLang?: PermissionDetailLang | null;
	/** Upstream's `clampTitle`: the title value is clamped to two lines. */
	clampTitle?: boolean;
	/** Upstream's footnote under the detail ("Keeps running in the background."). */
	detailNote?: string | null;
	/** The description line: a Bash command's, an agent's or a Workflow's. */
	description?: string | null;
	/** Upstream's Workflow callout about usage, linking the Background tasks pane. */
	tokenWarning?: boolean;
	/** Upstream's `detailFirst`: the detail leads the body (Grep's pattern, WebFetch's url). */
	detailFirst?: boolean;
	/** Upstream's input rows: the tool call's other input as key/value rows. */
	rows?: readonly PermissionRow[] | null;
	/** Upstream's `rowsTrail`: the rows close the body in the tinted "What Claude sent" panel. */
	rowsTrail?: boolean;
	/** Upstream's loose rows read gate: Allow waits until a trail panel that scrolls has been read to its end. */
	rowsGate?: boolean;
	/** False without a live herdr pane that accepts writes. */
	canAnswer: boolean;
	/** The dialog's persistent allow option, from the PermissionRequest hook; null hides it. */
	persistentAllow?: PersistentAllowKind | null;
	/**
	 * The shape of the terminal's dialog, or "unknown" until it is read; undefined keeps the hook's card
	 * (no dialog to read, as an elicitation's).
	 */
	dialog?: PermissionDialogShape | "unknown" | undefined;
	onDecision: (decision: PermissionDecision) => Promise<void>;
	/** Rendered under the actions; the session page passes the notify tip. */
	footer?: ReactNode;
	/** The prompt's notification id: it fades in only the first time this tab draws it. */
	enterKey?: string | undefined;
	/** The prompt's session, for the answered-approvals mark. */
	sessionId?: string | undefined;
	/** The prompt's answer key (its tool call, else its notification id), marked answered on a decision. */
	answerKey?: string | undefined;
	/**
	 * False keeps the card up, its chosen action busy, after a decision: an elicitation's card
	 * is cleared by its `ElicitationResult`, since the CLI can refuse an early Enter.
	 */
	hideOnDecision?: boolean;
}) {
	const isMac = useIsMac();
	const [enter] = useState(() => enterKey === undefined || !approvalEnterSeen(enterKey));
	useEffect(() => {
		if (enterKey !== undefined) markApprovalEnterSeen(enterKey);
	}, [enterKey]);
	const [sent, setSent] = useState<PermissionDecision | null>(null);
	const decided = sent !== null;
	const [error, setError] = useState<string | null>(null);
	// An elicitation's card stays up after a decision, so only a hiding card marks its prompt answered.
	const markSession = hideOnDecision ? sessionId : undefined;
	const markKey = markSession === undefined ? undefined : answerKey;
	const answered = useApprovalAnswered(markSession ?? "", markKey ?? null);
	const enabled = canAnswer && !decided && !answered;
	// Upstream's `hn`/`vn`: a defaultToNo (or askFlagsUnknown) card leads with Deny and binds no keys.
	const denyFirst = dialog === "unknown" || dialog?.denyFirst === true;
	const persistentAllow = denyFirst || dialog?.persistent === false ? null : hookPersistentAllow;

	const decide = useCallback(
		async (decision: PermissionDecision) => {
			setError(null);
			setSent(decision);
			if (markSession !== undefined && markKey !== undefined) markApprovalAnswered(markSession, markKey);
			if (sessionId !== undefined && answerKey !== undefined) holdAnswered(sessionId, answerKey);
			try {
				await onDecision(decision);
				// The card carries no tool name, and nothing reads the stored one.
				if (markSession !== undefined && markKey !== undefined) acknowledgeApproval(markSession, markKey, "");
			} catch (err) {
				if (markSession !== undefined && markKey !== undefined) clearApprovalAnswered(markSession, markKey);
				if (sessionId !== undefined) releaseAnswered(sessionId);
				setError(err instanceof Error ? err.message : "Failed to answer the permission request");
				setSent(null);
			}
		},
		[onDecision, markSession, markKey, sessionId, answerKey],
	);

	const lead = useLeadingAllow();
	// Upstream's `ui`: picking the non-leading option from the menu makes it the lead.
	const allowOnceFromMenu = () => {
		storeLeadingAllow("once");
		void decide("allow");
	};
	const persistentFromMenu = () => {
		storeLeadingAllow("always");
		void decide("always");
	};

	// Upstream's loose rows gate (`ml` + `lr`): enforced only while the body scrolls, or before it has a layout.
	const rowsPanelRef = useRef<HTMLDivElement>(null);
	const hasRows = rows !== null && rows.length > 0;
	const rowsKey = hasRows ? JSON.stringify(rows) : "";
	const rowsGated = rowsGate && rowsTrail && hasRows;
	const rowsRead = useRowsReadGate({ref: rowsPanelRef, watched: rowsGated, gateKey: rowsKey});
	const readHeld = rowsGated && (rowsRead.fits === false || rowsRead.state === "unlaid") && rowsRead.state !== "read";
	// The hint mounts once the gate has held, then stays (invisible once read) so the card doesn't jump.
	const [hinted, setHinted] = useState(false);
	useEffect(() => {
		if (readHeld) setHinted(true);
	}, [readHeld]);
	const [heldAttempts, setHeldAttempts] = useState(0);
	const onHeldAttempt = useCallback(() => {
		setHeldAttempts((count) => count + 1);
	}, []);

	const cardRootRef = useRef<HTMLDivElement>(null);
	usePermissionHotkeys(cardRootRef, {
		enabled: enabled && !denyFirst,
		persistent: persistentAllow !== null,
		held: readHeld,
		onHeldAttempt,
		decide,
	});

	if ((decided || answered) && hideOnDecision) return null;

	const detailBlock = (
		<>
			{detail !== null &&
				(detailLang === null ? (
					<div data-permission-detail data-approval-value className={DETAIL_CLASS}>
						{detail}
					</div>
				) : (
					<div data-permission-detail className="flow-root">
						<div data-approval-value>
							<div className={CODE_CARD_CLASS}>
								<HighlightedCommand
									command={detail}
									language={detailLang === "bash" ? "shellscript" : detailLang}
								/>
							</div>
						</div>
					</div>
				))}
			{detailNote !== null && <p className={DETAIL_NOTE_CLASS}>{detailNote}</p>}
		</>
	);
	/** The allow buttons' disabled reason while the rows gate holds them. */
	const allowReason = readHeld ? ROWS_READ_HINT : null;
	const withAllowReason = (control: ReactElement) =>
		rowsGated ? <DisabledReason reason={allowReason}>{control}</DisabledReason> : control;

	return (
		<ApprovalCardShell
			rootRef={cardRootRef}
			label={"action" in title ? `Permission request: ${title.action}` : "Permission request"}
			footer={footer}
			presentation="card"
			enter={enter}
			title={
				<div className="text-primary min-h-6 shrink-0 flex items-center gap-1">
					<span
						data-permission-title
						data-approval-card-title
						className="text-[13px]/[19px] font-normal min-w-0 break-words"
					>
						<PermissionTitleText title={title} clamp={clampTitle} />
					</span>
				</div>
			}
			body={
				<div className="flex flex-col gap-[12px] empty:hidden">
					{detailFirst && detailBlock}
					{description !== null && <div className={DESCRIPTION_CLASS}>{description}</div>}
					{!rowsTrail && hasRows && <PermissionRowsList rows={rows} />}
					{!detailFirst && detailBlock}
					{tokenWarning && <TokenWarning />}
					{rowsTrail &&
						hasRows &&
						(rowsGated ? (
							// Upstream's `ml` wrapper, keyed by the rows so new rows start unread.
							<div ref={rowsPanelRef} key={rowsKey} data-testid="approval-read-rows">
								{/* A gated panel never clamps; its groups fold only once a scrolled panel is read. */}
								<RowsPanel
									rows={rows}
									foldable={rowsRead.fits === false && rowsRead.state === "read"}
									clamp={false}
								/>
							</div>
						) : (
							<RowsPanel rows={rows} foldable clamp />
						))}
					{!canAnswer && <ReadOnlyAnswerHint className="text-footnote text-secondary" />}
					{error && <p className="text-footnote text-extended-pink">{error}</p>}
				</div>
			}
			note={
				rowsGated ? (
					<>
						{/* Upstream's re-announcing live region: a trailing NBSP on even attempts. */}
						<p aria-live="polite" className="sr-only">
							{readHeld && heldAttempts > 0
								? `${ROWS_READ_HINT}${heldAttempts % 2 === 0 ? " " : ""}`
								: ""}
						</p>
						{(hinted || heldAttempts > 0) && (
							<p
								aria-hidden
								data-testid="approval-read-hint"
								className={`${READ_HINT_CLASS}${readHeld ? "" : " invisible"}`}
							>
								{ROWS_READ_HINT}
							</p>
						)}
					</>
				) : undefined
			}
			actions={
				<>
					<span className="contents">
						<ApprovalActionButton
							variant={denyFirst ? "primary" : "secondary"}
							{...(denyFirst ? {"data-approval-primary": ""} : {"aria-keyshortcuts": "Escape"})}
							busy={sent === "deny"}
							busyLabel={APPROVAL_SENDING_LABEL}
							disabled={!enabled && sent !== "deny"}
							onClick={() => void decide("deny")}
						>
							<span data-approval-digit="1">Deny</span>
						</ApprovalActionButton>
					</span>
					<div data-approval-allow className="flex min-w-0 flex-wrap items-start gap-2">
						{denyFirst ? (
							<ApprovalActionButton
								variant="secondary"
								busy={sent === "allow"}
								busyLabel={APPROVAL_SENDING_LABEL}
								disabled={!enabled && sent !== "allow"}
								onClick={() => void decide("allow")}
							>
								<span data-approval-digit="2">Allow once</span>
							</ApprovalActionButton>
						) : persistentAllow === null ? (
							withAllowReason(
								<ApprovalActionButton
									variant="primary"
									data-approval-primary=""
									aria-keyshortcuts={toAriaKeyShortcuts("cmd+enter", isMac)}
									busy={sent === "allow"}
									busyLabel={APPROVAL_SENDING_LABEL}
									disabled={(!enabled && sent !== "allow") || readHeld}
									onClick={() => void decide("allow")}
								>
									<span data-approval-digit="2">Allow once</span>
									<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
								</ApprovalActionButton>,
							)
						) : (
							withAllowReason(
								<SplitDropdownButton
									variant="primary"
									className="max-w-full min-w-0"
									{...(lead === "always"
										? {
												groupLabel: PERSISTENT_ALLOW_LABELS[persistentAllow],
												tooltip: PERSISTENT_ALLOW_SCOPES[persistentAllow],
												label: (
													<span data-approval-digit="2" data-approval-primary="">
														{PERSISTENT_ALLOW_LABELS[persistentAllow]}
														<span className="sr-only select-none">{`, ${PERSISTENT_ALLOW_SCOPES[persistentAllow]}`}</span>
													</span>
												),
												items: [
													{
														label: "Allow once",
														shortcut: "cmd+enter",
														onSelect: allowOnceFromMenu,
													},
												],
												onPrimaryClick: () => void decide("always"),
											}
										: {
												groupLabel: "Allow once",
												label: (
													<span data-approval-digit="2" data-approval-primary="">
														Allow once
													</span>
												),
												shortcut: "cmd+enter",
												"aria-keyshortcuts": toAriaKeyShortcuts("cmd+enter", isMac),
												items: [
													{
														label: PERSISTENT_ALLOW_LABELS[persistentAllow],
														description: PERSISTENT_ALLOW_SCOPES[persistentAllow],
														onSelect: persistentFromMenu,
													},
												],
												onPrimaryClick: () => void decide("allow"),
											})}
									menuLabel="More allow options"
									busy={sent === "allow" || sent === "always"}
									disabled={!enabled || readHeld}
								/>,
							)
						)}
					</div>
				</>
			}
		/>
	);
}

/**
 * Upstream's approval hotkeys (`c5`) on window in the capture phase. They act with focus in the card,
 * on the page body or in the idle composer, and yield to IME, popups and other fields, and while the card is
 * off-screen. ⌘⏎ also yields to alt and a composer draft. A repeat, or a key within the 400ms arm grace,
 * is swallowed with no action. ⇧⌘⏎ needs a persistent option and focus in the card or the composer, and
 * is refused on a card focus landed on (upstream's landing keys, installed ahead of this listener).
 */
function usePermissionHotkeys(
	cardRootRef: RefObject<HTMLDivElement | null>,
	{
		enabled,
		persistent,
		held,
		onHeldAttempt,
		decide,
	}: {
		enabled: boolean;
		persistent: boolean;
		/** A read gate holds the allow decisions: they are swallowed and reported as attempts. */
		held: boolean;
		onHeldAttempt: () => void;
		decide: (decision: PermissionDecision) => unknown;
	},
) {
	const armedAtRef = useRef<number | null>(null);
	useEffect(() => {
		armedAtRef.current = performance.now();
	}, []);
	useEffect(() => {
		if (!enabled) return undefined;
		// The landing keys go first, so ⇧⌘⏎ on a card focus merely landed on never reaches this listener.
		installLandingKeys(window);
		const onKeyDown = (event: KeyboardEvent) => {
			const card = cardRootRef.current;
			const decision = permissionDecisionForKey(event);
			if (card === null || decision === null) return;
			if (event.isComposing) {
				if (decision === "deny") event.stopPropagation();
				return;
			}
			if (!approvalHotkeyFocusAllowed(card) || !onScreen(card)) return;
			const active = document.activeElement;
			if (decision === "allow" && isIdleComposer(active) && active.value !== "") return;
			event.preventDefault();
			event.stopPropagation();
			const armedAt = armedAtRef.current ?? performance.now();
			if (event.repeat || performance.now() - armedAt < APPROVAL_ARM_GRACE_MS) return;
			if (decision === "always" && !(persistent && (card.contains(active) || isIdleComposer(active)))) return;
			if (held && decision !== "deny") {
				onHeldAttempt();
				return;
			}
			decide(decision);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, enabled, persistent, held, onHeldAttempt, decide]);
}

/** Upstream's body classes (`epitaxy-code-size` hooks, held at the default size by the card's data-fixed-code-size): the detail block (`Lg`), its footnote (`kg`) and the description line (`Dg`). */
const DETAIL_CLASS =
	"epitaxy-code-size bg-alpha-1 rounded-r4 py-2 px-3 text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]";
/** Upstream's command detail (`epitaxy-code-card`): the code theme's background at default density. */
const CODE_CARD_CLASS =
	"epitaxy-code-size flex overflow-clip rounded-lg px-2 py-1 text-code bg-surface-1 dark:bg-surface-2 select-text [unicode-bidi:plaintext]";
const DETAIL_NOTE_CLASS = "text-footnote text-ink-muted select-text break-words [unicode-bidi:plaintext]";
const DESCRIPTION_CLASS =
	"text-body text-secondary select-text break-words max-h-[calc(3*var(--text-body--line-height))] overflow-y-auto [unicode-bidi:plaintext]";

/** Upstream's rows gate hint (`ph.rowsHint`). */
const ROWS_READ_HINT = "Scroll to the end to allow this.";
/** Upstream's read hint above the actions, centred in a stacked (≤420px) card. */
const READ_HINT_CLASS =
	"epitaxy-approval-read-hint text-footnote text-muted-as-secondary text-end text-balance @max-[420px]:text-center";

/** Upstream's trail rows panel: the tinted "What Claude sent" block closing the card body. */
function RowsPanel({rows, foldable, clamp}: {rows: readonly PermissionRow[]; foldable: boolean; clamp: boolean}) {
	return (
		<div data-permission-rows-panel className="flex flex-col gap-1 rounded-lg bg-alpha-1 px-3 py-2">
			<span aria-hidden className="text-footnote text-muted-as-secondary">
				{PERMISSION_ROWS_LABEL}
			</span>
			<PermissionRowsList rows={rows} foldable={foldable} clamp={clamp} />
		</div>
	);
}

/** Upstream's Workflow callout; "tasks pane" opens the Background tasks pane where one can host it. */
function TokenWarning() {
	const backgroundTasks = useBackgroundTasksOpener();
	return (
		<div className="rounded-lg bg-alpha-1 px-3 py-2.5 text-body text-secondary select-text break-words">
			Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time
			from the{" "}
			{backgroundTasks === null ? (
				"tasks pane"
			) : (
				<button
					type="button"
					className="inline cursor-pointer underline"
					onClick={() => {
						backgroundTasks.open();
					}}
				>
					tasks pane
				</button>
			)}
			.
		</div>
	);
}

const TITLE_PART = "text-primary [unicode-bidi:plaintext]";

/**
 * Upstream's title: the action and meta are their own bidi-isolated spans inside the approval value,
 * which a clamped title (`clampTitle`) draws as a two-line `line-clamp-2` span instead.
 */
function PermissionTitleText({title, clamp}: {title: PermissionTitle; clamp: boolean}) {
	if (!("action" in title)) return <span className={TITLE_PART}>{title.heading}</span>;
	return (
		<span className="min-w-0 break-words">
			<span data-permission-title-value {...(clamp ? {className: "line-clamp-2"} : {"data-approval-value": ""})}>
				Allow Claude to <span className={TITLE_PART}>{title.action}</span>
				{title.meta !== null && (
					<>
						{" "}
						<span className={TITLE_PART}>{title.meta}</span>
					</>
				)}
				?
			</span>
		</span>
	);
}
