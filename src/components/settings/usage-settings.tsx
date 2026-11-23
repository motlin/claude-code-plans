import {useQuery} from "@tanstack/react-query";
import {RefreshCw} from "lucide-react";
import {type ReactNode, useId, useState} from "react";
import {composerDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import {localAccountQueryOptions} from "../../lib/api/local-account";
import {usageQueryOptions} from "../../lib/api/usage";
import
{
	formatLimitCaption,
	formatUsageUpdated,
	matchesModelFamily,
	meterPercent,
	paceHeadline,
	type ScopedUsage,
	scopedModelName,
	type UsageLimit,
	usageVariant,
	type UsageSummary,
	type UsageVariant,
	type UsageWindow,
	type WeeklyShare,
	weeklyScopedShares,
} from "../../lib/usage";
import {ExternalTextLink} from "../external-text-link";
import {USAGE_BARS_CROSSFADE} from "../../lib/usage-bars-grow";
import {UsageBars} from "../usage-bars";
import {UsageMeter} from "../usage-limit-row";
import * as Collapsible from "../ui/collapsible";
import {Icon} from "../ui/icon";
import {Skeleton} from "../ui/skeleton";
import {Tooltip} from "../ui/tooltip";
import {SettingsSection} from "./settings-row";

/*
 * Settings ▸ Usage, copied from claude.ai/code's usage page: "Your usage" and
 * the plan, then one settings section holding the pace headline item and the
 * meters item (split by the section's hairline, no dividers between rows),
 * one row per rate-limit window with a 4px meter tinted by severity (upstream's `wV`). The
 * windows come from the newest local statusline snapshot. The h2 and the pace
 * headline h3 are both upstream's `text-heading-semibold` group titles at the
 * comfortable 15/20 the other local settings headers use (default density is 14/18).
 */

/** Upstream's `Ei`: the usage-limits support article. */
const USAGE_LIMITS_ARTICLE = "https://support.claude.com/en/articles/11647753-understanding-usage-and-length-limits";

/** Upstream's meter share overlay colours: blue-300, yellow-150 (dark yellow-100), red-300. */
const SHARE_CLASS =
{
	accent: "bg-usage-share-accent",
	warning: "bg-usage-share-warning",
	danger: "bg-usage-share-danger",
} as const satisfies Record<UsageVariant, string>;

/** Upstream's `"share"` meter tone: the whole fill is a model's share of the week. */
type MeterTone = "share";

/**
 * Upstream's `ze`: the shared cds Meter at size sm, with the share span drawn over the fill from the
 * inline start.
 */
function ShareMeter({
	percent,
	variant,
	used,
	labelId,
	share = 0,
	tone,
}: {
	percent: number;
	variant: UsageVariant;
	used: string;
	labelId: string;
	/** The week's percent spent by model-scoped shares, painted over the fill from the inline start. */
	share?: number;
	tone?: MeterTone | undefined;
})
{
	// Upstream's share span: as wide as the fill on a share-toned meter, else the share capped by the fill.
	const shareWidth = tone === "share" ? percent : Math.min(share, percent);
	return (
		<UsageMeter percent={percent} variant={variant} size="sm" labelledBy={labelId} valueText={used}>
			{percent > 0 && shareWidth > 0 ? (
				<span
					aria-hidden="true"
					data-testid="usage-meter-share"
					// A warning or danger share-toned meter keeps the span transparent.
					data-share={variant === "accent" || tone !== "share" ? shareWidth : 0}
					data-usage-bar-fill=""
					className={`absolute inset-y-0 start-0 rounded-full data-[share=0]:opacity-0 ${SHARE_CLASS[variant]}`}
					style={
					{
						inlineSize: `${shareWidth}%`,
						minInlineSize: 4,
					}}
				/>
			) : null}
		</UsageMeter>
	);
}

function UsageMeterRow({
	label,
	caption,
	usedPct,
	dimmed = false,
	share,
	tone,
}: {
	label: ReactNode;
	caption: ReactNode;
	usedPct: number;
	/** Upstream's paused session row: secondary label and a half-opacity meter. */
	dimmed?: boolean;
	share?: number | undefined;
	tone?: MeterTone | undefined;
})
{
	const labelId = useId();
	const percent = meterPercent(usedPct);
	const variant = usageVariant(percent);
	const used = `${percent}% used`;
	return (
		<div data-usage-row="" className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-2">
			<div className="flex w-52 shrink-0 flex-col gap-1.5">
				<span className="inline-flex items-center gap-1.5">
					<span id={labelId} className={`text-body ${dimmed ? "text-secondary" : "text-primary"}`}>
						{label}
					</span>
				</span>
				<span className="text-footnote text-secondary">{caption}</span>
			</div>
			<div className="flex min-w-48 flex-1 items-center gap-3">
				<div className={dimmed ? "flex-1 opacity-50" : "flex-1"}>
					<ShareMeter
						percent={percent}
						variant={variant}
						used={used}
						labelId={labelId}
						{...(share !== undefined &&
						{
							share,
						})}
						tone={tone}
					/>
				</div>
				<span
					className={`min-w-20 whitespace-nowrap text-end text-footnote ${variant === "danger" && !dimmed ? "text-danger" : "text-secondary"}`}
				>
					{used}
				</span>
			</div>
		</div>
	);
}

/** A model-scoped weekly row and its slice of the week, if the cache carries one. */
interface ScopedRow
{
	key: string;
	name: string;
	limit: UsageLimit;
	share: WeeklyShare | undefined;
}

/** The cache's model-scoped weekly rows (upstream's `J` rows), each with its share (`Te`). */
function scopedRows(scoped: ScopedUsage | null): ScopedRow[]
{
	if (scoped === null) return [];
	const shares = new Map(
		weeklyScopedShares(scoped.limits, scoped.shares)?.shares.map((share) => [share.limitIndex, share]),
	);
	return scoped.limits.flatMap((limit, index) =>
	{
		const name = scopedModelName(limit);
		return name === undefined
			? []
			: [
					{
						key: `${limit.kind}-${index}`,
						name,
						limit,
						share: shares.get(index),
					},
				];
	});
}

/** A cached ISO reset as upstream's row caption, or "Starts with your first message" without one. */
function scopedReset(resetsAt: string | null, nowMs: number, timeZone: string | undefined): string
{
	return formatLimitCaption(resetsAt === null ? Number.NaN : Date.parse(resetsAt) / 1000, nowMs, "long", timeZone);
}

/**
 * Upstream's `Ei` "This week" fold: the week row's label toggles a panel of per-model rows. Open, the
 * week meter paints the models' summed shares over its fill; each nested row with a share is
 * share-toned. The open state is local and starts at `defaultOpen`.
 */
function WeekFold({
	week,
	rows,
	defaultOpen,
	nowMs,
	timeZone,
}: {
	week: UsageWindow;
	rows: ScopedRow[];
	defaultOpen: boolean;
	nowMs: number;
	timeZone: string | undefined;
})
{
	const [local, setLocal] = useState<boolean | null>(null);
	const open = local ?? defaultOpen;
	const shareUsed = rows.reduce((sum, row) => sum + (row.share?.used ?? 0), 0);
	return (
		<Collapsible.Root
			open={open}
			onOpenChange={setLocal}
			className="flex flex-col"
			data-testid="pace-week"
			data-state={open ? "open" : "closed"}
		>
			<UsageMeterRow
				label={
					<Collapsible.Trigger hideCaret className="text-body text-primary" data-testid="pace-week-toggle">
						This week
						<Icon
							name="CaretDown"
							size="sm"
							className={`text-secondary transition-transform motion-reduce:transition-none${open ? " rotate-180" : ""}`}
						/>
					</Collapsible.Trigger>
				}
				caption={formatLimitCaption(week.resetsAt, nowMs, "long", timeZone)}
				usedPct={week.usedPct}
				share={open ? shareUsed : 0}
			/>
			<Collapsible.Panel>
				<div data-testid="pace-week-scoped" className="flex flex-col gap-5 pt-4">
					{rows.map((row) => (
						<UsageMeterRow
							key={row.key}
							label={row.name}
							caption={
								<>
									{row.share === undefined ? null : (
										<span className="block">Up to {row.share.allowance}% of your weekly limit</span>
									)}
									<span className="block">{scopedReset(row.limit.resets_at, nowMs, timeZone)}</span>
								</>
							}
							usedPct={row.limit.percent}
							tone={row.share === undefined ? undefined : "share"}
						/>
					))}
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

/** Upstream's flat scoped row when there is no week to nest under: "Fable this week". */
function FlatScopedRow({row, nowMs, timeZone}: {row: ScopedRow; nowMs: number; timeZone: string | undefined})
{
	const reset = row.limit.resets_at === null ? null : Date.parse(row.limit.resets_at) / 1000;
	const resetLabel =
		reset === null || !(reset * 1000 > nowMs) ? null : formatLimitCaption(reset, nowMs, "long", timeZone);
	return (
		<UsageMeterRow
			label={`${row.name} this week`}
			caption={
				resetLabel === null
					? `Separate weekly limit for ${row.name}`
					: `Separate weekly limit for ${row.name} · ${resetLabel}`
			}
			usedPct={row.limit.percent}
		/>
	);
}

interface UsagePanelProps
{
	usage: UsageSummary;
	planDetail?: string | undefined;
	nowMs: number;
	/** IANA zone for reset times; the viewer's own zone when omitted. */
	timeZone?: string | undefined;
	refreshing: boolean;
	onRefresh: () => void;
	/** The default chat model; a scoped row of its family opens the "This week" fold (upstream `Ee`). */
	defaultModel?: string | null | undefined;
}

export function UsagePanel({usage, planDetail, nowMs, timeZone, refreshing, onRefresh, defaultModel}: UsagePanelProps)
{
	const headline = paceHeadline(usage, nowMs, timeZone);
	const scoped = scopedRows(usage.scoped);
	const foldOpen = scoped.some((row) => matchesModelFamily(row.limit, defaultModel));
	// Upstream's `sessionPaused`: the week is hit (usage credits never apply locally).
	const sessionPaused = usage.sevenDay !== null && usage.sevenDay.usedPct >= 100;

	return (
		<div className="flex flex-col">
			<UsageBars surface="usage_page" enabled={USAGE_BARS_CROSSFADE}>
				<div data-testid="usage-page-pace" className="flex flex-col pb-6">
					<div className="mb-3 flex items-baseline gap-2">
						<h2 data-settings-group-title="" className="text-[15px] leading-[20px] font-[580] text-primary">
							Your usage
						</h2>
						{planDetail === undefined ? null : (
							<span className="whitespace-nowrap text-footnote text-secondary">{planDetail}</span>
						)}
					</div>
					<SettingsSection>
						{headline === null ? null : (
							<div data-settings-item="" className="flex flex-col items-start gap-3 py-3">
								<h3
									data-settings-group-title=""
									className="text-[15px] leading-[20px] font-[580] text-primary"
								>
									{headline}
								</h3>
							</div>
						)}
						{usage.fiveHour === null && usage.sevenDay === null && scoped.length === 0 ? (
							<div data-settings-item="" className="py-3">
								<p className="text-body text-secondary">
									Usage appears after a Claude Code session reports its status line
								</p>
							</div>
						) : (
							<div data-settings-item="" className="flex flex-col gap-5 py-3">
								<div className="flex flex-col gap-5">
									{usage.fiveHour === null ? null : (
										<UsageMeterRow
											label="Current session"
											caption={
												sessionPaused
													? "Paused until your week resets"
													: formatLimitCaption(
															usage.fiveHour.resetsAt,
															nowMs,
															"short",
															timeZone,
														)
											}
											usedPct={usage.fiveHour.usedPct}
											dimmed={sessionPaused}
										/>
									)}
									{usage.sevenDay === null ? (
										scoped.map((row) => (
											<FlatScopedRow key={row.key} row={row} nowMs={nowMs} timeZone={timeZone} />
										))
									) : scoped.length > 0 ? (
										<WeekFold
											week={usage.sevenDay}
											rows={scoped}
											defaultOpen={foldOpen}
											nowMs={nowMs}
											timeZone={timeZone}
										/>
									) : (
										<UsageMeterRow
											label="This week"
											caption={formatLimitCaption(
												usage.sevenDay.resetsAt,
												nowMs,
												"long",
												timeZone,
											)}
											usedPct={usage.sevenDay.usedPct}
										/>
									)}
								</div>
							</div>
						)}
					</SettingsSection>
				</div>
			</UsageBars>

			{usage.updatedAt === null ? null : (
				<section className="mt-2">
					<div data-settings-item="" className="flex items-center justify-between py-3">
						<div className="flex items-center gap-2">
							<span className="text-footnote text-secondary">
								{formatUsageUpdated(usage.updatedAt, nowMs, timeZone)}
							</span>
							<Tooltip content="Refresh">
								<button
									type="button"
									aria-label="Refresh"
									aria-busy={refreshing || undefined}
									disabled={refreshing}
									onClick={onRefresh}
									className="inline-flex size-6 items-center justify-center rounded-md text-secondary hover:bg-alpha-1 disabled:opacity-50"
								>
									<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
								</button>
							</Tooltip>
						</div>
					</div>
				</section>
			)}
			<div className="flex flex-col items-start gap-2 text-footnote">
				<ExternalTextLink href={USAGE_LIMITS_ARTICLE} rel="noopener">
					Learn more about usage limits
				</ExternalTextLink>
			</div>
		</div>
	);
}

/** Upstream's `IO`: the usage page's first-load skeleton. */
function UsageSkeleton()
{
	return (
		<div data-testid="usage-page-skeleton" aria-busy="true">
			<div className="space-y-6 py-3">
				<Skeleton className="rounded mb-2 h-6 w-[180px]" />
				<div className="space-y-6">
					<Skeleton className="rounded h-5 w-[300px]" />
					<Skeleton className="rounded h-3 w-full" />
					<Skeleton className="rounded h-3 w-full" />
					<Skeleton className="rounded h-3 w-full" />
				</div>
			</div>
		</div>
	);
}

/** Upstream's cds Button `variant="secondary" size="xs"`. */
const TRY_AGAIN_CLASS =
	"inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-footnote text-primary bg-fill-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:bg-fill-secondary-hover disabled:opacity-50 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

function UsageError({retrying, onRetry}: {retrying: boolean; onRetry: () => void})
{
	return (
		<div className="flex flex-col items-start gap-2 text-footnote text-secondary">
			<p>Unable to load usage limits. Please try again later.</p>
			<button
				type="button"
				aria-busy={retrying || undefined}
				disabled={retrying}
				onClick={onRetry}
				className={TRY_AGAIN_CLASS}
			>
				Try again
			</button>
		</div>
	);
}

export function UsageSettings()
{
	const usageQuery = useQuery(usageQueryOptions);
	const {data: account} = useQuery(localAccountQueryOptions);
	const {data: defaults} = useQuery(composerDefaultsQueryOptions);

	if (usageQuery.data === undefined)
	{
		return usageQuery.isError ? (
			<UsageError retrying={usageQuery.isFetching} onRetry={() => void usageQuery.refetch()} />
		) : (
			<UsageSkeleton />
		);
	}

	return (
		<UsagePanel
			usage={usageQuery.data}
			planDetail={account?.planDetail}
			nowMs={usageQuery.dataUpdatedAt}
			refreshing={usageQuery.isFetching}
			onRefresh={() => void usageQuery.refetch()}
			defaultModel={defaults?.model}
		/>
	);
}
