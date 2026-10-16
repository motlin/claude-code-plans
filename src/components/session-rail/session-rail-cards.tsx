import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {
	AppWindow,
	Bot,
	Circle,
	CircleCheck,
	CircleDot,
	Cpu,
	FileDiff,
	Gauge,
	GitBranch,
	GitPullRequest,
	Laptop,
	ListChecks,
	Plug,
	Server,
	ShieldCheck,
	SquareTerminal,
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
import {formatContextSummary, FIVE_HOUR_LABEL, WEEKLY_LABEL, type ComposerUsage} from "../../lib/composer-state";
import type {PrStatus} from "../../lib/pr-status";
import {formatCount} from "../../lib/pluralize";
import type {PlanTodo} from "../../lib/session-plan-model";
import {usePaneHost} from "../panes/pane-host-context";
import {useToast} from "../toast-context";
import {UsageLimitRow, UsageMeter} from "../usage-limit-row";
import {RAIL_ROW_ACTION_CLASS, RailRow, RailRowContent, SessionRail, type RailCard} from "./session-rail";

/** What the session page knows that the rail's cards show. */
export interface SessionRailInputs {
	sessionId: string;
	homeRoot: string;
	cwd: string | null;
	gitBranch: string | null;
	/** The composer chin's model label. */
	model: string | null;
	herdrPane: HerdrPaneIndexData["panes"][number] | null;
	/** The composer chin's permission mode and effort labels. */
	mode: string | null;
	effort: string | null;
	usage: ComposerUsage | null;
	/** The session's checklist, as the Plan pane shows it. */
	todos: readonly PlanTodo[];
	artifacts: readonly SessionArtifact[];
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

/**
 * Upstream's Environment card: where the session runs, hinting "Not connected"
 * without Remote Control. Locally, its folder, branch, model and herdr pane.
 */
function EnvironmentBody({inputs}: {inputs: SessionRailInputs}) {
	const toast = useToast();
	const {cwd, gitBranch, model, herdrPane} = inputs;
	const bridged = (useQuery(sessionOpenInQueryOptions(inputs.sessionId)).data?.bridgeSessionId ?? null) !== null;
	return (
		<Rows>
			{cwd !== null && (
				<button
					type="button"
					title={cwd}
					aria-label={`Open ${homeRelative(cwd, inputs.homeRoot)} in Finder`}
					className={RAIL_ROW_ACTION_CLASS}
					onClick={() => {
						openSessionInFinder(inputs.sessionId).catch(() => {
							toast({kind: "error", message: "Couldn’t open the folder in Finder."});
						});
					}}
				>
					<RailRowContent
						icon={<Icon icon={Laptop} />}
						label={homeRelative(cwd, inputs.homeRoot)}
						hint={bridged ? "Remote Control" : "Not connected"}
					/>
				</button>
			)}
			{gitBranch !== null && (
				<button
					type="button"
					title={`Copy ${gitBranch}`}
					className={RAIL_ROW_ACTION_CLASS}
					onClick={() => {
						void writeClipboardText(gitBranch).then((copied) => {
							toast(
								copied
									? {kind: "success", message: "Branch name copied to clipboard."}
									: {kind: "error", message: "Couldn’t copy the branch name. Try again."},
							);
						});
					}}
				>
					<RailRowContent icon={<Icon icon={GitBranch} />} label={gitBranch} />
				</button>
			)}
			{model !== null && <RailRow icon={<Icon icon={Cpu} />} label={model} />}
			{herdrPane === null ? (
				<RailRow icon={<Icon icon={SquareTerminal} />} label="herdr" hint="No pane" />
			) : herdrPane.host === "tmux" ? (
				<RailRow icon={<Icon icon={SquareTerminal} />} label="tmux" hint={herdrPane.paneId} />
			) : (
				<Link
					to="/herdr/terminal/$sessionId"
					params={{sessionId: inputs.sessionId}}
					className={RAIL_ROW_ACTION_CLASS}
				>
					<RailRowContent icon={<Icon icon={SquareTerminal} />} label="herdr" hint={herdrPane.agentStatus} />
				</Link>
			)}
		</Rows>
	);
}

function settingsCard(mode: string | null, effort: string | null): RailCard | null {
	if (mode === null && effort === null) return null;
	return {
		id: "settings",
		summary: [mode, effort].filter((value) => value !== null).join(" · "),
		body: (
			<Rows>
				{mode !== null && <RailRow icon={<Icon icon={ShieldCheck} />} label="Permission mode" hint={mode} />}
				{effort !== null && <RailRow icon={<Icon icon={Gauge} />} label="Effort" hint={effort} />}
			</Rows>
		),
	};
}

/** Upstream's Context card, with its placeholder until the session has usage. */
function contextCard(usage: ComposerUsage | null): RailCard {
	if (usage?.contextTokens == null || usage.contextWindowSize === null) {
		return {
			id: "context",
			body: <p className="px-1 pb-1 text-[12px]/[15px] text-secondary">Send a message to see context usage.</p>,
		};
	}
	const percent = usage.contextPercent ?? (usage.contextTokens / usage.contextWindowSize) * 100;
	return {
		id: "context",
		summary: `${Math.round(percent)}%`,
		body: (
			<div className="flex flex-col gap-1.5 px-1 pt-1 pb-1 text-[12px]/[15px]">
				<span className="tabular-nums text-secondary">{formatContextSummary(usage)}</span>
				<UsageMeter percent={percent} label="Context window" />
			</div>
		),
	};
}

/** Upstream's usage meters card: the plan limits the statusline reports. */
function usageCard(usage: ComposerUsage | null): RailCard | null {
	const limits = [
		usage?.fiveHour ? {label: FIVE_HOUR_LABEL, window: usage.fiveHour} : null,
		usage?.weekly ? {label: WEEKLY_LABEL, window: usage.weekly} : null,
	].filter((limit) => limit !== null);
	const highest = limits.reduce((max, limit) => Math.max(max, limit.window.usedPercentage), 0);
	if (limits.length === 0) return null;
	return {
		id: "usage",
		summary: `${Math.round(highest)}%`,
		body: (
			<div className="flex flex-col gap-2.5 px-1 pt-1 pb-1 text-[12px]/[15px]">
				{limits.map((limit) => (
					<UsageLimitRow key={limit.label} label={limit.label} window={limit.window} />
				))}
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
					className="flex min-h-6.5 items-center px-1 text-[12px]/[15px] text-ink-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
				>
					Manage connectors
				</Link>
			</>
		),
	};
}

const TODO_ICONS = {completed: CircleCheck, in_progress: CircleDot} as const;

function progressCard(todos: readonly PlanTodo[]): RailCard | null {
	if (todos.length === 0) return null;
	const done = todos.filter((todo) => todo.status === "completed").length;
	return {
		id: "progress",
		summary: `${done} of ${todos.length}`,
		body: (
			<Rows>
				{todos.map((todo, index) => (
					<RailRow
						// Todos carry no id; the checklist is replaced wholesale on each TodoWrite.
						// oxlint-disable-next-line react/no-array-index-key
						key={index}
						icon={
							<Icon
								icon={
									todo.status === "completed" || todo.status === "in_progress"
										? TODO_ICONS[todo.status]
										: Circle
								}
							/>
						}
						label={todo.status === "in_progress" ? (todo.activeForm ?? todo.content) : todo.content}
					/>
				))}
			</Rows>
		),
	};
}

/** Upstream's Outputs card; locally, the artifacts the session published or opened. */
function outputsCard(artifacts: readonly SessionArtifact[]): RailCard | null {
	if (artifacts.length === 0) return null;
	return {
		id: "outputs",
		body: (
			<Rows>
				{artifacts.map((artifact) => (
					<Link
						key={artifact.id}
						to="/artifact/$id"
						params={{id: artifact.id}}
						className={RAIL_ROW_ACTION_CLASS}
					>
						<RailRowContent icon={<Icon icon={AppWindow} />} label={artifact.title} />
					</Link>
				))}
			</Rows>
		),
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
	task: ListChecks,
};

/** Upstream's Background tasks card: running tasks, then a finished count; each row opens the Background tasks pane. */
function BackgroundTasksBody({tasks}: {tasks: BackgroundTaskGroups}) {
	const host = usePaneHost();
	const open = () => {
		host.openPane("background-tasks");
	};
	const shown = tasks.running.slice(0, BACKGROUND_TASKS_SHOWN);
	const more = tasks.running.length - shown.length;
	return (
		<Rows>
			{shown.map((task) => (
				<button
					key={task.id}
					type="button"
					title={task.command ?? task.description}
					className={RAIL_ROW_ACTION_CLASS}
					onClick={open}
				>
					<RailRowContent icon={<Icon icon={TASK_ICONS[task.kind]} />} label={task.description} />
				</button>
			))}
			{more > 0 && (
				<button type="button" className={RAIL_ROW_ACTION_CLASS} onClick={open}>
					<RailRowContent icon={null} label="Show more" />
				</button>
			)}
			{tasks.finished.length > 0 && (
				<button type="button" className={RAIL_ROW_ACTION_CLASS} onClick={open}>
					<RailRowContent icon={null} label={`${tasks.finished.length} finished`} />
				</button>
			)}
		</Rows>
	);
}

function backgroundTasksCard(tasks: BackgroundTaskGroups): RailCard | null {
	if (tasks.running.length === 0 && tasks.finished.length === 0) return null;
	return {
		id: "backgroundTasks",
		...(tasks.running.length > 0 ? {summary: `${tasks.running.length} running`} : {}),
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
		{id: "environment", body: <EnvironmentBody inputs={inputs} />} satisfies RailCard,
		settingsCard(inputs.mode, inputs.effort),
		contextCard(inputs.usage),
		usageCard(inputs.usage),
		connectorsCard(sessionConnectors(mcpServers ?? [], inputs.cwd)),
		progressCard(inputs.todos),
		outputsCard(inputs.artifacts),
		changesCard(inputs, diff ?? null),
		serversCard(devServers ?? []),
		backgroundTasksCard(inputs.backgroundTasks),
	].filter((card) => card !== null);
	return <SessionRail sessionId={inputs.sessionId} cards={cards} />;
}
