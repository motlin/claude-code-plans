import {useQuery} from "@tanstack/react-query";
import {Gauge, X} from "lucide-react";
import {usageQueryOptions} from "../lib/api/usage";
import {formatPaceBannerReset, limitReached, meterPercent, usageBand} from "../lib/usage";
import {useUsageBandDismissals, writeUsageBandDismissal} from "../lib/usage-pace-dismissal";

/**
 * Upstream's band shell (`uc`): an icon slot, a wrapping body whose words put the headline and
 * detail on one baseline 10px apart (the detail wrapping under it on a narrow dock), and an
 * optional Dismiss slot. Live region `polite`, centred on the first line via `1lh`.
 */
function UsageBandShell({headline, detail, onDismiss}: {headline: string; detail: string; onDismiss?: () => void}) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-body usage-band-enter"
		>
			<span className="flex h-[1lh] shrink-0 items-center">
				<Gauge className="size-4 text-ink-muted" aria-hidden="true" />
			</span>
			<div className="flex min-w-0 flex-1 flex-wrap gap-x-[8px] gap-y-[8px] items-start">
				<div className="min-w-0 max-w-full flex-auto">
					<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75">
						<span className="min-w-0 text-primary">{headline}</span>
						<span className="min-w-0 text-ink-muted">{detail}</span>
					</div>
				</div>
			</div>
			{onDismiss !== undefined && (
				<span className="ms-1.25 flex h-[1lh] shrink-0 items-center">
					<button
						type="button"
						aria-label="Dismiss"
						onClick={onDismiss}
						className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-alpha-1 hover:text-primary cursor-pointer"
					>
						<X className="size-3.5" aria-hidden="true" />
					</button>
				</span>
			)}
		</div>
	);
}

/**
 * claude.ai/code's dismissible usage band between the dock card and the composer: the headline
 * ("On pace to hit your weekly limit early", "Approaching weekly usage limit", …), the used
 * percent (on-pace only) and reset time, and a Dismiss ×.
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
		<UsageBandShell
			headline={headline}
			detail={usedPct === undefined ? resetText : `${meterPercent(usedPct)}% used · ${resetText}`}
			onDismiss={onDismiss}
		/>
	);
}

/** Upstream's composer band once a limit is reached: the limit, a nudge, and its reset. It cannot be dismissed. */
export function UsageLimitBand({headline, resetText}: {headline: string; resetText: string}) {
	return <UsageBandShell headline={headline} detail={`· Get more usage to keep working · ${resetText}`} />;
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
