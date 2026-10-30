import {readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {basename, dirname, join} from "node:path";
import type {ContextBreakdown} from "./context-breakdown";
import {DOMAIN_EVENTS} from "./event-names";
import {SESSION_ID_PATTERN} from "./api/statusline";
import type {ContextMirrorFile} from "./schemas";
import {ContextMirrorFileSchema} from "./runtime-schemas";

/** Where the `ccb-context-mirror` CLI mod (`mods/ccb-context-mirror`) writes one breakdown file per session. */
export const CONTEXT_MIRROR_DIR = join(homedir(), ".claude", "plugins", "data", "ccb-context-mirror", "context");

export function breakdownFromMirror(file: ContextMirrorFile): ContextBreakdown {
	const {breakdown} = file;
	return {
		categories: breakdown.categories.map(({name, tokens, kind}) => ({name, tokens, kind})),
		totalTokens: breakdown.totalTokens,
		rawMaxTokens: breakdown.rawMaxTokens,
		percentage: breakdown.percentage,
		mcpTools: breakdown.mcpTools.map(({name, serverName, tokens}) => ({name, serverName, tokens})),
		memoryFiles: breakdown.memoryFiles.map(({path, type, tokens}) => ({path, type, tokens})),
		agents: breakdown.agents.map(({agentType, source, tokens}) => ({agentType, source, tokens})),
		fetchedAt: file.fetchedAt,
		source: "mod",
	};
}

/** The session's mirrored breakdown, or null when the mod has written none (or wrote something else). */
export async function readContextMirror(
	sessionId: string,
	dir: string = CONTEXT_MIRROR_DIR,
): Promise<ContextBreakdown | null> {
	if (!SESSION_ID_PATTERN.test(sessionId)) return null;
	let raw: string;
	try {
		raw = await readFile(join(dir, `${sessionId}.json`), "utf-8");
	} catch {
		return null;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = ContextMirrorFileSchema.safeParse(json);
	return parsed.success ? breakdownFromMirror(parsed.data) : null;
}

type BroadcastFn = (type: string, data: Record<string, unknown>) => void;

/**
 * Route a watcher event in the mirror directory: a `<sessionId>.json` write broadcasts
 * `session:context-breakdown-changed` for that session. True when `path` is in the directory.
 */
export function handleContextMirrorEvent(path: string, mirrorRoot: string, broadcast: BroadcastFn): boolean {
	if (!mirrorRoot || dirname(path) !== mirrorRoot) return false;
	const name = basename(path);
	if (name.endsWith(".json")) {
		const sessionId = name.slice(0, -".json".length);
		if (SESSION_ID_PATTERN.test(sessionId)) {
			broadcast(DOMAIN_EVENTS.SESSION_CONTEXT_BREAKDOWN_CHANGED, {sessionId});
		}
	}
	return true;
}
