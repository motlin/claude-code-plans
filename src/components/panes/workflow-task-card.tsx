import {Check, ChevronRight} from "lucide-react";
import {type ReactNode, useState} from "react";

import type {SessionWorkflowRun} from "../../lib/api/session-workflow-runs";
import type {BackgroundTask} from "../../lib/background-tasks";
import {formatModelName} from "../../lib/model-name";
import {nonEmpty} from "../../lib/non-empty";
import {workflowSummary} from "../../lib/workflow-name";
import {
	type AgentCell,
	agentCells,
	buildWorkflowProgress,
	endUnfinishedAgents,
	phaseAriaLabel,
	type WorkflowAgentEntry,
	type WorkflowPhase,
	type WorkflowRunStatus,
} from "../../lib/workflow-progress";
import {formatPaddedElapsed} from "../../lib/working-marker";
import {ShimmerText} from "../shimmer-text";
import {AgentCount, useNow} from "../tool-renderers/workflow-card";
import {Tooltip} from "../ui/tooltip";
import {WorkflowAgentCells} from "../workflow-agent-cells";

/** Upstream `mf.leading.body`. */
const BODY_LEADING = {lineHeight: "var(--text-body--line-height)"};

/** Upstream `y1`. */
const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
	running: "Running",
	completed: "Completed",
	stopped: "Stopped",
	failed: "Failed",
};

/** Upstream `Xme`: an expanded phase with no agents. */
const EMPTY_PHASE_COPY: Record<WorkflowRunStatus, string> = {
	running: "No agents have started yet",
	completed: "No agents ran in this phase",
	stopped: "Stopped before any agents started",
	failed: "Failed before any agents started",
};

/** Upstream `Wme`/`Y$`/`Gme`/`Kme`/`qme`: the agents table's columns and its container-query drops. */
const AGENT_GRID =
	"grid-cols-[calc(0.75rem*var(--cds-rem-scale,1))_minmax(auto,1fr)_minmax(0,max-content)_minmax(2.5625rem,max-content)_minmax(3.5rem,max-content)] @max-[19.875rem]/agents:grid-cols-[calc(0.75rem*var(--cds-rem-scale,1))_minmax(auto,1fr)_minmax(0,max-content)_minmax(3.5rem,max-content)] @max-[16.8125rem]/agents:grid-cols-[calc(0.75rem*var(--cds-rem-scale,1))_minmax(0,1fr)_minmax(3.5rem,max-content)]";
const HIDE_TOKENS = "@max-[19.875rem]/agents:hidden";
const HIDE_AGENT = "@max-[16.8125rem]/agents:hidden";
const SR_AGENT = "@max-[16.8125rem]/agents:sr-only";
const ERROR_SPAN = "col-span-3 @max-[19.875rem]/agents:col-span-2";

const FOCUS = "outline-none hide-focus-ring focus-visible:ring-focus";

/** Upstream `U$`: a duration as the card's padded elapsed clock. */
function formatDuration(ms: number): string {
	return formatPaddedElapsed(Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0);
}

/** Upstream `ac`: a token count in thousands or millions to one decimal. */
function compactCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/** Upstream `Ee`: shimmers only while active, otherwise plain text in its own ink. */
function MaybeShimmer({active, className, children}: {active: boolean; className: string; children: ReactNode}) {
	return active ? (
		<ShimmerText className={className}>{children}</ShimmerText>
	) : (
		<span className={className}>{children}</span>
	);
}

/** Upstream `J$`: a phase title's ink for its status. */
function phaseInk(phase: WorkflowPhase): string {
	switch (phase.status) {
		case "running":
			return phase.counts.stalled > 0 ? "text-warning" : "text-secondary";
		case "error":
			return "text-danger-ink";
		default:
			return "text-secondary";
	}
}

