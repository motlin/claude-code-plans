import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import
{
	AppWindow,
	Bot,
	Cpu,
	Gauge,
	GitBranch,
	Laptop,
	ListChecks,
	Plug,
	Server,
	SquareTerminal,
	Workflow,
	type LucideIcon,
} from "lucide-react";

import type {SessionArtifact} from "../../lib/api/artifacts";
import {customizeMcpServersQueryOptions, type McpServerSummary, sessionConnectors} from "../../lib/api/customize";
import type {HerdrPaneIndexData} from "../../lib/api/herdr";
import {sessionDiffQueryOptions} from "../../lib/api/session-diff";
import
{
	openSessionInFinder,
	sessionDevServersQueryOptions,
	sessionMcpStatusQueryOptions,
	sessionOpenInQueryOptions,
	type SessionDetailData,
} from "../../lib/api/sessions";
import type {BackgroundTask, BackgroundTaskGroups} from "../../lib/background-tasks";
import {writeClipboardText} from "../../lib/clipboard";
import {toConnectorSlug} from "../../lib/customize/mcp-tool-permissions";
import {autoCompactHint, type CompactActionState} from "../../lib/compact-action";
import {buildContextLegend, contextRefreshHint, type ContextBreakdown} from "../../lib/context-breakdown";
import {formatContextSummary, formatTokenCount, formatUpdatedAgo, type ComposerUsage} from "../../lib/composer-state";
import type {PrStatus} from "../../lib/pr-status";
import {resolveStaleEngine} from "../../lib/stale-engine";
import {requestFileOpen} from "../../lib/file-open-requests";
import {formatCount} from "../../lib/pluralize";
import {useRailNoConnectors} from "../../lib/rail-no-connectors";
import {useHoldNonzero} from "../../lib/use-hold-nonzero";
import
{
	type ConnectorRow,
	type ConnectorState,
	connectorCounts,
	connectorRows,
	connectorsSummary,
} from "../../lib/session-rail-connectors";
import type {OutputFile} from "../../lib/session-outputs";
import {goalTurnsSummary, type SessionGoal} from "../../lib/session-goal";
import {type BackgroundTaskStop, useStoppingTaskIds} from "../../hooks/use-background-task-stop";
import {useEventStreamStatus} from "../../hooks/use-claude-events";
import {sessionEnvironment, terminalHostLabel} from "../../lib/session-environment";
import {streamDropHint} from "../../lib/stream-drop";
import {type BackgroundTasksFocus, useBackgroundTasksOpener} from "../background-tasks-opener-context";
import {BackgroundTaskStopButton, STOPPING_LABEL} from "../background-task-stop-button";
import {useCopyToClipboard} from "../files/use-copy-to-clipboard";
import {ConnectorLetterTile} from "../connector-letter-tile";
import {FileTypeIcon} from "../file-type-icon";
import {usePaneHost} from "../panes/pane-host-context";
import {CompactActionRow} from "./compact-action-row";
import
{
	CONTEXT_HEADLINE_BLOCK_CLASS,
	ContextBreakdownBody,
	ContextHeadline,
	STALE_ENGINE_LIMITED_LABEL,
	StaleEngineNotice,
} from "./context-breakdown";
import {useToast} from "../toast-context";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {Skeleton} from "../ui/skeleton";
import {useMenuOpensOnContextMenu} from "../ui/use-menu-opens-on-context-menu";
import {RailChangesPrRow, RailChangesRow} from "./rail-changes-row";
import
{
	ENVIRONMENT_MENU_BUTTON_CLASS,
	RAIL_ROW_ACTION_CLASS,
	RailGlyph,
	RailRow,
	RailPreviewRows,
	RailRowContent,
	ShowMoreButton,
} from "./rail-row";
import {useShowMore} from "./use-show-more";
import {RemoteControlRow, RemoteControlRowPending, RemoteControlToggleRow} from "./remote-control-row";
import {GoalBody} from "./goal-card";
import {SessionRail, type RailCard} from "./session-rail";
import {CONTEXT_BAR_TRACK_CLASS, usageFillClass} from "./usage-fill";

