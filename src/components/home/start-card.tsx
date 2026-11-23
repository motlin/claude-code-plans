import {Check, ChevronDown, Folder, SquareTerminal, Zap, type LucideIcon} from "lucide-react";
import {useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject} from "react";

import {useFolderModeMemory} from "../../hooks/use-folder-mode-memory";
import {useShortcut} from "../../hooks/use-shortcut";
import {folderName, folderParent, inferHome, shortenCwd, type FolderRowName} from "../../lib/folder-row-names";
import {requestHomeComposerFocus, requestHomeComposerPrefill} from "../../lib/home-composer-focus";
import
{
	nextStepCandidateKey,
	nextStepIcon,
	nextStepKey,
	nextStepRowKey,
	nextStepTooltip,
	selectNextSteps,
	type NextStepCandidate,
	type NextStepIconName,
	type NextStepId,
	type NextStepRow,
} from "../../lib/home-next-steps";
import {TOUCH_REVEAL} from "../../lib/touch-reveal";
import {POPOVER_SCROLL_BODY_CLASS, PopoverRoot, PopoverTrigger, PopoverContent} from "../ui/popover";
import {Icon} from "../ui/icon";
import {PathBreak} from "../ui/path-break";
import {Tooltip} from "../ui/tooltip";
import type {StartProject} from "../../lib/palette-start-session";
import {useHomeDraftUsed, useHomeLaunchFolder, useHomeLaunchOptions, useHomeWorktree} from "./launch-folder";
import {ProjectPicker} from "./project-picker";
import {ClawdMascot} from "./clawd-mascot";
import {START_CARD_ENVIRONMENTS, START_CARD_SETUP_HIDE_CLASS} from "./start-card-placement";
import {useNextStepsHold} from "./use-next-steps-hold";
import {useNextStepsSlots} from "./use-next-steps-slots";

/** Upstream shows at most three recent environments. */
const ROW_LIMIT = 3;

/** Upstream's start-card list: a 320px ringed surface-1 card. */
const CARD_CLASS = "card-ring flex w-80 max-w-full shrink-0 flex-col rounded-card bg-surface-1";

/** Upstream's recent-folder count (`M`'s default limit): basenames are disambiguated across these, not just the 3 shown. */
const FOLDER_DISAMBIGUATION_LIMIT = 8;

/** Upstream's current row (`e5`, `X8`). */
const CURRENT_ROW_CLASS = "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-body leading-5";

/** Upstream's folder-row parent detail (`vye` + `Z8`): muted at rest, secondary on hover, keyboard focus or open. */
const FOLDER_DETAIL_CLASS =
	"min-w-0 max-w-max grow basis-24 truncate text-muted-as-secondary group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

/** The top three folders; a selection outside them takes the third seat. */
function visibleRows(projects: readonly StartProject[], selected: StartProject | undefined): StartProject[]
{
	const top = projects.slice(0, ROW_LIMIT);
	if (selected === undefined || top.some((p) => p.id === selected.id)) return top;
	return [...top.slice(0, ROW_LIMIT - 1), selected];
}

interface StartCardProps
{
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
	nextSteps?: NextStepsListProps | undefined;
}

/**
 * Upstream's /code start card "Recent folders" list of recent local folders: the
 * current folder is a static checked row, the others pick the launch folder and focus the composer,
 * and "Choose environment" opens the composer's project picker, over the "Next steps" list of waiting
 * sessions and failing PRs. Upstream's cloud environments have no local equivalent.
 */
