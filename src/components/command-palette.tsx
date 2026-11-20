import {DialogPopup} from "./ui/dialog-popup";
import {PALETTE_POPUP_CLASS, PALETTE_POPUP_STYLE, PALETTE_RADIUS, paletteBackdropClass} from "./palette-shell-classes";
import {isSessionRouteAlias} from "../lib/session-route-alias";
import {useAnsweredSessionIds, withAnsweredHolds} from "../lib/answered-sessions";
import {useFizzyLake} from "../lib/fizzy-lake";
import {Dialog} from "@base-ui/react/dialog";
import {Command, defaultFilter, useCommandState} from "cmdk";
import {useNavigate, useRouterState} from "@tanstack/react-router";
import
{
	type ClipboardEvent,
	Component,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {useQueries, useQuery, useQueryClient} from "@tanstack/react-query";
import
{
	FileText,
	Brain,
	CodeXml,
	MessageSquare,
	MessageSquarePlus,
	MessagesSquare,
	FolderOpen,
	Search,
	Home,
	SlidersHorizontal,
	Gauge,
	CircleCheckBig,
	CirclePlus,
	Keyboard,
	CornerDownLeft,
	X,
	PanelLeft,
	ListChecks,
	Activity,
	Puzzle,
	File,
	LoaderCircle,
	GitBranch,
	Link,
	Pin,
	PinOff,
	Pencil,
	Terminal,
	GitFork,
	Archive,
	ArchiveRestore,
	SquareSlash,
	Shapes,
	Clock,
	CircleHelp,
	BookText,
	TextCursorInput,
	Maximize2,
	Minimize2,
	SquareTerminal,
	FileDiff,
	Folder,
} from "lucide-react";
import {useActiveSessionsIfAvailable} from "../hooks/use-claude-events";
import {focusRegionByName, isAvailable, type JumpRegionName} from "../lib/focus-regions";
import {jumpActionKeywords, PALETTE_JUMP_ACTIONS, type PaletteJumpActionId} from "../lib/palette-jump-actions";
import {paletteFocusOrigin} from "../lib/palette-focus-origin";
import {findWaitingCard, landOnWaitingCard} from "../lib/question-landing";
import {useCoarsePointer} from "../lib/use-phone-sheet";
import type {PaletteEntrypoint, PaletteMode, PaletteModeChangeOptions} from "../hooks/use-command-palette";
import {usePaletteAutoClose} from "../hooks/use-palette-auto-close";
import {paletteCloseHold} from "../lib/palette-close-hold";
import {PASTE_ATTACH_CHARS, type PaletteBuffers, switchPaletteView} from "../lib/palette-compose";
import {clearPaletteKeys, readPaletteKeys} from "../lib/palette-keystroke-buffer";
import {paletteLoadingShown, setPaletteLoadingShown} from "../lib/palette-loading";
import {offersQuickNewSession, PALETTE_SEND_HOLD_TIMEOUT_MS, paletteSearchable} from "../lib/palette-quick-action";
import {useDebouncedValue} from "../hooks/use-debounced-value";
import {sessionIdentityQueryOptions} from "../lib/api/session-identity";
import {useSessionIdentity} from "../hooks/use-session-identity";
import {useSessionArchive} from "../hooks/use-session-archive";
import {artifactsQueryOptions, type ArtifactSummary} from "../lib/api/artifacts";
import {isTypeMediaIconWord, resolveArtifactMark, TYPE_MEDIA_ICONS} from "../lib/artifact-mark";
import {ArtifactGlyph, ArtifactMark} from "./artifact-mark";
import {encodeFilePath} from "../lib/api/file";
import {launchHerdrSession} from "../lib/api/herdr";
import {projectMemoriesQueryOptions} from "../lib/api/memories";
import {plansQueryOptions, type PlanListItem} from "../lib/api/plans";
import {assertNever} from "../lib/assert-never";
import {projectsQueryOptions} from "../lib/api/projects";
import {routinesQueryOptions, type Routine} from "../lib/api/routines";
import {artifactTimestamp} from "../lib/artifact-gallery";
import {unifiedSearchQueryOptions, type UnifiedSearchItem} from "../lib/api/search";
import
{
	recentSessionsQueryOptions,
	sessionDetailQueryOptions,
	type SessionDetailData,
	type SessionListItem,
} from "../lib/api/sessions";
import
{
	fitPaletteEmptyView,
	PALETTE_MARK_LABELS,
	paletteMark,
	paletteSecondary,
	sortLeads,
	type PaletteGroup,
	type PaletteMark,
	type PaletteMarkEntry,
} from "../lib/palette-marks";
import {buildClaudeCopyCommand} from "../lib/claude-launch-command";
import
{
	appendAttachment,
	attachContext,
	attachUploadedFiles,
	composePrompt,
	registerComposer,
	takeContextChips,
	useContextChips,
	useRestoredChipIds,
} from "../lib/context-attach";
import {writeClipboardText} from "../lib/clipboard";
import {requestHomeComposerFocus} from "../lib/home-composer-focus";
import
{
	PALETTE_FILTER_TOKENS,
	PaletteTypeSchema,
	applyPaletteFilters,
	commitPaletteTokens,
	shouldCommitPaletteTokens,
	isClientPaletteType,
	activationDirection,
	paletteChips,
	popPaletteFilter,
	paletteDateCutoff,
	nextPaletteType,
	paletteFilterHintMatch,
	paletteFilterHints,
	paletteInlineSuggestions,
	paletteProjectMatches,
	paletteQuotedText,
	paletteRepoValue,
	paletteSearchParams,
	paletteValueSuggestions,
	paletteTypeStep,
	parsePaletteTokens,
	scrollIntoStrip,
	type ActivationDirection,
	type PaletteChip,
	type PaletteChipFilter,
	type PaletteFilter,
	type PaletteFilters,
	type PaletteInlineSuggestion,
	type PaletteProject,
	type PaletteTokens,
	type PaletteType,
	type ServerPaletteType,
} from "../lib/palette-tokens";
import
{
	findLaunchedSession,
	startSessionProjects,
	type PendingLaunch,
	type StartProject,
} from "../lib/palette-start-session";
import {pin, unpin, usePins} from "../lib/pin-store";
import {toMdSlug} from "../lib/md-slug";
import {loadRecents, resolveRecentSessions, routeToRecent, type RecentEntry} from "../lib/recents-history";
import {filterRoutines, formatNextRun, routineHref, routineTitle, sortRoutines} from "../lib/routines";
import {ackedAt, useAwaitingAckVersion} from "../lib/awaiting-ack-store";
import {paletteEmptyKind, paletteEmptyMessage, paletteLiveCountMessage} from "../lib/palette-empty";
import {PaletteEmptyState} from "./palette-empty-state";
import {PaletteFilterSpoken} from "./palette-filter-spoken";
import {PaletteEmptyViewSkeleton, PaletteSkeleton} from "./palette-skeleton";
import {paletteFilterLabels, paletteTypeLabels} from "../lib/schema-choices";
import
{
	capOrganic,
	interleaveByRank,
	PALETTE_FILTERED_MAX_ITEMS,
	PALETTE_MAX_ORGANIC_ITEMS,
	paletteRank,
	paletteTokens,
	type PaletteRank,
} from "../lib/palette-rank";
import {phraseMatches, relativeBucket, titleMatches, type Snippet, type TextMatch} from "../lib/search-text";
import {createSessionCommands} from "../lib/session-commands";
import {PANE_PALETTE_COMMANDS, type PanePaletteCommandId, panePaletteActions} from "../lib/palette-pane-commands";
import {usePanePaletteState} from "../lib/palette-pane-commands-store";
import {getSessionMenuItems, type SessionMenuCapability} from "../lib/session-menu-items";
import {copySessionLink} from "../lib/session-open-in";
import {requestSessionRename} from "../lib/session-rename-request";
import {SHORTCUTS, type ShortcutId} from "../lib/shortcuts/registry";
import
{
	familyKey,
	setFamiliesCollapsed,
	showAllNestedSessions,
	toggleFamilyCollapsed,
	toggleSidebar,
	useSidebarState,
} from "../lib/sidebar-store";
import {useFamilyHeads} from "../lib/sidebar-family-heads-store";
import {familyFoldState, NESTED_SESSION_COMMANDS} from "../lib/palette-nested-sessions";
import {type ShortcutKeys, useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import {clearAll, isExplicitUnread} from "../lib/unread-store";
import {useUnseenWorkVersion} from "./use-has-unseen-work";
import {startPaletteSearchJourney} from "../lib/perf/field-journeys";
import {HighlightRuns} from "./highlight-runs";
import
{
	type PaletteCardSession,
	type PaletteCardGeneric,
	type PaletteCardTarget,
	PaletteRenameDialog,
	PaletteRowActionsButton,
	PaletteRowActionsCard,
	type RowActionsCloseOptions,
	type RowActionsRepeatKey,
} from "./palette-row-actions";
import {isMotionReduced} from "../lib/reduced-motion";
import {isAltEnter, rowActionsAnchorRect} from "./palette-row-actions-geometry";
import {PaletteThumbCard} from "./palette-thumb-card";
import {cardMorphOffset} from "./palette-thumb-measure";
import {type PaletteThumb, useUsableThumb} from "../lib/palette-thumb-store";
import {AttachedContextChips} from "./attached-context-chips";
import {useFileDropTarget} from "./composer-drop-scrim";
import {DROP_SCRIM_Z_INDEX, DropOverlay} from "./drop-overlay";
import {collectDroppedFiles, entriesFromDataTransfer} from "../lib/drop-collect";
import {useToast} from "./toast-context";
import {Icon} from "./ui/icon";
import {Pulse} from "./ui/pulse";
import {Shortcut, WIDE_KEYCAP_CLASS} from "./ui/shortcut";
import {Spinner} from "./ui/spinner";
import {ArchivedBadge} from "./archived-badge";
import {Tooltip} from "./ui/tooltip";
import {useOpenCustomize} from "./customize/open-customize";
import {useOpenSettings} from "./settings/open-settings";
import {loadSettingsDialog} from "./settings/settings-dialog-loader";
import {preloadCustomizeDialogPanel} from "./settings/customize-dialog-panel-loader";
import {type SettingsPaletteCommand, settingsPaletteCommands} from "../lib/palette-settings-commands";
import {setKeyboardShortcutsOpen} from "./keyboard-shortcuts-open";
import {makePaletteExitCopy, type PaletteExitCopy} from "../lib/palette-exit-copy";
import {runAfterOverlayDelay} from "../lib/overlay-open-note";

/*
 * The claude.ai/code ⌘K palette shell, split Search | Compose variant
 * (see .llm/upstream-sync/features/search-or-start.md). cmdk keeps the list
 * filtering and keyboard selection; the dialog, input row, headings, rows and
 * footer copy upstream's geometry.
 */

const MODE_LABELS =
{
	search: "Search",
	compose: "Write a message…",
} as const satisfies Record<PaletteMode, string>;

/** Draft key for Compose-mode attachment chips, which ride along with the launch prompt. */
const COMPOSE_DRAFT_KEY = "command-palette-compose";
/** Upstream's hidden screen-reader hint, referenced by the Search textarea's aria-describedby. */
const PALETTE_KEYS_HINT_ID = "command-palette-keys-hint";

const GROUP_CLASS =
	"[&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:text-[12px]/[17px] [&_[cmdk-group-heading]]:text-muted-as-secondary [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col";

/** Fetched deep enough that sessions needing attention surface even when they are not the newest. */
export const PALETTE_RECENT_LIMIT = 25;

/** Upstream's empty-view Recents pool (`df = 9`), before the fitter trims it. */
const RECENTS_POOL = 9;

/**
 * Upstream debounces its server search by 500ms (`Vn(query,500)`) because that search is remote
 * and semantic. Ours is local FTS, so we keep a shorter 150ms debounce on purpose.
 */
export const PALETTE_SEARCH_DEBOUNCE_MS = 150;

/** Upstream's `Rh=3e3`: a settled 1-character no-match waits 3s before the live region speaks it. */
const PALETTE_SILENT_LIVE_DELAY_MS = 3000;

/** Upstream's `Qd=8e3`: a type-tab or filtered search still unsettled after 8s becomes a failure. */
const PALETTE_FILTERED_STALL_MS = 8000;

/** Server hit kinds plus the kinds the Projects, Artifacts and Scheduled tabs list client-side. */
type SearchKind = UnifiedSearchItem["kind"] | "project" | "artifact" | "routine";

const KIND_ICONS =
{
	session: <CodeXml />,
	plan: <FileText />,
	memory: <Brain />,
	file: <File />,
	project: <FolderOpen />,
	artifact: <Shapes />,
	routine: <Clock />,
} as const satisfies Record<SearchKind, ReactNode>;

/** Upstream's hint-row icon map `__` (owner, a cloud facet, dropped). */
const PALETTE_FILTER_ICONS =
{
	date: <Clock />,
	repo: <GitBranch />,
	project: <FolderOpen />,
	type: <Shapes />,
	archived: <Archive />,
	actions: <Keyboard />,
} as const satisfies Record<PaletteFilter, ReactNode>;

/**
 * Upstream's neutral Badge in a "Filter by" hint row: filled, or (fizzy-lake color, upstream's
 * `stacks:` variants) an outlined pill on the border-line ink.
 */
const FILTER_BADGE_CLASS =
{
	fizzy: "inline-flex items-center gap-1 h-[22px] rounded-full border-[1.5px] border-solid border-[color:var(--upstream-border-line)] dark:border-strong bg-transparent px-[7px] text-xs leading-[15px] font-[540] text-secondary shrink-0 -my-px relative top-px",
	base: "inline-flex items-center gap-1 h-[22px] rounded-[5.5px] px-2 text-xs leading-[15px] font-medium bg-fill-ghost-hover text-secondary shrink-0 -my-px relative top-px",
};

/** A Badge label's descender pad, which upstream's `stacks:pb-0` drops. */
const BADGE_LABEL_PAD =
{
	fizzy: "pb-0",
	base: "pb-[0.05em]",
};

/** Server hit kinds that keep the server's title matches instead of upstream's phrase runs. */
const KEEPS_SERVER_MATCHES =
{
	session: false,
	plan: true,
	memory: true,
	file: true,
} as const satisfies Record<UnifiedSearchItem["kind"], boolean>;

/** One typed-search row: an instant title match over recents, or a server hit. */
interface SearchRow
{
	kind: SearchKind;
	id: string;
	title: string;
	titleMatches: readonly TextMatch[];
	snippet: Snippet | undefined;
	mtime: string;
	/** Upstream's row mark; server hits outside the session list only know awaiting. */
	mark?: PaletteMark;
	/** Known from the session list; other server hits leave it unset. */
	archived?: boolean;
	/** The session's open PR, shown as upstream's "PR #N" secondary; known from the session list only. */
	prNumber?: number;
	href: string | undefined;
	/** Replaces the relative-time meta, e.g. a routine's next run. */
	meta?: string;
	/** An Artifacts-tab row's type and icon word, for its ArtifactMark. */
	artifact?: Pick<ArtifactSummary, "kind" | "icon">;
}

/**
 * Upstream c74dd5c13 `x_(…, "palette", fallback)`: a typed artifact gets the bare 20px tinted ArtifactMark,
 * an untyped one its own icon at md in the row's ink (the icon word's glyph, else the Artifacts glyph).
 */
function ArtifactRowIcon({artifact}: {artifact: Pick<ArtifactSummary, "kind" | "icon">})
{
	const mark = resolveArtifactMark(
		{
			typeKind: artifact.kind,
		},
	);
	if (mark !== undefined) return <ArtifactMark kind={mark.kind} size="menu" />;
	const {icon} = artifact;
	return (
		<ArtifactGlyph
			icon={icon !== null && isTypeMediaIconWord(icon) ? TYPE_MEDIA_ICONS[icon] : "Artifacts"}
			size="md"
			className="shrink-0"
		/>
	);
}

function rowIcon(row: SearchRow): ReactNode
{
	if (row.mark !== undefined) return <PaletteSessionIcon mark={row.mark} />;
	if (row.artifact !== undefined) return <ArtifactRowIcon artifact={row.artifact} />;
	return KIND_ICONS[row.kind];
}

/** Resolves a session's mark: live, or from the snapshot frozen when the palette settled. */
type MarkOf = (session: SessionListItem) => PaletteMarkEntry | undefined;

function sessionRow(session: SessionListItem, matches: readonly TextMatch[], markOf: MarkOf): SearchRow
{
	const mark = markOf(session)?.mark;
	return {
		kind: "session",
		id: session.id,
		title: session.title,
		titleMatches: matches,
		snippet: undefined,
		mtime: session.mtime,
		...(mark === undefined
			? {}
			:
				{
					mark,
				}),
		archived: session.archived,
		...(session.pr === undefined
			? {}
			:
				{
					prNumber: session.pr.number,
				}),
		href: undefined,
	};
}

/** Upstream's non-conversation row label runs: every occurrence of the whole trimmed, lowercased query. */
function labelMatches(title: string, query: string): TextMatch[]
{
	return phraseMatches(title, query.toLowerCase()) ?? [];
}

function instantRows(sessions: readonly SessionListItem[], query: string, markOf: MarkOf): SearchRow[]
{
	const rows: SearchRow[] = [];
	for (const session of sessions)
	{
		if (titleMatches(session.title, query) !== null)
		{
			rows.push(sessionRow(session, labelMatches(session.title, query), markOf));
		}
	}
	return rows;
}

/** Apply the `repo:`/`project:` and `date:` tokens to cached recents, like the server does to hits. */
function filterSessions(
	sessions: readonly SessionListItem[],
	tokens: PaletteTokens,
	projects: readonly PaletteProject[],
	now: number,
): SessionListItem[]
{
	const {project, date} = tokens;
	const cutoff = date === undefined ? null : paletteDateCutoff(date, now);
	const resolved = project === undefined ? undefined : projects.find((p) => paletteProjectMatches(project, p));
	return sessions.filter((session) =>
	{
		if (cutoff !== null && Date.parse(session.mtime) < cutoff) return false;
		if (project === undefined) return true;
		if (resolved !== undefined)
		{
			return session.projectName === resolved.name || session.project === resolved.projectPath;
		}
		return paletteProjectMatches(
			project,
			{
				id: "",
				name: session.projectName,
				projectPath: session.project,
			},
		);
	});
}

function projectRows(projects: readonly PaletteProjectItem[], text: string): SearchRow[]
{
	const rows: SearchRow[] = [];
	for (const project of projects)
	{
		if (text !== "" && titleMatches(project.name, text) === null) continue;
		rows.push(
			{
				kind: "project",
				id: project.id,
				title: project.name,
				titleMatches: labelMatches(project.name, text),
				snippet: undefined,
				mtime: project.lastActivity,
				href: undefined,
			},
		);
		if (rows.length === PALETTE_RECENT_LIMIT) break;
	}
	return rows;
}

/** The Artifacts tab: newest first, narrowed by the query text. */
function artifactRows(artifacts: readonly ArtifactSummary[], text: string): SearchRow[]
{
	const rows: SearchRow[] = [];
	for (const artifact of artifacts.toSorted((a, b) => artifactTimestamp(b) - artifactTimestamp(a)))
	{
		if (text !== "" && titleMatches(artifact.title, text) === null) continue;
		rows.push(
			{
				kind: "artifact",
				id: artifact.id,
				title: artifact.title,
				titleMatches: labelMatches(artifact.title, text),
				snippet: undefined,
				mtime: new Date(artifactTimestamp(artifact)).toISOString(),
				href: undefined,
				artifact:
				{
					kind: artifact.kind,
					icon: artifact.icon,
				},
			},
		);
		if (rows.length === PALETTE_RECENT_LIMIT) break;
	}
	return rows;
}

/** The Scheduled tab: active routines by next run, narrowed like the /routines search. */
function routineRows(routines: readonly Routine[], text: string, now: number): SearchRow[]
{
	const {visible} = filterRoutines(
		routines,
		{
			search: text,
			schedule: "all",
			status: "all",
			includeCompleted: false,
		},
	);
	return sortRoutines(visible, "next-run")
		.slice(0, PALETTE_RECENT_LIMIT)
		.map((routine) =>
		{
			const title = routineTitle(routine);
			return {
				kind: "routine",
				id: routine.toolUseId,
				title,
				titleMatches: labelMatches(title, text),
				snippet: undefined,
				mtime: new Date(routine.createdAt).toISOString(),
				href: routineHref(routine),
				meta:
					routine.nextRunAt === null
						? (routine.humanSchedule ?? routine.schedule ?? "")
						: formatNextRun(routine.nextRunAt, now),
			};
		});
}

interface PaletteProjectItem extends PaletteProject
{
	lastActivity: string;
	memoryCount: number;
}

/** A plan or memory the Plans and Memories tabs list with an empty query. */
interface PaletteDoc
{
	kind: "plan" | "memory";
	id: string;
	title: string;
	mtime: string;
	href: string;
	projectIds: readonly string[];
}

function planDocs(plans: readonly PlanListItem[]): PaletteDoc[]
{
	return plans.map((plan) =>
	{
		const slug = toMdSlug(plan.filename);
		return {
			kind: "plan",
			id: slug,
			title: plan.title,
			mtime: plan.mtime,
			href: `/plan/${encodeURIComponent(slug)}`,
			projectIds: plan.projects.map((project) => project.projectId),
		};
	});
}

/** Upstream lists a type's 25 most recent items when the query has no text; `repo:` and `date:` still narrow. */
function recentDocRows(
	docs: readonly PaletteDoc[],
	tokens: PaletteTokens,
	projects: readonly PaletteProject[],
	now: number,
): SearchRow[]
{
	const {project, date} = tokens;
	const cutoff = date === undefined ? null : paletteDateCutoff(date, now);
	const resolved = project === undefined ? undefined : projects.find((p) => paletteProjectMatches(project, p));
	return docs
		.filter((doc) =>
		{
			if (cutoff !== null && Date.parse(doc.mtime) < cutoff) return false;
			return project === undefined || (resolved !== undefined && doc.projectIds.includes(resolved.id));
		})
		.toSorted((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime))
		.slice(0, PALETTE_RECENT_LIMIT)
		.map((doc) => (
		{
			kind: doc.kind,
			id: doc.id,
			title: doc.title,
			titleMatches: [],
			snippet: undefined,
			mtime: doc.mtime,
			href: doc.href,
		}));
}

/** A server hit; a session hit known to the session list takes that session's mark, PR and archived state. */
function serverRow(
	item: UnifiedSearchItem,
	query: string,
	sessionsById: ReadonlyMap<string, SessionListItem>,
	markOf: MarkOf,
): SearchRow
{
	const row: SearchRow =
	{
		kind: item.kind,
		id: item.id,
		title: item.title,
		// Plan, memory and file hits stand in for upstream's conversation rows, the only ones that keep server matches.
		titleMatches: KEEPS_SERVER_MATCHES[item.kind] ? item.titleMatches : labelMatches(item.title, query),
		snippet: item.snippet,
		mtime: item.mtime,
		href: item.href,
	};
	const session = item.kind === "session" ? sessionsById.get(item.id) : undefined;
	if (session === undefined)
	{
		return item.state === "waiting"
			?
				{
					...row,
					mark: "awaiting",
				}
			: row;
	}
	const mark = markOf(session)?.mark;
	return {
		...row,
		...(mark === undefined
			? {}
			:
				{
					mark,
				}),
		archived: session.archived,
		...(session.pr === undefined
			? {}
			:
				{
					prNumber: session.pr.number,
				}),
	};
}

const NO_SESSIONS: readonly SessionListItem[] = [];
const NO_PROJECTS: readonly PaletteProjectItem[] = [];
const NO_ARTIFACTS: readonly ArtifactSummary[] = [];
const NO_ROUTINES: readonly Routine[] = [];
const NO_PLANS: readonly PlanListItem[] = [];

/** Module-level so useQueries memoizes the combined lists across renders. */
function memoryListData<T>(
	results: ReadonlyArray<
	{
		data: T;
	}>,
): T[]
{
	return results.map((result) => result.data);
}

/** "/…" hint rows, or null to search normally (also when no hint matches). */
function hintsFor(query: string): PaletteFilter[] | null
{
	const hints = paletteFilterHints(query);
	return hints === null || hints.length === 0 ? null : hints;
}

const NEW_SESSION_VALUE = "start:new-session";

function rowKey(row: Pick<SearchRow, "kind" | "id">): string
{
	return `${row.kind}:${row.id}`;
}

function commandMatches(label: string, query: string, keywords: readonly string[] = []): boolean
{
	return defaultFilter(label, query, [...keywords]) > 0;
}

/** A marked session promoted above Recents into Needs attention or Active. */
interface LeadSession
{
	kind: "session";
	id: string;
	title: string;
	mark: PaletteMark;
	prNumber?: number;
}

/** What an empty-view session row shows besides its title. */
interface PaletteSessionRow
{
	kind: "session";
	id: string;
	title: string;
	mark?: PaletteMark;
	prNumber?: number;
}

/** A Recents row: a visited page from the per-tab MRU, or an mtime-ordered session fallback. */
type PaletteRecent =
	| PaletteSessionRow
	|
	  {
			kind: "page";
			id: string;
			entry: PalettePageEntry;
			title: string;
	  };

/** The empty view's action rows: upstream's "New session" and the pinned "Jump to question". */
interface PaletteActionRow
{
	kind: "action";
	id: "new_session" | "jump_to_question";
}

type EmptyViewRow = LeadSession | PaletteRecent | PaletteActionRow;

type PalettePageKind = "plan" | "memory" | "project" | "command";
type PalettePageEntry = RecentEntry &
{
	kind: PalettePageKind;
};

const PAGE_ICONS =
{
	plan: <FileText />,
	memory: <Brain />,
	project: <FolderOpen />,
	command: <SquareSlash />,
} as const satisfies Record<PalettePageKind, ReactNode>;

function isPageEntry(entry: RecentEntry): entry is PalettePageEntry
{
	return entry.kind in PAGE_ICONS;
}

/** The visited pages Recents shows: sessions and page kinds, not subagent lists or the page on screen. */
function mruRecents(
	history: readonly RecentEntry[],
	currentKey: string | undefined,
	sessionRows: ReadonlyMap<string, PaletteSessionRow>,
): PaletteRecent[]
{
	const recents: PaletteRecent[] = [];
	for (const entry of history)
	{
		if (entry.key === currentKey) continue;
		if (entry.kind === "session")
		{
			const id = entry.key.slice("session:".length);
			if (isSessionRouteAlias(id)) continue;
			recents.push(
				sessionRows.get(id) ??
				{
					kind: "session",
					id,
					title: entry.title ?? "Untitled",
				},
			);
		}
		else if (isPageEntry(entry))
		{
			recents.push(
				{
					kind: "page",
					id: entry.key,
					entry,
					title: entry.title ?? "Untitled",
				},
			);
		}
	}
	return recents;
}

function paletteSessionRow(session: SessionListItem, mark: PaletteMark | undefined): PaletteSessionRow
{
	return {
		kind: "session",
		id: session.id,
		title: session.title,
		...(mark === undefined
			? {}
			:
				{
					mark,
				}),
		...(session.pr === undefined
			? {}
			:
				{
					prNumber: session.pr.number,
				}),
	};
}

/** The empty view's membership frozen at the palette's first settle (upstream's `{recentIds, leadIds}`). */
interface PaletteViewSnapshot
{
	leadIds: readonly string[];
	recentIds: readonly string[];
}

/**
 * Build upstream's fitted empty view, dropping the page on screen. Recents follow the per-tab visit
 * MRU, falling back to mtime-ordered sessions until the tab has visited anything else; marked
 * sessions lead by rank, and `fitPaletteEmptyView` sizes the groups to the 440px list. With a
 * frozen `view`, membership and lead order come from it and only titles follow the live sessions;
 * a frozen lead whose mark is gone drops out, and a row in `actedIds` that newly leads joins the leads. When
 * `jumpOffered`, the pinned jump row takes its share
 * of the fit.
 */
function paletteGroups(
	sessions: readonly SessionListItem[],
	history: readonly RecentEntry[],
	currentKey: string | undefined,
	currentSessionId: string | undefined,
	markOf: MarkOf,
	view: PaletteViewSnapshot | null,
	jumpOffered: boolean,
	actedIds: ReadonlySet<string>,
):
{
	groups: PaletteGroup<EmptyViewRow>[];
	view: PaletteViewSnapshot;
}
{
	const leads: LeadSession[] = [];
	const marked = new Map<string, LeadSession>();
	const sessionRows = new Map<string, PaletteSessionRow>();
	const fallback: PaletteRecent[] = [];
	for (const session of sessions)
	{
		const entry = session.id === currentSessionId ? undefined : markOf(session);
		const row = paletteSessionRow(session, entry?.mark);
		sessionRows.set(session.id, row);
		if (session.id === currentSessionId) continue;
		if (entry !== undefined)
			marked.set(
				session.id,
				{
					...row,
					mark: entry.mark,
				},
			);
		if (entry?.leads === true)
			leads.push(
				{
					...row,
					mark: entry.mark,
				},
			);
		fallback.push(row);
	}
	const visited = mruRecents(history, currentKey, sessionRows);
	const recents = visited.length > 0 ? visited : fallback;
	let leadRows: LeadSession[];
	let pool: PaletteRecent[];
	if (view === null)
	{
		leadRows = sortLeads(leads);
		pool = recents.slice(0, RECENTS_POOL);
	}
	else
	{
		const recentRows = new Map(recents.map((row) => [row.id, row]));
		// A row acted on while open reads its live mark, so a new lead (Mark as unread) joins the frozen leads.
		const frozenLeads = new Set(view.leadIds);
		leadRows = sortLeads([
			...view.leadIds.flatMap((id) => marked.get(id) ?? []),
			...leads.filter((row) => actedIds.has(row.id) && !frozenLeads.has(row.id)),
		]);
		pool = view.recentIds.flatMap((id) => recentRows.get(id) ?? []);
	}
	return {
		groups: fitPaletteEmptyView<EmptyViewRow>(
			{
				leads: leadRows,
				recents: pool,
				actions: [
					{
						kind: "action",
						id: "new_session",
					},
				],
				jump: jumpOffered
					?
						{
							kind: "action",
							id: "jump_to_question",
						}
					: undefined,
			},
		),
		view: view ??
		{
			leadIds: leadRows.map((row) => row.id),
			recentIds: pool.map((row) => row.id),
		},
	};
}

/** Pages reachable by typing; upstream keeps navigation out of the empty state. */
const NAV_COMMANDS = [
	{
		to: "/",
		label: "Home",
		icon: <Home />,
		keywords: ["home", "start"],
	},
	{
		to: "/sessions",
		label: "Sessions",
		icon: <MessageSquare />,
		keywords: ["session", "history"],
	},
	{
		to: "/active",
		label: "Active",
		icon: <Activity />,
		keywords: ["active", "live", "running"],
	},
	{
		to: "/pinned",
		label: "Pinned",
		icon: <Pin />,
		keywords: ["pin", "star", "favorite"],
	},
	{
		to: "/projects",
		label: "Projects",
		icon: <FolderOpen />,
		keywords: ["project", "repo"],
	},
	{
		to: "/plans",
		label: "Plans",
		icon: <FileText />,
		keywords: ["plan", "markdown"],
	},
	{
		to: "/memories",
		label: "Memories",
		icon: <Brain />,
		keywords: ["memory", "claude.md"],
	},
	{
		to: "/tasks",
		label: "Tasks",
		icon: <ListChecks />,
		keywords: ["task", "todo"],
	},
	{
		to: "/customize",
		label: "Customize",
		icon: <Puzzle />,
		keywords: ["skill", "plugin"],
	},
] as const;

type SessionCommandId =
	| "pin"
	| "unpin"
	| "rename"
	| "copy-link"
	| "archive"
	| "unarchive"
	| "hide-nested"
	| "show-nested"
	| "copy-resume"
	| "copy-fork";

interface SessionCommand
{
	id: SessionCommandId;
	label: string;
}

const SESSION_COMMAND_ICONS =
{
	pin: <Pin />,
	unpin: <PinOff />,
	rename: <Pencil />,
	"copy-link": <Link />,
	archive: <Archive />,
	unarchive: <ArchiveRestore />,
	"hide-nested": <Minimize2 />,
	"show-nested": <Maximize2 />,
	"copy-resume": <Terminal />,
	"copy-fork": <GitFork />,
} as const satisfies Record<SessionCommandId, ReactNode>;

/** Upstream's contextual commands surface for "session" plus each action's own verb. */
const SESSION_COMMAND_KEYWORDS =
{
	pin: ["session", "pin", "star"],
	unpin: ["session", "unpin", "pin", "star"],
	rename: ["session", "rename", "title"],
	"copy-link": ["session", "copy", "link", "url"],
	archive: ["session", "archive", "hide"],
	unarchive: ["session", "unarchive", "archive", "restore"],
	"hide-nested": ["session", ...NESTED_SESSION_COMMANDS.hide_nested_sessions.keywords],
	"show-nested": ["session", ...NESTED_SESSION_COMMANDS.show_nested_sessions.keywords],
	"copy-resume": ["session", "copy", "resume", "command"],
	"copy-fork": ["session", "copy", "fork", "command"],
} as const satisfies Record<SessionCommandId, readonly string[]>;

const SESSION_COMMAND_CAPABILITIES: ReadonlySet<SessionMenuCapability> = new Set([
	"pin",
	"rename",
	"copyLink",
	"archive",
]);

/**
 * The session on screen as ⌘K commands: the shared menu model's quoted titles, a family head's
 * Hide/Show nested sessions (upstream's catalog puts it after fork), then the CLI copies.
 */
function currentSessionCommands(
	detail: SessionDetailData,
	pinned: boolean,
	nested?:
	{
		hidden: boolean;
	},
): SessionCommand[]
{
	const menu = getSessionMenuItems(
		{
			title: detail.title,
			pinned,
			readState: "read",
			archived: detail.archived,
			prUrl: null,
			hasLiveTerminal: false,
			forkDisabledReason: null,
			cwd: null,
			bridgeSessionId: null,
		},
		SESSION_COMMAND_CAPABILITIES,
		{
			surface: "palette",
		},
	);
	const commands = menu.flatMap((entry): SessionCommand[] =>
	{
		if (entry.kind !== "item") return [];
		switch (entry.id)
		{
			case "pin":
			case "unpin":
			case "rename":
			case "copy-link":
			case "archive":
			case "unarchive":
				return [
					{
						id: entry.id,
						label: entry.label,
					},
				];
			default:
				return [];
		}
	});
	const nestedCommands: SessionCommand[] =
		nested === undefined
			? []
			: [
					nested.hidden
						?
							{
								id: "show-nested",
								label: NESTED_SESSION_COMMANDS.show_nested_sessions.label,
							}
						:
							{
								id: "hide-nested",
								label: NESTED_SESSION_COMMANDS.hide_nested_sessions.label,
							},
				];
	return [
		...commands,
		...nestedCommands,
		{
			id: "copy-resume",
			label: "Copy resume command",
		},
		{
			id: "copy-fork",
			label: "Copy fork command",
		},
	];
}

function startProjectValue(project: StartProject): string
{
	return `start-project:${project.id}`;
}

/** The "New session" flow: the typed text, then a project picker, then the herdr launch. */
type StartStep = "idle" | "picker" | "launching";

/** Upstream `m7`'s delay between the palette closing and a pane command running. */
const PANE_COMMAND_DELAY_MS = 100;

/** Lucide stand-ins for upstream's Anthropicons on the pane rows. */
const PANE_COMMAND_ICONS: Record<PanePaletteCommandId, ReactNode> =
{
	toggle_terminal_pane: <SquareTerminal />,
	toggle_diff_pane: <FileDiff />,
	toggle_files_pane: <Folder />,
	toggle_side_chat: <MessagesSquare />,
	new_terminal: <SquareTerminal />,
	close_side_pane: <X />,
	expand_side_pane: <Maximize2 />,
	collapse_side_pane: <Minimize2 />,
};

interface PaletteAction
{
	label: string;
	icon: ReactNode;
	run: () => void;
	shortcut?: ShortcutId;
	/** Extra fuzzy-match words, as upstream's `[...searchHints, bang]`. */
	keywords?: readonly string[];
	/** The cmdk value, when not `action:<label>`. */
	value?: string;
	/** Upstream's `onIntent`/`onDwell`: warms what the action opens, on hover or keyboard selection. */
	warm?: () => void;
}

/** One typed-search entry before the fetched rows: a title row or a command, tagged with upstream's `we` rank. */
type TypedPaletteItem =
	|
	  {
			kind: "row";
			row: SearchRow;
			rank: PaletteRank;
	  }
	|
	  {
			kind: "session-command";
			command: SessionCommand;
			rank: PaletteRank;
	  }
	|
	  {
			kind: "action";
			action: PaletteAction;
			rank: PaletteRank;
	  }
	|
	  {
			kind: "nav";
			command: (typeof NAV_COMMANDS)[number];
			rank: PaletteRank;
	  };

/** Upstream's `Ss()` commands: one per Settings nav member, built once. */
const SETTINGS_COMMANDS = settingsPaletteCommands();

/** Prefetches a settings command's section: the Settings dialog, plus the Customize panel for its members. */
function warmSettingsCommand(command: SettingsPaletteCommand): void
{
	void loadSettingsDialog();
	if (command.member.kind === "customize") void preloadCustomizeDialogPanel();
}

function useCurrentSessionId(): string | undefined
{
	const routeId = useRouterState(
		{
			select: (state) =>
			{
				for (const match of state.matches)
				{
					if (match.routeId === "/session/$id") return match.params.id;
				}
				return null;
			},
		},
	);
	return useSessionIdentity(routeId) ?? undefined;
}

/**
 * Keep this opening's MRU fixed while its legacy alias identities finish loading; `settled` turns
 * true once none is still pending.
 */
function usePaletteHistory():
{
	entries: RecentEntry[];
	settled: boolean;
}
{
	const [snapshot] = useState(loadRecents);
	const aliases = useMemo(
		() => [
			...new Set(
				snapshot
					.filter((entry) => entry.kind === "session")
					.map((entry) => entry.key.slice("session:".length))
					.filter(isSessionRouteAlias),
			),
		],
		[snapshot],
	);
	const identities = useQueries(
		{
			queries: aliases.map(sessionIdentityQueryOptions),
		},
	);
	const owners = new Map(
		aliases.map((alias, index) =>
		{
			const identity = identities[index];
			return [alias, identity?.isSuccess ? identity.data.sessionId : null] as const;
		}),
	);
	return {
		entries: resolveRecentSessions(snapshot, (alias) => owners.get(alias) ?? null),
		settled: identities.every((identity) => !identity.isPending),
	};
}

/**
 * Upstream's staged settle timers (`af` in the palette chunk), started at mount: each stage stops waiting on one
 * tier of empty-view lists, and the last one freezes the view even if the MRU identity lookups never finish.
 */
const PALETTE_SETTLE_STAGES_MS = [300, 450, 3000] as const;

/** Upstream `Hh`: an Enter pressed while the empty view was pending opens its first row if the rows land this soon. */
const ENTER_AHEAD_MS = 1000;
/** Keys that never cancel a queued Enter: upstream's capture listener skips Enter and the bare modifiers. */
const ENTER_AHEAD_IGNORED_KEYS = new Set(["Shift", "Meta", "Control", "Alt"]);

/** Every listed session's mark at the palette's first settle (upstream's `poolMarks`). */
function freezeMarks(sessions: readonly SessionListItem[], now: number): ReadonlyMap<string, PaletteMarkEntry>
{
	return new Map(
		sessions.flatMap((session) =>
		{
			const entry = paletteMark(
				session,
				now,
				{
					explicitUnread: isExplicitUnread(session.id),
					ackedAtMs: ackedAt(session.id),
				},
			);
			return entry === undefined ? [] : [[session.id, entry] as const];
		}),
	);
}

export interface CommandPaletteProps
{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode?: PaletteMode;
	onModeChange?: (mode: PaletteMode, options?: PaletteModeChangeOptions) => void;
	/** Which shortcut opened it: the search-only entry (⇧⌘K) never treats long text as a draft. */
	entrypoint?: PaletteEntrypoint;
	/** Upstream `onSendHoldChange`: the opener refuses every close while a send is held. */
	onSendHoldChange?: (held: boolean) => void;
	/** False for a phone-latched open (upstream `Ge`'s `!phoneOff`): Compose is out of reach until the next open. */
	composeAvailable?: boolean;
}

export function CommandPalette({
	open,
	onOpenChange,
	mode: controlledMode,
	onModeChange,
	entrypoint = "default",
	onSendHoldChange,
	composeAvailable = true,
}: CommandPaletteProps)
{
	const [uncontrolledMode, setUncontrolledMode] = useState<PaletteMode>("search");
	const mode = controlledMode ?? uncontrolledMode;
	const setMode = onModeChange ?? setUncontrolledMode;
	// The loading shell's hand-off lasts for the open it started.
	useEffect(() =>
	{
		if (!open) setPaletteLoadingShown(false);
	}, [open]);

	const popupRef = useRef<HTMLDivElement>(null);

	return (
		<>
			<Dialog.Root open={open} onOpenChange={onOpenChange}>
				<Dialog.Portal>
					<PaletteBackdrop />
					<PalettePopup
						popupRef={popupRef}
						open={open}
						mode={mode}
						entrypoint={entrypoint}
						onModeChange={setMode}
						onOpenChange={onOpenChange}
						onSendHoldChange={onSendHoldChange}
						composeAvailable={composeAvailable}
					/>
				</Dialog.Portal>
			</Dialog.Root>
			<PaletteExitSnapshot open={open} popupRef={popupRef} />
		</>
	);
}

/**
 * Upstream `KN`: on every close, snapshots the still-open popup into an exit copy before React commits the close, then
 * plays it; a reopen drops a copy still fading. Every close path (Escape, backdrop, a pick, auto-close) passes here.
 */
class PaletteExitSnapshot extends Component<
{
	open: boolean;
	popupRef: RefObject<HTMLDivElement | null>;
}>
{
	private copy: PaletteExitCopy | null = null;

	override getSnapshotBeforeUpdate(
		previous: Readonly<
		{
			open: boolean;
		}>,
	): PaletteExitCopy | null
	{
		const popup = this.props.popupRef.current;
		if (!previous.open || this.props.open || popup === null) return null;
		try
		{
			return makePaletteExitCopy(popup);
		}
		catch
		{
			return null;
		}
	}

	override componentDidUpdate(
		previous: Readonly<
		{
			open: boolean;
		}>,
		_state: unknown,
		copy: PaletteExitCopy | null,
	): void
	{
		if (!previous.open && this.props.open)
		{
			this.copy?.remove();
			this.copy = null;
		}
		if (copy !== null)
		{
			this.copy = copy;
			copy.play();
		}
	}

	/** Leaving the page drops a copy still fading, with its safety timer, so neither outlives the palette. */
	override componentWillUnmount(): void
	{
		this.copy?.remove();
		this.copy = null;
	}

	override render(): null
	{
		return null;
	}
}

/** Upstream `ah`'s zone cap: `Yg()` (`max_per_message_upload_count`, server ceiling 20) + 1. */
const PALETTE_DROP_MAX_FILES = 21;

function hasFileDrag(event: DragEvent): boolean
{
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Upstream `ah`'s page-level `useDropZone`: while the palette is open (Search or Compose), a full-page zone takes every
 * file drop away from the page underneath, flattens dropped folders (`ue`, at most `maxFiles`) and hands the accepted
 * files on; rejections and notices are dropped silently, as upstream. Idle, the zone is `pointer-events-none`; during a
 * file drag it catches pointer events and draws upstream's `Oc` overlay. A pointer press or move on a stuck overlay
 * (a drag that left the window without a dragleave) dismisses it until the next file dragenter.
 */
function PaletteFileDropZone({
	onDropFiles,
	disabled,
}: {
	onDropFiles: (files: readonly File[]) => void;
	/** Upstream `disabled = !composeEntry || …`: a phone-latched open takes no drops. */
	disabled: boolean;
})
{
	const zoneRef = useRef<HTMLDivElement>(null);
	// The walk is async: deliver to the latest render's handler, and not at all once the palette has closed.
	const deliver = useRef<typeof onDropFiles | null>(onDropFiles);
	useLayoutEffect(() =>
	{
		deliver.current = onDropFiles;
	});
	useEffect(
		() => () =>
		{
			deliver.current = null;
		},
		[],
	);
	const state = useFileDropTarget(
		{
			targetRef: zoneRef,
			priority: "overlay",
			disabled,
			onTransferDrop: (transfer) =>
			{
				// Read the items now: the DataTransfer empties once the drop handler returns.
				const entries = entriesFromDataTransfer(transfer);
				void collectDroppedFiles(
					entries,
					{
						multiple: true,
						maxFiles: PALETTE_DROP_MAX_FILES,
					},
				).then(({accepted}) =>
				{
					if (accepted.length > 0) deliver.current?.(accepted);
				});
			},
		},
	);
	const [dismissed, setDismissed] = useState(false);
	if (dismissed && state === "idle") setDismissed(false);
	useEffect(() =>
	{
		const onDragEnter = (event: DragEvent) =>
		{
			if (hasFileDrag(event)) setDismissed(false);
		};
		window.addEventListener("dragenter", onDragEnter, true);
		return () =>
		{
			window.removeEventListener("dragenter", onDragEnter, true);
		};
	}, []);
	const shown = dismissed ? "idle" : state;
	const dismiss = () =>
	{
		setDismissed(true);
	};
	return (
		<div className="cds-root pointer-events-auto contents" data-cds-portal="">
			<div
				ref={zoneRef}
				aria-hidden="true"
				data-testid="palette-file-drop-zone"
				data-drag-over={shown === "on-target" ? "" : undefined}
				className={shown === "idle" ? "fixed inset-0 pointer-events-none" : "fixed inset-0"}
				style={
				{
					zIndex: DROP_SCRIM_Z_INDEX,
				}}
				onPointerDown={dismiss}
				onPointerMove={dismiss}
			>
				{shown !== "idle" && <DropOverlay />}
			</div>
		</div>
	);
}

/**
 * Mounted only while open, after the portal attaches (so after the loading shell unmounts). Taking over from the
 * shell (upstream `_U()`), it skips the fade-in so the swap doesn't flash.
 */
function PaletteBackdrop()
{
	const [handoff] = useState(paletteLoadingShown);
	return <Dialog.Backdrop className={paletteBackdropClass(handoff)} />;
}

/** Mounted only while open, so the query resets on every open like upstream. */
function PalettePopup({
	popupRef,
	open,
	mode,
	entrypoint,
	onModeChange,
	onOpenChange,
	onSendHoldChange,
	composeAvailable,
}: {
	popupRef: RefObject<HTMLDivElement | null>;
	open: boolean;
	mode: PaletteMode;
	entrypoint: PaletteEntrypoint;
	onModeChange: (mode: PaletteMode, options?: PaletteModeChangeOptions) => void;
	onOpenChange: (open: boolean) => void;
	onSendHoldChange: ((held: boolean) => void) | undefined;
	composeAvailable: boolean;
})
{
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const openCustomize = useOpenCustomize();
	const look = useFizzyLake("color") ? "fizzy" : "base";
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const [rowActions, setRowActions] = useState<
	{
		/** The row's cmdk value ({@link rowKey}). */
		key: string;
		target: PaletteCardTarget;
		anchorRect: ReturnType<typeof rowActionsAnchorRect>;
		/** Opened from the shown thumb card: the card morphs from the thumb's spot (upstream's `fromThumbCard`). */
		morphFrom:
		{
			x: number;
			y: number;
		} | null;
	} | null>(null);
	// Upstream's thumb card slot (`left-full` beside the palette) and whether the card shows a picture.
	const [thumbSlot, setThumbSlot] = useState<HTMLDivElement | null>(null);
	const [thumbShown, setThumbShown] = useState(false);
	// Upstream's `returningId`: the row whose card just closed, so its thumb card slides back out of the card.
	const [thumbReturningKey, setThumbReturningKey] = useState<string | null>(null);
	// The row card's Rename dialog, kept mounted through its close animation.
	const [renaming, setRenaming] = useState<
	{
		session: PaletteCardSession;
		open: boolean;
	} | null>(null);
	// Upstream keeps separate Search and Compose drafts; `query` is the active view's. Keys typed while the
	// module loaded seed the opening view (upstream's `d` buffer under `qe`/`Je`).
	const [buffers, setBuffers] = useState<PaletteBuffers>(() =>
	{
		const seed = readPaletteKeys();
		return {
			search: mode === "search" ? seed : "",
			compose: mode === "compose" ? seed : "",
		};
	});
	// The seed is taken; upstream's mount layout effect also puts the caret after it.
	useLayoutEffect(() =>
	{
		clearPaletteKeys();
		const input = inputRef.current;
		if (input !== null && input.value !== "") input.setSelectionRange(input.value.length, input.value.length);
	}, []);
	const [tab, setTab] = useState<PaletteType>("all");
	// Upstream's filter object: committed chips, kept apart from the query text.
	const [filters, setFilters] = useState<PaletteFilters>({});
	// A session this tab just answered marks as running at the click, as the sidebar row draws it.
	const answeredIds = useAnsweredSessionIds();
	const {data} = useQuery(
		{
			...recentSessionsQueryOptions(PALETTE_RECENT_LIMIT),
			select: useCallback(
				(recent: {sessions: SessionListItem[]}) =>
					answeredIds.size === 0
						? recent
						:
							{
								...recent,
								sessions: withAnsweredHolds(recent.sessions, answeredIds),
							},
				[answeredIds],
			),
		},
	);
	const queryClient = useQueryClient();
	const currentSessionId = useCurrentSessionId();
	const detailQuery = useQuery(
		{
			...sessionDetailQueryOptions(currentSessionId ?? ""),
			enabled: currentSessionId !== undefined,
		},
	);
	const currentDetail = currentSessionId === undefined ? null : (detailQuery.data ?? null);
	const paneState = usePanePaletteState();
	const pins = usePins();
	const familyHeads = useFamilyHeads();
	const {collapsedFamilies} = useSidebarState();
	const familyFold = familyFoldState(familyHeads, collapsedFamilies);
	const currentNested =
		currentSessionId !== undefined && familyHeads?.includes(currentSessionId) === true
			?
				{
					hidden: collapsedFamilies.includes(familyKey(currentSessionId)),
				}
			: undefined;
	const setArchived = useSessionArchive(currentSessionId ?? "");
	const toast = useToast();
	const activeSessions = useActiveSessionsIfAvailable();
	const [startStep, setStartStep] = useState<StartStep>("idle");
	const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
	// Controlled so the picker can preselect its first project; cmdk selects the first row otherwise.
	const [selectedValue, setSelectedValue] = useState("");
	// Upstream's onDwell: a settings command reached by the keyboard warms its section like a hover does.
	useEffect(() =>
	{
		const command = SETTINGS_COMMANDS.find(({key}) => selectedValue === `settings:${key}`);
		if (command !== undefined) warmSettingsCommand(command);
	}, [selectedValue]);
	// Opening a session or jumping to a question puts focus somewhere new, so closing must not pull it back.
	const restoreFocusRef = useRef(true);
	const restoreFocus = useCallback(() => restoreFocusRef.current, []);
	// Upstream's held send (host `sendHeldRef`): the local launch holds from `launching` until it releases.
	const sendHeldRef = useRef(false);
	const reportSendHold = useCallback(
		(held: boolean) =>
		{
			sendHeldRef.current = held;
			onSendHoldChange?.(held);
		},
		[onSendHoldChange],
	);
	// Upstream decides "Jump to question" once per open, from the waiting card on the page at that moment.
	const [jumpOffered] = useState(() => typeof document !== "undefined" && findWaitingCard(document) !== null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const composeChips = useContextChips(COMPOSE_DRAFT_KEY);
	const restoredComposeChipIds = useRestoredChipIds(COMPOSE_DRAFT_KEY);
	const compose = mode === "compose";
	const query = compose ? buffers.compose : buffers.search;
	function setQuery(next: string)
	{
		setBuffers((current) =>
			compose
				?
					{
						...current,
						compose: next,
					}
				:
					{
						...current,
						search: next,
					},
		);
	}

	function switchView(next: PaletteMode, options?: PaletteModeChangeOptions)
	{
		if (next === "compose" && !composeAvailable) return;
		setBuffers((current) => switchPaletteView(next, current));
		onModeChange(next, options);
	}

	// Compose attachments land as chips here (⌘U, the paperclip); they are dropped when the palette closes.
	useEffect(() =>
	{
		const unregister = registerComposer(
			COMPOSE_DRAFT_KEY,
			{
				insertText: (text) =>
				{
					setBuffers((current) => (
					{
						...current,
						compose: appendAttachment(current.compose, text),
					}));
				},
				focus: () => inputRef.current?.focus(),
			},
		);
		return () =>
		{
			unregister();
			takeContextChips(COMPOSE_DRAFT_KEY);
		};
	}, []);

	const pathname = useRouterState(
		{
			select: (state) => state.location.pathname,
		},
	);
	const {entries: history, settled: historySettled} = usePaletteHistory();
	// Upstream freezes the open palette at its first settle: marks for every listed row, then the
	// empty view's membership, so rows never jump groups while it is open. Rows acted on through
	// row actions read their live mark again. The popup unmounts on close, so reopening starts fresh.
	const [settleStage, setSettleStage] = useState(0);
	useEffect(() =>
	{
		// Stage 1 relaxes only lists local doesn't have, so it skips the render.
		const timers = PALETTE_SETTLE_STAGES_MS.slice(1).map((ms, index) =>
			setTimeout(() =>
			{
				setSettleStage((stage) => Math.max(stage, index + 2));
			}, ms),
		);
		return () =>
		{
			for (const timer of timers) clearTimeout(timer);
		};
	}, []);
	const settleTimedOut = settleStage >= PALETTE_SETTLE_STAGES_MS.length;
	// Upstream's `er`: sessions stand in for the code-session lists (relaxed at stage 2) and the MRU lookups for the
	// chat recents (relaxed at stage 3); stage 1's projects/spaces/tasks listings have no local counterpart.
	const emptyViewReady = (data !== undefined || settleStage >= 2) && (historySettled || settleTimedOut);
	const [frozenMarks, setFrozenMarks] = useState<ReadonlyMap<string, PaletteMarkEntry> | null>(null);
	const [frozenView, setFrozenView] = useState<PaletteViewSnapshot | null>(null);
	// Upstream `[Ti, Ei] = useState(_U)`: an open that began on the loading shell draws its pending skeleton at once.
	const [skeletonHandoff, setSkeletonHandoff] = useState(paletteLoadingShown);
	const enterAheadRef = useRef<number | "off" | "none">("none");
	const [actedIds, setActedIds] = useState<ReadonlySet<string>>(() => new Set());
	const settled = data !== undefined && (historySettled || settleTimedOut);
	if (settled && frozenMarks === null) setFrozenMarks(freezeMarks(data.sessions, Date.now()));
	// A hand "Mark as unread" or "Mark as completed" changes only a store, so acted rows recompute on its version too.
	const unseenVersion = useUnseenWorkVersion();
	const ackVersion = useAwaitingAckVersion();
	const markOf = useCallback(
		(session: SessionListItem) =>
			frozenMarks === null || actedIds.has(session.id)
				? paletteMark(
						session,
						Date.now(),
						{
							explicitUnread: isExplicitUnread(session.id),
							ackedAtMs: ackedAt(session.id),
						},
					)
				: frozenMarks.get(session.id),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the store versions invalidate the store reads above.
		[frozenMarks, actedIds, unseenVersion, ackVersion],
	);
	const emptyView = useMemo(
		() =>
			paletteGroups(
				data?.sessions ?? [],
				history,
				currentSessionId === undefined ? routeToRecent(pathname)?.key : `session:${currentSessionId}`,
				currentSessionId,
				markOf,
				frozenView,
				jumpOffered,
				actedIds,
			),
		[data, history, pathname, currentSessionId, markOf, frozenView, jumpOffered, actedIds],
	);

	const trimmedQuery = query.trim();
	const hints = hintsFor(trimmedQuery);
	const tokens = useMemo(
		() => applyPaletteFilters(parsePaletteTokens(trimmedQuery), filters),
		[trimmedQuery, filters],
	);
	const chips = useMemo(() => paletteChips(filters, (data?.sessions ?? []).map(paletteRepoValue)), [filters, data]);
	/** Date, repo or archived narrowing, which upstream's Clear filters drops while keeping the text. */
	const hasFilterTokens = tokens.date !== undefined || tokens.project !== undefined || tokens.archived === true;
	// A trailing bare `key:` lists that filter's values instead of results, but only for a searchable (≤50) query.
	const valueSuggestions = useMemo(
		() =>
			hints === null && paletteSearchable(query) ? paletteValueSuggestions(query, data?.sessions ?? []) : null,
		[hints, query, data],
	);
	const actionsOnly = tokens.actions === true;
	// A searchable query starting with "!" searches only the jump bangs: no sessions, server search or Quick actions.
	const bangQuery =
		!compose &&
		hints === null &&
		valueSuggestions === null &&
		paletteSearchable(query) &&
		tokens.text.startsWith("!");
	// Upstream's `nn`: a raw query over 50 characters is a prompt, so Search offers only New session and skips search.
	const longPrompt = !compose && hints === null && valueSuggestions === null && offersQuickNewSession(query);
	const startable = hints === null && valueSuggestions === null && !actionsOnly && !bangQuery;
	const searchable = startable && !longPrompt;
	const type = tokens.type ?? tab;
	const filtered =
		type !== "all" || tokens.project !== undefined || tokens.date !== undefined || tokens.archived === true;
	// Outside Compose, the New session prompt is the free text, never a filter token.
	const startPrompt = compose ? trimmedQuery : tokens.text;
	const canStart = startPrompt !== "" && startable;
	// Compose always offers its Quick actions row; Search only for a long prompt (⌘⏎ still starts from any query).
	const offersNewSession = canStart && (compose || longPrompt);
	// Upstream's inline "Filter by <Name>: <Value>" rows for values the last words name, minus facets already set.
	const inlineSuggestions = useMemo(
		() =>
			searchable && !compose
				? paletteInlineSuggestions(query, data?.sessions ?? []).filter((suggestion) =>
						suggestion.filter === "type"
							? suggestion.value !== tab
							: filters[suggestion.filter] === undefined,
					)
				: [],
		[searchable, compose, query, data, filters, tab],
	);
	// Upstream's "filter by" sentence and bare-keyword hints, which join the results instead of replacing them.
	const hintMatch = searchable && !compose ? paletteFilterHintMatch(query) : undefined;
	const inlineHints =
		hintMatch === undefined ||
		(!hintMatch.sentence && inlineSuggestions.some((suggestion) => hintMatch.keys.includes(suggestion.filter)))
			? []
			: hintMatch.keys;
	const inlineHintsFirst =
		hintMatch !== undefined &&
		(hintMatch.sentence
			? query.slice(0, hintMatch.start).trim() === ""
			: hintMatch.keys.every((filter) => PALETTE_FILTER_TOKENS[filter].startsWith(trimmedQuery.toLowerCase())));
	// `archived:` searches archived sessions only, like upstream.
	const archivedQuery = useQuery(
		{
			...recentSessionsQueryOptions(PALETTE_RECENT_LIMIT, "archived"),
			enabled: tokens.archived === true,
		},
	);
	const searchedSessions = (tokens.archived === true ? archivedQuery.data : data)?.sessions ?? NO_SESSIONS;
	const projectsQuery = useQuery(
		{
			...projectsQueryOptions(),
			enabled:
				type === "projects" || type === "memories" || tokens.project !== undefined || startStep === "picker",
		},
	);
	const projects = projectsQuery.data ?? NO_PROJECTS;
	const artifactsQuery = useQuery(
		{
			...artifactsQueryOptions,
			enabled: type === "artifacts",
		},
	);
	const artifacts = artifactsQuery.data ?? NO_ARTIFACTS;
	const routinesQuery = useQuery(
		{
			...routinesQueryOptions,
			enabled: type === "scheduled",
		},
	);
	const routines = routinesQuery.data ?? NO_ROUTINES;
	const listsRecentDocs = searchable && tokens.text === "";
	const plansQuery = useQuery(
		{
			...plansQueryOptions(),
			enabled: listsRecentDocs && type === "plans",
		},
	);
	const plans = plansQuery.data ?? NO_PLANS;
	const memoryLists = useQueries(
		{
			queries: projects
				.filter((project) => project.memoryCount > 0)
				.map((project) => (
				{
					...projectMemoriesQueryOptions(project.id),
					enabled: listsRecentDocs && type === "memories",
				})),
			combine: memoryListData,
		},
	);
	const memoryDocs = useMemo(
		(): PaletteDoc[] =>
			memoryLists.flatMap((list) =>
				(list?.memories ?? []).map((memory) =>
				{
					const slug = toMdSlug(memory.filename);
					return {
						kind: "memory" as const,
						id: `${memory.project}/${slug}`,
						title: memory.title,
						mtime: memory.mtime,
						href: `/memory/${encodeURIComponent(memory.project)}/${encodeURIComponent(slug)}`,
						projectIds: [memory.project],
					};
				}),
			),
		[memoryLists],
	);
	const searchesSessions = searchable && (type === "all" || type === "sessions");

	const debouncedQuery = useDebouncedValue(trimmedQuery, PALETTE_SEARCH_DEBOUNCE_MS);
	const debouncedParams =
		hintsFor(debouncedQuery) === null
			? paletteSearchParams(applyPaletteFilters(parsePaletteTokens(debouncedQuery), filters), tab, projects)
			: null;
	const serverActive =
		searchable &&
		tokens.text !== "" &&
		!isClientPaletteType(type) &&
		(tokens.project === undefined || !projectsQuery.isPending);
	const serverSearch = useQuery(
		{
			...unifiedSearchQueryOptions(
				debouncedParams ??
				{
					query: "",
				},
			),
			enabled: serverActive && debouncedParams !== null && debouncedParams.query !== "",
		},
	);
	const fetching = serverActive && (debouncedQuery !== trimmedQuery || serverSearch.isFetching);
	const stallKey =
		fetching && (type !== "all" || hasFilterTokens) ? JSON.stringify([trimmedQuery, tab, filters]) : null;
	const [stalledKey, setStalledKey] = useState<string | null>(null);
	useEffect(() =>
	{
		if (stallKey === null) return undefined;
		const timer = setTimeout(() =>
		{
			setStalledKey(stallKey);
		}, PALETTE_FILTERED_STALL_MS);
		return () =>
		{
			clearTimeout(timer);
			setStalledKey(null);
		};
	}, [stallKey]);
	const stalled = stallKey !== null && stalledKey === stallKey;
	const searching = fetching && !stalled;

	const visibleSessions = useMemo(
		() =>
			filterSessions(
				searchedSessions.filter((session) => session.id !== currentSessionId),
				tokens,
				projects,
				Date.now(),
			),
		[searchedSessions, currentSessionId, tokens, projects],
	);

	// Sessions (or All with only filter tokens) and no text lists recents; Projects, Artifacts and Scheduled are searched client-side.
	const listing = useMemo((): SearchRow[] | null =>
	{
		if (!searchable || (trimmedQuery === "" && tab === "all" && chips.length === 0)) return null;
		if (type === "projects") return projectRows(projects, tokens.text);
		if (type === "artifacts") return artifactRows(artifacts, tokens.text);
		if (type === "scheduled") return routineRows(routines, tokens.text, Date.now());
		if (type === "plans" && tokens.text === "") return recentDocRows(planDocs(plans), tokens, projects, Date.now());
		if (type === "memories" && tokens.text === "") return recentDocRows(memoryDocs, tokens, projects, Date.now());
		if ((type === "sessions" || type === "all") && tokens.text === "")
		{
			return visibleSessions.slice(0, PALETTE_RECENT_LIMIT).map((session) => sessionRow(session, [], markOf));
		}
		return null;
	}, [
		searchable,
		trimmedQuery,
		tab,
		chips.length,
		type,
		projects,
		artifacts,
		routines,
		plans,
		memoryDocs,
		tokens,
		visibleSessions,
		markOf,
	]);

	const instant = useMemo(
		() => (!searchesSessions || tokens.text === "" ? [] : instantRows(visibleSessions, tokens.text, markOf)),
		[searchesSessions, visibleSessions, tokens.text, markOf],
	);

	// Instant rows keep their position; server rows append, minus what is already shown.
	const sessionsById = useMemo(
		() => new Map(searchedSessions.map((session) => [session.id, session])),
		[searchedSessions],
	);
	const serverRows = useMemo(() =>
	{
		if (!serverActive || debouncedQuery !== trimmedQuery || serverSearch.data === undefined)
		{
			return [];
		}
		const shown = new Set(instant.map(rowKey));
		return serverSearch.data.items
			.filter((item) => item.id !== currentSessionId || item.kind !== "session")
			.map((item) => serverRow(item, tokens.text, sessionsById, markOf))
			.filter((row) => !shown.has(rowKey(row)));
	}, [
		serverActive,
		serverSearch.data,
		debouncedQuery,
		trimmedQuery,
		instant,
		currentSessionId,
		tokens.text,
		sessionsById,
		markOf,
	]);

	// Sessions the → card can act on: recents carry archive/bucket state, server hits do not.
	const cardSessions = useMemo(() =>
	{
		const byId = new Map<string, PaletteCardSession>();
		for (const row of serverRows)
		{
			if (row.kind !== "session") continue;
			byId.set(
				row.id,
				{
					id: row.id,
					title: row.title,
					mtime: row.mtime,
					archived: undefined,
					bucket: undefined,
				},
			);
		}
		for (const session of searchedSessions)
		{
			byId.set(
				session.id,
				{
					id: session.id,
					title: session.title,
					mtime: session.mtime,
					archived: session.archived,
					bucket: session.bucket,
					unseenError: session.unseenError,
					failedAt: session.failedAt,
				},
			);
		}
		return byId;
	}, [searchedSessions, serverRows]);

	const artifactsById = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts]);

	// Upstream's thumb card shows for a selected artifact row with a screenshot, in Search only.
	const selectedArtifact = selectedValue.startsWith("artifact:")
		? artifactsById.get(selectedValue.slice("artifact:".length))
		: undefined;
	const selectedThumbnailUrl = selectedArtifact?.thumbnailUrl ?? null;
	const selectedThumb = useUsableThumb(
		useMemo(
			(): PaletteThumb | undefined =>
				selectedThumbnailUrl === null
					? undefined
					:
						{
							src: selectedThumbnailUrl,
						},
			[selectedThumbnailUrl],
		),
	);
	// Upstream `Cs = U&&!phone&&…`: a phone-latched open shows no thumb card.
	const thumbRowKey = !compose && composeAvailable && selectedThumb !== undefined ? selectedValue : null;
	const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

	// The listed rows upstream's generic card `yt` covers, by cmdk value.
	const genericRows = useMemo(() =>
	{
		const byKey = new Map<string, SearchRow>();
		for (const row of [...(listing ?? []), ...instant, ...serverRows])
		{
			if (isGenericKind(row.kind)) byKey.set(rowKey(row), row);
		}
		return byKey;
	}, [listing, instant, serverRows]);

	/** The ⌥⏎ card target for a row's cmdk value: upstream's `Nm` session, artifact and project kinds, else `yt`. */
	function cardTarget(key: string): PaletteCardTarget | undefined
	{
		const generic = genericRows.get(key);
		if (generic !== undefined)
		{
			const target = genericCardTarget(generic, Date.now());
			return target === undefined
				? undefined
				:
					{
						kind: "generic",
						row: target,
					};
		}
		const separator = key.indexOf(":");
		const kind = key.slice(0, separator);
		const id = key.slice(separator + 1);
		if (kind === "session")
		{
			const session = cardSessions.get(id);
			return session === undefined
				? undefined
				:
					{
						kind,
						session,
					};
		}
		if (kind === "artifact")
		{
			const artifact = artifactsById.get(id);
			return artifact === undefined
				? undefined
				:
					{
						kind,
						artifact,
					};
		}
		if (kind === "project")
		{
			const project = projectsById.get(id);
			return project === undefined
				? undefined
				:
					{
						kind,
						project:
						{
							id: project.id,
							name: project.name,
						},
					};
		}
		return undefined;
	}

	function openRowActions(key: string)
	{
		const target = cardTarget(key);
		const popup = popupRef.current;
		if (target === undefined || popup === null) return;
		if (target.kind === "session")
		{
			const {id} = target.session;
			setActedIds((acted) => (acted.has(id) ? acted : new Set(acted).add(id)));
		}
		const row = [...popup.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
			(item) => item.dataset["value"] === key,
		);
		const list = popup.querySelector<HTMLElement>("[cmdk-list]") ?? popup;
		const dialog = cardRef.current ?? popup;
		const reducedMotion = isMotionReduced();
		// Measured before the recede starts, so the scale is applied once.
		const anchorRect = rowActionsAnchorRect(
			{
				list: list.getBoundingClientRect(),
				row: (row ?? list).getBoundingClientRect(),
				dialog: dialog.getBoundingClientRect(),
				reducedMotion,
			},
		);
		setRowActions(
			{
				key,
				target,
				anchorRect,
				morphFrom: thumbShown && key === thumbRowKey && !reducedMotion ? cardMorphOffset(list, key) : null,
			},
		);
	}

	// Set by a press on the palette while the card is open, so that press's click only closes the card.
	const swallowClickRef = useRef(false);

	// Upstream's `Na`/`Ea`: once ⌥⏎ or ← has opened or closed the card, that key's auto-repeats are swallowed.
	const swallowRepeatRef = useRef<RowActionsRepeatKey | null>(null);

	// A card item's click focuses that item after its handler runs, so the refocus is repeated once the card is gone.
	const refocusAfterCardRef = useRef(false);

	function closeRowActions({refocus, swallowRepeat}: RowActionsCloseOptions)
	{
		setThumbReturningKey(rowActions?.key ?? null);
		setRowActions(null);
		swallowRepeatRef.current = swallowRepeat ?? null;
		refocusAfterCardRef.current = refocus;
		if (refocus) inputRef.current?.focus();
	}

	useEffect(() =>
	{
		if (rowActions !== null || !refocusAfterCardRef.current) return;
		refocusAfterCardRef.current = false;
		inputRef.current?.focus();
	}, [rowActions]);

	// Upstream's `Sa===null → _a(null)`: the card closes once its row is no longer in the list.
	// Runs after every commit because rows come from several queries and filters.
	const rowActionsKey = rowActions?.key;
	useEffect(() =>
	{
		if (rowActionsKey === undefined) return;
		const row = popupRef.current?.querySelector(`[cmdk-item][data-value="${CSS.escape(rowActionsKey)}"]`);
		if (row === null || row === undefined)
			closeRowActions(
				{
					refocus: true,
				},
			);
	});

	// Upstream's Open closes without refocusing the opener; the session page focuses its own composer.
	function openSession(id: string)
	{
		restoreFocusRef.current = false;
		void navigate(
			{
				to: "/session/$id",
				params:
				{
					id,
				},
			},
		);
	}

	function openRow(row: Pick<SearchRow, "kind" | "id" | "href">)
	{
		if (row.kind === "session") openSession(row.id);
		else if (row.kind === "project")
			void navigate(
				{
					to: "/project/$id",
					params:
					{
						id: row.id,
					},
				},
			);
		else if (row.kind === "artifact")
			void navigate(
				{
					to: "/artifact/$id",
					params:
					{
						id: row.id,
					},
				},
			);
		else if (row.kind === "file")
		{
			void navigate(
				{
					to: "/file/$",
					params:
					{
						_splat: encodeFilePath(row.id),
					},
				},
			);
		}
		else if (row.href !== undefined)
			void navigate(
				{
					href: row.href,
				},
			);
	}

	async function copyCommand(command: string)
	{
		const copied = await writeClipboardText(command);
		toast(
			copied
				?
					{
						kind: "success",
						message: "Command copied to clipboard.",
					}
				:
					{
						kind: "error",
						message: "Couldn’t copy the command. Try again.",
					},
		);
	}

	function runSessionCommand(id: SessionCommandId)
	{
		if (currentSessionId === undefined || currentDetail === null) return;
		const shell = createSessionCommands(currentSessionId, currentDetail.projectPath);
		switch (id)
		{
			case "pin":
			case "unpin":
				if (id === "pin") pin(currentSessionId);
				else unpin(currentSessionId);
				return;
			case "rename":
				requestSessionRename(currentSessionId);
				return;
			case "copy-link":
				void copySessionLink(currentSessionId, toast, queryClient);
				return;
			case "archive":
			case "unarchive":
				setArchived(id === "archive");
				return;
			case "hide-nested":
			case "show-nested":
				toggleFamilyCollapsed(currentSessionId);
				return;
			case "copy-resume":
				void copyCommand(shell.resume);
				return;
			case "copy-fork":
				void copyCommand(shell.fork);
				return;
			default:
				assertNever(id);
		}
	}

	const startProjects = useMemo(
		() =>
			startSessionProjects(
				projects,
				// The repo values `repo:` commits: each session's cwd basename.
				(data?.sessions ?? []).map((session) => session.project.replace(/\/+$/u, "").split("/").pop() ?? ""),
				currentDetail?.projectId,
			),
		[projects, data, currentDetail],
	);
	const startProjectName = currentDetail?.projectName ?? data?.sessions[0]?.projectName;

	function openStartPicker()
	{
		setStartStep("picker");
		const first = startProjects[0];
		setSelectedValue(first === undefined ? "" : startProjectValue(first));
	}

	async function launchSession(project: StartProject)
	{
		const launch =
		{
			cwd: project.projectPath,
			prompt: composePrompt(startPrompt, takeContextChips(COMPOSE_DRAFT_KEY), []),
		};
		const since = Date.now();
		reportSendHold(true);
		setStartStep("launching");
		try
		{
			const {sessionId} = await launchHerdrSession(launch);
			setPendingLaunch(
				{
					cwd: launch.cwd,
					since,
					sessionId,
				},
			);
		}
		catch
		{
			const copied = await writeClipboardText(buildClaudeCopyCommand(launch));
			toast(
				copied
					?
						{
							kind: "success",
							message: "Copied command — no terminal to launch in",
						}
					:
						{
							kind: "error",
							message: "Couldn’t start a session. Try again.",
						},
			);
			reportSendHold(false);
			onOpenChange(false);
		}
	}

	// The launched session opens once its SessionStart hook arrives over SSE.
	useEffect(() =>
	{
		if (pendingLaunch === null) return;
		const id = findLaunchedSession(activeSessions.values(), pendingLaunch);
		if (id === null) return;
		restoreFocusRef.current = false;
		reportSendHold(false);
		onOpenChange(false);
		void navigate(
			{
				to: "/session/$id",
				params:
				{
					id,
				},
			},
		);
	}, [pendingLaunch, activeSessions, onOpenChange, navigate, reportSendHold]);

	// Upstream releases a held send after `Zp`. Locally the herdr launch has already happened by then, so this
	// only lifts the close guard: unlike upstream there is no "Couldn’t start a session" toast and no return
	// to idle (which would invite a duplicate launch), and a late SessionStart still opens the session.
	const launching = startStep === "launching";
	useEffect(() =>
	{
		if (!launching) return undefined;
		const timer = window.setTimeout(() =>
		{
			reportSendHold(false);
		}, PALETTE_SEND_HOLD_TIMEOUT_MS);
		return () =>
		{
			window.clearTimeout(timer);
			reportSendHold(false);
		};
	}, [launching, reportSendHold]);

	// Upstream `A7` with host `T`: a route change or another dialog closes the palette unless held, and an
	// auto-close never returns focus to the opener. A refused attempt leaves the focus return alone.
	usePaletteAutoClose(
		{
			enabled: open,
			hold: paletteCloseHold(
				{
					mode,
					entrypoint,
					search: buffers.search,
					compose: buffers.compose,
					attachments: composeChips.length,
					filters,
					startStep,
				},
			),
			onClose: () =>
			{
				if (sendHeldRef.current) return;
				restoreFocusRef.current = false;
				onOpenChange(false);
			},
		},
	);

	function seeAllResults(apiType: ServerPaletteType)
	{
		void navigate(
			{
				to: "/search",
				search:
				{
					q: tokens.text,
					type: apiType,
				},
			},
		);
	}

	// Upstream resets the highlight to row 0 on every tab change (`pg={index:0}`); the stale cmdk value
	// from the previous tab would otherwise leave no row selected. Quick actions still win when shown.
	const pendingFirstRowRef = useRef(false);
	useEffect(() =>
	{
		if (!pendingFirstRowRef.current) return;
		const first = offersNewSession
			? NEW_SESSION_VALUE
			: listing?.[0] === undefined
				? undefined
				: rowKey(listing[0]);
		if (first === undefined) return;
		pendingFirstRowRef.current = false;
		setSelectedValue(first);
	}, [tab, filters, listing, offersNewSession]);

	// cmdk only refreshes `aria-activedescendant` when its own keys move the selection, never for a
	// controlled value, so every commit points the textarea at the selected row itself. It writes the
	// attribute directly (a state round trip would cost the palette a second commit), and the textarea
	// overrides cmdk's own prop with undefined so React never writes cmdk's stale id over it.
	useLayoutEffect(() =>
	{
		const input = inputRef.current;
		if (input === null) return;
		const items = cardRef.current?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [];
		const id = [...items].find((item) => item.dataset["value"] === selectedValue)?.id;
		if (id === undefined) input.removeAttribute("aria-activedescendant");
		else if (input.getAttribute("aria-activedescendant") !== id) input.setAttribute("aria-activedescendant", id);
	});

	// Upstream's Actions mode is exclusive, so choosing any type leaves it.
	function chooseTab(next: PaletteType)
	{
		setTab(next);
		setFilters(({actions: _actions, ...rest}) => rest);
		setSelectedValue("");
		pendingFirstRowRef.current = true;
		inputRef.current?.focus();
	}

	// Upstream commits the flag filters (Archived, Actions) at once; the others open their value list.
	// Either way the hint replaces the query from `start`, where its "filter by" words begin.
	function chooseFilter(filter: PaletteFilter, start = 0)
	{
		const token = `${query.slice(0, start)}${PALETTE_FILTER_TOKENS[filter]}`;
		if (filter === "archived" || filter === "actions") changeQuery(`${token} `);
		else setQuery(token);
		inputRef.current?.focus();
	}

	// An inline suggestion commits its chip in place of the words it matched.
	function chooseInlineSuggestion(suggestion: PaletteInlineSuggestion)
	{
		chooseFilterValue(
			`${query.slice(0, suggestion.start)}${PALETTE_FILTER_TOKENS[suggestion.filter]}${suggestion.value} `,
		);
	}

	function filterHintItem(filter: PaletteFilter, start = 0)
	{
		return (
			<CommandItem
				key={filter}
				value={`filter:${filter}`}
				icon={PALETTE_FILTER_ICONS[filter]}
				badge={
					<span className={FILTER_BADGE_CLASS[look]}>
						<span className={BADGE_LABEL_PAD[look]}>{paletteFilterLabels[filter]}</span>
					</span>
				}
				onSelect={() =>
				{
					chooseFilter(filter, start);
				}}
			>
				Filter by{" "}
			</CommandItem>
		);
	}

	const inlineHintItems = inlineHints.map((filter) => filterHintItem(filter, hintMatch?.start));

	function chooseFilterValue(next: string)
	{
		changeQuery(next);
		inputRef.current?.focus();
	}

	// Upstream's `ht`: each `key:value` word a whitespace follows becomes a chip (or, for `type:`, the tab).
	function changeQuery(next: string)
	{
		if (compose || !shouldCommitPaletteTokens(next))
		{
			setQuery(next);
			return;
		}
		const committed = commitPaletteTokens(next, filters, data?.sessions ?? []);
		setQuery(committed.text);
		if (committed.text === next) return;
		setFilters(committed.filters);
		if (committed.tab !== undefined && committed.tab !== tab) chooseTab(committed.tab);
	}

	// Upstream grows the Compose field to its content (capped by max-h-24) once the draft is multi-line
	// or past 50 characters; otherwise, and always in Search, the rows height applies.
	useLayoutEffect(() =>
	{
		const input = inputRef.current;
		if (!input) return;
		if (compose && (query.includes("\n") || query.length > 50))
		{
			input.style.height = "auto";
			input.style.height = `${input.scrollHeight}px`;
		}
		else
		{
			input.style.height = "";
		}
	}, [compose, query]);

	/**
	 * Upstream `ah`'s `onDropFiles`: dropped files attach as Compose chips, and a drop in Search flips to Compose for this
	 * open only (upstream's raw `Le(!0)`, not the remembering setter). Mid-launch the chips are already taken, so a drop
	 * is swallowed (the zone still keeps the browser from opening the file) without attaching.
	 */
	function attachDroppedFiles(files: readonly File[])
	{
		if (startStep !== "idle") return;
		attachUploadedFiles(COMPOSE_DRAFT_KEY, files, toast);
		if (mode === "search")
			switchView(
				"compose",
				{
					remember: false,
				},
			);
	}

	// Upstream's Compose paste: files attach, and text of 500+ chars becomes a pasted-text chip instead of inline text.
	function handleComposePaste(event: ClipboardEvent<HTMLTextAreaElement>)
	{
		const files = Array.from(event.clipboardData.files);
		if (files.length > 0)
		{
			event.preventDefault();
			attachUploadedFiles(COMPOSE_DRAFT_KEY, files, toast);
			return;
		}
		const text = event.clipboardData.getData("text/plain");
		if (text.length < PASTE_ATTACH_CHARS) return;
		event.preventDefault();
		attachContext(
			COMPOSE_DRAFT_KEY,
			{
				kind: "pasted-text",
				text,
			},
		);
	}

	// Shift+Enter inserts the newline natively; stopping it here keeps cmdk's Enter from selecting a row.
	function handleComposeKeyDown(event: KeyboardEvent<HTMLTextAreaElement>)
	{
		if (compose && event.key === "Enter" && event.shiftKey) event.stopPropagation();
	}

	function clearFilter(filter: PaletteChipFilter)
	{
		setFilters(({[filter]: _removed, ...rest}) => rest);
		clearFilterSelection();
	}

	// Upstream's phone-fold Clear filters drops every chip but keeps the type tab.
	function clearFoldedFilters()
	{
		setFilters({});
		clearFilterSelection();
	}

	// Like a tab change, a chip change resets the highlight to the first row.
	function clearFilterSelection()
	{
		setSelectedValue("");
		pendingFirstRowRef.current = true;
	}

	// Upstream's Search all clears the type and every chip, keeping only the typed text.
	function searchAll()
	{
		setQuery(tokens.text);
		setFilters({});
		chooseTab("all");
	}

	// Upstream's $n(["question"], true): closes the palette, then resolves the card now, the one after the card
	// that held focus before the palette opened, else refocuses that element while it is still shown.
	function jumpToQuestion()
	{
		const from = paletteFocusOrigin();
		restoreFocusRef.current = false;
		select(() =>
		{
			requestAnimationFrame(() =>
			{
				const card = findWaitingCard(document, from);
				if (card !== null) landOnWaitingCard(card);
				else if (from instanceof HTMLElement && from.isConnected && isAvailable(from))
				{
					from.focus(
						{
							preventScroll: true,
						},
					);
				}
			});
		});
	}

	// A settings member opens its tab; a customize member its Yours list. Both are hash changes over the current
	// page, so an open Settings dialog switches section in place.
	// Upstream `m7(…, "dialog")`: the dialog opens 100ms after the palette closes, noted so the palette's exit copy
	// hands its scrim to the incoming backdrop.
	function openSettingsMember({member}: SettingsPaletteCommand)
	{
		runAfterOverlayDelay(() =>
		{
			if (member.kind === "settings") openSettings(member.tab);
			else openCustomize(member.section);
		}, "dialog");
	}

	function regionJumpAction(id: PaletteJumpActionId, icon: ReactNode, region: JumpRegionName): PaletteAction
	{
		return {
			label: PALETTE_JUMP_ACTIONS[id].label,
			icon,
			// Runs after the palette closes; the next frame lands after the palette's final focus.
			run: () =>
			{
				requestAnimationFrame(() =>
				{
					focusRegionByName(document, region);
				});
			},
			keywords: jumpActionKeywords(id),
		};
	}

	// Upstream's Actions minus the cloud-only ones; New session lives in Quick actions once text is typed.
	const actions: PaletteAction[] = (
		[
			{
				label: "Search sessions",
				icon: <Search />,
				run: () =>
					void navigate(
						{
							to: "/search",
							search:
							{
								q: "",
								type: "all" as const,
							},
						},
					),
				shortcut: "search",
			},
			{
				label: "Keyboard shortcuts",
				icon: <Keyboard />,
				run: () =>
				{
					runAfterOverlayDelay(() =>
					{
						setKeyboardShortcutsOpen(true);
					}, "dialog");
				},
				shortcut: "shortcuts_modal",
			},
			{
				label: "Toggle sidebar",
				icon: <PanelLeft />,
				run: toggleSidebar,
				shortcut: "toggle_sidebar",
			},
			{
				label: "Mark all sessions seen",
				icon: <CircleCheckBig />,
				run: clearAll,
			},
			// Upstream `g0`: the session catalog group's Hide/Show all come before toggle_side_chat.
			...(familyFold.anyShown
				? [
						{
							...NESTED_SESSION_COMMANDS.hide_all_nested_sessions,
							icon: <Minimize2 />,
							run: () =>
							{
								setFamiliesCollapsed(familyHeads ?? [], true);
							},
						} satisfies PaletteAction,
					]
				: []),
			...(familyFold.anyHidden
				? [
						{
							...NESTED_SESSION_COMMANDS.show_all_nested_sessions,
							icon: <Maximize2 />,
							run: showAllNestedSessions,
						} satisfies PaletteAction,
					]
				: []),
			// Upstream `Lh`'s pane commands in catalog order, between the session commands and the jumps.
			...panePaletteActions(paneState?.sessionId === currentSessionId ? paneState : null).map(
				({id, label}): PaletteAction =>
				{
					const {searchHints, ...command} = PANE_PALETTE_COMMANDS[id];
					const action: PaletteAction =
					{
						label,
						icon: PANE_COMMAND_ICONS[id],
						keywords: searchHints,
						// Upstream `m7`: run 100ms after the palette closes, so its focus restore lands first.
						run: () =>
						{
							setTimeout(() =>
							{
								paneState?.run(id);
							}, PANE_COMMAND_DELAY_MS);
						},
					};
					if ("shortcut" in command) action.shortcut = command.shortcut;
					return action;
				},
			),
			regionJumpAction("jump_to_navigation", <PanelLeft />, "navigation"),
			regionJumpAction("jump_to_main_content", <BookText />, "main"),
			// Upstream lists an unavailable jump action nowhere, so it needs a card seen at open.
			...(jumpOffered
				? [
						{
							label: PALETTE_JUMP_ACTIONS.jump_to_question.label,
							icon: <CircleHelp />,
							run: jumpToQuestion,
							keywords: jumpActionKeywords("jump_to_question"),
						} satisfies PaletteAction,
					]
				: []),
			regionJumpAction("jump_to_input", <TextCursorInput />, "composer"),
			// Upstream appends `Ss()` after the registry, which hides its plain Settings action from the palette.
			...SETTINGS_COMMANDS.map((command): PaletteAction => (
			{
				label: command.description,
				icon: command.icon === "usage" ? <Gauge /> : <SlidersHorizontal />,
				keywords: command.searchHints,
				value: `settings:${command.key}`,
				run: () =>
				{
					openSettingsMember(command);
				},
				warm: () =>
				{
					warmSettingsCommand(command);
				},
			})),
		] satisfies PaletteAction[]
	).filter((action: PaletteAction) => action.shortcut === undefined || SHORTCUTS[action.shortcut].enabled);

	function select(callback: () => void)
	{
		onOpenChange(false);
		callback();
	}

	/** Upstream's sole send_message item: an empty draft is a shortcut to the New session page. */
	function onSend()
	{
		if (trimmedQuery === "" && composeChips.length === 0)
		{
			select(
				() =>
					void navigate(
						{
							to: "/",
						},
					).then(requestHomeComposerFocus),
			);
		}
		else if (canSend)
		{
			openStartPicker();
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>)
	{
		if (event.repeat && event.key === swallowRepeatRef.current)
		{
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (!event.repeat) swallowRepeatRef.current = null;
		if (!compose && event.target === inputRef.current) startPaletteSearchJourney(event.nativeEvent);
		if (event.key === "Escape" && startStep === "picker")
		{
			event.preventDefault();
			event.stopPropagation();
			setStartStep("idle");
			setSelectedValue("");
			inputRef.current?.focus();
			return;
		}
		if (event.key === "Enter" && event.metaKey && canStart && startStep === "idle")
		{
			event.preventDefault();
			openStartPicker();
			return;
		}
		// Upstream's modifiedEnterPicksNothing: while the jump is offered, ⌘/Ctrl+Enter picks no row.
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !compose && jumpOffered)
		{
			event.preventDefault();
			return;
		}
		if (isAltEnter(event))
		{
			openSelectedRowActions(event);
			return;
		}
		if (
			event.key === "Enter" &&
			compose &&
			startStep === "idle" &&
			!event.shiftKey &&
			!event.altKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.nativeEvent.isComposing
		)
		{
			event.preventDefault();
			event.stopPropagation();
			onSend();
			return;
		}
		if (event.key === "ArrowLeft" || event.key === "ArrowRight")
		{
			stepTab(event);
			return;
		}
		if (event.key === "Backspace" || event.key === "Delete")
		{
			if (compose) leaveEmptyCompose(event);
			else popFilter(event);
			return;
		}
		// Upstream excludes Alt/Meta/Ctrl but not Shift, so Shift+Tab toggles too; a held Tab is
		// swallowed without toggling.
		if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey)
		{
			return;
		}
		// Upstream `(e.preventDefault(), U||V("actions"))`: a phone-latched open swallows Tab without toggling.
		event.preventDefault();
		if (event.repeat || isComposingKey(event) || !composeAvailable) return;
		switchView(mode === "search" ? "compose" : "search");
	}

	// Upstream: Backspace/Delete on an empty Compose drops back to Search for this open only, so the
	// next ⌘K still opens Compose. Attachments count as content here, since local Search can't show them.
	function leaveEmptyCompose(event: KeyboardEvent<HTMLDivElement>)
	{
		if (event.target !== inputRef.current || startStep !== "idle") return;
		if (query !== "" || composeChips.length > 0 || event.repeat || isComposingKey(event)) return;
		event.preventDefault();
		switchView(
			"search",
			{
				remember: false,
			},
		);
	}

	// ← / → at the matching edge of the input (or with no query) step through the type tabs:
	// upstream's `yu` decides, and `bu` wraps unless the key is held.
	function stepTab(event: KeyboardEvent<HTMLDivElement>)
	{
		const input = inputRef.current;
		if (compose || input === null || event.target !== input) return;
		const direction = paletteTypeStep(
			{
				key: event.key,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				repeat: event.repeat,
				composing: isComposingKey(event),
			},
			{
				text: input.value,
				selectionStart: input.selectionStart,
				selectionEnd: input.selectionEnd,
			},
			getComputedStyle(input).direction === "rtl",
		);
		if (direction === 0) return;
		event.preventDefault();
		const next = nextPaletteType(PaletteTypeSchema.options, tab, direction, !event.repeat);
		if (next !== undefined) chooseTab(next);
	}

	// Upstream's `A_` pops the newest chip on Backspace/Delete in an empty query, then the type tab.
	function popFilter(event: KeyboardEvent<HTMLDivElement>)
	{
		const input = inputRef.current;
		if (compose || input === null || event.target !== input) return;
		if (query !== "" || event.repeat || isComposingKey(event)) return;
		const popped = popPaletteFilter(filters, tab);
		if (popped === null) return;
		event.preventDefault();
		setFilters(popped.filters);
		if (popped.tab === tab) clearFilterSelection();
		else chooseTab(popped.tab);
	}

	function isComposingKey(event: KeyboardEvent<HTMLDivElement>)
	{
		// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
		return event.nativeEvent.isComposing || event.keyCode === 229;
	}

	// ⌥⏎ opens the row-actions card for the selected row.
	function openSelectedRowActions(event: KeyboardEvent<HTMLDivElement>)
	{
		const input = inputRef.current;
		if (input === null || event.target !== input) return;
		// Never fall through to cmdk's Enter, which would run a row without actions.
		event.preventDefault();
		swallowRepeatRef.current = "Enter";
		const selected = cardRef.current?.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')?.dataset[
			"value"
		];
		if (selected === undefined) return;
		openRowActions(selected);
	}

	// Actions mode lists no rows with actions; checking it too avoids a stale selection flashing the hint.
	const selectedRowHasActions = !actionsOnly && cardTarget(selectedValue) !== undefined;
	if (thumbReturningKey !== null && thumbReturningKey !== selectedValue) setThumbReturningKey(null);
	const footerCollapsed = !compose && query.trim() !== "";
	const coarsePointer = useCoarsePointer();
	const [measureListRef, contentHeight] = useListContentHeight();
	const listElRef = useRef<HTMLDivElement | null>(null);
	const listRef = useCallback(
		(list: HTMLDivElement | null) =>
		{
			listElRef.current = list;
			measureListRef(list);
		},
		[measureListRef],
	);
	const now = Date.now();
	const canSend = canStart && startStep === "idle";
	const addFilesKeys = useShortcutKeys("add_files").keys;

	function openFilePicker()
	{
		fileInputRef.current?.click();
	}
	useShortcut(
		"add_files",
		openFilePicker,
		{
			disabled: !compose || startStep !== "idle",
			allowInModal: true,
		},
	);
	const matchesCommands = searchable && !filtered && tokens.text !== "";
	const matchedSessionCommands =
		matchesCommands && currentDetail !== null
			? currentSessionCommands(currentDetail, pins.isPinned(currentSessionId ?? ""), currentNested).filter(
					(command) => commandMatches(command.label, tokens.text, SESSION_COMMAND_KEYWORDS[command.id]),
				)
			: [];
	const matchedActions = longPrompt
		? []
		: actionsOnly && tokens.text === ""
			? actions
			: matchesCommands || actionsOnly || bangQuery
				? actions.filter((action) => commandMatches(action.label, tokens.text, action.keywords))
				: [];
	const matchedCommands = matchesCommands
		? NAV_COMMANDS.filter((command) => commandMatches(command.label, tokens.text, command.keywords))
		: [];
	// Upstream's `B`: actions and title rows interleave by rank bucket (0 prefix, 1 all tokens, 2 other).
	// Upstream's untitled `{id:"actions"}` group only appears when actionsInResults or server search is off,
	// which never happens in the local palette, so there is no split actions group here.
	const queryTokens = paletteTokens(tokens.text);
	// Upstream's `Z`: the trimmed, lowercased query every non-conversation row label highlights as one phrase.
	const lowerQuery = tokens.text.toLowerCase();
	const rankOf = (label: string, prNumber?: number) => paletteRank(label, tokens.text, queryTokens, prNumber);
	const typedOrder = interleaveByRank<TypedPaletteItem, TypedPaletteItem>(
		[
			...matchedSessionCommands.map((command) => (
			{
				kind: "session-command" as const,
				command,
				rank: rankOf(command.label),
			})),
			...matchedActions.map((action) => (
			{
				kind: "action" as const,
				action,
				rank: rankOf(action.label),
			})),
			...matchedCommands.map((command) => (
			{
				kind: "nav" as const,
				command,
				rank: rankOf(command.label),
			})),
		],
		instant.map((row) => (
		{
			kind: "row" as const,
			row,
			rank: rankOf(row.title, row.prNumber),
		})),
	);
	// Upstream's `Zn = K==="search" ? 25 : 7` organic cap and `Ne = xe.slice(0, max(0, m − Ae − Te))`: fetched rows
	// fill only what typed actions and title rows leave. A filter predicate uses `$d=25` for local and fetched alike.
	// When the queryOnly "Show archived" row lands, it passes as uncounted here yet still counts in resultCount.
	const capFiltered = filtered || chips.length > 0 || actionsOnly || bangQuery;
	const capped =
		tokens.text === ""
			?
				{
					kept: typedOrder,
					fetched: serverRows,
				}
			: capFiltered
				?
					{
						kept: typedOrder.slice(0, PALETTE_FILTERED_MAX_ITEMS),
						fetched: serverRows.slice(0, PALETTE_FILTERED_MAX_ITEMS),
					}
				: capOrganic(typedOrder, serverRows, PALETTE_MAX_ORGANIC_ITEMS, () => false);
	const {kept: typedItems, fetched: fetchedRows} = capped;
	const resultCount =
		(listing?.length ?? 0) + typedItems.length + fetchedRows.length + inlineHints.length + inlineSuggestions.length;
	const emptyKind = paletteEmptyKind(
		{
			query: tokens.text,
			searching,
			rowCount: resultCount,
			filtered: type !== "all" || hasFilterTokens,
			failed: serverActive && serverSearch.isError,
			stalled,
		},
	);
	const silentText = emptyKind === "silent" ? tokens.text : null;
	const [silentSpokenFor, setSilentSpokenFor] = useState<string | null>(null);
	useEffect(() =>
	{
		if (silentText === null) return undefined;
		const timer = setTimeout(() =>
		{
			setSilentSpokenFor(silentText);
		}, PALETTE_SILENT_LIVE_DELAY_MS);
		return () =>
		{
			clearTimeout(timer);
			setSilentSpokenFor(null);
		};
	}, [silentText]);
	// Local-only: the Files tab searches file contents, so before typing it asks for a query.
	const emptyMessage =
		emptyKind === "failed" || emptyKind === "stalled"
			? "Something went wrong"
			: type === "files" && tokens.text.trim() === ""
				? "Type to search file contents"
				: paletteEmptyMessage(paletteQuotedText(query), type === "all" ? null : paletteTypeLabels[type]);
	// Upstream's live region: the empty copy ("silent" speaks the bare No results found 3s after settling), else the ICU count.
	// Upstream's region text needs a non-empty raw query (`ct`): a type tab listing rows at 0 characters stays silent.
	const liveMessage =
		query === ""
			? ""
			: emptyKind === "silent"
				? silentSpokenFor === silentText
					? "No results found"
					: ""
				: emptyKind === null
					? (paletteLiveCountMessage(
							{
								rawQuery: query,
								count: resultCount,
								blocked: false,
							},
						) ?? "")
					: emptyMessage;
	const idle = startStep === "idle";
	// Upstream's sending Compose keeps the list hidden: the busy Send and the live region carry the state.
	const composeAtRest = compose && startStep !== "picker";
	const showEmptyState = idle && !compose && trimmedQuery === "" && tab === "all" && chips.length === 0;
	// Upstream's `nn` fails for whitespace over 50 characters: only the Actions group shows, and it isn't frozen.
	const whitespacePrompt = showEmptyState && !paletteSearchable(query);
	if (frozenMarks !== null && frozenView === null && showEmptyState && !whitespacePrompt)
	{
		setFrozenView(emptyView.view);
	}
	// Upstream's `emptyViewPending`: until the opening's empty view settles, the grouped skeleton stands in for it.
	const emptyViewPending = showEmptyState && !whitespacePrompt && frozenView === null && !emptyViewReady;
	// Upstream counts every empty-view row but its send_message New session, so whitespace speaks "N results available".
	const emptyViewCount =
		showEmptyState && !whitespacePrompt && !emptyViewPending
			? emptyView.groups
					.flatMap((group) => group.items)
					.filter((row) => !(row.kind === "action" && row.id === "new_session")).length
			: 0;
	// Upstream `Ti && !wi && Ei(false)`: only the first show after the loading shell skips the delayed reveal.
	if (skeletonHandoff && !emptyViewPending) setSkeletonHandoff(false);
	const showResults =
		idle && !compose && hints === null && valueSuggestions === null && !showEmptyState && !longPrompt;
	// Upstream sizes the scroller to its content, but holds it at the cap while the skeleton or empty block fills it.
	const listCapped = showEmptyState || (showResults && (searching || emptyKind !== null));
	const listCap = LIST_CAP_PX + (footerCollapsed && !coarsePointer ? COLLAPSED_FOOTER_PX : 0);
	const listHeight = listCapped ? listCap : contentHeight === null ? null : contentHeight + LIST_PADDING_Y_PX;
	const label = MODE_LABELS[mode];
	// Upstream's picker gives an untitled actions group with no results group yet its own spacer-led skeleton.
	const actionRowsOnly =
		(listing?.length ?? 0) + instant.length + serverRows.length === 0 &&
		matchedSessionCommands.length + matchedActions.length + matchedCommands.length > 0;

	// Upstream's enter-ahead (`Di`/`onEnterWithNoRows`/`is()`): an Enter in the pending input is stamped, any other
	// key or a pointer press cancels it, and when the rows land in time the first one opens.
	function trackEnterAhead(event: KeyboardEvent<HTMLDivElement>)
	{
		if (!emptyViewPending) return;
		if (event.key === "Enter")
		{
			const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
			if (plain && event.target === inputRef.current && enterAheadRef.current === "none")
			{
				enterAheadRef.current = performance.now();
			}
			return;
		}
		if (!ENTER_AHEAD_IGNORED_KEYS.has(event.key)) enterAheadRef.current = "off";
	}
	const pendingWasRef = useRef(emptyViewPending);
	useLayoutEffect(() =>
	{
		if (pendingWasRef.current === emptyViewPending) return;
		pendingWasRef.current = emptyViewPending;
		if (emptyViewPending) return;
		const stamp = enterAheadRef.current;
		enterAheadRef.current = "none";
		if (typeof stamp !== "number" || performance.now() - stamp > ENTER_AHEAD_MS || query !== "") return;
		cardRef.current?.querySelector<HTMLElement>("[cmdk-list] [cmdk-item]")?.click();
	}, [emptyViewPending, query]);

	return (
		<>
			<DialogPopup
				unstyled
				ref={popupRef}
				data-command-palette=""
				data-perf-overlay="command_palette"
				initialFocus={inputRef}
				restoreFocus={restoreFocus}
				className={PALETTE_POPUP_CLASS}
				style={PALETTE_POPUP_STYLE}
				onKeyDownCapture={trackEnterAhead}
				onPointerDownCapture={() =>
				{
					if (emptyViewPending) enterAheadRef.current = "off";
				}}
			>
				<div ref={setThumbSlot} className="pointer-events-none absolute top-0 left-full z-3" />
				<Dialog.Title className="sr-only">Search</Dialog.Title>
				<div
					ref={cardRef}
					data-palette-recede-card=""
					// Upstream's recede: origin-top, duration-base with --cds-ease-out, none under reduced motion.
					className={`relative origin-top overflow-hidden border-[0.5px] border-strong bg-surface-3 shadow-2xl transition-[scale] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none motion-reduce:scale-100 ${
						rowActions === null ? "" : "scale-[.97]"
					} ${footerCollapsed ? FOOTER_COLLAPSED_CARD_CLASS : ""} ${PALETTE_RADIUS}`}
					// Upstream drops onHoverIndex while the card is open, so hovering rows can't move the selection
					// (cmdk reads disablePointerSelection only once, at mount).
					onPointerMoveCapture={
						rowActions === null
							? undefined
							: (event) =>
								{
									event.stopPropagation();
								}
					}
					// Upstream's modal menu backdrop eats the first click outside the card. A press that slips past it
					// still only closes the card: its click must not reach a row, even after the press closed the card.
					onPointerDownCapture={(event) =>
					{
						swallowClickRef.current = rowActions !== null;
						if (rowActions !== null) event.stopPropagation();
					}}
					onClickCapture={(event) =>
					{
						if (rowActions === null && !swallowClickRef.current) return;
						swallowClickRef.current = false;
						event.preventDefault();
						event.stopPropagation();
						closeRowActions(
							{
								refocus: true,
							},
						);
					}}
				>
					<div
						aria-hidden="true"
						data-palette-recede-veil=""
						// Upstream fades the veil in over duration-base and out over duration-snap.
						className={`pointer-events-none absolute inset-0 z-10 bg-surface-0 transition-opacity ease-[cubic-bezier(0.165,0.84,0.44,1)] after:absolute after:inset-0 after:rounded-[inherit] after:bg-backdrop ${
							rowActions === null ? "opacity-0 duration-[120ms]" : "opacity-20 duration-200"
						}`}
					/>
					<Command
						label={label}
						loop
						shouldFilter={false}
						value={selectedValue}
						onValueChange={setSelectedValue}
						onKeyDown={handleKeyDown}
						className="flex flex-col"
					>
						{/* Upstream's header wrapper: Compose at rest has no list below, so the input row takes the bottom gap. */}
						<div className={composeAtRest ? "flex-shrink-0 pb-1 pointer-coarse:pb-0" : "flex-shrink-0"}>
							<div
								className={`relative flex items-center gap-2 pr-2.5 pl-6 ${
									compose ? "flex-wrap pt-[1.1rem] pb-3" : "pt-[1.1rem] pb-[0.9rem]"
								}`}
							>
								{compose && (
									<div
										aria-hidden="true"
										className="pointer-events-none absolute inset-1.5 rounded-composer bg-fill-field shadow-panel-sm-cds"
									/>
								)}
								{!compose && chips.length > 0 && (
									<FilterChips chips={chips} onClear={clearFilter} onClearAll={clearFoldedFilters} />
								)}
								{compose && composeChips.length > 0 && (
									<div className="relative basis-full min-w-0 -ms-1.5 pe-0.5">
										<AttachedContextChips
											sessionId={COMPOSE_DRAFT_KEY}
											context={composeChips}
											comments={[]}
											restoredIds={restoredComposeChipIds}
										/>
									</div>
								)}
								<Command.Input asChild value={query} onValueChange={changeQuery}>
									<textarea
										ref={inputRef}
										onKeyDown={handleComposeKeyDown}
										onPaste={compose ? handleComposePaste : undefined}
										aria-activedescendant={undefined}
										aria-describedby={compose ? undefined : PALETTE_KEYS_HINT_ID}
										placeholder={!compose && actionsOnly ? "Search actions" : label}
										disabled={launching}
										rows={compose ? 2 : 1}
										wrap={compose ? undefined : "off"}
										className={`relative max-h-24 min-w-[5rem] flex-1 resize-none border-none bg-transparent py-1.5 text-sm leading-5 text-primary outline-none placeholder:text-ink-muted ${
											compose ? "overflow-y-auto" : "overflow-x-auto overflow-y-hidden"
										}${launching ? " cursor-not-allowed opacity-50" : ""}`}
									/>
								</Command.Input>
								{!compose && (
									<span id={PALETTE_KEYS_HINT_ID} hidden>
										Left and Right arrows change the type of result. Option+Enter opens actions for
										the highlighted result.
									</span>
								)}
								{!compose && (
									<span
										data-palette-spinner-slot=""
										className="flex size-4 shrink-0 items-center justify-center"
									>
										{searching && tokens.text.trim().length >= 2 && (
											<Spinner size="md" delay={150} label="Searching deeper..." />
										)}
									</span>
								)}
								{!compose && (
									<Tooltip content="Close" side="bottom" className="shrink-0">
										<Dialog.Close
											aria-label="Close"
											className={`${ICON_BUTTON_BASE_CLASS} size-8 rounded-r6 text-primary hover:bg-fill-ghost-hover`}
										>
											<Icon name="X" />
										</Dialog.Close>
									</Tooltip>
								)}
								{/* Upstream renders the file input and button row as direct children of the input row, so Send sits
							    12px from the card edge. Radius 8 = calc(var(--cds-radius) + var(--cds-button-radius-add)):
							    7px + 1px under [data-cds-fizzy-lake~="panels"]. */}
								{compose && (
									<>
										<input
											ref={fileInputRef}
											type="file"
											multiple
											accept="image/*,text/*"
											aria-label="Add files or photos"
											tabIndex={-1}
											className="hidden"
											onChange={(event) =>
											{
												attachUploadedFiles(
													COMPOSE_DRAFT_KEY,
													Array.from(event.target.files ?? []),
													toast,
												);
												event.target.value = "";
											}}
										/>
										<div className="relative flex basis-full items-center justify-between">
											<Tooltip content="Add files or photos" side="top">
												<button
													type="button"
													aria-label="Add files or photos"
													disabled={startStep !== "idle"}
													onMouseDown={(event) =>
													{
														event.preventDefault();
													}}
													onClick={openFilePicker}
													className={`${ICON_BUTTON_CLASS} -ms-3 rounded-r6 text-primary hover:bg-fill-ghost-hover`}
												>
													<Icon name="Attachment" />
												</button>
											</Tooltip>
											<Tooltip content="Send" side="top">
												<button
													type="button"
													aria-label="Send"
													aria-busy={launching ? true : undefined}
													disabled={startStep !== "idle"}
													onMouseDown={(event) =>
													{
														event.preventDefault();
													}}
													onClick={onSend}
													className={`${ICON_BUTTON_CLASS} me-0.5 rounded-r6 bg-fill-brand text-white hover:bg-fill-brand-hover`}
												>
													{launching ? (
														<LoaderCircle
															aria-hidden="true"
															className="size-4 animate-spin"
														/>
													) : (
														<Icon name="ArrowReturn" />
													)}
												</button>
											</Tooltip>
										</div>
									</>
								)}
							</div>
						</div>
						{!compose && <TypeTabs value={actionsOnly ? null : tab} onChange={chooseTab} />}
						{!compose && <div className="h-[0.5px] w-full bg-border" />}

						{/* Upstream animates the scroller between its measured content height and the cap.
					    While capped, cmdk's sizer is a full-height column so the skeleton or empty block fills it. */}
						<Command.List
							ref={listRef}
							className={[
								compose
									? `max-h-[440px] overflow-y-auto p-2.5${composeAtRest ? " hidden" : ""}`
									: LIST_SCROLLER_CLASS,
								"[&_[cmdk-group]+[cmdk-group]]:mt-1 [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:flex-col",
								...(listCapped ? ["[&>[cmdk-list-sizer]]:min-h-full"] : []),
							].join(" ")}
							{...(compose
								? {}
								:
									{
										style:
										{
											...LIST_MAX_HEIGHT_STYLE,
											...(listHeight === null
												? {}
												:
													{
														height: `${listHeight}px`,
													}),
										},
									})}
						>
							{LIST_SCROLL_SHADOW}
							{launching && !compose && (
								<Command.Group heading="Quick actions" className={GROUP_CLASS}>
									<CommandItem
										value={NEW_SESSION_VALUE}
										icon={<LoaderCircle className="animate-spin" />}
										onSelect={() =>
										{
										}}
									>
										Starting session…
									</CommandItem>
								</Command.Group>
							)}
							{startStep === "picker" && (
								<Command.Group heading="Choose a project" className={GROUP_CLASS}>
									{startProjects.map((project) => (
										<CommandItem
											key={project.id}
											value={startProjectValue(project)}
											icon={<FolderOpen />}
											onSelect={() => void launchSession(project)}
										>
											{project.name}
										</CommandItem>
									))}
								</Command.Group>
							)}
							{idle && offersNewSession && (
								<Command.Group heading="Quick actions" className={GROUP_CLASS}>
									<NewSessionItem
										prompt={query}
										projectName={startProjectName}
										onSelect={openStartPicker}
									/>
								</Command.Group>
							)}
							{idle && !compose && hints !== null && (
								<div>{hints.map((filter) => filterHintItem(filter))}</div>
							)}

							{idle && !compose && valueSuggestions !== null && (
								<Command.Group
									heading={paletteFilterLabels[valueSuggestions.filter]}
									className={GROUP_CLASS}
								>
									{valueSuggestions.values.map((value) => (
										<CommandItem
											key={value.query}
											value={`filter-value:${value.query}`}
											onSelect={() =>
											{
												chooseFilterValue(value.query);
											}}
										>
											{value.label}
										</CommandItem>
									))}
								</Command.Group>
							)}

							{showEmptyState && !emptyViewPending && (
								<>
									{emptyView.groups
										.filter((group) => !whitespacePrompt || group.id === "actions")
										.map((group) =>
											group.id === "jump" ? (
												// Upstream's pinned jump group is a bare, untitled div above Needs attention.
												<div key={group.id}>
													<CommandItem
														value="action:jump_to_question"
														icon={<CircleHelp />}
														onSelect={jumpToQuestion}
													>
														{PALETTE_JUMP_ACTIONS.jump_to_question.label}
													</CommandItem>
												</div>
											) : (
												<Command.Group
													key={group.id}
													heading={group.title}
													className={GROUP_CLASS}
												>
													{group.items.map((row) => (
														<EmptyViewItem
															key={row.id}
															row={row}
															onOpenSession={(id) =>
															{
																select(() =>
																{
																	openSession(id);
																});
															}}
															onOpenRowActions={openRowActions}
															onNavigate={(href) =>
															{
																select(
																	() =>
																		void navigate(
																			{
																				href,
																			},
																		),
																);
															}}
															onNewSession={() =>
															{
																select(
																	() =>
																		void navigate(
																			{
																				to: "/",
																			},
																		).then(requestHomeComposerFocus),
																);
															}}
														/>
													))}
												</Command.Group>
											),
										)}
								</>
							)}

							{showResults && (
								// cmdk's Group forces role=presentation, so upstream's headingless group is a plain div.
								<>
									<div
										role="group"
										aria-label="Search results"
										aria-busy={searching}
										// Upstream's headingless results group: 12px below any sibling (gap-1 + mt-2). Upstream's
										// :first-child is the listbox's own first child; locally the scroll shadow leads the sizer.
										className="[&:not([data-palette-scroll-shadow]+*)]:mt-2"
									>
										{inlineHintsFirst && inlineHintItems}
										{listing?.map((row) => (
											<SearchResultItem
												key={rowKey(row)}
												row={row}
												now={now}
												onSelect={() =>
												{
													select(() =>
													{
														openRow(row);
													});
												}}
												onRowActions={() =>
												{
													openRowActions(rowKey(row));
												}}
											/>
										))}
										{typedItems.map((item) =>
										{
											switch (item.kind)
											{
												case "row":
												{
													const {row} = item;
													return (
														<SearchResultItem
															key={rowKey(row)}
															row={row}
															now={now}
															onSelect={() =>
															{
																select(() =>
																{
																	openRow(row);
																});
															}}
															onRowActions={() =>
															{
																openRowActions(rowKey(row));
															}}
														/>
													);
												}
												case "session-command":
												{
													const {command} = item;
													return (
														<CommandItem
															key={command.id}
															value={`session-command:${command.id}`}
															icon={SESSION_COMMAND_ICONS[command.id]}
															lowerQuery={lowerQuery}
															onSelect={() =>
															{
																select(() =>
																{
																	runSessionCommand(command.id);
																});
															}}
														>
															{command.label}
														</CommandItem>
													);
												}
												case "action":
												{
													const {action} = item;
													return action.shortcut === undefined ? (
														<CommandItem
															key={action.label}
															value={action.value ?? `action:${action.label}`}
															icon={action.icon}
															lowerQuery={lowerQuery}
															{...(action.warm === undefined
																? {}
																:
																	{
																		onPointerEnter: action.warm,
																	})}
															onSelect={() =>
															{
																select(action.run);
															}}
														>
															{action.label}
														</CommandItem>
													) : (
														<ShortcutCommandItem
															key={action.label}
															value={`action:${action.label}`}
															id={action.shortcut}
															icon={action.icon}
															lowerQuery={lowerQuery}
															onSelect={() =>
															{
																select(action.run);
															}}
														>
															{action.label}
														</ShortcutCommandItem>
													);
												}
												case "nav":
												{
													const {command} = item;
													return (
														<CommandItem
															key={command.to}
															value={`nav:${command.to}`}
															icon={command.icon}
															lowerQuery={lowerQuery}
															onSelect={() =>
															{
																select(() =>
																{
																	void navigate(
																		{
																			to: command.to,
																		},
																	);
																});
															}}
														>
															{command.label}
														</CommandItem>
													);
												}
												default:
													return assertNever(item);
											}
										})}
										{fetchedRows.map((row) => (
											<SearchResultItem
												key={rowKey(row)}
												row={row}
												now={now}
												onSelect={() =>
												{
													select(() =>
													{
														openRow(row);
													});
												}}
												onRowActions={() =>
												{
													openRowActions(rowKey(row));
												}}
											/>
										))}
										{inlineSuggestions.map((suggestion) => (
											<CommandItem
												key={`${suggestion.filter}:${suggestion.value}`}
												value={`filter-value:${suggestion.filter}:${suggestion.value}`}
												icon={PALETTE_FILTER_ICONS[suggestion.filter]}
												badge={
													<span className={FILTER_BADGE_CLASS[look]}>
														<span className={BADGE_LABEL_PAD[look]}>
															{suggestion.label}
														</span>
													</span>
												}
												onSelect={() =>
												{
													chooseInlineSuggestion(suggestion);
												}}
											>
												Filter by{" "}
											</CommandItem>
										))}
										{!inlineHintsFirst && inlineHintItems}
										{/* Local-only row; upstream's empty view has no option rows, so it waits for results. */}
										{emptyKind === null &&
											!searching &&
											tokens.text !== "" &&
											!actionsOnly &&
											!bangQuery &&
											!isClientPaletteType(type) && (
												<CommandItem
													value="see-all-results"
													icon={<Search />}
													onSelect={() =>
													{
														select(() =>
														{
															seeAllResults(type);
														});
													}}
												>
													See all results for “{tokens.text}”
												</CommandItem>
											)}
									</div>
									{/* Upstream's block follows the results listbox, so its flex-1 centres it in the capped list. */}
									{emptyKind !== null && (
										<PaletteEmptyState
											kind={emptyKind}
											message={emptyMessage}
											onSearchAll={searchAll}
											{...(composeAvailable
												?
													{
														onCompose: () =>
														{
															switchView("compose");
														},
													}
												: {})}
										/>
									)}
								</>
							)}
							{showResults && searching && (
								<PaletteSkeleton
									{...(actionRowsOnly
										? (
											{
												lead: "spacer",
											} as const)
										: {})}
								/>
							)}
							{emptyViewPending && <PaletteEmptyViewSkeleton handoff={skeletonHandoff} />}
						</Command.List>
						{/* Upstream mounts the count region for the palette's life; it stays empty beside the long-prompt New session row. */}
						{!compose && (
							<div aria-live="polite" aria-atomic="true" className="sr-only">
								{showResults && !searching
									? liveMessage
									: (paletteLiveCountMessage(
											{
												rawQuery: query,
												count: emptyViewCount,
												blocked: false,
											},
										) ?? "")}
							</div>
						)}
						{!compose && (
							<PaletteFilterSpoken
								filterKey={JSON.stringify([
									tab,
									filters.date,
									filters.repo,
									filters.project,
									filters.archived,
									filters.actions,
								])}
								words={`Showing ${new Intl.ListFormat(
									"en",
									{
										type: "unit",
									},
								).format([paletteTypeLabels[tab], ...chips.map((chip) => chip.label)])}`}
							/>
						)}

						{compose && (
							<div aria-live="polite" aria-atomic="true" className="sr-only">
								{launching ? "Starting session…" : ""}
							</div>
						)}

						<FooterCollapse open={!footerCollapsed}>
							{compose ? (
								<PaletteFooter
									compose
									hints={[
										["Send", ["enter"]],
										["Add files or photos", [addFilesKeys]],
									]}
									trailing={
										<ViewHint
											label="Search"
											disabled={startStep !== "idle"}
											onSwitch={() =>
											{
												switchView("search");
											}}
										/>
									}
								/>
							) : (
								<PaletteFooter
									hints={[
										["Close", ["esc"]],
										// Upstream shows Change type only for an exactly-empty query, not a whitespace one.
										...(query === ""
											? [
													[
														"Change type",
														["left", "right"],
														"hidden sm:flex items-center gap-2",
													] as const,
												]
											: []),
										["Filters", ["/"], "hidden md:flex items-center gap-2"],
										// Upstream shows the hint only while the selected row supports the ⌥⏎ card.
										...(selectedRowHasActions ? [["Actions", ["alt+enter"]] as const] : []),
									]}
									trailing={
										composeAvailable && (
											<ViewHint
												label="Compose"
												onSwitch={() =>
												{
													switchView("compose");
												}}
											/>
										)
									}
								/>
							)}
						</FooterCollapse>
					</Command>
				</div>
				{thumbRowKey !== null &&
					selectedThumb !== undefined &&
					selectedArtifact !== undefined &&
					rowActions === null &&
					thumbSlot !== null && (
						<PaletteThumbCard
							thumb={selectedThumb}
							meta={["Artifact", relativeBucket(artifactTimestamp(selectedArtifact), now)]
								.filter((part) => part !== null)
								.join(" · ")}
							listRef={listElRef}
							rowKey={thumbRowKey}
							slot={thumbSlot}
							initialReturning={thumbReturningKey === thumbRowKey}
							onShownChange={setThumbShown}
						/>
					)}
				{rowActions !== null && (
					<PaletteRowActionsCard
						key={rowActions.key}
						target={rowActions.target}
						anchorRect={rowActions.anchorRect}
						morphFrom={rowActions.morphFrom}
						onOpen={() =>
						{
							const {target} = rowActions;
							select(() =>
							{
								if (target.kind === "session") openSession(target.session.id);
								else if (target.kind === "generic")
									void navigate(
										{
											href: target.row.href,
										},
									);
								else
									openRow(
										{
											kind: target.kind,
											id: target.kind === "artifact" ? target.artifact.id : target.project.id,
											href: undefined,
										},
									);
							});
						}}
						onRename={(session) =>
						{
							closeRowActions(
								{
									refocus: false,
								},
							);
							setRenaming(
								{
									session,
									open: true,
								},
							);
						}}
						onClose={closeRowActions}
						screenshots={composeAvailable}
					/>
				)}
				{renaming !== null && (
					<PaletteRenameDialog
						key={renaming.session.id}
						session={renaming.session}
						open={renaming.open}
						finalFocus={inputRef}
						paletteOwned
						onClose={() =>
						{
							setRenaming((current) =>
								current === null
									? null
									:
										{
											...current,
											open: false,
										},
							);
						}}
						onClosed={() =>
						{
							setRenaming(null);
						}}
					/>
				)}
			</DialogPopup>
			<PaletteFileDropZone onDropFiles={attachDroppedFiles} disabled={!composeAvailable} />
		</>
	);
}

const ICON_BUTTON_BASE_CLASS =
	"relative flex aspect-square shrink-0 items-center justify-center transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";
const ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE_CLASS} h-7 w-7`;

/** Upstream's footer view hint: a ghost "Compose Tab" or "Search Tab" that switches views like Tab. */
function ViewHint({
	label,
	disabled = false,
	onSwitch,
}: {
	label: string;
	/** Upstream disables it while a Compose send is launching. */
	disabled?: boolean;
	onSwitch: () => void;
})
{
	return (
		<button
			type="button"
			aria-keyshortcuts="Tab"
			data-palette-own-keys=""
			disabled={disabled}
			onMouseDown={(event) =>
			{
				event.preventDefault();
			}}
			onClick={onSwitch}
			className="inline-flex h-5 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-r4 px-1.5 text-caption text-ink-muted hover:bg-fill-ghost-hover disabled:pointer-events-none disabled:opacity-40"
		>
			{/* Upstream's cds Button content span: gap-1 plus the keycap's ms-1 puts 8px between label and Tab. */}
			<span className="inline-flex min-w-0 items-center gap-1">
				{label}
				<kbd aria-hidden="true" className={`ms-1 ${WIDE_KEYCAP_CLASS}`}>
					Tab
				</kbd>
			</span>
		</button>
	);
}

/** Upstream sets this on the card while the footer is collapsed, so the list cap grows by the footer's 41px. */
const FOOTER_COLLAPSED_CARD_CLASS = "[--cp-footer-collapsed:1] pointer-coarse:[--cp-footer-collapsed:0]";
const LIST_MAX_HEIGHT_STYLE =
{
	maxHeight: "calc(440px + var(--cp-footer-collapsed, 0) * 41px)",
} as const;
const LIST_CAP_PX = 440;
const COLLAPSED_FOOTER_PX = 41;
/** The scroller's p-2.5, top and bottom, around the measured cmdk sizer. */
const LIST_PADDING_Y_PX = 20;
/**
 * Upstream's sticky top scroll shadow (c2771e1f6 Oc) and the mask that covers it at rest (kc), the scroller's first two
 * children. The band pins at the scrollport's top edge; the mask scrolls away over the first 10px, uncovering the
 * downward part of the clipped inner div's shadow. Net flow height is 0, so the measured sizer height is unchanged.
 * Local: they lead cmdk's sizer, inside its role=listbox, so they are aria-hidden and marked data-palette-scroll-shadow.
 */
const LIST_SCROLL_SHADOW = (
	<>
		<div
			aria-hidden="true"
			data-palette-scroll-shadow=""
			className="pointer-events-none sticky -top-2.5 z-1 -mx-2.5 -mt-2.5 -mb-2.5 h-2.5 shrink-0 overflow-hidden"
		>
			<div className="absolute inset-x-0 bottom-full h-2.5 shadow-[0_2px_8px_color-mix(in_srgb,var(--cds-black)_6%,transparent)]" />
		</div>
		<div
			aria-hidden="true"
			data-palette-scroll-shadow=""
			className="pointer-events-none relative z-2 -mx-2.5 h-2.5 shrink-0 bg-surface-3"
		/>
	</>
);
const LIST_SCROLLER_CLASS =
	"flex flex-col min-h-0 overflow-y-auto p-2.5 transition-[height,max-height] duration-150 ease-out motion-reduce:transition-none";

/** Observes cmdk's list sizer so the scroller can transition to its content height; null until measured. */
function useListContentHeight(): [(list: HTMLDivElement | null) => void, number | null]
{
	const [height, setHeight] = useState<number | null>(null);
	const observerRef = useRef<ResizeObserver | null>(null);
	const ref = useCallback((list: HTMLDivElement | null) =>
	{
		observerRef.current?.disconnect();
		observerRef.current = null;
		const sizer = list?.querySelector("[cmdk-list-sizer]");
		if (sizer == null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) =>
		{
			const entry = entries.at(-1);
			if (entry !== undefined) setHeight(entry.contentRect.height);
		});
		observer.observe(sizer);
		observerRef.current = observer;
	}, []);
	return [ref, height];
}

/** Upstream collapses the footer with a grid-rows transition rather than unmounting it. */
function FooterCollapse({open, children}: {open: boolean; children: ReactNode})
{
	return (
		<div
			aria-hidden={!open}
			inert={!open}
			className={`flex-shrink-0 grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none mt-auto ${
				open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
			}`}
		>
			<div className="min-h-0 overflow-hidden">{children}</div>
		</div>
	);
}

/** Upstream's keyboard-hint footer: "Close Esc · Change type ←→ · Filters / · Actions ⌥⏎", or "Send ⏎ · Add files or photos ⌘U" in Compose. */
function PaletteFooter({
	compose = false,
	hints,
	trailing,
}: {
	/** Upstream's Compose footer has no top border and no top padding. */
	compose?: boolean;
	/** Each hint's optional className replaces the default wrapper class, e.g. upstream's breakpoint hiding. */
	hints: ReadonlyArray<readonly [label: string, keys: readonly string[], className?: string]>;
	/** Right-aligned extra: upstream's Compose Tab or Search Tab view hint. */
	trailing?: ReactNode;
})
{
	return (
		<div
			data-palette-footer=""
			className={
				compose
					? "bg-surface-3 pr-4 pb-2.5 pl-5 pointer-coarse:hidden"
					: "border-t-[length:max(var(--cds-toolbar-line,0px),0.5px)] border-border bg-surface-3 py-2.5 pr-4 pl-5 pointer-coarse:hidden"
			}
		>
			<div className="flex min-h-5 items-center justify-between text-caption text-ink-muted">
				<div className="flex items-center gap-5">
					{hints.map(([label, keys, className]) => (
						<div key={label} data-palette-footer-hint="" className={className ?? "flex items-center gap-2"}>
							<span>{label}</span>
							<span className="flex items-center gap-[2px]">
								{keys.map((key) => (
									<Shortcut key={key} keys={key} className="touch:hidden" />
								))}
							</span>
						</div>
					))}
				</div>
				{trailing}
			</div>
		</div>
	);
}

/** Each chip's `data-filter`: upstream's filter key, which names the Date filter `active`. */
const CHIP_DATA_FILTER =
{
	date: "active",
	repo: "repo",
	project: "project",
	archived: "archived",
	actions: "actions",
} as const satisfies Record<PaletteChipFilter, string>;

/** Upstream's committed filter chips, in a strip before the textarea. */
const CHIP_BADGE_CLASSES =
	"inline-flex items-center gap-1 h-[22px] whitespace-nowrap rounded-[5.5px] px-2 text-xs leading-[15px] font-control bg-upstream-tint-blue text-upstream-accent";

function FilterChips({
	chips,
	onClear,
	onClearAll,
}: {
	chips: PaletteChip[];
	onClear: (filter: PaletteChipFilter) => void;
	/** Upstream's phone-fold Clear filters. */
	onClearAll: () => void;
})
{
	const stripRef = useRef<HTMLDivElement>(null);
	const shownRef = useRef<ReadonlySet<PaletteChipFilter>>(new Set());
	const look = useFizzyLake("color") ? "fizzy" : "base";
	// Upstream's `$t`: scroll a newly set chip into view.
	useLayoutEffect(() =>
	{
		const strip = stripRef.current;
		const added = chips.find((chip) => !shownRef.current.has(chip.filter));
		shownRef.current = new Set(chips.map((chip) => chip.filter));
		const chip = added && strip?.querySelector<HTMLElement>(`[data-filter="${CHIP_DATA_FILTER[added.filter]}"]`);
		if (strip && chip) scrollIntoStrip(strip, chip, getComputedStyle(strip).paddingLeft);
	}, [chips]);
	// Upstream's phone fold: 2+ non-action chips collapse into one "N filters" chip below `sm`.
	// Actions mode is exclusive, so 2+ chips are never Actions.
	const folded = chips.length > 1;
	const foldText = `${chips.length} filters`;
	return (
		<div
			ref={stripRef}
			role="presentation"
			data-palette-own-keys=""
			className="-mx-1 flex h-8 min-w-0 shrink items-center gap-2 self-start overflow-x-auto overscroll-x-contain scroll-px-1 px-1 [scrollbar-width:none]"
			// Clearing a chip leaves focus and the caret in the textarea.
			onMouseDown={(event) =>
			{
				event.preventDefault();
			}}
			onWheel={(event) =>
			{
				if (event.deltaX === 0) event.currentTarget.scrollLeft += event.deltaY;
			}}
		>
			{folded && (
				<span
					role="group"
					aria-label={`${foldText}: ${new Intl.ListFormat(
						"en",
						{
							type: "unit",
						},
					).format(chips.map((chip) => chip.label))}`}
					className={`${CHIP_BADGE_CLASSES} sm:hidden`}
				>
					<span className={BADGE_LABEL_PAD[look]}>{foldText}</span>
					<ChipClearButton label="Clear filters" onClear={onClearAll} />
				</span>
			)}
			{chips.map((chip) => (
				<span
					key={chip.filter}
					role="group"
					aria-label={chip.label}
					title={chip.title}
					data-filter={CHIP_DATA_FILTER[chip.filter]}
					className={`${CHIP_BADGE_CLASSES} min-w-0 max-w-[10rem] shrink-0${folded ? " max-sm:hidden" : ""}`}
				>
					<span
						className={`min-w-0 overflow-x-clip ${BADGE_LABEL_PAD[look]} text-ellipsis whitespace-nowrap`}
					>
						{chip.text}
					</span>
					<ChipClearButton
						label="Clear filter"
						onClear={() =>
						{
							onClear(chip.filter);
						}}
					/>
				</span>
			))}
		</div>
	);
}

function ChipClearButton({label, onClear}: {label: string; onClear: () => void})
{
	return (
		<button
			type="button"
			aria-label={label}
			className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-[2.5px] -ml-0.5 -mr-[5px] text-current before:absolute before:-left-0.5 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-6 hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
			onMouseDown={(event) =>
			{
				event.preventDefault();
			}}
			onClick={onClear}
		>
			<X aria-hidden="true" size={16} />
		</button>
	);
}

/** Upstream's 28px type tablist under the input; cloud-only tabs are replaced by local types. */
/** `value` is null in Actions mode, where upstream shows no active tab. */
function TypeTabs({value, onChange}: {value: PaletteType | null; onChange: (type: PaletteType) => void})
{
	const scrollerRef = useRef<HTMLDivElement>(null);
	// Base UI keeps the last change's direction until the next one, so track it across renders.
	const [shown, setShown] = useState<
	{
		value: PaletteType | null;
		direction: ActivationDirection;
	}>(
		{
			value,
			direction: "none",
		},
	);
	if (shown.value !== value)
	{
		setShown(
			{
				value,
				direction:
					value === null || shown.value === null
						? "none"
						: activationDirection(PaletteTypeSchema.options, shown.value, value),
			},
		);
	}
	const direction = value === null ? "none" : shown.direction;
	useLayoutEffect(() =>
	{
		const scroller = scrollerRef.current;
		const tab = scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
		if (scroller && tab)
		{
			scrollIntoStrip(scroller, tab, getComputedStyle(scroller).paddingLeft);
		}
	}, [value]);
	return (
		<div
			role="group"
			aria-label="Filters"
			data-palette-own-keys=""
			className="relative -mt-1.5 flow-root px-6 pb-[0.9rem]"
		>
			<div
				ref={scrollerRef}
				role="presentation"
				className="-mx-6 -my-2 min-w-0 scroll-px-6 overflow-x-auto overscroll-x-contain px-6 py-2 [scrollbar-width:none]"
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onWheel={(event) =>
				{
					// Upstream's `en`: a vertical-only wheel scrolls the strip sideways, mirrored in RTL.
					if (event.deltaX === 0)
					{
						const scroller = event.currentTarget;
						const direction = getComputedStyle(scroller).direction === "rtl" ? -1 : 1;
						scroller.scrollLeft += event.deltaY * direction;
					}
				}}
			>
				{/* Upstream's cds Tabs root > data-size contents > scroll-pager scroller > tablist; the fizzy-lake
				    `color` ink and ghost-selected pill rules in globals.css key off [data-cds="Tabs"]. */}
				<div
					data-cds="Tabs"
					data-orientation="horizontal"
					data-activation-direction={direction}
					className="min-w-max"
				>
					<div data-size="sm" className="contents">
						<div data-cds-part="scroll-pager-scroller" className="contents">
							<div
								role="tablist"
								aria-label="Type"
								data-size="sm"
								data-orientation="horizontal"
								data-activation-direction={direction}
								className="flex items-center font-sans data-[orientation=horizontal]:[&>[role=tab]:first-child]:before:start-0 data-[orientation=horizontal]:[&>[role=tab]:last-child]:before:end-0"
							>
								{PaletteTypeSchema.options.map((type) =>
								{
									const selected = type === value;
									return (
										<button
											key={type}
											type="button"
											role="tab"
											aria-selected={selected}
											data-active={selected ? "" : undefined}
											data-orientation="horizontal"
											data-activation-direction={direction}
											aria-disabled="false"
											data-composite-item-active={selected ? "" : undefined}
											tabIndex={selected || (value === null && type === "all") ? 0 : -1}
											onMouseDown={(event) =>
											{
												event.preventDefault();
											}}
											onClick={() =>
											{
												onChange(type);
											}}
											// Comfortable-density geometry (28px, 0 10px, 14px/20px, 7px pill) to match the rest of the
											// palette; upstream's default density is 20px / 6px / 12px·17px / 5px (see density-default-tokens).
											className="relative isolate inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-sm font-medium whitespace-nowrap text-ink-muted outline-none select-none before:absolute before:inset-x-px before:inset-y-0 before:-z-[1] before:rounded-control-sm before:transition-shadow before:duration-[60ms] focus-visible:before:shadow-focus focus-visible:outline-hidden font-control data-[active]:text-primary data-[active]:before:bg-fill-ghost-hover [&:not([data-active])]:hover:text-secondary [&:not([data-active])]:hover:before:bg-fill-ghost-hover"
										>
											{paletteTypeLabels[type]}
										</button>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/** One empty-view row: a lead or Recents session, a visited page, or the New session action. */
function EmptyViewItem({
	row,
	onOpenSession,
	onOpenRowActions,
	onNavigate,
	onNewSession,
}: {
	row: EmptyViewRow;
	onOpenSession: (id: string) => void;
	/** Opens the card for a row's cmdk value. */
	onOpenRowActions: (key: string) => void;
	onNavigate: (href: string) => void;
	onNewSession: () => void;
})
{
	if (row.kind === "action")
	{
		// Upstream's empty state lists only New session, without keycaps; the other actions answer a typed query.
		return (
			<CommandItem value="action:New session" icon={<CirclePlus />} onSelect={onNewSession}>
				New session
			</CommandItem>
		);
	}
	if (row.kind === "page")
	{
		return (
			<CommandItem
				icon={PAGE_ICONS[row.entry.kind]}
				value={`recent:${row.entry.key}`}
				onSelect={() =>
				{
					onNavigate(row.entry.href);
				}}
			>
				{row.title}
			</CommandItem>
		);
	}
	const {mark} = row;
	const secondary = paletteSecondary(
		{
			prNumber: row.prNumber,
			time: undefined,
		},
	);
	return (
		<SessionRowActions
			value={`session:${row.id}`}
			onOpen={() =>
			{
				onOpenRowActions(`session:${row.id}`);
			}}
		>
			<CommandItem
				icon={<PaletteSessionIcon mark={mark} />}
				value={`session:${row.id}`}
				onSelect={() =>
				{
					onOpenSession(row.id);
				}}
				rowActions
				{...(secondary === undefined
					? {}
					:
						{
							secondary: <PaletteSecondary text={secondary} archived={false} />,
						})}
			>
				<HighlightRuns text={row.title} matches={[]} />
				{mark !== undefined && <span className="sr-only"> {PALETTE_MARK_LABELS[mark]}</span>}
			</CommandItem>
		</SessionRowActions>
	);
}

/** Upstream's static mark Pulse colors (`fn`): accent for awaiting, error and unread; brand for running. */
const MARK_DOT_COLOR =
{
	awaiting: "var(--cds-fill-accent)",
	error: "var(--cds-fill-accent)",
	unread: "var(--cds-fill-accent)",
	running: "var(--cds-fill-brand)",
} as const satisfies Record<PaletteMark, string>;

/** Upstream's code-session icon (`mn`): bare when unmarked, else notched by a rem-scaled `--dot-r` mask (mirrored in RTL) under its mark Pulse. */
function PaletteSessionIcon({mark}: {mark: PaletteMark | undefined})
{
	if (mark === undefined)
	{
		return (
			<div className="relative shrink-0">
				<CodeXml />
			</div>
		);
	}
	return (
		<div className="relative shrink-0 [--cds-page-bg:transparent]">
			<span className="block [--dot-r:calc(0.1875rem*var(--cds-rem-scale,1))] [mask-image:radial-gradient(circle_at_calc(100%_-_var(--dot-r)_+_1px)_calc(var(--dot-r)_-_1px),transparent_calc(var(--dot-r)_+_2px),black_calc(var(--dot-r)_+_2.5px))] [&:where(:root[dir=rtl]_:dir(rtl))]:not-forced-colors:[mask-image:radial-gradient(circle_at_calc(var(--dot-r)_-_1px)_calc(var(--dot-r)_-_1px),transparent_calc(var(--dot-r)_+_2px),black_calc(var(--dot-r)_+_2.5px))] forced-colors:[mask-image:none]">
				<CodeXml />
			</span>
			<Pulse
				aria-hidden="true"
				data-palette-mark-dot=""
				animate={false}
				color={MARK_DOT_COLOR[mark]}
				className="absolute -top-px -end-px"
			/>
		</div>
	);
}

/** A command row advertising its registry shortcut as keycaps and `aria-keyshortcuts`. */
function ShortcutCommandItem({
	id,
	...props
}:
{
	id: ShortcutId;
} & Omit<Parameters<typeof CommandItem>[0], "shortcut">)
{
	const shortcut = useShortcutKeys(id);
	return <CommandItem {...props} shortcut={shortcut} />;
}

const ROW_CLASS =
	"peer group flex w-full cursor-pointer items-center justify-between gap-3 truncate rounded-r6 px-3 py-2 text-sm leading-5 text-secondary select-none data-[selected=true]:bg-palette-selected data-[selected=true]:text-primary";

const ARCHIVED_ROW_CLASS = ROW_CLASS.replace("text-secondary", "text-ink-muted");

function ReturnGlyph()
{
	return (
		<span className="hidden shrink-0 text-xs text-ink-muted group-data-[selected=true]:inline-flex pointer-coarse:!hidden">
			<CornerDownLeft aria-hidden="true" className="size-4" />
		</span>
	);
}

/** Upstream's selected send_message enter cap: the 24px brand-filled `accent-badge` instead of the plain glyph. */
function AccentReturnCap()
{
	return (
		<span className="hidden shrink-0 items-center text-xs text-ink-muted group-data-[selected=true]:flex">
			<span className="pointer-coarse:hidden">
				<span
					data-palette-enter-cap=""
					className="-my-1 -me-1.5 flex size-6 items-center justify-center rounded-r5 bg-brand-100 text-oncolor-100"
				>
					<CornerDownLeft aria-hidden="true" className="size-4" />
				</span>
			</span>
		</span>
	);
}

/** A session row with upstream's "…" (`tr`), rendered only while the row is cmdk-selected, that opens the row-actions card. */
function SessionRowActions({value, children, onOpen}: {value: string; children: ReactNode; onOpen: () => void})
{
	const selected = useCommandState((state) => state.value === value);
	return (
		<div className="group/palette-row relative">
			{children}
			{selected && <PaletteRowActionsButton onOpen={onOpen} />}
		</div>
	);
}

/** Upstream's trailing secondary: the PR/time text, then the Archived badge on an archived row; ⏎ replaces it when selected. */
function PaletteSecondary({text, archived}: {text: string | undefined; archived: boolean})
{
	return (
		<span
			data-palette-meta=""
			className="shrink-0 text-xs text-ink-muted group-data-[selected=true]:hidden pointer-coarse:!inline"
		>
			{archived ? (
				<span className="inline-flex items-center gap-1.5">
					{text}
					<ArchivedBadge variant="palette" />
				</span>
			) : (
				text
			)}
		</span>
	);
}

const ROW_ACTIONS_LABEL_CLASS = "me-7 pointer-coarse:me-0";

type GenericKind = Exclude<SearchKind, "session" | "artifact" | "project">;

/** Upstream's kind label `wt`: routines are its scheduled_task (`5q8phk`); the local-only kinds are named after their tabs. */
const GENERIC_KIND_LABELS =
{
	routine: "Scheduled task",
	plan: "Plan",
	memory: "Memory",
	file: "File",
} as const satisfies Record<GenericKind, string>;

function isGenericKind(kind: SearchKind): kind is GenericKind
{
	return Object.hasOwn(GENERIC_KIND_LABELS, kind);
}

/** Upstream's `Lm` href and `yt` header for a generic row; a row without a URL gets no card. */
function genericCardTarget(row: SearchRow, now: number): PaletteCardGeneric | undefined
{
	if (!isGenericKind(row.kind)) return undefined;
	const href = row.kind === "file" ? `/file/${encodeFilePath(row.id)}` : row.href;
	if (href === undefined) return undefined;
	return {
		title: row.title,
		kindLabel: GENERIC_KIND_LABELS[row.kind],
		// Upstream's `_t` gives a scheduled task no time, though its row shows the next run.
		when: row.kind === "routine" ? null : relativeBucket(Date.parse(row.mtime), now),
		href,
	};
}

/** Upstream's `Im` on web: session, artifact and project rows, and every other row with a URL. */
function rowHasActions(row: SearchRow): boolean
{
	return !isGenericKind(row.kind) || genericCardTarget(row, 0) !== undefined;
}

/** Upstream's search row: kind icon, bold title runs, quoted snippet, bucket meta, ⏎ when selected. */
function SearchResultItem({
	row,
	now,
	onSelect,
	onRowActions,
}: {
	row: SearchRow;
	now: number;
	onSelect: () => void;
	onRowActions: () => void;
})
{
	const actions = rowHasActions(row);
	const archived = row.archived === true;
	const item = (
		<Command.Item
			value={rowKey(row)}
			onSelect={onSelect}
			data-item-type={row.kind === "session" ? "code_session" : row.kind}
			{...(actions
				?
					{
						"aria-keyshortcuts": "Alt+Enter",
					}
				: {})}
			{...(archived
				?
					{
						"data-archived": "",
					}
				: {})}
			className={archived ? ARCHIVED_ROW_CLASS : ROW_CLASS}
		>
			<span className={`flex min-w-0 flex-1 items-center gap-2 ${actions ? ROW_ACTIONS_LABEL_CLASS : ""}`}>
				<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
					{rowIcon(row)}
				</span>
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					<span data-palette-label="" className="truncate">
						<HighlightRuns text={row.title} matches={row.titleMatches} />
					</span>
					{row.snippet !== undefined && row.snippet.text !== "" && (
						<span
							data-palette-snippet=""
							className="text-xs text-ink-muted max-w-[60%] shrink-0 overflow-hidden whitespace-nowrap"
						>
							“<HighlightRuns text={row.snippet.text} matches={row.snippet.matches} />”
						</span>
					)}
				</span>
				{row.mark !== undefined && <span className="sr-only"> {PALETTE_MARK_LABELS[row.mark]}</span>}
			</span>
			<PaletteSecondary
				text={paletteSecondary(
					{
						prNumber: row.prNumber,
						time: row.meta ?? relativeBucket(Date.parse(row.mtime), now),
					},
				)}
				archived={archived}
			/>
			<ReturnGlyph />
		</Command.Item>
	);
	return actions ? (
		<SessionRowActions value={rowKey(row)} onOpen={onRowActions}>
			{item}
		</SessionRowActions>
	) : (
		item
	);
}

/** Upstream's Quick actions send_message row: "New session", the raw prompt quoted inline, plus the project it will start in. */
function NewSessionItem({
	prompt,
	projectName,
	onSelect,
}: {
	prompt: string;
	projectName: string | undefined;
	onSelect: () => void;
})
{
	return (
		<Command.Item value={NEW_SESSION_VALUE} onSelect={onSelect} className={ROW_CLASS}>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
					<MessageSquarePlus />
				</span>
				<span data-palette-label="" className="truncate">
					New session
					<span data-palette-prompt="" className="opacity-50 ms-1.5">
						<span>
							<span className="opacity-50">“</span>
							{prompt}
							<span className="opacity-50">”</span>
						</span>
					</span>
				</span>
			</span>
			{projectName !== undefined && (
				<span
					data-palette-project-chip=""
					className="shrink-0 rounded bg-fill-ghost-hover px-1.5 py-px text-xs text-secondary"
				>
					{projectName}
				</span>
			)}
			<AccentReturnCap />
		</Command.Item>
	);
}

function CommandItem({
	children,
	value,
	icon,
	onSelect,
	shortcut,
	rowActions = false,
	secondary,
	badge,
	onPointerEnter,
	lowerQuery,
}: {
	children: ReactNode;
	value: string;
	/** Upstream's label `lowerQuery`: a string label highlights every occurrence of this phrase. */
	lowerQuery?: string;
	icon?: ReactNode;
	/** Upstream's Badge after the label, e.g. a "Filter by" hint's filter name. */
	badge?: ReactNode;
	onSelect: () => void;
	shortcut?: ShortcutKeys;
	rowActions?: boolean;
	/** Upstream's trailing secondary text, e.g. "PR #N". */
	secondary?: ReactNode;
	onPointerEnter?: () => void;
})
{
	const keyShortcuts = rowActions ? "Alt+Enter" : shortcut?.ariaKeyShortcuts;
	return (
		<Command.Item
			value={value}
			onSelect={onSelect}
			{...(onPointerEnter === undefined
				? {}
				:
					{
						onPointerEnter,
					})}
			{...(keyShortcuts === undefined
				? {}
				:
					{
						"aria-keyshortcuts": keyShortcuts,
					})}
			className={ROW_CLASS}
		>
			<span className={`flex min-w-0 flex-1 items-center gap-2 ${rowActions ? ROW_ACTIONS_LABEL_CLASS : ""}`}>
				{icon !== undefined && (
					<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">{icon}</span>
				)}
				<span data-palette-label="" className="truncate">
					{typeof children === "string" ? (
						<HighlightRuns text={children} matches={phraseMatches(children, lowerQuery) ?? []} />
					) : (
						children
					)}
				</span>
				{badge}
			</span>
			{shortcut !== undefined && (
				<span
					aria-hidden="true"
					className="shrink-0 text-ink-muted group-data-[selected=true]:hidden pointer-coarse:hidden"
				>
					<Shortcut keys={shortcut.keys} />
				</span>
			)}
			{secondary}
			<ReturnGlyph />
		</Command.Item>
	);
}