/** What the session page knows that the rail's cards show. */
export interface SessionRailInputs
{
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
	/** The session has a live terminal pane and Live terminal input is on, so the Remote Control switch can type `/remote-control`. */
	canToggleRemoteControl?: boolean;
	usage: ComposerUsage | null;
	/** The newest `/context` run's per-category breakdown, null when none or stale. */
	breakdown: ContextBreakdown | null;
	/** The CLI version running the session, for the stale-engine notice; null or absent when unknown. */
	engineVersion?: string | null | undefined;
	/** Opens the Memory dialog; null when this session page can't show it (upstream's panel-store `openMemoryDialog`). */
	openMemoryDialog?: (() => void) | null;
	/** The Context card's Compact session row: its availability and the `/compact` send. */
	compact?:
		|
		  {
				state: CompactActionState;
				onCompact: () => void;
		  }
		| undefined;
	artifacts: readonly SessionArtifact[];
	/** Files the transcript shows the session wrote or sent for the user. */
	outputFiles: readonly OutputFile[];
	backgroundTasks: BackgroundTaskGroups;
	/** Per-row Stop through the session's live CLI; null or absent (no Stop) when it can't take writes. */
	taskStop?: BackgroundTaskStop | null;
	pr: SessionDetailData["pr"] | null;
	prStatus: PrStatus | null;
	/** The session's active `/goal`, folded from its transcript's `goal_status` rows; null when none. */
	goal: SessionGoal | null;
}

/** Upstream lists four background tasks before its Show more row. */
const BACKGROUND_TASKS_SHOWN = 4;

function homeRelative(path: string, homeRoot: string): string
{
	return path === homeRoot || path.startsWith(`${homeRoot}/`) ? `~${path.slice(homeRoot.length)}` : path;
}

function Rows({children}: {children: React.ReactNode})
{
	return (
		<div data-testid="rail-rows" className="flex flex-col">
			{children}
		</div>
	);
}

function Icon({icon: IconComponent}: {icon: LucideIcon})
{
	return <IconComponent aria-hidden />;
}

