import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {useEffect, useRef, useState} from "react";
import {
	AppWindow,
	Bot,
	Cpu,
	FileDiff,
	Gauge,
	GitBranch,
	GitPullRequest,
	Laptop,
	ListChecks,
	Plug,
	Server,
	SquareTerminal,
	Workflow,
	type LucideIcon,
} from "lucide-react";

import type {SessionArtifact} from "../../lib/api/artifacts";
import {customizeMcpServersQueryOptions, type McpServerSummary} from "../../lib/api/customize";
import type {HerdrPaneIndexData} from "../../lib/api/herdr";
import {sessionDiffQueryOptions} from "../../lib/api/session-diff";
import {
	openSessionInFinder,
	sessionDevServersQueryOptions,
	sessionOpenInQueryOptions,
	type SessionDetailData,
} from "../../lib/api/sessions";
import type {BackgroundTask, BackgroundTaskGroups} from "../../lib/background-tasks";
import {writeClipboardText} from "../../lib/clipboard";
import {toConnectorSlug} from "../../lib/customize/mcp-tool-permissions";
import {buildContextLegend, type ContextBreakdown} from "../../lib/context-breakdown";
import {formatContextSummary, formatUpdatedAgo, type ComposerUsage} from "../../lib/composer-state";
import type {PrStatus} from "../../lib/pr-status";
import {requestFileOpen} from "../../lib/file-open-requests";
import {formatCount} from "../../lib/pluralize";
import type {OutputFile} from "../../lib/session-outputs";
import {useEventStreamStatus} from "../../hooks/use-claude-events";
import {sessionEnvironment, terminalHostLabel} from "../../lib/session-environment";
import {streamDropHint} from "../../lib/stream-drop";
import {type BackgroundTasksFocus, useBackgroundTasksOpener} from "../background-tasks-opener-context";
import {useCopyToClipboard} from "../files/file-actions-menu";
import {FileTypeIcon} from "../file-type-icon";
import {usePaneHost} from "../panes/pane-host-context";
import {ContextBreakdownBody} from "./context-breakdown";
import {useToast} from "../toast-context";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {ENVIRONMENT_MENU_BUTTON_CLASS, RAIL_ROW_ACTION_CLASS, RailRow, RailRowContent} from "./rail-row";
import {RemoteControlRow, RemoteControlRowPending} from "./remote-control-row";
import {SessionRail, type RailCard} from "./session-rail";

/** What the session page knows that the rail's cards show. */
export interface SessionRailInputs {
	sessionId: string;
	homeRoot: string;
	cwd: string | null;
	gitBranch: string | null;
	/** The composer chin's model label. */
	model: string | null;
	herdrPane: HerdrPaneIndexData["panes"][number] | null;
	/** The session's CLI process is running: a bridged session's Remote Control is connected. */
	live: boolean;
	/** A turn is running: the Context card's usage refreshes when it ends. */
	working: boolean;
	usage: ComposerUsage | null;
	/** The newest `/context` run's per-category breakdown, null when none or stale. */
	breakdown: ContextBreakdown | null;
	artifacts: readonly SessionArtifact[];
	/** Files the transcript shows the session wrote or sent for the user. */
	outputFiles: readonly OutputFile[];
	backgroundTasks: BackgroundTaskGroups;
	pr: SessionDetailData["pr"] | null;
	prStatus: PrStatus | null;
}

/** Upstream lists four background tasks before its Show more row. */
const BACKGROUND_TASKS_SHOWN = 4;

function homeRelative(path: string, homeRoot: string): string {
	return path === homeRoot || path.startsWith(`${homeRoot}/`) ? `~${path.slice(homeRoot.length)}` : path;
}

function Rows({children}: {children: React.ReactNode}) {
	return (
		<div data-testid="rail-rows" className="flex flex-col">
			{children}
		</div>
	);
}

function Icon({icon: IconComponent}: {icon: LucideIcon}) {
	return <IconComponent aria-hidden />;
}

