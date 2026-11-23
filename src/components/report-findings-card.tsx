import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react";

import {clearChangesReview, formatApplyFindingsPrompt} from "../lib/changes-review";
import {scrollToDiffLine} from "../lib/diff-scroll-target";
import
{
	type ParsedFinding,
	type ReviewFindingStatus,
	findingLocation,
	findingRowSummary,
	groupFindingsByFile,
	parseReportFindings,
	reviewCardState,
	reviewProgressAnnouncement,
	reviewSummaryText,
} from "../lib/report-findings";
import {setCurrentReviewFinding} from "../lib/review-finding-cursor";
import
{
	consumeAutoOpen,
	markReviewFindingsFixing,
	reopenReviewFindings,
	reviewFindingsSnapshot,
	setReviewFindings,
	toStoreFindings,
	unanchoredFindingIds,
	useReviewFindingsState,
} from "../lib/review-findings-store";
import type {ToastOptions} from "./toast-context";
import type {ClientToolCall} from "./tool-renderers/types";
import {cdsButtonClass} from "./ui/cds-button";
import {CDS_BUTTON_DISABLED} from "./ui/cds-button-disabled";
import {Icon} from "./ui/icon";

/** Upstream `iC`'s root: `my-[6px]` + `Nl` (summary card) + the focus ring. */
export const REVIEW_CARD_CLASS =
	"my-[6px] flex w-full select-text flex-col gap-1 rounded-lg px-2 py-1 shadow-[inset_0_0_0_1px_var(--color-border)] focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus";
/** Upstream `vl` with `flex-wrap`. */
const HEADER_CLASS = "-me-0.5 flex min-w-0 items-center gap-1 flex-wrap";
/** Upstream `Dl`: the hairline under the header, bleeding to the card's inset ring. */
const DIVIDER_CLASS = "-mx-[7px] h-px shrink-0 bg-alpha-2";
/** Upstream `Ru` (`max-h-[400px] overflow-y-auto`) with the card's grid. */
const REGION_CLASS =
	"max-h-[400px] overflow-y-auto -mx-1 grid min-w-0 grid-cols-[minmax(0,max-content)_1fr] gap-y-[3px] px-1";
const FILE_GROUP_CLASS = "col-span-full grid min-w-0 grid-cols-subgrid";
const FILE_HEADER_CLASS = "col-span-full flex min-w-0 pt-[3px] text-body font-semibold text-secondary";
/** Upstream `ps-[calc(var(--cds-pad-lg)+var(--cds-pad-xs))]`: 12px + 4px. */
const FILE_LIST_CLASS = "col-span-full grid min-w-0 grid-cols-subgrid ps-4";
/** Upstream `yl` with the row's subgrid. */
const ROW_BUTTON_CLASS =
	"-mx-1 flex min-w-0 grow items-start gap-3 rounded-r4 px-1 py-1 text-start focus-visible:outline-hidden hover:bg-fill-ghost-hover hide-focus-ring focus-visible:shadow-focus col-span-full grid grid-cols-subgrid";
/** Upstream `nC`. */
const LINE_CELL_CLASS = "flex h-[1lh] items-center text-body";
const EXPANDED_CLASS = "col-span-full flex min-w-0 flex-col gap-[3px] pb-1.5";

/** Upstream's cds `data-size="xxs"` scope pins --cds-radius to 5px at every density. */
const XXS_RADIUS = "[--upstream-radius:0.3125rem]";
/** Upstream cds Button `variant="secondary" size="xxs"` (20px, 6px pad) with the card's ink. */
export const WALK_THROUGH_CLASS = `${cdsButtonClass("secondary", "sm")} ${XXS_RADIUS} shrink-0 text-footnote`;
export const VIEW_IN_CHANGES_CLASS = `${cdsButtonClass("secondary", "sm")} ${XXS_RADIUS} ms-auto shrink-0 text-footnote`;
/** Upstream cds Button `variant="ghost" size="xxs"` with `Ao` (muted ink) and the footnote size. */
const GHOST_XXS_CLASS = `relative inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--upstream-radius)] ${XXS_RADIUS} whitespace-nowrap select-none px-1.5 font-control-regular hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${CDS_BUTTON_DISABLED} text-muted-as-secondary hover:text-primary text-footnote shrink-0`;

