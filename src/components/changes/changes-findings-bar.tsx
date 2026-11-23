import {type RefObject, useEffect, useRef} from "react";

import {scrollToFinding} from "../../lib/changes-review";
import type {ReviewFindingStatus} from "../../lib/report-findings";
import type {ReviewFinding} from "../../lib/review-diff";
import {findingCursorIndex, setCurrentReviewFinding, useCurrentReviewFinding} from "../../lib/review-finding-cursor";
import {TOOLBAR_ROVING_OPTIONS, useRovingToolbar} from "../../lib/use-roving-toolbar";
import {ShimmerText} from "../shimmer-text";
import {Spark} from "../spark";
import {cdsButtonClass} from "../ui/cds-button";
import {CDS_BUTTON_DISABLED, CDS_ICON_ONLY_DISABLED} from "../ui/cds-button-disabled";
import {DisabledReason} from "../ui/disabled-reason";
import {Icon} from "../ui/icon";
import {TOOLBAR_FOCUS_RING} from "../ui/toolbar-focus-ring";

/** Upstream `U`: the Changes pane subheader around the bar. */
const SUBHEADER_CLASS = "epitaxy-panel-subheader shrink-0 bg-alpha-1";

/** Upstream cds `Toolbar` (`vv`) with its root focus ring for when focus parks on it. */
const TOOLBAR_CLASS = `flex shrink-0 items-center gap-1 px-[var(--cds-toolbar-pad-inline,0px)] pt-[var(--cds-toolbar-pad-block,0.25rem)] pb-[var(--cds-toolbar-pad-block,0.25rem)] ${TOOLBAR_FOCUS_RING}`;

/** The cds Toolbar's `wrap` title row, holding the lead and trail. */
const WRAP_CLASS =
	"flex min-w-0 flex-1 items-center gap-[4px] min-h-control flex-wrap ps-[calc(0.25rem*var(--cds-rem-scale,1))]";

/** Upstream's live bar: a plain secondary cds Button at the default size. */
const APPLY_CLASS = cdsButtonClass("secondary");

/** Upstream cds Button ghost iconOnly at the default size: an h-control square. */
const ICON_BUTTON_CLASS = `flex h-control aspect-square shrink-0 cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${CDS_BUTTON_DISABLED} ${CDS_ICON_ONLY_DISABLED}`;

function focusVisible(element: Element | null): boolean
{
	try
	{
		return element?.matches(":focus-visible") === true;
	}
	catch
	{
		return false;
	}
}

/**
 * Upstream `Hw`: stepping to an end disables the focused arrow, so hand keyboard focus to the other one once focus
 * has fallen to `<body>` (or into the disabled arrow's reason wrapper).
 */
function handOffFocus(from: RefObject<HTMLButtonElement | null>, to: RefObject<HTMLButtonElement | null>): void
{
	const button = from.current;
	if (button === null || !focusVisible(button)) return;
	const doc = button.ownerDocument;
	setTimeout(() =>
	{
		const active = doc.activeElement;
		if (active === null || active === doc.body || active.contains(button))
			to.current?.focus(
				{
					preventScroll: true,
				},
			);
	}, 0);
}

const NO_STATUSES: Readonly<Record<string, ReviewFindingStatus>> = {};

interface FixCounts
{
	fixing: number;
	/** Settled as "addressed" (Fixed). */
	fixed: number;
	/** Settled either way: "addressed" or "unchanged". */
	settled: number;
	open: number;
}

function countStatuses(
	findings: readonly ReviewFinding[],
	statuses: Readonly<Record<string, ReviewFindingStatus>>,
): FixCounts
{
	let fixing = 0;
	let fixed = 0;
	let settled = 0;
	for (const finding of findings)
	{
		const status = statuses[finding.id] ?? "open";
		if (status === "fixing") fixing += 1;
		else if (status === "addressed" || status === "unchanged")
		{
			settled += 1;
			if (status === "addressed") fixed += 1;
		}
	}
	return {
		fixing,
		fixed,
		settled,
		open: findings.length - fixing - settled,
	};
}