/** A branch's page in its GitHub repo, each path segment encoded so a `user/topic` branch keeps its slashes. */
function gitHubBranchUrl(repoUrl: string, branch: string): string {
	return `${repoUrl}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;
}

/** Upstream's folder and branch rows: a ghost menu button padded past the icon, which overlays it without taking clicks. */
function EnvironmentMenuRow({
	icon,
	label,
	hint,
	hintStatus,
	title,
	children,
}: {
	icon: LucideIcon;
	label: string;
	hint?: string;
	/** Set when the hint is the event stream's state rather than a detail of the row. */
	hintStatus?: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="relative flex min-w-0 flex-1">
			<Menu>
				<MenuTrigger title={title} className={ENVIRONMENT_MENU_BUTTON_CLASS}>
					<span data-rail-row-label="" className="min-w-0 flex-1 truncate text-primary">
						{label}
					</span>
					{hint !== undefined && (
						<span
							data-rail-row-hint=""
							data-stream-status={hintStatus}
							className="shrink-0 text-[12px]/[15px] text-ink-muted tabular-nums"
						>
							{hint}
						</span>
					)}
				</MenuTrigger>
				<MenuContent>{children}</MenuContent>
			</Menu>
			<span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-1">
				<span className="flex size-5 shrink-0 items-center justify-center text-secondary [&_svg]:size-4">
					<Icon icon={icon} />
				</span>
			</span>
		</div>
	);
}

/**
 * Upstream's Environment card: where the session runs. Locally, its folder
 * hinted with its terminal host (herdr, tmux or Local), its branch, the Remote
 * Control setting row while its CLI runs (on or off from its registry entry),
 * then its model and herdr pane.
 */
function EnvironmentBody({inputs}: {inputs: SessionRailInputs}) {
	const toast = useToast();
	const copy = useCopyToClipboard();
	const {cwd, gitBranch, model, herdrPane} = inputs;
	const openInQuery = useQuery(sessionOpenInQueryOptions(inputs.sessionId));
	const openIn = openInQuery.data;
	const openInPending = openInQuery.isPending;
	const remoteControl = openIn?.remoteControl ?? null;
	const githubUrl = openIn?.githubUrl ?? null;
	const environment = sessionEnvironment({
		terminalHost: herdrPane === null ? null : terminalHostLabel(herdrPane),
		remoteControl: remoteControl?.state ?? null,
	});
	const streamDrop = useEventStreamStatus();
	return (
		<Rows>
			{cwd !== null && (
				<EnvironmentMenuRow
					icon={Laptop}
					label={homeRelative(cwd, inputs.homeRoot)}
					{...(streamDrop === null
						? {hint: environment.label, title: cwd}
						: {
								hint: streamDropHint(streamDrop),
								hintStatus: streamDrop,
								// The stream's state takes the terminal host's place; the title keeps it.
								title: `${cwd} · ${environment.label}`,
							})}
				>
					<MenuItem
						onSelect={() => {
							openSessionInFinder(inputs.sessionId).catch(() => {
								toast({kind: "error", message: "Couldn’t open the folder in Finder."});
							});
						}}
					>
						Open in Finder
					</MenuItem>
					<MenuItem
						onSelect={() => {
							copy(cwd);
						}}
					>
						Copy path
					</MenuItem>
				</EnvironmentMenuRow>
			)}
			{gitBranch !== null && (
				<EnvironmentMenuRow icon={GitBranch} label={gitBranch} title={gitBranch}>
					<MenuItem
						onSelect={() => {
							void writeClipboardText(gitBranch).then((copied) => {
								toast(
									copied
										? {kind: "success", message: "Branch name copied to clipboard."}
										: {kind: "error", message: "Couldn’t copy the branch name. Try again."},
								);
							});
						}}
					>
						Copy branch name
					</MenuItem>
					{githubUrl !== null && (
						<MenuItem
							onSelect={() => {
								window.open(gitHubBranchUrl(githubUrl, gitBranch), "_blank", "noopener,noreferrer");
							}}
						>
							Open branch on GitHub
						</MenuItem>
					)}
				</EnvironmentMenuRow>
			)}
			{cwd !== null &&
				(openInPending && inputs.live ? (
					<RemoteControlRowPending />
				) : (
					remoteControl !== null && <RemoteControlRow state={remoteControl.state} url={remoteControl.url} />
				))}
			{model !== null && <RailRow icon={<Icon icon={Cpu} />} label={model} />}
			{herdrPane === null ? (
				<RailRow icon={<Icon icon={SquareTerminal} />} label="herdr" hint="No pane" />
			) : herdrPane.host === "tmux" ? (
				<RailRow icon={<Icon icon={SquareTerminal} />} label="tmux" hint={herdrPane.paneId} />
			) : (
				<Link
					to="/terminals/$sessionId"
					params={{sessionId: inputs.sessionId}}
					className={RAIL_ROW_ACTION_CLASS}
				>
					<RailRowContent icon={<Icon icon={SquareTerminal} />} label="herdr" hint={herdrPane.agentStatus} />
				</Link>
			)}
		</Rows>
	);
}

/** How the Context card's data refreshes: upstream's turn-driven wording, or a `/context`-run breakdown's local one. */
function refreshHint(working: boolean, source: ContextBreakdown["source"] | null): string {
	if (source === "context-command") return "Run /context to refresh.";
	return working ? "Refreshes when this turn ends." : "Send a message to refresh.";
}

function ContextUpdated({
	updatedAt,
	working,
	source = null,
}: {
	updatedAt: string;
	working: boolean;
	source?: ContextBreakdown["source"] | null;
}) {
	return (
		<div data-rail-context-updated="" className="mt-1 px-1 pb-1 text-[12px]/[15px] text-secondary">
			Last updated <time dateTime={updatedAt}>{formatUpdatedAgo(updatedAt, Date.now())}</time>.{" "}
			{refreshHint(working, source)}
		</div>
	);
}

/** Upstream's rail Context card: "N% used" over the token summary, a 4px meter, and when the usage was last updated. */
function contextCard(inputs: SessionRailInputs): RailCard {
	const {usage, working, breakdown} = inputs;
	if (breakdown !== null) {
		const liveTokens = usage?.contextTokens ?? null;
		return {
			id: "context",
			rollupPct: Math.min(100, Math.round(buildContextLegend(breakdown, liveTokens).usedPct)),
			body: (
				<div className="flex flex-col">
					<ContextBreakdownBody breakdown={breakdown} liveTokens={liveTokens} homeRoot={inputs.homeRoot} />
					<ContextUpdated updatedAt={breakdown.fetchedAt} working={working} source={breakdown.source} />
				</div>
			),
		};
	}
	if (usage?.contextTokens == null || usage.contextWindowSize === null) {
		return {
			id: "context",
			body: <p className="px-1 pb-1 text-[12px]/[15px] text-secondary">Send a message to see context usage.</p>,
		};
	}
	const percent = Math.min(
		100,
		Math.max(0, usage.contextPercent ?? (usage.contextTokens / usage.contextWindowSize) * 100),
	);
	const rounded = Math.round(percent);
	return {
		id: "context",
		rollupPct: rounded,
		body: (
			<div className="flex flex-col">
				<div className="flex flex-col gap-1 px-1 pt-1 pb-1.5">
					<div className="flex min-w-0 items-baseline justify-between gap-2 text-[13px]/[19px]">
						<span className="shrink-0 text-primary tabular-nums">{rounded}% used</span>
						<span
							data-rail-context-summary=""
							data-rail-context-pct={rounded}
							className="min-w-0 truncate text-[12px]/[15px] text-ink-muted tabular-nums"
						>
							{formatContextSummary(usage)}
						</span>
					</div>
					<div
						className="h-[4px] rounded-full overflow-hidden"
						style={{backgroundColor: "var(--chart-reference-tint)"}}
						role="progressbar"
						aria-label="Context window"
						aria-valuenow={rounded}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<div className="h-full bg-accent-100 transition-[width]" style={{width: `${percent}%`}} />
					</div>
				</div>
				{usage.updatedAt !== null && <ContextUpdated updatedAt={usage.updatedAt} working={working} />}
			</div>
		),
	};
}

/** The MCP servers the session's project can use: user-wide ones and its own. */
function sessionConnectors(servers: readonly McpServerSummary[], cwd: string | null): McpServerSummary[] {
	return servers.filter(
		(server) => server.enabled && (server.projectPath === undefined || server.projectPath === cwd),
	);
}

function connectorsCard(servers: readonly McpServerSummary[]): RailCard | null {
	if (servers.length === 0) return null;
	const reconnect = servers.filter((server) => server.needsAuth).length;
	return {
		id: "connectors",
		summary: reconnect > 0 ? `${reconnect} to reconnect` : `${servers.length} connected`,
		body: (
			<>
				<Rows>
					{servers.map((server) => (
						<Link
							key={server.id}
							to="/customize/connectors/id/$serverId"
							params={{serverId: toConnectorSlug(server.id)}}
							title={server.urlOrCommand}
							className={RAIL_ROW_ACTION_CLASS}
						>
							<RailRowContent
								icon={<Icon icon={Plug} />}
								label={server.name}
								{...(server.needsAuth ? {hint: "Reconnect"} : {})}
							/>
						</Link>
					))}
				</Rows>
				<Link
					to="/customize/connectors"
					className="flex min-h-6.5 items-center px-1 text-[12px]/[15px] text-ink-muted hover:text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				>
					Manage connectors
				</Link>
			</>
		),
	};
}

const SHOW_MORE_CLASS =
	"flex min-h-6.5 w-full min-w-0 cursor-pointer items-center rounded px-1 text-start text-[13px]/[19px] text-ink-muted hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

interface ShowMoreState {
	expanded: boolean;
	/** The first row the toggle reveals, which a keyboard press focuses. */
	firstNewRow: (element: HTMLElement | null) => void;
	toggle: (fromKeyboard: boolean) => void;
}

/** Upstream's in-place Show more: a keyboard expand focuses the first newly shown row. */
function useShowMore(): ShowMoreState {
	const [expanded, setExpanded] = useState(false);
	const firstNewRow = useRef<HTMLElement | null>(null);
	const focusFirstNew = useRef(false);
	useEffect(() => {
		if (!focusFirstNew.current) return;
		focusFirstNew.current = false;
		firstNewRow.current?.focus();
	}, [expanded]);
	return {
		expanded,
		firstNewRow: (element) => {
			firstNewRow.current = element;
		},
		toggle: (fromKeyboard) => {
			focusFirstNew.current = !expanded && fromKeyboard;
			setExpanded(!expanded);
		},
	};
}

function ShowMoreButton({state}: {state: ShowMoreState}) {
	return (
		<button
			type="button"
			aria-expanded={state.expanded}
			className={SHOW_MORE_CLASS}
			onClick={(event) => {
				// A keyboard press (detail 0) moves focus to the first row it reveals.
				state.toggle(event.detail === 0);
			}}
		>
			<span data-rail-row-label="" className="min-w-0 truncate">
				{state.expanded ? "Show less" : "Show more"}
			</span>
		</button>
	);
}

/** Upstream lists five outputs before its Show more row. */
const OUTPUTS_SHOWN = 5;

type Output = {kind: "artifact"; artifact: SessionArtifact; at: number} | {kind: "file"; file: OutputFile; at: number};

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function OutputsBody({outputs, sessionId}: {outputs: readonly Output[]; sessionId: string}) {
	const host = usePaneHost();
	const showMore = useShowMore();
	const shown = showMore.expanded ? outputs : outputs.slice(0, OUTPUTS_SHOWN);
	return (
		<Rows>
			{shown.map((output, index) => {
				const ref = index === OUTPUTS_SHOWN ? showMore.firstNewRow : undefined;
				if (output.kind === "artifact") {
					return (
						<Link
							key={`artifact:${output.artifact.id}`}
							ref={ref}
							to="/artifact/$id"
							params={{id: output.artifact.id}}
							className={RAIL_ROW_ACTION_CLASS}
						>
							<RailRowContent icon={<Icon icon={AppWindow} />} label={output.artifact.title} />
						</Link>
					);
				}
				const name = basename(output.file.path);
				return (
					<button
						key={`file:${output.file.path}`}
						ref={ref}
						type="button"
						title={output.file.path}
						aria-label={`Open ${name} in Files`}
						className={RAIL_ROW_ACTION_CLASS}
						onClick={() => {
							requestFileOpen(sessionId, {path: output.file.path});
							host.openPane("files");
						}}
					>
						<RailRowContent icon={<FileTypeIcon fileName={name} size="sm" />} label={name} />
					</button>
				);
			})}
			{outputs.length > OUTPUTS_SHOWN && <ShowMoreButton state={showMore} />}
		</Rows>
	);
}

/** Upstream's Outputs card; locally, the artifacts the session published or opened and the files it wrote or sent, newest first. */
function outputsCard(inputs: SessionRailInputs): RailCard | null {
	const outputs: Output[] = [
		...inputs.artifacts.map((artifact) => ({kind: "artifact" as const, artifact, at: artifact.lastEventAt})),
		...inputs.outputFiles.map((file) => ({kind: "file" as const, file, at: file.at})),
	].toSorted((left, right) => right.at - left.at);
	if (outputs.length === 0) return null;
	return {
		id: "outputs",
		summary: String(outputs.length),
		body: <OutputsBody outputs={outputs} sessionId={inputs.sessionId} />,
	};
}

interface DiffStats {
	files: number;
	additions: number;
	deletions: number;
}

/** Upstream's Changes card: the session's pull request, and locally its uncommitted working-copy diff. */
function ChangesBody({
	pr,
	prStatus,
	diff,
}: {
	pr: NonNullable<SessionDetailData["pr"]> | null;
	prStatus: PrStatus | null;
	diff: DiffStats | null;
}) {
	const host = usePaneHost();
	const prUrl = prStatus?.url ?? pr?.url;
	const prNumber = prStatus?.number ?? pr?.number;
	return (
		<Rows>
			{prUrl !== undefined && prNumber !== undefined && (
				<a href={prUrl} target="_blank" rel="noopener noreferrer" className={RAIL_ROW_ACTION_CLASS}>
					<RailRowContent
						icon={<Icon icon={GitPullRequest} />}
						label={prStatus?.title === undefined ? `#${prNumber}` : `#${prNumber} ${prStatus.title}`}
						hint={
							prStatus === null
								? "Open"
								: prStatus.state.charAt(0).toUpperCase() + prStatus.state.slice(1)
						}
					/>
				</a>
			)}
			{diff !== null && (
				<button
					type="button"
					className={RAIL_ROW_ACTION_CLASS}
					title={formatCount(diff.files, "file")}
					onClick={() => {
						host.openPane("changes");
					}}
				>
					<RailRowContent
						icon={<Icon icon={FileDiff} />}
						label="Uncommitted changes"
						hint={`+${diff.additions} −${diff.deletions}`}
					/>
				</button>
			)}
		</Rows>
	);
}

