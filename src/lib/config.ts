import {homedir} from 'node:os';
import {join} from 'node:path';

/**
 * Directory holding this application's own configuration. Follows the XDG
 * Base Directory spec: `$XDG_CONFIG_HOME/claude-code-plans`, falling back to
 * `~/.config/claude-code-plans`. This is *our* config — distinct from
 * `~/.claude/`, which belongs to Claude Code itself and must not be written
 * to or extended by this app.
 */
function getConfigDir(): string {
	const xdg = process.env['XDG_CONFIG_HOME'];
	const base = xdg || join(homedir(), '.config');
	return join(base, 'claude-code-plans');
}

/** Path to this application's config file. */
export function getConfigPath(): string {
	return join(getConfigDir(), 'config.json');
}