/** Upstream `GT`: the bar's status text. */
function barLabel(applying: boolean, allSettled: boolean, fixed: number, current: number, total: number): string
{
	if (applying) return "Applying fixes…";
	if (allSettled) return fixed > 0 ? "Fixes applied" : "No change needed";
	return `Finding ${current} of ${total}`;
}

/**
 * claude.ai/code's review findings bar (`KT`): the Changes pane subheader over the session's non-dismissed findings.
 * It steps between them without wrapping and closes; its label and action follow the findings' fix statuses —
 * "Applying fixes…" while every unsettled finding is fixing, "Fixes applied" / "No change needed" with Re-run review
 * once all are settled, else "Finding {current} of {total}" with Apply fixes while any is open.
 */
export function ChangesFindingsBar({
	sessionId,
	findings,
	statuses = NO_STATUSES,
	responding = false,
	onApplyFixes,
	onRerunReview,
	onClose,
}: {
	sessionId: string;
	/** The non-dismissed findings, in order. */
	findings: readonly ReviewFinding[];
	/** Fix statuses by finding id; a missing one is "open". */
	statuses?: Readonly<Record<string, ReviewFindingStatus>> | undefined;
	/** The session is responding: shimmers "Applying fixes…" and disables Re-run review. */
	responding?: boolean | undefined;
	onApplyFixes?: (() => void) | undefined;
	onRerunReview?: (() => void) | undefined;
	onClose: () => void;
})
{
	const rootRef = useRef<HTMLDivElement>(null);
	const paneRef = useRef<HTMLElement | null>(null);
	const previousRef = useRef<HTMLButtonElement>(null);
	const nextRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const applyRef = useRef<HTMLButtonElement>(null);
	const rerunRef = useRef<HTMLButtonElement>(null);
	// Upstream `K`: one Re-run per turn, released when the session stops responding.
	const rerunning = useRef(false);
	// Upstream `fK(..., {keyboardOnly: true})`: focus inside the bar arrived by keyboard.
	const keyboardInside = useRef(false);
	const roving = useRovingToolbar(TOOLBAR_ROVING_OPTIONS);
	const currentId = useCurrentReviewFinding(sessionId);
	const total = findings.length;
	const shown = total > 0;
	const index = findingCursorIndex(findings, currentId);
	const arrows = total > 1;
	const counts = countStatuses(findings, statuses);
	const allSettled = shown && counts.settled === total;
	const applying = counts.fixing > 0 && counts.open === 0;
	const apply = onApplyFixes !== undefined && !allSettled && counts.open > 0;
	const rerun = onRerunReview !== undefined && allSettled;
	// Upstream `U`: where focus goes when a control vanishes.
	const heir = arrows ? (index < total - 1 ? nextRef : previousRef) : closeRef;
	const controls = useRef(
		{
			arrows,
			apply,
		},
	);

	useEffect(() =>
	{
		const before = controls.current;
		controls.current =
		{
			arrows,
			apply,
		};
		const vanished = (before.arrows && !arrows) || (before.apply && !apply);
		if (!vanished || !keyboardInside.current) return;
		const doc = rootRef.current?.ownerDocument;
		if (doc?.activeElement === doc?.body)
			heir.current?.focus(
				{
					preventScroll: true,
				},
			);
	}, [arrows, apply, heir]);

	useEffect(() =>
	{
		if (!responding) rerunning.current = false;
	}, [responding]);

	// Upstream `qa`: the bar unmounting after keyboard focus inside returns focus to the diff pane body.
	useEffect(() =>
	{
		if (shown)
		{
			paneRef.current = rootRef.current?.parentElement ?? null;
			return;
		}
		const pane = paneRef.current;
		if (pane === null || !keyboardInside.current) return;
		keyboardInside.current = false;
		const doc = pane.ownerDocument;
		setTimeout(() =>
		{
			if (doc.activeElement === doc.body)
				pane.querySelector<HTMLElement>("[data-diff-pane-body]")?.focus(
					{
						preventScroll: true,
					},
				);
		}, 0);
	}, [shown]);

	if (!shown) return null;

	function step(to: number): void
	{
		const target = findings[to];
		if (target === undefined) return;
		setCurrentReviewFinding(sessionId, target.id);
		scrollToFinding(sessionId, target);
	}

	const previousDisabled = index <= 0;
	const nextDisabled = index >= total - 1;

	function handFocusOn(from: RefObject<HTMLButtonElement | null>): void
	{
		// Upstream: a keyboard click hands focus on to `U`.
		if (!focusVisible(from.current)) return;
		from.current?.blur();
		heir.current?.focus();
	}

	return (
		<div
			ref={rootRef}
			onFocus={(event) =>
			{
				keyboardInside.current = focusVisible(event.target);
			}}
			onBlur={(event) =>
			{
				const next = event.relatedTarget;
				if (next !== null && !event.currentTarget.contains(next)) keyboardInside.current = false;
			}}
			className={SUBHEADER_CLASS}
		>
			{/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- upstream's root has no tabindex; the roving hook keeps one item at 0 and adds 0 to the root only while focus parks on it */}
			<div
				ref={roving.ref}
				role="toolbar"
				aria-label="Code review controls"
				data-cds="Toolbar"
				onFocus={roving.onFocus}
				onKeyDown={roving.onKeyDown}
				className={TOOLBAR_CLASS}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
					<div className={WRAP_CLASS}>
						<div className="flex h-control items-center gap-1 self-start">
							<Spark size={16} className="mx-0.5" />
							<span
								role="status"
								aria-live="polite"
								className="text-body text-muted-as-secondary whitespace-nowrap tabular-nums"
							>
								<ShimmerText active={applying && responding} variant="secondary" className="block">
									{barLabel(applying, allSettled, counts.fixed, index + 1, total)}
								</ShimmerText>
							</span>
						</div>
						<div className="flex min-w-min flex-1 flex-wrap-reverse items-center justify-end gap-1">
							{rerun && (
								<button
									ref={rerunRef}
									type="button"
									className={APPLY_CLASS}
									disabled={responding}
									onClick={() =>
									{
										if (rerunning.current) return;
										rerunning.current = true;
										handFocusOn(rerunRef);
										onRerunReview();
									}}
								>
									Re-run review
								</button>
							)}
							{apply && (
								<button
									ref={applyRef}
									type="button"
									className={APPLY_CLASS}
									onClick={() =>
									{
										handFocusOn(applyRef);
										onApplyFixes();
									}}
								>
									Apply fixes
								</button>
							)}
							<div className="flex items-center gap-1">
								{arrows && (
									<>
										<DisabledReason reason={previousDisabled ? "Previous finding" : null}>
											<button
												ref={previousRef}
												type="button"
												aria-label="Previous finding"
												disabled={previousDisabled}
												className={ICON_BUTTON_CLASS}
												onClick={() =>
												{
													if (index - 1 === 0) handOffFocus(previousRef, nextRef);
													step(index - 1);
												}}
											>
												<Icon name="ArrowUp" size="auto" aria-hidden="true" />
											</button>
										</DisabledReason>
										<DisabledReason reason={nextDisabled ? "Next finding" : null}>
											<button
												ref={nextRef}
												type="button"
												aria-label="Next finding"
												disabled={nextDisabled}
												className={ICON_BUTTON_CLASS}
												onClick={() =>
												{
													if (index + 1 === total - 1) handOffFocus(nextRef, previousRef);
													step(index + 1);
												}}
											>
												<Icon name="ArrowDown" size="auto" aria-hidden="true" />
											</button>
										</DisabledReason>
									</>
								)}
								<button
									ref={closeRef}
									type="button"
									aria-label="Close findings bar"
									className={ICON_BUTTON_CLASS}
									onClick={onClose}
								>
									<Icon name="X" size="auto" aria-hidden="true" />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
