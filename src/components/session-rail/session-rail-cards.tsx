import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
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
import type {ContextBreakdown} from "../../lib/context-breakdown";
import {formatContextSummary, formatUpdatedAgo, type ComposerUsage} from "../../lib/composer-state";
import type {PrStatus} from "../../lib/pr-status";
import {formatCount} from "../../lib/pluralize";
import {sessionEnvironment, terminalHostLabel} from "../../lib/session-environment";
import {claudeAiSessionUrl} from "../../lib/session-open-in";
import {usePaneHost} from "../panes/pane-host-context";
import {useToast} from "../toast-context";
import {RAIL_ROW_ACTION_CLASS, RailRow, RailRowContent} from "./rail-row";
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
 * Upstream's Environment card: where the session runs. Locally, its folder
 * hinted with its terminal host (herdr, tmux or Local), a Remote Control line
 * linking to claude.ai when bridged, then its branch, model and herdr pane.
 */
function EnvironmentBody({inputs}: {inputs: SessionRailInputs}) {
	const toast = useToast();
	const {cwd, gitBranch, model, herdrPane} = inputs;
	const bridgeSessionId = useQuery(sessionOpenInQueryOptions(inputs.sessionId)).data?.bridgeSessionId ?? null;
	const environment = sessionEnvironment({
		terminalHost: herdrPane === null ? null : terminalHostLabel(herdrPane),
		bridged: bridgeSessionId !== null,
		live: inputs.live,
	});
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
						hint={environment.label}
					/>
				</button>
			)}
			{cwd !== null && bridgeSessionId !== null && environment.remoteControl !== null && (
				<a
					href={claudeAiSessionUrl(bridgeSessionId)}
					target="_blank"
					rel="noopener noreferrer"
					title="Open in claude.ai"
					className={RAIL_ROW_ACTION_CLASS}
				>
					<span aria-hidden className="size-5 shrink-0" />
					<span data-rail-row-label="" className="min-w-0 flex-1 truncate text-[13px] text-secondary">
						{environment.remoteControl}
					</span>
				</a>
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

/** Upstream's rail Context card: "N% used" over the token summary, a 4px meter, and when the usage was last updated. */
function contextCard(usage: ComposerUsage | null, working: boolean): RailCard {
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
		summary: `${rounded}%`,
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
				{usage.updatedAt !== null && (
					<div data-rail-context-updated="" className="mt-1 px-1 pb-1 text-[12px]/[15px] text-secondary">
						Last updated{" "}
						<time dateTime={usage.updatedAt}>{formatUpdatedAgo(usage.updatedAt, Date.now())}</time>.{" "}
						{working ? "Refreshes when this turn ends." : "Send a message to refresh."}
					</div>
				)}
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
		contextCard(inputs.usage, inputs.working),
		connectorsCard(sessionConnectors(mcpServers ?? [], inputs.cwd)),
		outputsCard(inputs.artifacts),
		changesCard(inputs, diff ?? null),
		serversCard(devServers ?? []),
		backgroundTasksCard(inputs.backgroundTasks),
	].filter((card) => card !== null);
	return <SessionRail sessionId={inputs.sessionId} cards={cards} />;
}
