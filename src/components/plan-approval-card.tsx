import {MessageCircle, X} from "lucide-react";
import
{
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import
{
	acknowledgeApproval,
	clearApprovalAnswered,
	markApprovalAnswered,
	useApprovalAnswered,
} from "../lib/answered-approvals";
import {holdAnswered, releaseAnswered} from "../lib/answered-sessions";
import {APPROVAL_ARM_GRACE_MS, dockKeyAllowed, elementOffscreen} from "../lib/dock-keys";
import
{
	PLAN_ACCEPT_LABEL,
	PLAN_BACK_LABEL,
	PLAN_DELETE_COMMENT_LABEL,
	PLAN_FEEDBACK_LABEL,
	PLAN_FEEDBACK_PLACEHOLDER,
	PLAN_FEEDBACK_WITH_COMMENTS_PLACEHOLDER,
	PLAN_REJECT_LABEL,
	PLAN_REVISE_LABEL,
	PLAN_REVISE_OPEN_LABEL,
	planCommentCountLabel,
	planKeyAction,
	planPrimaryAccept,
	type PlanDecision,
	type PlanKeyAction,
	type PlanDialog,
} from "../lib/plan-approval";
import
{
	clearPlanComments,
	formatPlanFeedback,
	removePlanComment,
	restorePlanComments,
	usePlanComments,
} from "../lib/plan-comments";
import {clearUnsentPlan, getUnsentPlan, setUnsentPlan} from "../lib/plan-unsent";
import {usePhoneSheet} from "../lib/use-phone-sheet";
import {ApprovalActionButton, STACK_ACTIONS} from "./approval-card";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {Shortcut} from "./ui/shortcut";

const HINT_CLASS = "text-footnote text-secondary";
/**
 * Upstream's plan `epitaxy-approval-actions` row (`[&>div]:grow` on its two groups). At `@container (width <= 420px)`
 * the row and each group turn to columns and every button takes the full width.
 */
const PLAN_ACTIONS_CLASS = `flex flex-wrap justify-between gap-x-1 gap-y-2 [&>span]:grow ${STACK_ACTIONS} @max-[420px]:[&>span]:flex-col @max-[420px]:[&>span]:items-stretch @max-[420px]:[&_button]:w-full`;

/** Upstream's cds TextArea (`bg-fill-field shadow-field-ring px-md py-sm rounded`): bare rounded (6px compact / 8px comfortable), 5% fill, field ring, accent focus shadow. */
const FEEDBACK_CLASS =
	"w-full resize-none rounded bg-alpha-1 px-md py-sm text-body text-primary placeholder:text-ink-muted shadow-[inset_0_0_0_1px_var(--color-border)] outline-none focus-visible:shadow-[var(--focus-shadow)] hover:not-focus:shadow-[inset_0_0_0_1px_var(--color-strong)]";

/** Where a plan key may act: anywhere a docked card key may, plus ⇧⌘⏎ from a composer holding a draft (upstream lets it through). */
function planKeyAllowed(target: EventTarget | null, action: PlanKeyAction): boolean
{
	if (dockKeyAllowed(target)) return true;
	return (
		action.kind === "accept" &&
		action.mode === "default" &&
		target instanceof HTMLTextAreaElement &&
		target.closest('[data-focus-region="composer"]') !== null
	);
}

/** Upstream's cds ghost icon-only Button (24px control) for a comment row's Delete. */
const DELETE_COMMENT_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * Upstream's list of the session's Plan pane comments above the Revise box:
 * each row reopens the Plan pane and has its own Delete, then an sr-only note
 * of how many will be sent.
 */
function PlanCommentList({sessionId}: {sessionId: string})
{
	const comments = usePlanComments(sessionId);
	const host = useOptionalPaneHost();
	return (
		<ul className="-m-2 flex max-h-[176px] scroll-p-2 flex-col gap-1 overflow-y-auto p-2">
			{comments.map((c) => (
				<li key={c.id} className="flex items-center gap-0.5 rounded-r6 bg-alpha-1 pe-1.25 hover:bg-alpha-2">
					<button
						type="button"
						onClick={() =>
						{
							host?.openPane("plan");
						}}
						className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-r6 p-1.25 text-start hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
					>
						<span className="flex items-center gap-0.75 text-caption text-ink-muted">
							<MessageCircle aria-hidden="true" className="size-3 shrink-0" />
							<span className="truncate">{c.selectedText}</span>
						</span>
						<span className="text-body text-primary">{c.comment}</span>
					</button>
					<button
						type="button"
						aria-label={PLAN_DELETE_COMMENT_LABEL}
						className={DELETE_COMMENT_CLASS}
						onMouseDown={(event) =>
						{
							event.preventDefault();
						}}
						onClick={() =>
						{
							removePlanComment(sessionId, c.id);
						}}
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</li>
			))}
			<li className="sr-only">{planCommentCountLabel(comments.length)}</li>
		</ul>
	);
}

type DialogState =
	|
	  {
			kind: "loading";
	  }
	|
	  {
			kind: "ready";
			dialog: PlanDialog;
	  }
	|
	  {
			kind: "unavailable";
	  };

/** Upstream's approval presentation: the inline transcript "card", or the composer "dock". */
export type PlanApprovalPlacement = "card" | "dock";

/**
 * Upstream's chord arming (`He`/`er`): the 400ms grace starts at mount, and
 * again whenever an inline card scrolls into view or the window regains focus.
 */
function useApprovalArming(
	rootRef: RefObject<HTMLElement | null>,
	placement: PlanApprovalPlacement,
): RefObject<number | null>
{
	const armedAt = useRef<number | null>(null);
	useEffect(() =>
	{
		const arm = () =>
		{
			armedAt.current = performance.now();
		};
		arm();
		const onVisibility = () =>
		{
			if (document.visibilityState === "visible") arm();
		};
		window.addEventListener("focus", arm);
		document.addEventListener("visibilitychange", onVisibility);
		const root = rootRef.current;
		const observer =
			placement === "card" && root !== null && typeof IntersectionObserver !== "undefined"
				? new IntersectionObserver((entries) =>
					{
						if (entries.some((entry) => entry.isIntersecting)) arm();
					})
				: null;
		if (observer !== null && root !== null) observer.observe(root);
		return () =>
		{
			window.removeEventListener("focus", arm);
			document.removeEventListener("visibilitychange", onVisibility);
			observer?.disconnect();
		};
	}, [rootRef, placement]);
	return armedAt;
}

function PlanApprovalActions({
	sessionId,
	toolUseId,
	dialog,
	decide,
	placement,
}: {
	sessionId: string;
	toolUseId: string;
	dialog: PlanDialog;
	decide: (decision: PlanDecision) => Promise<void>;
	placement: PlanApprovalPlacement;
})
{
	// A card whose answer was refused, or whose Revise draft was left, while it was unmounted comes back as it was.
	const [restored] = useState(() => getUnsentPlan(sessionId, toolUseId));
	const [revising, setRevising] = useState(restored?.revising ?? false);
	// Upstream refocuses a restored box only after a failed send; a draft left behind waits for the user.
	const [focusOnOpen, setFocusOnOpen] = useState(restored?.error !== null);
	const hasComments = usePlanComments(sessionId).length > 0;
	// Upstream: any comment holds the card in Revise by itself, without taking focus.
	const showRevise = revising || hasComments;
	// Upstream's answered set: the card hides at the click, with no busy state, and returns if the answer fails.
	const answered = useApprovalAnswered(sessionId, toolUseId);
	const [error, setError] = useState<string | null>(restored?.error ?? null);
	const feedback = useRef(restored?.feedback ?? "");
	const rootRef = useRef<HTMLDivElement>(null);
	const armedAt = useApprovalArming(rootRef, placement);
	const sending = useRef(false);
	const reviseShown = useRef(showRevise);
	reviseShown.current = showRevise;
	const primary = planPrimaryAccept(dialog);
	const docked = placement === "dock";

	// Upstream's `unsentFeedback`: a Revise draft outlives the card, so a remount brings it back.
	useEffect(
		() => () =>
		{
			if (sending.current) return;
			if (reviseShown.current && feedback.current.trim() !== "")
			{
				setUnsentPlan(
					sessionId,
					toolUseId,
					{
						revising: true,
						feedback: feedback.current,
						error: null,
					},
				);
			}
			else
			{
				clearUnsentPlan(sessionId, toolUseId);
			}
		},
		[sessionId, toolUseId],
	);

	/** Any decision takes the session's comments; a refused answer puts them back. */
	const send = useCallback(
		async (
			decision: PlanDecision | ((comments: ReturnType<typeof clearPlanComments>) => PlanDecision),
			sentRevising: boolean,
		) =>
		{
			setError(null);
			const comments = clearPlanComments(sessionId);
			const sentFeedback = feedback.current;
			sending.current = true;
			markApprovalAnswered(sessionId, toolUseId);
			holdAnswered(sessionId, toolUseId);
			try
			{
				await decide(typeof decision === "function" ? decision(comments) : decision);
				clearUnsentPlan(sessionId, toolUseId);
				acknowledgeApproval(sessionId, toolUseId, "ExitPlanMode");
			}
			catch (err)
			{
				const message = err instanceof Error ? err.message : "Failed to answer the plan";
				sending.current = false;
				// Saved before the mark clears, so a card the session page dropped remounts with it.
				setUnsentPlan(
					sessionId,
					toolUseId,
					{
						revising: sentRevising,
						feedback: sentFeedback,
						error: message,
					},
				);
				releaseAnswered(sessionId);
				restorePlanComments(sessionId, comments);
				clearApprovalAnswered(sessionId, toolUseId);
				setError(message);
			}
		},
		[decide, sessionId, toolUseId],
	);

	const closeFeedback = useCallback(() =>
	{
		feedback.current = "";
		setRevising(false);
	}, []);

	const openRevise = useCallback(() =>
	{
		setFocusOnOpen(true);
		setRevising(true);
	}, []);

	useEffect(() =>
	{
		if (showRevise || answered) return undefined;
		function onKeyDown(event: KeyboardEvent)
		{
			if (event.defaultPrevented) return;
			const action = planKeyAction(event, dialog);
			if (action === null || !planKeyAllowed(event.target, action)) return;
			// Upstream's inline card yields its keys while it is scrolled away (`VS`).
			const root = rootRef.current;
			const card = root?.closest<HTMLElement>("[data-approval-card-root]") ?? root;
			if (placement === "card" && card !== null && elementOffscreen(card)) return;
			// Upstream withholds an accept chord that lands within 400ms of the card arriving or re-arming.
			const armed = armedAt.current ?? performance.now();
			if (action.kind === "accept" && performance.now() - armed < APPROVAL_ARM_GRACE_MS) return;
			event.preventDefault();
			event.stopPropagation();
			if (action.kind === "revise") openRevise();
			else void send(action, false);
		}
		window.addEventListener("keydown", onKeyDown, true);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [showRevise, answered, dialog, send, placement, armedAt, openRevise]);

	const reviseWithFeedback = () =>
	{
		// Keep the box (and its text) up while the comments are taken, in case the answer is refused.
		setRevising(true);
		void send(
			(comments) => (
			{
				kind: "reject",
				feedback: formatPlanFeedback(comments, feedback.current),
			}),
			true,
		);
	};

	if (answered) return null;

	return (
		<div ref={rootRef} data-plan-approval className="flex flex-col gap-2 pt-1">
			{hasComments && <PlanCommentList sessionId={sessionId} />}
			{showRevise && (
				<textarea
					// Opened by the user's own click or Esc, taking focus is expected; opened by comments, it waits.
					// oxlint-disable-next-line jsx-a11y/no-autofocus
					autoFocus={revising && focusOnOpen}
					rows={3}
					defaultValue={feedback.current}
					aria-label={PLAN_FEEDBACK_LABEL}
					placeholder={hasComments ? PLAN_FEEDBACK_WITH_COMMENTS_PLACEHOLDER : PLAN_FEEDBACK_PLACEHOLDER}
					className={FEEDBACK_CLASS}
					onChange={(event) =>
					{
						feedback.current = event.target.value;
					}}
					onKeyDown={(event) =>
					{
						if (event.nativeEvent.isComposing) return;
						if (event.key === "Escape")
						{
							event.preventDefault();
							if (!hasComments) closeFeedback();
						}
						else if (event.key === "Enter" && !event.shiftKey)
						{
							event.preventDefault();
							reviseWithFeedback();
						}
					}}
				/>
			)}
			{/* Upstream's `epitaxy-approval-actions`: the reject pair at the start, the accepts at the end; in a
			    ≤420px container both groups stack and every button goes full width. */}
			<div data-plan-actions className={PLAN_ACTIONS_CLASS}>
				{showRevise ? (
					<>
						{hasComments ? (
							<span className="@max-[420px]:hidden" />
						) : (
							<ApprovalActionButton variant="secondary" onClick={closeFeedback}>
								{PLAN_BACK_LABEL}
							</ApprovalActionButton>
						)}
						<ApprovalActionButton variant="primary" onClick={reviseWithFeedback}>
							{PLAN_REVISE_LABEL}
						</ApprovalActionButton>
					</>
				) : (
					<>
						<span className="flex gap-2">
							<ApprovalActionButton
								variant="secondary"
								onClick={() =>
									void send(
										{
											kind: "reject",
											feedback: "",
										},
										false,
									)
								}
							>
								{PLAN_REJECT_LABEL}
							</ApprovalActionButton>
							<ApprovalActionButton variant="secondary" onClick={openRevise}>
								{PLAN_REVISE_OPEN_LABEL}
								{/* Upstream shows the Revise… and manual Accept keycaps only in the dock. */}
								{docked && <Shortcut keys="esc" className="pointer-coarse:hidden" />}
							</ApprovalActionButton>
						</span>
						<span
							data-plan-accept-group=""
							className="flex flex-wrap justify-end gap-2"
							onKeyDownCapture={swallowAcceptRepeat}
						>
							{/* Upstream's arming group around the accepts (`data-approval-allow`). */}
							<span className="contents" data-approval-allow="">
								{primary !== null && primary !== "default" && dialog.manual && (
									<ApprovalActionButton
										variant="secondary"
										onClick={() =>
											void send(
												{
													kind: "accept",
													mode: "default",
												},
												false,
											)
										}
									>
										{PLAN_ACCEPT_LABEL.default}
										{docked && (
											<Shortcut keys="cmd+shift+enter" className="pointer-coarse:hidden" />
										)}
									</ApprovalActionButton>
								)}
								{primary !== null && (
									<ApprovalActionButton
										variant="primary"
										onClick={() =>
											void send(
												{
													kind: "accept",
													mode: primary,
												},
												false,
											)
										}
									>
										{PLAN_ACCEPT_LABEL[primary]}
										<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
									</ApprovalActionButton>
								)}
							</span>
						</span>
					</>
				)}
			</div>
			{error !== null && (
				<p data-plan-error className="text-footnote text-extended-pink">
					{error}
				</p>
			)}
		</div>
	);
}

/**
 * Upstream's accept-group capture guard (`hh`): a held Enter or Space, or an Enter with any modifier, never
 * reaches a focused accept button's native activation, unless it is inside a menu.
 */
function swallowAcceptRepeat(event: ReactKeyboardEvent<HTMLElement>)
{
	const held = event.repeat && (event.key === "Enter" || event.key === " ");
	const chord = event.key === "Enter" && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
	if (!held && !chord) return;
	if (event.target instanceof Element && event.target.closest('[role="menu"]') !== null) return;
	event.preventDefault();
	event.stopPropagation();
}

/**
 * Upstream's plan card effect: open the Plan pane once per mount (so a remount
 * reopens it), only where side panes exist (never on a phone, where upstream
 * passes no `onOpenPlan`) and only while the tab is visible.
 */
function useAutoOpenPlanPane(enabled: boolean): void
{
	const host = useOptionalPaneHost();
	const phone = usePhoneSheet();
	const opened = useRef(false);
	useEffect(() =>
	{
		if (!enabled || opened.current || host === null || phone || document.visibilityState !== "visible") return;
		opened.current = true;
		host.openPane("plan");
	}, [enabled, host, phone]);
}

/**
 * Upstream's plan approval actions under a pending ExitPlanMode: [Reject]
 * [Revise… esc] … [Accept ⇧⌘⏎] [Accept and <mode> ⌘⏎], and Revise's "What
 * should change?" box with [Back] [Revise]. Choices type into the CLI's own
 * plan dialog in the session's live pane, offering only what that dialog has
 * on screen; with no writable pane, or no dialog showing, it is read-only.
 */
export function PlanApprovalCard({
	toolUseId,
	plan,
	placement = "dock",
	autoOpenPlan = true,
}: {
	toolUseId: string;
	plan: PlanApprovalContextValue;
	placement?: PlanApprovalPlacement;
	/** False for a planless ExitPlanMode, which has no plan to open. */
	autoOpenPlan?: boolean;
})
{
	const {sessionId, answerRoute, loadDialog, decide} = plan;
	useAutoOpenPlanPane(autoOpenPlan);
	const live = answerRoute === "live-pane";
	const [state, setState] = useState<DialogState>(
		{
			kind: "loading",
		},
	);

	useEffect(() =>
	{
		if (!live) return undefined;
		let current = true;
		setState(
			{
				kind: "loading",
			},
		);
		loadDialog().then(
			(dialog) =>
			{
				if (current)
					setState(
						{
							kind: "ready",
							dialog,
						},
					);
			},
			() =>
			{
				if (current)
					setState(
						{
							kind: "unavailable",
						},
					);
			},
		);
		return () =>
		{
			current = false;
		};
	}, [live, loadDialog, toolUseId]);

	if (!live || state.kind === "unavailable") return <ReadOnlyAnswerHint className={HINT_CLASS} />;
	if (state.kind === "loading") return null;
	return (
		<PlanApprovalActions
			sessionId={sessionId}
			toolUseId={toolUseId}
			dialog={state.dialog}
			decide={decide}
			placement={placement}
		/>
	);
}
