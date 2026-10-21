import {Link} from "@tanstack/react-router";
import {ChevronRight} from "lucide-react";
import {Component, createRef, useImperativeHandle, useRef, useState, type ReactNode, type Ref} from "react";
import {flushSync} from "react-dom";

import {formatTokenCount} from "../../lib/composer-state";
import {
	buildContextLegend,
	type ContextBreakdown,
	type ContextLegendRow,
	type ContextMeterCategory,
} from "../../lib/context-breakdown";
import {toMdSlug} from "../../lib/md-slug";

/* Upstream's rail Context breakdown (`I` with layout "rail"): a stacked meter, legend rows, deferred rows and expanders. */

const ROW_CLASS = "flex min-h-6 w-full min-w-0 items-center gap-2 px-1 text-[12px]/[15px]";
const EXPANDER_ROW_CLASS = "flex min-h-5 w-full min-w-0 items-center gap-2 px-1 text-[12px]/[15px]";
const LEAD_CLASS = "flex w-3 shrink-0 items-center justify-center";
const PCT_CLASS = "w-11 shrink-0 text-end tabular-nums";
const ACTION_NAME_CLASS =
	"underline decoration-dotted underline-offset-2 group-hover/press:decoration-solid group-focus-visible/press:decoration-solid";
const ACTION_TOKENS_CLASS =
	"group-hover/press:text-secondary group-focus-visible/press:text-secondary group-active/press:text-secondary";
const ACTION_ROW_CLASS = `group/press relative text-start ${ROW_CLASS} rounded focus-visible:outline-hidden focus-visible:shadow-focus hover:bg-fill-ghost-hover active:bg-alpha-2`;
const TOGGLE_CLASS =
	"flex min-h-6 w-full min-w-0 items-center gap-2 rounded px-1 text-start text-[12px]/[15px] hover:bg-alpha-2 focus-visible:outline-hidden focus-visible:shadow-focus";
/** Upstream scrolls an expander's list once it passes 12 rows. */
const EXPANDER_SCROLL_AFTER = 12;

const PERCENT = new Intl.NumberFormat("en-US", {style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1});
const ARIA_PERCENT = new Intl.NumberFormat("en-US", {maximumSignificantDigits: 2});
const COUNT = new Intl.NumberFormat("en-US");

/** The chart color of a meter series: used rows cycle the four categorical tokens. */
function seriesColor(series: string, categories: readonly ContextMeterCategory[]): string {
	const category = categories.find((c) => c.id === series);
	if (category?.color !== undefined) return `var(--chart-${category.color})`;
	if (series === "other" || series === "since") return "var(--chart-reference)";
	if (series === "buffer") return "var(--chart-muted)";
	const index = categories.filter((c) => c.color === undefined).findIndex((c) => c.id === series);
	return `var(--chart-categorical-${(Math.max(0, index) % 4) + 1})`;
}

/** Upstream's StackedMeter (size sm): absolutely placed segments with 1px gaps, 2px outer and 1px inner radii. */
function StackedMeter({
	categories,
	values,
	total,
}: {
	categories: readonly ContextMeterCategory[];
	values: Record<string, number>;
	total: number;
}) {
	const segments = categories
		.map((category) => ({category, pct: ((values[category.id] ?? 0) / total) * 100}))
		.filter((segment) => segment.pct > 0);
	const label = `Context window: ${segments
		.map(
			({category, pct}) =>
				`${category.label}: ${formatTokenCount(values[category.id] ?? 0)}, ${ARIA_PERCENT.format(pct)}%`,
		)
		.join("; ")}`;
	let cumulative = 0;
	return (
		<div
			role="img"
			aria-label={label}
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's meter is a focusable tooltip trigger that reads its series aloud
			tabIndex={0}
			className="relative w-full overflow-hidden rounded-full outline-none focus-visible:outline-hidden focus-visible:shadow-focus shrink-0"
			style={{height: 4, backgroundColor: "var(--chart-reference-tint)"}}
		>
			{segments.map(({category, pct}, i) => {
				const first = i === 0;
				const last = i === segments.length - 1;
				const start = cumulative;
				cumulative += pct;
				const outer = (isOuter: boolean) => (isOuter ? "2px" : "1px");
				return (
					<div
						key={category.id}
						className="absolute inset-y-0"
						style={{
							insetInlineStart: first ? `calc(${start}% + 0px)` : `calc(${start}% + 1px)`,
							width: first ? `calc(${pct}% + 0px)` : `calc(${pct}% - 1px)`,
							backgroundColor: seriesColor(category.id, categories),
							borderStartStartRadius: outer(first),
							borderEndStartRadius: outer(first),
							borderStartEndRadius: outer(last),
							borderEndEndRadius: outer(last),
						}}
					/>
				);
			})}
		</div>
	);
}

