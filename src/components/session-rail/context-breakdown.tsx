import {Link} from "@tanstack/react-router";
import {ChevronRight} from "lucide-react";
import {
	Component,
	createRef,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
	type Ref,
	type RefObject,
} from "react";
import {flushSync} from "react-dom";

import {formatTokenCount} from "../../lib/composer-state";
import {
	buildContextLegend,
	type ContextBreakdown,
	type ContextLegendRow,
	type ContextMeterCategory,
} from "../../lib/context-breakdown";
import type {McpServerSummary} from "../../lib/api/customize";
import {toConnectorSlug} from "../../lib/customize/mcp-tool-permissions";
import {toMdSlug} from "../../lib/md-slug";
import {layoutStackedMeter, meterPercent} from "../../lib/stacked-meter-layout";
import {Tooltip, TooltipGroup} from "../ui/tooltip";

/* Upstream's rail Context breakdown (`I` with layout "rail"): a stacked meter, legend rows, deferred rows and expanders. */

const ROW_CLASS = "flex min-h-6 w-full min-w-0 items-center gap-2 px-1 text-[12px]/[15px]";
/** With a host (always, in the rail) upstream's expander rows are 24px (`K`) rather than `min-h-5`. */
const EXPANDER_ROW_CLASS = ROW_CLASS;
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
/** Upstream's `Z.rail.pressScroll`: the 2px pad keeps the rows' focus rings inside the scroller. */
const EXPANDER_SCROLL_CLASS = "-mx-0.5 max-h-73 scroll-py-0.5 overflow-y-auto overscroll-contain p-0.5";
const OVERFLOW_NAME_CLASS = "block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap flex-1";
/** The meter's thickness at size sm, and the width it lays out at before it is measured (upstream's rail). */
const METER_HEIGHT = 4;
const METER_INITIAL_WIDTH = 246;

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

/** The width of an element, tracked with a ResizeObserver; `initial` until it has laid out. */
function useMeasuredWidth(ref: RefObject<HTMLElement | null>, initial: number): number {
	const [width, setWidth] = useState(initial);
	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return undefined;
		const measure = () => {
			const measured = element.getBoundingClientRect().width;
			if (measured > 0) setWidth(measured);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [ref]);
	return width;
}

/** Whether a name's text is clipped, the only case its full-name tooltip opens (upstream's OverflowTooltip). */
function nameOverflows(anchor: HTMLElement): boolean {
	const name = anchor.querySelector("[data-rail-context-row-name]");
	return name !== null && name.scrollWidth > name.clientWidth;
}

/**
 * Upstream's StackedMeter (size sm): absolutely placed segments floored to 2px plus a 1px seam, a dot when the run
 * is narrower than the meter is tall, a tooltip per segment, and a multiline tooltip listing every series.
 */
function StackedMeter({
	categories,
	values,
	total,
}: {
	categories: readonly ContextMeterCategory[];
	values: Record<string, number>;
	total: number;
}) {
	const root = useRef<HTMLDivElement>(null);
	const width = useMeasuredWidth(root, METER_INITIAL_WIDTH);
	const series = categories
		.map((category) => {
			const tokens = values[category.id] ?? 0;
			return {category, tokens, share: tokens / total};
		})
		.filter((entry) => entry.share > 0);
	const lines = series.map(
		({category, tokens, share}) =>
			`${category.label}: ${formatTokenCount(tokens)}, ${ARIA_PERCENT.format(share * 100)}%`,
	);
	const layout = layoutStackedMeter(
		series.map((entry) => entry.share),
		width,
		METER_HEIGHT,
	);
	const paint = (index: number) => seriesColor(series[index]?.category.id ?? "", categories);
	const meter = (
		<div
			ref={root}
			role="img"
			aria-label={`Context window: ${lines.join("; ")}`}
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's meter is a focusable tooltip trigger that reads its series aloud
			tabIndex={0}
			className="relative w-full overflow-hidden forced-colors:outline forced-colors:outline-solid forced-colors:outline-[color:CanvasText] rounded-full outline-none focus-visible:outline-hidden focus-visible:shadow-focus shrink-0"
			style={{height: METER_HEIGHT, backgroundColor: "var(--chart-reference-tint)", containerType: "inline-size"}}
		>
			{layout.kind === "dot" && (
				<Tooltip portal content={lines[layout.index] ?? ""} className="absolute! inset-0">
					<div
						className="absolute inset-y-0 start-0 rounded-full forced-color-adjust-none"
						style={{width: METER_HEIGHT, backgroundColor: paint(layout.index)}}
					/>
				</Tooltip>
			)}
			{layout.kind === "segments" &&
				layout.segments.map((segment) => (
					<Tooltip
						key={series[segment.index]?.category.id ?? segment.index}
						portal
						content={lines[segment.index] ?? ""}
						className="absolute! inset-y-0"
						style={{
							insetInlineStart: `calc(${meterPercent(segment.start)}% + ${segment.seam}px)`,
							width: `calc(${meterPercent(segment.width)}% - ${segment.seam}px)`,
						}}
					>
						<div
							className="absolute inset-0 forced-color-adjust-none"
							style={{
								backgroundColor: paint(segment.index),
								borderStartStartRadius: segment.radiusStart,
								borderEndStartRadius: segment.radiusStart,
								borderStartEndRadius: segment.radiusEnd,
								borderEndEndRadius: segment.radiusEnd,
							}}
						/>
					</Tooltip>
				))}
		</div>
	);
	if (lines.length === 0) return meter;
	return (
		<TooltipGroup>
			<Tooltip multiline maxWidth="max-w-none" content={lines.join("\n")} className="block w-full">
				{meter}
			</Tooltip>
		</TooltipGroup>
	);
}