function changesCard(inputs: SessionRailInputs, diff: DiffStats | null): RailCard | null {
	const hasPr = inputs.pr !== null || inputs.prStatus !== null;
	const liveDiff = diff !== null && diff.files > 0 ? diff : null;
	if (!hasPr && liveDiff === null) return null;
	return {
		id: "pullRequests",
		...(hasPr ? {summary: formatCount(1, "pull request")} : {}),
		body: <ChangesBody pr={inputs.pr ?? null} prStatus={inputs.prStatus} diff={liveDiff} />,
	};
}

interface DevServer {
	url: string;
	name?: string | undefined;
	live: boolean;
}

function serversCard(servers: readonly DevServer[]): RailCard | null {
	if (servers.length === 0) return null;
	return {
		id: "servers",
		body: (
			<Rows>
				{servers.map((server) => {
					const hostLabel = server.url.replace(/^https?:\/\//, "");
					return (
						<a
							key={server.url}
							href={server.url}
							target="_blank"
							rel="noopener noreferrer"
							title={server.url}
							className={RAIL_ROW_ACTION_CLASS}
						>
							<RailRowContent
								icon={<Icon icon={Server} />}
								label={server.name === undefined ? hostLabel : `${server.name} · ${hostLabel}`}
								hint={server.live ? "Running" : "Not responding"}
							/>
						</a>
					);
				})}
			</Rows>
		),
	};
}

const TASK_ICONS: Record<BackgroundTask["kind"], LucideIcon> = {
	bash: SquareTerminal,
	agent: Bot,
	monitor: Gauge,
	workflow: Workflow,
	task: ListChecks,
};

/** Upstream's running-task clock: whole minutes, hours past the first. */
function formatTaskElapsed(ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const MINUTE_MS = 60_000;

/** The current time, re-read each minute while `ticking`. */
function useMinuteClock(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return undefined;
		setNow(Date.now());
		const timer = setInterval(() => {
			setNow(Date.now());
		}, MINUTE_MS);
		return () => {
			clearInterval(timer);
		};
	}, [ticking]);
	return now;
}