function Swatch({color}: {color: string}) {
	return (
		<span
			aria-hidden
			data-rail-context-swatch=""
			className="shrink-0"
			style={{width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block"}}
		/>
	);
}

/** Collapsed content mounts on first open, then stays mounted and hidden (upstream's `F`). */
function Collapse({expanded, className, children}: {expanded: boolean; className?: string; children: ReactNode}) {
	const [mounted, setMounted] = useState(expanded);
	if (expanded && !mounted) setMounted(true);
	if (!mounted) return null;
	return (
		<div className={expanded ? (className ?? "") : ""} hidden={!expanded}>
			{children}
		</div>
	);
}

/** Keeps focus inside the rows when a re-render replaces the focused row (upstream's `te`). */
class FocusKeeper extends Component<{children: ReactNode}> {
	rows = createRef<HTMLDivElement>();

	override getSnapshotBeforeUpdate(): number | null {
		const rows = this.rows.current;
		const active = rows?.ownerDocument.activeElement ?? null;
		if (!rows || active === null || !rows.contains(active)) return null;
		return [...rows.querySelectorAll("a, button")].indexOf(active);
	}

	override componentDidUpdate(_props: unknown, _state: unknown, index: number | null): void {
		const rows = this.rows.current;
		if (!rows || index === null || index < 0) return;
		const active = rows.ownerDocument.activeElement;
		if (active !== null && active !== rows.ownerDocument.body) return;
		rows.querySelectorAll<HTMLElement>("a, button")[index]?.focus({preventScroll: true});
	}

	override render() {
		return (
			<div ref={this.rows} className="flex flex-col">
				{this.props.children}
			</div>
		);
	}
}

type ExpanderKey = "mcp" | "memory" | "agents";

interface ExpanderHandle {
	reveal: () => void;
}

interface ExpanderRow {
	name: string;
	tokens: number;
	href?: string;
}

/** Upstream's rail expander (`ie`): a toggle with the row count, then the rows, scrolling past 12. */
function Expander({label, rows, ref}: {label: string; rows: readonly ExpanderRow[]; ref?: Ref<ExpanderHandle>}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const toggle = useRef<HTMLButtonElement>(null);
	useImperativeHandle(ref, () => ({
		reveal: () => {
			flushSync(() => {
				setOpen(true);
			});
			root.current?.scrollIntoView({block: "nearest"});
			toggle.current?.focus({preventScroll: true});
		},
	}));
	return (
		<div ref={root} className="flex flex-col">
			<button
				ref={toggle}
				type="button"
				className={TOGGLE_CLASS}
				aria-expanded={open}
				onClick={() => {
					setOpen((value) => !value);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && event.repeat) event.preventDefault();
				}}
			>
				<span className={LEAD_CLASS}>
					<ChevronRight
						aria-hidden
						className={`size-3 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
					/>
				</span>
				<span className="min-w-0 flex-1 truncate text-secondary">{label}</span>
				<span className={`${PCT_CLASS} text-ink-muted`}>{COUNT.format(rows.length)}</span>
			</button>
			<Collapse expanded={open}>
				<div
					className={`flex flex-col ${rows.length > EXPANDER_SCROLL_AFTER ? "max-h-60 overflow-y-auto overscroll-contain" : ""}`}
				>
					{rows.map((row, i) => (
						<div key={`${row.name}-${i}`} className={EXPANDER_ROW_CLASS}>
							<span aria-hidden className="w-3 shrink-0" />
							{row.href === undefined ? (
								<span className="min-w-0 flex-1 truncate text-ink-muted">{row.name}</span>
							) : (
								<a
									href={row.href}
									className="min-w-0 flex-1 truncate text-start text-ink-muted underline-offset-[3px] outline-none hover:text-primary hover:underline focus-visible:shadow-focus rounded"
								>
									{row.name}
								</a>
							)}
							<span className="shrink-0 tabular-nums text-ink-muted">{formatTokenCount(row.tokens)}</span>
							<span aria-hidden className="w-11 shrink-0" />
						</div>
					))}
				</div>
			</Collapse>
		</div>
	);
}

/** The in-app route of an auto-memory file under `~/.claude/projects/<project>/memory/`, else undefined. */
function memoryFileHref(path: string, homeRoot: string): string | undefined {
	const prefix = `${homeRoot}/.claude/projects/`;
	if (!path.startsWith(prefix)) return undefined;
	const match = /^([^/]+)\/memory\/([^/]+\.md)$/.exec(path.slice(prefix.length));
	if (!match) return undefined;
	const [, project = "", filename = ""] = match;
	return `/memory/${encodeURIComponent(project)}/${encodeURIComponent(toMdSlug(filename))}`;
}

/** `mcp__github__get_me` from server `github` → `github · get_me`. */
function mcpToolName(tool: ContextBreakdown["mcpTools"][number]): string {
	const prefix = `mcp__${tool.serverName}__`;
	return `${tool.serverName} · ${tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name}`;
}

function expanders(b: ContextBreakdown, homeRoot: string): {key: ExpanderKey; label: string; rows: ExpanderRow[]}[] {
	return [
		...(b.mcpTools.length > 0
			? [
					{
						key: "mcp" as const,
						label: "MCP tools",
						rows: b.mcpTools.map((t) => ({name: mcpToolName(t), tokens: t.tokens})),
					},
				]
			: []),
		...(b.memoryFiles.length > 0
			? [
					{
						key: "memory" as const,
						label: "Memory files",
						rows: b.memoryFiles.map((file) => {
							const href = memoryFileHref(file.path, homeRoot);
							return {name: file.path, tokens: file.tokens, ...(href === undefined ? {} : {href})};
						}),
					},
				]
			: []),
		...(b.agents.length > 0
			? [
					{
						key: "agents" as const,
						label: "Custom agents",
						rows: b.agents.map((a) => ({name: a.agentType, tokens: a.tokens})),
					},
				]
			: []),
	];
}

type RowAction = {hint: string; to: "/customize/skills"} | {hint: string; reveals: ExpanderKey};

/** The local analogue of upstream's `host.actionOf(category)`. */
function actionOf(row: ContextLegendRow, available: ReadonlySet<ExpanderKey>): RowAction | null {
	if (row.kind === "deferred") return null;
	if (row.name === "Skills") return {hint: "Manage skills", to: "/customize/skills"};
	if (row.name === "Memory files" && available.has("memory")) return {hint: "Edit memory files", reveals: "memory"};
	if (row.name === "Custom agents" && available.has("agents")) return {hint: "View custom agents", reveals: "agents"};
	return null;
}

/** Upstream's legend row (`ne`): swatch, name, compact tokens and percent of the window. */
function LegendRow({
	row,
	rawMaxTokens,
	meterCategories,
	action,
	onReveal,
}: {
	row: ContextLegendRow;
	rawMaxTokens: number;
	meterCategories: readonly ContextMeterCategory[];
	action: RowAction | null;
	onReveal: (key: ExpanderKey) => void;
}) {
	const deferred = row.kind === "deferred";
	const color = row.meterSeries === null ? (row.color ?? "") : seriesColor(row.meterSeries, meterCategories);
	const cells = (
		<>
			<span className={LEAD_CLASS}>
				<Swatch color={color} />
			</span>
			<span
				className={`min-w-0 flex-1 truncate ${deferred ? "text-ink-muted" : "text-secondary"}${action ? ` ${ACTION_NAME_CLASS}` : ""}`}
			>
				{row.name}
			</span>
			<span className={`shrink-0 tabular-nums text-ink-muted${action ? ` ${ACTION_TOKENS_CLASS}` : ""}`}>
				{formatTokenCount(row.tokens)}
			</span>
			<span className={`${PCT_CLASS} ${deferred ? "text-ink-muted" : "text-primary"}`}>
				{deferred || rawMaxTokens <= 0 ? "—" : PERCENT.format(row.tokens / rawMaxTokens)}
			</span>
		</>
	);
	if (action === null) {
		return (
			<div data-rail-context-row="" className={ROW_CLASS}>
				{cells}
			</div>
		);
	}
	const hint = <span className="sr-only">{action.hint}</span>;
	if ("to" in action) {
		return (
			<Link data-rail-context-row="" to={action.to} className={ACTION_ROW_CLASS}>
				{cells}
				{hint}
			</Link>
		);
	}
	return (
		<button
			type="button"
			data-rail-context-row=""
			className={ACTION_ROW_CLASS}
			onClick={() => {
				onReveal(action.reveals);
			}}
		>
			{cells}
			{hint}
		</button>
	);
}

/** Rows that share a name keep distinct keys (upstream's `L`). */
function keyed(rows: readonly ContextLegendRow[]): {key: string; row: ContextLegendRow}[] {
	const seen = new Map<string, number>();
	return rows.map((row) => {
		const n = seen.get(row.name) ?? 0;
		seen.set(row.name, n + 1);
		return {key: `${row.name}#${n}`, row};
	});
}

/** The rail Context card's breakdown body: headline and stacked meter, then legend, deferred rows and expanders. */
export function ContextBreakdownBody({
	breakdown,
	liveTokens,
	homeRoot,
}: {
	breakdown: ContextBreakdown;
	liveTokens: number | null;
	homeRoot: string;
}) {
	const {legend, meterCategories, meterValues, barTotal, usedTokens, usedPct} = buildContextLegend(
		breakdown,
		liveTokens,
	);
	const expanderRefs = {
		memory: useRef<ExpanderHandle>(null),
		agents: useRef<ExpanderHandle>(null),
	};
	const lists = expanders(breakdown, homeRoot);
	const available = new Set(lists.map((list) => list.key));
	const reveal = (key: ExpanderKey) => {
		if (key !== "mcp") expanderRefs[key].current?.reveal();
	};
	const rounded = Math.min(100, Math.round(usedPct));
	const renderRows = (rows: readonly ContextLegendRow[]) =>
		keyed(rows).map(({key, row}) => (
			<LegendRow
				key={key}
				row={row}
				rawMaxTokens={breakdown.rawMaxTokens}
				meterCategories={meterCategories}
				action={actionOf(row, available)}
				onReveal={reveal}
			/>
		));
	const plain = legend.filter((row) => row.kind !== "deferred");
	const deferred = legend.filter((row) => row.kind === "deferred");
	return (
		<div className="flex flex-col">
			<div className="flex flex-col gap-1 px-1 pt-1 pb-1.5">
				<div className="flex min-w-0 items-baseline justify-between gap-2 text-[13px]/[19px]">
					<span className="shrink-0 text-primary tabular-nums">{rounded}% used</span>
					<span
						data-rail-context-summary=""
						data-rail-context-pct={rounded}
						className="min-w-0 truncate text-[12px]/[15px] text-ink-muted tabular-nums"
					>
						{formatTokenCount(usedTokens)} / {formatTokenCount(breakdown.rawMaxTokens)}
					</span>
				</div>
				<StackedMeter categories={meterCategories} values={meterValues} total={barTotal} />
			</div>
			<div className="flow-root">
				<div className="flex flex-col gap-1.5 pb-1.5">
					{plain.length > 0 && <FocusKeeper>{renderRows(plain)}</FocusKeeper>}
					{deferred.length > 0 && <div className="flex flex-col">{renderRows(deferred)}</div>}
					{lists.length > 0 && (
						<div className="flex flex-col">
							{lists.map((list) => (
								<Expander
									key={list.key}
									{...(list.key === "mcp" ? {} : {ref: expanderRefs[list.key]})}
									label={list.label}
									rows={list.rows}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
