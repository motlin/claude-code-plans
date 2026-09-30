import {AlertTriangle, CircleAlert, Info} from "lucide-react";
import type {ReviewFinding} from "../lib/review-diff";

type FindingSeverity = ReviewFinding["severity"];

const severityStyles: Record<FindingSeverity, string> = {
	high: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
	medium: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
	low: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
	nit: "border-strong bg-surface-0 text-t6",
};

export interface FindingCardProps {
	severity: FindingSeverity;
	title: string;
	body: string;
	suggestion?: string | undefined;
	anchorId?: string | undefined;
	location?: string | undefined;
	category?: string | undefined;
	verdict?: string | undefined;
}

/** A review finding: severity-tinted card with title, body and optional suggested fix. */
export function FindingCard({
	severity,
	title,
	body,
	suggestion,
	anchorId,
	location,
	category,
	verdict,
}: FindingCardProps) {
	const Icon = severity === "high" ? CircleAlert : severity === "medium" ? AlertTriangle : Info;
	const hasMeta = location !== undefined || category !== undefined || verdict !== undefined;
	return (
		<div
			id={anchorId}
			data-finding-card=""
			className={`m-1 rounded-md border px-3 py-2 text-xs ${severityStyles[severity]}`}
		>
			<div className="flex items-center gap-1.5 font-semibold">
				<Icon className="h-3.5 w-3.5 shrink-0" />
				<span data-finding-title="">{title}</span>
			</div>
			{hasMeta && (
				<div className="mt-1 flex flex-wrap items-center gap-2 opacity-80">
					{location !== undefined && (
						<span data-finding-location="" className="font-mono">
							{location}
						</span>
					)}
					{category !== undefined && <span data-finding-category="">{category}</span>}
					{verdict !== undefined && (
						<span data-finding-verdict="" className="font-semibold">
							{verdict}
						</span>
					)}
				</div>
			)}
			<p data-finding-body="" className="mt-1 whitespace-pre-wrap">
				{body}
			</p>
			{suggestion && (
				<pre className="mt-2 overflow-x-auto rounded bg-surface-1/70 p-2 font-mono text-[11px]">
					{suggestion}
				</pre>
			)}
		</div>
	);
}