/**
 * Upstream's Background tasks card: four running tasks with their elapsed
 * time, an in-place Show more, then a finished count; each row opens the
 * Background tasks pane.
 */
function BackgroundTasksBody({tasks}: {tasks: BackgroundTaskGroups}) {
	const host = usePaneHost();
	const opener = useBackgroundTasksOpener();
	const showMore = useShowMore();
	const now = useMinuteClock(tasks.running.some((task) => task.startedAt !== null));
	// Upstream's rail rows call openTask: an agent opens its transcript, a task is focused, "N finished" expands Finished.
	const open = (focus: BackgroundTasksFocus) => {
		if (opener === null) host.openPane("background-tasks");
		else opener.open(focus);
	};
	const shown = showMore.expanded ? tasks.running : tasks.running.slice(0, BACKGROUND_TASKS_SHOWN);
	return (
		<Rows>
			{shown.map((task, index) => (
				<button
					key={task.id}
					ref={index === BACKGROUND_TASKS_SHOWN ? showMore.firstNewRow : undefined}
					type="button"
					title={task.command ?? task.description}
					aria-label={`Open ${task.description} in Background tasks`}
					className={RAIL_ROW_ACTION_CLASS}
					onClick={() => {
						open(task.kind === "agent" ? {agentId: task.id} : {taskId: task.id});
					}}
				>
					<RailRowContent
						icon={<Icon icon={TASK_ICONS[task.kind]} />}
						label={task.description}
						{...(task.startedAt === null
							? {}
							: {hint: formatTaskElapsed(now - Date.parse(task.startedAt))})}
					/>
				</button>
			))}
			{tasks.running.length > BACKGROUND_TASKS_SHOWN && <ShowMoreButton state={showMore} />}
			{tasks.finished.length > 0 && (
				<button
					type="button"
					className={RAIL_ROW_ACTION_CLASS}
					onClick={() => {
						open({finished: true});
					}}
				>
					<RailRowContent icon={<Icon icon={Bot} />} label={`${tasks.finished.length} finished`} />
				</button>
			)}
		</Rows>
	);
}

