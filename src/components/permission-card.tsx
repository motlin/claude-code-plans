import {useCallback, useEffect, useRef, useState, type ReactNode, type RefObject} from "react";

import {useIsMac} from "../hooks/use-is-mac";
import {approvalEnterSeen, markApprovalEnterSeen} from "../lib/approval-enter-seen";
import {APPROVAL_ARM_GRACE_MS, approvalHotkeyFocusAllowed, isIdleComposer, onScreen} from "../lib/dock-keys";
import {permissionDecisionForKey, type PermissionDecision, type PermissionTitle} from "../lib/permission-card";
import {toAriaKeyShortcuts} from "../lib/shortcuts/format";
import {
	PERSISTENT_ALLOW_LABELS,
	PERSISTENT_ALLOW_SCOPES,
	type PersistentAllowKind,
} from "../lib/permission-suggestions";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";
import {APPROVAL_CARD_TITLE, ApprovalActionButton, ApprovalCardShell} from "./approval-card";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {Shortcut} from "./ui/shortcut";
import {SplitDropdownButton} from "./ui/split-dropdown-button";

/**
 * The tool-permission card, drawn inline as claude.ai/code's approvals:
 * "Allow Claude to <action> <meta>?", the detail block, and [Deny] then the allow
 * group [Allow once ⌘⏎]. When the CLI's dialog offers a persistent option, it leads instead as a
 * primary split button ("Always allow" / "Allow for this session") whose menu holds Allow once.
 * Upstream's keys (Esc deny, ⌘⏎ allow once, ⇧⌘⏎ the persistent option) and no digits, which are dock-only.
 * A decision hides the card at once, with no busy state; a failed answer brings it back with the error.
 * With `hideOnDecision` false the card stays, disabled, until its parent drops it.
 * A live arrival fades in over 160ms; a remount or reload of the same prompt (`enterKey`) does not.
 */
