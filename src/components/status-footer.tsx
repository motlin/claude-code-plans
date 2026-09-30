import {useState} from "react";
import {ChevronDown, ChevronRight, ChevronUp} from "lucide-react";
import {formatCount} from "../lib/pluralize";

// Tokyo Night–inspired segment colors from claude-powerline.json
const SEGMENT_COLORS = {
	version: {bg: "#7a7a7a", fg: "#f0f0f0"},
	metrics: {bg: "#565656", fg: "#e5e5e5"},
	context: {bg: "#6a6a6a", fg: "#ffffff"},
	rate: {bg: "#4a4a4a", fg: "#c0c0c0"},
	cost: {bg: "#5a5a5a", fg: "#b0b0b0"},
} as const;

interface SegmentProps {
	label: string;
	color: {bg: string; fg: string};
}

function Segment({label, color}: SegmentProps) {
	return (
		<span
			data-status-segment=""
			className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
			style={{backgroundColor: color.bg, color: color.fg}}
		>
			{label}
		</span>
	);
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

function formatCost(usd: number): string {
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function getNestedNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
	let current: unknown = obj;
	for (const key of keys) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "number" ? current : undefined;
}

interface StatusFooterProps {
	data: Record<string, unknown>;
	messageCount: number;
}

/**
 * Statusline data with no upstream home — version, duration · msgs, context, rate limits and
 * cost — behind a details toggle. Project, branch and line counts live in the branch strip,
 * and the model in the composer chin.
 */
export function StatusFooter({data, messageCount}: StatusFooterProps) {
	const [open, setOpen] = useState(false);
	const [rawExpanded, setRawExpanded] = useState(false);

	const segments: Array<{
		key: string;
		label: string;
		color: {bg: string; fg: string};
	}> = [];

	// Version
	const version = data["version"];
	if (typeof version === "string") {
		segments.push({
			key: "ver",
			label: `v${version}`,
			color: SEGMENT_COLORS.version,
		});
	}

	// Duration + message count
	const durationMs = getNestedNumber(data, "cost", "total_duration_ms");
	if (durationMs !== undefined) {
		const durationLabel =
			messageCount > 0
				? `${formatDuration(durationMs)} · ${formatCount(messageCount, "msg")}`
				: formatDuration(durationMs);
		segments.push({
			key: "dur",
			label: durationLabel,
			color: SEGMENT_COLORS.metrics,
		});
	} else if (messageCount > 0) {
		segments.push({
			key: "msgs",
			label: formatCount(messageCount, "msg"),
			color: SEGMENT_COLORS.metrics,
		});
	}

	// Context window: tokens + percentage
	const contextPct = getNestedNumber(data, "context_window", "used_percentage");
	const totalInput = getNestedNumber(data, "context_window", "total_input_tokens") ?? 0;
	const totalOutput = getNestedNumber(data, "context_window", "total_output_tokens") ?? 0;
	const totalTokens = totalInput + totalOutput;
	const windowSize = getNestedNumber(data, "context_window", "context_window_size");
	if (contextPct !== undefined) {
		let label = `${formatTokens(totalTokens)} (${Math.round(contextPct)}%)`;
		if (windowSize) label += ` / ${formatTokens(windowSize)}`;
		segments.push({key: "ctx", label, color: SEGMENT_COLORS.context});
	}

	// Rate limits
	const rate5h = getNestedNumber(data, "rate_limits", "five_hour", "used_percentage");
	const rate7d = getNestedNumber(data, "rate_limits", "seven_day", "used_percentage");
	if (rate5h !== undefined || rate7d !== undefined) {
		const parts: string[] = [];
		if (rate5h !== undefined) parts.push(`5h:${Math.round(rate5h)}%`);
		if (rate7d !== undefined) parts.push(`7d:${Math.round(rate7d)}%`);
		segments.push({
			key: "rate",
			label: parts.join(" "),
			color: SEGMENT_COLORS.rate,
		});
	}

	// Cost
	const costUsd = getNestedNumber(data, "cost", "total_cost_usd");
	if (costUsd !== undefined) {
		segments.push({
			key: "cost",
			label: formatCost(costUsd),
			color: SEGMENT_COLORS.cost,
		});
	}

	if (segments.length === 0) return null;

	return (
		<div className="border-t border-border bg-surface-2">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full cursor-pointer items-center gap-1 px-4 py-1 text-caption text-t6 transition-colors hover:text-primary"
			>
				{open ? (
					<ChevronDown aria-hidden className="h-3 w-3" />
				) : (
					<ChevronRight aria-hidden className="h-3 w-3" />
				)}
				Session details
			</button>
			{open && (
				<div data-status-segments="" className="flex flex-wrap items-center gap-1.5 px-4 py-2">
					{segments.map((seg) => (
						<Segment key={seg.key} label={seg.label} color={seg.color} />
					))}
					<button
						type="button"
						onClick={() => setRawExpanded(!rawExpanded)}
						className="ml-auto shrink-0 p-1 text-t6 hover:text-primary transition-colors cursor-pointer"
						title={rawExpanded ? "Collapse raw JSON" : "Expand raw JSON"}
					>
						{rawExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
					</button>
				</div>
			)}
			{open && rawExpanded && (
				<div className="border-t border-border max-h-80 overflow-auto">
					<pre className="px-4 py-3 text-xs font-mono text-secondary leading-relaxed">
						{JSON.stringify(data, null, 2)}
					</pre>
				</div>
			)}
		</div>
	);
}