function Swatch({color}: {color: string}) {
	return (
		<span
			aria-hidden
			data-rail-context-swatch=""
			className="shrink-0 forced-color-adjust-none"
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

/**
 * Keeps focus inside the rows when a re-render removes the focused row (upstream's `re`): refocus the same node
 * when it survived, else the fallback (an expander's toggle).
 */
class FocusKeeper extends Component<{
	className: string;
	fallback?: RefObject<HTMLElement | null>;
	children: ReactNode;
}> {
	rows = createRef<HTMLDivElement>();

	override getSnapshotBeforeUpdate(): HTMLElement | null {
		const rows = this.rows.current;
		const active = rows?.ownerDocument.activeElement ?? null;
		if (!rows || !(active instanceof HTMLElement) || !rows.contains(active)) return null;
		return active;
	}

	override componentDidUpdate(_props: unknown, _state: unknown, focused: HTMLElement | null): void {
		const rows = this.rows.current;
		if (!rows || focused === null) return;
		const active = rows.ownerDocument.activeElement;
		if (active !== null && active !== rows.ownerDocument.body) return;
		if (focused.isConnected) focused.focus({preventScroll: true});
		else this.props.fallback?.current?.focus({preventScroll: false});
	}

	override render() {
		return (
			<div ref={this.rows} className={this.props.className}>
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
	/** Distinguishes rows that share a name (upstream keys by `id ?? name`). */
	id: string;
	name: string;
	tokens: number;
	href?: string;
	/** The connector page an MCP tool row opens (upstream's `mcpToolActionOf`). */
	connectorId?: string;
}

/** An expander row's name, clipped with a tooltip that shows the whole of it when it doesn't fit. */
function RowName({name, className = ""}: {name: string; className?: string}) {
	return (
		<span className={`flex min-w-0 flex-1 text-ink-muted${className}`}>
			<Tooltip portal content={name} side="right" openWhen={nameOverflows} className="min-w-0 flex-1">
				<span data-rail-context-row-name="" className={OVERFLOW_NAME_CLASS}>
					{name}
				</span>
			</Tooltip>
		</span>
	);
}

function ExpanderRowView({row}: {row: ExpanderRow}) {
	if (row.connectorId !== undefined) {
		return (
			<Tooltip content="Manage connector" className="flex w-full min-w-0">
				<Link
					to="/customize/connectors/id/$serverId"
					params={{serverId: toConnectorSlug(row.connectorId)}}
					className={`group/press relative text-start ${EXPANDER_ROW_CLASS} rounded focus-visible:outline-hidden focus-visible:shadow-focus hover:bg-fill-ghost-hover active:bg-alpha-2`}
				>
					<span aria-hidden className="w-3 shrink-0" />
					<RowName name={row.name} className={` ${ACTION_NAME_CLASS} ${ACTION_TOKENS_CLASS}`} />
					<span className={`shrink-0 tabular-nums text-ink-muted ${ACTION_TOKENS_CLASS}`}>
						{formatTokenCount(row.tokens)}
					</span>
					<span aria-hidden className="w-11 shrink-0" />
					<span className="sr-only">Manage connector</span>
				</Link>
			</Tooltip>
		);
	}
	return (
		<div className={EXPANDER_ROW_CLASS}>
			<span aria-hidden className="w-3 shrink-0" />
			{row.href === undefined ? (
				<RowName name={row.name} />
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
	);
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
			<Collapse expanded={open} className="flow-root">
				<FocusKeeper
					fallback={toggle}
					className={`flex flex-col${rows.length > EXPANDER_SCROLL_AFTER ? ` ${EXPANDER_SCROLL_CLASS}` : ""}`}
				>
					{rows.map((row) => (
						<ExpanderRowView key={row.id} row={row} />
					))}
				</FocusKeeper>
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

/** A tool's short name: the last non-empty `__` segment, leading underscores stripped (upstream's `Cs`). */
function mcpToolShortName(name: string): string {
	const segment = name.split("__").findLast((part) => part.length > 0) ?? name;
	return segment.replace(/^_+/, "");
}

/**
 * `mcp__github__get_me` from server `github` → `github · get_me`. A server the session can't manage reads with its
 * underscores as spaces (upstream's `ya`): `claude_ai_Claude_Docs` → `claude ai Claude Docs`.
 */
function mcpToolName(tool: ContextBreakdown["mcpTools"][number], server: McpServerSummary | undefined): string {
	return `${server?.name ?? tool.serverName.replace(/_+/g, " ")} · ${mcpToolShortName(tool.name)}`;
}

/** Upstream's row id `F(t)`: `mcp__server__name` unless the name is already prefixed. */
function mcpToolId(tool: ContextBreakdown["mcpTools"][number]): string {
	return tool.name.startsWith("mcp__") ? tool.name : `mcp__${tool.serverName}__${tool.name}`;
}

/** Ids made unique by suffixing repeats, so rows that share one keep distinct keys. */
function uniqueIds<T extends {id: string}>(rows: readonly T[]): T[] {
	const seen = new Map<string, number>();
	return rows.map((row) => {
		const n = seen.get(row.id) ?? 0;
		seen.set(row.id, n + 1);
		return n === 0 ? row : {...row, id: `${row.id}#${n}`};
	});
}

function expanders(
	b: ContextBreakdown,
	homeRoot: string,
	mcpServers: readonly McpServerSummary[],
): {key: ExpanderKey; label: string; rows: ExpanderRow[]}[] {
	return [
		...(b.mcpTools.length > 0
			? [
					{
						key: "mcp" as const,
						label: "MCP tools",
						rows: uniqueIds(
							b.mcpTools.map((t) => {
								const server = mcpServers.find((candidate) => candidate.name === t.serverName);
								return {
									id: mcpToolId(t),
									name: mcpToolName(t, server),
									tokens: t.tokens,
									...(server === undefined ? {} : {connectorId: server.id}),
								};
							}),
						),
					},
				]
			: []),
		...(b.memoryFiles.length > 0
			? [
					{
						key: "memory" as const,
						label: "Memory files",
						rows: uniqueIds(
							b.memoryFiles.map((file) => {
								const href = memoryFileHref(file.path, homeRoot);
								return {
									id: file.path,
									name: file.path,
									tokens: file.tokens,
									...(href === undefined ? {} : {href}),
								};
							}),
						),
					},
				]
			: []),
		...(b.agents.length > 0
			? [
					{
						key: "agents" as const,
						label: "Custom agents",
						rows: uniqueIds(b.agents.map((a) => ({id: a.agentType, name: a.agentType, tokens: a.tokens}))),
					},
				]
			: []),
	];
}

type RowAction =
	| {hint: string; to: "/customize/skills" | "/customize/connectors"}
	| {hint: string; reveals: ExpanderKey};

/** The local analogue of upstream's `host.actionOf(category)`. */
function actionOf(row: ContextLegendRow, available: ReadonlySet<ExpanderKey>): RowAction | null {
	if (row.kind === "deferred") return null;
	if (row.name === "Skills") return {hint: "Manage skills", to: "/customize/skills"};
	if (row.name === "MCP tools" || row.name === "MCP server instructions") {
		return {hint: "Manage connectors", to: "/customize/connectors"};
	}
	// Upstream says "Edit memory files" only when the row opens an editor; this one reveals the list.
	if (row.name === "Memory files" && available.has("memory")) return {hint: "View memory files", reveals: "memory"};
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
	return (
		<Tooltip content={action.hint} side="top" className="flex w-full min-w-0">
			{"to" in action ? (
				<Link data-rail-context-row="" to={action.to} className={ACTION_ROW_CLASS}>
					{cells}
					{hint}
				</Link>
			) : (
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
			)}
		</Tooltip>
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
	mcpServers,
}: {
	breakdown: ContextBreakdown;
	liveTokens: number | null;
	homeRoot: string;
	/** The connectors the session can manage; their MCP tool rows link to the connector page. */
	mcpServers: readonly McpServerSummary[];
}) {
	const {legend, meterCategories, meterValues, barTotal, usedTokens, usedPct} = buildContextLegend(
		breakdown,
		liveTokens,
	);
	const expanderRefs = {
		memory: useRef<ExpanderHandle>(null),
		agents: useRef<ExpanderHandle>(null),
	};
	const lists = expanders(breakdown, homeRoot, mcpServers);
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
					{plain.length > 0 && <FocusKeeper className="flex flex-col">{renderRows(plain)}</FocusKeeper>}
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
