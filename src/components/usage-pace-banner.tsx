import {useQuery} from "@tanstack/react-query";
import {Gauge, X} from "lucide-react";
import {usageQueryOptions} from "../lib/api/usage";
import {formatPaceBannerReset, limitReached, meterPercent, usageBand} from "../lib/usage";
import {useUsageBandDismissals, writeUsageBandDismissal} from "../lib/usage-pace-dismissal";

/**
 * claude.ai/code's dismissible usage band between the dock card and the composer: a gauge, the
 * headline ("On pace to hit your weekly limit early", "Approaching weekly usage limit", …), the
 * used percent (on-pace only) and reset time, wrapping below it on a narrow dock as upstream
 * does, and a Dismiss ×.
 */
export function UsagePaceBand({
	headline = "On pace to hit your weekly limit early",
	usedPct,
	resetText,
	onDismiss,
}: {
	headline?: string;
	usedPct?: number;
	resetText: string;
	onDismiss: () => void;
}) {
	return (
		<div
			role="status"
			className="flex min-h-[40px] items-center gap-[5px] rounded-r7 bg-alpha-1 p-[8px] text-[13px] leading-[19px]"
		>
			<Gauge className="size-4 shrink-0 text-secondary" aria-hidden="true" />
			<span className="flex min-w-0 flex-wrap gap-x-1">
				<span className="text-primary">{headline}</span>
				<span className="text-secondary dark:text-ink-muted">
					{usedPct === undefined ? resetText : `${meterPercent(usedPct)}% used · ${resetText}`}
				</span>
			</span>
			<button
				type="button"
				aria-label="Dismiss"
				onClick={onDismiss}
				className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-alpha-1 hover:text-primary cursor-pointer"
			>
				<X className="size-3.5" aria-hidden="true" />
			</button>
		</div>
	);
}

/** Upstream's composer band once a limit is reached: the limit, a nudge, and its reset. It cannot be dismissed. */
export function UsageLimitBand({headline, resetText}: {headline: string; resetText: string}) {
	return (
		<div
			role="status"
			className="flex min-h-[40px] items-center gap-[5px] rounded-r7 bg-alpha-1 p-[8px] text-[13px] leading-[19px]"
		>
			<Gauge className="size-4 shrink-0 text-secondary" aria-hidden="true" />
			<span className="flex min-w-0 flex-wrap gap-x-1">
				<span className="text-primary">{headline}</span>{" "}
				<span className="text-secondary dark:text-ink-muted">
					· Get more usage to keep working · {resetText}
				</span>
			</span>
		</div>
	);
}

/**
 * The band: the limit-reached band while the statusline reports a window spent before its reset,
 * else the approaching or on-pace band unless dismissed for its window's threshold and reset.
 */
export function UsagePaceBanner() {
	const {data: usage, dataUpdatedAt} = useQuery(usageQueryOptions);
	const dismissals = useUsageBandDismissals();
	if (usage === undefined) return null;
	const reached = limitReached(usage, dataUpdatedAt);
	if (reached !== null) {
		return (
			<UsageLimitBand
				headline={reached.headline}
				resetText={formatPaceBannerReset(reached.resetsAt, Date.now())}
			/>
		);
	}
	const band = usageBand(usage, dataUpdatedAt, dismissals);
	if (band === null) return null;
	const {window, resetsAt, threshold} = band;
	return (
		<UsagePaceBand
			headline={band.headline}
			{...(band.kind === "pace" ? {usedPct: band.usedPct} : {})}
			resetText={formatPaceBannerReset(resetsAt, Date.now())}
			onDismiss={() => {
				writeUsageBandDismissal(window, {validUntil: resetsAt, threshold});
			}}
		/>
	);
}
