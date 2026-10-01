import {Check, Copy} from "lucide-react";
import {useEffect, useId, useMemo, useState} from "react";

import {writeClipboardText} from "../lib/clipboard";
import {formatUsd} from "../lib/session-cost";
import {
	aggregateSessionUsage,
	formatCacheHit,
	formatUsageReport,
	type UsageLimits,
	usageBreakdownRows,
	usageLimitRows,
} from "../lib/session-usage-breakdown";
import {Tooltip} from "./ui/tooltip";
import {UsageLimitRow} from "./usage-limit-row";

const ROW_CLASS = "flex items-baseline justify-between gap-2 border-b border-alpha-2 py-1";

/**
 * Upstream's transcript Usage card, inserted by the usage popover's "See
 * detailed breakdown": plan limits, then this session's cost and cache hit
 * rate, then each model's token breakdown, computed from the JSONL `usage`.
 */
export function SessionUsageCard({records, limits}: {records: readonly unknown[]; limits: UsageLimits | null}) {
	const titleId = useId();
	const breakdown = useMemo(() => aggregateSessionUsage(records), [records]);
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	const copyReport = async () => {
		if (await writeClipboardText(formatUsageReport(breakdown, limits, Date.now()))) setCopied(true);
	};
	const limitRows = usageLimitRows(limits);
	const cost = formatUsd(breakdown.costUSD);
	return (
		<section
			aria-labelledby={titleId}
			data-usage-card
			className="my-3 flex w-[360px] max-w-full flex-col gap-3 rounded-r6 bg-surface-3 px-4 pt-3 pb-4 text-[12px]/[16px] text-primary ring-1 ring-alpha-2"
		>
			<div className="flex items-center justify-between gap-2">
				<h3 id={titleId} className="font-medium">
					Usage
				</h3>
				<Tooltip content={copied ? "Copied" : "Copy report"} side="top">
					<button
						type="button"
						aria-label="Copy report"
						onClick={() => void copyReport()}
						className="flex size-6 items-center justify-center rounded-r5 text-secondary outline-none hover:bg-fill-ghost-hover hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)]"
					>
						{copied ? (
							<Check aria-hidden="true" className="size-3.5" />
						) : (
							<Copy aria-hidden="true" className="size-3.5" />
						)}
					</button>
				</Tooltip>
			</div>
			{limitRows.length > 0 && (
				<div className="flex flex-col gap-2">
					{limitRows.map((limit) => (
						<UsageLimitRow key={limit.label} label={limit.label} window={limit.window} />
					))}
				</div>
			)}
			<div className="flex flex-col gap-1">
				<span className="font-medium">This session</span>
				<div className="flex gap-6 border-b border-alpha-2 pb-1">
					<span data-usage-session-stat="cost" className="flex gap-1">
						<span className="text-secondary">Cost</span>
						<span
							className="tabular-nums text-t6"
							{...(breakdown.hasUnknownModelCost
								? {title: "Some models have no known price, so the cost is a floor"}
								: {})}
						>
							{breakdown.hasUnknownModelCost ? `${cost}+` : cost}
						</span>
					</span>
					<span data-usage-session-stat="cache-hit" className="flex gap-1">
						<span title="Cache hit" className="text-secondary">
							Cache hit
						</span>
						<span className="tabular-nums text-t6">{formatCacheHit(breakdown.cacheHitRatio)}</span>
					</span>
				</div>
			</div>
			{breakdown.models.map((model) => (
				<div key={model.model} className="flex flex-col">
					<div data-usage-breakdown-header className={ROW_CLASS}>
						<span className="font-medium">Breakdown</span>
						<span className="text-secondary">{model.model}</span>
					</div>
					{usageBreakdownRows(model).map(([label, value]) => (
						<div key={label} data-usage-breakdown-row className={`${ROW_CLASS} text-secondary`}>
							<span>{label}</span>
							<span className="tabular-nums">{value}</span>
						</div>
					))}
				</div>
			))}
		</section>
	);
}
