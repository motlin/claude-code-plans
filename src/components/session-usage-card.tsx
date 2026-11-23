import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {type ReactNode, useContext, useEffect, useId, useRef, useState} from "react";

import {useTimedFlag} from "../hooks/use-timed-flag";
import {sessionQueryKeys, sessionUsageStatsQueryOptions} from "../lib/api/sessions";
import {usageQueryOptions} from "../lib/api/usage";
import {writeClipboardText} from "../lib/clipboard";
import {formatResetLabel, WEEKLY_LABEL} from "../lib/composer-state";
import {formatModelName} from "../lib/model-name";
import
{
	type AttributionRow,
	formatNarrowDuration,
	formatTokensShort,
	type ModelTokens,
	type SessionUsageResult,
	type SessionUsageStats,
	usageReport,
	type UsageReportWindow,
} from "../lib/session-usage-stats";
import {type UsageSummary, type UsageVariant, type UsageWindow, usageVariant} from "../lib/usage";
import {GhostCopyButton} from "./session-status-card";
import {cdsButtonClass} from "./ui/cds-button";
import {Tooltip} from "./ui/tooltip";
import {TranscriptRevisionContext} from "./transcript-revision-context";
import {UsageMeter} from "./usage-limit-row";

/** How long the Copy report button shows "Copied" with a check. */
const COPIED_MS = 1200;
/** Upstream's `JB`: attribution rows shown before "Show N more". */
const VISIBLE_ROWS = 5;
/** Upstream's `KB`: the smallest top share that earns a tip. */
const TIP_MIN_PCT = 10;
/** Upstream's `Zg` label for the five-hour window (the composer chin says "Session limit" instead). */
const FIVE_HOUR_WINDOW_LABEL = "5-hour limit";
/** Upstream's `jB`: a model with no cost in the Cost row. */
const NO_COST = "–";

const USD = new Intl.NumberFormat(
	"en-US",
	{
		style: "currency",
		currency: "USD",
	},
);
const PERCENT = new Intl.NumberFormat(
	"en-US",
	{
		style: "percent",
		maximumFractionDigits: 0,
	},
);
const INTEGER = new Intl.NumberFormat("en-US");

/** Upstream's `Wp` display name: "Opus 5.5", or the raw id. */
function modelName(model: string): string
{
	return formatModelName(model) ?? model;
}

/** Upstream's `GB`: the family a model's cost share is grouped under. */
function modelFamily(model: string): string
{
	const lower = model.toLowerCase();
	if (lower.includes("opus")) return "Opus";
	if (lower.includes("sonnet")) return "Sonnet";
	if (lower.includes("haiku")) return "Haiku";
	return modelName(model);
}

/** Upstream's `nc` severity ink, with no inline colour at normal severity (`AB`). */
const SEVERITY_COLOR =
{
	accent: undefined,
	warning: "var(--color-warning)",
	danger: "var(--color-danger)",
} as const satisfies Record<UsageVariant, string | undefined>;

interface PlanWindow
{
	key: "five_hour" | "seven_day";
	label: string;
	window: UsageWindow;
}

function planWindows(usage: UsageSummary | undefined): PlanWindow[]
{
	const windows: PlanWindow[] = [];
	if (usage?.fiveHour)
		windows.push(
			{
				key: "five_hour",
				label: FIVE_HOUR_WINDOW_LABEL,
				window: usage.fiveHour,
			},
		);
	if (usage?.sevenDay)
		windows.push(
			{
				key: "seven_day",
				label: WEEKLY_LABEL,
				window: usage.sevenDay,
			},
		);
	return windows;
}