/** Upstream `G$`: a live elapsed clock from `startedAt`. */
function LiveTimer({startedAt, now}: {startedAt: number; now: number}) {
	return <span className="tabular-nums">{formatDuration(now - startedAt)}</span>;
}

/** Upstream `Qme`: one agent's row of the phase table. */
function AgentRow({
	agent,
	running,
	stopped,
	now,
}: {
	agent: WorkflowAgentEntry;
	running: boolean;
	stopped: boolean;
	now: number;
}) {
	const isDone = agent.state === "done";
	const model = formatModelName(agent.model);
	let time: ReactNode = null;
	if (running && (agent.state === "progress" || agent.state === "start") && agent.startedAt !== undefined) {
		time = <LiveTimer startedAt={agent.startedAt} now={now} />;
	} else if (stopped) {
		time = "Stopped";
	} else if (agent.durationMs !== undefined) {
		time = formatDuration(agent.durationMs);
	}
	return (
		<li role="listitem" className={`contents ${isDone || !running ? "text-ink-muted" : "text-secondary"}`}>
			<span className="flex items-center">
				{isDone && (
					<span role="img" aria-label="Done" className="flex">
						<Check size={12} aria-hidden="true" />
					</span>
				)}
			</span>
			{agent.toolsUsed !== undefined && agent.toolsUsed.length > 0 ? (
				<span className={`flex min-w-0 gap-1 ${SR_AGENT}`}>
					<span className="truncate" title={agent.label}>
						{agent.label}
					</span>
					<span className="shrink-0 whitespace-nowrap text-ink-muted" title={agent.toolsUsed.join(", ")}>
						{agent.toolsUsed.length === 1 ? "1 tool" : `${agent.toolsUsed.length} tools`}
					</span>
				</span>
			) : (
				<span className={`truncate ${SR_AGENT}`} title={agent.label}>
					{agent.label}
				</span>
			)}
			{agent.error ? (
				<span className={`flex justify-end ${ERROR_SPAN}`}>
					<Tooltip content={agent.error} multiline>
						<span
							// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's error is a tab stop that reaches its popover
							tabIndex={0}
							aria-label={agent.error}
							className={`cursor-default text-danger-ink ${FOCUS}`}
						>
							Error
						</span>
					</Tooltip>
				</span>
			) : (
				<>
					<span className="truncate" title={model ?? undefined}>
						{model}
					</span>
					<span className={`whitespace-nowrap text-end tabular-nums ${HIDE_TOKENS}`}>
						{agent.tokens ? compactCount(agent.tokens) : null}
					</span>
					<span className="whitespace-nowrap text-end tabular-nums">{time}</span>
				</>
			)}
		</li>
	);
}

/** Upstream `Zme`: a phase's agents table, or its empty-phase copy. */
function AgentsTable({
	agents,
	cells,
	status,
	now,
}: {
	agents: readonly WorkflowAgentEntry[];
	cells: readonly AgentCell[];
	status: WorkflowRunStatus;
	now: number;
}) {
	if (agents.length === 0) return <div className="text-footnote text-ink-muted ps-2">{EMPTY_PHASE_COPY[status]}</div>;
	const running = status === "running";
	return (
		<div className="@container/agents px-2">
			<div
				className={`relative grid items-center gap-x-2 gap-y-1 text-footnote ${AGENT_GRID}`}
				style={{gridTemplateRows: "auto", gridAutoRows: "16px"}}
			>
				<span />
				<span className={`whitespace-nowrap text-ink-muted ${HIDE_AGENT}`}>Agent</span>
				<span className="truncate text-ink-muted">Model</span>
				<span className={`text-end text-ink-muted ${HIDE_TOKENS}`}>Tokens</span>
				<span className="text-end text-ink-muted">Time</span>
				<ul role="list" className="contents">
					{agents.map((agent, i) => (
						<AgentRow
							key={agent.index}
							agent={agent}
							running={running}
							stopped={cells[i]?.state === "stopped"}
							now={now}
						/>
					))}
				</ul>
			</div>
		</div>
	);
}

