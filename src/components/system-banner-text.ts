import type {ProcessedLine} from "../lib/transcript";
export function formatTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * Upstream claude.ai/code's compaction marker copy: the tokens saved when both
 * counts are known, the starting size when only that is, else the bare verb.
 */
export function compactBoundaryLabel(meta: SystemLine["compactMetadata"]): string {
	if (meta === undefined) return "Compacted session";
	if (meta.postTokens !== undefined) {
		return `Compacted session · saved ${formatTokens(meta.preTokens - meta.postTokens)} tokens`;
	}
	return `Compacted session · from ${formatTokens(meta.preTokens)} tokens`;
}

/** The text inside a local command's stdout/stderr tags, or the raw content, without terminal colors. */
export function localCommandOutput(content: string | undefined): string {
	if (content === undefined) return "";
	const parts = Array.from(content.matchAll(LOCAL_COMMAND_OUTPUT_RE), ([, text]) => text ?? "");
	return (parts.length > 0 ? parts.join("\n") : content).replace(ANSI_SGR_RE, "").trim();
}

const LOCAL_COMMAND_OUTPUT_RE = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/g;

// eslint-disable-next-line no-control-regex -- matches terminal color escapes
const ANSI_SGR_RE = /\u001b\[[0-9;]*m/g;

export type SystemLine = Extract<ProcessedLine, {type: "system"}>;