export function StartCard({projects, selected, onSelect, nextSteps}: StartCardProps)
{
	const chooseRef = useRef<HTMLButtonElement>(null);
	const hasNextSteps = nextSteps !== undefined && nextSteps.rows.length > 0;
	if (projects.length === 0 && !hasNextSteps) return null;

	const choose = (projectId: string) =>
	{
		onSelect(projectId);
		requestHomeComposerFocus();
	};
	// Upstream's keyboard-dismiss fallback once Next steps empties: the "Choose environment" row, else the composer.
	const focusChooseEnvironment = () =>
	{
		const chooseButton = chooseRef.current;
		if (chooseButton?.isConnected === true) chooseButton.focus();
		else requestHomeComposerFocus();
	};

	// Upstream's `q5`: Clawd peeks over the env card, or leads Next steps when there is none.
	return (
		<div
			data-start-card
			data-testid="epitaxy-start-card"
			className="flex w-full min-w-0 flex-col items-center gap-3 p-px"
		>
			<ClawdMascot />
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
})
{
	const rows = visibleRows(projects, selected);
	const recentPaths = projects.slice(0, FOLDER_DISAMBIGUATION_LIMIT).map((p) => p.projectPath);
	const home = inferHome(recentPaths);
	// Upstream's ⌥⌘1…9 picks the Nth environment preset; locally the Nth row. Digits past the
	// list are still claimed (preventDefault), like upstream.
	useShortcut("select_environment", (event) =>
	{
		const project = rows[Number(event.code.slice("Digit".length)) - 1];
		if (project !== undefined) choose(project.id);
	});
	return (
		<ul
			role="list"
			aria-label="Recent folders"
			data-testid="start-card-environments"
			{...
			{
				[START_CARD_ENVIRONMENTS]: "",
			}}
			className={CARD_CLASS}
		>
			{rows.map((project) => (
				<FolderRow
					key={project.id}
					project={project}
					name={rowName(project.projectPath, recentPaths, home)}
					current={project.id === selected?.id}
					choose={choose}
				/>
			))}
			<li className="pt-1">
				<div
					aria-hidden="true"
					className="border-t border-[var(--card-outline)]"
					style={
					{
						marginInline: "var(--ring-inner, 1px)",
					}}
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

/**
 * Upstream's folder-row name for a shown row (`hxe` over `V`): its basename disambiguated across the recent eight; a
 * selection seated from outside them keeps its bare basename.
 */
function rowName(path: string, recentPaths: readonly string[], home: string | undefined): FolderRowName
{
	return {
		name: folderName(path),
		parent: recentPaths.includes(path) ? folderParent(path, recentPaths, home) : undefined,
	};
}

/**
 * One upstream folder row: the current folder is a static checked `e5` row with no detail; another is a `$8` row
 * button, its title the basename and its detail the parent folder on a basename collision, described by the path.
 */
function FolderRow({
	project,
	name,
	current,
	choose,
}: {
	project: StartProject;
	name: FolderRowName;
	current: boolean;
	choose: (projectId: string) => void;
})
{
	const whereId = useId();
	const where = shortenCwd(project.projectPath);
	const icon = <Folder aria-hidden="true" className="size-4 shrink-0 text-secondary-control" />;
	return (
		<li aria-current={current ? true : undefined} className="px-1 pt-0.5 first:pt-1">
			{current ? (
				<Tooltip content={<PathBreak path={where} />} align="start" className="flex w-full">
					<div data-testid="start-card-environment" className={CURRENT_ROW_CLASS}>
						{icon}
						<span className="min-w-0 flex-1 truncate text-secondary-control">{name.name}</span>
						<span className="sr-only">{where}</span>
						<Check data-start-card-check aria-hidden="true" className="size-4 shrink-0 text-primary" />
					</div>
				</Tooltip>
			) : (
				<div className="group/row relative">
					<Tooltip content={<PathBreak path={where} />} align="start" className="flex w-full">
						<button
							type="button"
							data-testid="start-card-environment"
							aria-describedby={whereId}
							onClick={() =>
							{
								choose(project.id);
							}}
							className={STEP_BUTTON_CLASS}
						>
							{icon}
							<RowLine
								title={name.name}
								detail={
									name.parent === undefined ? null : (
										<span data-folder-detail className={FOLDER_DETAIL_CLASS}>
											{name.parent}
										</span>
									)
								}
							/>
						</button>
					</Tooltip>
					<span id={whereId} hidden>
						{where}
					</span>
				</div>
			)}
		</li>
	);
}

export interface NextStepsListProps
{
	rows: readonly NextStepRow<NextStepCandidate>[];
	/** The home draft's opening (upstream's composer `mountKey`); a new one drops the latched slot order. */
	openingKey?: number | undefined;
	/** Opens the row's session (its subject). */
	onOpen: (subject: string) => void;
	onDismiss: (candidates: NextStepCandidate[]) => void;
	/** Where a keyboard dismiss sends focus when no row remains; the composer by default. */
	onEmptyFocus?: (() => void) | undefined;
	/** Turns on Worktree for a pressed "Turn on Worktree" row, which then comes back `taken`. */
	onTurnOnWorktree?: ((candidate: NextStepCandidate) => void) | undefined;
	/** Marks a pressed prefill row used for this draft, after its text went to the composer. */
	onPrefill?: ((candidate: NextStepCandidate) => void) | undefined;
	/** Sets the home draft's mode to Auto for a pressed "Turn on auto mode" row. */
	onTurnOnAutoMode?: ((candidate: NextStepCandidate) => void) | undefined;
}

// Upstream's row reveal: on hover, keyboard focus inside the row, or while its popup is open. Spelled out in full
// so Tailwind's scanner sees every class.
const STEP_BUTTON_CLASS =
	"flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-body leading-5 outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden";

const STEP_DETAIL_CLASS =
	"min-w-0 max-w-max grow basis-24 truncate text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

/** Upstream's revealed-row ink for the rest row's caret: muted at rest, secondary on hover, focus or open. */
const STEP_CARET_CLASS =
	"size-3 shrink-0 text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

/** Reserves the revealed dismiss's width (24px less the row gap) only while it shows. */
const STEP_SPACER_CLASS =
	"hidden shrink-0 items-center group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex touch:flex -ms-2";

const DISMISS_SLOT_CLASS = `pointer-events-none absolute inset-y-0 end-1 flex items-center opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[aria-expanded=true]]/row:opacity-100 ${TOUCH_REVEAL}`;

/** Rows that carry upstream's "Waiting" status before their title. */
const WAITING_IDS: ReadonlySet<NextStepId> = new Set(["waiting-session", "resume-session"]);

/** Upstream's row icon (cds `Icon` size sm): 16px in the row's gap flow, control ink, static on hover. */
const NEXT_STEP_ICON_CLASS = "size-4 shrink-0 text-secondary-control";

const NEXT_STEP_GLYPHS: Readonly<Record<NextStepIconName, LucideIcon | null>> =
{
	Lightning: Zap,
	CommandLinePrompt: SquareTerminal,
	Folder,
	Github: null,
};

/**
 * Upstream's cds row icons drawn with lucide at the sm stroke (1.25px) until the glyph icons land. `Github` draws
 * nothing until a local GitHub mark exists (Primer Octicons `mark-github`).
 */
function NextStepGlyph({
	name,
}: Readonly<
{
	name: NextStepIconName;
}>)
{
	const props =
	{
		"aria-hidden": true,
		"data-next-step-icon": "",
		strokeWidth: 1.25,
		absoluteStrokeWidth: true,
		className: NEXT_STEP_ICON_CLASS,
	} as const;
	const Glyph = NEXT_STEP_GLYPHS[name];
	return Glyph === null ? null : <Glyph {...props} />;
}

function rowCandidates(row: NextStepRow<NextStepCandidate>): NextStepCandidate[]
{
	return row.type === "row" ? [row.candidate] : row.rest;
}

/** Upstream's double-click window: a click this soon after one on a row that has since gone is swallowed. */
const CLICK_GUARD_MS = 500;

function StepSpacer()
{
	return (
		<span aria-hidden="true" data-next-step-spacer className={STEP_SPACER_CLASS}>
			<span className="w-6" />
		</span>
	);
}

/** Upstream's row line: a title and an optional detail that drops out of view when the two don't fit. */
function RowLine({title, detail, lineAttrs}: {title: ReactNode; detail: ReactNode; lineAttrs?: Record<string, string>})
{
	return (
		<span className="flex min-w-0 flex-1 items-center gap-1">
			<span
				{...lineAttrs}
				className="flex h-5 min-w-0 items-baseline gap-x-2 overflow-hidden whitespace-nowrap flex-wrap"
			>
				<span className="min-w-0 max-w-full truncate text-secondary-control">{title}</span>
				{detail}
			</span>
		</span>
	);
}

/** `listed`: a row inside the rest popup, which drops the "Waiting" status. */
function StepLine({
	candidate,
	listed = false,
}: Readonly<
{
	candidate: NextStepCandidate;
	listed?: boolean;
}>)
{
	return (
		<RowLine
			lineAttrs={
			{
				"data-next-step-line": "",
			}}
			title={
				<>
					{!listed && WAITING_IDS.has(candidate.id) && (
						<>
							<span className="text-upstream-warning">Waiting</span>{" "}
						</>
					)}
					{candidate.title}
				</>
			}
			detail={candidate.detail !== null && <span className={STEP_DETAIL_CLASS}>{candidate.detail}</span>}
		/>
	);
}

/**
 * Upstream's start-card "Next steps" list: up to three seats of Waiting session and failing-PR rows, a family past its
 * seats folded into a "Claude is waiting in N more sessions" row whose popup lists the rest. Each row's
 * dismiss shows on hover, keyboard focus, or always on touch. Like upstream, a pointer dismiss focuses the composer;
 * a keyboard dismiss (the X is `:focus-visible`) focuses the last remaining row once the removal commits, else
 * `onEmptyFocus`. While the pointer or focus is in the list its rows are held (`useNextStepsHold`), and a fast second
 * click can't land on a row that slid up under the pointer.
 */
export function NextStepsList({
	rows: incoming,
	openingKey = 0,
	onOpen,
	onDismiss,
	onEmptyFocus = requestHomeComposerFocus,
	onTurnOnWorktree,
	onPrefill,
	onTurnOnAutoMode,
}: Readonly<NextStepsListProps>)
{
	const [openRest, setOpenRest] = useState<string | null>(null);
	const candidates = incoming.flatMap(rowCandidates);
	const hold = useNextStepsHold(
		{
			keys: candidates.map(nextStepCandidateKey),
			pinned: openRest !== null,
		},
	);
	const {held} = hold;
	const ranked =
		held === null || candidates.every((c) => held.has(nextStepCandidateKey(c)))
			? incoming
			: selectNextSteps(
					{
						candidates: candidates.filter((c) => held.has(nextStepCandidateKey(c))),
						dismissed: {},
					},
				);
	// Upstream's order: hold, rank, then the per-opening slot latch.
	const latch = useNextStepsSlots(
		{
			openingKey,
			ranked,
		},
	);
	const rows = latch.slots;
	const focusGone =
		hold.focus !== null &&
		!rows.some(
			(row) =>
				nextStepRowKey(row) === hold.focus ||
				rowCandidates(row).some((c) => nextStepCandidateKey(c) === hold.focus),
		);
	if (focusGone) hold.dropFocus();
	const pinGone = openRest !== null && !rows.some((row) => nextStepRowKey(row) === openRest);
	if (pinGone) setOpenRest(null);
	// Like upstream, the drawn slots are recorded a pass after a held focus or open rest row lets go.
	if (rows.length === 0 || !(focusGone || pinGone)) latch.note();
	const closeRest = () =>
	{
		setOpenRest(null);
		hold.recheckPointer();
	};
	// The time and row key of the last click in the list, for upstream's double-click guard.
	const lastClick = useRef<
	{
		at: number;
		key?: string | undefined;
	}>(
		{
			at: -Infinity,
		},
	);
	const listRef = hold.groupRef;
	// The keys of a keyboard-dismissed row; its focus handoff waits until the dismissal's re-render drops them.
	const pendingFocusKeys = useRef<ReadonlySet<string> | null>(null);
	const onEmptyFocusRef = useRef(onEmptyFocus);
	onEmptyFocusRef.current = onEmptyFocus;
	const rowKeys = rows.map(nextStepRowKey);

	useLayoutEffect(() =>
	{
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
		() => () =>
		{
			if (pendingFocusKeys.current !== null) onEmptyFocusRef.current();
		},
		[],
	);

	if (rows.length === 0) return null;

	const dismiss = (button: HTMLButtonElement, key: string, candidates: NextStepCandidate[]) =>
	{
		const keyboard = button.matches(":focus-visible");
		pendingFocusKeys.current = keyboard ? new Set([key]) : null;
		latch.forget(key);
		onDismiss(candidates);
		if (!keyboard) requestHomeComposerFocus();
	};

	return (
		<ul
			ref={listRef}
			role="list"
			aria-label="Next steps"
			data-testid="start-card-setup"
			data-start-card-setup=""
			className={`${CARD_CLASS} gap-0.5 p-1 ${START_CARD_SETUP_HIDE_CLASS}`}
			onClickCapture={(event) =>
			{
				if (event.detail === 0) return;
				const at = performance.now();
				const target = event.target instanceof Element ? event.target : null;
				if (target === null || !event.currentTarget.contains(target))
				{
					lastClick.current =
					{
						at,
					};
					return;
				}
				const previous = lastClick.current;
				if (
					at - previous.at < CLICK_GUARD_MS &&
					![...event.currentTarget.children].some((li) => li.getAttribute("data-row-key") === previous.key)
				)
				{
					event.stopPropagation();
					return;
				}
				lastClick.current =
				{
					at,
					key: target.closest("li")?.getAttribute("data-row-key") ?? undefined,
				};
			}}
			{...hold.groupProps}
		>
			{rows.map((row) =>
			{
				const candidates = rowCandidates(row);
				const key = nextStepRowKey(row);
				const dismissLabel =
					row.type === "row"
						? (row.candidate.dismissLabel ?? `Dismiss “${row.candidate.title}”`)
						: row.dismissLabel;
				if (row.type === "row" && row.candidate.taken === true)
				{
					return (
						<li key={key} data-row-key={key}>
							<WorktreeTakenRow />
						</li>
					);
				}
				return (
					<li key={key} data-row-key={key}>
						<div className="group/row relative">
							{row.type === "row" ? (
								<StepRowButton
									candidate={row.candidate}
									onOpen={onOpen}
									onTurnOnWorktree={onTurnOnWorktree}
									onPrefill={onPrefill}
									onTurnOnAutoMode={onTurnOnAutoMode}
								/>
							) : (
								<RestRow
									title={row.title}
									rest={row.rest}
									onOpen={onOpen}
									open={openRest === key}
									onOpenChange={(open) =>
									{
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
										onClick={(event) =>
										{
											if (row.type === "rest") closeRest();
											dismiss(event.currentTarget, key, candidates);
										}}
										className="pointer-events-auto flex size-6 items-center justify-center rounded-r5 text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus comfortable:size-8 comfortable:rounded-r6"
									>
										<Icon name="X" size="sm" />
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
 * Upstream's pressed "Turn on Worktree" row (`T5`): static, with no hover, tooltip or dismiss, but it keeps its seat.
 */
function WorktreeTakenRow()
{
	return (
		<div
			data-testid="start-card-worktree-apart"
			className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-body leading-5"
		>
			<span className="min-w-0 flex-1 truncate text-secondary-control">Worktree is on</span>
			<Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
		</div>
	);
}

/**
 * A next-step row (upstream's `X8`): its icon first when the card copy has one, and upstream's title-over-detail
 * tooltip (or a row's text-only one) lined up with the row's start edge, with a hidden span holding its text that
 * describes the button. A row whose card copy has no tooltip gets neither.
 */
function StepRowButton({
	candidate,
	onOpen,
	onTurnOnWorktree,
	onPrefill,
	onTurnOnAutoMode,
	listed = false,
}: Readonly<
{
	candidate: NextStepCandidate;
	onOpen: (subject: string) => void;
	onTurnOnWorktree?: ((candidate: NextStepCandidate) => void) | undefined;
	onPrefill?: ((candidate: NextStepCandidate) => void) | undefined;
	onTurnOnAutoMode?: ((candidate: NextStepCandidate) => void) | undefined;
	listed?: boolean;
}>)
{
	const titleId = useId();
	const tooltip = nextStepTooltip(candidate);
	const icon = nextStepIcon(candidate);
	const button = (
		<button
			type="button"
			data-testid={`start-card-${candidate.id}`}
			data-next-step-open
			aria-describedby={tooltip === undefined ? undefined : titleId}
			onClick={() =>
			{
				if (candidate.kind === "worktree")
				{
					onTurnOnWorktree?.(candidate);
					requestHomeComposerFocus();
				}
				else if (candidate.kind === "auto-mode")
				{
					// Upstream's `permission.select("auto")`, then `refocus`.
					onTurnOnAutoMode?.(candidate);
					requestHomeComposerFocus();
				}
				else if (candidate.kind === "prefill" && candidate.prefill !== undefined)
				{
					requestHomeComposerPrefill(candidate.prefill);
					onPrefill?.(candidate);
				}
				else
				{
					onOpen(candidate.subject);
				}
			}}
			className={STEP_BUTTON_CLASS}
		>
			{icon !== undefined && <NextStepGlyph name={icon} />}
			<StepLine candidate={candidate} listed={listed} />
			{!listed && <StepSpacer />}
		</button>
	);
	if (tooltip === undefined) return button;
	return (
		<>
			<Tooltip
				content={tooltip.content}
				detail={tooltip.detail}
				side="top"
				align="start"
				stacked
				className="w-full"
			>
				{button}
			</Tooltip>
			<span id={titleId} hidden>
				{tooltip.text}
			</span>
		</>
	);
}

/**
 * The "Claude is waiting in N more sessions" row: a caret trigger whose popup, anchored bottom/start and at least as
 * wide as the row, lists the folded sessions as plain rows (no "Waiting", no dismiss). Opening one closes the popup.
 */
function RestRow({
	title,
	rest,
	onOpen,
	open,
	onOpenChange,
	onPopupPointerEnter,
}: Readonly<
{
	title: string;
	rest: readonly NextStepCandidate[];
	onOpen: (subject: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Entering the portalled popup counts as leaving the list, like upstream. */
	onPopupPointerEnter: () => void;
}>)
{
	const openListed = (subject: string) =>
	{
		onOpenChange(false);
		onOpen(subject);
	};
	return (
		<PopoverRoot
			open={open}
			onOpenChange={(next) =>
			{
				onOpenChange(next);
			}}
		>
			<PopoverTrigger data-testid="start-card-blocked-sessions" data-next-step-open className={STEP_BUTTON_CLASS}>
				<span className="min-w-0 flex-1 truncate text-secondary-control">{title}</span>
				<ChevronDown aria-hidden="true" className={STEP_CARET_CLASS} />
				<StepSpacer />
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={6}
				onPointerEnter={onPopupPointerEnter}
				className="max-h-[var(--available-height)] min-w-[var(--anchor-width)] max-w-[min(26rem,90vw)] rounded-r7 bg-surface-3 shadow-[var(--menu-shadow)] break-words outline-none"
			>
				<div className={POPOVER_SCROLL_BODY_CLASS}>
					<ul role="list" className="flex flex-col gap-0.5 p-1">
						{rest.map((candidate) =>
						{
							const key = nextStepCandidateKey(candidate);
							return (
								<li key={key} data-row-key={key} className="group/row relative">
									<StepRowButton candidate={candidate} onOpen={openListed} listed />
								</li>
							);
						})}
					</ul>
				</div>
			</PopoverContent>
		</PopoverRoot>
	);
}

/** The start card bound to the shared home launch folder. */
export function HomeStartCard({
	nextSteps,
}: Readonly<
{
	nextSteps?: NextStepsListProps | undefined;
}>)
{
	const {projects, selected, select} = useHomeLaunchFolder();
	const {takeFromRow} = useHomeWorktree();
	const {markUsed} = useHomeDraftUsed();
	const {setPermissionMode} = useHomeLaunchOptions(selected?.projectPath);
	const {remember} = useFolderModeMemory(selected?.projectPath);
	return (
		<StartCard
			projects={projects}
			selected={selected}
			onSelect={select}
			nextSteps={
				nextSteps === undefined
					? undefined
					:
						{
							...nextSteps,
							onTurnOnWorktree: (candidate) =>
							{
								takeFromRow(candidate.subject);
							},
							onPrefill: (candidate) =>
							{
								markUsed(nextStepKey(candidate));
							},
							// Upstream's `permission.select("auto")`, the same pick as the chin's Mode menu.
							onTurnOnAutoMode: () =>
							{
								remember("auto");
								setPermissionMode("auto");
							},
						}
			}
		/>
	);
}