/** Upstream `$me`: a disclosable phase row with its done/total count and cell grid. */
function PhaseRow({
	phase,
	status,
	anticipate,
	now,
}: {
	phase: WorkflowPhase;
	status: WorkflowRunStatus;
	anticipate: boolean;
	now: number;
}) {
	const running = status === "running";
	const [chosen, setChosen] = useState<boolean | null>(null);
	const open = chosen ?? (running && phase.counts.total > 0);
	const cells = agentCells(phase.agents, {now, taskStopped: status === "stopped"});
	const hasAgents = phase.counts.total > 0;
	let ink = "text-ink-muted";
	if (running) {
		if (phase.status === "running" || phase.status === "error") ink = phaseInk(phase);
		else ink = open ? "text-primary" : phaseInk(phase);
	}
	return (
		<li className={`flex flex-col gap-2 ${open ? "pb-3" : ""}`}>
			<button
				type="button"
				onClick={() => {
					setChosen(!open);
				}}
				aria-expanded={open}
				aria-label={phaseAriaLabel(phase)}
				className={`text-start ${FOCUS} w-full rounded-r3 px-2 pt-1 ${open ? "bg-alpha-1" : "hover:bg-fill-ghost-hover"} ${hasAgents ? "pb-2" : "pb-1.5"}`}
			>
				<span className="flex w-full flex-col gap-g5 text-footnote">
					<span className="flex w-full items-start">
						<span className="flex min-w-0 flex-1 items-start gap-2">
							<span className="flex min-h-5 min-w-0 flex-1 items-center">
								<MaybeShimmer
									active={running && phase.status === "running" && phase.counts.stalled === 0}
									className={`min-w-0 break-words text-balance ${ink}`}
								>
									{phase.title}
								</MaybeShimmer>
							</span>
							{hasAgents && (
								<span className="flex min-h-5 shrink-0 items-center tabular-nums text-ink-muted">
									{phase.counts.done}/{phase.counts.total}
								</span>
							)}
							<span className="flex min-h-5 shrink-0 items-center justify-center w-[16px]">
								<ChevronRight
									size={16}
									aria-hidden="true"
									className={`text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
								/>
							</span>
						</span>
					</span>
					{hasAgents && (
						<span className="block pe-[calc(16px+var(--spacing-g5))]">
							<WorkflowAgentCells
								counts={phase.counts}
								wrap
								cols={16}
								anticipate={anticipate}
								agents={cells}
							/>
						</span>
					)}
				</span>
			</button>
			{open && <AgentsTable agents={phase.agents} cells={cells} status={status} now={now} />}
		</li>
	);
}

/** Upstream `Rhe`'s failed/stopped summary block. */
function SummaryRegion({status, summary}: {status: "failed" | "stopped"; summary: string}) {
	const failed = status === "failed";
	const label = failed ? "Error" : "Stopped";
	return (
		<span
			className={`flex flex-col gap-1 ${failed ? "rounded-r5 p-2 pt-[7px]" : "rounded-r5 bg-alpha-1 p-2 pt-[7px]"}`}
			style={failed ? {background: "color-mix(in srgb, var(--color-fill-danger) 8%, transparent)"} : undefined}
		>
			<span className={`text-footnote ${failed ? "text-danger-ink" : "text-ink-muted"}`}>{label}</span>
			<span
				role="region"
				aria-label={label}
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region needs focus for keyboard scrolling
				tabIndex={0}
				className={`block max-h-[120px] overflow-y-auto rounded-r3 text-footnote text-secondary whitespace-pre-wrap break-words select-text ${FOCUS}`}
				style={BODY_LEADING}
			>
				{summary}
			</span>
		</span>
	);
}

/**
 * Upstream `Rhe` (the non-"panels" task card): a workflow in the Background
 * tasks pane -- its name (shimmering while it runs, else muted with its
 * duration), "Workflow" + status, the agent and token counts, its
 * description, a failed or stopped run's summary, and its phases. Local CLI
 * tasks can't be stopped from here, so there is no Stop button.
 */
export function WorkflowTaskCard({task, run}: {task: BackgroundTask; run?: SessionWorkflowRun | undefined}) {
	const runStatus = run?.status;
	const status: WorkflowRunStatus = runStatus !== undefined && runStatus !== "running" ? runStatus : task.status;
	const running = status === "running";
	const now = useNow();
	const entries = run?.progress ?? [];
	const model = buildWorkflowProgress(running ? entries : endUnfinishedAgents(entries, status), {
		now,
		settled: !running,
		taskStopped: status === "stopped",
	});
	const title = nonEmpty(run?.workflowName) ?? nonEmpty(task.description) ?? task.id;
	const description = run?.description ?? "";
	const summary = workflowSummary(run?.summary ?? task.summary ?? undefined, description || undefined);
	const startedAt = run?.startedAt ?? (task.startedAt === null ? null : Date.parse(task.startedAt));
	const durationMs = run?.durationMs ?? null;
	const timer =
		running && startedAt !== null ? (
			<LiveTimer startedAt={startedAt} now={now} />
		) : durationMs !== null && durationMs > 0 ? (
			formatDuration(durationMs)
		) : null;
	const totalTokens = run?.totalTokens ?? null;
	const agentTotal = model?.counts.total ?? 0;
	return (
		<div className="flex flex-col gap-[24px] text-pretty rounded-r6 bg-alpha-1 p-2 pb-3">
			<span className="min-w-0 flex flex-col gap-[12px] select-none">
				<span className="flex flex-col gap-1.25">
					<span className="flex items-start gap-2">
						<MaybeShimmer
							active={running}
							className={`flex-1 min-w-0 text-body break-words text-balance ${running ? "text-primary" : "text-ink-muted"}`}
						>
							{title}
						</MaybeShimmer>
						{!running && timer !== null && (
							<span
								className="shrink-0 text-footnote text-ink-muted tabular-nums pe-0.75"
								style={BODY_LEADING}
							>
								{timer}
							</span>
						)}
					</span>
					<span className="contents text-footnote text-ink-muted [overflow-wrap:anywhere]">
						<span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.75">
							<span className={running ? "text-secondary" : undefined}>Workflow</span>
							{!running && (
								<span className={status === "failed" ? "text-danger-ink" : undefined}>
									{RUN_STATUS_LABELS[status]}
								</span>
							)}
							{running && timer !== null && <span className="tabular-nums">{timer}</span>}
						</span>
						{(agentTotal > 0 || totalTokens !== null) && (
							<span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.75">
								{agentTotal > 0 && <AgentCount total={agentTotal} muted={!running} />}
								{totalTokens !== null && (
									<span>
										{running ? (
											<span className="text-secondary">{compactCount(totalTokens)}</span>
										) : (
											compactCount(totalTokens)
										)}{" "}
										tokens
									</span>
								)}
							</span>
						)}
					</span>
				</span>
				{description !== "" && description !== title && (
					<span className="block text-footnote text-ink-muted break-words" style={BODY_LEADING}>
						{description}
					</span>
				)}
				{summary !== undefined && (status === "failed" || status === "stopped") && (
					<SummaryRegion status={status} summary={summary} />
				)}
			</span>
			{model !== undefined && model.phases.length > 0 && (
				<div className="flex flex-col gap-g5">
					<span className={`text-footnote font-medium ${running ? "text-primary" : "text-ink-muted"}`}>
						Phases
					</span>
					<ul role="list" className="flex flex-col">
						{model.phases.map((phase) => (
							<PhaseRow
								key={phase.index}
								phase={phase}
								status={status}
								anticipate={running && phase.status !== "done"}
								now={now}
							/>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