/** Upstream's `MB`: label and reset readout over a meter that names the window. */
function PlanWindowRow({plan, nowMs}: {plan: PlanWindow; nowMs: number})
{
	const labelId = useId();
	const percent = Math.round(Math.max(0, Math.min(100, plan.window.usedPct)));
	const variant = usageVariant(percent);
	const color = SEVERITY_COLOR[variant];
	const percentText = PERCENT.format(percent / 100);
	const reset = formatResetLabel(plan.window.resetsAt, nowMs);
	return (
		<div className="flex flex-col gap-0.75">
			<div className="flex flex-wrap items-baseline justify-between gap-x-sm">
				<span id={labelId} className="min-w-0 text-footnote text-secondary wrap-anywhere">
					{plan.label}
				</span>
				<span className="ms-auto flex items-baseline gap-xs text-footnote text-secondary tabular-nums shrink-0">
					<span>{reset}</span>
					<span
						className={percent === 0 ? "text-muted-as-secondary" : "text-primary"}
						style={
							color === undefined
								? undefined
								:
									{
										color,
									}
						}
					>
						{percentText}
					</span>
				</span>
			</div>
			<UsageMeter
				percent={percent}
				variant={variant}
				labelledBy={labelId}
				valueText={`${percentText} · ${reset}`}
			/>
		</div>
	);
}

/** Upstream's `VB` stat chip. */
function StatChip({label, children}: {label: string; children: ReactNode})
{
	return (
		<span className="inline-flex min-w-0 items-center gap-0.75 whitespace-nowrap">
			<span className="min-w-0 text-secondary">
				<span className={ELLIPSIS}>{label}</span>
			</span>
			<span className="shrink-0 tabular-nums text-muted-as-secondary">{children}</span>
		</span>
	);
}

interface ModelRow extends ModelTokens
{
	model: string;
	total: number;
}

const BREAKDOWN_ROWS: ReadonlyArray<
{
	key: string;
	label: string;
	pick: (tokens: ModelTokens) => number;
}> = [
	{
		key: "in",
		label: "Input",
		pick: (tokens) => tokens.input,
	},
	{
		key: "out",
		label: "Output",
		pick: (tokens) => tokens.output,
	},
	{
		key: "cr",
		label: "Cache read",
		pick: (tokens) => tokens.cacheRead,
	},
	{
		key: "cw",
		label: "Cache write",
		pick: (tokens) => tokens.cacheWrite,
	},
];

/** Upstream's `WB`: each family's share of the cost, largest first, then the cache hit rate. */
function shareChips(
	totals: ModelTokens,
	result: SessionUsageResult | null,
):
{
	key: string;
	label: string;
	pct: number;
}[]
{
	const chips:
	{
		key: string;
		label: string;
		pct: number;
	}[] = [];
	if (result !== null)
	{
		const byFamily = new Map<string, number>();
		let total = 0;
		for (const [model, cost] of Object.entries(result.perModel))
		{
			const family = modelFamily(model);
			byFamily.set(family, (byFamily.get(family) ?? 0) + cost.costUSD);
			total += cost.costUSD;
		}
		if (total > 0)
			for (const [family, cost] of [...byFamily.entries()].toSorted((a, b) => b[1] - a[1]))
				chips.push(
					{
						key: `family-${family}`,
						label: family,
						pct: Math.round((cost / total) * 100),
					},
				);
	}
	const cacheable = totals.input + totals.cacheRead + totals.cacheWrite;
	if (cacheable > 0)
		chips.push(
			{
				key: "cache-hit",
				label: "Cache hit",
				pct: Math.round((totals.cacheRead / cacheable) * 100),
			},
		);
	return chips;
}

/** Upstream's single-line label that clips with an ellipsis. */
const ELLIPSIS = "block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap";

const RULE = <span aria-hidden="true" className="col-span-full border-b-[0.5px] border-alpha-3" />;