/**
 * Upstream cds `Badge size="xs"` pill with `l5`'s tints: the xs scope pins --cds-h-control-nested to 18px at every
 * density, so the full pill radius is 9px; the transparent 1px border sits inside the 6px pad.
 */
const BADGE_BASE_CLASS =
	"inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-solid border-transparent px-1.5 font-sans text-[11px] leading-[14px] font-medium";
const BADGE_VARIANT_CLASS =
{
	neutral: "bg-fill-ghost-hover text-secondary",
	success: "bg-tint-green text-tint-green",
	warning: "bg-tint-yellow text-warning",
	danger: "bg-tint-red text-danger",
} as const;

type BadgeVariant = keyof typeof BADGE_VARIANT_CLASS;
type AnchorState = "anchored" | "unanchored" | "unavailable";
type OpenSource = "cta" | "row" | "auto";

/** Upstream `tC`: expanded rows, kept across remounts as `{session}:{tool}:{index}`. */
const expandedRows = new Set<string>();

function Badge({variant, className, children}: {variant: BadgeVariant; className?: string; children: ReactNode})
{
	return (
		<span
			data-cds="Badge"
			data-size="xs"
			className={`${BADGE_BASE_CLASS} ${BADGE_VARIANT_CLASS[variant]}${className === undefined ? "" : ` ${className}`}`}
		>
			{children}
		</span>
	);
}

/** Upstream `rC`'s badge, first match wins. */
function FindingBadge({finding, status}: {finding: ParsedFinding; status: ReviewFindingStatus | undefined})
{
	if (status === "addressed") return <Badge variant="success">Fixed</Badge>;
	if (status === undefined || status === "open")
	{
		if (finding.verdict === "CONFIRMED") return <Badge variant="danger">Confirmed</Badge>;
		if (finding.verdict === "PLAUSIBLE") return <Badge variant="warning">Plausible</Badge>;
		if (finding.category !== undefined)
			return (
				<Badge variant="neutral" className="max-w-[7rem]">
					<span className="truncate">{finding.category}</span>
				</Badge>
			);
		return <Badge variant="neutral">Unverified</Badge>;
	}
	const label = status === "fixing" ? "Fixing…" : status === "unchanged" ? "No change needed" : "Dismissed";
	return <Badge variant="neutral">{label}</Badge>;
}

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

/** Upstream `rC`: one finding as a disclosure row. */
function FindingRow({
	finding,
	status,
	rowKey,
	anchorState,
	onView,
}: {
	finding: ParsedFinding;
	status: ReviewFindingStatus | undefined;
	rowKey: string;
	anchorState: AnchorState;
	onView: () => void;
})
{
	const [expanded, setExpanded] = useState(() => expandedRows.has(rowKey));
	const open = status === undefined || status === "open";
	const live = open || status === "fixing";
	const location = findingLocation(finding);
	return (
		<li className={`col-span-full grid min-w-0 grid-cols-subgrid${open ? "" : " opacity-70"}`}>
			<button
				type="button"
				aria-expanded={expanded}
				className={ROW_BUTTON_CLASS}
				onClick={() =>
				{
					if (expanded) expandedRows.delete(rowKey);
					else expandedRows.add(rowKey);
					setExpanded(!expanded);
				}}
			>
				<span className={`min-w-0 gap-[3px] ${LINE_CELL_CLASS}`}>
					<FindingBadge finding={finding} status={status} />
				</span>
				<span className="flex min-w-0 flex-1 items-start gap-[3px]">
					<span
						className={`min-w-0 flex-1 text-body text-secondary ${expanded && finding.short_summary !== undefined ? "break-words" : "truncate"}`}
					>
						<span className="sr-only">{`${location}. `}</span>
						{findingRowSummary(finding)}
					</span>
					<span className={`shrink-0 text-secondary ${LINE_CELL_CLASS}`}>
						<Icon
							name="CaretRight"
							customSize={14}
							rotate={expanded ? 90 : 0}
							className="transition-transform duration-fast motion-reduce:transition-none"
						/>
					</span>
				</span>
			</button>
			{expanded && (
				<div className={EXPANDED_CLASS}>
					<span className="break-words whitespace-pre-wrap text-body text-primary">{finding.summary}</span>
					{finding.failure_scenario !== undefined && (
						<span className="break-words whitespace-pre-wrap text-body text-secondary">
							{finding.failure_scenario}
						</span>
					)}
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="flex min-w-0 text-footnote text-secondary" title={location}>
							<span className="truncate">{finding.file}</span>
							{finding.line !== undefined && (
								<span className="shrink-0 font-medium text-primary">{`:${finding.line}`}</span>
							)}
						</span>
						{live && anchorState === "anchored" && (
							<button type="button" className={VIEW_IN_CHANGES_CLASS} onClick={onView}>
								View in Changes
							</button>
						)}
						{live && anchorState === "unanchored" && (
							<Badge variant="neutral" className="ms-auto">
								Not in the current diff
							</Badge>
						)}
					</span>
				</div>
			)}
		</li>
	);
}

