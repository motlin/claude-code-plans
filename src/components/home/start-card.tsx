import {Check, ChevronDown, Folder, X} from "lucide-react";
import {useId, useRef, useState} from "react";

import {useShortcut} from "../../hooks/use-shortcut";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import type {NextStepCandidate, NextStepId, NextStepRow} from "../../lib/home-next-steps";
import {TOUCH_REVEAL} from "../../lib/touch-reveal";
import {Popover, PopoverContent} from "../ui/popover";
import {Tooltip} from "../ui/tooltip";
import type {StartProject} from "../../lib/palette-start-session";
import {useHomeLaunchFolder} from "./launch-folder";
import {ProjectPicker} from "./project-picker";
import {START_CARD_SETUP_HIDE_CLASS} from "./start-card-placement";

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
	const hasNextSteps = nextSteps !== undefined && nextSteps.rows.length > 0;
	if (projects.length === 0 && !hasNextSteps) return null;

	const choose = (projectId: string) => {
		onSelect(projectId);
		requestHomeComposerFocus();
	};

	return (
		<div data-start-card className="flex w-full min-w-0 flex-col items-center gap-3 p-px">
			{projects.length > 0 && <RecentEnvironments projects={projects} selected={selected} choose={choose} />}
			{hasNextSteps && <NextStepsList {...nextSteps} />}
		</div>
	);
}

function RecentEnvironments({
	projects,
	selected,
	choose,
}: {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	choose: (projectId: string) => void;
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
						<span className="min-w-0 flex-1 truncate text-start" title={shortenCwd(project.projectPath)}>
							{project.name}
						</span>
					</>
				);
				return (
					<li key={project.id} aria-current={current ? true : undefined} className="px-1 pt-0.5 first:pt-1">
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
					</li>
				);
			})}
			<li className="pt-1">
				<div aria-hidden="true" className="border-t border-[var(--card-outline)]" />
				<div className="p-1">
					<ProjectPicker variant="choose" projects={projects} selected={selected} onSelect={choose} />
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
 * dismiss shows on hover, keyboard focus, or always on touch; after a dismiss, focus moves to the
 * previous row, else the composer.
 */
export function NextStepsList({rows, onOpen, onDismiss}: Readonly<NextStepsListProps>) {
	const listRef = useRef<HTMLUListElement>(null);
	if (rows.length === 0) return null;

	const dismiss = (index: number, candidates: NextStepCandidate[]) => {
		const previous = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-next-step-open]")[index - 1];
		onDismiss(candidates);
		if (previous) previous.focus();
		else requestHomeComposerFocus();
	};

	return (
		<ul
			ref={listRef}
			role="list"
			aria-label="Next steps"
			data-start-card-setup
			className={`${CARD_CLASS} gap-0.5 p-1 ${START_CARD_SETUP_HIDE_CLASS}`}
		>
			{rows.map((row, index) => {
				const candidates = row.type === "row" ? [row.candidate] : row.rest;
				const key = row.type === "row" ? `${row.candidate.id}:${row.candidate.subject}` : "blocked-sessions";
				const dismissLabel = row.type === "row" ? `Dismiss “${row.candidate.title}”` : row.dismissLabel;
				return (
					<li key={key} data-row-key={key}>
						<div className="group/row relative">
							{row.type === "row" ? (
								<StepRowButton candidate={row.candidate} onOpen={onOpen} />
							) : (
								<RestRow title={row.title} rest={row.rest} onOpen={onOpen} />
							)}
							<span className={DISMISS_SLOT_CLASS}>
								<Tooltip content="Dismiss">
									<button
										type="button"
										data-next-step-dismiss
										aria-label={dismissLabel}
										onClick={() => {
											dismiss(index, candidates);
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
 * A next-step row: upstream's title-over-detail tooltip lined up with the row's start edge, and a hidden span
 * holding the title that describes the button.
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
				content={candidate.title}
				detail={candidate.tooltip ?? candidate.detail ?? undefined}
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
				{candidate.title}
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
}: Readonly<{
	title: string;
	rest: readonly NextStepCandidate[];
	onOpen: (subject: string) => void;
}>) {
	const [open, setOpen] = useState(false);
	const openListed = (subject: string) => {
		setOpen(false);
		onOpen(subject);
	};
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger data-next-step-open className={STEP_BUTTON_CLASS}>
				<span className="min-w-0 flex-1 truncate text-secondary">{title}</span>
				<ChevronDown aria-hidden="true" className={STEP_CARET_CLASS} />
				<StepSpacer />
			</Popover.Trigger>
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={6}
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
