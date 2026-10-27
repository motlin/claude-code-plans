import {Check, ChevronDown, Folder, X} from "lucide-react";
import {useId, useLayoutEffect, useRef, useState, type RefObject} from "react";

import {useShortcut} from "../../hooks/use-shortcut";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {selectNextSteps, type NextStepCandidate, type NextStepId, type NextStepRow} from "../../lib/home-next-steps";
import {TOUCH_REVEAL} from "../../lib/touch-reveal";
import {Popover, PopoverContent} from "../ui/popover";
import {Tooltip} from "../ui/tooltip";
import type {StartProject} from "../../lib/palette-start-session";
import {useHomeLaunchFolder} from "./launch-folder";
import {ProjectPicker} from "./project-picker";
import {START_CARD_SETUP_HIDE_CLASS} from "./start-card-placement";
import {useNextStepsHold} from "./use-next-steps-hold";

/** Upstream shows at most three recent environments. */
const ROW_LIMIT = 3;

/** Upstream's start-card list: a 320px ringed surface-1 card. */
const CARD_CLASS = "card-ring flex w-80 max-w-full shrink-0 flex-col rounded-card bg-surface-1";

const ROW_CLASS = "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px]/5 text-secondary";

/** `/Users/me/x` or `/home/me/x` → `~/x`, like upstream's shortened local cwd. */
function shortenCwd(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** The top three folders; a selection outside them takes the third seat. */
function visibleRows(projects: readonly StartProject[], selected: StartProject | undefined): StartProject[] {
	const top = projects.slice(0, ROW_LIMIT);
	if (selected === undefined || top.some((p) => p.id === selected.id)) return top;
	return [...top.slice(0, ROW_LIMIT - 1), selected];
}

interface StartCardProps {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
	nextSteps?: NextStepsListProps | undefined;
}

/**
 * Upstream's /code start card "Recent environments" list, adapted to recent local folders: the
 * current folder is a static checked row, the others pick the launch folder and focus the composer,
 * and "Choose environment" opens the composer's project picker, over the "Next steps" list of blocked
 * sessions and failing PRs. Upstream's cloud environments have no local equivalent.
 */
export function StartCard({projects, selected, onSelect, nextSteps}: StartCardProps) {
	const chooseRef = useRef<HTMLButtonElement>(null);
	const hasNextSteps = nextSteps !== undefined && nextSteps.rows.length > 0;
	if (projects.length === 0 && !hasNextSteps) return null;

	const choose = (projectId: string) => {
		onSelect(projectId);
		requestHomeComposerFocus();
	};
	// Upstream's keyboard-dismiss fallback once Next steps empties: the "Choose environment" row, else the composer.
	const focusChooseEnvironment = () => {
		const chooseButton = chooseRef.current;
		if (chooseButton?.isConnected === true) chooseButton.focus();
		else requestHomeComposerFocus();
	};

	return (
		<div data-start-card className="flex w-full min-w-0 flex-col items-center gap-3 p-px">
			{projects.length > 0 && (
				<RecentEnvironments projects={projects} selected={selected} choose={choose} chooseRef={chooseRef} />
			)}
			{hasNextSteps && <NextStepsList onEmptyFocus={focusChooseEnvironment} {...nextSteps} />}
		</div>
	);
}

function RecentEnvironments({
	projects,
	selected,
	choose,
	chooseRef,
}: {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	choose: (projectId: string) => void;
	chooseRef: RefObject<HTMLButtonElement | null>;
}) {
	const rows = visibleRows(projects, selected);
	// Upstream's ⌥⌘1…9 picks the Nth environment preset; locally the Nth row. Digits past the
	// list are still claimed (preventDefault), like upstream.
	useShortcut("select_environment", (event) => {
		const project = rows[Number(event.code.slice("Digit".length)) - 1];
		if (project !== undefined) choose(project.id);
	});
	return (
		<ul role="list" aria-label="Recent environments" className={CARD_CLASS}>
			{rows.map((project) => {
				const current = project.id === selected?.id;
				const content = (
					<>
						<Folder aria-hidden="true" className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate text-start">{project.name}</span>
					</>
				);
				return (
					<li key={project.id} aria-current={current ? true : undefined} className="px-1 pt-0.5 first:pt-1">
						<Tooltip content={shortenCwd(project.projectPath)} align="start" className="flex w-full">
							{current ? (
								<div className={ROW_CLASS}>
									{content}
									<Check
										data-start-card-check
										aria-hidden="true"
										className="size-4 shrink-0 text-primary"
									/>
								</div>
							) : (
								<button
									type="button"
									onClick={() => {
										choose(project.id);
									}}
									className={`${ROW_CLASS} transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`}
								>
									{content}
								</button>
							)}
						</Tooltip>
					</li>
				);
			})}
			<li className="pt-1">
				<div
					aria-hidden="true"
					className="border-t border-[var(--card-outline)]"
					style={{marginInline: "var(--ring-inner, 1px)"}}
				/>
				<div className="p-1">
					<ProjectPicker
						variant="choose"
						projects={projects}
						selected={selected}
						onSelect={choose}
						triggerRef={chooseRef}
					/>
				</div>
			</li>
		</ul>
	);
}

export interface NextStepsListProps {
	rows: readonly NextStepRow<NextStepCandidate>[];
	/** Opens the row's session (its subject). */
	onOpen: (subject: string) => void;
	onDismiss: (candidates: NextStepCandidate[]) => void;
	/** Where a keyboard dismiss sends focus when no row remains; the composer by default. */
	onEmptyFocus?: (() => void) | undefined;
}

// Upstream's row reveal: on hover, keyboard focus inside the row, or while its popup is open. Spelled out in full
// so Tailwind's scanner sees every class.
const STEP_BUTTON_CLASS =
	"flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-[13px]/5 outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden";

const STEP_DETAIL_CLASS =
	"min-w-0 max-w-max grow basis-24 truncate text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

/** Upstream's revealed-row ink for the rest row's caret: muted at rest, secondary on hover, focus or open. */
const STEP_CARET_CLASS =
	"size-3 shrink-0 text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

/** Reserves the revealed dismiss's width (24px less the row gap) only while it shows. */
const STEP_SPACER_CLASS =
	"hidden shrink-0 items-center group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex touch:flex -ms-2";

const DISMISS_SLOT_CLASS = `pointer-events-none absolute inset-y-0 end-1 flex items-center opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[aria-expanded=true]]/row:opacity-100 ${TOUCH_REVEAL}`;

/** Rows that carry upstream's "Blocked" status before their title. */
const BLOCKED_IDS: ReadonlySet<NextStepId> = new Set(["waiting-session", "resume-session"]);

function candidateKey(candidate: NextStepCandidate): string {
	return `${candidate.id}:${candidate.subject}`;
}

function nextStepRowKey(row: NextStepRow<NextStepCandidate>): string {
	return row.type === "row" ? candidateKey(row.candidate) : "blocked-sessions";
}

function rowCandidates(row: NextStepRow<NextStepCandidate>): NextStepCandidate[] {
	return row.type === "row" ? [row.candidate] : row.rest;
}

/** Upstream's double-click window: a click this soon after one on a row that has since gone is swallowed. */
const CLICK_GUARD_MS = 500;

function StepSpacer() {
	return (
		<span aria-hidden="true" data-next-step-spacer className={STEP_SPACER_CLASS}>
			<span className="w-6" />
		</span>
	);
}

/** `listed`: a row inside the rest popup, which drops the "Blocked" status. */
function StepLine({candidate, listed = false}: Readonly<{candidate: NextStepCandidate; listed?: boolean}>) {
	return (
		<span className="flex min-w-0 flex-1 items-center gap-1">
			<span
				data-next-step-line
				className="flex h-5 min-w-0 items-baseline gap-x-2 overflow-hidden whitespace-nowrap flex-wrap"
			>
				<span className="min-w-0 max-w-full truncate text-secondary">
					{!listed && BLOCKED_IDS.has(candidate.id) && (
						<>
							<span className="text-upstream-warning">Blocked</span>{" "}
						</>
					)}
					{candidate.title}
				</span>
				{candidate.detail !== null && <span className={STEP_DETAIL_CLASS}>{candidate.detail}</span>}
			</span>
		</span>
	);
}

/**
 * Upstream's start-card "Next steps" list: up to three seats of Blocked session and failing-PR rows, a family past its
 * seats folded into a "Claude is blocked in N more sessions" row whose popup lists the rest. Each row's
 * dismiss shows on hover, keyboard focus, or always on touch. Like upstream, a pointer dismiss focuses the composer;
 * a keyboard dismiss (the X is `:focus-visible`) focuses the last remaining row once the removal commits, else
 * `onEmptyFocus`. While the pointer or focus is in the list its rows are held (`useNextStepsHold`), and a fast second
 * click can't land on a row that slid up under the pointer.
 */
export function NextStepsList({
	rows: incoming,
	onOpen,
	onDismiss,
	onEmptyFocus = requestHomeComposerFocus,
}: Readonly<NextStepsListProps>) {
	const [openRest, setOpenRest] = useState<string | null>(null);
	const candidates = incoming.flatMap(rowCandidates);
	const hold = useNextStepsHold({keys: candidates.map(candidateKey), pinned: openRest !== null});
	const {held} = hold;
	const rows =
		held === null || candidates.every((c) => held.has(candidateKey(c)))
			? incoming
			: selectNextSteps({candidates: candidates.filter((c) => held.has(candidateKey(c))), dismissed: {}});
	if (
		hold.focus !== null &&
		!rows.some(
			(row) =>
				nextStepRowKey(row) === hold.focus || rowCandidates(row).some((c) => candidateKey(c) === hold.focus),
		)
	) {
		hold.dropFocus();
	}
	if (openRest !== null && !rows.some((row) => nextStepRowKey(row) === openRest)) setOpenRest(null);
	const closeRest = () => {
		setOpenRest(null);
		hold.recheckPointer();
	};
	// The time and row key of the last click in the list, for upstream's double-click guard.
	const lastClick = useRef<{at: number; key?: string | undefined}>({at: -Infinity});
	const listRef = hold.groupRef;
	// The keys of a keyboard-dismissed row; its focus handoff waits until the dismissal's re-render drops them.
	const pendingFocusKeys = useRef<ReadonlySet<string> | null>(null);
	const onEmptyFocusRef = useRef(onEmptyFocus);
	onEmptyFocusRef.current = onEmptyFocus;
	const rowKeys = rows.map(nextStepRowKey);

	useLayoutEffect(() => {
		const pending = pendingFocusKeys.current;
		if (pending === null || rowKeys.some((key) => pending.has(key))) return;
		pendingFocusKeys.current = null;
		const items = [...(listRef.current?.children ?? [])];
		const last = items.map((li) => li.querySelector<HTMLButtonElement>("button")).findLast(Boolean);
		if (last) last.focus();
		else onEmptyFocusRef.current();
	});
	// The parent unmounts the list with its last row.
	useLayoutEffect(
		() => () => {
			if (pendingFocusKeys.current !== null) onEmptyFocusRef.current();
		},
		[],
	);

	if (rows.length === 0) return null;

	const dismiss = (button: HTMLButtonElement, key: string, candidates: NextStepCandidate[]) => {
		const keyboard = button.matches(":focus-visible");
		pendingFocusKeys.current = keyboard ? new Set([key]) : null;
		onDismiss(candidates);
		if (!keyboard) requestHomeComposerFocus();
	};

	return (
		<ul
			ref={listRef}
			role="list"
			aria-label="Next steps"
			data-start-card-setup
			className={`${CARD_CLASS} gap-0.5 p-1 ${START_CARD_SETUP_HIDE_CLASS}`}
			onClickCapture={(event) => {
				if (event.detail === 0) return;
				const at = performance.now();
				const target = event.target instanceof Element ? event.target : null;
				if (target === null || !event.currentTarget.contains(target)) {
					lastClick.current = {at};
					return;
				}
				const previous = lastClick.current;
				if (
					at - previous.at < CLICK_GUARD_MS &&
					![...event.currentTarget.children].some((li) => li.getAttribute("data-row-key") === previous.key)
				) {
					event.stopPropagation();
					return;
				}
				lastClick.current = {at, key: target.closest("li")?.getAttribute("data-row-key") ?? undefined};
			}}
			{...hold.groupProps}
		>
			{rows.map((row) => {
				const candidates = rowCandidates(row);
				const key = nextStepRowKey(row);
				const dismissLabel =
					row.type === "row"
						? (row.candidate.dismissLabel ?? `Dismiss “${row.candidate.title}”`)
						: row.dismissLabel;
				return (
					<li key={key} data-row-key={key}>
						<div className="group/row relative">
							{row.type === "row" ? (
								<StepRowButton candidate={row.candidate} onOpen={onOpen} />
							) : (
								<RestRow
									title={row.title}
									rest={row.rest}
									onOpen={onOpen}
									open={openRest === key}
									onOpenChange={(open) => {
										if (open) setOpenRest(key);
										else closeRest();
									}}
									onPopupPointerEnter={hold.groupProps.onPointerLeave}
								/>
							)}
							<span className={DISMISS_SLOT_CLASS}>
								<Tooltip content="Dismiss">
									<button
										type="button"
										data-next-step-dismiss
										aria-label={dismissLabel}
										onClick={(event) => {
											if (row.type === "rest") closeRest();
											dismiss(event.currentTarget, key, candidates);
										}}
										className="pointer-events-auto flex size-6 items-center justify-center rounded-r5 text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
									>
										<X aria-hidden="true" className="size-4" />
									</button>
								</Tooltip>
							</span>
						</div>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * A next-step row: upstream's title-over-detail tooltip (or a row's text-only one) lined up with the row's start
 * edge, and a hidden span holding the title (or that text) that describes the button.
 */
function StepRowButton({
	candidate,
	onOpen,
	listed = false,
}: Readonly<{candidate: NextStepCandidate; onOpen: (subject: string) => void; listed?: boolean}>) {
	const titleId = useId();
	return (
		<>
			<Tooltip
				content={candidate.tooltipText ?? candidate.title}
				detail={
					candidate.tooltipText === undefined
						? (candidate.tooltip ?? candidate.detail ?? undefined)
						: undefined
				}
				side="top"
				align="start"
				stacked
				className="w-full"
			>
				<button
					type="button"
					data-next-step-open
					aria-describedby={titleId}
					onClick={() => {
						onOpen(candidate.subject);
					}}
					className={STEP_BUTTON_CLASS}
				>
					<StepLine candidate={candidate} listed={listed} />
					{!listed && <StepSpacer />}
				</button>
			</Tooltip>
			<span id={titleId} hidden>
				{candidate.tooltipText ?? candidate.title}
			</span>
		</>
	);
}

/**
 * The "Claude is blocked in N more sessions" row: a caret trigger whose popup, anchored bottom/start and at least as
 * wide as the row, lists the folded sessions as plain rows (no "Blocked", no dismiss). Opening one closes the popup.
 */
function RestRow({
	title,
	rest,
	onOpen,
	open,
	onOpenChange,
	onPopupPointerEnter,
}: Readonly<{
	title: string;
	rest: readonly NextStepCandidate[];
	onOpen: (subject: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Entering the portalled popup counts as leaving the list, like upstream. */
	onPopupPointerEnter: () => void;
}>) {
	const openListed = (subject: string) => {
		onOpenChange(false);
		onOpen(subject);
	};
	return (
		<Popover.Root
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
			}}
		>
			<Popover.Trigger data-next-step-open className={STEP_BUTTON_CLASS}>
				<span className="min-w-0 flex-1 truncate text-secondary">{title}</span>
				<ChevronDown aria-hidden="true" className={STEP_CARET_CLASS} />
				<StepSpacer />
			</Popover.Trigger>
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={6}
				onPointerEnter={onPopupPointerEnter}
				className="max-h-[var(--available-height)] min-w-[var(--anchor-width)] max-w-[min(26rem,90vw)] overflow-y-auto rounded-r7 bg-surface-3 shadow-[var(--menu-shadow)] break-words outline-none"
			>
				<ul role="list" className="flex flex-col gap-0.5 p-1">
					{rest.map((candidate) => {
						const key = `${candidate.id}:${candidate.subject}`;
						return (
							<li key={key} data-row-key={key} className="group/row relative">
								<StepRowButton candidate={candidate} onOpen={openListed} listed />
							</li>
						);
					})}
				</ul>
			</PopoverContent>
		</Popover.Root>
	);
}

/** The start card bound to the shared home launch folder. */
export function HomeStartCard({nextSteps}: Readonly<{nextSteps?: NextStepsListProps | undefined}>) {
	const {projects, selected, select} = useHomeLaunchFolder();
	return <StartCard projects={projects} selected={selected} onSelect={select} nextSteps={nextSteps} />;
}
