import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatCount } from "../lib/pluralize";

// Tokyo Night–inspired segment colors from claude-powerline.json
const SEGMENT_COLORS = {
  directory: { bg: "#2a2a2a", fg: "#e0e0e0" },
  git: { bg: "#3a3a3a", fg: "#d0d0d0" },
  version: { bg: "#7a7a7a", fg: "#f0f0f0" },
  metrics: { bg: "#565656", fg: "#e5e5e5" },
  context: { bg: "#6a6a6a", fg: "#ffffff" },
  rate: { bg: "#4a4a4a", fg: "#c0c0c0" },
  cost: { bg: "#5a5a5a", fg: "#b0b0b0" },
} as const;

interface SegmentProps {
  label: string;
  color: { bg: string; fg: string };
}

function Segment({ label, color }: SegmentProps) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: color.bg, color: color.fg }}
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

function getNestedString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

interface StatusFooterProps {
  data: Record<string, unknown>;
  gitBranch: string | null;
  gitSha: string | null;
  gitClean: boolean | null;
  messageCount: number;
  pendingTaskCount: number;
}

export function StatusFooter({
  data,
  gitBranch,
  gitSha,
  gitClean,
  messageCount,
  pendingTaskCount,
}: StatusFooterProps) {
  const [expanded, setExpanded] = useState(false);

  const segments: Array<{
    key: string;
    label: string;
    color: { bg: string; fg: string };
  }> = [];

  // Directory (basename of cwd)
  const cwd = (data["cwd"] as string) ?? getNestedString(data, "workspace", "current_dir");
  if (cwd) {
    const basename = cwd.split("/").pop() ?? cwd;
    segments.push({
      key: "dir",
      label: basename,
      color: SEGMENT_COLORS.directory,
    });
  }

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

  // Lines added/removed
  const linesAdded = getNestedNumber(data, "cost", "total_lines_added");
  const linesRemoved = getNestedNumber(data, "cost", "total_lines_removed");
  if (linesAdded !== undefined || linesRemoved !== undefined) {
    const parts: string[] = [];
    if (linesAdded !== undefined && linesAdded > 0) parts.push(`+${linesAdded}`);
    if (linesRemoved !== undefined && linesRemoved > 0) parts.push(`-${linesRemoved}`);
    if (parts.length > 0) {
      segments.push({
        key: "lines",
        label: parts.join(" "),
        color: SEGMENT_COLORS.metrics,
      });
    }
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
    segments.push({ key: "ctx", label, color: SEGMENT_COLORS.context });
  }

  // Git branch + SHA + working tree status
  if (gitBranch) {
    let gitLabel = `⎇ ${gitBranch}`;
    if (gitSha) gitLabel += ` ${gitSha}`;
    if (gitClean === true) gitLabel += " ✓";
    else if (gitClean === false) gitLabel += " ✗";
    segments.push({ key: "git", label: gitLabel, color: SEGMENT_COLORS.git });
  }

  // Task count
  if (pendingTaskCount > 0) {
    segments.push({
      key: "tasks",
      label: formatCount(pendingTaskCount, "task"),
      color: SEGMENT_COLORS.metrics,
    });
  }

  // Model
  const modelName =
    getNestedString(data, "model", "display_name") ?? getNestedString(data, "model", "id");
  if (modelName) {
    segments.push({
      key: "model",
      label: modelName,
      color: SEGMENT_COLORS.version,
    });
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
      <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto">
        {segments.map((seg) => (
          <Segment key={seg.key} label={seg.label} color={seg.color} />
        ))}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="ml-auto shrink-0 p-1 text-t6 hover:text-primary transition-colors cursor-pointer"
          title={expanded ? "Collapse raw JSON" : "Expand raw JSON"}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border max-h-80 overflow-auto">
          <pre className="px-4 py-3 text-xs font-mono text-secondary leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
