import {useQuery} from "@tanstack/react-query";
import {RefreshCw} from "lucide-react";
import {useId} from "react";
import {localAccountQueryOptions} from "../../lib/api/local-account";
import {usageQueryOptions} from "../../lib/api/usage";
import {formatUpdatedAgo} from "../../lib/composer-state";
import {
	formatLimitCaption,
	meterPercent,
	paceHeadline,
	usageVariant,
	type UsageSummary,
	type UsageVariant,
	type UsageWindow,
} from "../../lib/usage";
import {SettingsSection} from "./settings-row";

/*
 * Settings ▸ Usage, copied from claude.ai/code's usage page: "Your usage" and
 * the plan, then one settings section holding the pace headline item and the
 * meters item (split by the section's hairline, no dividers between rows),
 * one row per rate-limit window with a 4px meter tinted by severity (upstream's `wV`). The
 * windows come from the newest local statusline snapshot.
 */

/** Upstream's cds Meter track (`bg-<variant>`) and fill (`bg-fill-<variant>`) per variant. */
const TRACK_CLASS = {
	accent: "bg-accent-900",
	warning: "bg-usage-track-warning",
	danger: "bg-usage-track-danger",
} as const satisfies Record<UsageVariant, string>;

const FILL_CLASS = {
	accent: "bg-accent-100",
	warning: "bg-usage-warning",
	danger: "bg-usage-danger",
} as const satisfies Record<UsageVariant, string>;

function UsageMeter({
	percent,
	variant,
	used,
	labelId,
}: {
	percent: number;
	variant: UsageVariant;
	used: string;
	labelId: string;
}) {
	return (
		<div
			role="meter"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			aria-valuetext={used}
			aria-labelledby={labelId}
			className={`relative h-1 w-full overflow-hidden rounded-full shadow-[inset_0_0_0_1px_var(--color-alpha-1)] ${percent === 0 ? "bg-alpha-1" : TRACK_CLASS[variant]}`}
		>
			{percent === 0 ? null : (
				<div
					data-usage-bar-fill=""
					className={`h-full w-full rounded-full ${FILL_CLASS[variant]} transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none rtl:[--_meter-dir:1]`}
					style={{
						transform: `translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(${percent}%, 4px)))))`,
					}}
				/>
			)}
		</div>
	);
}

function UsageMeterRow({
	label,
	caption,
	window,
	dimmed = false,
}: {
	label: string;
	caption: string;
	window: UsageWindow;
	/** Upstream's paused session row: secondary label and a half-opacity meter. */
	dimmed?: boolean;
}) {
	const labelId = useId();
	const percent = meterPercent(window.usedPct);
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
					<UsageMeter percent={percent} variant={variant} used={used} labelId={labelId} />
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

interface UsagePanelProps {
	usage: UsageSummary;
	planDetail?: string | undefined;
	nowMs: number;
	/** IANA zone for reset times; the viewer's own zone when omitted. */
	timeZone?: string | undefined;
	refreshing: boolean;
	onRefresh: () => void;
}

export function UsagePanel({usage, planDetail, nowMs, timeZone, refreshing, onRefresh}: UsagePanelProps) {
	const headline = paceHeadline(usage, nowMs, timeZone);
	// Upstream's `sessionPaused`: the week is hit (usage credits never apply locally).
	const sessionPaused = usage.sevenDay !== null && usage.sevenDay.usedPct >= 100;

	return (
		<div className="flex flex-col">
			<div data-testid="usage-page-pace" className="flex flex-col pb-6">
				<div className="mb-3 flex items-baseline gap-2">
					<h2 className="text-[15px] leading-[20px] font-[580] text-primary">Your usage</h2>
					{planDetail === undefined ? null : (
						<span className="whitespace-nowrap text-footnote text-secondary">{planDetail}</span>
					)}
				</div>
				<SettingsSection>
					{headline === null ? null : (
						<div data-settings-item="" className="flex flex-col items-start gap-3 py-3">
							<p className="text-[22px] leading-[28px] font-[580] text-primary">{headline}</p>
						</div>
					)}
					{usage.fiveHour === null && usage.sevenDay === null ? (
						<div data-settings-item="" className="py-3">
							<p className="text-body text-secondary">
								Usage appears after a Claude Code session reports its status line
							</p>
						</div>
					) : (
						<div data-settings-item="" className="flex flex-col gap-5 py-3">
							{usage.fiveHour === null ? null : (
								<UsageMeterRow
									label="Current session"
									caption={
										sessionPaused
											? "Paused until your week resets"
											: formatLimitCaption(usage.fiveHour.resetsAt, nowMs, "short", timeZone)
									}
									window={usage.fiveHour}
									dimmed={sessionPaused}
								/>
							)}
							{usage.sevenDay === null ? null : (
								<UsageMeterRow
									label="This week"
									caption={formatLimitCaption(usage.sevenDay.resetsAt, nowMs, "long", timeZone)}
									window={usage.sevenDay}
								/>
							)}
						</div>
					)}
				</SettingsSection>
			</div>

			<div className="mt-4 flex items-center gap-2 text-footnote text-secondary">
				{usage.updatedAt === null ? null : (
					<span>Last updated: {formatUpdatedAgo(usage.updatedAt, nowMs)}</span>
				)}
				<button
					type="button"
					aria-label="Refresh usage"
					title="Refresh usage"
					disabled={refreshing}
					onClick={onRefresh}
					className="inline-flex size-6 items-center justify-center rounded-md hover:bg-alpha-1 disabled:opacity-50"
				>
					<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
				</button>
			</div>
		</div>
	);
}

export function UsageSettings() {
	const usageQuery = useQuery(usageQueryOptions);
	const {data: account} = useQuery(localAccountQueryOptions);

	if (usageQuery.data === undefined) {
		return usageQuery.isError ? <p className="text-body text-secondary">Usage could not be loaded.</p> : null;
	}

	return (
		<UsagePanel
			usage={usageQuery.data}
			planDetail={account?.planDetail}
			nowMs={usageQuery.dataUpdatedAt}
			refreshing={usageQuery.isFetching}
			onRefresh={() => void usageQuery.refetch()}
		/>
	);
}
