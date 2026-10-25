import {isSessionRouteAlias} from "../lib/session-route-alias";
import {Dialog} from "@base-ui/react/dialog";
import {Command, defaultFilter} from "cmdk";
import {useNavigate, useRouterState} from "@tanstack/react-router";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {useQueries, useQuery, useQueryClient} from "@tanstack/react-query";
import {
	FileText,
	Brain,
	CodeXml,
	MessageSquare,
	MessagesSquare,
	FolderOpen,
	Search,
	Home,
	SlidersHorizontal,
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
	ListFilter,
	Link,
	Pin,
	PinOff,
	Pencil,
	Terminal,
	GitFork,
	Code,
	Archive,
	ArchiveRestore,
	SquareSlash,
	Shapes,
	Clock,
	Paperclip,
	ArrowUp,
} from "lucide-react";
import {useActiveSessionsIfAvailable} from "../hooks/use-claude-events";
import {useCoarsePointer} from "../lib/use-phone-sheet";
import type {PaletteEntrypoint, PaletteMode} from "../hooks/use-command-palette";
import {useDebouncedValue} from "../hooks/use-debounced-value";
import {sessionIdentityQueryOptions} from "../lib/api/session-identity";
import {useSessionIdentity} from "../hooks/use-session-identity";
import {useSessionArchive} from "../hooks/use-session-archive";
import {artifactsQueryOptions, type ArtifactSummary} from "../lib/api/artifacts";
import {encodeFilePath} from "../lib/api/file";
import {launchHerdrSession} from "../lib/api/herdr";
import {projectMemoriesQueryOptions} from "../lib/api/memories";
import {plansQueryOptions, type PlanListItem} from "../lib/api/plans";
import {assertNever} from "../lib/assert-never";
import {projectsQueryOptions} from "../lib/api/projects";
import {routinesQueryOptions, type Routine} from "../lib/api/routines";
import {artifactTimestamp} from "../lib/artifact-gallery";
import {unifiedSearchQueryOptions, type UnifiedSearchItem} from "../lib/api/search";
import {
	recentSessionsQueryOptions,
	sessionDetailQueryOptions,
	type SessionDetailData,
	type SessionListItem,
} from "../lib/api/sessions";
import {buildClaudeCopyCommand} from "../lib/claude-launch-command";
import {
	appendAttachment,
	attachUploadedFiles,
	composePrompt,
	registerComposer,
	takeContextChips,
	useContextChips,
} from "../lib/context-attach";
import {writeClipboardText} from "../lib/clipboard";
import {requestHomeComposerFocus} from "../lib/home-composer-focus";
import {
	PALETTE_FILTER_TOKENS,
	PaletteTypeSchema,
	isClientPaletteType,
	paletteDateCutoff,
	nextPaletteType,
	paletteFilterHints,
	paletteProjectMatches,
	paletteSearchParams,
	paletteValueSuggestions,
	paletteTypeStep,
	parsePaletteTokens,
	scrollIntoStrip,
	type PaletteFilter,
	type PaletteProject,
	type PaletteTokens,
	type PaletteType,
	type ServerPaletteType,
} from "../lib/palette-tokens";
import {
	findLaunchedSession,
	startSessionProjects,
	type PendingLaunch,
	type StartProject,
} from "../lib/palette-start-session";
import {pin, unpin, usePins} from "../lib/pin-store";
import {toMdSlug} from "../lib/md-slug";
import {loadRecents, resolveRecentSessions, routeToRecent, type RecentEntry} from "../lib/recents-history";
import {filterRoutines, formatNextRun, routineTitle, sortRoutines} from "../lib/routines";
import {paletteEmptyKind, paletteEmptyMessage} from "../lib/palette-empty";
import {PaletteEmptyState} from "./palette-empty-state";
import {PaletteSkeleton} from "./palette-skeleton";
import {paletteFilterLabels, paletteTypeLabels} from "../lib/schema-choices";
import {relativeBucket, titleMatches, type Snippet, type TextMatch} from "../lib/search-text";
import {createSessionCommands} from "../lib/session-commands";
import {openSideChat} from "../lib/side-chat-store";
import {getSessionMenuItems, type SessionMenuCapability} from "../lib/session-menu-items";
import {copySessionLink} from "../lib/session-open-in";
import {requestSessionRename} from "../lib/session-rename-request";
import type {SessionBucket} from "../lib/session-state";
import {SHORTCUTS, type ShortcutId} from "../lib/shortcuts/registry";
import {toggleSidebarCollapsed} from "../lib/sidebar-store";
import {type ShortcutKeys, useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import {clearAll} from "../lib/unread-store";
import {startPaletteSearchJourney} from "../lib/perf/field-journeys";
import {HighlightRuns} from "./highlight-runs";
import {type PaletteCardSession, PaletteRowActionsButton, PaletteRowActionsCard} from "./palette-row-actions";
import {AttachedContextChips} from "./attached-context-chips";
import {useToast} from "./toast-context";
import {Shortcut} from "./ui/shortcut";
import {Spinner} from "./ui/spinner";
import {ArchivedBadge} from "./archived-badge";
import {Tooltip} from "./ui/tooltip";
import {useOpenSettings} from "./settings/open-settings";
import {setKeyboardShortcutsOpen} from "./keyboard-shortcuts-open";

/*
 * The claude.ai/code ⌘K palette shell, split Search | Compose variant
 * (see .llm/upstream-sync/features/search-or-start.md). cmdk keeps the list
 * filtering and keyboard selection; the dialog, input row, headings, rows and
 * footer copy upstream's geometry.
 */

const MODE_LABELS = {
	search: "Search",
	compose: "Write a message…",
} as const satisfies Record<PaletteMode, string>;

/** Draft key for Compose-mode attachment chips, which ride along with the launch prompt. */
const COMPOSE_DRAFT_KEY = "command-palette-compose";
/** Upstream's hidden screen-reader hint, referenced by the Search textarea's aria-describedby. */
const PALETTE_KEYS_HINT_ID = "command-palette-keys-hint";

const PALETTE_RADIUS = "rounded-[calc(var(--radius-composer)+0.375rem)]";

const GROUP_CLASS =
	"[&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:text-[12px]/[17px] [&_[cmdk-group-heading]]:text-ink-muted [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col";

/** Fetched deep enough that sessions needing attention surface even when they are not the newest. */
export const PALETTE_RECENT_LIMIT = 25;

/** Upstream caps the default entrypoint's organic list (Needs attention + Recents) at 7. */
const ORGANIC_LIMIT = 7;
/** Recents keep up to 3 of those rows, as upstream's 4 Needs attention + 3 Recents. */
const RECENTS_RESERVED = 3;

export const PALETTE_SEARCH_DEBOUNCE_MS = 150;

/** Server hit kinds plus the kinds the Projects, Artifacts and Scheduled tabs list client-side. */
type SearchKind = UnifiedSearchItem["kind"] | "project" | "artifact" | "routine";

const KIND_ICONS = {
	session: <CodeXml />,
	plan: <FileText />,
	memory: <Brain />,
	file: <File />,
	project: <FolderOpen />,
	artifact: <Shapes />,
	routine: <Clock />,
} as const satisfies Record<SearchKind, ReactNode>;

/** One typed-search row: an instant title match over recents, or a server hit. */
interface SearchRow {
	kind: SearchKind;
	id: string;
	title: string;
	titleMatches: readonly TextMatch[];
	snippet: Snippet | undefined;
	mtime: string;
	awaiting: boolean;
	/** Only recents know it; server hits leave it unset. */
	archived?: boolean;
	href: string | undefined;
	/** Replaces the relative-time meta, e.g. a routine's next run. */
	meta?: string;
}

function sessionRow(session: SessionListItem, matches: readonly TextMatch[]): SearchRow {
	return {
		kind: "session",
		id: session.id,
		title: session.title,
		titleMatches: matches,
		snippet: undefined,
		mtime: session.mtime,
		awaiting: session.bucket === "blocked",
		archived: session.archived,
		href: undefined,
	};
}

function instantRows(sessions: readonly SessionListItem[], query: string): SearchRow[] {
	const rows: SearchRow[] = [];
	for (const session of sessions) {
		const matches = titleMatches(session.title, query);
		if (matches !== null) rows.push(sessionRow(session, matches));
	}
	return rows;
}

/** Apply the `repo:`/`project:` and `date:` tokens to cached recents, like the server does to hits. */
function filterSessions(
	sessions: readonly SessionListItem[],
	tokens: PaletteTokens,
	projects: readonly PaletteProject[],
	now: number,
): SessionListItem[] {
	const {project, date} = tokens;
	const cutoff = date === undefined ? null : paletteDateCutoff(date, now);
	const resolved = project === undefined ? undefined : projects.find((p) => paletteProjectMatches(project, p));
	return sessions.filter((session) => {
		if (cutoff !== null && Date.parse(session.mtime) < cutoff) return false;
		if (project === undefined) return true;
		if (resolved !== undefined) {
			return session.projectName === resolved.name || session.project === resolved.projectPath;
		}
		return paletteProjectMatches(project, {
			id: "",
			name: session.projectName,
			projectPath: session.project,
		});
	});
}

function projectRows(projects: readonly PaletteProjectItem[], text: string): SearchRow[] {
	const rows: SearchRow[] = [];
	for (const project of projects) {
		const matches = text === "" ? [] : titleMatches(project.name, text);
		if (matches === null) continue;
		rows.push({
			kind: "project",
			id: project.id,
			title: project.name,
			titleMatches: matches,
			snippet: undefined,
			mtime: project.lastActivity,
			awaiting: false,
			href: undefined,
		});
		if (rows.length === PALETTE_RECENT_LIMIT) break;
	}
	return rows;
}

/** The Artifacts tab: newest first, narrowed by the query text. */
function artifactRows(artifacts: readonly ArtifactSummary[], text: string): SearchRow[] {
	const rows: SearchRow[] = [];
	for (const artifact of artifacts.toSorted((a, b) => artifactTimestamp(b) - artifactTimestamp(a))) {
		const matches = text === "" ? [] : titleMatches(artifact.title, text);
		if (matches === null) continue;
		rows.push({
			kind: "artifact",
			id: artifact.id,
			title: artifact.title,
			titleMatches: matches,
			snippet: undefined,
			mtime: new Date(artifactTimestamp(artifact)).toISOString(),
			awaiting: false,
			href: undefined,
		});
		if (rows.length === PALETTE_RECENT_LIMIT) break;
	}
	return rows;
}

/** The Scheduled tab: active routines by next run, narrowed like the /routines search. */
function routineRows(routines: readonly Routine[], text: string, now: number): SearchRow[] {
	const {visible} = filterRoutines(routines, {
		search: text,
		schedule: "all",
		status: "all",
		includeCompleted: false,
	});
	return sortRoutines(visible, "next-run")
		.slice(0, PALETTE_RECENT_LIMIT)
		.map((routine) => {
			const title = routineTitle(routine);
			return {
				kind: "routine",
				id: routine.toolUseId,
				title,
				titleMatches: text === "" ? [] : (titleMatches(title, text) ?? []),
				snippet: undefined,
				mtime: new Date(routine.createdAt).toISOString(),
				awaiting: false,
				href: undefined,
				meta:
					routine.nextRunAt === null
						? (routine.humanSchedule ?? routine.schedule ?? "")
						: formatNextRun(routine.nextRunAt, now),
			};
		});
}

interface PaletteProjectItem extends PaletteProject {
	lastActivity: string;
	memoryCount: number;
}

/** A plan or memory the Plans and Memories tabs list with an empty query. */
interface PaletteDoc {
	kind: "plan" | "memory";
	id: string;
	title: string;
	mtime: string;
	href: string;
	projectIds: readonly string[];
}

function planDocs(plans: readonly PlanListItem[]): PaletteDoc[] {
	return plans.map((plan) => {
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
): SearchRow[] {
	const {project, date} = tokens;
	const cutoff = date === undefined ? null : paletteDateCutoff(date, now);
	const resolved = project === undefined ? undefined : projects.find((p) => paletteProjectMatches(project, p));
	return docs
		.filter((doc) => {
			if (cutoff !== null && Date.parse(doc.mtime) < cutoff) return false;
			return project === undefined || (resolved !== undefined && doc.projectIds.includes(resolved.id));
		})
		.toSorted((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime))
		.slice(0, PALETTE_RECENT_LIMIT)
		.map((doc) => ({
			kind: doc.kind,
			id: doc.id,
			title: doc.title,
			titleMatches: [],
			snippet: undefined,
			mtime: doc.mtime,
			awaiting: false,
			href: doc.href,
		}));
}

function serverRow(item: UnifiedSearchItem): SearchRow {
	return {
		kind: item.kind,
		id: item.id,
		title: item.title,
		titleMatches: item.titleMatches,
		snippet: item.snippet,
		mtime: item.mtime,
		awaiting: item.state === "waiting",
		href: item.href,
	};
}

const NO_SESSIONS: readonly SessionListItem[] = [];
const NO_PROJECTS: readonly PaletteProjectItem[] = [];
const NO_ARTIFACTS: readonly ArtifactSummary[] = [];
const NO_ROUTINES: readonly Routine[] = [];
const NO_PLANS: readonly PlanListItem[] = [];

/** Module-level so useQueries memoizes the combined lists across renders. */
function memoryListData<T>(results: ReadonlyArray<{data: T}>): T[] {
	return results.map((result) => result.data);
}

/** "/…" hint rows, or null to search normally (also when no hint matches). */
function hintsFor(query: string): PaletteFilter[] | null {
	const hints = paletteFilterHints(query);
	return hints === null || hints.length === 0 ? null : hints;
}

const NEW_SESSION_VALUE = "start:new-session";

function rowKey(row: Pick<SearchRow, "kind" | "id">): string {
	return `${row.kind}:${row.id}`;
}

function commandMatches(label: string, query: string, keywords: readonly string[] = []): boolean {
	return defaultFilter(label, query, [...keywords]) > 0;
}

type AttentionBucket = Extract<SessionBucket, "blocked" | "review">;

const ATTENTION_LABELS = {
	blocked: "Awaiting input",
	review: "Needs review",
} as const satisfies Record<AttentionBucket, string>;

interface PaletteSession {
	id: string;
	title: string;
}

interface AttentionSession extends PaletteSession {
	bucket: AttentionBucket;
}

function isAttentionBucket(bucket: SessionBucket): bucket is AttentionBucket {
	return bucket === "blocked" || bucket === "review";
}

/** A Recents row: a visited page from the per-tab MRU, or an mtime-ordered session fallback. */
type PaletteRecent =
	| {kind: "session"; id: string; title: string}
	| {kind: "page"; entry: PalettePageEntry; title: string};

type PalettePageKind = "plan" | "memory" | "project" | "command";
type PalettePageEntry = RecentEntry & {kind: PalettePageKind};

const PAGE_ICONS = {
	plan: <FileText />,
	memory: <Brain />,
	project: <FolderOpen />,
	command: <SquareSlash />,
} as const satisfies Record<PalettePageKind, ReactNode>;

function isPageEntry(entry: RecentEntry): entry is PalettePageEntry {
	return entry.kind in PAGE_ICONS;
}

/** The visited pages Recents shows: sessions and page kinds, not subagent lists or the page on screen. */
function mruRecents(
	history: readonly RecentEntry[],
	currentKey: string | undefined,
	sessionTitles: ReadonlyMap<string, string>,
	attentionIds: ReadonlySet<string>,
): PaletteRecent[] {
	const recents: PaletteRecent[] = [];
	for (const entry of history) {
		if (entry.key === currentKey) continue;
		if (entry.kind === "session") {
			const id = entry.key.slice("session:".length);
			if (isSessionRouteAlias(id) || attentionIds.has(id)) continue;
			recents.push({
				kind: "session",
				id,
				title: sessionTitles.get(id) ?? entry.title ?? "Untitled",
			});
		} else if (isPageEntry(entry)) {
			recents.push({kind: "page", entry, title: entry.title ?? "Untitled"});
		}
	}
	return recents;
}

/**
 * Split into upstream's empty-state groups, dropping the page on screen. Recents follow the per-tab
 * visit MRU, falling back to mtime-ordered sessions until the tab has visited anything else.
 */
function paletteGroups(
	sessions: readonly SessionListItem[],
	history: readonly RecentEntry[],
	currentKey: string | undefined,
	currentSessionId: string | undefined,
): {attention: AttentionSession[]; recents: PaletteRecent[]} {
	const attention: AttentionSession[] = [];
	const fallback: PaletteRecent[] = [];
	for (const session of sessions) {
		if (session.id === currentSessionId) continue;
		if (isAttentionBucket(session.bucket)) {
			attention.push({id: session.id, title: session.title, bucket: session.bucket});
		} else {
			fallback.push({kind: "session", id: session.id, title: session.title});
		}
	}
	const visited = mruRecents(
		history,
		currentKey,
		new Map(sessions.map((session) => [session.id, session.title])),
		new Set(attention.map((session) => session.id)),
	);
	const recents = visited.length > 0 ? visited : fallback;
	const cappedAttention = attention.slice(0, ORGANIC_LIMIT - Math.min(RECENTS_RESERVED, recents.length));
	return {
		attention: cappedAttention,
		recents: recents.slice(0, ORGANIC_LIMIT - cappedAttention.length),
	};
}

/** Pages reachable by typing; upstream keeps navigation out of the empty state. */
const NAV_COMMANDS = [
	{to: "/", label: "Home", icon: <Home />, keywords: ["home", "start"]},
	{to: "/sessions", label: "Sessions", icon: <MessageSquare />, keywords: ["session", "history"]},
	{to: "/active", label: "Active", icon: <Activity />, keywords: ["active", "live", "running"]},
	{to: "/pinned", label: "Pinned", icon: <Pin />, keywords: ["pin", "star", "favorite"]},
	{to: "/projects", label: "Projects", icon: <FolderOpen />, keywords: ["project", "repo"]},
	{to: "/plans", label: "Plans", icon: <FileText />, keywords: ["plan", "markdown"]},
	{to: "/memories", label: "Memories", icon: <Brain />, keywords: ["memory", "claude.md"]},
	{to: "/tasks", label: "Tasks", icon: <ListChecks />, keywords: ["task", "todo"]},
	{to: "/customize", label: "Customize", icon: <Puzzle />, keywords: ["skill", "plugin"]},
] as const;

type SessionCommandId =
	| "pin"
	| "unpin"
	| "rename"
	| "copy-link"
	| "archive"
	| "unarchive"
	| "copy-resume"
	| "copy-fork";

interface SessionCommand {
	id: SessionCommandId;
	label: string;
}

const SESSION_COMMAND_ICONS = {
	pin: <Pin />,
	unpin: <PinOff />,
	rename: <Pencil />,
	"copy-link": <Link />,
	archive: <Archive />,
	unarchive: <ArchiveRestore />,
	"copy-resume": <Terminal />,
	"copy-fork": <GitFork />,
} as const satisfies Record<SessionCommandId, ReactNode>;

/** Upstream's contextual commands surface for "session" plus each action's own verb. */
const SESSION_COMMAND_KEYWORDS = {
	pin: ["session", "pin", "star"],
	unpin: ["session", "unpin", "pin", "star"],
	rename: ["session", "rename", "title"],
	"copy-link": ["session", "copy", "link", "url"],
	archive: ["session", "archive", "hide"],
	unarchive: ["session", "unarchive", "archive", "restore"],
	"copy-resume": ["session", "copy", "resume", "command"],
	"copy-fork": ["session", "copy", "fork", "command"],
} as const satisfies Record<SessionCommandId, readonly string[]>;

const SESSION_COMMAND_CAPABILITIES: ReadonlySet<SessionMenuCapability> = new Set([
	"pin",
	"rename",
	"copyLink",
	"archive",
]);

/** The session on screen as ⌘K commands: the shared menu model's quoted titles, then the CLI copies. */
function currentSessionCommands(detail: SessionDetailData, pinned: boolean): SessionCommand[] {
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
		{surface: "palette"},
	);
	const commands = menu.flatMap((entry): SessionCommand[] => {
		if (entry.kind !== "item") return [];
		switch (entry.id) {
			case "pin":
			case "unpin":
			case "rename":
			case "copy-link":
			case "archive":
			case "unarchive":
				return [{id: entry.id, label: entry.label}];
			default:
				return [];
		}
	});
	return [
		...commands,
		{id: "copy-resume", label: "Copy resume command"},
		{id: "copy-fork", label: "Copy fork command"},
	];
}

function startProjectValue(project: StartProject): string {
	return `start-project:${project.id}`;
}

/** The "New session" flow: the typed text, then a project picker, then the herdr launch. */
type StartStep = "idle" | "picker" | "launching";

interface PaletteAction {
	label: string;
	icon: ReactNode;
	run: () => void;
	shortcut?: ShortcutId;
}

function useCurrentSessionId(): string | undefined {
	const routeId = useRouterState({
		select: (state) => {
			for (const match of state.matches) {
				if (match.routeId === "/session/$id") return match.params.id;
			}
			return null;
		},
	});
	return useSessionIdentity(routeId) ?? undefined;
}

/** Keep this opening's MRU fixed while its legacy alias identities finish loading. */
function usePaletteHistory(): RecentEntry[] {
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
	const identities = useQueries({queries: aliases.map(sessionIdentityQueryOptions)});
	const owners = new Map(
		aliases.map((alias, index) => {
			const identity = identities[index];
			return [alias, identity?.isSuccess ? identity.data.sessionId : null] as const;
		}),
	);
	return resolveRecentSessions(snapshot, (alias) => owners.get(alias) ?? null);
}

export interface CommandPaletteProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode?: PaletteMode;
	onModeChange?: (mode: PaletteMode) => void;
	/** "search" for the sidebar Search entry, which upstream opens without the floating pill. */
	entrypoint?: PaletteEntrypoint;
}

export function CommandPalette({
	open,
	onOpenChange,
	mode: controlledMode,
	onModeChange,
	entrypoint = "default",
}: CommandPaletteProps) {
	const [uncontrolledMode, setUncontrolledMode] = useState<PaletteMode>("search");
	const mode = controlledMode ?? uncontrolledMode;
	const setMode = onModeChange ?? setUncontrolledMode;

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<PalettePopup mode={mode} onModeChange={setMode} onOpenChange={onOpenChange} entrypoint={entrypoint} />
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** Mounted only while open, so the query resets on every open like upstream. */
function PalettePopup({
	mode,
	onModeChange,
	onOpenChange,
	entrypoint,
}: {
	mode: PaletteMode;
	onModeChange: (mode: PaletteMode) => void;
	onOpenChange: (open: boolean) => void;
	entrypoint: PaletteEntrypoint;
}) {
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const [rowActions, setRowActions] = useState<{session: PaletteCardSession; top: number} | null>(null);
	const [query, setQuery] = useState("");
	const [tab, setTab] = useState<PaletteType>("all");
	const {data} = useQuery(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT));
	const queryClient = useQueryClient();
	const currentSessionId = useCurrentSessionId();
	const detailQuery = useQuery({
		...sessionDetailQueryOptions(currentSessionId ?? ""),
		enabled: currentSessionId !== undefined,
	});
	const currentDetail = currentSessionId === undefined ? null : (detailQuery.data ?? null);
	const pins = usePins();
	const setArchived = useSessionArchive(currentSessionId ?? "");
	const toast = useToast();
	const activeSessions = useActiveSessionsIfAvailable();
	const [startStep, setStartStep] = useState<StartStep>("idle");
	const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
	// Controlled so the picker can preselect its first project; cmdk selects the first row otherwise.
	const [selectedValue, setSelectedValue] = useState("");
	// Rename hands focus to the page title, so closing must not pull it back to the old element.
	const restoreFocusRef = useRef(true);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const composeChips = useContextChips(COMPOSE_DRAFT_KEY);

	// Compose attachments land as chips here (⌘U, the paperclip); they are dropped when the palette closes.
	useEffect(() => {
		const unregister = registerComposer(COMPOSE_DRAFT_KEY, {
			insertText: (text) => {
				setQuery((current) => appendAttachment(current, text));
			},
			focus: () => inputRef.current?.focus(),
		});
		return () => {
			unregister();
			takeContextChips(COMPOSE_DRAFT_KEY);
		};
	}, []);

	const pathname = useRouterState({select: (state) => state.location.pathname});
	const history = usePaletteHistory();
	const {attention, recents} = useMemo(
		() =>
			paletteGroups(
				data?.sessions ?? [],
				history,
				currentSessionId === undefined ? routeToRecent(pathname)?.key : `session:${currentSessionId}`,
				currentSessionId,
			),
		[data, history, pathname, currentSessionId],
	);

	const trimmedQuery = query.trim();
	const hints = hintsFor(trimmedQuery);
	const tokens = useMemo(() => parsePaletteTokens(trimmedQuery), [trimmedQuery]);
	/** Date, repo or archived narrowing, which upstream's Clear filters drops while keeping the text. */
	const hasFilterTokens = tokens.date !== undefined || tokens.project !== undefined || tokens.archived === true;
	// A trailing bare `key:` lists that filter's values instead of results.
	const valueSuggestions = useMemo(
		() => (hints === null ? paletteValueSuggestions(query, data?.sessions ?? []) : null),
		[hints, query, data],
	);
	const actionsOnly = tokens.actions === true;
	const searchable = hints === null && valueSuggestions === null && !actionsOnly;
	const type = tokens.type ?? tab;
	const filtered =
		type !== "all" || tokens.project !== undefined || tokens.date !== undefined || tokens.archived === true;
	const canStart = trimmedQuery !== "" && searchable;
	// `archived:` searches recents that include archived sessions.
	const withArchivedQuery = useQuery({
		...recentSessionsQueryOptions(PALETTE_RECENT_LIMIT, "all"),
		enabled: tokens.archived === true,
	});
	const searchedSessions = (tokens.archived === true ? withArchivedQuery.data : data)?.sessions ?? NO_SESSIONS;
	const projectsQuery = useQuery({
		...projectsQueryOptions(),
		enabled: type === "projects" || type === "memories" || tokens.project !== undefined || startStep === "picker",
	});
	const projects = projectsQuery.data ?? NO_PROJECTS;
	const artifactsQuery = useQuery({...artifactsQueryOptions, enabled: type === "artifacts"});
	const artifacts = artifactsQuery.data ?? NO_ARTIFACTS;
	const routinesQuery = useQuery({...routinesQueryOptions, enabled: type === "scheduled"});
	const routines = routinesQuery.data ?? NO_ROUTINES;
	const listsRecentDocs = searchable && tokens.text === "";
	const plansQuery = useQuery({...plansQueryOptions(), enabled: listsRecentDocs && type === "plans"});
	const plans = plansQuery.data ?? NO_PLANS;
	const memoryLists = useQueries({
		queries: projects
			.filter((project) => project.memoryCount > 0)
			.map((project) => ({
				...projectMemoriesQueryOptions(project.id),
				enabled: listsRecentDocs && type === "memories",
			})),
		combine: memoryListData,
	});
	const memoryDocs = useMemo(
		(): PaletteDoc[] =>
			memoryLists.flatMap((list) =>
				(list?.memories ?? []).map((memory) => {
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
			? paletteSearchParams(parsePaletteTokens(debouncedQuery), tab, projects)
			: null;
	const serverActive =
		searchable &&
		tokens.text !== "" &&
		!isClientPaletteType(type) &&
		(tokens.project === undefined || !projectsQuery.isPending);
	const serverSearch = useQuery({
		...unifiedSearchQueryOptions(debouncedParams ?? {query: ""}),
		enabled: serverActive && debouncedParams !== null && debouncedParams.query !== "",
	});
	const searching = serverActive && (debouncedQuery !== trimmedQuery || serverSearch.isFetching);

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
	const listing = useMemo((): SearchRow[] | null => {
		if (!searchable || (trimmedQuery === "" && tab === "all")) return null;
		if (type === "projects") return projectRows(projects, tokens.text);
		if (type === "artifacts") return artifactRows(artifacts, tokens.text);
		if (type === "scheduled") return routineRows(routines, tokens.text, Date.now());
		if (type === "plans" && tokens.text === "") return recentDocRows(planDocs(plans), tokens, projects, Date.now());
		if (type === "memories" && tokens.text === "") return recentDocRows(memoryDocs, tokens, projects, Date.now());
		if ((type === "sessions" || type === "all") && tokens.text === "") {
			return visibleSessions.slice(0, PALETTE_RECENT_LIMIT).map((session) => sessionRow(session, []));
		}
		return null;
	}, [
		searchable,
		trimmedQuery,
		tab,
		type,
		projects,
		artifacts,
		routines,
		plans,
		memoryDocs,
		tokens,
		visibleSessions,
	]);

	const instant = useMemo(
		() => (!searchesSessions || tokens.text === "" ? [] : instantRows(visibleSessions, tokens.text)),
		[searchesSessions, visibleSessions, tokens.text],
	);

	// Instant rows keep their position; server rows append, minus what is already shown.
	const serverRows = useMemo(() => {
		if (!serverActive || debouncedQuery !== trimmedQuery || serverSearch.data === undefined) {
			return [];
		}
		const shown = new Set(instant.map(rowKey));
		return serverSearch.data.items
			.filter((item) => item.id !== currentSessionId || item.kind !== "session")
			.map(serverRow)
			.filter((row) => !shown.has(rowKey(row)));
	}, [serverActive, serverSearch.data, debouncedQuery, trimmedQuery, instant, currentSessionId]);

	// Sessions the → card can act on: recents carry archive/bucket state, server hits do not.
	const cardSessions = useMemo(() => {
		const byId = new Map<string, PaletteCardSession>();
		for (const row of serverRows) {
			if (row.kind !== "session") continue;
			byId.set(row.id, {
				id: row.id,
				title: row.title,
				mtime: row.mtime,
				archived: undefined,
				bucket: undefined,
			});
		}
		for (const session of searchedSessions) {
			byId.set(session.id, {
				id: session.id,
				title: session.title,
				mtime: session.mtime,
				archived: session.archived,
				bucket: session.bucket,
			});
		}
		return byId;
	}, [searchedSessions, serverRows]);

	function openRowActions(id: string) {
		const session = cardSessions.get(id);
		const popup = popupRef.current;
		if (session === undefined || popup === null) return;
		const row = [...popup.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
			(item) => item.dataset["value"] === `session:${id}`,
		);
		const top = row === undefined ? 0 : row.getBoundingClientRect().top - popup.getBoundingClientRect().top;
		setRowActions({session, top});
	}

	function closeRowActions({refocus}: {refocus: boolean}) {
		setRowActions(null);
		if (refocus) inputRef.current?.focus();
	}

	function openSession(id: string) {
		void navigate({to: "/session/$id", params: {id}});
	}

	function openRow(row: SearchRow) {
		if (row.kind === "session") openSession(row.id);
		else if (row.kind === "project") void navigate({to: "/project/$id", params: {id: row.id}});
		else if (row.kind === "artifact") void navigate({to: "/artifact/$id", params: {id: row.id}});
		else if (row.kind === "routine") void navigate({to: "/routines"});
		else if (row.kind === "file") {
			void navigate({to: "/file/$", params: {_splat: encodeFilePath(row.id)}});
		} else if (row.href !== undefined) void navigate({href: row.href});
	}

	async function copyCommand(command: string) {
		const copied = await writeClipboardText(command);
		toast(
			copied
				? {kind: "success", message: "Command copied to clipboard."}
				: {kind: "error", message: "Couldn’t copy the command. Try again."},
		);
	}

	function runSessionCommand(id: SessionCommandId) {
		if (currentSessionId === undefined || currentDetail === null) return;
		const shell = createSessionCommands(currentSessionId, currentDetail.projectPath);
		switch (id) {
			case "pin":
			case "unpin":
				if (id === "pin") pin(currentSessionId);
				else unpin(currentSessionId);
				return;
			case "rename":
				restoreFocusRef.current = false;
				requestSessionRename(currentSessionId);
				return;
			case "copy-link":
				void copySessionLink(currentSessionId, toast, queryClient);
				return;
			case "archive":
			case "unarchive":
				setArchived(id === "archive");
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
				(data?.sessions ?? []).map((session) => session.project),
				currentDetail?.projectId,
			),
		[projects, data, currentDetail],
	);
	const startProjectName = currentDetail?.projectName ?? data?.sessions[0]?.projectName;

	function openStartPicker() {
		setStartStep("picker");
		const first = startProjects[0];
		setSelectedValue(first === undefined ? "" : startProjectValue(first));
	}

	async function launchSession(project: StartProject) {
		const launch = {
			cwd: project.projectPath,
			prompt: composePrompt(trimmedQuery, takeContextChips(COMPOSE_DRAFT_KEY), []),
		};
		const since = Date.now();
		setStartStep("launching");
		try {
			const {sessionId} = await launchHerdrSession(launch);
			setPendingLaunch({cwd: launch.cwd, since, sessionId});
		} catch {
			const copied = await writeClipboardText(buildClaudeCopyCommand(launch));
			toast(
				copied
					? {kind: "success", message: "Copied command — no terminal to launch in"}
					: {kind: "error", message: "Couldn’t start a session. Try again."},
			);
			onOpenChange(false);
		}
	}

	// The launched session opens once its SessionStart hook arrives over SSE.
	useEffect(() => {
		if (pendingLaunch === null) return;
		const id = findLaunchedSession(activeSessions.values(), pendingLaunch);
		if (id === null) return;
		onOpenChange(false);
		void navigate({to: "/session/$id", params: {id}});
	}, [pendingLaunch, activeSessions, onOpenChange, navigate]);

	function seeAllResults(apiType: ServerPaletteType) {
		void navigate({to: "/search", search: {q: tokens.text, type: apiType}});
	}

	// Upstream resets the highlight to row 0 on every tab change (`pg={index:0}`); the stale cmdk value
	// from the previous tab would otherwise leave no row selected. Quick actions still win when shown.
	const pendingFirstRowRef = useRef(false);
	useEffect(() => {
		if (!pendingFirstRowRef.current) return;
		const first = canStart ? NEW_SESSION_VALUE : listing?.[0] === undefined ? undefined : rowKey(listing[0]);
		if (first === undefined) return;
		pendingFirstRowRef.current = false;
		setSelectedValue(first);
	}, [tab, listing, canStart]);

	// cmdk only refreshes `aria-activedescendant` when its own keys move the selection, never for a
	// controlled value, so every commit points the textarea at the selected row itself. It writes the
	// attribute directly (a state round trip would cost the palette a second commit), and the textarea
	// overrides cmdk's own prop with undefined so React never writes cmdk's stale id over it.
	useLayoutEffect(() => {
		const input = inputRef.current;
		if (input === null) return;
		const items = cardRef.current?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [];
		const id = [...items].find((item) => item.dataset["value"] === selectedValue)?.id;
		if (id === undefined) input.removeAttribute("aria-activedescendant");
		else if (input.getAttribute("aria-activedescendant") !== id) input.setAttribute("aria-activedescendant", id);
	});

	function chooseTab(next: PaletteType) {
		setTab(next);
		setSelectedValue("");
		pendingFirstRowRef.current = true;
		inputRef.current?.focus();
	}

	function chooseFilter(filter: PaletteFilter) {
		setQuery(PALETTE_FILTER_TOKENS[filter]);
		inputRef.current?.focus();
	}

	function chooseFilterValue(next: string) {
		setQuery(next);
		inputRef.current?.focus();
	}

	// Upstream's Search all clears the type and every chip, keeping only the typed text.
	function searchAll() {
		setQuery(tokens.text);
		chooseTab("all");
	}

	// Upstream's Actions minus the cloud-only ones; New session lives in Quick actions once text is typed.
	const actions = (
		[
			{
				label: "Search sessions",
				icon: <Search />,
				run: () => void navigate({to: "/search", search: {q: "", type: "all" as const}}),
				shortcut: "search",
			},
			{
				label: "Keyboard shortcuts",
				icon: <Keyboard />,
				run: () => {
					setKeyboardShortcutsOpen(true);
				},
				shortcut: "shortcuts_modal",
			},
			{
				label: "Toggle sidebar",
				icon: <PanelLeft />,
				run: toggleSidebarCollapsed,
				shortcut: "toggle_sidebar",
			},
			{
				label: "Settings",
				icon: <SlidersHorizontal />,
				run: () => {
					openSettings("general");
				},
				shortcut: "settings",
			},
			{label: "Mark all sessions seen", icon: <CircleCheckBig />, run: clearAll},
			...(currentSessionId !== undefined && currentDetail !== null
				? [
						{
							label: "Show side chat",
							icon: <MessagesSquare />,
							run: () => {
								openSideChat(currentSessionId);
							},
							shortcut: "toggle_side_chat",
						} satisfies PaletteAction,
					]
				: []),
		] satisfies PaletteAction[]
	).filter((action: PaletteAction) => action.shortcut === undefined || SHORTCUTS[action.shortcut].enabled);

	function select(callback: () => void) {
		onOpenChange(false);
		callback();
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (!compose && event.target === inputRef.current) startPaletteSearchJourney(event.nativeEvent);
		if (event.key === "Escape" && startStep === "picker") {
			event.preventDefault();
			event.stopPropagation();
			setStartStep("idle");
			setSelectedValue("");
			inputRef.current?.focus();
			return;
		}
		if (event.key === "Enter" && event.metaKey && canStart && startStep === "idle") {
			event.preventDefault();
			openStartPicker();
			return;
		}
		if (event.key === "Enter" && event.altKey) {
			openSelectedRowActions(event);
			return;
		}
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			stepTab(event);
			return;
		}
		if (event.key === "Backspace" || event.key === "Delete") {
			popTypeFilter(event);
			return;
		}
		// Upstream excludes Alt/Meta/Ctrl but not Shift, so Shift+Tab toggles too; a held Tab is
		// swallowed without toggling.
		if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		event.preventDefault();
		if (event.repeat) return;
		onModeChange(mode === "search" ? "compose" : "search");
	}

	// ← / → at the matching edge of the input (or with no query) step through the type tabs:
	// upstream's `yu` decides, and `bu` wraps unless the key is held.
	function stepTab(event: KeyboardEvent<HTMLDivElement>) {
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
			{text: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd},
			getComputedStyle(input).direction === "rtl",
		);
		if (direction === 0) return;
		event.preventDefault();
		const next = nextPaletteType(PaletteTypeSchema.options, tab, direction, !event.repeat);
		if (next !== undefined) chooseTab(next);
	}

	// Upstream's `A_` pops the last filter on Backspace/Delete in an empty query. Local filter tokens
	// live in the query text, so the type tab is the only thing left to pop.
	function popTypeFilter(event: KeyboardEvent<HTMLDivElement>) {
		const input = inputRef.current;
		if (compose || input === null || event.target !== input) return;
		if (query !== "" || event.repeat || isComposingKey(event) || tab === "all") return;
		event.preventDefault();
		chooseTab("all");
	}

	function isComposingKey(event: KeyboardEvent<HTMLDivElement>) {
		// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
		return event.nativeEvent.isComposing || event.keyCode === 229;
	}

	// ⌥⏎ opens the row-actions card for the selected session row.
	function openSelectedRowActions(event: KeyboardEvent<HTMLDivElement>) {
		const input = inputRef.current;
		if (event.metaKey || event.ctrlKey || event.shiftKey) return;
		if (input === null || event.target !== input) return;
		// Never fall through to cmdk's Enter, which would run a non-session row.
		event.preventDefault();
		const selected = cardRef.current?.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')?.dataset[
			"value"
		];
		if (selected?.startsWith("session:") !== true) return;
		const id = selected.slice("session:".length);
		if (!cardSessions.has(id)) return;
		openRowActions(id);
	}

	const compose = mode === "compose";
	const footerCollapsed = !compose && query.trim() !== "";
	const coarsePointer = useCoarsePointer();
	const [listRef, contentHeight] = useListContentHeight();
	const now = Date.now();
	const canSend = canStart && startStep === "idle";

	function openFilePicker() {
		fileInputRef.current?.click();
	}
	useShortcut("add_files", openFilePicker, {disabled: !compose || startStep !== "idle", allowInModal: true});
	const matchesCommands = searchable && !filtered && tokens.text !== "";
	const matchedSessionCommands =
		matchesCommands && currentDetail !== null
			? currentSessionCommands(currentDetail, pins.isPinned(currentSessionId ?? "")).filter((command) =>
					commandMatches(command.label, tokens.text, SESSION_COMMAND_KEYWORDS[command.id]),
				)
			: [];
	const matchedActions =
		actionsOnly && tokens.text === ""
			? actions
			: matchesCommands || actionsOnly
				? actions.filter((action) => commandMatches(action.label, tokens.text))
				: [];
	const matchedCommands = matchesCommands
		? NAV_COMMANDS.filter((command) => commandMatches(command.label, tokens.text, command.keywords))
		: [];
	const resultCount =
		(listing?.length ?? 0) +
		instant.length +
		matchedSessionCommands.length +
		matchedActions.length +
		matchedCommands.length +
		serverRows.length;
	const emptyKind = paletteEmptyKind({
		query: tokens.text,
		searching,
		rowCount: resultCount,
		filtered: type !== "all" || hasFilterTokens,
		failed: serverActive && serverSearch.isError,
	});
	const emptyMessage =
		emptyKind === "failed"
			? "Something went wrong"
			: paletteEmptyMessage(tokens.text, type === "all" ? null : paletteTypeLabels[type]);
	// Upstream's live region: the empty copy ("silent" speaks the bare No results found), else the ICU count.
	const liveMessage =
		emptyKind === "silent"
			? "No results found"
			: emptyKind === null
				? `${resultCount} ${resultCount === 1 ? "result" : "results"} available`
				: emptyMessage;
	const idle = startStep === "idle";
	const showEmptyState = idle && !compose && trimmedQuery === "" && tab === "all";
	const showResults = idle && !compose && hints === null && valueSuggestions === null && !showEmptyState;
	// Upstream sizes the scroller to its content, but holds it at the cap while the skeleton or empty block fills it.
	const listCapped = showEmptyState || (showResults && (searching || emptyKind !== null));
	const listCap = LIST_CAP_PX + (footerCollapsed && !coarsePointer ? COLLAPSED_FOOTER_PX : 0);
	const listHeight = listCapped ? listCap : contentHeight === null ? null : contentHeight + LIST_PADDING_Y_PX;
	const label = MODE_LABELS[mode];

	return (
		<Dialog.Popup
			ref={popupRef}
			data-command-palette=""
			data-perf-overlay="command_palette"
			initialFocus={inputRef}
			finalFocus={() => restoreFocusRef.current}
			// Upstream centres the card on a fixed 583.9px settled height, capped at 15vh (sm) or 25vh (lg),
			// so it never jumps while results load or filter.
			className={`fixed top-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 outline-none sm:top-[max(0px,min(15vh,max(2rem,calc((100vh-583.9px)/2))))] md:w-[calc(100vw-5rem)] lg:top-[max(0px,min(25vh,max(2rem,calc((100vh-583.9px)/2))))] ${PALETTE_RADIUS}`}
		>
			<Dialog.Title className="sr-only">Search</Dialog.Title>
			{entrypoint !== "search" && <ModeSwitch mode={mode} onModeChange={onModeChange} />}
			<div
				ref={cardRef}
				className={`relative overflow-hidden border-[0.5px] border-strong bg-surface-3 shadow-2xl transition-transform duration-150 ease-out motion-reduce:transition-none ${
					rowActions === null ? "" : "scale-[.97]"
				} ${footerCollapsed ? FOOTER_COLLAPSED_CARD_CLASS : ""} ${PALETTE_RADIUS}`}
			>
				<div
					aria-hidden="true"
					data-palette-recede-veil=""
					className={`pointer-events-none absolute inset-0 z-10 bg-backdrop transition-opacity duration-150 ease-out ${
						rowActions === null ? "opacity-0" : "opacity-20"
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
						<Command.Input asChild value={query} onValueChange={setQuery}>
							<textarea
								ref={inputRef}
								aria-activedescendant={undefined}
								aria-describedby={compose ? undefined : PALETTE_KEYS_HINT_ID}
								placeholder={label}
								disabled={startStep === "launching"}
								rows={compose ? 2 : 1}
								wrap={compose ? undefined : "off"}
								className={`relative max-h-24 min-w-[5rem] flex-1 resize-none border-none bg-transparent py-1.5 text-sm leading-5 text-primary outline-none placeholder:text-ink-muted ${
									compose ? "overflow-y-auto" : "overflow-x-auto overflow-y-hidden"
								}`}
							/>
						</Command.Input>
						{!compose && (
							<span id={PALETTE_KEYS_HINT_ID} hidden>
								Left and Right arrows change the type of result. Option+Enter opens actions for the
								highlighted result.
							</span>
						)}
						{!compose && (
							<span
								data-palette-spinner-slot=""
								className="flex size-4 shrink-0 items-center justify-center"
							>
								{searching && <Spinner size="md" delay={150} label="Searching deeper..." />}
							</span>
						)}
						{!compose && (
							<Tooltip content="Close" side="bottom" className="shrink-0">
								<Dialog.Close
									aria-label="Close"
									className={`${ICON_BUTTON_BASE_CLASS} size-8 rounded-r6 text-primary hover:bg-fill-ghost-hover`}
								>
									<X aria-hidden="true" className="h-5 w-5" />
								</Dialog.Close>
							</Tooltip>
						)}
						{compose && (
							<div className="relative flex w-full flex-col gap-1.5 pr-1.5">
								{composeChips.length > 0 && (
									<AttachedContextChips
										sessionId={COMPOSE_DRAFT_KEY}
										context={composeChips}
										comments={[]}
									/>
								)}
								<input
									ref={fileInputRef}
									type="file"
									multiple
									accept="image/*,text/*"
									aria-label="Add files or photos"
									tabIndex={-1}
									className="hidden"
									onChange={(event) => {
										attachUploadedFiles(
											COMPOSE_DRAFT_KEY,
											Array.from(event.target.files ?? []),
											toast,
										);
										event.target.value = "";
									}}
								/>
								<div className="flex items-center justify-between">
									<Tooltip content="Add files or photos" side="bottom">
										<button
											type="button"
											aria-label="Add files or photos"
											disabled={startStep !== "idle"}
											onClick={openFilePicker}
											className={`${ICON_BUTTON_CLASS} rounded-r7 text-primary hover:bg-fill-ghost-hover`}
										>
											<Paperclip aria-hidden="true" className="size-4" />
										</button>
									</Tooltip>
									<Tooltip content="Send" side="bottom">
										<button
											type="button"
											aria-label="Send"
											disabled={!canSend}
											onClick={openStartPicker}
											className={`${ICON_BUTTON_CLASS} rounded-r7 bg-accent-100 text-white hover:bg-accent-200`}
										>
											<ArrowUp aria-hidden="true" className="size-4" />
										</button>
									</Tooltip>
								</div>
							</div>
						)}
					</div>
					{!compose && <TypeTabs value={tab} onChange={chooseTab} />}
					<div className="h-[0.5px] w-full bg-border" />

					{/* Upstream animates the scroller between its measured content height and the cap.
					    While capped, cmdk's sizer is a full-height column so the skeleton or empty block fills it. */}
					<Command.List
						ref={listRef}
						className={[
							compose ? "max-h-[440px] overflow-y-auto p-2.5" : LIST_SCROLLER_CLASS,
							"[&_[cmdk-group]+[cmdk-group]]:mt-1 [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:flex-col",
							...(listCapped ? ["[&>[cmdk-list-sizer]]:min-h-full"] : []),
						].join(" ")}
						{...(compose
							? {}
							: {
									style: {
										...LIST_MAX_HEIGHT_STYLE,
										...(listHeight === null ? {} : {height: `${listHeight}px`}),
									},
								})}
					>
						{startStep === "launching" && (
							<Command.Group heading="Quick actions" className={GROUP_CLASS}>
								<CommandItem
									value={NEW_SESSION_VALUE}
									icon={<LoaderCircle className="animate-spin" />}
									onSelect={() => {}}
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
						{idle && canStart && (
							<Command.Group heading="Quick actions" className={GROUP_CLASS}>
								<NewSessionItem
									prompt={trimmedQuery}
									projectName={startProjectName}
									onSelect={openStartPicker}
								/>
							</Command.Group>
						)}
						{idle && !compose && hints !== null && (
							<div role="group" aria-label="Filters" className="flex flex-col">
								{hints.map((filter) => (
									<CommandItem
										key={filter}
										value={`filter:${filter}`}
										icon={<ListFilter />}
										onSelect={() => {
											chooseFilter(filter);
										}}
									>
										Filter by{" "}
										<span className="ml-1 rounded bg-fill-ghost-hover px-1.5 py-px text-xs text-secondary">
											{paletteFilterLabels[filter]}
										</span>
									</CommandItem>
								))}
							</div>
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
										onSelect={() => {
											chooseFilterValue(value.query);
										}}
									>
										{value.label}
									</CommandItem>
								))}
							</Command.Group>
						)}

						{showEmptyState && (
							<>
								{attention.length > 0 && (
									<Command.Group heading="Needs attention" className={GROUP_CLASS}>
										{attention.map((session) => (
											<SessionRowActions
												key={session.id}
												onOpen={() => {
													openRowActions(session.id);
												}}
											>
												<CommandItem
													icon={<AttentionIcon />}
													value={`session:${session.id}`}
													onSelect={() => {
														select(() => {
															openSession(session.id);
														});
													}}
													rowActions
												>
													{session.title}
													<span className="sr-only"> {ATTENTION_LABELS[session.bucket]}</span>
												</CommandItem>
											</SessionRowActions>
										))}
									</Command.Group>
								)}

								{recents.length > 0 && (
									<Command.Group heading="Recents" className={GROUP_CLASS}>
										{recents.map((recent) =>
											recent.kind === "session" ? (
												<SessionRowActions
													key={recent.id}
													onOpen={() => {
														openRowActions(recent.id);
													}}
												>
													<CommandItem
														icon={<MessageSquare />}
														value={`session:${recent.id}`}
														onSelect={() => {
															select(() => {
																openSession(recent.id);
															});
														}}
														rowActions
													>
														{recent.title}
													</CommandItem>
												</SessionRowActions>
											) : (
												<CommandItem
													key={recent.entry.key}
													icon={PAGE_ICONS[recent.entry.kind]}
													value={`recent:${recent.entry.key}`}
													onSelect={() => {
														select(() => void navigate({href: recent.entry.href}));
													}}
												>
													{recent.title}
												</CommandItem>
											),
										)}
									</Command.Group>
								)}

								{/* Upstream's empty state lists only New session; the other actions answer a typed query */}
								<Command.Group heading="Actions" className={GROUP_CLASS}>
									<ShortcutCommandItem
										value="action:New session"
										id="new_session"
										icon={<CirclePlus />}
										onSelect={() => {
											select(() => void navigate({to: "/"}).then(requestHomeComposerFocus));
										}}
									>
										New session
									</ShortcutCommandItem>
								</Command.Group>
							</>
						)}

						{showResults && (
							// cmdk's Group forces role=presentation, so upstream's headingless group is a plain div.
							<div
								role="group"
								aria-label="Search results"
								aria-busy={searching}
								className="flex flex-col"
							>
								{listing?.map((row) => (
									<SearchResultItem
										key={rowKey(row)}
										row={row}
										now={now}
										onSelect={() => {
											select(() => {
												openRow(row);
											});
										}}
										onRowActions={() => {
											openRowActions(row.id);
										}}
									/>
								))}
								{instant.map((row) => (
									<SearchResultItem
										key={rowKey(row)}
										row={row}
										now={now}
										onSelect={() => {
											select(() => {
												openRow(row);
											});
										}}
										onRowActions={() => {
											openRowActions(row.id);
										}}
									/>
								))}
								{matchedSessionCommands.map((command) => (
									<CommandItem
										key={command.id}
										value={`session-command:${command.id}`}
										icon={SESSION_COMMAND_ICONS[command.id]}
										onSelect={() => {
											select(() => {
												runSessionCommand(command.id);
											});
										}}
									>
										{command.label}
									</CommandItem>
								))}
								{matchedActions.map((action) =>
									action.shortcut === undefined ? (
										<CommandItem
											key={action.label}
											value={`action:${action.label}`}
											icon={action.icon}
											onSelect={() => {
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
											onSelect={() => {
												select(action.run);
											}}
										>
											{action.label}
										</ShortcutCommandItem>
									),
								)}
								{matchedCommands.map((command) => (
									<CommandItem
										key={command.to}
										value={`nav:${command.to}`}
										icon={command.icon}
										onSelect={() => {
											select(() => {
												void navigate({to: command.to});
											});
										}}
									>
										{command.label}
									</CommandItem>
								))}
								{serverRows.map((row) => (
									<SearchResultItem
										key={rowKey(row)}
										row={row}
										now={now}
										onSelect={() => {
											select(() => {
												openRow(row);
											});
										}}
										onRowActions={() => {
											openRowActions(row.id);
										}}
									/>
								))}
								{emptyKind !== null && (
									<PaletteEmptyState
										kind={emptyKind}
										message={emptyMessage}
										onSearchAll={searchAll}
										onCompose={() => {
											onModeChange("compose");
										}}
									/>
								)}
								{!searching && tokens.text !== "" && !actionsOnly && !isClientPaletteType(type) && (
									<CommandItem
										value="see-all-results"
										icon={<Search />}
										onSelect={() => {
											select(() => {
												seeAllResults(type);
											});
										}}
									>
										See all results for “{tokens.text}”
									</CommandItem>
								)}
							</div>
						)}
						{showResults && searching && <PaletteSkeleton />}
					</Command.List>
					{showResults && (
						<div aria-live="polite" aria-atomic="true" className="sr-only">
							{searching ? "" : liveMessage}
						</div>
					)}

					<FooterCollapse open={!footerCollapsed}>
						{compose ? (
							<PaletteFooter hints={[["Send", ["enter"]]]} />
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
									["Actions", ["alt+enter"]],
								]}
								{...(entrypoint === "search"
									? {
											trailing: (
												<ViewHint
													label="Compose"
													onSwitch={() => {
														onModeChange("compose");
													}}
												/>
											),
										}
									: {})}
							/>
						)}
					</FooterCollapse>
				</Command>
			</div>
			{rowActions !== null && (
				<PaletteRowActionsCard
					key={rowActions.session.id}
					session={rowActions.session}
					top={rowActions.top}
					onOpen={(id) => {
						select(() => {
							openSession(id);
						});
					}}
					onRename={(id) => {
						restoreFocusRef.current = false;
						select(() => {
							openSession(id);
							requestSessionRename(id);
						});
					}}
					onClose={closeRowActions}
				/>
			)}
		</Dialog.Popup>
	);
}

const ICON_BUTTON_BASE_CLASS =
	"relative flex aspect-square shrink-0 items-center justify-center transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";
const ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE_CLASS} h-7 w-7`;

/** Upstream's keyboard-hint footer: "Close Esc · Change type ←→ · Filters / · Actions ⌥⏎", or "Send ⏎" in Compose. */
/** Upstream's footer view hint for the sidebar Search entry: a ghost "Compose ⇥" that switches views like Tab. */
function ViewHint({label, onSwitch}: {label: string; onSwitch: () => void}) {
	return (
		<button
			type="button"
			aria-keyshortcuts="Tab"
			onMouseDown={(event) => {
				event.preventDefault();
			}}
			onClick={onSwitch}
			className="inline-flex h-5 cursor-pointer items-center rounded-r4 px-1.5 text-xs text-ink-muted hover:bg-fill-ghost-hover hover:text-secondary"
		>
			{label}
			<kbd aria-hidden="true" className="ms-1 font-sans">
				⇥
			</kbd>
		</button>
	);
}

/** Upstream sets this on the card while the footer is collapsed, so the list cap grows by the footer's 41px. */
const FOOTER_COLLAPSED_CARD_CLASS = "[--cp-footer-collapsed:1] pointer-coarse:[--cp-footer-collapsed:0]";
const LIST_MAX_HEIGHT_STYLE = {maxHeight: "calc(440px + var(--cp-footer-collapsed, 0) * 41px)"} as const;
const LIST_CAP_PX = 440;
const COLLAPSED_FOOTER_PX = 41;
/** The scroller's p-2.5, top and bottom, around the measured cmdk sizer. */
const LIST_PADDING_Y_PX = 20;
const LIST_SCROLLER_CLASS =
	"flex flex-col min-h-0 overflow-y-auto p-2.5 transition-[height,max-height] duration-150 ease-out motion-reduce:transition-none";

/** Observes cmdk's list sizer so the scroller can transition to its content height; null until measured. */
function useListContentHeight(): [(list: HTMLDivElement | null) => void, number | null] {
	const [height, setHeight] = useState<number | null>(null);
	const observerRef = useRef<ResizeObserver | null>(null);
	const ref = useCallback((list: HTMLDivElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		const sizer = list?.querySelector("[cmdk-list-sizer]");
		if (sizer == null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries.at(-1);
			if (entry !== undefined) setHeight(entry.contentRect.height);
		});
		observer.observe(sizer);
		observerRef.current = observer;
	}, []);
	return [ref, height];
}

/** Upstream collapses the footer with a grid-rows transition rather than unmounting it. */
function FooterCollapse({open, children}: {open: boolean; children: ReactNode}) {
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

function PaletteFooter({
	hints,
	trailing,
}: {
	/** Each hint's optional className replaces the default wrapper class, e.g. upstream's breakpoint hiding. */
	hints: ReadonlyArray<readonly [label: string, keys: readonly string[], className?: string]>;
	/** Right-aligned extra, like the Search entry's view hint. */
	trailing?: ReactNode;
}) {
	return (
		<div
			data-palette-footer=""
			className="border-t-[0.5px] border-border bg-surface-3 py-2.5 pr-4 pl-5 pointer-coarse:hidden"
		>
			<div className="flex min-h-5 items-center justify-between text-caption text-ink-muted">
				<div className="flex items-center gap-5">
					{hints.map(([label, keys, className]) => (
						<div key={label} className={className ?? "flex items-center gap-2"}>
							<span>{label}</span>
							<span className="flex items-center gap-[2px]">
								{keys.map((key) => (
									<Shortcut key={key} keys={key} />
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

/** Upstream's 28px type tablist under the input; cloud-only tabs are replaced by local types. */
function TypeTabs({value, onChange}: {value: PaletteType; onChange: (type: PaletteType) => void}) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		const tab = scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
		if (scroller && tab) {
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
				onMouseDown={(event) => {
					event.preventDefault();
				}}
				onWheel={(event) => {
					// Upstream's `en`: a vertical-only wheel scrolls the strip sideways, mirrored in RTL.
					if (event.deltaX === 0) {
						const scroller = event.currentTarget;
						const direction = getComputedStyle(scroller).direction === "rtl" ? -1 : 1;
						scroller.scrollLeft += event.deltaY * direction;
					}
				}}
			>
				<div
					role="tablist"
					aria-label="Type"
					className="flex min-w-max items-center [&>[role=tab]:first-child]:before:start-0 [&>[role=tab]:last-child]:before:end-0"
				>
					{PaletteTypeSchema.options.map((type) => {
						const selected = type === value;
						return (
							<button
								key={type}
								type="button"
								role="tab"
								aria-selected={selected}
								data-active={selected ? "" : undefined}
								tabIndex={selected ? 0 : -1}
								onMouseDown={(event) => {
									event.preventDefault();
								}}
								onClick={() => {
									onChange(type);
								}}
								// Comfortable-density geometry (28px, 0 10px, 14px/20px, 7px pill) to match the rest of the
								// palette; upstream's default density is 20px / 6px / 12px·17px / 5px (see density-default-tokens).
								className="relative isolate inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-sm font-medium whitespace-nowrap text-ink-muted outline-none select-none before:absolute before:inset-x-px before:inset-y-0 before:-z-[1] before:rounded-control-sm before:transition-shadow before:duration-[60ms] focus-visible:before:shadow-focus data-[active]:text-primary data-[active]:before:bg-fill-ghost-hover [&:not([data-active])]:hover:text-secondary [&:not([data-active])]:hover:before:bg-fill-ghost-hover"
							>
								{paletteTypeLabels[type]}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}

/** Upstream's floating [Search] [Compose] segmented control, 12px above the card; Tab still toggles. */
function ModeSwitch({mode, onModeChange}: {mode: PaletteMode; onModeChange: (mode: PaletteMode) => void}) {
	const options: Array<{value: PaletteMode; label: string}> = [
		{value: "search", label: "Search"},
		{value: "compose", label: "Compose"},
	];
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-full hidden justify-center pb-3 sm:flex">
			<div className="pointer-events-auto flex items-center rounded-[calc(var(--radius-r6)+1px)] border-[0.5px] border-strong bg-surface-3 p-px shadow-pop">
				<div
					role="radiogroup"
					aria-label="Search or compose"
					className="relative inline-flex h-8 w-fit shrink-0 items-stretch rounded-r6 bg-[var(--settings-segmented-track)] p-px font-sans"
				>
					{options.map((option) => {
						const checked = option.value === mode;
						return (
							// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- a roving radio: the radiogroup handles the arrow keys
							<span
								key={option.value}
								role="radio"
								aria-checked={checked}
								tabIndex={-1}
								data-checked={checked ? "" : undefined}
								onClick={() => {
									onModeChange(option.value);
								}}
								className="relative inline-flex h-full cursor-pointer items-center justify-center gap-1.5 rounded-r5 px-3 text-sm text-ink-muted select-none hover:text-primary data-[checked]:bg-[var(--settings-segmented-thumb)] data-[checked]:text-primary data-[checked]:shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_0_rgb(0_0_0/0.05)]"
							>
								{option.label}
							</span>
						);
					})}
				</div>
			</div>
		</div>
	);
}

/** Code session icon with upstream's masked notch and 6px accent pulse dot at the top-right. */
function AttentionIcon() {
	return (
		<span className="relative flex size-5 items-center justify-center">
			<CodeXml className="[mask-image:radial-gradient(circle_at_calc(100%-2px)_2px,transparent_5px,black_5.5px)]" />
			<span
				aria-hidden="true"
				data-palette-attention-dot=""
				className="absolute top-0 right-0 size-1.5 rounded-full bg-accent-100 motion-safe:animate-pulse"
			/>
		</span>
	);
}

/** A command row advertising its registry shortcut as keycaps and `aria-keyshortcuts`. */
function ShortcutCommandItem({id, ...props}: {id: ShortcutId} & Omit<Parameters<typeof CommandItem>[0], "shortcut">) {
	const shortcut = useShortcutKeys(id);
	return <CommandItem {...props} shortcut={shortcut} />;
}

const ROW_CLASS =
	"peer group flex w-full cursor-pointer items-center justify-between gap-3 truncate rounded-r6 px-3 py-2 text-sm leading-5 text-secondary select-none data-[selected=true]:bg-fill-ghost-hover data-[selected=true]:text-primary";

const ARCHIVED_ROW_CLASS = ROW_CLASS.replace("text-secondary", "text-ink-muted");

function ReturnGlyph() {
	return (
		<span className="hidden shrink-0 text-xs text-ink-muted group-data-[selected=true]:inline-flex pointer-coarse:!hidden">
			<CornerDownLeft aria-hidden="true" className="size-4" />
		</span>
	);
}

/** A session row with upstream's hover "…" that opens the → row-actions card. */
function SessionRowActions({children, onOpen}: {children: ReactNode; onOpen: () => void}) {
	return (
		<div className="group/palette-row relative">
			{children}
			<PaletteRowActionsButton onOpen={onOpen} />
		</div>
	);
}

const ROW_ACTIONS_LABEL_CLASS = "mr-7 pointer-coarse:mr-0";

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
}) {
	const session = row.kind === "session";
	const archived = row.archived === true;
	const item = (
		<Command.Item
			value={rowKey(row)}
			onSelect={onSelect}
			data-item-type={row.kind === "session" ? "code_session" : row.kind}
			{...(session ? {"aria-keyshortcuts": "Alt+Enter"} : {})}
			{...(archived ? {"data-archived": ""} : {})}
			className={archived ? ARCHIVED_ROW_CLASS : ROW_CLASS}
		>
			<span className={`flex min-w-0 flex-1 items-center gap-2 ${session ? ROW_ACTIONS_LABEL_CLASS : ""}`}>
				<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
					{row.awaiting ? <AttentionIcon /> : KIND_ICONS[row.kind]}
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
				{row.awaiting && <span className="sr-only"> Awaiting input</span>}
			</span>
			{archived && <ArchivedBadge variant="palette" />}
			<span
				data-palette-meta=""
				className="shrink-0 text-xs text-ink-muted group-data-[selected=true]:hidden pointer-coarse:!inline"
			>
				{row.meta ?? relativeBucket(Date.parse(row.mtime), now) ?? ""}
			</span>
			<ReturnGlyph />
		</Command.Item>
	);
	return session ? <SessionRowActions onOpen={onRowActions}>{item}</SessionRowActions> : item;
}

/** Upstream's Quick actions "New session" row: the typed prompt plus the project it will start in. */
function NewSessionItem({
	prompt,
	projectName,
	onSelect,
}: {
	prompt: string;
	projectName: string | undefined;
	onSelect: () => void;
}) {
	return (
		<Command.Item value={NEW_SESSION_VALUE} onSelect={onSelect} className={ROW_CLASS}>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
					<Code />
				</span>
				<span data-palette-label="" className="shrink-0">
					New session
				</span>
				<span data-palette-prompt="" className="min-w-0 truncate text-xs text-ink-muted">
					{prompt}
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
			<ReturnGlyph />
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
}: {
	children: ReactNode;
	value: string;
	icon?: ReactNode;
	onSelect: () => void;
	shortcut?: ShortcutKeys;
	rowActions?: boolean;
}) {
	const keyShortcuts = rowActions ? "Alt+Enter" : shortcut?.ariaKeyShortcuts;
	return (
		<Command.Item
			value={value}
			onSelect={onSelect}
			{...(keyShortcuts === undefined ? {} : {"aria-keyshortcuts": keyShortcuts})}
			className={ROW_CLASS}
		>
			<span className={`flex min-w-0 flex-1 items-center gap-2 ${rowActions ? ROW_ACTIONS_LABEL_CLASS : ""}`}>
				{icon !== undefined && (
					<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">{icon}</span>
				)}
				<span data-palette-label="" className="truncate">
					{children}
				</span>
			</span>
			{shortcut !== undefined && (
				<span
					aria-hidden="true"
					className="shrink-0 text-ink-muted group-data-[selected=true]:hidden pointer-coarse:hidden"
				>
					<Shortcut keys={shortcut.keys} />
				</span>
			)}
			<ReturnGlyph />
		</Command.Item>
	);
}