/** A branch's page in its GitHub repo, each path segment encoded so a `user/topic` branch keeps its slashes. */
function gitHubBranchUrl(repoUrl: string, branch: string): string
{
	return `${repoUrl}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;
}

/** Upstream's folder and branch rows: a ghost menu button padded past the icon, which overlays it without taking clicks. */
function EnvironmentMenuRow({
	glyph,
	icon,
	label,
	hint,
	hintStatus,
	title,
	children,
}: {
	glyph: string;
	icon: LucideIcon;
	label: string;
	hint?: string;
	/** Set when the hint is the event stream's state rather than a detail of the row. */
	hintStatus?: string;
	title: string;
	children: React.ReactNode;
})
{
	// Upstream's rail repository and branch rows open their own dropdown on right-click, anchored to the row.
	const {rootProps, onContextMenu} = useMenuOpensOnContextMenu();
	return (
		<div className="relative flex min-w-0 flex-1">
			<Menu {...rootProps}>
				<MenuTrigger title={title} className={ENVIRONMENT_MENU_BUTTON_CLASS} onContextMenu={onContextMenu}>
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
				{/* Upstream's row dropdown: end-aligned 6px below the row, never narrower than it. */}
				<MenuContent align="end" sideOffset={6} className="!min-w-[var(--anchor-width)]">
					{children}
				</MenuContent>
			</Menu>
			<span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2">
				<RailGlyph glyph={glyph}>
					<Icon icon={icon} />
				</RailGlyph>
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
function EnvironmentBody({inputs}: {inputs: SessionRailInputs})
{
	const toast = useToast();
	const copy = useCopyToClipboard();
	const {cwd, gitBranch, model, herdrPane} = inputs;
	const openInQuery = useQuery(sessionOpenInQueryOptions(inputs.sessionId));
	const openIn = openInQuery.data;
	const openInPending = openInQuery.isPending;
	const remoteControl = openIn?.remoteControl ?? null;
	const githubUrl = openIn?.githubUrl ?? null;
	const environment = sessionEnvironment(
		{
			terminalHost: herdrPane === null ? null : terminalHostLabel(herdrPane),
			remoteControl: remoteControl?.state ?? null,
		},
	);
	const streamDrop = useEventStreamStatus();
	return (
		<Rows>
			{cwd !== null && (
				<EnvironmentMenuRow
					// Upstream's folder picker reads "BookClosed" only for a cloud repository; a local folder is "Folder".
					glyph="Folder"
					icon={Laptop}
					label={homeRelative(cwd, inputs.homeRoot)}
					{...(streamDrop === null
						?
							{
								hint: environment.label,
								title: cwd,
							}
						:
							{
								hint: streamDropHint(streamDrop),
								hintStatus: streamDrop,
								// The stream's state takes the terminal host's place; the title keeps it.
								title: `${cwd} · ${environment.label}`,
							})}
				>
					<MenuItem
						onSelect={() =>
						{
							openSessionInFinder(inputs.sessionId).catch(() =>
							{
								toast(
									{
										kind: "error",
										message: "Couldn’t open the folder in Finder.",
									},
								);
							});
						}}
					>
						Open in Finder
					</MenuItem>
					<MenuItem
						onSelect={() =>
						{
							copy(cwd);
						}}
					>
						Copy path
					</MenuItem>
				</EnvironmentMenuRow>
			)}
			{cwd === null && streamDrop !== null && (
				// Upstream's Environment row always exists; without a folder the stream's state rides a plain row.
				<RailRow
					glyph="Computer"
					icon={<Icon icon={Laptop} />}
					label={environment.label}
					hint={streamDropHint(streamDrop)}
					hintStatus={streamDrop}
				/>
			)}
			{gitBranch !== null && (
				<EnvironmentMenuRow glyph="GitBranch" icon={GitBranch} label={gitBranch} title={gitBranch}>
					<MenuItem
						onSelect={() =>
						{
							void writeClipboardText(gitBranch).then((copied) =>
							{
								toast(
									copied
										?
											{
												kind: "success",
												message: "Branch name copied to clipboard.",
											}
										:
											{
												kind: "error",
												message: "Couldn’t copy the branch name. Try again.",
											},
								);
							});
						}}
					>
						Copy branch name
					</MenuItem>
					{githubUrl !== null && (
						<MenuItem
							onSelect={() =>
							{
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
					remoteControl !== null &&
					(inputs.canToggleRemoteControl === true ? (
						<RemoteControlToggleRow
							sessionId={inputs.sessionId}
							state={remoteControl.state}
							url={remoteControl.url}
							working={inputs.working}
							historySuppressed={openIn?.remoteHistory ?? null}
						/>
					) : (
						<RemoteControlRow
							state={remoteControl.state}
							url={remoteControl.url}
							historySuppressed={openIn?.remoteHistory ?? null}
						/>
					))
				))}
			{model !== null && <RailRow glyph="Cpu" icon={<Icon icon={Cpu} />} label={model} />}
			{herdrPane === null ? (
				<RailRow glyph="CommandLine" icon={<Icon icon={SquareTerminal} />} label="herdr" hint="No pane" />
			) : herdrPane.host === "tmux" ? (
				<RailRow
					glyph="CommandLine"
					icon={<Icon icon={SquareTerminal} />}
					label="tmux"
					hint={herdrPane.paneId}
				/>
			) : herdrPane.host === "headless" ? (
				<RailRow
					glyph="CommandLine"
					icon={<Icon icon={SquareTerminal} />}
					label="Headless"
					hint={herdrPane.agentStatus}
				/>
			) : (
				<Link
					to="/terminals/$sessionId"
					params={
					{
						sessionId: inputs.sessionId,
					}}
					className={RAIL_ROW_ACTION_CLASS}
				>
					<RailRowContent
						glyph="CommandLine"
						icon={<Icon icon={SquareTerminal} />}
						label="herdr"
						hint={herdrPane.agentStatus}
					/>
				</Link>
			)}
		</Rows>
	);
}

function ContextUpdated({
	updatedAt,
	working,
	source = null,
}: {
	updatedAt: string;
	working: boolean;
	source?: ContextBreakdown["source"] | null;
})
{
	return (
		<div data-rail-context-updated="" className="mt-1 px-2 pb-1 text-[12px]/[15px] text-secondary">
			Last updated <time dateTime={updatedAt}>{formatUpdatedAgo(updatedAt, Date.now())}</time>.{" "}
			{contextRefreshHint(working, source)}
		</div>
	);
}

/** The compact row for the card, or null when its state hides it. */
function compactRow(inputs: SessionRailInputs, threshold: number | null): React.ReactNode
{
	const {compact} = inputs;
	if (compact === undefined || compact.state.kind === "hidden") return null;
	return (
		<CompactActionRow
			inset="px-xs"
			state={compact.state}
			hint={autoCompactHint(threshold, inputs.usage?.contextTokens ?? null)}
			onCompact={compact.onCompact}
		/>
	);
}

/** Upstream's rail Context card: "N% used" over the token summary, a 4px meter, and when the usage was last updated. */
function contextCard(inputs: SessionRailInputs, connectors: readonly McpServerSummary[]): RailCard
{
	const {usage, working} = inputs;
	if (inputs.breakdown !== null)
	{
		const {staleEngine, breakdown} = resolveStaleEngine(inputs.breakdown, inputs.engineVersion ?? null);
		const liveTokens = usage?.contextTokens ?? null;
		const {usedTokens, usedPct} = buildContextLegend(breakdown, liveTokens);
		return {
			id: "context",
			// Upstream's `zC`: the notice row turns the rollup into the warning-coloured token summary.
			...(staleEngine?.enforced === true
				?
					{
						summary: `${formatTokenCount(usedTokens)} / ${formatTokenCount(breakdown.rawMaxTokens)}`,
						rollupWarning: STALE_ENGINE_LIMITED_LABEL,
					}
				:
					{
						rollupPct: Math.min(100, Math.round(usedPct)),
					}),
			body: (
				<div className="flex flex-col">
					<ContextBreakdownBody
						breakdown={breakdown}
						liveTokens={liveTokens}
						homeRoot={inputs.homeRoot}
						mcpServers={connectors}
						openMemory={inputs.openMemoryDialog ?? null}
					/>
					{compactRow(inputs, breakdown.autoCompactThreshold)}
					{staleEngine !== null && <StaleEngineNotice staleEngine={staleEngine} inset="px-xs" />}
					<ContextUpdated updatedAt={breakdown.fetchedAt} working={working} source={breakdown.source} />
				</div>
			),
		};
	}
	if (usage?.contextTokens == null || usage.contextWindowSize === null)
	{
		return {
			id: "context",
			body: <p className="px-2 pb-1 text-[12px]/[15px] text-secondary">Send a message to see context usage.</p>,
		};
	}
	const percent = Math.min(
		100,
		Math.max(0, usage.contextPercent ?? (usage.contextTokens / usage.contextWindowSize) * 100),
	);
	// Upstream's `ru` drops the percent when tokens overrun a window that is only an estimate.
	if (usage.estimatedWindow === true && usage.contextTokens > usage.contextWindowSize)
	{
		const summary = formatTokenCount(usage.contextTokens);
		return {
			id: "context",
			summary,
			body: windowOnlyBody(
				inputs,
				<ContextHeadline pct={null} summary={summary} />,
				<div
					className={CONTEXT_BAR_TRACK_CLASS}
					style={
					{
						backgroundColor: "var(--chart-reference-tint)",
					}}
					role="progressbar"
					aria-label="Context window"
					aria-valuetext={summary}
					aria-valuemin={0}
					aria-valuemax={100}
				/>,
			),
		};
	}
	const rounded = Math.round(percent);
	return {
		id: "context",
		rollupPct: rounded,
		body: windowOnlyBody(
			inputs,
			<ContextHeadline pct={rounded} summary={formatContextSummary(usage)} />,
			<div
				className={CONTEXT_BAR_TRACK_CLASS}
				style={
				{
					backgroundColor: "var(--chart-reference-tint)",
				}}
				role="progressbar"
				aria-label="Context window"
				aria-valuenow={rounded}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<div
					// Upstream tones and sizes the fill by the rounded `ru` percent.
					className={`h-full ${usageFillClass(rounded)} transition-[width]`}
					style={
					{
						width: `${rounded}%`,
					}}
				/>
			</div>,
		),
	};
}

/** Upstream's window-only Context body: the headline over a 4px bar, the compact row, and the breakdown hint. */
function windowOnlyBody(inputs: SessionRailInputs, headline: React.ReactNode, bar: React.ReactNode): React.ReactNode
{
	return (
		<div className="flex flex-col">
			<div className={CONTEXT_HEADLINE_BLOCK_CLASS}>
				{headline}
				{bar}
			</div>
			{compactRow(inputs, null)}
			{/* Upstream's window-only state: no Last updated footer, which needs a breakdown. */}
			{!inputs.working && (
				<div
					data-rail-context-hint=""
					className="mt-1 flex min-h-6 items-center px-2 pb-1 text-[12px]/[15px] text-secondary"
				>
					Send a message to see the breakdown.
				</div>
			)}
		</div>
	);
}

/** Upstream's `sN`: three connectors before its Show more row. */
const CONNECTORS_SHOWN = 3;

/** Upstream's trailing state span per connector state; a healthy row has none. */
const CONNECTOR_STATE_HINT =
{
	failed:
	{
		hint: "Reconnect",
		hintTone: "warning",
	},
	"needs-auth":
	{
		hint: "Authenticate",
		hintTone: "warning",
	},
	unavailable:
	{
		hint: "Unavailable",
		hintTone: "muted",
	},
	off:
	{
		hint: "Off",
		hintTone: "muted",
	},
} as const satisfies Record<
	ConnectorState,
	{
		hint: string;
		hintTone: "muted" | "warning";
	}
>;

function ConnectorsBody({rows}: {rows: readonly ConnectorRow[]})
{
	const showMore = useShowMore();
	const shown = showMore.expanded ? rows : rows.slice(0, CONNECTORS_SHOWN);
	return (
		<div data-testid="rail-rows" tabIndex={-1} className="flex flex-col outline-none">
			<RailPreviewRows>
				{shown.map((row, index) => (
					<Link
						key={row.id}
						ref={index === CONNECTORS_SHOWN ? showMore.firstNewRow : undefined}
						to="/customize/connectors/id/$serverId"
						params={
						{
							serverId: toConnectorSlug(row.id),
						}}
						className={RAIL_ROW_ACTION_CLASS}
					>
						<RailRowContent
							// Upstream `EI`: a connector's favicon or letter tile is a "logo".
							glyph="logo"
							icon={<ConnectorLetterTile name={row.name} />}
							label={row.label}
							{...(row.state === undefined ? {} : CONNECTOR_STATE_HINT[row.state])}
						/>
					</Link>
				))}
			</RailPreviewRows>
			{rows.length > CONNECTORS_SHOWN && <ShowMoreButton state={showMore} />}
		</div>
	);
}

/**
 * Upstream's Connectors card (`uN`): mounted while any server is listed, even when every one is off. While the list
 * loads (`rows === null`) it shows at once with no summary and one "Manage connectors" row over an 84×12 skeleton,
 * unless the session (or the last one) is remembered to have none.
 */
function connectorsCard(rows: readonly ConnectorRow[] | null, rememberedNone: boolean): RailCard | null
{
	if (rows === null)
	{
		if (rememberedNone) return null;
		return {
			id: "connectors",
			body: (
				<div data-testid="rail-rows" tabIndex={-1} className="flex flex-col outline-none">
					<Link to="/customize/connectors" aria-label="Manage connectors" className={RAIL_ROW_ACTION_CLASS}>
						<RailGlyph glyph="Connectors">
							<Icon icon={Plug} />
						</RailGlyph>
						<span className="min-w-0 flex-1 truncate text-start text-primary">
							{/* Upstream `ON`: a decorative Text span around a standalone 84×12 Skeleton. */}
							<span className="flex min-w-0 items-center">
								<Skeleton as="span" silent className="h-3 w-[84px] rounded" />
							</span>
						</span>
					</Link>
				</div>
			),
		};
	}
	const counts = connectorCounts(rows);
	if (counts.count === 0) return null;
	return {
		id: "connectors",
		summary: connectorsSummary(counts),
		body: <ConnectorsBody rows={rows} />,
	};
}

/** Upstream lists five outputs before its Show more row. */
const OUTPUTS_SHOWN = 5;

type Output =
	|
	  {
			kind: "artifact";
			artifact: SessionArtifact;
			at: number;
	  }
	|
	  {
			kind: "file";
			file: OutputFile;
			at: number;
	  };

function basename(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1);
}

function OutputsBody({outputs, sessionId}: {outputs: readonly Output[]; sessionId: string})
{
	const host = usePaneHost();
	const showMore = useShowMore();
	const shown = showMore.expanded ? outputs : outputs.slice(0, OUTPUTS_SHOWN);
	return (
		<Rows>
			<RailPreviewRows>
				{shown.map((output, index) =>
				{
					const ref = index === OUTPUTS_SHOWN ? showMore.firstNewRow : undefined;
					if (output.kind === "artifact")
					{
						return (
							<Link
								key={`artifact:${output.artifact.id}`}
								ref={ref}
								to="/artifact/$id"
								params={
								{
									id: output.artifact.id,
								}}
								className={RAIL_ROW_ACTION_CLASS}
							>
								<RailRowContent
									glyph="File"
									icon={<Icon icon={AppWindow} />}
									label={output.artifact.title}
								/>
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
							onClick={() =>
							{
								requestFileOpen(
									sessionId,
									{
										path: output.file.path,
									},
								);
								host.openPane("files");
							}}
						>
							<RailRowContent
								glyph="File"
								icon={<FileTypeIcon fileName={name} size="sm" />}
								label={name}
							/>
						</button>
					);
				})}
			</RailPreviewRows>
			{outputs.length > OUTPUTS_SHOWN && <ShowMoreButton state={showMore} />}
		</Rows>
	);
}

/** Upstream's Outputs card; locally, the artifacts the session published or opened and the files it wrote or sent, newest first. */
function outputsCard(inputs: SessionRailInputs): RailCard | null
{
	const outputs: Output[] = [
		...inputs.artifacts.map((artifact) => (
		{
			kind: "artifact" as const,
			artifact,
			at: artifact.lastEventAt,
		})),
		...inputs.outputFiles.map((file) => (
		{
			kind: "file" as const,
			file,
			at: file.at,
		})),
	].toSorted((left, right) => right.at - left.at);
	if (outputs.length === 0) return null;
	return {
		id: "outputs",
		summary: String(outputs.length),
		body: <OutputsBody outputs={outputs} sessionId={inputs.sessionId} />,
	};
}

interface DiffStats
{
	files: number;
	additions: number;
	deletions: number;
}

/** Upstream's Changes card: the session's pull request, and locally its uncommitted working-copy diff. */
function ChangesBody({
	pr,
	prStatus,
	diff,
	branch,
}: {
	pr: NonNullable<SessionDetailData["pr"]> | null;
	prStatus: PrStatus | null;
	diff: DiffStats | null;
	branch: string | null;
})
{
	const host = usePaneHost();
	const prUrl = prStatus?.url ?? pr?.url;
	const prNumber = prStatus?.number ?? pr?.number;
	const openChanges = () =>
	{
		host.openPane("changes");
	};
	return (
		<Rows>
			{prUrl !== undefined && prNumber !== undefined ? (
				<RailChangesPrRow
					url={prUrl}
					number={prNumber}
					title={prStatus?.title ?? branch ?? `#${prNumber}`}
					prState={prStatus?.state ?? "open"}
					diff={
						diff === null
							? null
							:
								{
									added: diff.additions,
									removed: diff.deletions,
								}
					}
					onOpen={openChanges}
				/>
			) : (
				diff !== null && (
					<RailChangesRow
						added={diff.additions}
						removed={diff.deletions}
						branch={branch}
						onOpen={openChanges}
					/>
				)
			)}
		</Rows>
	);
}