export function PermissionCard({
	title,
	detail,
	detailNote = null,
	description = null,
	tokenWarning = false,
	canAnswer,
	persistentAllow = null,
	onDecision,
	footer,
	enterKey,
	hideOnDecision = true,
}: {
	title: PermissionTitle;
	detail: string | null;
	/** Upstream's footnote under the detail ("Keeps running in the background."). */
	detailNote?: string | null;
	/** A Workflow's description line. */
	description?: string | null;
	/** Upstream's Workflow callout about usage, linking the Background tasks pane. */
	tokenWarning?: boolean;
	/** False without a live herdr pane that accepts writes. */
	canAnswer: boolean;
	/** The dialog's persistent allow option, from the PermissionRequest hook; null hides it. */
	persistentAllow?: PersistentAllowKind | null;
	onDecision: (decision: PermissionDecision) => Promise<void>;
	/** Rendered under the actions; the session page passes the notify tip. */
	footer?: ReactNode;
	/** The prompt's notification id: it fades in only the first time this tab draws it. */
	enterKey?: string | undefined;
	/**
	 * False keeps the card up, disabled, after a decision: an elicitation's card
	 * is cleared by its `ElicitationResult`, since the CLI can refuse an early Enter.
	 */
	hideOnDecision?: boolean;
}) {
	const isMac = useIsMac();
	const [enter] = useState(() => enterKey === undefined || !approvalEnterSeen(enterKey));
	useEffect(() => {
		if (enterKey !== undefined) markApprovalEnterSeen(enterKey);
	}, [enterKey]);
	const [decided, setDecided] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const enabled = canAnswer && !decided;

	const decide = useCallback(
		async (decision: PermissionDecision) => {
			setError(null);
			setDecided(true);
			try {
				await onDecision(decision);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to answer the permission request");
				setDecided(false);
			}
		},
		[onDecision],
	);

	const cardRootRef = useRef<HTMLDivElement>(null);
	usePermissionHotkeys(cardRootRef, {enabled, persistent: persistentAllow !== null, decide});

	if (decided && hideOnDecision) return null;

	return (
		<ApprovalCardShell
			rootRef={cardRootRef}
			label={"action" in title ? `Permission request: ${title.action}` : "Permission request"}
			footer={footer}
			presentation="card"
			enter={enter}
			body={
				<div className="flex flex-col gap-[10px]">
					<span data-permission-title data-approval-card-title className={APPROVAL_CARD_TITLE}>
						<PermissionTitleText title={title} />
					</span>
					<div className="flex flex-col gap-[12px] empty:hidden">
						{description !== null && <div className={DESCRIPTION_CLASS}>{description}</div>}
						{detail !== null && (
							<div data-permission-detail data-approval-value className={DETAIL_CLASS}>
								{detail}
							</div>
						)}
						{detailNote !== null && <p className={DETAIL_NOTE_CLASS}>{detailNote}</p>}
						{tokenWarning && <TokenWarning />}
						{!canAnswer && <ReadOnlyAnswerHint className="text-footnote text-secondary" />}
						{error && <p className="text-footnote text-extended-pink">{error}</p>}
					</div>
				</div>
			}
			actions={
				<>
					<span className="contents">
						<ApprovalActionButton
							variant="secondary"
							aria-keyshortcuts="Escape"
							disabled={!enabled}
							onClick={() => void decide("deny")}
						>
							<span data-approval-digit="1">Deny</span>
						</ApprovalActionButton>
					</span>
					<div data-approval-allow className="flex min-w-0 flex-wrap items-start gap-2">
						{persistentAllow === null ? (
							<ApprovalActionButton
								variant="primary"
								data-approval-primary=""
								aria-keyshortcuts={toAriaKeyShortcuts("cmd+enter", isMac)}
								disabled={!enabled}
								onClick={() => void decide("allow")}
							>
								<span data-approval-digit="2">Allow once</span>
								<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
							</ApprovalActionButton>
						) : (
							<SplitDropdownButton
								variant="primary"
								className="max-w-full min-w-0"
								groupLabel={PERSISTENT_ALLOW_LABELS[persistentAllow]}
								label={
									<span data-approval-digit="2" data-approval-primary="">
										{PERSISTENT_ALLOW_LABELS[persistentAllow]}
										<span className="sr-only select-none">{`, ${PERSISTENT_ALLOW_SCOPES[persistentAllow]}`}</span>
									</span>
								}
								menuLabel="More allow options"
								items={[
									{label: "Allow once", shortcut: "cmd+enter", onSelect: () => void decide("allow")},
								]}
								disabled={!enabled}
								onPrimaryClick={() => void decide("always")}
							/>
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
 * is swallowed with no action. ⇧⌘⏎ needs a persistent option and focus in the card or the composer.
 */
function usePermissionHotkeys(
	cardRootRef: RefObject<HTMLDivElement | null>,
	{
		enabled,
		persistent,
		decide,
	}: {enabled: boolean; persistent: boolean; decide: (decision: PermissionDecision) => unknown},
) {
	const armedAtRef = useRef<number | null>(null);
	useEffect(() => {
		armedAtRef.current = performance.now();
	}, []);
	useEffect(() => {
		if (!enabled) return undefined;
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
			decide(decision);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, enabled, persistent, decide]);
}

/** Upstream's body classes: the detail block (`Lg`), its footnote (`kg`) and the description line (`Dg`). */
const DETAIL_CLASS =
	"bg-alpha-1 rounded-r4 py-2 px-3 text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]";
const DETAIL_NOTE_CLASS = "text-footnote text-ink-muted select-text break-words [unicode-bidi:plaintext]";
const DESCRIPTION_CLASS =
	"text-body text-secondary select-text break-words max-h-[calc(3*var(--text-body--line-height))] overflow-y-auto [unicode-bidi:plaintext]";

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

/** Upstream's title: the action and meta are their own bidi-isolated spans inside the approval value. */
function PermissionTitleText({title}: {title: PermissionTitle}) {
	if (!("action" in title)) return <span className={TITLE_PART}>{title.heading}</span>;
	return (
		<span className="min-w-0 break-words">
			<span data-approval-value>
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
