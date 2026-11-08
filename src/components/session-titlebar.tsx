import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {
	AppWindow,
	ArrowLeft,
	Bot,
	ChevronDown,
	CircleDollarSign,
	Cpu,
	FolderGit2,
	GitFork,
	Tag,
	Users,
} from "lucide-react";
import {type ReactNode, useCallback} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {foldBudget} from "../lib/titlebar-fold";
import {TOOLBAR_ROVING_OPTIONS, useRovingToolbar} from "../lib/use-roving-toolbar";

import {useSessionRename} from "../hooks/use-session-rename";
import {herdrPanesQueryOptions} from "../lib/api/herdr";
import {sessionHasLiveTerminal} from "../lib/terminal-host-capabilities";
import {openSessionInFinder, sessionOpenInQueryOptions, type SessionDetailData} from "../lib/api/sessions";
import {writeClipboardText} from "../lib/clipboard";
import {formatModelName} from "../lib/model-name";
import {formatUsd} from "../lib/session-cost";
import {usePins} from "../lib/pin-store";
import {forkDisabledReason} from "../lib/session-fork";
import {getSessionMenuItems, type SessionMenuSession} from "../lib/session-menu-items";
import {ArchivedBadge} from "./archived-badge";
import {SessionCostPill} from "./session-cost-pill";
import {MenuEntries, SESSION_MENU_CAPABILITIES, type TranscriptViewActions} from "./session-actions-menu";
import {useRenameAfterMenuClose} from "./use-rename-after-menu-close";
import {useSessionMenuRunner} from "./use-session-menu-runner";
import {SessionTitleButton} from "./session-title-heading";
import {useSessionTitleShortcuts} from "./use-session-title-shortcuts";
import {TitlebarHiddenCountContext} from "./titlebar-fold-context";
import {useTitlebarFold} from "./use-titlebar-fold";
import {useToast} from "./toast-context";
import {
	ContextMenu,
	ContextMenuTrigger,
	Menu,
	MenuContent,
	MenuItem,
	MenuGroup,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

const TITLE_CLASS =
	"-mx-2 h-6 min-w-0 cursor-text truncate rounded-r5 border-0 bg-transparent px-2 text-left text-[13px]/[19px] font-medium text-primary select-none hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus comfortable:-mx-3 comfortable:h-[var(--cds-h-control)] comfortable:px-3 comfortable:rounded-r6 comfortable:text-[14px]/[20px]";

/* Upstream `qh`: the toolbar root's ring, shown when focus parks on it after losing the focused item. */
const TOOLBAR_FOCUS_RING_CLASS =
	"outline-none focus-visible:outline-hidden forced-colors:focus-visible:-outline-offset-2 focus-visible:[box-shadow:inset_0_0_0_1px_var(--cds-fill-accent,Highlight)]";

/*
 * Upstream `Y2`'s geometry (`Am`/`Qn`): padded under panels with the `inside` divider (a strip of padding and a
 * `--cds-toolbar-line` hairline drawn by `::after`), flush with the `look` divider otherwise. The negative inline
 * margin stands in for upstream's `epitaxy-titlebar` `-ms-2 -me-2`, so the content keeps its place as the pad grows.
 */
const TOOLBAR_PADDED_CLASS =
	"flex items-center gap-1 px-[var(--cds-toolbar-pad-inline,0px)] -mx-[var(--cds-toolbar-pad-inline,0px)] pt-[var(--cds-toolbar-pad-block,0.25rem)]";
const TOOLBAR_FLUSH_CLASS = "flex items-center gap-1 pt-[var(--cds-toolbar-pad-block,0.25rem)]";
const TOOLBAR_INSIDE_CLASS =
	"relative pb-[calc(var(--cds-toolbar-pad-block,0.25rem)_+_var(--cds-toolbar-strip,0px))] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b-[length:var(--cds-toolbar-line,0px)] after:border-[color:var(--color-border-line)] [[data-cds=Panel]>&]:after:border-b-0 [[data-cds=Panel]>.cds-root>&]:after:border-b-0";
/* Upstream `WE` gains `min-h-control` under the `inside` divider; local has no wrapper, so the lead and trail carry it. */
const CONTROL_ROW_CLASS = "min-h-[var(--cds-h-control)]";
const TOOLBAR_LOOK_CLASS =
	"relative min-h-[min(var(--cds-h-control,0px)_+_2_*_var(--cds-toolbar-pad-block,0.25rem),var(--cds-toolbar-line,0px)_*_1000)] border-[color:var(--color-border-line)] border-b-[length:var(--cds-toolbar-line,0px)] pb-[calc(var(--cds-toolbar-pad-block,0.25rem)_-_var(--cds-toolbar-line,0px))]";

/* Upstream `MY`'s chevron: `lu("text-secondary")`, where `lu = Hj` drops the ink under fizzy-lake panels and the ghost button's text-primary shows. */
function chevronClass(panels: boolean): string {
	return `flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 ${panels ? "text-primary" : "text-secondary"} transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus data-[popup-open]:bg-fill-ghost-hover comfortable:rounded-r6 comfortable:size-7`;
}

/* Upstream's `cc-lined-title-group`: gap pad-md - 6px (2 / 6), min-width 32 + h-control + gap, 8 + h-control + gap while the pills are compact. */
const TITLE_GROUP_CLASS =
	"cc-lined-title-group flex items-center gap-0.5 min-w-[58px] group-data-[pills-compact]/lead:min-w-[34px] comfortable:gap-1.5 comfortable:min-w-[66px] comfortable:group-data-[pills-compact]/lead:min-w-[42px]";

const PILL_CLASS =
	"inline-flex h-5 min-w-0 shrink-0 cursor-default items-center gap-[3px] rounded-r5 bg-primary/10 dark:bg-alpha-2 px-[5px] text-caption leading-[15px] text-secondary no-underline select-none transition-colors hover:bg-alpha-3 data-[popup-open]:bg-alpha-3 dark:hover:bg-alpha-3 dark:data-[popup-open]:bg-alpha-3";

/** `https://github.com/owner/repo` from the session's `pr-link`, the one remote URL the index knows. */
const MENU_TOOLTIP_MAX_GRAPHEMES = 80;
const GRAPHEMES = new Intl.Segmenter(undefined, {granularity: "grapheme"});

/** Upstream's chevron tooltip: titles over 80 graphemes are cut to 79 plus an ellipsis; an empty title gives "More options". */
function menuTooltipLabel(title: string): string {
	if (title.trim() === "") return "More options";
	const graphemes = Array.from(GRAPHEMES.segment(title), ({segment}) => segment);
	if (graphemes.length <= MENU_TOOLTIP_MAX_GRAPHEMES) return `More options for ${title}`;
	return `More options for ${graphemes
		.slice(0, MENU_TOOLTIP_MAX_GRAPHEMES - 1)
		.join("")
		.trimEnd()}…`;
}

function repositoryUrl(pr: SessionDetailData["pr"]): string | null {
	if (pr === undefined) return null;
	try {
		return `${new URL(pr.url).origin}/${pr.repository}`;
	} catch {
		return null;
	}
}

type Toast = ReturnType<typeof useToast>;

async function copyWithToast(toast: Toast, text: string, what: string): Promise<void> {
	const copied = await writeClipboardText(text);
	toast(
		copied
			? {kind: "success", message: `${what} copied to clipboard.`}
			: {
					kind: "error",
					message: `Couldn’t copy the ${what.toLowerCase()}. Try again.`,
				},
	);
}

function downloadUrl(href: string): void {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = "";
	anchor.click();
}

type PillIcon = React.ComponentType<{
	className?: string;
	"aria-hidden"?: boolean;
}>;

/** Icon + label; the label turns sr-only when the titlebar is narrow. */
function PillContent({icon: Icon, label, compact}: {icon: PillIcon; label: string; compact: boolean}) {
	return (
		<>
			{compact && <Icon aria-hidden className="size-3 shrink-0" />}
			<span data-origin-label="" className={compact ? "sr-only" : "truncate"}>
				{label}
			</span>
		</>
	);
}

function OriginPill({
	kind,
	icon,
	label,
	title,
	compact,
}: {
	kind: string;
	icon: PillIcon;
	label: string;
	title?: string;
	compact: boolean;
}) {
	return (
		<span data-origin-pill={kind} title={title ?? label} className={PILL_CLASS}>
			<PillContent icon={icon} label={label} compact={compact} />
		</span>
	);
}

/** The session fields the project menu reads. */
export type ProjectMenuSession = Pick<SessionDetailData, "projectPath" | "cwd" | "gitBranch" | "pr">;

/**
 * The project menu's items: the composer branch strip's project button, and the header menu's
 * Project submenu, which keeps them reachable while the strip is hidden.
 */
export function ProjectMenuItems({sessionId, session}: {sessionId: string; session: ProjectMenuSession}) {
	const toast = useToast();
	const path = session.projectPath ?? session.cwd;
	const originUrl = useQuery(sessionOpenInQueryOptions(sessionId)).data?.githubUrl ?? null;
	const repository = originUrl ?? repositoryUrl(session.pr);
	const branch = session.gitBranch;

	const copy = async (text: string, what: string) => copyWithToast(toast, text, what);

	return (
		<>
			{path !== null && (
				<MenuItem
					onSelect={() => {
						openSessionInFinder(sessionId).catch(() => {
							toast({
								kind: "error",
								message: "Couldn’t open the folder in Finder.",
							});
						});
					}}
				>
					Open in Finder
				</MenuItem>
			)}
			{path !== null && <MenuItem onSelect={() => void copy(path, "Path")}>Copy path</MenuItem>}
			{branch !== null && <MenuItem onSelect={() => void copy(branch, "Branch name")}>Copy branch name</MenuItem>}
			{repository !== null && (
				<MenuItem onSelect={() => window.open(repository, "_blank", "noopener,noreferrer")}>
					Open repository on GitHub
				</MenuItem>
			)}
		</>
	);
}

/** Local-only session actions, offered in the header menu after upstream's items. */
export interface SessionHeaderLocalActions {
	resumeCommand: string;
	forkCommand: string;
	/** Absent when there is nothing to generate: a summary exists or the setting hides it. */
	onGenerateSummary?: (() => void) | undefined;
	generatingSummary?: boolean;
}

function HeaderLocalSection({
	sessionId,
	project,
	local,
}: {
	sessionId: string;
	project: ProjectMenuSession;
	local: SessionHeaderLocalActions;
}) {
	const toast = useToast();
	return (
		<>
			<MenuSeparator />
			<MenuGroup>
				<MenuSub>
					<MenuSubTrigger>Project</MenuSubTrigger>
					<MenuSubContent>
						<ProjectMenuItems sessionId={sessionId} session={project} />
					</MenuSubContent>
				</MenuSub>
				<MenuItem onSelect={() => void copyWithToast(toast, sessionId, "Session ID")}>Copy session ID</MenuItem>
				<MenuItem onSelect={() => void copyWithToast(toast, local.resumeCommand, "Resume command")}>
					Copy resume command
				</MenuItem>
				<MenuItem onSelect={() => void copyWithToast(toast, local.forkCommand, "Fork command")}>
					Copy fork command
				</MenuItem>
				<MenuItem
					onSelect={() => {
						downloadUrl(`/api/raw?sessionId=${sessionId}`);
					}}
				>
					Download raw JSONL
				</MenuItem>
				{local.onGenerateSummary !== undefined &&
					(local.generatingSummary === true ? (
						<MenuItem disabled>Generating summary…</MenuItem>
					) : (
						<MenuItem onSelect={local.onGenerateSummary}>Generate AI summary</MenuItem>
					))}
			</MenuGroup>
		</>
	);
}

/** Mounted only while the chevron or title context menu is open, so a closed menu never queries. */
function HeaderMenuBody({
	sessionId,
	data,
	title,
	isActive,
	requestRename,
	local,
	transcriptView,
}: {
	sessionId: string;
	data: SessionDetailData;
	title: string;
	isActive: boolean;
	requestRename: () => void;
	local: SessionHeaderLocalActions | undefined;
	transcriptView: SessionHeaderTranscriptView | undefined;
}) {
	const {data: herdr} = useQuery(herdrPanesQueryOptions);
	const {data: openIn} = useQuery(sessionOpenInQueryOptions(sessionId));
	const pins = usePins();
	const cwd = openIn?.cwd ?? data.cwd ?? data.projectPath;
	const bridgeSessionId = openIn?.bridgeSessionId ?? null;
	const prUrl = data.pr?.url ?? null;
	const pinned = pins.isPinned(sessionId);
	const hasLiveTerminal = sessionHasLiveTerminal(herdr?.panes, sessionId);
	const menuSession: SessionMenuSession = {
		title,
		pinned,
		readState: "read",
		archived: data.archived,
		prUrl,
		hasLiveTerminal,
		forkDisabledReason: forkDisabledReason({working: isActive, cwd}),
		cwd,
		bridgeSessionId,
	};
	if (transcriptView !== undefined) {
		menuSession.transcriptView = {
			mode: transcriptView.mode,
			defaultMode: transcriptView.defaultMode,
			hasThinking: transcriptView.hasThinking,
		};
	}
	const run = useSessionMenuRunner({
		sessionId,
		cwd,
		bridgeSessionId,
		prUrl,
		requestRename,
		...(transcriptView === undefined ? {} : {transcriptView}),
	});
	return (
		<>
			<MenuEntries
				entries={getSessionMenuItems(menuSession, SESSION_MENU_CAPABILITIES, {
					surface: "header",
				})}
				run={run}
			/>
			{local !== undefined && <HeaderLocalSection sessionId={sessionId} project={data} local={local} />}
		</>
	);
}

/** The session's transcript view, which the header's Transcript view submenu shows and sets. */
export interface SessionHeaderTranscriptView extends TranscriptViewActions {
	hasThinking: boolean;
}

export interface SessionTitlebarProps {
	sessionId: string;
	data: SessionDetailData;
	isActive: boolean;
	/** The trail's pane controls: Changes, then View options. */
	paneToggles?: ReactNode;
	/** Local-only actions for the header menu's trailing section. */
	local?: SessionHeaderLocalActions;
	/** The trailing View options menu trigger. */
	viewOptions?: ReactNode;
	/** The AI summary, shown as the title button's tooltip and description. */
	summary?: string | null;
	/** Adds the Transcript view ▸ submenu to the header menu. */
	transcriptView?: SessionHeaderTranscriptView;
	/** The trail leads with the session rail toggle, which folds first and allows one more hidden button. */
	railToggleFoldable?: boolean;
}

/**
 * claude.ai/code's 32px session titlebar. Lead: the parent-session back pill
 * (subagent transcripts only), the rename title button (right-click opens the header menu at the pointer), the chevron header
 * menu and the origin pills (local badges), which collapse
 * to icons once the title truncates. Trail: the pane toggles, which fold into
 * View options one at a time as the title drops under 100px, then View options.
 */
export function SessionTitlebar({
	sessionId,
	data,
	isActive,
	paneToggles,
	local,
	viewOptions,
	summary = null,
	transcriptView,
	railToggleFoldable = false,
}: SessionTitlebarProps) {
	const rename = useSessionRename(sessionId, data.title);
	const panels = useFizzyLake("panels");
	const cwd = data.cwd ?? data.projectPath;
	useSessionTitleShortcuts({
		sessionId,
		archived: data.archived,
		prUrl: data.pr?.url,
		cwd,
		startEditing: rename.startEditing,
	});
	const menuRename = useRenameAfterMenuClose(rename.startEditing);
	const contextRename = useRenameAfterMenuClose(rename.startEditing);
	const {
		ref: foldRef,
		hiddenCount,
		pillsCompact: compact,
	} = useTitlebarFold(foldBudget({railToggleFoldable, hiddenCount: 0}).maxHidden);
	const modelLabel = formatModelName(data.model);
	const repositoryName = data.pr?.repository.slice(data.pr.repository.lastIndexOf("/") + 1).trim();
	const roving = useRovingToolbar(TOOLBAR_ROVING_OPTIONS);
	const rovingRef = roving.ref;
	const ref = useCallback(
		(element: HTMLDivElement | null) => {
			foldRef.current = element;
			rovingRef(element);
		},
		[foldRef, rovingRef],
	);

	return (
		/* Upstream's header `t1` renders the row as the cds Toolbar (`Y2`) labelled "Session tools" with the `tu` roving options. */
		// oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- upstream's root has no tabindex; the roving hook keeps one item at 0 and adds 0 to the root only while focus parks on it
		<div
			ref={ref}
			role="toolbar"
			aria-label="Session tools"
			data-cds="Toolbar"
			onFocus={roving.onFocus}
			onKeyDown={roving.onKeyDown}
			{...(panels ? {} : {"data-flush": ""})}
			data-testid="session-titlebar"
			data-perf-region="header"
			className={`${panels ? `${TOOLBAR_PADDED_CLASS} ${TOOLBAR_INSIDE_CLASS}` : `${TOOLBAR_FLUSH_CLASS} ${TOOLBAR_LOOK_CLASS}`} ${TOOLBAR_FOCUS_RING_CLASS} min-w-0`}
		>
			<div
				data-titlebar-lead=""
				{...(compact ? {"data-pills-compact": ""} : {})}
				className={`group/lead flex min-w-0 items-center ${panels ? CONTROL_ROW_CLASS : ""}`}
			>
				{/* Upstream's lead spacer at every width, max(0px, 1rem - tiles-padding - tiles-border): 7px, so the title text clears the chat card edge (x=48 at 390). */}
				<span aria-hidden className="w-[7px] shrink-0" />
				<div className="flex min-w-0 items-center gap-1.5">
					{data.parentSessionId !== undefined && (
						<Link
							to="/session/$id"
							params={{id: data.parentSessionId}}
							className={`${PILL_CLASS} cursor-pointer`}
						>
							<ArrowLeft aria-hidden className="size-3 shrink-0" />
							Parent session
						</Link>
					)}
					<div className={TITLE_GROUP_CLASS}>
						<ContextMenu
							onOpenChangeComplete={contextRename.onOpenChangeComplete}
							disabled={rename.editing}
						>
							{/* Upstream's title wrapper is an h2 named by the title, and a span while renaming (`k = D ? "span" : "h2"`). */}
							<ContextMenuTrigger
								className="flex min-w-[32px] items-center group-data-[pills-compact]/lead:min-w-[8px]"
								render={({children, ...props}) =>
									rename.editing ? (
										<span {...props}>{children}</span>
									) : (
										<h2 {...props} aria-label={rename.title}>
											{children}
										</h2>
									)
								}
							>
								<SessionTitleButton rename={rename} className={TITLE_CLASS} summary={summary} />
							</ContextMenuTrigger>
							<MenuContent finalFocus={contextRename.finalFocus}>
								<HeaderMenuBody
									sessionId={sessionId}
									data={data}
									title={rename.title}
									isActive={isActive}
									requestRename={contextRename.requestRename}
									local={local}
									transcriptView={transcriptView}
								/>
							</MenuContent>
						</ContextMenu>
						<Menu onOpenChangeComplete={menuRename.onOpenChangeComplete}>
							<Tooltip content={menuTooltipLabel(rename.title)} side="bottom">
								<MenuTrigger
									aria-label={`More options for ${rename.title}`}
									className={chevronClass(panels)}
								>
									<ChevronDown aria-hidden className="size-4" />
								</MenuTrigger>
							</Tooltip>
							<MenuContent finalFocus={menuRename.finalFocus} sideOffset={6}>
								<HeaderMenuBody
									sessionId={sessionId}
									data={data}
									title={rename.title}
									isActive={isActive}
									requestRename={menuRename.requestRename}
									local={local}
									transcriptView={transcriptView}
								/>
							</MenuContent>
						</Menu>
					</div>
					{data.archived && <ArchivedBadge />}
					<span
						data-origin-pills=""
						className={`flex items-center gap-[3px] ${compact ? "shrink-0" : "min-w-0"}`}
					>
						{data.pr !== undefined && repositoryName && repositoryUrl(data.pr) !== null && (
							<Menu>
								<MenuTrigger
									data-origin-pill="repository"
									aria-label={`Repository ${data.pr.repository}`}
									title={data.pr.repository}
									className={`${PILL_CLASS} cursor-pointer hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`}
								>
									<PillContent icon={FolderGit2} label={repositoryName} compact={compact} />
								</MenuTrigger>
								<MenuContent>
									<ProjectMenuItems sessionId={sessionId} session={data} />
								</MenuContent>
							</Menu>
						)}
						{modelLabel !== null && (
							<OriginPill kind="model" icon={Cpu} label={modelLabel} compact={compact} />
						)}
						{data.costState !== undefined && (
							<SessionCostPill cost={data.costState} className={`${PILL_CLASS} cursor-pointer`}>
								<PillContent
									icon={CircleDollarSign}
									label={formatUsd(data.costState.totalCostUSD)}
									compact={compact}
								/>
							</SessionCostPill>
						)}
						{data.entrypoint !== undefined && data.entrypoint !== "cli" && (
							<OriginPill kind="entrypoint" icon={AppWindow} label={data.entrypoint} compact={compact} />
						)}
						{data.sessionKind !== undefined && (
							<OriginPill kind="kind" icon={Tag} label={data.sessionKind} compact={compact} />
						)}
						{data.attributionAgent !== undefined && (
							<OriginPill
								kind="agent"
								icon={Bot}
								label={data.attributionAgent}
								title="Transcript attribution agent"
								compact={compact}
							/>
						)}
						{data.teamNames?.map((team) => (
							<OriginPill key={team} kind="team" icon={Users} label={team} compact={compact} />
						))}
						{data.forkedFromSessionId !== undefined && (
							<Link
								to="/session/$id"
								params={{id: data.forkedFromSessionId}}
								data-origin-pill="forked-from"
								title={`Forked from ${data.forkedFromSessionId}`}
								className={`${PILL_CLASS} cursor-pointer`}
							>
								<PillContent
									icon={GitFork}
									label={`Forked from ${data.forkedFromSessionId.slice(0, 8)}`}
									compact={compact}
								/>
							</Link>
						)}
						{isActive && (
							<span
								data-origin-pill="active"
								title="Active"
								className="inline-flex h-5 shrink-0 items-center gap-1 rounded-r3 bg-success-900 px-[5px] text-caption text-success-000"
							>
								<span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success-000" />
								<span data-origin-label="" className={compact ? "sr-only" : undefined}>
									Active
								</span>
							</span>
						)}
					</span>
				</div>
			</div>
			<div
				data-titlebar-trail=""
				className={`relative ml-auto flex shrink-0 items-center gap-1 pl-6 text-secondary ${panels ? CONTROL_ROW_CLASS : ""}`}
			>
				<TitlebarHiddenCountContext.Provider value={hiddenCount}>
					{paneToggles}
					{viewOptions}
				</TitlebarHiddenCountContext.Provider>
			</div>
		</div>
	);
}
