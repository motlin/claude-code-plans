import {useQuery} from "@tanstack/react-query";
import {useId, useState} from "react";

import {homeStatsQueryOptions} from "../../lib/api/home-stats";
import {
	computeHomeStats,
	formatPeakHour,
	formatTokenCount,
	HOME_STATS_RANGE_LABELS,
	HOME_STATS_RANGES,
	type HomeStats,
	type HomeStatsDay,
	type HomeStatsHeatmapCell,
	type HomeStatsRange,
} from "../../lib/home-stats";
import {formatModelName} from "../../lib/model-name";
import {SegmentedControl} from "../settings/segmented-control";

const STATS_VIEWS = ["overview", "models"] as const;
type StatsView = (typeof STATS_VIEWS)[number];

const STATS_VIEW_LABELS = {
	overview: "Overview",
	models: "Models",
} as const satisfies Record<StatsView, string>;

const RANGE_OPTIONS = HOME_STATS_RANGES.map((value) => ({
	value,
	label: HOME_STATS_RANGE_LABELS[value],
}));

const DASH = "—";

const NUMBER = new Intl.NumberFormat("en-US");

const PERCENT = new Intl.NumberFormat("en-US", {
	style: "percent",
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

function modelLabel(model: string | null): string {
	return formatModelName(model) ?? model ?? DASH;
}

function Tile({label, value}: Readonly<{label: string; value: string}>) {
	return (
		<div
			role="group"
			aria-label={label}
			className="flex h-11 min-w-0 flex-col justify-center rounded-lg bg-alpha-1 px-3"
		>
			<span data-tile-label className="truncate text-[12px] leading-[15px] text-ink-muted">
				{label}
			</span>
			<span data-tile-value className="truncate text-[13px] leading-[19px] text-primary tabular-nums">
				{value}
			</span>
		</div>
	);
}

const HEATMAP_HEIGHT = 120;
const HEATMAP_GAP = 3;
const HEATMAP_CELL = (HEATMAP_HEIGHT - 6 * HEATMAP_GAP) / 7;

function heatLevel(value: number, max: number): number {
	if (value <= 0 || max <= 0) return 0;
	return Math.min(4, Math.ceil((value / max) * 4));
}

const HEAT_OPACITY = [0, 0.25, 0.45, 0.7, 1] as const;

/** Upstream's "Daily activity heatmap": one column per week, Sunday on top. */
function Heatmap({cells}: Readonly<{cells: readonly HomeStatsHeatmapCell[]}>) {
	const first = cells[0];
	const leading = first === undefined ? 0 : new Date(`${first.date}T00:00:00Z`).getUTCDay();
	const max = cells.reduce((best, cell) => Math.max(best, cell.value), 0);
	const slots: Array<HomeStatsHeatmapCell | null> = [...Array.from({length: leading}, () => null), ...cells];

	return (
		<div
			role="img"
			aria-label="Daily activity heatmap"
			className="grid w-full grid-flow-col justify-start overflow-hidden"
			style={{
				height: `${HEATMAP_HEIGHT}px`,
				gap: `${HEATMAP_GAP}px`,
				gridTemplateRows: `repeat(7, ${HEATMAP_CELL}px)`,
				gridAutoColumns: `${HEATMAP_CELL}px`,
			}}
		>
			{slots.map((cell, index) =>
				cell === null ? (
					<span key={`pad-${index}`} />
				) : (
					<span
						key={cell.date}
						data-date={cell.date}
						title={`${cell.date}: ${NUMBER.format(cell.value)} messages`}
						className="rounded-r3 bg-alpha-1"
						style={
							heatLevel(cell.value, max) === 0
								? undefined
								: {
										backgroundColor: "var(--color-clay, #d97757)",
										opacity: HEAT_OPACITY[heatLevel(cell.value, max)],
									}
						}
					/>
				),
			)}
		</div>
	);
}

function OverviewPanel({stats}: Readonly<{stats: HomeStats}>) {
	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-3 gap-1">
				<Tile label="Sessions" value={NUMBER.format(stats.sessions)} />
				<Tile label="Messages" value={NUMBER.format(stats.messages)} />
				<Tile
					label="Total tokens"
					value={stats.totalTokens === null ? DASH : formatTokenCount(stats.totalTokens)}
				/>
				<Tile label="Active days" value={NUMBER.format(stats.activeDays)} />
				<Tile label="Peak hour" value={stats.peakHour === null ? DASH : formatPeakHour(stats.peakHour)} />
				<Tile label="Favorite model" value={modelLabel(stats.favoriteModel)} />
			</div>
			<Heatmap cells={stats.heatmap} />
		</div>
	);
}

function ModelsPanel({stats}: Readonly<{stats: HomeStats}>) {
	if (stats.models.length === 0) {
		return <p className="text-[13px] leading-[19px] text-ink-muted">No token usage recorded.</p>;
	}
	return (
		<ul aria-label="Models" className="flex flex-col gap-1">
			{stats.models.map((row) => (
				<li
					key={row.model}
					className="relative flex h-10 items-center gap-2 overflow-hidden rounded-lg bg-alpha-1 px-3"
				>
					<span
						aria-hidden="true"
						className="absolute inset-y-0 left-0 bg-alpha-2"
						style={{width: `${row.share * 100}%`}}
					/>
					<span className="relative min-w-0 flex-1 truncate text-[13px] leading-[19px] text-primary">
						{modelLabel(row.model)}
					</span>
					<span className="relative text-[12px] leading-[15px] text-ink-muted tabular-nums">
						{formatTokenCount(row.tokens)} tokens
					</span>
					<span className="relative min-w-12 text-right text-[12px] leading-[15px] text-ink-muted tabular-nums">
						{PERCENT.format(row.share)}
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * The usage stats card claude.ai/code shows on an empty home: Overview | Models,
 * All | 30d | 7d, six tiles and a daily activity heatmap.
 */
export function HomeStatsCard({days, today}: Readonly<{days: readonly HomeStatsDay[]; today: string}>) {
	const id = useId();
	const [view, setView] = useState<StatsView>("overview");
	const [range, setRange] = useState<HomeStatsRange>("all");
	const stats = computeHomeStats(days, range, today);
	const panelId = `${id}-panel`;

	return (
		<section
			aria-label="Usage stats"
			className="flex flex-col gap-4 rounded-xl bg-surface-0 p-4 shadow-[inset_0_0_0_1px_var(--color-border)]"
		>
			<header className="flex items-center gap-2">
				<div role="tablist" aria-label="Stats view" className="flex items-center gap-1">
					{STATS_VIEWS.map((option) => (
						<button
							key={option}
							type="button"
							role="tab"
							id={`${id}-${option}`}
							aria-selected={view === option}
							aria-controls={panelId}
							onClick={() => setView(option)}
							className="h-7 rounded-md px-2 text-[13px] leading-[19px] text-ink-muted hover:bg-fill-ghost-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 aria-selected:bg-alpha-2 aria-selected:text-primary"
						>
							{STATS_VIEW_LABELS[option]}
						</button>
					))}
				</div>
				<div className="flex-1" />
				<SegmentedControl
					aria-label="Date range"
					value={range}
					onValueChange={setRange}
					options={RANGE_OPTIONS}
				/>
			</header>
			<div role="tabpanel" id={panelId} aria-labelledby={`${id}-${view}`}>
				{view === "overview" ? <OverviewPanel stats={stats} /> : <ModelsPanel stats={stats} />}
			</div>
		</section>
	);
}

/** The card fed by /api/home-stats, with upstream's loading and error states. */
export function HomeStatsSection() {
	const {data, isError} = useQuery(homeStatsQueryOptions);

	return (
		<div className="py-6" aria-busy={data === undefined && !isError}>
			{isError ? (
				<p className="text-[13px] leading-[19px] text-ink-muted">Couldn’t load usage stats</p>
			) : data === undefined ? (
				<div className="h-[260px] animate-pulse rounded-xl bg-alpha-1" />
			) : (
				<HomeStatsCard days={data.days} today={data.today} />
			)}
		</div>
	);
}