export interface ReportFindingsCardProps
{
	call: ClientToolCall;
	sessionId: string;
	/** Settled, non-fix-report ReportFindings call ids in transcript order (upstream `_j`). */
	settledIds: readonly string[];
	/** Opens the Changes pane; null when there is no pane host (upstream `hasSidePanes` false). */
	openChanges: ((options?: {unprompted: true}) => void) | null;
	/** Sends to the session's live terminal; null sends through the chat input instead. */
	send: ((text: string) => unknown) | null;
	/** Inserts into the chat input (upstream `onPrefillComposer`); false when no input is mounted. */
	onPrefillComposer: (text: string) => boolean;
	/** The session is mid-turn (upstream `gs`). */
	responding: boolean;
	toast: ((options: ToastOptions) => void) | null;
	/** Drawn when the input does not parse (upstream `fallback`). */
	fallback: ReactNode;
}

/**
 * claude.ai/code's transcript "Code review" card (`iC`, c3fef5c6f) for a settled `/code-review` ReportFindings call:
 * a header with the effort and count, Apply fixes / Re-run review and Walk through in Changes on the latest review,
 * and the findings grouped by file as disclosure rows. Walking through seeds the Changes pane's findings.
 */
export function ReportFindingsCard({
	call,
	sessionId,
	settledIds,
	openChanges,
	send,
	onPrefillComposer,
	responding,
	toast,
	fallback,
}: ReportFindingsCardProps)
{
	const rootRef = useRef<HTMLDivElement>(null);
	const walkRef = useRef<HTMLButtonElement>(null);
	const applyRef = useRef<HTMLButtonElement>(null);
	const rerunRef = useRef<HTMLButtonElement>(null);
	const statusRef = useRef<HTMLSpanElement>(null);
	const keyboardInside = useRef(false);
	const parsed = useMemo(() => parseReportFindings(call.input), [call.input]);
	const [createdAt] = useState(() => Date.now());
	const findings = useMemo(
		() => (parsed === undefined ? [] : toStoreFindings(call.id, parsed, createdAt)),
		[parsed, call.id, createdAt],
	);
	const store = useReviewFindingsState();
	const statuses = store.findingStatusBySession[sessionId] ?? NO_STATUSES;
	const count = findings.length;
	const canOpen = openChanges !== null && count > 0;
	const latest = settledIds.at(-1);
	const isLatest = latest === undefined || call.id === latest;
	const ids = findings.map((finding) => finding.id);
	const state = reviewCardState(ids, statuses);
	const fixing = ids.filter((id) => statuses[id] === "fixing").length;
	const announcement = reviewProgressAnnouncement(fixing, state);
	const unanchored = unanchoredFindingIds(sessionId);
	const rowsAvailable = canOpen && isLatest;
	const seeded = store.seededToolIdsBySession[sessionId] ?? NO_IDS;
	const latestAtActivation = store.latestSettledAtActivationBySession[sessionId];

	// Upstream `v`: Walk through, else Re-run, else the card itself.
	const focusFallback = useCallback(() =>
	{
		const walk = walkRef.current;
		if (walk !== null && !walk.disabled)
		{
			walk.focus();
			return;
		}
		const rerun = rerunRef.current;
		if (rerun !== null && !rerun.disabled)
		{
			rerun.focus();
			return;
		}
		rootRef.current?.focus();
	}, []);

	const openFindings = useCallback(
		(index: number, source: OpenSource) =>
		{
			if (openChanges === null) return;
			const statusNow = reviewFindingsSnapshot().findingStatusBySession[sessionId] ?? NO_STATUSES;
			const open = findings.filter((finding) => statusNow[finding.id] !== "dismissed");
			const clicked = findings[index];
			const target = open.find((finding) => finding.id === clicked?.id) ?? open[0];
			if (target === undefined) return;
			clearChangesReview(sessionId);
			setReviewFindings(
				sessionId,
				findings,
				{
					level: parsed?.level,
					toolId: call.id,
					latestSettledToolId: latest,
				},
			);
			setCurrentReviewFinding(sessionId, target.id);
			scrollToDiffLine(
				sessionId,
				target.filePath,
				{
					fuzzy: true,
					anchor:
					{
						side: target.side,
						line: target.endLine,
					},
				},
			);
			if (source === "auto")
				openChanges(
					{
						unprompted: true,
					},
				);
			else openChanges();
		},
		[openChanges, sessionId, findings, parsed?.level, call.id, latest],
	);

	// Upstream's auto-open: after a review was walked through, the next settled review opens the pane by itself.
	useEffect(() =>
	{
		if (
			call.id !== latest ||
			latestAtActivation === undefined ||
			latest === latestAtActivation ||
			!settledIds.includes(latestAtActivation) ||
			seeded.includes(call.id)
		)
			return;
		if (state !== "actionable" && state !== "applying")
		{
			consumeAutoOpen(sessionId, latest);
			return;
		}
		openFindings(0, "auto");
	}, [call.id, latest, latestAtActivation, settledIds, seeded, state, sessionId, openFindings]);

	// Upstream `oe`: whether focus inside the card arrived by keyboard.
	useEffect(() =>
	{
		const root = rootRef.current;
		if (root === null) return undefined;
		function onFocusIn(event: FocusEvent)
		{
			keyboardInside.current = focusVisible(event.target instanceof Element ? event.target : null);
		}
		function onFocusOut(event: FocusEvent)
		{
			const next = event.relatedTarget;
			if (next instanceof Node && !root?.contains(next)) keyboardInside.current = false;
		}
		root.addEventListener("focusin", onFocusIn);
		root.addEventListener("focusout", onFocusOut);
		return () =>
		{
			root.removeEventListener("focusin", onFocusIn);
			root.removeEventListener("focusout", onFocusOut);
		};
	}, []);

	// A newer review demoting this card takes its header buttons; keyboard focus moves to the card.
	const wasLatest = useRef(isLatest);
	useEffect(() =>
	{
		const demoted = wasLatest.current && !isLatest;
		wasLatest.current = isLatest;
		if (demoted && keyboardInside.current) focusFallback();
	}, [isLatest, focusFallback]);

	// A state change that drops focus to <body> hands it on.
	const lastState = useRef(state);
	useEffect(() =>
	{
		const changed = lastState.current !== state;
		lastState.current = state;
		const doc = rootRef.current?.ownerDocument;
		if (changed && doc !== undefined && keyboardInside.current && doc.activeElement === doc.body) focusFallback();
	}, [state, focusFallback]);

	// Upstream's live region: the first value is not announced; each change clears, then speaks after 50ms.
	const spoken = useRef<string | null>(null);
	useEffect(() =>
	{
		const region = statusRef.current;
		if (region === null || spoken.current === announcement) return undefined;
		const first = spoken.current === null;
		spoken.current = announcement;
		if (first) return undefined;
		region.textContent = "";
		const timer = setTimeout(() =>
		{
			region.textContent = announcement;
		}, 50);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [announcement]);

	// Upstream `Ne`: one Re-run per turn, released when the session stops responding.
	const rerunning = useRef(false);
	useEffect(() =>
	{
		if (!responding) rerunning.current = false;
	}, [responding]);

	function sendFailed(message: string): void
	{
		toast?.(
			{
				kind: "error",
				message,
			},
		);
	}

	function trySend(text: string, onFailure: () => void): void
	{
		if (send === null) return;
		try
		{
			const result = send(text);
			if (result instanceof Promise) result.catch(onFailure);
		}
		catch
		{
			onFailure();
		}
	}

	function applyFixes(): void
	{
		const fromKeyboard = focusVisible(applyRef.current);
		const statusNow = reviewFindingsSnapshot().findingStatusBySession[sessionId] ?? NO_STATUSES;
		const open = findings.filter((finding) => (statusNow[finding.id] ?? "open") === "open");
		if (open.length === 0) return;
		const openIds = open.map((finding) => finding.id);
		const prompt = formatApplyFindingsPrompt(
			open.map((finding) => (
			{
				id: finding.id,
				file: finding.filePath,
				side: "new",
				line: finding.line ?? 1,
				severity: "low",
				title: finding.body,
				body: finding.detail ?? "",
				resolved: false,
			})),
		);
		if (send === null)
		{
			if (!onPrefillComposer(prompt)) sendFailed("Open the chat input to send this fix.");
			return;
		}
		clearChangesReview(sessionId);
		setReviewFindings(
			sessionId,
			findings,
			{
				level: parsed?.level,
				toolId: call.id,
				latestSettledToolId: latest,
			},
		);
		openChanges?.();
		markReviewFindingsFixing(sessionId, openIds);
		if (fromKeyboard) focusFallback();
		trySend(prompt, () =>
		{
			reopenReviewFindings(sessionId, openIds);
			sendFailed("Couldn’t send the fixes. Try again.");
		});
	}

	function rerunReview(): void
	{
		if (rerunning.current) return;
		const command = parsed?.level === undefined ? "/code-review" : `/code-review ${parsed.level}`;
		if (send === null)
		{
			if (!onPrefillComposer(command)) sendFailed("Open the chat input to send this fix.");
			return;
		}
		rerunning.current = true;
		if (focusVisible(rerunRef.current)) focusFallback();
		trySend(command, () =>
		{
			rerunning.current = false;
			sendFailed("Couldn’t re-run the review. Try again.");
		});
	}

	const groups = useMemo(() => groupFindingsByFile(parsed?.findings ?? []), [parsed]);
	if (parsed === undefined) return <>{fallback}</>;

	const showRerun = canOpen && isLatest && state === "terminal";
	const showApply = canOpen && isLatest && !showRerun;
	return (
		<div ref={rootRef} tabIndex={-1} data-report-findings-card="" className={REVIEW_CARD_CLASS}>
			<span ref={statusRef} role="status" className="sr-only" />
			<div className={HEADER_CLASS}>
				<span className="shrink-0 text-body text-primary">Code review</span>
				<span className="min-w-0 truncate text-body text-secondary">
					{reviewSummaryText(parsed.level, count)}
				</span>
				<span className="grow" />
				{showRerun && (
					<button
						ref={rerunRef}
						type="button"
						className={GHOST_XXS_CLASS}
						disabled={responding}
						onClick={rerunReview}
					>
						Re-run review
					</button>
				)}
				{showApply && (
					<button
						ref={applyRef}
						type="button"
						className={GHOST_XXS_CLASS}
						disabled={state !== "actionable"}
						onClick={applyFixes}
					>
						Apply fixes
					</button>
				)}
				{canOpen && isLatest && (
					<button
						ref={walkRef}
						type="button"
						className={WALK_THROUGH_CLASS}
						disabled={state !== "actionable" && state !== "applying"}
						onClick={() =>
						{
							openFindings(0, "cta");
						}}
					>
						Walk through in Changes
					</button>
				)}
			</div>
			{count > 0 && (
				<>
					<div aria-hidden="true" className={DIVIDER_CLASS} />
					{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's findings region (`Ru`) is a Tab stop so the keyboard can scroll it */}
					<div tabIndex={0} role="group" aria-label="Findings" className={REGION_CLASS}>
						{groups.map((group, groupIndex) => (
							<div key={group.file} className={FILE_GROUP_CLASS}>
								<div
									id={`${call.id}-file-${groupIndex}`}
									className={FILE_HEADER_CLASS}
									title={group.file}
								>
									<span className="truncate">{group.label}</span>
								</div>
								<ul
									role="list"
									aria-labelledby={`${call.id}-file-${groupIndex}`}
									className={FILE_LIST_CLASS}
								>
									{group.entries.map(({finding, index}) =>
									{
										const id = findings[index]?.id ?? "";
										const anchorState: AnchorState = rowsAvailable
											? unanchored?.has(id) === true
												? "unanchored"
												: "anchored"
											: "unavailable";
										return (
											<FindingRow
												key={`${finding.file}:${finding.line ?? ""}:${index}`}
												finding={finding}
												status={statuses[id]}
												rowKey={`${sessionId}:${call.id}:${index}`}
												anchorState={anchorState}
												onView={() =>
												{
													openFindings(index, "row");
												}}
											/>
										);
									})}
								</ul>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}

const NO_STATUSES: Readonly<Record<string, ReviewFindingStatus>> = {};
const NO_IDS: readonly string[] = [];