function changesCard(inputs: SessionRailInputs, diff: DiffStats | null): RailCard | null
{
	const hasPr = inputs.pr !== null || inputs.prStatus !== null;
	const liveDiff = diff !== null && diff.files > 0 ? diff : null;
	if (!hasPr && liveDiff === null) return null;
	return {
		id: "pullRequests",
		...(hasPr
			?
				{
					summary: formatCount(1, "pull request"),
				}
			: {}),
		body: (
			<ChangesBody pr={inputs.pr ?? null} prStatus={inputs.prStatus} diff={liveDiff} branch={inputs.gitBranch} />
		),
	};
}

interface DevServer
{
	url: string;
	name?: string | undefined;
	live: boolean;
}

/** Upstream's `zM`: four servers before its Show more row. */
const SERVERS_SHOWN = 4;

function ServersBody({servers}: {servers: readonly DevServer[]})
{
	const showMore = useShowMore();
	const shown = showMore.expanded ? servers : servers.slice(0, SERVERS_SHOWN);
	return (
		<div data-testid="rail-rows" tabIndex={-1} className="flex flex-col outline-none">
			<RailPreviewRows>
				{shown.map((server, index) =>
				{
					const hostLabel = server.url.replace(/^https?:\/\//, "");
					const label = server.name ?? hostLabel;
					const icon = <Icon icon={Server} />;
					// Local adaptation: upstream drops stopped servers; a probe that fails here leaves a row with nothing to open.
					if (!server.live)
						return (
							<RailRow key={server.url} glyph="Server" icon={icon} label={label} hint="Not responding" />
						);
					return (
						<a
							key={server.url}
							ref={index === SERVERS_SHOWN ? showMore.firstNewRow : undefined}
							href={server.url}
							target="_blank"
							rel="noopener noreferrer"
							title={server.url}
							aria-label={`Open ${label} in Browser`}
							className={`${RAIL_ROW_ACTION_CLASS} flex-1`}
						>
							{/* Upstream trails `localhost:<port>` only when the label is something else. */}
							<RailRowContent
								glyph="Server"
								icon={icon}
								label={label}
								{...(label === hostLabel
									? {}
									:
										{
											hint: hostLabel,
										})}
							/>
						</a>
					);
				})}
			</RailPreviewRows>
			{servers.length > SERVERS_SHOWN && <ShowMoreButton state={showMore} />}
		</div>
	);
}

/** Upstream's Servers card: "{count} running", always shown, then each server, launch.json's first. */
function serversCard(servers: readonly DevServer[]): RailCard | null
{
	if (servers.length === 0) return null;
	return {
		id: "servers",
		summary: `${servers.filter((server) => server.live).length} running`,
		body: <ServersBody servers={servers} />,
	};
}

const TASK_ICONS: Record<BackgroundTask["kind"], LucideIcon> =
{
	bash: SquareTerminal,
	agent: Bot,
	monitor: Gauge,
	workflow: Workflow,
	task: ListChecks,
};

/** Upstream's running-task clock: whole minutes, hours past the first. */
function formatTaskElapsed(ms: number): string
{
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const MINUTE_MS = 60_000;

/** The current time, re-read each minute while `ticking`. */
function useMinuteClock(ticking: boolean): number
{
	const [now, setNow] = useState(() => Date.now());
	useEffect(() =>
	{
		if (!ticking) return undefined;
		setNow(Date.now());
		const timer = setInterval(() =>
		{
			setNow(Date.now());
		}, MINUTE_MS);
		return () =>
		{
			clearInterval(timer);
		};
	}, [ticking]);
	return now;
}

/** Upstream's `GNohze`: what the card's polite live region says once a task it stopped has stopped. */
const TASK_STOPPED = "Task stopped";

/**
 * Upstream's rail announcements (`Oi` + `Vi`): a task whose Stop was pressed here is remembered, and once the
 * transcript shows it stopped the polite region says so.
 */
function useStopAnnouncement(tasks: BackgroundTaskGroups)
{
	const pressed = useRef(new Set<string>());
	const [announcement, setAnnouncement] = useState("");
	useEffect(() =>
	{
		for (const id of pressed.current)
		{
			if (tasks.running.some((task) => task.id === id)) continue;
			pressed.current.delete(id);
			if (tasks.finished.some((task) => task.id === id && task.status === "stopped"))
				setAnnouncement(TASK_STOPPED);
		}
	}, [tasks]);
	return {
		announcement,
		remember: (taskId: string) =>
		{
			pressed.current.add(taskId);
		},
	};
}

/**
 * Upstream's Background tasks card: four running tasks with their elapsed
 * time, an in-place Show more, then a finished count; each row opens the
 * Background tasks pane, and a running row has its own Stop while the
 * session can take writes.
 */
function BackgroundTasksBody({
	tasks,
	sessionId,
	stop,
}: {
	tasks: BackgroundTaskGroups;
	sessionId: string;
	stop: BackgroundTaskStop | null;
})
{
	const host = usePaneHost();
	const opener = useBackgroundTasksOpener();
	const showMore = useShowMore();
	const now = useMinuteClock(tasks.running.some((task) => task.startedAt !== null));
	const stoppingIds = useStoppingTaskIds(sessionId);
	const listRef = useRef<HTMLDivElement>(null);
	const {announcement, remember} = useStopAnnouncement(tasks);
	// Upstream's rail rows call openTask: an agent opens its transcript, a task is focused, "N finished" expands Finished.
	const open = (focus: BackgroundTasksFocus) =>
	{
		if (opener === null) host.openPane("background-tasks");
		else opener.open(focus);
	};
	// Upstream `MI`'s focus rescue: the row and its Stop are about to leave, so focus moves to the list first.
	const stopTask = (task: BackgroundTask) =>
	{
		const list = listRef.current;
		if (list?.contains(document.activeElement) === true)
			list.focus(
				{
					preventScroll: true,
				},
			);
		remember(task.id);
		stop?.stop(task);
	};
	const shown = showMore.expanded ? tasks.running : tasks.running.slice(0, BACKGROUND_TASKS_SHOWN);
	return (
		<>
			<div ref={listRef} data-testid="rail-rows" tabIndex={-1} className="flex flex-col outline-none">
				<RailPreviewRows>
					{shown.map((task, index) =>
					{
						const stopping = stoppingIds.has(task.id);
						const elapsed =
							task.startedAt === null ? undefined : formatTaskElapsed(now - Date.parse(task.startedAt));
						const hint = stopping ? STOPPING_LABEL : elapsed;
						return (
							<div
								key={task.id}
								data-rail-task-row=""
								className={`flex min-w-0 items-center${stop === null ? "" : " pe-xs"}`}
							>
								<button
									ref={index === BACKGROUND_TASKS_SHOWN ? showMore.firstNewRow : undefined}
									type="button"
									title={task.command ?? task.description}
									aria-label={`Open ${task.description} in background tasks`}
									className={`${RAIL_ROW_ACTION_CLASS} flex-1`}
									onClick={() =>
									{
										open(
											task.kind === "agent"
												?
													{
														agentId: task.id,
													}
												:
													{
														taskId: task.id,
													},
										);
									}}
								>
									<RailRowContent
										glyph={task.kind === "bash" ? "CommandLine" : "AgentsSimple"}
										icon={<Icon icon={TASK_ICONS[task.kind]} />}
										label={task.description}
										{...(hint === undefined
											? {}
											:
												{
													hint,
												})}
									/>
								</button>
								{stop !== null && (
									<BackgroundTaskStopButton
										variant="ghost"
										flushEnd
										busy={stopping}
										onStop={() =>
										{
											stopTask(task);
										}}
									/>
								)}
							</div>
						);
					})}
				</RailPreviewRows>
				{tasks.running.length > BACKGROUND_TASKS_SHOWN && <ShowMoreButton state={showMore} />}
				{tasks.finished.length > 0 && (
					<button
						type="button"
						className={RAIL_ROW_ACTION_CLASS}
						onClick={() =>
						{
							open(
								{
									finished: true,
								},
							);
						}}
					>
						<RailRowContent
							glyph="AgentsSimple"
							icon={<Icon icon={Bot} />}
							label={`${tasks.finished.length} finished`}
						/>
					</button>
				)}
			</div>
			<div role="status" aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</>
	);
}

/** Upstream's card leaves once nothing runs, however many tasks finished. */
function backgroundTasksCard(inputs: SessionRailInputs): RailCard | null
{
	const tasks = inputs.backgroundTasks;
	if (tasks.running.length === 0) return null;
	return {
		id: "backgroundTasks",
		summary: `${tasks.running.length} running`,
		body: <BackgroundTasksBody tasks={tasks} sessionId={inputs.sessionId} stop={inputs.taskStop ?? null} />,
	};
}

/** Upstream's Goal card: shown while the session has an active `/goal`, kept mounted while it leaves. */
function goalCard(sessionId: string, goal: SessionGoal | null, leaving: boolean, onLeft: () => void): RailCard | null
{
	if (goal === null) return null;
	return {
		id: "goal",
		summary: goalTurnsSummary(goal.iterations),
		leaving,
		onLeft,
		body: <GoalBody key={goal.setAt} sessionId={sessionId} goal={goal} />,
	};
}

/**
 * Upstream `lv`: the last value seen while `value` was present, so a card can fade out with its content after the
 * value goes; `onLeft` drops it once the card has left.
 */
function useLeavingValue<T>(value: T | null):
{
	shown: T | null;
	leaving: boolean;
	onLeft: () => void;
}
{
	const [kept, setKept] = useState(value);
	if (value !== null && value !== kept) setKept(value);
	const onLeft = useCallback(() =>
	{
		setKept(null);
	}, []);
	return {
		shown: value ?? kept,
		leaving: value === null && kept !== null,
		onLeft,
	};
}

/**
 * The rail's lazy chunk: the cards the session has content for, in upstream's
 * default order. Connectors, Servers and the working-copy diff are fetched only
 * while the rail is docked.
 */
export function SessionRailCards({inputs}: {inputs: SessionRailInputs})
{
	const mcpQuery = useQuery(customizeMcpServersQueryOptions);
	const mcpServers = mcpQuery.data;
	const failedMcpServers = useQuery(sessionMcpStatusQueryOptions(inputs.sessionId, inputs.cwd !== null)).data?.failed;
	const loadedConnectorRows = useMemo(
		() => (mcpServers === undefined ? null : connectorRows(mcpServers, inputs.cwd, failedMcpServers ?? [])),
		[mcpServers, inputs.cwd, failedMcpServers],
	);
	// Local deviation: upstream's desktop branch keeps loading forever on an error; here an error counts as none.
	const connectorCount = loadedConnectorRows?.length ?? (mcpQuery.isError ? 0 : null);
	const rememberedNoConnectors = useRailNoConnectors(
		inputs.sessionId,
		connectorCount,
		mcpQuery.isSuccess && !mcpQuery.isPlaceholderData,
	);
	const shownConnectorRows = useHoldNonzero(loadedConnectorRows, connectorCount, true);
	const devServers = useQuery(sessionDevServersQueryOptions(inputs.sessionId, inputs.cwd !== null)).data?.servers;
	const diff = useQuery(
		{
			...sessionDiffQueryOptions(inputs.sessionId, "uncommitted"),
			enabled: inputs.cwd !== null,
		},
	).data?.stats;
	const connectors = sessionConnectors(mcpServers ?? [], inputs.cwd);
	const goal = useLeavingValue(inputs.goal);
	const cards = [
		{
			id: "environment",
			...(inputs.gitBranch === null
				? {}
				:
					{
						summary: inputs.gitBranch,
					}),
			body: <EnvironmentBody inputs={inputs} />,
		} satisfies RailCard,
		goalCard(inputs.sessionId, goal.shown, goal.leaving, goal.onLeft),
		contextCard(inputs, connectors),
		connectorCount === 0 && shownConnectorRows === null
			? null
			: connectorsCard(shownConnectorRows, rememberedNoConnectors),
		outputsCard(inputs),
		changesCard(inputs, diff ?? null),
		serversCard(devServers ?? []),
		backgroundTasksCard(inputs),
	].filter((card) => card !== null);
	return <SessionRail sessionId={inputs.sessionId} cards={cards} />;
}