/** Upstream's `PB`: "This session" stat chips, the Breakdown grid, and the unknown-cost note. */
function SessionSection({
	usage,
	result,
	lineChanges,
	hasUnknownModelCost,
}: {
	usage: Readonly<Record<string, ModelTokens>>;
	result: SessionUsageResult | null;
	lineChanges: SessionUsageStats["lineChanges"] | null;
	/** The `cost-state` record's own flag: some model had no known price. */
	hasUnknownModelCost: boolean;
})
{
	const models: ModelRow[] = Object.entries(usage)
		.map(([model, tokens]) => (
		{
			model,
			...tokens,
			total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
		}))
		.toSorted((a, b) => b.total - a.total);
	const totals = models.reduce<ModelTokens>(
		(sum, row) => (
		{
			input: sum.input + row.input,
			output: sum.output + row.output,
			cacheRead: sum.cacheRead + row.cacheRead,
			cacheWrite: sum.cacheWrite + row.cacheWrite,
		}),
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
	);
	const hasTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite > 0;
	if (result === null && !hasTokens) return null;
	const costOf = (model: string) => result?.perModel[model]?.costUSD ?? 0;
	const unknownCost =
		hasUnknownModelCost ||
		(result !== null &&
			models.some((row) =>
			{
				const cost = result.perModel[row.model];
				return row.total > 0 && cost !== undefined && !(cost.costUSD > 0);
			}));
	const someCost = result !== null && models.some((row) => costOf(row.model) > 0);
	const webSearches =
		result === null ? 0 : Object.values(result.perModel).reduce((sum, cost) => sum + cost.webSearch, 0);
	const totalColumn = models.length >= 2 && models.length <= 3;
	const costRow = someCost && models.length > 1;
	const totalCost = models.reduce((sum, row) => sum + costOf(row.model), 0);
	const columns = models.length + (totalColumn ? 1 : 0);

	const chips: ReactNode[] = [];
	if (result !== null)
	{
		chips.push(
			<StatChip key="cost" label="Cost">
				{USD.format(result.costUSD)}
			</StatChip>,
		);
		if (result.apiMs > 0)
			chips.push(
				<StatChip key="api" label="API">
					{formatNarrowDuration(result.apiMs)}
				</StatChip>,
			);
		if (result.wallMs > 0)
			chips.push(
				<StatChip key="active" label="Active">
					{formatNarrowDuration(result.wallMs)}
				</StatChip>,
			);
		if (lineChanges !== null && (lineChanges.added > 0 || lineChanges.removed > 0))
			chips.push(
				<StatChip key="lines" label="Lines">
					<span className="text-git-added">+{lineChanges.added}</span>{" "}
					<span className="text-git-removed">
						{"−"}
						{lineChanges.removed}
					</span>
				</StatChip>,
			);
		if (webSearches > 0)
			chips.push(
				<StatChip key="web-searches" label="Web searches">
					{INTEGER.format(webSearches)}
				</StatChip>,
			);
	}
	for (const chip of shareChips(totals, result))
		chips.push(
			<StatChip key={chip.key} label={chip.label}>
				{PERCENT.format(chip.pct / 100)}
			</StatChip>,
		);
	const chipRows: ReactNode[][] = [];
	for (let index = 0; index < chips.length; index += 3) chipRows.push(chips.slice(index, index + 3));

	return (
		<div className="flex flex-col gap-[24px]">
			<div className="flex flex-col gap-1.25">
				<span className="text-footnote text-primary">This session</span>
				{chipRows.length > 0 && (
					<div className="flex flex-col">
						{chipRows.map((row, index) => (
							<div
								// The rows are positional chunks of a fixed chip order.
								// eslint-disable-next-line react/no-array-index-key
								key={index}
								className="grid grid-cols-3 max-sm:grid-cols-1 gap-x-2.5 py-0.75 text-footnote first:pt-0 border-b-[0.5px] border-alpha-3"
							>
								{row}
							</div>
						))}
					</div>
				)}
			</div>
			{hasTokens && (
				<div className="rounded has-[>:focus-visible]:shadow-focus has-[>:focus-visible]:outline-hidden">
					<div
						className="grid items-center overflow-x-auto scroll-fade-x whitespace-nowrap tabular-nums focus-visible:outline-hidden gap-x-xs gap-y-0.75 text-footnote"
						style={
						{
							gridTemplateColumns: `max-content repeat(${columns}, 1fr)`,
						}}
					>
						<span className="pb-0.5 text-footnote text-primary">Breakdown</span>
						{models.map((row) => (
							<span key={row.model} className="min-w-11 pb-0.5 text-end text-muted-as-secondary">
								<span className={ELLIPSIS}>{modelName(row.model)}</span>
							</span>
						))}
						{totalColumn && <span className="pb-0.5 text-end text-muted-as-secondary">Total</span>}
						{RULE}
						{BREAKDOWN_ROWS.map((breakdown) => (
							<BreakdownRow key={breakdown.key} label={breakdown.label}>
								{models.map((row) => (
									<span key={row.model} className="text-end text-muted-as-secondary">
										{formatTokensShort(breakdown.pick(row))}
									</span>
								))}
								{totalColumn && (
									<span className="text-end text-muted-as-secondary">
										{formatTokensShort(breakdown.pick(totals))}
									</span>
								)}
							</BreakdownRow>
						))}
						{costRow && (
							<BreakdownRow label="Cost">
								{models.map((row) => (
									<span key={row.model} className="text-end text-muted-as-secondary">
										{costOf(row.model) > 0 ? USD.format(costOf(row.model)) : NO_COST}
									</span>
								))}
								{totalColumn && (
									<span className="text-end text-muted-as-secondary">{USD.format(totalCost)}</span>
								)}
							</BreakdownRow>
						)}
					</div>
				</div>
			)}
			{unknownCost && (
				<span className="text-footnote text-muted-as-secondary">
					Costs may be inaccurate due to usage of unknown models.
				</span>
			)}
		</div>
	);
}

