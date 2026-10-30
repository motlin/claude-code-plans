import type {EngineInterface, Register} from "claude-code";

/** Where Claude Code Browser reads the mirror: `<config dir>/plugins/data/ccb-context-mirror/context/<sessionId>.json`. */
const MIRROR_SUBDIR = "plugins/data/ccb-context-mirror/context";

async function configDir($: EngineInterface): Promise<string> {
	const configured = await $.env.get("CLAUDE_CONFIG_DIR");
	if (configured) return configured.replace(/\/+$/, "");
	const home = await $.env.get("HOME");
	return `${home}/.claude`;
}

/**
 * Write the session's context breakdown, counted as "summary" (the last response's usage plus local
 * estimates, no token-count calls), in the SDK's `get_context_usage` shape less its grid.
 */
async function mirror($: EngineInterface): Promise<void> {
	const usage = await $.session.usage({breakdown: "summary"});
	const full = usage.context.breakdown;
	if (full === undefined) return;
	const {gridRows: _gridRows, ...breakdown} = full;
	const sessionId = await $.session.id();
	const path = `${await configDir($)}/${MIRROR_SUBDIR}/${sessionId}.json`;
	const file = {sessionId, fetchedAt: new Date().toISOString(), breakdown};
	await $.fs.write(path, `${JSON.stringify(file, null, "\t")}\n`);
}

// Each hook calls `next` first, so its `.catch` replays what that settled to: a failed mirror never costs the event.
export const register: Register = (on) => {
	// Fires after each main-thread turn (and when a rate-limit window moves): mirror when the window's fill moved.
	on("session.measure", async ($, e, next) => {
		const result = await next(e);
		if (e.changed.includes("context")) await mirror($).catch(() => undefined);
		return result;
	}).catch(($, e, next) => next(e));

	on("session.compact", async ($, e, next) => {
		const result = await next(e);
		await mirror($).catch(() => undefined);
		return result;
	}).catch(($, e, next) => next(e));

	// A resumed session already has turns: mirror it at once rather than waiting for the next turn.
	on("session.start", async ($, e, next) => {
		const result = await next(e);
		if ((await $.session.turns()) > 0) await mirror($).catch(() => undefined);
		return result;
	}).catch(($, e, next) => next(e));
};
