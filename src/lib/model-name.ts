/**
 * The sentinel Claude Code writes as `message.model` on a record that no model
 * produced (replayed or reconstructed turns). It names no model, so it is
 * treated as absent everywhere rather than shown or stored.
 */
export const SYNTHETIC_MODEL = "<synthetic>";

/** A model id without its `[1m]` window suffix or `-YYYYMMDD` date: `claude-opus-5-20261001[1m]` -> `claude-opus-5`. */
export function baseModelId(raw: string): string
{
	return raw
		.trim()
		.replace(/\[[^\]]*\]$/, "")
		.replace(/-\d{8}$/, "");
}

/**
 * Shorten a raw model id to the display name upstream puts on a subagent row:
 * `claude-haiku-4-5-20251001` -> `Haiku 4.5`.
 *
 * Claude Code writes the field three ways -- a dated id
 * (`claude-haiku-4-5-20251001`), an undated alias (`claude-opus-4-8`), and the
 * bare family name an `Agent` call's `model` override uses (`sonnet`) -- and
 * any of them may carry the `[1m]` context-window suffix, which qualifies the
 * window rather than naming a different model. Returns null when the input
 * names no model at all.
 */
export function formatModelName(raw: string | null | undefined): string | null
{
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed || trimmed === SYNTHETIC_MODEL) return null;

	const withoutDate = baseModelId(trimmed).replace(/^claude-/, "");

	const [family, ...version] = withoutDate.split("-");
	if (!family) return null;
	const name = family.charAt(0).toUpperCase() + family.slice(1);
	return version.length > 0 ? `${name} ${version.join(".")}` : name;
}