function BreakdownRow({label, children}: {label: string; children: ReactNode})
{
	return (
		<>
			<span className="text-muted-as-secondary">{label}</span>
			{children}
			{RULE}
		</>
	);
}

type AttributionCategory = "skill" | "subagent" | "mcp";

const CATEGORY_LABEL =
{
	skill: "Skill",
	subagent: "Subagent",
	mcp: "MCP",
} as const satisfies Record<AttributionCategory, string>;

const TIPS =
{
	mcp: "MCP tool results stay in context for the rest of the session. Compacting clears them, or you can turn off servers you don’t need.",
	subagent:
		"Each subagent runs its own requests. Consider a cheaper model for simple subagents, or tighten their prompts.",
	skill: "Heavy slash commands can be scoped down or run with a cheaper model.",
} as const satisfies Record<AttributionCategory, string>;

interface ShareRow
{
	id: string;
	display: string;
	pct: number;
	category: AttributionCategory;
}

/** Upstream's `xV`: every category's rows merged, largest share first. */
function shareRows(attribution: SessionUsageStats["attribution"]): ShareRow[]
{
	const groups: [AttributionCategory, readonly AttributionRow[], (name: string) => string][] = [
		["skill", attribution.skills, (name) => `/${name}`],
		["subagent", attribution.subagents, (name) => name],
		["mcp", attribution.mcpServers, (name) => name],
	];
	const rows: ShareRow[] = [];
	for (const [category, entries, label] of groups)
		for (const entry of entries)
		{
			const display = label(entry.name);
			rows.push(
				{
					id: `${category}:${display}`,
					display,
					pct: entry.pct,
					category,
				},
			);
		}
	return rows.toSorted((a, b) => b.pct - a.pct);
}

