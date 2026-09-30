import {useQuery} from "@tanstack/react-query";
import {Gauge, X} from "lucide-react";
import {usageQueryOptions} from "../lib/api/usage";
import {formatPaceBannerReset, meterPercent, shouldShowPaceBanner} from "../lib/usage";
import {usePaceBannerDismissedUntil, writePaceBannerDismissedUntil} from "../lib/usage-pace-dismissal";

/**
 * claude.ai/code's weekly pace band between the dock card and the composer: a gauge, "On pace to
 * hit your weekly limit early", the used percent and reset time, and a Dismiss ×.
 */
export function UsagePaceBand({
	usedPct,
	resetText,
	onDismiss,
}: {
	usedPct: number;
	resetText: string;
	onDismiss: () => void;
}) {
	return (
		<div
			role="status"
			className="flex min-h-[40px] items-center gap-[5px] rounded-r7 bg-alpha-1 p-[8px] text-[13px] leading-[19px]"
		>
			<Gauge className="size-4 shrink-0 text-secondary" aria-hidden="true" />
			<span className="text-primary">On pace to hit your weekly limit early</span>
			<span className="ml-1 min-w-0 truncate text-secondary">
				{meterPercent(usedPct)}% used · {resetText}
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

/** The band, shown while the statusline's weekly window is ahead of pace and not dismissed until its reset. */
export function UsagePaceBanner() {
	const {data: usage, dataUpdatedAt} = useQuery(usageQueryOptions);
	const dismissedUntil = usePaceBannerDismissedUntil();
	if (usage === undefined || usage.sevenDay === null) return null;
	if (!shouldShowPaceBanner(usage, dataUpdatedAt, dismissedUntil)) return null;
	const {usedPct, resetsAt} = usage.sevenDay;
	return (
		<UsagePaceBand
			usedPct={usedPct}
			resetText={formatPaceBannerReset(resetsAt)}
			onDismiss={() => writePaceBannerDismissedUntil(resetsAt)}
		/>
	);
}