/** Upstream's card leaves once nothing runs, however many tasks finished. */
function backgroundTasksCard(tasks: BackgroundTaskGroups): RailCard | null {
	if (tasks.running.length === 0) return null;
	return {
		id: "backgroundTasks",
		summary: `${tasks.running.length} running`,
		body: <BackgroundTasksBody tasks={tasks} />,
	};
}

/**
 * The rail's lazy chunk: the cards the session has content for, in upstream's
 * default order. Connectors, Servers and the working-copy diff are fetched only
 * while the rail is docked. Upstream's Goal card has no local source.
 */
export function SessionRailCards({inputs}: {inputs: SessionRailInputs}) {
	const mcpServers = useQuery(customizeMcpServersQueryOptions).data;
	const devServers = useQuery(sessionDevServersQueryOptions(inputs.sessionId, inputs.cwd !== null)).data?.servers;
	const diff = useQuery({
		...sessionDiffQueryOptions(inputs.sessionId, "uncommitted"),
		enabled: inputs.cwd !== null,
	}).data?.stats;
	const cards = [
		{
			id: "environment",
			...(inputs.gitBranch === null ? {} : {summary: inputs.gitBranch}),
			body: <EnvironmentBody inputs={inputs} />,
		} satisfies RailCard,
		contextCard(inputs),
		connectorsCard(sessionConnectors(mcpServers ?? [], inputs.cwd)),
		outputsCard(inputs),
		changesCard(inputs, diff ?? null),
		serversCard(devServers ?? []),
		backgroundTasksCard(inputs.backgroundTasks),
	].filter((card) => card !== null);
	return <SessionRail sessionId={inputs.sessionId} cards={cards} />;
}