/** Upstream's `wV`: name and category behind a tip, a small meter, and the share. */
function ShareRowView({row}: {row: ShareRow})
{
	const nameId = useId();
	const shareId = useId();
	const percent = PERCENT.format(row.pct / 100);
	return (
		<div className="flex items-center gap-1.25 text-footnote">
			{/* The anchor stretches like upstream's bare trigger, which is the row's flex child. */}
			<Tooltip content={TIPS[row.category]} multiline className="flex flex-1 min-w-0">
				<button type="button" className="flex items-center gap-0.75 flex-1 min-w-0 cursor-help text-start">
					<span id={nameId} className="text-secondary truncate">
						{row.display}
					</span>
					<span className="text-muted-as-secondary shrink-0">{CATEGORY_LABEL[row.category]}</span>
				</button>
			</Tooltip>
			<UsageMeter
				percent={row.pct}
				variant="accent"
				size="sm"
				labelledBy={`${nameId} ${shareId}`}
				valueText={percent}
				className="w-20 shrink-0"
			/>
			<span className="text-muted-as-secondary tabular-nums text-end w-9 shrink-0">
				<span id={shareId} className="sr-only">
					Share{" "}
				</span>
				{percent}
			</span>
		</div>
	);
}

/** Upstream's `iV` (session scope): "What's contributing", the first five rows with Show more, and a tip. */
function AttributionSection({
	attribution,
	onOpenMcpServers,
}: {
	attribution: SessionUsageStats["attribution"];
	onOpenMcpServers: (() => void) | undefined;
})
{
	const [expanded, setExpanded] = useState(false);
	const rows = shareRows(attribution);
	if (rows.length === 0) return null;
	const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
	const hidden = rows.length - visible.length;
	const tip = (
		[
			["mcp", attribution.mcpServers[0]],
			["subagent", attribution.subagents[0]],
			["skill", attribution.skills[0]],
		] as const
	)
		.filter(([, row]) => row !== undefined && row.pct >= TIP_MIN_PCT)
		.toSorted((a, b) => (b[1]?.pct ?? 0) - (a[1]?.pct ?? 0))[0]?.[0];
	return (
		<div className="flex flex-col gap-md">
			<span className="text-footnote text-muted-as-secondary">What’s contributing (this session)</span>
			<div className="flex flex-col gap-xs">
				{visible.map((row) => (
					<ShareRowView key={row.id} row={row} />
				))}
				{(hidden > 0 || (expanded && rows.length > VISIBLE_ROWS)) && (
					<button
						type="button"
						aria-expanded={expanded}
						className={`${cdsButtonClass("ghost", "sm")} -ms-1.5 self-start`}
						onClick={() =>
						{
							setExpanded((open) => !open);
						}}
					>
						{expanded ? "Show less" : `Show ${hidden} more`}
					</button>
				)}
			</div>
			{tip !== undefined && (
				<div className="pt-[12px]">
					<div className="flex flex-col gap-sm">
						<div className="flex flex-col gap-1.25">
							<span className="text-footnote text-primary">Tip</span>
							<span className="text-footnote text-muted-as-secondary">{TIPS[tip]}</span>
						</div>
						{tip === "mcp" && onOpenMcpServers !== undefined && (
							<div className="flex flex-wrap gap-sm">
								<button
									type="button"
									className={cdsButtonClass("secondary", "sm")}
									onClick={onOpenMcpServers}
								>
									Open MCP servers
								</button>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function reportWindows(windows: readonly PlanWindow[]): UsageReportWindow[]
{
	return windows.map((plan) => (
	{
		key: plan.key,
		utilization: plan.window.usedPct,
		resetsAt: new Date(plan.window.resetsAt * 1000).toISOString(),
		expires: false,
	}));
}

export interface SessionUsageCardProps
{
	usage: UsageSummary | undefined;
	usageLoading: boolean;
	usageError: boolean;
	onRetry: () => void;
	retrying: boolean;
	stats: SessionUsageStats | undefined;
	onOpenMcpServers?: (() => void) | undefined;
}

/**
 * Upstream's `/usage` card (c44e562e8 `kB`): plan limits with Copy report, this session's stats and Breakdown, and
 * what's contributing. The desktop-only period scopes and the billing credit rows have no local meaning.
 */
export function SessionUsageCard({
	usage,
	usageLoading,
	usageError,
	onRetry,
	retrying,
	stats,
	onOpenMcpServers,
}: SessionUsageCardProps)
{
	const [copied, showCopied] = useTimedFlag(COPIED_MS);
	const windows = planWindows(usage);
	const sessionUsage = stats?.usage ?? {};
	const result = stats?.result ?? null;
	const showPlan = usageLoading || usageError || windows.length > 0;
	const hasModels = Object.keys(sessionUsage).length > 0;
	const nowMs = Date.now();
	const loadingWithNone = usageLoading && windows.length === 0;
	const copyReport = () =>
	{
		const report = usageReport(
			{
				generatedAt: new Date().toISOString(),
				userAgent: navigator.userAgent,
				windows: reportWindows(windows),
				planError: usageError,
				sessionUsage,
				resultStats: result,
				modelName,
			},
		);
		void writeClipboardText(report).then((ok) =>
		{
			if (ok) showCopied();
		});
	};
	const attribution = stats?.attribution;
	return (
		<div
			tabIndex={-1}
			role="group"
			aria-label="Usage"
			className="flex flex-col gap-[24px] p-[16px] pt-lg rounded-lg w-[360px] max-w-full card-ring outline-none"
		>
			{showPlan || hasModels || result !== null ? (
				<>
					{showPlan && (
						<div className="flex flex-col gap-md">
							<span className="flex items-center justify-between text-footnote text-primary pb-xs">
								Usage
								{!loadingWithNone && (
									<GhostCopyButton
										size="base"
										copied={copied}
										label="Copy report"
										onCopy={copyReport}
									/>
								)}
							</span>
							{loadingWithNone ? (
								<span className="text-footnote text-muted-as-secondary">Loading usage…</span>
							) : (
								<>
									{usageError && (
										<div className="flex items-center justify-between gap-md">
											<span className="text-footnote text-muted-as-secondary">
												Couldn’t load usage limits
											</span>
											<button
												type="button"
												aria-busy={retrying || undefined}
												disabled={retrying}
												className={cdsButtonClass("secondary", "sm")}
												onClick={onRetry}
											>
												Retry
											</button>
										</div>
									)}
									{windows.map((plan) => (
										<PlanWindowRow key={plan.key} plan={plan} nowMs={nowMs} />
									))}
								</>
							)}
						</div>
					)}
					<SessionSection
						usage={sessionUsage}
						result={result}
						lineChanges={result === null ? null : (stats?.lineChanges ?? null)}
						hasUnknownModelCost={stats?.hasUnknownModelCost ?? false}
					/>
					{attribution !== undefined && (
						<AttributionSection attribution={attribution} onOpenMcpServers={onOpenMcpServers} />
					)}
				</>
			) : (
				<span className="text-footnote text-muted-as-secondary">
					No usage data yet — plan usage appears once limits load, and session usage after Claude’s first
					reply
				</span>
			)}
		</div>
	);
}

/** The transcript's Usage card: plan limits from `/api/usage`, session stats from the transcript, both live. */
export function LiveSessionUsageCard({sessionId}: {sessionId: string})
{
	const usage = useQuery(usageQueryOptions);
	const stats = useQuery(sessionUsageStatsQueryOptions(sessionId));
	const revision = useContext(TranscriptRevisionContext);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const seenRevision = useRef(revision);
	useEffect(() =>
	{
		if (seenRevision.current === revision) return;
		seenRevision.current = revision;
		void queryClient.invalidateQueries(
			{
				queryKey: sessionQueryKeys.usageStats(sessionId),
			},
		);
	}, [revision, queryClient, sessionId]);
	return (
		<SessionUsageCard
			usage={usage.data}
			usageLoading={usage.isPending}
			usageError={usage.isError}
			retrying={usage.isError && usage.isFetching}
			onRetry={() => void usage.refetch()}
			stats={stats.data}
			onOpenMcpServers={() =>
				void navigate(
					{
						to: "/customize/connectors",
					},
				)
			}
		/>
	);
}
